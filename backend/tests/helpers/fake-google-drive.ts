/**
 * In-memory Google (OAuth token endpoint + Drive v3 REST) at the fetch level, for
 * GoogleDriveStorageService: folders, multipart and resumable uploads with metadata
 * and app properties, file metadata with MD5, app-property searches, downloads and
 * trash. `failNext` makes chosen requests fail (optionally after taking effect).
 */
import crypto from 'crypto';

export interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  appProperties: Record<string, string>;
  data: Buffer;
  trashed: boolean;
  createdTime: string;
}

type Init = { method?: string; headers?: HeadersInit; body?: unknown };
const FOLDER = 'application/vnd.google-apps.folder';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

function bodyBuffer(body: unknown): Buffer {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  return Buffer.alloc(0);
}

export class FakeGoogleDrive {
  files = new Map<string, FakeFile>();
  calls: Array<{ method: string; url: string }> = [];
  failNext: Array<{ match: (method: string, url: string) => boolean; status: number; afterEffect?: boolean }> = [];
  private next = 1;
  private sessions = new Map<string, Record<string, unknown>>();

  constructor(public rootId = 'ROOT') {
    this.files.set(rootId, this.make({ id: rootId, name: 'ERP Files', mimeType: FOLDER, parents: [] }, Buffer.alloc(0)));
  }

  /** Files that are not folders. */
  get stored(): FakeFile[] {
    return [...this.files.values()].filter((f) => f.mimeType !== FOLDER);
  }

  folderNamed(name: string): FakeFile | undefined {
    return [...this.files.values()].find((f) => f.mimeType === FOLDER && f.name === name);
  }

  private make(meta: Record<string, unknown>, data: Buffer): FakeFile {
    return {
      id: String(meta.id ?? `F${this.next++}`),
      name: String(meta.name ?? ''),
      mimeType: String(meta.mimeType ?? 'application/octet-stream'),
      parents: (meta.parents as string[]) ?? [],
      appProperties: (meta.appProperties as Record<string, string>) ?? {},
      data,
      trashed: false,
      createdTime: new Date().toISOString(),
    };
  }

  private create(meta: Record<string, unknown>, data: Buffer): FakeFile {
    const f = this.make(meta, data);
    this.files.set(f.id, f);
    return f;
  }

  meta(f: FakeFile) {
    return {
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: String(f.data.length),
      md5Checksum: crypto.createHash('md5').update(f.data).digest('hex'),
      trashed: f.trashed,
      createdTime: f.createdTime,
      appProperties: f.appProperties,
    };
  }

  private matches(f: FakeFile, q: string): boolean {
    if (/trashed = false/.test(q) && f.trashed) return false;
    const name = /name = '([^']*)'/.exec(q)?.[1];
    if (name !== undefined && f.name !== name) return false;
    const parent = /'([^']+)' in parents/.exec(q)?.[1];
    if (parent && !f.parents.includes(parent)) return false;
    const mime = /mimeType = '([^']+)'/.exec(q)?.[1];
    if (mime && f.mimeType !== mime) return false;
    const prop = /appProperties has \{ key='([^']+)' and value='([^']+)' \}/.exec(q);
    if (prop && f.appProperties[prop[1]] !== prop[2]) return false;
    return true;
  }

  fetch = async (url: string, init: Init = {}): Promise<Response> => {
    const method = init.method ?? 'GET';
    this.calls.push({ method, url });
    const i = this.failNext.findIndex((f) => f.match(method, url));
    if (i >= 0) {
      const [f] = this.failNext.splice(i, 1);
      if (f.afterEffect) await this.handle(method, url, init);
      return json(f.status, { error: { message: `HTTP ${f.status}`, errors: [] } });
    }
    return this.handle(method, url, init);
  };

  private async handle(method: string, url: string, init: Init): Promise<Response> {
    if (url.startsWith('https://oauth2.googleapis.com/token')) return json(200, { access_token: 'tok', expires_in: 3600 });
    if (url.startsWith('session:')) {
      const f = this.create(this.sessions.get(url)!, bodyBuffer(init.body));
      return json(200, { id: f.id });
    }
    const u = new URL(url);
    if (u.pathname === '/upload/drive/v3/files') {
      if (u.searchParams.get('uploadType') === 'resumable') {
        const session = `session:${this.next++}`;
        this.sessions.set(session, JSON.parse(String(init.body)));
        return json(200, {}, { Location: session });
      }
      const body = bodyBuffer(init.body);
      const boundary = /boundary=(.+)$/.exec(new Headers(init.headers).get('Content-Type') ?? '')![1];
      const sep = Buffer.from(`--${boundary}`);
      const a = body.indexOf(sep);
      const b = body.indexOf(sep, a + sep.length);
      const end = body.lastIndexOf(Buffer.from(`\r\n--${boundary}--`));
      const metaPart = body.subarray(a + sep.length, b).toString();
      const meta = JSON.parse(metaPart.slice(metaPart.indexOf('\r\n\r\n') + 4).trim());
      const dataPart = body.subarray(b + sep.length, end);
      const f = this.create(meta, dataPart.subarray(dataPart.indexOf(Buffer.from('\r\n\r\n')) + 4));
      return json(200, { id: f.id });
    }
    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      const q = u.searchParams.get('q') ?? '';
      return json(200, { files: [...this.files.values()].filter((f) => this.matches(f, q)).map((f) => this.meta(f)) });
    }
    if (u.pathname === '/drive/v3/files' && method === 'POST') {
      const f = this.create(JSON.parse(String(init.body)), Buffer.alloc(0));
      return json(200, { id: f.id });
    }
    const idMatch = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
    if (idMatch) {
      const f = this.files.get(idMatch[1]);
      if (!f) return json(404, { error: { message: 'File not found' } });
      if (method === 'PATCH') {
        if (JSON.parse(String(init.body)).trashed) f.trashed = true;
        return json(200, { id: f.id, trashed: f.trashed });
      }
      if (u.searchParams.get('alt') === 'media') return new Response(new Uint8Array(f.data), { status: 200, headers: { 'Content-Type': f.mimeType } });
      return json(200, this.meta(f));
    }
    return json(404, { error: { message: `fake: unhandled ${method} ${url}` } });
  }
}
