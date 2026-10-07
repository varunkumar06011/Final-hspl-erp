import { describe, it, expect } from 'vitest';
import {
  fuzzyFilter,
  fuzzyScore,
  findApprovableStep,
  isWorkflowOpenToRole,
  isModuleEnabled,
  APP_MODULES,
  UserRole,
} from '@hospital-erp/shared';

describe('fuzzy matching', () => {
  const vendors = ['Sri Lakshmi Traders', 'Vijaya Cement Agencies', 'Balaji Steel Works', 'JCB Hire Services'];

  it('finds a vendor despite spelling mistakes', () => {
    expect(fuzzyFilter(vendors, 'laxmi tradrs', (v) => [v])[0]).toBe('Sri Lakshmi Traders');
    expect(fuzzyFilter(vendors, 'lakshmi tradrs', (v) => [v])[0]).toBe('Sri Lakshmi Traders');
    expect(fuzzyFilter(vendors, 'vijaya cemnt', (v) => [v])[0]).toBe('Vijaya Cement Agencies');
  });

  it('matches partial words and ignores case', () => {
    expect(fuzzyFilter(vendors, 'BALA', (v) => [v])).toEqual(['Balaji Steel Works']);
    expect(fuzzyFilter(vendors, 'jcb', (v) => [v])).toEqual(['JCB Hire Services']);
  });

  it('requires every typed word to match', () => {
    expect(fuzzyScore('balaji concrete', 'Balaji Steel Works')).toBeNull();
  });

  it('returns everything for an empty query', () => {
    expect(fuzzyFilter(vendors, '  ', (v) => [v])).toHaveLength(4);
  });
});

describe('super admin approvals', () => {
  const steps = [
    { stepNumber: 1, approverRole: UserRole.PROJECT_HEAD, status: 'PENDING' },
    { stepNumber: 2, approverRole: UserRole.HEAD_OF_CONSTRUCTION, status: 'PENDING' },
    { stepNumber: 3, approverRole: UserRole.ADMIN, status: 'PENDING' },
  ];

  it('an admin only gets their own step', () => {
    expect(findApprovableStep(steps, { role: UserRole.ADMIN })?.stepNumber).toBe(3);
    expect(findApprovableStep(steps, { role: UserRole.ACCOUNTANT })).toBeUndefined();
  });

  it('a super admin gets the earliest pending step, whatever their role', () => {
    expect(findApprovableStep(steps, { role: UserRole.ADMIN, extraPermissions: ['*'] })?.stepNumber).toBe(1);
    expect(findApprovableStep(steps, { role: UserRole.ACCOUNTANT, extraPermissions: ['*'] })?.stepNumber).toBe(1);
  });

  it('a super admin can act before a head has approved', () => {
    const wf = { approvalPolicy: 'HEAD_THEN_ADMIN', steps };
    expect(isWorkflowOpenToRole(wf, UserRole.ADMIN)).toBe(false);
    expect(isWorkflowOpenToRole(wf, UserRole.ADMIN, ['*'])).toBe(true);
  });

  it('a super admin has every module, even ones hidden for the role by default', () => {
    for (const m of APP_MODULES) {
      expect(isModuleEnabled({ role: UserRole.ADMIN, extraPermissions: ['*'] }, m.key)).toBe(true);
    }
  });
});
