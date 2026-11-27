/**
 * Safe removal of Google Drive files.
 *
 * Routes call `deleteFile` when a record lets go of a file (record deleted, file
 * replaced), sometimes before they change the row and sometimes inside a
 * transaction that may still roll back; and one file can be linked to several
 * records. So a Drive file is not trashed at once: after a short wait it is
 * trashed only if no record in any table (FILE_COLUMNS) still points at it.
 * Trashed files stay recoverable in Drive for 30 days. Non-Drive files are
 * passed straight through, exactly as before.
 */
import type { StorageService, UploadResult } from '../storage.service';
import { isDrivePath } from '../gdrive-storage.service';
import { countFileReferences } from './file-refs';

/** How long a released Drive file waits before the "is anything still using it?" check. */
export const DRIVE_DELETE_DELAY_MS = 15_000;

export class SafeDeleteStorageService implements StorageService {
  private pending = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly inner: StorageService,
    private readonly opts: {
      delayMs?: number;
      countReferences?: (filePath: string) => Promise<number>;
      log?: (msg: string, err?: unknown) => void;
    } = {},
  ) {}

  upload(file: Buffer, fileName: string, mimeType: string, bucket: string): Promise<UploadResult> {
    return this.inner.upload(file, fileName, mimeType, bucket);
  }

  getFile(filePath: string): Promise<Buffer> {
    return this.inner.getFile(filePath);
  }

  getSignedUrl(filePath: string, expiresIn?: number): Promise<string> {
    return this.inner.getSignedUrl(filePath, expiresIn);
  }

  async deleteFile(filePath: string): Promise<void> {
    if (!isDrivePath(filePath)) return this.inner.deleteFile(filePath);
    const waiting = this.pending.get(filePath);
    if (waiting) clearTimeout(waiting);
    const timer = setTimeout(() => {
      this.pending.delete(filePath);
      void this.trashIfUnused(filePath);
    }, this.opts.delayMs ?? DRIVE_DELETE_DELAY_MS);
    timer.unref?.();
    this.pending.set(filePath, timer);
  }

  /** Trashes the Drive file when no record uses it. Returns true when trashed. */
  async trashIfUnused(filePath: string): Promise<boolean> {
    try {
      const used = await (this.opts.countReferences ?? countFileReferences)(filePath);
      if (used > 0) return false;
      await this.inner.deleteFile(filePath);
      return true;
    } catch (err) {
      (this.opts.log ?? ((m, e) => console.error(m, e)))(`[Drive] could not remove ${filePath}; the orphan check will list it`, err);
      return false;
    }
  }

  /** Runs every waiting check now (tests, shutdown). */
  async flushPendingDeletes(): Promise<void> {
    const paths = [...this.pending.keys()];
    for (const p of paths) {
      clearTimeout(this.pending.get(p)!);
      this.pending.delete(p);
    }
    await Promise.all(paths.map((p) => this.trashIfUnused(p)));
  }
}
