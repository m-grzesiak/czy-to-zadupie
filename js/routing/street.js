import { WALK_SPEED } from '../config.js';
import { STOPS, STOP_INDEX } from '../data.js';
import { WALK, bestReachableNode, edgePointsFrom, nearestNode, nodeLatLng, stopLatLng, vertexLatLng } from '../walk.js';
import { TypedHeap } from './heap.js';
import { rideSlack, transitGraph, tripIndex } from './transit.js';
import { csaLegs, csaRideInfo } from './csa.js';

// Dijkstra po węzłach ulic (0..N-1) i przystankach (N..N+S-1).
// Z przejazdami liczy się na dwóch warstwach: 0 = jeszcze bez przejazdu, 1 = po pierwszym przejeździe.
// Pierwsze wsiadanie jest bez czekania (z domu wychodzi się na konkretny odjazd), na przesiadkach
// czeka się średnio (połowa odstępu, wspólne linie). Wynik: tablice dla lepszej warstwy (time, prev…)
// i pełne warstwy w `L` (ścieżki w walkLegsFrom).
export function walkDijkstra(seeds, T, opts = {}) {
  const N = WALK.N, S = STOPS.length, M = N + S;
  const { adjStart, adjE, ends, len, nsStart, nsStop, snapNode, snapLen } = WALK;
  const { trips, tline, bStart, bT, bP, tsi, tof } = tripIndex();
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
  const minR = new Float64Array(S), acc = new Float64Array(S), best = new Float64Array(S);
  const vm = new Int32Array(S), gm = new Int32Array(S), touched = new Int32Array(S);
  let vs = 0, gs = 0;
  seeds.forEach(sd => { relax(sd.v, sd.t, -1, 0, 0); if (sd.noWalk) noWalk[sd.v] = 1; });
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
  const L = { time, prev, kind, via, rFrom, rTo, rWait };
  if (NL === 1) return L;
  // spłaszczenie: dla każdego wierzchołka lepsza z dwóch warstw
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
// wierzchołek przystanku o danym id
export const stopVertex = id => WALK.N + STOP_INDEX().get(id);
// start z punktu: najbliższy węzeł ulicy z czasem dojścia do niego (null = daleko od sieci ulic)
export function pointSeeds(lat, lon) {
  const nn = nearestNode(lat, lon);
  return nn ? [{ v: nn.node, t: nn.d / WALK_SPEED }] : null;
}
// węzeł ulicy przy przystanku k, jeśli wynik samego chodzenia r do niego doszedł, inaczej -1
export function reachedSnap(r, k) {
  const sn = WALK.snapNode[k];
  return r && sn >= 0 && isFinite(r.time[sn]) ? sn : -1;
}
// etykiety przystanków osiągniętych w T (format wspólny z trybem przybliżonym);
// origin = przystanek startowy (isStart(k, stop)), do którego nie trzeba było dojść
export function stopLabels(res, T, isStart) {
  const N = WALK.N, labels = new Map();
  STOPS.forEach((st, k) => {
    const t = res.time[N + k];
    if (t <= T) labels.set(st.id, { t, origin: res.prev[N + k] < 0 && isStart(k, st) });
  });
  return labels;
}
// dojście z zaznaczonego punktu: walk1 (ulicami) + czasy dojścia do przystanków w okręgu (tw, też p.tw)
export function originWalk(o, T) {
  const W = WALK, SI = STOP_INDEX(), seeds = pointSeeds(o.lat, o.lon);
  // samo chodzenie liczymy do 40 min (~3 km) — dalej i tak wygrywa przejazd, a to skraca tryb czasu o ~1/4
  const walk1 = seeds ? walkDijkstra(seeds, Math.min(T, 40), { walkOnly: true }) : null;
  const tw = new Map();
  o.poles.forEach(p => {
    const k = SI.get(p.id), sn = W.snapNode[k];
    // bez sieci ulic przy przystanku: linia prosta × 1,3; przystanek, do którego nie da się dojść: null
    const t = !walk1 || sn < 0 ? p.t0 * 1.3
      : isFinite(walk1.time[sn]) ? walk1.time[sn] + W.snapLen[k] / WALK_SPEED : null;
    p.tw = t;
    if (t != null && t <= T) tw.set(k, t);
  });
  return { walk1, tw };
}
// obszar dojścia pieszo z punktu (chodzenie bez limitu okręgu, tylko limit czasu) dołożony do wyniku res
export function mergeWalkArea(res, ow) {
  const N = WALK.N, w1 = ow.walk1;
  if (!w1) return;
  for (let v = 0; v < N; v++) if (w1.time[v] < res.time[v]) {
    res.time[v] = w1.time[v]; res.prev[v] = w1.prev[v]; res.kind[v] = w1.kind[v]; res.via[v] = w1.via[v];
  }
}
// Zasięg typowego dnia po ulicach. Z punktu: jeden Dijkstra od ulicy najbliższej kliknięciu (chodzenie
// i przejazdy naraz, bez limitu okręgu); z dala od sieci ulic start z przystanków w pobliżu (linia prosta × 1,3).
export function runIsoWalk(o, T) {
  const fromPoles = f => o.poles.filter(p => f(p) <= T).map(p => ({ v: stopVertex(p.id), t: f(p) }));
  const seeds = !o.point ? fromPoles(() => 0) : pointSeeds(o.lat, o.lon) || fromPoles(p => p.t0 * 1.3);
  const res = walkDijkstra(seeds, T);
  const originStops = new Set(o.poles.map(p => p.id));
  return { labels: stopLabels(res, T, (k, st) => originStops.has(st.id)), res, walk1: null };
}
// kolejne etapy dojazdu do przystanku (tryb ulic): piesze z geometrią ulic + przejazdy
export function walkLegs(stopId, C) { return walkLegsFrom(stopVertex(stopId), C); }
// Etapy dojazdu do wierzchołka v (węzeł ulicy albo przystanek): przejścia piesze z geometrią
// ulic i czasem, przejazdy. W trybie punktu doklejamy dojście z klikniętego miejsca.
// C = kontekst obliczenia: `iso` (mapa zasięgu) albo `reach` (dojazdy do celów), oba {o, res, walk1, csa}.
function walkLegsFrom(v0, C) {
  const N = WALK.N, r0 = C.res;
  // wynik dwuwarstwowy (typowy dzień): idziemy po warstwach, `id` zdejmuje numer warstwy
  const LM = r0.L ? r0.M : 0, r = r0.L || r0;
  const id = x => (LM && x >= LM ? x - LM : x);
  const P = x => vertexLatLng(id(x));
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
      const atStop = id(v) >= N && R === r;
      if (C.csa && atStop) {
        flush(R.time[v]);
        legs.unshift(...csaLegs(id(v) - N, C));
        return legs;
      }
      if (C.o.point) {
        // przystanek startowy: dojście ulicami z punktu (walk1), potem linia prosta do kliknięcia
        const sn = atStop ? reachedSnap(C.walk1, id(v) - N) : -1;
        if (sn >= 0) { addWalk([P(sn), P(v)], R.time[v]); R = C.walk1; v = sn; continue; }
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
      legs.unshift({ ti: R.via[v], from: R.rFrom[v], to: R.rTo[v], wait: R.rWait[v] });
    } else if (k === 1) {
      addWalk(edgePointsFrom(R.via[v], id(u)), R.time[v]);
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
  const a = WALK.snapNode[ka], b = WALK.snapNode[kb];
  let pts = [stopLatLng(ka), stopLatLng(kb)];
  if (a >= 0 && b >= 0) {
    const r = walkDijkstra([{ v: a, t: 0 }], 12, { walkOnly: true });
    if (isFinite(r.time[b])) pts = [stopLatLng(ka), ...chainPts(r, b), stopLatLng(kb)];
  }
  streetPathCache.set(key, pts);
  return pts;
}
// punkty ścieżki do wierzchołka v z wyniku jednowarstwowego R (np. samo chodzenie)
export function chainPts(R, v) {
  let pts = [vertexLatLng(v)], g = 0;
  while (R.prev[v] >= 0 && g++ < 50000) {
    const u = R.prev[v];
    const seg = R.kind[v] === 1 ? edgePointsFrom(R.via[v], u) : [vertexLatLng(u), vertexLatLng(v)];
    pts = seg.concat(pts.slice(1));
    v = u;
  }
  return pts;
}
// Trasa z miejsca startu kontekstu C do dowolnego punktu: czas, etapy (z dojściem do samego punktu), linie
export function routeTo(C, lat, lon, R = 200) {
  if (!C || !C.walk || !C.res) return null;
  const nn = bestReachableNode(lat, lon, R, C.res.time);
  if (!nn) return { t: Infinity };
  const legs = walkLegsFrom(nn.node, C);
  if (nn.d > 3) {   // ostatnie metry do punktu doliczamy do ostatniego przejścia
    const end = [lat, lon], last = legs[legs.length - 1], min = nn.d / WALK_SPEED;
    if (last && last.walk && last.pts) { last.pts = last.pts.concat([end]); last.min += min; }
    else legs.push({ walk: true, pts: [nodeLatLng(nn.node), end], min });
  }
  const lines = legs.filter(l => !l.walk).map(l => {
    const [ref, type] = (l.ride ? csaRideInfo(l, C).key : transitGraph().trips[l.ti].key).split('|');
    return { ref, type };
  });
  const walkMin = legs.filter(l => l.walk).reduce((a, l) => a + (l.min || 0), 0);
  return { t: nn.t, legs, lines, rides: lines.length, walkMin };
}
