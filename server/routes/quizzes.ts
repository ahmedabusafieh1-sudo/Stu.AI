import { Router, Request, Response } from 'express';
import { eq, and, desc, asc, inArray } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import {
  quizzes,
  quizQuestions,
  quizAttempts,
  quizAnswers,
  conversations,
  messages,
  attachments,
  sourceUnits,
  createQuizSchema,
  submitQuizSchema,
} from '../../shared/schema.js';
import {
  generateQuizWithGemini,
  gradeEssayAnswer,
  isGeminiConfigured,
} from '../services/gemini.js';
import { requireAuth, requireVerified } from '../middleware/auth.js';

export const quizzesRouter = Router();

// ----------------------------------------------------
// 1. Generate & Save Quiz
// ----------------------------------------------------
quizzesRouter.post('/', requireAuth, requireVerified, async (req: Request, res: Response) => {
  const parseResult = createQuizSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.errors[0]?.message || 'إعدادات الكويز غير صالحة' });
  }

  if (!isGeminiConfigured()) {
    return res.status(503).json({
      error: 'خدمة توليد الكويز غير متاحة لعدم ضبط GEMINI_API_KEY في إعدادات الخادم.',
    });
  }

  const { conversationId, topic, type, difficulty, language, questionCount, scopeType, selectedAttachmentIds } =
    parseResult.data;

  try {
    const { db } = await getDb();

    // Verify conversation if provided
    if (conversationId) {
      const convList = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.userId, req.user!.id)))
        .limit(1);

      if (convList.length === 0) {
        return res.status(404).json({ error: 'المحادثة المحددة غير موجودة.' });
      }
    }

    // Collect source material from user attachments
    let targetAttachmentIds: string[] = [];

    if (selectedAttachmentIds && selectedAttachmentIds.length > 0) {
      targetAttachmentIds = selectedAttachmentIds;
    } else if (conversationId) {
      // Find all attachments in this conversation
      const convMessages = await db
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.conversationId, conversationId));

      const msgIds = convMessages.map((m: any) => m.id);
      if (msgIds.length > 0) {
        const attList = await db
          .select({ attachmentId: attachments.id })
          .from(attachments)
          .where(and(eq(attachments.userId, req.user!.id), eq(attachments.status, 'ready')));
        targetAttachmentIds = attList.map((a: any) => a.attachmentId);
      }
    }

    // Load extracted source units
    let sourcesData: { fileName: string; unitIndex: number; text: string }[] = [];

    if (targetAttachmentIds.length > 0) {
      const unitsList = await db
        .select({
          fileName: attachments.originalName,
          unitIndex: sourceUnits.unitIndex,
          text: sourceUnits.contentText,
        })
        .from(sourceUnits)
        .innerJoin(attachments, eq(sourceUnits.attachmentId, attachments.id))
        .where(inArray(sourceUnits.attachmentId, targetAttachmentIds))
        .orderBy(asc(sourceUnits.unitIndex));

      sourcesData = unitsList;
    }

    // If no attachments found and no custom topic:
    if (sourcesData.length === 0 && !topic) {
      return res.status(400).json({
        error: 'لا توجد مصادر دراسية جاهزة في هذه المحادثة. يرجى رفع ملفات دراسية أولاً أو كتابة موضوع الكويز المطلوب.',
      });
    }

    // If no attachment sources but user provided custom topic
    if (sourcesData.length === 0 && topic) {
      sourcesData.push({
        fileName: 'موضوع مخصص',
        unitIndex: 1,
        text: `الموضوع الدراسي المطلوب: ${topic}`,
      });
    }

    // Generate Quiz questions via Gemini structured output
    const generated = await generateQuizWithGemini(sourcesData, {
      type,
      questionCount,
      difficulty,
      language,
      customTopic: topic,
    });

    if (!generated.questions || generated.questions.length === 0) {
      return res.status(422).json({
        error: 'لم تكن المادة الدراسية كافية لتوليد أسئلة متنوعة. يرجى إضافة المزيد من المصادر أو توسيع النطاق.',
      });
    }

    // Insert Quiz into DB
    const insertedQuiz = await db
      .insert(quizzes)
      .values({
        userId: req.user!.id,
        conversationId: conversationId || null,
        title: generated.title || `كويز: ${topic || 'تقييم دراسي'}`,
        type,
        difficulty,
        language,
        scopeType,
        questionCount: generated.questions.length,
      })
      .returning();

    const quiz = insertedQuiz[0];

    // Insert Quiz Questions into DB
    for (let i = 0; i < generated.questions.length; i++) {
      const q = generated.questions[i];
      await db.insert(quizQuestions).values({
        quizId: quiz.id,
        questionOrder: i + 1,
        questionType: q.questionType,
        questionText: q.questionText,
        options: q.options || [],
        correctKey: q.correctKey,
        explanation: q.explanation,
        points: q.points || 1,
        topic: q.topic || 'عام',
        sourceReferences: q.sourceReferences || [],
      });
    }

    // Fetch sanitized questions for client (STRIP correctKey and explanation)
    const clientQuestions = generated.questions.map((q, idx) => ({
      questionOrder: idx + 1,
      questionType: q.questionType,
      questionText: q.questionText,
      options: q.options || [],
      points: q.points || 1,
      topic: q.topic || 'عام',
      // correctKey and explanation are strictly withheld until submission!
    }));

    return res.status(201).json({
      success: true,
      quiz: {
        id: quiz.id,
        title: quiz.title,
        type: quiz.type,
        difficulty: quiz.difficulty,
        questionCount: quiz.questionCount,
        questions: clientQuestions,
      },
    });
  } catch (err: any) {
    console.error('[CREATE_QUIZ_ERR]', err);
    return res.status(500).json({ error: `فشل إنشاء الكويز: ${err.message}` });
  }
});

