// Recovery when a page file (a lazy JS/CSS chunk under /assets/) fails to load.
//
// Why a plain retry is not enough:
//  - Browsers remember a failed dynamic import for the life of the page, so
//    calling import() again in the same page usually fails the same way. Only a
//    reload asks the server again.
//  - A device can hold a bad copy of a chunk in its HTTP cache (e.g. an HTML
//    page cached under a chunk URL with the 1-year "immutable" header). A normal
//    reload then reuses that bad copy forever. Re-requesting it with
//    `cache: 'no-cache'` makes the browser check with the server and replace it
//    (a cheap 304 when the cached copy is fine).
//
// So: revalidate the suspect chunks, wait a little (rate limits, flaky mobile
// networks), reload. At most MAX_ATTEMPTS reloads per RESET_AFTER_MS, counted in
// sessionStorage so a real outage ends on the error screen, not a reload loop.

const STATE_KEY = 'chunk-recovery';
const MAX_ATTEMPTS = 3;
const RESET_AFTER_MS = 2 * 60_000;
const BACKOFF_MS = [500, 2000, 5000];
const REPAIR_TIMEOUT_MS = 6000;

interface RecoveryState {
  count: number;
  at: number;
}

let reloading: Promise<boolean> | null = null;

function readState(): RecoveryState | null {
  try {
    const raw = sessionStorage.getItem(STATE_KEY);
    if (!raw) return { count: 0, at: 0 };
    const s = JSON.parse(raw) as RecoveryState;
    if (Date.now() - s.at > RESET_AFTER_MS) return { count: 0, at: 0 };
    return s;
  } catch {
    return null; // storage blocked: cannot count reloads safely
  }
}

function writeState(s: RecoveryState): boolean {
  try {
    sessionStorage.setItem(STATE_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

/** A page file loaded fine: give the next failure its full set of attempts. */
export function noteChunkLoaded(): void {
  try {
    if (sessionStorage.getItem(STATE_KEY)) sessionStorage.removeItem(STATE_KEY);
  } catch {
    /* storage blocked */
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function errorText(err: unknown): string {
  if (err instanceof Error) return `${err.message} ${String((err as { cause?: unknown }).cause ?? '')}`;
  return String(err ?? '');
}

/** Same-origin /assets/ chunk URLs that may hold a bad cached copy. */
function suspectAssetUrls(err: unknown): string[] {
  const urls = new Set<string>();
  const origin = window.location.origin;
  const isAsset = (u: string) => {
    try {
      const url = new URL(u, origin);
      return url.origin === origin && url.pathname.includes('/assets/') && /\.(m?js|css)$/.test(url.pathname);
    } catch {
      return false;
    }
  };
  // Chrome/Firefox name the failing file in the message.
  for (const m of errorText(err).match(/(https?:\/\/[^\s'"]+|\/assets\/[^\s'"]+)/g) ?? []) {
    if (isAsset(m)) urls.add(new URL(m, origin).href);
  }
  // Files this page took from the HTTP cache (transferSize 0). Files fetched
  // from the network just now are already fresh.
  try {
    for (const e of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
      if (!isAsset(e.name)) continue;
      if (e.transferSize === undefined || e.transferSize === 0) urls.add(e.name);
    }
  } catch {
    /* Resource Timing unavailable */
  }
  // The page itself: an old copy of index.html names chunks that no longer exist.
  urls.add(window.location.href);
  return [...urls];
}

/** Ask the server about each suspect chunk so a bad cached copy is replaced. */
async function revalidateAssets(urls: string[]): Promise<void> {
  const queue = [...urls];
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try {
        await fetch(url, { cache: 'no-cache', credentials: 'same-origin' });
      } catch {
        /* offline / blocked: the reload will show it */
      }
    }
  };
  // Two at a time: a burst of parallel requests can itself be refused.
  await Promise.race([Promise.all([worker(), worker()]), wait(REPAIR_TIMEOUT_MS)]);
}

/**
 * Try to recover from a failed chunk load: revalidate cached chunks, then reload.
 * Returns true when a reload has been started (the caller should keep waiting),
 * false when the attempts are used up (the caller should show the error).
 * `force` (the user pressed Reload) ignores the attempt limit.
 */
export function recoverFromChunkError(err: unknown, force = false): Promise<boolean> {
  if (reloading) return reloading;
  const state = readState();
  if (!force) {
    if (!state) return Promise.resolve(false);
    if (state.count >= MAX_ATTEMPTS) return Promise.resolve(false);
  }
  const count = state?.count ?? 0;
  if (!force && !writeState({ count: count + 1, at: Date.now() })) return Promise.resolve(false);
  if (force) writeState({ count: 0, at: Date.now() });

  reloading = (async () => {
    await revalidateAssets(suspectAssetUrls(err));
    if (!force) await wait(BACKOFF_MS[Math.min(count, BACKOFF_MS.length - 1)]);
    window.location.reload();
    return true;
  })();
  return reloading;
}
