import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import {
  type AuthRequest,
  requireAdmin,
  requireAuth,
  requireSuper,
  signLocalSessionToken,
} from './src/middleware/auth.ts';
import { ensureDatabaseSchema, getDatabaseStatus } from './src/db/index.ts';
import { CONSTANT_ADMIN_LICENSE_KEY, UPLOADS_DIR } from './src/db/localStore.ts';
import { fetchGa4Report, getPublicMeasurementId } from './src/lib/ga4.ts';
import {
  authorizeAdminEmail,
  generateProLicenseKey,
  getPointTransactions,
  getUserLicenseKeys,
  listPublicCreditsContributors,
  listToolUsers,
  loginPasswordUser,
  purchaseProWithPoints,
  redeemLicenseKey,
  registerPasswordUser,
  requestContributorRole,
  sanitizeUserForClient,
  setContributorStatus,
  setContributorWeeklyPoints,
  setPasswordForUser,
  superAdjustUserPoints,
  superTerminateOrCancel,
  updateUserPlan,
  updateUserProfile,
} from './src/db/users.ts';
import {
  acquireStudyMaterial,
  createCalendarEvent,
  createContactMessage,
  createContributorFile,
  createContributorFolder,
  createExamBlueprint,
  createExamSchedule,
  createNotebook,
  createNotePage,
  createStudyLog,
  createStudyMaterial,
  createTask,
  deleteCalendarEvent,
  deleteContributorFile,
  deleteContributorFolder,
  deleteExamBlueprint,
  deleteExamSchedule,
  deleteNotebook,
  deleteNotePage,
  deleteStudyMaterial,
  deleteTask,
  deleteToolMessage,
  detectPdfPageCountFromBuffer,
  getAdminAnalytics,
  getContactMessages,
  getContributorFileById,
  getNotificationsForUser,
  getStudyMaterialById,
  getSuperUsersAndPointsLedger,
  getUserCalendarEvents,
  getUserExamBlueprints,
  getUserExams,
  getUserMaterialPurchases,
  getUserMessages,
  getUserNotebooks,
  getUserNotePages,
  getUserStudyLogs,
  getUserTasks,
  hasActiveMaterialAccess,
  listAllContributorAssetsForMasterSync,
  listContributorWorkspace,
  listPointTransactionsForAdmin,
  listStudyMaterials,
  markNotificationRead,
  markToolMessageRead,
  reviewPointTransaction,
  sendNotification,
  sendToolUserMessage,
  updateContributorFileDrive,
  updateContributorFolderDrive,
  updateExamBlueprint,
  updateExamStatus,
  updateNotePage,
  updateStudyMaterialDriveInfo,
  updateTask,
} from './src/db/study.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function safeHeaderDecode(val: string | string[] | undefined, fallback = ''): string {
  const raw = Array.isArray(val) ? val[0] : val;
  if (!raw) return fallback;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

