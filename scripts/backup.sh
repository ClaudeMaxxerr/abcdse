#!/usr/bin/env bash
# backup.sh — Phase B7 Task 4
#
# Creates a timestamped PostgreSQL backup using pg_dump.
# Requires: pg_dump, DIRECT_URL environment variable.
#
# Usage:
#   DIRECT_URL="postgresql://user:pass@host:5432/dbname" ./scripts/backup.sh
#   DIRECT_URL="..." ./scripts/backup.sh /path/to/backup/dir
#
# Backup naming convention: tracker_YYYYMMDD_HHMMSS.sql.gz

set -euo pipefail

BACKUP_DIR="${1:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/tracker_${TIMESTAMP}.sql.gz"

if [ -z "${DIRECT_URL:-}" ]; then
  echo "ERROR: DIRECT_URL environment variable is required" >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

echo "Creating backup: ${BACKUP_FILE}"

pg_dump \
  --dbname="${DIRECT_URL}" \
  --format=plain \
  --no-owner \
  --no-acl \
  --verbose \
  | gzip > "${BACKUP_FILE}"

SIZE=$(du -sh "${BACKUP_FILE}" | cut -f1)
echo "Backup complete: ${BACKUP_FILE} (${SIZE})"
echo ""
echo "To restore:"
echo "  gunzip -c ${BACKUP_FILE} | psql \"\${DIRECT_URL}\""
