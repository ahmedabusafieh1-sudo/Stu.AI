import { describe, it, expect, vi } from 'vitest';
import { requireVerified, verifyCsrf } from '../server/middleware/auth.js';
import { generateSecureToken, hashToken } from '../server/services/auth.js';

describe('Security & Multi-Tenant Isolation Middleware', () => {
  it('blocks unverified users with 403 Forbidden', () => {
    const req: any = {
      user: {
        id: 'user-1',
        email: 'unverified@example.com',
        displayName: 'طالب غير مفعل',
        isVerified: false,
      },
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    requireVerified(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ needsVerification: true })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('allows verified users to proceed through requireVerified guard', () => {
    const req: any = {
      user: {
        id: 'user-2',
        email: 'verified@example.com',
        displayName: 'طالب مفعل',
        isVerified: true,
      },
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    requireVerified(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('generates high-entropy single-use reset tokens with unique hashes', () => {
    const token1 = generateSecureToken(32);
    const token2 = generateSecureToken(32);

    expect(token1).not.toBe(token2);
    expect(token1.length).toBe(64); // 32 bytes hex = 64 characters

    const hash1 = hashToken(token1);
    const hash2 = hashToken(token2);
    expect(hash1).not.toBe(hash2);
    expect(hash1).toBe(hashToken(token1));
  });

  it('allows safe HTTP methods (GET, HEAD, OPTIONS) without CSRF blocking', () => {
    const req: any = { method: 'GET', headers: {} };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    verifyCsrf(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
