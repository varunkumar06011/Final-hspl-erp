#!/usr/bin/env python3
"""Upload a validated backup directory to Google Drive and apply retention.

Authentication: Google Application Default Credentials. In GitHub Actions the
`google-github-actions/auth` step (OIDC / Workload Identity Federation,
impersonating the backup service account) writes a credential file and sets
GOOGLE_APPLICATION_CREDENTIALS; no long-lived keys are used.

Required env:
  GOOGLE_DRIVE_FOLDER_ID       ID of the shared backup root folder
Optional env:
  BACKUP_RETENTION_COUNT       newest N backup folders to keep (default 30, 0 disables deletion)

Usage: drive_upload.py <local_backup_dir>

Drive layout:  <root folder>/<YYYY-MM-DD>/<files>
Every folder and file created here is tagged with appProperties
{"managed_by": MANAGED_BY}. Retention only ever deletes *folders* directly
inside the root that carry that tag AND match the date-name pattern; it never
touches the root folder or anything it did not create.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time

import google.auth
from google.auth.exceptions import DefaultCredentialsError
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload

MANAGED_BY = "hspl-erp-database-backup"
FOLDER_MIME = "application/vnd.google-apps.folder"
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SCOPES = ["https://www.googleapis.com/auth/drive"]
RETRIES = 4


def fail(msg: str) -> None:
    print(f"::error::{msg}", file=sys.stderr)
    sys.exit(1)


def with_retry(request):
    delay = 2
    for attempt in range(1, RETRIES + 1):
        try:
            return request.execute()
        except HttpError as exc:
            if exc.resp.status in (429, 500, 502, 503, 504) and attempt < RETRIES:
                print(f"    transient Drive error {exc.resp.status}, retrying in {delay}s")
                time.sleep(delay)
                delay *= 2
                continue
            raise


def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def build_service():
    try:
        creds, _ = google.auth.default(scopes=SCOPES)
    except DefaultCredentialsError as exc:
        fail(f"no Google credentials available ({exc}); the OIDC auth step must run before this script")
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def get_root(service, folder_id: str) -> dict:
    try:
        root = with_retry(
            service.files().get(fileId=folder_id, fields="id,name,mimeType,driveId", supportsAllDrives=True)
        )
    except HttpError as exc:
        fail(f"cannot access GOOGLE_DRIVE_FOLDER_ID ({exc.resp.status}); is the folder shared with the service account?")
    if root["mimeType"] != FOLDER_MIME:
        fail("GOOGLE_DRIVE_FOLDER_ID does not point to a folder")
    return root


def list_children(service, parent_id: str, extra_q: str = "") -> list[dict]:
    q = f"'{parent_id}' in parents and trashed = false"
    if extra_q:
        q += f" and {extra_q}"
    items: list[dict] = []
    token = None
    while True:
        resp = with_retry(
            service.files().list(
                q=q,
                fields="nextPageToken, files(id,name,mimeType,size,md5Checksum,sha256Checksum,createdTime,appProperties)",
                pageSize=200,
                pageToken=token,
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
            )
        )
        items.extend(resp.get("files", []))
        token = resp.get("nextPageToken")
        if not token:
            return items


def ensure_day_folder(service, root_id: str, name: str) -> str:
    existing = list_children(service, root_id, f"name = '{name}' and mimeType = '{FOLDER_MIME}'")
    if existing:
        if existing[0].get("appProperties", {}).get("managed_by") != MANAGED_BY:
            fail(f"Drive folder {name} already exists but was not created by this automation; refusing to write into it")
        print(f"    reusing existing Drive folder {name}")
        return existing[0]["id"]
    folder = with_retry(
        service.files().create(
            body={
                "name": name,
                "mimeType": FOLDER_MIME,
                "parents": [root_id],
                "appProperties": {"managed_by": MANAGED_BY},
            },
            fields="id",
            supportsAllDrives=True,
        )
    )
    print(f"    created Drive folder {name}")
    return folder["id"]


def upload_file(service, parent_id: str, path: str) -> None:
    name = os.path.basename(path)
    local_size = os.path.getsize(path)
    local_sha = sha256_of(path)
    if local_size == 0:
        fail(f"refusing to upload empty file {name}")

    for dup in list_children(service, parent_id, f"name = '{name}'"):
        if dup.get("appProperties", {}).get("managed_by") != MANAGED_BY:
            fail(f"{name} already exists in Drive folder but was not created by this automation; refusing to overwrite")
        print(f"    replacing earlier {name} from a previous run today")
        with_retry(service.files().delete(fileId=dup["id"], supportsAllDrives=True))

    media = MediaFileUpload(path, mimetype="application/octet-stream", resumable=True, chunksize=8 * 1024 * 1024)
    request = service.files().create(
        body={
            "name": name,
            "parents": [parent_id],
            "appProperties": {"managed_by": MANAGED_BY, "sha256": local_sha},
        },
        media_body=media,
        fields="id,name,size,sha256Checksum",
        supportsAllDrives=True,
    )
    response = None
    while response is None:
        _, response = request.next_chunk(num_retries=RETRIES)

    remote = with_retry(
        service.files().get(fileId=response["id"], fields="id,name,size,sha256Checksum", supportsAllDrives=True)
    )
    remote_size = int(remote.get("size", -1))
    if remote_size != local_size:
        fail(f"upload verification failed for {name}: local {local_size} bytes, Drive {remote_size} bytes")
    remote_sha = remote.get("sha256Checksum")
    if remote_sha and remote_sha != local_sha:
        fail(f"upload verification failed for {name}: sha256 mismatch")
    print(f"    uploaded + verified {name} ({local_size} bytes, sha256 {'matched' if remote_sha else 'not reported by Drive'})")


def apply_retention(service, root_id: str, keep: int) -> None:
    if keep <= 0:
        print("==> Retention disabled (BACKUP_RETENTION_COUNT=0)")
        return
    folders = list_children(
        service,
        root_id,
        f"mimeType = '{FOLDER_MIME}' and appProperties has {{ key='managed_by' and value='{MANAGED_BY}' }}",
    )
    managed = sorted(
        (f for f in folders if DATE_RE.match(f["name"]) and f.get("appProperties", {}).get("managed_by") == MANAGED_BY),
        key=lambda f: f["name"],
        reverse=True,
    )
    print(f"==> Retention: {len(managed)} managed backup folders found, keeping newest {keep}")
    for folder in managed[keep:]:
        if folder["id"] == root_id:
            fail("retention attempted to delete the root folder; aborting")
        print(f"    deleting old backup folder {folder['name']} (id {folder['id']})")
        with_retry(service.files().delete(fileId=folder["id"], supportsAllDrives=True))


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: drive_upload.py <local_backup_dir>")
    local_dir = sys.argv[1]
    if not os.path.isdir(local_dir):
        fail(f"backup directory not found: {local_dir}")
    day_name = os.path.basename(os.path.normpath(local_dir))
    if not DATE_RE.match(day_name):
        fail(f"backup directory name must be YYYY-MM-DD, got {day_name!r}")

    manifest_path = os.path.join(local_dir, "manifest.json")
    if not os.path.isfile(manifest_path):
        fail("manifest.json missing from backup directory")
    with open(manifest_path) as fh:
        manifest = json.load(fh)
    expected = [f["name"] for f in manifest["files"]] + ["manifest.json"]
    for name in expected:
        p = os.path.join(local_dir, name)
        if not os.path.isfile(p) or os.path.getsize(p) == 0:
            fail(f"expected backup file missing or empty: {name}")
    for entry in manifest["files"]:
        if sha256_of(os.path.join(local_dir, entry["name"])) != entry["sha256"]:
            fail(f"local checksum mismatch for {entry['name']}; backup corrupted before upload")

    folder_id = os.environ.get("GOOGLE_DRIVE_FOLDER_ID")
    if not folder_id:
        fail("GOOGLE_DRIVE_FOLDER_ID is not set")
    keep = int(os.environ.get("BACKUP_RETENTION_COUNT", "30"))

    service = build_service()
    print("==> Checking Drive folder access")
    root = get_root(service, folder_id)
    print(f"    root folder: {root['name']} ({'shared drive' if root.get('driveId') else 'My Drive'})")

    print(f"==> Uploading {day_name}")
    day_id = ensure_day_folder(service, root["id"], day_name)
    for name in expected:
        upload_file(service, day_id, os.path.join(local_dir, name))

    print("==> Confirming upload")
    remote_names = {f["name"] for f in list_children(service, day_id)}
    missing = [n for n in expected if n not in remote_names]
    if missing:
        fail(f"files missing on Drive after upload: {missing}")
    print(f"    all {len(expected)} files present in Drive folder {day_name}")

    apply_retention(service, root["id"], keep)
    print("==> Done")


if __name__ == "__main__":
    main()
