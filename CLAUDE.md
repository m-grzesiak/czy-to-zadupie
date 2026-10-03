# CLAUDE.md — „Czy to zadupie?” (mapa komunikacji Kraków)

Kontekst dla asystenta pracującego nad tym projektem. Instrukcja aktualizacji danych dla człowieka jest w `README.md`.

## Co to jest

Statyczna strona dla Krakowa i aglomeracji (bez serwera i bazy), jeden plik `index.html` z Leaflet 1.9.4 z cdnjs i kafelkami tile.openstreetmap.org. Dane przygotowują z góry skrypty w Pythonie. Nazwa strony: „Czy to zadupie?”. Repo https://github.com/m-grzesiak/czy-to-zadupie, hosting na GitHub Pages: https://m-grzesiak.github.io/czy-to-zadupie/ (`.github/workflows/pages.yml` kopiuje stronę i dane do `public/`; `.gitlab-ci.yml` to zapas dla GitLab Pages), bez własnej domeny.

Funkcje:
- **Klik w punkt:** linie w promieniu (suwak 200–2000 m, domyślnie 500 m) i lista przystanków w okręgu, posortowana po dojściu pieszym. Promień dotyczy tylko listy linii — zasięg i dojazdy liczą chodzenie po ulicach bez limitu okręgu. Gdy w okręgu nie ma przystanku: 3 najbliższe (`nearestOutside`) i przycisk powiększenia promienia.
- **Karta „Jak stąd dojedziesz”** (`renderPlaceCard`, w punkcie na górze panelu, w przystanku pod odjazdami):
  - najbliższy przystanek (pieszo), kursy na godzinę w jedną stronę (suma linii dziennych, 6–20), najczęstsza linia, pierwszy i ostatni kurs dzienny, liczba linii nocnych — z `lineStats` (deps/ dla reprezentatywnego dnia `repDate`),
  - czasy dojazdu do stałych celów `DESTS` i „Moich miejsc” (`localStorage` `mapa.mojeMiejsca`), model „typowy dzień”,
  - typ dnia (`#day-type`, domyślnie dzień roboczy) jest wspólny z częstotliwością i zasięgiem „typowy dzień” (`setDayType`).
- **Linie:** nocne w osobnej grupie (`isNight`: żaden wariant nie ma `hw*`, w danych ZTP to 6xx, 9xx, 62, 69) i poza licznikiem w tytule; przy numerze „co X min” (`hwText`, odstęp z najczęściej obsługiwanego słupka w 6–20).
- **Cel podróży** (`target`, `setTarget`, `renderTargetBox`, `drawTarget`): klik na mapie lub w przystanek w trybie zasięgu albo po „Wskaż własny cel”, wiersz listy celów, link `cel=`. Trasa z `routeTo` (kontekst `iso`, jeśli włączony, inaczej `reach`), czas przy pinezce. „Zapisz jako moje miejsce”, „Sprawdź to miejsce” (`targetAsOrigin`: cel staje się startem, zasięg zostaje; cel-przystanek otwiera się jako przystanek, `target.stopId`).
  - **Dymek przy celu** (`renderTargetPop`, `targetPopOn`): po kliknięciu w mapę lub przystanek pokazuje czas, linię / przesiadki i przycisk „Sprawdź to miejsce” (nowy start jednym kliknięciem). × zamyka dymek, cel zostaje. Cel z listy celów albo z linku (`cel=`) jest bez dymka. Karta hovera nie pokazuje się w promieniu 90 px od otwartego dymka.
