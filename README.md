# Czy to zadupie? — dojazdy komunikacją w Krakowie

Statyczna strona (jeden plik HTML, Leaflet + OpenStreetMap), bez serwera i bazy danych. Kliknij punkt albo przystanek na mapie (albo użyj przycisku lokalizacji), a zobaczysz:

- jak stąd dojedziesz: najbliższy przystanek, ile kursów na godzinę, pierwszy i ostatni kurs oraz czasy dojazdu do kilku ważnych miejsc (Rynek, Dworzec, AGH, Kampus UJ, Nowa Huta, lotnisko) i do własnych „Moich miejsc”,
- linie w promieniu z częstotliwością („co 8 min”), nocne osobno,
- trasę linii ze wszystkimi przystankami,
- odjazdy (z numerem przystanku z tablicy ZTP) i czas przejazdu,
- mapę zasięgu „gdzie dojadę w N minut”; kliknięcie celu na mapie pokazuje trasę.

„Moje miejsca” (np. praca) zapisują się w przeglądarce (localStorage), nie na serwerze.

Widok jest zapisany w adresie strony (np. `#s=stop_203_12529`), więc link do przystanku, punktu, linii albo zasięgu można wysłać dalej, a przycisk „Wstecz” w przeglądarce wraca do poprzedniego widoku.

Wszystkie dane są przygotowywane z góry dwoma skryptami w Pythonie i leżą obok strony jako pliki.

## Pliki

| Plik | Co to jest | Na stronę? |
|---|---|---|
| `index.html` | cała strona | tak |
| `.github/workflows/pages.yml` | publikacja na GitHub Pages (kopiuje stronę i dane do `public/`) | nie |
| `.gitlab-ci.yml` | to samo dla GitLab Pages, gdyby repo było tam | nie |
| `stops_data.json` | przystanki (z numerem słupka z tablicy ZTP), linie, trasy, czasy przejazdu, kalendarz, częstotliwości | tak |
| `deps/*.json` | rozkład odjazdów w kawałkach siatki ~2 km (strona pobiera tylko potrzebne) | tak |
| `walk.bin` | sieć piesza (ulice, chodniki) do mapy zasięgu | tak |
| `transfers.bin` | przesiadki piesze między przystankami (do 500 m ulicami) | tak |
| `conns/*.bin` | wszystkie połączenia z godzinami do trybu „wyjazd o godzinie”, pocięte na profile dnia i okna 2 h | tak |
| `generate_stops_data.py` | GTFS ZTP → `stops_data.json` + `deps/` + `conns/` | nie |
| `build_walk_graph.py` | OSM → `walk.bin` + `transfers.bin` + dopisanie przystanków do sieci ulic | nie |
| `download_walk.sh` | pobieranie sieci pieszej z OpenStreetMap (zapytanie Overpass jest w środku) | nie |
| `GTFS_KRK_*.zip` / `GTFS_KRK_*/` | surowe rozkłady ZTP | nie |
| `walk_osm/` | surowa sieć ulic z OSM (~95 MB) | nie |

## Wymagania

- Python 3.9+ (skrypty GTFS i sieci pieszej z JSON-ów używają tylko biblioteki standardowej).
- `curl` (jest w macOS).
- Opcjonalnie `pip3 install --user osmium`, tylko jeśli sieć pieszą bierzesz z pliku `.osm.pbf` zamiast z `download_walk.sh`.

## Aktualizacja danych — krok po kroku

Wszystkie polecenia uruchamiaj w folderze projektu (`cd ~/Projects/mapa`).

### 1. Pobierz aktualne rozkłady ZTP

```
curl -O https://gtfs.ztp.krakow.pl/GTFS_KRK_A.zip
curl -O https://gtfs.ztp.krakow.pl/GTFS_KRK_T.zip
curl -O https://gtfs.ztp.krakow.pl/GTFS_KRK_M.zip
```

- **A:** autobusy MPK (miasto i gminy ościenne).
- **T:** tramwaje.
- **M:** autobusy Mobilis.

Aktualną listę plików znajdziesz na https://gtfs.ztp.krakow.pl/.

### 2. Wygeneruj przystanki, trasy i rozkład

```
python3 generate_stops_data.py GTFS_KRK_A.zip GTFS_KRK_T.zip GTFS_KRK_M.zip -o stops_data.json
```

Skrypt przyjmuje pliki ZIP albo rozpakowane katalogi (np. `GTFS_KRK_A`). Trwa ok. 10 s. Na końcu wypisuje podsumowanie, które warto sprawdzić:

```
Zapisano 4098 przystanków, 23 linii tramwajowych, 195 autobusowych do stops_data.json (2.0 MB)
Odjazdy: 243 plików w deps/ (3.7 MB), 14 dni od 2026-09-27, 5 różnych profili dnia
Połączenia: 75 plików w conns/ (15.3 MB), profil 0: 209,586, profil 1: 357,192, ...
```

Przydatne opcje:
- **`--days 21`:** na ile dni do przodu zapisać odjazdy (domyślnie 14).
- **`--date 2026-10-05`:** od którego dnia liczyć (domyślnie dziś).
- **`--inspect`:** nic nie generuje, tylko pokazuje strukturę plików GTFS. Przydatne, gdy ZTP zmieni format.

