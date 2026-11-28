import { requireRole, logout } from "./auth-service.js";
import { declineTask, getMyTechStatus, getSettings, heartbeat, listReports, photoUrl, setMyStatus, updateReport, uploadPhoto } from "./data-service.js";
import { buildPakalGraph, buildRouteList } from "./structures.js";
import { LOCATIONS, escapeHTML, formatDate, googleDirectionsUrl, openPhoto, initLeafletMap, markerIcon, setupPortal, toast } from "./common.js";

// ---------- Graph wilayah (Dijkstra) + rute sebagai Linked List · lihat js/structures.js ----------
const graph = buildPakalGraph();

const user = await requireRole("teknisi"); if (!user) throw new Error("Akses dihentikan");
setupPortal(user, "Teknisi Lapangan"); document.getElementById("logoutBtn").onclick = logout;
const $ = id => document.getElementById(id);
const map = initLeafletMap("routeMap"), layers = [];
let lastBounds = null;
let reports = [], myStatus = null, settings = null, knownTaskIds = null, declineId = null;

const STATUS = {
  ready:     { label: "Ready",     hint: "Sistem dapat memberi Anda tugas baru." },
  fokus:     { label: "Fokus",     hint: "Tugas yang ada tetap berjalan. Tidak menerima tugas baru." },
  istirahat: { label: "Istirahat", hint: "Tidak menerima tugas baru. Pilih Ready bila sudah siap." },
  off:       { label: "Off",       hint: "Tidak bertugas. Tidak menerima tugas." }
};
const activeTasks = () => reports.filter(r => ["Ditugaskan", "Menuju Lokasi"].includes(r.status));

// ---------- Panel status ----------
function renderStatus() {
  if (!myStatus) { $("myStatusPill").textContent = "Belum terdaftar"; $("statusHint").textContent = "Status teknisi belum tersedia. Hubungi admin."; return; }
  const load = activeTasks().length, full = load >= myStatus.capacity;
  const key = myStatus.status === "ready" && full ? "penuh" : myStatus.status;
  const pill = $("myStatusPill");
  pill.className = `tech-status ${key}`;
  pill.textContent = key === "penuh" ? "Penuh" : STATUS[myStatus.status].label;
  $("myLoad").textContent = `${load}/${myStatus.capacity} tugas`;
  $("onCallBadge").hidden = !myStatus.isOnCall;
  $("statusHint").textContent = key === "penuh" ? "Kapasitas penuh. Tugas baru menunggu sampai ada yang selesai." : STATUS[myStatus.status].hint;
  document.querySelectorAll("[data-status]").forEach(b => b.classList.toggle("active", b.dataset.status === myStatus.status));
  if (settings) {
    const auto = settings.autoDispatch;
    $("modeNote").innerHTML = auto
      ? `Penugasan <b>otomatis</b> aktif${settings.isNight ? ` · <b>jam malam</b> (hanya teknisi piket, urgensi ≥ ${settings.nightMinUrgency})` : ""}.`
      : "Penugasan saat ini dilakukan <b>manual oleh admin</b>.";
  }
}

async function changeStatus(status, { silent = false } = {}) {
  try {
    myStatus = await setMyStatus(user, status);
    await loadReports();                      // status Ready bisa langsung memicu tugas baru
    renderStatus();
    if (!silent) toast(`Status diubah ke ${STATUS[status].label}.`);
  } catch (err) { toast(err.message || "Status gagal diubah."); }
}
document.querySelectorAll("[data-status]").forEach(b => b.onclick = () => changeStatus(b.dataset.status));

