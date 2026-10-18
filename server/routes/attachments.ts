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

import fs from 'fs';
import path from 'path';

export const attachmentsRouter = Router();

const tempUploadDir = path.resolve(process.cwd(), './data/uploads_temp');
if (!fs.existsSync(tempUploadDir)) {
  fs.mkdirSync(tempUploadDir, { recursive: true });
}

function sanitizeOriginalName(rawName: string): string {
  try {
    const fixed = Buffer.from(rawName, 'latin1').toString('utf8');
    if (fixed && !fixed.includes('\ufffd')) {
      return fixed;
    }
  } catch {}
  return rawName;
}

// Stream uploads directly to disk chunks to use near-zero RAM
const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, tempUploadDir);
  },
  filename: (_req, file, cb) => {
    const originalName = sanitizeOriginalName(file.originalname);
    const unique = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    cb(null, `${unique}_${originalName.replace(/[^a-zA-Z0-9._\-\u0600-\u06FF]/g, '_')}`);
  },
});

// Configure Multer with 100GB per file limit (streamed directly to disk)
const upload = multer({
  storage: diskStorage,
  limits: {
    fileSize: 100 * 1024 * 1024 * 1024, // 100 GB max per file
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
            error: 'حجم الملف يتجاوز الحد الأقصى المسموح به (100 جيجابايت).',
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

    const { db } = await getDb();
    const uploadedRecords: any[] = [];
    const errors: string[] = [];

    for (const file of files) {
      const originalName = sanitizeOriginalName(file.originalname);
      try {
        // Read first 4KB of file header from disk for magic bytes inspection (Zero RAM overhead)
        const headerBuffer = Buffer.alloc(4096);
        const fd = fs.openSync(file.path, 'r');
        const bytesRead = fs.readSync(fd, headerBuffer, 0, 4096, 0);
        fs.closeSync(fd);
        const fileHeader = headerBuffer.subarray(0, bytesRead);

        // Compute sha256 via streaming (Zero RAM overhead)
        const hash = crypto.createHash('sha256');
        await new Promise<void>((resolve, reject) => {
          const stream = fs.createReadStream(file.path);
          stream.on('data', (chunk) => hash.update(chunk));
          stream.on('end', () => resolve());
          stream.on('error', reject);
        });
        const fileSha256 = hash.digest('hex');

        // Validate magic bytes
        const validation = inspectFileMagicBytes(fileHeader, originalName);
        validation.sha256 = fileSha256;

        if (!validation.isValid) {
          errors.push(`${originalName}: ${validation.error}`);
          await fs.promises.unlink(file.path).catch(() => {});
          continue;
        }

        // Generate persistent storage key
        const fileExt = originalName.split('.').pop() || 'bin';
        const storageKey = `users/${req.user!.id}/${Date.now()}_${fileSha256.slice(0, 12)}.${fileExt}`;

        // Save directly from disk path to persistent storage
        await storage.saveFileFromPath(storageKey, file.path, validation.detectedMime);
        // Remove temp upload file if still exists
        await fs.promises.unlink(file.path).catch(() => {});

        // Insert database record
        const inserted = await db
          .insert(attachments)
          .values({
            userId: req.user!.id,
            storageKey,
            originalName,
            mimeType: validation.detectedMime,
            sizeBytes: file.size,
            sha256: fileSha256,
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
        if (file.path) {
          await fs.promises.unlink(file.path).catch(() => {});
        }
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
    const fullPath = storage.getFilePath(attachment.storageKey);

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'الملف غير موجود في وحدة التخزين.' });
    }

    const safeAscii = attachment.originalName.replace(/[^\x20-\x7E]/g, '_');
    const utf8Encoded = encodeURIComponent(attachment.originalName);

    res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${safeAscii}"; filename*=UTF-8''${utf8Encoded}`);
    res.setHeader('Cache-Control', 'private, max-age=86400');

    // res.sendFile provides full HTTP Range 206 Partial Content support,
    // allowing any size PDF, video, audio or document to open immediately in browser viewers!
    return res.sendFile(path.resolve(fullPath), (err) => {
      if (err && !res.headersSent) {
        console.error('[ATTACHMENT_SENDFILE_ERR]', err);
        res.status(500).json({ error: 'فشل فتح الملف' });
      }
    });
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
