# Database Disaster Recovery

How to restore the production PostgreSQL database from the daily backups
described in [DATABASE_BACKUPS.md](./DATABASE_BACKUPS.md).

> **READ FIRST — restore safety**
>
> - **Never restore over production without understanding the consequences.**
>   A restore replaces table contents; anything written after the backup was
>   taken is lost.
> - **Stop application writes before any destructive restore** (suspend the
>   backend service on Render/Railway, or put it in maintenance mode).
> - **Always restore to a test database first**, verify it, and only then
>   point production at it or repeat the procedure on production.
> - **Verify the backup file** (`pg_restore --list`) before doing anything
>   destructive.
> - Database backups **do not contain Supabase Storage objects** (uploaded
>   files). Restoring the database does not restore those files.

## What a backup contains

Each `YYYY-MM-DD/` folder on Google Drive holds:

| File | Format | Restore with |
| --- | --- | --- |
| `hspl-erp-<ts>.dump` | `pg_dump --format=custom`, schema **and data** of schema `public`, no owners/privileges | `pg_restore` |
| `hspl-erp-<ts>.schema.sql.gz` | plain SQL, schema only | `gunzip -c ... \| psql` (reference / partial use) |
| `manifest.json` | metadata: dates, PostgreSQL & pg_dump versions, sha256 per file | — |

The dump covers everything Prisma manages (all tables, sequences, indexes,
constraints, foreign keys). It does **not** contain roles or Supabase's own
schemas; a fresh Supabase project already provides those, so there is no
separate "roles" or "globals" restore step.

## Prerequisites (on the machine performing the restore)

- PostgreSQL client tools **at least as new as the version in
  `manifest.json → pg_dump_version`** (`pg_restore --version`). Install e.g.
  `postgresql-client-17` from <https://apt.postgresql.org> (Linux),
  `brew install libpq` (macOS), or the EDB installer (Windows).
- The backup files downloaded from Google Drive.
- The **Session pooler** connection URI (port 5432) of the *target*
  database from Supabase → Connect. Never paste it into a shared document.
- Prisma migration state is included in the dump (`_prisma_migrations`
  table), so after a restore `prisma migrate deploy` (run by the backend on
  start) sees the database as up to date **for the migrations that existed at
  backup time**. If the backend has newer migrations, they will be applied on
  start — this is expected and correct.

## Step 0 — Verify the backup before touching any database

```bash
# 1. checksum matches the manifest
sha256sum hspl-erp-<ts>.dump
grep -A2 '"hspl-erp-<ts>.dump"' manifest.json     # compare the sha256 field

# 2. archive is readable and lists the tables (no DB connection is made)
pg_restore --list hspl-erp-<ts>.dump | grep -c 'TABLE DATA'   # should be > 0
```

If either check fails, pick another day's backup.

## Restore order

For this dump format the exact order is:

1. Target database exists and its `public` schema is **empty** (fresh
   project, or you have dropped/recreated the schema deliberately).
2. `pg_restore --schema=public --no-owner --no-privileges --exit-on-error`
   (restores tables, then data, then indexes/constraints/FKs — pg_restore
   orders this internally).
3. Verify (row counts, constraints).
4. Only then point the application at it.

`--schema=public` is required: the dump contains a `CREATE SCHEMA public`
entry which already exists in every PostgreSQL/Supabase database, and
`--schema=public` skips that entry while restoring everything inside the
schema. `--exit-on-error` makes the restore stop at the first problem
instead of continuing with a half-restored database.

The core command:

```bash
export TARGET_DB_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'

pg_restore \
  --dbname="$TARGET_DB_URL" \
  --schema=public \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  --verbose \
  hspl-erp-<ts>.dump
```

Optional: `--jobs=4` speeds up large restores (custom format supports parallel
restore; not with `--single-transaction`).

## Scenario 1 — Data corruption (project still exists)

Goal: replace the contents of the `public` schema with a chosen historical
backup, or recover specific rows.

### 1a. Recover specific tables/rows (preferred when only some data is bad)

Restore the backup into a **separate** database (new Supabase project, or a
local PostgreSQL) using the core command above, inspect it with SQL, and copy
the needed rows back to production with explicit `INSERT ... SELECT` /
`UPDATE` statements you have reviewed. This never drops anything in production.

### 1b. Full replace of production `public` schema

1. **Stop application writes** — suspend the backend service (Render:
   *Suspend service*; Railway: remove replicas / pause) and confirm no
   connections remain:
   ```sql
   select count(*) from pg_stat_activity where datname = 'postgres' and application_name <> 'psql';
   ```
2. **Take a fresh safety dump of the current (corrupted) state** so you can go
   back:
   ```bash
   pg_dump --dbname="$PROD_DB_URL" --format=custom --schema=public --no-owner --no-privileges \
     --file="pre-restore-$(date -u +%Y%m%dT%H%M%SZ).dump"
   ```
