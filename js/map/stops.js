import { state } from '../state.js';
import { esc, haversineMeters } from '../util.js';
import { STOP_BUS, STOP_COLOR, typeCmp } from '../config.js';
import { COARSE } from '../dom.js';
import { STOPS, STOP_BY_ID, stopKind } from '../data.js';
import { cardPlacement, dropLayer, hoverMarker, htmlIcon, map, stopMarkers } from './view.js';
import { routeStopMarkers } from './route.js';
import { clearIsoPath, removePointHover } from './iso.js';
import { isoCardLine } from '../iso.js';
import { selectStop } from '../ui/panel.js';
import { setTarget, targetClickMode } from '../ui/target.js';

export const HL_FILL = '#f0b862';   // fill of a stop inside the circle (orange)
const SIBLING_M = 400;               // poles with the same name within this radius = one stop
const MAX_CHIPS = 16;                // this many line numbers in one card row, the rest as "+N"

// Hovering a stop in a list (travel time, stop list) shows it on the map.
// If it is out of view, the map pans slightly and the card appears after the pan.
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

// ---------------------------------------------------------------------------
// Stop dots
// ---------------------------------------------------------------------------
function stopScale() { const z = map ? map.getZoom() : 14; return (z >= 16 ? 1.3 : z >= 14 ? 1 : z >= 12 ? 0.75 : 0.55) * (COARSE ? 1.25 : 1); }
export function baseStopStyle(s) {
  const k = stopScale();
  // with a reach area or a selected line, other stops fade into the background (line stops have their own circles)
  if (state.iso || state.selectedRouteKey) return { radius: 2.6 * k, weight: 1, color: '#9d998d', fillColor: '#f4f2ec', fillOpacity: 0.8, opacity: 0.7, dashArray: null };
  const kind = s ? stopKind(s) : 'bus';
  // a train station is a bit larger with a thicker outline — it stands out among stops
  const train = kind === 'train';
  return { radius: (train ? 4.6 : 3.4) * k, weight: Math.max(1.3, (train ? 2.6 : 2) * k), color: STOP_COLOR[kind] || STOP_BUS,
           fillColor: '#ffffff', fillOpacity: 1, opacity: 0.95, dashArray: null };
}
export function restyleStops() { highlightStops(hlIds, hlUnreach); }
// ids = poles in range (orange); unreach = inside the circle but not reachable on foot (gray, dashed)
let hlIds = new Set();
let hlUnreach = new Set();
export function highlightStops(ids, unreach = new Set()) {
  hlIds = ids; hlUnreach = unreach;
  routeStopMarkers.forEach(({ m, s }) => m.setStyle({ fillColor: ids.has(s.id) && !unreach.has(s.id) ? HL_FILL : '#fff' }));
  const r = 6 * Math.max(stopScale(), 0.75);
  const bases = Object.fromEntries(['tram', 'bus', 'train'].map(kind => [kind, baseStopStyle({ _kind: kind })]));
  const un = { color: '#6f6a5e', fillColor: '#ffffff', radius: r, weight: 2.5, dashArray: '3 2', fillOpacity: 1, opacity: 1 };
  const on = { color: '#c98a2c', fillColor: HL_FILL, radius: r, weight: 2, dashArray: null, fillOpacity: 1, opacity: 1 };
  stopMarkers.forEach((m, i) => {
    const s = STOPS[i];
    m.setStyle(unreach.has(s.id) ? un : ids.has(s.id) ? on : bases[stopKind(s)]);
  });
}

