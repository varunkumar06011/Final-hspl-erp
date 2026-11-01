import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/prisma', () => ({ prisma: {} }));
vi.mock('../src/routes/mpr.routes', () => ({ mprInclude: {} }));

import { proofFormatOf } from '../src/services/combined-proofs.service';

describe('proofFormatOf', () => {
  it('treats image mime types and image extensions as images', () => {
    expect(proofFormatOf('image/jpeg', 'bill')).toBe('image');
    expect(proofFormatOf(null, 'IMG_0012.HEIC')).toBe('image');
  });
  it('treats PDFs as pdf by mime or extension', () => {
    expect(proofFormatOf('application/pdf', 'x')).toBe('pdf');
    expect(proofFormatOf(null, 'invoice.PDF')).toBe('pdf');
  });
  it('everything else cannot be previewed or merged', () => {
    expect(proofFormatOf('application/vnd.ms-excel', 'sheet.xls')).toBe('other');
  });
});
