/**
 * OTP Service Tests
 * =================
 *
 * The OTP service issues and verifies 4-digit one-time passwords for gate passes.
 * When a supervisor creates a gate pass, an OTP is generated and (in production) sent
 * to the security guard via Firebase SMS. When the truck arrives, the guard enters
 * the OTP to approve the gate pass.
 *
 * Until Firebase SMS is wired up, the service uses a fixed fallback code "1234" so
 * the gate-pass flow can be tested end-to-end. These tests pin that contract so we
 * notice the moment production OTP generation is enabled.
 *
 * Security properties verified:
 *  - OTPs expire after 10 minutes (a truck arriving an hour late needs a new code)
 *  - After 5 wrong attempts the OTP is deleted (brute-force protection)
 *  - A successful verification consumes the OTP (one code = one entry, no replay)
 *  - Unknown gate-pass IDs always fail (can't guess codes against unissued passes)
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  generateOtp,
  verifyOtp,
  getOtpForLogging,
  clearOtp,
  FALLBACK_OTP,
} from '../src/services/otp.service';

describe('OTP Service — gate-pass one-time passwords', () => {
  beforeEach(() => {
    // Clear any OTP state between tests so each test starts from a clean slate.
    clearOtp('gate-pass-1');
    clearOtp('gate-pass-2');
    clearOtp('gate-pass-3');
    clearOtp('gate-pass-expiry');
    clearOtp('gate-pass-attempts');
    vi.useRealTimers();
  });

  afterEach(() => {
    // Always restore real timers in case a test used fake timers.
    vi.useRealTimers();
  });

  it('generates the fallback OTP "1234" and stores it against the gate-pass ID', () => {
    // The fallback code is a temporary dev convenience. This test will fail
    // once real random OTPs are enabled — which is exactly the signal we want.
    const otp = generateOtp('gate-pass-1');
    expect(otp).toBe(FALLBACK_OTP);
    expect(otp).toBe('1234');
    // The OTP should be retrievable for logging (used in dev to show the code on screen).
    expect(getOtpForLogging('gate-pass-1')).toBe('1234');
  });

  it('verifies successfully when the guard enters the correct OTP', () => {
    // Happy path: supervisor requests gate pass → guard types in 1234 → approved.
    generateOtp('gate-pass-2');
    expect(verifyOtp('gate-pass-2', '1234')).toBe(true);
    // After a successful verification the OTP is consumed — it can't be reused.
    expect(getOtpForLogging('gate-pass-2')).toBeUndefined();
  });

  it('rejects verification for a gate pass that was never issued an OTP', () => {
    // Prevents an attacker from guessing OTPs against arbitrary gate-pass IDs.
    expect(verifyOtp('unknown-gate-pass', '1234')).toBe(false);
  });

  it('rejects a wrong OTP but keeps the OTP alive for another attempt', () => {
    // A typo shouldn't burn the OTP — the guard gets to retry (up to 5 times).
    generateOtp('gate-pass-3');
    expect(verifyOtp('gate-pass-3', '9999')).toBe(false);
    // The OTP is still available for the next attempt.
    expect(getOtpForLogging('gate-pass-3')).toBe('1234');
  });

  it('trims whitespace from the input OTP before comparing', () => {
    // Mobile keyboards often add a trailing space. The guard shouldn't be
    // rejected just because their keyboard added a space after the 4 digits.
    generateOtp('gate-pass-trim');
    expect(verifyOtp('gate-pass-trim', '  1234  ')).toBe(true);
  });

  it('rejects the OTP after 10 minutes have elapsed (expiry window)', () => {
    // A truck that arrives an hour late must not be able to use a stale code.
    // The supervisor needs to request a new gate pass with a fresh OTP.
    vi.useFakeTimers();
    generateOtp('gate-pass-expiry');
    // Advance 11 minutes — past the 10-minute expiry window.
    vi.advanceTimersByTime(11 * 60 * 1000);
    expect(verifyOtp('gate-pass-expiry', '1234')).toBe(false);
    // Expired OTPs are cleaned up so they don't linger in memory.
    expect(getOtpForLogging('gate-pass-expiry')).toBeUndefined();
  });

  it('locks out after 5 failed attempts and deletes the OTP (brute-force protection)', () => {
    // An attacker (or a confused guard) gets at most 5 guesses. After that,
    // the OTP is deleted and even the correct code won't work. The supervisor
    // must request a new gate pass.
    generateOtp('gate-pass-attempts');
    // 5 wrong attempts are allowed (attempt counter goes 1 → 5).
    for (let i = 1; i <= 5; i++) {
      expect(verifyOtp('gate-pass-attempts', '0000')).toBe(false);
    }
    // The 6th attempt — even with the correct code — fails because the OTP was deleted.
    expect(verifyOtp('gate-pass-attempts', '1234')).toBe(false);
    expect(getOtpForLogging('gate-pass-attempts')).toBeUndefined();
  });

  it('a successful verification before the attempt limit consumes the OTP (no replay)', () => {
    // One OTP = one gate-pass entry. A guard cannot use the same code to let
    // a second truck through.
    generateOtp('gate-pass-success');
    expect(verifyOtp('gate-pass-success', '0000')).toBe(false); // 1 wrong attempt
    expect(verifyOtp('gate-pass-success', '1234')).toBe(true); // then correct
    // Trying again with the same code must fail — the OTP is gone.
    expect(verifyOtp('gate-pass-success', '1234')).toBe(false);
  });

  it('clearOtp removes a stored OTP (used when a gate pass is cancelled)', () => {
    generateOtp('gate-pass-clear');
    expect(getOtpForLogging('gate-pass-clear')).toBe('1234');
    clearOtp('gate-pass-clear');
    expect(getOtpForLogging('gate-pass-clear')).toBeUndefined();
    // After clearing, verification fails — the gate pass can no longer be approved.
    expect(verifyOtp('gate-pass-clear', '1234')).toBe(false);
  });

  it('clearOtp is a no-op for a gate pass that never had an OTP (idempotent)', () => {
    // Calling clear twice (e.g. cancel + cleanup) must not throw.
    expect(() => clearOtp('never-generated')).not.toThrow();
  });

  it('getOtpForLogging returns undefined when no OTP exists for the gate pass', () => {
    // Used by the frontend to decide whether to show "Request OTP" or "OTP: 1234".
    expect(getOtpForLogging('never-generated')).toBeUndefined();
  });
});
