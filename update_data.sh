#!/bin/bash
# Full data update: downloads the GTFS feeds, generates stops_data.json, deps/ and conns/,
# builds walk.bin and transfers.bin, then validates the result. Used both locally and in CI.
# Usage: bash update_data.sh      (walking network is read from walk_osm/; downloaded via download_walk.sh if missing)
set -euo pipefail
cd "$(dirname "$0")"
# "today" in the generator must be the Kraków date, also on a CI runner in UTC
export TZ=Europe/Warsaw

FEEDS=(
  "GTFS_KRK_A.zip|https://gtfs.ztp.krakow.pl/GTFS_KRK_A.zip"
  "GTFS_KRK_T.zip|https://gtfs.ztp.krakow.pl/GTFS_KRK_T.zip"
  "GTFS_KRK_M.zip|https://gtfs.ztp.krakow.pl/GTFS_KRK_M.zip"
  "ald-gtfs.zip|https://gtfs.kolejemalopolskie.com.pl/?download=L2hvbWUvYnByb2cvcm96a2xhZHlfamF6ZHkvYWxkLWd0ZnMuemlw"
  "kml-ska-gtfs.zip|https://gtfs.kolejemalopolskie.com.pl/?download=L2hvbWUvYnByb2cvcm96a2xhZHlfamF6ZHkva21sLXNrYS1ndGZzLnppcA%3D%3D"
)

# 1. timetables: download to .part first, replace the old file only once it is a valid GTFS ZIP.
# If a feed fails, fall back to its previous file so the other feeds still get updated;
# fallbacks are listed in stale_feeds.txt (CI fails the run after deploying, so someone gets an email).
: > stale_feeds.txt
for f in "${FEEDS[@]}"; do
  name="${f%%|*}"; url="${f#*|}"
  echo "Downloading $name ..."
  # grep without -q: with pipefail an early grep exit would SIGPIPE unzip and fail the check
  if curl -fsSL --retry 4 --retry-delay 30 --retry-all-errors --connect-timeout 20 --max-time 300 \
       -A "czy-to-zadupie/1.0" -o "$name.part" "$url" \
     && unzip -Z1 "$name.part" 2>/dev/null | grep -x "stop_times.txt" >/dev/null; then
    mv "$name.part" "$name"
    continue
  fi
  rm -f "$name.part"
  if ! unzip -Z1 "$name" 2>/dev/null | grep -x "stop_times.txt" >/dev/null; then
    echo "ERROR: could not download $name and there is no previous copy to fall back to"; exit 1
  fi
  msg="$name: download failed, using the previous copy"
  echo "WARNING: $msg"
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::warning::$msg"; fi
  echo "$name" >> stale_feeds.txt
done

# 2. walking network (changes rarely; in CI it lives in the Actions cache)
if ! ls walk_osm/part_*.json >/dev/null 2>&1 || [ "$(ls walk_osm/part_*.json | wc -l)" -lt 12 ]; then
  bash download_walk.sh
fi

# 3. generation; remove old deps/ and conns/ because the generator never deletes files
rm -rf deps conns
python3 generate_stops_data.py GTFS_KRK_A.zip GTFS_KRK_T.zip GTFS_KRK_M.zip ald-gtfs.zip kml-ska-gtfs.zip -o stops_data.json
python3 build_walk_graph.py stops_data.json walk_osm/part_*.json -o walk.bin

# 4. sanity check: better to publish nothing than broken data
python3 - <<'EOF'
import datetime as dt, json, sys
d = json.load(open("stops_data.json", encoding="utf-8"))
stops, routes, meta = d["stops"], d["routes"], d["meta"]
types = {r["type"] for r in routes.values()}
glued = sum(1 for s in stops if s.get("w"))
today = dt.date.today().isoformat()
errors = []
if len(stops) < 4000:
    errors.append(f"too few stops: {len(stops)}")
if not {"tram", "bus", "train"} <= types:
    errors.append(f"missing a transport mode, only got: {sorted(types)}")
if glued < 0.99 * len(stops):
    errors.append(f"only {glued}/{len(stops)} stops snapped to the street network")
if today not in meta["calendar"]:
    errors.append(f"calendar does not include today ({today})")
if errors:
    sys.exit("DATA ERROR: " + "; ".join(errors))
print(f"Data OK: {len(stops)} stops, {len(routes)} lines, {len(meta['calendar'])} days from {min(meta['calendar'])}")
EOF
