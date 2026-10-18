import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { eq, and, gt, desc } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import {
  users,
  userSettings,
  emailVerifications,
  passwordResets,
  sessions,
  registerSchema,
  loginSchema,
  verifyOtpSchema,
  resendOtpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updateSettingsSchema,
} from '../../shared/schema.js';
import {
  hashPassword,
  verifyPassword,
  generateOtp,
  hashOtp,
  generateSecureToken,
  hashToken,
  sendVerificationEmail,
  sendPasswordResetEmail,
} from '../services/auth.js';
import {
  createSession,
  destroySession,
  requireAuth,
  AuthenticatedUser,
} from '../middleware/auth.js';

export const authRouter = Router();

// In-memory rate limiting map for login / OTP abuse protection
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, maxAttempts: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxAttempts) {
    return false;
  }
  entry.count += 1;
  return true;
}

// ----------------------------------------------------
// 1. Register User
// ----------------------------------------------------
authRouter.post('/register', async (req: Request, res: Response) => {
  const parseResult = registerSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: parseResult.error.errors[0]?.message || 'بيانات التسجيل غير صالحة',
    });
  }

  const { displayName, email, password } = parseResult.data;
  const ip = req.ip || 'ip';
  if (!checkRateLimit(`register:${ip}`, 10, 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'تم تجاوز الحد الأقصى لمحاولات التسجيل من هذا الجهاز، يرجى المحاولة لاحقاً.' });
  }

  try {
    const { db } = await getDb();

    // Check if user already exists
    const existingUsers = await db.select().from(users).where(eq(users.email, email)).limit(1);
    let userId: string;

    if (existingUsers.length > 0) {
      const existing = existingUsers[0];
      if (existing.isVerified) {
        return res.status(409).json({ error: 'البريد الإلكتروني مسجل بالفعل، يرجى تسجيل الدخول.' });
      }
      // If unverified, update password and name, and re-issue OTP
      const passwordHash = await hashPassword(password);
      await db
        .update(users)
        .set({
          displayName,
          passwordHash,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id));
      userId = existing.id;
    } else {
      // Create new unverified user
      const passwordHash = await hashPassword(password);
      const inserted = await db
        .insert(users)
        .values({
          email,
          passwordHash,
          displayName,
          isVerified: false,
        })
        .returning({ id: users.id });

      userId = inserted[0].id;

      // Create default settings
      await db.insert(userSettings).values({
        userId,
        uiLanguage: 'ar',
        preferredExplanationLang: 'auto',
      });
    }

    // Invalidate previous OTPs for this email
    await db.delete(emailVerifications).where(eq(emailVerifications.email, email));

    // Generate fresh OTP code and HMAC hash
    const otpCode = generateOtp();
    const otpHash = hashOtp(otpCode);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes
    const resendAvailableAt = new Date(now.getTime() + 60 * 1000); // 60 seconds cooldown

    await db.insert(emailVerifications).values({
      email,
      otpHash,
      attempts: 0,
      resendAvailableAt,
      expiresAt,
    });

    // Send real verification email via backend service
    const emailResult = await sendVerificationEmail(email, otpCode);
    if (!emailResult.success) {
      return res.status(502).json({
        error: `فشل إرسال كود التحقق عبر البريد: ${emailResult.error}`,
        needsVerification: true,
        email,
      });
    }

    return res.status(201).json({
      success: true,
      message: (emailResult as any)?.isRealEmail
        ? 'تم إنشاء الحساب بنجاح وإرسال رمز التحقق إلى بريدك الإلكتروني.'
        : 'تم إنشاء الحساب بنجاح وتوليد كود التحقق للتفعيل الفوري (وضع التطوير المحلي).',
      email,
      needsVerification: true,
      devOtp: (emailResult as any)?.devCode,
    });
  } catch (err: any) {
    console.error('[AUTH_REGISTER] Error:', err);
    return res.status(500).json({ error: 'حدث خطأ أثناء إنشاء الحساب.' });
  }
});

