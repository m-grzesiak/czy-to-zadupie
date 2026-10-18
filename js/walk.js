import { haversineMeters } from './util.js';
import { setLoading } from './dom.js';
import { META, STOPS } from './data.js';

        // m/min po ulicach (~4,5 km/h)
export let WALK = null;
              // null = nie wczytano, false = brak pliku, obiekt = graf

let walkPromise = null;
export function loadWalk() {
  if (WALK !== null) return Promise.resolve(WALK);
  if (!walkPromise) {
    setLoading('walk', 'Wczytuję sieć ulic…');
    walkPromise = loadWalkInner().finally(() => setLoading('walk', null));
  }
  return walkPromise;
}
async function loadWalkInner() {
  if (!META || !META.walk) { WALK = false; return WALK; }
  try {
    const res = await fetch('./' + META.walk.path);
    if (!res.ok) throw new Error(res.status);
    const buf = await res.arrayBuffer();
    const h = new Uint32Array(buf, 0, 4);
    if (h[0] !== 0x314B4C57) throw new Error('zły format');
    const N = h[1], E = h[2], G = h[3];
    let o = 16;
    const nodes = new Int32Array(buf, o, 2 * N); o += 8 * N;
    const ends = new Uint32Array(buf, o, 2 * E); o += 8 * E;
    const goff = new Uint32Array(buf, o, E + 1); o += 4 * (E + 1);
    const geom = new Int32Array(buf, o, 2 * G); o += 8 * G;
    const len = new Uint16Array(buf, o, E);
    // sąsiedztwo (CSR)
    const adjStart = new Uint32Array(N + 1);
    for (let e = 0; e < E; e++) { adjStart[ends[2 * e] + 1]++; adjStart[ends[2 * e + 1] + 1]++; }
    for (let i = 0; i < N; i++) adjStart[i + 1] += adjStart[i];
    const fill = adjStart.slice(0, N), adjE = new Uint32Array(2 * E);
    for (let e = 0; e < E; e++) { adjE[fill[ends[2 * e]]++] = e; adjE[fill[ends[2 * e + 1]]++] = e; }
    // przystanki <-> węzły
    const S = STOPS.length, snapNode = new Int32Array(S).fill(-1), snapLen = new Float32Array(S);
    const nsStart = new Uint32Array(N + 1);
    STOPS.forEach((st, k) => { if (st.w && st.w[0] < N) { snapNode[k] = st.w[0]; snapLen[k] = st.w[1]; nsStart[st.w[0] + 1]++; } });
    for (let i = 0; i < N; i++) nsStart[i + 1] += nsStart[i];
    const nsFill = nsStart.slice(0, N), nsStop = new Uint32Array(nsStart[N]);
    for (let k = 0; k < S; k++) if (snapNode[k] >= 0) nsStop[nsFill[snapNode[k]]++] = k;
    // siatka węzłów do szukania najbliższego ulicy punktu kliknięcia
    const GC = 0.003, grid = new Map();
    for (let i = 0; i < N; i++) {
      const key = Math.floor(nodes[2 * i] / 1e6 / GC) + ',' + Math.floor(nodes[2 * i + 1] / 1e6 / GC);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
    }
    WALK = { N, E, nodes, ends, goff, geom, len, adjStart, adjE, snapNode, snapLen, nsStart, nsStop, grid, GC };
  } catch (err) {
    console.warn('Brak sieci pieszej, zasięg w przybliżeniu:', err);
    WALK = false;
  }
  return WALK;
}
export function nearestNode(lat, lon) {
  const W = WALK, cy = Math.floor(lat / W.GC), cx = Math.floor(lon / W.GC);
  let best = -1, bd = Infinity;
  for (let r = 1; r <= 3 && best < 0; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      (W.grid.get((cy + dy) + ',' + (cx + dx)) || []).forEach(i => {
        const d = haversineMeters(lat, lon, W.nodes[2 * i] / 1e6, W.nodes[2 * i + 1] / 1e6);
        if (d < bd) { bd = d; best = i; }
      });
    }
  }
  return best < 0 ? null : { node: best, d: bd };
}
export function edgePoints(e, reverse) {
  const W = WALK, a = W.ends[2 * e], b = W.ends[2 * e + 1];
  const pts = [[W.nodes[2 * a] / 1e6, W.nodes[2 * a + 1] / 1e6]];
  for (let i = W.goff[e]; i < W.goff[e + 1]; i++) pts.push([W.geom[2 * i] / 1e6, W.geom[2 * i + 1] / 1e6]);
  pts.push([W.nodes[2 * b] / 1e6, W.nodes[2 * b + 1] / 1e6]);
  return reverse ? pts.reverse() : pts;
}
// fragment łamanej od początku o długości frac (0..1) jej długości
export function cutPoints(pts, frac) {
  if (frac >= 1) return pts;
  const seg = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { const d = haversineMeters(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]); seg.push(d); total += d; }
  let left = frac * total;
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (left >= seg[i - 1]) { out.push(pts[i]); left -= seg[i - 1]; continue; }
    const f = seg[i - 1] ? left / seg[i - 1] : 0;
    out.push([pts[i - 1][0] + f * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + f * (pts[i][1] - pts[i - 1][1])]);
    break;
  }
  return out;
}
// indeks przestrzenny krawędzi (komórki ~0,01°), budowany raz
export function edgeIndex() {
  const W = WALK;
  if (W.eidx) return W.eidx;
  const C = 0.01, cells = new Map();
  const add = (key, e) => { let a = cells.get(key); if (!a) cells.set(key, a = []); a.push(e); };
  for (let e = 0; e < W.E; e++) {
    const a = W.ends[2 * e], b = W.ends[2 * e + 1];
    let la0 = Math.min(W.nodes[2 * a], W.nodes[2 * b]), la1 = Math.max(W.nodes[2 * a], W.nodes[2 * b]);
    let lo0 = Math.min(W.nodes[2 * a + 1], W.nodes[2 * b + 1]), lo1 = Math.max(W.nodes[2 * a + 1], W.nodes[2 * b + 1]);
    for (let i = W.goff[e]; i < W.goff[e + 1]; i++) {
      la0 = Math.min(la0, W.geom[2 * i]); la1 = Math.max(la1, W.geom[2 * i]);
      lo0 = Math.min(lo0, W.geom[2 * i + 1]); lo1 = Math.max(lo1, W.geom[2 * i + 1]);
    }
    for (let y = Math.floor(la0 / 1e6 / C); y <= Math.floor(la1 / 1e6 / C); y++)
      for (let x = Math.floor(lo0 / 1e6 / C); x <= Math.floor(lo1 / 1e6 / C); x++) add(y * 100000 + x, e);
  }
  W.eidx = { C, cells, stamp: new Uint32Array(W.E), gen: 0 };
  return W.eidx;
}
