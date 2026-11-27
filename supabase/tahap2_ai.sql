-- =====================================================================
-- GlowGrid · Tahap 2: analisis laporan dengan AI (Groq)
-- Dijalankan SETELAH tahap1_dispatcher.sql. Aman dijalankan ulang.
--
-- Alur:
--   warga kirim laporan → ai_status 'pending' → database memanggil Edge Function
--   'analyze-report' (pg_net) → AI menilai → ai_save() → dispatcher berjalan.
--   Dispatcher menunggu hasil AI maksimal 60 detik; lewat dari itu laporan
--   ditugaskan dengan skor algoritma. Laporan bertanda spam/duplikat
--   tidak ditugaskan otomatis, menunggu tinjauan admin.
-- =====================================================================

-- ---------- 0. Ekstensi untuk memanggil Edge Function dari database (Supabase) ----------
-- create extension if not exists pg_net with schema extensions;   -- dijalankan terpisah di Supabase

-- ---------- 1. Kolom AI pada laporan ----------
alter table public.reports
  add column if not exists ai_status      text not null default 'pending',
  add column if not exists ai_attempts    smallint not null default 0,
  add column if not exists ai_reason      text,
  add column if not exists ai_flags       text[] not null default '{}',
  add column if not exists ai_duplicate_of text,
  add column if not exists ai_category    text,
  add column if not exists ai_model       text,
  add column if not exists ai_error       text,
  add column if not exists ai_analyzed_at timestamptz;
alter table public.reports drop constraint if exists reports_ai_status_check;
alter table public.reports add constraint reports_ai_status_check
  check (ai_status in ('pending','processing','done','failed','skipped'));
-- laporan lama tidak dianalisis ulang
update public.reports set ai_status = 'skipped' where ai_status = 'pending' and created_at < now() - interval '10 minutes';

alter table public.app_settings add column if not exists ai_enabled boolean not null default true;

alter table public.dispatch_log drop constraint if exists dispatch_log_action_check;
alter table public.dispatch_log add constraint dispatch_log_action_check
  check (action in ('assign','no_teknisi','decline','unassign','mode','review','ai'));
alter table public.dispatch_log drop constraint if exists dispatch_log_actor_check;
alter table public.dispatch_log add constraint dispatch_log_actor_check
  check (actor in ('sistem','admin','teknisi','ai'));

-- ---------- 2. Konfigurasi privat (tidak terlihat lewat API) ----------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.config (key text primary key, value text not null);

-- ---------- 3. Laporan baru: kolom AI selalu diisi sistem ----------
create or replace function public.reports_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare k record;
begin
  select * into k from public.keyword_urgency(new.category, new.severity, new.description);
  new.kw_urgency := k.score; new.urgency_notes := k.notes;
  new.ai_urgency := null; new.ai_summary := null; new.ai_reason := null; new.ai_flags := '{}';
  new.ai_duplicate_of := null; new.ai_category := null; new.ai_model := null; new.ai_error := null;
  new.ai_analyzed_at := null; new.ai_attempts := 0;
  new.ai_status := case when coalesce((select ai_enabled from public.app_settings where id = 1), true)
                        then 'pending' else 'skipped' end;
  new.assigned_by := null; new.assigned_at := null; new.completed_at := null;
  return new;
end $$;

