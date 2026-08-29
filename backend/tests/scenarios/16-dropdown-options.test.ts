/**
 * Scenario 16: Dropdown Options
 *
 * Tests user-expandable dropdown options: create, list, toggle active, duplicate prevention.
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, prisma, request, makeReporter } from './_helpers';

const RUN_ID = `dd-${Date.now()}`;
const { record, printReport } = makeReporter('DROPDOWN OPTIONS', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;
let optionId = '';

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[DD] run=${RUN_ID} project=${ctx.projectName}`);
});

afterAll(() => printReport());

describe('Dropdown Options', () => {
  it('POST /dropdown-options creates a new option', async () => {
    const res = await request
      .post('/api/dropdown-options')
      .set(authAs(ctx.userPhId))
      .send({ type: `test-category-${RUN_ID}`, value: `Option A ${RUN_ID}`, label: 'Option A' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.type).toBe(`test-category-${RUN_ID}`);
    expect(res.body.value).toBe(`Option A ${RUN_ID}`);
    expect(res.body.isActive).toBe(true);
    optionId = res.body.id;
    record('dropdown.create', true, `opt=${optionId}`);
  });

  it('POST /dropdown-options rejects duplicate (same type+value)', async () => {
    const res = await request
      .post('/api/dropdown-options')
      .set(authAs(ctx.userPhId))
      .send({ type: `test-category-${RUN_ID}`, value: `Option A ${RUN_ID}`, label: 'Duplicate' });
    expect(res.status).toBe(409);
    record('dropdown.duplicate', true, `409 as expected`);
  });

  it('GET /dropdown-options lists options by type', async () => {
    const res = await request
      .get('/api/dropdown-options')
      .set(authAs(ctx.userPhId))
      .query({ type: `test-category-${RUN_ID}` });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.some((o: { id: string }) => o.id === optionId)).toBe(true);
    record('dropdown.list', true, `count=${res.body.data.length}`);
  });

  it('PATCH /dropdown-options/:id toggles isActive to false', async () => {
    const res = await request.patch(`/api/dropdown-options/${optionId}`).set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
    const db = await prisma.dropdownOption.findUnique({ where: { id: optionId } });
    expect(db!.isActive).toBe(false);
    record('dropdown.toggleOff', true, `isActive=false`);
  });

  it('PATCH /dropdown-options/:id toggles isActive back to true', async () => {
    const res = await request.patch(`/api/dropdown-options/${optionId}`).set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(true);
    record('dropdown.toggleOn', true, `isActive=true`);
  });

  it('GET /dropdown-options filters by isActive=true', async () => {
    const res = await request
      .get('/api/dropdown-options')
      .set(authAs(ctx.userPhId))
      .query({ type: `test-category-${RUN_ID}`, isActive: 'true' });
    expect(res.status).toBe(200);
    for (const o of res.body.data) {
      expect(o.isActive).toBe(true);
    }
    record('dropdown.filterActive', true, `count=${res.body.data.length}`);
  });
});
