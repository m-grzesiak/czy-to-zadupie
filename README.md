# Czy to zadupie? — dojazdy komunikacją w Krakowie

Statyczna strona (jeden plik HTML, Leaflet + OpenStreetMap), bez serwera i bazy danych. Kliknij punkt albo przystanek na mapie (albo użyj przycisku lokalizacji), a zobaczysz:

- jak stąd dojedziesz: najbliższy przystanek, ile kursów na godzinę, pierwszy i ostatni kurs oraz czasy dojazdu do kilku ważnych miejsc (Rynek, Dworzec, AGH, Kampus UJ, Nowa Huta, lotnisko) i do własnych „Moich miejsc”,
- linie w promieniu z częstotliwością („co 8 min”), nocne osobno,
- trasę linii ze wszystkimi przystankami,
- odjazdy (z numerem przystanku z tablicy ZTP) i czas przejazdu,
- mapę zasięgu „gdzie dojadę w N minut”; kliknięcie celu na mapie pokazuje trasę.

„Moje miejsca” (np. praca) zapisują się w przeglądarce (localStorage), nie na serwerze.

Widok jest zapisany w adresie strony (np. `#s=stop_203_12529`), więc link do przystanku, punktu, linii albo zasięgu można wysłać dalej, a przycisk „Wstecz” w przeglądarce wraca do poprzedniego widoku.

Wszystkie dane są przygotowywane z góry dwoma skryptami w Pythonie i leżą obok strony jako pliki. Na GitHub Pages robi to CI w każdą niedzielę (skrypt `update_data.sh`), więc rozkład aktualizuje się sam.

## Pliki

| Plik | Co to jest | Na stronę? |
|---|---|---|
| `index.html` | strona: sam HTML | tak |
| `style.css` | wygląd strony | tak |
| `js/` | kod strony jako moduły ES (bez budowania), start w `js/main.js` | tak |
| `tests/` | testy strony w przeglądarce (Playwright), `npm test` | nie |
| `.github/workflows/pages.yml` | cotygodniowa (niedziela) aktualizacja rozkładu i publikacja na GitHub Pages | nie |
| `update_data.sh` | cała aktualizacja danych jednym poleceniem: kroki 1–4 i kontrola wyniku | nie |
| `stops_data.json` | przystanki (z numerem słupka z tablicy ZTP), linie, trasy, czasy przejazdu, kalendarz, częstotliwości | tak |
| `deps/*.json` | rozkład odjazdów w kawałkach siatki ~2 km (strona pobiera tylko potrzebne) | tak |
| `walk.bin` | sieć piesza (ulice, chodniki) do mapy zasięgu | tak |
| `transfers.bin` | przesiadki piesze między przystankami (do 500 m ulicami) | tak |
| `conns/*.bin` | wszystkie połączenia z godzinami do trybu „wyjazd o godzinie”, pocięte na profile dnia i okna 2 h | tak |
| `generate_stops_data.py` | GTFS ZTP → `stops_data.json` + `deps/` + `conns/` | nie |
| `build_walk_graph.py` | OSM → `walk.bin` + `transfers.bin` + dopisanie przystanków do sieci ulic | nie |
| `download_walk.sh` | pobieranie sieci pieszej z OpenStreetMap (zapytanie Overpass jest w środku) | nie |
| `GTFS_KRK_*.zip` / `GTFS_KRK_*/` | surowe rozkłady ZTP | nie |
| `ald-gtfs.zip` | surowy rozkład autobusów Kolei Małopolskich (Małopolskie Linie Dowozowe) | nie |
| `kml-ska-gtfs.zip` | surowy rozkład pociągów Kolei Małopolskich (SKA1–3 i pociągi nazwane) | nie |
| `walk_osm/` | surowa sieć ulic z OSM (~95 MB), lokalnie | nie |
| `walk_osm.tar.xz` | to samo spakowane (~8 MB), w repo — z niego korzysta CI | nie |

## Wymagania

- Python 3.9+ (skrypty GTFS i sieci pieszej z JSON-ów używają tylko biblioteki standardowej).
- `curl` (jest w macOS).
- Opcjonalnie `pip3 install --user osmium`, tylko jeśli sieć pieszą bierzesz z pliku `.osm.pbf` zamiast z `download_walk.sh`.

## Aktualizacja danych — krok po kroku

Wszystkie polecenia uruchamiaj w folderze projektu (`cd ~/Projects/mapa`).

### 1. Pobierz aktualne rozkłady ZTP i Kolei Małopolskich

