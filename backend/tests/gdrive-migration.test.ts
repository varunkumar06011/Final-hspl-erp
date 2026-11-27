/* eslint-disable @typescript-eslint/no-explicit-any -- loose Prisma/Express stand-ins */
/**
 * Migration of existing images/PDFs to Google Drive (drive-migration.ts) against
 * an in-memory database and Drive: verified copies, every reference repointed,
 * other file types left alone, resumable after interruption (no duplicates),
 * originals kept until an explicit, re-verified cleanup, plus verify / orphans.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FakeGoogleDrive } from './helpers/fake-google-drive';
import { GoogleDriveStorageService } from '../src/services/gdrive-storage.service';
import {
  migrateFiles,
  loadState,
  verifyDriveReferences,
  findOrphans,
  cleanupLegacy,
} from '../src/services/storage/drive-migration';
import type { StorageService } from '../src/services/storage.service';

// ── tiny in-memory Prisma: just the filters the migration uses ──────────────
type Row = Record<string, any>;
function cond(row: Row, where: Record<string, any>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'AND') return (v as any[]).every((w) => cond(row, w));
    if (k === 'NOT') return !cond(row, v);
    if (v && typeof v === 'object') {
      if ('not' in v) return row[k] !== v.not;
      if ('startsWith' in v) return typeof row[k] === 'string' && row[k].startsWith(v.startsWith);
      if ('gt' in v) return row[k] > v.gt;
    }
    return row[k] === v;
  });
}
function table(rows: Row[]) {
  return {
    rows,
    async findMany({ where, select, take }: any) {
      return rows
        .filter((r) => cond(r, where))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, take)
        .map((r) => Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])));
    },
    async updateMany({ where, data }: any) {
      const hit = rows.filter((r) => cond(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
    async count({ where }: any) {
      return rows.filter((r) => cond(r, where)).length;
    },
  };
}

const PNG = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const PDF = Buffer.from('%PDF-1.4 invoice');
const PDF2 = Buffer.from('%PDF-1.4 quotation');
const XLSX = Buffer.from('PK excel');

function setup() {
  const legacyFiles = new Map<string, Buffer>([
    ['attachments/images/1700-a.png', PNG],
    ['documents/1700-inv.pdf', PDF],
    ['documents/1700-q.pdf', PDF2],
    ['documents/1700-sheet.xlsx', XLSX],
    ['photos/1700-site', PNG], // no extension: type comes from the table default
  ]);
  const db: any = {
    attachment: table([
      { id: 'a1', filePath: 'attachments/images/1700-a.png', mimeType: 'image/png', fileName: 'a.png' },
      { id: 'a2', filePath: 'documents/1700-sheet.xlsx', mimeType: 'application/vnd.ms-excel', fileName: 'sheet.xlsx' },
      // the same invoice PDF linked to a second record
      { id: 'a3', filePath: 'documents/1700-inv.pdf', mimeType: 'application/pdf', fileName: 'inv.pdf' },
    ]),
    vendorInvoice: table([{ id: 'v1', filePath: 'documents/1700-inv.pdf', fileMimeType: 'application/pdf', fileName: 'inv.pdf' }]),
    quotation: table([
      { id: 'q1', filePath: 'documents/1700-q.pdf', fileMimeType: 'application/pdf', fileName: 'q.pdf' },
      { id: 'q2', filePath: null, fileMimeType: null, fileName: null },
    ]),
    sitePhoto: table([{ id: 's1', imageUrl: 'photos/1700-site' }]),
    fileFingerprint: table([{ id: 'f1', filePath: 'documents/1700-inv.pdf', mimeType: 'application/pdf', fileName: 'inv.pdf' }]),
    async $transaction(fn: any) {
      return fn(db);
    },
  };
  const deleted: string[] = [];
  const legacy: StorageService = {
    upload: vi.fn(),
    async getFile(p) {
      const b = legacyFiles.get(p);
      if (!b) throw new Error(`missing ${p}`);
      return b;
    },
    async deleteFile(p) {
      deleted.push(p);
      legacyFiles.delete(p);
    },
    async getSignedUrl(p) {
      return p;
    },
  };
  const fake = new FakeGoogleDrive('ROOT');
  const cfg = { clientId: 'cid', clientSecret: 'secret', refreshToken: 'refresh', rootFolderId: 'ROOT' };
  const drive = new GoogleDriveStorageService(cfg, ((u: string, i?: any) => fake.fetch(u, i)) as never, 0);
  const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'drive-mig-')), 'state.json');
  return { db, legacy, legacyFiles, deleted, fake, drive, statePath, deps: { db, legacy, drive, statePath, log: () => {} } };
}

describe('migrateFiles', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });

  it('dry run changes nothing', async () => {
    const stats = await migrateFiles(s.deps, { dryRun: true });
    expect(stats.scanned).toBe(5);
    expect(s.fake.stored).toHaveLength(0);
    expect(s.db.attachment.rows[0].filePath).toBe('attachments/images/1700-a.png');
  });

  it('copies images and PDFs to module folders, verifies them, and repoints every record', async () => {
    const stats = await migrateFiles(s.deps);
    expect(stats).toMatchObject({ migrated: 4, failed: 0, skippedType: 1 });
    expect(s.fake.stored).toHaveLength(4);

    // the shared invoice PDF: one Drive copy, all three references (incl. fingerprint) repointed
    const invPath = s.db.vendorInvoice.rows[0].filePath;
    expect(invPath).toMatch(/^gdrive:/);
    expect(s.db.attachment.rows.find((r: Row) => r.id === 'a3').filePath).toBe(invPath);
    expect(s.db.fileFingerprint.rows[0].filePath).toBe(invPath);
    expect(s.fake.files.get(invPath.slice(7))!.data.equals(PDF)).toBe(true);

    // other metadata untouched
    expect(s.db.vendorInvoice.rows[0]).toMatchObject({ fileName: 'inv.pdf', fileMimeType: 'application/pdf' });
    // folders per module
    const quotationFile = s.fake.files.get(s.db.quotation.rows[0].filePath.slice(7))!;
    expect(quotationFile.parents).toEqual([s.fake.folderNamed('Quotations')!.id]);
    expect(quotationFile.name).toBe('q.pdf');
    expect(s.fake.files.get(s.db.sitePhoto.rows[0].imageUrl.slice(7))!.parents).toEqual([s.fake.folderNamed('Site Photos')!.id]);

    // other file types and empty columns stay as they were
    expect(s.db.attachment.rows.find((r: Row) => r.id === 'a2').filePath).toBe('documents/1700-sheet.xlsx');
    expect(s.db.quotation.rows[1].filePath).toBeNull();
    // originals are kept
    expect(s.legacyFiles.size).toBe(5);
    expect(s.deleted).toHaveLength(0);
  });

  it('is safe to re-run: nothing is copied twice', async () => {
    await migrateFiles(s.deps);
    const again = await migrateFiles(s.deps);
    expect(again).toMatchObject({ migrated: 0, failed: 0 });
    expect(s.fake.stored).toHaveLength(4);
  });

  it('resumes after an interruption, without duplicates, even if the state file was lost', async () => {
    // Drive accepts the copy of the first file, but the reply is lost and the retries run out.
    const isUpload = (_m: string, u: string) => u.includes('uploadType=multipart');
    s.fake.failNext.push(
      { match: isUpload, status: 503, afterEffect: true },
      { match: isUpload, status: 503 },
      { match: isUpload, status: 503 },
      { match: isUpload, status: 503 },
    );
    const first = await migrateFiles(s.deps, { limit: 1 });
    expect(first.failed).toBe(1);
    expect(s.db.attachment.rows[0].filePath).toBe('attachments/images/1700-a.png'); // record untouched
    expect(Object.keys(loadState(s.statePath).failures)).toHaveLength(1);

    fs.rmSync(s.statePath); // lost progress file
    const second = await migrateFiles(s.deps);
    expect(second.failed).toBe(0);
    expect(second.reused).toBe(1); // found by its old-path tag instead of uploading again
    expect(s.fake.stored).toHaveLength(4);
    expect(s.db.attachment.rows[0].filePath).toMatch(/^gdrive:/);
  });

  it('a missing original is reported and its records are left untouched', async () => {
    s.legacyFiles.delete('documents/1700-q.pdf');
    const stats = await migrateFiles(s.deps);
    expect(stats.failed).toBe(1);
    expect(s.db.quotation.rows[0].filePath).toBe('documents/1700-q.pdf');
    expect(loadState(s.statePath).failures['documents/1700-q.pdf'].error).toMatch(/missing/);
  });

  it('a copy that fails verification is never used', async () => {
    // Corrupt the bytes Drive stores for the next multipart upload.
    const orig = s.fake.fetch;
    let corrupted = false;
    s.fake.fetch = async (url: string, init?: any) => {
      const out = await orig(url, init);
      if (!corrupted && url.includes('uploadType=multipart')) {
        corrupted = true;
        const { id } = await out.clone().json();
        s.fake.files.get(id)!.data = Buffer.from('garbage');
      }
      return out;
    };
    const stats = await migrateFiles(s.deps, { tables: ['attachment'] });
    expect(stats.failed).toBe(1);
    expect(s.db.attachment.rows[0].filePath).toBe('attachments/images/1700-a.png');
  });
});

describe('verify, orphans and cleanup', () => {
  it('verify reports Drive files the database uses that are gone', async () => {
    const s = setup();
    await migrateFiles(s.deps);
    expect((await verifyDriveReferences(s.deps, { download: true })).missing).toHaveLength(0);
    const id = s.db.quotation.rows[0].filePath.slice(7);
    s.fake.files.get(id)!.trashed = true;
    const r = await verifyDriveReferences(s.deps);
    expect(r.missing).toEqual([id]);
  });

  it('finds Drive files no record uses', async () => {
    const s = setup();
    await migrateFiles(s.deps);
    const strayId = await s.drive.uploadInto('Other', PNG, 'stray.png', 'image/png');
    s.fake.files.get(strayId)!.createdTime = new Date(Date.now() - 48 * 3600_000).toISOString();
    const orphans = await findOrphans(s.deps);
    expect(orphans.map((o) => o.id)).toEqual([strayId]);
  });

  it('deletes originals only after re-verifying the Drive copy, and only when unused', async () => {
    const s = setup();
    await migrateFiles(s.deps);
    // Something still points at an original (e.g. restored from a backup) → kept.
    s.db.attachment.rows.push({ id: 'a9', filePath: 'documents/1700-q.pdf', mimeType: 'application/pdf', fileName: 'q.pdf' });
    // A Drive copy went missing → its original is kept.
    const pngId = s.db.attachment.rows[0].filePath.slice(7);
    s.fake.files.get(pngId)!.trashed = true;

    const dry = await cleanupLegacy(s.deps, { dryRun: true });
    expect(dry.deleted).toBe(0);
    expect(s.deleted).toHaveLength(0);

    const r = await cleanupLegacy(s.deps);
    expect(s.deleted.sort()).toEqual(['documents/1700-inv.pdf', 'photos/1700-site']);
    expect(r).toMatchObject({ deleted: 2, kept: 2 });
    expect(s.legacyFiles.has('documents/1700-sheet.xlsx')).toBe(true); // never migrated, never touched
  });

  it('--all-types also moves other file types', async () => {
    const s = setup();
    const stats = await migrateFiles(s.deps, { allTypes: true });
    expect(stats).toMatchObject({ migrated: 5, skippedType: 0, failed: 0 });
    expect(s.db.attachment.rows.find((r: Row) => r.id === 'a2').filePath).toMatch(/^gdrive:/);
  });
});
