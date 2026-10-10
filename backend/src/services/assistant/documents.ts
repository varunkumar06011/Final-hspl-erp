/**
 * Photos / PDFs attached in a Miko conversation are kept server-side while the
 * flow they belong to is still being answered (the user may take several turns
 * before the record is proposed). They live in assistant_actions as rows with
 * tool DOCUMENT_TOOL / status DOCUMENT_STATUS, owned by the user and project,
 * so no extra table is needed. The client only holds their ids.
 *
 * The file data is wiped as soon as it is no longer needed: when the record is
 * saved, when a proposal is discarded or expires, and after DOCUMENT_TTL_MS.
 */
import { prisma } from '../../config/prisma';
import type { ChatImage } from './engine';
import type { DocumentReading } from './reader';

export const DOCUMENT_TOOL = '_document';
export const DOCUMENT_STATUS = 'DOCUMENT';
/** How long an attached document stays usable in a conversation. */
export const DOCUMENT_TTL_MS = 2 * 60 * 60 * 1000;
/** Key inside assistant_actions.args that carries file data (never sent to an endpoint). */
export const IMAGES_KEY = '_images';
/** Most files one proposal may carry. */
export const MAX_FILES_PER_RECORD = 6;

interface Owner {
  id: string;
  projectId: string;
}

export async function saveDocument(user: Owner, images: ChatImage[], reading: DocumentReading | null): Promise<string> {
  const row = await prisma.assistantAction.create({
    data: {
      projectId: user.projectId,
      userId: user.id,
      tool: DOCUMENT_TOOL,
      args: { [IMAGES_KEY]: images, reading } as object,
      summary: { pages: images.length, documentType: reading?.documentType ?? null } as object,
      status: DOCUMENT_STATUS,
    },
  });
  return row.id;
}

/** Files of the caller's own, still-fresh documents (ids from anyone else or expired are ignored). */
export async function loadDocumentImages(user: Owner, ids: string[]): Promise<ChatImage[]> {
  if (!ids.length) return [];
  const rows = await prisma.assistantAction.findMany({
    where: {
      id: { in: ids },
      userId: user.id,
      projectId: user.projectId,
      tool: DOCUMENT_TOOL,
      status: DOCUMENT_STATUS,
      createdAt: { gte: new Date(Date.now() - DOCUMENT_TTL_MS) },
    },
    orderBy: { createdAt: 'asc' },
    select: { args: true },
  });
  const out: ChatImage[] = [];
  for (const r of rows) {
    const imgs = (r.args as Record<string, unknown> | null)?.[IMAGES_KEY];
    if (Array.isArray(imgs)) out.push(...(imgs as ChatImage[]));
  }
  return out.slice(0, MAX_FILES_PER_RECORD);
}

/** The flow finished (record saved): the documents are no longer needed. */
export async function releaseDocuments(user: Owner, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await prisma.assistantAction.updateMany({
    where: { id: { in: ids }, userId: user.id, projectId: user.projectId, tool: DOCUMENT_TOOL, status: DOCUMENT_STATUS },
    data: { status: 'USED', args: {} },
  });
}

let lastPurge = 0;
const PURGE_EVERY_MS = 10 * 60 * 1000;

/**
 * Drops stored file data nobody can use any more: expired documents, and the
 * photos on proposals that were cancelled, failed or expired. Best effort,
 * at most every 10 minutes per process.
 */
export async function purgeStaleFiles(now = Date.now()): Promise<void> {
  if (now - lastPurge < PURGE_EVERY_MS) return;
  lastPurge = now;
  try {
    await prisma.assistantAction.updateMany({
      where: { tool: DOCUMENT_TOOL, status: DOCUMENT_STATUS, createdAt: { lt: new Date(now - DOCUMENT_TTL_MS) } },
      data: { status: 'EXPIRED', args: {} },
    });
    // Proposals keep their args (the audit of what was proposed) but lose the file data.
    await prisma.$executeRaw`
      UPDATE assistant_actions
         SET args = args - '_images',
             status = CASE WHEN status = 'PENDING' THEN 'EXPIRED' ELSE status END
       WHERE tool <> ${DOCUMENT_TOOL}
         AND args ? '_images'
         AND (status IN ('CANCELLED', 'FAILED', 'EXPIRED')
              OR (status = 'PENDING' AND "createdAt" < ${new Date(now - DOCUMENT_TTL_MS)}))`;
  } catch (err) {
    console.error('[Miko] purge of stale files failed:', err);
  }
}
