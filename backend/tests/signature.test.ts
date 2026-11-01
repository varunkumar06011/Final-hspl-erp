import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  stepUpdate: vi.fn(),
  tx: vi.fn(),
}));

vi.mock('../src/config/prisma', () => ({
  prisma: {
    userSignature: { findUnique: mocks.findUnique },
    approvalSignature: { upsert: mocks.upsert },
    approvalStep: { update: mocks.stepUpdate },
    $transaction: mocks.tx,
  },
}));

import { normaliseSignature, applySignatureToStep, PO_SIGNING_ROLES, SignatureError } from '../src/services/signature.service';

async function drawing(w = 560, h = 240): Promise<string> {
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><path d="M60 150 C 90 40, 130 40, 150 120 S 230 190, 300 80" stroke="#101418" stroke-width="3" fill="none"/></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

describe('signature normalisation', () => {
  it('crops the margin and fits the fixed box', async () => {
    const out = await normaliseSignature(await drawing());
    const meta = await sharp(Buffer.from(out.split(',')[1], 'base64')).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width!).toBeLessThanOrEqual(480);
    expect(meta.height!).toBeLessThanOrEqual(160);
    expect(meta.width!).toBeLessThan(560); // empty margin removed
  });

  it('rejects non-PNG, oversized and blank input', async () => {
    await expect(normaliseSignature('data:image/jpeg;base64,AAAA')).rejects.toBeInstanceOf(SignatureError);
    await expect(normaliseSignature(undefined)).rejects.toBeInstanceOf(SignatureError);
    const big = `data:image/png;base64,${Buffer.alloc(500 * 1024).toString('base64')}`;
    await expect(normaliseSignature(big)).rejects.toBeInstanceOf(SignatureError);
    const blank = await sharp({ create: { width: 100, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    await expect(normaliseSignature(`data:image/png;base64,${blank.toString('base64')}`)).rejects.toBeInstanceOf(SignatureError);
  });
});

describe('applying a signature to an approval step', () => {
  beforeEach(() => vi.clearAllMocks());

  it('signs only the four PO roles', () => {
    expect(PO_SIGNING_ROLES).toEqual(['PROJECT_HEAD', 'HEAD_OF_CONSTRUCTION', 'ADMIN', 'ADMIN_2']);
  });

  it('snapshots the saved signature and flags the step', async () => {
    mocks.findUnique.mockResolvedValue({ imageData: 'data:image/png;base64,QQ==' });
    mocks.upsert.mockReturnValue('upsert');
    mocks.stepUpdate.mockReturnValue('update');
    mocks.tx.mockResolvedValue([]);
    expect(await applySignatureToStep('step1', 'user1')).toBe(true);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { stepId: 'step1', imageData: 'data:image/png;base64,QQ==' } }));
    expect(mocks.stepUpdate).toHaveBeenCalledWith({ where: { id: 'step1' }, data: { digitallySigned: true } });
  });

  it('does nothing when the approver has no saved signature', async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect(await applySignatureToStep('step1', 'user1')).toBe(false);
    expect(mocks.tx).not.toHaveBeenCalled();
  });
});
