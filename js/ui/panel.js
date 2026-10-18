import { state } from '../state.js';
import { dmy, esc, fmtDist, haversineMeters, linii, plural, przystanki, todayISO } from '../util.js';
import { WALK_SPEED, typeCmp } from '../config.js';
import { clickIcon } from '../icons.js';
import { EMPTY_HTML, announce, isMobile, panelEl, radiusInput, radiusVal, showNotice } from '../dom.js';
import { META, STOPS, STOP_INDEX, isNight, servesLine, srcGen } from '../data.js';
import { WALK, loadWalk, nearestNode } from '../walk.js';
import { walkDijkstra } from '../routing/street.js';
import { map } from '../map/view.js';
import { clearPoleLabels, drawPoleLabels, hideStopHover, highlightStops } from '../map/stops.js';
import { clearPreview } from '../map/route.js';
import { hidePointHover } from '../map/iso.js';
import { clearIso, computeIso } from '../iso.js';
import { renderIsoBox, renderIsoChip } from './iso-box.js';
import { closeRoute, renderLineDetail, selectRoute, updateBadgeSelection } from './line.js';
import { renderBoard } from './board.js';
import { dayWord, placeStatsFor, refreshPlace, renderPlaceHead } from './place.js';
import { renderTargetBox, setPicking } from './target.js';
import { rememberPlace, renderBackPlace } from './history.js';
import { syncURL } from './url.js';
import { setSheet, updateSheet } from './sheet.js';

let clickMarker = null;
// closing the place (× on phones): back to just the map
export function closePlace() {
  closeRoute();
  setPicking(false);
  state.target = null; state.targetPopOn = false;
  renderTargetBox();
  showEmpty();
  syncURL(true);
}
export function renderDataInfo() {
  const el = document.getElementById('data-info');
  if (!META || !META.calendar) { el.textContent = ''; return; }
  const days = Object.keys(META.calendar).sort();
  const first = days[0], last = days[days.length - 1], today = todayISO();
  const nNames = new Set(STOPS.map(s => s.name)).size;
  const stale = today > last;
  el.classList.toggle('stale', stale);
  el.innerHTML = (stale
      ? `<b>Rozkład jest nieaktualny</b> — obejmuje dni ${dmy(first)}–${dmy(last)}, więc pokazuję rozkład z tego samego dnia tygodnia. `
      : `Rozkład ${srcGen(META.sources)} z ${dmy(META.generated || first)}, odjazdy na dni ${dmy(first)}–${dmy(last)}. `)
    + `${nNames} ${przystanki(nNames)}.`;
}
function clearPick() {
  if (clickMarker) { map.removeLayer(clickMarker); clickMarker = null; }
  if (state.radiusCircle) { map.removeLayer(state.radiusCircle); state.radiusCircle = null; }
  clearPoleLabels();
}
// The origin pin can be dragged: dropping it = new place (an enabled reach area is recomputed)
function addOriginMarker(latlng) {
  clickMarker = L.marker(latlng, { icon: clickIcon, draggable: true, keyboard: false, title: 'Przeciągnij, żeby zmienić miejsce', bubblingMouseEvents: false }).addTo(map);
  clickMarker.on('dragstart', () => { hideStopHover(); hidePointHover(); rememberPlace(); });
  clickMarker.on('drag', e => { if (state.radiusCircle) state.radiusCircle.setLatLng(e.target.getLatLng()); });
  clickMarker.on('dragend', e => { closeRoute(); selectPoint(e.target.getLatLng(), { remembered: true }); });
}
export function selectPoint(latlng, opts = {}) {
  if (!opts.remembered) rememberPlace({ lat: latlng.lat, lon: latlng.lng });
  state.pointLabel = opts.label || null;
  state.sheetState = 'peek';
  const keepIso = !!state.iso;
  clearIso();
  showNotice('');
  state.stopMode = null;
  panelEl.classList.remove('stop-mode');
  clearPick();
  addOriginMarker(latlng);
  state.radiusCircle = L.circle(latlng, {
    radius: state.radiusMeters, color: '#c98a2c', weight: 1.5, fillColor: '#f0b862', fillOpacity: 0.12,
    interactive: false
  }).addTo(map);
  recompute(latlng);
  panelEl.scrollTop = 0;
  renderBackPlace();
  updateSheet();
  syncURL(true);
  if (keepIso) computeIso();   // reach area mode stays on — recompute from the new place
}
// Stop click: take all poles with this name within 400 m
export function selectStop(s) {
  rememberPlace({ stopId: s.id, name: s.name });
  const poles = STOPS
    .filter(x => x.name === s.name)
    .map(x => ({ ...x, dist: haversineMeters(s.lat, s.lon, x.lat, x.lon) }))
    .filter(x => x.dist <= 400)
    .sort((a, b) => a.dist - b.dist);
  state.stopMode = { id: s.id, name: s.name, lat: s.lat, lon: s.lon, poles };
  state.boardLimit = 8;
  state.sheetState = 'peek';
  state.lastOutside = null;
  showNotice('');
  state.pointReach = null;
  panelEl.classList.add('stop-mode');
  clearPick();
  addOriginMarker(L.latLng(s.lat, s.lon));
  drawPoleLabels(poles);
  state.lastNearby = poles;
  highlightStops(new Set(poles.map(x => x.id)));
  if (state.selectedRouteKey && !poles.some(x => servesLine(x, state.selectedRouteKey))) {
    selectRoute(state.selectedRouteKey);   // selecting again = deselecting a line that is not here
  }
  renderStopPanel();
  panelEl.scrollTop = 0;
  renderBackPlace();
  updateSheet();
  syncURL(true);
  if (state.iso) computeIso();   // reach area mode stays on — recompute from the new stop
}
// stats (from lineStats): frequency next to the line number; without stats — just the numbers
export function hwText(key, stats) {
  const st = stats && stats.per.get(key);
  if (!stats) return '';
  if (!st || !st.all) return 'nie kursuje';
  if (!st.maxPole) return 'rzadko';
  const h = 840 / st.maxPole;
  return h <= 90 ? `co ${Math.max(1, Math.round(h))} min` : `${st.maxPole}× w 6–20`;
}
// trains: SKA lines first, then named trains; then numbers in order
const ska = k => (k.endsWith('|train') && !/^SKA/.test(k) ? 1 : 0);
const sortRef = (a, b) => (a.split('|')[1] !== b.split('|')[1] ? typeCmp(a.split('|')[1], b.split('|')[1])
  : ska(a) - ska(b) || a.localeCompare(b, 'pl', { numeric: true }));
