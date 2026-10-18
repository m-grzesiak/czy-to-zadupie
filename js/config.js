// panel footer: when the timetable is from and which days it covers
// operators from meta.sources in the Polish genitive: „Rozkład ZTP i Kolei Małopolskich”
export const SRC_GEN = { 'ZTP Kraków': 'ZTP', 'Koleje Małopolskie': 'Kolei Małopolskich' };
// Stop = white dot with an outline in the colour of what serves it (tram / bus; both = tram).
// The white centre and dark, saturated outline stand out on any map background (buildings, roads, greenery),
// and the colour tells at once whether it is a tram stop. With the reach area on, dots are dimmed.
export const STOP_TRAM = '#a8322d';
export const STOP_BUS = '#2a5f74';
export const STOP_TRAIN = '#5a3d8a';
export const STOP_COLOR = { tram: STOP_TRAM, bus: STOP_BUS, train: STOP_TRAIN };
// transport modes: order in lists (trains, trams, buses), names and chip classes
const TYPE_ORDER = { train: 0, tram: 1, bus: 2 };
export const TYPE_NAME = { tram: 'Tramwaj', bus: 'Autobus', train: 'Pociąg' };
export const TYPE_CHIP = { tram: 't', bus: 'b', train: 'k' };
export const typeCmp = (a, b) => (TYPE_ORDER[a] ?? 9) - (TYPE_ORDER[b] ?? 9);
// ---------------------------------------------------------------------------
// Reach area map: "where can I get in N minutes from this stop"
// Model: ride times from the timetable + average wait (half the headway on a
// weekday 6–20) + walking transfers up to 500 m. Dijkstra over stops.
// ---------------------------------------------------------------------------
export const ISO_RAMP = ['#104281', '#1c5cab', '#2a78d6', '#5598e7', '#86b6ef'];
  // near -> far
export const WALK_MPM = 58;
          // m/min as the crow flies (~4.5 km/h × detour 1.3)
export const WALK_MAX = 500;
         // max walk to a stop / walking transfer
export const WAIT_MAX = Infinity;
// Origin: the selected stop (start at 0 min) or a marked point. From a point we walk
// along streets with no circle limit (the slider radius only applies to the list of nearby lines).
// poles = stops within ORIGIN_WALK_M as the crow flies: start of "depart at time" mode and of the mode without walk.bin.
export const ORIGIN_WALK_M = 2000;
// ---------------------------------------------------------------------------
// Walking network from OSM (walk.bin). When present, the reach area is one Dijkstra over streets
// and lines at once: walking on real roads, each stop "snapped" to a street.
// Without the file: straight-line approximation × detour (above).
// ---------------------------------------------------------------------------
export const WALK_SPEED = 75;
// ===========================================================================
// "Depart at time" mode: Connection Scan over real departures from conns/.
// One pass over connections sorted by departure (a few ms), then
// the same walking Dijkstra as in typical mode draws the area from the reached stops.
// ===========================================================================
export const TRANSFER_MIN = 1;
// Arrival times do not depend on the limit, so we compute once up to the slider maximum,
// and changing the time only filters and redraws.
export const ISO_TMAX = 60;
export const REACH_T = 90;
                            // typical day: compute up to 90 min (destinations like the airport)
// Weekday by default: rating a place is about weekday trips, not today's Sunday.
export const DAY_NAMES = { w: 'dzień roboczy', s: 'sobota', n: 'niedziela / święto' };
export const DAY_SHORT = { w: 'dzień roboczy', s: 'sobota', n: 'niedziela' };
// ---------------------------------------------------------------------------
// "Jak stąd dojedziesz": place summary, travel times to destinations and the user's own places.
// Times from the "typical day" model (average wait), computed once up to REACH_T and shared with the reach area map.
// ---------------------------------------------------------------------------
export const DESTS = [
  { name: 'Rynek Główny', lat: 50.06170, lon: 19.93730 },
  { name: 'Dworzec Główny', lat: 50.06770, lon: 19.94740 },
  { name: 'AGH (al. Mickiewicza)', lat: 50.06540, lon: 19.92290 },
  { name: 'Kampus UJ (Ruczaj)', lat: 50.02464, lon: 19.90251 },
  { name: 'Nowa Huta, pl. Centralny', lat: 50.07180, lon: 20.03760 },
  { name: 'Lotnisko Balice', lat: 50.07163, lon: 19.80018 },
];
export const PLACES_KEY = 'mapa.mojeMiejsca';
// ---------------------------------------------------------------------------
// „Czy to zadupie?” verdict + three numbers (above the radius, #place-head).
// Level 0–3 from departures per hour in one direction (6–20, sum of daytime lines from reachable stops
// in the circle) and the walk to the nearest stop.
// ---------------------------------------------------------------------------
export const VERDICT = ['Tak, to zadupie.', 'Trochę zadupie.', 'Raczej nie zadupie.', 'Nie, to nie zadupie.'];
export const VERDICT_SCALE = ['zadupie', 'da się żyć', 'dobrze', 'pępek świata'];
// ---------------------------------------------------------------------------
// Address search (#search): an entered address = new place to check (selectPoint with a label).
// Suggestions from Photon (komoot, OSM data); Nominatim forbids search-as-you-type. Results only
// from the data rectangle (bbox), those closer to the map centre ranked higher. On phones, typing is full screen (#app.search-open).
// ---------------------------------------------------------------------------
export const PHOTON_URL = 'https://photon.komoot.io/api/';
export const RECENT_KEY = 'mapa.ostatnieAdresy';
