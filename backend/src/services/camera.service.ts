import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { env } from '../config/env';
import { getStorageService } from './storage.service';

const execFileAsync = promisify(execFile);

export interface CameraConfig {
  rtspUrl: string;
  durationSeconds: number;
}

export function getCameraConfig(): CameraConfig {
  return {
    rtspUrl: process.env.CAMERA_RTSP_URL || '',
    durationSeconds: parseInt(process.env.CAMERA_CLIP_DURATION || '15', 10),
  };
}

export function isCameraConfigured(): boolean {
  const config = getCameraConfig();
  return config.rtspUrl.length > 0;
}

export async function captureVideoClip(
  gatePassId: string,
  clipType: 'entry' | 'exit'
): Promise<string> {
  const config = getCameraConfig();
  if (!config.rtspUrl) {
    throw new Error('Camera not configured. Set CAMERA_RTSP_URL in .env');
  }

  const tmpDir = path.join(env.LOCAL_STORAGE_PATH, 'tmp');
  await fs.mkdir(tmpDir, { recursive: true });

  const tmpFile = path.join(tmpDir, `${gatePassId}-${clipType}-${Date.now()}.mp4`);

  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-rtsp_transport', 'tcp',
      '-i', config.rtspUrl,
      '-t', String(config.durationSeconds),
      '-c', 'copy',
      '-movflags', '+faststart',
      tmpFile,
    ], { timeout: (config.durationSeconds + 10) * 1000 });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error('FFmpeg is not installed. Install it from https://ffmpeg.org/download.html');
    }
    throw new Error(`FFmpeg capture failed: ${error.message || error}`);
  }

  const videoBuffer = await fs.readFile(tmpFile);
  await fs.unlink(tmpFile).catch(() => {});

  const storage = getStorageService();
  const fileName = `${gatePassId}-${clipType}-${Date.now()}.mp4`;
  const result = await storage.upload(videoBuffer, fileName, 'video/mp4', 'gate-pass-videos');

  return result.filePath;
}

export async function captureFromUploadedFile(
  fileBuffer: Buffer,
  gatePassId: string,
  clipType: 'entry' | 'exit'
): Promise<string> {
  const storage = getStorageService();
  const fileName = `${gatePassId}-${clipType}-${Date.now()}.mp4`;
  const result = await storage.upload(fileBuffer, fileName, 'video/mp4', 'gate-pass-videos');
  return result.filePath;
}
