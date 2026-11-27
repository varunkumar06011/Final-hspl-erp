/**
 * Google Drive file storage, against a fake Google (no network): sign-in with the refresh
 * token, sub-folder per kind of file, private upload stored as "gdrive:<id>", download,
 * trash instead of delete, retries, and routing between Drive and the earlier store.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  GoogleDriveStorageService,
  RoutingStorageService,
  driveConfigFromEnv,
  isDrivePath,
} from '../src/services/gdrive-storage.service';
import type { StorageService } from '../src/services/storage.service';

const cfg = { clientId: 'cid', clientSecret: 'secret', refreshToken: 'refresh', rootFolderId: 'ROOT' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A tiny fake of the Google endpoints the service uses. */
function fakeGoogle(opts: { folderExists?: boolean; failUploadsFirst?: number } = {}) {
  const calls: { method: string; url: string; auth: string | null; body?: string }[] = [];
  const files = new Map<string, Buffer>();
  let tokenCount = 0;
  let uploadFailures = opts.failUploadsFirst ?? 0;
  const fetchFn = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const auth = new Headers(init.headers).get('Authorization');
    const raw = init.body instanceof Buffer ? init.body.toString('latin1') : typeof init.body === 'string' ? init.body : undefined;
    calls.push({ method, url, auth, body: raw });
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      tokenCount += 1;
      return json(200, { access_token: `tok-${tokenCount}`, expires_in: 3600 });
    }
    if (url.includes('/drive/v3/files?q=')) return json(200, { files: opts.folderExists ? [{ id: 'FOLDER-docs' }] : [] });
    if (url.includes('/drive/v3/files?fields=id') && method === 'POST') return json(200, { id: 'FOLDER-new' });
    if (url.includes('/upload/drive/v3/files')) {
      if (uploadFailures-- > 0) return json(503, { error: { message: 'backend error' } });
      files.set('FILE-1', Buffer.from('PDFDATA'));
      return json(200, { id: 'FILE-1', size: '7' });
    }
    if (url.includes('/files/FILE-1?alt=media')) return new Response(files.get('FILE-1') ?? Buffer.alloc(0), { status: 200 });
    if (url.includes('/files/MISSING?alt=media')) return json(404, { error: { message: 'File not found' } });
    if (url.includes('/files/FILE-1?') && method === 'PATCH') return json(200, { id: 'FILE-1', trashed: true });
    return json(404, {});
  });
  return { fetchFn, calls, files };
}

