// Pengujian unit struktur data GlowGrid. Dijalankan di halaman Lab (tombol "Jalankan pengujian")
// dan juga bisa di terminal: node docs/js/structures.test.js
import { Stack, Queue, PriorityQueue, LinkedList, RegionTree, buildRegionTree, buildPakalGraph } from "./structures.js";

export function runStructureTests() {
  const results = [];
  const test = (group, name, fn) => {
    const t0 = performance.now();
    try { const ok = fn(); results.push({ group, name, ok: ok !== false, ms: performance.now() - t0 }); }
    catch (err) { results.push({ group, name, ok: false, error: err.message, ms: performance.now() - t0 }); }
  };
  const eq = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`diharapkan ${JSON.stringify(b)}, didapat ${JSON.stringify(a)}`); return true; };

  // ---- Stack
  test("Stack", "push lalu pop mengembalikan elemen terakhir (LIFO)", () => { const s = new Stack(); s.push("a"); s.push("b"); s.push("c"); return eq([s.pop(), s.pop(), s.size], ["c", "b", 1]); });
  test("Stack", "peek tidak mengubah isi", () => { const s = Stack.from([1, 2]); return eq([s.peek(), s.size], [2, 2]); });
  test("Stack", "pop pada stack kosong → undefined", () => eq(new Stack().pop(), undefined));
  test("Stack", "batas riwayat membuang elemen tertua", () => { const s = new Stack(3); [1, 2, 3, 4].forEach(x => s.push(x)); return eq(s.toArray(), [4, 3, 2]); });

  // ---- Queue
  test("Queue", "enqueue/dequeue berurutan (FIFO)", () => { const q = new Queue(); ["a", "b", "c"].forEach(x => q.enqueue(x)); return eq([q.dequeue(), q.dequeue(), q.peek(), q.size], ["a", "b", "c", 1]); });
  test("Queue", "dequeue sampai kosong lalu dipakai lagi", () => { const q = new Queue(); q.enqueue(1); q.dequeue(); q.enqueue(2); return eq([q.toArray(), q.dequeue(), q.isEmpty()], [[2], 2, true]); });

  // ---- PriorityQueue
  test("Priority Queue", "urgensi tertinggi keluar duluan", () => { const pq = new PriorityQueue(); [["A", 40], ["B", 92], ["C", 65]].forEach(([v, p]) => pq.enqueue(v, p)); return eq([pq.dequeue(), pq.dequeue(), pq.dequeue()], ["B", "C", "A"]); });
  test("Priority Queue", "prioritas sama → yang datang duluan keluar duluan", () => { const pq = new PriorityQueue(); ["X", "Y", "Z"].forEach(v => pq.enqueue(v, 50)); return eq(pq.toSortedArray().map(n => n.value), ["X", "Y", "Z"]); });
  test("Priority Queue", "sifat heap terjaga setelah 200 operasi acak", () => {
    const pq = new PriorityQueue(); let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    for (let i = 0; i < 200; i++) rnd() < .65 || pq.isEmpty() ? pq.enqueue(i, Math.floor(rnd() * 100)) : pq.dequeue();
    return pq.heap.every((n, i) => i === 0 || !pq.before(n, pq.heap[(i - 1) >> 1]));
  });
  test("Priority Queue", "toSortedArray tidak merusak heap", () => { const pq = new PriorityQueue(); [5, 1, 9].forEach(p => pq.enqueue(p, p)); pq.toSortedArray(); return eq(pq.size, 3); });

  // ---- LinkedList
  test("Linked List", "append & prepend menjaga head/tail", () => { const l = new LinkedList(); l.append("b"); l.prepend("a"); l.append("c"); return eq([l.toArray(), l.head.value, l.tail.value, l.size], [["a", "b", "c"], "a", "c", 3]); });
  test("Linked List", "insertSorted menyisipkan di posisi yang tepat", () => { const l = new LinkedList(); const before = (a, b) => a > b; [50, 90, 20, 70].forEach(x => l.insertSorted(x, before)); return eq(l.toArray(), [90, 70, 50, 20]); });
  test("Linked List", "remove di tengah, awal, dan akhir", () => { const l = new LinkedList(); [1, 2, 3, 4].forEach(x => l.append(x)); l.remove(x => x === 2); l.remove(x => x === 1); l.remove(x => x === 4); return eq([l.toArray(), l.head.value, l.tail.value, l.size], [[3], 3, 3, 1]); });
  test("Linked List", "find mengembalikan indeks; tidak ada → null", () => { const l = new LinkedList(); ["x", "y", "z"].forEach(v => l.append(v)); return eq([l.find(v => v === "z"), l.find(v => v === "q")], [{ index: 2, value: "z" }, null]); });

  // ---- Tree + rekursif
  const sample = [
    { id: "R1", village: "Benowo", category: "Lampu padam" }, { id: "R2", village: "Benowo", category: "Lampu padam" },
    { id: "R3", village: "Pakal", category: "Tiang/kabel bermasalah" }
  ];
  test("Tree", "pohon wilayah tersusun 5 tingkat", () => { const t = buildRegionTree(sample); return eq([t.root.children[0].name, t.height()], ["Kecamatan Pakal", 4]); });
  test("Tree", "4 kelurahan selalu ada walau tanpa laporan", () => eq(buildRegionTree([]).root.children[0].children.map(c => c.name), ["Babat Jerawat", "Benowo", "Pakal", "Sumber Rejo"]));
  test("Tree", "kategori yang sama digabung dalam satu simpul", () => eq(buildRegionTree(sample).findPath("Benowo").at(-1).children.length, 1));
  test("Rekursif", "count() menghitung semua daun secara rekursif", () => { const t = buildRegionTree(sample); return eq([t.count(), t.count(t.findPath("Benowo").at(-1))], [3, 2]); });
  test("Rekursif", "findPath() mengembalikan jalur akar → simpul", () => eq(buildRegionTree(sample).findPath("R3").map(n => n.name), ["Kota Surabaya", "Kecamatan Pakal", "Pakal", "Tiang/kabel bermasalah", "R3"]));
  test("Rekursif", "remove() menghapus subtree", () => { const t = buildRegionTree(sample); t.remove("Lampu padam"); return eq(t.count(), 1); });
  test("Rekursif", "preorder vs postorder: akar di awal vs di akhir", () => { const t = buildRegionTree(sample); return eq([t.preorder()[0].node.name, t.postorder().at(-1).node.name], ["Kota Surabaya", "Kota Surabaya"]); });
  test("Tree", "levelOrder (Queue) mengunjungi per tingkat", () => { const depths = buildRegionTree(sample).levelOrder().map(x => x.depth); return depths.every((d, i) => i === 0 || d >= depths[i - 1]); });
  test("Rekursif", "panggilan rekursif tercatat masuk/keluar seimbang", () => { const t = buildRegionTree(sample); let depth = 0, max = 0; t.onVisit = e => { depth += e.type === "enter" ? 1 : -1; max = Math.max(max, depth); }; t.count(); return eq([depth, max], [0, 5]); });

  // ---- Graph
  test("Graph", "Dijkstra Depot → Benowo = 2,7 km lewat Pakal", () => { const r = buildPakalGraph().shortestPath("Depot Pakal", "Benowo"); return eq([+r.distance.toFixed(1), r.path], [2.7, ["Depot Pakal", "Pakal", "Benowo"]]); });
  test("Graph", "Dijkstra Depot → Sumber Rejo = 3,9 km", () => eq(+buildPakalGraph().shortestPath("Depot Pakal", "Sumber Rejo").distance.toFixed(1), 3.9));
  test("Graph", "jalan ditutup → rute berganti otomatis", () => { const g = buildPakalGraph(); g.removeEdge("Pakal", "Benowo"); const r = g.shortestPath("Depot Pakal", "Benowo"); return eq([+r.distance.toFixed(1), r.path], [6.6, ["Depot Pakal", "Pakal", "Sumber Rejo", "Benowo"]]); });
  test("Graph", "simpul terputus → tidak ada jalur", () => { const g = buildPakalGraph(); g.addVertex("Pulau"); const r = g.shortestPath("Depot Pakal", "Pulau"); return eq([r.distance, r.path], [Infinity, []]); });
  test("Graph", "BFS (Queue) & DFS (rekursif) mengunjungi semua simpul", () => { const g = buildPakalGraph(); return eq([g.bfs("Depot Pakal").length, g.dfs("Depot Pakal").length], [5, 5]); });
  test("Graph", "BFS mulai dari tetangga terdekat", () => eq(buildPakalGraph().bfs("Depot Pakal").slice(0, 3), ["Depot Pakal", "Babat Jerawat", "Pakal"]));

  return results;
}

