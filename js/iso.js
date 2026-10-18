import { state } from './state.js';
import { esc, fmt, haversineMeters, nowMinutes, todayISO } from './util.js';
import { ISO_TMAX, ORIGIN_WALK_M, REACH_T, WALK_MPM } from './config.js';
import { STOPS, STOP_BY_ID } from './data.js';
import { WALK, loadWalk } from './walk.js';
import { altLines, applyDayType, runIso, transitGraph } from './routing/transit.js';
import { runIsoWalk, walkLegs } from './routing/street.js';
import { csaRideInfo, runIsoTime, timeModeAvailable } from './routing/csa.js';
import { restyleStops } from './map/stops.js';
import { clearPreview } from './map/route.js';
import { drawIso, drawIsoPath, ensureIsoPane, fitIsoView, isoBands, isoLayer, removeIsoLayers, removePointHover } from './map/iso.js';
import { renderIsoBox, renderIsoChip } from './ui/iso-box.js';
import { selectRoute } from './ui/line.js';
import { renderTargetBox, setPicking } from './ui/target.js';
import { syncURL } from './ui/url.js';

export function isoOrigin() {
  if (state.stopMode) {
    return { name: state.stopMode.name, lat: state.stopMode.lat, lon: state.stopMode.lon,
             poles: state.stopMode.poles.map(p => ({ id: p.id, t0: 0 })) };
  }
  if (state.radiusCircle) {
    const c = state.radiusCircle.getLatLng();
    const poles = STOPS.map(x => ({ id: x.id, d: haversineMeters(c.lat, c.lng, x.lat, x.lon) }))
      .filter(x => x.d <= ORIGIN_WALK_M).map(x => ({ id: x.id, t0: x.d / WALK_MPM }));
    return { name: 'zaznaczony punkt', lat: c.lat, lon: c.lng, poles, point: true, walkMax: ORIGIN_WALK_M };
  }
  return null;
}
export const originKey = o => `${o.point ? 'p' : 's'}:${o.lat.toFixed(5)},${o.lon.toFixed(5)}`;
async function recalcIso(o, T) {
  const base = { o, T, bands: isoBands(T) };
  if (WALK && state.isoMode === 'time' && timeModeAvailable()) {
    if (!state.isoDate) state.isoDate = todayISO();
    if (state.isoTime == null) state.isoTime = nowMinutes();
    const r = await runIsoTime(o, ISO_TMAX, state.isoDate, state.isoTime);
    if (r) return { ...base, ...r, walk: true, mode: 'time' };
  }
  if (WALK) {
    const { labels, res, walk1 } = typicalRun(o);
    return { ...base, labels, res, walk1, walk: true, mode: 'typical' };
  }
  applyDayType(state.isoDay);
  return { ...base, labels: runIso(o, ISO_TMAX), walk: false, mode: 'typical' };
}
// Typowy dzień z danego miejsca (do REACH_T min). Wspólne dla mapy zasięgu i listy celów,
// więc włączenie zasięgu po wybraniu miejsca nic już nie liczy. Pamiętamy ostatni wynik.
let typicalCache = null;
export function typicalRun(o) {
  const key = originKey(o) + '|' + state.isoDay;
  applyDayType(state.isoDay);   // czekanie w opisie etapów (legsText) musi pasować do typu dnia
  if (typicalCache && typicalCache.key === key) return typicalCache.r;
  const r = runIsoWalk(o, REACH_T);
  typicalCache = { key, r };
  return r;
}
export function setIsoT(T) {
  if (!state.iso) return;
  state.iso.T = T;
  state.iso.bands = isoBands(T);
  if (state.iso.walk && isoLayer && isoLayer.redraw) isoLayer.redraw(); else drawIso();
  renderIsoChip();
}
// zmiana czasu z chipa (− / +): przerysuj, odśwież statystyki w panelu i adres
export function applyIsoT(T) {
  if (!state.iso) return;
  state.isoT = Math.max(10, Math.min(60, T));
  setIsoT(state.isoT);
  renderIsoBox();
  fitIsoView();
  syncURL(false);
}
let isoToken = 0;
export async function computeIso() {
  const o = isoOrigin();
  if (!o) return;
  // wybrana linia i podgląd zasłaniałyby obszar zasięgu
  if (state.selectedRouteKey) selectRoute(state.selectedRouteKey);
  clearPreview();
  if (WALK === null) {
    const box = document.getElementById('iso-box');
    if (box && !state.iso) box.innerHTML = '<div class="iso-card"><div class="muted">Wczytuję sieć pieszą…</div></div>';
    await loadWalk();
    if (!isoOrigin()) return;
  }
  setPicking(false);
  ensureIsoPane();
  const token = ++isoToken;
  const wasOn = !!state.iso;
  const next = await recalcIso(o, state.isoT);
  if (token !== isoToken) return;               // w międzyczasie zmieniono punkt/tryb
  state.iso = next;
  restyleStops();
  drawIso();
  renderIsoBox();
  renderTargetBox();
  fitIsoView();
  syncURL(!wasOn);
}
export function clearIso() {
  const was = !!state.iso;
  state.iso = null;
  removePointHover();
  removeIsoLayers();
  if (was) { restyleStops(); renderTargetBox(); }
  renderIsoChip();
}
// najlepszy (najszybszy) słupek o tej nazwie — czas dotarcia do przystanku
function bestLabel(ids) {
  let best = null, bid = null;
  ids.forEach(id => { const l = state.iso && state.iso.labels.get(id); if (l && l.t <= state.iso.T && (!best || l.t < best.t)) { best = l; bid = id; } });
  return best ? { id: bid, lab: best } : null;
}
export function isoLegs(id) {
  const iso = state.iso;
  if (iso.walk) return walkLegs(id, iso);
  const { legs, first } = isoLegsApprox(iso.labels, id);
  if (iso.o.point) {   // z punktu: dojście w linii prostej do przystanku startowego
    const st = STOP_BY_ID.get(first), lab = iso.labels.get(first);
    if (st && lab) legs.unshift({ walk: true, pts: [[iso.o.lat, iso.o.lon], [st.lat, st.lon]], min: lab.t });
  }
  return legs;
}
// etapy z etykiet trybu przybliżonego, od przystanku id wstecz do startowego (first)
function isoLegsApprox(labels, id) {
  const legs = [];
  let cur = id, first = id, guard = 0;
  while (cur && guard++ < 50) {
    const l = labels.get(cur);
    if (!l || l.origin) { first = cur; break; }
    legs.unshift({ ...l, at: cur });   // at = przystanek końca etapu (to = indeks w kursie)
    cur = l.prev;
  }
  return { legs, first };
}
// Etapy trasy, każdy w osobnym wierszu: "pieszo 3 min", "152 Rondo Mogilskie → Dąbie · 4 przyst., 7 min"
const lineChip = key => `<b class="leg-line">${esc(key.split('|')[0])}</b>`;
export function legsText(legs, C = state.iso) {
  const parts = [];
  const nm = id => esc(STOP_BY_ID.get(id)?.name || '');
  legs.forEach(l => {
    if (l.walk) {
      if (l.min != null && l.min < 0.5) return;               // np. przejście między słupkami tego samego węzła
      parts.push(l.min != null ? `pieszo ${Math.max(1, Math.round(l.min))} min` : 'pieszo');
    } else if (l.ride) {
      const { key } = csaRideInfo(l, C);
      const n = Math.max(1, l.pts.length - 1), ride = Math.round(l.arr - l.dep);
      parts.push(`${lineChip(key)} ${fmt(l.dep)} ${esc(STOPS[l.from].name)} → ${esc(STOPS[l.to].name)}`
        + ` <span class="leg-note">· ${n} przyst., ${ride} min${l.wait >= 1 ? `, czekasz ${Math.round(l.wait)} min` : ''}</span>`);
    } else {
      const tr = transitGraph().trips[l.ti], a = tr.s[l.from], z = tr.s[l.to];
      const ride = Math.round(z[1] - a[1]), wp = tr.waitP[l.from];
      const wait = Math.round(l.wait ?? wp);
      const refs = [tr.key, ...altLines(l)].map(lineChip).join(' / ');
      // pierwszy przejazd jest bez czekania (wychodzisz na odjazd) — przy rzadkiej linii warto wiedzieć, jak często jeździ
      const hw = 2 * wp;
      const note = l.wait === 0 ? (hw >= 20 && isFinite(hw) ? `, jedzie co ${Math.round(hw)} min` : '')
        : wait >= 1 ? ` + śr. ${wait} min czekania` : '';
      parts.push(`${refs} ${nm(a[0])} → ${nm(z[0])}`
        + ` <span class="leg-note">· ${l.to - l.from} przyst., ${ride} min${note}</span>`);
    }
  });
  return (parts.length ? parts : ['pieszo']).map(p => `<div class="leg">${p}</div>`).join('');
}
export function isoCardLine(s, sibs) {
  if (!state.iso) return '';
  const b = bestLabel([s.id, ...sibs.map(x => x.id)]);
  if (!b) return `<div class="sh-iso">Poza zasięgiem ${state.iso.T} min</div>`;
  if (b.lab.origin) {
    return state.iso.o.point ? `<div class="sh-iso"><b>${Math.max(1, Math.round(b.lab.t))} min</b> pieszo</div>`
                       : `<div class="sh-iso"><b>Start</b></div>`;
  }
  drawIsoPath(b.id);
  const legs = isoLegs(b.id), rides = legs.filter(l => !l.walk).length;
  return `<div class="sh-iso"><b>${Math.round(b.lab.t)} min</b> stąd${state.iso.csa ? ` · na miejscu ${fmt(Math.round(state.iso.csa.t0 + b.lab.t))}` : ''}`
    + (rides > 1 ? ` · ${rides - 1} ${rides - 1 === 1 ? 'przesiadka' : 'przesiadki'}` : '')
    + `<div class="sh-legs">${legsText(legs)}</div></div>`;
}
