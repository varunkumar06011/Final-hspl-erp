import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  proofNumber: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  fileFingerprint: { findMany: vi.fn(), create: vi.fn() },
  duplicateFlag: { create: vi.fn(), findFirst: vi.fn() },
  user: { findUnique: vi.fn(), findMany: vi.fn() },
  appNotification: { createMany: vi.fn() },
  attachment: { findFirst: vi.fn() },
  materialPurchaseRequest: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
  quotation: { findFirst: vi.fn() },
  vendorInvoice: { findFirst: vi.fn(), findMany: vi.fn() },
  gatePass: { findFirst: vi.fn() },
  paymentRequest: { findFirst: vi.fn() },
}));
vi.mock('../src/config/prisma', () => ({ prisma: db }));
vi.mock('../src/services/push.service', () => ({ notifyUsers: vi.fn() }));
vi.mock('../src/services/storage.service', () => ({ getStorageService: vi.fn() }));

import { startUploadContext, withUploadGuard, checkSiteBillDuplicate } from '../src/services/duplicate.service';

const inner = {
  upload: vi.fn(async (_f: Buffer, name: string, mime: string) => ({ filePath: `/u/${name}`, fileName: name, mimeType: mime, size: 3 })),
  getFile: vi.fn(),
  deleteFile: vi.fn(),
  getSignedUrl: vi.fn(),
};

/** Runs `fn` inside an upload context the way the auth middleware would start it. */
function inContext<T>(proofHeader: string | null, fn: () => Promise<T>): Promise<{ out: T; json: unknown }> {
  return new Promise((resolve, reject) => {
    const res: any = { statusCode: 200, json: (b: unknown) => ((res.sent = b), b) };
    const req: any = { user: { id: 'u1', name: 'Ravi', projectId: 'p1' }, method: 'POST', header: (n: string) => (n === 'x-proof-number' ? proofHeader ?? undefined : undefined) };
    startUploadContext(req, res, () => {
      fn().then((out) => {
        res.json({ id: 'rec' });
        resolve({ out, json: res.sent });
      }, reject);
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.fileFingerprint.findMany.mockResolvedValue([]);
  db.fileFingerprint.create.mockResolvedValue({ id: 'fp-new' });
  db.duplicateFlag.create.mockResolvedValue({});
  db.user.findMany.mockResolvedValue([]);
  db.user.findUnique.mockResolvedValue({ name: 'Sita' });
  db.attachment.findFirst.mockResolvedValue(null);
  db.materialPurchaseRequest.findFirst.mockResolvedValue(null);
  db.quotation.findFirst.mockResolvedValue(null);
  db.vendorInvoice.findFirst.mockResolvedValue(null);
  db.gatePass.findFirst.mockResolvedValue(null);
  db.paymentRequest.findFirst.mockResolvedValue(null);
});

describe('upload guard', () => {
  it('fingerprints a new file and adds no warning', async () => {
    const storage = withUploadGuard(inner);
    const { json } = await inContext(null, () => storage.upload(Buffer.from('abc'), 'bill.jpg', 'image/jpeg', 'documents'));
    expect(db.fileFingerprint.create).toHaveBeenCalledOnce();
    expect(db.fileFingerprint.create.mock.calls[0][0].data.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(db.duplicateFlag.create).not.toHaveBeenCalled();
    expect(json).toEqual({ id: 'rec' });
  });

  it('flags a file that already exists, still stores it, and warns in the response', async () => {
    db.fileFingerprint.findMany.mockResolvedValue([{ id: 'fp-old', fileName: 'old.jpg', filePath: '/u/old.jpg', uploadedBy: 'u2', createdAt: new Date('2026-11-01') }]);
    const storage = withUploadGuard(inner);
    const { json } = await inContext(null, () => storage.upload(Buffer.from('abc'), 'again.jpg', 'image/jpeg', 'documents'));
    expect(inner.upload).toHaveBeenCalledOnce();
    expect(db.duplicateFlag.create.mock.calls[0][0].data).toMatchObject({ kind: 'FILE', projectId: 'p1', matchedFingerprintId: 'fp-old' });
    expect((json as any).duplicateWarning[0].kind).toBe('FILE');
  });

  it('refuses an unknown proof number before anything is stored', async () => {
    db.proofNumber.findUnique.mockResolvedValue(null);
    const storage = withUploadGuard(inner);
    await expect(inContext('VGH-MPR001-P9', () => storage.upload(Buffer.from('x'), 'b.jpg', 'image/jpeg', 'documents'))).rejects.toThrow(/not found/);
    expect(inner.upload).not.toHaveBeenCalled();
  });

  it('binds a fresh proof number to the upload', async () => {
    db.proofNumber.findUnique.mockResolvedValue({ id: 'pn1', number: 'VGH-MPR001-P1', usedAt: null });
    db.proofNumber.updateMany.mockResolvedValue({ count: 1 });
    const storage = withUploadGuard(inner);
    await inContext('vgh-mpr001-p1', () => storage.upload(Buffer.from('x'), 'b.jpg', 'image/jpeg', 'documents'));
    expect(db.proofNumber.updateMany).toHaveBeenCalledOnce();
    expect(db.duplicateFlag.create).not.toHaveBeenCalled();
  });

  it('flags a proof number that was already used, without blocking', async () => {
    db.proofNumber.findUnique.mockResolvedValue({ id: 'pn1', number: 'VGH-MPR001-P1', usedAt: new Date() });
    db.proofNumber.updateMany.mockResolvedValue({ count: 0 });
    const storage = withUploadGuard(inner);
    const { json } = await inContext('VGH-MPR001-P1', () => storage.upload(Buffer.from('x'), 'b.jpg', 'image/jpeg', 'documents'));
    expect(db.duplicateFlag.create.mock.calls[0][0].data.kind).toBe('PROOF_REUSE');
    expect((json as any).duplicateWarning[0].kind).toBe('PROOF_REUSE');
  });

  it('leaves logos alone', async () => {
    const storage = withUploadGuard(inner);
    await inContext(null, () => storage.upload(Buffer.from('x'), 'logo.png', 'image/png', 'logos'));
    expect(db.fileFingerprint.create).not.toHaveBeenCalled();
  });
});

describe('soft duplicates', () => {
  const bill = { id: 'b2', projectId: 'p1', mprNumber: 'VGH-MPR021', billShopName: 'Sri Hardware', billDate: new Date('2026-11-10'), date: new Date('2026-11-10'), estimatedTotal: 1200 };

  it('flags the same shop and amount within a week', async () => {
    db.materialPurchaseRequest.findMany.mockResolvedValue([{ id: 'b1', mprNumber: 'VGH-MPR020', billDate: new Date('2026-11-08'), date: new Date('2026-11-08') }]);
    db.duplicateFlag.findFirst.mockResolvedValue(null);
    await checkSiteBillDuplicate(bill, 'u1');
    expect(db.duplicateFlag.create.mock.calls[0][0].data).toMatchObject({ kind: 'AMOUNT', entityId: 'b2', matchedEntityId: 'b1', amount: 1200 });
  });

  it('ignores a match more than a week away', async () => {
    db.materialPurchaseRequest.findMany.mockResolvedValue([{ id: 'b1', mprNumber: 'VGH-MPR020', billDate: new Date('2026-10-20'), date: new Date('2026-10-20') }]);
    await checkSiteBillDuplicate(bill, 'u1');
    expect(db.duplicateFlag.create).not.toHaveBeenCalled();
  });
});
