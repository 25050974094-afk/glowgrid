import { requireRole, logout } from "./auth-service.js";
import { getSettings, listDispatchLog, listReports, listTechnicianOverview, queuePriority, suggestTechnicians, unassignTask, updateReport, updateSettings, updateTechnician } from "./data-service.js";
import { escapeHTML, formatDate, setupPortal, statusClass, toast } from "./common.js";

const user = await requireRole("admin"); if (!user) throw new Error("Akses dihentikan");
setupPortal(user, "Administrator"); document.getElementById("logoutBtn").onclick = logout;
const $ = id => document.getElementById(id);

let reports = [], techs = [], settings = null, logs = [], selectedId = null;
const STATUS_LABEL = { ready: "Ready", fokus: "Fokus", istirahat: "Istirahat", off: "Off", penuh: "Penuh" };
const urgencyClass = u => u >= 70 ? "high" : u >= 45 ? "medium" : "low";
const active = r => ["Ditugaskan", "Menuju Lokasi"].includes(r.status);
const techKey = t => t.status === "ready" && t.activeLoad >= t.capacity ? "penuh" : t.status;
function ago(value) {
  if (!value) return "—";
  const m = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  return m < 1 ? "baru saja" : m < 60 ? `${m} menit lalu` : m < 1440 ? `${Math.round(m / 60)} jam lalu` : `${Math.round(m / 1440)} hari lalu`;
}

// Priority Queue: urgensi + aging (laporan lama naik prioritas agar tidak tertinggal)
function waiting() { return reports.filter(r => r.status === "Menunggu Verifikasi").sort((a, b) => queuePriority(b) - queuePriority(a) || new Date(a.createdAt) - new Date(b.createdAt)); }

// ---------- Mode penugasan ----------
function renderControl() {
  const toggle = $("autoToggle");
  if (!settings) return;
  toggle.disabled = !!settings.demo; toggle.checked = settings.autoDispatch;
  $("autoLabel").textContent = settings.autoDispatch ? "ON" : "OFF";
  $("kontrol").classList.toggle("is-auto", settings.autoDispatch);
  $("modeTitle").textContent = settings.autoDispatch ? "Penugasan otomatis aktif" : "Mode manual";
  $("modeDesc").textContent = settings.demo ? "Mode demo lokal: penugasan otomatis membutuhkan Supabase."
    : settings.autoDispatch ? "Sistem menugaskan laporan ke teknisi berstatus Ready berdasarkan urgensi, jarak, dan beban. Anda tetap bisa menugaskan atau memindahkan secara manual."
    : "Admin menugaskan laporan secara manual. Sistem tetap menampilkan saran teknisi terbaik.";
  const ready = techs.filter(t => techKey(t) === "ready").length, onCall = techs.filter(t => t.isOnCall).length;
  $("shiftInfo").innerHTML = `<span>${settings.isNight ? "☾ Jam malam" : "☀ Jam kerja"} · ${settings.shiftStart}–${settings.shiftEnd} WIB</span><span>${ready} teknisi siap menerima tugas</span><span>${onCall} teknisi piket malam</span>`
    + (settings.isNight && settings.autoDispatch ? `<span class="warn">Malam: hanya urgensi ≥ ${settings.nightMinUrgency} ke teknisi piket</span>` : "");
  $("shiftStart").value = settings.shiftStart; $("shiftEnd").value = settings.shiftEnd;
  $("nightMin").value = settings.nightMinUrgency; $("inactiveHours").value = settings.inactiveHours;
}
$("autoToggle").onchange = async e => {
  const on = e.target.checked;
  if (on && !techs.some(t => techKey(t) === "ready")) toast("Catatan: belum ada teknisi Ready. Laporan akan ditugaskan begitu ada yang siap.");
  e.target.disabled = true;
  try { settings = { ...settings, ...(await updateSettings(user, { autoDispatch: on })) }; await load(); toast(on ? "Penugasan otomatis diaktifkan." : "Mode manual diaktifkan."); }
  catch (err) { e.target.checked = !on; toast(err.message); }
  finally { e.target.disabled = false; }
};
$("settingsForm").onsubmit = async e => {
  e.preventDefault();
  try {
    await updateSettings(user, { shiftStart: $("shiftStart").value, shiftEnd: $("shiftEnd").value, nightMinUrgency: Number($("nightMin").value), inactiveHours: Number($("inactiveHours").value) });
    await load(); toast("Pengaturan disimpan.");
  } catch (err) { toast(err.message); }
};

