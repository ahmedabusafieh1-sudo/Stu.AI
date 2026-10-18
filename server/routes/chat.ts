import { Router, Request, Response } from 'express';
import multer from 'multer';
import { eq, and, desc, asc, inArray } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import {
  conversations,
  messages,
  attachments,
  messageAttachments,
  sourceUnits,
  userSettings,
  usageRecords,
  createConversationSchema,
  renameConversationSchema,
  sendMessageSchema,
} from '../../shared/schema.js';
import {
  streamGeminiChat,
  transcribeAudio,
  isGeminiConfigured,
} from '../services/gemini.js';
import { storage } from '../services/storage.js';
import { verifyAndAnnotateCitations } from '../services/citations.js';
import { requireAuth, requireVerified } from '../middleware/auth.js';

export const chatRouter = Router();

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB for voice recording
  },
});

// ----------------------------------------------------
// 1. List User Conversations
// ----------------------------------------------------
chatRouter.get('/conversations', requireAuth, async (req: Request, res: Response) => {
  try {
    const { db } = await getDb();
    const userConvs = await db
      .select({
        id: conversations.id,
        title: conversations.title,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .where(eq(conversations.userId, req.user!.id))
      .orderBy(desc(conversations.updatedAt));

    return res.json({ conversations: userConvs });
  } catch (err: any) {
    console.error('[GET_CONVERSATIONS_ERR]', err);
    return res.status(500).json({ error: 'فشل استرجاع المحادثات.' });
  }
});

// ----------------------------------------------------
// 2. Create New Conversation
// ----------------------------------------------------
chatRouter.post('/conversations', requireAuth, async (req: Request, res: Response) => {
  const parseResult = createConversationSchema.safeParse(req.body);
  const title = parseResult.success && parseResult.data.title ? parseResult.data.title : 'محادثة جديدة';

  try {
    const { db } = await getDb();
    const inserted = await db
      .insert(conversations)
      .values({
        userId: req.user!.id,
        title,
      })
      .returning();

    return res.status(201).json({ conversation: inserted[0] });
  } catch (err: any) {
    console.error('[CREATE_CONVERSATION_ERR]', err);
    return res.status(500).json({ error: 'فشل إنشاء محادثة جديدة.' });
  }
});

// ----------------------------------------------------
// 3. Get Conversation Details with Messages & Attachments
// ----------------------------------------------------
chatRouter.get('/conversations/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { db } = await getDb();
    const convList = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, req.params.id), eq(conversations.userId, req.user!.id)))
      .limit(1);

    if (convList.length === 0) {
      return res.status(404).json({ error: 'المحادثة غير موجودة أو لا تملك صلاحية الوصول إليها.' });
    }

    const conv = convList[0];

    // Fetch messages in chronological order
    const msgList = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conv.id))
      .orderBy(asc(messages.sequence));

    // Fetch message attachments
    const msgIds = msgList.map((m: any) => m.id);
    let attachmentsMap: Record<string, any[]> = {};

    if (msgIds.length > 0) {
      const msgAtts = await db
        .select({
          messageId: messageAttachments.messageId,
          attachmentId: attachments.id,
          originalName: attachments.originalName,
          mimeType: attachments.mimeType,
          sizeBytes: attachments.sizeBytes,
          status: attachments.status,
          manifest: attachments.manifest,
        })
        .from(messageAttachments)
        .innerJoin(attachments, eq(messageAttachments.attachmentId, attachments.id))
        .where(inArray(messageAttachments.messageId, msgIds))
        .orderBy(asc(messageAttachments.sequenceOrder));

      for (const item of msgAtts) {
        if (!attachmentsMap[item.messageId]) {
          attachmentsMap[item.messageId] = [];
        }
        attachmentsMap[item.messageId].push({
          id: item.attachmentId,
          originalName: item.originalName,
          mimeType: item.mimeType,
          sizeBytes: item.sizeBytes,
          status: item.status,
          manifest: item.manifest,
        });
      }
    }

    const enrichedMessages = msgList.map((m: any) => ({
      ...m,
      attachments: attachmentsMap[m.id] || [],
    }));

    return res.json({
      conversation: conv,
      messages: enrichedMessages,
    });
  } catch (err: any) {
    console.error('[GET_CONVERSATION_ERR]', err);
    return res.status(500).json({ error: 'فشل تحميل بيانات المحادثة.' });
  }
});

