/**
 * Scenario 11: Contract & Labour Management
 *
 * vendor → contract with milestones → activate → staff (LABOUR)
 *   → mark attendance → verify cross-links
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, prisma, request, makeReporter } from './_helpers';

const RUN_ID = `ctr-${Date.now()}`;
const { record, printReport } = makeReporter('CONTRACT & LABOUR', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;
let vendorId = '';
let contractId = '';
let staffId = '';

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[CONTRACT] run=${RUN_ID} project=${ctx.projectName}`);
});

afterAll(() => printReport());

describe('Contract & Labour', () => {
  it('creates a vendor for the contract', async () => {
    const res = await request
      .post('/api/vendors')
      .set(authAs(ctx.userPhId))
      .send({
        name: `Contractor Vendor ${RUN_ID}`,
        vendorCode: `CV-${RUN_ID}`,
        phone: '+919900000004',
        email: `ctr-${RUN_ID}@test.com`,
        address: 'Contractor Address',
        materials: [{ name: `Labour Service ${RUN_ID}`, unit: 'service' }],
        acknowledged: true,
      });
    expect(res.status).toBe(201);
    vendorId = res.body.id;
    record('vendor.create', true, `vendor=${vendorId}`);
  });

  it('creates a contract with 3 milestones', async () => {
    const res = await request
      .post('/api/contracts')
      .set(authAs(ctx.userPhId))
      .send({
        vendorId,
        type: 'Civil Works',
        startDate: new Date().toISOString().slice(0, 10),
        value: 5000000,
        advancePercent: 10,
        retentionPercent: 5,
        milestones: [
          { name: 'Mobilization', amount: 500000 },
          { name: 'Foundation', amount: 2000000 },
          { name: 'Completion', amount: 2500000 },
        ],
      });
    expect(res.status).toBe(201);
    contractId = res.body.id;
    const db = await prisma.contract.findUnique({ where: { id: contractId }, include: { milestones: true } });
    expect(db!.status).toBe('DRAFT');
    expect(db!.milestones.length).toBe(3);
    record('contract.create', true, `contract=${contractId} milestones=3`);
  });

  it('activates the contract', async () => {
    const res = await request
      .patch(`/api/contracts/${contractId}`)
      .set(authAs(ctx.userPhId))
      .send({ status: 'ACTIVE' });
    expect(res.status).toBe(200);
    const db = await prisma.contract.findUnique({ where: { id: contractId } });
    expect(db!.status).toBe('ACTIVE');
    record('contract.activate', true, `status=ACTIVE`);
  });

  it('creates a LABOUR staff member', async () => {
    const res = await request
      .post('/api/labour/staff')
      .set(authAs(ctx.userPhId))
      .send({ name: `Ramesh Labour ${RUN_ID}`, type: 'LABOUR', role: 'Mason', phone: '+919812345678', baseSalary: 800 });
    expect(res.status).toBe(201);
    staffId = res.body.id;
    record('staff.create', true, `staff=${staffId} type=LABOUR`);
  });

  it('marks attendance for the staff member (present)', async () => {
    const res = await request
      .post('/api/labour/attendance')
      .set(authAs(ctx.userPhId))
      .send({
        date: new Date().toISOString().slice(0, 10),
        records: [{ staffId, present: true, notes: 'On site' }],
      });
    expect(res.status).toBe(201);
    const att = await prisma.staffAttendance.findFirst({ where: { staffId } });
    expect(att!.present).toBe(true);
    record('attendance.mark', true, `staff=${staffId} present=true`);
  });

  it('verifies contract links to vendor + staff links to project', async () => {
    const [contract, staff] = await Promise.all([
      prisma.contract.findUnique({ where: { id: contractId }, include: { vendor: true } }),
      prisma.staff.findUnique({ where: { id: staffId } }),
    ]);
    expect(contract!.vendor.id).toBe(vendorId);
    expect(staff!.projectId).toBe(ctx.projectId);
    record('crosslink.verify', true, `contractVendor=${contract!.vendor.id} staffProject=${staff!.projectId}`);
  });

  it('verifies all entities persisted in DB', async () => {
    const checks = await Promise.all([
      prisma.vendor.findUnique({ where: { id: vendorId } }),
      prisma.contract.findUnique({ where: { id: contractId } }),
      prisma.staff.findUnique({ where: { id: staffId } }),
    ]);
    expect(checks.every((c) => c !== null)).toBe(true);
    record('all.persisted', true, 'vendor + contract + staff verified');
  });
});
