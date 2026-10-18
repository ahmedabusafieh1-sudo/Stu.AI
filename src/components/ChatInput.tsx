import React, { useState, useRef, useEffect } from 'react';
import {
  Plus,
  Send,
  Square,
  Mic,
  Image as ImageIcon,
  Camera,
  FileUp,
  Globe,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import { AttachmentTray } from './AttachmentTray';
import { VoiceRecorder } from './VoiceRecorder';

export const ChatInput: React.FC = () => {
  const { t } = useAuth();
  const {
    sendMessage,
    isStreaming,
    stopStreaming,
    uploadFiles,
    pendingAttachments,
    useSearchGrounding,
    setUseSearchGrounding,
  } = useChat();

  const [text, setText] = useState('');
  const [isPlusMenuOpen, setPlusMenuOpen] = useState(false);
  const [isVoiceOpen, setVoiceOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const plusMenuRef = useRef<HTMLDivElement>(null);

  // Hidden file inputs
  const photoInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  // Close plus menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
        setPlusMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [text]);

  const handleSend = () => {
    if (isStreaming) {
      stopStreaming();
      return;
    }

    if (text.trim() || pendingAttachments.length > 0) {
      sendMessage(text);
      setText('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // On mobile / touch devices, pressing the keyboard Enter/Arrow should insert a newline, not send!
    const isTouchDevice =
      typeof window !== 'undefined' &&
      ('ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth < 768);

    if (e.key === 'Enter') {
      if (isTouchDevice) {
        // On mobile keyboards, let Enter naturally insert a new line
        return;
      }
      // On desktop physical keyboards, Enter sends, Shift+Enter creates a new line
      if (!e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    }
  };

  // Paste handling for images
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const filesToUpload: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) filesToUpload.push(file);
      }
    }

    if (filesToUpload.length > 0) {
      e.preventDefault();
      uploadFiles(filesToUpload);
    }
  };

  // Drag and drop handling
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  };

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className="p-3 sm:p-4 bg-[#171717] border-t border-[#3A3A3A] shrink-0"
    >
      <div className="max-w-4xl mx-auto relative">
        {/* Attachment Tray above textarea */}
        <AttachmentTray />

        {/* Input Container */}
        <div className="relative flex items-end gap-2 bg-[#2B2B2B] border border-[#3A3A3A] focus-within:border-white/50 rounded-2xl p-2 sm:p-2.5 transition-colors shadow-lg">
          {/* Plus (+) Menu Trigger */}
          <div className="relative shrink-0" ref={plusMenuRef}>
            <button
              onClick={() => setPlusMenuOpen(!isPlusMenuOpen)}
              className="p-2 text-[#B5B5B5] hover:text-white hover:bg-[#3A3A3A] rounded-xl transition-colors focus:outline-none"
              title={t.attachMenu}
              aria-label={t.attachMenu}
            >
              <Plus className="w-5 h-5" />
            </button>

            {/* Plus Popover Menu */}
            {isPlusMenuOpen && (
              <div className="absolute bottom-full mb-2 start-0 rtl:right-0 ltr:left-0 w-56 sm:w-64 max-w-[calc(100vw-2.5rem)] bg-[#232323] border border-[#3A3A3A] rounded-xl shadow-2xl p-1.5 z-50 select-none animate-scaleIn">
                {/* 1. Photos */}
                <button
                  onClick={() => {
                    photoInputRef.current?.click();
                    setPlusMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[#F5F5F5] hover:bg-[#2B2B2B] rounded-lg transition-colors text-right"
                >
                  <ImageIcon className="w-4 h-4 text-blue-400 shrink-0" />
                  <span className="font-medium">{t.attachPhotos}</span>
                </button>

                {/* 2. Camera */}
                <button
                  onClick={() => {
                    cameraInputRef.current?.click();
                    setPlusMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[#F5F5F5] hover:bg-[#2B2B2B] rounded-lg transition-colors text-right"
                >
                  <Camera className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="font-medium">{t.attachCamera}</span>
                </button>

                {/* 3. Document Files */}
                <button
                  onClick={() => {
                    docInputRef.current?.click();
                    setPlusMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[#F5F5F5] hover:bg-[#2B2B2B] rounded-lg transition-colors text-right"
                >
                  <FileUp className="w-4 h-4 text-purple-400 shrink-0" />
                  <span className="font-medium">{t.attachFiles}</span>
                </button>
              </div>
            )}
          </div>

          {/* Hidden File Inputs */}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && uploadFiles(e.target.files)}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => e.target.files && uploadFiles(e.target.files)}
          />
          <input
            ref={docInputRef}
            type="file"
            accept=".pdf,.docx,.pptx,.xlsx,.csv,.txt,.md"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && uploadFiles(e.target.files)}
          />

          {/* Text Input Area */}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder=""
            dir="auto"
            rows={1}
            className="flex-1 bg-transparent text-[#F5F5F5] placeholder-[#888888] text-sm resize-none focus:outline-none max-h-44 py-1.5 px-1 leading-relaxed"
          />

          {/* Google Search Toggle Button */}
          <button
            onClick={() => setUseSearchGrounding(!useSearchGrounding)}
            className={`p-2 rounded-xl transition-colors shrink-0 ${
              useSearchGrounding
                ? 'text-blue-400 bg-blue-950/40 border border-blue-800'
                : 'text-[#888888] hover:text-white hover:bg-[#3A3A3A]'
            }`}
            title={useSearchGrounding ? 'بحث Google مفعل' : 'تفعيل بحث Google'}
          >
            <Globe className="w-4 h-4" />
          </button>

          {/* Microphone Dictation Trigger */}
          <button
            onClick={() => setVoiceOpen(true)}
            disabled={isStreaming}
            className="p-2 text-[#B5B5B5] hover:text-white hover:bg-[#3A3A3A] rounded-xl transition-colors shrink-0 disabled:opacity-50"
            title={t.micDictation}
            aria-label={t.micDictation}
          >
            <Mic className="w-4 h-4" />
          </button>

          {/* Send or Stop Button */}
          <button
            onClick={handleSend}
            disabled={!isStreaming && !text.trim() && pendingAttachments.length === 0}
            className={`p-2 rounded-xl transition-all shrink-0 ${
              isStreaming
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-white hover:bg-[#e5e5e5] text-black disabled:opacity-30 disabled:hover:bg-white'
            }`}
            title={isStreaming ? t.stop : t.send}
            aria-label={isStreaming ? t.stop : t.send}
          >
            {isStreaming ? (
              <Square className="w-4 h-4 fill-current text-white" />
            ) : (
              <Send className="w-4 h-4 fill-current text-black" />
            )}
          </button>
        </div>

        {/* Subtle Disclaimers */}
        <div className="mt-1.5 text-center text-[11px] text-[#777777] select-none">
          {t.unverifiedWarning}
        </div>
      </div>

      {/* Voice Recorder Modal */}
      <VoiceRecorder
        isOpen={isVoiceOpen}
        onClose={() => setVoiceOpen(false)}
        onTranscriptReady={(transcript) => {
          setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }}
      />
    </div>
  );
};
