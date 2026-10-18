import { state } from '../state.js';
import { ICON_BACK, ICON_X } from '../icons.js';
import { appEl, isMobile, layoutEl, panelEl } from '../dom.js';
import { map, panToVisible, viewBounds } from '../map/view.js';
import { fitRouteView } from '../map/route.js';
import { fitIsoView } from '../map/iso.js';
import { isoOrigin } from '../iso.js';
import { fitTargetView } from './target.js';

let sheetMode = null;
let revealTimer = 0;
// sheet state on phones: 'peek' (low) or 'full' (expanded)
export function setSheet(st) {
  if (st === 'peek') panelEl.scrollTop = 0;
  state.sheetState = st;
  updateSheet();
}
// state classes on #app / #panel / #layout and the #m-back button according to the current view
export function updateSheet() {
  const empty = !state.stopMode && !state.radiusCircle;
  const lineOpen = !empty && !!state.selectedRouteKey;
  const isoOpen = !empty && !lineOpen && !!state.iso;
  appEl.classList.toggle('st-empty', empty);
  panelEl.classList.toggle('line-open', lineOpen);
  panelEl.classList.toggle('iso-open', isoOpen);
  layoutEl.classList.toggle('sheet-peek', !empty && !isoOpen && state.sheetState === 'peek');
  layoutEl.classList.toggle('sheet-full', !empty && !isoOpen && state.sheetState === 'full');
  const tog = document.getElementById('panel-toggle');
  tog.setAttribute('aria-expanded', String(state.sheetState === 'full'));
  tog.setAttribute('aria-label', state.sheetState === 'full' ? 'Zwiń panel' : 'Rozwiń panel');
  // top-left corner of the map: × closes the place, from a line / reach area „← Okolica” (or „← Przystanek”) goes back
  const back = document.getElementById('m-back');
  const toPlace = lineOpen || isoOpen;
  back.hidden = empty;
  document.getElementById('m-search').hidden = empty;
  back.classList.toggle('x', !toPlace);
  back.innerHTML = toPlace ? `${ICON_BACK}${state.stopMode ? 'Przystanek' : 'Okolica'}` : ICON_X;
  back.setAttribute('aria-label', lineOpen ? 'Zamknij linię' : isoOpen ? 'Wyłącz zasięg' : 'Zamknij to miejsce');
  const mode = empty ? 'card' : isoOpen ? 'iso' : (lineOpen ? 'line-' : '') + state.sheetState;
  if (mode !== sheetMode) {
    const first = sheetMode === null;
    sheetMode = mode;
    // after the sheet height changes: the place, route or reach area should be in the visible part of the map
    if (!first && isMobile()) { clearTimeout(revealTimer); revealTimer = setTimeout(revealFocus, 280); }
  }
}
// how many map pixels the sheet covers from the bottom (0 on desktop). For „peek” and „full” the target height
// from CSS (46% / all but 68 px), not the momentary one — during the sheet animation the height is intermediate.
export function sheetPx() {
  if (!isMobile()) return 0;
  const a = layoutEl.getBoundingClientRect();
  if (!panelEl.classList.contains('iso-open') && !appEl.classList.contains('st-empty')) {
    if (layoutEl.classList.contains('sheet-full')) return Math.round(a.height - 68);
    if (layoutEl.classList.contains('sheet-peek')) return Math.round(a.height * 0.46);
  }
  const p = panelEl.getBoundingClientRect();
  return Math.max(0, Math.round(a.bottom - p.top));
}
// the buttons at the top of the map (phone) cover a strip of this height
export const topUi = () => isMobile() ? 64 : 0;
// --sheet-h lifts the legend, attribution and + − above the sheet
export function setSheetVar() { layoutEl.style.setProperty('--sheet-h', sheetPx() + 'px'); }
// after the sheet height changes: the selected line, reach area, target or place returns to the visible part of the map
function revealFocus() {
  if (!map || !isMobile()) return;
  setSheetVar();
  if (state.selectedRouteKey) { fitRouteView(); return; }
  if (state.iso) { fitIsoView(); return; }
  if (state.target) { fitTargetView(0.05, 50); return; }
  const o = isoOrigin();
  if (o && !viewBounds(0.12).contains([o.lat, o.lon])) panToVisible(L.latLng(o.lat, o.lon));
}
// phone: sheet handle (tap) and finger swipe up / down
document.getElementById('panel-toggle').addEventListener('click', () => setSheet(state.sheetState === 'full' ? 'peek' : 'full'));
let touchY0 = null;
let touchScroll0 = 0;
panelEl.addEventListener('touchstart', e => {
  if (!isMobile() || e.touches.length !== 1) { touchY0 = null; return; }
  touchY0 = e.touches[0].clientY;
  touchScroll0 = panelEl.scrollTop;
}, { passive: true });
panelEl.addEventListener('touchend', e => {
  if (touchY0 == null) return;
  const dy = e.changedTouches[0].clientY - touchY0;
  touchY0 = null;
  if (appEl.classList.contains('st-empty') || appEl.classList.contains('search-open') || panelEl.classList.contains('iso-open')) return;
  if (dy < -40 && state.sheetState === 'peek') setSheet('full');
  else if (dy > 50 && state.sheetState === 'full' && touchScroll0 <= 0 && panelEl.scrollTop <= 0) setSheet('peek');
}, { passive: true });
new ResizeObserver(setSheetVar).observe(panelEl);
