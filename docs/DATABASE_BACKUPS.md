# Database Backups

Automated daily backups of the production Supabase PostgreSQL database to
Google Drive, run entirely from GitHub Actions. The backup system is
independent of wherever the backend runs (Render, Railway, ...) and makes no
changes to the database — it only reads it with `pg_dump`.

For restoring, see [DATABASE_DISASTER_RECOVERY.md](./DATABASE_DISASTER_RECOVERY.md).

## Architecture

```text
Supabase Production PostgreSQL
            │  read-only pg_dump over the Session Pooler (port 5432)
            ▼
GitHub Actions  .github/workflows/database-backup.yml   (daily cron + manual)
            │
            ├── scripts/backup/backup-database.sh
            │     ├── pg_dump --format=custom  (schema + data, compressed)
            │     ├── pg_dump --schema-only    (plain SQL, gzip; human reference)
            │     ├── validate: files non-empty, pg_restore --list, gzip -t
            │     └── manifest.json (dates, versions, sha256 per file)
            │
            └── scripts/backup/drive_upload.py
                  ├── re-verify local sha256 against manifest
                  ├── create <root>/<YYYY-MM-DD>/ and upload every file
                  ├── verify each upload (size + sha256 reported by Drive)
                  ├── confirm every expected file is listed in Drive
                  └── retention: delete folders created by this automation
                                 beyond the newest 30
```

Files:

| Path | Purpose |
| --- | --- |
| `.github/workflows/database-backup.yml` | Schedule, tool installation, step ordering, secret wiring |
| `scripts/backup/backup-database.sh` | Dump + validate + manifest (fails on any problem) |
| `scripts/backup/drive_upload.py` | Upload + verify + retention (fails on any problem) |
| `scripts/backup/requirements.txt` | Pinned Google API client libraries |

### What is backed up

`pg_dump` of the `public` schema (everything Prisma manages: all 50+
application tables, sequences, constraints, indexes, foreign keys and data),
with `--no-owner --no-privileges` so the dump restores cleanly into any
PostgreSQL/Supabase project regardless of role names.

Not included, by design:

- Supabase-managed schemas (`auth`, `storage`, `realtime`, `extensions`,
  `supabase_functions`, ...). The application authenticates with Firebase,
  not Supabase Auth, so nothing of ours lives in `auth`.
- Roles / global objects. Supabase does not allow `pg_dumpall`; roles are
  provisioned by Supabase itself in every project.
