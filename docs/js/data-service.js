import { SAMPLE_REPORTS, DEMO_USERS } from "./common.js";
import { supabaseEnabled, getSupabase, friendlyError } from "./supabase-service.js";

const REPORT_KEY = "glowgrid_reports_v2";
function loadLocal() { try { const v = JSON.parse(localStorage.getItem(REPORT_KEY)); if (Array.isArray(v)) return v; } catch {} const seed = structuredClone(SAMPLE_REPORTS); localStorage.setItem(REPORT_KEY, JSON.stringify(seed)); return seed; }
function saveLocal(v) { localStorage.setItem(REPORT_KEY, JSON.stringify(v)); }

// Kolom database (snake_case) <-> objek aplikasi (camelCase)
function fromRow(r) {
  return {
    id: r.id, ownerId: r.owner_id, reporter: r.reporter, phone: r.phone, category: r.category,
    severity: r.severity, description: r.description, village: r.village, address: r.address,
    lat: r.lat, lng: r.lng, status: r.status, technicianId: r.technician_id || "",
    technicianName: r.technician_name || "", createdAt: r.created_at, updatedAt: r.updated_at
  };
}
const FIELD_MAP = { status: "status", technicianId: "technician_id", technicianName: "technician_name" };
function toRowChanges(changes) {
  const row = {};
  for (const [k, v] of Object.entries(changes)) if (FIELD_MAP[k]) row[FIELD_MAP[k]] = v === "" ? null : v;
  return row;
}
function newId() { return `GGR-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`; }

export async function listReports(user) {
  if (!supabaseEnabled) { const all = loadLocal(); return user.role === "admin" ? all : user.role === "teknisi" ? all.filter(r => r.technicianId === user.uid) : all.filter(r => r.ownerId === user.uid); }
  const sb = await getSupabase();
  let q = sb.from("reports").select("*").order("created_at", { ascending: false });
  // Filter ini untuk efisiensi; batas akses sebenarnya ditegakkan oleh RLS di database.
  if (user.role === "teknisi") q = q.eq("technician_id", user.uid);
  else if (user.role === "warga") q = q.eq("owner_id", user.uid);
  const { data, error } = await q;
  if (error) throw new Error(friendlyError(error));
  return data.map(fromRow);
}

export async function createReport(user, payload) {
  const id = newId();
  const report = { ...payload, ownerId: user.uid, reporter: user.name, phone: payload.phone || user.phone, status: "Menunggu Verifikasi", technicianId: "", technicianName: "", createdAt: new Date().toISOString() };
  if (!supabaseEnabled) { const all = loadLocal(); all.push({ id, ...report }); saveLocal(all); return { id, ...report }; }
  const sb = await getSupabase();
  const { data, error } = await sb.from("reports").insert({
    id, owner_id: user.uid, reporter: user.name, phone: report.phone, category: payload.category,
    severity: payload.severity, description: payload.description, village: payload.village,
    address: payload.address, lat: payload.lat, lng: payload.lng
  }).select().single();
  if (error) throw new Error(friendlyError(error, "Laporan gagal dikirim."));
  return fromRow(data);
}

export async function updateReport(id, changes) {
  if (!supabaseEnabled) { const all = loadLocal(), i = all.findIndex(r => r.id === id); if (i < 0) throw new Error("Laporan tidak ditemukan."); all[i] = { ...all[i], ...changes, updatedAt: new Date().toISOString() }; saveLocal(all); return all[i]; }
  const sb = await getSupabase();
  const { data, error } = await sb.from("reports").update(toRowChanges(changes)).eq("id", id).select();
  if (error) throw new Error(friendlyError(error, "Perubahan gagal disimpan."));
  if (!data.length) throw new Error("Laporan tidak ditemukan atau Anda tidak berhak mengubahnya.");
  return fromRow(data[0]);
}

export async function listTechnicians() {
  if (!supabaseEnabled) return DEMO_USERS.filter(x => x.role === "teknisi").map(({ uid, name, email }) => ({ uid, name, email }));
  const sb = await getSupabase();
  const { data, error } = await sb.from("profiles").select("id,name,email").eq("role", "teknisi").order("name");
  if (error) throw new Error(friendlyError(error));
  return data.map(d => ({ uid: d.id, name: d.name, email: d.email }));
}
