// =====================================================================
// GlowGrid · Lab Struktur Data (menu admin)
// Simulasi + visualisasi + kode asli untuk setiap struktur data yang dipakai aplikasi.
// Semua simulasi memakai kelas yang SAMA dengan aplikasi (js/structures.js).
// =====================================================================
import { Stack, Queue, PriorityQueue, LinkedList, RegionTree, buildRegionTree, buildPakalGraph, WeightedGraph,
         PAKAL_EDGES, PAKAL_VILLAGES } from "./structures.js";
import { runStructureTests, runBenchmarks } from "./structures.test.js";
import { escapeHTML as esc, navigate, toast } from "./common.js";
import { getSettings, listReports, queuePriority } from "./data-service.js";
import { SUPABASE_URL } from "./supabase-config.js";

const CATEGORIES = ["Lampu padam", "Menyala pada siang hari", "Penerangan kurang", "Tiang/kabel bermasalah"];
const TABS = [
  { key: "stack", letter: "S", label: "Stack", sub: "LIFO · Urungkan" },
  { key: "queue", letter: "Q", label: "Queue", sub: "Antrean prioritas" },
  { key: "linked", letter: "L", label: "Linked List", sub: "Rute teknisi" },
  { key: "recursion", letter: "R", label: "Rekursif", sub: "Call stack" },
  { key: "tree", letter: "T", label: "Tree", sub: "Pohon wilayah" },
  { key: "graph", letter: "G", label: "Graph", sub: "Dijkstra" },
  { key: "db", letter: "D", label: "Database", sub: "Multi-user" },
  { key: "tests", letter: "✓", label: "Uji & Ringkasan", sub: "Bukti pengujian" }
];

// ---------------------------------------------------------------------
// Utilitas umum
// ---------------------------------------------------------------------
let speed = 1;
const wait = ms => new Promise(r => setTimeout(r, ms / speed));
const fmtKm = n => Number.isFinite(n) ? `${n.toFixed(1).replace(".", ",")} km` : "∞";
const ago = v => { if (!v) return "—"; const m = Math.round((Date.now() - new Date(v)) / 60000); return m < 1 ? "baru saja" : m < 60 ? `${m} mnt lalu` : m < 1440 ? `${Math.round(m / 60)} jam lalu` : `${Math.round(m / 1440)} hari lalu`; };

const SOURCES = {};
const loadSource = file => SOURCES[file] ??= fetch(new URL(`./${file}`, import.meta.url)).then(r => r.ok ? r.text() : "").catch(() => "");

/** Ambil potongan kode di antara // #region NAMA dan // #endregion NAMA (nomor baris asli tetap). */
function extractRegion(src, name) {
  const lines = src.split("\n");
  const start = lines.findIndex(l => l.trim() === `// #region ${name}`);
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && l.trim() === `// #endregion ${name}`);
  const body = [];
  for (let i = start + 1; i < end; i++) if (!/^\s*\/\/ #(end)?region\b/.test(lines[i])) body.push({ no: i + 1, text: lines[i] });
  return dedent(body);
}
/** Ambil satu fungsi "export async function NAMA" lengkap (pencocokan kurung kurawal). */
function extractFunction(src, name) {
  const lines = src.split("\n");
  const start = lines.findIndex(l => new RegExp(`^(export )?(async )?function ${name}\\b`).test(l));
  if (start < 0) return null;
  let depth = 0, end = start;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) { if (ch === "{") depth++; else if (ch === "}") depth--; }
    if (depth === 0 && i > start - 1 && lines[i].includes("}")) { end = i; break; }
  }
  return dedent(lines.slice(start, end + 1).map((text, k) => ({ no: start + k + 1, text })));
}
function dedent(body) {
  const indent = Math.min(...body.filter(b => b.text.trim()).map(b => b.text.match(/^ */)[0].length));
  return body.map(b => ({ ...b, text: b.text.slice(indent) }));
}

