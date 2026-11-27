import { requireRole, logout } from "./auth-service.js";
import { createReport, listEvents, listReports, newReportId, photoUrl, uploadPhoto } from "./data-service.js";
import { LOCATIONS, TIMELINE_STEPS, distance, escapeHTML, formatDate, googlePlaceUrl, navigate, onViewChange, openPhoto, setupViews, initLeafletMap, markerIcon, parseCoordinates, priorityClass, priorityLabel, setupPortal, statusClass, toast } from "./common.js";

const user = await requireRole("warga"); if (!user) throw new Error("Akses dihentikan");
setupPortal(user, "Warga"); document.getElementById("logoutBtn").onclick = logout; document.getElementById("phone").value = user.phone || "";

const $ = id => document.getElementById(id);
setupViews("lapor");
const coordInput = $("coordinates"), coordStatus = $("coordStatus"), mapLink = $("googleMapLink");
const AREA_CENTER = [-7.236, 112.617];
let point = null;   // titik terpilih: {lat, lng}
let marker = null;

// ---------- Peta (satu peta bergaya Google Maps) ----------
const map = initLeafletMap("reportMap");
if (map) {
  L.circle(AREA_CENTER, { radius: 2800, color: "#5552d9", fillOpacity: .03, weight: 1, dashArray: "5 5", interactive: false }).addTo(map);
  map.on("click", e => setPoint(e.latlng.lat, e.latlng.lng, { source: "map" }));
}

onViewChange(view => { if (view === "lapor" && map) setTimeout(() => map.invalidateSize(), 60); });

function setStatus(text, kind = "") { coordStatus.textContent = text; coordStatus.className = `coord-status ${kind}`; }

// Pusat logika: dipanggil dari klik peta, geser penanda, ketik koordinat, GPS, atau pencarian alamat.
function setPoint(lat, lng, { source = "map", zoom } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  point = { lat, lng };
  const text = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  if (source !== "input") coordInput.value = text;          // jangan timpa saat pengguna sedang mengetik
  mapLink.href = googlePlaceUrl(lat, lng); mapLink.classList.remove("disabled");

  if (map) {
    if (marker) marker.setLatLng([lat, lng]);
    else {
      marker = L.marker([lat, lng], { icon: markerIcon(), draggable: true }).addTo(map);
      marker.on("dragend", () => { const p = marker.getLatLng(); setPoint(p.lat, p.lng, { source: "drag" }); });
    }
    marker.bindPopup(`<strong>Titik laporan</strong><br>${text}`);
    if (source === "map" || source === "drag") map.panTo([lat, lng]);
    else map.setView([lat, lng], zoom || Math.max(map.getZoom(), 17));
  }

  const km = distance(AREA_CENTER, [lat, lng]);
  if (km > 6) setStatus(`✓ Titik dipilih: ${text} — perhatian: lokasi ini ±${km.toFixed(1)} km dari Kecamatan Pakal.`, "warn");
  else setStatus(`✓ Titik dipilih: ${text}`, "ok");

  // Pilih kelurahan terdekat secara otomatis (tetap bisa diganti manual).
  const closest = Object.entries(LOCATIONS).filter(([n]) => n !== "Depot Pakal").sort((a, b) => distance([lat, lng], a[1]) - distance([lat, lng], b[1]))[0];
  if (closest) $("village").value = closest[0];
}

function clearPoint() {
  point = null; if (marker) { marker.remove(); marker = null; }
  mapLink.classList.add("disabled"); mapLink.href = "#";
  setStatus("Belum ada titik. Klik peta, ketik koordinat, atau tempel tautan Google Maps.");
}

// ---------- Ketik / tempel koordinat → peta langsung bergerak ----------
let typingTimer;
coordInput.addEventListener("input", () => {
  clearTimeout(typingTimer);
  const raw = coordInput.value.trim();
  if (!raw) return clearPoint();
  typingTimer = setTimeout(() => {
    const found = parseCoordinates(raw);
    if (found) setPoint(found.lat, found.lng, { source: "input" });
    else setStatus("Format belum dikenali. Contoh: -7.240000, 112.619500 atau tautan Google Maps.", "error");
  }, 400);
});
coordInput.addEventListener("keydown", e => { if (e.key === "Enter") e.preventDefault(); });
coordInput.addEventListener("blur", () => { if (point) coordInput.value = `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`; });

// ---------- Lokasi perangkat ----------
$("locateBtn").onclick = () => {
  if (!navigator.geolocation) return toast("Geolokasi tidak didukung perangkat.");
  setStatus("Mencari lokasi perangkat...");
  navigator.geolocation.getCurrentPosition(
    p => { setPoint(p.coords.latitude, p.coords.longitude, { source: "gps", zoom: 18 }); toast("Lokasi perangkat berhasil digunakan."); },
    () => { toast("Izin lokasi ditolak. Klik peta atau ketik koordinat."); if (!point) clearPoint(); },
    { enableHighAccuracy: true, timeout: 8000 }
  );
};

