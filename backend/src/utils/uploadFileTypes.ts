import path from 'path';

/**
 * Upload allow-list: common images, PDFs and Office files only. A file must have
 * BOTH an allowed extension and a matching MIME type, so renaming a script to
 * .pdf (or sending a fake content-type) is rejected.
 */
const TYPES: Record<string, string[]> = {
  '.pdf': ['application/pdf'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.gif': ['image/gif'],
  '.webp': ['image/webp'],
  '.bmp': ['image/bmp'],
  '.tif': ['image/tiff'],
  '.tiff': ['image/tiff'],
  '.heic': ['image/heic', 'image/heif'],
  '.heif': ['image/heic', 'image/heif'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xls': ['application/vnd.ms-excel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.ppt': ['application/vnd.ms-powerpoint'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  '.csv': ['text/csv', 'application/csv', 'application/vnd.ms-excel'],
  '.txt': ['text/plain'],
};

export const ALLOWED_UPLOAD_MESSAGE =
  'Unsupported file type. Allowed: PDF, JPG, PNG, GIF, WEBP, HEIC, Word, Excel, PowerPoint, CSV, TXT.';

/** Accept string for `<input type="file">` (the server check is the real guard). */
export const ALLOWED_UPLOAD_EXTENSIONS = Object.keys(TYPES);

export function isAllowedUpload(file: { originalname: string; mimetype: string }): boolean {
  const ext = path.extname(file.originalname).toLowerCase();
  const mimes = TYPES[ext];
  return !!mimes && mimes.includes(file.mimetype.toLowerCase());
}
