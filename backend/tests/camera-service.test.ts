/**
 * Camera Service Tests
 * ====================
 *
 * The camera service captures video clips from an RTSP security camera mounted
 * at the site gate. When a gate pass is created (a truck is expected to arrive),
 * the service records a short "entry" clip. When the truck leaves, it records
 * an "exit" clip. These clips are stored as evidence in case of disputes about
 * what was delivered.
 *
 * In production (when CAMERA_RTSP_URL is set), the service uses ffmpeg to
 * capture a live RTSP stream for a configurable duration (default 15 seconds).
 * In development (no camera connected), the supervisor uploads a video file
 * from their phone instead — the captureFromUploadedFile function handles this.
 *
 * These tests verify:
 *  - isCameraConfigured correctly detects whether a camera URL is set
 *  - getCameraConfig returns the configured URL and duration with correct defaults
 *  - captureFromUploadedFile uploads the video buffer and names it with the
 *    gate-pass ID and clip type (entry/exit) so clips are findable later
 *
 * The ffmpeg-based captureVideoClip function is not tested here because it
 * requires ffmpeg to be installed and a real RTSP stream — it's covered by
 * the E2E tests instead.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the storage service so captureFromUploadedFile doesn't touch the filesystem.
// We only care that it calls upload() with the right arguments.
const uploadMock = vi.fn();
vi.mock('../src/services/storage.service', () => ({
  getStorageService: () => ({ upload: uploadMock }),
}));

// Mock env to satisfy the import chain (camera.service imports env for LOCAL_STORAGE_PATH).
vi.mock('../src/config/env', () => ({
  env: {
    STORAGE_MODE: 'local',
    LOCAL_STORAGE_PATH: './test-uploads',
    CAMERA_CLIP_DURATION: 15,
  },
}));

import {
  getCameraConfig,
  isCameraConfigured,
  captureFromUploadedFile,
} from '../src/services/camera.service';

// ─────────────────────────────────────────────────────────────────────────────
// CAMERA CONFIGURATION — detecting whether a camera is connected.
// ─────────────────────────────────────────────────────────────────────────────
describe('Camera Service — configuration detection', () => {
  const originalRtsp = process.env.CAMERA_RTSP_URL;
  const originalDuration = process.env.CAMERA_CLIP_DURATION;

  beforeEach(() => {
    // Start each test with no camera configured.
    delete process.env.CAMERA_RTSP_URL;
    delete process.env.CAMERA_CLIP_DURATION;
  });

  afterEach(() => {
    // Restore the original env vars.
    if (originalRtsp !== undefined) process.env.CAMERA_RTSP_URL = originalRtsp;
    else delete process.env.CAMERA_RTSP_URL;
    if (originalDuration !== undefined) process.env.CAMERA_CLIP_DURATION = originalDuration;
    else delete process.env.CAMERA_CLIP_DURATION;
  });

  it('isCameraConfigured returns false when CAMERA_RTSP_URL is not set (no camera connected)', () => {
    // The frontend uses this to decide which UI to show:
    //  - true  → "Recording will start automatically when the truck arrives"
    //  - false → "Please upload a video of the truck entering"
    expect(isCameraConfigured()).toBe(false);
  });

  it('isCameraConfigured returns true when CAMERA_RTSP_URL is set (camera is connected)', () => {
    process.env.CAMERA_RTSP_URL = 'rtsp://camera/stream';
    expect(isCameraConfigured()).toBe(true);
  });

  it('getCameraConfig returns the configured RTSP URL and clip duration', () => {
    process.env.CAMERA_RTSP_URL = 'rtsp://camera/stream';
    process.env.CAMERA_CLIP_DURATION = '30';
    const config = getCameraConfig();
    expect(config.rtspUrl).toBe('rtsp://camera/stream');
    expect(config.durationSeconds).toBe(30);
  });

  it('getCameraConfig defaults the clip duration to 15 seconds when not set', () => {
    // 15 seconds is long enough to capture the truck number plate and the
    // material being unloaded, but short enough to keep storage costs reasonable.
    process.env.CAMERA_RTSP_URL = 'rtsp://camera/stream';
    const config = getCameraConfig();
    expect(config.durationSeconds).toBe(15);
  });

  it('getCameraConfig returns an empty rtspUrl when the env var is not set', () => {
    // This is the "no camera" state — the frontend will show the upload UI.
    const config = getCameraConfig();
    expect(config.rtspUrl).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VIDEO UPLOAD — the dev-mode fallback when no camera is connected.
// ─────────────────────────────────────────────────────────────────────────────
describe('Camera Service — captureFromUploadedFile (dev-mode video upload)', () => {
  beforeEach(() => {
    uploadMock.mockReset();
  });

  it('uploads the provided video buffer and returns the stored file path', async () => {
    // In dev mode, the supervisor records a video on their phone and uploads
    // it. The service stores it via the storage service and returns the path
    // so it can be saved on the gate-pass record.
    const buf = Buffer.from('fake-video-bytes');
    uploadMock.mockResolvedValue({
      filePath: 'gate-pass-videos/gp-1-entry-123.mp4',
      fileName: 'gp-1-entry-123.mp4',
      mimeType: 'video/mp4',
      size: buf.length,
    });

    const result = await captureFromUploadedFile(buf, 'gp-1', 'entry');

    expect(uploadMock).toHaveBeenCalledTimes(1);
    // Verify the upload was called with the exact buffer, a unique filename,
    // the correct MIME type, and the gate-pass-videos bucket.
    const [uploadedBuffer, uploadedName, uploadedMime, uploadedBucket] = uploadMock.mock.calls[0];
    expect(uploadedBuffer.equals(buf)).toBe(true);
    expect(uploadedName).toMatch(/^gp-1-entry-\d+\.mp4$/); // gatePassId-clipType-timestamp.mp4
    expect(uploadedMime).toBe('video/mp4');
    expect(uploadedBucket).toBe('gate-pass-videos');
    expect(result).toBe('gate-pass-videos/gp-1-entry-123.mp4');
  });

  it('includes "exit" in the filename when recording the truck leaving the site', async () => {
    // The clip type (entry vs exit) is embedded in the filename so we can
    // later find both clips for a given gate pass and play them side by side.
    uploadMock.mockResolvedValue({
      filePath: 'x',
      fileName: 'x',
      mimeType: 'video/mp4',
      size: 0,
    });
    await captureFromUploadedFile(Buffer.from('x'), 'gp-2', 'exit');
    const uploadedName = uploadMock.mock.calls[0][1];
    expect(uploadedName).toMatch(/^gp-2-exit-\d+\.mp4$/);
  });
});