// ----------------------------------------------------
// 2. Verify OTP Code
// ----------------------------------------------------
authRouter.post('/verify-otp', async (req: Request, res: Response) => {
  const parseResult = verifyOtpSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.errors[0]?.message || 'بيانات التحقق غير صالحة' });
  }

  const { email, code } = parseResult.data;

  try {
    const { db } = await getDb();

    // Find the latest active verification record for this email
    const verifications = await db
      .select()
      .from(emailVerifications)
      .where(eq(emailVerifications.email, email))
      .orderBy(desc(emailVerifications.createdAt))
      .limit(1);

    if (verifications.length === 0) {
      return res.status(404).json({ error: 'لم يتم العثور على رمز تحقق لهذا البريد، يرجى طلب رمز جديد.' });
    }

    const verification = verifications[0];

    // Check expiration
    if (new Date() > new Date(verification.expiresAt)) {
      await db.delete(emailVerifications).where(eq(emailVerifications.id, verification.id));
      return res.status(410).json({ error: 'انتهت صلاحية رمز التحقق (10 دقائق)، يرجى الضغط على إعادة الإرسال.' });
    }

    // Check attempt limits
    if (verification.attempts >= 5) {
      await db.delete(emailVerifications).where(eq(emailVerifications.id, verification.id));
      return res.status(429).json({ error: 'تم تجاوز الحد الأقصى للمحاولات (5 محاولات). يرجى طلب رمز تحقق جديد.' });
    }

    // Verify HMAC-SHA256 code
    const expectedHash = hashOtp(code);
    const isMatch = crypto.timingSafeEqual(
      Buffer.from(expectedHash, 'hex'),
      Buffer.from(verification.otpHash, 'hex')
    );

    if (!isMatch) {
      const updatedAttempts = verification.attempts + 1;
      await db
        .update(emailVerifications)
        .set({ attempts: updatedAttempts })
        .where(eq(emailVerifications.id, verification.id));

      const remainingAttempts = 5 - updatedAttempts;
      return res.status(400).json({
        error: `رمز التحقق غير صحيح. المحاولات المتبقية: ${remainingAttempts}`,
      });
    }

    // Atomic Verification Success:
    // 1. Mark user as verified
    const userUpdate = await db
      .update(users)
      .set({ isVerified: true, updatedAt: new Date() })
      .where(eq(users.email, email))
      .returning();

    if (userUpdate.length === 0) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const verifiedUser = userUpdate[0];

    // 2. Remove verification record to prevent reuse
    await db.delete(emailVerifications).where(eq(emailVerifications.email, email));

    // 3. Create persistent authenticated session and set HttpOnly cookie
    await createSession(verifiedUser.id, req, res);

    // 4. Fetch settings
    const settingsList = await db.select().from(userSettings).where(eq(userSettings.userId, verifiedUser.id)).limit(1);

    return res.json({
      success: true,
      message: 'تم تفعيل الحساب وتسجيل الدخول بنجاح.',
      user: {
        id: verifiedUser.id,
        email: verifiedUser.email,
        displayName: verifiedUser.displayName,
        isVerified: true,
      },
      settings: settingsList[0] || { uiLanguage: 'ar', preferredExplanationLang: 'auto' },
    });
  } catch (err: any) {
    console.error('[AUTH_VERIFY_OTP] Error:', err);
    return res.status(500).json({ error: 'حدث خطأ أثناء التحقق من الرمز.' });
  }
});

