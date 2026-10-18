import { state } from '../state.js';
import { esc, fmt, fmtDist, linii, plural } from '../util.js';
import { DAY_NAMES, DESTS, PLACES_KEY, REACH_T, TYPE_CHIP, VERDICT, VERDICT_SCALE, WALK_SPEED } from '../config.js';
import { panelEl } from '../dom.js';
import { META, cellOf, isNight, loadCell, profileFor, repDate } from '../data.js';
import { WALK, loadWalk } from '../walk.js';
import { routeTo } from '../routing/street.js';
import { computeIso, isoOrigin, originKey, typicalRun } from '../iso.js';
import { updateBadgeSelection } from './line.js';
import { badgesHtml } from './panel.js';
import { renderTargetBox } from './target.js';
import { syncURL } from './url.js';

// Typ dnia (roboczy / sobota / niedziela) — wspólny dla częstotliwości, dojazdów do celów i zasięgu "typowy dzień"
export function setDayType(d) {
  if (!DAY_NAMES[d] || d === state.isoDay) return;
  state.isoDay = d;
  state.reach = null; state.placeStats = null;
  if (state.iso && state.iso.mode === 'typical') computeIso();
  if (state.stopMode || state.radiusCircle) refreshPlace();
  syncURL(false);
}
export let myPlaces = (() => { try { const v = JSON.parse(localStorage.getItem(PLACES_KEY) || '[]'); return Array.isArray(v) ? v.filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) : []; } catch (e) { return []; } })();
export function saveMyPlaces() { try { localStorage.setItem(PLACES_KEY, JSON.stringify(myPlaces)); } catch (e) { /* tryb prywatny: tylko do końca sesji */ } }
export function destById(id) { const n = +id.slice(1); return id[0] === 'm' ? myPlaces[n] : DESTS[n]; }
export function removeMyPlace(i) {
  myPlaces.splice(i, 1); saveMyPlaces();
  renderPlaceCard(); renderTargetBox();
}
export const samePlace = (a, b) => a && b && Math.abs(a.lat - b.lat) < 2e-5 && Math.abs(a.lon - b.lon) < 2e-5;
let placeToken = 0;
function reachFor(o) { return { o, ...typicalRun(o), walk: true, mode: 'typical', day: state.isoDay }; }
// przystanki, z których liczymy częstotliwość: wybrany przystanek albo przystanki w okręgu z dojściem pieszo
function placePoles() {
  if (state.stopMode) return state.stopMode.poles;
  return state.lastNearby.filter(s => !state.pointReach || state.pointReach.get(s.id) !== null);
}
// Statystyki odjazdów z przystanków (deps/) dla reprezentatywnego dnia danego typu
const statsDone = new Map();
const statsPending = new Map();
const statsKey = poles => state.isoDay + ':' + poles.map(p => p.id).sort().join(',');
export function placeStatsFor(stops) {
  const poles = state.stopMode ? stops : stops.filter(s => !state.pointReach || state.pointReach.get(s.id) !== null);
  return statsDone.get(statsKey(poles)) || null;
}
function lineStats(poles) {
  if (!META || !META.calendar || !poles.length) return Promise.resolve(null);
  const key = statsKey(poles);
  if (statsDone.has(key)) return Promise.resolve(statsDone.get(key));
  if (statsPending.has(key)) return statsPending.get(key);
  const prof = profileFor(repDate(state.isoDay));
  const p = Promise.all([...new Set(poles.map(cellOf))].map(loadCell)).then(cells => {
    if (!prof) return null;
    const per = new Map();
    let first = Infinity, last = -Infinity, lastKey = null;
    poles.forEach(s => cells.forEach(cell => Object.entries(cell[s.id] || {}).forEach(([k, arr]) => {
      const night = isNight(k);
      let day = 0, all = 0;
      arr.forEach(e => (e.t[e.p[prof.p]] || []).forEach(m => {
        all++;
        if (m >= 360 && m < 1200) day++;
        if (!night) { if (m < first) first = m; if (m > last) { last = m; lastKey = k; } }
      }));
      // odstęp liczymy z przystanku (słupka), na którym linia jeździ najczęściej — to jeden kierunek
      const cur = per.get(k) || { maxPole: 0, all: 0 };
      cur.maxPole = Math.max(cur.maxPole, day); cur.all += all;
      per.set(k, cur);
    })));
    // kursy na godzinę w jedną stronę, suma linii dziennych (ta sama linia na kilku przystankach liczy się raz)
    let perHour = 0;
    per.forEach((v, k) => { if (!isNight(k)) perHour += v.maxPole / 14; });
    return { per, perHour, first, last, lastKey };
  }).then(v => { statsDone.set(key, v); statsPending.delete(key); return v; });
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
    else await new Promise(r => setTimeout(r, 0));   // najpierw pinezka i panel na ekranie, potem liczenie (~40 ms)
    if (token !== placeToken) return;
    if (WALK && !state.reach) state.reach = reachFor(o);
    if (stP) state.placeStats = await stP;
    if (token !== placeToken) return;
    renderPlaceCard();
    if (stP) applyLineStats();
    renderTargetBox();
  })();
}
// ile linii nocnych jeździ z przystanków miejsca (tych, do których da się dojść)
function nightCount() {
  const ks = new Set();
  placePoles().forEach(s => s.lines.forEach(l => { const k = `${l.ref}|${l.type}`; if (isNight(k)) ks.add(k); }));
  return ks.size;
}
function linesChips(lines) {
  const seen = new Set();
  return lines.filter(l => { const k = l.ref + '|' + l.type; if (seen.has(k)) return false; seen.add(k); return true; })
    .map(l => `<span class="${TYPE_CHIP[l.type] || 'b'}">${esc(l.ref)}</span>`).join('');
}
function routeSummary(r) {
  if (!r || !isFinite(r.t)) return '';
  if (!r.rides) return 'pieszo';
  return linesChips(r.lines) + (r.rides > 1 ? ` · ${r.rides - 1} ${plural(r.rides - 1, 'przesiadka', 'przesiadki', 'przesiadek')}` : '')
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
// najbliższy przystanek pieszo z zaznaczonego punktu: {name, w (m), outside}
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
export function renderPlaceHead() {
  const el = document.getElementById('place-head');
  const o = isoOrigin();
  if (!o) { el.innerHTML = ''; panelEl.classList.remove('has-head'); return; }
  panelEl.classList.add('has-head');
  const nw = nearestWalk();
  const walkMin = state.stopMode ? 0 : nw ? Math.max(1, Math.round(nw.w / WALK_SPEED)) : null;
  const st = state.placeStats;
  const hasData = META && META.calendar;
  const noStops = !state.stopMode && !state.lastNearby.length;
  // linie (jak w tytule: wszystkie w okręgu / na przystanku), nocne osobno
  const keys = new Set();
  (state.stopMode ? state.stopMode.poles : state.lastNearby).forEach(s => s.lines.forEach(l => keys.add(`${l.ref}|${l.type}`)));
  const nDay = [...keys].filter(k => !isNight(k)).length, nNight = keys.size - nDay;

  let lvl = null, verdict;
  if (noStops) {
    if (walkMin == null || walkMin > 15) { lvl = 0; verdict = VERDICT[0]; }
    else verdict = `W promieniu ${fmtDist(state.radiusMeters)} nie ma przystanku.`;
  } else if (st) { lvl = verdictLevel(st.perHour, walkMin); verdict = VERDICT[lvl]; }
  else if (hasData && !placePoles().length) { lvl = verdictLevel(0, walkMin); verdict = VERDICT[lvl]; }
  else verdict = hasData ? 'Sprawdzam…' : '';

  const tile = (b, span, title = '') => `<div class="ph-t"${title ? ` title="${esc(title)}"` : ''}><b>${b}</b><span>${span}</span></div>`;
  const tiles = [];
  if (st) {
    const n = Math.round(st.perHour);
    tiles.push(st.perHour > 0 && n < 1 ? tile('&lt; 1', 'kurs na godzinę', 'W godz. 6–20, w jedną stronę')
      : tile(n, `${plural(n, 'kurs', 'kursy', 'kursów')} na godzinę`, 'W godz. 6–20, w jedną stronę, suma linii dziennych'));
  } else tiles.push(tile(noStops ? '0' : hasData ? '…' : '—', 'kursów na godzinę'));
  if (state.stopMode) {
    let top = null;
    if (st) st.per.forEach((v, k) => { if (!isNight(k) && v.maxPole && (!top || v.maxPole > top.v.maxPole)) top = { k, v }; });
    tiles.push(top ? tile(`co ${Math.max(1, Math.round(840 / top.v.maxPole))} min`, `najczęściej linia ${esc(top.k.split('|')[0])}`)
      : tile(st || !hasData ? '—' : '…', 'najczęstsza linia'));
  } else {
    tiles.push(walkMin != null ? tile(`${walkMin} min`, 'pieszo do przystanku', nw ? `${nw.name}, ${fmtDist(nw.w)}` : '') : tile('—', 'pieszo do przystanku'));
  }
  tiles.push(tile(`${nDay} ${linii(nDay)}`, nNight ? `+ ${nNight} ${plural(nNight, 'nocna', 'nocne', 'nocnych')}` : 'bez nocnych'));

  const addr = !state.stopMode && state.pointLabel ? `<b class="ph-addr">${esc(state.pointLabel)}</b>` : '';
  el.innerHTML = (nw || addr ? `<div class="ph-where">${addr}${nw ? `${nw.outside ? 'Najbliższy przystanek' : 'Okolice przystanku'} <b>${esc(nw.name)}</b>` : ''}</div>` : '')
    + (verdict ? `<div class="ph-verdict${lvl == null ? ' wait' : ''}">${esc(verdict)}</div>` : '')
    + (lvl != null ? `<div class="ph-meter" aria-hidden="true">${[0, 1, 2, 3].map(i => `<i class="${i <= lvl ? 'on' : ''}"></i>`).join('')}</div>`
      + `<div class="ph-scale" aria-hidden="true">${VERDICT_SCALE.map((t, i) => `<span class="${i === lvl ? 'on' : ''}">${t}</span>`).join('')}</div>` : '')
    + `<div class="ph-tiles">${tiles.join('')}</div>`;
}
export function renderPlaceCard() {
  renderPlaceHead();
  const el = document.getElementById('place-card');
  if (!el) return;
  const o = isoOrigin();
  if (!o) { el.innerHTML = ''; return; }
  const dayWord = { w: 'w dzień roboczy', s: 'w sobotę', n: 'w niedzielę' }[state.isoDay];
  const facts = [];
  if (!state.stopMode && state.lastNearby.length) {
    let best = null;
    state.lastNearby.forEach(s => {
      const w = state.pointReach ? state.pointReach.get(s.id) : s.dist * 1.3;
      if (w != null && (!best || w < best.w)) best = { s, w };
    });
    if (best) facts.push(`Najbliższy przystanek: <b>${esc(best.s.name)}</b>, ${fmtDist(best.w)} pieszo (${Math.max(1, Math.round(best.w / WALK_SPEED))} min)`);
  }
  const st = state.placeStats;
  if (st) {
    let top = null;
    st.per.forEach((v, k) => { if (!isNight(k) && v.maxPole && (!top || v.maxPole > top.v.maxPole)) top = { k, v }; });
    if (st.perHour >= 0.5) {
      const n = Math.round(st.perHour);
      facts.push(`W godz. 6–20 łącznie ok. <b>${n} ${plural(n, 'kurs', 'kursy', 'kursów')} na godzinę</b> w jedną stronę`
        + (top ? `, najczęściej <b>${esc(top.k.split('|')[0])}</b> co ${Math.max(1, Math.round(840 / top.v.maxPole))} min` : ''));
    } else if (st.perHour > 0) facts.push('W godz. 6–20 <b>mniej niż 1 kurs na godzinę</b>');
    else facts.push(`<b>${dayWord[0].toUpperCase() + dayWord.slice(1)} w godz. 6–20 nic stąd nie odjeżdża</b>`);
    const hm = m => fmt(m).replace(/^0/, '');
    if (isFinite(st.first)) facts.push(`Kursy dzienne od <b>${hm(st.first)}</b> do <b>${hm(st.last)}</b>`
      + (nightCount() ? `, w nocy ${nightCount()} ${plural(nightCount(), 'linia nocna', 'linie nocne', 'linii nocnych')}` : ', w nocy nic'));
  } else if (META && META.calendar && placePoles().length) facts.push('<span class="muted">Liczę częstotliwość kursów…</span>');

  // cele: moje miejsca, potem stałe
  const all = [...myPlaces.map((p, i) => ({ ...p, id: 'm' + i, mine: i })), ...DESTS.map((p, i) => ({ ...p, id: 'f' + i }))];
  let destHtml;
  if (WALK === false) destHtml = '<div class="muted" style="margin-top:8px">Czasy dojazdu wymagają sieci pieszej (walk.bin).</div>';
  else if (!state.reach) destHtml = '<div class="muted" style="margin-top:8px">Liczę czasy dojazdu…</div>';
  else {
    destHtml = `<div class="dests-h">Czas dojazdu ${dayWord}, z czekaniem na przystanku</div><div class="dests">` + all.map(d => {
      const r = routeTo(state.reach, d.lat, d.lon);
      const ok = r && isFinite(r.t);
      const time = ok ? `${Math.max(1, Math.round(r.t))} min${r.rides ? '' : ' pieszo'}` : `ponad ${REACH_T} min`;
      return `<div class="dest${samePlace(d, state.target) ? ' on' : ''}" role="button" tabindex="0" data-dest="${d.id}" title="Pokaż trasę na mapie">`
        + `<span class="dn">${d.mine != null ? '★ ' : ''}${esc(d.name)}</span>`
        + `<span class="dt${ok ? '' : ' far'}">${time}${d.mine != null ? `<button type="button" class="del" data-place-del="${d.mine}" title="Usuń z moich miejsc" aria-label="Usuń ${esc(d.name)} z moich miejsc">×</button>` : ''}</span>`
        + (ok && r.rides ? `<span class="dl">${routeSummary(r)}</span>` : '') + '</div>';
    }).join('') + '</div>';
  }
  el.innerHTML = `<div class="place-card">
    <div class="pc-top"><h3>Jak stąd dojedziesz</h3>
      <select id="day-type" aria-label="Typ dnia">${Object.entries(DAY_NAMES).map(([k, v]) =>
        `<option value="${k}"${k === state.isoDay ? ' selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('')}</select></div>
    ${facts.length ? `<ul class="pc-facts">${facts.map(f => `<li>${f}</li>`).join('')}</ul>` : ''}
    ${destHtml}
    <div class="pc-actions"><button type="button" class="link-btn" data-pick-target="1">${state.pickingTarget ? 'Anuluj wskazywanie celu' : '+ Wskaż własny cel na mapie'}</button></div>
  </div>`;
}
