#!/usr/bin/env bash
# Regression runner: generate each case with the TS/JS port, compare against its
# reference STL, record metrics + pass/fail. Run from repo root: bash tools/regression/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=tools/regression/out
mkdir -p "$OUT"
CASES=tools/regression/cases.json
N=$(python3 -c "import json;print(len(json.load(open('$CASES'))))")
echo "== GridFlock baseplate regression =="
SUMMARY=""
for i in $(seq 0 $((N-1))); do
  NAME=$(python3 -c "import json;print(json.load(open('$CASES'))[$i]['name'])")
  PLATE=$(python3 -c "import json;p=json.load(open('$CASES'))[$i]['plate'];print(f'{p[0]}x{p[1]}')")
  BED=$(python3 -c "import json;b=json.load(open('$CASES'))[$i]['bed'];print(f'{b[0]}x{b[1]}')")
  REF=$(python3 -c "import json;print(json.load(open('$CASES'))[$i]['ref'])")
  GEN="$OUT/$NAME.stl"
  echo "-- $NAME  plate=$PLATE bed=$BED --"
  npx tsx tools/gen.ts "$PLATE" "$BED" "$GEN" 2>/dev/null
  if python3 tools/compare.py "$REF" "$GEN" --json --samples 80000 > "$OUT/$NAME.json" 2>/dev/null; then
    RES=PASS; else RES=FAIL; fi
  python3 - "$OUT/$NAME.json" "$NAME" "$RES" <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); dev=d['surface_deviation_mm']
print(f"   extent_diff={d['extent_diff']} vol_ref={d['reference']['volume']} vol_gen={d['generated']['volume']}")
print(f"   surface_dev mean={dev['mean']} p95={dev['p95']} p99={dev['p99']} max={dev['max']}")
print(f"   result: {sys.argv[3]}")
PY
  SUMMARY="$SUMMARY$NAME: $RES\n"
done
echo "== summary =="
echo -e "$SUMMARY"
