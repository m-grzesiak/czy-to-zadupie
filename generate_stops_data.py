#!/usr/bin/env python3
"""
generate_stops_data.py
-----------------------
Zamienia jeden lub więcej plików GTFS (ZIP) na plik stops_data.json, którego
oczekuje index.html (strona): przystanki + linie na każdym z nich, oraz
geometria (kształt) każdej linii do narysowania jej całej trasy na mapie.

Skąd wziąć dane (ZTP Kraków, https://gtfs.ztp.krakow.pl/):
    GTFS_KRK_A.zip  — autobusy (miasto + gminy ościenne)
    GTFS_KRK_T.zip  — tramwaje (z shapes.txt)
    GTFS_KRK_M.zip  — trzeci feed ZTP (autobusy innego operatora/aglomeracyjne)
Podaj wszystkie jako argumenty — skrypt scali je w jedną bazę.

Użycie:
  python3 generate_stops_data.py GTFS_KRK_A.zip GTFS_KRK_T.zip GTFS_KRK_M.zip -o stops_data.json
  python3 generate_stops_data.py --inspect GTFS_KRK_T.zip     # podgląd struktury plików

Opcje:
  -o PLIK            plik wynikowy (domyślnie stops_data.json)
  --variants N       maks. liczba wariantów trasy na linię (domyślnie 4)
  --tolerance M      uproszczenie geometrii w metrach (domyślnie 4; 0 = bez)
  --inspect          nic nie generuj, tylko wypisz pliki/nagłówki/przykładowe wiersze
  --days N           na ile dni do przodu zapisać rozkład odjazdów (domyślnie 14)
  --date RRRR-MM-DD  pierwszy dzień rozkładu (domyślnie dziś)

Wynik: stops_data.json (przystanki, linie, trasy, czasy przejazdu) + katalog deps/
z odjazdami podzielonymi na kawałki siatki ~2 km (strona pobiera tylko potrzebny).

Połóż wynikowy stops_data.json w tym samym folderze co index.html —
strona wczytuje go sama przy starcie (przez fetch()).
"""

import csv
import datetime as dt
import io
import json
import math
import re
import struct
import sys
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

# route_type: podstawowe (0 tram, 3 bus, 11 trolejbus) + rozszerzone (9xx tram, 7xx bus, 800 trolejbus)
TRAM_TYPES = {"0", "5"} | {str(x) for x in range(900, 907)}
BUS_TYPES = {"3", "11", "800"} | {str(x) for x in range(700, 717)}


