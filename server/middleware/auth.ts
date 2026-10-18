import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { eq, and, gt } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { sessions, users, userSettings } from '../../shared/schema.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  isVerified: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      sessionId?: string;
    }
  }
}

const SESSION_COOKIE_NAME = 'stu_session';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function getSessionCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    maxAge: SESSION_MAX_AGE_MS,
    path: '/',
  };
}

// ----------------------------------------------------
// Create & Save Session
// ----------------------------------------------------
export async function createSession(userId: string, req: Request, res: Response): Promise<string> {
  const { db } = await getDb();
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);
  
  const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || null;
  const userAgent = req.headers['user-agent'] || null;

  await db.insert(sessions).values({
    id: tokenHash,
    userId,
    expiresAt,
    ipAddress,
    userAgent,
  });

  res.cookie(SESSION_COOKIE_NAME, rawToken, getSessionCookieOptions());
  return rawToken;
}

// ----------------------------------------------------
// Delete / Invalidate Session
// ----------------------------------------------------
export async function destroySession(req: Request, res: Response): Promise<void> {
  const rawToken = req.cookies?.[SESSION_COOKIE_NAME];
  if (rawToken) {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const { db } = await getDb();
    await db.delete(sessions).where(eq(sessions.id, tokenHash));
  }
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

// ----------------------------------------------------
// Auth Middleware: Populates req.user
// ----------------------------------------------------
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const rawToken = req.cookies?.[SESSION_COOKIE_NAME];

  if (!rawToken) {
    return res.status(401).json({ error: 'يرجى تسجيل الدخول للمتابعة' });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const { db } = await getDb();

    // Query active session
    const sessionList = await db
      .select({
        sessionId: sessions.id,
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
        isVerified: users.isVerified,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.id, tokenHash), gt(sessions.expiresAt, new Date())))
      .limit(1);

    if (sessionList.length === 0) {
      res.clearCookie(SESSION_COOKIE_NAME, getSessionCookieOptions());
      return res.status(401).json({ error: 'الجلسة منتهية أو غير صالحة، يرجى تسجيل الدخول مجدداً' });
    }

    const sessionData = sessionList[0];
    req.user = {
      id: sessionData.userId,
      email: sessionData.email,
      displayName: sessionData.displayName,
      isVerified: sessionData.isVerified,
    };
    req.sessionId = sessionData.sessionId;

    next();
  } catch (err: any) {
    console.error('[AUTH_MIDDLEWARE] Error:', err);
    return res.status(500).json({ error: 'خطأ في التحقق من الجلسة' });
  }
}

// ----------------------------------------------------
// Verified User Only Guard
// ----------------------------------------------------
export function requireVerified(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'يرجى تسجيل الدخول' });
  }
  if (!req.user.isVerified) {
    return res.status(403).json({
      error: 'حسابك غير مفعل بعد. يرجى إدخال رمز التحقق لتفعيل الحساب واستخدام المحادثات والمرفقات والذكاء الاصطناعي.',
      needsVerification: true,
      email: req.user.email,
    });
  }
  next();
}

// ----------------------------------------------------
// CSRF & Origin Verification for Mutating Requests
// ----------------------------------------------------
export function verifyCsrf(req: Request, res: Response, next: NextFunction) {
  // Safe HTTP methods don't mutate state
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const origin = req.headers['origin'] || req.headers['referer'];
  const host = req.headers['host'];

  // In test environments or when explicitly allowed, proceed
  if (process.env.NODE_ENV === 'test' || !origin || !host) {
    return next();
  }

  try {
    const originUrl = new URL(origin);
    // Origin host must match request host or APP_BASE_URL
    const appBaseUrl = process.env.APP_BASE_URL;
    const allowedOrigin = appBaseUrl ? new URL(appBaseUrl).host : host;

    if (originUrl.host !== host && originUrl.host !== allowedOrigin) {
      console.warn(`[CSRF] Blocked request from origin: ${origin} (Host: ${host})`);
      return res.status(403).json({ error: 'طلب غير مصرح به (CSRF/Origin mismatch)' });
    }
  } catch (e) {
    // If URL parsing fails, ignore or allow
  }

  next();
}
