import { state } from '../state.js';
import { nowMinutes, todayISO } from '../util.js';
import { STOP_BY_ID } from '../data.js';
import { routeTo } from '../routing/street.js';
import { locateMe, setViewVisible } from '../map/view.js';
import { hideListStop, hideStopHover, hotPole, showListStop, stopHoverOn } from '../map/stops.js';
import { clearPreview, showPreview, styleVariants } from '../map/route.js';
import { clearIsoPath, drawLegs } from '../map/iso.js';
import { computeIso } from '../iso.js';
import { turnOffIso } from './iso-box.js';
import { closeRoute, detailToken, pickDir, renderLdPane, renderLineDetail, selectRoute, setLdTab } from './line.js';
import { closePlace, pickTab, selectPoint, selectStop, setRadius } from './panel.js';
import { renderBoard } from './board.js';
import { destById, removeMyPlace, setDayType } from './place.js';
import { clearTarget, renderTargetBox, saveTargetAsPlace, setPicking, setTarget, targetAsOrigin, targetCtx } from './target.js';

const results = document.getElementById('results');

// change of the „wyjazd o godzinie” (depart at time) settings and reach area recomputation
function setIsoTime(patch) {
  Object.assign(state, patch);
  computeIso();
}
function pickKurs(kb) {
  state.ldKurs = +kb.dataset.kurs;
  document.querySelectorAll('.ld-nt').forEach(b => { const on = b === kb; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  if (state.ldTab !== 'trasa') setLdTab('trasa'); else renderLdPane(detailToken);
}
function pickIsoMode(mode) {
  state.isoMode = mode;
  if (mode === 'time') { state.isoDate = state.isoDate || todayISO(); if (state.isoTime == null) state.isoTime = nowMinutes(); }
  computeIso();
}
function isoButton(on) {
  if (on) computeIso().then(() => document.querySelector('#iso-box .iso-row')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  else turnOffIso();
}
function openLine(k) {
  if (state.selectedRouteKey !== k) selectRoute(k);
  document.getElementById('line-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------------------------------------------------------------------
// Panel clicks: [selector, action(element, event)]. The first matching entry wins
// (e.target.closest), so order matters — e.g. [data-place-del] sits inside [data-dest].
// An action that returns false did not handle the click, and further entries are checked.
// ---------------------------------------------------------------------------
const CLICK_ACTIONS = [
  ['[data-locate]', el => locateMe(el)],
  ['[data-ptab]', el => pickTab(el.dataset.ptab)],
  // line details
  ['[data-line-close]', () => closeRoute()],
  ['[data-dir]', el => pickDir(el.dataset.dir)],
  ['[data-ldtab]', el => setLdTab(el.dataset.ldtab)],
  ['[data-kurs]', pickKurs],
  ['[data-ld-before]', () => { state.ldBefore = true; renderLdPane(detailToken); }],
  ['[data-ld-early]', () => { state.ldEarly = true; renderLdPane(detailToken); }],
  // empty panel: example places
  ['[data-example]', el => { const [la, lo] = el.dataset.example.split(',').map(Number); const ll = L.latLng(la, lo); selectPoint(ll); setViewVisible(ll, 15); }],
  // trip targets and my places
  ['[data-place-del]', (el, e) => { e.stopPropagation(); removeMyPlace(+el.dataset.placeDel); }],
  ['[data-dest]', el => { const d = destById(el.dataset.dest); if (d) setTarget(d.lat, d.lon, d.name, true); }],
  ['[data-pick-target]', () => setPicking(!state.pickingTarget)],
  ['[data-target-clear]', () => clearTarget()],
  ['[data-target-origin]', () => targetAsOrigin()],
  ['[data-target-save]', () => renderTargetBox(true)],
  ['[data-target-save-ok]', () => saveTargetAsPlace()],
  ['[data-target-save-cancel]', () => renderTargetBox(false)],
  ['[data-radius-to]', el => setRadius(+el.dataset.radiusTo)],
  // reach area map
  ['[data-iso-mode]', el => pickIsoMode(el.dataset.isoMode)],
  ['[data-iso-day]', el => setDayType(el.dataset.isoDay)],
  ['[data-iso-date]', el => setIsoTime({ isoDate: el.dataset.isoDate })],
  ['[data-iso-now]', () => setIsoTime({ isoDate: todayISO(), isoTime: nowMinutes() })],
  ['[data-iso-goto]', el => { const [d, m] = el.dataset.isoGoto.split(','); setIsoTime({ isoDate: d, isoTime: +m }); }],
  ['[data-iso-at]', el => setIsoTime({ isoTime: +el.dataset.isoAt })],
  ['[data-iso]', el => isoButton(el.dataset.iso === 'on')],
  // stop, stop lists and line lists
  ['[data-board-more]', () => { state.boardLimit = Math.max(state.boardLimit, 8) + 16; renderBoard(); }],
  ['[data-around]', () => {
    if (!state.stopMode) return false;
    const { lat, lon } = state.stopMode;
    selectPoint(L.latLng(lat, lon));
  }],
  ['[data-stop-id]', el => { const st = STOP_BY_ID.get(el.dataset.stopId); hideListStop(); if (st) selectStop(st); }],
  ['[data-line]', el => openLine(el.dataset.line)],
  ['[data-day]', el => { state.selectedDay = el.dataset.day; state.ldEarly = false; renderLdPane(detailToken); }],
  ['[data-variant]', el => { state.selectedVariant = +el.dataset.variant; state.ldBefore = false; styleVariants(); renderLineDetail(); }],
  ['.badges .badge', el => selectRoute(el.dataset.key)],
];
results.addEventListener('click', (e) => {
  for (const [sel, run] of CLICK_ACTIONS) {
    const el = e.target.closest(sel);
    if (el && run(el, e) !== false) return;
  }
});

// ---------------------------------------------------------------------------
// Hovering (and keyboard focus on) panel elements: preview on the map.
// enter on mouseover (and focusin when focus), leave on mouseout outside the element.
// ---------------------------------------------------------------------------
const HOVERS = [
  // line number or departure row: line route and pole
  { sel: '.badges .badge, .dep-row', focus: true,
    enter: el => { showPreview(el.dataset.key || el.dataset.line); hotPole(el.dataset.pole); },
    leave: () => { clearPreview(); hotPole(null); } },
  // stop from a list: marker on the map
  { sel: '[data-stop-id]', focus: true,
    enter: el => showListStop(el.dataset.stopId),
    leave: () => hideListStop() },
  // target from a list: route on the map (without changing the selected target)
  { sel: '[data-dest]',
    enter: el => {
      const d = destById(el.dataset.dest), C = targetCtx();
      if (!d || !C) return;
      const r = routeTo(C, d.lat, d.lon);
      if (r && r.legs) drawLegs(r.legs, null, C);
    },
    leave: () => { if (!stopHoverOn) clearIsoPath(); } },
];
function hoverEnter(e, focus) {
  HOVERS.forEach(h => {
    if (focus && !h.focus) return;
    const el = e.target.closest(h.sel);
    if (el) h.enter(el);
  });
}
results.addEventListener('mouseover', e => hoverEnter(e, false));
results.addEventListener('focusin', e => hoverEnter(e, true));
results.addEventListener('mouseout', (e) => {
  HOVERS.forEach(h => {
    const el = e.target.closest(h.sel);
    if (el && !el.contains(e.relatedTarget)) h.leave(el);
  });
});
results.addEventListener('focusout', () => { clearPreview(); hideStopHover(); hotPole(null); });

results.addEventListener('keydown', (e) => {
  // name field for „Zapisz jako moje miejsce”
  if (e.target.id === 'place-name' && e.key === 'Enter') { e.preventDefault(); saveTargetAsPlace(); return; }
  if (e.target.id === 'place-name' && e.key === 'Escape') { e.stopPropagation(); renderTargetBox(false); return; }
  // Enter / space on elements with tabindex acts like a click
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (e.target.matches('.badges .badge')) { e.preventDefault(); selectRoute(e.target.dataset.key); }
  else if (e.target.matches('[data-stop-id], [data-line], [data-dest]')) { e.preventDefault(); e.target.click(); }
});
results.addEventListener('change', (e) => {
  if (e.target.id === 'day-type') setDayType(e.target.value);
});
document.querySelector('.rseg').addEventListener('click', e => {
  const b = e.target.closest('[data-r]');
  if (b) setRadius(+b.dataset.r);
});
// Esc: cancels in turn target picking, the target, the line, the reach area map
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || (e.target.matches && e.target.matches('input[type=text], input[type=search], input[type=time], select, textarea'))) return;
  if (state.pickingTarget) setPicking(false);
  else if (state.target) clearTarget();
  else if (state.selectedRouteKey) closeRoute();
  else if (state.iso) turnOffIso();
  else return;
  e.preventDefault();
});
// phone: × closes the place, from a line / reach area „← Okolica” returns to the place
document.getElementById('m-back').addEventListener('click', () => {
  if (state.selectedRouteKey) closeRoute();
  else if (state.iso) turnOffIso();
  else closePlace();
});
