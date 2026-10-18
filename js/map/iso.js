import { state } from '../state.js';
import { fmt, przesiadki } from '../util.js';
import { ISO_RAMP, WALK_MAX, WALK_MPM, WALK_SPEED } from '../config.js';
import { ROUTES, STOP_BY_ID, routeColor } from '../data.js';
import { WALK, cutPoints, edgeIndex, edgePoints } from '../walk.js';
import { transitGraph } from '../routing/transit.js';
import { routeTo } from '../routing/street.js';
import { csaRideInfo } from '../routing/csa.js';
import { cardPlacement, dropLayer, fitPad, hoverMarker, htmlIcon, map, viewBounds } from './view.js';
import { routeLine } from './route.js';
import { stopHoverOn } from './stops.js';
import { isoLegs, legsText } from '../iso.js';
import { targetPop } from '../ui/target.js';

const HOVER_SNAP_M = 150;    // hover anywhere: at most this far from a reached street
const TARGET_POP_PX = 90;    // no hover card this close to an open target popup
// walking leg: white outline + dots
const WALK_STYLES = [
  { color: '#fff', weight: 7, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false },
  { color: '#1c1c1a', weight: 3.5, dashArray: '0.1 7', lineCap: 'round', interactive: false },
];

export let isoLayer = null;
let isoRenderer = null;
let isoPathLayer = null;

// ---------------------------------------------------------------------------
// Reach area along streets, drawn as tiles (GridLayer)
// ---------------------------------------------------------------------------
// Web Mercator <-> world pixels of size s (at zoom z: s = 256 · 2^z)
const mercX = (lon, s) => (lon + 180) / 360 * s;
const mercY = (lat, s) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * s; };
const mercLon = (x, s) => x / s * 360 - 180;
const mercLat = (y, s) => 90 - 360 * Math.atan(Math.exp((y / s * 2 - 1) * Math.PI)) / Math.PI;
// stroke width: about 110 m on the ground, 4–34 px
function streetPx(lat, z) {
  const mpp = 156543.03 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z);
  return Math.max(4, Math.min(34, 110 / mpp));
}
// draws the reach area on one tile: only streets in this fragment, one stroke per band
function drawIsoTile(canvas, coords, size) {
  if (!state.iso || !state.iso.walk) return;
  const W = WALK, t = state.iso.res.time, bands = state.iso.bands, T = state.iso.T;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr; canvas.height = size * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const z = coords.z, S = 256 * Math.pow(2, z), ox = coords.x * size, oy = coords.y * size;
  const wpx = streetPx(mercLat(oy + size / 2, S), z), pad = wpx;
  // tile extent in degrees (+ margin for line width)
  const lon0 = mercLon(ox - pad, S), lon1 = mercLon(ox + size + pad, S);
  const lat1 = mercLat(oy - pad, S), lat0 = mercLat(oy + size + pad, S);
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
          // how many meters of street can be walked from each end within the band time
          const ra = ta < hi ? (hi - ta) * WALK_SPEED : 0, rz = tz < hi ? (hi - tz) * WALK_SPEED : 0;
          if (ra <= 1 && rz <= 1) continue;
          // whole street in this band: farther bands get covered anyway (nearer ones painted on top)
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
    drawIsoTile(tile, coords, this.getTileSize().x);
    return tile;
  },
});
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

// ---------------------------------------------------------------------------
// Reach area view
// ---------------------------------------------------------------------------
// Reach area rectangle: street nodes reachable within T (without the walk network — stops) and the origin.
function isoBounds() {
  const { o, T } = state.iso;
  let s = o.lat, n = o.lat, w = o.lon, e = o.lon;
  const add = (la, lo) => { if (la < s) s = la; if (la > n) n = la; if (lo < w) w = lo; if (lo > e) e = lo; };
  if (state.iso.walk && WALK && state.iso.res && state.iso.res.time) {
    const t = state.iso.res.time, nd = WALK.nodes;
    for (let i = 0; i < WALK.N; i++) if (t[i] <= T) add(nd[2 * i] / 1e6, nd[2 * i + 1] / 1e6);
  } else {
    state.iso.labels.forEach((l, id) => { if (l.t <= T) { const st = STOP_BY_ID.get(id); add(st.lat, st.lon); } });
  }
  return L.latLngBounds([s, w], [n, e]);
}
// Reach area view: just the area with minimal padding (zooms in and out), in the visible part of the map.
// Fractional zoom (steps of 0.05), so the area fills the view rather than half of it; the + − buttons go back to whole levels.
// onlyOut: only zoom out when the area does not fit (not used on time change or when enabling).
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

// ---------------------------------------------------------------------------
// Area layers
// ---------------------------------------------------------------------------
function removeIsoLayer() { isoLayer = dropLayer(isoLayer); }
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
  if (state.iso.walk) {
    isoLayer = new IsoTiles({ pane: 'iso', updateWhenZooming: false, keepBuffer: 4, tileSize: 256 }).addTo(map);
    return;
  }
  // without the walk network: circles around the origin and reached stops (straight line)
  const { o } = state.iso;
  const disc = (lat, lon, radius, color) => L.circle([lat, lon], {
    renderer: isoRenderer, radius, stroke: false, fillColor: color, fillOpacity: 1, interactive: false,
  });
  const circles = [];
  // from the farthest band to the nearest: nearer ones painted on top
  [...state.iso.bands].reverse().forEach(b => {
    if (o.point) circles.push(disc(o.lat, o.lon, Math.min(b.hi * WALK_MPM, o.walkMax), b.color));
    state.iso.labels.forEach((lab, id) => {
      if (lab.t >= b.hi) return;   // bands end at iso.T
      const r = Math.min((b.hi - lab.t) * WALK_MPM, WALK_MAX);
      if (r < 25) return;
      const st = STOP_BY_ID.get(id);
      circles.push(disc(st.lat, st.lon, r, b.color));
    });
  });
  isoLayer = L.layerGroup(circles).addTo(map);
}

