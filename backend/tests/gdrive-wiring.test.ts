/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * STORAGE_MODE=gdrive end to end through the real storage setup (getStorageService +
 * serveFile), with Google faked at the fetch level and Supabase faked at the client:
 *  - a new upload goes to Drive and is stored as "gdrive:<id>";
 *  - a big file (over 5 MB) uses a resumable upload session;
 *  - opening a Drive file streams it, with its type read from the bytes when unknown (logo);
 *  - a file saved earlier in Supabase still opens from Supabase (signed-URL redirect).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { calls, stored, supa } = vi.hoisted(() => ({
  calls: [] as { method: string; url: string; size?: number }[],
  stored: new Map<string, Buffer>(),
  supa: { signed: [] as string[], uploads: 0 },
}));

vi.mock('../src/config/env', () => ({
  env: {
    STORAGE_MODE: 'gdrive',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_KEY: 'service-key',
    GOOGLE_OAUTH_CLIENT_ID: 'cid',
    GOOGLE_OAUTH_CLIENT_SECRET: 'csecret',
    GOOGLE_OAUTH_REFRESH_TOKEN: 'rtoken',
    GOOGLE_DRIVE_FILES_FOLDER_ID: 'ROOT',
  },
}));
// Upload guard (fingerprints / proof numbers) is tested elsewhere; pass straight through here.
vi.mock('../src/services/duplicate.service', () => ({ withUploadGuard: (s: unknown) => s }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      listBuckets: async () => ({ data: [{ name: 'documents' }] }),
      from: () => ({
        upload: async () => {
          supa.uploads += 1;
          return { error: null };
        },
        createSignedUrl: async (p: string) => {
          supa.signed.push(p);
          return { data: { signedUrl: `https://example.supabase.co/signed/${p}` }, error: null };
        },
      }),
    },
  }),
}));

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

vi.stubGlobal(
  'fetch',
  vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body as any;
    calls.push({ method, url, size: body?.length ?? body?.byteLength });
    if (url.startsWith('https://oauth2.googleapis.com/token')) return json(200, { access_token: 'tok', expires_in: 3600 });
    if (url.includes('/drive/v3/files?q=')) return json(200, { files: [{ id: 'F-docs' }] });
    if (url.includes('uploadType=multipart')) {
      stored.set('SMALL', Buffer.from(body));
      return json(200, { id: 'SMALL' });
    }
    if (url.includes('uploadType=resumable')) return json(200, {}, { Location: 'https://www.googleapis.com/upload/session/xyz' });
    if (url === 'https://www.googleapis.com/upload/session/xyz' && method === 'PUT') {
      stored.set('BIG', Buffer.from(body));
      return json(200, { id: 'BIG' });
    }
    if (url.includes('/files/LOGO?alt=media')) return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]), { status: 200 });
    return json(404, { error: { message: 'not found' } });
  }),
);

import { getStorageService, serveFile, sniffMimeType } from '../src/services/storage.service';

const fakeRes = () => {
  const res: any = { headers: {} as Record<string, string> };
  res.setHeader = (k: string, v: string) => (res.headers[k.toLowerCase()] = v);
  res.send = (b: Buffer) => (res.body = b);
  res.redirect = (u: string) => (res.redirectedTo = u);
  return res;
};

describe('STORAGE_MODE=gdrive wiring', () => {
  beforeEach(() => {
    calls.length = 0;
    supa.signed.length = 0;
  });

  it('new uploads go to Google Drive, not Supabase', async () => {
    const res = await getStorageService().upload(Buffer.from('%PDF-1.4 small'), 'bill.pdf', 'application/pdf', 'documents');
    expect(res.filePath).toBe('gdrive:SMALL');
    expect(supa.uploads).toBe(0);
    expect(calls.some((c) => c.url.includes('uploadType=multipart'))).toBe(true);
  });

  it('a file over 5 MB uses a resumable upload session and sends every byte', async () => {
    const big = Buffer.alloc(6 * 1024 * 1024, 7);
    const res = await getStorageService().upload(big, 'video.mp4', 'video/mp4', 'gate-pass-videos');
    expect(res).toMatchObject({ filePath: 'gdrive:BIG', size: big.length });
    expect(calls.some((c) => c.url.includes('uploadType=multipart'))).toBe(false);
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.size).toBe(big.length);
    expect(stored.get('BIG')!.equals(big)).toBe(true);
  });

  it('opening a Drive file streams it; an unknown type (logo) is read from the bytes', async () => {
    const res = fakeRes();
    await serveFile(res, 'gdrive:LOGO', null);
    expect(res.redirectedTo).toBeUndefined();
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.body.length).toBe(10);
  });

  it('a file saved earlier in Supabase still opens from Supabase', async () => {
    const res = fakeRes();
    await serveFile(res, 'documents/1700000000000-old-bill.pdf', 'application/pdf');
    expect(res.redirectedTo).toBe('https://example.supabase.co/signed/1700000000000-old-bill.pdf');
    expect(calls.some((c) => c.url.includes('googleapis'))).toBe(false);
  });

  it('recognises the common file types from their first bytes', () => {
    expect(sniffMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMimeType(Buffer.from('%PDF-1.7'))).toBe('application/pdf');
    expect(sniffMimeType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('image/svg+xml');
    expect(sniffMimeType(Buffer.from('hello'))).toBeNull();
  });
});
