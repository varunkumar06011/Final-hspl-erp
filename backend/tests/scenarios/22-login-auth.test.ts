/**
 * Scenario 22: Login & Authentication
 *
 * Tests the full authentication lifecycle:
 *   - dev-login (existing + auto-create)
 *   - check-pin / set-pin / pin-login (JWT issuance)
 *   - JWT-based auth middleware (token works on protected routes)
 *   - change-pin (requires auth + old PIN)
 *   - /auth/me (profile retrieval)
 *   - User management CRUD (create/list/update — PROJECT_HEAD only)
 *   - RBAC enforcement (non-PH role denied MANAGE_USERS)
 *   - Negative paths: missing token, invalid token, inactive user, wrong PIN
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, prisma, request, makeReporter } from './_helpers';

const RUN_ID = `auth-${Date.now()}`;
const { record, printReport } = makeReporter('LOGIN & AUTH', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;
// Dedicated test user created for this run (auto-created via dev-login)
let testPhone = `+919900${RUN_ID.slice(-6)}22`;
let testUserId = '';
let jwtToken = '';

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[AUTH] run=${RUN_ID} project=${ctx.projectName}`);
});

afterAll(() => printReport());

describe('Login & Auth', () => {
  // ── dev-login ──
  it('POST /auth/dev-login returns existing user (PROJECT_HEAD)', async () => {
    // Fetch PH's phone from DB
    const ph = await prisma.user.findUnique({ where: { id: ctx.userPhId } });
    const res = await request.post('/api/auth/dev-login').send({ phone: ph!.phone });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ctx.userPhId);
    expect(res.body.role).toBe('PROJECT_HEAD');
    expect(res.body.isActive).toBe(true);
    record('dev-login.existing', true, `user=${res.body.id} role=${res.body.role}`);
  });

  it('POST /auth/dev-login auto-creates a new user as SUPERVISOR', async () => {
    const res = await request.post('/api/auth/dev-login').send({ phone: testPhone, name: `Auth Test ${RUN_ID}` });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.role).toBe('SUPERVISOR');
    expect(res.body.isActive).toBe(true);
    testUserId = res.body.id;
    record('dev-login.autoCreate', true, `user=${testUserId} role=SUPERVISOR`);
  });

  it('POST /auth/dev-login rejects inactive users', async () => {
    // Deactivate the test user, try login, then reactivate
    await prisma.user.update({ where: { id: testUserId }, data: { isActive: false } });
    const res = await request.post('/api/auth/dev-login').send({ phone: testPhone });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('inactive');
    await prisma.user.update({ where: { id: testUserId }, data: { isActive: true } });
    record('dev-login.inactive', true, `403 as expected`);
  });

  it('POST /auth/dev-login rejects missing phone', async () => {
    const res = await request.post('/api/auth/dev-login').send({});
    expect(res.status).toBe(400);
    record('dev-login.missingPhone', true, `400 as expected`);
  });

  // ── check-pin / set-pin / pin-login ──
  it('GET /auth/check-pin returns hasPin=false for new user', async () => {
    const res = await request.get('/api/auth/check-pin').query({ phone: testPhone });
    expect(res.status).toBe(200);
    expect(res.body.hasPin).toBe(false);
    record('check-pin.noPin', true, `hasPin=false`);
  });

  it('GET /auth/check-pin returns 404 for unregistered phone', async () => {
    const res = await request.get('/api/auth/check-pin').query({ phone: '+919999999999' });
    expect(res.status).toBe(404);
    record('check-pin.notFound', true, `404 as expected`);
  });

  it('POST /auth/set-pin sets a 4-digit PIN and returns a JWT', async () => {
    const res = await request.post('/api/auth/set-pin').send({ phone: testPhone, pin: '1234' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.id).toBe(testUserId);
    // JWT has 3 dot-separated parts
    expect(res.body.token.split('.').length).toBe(3);
    record('set-pin', true, `JWT issued for user=${testUserId}`);
  });

  it('GET /auth/check-pin returns hasPin=true after set-pin', async () => {
    const res = await request.get('/api/auth/check-pin').query({ phone: testPhone });
    expect(res.status).toBe(200);
    expect(res.body.hasPin).toBe(true);
    record('check-pin.hasPin', true, `hasPin=true`);
  });

  it('POST /auth/pin-login returns JWT with correct PIN', async () => {
    const res = await request.post('/api/auth/pin-login').send({ phone: testPhone, pin: '1234' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.id).toBe(testUserId);
    jwtToken = res.body.token;
    record('pin-login.success', true, `JWT received`);
  });

  it('POST /auth/pin-login rejects wrong PIN', async () => {
    const res = await request.post('/api/auth/pin-login').send({ phone: testPhone, pin: '9999' });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Incorrect PIN');
    record('pin-login.wrongPin', true, `401 as expected`);
  });

  it('POST /auth/pin-login rejects invalid PIN format (non-4-digit)', async () => {
    const res = await request.post('/api/auth/pin-login').send({ phone: testPhone, pin: '12' });
    expect([400, 500]).toContain(res.status);
    record('pin-login.badFormat', true, `${res.status} as expected`);
  });

  it('POST /auth/pin-login rejects unregistered phone', async () => {
    const res = await request.post('/api/auth/pin-login').send({ phone: '+919999999998', pin: '1234' });
    expect(res.status).toBe(404);
    record('pin-login.notFound', true, `404 as expected`);
  });

  // ── JWT-based auth middleware ──
  it('JWT token works on protected route (GET /auth/me)', async () => {
    const res = await request.get('/api/auth/me').set('Authorization', `Bearer ${jwtToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(testUserId);
    expect(res.body.phone).toBe(testPhone);
    record('jwt.me', true, `user=${res.body.id}`);
  });

  it('Protected route rejects missing token', async () => {
    const res = await request.get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('No authorization token');
    record('jwt.missingToken', true, `401 as expected`);
  });

  it('Protected route rejects invalid JWT', async () => {
    const res = await request.get('/api/auth/me').set('Authorization', 'Bearer invalid.jwt.token');
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Invalid or expired token');
    record('jwt.invalidToken', true, `401 as expected`);
  });

  it('Protected route rejects malformed Authorization header', async () => {
    const res = await request.get('/api/auth/me').set('Authorization', 'NotBearer abc');
    expect(res.status).toBe(401);
    record('jwt.malformedHeader', true, `401 as expected`);
  });

  // ── change-pin (requires auth) ──
  it('POST /auth/change-pin changes the PIN with correct old PIN', async () => {
    const res = await request
      .post('/api/auth/change-pin')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ oldPin: '1234', newPin: '5678' });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('updated');
    record('change-pin.success', true, `PIN changed 1234→5678`);
  });

  it('POST /auth/change-pin rejects wrong old PIN', async () => {
    const res = await request
      .post('/api/auth/change-pin')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ oldPin: '0000', newPin: '9999' });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('incorrect');
    record('change-pin.wrongOld', true, `401 as expected`);
  });

  it('POST /auth/change-pin rejects same old+new PIN', async () => {
    const res = await request
      .post('/api/auth/change-pin')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ oldPin: '5678', newPin: '5678' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('different');
    record('change-pin.samePin', true, `400 as expected`);
  });

  it('POST /auth/change-pin rejects unauthenticated request', async () => {
    const res = await request.post('/api/auth/change-pin').send({ oldPin: '5678', newPin: '4321' });
    expect(res.status).toBe(401);
    record('change-pin.noAuth', true, `401 as expected`);
  });

  it('pin-login works with the new PIN after change', async () => {
    const res = await request.post('/api/auth/pin-login').send({ phone: testPhone, pin: '5678' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    jwtToken = res.body.token;
    record('pin-login.afterChange', true, `new PIN works`);
  });

  // ── User management (PROJECT_HEAD only) ──
  it('GET /auth/users lists users (PROJECT_HEAD)', async () => {
    const res = await request.get('/api/auth/users').set(authAs(ctx.userPhId)).query({ page: '1', pageSize: '10' });
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.pagination.total).toBeGreaterThan(0);
    record('users.list', true, `total=${res.body.pagination.total}`);
  });

  let managedUserId = '';
  it('POST /auth/users creates a pre-provisioned user (PROJECT_HEAD)', async () => {
    const res = await request
      .post('/api/auth/users')
      .set(authAs(ctx.userPhId))
      .send({
        phone: `+919900${RUN_ID.slice(-6)}33`,
        name: `Managed User ${RUN_ID}`,
        role: 'SUPERVISOR',
        projectId: ctx.projectId,
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.role).toBe('SUPERVISOR');
    managedUserId = res.body.id;
    record('users.create', true, `user=${managedUserId}`);
  });

  it('POST /auth/users rejects duplicate phone', async () => {
    const res = await request
      .post('/api/auth/users')
      .set(authAs(ctx.userPhId))
      .send({
        phone: `+919900${RUN_ID.slice(-6)}33`,
        name: `Dup User ${RUN_ID}`,
        role: 'SUPERVISOR',
        projectId: ctx.projectId,
      });
    expect(res.status).toBe(409);
    record('users.duplicate', true, `409 as expected`);
  });

  it('PATCH /auth/users/:id updates user name and role', async () => {
    const res = await request
      .patch(`/api/auth/users/${managedUserId}`)
      .set(authAs(ctx.userPhId))
      .send({ name: `Updated User ${RUN_ID}`, role: 'SUPERVISOR' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe(`Updated User ${RUN_ID}`);
    record('users.update', true, `name updated`);
  });

  it('PATCH /auth/users/:id deactivates a user', async () => {
    const res = await request
      .patch(`/api/auth/users/${managedUserId}`)
      .set(authAs(ctx.userPhId))
      .send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
    const db = await prisma.user.findUnique({ where: { id: managedUserId } });
    expect(db!.isActive).toBe(false);
    record('users.deactivate', true, `isActive=false`);
  });

  it('PATCH /auth/users/:id prevents self-deactivation', async () => {
    const res = await request
      .patch(`/api/auth/users/${ctx.userPhId}`)
      .set(authAs(ctx.userPhId))
      .send({ isActive: false });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('cannot deactivate your own');
    record('users.selfDeactivate', true, `400 as expected`);
  });

  it('PATCH /auth/users/:id rejects non-unique approver role assignment', async () => {
    // Try to assign PROJECT_HEAD to managed user while PH already has that role
    await prisma.user.update({ where: { id: managedUserId }, data: { isActive: true } });
    const res = await request
      .patch(`/api/auth/users/${managedUserId}`)
      .set(authAs(ctx.userPhId))
      .send({ role: 'PROJECT_HEAD', projectId: ctx.projectId });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already assigned');
    record('users.roleConflict', true, `409 as expected`);
  });

  // ── RBAC enforcement ──
  it('GET /auth/users denied for SUPERVISOR (no MANAGE_USERS)', async () => {
    const res = await request.get('/api/auth/users').set(authAs(testUserId));
    expect(res.status).toBe(403);
    record('rbac.supervisorDenied', true, `403 as expected`);
  });

  it('POST /auth/users denied for SUPERVISOR', async () => {
    const res = await request
      .post('/api/auth/users')
      .set(authAs(testUserId))
      .send({ phone: `+919900${RUN_ID.slice(-6)}44`, name: 'Test', role: 'SUPERVISOR', projectId: ctx.projectId });
    expect(res.status).toBe(403);
    record('rbac.supervisorCreateDenied', true, `403 as expected`);
  });

  it('GET /auth/users allowed for ADMIN (has MANAGE_USERS)', async () => {
    const res = await request.get('/api/auth/users').set(authAs(ctx.userAdminId)).query({ page: '1', pageSize: '5' });
    expect(res.status).toBe(200);
    record('rbac.adminAllowed', true, `200 as expected`);
  });

  // ── dev-token auth (used by all other scenario tests) ──
  it('dev-token works for protected routes', async () => {
    const res = await request.get('/api/auth/me').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ctx.userPhId);
    record('dev-token.works', true, `user=${res.body.id}`);
  });

  it('dev-token with non-existent user ID returns 401/403', async () => {
    // Use a valid UUID format that doesn't exist in the DB
    const res = await request.get('/api/auth/me').set('Authorization', 'Bearer dev-token:00000000-0000-0000-0000-000000000000');
    expect([401, 403]).toContain(res.status);
    record('dev-token.invalidUser', true, `${res.status} as expected`);
  });
});
