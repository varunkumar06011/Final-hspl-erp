import sharp from 'sharp';
import { PO_SIGNING_ROLES } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';

export { PO_SIGNING_ROLES };

const MAX_UPLOAD_BYTES = 400 * 1024;
// Every stored signature fits the same box so they print at one size.
const OUT_W = 480;
const OUT_H = 160;

export class SignatureError extends Error {}

/**
 * Takes the canvas PNG (data URL), crops the empty margin, scales it to fit a fixed
 * box (never enlarging a small signature past the box) and returns a PNG data URL.
 */
export async function normaliseSignature(dataUrl: unknown): Promise<string> {
  if (typeof dataUrl !== 'string') throw new SignatureError('Signature is required');
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new SignatureError('Signature must be a PNG image');
  const raw = Buffer.from(m[1], 'base64');
  if (raw.length === 0 || raw.length > MAX_UPLOAD_BYTES) throw new SignatureError('Signature image is too large');

  let out: Buffer;
  try {
    // A canvas nobody drew on is fully transparent: refuse it.
    const alpha = await sharp(raw).ensureAlpha().extractChannel(3).stats();
    if (alpha.channels[0].max === 0) throw new SignatureError('Please draw your signature');
    out = await sharp(raw)
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 10 })
      .resize({ width: OUT_W - 8, height: OUT_H - 8, fit: 'inside' })
      .extend({ top: 4, bottom: 4, left: 4, right: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch (err) {
    if (err instanceof SignatureError) throw err;
    throw new SignatureError('Please draw your signature');
  }
  return `data:image/png;base64,${out.toString('base64')}`;
}

/** The picture as a Buffer for the PDF. */
export function signatureBuffer(dataUrl: string | null | undefined): Buffer | null {
  if (!dataUrl) return null;
  const i = dataUrl.indexOf('base64,');
  if (i < 0) return null;
  try {
    return Buffer.from(dataUrl.slice(i + 7), 'base64');
  } catch {
    return null;
  }
}

/**
 * Called right after a PO approval step was decided by `user` in their own role (never for a
 * super-admin override). Copies the approver's current signature onto the step, if they have one.
 */
export async function applySignatureToStep(stepId: string, userId: string): Promise<boolean> {
  const saved = await prisma.userSignature.findUnique({ where: { userId } });
  if (!saved) return false;
  await prisma.$transaction([
    prisma.approvalSignature.upsert({
      where: { stepId },
      create: { stepId, imageData: saved.imageData },
      update: { imageData: saved.imageData },
    }),
    prisma.approvalStep.update({ where: { id: stepId }, data: { digitallySigned: true } }),
  ]);
  return true;
}
