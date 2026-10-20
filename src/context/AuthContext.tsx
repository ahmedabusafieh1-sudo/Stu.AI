import React, { createContext, useContext, useState, useEffect } from 'react';
import { translations, Language } from '../i18n/translations';

export interface User {
  id: string;
  email: string;
  displayName: string;
  isVerified: boolean;
}

export interface UserSettings {
  uiLanguage: Language;
  preferredExplanationLang: 'auto' | 'ar' | 'en';
  searchGroundingDefault: boolean;
}

interface AuthContextType {
  user: User | null;
  settings: UserSettings;
  isLoading: boolean;
  t: (typeof translations)['ar'];
  setUiLanguage: (lang: Language) => Promise<void>;
  login: (email: string, password: string) => Promise<{ success: boolean; needsVerification?: boolean; email?: string; error?: string }>;
  register: (displayName: string, email: string, password: string, confirmPassword: string) => Promise<{ success: boolean; email?: string; error?: string }>;
  verifyOtp: (email: string, code: string) => Promise<{ success: boolean; error?: string }>;
  resendOtp: (email: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  updateSettings: (newSettings: Partial<UserSettings> & { displayName?: string }) => Promise<void>;
  refreshAuth: () => Promise<void>;
}

const getInitialLanguage = (): Language => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('stu_ui_language');
    if (saved === 'ar' || saved === 'en') return saved;
  }
  return 'ar';
};

const defaultSettings: UserSettings = {
  uiLanguage: getInitialLanguage(),
  preferredExplanationLang: 'auto',
  searchGroundingDefault: false,
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<UserSettings>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);

  // Apply RTL/LTR and language to document element
  useEffect(() => {
    const lang = settings.uiLanguage || 'ar';
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [settings.uiLanguage]);

  // Initial session check
  const refreshAuth = async () => {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        if (data.settings) {
          setSettings({
            uiLanguage: data.settings.uiLanguage || 'ar',
            preferredExplanationLang: data.settings.preferredExplanationLang || 'auto',
            searchGroundingDefault: Boolean(data.settings.searchGroundingDefault),
          });
        }
      } else {
        setUser(null);
      }
    } catch (err) {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshAuth();
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        return {
          success: false,
          needsVerification: data.needsVerification,
          email: data.email,
          devOtp: data.devOtp,
          error: data.error || 'فشل تسجيل الدخول',
        };
      }
      setUser(data.user);
      if (data.settings) {
        setSettings({
          uiLanguage: data.settings.uiLanguage || 'ar',
          preferredExplanationLang: data.settings.preferredExplanationLang || 'auto',
          searchGroundingDefault: Boolean(data.settings.searchGroundingDefault),
        });
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  const register = async (displayName: string, email: string, password: string, confirmPassword: string) => {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, email, password, confirmPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'فشل التسجيل' };
      }
      return { success: true, email: data.email, devOtp: data.devOtp };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  const verifyOtp = async (email: string, code: string) => {
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'فشل التحقق من الرمز' };
      }
      setUser(data.user);
      if (data.settings) {
        setSettings({
          uiLanguage: data.settings.uiLanguage || 'ar',
          preferredExplanationLang: data.settings.preferredExplanationLang || 'auto',
          searchGroundingDefault: Boolean(data.settings.searchGroundingDefault),
        });
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  const resendOtp = async (email: string) => {
    try {
      const res = await fetch('/api/auth/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'فشل إعادة الإرسال' };
      }
      return { success: true, devOtp: data.devOtp };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      setSettings(defaultSettings);
    }
  };

  const updateSettings = async (newSettings: Partial<UserSettings> & { displayName?: string }) => {
    try {
      const res = await fetch('/api/auth/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.user) setUser(data.user);
        if (data.settings) {
          setSettings({
            uiLanguage: data.settings.uiLanguage || 'ar',
            preferredExplanationLang: data.settings.preferredExplanationLang || 'auto',
            searchGroundingDefault: Boolean(data.settings.searchGroundingDefault),
          });
        }
      }
    } catch (err) {
      console.error('Failed to update settings:', err);
    }
  };

  const setUiLanguage = async (lang: Language) => {
    setSettings((prev) => ({ ...prev, uiLanguage: lang }));
    if (typeof window !== 'undefined') {
      localStorage.setItem('stu_ui_language', lang);
    }
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    if (user) {
      await updateSettings({ uiLanguage: lang });
    }
  };

  const currentT = translations[settings.uiLanguage] || translations.ar;

  return (
    <AuthContext.Provider
      value={{
        user,
        settings,
        isLoading,
        t: currentT,
        setUiLanguage,
        login,
        register,
        verifyOtp,
        resendOtp,
        logout,
        updateSettings,
        refreshAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
