import { requireRole, logout } from "./auth-service.js";
import { createReport, listReports } from "./data-service.js";
import { LOCATIONS, distance, escapeHTML, formatDate, googlePlaceUrl, initLeafletMap, markerIcon, parseCoordinates, priorityClass, priorityLabel, setupPortal, statusClass, toast } from "./common.js";

const user = await requireRole("warga"); if (!user) throw new Error("Akses dihentikan");
setupPortal(user, "Warga"); document.getElementById("logoutBtn").onclick = logout; document.getElementById("phone").value = user.phone || "";

const $ = id => document.getElementById(id);
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

// ---------- Riwayat laporan ----------
async function renderReports() {
  const reports = await listReports(user);
  const waiting = reports.filter(r => r.status === "Menunggu Verifikasi").length, active = reports.filter(r => ["Ditugaskan", "Menuju Lokasi"].includes(r.status)).length, done = reports.filter(r => r.status === "Selesai").length;
  $("wargaSummary").innerHTML = `<div><span>Total</span><b>${reports.length}</b></div><div><span>Menunggu</span><b>${waiting}</b></div><div><span>Diproses</span><b>${active}</b></div><div><span>Selesai</span><b>${done}</b></div>`;
  $("citizenReports").innerHTML = reports.length ? [...reports].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(r => `<article class="citizen-report"><div><span class="section-kicker">${escapeHTML(r.id)}</span><h3>${escapeHTML(r.category)}</h3></div><span class="status-pill ${statusClass(r.status)}">${escapeHTML(r.status)}</span><p>${escapeHTML(r.address)} · ${escapeHTML(r.village)}</p><div class="report-meta"><span class="priority ${priorityClass(r.severity)}">${priorityLabel(r.severity)}</span><small>${formatDate(r.createdAt)}</small><a href="${googlePlaceUrl(r.lat, r.lng)}" target="_blank" rel="noopener">Buka lokasi</a></div></article>`).join("") : '<div class="empty-state"><span>⌁</span><h3>Belum ada laporan</h3><p>Laporan yang Anda kirim akan tampil di sini.</p></div>';
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
    const r = await createReport(user, { phone: $("phone").value.trim(), category: $("category").value, severity: Number($("severity").value), description: $("description").value.trim(), village: $("village").value, address: $("address").value.trim(), lat: point.lat, lng: point.lng });
    e.target.reset(); $("phone").value = user.phone || ""; clearPoint();
    $("successId").textContent = r.id; $("reportSuccess").classList.add("show");
    await renderReports();
  } catch (err) { toast(err.message || "Laporan gagal dikirim."); }
  finally { submit.disabled = false; submit.textContent = "Kirim laporan"; }
};
$("closeSuccess").onclick = () => $("reportSuccess").classList.remove("show");
$("toHistoryBtn").onclick = () => { $("reportSuccess").classList.remove("show"); $("riwayat").scrollIntoView({ behavior: "smooth" }); };

await renderReports();
if (new URLSearchParams(location.search).has("welcome")) toast("Akun warga berhasil dibuat. Selamat datang di GlowGrid!");