# ---------------------------------------------------------------------------
# Wczytywanie
# ---------------------------------------------------------------------------
def load_zip_bytes(source: str) -> bytes:
    if source.startswith(("http://", "https://")):
        print(f"Pobieram {source} ...", file=sys.stderr)
        req = urllib.request.Request(source, headers={"User-Agent": "krakow-transit-map/1.0"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.read()
    return Path(source).read_bytes()


class DirFeed:
    """Rozpakowany feed (katalog z plikami .txt) z tym samym API co ZipFile."""
    def __init__(self, path: Path):
        self.path = path
    def namelist(self):
        return [p.name for p in self.path.iterdir() if p.is_file()]
    def infolist(self):
        return [type("I", (), {"filename": p.name, "file_size": p.stat().st_size})() for p in sorted(self.path.iterdir()) if p.is_file()]
    def open(self, name):
        return open(self.path / name, "rb")
    def __enter__(self):
        return self
    def __exit__(self, *a):
        return False


def open_feed(source: str):
    p = Path(source)
    if not source.startswith(("http://", "https://")) and p.is_dir():
        return DirFeed(p)
    return zipfile.ZipFile(io.BytesIO(load_zip_bytes(source)))


def find_member(zf, name: str):
    """Znajdź plik w ZIP-ie niezależnie od wielkości liter i ewentualnego podfolderu."""
    for n in zf.namelist():
        if n.rsplit("/", 1)[-1].lower() == name:
            return n
    return None


def iter_csv(zf: zipfile.ZipFile, name: str):
    """Strumieniowo (bez ładowania całego pliku do pamięci). Nagłówki znormalizowane:
    bez BOM, spacji, małymi literami. Wartości przycięte."""
    member = find_member(zf, name)
    if not member:
        return
    with zf.open(member) as f:
        text = io.TextIOWrapper(f, encoding="utf-8-sig", newline="")
        reader = csv.reader(text)
        try:
            header = next(reader)
        except StopIteration:
            return
        header = [h.strip().strip("﻿").strip('"').lower() for h in header]
        for row in reader:
            if not row:
                continue
            yield {h: (row[i].strip() if i < len(row) else "") for i, h in enumerate(header)}


def feed_mode_hint(source: str):
    """Z nazwy pliku ZTP (GTFS_KRK_T / _A / _M) zgadnij tryb, gdyby route_type był nietypowy."""
    base = source.rsplit("/", 1)[-1].upper()
    if re.search(r"_T(\.|_|$)", base) or "TRAM" in base:
        return "tram"
    if re.search(r"_[AM](\.|_|$)", base) or "BUS" in base:
        return "bus"
    return None


def route_type_to_mode(route_type: str, hint):
    if route_type in TRAM_TYPES:
        return "tram"
    if route_type in BUS_TYPES:
        return "bus"
    return hint or "bus"


# ---------------------------------------------------------------------------
# Geometria
# ---------------------------------------------------------------------------
def haversine(a, b):
    R = 6371000.0
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def simplify(points, tol_m):
    """Douglas–Peucker na lokalnym rzucie płaskim (metry). Iteracyjnie, bez rekurencji."""
    if tol_m <= 0 or len(points) < 3:
        return points
    lat0 = math.radians(points[0][0])
    kx, ky = 111320.0 * math.cos(lat0), 110540.0
    xy = [(p[1] * kx, p[0] * ky) for p in points]
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    tol2 = tol_m * tol_m
    while stack:
        s, e = stack.pop()
        (x1, y1), (x2, y2) = xy[s], xy[e]
        dx, dy = x2 - x1, y2 - y1
        L2 = dx * dx + dy * dy
        best, idx = -1.0, -1
        for i in range(s + 1, e):
            px, py = xy[i]
            if L2 == 0:
                d2 = (px - x1) ** 2 + (py - y1) ** 2
            else:
                t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / L2))
                d2 = (px - x1 - t * dx) ** 2 + (py - y1 - t * dy) ** 2
            if d2 > best:
                best, idx = d2, i
        if best > tol2:
            keep[idx] = True
            stack.append((s, idx))
            stack.append((idx, e))
    return [p for p, k in zip(points, keep) if k]


def rnd(p):
    return [round(p[0], 5), round(p[1], 5)]


# ---------------------------------------------------------------------------
# Inspekcja
# ---------------------------------------------------------------------------
def inspect(zf: zipfile.ZipFile, source: str):
    print(f"\n=== {source} ===")
    for info in zf.infolist():
        print(f"  {info.filename:28s} {info.file_size/1e6:8.2f} MB")
    for name in ["agency.txt", "routes.txt", "stops.txt", "trips.txt", "stop_times.txt", "shapes.txt", "feed_info.txt"]:
        it = iter_csv(zf, name)
        rows = []
        for r in it or []:
            rows.append(r)
            if len(rows) >= 2:
                break
        if not rows:
            print(f"\n  [{name}] — BRAK")
            continue
        print(f"\n  [{name}] kolumny: {list(rows[0].keys())}")
        for r in rows:
            print(f"    {r}")
    rt = Counter(r.get("route_type", "") for r in iter_csv(zf, "routes.txt"))
    print(f"\n  route_type: {dict(rt)}")
    lt = Counter(r.get("location_type", "") for r in iter_csv(zf, "stops.txt"))
    print(f"  location_type: {dict(lt)}")