Rozkład obejmuje tylko okno dni od wygenerowania. Po jego końcu strona pokazuje rozkład z tego samego dnia tygodnia i informuje o tym. Dlatego dane trzeba odświeżać przynajmniej raz na 1–2 tygodnie.

### 3. Sieć piesza — tylko gdy jej nie masz albo chcesz ją odświeżyć

Ulice zmieniają się rzadko, więc wystarczy to robić raz na kilka miesięcy. Jeśli masz już katalog `walk_osm/`, przejdź do kroku 4.

```
bash download_walk.sh
```

Skrypt pobiera sieć ulic i chodników z OpenStreetMap (Overpass API) w 12 kawałkach, po kolei, z ponawianiem i serwerami zapasowymi. Trwa to kilka minut. Jeśli publiczne serwery są przeciążone („too busy”, 406, 429), przerwij (Ctrl+C) i uruchom ponownie później. Pobrane kawałki są pomijane.

Alternatywa bez Overpass: wycinek `.osm.pbf` z https://extract.bbbike.org/ (obszar 19.57, 49.89 – 20.37, 50.26). W kroku 4 podajesz wtedy ten plik zamiast `walk_osm/*.json`.

### 4. Zbuduj sieć pieszą i przyklej do niej przystanki

**Uruchamiaj ten krok po każdym kroku 2.** `generate_stops_data.py` nadpisuje `stops_data.json` i usuwa z niego informację, przy której ulicy stoi każdy przystanek.

```
python3 build_walk_graph.py stops_data.json walk_osm/*.json -o walk.bin
```

Trwa ok. 15 s. Sprawdź w podsumowaniu, czy wszystkie przystanki zostały przyklejone:

```
Zapisano transfers.bin: 25,500 przesiadek pieszych do 500 m (0.1 MB)
Zapisano walk.bin: 226,306 węzłów, 283,288 krawędzi, ... (6.9 MB). Przystanki przyklejone: 4098/4098
```

Jeśli pominiesz ten krok, strona dalej działa, ale mapa zasięgu liczy dojścia w przybliżeniu (linia prosta × 1,3) i pisze o tym pod legendą.

### 5. Sprawdź lokalnie

```
python3 -m http.server 8000
```

Otwórz http://localhost:8000/ i odśwież bez pamięci podręcznej (Cmd+Shift+R). Na dole panelu powinno być napisane „Rozkład ZTP z <data>, odjazdy na dni <od>–<do>. … przystanków” z dzisiejszą datą generowania. Jeśli zamiast tego widać żółtą ramkę „Dane przykładowe”, strona nie wczytała `stops_data.json`. Jeśli napis jest pomarańczowy („Rozkład jest nieaktualny”), wykonaj kroki 1–4.

Strony nie da się otworzyć podwójnym kliknięciem (`file://`). Przeglądarka zablokuje wtedy wczytanie danych, a serwer OSM kafelki mapy. Strona musi być pod adresem `http://…`.

### 6. Opublikuj

Strona: https://m-grzesiak.github.io/czy-to-zadupie/ (repo https://github.com/m-grzesiak/czy-to-zadupie, GitHub Pages). Na serwer trafiają tylko: `index.html`, `stops_data.json`, `deps/`, `conns/`, `walk.bin` i `transfers.bin`. Pliki GTFS, `walk_osm/` i skrypty zostają w repozytorium albo lokalnie, ale nie są publikowane.

1. Wygenerowane dane (kroki 2 i 4) commitujesz razem ze stroną. `.gitignore` pomija surowe GTFS, `walk_osm/` i kopie zapasowe.
2. Po pushu na `main` workflow `.github/workflows/pages.yml` kopiuje stronę i dane do `public/`, a GitHub je publikuje (zakładka Actions pokazuje postęp).
3. Jednorazowo w repo: Settings → Pages → Source: **GitHub Actions**.
4. Na GitLab Pages to samo robi `.gitlab-ci.yml`; tam w Deploy → Pages wyłącz **Use unique domain**, inaczej adres dostanie losowy dopisek.

Strona wczytuje dane ścieżkami względnymi, więc działa też pod podkatalogiem (`/czy-to-zadupie/`).

## Skrót: zwykła aktualizacja rozkładu

```
cd ~/Projects/mapa
curl -O https://gtfs.ztp.krakow.pl/GTFS_KRK_A.zip -O https://gtfs.ztp.krakow.pl/GTFS_KRK_T.zip -O https://gtfs.ztp.krakow.pl/GTFS_KRK_M.zip
python3 generate_stops_data.py GTFS_KRK_A.zip GTFS_KRK_T.zip GTFS_KRK_M.zip -o stops_data.json
python3 build_walk_graph.py stops_data.json walk_osm/*.json -o walk.bin
```

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
- **Stare pliki w `deps/` lub `conns/`.** Skrypt nadpisuje pliki, ale ich nie usuwa. Jeśli sieć przystanków albo liczba profili dnia mocno się zmieni, usuń oba katalogi przed krokiem 2.