// ---------- Urutan tugas: disisipkan ke LinkedList (urgensi tertinggi, lalu jarak Dijkstra terdekat) ----------
function orderTasks(items) { return buildRouteList(items, graph).toArray(); }
function fullRouteUrl(tasks) {   // Depot → titik 1 → ... → titik terakhir (maks. 9 titik singgah)
  const pts = tasks.slice(0, 10).map(r => `${r.lat},${r.lng}`), dest = pts.pop(), [dlat, dlng] = LOCATIONS["Depot Pakal"];
  let url = `https://www.google.com/maps/dir/?api=1&origin=${dlat},${dlng}&destination=${dest}&travelmode=driving`;
  if (pts.length) url += `&waypoints=${encodeURIComponent(pts.join("|"))}`;
  return url;
}
function urgencyClass(u) { return u >= 70 ? "high" : u >= 45 ? "medium" : "low"; }

function renderMap(tasks) {
  if (!map) return;
  layers.splice(0).forEach(x => x.remove());
  const points = [LOCATIONS["Depot Pakal"]];
  layers.push(L.marker(points[0], { icon: markerIcon("Selesai") }).addTo(map).bindPopup("Depot teknisi"));
  tasks.forEach(r => {
    points.push([r.lat, r.lng]);
    layers.push(L.marker([r.lat, r.lng], { icon: markerIcon(r.status) }).addTo(map)
      .bindPopup(`<strong>${escapeHTML(r.id)}</strong><br>${escapeHTML(r.address)}<br><a class="nav-button popup-nav" target="_blank" rel="noopener" href="${googleDirectionsUrl(r.lat, r.lng)}">➤ Navigasi</a>`));
  });
  if (points.length > 1) { const line = L.polyline(points, { color: "#5552d9", weight: 4, dashArray: "8 8" }).addTo(map); layers.push(line); lastBounds = L.latLngBounds(points).pad(.25); map.fitBounds(lastBounds); }
  else { lastBounds = null; map.setView(LOCATIONS["Depot Pakal"], 14); }
}

function render(newIds = new Set()) {
  const tasks = orderTasks(activeTasks());
  $("bnTaskBadge").textContent = tasks.length || "";
  $("taskCount").textContent = `${tasks.length} tugas`; $("routeBadge").textContent = `${tasks.length} titik`;
  $("taskList").innerHTML = tasks.length ? tasks.map((r, i) => `
    <article class="task-card ${newIds.has(r.id) ? "is-new" : ""}">
      <div class="task-card-head"><div><span class="section-kicker">Rute ${i + 1} · ${escapeHTML(r.id)}${newIds.has(r.id) ? ' · <b class="new-tag">BARU</b>' : ""}</span>
        <h3>${escapeHTML(r.village)} — ${escapeHTML(r.category)}</h3></div>
        <span class="urgency-chip ${urgencyClass(r.urgency)}" title="Skor urgensi 0–100">${r.urgency}</span></div>
      <p>${escapeHTML(r.address)}<br>Status: <b>${escapeHTML(r.status)}</b>${r.assignedBy ? ` · ditugaskan ${r.assignedBy === "sistem" ? "otomatis" : "oleh admin"}` : ""}</p>
      ${r.urgencyNotes?.length ? `<div class="note-tags">${r.urgencyNotes.map(n => `<span>${escapeHTML(n)}</span>`).join("")}</div>` : ""}
      ${r.aiSummary ? `<p class="ai-summary">✦ ${escapeHTML(r.aiSummary)}</p>` : ""}
      <p class="task-desc">${escapeHTML(r.description || "")}</p>
      ${r.photoPath ? `<button type="button" class="thumb wide" data-photo-path="${escapeHTML(r.photoPath)}" data-caption="Foto dari warga · ${escapeHTML(r.id)}"><img alt="Foto dari warga" loading="lazy"><span>Foto dari warga</span></button>` : ""}
      <a class="nav-button" target="_blank" rel="noopener" href="${googleDirectionsUrl(r.lat, r.lng)}"><span aria-hidden="true">➤</span> Navigasi Google Maps</a>
      <div class="task-actions">
        ${r.status === "Ditugaskan" ? `<button data-action="start" data-id="${r.id}">Mulai perjalanan</button>` : ""}
        <button class="complete" data-action="complete" data-id="${r.id}">Tandai selesai</button>
      </div>
      ${r.status === "Ditugaskan" ? `<button type="button" class="decline-button" data-action="decline" data-id="${r.id}">Tidak bisa mengerjakan? Tolak tugas</button>` : ""}
    </article>`).join("")
    : '<div class="empty-state"><span>✓</span><h3>Tidak ada tugas aktif</h3><p>Tugas baru akan muncul di sini. Pastikan status Anda <b>Ready</b>.</p></div>';
  document.querySelectorAll("[data-action]").forEach(b => b.onclick = () => onTaskAction(b.dataset.id, b.dataset.action));
  document.querySelectorAll("[data-photo-path]").forEach(async b => {
    const url = await photoUrl(b.dataset.photoPath);
    if (!url) { b.remove(); return; }
    b.querySelector("img").src = url; b.onclick = () => openPhoto(url, b.dataset.caption);
  });

  let total = 0, from = "Depot Pakal"; const stops = [from];
  tasks.forEach(r => { const s = graph.shortestPath(from, r.village); total += Number.isFinite(s.distance) ? s.distance : 0; from = r.village; stops.push(r.village); });
  $("routeSummary").innerHTML = tasks.length
    ? `<div class="route-steps">${stops.map((x, i) => `${i ? '<span class="route-arrow">›</span>' : ""}<span class="route-step">${escapeHTML(x)}</span>`).join("")}</div><small>Estimasi bobot graph ${total.toFixed(1)} km · urutan urgensi lalu jarak terpendek.</small><a class="nav-button route-nav" target="_blank" rel="noopener" href="${fullRouteUrl(tasks)}"><span aria-hidden="true">➤</span> Buka seluruh rute di Google Maps</a>`
    : "<p>Rute akan muncul setelah ada tugas.</p>";
  renderMap(tasks);
  renderStatus();
}