- **Pinezka startu** jest przeciągana (`addOriginMarker`, `dragend` → `selectPoint`). Włączony zasięg zostaje po zmianie miejsca.
- **„← Wróć do: …”** nad tytułem panelu (`placeHist`, `rememberPlace`, `backToPlace`, `renderBackPlace`): poprzednie miejsca startu (do 20), powrót zostawia zasięg i cel. Nie zapisuje się w trakcie `applyingState` ani samego powrotu.
- **Chip zasięgu na mapie** (prawy górny róg, `renderIsoChip`, `onIsoChip`, `applyIsoT`): bez zasięgu „Zasięg N min” (włącza), z zasięgiem typ dnia / godzina wyjścia, − N min + (co 5 min, 10–60) i ✕ (wyłącza, jak Esc). Ukryty bez wybranego miejsca.
- **Esc** kolejno: wskazywanie celu → cel → linia → zasięg.
- **Granice mapy:** `setMaxBounds` (`applyMaxBounds`) = prostokąt wszystkich przystanków + 6% marginesu (twarda krawędź, `maxBoundsViscosity` 1), na telefonie z zapasem na dole (wysokość obszaru) i 12% u góry. `minZoom` z `getBoundsZoom` — przy najmniejszym przybliżeniu widać cały obszar danych (desktop zoom 10, telefon 9), przeliczane na `resize`.
- **Przycisk lokalizacji** (pod + −, na telefonie prawy górny róg; też „Sprawdź, gdzie jestem” w pustym panelu, `data-locate`): `navigator.geolocation` → `selectPoint`. Błędy i „poza obszarem danych” w `#notice`.
- **Klik w przystanek:** tablica najbliższych odjazdów na górze (8 wierszy, „Pokaż więcej” +16, do 3 h do przodu), pod nią linie; wcześniej 16 wierszy, „Pokaż więcej” do 3 h do przodu) z numerem słupka ZTP (01, 02…). Te same numery są etykietami na mapie (widoczne od zoomu 16, a poniżej tylko ta z wiersza pod kursorem).
- **Klik lub hover na linię:** trasa ze wszystkimi przystankami. Szczegóły linii (`renderLineDetail`): nagłówek z ✕, przełącznik kierunku (`data-dir`, `pickDir` = wariant z tym headsignem, w którym przystanek jest najwcześniej), 4 najbliższe odjazdy w tym kierunku jako kafelki (`renderLdNext`; kafelek = wybrany kurs `ldKurs`), zakładki „Trasa i czasy” (`renderLdPane`: przystanki z „+N min” i godziną dla wybranego kursu, wcześniejsze zwinięte) i „Rozkład” (`renderLdTimetable`: dni + tabela w wybranym kierunku, dziś wcześniejsze godziny zwinięte, kursy skrócone z „°”). Odjazdy: `lineDepsFor` (deps/ po headsignie, pamięć `ldCache`), kierunek kursu skróconego z `depDir`.
- **Werdykt „Czy to zadupie?”** (`renderPlaceHead` w `#place-head`, nad promieniem; woła go `renderPlaceCard`): poziom 0–3 (`verdictLevel`) z `placeStats.perHour` (≥30 / ≥10 / ≥3 kursów na godzinę) obniżany przez dojście do najbliższego przystanku (>10 / >15 / >25 min), skala „zadupie · da się żyć · dobrze · pępek świata” i trzy kafelki (kursy na godzinę, minuty pieszo albo w przystanku najczęstsza linia, liczba linii + nocne). Liczony z przystanków w okręgu, więc zależy od promienia.
- **Telefon (do 760 px):** mapa na cały ekran, panel jako arkusz od dołu (CSS w `@media (max-width: 760px)`, JS: `updateSheet`, `setSheet`, `sheetPx`, `viewBounds`, `fitPad`, `panToVisible`, `revealFocus`):
  - bez miejsca karta startowa (`#app.st-empty`: tytuł nad mapą, „Sprawdź, gdzie jestem”, przykłady),
  - po stuknięciu niski arkusz `#layout.sheet-peek` (werdykt, kafelki, promień jako 4 przyciski `.rseg`), uchwyt / przesunięcie palcem → `sheet-full`; zakładki `.ptabs` / `.tabp` (punkt: Dojazdy, Linie, Przystanki; przystanek: Odjazdy, Linie, Dojazdy; na komputerze ukryte, wszystko pod sobą),
  - wybrana linia: `#panel.line-open` (sam `#line-detail`), zasięg: `#panel.iso-open` (niski arkusz o stałej wysokości z `#iso-box` i `#target-box`: legenda jako pasek `.iso-ramp` zamiast listy pasm, żeby arkusz nie rósł z liczbą pasm; dymek celu ukryty, cel pokazuje karta),
  - przycisk `#m-back` w lewym górnym rogu: × zamyka miejsce (`closePlace`), z linii / zasięgu „← Okolica”; lokalizacja i chip zasięgu w prawym górnym rogu, przyciski + − w prawym dolnym rogu nad arkuszem (`ZoomControl`, `zoomVisible`: przybliżają wokół środka widocznej części mapy),
  - `--sheet-h` (ResizeObserver) podnosi legendę, atrybucję i + − nad arkusz; dopasowania widoku (trasa, zasięg, cel, powrót, `setViewVisible` dla przykładów, lokalizacji i linku) liczą widoczną część mapy bez arkusza; `sheetPx` dla „peek” / „full” bierze docelową wysokość z CSS, nie chwilową z animacji.