// ----------------------------------------------------
// 4. Rename Conversation
// ----------------------------------------------------
chatRouter.patch('/conversations/:id', requireAuth, async (req: Request, res: Response) => {
  const parseResult = renameConversationSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.errors[0]?.message || 'العنوان غير صالح' });
  }

  try {
    const { db } = await getDb();
    const updated = await db
      .update(conversations)
      .set({ title: parseResult.data.title, updatedAt: new Date() })
      .where(and(eq(conversations.id, req.params.id), eq(conversations.userId, req.user!.id)))
      .returning();

    if (updated.length === 0) {
      return res.status(404).json({ error: 'المحادثة غير موجودة أو لا تملك صلاحية تعديلها.' });
    }

    return res.json({ conversation: updated[0] });
  } catch (err: any) {
    console.error('[RENAME_CONV_ERR]', err);
    return res.status(500).json({ error: 'فشل تعديل عنوان المحادثة.' });
  }
});

// ----------------------------------------------------
// 5. Delete Conversation
// ----------------------------------------------------
chatRouter.delete('/conversations/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { db } = await getDb();
    const convList = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, req.params.id), eq(conversations.userId, req.user!.id)))
      .limit(1);

    if (convList.length === 0) {
      return res.status(404).json({ error: 'المحادثة غير موجودة أو تم حذفها مسبقاً.' });
    }

    // Cascade delete on DB cleans up messages, message_attachments, quizzes
    await db.delete(conversations).where(eq(conversations.id, req.params.id));

    return res.json({ success: true, message: 'تم حذف المحادثة بنجاح.' });
  } catch (err: any) {
    console.error('[DELETE_CONV_ERR]', err);
    return res.status(500).json({ error: 'فشل حذف المحادثة.' });
  }
});

