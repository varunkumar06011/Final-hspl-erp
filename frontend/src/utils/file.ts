import api from '../config/api';

/**
 * Download a file from an authenticated GET /:id/file endpoint.
 * Works in both storage modes (local stream / supabase signed-URL redirect).
 */
export async function downloadFile(route: string, id: string, fileName: string): Promise<void> {
  const res = await api.get(`/${route}/${id}/file`, { responseType: 'blob' });
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