- **Mapa zasięgu „Gdzie dojadę w N min”**, z przystanku albo z punktu (z punktu: jeden Dijkstra od najbliższej ulicy, chodzenie bez limitu okręgu):
  - obszar wzdłuż osiągalnych ulic,
  - hover na przystanek lub dowolne miejsce pokazuje czas i trasę (przejazdy + kropkowane przejścia),
  - klik w mapę lub przystanek ustawia cel z dymkiem (nie wyłącza zasięgu, nie zmienia startu); „Sprawdź to miejsce” w dymku przenosi start — działa też na dotyku, gdzie nie ma hovera (sztuczny `mousemove` po stuknięciu jest ignorowany przez 1 s),
  - włączenie zasięgu przyciskiem w panelu przewija do suwaka czasu; po zmianie rozmiaru mapy (obrót telefonu, rozwinięcie panelu) pinezka startu wraca do widoku.
- **Interfejs:** po polsku, z polską odmianą liczebników (np. „2 przystanki / 5 przystanków”).
- **Stopka panelu** (`renderDataInfo`): data generowania i zakres dni rozkładu z `meta`; po końcu zakresu ostrzeżenie „Rozkład jest nieaktualny”.
- **Adres strony:** hash `#s=<stopId>` albo `#p=<lat>,<lon>&r=<m>`, do tego `l=<ref|type>` albo `iso=<min>` (+ `dzien=w|s|n` albo `d=RRRR-MM-DD&t=GG:MM`), `dzien` także bez zasięgu (gdy nie roboczy), `cel=<lat>,<lon>`. Link do udostępnienia, „Wstecz” działa.

## Pliki

| Plik | Rola |
|---|---|
| `index.html` | cała strona: HTML + CSS + JS w jednym pliku (dawniej `krakow-transit-map.html`) |
| `.github/workflows/pages.yml` | publikacja na GitHub Pages |
| `.gitlab-ci.yml` | publikacja na GitLab Pages (zapas) |
| `stops_data.json` | `{meta, stops, routes}`, wczytywany przy starcie |
| `deps/<y>_<x>.json` | odjazdy w komórkach siatki 0,02° × 0,03°, pobierane na żądanie |
| `walk.bin` | binarny graf pieszy, pobierany przy pierwszym kliknięciu punktu lub użyciu zasięgu |
| `transfers.bin` | przesiadki piesze przystanek → przystanek do 500 m ulicami (CSR, uint16) |
| `conns/p<P>_<okno>.bin`, `conns/p<P>_trips.bin` | połączenia do trybu „wyjazd o godzinie” |
| `generate_stops_data.py` | GTFS ZTP → `stops_data.json` + `deps/` (tylko biblioteka standardowa) |
| `build_walk_graph.py` | OSM (Overpass JSON albo `.osm.pbf` przez pyosmium) → `walk.bin` + pole `w` w przystankach |
| `download_walk.sh` | pobiera sieć pieszą z Overpass w 12 kawałkach do `walk_osm/` |

Kolejność zawsze: `generate_stops_data.py`, potem `build_walk_graph.py`. Pierwszy nadpisuje `stops_data.json` i gubi pole `w`, czyli przypisanie przystanku do węzła sieci ulic.

## Źródła danych

- **GTFS ZTP** z https://gtfs.ztp.krakow.pl/:
  - `GTFS_KRK_A.zip`: autobusy MPK, miasto + gminy,
  - `GTFS_KRK_T.zip`: tramwaje, `route_type` 900,
  - `GTFS_KRK_M.zip`: autobusy Mobilis.
