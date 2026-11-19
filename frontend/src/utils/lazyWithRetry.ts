import { lazy } from 'react';
import { noteChunkLoaded, recoverFromChunkError } from './chunkRecovery';

// A page module is only usable if it really exports a component. A failed
// import that something swallowed resolves to `undefined`; React.lazy would
// then throw "Cannot read properties of undefined (reading 'default')".
function isUsableModule<T>(mod: { default: T } | undefined | null): mod is { default: T } {
  return !!mod && typeof mod === 'object' && mod.default != null;
}

/**
 * React.lazy for pages. When the page file cannot be loaded (new deploy, flaky
 * network, refused request, bad cached copy) it revalidates the cached files and
 * reloads, a few times with backoff (see chunkRecovery.ts). When that is used up
 * it throws the original error, so the error screen shows what really failed.
 */
export function lazyWithRetry<T extends React.ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    let error: unknown;
    try {
      const mod = await factory();
      if (isUsableModule(mod)) {
        noteChunkLoaded();
        return mod;
      }
      error = new Error('Page module loaded empty');
    } catch (err) {
      error = err;
    }
    if (await recoverFromChunkError(error)) {
      // Keep Suspense showing its fallback while the page reloads.
      return new Promise<{ default: T }>(() => {});
    }
    throw error;
  });
}
