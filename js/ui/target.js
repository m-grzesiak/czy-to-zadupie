import { state } from '../state.js';
import { esc, fmt, haversineMeters, przesiadki } from '../util.js';
import { DAY_NAMES, DESTS, ISO_TMAX, REACH_T } from '../config.js';
import { targetIcon } from '../icons.js';
import { isMobile, showNotice } from '../dom.js';
import { STOPS, STOP_BY_ID } from '../data.js';
import { WALK } from '../walk.js';
import { routeTo } from '../routing/street.js';
import { fitPad, map, viewBounds } from '../map/view.js';
import { hidePointHover, legLayers } from '../map/iso.js';
import { isoOrigin, legsText, originKey } from '../iso.js';
import { closeRoute } from './line.js';
import { selectPoint, selectStop } from './panel.js';
import { myPlaces, renderPlaceCard, samePlace, saveMyPlaces } from './place.js';
import { syncURL } from './url.js';

// ---------------------------------------------------------------------------
// Trip target: map click (in reach area mode or after "Wskaż cel"), list row or link (#cel=).
// Route computed from the reach area map if it is on (also "depart at time"), otherwise from the typical day.
// ---------------------------------------------------------------------------
let targetLayer = null;
export const targetClickMode = () => state.pickingTarget || !!state.iso;
export function targetCtx() {
  if (state.iso && state.iso.walk) return state.iso;
  const o = isoOrigin();
  return state.reach && o && state.reach.day === state.isoDay && originKey(state.reach.o) === originKey(o) ? state.reach : null;
}
export function setPicking(on) {
  if (state.pickingTarget === !!on) return;
  state.pickingTarget = !!on;
  if (map) map.getContainer().classList.toggle('picking', state.pickingTarget);
  showNotice(state.pickingTarget ? 'Kliknij cel podróży na mapie albo przystanek. Esc anuluje.' : '');
  renderPlaceCard();
}
export function nearestStopName(lat, lon) {
  let best = null;
  STOPS.forEach(s => { const d = haversineMeters(lat, lon, s.lat, s.lon); if (d < 600 && (!best || d < best.d)) best = { d, s }; });
  return best ? best.s.name : null;
}
// place name without a label: „okolice: <nearest stop>”, and far from stops `fallback`
export function placeLabel(lat, lon, fallback) {
  const n = nearestStopName(lat, lon);
  return n ? `okolice: ${n}` : fallback;
}
// origin and target together in the visible part of the map (without zooming in); margin = padding at the edge
export function fitTargetView(margin, pad) {
  const o = isoOrigin();
  const b = L.latLngBounds([[state.target.lat, state.target.lon]].concat(o ? [[o.lat, o.lon]] : []));
  if (!viewBounds(margin).contains(b)) map.fitBounds(b, { ...fitPad(pad), maxZoom: map.getZoom() });
}
// time limit up to which the route is computed (reach area „o godzinie” or typical day)
const horizonOf = C => C && C.mode === 'time' ? ISO_TMAX : REACH_T;
const minutes = t => Math.max(1, Math.round(t));
const checkLabel = () => state.target.stopId ? 'Sprawdź ten przystanek' : 'Sprawdź to miejsce';
// opts.pop = popup at the target (map click), opts.stopId = the target is a stop ("Sprawdź" opens the stop)
export function setTarget(lat, lon, label, fromList, opts = {}) {
  const mine = myPlaces.find(p => samePlace(p, { lat, lon })) || DESTS.find(p => samePlace(p, { lat, lon }));
  state.target = { lat, lon, label: label || (mine && mine.name) || null, stopId: opts.stopId || null };
  state.targetPopOn = !!opts.pop;
  setPicking(false);
  renderTargetBox();
  renderPlaceCard();
  syncURL(true);
  fitTargetView(0.1, 60);
  if (!state.targetPopOn) document.getElementById('target-box')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
// The target becomes the new origin (the reach area stays on). A stop opens as a stop.
export function targetAsOrigin() {
  if (!state.target) return;
  const t = state.target, st = t.stopId && STOP_BY_ID.get(t.stopId);
  clearTarget();
  closeRoute();
  if (st) selectStop(st); else selectPoint(L.latLng(t.lat, t.lon));
}
export function clearTarget() {
  state.target = null;
  state.targetPopOn = false;
  renderTargetBox();
  renderPlaceCard();
  syncURL(true);
}
function drawTarget(r, C) {
  if (targetLayer) { map.removeLayer(targetLayer); targetLayer = null; }
  if (!state.target || !map) return;
  const ok = r && r.legs && isFinite(r.t);
  const parts = ok ? legLayers(r.legs, null, C) : [];
  const pin = L.marker([state.target.lat, state.target.lon], { icon: targetIcon, interactive: false, keyboard: false, zIndexOffset: 500 });
  // travel time right at the pin — visible without searching the panel
  if (r) pin.bindTooltip(ok ? `${minutes(r.t)} min` : `> ${horizonOf(C)} min`,
    { permanent: true, direction: 'right', offset: [12, -18], className: 'term-label tgt-time' });
  parts.push(pin);
  targetLayer = L.layerGroup(parts).addTo(map);
}
// Popup at the target (after a map click): travel time and "Sprawdź to miejsce" = new origin with one click.
// This way a map click with the reach area on is not a puzzle (target or new place?) — we ask on the spot.
export let targetPop = null;
let targetPopSync = false;
function renderTargetPop(r, C, name) {
  const want = state.targetPopOn && state.target && map && isoOrigin();
  if (!want) { closeTargetPop(); return; }
  const horizon = horizonOf(C);
  let head;
  if (!C) head = '<span>Liczę trasę…</span>';
  else if (!r || !isFinite(r.t)) head = `<b>ponad ${horizon} min</b>`;
  else {
    const extra = [];
    if (r.rides > 1) extra.push(przesiadki(r.rides - 1));
    else if (r.rides === 1) extra.push(esc(r.lines[0].ref));
    if (!r.rides) extra.push('pieszo');
    head = `<b>${minutes(r.t)} min</b> stąd${extra.length ? ` <span>· ${extra.join(' · ')}</span>` : ''}`;
  }
  const html = `<div class="tp-t">${head}</div><div class="tp-name">${esc(name)}</div>
    <button type="button" class="tp-go" data-pop-origin="1">${checkLabel()}</button>`;
  if (!targetPop) {
    // on phones the popup is hidden (the target is shown by the card in the sheet), so no panning the map under it
    targetPop = L.popup({ className: 'target-pop', offset: [0, -30], autoPan: !isMobile(), autoPanPadding: [40, 40], maxWidth: 260, closeOnEscapeKey: false });
    targetPop.on('remove', () => {
      map.getContainer().classList.remove('tpop-open');
      if (!targetPopSync) state.targetPopOn = false;   // closed by the user (×) — the target stays
    });
    // listener on the popup itself: the button vanishes during the click, the click must not reach the map
    targetPop.on('add', () => {
      const el = targetPop.getElement();
      if (!el || el._tpBound) return;
      el._tpBound = true;
      el.addEventListener('click', e => {
        if (!e.target.closest('[data-pop-origin]')) return;
        L.DomEvent.stopPropagation(e);
        targetAsOrigin();
      });
    });
  }
  hidePointHover();
  targetPopSync = true;
  const moved = !targetPop.isOpen() || !targetPop.getLatLng() || !targetPop.getLatLng().equals(L.latLng(state.target.lat, state.target.lon));
  targetPop.setLatLng([state.target.lat, state.target.lon]).setContent(html);
  if (!targetPop.isOpen()) targetPop.openOn(map); else if (moved) targetPop.update();
  targetPopSync = false;
  map.getContainer().classList.add('tpop-open');
}
function closeTargetPop() {
  if (!targetPop || !targetPop.isOpen()) return;
  targetPopSync = true;
  map.closePopup(targetPop);
  targetPopSync = false;
}
export function renderTargetBox(saving = false) {
  const el = document.getElementById('target-box');
  if (!state.target) { drawTarget(); closeTargetPop(); if (el) el.innerHTML = ''; return; }
  const C = targetCtx(), o = isoOrigin();
  const r = C && o ? routeTo(C, state.target.lat, state.target.lon) : null;
  drawTarget(r, C);
  const name = state.target.label || placeLabel(state.target.lat, state.target.lon, 'wskazane miejsce');
  renderTargetPop(r, C, name);
  if (!el) return;
  let body;
  const horizon = horizonOf(C);
  if (!o) body = '<div class="muted">Wybierz miejsce startu na mapie.</div>';
  else if (!C) body = `<div class="muted">${WALK === false ? 'Trasy wymagają sieci pieszej (walk.bin).' : 'Liczę trasę…'}</div>`;
  else if (!r || !isFinite(r.t)) body = `<div class="tb-time">ponad ${horizon} min</div><div class="muted">W ${horizon} min stąd tam nie dojedziesz${C.mode === 'time' ? ' o tej godzinie' : ''}.</div>`;
  else {
    const extra = [];
    if (C.csa) extra.push(`na miejscu ${fmt(Math.round(C.csa.t0 + r.t))}`);
    if (r.rides > 1) extra.push(przesiadki(r.rides - 1));
    if (!r.rides) extra.push('pieszo');
    body = `<div class="tb-time">${minutes(r.t)} min${extra.length ? ` <span>· ${extra.join(' · ')}</span>` : ''}</div>`
      + `<div class="sh-legs">${legsText(r.legs, C)}</div>`
      + `<div class="muted" style="margin-top:4px">${C.mode === 'time' ? `Wyjazd ${fmt(C.csa.t0)}, prawdziwe odjazdy.` : `Typowy ${DAY_NAMES[state.isoDay]}, ze średnim czekaniem.`}</div>`;
  }
  const saved = myPlaces.some(p => samePlace(p, state.target));
  const actions = saving
    ? `<input id="place-name" type="text" maxlength="40" value="${esc(state.target.label || nearestStopName(state.target.lat, state.target.lon) || '')}" placeholder="Nazwa, np. Praca" aria-label="Nazwa miejsca">
       <button type="button" class="chip on" data-target-save-ok="1">Zapisz</button><button type="button" class="link-btn" data-target-save-cancel="1">Anuluj</button>`
    : (saved ? '' : '<button type="button" class="link-btn" data-target-save="1">★ Zapisz jako moje miejsce</button>')
      + (o ? `<button type="button" class="link-btn" data-target-origin="1">${checkLabel()}</button>` : '');
  el.innerHTML = `<div class="target-box">
    <div class="tb-top"><div class="tb-name">Cel: <b>${esc(name)}</b></div><button type="button" class="link-btn" data-target-clear="1" aria-label="Usuń cel">Usuń cel</button></div>
    ${body}<div class="tb-actions">${actions}</div></div>`;
  if (saving) { const inp = document.getElementById('place-name'); inp.focus(); inp.select(); }
}
export function saveTargetAsPlace() {
  if (!state.target) return;
  const inp = document.getElementById('place-name');
  const name = (inp && inp.value.trim()) || nearestStopName(state.target.lat, state.target.lon) || 'Moje miejsce';
  myPlaces.push({ name: name.slice(0, 40), lat: +state.target.lat.toFixed(5), lon: +state.target.lon.toFixed(5) });
  saveMyPlaces();
  state.target.label = name;
  renderTargetBox(false);
  renderPlaceCard();
}