- **Specyfika ZTP:**
  - `calendar.txt` ma same zera, dni kursowania są wyłącznie w `calendar_dates.txt`,
  - jeden feed potrafi zawierać kilka wersji rozkładu (np. `service_id` 20260923_* i 20260926_*), więc liczą się tylko kursy aktywne w oknie dat,
  - autobusy mają `route_color=FFFFFF`, więc białe i czarne kolory są ignorowane,
  - `route_long_name` = numer linii, więc nazwa trasy jest składana z `trip_headsign`,
  - numeryczne `stop_id` w A i M mogą kolidować: przy tym samym ID dalej niż 30 m od siebie dostają prefiks feedu.
- **OSM:** zapytanie jest w `download_walk.sh`, obszar 49.89–50.26 N, 19.57–20.37 E. Publiczne Overpass bywa przeciążone („too busy”, 406), stąd kawałki, limit czasu i serwery zapasowe.

## Formaty danych

- **`stops[]`:** `{id, name, lat, lon, c, lines:[{ref,type}], w:[nodeIdx, snapMeters]}`. Jeden rekord to słupek. Przystanek w UI = słupki o tej samej nazwie w promieniu 400 m. `c` to numer słupka z tablicy ZTP („01”), z `stop_code` („802-01”) albo zapasowo `stop_desc`. Słupki tramwajowy i autobusowy o tym samym numerze to to samo miejsce (jedna etykieta na mapie).
- **`routes["ref|type"]`:** `{ref, type, color, name, shapes:[[[lat,lon]…]], trips:[{h, s:[[stopId, offMin]], hw}]}`. `trips[i]` odpowiada `shapes[i]`. `hw` to średni odstęp kursów (min) w wt–czw 6:00–20:00, używany przez mapę zasięgu.
- **Warianty:** do 4 najczęstszych (po równo z kierunków), plus dobór rzadkich, aż każdy przystanek linii jest w którymś wariancie. Bez tego rzadkie warianty znikały z trasy, czasów i zasięgu (błąd z linią 235 i Ochodzą Odwiśle).
- **`meta`:** `{generated, calendar:{"RRRR-MM-DD": profil}, deps:{dlat, dlon, path}, walk:{path, nodes, edges}}`. Profil to zestaw aktywnych `service_id`, dni o tym samym zestawie mają wspólny profil.
- **`deps` komórka:** `{stopId: {"ref|type": [{h, t:[[minuty…]…], p:[indeks listy dla profilu]}]}}`. Minuty od północy, mogą przekraczać 1440 (kursy po północy). Identyczne listy są zapisane raz.
- **`walk.bin`** (little-endian): nagłówek `'WLK1', N, E, G`, potem kolejno:
  - `int32 nodes[2N]` (×1e6),
  - `uint32 ends[2E]`,
  - `uint32 goff[E+1]`,
  - `int32 geom[2G]`,
  - `uint16 len[E]` (metry po ulicy).

  Stopnie 2 są zwinięte do krawędzi z geometrią. Krawędzie są dzielone w miejscu przyklejenia przystanku.
- **`transfers.bin`:** `'TRF1', S, M`, potem `uint32 start[S+1]`, `uint16 to[M]`, `uint16 metry[M]`. Indeks przystanku = pozycja w `stops[]`, zależy od kolejności z `generate_stops_data.py`, więc budować zawsze po nim.
- **`conns/p<P>_<c>.bin`:** rekordy `uint16 × 5` (z, do, odjazd, przyjazd, kurs), posortowane po odjeździe. Okno `c` = floor(odjazd / 120). Minuty mogą przekraczać 1440.
- **`conns/p<P>_trips.bin`:** `uint16 × 2` na kurs (indeks w `meta.conns.routes`, indeks w `meta.conns.heads`). Dostępne okna są w `meta.conns.chunks[P]`. `pickup_type` / `drop_off_type` są w połączeniach ignorowane.
- **`routes[].trips[i]`:** `hw`, `hwS`, `hwN` to średni odstęp kursów (min) w dzień roboczy (wt–czw), sobotę i niedzielę, 6:00–20:00.

