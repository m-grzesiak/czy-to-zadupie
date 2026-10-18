import { state } from '../state.js';
import { DOW, esc, fmt, haversineMeters, localISO, zaMin } from '../util.js';
import { DAY_NAMES, DAY_SHORT, TRANSFER_MIN, WALK_MAX } from '../config.js';
import { CHIP_MINUS, CHIP_PLUS, CHIP_X, ISO_ICON } from '../icons.js';
import { COARSE } from '../dom.js';
import { ROUTES, STOP_BY_ID, STOP_INDEX, cellOf, hasHeadways, loadCell, profileFor } from '../data.js';
import { WALK } from '../walk.js';
import { timeModeAvailable } from '../routing/csa.js';
import { fitIsoView } from '../map/iso.js';
import { applyIsoT, clearIso, computeIso, isoOrigin, setIsoT } from '../iso.js';
import { syncURL } from './url.js';
import { updateSheet } from './sheet.js';

// ---------------------------------------------------------------------------
// Chip zasięgu na mapie (prawy górny róg). Wyłączony: „◎ Zasięg 20 min” włącza zasięg.
// Włączony: typ dnia / godzina, − 20 min +, ✕ (wyłącza, jak Esc). Widać go bez przewijania panelu,
// więc zawsze wiadomo, że klik w mapę pokazuje czas dojazdu (dymek), a nie tylko wybiera miejsce.
// ---------------------------------------------------------------------------
let isoChipEl = null;
export const IsoChip = L.Control.extend({
  options: { position: 'topright' },
  onAdd() {
    const el = L.DomUtil.create('div', 'iso-chip');
    el.hidden = true;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
    el.addEventListener('click', onIsoChip);
    isoChipEl = el;
    return el;
  },
});
export function renderIsoChip() {
  updateSheet();
  const el = isoChipEl;
  if (!el) return;
  const o = state.iso ? state.iso.o : isoOrigin();
  if (!o || !hasHeadways()) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.classList.toggle('on', !!state.iso);
  if (!state.iso) {
    el.innerHTML = `<button type="button" data-chip="on" title="Pokaż, gdzie dojedziesz w ${state.isoT} min">${ISO_ICON}Zasięg ${state.isoT} min</button>`;
    return;
  }
  const ctx = state.iso.mode === 'time' ? `wyjście ${fmt(state.isoTime)}` : DAY_SHORT[state.isoDay] || '';
  el.innerHTML = `<button type="button" data-chip="edit" title="Ustawienia zasięgu w panelu">${ISO_ICON}<span class="ic-ctx">${esc(ctx)}</span></button>`
    + `<button type="button" class="ic-step" data-chip="-" aria-label="Krócej o 5 min"${state.iso.T <= 10 ? ' disabled' : ''}>${CHIP_MINUS}</button>`
    + `<span class="ic-t" aria-live="polite">${state.iso.T} min</span>`
    + `<button type="button" class="ic-step" data-chip="+" aria-label="Dłużej o 5 min"${state.iso.T >= 60 ? ' disabled' : ''}>${CHIP_PLUS}</button>`
    + `<i class="ic-sep" aria-hidden="true"></i>`
    + `<button type="button" class="ic-x" data-chip="off" title="Wyłącz zasięg (Esc)" aria-label="Wyłącz zasięg">${CHIP_X}</button>`;
}
function onIsoChip(e) {
  // chip przerysowuje się w trakcie kliknięcia; bez tego Leaflet nie widzi, że klik był w kontrolce, i ustawia cel
  L.DomEvent.stopPropagation(e);
  const b = e.target.closest('[data-chip]');
  if (!b || b.disabled) return;
  const a = b.dataset.chip;
  if (a === 'on') computeIso();
  else if (a === 'off') { clearIso(); renderIsoBox(); syncURL(true); }
  else if (a === '-' || a === '+') applyIsoT((state.iso ? state.iso.T : state.isoT) + (a === '+' ? 5 : -5));
  else if (a === 'edit') document.getElementById('iso-box')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
export function renderIsoBox() {
  renderIsoChip();
  const box = document.getElementById('iso-box');
  if (!box) return;
  const o = state.iso ? state.iso.o : isoOrigin();
  if (!o) { box.innerHTML = ''; return; }
  const hasHw = Object.values(ROUTES).some(r => (r.trips || []).some(t => t && t.hw));
  if (!hasHw) { box.innerHTML = ''; return; }
  if (!state.iso) {
    box.innerHTML = `<button type="button" class="iso-start" data-iso="on">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".6"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/></svg>
      Gdzie dojadę w ${state.isoT} min${o.point ? ' stąd' : ''}?</button>`;
    return;
  }
  if (!o.poles.length && !(state.iso.walk && o.point)) {
    box.innerHTML = `<div class="iso-card"><div class="iso-top"><h3>Zasięg</h3><button type="button" class="link-btn" data-iso="off">Wyłącz</button></div>
      <div class="muted" style="margin-top:6px">W odległości ${o.walkMax / 1000} km od tego miejsca nie ma żadnego przystanku.</div></div>`;
    return;
  }
  // statystyki: przystanki (po nazwie) w każdym paśmie
  const bestByName = new Map();
  state.iso.labels.forEach((l, id) => {
    if (l.t > state.iso.T) return;
    const st = STOP_BY_ID.get(id);
    const cur = bestByName.get(st.name);
    if (!cur || l.t < cur.t) bestByName.set(st.name, { t: l.t, id, st });
  });
  const reached = [...bestByName.values()].filter(x => !(state.iso.labels.get(x.id).origin && !o.point));
  const counts = state.iso.bands.map(b => reached.filter(x => x.t >= b.lo && x.t < b.hi).length);
  counts[counts.length - 1] += reached.filter(x => x.t === state.iso.T).length;
  const far = reached
    .map(x => ({ ...x, d: haversineMeters(o.lat, o.lon, x.st.lat, x.st.lon) }))
    .sort((a, b) => b.d - a.d).slice(0, 5);
  const km = d => (d / 1000).toLocaleString('pl', { maximumFractionDigits: 1 }) + ' km';
  // czy w ogóle coś jedzie (inaczej "dojdziesz pieszo")
  const anyRide = state.iso.mode === 'time' ? state.iso.rides > 0
    : state.iso.walk ? reached.some(x => state.iso.res.kind[WALK.N + STOP_INDEX().get(x.id)] === 3)
    : reached.some(x => state.iso.labels.get(x.id).ti != null);

  // przełącznik trybu + parametry
  const tm = state.iso.mode === 'time';
  const modeHtml = timeModeAvailable() && WALK ? `<div class="seg" role="group" aria-label="Tryb">
      <button type="button" class="${tm ? '' : 'on'}" data-iso-mode="typical">Typowy dzień</button>
      <button type="button" class="${tm ? 'on' : ''}" data-iso-mode="time">Wyjazd o godzinie</button></div>` : '';
  let paramsHtml;
  if (tm) {
    const days = [];
    for (let i = 0; i < 7; i++) { const d = new Date(); d.setDate(d.getDate() + i); days.push(localISO(d)); }
    const hh = String(Math.floor(state.isoTime / 60) % 24).padStart(2, '0'), mm = String(state.isoTime % 60).padStart(2, '0');
    paramsHtml = '<div class="chips">' + days.map((d, i) => {
      const dd = new Date(d + 'T12:00');
      const label = i === 0 ? 'Dziś' : i === 1 ? 'Jutro' : `${DOW[dd.getDay()]} ${dd.getDate()}.${String(dd.getMonth() + 1).padStart(2, '0')}`;
      return `<button type="button" class="chip${d === state.isoDate ? ' on' : ''}" data-iso-date="${d}">${label}</button>`;
    }).join('') + '</div>'
      + `<div class="iso-when"><label for="iso-time">Wyjście o</label><input type="time" id="iso-time" value="${hh}:${mm}" step="60">`
      + `<button type="button" class="link-btn" data-iso-now="1">teraz</button></div>`;
  } else {
    paramsHtml = '<div class="chips">' + Object.entries(DAY_NAMES).map(([k, v]) =>
      `<button type="button" class="chip${k === state.isoDay ? ' on' : ''}" data-iso-day="${k}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('') + '</div>';
  }
  const note = tm
    ? `Prawdziwe odjazdy z rozkładu${state.iso.csa && state.iso.csa.approx ? ` (brak danych na ten dzień — rozkład z ${state.iso.csa.approx})` : ''}, ${TRANSFER_MIN} min zapasu na przesiadkę, dojście i przesiadki pieszo po ulicach z OpenStreetMap, 4,5 km/h. Bez korków i opóźnień.`
    : `Typowy dzień (${DAY_NAMES[state.isoDay]}), 6:00–20:00. Wliczam średnie czekanie na przystanku (połowa odstępu kursów)${WALK ? ', dojście i przesiadki pieszo po ulicach i ścieżkach z OpenStreetMap, 4,5 km/h' : ` i przesiadki pieszo do ${WALK_MAX} m, w przybliżeniu (linia prosta × 1,3)`}.`;

  box.innerHTML = `<div class="iso-card">
    <div class="iso-top"><h3>Zasięg ${o.point ? 'z zaznaczonego miejsca' : `z przystanku ${esc(o.name)}`}</h3><button type="button" class="link-btn" data-iso="off" title="Wyłącz zasięg (Esc)">Wyłącz</button></div>
    ${modeHtml}${paramsHtml}
    <div class="iso-row"><label for="iso-t">Czas</label><input type="range" id="iso-t" min="10" max="60" step="5" value="${state.iso.T}"><b>${state.iso.T} min</b></div>
    <div class="iso-sum">${anyRide ? 'Dojedziesz' : 'Dojdziesz pieszo'} do <b>${reached.length}</b> ${reached.length === 1 ? 'przystanku' : 'przystanków'}, najdalej ${far.length ? km(far[0].d) : '—'} w linii prostej.</div>
    ${tm && state.iso.rides === 0 ? '<div class="iso-next" id="iso-next">Sprawdzam najbliższy odjazd…</div>' : ''}
    <div class="iso-legend">${state.iso.bands.map((b, i) =>
      `<i style="background:${b.color}"></i><span>${b.lo}–${b.hi} min</span><span>${counts[i]} przyst.</span>`).join('')}</div>
    <div class="iso-ramp" aria-hidden="true"><div class="ir-bar">${state.iso.bands.map(b => `<i style="background:${b.color}"></i>`).join('')}</div>
      <div class="ir-lab"><span>0</span>${state.iso.bands.map((b, i) => `<span>${b.hi}${i === state.iso.bands.length - 1 ? ' min' : ''}</span>`).join('')}</div></div>
    <div class="iso-tip">Stuknij miejsce na mapie — pokażę czas i trasę.</div>
    <div class="iso-next iso-hint" style="margin:10px 0 0"><b>Kliknij miejsce na mapie</b> — pokażę czas i trasę${COARSE ? '' : ' (albo tylko najedź kursorem)'}, a „Sprawdź to miejsce” w dymku zrobi z niego nowy start. Zasięg zostaje włączony.</div>
    <div class="muted" style="margin-top:10px">${note}</div>
  </div>`;
  const inp = document.getElementById('iso-t');
  let raf = 0;
  inp.addEventListener('input', () => {
    state.isoT = +inp.value;
    inp.nextElementSibling.textContent = state.isoT + ' min';
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => setIsoT(state.isoT));
  });
  // po puszczeniu suwaka: przelicz od razu (bez czekania na klatkę) i odśwież statystyki
  inp.addEventListener('change', () => {
    cancelAnimationFrame(raf);
    state.isoT = +inp.value;
    setIsoT(state.isoT);
    renderIsoBox();
    fitIsoView();
    syncURL(false);
    document.getElementById('iso-t')?.focus();
  });
  const ti = document.getElementById('iso-time');
  if (ti) ti.addEventListener('change', () => {
    const [h, m] = ti.value.split(':').map(Number);
    if (Number.isFinite(h) && Number.isFinite(m)) { state.isoTime = h * 60 + m; computeIso(); }
  });
  if (tm && state.iso.rides === 0) fillNextDeparture(o);
}
// gdy w limicie czasu nic nie odjeżdża: najbliższy odjazd z przystanków startowych (z deps/)
async function fillNextDeparture(o) {
  const el0 = document.getElementById('iso-next');
  if (!el0 || !state.iso || !state.iso.csa) return;
  const SI = STOP_INDEX(), prof = profileFor(state.isoDate);
  const starts = o.point
    ? o.poles.filter(p => p.tw != null && p.tw <= 20).map(p => ({ st: STOP_BY_ID.get(p.id), tw: p.tw }))
    : o.poles.map(p => ({ st: STOP_BY_ID.get(p.id), tw: 0 }));
  if (!starts.length || !prof) { el0.textContent = 'Z tego miejsca nie da się dojść pieszo do żadnego przystanku.'; return; }
  const cells = await Promise.all([...new Set(starts.map(x => cellOf(x.st)))].map(loadCell));
  let best = null;
  starts.forEach(({ st, tw }) => cells.forEach(cell => Object.entries(cell[st.id] || {}).forEach(([key, arr]) => arr.forEach(e => {
    (e.t[e.p[prof.p]] || []).forEach(m => {
      if (m >= state.isoTime + tw && (!best || m < best.m)) best = { m, key, h: e.h, name: st.name, tw };
    });
  }))));
  const el = document.getElementById('iso-next');
  if (!el) return;
  if (!best) {
    // kolejne dni (do tygodnia): pierwszy odjazd danego dnia
    for (let i = 1; i <= 7 && !best; i++) {
      const d = new Date(state.isoDate + 'T12:00'); d.setDate(d.getDate() + i);
      const date = localISO(d), pr = profileFor(date);
      if (!pr) continue;
      starts.forEach(({ st, tw }) => cells.forEach(cell => Object.entries(cell[st.id] || {}).forEach(([key, arr]) => arr.forEach(e => {
        (e.t[e.p[pr.p]] || []).forEach(m => {
          if (m >= tw && (!best || m < best.m)) best = { m, key, h: e.h, name: st.name, tw, date };
        });
      }))));
    }
    if (!best) { el.innerHTML = '<b>Stąd w najbliższym tygodniu nic nie odjeżdża.</b>'; return; }
    const tomorrow = (() => { const d = new Date(state.isoDate + 'T12:00'); d.setDate(d.getDate() + 1); return localISO(d); })();
    const dd = new Date(best.date + 'T12:00');
    const dayLabel = best.date === tomorrow ? 'jutro' : `${DOW[dd.getDay()]} ${dd.getDate()}.${String(dd.getMonth() + 1).padStart(2, '0')}`;
    const at = Math.max(0, Math.round(best.m - best.tw - 2));
    el.innerHTML = `<b>Tego dnia stąd już nic nie odjeżdża.</b> Najbliższy odjazd: ${dayLabel}, <b>${esc(best.key.split('|')[0])} o ${fmt(best.m)}</b>`
      + ` z ${esc(best.name)} → ${esc(best.h)}. <button type="button" class="link-btn" data-iso-goto="${best.date},${at}">Pokaż ${dayLabel} od ${fmt(at)}</button>`;
    return;
  }
  const wait = best.m - state.isoTime;
  el.innerHTML = `W ciągu ${state.iso.T} min nic stąd nie odjeżdża. <b>Najbliższy odjazd: ${esc(best.key.split('|')[0])} o ${fmt(best.m)}</b>`
    + ` (${zaMin(wait)}) z ${esc(best.name)} → ${esc(best.h)}. <button type="button" class="link-btn" data-iso-at="${Math.max(0, Math.round(best.m - best.tw - 2))}">Wyjdź o ${fmt(Math.max(0, Math.round(best.m - best.tw - 2)))}</button>`;
}
// wyłącza zasięg (✕ na chipie, „Wyłącz”, Esc, ← na telefonie)
export function turnOffIso() {
  clearIso();
  renderIsoBox();
  syncURL(true);
}
