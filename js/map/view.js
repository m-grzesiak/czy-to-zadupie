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

const START_VIEW = [[50.0619, 19.9368], 14];   // Rynek Główny
const DATA_PAD = 0.06;            // margines wokół prostokąta przystanków
const MOBILE_PAD_TOP = 0.12;      // na telefonie zapas u góry (ułamek wysokości obszaru); na dole cała wysokość
const LABEL_ZOOM = 16;            // od tego przybliżenia widać numery słupków
const OUTSIDE_DATA_M = 5000;      // lokalizacja dalej od każdego przystanku = poza obszarem danych
const TOUCH_MOUSE_MS = 1000;      // tyle po stuknięciu ignorujemy sztuczny mousemove
const CARD_EDGE_PX = 150;         // karta hovera bliżej krawędzi mapy otwiera się w drugą stronę

export let map;
export let stopMarkers = [];

// ---------------------------------------------------------------------------
// Drobne pomocniki warstw, wspólne dla map/*
// ---------------------------------------------------------------------------
// zdejmuje warstwę z mapy (jeśli jest); zwraca null do przypisania: `layer = dropLayer(layer)`
export function dropLayer(layer) {
  if (layer) map.removeLayer(layer);
  return null;
}
// ikona z samego HTML (karty, etykiety) — bez domyślnego obrazka Leaflet
export function htmlIcon(html) { return L.divIcon({ className: '', iconSize: [0, 0], html }); }
// marker w warstwie 'hover' nad płótnem, nie łapie kliknięć
export function hoverMarker(ll, icon, opts = {}) {
  return L.marker(ll, { icon, interactive: false, pane: 'hover', keyboard: false, ...opts });
}
// klasy karty hovera: przy górnej krawędzi otwiera się w dół, przy bocznych do środka mapy
export function cardPlacement(ll) {
  const cp = map.latLngToContainerPoint(ll), mw = map.getSize().x;
  return (cp.y < CARD_EDGE_PX ? ' below' : '') + (cp.x < CARD_EDGE_PX ? ' al' : cp.x > mw - CARD_EDGE_PX ? ' ar' : '');
}

// ---------------------------------------------------------------------------
// Widoczna część mapy (na telefonie bez arkusza i górnych przycisków)
// ---------------------------------------------------------------------------
function visibleArea() {
  const s = map.getSize(), top = topUi();
  return { w: s.x, top, h: Math.max(40, s.y - top - sheetPx()) };
}
function visibleCenter() {
  const v = visibleArea();
  return L.point(v.w / 2, v.top + v.h / 2);
}
// widoczna część mapy, zmniejszona o ułamek `shrink` z każdej strony
export function viewBounds(shrink = 0) {
  const { w, top, h } = visibleArea();
  return L.latLngBounds(map.containerPointToLatLng([w * shrink, top + h * shrink]),
    map.containerPointToLatLng([w * (1 - shrink), top + h * (1 - shrink)]));
}
// opcje fitBounds z marginesem na arkusz i przyciski
export function fitPad(pad) { return { paddingTopLeft: [pad, pad + topUi()], paddingBottomRight: [pad, pad + sheetPx()] }; }
// przesuń mapę tak, żeby punkt był na środku widocznej części
export function panToVisible(ll, animate = true) {
  map.panBy(map.latLngToContainerPoint(ll).subtract(visibleCenter()), { animate });
}
// setView, ale z punktem na środku widocznej części mapy (nad arkuszem), nie całego ekranu
export function setViewVisible(ll, z) {
  map.setView(ll, z, { animate: false });
  if (isMobile()) panToVisible(ll, false);
}

