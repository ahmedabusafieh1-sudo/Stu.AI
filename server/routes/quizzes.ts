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
  messageAttachments,
  sourceUnits,
  createQuizSchema,
  submitQuizSchema,
} from '../../shared/schema.js';
import {
  generateQuizWithGemini,
  gradeEssayAnswer,
  isGeminiConfigured,
} from '../services/gemini.js';
import { storage } from '../services/storage.js';
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
    let currentConv: any = null;
    if (conversationId) {
      const convList = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.userId, req.user!.id)))
        .limit(1);

      if (convList.length === 0) {
        return res.status(404).json({ error: 'المحادثة المحددة غير موجودة.' });
      }
      currentConv = convList[0];
    }

    // Collect source material from user attachments
    let targetAttachmentIds: string[] = [];

    if (selectedAttachmentIds && selectedAttachmentIds.length > 0) {
      targetAttachmentIds = selectedAttachmentIds;
    } else if (conversationId) {
      // Find attachments belonging specifically to messages in this conversation
      const convMessages = await db
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.conversationId, conversationId));

      const msgIds = convMessages.map((m: any) => m.id);
      if (msgIds.length > 0) {
        const convAttachments = await db
          .select({ attachmentId: messageAttachments.attachmentId })
          .from(messageAttachments)
          .where(inArray(messageAttachments.messageId, msgIds));

        targetAttachmentIds = convAttachments.map((a: any) => a.attachmentId);
      }
    }

    // Check for images among target attachments
    const imagesData: { mimeType: string; buffer: Buffer; fileName?: string }[] = [];
    if (targetAttachmentIds.length > 0) {
      const targetAttRecords = await db
        .select()
        .from(attachments)
        .where(and(eq(attachments.userId, req.user!.id), inArray(attachments.id, targetAttachmentIds)));

      for (const att of targetAttRecords) {
        if ((att.mimeType.startsWith('image/') || att.mimeType === 'application/pdf') && imagesData.length < 5) {
          try {
            const buf = await storage.getFileBuffer(att.storageKey);
            imagesData.push({
              mimeType: att.mimeType,
              buffer: buf,
              fileName: att.originalName,
            });
          } catch (err) {
            console.warn(`[QUIZ_ATTACHMENT_LOAD_ERR] Failed loading ${att.originalName}:`, err);
          }
        }
      }
    }

    // Load extracted source units (cap at 6 to prevent exceeding Gemini token rate limits)
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
        .orderBy(asc(sourceUnits.unitIndex))
        .limit(6);

      sourcesData = unitsList;
    }

    let effectiveTopic = topic?.trim();

    // If no attachment sources, pull context from conversation messages
    if (sourcesData.length === 0 && imagesData.length === 0 && conversationId) {
      const convMsgs = await db
        .select({ role: messages.role, content: messages.content })
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(desc(messages.sequence))
        .limit(10);

      if (convMsgs.length > 0) {
        const conversationText = convMsgs
          .reverse()
          .map((m: any) => `${m.role === 'assistant' ? 'Stu.Ai' : 'الطالب'}: ${m.content}`)
          .join('\n\n');

        if (conversationText.trim().length > 30) {
          sourcesData.push({
            fileName: 'سجل المحادثة الدراسية الحالية',
            unitIndex: 1,
            text: conversationText.slice(0, 3000),
          });
        }
      }

      // If still no topic, check conversation title
      if (!effectiveTopic && currentConv?.title && currentConv.title !== 'محادثة جديدة') {
        effectiveTopic = currentConv.title;
      }
    }

    // Smart default topic if student left it blank and no files
    if (!effectiveTopic && sourcesData.length === 0 && imagesData.length === 0) {
      effectiveTopic = 'مفاهيم دراسية ومعلومات علمية عامة وتطبيقات تفاعلية';
    }

    // If no text source units, provide context block
    if (sourcesData.length === 0) {
      sourcesData.push({
        fileName: imagesData.length > 0 ? 'الصور والمرفقات المحددة' : 'موضوع مخصص',
        unitIndex: 1,
        text: effectiveTopic
          ? `الموضوع الدراسي المطلوب: ${effectiveTopic}`
          : 'المطلوب إنشاء كويز تفاعلي شامل ومتقن بناءً على الصور والمرفقات المعطاة.',
      });
    }

    // Generate Quiz questions via Gemini structured output
    const generated = await generateQuizWithGemini(sourcesData, {
      type,
      questionCount,
      difficulty,
      language,
      customTopic: effectiveTopic,
      imagesData,
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
    const insertedQuestions: any[] = [];
    for (let i = 0; i < generated.questions.length; i++) {
      const q = generated.questions[i];
      const isEssay = q.questionType === 'essay' || !Array.isArray(q.options) || q.options.length < 2;
      const inserted = await db
        .insert(quizQuestions)
        .values({
          quizId: quiz.id,
          questionOrder: i + 1,
          questionType: isEssay ? 'essay' : 'mcq',
          questionText: q.questionText,
          options: isEssay ? [] : (q.options || []),
          correctKey: q.correctKey,
          explanation: q.explanation,
          points: q.points || 1,
          topic: q.topic || 'عام',
          sourceReferences: q.sourceReferences || [],
        })
        .returning();
      insertedQuestions.push(inserted[0]);
    }

    // Fetch sanitized questions for client (STRIP correctKey and explanation, but include id)
    const clientQuestions = insertedQuestions.map((q) => ({
      id: q.id,
      questionOrder: q.questionOrder,
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

      const isMcq = q.questionType === 'mcq' && Array.isArray(q.options) && q.options.length >= 2;

      if (isMcq) {
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

// ----------------------------------------------------
// 5. Save Quiz & Answers to Chat Conversation
// ----------------------------------------------------
quizzesRouter.post('/:id/save-to-chat', requireAuth, requireVerified, async (req: Request, res: Response) => {
  try {
    const { includeCorrections } = req.body;
    const { db } = await getDb();

    // Verify quiz ownership
    const quizList = await db
      .select()
      .from(quizzes)
      .where(and(eq(quizzes.id, req.params.id), eq(quizzes.userId, req.user!.id)))
      .limit(1);

    if (quizList.length === 0) {
      return res.status(404).json({ error: 'الكويز غير موجود أو غير مصرح بالوصول إليه.' });
    }

    const quiz = quizList[0];
    let targetConvId = quiz.conversationId;

    // If quiz has no linked conversation, link to latest or create a new one
    if (!targetConvId) {
      const latestConv = await db
        .select()
        .from(conversations)
        .where(eq(conversations.userId, req.user!.id))
        .orderBy(desc(conversations.updatedAt))
        .limit(1);

      if (latestConv.length > 0) {
        targetConvId = latestConv[0].id;
      } else {
        const createdConv = await db
          .insert(conversations)
          .values({
            userId: req.user!.id,
            title: quiz.title,
          })
          .returning();
        targetConvId = createdConv[0].id;
      }

      await db.update(quizzes).set({ conversationId: targetConvId }).where(eq(quizzes.id, quiz.id));
    }

    // Fetch quiz questions
    const qList = await db
      .select()
      .from(quizQuestions)
      .where(eq(quizQuestions.quizId, quiz.id))
      .orderBy(asc(quizQuestions.questionOrder));

    // Fetch latest completed attempt and answers
    const attempts = await db
      .select()
      .from(quizAttempts)
      .where(and(eq(quizAttempts.quizId, quiz.id), eq(quizAttempts.userId, req.user!.id)))
      .orderBy(desc(quizAttempts.createdAt))
      .limit(1);

    const attempt = attempts[0];
    let answersMap = new Map<string, any>();
    if (attempt) {
      const answersList = await db
        .select()
        .from(quizAnswers)
        .where(eq(quizAnswers.attemptId, attempt.id));
      answersMap = new Map<string, any>(answersList.map((a: any) => [a.questionId, a]));
    }

    // Determine sequence
    const lastMsg = await db
      .select({ sequence: messages.sequence })
      .from(messages)
      .where(eq(messages.conversationId, targetConvId))
      .orderBy(desc(messages.sequence))
      .limit(1);

    const nextSeq = (lastMsg[0]?.sequence ?? 0) + 1;

    let chatContent = '';
    if (includeCorrections && attempt && attempt.status === 'completed') {
      const percentage = attempt.totalPoints > 0 ? Math.round((attempt.score / attempt.totalPoints) * 100) : 0;
      chatContent = `### 📊 تقرير نتيجة وتصحيح الاختبار: **${quiz.title}**\n\n`;
      chatContent += `🏆 **النتيجة النهائية:** ${attempt.score} من ${attempt.totalPoints} (${percentage}%)\n\n`;
      chatContent += `---\n\n#### 📝 تفاصيل الأسئلة والتصحيح الشامل:\n\n`;

      qList.forEach((q: any, idx: number) => {
        const ans = answersMap.get(q.id);
        const studentAns = ans?.studentAnswer?.trim() || '[لم تتم الإجابة]';
        const isCorrect = ans?.isCorrect ?? false;
        const icon = isCorrect ? '✅ إجابة صحيحة' : '❌ إجابة غير صحيحة';
        const pointsAwarded = ans?.earnedPoints ?? (isCorrect ? q.points : 0);

        chatContent += `**السؤال ${idx + 1}: ${q.questionText}** (${pointsAwarded}/${q.points} درجة) - ${icon}\n`;
        chatContent += `- **إجابتك:** ${studentAns}\n`;
        if (!isCorrect) {
          chatContent += `- **الإجابة النموذجية الصحيحة:** ${q.correctKey}\n`;
        }
        chatContent += `- **التفسير والشرح:** ${q.explanation}\n`;
        if (ans?.aiFeedback) {
          chatContent += `- **ملاحظات المصحح:** ${ans.aiFeedback}\n`;
        }
        chatContent += `\n`;
      });
    } else {
      chatContent = `### 📝 سجل إجابات الاختبار: **${quiz.title}**\n\n`;
      chatContent += `**عدد الأسئلة:** ${qList.length} | **النوع:** ${quiz.type} | **الصعوبة:** ${quiz.difficulty}\n\n`;
      chatContent += `---\n\n#### 📋 إجابات الطالب المسجلة:\n\n`;

      qList.forEach((q: any, idx: number) => {
        const ans = answersMap.get(q.id);
        const studentAns = ans?.studentAnswer?.trim() || '[لم تتم الإجابة]';
        chatContent += `**السؤال ${idx + 1}: ${q.questionText}**\n`;
        chatContent += `- **إجابتك المسجلة:** ${studentAns}\n\n`;
      });

      chatContent += `> 💡 *ملاحظة: يمكنك في أي وقت طلب تصحيح هذا الاختبار أو سؤالي عن أي سؤال لمزيد من التوضيح والشرح.*`;
    }

    const insertedMsg = await db
      .insert(messages)
      .values({
        conversationId: targetConvId,
        role: 'assistant',
        content: chatContent,
        status: 'complete',
        sequence: nextSeq,
      })
      .returning();

    // Update conversation updatedAt
    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, targetConvId));

    return res.status(201).json({
      success: true,
      message: insertedMsg[0],
      conversationId: targetConvId,
    });
  } catch (err: any) {
    console.error('[SAVE_QUIZ_TO_CHAT_ERR]', err);
    return res.status(500).json({ error: 'فشل حفظ الكويز في المحادثة.' });
  }
});

