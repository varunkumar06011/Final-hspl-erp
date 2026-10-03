/**
 * Calls this server's own /api as the logged-in user.
 *
 * The assistant never touches the database directly: every read and write goes
 * through the same routes the web app uses, carrying the user's own bearer
 * token. Authentication, RBAC, project scoping, validation, approval workflows,
 * sequence numbers, audit logging and notifications therefore all apply
 * exactly as for a human user.
 */
import crypto from 'crypto';
import { env } from '../../config/env';

/** Random per-process secret; lets the app's rate limiter skip our own loopback calls. */
export const INTERNAL_SECRET = crypto.randomBytes(24).toString('hex');
export const INTERNAL_HEADER = 'x-assistant-internal';

export interface ApiResult {
  ok: boolean;
  status: number;
  body: any;
}

const TIMEOUT_MS = 25_000;

function baseUrl(): string {
  return (env.ASSISTANT_INTERNAL_URL || `http://127.0.0.1:${env.PORT}`).replace(/\/+$/, '');
}

export async function callApi(
  authorization: string,
  method: 'GET' | 'POST',
  path: string,
  opts: { query?: Record<string, unknown>; body?: unknown } = {},
): Promise<ApiResult> {
  const url = new URL(`${baseUrl()}/api${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
        [INTERNAL_HEADER]: INTERNAL_SECRET,
      },
      body: method === 'POST' ? JSON.stringify(opts.body ?? {}) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text.slice(0, 500) };
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    return {
      ok: false,
      status: aborted ? 504 : 502,
      body: { error: aborted ? 'The request timed out' : 'Could not reach the server' },
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Best human-readable message from an API error body. */
export function apiErrorMessage(result: ApiResult): string {
  const b = result.body;
  if (b && typeof b === 'object') {
    if (Array.isArray(b.details) && b.details.length) {
      const first = b.details
        .slice(0, 5)
        .map((d: any) => (typeof d === 'string' ? d : [d.path, d.message].filter(Boolean).join(': ')))
        .join('; ');
      return `${b.error ?? 'Validation failed'} — ${first}`;
    }
    if (typeof b.error === 'string') return b.error;
    if (typeof b.message === 'string') return b.message;
  }
  return `Request failed (HTTP ${result.status})`;
}
