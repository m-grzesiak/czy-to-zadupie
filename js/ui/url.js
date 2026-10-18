import { state } from '../state.js';
import { fmt } from '../util.js';
import { DAY_NAMES } from '../config.js';
import { radiusInput, radiusVal } from '../dom.js';
import { ROUTES, STOP_BY_ID } from '../data.js';
import { map, setViewVisible, viewBounds } from '../map/view.js';
import { hideStopHover } from '../map/stops.js';
import { clearIso, computeIso } from '../iso.js';
import { closeRoute, selectRoute } from './line.js';
import { selectPoint, selectStop, showEmpty, syncRseg } from './panel.js';
import { renderTargetBox } from './target.js';

// ---------------------------------------------------------------------------
// Stan w adresie strony (#s=przystanek, #p=punkt&r=promień, l=linia, iso=minuty…):
// link da się udostępnić, a "Wstecz" w przeglądarce wraca do poprzedniego widoku.
// ---------------------------------------------------------------------------
let syncTimer = 0;
let syncPush = false;
function stateHash() {
  const p = new URLSearchParams();
  if (state.stopMode) p.set('s', state.stopMode.id);
  else if (state.radiusCircle) {
    const c = state.radiusCircle.getLatLng();
    p.set('p', `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`);
    p.set('r', state.radiusMeters);
  }
  if (state.iso) {
    p.set('iso', state.iso.T);
    if (state.iso.mode === 'time') { p.set('d', state.isoDate); p.set('t', fmt(state.isoTime)); } else p.set('dzien', state.isoDay);
  } else if (state.selectedRouteKey) p.set('l', state.selectedRouteKey);
  if (!state.iso && state.isoDay !== 'w' && (state.stopMode || state.radiusCircle)) p.set('dzien', state.isoDay);
  if (state.target) p.set('cel', `${state.target.lat.toFixed(5)},${state.target.lon.toFixed(5)}`);
  const s = p.toString().replace(/%2C/g, ',').replace(/%3A/g, ':').replace(/%7C/g, '|');   // czytelniejszy adres
  return s ? '#' + s : '';
}
// push = nowy wpis w historii (nowy widok), inaczej podmiana (zmiana parametru)
export function syncURL(push) {
  if (state.applyingState) return;
  syncPush = syncPush || push;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const h = stateHash();
    if (h !== location.hash) history[syncPush ? 'pushState' : 'replaceState'](null, '', h || location.pathname + location.search);
    syncPush = false;
  }, 0);
}
export async function applyState() {
  const p = new URLSearchParams(location.hash.slice(1));
  state.applyingState = true;
  try {
    clearIso();
    hideStopHover();
    closeRoute();
    const day = DAY_NAMES[p.get('dzien')] ? p.get('dzien') : null;
    state.isoDay = day || 'w';
    // cel przed miejscem startu, żeby od razu policzyć do niego trasę
    const cel = (p.get('cel') || '').split(',').map(Number);
    if (cel.length === 2 && cel.every(Number.isFinite)) {
      if (!state.target || Math.abs(state.target.lat - cel[0]) > 1e-5 || Math.abs(state.target.lon - cel[1]) > 1e-5) state.target = { lat: cel[0], lon: cel[1], label: null };
    } else state.target = null;
    state.targetPopOn = false;   // po „Wstecz” / z linku: cel bez dymka
    // widok: miejsce ma być wyraźnie w środku mapy, nie przy krawędzi
    const reveal = ll => { if (!viewBounds(0.2).contains(ll)) setViewVisible(ll, Math.max(map.getZoom(), 15)); };
    const s = p.get('s') && STOP_BY_ID.get(p.get('s'));
    const pt = (p.get('p') || '').split(',').map(Number);
    if (s) {
      selectStop(s);
      reveal(L.latLng(s.lat, s.lon));
    } else if (pt.length === 2 && pt.every(Number.isFinite)) {
      const r = +p.get('r');
      if (r >= 200 && r <= 2000) {
        state.radiusMeters = Math.round(r / 100) * 100;
        radiusInput.value = state.radiusMeters;
        radiusVal.textContent = state.radiusMeters + ' m';
        syncRseg();
      }
      const ll = L.latLng(pt[0], pt[1]);
      selectPoint(ll);
      reveal(ll);
    } else {
      showEmpty();
    }
    const l = p.get('l');
    if (l && ROUTES[l] && (s || pt.length === 2)) selectRoute(l);
    const T = +p.get('iso');
    if (T && (state.stopMode || state.radiusCircle)) {
      state.isoT = Math.min(60, Math.max(10, Math.round(T / 5) * 5));
      const d = p.get('d'), t = (p.get('t') || '').match(/^(\d{1,2}):(\d{2})$/);
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && t) {
        state.isoMode = 'time'; state.isoDate = d; state.isoTime = +t[1] * 60 + +t[2];
      } else {
        state.isoMode = 'typical';
        if (day) state.isoDay = day;
      }
      await computeIso();
    }
    renderTargetBox();
  } finally {
    state.applyingState = false;
  }
}