## Architektura JS (najważniejsze funkcje)

- **Stan:** `STOPS`, `ROUTES`, `META`, `stopMode` (widok przystanku) / `radiusCircle` (widok punktu), `selectedRouteKey`, `iso`, `reach` (typowy dzień z miejsca do `REACH_T` = 90 min), `placeStats`, `target`, `pickingTarget`, `isoDay`.
- **Widoki:** `selectPoint` → `recompute` → `renderPanel` → `refreshPlace`; `selectStop` → `renderStopPanel` + `renderBoard` + `refreshPlace` (+ `drawPoleLabels`, `hotPole` przy hoverze wiersza); pusty widok `showEmpty`.
- **Adres:** każda zmiana widoku woła `syncURL(push)` (odroczone `setTimeout 0`, kilka wywołań w jednym kroku = jeden wpis historii). `stateHash` buduje hash, `applyState` odtwarza widok przy starcie i na `popstate`; w trakcie `applyingState` nic nie trafia do historii.
- **Kropki przystanków:** `baseStopStyle` / `restyleStops` — rozmiar zależy od zoomu, przy aktywnym zasięgu są przygaszone.
- **Linia:** `selectRoute` → `drawRoute` (+ `buildRouteStops`), `renderLineDetail` → `renderDeps`. Hover na numer to `showPreview`.
  - grubość trasy i kółek jej przystanków z przybliżenia (`routeW`, przeliczane w `styleVariants` na `zoomend`), strzałki kierunku na wybranym wariancie co ~90 px (`drawRouteArrows`, pomijane przy kółkach przystanków); przy wybranej linii pozostałe przystanki są przygaszone jak przy zasięgu.
- **Zasięg:** `computeIso` (ładuje `walk.bin` przez `loadWalk`) → `recalcIso` → `runIsoWalk` → `walkDijkstra`. Dijkstra działa po węzłach ulic (0..N−1) i przystankach (N..N+S−1) z `TypedHeap`.
  - Typowy dzień liczy się raz do `REACH_T` = 90 min przez `typicalRun` (pamięć ostatniego wyniku po miejscu i typie dnia), wspólnie z listą celów; tryb czasu do `ISO_TMAX` = 60 min. Suwak woła tylko `setIsoT`, czyli filtruje i przerysowuje.
  - `refreshPlace` najpierw rysuje panel, a `reach` liczy w następnym zadaniu (`setTimeout 0`), żeby klik był natychmiastowy.
  - Rysowanie to `IsoTiles` (L.GridLayer) + `drawIsoTile` z indeksem krawędzi `edgeIndex`.
  - Ścieżki: `walkLegsFrom(v, C)`, `legLayers` / `drawLegs`, `routeTo(C, lat, lon)`; `C` to kontekst `{o, res, walk1, csa}` — `iso` albo `reach` (też `legsText`, `csaLegs`, `csaRideInfo`). Hover w dowolnym miejscu: `pointHover` z `bestReachableNode`. Opis etapów (`legsText`): każdy przejazd w osobnym wierszu z przystankiem wsiadania i wysiadania, liczbą przystanków, czasem jazdy i czekaniem.
  - Włączenie zasięgu chowa wybraną linię. `fitIsoView` oddala mapę, gdy obszar wychodzi poza widok (nigdy nie przybliża).
  - Bez `walk.bin` działa fallback: `runIso` / `drawIso` (kółka, linia prosta × 1,3).
- **Model zasięgu, tryb „typowy dzień”** (`isoMode = 'typical'`, `isoDay` = w/s/n → `applyDayType`):
  - czekanie = `hw*/2` bez limitu,
  - chód 75 m/min po ulicach,
  - przejazd wg `offMin` reprezentatywnego kursu (najbliżej 11:00).
