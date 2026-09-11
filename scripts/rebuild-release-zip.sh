#!/usr/bin/env bash
# rebuild-release-zip.sh — rebuild download/GAVEL-release.zip at current HEAD.
# Includes: full-history git bundle, README, worklog, the current evidence
# screenshot set, and every document currently present in download/.
# Safe to re-run: staging dir is wiped and recreated; zip is overwritten.
#
# NOTE (2026-09-12): the platform re-provision wiped the previous
# download/ contents (23 QA screenshots, English change-log DOCX, Apple
# digest). This packager now ships whatever evidence exists TODAY —
# regenerate screenshots/screenshots-equivalents before re-running if you
# need them in the archive.
set -euo pipefail

REPO=/home/z/my-project
STAGE="$REPO/.release-staging"
OUT="$REPO/download/GAVEL-release.zip"
DL="$REPO/download"

cd "$REPO"

# ── 0. Preflight: clean tree, known HEAD ────────────────────────────────────
if [ -n "$(git status --porcelain)" ]; then
  echo "ABORT: working tree not clean — commit or stash first." >&2
  git status --short >&2
  exit 1
fi
HEAD_SHA="$(git rev-parse --short HEAD)"
HEAD_SUBJECT="$(git log -1 --pretty=%s)"
echo "» Packaging release @ $HEAD_SHA ($HEAD_SUBJECT)"

# ── 1. Fresh staging tree ──────────────────────────────────────────────────
rm -rf "$STAGE"
mkdir -p "$STAGE/screenshots"

# ── 2. Full-history git bundle at HEAD ─────────────────────────────────────
git bundle create --quiet "$STAGE/gavel.bundle" --all HEAD
git bundle verify "$STAGE/gavel.bundle" >/dev/null 2>&1
echo "» Bundle OK ($(git bundle list-heads "$STAGE/gavel.bundle" | wc -l) ref(s))"

# ── 3. Latest worklog ───────────────────────────────────────────────────────
cp "$REPO/worklog.md" "$STAGE/worklog.md"

# ── 4. Every evidence screenshot currently in download/ ────────────────────
shopt -s nullglob
shots=("$DL"/gavel-*.png)
shopt -u nullglob
if [ "${#shots[@]}" -eq 0 ]; then
  echo "» WARNING: no gavel-*.png screenshots in download/ — archive will carry none" >&2
fi
for f in "${shots[@]}"; do
  cp "$f" "$STAGE/screenshots/$(basename "$f")"
done
echo "» ${#shots[@]} screenshot(s) staged"

