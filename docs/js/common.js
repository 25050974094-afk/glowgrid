export const DEMO_USERS = [
  { uid: "demo-warga", name: "Warga Demo", email: "warga@glowgrid.demo", password: "Warga123!", role: "warga", phone: "081234567890" },
  { uid: "demo-admin", name: "Admin GlowGrid", email: "admin@glowgrid.demo", password: "Admin123!", role: "admin", phone: "" },
  { uid: "demo-tech-1", name: "Arif Nugroho", email: "teknisi@glowgrid.demo", password: "Teknisi123!", role: "teknisi", phone: "" },
  { uid: "demo-tech-2", name: "Dinda Maharani", email: "dinda@glowgrid.demo", password: "Teknisi123!", role: "teknisi", phone: "" },
  { uid: "demo-tech-3", name: "Raka Pratama", email: "raka@glowgrid.demo", password: "Teknisi123!", role: "teknisi", phone: "" }
];

export const LOCATIONS = {
  "Depot Pakal": [-7.2408, 112.6260],
  "Babat Jerawat": [-7.2429, 112.6267],
  "Benowo": [-7.2398, 112.6072],
  "Pakal": [-7.2400, 112.6195],
  "Sumber Rejo": [-7.2160, 112.6072]
};

export const SAMPLE_REPORTS = [
  { id:"GGR-2601", ownerId:"demo-warga", reporter:"Warga Demo", phone:"081234567890", category:"Lampu padam", severity:3, description:"Dua lampu jalan padam dan bagian tikungan sangat gelap pada malam hari.", village:"Babat Jerawat", address:"Jl. Raya Babat Jerawat, dekat RW 06", lat:-7.2424, lng:112.6278, status:"Menunggu Verifikasi", technicianId:"", technicianName:"", createdAt:"2026-11-23T08:12:00+07:00" },
  { id:"GGR-2602", ownerId:"demo-citizen-2", reporter:"Bagus Setiawan", phone:"085700000908", category:"Penerangan kurang", severity:2, description:"Jarak antarlampu cukup jauh sehingga jalur pejalan kaki kurang terang.", village:"Sumber Rejo", address:"Jalan Sumber Rejo sisi utara", lat:-7.2170, lng:112.6083, status:"Menunggu Verifikasi", technicianId:"", technicianName:"", createdAt:"2026-11-23T08:38:00+07:00" },
  { id:"GGR-2603", ownerId:"demo-citizen-3", reporter:"Rizky Ananda", phone:"082100000411", category:"Menyala pada siang hari", severity:1, description:"Satu lampu tetap menyala sejak pagi di sekitar akses permukiman.", village:"Pakal", address:"Jl. Pakal Madya, dekat pertigaan", lat:-7.2392, lng:112.6204, status:"Ditugaskan", technicianId:"demo-tech-1", technicianName:"Arif Nugroho", createdAt:"2026-11-22T17:20:00+07:00" },
  { id:"GGR-2604", ownerId:"demo-citizen-4", reporter:"Sari Wulandari", phone:"081300000772", category:"Tiang/kabel bermasalah", severity:3, description:"Penutup kabel pada tiang terlihat terbuka. Mohon dilakukan pemeriksaan petugas.", village:"Benowo", address:"Dekat Stasiun Benowo", lat:-7.2342, lng:112.6152, status:"Menuju Lokasi", technicianId:"demo-tech-2", technicianName:"Dinda Maharani", createdAt:"2026-11-22T16:05:00+07:00" },
  { id:"GGR-2605", ownerId:"demo-warga", reporter:"Warga Demo", phone:"081234567890", category:"Lampu padam", severity:2, description:"Lampu di depan fasilitas olahraga padam dan sudah diperiksa secara visual oleh warga.", village:"Babat Jerawat", address:"Akses Taman Cahaya", lat:-7.2413, lng:112.6229, status:"Selesai", technicianId:"demo-tech-3", technicianName:"Raka Pratama", createdAt:"2026-11-21T19:42:00+07:00" }
];

