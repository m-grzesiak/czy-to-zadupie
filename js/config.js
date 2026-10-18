// stopka panelu: z kiedy jest rozkład i na jakie dni
// przewoźnicy z meta.sources w dopełniaczu: „Rozkład ZTP i Kolei Małopolskich”
export const SRC_GEN = { 'ZTP Kraków': 'ZTP', 'Koleje Małopolskie': 'Kolei Małopolskich' };
// Przystanek = biała kropka z obwódką w kolorze tego, co tam jeździ (tramwaj / autobus; oba = tramwajowa).
// Biały środek i ciemna, nasycona obwódka odcinają się od każdego tła mapy (zabudowa, drogi, zieleń),
// a kolor od razu mówi, czy to przystanek tramwajowy. Przy zasięgu kropki są przygaszone.
export const STOP_TRAM = '#a8322d';
export const STOP_BUS = '#2a5f74';
export const STOP_TRAIN = '#5a3d8a';
export const STOP_COLOR = { tram: STOP_TRAM, bus: STOP_BUS, train: STOP_TRAIN };
// rodzaje transportu: kolejność w listach (pociągi, tramwaje, autobusy), nazwy i klasy chipów
const TYPE_ORDER = { train: 0, tram: 1, bus: 2 };
export const TYPE_NAME = { tram: 'Tramwaj', bus: 'Autobus', train: 'Pociąg' };
export const TYPE_CHIP = { tram: 't', bus: 'b', train: 'k' };
export const typeCmp = (a, b) => (TYPE_ORDER[a] ?? 9) - (TYPE_ORDER[b] ?? 9);
// ---------------------------------------------------------------------------
// Mapa zasięgu: "gdzie dojadę w N minut z tego przystanku"
// Model: jazda wg czasów z rozkładu + średnie czekanie (połowa odstępu kursów w dzień
// roboczy 6–20) + przesiadki pieszo do 500 m. Dijkstra po przystankach.
// ---------------------------------------------------------------------------
export const ISO_RAMP = ['#104281', '#1c5cab', '#2a78d6', '#5598e7', '#86b6ef'];
  // blisko -> daleko
export const WALK_MPM = 58;
          // m/min w linii prostej (~4,5 km/h × objazd 1,3)
export const WALK_MAX = 500;
         // maks. dojście / przesiadka piesza
export const WAIT_MAX = Infinity;
// Skąd liczymy: wybrany przystanek (start 0 min) albo zaznaczony punkt. Z punktu idziemy pieszo
// po ulicach bez limitu okręgu (promień z suwaka dotyczy tylko listy linii w pobliżu).
// poles = przystanki do ORIGIN_WALK_M w linii prostej: start trybu "wyjazd o godzinie" i trybu bez walk.bin.
export const ORIGIN_WALK_M = 2000;
// ---------------------------------------------------------------------------
// Sieć piesza z OSM (walk.bin). Gdy jest, zasięg liczymy jednym Dijkstrą po ulicach
// i liniach naraz: chodzenie po prawdziwych drogach, przystanek "przyklejony" do ulicy.
// Bez pliku — przybliżenie linią prostą × objazd (powyżej).
// ---------------------------------------------------------------------------
export const WALK_SPEED = 75;
// ===========================================================================
// Tryb "wyjazd o godzinie": Connection Scan po prawdziwych odjazdach z conns/.
// Jedno przejście po połączeniach posortowanych po odjeździe (kilka ms), potem
// ten sam Dijkstra pieszy co w trybie typowym rysuje obszar od osiągniętych przystanków.
// ===========================================================================
export const TRANSFER_MIN = 1;
// Czasy dojścia nie zależą od limitu, więc liczymy raz do maksimum suwaka,
// a zmiana czasu tylko filtruje i przerysowuje.
export const ISO_TMAX = 60;
export const REACH_T = 90;
                            // typowy dzień: liczymy do 90 min (cele typu lotnisko)
// Domyślnie dzień roboczy: przy ocenie miejsca liczą się dojazdy w tygodniu, nie dzisiejsza niedziela.
export const DAY_NAMES = { w: 'dzień roboczy', s: 'sobota', n: 'niedziela / święto' };
export const DAY_SHORT = { w: 'dzień roboczy', s: 'sobota', n: 'niedziela' };
// ---------------------------------------------------------------------------
// "Jak stąd dojedziesz": podsumowanie miejsca, czasy dojazdu do celów i własne miejsca.
// Czasy z modelu "typowy dzień" (średnie czekanie), liczone raz do REACH_T i wspólne z mapą zasięgu.
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
// Werdykt „Czy to zadupie?” + trzy liczby (nad promieniem, #place-head).
// Poziom 0–3 z kursów na godzinę w jedną stronę (6–20, suma linii dziennych z przystanków w okręgu,
// do których da się dojść) i dojścia do najbliższego przystanku.
// ---------------------------------------------------------------------------
export const VERDICT = ['Tak, to zadupie.', 'Trochę zadupie.', 'Raczej nie zadupie.', 'Nie, to nie zadupie.'];
export const VERDICT_SCALE = ['zadupie', 'da się żyć', 'dobrze', 'pępek świata'];
// ---------------------------------------------------------------------------
// Wyszukiwarka adresów (#search): wpisany adres = nowe miejsce do sprawdzenia (selectPoint z etykietą).
// Podpowiedzi z Photon (komoot, dane OSM) — Nominatim zabrania podpowiedzi przy pisaniu. Wyniki tylko
// z prostokąta danych (bbox), bliższe środka mapy wyżej. Na telefonie wpisywanie na całym ekranie (#app.search-open).
// ---------------------------------------------------------------------------
export const PHOTON_URL = 'https://photon.komoot.io/api/';
export const RECENT_KEY = 'mapa.ostatnieAdresy';
