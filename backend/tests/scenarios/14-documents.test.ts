/**
 * Scenario 14: Documents
 *
 * Tests document upload (multipart), list, file download, and soft delete.
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, prisma, request, makeReporter } from './_helpers';

const RUN_ID = `doc-${Date.now()}`;
const { record, printReport } = makeReporter('DOCUMENTS', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;
let documentId = '';

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[DOC] run=${RUN_ID} project=${ctx.projectName}`);
});

afterAll(() => printReport());

describe('Documents', () => {
  it('POST /documents/upload uploads a PDF document', async () => {
    const res = await request
      .post('/api/documents/upload')
      .set(authAs(ctx.userPhId))
      .attach('file', Buffer.from(`%PDF-1.4 test document ${RUN_ID}`), { filename: `test-${RUN_ID}.pdf`, contentType: 'application/pdf' })
      .field('name', `Test Document ${RUN_ID}`)
      .field('description', 'E2E test document')
      .field('resolveTo', JSON.stringify([ctx.userPhId]));
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe(`Test Document ${RUN_ID}`);
    documentId = res.body.id;
    const db = await prisma.document.findUnique({ where: { id: documentId } });
    expect(db).not.toBeNull();
    expect(db!.deletedAt).toBeNull();
    record('document.upload', true, `doc=${documentId}`);
  });

  it('GET /documents lists uploaded documents', async () => {
    const res = await request.get('/api/documents').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('pagination');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.some((d: { id: string }) => d.id === documentId)).toBe(true);
    record('document.list', true, `total=${res.body.pagination.total}`);
  });

  it('GET /documents/:id/file downloads the document', async () => {
    const res = await request
      .get(`/api/documents/${documentId}/file`)
      .set(authAs(ctx.userPhId))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    record('document.download', true, `${res.body.length} bytes`);
  });

  it('POST /documents/upload rejects unsupported file type', async () => {
    const res = await request
      .post('/api/documents/upload')
      .set(authAs(ctx.userPhId))
      .attach('file', Buffer.from('not a real file'), { filename: `test-${RUN_ID}.exe`, contentType: 'application/x-msdownload' })
      .field('name', `Bad Doc ${RUN_ID}`)
      .field('resolveTo', JSON.stringify([ctx.userPhId]));
    expect(res.status).toBe(400);
    record('document.badType', true, `400 as expected`);
  });

  it('POST /documents/upload rejects missing name', async () => {
    const res = await request
      .post('/api/documents/upload')
      .set(authAs(ctx.userPhId))
      .attach('file', Buffer.from(`%PDF-1.4 test ${RUN_ID}`), { filename: `test-${RUN_ID}.pdf`, contentType: 'application/pdf' })
      .field('resolveTo', JSON.stringify([ctx.userPhId]));
    expect(res.status).toBe(400);
    record('document.missingName', true, `400 as expected`);
  });

  it('DELETE /documents/:id soft-deletes the document', async () => {
    const res = await request.delete(`/api/documents/${documentId}`).set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    const db = await prisma.document.findUnique({ where: { id: documentId } });
    expect(db!.deletedAt).not.toBeNull();
    record('document.delete', true, `soft-deleted`);
  });
});
