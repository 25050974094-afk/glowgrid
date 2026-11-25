// Project Supabase: glowgrid (region Singapura, ap-southeast-1)
// Kunci di bawah adalah kunci "publishable" — AMAN untuk frontend karena akses
// dibatasi oleh Row Level Security di database.
// JANGAN pernah menaruh kunci "service_role" / "secret" di sini.
// Kosongkan kedua nilai untuk kembali ke mode demo localStorage.
export const SUPABASE_URL = "https://wtjsvafnptqsoqzjbuub.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_7eRXLQXc2bHo6EOB86g8Zw_OoJc5R__";

export const supabaseEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
