import React from 'react';
import { X, FileText, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useChat } from '../context/ChatContext';

export const AttachmentTray: React.FC = () => {
  const { pendingAttachments, removePendingAttachment } = useChat();

  if (pendingAttachments.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2.5 p-2.5 mb-2 bg-[#232323] border border-[#3A3A3A] rounded-xl max-h-48 overflow-y-auto">
      {pendingAttachments.map((att, idx) => {
        const isImage = att.mimeType.startsWith('image/');
        const isUploading = att.uploadStatus === 'uploading';
        const isFailed = att.uploadStatus === 'failed';

        if (isImage && att.previewUrl) {
          return (
            <div
              key={idx}
              className="relative group rounded-xl overflow-hidden border border-[#3A3A3A] bg-[#171717] w-20 h-20 sm:w-24 sm:h-24 shrink-0 shadow-md"
            >
              <img
                src={att.previewUrl}
                alt="معاينة الصورة"
                className="w-full h-full object-cover"
              />
              {/* Overlay on uploading / failed */}
              {isUploading && (
                <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center text-amber-400 text-[10px]">
                  <Loader2 className="w-4 h-4 animate-spin mb-1" />
                  <span>رفع...</span>
                </div>
              )}
              {isFailed && (
                <div className="absolute inset-0 bg-red-950/80 flex flex-col items-center justify-center text-red-300 text-[10px]">
                  <AlertCircle className="w-4 h-4 mb-1" />
                  <span>فشل</span>
                </div>
              )}
              {/* Remove button */}
              <button
                type="button"
                onClick={() => removePendingAttachment(idx)}
                className="absolute top-1 left-1 w-5 h-5 bg-black/70 hover:bg-red-600 text-white rounded-full flex items-center justify-center transition-colors shadow"
                title="إزالة الصورة"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        }

        return (
          <div
            key={idx}
            className="group relative flex items-center gap-2 bg-[#171717] border border-[#3A3A3A] rounded-xl p-2 pr-2.5 max-w-[200px] text-xs text-[#F5F5F5] select-none"
          >
            <div className="w-8 h-8 rounded bg-[#2B2B2B] flex items-center justify-center shrink-0 text-blue-400">
              <FileText className="w-4 h-4" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{att.originalName}</div>
              <div className="flex items-center gap-1 text-[10px] text-[#888888]">
                <span>{(att.sizeBytes / 1024).toFixed(0)} KB</span>
                {isUploading && (
                  <span className="flex items-center text-amber-400">
                    <Loader2 className="w-2.5 h-2.5 animate-spin mr-0.5" />
                    رفع...
                  </span>
                )}
                {isFailed && (
                  <span className="flex items-center text-red-400">
                    <AlertCircle className="w-2.5 h-2.5 mr-0.5" />
                    فشل
                  </span>
                )}
                {att.uploadStatus === 'ready' && (
                  <span className="flex items-center text-emerald-400">
                    <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />
                    جاهز
                  </span>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => removePendingAttachment(idx)}
              className="p-1 text-[#888888] hover:text-white hover:bg-[#2B2B2B] rounded transition-colors"
              title="إزالة"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
