import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowDown,
  Loader2,
} from 'lucide-react';
import { useAuth } from './context/AuthContext';
import { useChat } from './context/ChatContext';
import { TopNav } from './components/TopNav';
import { Sidebar } from './components/Sidebar';
import { ChatMessage } from './components/ChatMessage';
import { ChatInput } from './components/ChatInput';
import { QuizModal } from './components/QuizModal';
import { NotesModal } from './components/NotesModal';
import { ConceptMapModal } from './components/ConceptMapModal';
import { SettingsModal } from './components/SettingsModal';
import { AuthModal } from './components/AuthModal';

export const App: React.FC = () => {
  const { user, isLoading, t } = useAuth();
  const {
    messages,
    isStreaming,
    streamingContent,
    sendMessage,
    setQuizModalOpen,
  } = useChat();

  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [hasResetToken, setHasResetToken] = useState(() => {
    return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('token');
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logic: only scroll to bottom if user is already near bottom
  const scrollToBottom = (smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
  };

  const handleScroll = () => {
    const container = chatScrollContainerRef.current;
    if (!container) return;
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowScrollBottom(distanceToBottom > 200);
  };

  useEffect(() => {
    if (!showScrollBottom) {
      scrollToBottom(false);
    }
  }, [messages, streamingContent]);

  // Loading Screen
  if (isLoading) {
    return (
      <div className="h-screen-dvh w-full bg-[#171717] flex flex-col items-center justify-center text-white select-none">
        <div className="w-12 h-12 rounded-2xl bg-[#232323] border border-[#3A3A3A] flex items-center justify-center p-2 mb-4 animate-pulse">
          <svg viewBox="0 0 512 512" className="w-full h-full text-white fill-current">
            <path d="M256 120 L390 195 L256 270 L122 195 Z" fill="#F5F5F5" />
            <path d="M256 280 C290 260 350 250 400 258 L400 375 C350 367 290 377 256 400 Z" fill="#3B82F6" />
            <path d="M256 280 C222 260 162 250 112 258 L112 375 C162 367 222 377 256 400 Z" fill="#888888" />
          </svg>
        </div>
        <div className="text-sm font-semibold tracking-wide text-white">Stu.Ai</div>
        <div className="text-xs text-[#888888] mt-1 flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>جاري التحميل...</span>
        </div>
      </div>
    );
  }

  // Pre-Login / Unverified State OR Password Reset Mode: Clean Landing with AuthModal
  if (!user || !user.isVerified || hasResetToken) {
    return (
      <div className="min-h-screen-dvh w-full bg-[#171717] flex items-center justify-center p-4">
        <AuthModal
          initialEmail={user?.email || ''}
          initialTab={hasResetToken ? 'reset' : (user && !user.isVerified ? 'otp' : 'login')}
          onSuccess={() => setHasResetToken(false)}
        />
      </div>
    );
  }

  // Authenticated Main Workspace Layout
  return (
    <div className="h-screen-dvh w-full flex bg-[#171717] text-[#F5F5F5] overflow-hidden">
      {/* Physical Left Sidebar */}
      <Sidebar onOpenSettings={() => setSettingsOpen(true)} />

      {/* Main Chat Workspace */}
      <main className="flex-1 flex flex-col min-w-0 h-full relative">
        {/* Pinned Top Navigation */}
        <TopNav />

        {/* Scrollable Messages Container */}
        <div
          ref={chatScrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto relative scroll-smooth"
        >
          {messages.length === 0 ? (
            /* Empty State / Clean ChatGPT-Style Welcome Screen */
            <div className="max-w-xl mx-auto px-4 py-16 sm:py-28 text-center select-none flex flex-col items-center justify-center">
              <div className="w-16 h-16 rounded-2xl bg-[#232323] border border-[#3A3A3A] flex items-center justify-center p-3 mb-5 shadow-lg">
                <svg viewBox="0 0 512 512" className="w-full h-full text-white fill-current">
                  <path d="M256 120 L390 195 L256 270 L122 195 Z" fill="#F5F5F5" />
                  <path d="M256 280 C290 260 350 250 400 258 L400 375 C350 367 290 377 256 400 Z" fill="#3B82F6" />
                  <path d="M256 280 C222 260 162 250 112 258 L112 375 C162 367 222 377 256 400 Z" fill="#888888" />
                </svg>
              </div>

              <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
                {t.welcomeTitle}
              </h2>
              <p className="text-sm sm:text-base text-[#B5B5B5] max-w-md mx-auto leading-relaxed">
                {t.welcomeSubtitle}
              </p>
            </div>
          ) : (
            /* Message List */
            <div className="max-w-4xl mx-auto py-2">
              {messages.map((msg) => (
                <ChatMessage key={msg.id} message={msg} />
              ))}

              {/* Streaming Assistant Response */}
              {isStreaming && (
                <div className="py-4 px-4 sm:px-6 flex flex-col items-start animate-fadeIn">
                  <div className="max-w-[92%] sm:max-w-[85%] rounded-2xl px-4 py-3 bg-[#1E1E1E] text-[#F5F5F5] border border-[#2B2B2B] shadow-sm">
                    <div dir="auto" className="break-words select-text">
                      {streamingContent ? (
                        <p className="text-[15px] sm:text-base text-[#F5F5F5] leading-[1.75] whitespace-pre-wrap">
                          {streamingContent}
                          <span className="inline-block w-1.5 h-4 mr-1 bg-blue-400 animate-pulse align-middle" />
                        </p>
                      ) : (
                        <div className="flex items-center gap-1.5 py-1 px-1">
                          <div className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" />
                          <div className="w-2 h-2 rounded-full bg-blue-400 animate-bounce [animation-delay:0.15s]" />
                          <div className="w-2 h-2 rounded-full bg-blue-400 animate-bounce [animation-delay:0.3s]" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} className="h-4" />
            </div>
          )}
        </div>

        {/* Floating "Scroll to Bottom" pill */}
        {showScrollBottom && (
          <button
            onClick={() => scrollToBottom(true)}
            className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#232323] hover:bg-[#2B2B2B] text-white text-xs font-medium border border-[#3A3A3A] shadow-xl transition-all"
          >
            <ArrowDown className="w-3.5 h-3.5" />
            <span>{t.scrollToBottom}</span>
          </button>
        )}

        {/* Fixed Chat Input */}
        <ChatInput />
      </main>

      {/* Interactive Quiz Modal */}
      <QuizModal />

      {/* Study Notes Modal */}
      <NotesModal />

      {/* Smart Concept Map Modal */}
      <ConceptMapModal />

      {/* User Settings Modal */}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
};
