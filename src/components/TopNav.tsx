import React from 'react';
import { Menu, Plus, Globe, HelpCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';

export const TopNav: React.FC = () => {
  const { t } = useAuth();
  const {
    isSidebarOpen,
    setSidebarOpen,
    createNewConversation,
    useSearchGrounding,
    setUseSearchGrounding,
    setQuizModalOpen,
  } = useChat();

  return (
    <header className="h-14 border-b border-[#3A3A3A] bg-[#171717] px-4 flex items-center justify-between select-none z-20 shrink-0">
      {/* Left: ☰ Menu button & Logo */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setSidebarOpen(!isSidebarOpen)}
          className="p-2 -mr-1 rounded-lg text-[#B5B5B5] hover:text-white hover:bg-[#232323] transition-colors focus:outline-none focus:ring-1 focus:ring-white"
          title="القائمة"
          aria-label="القائمة الجانبية"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 cursor-default select-none">
          {/* Stu.Ai Minimalist Knowledge Logo */}
          <div className="w-7 h-7 rounded-lg bg-[#232323] border border-[#3A3A3A] flex items-center justify-center p-1 shadow-sm">
            <svg viewBox="0 0 512 512" className="w-full h-full text-white fill-current">
              <path d="M256 120 L390 195 L256 270 L122 195 Z" fill="#F5F5F5" />
              <path d="M256 280 C290 260 350 250 400 258 L400 375 C350 367 290 377 256 400 Z" fill="#3B82F6" />
              <path d="M256 280 C222 260 162 250 112 258 L112 375 C162 367 222 377 256 400 Z" fill="#888888" />
            </svg>
          </div>
          <span className="font-bold text-base tracking-wide text-white font-sans">
            Stu<span className="text-blue-400">.Ai</span>
          </span>
        </div>
      </div>

      {/* Right Controls: Google Search Grounding toggle, Quiz shortcut, New Chat */}
      <div className="flex items-center gap-2">
        {/* Google Search Toggle */}
        <button
          onClick={() => setUseSearchGrounding(!useSearchGrounding)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            useSearchGrounding
              ? 'bg-blue-900/30 text-blue-300 border-blue-500/50 shadow-sm'
              : 'bg-[#232323] text-[#B5B5B5] border-[#3A3A3A] hover:text-white'
          }`}
          title="تفعيل/تعطيل بحث Google للحقائق المستجدة"
        >
          <Globe className={`w-3.5 h-3.5 ${useSearchGrounding ? 'text-blue-400 animate-pulse' : ''}`} />
          <span className="hidden sm:inline">{t.googleSearch}</span>
        </button>

        {/* Quiz Button */}
        <button
          onClick={() => setQuizModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#232323] hover:bg-[#2B2B2B] text-[#F5F5F5] border border-[#3A3A3A] transition-colors"
          title="إنشاء كويز تفاعلي من مصادرك"
        >
          <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
          <span>{t.quizButton}</span>
        </button>

        {/* New Chat Button */}
        <button
          onClick={() => createNewConversation()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-black hover:bg-[#e5e5e5] shadow transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{t.newChat}</span>
        </button>
      </div>
    </header>
  );
};
