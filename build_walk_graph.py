#!/usr/bin/env python3
"""
build_walk_graph.py
-------------------
Zamienia eksport Overpass (krakow_walk.json, zapytanie w walk_query.overpassql) na
kompaktowy graf pieszy walk.bin dla mapy zasięgu w index.html, oraz
dopisuje do stops_data.json, do którego węzła grafu "przyklejony" jest każdy przystanek.

Użycie (po generate_stops_data.py i download_walk.sh):
  python3 build_walk_graph.py stops_data.json walk_osm/*.json -o walk.bin
  python3 build_walk_graph.py stops_data.json Krakau.osm.pbf -o walk.bin      # wycinek BBBike

Format walk.bin (little-endian):
  uint32 magic 'WLK1', N węzłów, E krawędzi, G punktów geometrii
  int32  [N*2]    lat, lon węzłów × 1e6
  uint32 [E*2]    końce krawędzi (a, b)
  uint32 [E+1]    offset geometrii pośredniej krawędzi e w tablicy punktów
  int32  [G*2]    punkty pośrednie (lat, lon × 1e6), kierunek a -> b
  uint16 [E]      długość krawędzi w metrach (po ulicy)
"""
import json
import math
import struct
import sys
from collections import defaultdict
from pathlib import Path


def hav(a, b):
    R = 6371000.0
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(min(1.0, h)))


def simplify(pts, tol=2.0):
    if len(pts) < 3:
        return pts
    lat0 = math.radians(pts[0][0])
    kx, ky = 111320.0 * math.cos(lat0), 110540.0
    xy = [(p[1] * kx, p[0] * ky) for p in pts]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    st = [(0, len(pts) - 1)]
    while st:
        s, e = st.pop()
        (x1, y1), (x2, y2) = xy[s], xy[e]
        dx, dy = x2 - x1, y2 - y1
        L2 = dx * dx + dy * dy
        best, idx = -1.0, -1
        for i in range(s + 1, e):
            px, py = xy[i]
            t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / L2))
            d2 = (px - x1 - t * dx) ** 2 + (py - y1 - t * dy) ** 2
            if d2 > best:
                best, idx = d2, i
        if best > tol * tol:
            keep[idx] = True
            st += [(s, idx), (idx, e)]
    return [p for p, k in zip(pts, keep) if k]


WALKABLE = {"footway", "pedestrian", "path", "steps", "living_street", "residential", "unclassified",
            "tertiary", "tertiary_link", "secondary", "secondary_link", "primary", "primary_link",
            "cycleway", "road", "service", "corridor"}


def read_pbf(src, coord, ways):
    """Plik .osm.pbf (np. wycinek BBBike/Geofabrik): te same filtry co w walk_query.overpassql."""
    try:
        import osmium
    except ImportError:
        sys.exit("Do plików .pbf potrzebny jest pyosmium:  pip3 install --user osmium")

    class H(osmium.SimpleHandler):
        def way(self, w):
            t = w.tags
            if t.get("highway") not in WALKABLE:
                return
            if t.get("access") in ("private", "no") or t.get("foot") in ("no", "private"):
                return
            if t.get("service") in ("parking_aisle", "driveway"):
                return
            nd = []
            for n in w.nodes:
                if n.location.valid():
                    coord[n.ref] = (n.location.lat, n.location.lon)
                    nd.append(n.ref)
            if len(nd) >= 2:
                ways[w.id] = nd

    H().apply_file(src, locations=True, idx="flex_mem")


