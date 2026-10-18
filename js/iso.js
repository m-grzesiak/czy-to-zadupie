import { state } from './state.js';
import { esc, fmt, haversineMeters, nowMinutes, przesiadki, todayISO } from './util.js';
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
// Typical day from a given place (up to REACH_T min). Shared by the reach area map and the destination list,
// so turning on the reach area after picking a place computes nothing more. We keep the last result.
let typicalCache = null;
export function typicalRun(o) {
  const key = originKey(o) + '|' + state.isoDay;
  applyDayType(state.isoDay);   // waits in the leg description (legsText) must match the day type
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
// time change from the chip (− / +): redraw, refresh panel stats and the URL
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
  // the selected line and preview would cover the reach area
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
  if (token !== isoToken) return;               // point/mode changed in the meantime
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
// best (fastest) pole with this name = arrival time at the stop
function bestLabel(ids) {
  let best = null, bid = null;
  ids.forEach(id => { const l = state.iso && state.iso.labels.get(id); if (l && l.t <= state.iso.T && (!best || l.t < best.t)) { best = l; bid = id; } });
  return best ? { id: bid, lab: best } : null;
}
export function isoLegs(id) {
  const iso = state.iso;
  if (iso.walk) return walkLegs(id, iso);
  const { legs, first } = isoLegsApprox(iso.labels, id);
  if (iso.o.point) {   // from a point: straight-line walk to the starting stop
    const st = STOP_BY_ID.get(first), lab = iso.labels.get(first);
    if (st && lab) legs.unshift({ walk: true, pts: [[iso.o.lat, iso.o.lon], [st.lat, st.lon]], min: lab.t });
  }
  return legs;
}
// legs from approximate-mode labels, from stop id back to the starting one (first)
function isoLegsApprox(labels, id) {
  const legs = [];
  let cur = id, first = id, guard = 0;
  while (cur && guard++ < 50) {
    const l = labels.get(cur);
    if (!l || l.origin) { first = cur; break; }
    legs.unshift({ ...l, at: cur });   // at = stop at the end of the leg (to = index in the trip)
    cur = l.prev;
  }
  return { legs, first };
}
// Route legs, one per line: "pieszo 3 min", "152 Rondo Mogilskie → Dąbie · 4 przyst., 7 min"
const lineChip = key => `<b class="leg-line">${esc(key.split('|')[0])}</b>`;
export function legsText(legs, C) {
  const parts = [];
  const nm = id => esc(STOP_BY_ID.get(id)?.name || '');
  legs.forEach(l => {
    if (l.walk) {
      if (l.min != null && l.min < 0.5) return;               // e.g. a walk between poles at the same node
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
      // the first ride has no wait (you leave for a departure); for an infrequent line it helps to know how often it runs
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
    + (rides > 1 ? ` · ${przesiadki(rides - 1)}` : '')
    + `<div class="sh-legs">${legsText(legs, state.iso)}</div></div>`;
}
