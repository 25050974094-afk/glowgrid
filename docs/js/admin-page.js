import { requireRole, logout } from "./auth-service.js";
import { clearAiFlags, getSettings, listDispatchLog, photoUrl, reanalyzeReport, listReports, listTechnicianOverview, queuePriority, suggestTechnicians, unassignTask, updateReport, updateSettings, updateTechnician } from "./data-service.js";
import { PriorityQueue, Stack, buildRegionTree } from "./structures.js";
import { initLab } from "./lab.js";
import { LOCATIONS, currentView, escapeHTML, formatDate, initLeafletMap, markerIcon, navigate, onViewChange, openPhoto, setupPortal, setupViews, statusClass, toast } from "./common.js";

const user = await requireRole("admin"); if (!user) throw new Error("Akses dihentikan");
setupPortal(user, "Administrator"); document.getElementById("logoutBtn").onclick = logout;
const $ = id => document.getElementById(id);
if (location.hash === "#log") history.replaceState(null, "", "#lab");   // menu Log lama → Lab Struktur Data
window.addEventListener("hashchange", () => { if (location.hash === "#log") location.replace("#lab"); });
setupViews("dasbor");

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

function aiBadge(r) {
  if (r.aiFlags.length) return '<span class="ai-pill flag" title="Ditahan untuk tinjauan admin">⚑ tinjau</span>';
  if (r.aiStatus === "pending" || r.aiStatus === "processing") return '<span class="ai-pill wait" title="AI sedang menilai">AI…</span>';
  if (r.aiStatus === "done") return '<span class="ai-pill done" title="Urgensi dari AI">✦</span>';
  return "";
}
// Priority Queue: urgensi + aging (laporan lama naik prioritas agar tidak tertinggal)
// ---------- Antrean verifikasi = PriorityQueue (binary heap) ----------
// Prioritas = urgensi + aging (maks +40). Laporan dimasukkan sesuai waktu masuk, jadi prioritas sama → FIFO.
function waiting() {
  const pq = new PriorityQueue();
  reports.filter(r => r.status === "Menunggu Verifikasi")
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .forEach(r => pq.enqueue(r, queuePriority(r)));
  return pq.toSortedArray().map(node => node.value);
}

// ---------- Riwayat aksi admin = Stack (LIFO) → tombol Urungkan ----------
const UNDO_KEY = "glowgrid-undo";
const undoStack = (() => { try { return Stack.from(JSON.parse(sessionStorage.getItem(UNDO_KEY) || "[]"), 20); } catch { return new Stack(20); } })();
let lab = null;
const saveUndo = () => { try { sessionStorage.setItem(UNDO_KEY, JSON.stringify(undoStack.items)); } catch {} renderUndo(); };
function rememberAction(r, label, afterStatus) {
  undoStack.push({ label, reportId: r.id, afterStatus, at: new Date().toISOString(),
    before: { status: r.status, technicianId: r.technicianId || "", technicianName: r.technicianName || "" } });
  saveUndo();
}
function renderUndo() {
  const top = undoStack.peek(), bar = $("undoBar");
  bar.hidden = !top;
  if (top) { $("undoLabel").textContent = top.label; $("undoCount").textContent = undoStack.size > 1 ? `+${undoStack.size - 1} lagi` : ""; }
  lab?.refresh("stack");
}
async function undoLast() {
  const action = undoStack.pop(); saveUndo();
  if (!action) return;
  try {
    const current = (await listReports(user)).find(r => r.id === action.reportId);
    if (!current) throw new Error(`Laporan ${action.reportId} tidak ditemukan.`);
    if (current.status !== action.afterStatus) throw new Error(`${action.reportId} sudah berubah menjadi "${current.status}", aksi tidak bisa diurungkan.`);
    await updateReport(action.reportId, action.before);
    await load();
    toast(`Diurungkan: ${action.label}${settings?.autoDispatch && action.before.status === "Menunggu Verifikasi" ? " · mode otomatis bisa menugaskannya lagi" : ""}`);
  } catch (err) { toast(err.message || "Gagal mengurungkan."); await load(); }
}