// ----------------------------------------------------
// 2. Get Quiz & Active Attempt
// ----------------------------------------------------
quizzesRouter.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { db } = await getDb();

    // Check ownership
    const quizList = await db
      .select()
      .from(quizzes)
      .where(and(eq(quizzes.id, req.params.id), eq(quizzes.userId, req.user!.id)))
      .limit(1);

    if (quizList.length === 0) {
      return res.status(404).json({ error: 'الكويز غير موجود أو لا تملك صلاحية الوصول إليه.' });
    }

    const quiz = quizList[0];

    // Check if an attempt already exists
    const attempts = await db
      .select()
      .from(quizAttempts)
      .where(and(eq(quizAttempts.quizId, quiz.id), eq(quizAttempts.userId, req.user!.id)))
      .orderBy(desc(quizAttempts.createdAt))
      .limit(1);

    const hasCompletedAttempt = attempts.length > 0 && attempts[0].status === 'completed';

    // Fetch questions
    const qList = await db
      .select()
      .from(quizQuestions)
      .where(eq(quizQuestions.quizId, quiz.id))
      .orderBy(asc(quizQuestions.questionOrder));

    // If completed, fetch answers and return full review with explanations
    if (hasCompletedAttempt) {
      const attempt = attempts[0];
      const answersList = await db
        .select()
        .from(quizAnswers)
        .where(eq(quizAnswers.attemptId, attempt.id));

      const answersMap = new Map<string, any>(answersList.map((a: any) => [a.questionId, a]));

      const questionsWithReview = qList.map((q: any) => {
        const studentAns = answersMap.get(q.id);
        return {
          id: q.id,
          questionOrder: q.questionOrder,
          questionType: q.questionType,
          questionText: q.questionText,
          options: q.options,
          points: q.points,
          topic: q.topic,
          correctKey: q.correctKey,
          explanation: q.explanation,
          sourceReferences: q.sourceReferences,
          studentAnswer: studentAns?.studentAnswer || '',
          isCorrect: studentAns?.isCorrect ?? false,
          earnedPoints: studentAns?.earnedPoints ?? 0,
          aiFeedback: studentAns?.aiFeedback,
        };
      });

      return res.json({
        quiz,
        isCompleted: true,
        attempt,
        questions: questionsWithReview,
      });
    }

    // If not completed: strip correct answers and explanations!
    const sanitizedQuestions = qList.map((q: any) => ({
      id: q.id,
      questionOrder: q.questionOrder,
      questionType: q.questionType,
      questionText: q.questionText,
      options: q.options,
      points: q.points,
      topic: q.topic,
    }));

    return res.json({
      quiz,
      isCompleted: false,
      questions: sanitizedQuestions,
    });
  } catch (err: any) {
    console.error('[GET_QUIZ_ERR]', err);
    return res.status(500).json({ error: 'فشل تحميل بيانات الكويز.' });
  }
});