// ----------------------------------------------------
// 3. Resend OTP Code
// ----------------------------------------------------
authRouter.post('/resend-otp', async (req: Request, res: Response) => {
  const parseResult = resendOtpSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'البريد الإلكتروني غير صالح' });
  }

  const { email } = parseResult.data;

  try {
    const { db } = await getDb();

    // Check if user exists
    const userList = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (userList.length === 0) {
      return res.status(404).json({ error: 'الحساب غير مسجل' });
    }

    if (userList[0].isVerified) {
      return res.status(400).json({ error: 'الحساب مفعل بالفعل، يمكنك تسجيل الدخول مباشرة.' });
    }

    // Check cooldown from previous request
    const verifications = await db
      .select()
      .from(emailVerifications)
      .where(eq(emailVerifications.email, email))
      .orderBy(desc(emailVerifications.createdAt))
      .limit(1);

    if (verifications.length > 0) {
      const latest = verifications[0];
      const now = new Date();
      if (now < new Date(latest.resendAvailableAt)) {
        const waitSeconds = Math.ceil((new Date(latest.resendAvailableAt).getTime() - now.getTime()) / 1000);
        return res.status(429).json({
          error: `يرجى الانتظار ${waitSeconds} ثانية قبل إعادة إرسال رمز جديد.`,
          waitSeconds,
        });
      }
    }

    // Invalidate old records
    await db.delete(emailVerifications).where(eq(emailVerifications.email, email));

    // Generate new OTP
    const otpCode = generateOtp();
    const otpHash = hashOtp(otpCode);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
    const resendAvailableAt = new Date(now.getTime() + 60 * 1000);

    await db.insert(emailVerifications).values({
      email,
      otpHash,
      attempts: 0,
      resendAvailableAt,
      expiresAt,
    });

    const emailResult = await sendVerificationEmail(email, otpCode);
    if (!emailResult.success) {
      return res.status(502).json({
        error: `فشل إرسال كود التحقق عبر البريد: ${emailResult.error}`,
      });
    }

    return res.json({
      success: true,
      message: (emailResult as any)?.isRealEmail
        ? 'تم إرسال رمز تحقق جديد إلى بريدك الإلكتروني.'
        : 'تم توليد رمز تحقق جديد للتفعيل الفوري (وضع التطوير المحلي).',
      resendAvailableAt,
      devOtp: (emailResult as any)?.devCode,
    });
  } catch (err: any) {
    console.error('[AUTH_RESEND_OTP] Error:', err);
    return res.status(500).json({ error: 'حدث خطأ أثناء إعادة إرسال الرمز.' });
  }
});

// ----------------------------------------------------
// 4. Login User
// ----------------------------------------------------
authRouter.post('/login', async (req: Request, res: Response) => {
  const parseResult = loginSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.errors[0]?.message || 'البيانات غير صالحة' });
  }

  const { email, password } = parseResult.data;
  const ip = req.ip || 'ip';

  if (!checkRateLimit(`login:${ip}:${email}`, 10, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'تم تجاوز عدد محاولات الدخول المسموح بها، يرجى المحاولة بعد 15 دقيقة.' });
  }

  try {
    const { db } = await getDb();

    // Query user
    const userList = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (userList.length === 0) {
      return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' });
    }

    const user = userList[0];
    const passwordValid = await verifyPassword(password, user.passwordHash);

    if (!passwordValid) {
      return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' });
    }

    // Check verification status
    if (!user.isVerified) {
      // Re-issue an OTP code for convenience
      const otpCode = generateOtp();
      const otpHash = hashOtp(otpCode);
      const now = new Date();

      await db.delete(emailVerifications).where(eq(emailVerifications.email, email));
      await db.insert(emailVerifications).values({
        email,
        otpHash,
        attempts: 0,
        resendAvailableAt: new Date(now.getTime() + 60 * 1000),
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      });

      const emailResult = await sendVerificationEmail(email, otpCode);

      return res.status(403).json({
        error: (emailResult as any)?.isRealEmail
          ? 'حسابك غير مفعل بعد. لقد أرسلنا رمز تحقق جديداً إلى بريدك الإلكتروني.'
          : 'حسابك غير مفعل بعد. تم توليد كود التحقق للتفعيل الفوري.',
        needsVerification: true,
        email: user.email,
        devOtp: (emailResult as any)?.devCode,
      });
    }

    // Rotate and create persistent session
    await createSession(user.id, req, res);

    // Fetch user settings
    let settingsList = await db.select().from(userSettings).where(eq(userSettings.userId, user.id)).limit(1);
    let settings = settingsList[0];
    if (!settings) {
      const inserted = await db.insert(userSettings).values({
        userId: user.id,
        uiLanguage: 'ar',
        preferredExplanationLang: 'auto',
      }).returning();
      settings = inserted[0];
    }

    return res.json({
      success: true,
      message: 'تم تسجيل الدخول بنجاح.',
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        isVerified: user.isVerified,
      },
      settings,
    });
  } catch (err: any) {
    console.error('[AUTH_LOGIN] Error:', err);
    return res.status(500).json({ error: 'حدث خطأ أثناء تسجيل الدخول.' });
  }
});