// ---------- Lab Struktur Data ----------
lab = initLab({ user, undoStack, getReports: () => reports, getTechs: () => techs, getLogs: () => logs, reload: () => load(), undo: undoLast });
onViewChange(view => { if (view === "lab") lab.show(); });
document.querySelectorAll("[data-lab]").forEach(a => a.addEventListener("click", () => lab.openTab(a.dataset.lab)));

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
  renderAiControl();
  $("shiftStart").value = settings.shiftStart; $("shiftEnd").value = settings.shiftEnd;
  $("nightMin").value = settings.nightMinUrgency; $("inactiveHours").value = settings.inactiveHours;
}
function renderAiControl() {
  const t = $("aiToggle");
  t.disabled = !!settings.demo; t.checked = settings.aiEnabled;
  $("aiLabel").textContent = settings.aiEnabled ? "ON" : "OFF";
  $("aiDesc").textContent = settings.demo ? "Mode demo lokal: analisis AI membutuhkan Supabase."
    : settings.aiEnabled ? "Laporan baru dinilai AI (Groq). Penugasan menunggu hasil AI maksimal 1 menit, lalu memakai skor algoritma bila AI tidak menjawab."
    : "AI dimatikan. Urgensi dihitung dengan algoritma kata kunci saja.";
  // Perbandingan AI vs algoritma (bahan evaluasi)
  const judged = reports.filter(r => r.aiUrgency != null && r.kwUrgency != null);
  const diff = judged.filter(r => Math.abs(r.aiUrgency - r.kwUrgency) >= 20);
  const up = diff.filter(r => r.aiUrgency > r.kwUrgency).length, flagged = reports.filter(r => r.aiFlags.length).length;
  const failed = reports.filter(r => r.aiStatus === "failed").length;
  $("aiStats").innerHTML = judged.length
    ? `<span><b>${judged.length}</b> laporan dinilai AI</span><span><b>${diff.length}</b> berbeda ≥20 poin dari algoritma (${up} dinaikkan, ${diff.length - up} diturunkan)</span>`
      + (flagged ? `<span class="warn"><b>${flagged}</b> perlu tinjauan</span>` : "") + (failed ? `<span class="warn"><b>${failed}</b> gagal dianalisis</span>` : "")
    : '<span>Belum ada laporan yang dinilai AI.</span>';
}
$("aiToggle").onchange = async e => {
  const on = e.target.checked; e.target.disabled = true;
  try { settings = { ...settings, ...(await updateSettings(user, { aiEnabled: on })) }; await load(); toast(on ? "Analisis AI diaktifkan." : "Analisis AI dimatikan."); }
  catch (err) { e.target.checked = !on; toast(err.message); }
  finally { e.target.disabled = false; }
};
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
  const badge = $("navQueueBadge"); badge.textContent = queue.length || "";
  badge.classList.toggle("warn", queue.some(r => r.aiFlags.length)); badge.title = `${queue.length} laporan menunggu`;
  $("queueList").innerHTML = queue.length ? queue.map((r, i) => `<button class="queue-item ${selectedId === r.id ? "selected" : ""}" data-id="${r.id}">
      <span class="queue-number">${i + 1}</span>
      <span class="queue-main"><strong>${escapeHTML(r.id)} · ${escapeHTML(r.village)}</strong><small>${escapeHTML(r.category)} · menunggu ${ago(r.createdAt).replace(" lalu", "")}</small></span>
      <span class="queue-side">${aiBadge(r)}<span class="urgency-chip ${urgencyClass(r.urgency)}" title="Urgensi ${r.urgency} · prioritas antrean ${queuePriority(r).toFixed(0)}">${r.urgency}</span></span></button>`).join("")
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
    ${aiBlock(r)}
    <div class="detail-grid"><div class="detail-box"><span>Pelapor</span><strong>${escapeHTML(r.reporter)}</strong></div><div class="detail-box"><span>Kelurahan</span><strong>${escapeHTML(r.village)}</strong></div>
      <div class="detail-box"><span>Alamat</span><strong>${escapeHTML(r.address)}</strong></div><div class="detail-box"><span>Masuk</span><strong>${formatDate(r.createdAt)}</strong></div></div>
    <div class="detail-description">${escapeHTML(r.description)}</div>
    ${r.photoPath || r.proofPath ? '<div id="detailPhotos" class="thumbs"></div>' : ""}
    <p><a class="map-link" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}">Buka lokasi di Google Maps</a></p>
    ${isWaiting ? `<div class="suggest-box"><span class="section-kicker">Saran sistem</span><div id="suggestList" class="suggest-list"><small>Menghitung saran...</small></div></div>
      <div class="assignment-form"><select id="assignTechnician"><option value="">Pilih teknisi lain...</option>${techs.map(t => `<option value="${t.technicianId}">${escapeHTML(t.name)} — ${STATUS_LABEL[techKey(t)]} ${t.activeLoad}/${t.capacity}</option>`).join("")}</select><button id="assignBtn" class="button primary">Tugaskan</button></div>
      <button id="rejectBtn" class="danger-button">Tolak laporan</button>`
    : active(r) ? `<p class="assigned-note">Ditugaskan ke <b>${escapeHTML(r.technicianName)}</b> ${r.assignedBy === "sistem" ? "oleh sistem" : "oleh admin"}${r.assignedAt ? ` · ${ago(r.assignedAt)}` : ""}.</p>
      <button id="unassignBtn" class="danger-button">Kembalikan ke antrean</button>` : ""}`;
  fillDetailPhotos(r);
  document.querySelectorAll("[data-jump]").forEach(b => b.onclick = () => { selectedId = b.dataset.jump; renderQueue(); renderDetail(); });
  const clearBtn = $("clearFlagsBtn"), reBtn = $("reanalyzeBtn");
  if (clearBtn) clearBtn.onclick = async () => { try { await clearAiFlags(r.id); await load(); toast("Tanda AI diabaikan. Laporan diproses normal."); } catch (err) { toast(err.message); } };
  if (reBtn) reBtn.onclick = async () => { try { await reanalyzeReport(r.id); await load(); toast("AI menilai ulang laporan ini..."); } catch (err) { toast(err.message); } };
  if (isWaiting) {
    $("assignBtn").onclick = () => assign($("assignTechnician").value);
    $("rejectBtn").onclick = () => change({ status: "Ditolak" }, "Laporan ditolak setelah verifikasi.", `Tolak ${r.id}`);
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
      try { await unassignTask(r.id, "Dikembalikan ke antrean oleh admin"); rememberAction(r, `Kembalikan ${r.id} ke antrean`, "Menunggu Verifikasi"); await load(); toast("Tugas dikembalikan ke antrean."); } catch (err) { toast(err.message); }
    };
  }
}
async function fillDetailPhotos(r) {
  const box = $("detailPhotos"); if (!box) return;
  const items = [];
  if (r.photoPath) items.push({ url: await photoUrl(r.photoPath), label: "Foto dari warga" });
  if (r.proofPath) items.push({ url: await photoUrl(r.proofPath), label: "Bukti perbaikan" });
  if (selectedId !== r.id) return;
  box.innerHTML = items.filter(x => x.url).map(x => `<button type="button" class="thumb" data-photo="${escapeHTML(x.url)}" data-caption="${escapeHTML(x.label + " · " + r.id)}"><img src="${escapeHTML(x.url)}" alt="${x.label}"><span>${x.label}</span></button>`).join("");
  box.querySelectorAll("[data-photo]").forEach(b => b.onclick = () => openPhoto(b.dataset.photo, b.dataset.caption));
}
const SEV = ["", "Rendah", "Sedang", "Tinggi"];
function aiBlock(r) {
  const canRedo = !["Selesai", "Ditolak"].includes(r.status) && ["done", "failed", "skipped"].includes(r.aiStatus) && !settings?.demo;
  const scores = `<div class="score-compare">
      <div class="${r.aiUrgency != null ? "used" : ""}"><span>AI</span><b>${r.aiUrgency ?? "—"}</b></div>
      <div class="${r.aiUrgency == null ? "used" : ""}"><span>Algoritma</span><b>${r.kwUrgency ?? "—"}</b></div>
      <div><span>Pilihan warga</span><b>${SEV[r.severity] || "-"}</b></div></div>`;
  let body = "";
  if (r.aiStatus === "pending" || r.aiStatus === "processing") body = '<p class="ai-wait">✦ AI sedang menilai laporan ini (maks. ±1 menit)...</p>';
  else if (r.aiStatus === "failed") body = `<p class="ai-fail">AI gagal menilai: ${escapeHTML(r.aiError || "tidak diketahui")}. Dipakai skor algoritma.</p>`;
  else if (r.aiStatus === "skipped") body = '<p class="muted small">Laporan ini tidak dinilai AI (AI dimatikan atau laporan lama).</p>';
  else body = `${r.aiSummary ? `<p class="ai-summary">✦ ${escapeHTML(r.aiSummary)}</p>` : ""}${r.aiReason ? `<p class="ai-reason">${escapeHTML(r.aiReason)}</p>` : ""}
      ${r.aiCategory ? `<p class="ai-reason">Saran kategori AI: <b>${escapeHTML(r.aiCategory)}</b></p>` : ""}`;
  const flags = r.aiFlags.length ? `<div class="flag-box"><b>⚑ Ditahan untuk tinjauan:</b> ${r.aiFlags.map(escapeHTML).join(", ")}
      ${r.aiDuplicateOf ? `<br><small>Bandingkan dengan laporan <button class="text-button" data-jump="${escapeHTML(r.aiDuplicateOf)}">${escapeHTML(r.aiDuplicateOf)}</button></small>` : ""}
      <div class="flag-actions"><button id="clearFlagsBtn" class="mini-button">Abaikan tanda &amp; proses normal</button><small>atau tolak laporan di bawah</small></div></div>` : "";
  return `<div class="ai-block">${scores}${body}
      ${r.urgencyNotes?.length ? `<div class="note-tags">${r.urgencyNotes.map(n => `<span>${escapeHTML(n)}</span>`).join("")}</div>` : ""}
      ${canRedo ? '<button id="reanalyzeBtn" class="text-button small">↻ Minta AI menilai ulang</button>' : ""}</div>${flags}`;
}
async function assign(technicianId) {
  if (!technicianId) return toast("Pilih teknisi terlebih dahulu.");
  const t = techs.find(x => x.technicianId === technicianId);
  if (t && t.activeLoad >= t.capacity && !confirm(`${t.name} sudah memegang ${t.activeLoad}/${t.capacity} tugas. Tetap tugaskan?`)) return;
  await change({ status: "Ditugaskan", technicianId, technicianName: t?.name || "" }, `Laporan ditugaskan ke ${t?.name || "teknisi"}.`, `Tugaskan ${selectedId} ke ${t?.name || "teknisi"}`);
}
async function change(changes, message, undoLabel) {
  const before = reports.find(r => r.id === selectedId);
  try { await updateReport(selectedId, changes); if (before && undoLabel) rememberAction(before, undoLabel, changes.status); selectedId = null; await load(); toast(message); }
  catch (err) { toast(err.message || "Perubahan gagal disimpan."); }
}
$("frontBtn").onclick = () => { const first = waiting()[0]; if (!first) return toast("Antrean sudah kosong."); selectedId = first.id; renderQueue(); renderDetail(); navigate("antrean"); };

// ---------- Peta laporan + rute teknisi (Graph) ----------
const map = initLeafletMap("adminMap"), mapLayers = [];
let mapFilter = "aktif", mapFitted = false;
const ROUTE_COLORS = ["#1a73e8", "#e8710a", "#188038", "#a142f4", "#d93025", "#12b5cb"];
const STATUS_COLORS = { "Menunggu Verifikasi": "#ffb84d", "Ditugaskan": "#3e83f8", "Menuju Lokasi": "#5552d9", "Selesai": "#9a67e8", "Ditolak": "#7c8298" };
function renderMap() {
  if (!map) return;
  mapLayers.splice(0).forEach(x => x.remove());
  const shown = reports.filter(r => mapFilter === "all" ? true : mapFilter === "menunggu" ? r.status === "Menunggu Verifikasi" : !["Selesai", "Ditolak"].includes(r.status));
  const pts = [];
  shown.forEach(r => {
    pts.push([r.lat, r.lng]);
    mapLayers.push(L.marker([r.lat, r.lng], { icon: markerIcon(r.status) }).addTo(map).bindPopup(
      `<strong>${escapeHTML(r.id)}</strong> · ${escapeHTML(r.status)}<br>${escapeHTML(r.category)} — ${escapeHTML(r.village)}<br>Urgensi <b>${r.urgency}</b>${r.technicianName ? ` · ${escapeHTML(r.technicianName)}` : ""}${r.aiFlags.length ? "<br>⚑ perlu tinjauan" : ""}
       ${["Selesai", "Ditolak"].includes(r.status) ? "" : `<br><button type="button" class="mini-button" data-mapopen="${escapeHTML(r.id)}">Buka detail</button>`}`));
  });
  // Rute tiap teknisi: Depot → tugas aktif (urgensi tertinggi dulu)
  const depot = LOCATIONS["Depot Pakal"], byTech = {};
  reports.filter(active).forEach(r => (byTech[r.technicianName || "?"] ??= []).push(r));
  const legend = [];
  Object.entries(byTech).forEach(([name, list], i) => {
    const color = ROUTE_COLORS[i % ROUTE_COLORS.length];
    const route = [depot, ...list.sort((a, b) => b.urgency - a.urgency).map(r => [r.lat, r.lng])];
    mapLayers.push(L.polyline(route, { color, weight: 4, opacity: .8, dashArray: "8 6" }).addTo(map));
    legend.push(`<span><i class="line" style="background:${color}"></i>${escapeHTML(name)} · ${list.length} tugas</span>`);
  });
  mapLayers.push(L.marker(depot, { icon: markerIcon("Selesai") }).addTo(map).bindPopup("<strong>Depot teknisi</strong>"));
  $("mapLegend").innerHTML = Object.entries(STATUS_COLORS).map(([st, c]) => `<span><i style="background:${c}"></i>${st}</span>`).join("")
    + (legend.length ? `<span class="sep"></span>${legend.join("")}` : "") + `<span class="muted">${shown.length} laporan ditampilkan</span>`;
  if (!mapFitted && pts.length) { map.fitBounds(L.latLngBounds([...pts, depot]).pad(.2)); mapFitted = true; }
}
onViewChange(view => {
  if (view === "peta" && map) setTimeout(() => { map.invalidateSize(); mapFitted = false; renderMap(); }, 60);
});
if (document.body.dataset.currentView === "peta" && map) setTimeout(() => map.invalidateSize(), 60);   // dibuka langsung lewat admin.html#peta
document.querySelectorAll("[data-mapf]").forEach(b => b.onclick = () => {
  mapFilter = b.dataset.mapf; mapFitted = false;
  document.querySelectorAll("[data-mapf]").forEach(x => x.classList.toggle("active", x === b)); renderMap();
});
document.addEventListener("click", e => {
  const b = e.target.closest?.("[data-mapopen]"); if (!b) return;
  selectedId = b.dataset.mapopen; renderQueue(); renderDetail(); navigate("antrean");
});

// ---------- Dasbor: yang perlu ditindaklanjuti ----------
function renderAttention() {
  const items = [], queue = waiting();
  queue.filter(r => r.aiFlags.length).forEach(r => items.push({ icon: "⚑", cls: "flag", id: r.id,
    title: `${r.id} ditahan untuk tinjauan`, sub: r.aiFlags.join(", ") }));
  const readyTechs = techs.filter(t => techKey(t) === "ready");
  const stuck = queue.filter(r => !r.aiFlags.length && !["pending", "processing"].includes(r.aiStatus) && Date.now() - new Date(r.createdAt) > 30 * 60000);
  if (stuck.length) items.push({ icon: "…", cls: "wait", id: stuck[0].id,
    title: `${stuck.length} laporan menunggu lebih dari 30 menit`,
    sub: settings?.autoDispatch ? (readyTechs.length ? "Teknisi Ready mungkin sudah penuh kapasitasnya." : "Tidak ada teknisi berstatus Ready.") : "Mode manual aktif — tugaskan dari halaman Antrean." });
  const stale = techs.filter(t => t.status === "ready" && t.lastSeenAt && (Date.now() - new Date(t.lastSeenAt)) / 3.6e6 > (settings?.inactiveHours || 8));
  stale.forEach(t => items.push({ icon: "◷", cls: "tech", view: "teknisi", title: `${t.name} berstatus Ready tetapi tidak aktif`, sub: `Terakhir membuka aplikasi ${ago(t.lastSeenAt)} — tidak akan diberi tugas otomatis.` }));
  if (settings?.isNight && settings?.autoDispatch && !techs.some(t => t.isOnCall)) items.push({ icon: "☾", cls: "tech", view: "teknisi", title: "Jam malam tanpa teknisi piket", sub: "Laporan mendesak tidak akan ditugaskan otomatis sampai pagi." });
  $("attentionList").innerHTML = items.length ? items.map((x, i) => `<li><button type="button" data-att="${i}"><span class="att-icon ${x.cls}">${x.icon}</span><span class="att-text"><b>${escapeHTML(x.title)}</b><small>${escapeHTML(x.sub)}</small></span></button></li>`).join("") : "";
  const empty = document.querySelector(".attention-empty"); if (empty) empty.remove();
  if (!items.length) $("attentionList").insertAdjacentHTML("afterend", '<p class="attention-empty">✓ Tidak ada yang perlu ditindaklanjuti saat ini.</p>');
  document.querySelectorAll("[data-att]").forEach(b => b.onclick = () => {
    const x = items[Number(b.dataset.att)];
    if (x.id) { selectedId = x.id; renderQueue(); renderDetail(); navigate("antrean"); } else navigate(x.view);
  });
}

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
// ---------- Pohon wilayah = Tree, dihitung & dirender secara rekursif ----------
let regionFilter = null;                     // { name, ids:Set } dari simpul yang diklik
const TREE_ICON = { kota: "◉", kecamatan: "▣", kelurahan: "⌂", kategori: "◆", laporan: "•" };
function regionFilterFor(tree, name) {
  const path = tree.findPath(name);
  return path && path.length > 1 ? { name, ids: new Set(tree.leaves(path.at(-1)).map(r => r.id)) } : null;
}
function renderRegionTree() {
  const tree = buildRegionTree(reports);
  const nodeHTML = node => {                 // REKURSIF: simpul lalu anak-anaknya
    const n = tree.count(node), active = regionFilter?.name === node.name;
    const kids = node.children.filter(c => c.type !== "laporan").map(nodeHTML).join("");
    return `<li><button type="button" class="rt-node ${node.type} ${active ? "active" : ""} ${n ? "" : "empty"}" data-region="${escapeHTML(node.name)}">
      <i>${TREE_ICON[node.type]}</i><span>${escapeHTML(node.name)}</span><b>${n}</b></button>${kids ? `<ul>${kids}</ul>` : ""}</li>`;
  };
  $("regionTree").innerHTML = `<ul class="rt-root">${nodeHTML(tree.root)}</ul>`;
  $("regionTree").querySelectorAll("[data-region]").forEach(b => b.onclick = () => {
    regionFilter = regionFilter?.name === b.dataset.region ? null : regionFilterFor(tree, b.dataset.region);
    renderRegionTree(); renderTable();
  });
  $("regionChip").hidden = !regionFilter;
  if (regionFilter) $("regionChipLabel").textContent = regionFilter.name;
}
function renderTable() {
  const q = $("adminSearch").value.toLowerCase(), status = $("statusFilter").value;
  const rows = reports.filter(r => (!regionFilter || regionFilter.ids.has(r.id)) && (status === "all" || r.status === status) && [r.id, r.village, r.address, r.category, r.technicianName].some(v => String(v || "").toLowerCase().includes(q)));
  $("reportTableBody").innerHTML = rows.length ? rows.map(r => `<tr class="${selectedId === r.id ? "selected" : ""}"><td><strong>${escapeHTML(r.id)}</strong></td><td>${escapeHTML(r.village)}<br><small>${escapeHTML(r.address)}</small></td><td>${escapeHTML(r.category)}</td>
      <td><span class="urgency-chip ${urgencyClass(r.urgency)}">${r.urgency}</span></td>
      <td>${escapeHTML(r.technicianName || "—")}${r.assignedBy ? `<br><small>${r.assignedBy === "sistem" ? "otomatis" : "manual"}</small>` : ""}</td>
      <td><span class="status-pill ${statusClass(r.status)}">${escapeHTML(r.status)}</span></td>
      <td>${r.status !== "Selesai" && r.status !== "Ditolak" ? `<button class="mini-button" data-open="${r.id}">Detail</button>` : ""}</td></tr>`).join("") : '<tr><td colspan="7">Tidak ada data yang sesuai.</td></tr>';
  document.querySelectorAll("[data-open]").forEach(b => b.onclick = () => { selectedId = b.dataset.open; renderQueue(); renderDetail(); navigate("antrean"); });
}
const LOG_ICON = { assign: "→", no_teknisi: "…", decline: "↩", unassign: "↩", mode: "⚙", ai: "✦", review: "⚑" };
function renderLog() {
  $("logList").innerHTML = logs.length ? logs.map(l => `<li class="log-item ${l.action}"><span class="log-icon">${LOG_ICON[l.action] || "•"}</span>
      <div><b>${l.reportId ? escapeHTML(l.reportId) + " · " : ""}${{ assign: "Ditugaskan", no_teknisi: "Menunggu teknisi", decline: "Ditolak teknisi", unassign: "Dikembalikan", mode: "Mode diubah", ai: "Dinilai AI", review: "Tinjauan" }[l.action] || l.action}</b>
      <small>${escapeHTML(l.reason || "")}</small></div><time>${l.actor} · ${ago(l.createdAt)}</time></li>`).join("")
    : '<li class="log-empty">Belum ada catatan. Log berisi penilaian AI, penugasan otomatis/manual, dan penolakan tugas.</li>';
}
$("refreshLogBtn").onclick = async () => { logs = await listDispatchLog(); renderLog(); };

async function load() {
  try {
    [reports, techs, settings, logs] = await Promise.all([listReports(user), listTechnicianOverview(), getSettings(), listDispatchLog()]);
  } catch (err) { toast(err.message || "Gagal memuat data."); }
  if (selectedId && !reports.some(r => r.id === selectedId && r.status !== "Selesai" && r.status !== "Ditolak")) selectedId = null;
  if (regionFilter) regionFilter = regionFilterFor(buildRegionTree(reports), regionFilter.name);
  renderControl(); renderSummary(); renderQueue(); renderTechs(); renderRegionTree(); renderTable(); renderLog(); renderDetail(); renderMap(); renderAttention(); renderUndo();
  lab?.refresh();
}
$("regionChipClear").onclick = () => { regionFilter = null; renderRegionTree(); renderTable(); };
$("undoBtn").onclick = undoLast;
$("adminSearch").oninput = renderTable; $("statusFilter").onchange = renderTable;
setInterval(() => { if (!document.hidden && !document.querySelector("select:focus, input:focus, textarea:focus")) load(); }, 30000);
setInterval(() => { if (!document.hidden && reports.some(r => ["pending", "processing"].includes(r.aiStatus)) && !document.querySelector("select:focus, input:focus")) load(); }, 8000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
await load();
if (currentView() === "lab") lab.show();