-- ---------- 4. Penjaga update laporan: kolom AI hanya diubah sistem ----------
create or replace function public.guard_report_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare r text := public.app_role();
begin
  new.updated_at := now();
  if new.status = 'Selesai' and old.status is distinct from 'Selesai' then new.completed_at := now(); end if;
  if auth.uid() is null or current_setting('glowgrid.system', true) = 'on' then return new; end if;

  if r = 'admin' then
    if new.status = 'Ditugaskan' and (new.technician_id is null
       or not exists (select 1 from public.profiles where id = new.technician_id and role = 'teknisi')) then
      raise exception 'Teknisi yang dipilih tidak valid.';
    end if;
    if new.technician_id is distinct from old.technician_id and new.technician_id is not null then
      new.assigned_by := 'admin'; new.assigned_at := now();
    end if;
    -- kolom skor & AI hanya diubah sistem
    new.kw_urgency := old.kw_urgency; new.urgency_notes := old.urgency_notes;
    new.ai_urgency := old.ai_urgency; new.ai_summary := old.ai_summary; new.ai_reason := old.ai_reason;
    new.ai_flags := old.ai_flags; new.ai_duplicate_of := old.ai_duplicate_of; new.ai_category := old.ai_category;
    new.ai_status := old.ai_status; new.ai_attempts := old.ai_attempts; new.ai_model := old.ai_model;
    new.ai_error := old.ai_error; new.ai_analyzed_at := old.ai_analyzed_at;
    return new;
  end if;

  if r = 'teknisi' then
    if old.technician_id is distinct from auth.uid() then raise exception 'Laporan ini bukan tugas Anda.'; end if;
    if (new.id, new.owner_id, new.reporter, new.phone, new.category, new.severity, new.description,
        new.village, new.address, new.lat, new.lng, new.technician_id, new.technician_name, new.created_at,
        new.kw_urgency, new.urgency_notes, new.ai_urgency, new.ai_summary, new.assigned_by, new.assigned_at,
        new.ai_status, new.ai_attempts, new.ai_reason, new.ai_flags, new.ai_duplicate_of, new.ai_category,
        new.ai_model, new.ai_error, new.ai_analyzed_at)
       is distinct from
       (old.id, old.owner_id, old.reporter, old.phone, old.category, old.severity, old.description,
        old.village, old.address, old.lat, old.lng, old.technician_id, old.technician_name, old.created_at,
        old.kw_urgency, old.urgency_notes, old.ai_urgency, old.ai_summary, old.assigned_by, old.assigned_at,
        old.ai_status, old.ai_attempts, old.ai_reason, old.ai_flags, old.ai_duplicate_of, old.ai_category,
        old.ai_model, old.ai_error, old.ai_analyzed_at) then
      raise exception 'Teknisi hanya dapat mengubah status laporan.';
    end if;
    if not ((old.status = 'Ditugaskan'    and new.status in ('Menuju Lokasi','Selesai'))
         or (old.status = 'Menuju Lokasi' and new.status = 'Selesai')) then
      raise exception 'Perubahan status % → % tidak diizinkan.', old.status, new.status;
    end if;
    return new;
  end if;

  raise exception 'Role Anda tidak dapat mengubah laporan.';
end $$;

-- ---------- 5. Dispatcher: tunggu AI ≤60 detik, tahan laporan bertanda ----------
create or replace function public.dispatch(p_trigger text default 'manual')
returns int language plpgsql security definer set search_path = public as $$
declare
  st      public.app_settings;
  night   boolean;
  rep     public.reports;
  best    record;
  n_done  int := 0;
  urg     int;
  src     text;
  prev    text := current_setting('glowgrid.system', true);