// ----------------------------------------------------
// 3. Submit Quiz & Automatic Grading
// ----------------------------------------------------
quizzesRouter.post('/:id/submit', requireAuth, requireVerified, async (req: Request, res: Response) => {
  const parseResult = submitQuizSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.errors[0]?.message || 'بيانات التسليم غير صالحة' });
  }

  const { answers } = parseResult.data;

  try {
    const { db } = await getDb();

    // Verify ownership
    const quizList = await db
      .select()
      .from(quizzes)
      .where(and(eq(quizzes.id, req.params.id), eq(quizzes.userId, req.user!.id)))
      .limit(1);

    if (quizList.length === 0) {
      return res.status(404).json({ error: 'الكويز غير موجود.' });
    }

    const quiz = quizList[0];

    // Check for existing completed attempt (Idempotency)
    const existingAttempt = await db
      .select()
      .from(quizAttempts)
      .where(and(eq(quizAttempts.quizId, quiz.id), eq(quizAttempts.userId, req.user!.id)))
      .limit(1);

    if (existingAttempt.length > 0 && existingAttempt[0].status === 'completed') {
      return res.json({
        success: true,
        message: 'تم تسليم هذا الاختبار وتصحيحه مسبقاً.',
        attempt: existingAttempt[0],
      });
    }

    // Fetch quiz questions
    const qList = await db
      .select()
      .from(quizQuestions)
      .where(eq(quizQuestions.quizId, quiz.id))
      .orderBy(asc(quizQuestions.questionOrder));

    const questionMap = new Map<string, any>(qList.map((q: any) => [q.id, q]));
    const studentAnswerMap = new Map<string, string>(answers.map((a: any) => [a.questionId, a.studentAnswer.trim()]));

    let totalScore = 0;
    let totalMaxPoints = 0;
    const gradedResults: any[] = [];
    const weakTopics: Set<string> = new Set();

    // Create attempt row first
    const insertedAttempt = await db
      .insert(quizAttempts)
      .values({
        quizId: quiz.id,
        userId: req.user!.id,
        score: 0,
        totalPoints: 0,
        status: 'in_progress',
      })
      .returning();

    const attempt = insertedAttempt[0];

    // Grade each question
    for (const q of qList) {
      const studentAns = studentAnswerMap.get(q.id) || '';
      totalMaxPoints += q.points;

      if (q.questionType === 'mcq') {
        // Objective MCQ Grading: compare student answer with correctKey
        const isMatch =
          studentAns.toLowerCase() === q.correctKey.toLowerCase() ||
          (studentAns.length > 0 && q.correctKey.toLowerCase().includes(studentAns.toLowerCase()));

        const earned = isMatch ? q.points : 0;
        totalScore += earned;

        if (!isMatch) {
          weakTopics.add(q.topic);
        }

        await db.insert(quizAnswers).values({
          attemptId: attempt.id,
          questionId: q.id,
          studentAnswer: studentAns,
          isCorrect: isMatch,
          earnedPoints: earned,
          evaluationStatus: 'graded',
        });

        gradedResults.push({
          questionId: q.id,
          questionOrder: q.questionOrder,
          questionText: q.questionText,
          options: q.options,
          studentAnswer: studentAns,
          correctKey: q.correctKey,
          explanation: q.explanation,
          isCorrect: isMatch,
          earnedPoints: earned,
          points: q.points,
          topic: q.topic,
          sourceReferences: q.sourceReferences,
        });
      } else {
        // Essay Grading: AI Rubric Evaluation
        let earned = 0;
        let isCorrect = false;
        let feedback = 'تم تقييم الإجابة تقديراً آلياً.';

        if (studentAns.length > 0 && isGeminiConfigured()) {
          try {
            const aiGrade = await gradeEssayAnswer(q.questionText, q.correctKey, studentAns, q.points);
            earned = aiGrade.earnedPoints;
            isCorrect = aiGrade.isCorrect;
            feedback = aiGrade.feedback;
          } catch (err: any) {
            console.warn('[ESSAY_GRADE_ERR]', err.message);
            feedback = 'تعذر التقييم التلقائي لحظياً؛ ستبقى الحالة معلقة دون خصم درجات غير عادل.';
          }
        } else if (studentAns.length === 0) {
          feedback = 'لم تتم كتابة إجابة.';
        }

        totalScore += earned;
        if (!isCorrect) {
          weakTopics.add(q.topic);
        }

        await db.insert(quizAnswers).values({
          attemptId: attempt.id,
          questionId: q.id,
          studentAnswer: studentAns,
          isCorrect,
          earnedPoints: earned,
          aiFeedback: feedback,
          evaluationStatus: 'estimated',
        });

        gradedResults.push({
          questionId: q.id,
          questionOrder: q.questionOrder,
          questionText: q.questionText,
          studentAnswer: studentAns,
          correctKey: q.correctKey,
          explanation: q.explanation,
          isCorrect,
          earnedPoints: earned,
          points: q.points,
          topic: q.topic,
          aiFeedback: feedback,
          sourceReferences: q.sourceReferences,
        });
      }
    }

    // Update attempt with final score
    const updatedAttempt = await db
      .update(quizAttempts)
      .set({
        score: totalScore,
        totalPoints: totalMaxPoints,
        status: 'completed',
        completedAt: new Date(),
      })
      .where(eq(quizAttempts.id, attempt.id))
      .returning();

    return res.json({
      success: true,
      attempt: updatedAttempt[0],
      score: totalScore,
      totalPoints: totalMaxPoints,
      percentage: totalMaxPoints > 0 ? Math.round((totalScore / totalMaxPoints) * 100) : 0,
      weakTopics: Array.from(weakTopics),
      results: gradedResults,
    });
  } catch (err: any) {
    console.error('[SUBMIT_QUIZ_ERR]', err);
    return res.status(500).json({ error: 'فشل تصحيح وتسليم الكويز.' });
  }
});

