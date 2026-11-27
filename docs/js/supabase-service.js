import { SUPABASE_URL, SUPABASE_ANON_KEY, supabaseEnabled } from "./supabase-config.js";

let client = null;

export async function getSupabase() {
  if (!supabaseEnabled) return null;
  if (client) return client;
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  // Sesi login disimpan per TAB (sessionStorage), bukan per browser.
  // Dengan begitu tab Warga, Admin, dan Teknisi bisa dibuka berdampingan tanpa saling menimpa sesi.
  // Sesi tetap bertahan saat halaman di-refresh; menutup tab berarti keluar.
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
            storage: window.sessionStorage, storageKey: "glowgrid-auth-tab" }
  });
  return client;
}

// Ubah pesan error Supabase menjadi bahasa Indonesia yang ramah pengguna.
export function friendlyError(error, fallback = "Terjadi kesalahan. Silakan coba lagi.") {
  const msg = String(error?.message || error || "");
  if (/invalid login credentials/i.test(msg)) return "Email atau kata sandi tidak cocok.";
  if (/email not confirmed/i.test(msg)) return "Email belum dikonfirmasi. Periksa kotak masuk email Anda.";
  if (/already registered|already exists/i.test(msg)) return "Email sudah terdaftar.";
  if (/password should be at least/i.test(msg)) return "Kata sandi terlalu pendek.";
  if (/rate limit|too many/i.test(msg)) return "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.";
  if (/row-level security|permission denied|violates/i.test(msg)) return "Akses ditolak: role akun Anda tidak diizinkan melakukan aksi ini.";
  if (/failed to fetch|network/i.test(msg)) return "Tidak dapat terhubung ke server. Periksa koneksi internet.";
  return msg || fallback;
}

export { supabaseEnabled };