- **Supabase Storage objects (uploaded files).** The backend uses Supabase
  Storage in production (`STORAGE_MODE=supabase`, see
  `backend/src/services/storage.service.ts`). The database stores only the
  object *paths*; the actual files live in Storage buckets and are **NOT**
  covered by this backup. See [Limitations](#limitations).

### Backup layout on Google Drive

```text
<GOOGLE_DRIVE_FOLDER_ID>/
└── 2026-09-02/
    ├── hspl-erp-20260902T204712Z.dump            pg_dump custom format (restore with pg_restore)
    ├── hspl-erp-20260902T204712Z.schema.sql.gz   schema-only plain SQL (reference / diffing)
    └── manifest.json
```

`manifest.json` example (no secrets are ever written to it):

```json
{
  "backup_name": "2026-09-02",
  "backup_date": "2026-09-02",
  "created_at": "20260902T204712Z",
  "backup_tool": "pg_dump",
  "backup_format": "pg_dump custom (-Fc) + plain schema-only SQL (gzip)",
  "manifest_version": 1,
  "database": { "type": "postgresql", "server_version": "17.4", "schemas": ["public"] },
  "pg_dump_version": "17.6",
  "table_data_entries": 52,
  "files": [
    { "name": "hspl-erp-20260902T204712Z.dump", "format": "pg_dump-custom", "restore_with": "pg_restore", "size_bytes": 1234567, "sha256": "..." },
    { "name": "hspl-erp-20260902T204712Z.schema.sql.gz", "format": "plain-sql-schema-only.gz", "restore_with": "gunzip | psql", "size_bytes": 23456, "sha256": "..." }
  ],
  "created_by": "github-actions/database-backup"
}
```

Every folder and file the automation creates carries the Drive
`appProperties` tag `managed_by=hspl-erp-database-backup`; retention relies
on that tag.

## Schedule

`cron: "47 20 * * *"` — **20:47 UTC every day = 02:17 IST**, a low-traffic
window for an India-based team. GitHub Actions cron is always UTC and does
not follow DST; scheduled runs can also start a few minutes late (or be
skipped) under GitHub load, which is why the workflow can also be triggered
manually. To change the time, edit the cron line in the workflow and convert
your desired local time to UTC.

## Secrets Required

Configure these as **GitHub Actions repository secrets**
(Settings → Secrets and variables → Actions → New repository secret).
Names only — never put the values anywhere in the repository.

Always required:

| Secret | Contents |
| --- | --- |
| `SUPABASE_DB_URL` | PostgreSQL connection URI for the production database (see below) |
| `GOOGLE_DRIVE_FOLDER_ID` | ID of the Drive folder that holds the backups |

Plus **one** of the two Google Drive authentication modes. The workflow picks
the mode automatically: if `GOOGLE_OAUTH_REFRESH_TOKEN` is set it uses
mode A, otherwise mode B.

**Mode A — OAuth user (personal Gmail / My Drive folder).** Uploads run as
*you*; files are owned by your account and use your storage quota. This is
the only option when the folder lives in a personal My Drive, because
Google service accounts have no Drive storage quota.

| Secret | Contents |
| --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth client ID (Desktop app) from Google Cloud |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Its client secret |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | Refresh token minted once with `scripts/backup/oauth_consent.py` |

**Mode B — OIDC + Workload Identity Federation (Google Workspace / Shared
drive folder).** `google-github-actions/auth` exchanges a short-lived GitHub
OIDC token for a short-lived Google token as the service account; the
workflow declares `permissions: id-token: write` for this.

| Secret | Contents |
| --- | --- |
| `WORKLOAD_IDENTITY_PROVIDER` | `projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>` |
| `SERVICE_ACCOUNT_EMAIL` | Email of the backup service account that the workflow impersonates |

Neither mode uses long-lived service-account JSON keys.

### `SUPABASE_DB_URL` — which connection string to use

In the Supabase dashboard: **Project → Connect** (top bar) → **Method: Session pooler**.
Use the URI shown there, port **5432**, e.g.

```text
postgresql://postgres.<project-ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Why the *Session* pooler:

- GitHub-hosted runners are IPv4-only. Supabase's *direct* connection
  (`db.<ref>.supabase.co:5432`) is IPv6 unless the paid IPv4 add-on is
  enabled, so it usually fails from GitHub Actions. The pooler is IPv4.
- The *Transaction* pooler (port 6543) does not support the session-level
  features `pg_dump` needs; do not use it.

The direct connection (`db.<ref>.supabase.co:5432`, i.e. the backend's
`DIRECT_URL`) also works when it is reachable over IPv4 (IPv4 add-on, or a
project whose direct host resolves over IPv4 — this was the case for the
first successful production run). If a run fails in *Create and validate backup* with a network /
`could not translate host name` / `Network is unreachable` error, switch the
secret to the Session pooler URI. URL-encode special characters in the
password (`@` → `%40`, etc.). Do **not** reuse or change any application
environment variable — this is a separate secret.

## Initial Setup

### 1. Google Cloud project and Drive API

1. Go to <https://console.cloud.google.com/> and create a project
   (e.g. `hspl-erp-backups`), or pick an existing one.
2. **APIs & Services → Library → Google Drive API → Enable.**

### 2a. Mode A — OAuth user credentials (personal Gmail)

1. **APIs & Services → OAuth consent screen**: user type *External*, fill in
   the app name and your email. Under **Audience** set the publishing status
   to **In production** — refresh tokens issued while the app is in
   *Testing* expire after 7 days and the backups would start failing.
   (Google shows an "unverified app" warning during consent; that is fine
   for an app only you use — click *Advanced → Go to … (unsafe)*.)
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**,
   application type **Desktop app**. Copy the client ID and secret.
3. On your own computer, logged into the Google account that owns the
   backup folder, run `python3 scripts/backup/oauth_consent.py`, paste the
   client ID/secret, approve the consent screen. It prints the three
   `GOOGLE_OAUTH_*` values to store as GitHub secrets. Nothing is written
   to disk; do not share the refresh token.
4. Skip sections 2b/2c; the Drive folder just needs to be owned by (or
   shared as Editor with) that Google account.

To revoke: <https://myaccount.google.com/permissions> → remove the app, and
delete the GitHub secrets.

### 2b. Mode B — Service account (no keys)

1. **IAM & Admin → Service Accounts → Create service account.**
   Name it e.g. `db-backup-uploader`. It needs **no** IAM roles on the
   project — Drive access is granted through folder sharing.
2. Do **not** create a JSON key. Note the service-account email
   (`db-backup-uploader@<project>.iam.gserviceaccount.com`).

### 2c. Mode B — Workload Identity Federation for GitHub Actions

1. **IAM & Admin → Workload Identity Federation → Create pool** (e.g.
   `github-actions`).
2. **Add a provider**: OpenID Connect, issuer
   `https://token.actions.githubusercontent.com`, attribute mapping at least
   `google.subject = assertion.sub` and
   `attribute.repository = assertion.repository`, and attribute condition
   `assertion.repository == "varunkumar06011/Final-hspl-erp"` so only this
   repository can authenticate.
3. On the service account → **Permissions → Grant access**: principal
   `principalSet://iam.googleapis.com/projects/<number>/locations/global/workloadIdentityPools/<pool>/attribute.repository/varunkumar06011/Final-hspl-erp`
   with role **Workload Identity User** (`roles/iam.workloadIdentityUser`).
4. Copy the provider's full resource name
   (`projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>`)
   — that is the `WORKLOAD_IDENTITY_PROVIDER` secret value.

### 3. Google Drive folder

1. In Google Drive create a folder, e.g. `HSPL ERP DB Backups`.
   Mode B requires it to be inside a **Shared drive** (Google Workspace) —
   a service account cannot upload into My Drive (see
   [Limitations](#limitations)). Mode A works with a plain My Drive folder.
2. Mode B only: share that folder (or the shared drive) with the
   service-account email as **Editor** (Shared drive: *Content manager*).
3. Open the folder; the URL is
   `https://drive.google.com/drive/folders/<FOLDER_ID>`. Copy `<FOLDER_ID>`.

The service account can only see what is explicitly shared with it — it
has no access to the rest of your Drive. In mode A the OAuth token has the
full `drive` scope for your account, so keep the refresh token secret.

### 4. GitHub secrets

Add `SUPABASE_DB_URL`, `GOOGLE_DRIVE_FOLDER_ID` and the secrets for your
chosen mode.

### 5. First run

Trigger a manual backup (next section) and confirm the folder appears in
Drive. Then follow the restore test in
[DATABASE_DISASTER_RECOVERY.md](./DATABASE_DISASTER_RECOVERY.md#restore-test-non-production)
against a throwaway database before relying on the backups.

## Manual Backup

GitHub → **Actions** → **Database Backup** → **Run workflow** → choose the
branch (`master`) → optionally change *retention_count* → **Run workflow**.

`retention_count` defaults to 30; set it to `0` to skip deletion entirely
for that run.

Running twice on the same UTC date reuses the `YYYY-MM-DD` folder: the
dump files have unique timestamps so both are kept, and `manifest.json` is
replaced by the newer one.

## Checking Backups

- **Google Drive:** open the backup folder; there should be one dated
  sub-folder per day, each with a `.dump`, a `.schema.sql.gz` and a
  `manifest.json`. Compare `size_bytes` / `sha256` in the manifest with the
  file details in Drive if in doubt.
- **GitHub Actions:** Actions → Database Backup. Each run's summary shows
  the backup date; the log of *Upload to Google Drive* lists every file
  with `uploaded + verified` and its size. A run with any red step did
  **not** produce a usable backup.
- **Periodically (recommended monthly):** download the newest `.dump` and
  run `pg_restore --list <file>` locally; it should print the table of
  contents without errors.

## Failure Handling

Every step uses `set -Eeuo pipefail` / Python exceptions and the workflow has
no `continue-on-error` or `|| true`; the run is red if anything fails. GitHub
emails the repository owner / workflow actor on failed scheduled runs by
default (Settings → Notifications → Actions).

| Failing step | What to check |
| --- | --- |
| *Check required secrets* | One of the four secrets is missing or empty |
| *Authenticate to Google Cloud* (mode B) | WIF provider name wrong, attribute condition does not match this repo, service account missing `roles/iam.workloadIdentityUser` for the pool principal, or `id-token: write` permission removed |
| *Upload* — `OAuth refresh token rejected` (mode A) | Token expired (OAuth app still in *Testing*), revoked, or password/security change; re-run `oauth_consent.py` and update the secret |
| *Create and validate backup* — connection error | `SUPABASE_DB_URL` wrong/rotated password, using direct IPv6 host from GitHub, project paused |
| *Create and validate backup* — `pg_dump ... is older than server` | Supabase upgraded PostgreSQL; bump `PG_MAJOR` in the workflow |
| *Create and validate backup* — `no TABLE DATA entries` | Dump connected to the wrong database/schema |
| *Upload* — `cannot access GOOGLE_DRIVE_FOLDER_ID` | Folder not shared with the service account, wrong ID, or Drive API not enabled |
| *Upload* — `storageQuotaExceeded` | Mode B with a My Drive folder; switch to mode A or move the folder to a Shared drive (see Limitations) |
| *Upload* — `verification failed` | Transient Drive issue; re-run manually. If persistent, do not trust that day's backup |
| *Upload* — `already exists ... not created by this automation` | Someone manually created a folder/file with the same name in the backup folder; rename it |

A run that fails leaves no partial upload marked as valid: files are only
counted after size/sha256 verification, and `manifest.json` is uploaded last.

## Retention

- After each successful upload, `drive_upload.py` lists the sub-folders of
  the root backup folder that **both** are named `YYYY-MM-DD` **and** carry
  the `managed_by=hspl-erp-database-backup` tag.
- They are sorted by name (= date) and everything beyond the newest
  **30** is deleted, each deletion logged as
  `deleting old backup folder <date> (id ...)`.
- Anything else — the root folder itself, files or folders you created by
  hand, folders without the tag — is never touched.
- Deletion goes to the Drive owner's **Trash** (30-day recovery) unless the
  folder is in a shared drive with a shorter trash policy.
- Change the count via the `retention_count` workflow input for a single
  run, or edit the `BACKUP_RETENTION_COUNT` default in the workflow.
  `0` disables deletion.

Manual cleanup, if ever needed: delete dated sub-folders in Drive by hand;
never delete the root folder (its ID is in the GitHub secret).

## Limitations

- **Supabase Storage is not backed up.** Uploaded documents/images live in
  Storage buckets, not in PostgreSQL. A separate Storage backup is required
  for full disaster recovery of files.
- **Service-account storage quota.** Files uploaded by a service account are
  owned by it. Google has been removing/zeroing storage quota for service
  accounts in *My Drive*; if uploads fail with `storageQuotaExceeded`, put
  the backup folder in a **Shared drive** (files there are owned by the
  drive, and the script already passes `supportsAllDrives`). A personal
  Gmail account cannot create shared drives; use mode A (OAuth user
  credentials) instead. Mode A's refresh token is a long-lived credential
  for your Google account — store it only as a GitHub secret and revoke it
  if it may have leaked.
- **Point-in-time.** Backups are daily snapshots; up to 24 h of data can be
  lost. Supabase's own PITR add-on is the option for tighter windows.
- **Consistency.** `pg_dump` takes a consistent snapshot of the `public`
  schema at the moment it runs; the application keeps running (no locks
  that block normal reads/writes beyond DDL).
- The dump is not encrypted at rest beyond Google Drive's own encryption.
  Restrict who has access to the Drive folder accordingly.
