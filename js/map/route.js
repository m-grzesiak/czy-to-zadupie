import { state } from '../state.js';
import { esc, haversineMeters } from '../util.js';
import { TYPE_NAME } from '../config.js';
import { routeStatus } from '../dom.js';
import { ROUTES, lineStops, routeColor } from '../data.js';
import { fitPad, map, viewBounds } from './view.js';
import { showStopHover, stopClicked, stopMouseOut } from './stops.js';

      // {calendar:{"2026-09-27":0,...}, deps:{dlat,dlon,path}} — brak w danych demo
let routeLayers = [];
let routeLayerGroup = null;
let routeStopsLayer = null;
export let routeStopMarkers = [];
let previewStopsLayer = null;
export function clearRouteLayers() {
  if (routeLayerGroup) { map.removeLayer(routeLayerGroup); routeLayerGroup = null; }
  if (routeStopsLayer) { map.removeLayer(routeStopsLayer); routeStopsLayer = null; }
  if (arrowLayer) { map.removeLayer(arrowLayer); arrowLayer = null; }
  routeStopMarkers = [];
  routeLayers = [];
}
// Wszystkie słupki linii jako kółka w kolorze linii, nad trasą. Pętle (początek/koniec
// wariantów) są większe i — dla wybranej linii — podpisane.
function buildRouteStops(route, key, interactive) {
  const color = routeColor(route);
  const hl = new Set(state.lastNearby.map(s => s.id));
  const terminals = new Set();
  (route.trips || []).forEach(t => {
    if (t && t.s.length) { terminals.add(t.s[0][0]); terminals.add(t.s[t.s.length - 1][0]); }
  });
  const labelled = new Set(), W = routeW();
  const markers = lineStops(key).map(s => {
    const term = terminals.has(s.id);
    const m = L.circleMarker([s.lat, s.lon], {
      radius: term ? W.term : W.st, weight: term ? W.sw + 0.6 : W.sw,
      color, fillColor: hl.has(s.id) ? '#f0b862' : '#fff', fillOpacity: 1,
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
// Podgląd trasy po najechaniu na numer linii (bez przybliżania mapy)
let previewLayer = null;
let previewKey = null;
export function showPreview(key) {
  if (key === previewKey) return;
  clearPreview();
  if (key === state.selectedRouteKey) return;
  const route = ROUTES[key];
  if (!route || !route.shapes || !route.shapes.length) return;
  previewKey = key;
  const color = routeColor(route);
  const W = routeW();
  const casing = route.shapes.map(pts => L.polyline(pts, { color: '#fff', weight: W.sel + 3, opacity: 0.8, lineJoin: 'round', interactive: false }));
  const lines = route.shapes.map(pts => L.polyline(pts, { color, weight: Math.max(2.5, W.sel - 1), opacity: 0.95, lineJoin: 'round', interactive: false }));
  previewLayer = L.layerGroup([...casing, ...lines]).addTo(map);
  previewStopsLayer = buildRouteStops(route, key, false).layer.addTo(map);
  routeLayers.forEach(l => l.setStyle({ opacity: 0.2 }));
}
export function clearPreview() {
  if (previewLayer) { map.removeLayer(previewLayer); previewLayer = null; }
  if (previewStopsLayer) { map.removeLayer(previewStopsLayer); previewStopsLayer = null; }
  if (previewKey !== null) { previewKey = null; styleVariants(); }
}
export function drawRoute(key) {
  clearRouteLayers();
  const route = ROUTES[key];
  if (!route || !route.shapes || route.shapes.length === 0) {
    routeStatus.textContent = `Brak zapisanej geometrii trasy dla linii ${key.split('|')[0]} w danych źródłowych.`;
    return;
  }
  const color = routeColor(route);
  const layers = route.shapes.map(pts => L.polyline(pts, { color, weight: 4, opacity: 0.85, lineJoin: 'round', interactive: false }));
  routeLayers = layers;
  routeLayerGroup = L.layerGroup(layers).addTo(map);
  const st = buildRouteStops(route, key, true);
  routeStopsLayer = st.layer.addTo(map);
  routeStopMarkers = st.markers;
  styleVariants();
  routeStatus.textContent = `Trasa linii ${route.ref} (${(TYPE_NAME[route.type] || 'Autobus').toLowerCase()})`
    + (route.name ? `: ${route.name}` : '')
    + (route.shapes.length > 1 ? ` — ${route.shapes.length} warianty/kierunki.` : '.');

  fitRouteView();
}
// Widok: fragment trasy w okolicy wybranego miejsca (do 3 km), a nie cała linia przez pół miasta.
// Mapę tylko oddalamy/przesuwamy, nigdy nie przybliżamy. Na telefonie z marginesem na arkusz.
export function fitRouteView() {
  const route = ROUTES[state.selectedRouteKey];
  if (!route || !route.shapes || !route.shapes.length) return;
  const allPts = route.shapes.flat();
  const c = state.stopMode ? L.latLng(state.stopMode.lat, state.stopMode.lon) : state.radiusCircle ? state.radiusCircle.getLatLng() : null;
  let pts = allPts;
  if (c) {
    const near = allPts.filter(p => haversineMeters(c.lat, c.lng, p[0], p[1]) <= 3000);
    if (near.length > 1) pts = near.concat([[c.lat, c.lng]]);
  }
  const bounds = L.latLngBounds(pts);
  if (bounds.isValid() && !viewBounds().contains(bounds)) map.fitBounds(bounds, { ...fitPad(30), maxZoom: map.getZoom() });
}
// Grubość trasy i kółek przystanków zależy od przybliżenia: przy oddaleniu gruba linia i duże kółka
// zlewały pętle i zawracania w jedną plamę.
function routeW() {
  const z = map ? map.getZoom() : 14;
  return z >= 16 ? { sel: 6, oth: 3, st: 4.5, term: 6, sw: 2.5 }
       : z >= 15 ? { sel: 5, oth: 2.5, st: 3.8, term: 5.5, sw: 2.2 }
       : z >= 14 ? { sel: 4, oth: 2, st: 3.2, term: 4.8, sw: 1.8 }
       :           { sel: 3, oth: 1.6, st: 2.4, term: 4, sw: 1.4 };
}
export function styleVariants() {
  const W = routeW();
  routeLayers.forEach((l, i) => l.setStyle(i === state.selectedVariant
    ? { weight: W.sel, opacity: 0.95 } : { weight: W.oth, opacity: 0.45 }));
  if (routeLayers[state.selectedVariant]) routeLayers[state.selectedVariant].bringToFront();
  routeStopMarkers.forEach(({ m, term }) => { m.setRadius(term ? W.term : W.st); m.setStyle({ weight: term ? W.sw + 0.6 : W.sw }); });
  drawRouteArrows();
  // przystanki linii zawsze nad jej trasą (bringToFront wyżej przesuwa linię na wierzch)
  routeStopMarkers.forEach(({ m }) => m.bringToFront());
}
// Strzałki kierunku jazdy na wybranym wariancie (co ~90 px ekranu), żeby było widać, którędy
// autobus objeżdża pętlę albo zawraca. Liczone w pikselach, więc przeliczane po każdym zoomie.
let arrowLayer = null;
function drawRouteArrows() {
  if (arrowLayer) { map.removeLayer(arrowLayer); arrowLayer = null; }
  const route = state.selectedRouteKey && ROUTES[state.selectedRouteKey];
  const shape = route && route.shapes && route.shapes[state.selectedVariant];
  if (!shape || shape.length < 2) return;
  const W = routeW(), color = routeColor(route);
  const size = Math.max(6, W.sel * 1.6), STEP = 90;   // wyraźnie szersze niż linia
  const pts = shape.map(p => map.latLngToLayerPoint(p));
  const stopPx = routeStopMarkers.map(({ s }) => map.latLngToLayerPoint([s.lat, s.lon]));
  const arrows = [];
  let next = STEP / 2;                     // odległość (px) do następnej strzałki od początku odcinka
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], seg = a.distanceTo(b);
    if (!seg) continue;
    const ux = (b.x - a.x) / seg, uy = (b.y - a.y) / seg;
    for (; next <= seg; next += STEP) {
      const c = L.point(a.x + ux * next, a.y + uy * next);
      if (stopPx.some(p => p.distanceTo(c) < size + 6)) continue;   // nie na kółku przystanku
      const tip = L.point(c.x + ux * size, c.y + uy * size);
      const l = L.point(c.x - ux * size * 0.6 - uy * size * 0.8, c.y - uy * size * 0.6 + ux * size * 0.8);
      const r = L.point(c.x - ux * size * 0.6 + uy * size * 0.8, c.y - uy * size * 0.6 - ux * size * 0.8);
      arrows.push(L.polygon([tip, l, r].map(p => map.layerPointToLatLng(p)), {
        color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 1, interactive: false,
      }));
    }
    next -= seg;
  }
  if (arrows.length) arrowLayer = L.layerGroup(arrows).addTo(map);
}
