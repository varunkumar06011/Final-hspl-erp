import { lazy } from 'react';

// A lazy chunk can fail to load because a new deploy replaced the hashed file
// this open tab still references (or a flaky mobile fetch). Retrying the same
// URL cannot help (the browser caches the failed import), so on failure we
// reload once to fetch the fresh index.html and chunk names. The timestamp
// guard allows a new reload for a later deploy but stops a reload loop when
// the failure is real (e.g. offline).
const CHUNK_RELOAD_KEY = 'chunk-reload-at';
const CHUNK_RELOAD_WINDOW_MS = 30_000;

function reloadForFreshBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
    if (Date.now() - last < CHUNK_RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    // storage blocked: reload anyway, once per failure
  }
  window.location.reload();
  return true;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// A page module is only usable if it really exports a component. On some
// devices a stale/partial chunk (or a proxy/WebView cache) resolves the import
// to `undefined`; React.lazy then throws "Cannot read properties of undefined
// (reading 'default')" in production. Treat that like a failed load.
function isUsableModule<T>(mod: { default: T } | undefined | null): mod is { default: T } {
  return !!mod && typeof mod === 'object' && mod.default != null;
}

export function lazyWithRetry<T extends React.ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    let lastErr: unknown = new Error('Page module failed to load');
    // Quick in-place retries first: they fix flaky mobile fetches without a reload.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const mod = await factory();
        if (isUsableModule(mod)) return mod;
        lastErr = new Error('Page module loaded empty');
      } catch (err) {
        lastErr = err;
      }
      if (attempt < 2) await wait(400 * (attempt + 1));
    }
    // Still failing: most likely a new deploy replaced the chunk this tab knows.
    if (reloadForFreshBuild()) {
      // Keep Suspense showing its fallback while the page reloads.
      return new Promise<{ default: T }>(() => {});
    }
    throw lastErr;
  });
}
