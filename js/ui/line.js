import { state } from '../state.js';
import { dayChipLabel, esc, fmt, hm, nDeps, nextDays, nowMinutes, plural, todayISO, zaMin } from '../util.js';
import { TYPE_NAME } from '../config.js';
import { panelEl, routeStatus } from '../dom.js';
import { META, ROUTES, STOP_BY_ID, isNight, loadCellsFor, profileFor, servesLine } from '../data.js';
import { restyleStops } from '../map/stops.js';
import { clearPreview, clearRouteLayers, drawRoute, styleVariants } from '../map/route.js';
import { hwText } from './panel.js';
import { syncURL } from './url.js';
import { updateSheet } from './sheet.js';

const NO_DATA = 'Rozkład jest dostępny tylko dla pełnych danych (stops_data.json + katalog deps/).';
const NOT_HERE = 'Ta linia nie zatrzymuje się w zaznaczonym promieniu.';

export function selectRoute(key) {
  clearPreview();
  if (state.selectedRouteKey === key) {
    state.selectedRouteKey = null;
    clearRouteLayers();
    routeStatus.textContent = '';
    restyleStops();
    updateBadgeSelection();
    renderLineDetail();
    syncURL(true);
    return;
  }
  const wasSel = !!state.selectedRouteKey;
  state.selectedRouteKey = key;
  state.selectedVariant = defaultVariant(key);
  state.ldKurs = null; state.ldBefore = false; state.ldEarly = false;
  state.sheetState = 'peek';
  panelEl.scrollTop = 0;
  if (!wasSel) restyleStops();   // pozostałe przystanki przygaszone od razu, nie dopiero po zoomie
  drawRoute(key);
  updateBadgeSelection();
  renderLineDetail();
  syncURL(true);
}
// zamyka wybraną linię (jeśli jest)
export function closeRoute() {
  if (state.selectedRouteKey) selectRoute(state.selectedRouteKey);
}
export function updateBadgeSelection() {
  document.querySelectorAll('.badge').forEach(el => {
    el.classList.toggle('selected', el.dataset.key === state.selectedRouteKey);
  });
}
// najbliższy (po nazwie) przystanek w promieniu, który obsługuje linię — wszystkie jego słupki
function nearestPoles(key) {
  const serving = state.lastNearby.filter(s => servesLine(s, key));
  if (!serving.length) return null;
  const name = serving[0].name;
  return { name, dist: serving[0].dist, poles: serving.filter(s => s.name === name) };
}
// pozycja przystanku o tej nazwie w wariancie: indeks (-1 = brak) i względna (0..1, Infinity = brak)
const stopPos = (t, name) => t.s.findIndex(([id]) => STOP_BY_ID.get(id)?.name === name);
function relPos(t, name) {
  const pos = stopPos(t, name);
  return pos < 0 ? Infinity : pos / t.s.length;
}
function defaultVariant(key) {
  const route = ROUTES[key];
  const np = nearestPoles(key);
  if (!route || !route.trips || !np) return 0;
  // wolimy wariant, w którym pobliski przystanek jest wcześnie (czyli jedziemy "stąd")
  let best = 0, bestPos = Infinity;
  route.trips.forEach((t, i) => {
    if (!t) return;
    const rel = relPos(t, np.name);
    if (rel < bestPos) { bestPos = rel; best = i; }
  });
  return best;
}
export let detailToken = 0;
let ttToken = 0;
// stan widoku linii: zakładka, wybrany kurs (minuty od północy, do godzin na trasie),
// rozwinięte wcześniejsze przystanki i wcześniejsze godziny rozkładu
const ldCache = new Map();
// odjazdy linii z przystanku (wszystkie jego słupki) w danym dniu, pogrupowane po kierunku z rozkładu (headsign)
async function lineDepsFor(np, key, day) {
  const ck = `${key}|${np.poles.map(p => p.id).join(',')}|${day}`;
  if (ldCache.has(ck)) return ldCache.get(ck);
  const cells = await loadCellsFor(np.poles);
  const prof = profileFor(day);
  let res = null;
  if (prof) {
    // tylko wpisy tej linii; kierunki w kolejności z danych (także bez kursów tego dnia — odrzucane na końcu)
    const byH = new Map();
    np.poles.forEach(s => cells.forEach(cell => (cell[s.id]?.[key] || []).forEach(e => {
      if (!byH.has(e.h)) byH.set(e.h, new Set());
      (e.t[e.p[prof.p]] || []).forEach(m => byH.get(e.h).add(m));
    })));
    res = { prof, byH: new Map([...byH].map(([h, set]) => [h, [...set].sort((a, b) => a - b)]).filter(([, m]) => m.length)) };
  }
  if (ldCache.size > 300) ldCache.clear();
  ldCache.set(ck, res);
  return res;
}
// Kierunek (headsign wariantu) dla odjazdów z danym headsignem. Kursy skrócone (np. „Łagiewniki”)
// trafiają do kierunku, w którym taki przystanek jest dalej na trasie.
function depDir(route, h, hereName) {
  const trips = (route.trips || []).filter(Boolean);
  if (trips.some(t => t.h === h)) return h;
  for (const t of trips) {
    const names = t.s.map(([id]) => STOP_BY_ID.get(id)?.name);
    const i = hereName ? names.indexOf(hereName) : 0;
    const j = names.lastIndexOf(h);
    if (i >= 0 && j > i) return t.h;
  }
  return null;
}
// odjazdy w wybranym kierunku: [{m, h}] po kolei
function dirDeps(route, byH, dir, hereName) {
  const out = [];
  let mapped = false;
  byH.forEach((mins, h) => {
    const d = depDir(route, h, hereName);
    if (d) mapped = true;
    if (d === dir) mins.forEach(m => out.push({ m, h }));
  });
  if (!mapped) byH.forEach((mins, h) => mins.forEach(m => out.push({ m, h })));   // nie da się przypisać: wszystkie
  return out.sort((a, b) => a.m - b.m);
}
const selectedTrip = route => (route.trips || [])[state.selectedVariant];
// kierunek = wariant z tym headsignem, w którym wybrany przystanek jest najwcześniej (jedziemy „stąd”)
export function pickDir(h) {
  const route = ROUTES[state.selectedRouteKey];
  if (!route) return;
  const np = nearestPoles(state.selectedRouteKey);
  let best = -1, bestPos = Infinity;
  (route.trips || []).forEach((t, i) => {
    if (!t || t.h !== h) return;
    const rel = np ? relPos(t, np.name) : 0;
    if (best < 0 || rel < bestPos) { bestPos = rel; best = i; }
  });
  if (best < 0) return;
  state.selectedVariant = best;
  state.ldKurs = null; state.ldBefore = false;
  styleVariants();
  renderLineDetail();
}
export function setLdTab(tab) {
  state.ldTab = tab;
  document.querySelectorAll('.ld-tabs [data-ldtab]').forEach(b => {
    const on = b.dataset.ldtab === tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
  renderLdPane(detailToken);
}
// nagłówek: numer, rodzaj (+ przewoźnik, częstotliwość), nazwa trasy, ✕
function ldHeadHtml(route, key) {
  const kind = TYPE_NAME[route.type] || 'Autobus';
  const hw = isNight(key) ? 'linia nocna' : hwText(key, state.placeStats);
  return `<div class="ld-head"><span class="ld-num ${route.type}">${esc(route.ref)}</span>
    <div class="ld-ttl"><div class="ld-kind">${kind}${route.op ? ` · ${esc(route.op)}` : ''}${hw && hw !== 'nie kursuje' ? ` · ${hw}` : ''}</div>
    <div class="ld-name">${esc(route.name || kind)}</div></div>
    <button type="button" class="ld-close" data-line-close="1" aria-label="Zamknij linię ${esc(route.ref)}" title="Zamknij linię (Esc)">✕</button></div>`;
}
// przełącznik kierunku, a w jednym kierunku kilka wariantów: przyciski „skąd → dokąd”
function ldDirHtml(trips, t) {
  const dirs = [];
  trips.forEach(x => { if (x && !dirs.includes(x.h)) dirs.push(x.h); });
  let html = '';
  if (dirs.length > 1) {
    html += '<div class="dseg" role="group" aria-label="Kierunek">' + dirs.map(h =>
      `<button type="button" data-dir="${esc(h)}" class="${h === t.h ? 'on' : ''}" aria-pressed="${h === t.h}" title="Kierunek ${esc(h)}">→ ${esc(h)}</button>`).join('') + '</div>';
  }
  // ten sam kierunek w kilku wariantach (np. kursy z zajezdni): cały odcinek „skąd → dokąd”
  const same = trips.map((x, i) => [x, i]).filter(([x]) => x && x.h === t.h);
  if (same.length > 1) {
    html += '<div class="chips ld-vars">' + same.map(([x, i]) =>
      `<button type="button" class="chip${i === state.selectedVariant ? ' on' : ''}" data-variant="${i}">${esc(STOP_BY_ID.get(x.s[0][0])?.name || '')} → ${esc(x.h)}</button>`).join('') + '</div>';
  } else if (dirs.length < 2) html += `<div class="ld-from">Kierunek <b>→ ${esc(t.h)}</b></div>`;
  return html;
}
// skąd odjazdy (z odległością jak na liście przystanków: pieszo po ulicach, jeśli policzona) + miejsce na kafelki
function ldFromHtml(np) {
  const walkM = state.pointReach ? Math.min(...np.poles.map(p => state.pointReach.get(p.id) ?? Infinity)) : Infinity;
  const distTxt = isFinite(walkM) ? `${Math.round(walkM / 10) * 10} m pieszo` : `${Math.round(np.dist)} m`;
  return `<div class="ld-from">Odjazdy z przystanku <b>${esc(np.name)}</b>${state.stopMode ? '' : ` · ${distTxt}`}</div>`
    + '<div class="ld-next" id="ld-next"><div class="muted">Wczytuję rozkład…</div></div>';
}
const ldTabBtn = (id, label) =>
  `<button type="button" role="tab" data-ldtab="${id}" class="${state.ldTab === id ? 'on' : ''}" aria-selected="${state.ldTab === id}">${label}</button>`;
// Szczegóły linii: nagłówek, kierunek, najbliższe odjazdy (kafelki = wybór kursu),
// zakładki „Trasa i czasy” (przystanki z czasem i godziną dla wybranego kursu) i „Rozkład” (dni + tabela)
export function renderLineDetail() {
  const el = document.getElementById('line-detail');
  updateSheet();
  if (!el) return;
  const key = state.selectedRouteKey;
  const route = key && ROUTES[key];
  if (!route) { el.innerHTML = ''; return; }
  const token = ++detailToken;
  const np = nearestPoles(key);
  const trips = route.trips || [];
  if (!trips[state.selectedVariant]) state.selectedVariant = Math.max(0, trips.findIndex(Boolean));
  const t = trips[state.selectedVariant];
  const hasDeps = META && META.calendar;
  el.innerHTML = ldHeadHtml(route, key)
    + (t ? ldDirHtml(trips, t) : '')
    + (!hasDeps ? `<div class="muted ld-from">${NO_DATA}</div>` : !np ? `<div class="muted ld-from">${NOT_HERE}</div>` : ldFromHtml(np))
    + `<div class="ld-tabs" role="tablist" aria-label="Szczegóły linii">${ldTabBtn('trasa', 'Trasa i czasy')}${ldTabBtn('rozklad', 'Rozkład')}</div>`
    + '<div id="ld-pane"></div>';
  renderLdPane(token);
  if (hasDeps && np) renderLdNext(token);
}
// najbliższe odjazdy w wybranym kierunku (dziś); kafelek = kurs, dla którego liczą się godziny na trasie
async function renderLdNext(token) {
  const key = state.selectedRouteKey, route = ROUTES[key], np = nearestPoles(key);
  if (!route || !np) return;
  const t = selectedTrip(route);
  const d = await lineDepsFor(np, key, todayISO());
  const box = document.getElementById('ld-next');
  if (token !== detailToken || !box) return;
  const nowMin = nowMinutes();
  const deps = d ? dirDeps(route, d.byH, t ? t.h : null, np.name) : [];
  const next = deps.filter(x => x.m >= nowMin).slice(0, 4);
  if (state.ldKurs != null && !next.some(x => x.m === state.ldKurs)) state.ldKurs = null;
  if (state.ldKurs == null && next.length) state.ldKurs = next[0].m;
  box.innerHTML = !d ? '<div class="muted">Brak rozkładu na dziś.</div>'
    : !next.length ? `<div class="muted">${deps.length ? 'Dziś już nic stąd nie odjeżdża w tym kierunku.' : 'Dziś ta linia nie odjeżdża stąd w tym kierunku.'}</div>`
    : next.map(x => `<button type="button" class="ld-nt${x.m === state.ldKurs ? ' on' : ''}" data-kurs="${x.m}" aria-pressed="${x.m === state.ldKurs}" title="Godziny na trasie dla kursu o ${fmt(x.m)}">`
      + `<b>${fmt(x.m)}</b><small>${zaMin(x.m - nowMin)}</small>${t && x.h !== t.h ? `<em>→ ${esc(x.h)}</em>` : ''}</button>`).join('');
  if (state.ldTab === 'trasa') renderLdPane(token);   // godziny przyjazdu zależą od wybranego kursu
}
export function renderLdPane(token) {
  const pane = document.getElementById('ld-pane');
  const key = state.selectedRouteKey, route = key && ROUTES[key];
  if (!pane || !route || token !== detailToken) return;
  if (state.ldTab === 'rozklad') { renderLdTimetable(pane, route, key); return; }
  const t = selectedTrip(route);
  if (!t) { pane.innerHTML = '<div class="muted">Brak czasów przejazdu w tych danych.</div>'; return; }
  const np = nearestPoles(key);
  const here = np ? stopPos(t, np.name) : -1;
  const base = here >= 0 ? (t.s[here][1] ?? 0) : 0;
  const total = t.s[t.s.length - 1][1];
  const lastName = STOP_BY_ID.get(t.s[t.s.length - 1][0])?.name || t.h;
  const kurs = here >= 0 && state.ldKurs != null ? state.ldKurs : null;
  let html = '';
  if (total != null) {
    html += `<div class="ld-total">Do ${esc(lastName)}: <b>${total - base} min</b>`
      + (kurs != null ? `, na miejscu ok. <b>${fmt(kurs + total - base)}</b>` : '')
      + (here > 0 ? ` <span class="muted">(cała trasa ${total} min)</span>` : '') + '</div>';
  }
  // dwa słupki tej samej nazwy pod rząd (np. pętla): jeden wiersz — zostaje późniejszy albo "tu"
  const nm = j => STOP_BY_ID.get(t.s[j][0])?.name || t.s[j][0];
  const rows = [];
  t.s.forEach(([id, off], i) => {
    const name = nm(i);
    if (i !== here && ((i + 1 < t.s.length && nm(i + 1) === name) || (i > 0 && i - 1 === here && nm(i - 1) === name))) return;
    rows.push({ i, id, name, off });
  });
  const isBefore = r => here >= 0 && r.i < here;
  const before = rows.filter(isBefore);
  if (before.length && !state.ldBefore) {
    html += `<button type="button" class="ld-more" data-ld-before="1"><span aria-hidden="true">↑</span> ${before.length} ${plural(before.length, 'wcześniejszy przystanek', 'wcześniejsze przystanki', 'wcześniejszych przystanków')}, od ${esc(before[0].name)}</button>`;
  }
  html += '<ul class="tl">' + rows.filter(r => state.ldBefore || !isBefore(r)).map(r => {
    const bef = isBefore(r);
    const cls = bef ? 'before' : r.i === here ? 'here' : '';
    let val = '';
    if (r.off != null && !bef) {
      val = r.i === here ? '' : `+${r.off - base} min`;
      if (kurs != null) val += `<b class="clk">${fmt(kurs + r.off - base)}</b>`;
    }
    return `<li class="${cls}" data-stop-id="${esc(r.id)}" tabindex="0" title="Pokaż przystanek"><div>${esc(r.name)}${r.i === here ? '<i class="here-tag">tu wsiadasz</i>' : ''}</div><span>${val}</span></li>`;
  }).join('') + '</ul>';
  html += `<div class="muted" style="margin-top:6px">Czasy z rozkładu dla kursu około południa; w szczycie mogą być dłuższe.${kurs != null ? ' Godziny przyjazdu są przybliżone.' : ''}</div>`;
  pane.innerHTML = html;
}
// dziś: godziny przed bieżącą (co najmniej dwie) zwinięte w przycisk „Wcześniej: …”
function foldEarly(entries, nowMin) {
  const curH = Math.floor(nowMin / 60);
  const past = entries.filter(([hh]) => hh < curH);
  if (past.length < 2) return { entries, early: '' };
  const n = past.reduce((a, [, xs]) => a + xs.length, 0);
  const lastPast = past[past.length - 1][1];
  return {
    entries: entries.filter(([hh]) => hh >= curH),
    early: `<button type="button" class="ld-more" data-ld-early="1"><span aria-hidden="true">↑</span> Wcześniej: ${hm(past[0][1][0].m)}–${hm(lastPast[lastPast.length - 1].m)} (${nDeps(n)})</button>`,
  };
}
// tabela godzina → minuty; kursy w innym kierunku niż wybrany (skrócone) z „°”, zebrane w `alts`
function ttTableHtml(entries, t, isToday, nowMin, nextM, alts) {
  return '<table class="tt">' + entries.map(([hh, xs]) =>
    `<tr><td class="h">${hh % 24}</td><td class="m">` + xs.map(x => {
      const alt = !!t && x.h !== t.h;
      if (alt) alts.add(x.h);
      const cls = [isToday && x.m < nowMin ? 'past' : '', x.m === nextM ? 'nx' : '', alt ? 'alt' : ''].filter(Boolean).join(' ');
      return `<span class="${cls}"${alt ? ` title="→ ${esc(x.h)}"` : ''}>${String(x.m % 60).padStart(2, '0')}${alt ? '°' : ''}</span>`;
    }).join(' ') + '</td></tr>').join('') + '</table>';
}
// zakładka „Rozkład”: dzień + tabela godzin w wybranym kierunku; dziś wcześniejsze godziny zwinięte
async function renderLdTimetable(pane, route, key) {
  const np = nearestPoles(key);
  if (!META || !META.calendar) { pane.innerHTML = `<div class="muted">${NO_DATA}</div>`; return; }
  if (!np) { pane.innerHTML = `<div class="muted">${NOT_HERE}</div>`; return; }
  const today = todayISO();
  if (!state.selectedDay || state.selectedDay < today) state.selectedDay = today;
  pane.innerHTML = '<div class="chips">' + nextDays().map((d, i) =>
    `<button type="button" class="chip${d === state.selectedDay ? ' on' : ''}" data-day="${d}" aria-pressed="${d === state.selectedDay}">${dayChipLabel(d, i)}</button>`
  ).join('') + '</div><div id="ld-tt"><div class="muted">Wczytuję rozkład…</div></div>';
  const tok = ++ttToken, day = state.selectedDay;
  const d = await lineDepsFor(np, key, day);
  const box = document.getElementById('ld-tt');
  if (tok !== ttToken || !box) return;
  if (!d) { box.innerHTML = '<div class="muted">Brak rozkładu na ten dzień.</div>'; return; }
  const t = selectedTrip(route);
  const deps = dirDeps(route, d.byH, t ? t.h : null, np.name);
  if (!deps.length) { box.innerHTML = `<div class="muted">Tego dnia ta linia nie odjeżdża stąd${t ? ` w kierunku ${esc(t.h)}` : ''}.</div>`; return; }
  const isToday = day === today, nowMin = nowMinutes();
  const nextM = isToday ? deps.find(x => x.m >= nowMin)?.m : undefined;
  const hours = new Map();
  deps.forEach(x => { const hh = Math.floor(x.m / 60); if (!hours.has(hh)) hours.set(hh, []); hours.get(hh).push(x); });
  const { entries, early } = isToday && !state.ldEarly ? foldEarly([...hours.entries()], nowMin) : { entries: [...hours.entries()], early: '' };
  const alts = new Set();
  const table = ttTableHtml(entries, t, isToday, nowMin, nextM, alts);
  box.innerHTML = (d.prof.approx ? `<div class="muted" style="margin-bottom:6px">Brak danych na ten dzień — pokazuję rozkład z ${d.prof.approx}.</div>` : '')
    + `<div class="muted" style="margin-bottom:6px">${nDeps(deps.length)}${nextM != null ? `, najbliższy <b>${fmt(nextM)}</b> (${zaMin(nextM - nowMin)})` : ''}</div>`
    + early + table
    + (alts.size ? `<div class="muted tt-note">° kurs tylko do: ${[...alts].map(esc).join(', ')}</div>` : '');
}
