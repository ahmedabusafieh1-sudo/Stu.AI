import { Router, Request, Response } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { notes, saveNoteSchema } from '../../shared/schema.js';
import { requireAuth, requireVerified } from '../middleware/auth.js';

export const notesRouter = Router();

// ----------------------------------------------------
// 1. Get All Notes for Current User
// ----------------------------------------------------
notesRouter.get('/', requireAuth, requireVerified, async (req: Request, res: Response) => {
  try {
    const { db } = await getDb();
    const userNotes = await db
      .select()
      .from(notes)
      .where(eq(notes.userId, req.user!.id))
      .orderBy(desc(notes.updatedAt));

    return res.json({ notes: userNotes });
  } catch (err: any) {
    console.error('[GET_NOTES_ERR]', err);
    return res.status(500).json({ error: 'فشل استرجاع المذكرات.' });
  }
});

// ----------------------------------------------------
// 2. Create or Auto-Save Note
// ----------------------------------------------------
notesRouter.post('/', requireAuth, requireVerified, async (req: Request, res: Response) => {
  const parseResult = saveNoteSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.errors[0]?.message || 'بيانات المذكرة غير صالحة' });
  }

  const { id, title, content } = parseResult.data;
  const noteTitle = title.trim() || 'مذكرة جديدة';

  try {
    const { db } = await getDb();

    if (id) {
      // Check if note exists and belongs to user
      const existing = await db
        .select()
        .from(notes)
        .where(and(eq(notes.id, id), eq(notes.userId, req.user!.id)))
        .limit(1);

      if (existing.length > 0) {
        const updated = await db
          .update(notes)
          .set({
            title: noteTitle,
            content: content || '',
            updatedAt: new Date(),
          })
          .where(eq(notes.id, id))
          .returning();

        return res.json({ success: true, note: updated[0] });
      }
    }

    // Insert new note
    const created = await db
      .insert(notes)
      .values({
        userId: req.user!.id,
        title: noteTitle,
        content: content || '',
      })
      .returning();

    return res.status(201).json({ success: true, note: created[0] });
  } catch (err: any) {
    console.error('[SAVE_NOTE_ERR]', err);
    return res.status(500).json({ error: 'فشل حفظ المذكرة.' });
  }
});

// ----------------------------------------------------
// 3. Delete Note
// ----------------------------------------------------
notesRouter.delete('/:id', requireAuth, requireVerified, async (req: Request, res: Response) => {
  try {
    const { db } = await getDb();
    const result = await db
      .delete(notes)
      .where(and(eq(notes.id, req.params.id), eq(notes.userId, req.user!.id)))
      .returning();

    if (result.length === 0) {
      return res.status(404).json({ error: 'المذكرة غير موجودة.' });
    }

    return res.json({ success: true, message: 'تم حذف المذكرة بنجاح.' });
  } catch (err: any) {
    console.error('[DELETE_NOTE_ERR]', err);
    return res.status(500).json({ error: 'فشل حذف المذكرة.' });
  }
});
