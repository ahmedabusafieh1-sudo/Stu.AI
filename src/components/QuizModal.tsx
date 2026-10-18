import React, { useState, useRef } from 'react';
import {
  X,
  HelpCircle,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Loader2,
  RefreshCw,
  BookOpen,
  Paperclip,
  FileText,
  Image as ImageIcon,
  MessageSquare,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';

interface QuizAttachment {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

export const QuizModal: React.FC = () => {
  const { t } = useAuth();
  const {
    quizModalOpen,
    setQuizModalOpen,
    quizInitialTopic,
    activeConversationId,
    sendMessage,
    refreshConversation,
  } = useChat();

  // Wizard steps: 'setup' | 'taking' | 'results'
  const [step, setStep] = useState<'setup' | 'taking' | 'results'>('setup');

  // Setup Form State
  const [quizType, setQuizType] = useState<'mcq' | 'essay' | 'mixed'>('mcq');
  const [questionCount, setQuestionCount] = useState(5);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [language, setLanguage] = useState<'ar' | 'en'>('ar');
  const [customTopic, setCustomTopic] = useState(quizInitialTopic || '');

  // File Uploads for Quiz
  const [quizAttachments, setQuizAttachments] = useState<QuizAttachment[]>([]);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Active Quiz State
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [activeQuiz, setActiveQuiz] = useState<any>(null);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [studentAnswers, setStudentAnswers] = useState<Record<string, string>>({});
  const [quizResults, setQuizResults] = useState<any>(null);

  // Correction & Save to Chat Controls
  const [hasRequestedCorrection, setHasRequestedCorrection] = useState(false);
  const [isSavingToChat, setIsSavingToChat] = useState(false);
  const [chatSavedSuccess, setChatSavedSuccess] = useState<string | null>(null);

  if (!quizModalOpen) return null;

  const formatFileSize = (bytes: number): string => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploadingFiles(true);
    setErrorMessage(null);

    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
      }

      const res = await fetch('/api/attachments/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'فشل رفع الملفات المحددة.');
      }

      if (data.attachments && Array.isArray(data.attachments)) {
        setQuizAttachments((prev) => [...prev, ...data.attachments]);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'حدث خطأ أثناء رفع الملفات.');
    } finally {
      setIsUploadingFiles(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveAttachment = (index: number) => {
    setQuizAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCreateQuiz = async () => {
    setIsGenerating(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/quizzes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: activeConversationId || undefined,
          topic: customTopic.trim() || undefined,
          type: quizType,
          questionCount: Number(questionCount),
          difficulty,
          language,
          selectedAttachmentIds: quizAttachments.length > 0 ? quizAttachments.map((f) => f.id) : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'فشل توليد الكويز');
      }

      setActiveQuiz(data.quiz);
      setCurrentQuestionIdx(0);
      setStudentAnswers({});
      setHasRequestedCorrection(false);
      setChatSavedSuccess(null);
      setStep('taking');
    } catch (err: any) {
      setErrorMessage(err.message || 'حدث خطأ أثناء إعداد الكويز.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAnswerSelect = (questionId: string, answer: string) => {
    setStudentAnswers((prev) => ({
      ...prev,
      [questionId]: answer,
    }));
  };

  const handleSubmitQuiz = async () => {
    if (!activeQuiz) return;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const answersPayload = activeQuiz.questions.map((q: any) => ({
        questionId: q.id,
        studentAnswer: studentAnswers[q.id] || '',
      }));

      const res = await fetch(`/api/quizzes/${activeQuiz.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: answersPayload }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'فشل تسليم الكويز');
      }

      setQuizResults(data);
      setHasRequestedCorrection(false); // Do not reveal corrections unless student asks!
      setStep('results');
    } catch (err: any) {
      setErrorMessage(err.message || 'حدث خطأ أثناء تصحيح الكويز.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveToChat = async (includeCorrections: boolean) => {
    if (!activeQuiz) return;
    setIsSavingToChat(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/quizzes/${activeQuiz.id}/save-to-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeCorrections }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'فشل حفظ الكويز في المحادثة');
      }

      if (data.conversationId) {
        await refreshConversation(data.conversationId);
      }

      setChatSavedSuccess(
        includeCorrections
          ? 'تم تصحيح الكويز وتوضيح الأخطاء وحفظ التقرير كاملاً في المحادثة بنجاح! 📊'
          : 'تم حفظ الكويز وإجاباتك المسجلة في المحادثة بنجاح! 💬'
      );
    } catch (err: any) {
      setErrorMessage(err.message || 'فشل حفظ الكويز في المحادثة.');
    } finally {
      setIsSavingToChat(false);
    }
  };

  const handleRequestCorrection = async () => {
    setHasRequestedCorrection(true);
    await handleSaveToChat(true);
  };

  const handleExplainMistakes = async () => {
    if (!activeQuiz) return;

    try {
      const res = await fetch(`/api/quizzes/${activeQuiz.id}/explain-mistakes`, {
        method: 'POST',
      });
      const data = await res.json();

      if (res.ok && data.promptText) {
        setQuizModalOpen(false);
        sendMessage(data.promptText);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const resetAll = () => {
    setStep('setup');
    setActiveQuiz(null);
    setStudentAnswers({});
    setQuizResults(null);
    setErrorMessage(null);
    setHasRequestedCorrection(false);
    setChatSavedSuccess(null);
    setQuizAttachments([]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-2xl bg-[#232323] border border-[#3A3A3A] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-4 border-b border-[#3A3A3A] flex items-center justify-between select-none">
          <div className="flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-amber-400" />
            <h3 className="font-bold text-white text-base">
              {step === 'setup'
                ? t.quizModalTitle
                : step === 'taking'
                ? activeQuiz?.title || 'الاختبار التفاعلي'
                : hasRequestedCorrection
                ? 'تقرير تصحيح ونتائج الاختبار'
                : 'تسجيل إجابات الاختبار'}
            </h3>
          </div>
          <button
            onClick={() => setQuizModalOpen(false)}
            className="p-1 text-[#888888] hover:text-white rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto flex-1 select-text">
          {errorMessage && (
            <div className="p-3.5 mb-4 bg-red-950/40 border border-red-800 rounded-xl text-red-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* ---------------- STEP 1: SETUP ---------------- */}
          {step === 'setup' && (
            <div className="space-y-4 text-xs select-none">
              {/* Type */}
              <div>
                <label className="block font-semibold text-white mb-2">{t.quizType}</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'mcq', label: t.quizTypeMcq },
                    { id: 'essay', label: t.quizTypeEssay },
                    { id: 'mixed', label: t.quizTypeMixed },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setQuizType(item.id as any)}
                      className={`py-2.5 px-3 rounded-xl border text-center font-medium transition-colors ${
                        quizType === item.id
                          ? 'bg-white text-black border-white'
                          : 'bg-[#171717] text-[#B5B5B5] border-[#3A3A3A] hover:text-white'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Count */}
              <div>
                <label className="block font-semibold text-white mb-2">{t.quizCount}</label>
                <div className="grid grid-cols-4 gap-2">
                  {[5, 10, 15, 20].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setQuestionCount(num)}
                      className={`py-2 rounded-xl border text-center font-medium transition-colors ${
                        questionCount === num
                          ? 'bg-white text-black border-white'
                          : 'bg-[#171717] text-[#B5B5B5] border-[#3A3A3A] hover:text-white'
                      }`}
                    >
                      {num} أسئلة
                    </button>
                  ))}
                </div>
              </div>

              {/* Difficulty */}
              <div>
                <label className="block font-semibold text-white mb-2">{t.quizDifficulty}</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'easy', label: t.easy },
                    { id: 'medium', label: t.medium },
                    { id: 'hard', label: t.hard },
                  ].map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setDifficulty(d.id as any)}
                      className={`py-2 px-2 rounded-xl border text-center font-medium transition-colors ${
                        difficulty === d.id
                          ? 'bg-white text-black border-white'
                          : 'bg-[#171717] text-[#B5B5B5] border-[#3A3A3A] hover:text-white'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Attachments & Images Uploader */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="font-semibold text-white flex items-center gap-1.5">
                    <Paperclip className="w-4 h-4 text-amber-400" />
                    <span>المصادر الدراسية (صور أو ملفات لإنشاء الكويز منها)</span>
                  </label>
                  <button
                    type="button"
                    disabled={isUploadingFiles}
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1 bg-[#171717] px-2.5 py-1 rounded-lg border border-[#3A3A3A] transition-colors"
                  >
                    {isUploadingFiles ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>جاري الرفع...</span>
                      </>
                    ) : (
                      <>
                        <ImageIcon className="w-3.5 h-3.5 text-emerald-400" />
                        <span>إرفاق صور أو ملفات 📎</span>
                      </>
                    )}
                  </button>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,.pdf,.doc,.docx,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />

                {quizAttachments.length > 0 ? (
                  <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                    {quizAttachments.map((file, idx) => (
                      <div
                        key={file.id || idx}
                        className="flex items-center justify-between bg-[#171717] border border-[#3A3A3A] rounded-xl px-3 py-2 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {file.mimeType.startsWith('image/') ? (
                            <ImageIcon className="w-4 h-4 text-emerald-400 shrink-0" />
                          ) : (
                            <FileText className="w-4 h-4 text-blue-400 shrink-0" />
                          )}
                          <span className="truncate text-white max-w-[280px]" title={file.originalName}>
                            {file.originalName}
                          </span>
                          <span className="text-[#888888] text-[10px] shrink-0">
                            ({formatFileSize(file.sizeBytes)})
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveAttachment(idx)}
                          className="text-[#888888] hover:text-red-400 p-1 transition-colors"
                          title="حذف المرفق"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border border-dashed border-[#3A3A3A] hover:border-[#666666] bg-[#171717]/60 rounded-xl p-3 text-center cursor-pointer transition-colors"
                  >
                    <p className="text-[#888888] text-xs">
                      📸 يمكنك رفع صور لأوراق أو واجبات أو أجزاء من كتب لإنشاء الكويز منها مباشرة، أو الاعتماد على ملفات المحادثة.
                    </p>
                  </div>
                )}
              </div>

              {/* Custom Quiz Format & Prompt */}
              <div>
                <label className="block font-semibold text-white mb-1.5">
                  كيف تحب أن يكون شكل الكويز وتفاصيله؟
                </label>
                <textarea
                  rows={2}
                  value={customTopic}
                  onChange={(e) => setCustomTopic(e.target.value)}
                  placeholder="اكتب هنا طلبك ومواصفات الكويز (مثال: ركّز على القوانين وحسابات المسائل، أو اجعل الأسئلة سريعة ومباشرة، أو حدد درساً معيناً)..."
                  dir="auto"
                  className="w-full bg-[#171717] text-white px-3.5 py-2.5 rounded-xl border border-[#3A3A3A] focus:outline-none focus:border-white text-xs resize-none"
                />
              </div>

              {/* Submit Start */}
              <div className="pt-2">
                <button
                  onClick={handleCreateQuiz}
                  disabled={isGenerating || isUploadingFiles}
                  className="w-full py-3 rounded-xl bg-white hover:bg-[#e5e5e5] text-black font-bold text-sm transition-all shadow flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-black" />
                      <span>جاري إعداد وتحكيم الأسئلة من المواد المحددة...</span>
                    </>
                  ) : (
                    <span>{t.startQuiz}</span>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ---------------- STEP 2: TEST TAKER ---------------- */}
          {step === 'taking' && activeQuiz && (
            <div className="space-y-4">
              {/* Question Progress Bar */}
              <div className="flex items-center justify-between text-xs text-[#888888] mb-2 select-none">
                <span>
                  {t.question} {currentQuestionIdx + 1} {t.of} {activeQuiz.questions.length}
                </span>
                <span className="font-semibold text-amber-400">
                  {activeQuiz.questions[currentQuestionIdx].topic || 'عام'}
                </span>
              </div>
              <div className="w-full bg-[#171717] h-1.5 rounded-full overflow-hidden mb-4">
                <div
                  className="bg-blue-500 h-full transition-all duration-300"
                  style={{
                    width: `${((currentQuestionIdx + 1) / activeQuiz.questions.length) * 100}%`,
                  }}
                />
              </div>

              {/* Question Card */}
              {activeQuiz.questions[currentQuestionIdx] && (
                <div className="bg-[#171717] border border-[#3A3A3A] rounded-xl p-4 space-y-4">
                  <h4 className="font-semibold text-sm text-white leading-relaxed" dir="auto">
                    {activeQuiz.questions[currentQuestionIdx].questionText}
                  </h4>

                  {/* MCQ Options */}
                  {activeQuiz.questions[currentQuestionIdx].questionType === 'mcq' && (
                    <div className="space-y-2">
                      {activeQuiz.questions[currentQuestionIdx].options?.map((opt: string, i: number) => {
                        const qId = activeQuiz.questions[currentQuestionIdx].id;
                        const isSelected = studentAnswers[qId] === opt;
                        return (
                          <div
                            key={i}
                            onClick={() => handleAnswerSelect(qId, opt)}
                            className={`flex items-center gap-3 p-3 rounded-xl border text-xs cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-[#2B2B2B] text-white border-white'
                                : 'bg-[#232323] text-[#B5B5B5] border-[#3A3A3A] hover:bg-[#2B2B2B] hover:text-white'
                            }`}
                          >
                            <div
                              className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                                isSelected ? 'border-white bg-white text-black' : 'border-[#666666]'
                              }`}
                            >
                              {isSelected && <div className="w-2 h-2 rounded-full bg-black" />}
                            </div>
                            <span dir="auto" className="flex-1">
                              {opt}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Essay Textarea */}
                  {activeQuiz.questions[currentQuestionIdx].questionType === 'essay' && (
                    <div>
                      <textarea
                        rows={4}
                        value={studentAnswers[activeQuiz.questions[currentQuestionIdx].id] || ''}
                        onChange={(e) =>
                          handleAnswerSelect(
                            activeQuiz.questions[currentQuestionIdx].id,
                            e.target.value
                          )
                        }
                        placeholder={t.essayPlaceholder}
                        dir="auto"
                        className="w-full bg-[#232323] text-white text-xs p-3 rounded-xl border border-[#3A3A3A] focus:outline-none focus:border-white leading-relaxed resize-none"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Navigation Controls */}
              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  disabled={currentQuestionIdx === 0}
                  onClick={() => setCurrentQuestionIdx((prev) => Math.max(0, prev - 1))}
                  className="px-4 py-2 rounded-xl border border-[#3A3A3A] bg-[#171717] hover:bg-[#2B2B2B] text-xs font-semibold text-white transition-colors disabled:opacity-30"
                >
                  <ArrowRight className="w-3.5 h-3.5 inline mr-1" />
                  <span>{t.previousQuestion}</span>
                </button>

                {currentQuestionIdx < activeQuiz.questions.length - 1 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setCurrentQuestionIdx((prev) =>
                        Math.min(activeQuiz.questions.length - 1, prev + 1)
                      )
                    }
                    className="px-4 py-2 rounded-xl bg-white hover:bg-[#e5e5e5] text-black text-xs font-bold transition-all shadow"
                  >
                    <span>{t.nextQuestion}</span>
                    <ArrowLeft className="w-3.5 h-3.5 inline ml-1" />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={handleSubmitQuiz}
                    className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold transition-all shadow flex items-center gap-1.5"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>جاري تسجيل الإجابات...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>إنهاء الاختبار وتسجيل الإجابات</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ---------------- STEP 3: RESULTS & OPTIONAL CORRECTION ---------------- */}
          {step === 'results' && quizResults && (
            <div className="space-y-4">
              {/* Notice Banner when chat is saved */}
              {chatSavedSuccess && (
                <div className="p-3 bg-emerald-950/40 border border-emerald-800 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{chatSavedSuccess}</span>
                </div>
              )}

              {/* State A: Before User Requests Correction */}
              {!hasRequestedCorrection ? (
                <div className="space-y-4">
                  {/* Completion Greeting */}
                  <div className="bg-[#171717] border border-[#3A3A3A] rounded-2xl p-5 text-center space-y-2">
                    <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 mx-auto flex items-center justify-center">
                      <CheckCircle2 className="w-6 h-6" />
                    </div>
                    <h4 className="text-base font-bold text-white">
                      تم إنهاء الاختبار وتسجيل إجاباتك بنجاح! 🎉
                    </h4>
                    <p className="text-xs text-[#A0A0A0] max-w-md mx-auto leading-relaxed">
                      تم حفظ إجاباتك كاملة في النظام. لن يتم عرض الأخطاء أو التصحيح إلا إذا طلبت ذلك بنفسك. يمكنك حفظ إجاباتك الآن في الشات، أو طلب التصحيح الفوري وتوضيح الأخطاء.
                    </p>
                  </div>

                  {/* Registered Answers List (NO marks or correctKey revealed yet!) */}
                  <div className="space-y-2.5 max-h-[35vh] overflow-y-auto pr-1">
                    <div className="text-xs font-semibold text-[#888888] mb-1">
                      إجاباتك المسجلة ({activeQuiz.questions.length} أسئلة):
                    </div>
                    {activeQuiz.questions.map((q: any, idx: number) => {
                      const studentAns = studentAnswers[q.id]?.trim();
                      return (
                        <div
                          key={q.id || idx}
                          className="p-3.5 bg-[#171717] border border-[#3A3A3A] rounded-xl text-xs space-y-1.5"
                        >
                          <div className="font-semibold text-white leading-relaxed" dir="auto">
                            السؤال {idx + 1}: {q.questionText}
                          </div>
                          <div className="p-2 rounded bg-[#232323] text-xs">
                            <span className="text-[#888888]">إجابتك المسجلة: </span>
                            <span className="text-white font-medium">
                              {studentAns || '[لم يتم الحل]'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Action Choices */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
                    <button
                      type="button"
                      disabled={isSavingToChat}
                      onClick={() => handleSaveToChat(false)}
                      className="w-full py-3 px-4 rounded-xl border border-[#3A3A3A] bg-[#171717] hover:bg-[#2B2B2B] text-white text-xs font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isSavingToChat ? (
                        <Loader2 className="w-4 h-4 animate-spin text-white" />
                      ) : (
                        <MessageSquare className="w-4 h-4 text-blue-400" />
                      )}
                      <span>حفظ الكويز في الشات 💬</span>
                    </button>

                    <button
                      type="button"
                      disabled={isSavingToChat}
                      onClick={handleRequestCorrection}
                      className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isSavingToChat ? (
                        <Loader2 className="w-4 h-4 animate-spin text-white" />
                      ) : (
                        <BookOpen className="w-4 h-4 text-white" />
                      )}
                      <span>تصحيح إجاباتي وتوضيح الأخطاء 🔍</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* State B: When User Explicitly Requests Correction */
                <div className="space-y-4">
                  {/* Score Banner */}
                  <div className="bg-[#171717] border border-[#3A3A3A] rounded-2xl p-5 text-center">
                    <div className="text-3xl font-bold text-white mb-1">
                      {quizResults.score} / {quizResults.totalPoints}
                    </div>
                    <div className="text-sm font-semibold text-emerald-400 mb-2">
                      {quizResults.percentage}%
                    </div>
                    <p className="text-xs text-[#888888]">
                      تم تقييم وتصحيح إجاباتك بالتفصيل، وتوضيح الإجابة النموذجية والتفسير لكل سؤال.
                    </p>
                  </div>

                  {/* Weak Topics */}
                  {quizResults.weakTopics && quizResults.weakTopics.length > 0 && (
                    <div className="p-3.5 bg-amber-950/30 border border-amber-800/40 rounded-xl text-xs">
                      <div className="font-semibold text-amber-300 mb-1">{t.weakTopics}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {quizResults.weakTopics.map((top: string, idx: number) => (
                          <span key={idx} className="px-2 py-0.5 rounded bg-amber-900/40 text-amber-200">
                            {top}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Detailed Breakdown */}
                  <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-1">
                    {quizResults.results?.map((res: any, idx: number) => (
                      <div
                        key={idx}
                        className="p-3.5 bg-[#171717] border border-[#3A3A3A] rounded-xl text-xs space-y-2"
                      >
                        <div className="flex items-center justify-between font-semibold text-white">
                          <span>السؤال {res.questionOrder} ({res.topic})</span>
                          <span className={res.isCorrect ? 'text-emerald-400' : 'text-red-400'}>
                            {res.earnedPoints} / {res.points} درجة {res.isCorrect ? '✅' : '❌'}
                          </span>
                        </div>

                        <p className="text-[#F5F5F5]" dir="auto">
                          {res.questionText}
                        </p>

                        <div className="p-2.5 rounded bg-[#232323] space-y-1.5">
                          <div>
                            <span className="text-[#888888]">{t.yourAnswer} </span>
                            <span className={res.isCorrect ? 'text-emerald-300' : 'text-red-300'}>
                              {res.studentAnswer || '[فارغ]'}
                            </span>
                          </div>
                          {!res.isCorrect && (
                            <div>
                              <span className="text-[#888888]">الإجابة النموذجية: </span>
                              <span className="text-emerald-300 font-medium">{res.correctKey}</span>
                            </div>
                          )}
                          <div>
                            <span className="text-[#888888]">التفسير والشرح: </span>
                            <span className="text-[#B5B5B5]">{res.explanation}</span>
                          </div>
                          {res.aiFeedback && (
                            <div className="text-blue-300 pt-1 text-[11px]">
                              💡 ملاحظات المصحح: {res.aiFeedback}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                    <button
                      type="button"
                      onClick={resetAll}
                      className="px-4 py-2.5 rounded-xl border border-[#3A3A3A] bg-[#171717] hover:bg-[#2B2B2B] text-xs font-semibold text-white transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5 inline mr-1" />
                      <span>{t.retryQuiz}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleExplainMistakes}
                      className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all shadow"
                    >
                      <BookOpen className="w-3.5 h-3.5 inline mr-1" />
                      <span>{t.explainMistakes}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
