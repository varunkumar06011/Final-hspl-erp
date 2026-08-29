/**
 * Scenario 15: Attachments
 *
 * Tests attachment upload (multipart) linked to an entity, list, file download, and delete.
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, prisma, request, makeReporter } from './_helpers';

const RUN_ID = `att-${Date.now()}`;
const { record, printReport } = makeReporter('ATTACHMENTS', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;
let attachmentId = '';
let vendorId = '';

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[ATT] run=${RUN_ID} project=${ctx.projectName}`);
  // Create a vendor to attach files to (via API to get all required fields)
  const res = await request
    .post('/api/vendors')
    .set(authAs(ctx.userPhId))
    .send({
      name: `Attachment Vendor ${RUN_ID}`,
      vendorCode: `ATT-${RUN_ID}`,
      acknowledged: true,
    });
  vendorId = res.body.id;
});

afterAll(() => printReport());

describe('Attachments', () => {
  it('POST /attachments/upload uploads an image linked to a vendor', async () => {
    const res = await request
      .post('/api/attachments/upload')
      .set(authAs(ctx.userPhId))
      .attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), { filename: `photo-${RUN_ID}.png`, contentType: 'image/png' })
      .field('entityType', 'VENDOR')
      .field('entityId', vendorId)
      .field('description', 'Vendor logo');
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.entityType).toBe('VENDOR');
    expect(res.body.entityId).toBe(vendorId);
    expect(res.body.fileType).toBe('IMAGE');
    attachmentId = res.body.id;
    record('attachment.upload', true, `att=${attachmentId} type=IMAGE`);
  });

  it('GET /attachments lists attachments for the entity', async () => {
    const res = await request
      .get('/api/attachments')
      .set(authAs(ctx.userPhId))
      .query({ entityType: 'VENDOR', entityId: vendorId });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('total');
    expect(res.body.data.some((a: { id: string }) => a.id === attachmentId)).toBe(true);
    record('attachment.list', true, `total=${res.body.total}`);
  });

  it('GET /attachments/:id/file downloads the attachment', async () => {
    const res = await request
      .get(`/api/attachments/${attachmentId}/file`)
      .set(authAs(ctx.userPhId))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    record('attachment.download', true, `${res.body.length} bytes`);
  });

  it('POST /attachments/upload rejects missing entityType/entityId', async () => {
    const res = await request
      .post('/api/attachments/upload')
      .set(authAs(ctx.userPhId))
      .attach('file', Buffer.from('test'), { filename: `test-${RUN_ID}.png`, contentType: 'image/png' });
    expect(res.status).toBe(400);
    record('attachment.missingEntity', true, `400 as expected`);
  });

  it('DELETE /attachments/:id deletes the attachment', async () => {
    const res = await request.delete(`/api/attachments/${attachmentId}`).set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    const db = await prisma.attachment.findUnique({ where: { id: attachmentId } });
    expect(db).toBeNull();
    record('attachment.delete', true, `hard-deleted`);
  });
});
