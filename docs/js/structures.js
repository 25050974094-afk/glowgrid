// =====================================================================
// GlowGrid · structures.js
// Implementasi struktur data yang DIPAKAI langsung oleh aplikasi:
//   Stack          → riwayat aksi admin + tombol Urungkan (admin-page.js)
//   Queue (FIFO)   → penelusuran BFS pada graph wilayah
//   PriorityQueue  → antrean verifikasi laporan (admin) + Dijkstra
//   LinkedList     → urutan rute kunjungan teknisi (teknisi-page.js)
//   Tree           → pohon wilayah Kota → Kecamatan → Kelurahan → Kategori → Laporan
//   Rekursif       → insert/cari/hitung/telusuri tree + DFS graph
//   Graph          → peta jalan antar-kelurahan + Dijkstra (rute terpendek)
// Penanda "#region" dipakai halaman Lab untuk menampilkan potongan kode ini.
// =====================================================================

// #region ListNode
/** Simpul untuk LinkedList dan Queue: menyimpan nilai + penunjuk ke simpul berikutnya. */
export class ListNode {
  constructor(value) {
    this.value = value;
    this.next = null;
  }
}
// #endregion ListNode

// ---------------------------------------------------------------------
// STACK (LIFO) · array dinamis, elemen teratas = akhir array
// ---------------------------------------------------------------------
// #region Stack
export class Stack {
  constructor(limit = Infinity) {
    this.items = [];
    this.limit = limit;            // batas riwayat (mis. 20 aksi terakhir)
  }
  // #region Stack.push
  push(item) {                     // O(1)
    this.items.push(item);
    if (this.items.length > this.limit) this.items.shift();   // buang yang paling lama
    return this.items.length;
  }
  // #endregion Stack.push
  // #region Stack.pop
  pop() {                          // O(1)
    return this.items.pop();       // undefined bila kosong
  }
  // #endregion Stack.pop
  // #region Stack.peek
  peek() {                         // O(1) · lihat elemen teratas tanpa mengambil
    return this.items[this.items.length - 1];
  }
  // #endregion Stack.peek
  isEmpty() { return this.items.length === 0; }
  get size() { return this.items.length; }
  clear() { this.items = []; }
  /** Elemen dari atas (terbaru) ke bawah. */
  toArray() { return [...this.items].reverse(); }
  static from(array, limit) { const s = new Stack(limit); array.forEach(x => s.push(x)); return s; }
}
// #endregion Stack

// ---------------------------------------------------------------------
// QUEUE (FIFO) · berbasis linked list → enqueue & dequeue O(1)
// ---------------------------------------------------------------------
// #region Queue
export class Queue {
  constructor() {
    this.head = null;              // depan antrean (keluar duluan)
    this.tail = null;              // belakang antrean (masuk terakhir)
    this.size = 0;
  }
  // #region Queue.enqueue
  enqueue(value) {                 // O(1) · masuk dari belakang
    const node = new ListNode(value);
    if (this.tail) this.tail.next = node; else this.head = node;
    this.tail = node;
    this.size++;
    return this.size;
  }
  // #endregion Queue.enqueue
  // #region Queue.dequeue
  dequeue() {                      // O(1) · keluar dari depan
    if (!this.head) return undefined;
    const value = this.head.value;
    this.head = this.head.next;
    if (!this.head) this.tail = null;
    this.size--;
    return value;
  }
  // #endregion Queue.dequeue
  peek() { return this.head?.value; }
  isEmpty() { return this.size === 0; }
  toArray() { const out = []; for (let n = this.head; n; n = n.next) out.push(n.value); return out; }
}
// #endregion Queue

