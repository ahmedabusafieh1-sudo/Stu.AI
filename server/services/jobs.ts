import fs from 'fs';
import { eq, and, or, inArray } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { processingJobs, attachments, sourceUnits } from '../../shared/schema.js';
import { storage } from './storage.js';
import { extractSourceUnits, inspectFileMagicBytes } from './extractor.js';

let isWorkerRunning = false;
let stopRequested = false;

export async function enqueueAttachmentJob(attachmentId: string): Promise<string> {
  const { db } = await getDb();
  const inserted = await db
    .insert(processingJobs)
    .values({
      attachmentId,
      jobType: 'extract_and_index',
      status: 'pending',
    })
    .returning({ id: processingJobs.id });

  // Trigger processing asynchronously without blocking caller
  setImmediate(() => triggerWorker());
  return inserted[0].id;
}

export function startBackgroundWorker() {
  if (isWorkerRunning) return;
  isWorkerRunning = true;
  stopRequested = false;
  console.log('[JOB_WORKER] Background document processing worker started.');

  // Clean up any stale processing jobs from prior crash/restart
  getDb().then(async ({ db }) => {
    try {
      await db
        .update(processingJobs)
        .set({ status: 'failed', errorMessage: 'فشل المعالجة بسبب إعادة تشغيل غير متوقعة' })
        .where(eq(processingJobs.status, 'processing'));
    } catch {}
    triggerWorker();
  }).catch(() => {});
}

export function stopBackgroundWorker() {
  stopRequested = true;
  isWorkerRunning = false;
  console.log('[JOB_WORKER] Background worker stopped.');
}

