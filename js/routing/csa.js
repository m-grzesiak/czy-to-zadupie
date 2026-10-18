import { state } from '../state.js';
import { TRANSFER_MIN, WALK_SPEED } from '../config.js';
import { META, STOPS, STOP_INDEX, profileFor } from '../data.js';
import { WALK } from '../walk.js';
import { chainPts, mergeWalkArea, originWalk, streetPath, walkDijkstra } from './street.js';

         // zapas na przesiadkę z pojazdu na pojazd (min)
let TRANSFERS = null;
           // przesiadki piesze między przystankami (transfers.bin)
const connCache = new Map();
    // "p_chunk" -> Promise<Uint16Array>

async function loadTransfers() {
  if (TRANSFERS !== null) return TRANSFERS;
  try {
    const buf = await (await fetch('./' + META.walk.transfers)).arrayBuffer();
    const h = new Uint32Array(buf, 0, 3);
    if (h[0] !== 0x31465254) throw new Error('format');
    const S = h[1], M = h[2];
    let o = 12;
    const start = new Uint32Array(buf, o, S + 1); o += 4 * (S + 1);
    const to = new Uint16Array(buf, o, M); o += 2 * M;
    const m = new Uint16Array(buf, o, M);
    TRANSFERS = { start, to, m };
  } catch (e) { TRANSFERS = false; }
  return TRANSFERS;
}
function loadConnFile(name) {
  if (!connCache.has(name)) {
    connCache.set(name, fetch(`./${META.conns.path}${name}.bin`)
      .then(r => r.ok ? r.arrayBuffer() : new ArrayBuffer(0)).then(b => new Uint16Array(b)).catch(() => new Uint16Array(0)));
  }
  return connCache.get(name);
}
export const timeModeAvailable = () => !!(META && META.conns && META.walk && META.walk.transfers);
async function runCSA(o, ow, dateISO, t0, T) {
  const prof = profileFor(dateISO);
  if (!prof) return null;
  const P = prof.p, W = META.conns.window;
  const have = new Set(META.conns.chunks[String(P)] || []);
  const ids = [];
  for (let c = Math.floor(t0 / W); c <= Math.floor((t0 + T) / W); c++) if (have.has(c)) ids.push(c);
  const [tripsTab, ...chunks] = await Promise.all([loadConnFile(`p${P}_trips`), ...ids.map(c => loadConnFile(`p${P}_${c}`))]);
  const TR = await loadTransfers();
  const S = STOPS.length, SI = STOP_INDEX(), nT = tripsTab.length / 2;
  const arr = new Float64Array(S).fill(Infinity), board = new Float64Array(S).fill(Infinity);
  const pk = new Int8Array(S), pa = new Int32Array(S).fill(-1), pb = new Int32Array(S).fill(-1), pd = new Int16Array(S);
  const tripOn = new Int32Array(nT).fill(-1), tripDep = new Int16Array(nT);
  const foot = (k, t) => {
    if (!TR) return;
    for (let i = TR.start[k]; i < TR.start[k + 1]; i++) {
      const u = TR.to[i], tt = t + TR.m[i] / WALK_SPEED;
      if (tt < arr[u]) { arr[u] = tt; board[u] = tt; pk[u] = 3; pa[u] = k; }
    }
  };
  // start: przystanek (0 min, można przejść na sąsiedni słupek) albo przystanki z okręgu (dojście ulicami)
  if (o.point) ow.tw.forEach((t, k) => { arr[k] = t0 + t; board[k] = arr[k]; pk[k] = 1; });
  else o.poles.forEach(p => { const k = SI.get(p.id); arr[k] = t0; board[k] = t0; pk[k] = 1; });
  if (!o.point) o.poles.forEach(p => foot(SI.get(p.id), t0));
  const tEnd = t0 + T;
  for (const C of chunks) {
    for (let i = 0; i < C.length; i += 5) {
      const dep = C[i + 2];
      if (dep < t0) continue;
      if (dep > tEnd) break;
      const from = C[i], to = C[i + 1], a = C[i + 3], tr = C[i + 4];
      if (tripOn[tr] < 0) {
        if (board[from] > dep) continue;
        tripOn[tr] = from; tripDep[tr] = dep;
      }
      if (a < arr[to] && a <= tEnd) {
        arr[to] = a; board[to] = a + TRANSFER_MIN; pk[to] = 2; pa[to] = tr; pb[to] = tripOn[tr]; pd[to] = tripDep[tr];
        foot(to, a);
      }
    }
  }
  return { P, approx: prof.approx, t0, arr, pk, pa, pb, pd, tripsTab, chunks };
}
export async function runIsoTime(o, T, dateISO, t0) {
  const N = WALK.N, SI = STOP_INDEX();
  const ow = o.point ? originWalk(o, T) : null;
  const csa = await runCSA(o, ow, dateISO, t0, T);
  if (!csa) return null;
  const seeds = [];
  STOPS.forEach((st, k) => {
    const rel = csa.arr[k] - t0;
    if (rel <= T) seeds.push({ v: N + k, t: rel, noWalk: o.point && csa.pk[k] === 1 });
  });
  const res = walkDijkstra(seeds, T, { noRide: true });
  if (ow) mergeWalkArea(res, ow);
  const labels = new Map();
  let rides = 0;
  STOPS.forEach((st, k) => {
    const t = res.time[N + k];
    if (t <= T) {
      labels.set(st.id, { t, origin: csa.pk[k] === 1 && res.prev[N + k] < 0 });
      if (csa.pk[k] === 2) rides++;
    }
  });
  return { labels, res, walk1: ow && ow.walk1, csa, rides };
}
// etapy przed przystankiem k w trybie "wyjazd o godzinie": przejazdy i przesiadki piesze
export function csaLegs(k, X = state.iso) {
  const C = X.csa, out = [];
  let g = 0;
  while (g++ < 60) {
    const kind = C.pk[k];
    if (kind === 2) {
      const b = C.pb[k];
      out.unshift({ ride: true, ti: C.pa[k], from: b, to: k, dep: C.pd[k], arr: C.arr[k], wait: C.pd[k] - C.arr[b] });
      k = b;
    } else if (kind === 3) {
      const f = C.pa[k];
      out.unshift({ walk: true, pts: streetPath(f, k), min: C.arr[k] - C.arr[f] });
      k = f;
    } else {
      if (X.o.point) {
        const sn = WALK.snapNode[k];
        const pts = X.walk1 && sn >= 0 && isFinite(X.walk1.time[sn]) ? chainPts(X.walk1, sn) : [[X.o.lat, X.o.lon]];
        pts.unshift([X.o.lat, X.o.lon]);
        pts.push([STOPS[k].lat, STOPS[k].lon]);
        out.unshift({ walk: true, pts, min: C.arr[k] - C.t0 });
      }
      break;
    }
  }
  return out;
}
export function csaRideInfo(l, X = state.iso) {
  const C = X.csa, key = META.conns.routes[C.tripsTab[2 * l.ti]], head = META.conns.heads[C.tripsTab[2 * l.ti + 1]];
  if (!l.pts) {   // przystanki pośrednie z połączeń tego kursu
    const seq = [l.from];
    for (const ch of C.chunks) for (let i = 0; i < ch.length; i += 5) {
      if (ch[i + 4] === l.ti && ch[i + 2] >= l.dep && ch[i + 3] <= l.arr) seq.push(ch[i + 1]);
    }
    l.pts = [...new Set(seq)].map(k => [STOPS[k].lat, STOPS[k].lon]);
  }
  return { key, head };
}
