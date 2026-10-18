import { SRC_GEN } from './config.js';
import { dataNote } from './dom.js';

// ---------------------------------------------------------------------------
// DANE ZAPASOWE (demo) — używane tylko gdy nie uda się wczytać stops_data.json
// (np. brak pliku obok, albo otwarcie przez file:// gdzie fetch() bywa blokowany
// przez CORS). Prawdziwa, pełna sieć ma siedzieć w osobnym pliku stops_data.json,
// wygenerowanym skryptem generate_stops_data.py z realnego eksportu GTFS.
// ---------------------------------------------------------------------------
const DEMO_STOPS = [
  { id: "dworzec_glowny", name: "Dworzec Główny", lat: 50.0677, lon: 19.9450,
    lines: [{ref:"1",type:"tram"},{ref:"4",type:"tram"},{ref:"14",type:"tram"},{ref:"20",type:"tram"},{ref:"71",type:"tram"},{ref:"73",type:"tram"}] },
  { id: "poczta_glowna", name: "Poczta Główna", lat: 50.0625, lon: 19.9385,
    lines: [{ref:"1",type:"tram"},{ref:"20",type:"tram"}] },
  { id: "rondo_mogilskie", name: "Rondo Mogilskie", lat: 50.0668, lon: 19.9548,
    lines: [{ref:"1",type:"tram"},{ref:"14",type:"tram"},{ref:"20",type:"tram"},{ref:"71",type:"tram"}] },
  { id: "rondo_grzegorzeckie", name: "Rondo Grzegórzeckie", lat: 50.0575, lon: 19.9530,
    lines: [{ref:"1",type:"tram"},{ref:"20",type:"tram"},{ref:"722",type:"bus"}] },
  { id: "filharmonia", name: "Filharmonia", lat: 50.0599, lon: 19.9391,
    lines: [{ref:"1",type:"tram"},{ref:"4",type:"tram"},{ref:"20",type:"tram"}] },
  { id: "teatr_bagatela", name: "Teatr Bagatela", lat: 50.0648, lon: 19.9414,
    lines: [{ref:"4",type:"tram"},{ref:"14",type:"tram"},{ref:"71",type:"tram"}] },
  { id: "stary_kleparz", name: "Stary Kleparz", lat: 50.0684, lon: 19.9384,
    lines: [{ref:"14",type:"tram"},{ref:"71",type:"tram"}] },
  { id: "plac_inwalidow", name: "Plac Inwalidów", lat: 50.0754, lon: 19.9308,
    lines: [{ref:"4",type:"tram"},{ref:"24",type:"tram"}] },
  { id: "starowislna", name: "ul. Starowiślna", lat: 50.0568, lon: 19.9452,
    lines: [{ref:"19",type:"tram"},{ref:"24",type:"tram"}] },
  { id: "rakowicka", name: "ul. Rakowicka", lat: 50.0700, lon: 19.9530,
    lines: [{ref:"19",type:"tram"}] },
  { id: "plac_wszystkich_swietych", name: "Plac Wszystkich Świętych", lat: 50.0587, lon: 19.9350,
    lines: [{ref:"124",type:"bus"},{ref:"152",type:"bus"}] },
  { id: "wawel", name: "Wawel (Stradom)", lat: 50.0524, lon: 19.9385,
    lines: [{ref:"6",type:"tram"},{ref:"8",type:"tram"},{ref:"10",type:"tram"},{ref:"13",type:"tram"},{ref:"18",type:"tram"}] },
];
// ---------------------------------------------------------------------------
// Mapa — zainicjowana dopiero po ustaleniu, jakich danych używamy (real vs demo)
// ---------------------------------------------------------------------------
export let STOPS = [];
export let STOP_BY_ID = new Map();
export let META = null;
const depsCache = new Map();
export let ROUTES = {};
let LINE_STOPS = null;
export const srcGen = src => (src && src.length ? src : ['ZTP Kraków']).map(x => SRC_GEN[x] || x).join(' i ');
// Dane demo nie mają osobnej geometrii tras — budujemy ją z kolejności przystanków
// w DEMO_STOPS. To jest przybliżenie (proste połączenie punktów), tylko do demonstracji.
function buildDemoRoutes(stops) {
  const acc = {};
  stops.forEach(s => s.lines.forEach(l => {
    const key = `${l.ref}|${l.type}`;
    if (!acc[key]) acc[key] = { ref: l.ref, type: l.type, color: null, points: [] };
    acc[key].points.push([s.lat, s.lon]);
  }));
  const routes = {};
  Object.entries(acc).forEach(([key, v]) => {
    if (v.points.length >= 2) routes[key] = { ref: v.ref, type: v.type, color: v.color, shapes: [v.points] };
  });
  return routes;
}
export function indexStops() { STOP_BY_ID = new Map(STOPS.map(s => [s.id, s])); }
export async function loadStops() {
  try {
    const res = await fetch('./stops_data.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('brak pliku');
    const json = await res.json();
    if (!Array.isArray(json.stops) || json.stops.length === 0) throw new Error('pusty plik');
    STOPS = json.stops;
    ROUTES = json.routes || {};
    META = json.meta || null;
    dataNote.hidden = true;   // pełne dane: bez komunikatu (zostaje tylko ostrzeżenie o danych demo)
  } catch (err) {
    STOPS = DEMO_STOPS;
    ROUTES = buildDemoRoutes(DEMO_STOPS);
    dataNote.hidden = false;
    dataNote.innerHTML = `<b>Dane przykładowe.</b> Nie znalazłem obok pliku <code>stops_data.json</code>
      (albo jest pusty), więc pokazuję garstkę realnych, dobrze znanych przystanków centrum —
      wystarczającą, żeby sprawdzić mechanikę „kliknij i zobacz linie w promieniu” oraz „kliknij linię,
      zobacz trasę”, ale nie pełną sieć (a jej narysowane trasy to tylko połączenie znanych przystanków,
      nie prawdziwy przebieg ulicami). Wygeneruj <code>stops_data.json</code> skryptem
      <code>generate_stops_data.py</code> z prawdziwego eksportu GTFS ZTP Kraków i połóż go w tym samym
      folderze co ten plik HTML.`;
  }
}
export function lineStops(key) {
  if (!LINE_STOPS) {
    LINE_STOPS = new Map();
    STOPS.forEach(s => s.lines.forEach(l => {
      const k = `${l.ref}|${l.type}`;
      if (!LINE_STOPS.has(k)) LINE_STOPS.set(k, []);
      LINE_STOPS.get(k).push(s);
    }));
  }
  return LINE_STOPS.get(key) || [];
}
export function routeColor(route) {
  return route.color ? ('#' + route.color.replace(/^#/, '')) : (route.type === 'tram' ? '#a8322d' : route.type === 'train' ? '#5a3d8a' : '#2a5f74');
}
export function servesLine(stop, key) {
  const [ref, type] = key.split('|');
  return stop.lines.some(l => l.ref === ref && l.type === type);
}
export function loadCell(cell) {
  if (!depsCache.has(cell)) {
    depsCache.set(cell, fetch(`./${META.deps.path}${cell}.json`)
      .then(r => r.ok ? r.json() : {}).catch(() => ({})));
  }
  return depsCache.get(cell);
}
export const cellOf = s => `${Math.floor(s.lat / META.deps.dlat)}_${Math.floor(s.lon / META.deps.dlon)}`;
// profil rozkładu dla daty; poza zakresem danych bierzemy ten sam dzień tygodnia
export function profileFor(iso) {
  const cal = META.calendar;
  if (iso in cal) return { p: cal[iso], approx: null };
  const dow = new Date(iso + 'T12:00').getDay();
  const days = Object.keys(cal).filter(d => new Date(d + 'T12:00').getDay() === dow);
  const d = days[days.length - 1];
  return d ? { p: cal[d], approx: d } : null;
}
// stacja kolejowa ma pierwszeństwo, potem przystanek tramwajowy
export function stopKind(s) {
  if (s._kind === undefined) s._kind = s.lines.some(l => l.type === 'train') ? 'train' : s.lines.some(l => l.type === 'tram') ? 'tram' : 'bus';
  return s._kind;
}
export const STOP_INDEX = () => (STOP_INDEX._m ||= new Map(STOPS.map((s, k) => [s.id, k])));
let hasHwCache = null;
export const hasHeadways = () => hasHwCache ?? (hasHwCache = Object.values(ROUTES).some(r => (r.trips || []).some(t => t && t.hw)));
// Linia nocna = żaden wariant nie ma odstępu kursów w godz. 6–20 (w danych ZTP to dokładnie 6xx, 9xx, 62, 69)
const nightCache = new Map();
export function isNight(key) {
  if (!nightCache.has(key)) {
    const r = ROUTES[key];
    // pociągi nie są liniami nocnymi, nawet gdy jeżdżą rzadko (pociąg nazwany 1–2 razy dziennie)
    nightCache.set(key, !!(r && r.type !== 'train' && r.trips && r.trips.length && !r.trips.some(t => t && (t.hw || t.hwS || t.hwN))));
  }
  return nightCache.get(key);
}
export function repDate(day) {
  const days = Object.keys(META.calendar).sort();
  const want = day === 's' ? [6] : day === 'n' ? [0] : [2, 3, 4, 1, 5];   // dzień roboczy: najlepiej wt–czw
  for (const w of want) { const d = days.find(x => new Date(x + 'T12:00').getDay() === w); if (d) return d; }
  return days[0];
}
