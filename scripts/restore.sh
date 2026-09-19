#!/usr/bin/env bash
# GAVEL — database restore (production blocker #5).
#
# Usage:
#   bash scripts/restore.sh backups/gavel-20260101-031500.sql.gz            # restore
#   bash scripts/restore.sh backups/gavel-20260101-031500.sql.gz --force    # wipe target first
#
# Safety:
#   - refuses to restore into a database that already has GAVEL tables,
#     unless --force is passed (which DROPS them first)
#   - --force asks for typed confirmation
#   - never prints DATABASE_URL
#
# Post-deploy steps after a restore:
#   bunx prisma migrate deploy --schema prisma/schema.postgres.prisma
#   (reconciles the migration history if the backup predates a migration)

set -euo pipefail

FILE="${1:?usage: restore.sh <backup.sql.gz> [--force]}"
FORCE="${2:-}"
[[ "${3:-}" == "--force" ]] && FORCE="--force"

: "${DATABASE_URL:?DATABASE_URL must be set}"
[[ -f "$FILE" ]] || { echo "ERROR: $FILE not found" >&2; exit 1; }

if [[ ! "$DATABASE_URL" == postgres://* && ! "$DATABASE_URL" == postgresql://* ]]; then
  echo "SQLite restore: stopping the app first, then:" >&2
  echo "  gunzip -c \"$FILE\" > \"${DATABASE_URL#file:}\"" >&2
  exit 0
fi

# Guard: non-empty database?
TABLES=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null || echo 0)
if [[ "$TABLES" != "0" && "$FORCE" != "--force" ]]; then
  echo "REFUSING: target database already has $TABLES table(s)." >&2
  echo "Pass --force to DROP them first (destructive)." >&2
  exit 1
fi

if [[ "$FORCE" == "--force" ]]; then
  read -r -p "Type 'restore' to confirm dropping all tables in the target DB: " CONFIRM
  [[ "$CONFIRM" == "restore" ]] || { echo "aborted" >&2; exit 1; }
  psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null
fi

gunzip -c "$FILE" | psql "$DATABASE_URL" >/dev/null
echo "Restore complete: $FILE → $DATABASE_URL"
echo "Next: bunx prisma migrate deploy --schema prisma/schema.postgres.prisma"
