import api from '../config/api';

/**
 * Download a file from an authenticated GET /:id/file endpoint.
 * Works in both storage modes (local stream / supabase signed-URL redirect).
 */
export async function downloadFile(route: string, id: string, fileName: string): Promise<void> {
  return downloadPath(`/${route}/${id}/file`, fileName);
}

/** Download from any authenticated API path (relative to /api). */
export async function downloadPath(path: string, fileName: string, headers?: Record<string, string>): Promise<void> {
  const res = await api.get(path, { responseType: 'blob', headers });
  const url = window.URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  window.URL.revokeObjectURL(url);
}

/**
 * Fetch a file as a blob URL (for use in <img> / <iframe> etc).
 * Caller must revoke the URL when done.
 */
export async function fetchFileUrl(route: string, id: string): Promise<string> {
  const res = await api.get(`/${route}/${id}/file`, { responseType: 'blob' });
  return window.URL.createObjectURL(res.data);
}

/** Open the browser's print dialog for a PDF blob, without leaving the page. */
export function printPdfBlob(blob: Blob): void {
  const url = window.URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  frame.src = url;
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(url, '_blank');
    }
    // keep the frame until the print dialog has had time to read it
    setTimeout(() => {
      frame.remove();
      window.URL.revokeObjectURL(url);
    }, 60_000);
  };
  document.body.appendChild(frame);
}
