import { haversineMeters } from '../util.js';
import { WAIT_MAX, WALK_MAX, WALK_MPM } from '../config.js';
import { ROUTES, STOPS, STOP_BY_ID, STOP_INDEX } from '../data.js';
import { heapPop, heapPush } from './heap.js';

const DAY_TYPES = ['w', 's', 'n'];
// Graf przejazdów (kursy, wsiadanie na przystankach, przejścia w linii prostej), budowany raz: transitGraph()
export let isoGraph = null;
export const transitGraph = () => isoGraph || (isoGraph = buildIsoGraph());
function buildIsoGraph() {
  const trips = [], board = new Map();
  Object.entries(ROUTES).forEach(([key, r]) => (r.trips || []).forEach(t => {
    const anyHp = t && t.hp && DAY_TYPES.some(d => (t.hp[d] || []).some(Boolean));
    if (!t || !t.s || !(t.hw || t.hwS || t.hwN || anyHp)) return;
    const keep = [];
    t.s.forEach(([id, off], i) => { if (off != null && STOP_BY_ID.has(id)) keep.push(i); });
    const s = keep.map(i => t.s[i]);
    if (s.length < 2) return;
    const ti = trips.length;
    const hws = { w: t.hw, s: t.hwS, n: t.hwN };
    // hp: odstęp kursów linii na każdym przystanku wariantu (wszystkie końcówki jadące dalej tą samą trasą)
    const hp = t.hp ? Object.fromEntries(DAY_TYPES.map(d => [d, keep.map(i => (t.hp[d] || [])[i] ?? null)])) : null;
    const tr = { key, h: t.h, hws, hp, s };
    setTripWaits(tr, 'w');
    trips.push(tr);
    s.forEach(([id], pos) => {
      if (pos === s.length - 1) return;
      if (!board.has(id)) board.set(id, []);
      board.get(id).push([ti, pos]);
    });
  }));
  return { trips, board, walk: stopWalkNeighbours() };
}
// sąsiedzi pieszo w linii prostej do WALK_MAX (siatka ~0,005°): przybliżenie, gdy nie ma walk.bin
function stopWalkNeighbours() {
  const G = 0.005, grid = new Map();
  const gk = (a, b) => a + ',' + b;
  STOPS.forEach(s => {
    const k = gk(Math.floor(s.lat / G), Math.floor(s.lon / G));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(s);
  });
  const walk = new Map();
  STOPS.forEach(s => {
    const gy = Math.floor(s.lat / G), gx = Math.floor(s.lon / G), out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) {
      (grid.get(gk(gy + dy, gx + dx)) || []).forEach(o => {
        if (o.id === s.id) return;
        const d = haversineMeters(s.lat, s.lon, o.lat, o.lon);
        if (d <= WALK_MAX) out.push([o.id, d]);
      });
    }
    walk.set(s.id, out);
  });
  return walk;
}
// Zasięg bez walk.bin: Dijkstra po przystankach, przejścia w linii prostej (bez łańcuchów spacerów)
export function runIso(origin, T) {
  const { trips, board, walk } = transitGraph();
  const labels = new Map(), heap = [];
  const relax = (id, t, lab) => {
    if (t > T) return;
    const cur = labels.get(id);
    if (cur && cur.t <= t) return;
    labels.set(id, { t, ...lab });
    heapPush(heap, [t, id]);
  };
  origin.poles.forEach(p => relax(p.id, p.t0 || 0, { prev: null, origin: true }));
  while (heap.length) {
    const [t, id] = heapPop(heap);
    const lab = labels.get(id);
    if (!lab || lab.t < t) continue;
    if (!lab.walk) {
      (walk.get(id) || []).forEach(([o, d]) => relax(o, t + d / WALK_MPM, { prev: id, walk: true }));
    }
    (board.get(id) || []).forEach(([ti, pos]) => {
      const tr = trips[ti], base = tr.s[pos][1], t0 = t + tr.waitP[pos];
      for (let j = pos + 1; j < tr.s.length; j++) {
        const nt = t0 + (tr.s[j][1] - base);
        if (nt > T) break;
        relax(tr.s[j][0], nt, { prev: id, ti, from: pos, to: j });
      }
    });
  }
  return labels;
}
// Przejazdy w postaci indeksów (raz): przystanek -> [kurs, pozycja] (CSR: bStart, bT, bP),
// kurs -> indeksy przystanków (tsi) i czasy (tof), numer linii kursu (tline)
export function tripIndex() {
  const G = transitGraph();
  if (G.tsi) return G;
  const SI = STOP_INDEX(), S = STOPS.length;
  const tsi = G.trips.map(tr => Int32Array.from(tr.s.map(([id]) => SI.get(id))));
  const tof = G.trips.map(tr => Float64Array.from(tr.s.map(x => x[1])));
  const cnt = new Uint32Array(S + 1);
  tsi.forEach(si => { for (let p = 0; p < si.length - 1; p++) cnt[si[p] + 1]++; });
  for (let i = 0; i < S; i++) cnt[i + 1] += cnt[i];
  const fill = cnt.slice(0, S), bT = new Int32Array(cnt[S]), bP = new Int16Array(cnt[S]);
  tsi.forEach((si, ti) => { for (let p = 0; p < si.length - 1; p++) { const j = fill[si[p]]++; bT[j] = ti; bP[j] = p; } });
  // kursy jednej linii leżą obok siebie, więc na przystanku też są po kolei
  const lid = new Map();
  const tline = Int32Array.from(G.trips, tr => (lid.has(tr.key) || lid.set(tr.key, lid.size), lid.get(tr.key)));
  return Object.assign(G, { tsi, tof, bStart: cnt, bT, bP, tline });
}
// ile wolniej od najszybszej może jechać linia, żeby i tak wsiąść w pierwszy pojazd, który przyjedzie
export const rideSlack = d => Math.max(3, 0.2 * d);
// Czekanie na przystanku = połowa odstępu kursów (bez limitu: rzadkie linie nie są „za kwadrans”).
// waitP[pos]: odstęp z tego przystanku (hp), inaczej odstęp wariantu; Infinity = nie kursuje w ten typ dnia.
function setTripWaits(tr, dt) {
  const half = h => (h ? Math.min(Math.max(h / 2, 1), WAIT_MAX) : Infinity);
  tr.wait = half(tr.hws[dt]);
  const hp = tr.hp && tr.hp[dt];
  tr.waitP = Float64Array.from(tr.s, (_, pos) => (hp && hp[pos] ? half(hp[pos]) : tr.wait));
}
export function applyDayType(dt) {
  transitGraph().trips.forEach(tr => setTripWaits(tr, dt));
}
// Inne linie z przystanku wsiadania etapu `l` do tego samego przystanku wysiadania, na które też
// warto wsiąść (te same zasady co wspólne linie w walkDijkstra), najwyżej 3
export function altLines(l) {
  const G = tripIndex(), k = G.tsi[l.ti][l.from], kz = G.tsi[l.ti][l.to];
  const d0 = G.tof[l.ti][l.to] - G.tof[l.ti][l.from], out = new Map();
  const own = G.trips[l.ti].key;
  for (let b = G.bStart[k]; b < G.bStart[k + 1]; b++) {
    const ti = G.bT[b], pos = G.bP[b], tr = G.trips[ti];
    if (tr.key === own || tr.waitP[pos] === Infinity) continue;
    const j = G.tsi[ti].indexOf(kz, pos + 1);
    if (j < 0) continue;
    const d = G.tof[ti][j] - G.tof[ti][pos];
    if (!out.has(tr.key) || d < out.get(tr.key)) out.set(tr.key, d);
  }
  const dmin = Math.min(d0, ...out.values());
  return [...out].filter(([, d]) => d <= dmin + rideSlack(dmin)).map(([key]) => key).slice(0, 3);
}