```
curl -O https://gtfs.ztp.krakow.pl/GTFS_KRK_A.zip
curl -O https://gtfs.ztp.krakow.pl/GTFS_KRK_T.zip
curl -O https://gtfs.ztp.krakow.pl/GTFS_KRK_M.zip
curl -o ald-gtfs.zip "https://gtfs.kolejemalopolskie.com.pl/?download=L2hvbWUvYnByb2cvcm96a2xhZHlfamF6ZHkvYWxkLWd0ZnMuemlw"
curl -o kml-ska-gtfs.zip "https://gtfs.kolejemalopolskie.com.pl/?download=L2hvbWUvYnByb2cvcm96a2xhZHlfamF6ZHkva21sLXNrYS1ndGZzLnppcA%3D%3D"
```

- **A:** autobusy MPK (miasto i gminy ościenne).
- **T:** tramwaje.
- **M:** autobusy Mobilis.
- **ald-gtfs:** autobusy Kolei Małopolskich (Małopolskie Linie Dowozowe, linie A1…A74) — na https://gtfs.kolejemalopolskie.com.pl/ plik „mld-gtfs.zip” w sekcji „Rozkłady Handlowe” (nie `GTFS.zip` z sekcji MLD, to dane do pozycji na żywo). Wiele linii jedzie daleko poza Kraków; na mapę trafia tylko odcinek w obszarze mapy. Feed nie ma `shapes.txt`, więc trasy tych linii to proste odcinki między przystankami.
- **kml-ska-gtfs:** pociągi Kolei Małopolskich — plik „kml-ska-gtfs.zip” z tej samej sekcji. W danych nie ma numerów linii, więc skrypt rozpoznaje SKA1, SKA2 i SKA3 po stacjach, przez które jedzie kurs; pociągi nazwane (Dunajec, Hubal, Luxtorpeda…) mają nazwę zamiast numeru, a autobusy zastępcze (ZKA) są pomijane. Pociągów Polregio i PKP Intercity nie ma w tych danych.

Aktualną listę plików znajdziesz na https://gtfs.ztp.krakow.pl/ i https://gtfs.kolejemalopolskie.com.pl/.

### 2. Wygeneruj przystanki, trasy i rozkład

```
python3 generate_stops_data.py GTFS_KRK_A.zip GTFS_KRK_T.zip GTFS_KRK_M.zip ald-gtfs.zip kml-ska-gtfs.zip -o stops_data.json
```

Skrypt przyjmuje pliki ZIP albo rozpakowane katalogi (np. `GTFS_KRK_A`). Trwa ok. 10 s. Na końcu wypisuje podsumowanie, które warto sprawdzić:

```
  ald-gtfs.zip: 2877 przystanków poza obszarem mapy pominięto
  ald-gtfs.zip: 548 przystanków dostało nazwę przystanku ZTP w tym samym miejscu
  kml-ska-gtfs.zip: 79 przystanków poza obszarem mapy pominięto
  profile dni: 12 → 6 (te same odjazdy)
Połączenia: 96 plików w conns/ (20.1 MB), profil 0: 234,529, profil 1: 219,969, ...
Zapisano 5426 przystanków, 23 linii tramwajowych, 223 autobusowych, 8 kolejowych do stops_data.json (2.3 MB)
Odjazdy: 347 plików w deps/ (4.1 MB), 14 dni od 2026-10-03, 6 różnych profili dnia
```

Przydatne opcje:
- **`--days 21`:** na ile dni do przodu zapisać odjazdy (domyślnie 14).
- **`--date 2026-10-05`:** od którego dnia liczyć (domyślnie dziś).
- **`--inspect`:** nic nie generuje, tylko pokazuje strukturę plików GTFS. Przydatne, gdy ZTP zmieni format.
- **`--bbox S,W,N,E`:** obszar mapy; przystanki spoza niego są pomijane (domyślnie obszar sieci pieszej z `download_walk.sh`: `49.89,19.57,50.26,20.37`). Zmieniasz go razem z zapytaniem w `download_walk.sh`.

Rozkład obejmuje tylko okno dni od wygenerowania. Po jego końcu strona pokazuje rozkład z tego samego dnia tygodnia i informuje o tym. Na stronie publicznej CI odświeża dane w każdą niedzielę (krok 6); lokalnie odśwież je, gdy stopka robi się pomarańczowa.

### 3. Sieć piesza — tylko gdy jej nie masz albo chcesz ją odświeżyć

Ulice zmieniają się rzadko, więc wystarczy to robić raz na kilka miesięcy. Jeśli masz już katalog `walk_osm/`, przejdź do kroku 4. Jeśli go nie masz, ale jest `walk_osm.tar.xz` z repo, rozpakuj go (`tar -xJf walk_osm.tar.xz`; `update_data.sh` robi to sam).

