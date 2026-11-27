/**
 * Every database column that holds a stored-file path. Used to
 *  - keep a Drive file while any record still points at it (shared files),
 *  - move existing files to Google Drive (migration),
 *  - find Drive files no record points at any more (orphans).
 *
 * Only the path string changes when a file moves; rows, relations and the
 * other metadata columns (name, type, size, dates, owner record) stay as they are.
 */
import { prisma } from '../../config/prisma';

export interface FileColumn {
  /** Prisma model delegate name */
  model: string;
  /** Column holding the storage path */
  column: string;
  /** Column holding the MIME type, if the table has one */
  mimeColumn?: string;
  /** Column holding the original file name, if any */
  nameColumn?: string;
  /** MIME type to assume when the table has no MIME column */
  defaultMime?: string;
  /** Drive folder for migrated files */
  module: string;
  /** Bookkeeping copy of a path (not a real owner of the file) */
  bookkeeping?: boolean;
}

export const FILE_COLUMNS: FileColumn[] = [
  { model: 'quotation', column: 'filePath', mimeColumn: 'fileMimeType', nameColumn: 'fileName', module: 'Quotations' },
  { model: 'vendorInvoice', column: 'filePath', mimeColumn: 'fileMimeType', nameColumn: 'fileName', module: 'Vendor Invoices' },
  { model: 'paymentRequest', column: 'filePath', mimeColumn: 'fileMimeType', nameColumn: 'fileName', module: 'Payment Requests' },
  { model: 'paymentSheet', column: 'filePath', mimeColumn: 'fileMimeType', nameColumn: 'fileName', module: 'Payment Sheets' },
  {
    model: 'materialPurchaseRequest',
    column: 'receiptFilePath',
    mimeColumn: 'receiptFileMimeType',
    nameColumn: 'receiptFileName',
    module: 'Material Requests',
  },
  { model: 'gatePass', column: 'photoProofPath', defaultMime: 'image/jpeg', module: 'Gate Passes' },
  { model: 'sitePhoto', column: 'imageUrl', defaultMime: 'image/jpeg', module: 'Site Photos' },
  { model: 'issue', column: 'closurePhotoUrl', defaultMime: 'image/jpeg', module: 'Site Issues' },
  { model: 'document', column: 'filePath', mimeColumn: 'mimeType', nameColumn: 'fileName', module: 'Documents' },
  { model: 'attachment', column: 'filePath', mimeColumn: 'mimeType', nameColumn: 'fileName', module: 'Attachments' },
  { model: 'chatAttachment', column: 'filePath', mimeColumn: 'mimeType', nameColumn: 'fileName', module: 'Chat' },
  { model: 'project', column: 'logoUrl', module: 'Project Logos' },
  { model: 'fileFingerprint', column: 'filePath', mimeColumn: 'mimeType', nameColumn: 'fileName', module: 'Other', bookkeeping: true },
];

type Delegate = {
  count(args: { where: Record<string, unknown> }): Promise<number>;
  updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

function delegate(client: Client, model: string): Delegate | undefined {
  return client?.[model] as Delegate | undefined;
}

/** How many records (excluding bookkeeping copies) still point at `filePath`. */
export async function countFileReferences(filePath: string, client: Client = prisma): Promise<number> {
  const counts = await Promise.all(
    FILE_COLUMNS.filter((c) => !c.bookkeeping).map(async (c) => {
      const d = delegate(client, c.model);
      if (!d) return 0;
      return d.count({ where: { [c.column]: filePath } });
    }),
  );
  return counts.reduce((s, n) => s + n, 0);
}

/** Points every record (and bookkeeping copy) that uses `from` at `to`. Returns rows changed. */
export async function replaceFileReferences(from: string, to: string, client: Client = prisma): Promise<number> {
  let changed = 0;
  for (const c of FILE_COLUMNS) {
    const d = delegate(client, c.model);
    if (!d) continue;
    const res = await d.updateMany({ where: { [c.column]: from }, data: { [c.column]: to } });
    changed += res.count;
  }
  return changed;
}

const EXT_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.svg': 'image/svg+xml',
};

/** MIME type from a file name / path extension, or null. */
export function mimeFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const m = /\.[a-z0-9]+$/i.exec(name.split('?')[0]);
  return m ? EXT_MIME[m[0].toLowerCase()] ?? null : null;
}

/** Images and PDFs are the files kept in Google Drive. */
export function isDriveMime(mime: string | null | undefined): boolean {
  if (!mime) return false;
  const m = mime.toLowerCase();
  return m === 'application/pdf' || (m.startsWith('image/') && m !== 'image/svg+xml');
}