// ---------------------------------------------------------------------------
// Stop hover: springy dot + pulsing ring + card with lines.
// Drawn as HTML in a separate pane above the canvas (canvas does not animate CSS).
// ---------------------------------------------------------------------------
let hoverLayer = null;
export let stopHoverOn = false;
// After a stop is clicked its card does not return until the cursor leaves it (the panel shows the same).
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
// other poles with this name nearby (together with `s` they form the stop)
function siblingPoles(s) {
  return STOPS.filter(x => x.name === s.name && x.id !== s.id && haversineMeters(s.lat, s.lon, x.lat, x.lon) <= SIBLING_M);
}
// lines of all poles without duplicates, by type and number
function sortedLines(poles) {
  const lines = new Map();
  poles.forEach(x => x.lines.forEach(l => lines.set(`${l.ref}|${l.type}`, l)));
  return [...lines.values()].sort((a, b) =>
    (a.type !== b.type ? typeCmp(a.type, b.type) : a.ref.localeCompare(b.ref, 'pl', { numeric: true })));
}
// row of line numbers; truncated at large hubs
function chipRow(lines, cls) {
  if (!lines.length) return '';
  return '<div class="sh-chips">' + lines.slice(0, MAX_CHIPS).map(l => `<span class="${cls}">${esc(l.ref)}</span>`).join('')
    + (lines.length > MAX_CHIPS ? `<span class="more">+${lines.length - MAX_CHIPS}</span>` : '') + '</div>';
}
// trains, trams and buses in separate rows + summary "2 kol. · 3 tram. · 5 aut."
function linesSummary(lines) {
  const train = lines.filter(l => l.type === 'train'), tram = lines.filter(l => l.type === 'tram');
  const bus = lines.filter(l => l.type !== 'tram' && l.type !== 'train');
  const meta = [train.length && `${train.length} kol.`, tram.length && `${tram.length} tram.`, bus.length && `${bus.length} aut.`]
    .filter(Boolean).join(' · ');
  return { meta, chips: chipRow(train, 'k') + chipRow(tram, 't') + chipRow(bus, 'b') };
}
export function showStopHover(s) {
  if (hoverMute === s.name) return;
  hideStopHover();
  removePointHover();
  stopHoverOn = true;
  const kinds = new Set(s.lines.map(l => l.type));
  const c = kinds.size === 1 ? `var(--${[...kinds][0]})` : 'var(--accent)';
  const sibs = siblingPoles(s);
  const { meta, chips } = linesSummary(sortedLines([s, ...sibs]));
  const unreach = !state.stopMode && state.pointReach && state.pointReach.get(s.id) === null
    ? '<div class="sh-unreach">Brak dojścia pieszo z zaznaczonego miejsca</div>' : '';
  const icon = htmlIcon(`<div class="sh${cardPlacement([s.lat, s.lon])}" style="--sh-c:${c}">
      <div class="sh-ring"></div><div class="sh-dot"></div>
      <div class="sh-tip${state.iso ? ' wide' : ''}"><div class="sh-name">${esc(s.name)}</div>
        <div class="sh-meta">${meta}</div>
        ${chips}
        ${isoCardLine(s, sibs)}${unreach}</div></div>`);
  const sibIcon = htmlIcon(`<div class="sh" style="--sh-c:${c}"><div class="sh-sib"></div></div>`);
  hoverLayer = L.layerGroup([
    ...sibs.map(x => hoverMarker([x.lat, x.lon], sibIcon)),
    hoverMarker([s.lat, s.lon], icon, { zIndexOffset: 1000 }),
  ]).addTo(map);
}
export function hideStopHover() {
  stopHoverOn = false;
  clearIsoPath();
  hoverLayer = dropLayer(hoverLayer);
}

// ---------------------------------------------------------------------------
// Pole numbers (01, 02…) from ZTP boards at the selected stop — the same as on the departure board.
// Tram and bus poles with the same number are one place, so one label.
// ---------------------------------------------------------------------------
let poleLayer = null;
let poleEls = new Map();
export function drawPoleLabels(poles) {
  const byCode = new Map();
  poles.forEach(p => { if (p.c && !byCode.has(p.c)) byCode.set(p.c, p); });
  if (byCode.size < 2) return;
  const marks = [...byCode.entries()].map(([c, p]) => {
    const m = hoverMarker([p.lat, p.lon], htmlIcon(`<span class="pole-label" data-c="${esc(c)}">${esc(c)}</span>`));
    m.on('add', () => poleEls.set(c, m.getElement()?.querySelector('.pole-label')));
    return m;
  });
  poleLayer = L.layerGroup(marks).addTo(map);
}
export function clearPoleLabels() {
  poleLayer = dropLayer(poleLayer);
  poleEls = new Map();
}
export function hotPole(c) {
  poleEls.forEach((el, k) => el && el.classList.toggle('hot', !!c && k === c));
}
