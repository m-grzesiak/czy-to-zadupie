import { state } from '../state.js';
import { esc, haversineMeters } from '../util.js';
import { TYPE_NAME } from '../config.js';
import { routeStatus } from '../dom.js';
import { ROUTES, lineStops, routeColor } from '../data.js';
import { dropLayer, fitPad, map, viewBounds } from './view.js';
import { HL_FILL, showStopHover, stopClicked, stopMouseOut } from './stops.js';

const NEAR_ROUTE_M = 3000;   // route view: only the part of it within this distance from the selected place
const ARROW_STEP_PX = 90;    // on-screen spacing of direction arrows

let routeLayers = [];        // variants of the selected line (polylines, index = state.selectedVariant)
let routeLayerGroup = null;
let routeStopsLayer = null;
export let routeStopMarkers = [];
let arrowLayer = null;
let previewLayer = null;
let previewStopsLayer = null;
let previewKey = null;

// route line on the shared canvas, does not catch clicks (otherwise it covers stops)
export function routeLine(pts, style) {
  return L.polyline(pts, { lineJoin: 'round', interactive: false, ...style });
}
const hasShapes = route => !!(route && route.shapes && route.shapes.length);

export function clearRouteLayers() {
  routeLayerGroup = dropLayer(routeLayerGroup);
  routeStopsLayer = dropLayer(routeStopsLayer);
  arrowLayer = dropLayer(arrowLayer);
  routeStopMarkers = [];
  routeLayers = [];
}

// Route and stop circle thickness depends on zoom: when zoomed out, a thick line and large circles
// merged loops and turnarounds into a single blob.
function routeW() {
  const z = map ? map.getZoom() : 14;
  return z >= 16 ? { sel: 6, oth: 3, st: 4.5, term: 6, sw: 2.5 }
       : z >= 15 ? { sel: 5, oth: 2.5, st: 3.8, term: 5.5, sw: 2.2 }
       : z >= 14 ? { sel: 4, oth: 2, st: 3.2, term: 4.8, sw: 1.8 }
       :           { sel: 3, oth: 1.6, st: 2.4, term: 4, sw: 1.4 };
}
// radius and outline of a line stop circle (terminals larger)
function stopCircleSize(term, W = routeW()) {
  return { radius: term ? W.term : W.st, weight: term ? W.sw + 0.6 : W.sw };
}
// first and last stops of the variants
function terminalIds(route) {
  const ids = new Set();
  (route.trips || []).forEach(t => {
    if (t && t.s.length) { ids.add(t.s[0][0]); ids.add(t.s[t.s.length - 1][0]); }
  });
  return ids;
}
// All poles of the line as circles in the line color, above the route. Terminals (start/end
// of variants) are larger and — for the selected line — labeled.
function buildRouteStops(route, key, interactive) {
  const color = routeColor(route);
  const hl = new Set(state.lastNearby.map(s => s.id));
  const terminals = terminalIds(route);
  const labelled = new Set(), W = routeW();
  const markers = lineStops(key).map(s => {
    const term = terminals.has(s.id);
    const m = L.circleMarker([s.lat, s.lon], {
      ...stopCircleSize(term, W),
      color, fillColor: hl.has(s.id) ? HL_FILL : '#fff', fillOpacity: 1,
      interactive, bubblingMouseEvents: false,
    });
    if (interactive) {
      m.on('mouseover', () => showStopHover(s));
      m.on('mouseout', () => stopMouseOut(s));
      m.on('click', () => stopClicked(s));
      if (term && !labelled.has(s.name)) {
        labelled.add(s.name);
        m.bindTooltip(esc(s.name), { permanent: true, direction: 'auto', offset: [0, 0], className: 'term-label' });
        m.on('add', () => m.getTooltip()?.getElement()?.style.setProperty('--term-c', color));
      }
    }
    return { m, s, term };
  });
  return { layer: L.layerGroup(markers.map(x => x.m)), markers };
}

// Route preview when hovering a line number (without zooming the map)
export function showPreview(key) {
  if (key === previewKey) return;
  clearPreview();
  if (key === state.selectedRouteKey) return;
  const route = ROUTES[key];
  if (!hasShapes(route)) return;
  previewKey = key;
  const color = routeColor(route);
  const W = routeW();
  const casing = route.shapes.map(pts => routeLine(pts, { color: '#fff', weight: W.sel + 3, opacity: 0.8 }));
  const lines = route.shapes.map(pts => routeLine(pts, { color, weight: Math.max(2.5, W.sel - 1), opacity: 0.95 }));
  previewLayer = L.layerGroup([...casing, ...lines]).addTo(map);
  previewStopsLayer = buildRouteStops(route, key, false).layer.addTo(map);
  routeLayers.forEach(l => l.setStyle({ opacity: 0.2 }));
}
export function clearPreview() {
  previewLayer = dropLayer(previewLayer);
  previewStopsLayer = dropLayer(previewStopsLayer);
  if (previewKey !== null) { previewKey = null; styleVariants(); }
}