// ---------- Aksi tugas ----------
async function onTaskAction(id, action) {
  if (action === "decline") return openDecline(id);
  if (action === "complete") return openProof(id);
  try { await updateReport(id, { status: "Menuju Lokasi" }); await loadReports(); toast("Status diperbarui: menuju lokasi."); }
  catch (err) { toast(err.message || "Status gagal diperbarui."); }
}

// ---------- Foto bukti wajib sebelum "Selesai" ----------
let proofId = null, proofFile = null;
function resetProof() {
  proofFile = null; $("proofInput").value = ""; $("confirmProof").disabled = true;
  const img = $("proofPreview"); if (img.src) URL.revokeObjectURL(img.src); img.hidden = true; img.removeAttribute("src");
  $("proofDrop").classList.remove("has-photo");
}
function openProof(id) { proofId = id; resetProof(); $("proofTitle").textContent = `Selesaikan ${id}`; $("proofModal").classList.add("show"); }
const closeProof = () => { $("proofModal").classList.remove("show"); proofId = null; resetProof(); };
$("closeProof").onclick = closeProof; $("cancelProof").onclick = closeProof;
$("proofInput").addEventListener("change", () => {
  const file = $("proofInput").files[0];
  if (!file) return resetProof();
  if (!file.type.startsWith("image/")) { resetProof(); return toast("File harus berupa gambar."); }
  proofFile = file; const img = $("proofPreview"); img.src = URL.createObjectURL(file); img.hidden = false;
  $("proofDrop").classList.add("has-photo"); $("confirmProof").disabled = false;
});
$("confirmProof").onclick = async () => {
  if (!proofFile) return toast("Ambil foto bukti terlebih dahulu.");
  const btn = $("confirmProof"), id = proofId; btn.disabled = true; btn.textContent = "Mengunggah foto...";
  try {
    const proofPath = await uploadPhoto(user, id, "bukti", proofFile);
    btn.textContent = "Menyimpan...";
    await updateReport(id, { status: "Selesai", proofPath });
    closeProof();
    myStatus = await getMyTechStatus(user);           // database otomatis mengubah status ke Istirahat
    await loadReports();
    $("doneModal").classList.add("show");             // teknisi memilih status berikutnya
  } catch (err) { toast(err.message || "Gagal menyelesaikan tugas."); btn.disabled = false; }
  finally { btn.textContent = "Kirim & tandai selesai"; }
};
document.querySelectorAll("[data-next]").forEach(b => b.onclick = async () => {
  $("doneModal").classList.remove("show");
  await changeStatus(b.dataset.next);
});

