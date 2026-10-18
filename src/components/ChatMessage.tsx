import React, { useState } from 'react';
import katex from 'katex';
import {
  Copy,
  Check,
  RefreshCw,
  Zap,
  BookOpen,
  FileText,
  HelpCircle,
  ExternalLink,
  File,
  Paperclip,
  Key,
} from 'lucide-react';
import { ChatMessage as ChatMessageType, useChat } from '../context/ChatContext';
import { useAuth } from '../context/AuthContext';

interface ChatMessageProps {
  message: ChatMessageType;
}

// ----------------------------------------------------
// KaTeX & Markdown Formatter
// ----------------------------------------------------
function renderFormattedContent(content: string) {
  if (!content) return null;

  // Split content by KaTeX block math $$...$$ and inline $...$
  const parts: React.ReactNode[] = [];
  const lines = content.split('\n');

  lines.forEach((line, lineIdx) => {
    // Process math equations in line
    const regex = /(\$\$[\s\S]*?\$\$|\$[^\$\n]+?\$)/g;
    const tokens = line.split(regex);

    const renderedTokens = tokens.map((token, tokenIdx) => {
      if (token.startsWith('$$') && token.endsWith('$$')) {
        const math = token.slice(2, -2).trim();
        try {
          const html = katex.renderToString(math, { displayMode: true, throwOnError: false });
          return (
            <div
              key={`block-${lineIdx}-${tokenIdx}`}
              className="my-2 overflow-x-auto py-1"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        } catch {
          return <code key={tokenIdx}>{token}</code>;
        }
      } else if (token.startsWith('$') && token.endsWith('$')) {
        const math = token.slice(1, -1).trim();
        try {
          const html = katex.renderToString(math, { displayMode: false, throwOnError: false });
          return (
            <span
              key={`inline-${lineIdx}-${tokenIdx}`}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        } catch {
          return <code key={tokenIdx}>{token}</code>;
        }
      }

      // Format bold, italics, citations
      return formatInlineText(token, `${lineIdx}-${tokenIdx}`);
    });

    // Check for educational headings / list items
    if (line.startsWith('### ')) {
      parts.push(
        <h4 key={lineIdx} className="text-sm font-bold text-white mt-3 mb-1">
          {line.replace('### ', '')}
        </h4>
      );
    } else if (line.startsWith('## ')) {
      parts.push(
        <h3 key={lineIdx} className="text-base font-bold text-blue-400 mt-4 mb-2 border-b border-[#3A3A3A] pb-1">
          {line.replace('## ', '')}
        </h3>
      );
    } else if (line.startsWith('# ')) {
      parts.push(
        <h2 key={lineIdx} className="text-lg font-bold text-white mt-4 mb-2">
          {line.replace('# ', '')}
        </h2>
      );
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      parts.push(
        <li key={lineIdx} className="mr-4 my-1 list-disc text-sm text-[#F5F5F5]">
          {renderedTokens}
        </li>
      );
    } else if (/^\d+\.\s/.test(line)) {
      parts.push(
        <li key={lineIdx} className="mr-4 my-1 list-decimal text-sm text-[#F5F5F5]">
          {renderedTokens}
        </li>
      );
    } else if (line.trim() === '') {
      parts.push(<div key={lineIdx} className="h-2" />);
    } else {
      parts.push(
        <p key={lineIdx} className="my-1 text-sm text-[#F5F5F5] leading-relaxed">
          {renderedTokens}
        </p>
      );
    }
  });

  return <div className="space-y-0.5">{parts}</div>;
}

function formatInlineText(text: string, keyPrefix: string): React.ReactNode {
  // Bold **text**
  const boldRegex = /(\*\*.*?\*\*)/g;
  const segments = text.split(boldRegex);

  return segments.map((seg, i) => {
    if (seg.startsWith('**') && seg.endsWith('**')) {
      return (
        <strong key={`${keyPrefix}-b-${i}`} className="font-semibold text-white">
          {seg.slice(2, -2)}
        </strong>
      );
    }

    // Highlight citations e.g. [filename, page X]
    const citationRegex = /(\[[^\]]+?(?:,\s*(?:صفحة|ص|page|slide|شريحة)\s*\d+)?\])/gi;
    const subSegments = seg.split(citationRegex);

    return subSegments.map((sub, j) => {
      if (sub.startsWith('[') && sub.endsWith(']')) {
        return (
          <span
            key={`${keyPrefix}-c-${j}`}
            className="inline-block px-1.5 py-0.5 mx-0.5 text-[11px] font-mono bg-[#2B2B2B] text-blue-300 border border-[#3A3A3A] rounded"
          >
            {sub}
          </span>
        );
      }
      return sub;
    });
  });
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const { t } = useAuth();
  const { sendMessage, retryLastMessage, setQuizModalOpen } = useChat();
  const [copied, setCopied] = useState(false);
  const [inputKey, setInputKey] = useState('');
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [keyError, setKeyError] = useState('');
  const [keySuccess, setKeySuccess] = useState(false);

  const isUser = message.role === 'user';
  const isFailed = message.status === 'failed';
  const isGeminiMissing =
    isFailed &&
    (message.content.includes('GEMINI_API_KEY') ||
      message.content.includes('خدمة الذكاء الاصطناعي') ||
      message.content.includes('Gemini'));

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveGeminiKey = async () => {
    if (!inputKey.trim()) return;
    setIsSavingKey(true);
    setKeyError('');
    try {
      const res = await fetch('/api/auth/gemini-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geminiKey: inputKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'فشل حفظ المفتاح');
      }
      setKeySuccess(true);
      setTimeout(async () => {
        await retryLastMessage();
      }, 500);
    } catch (err: any) {
      setKeyError(err.message);
    } finally {
      setIsSavingKey(false);
    }
  };

  return (
    <div className={`py-4 px-4 sm:px-6 flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[92%] sm:max-w-[85%] rounded-2xl px-4 py-3.5 transition-all shadow-sm ${
          isUser
            ? 'bg-[#2B2B2B] text-white border border-[#3A3A3A]'
            : 'bg-[#1E1E1E] text-[#F5F5F5] border border-[#2B2B2B]'
        }`}
      >
        {/* User Attachments Preview */}
        {message.attachments && message.attachments.length > 0 && (
          <div className={`flex flex-wrap gap-2.5 ${message.content?.trim() ? 'mb-3 pb-2.5 border-b border-[#3A3A3A]' : ''}`}>
            {message.attachments.map((att) => {
              const isImage = att.mimeType?.startsWith('image/');
              if (isImage) {
                return (
                  <a
                    key={att.id}
                    href={`/api/attachments/${att.id}/content`}
                    target="_blank"
                    rel="noreferrer"
                    className="group relative block overflow-hidden rounded-xl border border-[#3A3A3A] hover:border-blue-400/60 transition-all shadow-md bg-[#171717]"
                  >
                    <img
                      src={`/api/attachments/${att.id}/content`}
                      alt="صورة مرفقة"
                      className="w-24 h-24 sm:w-32 sm:h-32 object-cover group-hover:scale-105 transition-transform duration-200"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <ExternalLink className="w-5 h-5 text-white drop-shadow" />
                    </div>
                  </a>
                );
              }
              return (
                <a
                  key={att.id}
                  href={`/api/attachments/${att.id}/content`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#232323] hover:bg-[#2B2B2B] border border-[#3A3A3A] text-xs text-blue-300 transition-colors"
                >
                  <Paperclip className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate max-w-[140px]">{att.originalName}</span>
                  <span className="text-[10px] text-[#888888]">
                    ({(att.sizeBytes / 1024).toFixed(0)} KB)
                  </span>
                </a>
              );
            })}
          </div>
        )}

        {/* Message Content */}
        {message.content?.trim() ? (
          <div dir="auto" className="break-words select-text">
            {renderFormattedContent(message.content)}
          </div>
        ) : null}

        {/* Google Search Sources Grounding Box */}
        {!isUser && message.searchGrounding?.sources && message.searchGrounding.sources.length > 0 && (
          <div className="mt-3 pt-2.5 border-t border-[#3A3A3A] text-xs">
            <div className="text-[#888888] font-medium mb-1.5 flex items-center gap-1">
              <span>{t.searchSources}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {message.searchGrounding.sources.map((s: any, idx: number) => (
                <a
                  key={idx}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 px-2 py-1 rounded bg-[#171717] hover:bg-[#232323] border border-[#3A3A3A] text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <ExternalLink className="w-3 h-3 shrink-0" />
                  <span className="truncate max-w-[180px]">{s.title || s.url}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Verified Document Citations Box */}
        {!isUser && message.citations && message.citations.length > 0 && (
          <div className="mt-3 pt-2 border-t border-[#3A3A3A] text-xs">
            <div className="text-[#888888] font-medium mb-1 flex items-center gap-1">
              <span>{t.verifiedSources}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {message.citations.map((c: any, idx: number) => (
                <span
                  key={idx}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border ${
                    c.isVerified
                      ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/50'
                      : 'bg-amber-950/40 text-amber-300 border-amber-800/50'
                  }`}
                >
                  <span>{c.sourceName}</span>
                  {c.unitIndex && <span>(ص {c.unitIndex})</span>}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Action Toolbar for Assistant Messages */}
        {!isUser && !isFailed && message.status === 'complete' && (
          <div className="mt-2 pt-1.5 flex items-center justify-end border-t border-[#2B2B2B]/60 text-xs text-[#888888]">
            {/* Copy Button */}
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[#2B2B2B] hover:text-white transition-colors"
              title={t.copy}
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span className="text-[11px]">{copied ? t.copied : t.copy}</span>
            </button>
          </div>
        )}

        {/* Failed Message Retry & Gemini Key Helper */}
        {isFailed && (
          <div className="mt-2.5 space-y-2">
            {isGeminiMissing ? (
              <div className="p-3.5 rounded-xl bg-[#171717] border border-amber-600/40 text-xs text-right space-y-2.5 select-none">
                <div className="flex items-center gap-2 font-bold text-amber-400">
                  <Key className="w-4 h-4 shrink-0" />
                  <span>تفعيل مفتاح Google Gemini للذكاء الاصطناعي</span>
                </div>
                <p className="text-[#B5B5B5] leading-relaxed text-[11px]">
                  مفتاح Brevo الذي أدخلته مربوط بنجاح لإرسال رسائل التحقق عبر البريد الإلكتروني 📧.
                  <br />
                  للدردشة مع الذكاء الاصطناعي، يرجى إدخال مفتاح <strong>Google Gemini</strong> المجاني (يبدأ عادة بـ <code className="bg-[#2B2B2B] px-1 py-0.5 rounded text-white font-mono">AIza...</code>).
                </p>
                <div>
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-blue-400 hover:text-blue-300 font-medium underline text-xs"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>الحصول على مفتاح مجاني فوراً من Google AI Studio</span>
                  </a>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="password"
                    value={inputKey}
                    onChange={(e) => {
                      setInputKey(e.target.value);
                      setKeyError('');
                    }}
                    placeholder="الصق مفتاح Gemini هنا (AIza...)"
                    className="flex-1 bg-[#232323] text-white px-3 py-1.5 rounded-lg border border-[#3A3A3A] text-xs font-mono focus:outline-none focus:border-amber-400"
                  />
                  <button
                    onClick={handleSaveGeminiKey}
                    disabled={isSavingKey || !inputKey.trim()}
                    className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold rounded-lg text-xs transition-colors shrink-0 flex items-center gap-1"
                  >
                    <Key className="w-3 h-3" />
                    <span>{isSavingKey ? 'جاري التفعيل...' : keySuccess ? 'تم الحفظ!' : 'حفظ وتفعيل'}</span>
                  </button>
                </div>
                {keyError && <div className="text-red-400 text-[11px] font-medium">{keyError}</div>}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={retryLastMessage}
                  className="flex items-center gap-1.5 px-3 py-1 bg-red-900/40 hover:bg-red-900/60 text-red-200 border border-red-800 rounded-lg text-xs font-semibold transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>{t.retry}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
