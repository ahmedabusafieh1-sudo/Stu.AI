import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, generateOtp, hashOtp } from '../server/services/auth.js';
import { registerSchema, verifyOtpSchema } from '../shared/schema.js';

describe('Auth Services & Validation', () => {
  it('hashes passwords using scrypt and verifies matches securely', async () => {
    const rawPassword = 'SuperSecurePassword2026!';
    const hash = await hashPassword(rawPassword);

    expect(hash).toMatch(/^scrypt\$/);
    expect(hash).not.toContain(rawPassword);

    const isMatch = await verifyPassword(rawPassword, hash);
    expect(isMatch).toBe(true);

    const isWrongMatch = await verifyPassword('WrongPassword123!', hash);
    expect(isWrongMatch).toBe(false);
  });

  it('enforces minimum 12-character passwords in registration schema', () => {
    const shortPasswordResult = registerSchema.safeParse({
      displayName: 'أحمد',
      email: 'ahmed@example.com',
      password: 'short',
      confirmPassword: 'short',
    });
    expect(shortPasswordResult.success).toBe(false);

    const validPasswordResult = registerSchema.safeParse({
      displayName: 'أحمد محمود',
      email: 'ahmed@example.com',
      password: 'ValidPassword1234!',
      confirmPassword: 'ValidPassword1234!',
    });
    expect(validPasswordResult.success).toBe(true);
  });

  it('generates secure 6-digit OTP and verifies with HMAC-SHA256', () => {
    const otp = generateOtp();
    expect(otp).toMatch(/^\d{6}$/);

    const hash1 = hashOtp(otp);
    const hash2 = hashOtp(otp);
    expect(hash1).toBe(hash2);

    const wrongOtp = otp === '123456' ? '654321' : '123456';
    const wrongHash = hashOtp(wrongOtp);
    expect(hash1).not.toBe(wrongHash);
  });

  it('validates 6-digit OTP schema correctly', () => {
    expect(verifyOtpSchema.safeParse({ email: 'test@example.com', code: '123456' }).success).toBe(true);
    expect(verifyOtpSchema.safeParse({ email: 'test@example.com', code: '12345' }).success).toBe(false);
    expect(verifyOtpSchema.safeParse({ email: 'test@example.com', code: 'abcdef' }).success).toBe(false);
  });
});
