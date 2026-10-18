import { state } from '../state.js';
import { fmt } from '../util.js';
import { ISO_RAMP, WALK_MAX, WALK_MPM, WALK_SPEED } from '../config.js';
import { ROUTES, STOP_BY_ID, routeColor } from '../data.js';
import { WALK, cutPoints, edgeIndex, edgePoints } from '../walk.js';
import { isoGraph } from '../routing/transit.js';
import { routeTo } from '../routing/street.js';
import { csaRideInfo } from '../routing/csa.js';
import { fitPad, map, viewBounds } from './view.js';
import { stopHoverOn } from './stops.js';
import { isoLegs, legsText } from '../iso.js';
import { targetPop } from '../ui/target.js';

export let isoLayer = null;
let isoRenderer = null;
let isoPathLayer = null;
// Web Mercator -> piksele świata przy danym zoomie
const mercX = (lon, s) => (lon + 180) / 360 * s;
const mercY = (lat, s) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * s; };
// rysuje zasięg na jednym kafelku: tylko ulice z tego fragmentu, jedno pociągnięcie na pasmo
function drawIsoTile(canvas, coords, size) {
  if (!state.iso || !state.iso.walk) return;
  const W = WALK, t = state.iso.res.time, bands = state.iso.bands, T = state.iso.T;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr; canvas.height = size * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const z = coords.z, S = 256 * Math.pow(2, z), ox = coords.x * size, oy = coords.y * size;
  const latC = 90 - 360 * Math.atan(Math.exp(((oy + size / 2) / S * 2 - 1) * Math.PI)) / Math.PI;
  const mpp = 156543.03 * Math.cos(latC * Math.PI / 180) / Math.pow(2, z);
  const wpx = Math.max(4, Math.min(34, 110 / mpp)), pad = wpx;
  // zasięg kafelka w stopniach (+ margines na grubość linii)
  const lon0 = (ox - pad) / S * 360 - 180, lon1 = (ox + size + pad) / S * 360 - 180;
  const toLat = y => 90 - 360 * Math.atan(Math.exp((y / S * 2 - 1) * Math.PI)) / Math.PI;
  const lat1 = toLat(oy - pad), lat0 = toLat(oy + size + pad);
  const idx = edgeIndex(), C = idx.C, gen = ++idx.gen;
  const paths = bands.map(() => new Path2D());
  const P = (lat, lon) => [mercX(lon, S) - ox, mercY(lat, S) - oy];
  const line = (path, pts) => {
    let p = P(pts[0][0], pts[0][1]); path.moveTo(p[0], p[1]);
    for (let i = 1; i < pts.length; i++) { p = P(pts[i][0], pts[i][1]); path.lineTo(p[0], p[1]); }
  };
  for (let y = Math.floor(lat0 / C); y <= Math.floor(lat1 / C); y++) {
    for (let x = Math.floor(lon0 / C); x <= Math.floor(lon1 / C); x++) {
      const list = idx.cells.get(y * 100000 + x);
      if (!list) continue;
      for (let n = 0; n < list.length; n++) {
        const e = list[n];
        if (idx.stamp[e] === gen) continue;
        idx.stamp[e] = gen;
        const a = W.ends[2 * e], zz = W.ends[2 * e + 1], ta = t[a], tz = t[zz];
        if (!(ta < T) && !(tz < T)) continue;
        const L = W.len[e];
        let full = null;
        for (let bi = 0; bi < bands.length; bi++) {
          const hi = bands[bi].hi;
          const ra = ta < hi ? (hi - ta) * WALK_SPEED : 0, rz = tz < hi ? (hi - tz) * WALK_SPEED : 0;
          if (ra <= 1 && rz <= 1) continue;
          // cała ulica w tym paśmie: dalsze pasma i tak zasłoni (bliższe malowane na wierzchu)
          if (ra + rz >= L) { line(paths[bi], full || (full = edgePoints(e, false))); break; }
          if (ra > 1) line(paths[bi], cutPoints(edgePoints(e, false), ra / L));
          if (rz > 1) line(paths[bi], cutPoints(edgePoints(e, true), rz / L));
        }
      }
    }
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = wpx;
  for (let bi = bands.length - 1; bi >= 0; bi--) { ctx.strokeStyle = bands[bi].color; ctx.stroke(paths[bi]); }
}
const IsoTiles = L.GridLayer.extend({
  createTile(coords) {
    const tile = document.createElement('canvas');
    const size = this.getTileSize().x;
    drawIsoTile(tile, coords, size);
    return tile;
  },
});
function drawIsoWalk() {
  isoLayer = new IsoTiles({ pane: 'iso', updateWhenZooming: false, keepBuffer: 4, tileSize: 256 }).addTo(map);
}
export function isoBands(T) {
  const w = [5, 10, 15, 20].find(x => Math.ceil(T / x) <= ISO_RAMP.length) || 20;
  const n = Math.ceil(T / w);
  const bands = [];
  for (let i = 0; i < n; i++) {
    const idx = n === 1 ? 0 : Math.round(i * (ISO_RAMP.length - 1) / (n - 1));
    bands.push({ lo: i * w, hi: Math.min((i + 1) * w, T), color: ISO_RAMP[idx] });
  }
  return bands;
}
// Gdy obszar zasięgu wychodzi poza widok — oddal/przesuń mapę (nigdy nie przybliżaj).
// Prostokąt obszaru zasięgu: węzły ulic osiągalne w T (bez sieci pieszej — przystanki) i start.
function isoBounds() {
  let s = state.iso.o.lat, n = state.iso.o.lat, w = state.iso.o.lon, e = state.iso.o.lon;
  const add = (la, lo) => { if (la < s) s = la; if (la > n) n = la; if (lo < w) w = lo; if (lo > e) e = lo; };
  if (state.iso.walk && WALK && state.iso.res && state.iso.res.time) {
    const t = state.iso.res.time, nd = WALK.nodes, T = state.iso.T;
    for (let i = 0; i < WALK.N; i++) if (t[i] <= T) add(nd[2 * i] / 1e6, nd[2 * i + 1] / 1e6);
  } else {
    state.iso.labels.forEach((l, id) => { if (l.t <= state.iso.T) { const st = STOP_BY_ID.get(id); add(st.lat, st.lon); } });
  }
  return L.latLngBounds([s, w], [n, e]);
}
// Widok zasięgu: sam obszar z minimalnym marginesem (przybliża i oddala), w widocznej części mapy.
// Przybliżenie ułamkowe (co 0,05), żeby obszar wypełniał widok, a nie jego połowę; przyciski + − wracają do pełnych.
// onlyOut: tylko oddal, gdy obszar się nie mieści (nie używane przy zmianie czasu ani włączeniu).
export function fitIsoView(onlyOut = false) {
  if (!state.iso) return;
  const b = isoBounds();
  if (!b.isValid()) return;
  if (onlyOut && viewBounds().contains(b)) return;
  const snap = map.options.zoomSnap;
  map.options.zoomSnap = 0.05;
  map.fitBounds(b, { ...fitPad(6), maxZoom: onlyOut ? map.getZoom() : 16 });
  map.options.zoomSnap = snap;
}
function removeIsoLayer() {
  if (isoLayer) { map.removeLayer(isoLayer); isoLayer = null; }
}
export function removeIsoLayers() {
  removeIsoLayer();
  clearIsoPath();
}
export function ensureIsoPane() {
  if (map.getPane('iso')) return;
  map.createPane('iso').style.zIndex = 350;
  map.getPane('iso').classList.add('leaflet-iso-pane');
  isoRenderer = L.canvas({ pane: 'iso', padding: 0.5 });
}
export function drawIso() {
  removeIsoLayer();
  if (!state.iso) return;
  if (state.iso.walk) { drawIsoWalk(); return; }
  const circles = [];
  // od najdalszego pasma do najbliższego: bliższe malowane na wierzchu
  [...state.iso.bands].reverse().forEach(b => {
    if (state.iso.o.point) {
      circles.push(L.circle([state.iso.o.lat, state.iso.o.lon], {
        renderer: isoRenderer, radius: Math.min(b.hi * WALK_MPM, state.iso.o.walkMax), stroke: false,
        fillColor: b.color, fillOpacity: 1, interactive: false,
      }));
    }
    state.iso.labels.forEach((lab, id) => {
      if (lab.t >= b.hi) return;   // pasma kończą się na iso.T
      const r = Math.min((b.hi - lab.t) * WALK_MPM, WALK_MAX);
      if (r < 25) return;
      const st = STOP_BY_ID.get(id);
      circles.push(L.circle([st.lat, st.lon], {
        renderer: isoRenderer, radius: r, stroke: false, fillColor: b.color, fillOpacity: 1, interactive: false,
      }));
    });
  });
  isoLayer = L.layerGroup(circles).addTo(map);
}
// po najechaniu na osiągnięty przystanek: narysuj, jak tam dojechać
export function drawIsoPath(id) { drawLegs(isoLegs(id)); }
const walkStyle = [
  { color: '#fff', weight: 7, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false },
  { color: '#1c1c1a', weight: 3.5, dashArray: '0.1 7', lineCap: 'round', interactive: false },
];
export function clearIsoPath() {
  if (isoPathLayer) { map.removeLayer(isoPathLayer); isoPathLayer = null; }
}
export function drawLegs(legs, tail, C = state.iso) {
  clearIsoPath();
  const parts = legLayers(legs, tail, C);
  if (parts.length) isoPathLayer = L.layerGroup(parts).addTo(map);
}
// warstwy trasy: przejazdy w kolorach linii, na wierzchu kropkowane przejścia piesze
export function legLayers(legs, tail, C = state.iso) {
  const parts = [];
  if (tail) legs = legs.concat([{ walk: true, pts: tail }]);
  const walks = [];
  legs.forEach(l => {
    if (l.walk && l.pts) { walks.push(l.pts); return; }
    if (l.ride) {
      const { key } = csaRideInfo(l, C), c = routeColor(ROUTES[key] || { type: key.split('|')[1] });
      parts.push(L.polyline(l.pts, { color: '#fff', weight: 9, opacity: 0.9, lineJoin: 'round', interactive: false }));
      parts.push(L.polyline(l.pts, { color: c, weight: 5, lineJoin: 'round', interactive: false }));
      l.pts.forEach(p => parts.push(L.circleMarker(p, { radius: 3, weight: 2, color: c, fillColor: '#fff', fillOpacity: 1, interactive: false })));
      return;
    }
    const a = STOP_BY_ID.get(l.prev), z = STOP_BY_ID.get(l.at);
    if (l.walk) {
      if (a && z) walks.push([[a.lat, a.lon], [z.lat, z.lon]]);
      return;
    }
    const tr = isoGraph.trips[l.ti];
    const pts = tr.s.slice(l.from, l.to + 1).map(([sid]) => { const x = STOP_BY_ID.get(sid); return [x.lat, x.lon]; });
    const c = routeColor(ROUTES[tr.key]);
    parts.push(L.polyline(pts, { color: '#fff', weight: 9, opacity: 0.9, lineJoin: 'round', interactive: false }));
    parts.push(L.polyline(pts, { color: c, weight: 5, lineJoin: 'round', interactive: false }));
    pts.forEach(p => parts.push(L.circleMarker(p, { radius: 3, weight: 2, color: c, fillColor: '#fff', fillOpacity: 1, interactive: false })));
  });
  walks.forEach(pts => walkStyle.forEach(st => parts.push(L.polyline(pts, st))));
  return parts;
}
let pointHoverLayer = null;
let pointRaf = 0;
function pointHover(ll) {
  if (!state.iso || !state.iso.walk || stopHoverOn) return hidePointHover();
  // przy otwartym dymku celu karta hovera w tym samym miejscu tylko by go dublowała
  if (state.target && targetPop && targetPop.isOpen()
      && map.latLngToContainerPoint([state.target.lat, state.target.lon]).distanceTo(map.latLngToContainerPoint(ll)) < 90) return hidePointHover();
  const r = routeTo(state.iso, ll.lat, ll.lng, 150);
  if (!r || !(r.t <= state.iso.T)) return hidePointHover();
  const t = r.t, legs = r.legs;
  drawLegs(legs);
  const rides = r.rides;
  const cp = map.latLngToContainerPoint(ll), mw = map.getSize().x;
  const below = cp.y < 150, side = cp.x < 150 ? ' al' : cp.x > mw - 150 ? ' ar' : '';
  const html = `<div class="sh${below ? ' below' : ''}${side}" style="--sh-c:#184f95"><div class="sh-dot" style="width:10px;height:10px"></div>
    <div class="sh-tip sh-tip-pt wide"><div class="sh-iso" style="margin:0;padding:0;border:0"><b>${Math.max(1, Math.round(t))} min</b> stąd${state.iso.csa ? ` · na miejscu ${fmt(Math.round(state.iso.csa.t0 + t))}` : ''}${rides > 1 ? ` · ${rides - 1} ${rides - 1 === 1 ? 'przesiadka' : 'przesiadki'}` : ''}</div>
    <div class="sh-legs">${legsText(legs)}</div></div></div>`;
  const icon = L.divIcon({ className: '', iconSize: [0, 0], html });
  if (pointHoverLayer) pointHoverLayer.setLatLng(ll).setIcon(icon);
  else pointHoverLayer = L.marker(ll, { icon, interactive: false, pane: 'hover', keyboard: false }).addTo(map);
}
export function removePointHover() {
  if (pointHoverLayer) { map.removeLayer(pointHoverLayer); pointHoverLayer = null; }
}
export function hidePointHover() {
  removePointHover();
  if (!stopHoverOn) clearIsoPath();
}
// hover w dowolnym miejscu mapy (zasięg): najwyżej raz na klatkę
export function schedulePointHover(ll) {
  cancelAnimationFrame(pointRaf);
  pointRaf = requestAnimationFrame(() => pointHover(ll));
}
export function cancelPointHover() {
  cancelAnimationFrame(pointRaf);
  hidePointHover();
}