// ---------------------------------------------------------------------
// PRIORITY QUEUE · binary heap (max-heap)
// Prioritas tertinggi keluar duluan; prioritas sama → yang datang lebih dulu (FIFO).
// ---------------------------------------------------------------------
// #region PriorityQueue
export class PriorityQueue {
  constructor() {
    this.heap = [];                // array yang mewakili pohon biner lengkap
    this.seq = 0;                  // nomor kedatangan untuk tie-break FIFO
    this.onStep = null;            // (opsional) dipakai Lab untuk animasi
  }
  // #region PriorityQueue.before
  /** a didahulukan dari b? prioritas lebih besar, atau sama tapi datang lebih awal. */
  before(a, b) {
    return a.priority !== b.priority ? a.priority > b.priority : a.seq < b.seq;
  }
  // #endregion PriorityQueue.before
  // #region PriorityQueue.enqueue
  enqueue(value, priority) {       // O(log n)
    const node = { value, priority, seq: this.seq++ };
    this.heap.push(node);
    this.onStep?.({ type: "add", index: this.heap.length - 1 });
    this.siftUp(this.heap.length - 1);
    return this.heap.length;
  }
  // #endregion PriorityQueue.enqueue
  // #region PriorityQueue.dequeue
  dequeue() {                      // O(log n)
    if (!this.heap.length) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length) {
      this.heap[0] = last;
      this.onStep?.({ type: "moveLast", index: 0 });
      this.siftDown(0);
    }
    return top.value;
  }
  // #endregion PriorityQueue.dequeue
  // #region PriorityQueue.siftUp
  siftUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(this.heap[i], this.heap[parent])) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  // #endregion PriorityQueue.siftUp
  // #region PriorityQueue.siftDown
  siftDown(i) {
    const n = this.heap.length;
    while (true) {
      const left = 2 * i + 1, right = left + 1;
      let best = i;
      if (left < n && this.before(this.heap[left], this.heap[best])) best = left;
      if (right < n && this.before(this.heap[right], this.heap[best])) best = right;
      if (best === i) break;
      this.swap(i, best);
      i = best;
    }
  }
  // #endregion PriorityQueue.siftDown
  swap(i, j) {
    [this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]];
    this.onStep?.({ type: "swap", i, j });
  }
  peek() { return this.heap[0]?.value; }
  isEmpty() { return this.heap.length === 0; }
  get size() { return this.heap.length; }
  /** Urutan keluar (tanpa merusak heap asli). O(n log n) */
  toSortedArray() {
    const copy = new PriorityQueue();
    copy.heap = this.heap.slice(); copy.seq = this.seq;
    const out = [];
    while (!copy.isEmpty()) { const node = copy.heap[0]; copy.dequeue(); out.push(node); }
    return out;
  }
}
// #endregion PriorityQueue

// ---------------------------------------------------------------------
// LINKED LIST · singly linked list dengan head & tail
// ---------------------------------------------------------------------
// #region LinkedList
export class LinkedList {
  constructor() {
    this.head = null;
    this.tail = null;
    this.size = 0;
    this.onVisit = null;           // (opsional) dipakai Lab untuk animasi penelusuran
  }
  // #region LinkedList.append
  append(value) {                  // O(1) · tambah di akhir
    const node = new ListNode(value);
    if (this.tail) this.tail.next = node; else this.head = node;
    this.tail = node;
    this.size++;
    return node;
  }
  // #endregion LinkedList.append
  // #region LinkedList.prepend
  prepend(value) {                 // O(1) · tambah di awal
    const node = new ListNode(value);
    node.next = this.head;
    this.head = node;
    if (!this.tail) this.tail = node;
    this.size++;
    return node;
  }
  // #endregion LinkedList.prepend
  // #region LinkedList.insertSorted
  /** Sisipkan di posisi yang tepat. before(a, b) = true bila a harus di depan b. O(n) */
  insertSorted(value, before) {
    if (!this.head || before(value, this.head.value)) return this.prepend(value);
    let cur = this.head;
    while (cur.next && !before(value, cur.next.value)) cur = cur.next;
    const node = new ListNode(value);
    node.next = cur.next;
    cur.next = node;
    if (!node.next) this.tail = node;
    this.size++;
    return node;
  }
  // #endregion LinkedList.insertSorted
  // #region LinkedList.remove
  /** Hapus simpul pertama yang memenuhi syarat. O(n) */
  remove(match) {
    let prev = null, cur = this.head;
    while (cur && !match(cur.value)) { prev = cur; cur = cur.next; }
    if (!cur) return undefined;
    if (prev) prev.next = cur.next; else this.head = cur.next;
    if (cur === this.tail) this.tail = prev;
    this.size--;
    return cur.value;
  }
  // #endregion LinkedList.remove
  // #region LinkedList.find
  /** Cari dengan menelusuri dari head. O(n) */
  find(match) {
    let index = 0;
    for (let cur = this.head; cur; cur = cur.next, index++) {
      this.onVisit?.(index, cur.value);
      if (match(cur.value)) return { index, value: cur.value };
    }
    return null;
  }
  // #endregion LinkedList.find
  // #region LinkedList.traverse
  /** Kunjungi setiap simpul berurutan (head → tail). O(n) */
  forEach(fn) {
    let index = 0;
    for (let cur = this.head; cur; cur = cur.next) fn(cur.value, index++);
  }
  // #endregion LinkedList.traverse
  toArray() { const out = []; this.forEach(v => out.push(v)); return out; }
  isEmpty() { return this.size === 0; }
}
// #endregion LinkedList