begin
  select * into st from public.app_settings where id = 1;
  if not st.auto_dispatch then return 0; end if;

  perform pg_advisory_xact_lock(424242);
  perform set_config('glowgrid.system', 'on', true);
  night := public.is_night();

  for rep in
    select r.* from public.reports r
    where r.status = 'Menunggu Verifikasi'
    order by public.queue_priority(r) desc, r.created_at asc
  loop
    -- (a) hasil AI belum ada dan laporan masih < 60 detik → tunggu
    if rep.ai_status in ('pending','processing') and rep.created_at > now() - interval '60 seconds' then continue; end if;

    -- (b) AI menandai spam/duplikat → tunggu tinjauan admin
    if cardinality(rep.ai_flags) > 0 then
      if not exists (select 1 from public.dispatch_log d where d.report_id = rep.id and d.action = 'review') then
        insert into public.dispatch_log (report_id, action, actor, reason)
        values (rep.id, 'review', 'sistem', format('Ditahan untuk tinjauan admin: %s', array_to_string(rep.ai_flags, ', ')));
      end if;
      continue;
    end if;

    urg := public.effective_urgency(rep);
    src := case when rep.ai_urgency is not null then 'AI' else 'algoritma' end;
    if night and urg < st.night_min_urgency then continue; end if;

    select * into best from public.rank_technicians(rep.id, night) limit 1;
    if found then
      update public.reports
         set status = 'Ditugaskan', technician_id = best.technician_id, technician_name = best.name,
             assigned_by = 'sistem', assigned_at = now()
       where id = rep.id;
      insert into public.dispatch_log (report_id, technician_id, action, actor, reason)
      values (rep.id, best.technician_id, 'assign', 'sistem',
              format('Urgensi %s (%s)%s → %s', urg, src, case when night then ' · malam, teknisi piket' else '' end, best.reason));
      n_done := n_done + 1;
    else
      if not exists (select 1 from public.dispatch_log d where d.report_id = rep.id and d.action = 'no_teknisi'
                     and d.created_at > now() - interval '30 minutes') then
        insert into public.dispatch_log (report_id, action, actor, reason)
        values (rep.id, 'no_teknisi', 'sistem',
                format('Urgensi %s (%s), belum ada teknisi %s yang tersedia', urg, src, case when night then 'piket' else 'Ready' end));
      end if;
    end if;
  end loop;

  perform set_config('glowgrid.system', coalesce(nullif(prev, ''), 'off'), true);
  return n_done;
end $$;

-- ---------- 6. Memanggil Edge Function lewat pg_net ----------
create or replace function private.request_ai_analysis(p_report_id text default null)
returns void language plpgsql security definer set search_path = public, private as $$
declare url text; jwt text;
begin
  if to_regnamespace('net') is null then return; end if;                 -- pg_net belum aktif
  select value into url from private.config where key = 'ai_function_url';
  select value into jwt from private.config where key = 'ai_invoke_jwt';
  if url is null or jwt is null then return; end if;
  perform net.http_post(
    url := url,
    body := jsonb_build_object('report_id', p_report_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || jwt),
    timeout_milliseconds := 30000);
exception when others then
  raise warning 'request_ai_analysis gagal: %', sqlerrm;                 -- jangan gagalkan laporan warga
end $$;

create or replace function public.trg_request_ai()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if new.ai_status = 'pending' then perform private.request_ai_analysis(new.id); end if;
  return null;
end $$;
drop trigger if exists reports_request_ai on public.reports;
create trigger reports_request_ai after insert on public.reports
  for each row execute function public.trg_request_ai();

-- Setelah AI selesai/gagal → jalankan dispatcher
create or replace function public.trg_dispatch_after_ai()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ai_status in ('done','failed','skipped') and old.ai_status in ('pending','processing') then
    perform public.dispatch('ai_selesai');
  end if;
  return null;
end $$;
drop trigger if exists reports_dispatch_after_ai on public.reports;
create trigger reports_dispatch_after_ai after update of ai_status on public.reports
  for each row execute function public.trg_dispatch_after_ai();

-- ---------- 7. Fungsi untuk Edge Function (hanya service_role) ----------
-- Klaim laporan yang perlu dianalisis (mencegah dua proses menganalisis laporan yang sama)
create or replace function public.ai_claim(p_report_id text default null, p_limit int default 5)
returns setof text language plpgsql security definer set search_path = public as $$
begin
  perform set_config('glowgrid.system', 'on', true);
  return query
  with picked as (
    select r.id from public.reports r
    where (p_report_id is null or r.id = p_report_id)
      and r.status <> 'Ditolak' and r.created_at > now() - interval '1 day'
      and ( r.ai_status = 'pending'
         or (r.ai_status = 'failed'     and r.ai_attempts < 3 and r.updated_at < now() - interval '1 minute')
         or (r.ai_status = 'processing' and r.updated_at < now() - interval '2 minutes') )
    order by r.created_at
    limit greatest(1, least(p_limit, 10))
    for update skip locked
  )
  update public.reports r set ai_status = 'processing', ai_attempts = r.ai_attempts + 1
  from picked where r.id = picked.id
  returning r.id;