export function escapeHTML(value = "") { const div=document.createElement("div"); div.textContent=String(value); return div.innerHTML; }
export function priorityLabel(n) { return Number(n)===3 ? "Tinggi" : Number(n)===2 ? "Sedang" : "Rendah"; }
export function priorityClass(n) { return Number(n)===3 ? "high" : Number(n)===2 ? "medium" : "low"; }
export function statusClass(v="") { return v.replaceAll(" ", "-"); }
export function formatDate(value) { const date=value?.toDate ? value.toDate() : new Date(value); return new Intl.DateTimeFormat("id-ID",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(date); }
export function toast(message) { const el=document.getElementById("toast"); if(!el) return; el.textContent=message; el.classList.add("show"); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove("show"),3000); }
export function redirectFor(role) { location.href = role === "admin" ? "admin.html" : role === "teknisi" ? "teknisi.html" : "warga.html"; }
export function parseCoordinates(value) {
  // Menerima: "-7.24, 112.62" · "-7.24 112.62" · tautan Google Maps (@lat,lng · q=/query=/destination=lat,lng · !3dlat!4dlng)
  let text=String(value||"").trim(); try{text=decodeURIComponent(text);}catch{} text=text.replace(/−/g,"-");
  const num="(-?\\d{1,3}(?:[.,]\\d+)?)";
  const patterns=[
    new RegExp(`^\\s*${num}\\s*[,;\\s]\\s*${num}\\s*$`),
    /!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
    /(?:@|[?&](?:q|query|ll|destination|center)=)(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/i
  ];
  let m=null; for(const p of patterns){ m=text.match(p); if(m) break; }
  if(!m) return null;
  const lat=Number(String(m[1]).replace(",",".")),lng=Number(String(m[2]).replace(",","."));
  return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180?{lat,lng}:null;
}
export function distance([a,b],[c,d]) { const r=n=>n*Math.PI/180,R=6371,x=r(c-a),y=r(d-b),q=Math.sin(x/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(y/2)**2; return R*2*Math.atan2(Math.sqrt(q),Math.sqrt(1-q)); }

export function setupPortal(user, roleLabel) {
  // Saat keyboard HP terbuka, sembunyikan menu bawah & tombol melayang agar kolom yang diketik tidak tertutup.
  const typing = e => e.target.matches?.("input:not([type=checkbox]):not([type=file]):not([type=radio]), textarea");
  document.addEventListener("focusin", e => { if (typing(e)) document.body.classList.add("kb-open"); });
  document.addEventListener("focusout", e => { if (typing(e)) document.body.classList.remove("kb-open"); });
  const name=document.getElementById("profileName"), role=document.getElementById("profileRole"), avatar=document.getElementById("profileAvatar");
  if(name) name.textContent=user.name; if(role) role.textContent=roleLabel; if(avatar) avatar.textContent=user.name.split(" ").map(x=>x[0]).slice(0,2).join("").toUpperCase();
}

// Peta bergaya Google Maps (Leaflet + tile Google). Tanpa API key.
// Tombol kanan atas: Peta / Satelit. Jika tile Google gagal dimuat, otomatis pindah ke OpenStreetMap.
const GOOGLE_TILE = lyrs => `https://{s}.google.com/vt/lyrs=${lyrs}&hl=id&x={x}&y={y}&z={z}`;
export function initLeafletMap(id, center=[-7.236,112.617], zoom=14) {
  const el=document.getElementById(id); if(!el) return null;
  if(typeof L==="undefined") { el.innerHTML='<div class="map-fallback"><strong>Peta belum dapat dimuat.</strong><br>Periksa koneksi internet lalu muat ulang.</div>'; return null; }
  const map=L.map(id,{zoomControl:true}).setView(center,zoom);
  const opts={subdomains:["mt0","mt1","mt2","mt3"],maxZoom:20,attribution:"Map data &copy; Google"};
  const road=L.tileLayer(GOOGLE_TILE("m"),opts).addTo(map);
  const satellite=L.tileLayer(GOOGLE_TILE("y"),opts);
  L.control.layers({"Peta":road,"Satelit":satellite},null,{position:"topright"}).addTo(map);
  let errors=0,switched=false; road.on("tileerror",()=>{ if(++errors<4||switched)return; switched=true; map.removeLayer(road); L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{subdomains:"abc",maxZoom:19,attribution:"&copy; OpenStreetMap contributors"}).addTo(map); });
  return map;
}

// Tautan navigasi Google Maps dari lokasi pengguna saat ini ke titik tujuan.
export function googleDirectionsUrl(lat,lng) { return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`; }
export function googlePlaceUrl(lat,lng) { return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`; }

export function markerIcon(status="Menunggu Verifikasi") {
  const colors={"Menunggu Verifikasi":"#ffb84d","Ditugaskan":"#3e83f8","Menuju Lokasi":"#5552d9","Selesai":"#9a67e8","Ditolak":"#7c8298"};
  return L.divIcon({className:"",html:`<div class="custom-marker" style="background:${colors[status]||colors["Menunggu Verifikasi"]}"><span></span></div>`,iconSize:[26,26],iconAnchor:[12,24]});
}

// ---------- Foto ----------
// Perkecil foto di perangkat sebelum diunggah (maks. 1280 px, JPEG) agar hemat kuota & cepat di jaringan seluler.
export async function compressImage(file, maxSide = 1280, quality = 0.8) {
  if (!file || !file.type?.startsWith("image/")) throw new Error("File harus berupa gambar (JPG/PNG).");
  if (file.size > 15 * 1024 * 1024) throw new Error("Ukuran foto terlalu besar (maks. 15 MB).");
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { throw new Error("Format foto tidak didukung. Gunakan JPG atau PNG."); }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", quality));
  if (!blob) throw new Error("Foto gagal diproses.");
  return blob;
}

// Penampil foto layar penuh (dibuat sekali, dipakai semua halaman)
export function openPhoto(url, caption = "") {
  let box = document.getElementById("photoViewer");
  if (!box) {
    box = document.createElement("div"); box.id = "photoViewer"; box.className = "photo-viewer";
    box.innerHTML = '<button type="button" class="photo-close" aria-label="Tutup">×</button><figure><img alt=""><figcaption></figcaption></figure>';
    box.addEventListener("click", e => { if (e.target === box || e.target.classList.contains("photo-close")) box.classList.remove("show"); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") box.classList.remove("show"); });
    document.body.appendChild(box);
  }
  box.querySelector("img").src = url; box.querySelector("figcaption").textContent = caption;
  box.classList.add("show");
}

// Langkah timeline status laporan
export const TIMELINE_STEPS = [
  { status: "Menunggu Verifikasi", label: "Dilaporkan" },
  { status: "Ditugaskan", label: "Ditugaskan" },
  { status: "Menuju Lokasi", label: "Menuju lokasi" },
  { status: "Selesai", label: "Selesai" }
];

// ---------- Navigasi multi-halaman (hash router) ----------
// Setiap <section data-view="nama"> adalah satu halaman. Menu: <a data-nav="nama" href="#nama">.
// Alamat per halaman (mis. admin.html#peta), tombol Back browser berfungsi, dan bisa di-bookmark.
let viewHandlers = [];
export function currentView() { return document.body.dataset.currentView || ""; }
export function navigate(name) { if (location.hash !== "#" + name) location.hash = name; else showView(name); }
export function onViewChange(fn) { viewHandlers.push(fn); }
function showView(name) {
  const views = [...document.querySelectorAll("[data-view]:not(body)")];
  const names = new Set(views.flatMap(v => v.dataset.view.split(" ")));
  if (!names.has(name)) name = document.body.dataset.defaultView || [...names][0];
  views.forEach(v => { v.hidden = !v.dataset.view.split(" ").includes(name); });
  document.querySelectorAll("[data-nav]").forEach(a => a.classList.toggle("active", a.dataset.nav === name));
  const changed = document.body.dataset.currentView !== name;
  document.body.dataset.currentView = name;
  if (changed) window.scrollTo({ top: 0 });
  viewHandlers.forEach(fn => fn(name));
}
export function setupViews(defaultView) {
  document.body.dataset.defaultView = defaultView;
  window.addEventListener("hashchange", () => showView(location.hash.slice(1)));
  showView(location.hash.slice(1) || defaultView);
}