// ---------- Ringkasan & antrean ----------
function renderSummary() {
  const data = [["Menunggu", waiting().length], ["Ditugaskan", reports.filter(r => r.status === "Ditugaskan").length], ["Menuju lokasi", reports.filter(r => r.status === "Menuju Lokasi").length], ["Selesai", reports.filter(r => r.status === "Selesai").length]];
  $("adminSummary").innerHTML = data.map(x => `<article class="summary-card"><span>${x[0]}</span><strong>${x[1]}</strong></article>`).join("");
}
function renderQueue() {
  const queue = waiting();
  $("queueCount").textContent = `${queue.length} item`;
  $("queueList").innerHTML = queue.length ? queue.map((r, i) => `<button class="queue-item ${selectedId === r.id ? "selected" : ""}" data-id="${r.id}">
      <span class="queue-number">${i + 1}</span>
      <span class="queue-main"><strong>${escapeHTML(r.id)} · ${escapeHTML(r.village)}</strong><small>${escapeHTML(r.category)} · menunggu ${ago(r.createdAt).replace(" lalu", "")}</small></span>
      <span class="urgency-chip ${urgencyClass(r.urgency)}" title="Urgensi ${r.urgency} · prioritas antrean ${queuePriority(r).toFixed(0)}">${r.urgency}</span></button>`).join("")
    : `<div class="empty-state"><span>✓</span><h3>Antrean kosong</h3><p>${settings?.autoDispatch ? "Sistem sudah menugaskan semua laporan." : "Semua laporan sudah diproses."}</p></div>`;
  document.querySelectorAll(".queue-item").forEach(x => x.onclick = () => { selectedId = x.dataset.id; renderQueue(); renderDetail(); });
}

