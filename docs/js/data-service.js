import { SAMPLE_REPORTS, DEMO_USERS } from "./common.js";
import { supabaseEnabled, getSupabase, friendlyError } from "./supabase-service.js";

const REPORT_KEY = "glowgrid_reports_v2";
function loadLocal() { try { const v = JSON.parse(localStorage.getItem(REPORT_KEY)); if (Array.isArray(v)) return v; } catch {} const seed = structuredClone(SAMPLE_REPORTS); localStorage.setItem(REPORT_KEY, JSON.stringify(seed)); return seed; }
function saveLocal(v) { localStorage.setItem(REPORT_KEY, JSON.stringify(v)); }

// Kolom database (snake_case) <-> objek aplikasi (camelCase)
function fromRow(r) {
  const urgency = r.ai_urgency ?? r.kw_urgency ?? (Number(r.severity) * 25);
  return {
    id: r.id, ownerId: r.owner_id, reporter: r.reporter, phone: r.phone, category: r.category,
    severity: r.severity, description: r.description, village: r.village, address: r.address,
    lat: r.lat, lng: r.lng, status: r.status, technicianId: r.technician_id || "",
    technicianName: r.technician_name || "", createdAt: r.created_at, updatedAt: r.updated_at,
    kwUrgency: r.kw_urgency, aiUrgency: r.ai_urgency, aiSummary: r.ai_summary || "",
    urgencyNotes: r.urgency_notes || [], urgency, assignedBy: r.assigned_by || "",
    assignedAt: r.assigned_at, completedAt: r.completed_at
  };
}
// Prioritas antrean = urgensi + aging (+10 per jam menunggu, maks +40) — sama dengan queue_priority() di database
export function queuePriority(r) {
  const urgency = r.urgency ?? r.aiUrgency ?? r.kwUrgency ?? Number(r.severity) * 25;
  const hours = Math.max(0, (Date.now() - new Date(r.createdAt).getTime()) / 3.6e6);
  return urgency + Math.min(40, hours * 10);
}
const FIELD_MAP = { status: "status", technicianId: "technician_id", technicianName: "technician_name" };
function toRowChanges(changes) {
  const row = {};
  for (const [k, v] of Object.entries(changes)) if (FIELD_MAP[k]) row[FIELD_MAP[k]] = v === "" ? null : v;
  return row;
}
function newId() { return `GGR-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`; }

