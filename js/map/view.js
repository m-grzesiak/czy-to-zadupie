import { state } from '../state.js';
import { haversineMeters } from '../util.js';
import { STOP_BUS, STOP_TRAIN, STOP_TRAM } from '../config.js';
import { COARSE, isMobile, radiusInput, showNotice } from '../dom.js';
import { STOPS } from '../data.js';
import { baseStopStyle, hideStopHover, restyleStops, showStopHover, stopClicked, stopMouseOut } from './stops.js';
import { styleVariants } from './route.js';
import { cancelPointHover, hidePointHover, schedulePointHover } from './iso.js';
import { isoOrigin } from '../iso.js';
import { IsoChip } from '../ui/iso-box.js';
import { selectRoute } from '../ui/line.js';
import { selectPoint, setRadius } from '../ui/panel.js';
import { setTarget, targetClickMode } from '../ui/target.js';
import { sheetPx, topUi } from '../ui/sheet.js';

const START_VIEW = [[50.0619, 19.9368], 14];   // Rynek Główny (Main Square)
const DATA_PAD = 0.06;            // margin around the stops rectangle
const MOBILE_PAD_TOP = 0.12;      // on phones: extra room at the top (fraction of the area height); at the bottom the full height
const LABEL_ZOOM = 16;            // pole numbers are visible from this zoom level
const OUTSIDE_DATA_M = 5000;      // a location farther than this from every stop = outside the data area
const TOUCH_MOUSE_MS = 1000;      // ignore the synthetic mousemove for this long after a tap
const CARD_EDGE_PX = 150;         // a hover card closer than this to the map edge opens the other way

export let map;
export let stopMarkers = [];

// ---------------------------------------------------------------------------
// Small layer helpers shared by map/*
// ---------------------------------------------------------------------------
// removes a layer from the map (if present); returns null for assignment: `layer = dropLayer(layer)`
export function dropLayer(layer) {
  if (layer) map.removeLayer(layer);
  return null;
}
// icon made of plain HTML (cards, labels), without the default Leaflet image
export function htmlIcon(html) { return L.divIcon({ className: '', iconSize: [0, 0], html }); }
// marker in the 'hover' pane above the canvas, does not catch clicks
export function hoverMarker(ll, icon, opts = {}) {
  return L.marker(ll, { icon, interactive: false, pane: 'hover', keyboard: false, ...opts });
}
// hover card classes: near the top edge it opens downwards, near the sides towards the map center
export function cardPlacement(ll) {
  const cp = map.latLngToContainerPoint(ll), mw = map.getSize().x;
  return (cp.y < CARD_EDGE_PX ? ' below' : '') + (cp.x < CARD_EDGE_PX ? ' al' : cp.x > mw - CARD_EDGE_PX ? ' ar' : '');
}

// ---------------------------------------------------------------------------
// Visible part of the map (on phones without the sheet and top buttons)
// ---------------------------------------------------------------------------
function visibleArea() {
  const s = map.getSize(), top = topUi();
  return { w: s.x, top, h: Math.max(40, s.y - top - sheetPx()) };
}
function visibleCenter() {
  const v = visibleArea();
  return L.point(v.w / 2, v.top + v.h / 2);
}
// visible part of the map, shrunk by the `shrink` fraction on each side
export function viewBounds(shrink = 0) {
  const { w, top, h } = visibleArea();
  return L.latLngBounds(map.containerPointToLatLng([w * shrink, top + h * shrink]),
    map.containerPointToLatLng([w * (1 - shrink), top + h * (1 - shrink)]));
}
// fitBounds options with padding for the sheet and buttons
export function fitPad(pad) { return { paddingTopLeft: [pad, pad + topUi()], paddingBottomRight: [pad, pad + sheetPx()] }; }
// pan the map so the point is centered in the visible part
export function panToVisible(ll, animate = true) {
  map.panBy(map.latLngToContainerPoint(ll).subtract(visibleCenter()), { animate });
}
// setView, but with the point centered in the visible part of the map (above the sheet), not the whole screen
export function setViewVisible(ll, z) {
  map.setView(ll, z, { animate: false });
  if (isMobile()) panToVisible(ll, false);
}

