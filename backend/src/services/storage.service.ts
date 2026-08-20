import { env } from '../config/env';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Response } from 'express';

export interface UploadResult {
  filePath: string;
  fileName: string;
  mimeType: string;
  size: number;
}

/**
 * Serve a stored file to the client.
 * - Supabase mode: 302 redirect to a signed URL (bucket stays private).
 * - Local mode: stream the file buffer with the stored content-type.
 */
export async function serveFile(
  res: Response,
  filePath: string,
  mimeType: string | null,
  storage: StorageService = getStorageService()
): Promise<void> {
  if (env.STORAGE_MODE === 'supabase') {
    const signedUrl = await storage.getSignedUrl(filePath);
    res.redirect(signedUrl);
  } else {
    const buffer = await storage.getFile(filePath);
    res.setHeader('Content-Type', mimeType || 'application/octet-stream');
    res.send(buffer);
  }
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
    await fs.mkdir(uploadDir, { recursive: true });

    const uniqueName = `${Date.now()}-${fileName}`;
    const filePath = path.join(uploadDir, uniqueName);

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

export function getStorageService(): StorageService {
  if (!storageService) {
    if (env.STORAGE_MODE === 'supabase' && env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
      storageService = new SupabaseStorageService();
    } else {
      storageService = new LocalStorageService();
    }
  }
  return storageService;
}