// ----------------------------------------------------
// 5. Logout User
// ----------------------------------------------------
authRouter.post('/logout', async (req: Request, res: Response) => {
  try {
    await destroySession(req, res);
    return res.json({ success: true, message: 'تم تسجيل الخروج بنجاح.' });
  } catch (err: any) {
    console.error('[AUTH_LOGOUT] Error:', err);
    return res.status(500).json({ error: 'حدث خطأ أثناء تسجيل الخروج.' });
  }
});

// ----------------------------------------------------
// 6. Current User & Settings (me)
// ----------------------------------------------------
authRouter.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const { db } = await getDb();
    const settingsList = await db.select().from(userSettings).where(eq(userSettings.userId, req.user!.id)).limit(1);

    return res.json({
      user: req.user,
      settings: settingsList[0] || { uiLanguage: 'ar', preferredExplanationLang: 'auto', searchGroundingDefault: false },
    });
  } catch (err: any) {
    console.error('[AUTH_ME] Error:', err);
    return res.status(500).json({ error: 'حدث خطأ أثناء استعادة بيانات الجلسة.' });
  }
});

// ----------------------------------------------------
// 7. Update User Settings
// ----------------------------------------------------
authRouter.put('/settings', requireAuth, async (req: Request, res: Response) => {
  const parseResult = updateSettingsSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.errors[0]?.message || 'بيانات الإعدادات غير صالحة' });
  }

  const { displayName, uiLanguage, preferredExplanationLang, searchGroundingDefault } = parseResult.data;

  try {
    const { db } = await getDb();

    // Update display name on users table if provided
    if (displayName) {
      await db.update(users).set({ displayName, updatedAt: new Date() }).where(eq(users.id, req.user!.id));
      req.user!.displayName = displayName;
    }

    // Update userSettings
    const updatePayload: Record<string, any> = { updatedAt: new Date() };
    if (uiLanguage) updatePayload.uiLanguage = uiLanguage;
    if (preferredExplanationLang) updatePayload.preferredExplanationLang = preferredExplanationLang;
    if (typeof searchGroundingDefault === 'boolean') updatePayload.searchGroundingDefault = searchGroundingDefault;

    const updatedSettings = await db
      .update(userSettings)
      .set(updatePayload)
      .where(eq(userSettings.userId, req.user!.id))
      .returning();

    return res.json({
      success: true,
      message: 'تم تحديث الإعدادات بنجاح.',
      user: req.user,
      settings: updatedSettings[0],
    });
  } catch (err: any) {
    console.error('[AUTH_SETTINGS] Error:', err);
    return res.status(500).json({ error: 'حدث خطأ أثناء حفظ الإعدادات.' });
  }
});

// ----------------------------------------------------
// 8. Forgot Password
// ----------------------------------------------------
authRouter.post('/forgot-password', async (req: Request, res: Response) => {
  const parseResult = forgotPasswordSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'البريد الإلكتروني غير صالح' });
  }

  const { email } = parseResult.data;

  try {
    const { db } = await getDb();
    const userList = await db.select().from(users).where(eq(users.email, email)).limit(1);

    // For security, don't reveal directly whether user exists
    if (userList.length === 0) {
      return res.json({
        success: true,
        message: 'إذا كان البريد مسجلاً لدينا، فقد تم إرسال رابط استعادة كلمة المرور إليه.',
      });
    }

    const user = userList[0];
    const resetToken = generateSecureToken(32);
    const otpCode = generateOtp();
    const tokenHash = hashToken(resetToken);
    const otpHash = hashToken(otpCode);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Invalidate old reset requests for this user
    await db.delete(passwordResets).where(eq(passwordResets.userId, user.id));

    // Save both full token and 6-digit OTP
    await db.insert(passwordResets).values({
      userId: user.id,
      tokenHash,
      expiresAt,
    });
    await db.insert(passwordResets).values({
      userId: user.id,
      tokenHash: otpHash,
      expiresAt,
    });

    const host = req.get('host') || 'localhost:3001';
    const forwardedProto = req.headers['x-forwarded-proto'] as string;
    const protocol = forwardedProto || (host.startsWith('localhost') || host.startsWith('127.0.0.1') || host.startsWith('192.168.') ? 'http' : 'https');
    const baseUrl = `${protocol}://${host}`;
    await sendPasswordResetEmail(email, resetToken, baseUrl, otpCode);

    return res.json({
      success: true,
      message: 'تم إرسال رمز التحقق (6 أرقام) ورابط الاستعادة إلى بريدك الإلكتروني بنجاح.',
    });
  } catch (err: any) {
    console.error('[AUTH_FORGOT_PW] Error:', err);
    return res.status(500).json({ error: 'حدث خطأ أثناء معالجة طلب الاستعادة.' });
  }
});