async function startServer() {
  await ensureDatabaseSchema();
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Enable CORS so split-origin Netlify / PWA Builder frontends can access /api/* routes
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, PATCH, DELETE, OPTIONS'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-material-title, x-material-subject, x-material-category, x-file-name, x-mime-type, x-page-count, x-hourly-rent-cost, x-buy-cost, x-folder-id, x-folder-path'
    );
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    // Required for Firebase Google OAuth popup postMessage & Render PWA compatibility
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    next();
  });

  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  app.get('/api/health', (_req, res) => {
    const database = getDatabaseStatus();
    res.json({
      status: 'ok',
      app: 'ASAN-Study_tool',
      database,
      auth: {
        sessionSecretConfigured: Boolean(process.env.SESSION_SECRET?.trim()),
      },
      analytics: {
        ga4MeasurementConfigured: Boolean(getPublicMeasurementId()),
        ga4ReportingConfigured: Boolean(
          process.env.GA4_PROPERTY_ID?.trim() && process.env.GA4_SERVICE_ACCOUNT_JSON?.trim()
        ),
      },
    });
  });

  app.get('/api/analytics/config', (_req, res) => {
    res.json({
      measurementId: getPublicMeasurementId(),
    });
  });

  // Streaming binary upload route for large Study Material Notes & Question Papers (before express.json)
  app.post('/api/study-materials/upload', requireAuth, async (req: AuthRequest, res) => {
    const title = safeHeaderDecode(req.headers['x-material-title'], 'Untitled Material').slice(0, 180);
    const subject = safeHeaderDecode(req.headers['x-material-subject'], 'General').slice(0, 80);
    const category = safeHeaderDecode(req.headers['x-material-category'], 'study_notes').slice(0, 40);
    const originalFileName = path
      .basename(safeHeaderDecode(req.headers['x-file-name'], 'study-material.pdf'))
      .replace(/[^a-zA-Z0-9._-]/g, '_');
    const mimeType = safeHeaderDecode(
      req.headers['x-mime-type'],
      'application/octet-stream'
    ).slice(0, 120);
    const rawHourlyRent = Number(safeHeaderDecode(req.headers['x-hourly-rent-cost'], '10'));
    const rawPageCount = Number(safeHeaderDecode(req.headers['x-page-count'], '0'));
    const rawBuyCost = Number(safeHeaderDecode(req.headers['x-buy-cost'], '0'));

    if (!Number.isFinite(rawHourlyRent) || rawHourlyRent < 5 || rawHourlyRent > 100) {
      return res.status(400).json({
        error: 'Hourly rent cost must be between 5 and 100 points per hour.',
      });
    }

    // Non-contributor users may upload question papers (+75 pts); big study notes require Contributor, Admin, or Super
    const isPrivileged =
      req.dbUser?.role === 'admin' ||
      req.dbUser?.role === 'super' ||
      (req.dbUser?.role === 'contributor' && req.dbUser?.contributorApproved);

    if (category !== 'question_paper' && !isPrivileged) {
      return res.status(403).json({
        error:
          'Study Material Notes uploads are restricted to approved Contributors & Admins. Apply in Study Material Notes or upload a Question Paper (+75 pts).',
      });
    }

    const MAX_BYTES = 500 * 1024 * 1024; // 500 MB per upload
    const storedFileName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${originalFileName}`;
    const fullPath = path.join(UPLOADS_DIR, storedFileName);
    const writeStream = fs.createWriteStream(fullPath);

    let totalBytes = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      totalBytes += chunk.length;
      if (totalBytes > MAX_BYTES) {
        aborted = true;
        writeStream.destroy();
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        res.status(413).json({ error: 'File exceeds 500 MB per-file upload limit.' });
        return;
      }
      writeStream.write(chunk);
    });

    req.on('end', async () => {
      if (aborted) return;
      writeStream.end(async () => {
        if (totalBytes === 0) {
          if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
          return res.status(400).json({ error: 'Uploaded file is empty.' });
        }
        try {
          let detectedPages = Number.isFinite(rawPageCount) && rawPageCount >= 1
            ? Math.round(rawPageCount)
            : 1;
          if (
            (!Number.isFinite(rawPageCount) || rawPageCount < 1) &&
            (mimeType.includes('pdf') || originalFileName.toLowerCase().endsWith('.pdf'))
          ) {
            const fd = fs.openSync(fullPath, 'r');
            try {
              const readLen = Math.min(totalBytes, 6 * 1024 * 1024);
              const sample = Buffer.alloc(readLen);
              fs.readSync(fd, sample, 0, readLen, 0);
              detectedPages = detectPdfPageCountFromBuffer(sample);
            } finally {
              fs.closeSync(fd);
            }
          }

          const result = await createStudyMaterial({
            uploaderId: req.dbUser!.id,
            uploaderEmail: req.dbUser!.email,
            uploaderName: req.dbUser!.displayName,
            title,
            subject,
            category,
            fileName: originalFileName,
            storedFileName,
            mimeType,
            fileSizeBytes: totalBytes,
            pageCount: detectedPages,
            hourlyRentCost: Math.round(rawHourlyRent),
            buyCost: Number.isFinite(rawBuyCost) && rawBuyCost >= 5 ? Math.round(rawBuyCost) : undefined,
          });
          res.status(201).json(result);
        } catch (err) {
          if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
          const msg = err instanceof Error ? err.message : 'Failed to save study material';
          res.status(msg.includes('between 5 and 100') ? 400 : 500).json({ error: msg });
        }
      });
    });

    req.on('error', () => {
      aborted = true;
      writeStream.destroy();
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    });
  });

  // Streaming binary upload route for Contributors' Console (supports individual files & full folders)
  app.post('/api/contributor-console/files/upload', requireAuth, async (req: AuthRequest, res) => {
    const isElevated =
      req.dbUser?.role === 'super' ||
      req.dbUser?.role === 'admin' ||
      (req.dbUser?.role === 'contributor' && req.dbUser?.contributorApproved);
    if (!isElevated) {
      return res.status(403).json({
        error: 'Contributors Console uploads require approved Contributor, Admin, or Super role.',
      });
    }

    const originalFileName = path
      .basename(safeHeaderDecode(req.headers['x-file-name'], 'document.pdf'))
      .replace(/[^a-zA-Z0-9._-]/g, '_');
    const mimeType = safeHeaderDecode(
      req.headers['x-mime-type'],
      'application/octet-stream'
    ).slice(0, 120);
    const rawFolderId = Number(safeHeaderDecode(req.headers['x-folder-id'], '0'));
    const folderId = Number.isFinite(rawFolderId) && rawFolderId > 0 ? rawFolderId : null;
    const folderPath = safeHeaderDecode(req.headers['x-folder-path'], '').slice(0, 260);

    const MAX_BYTES = 500 * 1024 * 1024;
    const storedFileName = `contrib-${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${originalFileName}`;
    const fullPath = path.join(UPLOADS_DIR, storedFileName);
    const writeStream = fs.createWriteStream(fullPath);

    let totalBytes = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      totalBytes += chunk.length;
      if (totalBytes > MAX_BYTES) {
        aborted = true;
        writeStream.destroy();
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        res.status(413).json({ error: 'File exceeds 500 MB upload limit.' });
        return;
      }
      writeStream.write(chunk);
    });

    req.on('end', async () => {
      if (aborted) return;
      writeStream.end(async () => {
        if (totalBytes === 0) {
          if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
          return res.status(400).json({ error: 'Uploaded file is empty.' });
        }
        try {
          const created = await createContributorFile({
            userId: req.dbUser!.id,
            username: req.dbUser!.username || 'contributor',
            folderId,
            folderPath,
            fileName: originalFileName,
            storedFileName,
            mimeType,
            fileSizeBytes: totalBytes,
          });
          res.status(201).json(created);
        } catch (err) {
          if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
          res.status(500).json({
            error: err instanceof Error ? err.message : 'Failed to save contributor file',
          });
        }
      });
    });

    req.on('error', () => {
      aborted = true;
      writeStream.destroy();
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    });
  });

  app.use(express.json({ limit: '15mb' }));

  // Non-Google Email + Password Authentication (No Google Workspace access)
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { email, password, displayName } = req.body || {};
      const user = await registerPasswordUser({
        email: String(email || ''),
        password: String(password || ''),
        displayName: typeof displayName === 'string' ? displayName : undefined,
      });
      const token = signLocalSessionToken({
        userId: user.id,
        uid: user.uid,
        email: user.email,
      });
      res.status(201).json({
        token,
        user: { ...sanitizeUserForClient(user), authMode: 'password' },
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Registration failed';
      res.status(400).json({ error: msg });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, identifier, password } = req.body || {};
      const user = await loginPasswordUser(
        String(identifier || email || ''),
        String(password || '')
      );
      const token = signLocalSessionToken({
        userId: user.id,
        uid: user.uid,
        email: user.email,
      });
      res.json({
        token,
        user: { ...sanitizeUserForClient(user), authMode: 'password' },
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Login failed';
      res.status(401).json({ error: msg });
    }
  });

  app.post('/api/auth/set-password', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { password } = req.body || {};
      const updated = await setPasswordForUser(req.dbUser!.id, String(password || ''));
      res.json({
        ok: true,
        user: {
          ...sanitizeUserForClient(updated),
          authMode: req.authMode || req.dbUser?.authMode || 'google',
        },
        message: 'Password saved! You can now sign in with Email & Password without Google OAuth.',
      });
    } catch (error: unknown) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to set password',
      });
    }
  });

  // Current user profile
  app.get('/api/me', requireAuth, async (req: AuthRequest, res) => {
    res.json({
      ...sanitizeUserForClient(req.dbUser!),
      authMode: req.authMode || req.dbUser?.authMode || 'google',
    });
  });

  app.patch('/api/me', requireAuth, async (req: AuthRequest, res) => {
    try {
      const {
        displayName,
        username,
        spectraUrl,
        driveFolderId,
        scheduleSheetId,
        viewPlanMode,
      } = req.body || {};
      const updated = await updateUserProfile(req.dbUser!.id, {
        displayName:
          typeof displayName === 'string' ? displayName.slice(0, 120) : undefined,
        username: typeof username === 'string' ? username.slice(0, 60) : undefined,
        spectraUrl:
          typeof spectraUrl === 'string' ? spectraUrl.slice(0, 300) : undefined,
        driveFolderId:
          typeof driveFolderId === 'string' ? driveFolderId.slice(0, 160) : undefined,
        scheduleSheetId:
          typeof scheduleSheetId === 'string'
            ? scheduleSheetId.slice(0, 160)
            : undefined,
        viewPlanMode:
          viewPlanMode === 'basic' || viewPlanMode === 'auto' ? viewPlanMode : undefined,
      });
      res.json({
        ...sanitizeUserForClient(updated),
        authMode: req.authMode || req.dbUser?.authMode || 'google',
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to update profile';
      const status = msg.includes('already taken') || msg.includes('at least 3') ? 400 : 500;
      res.status(status).json({ error: msg });
    }
  });

  // Admin / Super plan preview switch (Admin/Super can hold Basic or Pro plan themselves)
  app.post('/api/me/plan', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { plan } = req.body || {};
      if (!['basic', 'pro'].includes(plan)) {
        return res
          .status(400)
          .json({ error: 'Invalid plan tier. Admin is a role; plans are basic or pro.' });
      }
      const updated = await updateUserPlan(req.dbUser!.id, plan);
      res.json({
        ...sanitizeUserForClient(updated),
        authMode: req.authMode || req.dbUser?.authMode || 'google',
      });
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to update plan',
      });
    }
  });

  // Points & Subscriptions & 8-Char License Keys
  app.get('/api/points', requireAuth, async (req: AuthRequest, res) => {
    try {
      const transactions = await getPointTransactions(req.dbUser!.id);
      res.json({ points: req.dbUser!.points, transactions });
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load points ledger',
      });
    }
  });

  app.get('/api/subscriptions', requireAuth, async (req: AuthRequest, res) => {
    try {
      const [keys, transactions] = await Promise.all([
        getUserLicenseKeys(req.dbUser!.id, req.dbUser!.email),
        getPointTransactions(req.dbUser!.id),
      ]);
      res.json({
        plan: req.dbUser!.plan,
        role: req.dbUser!.role,
        points: req.dbUser!.points,
        proStartedAt: req.dbUser!.proStartedAt,
        proExpiresAt: req.dbUser!.proExpiresAt,
        keys,
        transactions,
      });
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load subscriptions',
      });
    }
  });

  app.post('/api/subscriptions/redeem-points', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { term } = req.body || {};
      const planTerm = term === 'annual' ? 'annual' : 'monthly';
      const updatedUser = await purchaseProWithPoints(req.dbUser!.id, planTerm);
      res.json({
        user: sanitizeUserForClient(updatedUser),
        message:
          planTerm === 'annual'
            ? 'Annual Pro plan activated for 12 months (5,100 points — 15% discount).'
            : 'Monthly Pro plan activated for 1 month (500 points).',
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to redeem points';
      res.status(msg.includes('Insufficient') ? 400 : 500).json({ error: msg });
    }
  });

  app.post('/api/subscriptions/purchase-key', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { recipientEmail, term } = req.body || {};
      const planTerm = term === 'annual' ? 'annual' : 'monthly';
      const result = await generateProLicenseKey({
        issuedByUserId: req.dbUser!.id,
        targetEmailOrUsername:
          typeof recipientEmail === 'string' ? recipientEmail : undefined,
        chargePoints: true,
        term: planTerm,
      });
      res.status(201).json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to purchase license key';
      const status =
        msg.includes('Insufficient') || msg.includes('not found') ? 400 : 500;
      res.status(status).json({ error: msg });
    }
  });

  app.post('/api/subscriptions/redeem-key', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { keyCode } = req.body || {};
      if (!keyCode || typeof keyCode !== 'string') {
        return res.status(400).json({ error: '8-character license key is required.' });
      }
      const result = await redeemLicenseKey(req.dbUser!.id, keyCode);
      res.json({
        ...result,
        user: result.user ? sanitizeUserForClient(result.user) : undefined,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to activate license key';
      const status = msg.includes('hand-selected')
        ? 403
        : msg.includes('Invalid') ||
            msg.includes('expired') ||
            msg.includes('already') ||
            msg.includes('must be')
          ? 400
          : 500;
      res.status(status).json({ error: msg });
    }
  });

  // Tasks
  app.get('/api/tasks', requireAuth, async (req: AuthRequest, res) => {
    try {
      const rows = await getUserTasks(req.dbUser!.id);
      res.json(rows);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch tasks',
      });
    }
  });

  app.post('/api/tasks', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { title, description, subject, priority, dueDate, dueTime } = req.body || {};
      if (!title || typeof title !== 'string') {
        return res.status(400).json({ error: 'Task title is required.' });
      }
      const created = await createTask(req.dbUser!.id, {
        title: title.slice(0, 200),
        description: typeof description === 'string' ? description.slice(0, 2000) : '',
        subject: typeof subject === 'string' ? subject.slice(0, 80) : 'General',
        priority: ['low', 'medium', 'high'].includes(priority) ? priority : 'medium',
        dueDate: typeof dueDate === 'string' ? dueDate.slice(0, 20) : '',
        dueTime: typeof dueTime === 'string' ? dueTime.slice(0, 20) : '',
      });
      res.status(201).json(created);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to create task',
      });
    }
  });

  app.patch('/api/tasks/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const taskId = Number(req.params.id);
      if (!Number.isFinite(taskId)) return res.status(400).json({ error: 'Invalid task ID' });
      const { title, description, subject, priority, status, dueDate, dueTime } =
        req.body || {};
      const updated = await updateTask(req.dbUser!.id, taskId, {
        ...(typeof title === 'string' ? { title: title.slice(0, 200) } : {}),
        ...(typeof description === 'string'
          ? { description: description.slice(0, 2000) }
          : {}),
        ...(typeof subject === 'string' ? { subject: subject.slice(0, 80) } : {}),
        ...(['low', 'medium', 'high'].includes(priority) ? { priority } : {}),
        ...(['todo', 'in_progress', 'done'].includes(status) ? { status } : {}),
        ...(typeof dueDate === 'string' ? { dueDate: dueDate.slice(0, 20) } : {}),
        ...(typeof dueTime === 'string' ? { dueTime: dueTime.slice(0, 20) } : {}),
      });
      res.json(updated);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to update task',
      });
    }
  });

  app.delete('/api/tasks/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const taskId = Number(req.params.id);
      if (!Number.isFinite(taskId)) return res.status(400).json({ error: 'Invalid task ID' });
      await deleteTask(req.dbUser!.id, taskId);
      res.json({ ok: true });
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to delete task',
      });
    }
  });

  // Calendar Events (+5 points if study-related)
  app.get('/api/events', requireAuth, async (req: AuthRequest, res) => {
    try {
      const rows = await getUserCalendarEvents(req.dbUser!.id);
      res.json(rows);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch events',
      });
    }
  });

  app.post('/api/events', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { title, eventDate, eventTime, category, notes, meetLink } = req.body || {};
      if (!title || !eventDate) {
        return res.status(400).json({ error: 'Event title and date are required.' });
      }
      const result = await createCalendarEvent(req.dbUser!.id, {
        title: String(title).slice(0, 200),
        eventDate: String(eventDate).slice(0, 20),
        eventTime: typeof eventTime === 'string' ? eventTime.slice(0, 20) : '09:00',
        category: typeof category === 'string' ? category.slice(0, 40) : 'study',
        notes: typeof notes === 'string' ? notes.slice(0, 2000) : '',
        meetLink: typeof meetLink === 'string' ? meetLink.slice(0, 300) : '',
      });
      res.status(201).json(result);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to create event',
      });
    }
  });

  app.delete('/api/events/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const eventId = Number(req.params.id);
      if (!Number.isFinite(eventId)) return res.status(400).json({ error: 'Invalid event ID' });
      await deleteCalendarEvent(req.dbUser!.id, eventId);
      res.json({ ok: true });
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to delete event',
      });
    }
  });

  // Notebooks & OneNote A4 Pages
  app.get('/api/notebooks', requireAuth, async (req: AuthRequest, res) => {
    try {
      const [books, pages] = await Promise.all([
        getUserNotebooks(req.dbUser!.id),
        getUserNotePages(req.dbUser!.id),
      ]);
      res.json({ notebooks: books, pages });
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load notebooks',
      });
    }
  });

  app.post('/api/notebooks', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { title, subject, color } = req.body || {};
      if (!title) return res.status(400).json({ error: 'Notebook title is required.' });
      const created = await createNotebook(req.dbUser!.id, {
        title: String(title).slice(0, 120),
        subject: typeof subject === 'string' ? subject.slice(0, 80) : 'General',
        color: typeof color === 'string' ? color.slice(0, 20) : '#2563EB',
      });
      res.status(201).json(created);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to create notebook',
      });
    }
  });

  app.delete('/api/notebooks/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid notebook ID' });
      await deleteNotebook(req.dbUser!.id, id);
      res.json({ ok: true });
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to delete notebook',
      });
    }
  });

  app.post('/api/note-pages', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { notebookId, sectionName, title, pagesData } = req.body || {};
      if (!notebookId || !title || !Array.isArray(pagesData)) {
        return res
          .status(400)
          .json({ error: 'notebookId, title, and pagesData are required.' });
      }
      const created = await createNotePage(req.dbUser!.id, {
        notebookId: Number(notebookId),
        sectionName: typeof sectionName === 'string' ? sectionName.slice(0, 80) : 'General',
        title: String(title).slice(0, 180),
        pagesData,
      });
      res.status(201).json(created);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to create note document',
      });
    }
  });

  app.patch('/api/note-pages/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid note page ID' });
      const { sectionName, title, pagesData } = req.body || {};
      const updated = await updateNotePage(req.dbUser!.id, id, {
        ...(typeof sectionName === 'string' ? { sectionName: sectionName.slice(0, 80) } : {}),
        ...(typeof title === 'string' ? { title: title.slice(0, 180) } : {}),
        ...(Array.isArray(pagesData) ? { pagesData } : {}),
      });
      res.json(updated);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to update note document',
      });
    }
  });

  app.delete('/api/note-pages/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid note page ID' });
      await deleteNotePage(req.dbUser!.id, id);
      res.json({ ok: true });
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to delete note document',
      });
    }
  });

  // Exams & Timers
  app.get('/api/exams', requireAuth, async (req: AuthRequest, res) => {
    try {
      const rows = await getUserExams(req.dbUser!.id);
      res.json(rows);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch exams',
      });
    }
  });

  app.post('/api/exams', requireAuth, async (req: AuthRequest, res) => {
    try {
      const {
        subject,
        paperName,
        examType,
        customExamType,
        readingMinutes,
        writingMinutes,
        seatingTime,
        alarmEnabled,
        hourlyAlarm,
        status,
      } = req.body || {};
      if (!subject || !examType) {
        return res.status(400).json({ error: 'Subject and exam type are required.' });
      }
      const created = await createExamSchedule(req.dbUser!.id, {
        subject: String(subject).slice(0, 120),
        paperName: typeof paperName === 'string' ? paperName.slice(0, 120) : '',
        examType: String(examType).slice(0, 60),
        customExamType: typeof customExamType === 'string' ? customExamType.slice(0, 80) : '',
        readingMinutes: Math.max(0, Number(readingMinutes) || 0),
        writingMinutes: Math.max(1, Number(writingMinutes) || 60),
        seatingTime: typeof seatingTime === 'string' ? seatingTime.slice(0, 40) : '',
        alarmEnabled: Boolean(alarmEnabled ?? true),
        hourlyAlarm: Boolean(hourlyAlarm ?? true),
        status: typeof status === 'string' ? status.slice(0, 30) : 'scheduled',
      });
      res.status(201).json(created);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to schedule exam',
      });
    }
  });

  app.patch('/api/exams/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid exam ID' });
      const { status } = req.body || {};
      const updated = await updateExamStatus(req.dbUser!.id, id, String(status || 'completed'));
      res.json(updated);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to update exam',
      });
    }
  });

  app.delete('/api/exams/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid exam ID' });
      await deleteExamSchedule(req.dbUser!.id, id);
      res.json({ ok: true });
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to delete exam',
      });
    }
  });

  // Study Logs (+10 points per 30 minutes for exam/test timer)
  app.get('/api/study-logs', requireAuth, async (req: AuthRequest, res) => {
    try {
      const rows = await getUserStudyLogs(req.dbUser!.id);
      res.json(rows);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load study logs',
      });
    }
  });

  app.post('/api/study-logs', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { mode, label, durationSeconds } = req.body || {};
      const result = await createStudyLog(req.dbUser!.id, {
        mode: String(mode || 'basic_timer').slice(0, 40),
        label: String(label || 'Study Session').slice(0, 140),
        durationSeconds: Math.max(0, Math.round(Number(durationSeconds) || 0)),
      });
      res.status(201).json(result);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to save study log',
      });
    }
  });

  // Registered tool users directory (username, userId, email suggestions)
  app.get('/api/tool-users', requireAuth, async (_req: AuthRequest, res) => {
    try {
      const list = await listToolUsers();
      res.json(list);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load tool users',
      });
    }
  });

  // Upgraded In-app Tool Mail (Username / User ID / Email, multiple recipients, Direct / Self / Public, Admin Mail)
  app.get('/api/messages', requireAuth, async (req: AuthRequest, res) => {
    try {
      const rows = await getUserMessages(req.dbUser!.id);
      res.json(rows);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load messages',
      });
    }
  });

  app.post('/api/messages', requireAuth, async (req: AuthRequest, res) => {
    try {
      const {
        recipients,
        recipientEmail,
        visibility = 'direct',
        isAdminMail = false,
        subject,
        body,
        attachmentTitle,
        attachmentNoteId,
      } = req.body || {};

      if (!subject || !body) {
        return res.status(400).json({ error: 'Subject and message body are required.' });
      }

      const vis = ['direct', 'self', 'public'].includes(visibility) ? visibility : 'direct';
      if (isAdminMail && req.dbUser?.role !== 'admin' && req.dbUser?.role !== 'super') {
        return res.status(403).json({ error: 'Only Admins can send Admin Mail.' });
      }

      const recipientList: string[] = Array.isArray(recipients)
        ? recipients.map((x) => String(x))
        : typeof recipientEmail === 'string'
          ? recipientEmail.split(',')
          : [];

      const created = await sendToolUserMessage({
        senderId: req.dbUser!.id,
        senderEmail: req.dbUser!.email,
        senderUsername: req.dbUser!.username,
        recipients: recipientList,
        visibility: vis,
        isAdminMail: Boolean(isAdminMail),
        subject: String(subject).slice(0, 200),
        body: String(body).slice(0, 5000),
        attachmentTitle:
          typeof attachmentTitle === 'string' ? attachmentTitle.slice(0, 180) : '',
        attachmentNoteId: attachmentNoteId ? Number(attachmentNoteId) : null,
      });
      res.status(201).json(created);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to send message';
      const status =
        msg.includes('not found') || msg.includes('Enter at least one') ? 404 : 500;
      res.status(status).json({ error: msg });
    }
  });

  app.patch('/api/messages/:id/read', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid ID' });
      const updated = await markToolMessageRead(req.dbUser!.id, id);
      res.json(updated || { ok: true });
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to update message',
      });
    }
  });

  app.delete('/api/messages/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid ID' });
      await deleteToolMessage(req.dbUser!.id, id);
      res.json({ ok: true });
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to delete message',
      });
    }
  });

  // Notifications
  app.get('/api/notifications', requireAuth, async (req: AuthRequest, res) => {
    try {
      const rows = await getNotificationsForUser(req.dbUser!.id);
      res.json(rows);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load notifications',
      });
    }
  });

  app.post('/api/notifications', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { targetRecipient, title, message, type } = req.body || {};
      if (!title || !message) {
        return res.status(400).json({ error: 'Notification title and message are required.' });
      }
      const created = await sendNotification({
        senderId: req.dbUser!.id,
        senderLabel:
          req.dbUser!.role === 'super'
            ? `Super (@${req.dbUser!.username})`
            : req.dbUser!.role === 'admin'
              ? `Admin (@${req.dbUser!.username})`
              : `@${req.dbUser!.username || req.dbUser!.displayName}`,
        senderRole: req.dbUser!.role,
        targetRecipient: typeof targetRecipient === 'string' ? targetRecipient : '',
        title: String(title).slice(0, 140),
        message: String(message).slice(0, 600),
        type: typeof type === 'string' ? type.slice(0, 30) : 'ping',
      });
      res.status(201).json(created);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to send notification';
      const status = msg.includes('Only Admins')
        ? 403
        : msg.includes('not found')
          ? 404
          : 500;
      res.status(status).json({ error: msg });
    }
  });

  app.patch('/api/notifications/:id/read', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid ID' });
      await markNotificationRead(req.dbUser!.id, id);
      res.json({ ok: true });
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to mark notification read',
      });
    }
  });

  // Study Material Notes & Question Papers
  app.get('/api/study-materials', requireAuth, async (req: AuthRequest, res) => {
    try {
      const [rows, purchases] = await Promise.all([
        listStudyMaterials(),
        getUserMaterialPurchases(req.dbUser!.id),
      ]);
      const isContributorOrAdmin =
        req.dbUser?.role === 'admin' ||
        req.dbUser?.role === 'super' ||
        (req.dbUser?.role === 'contributor' && req.dbUser?.contributorApproved);
      const visible = isContributorOrAdmin
        ? rows
        : rows.filter(
            (m) => m.category === 'question_paper' || m.uploaderId === req.dbUser!.id
          );
      res.json({
        materials: visible,
        purchases,
        contributorAccess: isContributorOrAdmin,
        contributorRequested: Boolean(req.dbUser?.contributorRequested),
      });
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load study materials',
      });
    }
  });

  app.post('/api/study-materials/:id/acquire', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid material ID' });
      const { accessType, hours } = req.body || {};
      const result = await acquireStudyMaterial(req.dbUser!.id, id, {
        accessType: accessType === 'buy' ? 'buy' : 'rent',
        hours: Number(hours) || 1,
      });
      res.status(201).json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to acquire study material';
      const status =
        msg.includes('not found')
          ? 404
          : msg.includes('Insufficient') || msg.includes('already')
            ? 400
            : 500;
      res.status(status).json({ error: msg });
    }
  });

  app.get('/api/study-materials/:id/download', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const item = await getStudyMaterialById(id);
      if (!item) return res.status(404).json({ error: 'Study material not found.' });

      const isContributorOrAdmin =
        req.dbUser?.role === 'admin' ||
        req.dbUser?.role === 'super' ||
        (req.dbUser?.role === 'contributor' && req.dbUser?.contributorApproved);
      if (
        item.category !== 'question_paper' &&
        !isContributorOrAdmin &&
        item.uploaderId !== req.dbUser!.id
      ) {
        return res
          .status(403)
          .json({ error: 'Study Material Notes downloads are restricted to Contributors & Admins.' });
      }

      const hasAccess = await hasActiveMaterialAccess(
        req.dbUser!.id,
        req.dbUser!.role,
        item
      );
      if (!hasAccess) {
        return res.status(402).json({
          error: `Please rent (${item.hourlyRentCost} pts/hr) or buy (${item.buyCost} pts) "${item.title}" before downloading.`,
        });
      }

      const fullPath = path.join(UPLOADS_DIR, item.storedFileName);
      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: 'Stored file missing on server disk.' });
      }
      res.download(fullPath, item.fileName);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to download file',
      });
    }
  });

  app.patch(
    '/api/study-materials/:id/drive',
    requireAuth,
    async (req: AuthRequest, res) => {
      try {
        const id = Number(req.params.id);
        const { driveFileId, driveWebLink } = req.body || {};
        const updated = await updateStudyMaterialDriveInfo(
          id,
          String(driveFileId || ''),
          String(driveWebLink || '')
        );
        res.json(updated);
      } catch (error: unknown) {
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Failed to save Drive mirror link',
        });
      }
    }
  );

  app.delete('/api/study-materials/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const item = await getStudyMaterialById(id);
      if (!item) return res.status(404).json({ error: 'Not found' });
      if (
        req.dbUser?.role !== 'admin' &&
        req.dbUser?.role !== 'super' &&
        item.uploaderId !== req.dbUser?.id
      ) {
        return res.status(403).json({ error: 'Only the uploader or an Admin can delete this file.' });
      }
      await deleteStudyMaterial(id);
      res.json({ ok: true });
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to delete study material',
      });
    }
  });

  // Contributor application (sends internal Tool Mail to Admin/Super)
  app.post('/api/contributor/request', requireAuth, async (req: AuthRequest, res) => {
    try {
      const note =
        typeof req.body?.message === 'string'
          ? req.body.message
          : typeof req.body?.note === 'string'
            ? req.body.note
            : '';
      const updated = await requestContributorRole(req.dbUser!.id, note);
      res.json(updated ? sanitizeUserForClient(updated) : updated);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to apply as contributor',
      });
    }
  });

  // Contributors' Console Routes (nested subfolders + files + ASAN-Master-Folder tracking)
  app.get('/api/contributor-console', requireAuth, async (req: AuthRequest, res) => {
    try {
      const isElevated =
        req.dbUser?.role === 'super' ||
        req.dbUser?.role === 'admin' ||
        (req.dbUser?.role === 'contributor' && req.dbUser?.contributorApproved);
      if (!isElevated) {
        return res.status(403).json({
          error: 'Contributors Console is restricted to approved Contributors, Admins, and Super.',
        });
      }
      const workspace = await listContributorWorkspace(req.dbUser!.id);
      res.json(workspace);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load Contributors Console',
      });
    }
  });

  app.post('/api/contributor-console/folders', requireAuth, async (req: AuthRequest, res) => {
    try {
      const isElevated =
        req.dbUser?.role === 'super' ||
        req.dbUser?.role === 'admin' ||
        (req.dbUser?.role === 'contributor' && req.dbUser?.contributorApproved);
      if (!isElevated) {
        return res.status(403).json({ error: 'Approved Contributor role required.' });
      }
      const { name, parentId, path: folderPath } = req.body || {};
      const created = await createContributorFolder({
        userId: req.dbUser!.id,
        username: req.dbUser!.username || 'contributor',
        name: String(name || ''),
        parentId: parentId ? Number(parentId) : null,
        path: String(folderPath || name || ''),
      });
      res.status(201).json(created);
    } catch (error: unknown) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to create subfolder',
      });
    }
  });

  app.patch('/api/contributor-console/folders/:id/drive', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid folder ID' });
      const { driveFolderId, masterDriveFolderId } = req.body || {};
      const updated = await updateContributorFolderDrive(id, {
        ...(typeof driveFolderId === 'string' ? { driveFolderId } : {}),
        ...(typeof masterDriveFolderId === 'string' ? { masterDriveFolderId } : {}),
      });
      res.json(updated);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to update folder Drive IDs',
      });
    }
  });

  app.delete('/api/contributor-console/folders/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid folder ID' });
      const isElevated = req.dbUser?.role === 'super' || req.dbUser?.role === 'admin';
      await deleteContributorFolder(req.dbUser!.id, id, isElevated);
      res.json({ ok: true });
    } catch (error: unknown) {
      res.status(403).json({
        error: error instanceof Error ? error.message : 'Failed to delete folder',
      });
    }
  });

  app.get('/api/contributor-console/files/:id/download', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const item = await getContributorFileById(id);
      if (!item) return res.status(404).json({ error: 'Contributor file not found.' });
      const isElevated = req.dbUser?.role === 'super' || req.dbUser?.role === 'admin';
      if (!isElevated && item.userId !== req.dbUser!.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const fullPath = path.join(UPLOADS_DIR, item.storedFileName);
      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: 'File missing on server disk.' });
      }
      res.download(fullPath, item.fileName);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to download contributor file',
      });
    }
  });

  app.patch('/api/contributor-console/files/:id/drive', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid file ID' });
      const { driveFileId, driveWebLink, masterDriveFileId, masterDriveWebLink } = req.body || {};
      const updated = await updateContributorFileDrive(id, {
        ...(typeof driveFileId === 'string' ? { driveFileId } : {}),
        ...(typeof driveWebLink === 'string' ? { driveWebLink } : {}),
        ...(typeof masterDriveFileId === 'string' ? { masterDriveFileId } : {}),
        ...(typeof masterDriveWebLink === 'string' ? { masterDriveWebLink } : {}),
      });
      res.json(updated);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to update file Drive metadata',
      });
    }
  });

  app.delete('/api/contributor-console/files/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid file ID' });
      const isElevated = req.dbUser?.role === 'super' || req.dbUser?.role === 'admin';
      await deleteContributorFile(req.dbUser!.id, id, isElevated);
      res.json({ ok: true });
    } catch (error: unknown) {
      res.status(403).json({
        error: error instanceof Error ? error.message : 'Failed to delete contributor file',
      });
    }
  });

  // Admin Console Endpoints (role === 'admin' or 'super')
  app.get('/api/admin/overview', requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    try {
      const data = await getAdminAnalytics();
      res.json({
        ...data,
        constantAdminKey: CONSTANT_ADMIN_LICENSE_KEY,
      });
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load admin overview',
      });
    }
  });

  app.post(
    '/api/admin/contributors',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      try {
        const { userId, approve } = req.body || {};
        if (!userId) return res.status(400).json({ error: 'userId is required.' });
        const updated = await setContributorStatus(Number(userId), {
          approve: Boolean(approve),
          role: approve ? 'contributor' : 'user',
        });
        res.json(updated ? sanitizeUserForClient(updated) : updated);
      } catch (error: unknown) {
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Failed to update contributor status',
        });
      }
    }
  );

  app.post(
    '/api/admin/authorize-admin',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      try {
        const { email, authorize = true } = req.body || {};
        if (!email || typeof email !== 'string') {
          return res.status(400).json({ error: 'Target user email is required.' });
        }
        const updated = await authorizeAdminEmail(email, Boolean(authorize));
        res.json(sanitizeUserForClient(updated));
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Failed to authorize admin';
        res.status(msg.includes('No registered') ? 404 : 500).json({ error: msg });
      }
    }
  );

  app.post(
    '/api/admin/generate-key',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      try {
        const { recipientEmail, term } = req.body || {};
        const planTerm = term === 'annual' ? 'annual' : 'monthly';
        const result = await generateProLicenseKey({
          issuedByUserId: req.dbUser!.id,
          targetEmailOrUsername:
            typeof recipientEmail === 'string' ? recipientEmail : undefined,
          chargePoints: false,
          term: planTerm,
        });
        res.status(201).json(result);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Failed to generate key';
        res.status(msg.includes('not found') ? 404 : 500).json({ error: msg });
      }
    }
  );

  // Super / Developer Mode Endpoints (STRICTLY invcorporation7@gmail.com)
  app.post('/api/super/adjust-points', requireAuth, requireSuper, async (req: AuthRequest, res) => {
    try {
      const { targetUserId, amount, reason } = req.body || {};
      const updated = await superAdjustUserPoints({
        superUserId: req.dbUser!.id,
        targetUserId: Number(targetUserId),
        amount: Number(amount),
        reason: String(reason || ''),
      });
      res.json({ user: sanitizeUserForClient(updated) });
    } catch (error: unknown) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to adjust points',
      });
    }
  });

  app.post('/api/super/terminate-plan', requireAuth, requireSuper, async (req: AuthRequest, res) => {
    try {
      const { targetUserId, action, keyId, reason } = req.body || {};
      const result = await superTerminateOrCancel({
        superUserId: req.dbUser!.id,
        targetUserId: targetUserId ? Number(targetUserId) : undefined,
        action,
        keyId: keyId ? Number(keyId) : undefined,
        reason: typeof reason === 'string' ? reason : '',
      });
      res.json({
        ...result,
        user: result.user ? sanitizeUserForClient(result.user) : undefined,
      });
    } catch (error: unknown) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to execute Super action',
      });
    }
  });

  app.post(
    '/api/super/contributor-weekly-points',
    requireAuth,
    requireSuper,
    async (req: AuthRequest, res) => {
      try {
        const { points } = req.body || {};
        const updatedPoints = await setContributorWeeklyPoints(Number(points));
        res.json({ contributorWeeklyPoints: updatedPoints });
      } catch (error: unknown) {
        res.status(400).json({
          error: error instanceof Error ? error.message : 'Failed to update weekly stipend',
        });
      }
    }
  );

  app.get('/api/admin/point-transactions', requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    try {
      const data = await listPointTransactionsForAdmin();
      res.json(data);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load point transactions',
      });
    }
  });

  app.post(
    '/api/admin/point-transactions/:id/review',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      try {
        const transactionId = Number(req.params.id);
        if (!Number.isFinite(transactionId)) {
          return res.status(400).json({ error: 'Invalid transaction ID.' });
        }
        const rawAction = req.body?.action;
        const action =
          rawAction === 'revert'
            ? 'revert'
            : rawAction === 'dismiss'
              ? 'dismiss'
              : rawAction === 'verify'
                ? 'verify'
                : null;
        if (!action) {
          return res.status(400).json({ error: 'Action must be verify, revert, or dismiss.' });
        }
        const note = typeof req.body?.note === 'string' ? req.body.note : '';
        const result = await reviewPointTransaction({
          reviewerId: req.dbUser!.id,
          reviewerEmail: req.dbUser!.email,
          reviewerUsername: req.dbUser!.username,
          reviewerShortUid: req.dbUser!.shortUid,
          reviewerRole: req.dbUser!.role,
          transactionId,
          action,
          note,
        });
        res.json(result);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Failed to review point transaction';
        const status = msg.includes('not found') ? 404 : msg.includes('already') || msg.includes('cannot') || msg.includes('Please enter') ? 400 : 500;
        res.status(status).json({ error: msg });
      }
    }
  );

  app.get('/api/admin/google-analytics', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const range = typeof req.query.range === 'string' ? req.query.range : '28d';
      const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const report = await fetchGa4Report(range, refresh);
      res.json(report);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch GA4 analytics report',
      });
    }
  });

  app.get('/api/super/users-points', requireAuth, requireSuper, async (_req: AuthRequest, res) => {
    try {
      const data = await getSuperUsersAndPointsLedger();
      res.json(data);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load Super users and points ledger',
      });
    }
  });

  app.get('/api/super/master-sync-queue', requireAuth, requireSuper, async (_req: AuthRequest, res) => {
    try {
      const data = await listAllContributorAssetsForMasterSync();
      res.json(data);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load Master sync queue',
      });
    }
  });

  // Public safe credits list (currently serving approved contributors)
  app.get('/api/credits', async (_req, res) => {
    try {
      const contributors = await listPublicCreditsContributors();
      res.json({ contributors });
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load credits',
      });
    }
  });

  // Exam Master Blueprints ("master" -> "test_dates" sheet cards)
  app.get('/api/exam-blueprints', requireAuth, async (req: AuthRequest, res) => {
    try {
      const rows = await getUserExamBlueprints(req.dbUser!.id);
      res.json(rows);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load exam blueprints',
      });
    }
  });

  app.post('/api/exam-blueprints', requireAuth, async (req: AuthRequest, res) => {
    try {
      const {
        paperCode,
        subject,
        examType,
        examDate,
        examTime,
        totalMarks,
        marksScored,
        percentage,
        syllabus,
        questionPaperUrl,
        answerSheetUrl,
        correctedAnswerSheetUrl,
      } = req.body || {};
      if (!paperCode || !subject || !examDate) {
        return res.status(400).json({ error: 'Paper code, subject, and date are required.' });
      }
      const created = await createExamBlueprint(req.dbUser!.id, {
        paperCode: String(paperCode).slice(0, 24),
        subject: String(subject).slice(0, 100),
        examType: typeof examType === 'string' ? examType.slice(0, 60) : 'JEE Main',
        examDate: String(examDate).slice(0, 20),
        examTime: typeof examTime === 'string' ? examTime.slice(0, 20) : '09:00',
        totalMarks: Number(totalMarks) || 100,
        marksScored:
          marksScored === '' || marksScored === null || marksScored === undefined
            ? null
            : Number(marksScored),
        percentage: typeof percentage === 'string' ? percentage.slice(0, 20) : '',
        syllabus: Array.isArray(syllabus) ? syllabus.map((s) => String(s)) : [],
        questionPaperUrl:
          typeof questionPaperUrl === 'string' ? questionPaperUrl.slice(0, 500) : '',
        answerSheetUrl:
          typeof answerSheetUrl === 'string' ? answerSheetUrl.slice(0, 500) : '',
        correctedAnswerSheetUrl:
          typeof correctedAnswerSheetUrl === 'string'
            ? correctedAnswerSheetUrl.slice(0, 500)
            : '',
      });
      res.status(201).json(created);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to save exam blueprint',
      });
    }
  });

  app.patch('/api/exam-blueprints/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid blueprint ID' });
      const updates = req.body || {};
      const updated = await updateExamBlueprint(req.dbUser!.id, id, {
        ...(typeof updates.paperCode === 'string'
          ? { paperCode: updates.paperCode.slice(0, 24).toUpperCase() }
          : {}),
        ...(typeof updates.subject === 'string'
          ? { subject: updates.subject.slice(0, 100) }
          : {}),
        ...(typeof updates.examType === 'string'
          ? { examType: updates.examType.slice(0, 60) }
          : {}),
        ...(typeof updates.examDate === 'string'
          ? { examDate: updates.examDate.slice(0, 20) }
          : {}),
        ...(typeof updates.examTime === 'string'
          ? { examTime: updates.examTime.slice(0, 20) }
          : {}),
        ...(updates.totalMarks !== undefined
          ? { totalMarks: Number(updates.totalMarks) || 100 }
          : {}),
        ...(updates.marksScored !== undefined
          ? {
              marksScored:
                updates.marksScored === '' || updates.marksScored === null
                  ? null
                  : Number(updates.marksScored),
            }
          : {}),
        ...(Array.isArray(updates.syllabus)
          ? { syllabus: updates.syllabus.map((s: unknown) => String(s)) }
          : {}),
        ...(typeof updates.questionPaperUrl === 'string'
          ? { questionPaperUrl: updates.questionPaperUrl.slice(0, 500) }
          : {}),
        ...(typeof updates.answerSheetUrl === 'string'
          ? { answerSheetUrl: updates.answerSheetUrl.slice(0, 500) }
          : {}),
        ...(typeof updates.correctedAnswerSheetUrl === 'string'
          ? { correctedAnswerSheetUrl: updates.correctedAnswerSheetUrl.slice(0, 500) }
          : {}),
      });
      res.json(updated);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to update exam blueprint',
      });
    }
  });

  app.delete('/api/exam-blueprints/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid blueprint ID' });
      await deleteExamBlueprint(req.dbUser!.id, id);
      res.json({ ok: true });
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to delete exam blueprint',
      });
    }
  });

  // Contact form
  app.get('/api/contact', requireAuth, async (req: AuthRequest, res) => {
    try {
      const isAdmin = req.dbUser?.role === 'admin' || req.dbUser?.role === 'super';
      const rows = await getContactMessages(req.dbUser!.id, isAdmin);
      res.json(rows);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load contact messages',
      });
    }
  });

  app.post('/api/contact', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { name, email, subject, message } = req.body || {};
      if (!name || !email || !message) {
        return res.status(400).json({ error: 'Name, email, and message are required.' });
      }
      const created = await createContactMessage({
        userId: req.dbUser!.id,
        name: String(name).slice(0, 120),
        email: String(email).slice(0, 160),
        subject: String(subject || 'General Inquiry').slice(0, 200),
        message: String(message).slice(0, 4000),
      });
      res.status(201).json(created);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to submit contact form',
      });
    }
  });

  // Return structured JSON 404 for unknown /api/* endpoints instead of SPA HTML
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // Global Express error handler (catches malformed JSON bodies & unhandled sync/async errors)
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (res.headersSent) return next(err);
      const status =
        typeof err === 'object' && err !== null && 'status' in err
          ? Number((err as { status?: number }).status) || 500
          : 500;
      const message =
        err instanceof SyntaxError && status === 400
          ? 'Invalid JSON request body.'
          : err instanceof Error
            ? err.message
            : 'Unexpected internal server error.';
      console.error('Express route error:', message);
      return res.status(status).json({ error: message });
    }
  );

  // Vite middleware for dev or static dist for production (Render Web Service + PWA)
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ...(process.env.DISABLE_HMR === 'true' ? { hmr: false } : {}),
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('sw.js') || filePath.endsWith('registerSW.js')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          } else if (filePath.endsWith('manifest.webmanifest')) {
            res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ASAN-Study_tool server running on http://0.0.0.0:${PORT}`);
  });
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason instanceof Error ? reason.message : reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err instanceof Error ? err.message : err);
});

startServer().catch((err) => {
  console.error('Server startup failed:', err);
  process.exit(1);
});
