import { pgTable, text, timestamp, integer, boolean, jsonb, uuid } from 'drizzle-orm/pg-core';
import { z } from 'zod';

// ==========================================
// 1. Users & Authentication
// ==========================================
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  isVerified: boolean('is_verified').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const emailVerifications = pgTable('email_verifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull(),
  otpHash: text('otp_hash').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  resendAvailableAt: timestamp('resend_available_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const passwordResets = pgTable('password_resets', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // Session token hash
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ==========================================
// 2. User Settings
// ==========================================
export const userSettings = pgTable('user_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull().unique(),
  uiLanguage: text('ui_language').default('ar').notNull(), // 'ar' | 'en'
  preferredExplanationLang: text('preferred_explanation_lang').default('auto').notNull(), // 'auto' | 'ar' | 'en'
  searchGroundingDefault: boolean('search_grounding_default').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ==========================================
// 3. Conversations & Messages
// ==========================================
export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  title: text('title').default('محادثة جديدة').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }).notNull(),
  role: text('role').notNull(), // 'user' | 'assistant' | 'system'
  content: text('content').notNull(),
  status: text('status').default('complete').notNull(), // 'streaming' | 'complete' | 'failed' | 'aborted'
  sequence: integer('sequence').notNull(),
  idempotencyKey: text('idempotency_key'),
  citations: jsonb('citations').default([]), // Verified citations: [{ sourceName, pageOrUnit, quote, verified }]
  searchGrounding: jsonb('search_grounding').default(null), // Google Search sources & queries if used
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ==========================================
// 4. Attachments & Processing Pipeline
// ==========================================
export const attachments = pgTable('attachments', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  storageKey: text('storage_key').notNull(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256').notNull(),
  status: text('status').default('uploaded').notNull(), // 'uploaded' | 'inspecting' | 'processing' | 'ready' | 'partial' | 'failed'
  manifest: jsonb('manifest').default({}), // Total units, processed units, failed units, warnings
  providerRef: text('provider_ref'), // Gemini file uri if uploaded
  providerExpiresAt: timestamp('provider_expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const messageAttachments = pgTable('message_attachments', {
  id: uuid('id').defaultRandom().primaryKey(),
  messageId: uuid('message_id').references(() => messages.id, { onDelete: 'cascade' }).notNull(),
  attachmentId: uuid('attachment_id').references(() => attachments.id, { onDelete: 'cascade' }).notNull(),
  sequenceOrder: integer('sequence_order').default(0).notNull(),
});

export const sourceUnits = pgTable('source_units', {
  id: uuid('id').defaultRandom().primaryKey(),
  attachmentId: uuid('attachment_id').references(() => attachments.id, { onDelete: 'cascade' }).notNull(),
  unitIndex: integer('unit_index').notNull(), // Page 1, Slide 3, Sheet "Sales", etc.
  unitType: text('unit_type').notNull(), // 'page' | 'slide' | 'sheet' | 'chunk' | 'image'
  contentText: text('content_text').default('').notNull(),
  facts: jsonb('facts').default([]),
  formulas: jsonb('formulas').default([]),
  visualDescription: text('visual_description'),
  status: text('status').default('ready').notNull(), // 'ready' | 'unclear' | 'failed'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const processingJobs = pgTable('processing_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  attachmentId: uuid('attachment_id').references(() => attachments.id, { onDelete: 'cascade' }).notNull(),
  jobType: text('job_type').notNull(), // 'extract_and_index'
  status: text('status').default('pending').notNull(), // 'pending' | 'processing' | 'completed' | 'failed'
  retryCount: integer('retry_count').default(0).notNull(),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ==========================================
// 5. Quizzes & Interactive Assessment
// ==========================================
export const quizzes = pgTable('quizzes', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  type: text('type').notNull(), // 'mcq' | 'essay' | 'mixed'
  difficulty: text('difficulty').notNull(), // 'easy' | 'medium' | 'hard'
  language: text('language').default('ar').notNull(), // 'ar' | 'en'
  scopeType: text('scope_type').default('all').notNull(), // 'all' | 'specific'
  scopeDetails: jsonb('scope_details').default({}),
  questionCount: integer('question_count').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const quizQuestions = pgTable('quiz_questions', {
  id: uuid('id').defaultRandom().primaryKey(),
  quizId: uuid('quiz_id').references(() => quizzes.id, { onDelete: 'cascade' }).notNull(),
  questionOrder: integer('question_order').notNull(),
  questionType: text('question_type').notNull(), // 'mcq' | 'essay'
  questionText: text('question_text').notNull(),
  options: jsonb('options').default([]), // For MCQ: string[] (length 4)
  correctKey: text('correct_key').notNull(), // Server-side secret key / answer model
  explanation: text('explanation').notNull(), // Explanation shown after submit
  points: integer('points').default(1).notNull(),
  topic: text('topic').default('عام').notNull(),
  sourceReferences: jsonb('source_references').default([]), // Verified citations
});

export const quizAttempts = pgTable('quiz_attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  quizId: uuid('quiz_id').references(() => quizzes.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  score: integer('score').default(0).notNull(),
  totalPoints: integer('total_points').notNull(),
  status: text('status').default('in_progress').notNull(), // 'in_progress' | 'completed'
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const quizAnswers = pgTable('quiz_answers', {
  id: uuid('id').defaultRandom().primaryKey(),
  attemptId: uuid('attempt_id').references(() => quizAttempts.id, { onDelete: 'cascade' }).notNull(),
  questionId: uuid('question_id').references(() => quizQuestions.id, { onDelete: 'cascade' }).notNull(),
  studentAnswer: text('student_answer').default('').notNull(),
  isCorrect: boolean('is_correct').default(false).notNull(),
  earnedPoints: integer('earned_points').default(0).notNull(),
  aiFeedback: text('ai_feedback'),
  evaluationStatus: text('evaluation_status').default('pending').notNull(), // 'graded' | 'estimated' | 'pending'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ==========================================
// 6. Usage & Audit Logs
// ==========================================
export const usageRecords = pgTable('usage_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  requestType: text('request_type').notNull(), // 'chat' | 'quiz_generate' | 'essay_grade' | 'transcribe'
  modelUsed: text('model_used').notNull(),
  promptTokens: integer('prompt_tokens').default(0),
  candidateTokens: integer('candidate_tokens').default(0),
  totalTokens: integer('total_tokens').default(0),
  durationMs: integer('duration_ms').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ==========================================
// 7. Zod Validation Schemas
// ==========================================

export const registerSchema = z.object({
  displayName: z.string().trim().min(2, 'يجب أن يكون اسم العرض حرفين على الأقل').max(50, 'اسم العرض طويل جداً'),
  email: z.string().trim().email('صيغة البريد الإلكتروني غير صحيحة').toLowerCase(),
  password: z.string().min(12, 'يجب أن لا تقل كلمة المرور عن 12 حرفاً').max(128, 'كلمة المرور طويلة جداً'),
  confirmPassword: z.string(),
}).refine(data => data.password === data.confirmPassword, {
  message: 'كلمات المرور غير متطابقة',
  path: ['confirmPassword'],
});

export const loginSchema = z.object({
  email: z.string().trim().email('صيغة البريد الإلكتروني غير صحيحة').toLowerCase(),
  password: z.string().min(1, 'يرجى إدخال كلمة المرور'),
});

export const verifyOtpSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  code: z.string().trim().regex(/^\d{6}$/, 'رمز التحقق يتكون من 6 أرقام'),
});

export const resendOtpSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(6, 'رمز الاستعادة غير صالح').max(128),
  newPassword: z.string().min(12, 'يجب أن لا تقل كلمة المرور عن 12 حرفاً').max(128),
  confirmPassword: z.string(),
}).refine(data => data.newPassword === data.confirmPassword, {
  message: 'كلمات المرور غير متطابقة',
  path: ['confirmPassword'],
});

export const updateSettingsSchema = z.object({
  displayName: z.string().trim().min(2).max(50).optional(),
  uiLanguage: z.enum(['ar', 'en']).optional(),
  preferredExplanationLang: z.enum(['auto', 'ar', 'en']).optional(),
  searchGroundingDefault: z.boolean().optional(),
});

export const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
});

export const renameConversationSchema = z.object({
  title: z.string().trim().min(1, 'العنوان لا يمكن أن يكون فارغاً').max(100),
});

export const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().max(20000, 'الرسالة طويلة جداً'),
  attachmentIds: z.array(z.string().uuid()).max(20).default([]),
  actionType: z.enum(['normal', 'reexplain', 'simplify', 'example', 'summarize', 'create_quiz']).default('normal'),
  useSearchGrounding: z.boolean().default(false),
  idempotencyKey: z.string().max(128).optional(),
});

export const createQuizSchema = z.object({
  conversationId: z.string().uuid().optional(),
  topic: z.string().trim().max(200).optional(),
  type: z.enum(['mcq', 'essay', 'mixed']).default('mcq'),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  language: z.enum(['ar', 'en']).default('ar'),
  questionCount: z.number().int().min(1).max(50).default(5),
  scopeType: z.enum(['all', 'specific']).default('all'),
  selectedAttachmentIds: z.array(z.string().uuid()).optional(),
});

export const submitQuizSchema = z.object({
  answers: z.array(z.object({
    questionId: z.string().uuid(),
    studentAnswer: z.string(),
  })),
  idempotencyKey: z.string().max(128).optional(),
});

// ==========================================
// 6. Study Notes (المذكرات)
// ==========================================
export const notes = pgTable('notes', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  title: text('title').default('مذكرة جديدة').notNull(),
  content: text('content').default('').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const saveNoteSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().max(200).default('مذكرة جديدة'),
  content: z.string().max(50000).default(''),
});

// Types
export type User = typeof users.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type SourceUnit = typeof sourceUnits.$inferSelect;
export type Quiz = typeof quizzes.$inferSelect;
export type QuizQuestion = typeof quizQuestions.$inferSelect;
export type QuizAttempt = typeof quizAttempts.$inferSelect;
export type QuizAnswer = typeof quizAnswers.$inferSelect;
export type Note = typeof notes.$inferSelect;