async function renderDetail() {
  const el = $("adminDetail"), r = reports.find(x => x.id === selectedId);
  if (!r) { el.className = "empty-state"; el.innerHTML = '<span>⌁</span><h3>Pilih laporan</h3><p>Klik laporan pada antrean atau tabel untuk memeriksa detail.</p>'; return; }
  const isWaiting = r.status === "Menunggu Verifikasi";
  el.className = "detail-wrap";
  el.innerHTML = `<div class="detail-head"><div><span class="section-kicker">${escapeHTML(r.id)} · ${escapeHTML(r.status)}</span><h3>${escapeHTML(r.category)}</h3></div>
      <span class="urgency-chip big ${urgencyClass(r.urgency)}" title="Skor urgensi 0–100">${r.urgency}</span></div>
    <div class="urgency-source">Urgensi dari <b>${r.aiUrgency != null ? "analisis AI" : "algoritma kata kunci"}</b> · prioritas pilihan warga: ${["", "Rendah", "Sedang", "Tinggi"][r.severity] || "-"}
      ${r.urgencyNotes?.length ? `<div class="note-tags">${r.urgencyNotes.map(n => `<span>${escapeHTML(n)}</span>`).join("")}</div>` : ""}</div>
    <div class="detail-grid"><div class="detail-box"><span>Pelapor</span><strong>${escapeHTML(r.reporter)}</strong></div><div class="detail-box"><span>Kelurahan</span><strong>${escapeHTML(r.village)}</strong></div>
      <div class="detail-box"><span>Alamat</span><strong>${escapeHTML(r.address)}</strong></div><div class="detail-box"><span>Masuk</span><strong>${formatDate(r.createdAt)}</strong></div></div>
    <div class="detail-description">${escapeHTML(r.description)}</div>
    <p><a class="map-link" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}">Buka lokasi di Google Maps</a></p>
    ${isWaiting ? `<div class="suggest-box"><span class="section-kicker">Saran sistem</span><div id="suggestList" class="suggest-list"><small>Menghitung saran...</small></div></div>
      <div class="assignment-form"><select id="assignTechnician"><option value="">Pilih teknisi lain...</option>${techs.map(t => `<option value="${t.technicianId}">${escapeHTML(t.name)} — ${STATUS_LABEL[techKey(t)]} ${t.activeLoad}/${t.capacity}</option>`).join("")}</select><button id="assignBtn" class="button primary">Tugaskan</button></div>
      <button id="rejectBtn" class="danger-button">Tolak laporan</button>`
    : active(r) ? `<p class="assigned-note">Ditugaskan ke <b>${escapeHTML(r.technicianName)}</b> ${r.assignedBy === "sistem" ? "oleh sistem" : "oleh admin"}${r.assignedAt ? ` · ${ago(r.assignedAt)}` : ""}.</p>
      <button id="unassignBtn" class="danger-button">Kembalikan ke antrean</button>` : ""}`;
  if (isWaiting) {
    $("assignBtn").onclick = () => assign($("assignTechnician").value);
    $("rejectBtn").onclick = () => change({ status: "Ditolak" }, "Laporan ditolak setelah verifikasi.");
    try {
      const list = await suggestTechnicians(r.id);
      if (selectedId !== r.id) return;
      $("suggestList").innerHTML = list.length ? list.slice(0, 3).map((s, i) => `<div class="suggest-item ${i === 0 ? "best" : ""}">
          <div><b>${i === 0 ? "★ " : ""}${escapeHTML(s.name)}</b><small>${s.distanceKm} km dari ${escapeHTML(s.baseVillage)} · beban ${s.activeLoad}/${s.capacity}${s.isOnCall ? " · piket" : ""}</small></div>
          <button class="mini-button" data-suggest="${s.technicianId}">Tugaskan</button></div>`).join("")
        : '<small class="muted">Tidak ada teknisi berstatus Ready dengan kapasitas tersisa. Anda tetap bisa memilih teknisi secara manual.</small>';
      document.querySelectorAll("[data-suggest]").forEach(b => b.onclick = () => assign(b.dataset.suggest));
    } catch (err) { $("suggestList").innerHTML = `<small class="muted">${escapeHTML(err.message)}</small>`; }
  } else if (active(r)) {
    $("unassignBtn").onclick = async () => {
      try { await unassignTask(r.id, "Dikembalikan ke antrean oleh admin"); await load(); toast("Tugas dikembalikan ke antrean."); } catch (err) { toast(err.message); }
    };
  }
}
async function assign(technicianId) {
  if (!technicianId) return toast("Pilih teknisi terlebih dahulu.");
  const t = techs.find(x => x.technicianId === technicianId);
  if (t && t.activeLoad >= t.capacity && !confirm(`${t.name} sudah memegang ${t.activeLoad}/${t.capacity} tugas. Tetap tugaskan?`)) return;
  await change({ status: "Ditugaskan", technicianId, technicianName: t?.name || "" }, `Laporan ditugaskan ke ${t?.name || "teknisi"}.`);
}
async function change(changes, message) {
  try { await updateReport(selectedId, changes); selectedId = null; await load(); toast(message); }
  catch (err) { toast(err.message || "Perubahan gagal disimpan."); }
}
$("frontBtn").onclick = () => { const first = waiting()[0]; if (!first) return toast("Antrean sudah kosong."); selectedId = first.id; renderQueue(); renderDetail(); $("antrean").scrollIntoView({ behavior: "smooth" }); };

// ---------- Teknisi ----------
function renderTechs() {
  $("techCount").textContent = `${techs.length} teknisi`;
  $("techTableBody").innerHTML = techs.length ? techs.map(t => {
    const key = techKey(t), stale = t.lastSeenAt && (Date.now() - new Date(t.lastSeenAt)) / 3.6e6 > (settings?.inactiveHours || 8);
    return `<tr><td><strong>${escapeHTML(t.name)}</strong><br><small>${escapeHTML(t.email || "")}</small></td>
      <td><span class="tech-status ${key}">${STATUS_LABEL[key]}</span>${stale && t.status === "ready" ? '<br><small class="warn">tidak aktif</small>' : ""}</td>
      <td>${t.activeLoad}/${t.capacity}</td><td>${ago(t.lastSeenAt)}</td>
      <td><select data-cap="${t.technicianId}" aria-label="Kapasitas ${escapeHTML(t.name)}">${[1,2,3,4,5].map(n => `<option ${n === t.capacity ? "selected" : ""}>${n}</option>`).join("")}</select></td>
      <td><label class="mini-switch"><input type="checkbox" data-oncall="${t.technicianId}" ${t.isOnCall ? "checked" : ""}><span></span></label></td></tr>`;
  }).join("") : '<tr><td colspan="6">Belum ada akun teknisi.</td></tr>';
  document.querySelectorAll("[data-cap]").forEach(s => s.onchange = () => saveTech(s.dataset.cap, { capacity: Number(s.value) }, "Kapasitas diperbarui."));
  document.querySelectorAll("[data-oncall]").forEach(c => c.onchange = () => saveTech(c.dataset.oncall, { isOnCall: c.checked }, c.checked ? "Teknisi dijadikan piket malam." : "Piket malam dilepas."));
}
async function saveTech(id, changes, message) {
  try { await updateTechnician(id, changes); await load(); toast(message); } catch (err) { toast(err.message); await load(); }
}

