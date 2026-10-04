import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserRole } from '@hospital-erp/shared';

const user = { id: 'u1', name: 'Site Eng' };
const mocks = vi.hoisted(() => ({
  attachment: { findMany: vi.fn() },
  materialPurchaseRequest: { findFirst: vi.fn(), findMany: vi.fn() },
  quotation: { findFirst: vi.fn(), findMany: vi.fn() },
  purchaseOrder: { findFirst: vi.fn(), findMany: vi.fn() },
  goodsReceipt: { findFirst: vi.fn(), findMany: vi.fn() },
  vendorInvoice: { findFirst: vi.fn(), findMany: vi.fn() },
  paymentRequest: { findFirst: vi.fn(), findMany: vi.fn() },
}));
vi.mock('../src/config/prisma', () => ({ prisma: mocks }));

import { listLinkedFiles } from '../src/services/linked-files.service';

const att = (id: string, entityType: string, entityId: string, fileName: string) => ({
  id, entityType, entityId, fileName, mimeType: 'image/jpeg', fileType: 'IMAGE', description: null,
  createdAt: new Date('2026-01-01'), user,
});

describe('linked files across the procurement chain', () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) for (const f of Object.values(m)) f.mockReset().mockResolvedValue(f === (m as any).findFirst ? null : []);
  });

  it('shows an MPR photo on the PO raised from it (via the quotation)', async () => {
    mocks.purchaseOrder.findFirst.mockResolvedValue({ quotationId: 'q1', mprId: null });
    mocks.quotation.findFirst.mockResolvedValue({ mprId: 'm1' });
    mocks.materialPurchaseRequest.findFirst.mockResolvedValue({ id: 'm1' });
    mocks.materialPurchaseRequest.findMany.mockResolvedValue([{ id: 'm1', mprNumber: 'VGH-MPR001', receiptFilePath: null }]);
    mocks.quotation.findMany.mockResolvedValue([{ id: 'q1', quotationNumber: 'VGH-Q001', filePath: 'q.pdf', fileName: 'q.pdf', fileMimeType: 'application/pdf', createdAt: new Date('2026-01-02'), createdByUser: user }]);
    mocks.purchaseOrder.findMany.mockResolvedValue([{ id: 'po1', poNumber: 'VGH-PO001' }]);
    mocks.attachment.findMany.mockResolvedValue([att('a1', 'MATERIAL_PURCHASE_REQUEST', 'm1', 'site.jpg'), att('a2', 'MATERIAL_PURCHASE_REQUEST', 'm1', 'site2.jpg')]);

    const files = await listLinkedFiles('p1', UserRole.ADMIN, 'PURCHASE_ORDER', 'po1');

    expect(files!.map((f) => f.fileName).sort()).toEqual(['q.pdf', 'site.jpg', 'site2.jpg']);
    const mprFile = files!.find((f) => f.fileName === 'site.jpg')!;
    expect(mprFile).toMatchObject({ recordType: 'MPR', recordLabel: 'VGH-MPR001', own: false, canDelete: true });
    expect(mocks.attachment.findMany.mock.calls[0][0].where.projectId).toBe('p1');
  });

  it('returns null for a record outside the project / unknown type', async () => {
    expect(await listLinkedFiles('p1', UserRole.ADMIN, 'PURCHASE_ORDER', 'nope')).toBeNull();
    expect(await listLinkedFiles('p1', UserRole.ADMIN, 'WHATEVER', 'x')).toBeNull();
  });
});
