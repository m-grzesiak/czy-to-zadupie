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

  // "ref|type" -> {ref, type, color, shapes:[[[lat,lon],...],...]}
export let map;
export let stopMarkers = [];
// widoczna część mapy (bez arkusza i górnych przycisków), zmniejszona o ułamek `shrink` z każdej strony
export function viewBounds(shrink = 0) {
  const s = map.getSize(), top = topUi(), h = Math.max(40, s.y - top - sheetPx());
  return L.latLngBounds(map.containerPointToLatLng([s.x * shrink, top + h * shrink]),
    map.containerPointToLatLng([s.x * (1 - shrink), top + h * (1 - shrink)]));
}
// opcje fitBounds z marginesem na arkusz i przyciski
export function fitPad(pad) { return { paddingTopLeft: [pad, pad + topUi()], paddingBottomRight: [pad, pad + sheetPx()] }; }
// przesuń mapę tak, żeby punkt był na środku widocznej części
export function panToVisible(ll, animate = true) {
  const s = map.getSize(), top = topUi(), h = Math.max(40, s.y - top - sheetPx());
  const want = L.point(s.x / 2, top + h / 2);
  map.panBy(map.latLngToContainerPoint(ll).subtract(want), { animate });
}
// setView, ale z punktem na środku widocznej części mapy (nad arkuszem), nie całego ekranu
export function setViewVisible(ll, z) {
  map.setView(ll, z, { animate: false });
  if (isMobile()) panToVisible(ll, false);
}
// Przyciski + − (na telefonie w prawym dolnym rogu, nad arkuszem). Przybliżają wokół wybranego miejsca,
// a bez niego wokół środka WIDOCZNEJ części mapy (na telefonie dolną część mapy zasłania arkusz).
export let zoomCtl = null;
function zoomVisible(d) {
  const s = map.getSize(), top = topUi(), h = Math.max(40, s.y - top - sheetPx());
  const z0 = map.getZoom();   // po dopasowaniu zasięgu przybliżenie bywa ułamkowe: + − wracają do pełnych poziomów
  const z = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), d > 0 ? Math.floor(z0 + 1e-6) + 1 : Math.ceil(z0 - 1e-6) - 1));
  if (z === z0) return;
  // wybrane miejsce (okrąg, przystanek, start zasięgu) widać na mapie: przybliżamy wokół niego, zostaje w tym samym miejscu ekranu;
  // inaczej wokół środka widocznej części mapy
  const o = isoOrigin();
  if (o && viewBounds().contains([o.lat, o.lon])) map.setZoomAround(L.latLng(o.lat, o.lon), z);
  else map.setZoomAround(L.point(s.x / 2, top + h / 2), z);
}
const ZoomControl = L.Control.extend({
  options: { position: 'topleft' },
  onAdd(m) {
    const box = L.DomUtil.create('div', 'leaflet-control-zoom leaflet-bar');
    box.innerHTML = '<a class="leaflet-control-zoom-in" href="#" role="button" title="Przybliż" aria-label="Przybliż">+</a>'
      + '<a class="leaflet-control-zoom-out" href="#" role="button" title="Oddal" aria-label="Oddal">&#x2212;</a>';
    L.DomEvent.disableClickPropagation(box);
    const [zin, zout] = box.children;
    L.DomEvent.on(zin, 'click', e => { L.DomEvent.preventDefault(e); zoomVisible(1); });
    L.DomEvent.on(zout, 'click', e => { L.DomEvent.preventDefault(e); zoomVisible(-1); });
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
    b = L.latLngBounds([b.getSouth() - span, b.getWest()], [b.getNorth() + span * 0.12, b.getEast()]);
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
    L.DomEvent.on(box.firstChild, 'click', e => { L.DomEvent.preventDefault(e); locateMe(box); });
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
    const near = STOPS.some(s => haversineMeters(ll.lat, ll.lng, s.lat, s.lon) < 5000);
    if (!near) showNotice('Jesteś poza obszarem, który obejmują dane (Kraków i okolice).');
    setViewVisible(ll, Math.max(map.getZoom(), 15));
  }, err => {
    box.classList.remove('busy');
    showNotice(err.code === 1 ? 'Nie mam zgody na lokalizację. Zezwól na nią w ustawieniach przeglądarki albo kliknij miejsce na mapie.'
      : 'Nie udało się ustalić lokalizacji. Spróbuj ponownie albo kliknij miejsce na mapie.');
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}
export function initMap() {
  map = L.map('map', { zoomControl: false, preferCanvas: true, renderer: L.canvas({ tolerance: COARSE ? 10 : 2 }) })
    .setView([50.0619, 19.9368], 14);

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

  zoomCtl = new ZoomControl({ position: isMobile() ? 'bottomright' : 'topleft' }).addTo(map);
  locateCtl = new LocateControl({ position: isMobile() ? 'topright' : 'topleft' }).addTo(map);
  // legenda kolorów przystanków (lewy dolny róg, obok atrybucji)
  const Legend = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd() {
      const el = L.DomUtil.create('div', 'stop-legend');
      el.innerHTML = `<span><i style="border-color:${STOP_TRAM}"></i>tramwaj</span><span><i style="border-color:${STOP_BUS}"></i>autobus</span>`
        + (STOPS.some(st => st.lines.some(l => l.type === 'train')) ? `<span><i style="border-color:${STOP_TRAIN}"></i>kolej</span>` : '');
      L.DomEvent.disableClickPropagation(el);
      return el;
    },
  });
  new Legend().addTo(map);
  new IsoChip().addTo(map);

  stopMarkers = STOPS.map(s => {
    const m = L.circleMarker([s.lat, s.lon], { ...baseStopStyle(s), bubblingMouseEvents: false }).addTo(map);
    m.on('mouseover', () => showStopHover(s));
    m.on('mouseout', () => stopMouseOut(s));
    m.on('click', () => {
      if (state.selectedRouteKey && !targetClickMode()) selectRoute(state.selectedRouteKey);   // przystanek spoza trasy: chowamy trasę
      stopClicked(s);
    });
    return m;
  });

  // Mapa tylko w obszarze danych: prostokąt wszystkich przystanków + margines. Nie da się jej przesunąć
  // poza niego, a najmniejsze przybliżenie to takie, przy którym widać cały obszar (zależy od ekranu).
  const dataBounds = L.latLngBounds(STOPS.map(s => [s.lat, s.lon])).pad(0.06);
  dataBoundsBase = dataBounds;
  applyMaxBounds();
  map.options.maxBoundsViscosity = 1;   // twarda krawędź, bez "gumowego" odbicia
  const fitMinZoom = () => map.setMinZoom(Math.max(8, map.getBoundsZoom(dataBounds, false)));
  fitMinZoom();
  map.on('resize', fitMinZoom);
  map.on('resize', () => {
    const o = isoOrigin();
    if (o && !viewBounds(0.15).contains([o.lat, o.lon])) panToVisible(L.latLng(o.lat, o.lon), false);
  });

  radiusInput.addEventListener('input', () => setRadius(parseInt(radiusInput.value, 10), true));

  map.createPane('hover').style.zIndex = 640;
  map.getPane('hover').classList.add('leaflet-hover-pane');
  // Klik w mapę: w trybie zasięgu (albo po "Wskaż cel") wskazuje cel podróży, inaczej wybiera nowe miejsce.
  // Każdy klik coś robi — nie ma kliknięć, które tylko chowają poprzedni widok.
  map.on('click', (e) => {
    if (targetClickMode()) { setTarget(e.latlng.lat, e.latlng.lng, null, false, { pop: true }); return; }
    if (state.selectedRouteKey) selectRoute(state.selectedRouteKey);
    selectPoint(e.latlng);
  });
  map.on('movestart zoomstart', () => { hideStopHover(); hidePointHover(); });
  const zoomCls = () => map.getContainer().classList.toggle('z-lo', map.getZoom() < 16);
  zoomCls();
  map.on('zoomend', () => { restyleStops(); zoomCls(); if (state.selectedRouteKey) styleVariants(); });   // kropki i trasa rosną z przybliżeniem
  // dotyk: przeglądarka dosyła po stuknięciu sztuczny mousemove — bez hovera (na telefonie jest dymek)
  let lastTouch = 0;
  map.getContainer().addEventListener('touchstart', () => { lastTouch = Date.now(); }, { passive: true });
  map.on('mousemove', e => {
    if (!state.iso || !state.iso.walk || Date.now() - lastTouch < 1000) return;
    schedulePointHover(e.latlng);
  });
  // mouseleave samego kontenera (mapowe 'mouseout' odpala się też między elementami wewnątrz mapy)
  map.getContainer().addEventListener('mouseleave', cancelPointHover);

}
