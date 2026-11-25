-- =====================================================================
-- GlowGrid · Skema database Supabase
-- Jalankan SEKALI di Supabase Dashboard → SQL Editor → New query → Run.
-- Aman dijalankan ulang (idempotent).
-- =====================================================================

-- ---------- 1. Tabel profil pengguna (role disimpan di sini) ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null default '',
  email       text,
  phone       text default '',
  role        text not null default 'warga' check (role in ('warga','admin','teknisi')),
  created_at  timestamptz not null default now()
);

-- ---------- 2. Tabel laporan ----------
create table if not exists public.reports (
  id               text primary key,
  owner_id         uuid not null references public.profiles(id) on delete cascade,
  reporter         text not null,
  phone            text,
  category         text not null check (category in ('Lampu padam','Menyala pada siang hari','Penerangan kurang','Tiang/kabel bermasalah')),
  severity         smallint not null check (severity between 1 and 3),
  description      text not null check (char_length(description) >= 15),
  village          text not null check (village in ('Babat Jerawat','Benowo','Pakal','Sumber Rejo')),
  address          text not null,
  lat              double precision not null check (lat between -90 and 90),
  lng              double precision not null check (lng between -180 and 180),
  status           text not null default 'Menunggu Verifikasi'
                   check (status in ('Menunggu Verifikasi','Ditugaskan','Menuju Lokasi','Selesai','Ditolak')),
  technician_id    uuid references public.profiles(id) on delete set null,
  technician_name  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists reports_owner_idx      on public.reports(owner_id);
create index if not exists reports_technician_idx on public.reports(technician_id);
create index if not exists reports_status_idx     on public.reports(status, created_at);

-- ---------- 3. Fungsi bantu: role pengguna yang sedang login ----------
-- SECURITY DEFINER supaya tidak terkena RLS (mencegah rekursi policy).
create or replace function public.app_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;
grant execute on function public.app_role() to authenticated;

-- ---------- 4. Profil otomatis saat registrasi (selalu "warga") ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    lower(new.email),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    'warga'                         -- role dari form TIDAK pernah dipercaya
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 5. Penjaga perubahan profil ----------
-- Hanya admin (atau SQL Editor / service role) yang boleh mengubah role & email.
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.app_role() = 'admin' then return new; end if;
  if new.role is distinct from old.role then raise exception 'Role hanya dapat diubah oleh admin.'; end if;
  if new.email is distinct from old.email then raise exception 'Email tidak dapat diubah dari aplikasi.'; end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------- 6. Penjaga perubahan laporan ----------
create or replace function public.guard_report_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare r text := public.app_role();
begin
  new.updated_at := now();
  if auth.uid() is null then return new; end if;               -- SQL Editor / service role

  if r = 'admin' then
    -- Admin: verifikasi FIFO → Ditugaskan (wajib teknisi) atau Ditolak
    if new.status = 'Ditugaskan' then
      if new.technician_id is null
         or not exists (select 1 from public.profiles where id = new.technician_id and role = 'teknisi') then
        raise exception 'Teknisi yang dipilih tidak valid.';
      end if;
    end if;
    return new;
  end if;

  if r = 'teknisi' then
    if old.technician_id is distinct from auth.uid() then raise exception 'Laporan ini bukan tugas Anda.'; end if;
    -- Teknisi hanya boleh mengubah kolom status
    if (new.id, new.owner_id, new.reporter, new.phone, new.category, new.severity, new.description,
        new.village, new.address, new.lat, new.lng, new.technician_id, new.technician_name, new.created_at)
       is distinct from
       (old.id, old.owner_id, old.reporter, old.phone, old.category, old.severity, old.description,
        old.village, old.address, old.lat, old.lng, old.technician_id, old.technician_name, old.created_at) then
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
drop trigger if exists reports_guard on public.reports;
create trigger reports_guard before update on public.reports
  for each row execute function public.guard_report_update();

-- ---------- 7. Row Level Security (aturan akses per role) ----------
alter table public.profiles enable row level security;
alter table public.reports  enable row level security;

-- PROFILES
drop policy if exists "profil: baca milik sendiri"   on public.profiles;
drop policy if exists "profil: admin baca semua"     on public.profiles;
drop policy if exists "profil: ubah milik sendiri"   on public.profiles;
drop policy if exists "profil: admin ubah semua"     on public.profiles;

create policy "profil: baca milik sendiri" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "profil: admin baca semua" on public.profiles
  for select to authenticated using (public.app_role() = 'admin');
create policy "profil: ubah milik sendiri" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "profil: admin ubah semua" on public.profiles
  for update to authenticated using (public.app_role() = 'admin') with check (true);
-- Tidak ada policy INSERT/DELETE: profil hanya dibuat oleh trigger.

-- REPORTS
drop policy if exists "laporan: warga baca milik sendiri"  on public.reports;
drop policy if exists "laporan: teknisi baca tugasnya"     on public.reports;
drop policy if exists "laporan: admin baca semua"          on public.reports;
drop policy if exists "laporan: warga buat laporan"        on public.reports;
drop policy if exists "laporan: admin ubah"                on public.reports;
drop policy if exists "laporan: teknisi ubah tugasnya"     on public.reports;

create policy "laporan: warga baca milik sendiri" on public.reports
  for select to authenticated using (owner_id = auth.uid());
create policy "laporan: teknisi baca tugasnya" on public.reports
  for select to authenticated using (technician_id = auth.uid() and public.app_role() = 'teknisi');
create policy "laporan: admin baca semua" on public.reports
  for select to authenticated using (public.app_role() = 'admin');

create policy "laporan: warga buat laporan" on public.reports
  for insert to authenticated with check (
    public.app_role() = 'warga'
    and owner_id = auth.uid()
    and status = 'Menunggu Verifikasi'
    and technician_id is null
  );

create policy "laporan: admin ubah" on public.reports
  for update to authenticated using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
create policy "laporan: teknisi ubah tugasnya" on public.reports
  for update to authenticated
  using (technician_id = auth.uid() and public.app_role() = 'teknisi')
  with check (technician_id = auth.uid());
-- Tidak ada policy DELETE: laporan tidak bisa dihapus dari aplikasi.

grant select, update on public.profiles to authenticated;
grant select, insert, update on public.reports to authenticated;

-- ---------- 8. Kunci izin bawaan Supabase ----------
-- Fungsi internal tidak boleh dipanggil langsung lewat API (RPC).
revoke all on function public.handle_new_user()       from public, anon, authenticated;
revoke all on function public.guard_profile_update()  from public, anon, authenticated;
revoke all on function public.guard_report_update()   from public, anon, authenticated;
revoke all on function public.app_role()              from public, anon;
grant execute on function public.app_role() to authenticated;
-- Pengguna anonim tidak punya akses tabel; pengguna login tidak bisa insert/hapus profil atau hapus laporan.
revoke all on public.profiles, public.reports from anon;
revoke insert, delete, truncate on public.profiles from authenticated;
revoke delete, truncate on public.reports from authenticated;
