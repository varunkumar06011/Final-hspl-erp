#!/usr/bin/env bash
# Creates a validated PostgreSQL backup of the Supabase production database.
#
# Read-only against the database: only pg_dump is executed.
#
# Required env:
#   SUPABASE_DB_URL   postgresql://... connection string (never printed)
# Optional env:
#   BACKUP_DIR        output directory (default: ./backup)
#   BACKUP_SCHEMAS    comma-separated schemas to dump (default: public)
#
# Output (BACKUP_DIR/<YYYY-MM-DD>/):
#   hspl-erp-<timestamp>.dump        pg_dump custom format (-Fc), compressed, schema+data
#   hspl-erp-<timestamp>.schema.sql.gz  plain-SQL schema-only dump (human readable reference)
#   manifest.json
set -Eeuo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "::error::SUPABASE_DB_URL is not set" >&2
  exit 1
fi

for tool in pg_dump pg_restore psql gzip sha256sum python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "::error::required tool '$tool' not found in PATH" >&2
    exit 1
  fi
done

BACKUP_DIR="${BACKUP_DIR:-./backup}"
BACKUP_SCHEMAS="${BACKUP_SCHEMAS:-public}"
BACKUP_DATE="$(date -u +%Y-%m-%d)"
BACKUP_TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${BACKUP_DIR}/${BACKUP_DATE}"
BASENAME="hspl-erp-${BACKUP_TS}"
DUMP_FILE="${OUT_DIR}/${BASENAME}.dump"
SCHEMA_FILE="${OUT_DIR}/${BASENAME}.schema.sql"
MANIFEST="${OUT_DIR}/manifest.json"

mkdir -p "$OUT_DIR"

export PGCONNECT_TIMEOUT=30

echo "==> Checking database connectivity"
SERVER_VERSION="$(psql --dbname="$SUPABASE_DB_URL" -X -q -At -c 'SHOW server_version;')"
SERVER_MAJOR="${SERVER_VERSION%%[^0-9]*}"
CLIENT_VERSION="$(pg_dump --version | sed -E 's/^pg_dump \(PostgreSQL\) ([0-9]+(\.[0-9]+)?).*/\1/')"
CLIENT_MAJOR="${CLIENT_VERSION%%.*}"
echo "    server: ${SERVER_VERSION}  pg_dump client: ${CLIENT_VERSION}"

# pg_dump must be at least as new as the server it dumps.
if [[ "$SERVER_MAJOR" -gt "$CLIENT_MAJOR" ]]; then
  echo "::error::pg_dump ${CLIENT_VERSION} is older than server ${SERVER_VERSION}; install a matching client" >&2
  exit 1
fi

SCHEMA_ARGS=()
IFS=',' read -ra SCHEMA_LIST <<<"$BACKUP_SCHEMAS"
for s in "${SCHEMA_LIST[@]}"; do
  SCHEMA_ARGS+=(--schema="$s")
done

echo "==> Creating custom-format dump (schemas: ${BACKUP_SCHEMAS})"
pg_dump \
  --dbname="$SUPABASE_DB_URL" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --no-subscriptions \
  --no-publications \
  "${SCHEMA_ARGS[@]}" \
  --file="$DUMP_FILE"

echo "==> Creating plain-SQL schema-only dump"
pg_dump \
  --dbname="$SUPABASE_DB_URL" \
  --format=plain \
  --schema-only \
  --no-owner \
  --no-privileges \
  --no-subscriptions \
  --no-publications \
  "${SCHEMA_ARGS[@]}" \
  --file="$SCHEMA_FILE"
gzip -9 "$SCHEMA_FILE"
SCHEMA_FILE="${SCHEMA_FILE}.gz"

echo "==> Validating backup files"
for f in "$DUMP_FILE" "$SCHEMA_FILE"; do
  if [[ ! -s "$f" ]]; then
    echo "::error::backup file missing or empty: $(basename "$f")" >&2
    exit 1
  fi
done

# Custom-format dumps must be readable by pg_restore (this only reads the
# archive's table of contents; it never connects to a database).
TOC="$(pg_restore --list "$DUMP_FILE")"
TABLE_COUNT="$(grep -c ' TABLE DATA ' <<<"$TOC" || true)"
if [[ "$TABLE_COUNT" -lt 1 ]]; then
  echo "::error::dump contains no TABLE DATA entries" >&2
  exit 1
fi
echo "    dump archive OK: ${TABLE_COUNT} tables with data"

gzip -t "$SCHEMA_FILE"
if ! gzip -dc "$SCHEMA_FILE" | grep -q '^CREATE TABLE'; then
  echo "::error::schema dump contains no CREATE TABLE statements" >&2
  exit 1
fi
echo "    schema dump OK"

echo "==> Writing manifest"
python3 - "$MANIFEST" "$BACKUP_DATE" "$BACKUP_TS" "$SERVER_VERSION" "$CLIENT_VERSION" "$BACKUP_SCHEMAS" "$TABLE_COUNT" "$DUMP_FILE" "$SCHEMA_FILE" <<'PY'
import hashlib, json, os, sys

manifest, date, ts, server, client, schemas, tables, *files = sys.argv[1:]

def describe(path, fmt, restore_with):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return {
        "name": os.path.basename(path),
        "format": fmt,
        "restore_with": restore_with,
        "size_bytes": os.path.getsize(path),
        "sha256": h.hexdigest(),
    }

doc = {
    "backup_name": os.path.basename(os.path.dirname(manifest)),
    "backup_date": date,
    "created_at": ts,
    "backup_tool": "pg_dump",
    "backup_format": "pg_dump custom (-Fc) + plain schema-only SQL (gzip)",
    "manifest_version": 1,
    "database": {"type": "postgresql", "server_version": server, "schemas": schemas.split(",")},
    "pg_dump_version": client,
    "table_data_entries": int(tables),
    "files": [
        describe(files[0], "pg_dump-custom", "pg_restore"),
        describe(files[1], "plain-sql-schema-only.gz", "gunzip | psql"),
    ],
    "created_by": "github-actions/database-backup",
}
with open(manifest, "w") as fh:
    json.dump(doc, fh, indent=2)
    fh.write("\n")
PY

python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$MANIFEST"

echo "==> Backup complete: ${OUT_DIR}"
ls -la "$OUT_DIR"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "backup_dir=${OUT_DIR}"
    echo "backup_date=${BACKUP_DATE}"
  } >>"$GITHUB_OUTPUT"
fi
