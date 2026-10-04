const SHARE_CACHE = 'shared-files-v1';
const MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Files shared into the installed web app from another app (Android share sheet).
 * The service worker parks them in Cache Storage; this reads them once and clears them.
 */
export async function takeSharedFiles(): Promise<File[]> {
  try {
    if (typeof caches === 'undefined') return [];
    const cache = await caches.open(SHARE_CACHE);
    const keys = await cache.keys();
    const files: File[] = [];
    for (const key of keys) {
      const res = await cache.match(key);
      await cache.delete(key);
      if (!res) continue;
      const sharedAt = Number(res.headers.get('X-Shared-At') || 0);
      if (!sharedAt || Date.now() - sharedAt > MAX_AGE_MS) continue;
      const type = res.headers.get('Content-Type') || 'application/octet-stream';
      const name = decodeURIComponent(res.headers.get('X-File-Name') || 'shared-file');
      files.push(new File([await res.blob()], name, { type }));
    }
    return files;
  } catch {
    return [];
  }
}
