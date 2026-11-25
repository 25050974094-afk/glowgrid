-- =====================================================================
-- GlowGrid · Akun demo untuk tiap role + contoh laporan
-- Jalankan SETELAH schema.sql, di Supabase Dashboard → SQL Editor.
-- Aman dijalankan ulang: akun yang sudah ada tidak dibuat dua kali.
--
--   warga@glowgrid.demo    / Warga123!    → warga
--   admin@glowgrid.demo    / Admin123!    → admin
--   teknisi@glowgrid.demo  / Teknisi123!  → teknisi (Arif Nugroho)
--   dinda@glowgrid.demo    / Teknisi123!  → teknisi (Dinda Maharani)
--   raka@glowgrid.demo     / Teknisi123!  → teknisi (Raka Pratama)
--
-- Ganti kata sandi ini sebelum aplikasi dipakai di luar kelas/demo.
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

create or replace function pg_temp.make_user(p_email text, p_password text, p_name text, p_phone text, p_role text)
returns uuid language plpgsql as $$
declare uid uuid;
begin
  select id into uid from auth.users where email = p_email;
  if uid is null then
    uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', p_email,
      extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('name', p_name, 'phone', p_phone), now(), now(),
      '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text,
            jsonb_build_object('sub', uid::text, 'email', p_email, 'email_verified', true),
            'email', now(), now(), now());
  end if;
  -- Trigger handle_new_user() membuat profil "warga"; tetapkan role sebenarnya di sini.
  insert into public.profiles (id, name, email, phone, role)
  values (uid, p_name, p_email, p_phone, p_role)
  on conflict (id) do update set name = excluded.name, phone = excluded.phone, role = excluded.role;
  return uid;
end $$;

do $$
declare
  w uuid; a uuid; t1 uuid; t2 uuid; t3 uuid;
begin
  w  := pg_temp.make_user('warga@glowgrid.demo',   'Warga123!',   'Warga Demo',     '081234567890', 'warga');
  a  := pg_temp.make_user('admin@glowgrid.demo',   'Admin123!',   'Admin GlowGrid', '',             'admin');
  t1 := pg_temp.make_user('teknisi@glowgrid.demo', 'Teknisi123!', 'Arif Nugroho',   '',             'teknisi');
  t2 := pg_temp.make_user('dinda@glowgrid.demo',   'Teknisi123!', 'Dinda Maharani', '',             'teknisi');
  t3 := pg_temp.make_user('raka@glowgrid.demo',    'Teknisi123!', 'Raka Pratama',   '',             'teknisi');

  insert into public.reports (id, owner_id, reporter, phone, category, severity, description, village, address, lat, lng, status, technician_id, technician_name, created_at) values
    ('GGR-2601', w, 'Warga Demo', '081234567890', 'Lampu padam', 3, 'Dua lampu jalan padam dan bagian tikungan sangat gelap pada malam hari.', 'Babat Jerawat', 'Jl. Raya Babat Jerawat, dekat RW 06', -7.2424, 112.6278, 'Menunggu Verifikasi', null, null, '2026-11-23 08:12+07'),
    ('GGR-2602', w, 'Warga Demo', '081234567890', 'Penerangan kurang', 2, 'Jarak antarlampu cukup jauh sehingga jalur pejalan kaki kurang terang.', 'Sumber Rejo', 'Jalan Sumber Rejo sisi utara', -7.2170, 112.6083, 'Menunggu Verifikasi', null, null, '2026-11-23 08:38+07'),
    ('GGR-2603', w, 'Warga Demo', '081234567890', 'Menyala pada siang hari', 1, 'Satu lampu tetap menyala sejak pagi di sekitar akses permukiman.', 'Pakal', 'Jl. Pakal Madya, dekat pertigaan', -7.2392, 112.6204, 'Ditugaskan', t1, 'Arif Nugroho', '2026-11-22 17:20+07'),
    ('GGR-2604', w, 'Warga Demo', '081234567890', 'Tiang/kabel bermasalah', 3, 'Penutup kabel pada tiang terlihat terbuka. Mohon dilakukan pemeriksaan petugas.', 'Benowo', 'Dekat Stasiun Benowo', -7.2342, 112.6152, 'Menuju Lokasi', t2, 'Dinda Maharani', '2026-11-22 16:05+07'),
    ('GGR-2605', w, 'Warga Demo', '081234567890', 'Lampu padam', 2, 'Lampu di depan fasilitas olahraga padam dan sudah diperiksa secara visual oleh warga.', 'Babat Jerawat', 'Akses Taman Cahaya', -7.2413, 112.6229, 'Selesai', t3, 'Raka Pratama', '2026-11-21 19:42+07')
  on conflict (id) do nothing;
end $$;

-- ---------------------------------------------------------------------
-- Menjadikan akun lain admin/teknisi (akun daftar dulu lewat register.html):
--   update public.profiles set role = 'teknisi' where email = 'nama@email.com';
--   update public.profiles set role = 'admin'   where email = 'nama@email.com';
-- ---------------------------------------------------------------------
