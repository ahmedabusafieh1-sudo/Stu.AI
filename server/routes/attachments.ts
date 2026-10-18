import { Router, Request, Response } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { attachments, sourceUnits } from '../../shared/schema.js';
import { storage } from '../services/storage.js';
import { inspectFileMagicBytes } from '../services/extractor.js';
import { enqueueAttachmentJob } from '../services/jobs.js';
import { requireAuth, requireVerified } from '../middleware/auth.js';

export const attachmentsRouter = Router();

// Configure Multer memory storage with 50MB single file limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB max per file
    files: 20, // 20 files max per request
  },
});

// ----------------------------------------------------
// 1. Upload Attachments
// ----------------------------------------------------
attachmentsRouter.post(
  '/upload',
  requireAuth,
  requireVerified,
  (req: Request, res: Response, next: any) => {
    upload.array('files', 20)(req, res, (err: any) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: 'حجم الملف يتجاوز الحد الأقصى المسموح به (50 ميجابايت للمستندات / 20 ميجابايت للصور).',
          });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({
            error: 'تم تجاوز الحد الأقصى لعدد الملفات المسموح برفعها دفعة واحدة (20 ملفاً).',
          });
        }
        return res.status(400).json({ error: err.message || 'خطأ أثناء رفع الملفات.' });
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'لم يتم اختيار أي ملفات للرفع.' });
    }

    // Check total payload size <= 100 MB
    const totalBytes = files.reduce((acc, f) => acc + f.size, 0);
    if (totalBytes > 100 * 1024 * 1024) {
      return res.status(400).json({ error: 'إجمالي حجم المرفقات يتجاوز الحد الأقصى المسموح به (100 ميجابايت).' });
    }

    const { db } = await getDb();
    const uploadedRecords: any[] = [];
    const errors: string[] = [];

    for (const file of files) {
      try {
        // Validate magic bytes
        const validation = inspectFileMagicBytes(file.buffer, file.originalname);
        if (!validation.isValid) {
          errors.push(`${file.originalname}: ${validation.error}`);
          continue;
        }

        // Additional image size check (20 MB limit for images)
        if (validation.detectedType === 'image' && file.size > 20 * 1024 * 1024) {
          errors.push(`${file.originalname}: حجم الصورة يتجاوز الحد الأقصى للصور (20 ميجابايت).`);
          continue;
        }

        // Generate persistent storage key
        const fileExt = file.originalname.split('.').pop() || 'bin';
        const storageKey = `users/${req.user!.id}/${Date.now()}_${validation.sha256.slice(0, 12)}.${fileExt}`;

        // Save to persistent private storage
        await storage.saveFile(storageKey, file.buffer, validation.detectedMime);

        // Insert database record
        const inserted = await db
          .insert(attachments)
          .values({
            userId: req.user!.id,
            storageKey,
            originalName: file.originalname,
            mimeType: validation.detectedMime,
            sizeBytes: file.size,
            sha256: validation.sha256,
            status: 'inspecting',
            manifest: { status: 'inspecting' },
          })
          .returning();

        const record = inserted[0];

        // Trigger background processing job
        await enqueueAttachmentJob(record.id);

        uploadedRecords.push({
          id: record.id,
          originalName: record.originalName,
          mimeType: record.mimeType,
          sizeBytes: record.sizeBytes,
          status: record.status,
          sha256: record.sha256,
        });
      } catch (err: any) {
        console.error('[UPLOAD_FILE_ERR]', err);
        errors.push(`${file.originalname}: فشل حفظ الملف: ${err.message}`);
      }
    }

    if (uploadedRecords.length === 0) {
      return res.status(400).json({
        error: errors.join(' | ') || 'فشل رفع المرفقات.',
      });
    }

    return res.status(201).json({
      success: true,
      attachments: uploadedRecords,
      warnings: errors.length > 0 ? errors : undefined,
    });
  }
);

// ----------------------------------------------------
// 2. Get Attachment Metadata & Processing Status
// ----------------------------------------------------
attachmentsRouter.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { db } = await getDb();
    const attList = await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, req.params.id), eq(attachments.userId, req.user!.id)))
      .limit(1);

    if (attList.length === 0) {
      return res.status(404).json({ error: 'المرفق غير موجود أو لا تملك صلاحية الوصول إليه.' });
    }

    const attachment = attList[0];

    // Fetch units if processed
    const units = await db
      .select({
        unitIndex: sourceUnits.unitIndex,
        unitType: sourceUnits.unitType,
        factsCount: sourceUnits.facts,
        formulasCount: sourceUnits.formulas,
        status: sourceUnits.status,
      })
      .from(sourceUnits)
      .where(eq(sourceUnits.attachmentId, attachment.id));

    return res.json({
      attachment: {
        id: attachment.id,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        status: attachment.status,
        manifest: attachment.manifest,
        unitsCount: units.length,
        units,
        createdAt: attachment.createdAt,
      },
    });
  } catch (err: any) {
    console.error('[GET_ATTACHMENT_ERR]', err);
    return res.status(500).json({ error: 'حدث خطأ أثناء جلب بيانات المرفق.' });
  }
});

// ----------------------------------------------------
// 3. Download / Stream Original Content (Private Access Only)
// ----------------------------------------------------
attachmentsRouter.get('/:id/content', requireAuth, async (req: Request, res: Response) => {
  try {
    const { db } = await getDb();
    const attList = await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, req.params.id), eq(attachments.userId, req.user!.id)))
      .limit(1);

    if (attList.length === 0) {
      return res.status(404).json({ error: 'المرفق غير موجود أو لا تملك صلاحية الوصول إليه.' });
    }

    const attachment = attList[0];
    const stream = await storage.getFileStream(attachment.storageKey);

    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.originalName)}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');

    stream.pipe(res);
  } catch (err: any) {
    console.error('[ATTACHMENT_STREAM_ERR]', err);
    return res.status(500).json({ error: 'فشل تحميل الملف.' });
  }
});

// ----------------------------------------------------
// 4. Delete Attachment
// ----------------------------------------------------
attachmentsRouter.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { db } = await getDb();
    const attList = await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, req.params.id), eq(attachments.userId, req.user!.id)))
      .limit(1);

    if (attList.length === 0) {
      return res.status(404).json({ error: 'المرفق غير موجود أو تم حذفه مسبقاً.' });
    }

    const attachment = attList[0];

    // Delete physical file from storage
    await storage.deleteFile(attachment.storageKey);

    // Delete DB record (cascades to message_attachments, source_units, processing_jobs)
    await db.delete(attachments).where(eq(attachments.id, attachment.id));

    return res.json({ success: true, message: 'تم حذف المرفق بنجاح.' });
  } catch (err: any) {
    console.error('[ATTACHMENT_DELETE_ERR]', err);
    return res.status(500).json({ error: 'حدث خطأ أثناء حذف المرفق.' });
  }
});
