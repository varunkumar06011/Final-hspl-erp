/**
 * Moves existing images and PDFs from the current store (local disk / Supabase)
 * to Google Drive, and checks the result.
 *
 * Safe by construction:
 *  - Only the path column changes (`<old path>` → `gdrive:<id>`), in every table
 *    that uses that path, inside one transaction. Rows, relations, names, types,
 *    dates and owner records are untouched.
 *  - A copy is used only after Drive reports the same MD5 and size as the original.
 *  - Original files are never deleted here; `cleanupLegacy` does that later, only
 *    for files whose Drive copy is re-verified and that no record still points at.
 *  - Resumable: progress is kept in a state file, every Drive copy is tagged with
 *    a hash of its old path (found again even if the state file is lost), and rows
 *    already pointing at Drive are skipped. Re-running continues where it stopped.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { StorageService } from '../storage.service';
import { GDRIVE_PREFIX, isDrivePath, type DriveFileMeta } from '../gdrive-storage.service';
import {
  FILE_COLUMNS,
  type FileColumn,
  isDriveMime,
  mimeFromName,
  replaceFileReferences,
  countFileReferences,
} from './file-refs';

type DriveFile = DriveFileMeta;
const toDrivePath = (id: string) => `${GDRIVE_PREFIX}${id}`;
const driveIdOf = (p: string) => p.slice(GDRIVE_PREFIX.length);

/** The Drive operations the migration needs (GoogleDriveStorageService provides them). */
export interface MigrationDrive {
  uploadInto(folderName: string, file: Buffer, name: string, mimeType: string, appProperties?: Record<string, string>): Promise<string>;
  getMetadata(id: string): Promise<DriveFile | null>;
  findByAppProperty(key: string, value: string): Promise<DriveFile[]>;
  listErpFiles(): Promise<DriveFile[]>;
  getFile(filePath: string): Promise<Buffer>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export interface MigrationEntry {
  driveId: string;
  md5: string;
  size: number;
  module: string;
  migratedAt: string;
  legacyDeletedAt?: string;
}

export interface MigrationState {
  version: 1;
  files: Record<string, MigrationEntry>;
  failures: Record<string, { error: string; at: string }>;
}

export interface MigrationStats {
  scanned: number;
  migrated: number;
  reused: number;
  skippedType: number;
  failed: number;
  rowsUpdated: number;
}

export interface MigrationDeps {
  db: Db;
  legacy: StorageService;
  drive: MigrationDrive;
  statePath: string;
  log?: (line: string) => void;
}

const md5 = (b: Buffer) => crypto.createHash('md5').update(b).digest('hex');
/** Short, fixed-length tag for an old path (Drive app properties are limited in size). */
export const legacyTag = (p: string) => crypto.createHash('sha1').update(p).digest('hex');

export function loadState(statePath: string): MigrationState {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as MigrationState;
    if (parsed && parsed.version === 1) return { version: 1, files: parsed.files ?? {}, failures: parsed.failures ?? {} };
  } catch {
    /* first run */
  }
  return { version: 1, files: {}, failures: {} };
}

