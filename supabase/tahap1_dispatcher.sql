-- =====================================================================
-- GlowGrid · Tahap 1: status teknisi, skor urgensi, penugasan otomatis
-- Dijalankan SETELAH schema.sql. Aman dijalankan ulang.
-- =====================================================================

-- ---------- 1. Kolom tambahan laporan ----------
alter table public.reports
  add column if not exists kw_urgency     smallint,          -- skor urgensi algoritma (0-100)
  add column if not exists urgency_notes  text[] default '{}',-- alasan skor, mis. {"bahaya listrik"}
  add column if not exists ai_urgency     smallint,          -- diisi AI di Tahap 2
  add column if not exists ai_summary     text,              -- diisi AI di Tahap 2
  add column if not exists assigned_by    text check (assigned_by in ('admin','sistem')),
  add column if not exists assigned_at    timestamptz,
  add column if not exists completed_at   timestamptz;

-- ---------- 2. Pengaturan aplikasi (satu baris) ----------
create table if not exists public.app_settings (
  id                 smallint primary key default 1 check (id = 1),
  auto_dispatch      boolean  not null default false,      -- tombol ON/OFF admin
  shift_start        time     not null default '06:00',    -- jam kerja normal (WIB)
  shift_end          time     not null default '22:00',
  night_min_urgency  smallint not null default 70 check (night_min_urgency between 0 and 100),
  inactive_hours     smallint not null default 8  check (inactive_hours between 1 and 72),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.profiles(id) on delete set null
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- ---------- 3. Status teknisi ----------
create table if not exists public.technician_status (
  technician_id     uuid primary key references public.profiles(id) on delete cascade,
  status            text not null default 'off' check (status in ('ready','fokus','istirahat','off')),
  capacity          smallint not null default 3 check (capacity between 1 and 10),
  is_on_call        boolean not null default false,       -- teknisi piket malam
  status_changed_at timestamptz not null default now(),
  last_seen_at      timestamptz not null default now()
);

-- Baris status otomatis untuk setiap akun ber-role teknisi
create or replace function public.ensure_technician_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'teknisi' then
    insert into public.technician_status (technician_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists profiles_technician_status on public.profiles;
create trigger profiles_technician_status after insert or update of role on public.profiles
  for each row execute function public.ensure_technician_status();
insert into public.technician_status (technician_id)
  select id from public.profiles where role = 'teknisi' on conflict do nothing;

-- ---------- 4. Jarak antarkelurahan (hasil Dijkstra dari graph wilayah, sama dengan teknisi-page.js) ----------
create table if not exists public.village_distance (
  from_village text not null,
  to_village   text not null,
  km           numeric(5,2) not null,
  primary key (from_village, to_village)
);
insert into public.village_distance (from_village, to_village, km) values
  ('Depot Pakal','Depot Pakal',0),   ('Depot Pakal','Babat Jerawat',1.1), ('Depot Pakal','Pakal',0.9),
  ('Depot Pakal','Sumber Rejo',3.9), ('Depot Pakal','Benowo',2.7),
  ('Babat Jerawat','Depot Pakal',1.1),('Babat Jerawat','Babat Jerawat',0),('Babat Jerawat','Pakal',1.3),
  ('Babat Jerawat','Sumber Rejo',3.5),('Babat Jerawat','Benowo',3.1),
  ('Pakal','Depot Pakal',0.9),       ('Pakal','Babat Jerawat',1.3),       ('Pakal','Pakal',0),
  ('Pakal','Sumber Rejo',3),         ('Pakal','Benowo',1.8),
  ('Sumber Rejo','Depot Pakal',3.9), ('Sumber Rejo','Babat Jerawat',3.5), ('Sumber Rejo','Pakal',3),
  ('Sumber Rejo','Sumber Rejo',0),   ('Sumber Rejo','Benowo',2.7),
  ('Benowo','Depot Pakal',2.7),      ('Benowo','Babat Jerawat',3.1),      ('Benowo','Pakal',1.8),
  ('Benowo','Sumber Rejo',2.7),      ('Benowo','Benowo',0)
on conflict (from_village, to_village) do update set km = excluded.km;

-- ---------- 5. Log keputusan penugasan ----------
create table if not exists public.dispatch_log (
  id             bigint generated always as identity primary key,
  report_id      text references public.reports(id) on delete cascade,
  technician_id  uuid references public.profiles(id) on delete set null,
  action         text not null check (action in ('assign','no_teknisi','decline','unassign','mode')),
  actor          text not null check (actor in ('sistem','admin','teknisi')),
  reason         text,
  created_at     timestamptz not null default now()
);
create index if not exists dispatch_log_report_idx on public.dispatch_log(report_id, created_at desc);
create index if not exists dispatch_log_time_idx   on public.dispatch_log(created_at desc);

-- ---------- 6. Skor urgensi algoritma (tanpa AI) ----------
create or replace function public.keyword_urgency(p_category text, p_severity int, p_description text,
                                                  out score smallint, out notes text[])
language plpgsql immutable set search_path = public as $$
declare
  t text := lower(coalesce(p_description, ''));
  s int  := case p_severity when 3 then 70 when 2 then 45 else 25 end;
  negated boolean;
begin
  notes := '{}';
  negated := t ~ '(tidak|tdk|gak|nggak|ga|bukan)\s+(ber)?bahaya' or t ~ '\maman\M';
  t := regexp_replace(t, '(tidak|tdk|gak|nggak|ga|bukan)\s+(ber)?bahaya', ' ', 'g');

  if t ~ '\m(kabel\w*|terkelupas|mengelupas|ngelotok|percik\w*|api|asap|\w*setrum|korsl?et\w*|konslet\w*|(ber)?bahaya)\M' then
    s := s + 20; notes := array_append(notes, 'bahaya listrik/fisik'::text);
  end if;
  if t ~ '\m(roboh|tumbang|miring|patah|putus|menjuntai|ambruk)\M' then
    s := s + 15; notes := array_append(notes, 'tiang/kabel rusak'::text);
  end if;
  if t ~ '\m(sekolah|sd|smp|sma|tk|masjid|musholl?a|pasar|puskesmas|rumah sakit|tikungan|perempatan|pertigaan|jalan raya|anak(-anak)?|lansia|kecelakaan|jambret|begal|rawan)\M' then
    s := s + 10; notes := array_append(notes, 'lokasi rawan/ramai'::text);
  end if;
  if t ~ '(gelap total|gelap gulita|sangat gelap|gelap banget|gelap sekali|semua (lampu )?mati|(dua|tiga|empat|beberapa|banyak) lampu)' then
    s := s + 10; notes := array_append(notes, 'area sangat gelap'::text);
  end if;
  if negated then s := s - 15; notes := array_append(notes, 'pelapor menyebut aman'::text); end if;
  if p_category = 'Tiang/kabel bermasalah' then s := s + 10; end if;
  if p_category = 'Menyala pada siang hari' then s := least(s, 40); notes := array_append(notes, 'pemborosan energi, bukan keselamatan'::text); end if;

  score := greatest(5, least(100, s));
end $$;

-- Urgensi efektif: AI (bila ada) > algoritma > prioritas warga
create or replace function public.effective_urgency(r public.reports)
returns int language sql stable as $$
  select coalesce(r.ai_urgency, r.kw_urgency, r.severity * 25)::int
$$;

-- Prioritas antrean = urgensi + aging (+10 per jam menunggu, maks +40) → Priority Queue
create or replace function public.queue_priority(r public.reports)
returns numeric language sql stable as $$
  select public.effective_urgency(r)
       + least(40, extract(epoch from (now() - r.created_at)) / 360.0)::numeric(6,2)
$$;

-- Hitung skor saat laporan dibuat (warga tidak bisa mengisi kolom sistem)
create or replace function public.reports_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare k record;
begin
  select * into k from public.keyword_urgency(new.category, new.severity, new.description);
  new.kw_urgency := k.score; new.urgency_notes := k.notes;
  new.ai_urgency := null; new.ai_summary := null;
  new.assigned_by := null; new.assigned_at := null; new.completed_at := null;
  return new;
end $$;
drop trigger if exists reports_before_insert on public.reports;
create trigger reports_before_insert before insert on public.reports
  for each row execute function public.reports_before_insert();

-- ---------- 7. Peringkat teknisi untuk satu laporan ----------
-- Dipakai oleh dispatcher otomatis DAN oleh saran untuk admin (mode manual).
create or replace function public.rank_technicians(p_report_id text, p_night boolean default false)
returns table (technician_id uuid, name text, score numeric, distance_km numeric, base_village text,
               active_load int, capacity int, is_on_call boolean, reason text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  rep public.reports;
  st  public.app_settings;
begin
  select * into rep from public.reports where id = p_report_id;
  select * into st  from public.app_settings where id = 1;
  return query
  with load as (
    select r.technician_id as tid, count(*)::int as n, array_agg(distinct r.village) as villages
    from public.reports r
    where r.status in ('Ditugaskan','Menuju Lokasi') and r.technician_id is not null
    group by r.technician_id
  ), cand as (
    select p.id, p.name, ts.capacity, ts.is_on_call, ts.status_changed_at,
           coalesce(l.n, 0) as n,
           coalesce(l.villages, array['Depot Pakal']) as bases
    from public.profiles p
    join public.technician_status ts on ts.technician_id = p.id
    left join load l on l.tid = p.id
    where p.role = 'teknisi'
      and ts.status = 'ready'
      and ts.last_seen_at > now() - make_interval(hours => st.inactive_hours)
      and coalesce(l.n, 0) < ts.capacity
      and (not p_night or ts.is_on_call)
      and not exists (select 1 from public.dispatch_log d
                      where d.report_id = rep.id and d.technician_id = p.id and d.action = 'decline')
  ), dist as (
    select c.*, best.from_village as base, best.km
    from cand c
    cross join lateral (
      select vd.from_village, vd.km from public.village_distance vd
      where vd.from_village = any(c.bases) and vd.to_village = rep.village
      order by vd.km asc limit 1
    ) best
  )
  select d.id, d.name,
         round(d.km + d.n * 0.8, 2) as score,
         d.km, d.base, d.n, d.capacity::int, d.is_on_call,
         format('%s · %s km dari %s · beban %s/%s%s', d.name, d.km, d.base, d.n, d.capacity,
                case when d.is_on_call then ' · piket' else '' end)
  from dist d
  order by round(d.km + d.n * 0.8, 2) asc, d.status_changed_at asc;
end $$;

-- ---------- 8. Dispatcher otomatis ----------
create or replace function public.is_night() returns boolean
language sql stable set search_path = public as $$
  select case when s.shift_start < s.shift_end
              then not ((now() at time zone 'Asia/Jakarta')::time between s.shift_start and s.shift_end)
              else ((now() at time zone 'Asia/Jakarta')::time between s.shift_end and s.shift_start) end
  from public.app_settings s where s.id = 1
$$;

create or replace function public.dispatch(p_trigger text default 'manual')
returns int language plpgsql security definer set search_path = public as $$
declare
  st      public.app_settings;
  night   boolean;
  rep     public.reports;
  best    record;
  n_done  int := 0;
  urg     int;
  prev    text := current_setting('glowgrid.system', true);
begin
  select * into st from public.app_settings where id = 1;
  if not st.auto_dispatch then return 0; end if;

  perform pg_advisory_xact_lock(424242);                  -- satu dispatcher berjalan pada satu waktu
  perform set_config('glowgrid.system', 'on', true);      -- izinkan update oleh sistem
  night := public.is_night();

  -- Priority Queue: urgensi + aging, lalu yang paling lama menunggu
  for rep in
    select r.* from public.reports r
    where r.status = 'Menunggu Verifikasi'
    order by public.queue_priority(r) desc, r.created_at asc
  loop
    urg := public.effective_urgency(rep);
    if night and urg < st.night_min_urgency then continue; end if;   -- malam: hanya yang mendesak

    select * into best from public.rank_technicians(rep.id, night) limit 1;
    if found then
      update public.reports
         set status = 'Ditugaskan', technician_id = best.technician_id, technician_name = best.name,
             assigned_by = 'sistem', assigned_at = now()
       where id = rep.id;
      insert into public.dispatch_log (report_id, technician_id, action, actor, reason)
      values (rep.id, best.technician_id, 'assign', 'sistem',
              format('Urgensi %s%s → %s', urg, case when night then ' (malam, teknisi piket)' else '' end, best.reason));
      n_done := n_done + 1;
    else
      -- catat sekali per 30 menit agar log tidak penuh
      if not exists (select 1 from public.dispatch_log d where d.report_id = rep.id and d.action = 'no_teknisi'
                     and d.created_at > now() - interval '30 minutes') then
        insert into public.dispatch_log (report_id, action, actor, reason)
        values (rep.id, 'no_teknisi', 'sistem',
                format('Urgensi %s, belum ada teknisi %s yang tersedia', urg, case when night then 'piket' else 'Ready' end));
      end if;
    end if;
  end loop;

  perform set_config('glowgrid.system', coalesce(nullif(prev, ''), 'off'), true);
  return n_done;
end $$;

-- ---------- 9. Pemicu dispatcher ----------
create or replace function public.trg_dispatch_after_report()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.dispatch('laporan_baru'); return null; end $$;
drop trigger if exists reports_dispatch on public.reports;
create trigger reports_dispatch after insert on public.reports
  for each statement execute function public.trg_dispatch_after_report();

create or replace function public.trg_dispatch_after_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'ready' and (old.status is distinct from 'ready' or new.capacity > old.capacity
                               or new.is_on_call is distinct from old.is_on_call) then
    perform public.dispatch('teknisi_ready');
  end if;
  return null;
end $$;
drop trigger if exists technician_status_dispatch on public.technician_status;
create trigger technician_status_dispatch after update on public.technician_status
  for each row execute function public.trg_dispatch_after_status();

create or replace function public.trg_settings_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.auto_dispatch is distinct from old.auto_dispatch then
    insert into public.dispatch_log (action, actor, reason)
    values ('mode', 'admin', case when new.auto_dispatch then 'Penugasan otomatis DIAKTIFKAN' else 'Penugasan otomatis DIMATIKAN (mode manual)' end);
  end if;
  if new.auto_dispatch then perform public.dispatch('mode_on'); end if;
  return null;
end $$;
drop trigger if exists settings_changed on public.app_settings;
create trigger settings_changed after update on public.app_settings
  for each row execute function public.trg_settings_changed();

-- ---------- 10. Penjaga update laporan (diperbarui) ----------
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
    -- kolom skor hanya diubah sistem
    new.kw_urgency := old.kw_urgency; new.urgency_notes := old.urgency_notes;
    new.ai_urgency := old.ai_urgency; new.ai_summary := old.ai_summary;
    return new;
  end if;

  if r = 'teknisi' then
    if old.technician_id is distinct from auth.uid() then raise exception 'Laporan ini bukan tugas Anda.'; end if;
    if (new.id, new.owner_id, new.reporter, new.phone, new.category, new.severity, new.description,
        new.village, new.address, new.lat, new.lng, new.technician_id, new.technician_name, new.created_at,
        new.kw_urgency, new.urgency_notes, new.ai_urgency, new.ai_summary, new.assigned_by, new.assigned_at)
       is distinct from
       (old.id, old.owner_id, old.reporter, old.phone, old.category, old.severity, old.description,
        old.village, old.address, old.lat, old.lng, old.technician_id, old.technician_name, old.created_at,
        old.kw_urgency, old.urgency_notes, old.ai_urgency, old.ai_summary, old.assigned_by, old.assigned_at) then
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

-- Setelah update laporan: catat penugasan admin & minta konfirmasi teknisi setelah selesai
create or replace function public.reports_after_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.technician_id is distinct from old.technician_id and new.technician_id is not null
     and new.assigned_by = 'admin' then
    insert into public.dispatch_log (report_id, technician_id, action, actor, reason)
    values (new.id, new.technician_id, 'assign', 'admin', format('Ditugaskan manual oleh admin ke %s', new.technician_name));
  end if;
  -- Selesai → teknisi otomatis "istirahat" sampai ia sendiri memilih status berikutnya
  if new.status = 'Selesai' and old.status is distinct from 'Selesai' and new.technician_id is not null then
    update public.technician_status set status = 'istirahat', status_changed_at = now()
     where technician_id = new.technician_id and status = 'ready';
  end if;
  return null;
end $$;
drop trigger if exists reports_after_update on public.reports;
create trigger reports_after_update after update on public.reports
  for each row execute function public.reports_after_update();

-- ---------- 11. Fungsi yang dipanggil aplikasi (RPC) ----------
-- Teknisi: ubah status sendiri
create or replace function public.set_my_status(p_status text)
returns public.technician_status language plpgsql security definer set search_path = public as $$
declare row public.technician_status;
begin
  if public.app_role() <> 'teknisi' then raise exception 'Hanya teknisi yang dapat mengubah status ini.'; end if;
  if p_status not in ('ready','fokus','istirahat','off') then raise exception 'Status tidak dikenal.'; end if;
  update public.technician_status
     set status = p_status, status_changed_at = now(), last_seen_at = now()
   where technician_id = auth.uid() returning * into row;
  return row;
end $$;

-- Teknisi: tanda masih aktif (dipanggil berkala oleh halaman teknisi)
create or replace function public.technician_heartbeat()
returns public.technician_status language plpgsql security definer set search_path = public as $$
declare row public.technician_status;
begin
  if public.app_role() <> 'teknisi' then raise exception 'Hanya untuk teknisi.'; end if;
  update public.technician_status set last_seen_at = now() where technician_id = auth.uid() returning * into row;
  return row;
end $$;

-- Teknisi: tolak tugas → kembali ke antrean, tidak akan diberikan lagi ke teknisi yang sama
create or replace function public.decline_task(p_report_id text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare rep public.reports;
begin
  if public.app_role() <> 'teknisi' then raise exception 'Hanya teknisi yang dapat menolak tugas.'; end if;
  if char_length(trim(coalesce(p_reason,''))) < 3 then raise exception 'Alasan penolakan wajib diisi.'; end if;
  select * into rep from public.reports where id = p_report_id for update;
  if rep.id is null or rep.technician_id is distinct from auth.uid() then raise exception 'Laporan ini bukan tugas Anda.'; end if;
  if rep.status <> 'Ditugaskan' then raise exception 'Tugas yang sudah dalam perjalanan tidak dapat ditolak.'; end if;
  perform set_config('glowgrid.system', 'on', true);
  update public.reports set status = 'Menunggu Verifikasi', technician_id = null, technician_name = null,
                            assigned_by = null, assigned_at = null where id = p_report_id;
  insert into public.dispatch_log (report_id, technician_id, action, actor, reason)
  values (p_report_id, auth.uid(), 'decline', 'teknisi', left(trim(p_reason), 300));
  perform set_config('glowgrid.system', 'off', true);
  perform public.dispatch('tugas_ditolak');
end $$;

-- Admin: kembalikan tugas ke antrean
create or replace function public.unassign_task(p_report_id text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare rep public.reports;
begin
  if public.app_role() <> 'admin' then raise exception 'Hanya admin.'; end if;
  select * into rep from public.reports where id = p_report_id for update;
  if rep.status not in ('Ditugaskan','Menuju Lokasi') then raise exception 'Laporan ini tidak sedang ditugaskan.'; end if;
  perform set_config('glowgrid.system', 'on', true);
  update public.reports set status = 'Menunggu Verifikasi', technician_id = null, technician_name = null,
                            assigned_by = null, assigned_at = null where id = p_report_id;
  insert into public.dispatch_log (report_id, technician_id, action, actor, reason)
  values (p_report_id, rep.technician_id, 'unassign', 'admin', coalesce(nullif(trim(p_reason),''), 'Dikembalikan ke antrean oleh admin'));
  perform set_config('glowgrid.system', 'off', true);
  perform public.dispatch('admin_unassign');
end $$;

-- Admin: saran teknisi untuk laporan tertentu (dipakai di mode manual)
create or replace function public.suggest_technicians(p_report_id text)
returns table (technician_id uuid, name text, score numeric, distance_km numeric, base_village text,
               active_load int, capacity int, is_on_call boolean, reason text)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.app_role() <> 'admin' then raise exception 'Hanya admin.'; end if;
  return query select * from public.rank_technicians(p_report_id, false) limit 5;
end $$;

-- Admin: daftar teknisi beserta status & beban
create or replace view public.technician_overview with (security_invoker = true) as
  select p.id as technician_id, p.name, p.email, ts.status, ts.capacity, ts.is_on_call,
         ts.status_changed_at, ts.last_seen_at,
         (select count(*) from public.reports r where r.technician_id = p.id
            and r.status in ('Ditugaskan','Menuju Lokasi'))::int as active_load
  from public.profiles p join public.technician_status ts on ts.technician_id = p.id
  where p.role = 'teknisi';

-- ---------- 12. Row Level Security tabel baru ----------
alter table public.app_settings      enable row level security;
alter table public.technician_status enable row level security;
alter table public.village_distance  enable row level security;
alter table public.dispatch_log      enable row level security;

drop policy if exists "settings: baca"         on public.app_settings;
drop policy if exists "settings: admin ubah"   on public.app_settings;
create policy "settings: baca" on public.app_settings for select to authenticated using (true);
create policy "settings: admin ubah" on public.app_settings for update to authenticated
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

drop policy if exists "status: teknisi baca milik sendiri" on public.technician_status;
drop policy if exists "status: admin baca semua"           on public.technician_status;
drop policy if exists "status: admin ubah"                 on public.technician_status;
create policy "status: teknisi baca milik sendiri" on public.technician_status for select to authenticated
  using (technician_id = auth.uid());
create policy "status: admin baca semua" on public.technician_status for select to authenticated
  using (public.app_role() = 'admin');
create policy "status: admin ubah" on public.technician_status for update to authenticated
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
-- teknisi mengubah statusnya lewat set_my_status(), bukan update langsung

drop policy if exists "jarak: baca" on public.village_distance;
create policy "jarak: baca" on public.village_distance for select to authenticated using (true);

drop policy if exists "log: admin baca" on public.dispatch_log;
create policy "log: admin baca" on public.dispatch_log for select to authenticated
  using (public.app_role() = 'admin');

-- ---------- 13. Hak akses ----------
revoke all on public.app_settings, public.technician_status, public.village_distance, public.dispatch_log,
              public.technician_overview from anon;
grant select, update on public.app_settings to authenticated;
grant select, update on public.technician_status to authenticated;
grant select on public.village_distance, public.dispatch_log, public.technician_overview to authenticated;
revoke insert, delete, truncate on public.app_settings, public.technician_status, public.dispatch_log from authenticated;

-- Fungsi internal: tidak boleh dipanggil langsung dari aplikasi
revoke all on function public.dispatch(text)                     from public, anon, authenticated;
revoke all on function public.rank_technicians(text, boolean)    from public, anon, authenticated;
revoke all on function public.keyword_urgency(text, int, text)   from public, anon, authenticated;
revoke all on function public.ensure_technician_status()         from public, anon, authenticated;
revoke all on function public.reports_before_insert()            from public, anon, authenticated;
revoke all on function public.reports_after_update()             from public, anon, authenticated;
revoke all on function public.trg_dispatch_after_report()        from public, anon, authenticated;
revoke all on function public.trg_dispatch_after_status()        from public, anon, authenticated;
revoke all on function public.trg_settings_changed()             from public, anon, authenticated;
revoke all on function public.guard_report_update()              from public, anon, authenticated;
revoke all on function public.is_night()                         from public, anon;
revoke all on function public.effective_urgency(public.reports)  from public, anon;
revoke all on function public.queue_priority(public.reports)     from public, anon;
-- Fungsi yang boleh dipanggil pengguna login (role dicek di dalam fungsi)
revoke all on function public.set_my_status(text), public.technician_heartbeat(),
              public.decline_task(text, text), public.unassign_task(text, text),
              public.suggest_technicians(text) from public, anon;
grant execute on function public.set_my_status(text), public.technician_heartbeat(),
                          public.decline_task(text, text), public.unassign_task(text, text),
                          public.suggest_technicians(text), public.is_night(),
                          public.effective_urgency(public.reports), public.queue_priority(public.reports)
  to authenticated;

-- ---------- 14. Isi skor untuk laporan lama ----------
update public.reports r set kw_urgency = k.score, urgency_notes = k.notes
from (select id, (public.keyword_urgency(category, severity, description)).* from public.reports) k
where r.id = k.id and r.kw_urgency is null;

-- ---------- 15. search_path tetap untuk fungsi bantu ----------
alter function public.effective_urgency(public.reports) set search_path = public;
alter function public.queue_priority(public.reports) set search_path = public;

-- ---------- 16. Pengecekan berkala tiap 5 menit (aging, jam piket, teknisi tidak aktif) ----------
-- Hanya untuk Supabase (butuh ekstensi pg_cron):
-- create extension if not exists pg_cron;
-- select cron.schedule('glowgrid-dispatch', '*/5 * * * *', $$select public.dispatch('cron')$$);
