import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  payAgg: vi.fn(),
  poAgg: vi.fn(),
}));
vi.mock('../src/config/prisma', () => ({
  prisma: { payment: { aggregate: mocks.payAgg }, purchaseOrder: { aggregate: mocks.poAgg } },
}));

import { isPartPo, partPoBalance, EXCLUDE_PART_POS } from '../src/services/part-po.service';

describe('part POs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tells balance sub-POs from regenerated POs and normal POs', () => {
    expect(isPartPo({ parentPoId: 'x', regenerationNumber: 0 })).toBe(true);
    expect(isPartPo({ parentPoId: 'x', regenerationNumber: 1 })).toBe(false);
    expect(isPartPo({ parentPoId: null, regenerationNumber: 0 })).toBe(false);
  });

  it('exclusion filter matches the marker', () => {
    expect(EXCLUDE_PART_POS).toEqual({ NOT: { parentPoId: { not: null }, regenerationNumber: 0 } });
  });

  it('balance = total - paid - live sub-POs', async () => {
    mocks.payAgg.mockResolvedValue({ _sum: { amount: 50000 } });
    mocks.poAgg.mockResolvedValue({ _sum: { grandTotal: 0 } });
    expect(await partPoBalance({ id: 'p', grandTotal: 341700, netPayable: 341700 })).toEqual({
      total: 341700, paid: 50000, inSubPos: 0, remaining: 291700,
    });
    mocks.poAgg.mockResolvedValue({ _sum: { grandTotal: 291700 } });
    expect((await partPoBalance({ id: 'p', grandTotal: 341700, netPayable: 341700 })).remaining).toBe(0);
  });
});
