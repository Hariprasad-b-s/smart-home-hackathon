#!/usr/bin/env bash
# Regenerate the Synthea FHIR output used to build seeds.json.
#   SYNTHEA_JAR   standalone Synthea jar (default: tools/synthea/synthea-with-dependencies.jar
#                 in this repo; download from https://github.com/synthetichealth/synthea/releases)
#   Output: server/data/synthea/output/fhir/*.json  (gitignored; ~255 MB)
# Then run: npx tsx server/data/synthea/import.ts
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/output"
ROOT="$(cd "$HERE/../../.." && pwd)"
JAR="${SYNTHEA_JAR:-$ROOT/tools/synthea/synthea-with-dependencies.jar}"
if [[ ! -f "$JAR" ]]; then
  echo "Synthea jar not found at $JAR (set SYNTHEA_JAR or download synthea-with-dependencies.jar into tools/synthea/)" >&2
  exit 1
fi
rm -rf "$OUT"
mkdir -p "$OUT"
cd "$OUT"
java -jar "$JAR" -s 20260624 -cs 20260624 -p 300 -a 12-17 \
  --exporter.baseDirectory="$OUT/" \
  --exporter.fhir.export=true \
  --exporter.hospital.fhir.export=false \
  --exporter.practitioner.fhir.export=false \
  --exporter.years_of_history=5 \
  Ohio Cincinnati
echo "Synthea FHIR bundles written to $OUT/fhir ($(ls "$OUT/fhir" | wc -l | tr -d ' ') files)"