function openDecline(id) {
  declineId = id; $("declineTitle").textContent = `Tolak tugas ${id}`; $("declineReason").value = "";
  $("declineModal").classList.add("show"); setTimeout(() => $("declineReason").focus(), 50);
}
const closeDecline = () => { $("declineModal").classList.remove("show"); declineId = null; };
$("closeDecline").onclick = closeDecline; $("cancelDecline").onclick = closeDecline;
$("confirmDecline").onclick = async () => {
  const reason = $("declineReason").value.trim();
  if (reason.length < 3) return toast("Tuliskan alasan penolakan.");
  const btn = $("confirmDecline"); btn.disabled = true;
  try { await declineTask(declineId, reason); closeDecline(); await loadReports(); toast("Tugas dikembalikan ke antrean."); }
  catch (err) { toast(err.message || "Tugas gagal ditolak."); }
  finally { btn.disabled = false; }
};

// ---------- Muat data + notifikasi tugas baru ----------
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)(), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.value = 880; g.gain.setValueAtTime(.15, ctx.currentTime); g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .4);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + .4);
  } catch {}
}
async function loadReports({ notify = false } = {}) {
  reports = await listReports(user);
  const ids = new Set(activeTasks().map(r => r.id));
  const fresh = knownTaskIds ? new Set([...ids].filter(id => !knownTaskIds.has(id))) : new Set();
  knownTaskIds = ids;
  render(fresh);
  if (notify && fresh.size) {
    toast(fresh.size === 1 ? `Tugas baru: ${[...fresh][0]}` : `${fresh.size} tugas baru masuk.`); beep();
    document.title = `(${fresh.size}) Tugas baru · GlowGrid`;
  }
}
async function refreshAll({ notify = false } = {}) {
  try {
    [myStatus, settings] = await Promise.all([getMyTechStatus(user), getSettings().catch(() => null)]);
    await loadReports({ notify });
  } catch (err) { toast(err.message || "Gagal memuat data."); }
}

// ---------- Tab bawah (hanya terlihat di HP) ----------
const mobileQuery = window.matchMedia("(max-width: 640px)");
function setTab(tab) {
  document.body.dataset.mtab = tab;
  document.querySelectorAll("[data-mtab-btn]").forEach(b => b.classList.toggle("active", b.dataset.mtabBtn === tab));
  window.scrollTo({ top: 0 });
  if (tab === "rute") fixMapSize();
}
function fixMapSize() { if (map) setTimeout(() => { map.invalidateSize(); if (lastBounds) map.fitBounds(lastBounds); }, 60); }
document.querySelectorAll("[data-mtab-btn]").forEach(b => b.onclick = () => setTab(b.dataset.mtabBtn));
$("bnRefresh").onclick = () => refreshAll().then(() => toast("Data dan rute diperbarui."));
mobileQuery.addEventListener?.("change", fixMapSize);

$("refreshRouteBtn").onclick = () => refreshAll().then(() => toast("Data dan rute diperbarui."));
document.addEventListener("visibilitychange", () => { if (!document.hidden) { document.title = "Ruang Teknisi | GlowGrid"; heartbeat().catch(() => {}); refreshAll({ notify: true }); } });
setInterval(() => { if (!document.hidden) refreshAll({ notify: true }); }, 30000);   // cek tugas baru tiap 30 detik
setInterval(() => heartbeat().catch(() => {}), 120000);                               // tanda masih aktif tiap 2 menit

await heartbeat().catch(() => {});
await refreshAll();