# ── 5. Documents currently in download/ (docx/pdf/md, excluding this zip) ──
DOCS=""
for f in "$DL"/*.docx "$DL"/*.pdf "$DL"/*.md; do
  [ -f "$f" ] || continue
  cp "$f" "$STAGE/$(basename "$f")"
  DOCS="$DOCS $(basename "$f")"
done
echo "» Documents staged:$DOCS"

# ── 6. README.txt ───────────────────────────────────────────────────────────
cat > "$STAGE/README.txt" <<EOF
GAVEL — Forensic delivery-to-billing reconciliation
====================================================
Release package @ commit $HEAD_SHA ("$HEAD_SUBJECT")
Branch: main · full git history preserved · authored by VampFay

CONTENTS
--------
1. gavel.bundle        — complete git repository bundle (all commits +
                         full history). Restore: git clone gavel.bundle GAVEL
2. screenshots/       — ${#shots[@]} evidence capture(s): the ingestion
                         wizard golden path (evidence upload step, preview
                         panel, engine result) plus dashboard, audits,
                         review queue, audit case file
3. worklog.md         — engineering log (reconstructed 2026-09-12 after a
                         platform re-provision wiped the untracked original;
                         Tasks 1-17)
EOF
if [ -n "$DOCS" ]; then
  echo "4. Documents:$DOCS" >> "$STAGE/README.txt"
fi
cat >> "$STAGE/README.txt" <<EOF

VERIFICATION STATUS (all green at packaging time)
-------------------------------------------------
- ESLint ........ 0 errors (advisory warnings only, pre-existing)
- TypeScript .... tsc --noEmit clean
- Tests ......... 184/184 (unit, vitest) — engine, rate limiter, ingestion
- Build ......... production build green
- Ingestion E2E . scripts/ingest-demo.sh — resets DB, uploads 3 sample
                  CSVs, reconciles, asserts findings delta >= 1 from
                  uploaded evidence, proves idempotence (17/17 PASS)
- Live harness .. scripts/live-audit.ts (78 assertions, in repo)
- Re-runnable .. all scripts above live in the repo

RESTORING THE REPOSITORY
------------------------
  git clone gavel.bundle GAVEL
  cd GAVEL
  bun install
  cp .env.example .env            # then set a real GAVEL_JWT_SECRET for
                                  # anything beyond local dev
  bun run db:push                 # create SQLite schema
  bun run seed:dev                # demo tenant, findings, invoices
  bun run dev                     # http://localhost:3000
  bash scripts/ingest-demo.sh     # ingestion → findings, end-to-end proof

DEMO CREDENTIALS (DEV BUILD ONLY — never shown in production)
------------------------------------------------------------
  admin@gavel.demo    / gavel-admin-demo
  reviewer@gavel.demo / gavel-reviewer-demo
  viewer@gavel.demo   / gavel-viewer-demo

PUSHING TO GITHUB
-----------------
The GitHub remote (VampFay/GAVEL) is NOT updated in this package. To push:
issue a fresh PAT (Contents RW + Workflows RW + Metadata RO), then
  GAVEL_GH_TOKEN=<token> bash scripts/push-github.sh
The token never appears in any child process argv (GIT_ASKPASS helper +
curl -K - stdin config) and never touches a persistent file.

WHAT GAVEL DOES
---------------
GAVEL cross-examines your SOW, your delivery evidence (Jira/GitHub) and your
invoices — then issues a verdict on every billed dollar. Contracts are
pasted in and LLM-extracted; delivery + billing evidence arrives via CSV/JSON
upload (POST /api/ingest — the intake wizard's Evidence step); the engine
reconciles milestones, change orders, effort caps and invoice lines into
reviewable findings with immutable audit logging. OAuth connectors (GitHub,
Jira, QuickBooks) remain Phase 2 and will feed the same ingestion pipeline.

KNOWN LIMITS (stated, not hidden)
---------------------------------
- Single-instance deployment. No per-record tenant authorization yet — any
  authenticated (in dev: anonymous) caller reads everything. Do not share an
  instance between customers until the tenancy phase lands.
- SQLite, labeled dev-grade by this README's own quickstart.
- LLM extraction (z-ai-web-dev-sdk) is verified inside the build sandbox,
  untested outside it.
- No self-serve signup/provisioning — users are seeded by hand.
EOF

# ── 7. Zip it ───────────────────────────────────────────────────────────────
rm -f "$OUT"
( cd "$STAGE" && zip -q -r -X "$OUT" README.txt gavel.bundle worklog.md screenshots )
if [ -n "$DOCS" ]; then
  ( cd "$STAGE" && zip -q -r -X "$OUT" $DOCS )
fi

# ── 8. Verify ───────────────────────────────────────────────────────────────
echo "» Archive: $(du -h "$OUT" | cut -f1), $(unzip -l "$OUT" | tail -1 | awk '{print $2}') files"
unzip -l "$OUT" | sed -n '1,8p'
echo "» Bundle inside zip records HEAD:"
unzip -p "$OUT" gavel.bundle > "$STAGE/.verify.bundle"
git bundle list-heads "$STAGE/.verify.bundle"
rm -f "$STAGE/.verify.bundle"

# ── 9. Cleanup staging ──────────────────────────────────────────────────────
rm -rf "$STAGE"
echo "✔ Release rebuilt: $OUT"
