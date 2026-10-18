import { TRANSFER_MIN, WALK_SPEED } from '../config.js';
import { META, STOPS, STOP_INDEX, profileFor } from '../data.js';
import { WALK, stopLatLng } from '../walk.js';
import { chainPts, mergeWalkArea, originWalk, reachedSnap, stopLabels, streetPath, walkDijkstra } from './street.js';

let TRANSFERS = null;   // walking transfers between stops (transfers.bin): null = not loaded, false = missing
const connCache = new Map();   // "p<P>_<window>" -> Promise<Uint16Array>

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
// Connection Scan from t0 for T min. At stop k: arr = arrival, pk = how it was reached (1 = start,
// 2 = ride on trip pa from stop pb, departure pd; 3 = walking transfer from stop pa)
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
  // start: a stop (0 min, may walk to a neighbouring pole) or stops in the circle (walk along streets)
  const start = (k, t) => { arr[k] = t; board[k] = t; pk[k] = 1; };
  if (o.point) ow.tw.forEach((t, k) => start(k, t0 + t));
  else {
    const ks = o.poles.map(p => SI.get(p.id));
    ks.forEach(k => start(k, t0));
    ks.forEach(k => foot(k, t0));
  }
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
  const ow = o.point ? originWalk(o, T) : null;
  const csa = await runCSA(o, ow, dateISO, t0, T);
  if (!csa) return null;
  // area: walking only from the reached stops (starting stops from a point were already reached via streets)
  const N = WALK.N, S = STOPS.length, seeds = [];
  for (let k = 0; k < S; k++) {
    const rel = csa.arr[k] - t0;
    if (rel <= T) seeds.push({ v: N + k, t: rel, noWalk: o.point && csa.pk[k] === 1 });
  }
  const res = walkDijkstra(seeds, T, { noRide: true });
  if (ow) mergeWalkArea(res, ow);
  const labels = stopLabels(res, T, k => csa.pk[k] === 1);
  let rides = 0;
  for (let k = 0; k < S; k++) if (csa.pk[k] === 2 && res.time[N + k] <= T) rides++;
  return { labels, res, walk1: ow && ow.walk1, csa, rides };
}
// legs before stop k in "depart at time" mode: rides and walking transfers
export function csaLegs(k, X) {
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
        const sn = reachedSnap(X.walk1, k), o = [X.o.lat, X.o.lon];
        const pts = [o, ...(sn >= 0 ? chainPts(X.walk1, sn) : [o]), stopLatLng(k)];
        out.unshift({ walk: true, pts, min: C.arr[k] - C.t0 });
      }
      break;
    }
  }
  return out;
}
export function csaRideInfo(l, X) {
  const C = X.csa, key = META.conns.routes[C.tripsTab[2 * l.ti]];
  if (!l.pts) {   // intermediate stops from this trip's connections
    const seq = [l.from];
    for (const ch of C.chunks) for (let i = 0; i < ch.length; i += 5) {
      if (ch[i + 4] === l.ti && ch[i + 2] >= l.dep && ch[i + 3] <= l.arr) seq.push(ch[i + 1]);
    }
    l.pts = [...new Set(seq)].map(stopLatLng);
  }
  return { key };
}
