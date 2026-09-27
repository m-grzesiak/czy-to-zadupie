#!/bin/bash
# Pobiera sieć pieszą OSM dla mapy zasięgu w 12 kawałkach (mniejsze zapytania = serwer nie odrzuca).
# Użycie: bash download_walk.sh     -> pliki walk_osm/*.json
set -u
cd "$(dirname "$0")"
mkdir -p walk_osm
SERVERS=("https://maps.mail.ru/osm/tools/overpass/api/interpreter" "https://overpass-api.de/api/interpreter" "https://overpass.private.coffee/api/interpreter")
LATS=(49.89 50.0133 50.1367 50.26)
LONS=(19.57 19.77 19.97 20.17 20.37)
FILTER='["highway"~"^(footway|pedestrian|path|steps|living_street|residential|unclassified|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|cycleway|road|service|corridor)$"]["access"!~"^(private|no)$"]["foot"!~"^(no|private)$"]["service"!~"^(parking_aisle|driveway)$"]'
n=0
for i in 0 1 2; do
  for j in 0 1 2 3; do
    n=$((n+1))
    out="walk_osm/part_${i}_${j}.json"
    if [ -s "$out" ] && head -c 20 "$out" | grep -q '{'; then echo "[$n/12] $out już jest"; continue; fi
    bbox="${LATS[$i]},${LONS[$j]},${LATS[$((i+1))]},${LONS[$((j+1))]}"
    q="[out:json][timeout:180];way${FILTER}(${bbox});(._;>;);out skel qt;"
    ok=0
    for attempt in 1 2 3; do
      for srv in "${SERVERS[@]}"; do
        echo "[$n/12] $bbox  ($srv, próba $attempt)"
        curl -sS --connect-timeout 20 --max-time 240 -o "$out" -A "krakow-transit-map/1.0" -H "Accept: application/json" --data-urlencode "data=$q" "$srv"
        if head -c 20 "$out" | grep -q '{' && tail -c 50 "$out" | grep -q '\]'; then ok=1; break 2; fi
        msg=$(head -c 2000 "$out" 2>/dev/null | sed "s/<[^>]*>//g" | grep -iE "rate_limited|timeout|too busy|Not Acceptable|Too Many" | head -1 | cut -c1-80)
        echo "      serwer odmówił ${msg:+($msg) }— czekam 45 s"; sleep 45
      done
    done
    [ $ok = 1 ] || { echo "Nie udało się pobrać $bbox — uruchom skrypt ponownie (pobrane kawałki zostaną)."; rm -f "$out"; exit 1; }
    sleep 10
  done
done
echo "Gotowe: $(du -sh walk_osm | cut -f1) w walk_osm/"
