/**
 * Auth Schema Tests
 * =================
 *
 * Auth is the most security-sensitive part of the app. A loose schema here means
 * an attacker can create accounts with privileged roles, bypass PIN validation,
 * or send malformed phone numbers that break Firebase lookups.
 *
 * The auth flow has three paths:
 *  1. Firebase OTP login — the user enters their phone, Firebase sends an OTP,
 *     the frontend sends the Firebase ID token to the backend for verification.
 *  2. PIN login — a fallback when Firebase OTP is down. The user enters their
 *     phone + a 4-digit PIN they set earlier. No OTP needed.
 *  3. Pre-provisioned user creation — a Project Head creates a user account
 *     (with a specific role) before that person ever logs in. When the person
 *     logs in via Firebase OTP, they're matched to the pre-provisioned row.
 *
 * These tests verify the Zod schemas that gate every auth endpoint.
 */
import { describe, it, expect } from 'vitest';
import {
  verifyTokenSchema,
  registerTokenSchema,
  pinLoginSchema,
  setPinSchema,
  changePinSchema,
  checkPinSchema,
  createUserSchema,
  updateUserSchema,
  listUsersSchema,
  userResponseSchema,
} from '@hospital-erp/shared';
import { UserRole } from '@hospital-erp/shared';

// A valid UUID used throughout the tests.
const id = '11111111-1111-4111-8111-111111111111';

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN VERIFICATION & SELF-REGISTRATION
// ─────────────────────────────────────────────────────────────────────────────
describe('Auth schemas — Firebase token verification & self-registration', () => {
  it('verifyTokenSchema requires an idToken (every authenticated request starts with a Firebase ID token)', () => {
    expect(() => verifyTokenSchema.parse({ body: {} })).toThrow();
    expect(
      verifyTokenSchema.parse({ body: { idToken: 'tok' } }).body.idToken
    ).toBe('tok');
  });

  it('verifyTokenSchema accepts an optional name (set on first login, ignored on subsequent logins)', () => {
    // On the very first login, the frontend sends the user's name so the
    // backend can store it. On subsequent logins, the name is omitted.
    const parsed = verifyTokenSchema.parse({ body: { idToken: 'tok', name: 'Alice' } });
    expect(parsed.body.name).toBe('Alice');
  });

  it('registerTokenSchema requires both an idToken and a non-empty trimmed name', () => {
    // Self-registration (a supervisor joining an active project) requires a
    // name — it's used in audit logs and in the "addressed to" dropdown.
    // Whitespace-only names are rejected after trimming.
    expect(() => registerTokenSchema.parse({ body: { idToken: 'tok' } })).toThrow();
    expect(() =>
      registerTokenSchema.parse({ body: { idToken: 'tok', name: '   ' } })
    ).toThrow();
    expect(
      registerTokenSchema.parse({ body: { idToken: 'tok', name: 'Bob' } }).body.name
    ).toBe('Bob');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PIN LOGIN & MANAGEMENT — the fallback auth path when Firebase OTP is down.
// ─────────────────────────────────────────────────────────────────────────────
describe('Auth schemas — PIN login & management (fallback auth path)', () => {
  it('pinLoginSchema requires a 10+ digit phone and exactly a 4-digit numeric PIN', () => {
    // PIN login is the fallback when Firebase OTP is down. The phone must be
    // long enough to be a real number, and the PIN must be exactly 4 digits
    // (not 3, not 5, not letters).
    expect(() => pinLoginSchema.parse({ body: { phone: '123', pin: '1234' } })).toThrow(); // phone too short
    expect(() =>
      pinLoginSchema.parse({ body: { phone: '+919999999999', pin: '12345' } })
    ).toThrow(); // PIN too long
    expect(() =>
      pinLoginSchema.parse({ body: { phone: '+919999999999', pin: 'abcd' } })
    ).toThrow(); // PIN not numeric

    const parsed = pinLoginSchema.parse({ body: { phone: '+919999999999', pin: '1234' } });
    expect(parsed.body.pin).toBe('1234');
  });

  it('setPinSchema enforces the same 4-digit PIN rules as pinLoginSchema', () => {
    // Consistency: every PIN in the system is exactly 4 digits.
    expect(() => setPinSchema.parse({ body: { phone: '+919999999999', pin: '12' } })).toThrow();
    expect(
      setPinSchema.parse({ body: { phone: '+919999999999', pin: '0000' } }).body.pin
    ).toBe('0000');
  });

  it('changePinSchema requires both oldPin and newPin as exactly 4 digits', () => {
    // Changing a PIN requires knowing the old one (proof of identity).
    expect(() =>
      changePinSchema.parse({ body: { oldPin: '1234', newPin: '123' } })
    ).toThrow(); // newPin too short
    expect(() =>
      changePinSchema.parse({ body: { oldPin: '123', newPin: '1234' } })
    ).toThrow(); // oldPin too short
    const parsed = changePinSchema.parse({ body: { oldPin: '1234', newPin: '5678' } });
    expect(parsed.body.oldPin).toBe('1234');
    expect(parsed.body.newPin).toBe('5678');
  });

  it('checkPinSchema requires a phone number in the query string', () => {
    // The login flow calls this to decide whether to show the PIN screen
    // (if a PIN is set) or the Firebase OTP screen (if no PIN is set).
    expect(() => checkPinSchema.parse({ query: {} })).toThrow();
    expect(checkPinSchema.parse({ query: { phone: '+919999999999' } }).query.phone).toBe(
      '+919999999999'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// USER MANAGEMENT — pre-provisioned user creation by a Project Head.
// ─────────────────────────────────────────────────────────────────────────────
describe('Auth schemas — user management (pre-provisioned accounts)', () => {
  it('createUserSchema requires a valid phone, name, role, and projectId', () => {
    // A Project Head pre-provisions users before they log in. All four fields
    // are required — a user without a role can't do anything, and a user
    // without a projectId can't see any data.
    expect(() =>
      createUserSchema.parse({ body: { name: 'A', role: UserRole.ADMIN } })
    ).toThrow(); // missing phone and projectId
    expect(() =>
      createUserSchema.parse({
        body: { name: 'A', role: UserRole.ADMIN, projectId: 'bad', phone: '+919999999999' },
      })
    ).toThrow(); // invalid projectId
    expect(() =>
      createUserSchema.parse({
        body: { name: 'A', role: 'NOT_A_ROLE', projectId: id, phone: '+919999999999' },
      })
    ).toThrow(); // invalid role

    const parsed = createUserSchema.parse({
      body: {
        name: 'Alice',
        role: UserRole.PROJECT_HEAD,
        projectId: id,
        phone: '+919999999999',
      },
    });
    expect(parsed.body.role).toBe(UserRole.PROJECT_HEAD);
  });

  it('createUserSchema rejects phone numbers containing spaces or dashes (must be E.164-compatible)', () => {
    // Phone numbers are stored in E.164 format (+919999999999). Spaces or
    // dashes would break the Firebase phone lookup (Firebase normalizes to
    // E.164, but our DB stores the raw string for matching).
    expect(() =>
      createUserSchema.parse({
        body: { name: 'A', role: UserRole.ADMIN, projectId: id, phone: '+91 999 999 9999' },
      })
    ).toThrow();
  });

  it('updateUserSchema requires a UUID params.id (prevents updating a non-existent user)', () => {
    expect(() =>
      updateUserSchema.parse({ params: { id: 'no' }, body: { isActive: false } })
    ).toThrow();
    const parsed = updateUserSchema.parse({ params: { id }, body: { isActive: false } });
    expect(parsed.body.isActive).toBe(false);
  });

  it('updateUserSchema accepts a partial role update (e.g. promoting a Supervisor to Project Head)', () => {
    const parsed = updateUserSchema.parse({
      params: { id },
      body: { role: UserRole.ADMIN_2 },
    });
    expect(parsed.body.role).toBe(UserRole.ADMIN_2);
  });

  it('listUsersSchema coerces pagination params and applies defaults (page=1, pageSize=20)', () => {
    const parsed = listUsersSchema.parse({ query: {} });
    expect(parsed.query.page).toBe(1);
    expect(parsed.query.pageSize).toBe(20);
  });

  it('listUsersSchema caps pageSize at 100 (prevents loading the entire users table)', () => {
    expect(() => listUsersSchema.parse({ query: { pageSize: 200 } })).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RESPONSE SCHEMA — the shape of the user object returned to the frontend.
// ─────────────────────────────────────────────────────────────────────────────
describe('Auth schemas — userResponseSchema (the user profile shape)', () => {
  it('validates a complete user response object with all fields present', () => {
    // The frontend relies on this exact shape to render the user profile
    // screen, the header avatar, and the role-based navigation menu.
    const user = {
      id,
      firebaseUid: 'fb-1',
      phone: '+919999999999',
      name: 'Alice',
      role: UserRole.ADMIN,
      projectId: id,
      isActive: true,
    };
    expect(userResponseSchema.parse(user)).toEqual(user);
  });

  it('accepts a null projectId (an admin without a project assignment)', () => {
    // A platform-level admin (not tied to a specific hospital project) has
    // projectId: null. The frontend shows them a project picker instead of
    // auto-selecting a project.
    const parsed = userResponseSchema.parse({
      id,
      firebaseUid: 'fb-1',
      phone: '+919999999999',
      name: 'Alice',
      role: UserRole.ADMIN,
      projectId: null,
      isActive: true,
    });
    expect(parsed.projectId).toBeNull();
  });

  it('rejects an invalid id (not a UUID) — prevents the frontend from using a malformed user ID', () => {
    expect(() =>
      userResponseSchema.parse({
        id: 'not-a-uuid',
        firebaseUid: 'fb-1',
        phone: '+919999999999',
        name: 'Alice',
        role: UserRole.ADMIN,
        projectId: id,
        isActive: true,
      })
    ).toThrow();
  });
});