- **Tryb „wyjazd o godzinie”** (`isoMode = 'time'`, `isoDate`, `isoTime`):
  - `runIsoTime` → `runCSA`: Connection Scan po oknach `conns/` dla profilu dnia, z przesiadkami z `transfers.bin` i `TRANSFER_MIN` = 1 min zapasu między pojazdami,
  - potem `walkDijkstra({noRide:true})` od osiągniętych przystanków rysuje obszar,
  - etapy: `csaLegs` (przejazdy z godziną i czekaniem, przesiadki `streetPath`), doklejane w `walkLegsFrom`,
  - brak odjazdów w limicie → `fillNextDeparture` (z `deps/`) z przyciskiem „Wyjdź o …”; gdy tego dnia już nic, szuka pierwszego odjazdu w kolejnych dniach (przycisk „Pokaż jutro od …”),
  - znane ograniczenie: kursy po północy z poprzedniego dnia (np. 00:30) nie są brane dla wyjazdu tuż po północy.
- **Widok punktu:**
  - `computePointReach` oznacza przystanki w okręgu bez dojścia pieszo (limit 2,5 × promień ulicami),
  - dojście z punktu do przystanków liczy się tylko ulicami, bez linii prostej przez rzekę; w trybie czasu `originWalk` (przystanki do `ORIGIN_WALK_M` = 2 km, samo chodzenie do 40 min).

## Pułapki, które już raz ugryzły

- **Kafelki OSM przez `file://`** dają 403, a `fetch()` danych też nie działa. Testuj zawsze przez `python3 -m http.server`.
- **Domyślna ikonka markera Leaflet** (PNG z CDN) się nie wczytuje, dlatego pinezki to inline SVG (`L.divIcon`).
- **Wszystko jest na jednym canvasie** (`preferCanvas: true`). Nakładki, które nie mają łapać kliknięć (okrąg promienia, trasy, pinezka), muszą mieć `interactive: false`.
- **Osobny `L.canvas` w innym panelu** zasłania zdarzenia myszy warstwom pod nim. Przystanki linii rysuj na tym samym canvasie co resztę.
- **`bringToFront()` na wariancie trasy** przykrywa kółka przystanków, więc po `styleVariants` trzeba je wyciągnąć na wierzch.
- **Kolejność zdarzeń:** markery przystanków mają `bubblingMouseEvents: false`. Mapowe `mouseout` odpala się przy przejściu między elementami wewnątrz mapy, więc do wyjścia kursora używaj `mouseleave` na kontenerze.
- **Czasy w Dijkstrze trzymaj w `Float64Array`.** Float32 zaokrągla i porównanie z kolejką pomija węzły, przez co zasięg wychodził kilka razy za mały.
- **Rysowanie setek tysięcy odcinków jako `L.polyline`** trwało ponad 1 s przy każdym zoomie, dlatego jest GridLayer.
- **Leaflet throttluje `mousemove` na canvasie (32 ms).** W testach Playwright ruszaj myszą w krokach (`steps`), inaczej hover się nie odpali.
- **Kliknięcie w kontrolkę, która przerysowuje się w trakcie kliknięcia** (chip zasięgu, przycisk w dymku): Leaflet szuka `_leaflet_disable_click` od `e.target` w górę, a odłączony od DOM przycisk go nie ma, więc mapa dostaje `click` i ustawia cel. W takich kontrolkach wołaj `L.DomEvent.stopPropagation(e)` w nasłuchu na samej kontrolce.
- **Playwright `page.route`** podaje handlerowi `(route, request)`, więc nie używaj drugiego parametru jako własnej flagi.
- **`position` kontenera mapy:** Leaflet dopisuje `position:relative` tylko przy starcie, jeśli CSS nie ustawia innej. Na telefonie `#map` jest `absolute`, więc `#map` ma w CSS `position:relative` na stałe — inaczej po obrocie telefonu kontrolki i warstwy uciekały poza mapę.
- **Chip zasięgu:** −, + i ✕ to ikony SVG (`CHIP_MINUS`, `CHIP_PLUS`, `CHIP_X`) w przyciskach z `justify-content:center`; znaki tekstowe nie siedziały na środku. Na ekranach dotykowych bez tła po „hover” (zostawało po stuknięciu).
- **`maxBounds` a arkusz:** Leaflet pilnuje granic dla całego kontenera mapy. Bez zapasu na dole `fitBounds` z marginesem na arkusz nie mógł zejść niżej i przy zwiększaniu czasu zasięgu obszar uciekał pod arkusz.
- **Arkusz w stanie „peek” ma `overflow:hidden`**: na niskich ekranach zakładki są poniżej krawędzi, dostęp przez uchwyt / przesunięcie w górę. W testach dotykowych nie stukaj w legendę ani atrybucję (są nad arkuszem).