describe('Google Drive storage', () => {
  it('uploads privately into a sub-folder for the kind of file and stores gdrive:<id>', async () => {
    const g = fakeGoogle();
    const drive = new GoogleDriveStorageService(cfg, g.fetchFn as never, 0);
    const res = await drive.upload(Buffer.from('PDFDATA'), 'bill.pdf', 'application/pdf', 'documents');

    expect(res).toMatchObject({ filePath: 'gdrive:FILE-1', mimeType: 'application/pdf', size: 7 });
    expect(res.fileName).toMatch(/^\d+-bill\.pdf$/);
    // Signed in with the refresh token, then created the "documents" folder under the root.
    expect(g.calls[0].body).toContain('grant_type=refresh_token');
    const createFolder = g.calls.find((c) => c.method === 'POST' && c.url.includes('/drive/v3/files?fields=id'))!;
    expect(JSON.parse(createFolder.body!)).toEqual({ name: 'documents', mimeType: 'application/vnd.google-apps.folder', parents: ['ROOT'] });
    const upload = g.calls.find((c) => c.url.includes('/upload/drive/v3/files'))!;
    expect(upload.auth).toBe('Bearer tok-1');
    expect(upload.body).toContain('"parents":["FOLDER-new"]');
    // Nothing is shared or made public.
    expect(g.calls.some((c) => c.url.includes('/permissions'))).toBe(false);
  });

  it('reuses an existing folder and the cached sign-in for later uploads', async () => {
    const g = fakeGoogle({ folderExists: true });
    const drive = new GoogleDriveStorageService(cfg, g.fetchFn as never, 0);
    await drive.upload(Buffer.from('a'), 'a.jpg', 'image/jpeg', 'documents');
    await drive.upload(Buffer.from('b'), 'b.jpg', 'image/jpeg', 'documents');
    expect(g.calls.filter((c) => c.url.includes('oauth2.googleapis.com')).length).toBe(1);
    expect(g.calls.filter((c) => c.url.includes('/drive/v3/files?q=')).length).toBe(1);
    expect(g.calls.some((c) => c.method === 'POST' && c.url.includes('/drive/v3/files?fields=id'))).toBe(false);
  });

  it('retries when Google is busy, then succeeds', async () => {
    const g = fakeGoogle({ folderExists: true, failUploadsFirst: 2 });
    const drive = new GoogleDriveStorageService(cfg, g.fetchFn as never, 0);
    const res = await drive.upload(Buffer.from('a'), 'a.pdf', 'application/pdf', 'documents');
    expect(res.filePath).toBe('gdrive:FILE-1');
    expect(g.calls.filter((c) => c.url.includes('/upload/')).length).toBe(3);
  });

  it('downloads a file, and says clearly when it is missing', async () => {
    const g = fakeGoogle({ folderExists: true });
    const drive = new GoogleDriveStorageService(cfg, g.fetchFn as never, 0);
    await drive.upload(Buffer.from('PDFDATA'), 'bill.pdf', 'application/pdf', 'documents');
    expect((await drive.getFile('gdrive:FILE-1')).toString()).toBe('PDFDATA');
    await expect(drive.getFile('gdrive:MISSING')).rejects.toThrow(/download failed \(404: File not found\)/);
    await expect(drive.getFile('documents/old.pdf')).rejects.toThrow(/Not a Google Drive file/);
    await expect(drive.getFile('gdrive:../x')).rejects.toThrow(/Bad Google Drive file id/);
  });

  it('delete moves the file to Drive trash instead of erasing it', async () => {
    const g = fakeGoogle();
    const drive = new GoogleDriveStorageService(cfg, g.fetchFn as never, 0);
    await drive.deleteFile('gdrive:FILE-1');
    const call = g.calls.find((c) => c.method === 'PATCH')!;
    expect(JSON.parse(call.body!)).toEqual({ trashed: true });
  });

  it('a wrong refresh token gives a clear error without leaking secrets', async () => {
    const fetchFn = vi.fn(async () => json(400, { error: 'invalid_grant' }));
    const drive = new GoogleDriveStorageService(cfg, fetchFn as never, 0);
    const err = await drive.upload(Buffer.from('a'), 'a.pdf', 'application/pdf', 'documents').catch((e: Error) => e);
    expect(String(err)).toMatch(/Google Drive sign-in failed \(400 invalid_grant\)/);
    expect(String(err)).not.toContain('secret');
    expect(String(err)).not.toContain('refresh');
  });

  it('routes by stored path: Drive files to Drive, older files to the earlier store, uploads to the chosen one', async () => {
    const mk = (name: string): StorageService => ({
      upload: vi.fn(async () => ({ filePath: `${name}-path`, fileName: 'f', mimeType: 'x', size: 1 })),
      getFile: vi.fn(async () => Buffer.from(name)),
      deleteFile: vi.fn(async () => undefined),
      getSignedUrl: vi.fn(async () => `${name}-url`),
    });
    const drive = mk('drive');
    const legacy = mk('supabase');
    const routing = new RoutingStorageService(drive, legacy, drive);
    expect((await routing.getFile('gdrive:ABC')).toString()).toBe('drive');
    expect((await routing.getFile('documents/123-old.pdf')).toString()).toBe('supabase');
    expect(await routing.getSignedUrl('documents/123-old.pdf')).toBe('supabase-url');
    expect((await routing.upload(Buffer.from('a'), 'a', 'x', 'documents')).filePath).toBe('drive-path');
    await routing.deleteFile('documents/123-old.pdf');
    expect(legacy.deleteFile).toHaveBeenCalledWith('documents/123-old.pdf');
  });

  it('reads its settings only when all four are present', () => {
    expect(driveConfigFromEnv({})).toBeNull();
    expect(driveConfigFromEnv({ GOOGLE_OAUTH_CLIENT_ID: 'a', GOOGLE_OAUTH_CLIENT_SECRET: 'b', GOOGLE_OAUTH_REFRESH_TOKEN: 'c' })).toBeNull();
    expect(
      driveConfigFromEnv({ GOOGLE_OAUTH_CLIENT_ID: 'a', GOOGLE_OAUTH_CLIENT_SECRET: 'b', GOOGLE_OAUTH_REFRESH_TOKEN: 'c', GOOGLE_DRIVE_FILES_FOLDER_ID: 'd' }),
    ).toEqual({ clientId: 'a', clientSecret: 'b', refreshToken: 'c', rootFolderId: 'd' });
    expect(isDrivePath('gdrive:x')).toBe(true);
    expect(isDrivePath('documents/x')).toBe(false);
  });
});
