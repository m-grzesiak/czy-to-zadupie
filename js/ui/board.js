import { state } from '../state.js';
import { dmy, esc, fmt, inMin, nDeps, todayISO } from '../util.js';
import { META, cellOf, loadCell, profileFor } from '../data.js';

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
  const data = await Promise.all([...new Set(poles.map(cellOf))].map(loadCell));
  if (token !== boardToken || !document.getElementById('board')) return;
  const prof = profileFor(todayISO());
  if (!prof) { el.innerHTML = '<div class="muted">Brak rozkładu na dziś.</div>'; return; }
  const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes();
  const seen = new Set(), items = [];
  poles.forEach(s => data.forEach(cell => Object.entries(cell[s.id] || {}).forEach(([key, arr]) =>
    arr.forEach(e => (e.t[e.p[prof.p]] || []).forEach(m => {
      const id = `${key}/${e.h}/${m}`;
      if (m >= nowMin && m < nowMin + 180 && !seen.has(id)) { seen.add(id); items.push({ m, key, h: e.h, c: s.c || '' }); }
    })))));
  items.sort((a, b) => a.m - b.m || a.key.localeCompare(b.key, 'pl', { numeric: true }));
  // rzadko obsługiwany przystanek: wypisz wszystkie dzisiejsze odjazdy (np. "w sobotę tylko 2")
  const allDay = [], seenAll = new Set();
  poles.forEach(s => data.forEach(cell => Object.entries(cell[s.id] || {}).forEach(([key, arr]) =>
    arr.forEach(e => (e.t[e.p[prof.p]] || []).forEach(m => {
      const id = `${key}/${e.h}/${m}`;
      if (!seenAll.has(id)) { seenAll.add(id); allDay.push({ m, key, h: e.h }); }
    })))));
  allDay.sort((a, b) => a.m - b.m);
  const RARE = 8;
  const rareHtml = allDay.length && allDay.length <= RARE
    ? `<div class="iso-next" style="margin-bottom:8px"><b>Dziś tylko ${allDay.length} ${allDay.length === 1 ? 'odjazd' : allDay.length < 5 ? 'odjazdy' : 'odjazdów'} stąd:</b> `
      + allDay.map(x => `${fmt(x.m)} (${esc(x.key.split('|')[0])} → ${esc(x.h)})`).join(', ') + '</div>'
    : '';
  const board = document.getElementById('board');
  if (!items.length) {
    board.innerHTML = rareHtml + (allDay.length ? '<div class="muted">W ciągu najbliższych 3 godzin nic stąd nie odjeżdża.</div>'
      : '<div class="muted">Dziś z tego przystanku nic nie odjeżdża.</div>');
    return;
  }
  const shown = items.slice(0, state.boardLimit), rest = items.length - shown.length;
  const codes = new Set(poles.map(p => p.c).filter(Boolean));
  const plTitle = 'Numer przystanku z tablicy ZTP — taki sam jak etykieta przy przystanku na mapie';
  board.innerHTML = rareHtml + (prof.approx ? `<div class="muted" style="margin-bottom:6px">Brak danych na dziś — rozkład z ${dmy(prof.approx)}.</div>` : '') +
    '<div class="board">' + shown.map(it => {
      const [ref, type] = it.key.split('|');
      const d = it.m - nowMin;
      return `<div class="dep-row${d <= 5 ? ' soon' : ''}" role="button" tabindex="0" data-line="${esc(it.key)}" data-pole="${esc(it.c)}">
        <span class="t">${fmt(it.m)}</span><span class="badge ${type}">${esc(ref)}</span>
        ${codes.size > 1 && it.c ? `<span class="pl" title="${plTitle}">${esc(it.c)}</span>` : '<span></span>'}
        <span class="h">→ ${esc(it.h)}</span><span class="in">${d === 0 ? 'teraz' : inMin(d)}</span></div>`;
    }).join('') + '</div>'
    + (rest > 0 ? `<button type="button" class="link-btn more-btn" data-board-more="1">Pokaż więcej (jeszcze ${nDeps(rest)} w ciągu 3 h)</button>`
                : items.length > 16 ? '<div class="muted" style="margin-top:8px;text-align:center">To wszystkie odjazdy w ciągu 3 h.</div>' : '');
}
setInterval(() => { if (state.stopMode) renderBoard(); }, 60000);