// ---------------------------------------------------------------------
// TREE · pohon wilayah (n-ary tree), operasi utamanya REKURSIF
// ---------------------------------------------------------------------
// #region TreeNode
export class TreeNode {
  constructor(name, type, data = null) {
    this.name = name;              // mis. "Benowo"
    this.type = type;              // kota | kecamatan | kelurahan | kategori | laporan
    this.data = data;              // objek laporan untuk simpul daun
    this.children = [];
  }
  addChild(node) { this.children.push(node); return node; }
  child(name) { return this.children.find(c => c.name === name); }
  isLeaf() { return this.children.length === 0; }
}
// #endregion TreeNode

// #region RegionTree
export class RegionTree {
  constructor(rootName = "Kota Surabaya") {
    this.root = new TreeNode(rootName, "kota");
    this.onVisit = null;           // (opsional) dipakai Lab untuk animasi call stack
  }
  // #region RegionTree.insertPath
  /** REKURSIF: turun satu tingkat per panggilan, buat simpul yang belum ada. */
  insertPath(path, leaf, node = this.root) {
    if (path.length === 0) {                                   // basis: sampai tujuan
      return leaf ? node.addChild(new TreeNode(leaf.id, "laporan", leaf)) : node;
    }
    const [step, ...rest] = path;
    const next = node.child(step.name) ?? node.addChild(new TreeNode(step.name, step.type));
    return this.insertPath(rest, leaf, next);                  // langkah rekursif
  }
  // #endregion RegionTree.insertPath
  // #region RegionTree.count
  /** REKURSIF: jumlah laporan (daun) di bawah suatu simpul. */
  count(node = this.root, depth = 0) {
    this.onVisit?.({ type: "enter", node, depth });
    let total;
    if (node.type === "laporan") total = 1;                    // basis
    else total = node.children.reduce((sum, c) => sum + this.count(c, depth + 1), 0);
    this.onVisit?.({ type: "exit", node, depth, value: total });
    return total;
  }
  // #endregion RegionTree.count
  // #region RegionTree.findPath
  /** REKURSIF (DFS): jalur dari akar ke simpul bernama `name`, atau null. */
  findPath(name, node = this.root, depth = 0) {
    this.onVisit?.({ type: "enter", node, depth });
    if (node.name === name) {                                  // basis: ketemu
      this.onVisit?.({ type: "exit", node, depth, value: "ketemu" });
      return [node];
    }
    for (const child of node.children) {
      const path = this.findPath(name, child, depth + 1);
      if (path) {
        this.onVisit?.({ type: "exit", node, depth, value: "ketemu" });
        return [node, ...path];
      }
    }
    this.onVisit?.({ type: "exit", node, depth, value: "null" });
    return null;
  }
  // #endregion RegionTree.findPath
  // #region RegionTree.remove
  /** REKURSIF: hapus simpul bernama `name` beserta anak-anaknya. */
  remove(name, node = this.root) {
    const index = node.children.findIndex(c => c.name === name);
    if (index >= 0) { node.children.splice(index, 1); return true; }
    return node.children.some(c => this.remove(name, c));
  }
  // #endregion RegionTree.remove
  // #region RegionTree.preorder
  /** REKURSIF: kunjungi simpul lalu anak-anaknya (pre-order). */
  preorder(node = this.root, depth = 0, out = []) {
    out.push({ node, depth });
    node.children.forEach(c => this.preorder(c, depth + 1, out));
    return out;
  }
  // #endregion RegionTree.preorder
  // #region RegionTree.postorder
  /** REKURSIF: anak-anak dulu, baru simpulnya (post-order). */
  postorder(node = this.root, depth = 0, out = []) {
    node.children.forEach(c => this.postorder(c, depth + 1, out));
    out.push({ node, depth });
    return out;
  }
  // #endregion RegionTree.postorder
  // #region RegionTree.levelOrder
  /** ITERATIF dengan Queue: kunjungi per tingkat (breadth-first). */
  levelOrder() {
    const out = [], queue = new Queue();
    queue.enqueue({ node: this.root, depth: 0 });
    while (!queue.isEmpty()) {
      const item = queue.dequeue();
      out.push(item);
      item.node.children.forEach(c => queue.enqueue({ node: c, depth: item.depth + 1 }));
    }
    return out;
  }
  // #endregion RegionTree.levelOrder
  // #region RegionTree.height
  height(node = this.root) {       // REKURSIF
    return node.children.length ? 1 + Math.max(...node.children.map(c => this.height(c))) : 0;
  }
  // #endregion RegionTree.height
  // #region RegionTree.leaves
  leaves(node = this.root, out = []) {   // REKURSIF: kumpulkan semua laporan di bawah simpul
    if (node.type === "laporan") out.push(node.data);
    node.children.forEach(c => this.leaves(c, out));
    return out;
  }
  // #endregion RegionTree.leaves
}
// #endregion RegionTree

