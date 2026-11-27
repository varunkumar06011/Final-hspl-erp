/**
 * Google Drive file storage (STORAGE_MODE=gdrive).
 *
 * Uploads go into one Drive folder (GOOGLE_DRIVE_FILES_FOLDER_ID), in a sub-folder per
 * kind ("documents", "photos", "gate-pass-videos", "logos"), created on first use.
 * Files stay private: nothing is shared or made public. The ERP backend downloads a file
 * and sends it to the user, so who may open what is decided by the ERP as before.
 *
 * Auth is OAuth as the Drive owner (works for a personal Gmail My Drive and for a
 * Workspace account): client id + secret + a refresh token minted once with
 * scripts/backup/oauth_consent.py. Uses Drive's REST API directly (no extra package).
 *
 * The stored path is "gdrive:<fileId>", so the ERP can tell Drive files from files saved
 * earlier in Supabase or the local folder and open each from the right place.
 */
import type { StorageService, UploadResult } from './storage.service';

export const GDRIVE_PREFIX = 'gdrive:';
export const isDrivePath = (filePath: string | null | undefined): boolean =>
  typeof filePath === 'string' && filePath.startsWith(GDRIVE_PREFIX);

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
// Shared drives need these on every call; harmless for My Drive.
const ALL_DRIVES = 'supportsAllDrives=true';

export interface DriveConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  rootFolderId: string;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Drive asks clients to back off and retry on rate limits and server errors. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
/** Largest file sent in a single multipart request (Drive's documented limit for that upload type). */
export const MULTIPART_MAX_BYTES = 5 * 1024 * 1024;

export class GoogleDriveStorageService implements StorageService {
  private token: { value: string; expiresAt: number } | null = null;
  private tokenPending: Promise<string> | null = null;
  private folders = new Map<string, Promise<string>>();

  constructor(
    private readonly cfg: DriveConfig,
    private readonly fetchFn: FetchLike = (url, init) => fetch(url, init),
    private readonly retryDelayMs = 500,
  ) {}

