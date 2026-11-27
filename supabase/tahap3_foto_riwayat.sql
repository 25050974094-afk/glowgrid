-- =====================================================================
-- GlowGrid · Tahap 3: foto laporan, foto bukti perbaikan, riwayat status
-- Dijalankan SETELAH tahap2_ai.sql. Aman dijalankan ulang.
--
-- Foto disimpan di Supabase Storage (bucket privat "report-photos"):
--   warga   : <uid warga>/<id laporan>/laporan-<waktu>.jpg   (sebelum laporan dikirim)
--   teknisi : <uid teknisi>/<id laporan>/bukti-<waktu>.jpg    (wajib sebelum "Selesai")
-- =====================================================================

-- ---------- 1. Kolom foto ----------
alter table public.reports
  add column if not exists photo_path text,
  add column if not exists proof_path text;

-- ---------- 2. Riwayat status (untuk timeline warga) ----------
create table if not exists public.report_events (
  id          bigint generated always as identity primary key,
  report_id   text not null references public.reports(id) on delete cascade,
  status      text not null,
  note        text,
  actor       text not null check (actor in ('warga','admin','teknisi','sistem')),
  created_at  timestamptz not null default now()
);
create index if not exists report_events_report_idx on public.report_events(report_id, created_at);

create or replace function public.trg_report_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text;
begin
  who := case when current_setting('glowgrid.system', true) = 'on' or auth.uid() is null then 'sistem'
              else coalesce(public.app_role(), 'sistem') end;
  if tg_op = 'INSERT' then
    insert into public.report_events (report_id, status, note, actor)
    values (new.id, new.status, 'Laporan dikirim', 'warga');
  elsif new.status is distinct from old.status then
    insert into public.report_events (report_id, status, note, actor)
    values (new.id, new.status,
      case
        when new.status = 'Ditugaskan' then format('Ditugaskan ke %s%s', new.technician_name,
                                                  case when new.assigned_by = 'sistem' then ' (otomatis)' else '' end)
        when new.status = 'Menuju Lokasi' then format('%s menuju lokasi', new.technician_name)
        when new.status = 'Selesai' then format('Diperbaiki oleh %s', coalesce(new.technician_name, 'teknisi'))
        when new.status = 'Ditolak' then 'Laporan ditolak setelah verifikasi'
        when new.status = 'Menunggu Verifikasi' then 'Dikembalikan ke antrean untuk teknisi lain'
        else null end,
      case when who in ('warga','admin','teknisi','sistem') then who else 'sistem' end);
  end if;
  return null;
end $$;
drop trigger if exists reports_events on public.reports;
create trigger reports_events after insert or update of status on public.reports
  for each row execute function public.trg_report_events();

-- Isi riwayat untuk laporan lama (sekali saja)
insert into public.report_events (report_id, status, note, actor, created_at)
select r.id, 'Menunggu Verifikasi', 'Laporan dikirim', 'warga', r.created_at
from public.reports r where not exists (select 1 from public.report_events e where e.report_id = r.id);
insert into public.report_events (report_id, status, note, actor, created_at)
select r.id, 'Ditugaskan', format('Ditugaskan ke %s', r.technician_name), coalesce(r.assigned_by, 'admin'),
       coalesce(r.assigned_at, r.created_at + interval '1 minute')
from public.reports r
where r.technician_id is not null and r.status in ('Ditugaskan','Menuju Lokasi','Selesai')
  and not exists (select 1 from public.report_events e where e.report_id = r.id and e.status = 'Ditugaskan');
insert into public.report_events (report_id, status, note, actor, created_at)
select r.id, 'Menuju Lokasi', format('%s menuju lokasi', r.technician_name), 'teknisi',
       coalesce(r.assigned_at, r.created_at) + interval '2 minutes'
from public.reports r
where r.status in ('Menuju Lokasi','Selesai') and r.technician_id is not null
  and not exists (select 1 from public.report_events e where e.report_id = r.id and e.status = 'Menuju Lokasi')
  and r.status = 'Menuju Lokasi';
insert into public.report_events (report_id, status, note, actor, created_at)
select r.id, r.status, case when r.status = 'Selesai' then format('Diperbaiki oleh %s', coalesce(r.technician_name, 'teknisi'))
                            else 'Laporan ditolak setelah verifikasi' end,
       case when r.status = 'Selesai' then 'teknisi' else 'admin' end, coalesce(r.completed_at, r.updated_at)
from public.reports r
where r.status in ('Selesai','Ditolak')
  and not exists (select 1 from public.report_events e where e.report_id = r.id and e.status = r.status);

alter table public.report_events enable row level security;
drop policy if exists "riwayat: baca" on public.report_events;
create policy "riwayat: baca" on public.report_events for select to authenticated using (
  public.app_role() = 'admin'
  or exists (select 1 from public.reports r where r.id = report_id
             and (r.owner_id = auth.uid() or r.technician_id = auth.uid())));
