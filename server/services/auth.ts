import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

const BREVO_FALLBACK_KEY = process.env.BREVO_API_KEY || '';
const OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || 'dev_otp_hmac_secret_fallback_stu_ai';
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3001';

// ----------------------------------------------------
// Password Hashing with Scrypt (Secure, Memory-Hard)
// ----------------------------------------------------
export async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`scrypt$${salt}$${derivedKey.toString('hex')}`);
    });
  });
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const [algorithm, salt, key] = storedHash.split('$');
      if (algorithm !== 'scrypt' || !salt || !key) {
        return resolve(false);
      }
      crypto.scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, derivedKey) => {
        if (err) return resolve(false);
        const keyBuffer = Buffer.from(key, 'hex');
        const match = crypto.timingSafeEqual(keyBuffer, derivedKey);
        resolve(match);
      });
    } catch {
      resolve(false);
    }
  });
}

// ----------------------------------------------------
// OTP Generation and HMAC Verification
// ----------------------------------------------------
export function generateOtp(): string {
  // Cryptographically secure 6-digit code: 100000 - 999999
  const num = crypto.randomInt(100000, 1000000);
  return num.toString();
}

export function hashOtp(code: string): string {
  return crypto.createHmac('sha256', OTP_HMAC_SECRET).update(code.trim()).digest('hex');
}

export function generateSecureToken(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ----------------------------------------------------
// Email Dispatch (Resend / SMTP / Console fallback)
// ----------------------------------------------------
export async function sendVerificationEmail(
  email: string,
  code: string
): Promise<{ success: boolean; error?: string; isRealEmail?: boolean; devCode?: string }> {
  const subject = `رمز التحقق الخاص بك في Stu.Ai: ${code}`;
  const textBody = `أهلاً بك في Stu.Ai!\n\nرمز التحقق الخاص بحسابك هو: ${code}\n\nصلاحية هذا الرمز هي 10 دقائق فقط.\nلا تشارك هذا الرمز مع أي شخص.`;
  const htmlBody = `
    <div dir="rtl" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #171717; color: #F5F5F5; padding: 40px 20px; text-align: center;">
      <div style="max-width: 480px; margin: 0 auto; background-color: #232323; border: 1px solid #3A3A3A; border-radius: 12px; padding: 32px;">
        <h1 style="color: #FFFFFF; font-size: 24px; margin-bottom: 8px;">Stu.Ai</h1>
        <p style="color: #B5B5B5; font-size: 15px; margin-bottom: 24px;">مساعدك الدراسي الذكي</p>
        <div style="background-color: #111111; border: 1px solid #3A3A3A; border-radius: 8px; padding: 18px; margin-bottom: 24px;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #FFFFFF; font-family: monospace;">${code}</span>
        </div>
        <p style="color: #B5B5B5; font-size: 14px; line-height: 1.6; margin-bottom: 8px;">
          صلاحية هذا الرمز هي 10 دقائق. إذا لم تطلب هذا الرمز، يمكنك تجاهل هذه الرسالة بأمان.
        </p>
      </div>
    </div>
  `;

  // 1. Try Brevo if configured
  const brevoApiKey = process.env.BREVO_API_KEY?.trim() || BREVO_FALLBACK_KEY;
  if (brevoApiKey) {
    try {
      const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim() || 'ahmed.abusafieh1@gmail.com';
      const senderName = process.env.BREVO_SENDER_NAME?.trim() || 'Stu.Ai';
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': brevoApiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: senderName, email: senderEmail },
          to: [{ email, name: email.split('@')[0] }],
          subject,
          htmlContent: htmlBody,
          textContent: textBody,
        }),
      });

      const resData: any = await response.json();
      if (!response.ok) {
        console.error('[EMAIL] Brevo returned error:', resData);
      } else {
        console.log('[EMAIL] Verification email sent successfully via Brevo to:', email, resData);
        return { success: true, isRealEmail: true };
      }
    } catch (err: any) {
      console.error('[EMAIL] Failed sending via Brevo:', err.message);
    }
  }

  // 2. Try Resend if configured
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  if (resendApiKey) {
    try {
      const resend = new Resend(resendApiKey);
      const fromEmail = process.env.EMAIL_FROM?.trim() || 'Stu.Ai <onboarding@resend.dev>';
      const result = await resend.emails.send({
        from: fromEmail,
        to: email,
        subject,
        text: textBody,
        html: htmlBody,
      });

      if (result.error) {
        console.error('[EMAIL] Resend returned error:', result.error);
        return { success: false, error: result.error.message };
      }
      console.log('[EMAIL] Verification email sent successfully via Resend to:', email);
      return { success: true, isRealEmail: true };
    } catch (err: any) {
      console.error('[EMAIL] Failed sending via Resend:', err.message);
      return { success: false, error: err.message };
    }
  }

  // 3. Try SMTP if configured
  const smtpHost = process.env.SMTP_HOST?.trim();
  if (smtpHost) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      await transporter.sendMail({
        from: process.env.EMAIL_FROM || 'Stu.Ai <noreply@stu.ai>',
        to: email,
        subject,
        text: textBody,
        html: htmlBody,
      });

      console.log('[EMAIL] Verification email sent successfully via SMTP to:', email);
      return { success: true, isRealEmail: true };
    } catch (err: any) {
      console.error('[EMAIL] Failed sending via SMTP:', err.message);
      return { success: false, error: err.message };
    }
  }

  // 3. Fallback in development mode: log to server console securely and provide code
  if (process.env.NODE_ENV !== 'production') {
    console.log(`\n======================================================`);
    console.log(`[DEV EMAIL SIMULATOR]`);
    console.log(`To: ${email}`);
    console.log(`Subject: ${subject}`);
    console.log(`Verification Code (OTP): [ ${code} ]`);
    console.log(`(Configure RESEND_API_KEY or SMTP in .env for live email)`);
    console.log(`======================================================\n`);
    return { success: true, isRealEmail: false, devCode: code };
  }

  return {
    success: false,
    error: 'لم يتم ضبط خدمة إرسال البريد (Resend أو SMTP) في إعدادات الخادم.',
  };
}