// ---------------------------------------------------------------------------
// Route to a place: rides in line colors, walks dotted
// ---------------------------------------------------------------------------
// when hovering a reached stop: draw how to get there
export function drawIsoPath(id) { drawLegs(isoLegs(id), null, state.iso); }
export function clearIsoPath() { isoPathLayer = dropLayer(isoPathLayer); }
export function drawLegs(legs, tail, C) {
  clearIsoPath();
  const parts = legLayers(legs, tail, C);
  if (parts.length) isoPathLayer = L.layerGroup(parts).addTo(map);
}
// ride: white outline, line in the line color and stop circles
function rideLayers(pts, color) {
  return [
    routeLine(pts, { color: '#fff', weight: 9, opacity: 0.9 }),
    routeLine(pts, { color, weight: 5 }),
    ...pts.map(p => L.circleMarker(p, { radius: 3, weight: 2, color, fillColor: '#fff', fillOpacity: 1, interactive: false })),
  ];
}
const stopLL = id => { const x = STOP_BY_ID.get(id); return x && [x.lat, x.lon]; };
// route layers: rides in line colors, dotted walking legs on top
export function legLayers(legs, tail, C) {
  const parts = [];
  if (tail) legs = legs.concat([{ walk: true, pts: tail }]);
  const walks = [];
  legs.forEach(l => {
    if (l.walk) {
      if (l.pts) walks.push(l.pts);
      else {   // transfer without geometry: straight line between stops
        const a = stopLL(l.prev), z = stopLL(l.at);
        if (a && z) walks.push([a, z]);
      }
    } else if (l.ride) {   // ride from Connection Scan ("depart at time" mode)
      const { key } = csaRideInfo(l, C);
      parts.push(...rideLayers(l.pts, routeColor(ROUTES[key] || { type: key.split('|')[1] })));
    } else {               // typical day ride: trip segment from the graph
      const tr = transitGraph().trips[l.ti];
      parts.push(...rideLayers(tr.s.slice(l.from, l.to + 1).map(([sid]) => stopLL(sid)), routeColor(ROUTES[tr.key])));
    }
  });
  walks.forEach(pts => WALK_STYLES.forEach(st => parts.push(L.polyline(pts, st))));
  return parts;
}

// ---------------------------------------------------------------------------
// Hover anywhere on the map with a reach area: time, route and card
// ---------------------------------------------------------------------------
let pointHoverLayer = null;
let pointRaf = 0;
// with the target popup open, a hover card at the same spot would only duplicate it
function nearTargetPop(ll) {
  return state.target && targetPop && targetPop.isOpen()
    && map.latLngToContainerPoint([state.target.lat, state.target.lon]).distanceTo(map.latLngToContainerPoint(ll)) < TARGET_POP_PX;
}
function pointCardHtml(ll, r) {
  const { t, rides } = r, csa = state.iso.csa;
  const head = `<b>${Math.max(1, Math.round(t))} min</b> stąd`
    + (csa ? ` · na miejscu ${fmt(Math.round(csa.t0 + t))}` : '')
    + (rides > 1 ? ` · ${przesiadki(rides - 1)}` : '');
  return `<div class="sh${cardPlacement(ll)}" style="--sh-c:#184f95"><div class="sh-dot" style="width:10px;height:10px"></div>
    <div class="sh-tip sh-tip-pt wide"><div class="sh-iso" style="margin:0;padding:0;border:0">${head}</div>
    <div class="sh-legs">${legsText(r.legs, state.iso)}</div></div></div>`;
}
function pointHover(ll) {
  if (!state.iso || !state.iso.walk || stopHoverOn || nearTargetPop(ll)) return hidePointHover();
  const r = routeTo(state.iso, ll.lat, ll.lng, HOVER_SNAP_M);
  if (!r || !(r.t <= state.iso.T)) return hidePointHover();
  drawLegs(r.legs, null, state.iso);
  const icon = htmlIcon(pointCardHtml(ll, r));
  if (pointHoverLayer) pointHoverLayer.setLatLng(ll).setIcon(icon);
  else pointHoverLayer = hoverMarker(ll, icon).addTo(map);
}
export function removePointHover() { pointHoverLayer = dropLayer(pointHoverLayer); }
export function hidePointHover() {
  removePointHover();
  if (!stopHoverOn) clearIsoPath();
}
// hover anywhere on the map (reach area): at most once per frame
export function schedulePointHover(ll) {
  cancelAnimationFrame(pointRaf);
  pointRaf = requestAnimationFrame(() => pointHover(ll));
}
export function cancelPointHover() {
  cancelAnimationFrame(pointRaf);
  hidePointHover();
}