export function badgesHtml(stops, reach = null, stats = null) {
  const lines = new Map(), okLines = new Set();
  stops.forEach(s => s.lines.forEach(l => {
    const key = `${l.ref}|${l.type}`;
    lines.set(key, l);
    if (!reach || reach.get(s.id) !== null) okLines.add(key);
  }));
  const dw = dayWord();
  const badge = key => {
    const l = lines.get(key), off = !okLines.has(key), night = isNight(key);
    const hw = night ? '' : hwText(key, stats);
    const title = off ? `Linia ${l.ref} zatrzymuje się w okręgu tylko na przystankach, do których nie da się dojść pieszo z tego miejsca`
      : night ? `Linia nocna ${l.ref}` : hw && hw !== 'nie kursuje' && hw !== 'rzadko' ? `Linia ${l.ref}: ${hw} ${dw}, w godz. 6–20`
      : hw === 'nie kursuje' ? `Linia ${l.ref} ${dw} tu nie kursuje` : `Linia ${l.ref}`;
    return `<span class="badge ${l.type}${off ? ' unreach' : ''}${night ? ' night' : ''}${hw === 'nie kursuje' ? ' off' : ''}" role="button" tabindex="0" data-key="${esc(key)}" title="${esc(title)}">`
      + `${esc(l.ref)}${hw ? `<span class="hw">${hw}</span>` : ''}</span>`;
  };
  const keys = [...lines.keys()].sort(sortRef);
  const day = keys.filter(k => !isNight(k)), night = keys.filter(isNight);
  const group = (label, ks) => ks.length
    ? `<div class="group-label">${label}</div><div class="badges">${ks.map(badge).join('')}</div>` : '';
  const html = group('Pociągi', day.filter(k => k.endsWith('|train'))) + group('Tramwaje', day.filter(k => k.endsWith('|tram')))
    + group('Autobusy', day.filter(k => !k.endsWith('|tram') && !k.endsWith('|train')))
    + group('Nocne', night)
    + (stats && day.length ? `<div class="muted hw-note">Przy numerze: średnio co ile minut odjeżdża ${dw}, w godz. 6–20.</div>` : '');
  return { html, count: day.length, night: night.length };
}
// shared parts of the views: the point's „Dojazdy” tab and the line list with the selected line's details
const PLACE_BOXES = '<div id="target-box"></div><div id="place-card"></div><div id="iso-box"></div>';
const linesPane = b => `<div id="lines-box">${b.html}</div><div id="line-detail"></div>`;
// panel content below the title; `tabbed` = with tabs (on phones)
function showResults(html, tabbed) {
  const results = document.getElementById('results');
  results.innerHTML = html;
  results.classList.toggle('tabbed', tabbed);
}
// Stop view: departures first (that is why one clicks a stop), then lines and travel to targets
function renderStopPanel() {
  clearPreview();
  const { name, poles } = state.stopMode;
  const b = badgesHtml(poles);
  document.getElementById('panel-title').textContent = name;
  document.getElementById('panel-sub').textContent = `${b.count} ${linii(b.count)}`
    + (b.night ? ` · do tego ${b.night} ${plural(b.night, 'nocna', 'nocne', 'nocnych')}` : '');
  showResults(tabsHtml('stop', [['odjazdy', 'Odjazdy'], ['linie', `Linie · ${b.count}`], ['dojazdy', 'Dojazdy']])
    + tabPane('stop', 'odjazdy', '<div id="target-box"></div>'
      + `<button type="button" class="link-btn" data-around="1">Pokaż linie w promieniu ${state.radiusMeters} m od tego przystanku</button>`
      + '<div id="iso-box"></div>'
      + '<div class="ld-sec"><h3>Najbliższe odjazdy</h3><div id="board"><div class="muted">Wczytuję…</div></div></div>')
    + tabPane('stop', 'linie', linesPane(b))
    + tabPane('stop', 'dojazdy', '<div id="place-card" style="margin-top:16px"></div>'), true);
  renderIsoBox();
  updateBadgeSelection();
  renderLineDetail();
  renderBoard();
  announce();
  refreshPlace();
}
export function showEmpty() {
  clearIso();
  clearPick();
  state.stopMode = null;
  state.lastNearby = [];
  state.pointReach = null;
  highlightStops(new Set());
  state.lastOutside = null;
  panelEl.classList.remove('stop-mode');
  document.getElementById('panel-title').textContent = isMobile() ? 'Stuknij dowolne miejsce na mapie' : 'Wybierz miejsce na mapie';
  document.getElementById('panel-sub').textContent = '';
  document.getElementById('results').innerHTML = EMPTY_HTML;
  document.getElementById('results').classList.remove('tabbed');
  renderPlaceHead();
  showNotice('');
  renderIsoChip();
  renderBackPlace();
  announce();
}
// Walking along streets from the nearest walk network node, up to `limit` minutes
function walkFromNode(nn, limit) {
  return walkDijkstra([{ v: nn.node, t: nn.d / WALK_SPEED }], limit, { walkOnly: true });
}
// walk (m) to a stop from the walkFromNode result: null = not reachable, undefined = stop outside the walk network
function walkToStop(r, id) {
  const k = STOP_INDEX().get(id), sn = WALK.snapNode[k];
  if (sn < 0) return undefined;
  const t = r.time[sn];
  return isFinite(t) ? t * WALK_SPEED + WALK.snapLen[k] : null;
}
// Whether a stop inside the circle is reachable on foot from the marked point (along streets from walk.bin).
// Limit: 2.5 × the radius of walking — beyond that it is "the long way round across half the municipality", treated as unreachable.
function computePointReach(latlng, nearby) {
  if (!WALK) return null;
  const nn = nearestNode(latlng.lat, latlng.lng);
  if (!nn) return null;
  const r = walkFromNode(nn, (state.radiusMeters * 2.5 + nn.d) / WALK_SPEED);
  const out = new Map();
  nearby.forEach(st => {
    const w = walkToStop(r, st.id);
    out.set(st.id, w === undefined ? st.dist * 1.3 : w);      // stop outside the network: approximation
  });
  return out;
}
function recompute(latlng) {
  const nearby = STOPS
    .map(s => ({...s, dist: haversineMeters(latlng.lat, latlng.lng, s.lat, s.lon)}))
    .filter(s => s.dist <= state.radiusMeters)
    .sort((a, b) => a.dist - b.dist);

  state.lastNearby = nearby;
  state.pointReach = computePointReach(latlng, nearby);
  if (WALK === null && META && META.walk) {
    // the walk network loads in the background; once loaded, recompute the same point
    loadWalk().then(() => { if (!state.stopMode && state.radiusCircle && state.radiusCircle.getLatLng().equals(latlng)) recompute(latlng); });
  }
  const unreach = new Set(state.pointReach ? nearby.filter(s => state.pointReach.get(s.id) === null).map(s => s.id) : []);
  highlightStops(new Set(nearby.map(s => s.id)), unreach);

  renderPanel(nearby);
}
// Panel tabs (shown only on phones; on desktop all parts are stacked, in the same order)
const ptab = { point: 'dojazdy', stop: 'odjazdy' };
function tabsHtml(kind, tabs) {
  if (!tabs.some(([id]) => id === ptab[kind])) ptab[kind] = tabs[0][0];
  return '<div class="ptabs" role="tablist" aria-label="Części panelu">' + tabs.map(([id, label]) =>
    `<button type="button" role="tab" data-ptab="${id}" class="${id === ptab[kind] ? 'on' : ''}" aria-selected="${id === ptab[kind]}">${label}</button>`).join('') + '</div>';
}
const tabPane = (kind, id, inner) => `<div class="tabp${ptab[kind] === id ? ' on' : ''}" data-tab="${id}">${inner}</div>`;
export function pickTab(id) {
  ptab[state.stopMode ? 'stop' : 'point'] = id;
  document.querySelectorAll('.ptabs [data-ptab]').forEach(b => { const on = b.dataset.ptab === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
  document.querySelectorAll('#results .tabp').forEach(el => el.classList.toggle('on', el.dataset.tab === id));
  if (isMobile()) {
    if (state.sheetState === 'peek') setSheet('full');
    const tabs = document.querySelector('.ptabs');
    if (tabs && panelEl.scrollTop > tabs.offsetTop - 26) panelEl.scrollTop = tabs.offsetTop - 26;
  }
}
// Empty circle — no dead end: nearest stops outside the circle + travel to targets still works
function renderNoStopsPanel(title, sub) {
  const near = nearestOutside(state.radiusCircle.getLatLng());
  state.lastOutside = near;
  title.textContent = `Brak przystanków w promieniu ${state.radiusMeters} m`;
  sub.textContent = near.length ? `Najbliższy: ${near[0].name}, ${fmtDist(near[0].walk ?? near[0].dist)}${near[0].walk != null ? ' pieszo' : ''}.`
    : 'W okolicy nie ma żadnego przystanku.';
  let html = PLACE_BOXES;
  if (near.length) {
    const need = Math.min(2000, Math.ceil((near[0].dist + 50) / 100) * 100);
    html += `<div class="group-label">Najbliższe przystanki</div><div class="stop-list near-list">` + near.map(g =>
      `<div class="stop-item clickable" role="button" tabindex="0" data-stop-id="${esc(g.id)}" title="Pokaż odjazdy z tego przystanku">`
      + `<div class="si-top"><b>${esc(g.name)}</b><span class="si-dist">${g.walk != null ? fmtDist(g.walk) + ' pieszo' : fmtDist(g.dist)}</span></div>`
      + `<div class="si-meta">${Math.round(g.dist)} m w linii prostej</div></div>`).join('') + '</div>'
      + (need > state.radiusMeters ? `<button type="button" class="link-btn" style="margin-top:8px" data-radius-to="${need}">Pokaż linie w promieniu ${need} m</button>` : '');
  }
  showResults(html, false);
  renderIsoBox();
}
// One entry per stop name (ZTP has a separate pole for each direction/platform): {id, name, dist, count, walk}
// walk: meters on foot (id = pole with the shortest walk), null = not reachable, undefined = not computed
function stopGroups(nearby) {
  const byName = new Map();
  nearby.forEach(s => {
    const g = byName.get(s.name);
    const wm = state.pointReach ? state.pointReach.get(s.id) : undefined;
    if (g) {
      g.count++;
      if (wm != null && (g.walk == null || wm < g.walk)) { g.walk = wm; g.id = s.id; }
    } else byName.set(s.name, { id: s.id, name: s.name, dist: s.dist, count: 1, walk: wm });
  });
  // order: shortest walk (if known), unreachable stops last
  const sortKey = g => g.walk === null ? Infinity : g.walk != null ? g.walk : g.dist;
  return [...byName.values()].sort((a, b) => sortKey(a) - sortKey(b) || a.dist - b.dist);
}
// „Przystanki” tab: name + walking distance (column); below it the straight-line distance
function stopListHtml(groups) {
  const nUn = groups.filter(g => g.walk === null).length;
  let html = '<div class="group-label" style="margin-top:14px">Przystanki</div>';
  if (nUn) html += `<div class="unreach-note"><i></i>${nUn} ${przystanki(nUn)} w okręgu bez dojścia pieszo z tego miejsca (np. za rzeką albo torami).</div>`;
  return html + '<div class="stop-list">' + groups.map(g => {
    const un = g.walk === null, known = g.walk != null;
    const right = un ? '' : known ? `${fmtDist(g.walk)} pieszo` : `${Math.round(g.dist)} m`;
    const meta = un ? `<em>brak dojścia pieszo</em> · ${Math.round(g.dist)} m w linii prostej`
      : known ? `${Math.round(g.dist)} m w linii prostej` : '';
    return `<div class="stop-item clickable${un ? ' unreach' : ''}" role="button" tabindex="0" data-stop-id="${esc(g.id)}"`
      + ` title="${un ? 'Nie da się tu dojść pieszo z zaznaczonego miejsca' : 'Pokaż odjazdy z tego przystanku'}">`
      + `<div class="si-top"><b>${esc(g.name)}</b><span class="si-dist">${right}</span></div>`
      + (meta ? `<div class="si-meta">${meta}</div>` : '') + '</div>';
  }).join('') + '</div>';
}
// Point view: title with the number of lines, tabs Dojazdy / Linie / Przystanki
function renderPanel(nearby) {
  clearPreview();
  const title = document.getElementById('panel-title');
  const sub = document.getElementById('panel-sub');
  state.lastOutside = null;
  if (nearby.length === 0) renderNoStopsPanel(title, sub);
  else {
    const b = badgesHtml(nearby, state.pointReach, placeStatsFor(nearby));
    title.textContent = `${b.count} ${linii(b.count)} w pobliżu`;
    const nNames = new Set(nearby.map(s => s.name)).size;
    sub.textContent = `${nNames} ${przystanki(nNames)} w promieniu ${state.radiusMeters} m`
      + (b.night ? ` · do tego ${b.night} ${plural(b.night, 'linia nocna', 'linie nocne', 'linii nocnych')}` : '') + '.';
    showResults(tabsHtml('point', [['dojazdy', 'Dojazdy'], ['linie', `Linie · ${b.count}`], ['przystanki', `Przystanki · ${nNames}`]])
      + tabPane('point', 'dojazdy', PLACE_BOXES)
      + tabPane('point', 'linie', linesPane(b))
      + tabPane('point', 'przystanki', stopListHtml(stopGroups(nearby))), true);
    updateBadgeSelection();
    renderLineDetail();
    renderIsoBox();
  }
  announce();
  refreshPlace();
}
// Nearest stops (by name) when there are none in the circle: walk along streets, if the walk network is there
function nearestOutside(c) {
  const cand = STOPS.map(s => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, dist: haversineMeters(c.lat, c.lng, s.lat, s.lon) }))
    .filter(s => s.dist <= 3000).sort((a, b) => a.dist - b.dist).slice(0, 60);
  let r = null;
  if (WALK) { const nn = nearestNode(c.lat, c.lng); if (nn) r = walkFromNode(nn, 45); }
  const byName = new Map();
  cand.forEach(s => {
    const walk = r ? walkToStop(r, s.id) ?? null : null;
    const key = walk ?? s.dist * 1.3, g = byName.get(s.name);
    if (!g || key < g.key) byName.set(s.name, { ...s, walk, key });
  });
  return [...byName.values()].sort((a, b) => a.key - b.key).slice(0, 3);
}
// radius buttons on phones (300 m / 500 m / 1 km / 2 km)
export function syncRseg() {
  document.querySelectorAll('.rseg [data-r]').forEach(b => {
    const on = +b.dataset.r === state.radiusMeters;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}
export function setRadius(m, fromSlider) {
  state.radiusMeters = Math.min(2000, Math.max(200, Math.round(m / 100) * 100));
  if (!fromSlider) radiusInput.value = state.radiusMeters;
  radiusVal.textContent = state.radiusMeters + ' m';
  syncRseg();
  if (state.radiusCircle && !state.stopMode) {
    state.radiusCircle.setRadius(state.radiusMeters);
    recompute(state.radiusCircle.getLatLng());   // the radius only changes the line list; the reach area and travel times stay the same
    syncURL(false);
  }
}
