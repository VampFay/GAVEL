#!/usr/bin/env bash
# ingest-demo.sh — end-to-end proof that uploaded evidence produces findings.
#
# This is the "demo → product" acceptance test for the ingestion MVP: it
# resets the demo DB, logs in as the seeded admin, uploads the three sample
# CSVs through POST /api/ingest (the same route the intake wizard uses),
# runs the reconciliation engine, and asserts that NEW findings were created
# FROM THE UPLOADED DATA. Then it re-uploads everything to prove
# idempotence (no duplicates).
#
# Usage:   bash scripts/ingest-demo.sh [base_url]
#          base_url defaults to http://localhost:3000
#
# Exit codes: 0 = all assertions passed · 1 = assertion failed · 2 = setup error
set -uo pipefail

BASE="${1:-http://localhost:3000}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

say()  { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
pass() { printf '\033[1;32mPASS\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31mFAIL\033[0m %s\n' "$*"; FAILED=1; }
FAILED=0

jsonget() { python3 -c "
import json,sys
try:
    d = json.loads(sys.argv[1])
    for part in sys.argv[2].split('.'):
        d = d[part]
    print(d)
except Exception:
    print('ERROR')
" "$1" "$2"; }

# ── 0. Reset to a deterministic state ─────────────────────────────────────
say "Resetting demo database (db:push + seed)"
if ! bun run db:push >/dev/null 2>&1 || ! bun run seed:dev >/dev/null 2>&1; then
  echo "could not reset/seed the database (need bun + prisma)" >&2
  exit 2
fi

# ── 1. Login as the seeded admin ──────────────────────────────────────────
say "Login (admin@gavel.demo)"
LOGIN=$(curl -s -c "$JAR" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@gavel.demo","password":"gavel-admin-demo"}')
[ "$(jsonget "$LOGIN" 'ok')" = "True" ] && pass "admin session established" || { fail "login failed: $LOGIN"; exit 2; }

CID=$(curl -s -b "$JAR" "$BASE/api/clients" | python3 -c "import json,sys; print(json.load(sys.stdin)['clients'][0]['id'])")
[ -n "$CID" ] && pass "seeded client resolved ($CID)" || { fail "no clients"; exit 2; }

# ── 2. Baseline finding count ─────────────────────────────────────────────
BASELINE=$(curl -s -b "$JAR" "$BASE/api/audits/$CID" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['contract']['findings']))")
pass "baseline findings: $BASELINE"

# ── 3. Upload the three sample files (dryRun first, then commit) ──────────
upload() { # upload <file> <sourceType> <dryRun>
  curl -s -b "$JAR" -X POST "$BASE/api/ingest" \
    -F "file=@$REPO_ROOT/public/ingest-samples/$1" \
    -F "sourceType=$2" -F "clientId=$CID" -F "dryRun=$3"
}

for SRC in jira-tickets github-commits invoice-lines; do
  say "Dry-run preview: $SRC"
  DRY=$(upload "$SRC.sample.csv" "$SRC" true)
  [ "$(jsonget "$DRY" 'ok')" = "True" ] && pass "preview ok — parsed $(jsonget "$DRY" 'parsed'), valid $(jsonget "$DRY" 'valid'), invalid $(jsonget "$DRY" 'invalid')" \
                                    || fail "preview rejected: $DRY"
done

say "Commit: jira-tickets"
T=$(upload "jira-tickets.sample.csv" "jira-tickets" false)
[ "$(jsonget "$T" 'committed.created')" -gt 0 ] 2>/dev/null && pass "tickets created: $(jsonget "$T" 'committed.created')" || fail "no tickets created: $T"

say "Commit: github-commits"
C=$(upload "github-commits.sample.csv" "github-commits" false)
[ "$(jsonget "$C" 'committed.created')" -gt 0 ] 2>/dev/null && pass "code activities created: $(jsonget "$C" 'committed.created')" || fail "no commits created: $C"

say "Commit: invoice-lines"
I=$(upload "invoice-lines.sample.csv" "invoice-lines" false)
[ "$(jsonget "$I" 'committed.invoicesCreated')" -gt 0 ] 2>/dev/null && pass "invoices created: $(jsonget "$I" 'committed.invoicesCreated'), lines: $(jsonget "$I" 'committed.linesCreated')" || fail "no invoices created: $I"

# ── 4. Run the engine — THE assertion: findings from uploaded data ────────
say "Reconciliation engine run (POST /api/audits/{clientId}/reconcile)"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/audits/$CID/reconcile")
CREATED=$(jsonget "$R" 'created')
echo "$R" | python3 -c "
import json,sys
d = json.load(sys.stdin)
for f in d.get('findings', []):
    print(f\"  [{f['confidence']:6}] {f['type']:18} {f['title'][:80]}\")"
[ "$CREATED" -gt 0 ] 2>/dev/null && pass "$CREATED new findings derived from uploaded evidence" || fail "engine created no new findings (created=$CREATED)"

AFTER=$(curl -s -b "$JAR" "$BASE/api/audits/$CID" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['contract']['findings']))")
pass "findings: $BASELINE → $AFTER (delta $((AFTER - BASELINE)))"

# ── 5. Idempotence: re-upload everything, expect zero creates ─────────────
say "Idempotence: re-upload all three files"
T2=$(upload "jira-tickets.sample.csv" "jira-tickets" false)
[ "$(jsonget "$T2" 'committed.created')" = "0" ] && pass "tickets re-upload: created 0, updated $(jsonget "$T2" 'committed.updated')" || fail "tickets duplicated: $T2"
C2=$(upload "github-commits.sample.csv" "github-commits" false)
[ "$(jsonget "$C2" 'committed.created')" = "0" ] && pass "commits re-upload: created 0, duplicates $(jsonget "$C2" 'committed.duplicates')" || fail "commits duplicated: $C2"
I2=$(upload "invoice-lines.sample.csv" "invoice-lines" false)
[ "$(jsonget "$I2" 'committed.invoicesCreated')" = "0" ] && pass "invoices re-upload: created 0, lines skipped $(jsonget "$I2" 'committed.linesSkippedExistingInvoice')" || fail "invoices duplicated: $I2"

# ── 6. Verdict ─────────────────────────────────────────────────────────────
say "Verdict"
if [ "$FAILED" = "0" ]; then
  echo "✔ Uploaded evidence → engine findings, end-to-end, idempotent."
  exit 0
else
  echo "✘ One or more assertions failed."
  exit 1
fi
