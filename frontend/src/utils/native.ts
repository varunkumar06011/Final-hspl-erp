/**
 * Native (Capacitor/WKWebView) shims for browser-only behaviors.
 *
 * In the web app, `window.open` and `<a download>` are used for PDF previews,
 * external links (WhatsApp), file exports and print windows. Inside WKWebView
 * all of these silently no-op or navigate the app away from itself. This
 * module installs a compatibility layer when running natively:
 *
 *  - blob: URLs  → resolved via a URL.createObjectURL intercept (callers
 *                  commonly revoke the URL immediately, so fetching the blob:
 *                  URL later would race and fail), written to the app cache
 *                  and shown via the native share sheet
 *  - http(s)://  → opened in an SFSafariViewController via @capacitor/browser
 *                  (keeps the app itself open; universal links like wa.me
 *                  still hand off to their native apps)
 *  - other schemes (tel:, mailto:, ...) → handed to iOS via webview navigation
 *  - print windows (open('') + document.write + print) → captured HTML saved
 *    as a file and shared so it can be opened/printed elsewhere
 *  - <a download> clicks → same blob path as above
 */

import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Browser } from '@capacitor/browser';

let installed = false;

// blob: URL → Blob. Callers frequently revoke the object URL right after
// triggering the open/download, so the Blob itself is kept by reference.
const blobRegistry = new Map<string, Blob>();

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function extensionFor(blob: Blob): string {
  const map: Record<string, string> = {
    'application/pdf': 'pdf',
    'text/html': 'html',
    'text/csv': 'csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'image/png': 'png',
    'image/jpeg': 'jpg',
  };
  return map[blob.type] ?? 'bin';
}

/** Save a blob to the cache dir and present the native share sheet. */
async function shareBlob(blob: Blob, suggestedName?: string): Promise<void> {
  const base64 = await blobToBase64(blob);
  const name = suggestedName || `export-${Date.now()}.${extensionFor(blob)}`;
  const { uri } = await Filesystem.writeFile({
    path: `exports/${name}`,
    data: base64,
    directory: Directory.Cache,
    recursive: true,
  });
  await Share.share({ title: name, url: uri, dialogTitle: name });
}

async function resolveBlob(blobUrl: string): Promise<Blob | null> {
  const registered = blobRegistry.get(blobUrl);
  if (registered) return registered;
  try {
    return await (await fetch(blobUrl)).blob();
  } catch {
    return null;
  }
}

function isInternalUrl(url: string): boolean {
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

async function openUrl(url: string, suggestedName?: string): Promise<void> {
  try {
    if (url.startsWith('blob:')) {
      const blob = await resolveBlob(url);
      if (blob) await shareBlob(blob, suggestedName);
    } else if (/^https?:\/\//i.test(url)) {
      if (isInternalUrl(url)) {
        window.location.href = url;
      } else {
        await Browser.open({ url });
      }
    } else if (url && url !== 'about:blank') {
      // tel:, mailto:, whatsapp:, etc. — WKWebView hands non-http(s)
      // navigations to iOS, which opens the matching system app.
      window.location.href = url;
    }
  } catch (err) {
    console.warn('[native] openUrl failed for', url, err);
  }
}

/**
 * Minimal Window stand-in so callers can do `w.location.href = url` or
 * `w.document.write(html); w.print()`. document.write output is buffered and
 * pushed through the share sheet when the document is closed or printed.
 */
function fakeWindow(): Window {
  let html = '';
  let shared = false;
  const shareHtml = () => {
    if (shared || !html.trim()) return;
    shared = true;
    const blob = new Blob([html], { type: 'text/html' });
    void shareBlob(blob, `document-${Date.now()}.html`);
  };
  const loc = {
    _href: 'about:blank',
    get href() {
      return this._href;
    },
    set href(v: string) {
      this._href = v;
      void openUrl(v);
    },
    replace(v: string) {
      void openUrl(v);
    },
  };
  return {
    location: loc,
    closed: false,
    document: {
      write(chunk: string) {
        html += chunk;
      },
      writeln(chunk: string) {
        html += chunk + '\n';
      },
      close() {
        shareHtml();
      },
      open() {},
    },
    close() {},
    focus() {},
    blur() {},
    print() {
      shareHtml();
    },
  } as unknown as Window;
}

export function installNativeOpenShim(): void {
  if (installed) return;
  installed = true;

  // Keep a registry of every blob handed an object URL — resolves them even
  // after revokeObjectURL.
  const origCreate = URL.createObjectURL.bind(URL);
  URL.createObjectURL = ((obj: Blob | MediaSource) => {
    const url = origCreate(obj);
    if (obj instanceof Blob) blobRegistry.set(url, obj);
    return url;
  }) as typeof URL.createObjectURL;

  window.open = ((url?: string | URL, _target?: string, _features?: string) => {
    const u = url == null ? '' : String(url);
    // about:blank / '' is used as a deferred-load handle (PDF previews and
    // print windows) — return a stub whose setters perform the native open.
    if (u === '' || u === 'about:blank') return fakeWindow();
    void openUrl(u);
    return fakeWindow();
  }) as typeof window.open;

  // <a href="blob:..." download> does nothing in WKWebView — reroute clicks
  // that carry a download attribute through the share-sheet path.
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (this.hasAttribute('download') && this.href.startsWith('blob:')) {
      void openUrl(this.href, this.getAttribute('download') ?? undefined);
      return;
    }
    origClick.call(this);
  };
}
