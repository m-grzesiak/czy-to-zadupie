import { state } from '../state.js';
import { haversineMeters } from '../util.js';
import { WALK_SPEED } from '../config.js';
import { STOPS, STOP_INDEX } from '../data.js';
import { WALK, edgePoints, nearestNode } from '../walk.js';
import { TypedHeap } from './heap.js';
import { isoGraph, rideSlack, tripIndex } from './transit.js';
import { csaLegs, csaRideInfo } from './csa.js';

// Dijkstra po węzłach ulic (0..N-1) i przystankach (N..N+S-1).
// Z przejazdami liczy się na dwóch warstwach: 0 = jeszcze bez przejazdu, 1 = po pierwszym przejeździe.
// Pierwsze wsiadanie jest bez czekania (z domu wychodzi się na konkretny odjazd), na przesiadkach
// czeka się średnio (połowa odstępu, wspólne linie). Wynik: tablice dla lepszej warstwy (time, prev…)
// i pełne warstwy w `L` (ścieżki w walkLegsFrom).
export function walkDijkstra(seeds, T, opts = {}) {
  const W = WALK, N = W.N, S = STOPS.length, M = N + S;
  const G = tripIndex(), trips = G.trips;
  const walkOnly = !!opts.walkOnly, noRide = !!opts.noRide;
  const NL = walkOnly || noRide ? 1 : 2, MM = NL * M;
  const time = new Float64Array(MM).fill(Infinity);   // Float64: porównanie z kolejką musi być dokładne
  const prev = new Int32Array(MM).fill(-1), kind = new Int8Array(MM), via = new Int32Array(MM);
  const rFrom = new Int16Array(MM), rTo = new Int16Array(MM), rWait = new Float32Array(MM), noWalk = new Uint8Array(MM);
  const heap = new TypedHeap(1 << 16);
  let curWait = 0;
  const relax = (v, t, u, k, x, f, g) => {
    if (t > T || t >= time[v]) return;
    time[v] = t; prev[v] = u; kind[v] = k; via[v] = x;
    if (k === 3) { rFrom[v] = f; rTo[v] = g; rWait[v] = curWait; }
    heap.push(t, v);
  };
  // wspólne linie: na przesiadce czekasz na pierwszy pojazd z linii, które dowiozą do celu (prawie) tak
  // szybko jak najszybsza, więc ich częstotliwości się sumują (np. A6 i A17 z Mietniowa do Wieliczki)
  const { tline } = G;
  const minR = new Float64Array(S), acc = new Float64Array(S), best = new Float64Array(S);
  const vm = new Int32Array(S), gm = new Int32Array(S), touched = new Int32Array(S);
  let vs = 0, gs = 0;
  seeds.forEach(sd => { relax(sd.v, sd.t, -1, 0, 0); if (sd.noWalk) noWalk[sd.v] = 1; });
  const { adjStart, adjE, ends, len, nsStart, nsStop, snapNode, snapLen } = W;
  const { bStart, bT, bP, tsi, tof } = G;
  while (heap.n) {
    const x = heap.pop(), t = heap.top;
    if (t > time[x]) continue;
    const lay = x >= M ? M : 0, u = x - lay;
    if (u < N) {
      for (let i = adjStart[u]; i < adjStart[u + 1]; i++) {
        const e = adjE[i], v = ends[2 * e] === u ? ends[2 * e + 1] : ends[2 * e];
        relax(lay + v, t + len[e] / WALK_SPEED, x, 1, e);
      }
      if (!walkOnly) for (let i = nsStart[u]; i < nsStart[u + 1]; i++) {
        const k = nsStop[i];
        relax(lay + N + k, t + snapLen[k] / WALK_SPEED, x, 2, 0);
      }
    } else {
      const k = u - N;
      if (!noWalk[x] && snapNode[k] >= 0) relax(lay + snapNode[k], t + snapLen[k] / WALK_SPEED, x, 2, 0);
      if (noRide || walkOnly) continue;
      const b0 = bStart[k], b1 = bStart[k + 1];
      if (b0 === b1) continue;
      if (!lay) {
        // pierwszy przejazd: odjazd wg rozkładu, bez czekania
        curWait = 0;
        for (let b = b0; b < b1; b++) {
          const ti = bT[b], pos = bP[b], si = tsi[ti], of = tof[ti], base = of[pos];
          if (trips[ti].waitP[pos] === Infinity) continue;   // linia nie kursuje w ten typ dnia
          for (let j = pos + 1; j < si.length; j++) {
            const d = of[j] - base;
            if (t + d > T) break;
            relax(M + N + si[j], t + d, x, 3, ti, pos, j);
          }
        }
        continue;
      }
      // 1) najkrótsza jazda do każdego dalszego przystanku
      vs++;
      for (let b = b0; b < b1; b++) {
        const ti = bT[b], pos = bP[b], si = tsi[ti], of = tof[ti], base = of[pos];
        if (trips[ti].waitP[pos] === Infinity) continue;
        for (let j = pos + 1; j < si.length; j++) {
          const d = of[j] - base, v = si[j];
          if (t + d > T) break;
          if (vm[v] !== vs) { vm[v] = vs; minR[v] = d; acc[v] = 0; } else if (d < minR[v]) minR[v] = d;
        }
      }
      // 2) suma częstotliwości linii jadących niewiele dłużej niż najszybsza (każda linia raz)
      let cur = -1, nt = 0;
      for (let b = b0; b <= b1; b++) {
        if (b === b1 || tline[bT[b]] !== cur) {
          for (let i = 0; i < nt; i++) acc[touched[i]] += best[touched[i]];
          nt = 0;
          if (b === b1) break;
          cur = tline[bT[b]]; gs++;
        }
        const ti = bT[b], pos = bP[b], si = tsi[ti], of = tof[ti], base = of[pos], w = trips[ti].waitP[pos];
        if (w === Infinity) continue;
        const f = 1 / (2 * w);
        for (let j = pos + 1; j < si.length; j++) {
          const d = of[j] - base, v = si[j];
          if (t + d > T) break;
          if (d > minR[v] + rideSlack(minR[v])) continue;
          if (gm[v] !== gs) { gm[v] = gs; best[v] = f; touched[nt++] = v; } else if (f > best[v]) best[v] = f;
        }
      }
      // 3) przejazd: czekanie na pierwszy z tych pojazdów (dla linii spoza zestawu własne) + jazda tym kursem
      for (let b = b0; b < b1; b++) {
        const ti = bT[b], pos = bP[b], si = tsi[ti], of = tof[ti], base = of[pos], w = trips[ti].waitP[pos];
        if (w === Infinity) continue;
        for (let j = pos + 1; j < si.length; j++) {
          const d = of[j] - base, v = si[j];
          if (t + d > T) break;
          curWait = d <= minR[v] + rideSlack(minR[v]) && acc[v] > 0 ? Math.min(w, Math.max(1 / (2 * acc[v]), 1)) : w;
          relax(M + N + v, t + curWait + d, x, 3, ti, pos, j);
        }
      }
    }
  }
  if (NL === 1) return { time, prev, kind, via, rFrom, rTo, rWait };
  // spłaszczenie: dla każdego wierzchołka lepsza z dwóch warstw
  const L = { time, prev, kind, via, rFrom, rTo, rWait };
  const ct = new Float64Array(M), cp = new Int32Array(M), ck = new Int8Array(M), cv = new Int32Array(M);
  const cf = new Int16Array(M), cto = new Int16Array(M), cw = new Float32Array(M), lay = new Uint8Array(M);
  for (let v = 0; v < M; v++) {
    const y = time[M + v] < time[v] ? M + v : v;
    lay[v] = y >= M ? 1 : 0;
    ct[v] = time[y]; const p = prev[y]; cp[v] = p < 0 ? -1 : p >= M ? p - M : p;
    ck[v] = kind[y]; cv[v] = via[y]; cf[v] = rFrom[y]; cto[v] = rTo[y]; cw[v] = rWait[y];
  }
  return { time: ct, prev: cp, kind: ck, via: cv, rFrom: cf, rTo: cto, rWait: cw, L, lay, M };
}
// dojście z zaznaczonego punktu: walk1 (ulicami) + czasy dojścia do przystanków w okręgu
export function originWalk(o, T) {
  const W = WALK, SI = STOP_INDEX();
  const nn = nearestNode(o.lat, o.lon);
  const t0 = nn ? nn.d / WALK_SPEED : 0;
  // samo chodzenie liczymy do 40 min (~3 km) — dalej i tak wygrywa przejazd, a to skraca tryb czasu o ~1/4
  const walk1 = nn ? walkDijkstra([{ v: nn.node, t: t0 }], Math.min(T, 40), { walkOnly: true }) : null;
  const tw = new Map();
  o.poles.forEach(p => {
    const k = SI.get(p.id), sn = W.snapNode[k];
    let t = null;
    if (walk1 && sn >= 0) { if (isFinite(walk1.time[sn])) t = walk1.time[sn] + W.snapLen[k] / WALK_SPEED; }
    else t = p.t0 * 1.3;
    p.tw = t;
    if (t != null && t <= T) tw.set(k, t);
  });
  return { walk1, tw, areaMax: Infinity };   // chodzenie z punktu bez limitu okręgu (tylko limit czasu)
}
export function mergeWalkArea(res, ow) {
  const N = WALK.N, w1 = ow.walk1;
  if (!w1) return;
  for (let v = 0; v < N; v++) if (w1.time[v] <= ow.areaMax && w1.time[v] < res.time[v]) {
    res.time[v] = w1.time[v]; res.prev[v] = w1.prev[v]; res.kind[v] = w1.kind[v]; res.via[v] = w1.via[v];
  }
}
export function runIsoWalk(o, T) {
  const W = WALK, N = W.N, SI = STOP_INDEX();
  let res, walk1 = null;
  const originStops = new Set(o.poles.map(p => p.id));
  if (o.point) {
    // jeden Dijkstra od ulicy najbliższej kliknięciu: chodzenie i przejazdy naraz, bez limitu okręgu
    const nn = nearestNode(o.lat, o.lon);
    if (nn) res = walkDijkstra([{ v: nn.node, t: nn.d / WALK_SPEED }], T);
    else {   // kliknięcie z dala od sieci ulic: start z przystanków w pobliżu (linia prosta × 1,3)
      const seeds = o.poles.filter(p => p.t0 * 1.3 <= T).map(p => ({ v: N + SI.get(p.id), t: p.t0 * 1.3 }));
      res = walkDijkstra(seeds, T);
    }
  } else {
    res = walkDijkstra(o.poles.map(p => ({ v: N + SI.get(p.id), t: 0 })), T);
  }
  // etykiety przystanków w formacie wspólnym z trybem przybliżonym
  const labels = new Map();
  STOPS.forEach((st, k) => {
    const t = res.time[N + k];
    if (t <= T) labels.set(st.id, { t, origin: originStops.has(st.id) && res.prev[N + k] < 0 });
  });
  return { labels, res, walk1 };
}
// kolejne etapy dojazdu do przystanku (tryb ulic): piesze z geometrią ulic + przejazdy
export function walkLegs(stopId, C = state.iso) { return walkLegsFrom(WALK.N + STOP_INDEX().get(stopId), C); }
// Etapy dojazdu do wierzchołka v (węzeł ulicy albo przystanek): przejścia piesze z geometrią
// ulic i czasem, przejazdy. W trybie punktu doklejamy dojście z klikniętego miejsca.
// C = kontekst obliczenia: `iso` (mapa zasięgu) albo `reach` (dojazdy do celów), oba {o, res, walk1, csa}.
function walkLegsFrom(v0, C = state.iso) {
  const W = WALK, N = W.N, r0 = C.res;
  // wynik dwuwarstwowy (typowy dzień): idziemy po warstwach, `id` zdejmuje numer warstwy
  const LM = r0.L ? r0.M : 0, r = r0.L || r0;
  const id = x => (LM && x >= LM ? x - LM : x);
  const P0 = x => x < N ? [W.nodes[2 * x] / 1e6, W.nodes[2 * x + 1] / 1e6] : [STOPS[x - N].lat, STOPS[x - N].lon];
  const P = x => P0(id(x));
  const legs = [];
  let walkPts = null, walkEnd = 0;
  const addWalk = (seg, tEnd) => {
    if (!walkPts) { walkPts = seg; walkEnd = tEnd; } else walkPts = seg.concat(walkPts.slice(1));
  };
  const flush = tStart => {
    if (walkPts) { legs.unshift({ walk: true, pts: walkPts, min: walkEnd - tStart }); walkPts = null; }
  };
  let v = v0 + (r0.L && r0.lay[v0] ? LM : 0), R = r, guard = 0;
  while (guard++ < 50000) {
    const u = R.prev[v];
    if (u < 0) {
      if (C.csa && id(v) >= N && R === r) {
        flush(R.time[v]);
        legs.unshift(...csaLegs(id(v) - N, C));
        return legs;
      }
      if (C.o.point) {
        // przystanek startowy: dojście ulicami z punktu (walk1), potem linia prosta do kliknięcia
        if (id(v) >= N && R === r && C.walk1) {
          const sn = W.snapNode[id(v) - N];
          if (sn >= 0 && isFinite(C.walk1.time[sn])) { addWalk([P(sn), P(v)], R.time[v]); R = C.walk1; v = sn; continue; }
        }
        addWalk([[C.o.lat, C.o.lon], P(v)], R.time[v]);
        flush(0);
      } else {
        flush(R.time[v]);
      }
      break;
    }
    const k = R.kind[v];
    if (k === 3) {
      flush(R.time[v]);
      legs.unshift({ ti: R.via[v], from: R.rFrom[v], to: R.rTo[v], wait: R.rWait ? R.rWait[v] : null });
    } else if (k === 1) {
      const e = R.via[v];
      addWalk(edgePoints(e, W.ends[2 * e] !== id(u)), R.time[v]);
    } else {
      addWalk([P(u), P(v)], R.time[v]);
    }
    v = u;
  }
  flush(0);
  return legs;
}
// ścieżka pieszo po ulicach między przystankami (do rysowania przesiadki)
const streetPathCache = new Map();
export function streetPath(ka, kb) {
  const key = ka + '>' + kb;
  if (streetPathCache.has(key)) return streetPathCache.get(key);
  const W = WALK, a = W.snapNode[ka], b = W.snapNode[kb];
  let pts = [[STOPS[ka].lat, STOPS[ka].lon], [STOPS[kb].lat, STOPS[kb].lon]];
  if (a >= 0 && b >= 0) {
    const r = walkDijkstra([{ v: a, t: 0 }], 12, { walkOnly: true });
    if (isFinite(r.time[b])) pts = [[STOPS[ka].lat, STOPS[ka].lon], ...chainPts(r, b), [STOPS[kb].lat, STOPS[kb].lon]];
  }
  streetPathCache.set(key, pts);
  return pts;
}
export function chainPts(R, v) {
  const W = WALK, N = W.N;
  const P = x => x < N ? [W.nodes[2 * x] / 1e6, W.nodes[2 * x + 1] / 1e6] : [STOPS[x - N].lat, STOPS[x - N].lon];
  let pts = [P(v)], g = 0;
  while (R.prev[v] >= 0 && g++ < 50000) {
    const u = R.prev[v];
    const seg = R.kind[v] === 1 ? edgePoints(R.via[v], W.ends[2 * R.via[v]] !== u) : [P(u), P(v)];
    pts = seg.concat(pts.slice(1));
    v = u;
  }
  return pts;
}
// najszybciej osiągalny węzeł w promieniu R: czas dojścia do węzła + dojście od niego do punktu
function bestReachableNode(lat, lon, R, t = state.iso.res.time) {
  const W = WALK, cy = Math.floor(lat / W.GC), cx = Math.floor(lon / W.GC);
  let best = null;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const list = W.grid.get((cy + dy) + ',' + (cx + dx));
    if (!list) continue;
    for (const i of list) {
      if (!isFinite(t[i])) continue;
      const d = haversineMeters(lat, lon, W.nodes[2 * i] / 1e6, W.nodes[2 * i + 1] / 1e6);
      if (d > R) continue;
      const tt = t[i] + d / WALK_SPEED;
      if (!best || tt < best.t) best = { node: i, d, t: tt };
    }
  }
  return best;
}
// Trasa z miejsca startu kontekstu C do dowolnego punktu: czas, etapy (z dojściem do samego punktu), linie
export function routeTo(C, lat, lon, R = 200) {
  if (!C || !C.walk || !C.res) return null;
  const nn = bestReachableNode(lat, lon, R, C.res.time);
  if (!nn) return { t: Infinity };
  const legs = walkLegsFrom(nn.node, C);
  if (nn.d > 3) {   // ostatnie metry do punktu doliczamy do ostatniego przejścia
    const end = [lat, lon], last = legs[legs.length - 1];
    if (last && last.walk && last.pts) { last.pts = last.pts.concat([end]); last.min += nn.d / WALK_SPEED; }
    else legs.push({ walk: true, pts: [[WALK.nodes[2 * nn.node] / 1e6, WALK.nodes[2 * nn.node + 1] / 1e6], end], min: nn.d / WALK_SPEED });
  }
  const lines = [];
  legs.forEach(l => {
    if (l.walk) return;
    const key = l.ride ? csaRideInfo(l, C).key : isoGraph.trips[l.ti].key;
    const [ref, type] = key.split('|');
    lines.push({ ref, type });
  });
  const walkMin = legs.filter(l => l.walk).reduce((a, l) => a + (l.min || 0), 0);
  return { t: nn.t, legs, lines, rides: lines.length, walkMin };
}