export function saveState(statePath: string, state: MigrationState): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tmp = `${statePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, statePath); // atomic: a crash never leaves half a state file
}

interface LegacyFile {
  path: string;
  mime: string | null;
  name: string | null;
  column: FileColumn;
}

/** Distinct old (non-Drive) paths per table, paged by id so big tables never load at once. */
export async function* legacyFiles(db: Db, only?: string[]): AsyncGenerator<LegacyFile> {
  const seen = new Set<string>();
  for (const column of FILE_COLUMNS) {
    if (column.bookkeeping) continue;
    if (only && only.length && !only.includes(column.model)) continue;
    const delegate = db[column.model];
    if (!delegate) continue;
    let cursor: string | undefined;
    for (;;) {
      const rows: Array<Record<string, unknown>> = await delegate.findMany({
        where: {
          AND: [
            { [column.column]: { not: null } },
            { NOT: { [column.column]: { startsWith: 'gdrive:' } } },
            ...(cursor ? [{ id: { gt: cursor } }] : []),
          ],
        },
        select: {
          id: true,
          [column.column]: true,
          ...(column.mimeColumn ? { [column.mimeColumn]: true } : {}),
          ...(column.nameColumn ? { [column.nameColumn]: true } : {}),
        },
        orderBy: { id: 'asc' },
        take: 200,
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        const p = row[column.column] as string | null;
        if (!p || isDrivePath(p) || seen.has(p)) continue;
        seen.add(p);
        yield {
          path: p,
          mime: column.mimeColumn ? ((row[column.mimeColumn] as string | null) ?? null) : null,
          name: column.nameColumn ? ((row[column.nameColumn] as string | null) ?? null) : null,
          column,
        };
      }
      cursor = rows[rows.length - 1].id as string;
    }
  }
}

function resolveMime(f: LegacyFile): string | null {
  return f.mime || mimeFromName(f.name) || mimeFromName(f.path) || f.column.defaultMime || null;
}

function displayName(f: LegacyFile): string {
  const fromPath = path.basename(f.path.replace(/\\/g, '/')).replace(/^\d{10,}-/, '');
  return f.name || fromPath || 'file';
}

/** A Drive copy is good when it exists, is not trashed and has the expected MD5 and size. */
function matches(file: DriveFile | null, expectMd5: string, expectSize: number): file is DriveFile {
  return !!file && !file.trashed && file.md5Checksum === expectMd5 && Number(file.size) === expectSize;
}

export async function migrateFiles(
  deps: MigrationDeps,
  opts: { dryRun?: boolean; limit?: number; tables?: string[]; allTypes?: boolean } = {},
): Promise<MigrationStats> {
  const { db, legacy, drive, statePath } = deps;
  const log = deps.log ?? ((l: string) => console.log(l));
  const state = loadState(statePath);
  const stats: MigrationStats = { scanned: 0, migrated: 0, reused: 0, skippedType: 0, failed: 0, rowsUpdated: 0 };

  for await (const f of legacyFiles(db, opts.tables)) {
    if (opts.limit !== undefined && stats.migrated + stats.reused >= opts.limit) break;
    stats.scanned++;
    const mime = resolveMime(f);
    if (!opts.allTypes && !isDriveMime(mime)) {
      stats.skippedType++; // other file types stay where they are (unless --all-types)
      continue;
    }
    if (opts.dryRun) {
      log(`[dry-run] would move ${f.column.model}.${f.column.column}: ${f.path} (${mime}) → ${f.column.module}`);
      continue;
    }
    try {
      const buffer = await legacy.getFile(f.path);
      const sum = md5(buffer);
      let target: DriveFile | null = null;
      let reused = false;

      // 1) Already copied in an earlier (interrupted) run?
      const known = state.files[f.path];
      if (known) {
        const meta = await drive.getMetadata(known.driveId);
        if (matches(meta, sum, buffer.length)) {
          target = meta;
          reused = true;
        }
      }
      if (!target) {
        const tagged = await drive.findByAppProperty('legacy', legacyTag(f.path));
        const good = tagged.find((t) => matches(t, sum, buffer.length));
        if (good) {
          target = good;
          reused = true;
        }
      }
      // 2) Copy it.
      if (!target) {
        const uploadedId = await drive.uploadInto(f.column.module, buffer, displayName(f), mime ?? 'application/octet-stream', { legacy: legacyTag(f.path) });
        // 3) Verify before anything in the database changes.
        const meta = await drive.getMetadata(uploadedId);
        if (!matches(meta, sum, buffer.length)) {
          throw new Error(`Drive copy ${uploadedId} failed verification (md5/size mismatch)`);
        }
        target = meta;
      }

      state.files[f.path] = {
        driveId: target.id,
        md5: sum,
        size: buffer.length,
        module: f.column.module,
        migratedAt: new Date().toISOString(),
      };
      delete state.failures[f.path];
      saveState(statePath, state);

      // 4) Point every record that uses this file at the Drive copy (one transaction).
      const changed: number = await db.$transaction((tx: Db) => replaceFileReferences(f.path, toDrivePath(target!.id), tx));
      stats.rowsUpdated += changed;
      if (reused) stats.reused++;
      else stats.migrated++;
      log(`moved ${f.path} → gdrive:${target.id} (${changed} record${changed === 1 ? '' : 's'})`);
    } catch (err) {
      stats.failed++;
      state.failures[f.path] = { error: (err as Error).message, at: new Date().toISOString() };
      saveState(statePath, state);
      log(`FAILED ${f.path}: ${(err as Error).message}`);
    }
  }
  return stats;
}

/** Every distinct `gdrive:` path the database uses (owners and bookkeeping copies). */
export async function referencedDriveIds(db: Db): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const column of FILE_COLUMNS) {
    const delegate = db[column.model];
    if (!delegate) continue;
    let cursor: string | undefined;
    for (;;) {
      const rows: Array<Record<string, unknown>> = await delegate.findMany({
        where: { [column.column]: { startsWith: 'gdrive:' }, ...(cursor ? { id: { gt: cursor } } : {}) },
        select: { id: true, [column.column]: true },
        orderBy: { id: 'asc' },
        take: 1000,
      });
      if (rows.length === 0) break;
      for (const r of rows) ids.add(driveIdOf(r[column.column] as string));
      cursor = rows[rows.length - 1].id as string;
    }
  }
  return ids;
}

/** Checks that every Drive file the database points at exists and can be opened. */
export async function verifyDriveReferences(
  deps: Pick<MigrationDeps, 'db' | 'drive' | 'log'>,
  opts: { download?: boolean } = {},
): Promise<{ checked: number; missing: string[] }> {
  const log = deps.log ?? ((l: string) => console.log(l));
  const ids = await referencedDriveIds(deps.db);
  const missing: string[] = [];
  for (const id of ids) {
    const meta = await deps.drive.getMetadata(id);
    if (!meta || meta.trashed) {
      missing.push(id);
      log(`MISSING gdrive:${id}`);
      continue;
    }
    if (opts.download) {
      const buf = await deps.drive.getFile(toDrivePath(id));
      if (meta.md5Checksum && md5(buf) !== meta.md5Checksum) {
        missing.push(id);
        log(`CORRUPT gdrive:${id}`);
      }
    }
  }
  return { checked: ids.size, missing };
}

/** ERP files in Drive that no record points at (e.g. an upload whose save failed). */
export async function findOrphans(
  deps: Pick<MigrationDeps, 'db' | 'drive'>,
  opts: { minAgeHours?: number } = {},
): Promise<DriveFile[]> {
  const [files, used] = await Promise.all([deps.drive.listErpFiles(), referencedDriveIds(deps.db)]);
  const cutoff = Date.now() - (opts.minAgeHours ?? 24) * 3600_000;
  return files.filter((f) => !used.has(f.id) && (!f.createdTime || Date.parse(f.createdTime) < cutoff));
}

/**
 * Deletes original files whose Drive copy is re-verified and that no record
 * points at any more. Only for files this migration moved (listed in the state file).
 */
export async function cleanupLegacy(deps: MigrationDeps, opts: { dryRun?: boolean } = {}): Promise<{ deleted: number; kept: number }> {
  const log = deps.log ?? ((l: string) => console.log(l));
  const state = loadState(deps.statePath);
  let deleted = 0;
  let kept = 0;
  for (const [legacyPath, entry] of Object.entries(state.files)) {
    if (entry.legacyDeletedAt) continue;
    const stillUsed = await countFileReferences(legacyPath, deps.db);
    const meta = await deps.drive.getMetadata(entry.driveId);
    if (stillUsed > 0 || !matches(meta, entry.md5, entry.size)) {
      kept++;
      log(`kept ${legacyPath} (${stillUsed > 0 ? 'still referenced' : 'Drive copy not verified'})`);
      continue;
    }
    if (opts.dryRun) {
      log(`[dry-run] would delete original ${legacyPath}`);
      continue;
    }
    await deps.legacy.deleteFile(legacyPath);
    entry.legacyDeletedAt = new Date().toISOString();
    saveState(deps.statePath, state);
    deleted++;
  }
  return { deleted, kept };
}
