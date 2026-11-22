/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Paid PO → stock: when a PO's payment is marked PAID, whatever the PO still has to
 * receive is put into inventory through an automatic, already-posted goods receipt.
 * Prisma and the receipt posting code are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, posted, created, gatePassUpdates } = vi.hoisted(() => ({
  db: {
    requests: [] as any[],
    po: null as any,
    accepted: new Map<string, number>(),
    pending: new Map<string, number>(),
    stock: null as any,
    statusAfter: 'DELIVERED',
  },
  posted: [] as any[],
  created: [] as any[],
  gatePassUpdates: [] as any[],
}));

vi.mock('../src/config/prisma', () => {
  const tx = {
    $queryRaw: vi.fn(async () => []),
    purchaseOrder: {
      findUnique: vi.fn(async ({ select }: any) => (select?.items ? { status: db.po.status, items: db.po.items } : { status: db.statusAfter })),
    },
    goodsReceipt: {
      create: vi.fn(async ({ data }: any) => {
        created.push(data);
        return { id: 'grn-1' };
      }),
      findUniqueOrThrow: vi.fn(async () => ({ id: 'grn-1', items: [] })),
    },
    gatePass: { updateMany: vi.fn(async (args: any) => gatePassUpdates.push(args)) },
  };
  return {
    prisma: {
      paymentRequest: { findMany: vi.fn(async () => db.requests) },
      purchaseOrder: { findFirst: vi.fn(async () => db.po) },
      user: { findUnique: vi.fn(async () => ({ id: 'u-acc', name: 'Accounts' })) },
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    },
  };
});
vi.mock('../src/routes/goods-receipt.routes', () => ({
  generateReceiptNumber: vi.fn(async () => 'VGH-GRN009'),
  receiptPostInclude: {},
  receivedByPo: vi.fn(async () => ({ accepted: db.accepted, pending: db.pending })),
  serviceItemIdsFor: vi.fn(async () => new Set()),
  postReceiptLinesToStock: vi.fn(async (_tx: any, receipt: any, projectId: string, actor: any) => posted.push({ receipt, projectId, actor })),
}));
vi.mock('../src/services/inventory-match.service', () => ({
  findInventoryItemForMaterial: vi.fn(async () => db.stock),
}));
vi.mock('../src/services/audit.service', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('../src/services/push.service', () => ({ notifyAllHeads: vi.fn(async () => undefined) }));

import { receivePaidPoStock } from '../src/services/paid-po-stock.service';

const line = (id: string, materialName: string, quantity: number) => ({ id, materialName, quantity, itemId: `cat-${id}`, specification: null, unit: 'bags' });

describe('paid PO puts its materials into inventory', () => {
  beforeEach(() => {
    db.requests = [{ poId: 'po-1', invoice: null }];
    db.po = { id: 'po-1', poNumber: 'VGH-PO012', status: 'APPROVED', isContract: false, grandTotal: 1000, items: [line('l1', 'Cement', 100), line('l2', 'Sand', 10)] };
    db.accepted = new Map();
    db.pending = new Map();
    db.stock = null;
    db.statusAfter = 'DELIVERED';
    posted.length = 0;
    created.length = 0;
    gatePassUpdates.length = 0;
  });

  it('receives every outstanding line as a posted goods receipt', async () => {
    await receivePaidPoStock('p', ['pr-1'], 'u-acc');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ projectId: 'p', poId: 'po-1', receiptNumber: 'VGH-GRN009', status: 'POSTED', postedBy: 'u-acc' });
    expect(created[0].items.create.map((l: any) => [l.materialName, l.deliveredQty, l.acceptedQty])).toEqual([
      ['Cement', 100, 100],
      ['Sand', 10, 10],
    ]);
    expect(posted).toHaveLength(1);
    expect(posted[0].actor).toEqual({ id: 'u-acc', name: 'Accounts' });
    expect(gatePassUpdates).toHaveLength(1); // fully received: open gate passes stop being in transit
  });

  it('only receives what was not already received or waiting in an open receipt', async () => {
    db.accepted = new Map([['l1', 60]]);
    db.pending = new Map([['l1', 15], ['sand', 10]]);
    db.statusAfter = 'PARTIALLY_DELIVERED';
    await receivePaidPoStock('p', ['pr-1'], 'u-acc');
    expect(created[0].items.create.map((l: any) => [l.materialName, l.acceptedQty])).toEqual([['Cement', 25]]);
    expect(gatePassUpdates).toHaveLength(0);
  });

  it('keeps the stock type the material already has (asset stays asset)', async () => {
    db.stock = { itemType: 'ASSET' };
    await receivePaidPoStock('p', ['pr-1'], 'u-acc');
    expect(created[0].items.create.every((l: any) => l.itemType === 'ASSET')).toBe(true);
  });

  it('does nothing when everything was already received', async () => {
    db.accepted = new Map([['l1', 100], ['l2', 10]]);
    await receivePaidPoStock('p', ['pr-1'], 'u-acc');
    expect(created).toHaveLength(0);
    expect(posted).toHaveLength(0);
  });

  it('skips POs that are not approved and payments with no PO', async () => {
    db.po.status = 'PENDING_APPROVAL';
    await receivePaidPoStock('p', ['pr-1'], 'u-acc');
    db.po.status = 'APPROVED';
    db.requests = [{ poId: null, invoice: null }];
    await receivePaidPoStock('p', ['pr-1'], 'u-acc');
    expect(created).toHaveLength(0);
  });

  it('finds the PO through a paid invoice, and never throws', async () => {
    db.requests = [{ poId: null, invoice: { poId: 'po-1' } }];
    await receivePaidPoStock('p', ['pr-1'], 'u-acc');
    expect(created).toHaveLength(1);

    db.po = undefined as any;
    db.requests = undefined as any;
    await expect(receivePaidPoStock('p', ['pr-1'], 'u-acc')).resolves.toBeUndefined();
  });
});