export const PAKAL_VILLAGES = ["Babat Jerawat", "Benowo", "Pakal", "Sumber Rejo"];
// #region buildRegionTree
/** Susun laporan ke pohon: Kota → Kecamatan → Kelurahan → Kategori → Laporan. */
export function buildRegionTree(reports) {
  const tree = new RegionTree("Kota Surabaya");
  const kecamatan = { name: "Kecamatan Pakal", type: "kecamatan" };
  PAKAL_VILLAGES.forEach(v => tree.insertPath([kecamatan, { name: v, type: "kelurahan" }]));
  reports.forEach(r => tree.insertPath(
    [kecamatan, { name: r.village, type: "kelurahan" }, { name: r.category, type: "kategori" }], r));
  return tree;
}
// #endregion buildRegionTree

// ---------------------------------------------------------------------
// GRAPH · berbobot, tak berarah (adjacency list)
// ---------------------------------------------------------------------
// #region WeightedGraph
export class WeightedGraph {
  constructor() {
    this.adj = new Map();          // simpul → [{ to, w }]
  }
  addVertex(v) { if (!this.adj.has(v)) this.adj.set(v, []); }
  // #region WeightedGraph.addEdge
  addEdge(a, b, w) {               // O(1)
    this.addVertex(a); this.addVertex(b);
    this.adj.get(a).push({ to: b, w });
    this.adj.get(b).push({ to: a, w });
  }
  // #endregion WeightedGraph.addEdge
  // #region WeightedGraph.removeEdge
  removeEdge(a, b) {               // O(derajat simpul) · mis. jalan ditutup
    this.adj.set(a, (this.adj.get(a) || []).filter(e => e.to !== b));
    this.adj.set(b, (this.adj.get(b) || []).filter(e => e.to !== a));
  }
  // #endregion WeightedGraph.removeEdge
  vertices() { return [...this.adj.keys()]; }
  neighbors(v) { return this.adj.get(v) || []; }
  edges() {
    const out = [];
    for (const [a, list] of this.adj) for (const { to, w } of list) if (a < to) out.push({ a, b: to, w });
    return out;
  }
  // #region WeightedGraph.dijkstra
  /** Dijkstra memakai PriorityQueue (jarak terkecil keluar duluan). O((V + E) log V) */
  dijkstra(start, onStep = null) {
    const dist = {}, prev = {}, done = new Set();
    for (const v of this.adj.keys()) { dist[v] = Infinity; prev[v] = null; }
    dist[start] = 0;
    const pq = new PriorityQueue();
    pq.enqueue(start, -0);                                     // prioritas = -jarak
    while (!pq.isEmpty()) {
      const u = pq.dequeue();
      if (done.has(u)) continue;                               // entri lama, lewati
      done.add(u);
      onStep?.({ type: "visit", node: u, dist: { ...dist } });
      for (const { to, w } of this.neighbors(u)) {
        if (done.has(to)) continue;
        const alt = dist[u] + w;
        const better = alt < dist[to];
        onStep?.({ type: "relax", from: u, to, alt, better, dist: { ...dist } });
        if (better) { dist[to] = alt; prev[to] = u; pq.enqueue(to, -alt); }
      }
    }
    return { dist, prev };
  }
  // #endregion WeightedGraph.dijkstra
  // #region WeightedGraph.shortestPath
  shortestPath(start, end, onStep = null) {
    const { dist, prev } = this.dijkstra(start, onStep);
    const path = [];
    for (let v = end; v != null; v = prev[v]) path.unshift(v);   // telusuri balik
    return { distance: dist[end], path: path[0] === start ? path : [] };
  }
  // #endregion WeightedGraph.shortestPath
  // #region WeightedGraph.bfs
  bfs(start) {                     // ITERATIF dengan Queue · O(V + E)
    const order = [], seen = new Set([start]), queue = new Queue();
    queue.enqueue(start);
    while (!queue.isEmpty()) {
      const v = queue.dequeue();
      order.push(v);
      for (const { to } of this.neighbors(v)) if (!seen.has(to)) { seen.add(to); queue.enqueue(to); }
    }
    return order;
  }
  // #endregion WeightedGraph.bfs
  // #region WeightedGraph.dfs
  dfs(v, seen = new Set(), order = []) {   // REKURSIF · O(V + E)
    seen.add(v);
    order.push(v);
    for (const { to } of this.neighbors(v)) if (!seen.has(to)) this.dfs(to, seen, order);
    return order;
  }
  // #endregion WeightedGraph.dfs
}
// #endregion WeightedGraph

