import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserRole } from '@hospital-erp/shared';

const user = { id: 'u1', name: 'Site Eng' };
const mocks = vi.hoisted(() => ({
  attachment: { findMany: vi.fn() },
  purchaseOrder: { findMany: vi.fn() },
  quotation: { findMany: vi.fn() },
  vendorInvoice: { findMany: vi.fn() },
  paymentRequest: { findMany: vi.fn() },
  paymentSheet: { findMany: vi.fn() },
  materialPurchaseRequest: { findMany: vi.fn() },
  document: { findMany: vi.fn() },
}));
vi.mock('../src/config/prisma', () => ({ prisma: mocks }));

import { listLibrary } from '../src/services/document-library.service';

describe('document library', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.findMany.mockReset().mockResolvedValue([]));
  });

  it('links an uploaded file to the PO it belongs to and scopes by project', async () => {
    mocks.attachment.findMany.mockResolvedValue([
      { id: 'a1', entityType: 'PURCHASE_ORDER', entityId: 'po1', fileName: 'delivery.jpg', mimeType: 'image/jpeg', fileType: 'IMAGE', description: null, createdAt: new Date('2026-01-02'), user },
    ]);
    mocks.purchaseOrder.findMany.mockResolvedValue([{ id: 'po1', poNumber: 'VGH-PO001' }]);

    const items = await listLibrary('proj1', UserRole.ADMIN, {});

    expect(mocks.attachment.findMany.mock.calls[0][0].where.projectId).toBe('proj1');
    expect(mocks.purchaseOrder.findMany.mock.calls[0][0].where.projectId).toBe('proj1');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      category: 'PURCHASE_ORDER',
      linkedLabel: 'VGH-PO001',
      linkedPath: '/pos?id=po1',
      uploadedBy: user,
      fileRoute: '/attachments/a1/file',
    });
  });

  it('includes files stored on records, newest first', async () => {
    mocks.attachment.findMany.mockResolvedValue([
      { id: 'a1', entityType: 'PURCHASE_ORDER', entityId: 'po1', fileName: 'old.pdf', mimeType: 'application/pdf', fileType: 'DOCUMENT', description: null, createdAt: new Date('2026-01-01'), user },
    ]);
    mocks.purchaseOrder.findMany.mockResolvedValue([{ id: 'po1', poNumber: 'VGH-PO001' }]);
    mocks.quotation.findMany.mockResolvedValue([
      { id: 'q1', quotationNumber: 'VGH-Q001', fileName: 'quote.pdf', fileMimeType: 'application/pdf', createdAt: new Date('2026-02-01'), createdByUser: user },
    ]);

    const items = await listLibrary('proj1', UserRole.ADMIN, {});
    expect(items.map((i) => i.fileName)).toEqual(['quote.pdf', 'old.pdf']);
    expect(items[0]).toMatchObject({ category: 'QUOTATION', linkedLabel: 'VGH-Q001', canDelete: false });
  });

  it('hides financial records from roles without VIEW_FINANCIALS', async () => {
    const items = await listLibrary('proj1', UserRole.SITE_SUPERVISOR, {});
    expect(items).toEqual([]);
    expect(mocks.quotation.findMany).not.toHaveBeenCalled();
    expect(mocks.vendorInvoice.findMany).not.toHaveBeenCalled();
    const where = mocks.attachment.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('PURCHASE_ORDER');
  });

  it('filters by search text across file name, record number and uploader', async () => {
    mocks.attachment.findMany.mockResolvedValue([
      { id: 'a1', entityType: 'PURCHASE_ORDER', entityId: 'po1', fileName: 'a.pdf', mimeType: 'application/pdf', fileType: 'DOCUMENT', description: null, createdAt: new Date(), user },
      { id: 'a2', entityType: 'PURCHASE_ORDER', entityId: 'po2', fileName: 'b.pdf', mimeType: 'application/pdf', fileType: 'DOCUMENT', description: null, createdAt: new Date(), user },
    ]);
    mocks.purchaseOrder.findMany.mockResolvedValue([{ id: 'po1', poNumber: 'VGH-PO001' }, { id: 'po2', poNumber: 'VGH-PO002' }]);
    const items = await listLibrary('proj1', UserRole.ADMIN, { search: 'po002' });
    expect(items.map((i) => i.id)).toEqual(['a2']);
  });
});
