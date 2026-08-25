/**
 * Storage Service Tests (Local Mode)
 * ===================================
 *
 * The storage service handles file uploads and downloads for:
 *  - Vendor attachments (GST certificates, PAN cards)
 *  - Site photos (before/during/after construction progress)
 *  - Gate-pass video clips (entry and exit recordings)
 *  - OCR document uploads (quotation and invoice scans)
 *
 * In production, files are stored in Supabase Storage (private buckets with signed URLs).
 * In development and testing, files are stored on the local filesystem under LOCAL_STORAGE_PATH.
 *
 * These tests exercise the local-mode implementation against a real temp directory so we
 * verify actual file I/O, not just that the functions don't throw.
 *
 * Properties verified:
 *  - Upload writes the exact bytes to disk and returns correct metadata
 *  - getFile reads back the exact bytes (round-trip integrity)
 *  - Filenames are unique (no overwrites even with the same original name)
 *  - deleteFile is idempotent (doesn't throw if the file is already gone)
 *  - serveFile streams the buffer with the correct Content-Type header
 */
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// vi.mock factories are hoisted above imports, so any variable they reference
// must also be hoisted via vi.hoisted to be available at mock-setup time.
// We use a unique temp directory per test process so tests don't pollute ./test-uploads.
const { tmpRoot } = vi.hoisted(() => ({
  tmpRoot: `${process.env.TMP || process.env.TEMP || '/tmp'}/hospital-erp-storage-test-${process.pid}-${Date.now()}`,
}));

// Mock env so LocalStorageService writes into our temp directory instead of ./uploads.
vi.mock('../src/config/env', () => ({
  env: {
    STORAGE_MODE: 'local',
    LOCAL_STORAGE_PATH: tmpRoot,
  },
}));

import { getStorageService, serveFile, StorageService } from '../src/services/storage.service';

let storage: StorageService;

describe('Storage Service (local mode) — file upload, download, and serving', () => {
  beforeAll(async () => {
    // Create the temp directory once for the whole test suite.
    await fs.mkdir(tmpRoot, { recursive: true });
    storage = getStorageService();
  });

  afterAll(async () => {
    // Clean up the temp directory after all tests have run.
    try {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore — best-effort cleanup
    }
  });

  it('upload writes the file to disk and returns metadata with the correct size and MIME type', async () => {
    // Every attachment endpoint depends on upload() returning a filePath that
    // gets stored in the DB. If the metadata is wrong, the file won't be
    // retrievable later.
    const buf = Buffer.from('hello-storage');
    const result = await storage.upload(buf, 'test.txt', 'text/plain', 'documents');

    expect(result.fileName).toMatch(/test\.txt$/);
    expect(result.mimeType).toBe('text/plain');
    expect(result.size).toBe(buf.length);
    expect(result.filePath).toContain('documents');

    // Verify the actual bytes landed on disk.
    const onDisk = await fs.readFile(result.filePath);
    expect(onDisk.equals(buf)).toBe(true);
  });

  it('getFile reads back the exact bytes that were uploaded (round-trip integrity)', async () => {
    // A photo uploaded today must come back byte-for-byte when viewed next month.
    // This test uses binary data (not text) to catch encoding issues.
    const buf = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const { filePath } = await storage.upload(buf, 'binary.bin', 'application/octet-stream', 'bins');

    const readBack = await storage.getFile(filePath);
    expect(readBack.equals(buf)).toBe(true);
  });

  it('upload generates a unique filename for each call (no silent overwrites)', async () => {
    // Two users uploading "report.pdf" in the same second must not overwrite
    // each other. The timestamp prefix ensures uniqueness.
    const buf = Buffer.from('a');
    const a = await storage.upload(buf, 'dup.txt', 'text/plain', 'docs');
    const b = await storage.upload(buf, 'dup.txt', 'text/plain', 'docs');

    expect(a.fileName).not.toBe(b.fileName);
    expect(a.filePath).not.toBe(b.filePath);
  });

  it('deleteFile removes the file from disk', async () => {
    // Used when an attachment is deleted or a gate pass is cancelled.
    const buf = Buffer.from('to-delete');
    const { filePath } = await storage.upload(buf, 'del.txt', 'text/plain', 'docs');

    await storage.deleteFile(filePath);
    // The file should no longer exist on disk.
    await expect(fs.readFile(filePath)).rejects.toThrow();
  });

  it('deleteFile does not throw when the file is already gone (idempotent deletion)', async () => {
    // The caller doesn't need to check existence before calling delete.
    // This matters because deleteFile is called in cleanup paths that may
    // run multiple times (e.g. gate pass cancelled, then periodic cleanup).
    await expect(
      storage.deleteFile(path.join(tmpRoot, 'never-existed.txt'))
    ).resolves.toBeUndefined();
  });

  it('getSignedUrl returns the file path directly in local mode (no signing needed)', async () => {
    // In Supabase mode, getSignedUrl creates a time-limited signed URL so the
    // browser can download from a private bucket. In local mode, there's no
    // signing — the API serves the file itself via serveFile(). This test
    // documents that contract: local mode returns the raw path.
    const buf = Buffer.from('signed');
    const { filePath } = await storage.upload(buf, 's.txt', 'text/plain', 'docs');
    const url = await storage.getSignedUrl(filePath);
    expect(url).toBe(filePath);
  });

  it('serveFile streams the file buffer with the stored Content-Type header', async () => {
    // When a user clicks "View attachment", serveFile() sends the bytes to the
    // browser with the correct Content-Type so the browser renders it inline
    // (e.g. an image shows as an image, a PDF opens in the viewer).
    const buf = Buffer.from('serve-me');
    const { filePath, mimeType } = await storage.upload(buf, 'serve.txt', 'text/plain', 'docs');

    const res = {
      setHeader: vi.fn(),
      send: vi.fn(),
      redirect: vi.fn(),
    } as unknown as Response;

    await serveFile(res, filePath, mimeType, storage);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain');
    expect(res.send).toHaveBeenCalledWith(buf);
    // In local mode, we never redirect — we stream the bytes directly.
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('serveFile falls back to application/octet-stream when the MIME type is null', async () => {
    // Older DB rows may have a null mimeType (from before we started recording
    // it). Those files should still download — the browser will treat them as
    // a generic binary download rather than trying to render them inline.
    const buf = Buffer.from('no-mime');
    const { filePath } = await storage.upload(buf, 'nm.bin', 'application/octet-stream', 'docs');

    const res = {
      setHeader: vi.fn(),
      send: vi.fn(),
      redirect: vi.fn(),
    } as unknown as Response;

    await serveFile(res, filePath, null, storage);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/octet-stream');
    expect(res.send).toHaveBeenCalledWith(buf);
  });
});