## Jak testować

Środowisko asystenta zwykle nie ma dostępu do cdnjs ani tile.openstreetmap.org. Testy uruchamiaj przez headless Chromium (Playwright):
- podstaw Leaflet z `npm pack leaflet@1.9.4` przez `page.route`,
- odpowiadaj 204 na kafelki OSM,
- serwuj folder przez `python3 -m http.server`.

Sprawdzaj:
- brak `pageerror`,
- liczby w panelu (np. Rondo Mogilskie: linia 1 ma dwa kierunki, ok. 124 odjazdy w dzień roboczy),
- czasy: `recalcIso` < 100 ms (tryb czasu ok. 85 ms, z czego Connection Scan ok. 2 ms), przerysowanie suwaka < 150 ms, przesunięcie mapy < 50 ms,
- tryb czasu: Ochodza Odwiśle w niedzielę o 10:00 pokazuje „Najbliższy odjazd: 235 o 15:59”,
- pokrycie wariantów: każda para linia–przystanek z `stops[].lines` jest w którymś `routes[].trips`,
- klik w punkt: `selectPoint` < 80 ms synchronicznie, karta celów gotowa ok. 80 ms później; Rynek Główny: 13 linii dziennych + 11 nocnych, Lotnisko ok. 40 min,
- klik w mapę przy włączonym zasięgu ustawia cel z dymkiem i zostawia zasięg; „Sprawdź to miejsce” przenosi start (`#p=` = cel, bez `cel=`, `iso=` zostaje), „Wróć do” przywraca poprzedni; Esc dwa razy = brak celu i zasięgu,
- chip: − / + zmienia `iso=` w adresie i suwak w panelu, a klik w chip nie ustawia celu (Kurdwanów → Dworzec Płaszów Estakada ok. 23–24 min z linią 7),
- linia 1 z Ronda Mogilskiego: dwa kierunki w przełączniku, w zakładce „Rozkład” po 124 odjazdy w dzień roboczy w każdym kierunku,
- telefon (viewport 390×844 i 360×640, `is_mobile`, `has_touch`): karta startowa → stuknięcie w mapę = `sheetMode` „peek” i pinezka nad arkuszem; przesunięcie w górę / w dół (sztuczne `TouchEvent` na `#panel`) = „full” / „peek”; linia z tablicy odjazdów = „line-peek”; `#m-back` dwa razy = karta startowa i pusty adres; zmiana szerokości na > 760 px nie rozjeżdża mapy; zasięg z Rynku i + na chipie do 40 min: obszar przystanków cały nad arkuszem (y < wysokość − `sheetPx()`); + / − na mapie nie przesuwają pinezki.

## Konwencje

- **Komentarze w kodzie i komunikaty skryptów po polsku.** Nazwy zmiennych mogą być po angielsku.
- **Po zmianie formatu danych** zaktualizuj `README.md` (kroki i opis plików) i ten plik.
- **Kolory:**
  - tramwaj `--tram #a8322d`, autobus `--bus #2a5f74`, akcent `--accent #c98a2c`,
  - pasma zasięgu to jednobarwna rampa niebieska `ISO_RAMP` (zwalidowana jako porządkowa).
  - kropki przystanków: biały środek + obwódka `STOP_TRAM` / `STOP_BUS` (przystanek z tramwajem = tramwajowa), legenda w lewym dolnym rogu; zaznaczone pomarańczowe, bez dojścia szare przerywane, przy zasięgu przygaszone,
  - podkład OSM w oryginalnych kolorach (przygaszanie filtrem CSS było testowane i odrzucone).
- **Na serwer idą tylko:** HTML, `stops_data.json`, `deps/`, `conns/`, `walk.bin`, `transfers.bin`. `walk_osm/` zostaje lokalnie do przebudowy `walk.bin`. ZIP-y GTFS są jednorazowe.
- **Interfejs mówi „przystanek”, nie „słupek”.** Słupek (`stop_id`) to termin tylko techniczny.
