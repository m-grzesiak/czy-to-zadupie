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
// stan arkusza na telefonie: 'peek' (niski) albo 'full' (rozwinięty)
export function setSheet(st) {
  if (st === 'peek') panelEl.scrollTop = 0;
  state.sheetState = st;
  updateSheet();
}
// klasy stanu na #app / #panel / #layout i przycisk #m-back według bieżącego widoku
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
  // lewy górny róg mapy: × zamyka miejsce, z linii / zasięgu „← Okolica” (albo „← Przystanek”) wraca
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
    // po zmianie wysokości arkusza: miejsce, trasa albo zasięg mają być w widocznej części mapy
    if (!first && isMobile()) { clearTimeout(revealTimer); revealTimer = setTimeout(revealFocus, 280); }
  }
}
// ile pikseli mapy od dołu zasłania arkusz (na komputerze 0). Dla „peek” i „full” docelowa wysokość
// z CSS (46% / całość bez 68 px), a nie chwilowa — w trakcie animacji arkusza wysokość jest pośrednia.
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
// przyciski na górze mapy (telefon) zasłaniają pas tej wysokości
export const topUi = () => isMobile() ? 64 : 0;
// --sheet-h podnosi legendę, atrybucję i + − nad arkusz
export function setSheetVar() { layoutEl.style.setProperty('--sheet-h', sheetPx() + 'px'); }
// po zmianie wysokości arkusza: wybrana linia, zasięg, cel albo miejsce wraca do widocznej części mapy
function revealFocus() {
  if (!map || !isMobile()) return;
  setSheetVar();
  if (state.selectedRouteKey) { fitRouteView(); return; }
  if (state.iso) { fitIsoView(); return; }
  if (state.target) { fitTargetView(0.05, 50); return; }
  const o = isoOrigin();
  if (o && !viewBounds(0.12).contains([o.lat, o.lon])) panToVisible(L.latLng(o.lat, o.lon));
}
// telefon: uchwyt arkusza (stuknięcie) i przesunięcie palcem w górę / w dół
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
