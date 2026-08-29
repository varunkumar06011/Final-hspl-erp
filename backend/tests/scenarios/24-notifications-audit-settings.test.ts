/**
 * Scenario 24: Notifications, Audit Log, Settings & Profile
 *
 * Tests:
 *   - Notification subscribe/unsubscribe/status
 *   - Audit log listing + filtering (by entityType, action, date range)
 *   - Project settings GET + PATCH
 *   - User profile GET + PATCH
 *   - RBAC enforcement on audit log (SUPERVISOR denied)
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, prisma, request, makeReporter } from './_helpers';

const RUN_ID = `misc-${Date.now()}`;
const { record, printReport } = makeReporter('NOTIFICATIONS/AUDIT/SETTINGS', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;
const fcmToken = `fcm-test-token-${RUN_ID}`;

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[MISC] run=${RUN_ID} project=${ctx.projectName}`);
});

afterAll(() => printReport());

describe('Notifications', () => {
  it('POST /notifications/subscribe saves FCM token', async () => {
    const res = await request
      .post('/api/notifications/subscribe')
      .set(authAs(ctx.userPhId))
      .send({ token: fcmToken });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    record('notif.subscribe', true, `token saved`);
  });

  it('GET /notifications/status shows enabled=true', async () => {
    const res = await request.get('/api/notifications/status').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.subscriptionCount).toBeGreaterThanOrEqual(1);
    record('notif.status', true, `enabled=true subscriptions=${res.body.subscriptionCount}`);
  });

  it('POST /notifications/subscribe rejects missing token', async () => {
    const res = await request.post('/api/notifications/subscribe').set(authAs(ctx.userPhId)).send({});
    expect(res.status).toBe(400);
    record('notif.missingToken', true, `400 as expected`);
  });

  it('DELETE /notifications/subscribe removes FCM token', async () => {
    const res = await request
      .delete('/api/notifications/subscribe')
      .set(authAs(ctx.userPhId))
      .send({ token: fcmToken });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    record('notif.unsubscribe', true, `token removed`);
  });
});

describe('Audit Log', () => {
  it('GET /audit returns paginated audit logs (PH)', async () => {
    const res = await request.get('/api/audit').set(authAs(ctx.userPhId)).query({ page: '1', pageSize: '10' });
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.pagination).toBeDefined();
    record('audit.list', true, `total=${res.body.pagination.total}`);
  });

  it('GET /audit filters by entityType=VENDOR', async () => {
    const res = await request.get('/api/audit').set(authAs(ctx.userPhId)).query({ entityType: 'VENDOR', page: '1', pageSize: '5' });
    expect(res.status).toBe(200);
    expect(res.body.data.every((e: { entityType: string }) => e.entityType === 'VENDOR')).toBe(true);
    record('audit.filterEntity', true, `vendor logs=${res.body.data.length}`);
  });

  it('GET /audit filters by action=CREATE', async () => {
    const res = await request.get('/api/audit').set(authAs(ctx.userPhId)).query({ action: 'CREATE', page: '1', pageSize: '5' });
    expect(res.status).toBe(200);
    expect(res.body.data.every((e: { action: string }) => e.action === 'CREATE')).toBe(true);
    record('audit.filterAction', true, `create logs=${res.body.data.length}`);
  });

  it('GET /audit filters by date range', async () => {
    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = new Date().toISOString();
    const res = await request.get('/api/audit').set(authAs(ctx.userPhId)).query({ startDate, endDate, page: '1', pageSize: '5' });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    record('audit.filterDate', true, `date-range logs=${res.body.data.length}`);
  });

  it('GET /audit denied for SITE_SUPERVISOR (no VIEW_AUDIT_LOG)', async () => {
    // Create a temp SITE_SUPERVISOR user via DB (dev-login auto-creates as SUPERVISOR)
    const siteSv = await prisma.user.create({
      data: {
        firebaseUid: `dev-site-${RUN_ID}`,
        phone: `+919900${RUN_ID.slice(-6)}25`,
        name: `Site SV ${RUN_ID}`,
        role: 'SITE_SUPERVISOR',
        projectId: ctx.projectId,
        isActive: true,
      },
    });
    const res = await request.get('/api/audit').set(authAs(siteSv.id));
    expect(res.status).toBe(403);
    record('audit.rbacDenied', true, `403 for SITE_SUPERVISOR`);
  });
});

describe('Project Settings', () => {
  it('GET /settings returns project settings', async () => {
    const res = await request.get('/api/settings').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ctx.projectId);
    expect(res.body.name).toBeDefined();
    expect(res.body.status).toBe('ACTIVE');
    record('settings.get', true, `project=${res.body.name}`);
  });

  it('PATCH /settings updates project description', async () => {
    const newDesc = `Updated by test ${RUN_ID}`;
    const res = await request.patch('/api/settings').set(authAs(ctx.userPhId)).send({ description: newDesc });
    expect(res.status).toBe(200);
    expect(res.body.description).toBe(newDesc);
    const db = await prisma.project.findUnique({ where: { id: ctx.projectId } });
    expect(db!.description).toBe(newDesc);
    record('settings.update', true, `description updated`);
  });

  it('PATCH /settings updates project name', async () => {
    const original = await prisma.project.findUnique({ where: { id: ctx.projectId } });
    const newName = `Test Rename ${RUN_ID}`;
    const res = await request.patch('/api/settings').set(authAs(ctx.userPhId)).send({ name: newName });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe(newName);
    // Restore original name to avoid breaking other tests
    await prisma.project.update({ where: { id: ctx.projectId }, data: { name: original!.name } });
    record('settings.rename', true, `name updated + restored`);
  });
});

describe('User Profile', () => {
  it('GET /settings/profile returns current user profile', async () => {
    const res = await request.get('/api/settings/profile').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ctx.userPhId);
    expect(res.body.role).toBe('PROJECT_HEAD');
    record('profile.get', true, `user=${res.body.id} role=${res.body.role}`);
  });

  it('PATCH /settings/profile updates user name', async () => {
    const original = await prisma.user.findUnique({ where: { id: ctx.userPhId } });
    const newName = `PH Updated ${RUN_ID}`;
    const res = await request.patch('/api/settings/profile').set(authAs(ctx.userPhId)).send({ name: newName });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe(newName);
    // Restore original name
    await prisma.user.update({ where: { id: ctx.userPhId }, data: { name: original!.name } });
    record('profile.updateName', true, `name updated + restored`);
  });

  it('PATCH /settings/profile rejects empty body', async () => {
    const res = await request.patch('/api/settings/profile').set(authAs(ctx.userPhId)).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('No fields to update');
    record('profile.emptyBody', true, `400 as expected`);
  });
});