```
bash download_walk.sh
```

Skrypt pobiera sieć ulic i chodników z OpenStreetMap (Overpass API) w 12 kawałkach, po kolei, z ponawianiem i serwerami zapasowymi. Trwa to kilka minut. Jeśli publiczne serwery są przeciążone („too busy”, 406, 429), przerwij (Ctrl+C) i uruchom ponownie później. Pobrane kawałki są pomijane, więc żeby odświeżyć całą sieć, najpierw usuń katalog: `rm -rf walk_osm && bash download_walk.sh`.

Na koniec skrypt pakuje sieć do `walk_osm.tar.xz`. **Zacommituj to archiwum** — CI buduje `walk.bin` właśnie z niego, bez pobierania z Overpass.

Alternatywa bez Overpass: wycinek `.osm.pbf` z https://extract.bbbike.org/ (obszar 19.57, 49.89 – 20.37, 50.26). W kroku 4 podajesz wtedy ten plik zamiast `walk_osm/*.json`.

### 4. Zbuduj sieć pieszą i przyklej do niej przystanki

**Uruchamiaj ten krok po każdym kroku 2.** `generate_stops_data.py` nadpisuje `stops_data.json` i usuwa z niego informację, przy której ulicy stoi każdy przystanek.

```
python3 build_walk_graph.py stops_data.json walk_osm/*.json -o walk.bin
```

Trwa ok. 15 s. Sprawdź w podsumowaniu, czy wszystkie przystanki zostały przyklejone:

```
Zapisano transfers.bin: 33,606 przesiadek pieszych do 500 m (0.2 MB)
Zapisano walk.bin: 227,382 węzłów, 284,364 krawędzi, ... (6.9 MB). Przystanki przyklejone: 5426/5426
```

Jeśli pominiesz ten krok, strona dalej działa, ale mapa zasięgu liczy dojścia w przybliżeniu (linia prosta × 1,3) i pisze o tym pod legendą.

### 5. Sprawdź lokalnie

```
python3 -m http.server 8000
```

Otwórz http://localhost:8000/ i odśwież bez pamięci podręcznej (Cmd+Shift+R). Na dole panelu powinno być napisane „Rozkład ZTP i Kolei Małopolskich z <data>, odjazdy na dni <od>–<do>. … przystanków” z dzisiejszą datą generowania. Jeśli zamiast tego widać żółtą ramkę „Dane przykładowe”, strona nie wczytała `stops_data.json`. Jeśli napis jest pomarańczowy („Rozkład jest nieaktualny”), wykonaj kroki 1–4.

Strony nie da się otworzyć podwójnym kliknięciem (`file://`). Przeglądarka zablokuje wtedy wczytanie danych, a serwer OSM kafelki mapy. Strona musi być pod adresem `http://…`.

### 6. Opublikuj

Strona: https://m-grzesiak.github.io/czy-to-zadupie/ (repo https://github.com/m-grzesiak/czy-to-zadupie, GitHub Pages). Na serwer trafiają tylko: `index.html`, `style.css`, `js/`, `stops_data.json`, `deps/`, `conns/`, `walk.bin` i `transfers.bin`. Pliki GTFS, `walk_osm/` i skrypty zostają w repozytorium albo lokalnie, ale nie są publikowane.

1. **Dane generuje CI, nie commitujesz ich.** `stops_data.json`, `walk.bin`, `transfers.bin`, `deps/` i `conns/` są w `.gitignore`. Commitujesz tylko stronę i skrypty.
2. Workflow `.github/workflows/pages.yml` uruchamia się po każdym pushu na `main` i w każdą niedzielę o 2:30 UTC (3:30 / 4:30 w Krakowie). Pobiera świeże GTFS, uruchamia `update_data.sh` (generowanie, sieć piesza, kontrola) i publikuje stronę z danymi. Postęp w zakładce Actions.
3. **Gdy jeden feed się nie pobierze** (serwer leży albo zwraca coś, co nie jest GTFS-em), `update_data.sh` bierze jego ostatnią dobrą kopię (w CI z pamięci podręcznej), a pozostałe feedy są świeże. Strona się publikuje, a przebieg na końcu jest oznaczany jako nieudany (mail od GitHuba, w logu lista feedów ze starej kopii). Gdy starej kopii nie ma, nic się nie publikuje.
4. **Kontrola danych:** `update_data.sh` kończy się błędem, gdy przystanków jest mniej niż 4000, brakuje tramwajów, autobusów albo pociągów, mniej niż 99% przystanków jest przyklejonych do ulic albo kalendarz nie obejmuje dzisiejszego dnia. Wtedy nic się nie publikuje, zostaje poprzednia wersja (rozkład na 14 dni daje zapas), a GitHub wysyła maila o nieudanym przebiegu.
5. **Sieć piesza** pochodzi z `walk_osm.tar.xz` w repo, więc CI nie zależy od Overpass. Odświeżasz ją ręcznie raz na kilka miesięcy (krok 3) i commitujesz nowe archiwum.
6. GitHub wyłącza harmonogram po 60 dniach bez commitów. Workflow sam włącza go z powrotem po każdym niedzielnym przebiegu, więc nie trzeba nic robić.
7. Jednorazowo w repo: Settings → Pages → Source: **GitHub Actions**.

