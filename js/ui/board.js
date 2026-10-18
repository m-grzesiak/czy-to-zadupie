import { state } from '../state.js';
import { dmy, esc, fmt, inMin, nDeps, nowMinutes, todayISO } from '../util.js';
import { META, forEachDep, loadCellsFor, profileFor } from '../data.js';

const RARE = 8;            // this many departures per day or fewer: list them all above the board
const BOARD_SPAN = 180;    // the board reaches 3 hours ahead
const PL_TITLE = 'Numer przystanku z tablicy ZTP — taki sam jak etykieta przy przystanku na mapie';

// all of today's departures from the poles (no duplicates): [{m, key, h, c}]
function todayDeps(poles, cells, p) {
  const out = [], seen = new Set();
  forEachDep(poles, cells, p, (m, key, h, s) => {
    const id = `${key}/${h}/${m}`;
    if (!seen.has(id)) { seen.add(id); out.push({ m, key, h, c: s.c || '' }); }
  });
  return out;
}
// rarely served stop: list all of today's departures (e.g. "w sobotę tylko 2")
function rareHtml(allDay) {
  if (!allDay.length || allDay.length > RARE) return '';
  return `<div class="iso-next" style="margin-bottom:8px"><b>Dziś tylko ${nDeps(allDay.length)} stąd:</b> `
    + allDay.map(x => `${fmt(x.m)} (${esc(x.key.split('|')[0])} → ${esc(x.h)})`).join(', ') + '</div>';
}
function depRow(it, nowMin, showPole) {
  const [ref, type] = it.key.split('|');
  const d = it.m - nowMin;
  return `<div class="dep-row${d <= 5 ? ' soon' : ''}" role="button" tabindex="0" data-line="${esc(it.key)}" data-pole="${esc(it.c)}">
        <span class="t">${fmt(it.m)}</span><span class="badge ${type}">${esc(ref)}</span>
        ${showPole && it.c ? `<span class="pl" title="${PL_TITLE}">${esc(it.c)}</span>` : '<span></span>'}
        <span class="h">→ ${esc(it.h)}</span><span class="in">${d === 0 ? 'teraz' : inMin(d)}</span></div>`;
}

let boardToken = 0;
export async function renderBoard() {
  const el = document.getElementById('board');
  if (!el || !state.stopMode) return;
  if (!META || !META.calendar) {
    el.innerHTML = '<div class="muted">Odjazdy są dostępne tylko dla pełnych danych (stops_data.json + katalog deps/).</div>';
    return;
  }
  const token = ++boardToken;
  const poles = state.stopMode.poles;
  const cells = await loadCellsFor(poles);
  const board = document.getElementById('board');
  if (token !== boardToken || !board) return;
  const prof = profileFor(todayISO());
  if (!prof) { board.innerHTML = '<div class="muted">Brak rozkładu na dziś.</div>'; return; }
  const nowMin = nowMinutes();
  const allDay = todayDeps(poles, cells, prof.p);
  const items = allDay.filter(x => x.m >= nowMin && x.m < nowMin + BOARD_SPAN)
    .sort((a, b) => a.m - b.m || a.key.localeCompare(b.key, 'pl', { numeric: true }));
  allDay.sort((a, b) => a.m - b.m);
  const rare = rareHtml(allDay);
  if (!items.length) {
    board.innerHTML = rare + (allDay.length ? '<div class="muted">W ciągu najbliższych 3 godzin nic stąd nie odjeżdża.</div>'
      : '<div class="muted">Dziś z tego przystanku nic nie odjeżdża.</div>');
    return;
  }
  const shown = items.slice(0, state.boardLimit), rest = items.length - shown.length;
  const showPole = new Set(poles.map(p => p.c).filter(Boolean)).size > 1;
  board.innerHTML = rare + (prof.approx ? `<div class="muted" style="margin-bottom:6px">Brak danych na dziś — rozkład z ${dmy(prof.approx)}.</div>` : '') +
    '<div class="board">' + shown.map(it => depRow(it, nowMin, showPole)).join('') + '</div>'
    + (rest > 0 ? `<button type="button" class="link-btn more-btn" data-board-more="1">Pokaż więcej (jeszcze ${nDeps(rest)} w ciągu 3 h)</button>`
                : items.length > 16 ? '<div class="muted" style="margin-top:8px;text-align:center">To wszystkie odjazdy w ciągu 3 h.</div>' : '');
}
setInterval(() => { if (state.stopMode) renderBoard(); }, 60000);