// Uji efisiensi (CPMK-1): bandingkan struktur yang dipilih dengan alternatif sederhana.
export function runBenchmarks(n = 20000) {
  const time = fn => { const t0 = performance.now(); fn(); return performance.now() - t0; };
  const rows = [];
  // 1. Antrean prioritas: heap vs "sort ulang array setiap ada laporan baru"
  const pr = Array.from({ length: Math.min(n, 3000) }, (_, i) => (i * 7919) % 100);
  rows.push({ name: `Antrean ${pr.length} laporan masuk satu per satu`, chosen: "Priority Queue (heap)", chosenMs: time(() => { const pq = new PriorityQueue(); pr.forEach((p, i) => pq.enqueue(i, p)); while (!pq.isEmpty()) pq.dequeue(); }),
    alt: "Array + sort ulang tiap masuk", altMs: time(() => { const a = []; pr.forEach((p, i) => { a.push({ i, p }); a.sort((x, y) => y.p - x.p); }); while (a.length) a.shift(); }), big: "O(log n) vs O(n log n) per laporan" });
  // 2. Queue FIFO: linked list vs Array.shift
  rows.push({ name: `${n} enqueue + dequeue`, chosen: "Queue (linked list)", chosenMs: time(() => { const q = new Queue(); for (let i = 0; i < n; i++) q.enqueue(i); while (!q.isEmpty()) q.dequeue(); }),
    alt: "Array.push + Array.shift", altMs: time(() => { const a = []; for (let i = 0; i < n; i++) a.push(i); while (a.length) a.shift(); }), big: "O(1) vs O(n) per dequeue" });
  // 3. Sisip di depan: linked list vs Array.unshift
  rows.push({ name: `${n} sisip di depan`, chosen: "Linked List.prepend", chosenMs: time(() => { const l = new LinkedList(); for (let i = 0; i < n; i++) l.prepend(i); }),
    alt: "Array.unshift", altMs: time(() => { const a = []; for (let i = 0; i < n; i++) a.unshift(i); }), big: "O(1) vs O(n) per sisip" });
  // 4. Stack: push/pop
  rows.push({ name: `${n} push + pop`, chosen: "Stack (array, ujung belakang)", chosenMs: time(() => { const s = new Stack(); for (let i = 0; i < n; i++) s.push(i); while (!s.isEmpty()) s.pop(); }),
    alt: "Array.unshift + shift (ujung depan)", altMs: time(() => { const a = []; for (let i = 0; i < n; i++) a.unshift(i); while (a.length) a.shift(); }), big: "O(1) vs O(n)" });
  // 5. Hitung laporan per wilayah: tree rekursif vs filter berulang
  const villages = ["Babat Jerawat", "Benowo", "Pakal", "Sumber Rejo"], cats = ["Lampu padam", "Penerangan kurang", "Menyala pada siang hari", "Tiang/kabel bermasalah"];
  const reps = Array.from({ length: 5000 }, (_, i) => ({ id: "R" + i, village: villages[i % 4], category: cats[(i >> 2) % 4] }));
  const tree = buildRegionTree(reps);
  rows.push({ name: "Rekap 5000 laporan per 4 kelurahan × 4 kategori", chosen: "Tree + count() rekursif", chosenMs: time(() => { for (const k of tree.root.children[0].children) { tree.count(k); k.children.forEach(c => tree.count(c)); } }),
    alt: "filter() array untuk tiap kombinasi", altMs: time(() => { villages.forEach(v => { reps.filter(r => r.village === v).length; cats.forEach(c => reps.filter(r => r.village === v && r.category === c).length); }); }), big: "satu kali susun O(n), lalu hitung per cabang" });
  // 6. Rute: Dijkstra dengan heap
  const g = buildPakalGraph();
  rows.push({ name: "1000× rute terpendek Depot → semua kelurahan", chosen: "Graph + Dijkstra (heap)", chosenMs: time(() => { for (let i = 0; i < 1000; i++) g.dijkstra("Depot Pakal"); }),
    alt: "—", altMs: null, big: "O((V + E) log V)" });
  return rows;
}

// Jalankan langsung dari terminal: node docs/js/structures.test.js
if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("structures.test.js")) {
  const res = runStructureTests();
  res.forEach(r => console.log(`${r.ok ? "PASS" : "FAIL"} [${r.group}] ${r.name}${r.error ? " — " + r.error : ""}`));
  console.log(`${res.filter(r => r.ok).length}/${res.length} lolos`);
  console.table(runBenchmarks().map(r => ({ uji: r.name, dipilih: r.chosen, ms: r.chosenMs.toFixed(2), alternatif: r.alt, ms_alt: r.altMs?.toFixed(2) ?? "—" })));
  if (res.some(r => !r.ok)) process.exit(1);
}
