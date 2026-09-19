#!/usr/bin/env bash
# GAVEL — database backup with retention (production blocker #5).
#
# Usage:
#   bash scripts/backup.sh                    # daily backup (default)
#   bash scripts/backup.sh weekly             # weekly backup (longer retention)
#
# What it does:
#   Postgres (production):  pg_dump | gzip → backup dir, retention applied.
#   SQLite (dev fallback):  safe file copy (the app must not be writing —
#                           use the Postgres path for anything real).
#
# Retention (files are named gavel-YYYYMMDD-HHMMSS.sql.gz):
#   daily   → keep the newest 7
#   weekly  → keep the newest 4
#
# Cron example (03:15 daily + Sunday 03:45 weekly):
#   15 3 * * *   cd /opt/gavel && bash scripts/backup.sh daily    >> /var/log/gavel-backup.log 2>&1
#   45 3 * * 0   cd /opt/gavel && bash scripts/backup.sh weekly   >> /var/log/gavel-backup.log 2>&1
#
# The script NEVER prints the DATABASE_URL (logs are a leak surface).

set -euo pipefail

CADENCE="${1:-daily}"
KEEP=7
[[ "$CADENCE" == "weekly" ]] && KEEP=4

: "${DATABASE_URL:?DATABASE_URL must be set (postgres://… for production backups)}"

BACKUP_DIR="${GAVEL_BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/gavel-$STAMP.sql.gz"

if [[ "$DATABASE_URL" == postgres://* || "$DATABASE_URL" == postgresql://* ]]; then
  pg_dump "$DATABASE_URL" | gzip > "$OUT"
else
  # SQLite fallback: extract the file path from file:/path/to/db
  DB_PATH="${DATABASE_URL#file:}"
  DB_PATH="${DB_PATH%%\?*}"
  if [[ ! -f "$DB_PATH" ]]; then
    echo "ERROR: $DB_PATH not found" >&2
    exit 1
  fi
  echo "WARN: SQLite path — copying file. Use Postgres + pg_dump for production." >&2
  gzip -c "$DB_PATH" > "$OUT"
fi

# Retention: keep newest $KEEP gavel-*.sql.gz files
ls -1t "$BACKUP_DIR"/gavel-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r f; do
  rm -f "$f"
done

SIZE=$(du -h "$OUT" | cut -f1)
echo "$(date -u +%FT%TZ)  $CADENCE backup OK  →  $OUT ($SIZE), keeping newest $KEEP"