// #region PAKAL_EDGES
/** Jalan antar-kelurahan di Kecamatan Pakal (bobot = km, perkiraan). */
export const PAKAL_EDGES = [
  ["Depot Pakal", "Babat Jerawat", 1.1], ["Depot Pakal", "Pakal", 0.9],
  ["Babat Jerawat", "Pakal", 1.3], ["Babat Jerawat", "Sumber Rejo", 3.5],
  ["Pakal", "Benowo", 1.8], ["Pakal", "Sumber Rejo", 3.0], ["Benowo", "Sumber Rejo", 2.7]
];
export function buildPakalGraph(edges = PAKAL_EDGES) {
  const g = new WeightedGraph();
  edges.forEach(([a, b, w]) => g.addEdge(a, b, w));
  return g;
}
// #endregion PAKAL_EDGES

// #region buildRouteList
/** Rute teknisi sebagai LinkedList: urgensi tertinggi dulu, lalu jarak (Dijkstra) terdekat dari depot. */
export function buildRouteList(tasks, graph, depot = "Depot Pakal") {
  const { dist } = graph.dijkstra(depot);
  const before = (a, b) => a.urgency !== b.urgency ? a.urgency > b.urgency : a.km < b.km;
  const route = new LinkedList();
  tasks.forEach(task => route.insertSorted({ ...task, km: dist[task.village] ?? Infinity }, before));
  return route;
}
// #endregion buildRouteList
