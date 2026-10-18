import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';

import pg from 'pg';
import path from 'path';
import fs from 'fs';
import * as schema from '../../shared/schema.js';

let dbInstance: any = null;
let rawClient: any = null;

export async function getDb() {
  if (dbInstance) {
    return { db: dbInstance, client: rawClient };
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (databaseUrl && (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://'))) {
    console.log('[DB] Connecting to PostgreSQL database at:', databaseUrl.replace(/:[^:@]+@/, ':***@'));
    const pool = new pg.Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('sslmode=require') || databaseUrl.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
    });
    
    // Verify connection
    await pool.query('SELECT 1');
    dbInstance = drizzlePg(pool, { schema });
    rawClient = pool;
    console.log('[DB] PostgreSQL connected successfully.');
  } else {
    // Embedded PGlite fallback
    const { drizzle: drizzlePglite } = await import('drizzle-orm/pglite');
    const { PGlite } = await import('@electric-sql/pglite');
    const pgliteDir = path.resolve(process.cwd(), 'data/pglite');
    if (!fs.existsSync(pgliteDir)) {
      fs.mkdirSync(pgliteDir, { recursive: true });
    }
    console.log('[DB] No external PostgreSQL URL detected. Using embedded PGlite at:', pgliteDir);
    const pglite = new PGlite(pgliteDir);
    dbInstance = drizzlePglite(pglite, { schema });
    rawClient = pglite;
    console.log('[DB] PGlite embedded database initialized successfully.');
  }

  // Ensure tables exist on boot
  await ensureTablesCreated();

  return { db: dbInstance, client: rawClient };
}

async function ensureTablesCreated() {
  const createTablesSql = `
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      is_verified BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS email_verifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL,
      otp_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      resend_available_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      ui_language TEXT NOT NULL DEFAULT 'ar',
      preferred_explanation_lang TEXT NOT NULL DEFAULT 'auto',
      search_grounding_default BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'محادثة جديدة',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'complete',
      sequence INTEGER NOT NULL,
      idempotency_key TEXT,
      citations JSONB DEFAULT '[]'::jsonb,
      search_grounding JSONB DEFAULT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      storage_key TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'uploaded',
      manifest JSONB DEFAULT '{}'::jsonb,
      provider_ref TEXT,
      provider_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS message_attachments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      attachment_id UUID NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
      sequence_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS source_units (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      attachment_id UUID NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
      unit_index INTEGER NOT NULL,
      unit_type TEXT NOT NULL,
      content_text TEXT NOT NULL DEFAULT '',
      facts JSONB DEFAULT '[]'::jsonb,
      formulas JSONB DEFAULT '[]'::jsonb,
      visual_description TEXT,
      status TEXT NOT NULL DEFAULT 'ready',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS processing_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      attachment_id UUID NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS quizzes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'ar',
      scope_type TEXT NOT NULL DEFAULT 'all',
      scope_details JSONB DEFAULT '{}'::jsonb,
      question_count INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS quiz_questions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
      question_order INTEGER NOT NULL,
      question_type TEXT NOT NULL,
      question_text TEXT NOT NULL,
      options JSONB DEFAULT '[]'::jsonb,
      correct_key TEXT NOT NULL,
      explanation TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 1,
      topic TEXT NOT NULL DEFAULT 'عام',
      source_references JSONB DEFAULT '[]'::jsonb
    );

    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      score INTEGER NOT NULL DEFAULT 0,
      total_points INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_progress',
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS quiz_answers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      attempt_id UUID NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
      question_id UUID NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
      student_answer TEXT NOT NULL DEFAULT '',
      is_correct BOOLEAN NOT NULL DEFAULT false,
      earned_points INTEGER NOT NULL DEFAULT 0,
      ai_feedback TEXT,
      evaluation_status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS usage_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      request_type TEXT NOT NULL,
      model_used TEXT NOT NULL,
      prompt_tokens INTEGER DEFAULT 0,
      candidate_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Performance and Isolation Indexes
    CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, sequence ASC);
    CREATE INDEX IF NOT EXISTS idx_attachments_user ON attachments(user_id);
    CREATE INDEX IF NOT EXISTS idx_source_units_attachment ON source_units(attachment_id, unit_index ASC);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON processing_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_quizzes_user ON quizzes(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_quiz_questions_quiz ON quiz_questions(quiz_id, question_order ASC);
    CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user ON quiz_attempts(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_verifications_email ON email_verifications(email);
  `;

  try {
    if (rawClient && typeof rawClient.exec === 'function') {
      await rawClient.exec(createTablesSql);
      console.log('[DB] Verified all database tables and indexes via exec.');
    } else if (rawClient && typeof rawClient.query === 'function') {
      // Split by semicolon and run individually for standard pools
      const statements = createTablesSql
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const statement of statements) {
        await rawClient.query(statement);
      }
      console.log('[DB] Verified all database tables and indexes via query statements.');
    }
  } catch (err: any) {
    console.warn('[DB] Table creation check warning:', err.message);
  }
}