# ---------------------------------------------------------------------------
# Przetwarzanie jednego feedu
# ---------------------------------------------------------------------------
def hhmm_to_min(t: str):
    if not t:
        return None
    try:
        h, m, *_ = t.split(":")
        return int(h) * 60 + int(m)
    except ValueError:
        return None


def parse_date(s: str):
    return dt.date(int(s[:4]), int(s[4:6]), int(s[6:8]))


class NotGrouped(Exception):
    pass


DLAT, DLON = 0.02, 0.03
CONN_WINDOW = 120         # minuty: okno pliku z połączeniami (conns/p<profil>_<okno>.bin)   # rozmiar komórki siatki plików z odjazdami (~2,2 × 2,1 km)


def cell_of(lat, lon):
    return f"{math.floor(lat / DLAT)}_{math.floor(lon / DLON)}"


class Merger:
    def __init__(self, max_variants: int, tolerance: float, dates):
        self.max_variants = max_variants
        self.tolerance = tolerance
        self.dates = dates                      # lista dt.date — okno rozkładu
        self.date_services = {d: set() for d in dates}  # data -> {globalny service_id}
        self.stops = {}                          # global_id -> {id,name,lat,lon}
        self.stop_lines = defaultdict(dict)      # global_id -> {(ref,mode): {...}}
        self.routes = {}                         # (ref,mode) -> {"color","name","cands":[...]}
        self.deps = defaultdict(lambda: defaultdict(list))  # (gid, "ref|mode", headsign) -> {gsid: [min]}
        self.warnings = []
        self.csa_trips = []   # (service, "ref|mode", headsign, [gid], [przyjazd], [odjazd]) — do trybu "wyjazd o godzinie"

    # -- kalendarz ------------------------------------------------------------
    def load_calendar(self, zf, tag):
        wd = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
        for r in iter_csv(zf, "calendar.txt"):
            try:
                a, b = parse_date(r["start_date"]), parse_date(r["end_date"])
            except (KeyError, ValueError):
                continue
            for d in self.dates:
                if a <= d <= b and r.get(wd[d.weekday()]) == "1":
                    self.date_services[d].add(f"{tag}/{r['service_id']}")
        for r in iter_csv(zf, "calendar_dates.txt"):
            try:
                d = parse_date(r["date"])
            except (KeyError, ValueError):
                continue
            if d in self.date_services:
                g = f"{tag}/{r['service_id']}"
                if r.get("exception_type") == "1":
                    self.date_services[d].add(g)
                elif r.get("exception_type") == "2":
                    self.date_services[d].discard(g)

    # -- jeden feed -----------------------------------------------------------
    def process(self, zf, source: str, tag: str):
        hint = feed_mode_hint(source)
        n_before = len(self.stops)
        self.load_calendar(zf, tag)

        # routes
        routes = {}
        for r in iter_csv(zf, "routes.txt"):
            ref = r.get("route_short_name") or r.get("route_long_name") or r["route_id"]
            mode = route_type_to_mode(r.get("route_type", ""), hint)
            color = (r.get("route_color") or "").lstrip("#") or None
            if color and (not re.fullmatch(r"[0-9A-Fa-f]{6}", color) or color.upper() in ("FFFFFF", "000000")):
                color = None  # ZTP daje autobusom FFFFFF — biała linia byłaby niewidoczna
            lname = r.get("route_long_name") or ""
            routes[r["route_id"]] = (ref, mode, color, "" if lname == ref else lname)

        # stops (te same ID w różnych feedach scalamy, jeśli to ten sam punkt; inaczej prefiks feedu)
        local_to_global = {}
        parent_name = {}
        stop_rows = list(iter_csv(zf, "stops.txt"))
        for r in stop_rows:
            if (r.get("location_type") or "0") == "1":
                parent_name[r["stop_id"]] = r.get("stop_name", "")
        for r in stop_rows:
            if (r.get("location_type") or "0") not in ("0", ""):
                continue
            try:
                lat, lon = float(r["stop_lat"]), float(r["stop_lon"])
            except (KeyError, ValueError):
                continue
            sid = r["stop_id"]
            name = r.get("stop_name") or parent_name.get(r.get("parent_station", ""), "") or sid
            gid = sid
            existing = self.stops.get(gid)
            if existing and haversine((existing["lat"], existing["lon"]), (lat, lon)) > 30:
                gid = f"{tag}:{sid}"
            local_to_global[sid] = gid
            if gid not in self.stops:
                self.stops[gid] = {"id": gid, "name": name, "lat": round(lat, 6), "lon": round(lon, 6)}
                # numer słupka z tablicy ZTP ("802-01" -> "01"; zapasowo stop_desc)
                code = (r.get("stop_code") or "").rsplit("-", 1)[-1].strip()
                if not re.fullmatch(r"\d{1,3}", code):
                    code = (r.get("stop_desc") or "").strip()
                if re.fullmatch(r"\d{1,3}", code):
                    self.stops[gid]["c"] = code

        # trips
        trips = {}   # trip_id -> (route_id, shape_id|None, direction, headsign, global service)
        headsigns = defaultdict(Counter)
        for t in iter_csv(zf, "trips.txt"):
            if t.get("route_id") not in routes:
                continue
            d = t.get("direction_id", "")
            h = t.get("trip_headsign", "")
            trips[t["trip_id"]] = [t["route_id"], t.get("shape_id") or None, d, h, f"{tag}/{t.get('service_id', '')}"]
            if h:
                headsigns[t["route_id"]][(d, h)] += 1

        # shapes
        needed_shapes = {t[1] for t in trips.values() if t[1]}
        shapes = defaultdict(list)
        for r in iter_csv(zf, "shapes.txt"):
            if r.get("shape_id") in needed_shapes:
                try:
                    shapes[r["shape_id"]].append(
                        (float(r.get("shape_pt_sequence") or 0), float(r["shape_pt_lat"]), float(r["shape_pt_lon"])))
                except (KeyError, ValueError):
                    pass
        shape_pts = {}
        for k, pts in shapes.items():
            pts.sort()
            if len(pts) >= 2:
                shape_pts[k] = [[la, lo] for _, la, lo in pts]
        del shapes
        missing_shapes = needed_shapes - set(shape_pts)
        if missing_shapes and shape_pts:
            self.warnings.append(f"{source}: {len(missing_shapes)} shape_id z trips.txt nie ma w shapes.txt — dla nich trasa z kolejności przystanków")
        for t in trips.values():
            if t[1] not in shape_pts:
                t[1] = None

        # stop_times — jeden strumieniowy przebieg; zakładamy, że wiersze kursu leżą obok siebie
        # (tak jest w ZTP), a jeśli nie, powtarzamy w trybie "wszystko w pamięci".
        try:
            local = self._scan_stop_times(zf, trips, local_to_global, grouped=True)
        except NotGrouped:
            print(f"  {source}: stop_times nie jest pogrupowany po trip_id — wolniejszy tryb", file=sys.stderr)
            local = self._scan_stop_times(zf, trips, local_to_global, grouped=False)
        stop_route_pairs, pattern_count, pattern_dir, reps, deps, n_st, csa_local = local
        for (srv, rid, h, g, arr, dep) in csa_local:
            ref, mode, _, _ = routes[rid]
            self.csa_trips.append((srv, f"{ref}|{mode}", h, g, arr, dep))

        missing_stops = 0
        for sid, rid in stop_route_pairs:
            gid = local_to_global.get(sid)
            if gid is None:
                missing_stops += 1
                continue
            ref, mode, _, _ = routes[rid]
            self.stop_lines[gid][(ref, mode)] = {"ref": ref, "type": mode}
        if missing_stops:
            self.warnings.append(f"{source}: {missing_stops} par przystanek-linia wskazuje na stop_id spoza stops.txt")

        for (gid, rid, h), by_srv in deps.items():
            ref, mode, _, _ = routes[rid]
            tgt = self.deps[(gid, f"{ref}|{mode}", h)]
            for srv, mins in by_srv.items():
                tgt[srv].extend(mins)

        for rid, counter in pattern_count.items():
            ref, mode, color, lname = routes[rid]
            if not lname and headsigns.get(rid):
                best = {}
                for (d, h), c in headsigns[rid].most_common():
                    best.setdefault(d, h)
                ends = list(dict.fromkeys(best[d] for d in sorted(best)))
                lname = " – ".join(ends[:2])
            entry = self.routes.setdefault((ref, mode), {"color": color, "name": lname, "cands": []})
            entry["color"] = entry["color"] or color
            entry["name"] = entry["name"] or lname
            for key, cnt in counter.items():
                if key[0] == "shape":
                    pts = shape_pts[key[1]]
                else:
                    pts = [[self.stops[local_to_global[s]]["lat"], self.stops[local_to_global[s]]["lon"]]
                           for s in key[1] if s in local_to_global]
                rep = reps.get((rid, key))
                info = None
                if rep:
                    _, h, seq = rep
                    info = {"h": h, "s": [[local_to_global[s], off] for s, off in seq if s in local_to_global]}
                if len(pts) >= 2:
                    entry["cands"].append((cnt, pattern_dir.get((rid, key), ""), pts, info))

        n_days = sum(1 for d in self.dates if any(x.startswith(tag + "/") for x in self.date_services[d]))
        print(f"  {source}: {len(routes)} linii, {len(self.stops) - n_before} nowych przystanków, "
              f"{len(trips)} kursów, {n_st:,} wierszy stop_times, "
              f"{'shapes.txt' if shape_pts else 'BEZ shapes.txt (trasy z kolejności przystanków)'}, "
              f"rozkład na {n_days}/{len(self.dates)} dni", file=sys.stderr)

    def _scan_stop_times(self, zf, trips, local_to_global, grouped):
        stop_route_pairs = set()
        pattern_count = defaultdict(Counter)       # route_id -> Counter(pattern_key)
        pattern_dir = {}
        sub_count = defaultdict(Counter)           # (rid, key) -> Counter(stop tuple)
        best_trip = {}                             # (rid, key, stop tuple) -> (|dep-11:00|, headsign, [(sid, off)])
        deps = defaultdict(lambda: defaultdict(list))  # (gid, rid, headsign) -> {service: [min]}
        wanted_services = set().union(*self.date_services.values()) if self.date_services else set()

        csa_local = []

        def finish(tid, rows):
            t = trips.get(tid)
            if t is None or not rows:
                return
            rid, shape, d, h, srv = t
            if wanted_services and srv not in wanted_services:
                return   # kurs nie jeździ w oknie rozkładu (np. stara wersja rozkładu) — pomijamy
            rows.sort(key=lambda r: r[0])
            stops_seq = tuple(r[1] for r in rows)
            for s in stops_seq:
                stop_route_pairs.add((s, rid))
            key = ("shape", shape) if shape else ("stops", stops_seq)
            pattern_count[rid][key] += 1
            pattern_dir[(rid, key)] = d
            sub_count[(rid, key)][stops_seq] += 1
            first = rows[0][2]
            if not h:
                last = local_to_global.get(rows[-1][1])
                h = self.stops[last]["name"] if last else ""
            if first is not None:
                off = [(r[1], (r[2] - first) if r[2] is not None else None) for r in rows]
                score = abs(first - 660)
                k3 = (rid, key, stops_seq)
                if k3 not in best_trip or score < best_trip[k3][0]:
                    best_trip[k3] = (score, h, off)
            if srv in wanted_services:
                g = [local_to_global.get(r[1]) for r in rows]
                if all(g) and all(r[2] is not None and r[4] is not None for r in rows):
                    csa_local.append((srv, rid, h, g, [r[4] for r in rows], [r[2] for r in rows]))
                for r in rows[:-1]:                 # z ostatniego przystanku nie ma odjazdu
                    if r[2] is None or r[3] == "1":  # pickup_type=1: nie zabiera pasażerów
                        continue
                    gid = local_to_global.get(r[1])
                    if gid:
                        deps[(gid, rid, h)][srv].append(r[2])

        n_st = 0
        if grouped:
            done = set()
            cur, rows = None, []
            for st in iter_csv(zf, "stop_times.txt"):
                n_st += 1
                tid = st.get("trip_id")
                if tid != cur:
                    if cur is not None:
                        finish(cur, rows)
                        done.add(cur)
                    if tid in done:
                        raise NotGrouped()
                    cur, rows = tid, []
                if tid not in trips:
                    continue
                try:
                    seq = int(st.get("stop_sequence") or 0)
                except ValueError:
                    continue
                m = hhmm_to_min(st.get("departure_time") or st.get("arrival_time"))
                a = hhmm_to_min(st.get("arrival_time") or st.get("departure_time"))
                rows.append((seq, st.get("stop_id"), m, st.get("pickup_type", ""), a))
            if cur is not None:
                finish(cur, rows)
        else:
            allrows = defaultdict(list)
            for st in iter_csv(zf, "stop_times.txt"):
                n_st += 1
                tid = st.get("trip_id")
                if tid not in trips:
                    continue
                try:
                    seq = int(st.get("stop_sequence") or 0)
                except ValueError:
                    continue
                m = hhmm_to_min(st.get("departure_time") or st.get("arrival_time"))
                a = hhmm_to_min(st.get("arrival_time") or st.get("departure_time"))
                allrows[tid].append((seq, st.get("stop_id"), m, st.get("pickup_type", ""), a))
            for tid, rows in allrows.items():
                finish(tid, rows)

        # reprezentatywny kurs każdego wzorca: najczęstsza sekwencja przystanków, kurs najbliżej 11:00
        reps = {}
        for (rid, key), c in sub_count.items():
            seq = c.most_common(1)[0][0]
            b = best_trip.get((rid, key, seq))
            if b:
                reps[(rid, key)] = b
        return stop_route_pairs, pattern_count, pattern_dir, reps, deps, n_st, csa_local

    # -- wynik ----------------------------------------------------------------
    def pick_variants(self, cands):
        """Najczęstsze warianty, po równo z każdego kierunku; pomija prawie-duplikaty."""
        by_dir = defaultdict(list)
        for c in sorted(cands, key=lambda c: -c[0]):
            by_dir[c[1]].append(c)
        chosen = []
        dirs = list(by_dir.values())
        i = 0
        while len(chosen) < self.max_variants and any(i < len(d) for d in dirs):
            for d in dirs:
                if i < len(d) and len(chosen) < self.max_variants:
                    c = d[i]
                    if not any(self._similar(c[2], x[2]) for x in chosen):
                        chosen.append(c)
            i += 1
        return chosen

    @staticmethod
    def _similar(a, b):
        return (haversine(a[0], b[0]) < 150 and haversine(a[-1], b[-1]) < 150
                and abs(len(a) - len(b)) <= max(3, 0.05 * max(len(a), len(b))))

    def result(self):
        stops_out = []
        for gid, s in self.stops.items():
            lines = list(self.stop_lines.get(gid, {}).values())
            if lines:
                lines.sort(key=lambda l: (l["type"] != "tram", [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", l["ref"])]))
                stops_out.append({**s, "lines": lines})
        # częstotliwość (do mapy zasięgu): kursy wariantu z pierwszego przystanku w typowy
        # dzień roboczy (wt–czw) między 6:00 a 20:00 -> średni odstęp w minutach
        # osobno dla typowego dnia roboczego (wt–czw), soboty i niedzieli
        def ref_services(weekdays):
            d = next((d for d in self.dates if d.weekday() in weekdays), None)
            return self.date_services.get(d, set()) if d else set()
        ref_srv = {"hw": ref_services((1, 2, 3)), "hwS": ref_services((5,)), "hwN": ref_services((6,))}

        def headway(lkey, info, srvset):
            if not info or not info["s"]:
                return None
            by_srv = self.deps.get((info["s"][0][0], lkey, info["h"]))
            if not by_srv:
                return None
            n = sum(1 for srv, mins in by_srv.items() if srv in srvset for m in mins if 360 <= m < 1200)
            return round(840 / n, 1) if n else None

        routes_out = {}
        for (ref, mode), e in self.routes.items():
            variants = self.pick_variants(e["cands"])
            # dobór rzadszych wariantów, aż każdy przystanek linii jest w którymś z nich
            # (inaczej np. kurs przez jedną wieś znika z trasy, czasów przejazdu i mapy zasięgu)
            covered = {sid for v in variants if v[3] for sid, _ in v[3]["s"]}
            serving = {gid for gid, lines in self.stop_lines.items() if (ref, mode) in lines}
            for c in sorted(e["cands"], key=lambda c: -c[0]):
                if not (serving - covered):
                    break
                if c in variants or not c[3]:
                    continue
                new = {sid for sid, _ in c[3]["s"]} - covered
                if new & serving:
                    variants.append(c)
                    covered |= new
            for v in variants:
                if v[3] is not None:
                    for field, srvset in ref_srv.items():
                        v[3][field] = headway(f"{ref}|{mode}", v[3], srvset)
            routes_out[f"{ref}|{mode}"] = {
                "ref": ref, "type": mode, "color": e["color"], "name": e["name"],
                "shapes": [[rnd(p) for p in simplify(v[2], self.tolerance)] for v in variants],
                "trips": [v[3] for v in variants],
            }

        # profile dni: daty z tym samym zestawem kursów dostają wspólny profil
        profiles, date_profile = {}, {}
        for d in self.dates:
            key = frozenset(self.date_services[d])
            if key not in profiles:
                profiles[key] = len(profiles)
            date_profile[d.isoformat()] = profiles[key]
        prof_list = [None] * len(profiles)
        for k, i in profiles.items():
            prof_list[i] = k

        cells = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
        for (gid, lkey, h), by_srv in self.deps.items():
            s = self.stops.get(gid)
            if not s:
                continue
            uniq, idx = [], []
            for srvset in prof_list:
                mins = sorted(m for srv in srvset if srv in by_srv for m in by_srv[srv])
                if mins in uniq:
                    idx.append(uniq.index(mins))
                else:
                    uniq.append(mins)
                    idx.append(len(uniq) - 1)
            if all(not u for u in uniq):
                continue
            cells[cell_of(s["lat"], s["lon"])][gid][lkey].append({"h": h, "t": uniq, "p": idx})

        # --- połączenia do trybu "wyjazd o godzinie": (z, do, odjazd, przyjazd, kurs) per profil,
        #     posortowane po odjeździe, pocięte na okna CONN_WINDOW minut ---
        sidx = {s["id"]: k for k, s in enumerate(stops_out)}
        route_keys, head_names = [], []
        rk_idx, hd_idx = {}, {}
        conn_files = {}
        for pi, srvset in enumerate(prof_list):
            trips_tab, conns = [], []
            for (srv, lkey, h, g, arr, dep) in self.csa_trips:
                if srv not in srvset:
                    continue
                ti = len(trips_tab)
                if lkey not in rk_idx:
                    rk_idx[lkey] = len(route_keys); route_keys.append(lkey)
                if h not in hd_idx:
                    hd_idx[h] = len(head_names); head_names.append(h)
                trips_tab.append((rk_idx[lkey], hd_idx[h]))
                for j in range(len(g) - 1):
                    a, b = sidx.get(g[j]), sidx.get(g[j + 1])
                    if a is None or b is None or arr[j + 1] < dep[j]:
                        continue
                    conns.append((dep[j], arr[j + 1], a, b, ti))
            conns.sort()
            if len(trips_tab) > 65535 or len(stops_out) > 65535:
                raise SystemExit("Za dużo kursów/przystanków na format uint16 w conns/")
            chunks = defaultdict(list)
            for c in conns:
                chunks[c[0] // CONN_WINDOW].append(c)
            conn_files[pi] = {"trips": trips_tab, "chunks": chunks, "n": len(conns)}

        meta = {
            "generated": dt.date.today().isoformat(),
            "calendar": date_profile,
            "deps": {"dlat": DLAT, "dlon": DLON, "path": "deps/"},
            "conns": {"path": "conns/", "window": CONN_WINDOW, "routes": route_keys, "heads": head_names,
                      "chunks": {str(pi): sorted(v["chunks"]) for pi, v in conn_files.items()}},
        }
        return {"meta": meta, "stops": stops_out, "routes": routes_out}, cells, conn_files


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        sys.exit(0 if args else 1)

    out_path, variants, tol, do_inspect, days, start = "stops_data.json", 4, 4.0, False, 14, dt.date.today()
    sources = []
    i = 0
    while i < len(args):
        a = args[i]
        if a == "-o":
            out_path = args[i + 1]; i += 2
        elif a == "--variants":
            variants = int(args[i + 1]); i += 2
        elif a == "--tolerance":
            tol = float(args[i + 1]); i += 2
        elif a == "--days":
            days = int(args[i + 1]); i += 2
        elif a == "--date":
            start = dt.date.fromisoformat(args[i + 1]); i += 2
        elif a == "--inspect":
            do_inspect = True; i += 1
        else:
            sources.append(a); i += 1

    m = Merger(variants, tol, [start + dt.timedelta(days=k) for k in range(days)])
    for n, src in enumerate(sources):
        with open_feed(src) as zf:
            if do_inspect:
                inspect(zf, src)
            else:
                m.process(zf, src, (feed_mode_hint(src) or "f") + str(n))
    if do_inspect:
        return

    res, cells, conn_files = m.result()
    for w in m.warnings:
        print("  UWAGA: " + w, file=sys.stderr)
    text = json.dumps(res, ensure_ascii=False, separators=(",", ":"))
    Path(out_path).write_text(text, encoding="utf-8")

    deps_dir = Path(out_path).parent / "deps"
    deps_dir.mkdir(exist_ok=True)
    total = 0
    for cell, data in cells.items():
        t = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        (deps_dir / f"{cell}.json").write_text(t, encoding="utf-8")
        total += len(t.encode())

    # połączenia: conns/p<P>_<okno>.bin (uint16 × 5: z, do, odjazd, przyjazd, kurs) + p<P>_trips.bin (uint16 × 2)
    conns_dir = Path(out_path).parent / "conns"
    conns_dir.mkdir(exist_ok=True)
    ctotal, cfiles = 0, 0
    for pi, v in conn_files.items():
        tb = struct.pack(f"<{2 * len(v['trips'])}H", *[x for t in v["trips"] for x in t])
        (conns_dir / f"p{pi}_trips.bin").write_bytes(tb)
        ctotal += len(tb); cfiles += 1
        for ch, lst in v["chunks"].items():
            b = struct.pack(f"<{5 * len(lst)}H", *[x for c in lst for x in (c[2], c[3], c[0], c[1], c[4])])
            (conns_dir / f"p{pi}_{ch}.bin").write_bytes(b)
            ctotal += len(b); cfiles += 1
    print(f"Połączenia: {cfiles} plików w {conns_dir}/ ({ctotal / 1e6:.1f} MB), "
          + ", ".join(f"profil {pi}: {v['n']:,}" for pi, v in conn_files.items()), file=sys.stderr)

    n_tram = sum(1 for r in res["routes"].values() if r["type"] == "tram")
    n_bus = sum(1 for r in res["routes"].values() if r["type"] == "bus")
    n_prof = len(set(res["meta"]["calendar"].values()))
    print(f"Zapisano {len(res['stops'])} przystanków, {n_tram} linii tramwajowych, {n_bus} autobusowych "
          f"do {out_path} ({len(text.encode()) / 1e6:.1f} MB)", file=sys.stderr)
    print(f"Odjazdy: {len(cells)} plików w {deps_dir}/ ({total / 1e6:.1f} MB), "
          f"{len(res['meta']['calendar'])} dni od {start}, {n_prof} różnych profili dnia", file=sys.stderr)


if __name__ == "__main__":
    main()
