/* eslint-disable @typescript-eslint/no-explicit-any -- loose Prisma/Express stand-ins */
/**
 * Google Drive storage additions, against an in-memory Google (fetch level):
 *  - uploads land in a sub-folder per ERP module (from the request), or per kind outside one;
 *  - the module survives multipart parsing (multer), and /attachments files by entity type;
 *  - Drive files are trashed only once no record uses them (deletes, replacements, shared files);
 *  - end to end through /api/attachments: upload image/PDF, open it, other project refused,
 *    record holds only the Drive id + metadata, delete → trashed, Drive outage → no record.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import multer from 'multer';
import supertest from 'supertest';
import { FakeGoogleDrive } from './helpers/fake-google-drive';

const PROJECT_A = '11111111-1111-4111-8111-111111111111';
const PROJECT_B = '22222222-2222-4222-8222-222222222222';

const { db, google } = vi.hoisted(() => ({
  db: { attachments: [] as Array<Record<string, any>> },
  google: { current: null as unknown as { fetch: (url: string, init?: any) => Promise<Response> } },
}));

vi.mock('../src/config/env', () => ({
  env: {
    NODE_ENV: 'test',
    STORAGE_MODE: 'gdrive',
    LOCAL_STORAGE_PATH: './test-uploads-gdrive',
    GOOGLE_OAUTH_CLIENT_ID: 'cid',
    GOOGLE_OAUTH_CLIENT_SECRET: 'csecret',
    GOOGLE_OAUTH_REFRESH_TOKEN: 'rtoken',
    GOOGLE_DRIVE_FILES_FOLDER_ID: 'ROOT',
  },
}));

vi.mock('../src/config/prisma', () => {
  const matches = (row: Record<string, any>, where: Record<string, any>) => Object.entries(where).every(([k, v]) => row[k] === v);
  const attachment = {
    create: vi.fn(async ({ data }: any) => {
      const row = { id: `att-${db.attachments.length + 1}-${Math.random().toString(36).slice(2, 6)}`, createdAt: new Date(), ...data };
      db.attachments.push(row);
      return row;
    }),
    findFirst: vi.fn(async ({ where }: any) => db.attachments.find((r) => matches(r, where)) ?? null),
    delete: vi.fn(async ({ where }: any) => db.attachments.splice(db.attachments.findIndex((r) => r.id === where.id), 1)[0]),
    count: vi.fn(async ({ where }: any) => db.attachments.filter((r) => matches(r, where)).length),
  };
  return { prisma: { attachment } };
});

vi.mock('../src/middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', role: 'ADMIN', projectId: req.headers['x-test-project'] ?? PROJECT_A };
    next();
  },
  requireProjectId: (req: any) => req.user.projectId,
}));
vi.mock('../src/services/audit.service', () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock('../src/services/linked-files.service', () => ({ listLinkedFiles: vi.fn(async () => []) }));

import { GoogleDriveStorageService } from '../src/services/gdrive-storage.service';
import { SafeDeleteStorageService } from '../src/services/storage/safe-delete';
import { storageModuleContext, currentStorageModule, withStorageModule, moduleFromPath, moduleFromEntityType } from '../src/services/storage/drive-context';
import { getSafeDeleteService } from '../src/services/storage.service';
import attachmentRoutes from '../src/routes/attachment.routes';
import type { StorageService } from '../src/services/storage.service';

const cfg = { clientId: 'cid', clientSecret: 'secret', refreshToken: 'refresh', rootFolderId: 'ROOT' };
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001', 'hex');
const PDF = Buffer.from('%PDF-1.4\n%test\n%%EOF');

let fake: FakeGoogleDrive;
beforeEach(() => {
  fake = new FakeGoogleDrive('ROOT');
  google.current = fake;
  vi.stubGlobal('fetch', (url: string, init?: any) => google.current.fetch(url, init));
  db.attachments.length = 0;
});

const driveWith = (g: FakeGoogleDrive) => new GoogleDriveStorageService(cfg, g.fetch as never, 0);

describe('module folders', () => {
  it('maps API paths and attachment entity types to folder names', () => {
    expect(moduleFromPath('/api/quotations/1/file')).toBe('Quotations');
    expect(moduleFromPath('/api/vouchers/1')).toBe('Payment Vouchers');
    expect(moduleFromPath('/api/material-purchase-requests/1/receipt')).toBe('Material Requests');
    expect(moduleFromPath('/api/something-new')).toBe('Something New');
    expect(moduleFromEntityType('PURCHASE_ORDER')).toBe('Purchase Orders');
    expect(moduleFromEntityType('STAFF')).toBe('Employee Documents');
  });

  it('an upload inside a request goes to that module’s folder; outside a request, to the kind of file', async () => {
    const drive = driveWith(fake);
    const inModule = await withStorageModule('Site Photos', () => drive.upload(PNG, 'site.png', 'image/png', 'photos'));
    const outside = await drive.upload(PDF, 'x.pdf', 'application/pdf', 'documents');
    const fileA = fake.files.get(inModule.filePath.slice(7))!;
    const fileB = fake.files.get(outside.filePath.slice(7))!;
    expect(fileA.parents).toEqual([fake.folderNamed('Site Photos')!.id]);
    expect(fake.folderNamed('Site Photos')!.parents).toEqual(['ROOT']);
    expect(fileB.parents).toEqual([fake.folderNamed('documents')!.id]);
    // private tags for the migration / orphan check, never a sharing permission
    expect(fileA.appProperties).toMatchObject({ erp: '1' });
    expect(fileA.appProperties.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fake.calls.some((c) => c.url.includes('/permissions'))).toBe(false);
  });

  it('each module folder is created once', async () => {
    const drive = driveWith(fake);
    await withStorageModule('Quotations', () => Promise.all([1, 2, 3].map((n) => drive.upload(PDF, `${n}.pdf`, 'application/pdf', 'documents'))));
    expect([...fake.files.values()].filter((f) => f.name === 'Quotations')).toHaveLength(1);
  });

  it('the module survives multipart parsing (multer)', async () => {
    const mini = express();
    mini.use('/api', storageModuleContext);
    mini.post('/api/quotations/:id/file', multer({ storage: multer.memoryStorage() }).single('file'), (_req, res) => {
      res.json({ module: currentStorageModule('lost') });
    });
    const res = await supertest(mini).post('/api/quotations/q1/file').attach('file', PDF, { filename: 'q.pdf', contentType: 'application/pdf' });
    expect(res.body.module).toBe('Quotations');
  });

  it('lookups used by the migration: metadata with MD5, app-property search, ERP file list, trash by id', async () => {
    const drive = driveWith(fake);
    const id = await drive.uploadInto('Documents', PDF, 'a.pdf', 'application/pdf', { legacy: 'abc123' });
    const meta = await drive.getMetadata(id);
    expect(meta).toMatchObject({ id, name: 'a.pdf', size: PDF.length, trashed: false });
    expect(meta!.md5Checksum).toBe(fake.meta(fake.files.get(id)!).md5Checksum);
    expect((await drive.findByAppProperty('legacy', 'abc123')).map((f) => f.id)).toEqual([id]);
    expect((await drive.listErpFiles()).map((f) => f.id)).toEqual([id]);
    expect(await drive.getMetadata('NOPE')).toBeNull();
    await drive.trashById(id);
    expect(fake.files.get(id)!.trashed).toBe(true);
    await expect(drive.trashById('bad id!')).rejects.toThrow(/Bad Google Drive file id/);
  });
});

describe('safe deletes', () => {
  function setup() {
    const refs = new Map<string, number>();
    const legacy: StorageService & { deleted: string[] } = {
      deleted: [],
      upload: vi.fn(),
      getFile: vi.fn(),
      getSignedUrl: vi.fn(),
      async deleteFile(p: string) {
        legacy.deleted.push(p);
      },
    } as any;
    const drive = driveWith(fake);
    const routing = {
      upload: drive.upload.bind(drive),
      getFile: drive.getFile.bind(drive),
      getSignedUrl: drive.getSignedUrl.bind(drive),
      deleteFile: (p: string) => (p.startsWith('gdrive:') ? drive.deleteFile(p) : legacy.deleteFile(p)),
    };
    const safe = new SafeDeleteStorageService(routing, { delayMs: 60_000, countReferences: async (p) => refs.get(p) ?? 0, log: () => {} });
    return { safe, refs, legacy };
  }

  it('a released Drive file is trashed only after the wait, and only when no record uses it', async () => {
    const { safe, refs } = setup();
    const a = await safe.upload(PNG, 'a.png', 'image/png', 'photos');
    const b = await safe.upload(PDF, 'b.pdf', 'application/pdf', 'documents');
    refs.set(b.filePath, 1); // still linked elsewhere, or the delete was rolled back
    await safe.deleteFile(a.filePath);
    await safe.deleteFile(b.filePath);
    expect(fake.files.get(a.filePath.slice(7))!.trashed).toBe(false); // not yet
    await safe.flushPendingDeletes();
    expect(fake.files.get(a.filePath.slice(7))!.trashed).toBe(true);
    expect(fake.files.get(b.filePath.slice(7))!.trashed).toBe(false);
  });

  it('replacing a file: the new one stays, the old one is trashed once unreferenced', async () => {
    const { safe } = setup();
    const v1 = await safe.upload(PDF, 'v1.pdf', 'application/pdf', 'documents');
    await safe.deleteFile(v1.filePath);
    const v2 = await safe.upload(Buffer.from('%PDF-1.4 v2'), 'v2.pdf', 'application/pdf', 'documents');
    await safe.flushPendingDeletes();
    expect(fake.files.get(v1.filePath.slice(7))!.trashed).toBe(true);
    expect(fake.files.get(v2.filePath.slice(7))!.trashed).toBe(false);
  });

  it('files in the earlier store are deleted at once, exactly as before', async () => {
    const { safe, legacy } = setup();
    await safe.deleteFile('documents/1700-old.pdf');
    expect(legacy.deleted).toEqual(['documents/1700-old.pdf']);
  });

  it('a Drive error during the delayed trash is logged, never thrown into a request', async () => {
    const { safe } = setup();
    const a = await safe.upload(PNG, 'a.png', 'image/png', 'photos');
    fake.failNext.push({ match: (m) => m === 'PATCH', status: 400 });
    await safe.deleteFile(a.filePath);
    await expect(safe.flushPendingDeletes()).resolves.toBeUndefined();
  });
});

describe('/api/attachments with STORAGE_MODE=gdrive', () => {
  const app = express();
  app.use(express.json());
  app.use('/api', storageModuleContext);
  app.use('/api/attachments', attachmentRoutes);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status ?? 500).json({ error: err.message }));
  const request = supertest(app);
  const upload = (buf: Buffer, name: string, type: string, entityType = 'PURCHASE_ORDER') =>
    request.post('/api/attachments/upload').field('entityType', entityType).field('entityId', 'po-1').attach('file', buf, { filename: name, contentType: type });
  const binary = (r: any, cb: any) => {
    const chunks: Buffer[] = [];
    r.on('data', (c: Buffer) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  };

  it('upload an image: stored in Drive under the record’s module; the record holds the id and metadata only', async () => {
    const res = await upload(PNG, 'site.png', 'image/png');
    expect(res.status).toBe(201);
    const row = db.attachments[0];
    expect(row.filePath).toMatch(/^gdrive:/);
    expect(row).toMatchObject({ fileName: 'site.png', mimeType: 'image/png', entityType: 'PURCHASE_ORDER', entityId: 'po-1', projectId: PROJECT_A });
    expect(Object.values(row).some((v) => Buffer.isBuffer(v))).toBe(false);
    const file = fake.files.get(row.filePath.slice(7))!;
    expect(file.data.equals(PNG)).toBe(true);
    expect(file.parents).toEqual([fake.folderNamed('Purchase Orders')!.id]);
  });

  it('upload a PDF, then open and download it through the ERP', async () => {
    const up = await upload(PDF, 'bill.pdf', 'application/pdf', 'VOUCHER');
    expect(up.status).toBe(201);
    expect(fake.folderNamed('Payment Vouchers')).toBeTruthy();
    const res = await request.get(`/api/attachments/${up.body.id}/file`).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect((res.body as Buffer).equals(PDF)).toBe(true);
  });

  it('preview an image through the ERP', async () => {
    const up = await upload(PNG, 'p.png', 'image/png');
    const res = await request.get(`/api/attachments/${up.body.id}/file`).buffer(true).parse(binary);
    expect(res.headers['content-type']).toBe('image/png');
    expect((res.body as Buffer).equals(PNG)).toBe(true);
  });

  it('a user of another project cannot open the file', async () => {
    const up = await upload(PNG, 'p.png', 'image/png');
    const res = await request.get(`/api/attachments/${up.body.id}/file`).set('x-test-project', PROJECT_B);
    expect(res.status).toBe(404);
  });

  it('disallowed file types are refused before anything is stored', async () => {
    const res = await upload(Buffer.from('MZ'), 'evil.exe', 'application/octet-stream');
    expect(res.status).toBe(400);
    expect(fake.stored).toHaveLength(0);
  });

  it('a Drive outage fails the upload cleanly: no record is created', async () => {
    for (let i = 0; i < 4; i++) fake.failNext.push({ match: (_m, u) => u.includes('/upload/drive/v3/files'), status: 503 });
    const res = await upload(PNG, 'x.png', 'image/png');
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(db.attachments).toHaveLength(0);
  }, 20_000);

  it('delete: the record goes, and its Drive file is trashed once nothing uses it', async () => {
    const up = await upload(PDF, 'gone.pdf', 'application/pdf');
    const id = db.attachments[0].filePath.slice(7);
    expect((await request.delete(`/api/attachments/${up.body.id}`)).status).toBeLessThan(300);
    await getSafeDeleteService()!.flushPendingDeletes();
    expect(fake.files.get(id)!.trashed).toBe(true);
  });

  it('delete keeps a Drive file another record still links to', async () => {
    const up = await upload(PDF, 'shared.pdf', 'application/pdf');
    const shared = db.attachments[0];
    db.attachments.push({ ...shared, id: 'att-copy', entityId: 'po-2' });
    await request.delete(`/api/attachments/${up.body.id}`);
    await getSafeDeleteService()!.flushPendingDeletes();
    expect(fake.files.get(shared.filePath.slice(7))!.trashed).toBe(false);
  });
});