// ----------------------------------------------------
// 6. Send Message with Real-Time SSE Streaming
// ----------------------------------------------------
chatRouter.post(
  '/conversations/:id/messages',
  requireAuth,
  requireVerified,
  async (req: Request, res: Response) => {
    const parseResult = sendMessageSchema.safeParse({
      ...req.body,
      conversationId: req.params.id,
    });

    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.errors[0]?.message || 'بيانات الرسالة غير صالحة' });
    }

    const { content, attachmentIds, actionType, useSearchGrounding, idempotencyKey } = parseResult.data;
    const conversationId = req.params.id;

    // Check Gemini API Key configuration
    if (!isGeminiConfigured()) {
      return res.status(503).json({
        error: 'خدمة الذكاء الاصطناعي (Gemini) غير مضبوطة حالياً في الخادم. يرجى إضافة GEMINI_API_KEY في ملف .env للمتابعة.',
        geminiMissing: true,
      });
    }

    try {
      const { db } = await getDb();

      // 1. Verify user owns conversation
      const convList = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.userId, req.user!.id)))
        .limit(1);

      if (convList.length === 0) {
        return res.status(404).json({ error: 'المحادثة غير موجودة.' });
      }

      const conversation = convList[0];

      // 2. Idempotency protection against duplicate network submissions
      if (idempotencyKey) {
        const existing = await db
          .select()
          .from(messages)
          .where(and(eq(messages.conversationId, conversationId), eq(messages.idempotencyKey, idempotencyKey)))
          .limit(1);
        if (existing.length > 0) {
          return res.json({ message: existing[0], duplicate: true });
        }
      }

      // 3. Get next sequence number
      const lastMsgList = await db
        .select({ sequence: messages.sequence })
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(desc(messages.sequence))
        .limit(1);

      const nextSequence = (lastMsgList[0]?.sequence || 0) + 1;

      // 4. Save user message
      const insertedUserMsg = await db
        .insert(messages)
        .values({
          conversationId,
          role: 'user',
          content: content.trim(),
          status: 'complete',
          sequence: nextSequence,
          idempotencyKey,
        })
        .returning();

      const userMessage = insertedUserMsg[0];

      // 5. Link attachments to message
      if (attachmentIds && attachmentIds.length > 0) {
        for (let i = 0; i < attachmentIds.length; i++) {
          await db.insert(messageAttachments).values({
            messageId: userMessage.id,
            attachmentId: attachmentIds[i],
            sequenceOrder: i,
          });
        }
      }

      // 6. Auto-generate title if this is the first user message
      if (nextSequence === 1) {
        const rawTitle = content.trim().slice(0, 40) || (attachmentIds && attachmentIds.length > 0 ? 'مرفقات دراسية' : 'محادثة جديدة');
        await db
          .update(conversations)
          .set({ title: rawTitle, updatedAt: new Date() })
          .where(eq(conversations.id, conversationId));
      } else {
        await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));
      }

      // 7. Load user settings for preferred language
      const userSettingList = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, req.user!.id))
        .limit(1);
      const preferredLanguage = userSettingList[0]?.preferredExplanationLang || 'auto';

      // 8. Fetch attachment buffers and unit texts for Gemini
      const attachmentsData: any[] = [];
      const manifestListForCitations: any[] = [];

      if (attachmentIds && attachmentIds.length > 0) {
        const userAtts = await db
          .select()
          .from(attachments)
          .where(and(inArray(attachments.id, attachmentIds), eq(attachments.userId, req.user!.id)));

        for (const att of userAtts) {
          // Read buffer for images or PDFs up to 15MB
          let buffer: Buffer | undefined = undefined;
          if (att.mimeType.startsWith('image/') || (att.mimeType === 'application/pdf' && att.sizeBytes <= 15 * 1024 * 1024)) {
            try {
              buffer = await storage.getFileBuffer(att.storageKey);
            } catch (e) {
              console.warn(`Could not read buffer for attachment ${att.id}:`, e);
            }
          }

          // Fetch extracted units
          const units = await db
            .select()
            .from(sourceUnits)
            .where(eq(sourceUnits.attachmentId, att.id))
            .orderBy(asc(sourceUnits.unitIndex));

          let combinedUnitText = units
            .map((u: any) => `[الوحدة/الصفحة ${u.unitIndex} (${u.unitType})]:\n${u.contentText}`)
            .join('\n\n');

          // Safeguard against Google Gemini free tier 250,000 input tokens limit:
          // Cap extracted text per attachment to ~100,000 characters (~25,000 tokens)
          if (combinedUnitText.length > 100000) {
            combinedUnitText =
              combinedUnitText.slice(0, 100000) +
              '\n\n[ملاحظة: تم تضمين الصفحات والوحدات الأولى من المستند الكبير لتناسب معايير المعالجة الدراسية]';
          }

          attachmentsData.push({
            fileName: att.originalName,
            mimeType: att.mimeType,
            buffer,
            extractedText: combinedUnitText || undefined,
          });

          manifestListForCitations.push({
            fileName: att.originalName,
            totalUnits: units.length || 1,
            unitIndices: units.map((u: any) => u.unitIndex),
          });
        }
      }

      // 9. Load recent conversation history (last 10 messages for context)
      const historyList = await db
        .select({ role: messages.role, content: messages.content })
        .from(messages)
        .where(and(eq(messages.conversationId, conversationId), eq(messages.status, 'complete')))
        .orderBy(desc(messages.sequence))
        .limit(10);

      const conversationHistory = historyList
        .reverse()
        .filter((m: any) => m.role === 'user' || m.role === 'assistant') as any;

      // 10. Create placeholder assistant message in DB with 'streaming' status
      const assistantSeq = nextSequence + 1;
      const insertedAssistantMsg = await db
        .insert(messages)
        .values({
          conversationId,
          role: 'assistant',
          content: '',
          status: 'streaming',
          sequence: assistantSeq,
        })
        .returning();

      const assistantMessage = insertedAssistantMsg[0];

      // 11. Configure Server-Sent Events (SSE) headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      // Send initial metadata event
      res.write(
        `event: start\ndata: ${JSON.stringify({
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
        })}\n\n`
      );

      let accumulatedContent = '';
      let isClientAborted = false;
      let capturedGrounding: any = null;
      let capturedUsage: any = null;

      // Handle client disconnect / cancellation
      req.on('close', () => {
        isClientAborted = true;
      });

      // Stream generation
      try {
        const streamResult = await streamGeminiChat(
          conversationHistory,
          content,
          attachmentsData,
          {
            onChunk: (chunk: string) => {
              if (isClientAborted) return;
              accumulatedContent += chunk;
              res.write(`event: chunk\ndata: ${JSON.stringify({ chunk })}\n\n`);
            },
            onGrounding: (sources, queries) => {
              capturedGrounding = { sources, queries };
              res.write(`event: grounding\ndata: ${JSON.stringify(capturedGrounding)}\n\n`);
            },
            onUsage: (usage) => {
              capturedUsage = usage;
            },
          },
          {
            actionType,
            preferredLanguage,
            useSearchGrounding,
          }
        );

        if (!capturedGrounding && streamResult.searchGrounding) {
          capturedGrounding = streamResult.searchGrounding;
        }

        // 12. Verify citations against real source units
        const { cleanedText, citations } = verifyAndAnnotateCitations(accumulatedContent, manifestListForCitations);

        // 13. Update final assistant message in DB
        await db
          .update(messages)
          .set({
            content: cleanedText,
            status: isClientAborted ? 'aborted' : 'complete',
            citations: citations as any,
            searchGrounding: capturedGrounding,
          })
          .where(eq(messages.id, assistantMessage.id));

        // 14. Record usage metrics
        if (capturedUsage) {
          await db.insert(usageRecords).values({
            userId: req.user!.id,
            requestType: 'chat',
            modelUsed: actionType === 'reexplain' ? 'gemini-2.5-flash' : 'gemini-2.5-flash',
            promptTokens: capturedUsage.promptTokens,
            candidateTokens: capturedUsage.candidateTokens,
            totalTokens: capturedUsage.totalTokens,
          });
        }

        // Send done event to client
        res.write(
          `event: done\ndata: ${JSON.stringify({
            messageId: assistantMessage.id,
            content: cleanedText,
            citations,
            searchGrounding: capturedGrounding,
            status: isClientAborted ? 'aborted' : 'complete',
          })}\n\n`
        );
        res.end();
      } catch (geminiErr: any) {
        console.error('[GEMINI_STREAM_FAIL]', geminiErr);

        // Save partial response with 'failed' status
        await db
          .update(messages)
          .set({
            content: accumulatedContent || 'عذراً، حدث خطأ أثناء معالجة السؤال من قبل خدمة الذكاء الاصطناعي.',
            status: 'failed',
          })
          .where(eq(messages.id, assistantMessage.id));

        res.write(
          `event: error\ndata: ${JSON.stringify({
            error: geminiErr.message || 'حدث خطأ أثناء التواصل مع نموذج الذكاء الاصطناعي.',
            messageId: assistantMessage.id,
          })}\n\n`
        );
        res.end();
      }
    } catch (err: any) {
      console.error('[SEND_MESSAGE_ERR]', err);
      if (!res.headersSent) {
        return res.status(500).json({ error: 'حدث خطأ في الخادم أثناء إرسال الرسالة.' });
      }
    }
  }
);

// ----------------------------------------------------
// 7. Audio Dictation Transcription Endpoint
// ----------------------------------------------------
chatRouter.post(
  '/transcribe',
  requireAuth,
  requireVerified,
  audioUpload.single('audio'),
  async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'لم يتم استلام أي ملف صوتي للتفريغ.' });
    }

    if (!isGeminiConfigured()) {
      return res.status(503).json({
        error: 'خدمة التفريغ الصوتي غير متاحة لعدم ضبط مفتاح GEMINI_API_KEY.',
      });
    }

    try {
      const mimeType = file.mimetype || 'audio/webm';
      const transcribedText = await transcribeAudio(file.buffer, mimeType);

      return res.json({
        success: true,
        text: transcribedText,
      });
    } catch (err: any) {
      console.error('[TRANSCRIBE_ERR]', err);
      return res.status(500).json({
        error: `فشل التفريغ الصوتي: ${err.message}`,
      });
    }
  }
);
