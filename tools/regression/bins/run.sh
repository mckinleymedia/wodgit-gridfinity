#!/usr/bin/env bash
# Bin/bin regression: generate each case's STL and compare it to its reference.
# Cases with a null "ref" are generated + sanity-checked (watertight/degenerate)
# but cannot be surface-compared until a reference export is captured.
#
#   tools/regression/bins/run.sh
set -uo pipefail
cd "$(dirname "$0")/../../.."   # repo root
DIR=tools/regression/bins
REFDIR=reference/bins          # canonical reference exports
OUT=$DIR/out
mkdir -p "$OUT"

fail=0
cases=$(python3 -c "import json;print('\n'.join(f\"{c['id']} {c['nx']} {c['ny']} {c['units']} {c.get('ref') or 'NONE'}\" for c in json.load(open('$DIR/cases.json'))['cases']))")

while read -r id nx ny units ref; do
  [ -z "$id" ] && continue
  stl="$OUT/$id.stl"
  npx tsx tools/genbin.ts "$nx" "$ny" "$units" "$stl" >/dev/null 2>&1
  if [ "$ref" = "NONE" ]; then
    echo "--- $id (no reference: self-check only) ---"
    python3 tools/bincheck.py "$stl" || fail=1
  else
    python3 tools/bincompare.py "$stl" "$REFDIR/$ref" --json "$OUT/$id.json" 2>/dev/null
    rc=$?
    [ $rc -ne 0 ] && fail=1
  fi
done <<< "$cases"

echo ""
[ $fail -eq 0 ] && echo "ALL CASES PASS" || echo "SOME CASES FAILED"
exit $fail
