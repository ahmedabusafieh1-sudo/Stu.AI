import React, { useState, useEffect } from 'react';
import { Mail, Lock, User, Eye, EyeOff, Loader2, ArrowLeft, CheckCircle2, Globe } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface AuthModalProps {
  initialTab?: 'login' | 'register' | 'otp' | 'forgot' | 'reset';
  initialEmail?: string;
  onSuccess?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  initialTab = 'login',
  initialEmail = '',
  onSuccess,
}) => {
  const { t, settings, setUiLanguage, login, register, verifyOtp, resendOtp } = useAuth();

  const [activeTab, setActiveTab] = useState<'login' | 'register' | 'otp' | 'forgot' | 'reset'>(initialTab);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [devOtp, setDevOtp] = useState<string | null>(null);

  // Password reset token and fields
  const [resetToken, setResetToken] = useState<string>(() => {
    return (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('token') : null) || '';
  });
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      setResetToken(token);
      setActiveTab('reset');
      setErrorMessage(null);
    }
  }, []);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  const startCooldown = () => {
    setResendCooldown(60);
    const interval = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    const result = await login(email, password);
    setIsLoading(false);

    if (result.success) {
      if (onSuccess) onSuccess();
    } else if (result.needsVerification) {
      setActiveTab('otp');
      startCooldown();
      if (result.devOtp) setDevOtp(result.devOtp);
      setSuccessMessage(result.devOtp ? 'تم توليد كود التحقق لتفعيل حسابك.' : 'لقد أرسلنا رمز تحقق جديداً إلى بريدك الإلكتروني.');
    } else {
      setErrorMessage(result.error || 'فشل تسجيل الدخول');
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (password.length < 12) {
      setErrorMessage('يجب ألا تقل كلمة المرور عن 12 حرفاً.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('كلمتا المرور غير متطابقتين.');
      return;
    }

    setIsLoading(true);
    const result = await register(displayName, email, password, confirmPassword);
    setIsLoading(false);

    if (result.success) {
      setActiveTab('otp');
      startCooldown();
      if (result.devOtp) setDevOtp(result.devOtp);
      setSuccessMessage(result.devOtp ? 'تم إنشاء الحساب بنجاح، كود التحقق الفوري معروض أدناه.' : 'تم إنشاء الحساب وإرسال رمز التحقق إلى بريدك الإلكتروني.');
    } else {
      setErrorMessage(result.error || 'فشل التسجيل.');
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (otpCode.length !== 6) {
      setErrorMessage('رمز التحقق يجب أن يتكون من 6 أرقام.');
      return;
    }

    setIsLoading(true);
    const result = await verifyOtp(email, otpCode);
    setIsLoading(false);

    if (result.success) {
      if (onSuccess) onSuccess();
    } else {
      setErrorMessage(result.error || 'رمز التحقق غير صحيح.');
    }
  };

  const handleResendOtp = async () => {
    if (resendCooldown > 0) return;
    setErrorMessage(null);
    setIsLoading(true);

    const result = await resendOtp(email);
    setIsLoading(false);

    if (result.success) {
      startCooldown();
      if (result.devOtp) setDevOtp(result.devOtp);
      setSuccessMessage(result.devOtp ? 'تم توليد كود تحقق جديد للتفعيل الفوري.' : 'تم إرسال رمز تحقق جديد إلى بريدك الإلكتروني.');
    } else {
      setErrorMessage(result.error || 'فشل إعادة الإرسال.');
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'حدث خطأ أثناء إرسال الرمز.');
      }
      setSuccessMessage(data.message || 'تم إرسال رمز التحقق المكون من 6 أرقام إلى بريدك الإلكتروني.');
      setActiveTab('reset');
    } catch (err: any) {
      setErrorMessage(err.message || 'حدث خطأ.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!resetToken || !resetToken.trim()) {
      setErrorMessage('يرجى إدخال رمز التحقق المكون من 6 أرقام أو رابط الاستعادة.');
      return;
    }
    if (newPassword.length < 12) {
      setErrorMessage('يجب ألا تقل كلمة المرور الجديدة عن 12 حرفاً.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setErrorMessage('كلمتا المرور غير متطابقتين.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: resetToken.trim(),
          newPassword,
          confirmPassword: confirmNewPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'فشل تغيير كلمة المرور');
      }
      setSuccessMessage('تم تغيير كلمة المرور بنجاح! يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.');
      window.history.replaceState({}, document.title, window.location.pathname);
      setActiveTab('login');
      setPassword('');
      setConfirmPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setResetToken('');
    } catch (err: any) {
      setErrorMessage(err.message || 'حدث خطأ أثناء تغيير كلمة المرور.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-[#232323] border border-[#3A3A3A] rounded-2xl p-6 sm:p-8 shadow-2xl select-none">
      {/* Language Switcher Pill */}
      <div className="flex items-center justify-between mb-5 pb-3 border-b border-[#333333]">
        <div className="flex items-center gap-1.5 text-xs text-[#888888]">
          <Globe className="w-3.5 h-3.5 text-blue-400" />
          <span>{t.uiLanguage}</span>
        </div>
        <div className="inline-flex p-0.5 bg-[#171717] rounded-lg border border-[#3A3A3A] text-xs">
          <button
            type="button"
            onClick={() => setUiLanguage('ar')}
            className={`px-2.5 py-1 rounded-md font-medium transition-all ${
              settings.uiLanguage === 'ar'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-[#888888] hover:text-white'
            }`}
          >
            🇸🇦 العربية
          </button>
          <button
            type="button"
            onClick={() => setUiLanguage('en')}
            className={`px-2.5 py-1 rounded-md font-medium transition-all ${
              settings.uiLanguage === 'en'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-[#888888] hover:text-white'
            }`}
          >
            🇺🇸 English
          </button>
        </div>
      </div>

      {/* Branding Header */}
      <div className="text-center mb-6">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-[#171717] border border-[#3A3A3A] flex items-center justify-center p-2 mb-3 shadow">
          <svg viewBox="0 0 512 512" className="w-full h-full text-white fill-current">
            <path d="M256 120 L390 195 L256 270 L122 195 Z" fill="#F5F5F5" />
            <path d="M256 280 C290 260 350 250 400 258 L400 375 C350 367 290 377 256 400 Z" fill="#3B82F6" />
            <path d="M256 280 C222 260 162 250 112 258 L112 375 C162 367 222 377 256 400 Z" fill="#888888" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-white tracking-wide">
          Stu<span className="text-blue-400">.Ai</span>
        </h2>
        <p className="text-xs text-[#888888] mt-1">{t.appTagline}</p>
      </div>

      {/* Tabs Switcher for Login / Register */}
      {(activeTab === 'login' || activeTab === 'register') && (
        <div className="grid grid-cols-2 gap-1 p-1 bg-[#171717] border border-[#3A3A3A] rounded-xl mb-6 text-xs">
          <button
            type="button"
            onClick={() => {
              setActiveTab('login');
              setErrorMessage(null);
            }}
            className={`py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'login' ? 'bg-[#2B2B2B] text-white shadow' : 'text-[#888888] hover:text-white'
            }`}
          >
            {t.login}
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('register');
              setErrorMessage(null);
            }}
            className={`py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'register' ? 'bg-[#2B2B2B] text-white shadow' : 'text-[#888888] hover:text-white'
            }`}
          >
            {t.register}
          </button>
        </div>
      )}

      {/* Alert Messages */}
      {errorMessage && (
        <div className="p-3 mb-4 bg-red-950/40 border border-red-800 rounded-xl text-red-300 text-xs">
          {errorMessage}
        </div>
      )}
      {successMessage && (
        <div className="p-3 mb-4 bg-emerald-950/40 border border-emerald-800 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* ---------------- 1. LOGIN TAB ---------------- */}
      {activeTab === 'login' && (
        <form onSubmit={handleLogin} className="space-y-4 text-xs">
          <div>
            <label className="block text-[#B5B5B5] font-medium mb-1.5">{t.email}</label>
            <div className="relative">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="student@example.com"
                className="w-full bg-[#171717] text-white px-3 py-2.5 rounded-xl border border-[#3A3A3A] focus:outline-none focus:border-white pl-9"
              />
              <Mail className="w-4 h-4 text-[#888888] absolute left-3 top-3" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[#B5B5B5] font-medium">{t.password}</label>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('forgot');
                  setErrorMessage(null);
                }}
                className="text-[11px] text-blue-400 hover:underline"
              >
                {t.forgotPassword}
              </button>
            </div>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#171717] text-white px-3 py-2.5 rounded-xl border border-[#3A3A3A] focus:outline-none focus:border-white pl-9 pr-9"
              />
              <Lock className="w-4 h-4 text-[#888888] absolute left-3 top-3" />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-3 text-[#888888] hover:text-white"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 rounded-xl bg-white hover:bg-[#e5e5e5] text-black font-bold text-xs transition-all shadow flex items-center justify-center gap-2 disabled:opacity-50 mt-2"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-black" /> : <span>{t.login}</span>}
          </button>
        </form>
      )}

      {/* ---------------- 2. REGISTER TAB ---------------- */}
      {activeTab === 'register' && (
        <form onSubmit={handleRegister} className="space-y-3.5 text-xs">
          <div>
            <label className="block text-[#B5B5B5] font-medium mb-1">{t.displayName}</label>
            <div className="relative">
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="اسم الطالب"
                dir="auto"
                className="w-full bg-[#171717] text-white px-3 py-2.5 rounded-xl border border-[#3A3A3A] focus:outline-none focus:border-white pl-9"
              />
              <User className="w-4 h-4 text-[#888888] absolute left-3 top-3" />
            </div>
          </div>

          <div>
            <label className="block text-[#B5B5B5] font-medium mb-1">{t.email}</label>
            <div className="relative">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="student@example.com"
                className="w-full bg-[#171717] text-white px-3 py-2.5 rounded-xl border border-[#3A3A3A] focus:outline-none focus:border-white pl-9"
              />
              <Mail className="w-4 h-4 text-[#888888] absolute left-3 top-3" />
            </div>
          </div>

          <div>
            <label className="block text-[#B5B5B5] font-medium mb-1">
              {t.password} <span className="text-[10px] text-[#888888]">(12 حرفاً على الأقل)</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={12}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#171717] text-white px-3 py-2.5 rounded-xl border border-[#3A3A3A] focus:outline-none focus:border-white pl-9 pr-9"
              />
              <Lock className="w-4 h-4 text-[#888888] absolute left-3 top-3" />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-3 text-[#888888] hover:text-white"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[#B5B5B5] font-medium mb-1">{t.confirmPassword}</label>
            <input
              type="password"
              required
              minLength={12}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full bg-[#171717] text-white px-3 py-2.5 rounded-xl border border-[#3A3A3A] focus:outline-none focus:border-white"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 rounded-xl bg-white hover:bg-[#e5e5e5] text-black font-bold text-xs transition-all shadow flex items-center justify-center gap-2 disabled:opacity-50 mt-2"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-black" /> : <span>{t.register}</span>}
          </button>
        </form>
      )}

      {/* ---------------- 3. OTP VERIFICATION TAB ---------------- */}
      {activeTab === 'otp' && (
        <form onSubmit={handleVerifyOtp} className="space-y-4 text-xs">
          <div className="text-center">
            <h3 className="font-bold text-sm text-white mb-1">{t.verifyEmail}</h3>
            <p className="text-[#888888] text-[11px]">
              أدخل رمز التحقق المرسل إلى: <span className="text-white font-mono">{email}</span>
            </p>
          </div>

          {devOtp && (
            <div
              onClick={() => setOtpCode(devOtp)}
              className="p-3 bg-blue-950/40 border border-blue-600/60 rounded-xl text-center cursor-pointer hover:bg-blue-900/50 transition-all group select-none shadow-sm"
              title="اضغط للتعبئة التلقائية"
            >
              <div className="text-[11px] text-blue-300 font-semibold mb-0.5">
                رمز التفعيل الفوري (وضع التطوير المحلي):
              </div>
              <div className="text-2xl font-mono font-bold tracking-[8px] text-white my-1 group-hover:scale-105 transition-transform">
                {devOtp}
              </div>
              <div className="text-[10px] text-blue-400 underline">
                اضغط هنا لنسخ الرمز وتعبئته مباشرة والدخول
              </div>
            </div>
          )}

          <div>
            <label className="block text-[#B5B5B5] font-medium mb-1.5 text-center">{t.enterCode}</label>
            <input
              type="text"
              required
              maxLength={6}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              className="w-full bg-[#171717] text-white text-center text-2xl font-mono tracking-[10px] py-3 rounded-xl border border-[#3A3A3A] focus:outline-none focus:border-white"
              autoFocus
            />
          </div>

          <button
            type="submit"
            disabled={isLoading || otpCode.length !== 6}
            className="w-full py-3 rounded-xl bg-white hover:bg-[#e5e5e5] text-black font-bold text-xs transition-all shadow flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-black" /> : <span>{t.verifyButton}</span>}
          </button>

          <div className="flex items-center justify-between text-[11px] pt-2 text-[#888888]">
            <button
              type="button"
              onClick={handleResendOtp}
              disabled={resendCooldown > 0 || isLoading}
              className="text-blue-400 hover:underline disabled:opacity-50 disabled:no-underline"
            >
              {resendCooldown > 0 ? t.resendIn.replace('{seconds}', resendCooldown.toString()) : t.resendCode}
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('register');
                setOtpCode('');
                setErrorMessage(null);
              }}
              className="hover:text-white"
            >
              {t.editEmail}
            </button>
          </div>
        </form>
      )}

      {/* ---------------- 4. FORGOT PASSWORD TAB ---------------- */}
      {activeTab === 'forgot' && (
        <form onSubmit={handleForgotPassword} className="space-y-4 text-xs">
          <div className="text-center">
            <h3 className="font-bold text-sm text-white mb-1">{t.forgotPassword}</h3>
            <p className="text-[#888888] text-[11px]">
              أدخل بريدك الإلكتروني وسنرسل لك رابطاً آمناً لإعادة تعيين كلمة المرور.
            </p>
          </div>

          <div>
            <label className="block text-[#B5B5B5] font-medium mb-1.5">{t.email}</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="student@example.com"
              className="w-full bg-[#171717] text-white px-3 py-2.5 rounded-xl border border-[#3A3A3A] focus:outline-none focus:border-white"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 rounded-xl bg-white hover:bg-[#e5e5e5] text-black font-bold text-xs transition-all shadow flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-black" /> : <span>إرسال الرابط</span>}
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('login');
              setErrorMessage(null);
            }}
            className="w-full text-center text-[11px] text-[#888888] hover:text-white pt-2 flex items-center justify-center gap-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>العودة لتسجيل الدخول</span>
          </button>
        </form>
      )}

      {/* ---------------- 5. RESET PASSWORD TAB ---------------- */}
      {activeTab === 'reset' && (
        <form onSubmit={handleResetPassword} className="space-y-4 text-xs">
          <div className="text-center">
            <h3 className="font-bold text-sm text-white mb-1">تعيين كلمة مرور جديدة</h3>
            <p className="text-[#888888] text-[11px]">
              أدخل رمز التحقق (6 أرقام) المرسل إلى بريدك مع كلمة المرور الجديدة.
            </p>
          </div>

          <div>
            <label className="block text-[#B5B5B5] font-medium mb-1">
              رمز التحقق (6 أرقام) أو رمز الاستعادة
            </label>
            <div className="relative">
              <input
                type="text"
                required
                value={resetToken}
                onChange={(e) => setResetToken(e.target.value)}
                placeholder="مثال: 123456"
                dir="ltr"
                className="w-full bg-[#171717] text-white px-3 py-2.5 rounded-xl border border-[#3A3A3A] focus:outline-none focus:border-white font-mono text-center tracking-widest text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-[#B5B5B5] font-medium mb-1">
              كلمة المرور الجديدة <span className="text-[10px] text-[#888888]">(12 حرفاً على الأقل)</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={12}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full bg-[#171717] text-white px-3 py-2.5 rounded-xl border border-[#3A3A3A] focus:outline-none focus:border-white pl-9 pr-9"
              />
              <Lock className="w-4 h-4 text-[#888888] absolute left-3 top-3" />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-3 text-[#888888] hover:text-white"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[#B5B5B5] font-medium mb-1">تأكيد كلمة المرور الجديدة</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={12}
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                className="w-full bg-[#171717] text-white px-3 py-2.5 rounded-xl border border-[#3A3A3A] focus:outline-none focus:border-white pl-9"
              />
              <Lock className="w-4 h-4 text-[#888888] absolute left-3 top-3" />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 rounded-xl bg-white hover:bg-[#e5e5e5] text-black font-bold text-xs transition-all shadow flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-black" /> : <span>حفظ كلمة المرور الجديدة</span>}
          </button>

          <button
            type="button"
            onClick={() => {
              window.history.replaceState({}, document.title, window.location.pathname);
              setActiveTab('login');
              setErrorMessage(null);
            }}
            className="w-full text-center text-[11px] text-[#888888] hover:text-white pt-2 flex items-center justify-center gap-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>العودة لتسجيل الدخول</span>
          </button>
        </form>
      )}
    </div>
  );
};