// ---------- Cari alamat (OpenStreetMap Nominatim, gratis tanpa key) ----------
async function searchPlace() {
  const q = $("placeQuery").value.trim();
  if (!q) return toast("Ketik alamat atau nama tempat.");
  const btn = $("placeSearchBtn"); btn.disabled = true; btn.textContent = "Mencari...";
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=id&accept-language=id&viewbox=112.57,-7.19,112.67,-7.28&q=${encodeURIComponent(q + ", Surabaya")}`;
    let res = await (await fetch(url)).json();
    if (!res.length) res = await (await fetch(url.replace(encodeURIComponent(q + ", Surabaya"), encodeURIComponent(q)))).json();
    if (!res.length) return toast("Tempat tidak ditemukan. Coba kata kunci lain atau klik langsung di peta.");
    setPoint(Number(res[0].lat), Number(res[0].lon), { source: "search", zoom: 18 });
    toast("Tempat ditemukan. Geser penanda bila perlu agar lebih tepat.");
  } catch { toast("Pencarian gagal. Periksa koneksi internet."); }
  finally { btn.disabled = false; btn.textContent = "Cari"; }
}
$("placeSearchBtn").onclick = searchPlace;
$("placeQuery").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); searchPlace(); } });

// ---------- Peringatan keselamatan (bahaya listrik → PLN 123) ----------
const DANGER_WORDS = /\b(kabel\w*|terkelupas|ngelotok|percik\w*|api|asap|\w*setrum|korsl?et\w*|konslet\w*|roboh|tumbang|menjuntai)\b/i;
function updateDangerNote() {
  const show = $("category").value === "Tiang/kabel bermasalah" || DANGER_WORDS.test($("description").value);
  $("dangerNote").hidden = !show;
}
$("category").addEventListener("change", updateDangerNote);
$("description").addEventListener("input", updateDangerNote);

// ---------- Foto kondisi (opsional) ----------
let selectedPhoto = null;
function clearPhoto() {
  selectedPhoto = null; $("photoInput").value = "";
  const img = $("photoPreview"); if (img.src) URL.revokeObjectURL(img.src);
  img.hidden = true; img.removeAttribute("src"); $("photoRemove").hidden = true; $("photoDrop").classList.remove("has-photo");
}
$("photoInput").addEventListener("change", () => {
  const file = $("photoInput").files[0];
  if (!file) return clearPhoto();
  if (!file.type.startsWith("image/")) { clearPhoto(); return toast("File harus berupa gambar."); }
  selectedPhoto = file;
  const img = $("photoPreview"); img.src = URL.createObjectURL(file); img.hidden = false;
  $("photoRemove").hidden = false; $("photoDrop").classList.add("has-photo");
});
$("photoRemove").onclick = clearPhoto;

// ---------- Riwayat laporan + timeline status ----------
function timelineHTML(r, events) {
  const evs = events || [];
  const lastOf = st => [...evs].reverse().find(e => e.status === st);
  if (r.status === "Ditolak") {
    const first = evs.find(e => e.status === "Menunggu Verifikasi"), end = lastOf("Ditolak");
    return `<ol class="timeline rejected"><li class="done"><b>Dilaporkan</b><small>${first ? formatDate(first.createdAt) : formatDate(r.createdAt)}</small></li>
      <li class="done stop"><b>Ditolak</b><small>${end ? formatDate(end.createdAt) : ""}</small></li></ol>`;
  }
  const current = Math.max(0, TIMELINE_STEPS.findIndex(s => s.status === r.status));
  return `<ol class="timeline">${TIMELINE_STEPS.map((step, i) => {
    const ev = i === 0 ? evs.find(e => e.status === step.status) : lastOf(step.status);
    const state = i < current ? "done" : i === current ? (r.status === "Selesai" ? "done" : "current") : "";
    const time = i === 0 ? formatDate(ev?.createdAt || r.createdAt) : state && ev ? formatDate(ev.createdAt) : "";
    const note = i === 1 && state && r.technicianName ? r.technicianName : "";
    return `<li class="${state}"><b>${step.label}</b>${note ? `<span>${escapeHTML(note)}</span>` : ""}<small>${time}</small></li>`;
  }).join("")}</ol>`;
}
async function photoThumbs(r) {
  const items = [];
  if (r.photoPath) items.push({ url: await photoUrl(r.photoPath), label: "Foto laporan" });
  if (r.proofPath) items.push({ url: await photoUrl(r.proofPath), label: "Bukti perbaikan" });
  return items.filter(x => x.url).map(x => `<button type="button" class="thumb" data-photo="${escapeHTML(x.url)}" data-caption="${escapeHTML(x.label + " · " + r.id)}"><img src="${escapeHTML(x.url)}" alt="${x.label}" loading="lazy"><span>${x.label}</span></button>`).join("");
}

async function renderReports() {
  const reports = await listReports(user);
  const waiting = reports.filter(r => r.status === "Menunggu Verifikasi").length, active = reports.filter(r => ["Ditugaskan", "Menuju Lokasi"].includes(r.status)).length, done = reports.filter(r => r.status === "Selesai").length;
  document.querySelectorAll(".js-nav-badge").forEach(badge => { badge.textContent = waiting + active || ""; badge.title = `${waiting + active} laporan sedang diproses`; });
  document.querySelectorAll(".js-summary").forEach(el => el.innerHTML = `<div><span>Total</span><b>${reports.length}</b></div><div><span>Menunggu</span><b>${waiting}</b></div><div><span>Diproses</span><b>${active}</b></div><div><span>Selesai</span><b>${done}</b></div>`);
  if (!reports.length) { $("citizenReports").innerHTML = '<div class="empty-state"><span>⌁</span><h3>Belum ada laporan</h3><p>Laporan yang Anda kirim akan tampil di sini.</p></div>'; return; }
  const sorted = [...reports].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const events = await listEvents(sorted.map(r => r.id)).catch(() => ({}));
  const cards = await Promise.all(sorted.map(async r => `<article class="citizen-report">
      <div><span class="section-kicker">${escapeHTML(r.id)}</span><h3>${escapeHTML(r.category)}</h3></div>
      <span class="status-pill ${statusClass(r.status)}">${escapeHTML(r.status)}</span>
      <p>${escapeHTML(r.address)} · ${escapeHTML(r.village)}</p>
      ${timelineHTML(r, events[r.id])}
      ${await photoThumbs(r).then(t => t ? `<div class="thumbs">${t}</div>` : "")}
      <div class="report-meta"><span class="priority ${priorityClass(r.severity)}">${priorityLabel(r.severity)}</span><small>${formatDate(r.createdAt)}</small><a href="${googlePlaceUrl(r.lat, r.lng)}" target="_blank" rel="noopener">Buka lokasi</a></div></article>`));
  $("citizenReports").innerHTML = cards.join("");
  document.querySelectorAll("[data-photo]").forEach(b => b.onclick = () => openPhoto(b.dataset.photo, b.dataset.caption));
}
$("refreshBtn").onclick = () => renderReports().then(() => toast("Data laporan diperbarui."));

// ---------- Kirim laporan ----------
$("reportForm").onsubmit = async e => {
  e.preventDefault();
  if (!point) {
    const typed = parseCoordinates(coordInput.value);
    if (typed) setPoint(typed.lat, typed.lng, { source: "input" });
  }
  if (!point) {
    setStatus("Titik lokasi wajib dipilih: klik peta, gunakan lokasi saya, atau ketik koordinat.", "error");
    $("reportMap").scrollIntoView({ behavior: "smooth", block: "center" });
    return toast("Tentukan titik lokasi laporan terlebih dahulu.");
  }
  const submit = $("submitBtn"); submit.disabled = true; submit.textContent = "Mengirim...";
  try {
    const id = newReportId();
    let photoPath = "";
    if (selectedPhoto) { submit.textContent = "Mengunggah foto..."; photoPath = await uploadPhoto(user, id, "laporan", selectedPhoto); submit.textContent = "Mengirim..."; }
    const r = await createReport(user, { id, photoPath, phone: $("phone").value.trim(), category: $("category").value, severity: Number($("severity").value), description: $("description").value.trim(), village: $("village").value, address: $("address").value.trim(), lat: point.lat, lng: point.lng });
    e.target.reset(); $("phone").value = user.phone || ""; clearPoint(); updateDangerNote(); clearPhoto();
    $("successId").textContent = r.id; $("reportSuccess").classList.add("show");
    await renderReports();
  } catch (err) { toast(err.message || "Laporan gagal dikirim."); }
  finally { submit.disabled = false; submit.textContent = "Kirim laporan"; }
};
$("closeSuccess").onclick = () => $("reportSuccess").classList.remove("show");
$("toHistoryBtn").onclick = () => { $("reportSuccess").classList.remove("show"); navigate("riwayat"); };

await renderReports();
if (new URLSearchParams(location.search).has("welcome")) toast("Akun warga berhasil dibuat. Selamat datang di GlowGrid!");
