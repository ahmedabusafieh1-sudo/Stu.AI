import React from 'react';
import { Menu, Plus, Globe, HelpCircle, BookOpen, Network } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';

export const TopNav: React.FC = () => {
  const { t } = useAuth();
  const {
    isSidebarOpen,
    setSidebarOpen,
    startNewChat,
    useSearchGrounding,
    setUseSearchGrounding,
    setQuizModalOpen,
    setNotesModalOpen,
    setConceptMapOpen,
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

      {/* Right Controls: Horizontally scrollable and swipeable on mobile */}
      <div className="flex-1 flex items-center justify-end overflow-x-auto no-scrollbar scroll-smooth min-w-0 pr-1 pl-2">
        <div className="flex items-center gap-2 shrink-0 flex-nowrap py-1">
          {/* Google Search Toggle */}
          <button
            onClick={() => setUseSearchGrounding(!useSearchGrounding)}
            className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
              useSearchGrounding
                ? 'bg-blue-900/30 text-blue-300 border-blue-500/50 shadow-sm'
                : 'bg-[#232323] text-[#B5B5B5] border-[#3A3A3A] hover:text-white'
            }`}
            title="تفعيل/تعطيل بحث Google للحقائق المستجدة"
          >
            <Globe className={`w-3.5 h-3.5 ${useSearchGrounding ? 'text-blue-400 animate-pulse' : ''}`} />
            <span className="inline">{t.googleSearch}</span>
          </button>

          {/* Study Notes Button */}
          <button
            onClick={() => setNotesModalOpen(true)}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#232323] hover:bg-[#2B2B2B] text-[#F5F5F5] border border-[#3A3A3A] transition-colors shadow-sm whitespace-nowrap"
            title={t.notesTitle}
          >
            <BookOpen className="w-3.5 h-3.5 text-blue-400" />
            <span>{t.notesButton}</span>
          </button>

          {/* Concept Map Button */}
          <button
            onClick={() => setConceptMapOpen(true)}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#232323] hover:bg-[#2B2B2B] text-[#F5F5F5] border border-[#3A3A3A] transition-colors shadow-sm whitespace-nowrap"
            title={t.conceptMapTitle}
          >
            <Network className="w-3.5 h-3.5 text-emerald-400" />
            <span>{t.conceptMapButton}</span>
          </button>

          {/* Quiz Button */}
          <button
            onClick={() => setQuizModalOpen(true)}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#232323] hover:bg-[#2B2B2B] text-[#F5F5F5] border border-[#3A3A3A] transition-colors whitespace-nowrap"
            title="إنشاء كويز تفاعلي من مصادرك"
          >
            <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
            <span>{t.quizButton}</span>
          </button>

          {/* New Chat Button */}
          <button
            onClick={() => startNewChat()}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-black hover:bg-[#e5e5e5] shadow transition-colors whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t.newChat}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