// ----------------------------------------------------
// 9. Reset Password
// ----------------------------------------------------
authRouter.post('/reset-password', async (req: Request, res: Response) => {
  const parseResult = resetPasswordSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.errors[0]?.message || 'بيانات كلمة المرور غير صالحة' });
  }

  const { token, newPassword } = parseResult.data;

  try {
    const tokenHash = hashToken(token.trim());
    const { db } = await getDb();

    // Find active token or OTP
    const resets = await db
      .select()
      .from(passwordResets)
      .where(and(eq(passwordResets.tokenHash, tokenHash), gt(passwordResets.expiresAt, new Date())))
      .limit(1);

    if (resets.length === 0 || resets[0].usedAt) {
      return res.status(400).json({ error: 'رمز أو كود التحقق غير صالح أو منتهي الصلاحية.' });
    }

    const reset = resets[0];
    const newHash = await hashPassword(newPassword);

    // 1. Update user password
    await db.update(users).set({ passwordHash: newHash, updatedAt: new Date() }).where(eq(users.id, reset.userId));

    // 2. Invalidate all reset tokens for this user
    await db.delete(passwordResets).where(eq(passwordResets.userId, reset.userId));

    // 3. Invalidate ALL existing sessions for this user (security requirement)
    await db.delete(sessions).where(eq(sessions.userId, reset.userId));

    return res.json({
      success: true,
      message: 'تم تغيير كلمة المرور بنجاح. يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.',
    });
  } catch (err: any) {
    console.error('[AUTH_RESET_PW] Error:', err);
    return res.status(500).json({ error: 'حدث خطأ أثناء إعادة تعيين كلمة المرور.' });
  }
});

// ----------------------------------------------------
// 10. Gemini API Key Status & Configuration
// ----------------------------------------------------
authRouter.get('/gemini-status', async (_req: Request, res: Response) => {
  const isConfigured = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
  return res.json({
    isConfigured,
    modelFast: process.env.GEMINI_MODEL_FAST || 'gemini-2.5-flash',
  });
});

authRouter.post('/gemini-key', requireAuth, async (req: Request, res: Response) => {
  const { geminiKey } = req.body;
  if (!geminiKey || typeof geminiKey !== 'string' || geminiKey.trim().length === 0) {
    return res.status(400).json({ error: 'يرجى إدخال مفتاح Gemini API صالح.' });
  }

  const cleanKey = geminiKey.trim();

  // Validate format hint if it's clearly not a Google key
  if (cleanKey.startsWith('xkeysib-')) {
    return res.status(400).json({
      error: 'هذا مفتاح Brevo الخاص بالبريد الإلكتروني وليس مفتاح Google Gemini! مفتاح Gemini يبدأ عادة بـ AIza...',
    });
  }

  // Update process.env runtime
  process.env.GEMINI_API_KEY = cleanKey;

  // Persist to .env file
  try {
    const fs = await import('fs');
    const path = await import('path');
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      let envContent = fs.readFileSync(envPath, 'utf-8');
      if (envContent.includes('GEMINI_API_KEY=')) {
        envContent = envContent.replace(/GEMINI_API_KEY=.*/, `GEMINI_API_KEY=${cleanKey}`);
      } else {
        envContent += `\nGEMINI_API_KEY=${cleanKey}\n`;
      }
      fs.writeFileSync(envPath, envContent, 'utf-8');
    }
  } catch (fsErr) {
    console.warn('[GEMINI_KEY_PERSIST_WARN]', fsErr);
  }

  console.log('[GEMINI] Gemini API key updated and activated successfully.');
  return res.json({
    success: true,
    message: 'تم تفعيل وحفظ مفتاح Gemini بنجاح!',
  });
});