export async function sendPasswordResetEmail(
  email: string,
  resetToken: string,
  baseUrl?: string,
  otpCode?: string
): Promise<{ success: boolean; error?: string }> {
  const finalBaseUrl = baseUrl || process.env.APP_BASE_URL || 'http://localhost:3001';
  const resetUrl = `${finalBaseUrl}/?token=${resetToken}`;
  const codeDisplay = otpCode || resetToken.slice(0, 6);
  const subject = `إعادة تعيين كلمة المرور - كود التحقق [ ${codeDisplay} ] - Stu.Ai`;
  const textBody = `طلب إعادة تعيين كلمة المرور في Stu.Ai\n\nرمز التحقق الخاص بك هو:\n[ ${codeDisplay} ]\n\nأو يمكنك استخدام الرابط المباشر:\n${resetUrl}\n\nصلاحية هذا الرمز والرابط 15 دقيقة فقط.`;
  const htmlBody = `
    <div dir="rtl" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #171717; color: #F5F5F5; padding: 40px 20px; text-align: center;">
      <div style="max-width: 480px; margin: 0 auto; background-color: #232323; border: 1px solid #3A3A3A; border-radius: 12px; padding: 32px;">
        <h1 style="color: #FFFFFF; font-size: 24px; margin-bottom: 8px;">Stu.Ai</h1>
        <p style="color: #B5B5B5; font-size: 15px; margin-bottom: 20px;">طلب إعادة تعيين كلمة المرور</p>
        
        <p style="color: #888888; font-size: 13px; margin-bottom: 8px;">رمز التحقق المكون من 6 أرقام (أدخله في التطبيق):</p>
        <div style="display: inline-block; background-color: #171717; border: 1px dashed #3B82F6; color: #FFFFFF; font-size: 32px; font-weight: bold; letter-spacing: 8px; padding: 12px 28px; border-radius: 8px; margin-bottom: 24px; font-family: monospace;">
          ${codeDisplay}
        </div>

        <div style="margin: 20px 0; border-top: 1px solid #3A3A3A;"></div>

        <p style="color: #888888; font-size: 12px; margin-bottom: 12px;">أو يمكنك الضغط مباشرة على الزر:</p>
        <a href="${resetUrl}" style="display: inline-block; background-color: #FFFFFF; color: #171717; font-weight: bold; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-size: 14px;">
          إعادة تعيين كلمة المرور
        </a>
        <p style="color: #666666; font-size: 11px; word-break: break-all; margin-top: 16px;">
          ${resetUrl}
        </p>
      </div>
    </div>
  `;

  // 1. Brevo
  const brevoApiKey = process.env.BREVO_API_KEY?.trim() || BREVO_FALLBACK_KEY;
  if (brevoApiKey) {
    try {
      const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim() || 'ahmed.abusafieh1@gmail.com';
      const senderName = process.env.BREVO_SENDER_NAME?.trim() || 'Stu.Ai';
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': brevoApiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: senderName, email: senderEmail },
          to: [{ email, name: email.split('@')[0] }],
          subject,
          htmlContent: htmlBody,
          textContent: textBody,
        }),
      });
      if (response.ok) {
        return { success: true };
      }
    } catch (err: any) {
      console.error('[EMAIL] Brevo reset error:', err.message);
    }
  }

  // 2. Resend
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  if (resendApiKey) {
    try {
      const resend = new Resend(resendApiKey);
      const fromEmail = process.env.EMAIL_FROM?.trim() || 'Stu.Ai <onboarding@resend.dev>';
      await resend.emails.send({
        from: fromEmail,
        to: email,
        subject,
        text: textBody,
        html: htmlBody,
      });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  const smtpHost = process.env.SMTP_HOST?.trim();
  if (smtpHost) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      await transporter.sendMail({
        from: process.env.EMAIL_FROM || 'Stu.Ai <noreply@stu.ai>',
        to: email,
        subject,
        text: textBody,
        html: htmlBody,
      });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log(`\n[DEV PASSWORD RESET]`);
    console.log(`To: ${email}`);
    console.log(`Reset Link: ${resetUrl}\n`);
    return { success: true };
  }

  return { success: false, error: 'خدمة البريد غير مهيأة لإرسال رابط إعادة التعيين.' };
}