end $$;

-- Data yang dikirim ke AI: laporan + laporan AKTIF lain di sekitar (≤250 m, 14 hari terakhir) untuk cek duplikat
create or replace function public.ai_context(p_report_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  with me as (select * from public.reports where id = p_report_id)
  select jsonb_build_object(
    'id', me.id, 'kategori', me.category, 'prioritas_warga', me.severity,
    'deskripsi', me.description, 'kelurahan', me.village, 'alamat', me.address,
    'skor_algoritma', me.kw_urgency,
    'laporan_sekitar', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'kategori', o.category, 'deskripsi', left(o.description, 200),
                                          'jarak_m', round(d.m), 'status', o.status) order by d.m)
      from public.reports o
      cross join lateral (select 6371000 * 2 * asin(sqrt(
             power(sin(radians(o.lat - me.lat) / 2), 2) +
             cos(radians(me.lat)) * cos(radians(o.lat)) * power(sin(radians(o.lng - me.lng) / 2), 2))) as m) d
      where o.id <> me.id and o.status in ('Menunggu Verifikasi','Ditugaskan','Menuju Lokasi')
        and o.created_at > now() - interval '14 days' and d.m <= 250
    ), '[]'::jsonb))
  from me
$$;

-- Simpan hasil AI (divalidasi ulang di database)
create or replace function public.ai_save(p_report_id text, p_result jsonb, p_model text)
returns void language plpgsql security definer set search_path = public as $$
declare
  rep     public.reports;
  urg     int;
  flags   text[] := '{}';
  dup     text;
  cat     text;
  nearby  jsonb := public.ai_context(p_report_id) -> 'laporan_sekitar';
begin
  perform set_config('glowgrid.system', 'on', true);
  select * into rep from public.reports where id = p_report_id for update;
  if rep.id is null then return; end if;

  urg := greatest(0, least(100, round(case when (p_result->>'urgensi') ~ '^\s*-?\d+(\.\d+)?\s*$'
                                            then (p_result->>'urgensi')::numeric else rep.kw_urgency end)::int));
  cat := nullif(p_result->>'kategori_koreksi', '');
  if cat is not null and cat not in ('Lampu padam','Menyala pada siang hari','Penerangan kurang','Tiang/kabel bermasalah') then cat := null; end if;
  if cat = rep.category then cat := null; end if;
  dup := nullif(p_result->>'duplikat_dari', '');
  if dup is not null and not exists (select 1 from jsonb_array_elements(nearby) e where e->>'id' = dup) then dup := null; end if;
  if lower(coalesce(p_result->>'kemungkinan_spam', 'false')) in ('true','ya','yes','1') then flags := array_append(flags, 'kemungkinan spam'); end if;
  if dup is not null then flags := array_append(flags, format('kemungkinan duplikat %s', dup)); end if;

  insert into public.dispatch_log (report_id, action, actor, reason)
  values (p_report_id, 'ai', 'ai', format('Urgensi AI %s (algoritma %s)%s — %s', urg, rep.kw_urgency,
          case when cardinality(flags) > 0 then ' · ' || array_to_string(flags, ', ') else '' end,
          left(coalesce(p_result->>'alasan', ''), 200)));

  update public.reports set
    ai_urgency = urg,
    ai_summary = left(nullif(trim(p_result->>'ringkasan'), ''), 240),
    ai_reason  = left(nullif(trim(p_result->>'alasan'), ''), 400),
    ai_flags = flags, ai_duplicate_of = dup, ai_category = cat,
    ai_model = left(p_model, 80), ai_error = null, ai_analyzed_at = now(), ai_status = 'done'
  where id = p_report_id;

