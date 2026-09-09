#!/usr/bin/env bash
# Rename ShipLedger → GAVEL across the entire codebase.
# - display brand: GAVEL (all caps, per owner's choice)
# - code identifiers / paths / cookies / headers: gavel (lowercase)
# - env vars: GAVEL_*
set -euo pipefail
cd /home/z/my-project

echo "== 1/3 Renaming paths =="
git mv src/components/shipledger src/components/gavel
git mv src/lib/shipledger.ts src/lib/gavel.ts
git mv tests/unit/shipledger.test.ts tests/unit/gavel.test.ts

echo "== 2/3 Replacing strings in all tracked files =="
# git ls-files reflects the NEW paths after git mv (rename is staged).
git ls-files -z | while IFS= read -r -d '' f; do
  [ -f "$f" ] || continue
  # Order matters: most-specific tokens first; generic forms last.
  sed -i \
    -e 's/SHIPLEDGER_REQUIRE_AUTH/GAVEL_REQUIRE_AUTH/g' \
    -e 's/SHIPLEDGER_JWT_SECRET/GAVEL_JWT_SECRET/g' \
    -e 's/SHIPLEDGER_ADMIN_TOKEN/GAVEL_ADMIN_TOKEN/g' \
    -e 's/shipledger-admin-demo/gavel-admin-demo/g' \
    -e 's/shipledger-reviewer-demo/gavel-reviewer-demo/g' \
    -e 's/shipledger-viewer-demo/gavel-viewer-demo/g' \
    -e 's/shipledger-user-id/gavel-user-id/g' \
    -e 's/shipledger-actor/gavel-actor/g' \
    -e 's/shipledger-role/gavel-role/g' \
    -e 's/shipledger_token/gavel_token/g' \
    -e 's/ShipLedger-Actor/Gavel-Actor/g' \
    -e 's/ShipLedger/GAVEL/g' \
    -e 's/shipledger/gavel/g' \
    "$f"
done

echo "== 3/3 Verifying zero remnants =="
if git grep -iq shipledger; then
  echo "FAIL: remnants found:"; git grep -in shipledger; exit 1
else
  echo "OK: no 'shipledger' (any case) remains in tracked files"
fi

echo "New totals:"
git grep -io "gavel[a-z_-]*" | sed 's/.*://' | sort | uniq -c | sort -rn | head -15
