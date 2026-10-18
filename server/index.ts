import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

import { getDb } from './db/index.js';
import { verifyCsrf } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { attachmentsRouter } from './routes/attachments.js';
import { chatRouter } from './routes/chat.js';
import { quizzesRouter } from './routes/quizzes.js';
import { startBackgroundWorker, stopBackgroundWorker } from './services/jobs.js';
import { isGeminiConfigured } from './services/gemini.js';

const app = express();
app.set('trust proxy', 1);
const PORT = parseInt(process.env.PORT || '3001', 10);
const isProd = process.env.NODE_ENV === 'production';

// ----------------------------------------------------
// Security & Core Middleware
// ----------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: false, // Allows KaTeX CDN fonts and inline styles safely in SPA
    crossOriginEmbedderPolicy: false,
  })
);

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CSRF & Origin verification
app.use('/api', verifyCsrf);

// ----------------------------------------------------
// API Routes
// ----------------------------------------------------
app.use('/api/auth', authRouter);
app.use('/api/attachments', attachmentsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/quizzes', quizzesRouter);

// Health & Status Check
app.get('/api/health', async (req: Request, res: Response) => {
  let dbStatus = 'ok';
  try {
    const { client } = await getDb();
    if (client.query) {
      await client.query('SELECT 1');
    }
  } catch (err: any) {
    dbStatus = `error: ${err.message}`;
  }

  const geminiReady = isGeminiConfigured();
  const emailReady = Boolean(process.env.RESEND_API_KEY || process.env.SMTP_HOST);

  return res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      database: dbStatus,
      geminiAi: geminiReady ? 'configured' : 'missing_api_key',
      emailService: emailReady ? 'configured' : 'dev_console_mode',
      storageProvider: process.env.STORAGE_PROVIDER || 'local',
    },
    version: '1.0.0',
    name: 'Stu.Ai',
  });
});

// ----------------------------------------------------
// Static Client Serving (Single Page Application)
// ----------------------------------------------------
const clientDist = path.resolve(process.cwd(), 'dist/client');
if (fs.existsSync(clientDist)) {
  app.use(
    express.static(clientDist, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html') || filePath.endsWith('sw.js')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
      },
    })
  );
  app.get('*', (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// ----------------------------------------------------
// Error Handler
// ----------------------------------------------------
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  // Sanitize log to never print sensitive user data or secrets
  console.error('[SERVER_ERROR]', {
    method: req.method,
    url: req.url,
    message: err.message,
  });

  const statusCode = err.status || err.statusCode || 500;
  return res.status(statusCode).json({
    error: isProd ? 'حدث خطأ غير متوقع في الخادم.' : err.message || 'Internal Server Error',
  });
});

// ----------------------------------------------------
// Server Lifecycle
// ----------------------------------------------------
let server: any = null;

async function bootstrap() {
  try {
    // 1. Initialize database & migrations
    await getDb();

    // 2. Start background worker for document processing
    startBackgroundWorker();

    // 3. Start HTTP server
    server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n======================================================`);
      console.log(`[Stu.Ai Server] Listening on http://localhost:${PORT}`);
      console.log(`[Mode] ${process.env.NODE_ENV || 'development'}`);
      console.log(`[Gemini AI] ${isGeminiConfigured() ? 'Active & Configured' : 'Needs GEMINI_API_KEY in .env'}`);
      console.log(`======================================================\n`);
    });

    // 4. Fallback redirect server on port 5173 for local dev only
    if (process.env.NODE_ENV !== 'production') {
      try {
        const redirectApp = express();
        redirectApp.use((req, res) => {
          const host = (req.get('host') || 'localhost').replace(':5173', `:${PORT}`);
          const target = `${req.protocol}://${host}${req.url.replace('/reset-password', '/')}`;
          res.redirect(302, target);
        });
        const redirectServer = redirectApp.listen(5173, '0.0.0.0', () => {
          console.log(`[Redirect] Port 5173 redirecting to port ${PORT}`);
        });
        redirectServer.on('error', () => {
          // Port 5173 in use or unavailable, ignore
        });
      } catch {
        // Ignore
      }
    }
  } catch (err: any) {
    console.error('[BOOTSTRAP_FAIL]', err);
    process.exit(1);
  }
}

// Handle graceful termination
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM received. Gracefully closing...');
  stopBackgroundWorker();
  if (server) server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('[SHUTDOWN] SIGINT received. Gracefully closing...');
  stopBackgroundWorker();
  if (server) server.close(() => process.exit(0));
});

bootstrap();

export default app;