// ---------------------------------------------------------------------------
// Controls: + −, location, legend
// ---------------------------------------------------------------------------
// link-button in a control: no navigation to '#'
function onButton(el, fn) {
  L.DomEvent.on(el, 'click', e => { L.DomEvent.preventDefault(e); fn(); });
}
// + − buttons (on phones in the bottom-right corner, above the sheet). They zoom around the selected place,
// and without one around the center of the VISIBLE part of the map (on phones the sheet covers the bottom of the map).
export let zoomCtl = null;
function zoomVisible(d) {
  const z0 = map.getZoom();   // after fitting the reach area the zoom may be fractional: + − go back to whole levels
  const z = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), d > 0 ? Math.floor(z0 + 1e-6) + 1 : Math.ceil(z0 - 1e-6) - 1));
  if (z === z0) return;
  // the selected place (circle, stop, reach area origin) is visible on the map: zoom around it, it stays at the same screen position;
  // otherwise around the center of the visible part of the map
  const o = isoOrigin();
  if (o && viewBounds().contains([o.lat, o.lon])) map.setZoomAround(L.latLng(o.lat, o.lon), z);
  else map.setZoomAround(visibleCenter(), z);
}
const ZoomControl = L.Control.extend({
  options: { position: 'topleft' },
  onAdd(m) {
    const box = L.DomUtil.create('div', 'leaflet-control-zoom leaflet-bar');
    box.innerHTML = '<a class="leaflet-control-zoom-in" href="#" role="button" title="Przybliż" aria-label="Przybliż">+</a>'
      + '<a class="leaflet-control-zoom-out" href="#" role="button" title="Oddal" aria-label="Oddal">&#x2212;</a>';
    L.DomEvent.disableClickPropagation(box);
    const [zin, zout] = box.children;
    onButton(zin, () => zoomVisible(1));
    onButton(zout, () => zoomVisible(-1));
    const sync = () => {
      zin.classList.toggle('leaflet-disabled', m.getZoom() >= m.getMaxZoom());
      zout.classList.toggle('leaflet-disabled', m.getZoom() <= m.getMinZoom());
    };
    m.on('zoomend zoomlevelschange', sync);
    sync();
    return box;
  },
});
// Map bounds. On phones with extra room at the bottom: the sheet covers the bottom of the map, and Leaflet enforces bounds
// for the whole container — without the extra room, fitting the view (reach area, route) could not go lower and the area slipped under the sheet.
export let dataBoundsBase = null;
export function applyMaxBounds() {
  if (!map || !dataBoundsBase) return;
  let b = dataBoundsBase;
  if (isMobile()) {
    const span = b.getNorth() - b.getSouth();
    b = L.latLngBounds([b.getSouth() - span, b.getWest()], [b.getNorth() + span * MOBILE_PAD_TOP, b.getEast()]);
  }
  map.setMaxBounds(b);
}
// "My location" button (below + −, on phones in the top-right corner): marks a point at the user's position
export let locateCtl = null;
const LocateControl = L.Control.extend({
  options: { position: 'topleft' },
  onAdd() {
    const box = L.DomUtil.create('div', 'leaflet-bar locate-ctl');
    box.innerHTML = `<a href="#" role="button" title="Moja lokalizacja" aria-label="Pokaż linie w pobliżu mojej lokalizacji">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6">
      <circle cx="9" cy="9" r="5.2"/><circle cx="9" cy="9" r="1.8" fill="currentColor" stroke="none"/>
      <path d="M9 1v2.6M9 14.4V17M1 9h2.6M14.4 9H17" stroke-linecap="round"/></svg></a>`;
    L.DomEvent.disableClickPropagation(box);
    onButton(box.firstChild, () => locateMe(box));
    return box;
  },
});
export function locateMe(box) {
  if (!navigator.geolocation) { showNotice('Ta przeglądarka nie udostępnia lokalizacji.'); return; }
  box.classList.add('busy');
  navigator.geolocation.getCurrentPosition(pos => {
    box.classList.remove('busy');
    const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
    if (state.selectedRouteKey) selectRoute(state.selectedRouteKey);
    selectPoint(ll);
    const near = STOPS.some(s => haversineMeters(ll.lat, ll.lng, s.lat, s.lon) < OUTSIDE_DATA_M);
    if (!near) showNotice('Jesteś poza obszarem, który obejmują dane (Kraków i okolice).');
    setViewVisible(ll, Math.max(map.getZoom(), 15));
  }, err => {
    box.classList.remove('busy');
    showNotice(err.code === 1 ? 'Nie mam zgody na lokalizację. Zezwól na nią w ustawieniach przeglądarki albo kliknij miejsce na mapie.'
      : 'Nie udało się ustalić lokalizacji. Spróbuj ponownie albo kliknij miejsce na mapie.');
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}
// stop color legend (bottom-left corner, next to the attribution); "kolej" only when the data contains trains
const Legend = L.Control.extend({
  options: { position: 'bottomleft' },
  onAdd() {
    const el = L.DomUtil.create('div', 'stop-legend');
    const item = (color, label) => `<span><i style="border-color:${color}"></i>${label}</span>`;
    const hasTrains = STOPS.some(st => st.lines.some(l => l.type === 'train'));
    el.innerHTML = item(STOP_TRAM, 'tramwaj') + item(STOP_BUS, 'autobus') + (hasTrains ? item(STOP_TRAIN, 'kolej') : '');
    L.DomEvent.disableClickPropagation(el);
    return el;
  },
});

// ---------------------------------------------------------------------------
// Map startup
// ---------------------------------------------------------------------------
export function initMap() {
  map = L.map('map', { zoomControl: false, preferCanvas: true, renderer: L.canvas({ tolerance: COARSE ? 10 : 2 }) })
    .setView(...START_VIEW);

  // Official OpenStreetMap tiles. They block requests without a real Referer (hence 403
  // when opening this file directly from disk via file://) — but from a page
  // hosted at a real address (e.g. GitHub Pages) they should work normally.
  // Use this direct server only for light/personal traffic — at
  // larger scale switch to a provider with your own key (MapTiler, Stadia Maps)
  // or host the tiles yourself.
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  addControls();
  stopMarkers = STOPS.map(addStopMarker);
  initBounds();
  radiusInput.addEventListener('input', () => setRadius(parseInt(radiusInput.value, 10), true));
  map.createPane('hover').style.zIndex = 640;
  map.getPane('hover').classList.add('leaflet-hover-pane');
  initMapEvents();
}
function addControls() {
  zoomCtl = new ZoomControl({ position: isMobile() ? 'bottomright' : 'topleft' }).addTo(map);
  locateCtl = new LocateControl({ position: isMobile() ? 'topright' : 'topleft' }).addTo(map);
  new Legend().addTo(map);
  new IsoChip().addTo(map);
}
function addStopMarker(s) {
  const m = L.circleMarker([s.lat, s.lon], { ...baseStopStyle(s), bubblingMouseEvents: false }).addTo(map);
  m.on('mouseover', () => showStopHover(s));
  m.on('mouseout', () => stopMouseOut(s));
  m.on('click', () => {
    if (state.selectedRouteKey && !targetClickMode()) selectRoute(state.selectedRouteKey);   // stop not on the route: hide the route
    stopClicked(s);
  });
  return m;
}
// The map only covers the data area: the rectangle of all stops + margin. It cannot be panned
// outside it, and the minimum zoom is the one that shows the whole area (depends on the screen).
function initBounds() {
  dataBoundsBase = L.latLngBounds(STOPS.map(s => [s.lat, s.lon])).pad(DATA_PAD);
  applyMaxBounds();
  map.options.maxBoundsViscosity = 1;   // hard edge, no "rubber band" bounce
  const fitMinZoom = () => map.setMinZoom(Math.max(8, map.getBoundsZoom(dataBoundsBase, false)));
  fitMinZoom();
  map.on('resize', () => {
    fitMinZoom();
    // phone rotation, panel expansion: the origin pin comes back into view
    const o = isoOrigin();
    if (o && !viewBounds(0.15).contains([o.lat, o.lon])) panToVisible(L.latLng(o.lat, o.lon), false);
  });
}
function initMapEvents() {
  // Map click: in reach area mode (or after "Wskaż cel") it picks the trip target, otherwise it selects a new place.
  // Every click does something — there are no clicks that only hide the previous view.
  map.on('click', (e) => {
    if (targetClickMode()) { setTarget(e.latlng.lat, e.latlng.lng, null, false, { pop: true }); return; }
    if (state.selectedRouteKey) selectRoute(state.selectedRouteKey);
    selectPoint(e.latlng);
  });
  map.on('movestart zoomstart', () => { hideStopHover(); hidePointHover(); });
  const zoomCls = () => map.getContainer().classList.toggle('z-lo', map.getZoom() < LABEL_ZOOM);
  zoomCls();
  map.on('zoomend', () => { restyleStops(); zoomCls(); if (state.selectedRouteKey) styleVariants(); });   // dots and the route grow with zoom
  // touch: the browser sends a synthetic mousemove after a tap — no hover (phones get a popup)
  let lastTouch = 0;
  map.getContainer().addEventListener('touchstart', () => { lastTouch = Date.now(); }, { passive: true });
  map.on('mousemove', e => {
    if (!state.iso || !state.iso.walk || Date.now() - lastTouch < TOUCH_MOUSE_MS) return;
    schedulePointHover(e.latlng);
  });
  // mouseleave of the container itself (the map 'mouseout' also fires between elements inside the map)
  map.getContainer().addEventListener('mouseleave', cancelPointHover);
}