  /** Access token from the refresh token, cached until a minute before it expires. */
  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    if (!this.tokenPending) {
      this.tokenPending = (async () => {
        const res = await this.fetchFn(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: this.cfg.clientId,
            client_secret: this.cfg.clientSecret,
            refresh_token: this.cfg.refreshToken,
            grant_type: 'refresh_token',
          }).toString(),
        });
        if (!res.ok) {
          // Never log the token or secrets; Google's error code is enough to act on.
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(`Google Drive sign-in failed (${res.status} ${body.error ?? ''}). Check the GOOGLE_OAUTH_* settings`);
        }
        const json = (await res.json()) as { access_token: string; expires_in?: number };
        this.token = { value: json.access_token, expiresAt: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000 };
        return json.access_token;
      })().finally(() => {
        this.tokenPending = null;
      });
    }
    return this.tokenPending;
  }

  /** Authorised request with retries on rate limits / server errors and one re-sign-in on 401. */
  private async request(url: string, init: RequestInit = {}, attempt = 1): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${await this.accessToken()}`);
    const res = await this.fetchFn(url, { ...init, headers });
    if (res.status === 401 && attempt === 1) {
      this.token = null;
      return this.request(url, init, attempt + 1);
    }
    // Drive reports some rate limits as 403 (reason rateLimitExceeded / userRateLimitExceeded).
    const rateLimited403 =
      res.status === 403 &&
      (await res
        .clone()
        .json()
        .then((b: { error?: { errors?: { reason?: string }[] } }) => /rateLimitExceeded/i.test(b.error?.errors?.[0]?.reason ?? ''))
        .catch(() => false));
    if ((RETRYABLE.has(res.status) || rateLimited403) && attempt < 4) {
      await sleep(this.retryDelayMs * 2 ** (attempt - 1));
      return this.request(url, init, attempt + 1);
    }
    return res;
  }

  private async fail(res: Response, what: string): Promise<never> {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`Google Drive ${what} failed (${res.status}${body.error?.message ? `: ${body.error.message}` : ''})`);
  }

  /** Id of the sub-folder for a kind of file, found or created once per process. */
  private folderFor(bucket: string): Promise<string> {
    const name = bucket.replace(/[^a-zA-Z0-9_-]/g, '') || 'files';
    let pending = this.folders.get(name);
    if (!pending) {
      pending = (async () => {
        const q = `name = '${name}' and '${this.cfg.rootFolderId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`;
        const found = await this.request(
          `${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1&includeItemsFromAllDrives=true&${ALL_DRIVES}`,
        );
        if (!found.ok) await this.fail(found, 'folder lookup');
        const files = ((await found.json()) as { files?: { id: string }[] }).files ?? [];
        if (files[0]) return files[0].id;
        const created = await this.request(`${API}/files?fields=id&${ALL_DRIVES}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [this.cfg.rootFolderId] }),
        });
        if (!created.ok) await this.fail(created, 'folder create');
        return ((await created.json()) as { id: string }).id;
      })();
      // A failed lookup is not cached, so the next upload tries again.
      pending.catch(() => this.folders.delete(name));
      this.folders.set(name, pending);
    }
    return pending;
  }

  async upload(file: Buffer, fileName: string, mimeType: string, bucket: string): Promise<UploadResult> {
    const uniqueName = `${Date.now()}-${fileName.replace(/[\\/]/g, '_')}`;
    const parent = await this.folderFor(bucket);
    const type = mimeType || 'application/octet-stream';
    const meta = JSON.stringify({ name: uniqueName, parents: [parent], mimeType: type });
    // Drive's one-request (multipart) upload is meant for files up to 5 MB; larger files
    // (ERP uploads go up to 100 MB: PDFs, gate-pass videos) use a resumable upload session.
    const id = file.length <= MULTIPART_MAX_BYTES ? await this.uploadMultipart(file, meta, type) : await this.uploadResumable(file, meta, type);
    return { filePath: `${GDRIVE_PREFIX}${id}`, fileName: uniqueName, mimeType, size: file.length };
  }

  private async uploadMultipart(file: Buffer, meta: string, type: string): Promise<string> {
    const boundary = `erp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Type: ${type}\r\n\r\n`),
      file,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const res = await this.request(`${UPLOAD}/files?uploadType=multipart&fields=id&${ALL_DRIVES}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!res.ok) await this.fail(res, 'upload');
    return ((await res.json()) as { id: string }).id;
  }

  /** Starts an upload session, then sends the whole file in one PUT (retried with the session). */
  private async uploadResumable(file: Buffer, meta: string, type: string): Promise<string> {
    const start = await this.request(`${UPLOAD}/files?uploadType=resumable&fields=id&${ALL_DRIVES}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': type,
        'X-Upload-Content-Length': String(file.length),
      },
      body: meta,
    });
    if (!start.ok) await this.fail(start, 'upload start');
    const session = start.headers.get('Location');
    if (!session) throw new Error('Google Drive upload start failed (no upload session)');
    const res = await this.request(session, {
      method: 'PUT',
      headers: { 'Content-Type': type },
      body: new Uint8Array(file),
    });
    if (!res.ok) await this.fail(res, 'upload');
    return ((await res.json()) as { id: string }).id;
  }

  private fileId(filePath: string): string {
    if (!isDrivePath(filePath)) throw new Error('Not a Google Drive file');
    const id = filePath.slice(GDRIVE_PREFIX.length);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Bad Google Drive file id');
    return id;
  }

  async getFile(filePath: string): Promise<Buffer> {
    const res = await this.request(`${API}/files/${this.fileId(filePath)}?alt=media&${ALL_DRIVES}`);
    if (!res.ok) await this.fail(res, 'download');
    return Buffer.from(await res.arrayBuffer());
  }

  /** Moves the file to Drive's trash (recoverable for 30 days) rather than deleting it outright. */
  async deleteFile(filePath: string): Promise<void> {
    const res = await this.request(`${API}/files/${this.fileId(filePath)}?${ALL_DRIVES}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
    if (!res.ok && res.status !== 404) await this.fail(res, 'delete');
  }

  /** Drive files are never shared by link; the ERP streams them (see serveFile). */
  async getSignedUrl(filePath: string): Promise<string> {
    return filePath;
  }
}

/** Reads the Drive settings; null when any is missing. */
export function driveConfigFromEnv(env: {
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_REFRESH_TOKEN?: string;
  GOOGLE_DRIVE_FILES_FOLDER_ID?: string;
}): DriveConfig | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = env.GOOGLE_OAUTH_REFRESH_TOKEN;
  const rootFolderId = env.GOOGLE_DRIVE_FILES_FOLDER_ID;
  if (!clientId || !clientSecret || !refreshToken || !rootFolderId) return null;
  return { clientId, clientSecret, refreshToken, rootFolderId };
}

/**
 * Routes each call by the stored path: "gdrive:..." files to Drive, everything else to
 * the earlier store (Supabase or the local folder). New uploads go to `uploadTo`.
 */
export class RoutingStorageService implements StorageService {
  constructor(
    private readonly drive: StorageService,
    private readonly legacy: StorageService,
    private readonly uploadTo: StorageService,
  ) {}

  upload(file: Buffer, fileName: string, mimeType: string, bucket: string) {
    return this.uploadTo.upload(file, fileName, mimeType, bucket);
  }
  getFile(filePath: string) {
    return (isDrivePath(filePath) ? this.drive : this.legacy).getFile(filePath);
  }
  deleteFile(filePath: string) {
    return (isDrivePath(filePath) ? this.drive : this.legacy).deleteFile(filePath);
  }
  getSignedUrl(filePath: string, expiresIn?: number) {
    return (isDrivePath(filePath) ? this.drive : this.legacy).getSignedUrl(filePath, expiresIn);
  }
}
