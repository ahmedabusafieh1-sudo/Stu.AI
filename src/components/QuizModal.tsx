import React, { useState } from 'react';
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
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';

export const QuizModal: React.FC = () => {
  const { t } = useAuth();
  const {
    quizModalOpen,
    setQuizModalOpen,
    quizInitialTopic,
    activeConversationId,
    sendMessage,
  } = useChat();

  // Wizard steps: 'setup' | 'taking' | 'results'
  const [step, setStep] = useState<'setup' | 'taking' | 'results'>('setup');

  // Setup Form State
  const [quizType, setQuizType] = useState<'mcq' | 'essay' | 'mixed'>('mcq');
  const [questionCount, setQuestionCount] = useState(5);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [language, setLanguage] = useState<'ar' | 'en'>('ar');
  const [customTopic, setCustomTopic] = useState(quizInitialTopic || '');

  // Active Quiz State
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [activeQuiz, setActiveQuiz] = useState<any>(null);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [studentAnswers, setStudentAnswers] = useState<Record<string, string>>({});
  const [quizResults, setQuizResults] = useState<any>(null);

  if (!quizModalOpen) return null;

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
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'فشل توليد الكويز');
      }

      setActiveQuiz(data.quiz);
      setCurrentQuestionIdx(0);
      setStudentAnswers({});
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
      setStep('results');
    } catch (err: any) {
      setErrorMessage(err.message || 'حدث خطأ أثناء تصحيح الكويز.');
    } finally {
      setIsSubmitting(false);
    }
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
                : t.quizResultTitle}
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

              {/* Custom Quiz Format & Prompt */}
              <div>
                <label className="block font-semibold text-white mb-1.5">
                  كيف تحب أن يكون شكل الكويز وتفاصيله؟
                </label>
                <textarea
                  rows={3}
                  value={customTopic}
                  onChange={(e) => setCustomTopic(e.target.value)}
                  placeholder="اكتب هنا طلبك ومواصفات الكويز (مثال: ركّز على القوانين وحسابات المسائل، أو اجعل الأسئلة سريعة ومباشرة، أو حدد درساً معيناً... وبناءً على طلبك سيتم التنفيذ فوراً)..."
                  dir="auto"
                  className="w-full bg-[#171717] text-white px-3.5 py-2.5 rounded-xl border border-[#3A3A3A] focus:outline-none focus:border-white text-xs resize-none"
                />
                <p className="mt-1 text-[11px] text-[#888888]">
                  يمكنك تركه فارغاً لتوليد كويز متوازن وشامل من كافة الملفات والمحادثة، أو كتابة أي مواصفات خاصة ترغب بها.
                </p>
              </div>

              {/* Submit Start */}
              <div className="pt-2">
                <button
                  onClick={handleCreateQuiz}
                  disabled={isGenerating}
                  className="w-full py-3 rounded-xl bg-white hover:bg-[#e5e5e5] text-black font-bold text-sm transition-all shadow flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-black" />
                      <span>جاري إعداد وتحكيم الأسئلة من المصادر...</span>
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
                    className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold transition-all shadow flex items-center gap-1.5"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>جاري التصحيح...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{t.submitQuiz}</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ---------------- STEP 3: RESULTS ---------------- */}
          {step === 'results' && quizResults && (
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
                  تم تصحيح الأسئلة الموضوعية مباشرة، والأسئلة المقالية عبر معايير التقييم الآلي التقديري.
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
              <div className="space-y-3">
                {quizResults.results?.map((res: any, idx: number) => (
                  <div
                    key={idx}
                    className="p-3.5 bg-[#171717] border border-[#3A3A3A] rounded-xl text-xs space-y-2"
                  >
                    <div className="flex items-center justify-between font-semibold text-white">
                      <span>السؤال {res.questionOrder} ({res.topic})</span>
                      <span className={res.isCorrect ? 'text-emerald-400' : 'text-red-400'}>
                        {res.earnedPoints} / {res.points} درجة
                      </span>
                    </div>

                    <p className="text-[#F5F5F5]" dir="auto">
                      {res.questionText}
                    </p>

                    <div className="p-2 rounded bg-[#232323] space-y-1">
                      <div>
                        <span className="text-[#888888]">{t.yourAnswer} </span>
                        <span className={res.isCorrect ? 'text-emerald-300' : 'text-red-300'}>
                          {res.studentAnswer || '[فارغ]'}
                        </span>
                      </div>
                      {!res.isCorrect && (
                        <div>
                          <span className="text-[#888888]">الإجابة النموذجية: </span>
                          <span className="text-emerald-300">{res.correctKey}</span>
                        </div>
                      )}
                      <div>
                        <span className="text-[#888888]">التفسير والمصدر: </span>
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
      </div>
    </div>
  );
};