Strona wczytuje dane ścieżkami względnymi, więc działa też pod podkatalogiem (`/czy-to-zadupie/`).

## Skrót: zwykła aktualizacja rozkładu

Na stronie publicznej niepotrzebna (robi ją CI). Lokalnie:

```
cd ~/Projects/mapa
bash update_data.sh
```

Skrypt pobiera wszystkie pięć plików GTFS, usuwa stare `deps/` i `conns/`, uruchamia `generate_stops_data.py` i `build_walk_graph.py` (sieć pieszą bierze z `walk_osm/`, a gdy jej nie ma, rozpakowuje `walk_osm.tar.xz`) i sprawdza wynik. Trwa ok. 1 min.

## Jak liczone są dane (w skrócie)

- **Linie na przystanku:** wszystkie kursy, które jeżdżą w oknie rozkładu. Kursy ze starych wersji rozkładu w tym samym feedzie są pomijane.
- **Trasy:** z `shapes.txt`, do 4 najczęstszych wariantów na linię, równo z obu kierunków.
- **Czas przejazdu:** z kursu najbliższego godzinie 11:00, więc w szczycie może być dłuższy.
- **Odjazdy:** dla każdego dnia w oknie z `calendar.txt` i `calendar_dates.txt`. ZTP definiuje kursy wyłącznie przez `calendar_dates`. Dni z identycznym zestawem kursów mają wspólny „profil”.
- **Mapa zasięgu** ma dwa tryby:
  - **Typowy dzień** (dzień roboczy / sobota / niedziela): algorytm Dijkstry po ulicach i liniach naraz. Na każdym wsiadaniu średnie czekanie, czyli połowa odstępu między kursami w wybranym typie dnia, 6:00–20:00. Nocne linie i kursy tylko szczytowe nie wchodzą do zasięgu.
  - **Wyjazd o godzinie:** Connection Scan po prawdziwych odjazdach z `conns/`, z przesiadkami pieszymi z `transfers.bin` i 1 min zapasu na przesiadkę. Jeśli w limicie czasu nic nie odjeżdża, strona pokazuje najbliższy odjazd.

  W obu trybach chodzenie jest liczone po sieci pieszej z OSM, 4,5 km/h.

## Rozwiązywanie problemów

- **Terminal: `PermissionError: Operation not permitted` przy `http.server`.** macOS nie daje Terminalowi dostępu do folderu, np. Pobranych. Przenieś projekt albo nadaj Terminalowi dostęp: Ustawienia systemowe → Prywatność i ochrona → Pliki i foldery.
- **Nie widać nowej funkcji albo danych po aktualizacji.** Przeglądarka trzyma starą wersję. Odśwież przez Cmd+Shift+R.
- **Na stronie widać linię, która już nie jeździ (albo brakuje nowej).** Sprawdź, czy pobrałeś świeże pliki GTFS, i uruchom kroki 2 i 4.
- **`download_walk.sh` wisi albo ciągle dostaje odmowę.** Publiczne serwery Overpass bywają przeciążone. Spróbuj później albo użyj wycinka `.osm.pbf` (krok 3).
- **Skrypt GTFS zgłasza błąd po zmianie formatu u ZTP.** Uruchom `python3 generate_stops_data.py --inspect GTFS_KRK_T.zip` i porównaj kolumny ze standardem GTFS.
- **Stare pliki w `deps/` lub `conns/`.** `generate_stops_data.py` nadpisuje pliki, ale ich nie usuwa. `update_data.sh` czyści oba katalogi sam; przy ręcznych krokach usuń je przed krokiem 2.
- **Nieudany niedzielny przebieg w Actions.** Sprawdź log kroku „Download timetables and generate data”: zwykle to chwilowo niedostępny serwer ZTP / Kolei Małopolskich (wystarczy Re-run) albo zmiana formatu GTFS (komunikat „DATA ERROR”).
