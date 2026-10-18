import { esc, fold, haversineMeters, loadList, saveJSON } from '../util.js';
import { PHOTON_URL, RECENT_KEY } from '../config.js';
import { SR_ICON } from '../icons.js';
import { appEl, isMobile } from '../dom.js';
import { dataBoundsBase, map, setViewVisible } from '../map/view.js';
import { closeRoute } from './line.js';
import { selectPoint } from './panel.js';

const srEl = document.getElementById('search');
const srInput = document.getElementById('sr-input');
const srList = document.getElementById('sr-list');
const srClear = document.getElementById('sr-clear');
const RECENT_MAX = 5;
let srState = { q: '', res: null };   // typed query and result: null, 'loading', 'error' or a list
let srItems = [];                     // selectable list rows (index = data-sr)
let srActive = -1;                    // row selected with the arrow keys
let srTimer = 0;
let srAbort = null;
let srEnter = false;                  // Enter while typing: pick the first result when it arrives
const srCache = new Map();            // query (case-insensitive, without Polish diacritics) → results
let srRecent = loadList(RECENT_KEY, p => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lon)).slice(0, RECENT_MAX);
const srTokens = q => fold(q).split(/[^a-z0-9]+/).filter(Boolean);
// bold the words that start with the typed fragments
function srMark(name, toks) {
  const on = new Array(name.length).fill(false);
  fold(name).replace(/[a-z0-9]+/g, (w, i) => {
    const t = toks.filter(t => w.startsWith(t)).reduce((m, t) => Math.max(m, t.length), 0);
    for (let k = i; k < i + t; k++) on[k] = true;
    return w;
  });
  let out = '', open = false;
  for (let k = 0; k < name.length; k++) {
    if (on[k] !== open) { out += on[k] ? '<b>' : '</b>'; open = on[k]; }
    out += esc(name[k]);
  }
  return out + (open ? '</b>' : '');
}
// stops and stations are on the map from the data, in address results they would only duplicate
const SR_SKIP_TYPE = new Set(['country', 'state', 'county']);
const SR_SKIP_VAL = new Set(['bus_stop', 'tram_stop', 'platform', 'stop_position', 'halt', 'station', 'stop']);
function photonItems(json) {
  const out = [], seen = new Set();
  (json.features || []).forEach(f => {
    const p = f.properties || {}, c = f.geometry && f.geometry.coordinates;
    if (!c || SR_SKIP_TYPE.has(p.type) || p.osm_key === 'public_transport' || SR_SKIP_VAL.has(p.osm_value)) return;
    const hn = p.housenumber, place = p.city || p.locality || p.district || '';
    let name, kind, zoom;
    if (hn && !p.name) { name = `${p.street || p.locality || p.district || p.city || ''} ${hn}`.trim(); kind = 'addr'; zoom = 17; }
    else if (!p.name) return;
    else if (p.type === 'street') { name = p.name; kind = 'street'; zoom = 16; }
    else if (p.type === 'city') { name = p.name; kind = 'area'; zoom = 14; }
    else if (p.type === 'district' || p.type === 'locality') { name = p.name; kind = 'area'; zoom = 15; }
    else { name = p.name; kind = 'addr'; zoom = 17; }   // named place: school, shop, building…
    // second line: street of the named place, district / estate, town (without repeating the name)
    const sub = [];
    if (p.name && p.street) sub.push(p.street + (hn ? ' ' + hn : ''));
    [p.district || p.locality, p.city || (p.type === 'city' ? p.county : '')].forEach(x => {
      if (x && x !== name && !sub.includes(x)) sub.push(x);
    });
    // a street in OSM is many segments — one result per name and town
    const key = `${kind}|${fold(name)}|${fold(place)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, name, sub: sub.join(', '), lat: c[1], lon: c[0], zoom });
  });
  return out.slice(0, 7);
}
function photonUrl(q) {
  const p = new URLSearchParams({ q, limit: '15', lang: 'default' });
  if (dataBoundsBase) p.set('bbox', [dataBoundsBase.getWest(), dataBoundsBase.getSouth(), dataBoundsBase.getEast(), dataBoundsBase.getNorth()].map(v => v.toFixed(4)).join(','));
  if (map) { const c = map.getCenter(); p.set('lat', c.lat.toFixed(4)); p.set('lon', c.lng.toFixed(4)); }
  return PHOTON_URL + '?' + p;
}
async function fetchPhoton(q) {
  clearTimeout(srTimer);
  if (srAbort) srAbort.abort();
  const ctl = srAbort = new AbortController(), key = fold(q);
  let res = 'error';
  try {
    const r = await fetch(photonUrl(q), { signal: ctl.signal });
    if (r.ok) { res = photonItems(await r.json()); srCache.set(key, res); }
  } catch (e) { if (e.name === 'AbortError') return; }
  if (srAbort === ctl) srAbort = null;
  if (srState.q !== q) return;
  srState.res = res;
  renderSr();
  if (srEnter) { srEnter = false; if (srItems.length) srChoose(srItems[0]); }
}
function onSrInput() {
  const q = srInput.value.trim();
  srClear.hidden = !srInput.value;
  clearTimeout(srTimer);
  if (srAbort) { srAbort.abort(); srAbort = null; }
  srEnter = false;
  srActive = -1;
  srState = { q, res: null };
  if (q.length >= 3) {
    const key = fold(q);
    if (srCache.has(key)) srState.res = srCache.get(key);
    else { srState.res = 'loading'; srTimer = setTimeout(() => fetchPhoton(q), 250); }
  }
  renderSr();
}
// clears the field (and the result list)
function srReset() {
  srInput.value = '';
  onSrInput();
}
function renderSr() {
  const { q, res } = srState, toks = srTokens(q);
  let html = '';
  srItems = [];
  const row = (it, icon, nameHtml) => {
    const i = srItems.push(it) - 1;
    return `<li class="sr-it${i === srActive ? ' on' : ''}" id="sr-o${i}" role="option" aria-selected="${i === srActive}" data-sr="${i}">`
      + `${SR_ICON[icon]}<span class="sr-n">${nameHtml}</span>${it.sub ? `<span class="sr-m">${esc(it.sub)}</span>` : ''}</li>`;
  };
  if (!q) {
    if (srRecent.length) html = '<li class="sr-h" role="presentation">Ostatnio sprawdzane</li>' + srRecent.map(it => row(it, 'recent', esc(it.name))).join('');
  } else if (q.length < 3) {
    html = '<li class="sr-st" role="presentation">Wpisz jeszcze trochę — ulicę i numer, np. „Karmelicka 12”.</li>';
  } else if (res === 'loading') {
    html = '<li class="sr-st" role="presentation"><i></i>Szukam…</li>';
  } else if (res === 'error') {
    html = '<li class="sr-st" role="presentation">Wyszukiwarka adresów nie odpowiada. Spróbuj za chwilę albo kliknij miejsce na mapie.</li>';
  } else if (res && !res.length) {
    html = '<li class="sr-st" role="presentation">Nie znalazłem tego adresu w Krakowie ani okolicy. Sprawdź pisownię albo kliknij miejsce na mapie.</li>';
  } else if (res) {
    html = res.map(it => row(it, it.kind, srMark(it.name, toks))).join('')
      + '<li class="sr-attr" role="presentation">Adresy: Photon · © OpenStreetMap</li>';
  }
  srList.innerHTML = html;
  const open = !!html && (document.activeElement === srInput || appEl.classList.contains('search-open'));
  srList.hidden = !open;
  srInput.setAttribute('aria-expanded', String(open && srItems.length > 0));
  if (srActive >= 0) srInput.setAttribute('aria-activedescendant', 'sr-o' + srActive);
  else srInput.removeAttribute('aria-activedescendant');
}
function srRemember(it) {
  srRecent = [{ name: it.name, sub: it.sub || '', lat: it.lat, lon: it.lon, zoom: it.zoom }]
    .concat(srRecent.filter(p => p.name !== it.name || haversineMeters(p.lat, p.lon, it.lat, it.lon) > 30)).slice(0, RECENT_MAX);
  saveJSON(RECENT_KEY, srRecent);
}
function srChoose(it) {
  if (!it || !map) return;
  srRemember(it);
  srReset();
  srDismiss();
  const ll = L.latLng(it.lat, it.lon);
  closeRoute();
  selectPoint(ll, { label: it.name });
  setViewVisible(ll, it.zoom || 16);
}
function srOpen() {
  if (isMobile()) appEl.classList.add('search-open');
  renderSr();
}
function srClose() {
  appEl.classList.remove('search-open');
  srList.hidden = true;
  srInput.setAttribute('aria-expanded', 'false');
}
// closing the list and leaving the field
function srDismiss() {
  srClose();
  srInput.blur();
}
// magnifier on phones, „/” on the keyboard
function srFocus() {
  srOpen();
  srInput.focus();
  srInput.select();
}
srInput.addEventListener('input', onSrInput);
srInput.addEventListener('focus', srOpen);
srInput.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!srItems.length) return;
    e.preventDefault();
    const n = srItems.length;
    srActive = e.key === 'ArrowDown' ? (srActive + 1) % n : (srActive <= 0 ? n - 1 : srActive - 1);
    renderSr();
    document.getElementById('sr-o' + srActive)?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (srActive >= 0) srChoose(srItems[srActive]);
    // Enter while typing: don't wait for the delay, take the first result when it arrives
    else if (srState.res === 'loading') { srEnter = true; fetchPhoton(srState.q); }
    else if (Array.isArray(srState.res)) srChoose(srItems[0]);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    if (srInput.value) srReset();
    else srDismiss();
  }
});
// clicking a result does not take focus from the field (otherwise the list would vanish before the click)
srList.addEventListener('mousedown', e => e.preventDefault());
srList.addEventListener('click', e => {
  const li = e.target.closest('[data-sr]');
  if (li) srChoose(srItems[+li.dataset.sr]);
});
srEl.addEventListener('focusout', e => { if (!isMobile() && !srEl.contains(e.relatedTarget)) srClose(); });
srClear.addEventListener('click', () => { srReset(); srInput.focus(); });
document.getElementById('sr-close').addEventListener('click', srDismiss);
document.getElementById('m-search').addEventListener('click', srFocus);
document.addEventListener('keydown', e => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || (e.target.matches && e.target.matches('input, select, textarea'))) return;
  e.preventDefault();
  srFocus();
});