3. **Rehearse on a test database first** (Scenario 2 steps 3–5 against a
   throwaway project). Do not skip this.
4. **Empty the production `public` schema** (destructive — this is the point
   of no return):
   ```bash
   psql --dbname="$PROD_DB_URL" -v ON_ERROR_STOP=1 -c '
     DROP SCHEMA public CASCADE;
     CREATE SCHEMA public;
     GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
     GRANT ALL ON SCHEMA public TO postgres;'
   ```
   (The `GRANT`s re-create Supabase's default grants; harmless if the roles
   are unused by this app.)
5. **Restore** with the core `pg_restore` command using `$PROD_DB_URL`.
6. **Verify** (see *Verification* below).
7. **Resume** the backend service and smoke-test the application.

## Scenario 2 — Entire Supabase project/database lost

1. **Stop application writes.** Suspend the backend on Render/Railway so it
   does not keep failing/retrying against the dead database, and so nothing
   writes to the new one before the restore finishes.

2. **Create a replacement Supabase project** in the same region as before
   (Supabase dashboard → New project). Choose a strong database password and
   store it in the team password manager. Wait until the project is *Active*.
   Do **not** run Prisma migrations or start the backend against it yet.

3. **Download the backup from Google Drive.** Open the backup folder →
   choose the newest `YYYY-MM-DD/` (or the last known-good day) → download
   `hspl-erp-<ts>.dump` and `manifest.json`. Run **Step 0** verification.

4. **Restore.** Get the new project's *Session pooler* URI (Connect → Session
   pooler, port 5432) and run:
   ```bash
   export TARGET_DB_URL='postgresql://postgres.<new-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'
   pg_restore --dbname="$TARGET_DB_URL" --schema=public --no-owner --no-privileges --exit-on-error --verbose hspl-erp-<ts>.dump
   ```
   Exit code must be `0`. If it fails midway, drop and recreate the schema
   (Scenario 1b step 4 command, against the **new** project) and rerun; do
   not try to restore on top of a partial restore.

5. **Verify tables and data** — see *Verification* below.

6. **Update backend environment variables** on the hosting provider
   (Render/Railway dashboard → Environment):
   - `DATABASE_URL` → new project's URI in the same form the old value used
     (check the current value's host/port/query string and mirror it)
   - `DIRECT_URL` → new project's *Session pooler* or direct URI (port 5432)
   - If the project used Supabase Storage: `SUPABASE_URL` and
     `SUPABASE_SERVICE_KEY` of the new project — **and note that the uploaded
     files themselves are gone unless Storage was backed up separately.**
   - Do not change any other variable.

7. **Verify the application.** Resume the backend; on start it runs
   `prisma migrate deploy`, which should report *No pending migrations* (or
   apply only migrations newer than the backup). Then: log in, open a
   project, list purchase orders/invoices, create one test record and delete
   it, check real-time updates. Watch backend logs for Prisma errors.

8. **Resume production.** Re-enable traffic. Update the
   `SUPABASE_DB_URL` GitHub secret to the new project's Session pooler URI so
   the backup workflow protects the new database, and run the *Database
   Backup* workflow manually to confirm.

## Verification

Run against the restored database:

```sql
-- table count in public (expect the same number as manifest.table_data_entries)
select count(*) from pg_tables where schemaname = 'public';

-- row counts of key tables
select 'users' t, count(*) from users
union all select 'projects', count(*) from projects
union all select 'purchase_orders', count(*) from purchase_orders
union all select 'payment_requests', count(*) from payment_requests
union all select 'audit_logs', count(*) from audit_logs;

-- foreign keys present
select count(*) from pg_constraint c join pg_namespace n on n.oid = c.connamespace
where n.nspname = 'public' and c.contype = 'f';

-- Prisma migration state
select migration_name, finished_at from _prisma_migrations order by finished_at desc limit 5;
```

Compare table/row counts with what you expect from the backup date. Spot-check
a few business records (a recent PO, an invoice with its payments).

## Restore test (non-production)

Do this once after setup and periodically (e.g. quarterly). **Never against
production.**

1. Run the *Database Backup* workflow manually; confirm the dated folder and
   three files appear in Google Drive.
2. Create a throwaway target: a new (free-tier) Supabase project **or** a
   local PostgreSQL of the same major version, e.g.
   `docker run --rm -e POSTGRES_PASSWORD=pw -p 5432:5432 postgres:17`.
3. Download the `.dump` and `manifest.json`; run Step 0.
4. Restore with the core `pg_restore` command (for the local container:
   `postgresql://postgres:pw@localhost:5432/postgres`).
5. Run the *Verification* queries; check that table count matches
   `table_data_entries`, key tables have data, and FK count is non-zero.
6. Record the date, backup used, and results in the team's runbook / issue
   tracker; delete the throwaway project/container.

If the test environment requires paid resources or credentials you do not
have, stop and request them — do not improvise against production.
