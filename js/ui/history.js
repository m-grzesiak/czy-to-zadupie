import { state } from '../state.js';
import { esc, haversineMeters } from '../util.js';
import { STOP_BY_ID } from '../data.js';
import { panToVisible, viewBounds } from '../map/view.js';
import { selectRoute } from './line.js';
import { selectPoint, selectStop } from './panel.js';
import { nearestStopName } from './target.js';

// ---------------------------------------------------------------------------
// Poprzednie miejsca startu: „← Wróć do: …” nad tytułem panelu. Przy porównywaniu dwóch okolic
// (tu 39 min, tam 24 min) wystarczy jedno kliknięcie. Zasięg i cel zostają.
// ---------------------------------------------------------------------------
const placeHist = [];
function currentPlace() {
  if (state.stopMode) return { stopId: state.stopMode.id, lat: state.stopMode.lat, lon: state.stopMode.lon, name: state.stopMode.name };
  if (state.radiusCircle) {
    const c = state.radiusCircle.getLatLng();
    if (state.pointLabel) return { lat: c.lat, lon: c.lng, name: state.pointLabel, label: state.pointLabel };
    const n = nearestStopName(c.lat, c.lng);
    return { lat: c.lat, lon: c.lng, name: n ? `okolice: ${n}` : 'poprzednie miejsce' };
  }
  return null;
}
const samePlaceRec = (a, b) => !!(a && b) && (a.stopId && b.stopId ? a.stopId === b.stopId || a.name === b.name
  : a.stopId || b.stopId ? false : haversineMeters(a.lat, a.lon, b.lat, b.lon) < 15);
// next = miejsce, które zaraz zostanie wybrane (to samo miejsce nie trafia do historii)
export function rememberPlace(next) {
  if (state.applyingState || state.restoringPlace) return;
  const cur = currentPlace();
  if (!cur || (next && samePlaceRec(cur, next))) return;
  if (samePlaceRec(placeHist[placeHist.length - 1], cur)) return;
  placeHist.push(cur);
  if (placeHist.length > 20) placeHist.shift();
}
export function renderBackPlace() {
  const el = document.getElementById('back-place');
  if (!el) return;
  const cur = currentPlace();
  while (placeHist.length && samePlaceRec(placeHist[placeHist.length - 1], cur)) placeHist.pop();
  const prev = placeHist[placeHist.length - 1];
  el.hidden = !prev;
  el.innerHTML = prev ? `<span aria-hidden="true">←</span><span>Wróć do: <b>${esc(prev.name)}</b></span>` : '';
  el.title = prev ? 'Poprzednie miejsce startu (zasięg i cel zostają)' : '';
}
function backToPlace() {
  const p = placeHist.pop();
  if (!p) return;
  const st = p.stopId && STOP_BY_ID.get(p.stopId);
  state.restoringPlace = true;
  try {
    if (state.selectedRouteKey) selectRoute(state.selectedRouteKey);
    if (st) selectStop(st); else selectPoint(L.latLng(p.lat, p.lon), { label: p.label });
  } finally { state.restoringPlace = false; }
  renderBackPlace();
  if (!viewBounds(0.15).contains([p.lat, p.lon])) panToVisible(L.latLng(p.lat, p.lon));
}
document.getElementById('back-place').addEventListener('click', backToPlace);
