import { env } from '../config/env';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Response } from 'express';
import { withUploadGuard } from './duplicate.service';
import { GoogleDriveStorageService, RoutingStorageService, driveConfigFromEnv, isDrivePath } from './gdrive-storage.service';
import { SafeDeleteStorageService } from './storage/safe-delete';

export interface UploadResult {
  filePath: string;
  fileName: string;
  mimeType: string;
  size: number;
}

/** Files saved before the switch to Drive live in Supabase when it is configured. */
function legacyIsSupabase(): boolean {
  return (env.STORAGE_MODE === 'supabase' || env.STORAGE_MODE === 'gdrive') && !!env.SUPABASE_URL && !!env.SUPABASE_SERVICE_KEY;
}

/**
 * Serve a stored file to the client.
 * - Google Drive file ("gdrive:<id>"): stream it (Drive files are never shared by link).
 * - Supabase file: 302 redirect to a signed URL (bucket stays private).
 * - Local file: stream the file buffer with the stored content-type.
 */
export async function serveFile(
  res: Response,
  filePath: string,
  mimeType: string | null,
  storage: StorageService = getStorageService()
): Promise<void> {
  if (!isDrivePath(filePath) && legacyIsSupabase()) {
    const signedUrl = await storage.getSignedUrl(filePath);
    res.redirect(signedUrl);
  } else {
    const buffer = await storage.getFile(filePath);
    // A Drive path has no file extension, so a caller that guesses the type from the name
    // (the project logo) gets null: read the type from the file's first bytes instead.
    res.setHeader('Content-Type', mimeType || sniffMimeType(buffer) || 'application/octet-stream');
    res.send(buffer);
  }
}

/** Content type from a file's first bytes, for the common upload types; null when unknown. */
export function sniffMimeType(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && /^GIF8[79]a/.test(buf.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  const head = buf.subarray(0, 256).toString('utf8').trimStart();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return null;
}

export interface StorageService {
  upload(
    file: Buffer,
    fileName: string,
    mimeType: string,
    bucket: string
  ): Promise<UploadResult>;
  getFile(filePath: string): Promise<Buffer>;
  deleteFile(filePath: string): Promise<void>;
  getSignedUrl(filePath: string, expiresIn?: number): Promise<string>;
}

class LocalStorageService implements StorageService {
  async upload(
    file: Buffer,
    fileName: string,
    mimeType: string,
    bucket: string
  ): Promise<UploadResult> {
    const fs = await import('fs/promises');
    const path = await import('path');

    const uploadDir = path.join(env.LOCAL_STORAGE_PATH ?? './uploads', bucket);
    const uniqueName = `${Date.now()}-${fileName}`;
    const filePath = path.join(uploadDir, uniqueName);

    // Create all parent directories (fileName may contain subdirs like "images/photo.png")
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    await fs.writeFile(filePath, file);

    return {
      filePath,
      fileName: uniqueName,
      mimeType,
      size: file.length,
    };
  }

  async getFile(filePath: string): Promise<Buffer> {
    const fs = await import('fs/promises');
    return fs.readFile(filePath);
  }

  async deleteFile(filePath: string): Promise<void> {
    const fs = await import('fs/promises');
    try {
      await fs.unlink(filePath);
    } catch {
      // File may already be deleted
    }
  }

  async getSignedUrl(filePath: string): Promise<string> {
    // In local mode, return the file path directly
    // Frontend will request through the API
    return filePath;
  }
}

class SupabaseStorageService implements StorageService {
  private supabase: SupabaseClient | null = null;

  private getSupabase(): SupabaseClient {
    if (!this.supabase) {
      this.supabase = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_KEY!);
    }
    return this.supabase;
  }

  async upload(
    file: Buffer,
    fileName: string,
    mimeType: string,
    bucket: string
  ): Promise<UploadResult> {
    const supabase = this.getSupabase();
    const uniqueName = `${Date.now()}-${fileName}`;

    // Create the bucket if it does not exist (e.g. the first logo upload)
    const { data: buckets } = await supabase.storage.listBuckets();
    const bucketExists = buckets?.some((b) => b.name === bucket);
    if (!bucketExists) {
      const { error: createErr } = await supabase.storage.createBucket(bucket, { public: false });
      if (createErr && !createErr.message.includes('already exists')) {
        throw new Error(`Supabase create bucket failed: ${createErr.message}`);
      }
    }

    const { error } = await supabase.storage
      .from(bucket)
      .upload(uniqueName, file, { contentType: mimeType });

    if (error) {
      throw new Error(`Supabase upload failed: ${error.message}`);
    }

    return {
      filePath: `${bucket}/${uniqueName}`,
      fileName: uniqueName,
      mimeType,
      size: file.length,
    };
  }

  async getFile(filePath: string): Promise<Buffer> {
    const supabase = this.getSupabase();
    const [bucket, ...pathParts] = filePath.split('/');
    const objectPath = pathParts.join('/');

    const { data, error } = await supabase.storage
      .from(bucket)
      .download(objectPath);

    if (error) {
      throw new Error(`Supabase download failed: ${error.message}`);
    }

    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async deleteFile(filePath: string): Promise<void> {
    const supabase = this.getSupabase();
    const [bucket, ...pathParts] = filePath.split('/');
    const objectPath = pathParts.join('/');

    await supabase.storage.from(bucket).remove([objectPath]);
  }

  async getSignedUrl(filePath: string, expiresIn = 3600): Promise<string> {
    const supabase = this.getSupabase();
    const [bucket, ...pathParts] = filePath.split('/');
    const objectPath = pathParts.join('/');

    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(objectPath, expiresIn);

    if (error) {
      throw new Error(`Supabase signed URL failed: ${error.message}`);
    }

    return data.signedUrl;
  }
}

let storageService: StorageService | null = null;
let safeDelete: SafeDeleteStorageService | null = null;
let driveService: GoogleDriveStorageService | null | undefined;

/** The store files were saved in before Drive (Supabase or the local folder). */
export function getLegacyStorageService(): StorageService {
  return legacyIsSupabase() ? new SupabaseStorageService() : new LocalStorageService();
}

/** The Google Drive store, or null when its settings are missing. */
export function getDriveService(): GoogleDriveStorageService | null {
  if (driveService === undefined) {
    const driveConfig = driveConfigFromEnv(env);
    driveService = driveConfig ? new GoogleDriveStorageService(driveConfig) : null;
  }
  return driveService;
}

/** Waiting Drive deletes (see storage/safe-delete.ts); null when Drive is not configured. */
export function getSafeDeleteService(): SafeDeleteStorageService | null {
  getStorageService();
  return safeDelete;
}

export function getStorageService(): StorageService {
  if (!storageService) {
    const legacy = getLegacyStorageService();
    const drive = getDriveService();
    if (env.STORAGE_MODE === 'gdrive' && !drive) {
      throw new Error(
        'STORAGE_MODE=gdrive needs GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN and GOOGLE_DRIVE_FILES_FOLDER_ID',
      );
    }
    if (drive) {
      // Drive files open from Drive in any mode; new uploads go there only in gdrive mode.
      // A Drive file is trashed only once no record uses it any more.
      safeDelete = new SafeDeleteStorageService(new RoutingStorageService(drive, legacy, env.STORAGE_MODE === 'gdrive' ? drive : legacy));
      storageService = withUploadGuard(safeDelete);
    } else {
      storageService = withUploadGuard(legacy);
    }
  }
  return storageService;
}