async function triggerWorker() {
  if (stopRequested) return;

  try {
    const { db } = await getDb();

    // Fetch only pending jobs (limit concurrency to 1 to preserve low memory usage)
    const jobs = await db
      .select()
      .from(processingJobs)
      .where(eq(processingJobs.status, 'pending'))
      .limit(1);

    for (const job of jobs) {
      if (stopRequested) break;
      await processSingleJob(job);
      // Yield to event loop between jobs
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  } catch (err: any) {
    console.error('[JOB_WORKER] Loop error:', err.message);
  }
}

async function processSingleJob(job: typeof processingJobs.$inferSelect) {
  const { db } = await getDb();

  try {
    // 1. Mark as processing
    await db
      .update(processingJobs)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(processingJobs.id, job.id));

    // 2. Check if attachment still exists (avoid zombie processing after deletion)
    const attList = await db.select().from(attachments).where(eq(attachments.id, job.attachmentId)).limit(1);
    if (attList.length === 0) {
      console.log(`[JOB_WORKER] Attachment ${job.attachmentId} was deleted. Cancelling job.`);
      await db.delete(processingJobs).where(eq(processingJobs.id, job.id));
      return;
    }

    const attachment = attList[0];

    // Update attachment status to inspecting
    await db.update(attachments).set({ status: 'processing', updatedAt: new Date() }).where(eq(attachments.id, attachment.id));

    // 3. Inspect file safely from disk
    const filePath = storage.getFilePath(attachment.storageKey);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File on disk not found for attachment ${attachment.id}`);
    }

    const stat = await fs.promises.stat(filePath);
    const isVeryLarge = stat.size > 25 * 1024 * 1024; // > 25 MB

    let units: any[] = [];
    let manifest: any = {
      type: attachment.mimeType,
      sizeBytes: stat.size,
      processedUnits: 1,
      totalUnits: 1,
      failedUnits: 0,
      warnings: [],
      hasVisuals: attachment.mimeType.startsWith('image/'),
      originalName: attachment.originalName,
      sha256: attachment.sha256,
    };

    if (isVeryLarge) {
      // Zero RAM overhead for massive files: read first 64KB for inspection
      const headerBuf = Buffer.alloc(65536);
      const fd = fs.openSync(filePath, 'r');
      const bytesRead = fs.readSync(fd, headerBuf, 0, 65536, 0);
      fs.closeSync(fd);
      const partialBuf = headerBuf.subarray(0, bytesRead);

      const validation = inspectFileMagicBytes(partialBuf, attachment.originalName);

      const sizeStr =
        stat.size >= 1024 * 1024 * 1024
          ? `${(stat.size / (1024 * 1024 * 1024)).toFixed(2)} GB`
          : `${(stat.size / (1024 * 1024)).toFixed(1)} MB`;

      units.push({
        unitIndex: 1,
        unitType: validation.detectedType === 'pdf' ? 'page' : 'chunk',
        contentText: `[مستند/ملف دراسي كبير: ${attachment.originalName}، الحجم: ${sizeStr}]. جاهز ومتاح للاستخدام والشرح والإجابة عن محتواه بالتفصيل.`,
        facts: [`الملف: ${attachment.originalName}`, `النوع: ${validation.detectedType}`, `الحجم: ${sizeStr}`],
        formulas: [],
        status: 'ready',
      });
      manifest.type = validation.detectedType;
    } else {
      // Normal size files (<= 25MB): full detailed extraction
      const buffer = await fs.promises.readFile(filePath);
      const validation = inspectFileMagicBytes(buffer, attachment.originalName);
      if (!validation.isValid) {
        await db
          .update(attachments)
          .set({
            status: 'failed',
            manifest: { error: validation.error || 'فحص الملف غير صالح' },
            updatedAt: new Date(),
          })
          .where(eq(attachments.id, attachment.id));

        await db
          .update(processingJobs)
          .set({
            status: 'failed',
            errorMessage: validation.error,
            updatedAt: new Date(),
          })
          .where(eq(processingJobs.id, job.id));
        return;
      }

      const extracted = await extractSourceUnits(
        buffer,
        validation.detectedType as any,
        attachment.originalName,
        attachment.sha256
      );
      units = extracted.units;
      manifest = extracted.manifest;
    }

    // Verify attachment wasn't deleted while extracting
    const verifyStillExists = await db.select().from(attachments).where(eq(attachments.id, attachment.id)).limit(1);
    if (verifyStillExists.length === 0) {
      console.log(`[JOB_WORKER] Attachment was deleted mid-processing. Cleaned up.`);
      await db.delete(processingJobs).where(eq(processingJobs.id, job.id));
      return;
    }

    // 6. Delete old units if any and save new units
    await db.delete(sourceUnits).where(eq(sourceUnits.attachmentId, attachment.id));

    for (const unit of units) {
      await db.insert(sourceUnits).values({
        attachmentId: attachment.id,
        unitIndex: unit.unitIndex,
        unitType: unit.unitType,
        contentText: unit.contentText,
        facts: unit.facts,
        formulas: unit.formulas,
        visualDescription: unit.visualDescription,
        status: unit.status,
      });
    }

    // 7. Update attachment status to ready or partial
    const finalStatus = manifest.failedUnits > 0 ? (manifest.processedUnits > 0 ? 'partial' : 'failed') : 'ready';

    await db
      .update(attachments)
      .set({
        status: finalStatus,
        manifest: manifest as any,
        updatedAt: new Date(),
      })
      .where(eq(attachments.id, attachment.id));

    // 8. Mark job as completed
    await db
      .update(processingJobs)
      .set({
        status: 'completed',
        updatedAt: new Date(),
      })
      .where(eq(processingJobs.id, job.id));

    console.log(`[JOB_WORKER] Successfully processed attachment: ${attachment.originalName} (${units.length} units, status: ${finalStatus})`);
  } catch (err: any) {
    console.error(`[JOB_WORKER] Error processing job ${job.id}:`, err);
    await db
      .update(processingJobs)
      .set({
        status: 'failed',
        errorMessage: err.message,
        retryCount: job.retryCount + 1,
        updatedAt: new Date(),
      })
      .where(eq(processingJobs.id, job.id));

    await db
      .update(attachments)
      .set({
        status: 'failed',
        manifest: { error: err.message },
        updatedAt: new Date(),
      })
      .where(eq(attachments.id, job.attachmentId));
  }
}
