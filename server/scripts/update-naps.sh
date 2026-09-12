#!/usr/bin/env bash
# Re-import the NAP database from the committed naps_export.csv.gz (production).
# Prereqs: Linux/macOS with curl + python3. Run after pushing a new naps_export.csv.gz
# and waiting for the Render deploy to complete.
#
#   cd server && bash scripts/update-naps.sh
#   override with: API_URL=https://... EMP_ID=EMP001 PIN=123456 bash scripts/update-naps.sh
set -euo pipefail

API_URL="${API_URL:-https://selfie-api-sqgh.onrender.com}"
EMP_ID="${EMP_ID:-EMP001}"
PIN="${PIN:-123456}"
AUTH=""

login() {
  echo "[1/3] Logging in as ${EMP_ID}..."
  local resp token
  resp=$(curl -sf -X POST "${API_URL}/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"employee_id\":\"${EMP_ID}\",\"pin\":\"${PIN}\"}")
  token=$(echo "${resp}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")
  if [ -z "${token}" ]; then
    echo "Login failed (pin must be the admin EMP's current pin)." >&2
    exit 1
  fi
  AUTH="Authorization: Bearer ${token}"
}

trigger() {
  echo "[2/3] Triggering NAP re-import in background..."
  local out
  out=$(curl -sf -X POST "${API_URL}/api/naps/import" -H "${AUTH}")
  echo "${out}"
}

poll() {
  echo "[3/3] Watching import progress (run: check every 15s)..."
  while true; do
    local status done msg
    status=$(curl -sf "${API_URL}/api/naps/import/status" -H "${AUTH}")
    done=$(echo "${status}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('done'))")
    if [ "${done}" = "True" ]; then
      echo "${status}" | python3 -c "
import sys,json
d=json.load(sys.stdin)
if d.get('error'):
    print('IMPORT FAILED:', d['error']); sys.exit(1)
print(f\"IMPORT COMPLETE: {d.get('imported')}/{d.get('total')} rows, finished {d.get('finishedAt')}\")"
      return
    fi
    echo "${status}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"  imported {d.get('imported')}/{d.get('total')} ...\")"
    sleep 15
  done
}

login
trigger
poll