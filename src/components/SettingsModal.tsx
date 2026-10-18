import React, { useState, useEffect } from 'react';
import { X, User, Globe, LogOut, Check, Key, ExternalLink } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { user, settings, updateSettings, logout, t } = useAuth();

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [uiLanguage, setUiLanguage] = useState(settings.uiLanguage || 'ar');
  const [preferredExplanationLang, setPreferredExplanationLang] = useState(
    settings.preferredExplanationLang || 'auto'
  );
  const [geminiKey, setGeminiKey] = useState('');
  const [isGeminiActive, setIsGeminiActive] = useState(false);
  const [geminiKeyMsg, setGeminiKeyMsg] = useState('');
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetch('/api/auth/gemini-status')
        .then((res) => res.json())
        .then((data) => {
          if (data.isConfigured) setIsGeminiActive(true);
        })
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateSettings({
      displayName: displayName.trim() || undefined,
      uiLanguage,
      preferredExplanationLang,
    });
    if (geminiKey.trim()) {
      try {
        const res = await fetch('/api/auth/gemini-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ geminiKey: geminiKey.trim() }),
        });
        const data = await res.json();
        if (res.ok) {
          setIsGeminiActive(true);
          setGeminiKeyMsg('تم تفعيل المفتاح بنجاح!');
        } else {
          setGeminiKeyMsg(data.error || 'فشل حفظ المفتاح');
        }
      } catch (err: any) {
        setGeminiKeyMsg(err.message);
      }
    }
    setIsSaved(true);
    setTimeout(() => {
      setIsSaved(false);
      onClose();
    }, 1000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-md bg-[#232323] border border-[#3A3A3A] rounded-2xl p-6 shadow-2xl select-none">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#3A3A3A] mb-5">
          <h3 className="font-bold text-white text-base">{t.settings}</h3>
          <button
            onClick={onClose}
            className="p-1 text-[#888888] hover:text-white rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Settings Form */}
        <form onSubmit={handleSave} className="space-y-4 text-xs">
          {/* Display Name */}
          <div>
            <label className="block text-[#B5B5B5] font-medium mb-1.5">{t.displayName}</label>
            <div className="relative">
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                dir="auto"
                className="w-full bg-[#171717] text-white px-3 py-2.5 rounded-xl border border-[#3A3A3A] focus:outline-none focus:border-white"
              />
              <User className="w-4 h-4 text-[#888888] absolute left-3 top-3" />
            </div>
          </div>

          {/* Interface Language */}
          <div>
            <label className="block text-[#B5B5B5] font-medium mb-1.5">{t.uiLanguage}</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setUiLanguage('ar')}
                className={`py-2 px-3 rounded-xl border text-center font-medium transition-colors ${
                  uiLanguage === 'ar'
                    ? 'bg-white text-black border-white'
                    : 'bg-[#171717] text-[#B5B5B5] border-[#3A3A3A] hover:text-white'
                }`}
              >
                العربية
              </button>
              <button
                type="button"
                onClick={() => setUiLanguage('en')}
                className={`py-2 px-3 rounded-xl border text-center font-medium transition-colors ${
                  uiLanguage === 'en'
                    ? 'bg-white text-black border-white'
                    : 'bg-[#171717] text-[#B5B5B5] border-[#3A3A3A] hover:text-white'
                }`}
              >
                English
              </button>
            </div>
          </div>

          {/* Preferred Explanation Language */}
          <div>
            <label className="block text-[#B5B5B5] font-medium mb-1.5">{t.preferredExplanation}</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'auto', label: t.autoLang },
                { id: 'ar', label: t.arabicLang },
                { id: 'en', label: t.englishLang },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPreferredExplanationLang(item.id as any)}
                  className={`py-2 px-2 rounded-xl border text-center font-medium transition-colors ${
                    preferredExplanationLang === item.id
                      ? 'bg-white text-black border-white'
                      : 'bg-[#171717] text-[#B5B5B5] border-[#3A3A3A] hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Google Gemini AI Key */}
          <div className="pt-2 border-t border-[#3A3A3A]">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[#B5B5B5] font-medium flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-amber-400" />
                <span>مفتاح الذكاء الاصطناعي (Gemini API)</span>
              </label>
              {isGeminiActive && (
                <span className="text-[10px] text-emerald-400 bg-emerald-950/50 border border-emerald-800/60 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Check className="w-2.5 h-2.5" />
                  <span>مفعل</span>
                </span>
              )}
            </div>
            <input
              type="password"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              placeholder={isGeminiActive ? '•••••••••••••••••••• (أدخل مفتاحاً جديداً للتحديث)' : 'الصق مفتاح Google Gemini (AIza...)'}
              className="w-full bg-[#171717] text-white px-3 py-2 rounded-xl border border-[#3A3A3A] font-mono text-xs focus:outline-none focus:border-white"
            />
            <div className="flex items-center justify-between mt-1 text-[11px]">
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 underline flex items-center gap-1"
              >
                <ExternalLink className="w-3 h-3" />
                <span>احصل على مفتاح مجاني من Google</span>
              </a>
              {geminiKeyMsg && <span className="text-amber-400">{geminiKeyMsg}</span>}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-3 border-t border-[#3A3A3A] flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                logout();
                onClose();
              }}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-red-400 hover:text-red-300 hover:bg-red-950/30 rounded-xl transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{t.logout}</span>
            </button>

            <button
              type="submit"
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-white hover:bg-[#e5e5e5] text-black text-xs font-bold transition-all shadow"
            >
              {isSaved ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>تم الحفظ!</span>
                </>
              ) : (
                <span>{t.save}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