// ---------------------------------------------------------------------------
// Kontrolki: + −, lokalizacja, legenda
// ---------------------------------------------------------------------------
// link-przycisk w kontrolce: bez nawigacji do '#'
function onButton(el, fn) {
  L.DomEvent.on(el, 'click', e => { L.DomEvent.preventDefault(e); fn(); });
}
// Przyciski + − (na telefonie w prawym dolnym rogu, nad arkuszem). Przybliżają wokół wybranego miejsca,
// a bez niego wokół środka WIDOCZNEJ części mapy (na telefonie dolną część mapy zasłania arkusz).
export let zoomCtl = null;
function zoomVisible(d) {
  const z0 = map.getZoom();   // po dopasowaniu zasięgu przybliżenie bywa ułamkowe: + − wracają do pełnych poziomów
  const z = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), d > 0 ? Math.floor(z0 + 1e-6) + 1 : Math.ceil(z0 - 1e-6) - 1));
  if (z === z0) return;
  // wybrane miejsce (okrąg, przystanek, start zasięgu) widać na mapie: przybliżamy wokół niego, zostaje w tym samym miejscu ekranu;
  // inaczej wokół środka widocznej części mapy
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
// Granice mapy. Na telefonie z zapasem na dole: dolną część mapy zasłania arkusz, a Leaflet pilnuje granic
// dla całego kontenera — bez zapasu dopasowanie widoku (zasięg, trasa) nie mogło zejść niżej i obszar uciekał pod arkusz.
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
// Przycisk "moja lokalizacja" (pod + −, na telefonie w prawym górnym rogu): zaznacza punkt w miejscu użytkownika
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
// legenda kolorów przystanków (lewy dolny róg, obok atrybucji); "kolej" tylko, gdy w danych są pociągi
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
// Start mapy
// ---------------------------------------------------------------------------
export function initMap() {
  map = L.map('map', { zoomControl: false, preferCanvas: true, renderer: L.canvas({ tolerance: COARSE ? 10 : 2 }) })
    .setView(...START_VIEW);

  // Oficjalne kafelki OpenStreetMap. Blokują żądania bez realnego Referera (stąd 403
  // przy otwieraniu tego pliku bezpośrednio z dysku przez file://) — ale ze strony
  // hostowanej pod prawdziwym adresem (np. GitHub Pages) powinny działać normalnie.
  // Używaj tego bezpośredniego serwera tylko do lekkiego/osobistego ruchu — przy
  // większej skali przesiądź się na dostawcę z własnym kluczem (MapTiler, Stadia Maps)
  // albo hostuj kafelki samodzielnie.
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
    if (state.selectedRouteKey && !targetClickMode()) selectRoute(state.selectedRouteKey);   // przystanek spoza trasy: chowamy trasę
    stopClicked(s);
  });
  return m;
}
// Mapa tylko w obszarze danych: prostokąt wszystkich przystanków + margines. Nie da się jej przesunąć
// poza niego, a najmniejsze przybliżenie to takie, przy którym widać cały obszar (zależy od ekranu).
function initBounds() {
  dataBoundsBase = L.latLngBounds(STOPS.map(s => [s.lat, s.lon])).pad(DATA_PAD);
  applyMaxBounds();
  map.options.maxBoundsViscosity = 1;   // twarda krawędź, bez "gumowego" odbicia
  const fitMinZoom = () => map.setMinZoom(Math.max(8, map.getBoundsZoom(dataBoundsBase, false)));
  fitMinZoom();
  map.on('resize', () => {
    fitMinZoom();
    // obrót telefonu, rozwinięcie panelu: pinezka startu wraca do widoku
    const o = isoOrigin();
    if (o && !viewBounds(0.15).contains([o.lat, o.lon])) panToVisible(L.latLng(o.lat, o.lon), false);
  });
}
function initMapEvents() {
  // Klik w mapę: w trybie zasięgu (albo po "Wskaż cel") wskazuje cel podróży, inaczej wybiera nowe miejsce.
  // Każdy klik coś robi — nie ma kliknięć, które tylko chowają poprzedni widok.
  map.on('click', (e) => {
    if (targetClickMode()) { setTarget(e.latlng.lat, e.latlng.lng, null, false, { pop: true }); return; }
    if (state.selectedRouteKey) selectRoute(state.selectedRouteKey);
    selectPoint(e.latlng);
  });
  map.on('movestart zoomstart', () => { hideStopHover(); hidePointHover(); });
  const zoomCls = () => map.getContainer().classList.toggle('z-lo', map.getZoom() < LABEL_ZOOM);
  zoomCls();
  map.on('zoomend', () => { restyleStops(); zoomCls(); if (state.selectedRouteKey) styleVariants(); });   // kropki i trasa rosną z przybliżeniem
  // dotyk: przeglądarka dosyła po stuknięciu sztuczny mousemove — bez hovera (na telefonie jest dymek)
  let lastTouch = 0;
  map.getContainer().addEventListener('touchstart', () => { lastTouch = Date.now(); }, { passive: true });
  map.on('mousemove', e => {
    if (!state.iso || !state.iso.walk || Date.now() - lastTouch < TOUCH_MOUSE_MS) return;
    schedulePointHover(e.latlng);
  });
  // mouseleave samego kontenera (mapowe 'mouseout' odpala się też między elementami wewnątrz mapy)
  map.getContainer().addEventListener('mouseleave', cancelPointHover);
}