export function drawRoute(key) {
  clearRouteLayers();
  const route = ROUTES[key];
  if (!hasShapes(route)) {
    routeStatus.textContent = `Brak zapisanej geometrii trasy dla linii ${key.split('|')[0]} w danych źródłowych.`;
    return;
  }
  const color = routeColor(route);
  routeLayers = route.shapes.map(pts => routeLine(pts, { color, weight: 4, opacity: 0.85 }));
  routeLayerGroup = L.layerGroup(routeLayers).addTo(map);
  const st = buildRouteStops(route, key, true);
  routeStopsLayer = st.layer.addTo(map);
  routeStopMarkers = st.markers;
  styleVariants();
  routeStatus.textContent = `Trasa linii ${route.ref} (${(TYPE_NAME[route.type] || 'Autobus').toLowerCase()})`
    + (route.name ? `: ${route.name}` : '')
    + (route.shapes.length > 1 ? ` — ${route.shapes.length} warianty/kierunki.` : '.');

  fitRouteView();
}
// selected place: a stop or the circle center
function placeCenter() {
  if (state.stopMode) return L.latLng(state.stopMode.lat, state.stopMode.lon);
  return state.radiusCircle ? state.radiusCircle.getLatLng() : null;
}
// View: the part of the route around the selected place (up to 3 km), not the whole line across half the city.
// The map is only zoomed out/panned, never zoomed in. On phones with padding for the sheet.
export function fitRouteView() {
  const route = ROUTES[state.selectedRouteKey];
  if (!hasShapes(route)) return;
  const allPts = route.shapes.flat();
  const c = placeCenter();
  let pts = allPts;
  if (c) {
    const near = allPts.filter(p => haversineMeters(c.lat, c.lng, p[0], p[1]) <= NEAR_ROUTE_M);
    if (near.length > 1) pts = near.concat([[c.lat, c.lng]]);
  }
  const bounds = L.latLngBounds(pts);
  if (bounds.isValid() && !viewBounds().contains(bounds)) map.fitBounds(bounds, { ...fitPad(30), maxZoom: map.getZoom() });
}
export function styleVariants() {
  const W = routeW();
  routeLayers.forEach((l, i) => l.setStyle(i === state.selectedVariant
    ? { weight: W.sel, opacity: 0.95 } : { weight: W.oth, opacity: 0.45 }));
  if (routeLayers[state.selectedVariant]) routeLayers[state.selectedVariant].bringToFront();
  routeStopMarkers.forEach(({ m, term }) => {
    const { radius, weight } = stopCircleSize(term, W);
    m.setRadius(radius);
    m.setStyle({ weight });
  });
  drawRouteArrows();
  // line stops always above its route (bringToFront above moves the line to the top)
  routeStopMarkers.forEach(({ m }) => m.bringToFront());
}

// triangle centered at c (layer pixels), pointing along the unit vector (ux, uy)
function arrowTriangle(c, ux, uy, size) {
  const tip = L.point(c.x + ux * size, c.y + uy * size);
  const l = L.point(c.x - ux * size * 0.6 - uy * size * 0.8, c.y - uy * size * 0.6 + ux * size * 0.8);
  const r = L.point(c.x - ux * size * 0.6 + uy * size * 0.8, c.y - uy * size * 0.6 - ux * size * 0.8);
  return [tip, l, r].map(p => map.layerPointToLatLng(p));
}
// Direction arrows on the selected variant (every ~90 screen px), to show which way
// the bus goes around a loop or turns back. Computed in pixels, so recomputed after every zoom.
function drawRouteArrows() {
  arrowLayer = dropLayer(arrowLayer);
  const route = state.selectedRouteKey && ROUTES[state.selectedRouteKey];
  const shape = route && route.shapes && route.shapes[state.selectedVariant];
  if (!shape || shape.length < 2) return;
  const W = routeW(), color = routeColor(route);
  const size = Math.max(6, W.sel * 1.6);   // clearly wider than the line
  const pts = shape.map(p => map.latLngToLayerPoint(p));
  const stopPx = routeStopMarkers.map(({ s }) => map.latLngToLayerPoint([s.lat, s.lon]));
  const arrows = [];
  let next = ARROW_STEP_PX / 2;            // distance (px) to the next arrow from the start of the segment
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], seg = a.distanceTo(b);
    if (!seg) continue;
    const ux = (b.x - a.x) / seg, uy = (b.y - a.y) / seg;
    for (; next <= seg; next += ARROW_STEP_PX) {
      const c = L.point(a.x + ux * next, a.y + uy * next);
      if (stopPx.some(p => p.distanceTo(c) < size + 6)) continue;   // not on a stop circle
      arrows.push(L.polygon(arrowTriangle(c, ux, uy, size), {
        color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 1, interactive: false,
      }));
    }
    next -= seg;
  }
  if (arrows.length) arrowLayer = L.layerGroup(arrows).addTo(map);
}
