import { describe, it, expect } from 'vitest';
import { billableQuantity, lineBaseAmount, isValidHoursMinutes } from '@hospital-erp/shared';

describe('hour-unit billing (H.MM)', () => {
  it('9.15 hrs @ 1100 bills 9h15m', () => {
    expect(billableQuantity(9.15, 'hrs')).toBeCloseTo(9.25, 10);
    expect(lineBaseAmount(9.15, 1100, 'hrs')).toBe(10175);
  });
  it('whole hours and non-hour units are unchanged', () => {
    expect(lineBaseAmount(9, 1100, 'hrs')).toBe(9900);
    expect(lineBaseAmount(9.15, 1100, 'nos')).toBe(10065);
  });
  it('9.30 = 9.5h; fraction >= 60 stays decimal', () => {
    expect(billableQuantity(9.3, 'hour')).toBeCloseTo(9.5, 10);
    expect(billableQuantity(9.75, 'hrs')).toBe(9.75);
    expect(isValidHoursMinutes(9.6)).toBe(false);
  });
});
