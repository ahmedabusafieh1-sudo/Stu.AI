import React, { useState, useRef, useEffect } from 'react';
import {
  Menu,
  Plus,
  Globe,
  HelpCircle,
  BookOpen,
  Network,
  ChevronDown,
  SlidersHorizontal,
} from 'lucide-react';
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

  const [menuOpen, setMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [menuOpen]);

  return (
    <header className="h-14 border-b border-[#3A3A3A] bg-[#171717] px-3 sm:px-4 flex items-center justify-between select-none z-20 shrink-0 relative">
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

      {/* Right Controls: Only Study Notes & "خيارات إضافية" Dropdown */}
      <div className="flex items-center gap-2">
        {/* Study Notes Button - Standalone directly visible */}
        <button
          onClick={() => setNotesModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#232323] hover:bg-[#2B2B2B] text-[#F5F5F5] border border-[#3A3A3A] transition-colors shadow-sm"
          title={t.notesTitle}
        >
          <BookOpen className="w-3.5 h-3.5 text-blue-400" />
          <span>{t.notesButton}</span>
        </button>

        {/* Extra Options Dropdown Menu */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              menuOpen
                ? 'bg-[#2E2E2E] text-white border-white/40 shadow-sm'
                : 'bg-[#232323] hover:bg-[#2B2B2B] text-[#D5D5D5] hover:text-white border-[#3A3A3A]'
            }`}
            title="خيارات إضافية"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400" />
            <span>{t.extraOptions}</span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-[#888888] transition-transform duration-200 ${
                menuOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {/* Floating Dropdown Card */}
          {menuOpen && (
            <div className="absolute left-0 mt-2 w-56 bg-[#1F1F1F] border border-[#3A3A3A] rounded-2xl p-1.5 shadow-2xl z-50 animate-fadeIn text-xs">
              {/* New Chat */}
              <button
                onClick={() => {
                  startNewChat();
                  setMenuOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl font-medium text-white hover:bg-[#2B2B2B] transition-colors text-right"
              >
                <Plus className="w-4 h-4 text-white shrink-0" />
                <span>{t.newChat}</span>
              </button>

              {/* Concept Map */}
              <button
                onClick={() => {
                  setConceptMapOpen(true);
                  setMenuOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl font-medium text-[#E5E5E5] hover:text-white hover:bg-[#2B2B2B] transition-colors text-right"
              >
                <Network className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{t.conceptMapButton}</span>
              </button>

              {/* Quiz */}
              <button
                onClick={() => {
                  setQuizModalOpen(true);
                  setMenuOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl font-medium text-[#E5E5E5] hover:text-white hover:bg-[#2B2B2B] transition-colors text-right"
              >
                <HelpCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>{t.quizButton}</span>
              </button>

              <div className="h-px bg-[#333333] my-1" />

              {/* Google Search Toggle */}
              <button
                onClick={() => {
                  setUseSearchGrounding(!useSearchGrounding);
                }}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl font-medium text-[#E5E5E5] hover:text-white hover:bg-[#2B2B2B] transition-colors text-right"
              >
                <div className="flex items-center gap-2.5">
                  <Globe
                    className={`w-4 h-4 shrink-0 ${
                      useSearchGrounding ? 'text-blue-400 animate-pulse' : 'text-[#888888]'
                    }`}
                  />
                  <span>{t.googleSearch}</span>
                </div>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                    useSearchGrounding
                      ? 'bg-blue-950 text-blue-300 border border-blue-700/60'
                      : 'bg-[#2A2A2A] text-[#777777]'
                  }`}
                >
                  {useSearchGrounding ? 'مفعل' : 'معطل'}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