end $$;

create or replace function public.ai_fail(p_report_id text, p_error text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('glowgrid.system', 'on', true);
  update public.reports set ai_status = 'failed', ai_error = left(p_error, 300)
  where id = p_report_id and ai_status = 'processing';
end $$;

-- ---------- 8. Fungsi untuk admin ----------
-- Abaikan tanda spam/duplikat → laporan masuk penugasan normal
create or replace function public.admin_clear_ai_flags(p_report_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.app_role() <> 'admin' then raise exception 'Hanya admin.'; end if;
  perform set_config('glowgrid.system', 'on', true);
  update public.reports set ai_flags = '{}', ai_duplicate_of = null where id = p_report_id;
  insert into public.dispatch_log (report_id, action, actor, reason)
  values (p_report_id, 'review', 'admin', 'Tanda AI diabaikan admin, laporan diproses normal');
  perform set_config('glowgrid.system', 'off', true);
  perform public.dispatch('admin_review');
end $$;

-- Minta AI menganalisis ulang
create or replace function public.admin_reanalyze(p_report_id text)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  if public.app_role() <> 'admin' then raise exception 'Hanya admin.'; end if;
  if not exists (select 1 from public.reports where id = p_report_id and status not in ('Selesai','Ditolak')) then
    raise exception 'Laporan yang sudah selesai atau ditolak tidak dianalisis ulang.';
  end if;
  perform set_config('glowgrid.system', 'on', true);
  update public.reports set ai_status = 'pending', ai_attempts = 0, ai_error = null where id = p_report_id;
  perform set_config('glowgrid.system', 'off', true);
  perform private.request_ai_analysis(p_report_id);
end $$;

-- Cron: analisis laporan yang tertunda/gagal
create or replace function private.kick_ai_backlog()
returns void language plpgsql security definer set search_path = public, private as $$
begin
  if exists (select 1 from public.reports where status <> 'Ditolak' and created_at > now() - interval '1 day' and (
       (ai_status = 'pending' and created_at < now() - interval '30 seconds')
    or (ai_status = 'failed' and ai_attempts < 3)
    or (ai_status = 'processing' and updated_at < now() - interval '2 minutes'))) then
    perform private.request_ai_analysis(null);
  end if;
end $$;

-- ---------- 9. Hak akses ----------
revoke all on function public.ai_claim(text, int), public.ai_context(text), public.ai_save(text, jsonb, text),
                       public.ai_fail(text, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.ai_claim(text, int), public.ai_context(text), public.ai_save(text, jsonb, text),
                              public.ai_fail(text, text) to service_role;
  end if;
end $$;
revoke all on function public.trg_request_ai(), public.trg_dispatch_after_ai() from public, anon, authenticated;
revoke all on function public.admin_clear_ai_flags(text), public.admin_reanalyze(text) from public, anon;
grant execute on function public.admin_clear_ai_flags(text), public.admin_reanalyze(text) to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

-- ---------- 10. Konfigurasi & jadwal (khusus Supabase, dijalankan terpisah) ----------
-- insert into private.config (key, value) values
--   ('ai_function_url', 'https://<project-ref>.supabase.co/functions/v1/analyze-report'),
--   ('ai_invoke_jwt',   '<legacy anon key>')
-- on conflict (key) do update set value = excluded.value;
-- select cron.schedule('glowgrid-dispatch',   '* * * * *',   $$select public.dispatch('cron')$$);
-- select cron.schedule('glowgrid-ai-backlog', '*/2 * * * *', $$select private.kick_ai_backlog()$$);
-- Secret Edge Function: GROQ_API_KEY (Dashboard → Edge Functions → Secrets)