revoke all on public.report_events from anon;
revoke insert, update, delete, truncate on public.report_events from authenticated;
grant select on public.report_events to authenticated;
revoke all on function public.trg_report_events() from public, anon, authenticated;

-- ---------- 3. Laporan baru: validasi jalur foto ----------
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
  -- foto warga hanya boleh berada di folder <uid pelapor>/<id laporan>/laporan-...
  if new.photo_path is not null and new.photo_path !~ ('^' || new.owner_id::text || '/' || new.id || '/laporan-[^/]+$') then
    new.photo_path := null;
  end if;
  new.proof_path := null;
  return new;
end $$;

-- ---------- 4. Penjaga update: teknisi wajib foto bukti untuk "Selesai" ----------
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
    new.kw_urgency := old.kw_urgency; new.urgency_notes := old.urgency_notes;
    new.ai_urgency := old.ai_urgency; new.ai_summary := old.ai_summary; new.ai_reason := old.ai_reason;
    new.ai_flags := old.ai_flags; new.ai_duplicate_of := old.ai_duplicate_of; new.ai_category := old.ai_category;
    new.ai_status := old.ai_status; new.ai_attempts := old.ai_attempts; new.ai_model := old.ai_model;
    new.ai_error := old.ai_error; new.ai_analyzed_at := old.ai_analyzed_at;
    new.photo_path := old.photo_path; new.proof_path := old.proof_path;
    return new;
  end if;

  if r = 'teknisi' then
    if old.technician_id is distinct from auth.uid() then raise exception 'Laporan ini bukan tugas Anda.'; end if;
    if (new.id, new.owner_id, new.reporter, new.phone, new.category, new.severity, new.description,
        new.village, new.address, new.lat, new.lng, new.technician_id, new.technician_name, new.created_at,
        new.kw_urgency, new.urgency_notes, new.ai_urgency, new.ai_summary, new.assigned_by, new.assigned_at,
        new.ai_status, new.ai_attempts, new.ai_reason, new.ai_flags, new.ai_duplicate_of, new.ai_category,
        new.ai_model, new.ai_error, new.ai_analyzed_at, new.photo_path)
       is distinct from
       (old.id, old.owner_id, old.reporter, old.phone, old.category, old.severity, old.description,
        old.village, old.address, old.lat, old.lng, old.technician_id, old.technician_name, old.created_at,
        old.kw_urgency, old.urgency_notes, old.ai_urgency, old.ai_summary, old.assigned_by, old.assigned_at,
        old.ai_status, old.ai_attempts, old.ai_reason, old.ai_flags, old.ai_duplicate_of, old.ai_category,
        old.ai_model, old.ai_error, old.ai_analyzed_at, old.photo_path) then
      raise exception 'Teknisi hanya dapat mengubah status laporan.';
    end if;
    if not ((old.status = 'Ditugaskan'    and new.status in ('Menuju Lokasi','Selesai'))
         or (old.status = 'Menuju Lokasi' and new.status = 'Selesai')) then
      raise exception 'Perubahan status % → % tidak diizinkan.', old.status, new.status;
    end if;
    -- foto bukti: hanya saat menyelesaikan, dan harus di folder teknisi sendiri untuk laporan ini
    if new.proof_path is distinct from old.proof_path and new.status <> 'Selesai' then
      raise exception 'Foto bukti hanya dikirim saat menyelesaikan tugas.';
    end if;
    if new.status = 'Selesai' then
      if new.proof_path is null or new.proof_path !~ ('^' || auth.uid()::text || '/' || old.id || '/bukti-[^/]+$') then
        raise exception 'Foto bukti perbaikan wajib diunggah sebelum menandai selesai.';
      end if;
    end if;
    return new;
  end if;

  raise exception 'Role Anda tidak dapat mengubah laporan.';
end $$;

-- ---------- 5. Storage: bucket privat + aturan akses ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-photos', 'report-photos', false, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                                allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "foto: unggah" on storage.objects;
drop policy if exists "foto: lihat"  on storage.objects;
create policy "foto: unggah" on storage.objects for insert to authenticated with check (
  bucket_id = 'report-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
  and (
    (public.app_role() = 'warga' and name ~ '^[^/]+/[^/]+/laporan-[^/]+$')
    or (public.app_role() = 'teknisi' and name ~ '^[^/]+/[^/]+/bukti-[^/]+$'
        and exists (select 1 from public.reports r where r.id = (storage.foldername(name))[2]
                    and r.technician_id = auth.uid() and r.status in ('Ditugaskan','Menuju Lokasi')))
  ));
create policy "foto: lihat" on storage.objects for select to authenticated using (
  bucket_id = 'report-photos'
  and (
    public.app_role() = 'admin'
    or (storage.foldername(name))[1] = auth.uid()::text
    or exists (select 1 from public.reports r where r.id = (storage.foldername(name))[2]
               and (r.owner_id = auth.uid() or r.technician_id = auth.uid()))
  ));
-- Tidak ada policy update/delete: foto tidak bisa diganti atau dihapus dari aplikasi.
