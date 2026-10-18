import { state } from '../state.js';
import { nowMinutes, todayISO } from '../util.js';
import { STOP_BY_ID } from '../data.js';
import { routeTo } from '../routing/street.js';
import { locateMe, setViewVisible } from '../map/view.js';
import { hideListStop, hideStopHover, hotPole, showListStop, stopHoverOn } from '../map/stops.js';
import { clearPreview, showPreview, styleVariants } from '../map/route.js';
import { clearIsoPath, drawLegs } from '../map/iso.js';
import { clearIso, computeIso } from '../iso.js';
import { renderIsoBox } from './iso-box.js';
import { detailToken, pickDir, renderLdPane, renderLineDetail, selectRoute, setLdTab } from './line.js';
import { closePlace, pickTab, selectPoint, selectStop, setRadius } from './panel.js';
import { renderBoard } from './board.js';
import { destById, removeMyPlace, setDayType } from './place.js';
import { clearTarget, renderTargetBox, saveTargetAsPlace, setPicking, setTarget, targetAsOrigin, targetCtx } from './target.js';
import { syncURL } from './url.js';

document.getElementById('results').addEventListener('click', (e) => {
  const loc = e.target.closest('[data-locate]');
  if (loc) { locateMe(loc); return; }
  const tb = e.target.closest('[data-ptab]');
  if (tb) { pickTab(tb.dataset.ptab); return; }
  if (e.target.closest('[data-line-close]')) { if (state.selectedRouteKey) selectRoute(state.selectedRouteKey); return; }
  const dirB = e.target.closest('[data-dir]');
  if (dirB) { pickDir(dirB.dataset.dir); return; }
  const ldt = e.target.closest('[data-ldtab]');
  if (ldt) { setLdTab(ldt.dataset.ldtab); return; }
  const kb = e.target.closest('[data-kurs]');
  if (kb) {
    state.ldKurs = +kb.dataset.kurs;
    document.querySelectorAll('.ld-nt').forEach(b => { const on = b === kb; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    if (state.ldTab !== 'trasa') setLdTab('trasa'); else renderLdPane(detailToken);
    return;
  }
  if (e.target.closest('[data-ld-before]')) { state.ldBefore = true; renderLdPane(detailToken); return; }
  if (e.target.closest('[data-ld-early]')) { state.ldEarly = true; renderLdPane(detailToken); return; }
  const ex = e.target.closest('[data-example]');
  if (ex) { const [la, lo] = ex.dataset.example.split(',').map(Number); const ll = L.latLng(la, lo); selectPoint(ll); setViewVisible(ll, 15); return; }
  const del = e.target.closest('[data-place-del]');
  if (del) { e.stopPropagation(); removeMyPlace(+del.dataset.placeDel); return; }
  const dst = e.target.closest('[data-dest]');
  if (dst) { const d = destById(dst.dataset.dest); if (d) setTarget(d.lat, d.lon, d.name, true); return; }
  if (e.target.closest('[data-pick-target]')) { setPicking(!state.pickingTarget); return; }
  if (e.target.closest('[data-target-clear]')) { clearTarget(); return; }
  if (e.target.closest('[data-target-origin]')) { targetAsOrigin(); return; }
  if (e.target.closest('[data-target-save]')) { renderTargetBox(true); return; }
  if (e.target.closest('[data-target-save-ok]')) { saveTargetAsPlace(); return; }
  if (e.target.closest('[data-target-save-cancel]')) { renderTargetBox(false); return; }
  const grow = e.target.closest('[data-radius-to]');
  if (grow) { setRadius(+grow.dataset.radiusTo); return; }
  const im = e.target.closest('[data-iso-mode]');
  if (im) {
    state.isoMode = im.dataset.isoMode;
    if (state.isoMode === 'time') { state.isoDate = state.isoDate || todayISO(); if (state.isoTime == null) state.isoTime = nowMinutes(); }
    computeIso(); return;
  }
  const idy = e.target.closest('[data-iso-day]');
  if (idy) { setDayType(idy.dataset.isoDay); return; }
  const idt = e.target.closest('[data-iso-date]');
  if (idt) { state.isoDate = idt.dataset.isoDate; computeIso(); return; }
  const inow = e.target.closest('[data-iso-now]');
  if (inow) { state.isoDate = todayISO(); state.isoTime = nowMinutes(); computeIso(); return; }
  const igo = e.target.closest('[data-iso-goto]');
  if (igo) { const [d, m] = igo.dataset.isoGoto.split(','); state.isoDate = d; state.isoTime = +m; computeIso(); return; }
  const iat = e.target.closest('[data-iso-at]');
  if (iat) { state.isoTime = +iat.dataset.isoAt; computeIso(); return; }
  const isoBtn = e.target.closest('[data-iso]');
  if (isoBtn) {
    if (isoBtn.dataset.iso === 'on') computeIso().then(() => document.querySelector('#iso-box .iso-row')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    else { clearIso(); renderIsoBox(); syncURL(true); }
    return;
  }
  if (e.target.closest('[data-board-more]')) { state.boardLimit = Math.max(state.boardLimit, 8) + 16; renderBoard(); return; }
  const around = e.target.closest('[data-around]');
  if (around && state.stopMode) { const { lat, lon } = state.stopMode; selectPoint(L.latLng(lat, lon)); return; }
  const stopEl = e.target.closest('[data-stop-id]');
  if (stopEl) { const st = STOP_BY_ID.get(stopEl.dataset.stopId); hideListStop(); if (st) selectStop(st); return; }
  const lineEl = e.target.closest('[data-line]');
  if (lineEl) {
    const k = lineEl.dataset.line;
    if (state.selectedRouteKey !== k) selectRoute(k);
    document.getElementById('line-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const day = e.target.closest('[data-day]');
  if (day) { state.selectedDay = day.dataset.day; state.ldEarly = false; renderLdPane(detailToken); return; }
  const v = e.target.closest('[data-variant]');
  if (v) { state.selectedVariant = +v.dataset.variant; state.ldBefore = false; styleVariants(); renderLineDetail(); return; }
  const badge = e.target.closest('.badges .badge');
  if (!badge) return;
  selectRoute(badge.dataset.key);
});
const HOVER_SEL = '.badges .badge, .dep-row';
document.getElementById('results').addEventListener('mouseover', (e) => {
  const el = e.target.closest(HOVER_SEL);
  if (el) { showPreview(el.dataset.key || el.dataset.line); hotPole(el.dataset.pole); }
});
document.getElementById('results').addEventListener('mouseout', (e) => {
  const el = e.target.closest(HOVER_SEL);
  if (el && !el.contains(e.relatedTarget)) { clearPreview(); hotPole(null); }
});
document.getElementById('results').addEventListener('focusin', (e) => {
  const el = e.target.closest(HOVER_SEL);
  if (el) { showPreview(el.dataset.key || el.dataset.line); hotPole(el.dataset.pole); }
});
document.getElementById('results').addEventListener('focusout', () => { clearPreview(); hideStopHover(); hotPole(null); });
document.getElementById('results').addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-stop-id]');
  if (el) showListStop(el.dataset.stopId);
});
document.getElementById('results').addEventListener('mouseout', (e) => {
  const el = e.target.closest('[data-stop-id]');
  if (el && !el.contains(e.relatedTarget)) hideListStop();
});
document.getElementById('results').addEventListener('focusin', (e) => {
  const el = e.target.closest('[data-stop-id]');
  if (el) showListStop(el.dataset.stopId);
});
document.getElementById('results').addEventListener('keydown', (e) => {
  if (e.target.id === 'place-name' && e.key === 'Enter') { e.preventDefault(); saveTargetAsPlace(); return; }
  if (e.target.id === 'place-name' && e.key === 'Escape') { e.stopPropagation(); renderTargetBox(false); return; }
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (e.target.matches('.badges .badge')) { e.preventDefault(); selectRoute(e.target.dataset.key); }
  else if (e.target.matches('[data-stop-id], [data-line], [data-dest]')) { e.preventDefault(); e.target.click(); }});
document.getElementById('results').addEventListener('change', (e) => {
  if (e.target.id === 'day-type') setDayType(e.target.value);
});
// najechanie na cel z listy: trasa na mapie (bez zmiany wybranego celu)
document.getElementById('results').addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-dest]');
  if (!el) return;
  const d = destById(el.dataset.dest), C = targetCtx();
  if (!d || !C) return;
  const r = routeTo(C, d.lat, d.lon);
  if (r && r.legs) drawLegs(r.legs, null, C);
});
document.getElementById('results').addEventListener('mouseout', (e) => {
  const el = e.target.closest('[data-dest]');
  if (el && !el.contains(e.relatedTarget) && !stopHoverOn) clearIsoPath();
});
document.querySelector('.rseg').addEventListener('click', e => {
  const b = e.target.closest('[data-r]');
  if (b) setRadius(+b.dataset.r);
});
// Esc: kolejno anuluje wskazywanie celu, cel, linię, mapę zasięgu
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || (e.target.matches && e.target.matches('input[type=text], input[type=search], input[type=time], select, textarea'))) return;
  if (state.pickingTarget) setPicking(false);
  else if (state.target) clearTarget();
  else if (state.selectedRouteKey) selectRoute(state.selectedRouteKey);
  else if (state.iso) { clearIso(); renderIsoBox(); syncURL(true); }
  else return;
  e.preventDefault();
});
document.getElementById('m-back').addEventListener('click', () => {
  if (state.selectedRouteKey) selectRoute(state.selectedRouteKey);
  else if (state.iso) { clearIso(); renderIsoBox(); syncURL(true); }
  else closePlace();
});
