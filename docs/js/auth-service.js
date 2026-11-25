import { DEMO_USERS } from "./common.js";
import { supabaseEnabled, getSupabase, friendlyError } from "./supabase-service.js";

const SESSION_KEY = "glowgrid_session_v2";
const EXTRA_USERS_KEY = "glowgrid_demo_users_v2";
const ROLES = ["warga", "admin", "teknisi"];

function demoUsers() { try { return [...DEMO_USERS, ...JSON.parse(localStorage.getItem(EXTRA_USERS_KEY) || "[]")]; } catch { return [...DEMO_USERS]; } }
function saveSession(user) { const safe = { uid: user.uid, name: user.name, email: user.email, role: user.role, phone: user.phone || "" }; sessionStorage.setItem(SESSION_KEY, JSON.stringify(safe)); return safe; }
function cachedSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; } }

// Ambil profil + role dari tabel public.profiles (role TIDAK pernah diambil dari input pengguna).
async function loadProfile(sb, authUser) {
  const { data, error } = await sb.from("profiles").select("id,name,email,phone,role").eq("id", authUser.id).maybeSingle();
  if (error) throw new Error(friendlyError(error));
  if (!data) return null;
  return { uid: data.id, name: data.name, email: data.email || authUser.email, phone: data.phone || "", role: data.role };
}

export async function login(email, password) {
  if (!supabaseEnabled) {
    const user = demoUsers().find(x => x.email.toLowerCase() === email.trim().toLowerCase() && x.password === password);
    if (!user) throw new Error("Email atau kata sandi tidak cocok.");
    return saveSession(user);
  }
  const sb = await getSupabase();
  const { data, error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error) throw new Error(friendlyError(error));
  const profile = await loadProfile(sb, data.user);
  if (!profile) { await sb.auth.signOut(); throw new Error("Profil pengguna belum tersedia di database."); }
  if (!ROLES.includes(profile.role)) { await sb.auth.signOut(); throw new Error("Role akun tidak valid."); }
  return saveSession(profile);
}

export async function register({ name, email, phone, password }) {
  if (!supabaseEnabled) {
    const users = demoUsers(); if (users.some(x => x.email.toLowerCase() === email.trim().toLowerCase())) throw new Error("Email sudah terdaftar.");
    const user = { uid: `demo-${Date.now()}`, name: name.trim(), email: email.trim().toLowerCase(), phone: phone.trim(), password, role: "warga" };
    const extra = JSON.parse(localStorage.getItem(EXTRA_USERS_KEY) || "[]"); extra.push(user); localStorage.setItem(EXTRA_USERS_KEY, JSON.stringify(extra)); return saveSession(user);
  }
  const sb = await getSupabase();
  // Profil dibuat otomatis oleh trigger handle_new_user() dengan role "warga".
  const { data, error } = await sb.auth.signUp({
    email: email.trim().toLowerCase(), password,
    options: { data: { name: name.trim(), phone: phone.trim() } }
  });
  if (error) throw new Error(friendlyError(error));
  if (!data.session) return { needsConfirmation: true };
  const profile = await loadProfile(sb, data.user);
  if (!profile) throw new Error("Akun dibuat, tetapi profil belum tersedia. Pastikan schema.sql sudah dijalankan.");
  return saveSession(profile);
}

export async function currentUser() {
  if (!supabaseEnabled) return cachedSession();
  const sb = await getSupabase();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { sessionStorage.removeItem(SESSION_KEY); return null; }
  const profile = await loadProfile(sb, session.user).catch(() => null);
  if (!profile || !ROLES.includes(profile.role)) return null;
  return saveSession(profile);
}

export function pageFor(role) { return role === "admin" ? "admin.html" : role === "teknisi" ? "teknisi.html" : "warga.html"; }

export async function requireRole(required) {
  const user = await currentUser();
  if (!user) { location.replace(`index.html?reason=login&next=${required}`); return null; }
  if (user.role !== required) { location.replace(`${pageFor(user.role)}?reason=forbidden`); return null; }
  return user;
}

export async function logout() {
  if (supabaseEnabled) { const sb = await getSupabase(); await sb.auth.signOut(); }
  sessionStorage.removeItem(SESSION_KEY); location.replace("index.html");
}
