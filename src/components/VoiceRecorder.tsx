import React, { useState, useEffect, useRef } from 'react';
import { Square, X, Mic, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface VoiceRecorderProps {
  isOpen: boolean;
  onClose: () => void;
  onTranscriptReady: (text: string) => void;
}

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
  isOpen,
  onClose,
  onTranscriptReady,
}) => {
  const { t } = useAuth();
  const [seconds, setSeconds] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (isOpen) {
      startRecording();
    } else {
      cleanup();
    }
    return () => cleanup();
  }, [isOpen]);

  const cleanup = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {}
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setSeconds(0);
    audioChunksRef.current = [];
    setErrorMessage(null);
  };

  const startRecording = async () => {
    setErrorMessage(null);
    setSeconds(0);
    audioChunksRef.current = [];

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('متصفحك لا يدعم تسجيل الصوت أو يتطلب اتصال HTTPS آمن.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Supported mime check
      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4';
      }

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        if (!isTranscribing) {
          // Process audio
        }
      };

      recorder.start(250); // Slice chunks every 250ms

      // Start timer: limit 120 seconds (2 minutes)
      timerRef.current = setInterval(() => {
        setSeconds((prev) => {
          if (prev >= 119) {
            stopAndTranscribe();
            return 120;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err: any) {
      console.error('[VOICE_REC_ERR]', err);
      setErrorMessage(
        err.name === 'NotAllowedError'
          ? 'تم رفض إذن الوصول إلى الميكروفون. يرجى تفعيل الإذن من إعدادات المتصفح.'
          : err.message || 'فشل بدء تسجيل الصوت.'
      );
    }
  };

  const stopAndTranscribe = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') return;

    setIsTranscribing(true);

    mediaRecorderRef.current.stop();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    // Wait a brief moment for last chunk
    await new Promise((r) => setTimeout(r, 300));

    const audioBlob = new Blob(audioChunksRef.current, {
      type: mediaRecorderRef.current.mimeType || 'audio/webm',
    });

    if (audioBlob.size < 500) {
      setErrorMessage('التسجيل قصير جداً أو لم يلتقط صوتاً.');
      setIsTranscribing(false);
      return;
    }

    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');

      const res = await fetch('/api/chat/transcribe', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'فشل التفريغ الصوتي');
      }

      if (data.text) {
        onTranscriptReady(data.text);
      }
      onClose();
    } catch (err: any) {
      console.error('[TRANSCRIBE_ERR]', err);
      setErrorMessage(err.message || 'حدث خطأ أثناء تفريغ الصوت.');
    } finally {
      setIsTranscribing(false);
    }
  };

  const cancelRecording = () => {
    cleanup();
    onClose();
  };

  if (!isOpen) return null;

  const formatTime = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-md bg-[#232323] border border-[#3A3A3A] rounded-2xl p-6 text-center shadow-2xl select-none">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#3A3A3A] mb-5">
          <div className="flex items-center gap-2">
            <Mic className="w-5 h-5 text-red-500 animate-pulse" />
            <span className="font-semibold text-white text-sm">{t.micDictation}</span>
          </div>
          <button
            onClick={cancelRecording}
            className="p-1 text-[#888888] hover:text-white rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMessage ? (
          <div className="p-4 bg-red-950/40 border border-red-800/60 rounded-xl text-red-300 text-xs mb-4">
            {errorMessage}
          </div>
        ) : (
          <>
            {/* Visual Wave Pulse */}
            <div className="h-20 flex items-center justify-center gap-1.5 mb-4">
              {[40, 75, 55, 90, 60, 85, 45, 95, 65, 80, 50].map((h, i) => (
                <div
                  key={i}
                  className="w-1.5 bg-red-500 rounded-full transition-all duration-200"
                  style={{
                    height: isTranscribing ? '6px' : `${Math.max(12, (h * (seconds % 3 + 1)) / 3)}px`,
                    opacity: isTranscribing ? 0.3 : 1,
                  }}
                />
              ))}
            </div>

            {/* Timer (Limit: 2:00) */}
            <div className="text-3xl font-mono font-bold text-white mb-2">
              {formatTime(seconds)}
            </div>
            <p className="text-xs text-[#888888] mb-6">
              {isTranscribing ? 'جاري التفريغ الذكي للنص...' : 'تحدث الآن وسيقوم Stu.Ai بتفريغ كلامك إلى نص قابل للمراجعة (بحد أقصى دقيقتين)'}
            </p>
          </>
        )}

        {/* Action Controls */}
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={cancelRecording}
            disabled={isTranscribing}
            className="px-4 py-2.5 rounded-xl border border-[#3A3A3A] bg-[#171717] hover:bg-[#2B2B2B] text-[#B5B5B5] hover:text-white text-xs font-semibold transition-colors disabled:opacity-50"
          >
            {t.cancelRecording}
          </button>

          {!errorMessage && (
            <button
              onClick={stopAndTranscribe}
              disabled={isTranscribing}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white hover:bg-[#e5e5e5] text-black text-xs font-bold transition-all shadow disabled:opacity-50"
            >
              {isTranscribing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-black" />
                  <span>جاري التفريغ...</span>
                </>
              ) : (
                <>
                  <Square className="w-4 h-4 fill-current text-black" />
                  <span>{t.stopRecording}</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
