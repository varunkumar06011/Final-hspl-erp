// In-memory OTP store: gatePassId -> { otp, expiresAt, attempts }
const otpStore = new Map<string, { otp: string; expiresAt: Date; attempts: number }>();

export const FALLBACK_OTP = '1234';

export function generateOtp(gatePassId: string, _length = 4): string {
  // For testing fallback, always return 1234 until Firebase OTP is connected
  // In production, generate a random OTP and send via SMS/Firebase
  const otp = FALLBACK_OTP;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  otpStore.set(gatePassId, { otp, expiresAt, attempts: 0 });
  return otp;
}

export function verifyOtp(gatePassId: string, inputOtp: string): boolean {
  const record = otpStore.get(gatePassId);
  if (!record) return false;
  if (new Date() > record.expiresAt) {
    otpStore.delete(gatePassId);
    return false;
  }
  record.attempts += 1;
  if (record.attempts > 5) {
    otpStore.delete(gatePassId);
    return false;
  }
  if (record.otp !== inputOtp.trim()) return false;
  otpStore.delete(gatePassId);
  return true;
}

export function getOtpForLogging(gatePassId: string): string | undefined {
  return otpStore.get(gatePassId)?.otp;
}

export function clearOtp(gatePassId: string): void {
  otpStore.delete(gatePassId);
}