// ----------------------------------------------------
// 4. Explain Mistakes in Chat
// ----------------------------------------------------
quizzesRouter.post('/:id/explain-mistakes', requireAuth, requireVerified, async (req: Request, res: Response) => {
  try {
    const { db } = await getDb();

    // Verify quiz
    const quizList = await db
      .select()
      .from(quizzes)
      .where(and(eq(quizzes.id, req.params.id), eq(quizzes.userId, req.user!.id)))
      .limit(1);

    if (quizList.length === 0) {
      return res.status(404).json({ error: 'الكويز غير موجود.' });
    }

    const quiz = quizList[0];
    if (!quiz.conversationId) {
      return res.status(400).json({ error: 'هذا الكويز غير مرتبط بمحادثة محددة.' });
    }

    // Fetch incorrect answers
    const attempts = await db
      .select()
      .from(quizAttempts)
      .where(and(eq(quizAttempts.quizId, quiz.id), eq(quizAttempts.userId, req.user!.id)))
      .orderBy(desc(quizAttempts.createdAt))
      .limit(1);

    if (attempts.length === 0) {
      return res.status(400).json({ error: 'لم يتم تسليم محاولة لهذا الكويز بعد.' });
    }

    const wrongAnswers = await db
      .select({
        questionText: quizQuestions.questionText,
        studentAnswer: quizAnswers.studentAnswer,
        correctKey: quizQuestions.correctKey,
        explanation: quizQuestions.explanation,
        topic: quizQuestions.topic,
      })
      .from(quizAnswers)
      .innerJoin(quizQuestions, eq(quizAnswers.questionId, quizQuestions.id))
      .where(and(eq(quizAnswers.attemptId, attempts[0].id), eq(quizAnswers.isCorrect, false)));

    if (wrongAnswers.length === 0) {
      return res.json({
        success: true,
        message: 'تهانينا! لم تقع في أي أخطاء في هذا الاختبار.',
      });
    }

    // Build prompt for conversation explanation
    const mistakeSummary = wrongAnswers
      .map(
        (m: any, idx: number) =>
          `السؤال ${idx + 1} (${m.topic}): ${m.questionText}\nإجابتي: ${m.studentAnswer || '[بدون إجابة]'}\nالصحيح: ${m.correctKey}\nالتفسير: ${m.explanation}`
      )
      .join('\n\n');

    const promptText = `لقد أجريت كويز "${quiz.title}" وأريد منك كمساعد دراسي أن تشرح لي بالتفصيل وبأسلوب مبسط وممتع أخطائي التالية والمفاهيم التي أحتاج مراجعتها:\n\n${mistakeSummary}`;

    return res.json({
      success: true,
      conversationId: quiz.conversationId,
      promptText,
    });
  } catch (err: any) {
    console.error('[EXPLAIN_MISTAKES_ERR]', err);
    return res.status(500).json({ error: 'فشل معالجة طلب شرح الأخطاء.' });
  }
});