const JS_KW = "const|let|var|if|else|for|while|do|return|new|class|constructor|this|of|in|break|continue|true|false|null|undefined|export|function|static|get|import|from|typeof|async|await|try|catch|throw";
const SQL_KW = "create|policy|on|for|select|insert|update|delete|to|using|with|check|and|or|not|public|authenticated|table|enable|row|level|security|alter|function|returns|trigger|as|begin|end|if|then|raise|exception|return|new|old|is|distinct|from|declare|language|plpgsql|null|in";
/** Pewarnaan sintaks sederhana (komentar, string, kata kunci, angka, nama fungsi). */
function highlight(text, lang = "js") {
  const kw = lang === "sql" ? SQL_KW : JS_KW;
  const comment = lang === "sql" ? "--[^\\n]*" : "\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/";
  const re = new RegExp(`(${comment})|("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`)|\\b(${kw})\\b|\\b(\\d+(?:\\.\\d+)?)\\b|([A-Za-z_$#][\\w$]*)(?=\\s*\\()`, lang === "sql" ? "gi" : "g");
  let out = "", last = 0;
  for (const m of text.matchAll(re)) {
    out += esc(text.slice(last, m.index));
    const cls = m[1] ? "c" : m[2] ? "s" : m[3] ? "k" : m[4] ? "n" : "f";
    out += `<span class="tk-${cls}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

/** Panel kode: tab per metode, nomor baris asli, kedip saat operasi dijalankan. */
function codePanel(el, { methods, file = "structures.js", title = "Implementasi" }) {
  el.innerHTML = `<div class="lab-head"><div><span class="section-kicker">Kode asli</span><h3>${title}</h3></div></div>
    <div class="code-tabs" role="tablist">${methods.map((m, i) => `<button type="button" role="tab" data-i="${i}" class="${i ? "" : "active"}">${esc(m.label)}</button>`).join("")}</div>
    <div class="code-box"><pre><code></code></pre></div><p class="code-src"></p>`;
  const codeEl = el.querySelector("code"), srcEl = el.querySelector(".code-src"), box = el.querySelector(".code-box");
  async function show(target, flash = false) {
    const i = typeof target === "number" ? target : methods.findIndex(m => m.region === target || m.label === target);
    const m = methods[Math.max(0, i)];
    el.querySelectorAll(".code-tabs button").forEach(b => b.classList.toggle("active", +b.dataset.i === Math.max(0, i)));
    let lines, source;
    if (m.code) { lines = m.code.trim().split("\n").map((text, k) => ({ no: k + 1, text })); source = m.source; }
    else {
      const f = m.file || file, src = await loadSource(f);
      lines = m.fn ? extractFunction(src, m.fn) : extractRegion(src, m.region);
      source = lines?.length ? `js/${f} · baris ${lines[0].no}–${lines.at(-1).no}` : "";
    }
    if (!lines?.length) { codeEl.textContent = "Kode tidak dapat dimuat."; srcEl.textContent = ""; return; }
    codeEl.innerHTML = lines.map(l => `<span class="ln"><i>${l.no}</i>${highlight(l.text, m.lang) || " "}</span>`).join("\n");
    srcEl.innerHTML = source ? `Sumber: <code>${esc(source)}</code>${m.note ? ` · ${m.note}` : ""}` : (m.note || "");
    if (flash) { box.classList.remove("flash"); void box.offsetWidth; box.classList.add("flash"); }
  }
  el.querySelectorAll(".code-tabs button").forEach(b => b.onclick = () => show(+b.dataset.i));
  show(0);
  return { show };
}

/** Daftar langkah (narasi) — terbaru di atas. */
function narrator(el) {
  const items = [];
  const render = () => el.innerHTML = items.length ? items.map((x, i) => `<li class="${x.kind} ${i ? "" : "new"}">${x.html}</li>`).join("") : '<li class="muted">Belum ada operasi. Coba tombol di atas.</li>';
  render();
  return { say(html, kind = "") { items.unshift({ html, kind }); items.splice(10); render(); }, clear() { items.length = 0; render(); } };
}

function introHTML(c) {
  return `<section class="panel lab-intro">
    <div class="lab-intro-main">
      <span class="section-kicker">${c.kicker}</span><h2>${c.title}</h2><p class="lab-lead">${c.lead}</p>
      <div class="lab-facts">
        <div class="fact used"><h4>Dipakai di GlowGrid</h4><ul>${c.usedIn.map(u => `<li>${u.text}${u.view ? ` <button type="button" class="link-btn" data-goto="${u.view}">Lihat →</button>` : ""}</li>`).join("")}</ul></div>
        <div class="fact why"><h4>Alasan dipilih</h4><p>${c.why}</p></div>
        <div class="fact proscons"><h4>Kelebihan</h4><ul class="pro">${c.pros.map(p => `<li>${p}</li>`).join("")}</ul><h4>Keterbatasan</h4><ul class="con">${c.cons.map(p => `<li>${p}</li>`).join("")}</ul></div>
      </div>
    </div>
    ${c.ops ? `<div class="lab-complexity"><h4>Operasi & kompleksitas</h4><table><thead><tr><th>Operasi</th><th>Waktu</th><th>Keterangan</th></tr></thead>
      <tbody>${c.ops.map(([op, big, note]) => `<tr><td><code>${op}</code></td><td><span class="big-o">${big}</span></td><td>${note}</td></tr>`).join("")}</tbody></table>
      ${c.space ? `<p class="space-note">Memori: ${c.space}</p>` : ""}</div>` : ""}
  </section>`;
}
const simHead = (title, extra = "") => `<div class="lab-head"><div><span class="section-kicker">Simulasi interaktif</span><h3>${title}</h3></div>${extra ? `<div class="lab-source">${extra}</div>` : ""}</div>`;
const narrationHTML = id => `<div class="lab-narration"><h4>Langkah yang terjadi</h4><ol id="${id}"></ol></div>`;

/** Kunci tombol simulasi selama animasi berjalan. */
function guard(sim, root, fn) {
  return async (...args) => {
    if (sim.busy) return;
    sim.busy = true; root.classList.add("busy");
    try { await fn(...args); } catch (err) { console.error(err); toast(err.message || "Simulasi gagal."); }
    finally { sim.busy = false; root.classList.remove("busy"); }
  };
}

// ---------------------------------------------------------------------
// Penjelasan tiap struktur data (CPMK-4 & CPMK-10)
// ---------------------------------------------------------------------
const INTRO = {
  stack: {
    kicker: "Struktur linear · LIFO (Last In, First Out)", title: "Stack",
    lead: "Tumpukan: elemen yang terakhir masuk adalah yang pertama keluar. Hanya elemen paling atas (<b>TOP</b>) yang bisa diambil atau dilihat.",
    usedIn: [{ text: "Tombol <b>Urungkan</b> admin. Setiap aksi tugaskan, tolak, atau kembalikan laporan di-<code>push</code>; Urungkan = <code>pop</code> lalu status dipulihkan.", view: "antrean" },
             { text: "Riwayat aktivitas (log keputusan) dibaca dari puncak: yang terbaru di atas." }],
    why: "Yang ingin dibatalkan selalu aksi <b>paling akhir</b>. Itu persis sifat LIFO, jadi tidak perlu mencari: cukup ambil puncak. Riwayat dibatasi 20 aksi dan disimpan per tab (sessionStorage).",
    pros: ["push, pop, peek selalu O(1)", "Sederhana dan hemat memori", "Cocok untuk undo/redo dan riwayat"],
    cons: ["Hanya puncak yang bisa diakses langsung", "Mencari elemen di tengah O(n)", "Undo tidak bisa bila laporan sudah diubah pihak lain (dicek dulu)"],
    ops: [["push(x)", "O(1)", "taruh di puncak"], ["pop()", "O(1)", "ambil dari puncak"], ["peek()", "O(1)", "lihat puncak tanpa mengambil"], ["isEmpty()", "O(1)", "cek kosong (cegah underflow)"]],
    space: "O(n), n = jumlah aksi (maks. 20)"
  },
  queue: {
    kicker: "Struktur linear · FIFO & Priority Queue (binary heap)", title: "Queue",
    lead: "Antrean: yang datang duluan dilayani duluan (FIFO). GlowGrid memakai <b>Priority Queue</b>: laporan paling mendesak keluar duluan; bila prioritasnya sama, yang datang lebih awal didahulukan.",
    usedIn: [{ text: "Antrean verifikasi admin. Prioritas = urgensi (AI/kata kunci) + aging +10/jam (maks. +40).", view: "antrean" },
             { text: "Dispatcher otomatis di database mengambil laporan dengan <code>ORDER BY queue_priority</code>, rumus yang sama." },
             { text: "Dijkstra (Graph) memakai Priority Queue; BFS memakai Queue FIFO." }],
    why: "Laporan kabel menjuntai dekat sekolah tidak boleh menunggu di belakang laporan lampu menyala siang hari. Aging mencegah laporan ringan terlantar selamanya (starvation). Heap membuat penyisipan tetap cepat walau laporan terus masuk.",
    pros: ["enqueue & dequeue O(log n), peek O(1)", "Tidak perlu mengurutkan ulang seluruh antrean", "FIFO terjaga untuk prioritas yang sama (nomor kedatangan)"],
    cons: ["Isi heap tidak urut penuh; menampilkan daftar urut perlu O(n log n)", "Mengubah prioritas elemen di tengah tidak langsung (perlu bangun ulang)", "Lebih rumit daripada array biasa"],
    ops: [["enqueue(x, p)", "O(log n)", "sisip di akhir lalu siftUp"], ["dequeue()", "O(log n)", "ambil akar, pindah elemen terakhir, siftDown"], ["peek()", "O(1)", "akar = prioritas tertinggi"], ["Queue FIFO enqueue/dequeue", "O(1)", "berbasis linked list"]],
    space: "O(n)"
  },
  linked: {
    kicker: "Struktur linear dinamis · simpul + penunjuk next", title: "Linked List",
    lead: "Rantai simpul: setiap simpul menyimpan data dan penunjuk ke simpul berikutnya. Menyisip dan menghapus cukup mengalihkan penunjuk, tanpa menggeser elemen lain.",
    usedIn: [{ text: "Rute kunjungan teknisi. Tugas disisipkan dengan <code>insertSorted</code>: urgensi tertinggi dulu, lalu jarak Dijkstra terdekat dari depot. Daftar tugas dan ringkasan rute dibuat dengan menelusuri list dari HEAD." },
             { text: "Queue FIFO (BFS, level-order tree) juga dibangun di atas simpul linked list." }],
    why: "Daftar tugas teknisi terus berubah: tugas baru masuk di tengah urutan, tugas selesai dihapus. Dengan linked list, urutan selalu benar saat menyisip, dan menyisip di depan O(1).",
    pros: ["Ukuran dinamis, tidak perlu alokasi ulang", "Sisip/hapus di awal O(1); di tengah cukup alihkan penunjuk", "Urutan terjaga dengan insertSorted"],
    cons: ["Akses elemen ke-i O(n), tidak ada akses acak", "Butuh memori tambahan untuk penunjuk", "Mencari tetap harus menelusuri dari head"],
    ops: [["append(x)", "O(1)", "pakai penunjuk tail"], ["prepend(x)", "O(1)", "simpul baru jadi head"], ["insertSorted(x)", "O(n)", "telusuri sampai posisi yang tepat"], ["remove(id)", "O(n)", "cari lalu alihkan prev.next"], ["find(id) / traversal", "O(n)", "dari head ke tail"]],
    space: "O(n) + 1 penunjuk per simpul"
  },
  recursion: {
    kicker: "Teknik · fungsi yang memanggil dirinya sendiri", title: "Rekursif",
    lead: "Masalah besar dipecah menjadi masalah sejenis yang lebih kecil. Setiap fungsi rekursif punya <b>kasus basis</b> (berhenti) dan <b>langkah rekursif</b> (memanggil diri untuk bagian yang lebih kecil). Setiap panggilan disimpan di <b>call stack</b>.",
    usedIn: [{ text: "Pohon wilayah di <b>Semua laporan</b>. Angka tiap simpul dihitung dengan <code>count()</code> rekursif, daftar simpul dirender rekursif, dan klik simpul memanggil <code>findPath()</code> + <code>leaves()</code>.", view: "laporan" },
             { text: "<code>insertPath()</code> menyusun pohon dari laporan secara rekursif; DFS pada graph wilayah." }],
    why: "Data wilayah bertingkat (kota → kecamatan → kelurahan → kategori → laporan). Fungsi rekursif mengikuti bentuk data itu secara alami: \"jumlah laporan suatu wilayah = jumlah laporan semua anaknya\".",
    pros: ["Kode pendek dan mengikuti bentuk data bertingkat", "Mudah dibuktikan benar (basis + langkah)", "Kedalaman pohon kecil (5), call stack aman"],
    cons: ["Setiap panggilan memakai memori call stack", "Bisa stack overflow bila data sangat dalam", "Sedikit lebih lambat dari loop karena overhead panggilan"],
    ops: [["count(simpul)", "O(n)", "n = simpul di subtree"], ["findPath(nama)", "O(n)", "DFS sampai ketemu"], ["insertPath(path)", "O(k·d)", "k = tingkat, d = anak per simpul"], ["dfs(graph)", "O(V + E)", "rekursif per tetangga"]],
    space: "O(h) call stack, h = tinggi pohon"
  },
  tree: {
    kicker: "Struktur hierarkis · n-ary tree", title: "Tree",
    lead: "Data disusun bertingkat dari satu <b>akar</b>. Setiap simpul bisa punya banyak anak; simpul tanpa anak disebut <b>daun</b>. GlowGrid: Kota Surabaya → Kecamatan Pakal → Kelurahan → Kategori → Laporan.",
    usedIn: [{ text: "Panel <b>Pohon wilayah</b> di menu Semua laporan: rekap jumlah laporan per wilayah/kategori dan filter tabel dengan sekali klik.", view: "laporan" }],
    why: "Wilayah administratif memang hierarkis. Pertanyaan \"berapa laporan lampu padam di Benowo?\" cukup dijawab dengan menelusuri satu cabang, bukan menyaring seluruh data berulang-ulang.",
    pros: ["Mencerminkan hierarki wilayah apa adanya", "Rekap per cabang tanpa menyaring ulang semua data", "Mudah diperluas (tambah kecamatan/kota)"],
    cons: ["Perlu dibangun ulang saat data berubah (O(n))", "Mencari nama tanpa indeks O(n)", "Simpul kosong tetap memakan memori"],
    ops: [["insertPath(path, laporan)", "O(k·d)", "buat simpul yang belum ada"], ["findPath(nama)", "O(n)", "DFS rekursif"], ["remove(nama)", "O(n)", "hapus subtree"], ["preorder / postorder", "O(n)", "rekursif"], ["levelOrder", "O(n)", "iteratif dengan Queue"]],
    space: "O(n)"
  },
  graph: {
    kicker: "Struktur non-linear · simpul + sisi berbobot", title: "Graph",
    lead: "Kelurahan dan depot adalah <b>simpul</b>; jalan penghubung adalah <b>sisi</b> dengan bobot jarak (km). Disimpan sebagai <b>adjacency list</b>. <b>Dijkstra</b> mencari jalur terpendek memakai Priority Queue.",
    usedIn: [{ text: "Halaman Teknisi: rute rekomendasi Depot → titik tugas dan estimasi jarak." },
             { text: "Urutan rute (Linked List) memakai jarak Dijkstra dari depot." },
             { text: "Peta admin: garis rute tiap teknisi; dispatcher memilih teknisi terdekat dari tabel jarak antar-kelurahan.", view: "peta" }],
    why: "Jaringan jalan bukan daftar atau pohon: satu kelurahan terhubung ke beberapa kelurahan lain dengan jarak berbeda. Graph berbobot memodelkannya, dan Dijkstra menjamin jalur terpendek karena semua bobot jarak ≥ 0.",
    pros: ["Memodelkan jaringan jalan apa adanya", "Dijkstra + heap: O((V + E) log V)", "Jalan ditutup cukup hapus sisi, rute dihitung ulang otomatis"],
    cons: ["Bobot jarak masih perkiraan, belum data lalu lintas", "Dijkstra tidak untuk bobot negatif", "Graph besar butuh memori O(V + E)"],
    ops: [["addEdge / removeEdge", "O(1) / O(deg)", "tambah/tutup jalan"], ["dijkstra(asal)", "O((V+E) log V)", "jarak terpendek ke semua simpul"], ["bfs(asal)", "O(V + E)", "per lapis, pakai Queue"], ["dfs(asal)", "O(V + E)", "mendalam, rekursif"]],
    space: "O(V + E)"
  },
  db: {
    kicker: "Koneksi database · multi-user", title: "Database",
    lead: "Semua peran (warga, teknisi, admin) memakai <b>satu database PostgreSQL di Supabase</b> secara bersamaan. Hak akses ditegakkan di database dengan <b>Row Level Security (RLS)</b>, bukan hanya disembunyikan di tampilan.",
    usedIn: [{ text: "Warga mengirim laporan → langsung masuk antrean admin dan dispatcher. Teknisi hanya melihat tugasnya sendiri. Admin melihat semua." },
             { text: "Sesi login disimpan per tab, jadi tiga akun bisa dibuka berdampingan di satu browser untuk demo." },
             { text: "Trigger & cron di database: dispatcher tiap menit, analisis AI, riwayat status (report_events)." }],
    why: "Aplikasi dipakai banyak orang sekaligus dengan peran berbeda. Database terpusat menjamin semua melihat data yang sama secara langsung, dan RLS menjamin warga tidak bisa membaca laporan orang lain walau memanggil API secara langsung.",
    pros: ["Data konsisten untuk semua pengguna", "Keamanan di tingkat baris (RLS) per peran", "Logika penting (dispatcher, validasi status) berjalan di server"],
    cons: ["Butuh koneksi internet", "Kuota layanan gratis terbatas", "Aturan RLS harus diuji teliti"],
    ops: null
  }
};

// ---------------------------------------------------------------------
// Entri utama
// ---------------------------------------------------------------------
export function initLab(ctx) {
  const root = document.getElementById("labRoot");
  root.innerHTML = `<header class="view-head lab-top"><div><span class="eyebrow"><i></i> Lab</span><h1>Lab Struktur Data</h1>
      <p>Semua struktur data yang menjalankan GlowGrid: penjelasan, simulasi interaktif, visualisasi, dan kode aslinya. Simulasi memakai kelas yang sama dengan aplikasi dan bisa diisi data laporan nyata.</p></div>
      <div class="lab-speed" role="group" aria-label="Kecepatan animasi"><span>Kecepatan</span>${[0.5, 1, 2].map(v => `<button type="button" data-speed="${v}" class="${v === 1 ? "active" : ""}">${v}×</button>`).join("")}</div></header>
    <nav class="lab-tabs" role="tablist">${TABS.map(t => `<button type="button" role="tab" data-tab="${t.key}"><span>${t.letter}</span><b>${t.label}</b><small>${t.sub}</small></button>`).join("")}</nav>
    ${TABS.map(t => `<div class="lab-panel" data-panel="${t.key}" hidden></div>`).join("")}`;
  root.querySelectorAll("[data-speed]").forEach(b => b.onclick = () => { speed = +b.dataset.speed; root.querySelectorAll("[data-speed]").forEach(x => x.classList.toggle("active", x === b)); });

  const modules = { stack: stackTab, queue: queueTab, linked: linkedTab, recursion: recursionTab, tree: treeTab, graph: graphTab, db: dbTab, tests: testsTab };
  const mounted = {};
  for (const t of TABS) {                       // semua panel dibuat sekarang (log keputusan harus ada sejak awal)
    const el = root.querySelector(`[data-panel="${t.key}"]`);
    mounted[t.key] = modules[t.key](el, ctx);
    el.querySelectorAll("[data-goto]").forEach(b => b.onclick = () => navigate(b.dataset.goto));
  }
  let current = sessionStorage.getItem("glowgrid-lab-tab") || "stack";
  if (!modules[current]) current = "stack";
  function openTab(key) {
    if (!modules[key]) return;
    current = key; sessionStorage.setItem("glowgrid-lab-tab", key);
    root.querySelectorAll("[data-tab]").forEach(b => { const on = b.dataset.tab === key; b.classList.toggle("active", on); b.setAttribute("aria-selected", on); });
    root.querySelectorAll("[data-panel]").forEach(p => p.hidden = p.dataset.panel !== key);
    mounted[key].onShow?.();
    root.querySelector(`[data-tab="${key}"]`)?.scrollIntoView({ block: "nearest", inline: "center" });
  }
  root.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => openTab(b.dataset.tab));
  openTab(current);
  return {
    openTab,
    show() { openTab(current); },
    refresh(key) { for (const [k, m] of Object.entries(mounted)) if (!key || k === key) m.onData?.(); }
  };
}

// ---------------------------------------------------------------------
// STACK
// ---------------------------------------------------------------------
function stackTab(el, ctx) {
  el.innerHTML = introHTML(INTRO.stack) + `<div class="lab-work">
    <section class="panel lab-sim">${simHead("Push & pop riwayat aksi", `<button type="button" class="chip-btn" data-src="undo">Salin stack Urungkan sesi ini</button><button type="button" class="chip-btn" data-src="log">Isi dari log keputusan</button>`)}
      <div class="lab-controls"><input id="stInput" maxlength="44" placeholder="Nama aksi, mis. Tugaskan GGR-2606 ke Arif">
        <button type="button" class="op primary" data-op="push">push()</button><button type="button" class="op" data-op="pop">pop()</button><button type="button" class="op" data-op="peek">peek()</button><button type="button" class="op ghost" data-op="clear">Kosongkan</button></div>
      <div class="lab-stage stack-stage"><div class="st-col" id="stCol"></div><div class="st-side"><div class="st-meta" id="stMeta"></div><p class="st-hint">Elemen baru selalu masuk di atas. <code>pop()</code> hanya bisa mengambil yang paling atas.</p></div></div>
      ${narrationHTML("stNar")}</section>
    <section class="panel lab-code" id="stCode"></section></div>
    <div class="lab-real">
      <section class="panel st-live-panel"><div class="lab-head"><div><span class="section-kicker">Dipakai sungguhan</span><h3>Stack Urungkan sesi ini</h3></div><button id="stUndoBtn" type="button" class="button secondary">↶ Urungkan teratas</button></div>
        <p class="lab-note">Setiap kali Anda menugaskan, menolak, atau mengembalikan laporan di menu <b>Antrean</b>, aksinya di-<code>push</code> ke sini. Tombol <b>Urungkan</b> menjalankan <code>pop()</code> lalu memulihkan status laporan.</p><ol id="stLive" class="st-live"></ol></section>
      <section class="panel log-panel"><div class="lab-head"><div><span class="section-kicker">Riwayat aktivitas sistem · terbaru di atas</span><h3>Log keputusan</h3></div><button id="refreshLogBtn" class="button tertiary" type="button">Muat ulang</button></div>
        <p class="lab-note">Setiap penilaian AI, penugasan otomatis/manual, dan penolakan tugas tercatat di database. Dibaca dari puncak (terbaru) seperti stack.</p><ol id="logList" class="log-list"></ol></section>
    </div>`;
  const s = new Stack(), sim = {}, nar = narrator(el.querySelector("#stNar"));
  const code = codePanel(el.querySelector("#stCode"), { methods: [{ label: "push", region: "Stack.push" }, { label: "pop", region: "Stack.pop" }, { label: "peek", region: "Stack.peek" }, { label: "kelas Stack", region: "Stack" }, { label: "dipakai: Urungkan", fn: "undoLast", file: "admin-page.js", note: "dipanggil tombol Urungkan" }] });
  const col = el.querySelector("#stCol"), meta = el.querySelector("#stMeta"), input = el.querySelector("#stInput");
  let fx = null;
  function render() {
    const items = s.toArray();
    col.innerHTML = items.length ? items.map((it, i) => `<div class="st-plate ${i === 0 ? "top" : ""} ${i === 0 && fx ? fx : ""}"><span class="st-i">${s.size - 1 - i}</span><b>${esc(it.label)}</b>${i === 0 ? '<em>TOP</em>' : ""}</div>`).join("") + '<div class="st-base">dasar stack</div>'
      : '<div class="st-empty">Stack kosong<br><small>isEmpty() = true</small></div><div class="st-base">dasar stack</div>';
    meta.innerHTML = `<div><span>Ukuran</span><b>${s.size}</b></div><div><span>TOP</span><b>${esc(s.peek()?.label || "—")}</b></div>`;
    fx = null;
  }
  function sample() {
    const r = ctx.getReports(); const pick = r[Math.floor(Math.random() * Math.max(1, r.length))];
    const id = pick?.id || `GGR-${2600 + Math.floor(Math.random() * 99)}`;
    return [`Tugaskan ${id} ke ${pick?.technicianName || "Arif"}`, `Tolak ${id}`, `Kembalikan ${id} ke antrean`][Math.floor(Math.random() * 3)];
  }
  const ops = {
    async push(label = input.value.trim() || sample()) {
      s.push({ label }); input.value = ""; fx = "enter"; render(); code.show("Stack.push", true);
      nar.say(`<code>push("${esc(label)}")</code> → ukuran ${s.size}. Elemen baru menjadi <b>TOP</b>.`, "ok");
    },
    async pop() {
      code.show("Stack.pop", true);
      if (s.isEmpty()) return nar.say("<code>pop()</code> pada stack kosong → <code>undefined</code> (<b>underflow</b>). Di aplikasi, tombol Urungkan disembunyikan saat stack kosong.", "warn");
      col.querySelector(".st-plate.top")?.classList.add("leave"); await wait(320);
      const it = s.pop(); render();
      nar.say(`<code>pop()</code> → mengambil <b>"${esc(it.label)}"</b> dari TOP. Ukuran sekarang ${s.size}.`, "ok");
    },
    async peek() {
      code.show("Stack.peek", true);
      if (s.isEmpty()) return nar.say("<code>peek()</code> → <code>undefined</code>, stack kosong.", "warn");
      col.querySelector(".st-plate.top")?.classList.add("pulse");
      nar.say(`<code>peek()</code> → "${esc(s.peek().label)}". Isi stack tidak berubah.`);
    },
    async clear() { s.clear(); render(); nar.say("Stack dikosongkan."); }
  };
  el.querySelectorAll("[data-op]").forEach(b => b.onclick = guard(sim, el, () => ops[b.dataset.op]()));
  input.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); guard(sim, el, () => ops.push())(); } };
  el.querySelector('[data-src="undo"]').onclick = guard(sim, el, async () => {
    s.clear(); ctx.undoStack.items.forEach(a => s.push({ label: a.label })); render();
    nar.say(ctx.undoStack.size ? `Disalin ${ctx.undoStack.size} aksi dari stack Urungkan yang sebenarnya.` : "Stack Urungkan sesi ini masih kosong. Coba tugaskan/tolak laporan di menu Antrean dulu.", ctx.undoStack.size ? "ok" : "warn");
  });
  el.querySelector('[data-src="log"]').onclick = guard(sim, el, async () => {
    const logs = ctx.getLogs().slice(0, 6).reverse();
    if (!logs.length) return nar.say("Belum ada log keputusan.", "warn");
    s.clear(); render(); nar.say(`Push ${logs.length} log terakhir, dari yang terlama ke terbaru…`);
    for (const l of logs) { await ops.push(`${LOG_LABEL[l.action] || l.action}${l.reportId ? " " + l.reportId : ""}`); await wait(380); }
  });
  el.querySelector("#stUndoBtn").onclick = () => ctx.undo();
  function onData() {
    const items = ctx.undoStack.toArray();
    el.querySelector("#stLive").innerHTML = items.length ? items.map((a, i) => `<li class="${i ? "" : "top"}"><b>${esc(a.label)}</b><small>${i ? `posisi ${items.length - 1 - i}` : "TOP · akan diurungkan duluan"} · ${ago(a.at)}</small></li>`).join("")
      : '<li class="muted">Kosong. Belum ada aksi admin di tab ini.</li>';
    el.querySelector("#stUndoBtn").disabled = !items.length;
  }
  render(); onData();
  return { onData };
}
const LOG_LABEL = { assign: "Ditugaskan", no_teknisi: "Menunggu teknisi", decline: "Ditolak teknisi", unassign: "Dikembalikan", mode: "Mode diubah", ai: "Dinilai AI", review: "Tinjauan" };

// ---------------------------------------------------------------------
// QUEUE (Priority Queue + FIFO)
// ---------------------------------------------------------------------
function queueTab(el, ctx) {
  el.innerHTML = introHTML(INTRO.queue) + `<div class="lab-work">
    <section class="panel lab-sim">${simHead("Antrean laporan", `<div class="seg" role="group"><button type="button" data-mode="pq" class="active">Prioritas (heap)</button><button type="button" data-mode="fifo">FIFO biasa</button></div>`)}
      <div class="lab-controls">
        <input id="qId" maxlength="14" placeholder="ID laporan" class="w-id">
        <label class="pq-only range-field">Urgensi <input id="qUrg" type="range" min="0" max="100" value="60"><b id="qUrgV">60</b></label>
        <label class="pq-only">Menunggu <select id="qAge"><option value="0">baru</option><option value="1">1 jam</option><option value="2">2 jam</option><option value="3">3 jam</option><option value="4">4+ jam</option></select></label>
        <button type="button" class="op primary" data-op="enqueue">enqueue()</button><button type="button" class="op" data-op="dequeue">dequeue()</button><button type="button" class="op" data-op="peek">peek()</button><button type="button" class="op ghost" data-op="clear">Kosongkan</button>
      </div>
      <div class="lab-controls sub"><button type="button" class="chip-btn" data-src="real">Muat antrean nyata</button><button type="button" class="chip-btn" data-src="sample">Contoh 6 laporan</button><span class="pq-only muted small">Prioritas = urgensi + aging (10/jam, maks. 40)</span></div>
      <div class="lab-stage q-stage">
        <div class="q-lane-wrap"><span class="q-end front">DEPAN<br><small>keluar duluan</small></span><div class="q-lane" id="qLane"></div><span class="q-end back">BELAKANG<br><small>masuk</small></span></div>
        <div class="heap-wrap pq-only"><div class="heap-col"><h5>Isi heap (array)</h5><div class="heap-array" id="qArr"></div><p class="muted small">anak kiri = 2i+1 · anak kanan = 2i+2 · induk = ⌊(i−1)/2⌋</p></div>
          <div class="heap-col"><h5>Heap sebagai pohon biner</h5><div class="heap-tree" id="qTree"></div></div></div>
      </div>${narrationHTML("qNar")}</section>
    <section class="panel lab-code" id="qCode"></section></div>`;
  let mode = "pq", pq = new PriorityQueue(), fifo = new Queue(), n = 1;
  const sim = {}, nar = narrator(el.querySelector("#qNar"));
  const methodsPQ = [{ label: "enqueue", region: "PriorityQueue.enqueue" }, { label: "dequeue", region: "PriorityQueue.dequeue" }, { label: "siftUp", region: "PriorityQueue.siftUp" }, { label: "siftDown", region: "PriorityQueue.siftDown" }, { label: "before (aturan)", region: "PriorityQueue.before" },
    { label: "dipakai: antrean admin", fn: "waiting", file: "admin-page.js", note: "menyusun antrean verifikasi" }, { label: "rumus prioritas", fn: "queuePriority", file: "data-service.js" }];
  const methodsQ = [{ label: "enqueue", region: "Queue.enqueue" }, { label: "dequeue", region: "Queue.dequeue" }, { label: "kelas Queue", region: "Queue" }, { label: "dipakai: BFS", region: "WeightedGraph.bfs" }];
  const codeEl = el.querySelector("#qCode");
  let code = codePanel(codeEl, { methods: methodsPQ });
  const lane = el.querySelector("#qLane"), arr = el.querySelector("#qArr"), treeEl = el.querySelector("#qTree");
  const urg = el.querySelector("#qUrg"); urg.oninput = () => el.querySelector("#qUrgV").textContent = urg.value;

  const card = (v, p, cls = "") => `<div class="q-card ${cls}"><b>${esc(v.id)}</b><small>${esc(v.sub || "")}</small>${p != null ? `<span class="q-pri" title="urgensi ${v.urgency} + aging ${p - v.urgency}">${p}</span>` : ""}</div>`;
  function renderHeap(heap = pq.heap, hl = [], cls = "swap") {
    arr.innerHTML = heap.length ? heap.map((nd, i) => `<div class="hp-cell ${hl.includes(i) ? cls : ""}"><i>[${i}]</i><b>${nd.priority}</b><small>${esc(nd.value.id)}</small></div>`).join("") : '<span class="muted small">heap kosong</span>';
    const levels = []; for (let l = 0, start = 0; start < Math.min(heap.length, 31); l++, start = 2 ** l - 1) levels.push({ start, count: 2 ** l });
    treeEl.innerHTML = heap.length ? levels.map(({ start, count }) => `<div class="ht-level">${Array.from({ length: count }, (_, k) => { const i = start + k, nd = heap[i];
      return `<div class="ht-slot">${nd ? `<div class="ht-node ${hl.includes(i) ? cls : ""} ${i === 0 ? "root" : ""}" title="[${i}] ${esc(nd.value.id)}"><b>${nd.priority}</b><small>${esc(nd.value.id)}</small></div>` : ""}</div>`; }).join("")}</div>`).join("")
      + (heap.length > 31 ? `<p class="muted small">+${heap.length - 31} simpul tidak ditampilkan</p>` : "") : "";
  }
  function render(fx = {}) {
    if (mode === "pq") {
      const order = pq.toSortedArray();
      lane.innerHTML = order.length ? order.map((nd, i) => card(nd.value, nd.priority, `${i === 0 ? "front" : ""} ${fx.enter === nd.value ? "enter" : ""}`)).join("") : '<span class="q-empty">Antrean kosong</span>';
      renderHeap();
    } else {
      const items = fifo.toArray();
      lane.innerHTML = items.length ? items.map((v, i) => card(v, null, `${i === 0 ? "front" : ""} ${i === items.length - 1 ? "rear" : ""} ${fx.enter === v ? "enter" : ""}`)).join('<span class="q-link">→</span>') : '<span class="q-empty">Antrean kosong</span>';
    }
  }
  async function play(frames) {
    for (const f of frames) { renderHeap(f.heap, f.hl, f.cls); if (f.note) nar.say(f.note); await wait(f.cls === "swap" ? 620 : 460); }
  }
  function capture() {
    const frames = [];
    pq.onStep = e => {
      const heap = pq.heap.map(x => ({ ...x }));
      if (e.type === "swap") frames.push({ heap, hl: [e.i, e.j], cls: "swap", note: `tukar [${e.i}] ↔ [${e.j}]: prioritas ${heap[Math.min(e.i, e.j)].priority} naik ke atas` });
      else if (e.type === "add") frames.push({ heap, hl: [e.index], cls: "add", note: `taruh di akhir array, indeks [${e.index}], lalu bandingkan dengan induknya` });
      else frames.push({ heap, hl: [0], cls: "add", note: "elemen terakhir dipindah ke akar [0], lalu turun (siftDown)" });
    };
    return frames;
  }
  const ops = {
    async enqueue(v) {
      v ??= { id: el.querySelector("#qId").value.trim() || `LAB-${n++}`, sub: "", urgency: +urg.value, age: +el.querySelector("#qAge").value };
      el.querySelector("#qId").value = "";
      if (mode === "fifo") { fifo.enqueue(v); render({ enter: v }); code.show("Queue.enqueue", true); return nar.say(`<code>enqueue("${esc(v.id)}")</code> → masuk dari BELAKANG (tail). O(1).`, "ok"); }
      const p = v.priority ?? v.urgency + Math.min(40, v.age * 10);
      code.show("PriorityQueue.enqueue", true);
      const frames = capture(); pq.enqueue(v, p); pq.onStep = null;
      nar.say(`<code>enqueue("${esc(v.id)}", ${p})</code> · urgensi ${v.urgency} + aging ${p - v.urgency}`, "ok");
      await play(frames); render({ enter: v });
      const pos = pq.toSortedArray().findIndex(x => x.value === v) + 1;
      nar.say(`Selesai: ${frames.length - 1} kali tukar. "${esc(v.id)}" berada di urutan keluar ke-${pos}.`, "ok");
    },
    async dequeue() {
      if (mode === "fifo") {
        code.show("Queue.dequeue", true);
        if (fifo.isEmpty()) return nar.say("<code>dequeue()</code> → <code>undefined</code>, antrean kosong.", "warn");
        lane.querySelector(".q-card.front")?.classList.add("leave"); await wait(320);
        const v = fifo.dequeue(); render(); return nar.say(`<code>dequeue()</code> → <b>${esc(v.id)}</b> keluar dari DEPAN (yang paling lama menunggu).`, "ok");
      }
      code.show("PriorityQueue.dequeue", true);
      if (pq.isEmpty()) return nar.say("<code>dequeue()</code> → <code>undefined</code>, antrean kosong.", "warn");
      const top = pq.heap[0];
      lane.querySelector(".q-card.front")?.classList.add("leave"); renderHeap(pq.heap, [0], "out"); await wait(520);
      const frames = capture(); pq.dequeue(); pq.onStep = null;
      nar.say(`<code>dequeue()</code> → <b>${esc(top.value.id)}</b> (prioritas ${top.priority}) keluar dari akar heap.`, "ok");
      await play(frames); render();
    },
    async peek() {
      if (mode === "fifo") { const v = fifo.peek(); lane.querySelector(".q-card.front")?.classList.add("pulse"); return nar.say(v ? `<code>peek()</code> → ${esc(v.id)} (depan).` : "Antrean kosong.", v ? "" : "warn"); }
      const top = pq.heap[0]; renderHeap(pq.heap, [0], "add"); lane.querySelector(".q-card.front")?.classList.add("pulse");
      nar.say(top ? `<code>peek()</code> → ${esc(top.value.id)} dengan prioritas ${top.priority}. Cukup lihat indeks [0], O(1).` : "Antrean kosong.", top ? "" : "warn");
    },
    async clear() { pq = new PriorityQueue(); fifo = new Queue(); render(); nar.say("Antrean dikosongkan."); }
  };
  async function fill(items, label) {
    await ops.clear(); nar.say(label);
    for (const v of items) { if (mode === "fifo") { fifo.enqueue(v); } else pq.enqueue(v, v.priority ?? v.urgency + Math.min(40, v.age * 10)); }
    render();
  }
  const sampleItems = () => [["GGR-2601", 25, 3], ["GGR-2602", 92, 0], ["GGR-2603", 45, 1], ["GGR-2604", 65, 0], ["GGR-2605", 45, 1], ["GGR-2606", 30, 4]].map(([id, u, a]) => ({ id, urgency: u, age: a, sub: `urgensi ${u} · ${a ? a + " jam" : "baru"}` }));
  el.querySelector('[data-src="sample"]').onclick = guard(sim, el, () => fill(sampleItems(), "Dimuat 6 contoh laporan. Perhatikan GGR-2603 & GGR-2605: prioritas sama, yang datang duluan tetap di depan."));
  el.querySelector('[data-src="real"]').onclick = guard(sim, el, async () => {
    const real = ctx.getReports().filter(r => r.status === "Menunggu Verifikasi").sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map(r => ({ id: r.id, sub: `${r.village} · ${r.category}`, urgency: r.urgency ?? 0, priority: Math.round(queuePriority(r)) }));
    if (!real.length) return nar.say("Tidak ada laporan berstatus Menunggu Verifikasi saat ini. Pakai contoh, atau kirim laporan dari akun warga.", "warn");
    await fill(real, `Dimuat ${real.length} laporan nyata yang menunggu verifikasi. Urutan ini sama dengan menu Antrean.`);
  });
  el.querySelectorAll("[data-mode]").forEach(b => b.onclick = guard(sim, el, async () => {
    mode = b.dataset.mode;
    el.querySelectorAll("[data-mode]").forEach(x => x.classList.toggle("active", x === b));
    el.querySelectorAll(".pq-only").forEach(x => x.hidden = mode !== "pq");
    code = codePanel(codeEl, { methods: mode === "pq" ? methodsPQ : methodsQ });
    nar.say(mode === "pq" ? "Mode Priority Queue: keluar berdasarkan prioritas tertinggi." : "Mode FIFO: yang datang duluan keluar duluan, tanpa melihat prioritas.");
    render();
  }));
  el.querySelectorAll("[data-op]").forEach(b => b.onclick = guard(sim, el, () => ops[b.dataset.op]()));
  render();
  return {};
}

// ---------------------------------------------------------------------
// LINKED LIST (rute teknisi)
// ---------------------------------------------------------------------
function linkedTab(el, ctx) {
  const graph = buildPakalGraph(), { dist } = graph.dijkstra("Depot Pakal");
  el.innerHTML = introHTML(INTRO.linked) + `<div class="lab-work">
    <section class="panel lab-sim">${simHead("Rute kunjungan teknisi", `<select id="llTech" aria-label="Pilih teknisi"><option value="">Semua tugas aktif</option></select><button type="button" class="chip-btn" data-src="real">Muat rute nyata</button><button type="button" class="chip-btn" data-src="sample">Contoh</button>`)}
      <div class="lab-controls"><input id="llId" maxlength="14" placeholder="ID tugas" class="w-id"><label>Urgensi <input id="llUrg" type="number" min="0" max="100" value="60" class="w-num"></label>
        <label>Kelurahan <select id="llVil">${PAKAL_VILLAGES.map(v => `<option>${v}</option>`).join("")}</select></label></div>
      <div class="lab-controls"><button type="button" class="op primary" data-op="insertSorted">insertSorted()</button><button type="button" class="op" data-op="append">append()</button><button type="button" class="op" data-op="prepend">prepend()</button>
        <button type="button" class="op" data-op="find">find(ID)</button><button type="button" class="op" data-op="remove">remove(ID)</button><button type="button" class="op" data-op="traverse">telusuri</button><button type="button" class="op ghost" data-op="clear">Kosongkan</button></div>
      <div class="lab-stage ll-stage" id="llStage"></div>
      <p class="lab-note small">Aturan urutan rute: urgensi lebih tinggi di depan; bila sama, jarak Dijkstra dari Depot Pakal yang lebih dekat di depan.</p>
      ${narrationHTML("llNar")}</section>
    <section class="panel lab-code" id="llCode"></section></div>`;
  let list = new LinkedList(), n = 1;
  const sim = {}, nar = narrator(el.querySelector("#llNar")), stage = el.querySelector("#llStage");
  const code = codePanel(el.querySelector("#llCode"), { methods: [{ label: "insertSorted", region: "LinkedList.insertSorted" }, { label: "append", region: "LinkedList.append" }, { label: "prepend", region: "LinkedList.prepend" }, { label: "remove", region: "LinkedList.remove" }, { label: "find", region: "LinkedList.find" }, { label: "traverse", region: "LinkedList.traverse" }, { label: "ListNode", region: "ListNode" }, { label: "dipakai: rute teknisi", region: "buildRouteList", note: "dipanggil halaman Teknisi" }] });
  const before = (a, b) => a.urgency !== b.urgency ? a.urgency > b.urgency : a.km < b.km;
  const task = (id, urgency, village) => ({ id, urgency, village, km: dist[village] });
  function render(fx = {}) {
    const items = list.toArray();
    stage.innerHTML = `<div class="ll-row">${items.length ? items.map((v, i) => `<div class="ll-item"><div class="ll-tags">${i === 0 ? "<span>HEAD</span>" : ""}${i === items.length - 1 ? "<span class='tail'>TAIL</span>" : ""}${fx.cur === i ? "<span class='cur'>cur</span>" : ""}</div>
        <div class="ll-node ${fx.cur === i ? "cur" : ""} ${fx.hit === i ? "hit" : ""} ${fx.enter === v ? "enter" : ""} ${fx.leave === i ? "leave" : ""} ${fx.passed?.includes(i) ? "passed" : ""}">
          <div class="ll-data"><b>${esc(v.id)}</b><small>urg ${v.urgency} · ${esc(v.village)}</small><small>${fmtKm(v.km)} dari depot</small></div><div class="ll-next" title="penunjuk next">${i < items.length - 1 ? "●" : "∅"}</div></div></div><span class="ll-arrow">→</span>`).join("") : '<span class="ll-empty">head = null (list kosong)</span><span class="ll-arrow">→</span>'}<span class="ll-null">null</span></div>
      <div class="ll-meta"><span>size = <b>${list.size}</b></span><span>head = <b>${esc(list.head?.value.id || "null")}</b></span><span>tail = <b>${esc(list.tail?.value.id || "null")}</b></span></div>`;
  }
  const readInput = () => { const id = el.querySelector("#llId").value.trim() || `T-${n++}`; el.querySelector("#llId").value = ""; return task(id, Math.max(0, Math.min(100, +el.querySelector("#llUrg").value || 0)), el.querySelector("#llVil").value); };
  async function walk(upto, extra = {}) { for (let i = 0; i < upto; i++) { render({ cur: i, passed: [...Array(i).keys()], ...extra }); await wait(420); } }
  const ops = {
    async insertSorted() {
      const v = readInput(); code.show("LinkedList.insertSorted", true);
      const idx = list.toArray().findIndex(x => before(v, x)), pos = idx < 0 ? list.size : idx;
      if (pos > 0) { nar.say(`Telusuri dari HEAD mencari posisi untuk ${esc(v.id)} (urgensi ${v.urgency}, ${fmtKm(v.km)})…`); await walk(pos); }
      list.insertSorted(v, before); render({ enter: v });
      const arr = list.toArray(), prev = arr[pos - 1], next = arr[pos + 1];
      nar.say(`<code>insertSorted</code> → ${esc(v.id)} disisipkan di posisi ${pos}${prev ? `, setelah ${esc(prev.id)}` : " sebagai HEAD baru"}${next ? `, sebelum ${esc(next.id)}` : " (jadi TAIL)"}. ${pos ? `${pos} simpul dilewati.` : "Tanpa penelusuran."}`, "ok");
    },
    async append() { const v = readInput(); list.append(v); render({ enter: v }); code.show("LinkedList.append", true); nar.say(`<code>append</code> → ${esc(v.id)} jadi TAIL. O(1) karena ada penunjuk tail (urutan prioritas diabaikan).`, "ok"); },
    async prepend() { const v = readInput(); list.prepend(v); render({ enter: v }); code.show("LinkedList.prepend", true); nar.say(`<code>prepend</code> → ${esc(v.id)} jadi HEAD baru. O(1).`, "ok"); },
    async find() {
      const id = el.querySelector("#llId").value.trim(); code.show("LinkedList.find", true);
      if (!id) return nar.say("Isi ID yang dicari di kolom ID tugas.", "warn");
      const visits = []; list.onVisit = i => visits.push(i); const res = list.find(v => v.id.toLowerCase() === id.toLowerCase()); list.onVisit = null;
      for (const i of visits) { render({ cur: i, passed: visits.slice(0, visits.indexOf(i)) }); await wait(420); }
      render(res ? { hit: res.index } : {});
      nar.say(res ? `<code>find("${esc(id)}")</code> → ketemu di indeks ${res.index} setelah memeriksa ${visits.length} simpul.` : `<code>find("${esc(id)}")</code> → <code>null</code>, sudah memeriksa ${visits.length} simpul sampai null.`, res ? "ok" : "warn");
    },
    async remove() {
      const id = el.querySelector("#llId").value.trim(); code.show("LinkedList.remove", true);
      if (!id) return nar.say("Isi ID tugas yang akan dihapus (mis. tugas yang sudah selesai).", "warn");
      const idx = list.toArray().findIndex(v => v.id.toLowerCase() === id.toLowerCase());
      if (idx < 0) return nar.say(`<code>remove("${esc(id)}")</code> → tidak ditemukan, list tidak berubah.`, "warn");
      await walk(idx); render({ leave: idx }); await wait(380);
      const arr = list.toArray(), prev = arr[idx - 1], next = arr[idx + 1];
      list.remove(v => v.id.toLowerCase() === id.toLowerCase()); el.querySelector("#llId").value = ""; render();
      nar.say(`<code>remove("${esc(id)}")</code> → ${prev ? `${esc(prev.id)}.next dialihkan ke ${esc(next?.id || "null")}` : `head dipindah ke ${esc(next?.id || "null")}`}${next ? "" : ", tail diperbarui"}. Seperti tugas yang selesai dikerjakan.`, "ok");
    },
    async traverse() {
      code.show("LinkedList.traverse", true);
      if (list.isEmpty()) return nar.say("List kosong, tidak ada yang ditelusuri.", "warn");
      const names = []; list.forEach(v => names.push(v.id));
      await walk(list.size); render();
      nar.say(`Penelusuran HEAD → TAIL: ${names.map(esc).join(" → ")} → null. Inilah urutan kunjungan teknisi.`, "ok");
    },
    async clear() { list = new LinkedList(); render(); nar.say("List dikosongkan (head = tail = null)."); }
  };
  async function load(tasks, label) {
    list = new LinkedList(); render(); nar.say(label);
    for (const t of tasks) { list.insertSorted(task(t.id, t.urgency, t.village), before); render({ enter: list.find(v => v.id === t.id)?.value }); await wait(380); }
    nar.say(`Rute tersusun: ${list.toArray().map(v => esc(v.id)).join(" → ") || "kosong"}.`, "ok");
  }
  el.querySelector('[data-src="sample"]').onclick = guard(sim, el, () => load([{ id: "GGR-2603", urgency: 25, village: "Pakal" }, { id: "GGR-2606", urgency: 92, village: "Benowo" }, { id: "GGR-2610", urgency: 60, village: "Sumber Rejo" }, { id: "GGR-2611", urgency: 60, village: "Babat Jerawat" }], "Contoh: 4 tugas disisipkan satu per satu dengan insertSorted."));
  el.querySelector('[data-src="real"]').onclick = guard(sim, el, async () => {
    const techId = el.querySelector("#llTech").value;
    const tasks = ctx.getReports().filter(r => ["Ditugaskan", "Menuju Lokasi"].includes(r.status) && (!techId || r.technicianId === techId));
    if (!tasks.length) return nar.say("Tidak ada tugas aktif untuk pilihan ini.", "warn");
    const name = ctx.getTechs().find(t => t.technicianId === techId)?.name;
    await load(tasks, `Memuat ${tasks.length} tugas aktif ${name ? "milik " + esc(name) : "semua teknisi"}. Urutan ini sama dengan halaman Teknisi.`);
  });
  el.querySelectorAll("[data-op]").forEach(b => b.onclick = guard(sim, el, () => ops[b.dataset.op]()));
  function onData() {
    const sel = el.querySelector("#llTech"), cur = sel.value;
    sel.innerHTML = '<option value="">Semua tugas aktif</option>' + ctx.getTechs().map(t => `<option value="${esc(t.technicianId)}">${esc(t.name)} (${t.activeLoad})</option>`).join("");
    sel.value = cur;
  }
  render(); onData();
  return { onData };
}

// ---------------------------------------------------------------------
// REKURSIF (call stack)
// ---------------------------------------------------------------------
class TracedGraph extends WeightedGraph {   // DFS yang sama, ditambah catatan masuk/keluar panggilan
  dfs(v, seen = new Set(), order = [], depth = 0) {
    this.onVisit?.({ type: "enter", node: v, depth });
    seen.add(v); order.push(v);
    for (const { to } of this.neighbors(v)) if (!seen.has(to)) this.dfs(to, seen, order, depth + 1);
    this.onVisit?.({ type: "exit", node: v, depth, value: `${order.length} dikunjungi` });
    return order;
  }
}
const SAMPLE_REPORTS = [
  { id: "GGR-2601", village: "Benowo", category: "Lampu padam" }, { id: "GGR-2602", village: "Benowo", category: "Lampu padam" },
  { id: "GGR-2603", village: "Benowo", category: "Tiang/kabel bermasalah" }, { id: "GGR-2604", village: "Pakal", category: "Penerangan kurang" },
  { id: "GGR-2605", village: "Sumber Rejo", category: "Lampu padam" }, { id: "GGR-2606", village: "Babat Jerawat", category: "Menyala pada siang hari" }
];
function recursionTab(el, ctx) {
  el.innerHTML = introHTML(INTRO.recursion) + `<div class="lab-work">
    <section class="panel lab-sim">${simHead("Melihat call stack bekerja", `<div class="seg" role="group"><button type="button" data-data="sample" class="active">Contoh (6 laporan)</button><button type="button" data-data="real">Laporan nyata</button></div>`)}
      <div class="lab-controls"><label>Fungsi <select id="rcFn"><option value="count">count(simpul) · hitung laporan</option><option value="findPath">findPath(nama) · cari jalur</option><option value="dfs">dfs(graph) · telusuri wilayah</option></select></label>
        <label id="rcArgWrap">Argumen <select id="rcArg"></select></label>
        <button type="button" class="op primary" data-op="run">▶ Jalankan</button><button type="button" class="op" data-op="step">Langkah ›</button><button type="button" class="op ghost" data-op="finish">Selesaikan ⏭</button></div>
      <div class="lab-stage rc-stage"><div class="rc-tree"><h5>Data yang ditelusuri</h5><div id="rcTree"></div></div>
        <div class="rc-stack"><h5>Call stack <small id="rcDepth"></small></h5><div id="rcFrames" class="rc-frames"></div><div id="rcResult" class="rc-result"></div></div></div>
      <div class="rc-progress"><span id="rcCount">Belum dijalankan</span><div class="bar"><i id="rcBar"></i></div></div>
      ${narrationHTML("rcNar")}</section>
    <section class="panel lab-code" id="rcCode"></section></div>`;
  let dataMode = "sample", events = [], pos = 0, state = null, playing = false;
  const sim = {}, nar = narrator(el.querySelector("#rcNar"));
  const code = codePanel(el.querySelector("#rcCode"), { methods: [{ label: "count", region: "RegionTree.count" }, { label: "findPath", region: "RegionTree.findPath" }, { label: "dfs", region: "WeightedGraph.dfs" }, { label: "insertPath", region: "RegionTree.insertPath" }, { label: "leaves", region: "RegionTree.leaves" }, { label: "dipakai: pohon wilayah", fn: "renderRegionTree", file: "admin-page.js", note: "render & hitung rekursif di menu Semua laporan" }] });
  const fnSel = el.querySelector("#rcFn"), argSel = el.querySelector("#rcArg");
  const reportsNow = () => dataMode === "real" ? ctx.getReports() : SAMPLE_REPORTS;
  const label = (fn, node) => `${fn}("${typeof node === "string" ? node : node.name}")`;
  function fillArgs() {
    const fn = fnSel.value, tree = buildRegionTree(reportsNow());
    let opts = [];
    if (fn === "count") opts = tree.preorder().filter(x => x.node.type !== "laporan").map(x => x.node.name);
    else if (fn === "findPath") opts = [...tree.leaves().map(r => r.id), ...PAKAL_VILLAGES, "Tidak-Ada"];
    else opts = ["Depot Pakal", ...PAKAL_VILLAGES];
    argSel.innerHTML = opts.map(o => `<option>${esc(o)}</option>`).join("");
    if (fn === "findPath") argSel.value = opts[Math.min(3, opts.length - 1)];
    code.show(fn === "dfs" ? "WeightedGraph.dfs" : `RegionTree.${fn}`);
    reset();
  }
  function prepare() {
    const fn = fnSel.value, arg = argSel.value;
    events = []; pos = 0;
    let order = [], result;
    if (fn === "dfs") {
      const g = new TracedGraph(); PAKAL_EDGES.forEach(([a, b, w]) => g.addEdge(a, b, w));
      g.onVisit = e => events.push(e); result = g.dfs(arg);
      order = g.vertices().map(v => ({ key: v, name: v, depth: 0, sub: g.neighbors(v).map(e => e.to).join(", ") }));
      state = { fn, arg, order, result: `urutan: ${result.join(" → ")}`, active: null, stack: [], done: new Map(), maxDepth: 0 };
    } else {
      const tree = buildRegionTree(reportsNow());
      const start = fn === "count" ? tree.findPath(arg)?.at(-1) || tree.root : tree.root;
      tree.onVisit = e => events.push(e);
      result = fn === "count" ? tree.count(start) : tree.findPath(arg);
      tree.onVisit = null;
      order = tree.preorder(start).map(x => ({ key: x.node, name: x.node.name, depth: x.depth, type: x.node.type }));
      state = { fn, arg, order, result: fn === "count" ? `count("${esc(start.name)}") = ${result}` : result ? `jalur: ${result.map(n => esc(n.name)).join(" › ")}` : `findPath("${esc(arg)}") = null (tidak ada)`, active: null, stack: [], done: new Map(), maxDepth: 0 };
    }
    nar.clear(); nar.say(`Menyiapkan <code>${esc(label(fn, arg))}</code>: ${events.length / 2} panggilan fungsi akan terjadi.`);
  }
  function reset() { events = []; pos = 0; state = null; playing = false; render(); el.querySelector("#rcCount").textContent = "Belum dijalankan"; el.querySelector("#rcBar").style.width = "0"; }
  function apply(e) {
    const fn = state.fn === "dfs" ? "dfs" : state.fn;
    if (e.type === "enter") {
      state.stack.push({ node: e.node, depth: e.depth }); state.active = e.node; state.maxDepth = Math.max(state.maxDepth, state.stack.length);
      const base = state.fn !== "dfs" && (e.node.type === "laporan" || (state.fn === "findPath" && e.node.name === state.arg));
      nar.say(`→ panggil <code>${esc(label(fn, e.node))}</code> · kedalaman ${state.stack.length}${base ? " · <b>kasus basis</b>" : ""}`);
    } else {
      state.stack.pop(); state.done.set(e.node, e.value); state.active = e.node;
      nar.say(`← <code>${esc(label(fn, e.node))}</code> selesai, mengembalikan <b>${esc(String(e.value))}</b>`, "ok");
    }
  }
  function render() {
    const treeEl = el.querySelector("#rcTree"), framesEl = el.querySelector("#rcFrames");
    if (!state) {
      treeEl.innerHTML = '<p class="muted small">Pilih fungsi lalu tekan <b>Jalankan</b> atau <b>Langkah</b>.</p>'; framesEl.innerHTML = '<div class="rc-empty">kosong</div>';
      el.querySelector("#rcResult").innerHTML = ""; el.querySelector("#rcDepth").textContent = ""; return;
    }
    const onStack = new Set(state.stack.map(f => f.node));
    treeEl.innerHTML = state.order.map(o => {
      const cls = o.key === state.active ? "active" : onStack.has(o.key) ? "onstack" : state.done.has(o.key) ? "done" : "";
      const val = state.done.get(o.key);
      return `<div class="rc-row ${cls} t-${o.type || "v"}" style="--d:${o.depth}"><span>${esc(o.name)}</span>${o.sub ? `<small>↔ ${esc(o.sub)}</small>` : ""}${val != null ? `<b>${esc(String(val))}</b>` : ""}</div>`;
    }).join("");
    treeEl.querySelector(".rc-row.active")?.scrollIntoView({ block: "nearest" });
    framesEl.innerHTML = state.stack.length ? [...state.stack].reverse().map((f, i) => `<div class="rc-frame ${i ? "" : "top"}"><code>${esc(label(state.fn, f.node))}</code><small>kedalaman ${f.depth + 1}</small></div>`).join("") : `<div class="rc-empty">${pos ? "kosong · semua panggilan selesai" : "kosong"}</div>`;
    el.querySelector("#rcDepth").textContent = `· kedalaman maks. ${state.maxDepth}`;
    el.querySelector("#rcResult").innerHTML = pos >= events.length && events.length ? `<span>Hasil</span><b>${state.result}</b>` : "";
    el.querySelector("#rcCount").textContent = `Langkah ${pos}/${events.length}`;
    el.querySelector("#rcBar").style.width = `${events.length ? pos / events.length * 100 : 0}%`;
  }
  async function stepOnce() {
    if (!state || pos >= events.length) prepare();
    apply(events[pos++]); render();
    if (pos >= events.length) nar.say(`Selesai. ${state.result}. Kedalaman call stack maksimum: ${state.maxDepth}.`, "ok");
  }
  const ops = {
    async run() { prepare(); playing = true; render(); while (playing && pos < events.length) { await stepOnce(); await wait(events.length > 60 ? 260 : 520); } playing = false; },
    async step() { await stepOnce(); },
    async finish() { if (!state || pos >= events.length) prepare(); while (pos < events.length) apply(events[pos++]); render(); nar.say(`Selesai. ${state.result}.`, "ok"); }
  };
  el.querySelector('[data-op="run"]').onclick = guard(sim, el, ops.run);
  el.querySelector('[data-op="step"]').onclick = () => { if (!sim.busy) stepOnce(); };
  el.querySelector('[data-op="finish"]').onclick = () => { playing = false; setTimeout(() => ops.finish(), sim.busy ? 600 / speed : 0); };
  fnSel.onchange = fillArgs; argSel.onchange = reset;
  el.querySelectorAll("[data-data]").forEach(b => b.onclick = () => { if (sim.busy) return; dataMode = b.dataset.data; el.querySelectorAll("[data-data]").forEach(x => x.classList.toggle("active", x === b)); fillArgs(); });
  fillArgs();
  return { onData() { if (dataMode === "real" && !sim.busy && !state) fillArgs(); } };
}

// ---------------------------------------------------------------------
// TREE (pohon wilayah)
// ---------------------------------------------------------------------
const NODE_ICON = { kota: "◉", kecamatan: "▣", kelurahan: "⌂", kategori: "◆", laporan: "•" };
function treeTab(el, ctx) {
  el.innerHTML = introHTML(INTRO.tree) + `<div class="lab-work">
    <section class="panel lab-sim">${simHead("Pohon wilayah", `<div class="seg" role="group"><button type="button" data-data="real" class="active">Laporan nyata</button><button type="button" data-data="sample">Contoh</button></div>`)}
      <div class="lab-controls"><input id="trId" maxlength="14" placeholder="ID laporan baru" class="w-id"><select id="trVil" aria-label="Kelurahan">${PAKAL_VILLAGES.map(v => `<option>${v}</option>`).join("")}</select><select id="trCat" aria-label="Kategori">${CATEGORIES.map(v => `<option>${v}</option>`).join("")}</select><button type="button" class="op primary" data-op="insert">insertPath()</button></div>
      <div class="lab-controls"><input id="trName" maxlength="40" placeholder="Nama simpul, mis. Benowo / GGR-2606" list="trNames"><datalist id="trNames"></datalist><button type="button" class="op" data-op="find">findPath()</button><button type="button" class="op" data-op="remove">remove()</button>
        <select id="trOrder" aria-label="Jenis traversal"><option value="preorder">pre-order</option><option value="postorder">post-order</option><option value="levelOrder">level-order (Queue)</option></select><button type="button" class="op" data-op="traverse">Telusuri</button></div>
      <div class="tr-stats" id="trStats"></div>
      <div class="lab-stage tr-stage" id="trStage"></div>
      ${narrationHTML("trNar")}</section>
    <section class="panel lab-code" id="trCode"></section></div>`;
  let dataMode = "real", tree = null, fx = {}, n = 1;
  const sim = {}, nar = narrator(el.querySelector("#trNar")), stage = el.querySelector("#trStage"), collapsed = new Set();
  const code = codePanel(el.querySelector("#trCode"), { methods: [{ label: "insertPath", region: "RegionTree.insertPath" }, { label: "findPath", region: "RegionTree.findPath" }, { label: "remove", region: "RegionTree.remove" }, { label: "preorder", region: "RegionTree.preorder" }, { label: "postorder", region: "RegionTree.postorder" }, { label: "levelOrder", region: "RegionTree.levelOrder" }, { label: "count", region: "RegionTree.count" }, { label: "TreeNode", region: "TreeNode" }, { label: "buildRegionTree", region: "buildRegionTree" }] });
  function build() { tree = buildRegionTree(dataMode === "real" ? ctx.getReports() : SAMPLE_REPORTS); fx = {}; render(); }
  function render() {
    const nodeHTML = (node, key) => {                       // dirender secara rekursif
      const k = `${key}/${node.name}`, open = !collapsed.has(k), leaf = node.type === "laporan";
      const cls = [node.type, fx.path?.has(node) ? "path" : "", fx.hit === node ? "hit" : "", fx.active === node ? "active" : "", fx.fresh === node ? "fresh" : ""].join(" ");
      const ord = fx.order?.get(node);
      return `<li class="${open ? "" : "closed"}"><div class="tr-node ${cls}">${leaf ? '<span class="tr-tog"></span>' : `<button type="button" class="tr-tog" data-k="${esc(k)}" aria-label="buka/tutup">${open ? "▾" : "▸"}</button>`}
        <i>${NODE_ICON[node.type]}</i><span class="tr-name">${esc(node.name)}</span>${leaf ? `<small>${esc(node.data?.status || "")}</small>` : `<b class="tr-count" title="count() rekursif">${tree.count(node)}</b>`}${ord ? `<em class="tr-ord">${ord}</em>` : ""}</div>
        ${node.children.length && open ? `<ul>${node.children.map(c => nodeHTML(c, k)).join("")}</ul>` : ""}</li>`;
    };
    stage.innerHTML = `<ul class="tr-root">${nodeHTML(tree.root, "")}</ul>`;
    stage.querySelectorAll("[data-k]").forEach(b => b.onclick = () => { collapsed.has(b.dataset.k) ? collapsed.delete(b.dataset.k) : collapsed.add(b.dataset.k); render(); });
    const all = tree.preorder();
    el.querySelector("#trStats").innerHTML = `<span>Simpul <b>${all.length}</b></span><span>Daun (laporan) <b>${tree.count()}</b></span><span>Tinggi <b>${tree.height()}</b></span><span>Akar <b>${esc(tree.root.name)}</b></span>`;
    el.querySelector("#trNames").innerHTML = all.map(x => `<option value="${esc(x.node.name)}">`).join("");
  }
  const expandPath = path => { let key = ""; path.forEach(nd => { key += `/${nd.name}`; collapsed.delete(key); }); };
  const ops = {
    async insert() {
      const id = el.querySelector("#trId").value.trim() || `LAB-${n++}`, village = el.querySelector("#trVil").value, category = el.querySelector("#trCat").value;
      el.querySelector("#trId").value = ""; code.show("RegionTree.insertPath", true);
      const existed = !!tree.findPath(village)?.at(-1)?.child(category);
      const leaf = tree.insertPath([{ name: "Kecamatan Pakal", type: "kecamatan" }, { name: village, type: "kelurahan" }, { name: category, type: "kategori" }], { id, village, category, status: "simulasi" });
      const path = tree.findPath(id); expandPath(path); fx = { path: new Set(path), fresh: leaf }; render();
      nar.say(`<code>insertPath([Kecamatan Pakal, ${esc(village)}, ${esc(category)}], ${esc(id)})</code> → turun ${path.length - 1} tingkat secara rekursif${existed ? "" : `; simpul kategori <b>${esc(category)}</b> dibuat baru`}. Angka di setiap leluhur bertambah 1.`, "ok");
    },
    async find() {
      const name = el.querySelector("#trName").value.trim(); code.show("RegionTree.findPath", true);
      if (!name) return nar.say("Isi nama simpul yang dicari.", "warn");
      const visited = []; tree.onVisit = e => { if (e.type === "enter") visited.push(e.node); };
      const path = tree.findPath(name); tree.onVisit = null;
      for (const nd of visited.slice(0, 40)) { fx = { active: nd }; render(); await wait(visited.length > 20 ? 120 : 300); }
      if (path) { expandPath(path); fx = { path: new Set(path), hit: path.at(-1) }; render(); nar.say(`<code>findPath("${esc(name)}")</code> → ${path.map(p => esc(p.name)).join(" › ")}. ${visited.length} simpul diperiksa (DFS).`, "ok"); }
      else { fx = {}; render(); nar.say(`<code>findPath("${esc(name)}")</code> → <code>null</code>. Semua ${visited.length} simpul sudah diperiksa.`, "warn"); }
    },
    async remove() {
      const name = el.querySelector("#trName").value.trim(); code.show("RegionTree.remove", true);
      if (!name) return nar.say("Isi nama simpul yang akan dihapus.", "warn");
      const path = tree.findPath(name);
      if (!path || path.length === 1) return nar.say(path ? "Akar tidak bisa dihapus." : `Simpul "${esc(name)}" tidak ditemukan.`, "warn");
      const lost = tree.count(path.at(-1)); expandPath(path); fx = { path: new Set(path), hit: path.at(-1) }; render(); await wait(500);
      tree.remove(name); fx = {}; render();
      nar.say(`<code>remove("${esc(name)}")</code> → simpul beserta subtree-nya dihapus (${lost} laporan). Hanya di simulasi; data asli tidak berubah.`, "ok");
    },
    async traverse() {
      const kind = el.querySelector("#trOrder").value; code.show(`RegionTree.${kind}`, true);
      const seq = tree[kind](); collapsed.clear(); fx = { order: new Map() };
      for (const [i, { node }] of seq.entries()) { fx.order.set(node, i + 1); fx.active = node; render(); await wait(seq.length > 30 ? 110 : 280); }
      fx.active = null; render();
      nar.say(`${kind}: ${seq.slice(0, 8).map(x => esc(x.node.name)).join(" → ")}${seq.length > 8 ? ` → … (${seq.length} simpul)` : ""}`, "ok");
    }
  };
  el.querySelectorAll("[data-op]").forEach(b => b.onclick = guard(sim, el, () => ops[b.dataset.op]()));
  el.querySelectorAll("[data-data]").forEach(b => b.onclick = () => { if (sim.busy) return; dataMode = b.dataset.data; el.querySelectorAll("[data-data]").forEach(x => x.classList.toggle("active", x === b)); collapsed.clear(); build(); nar.say(dataMode === "real" ? "Pohon disusun ulang dari laporan nyata." : "Pohon contoh (6 laporan)."); });
  build();
  let lastCount = -1;
  return { onData() { const c = ctx.getReports().length; if (dataMode === "real" && !sim.busy && c !== lastCount) { lastCount = c; build(); } } };
}

// ---------------------------------------------------------------------
// GRAPH (Dijkstra, BFS, DFS)
// ---------------------------------------------------------------------
const LABEL_AT = { "Babat Jerawat|Sumber Rejo": .7 };   // geser label agar tidak menumpuk
const POS = { "Benowo": [230, 62], "Pakal": [330, 172], "Babat Jerawat": [540, 250], "Sumber Rejo": [100, 272], "Depot Pakal": [355, 345] };
function graphTab(el) {
  const names = Object.keys(POS);
  el.innerHTML = introHTML(INTRO.graph) + `<div class="lab-work">
    <section class="panel lab-sim">${simHead("Rute terpendek Kecamatan Pakal")}
      <div class="lab-controls"><label>Asal <select id="grFrom">${names.map(v => `<option ${v === "Depot Pakal" ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label>Tujuan <select id="grTo">${names.map(v => `<option ${v === "Sumber Rejo" ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <button type="button" class="op primary" data-op="dijkstra">▶ Dijkstra</button><button type="button" class="op" data-op="bfs">BFS</button><button type="button" class="op" data-op="dfs">DFS</button><button type="button" class="op ghost" data-op="reset">Buka semua jalan</button></div>
      <p class="lab-note small">Klik angka jarak pada sebuah jalan untuk <b>menutup/membuka jalan</b> (removeEdge/addEdge), lalu jalankan Dijkstra lagi.</p>
      <div class="lab-stage gr-stage"><svg id="grSvg" viewBox="0 0 640 400" role="img" aria-label="Graph jalan antar kelurahan"></svg>
        <div class="gr-table"><h5>Tabel jarak Dijkstra</h5><table><thead><tr><th>Simpul</th><th>Jarak</th><th>Dari</th></tr></thead><tbody id="grDist"></tbody></table><div id="grResult" class="gr-result"></div></div></div>
      ${narrationHTML("grNar")}</section>
    <section class="panel lab-code" id="grCode"></section></div>`;
  const closed = new Set(), sim = {}, nar = narrator(el.querySelector("#grNar"));
  const code = codePanel(el.querySelector("#grCode"), { methods: [{ label: "dijkstra", region: "WeightedGraph.dijkstra" }, { label: "shortestPath", region: "WeightedGraph.shortestPath" }, { label: "bfs", region: "WeightedGraph.bfs" }, { label: "dfs", region: "WeightedGraph.dfs" }, { label: "addEdge", region: "WeightedGraph.addEdge" }, { label: "removeEdge", region: "WeightedGraph.removeEdge" }, { label: "data jalan", region: "PAKAL_EDGES" }] });
  const ekey = (a, b) => [a, b].sort().join("|");
  const graph = () => { const g = buildPakalGraph(PAKAL_EDGES.filter(([a, b]) => !closed.has(ekey(a, b)))); names.forEach(v => g.addVertex(v)); return g; };
  let view = { dist: null, prev: {}, visited: new Set(), current: null, edge: null, pathEdges: new Set(), pathNodes: new Set(), order: new Map() };
  const resetView = () => view = { dist: null, prev: {}, visited: new Set(), current: null, edge: null, pathEdges: new Set(), pathNodes: new Set(), order: new Map() };
  function render() {
    const svg = el.querySelector("#grSvg"), from = el.querySelector("#grFrom").value, to = el.querySelector("#grTo").value;
    const edges = PAKAL_EDGES.map(([a, b, w]) => {
      const [x1, y1] = POS[a], [x2, y2] = POS[b], t = LABEL_AT[ekey(a, b)] ?? .5, mx = x1 + (x2 - x1) * t, my = y1 + (y2 - y1) * t, k = ekey(a, b);
      const cls = closed.has(k) ? "closed" : view.pathEdges.has(k) ? "path" : view.edge === k ? "relax" : "";
      return `<g class="gr-edge ${cls}" data-edge="${esc(k)}"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><g class="gr-w" transform="translate(${mx} ${my})"><rect x="-26" y="-13" width="52" height="26" rx="13"/><text y="4.5">${closed.has(k) ? "ditutup" : w.toString().replace(".", ",") + " km"}</text></g></g>`;
    }).join("");
    const nodes = names.map(v => {
      const [x, y] = POS[v], d = view.dist?.[v];
      const cls = [v === view.current ? "current" : "", view.visited.has(v) ? "visited" : "", view.pathNodes.has(v) ? "path" : "", v === from ? "start" : "", v === to ? "end" : ""].join(" ");
      return `<g class="gr-node ${cls}" transform="translate(${x} ${y})"><circle r="${v === "Depot Pakal" ? 30 : 27}"/><text class="gr-name" y="${y > 300 ? 48 : -36}">${esc(v)}</text>
        <text class="gr-d" y="5">${d == null ? (v === "Depot Pakal" ? "D" : v.split(" ").map(s => s[0]).join("")) : Number.isFinite(d) ? d.toFixed(1).replace(".", ",") : "∞"}</text>${view.order.has(v) ? `<g class="gr-ord" transform="translate(22 -22)"><circle r="11"/><text y="4">${view.order.get(v)}</text></g>` : ""}</g>`;
    }).join("");
    svg.innerHTML = edges + nodes;
    svg.querySelectorAll("[data-edge] .gr-w").forEach(w => w.onclick = () => { if (sim.busy) return; const k = w.parentNode.dataset.edge; closed.has(k) ? closed.delete(k) : closed.add(k); resetView(); render(); nar.say(`${closed.has(k) ? "Jalan ditutup" : "Jalan dibuka"}: ${esc(k.replace("|", " – "))} → <code>${closed.has(k) ? "removeEdge" : "addEdge"}()</code>`, closed.has(k) ? "warn" : "ok"); code.show(closed.has(k) ? "WeightedGraph.removeEdge" : "WeightedGraph.addEdge", true); });
    el.querySelector("#grDist").innerHTML = names.map(v => { const d = view.dist?.[v]; return `<tr class="${v === view.current ? "current" : view.visited.has(v) ? "visited" : ""}"><td>${esc(v)}</td><td>${d == null ? "—" : fmtKm(d)}</td><td>${esc(view.prev[v] || "—")}</td></tr>`; }).join("");
  }
  const ops = {
    async dijkstra() {
      const from = el.querySelector("#grFrom").value, to = el.querySelector("#grTo").value, g = graph(), steps = [];
      code.show("WeightedGraph.dijkstra", true); resetView();
      const res = g.shortestPath(from, to, e => steps.push(e));
      view.dist = Object.fromEntries(names.map(v => [v, v === from ? 0 : Infinity])); render();
      nar.say(`Mulai dari <b>${esc(from)}</b>: jarak ${esc(from)} = 0, simpul lain = ∞. Priority Queue berisi [${esc(from)}].`);
      await wait(700);
      for (const s of steps) {
        if (s.type === "visit") { view.current = s.node; view.visited.add(s.node); view.edge = null; render(); nar.say(`dequeue → <b>${esc(s.node)}</b> (jarak terkecil ${fmtKm(view.dist[s.node])}). Jaraknya kini pasti.`); await wait(800); }
        else {
          view.edge = ekey(s.from, s.to);
          if (s.better) { view.dist[s.to] = s.alt; view.prev[s.to] = s.from; }
          render();
          nar.say(`cek ${esc(s.from)} → ${esc(s.to)}: ${fmtKm(view.dist[s.from])} + ${fmtKm(s.alt - view.dist[s.from])} = ${fmtKm(s.alt)} ${s.better ? `<b>lebih pendek</b>, jarak ${esc(s.to)} diperbarui & masuk antrean` : "tidak lebih pendek, abaikan"}`, s.better ? "ok" : "");
          await wait(650);
        }
      }
      view.current = null; view.edge = null;
      if (res.path.length) {
        for (let i = 1; i < res.path.length; i++) view.pathEdges.add(ekey(res.path[i - 1], res.path[i]));
        res.path.forEach(v => view.pathNodes.add(v));
        el.querySelector("#grResult").innerHTML = `<span>Jalur terpendek</span><b>${res.path.map(esc).join(" → ")}</b><em>${fmtKm(res.distance)}</em>`;
        nar.say(`Selesai. Jalur ditelusuri balik lewat kolom "Dari": ${res.path.map(esc).join(" → ")} = <b>${fmtKm(res.distance)}</b>.`, "ok");
      } else {
        el.querySelector("#grResult").innerHTML = `<span>Jalur terpendek</span><b>Tidak ada jalur</b><em>${esc(to)} terputus</em>`;
        nar.say(`Tidak ada jalur ke ${esc(to)}: semua jalan menuju ke sana ditutup (jarak tetap ∞).`, "warn");
      }
      render();
    },
    async bfs() { await traverse("bfs", "BFS (Queue): kunjungi semua tetangga dulu, baru lapis berikutnya"); },
    async dfs() { await traverse("dfs", "DFS (rekursif): masuk sedalam mungkin, baru mundur"); },
    async reset() { closed.clear(); resetView(); el.querySelector("#grResult").innerHTML = ""; render(); nar.say("Semua jalan dibuka kembali."); }
  };
  async function traverse(kind, text) {
    const from = el.querySelector("#grFrom").value, order = graph()[kind](from);
    code.show(`WeightedGraph.${kind}`, true); resetView(); el.querySelector("#grResult").innerHTML = ""; nar.say(`${text}, mulai dari ${esc(from)}.`);
    for (const [i, v] of order.entries()) { view.order.set(v, i + 1); view.current = v; view.visited.add(v); render(); await wait(600); }
    view.current = null; render();
    nar.say(`Urutan ${kind.toUpperCase()}: ${order.map(esc).join(" → ")}${order.length < names.length ? ` (${names.length - order.length} simpul tak terjangkau)` : ""}.`, "ok");
  }
  el.querySelectorAll("[data-op]").forEach(b => b.onclick = guard(sim, el, () => ops[b.dataset.op]()));
  el.querySelector("#grFrom").onchange = el.querySelector("#grTo").onchange = () => { if (!sim.busy) { resetView(); el.querySelector("#grResult").innerHTML = ""; render(); } };
  render();
  return {};
}

// ---------------------------------------------------------------------
// DATABASE (multi-user)
// ---------------------------------------------------------------------
const RLS_SQL = `-- Row Level Security: aturan baca/tulis per peran (supabase/schema.sql)
alter table public.reports enable row level security;

create policy "laporan: warga baca milik sendiri" on public.reports
  for select to authenticated using (owner_id = auth.uid());
create policy "laporan: teknisi baca tugasnya" on public.reports
  for select to authenticated
  using (technician_id = auth.uid() and public.app_role() = 'teknisi');
create policy "laporan: admin baca semua" on public.reports
  for select to authenticated using (public.app_role() = 'admin');

create policy "laporan: warga buat laporan" on public.reports
  for insert to authenticated
  with check (public.app_role() = 'warga' and owner_id = auth.uid());
create policy "laporan: admin ubah" on public.reports
  for update to authenticated using (public.app_role() = 'admin');`;
const ROLE_MATRIX = [
  ["Laporan (reports)", "buat; baca milik sendiri", "baca & ubah status tugasnya saja", "baca & ubah semua"],
  ["Profil (profiles)", "baca/ubah milik sendiri", "baca/ubah milik sendiri", "baca & ubah semua"],
  ["Status teknisi", "—", "ubah status sendiri (RPC)", "atur kapasitas & piket"],
  ["Riwayat status (report_events)", "baca laporan sendiri", "baca tugasnya", "baca semua"],
  ["Log keputusan, pengaturan", "—", "baca pengaturan", "baca & ubah"],
  ["Foto (storage)", "unggah ke folder sendiri", "unggah bukti tugasnya", "lihat semua"]
];
function dbTab(el, ctx) {
  const host = (() => { try { return SUPABASE_URL ? ` · ${new URL(SUPABASE_URL).host}` : " · mode demo lokal"; } catch { return ""; } })();
  el.innerHTML = introHTML(INTRO.db) + `<div class="lab-work db-work">
    <section class="panel lab-sim">${simHead("Koneksi & pengguna saat ini", `<button type="button" class="chip-btn" id="dbPing">Uji koneksi</button><label class="chip-btn toggle"><input type="checkbox" id="dbLive"> Pantau langsung (5 dtk)</label>`)}
      <div class="db-cards" id="dbCards"></div>
      <h5 class="db-sub">Laporan terbaru di database <small id="dbFeedInfo"></small></h5><ol class="db-feed" id="dbFeed"></ol>
      <div class="db-demo"><h5>Demo multi-user (3 akun sekaligus)</h5><ol>
        <li>Klik <a href="index.html" target="_blank" rel="noopener" class="link-btn">Buka tab baru ↗</a> lalu masuk sebagai <b>warga</b>; buka satu tab lagi untuk <b>teknisi</b>. Sesi login tersimpan per tab, jadi tidak saling menimpa.</li>
        <li>Nyalakan <b>Pantau langsung</b> di atas, lalu kirim laporan dari tab warga. Laporan muncul di daftar ini dalam ±5 detik.</li>
        <li>Tugaskan laporan itu di menu Antrean (atau biarkan dispatcher otomatis). Tab teknisi menerima tugas, tab warga melihat status berubah di Riwayat.</li></ol></div>
      ${narrationHTML("dbNar")}</section>
    <section class="panel lab-code" id="dbCode"></section></div>
    <section class="panel db-matrix"><div class="lab-head"><div><span class="section-kicker">Row Level Security</span><h3>Siapa boleh apa</h3></div></div>
      <div class="table-wrap"><table><thead><tr><th>Data</th><th>Warga</th><th>Teknisi</th><th>Admin</th></tr></thead><tbody>${ROLE_MATRIX.map(r => `<tr>${r.map((c, i) => i ? `<td>${c}</td>` : `<th>${c}</th>`).join("")}</tr>`).join("")}</tbody></table></div>
      <p class="lab-note">Aturan ini berlaku di database. Walau seseorang memanggil API langsung tanpa lewat tampilan web, data orang lain tetap tidak bisa dibaca.</p></section>`;
  const sim = {}, nar = narrator(el.querySelector("#dbNar"));
  codePanel(el.querySelector("#dbCode"), { title: "Koneksi & keamanan", methods: [
    { label: "koneksi Supabase", fn: "getSupabase", file: "supabase-service.js", note: "satu klien untuk semua halaman" },
    { label: "ambil laporan", fn: "listReports", file: "data-service.js" },
    { label: "kirim laporan", fn: "createReport", file: "data-service.js" },
    { label: "RLS (SQL)", code: RLS_SQL, lang: "sql", source: "supabase/schema.sql" }] });
  let ping = null, known = null, timer = null;
  async function doPing() {
    const t0 = performance.now();
    try { await getSettings(); ping = { ok: true, ms: Math.round(performance.now() - t0) }; nar.say(`Ping database berhasil: <b>${ping.ms} ms</b> (membaca tabel app_settings).`, "ok"); }
    catch (err) { ping = { ok: false, ms: null, err: err.message }; nar.say(`Koneksi gagal: ${esc(err.message)}`, "warn"); }
    onData();
  }
  async function poll() {
    try {
      const fresh = await listReports(ctx.user);
      const ids = new Set(fresh.map(r => r.id));
      const added = known ? fresh.filter(r => !known.has(r.id)) : [];
      known = ids;
      added.forEach(r => nar.say(`Laporan baru masuk dari <b>${esc(r.reporter || "warga")}</b>: ${esc(r.id)} · ${esc(r.village)}`, "ok"));
      if (added.length) await ctx.reload();
      renderFeed(fresh, new Set(added.map(r => r.id)));
    } catch (err) { nar.say(`Gagal memuat: ${esc(err.message)}`, "warn"); }
  }
  function renderFeed(list, hl) {
    const rows = [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6);
    el.querySelector("#dbFeed").innerHTML = rows.length ? rows.map(r => `<li class="${hl.has(r.id) ? "new" : ""}"><b>${esc(r.id)}</b><span>${esc(r.reporter || "—")} · ${esc(r.village)}</span><span class="status-pill ${esc(r.status.replaceAll(" ", "-"))}">${esc(r.status)}</span><time>${ago(r.createdAt)}</time></li>`).join("") : '<li class="muted">Belum ada laporan.</li>';
    el.querySelector("#dbFeedInfo").textContent = `· ${list.length} baris terlihat oleh akun ini`;
  }
  el.querySelector("#dbPing").onclick = guard(sim, el, doPing);
  el.querySelector("#dbLive").onchange = e => {
    clearInterval(timer);
    if (e.target.checked) { known = new Set(ctx.getReports().map(r => r.id)); timer = setInterval(() => { if (!document.hidden && !el.hidden) poll(); }, 5000); nar.say("Pantau langsung aktif: database dicek setiap 5 detik.", "ok"); }
    else nar.say("Pantau langsung dimatikan.");
  };
  function onData() {
    const reps = ctx.getReports(), techs = ctx.getTechs();
    const by = s => reps.filter(r => r.status === s).length;
    const online = techs.filter(t => t.lastSeenAt && Date.now() - new Date(t.lastSeenAt) < 10 * 60000);
    el.querySelector("#dbCards").innerHTML = `
      <div class="db-card"><span>Koneksi</span><b class="${ping?.ok === false ? "bad" : "good"}">● ${ping ? (ping.ok ? `Terhubung · ${ping.ms} ms` : "Gagal") : "Terhubung"}</b><small>Supabase PostgreSQL${host}</small></div>
      <div class="db-card"><span>Masuk sebagai</span><b>${esc(ctx.user.name)}</b><small>peran <code>${esc(ctx.user.role)}</code> · ${esc(ctx.user.email || "")}</small></div>
      <div class="db-card"><span>Laporan terlihat</span><b>${reps.length}</b><small>${by("Menunggu Verifikasi")} menunggu · ${by("Ditugaskan") + by("Menuju Lokasi")} diproses · ${by("Selesai")} selesai</small></div>
      <div class="db-card"><span>Teknisi aktif (10 mnt)</span><b>${online.length}/${techs.length}</b><small>${online.map(t => esc(t.name)).join(", ") || "belum ada yang online"}</small></div>`;
    if (!el.querySelector("#dbLive").checked) renderFeed(reps, new Set());
  }
  onData();
  return { onData, onShow() { if (!ping) doPing(); } };
}

// ---------------------------------------------------------------------
// UJI & RINGKASAN
// ---------------------------------------------------------------------
const SUMMARY = [
  ["Stack", "Riwayat aksi admin + tombol Urungkan", "push, pop, peek, isEmpty", "Aksi terakhir yang dibatalkan duluan (LIFO), O(1)", "Array biasa + cari indeks: lebih rumit, tidak menjamin urutan undo"],
  ["Queue / Priority Queue", "Antrean verifikasi & dispatcher, BFS, Dijkstra", "enqueue, dequeue, peek", "Laporan berbahaya didahulukan, aging cegah terlantar, O(log n)", "Sort ulang array tiap laporan masuk: O(n log n) per laporan"],
  ["Linked List", "Urutan rute kunjungan teknisi", "append, prepend, insertSorted, remove, find, traversal", "Tugas sering disisip/dihapus di tengah tanpa menggeser elemen", "Array: sisip di depan/tengah O(n) karena menggeser elemen"],
  ["Rekursif", "Hitung, cari, render pohon wilayah; DFS", "count, findPath, insertPath, preorder, dfs", "Mengikuti bentuk data bertingkat; kode ringkas", "Loop + stack manual: lebih panjang dan sulit dibaca"],
  ["Tree", "Pohon wilayah & filter di Semua laporan", "insertPath, findPath, remove, traversal", "Wilayah memang hierarkis; rekap per cabang", "Filter array berulang untuk tiap kombinasi wilayah"],
  ["Graph", "Rute & jarak teknisi, peta admin, dispatcher", "addEdge, removeEdge, dijkstra, bfs, dfs", "Jaringan jalan berbobot; Dijkstra menjamin jalur terpendek", "Jarak garis lurus: mengabaikan jalan yang sebenarnya"],
  ["Database", "Semua data, 3 peran bersamaan", "select, insert, update, RPC, trigger", "Data terpusat, aman per baris (RLS), real-time antar pengguna", "Penyimpanan lokal browser: tidak bisa dipakai bersama"]
];
function testsTab(el) {
  el.innerHTML = `<section class="panel lab-intro tests-intro"><div class="lab-intro-main"><span class="section-kicker">CPMK-1 · CPMK-4 · CPMK-10</span><h2>Pengujian & ringkasan</h2>
      <p class="lab-lead">Bukti bahwa setiap struktur data berjalan benar (uji unit) dan efisien (uji perbandingan dengan alternatif sederhana). Pengujian berjalan langsung di browser ini memakai kode yang sama dengan aplikasi.</p>
      <div class="tests-actions"><button type="button" class="button primary" id="tsRun">Jalankan semua pengujian</button><button type="button" class="button secondary" id="tsBench">Uji efisiensi</button><button type="button" class="button tertiary" id="tsCopy">Salin hasil (Markdown)</button></div></div>
      <div class="ts-score" id="tsScore"><b>—</b><span>belum dijalankan</span></div></section>
    <div class="lab-work tests-work"><section class="panel"><div class="lab-head"><div><span class="section-kicker">Uji unit</span><h3>Hasil pengujian</h3></div></div><div id="tsList" class="ts-list"></div></section>
      <section class="panel"><div class="lab-head"><div><span class="section-kicker">Uji efisiensi · waktu (ms), makin kecil makin cepat</span><h3>Struktur terpilih vs alternatif</h3></div></div><div id="tsBenchOut" class="ts-bench"><p class="muted small">Tekan <b>Uji efisiensi</b>. Angka bergantung pada perangkat; yang penting perbandingannya.</p></div></section></div>
    <section class="panel ts-summary"><div class="lab-head"><div><span class="section-kicker">Alasan pemilihan</span><h3>Ringkasan struktur data GlowGrid</h3></div></div>
      <div class="table-wrap"><table><thead><tr><th>Struktur</th><th>Dipakai untuk</th><th>Operasi</th><th>Alasan dipilih</th><th>Alternatif & kenapa tidak</th></tr></thead>
      <tbody>${SUMMARY.map(r => `<tr>${r.map((c, i) => i ? `<td>${c}</td>` : `<th>${c}</th>`).join("")}</tr>`).join("")}</tbody></table></div></section>`;
  let results = null, bench = null;
  function runTests() {
    const t0 = performance.now(); results = runStructureTests(); const total = performance.now() - t0;
    const pass = results.filter(r => r.ok).length;
    el.querySelector("#tsScore").innerHTML = `<b class="${pass === results.length ? "good" : "bad"}">${pass}/${results.length}</b><span>lolos · ${total.toFixed(1)} ms</span>`;
    const groups = [...new Set(results.map(r => r.group))];
    el.querySelector("#tsList").innerHTML = groups.map(g => `<div class="ts-group"><h5>${esc(g)}</h5><ul>${results.filter(r => r.group === g).map(r => `<li class="${r.ok ? "ok" : "fail"}"><span>${r.ok ? "✓" : "✗"}</span><div>${esc(r.name)}${r.error ? `<small>${esc(r.error)}</small>` : ""}</div><time>${r.ms.toFixed(2)} ms</time></li>`).join("")}</ul></div>`).join("");
  }
  async function runBench() {
    const out = el.querySelector("#tsBenchOut"); out.innerHTML = '<p class="muted small">Mengukur…</p>'; await new Promise(r => setTimeout(r, 30));
    bench = runBenchmarks();
    out.innerHTML = bench.map(b => { const max = Math.max(b.chosenMs, b.altMs || 0, .01), x = b.altMs ? b.altMs / Math.max(b.chosenMs, .01) : null;
      return `<div class="bm-row"><div class="bm-title"><b>${esc(b.name)}</b><small>${esc(b.big)}</small></div>
        <div class="bm-bar chosen"><span>${esc(b.chosen)}</span><i style="width:${b.chosenMs / max * 100}%"></i><em>${b.chosenMs.toFixed(2)} ms</em></div>
        ${b.altMs != null ? `<div class="bm-bar alt"><span>${esc(b.alt)}</span><i style="width:${b.altMs / max * 100}%"></i><em>${b.altMs.toFixed(2)} ms</em></div>` : ""}
        ${x ? `<p class="bm-x ${x >= 1 ? "good" : ""}">${x >= 1 ? `${x.toFixed(1)}× lebih cepat` : `${(1 / x).toFixed(1)}× lebih lambat (data kecil)`}</p>` : ""}</div>`; }).join("");
  }
  el.querySelector("#tsRun").onclick = runTests;
  el.querySelector("#tsBench").onclick = runBench;
  el.querySelector("#tsCopy").onclick = async () => {
    if (!results) runTests();
    let md = `## Hasil pengujian struktur data GlowGrid\n\nTanggal: ${new Date().toLocaleString("id-ID")}\n\n| Kelompok | Pengujian | Hasil |\n|---|---|---|\n`;
    md += results.map(r => `| ${r.group} | ${r.name} | ${r.ok ? "Lolos" : "Gagal"} |`).join("\n");
    md += `\n\n**${results.filter(r => r.ok).length}/${results.length} lolos**\n`;
    if (bench) md += `\n## Uji efisiensi\n\n| Skenario | Struktur dipilih | ms | Alternatif | ms |\n|---|---|---|---|---|\n` + bench.map(b => `| ${b.name} | ${b.chosen} | ${b.chosenMs.toFixed(2)} | ${b.alt} | ${b.altMs?.toFixed(2) ?? "—"} |`).join("\n") + "\n";
    try { await navigator.clipboard.writeText(md); toast("Hasil disalin. Tempel ke dokumentasi/README."); } catch { toast("Gagal menyalin ke clipboard."); }
  };
  return { onShow() { if (!results) runTests(); } };
}