// ---------- Register & log ----------
function renderTable() {
  const q = $("adminSearch").value.toLowerCase(), status = $("statusFilter").value;
  const rows = reports.filter(r => (status === "all" || r.status === status) && [r.id, r.village, r.address, r.category, r.technicianName].some(v => String(v || "").toLowerCase().includes(q)));
  $("reportTableBody").innerHTML = rows.length ? rows.map(r => `<tr class="${selectedId === r.id ? "selected" : ""}"><td><strong>${escapeHTML(r.id)}</strong></td><td>${escapeHTML(r.village)}<br><small>${escapeHTML(r.address)}</small></td><td>${escapeHTML(r.category)}</td>
      <td><span class="urgency-chip ${urgencyClass(r.urgency)}">${r.urgency}</span></td>
      <td>${escapeHTML(r.technicianName || "—")}${r.assignedBy ? `<br><small>${r.assignedBy === "sistem" ? "otomatis" : "manual"}</small>` : ""}</td>
      <td><span class="status-pill ${statusClass(r.status)}">${escapeHTML(r.status)}</span></td>
      <td>${r.status !== "Selesai" && r.status !== "Ditolak" ? `<button class="mini-button" data-open="${r.id}">Detail</button>` : ""}</td></tr>`).join("") : '<tr><td colspan="7">Tidak ada data yang sesuai.</td></tr>';
  document.querySelectorAll("[data-open]").forEach(b => b.onclick = () => { selectedId = b.dataset.open; renderQueue(); renderDetail(); $("antrean").scrollIntoView({ behavior: "smooth" }); });
}
const LOG_ICON = { assign: "→", no_teknisi: "…", decline: "↩", unassign: "↩", mode: "⚙" };
function renderLog() {
  $("logList").innerHTML = logs.length ? logs.map(l => `<li class="log-item ${l.action}"><span class="log-icon">${LOG_ICON[l.action] || "•"}</span>
      <div><b>${l.reportId ? escapeHTML(l.reportId) + " · " : ""}${{ assign: "Ditugaskan", no_teknisi: "Menunggu teknisi", decline: "Ditolak teknisi", unassign: "Dikembalikan", mode: "Mode diubah" }[l.action] || l.action}</b>
      <small>${escapeHTML(l.reason || "")}</small></div><time>${l.actor} · ${ago(l.createdAt)}</time></li>`).join("")
    : '<li class="log-empty">Belum ada catatan. Log berisi setiap penugasan otomatis, penugasan manual, dan penolakan tugas.</li>';
}
$("refreshLogBtn").onclick = async () => { logs = await listDispatchLog(); renderLog(); };

async function load() {
  try {
    [reports, techs, settings, logs] = await Promise.all([listReports(user), listTechnicianOverview(), getSettings(), listDispatchLog()]);
  } catch (err) { toast(err.message || "Gagal memuat data."); }
  if (selectedId && !reports.some(r => r.id === selectedId && r.status !== "Selesai" && r.status !== "Ditolak")) selectedId = null;
  renderControl(); renderSummary(); renderQueue(); renderTechs(); renderTable(); renderLog(); renderDetail();
}
$("adminSearch").oninput = renderTable; $("statusFilter").onchange = renderTable;
setInterval(() => { if (!document.hidden && !document.querySelector("select:focus, input:focus")) load(); }, 30000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
await load();
