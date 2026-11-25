# GlowGrid · Koneksi Supabase & Login per Role

## Struktur
```
docs/                      ← website (bisa di-host di GitHub Pages)
  js/supabase-config.js    ← ISI URL & anon key di sini
  js/supabase-service.js   ← klien Supabase + pesan error bahasa Indonesia
  js/auth-service.js       ← login, register, cek role, logout
  js/data-service.js       ← CRUD laporan & daftar teknisi
supabase/
  schema.sql               ← tabel, trigger, Row Level Security
  seed.sql                 ← akun demo tiap role + 5 contoh laporan
```

## Status: SUDAH TERHUBUNG
Project Supabase **glowgrid** (`wtjsvafnptqsoqzjbuub`, region Singapura) sudah dibuat.
Skema, RLS, dan akun demo sudah terpasang, dan `docs/js/supabase-config.js` sudah terisi.
Langkah 1–3 di bawah **tidak perlu** dilakukan lagi. Yang masih perlu dilakukan hanya langkah 4 dan 5.

## Langkah setup manual (hanya untuk project baru)
1. **Buat project** di https://supabase.com → New project.
2. **Jalankan SQL**: Dashboard → *SQL Editor* → New query → tempel isi `supabase/schema.sql` → **Run**.
   Lalu query baru → tempel `supabase/seed.sql` → **Run**.
3. **Ambil kunci API**: *Project Settings → API* → salin **Project URL** dan kunci **anon / publishable**
   ke `docs/js/supabase-config.js`. Jangan pakai kunci `service_role`/secret.
4. **Pengaturan Auth** (*Authentication → Sign In / Providers → Email*):
   - Untuk demo kelas, matikan **Confirm email** supaya warga baru bisa langsung masuk.
     Kalau tetap aktif, pengguna diarahkan ke halaman login dan diminta konfirmasi email dulu.
   - *Authentication → URL Configuration*: isi **Site URL** dengan alamat website,
     misalnya `https://username.github.io/glowgrid/`.
5. Buka `docs/index.html` lewat server (Live Server di VS Code, `npx serve docs`, atau GitHub Pages).
   Jangan dibuka langsung sebagai `file://`, karena modul JS tidak akan jalan.
   Banner login harus menampilkan **"Supabase aktif"**.

## Akun demo (dari seed.sql)
| Role    | Email                  | Kata sandi   | Halaman       |
|---------|------------------------|--------------|---------------|
| Warga   | warga@glowgrid.demo    | Warga123!    | warga.html    |
| Admin   | admin@glowgrid.demo    | Admin123!    | admin.html    |
| Teknisi | teknisi@glowgrid.demo  | Teknisi123!  | teknisi.html  |
| Teknisi | dinda@glowgrid.demo    | Teknisi123!  | teknisi.html  |
| Teknisi | raka@glowgrid.demo     | Teknisi123!  | teknisi.html  |

## Cara kerja login per role
- Role disimpan di tabel `public.profiles`, **bukan** di form atau browser.
- Registrasi selalu membuat role **warga** (dipaksa oleh trigger `handle_new_user`).
- Setelah login, aplikasi membaca role dan mengarahkan ke halamannya. Setiap halaman memanggil
  `requireRole(...)`; kalau role tidak cocok, pengguna dipindah ke halamannya sendiri.
- Batas akses yang sebenarnya ditegakkan **di database** (RLS + trigger), jadi tidak bisa dibobol lewat DevTools:

| Aksi                                     | Warga | Admin | Teknisi            |
|------------------------------------------|:-----:|:-----:|:------------------:|
| Lihat laporan                            | miliknya | semua | yang ditugaskan |
| Buat laporan                             | ✓ (status awal wajib "Menunggu Verifikasi") | – | – |
| Verifikasi / tugaskan / tolak            | – | ✓ (teknisi harus ber-role teknisi) | – |
| Ubah status                              | – | ✓ | Ditugaskan → Menuju Lokasi → Selesai |
| Ubah kolom lain laporan                  | – | ✓ | ✗ |
| Ubah role pengguna                       | ✗ | ✓ | ✗ |
| Hapus laporan                            | ✗ | ✗ | ✗ |

## Menambah admin / teknisi baru
Minta orangnya mendaftar lewat `register.html`, lalu jalankan di SQL Editor:
```sql
update public.profiles set role = 'teknisi' where email = 'nama@email.com';
```

## Mode demo offline
Kalau `supabase-config.js` dikosongkan, aplikasi kembali ke mode demo dengan localStorage seperti sebelumnya.
