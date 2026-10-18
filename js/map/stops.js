import { state } from '../state.js';
import { esc, haversineMeters } from '../util.js';
import { STOP_BUS, STOP_COLOR, typeCmp } from '../config.js';
import { COARSE } from '../dom.js';
import { STOPS, STOP_BY_ID, stopKind } from '../data.js';
import { map, stopMarkers } from './view.js';
import { routeStopMarkers } from './route.js';
import { clearIsoPath, removePointHover } from './iso.js';
import { isoCardLine } from '../iso.js';
import { selectStop } from '../ui/panel.js';
import { setTarget, targetClickMode } from '../ui/target.js';

// Najechanie na przystanek w liście (czas przejazdu, lista przystanków) pokazuje go na mapie.
// Jeśli jest poza widokiem, mapa lekko się przesuwa, a karta pojawia się po przesunięciu.
let listHoverId = null;
export function showListStop(id) {
  const st = STOP_BY_ID.get(id);
  if (!st || id === listHoverId) return;
  listHoverId = id;
  const ll = L.latLng(st.lat, st.lon);
  if (map.getBounds().pad(-0.05).contains(ll)) { showStopHover(st); return; }
  map.once('moveend', () => { if (listHoverId === id) showStopHover(st); });
  map.panInside(ll, { padding: [80, 80] });
}
export function hideListStop() { listHoverId = null; hideStopHover(); }
function stopScale() { const z = map ? map.getZoom() : 14; return (z >= 16 ? 1.3 : z >= 14 ? 1 : z >= 12 ? 0.75 : 0.55) * (COARSE ? 1.25 : 1); }
export function baseStopStyle(s) {
  const k = stopScale();
  // przy zasięgu albo wybranej linii pozostałe przystanki schodzą na drugi plan (przystanki linii mają własne kółka)
  if (state.iso || state.selectedRouteKey) return { radius: 2.6 * k, weight: 1, color: '#9d998d', fillColor: '#f4f2ec', fillOpacity: 0.8, opacity: 0.7, dashArray: null };
  const kind = s ? stopKind(s) : 'bus';
  // stacja kolejowa trochę większa i z grubszą obwódką — widać ją między przystankami
  return { radius: (kind === 'train' ? 4.6 : 3.4) * k, weight: Math.max(1.3, (kind === 'train' ? 2.6 : 2) * k), color: STOP_COLOR[kind] || STOP_BUS,
           fillColor: '#ffffff', fillOpacity: 1, opacity: 0.95, dashArray: null };
}
export function restyleStops() { highlightStops(hlIds, hlUnreach); }
// ---------------------------------------------------------------------------
// Hover na przystanku: sprężysta kropka + pulsujący pierścień + karta z liniami.
// Rysowane jako HTML w osobnej warstwie nad płótnem (canvas nie animuje CSS).
// ---------------------------------------------------------------------------
let hoverLayer = null;
// Po kliknięciu przystanku jego karta nie wraca, dopóki kursor go nie opuści (panel pokazuje to samo).
let hoverMute = null;
export function stopMouseOut(s) {
  if (hoverMute === s.name) hoverMute = null;
  hideStopHover();
}
export function stopClicked(s) {
  hoverMute = s.name;
  hideStopHover();
  if (targetClickMode()) { setTarget(s.lat, s.lon, s.name, false, { pop: true, stopId: s.id }); return; }
  selectStop(s);
}
export function showStopHover(s) {
  if (hoverMute === s.name) return;
  hideStopHover();
  removePointHover();
  stopHoverOn = true;
  const kinds = new Set(s.lines.map(l => l.type));
  const c = kinds.size === 1 ? `var(--${[...kinds][0]})` : 'var(--accent)';

  // wszystkie słupki tej nazwy w pobliżu — linie i podświetlenie
  const sibs = STOPS.filter(x => x.name === s.name && x.id !== s.id && haversineMeters(s.lat, s.lon, x.lat, x.lon) <= 400);
  const lines = new Map();
  [s, ...sibs].forEach(x => x.lines.forEach(l => lines.set(`${l.ref}|${l.type}`, l)));
  const sorted = [...lines.values()].sort((a, b) =>
    (a.type !== b.type ? typeCmp(a.type, b.type) : a.ref.localeCompare(b.ref, 'pl', { numeric: true })));
  // pociągi, tramwaje i autobusy w osobnych rzędach; przy dużych węzłach ucinamy każdą grupę osobno
  const MAX = 16;
  const group = (arr, cls) => arr.length ? '<div class="sh-chips">' +
    arr.slice(0, MAX).map(l => `<span class="${cls}">${esc(l.ref)}</span>`).join('') +
    (arr.length > MAX ? `<span class="more">+${arr.length - MAX}</span>` : '') + '</div>' : '';
  const chips = group(sorted.filter(l => l.type === 'train'), 'k') + group(sorted.filter(l => l.type === 'tram'), 't')
    + group(sorted.filter(l => l.type !== 'tram' && l.type !== 'train'), 'b');
  const nK = sorted.filter(l => l.type === 'train').length, nT = sorted.filter(l => l.type === 'tram').length, nB = sorted.length - nT - nK;
  const meta = [nK && `${nK} kol.`, nT && `${nT} tram.`, nB && `${nB} aut.`].filter(Boolean).join(' · ');

  const cp = map.latLngToContainerPoint([s.lat, s.lon]), mw = map.getSize().x;
  const below = cp.y < 150;
  const side = cp.x < 150 ? ' al' : cp.x > mw - 150 ? ' ar' : '';
  const icon = L.divIcon({
    className: '', iconSize: [0, 0],
    html: `<div class="sh${below ? ' below' : ''}${side}" style="--sh-c:${c}">
      <div class="sh-ring"></div><div class="sh-dot"></div>
      <div class="sh-tip${state.iso ? ' wide' : ''}"><div class="sh-name">${esc(s.name)}</div>
        <div class="sh-meta">${meta}</div>
        ${chips}
        ${isoCardLine(s, sibs)}${!state.stopMode && state.pointReach && state.pointReach.get(s.id) === null ? '<div class="sh-unreach">Brak dojścia pieszo z zaznaczonego miejsca</div>' : ''}</div></div>`
  });
  const sibIcon = L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="sh" style="--sh-c:${c}"><div class="sh-sib"></div></div>` });
  hoverLayer = L.layerGroup([
    ...sibs.map(x => L.marker([x.lat, x.lon], { icon: sibIcon, interactive: false, pane: 'hover', keyboard: false })),
    L.marker([s.lat, s.lon], { icon, interactive: false, pane: 'hover', keyboard: false, zIndexOffset: 1000 }),
  ]).addTo(map);
}
export let stopHoverOn = false;
export function hideStopHover() {
  stopHoverOn = false;
  clearIsoPath();
  if (hoverLayer) { map.removeLayer(hoverLayer); hoverLayer = null; }
}
// Numery słupków (01, 02…) z tablic ZTP przy wybranym przystanku — te same co na tablicy odjazdów.
// Słupki tramwajowy i autobusowy o tym samym numerze to jedno miejsce, więc jedna etykieta.
let poleLayer = null;
let poleEls = new Map();
export function drawPoleLabels(poles) {
  const byCode = new Map();
  poles.forEach(p => { if (p.c && !byCode.has(p.c)) byCode.set(p.c, p); });
  if (byCode.size < 2) return;
  const marks = [...byCode.entries()].map(([c, p]) => {
    const m = L.marker([p.lat, p.lon], { interactive: false, keyboard: false, pane: 'hover',
      icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<span class="pole-label" data-c="${esc(c)}">${esc(c)}</span>` }) });
    m.on('add', () => poleEls.set(c, m.getElement()?.querySelector('.pole-label')));
    return m;
  });
  poleLayer = L.layerGroup(marks).addTo(map);
}
export function clearPoleLabels() {
  if (poleLayer) { map.removeLayer(poleLayer); poleLayer = null; }
  poleEls = new Map();
}
export function hotPole(c) {
  poleEls.forEach((el, k) => el && el.classList.toggle('hot', !!c && k === c));
}
// ids = słupki w zasięgu (pomarańczowe); unreach = w okręgu, ale bez dojścia pieszo (szare, przerywane)
let hlIds = new Set();
let hlUnreach = new Set();
export function highlightStops(ids, unreach = new Set()) {
  hlIds = ids; hlUnreach = unreach;
  routeStopMarkers.forEach(({ m, s }) => m.setStyle({ fillColor: ids.has(s.id) && !unreach.has(s.id) ? '#f0b862' : '#fff' }));
  const k = Math.max(stopScale(), 0.75);
  const bases = { tram: baseStopStyle({ _kind: 'tram' }), bus: baseStopStyle({ _kind: 'bus' }), train: baseStopStyle({ _kind: 'train' }) };
  const un = { color: '#6f6a5e', fillColor: '#ffffff', radius: 6 * k, weight: 2.5, dashArray: '3 2', fillOpacity: 1, opacity: 1 };
  const on = { color: '#c98a2c', fillColor: '#f0b862', radius: 6 * k, weight: 2, dashArray: null, fillOpacity: 1, opacity: 1 };
  stopMarkers.forEach((m, i) => {
    const s = STOPS[i], id = s.id;
    m.setStyle(unreach.has(id) ? un : ids.has(id) ? on : bases[stopKind(s)]);
  });
}
