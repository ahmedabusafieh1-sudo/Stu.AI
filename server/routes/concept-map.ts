import { Router, Request, Response } from 'express';
import { eq, and, inArray, asc } from 'drizzle-orm';
import multer from 'multer';
import { getDb } from '../db/index.js';
import { attachments, sourceUnits } from '../../shared/schema.js';
import { generateConceptMapWithGemini, isGeminiConfigured } from '../services/gemini.js';
import { storage } from '../services/storage.js';
import { requireAuth, requireVerified } from '../middleware/auth.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per uploaded file
});

export const conceptMapRouter = Router();

conceptMapRouter.post(
  '/generate',
  requireAuth,
  requireVerified,
  upload.array('files', 10),
  async (req: Request, res: Response) => {
    if (!isGeminiConfigured()) {
      return res.status(503).json({
        error: 'خدمة توليد خريطة المفاهيم غير متاحة: GEMINI_API_KEY غير مضبوط.',
      });
    }

    try {
      const topic = (req.body.topic || '').trim();
      const language = req.body.language === 'en' ? 'en' : 'ar';
      let selectedAttachmentIds: string[] = [];

      if (req.body.selectedAttachmentIds) {
        try {
          selectedAttachmentIds = JSON.parse(req.body.selectedAttachmentIds);
        } catch {
          selectedAttachmentIds = Array.isArray(req.body.selectedAttachmentIds)
            ? req.body.selectedAttachmentIds
            : [req.body.selectedAttachmentIds];
        }
      }

      const { db } = await getDb();
      const sourcesData: { fileName: string; unitIndex: number; text: string }[] = [];
      const imagesData: { mimeType: string; buffer: Buffer; fileName?: string }[] = [];

      // 1. Process files directly uploaded in multipart request
      if (req.files && Array.isArray(req.files) && req.files.length > 0) {
        for (const file of req.files) {
          if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
            imagesData.push({
              mimeType: file.mimetype,
              buffer: file.buffer,
              fileName: file.originalname,
            });
          }
          if (file.mimetype.startsWith('text/') || file.originalname.endsWith('.txt') || file.originalname.endsWith('.md')) {
            sourcesData.push({
              fileName: file.originalname,
              unitIndex: 1,
              text: file.buffer.toString('utf-8').slice(0, 3000),
            });
          }
        }
      }

      // 2. Process existing attachments from database if provided
      if (selectedAttachmentIds.length > 0) {
        const attRecords = await db
          .select()
          .from(attachments)
          .where(and(eq(attachments.userId, req.user!.id), inArray(attachments.id, selectedAttachmentIds)));

        for (const att of attRecords) {
          if ((att.mimeType.startsWith('image/') || att.mimeType === 'application/pdf') && imagesData.length < 5) {
            try {
              const buf = await storage.getFileBuffer(att.storageKey);
              imagesData.push({
                mimeType: att.mimeType,
                buffer: buf,
                fileName: att.originalName,
              });
            } catch (err) {
              console.warn(`[CONCEPT_MAP_ATTACHMENT_ERR] Failed reading ${att.originalName}:`, err);
            }
          }
        }

        // Load extracted source units
        const unitsList = await db
          .select({
            fileName: attachments.originalName,
            unitIndex: sourceUnits.unitIndex,
            text: sourceUnits.contentText,
          })
          .from(sourceUnits)
          .innerJoin(attachments, eq(sourceUnits.attachmentId, attachments.id))
          .where(inArray(sourceUnits.attachmentId, selectedAttachmentIds))
          .orderBy(asc(sourceUnits.unitIndex))
          .limit(8);

        sourcesData.push(...unitsList);
      }

      // If no files were provided, create from topic directly
      if (sourcesData.length === 0 && imagesData.length === 0) {
        if (!topic) {
          return res.status(400).json({ error: 'يرجى إرفاق صور أو ملفات، أو كتابة عنوان الموضوع/الدرس لإنشاء خريطة المفاهيم.' });
        }
        sourcesData.push({
          fileName: 'موضوع مخصص',
          unitIndex: 1,
          text: `الموضوع المطلوب لإنشاء خريطة المفاهيم: ${topic}`,
        });
      }

      const conceptMap = await generateConceptMapWithGemini(sourcesData, {
        topic: topic || undefined,
        language,
        imagesData,
      });

      return res.json({ success: true, conceptMap });
    } catch (err: any) {
      console.error('[CONCEPT_MAP_ERR]', err);
      return res.status(500).json({ error: `فشل إنشاء خريطة المفاهيم: ${err.message}` });
    }
  }
);