export async function listReports(user) {
  if (!supabaseEnabled) { const all = loadLocal().map(r => ({ urgencyNotes: [], ...r, urgency: r.urgency ?? Number(r.severity) * 25 })); return user.role === "admin" ? all : user.role === "teknisi" ? all.filter(r => r.technicianId === user.uid) : all.filter(r => r.ownerId === user.uid); }
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

// =====================================================================
// Tahap 1 · status teknisi, pengaturan dispatcher, saran & log
// (fitur ini membutuhkan Supabase; mode demo hanya menyediakan versi sederhana)
// =====================================================================
const DEMO_STATUS_KEY = "glowgrid_demo_tech_status";
function demoStatuses() { try { return JSON.parse(localStorage.getItem(DEMO_STATUS_KEY)) || {}; } catch { return {}; } }
function techFromRow(t) {
  return { technicianId: t.technician_id, status: t.status, capacity: t.capacity, isOnCall: t.is_on_call,
           statusChangedAt: t.status_changed_at, lastSeenAt: t.last_seen_at };
}
async function rpc(name, args) {
  const sb = await getSupabase();
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function getMyTechStatus(user) {
  if (!supabaseEnabled) { const d = demoStatuses()[user.uid] || {}; return { technicianId: user.uid, status: d.status || "off", capacity: 3, isOnCall: false, statusChangedAt: d.at, lastSeenAt: new Date().toISOString() }; }
  const sb = await getSupabase();
  const { data, error } = await sb.from("technician_status").select("*").eq("technician_id", user.uid).maybeSingle();
  if (error) throw new Error(friendlyError(error));
  return data ? techFromRow(data) : null;
}
export async function setMyStatus(user, status) {
  if (!supabaseEnabled) { const all = demoStatuses(); all[user.uid] = { status, at: new Date().toISOString() }; localStorage.setItem(DEMO_STATUS_KEY, JSON.stringify(all)); return getMyTechStatus(user); }
  return techFromRow(await rpc("set_my_status", { p_status: status }));
}
export async function heartbeat() { if (supabaseEnabled) await rpc("technician_heartbeat", {}); }
export async function declineTask(id, reason) {
  if (!supabaseEnabled) { await updateReport(id, { status: "Menunggu Verifikasi", technicianId: "", technicianName: "" }); return; }
  await rpc("decline_task", { p_report_id: id, p_reason: reason });
}

// ---------- admin ----------
function settingsFromRow(s) {
  return { autoDispatch: s.auto_dispatch, shiftStart: String(s.shift_start).slice(0, 5), shiftEnd: String(s.shift_end).slice(0, 5),
           nightMinUrgency: s.night_min_urgency, inactiveHours: s.inactive_hours, updatedAt: s.updated_at };
}
export async function getSettings() {
  if (!supabaseEnabled) return { autoDispatch: false, shiftStart: "06:00", shiftEnd: "22:00", nightMinUrgency: 70, inactiveHours: 8, demo: true };
  const sb = await getSupabase();
  const [{ data, error }, night] = await Promise.all([sb.from("app_settings").select("*").eq("id", 1).single(), sb.rpc("is_night")]);
  if (error) throw new Error(friendlyError(error));
  return { ...settingsFromRow(data), isNight: !!night.data };
}
export async function updateSettings(user, changes) {
  if (!supabaseEnabled) throw new Error("Pengaturan otomatis membutuhkan Supabase.");
  const map = { autoDispatch: "auto_dispatch", shiftStart: "shift_start", shiftEnd: "shift_end", nightMinUrgency: "night_min_urgency", inactiveHours: "inactive_hours" };
  const row = { updated_at: new Date().toISOString(), updated_by: user.uid };
  for (const [k, v] of Object.entries(changes)) if (map[k]) row[map[k]] = v;
  const sb = await getSupabase();
  const { data, error } = await sb.from("app_settings").update(row).eq("id", 1).select().single();
  if (error) throw new Error(friendlyError(error, "Pengaturan gagal disimpan."));
  return settingsFromRow(data);
}
export async function listTechnicianOverview() {
  if (!supabaseEnabled) { const st = demoStatuses(); return DEMO_USERS.filter(x => x.role === "teknisi").map(u => ({ technicianId: u.uid, name: u.name, email: u.email, status: st[u.uid]?.status || "off", capacity: 3, isOnCall: false, activeLoad: loadLocal().filter(r => r.technicianId === u.uid && ["Ditugaskan", "Menuju Lokasi"].includes(r.status)).length, lastSeenAt: null })); }
  const sb = await getSupabase();
  const { data, error } = await sb.from("technician_overview").select("*").order("name");
  if (error) throw new Error(friendlyError(error));
  return data.map(t => ({ ...techFromRow(t), name: t.name, email: t.email, activeLoad: t.active_load }));
}
export async function updateTechnician(technicianId, changes) {
  if (!supabaseEnabled) throw new Error("Fitur ini membutuhkan Supabase.");
  const row = {};
  if ("capacity" in changes) row.capacity = changes.capacity;
  if ("isOnCall" in changes) row.is_on_call = changes.isOnCall;
  if ("status" in changes) { row.status = changes.status; row.status_changed_at = new Date().toISOString(); }
  const sb = await getSupabase();
  const { data, error } = await sb.from("technician_status").update(row).eq("technician_id", technicianId).select();
  if (error) throw new Error(friendlyError(error));
  if (!data.length) throw new Error("Teknisi tidak ditemukan.");
}
export async function suggestTechnicians(reportId) {
  if (!supabaseEnabled) return [];
  const data = await rpc("suggest_technicians", { p_report_id: reportId });
  return (data || []).map(s => ({ technicianId: s.technician_id, name: s.name, score: Number(s.score), distanceKm: Number(s.distance_km),
                                  baseVillage: s.base_village, activeLoad: s.active_load, capacity: s.capacity, isOnCall: s.is_on_call, reason: s.reason }));
}
export async function unassignTask(reportId, reason) {
  if (!supabaseEnabled) { await updateReport(reportId, { status: "Menunggu Verifikasi", technicianId: "", technicianName: "" }); return; }
  await rpc("unassign_task", { p_report_id: reportId, p_reason: reason || null });
}
export async function listDispatchLog(limit = 30) {
  if (!supabaseEnabled) return [];
  const sb = await getSupabase();
  const { data, error } = await sb.from("dispatch_log").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(friendlyError(error));
  return data.map(l => ({ id: l.id, reportId: l.report_id, technicianId: l.technician_id, action: l.action, actor: l.actor, reason: l.reason, createdAt: l.created_at }));
}
