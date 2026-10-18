import { state } from '../state.js';
import { esc, fmtDist, hm, linii, loadList, plural, przesiadki, saveJSON } from '../util.js';
import { DAY_NAMES, DESTS, PLACES_KEY, REACH_T, TYPE_CHIP, VERDICT, VERDICT_SCALE, WALK_SPEED } from '../config.js';
import { panelEl } from '../dom.js';
import { META, forEachDep, isNight, loadCellsFor, profileFor, repDate } from '../data.js';
import { WALK, loadWalk } from '../walk.js';
import { routeTo } from '../routing/street.js';
import { computeIso, isoOrigin, originKey, typicalRun } from '../iso.js';
import { updateBadgeSelection } from './line.js';
import { badgesHtml } from './panel.js';
import { renderTargetBox } from './target.js';
import { syncURL } from './url.js';

// day type in a sentence: „Czas dojazdu w sobotę…”
const DAY_WORD = { w: 'w dzień roboczy', s: 'w sobotę', n: 'w niedzielę' };
export const dayWord = () => DAY_WORD[state.isoDay];
const cap = s => s[0].toUpperCase() + s.slice(1);
const walkMinutes = m => Math.max(1, Math.round(m / WALK_SPEED));

// Day type (weekday / Saturday / Sunday) — shared by frequency, travel to targets and the "typical day" reach area
export function setDayType(d) {
  if (!DAY_NAMES[d] || d === state.isoDay) return;
  state.isoDay = d;
  state.reach = null; state.placeStats = null;
  if (state.iso && state.iso.mode === 'typical') computeIso();
  if (state.stopMode || state.radiusCircle) refreshPlace();
  syncURL(false);
}
export const myPlaces = loadList(PLACES_KEY, p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
export function saveMyPlaces() { saveJSON(PLACES_KEY, myPlaces); }
export function destById(id) { const n = +id.slice(1); return id[0] === 'm' ? myPlaces[n] : DESTS[n]; }
export function removeMyPlace(i) {
  myPlaces.splice(i, 1); saveMyPlaces();
  renderPlaceCard(); renderTargetBox();
}
export const samePlace = (a, b) => a && b && Math.abs(a.lat - b.lat) < 2e-5 && Math.abs(a.lon - b.lon) < 2e-5;
let placeToken = 0;
function reachFor(o) { return { o, ...typicalRun(o), walk: true, mode: 'typical', day: state.isoDay }; }
// stops reachable on foot from the marked point (without a computed walk: all of them)
const walkable = stops => stops.filter(s => !state.pointReach || state.pointReach.get(s.id) !== null);
// stops used for frequency: the selected stop or stops inside the circle reachable on foot
function placePoles() {
  return state.stopMode ? state.stopMode.poles : walkable(state.lastNearby);
}
// Departure stats from the stops (deps/) for a representative day of the given type
const statsDone = new Map();
const statsPending = new Map();
const statsKey = poles => state.isoDay + ':' + poles.map(p => p.id).sort().join(',');
export function placeStatsFor(stops) {
  return statsDone.get(statsKey(state.stopMode ? stops : walkable(stops))) || null;
}
// per: "ref|type" → {maxPole: trips 6–20 on the most served pole, all: all trips};
// first / last: first and last daytime trip, perHour: trips per hour in one direction
function computeStats(poles, cells, p) {
  const per = new Map();
  let first = Infinity, last = -Infinity, lastKey = null;
  poles.forEach(s => {
    // pole lines in data order, also those with no trips that day (order breaks ties for the „most frequent line”)
    const day = new Map();
    cells.forEach(cell => Object.keys(cell[s.id] || {}).forEach(k => {
      if (!per.has(k)) per.set(k, { maxPole: 0, all: 0 });
      day.set(k, 0);
    }));
    forEachDep([s], cells, p, (m, k) => {
      per.get(k).all++;
      if (m >= 360 && m < 1200) day.set(k, day.get(k) + 1);
      if (!isNight(k)) { if (m < first) first = m; if (m > last) { last = m; lastKey = k; } }
    });
    // the headway is taken from the stop (pole) where the line runs most often — that is one direction
    day.forEach((n, k) => { const cur = per.get(k); cur.maxPole = Math.max(cur.maxPole, n); });
  });
  // trips per hour in one direction, sum of daytime lines (the same line at several stops counts once)
  let perHour = 0;
  per.forEach((v, k) => { if (!isNight(k)) perHour += v.maxPole / 14; });
  return { per, perHour, first, last, lastKey };
}
function lineStats(poles) {
  if (!META || !META.calendar || !poles.length) return Promise.resolve(null);
  const key = statsKey(poles);
  if (statsDone.has(key)) return Promise.resolve(statsDone.get(key));
  if (statsPending.has(key)) return statsPending.get(key);
  const prof = profileFor(repDate(state.isoDay));
  const p = loadCellsFor(poles)
    .then(cells => prof ? computeStats(poles, cells, prof.p) : null)
    .then(v => { statsDone.set(key, v); statsPending.delete(key); return v; });
  statsPending.set(key, p);
  return p;
}
function applyLineStats() {
  const box = document.getElementById('lines-box');
  if (!box) return;
  const stops = state.stopMode ? state.stopMode.poles : state.lastNearby;
  if (!stops.length) return;
  box.innerHTML = badgesHtml(stops, state.stopMode ? null : state.pointReach, state.placeStats).html;
  updateBadgeSelection();
}
export function refreshPlace() {
  const token = ++placeToken;
  const o = isoOrigin();
  if (!o) return;
  const poles = placePoles();
  state.placeStats = statsDone.get(statsKey(poles)) || null;
  const fresh = state.reach && state.reach.day === state.isoDay && originKey(state.reach.o) === originKey(o);
  if (!fresh) state.reach = null;
  renderPlaceCard();
  renderTargetBox();
  const needStats = !state.placeStats && META && META.calendar && poles.length;
  if (!needStats && fresh) return;
  (async () => {
    const stP = needStats ? lineStats(poles) : null;
    if (WALK === null) await loadWalk();
    else await new Promise(r => setTimeout(r, 0));   // pin and panel on screen first, then the computation (~40 ms)
    if (token !== placeToken) return;
    if (WALK && !state.reach) state.reach = reachFor(o);
    if (stP) state.placeStats = await stP;
    if (token !== placeToken) return;
    renderPlaceCard();
    if (stP) applyLineStats();
    renderTargetBox();
  })();
}
// how many night lines run from the place's stops (those reachable on foot)
function nightCount() {
  const ks = new Set();
  placePoles().forEach(s => s.lines.forEach(l => { const k = `${l.ref}|${l.type}`; if (isNight(k)) ks.add(k); }));
  return ks.size;
}
// most frequent daytime line (most trips at one pole): {ref, every: every how many minutes} or null
function topLine(st) {
  let top = null;
  if (st) st.per.forEach((v, k) => { if (!isNight(k) && v.maxPole && (!top || v.maxPole > top.v.maxPole)) top = { k, v }; });
  return top && { ref: top.k.split('|')[0], every: Math.max(1, Math.round(840 / top.v.maxPole)) };
}
function linesChips(lines) {
  const seen = new Set();
  return lines.filter(l => { const k = l.ref + '|' + l.type; if (seen.has(k)) return false; seen.add(k); return true; })
    .map(l => `<span class="${TYPE_CHIP[l.type] || 'b'}">${esc(l.ref)}</span>`).join('');
}
function routeSummary(r) {
  if (!r || !isFinite(r.t)) return '';
  if (!r.rides) return 'pieszo';
  return linesChips(r.lines) + (r.rides > 1 ? ` · ${przesiadki(r.rides - 1)}` : '')
    + (r.walkMin >= 1 ? ` · pieszo ${Math.round(r.walkMin)} min` : '');
}
function verdictLevel(perHour, walkMin) {
  let lvl = perHour >= 30 ? 3 : perHour >= 10 ? 2 : perHour >= 3 ? 1 : 0;
  if (walkMin != null) {
    if (walkMin > 25) lvl = 0;
    else if (walkMin > 15) lvl = Math.min(lvl, 1);
    else if (walkMin > 10) lvl = Math.min(lvl, 2);
  }
  return lvl;
}
// nearest stop on foot from the marked point: {name, w (m), outside}
function nearestWalk() {
  if (state.stopMode) return null;
  let best = null;
  state.lastNearby.forEach(s => {
    const w = state.pointReach ? state.pointReach.get(s.id) : s.dist * 1.3;
    if (w != null && (!best || w < best.w)) best = { name: s.name, w };
  });
  if (!best && state.lastOutside && state.lastOutside.length) {
    const g = state.lastOutside[0];
    best = { name: g.name, w: g.walk ?? g.dist * 1.3, outside: true };
  }
  return best;
}
// „Czy to zadupie?” verdict: {lvl (0–3, or null when not yet known), verdict}
function placeVerdict(st, walkMin, noStops, hasData) {
  if (noStops) {
    if (walkMin == null || walkMin > 15) return { lvl: 0, verdict: VERDICT[0] };
    return { lvl: null, verdict: `W promieniu ${fmtDist(state.radiusMeters)} nie ma przystanku.` };
  }
  if (st) { const lvl = verdictLevel(st.perHour, walkMin); return { lvl, verdict: VERDICT[lvl] }; }
  if (hasData && !placePoles().length) { const lvl = verdictLevel(0, walkMin); return { lvl, verdict: VERDICT[lvl] }; }
  return { lvl: null, verdict: hasData ? 'Sprawdzam…' : '' };
}
const tile = (b, span, title = '') => `<div class="ph-t"${title ? ` title="${esc(title)}"` : ''}><b>${b}</b><span>${span}</span></div>`;
// three tiles under the verdict: trips per hour, walk (at a stop: most frequent line), number of lines
function headTiles(st, nw, walkMin, noStops, hasData) {
  const tiles = [];
  if (st) {
    const n = Math.round(st.perHour);
    tiles.push(st.perHour > 0 && n < 1 ? tile('&lt; 1', 'kurs na godzinę', 'W godz. 6–20, w jedną stronę')
      : tile(n, `${plural(n, 'kurs', 'kursy', 'kursów')} na godzinę`, 'W godz. 6–20, w jedną stronę, suma linii dziennych'));
  } else tiles.push(tile(noStops ? '0' : hasData ? '…' : '—', 'kursów na godzinę'));
  if (state.stopMode) {
    const top = topLine(st);
    tiles.push(top ? tile(`co ${top.every} min`, `najczęściej linia ${esc(top.ref)}`)
      : tile(st || !hasData ? '—' : '…', 'najczęstsza linia'));
  } else {
    tiles.push(walkMin != null ? tile(`${walkMin} min`, 'pieszo do przystanku', nw ? `${nw.name}, ${fmtDist(nw.w)}` : '') : tile('—', 'pieszo do przystanku'));
  }
  // lines (as in the title: all in the circle / at the stop), night ones separately
  const keys = new Set();
  (state.stopMode ? state.stopMode.poles : state.lastNearby).forEach(s => s.lines.forEach(l => keys.add(`${l.ref}|${l.type}`)));
  const nDay = [...keys].filter(k => !isNight(k)).length, nNight = keys.size - nDay;
  tiles.push(tile(`${nDay} ${linii(nDay)}`, nNight ? `+ ${nNight} ${plural(nNight, 'nocna', 'nocne', 'nocnych')}` : 'bez nocnych'));
  return tiles.join('');
}
export function renderPlaceHead() {
  const el = document.getElementById('place-head');
  const o = isoOrigin();
  if (!o) { el.innerHTML = ''; panelEl.classList.remove('has-head'); return; }
  panelEl.classList.add('has-head');
  const nw = nearestWalk();
  const walkMin = state.stopMode ? 0 : nw ? walkMinutes(nw.w) : null;
  const st = state.placeStats;
  const hasData = META && META.calendar;
  const noStops = !state.stopMode && !state.lastNearby.length;
  const { lvl, verdict } = placeVerdict(st, walkMin, noStops, hasData);

  const addr = !state.stopMode && state.pointLabel ? `<b class="ph-addr">${esc(state.pointLabel)}</b>` : '';
  el.innerHTML = (nw || addr ? `<div class="ph-where">${addr}${nw ? `${nw.outside ? 'Najbliższy przystanek' : 'Okolice przystanku'} <b>${esc(nw.name)}</b>` : ''}</div>` : '')
    + (verdict ? `<div class="ph-verdict${lvl == null ? ' wait' : ''}">${esc(verdict)}</div>` : '')
    + (lvl != null ? `<div class="ph-meter" aria-hidden="true">${[0, 1, 2, 3].map(i => `<i class="${i <= lvl ? 'on' : ''}"></i>`).join('')}</div>`
      + `<div class="ph-scale" aria-hidden="true">${VERDICT_SCALE.map((t, i) => `<span class="${i === lvl ? 'on' : ''}">${t}</span>`).join('')}</div>` : '')
    + `<div class="ph-tiles">${headTiles(st, nw, walkMin, noStops, hasData)}</div>`;
}
// items of the „Jak stąd dojedziesz” card: nearest stop, frequency, first and last trip
function placeFacts() {
  const facts = [];
  const nw = nearestWalk();
  if (nw && !nw.outside) facts.push(`Najbliższy przystanek: <b>${esc(nw.name)}</b>, ${fmtDist(nw.w)} pieszo (${walkMinutes(nw.w)} min)`);
  const st = state.placeStats;
  if (st) {
    const top = topLine(st);
    if (st.perHour >= 0.5) {
      const n = Math.round(st.perHour);
      facts.push(`W godz. 6–20 łącznie ok. <b>${n} ${plural(n, 'kurs', 'kursy', 'kursów')} na godzinę</b> w jedną stronę`
        + (top ? `, najczęściej <b>${esc(top.ref)}</b> co ${top.every} min` : ''));
    } else if (st.perHour > 0) facts.push('W godz. 6–20 <b>mniej niż 1 kurs na godzinę</b>');
    else facts.push(`<b>${cap(dayWord())} w godz. 6–20 nic stąd nie odjeżdża</b>`);
    const nNight = nightCount();
    if (isFinite(st.first)) facts.push(`Kursy dzienne od <b>${hm(st.first)}</b> do <b>${hm(st.last)}</b>`
      + (nNight ? `, w nocy ${nNight} ${plural(nNight, 'linia nocna', 'linie nocne', 'linii nocnych')}` : ', w nocy nic'));
  } else if (META && META.calendar && placePoles().length) facts.push('<span class="muted">Liczę częstotliwość kursów…</span>');
  return facts;
}
// travel times to targets: my places, then the fixed ones
function destsHtml() {
  if (WALK === false) return '<div class="muted" style="margin-top:8px">Czasy dojazdu wymagają sieci pieszej (walk.bin).</div>';
  if (!state.reach) return '<div class="muted" style="margin-top:8px">Liczę czasy dojazdu…</div>';
  const all = [...myPlaces.map((p, i) => ({ ...p, id: 'm' + i, mine: i })), ...DESTS.map((p, i) => ({ ...p, id: 'f' + i }))];
  return `<div class="dests-h">Czas dojazdu ${dayWord()}, z czekaniem na przystanku</div><div class="dests">` + all.map(d => {
    const r = routeTo(state.reach, d.lat, d.lon);
    const ok = r && isFinite(r.t);
    const time = ok ? `${Math.max(1, Math.round(r.t))} min${r.rides ? '' : ' pieszo'}` : `ponad ${REACH_T} min`;
    return `<div class="dest${samePlace(d, state.target) ? ' on' : ''}" role="button" tabindex="0" data-dest="${d.id}" title="Pokaż trasę na mapie">`
      + `<span class="dn">${d.mine != null ? '★ ' : ''}${esc(d.name)}</span>`
      + `<span class="dt${ok ? '' : ' far'}">${time}${d.mine != null ? `<button type="button" class="del" data-place-del="${d.mine}" title="Usuń z moich miejsc" aria-label="Usuń ${esc(d.name)} z moich miejsc">×</button>` : ''}</span>`
      + (ok && r.rides ? `<span class="dl">${routeSummary(r)}</span>` : '') + '</div>';
  }).join('') + '</div>';
}
export function renderPlaceCard() {
  renderPlaceHead();
  const el = document.getElementById('place-card');
  if (!el) return;
  if (!isoOrigin()) { el.innerHTML = ''; return; }
  const facts = placeFacts();
  el.innerHTML = `<div class="place-card">
    <div class="pc-top"><h3>Jak stąd dojedziesz</h3>
      <select id="day-type" aria-label="Typ dnia">${Object.entries(DAY_NAMES).map(([k, v]) =>
        `<option value="${k}"${k === state.isoDay ? ' selected' : ''}>${cap(v)}</option>`).join('')}</select></div>
    ${facts.length ? `<ul class="pc-facts">${facts.map(f => `<li>${f}</li>`).join('')}</ul>` : ''}
    ${destsHtml()}
    <div class="pc-actions"><button type="button" class="link-btn" data-pick-target="1">${state.pickingTarget ? 'Anuluj wskazywanie celu' : '+ Wskaż własny cel na mapie'}</button></div>
  </div>`;
}