def main():
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__)
        sys.exit(1)
    out = args[args.index("-o") + 1] if "-o" in args else "walk.bin"
    pos = [a for i, a in enumerate(args) if a != "-o" and (i == 0 or args[i - 1] != "-o")]
    stops_path, sources = pos[0], pos[1:]

    coord = {}
    ways = {}   # id -> węzły (kawałki na granicach się powtarzają)
    for src in sources:
        print(f"Wczytuję {src} ...", file=sys.stderr)
        if src.endswith(".pbf"):
            read_pbf(src, coord, ways)
            continue
        data = json.loads(Path(src).read_text(encoding="utf-8"))
        for el in data.get("elements", []):
            if el["type"] == "node":
                coord[el["id"]] = (el["lat"], el["lon"])
            elif el["type"] == "way":
                nd = el.get("nodes", [])
                if len(nd) >= 2:
                    ways[el["id"]] = nd
        del data
    ways = list(ways.values())
    print(f"  {len(coord):,} punktów, {len(ways):,} dróg", file=sys.stderr)

    # węzły grafu = skrzyżowania i końce dróg
    use = defaultdict(int)
    for nd in ways:
        use[nd[0]] += 2
        use[nd[-1]] += 2
        for n in nd[1:-1]:
            use[n] += 1
    # krawędzie: odcinek drogi między kolejnymi węzłami grafu, z geometrią pośrednią
    raw = {}   # (a, b) -> (length, [pts a..b])
    for nd in ways:
        nd = [n for n in nd if n in coord]
        if len(nd) < 2:
            continue
        start = 0
        for i in range(1, len(nd)):
            if use[nd[i]] >= 2 or i == len(nd) - 1:
                seg = nd[start:i + 1]
                if seg[0] != seg[-1]:
                    pts = [coord[n] for n in seg]
                    L = sum(hav(pts[k], pts[k + 1]) for k in range(len(pts) - 1))
                    a, b = seg[0], seg[-1]
                    key = (a, b) if a <= b else (b, a)
                    if a > b:
                        pts = pts[::-1]
                    if L > 0.3 and (key not in raw or raw[key][0] > L):
                        raw[key] = (L, pts)
                start = i
    print(f"  {len(raw):,} odcinków między skrzyżowaniami", file=sys.stderr)

    # składowe spójne: zostawiamy te, które mają sens (>= 1 km dróg)
    parent = {}

    def find(x):
        while parent.get(x, x) != x:
            parent[x] = parent.get(parent[x], parent[x])
            x = parent[x]
        return x

    for a, b in raw:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    comp_len = defaultdict(float)
    for (a, b), (L, _) in raw.items():
        comp_len[find(a)] += L
    raw = {k: v for k, v in raw.items() if comp_len[find(k[0])] >= 1000}

    # indeksy
    node_ids = sorted({n for k in raw for n in k})
    idx = {n: i for i, n in enumerate(node_ids)}
    nodes = [coord[n] for n in node_ids]
    edges = []   # [a, b, length, geom(pts incl. końce)]
    for (a, b), (L, pts) in raw.items():
        edges.append([idx[a], idx[b], L, pts])

    # --- przyklejenie przystanków: najbliższy punkt na krawędzi, krawędź dzielimy w tym miejscu ---
    stops_doc = json.loads(Path(stops_path).read_text(encoding="utf-8"))
    stops = stops_doc["stops"]
    G = 0.004
    grid = defaultdict(list)   # komórka -> [(edge_idx, seg_idx)]
    for ei, e in enumerate(edges):
        pts = e[3]
        for k in range(len(pts) - 1):
            la = (pts[k][0] + pts[k + 1][0]) / 2
            lo = (pts[k][1] + pts[k + 1][1]) / 2
            grid[(int(la // G), int(lo // G))].append((ei, k))

    def project(p, a, b):
        lat0 = math.radians(p[0])
        kx, ky = 111320.0 * math.cos(lat0), 110540.0
        ax, ay = (a[1] - p[1]) * kx, (a[0] - p[0]) * ky
        bx, by = (b[1] - p[1]) * kx, (b[0] - p[0]) * ky
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / L2))
        qx, qy = ax + t * dx, ay + t * dy
        return math.hypot(qx, qy), t, (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))

    snaps = {}   # stop_id -> (edge_idx, seg_idx, t, point, dist)
    for s in stops:
        p = (s["lat"], s["lon"])
        cy, cx = int(p[0] // G), int(p[1] // G)
        best = None
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for ei, k in grid.get((cy + dy, cx + dx), ()):
                    pts = edges[ei][3]
                    d, t, q = project(p, pts[k], pts[k + 1])
                    if best is None or d < best[4]:
                        best = (ei, k, t, q, d)
        if best and best[4] <= 300:
            snaps[s["id"]] = best

    # dzielenie krawędzi w punktach przyklejenia (kilka przystanków na jednej krawędzi — po kolei)
    by_edge = defaultdict(list)
    for sid, (ei, k, t, q, d) in snaps.items():
        by_edge[ei].append((k, t, q, sid, d))
    stop_node = {}
    new_edges = []
    for ei, e in enumerate(edges):
        a, b, L, pts = e
        cuts = sorted(by_edge.get(ei, []))
        if not cuts:
            new_edges.append(e)
            continue
        cur_node, cur_pts = a, [pts[0]]
        k_prev = 0
        for (k, t, q, sid, d) in cuts:
            cur_pts += pts[k_prev + 1:k + 1]
            # punkt przyklejenia tuż przy bieżącym węźle -> bez nowego węzła
            if hav(q, nodes[cur_node]) < 2.0 and len(cur_pts) == 1:
                stop_node[sid] = (cur_node, d)
                k_prev = k
                continue
            nid = len(nodes)
            nodes.append(q)
            seg = cur_pts + [q]
            Ls = sum(hav(seg[i], seg[i + 1]) for i in range(len(seg) - 1))
            new_edges.append([cur_node, nid, Ls, seg])
            stop_node[sid] = (nid, d)
            cur_node, cur_pts, k_prev = nid, [q], k
        seg = cur_pts + pts[k_prev + 1:]
        Ls = sum(hav(seg[i], seg[i + 1]) for i in range(len(seg) - 1))
        if Ls > 0.3 or cur_node != b:
            new_edges.append([cur_node, b, Ls, seg])
    edges = new_edges

    # --- zapis ---
    geom, offs = [], [0]
    for e in edges:
        mid = simplify(e[3])[1:-1]
        geom += mid
        offs.append(len(geom))
    N, E, Gn = len(nodes), len(edges), len(geom)
    buf = bytearray()
    buf += struct.pack("<4I", 0x314B4C57, N, E, Gn)
    buf += struct.pack(f"<{2 * N}i", *[round(v * 1e6) for p in nodes for v in p])
    buf += struct.pack(f"<{2 * E}I", *[x for e in edges for x in (e[0], e[1])])
    buf += struct.pack(f"<{E + 1}I", *offs)
    buf += struct.pack(f"<{2 * Gn}i", *[round(v * 1e6) for p in geom for v in p])
    buf += struct.pack(f"<{E}H", *[min(65535, max(1, round(e[2]))) for e in edges])
    Path(out).write_bytes(bytes(buf))

    # --- przesiadki piesze między przystankami (po ulicach, do TRANSFER_MAX m) -> transfers.bin ---
    import heapq
    TRANSFER_MAX = 500.0
    adj = defaultdict(list)
    for e in edges:
        adj[e[0]].append((e[1], e[2]))
        adj[e[1]].append((e[0], e[2]))
    node_stops = defaultdict(list)
    for k, st in enumerate(stops):
        sn = stop_node.get(st["id"])
        if sn:
            node_stops[sn[0]].append((k, sn[1]))
    t_start, t_to, t_m = [0], [], []
    for k, st in enumerate(stops):
        sn = stop_node.get(st["id"])
        found = {}
        if sn:
            src, d0 = sn
            dist = {src: d0}
            pq = [(d0, src)]
            while pq:
                d, u = heapq.heappop(pq)
                if d > dist.get(u, 1e18) or d > TRANSFER_MAX:
                    continue
                for (k2, s2) in node_stops.get(u, ()):
                    if k2 != k:
                        tot = d + s2
                        if tot <= TRANSFER_MAX and tot < found.get(k2, 1e18):
                            found[k2] = tot
                for v, L in adj[u]:
                    nd = d + L
                    if nd <= TRANSFER_MAX and nd < dist.get(v, 1e18):
                        dist[v] = nd
                        heapq.heappush(pq, (nd, v))
        for k2, m in sorted(found.items()):
            t_to.append(k2); t_m.append(min(65535, max(1, round(m))))
        t_start.append(len(t_to))
    tr_path = Path(out).with_name("transfers.bin")
    tb = bytearray(struct.pack("<3I", 0x31465254, len(stops), len(t_to)))
    tb += struct.pack(f"<{len(t_start)}I", *t_start)
    tb += struct.pack(f"<{len(t_to)}H", *t_to)
    tb += struct.pack(f"<{len(t_m)}H", *t_m)
    tr_path.write_bytes(bytes(tb))
    print(f"Zapisano {tr_path.name}: {len(t_to):,} przesiadek pieszych do {TRANSFER_MAX:.0f} m ({len(tb) / 1e6:.1f} MB)", file=sys.stderr)

    for s in stops:
        sn = stop_node.get(s["id"])
        if sn:
            s["w"] = [sn[0], round(sn[1], 1)]
        else:
            s.pop("w", None)
    stops_doc.setdefault("meta", {})["walk"] = {"path": Path(out).name, "nodes": N, "edges": E, "transfers": tr_path.name}
    Path(stops_path).write_text(json.dumps(stops_doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    far = sum(1 for s in stops if s["id"] not in stop_node)
    print(f"Zapisano {out}: {N:,} węzłów, {E:,} krawędzi, {Gn:,} punktów geometrii "
          f"({len(buf) / 1e6:.1f} MB). Przystanki przyklejone: {len(stop_node)}/{len(stops)}"
          + (f" ({far} dalej niż 300 m od drogi — liczone w linii prostej)" if far else ""), file=sys.stderr)


if __name__ == "__main__":
    main()
