import { state } from '../state.js';
import { dayChipLabel, esc, fmt, haversineMeters, nextDays, plural, zaMin } from '../util.js';
import { DAY_NAMES, DAY_SHORT, TRANSFER_MIN, WALK_MAX } from '../config.js';
import { CHIP_MINUS, CHIP_PLUS, CHIP_X, ISO_ICON } from '../icons.js';
import { COARSE } from '../dom.js';
import { STOP_BY_ID, STOP_INDEX, forEachDep, hasHeadways, loadCellsFor, profileFor } from '../data.js';
import { WALK } from '../walk.js';
import { timeModeAvailable } from '../routing/csa.js';
import { fitIsoView } from '../map/iso.js';
import { applyIsoT, clearIso, computeIso, isoOrigin, setIsoT } from '../iso.js';
import { syncURL } from './url.js';
import { updateSheet } from './sheet.js';

// ---------------------------------------------------------------------------
// Reach area chip on the map (top-right corner). Off: „◎ Zasięg 20 min” turns the reach area on.
// On: day type / time, − 20 min +, ✕ (turns off, like Esc). Visible without scrolling the panel,
// so it is always clear that a map click shows the travel time (popup), not just selects a place.
// ---------------------------------------------------------------------------
let isoChipEl = null;
export const IsoChip = L.Control.extend({
  options: { position: 'topright' },
  onAdd() {
    const el = L.DomUtil.create('div', 'iso-chip');
    el.hidden = true;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
    el.addEventListener('click', onIsoChip);
    isoChipEl = el;
    return el;
  },
});
export function renderIsoChip() {
  updateSheet();
  const el = isoChipEl;
  if (!el) return;
  const o = state.iso ? state.iso.o : isoOrigin();
  if (!o || !hasHeadways()) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.classList.toggle('on', !!state.iso);
  if (!state.iso) {
    el.innerHTML = `<button type="button" data-chip="on" title="Pokaż, gdzie dojedziesz w ${state.isoT} min">${ISO_ICON}Zasięg ${state.isoT} min</button>`;
    return;
  }
  const ctx = state.iso.mode === 'time' ? `wyjście ${fmt(state.isoTime)}` : DAY_SHORT[state.isoDay] || '';
  el.innerHTML = `<button type="button" data-chip="edit" title="Ustawienia zasięgu w panelu">${ISO_ICON}<span class="ic-ctx">${esc(ctx)}</span></button>`
    + `<button type="button" class="ic-step" data-chip="-" aria-label="Krócej o 5 min"${state.iso.T <= 10 ? ' disabled' : ''}>${CHIP_MINUS}</button>`
    + `<span class="ic-t" aria-live="polite">${state.iso.T} min</span>`
    + `<button type="button" class="ic-step" data-chip="+" aria-label="Dłużej o 5 min"${state.iso.T >= 60 ? ' disabled' : ''}>${CHIP_PLUS}</button>`
    + `<i class="ic-sep" aria-hidden="true"></i>`
    + `<button type="button" class="ic-x" data-chip="off" title="Wyłącz zasięg (Esc)" aria-label="Wyłącz zasięg">${CHIP_X}</button>`;
}
function onIsoChip(e) {
  // the chip redraws during the click; without this Leaflet does not see the click was in the control and sets a target
  L.DomEvent.stopPropagation(e);
  const b = e.target.closest('[data-chip]');
  if (!b || b.disabled) return;
  const a = b.dataset.chip;
  if (a === 'on') computeIso();
  else if (a === 'off') turnOffIso();
  else if (a === '-' || a === '+') applyIsoT((state.iso ? state.iso.T : state.isoT) + (a === '+' ? 5 : -5));
  else if (a === 'edit') document.getElementById('iso-box')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
// turns off the reach area (✕ on the chip, „Wyłącz”, Esc, ← on phones)
export function turnOffIso() {
  clearIso();
  renderIsoBox();
  syncURL(true);
}

// stops (by name) reached within time T, excluding the origin stop itself
function isoReached(o) {
  const bestByName = new Map();
  state.iso.labels.forEach((l, id) => {
    if (l.t > state.iso.T) return;
    const st = STOP_BY_ID.get(id);
    const cur = bestByName.get(st.name);
    if (!cur || l.t < cur.t) bestByName.set(st.name, { t: l.t, id, st });
  });
  return [...bestByName.values()].filter(x => !(state.iso.labels.get(x.id).origin && !o.point));
}
// whether anything runs at all (otherwise "dojdziesz pieszo")
function isoAnyRide(reached) {
  if (state.iso.mode === 'time') return state.iso.rides > 0;
  if (state.iso.walk) return reached.some(x => state.iso.res.kind[WALK.N + STOP_INDEX().get(x.id)] === 3);
  return reached.some(x => state.iso.labels.get(x.id).ti != null);
}
// farthest reached stop in a straight line
function farthestText(o, reached) {
  if (!reached.length) return '—';
  const d = reached.reduce((a, x) => Math.max(a, haversineMeters(o.lat, o.lon, x.st.lat, x.st.lon)), 0);
  return (d / 1000).toLocaleString('pl', { maximumFractionDigits: 1 }) + ' km';
}
// mode switch (typical day / depart at time)
function isoModeHtml(tm) {
  if (!timeModeAvailable() || !WALK) return '';
  return `<div class="seg" role="group" aria-label="Tryb">
      <button type="button" class="${tm ? '' : 'on'}" data-iso-mode="typical">Typowy dzień</button>
      <button type="button" class="${tm ? 'on' : ''}" data-iso-mode="time">Wyjazd o godzinie</button></div>`;
}
// mode parameters: departure day and time, or day type
function isoParamsHtml(tm) {
  if (!tm) {
    return '<div class="chips">' + Object.entries(DAY_NAMES).map(([k, v]) =>
      `<button type="button" class="chip${k === state.isoDay ? ' on' : ''}" data-iso-day="${k}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('') + '</div>';
  }
  const hh = String(Math.floor(state.isoTime / 60) % 24).padStart(2, '0'), mm = String(state.isoTime % 60).padStart(2, '0');
  return '<div class="chips">' + nextDays().map((d, i) =>
    `<button type="button" class="chip${d === state.isoDate ? ' on' : ''}" data-iso-date="${d}">${dayChipLabel(d, i)}</button>`).join('') + '</div>'
    + `<div class="iso-when"><label for="iso-time">Wyjście o</label><input type="time" id="iso-time" value="${hh}:${mm}" step="60">`
    + `<button type="button" class="link-btn" data-iso-now="1">teraz</button></div>`;
}
function isoNote(tm) {
  return tm
    ? `Prawdziwe odjazdy z rozkładu${state.iso.csa && state.iso.csa.approx ? ` (brak danych na ten dzień — rozkład z ${state.iso.csa.approx})` : ''}, ${TRANSFER_MIN} min zapasu na przesiadkę, dojście i przesiadki pieszo po ulicach z OpenStreetMap, 4,5 km/h. Bez korków i opóźnień.`
    : `Typowy dzień (${DAY_NAMES[state.isoDay]}), 6:00–20:00. Wliczam średnie czekanie na przystanku (połowa odstępu kursów)${WALK ? ', dojście i przesiadki pieszo po ulicach i ścieżkach z OpenStreetMap, 4,5 km/h' : ` i przesiadki pieszo do ${WALK_MAX} m, w przybliżeniu (linia prosta × 1,3)`}.`;
}
// band legend: list with stop counts (desktop) and the .iso-ramp bar (phone, fixed-height sheet)
function isoLegendHtml(reached) {
  const bands = state.iso.bands;
  const counts = bands.map(b => reached.filter(x => x.t >= b.lo && x.t < b.hi).length);
  counts[counts.length - 1] += reached.filter(x => x.t === state.iso.T).length;
  return `<div class="iso-legend">${bands.map((b, i) =>
      `<i style="background:${b.color}"></i><span>${b.lo}–${b.hi} min</span><span>${counts[i]} przyst.</span>`).join('')}</div>
    <div class="iso-ramp" aria-hidden="true"><div class="ir-bar">${bands.map(b => `<i style="background:${b.color}"></i>`).join('')}</div>
      <div class="ir-lab"><span>0</span>${bands.map((b, i) => `<span>${b.hi}${i === bands.length - 1 ? ' min' : ''}</span>`).join('')}</div></div>`;
}
// time slider and departure time field
function bindIsoInputs() {
  const inp = document.getElementById('iso-t');
  let raf = 0;
  inp.addEventListener('input', () => {
    state.isoT = +inp.value;
    inp.nextElementSibling.textContent = state.isoT + ' min';
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => setIsoT(state.isoT));
  });
  // after releasing the slider: recompute immediately (without waiting for a frame) and refresh the stats
  inp.addEventListener('change', () => {
    cancelAnimationFrame(raf);
    state.isoT = +inp.value;
    setIsoT(state.isoT);
    renderIsoBox();
    fitIsoView();
    syncURL(false);
    document.getElementById('iso-t')?.focus();
  });
  const ti = document.getElementById('iso-time');
  if (ti) ti.addEventListener('change', () => {
    const [h, m] = ti.value.split(':').map(Number);
    if (Number.isFinite(h) && Number.isFinite(m)) { state.isoTime = h * 60 + m; computeIso(); }
  });
}
export function renderIsoBox() {
  renderIsoChip();
  const box = document.getElementById('iso-box');
  if (!box) return;
  const o = state.iso ? state.iso.o : isoOrigin();
  if (!o || !hasHeadways()) { box.innerHTML = ''; return; }
  if (!state.iso) {
    box.innerHTML = `<button type="button" class="iso-start" data-iso="on">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".6"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/></svg>
      Gdzie dojadę w ${state.isoT} min${o.point ? ' stąd' : ''}?</button>`;
    return;
  }
  if (!o.poles.length && !(state.iso.walk && o.point)) {
    box.innerHTML = `<div class="iso-card"><div class="iso-top"><h3>Zasięg</h3><button type="button" class="link-btn" data-iso="off">Wyłącz</button></div>
      <div class="muted" style="margin-top:6px">W odległości ${o.walkMax / 1000} km od tego miejsca nie ma żadnego przystanku.</div></div>`;
    return;
  }
  const reached = isoReached(o);
  const tm = state.iso.mode === 'time';
  const noRide = tm && state.iso.rides === 0;   // nothing departs within the limit: show the next departure
  box.innerHTML = `<div class="iso-card">
    <div class="iso-top"><h3>Zasięg ${o.point ? 'z zaznaczonego miejsca' : `z przystanku ${esc(o.name)}`}</h3><button type="button" class="link-btn" data-iso="off" title="Wyłącz zasięg (Esc)">Wyłącz</button></div>
    ${isoModeHtml(tm)}${isoParamsHtml(tm)}
    <div class="iso-row"><label for="iso-t">Czas</label><input type="range" id="iso-t" min="10" max="60" step="5" value="${state.iso.T}"><b>${state.iso.T} min</b></div>
    <div class="iso-sum">${isoAnyRide(reached) ? 'Dojedziesz' : 'Dojdziesz pieszo'} do <b>${reached.length}</b> ${plural(reached.length, 'przystanku', 'przystanków', 'przystanków')}, najdalej ${farthestText(o, reached)} w linii prostej.</div>
    ${noRide ? '<div class="iso-next" id="iso-next">Sprawdzam najbliższy odjazd…</div>' : ''}
    ${isoLegendHtml(reached)}
    <div class="iso-tip">Stuknij miejsce na mapie — pokażę czas i trasę.</div>
    <div class="iso-next iso-hint" style="margin:10px 0 0"><b>Kliknij miejsce na mapie</b> — pokażę czas i trasę${COARSE ? '' : ' (albo tylko najedź kursorem)'}, a „Sprawdź to miejsce” w dymku zrobi z niego nowy start. Zasięg zostaje włączony.</div>
    <div class="muted" style="margin-top:10px">${isoNote(tm)}</div>
  </div>`;
  bindIsoInputs();
  if (noRide) fillNextDeparture(o);
}
// when nothing departs within the time limit: the next departure from the origin stops (from deps/)
async function fillNextDeparture(o) {
  const el0 = document.getElementById('iso-next');
  if (!el0 || !state.iso || !state.iso.csa) return;
  const prof = profileFor(state.isoDate);
  const starts = o.point
    ? o.poles.filter(p => p.tw != null && p.tw <= 20).map(p => ({ st: STOP_BY_ID.get(p.id), tw: p.tw }))
    : o.poles.map(p => ({ st: STOP_BY_ID.get(p.id), tw: 0 }));
  if (!starts.length || !prof) { el0.textContent = 'Z tego miejsca nie da się dojść pieszo do żadnego przystanku.'; return; }
  const cells = await loadCellsFor(starts.map(x => x.st));
  // first departure in profile `p` you can catch leaving at `from` (walk to the stop `tw`)
  const firstDep = (p, from, date) => {
    let best = null;
    starts.forEach(({ st, tw }) => forEachDep([st], cells, p, (m, key, h) => {
      if (m >= from + tw && (!best || m < best.m)) best = { m, key, h, name: st.name, tw, date };
    }));
    return best;
  };
  let best = firstDep(prof.p, state.isoTime);
  const el = document.getElementById('iso-next');
  if (!el) return;
  if (best) {
    const at = Math.max(0, Math.round(best.m - best.tw - 2));
    el.innerHTML = `W ciągu ${state.iso.T} min nic stąd nie odjeżdża. <b>Najbliższy odjazd: ${esc(best.key.split('|')[0])} o ${fmt(best.m)}</b>`
      + ` (${zaMin(best.m - state.isoTime)}) z ${esc(best.name)} → ${esc(best.h)}. <button type="button" class="link-btn" data-iso-at="${at}">Wyjdź o ${fmt(at)}</button>`;
    return;
  }
  // following days (up to a week): first departure of the day
  const days = nextDays(8, state.isoDate).slice(1);
  for (const date of days) {
    const pr = profileFor(date);
    if (pr && (best = firstDep(pr.p, 0, date))) break;
  }
  if (!best) { el.innerHTML = '<b>Stąd w najbliższym tygodniu nic nie odjeżdża.</b>'; return; }
  const i = days.indexOf(best.date) + 1;   // days from the selected date
  const dayLabel = i === 1 ? 'jutro' : dayChipLabel(best.date, i);
  const at = Math.max(0, Math.round(best.m - best.tw - 2));
  el.innerHTML = `<b>Tego dnia stąd już nic nie odjeżdża.</b> Najbliższy odjazd: ${dayLabel}, <b>${esc(best.key.split('|')[0])} o ${fmt(best.m)}</b>`
    + ` z ${esc(best.name)} → ${esc(best.h)}. <button type="button" class="link-btn" data-iso-goto="${best.date},${at}">Pokaż ${dayLabel} od ${fmt(at)}</button>`;
}
