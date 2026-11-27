import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import {
  type AuthRequest,
  optionalAuth,
  requireAdmin,
  requireAuth,
  requireSuper,
  signLocalSessionToken,
} from './src/middleware/auth.ts';
import {
  ensureDatabaseSchema,
  getDatabaseStatus,
  isPostgresConfigured,
  verifyDatabaseConnection,
} from './src/db/index.ts';
import { CONSTANT_ADMIN_LICENSE_KEY, UPLOADS_DIR } from './src/db/localStore.ts';
import { fetchGa4Report, getPublicMeasurementId } from './src/lib/ga4.ts';
import { richHtmlToPlainText, sanitizeRichHtmlServer } from './src/lib/htmlSanitizer.ts';
import {
  calculatePlanQuote,
  calculateRepoOrAppQuote,
  type PricingTargetScope,
} from './src/lib/pricing.ts';
import {
  authorizeAdminEmail,
  cancelProAndRequestRefund,
  createCoupon,
  deleteCouponById,
  generateProLicenseKey,
  getPointRewardsConfig,
  getPointTransactions,
  getUserAppSubscriptions,
  getUserLicenseKeys,
  getUserPlanSubscriptions,
  getUserRefundRequests,
  listCoupons,
  listPublicCreditsContributors,
  listRefundRequestsForAdmin,
  listToolUsers,
  loginPasswordUser,
  purchasePlanWithPoints,
  purchaseProWithPoints,
  redeemLicenseKey,
  registerPasswordUser,
  requestContributorRole,
  resolveValidCouponForScope,
  reviewProRefundRequest,
  sanitizeUserForClient,
  setContributorStatus,
  setContributorWeeklyPoints,
  setPasswordForUser,
  setPointRewardsConfig,
  superAdjustUserPoints,
  superTerminateOrCancel,
  updateCouponStatus,
  updateUserPlan,
  updateUserProfile,
} from './src/db/users.ts';
import {
  acquireStudyMaterial,
  cancelMaterialPurchase,
  createCalendarEvent,
  createCalendarEventsBulk,
  createContactMessage,
  createContributorFile,
  createContributorFolder,
  createExamBlueprint,
  createExamCountdown,
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
  deleteExamCountdown,
  deleteExamSchedule,
  deleteNotebook,
  deleteNotePage,
  deleteStudyMaterial,
  deleteTask,
  deleteToolMessage,
  detectPdfPageCountFromBuffer,
  detectStudyMediaKind,
  extendMaterialPurchase,
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
  listExamCountdowns,
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
import {
  addMembersToForumGroup,
  createForumAttachmentRecord,
  createForumGroupRoom,
  createForumPost,
  createForumReply,
  getForumAttachmentForUser,
  getForumHighlights,
  getForumPostDetail,
  getOrCreateDmRoom,
  listForumRoomPosts,
  listUserForumRooms,
  markForumReplySatisfactory,
  markForumRoomRead,
  submitQuestionAttempt,
  toggleForumReplyVote,
} from './src/db/forum.ts';
import {
  cancelAppSubscription,
  createFormulaEquation,
  deleteFormulaEquation,
  extendAppSubscription,
  getFormulaAccessStatus,
  listFormulaEquations,
  renewFormulaMeteredSession,
  startFormulaMeteredSession,
  stopFormulaMeteredSession,
  updateFormulaEquation,
} from './src/db/formulas.ts';
import {
  attachForumWebSocketServer,
  emitForumRoomEvent,
  emitForumUserEvent,
  registerSseForumClient,
  subscribeUserToRoomRealtime,
} from './src/realtime/forumWs.ts';

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
      'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-material-title, x-material-subject, x-material-category, x-material-description, x-file-name, x-mime-type, x-media-kind, x-attachment-kind, x-page-count, x-hourly-rent-cost, x-buy-cost, x-folder-id, x-folder-path'
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

  app.get('/api/health', async (_req, res) => {
    if (isPostgresConfigured()) {
      await verifyDatabaseConnection();
    }
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

  app.get('/api/point-rewards', async (_req, res) => {
    try {
      const config = await getPointRewardsConfig();
      res.json({ ...config, rewards: config });
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load point rewards configuration',
      });
    }
  });

  // Streaming binary upload route for large Study Material Notes, Question Papers & Multi-Format Media (before express.json)
  app.post('/api/study-materials/upload', requireAuth, async (req: AuthRequest, res) => {
    const title = safeHeaderDecode(req.headers['x-material-title'], 'Untitled Material').slice(0, 180);
    const subject = safeHeaderDecode(req.headers['x-material-subject'], 'General').slice(0, 80);
    const category = safeHeaderDecode(req.headers['x-material-category'], 'study_notes').slice(0, 40);
    const description = safeHeaderDecode(req.headers['x-material-description'], '').slice(0, 1000);
    const originalFileName = path
      .basename(safeHeaderDecode(req.headers['x-file-name'], 'study-material.pdf'))
      .replace(/[^a-zA-Z0-9._-]/g, '_');
    const mimeType = safeHeaderDecode(
      req.headers['x-mime-type'],
      'application/octet-stream'
    ).slice(0, 120);
    const rawMediaKind = safeHeaderDecode(req.headers['x-media-kind'], '').slice(0, 30);
    const rawHourlyRent = Number(safeHeaderDecode(req.headers['x-hourly-rent-cost'], '10'));
    const rawPageCount = Number(safeHeaderDecode(req.headers['x-page-count'], '0'));
    const rawBuyCost = Number(safeHeaderDecode(req.headers['x-buy-cost'], '0'));

    if (!Number.isFinite(rawHourlyRent) || rawHourlyRent < 5 || rawHourlyRent > 100) {
      return res.status(400).json({
        error: 'Hourly rent cost must be between 5 and 100 points per hour.',
      });
    }

    // Non-contributor users may upload question papers; big study notes require Contributor, Admin, or Super
    const isPrivileged =
      req.dbUser?.role === 'admin' ||
      req.dbUser?.role === 'super' ||
      (req.dbUser?.role === 'contributor' && req.dbUser?.contributorApproved);

    if (category !== 'question_paper' && !isPrivileged) {
      return res.status(403).json({
        error:
          'Study Material Notes uploads are restricted to approved Contributors & Admins. Apply in Study Material Notes or upload a Question Paper.',
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
            description,
            fileName: originalFileName,
            storedFileName,
            mimeType,
            mediaKind: detectStudyMediaKind(originalFileName, mimeType, rawMediaKind),
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

  // Streaming binary upload route for Forum & Tool Mail Images / PDFs (before express.json)
  app.post('/api/forum/attachments/upload', requireAuth, async (req: AuthRequest, res) => {
    const originalFileName = path
      .basename(safeHeaderDecode(req.headers['x-file-name'], 'attachment.bin'))
      .replace(/[^a-zA-Z0-9._-]/g, '_');
    const rawMime = safeHeaderDecode(
      req.headers['x-mime-type'],
      'application/octet-stream'
    ).slice(0, 120);
    const lowerName = originalFileName.toLowerCase();
    const isPdf = rawMime === 'application/pdf' || lowerName.endsWith('.pdf');
    const isImage =
      ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'].includes(rawMime.toLowerCase()) ||
      /\.(png|jpe?g|webp|gif)$/.test(lowerName);

    if (!isPdf && !isImage) {
      return res.status(400).json({
        error: 'Forum attachments support PNG, JPEG, WEBP, GIF images and PDF files.',
      });
    }

    const MAX_BYTES = 25 * 1024 * 1024;
    const storedFileName = `forum-${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${originalFileName}`;
    const fullPath = path.resolve(UPLOADS_DIR, storedFileName);
    if (!fullPath.startsWith(path.resolve(UPLOADS_DIR) + path.sep)) {
      return res.status(400).json({ error: 'Invalid upload target path.' });
    }
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
        res.status(413).json({ error: 'Attachment exceeds 25 MB limit.' });
        return;
      }
      writeStream.write(chunk);
    });

    req.on('end', async () => {
      if (aborted) return;
      writeStream.end(async () => {
        if (totalBytes === 0) {
          if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
          return res.status(400).json({ error: 'Uploaded attachment is empty.' });
        }
        try {
          // Validate magic bytes
          const fd = fs.openSync(fullPath, 'r');
          let headerBuf = Buffer.alloc(16);
          try {
            const readLen = fs.readSync(fd, headerBuf, 0, 16, 0);
            headerBuf = headerBuf.subarray(0, readLen);
          } finally {
            fs.closeSync(fd);
          }
          const isMagicPdf = headerBuf.subarray(0, 4).toString('latin1') === '%PDF';
          const isMagicPng = headerBuf.length >= 4 && headerBuf[0] === 0x89 && headerBuf[1] === 0x50 && headerBuf[2] === 0x4e && headerBuf[3] === 0x47;
          const isMagicJpg = headerBuf.length >= 3 && headerBuf[0] === 0xff && headerBuf[1] === 0xd8 && headerBuf[2] === 0xff;
          const isMagicGif = headerBuf.subarray(0, 3).toString('latin1') === 'GIF';
          const isMagicWebp = headerBuf.subarray(0, 4).toString('latin1') === 'RIFF';

          if (isPdf && !isMagicPdf) {
            if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
            return res.status(400).json({ error: 'Invalid PDF file signature.' });
          }
          if (isImage && !(isMagicPng || isMagicJpg || isMagicGif || isMagicWebp)) {
            if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
            return res.status(400).json({ error: 'Invalid image file signature (PNG/JPEG/GIF/WEBP only).' });
          }

          let detectedPages = 1;
          if (isPdf) {
            const pdfFd = fs.openSync(fullPath, 'r');
            try {
              const readLen = Math.min(totalBytes, 6 * 1024 * 1024);
              const sample = Buffer.alloc(readLen);
              fs.readSync(pdfFd, sample, 0, readLen, 0);
              detectedPages = detectPdfPageCountFromBuffer(sample);
            } finally {
              fs.closeSync(pdfFd);
            }
          }

          const finalMime = isPdf
            ? 'application/pdf'
            : rawMime.startsWith('image/')
              ? rawMime
              : isMagicPng
                ? 'image/png'
                : isMagicGif
                  ? 'image/gif'
                  : isMagicWebp
                    ? 'image/webp'
                    : 'image/jpeg';

          const record = await createForumAttachmentRecord({
            uploaderId: req.dbUser!.id,
            fileName: originalFileName,
            storedFileName,
            mimeType: finalMime,
            fileSizeBytes: totalBytes,
            pageCount: detectedPages,
            kind: isPdf ? 'pdf' : 'image',
          });
          res.status(201).json(record);
        } catch (err) {
          if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
          res.status(500).json({
            error: err instanceof Error ? err.message : 'Failed to save attachment',
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
      if (user.uid === 'dev_test_1') {
        const payload = Buffer.from(
          JSON.stringify({
            userId: -1,
            uid: 'dev_test_1',
            email: 'dev@asan-study.local',
            isTestUser: true,
            issuedAt: Date.now(),
            exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
          })
        ).toString('base64');
        return res.json({
          token: `inbuilt.${payload}`,
          user: { ...sanitizeUserForClient(user), authMode: 'password' },
        });
      }
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
        workspacePermissions,
        eliteVisualEffects,
      } = req.body || {};
      const parsedWorkspacePerms =
        workspacePermissions && typeof workspacePermissions === 'object'
          ? {
              ...(typeof workspacePermissions.driveSync === 'boolean'
                ? { driveSync: workspacePermissions.driveSync }
                : {}),
              ...(typeof workspacePermissions.docsExport === 'boolean'
                ? { docsExport: workspacePermissions.docsExport }
                : {}),
              ...(typeof workspacePermissions.sheetsSync === 'boolean'
                ? { sheetsSync: workspacePermissions.sheetsSync }
                : {}),
              ...(typeof workspacePermissions.meetRooms === 'boolean'
                ? { meetRooms: workspacePermissions.meetRooms }
                : {}),
            }
          : undefined;
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
        workspacePermissions: parsedWorkspacePerms,
        ...(typeof eliteVisualEffects === 'boolean' ? { eliteVisualEffects } : {}),
      });
      res.json({
        ...sanitizeUserForClient(updated),
        authMode: req.authMode || req.dbUser?.authMode || 'google',
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to update profile';
      const status =
        msg.includes('Pro users cannot') ||
        msg.includes('cannot pause') ||
        msg.includes('Elite')
          ? 403
          : msg.includes('already taken') || msg.includes('at least 3')
            ? 400
            : 500;
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
      const msg = error instanceof Error ? error.message : 'Failed to update plan';
      res.status(msg.includes('Pro users cannot') ? 403 : 500).json({ error: msg });
    }
  });

  // Points & Subscriptions & 8/12-Char License Keys
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
      const [keys, transactions, refundRequests, planSubscriptions, appSubscriptions, materialPurchases] =
        await Promise.all([
          getUserLicenseKeys(req.dbUser!.id, req.dbUser!.email),
          getPointTransactions(req.dbUser!.id),
          getUserRefundRequests(req.dbUser!.id),
          getUserPlanSubscriptions(req.dbUser!.id),
          getUserAppSubscriptions(req.dbUser!.id),
          getUserMaterialPurchases(req.dbUser!.id),
        ]);
      res.json({
        plan: req.dbUser!.plan,
        role: req.dbUser!.role,
        points: req.dbUser!.points,
        infinitePoints: Boolean(req.dbUser!.infinitePoints),
        proStartedAt: req.dbUser!.proStartedAt,
        proExpiresAt: req.dbUser!.proExpiresAt,
        eliteStartedAt: req.dbUser!.eliteStartedAt || '',
        eliteExpiresAt: req.dbUser!.eliteExpiresAt || '',
        activeProGifted: Boolean(req.dbUser!.activeProGifted),
        keys,
        transactions,
        refundRequests,
        planSubscriptions,
        appSubscriptions,
        materialPurchases,
      });
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load subscriptions',
      });
    }
  });

  app.post('/api/coupons/validate', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { code, targetScope, tier, term, baseSubtotal } = req.body || {};
      const allowedScopes: PricingTargetScope[] = [
        'pro_plan',
        'elite_plan',
        'apps_metered',
        'repository_rent',
        'repository_buy',
      ];
      const scope: PricingTargetScope = allowedScopes.includes(targetScope)
        ? targetScope
        : tier === 'elite'
          ? 'elite_plan'
          : 'pro_plan';
      const cleanCode = typeof code === 'string' ? code.trim() : '';
      const coupon = cleanCode ? await resolveValidCouponForScope(cleanCode, scope) : null;
      const nowMs = Date.now();
      const u = req.dbUser!;
      let effectivePlan = 'basic';
      if (u.plan === 'elite' && (!u.eliteExpiresAt || new Date(u.eliteExpiresAt).getTime() > nowMs)) {
        effectivePlan = 'elite';
      } else if (u.plan === 'pro' && (!u.proExpiresAt || new Date(u.proExpiresAt).getTime() > nowMs)) {
        effectivePlan = 'pro';
      }

      const quote =
        scope === 'pro_plan' || scope === 'elite_plan'
          ? calculatePlanQuote({
              tier: scope === 'elite_plan' ? 'elite' : 'pro',
              term: term === 'annual' ? 'annual' : 'monthly',
              coupon,
            })
          : calculateRepoOrAppQuote({
              targetScope: scope,
              baseSubtotal: Math.max(0, Math.round(Number(baseSubtotal) || 0)),
              effectivePlan,
              role: u.role,
              coupon,
            });
      res.json({ valid: true, coupon, quote });
    } catch (error: unknown) {
      res.status(400).json({
        valid: false,
        error: error instanceof Error ? error.message : 'Invalid coupon code.',
      });
    }
  });

  app.post('/api/subscriptions/redeem-points', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { tier, term, couponCode, proHandling } = req.body || {};
      const planTier = tier === 'elite' ? 'elite' : 'pro';
      const planTerm = term === 'annual' ? 'annual' : 'monthly';
      const handling =
        proHandling === 'keep' || proHandling === 'cancel' ? proHandling : undefined;
      const updatedUser = await purchasePlanWithPoints(req.dbUser!.id, {
        tier: planTier,
        term: planTerm,
        couponCode: typeof couponCode === 'string' ? couponCode : undefined,
        proHandling: handling,
      });
      const tierLabel = planTier === 'elite' ? 'Elite' : 'Pro';
      res.json({
        user: sanitizeUserForClient(updatedUser),
        message:
          planTerm === 'annual'
            ? `Annual ${tierLabel} plan activated for 12 months (11 months + 1 free + 25 platform fee).`
            : `Monthly ${tierLabel} plan activated for 1 month (${
                planTier === 'elite' ? '725 + 25 = 750' : '475 + 25 = 500'
              } points).`,
      });
    } catch (error: unknown) {
      const errObj = error as Error & { code?: string; proExpiresAt?: string };
      const msg = error instanceof Error ? error.message : 'Failed to redeem points';
      if (errObj?.code === 'PRO_OVERLAP_CHOICE_REQUIRED') {
        return res.status(409).json({
          error: msg,
          code: 'PRO_OVERLAP_CHOICE_REQUIRED',
          requiresProChoice: true,
          proExpiresAt: errObj.proExpiresAt || '',
        });
      }
      const status =
        msg.includes('Insufficient') || msg.includes('Coupon') || msg.includes('coupon')
          ? 400
          : 500;
      res.status(status).json({ error: msg });
    }
  });

  app.post('/api/subscriptions/extend', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { tier, term, couponCode } = req.body || {};
      const planTier = tier === 'elite' ? 'elite' : 'pro';
      const planTerm = term === 'annual' ? 'annual' : 'monthly';
      const updatedUser = await purchasePlanWithPoints(req.dbUser!.id, {
        tier: planTier,
        term: planTerm,
        couponCode: typeof couponCode === 'string' ? couponCode : undefined,
        proHandling: 'keep',
      });
      res.json({
        user: sanitizeUserForClient(updatedUser),
        message: `Extended ${planTier === 'elite' ? 'Elite' : 'Pro'} (${planTerm}) successfully.`,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to extend subscription';
      const status =
        msg.includes('Insufficient') || msg.includes('Coupon') || msg.includes('coupon')
          ? 400
          : 500;
      res.status(status).json({ error: msg });
    }
  });

  app.post('/api/subscriptions/purchase-key', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { recipientEmail, term, tier, keyType, couponCode } = req.body || {};
      const planTerm = term === 'annual' ? 'annual' : 'monthly';
      const resolvedKeyType = tier === 'elite' || keyType === 'elite' ? 'elite' : 'pro';
      const result = await generateProLicenseKey({
        issuedByUserId: req.dbUser!.id,
        targetEmailOrUsername:
          typeof recipientEmail === 'string' ? recipientEmail : undefined,
        chargePoints: true,
        term: planTerm,
        keyType: resolvedKeyType,
        couponCode: typeof couponCode === 'string' ? couponCode : undefined,
        sourceType: 'points',
      });
      res.status(201).json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to purchase license key';
      const status =
        msg.includes('Insufficient') ||
        msg.includes('not found') ||
        msg.includes('Coupon') ||
        msg.includes('coupon') ||
        msg.includes('Elite')
          ? 400
          : 500;
      res.status(status).json({ error: msg });
    }
  });

  app.post('/api/subscriptions/redeem-key', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { keyCode, proHandling } = req.body || {};
      if (!keyCode || typeof keyCode !== 'string') {
        return res
          .status(400)
          .json({ error: '8-character (Pro) or 12-character (Elite) license key is required.' });
      }
      const handling =
        proHandling === 'keep' || proHandling === 'cancel' ? proHandling : undefined;
      const result = await redeemLicenseKey(req.dbUser!.id, keyCode, handling);
      res.json({
        ...result,
        user: result.user ? sanitizeUserForClient(result.user) : undefined,
      });
    } catch (error: unknown) {
      const errObj = error as Error & { code?: string; proExpiresAt?: string };
      const msg = error instanceof Error ? error.message : 'Failed to activate license key';
      if (errObj?.code === 'PRO_OVERLAP_CHOICE_REQUIRED') {
        return res.status(409).json({
          error: msg,
          code: 'PRO_OVERLAP_CHOICE_REQUIRED',
          requiresProChoice: true,
          proExpiresAt: errObj.proExpiresAt || '',
        });
      }
      const status =
        msg.includes('hand-selected') || msg.includes('locked to the recipient')
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

  app.post('/api/subscriptions/cancel-pro', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { reason, purchaseType, tier } = req.body || {};
      const result = await cancelProAndRequestRefund({
        userId: req.dbUser!.id,
        reason: typeof reason === 'string' ? reason : '',
        purchaseType: purchaseType === 'non_timed' ? 'non_timed' : 'timed',
        tier: tier === 'elite' ? 'elite' : tier === 'pro' ? 'pro' : undefined,
      });
      res.json({
        user: sanitizeUserForClient(result.user),
        refundRequest: result.refundRequest,
        message: result.message,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to cancel subscription';
      res.status(msg.includes('No active') || msg.includes('Only active') ? 400 : 500).json({ error: msg });
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

  app.post('/api/events/bulk', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { title, dates, eventTime, category, notes, meetLink } = req.body || {};
      if (!title || !Array.isArray(dates) || dates.length === 0) {
        return res.status(400).json({ error: 'Event title and at least one date are required.' });
      }
      if (dates.length > 366) {
        return res.status(400).json({ error: 'Maximum 366 dates can be created per series.' });
      }
      const result = await createCalendarEventsBulk(req.dbUser!.id, {
        title: String(title).slice(0, 200),
        dates: dates.map((d: unknown) => String(d).slice(0, 20)),
        eventTime: typeof eventTime === 'string' ? eventTime.slice(0, 20) : '09:00',
        category: typeof category === 'string' ? category.slice(0, 40) : 'study',
        notes: typeof notes === 'string' ? notes.slice(0, 2000) : '',
        meetLink: typeof meetLink === 'string' ? meetLink.slice(0, 300) : '',
      });
      res.status(201).json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to create event series';
      const status = msg.includes('Maximum') || msg.includes('valid date') ? 400 : 500;
      res.status(status).json({ error: msg });
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
        bodyHtml,
        attachments,
        questionSpec,
        attachmentTitle,
        attachmentNoteId,
      } = req.body || {};

      const safeHtml = typeof bodyHtml === 'string' && bodyHtml.trim() ? sanitizeRichHtmlServer(bodyHtml) : '';
      const plainFromHtml = safeHtml ? richHtmlToPlainText(safeHtml) : '';
      const effectiveBody = String(body || plainFromHtml || '').trim();

      if (!subject || !effectiveBody) {
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
        body: effectiveBody.slice(0, 8000),
        bodyHtml: safeHtml,
        attachmentsJson: Array.isArray(attachments) ? attachments : [],
        questionSpecJson:
          questionSpec && typeof questionSpec === 'object'
            ? (questionSpec as Record<string, unknown>)
            : null,
        attachmentTitle:
          typeof attachmentTitle === 'string' ? attachmentTitle.slice(0, 180) : '',
        attachmentNoteId: attachmentNoteId ? Number(attachmentNoteId) : null,
      });

      const createdItems = Array.isArray(created) ? created : [created];
      for (const item of createdItems as { recipientId?: number | null }[]) {
        if (item?.recipientId) {
          emitForumUserEvent(item.recipientId, {
            type: 'mail:new',
            message: item as any,
          });
        }
      }

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
      const { accessType, hours, couponCode } = req.body || {};
      const result = await acquireStudyMaterial(req.dbUser!.id, id, {
        accessType: accessType === 'buy' ? 'buy' : 'rent',
        hours: Number(hours) || 1,
        couponCode: typeof couponCode === 'string' ? couponCode : undefined,
      });
      res.status(201).json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to acquire study material';
      const status =
        msg.includes('not found')
          ? 404
          : msg.includes('Insufficient') ||
              msg.includes('already') ||
              msg.includes('Coupon') ||
              msg.includes('coupon')
            ? 400
            : 500;
      res.status(status).json({ error: msg });
    }
  });

  app.post(
    '/api/study-materials/purchases/:id/cancel',
    requireAuth,
    async (req: AuthRequest, res) => {
      try {
        const purchaseId = Number(req.params.id);
        if (!Number.isFinite(purchaseId)) {
          return res.status(400).json({ error: 'Invalid purchase ID' });
        }
        const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
        const result = await cancelMaterialPurchase(req.dbUser!.id, purchaseId, { reason });
        res.json(result);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Failed to cancel purchase';
        res.status(msg.includes('not found') ? 404 : 400).json({ error: msg });
      }
    }
  );

  app.post(
    '/api/study-materials/purchases/:id/extend',
    requireAuth,
    async (req: AuthRequest, res) => {
      try {
        const purchaseId = Number(req.params.id);
        if (!Number.isFinite(purchaseId)) {
          return res.status(400).json({ error: 'Invalid purchase ID' });
        }
        const { hours, couponCode } = req.body || {};
        const result = await extendMaterialPurchase(req.dbUser!.id, purchaseId, {
          hours: Number(hours) || 1,
          couponCode: typeof couponCode === 'string' ? couponCode : undefined,
        });
        res.json(result);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Failed to extend purchase';
        res.status(msg.includes('not found') ? 404 : 400).json({ error: msg });
      }
    }
  );

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

      const fullPath = path.resolve(UPLOADS_DIR, path.basename(item.storedFileName));
      if (!fullPath.startsWith(path.resolve(UPLOADS_DIR) + path.sep)) {
        return res.status(403).json({ error: 'Invalid file path.' });
      }
      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: 'Stored file missing on server disk.' });
      }
      const isInline = req.query.inline === '1' || req.query.inline === 'true';
      if (isInline) {
        res.setHeader('Content-Type', item.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${item.fileName.replace(/"/g, '')}"`);
        res.setHeader('Cache-Control', 'private, max-age=300');
        return res.sendFile(fullPath);
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
      const msg = error instanceof Error ? error.message : 'Failed to apply as contributor';
      const status = msg.includes('already') ? 400 : 500;
      res.status(status).json({ error: msg });
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
      const [data, refundRequests] = await Promise.all([
        getAdminAnalytics(),
        listRefundRequestsForAdmin(),
      ]);
      res.json({
        ...data,
        refundRequests,
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
        // Admin gifts only single-use 8-char Pro activation keys (No-Refund policy); Elite is points-only
        const result = await generateProLicenseKey({
          issuedByUserId: req.dbUser!.id,
          targetEmailOrUsername:
            typeof recipientEmail === 'string' ? recipientEmail : undefined,
          chargePoints: false,
          term: planTerm,
          keyType: 'pro',
          sourceType: 'admin_gift',
        });
        res.status(201).json(result);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Failed to generate key';
        res.status(msg.includes('not found') ? 404 : 400).json({ error: msg });
      }
    }
  );

  // Super-Only Promotional Coupons (strictly role === 'super', Admins get 403)
  app.get('/api/super/coupons', requireAuth, requireSuper, async (_req: AuthRequest, res) => {
    try {
      const rows = await listCoupons();
      res.json(rows);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load coupons',
      });
    }
  });

  app.post('/api/super/coupons', requireAuth, requireSuper, async (req: AuthRequest, res) => {
    try {
      const { code, description, scope, discountType, discountValue, maxUses, expiresAt } =
        req.body || {};
      const created = await createCoupon(req.dbUser!.id, {
        code: String(code || ''),
        description: typeof description === 'string' ? description : '',
        scope: typeof scope === 'string' ? scope : 'all',
        discountType: discountType === 'flat' ? 'flat' : 'percent',
        discountValue: Number(discountValue) || 10,
        maxUses: Number(maxUses) || 0,
        expiresAt: typeof expiresAt === 'string' ? expiresAt : '',
      });
      res.status(201).json(created);
    } catch (error: unknown) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to create coupon',
      });
    }
  });

  app.patch('/api/super/coupons/:id', requireAuth, requireSuper, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid coupon ID' });
      const active = typeof req.body?.active === 'boolean' ? req.body.active : undefined;
      const updated = await updateCouponStatus(id, { active });
      res.json(updated);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to update coupon';
      res.status(msg.includes('not found') ? 404 : 400).json({ error: msg });
    }
  });

  app.delete('/api/super/coupons/:id', requireAuth, requireSuper, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid coupon ID' });
      await deleteCouponById(id);
      res.json({ ok: true });
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to delete coupon',
      });
    }
  });

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

  app.post(
    '/api/super/point-rewards',
    requireAuth,
    requireSuper,
    async (req: AuthRequest, res) => {
      try {
        const config = await setPointRewardsConfig(req.body || {});
        res.json({ ...config, rewards: config });
      } catch (error: unknown) {
        res.status(400).json({
          error: error instanceof Error ? error.message : 'Failed to update point rewards configuration',
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

  app.get('/api/admin/refund-requests', requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    try {
      const rows = await listRefundRequestsForAdmin();
      res.json(rows);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load refund requests',
      });
    }
  });

  app.post(
    '/api/admin/refund-requests/:id/review',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      try {
        const requestId = Number(req.params.id);
        if (!Number.isFinite(requestId)) {
          return res.status(400).json({ error: 'Invalid refund request ID.' });
        }
        const action = req.body?.action === 'approve' ? 'approve' : req.body?.action === 'reject' ? 'reject' : null;
        if (!action) {
          return res.status(400).json({ error: 'Action must be approve or reject.' });
        }
        const adminNote = typeof req.body?.adminNote === 'string' ? req.body.adminNote : '';
        const updated = await reviewProRefundRequest({
          reviewerId: req.dbUser!.id,
          reviewerEmail: req.dbUser!.email,
          reviewerUsername: req.dbUser!.username,
          reviewerShortUid: req.dbUser!.shortUid,
          reviewerRole: req.dbUser!.role,
          requestId,
          action,
          adminNote,
        });
        res.json(updated);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Failed to review refund request';
        const status = msg.includes('not found') ? 404 : msg.includes('already') ? 400 : 500;
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

  // Exam Countdown Timers (Admin top-level + User custom)
  app.get('/api/countdowns', optionalAuth, async (req: AuthRequest, res) => {
    try {
      const rows = await listExamCountdowns(req.dbUser?.id);
      res.json(rows);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load exam countdowns',
      });
    }
  });

  app.post('/api/countdowns', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { title, category, targetDate, targetTime } = req.body || {};
      if (!title || !targetDate) {
        return res.status(400).json({ error: 'Countdown name and date are required.' });
      }
      const created = await createExamCountdown({
        userId: req.dbUser!.id,
        scope: 'user',
        title: String(title),
        category: typeof category === 'string' ? category : 'Personal Exam',
        targetDate: String(targetDate),
        targetTime: typeof targetTime === 'string' ? targetTime : '',
        pinnedByDefault: false,
        createdByLabel: req.dbUser!.username ? `@${req.dbUser!.username}` : req.dbUser!.displayName,
      });
      res.status(201).json(created);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to create countdown';
      res.status(msg.includes('required') || msg.includes('format') ? 400 : 500).json({ error: msg });
    }
  });

  app.delete('/api/countdowns/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid countdown ID' });
      const isAdmin = req.dbUser!.role === 'admin' || req.dbUser!.role === 'super';
      const deleted = await deleteExamCountdown(req.dbUser!.id, id, isAdmin);
      if (!deleted) return res.status(404).json({ error: 'Countdown not found.' });
      res.json({ ok: true });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to delete countdown';
      res.status(msg.includes('Only Admin') || msg.includes('only delete') ? 403 : 500).json({ error: msg });
    }
  });

  app.post('/api/admin/countdowns', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { title, category, targetDate, targetTime, pinnedByDefault } = req.body || {};
      if (!title || !targetDate) {
        return res.status(400).json({ error: 'Exam name and target date are required.' });
      }
      const created = await createExamCountdown({
        userId: null,
        scope: 'admin',
        title: String(title),
        category: typeof category === 'string' ? category : 'National Exam',
        targetDate: String(targetDate),
        targetTime: typeof targetTime === 'string' ? targetTime : '',
        pinnedByDefault: Boolean(pinnedByDefault),
        createdByLabel: req.dbUser!.username ? `@${req.dbUser!.username}` : req.dbUser!.displayName,
      });
      res.status(201).json(created);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to create top-level exam countdown';
      res.status(msg.includes('required') || msg.includes('format') ? 400 : 500).json({ error: msg });
    }
  });

  app.delete('/api/admin/countdowns/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid countdown ID' });
      const deleted = await deleteExamCountdown(req.dbUser!.id, id, true);
      if (!deleted) return res.status(404).json({ error: 'Countdown not found.' });
      res.json({ ok: true });
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to delete top-level exam countdown',
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

  // --- STUDY FORUM (GLOBAL ARENA, STUDY GROUPS, 1-TO-1 DMs, QUESTION SOLVER & REALTIME) ---
  app.get('/api/forum/attachments/:id/file', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid attachment ID' });
      const att = await getForumAttachmentForUser(id, req.dbUser!.id);
      if (!att) return res.status(404).json({ error: 'Attachment not found or access denied.' });
      const fullPath = path.resolve(UPLOADS_DIR, path.basename(att.storedFileName));
      if (!fullPath.startsWith(path.resolve(UPLOADS_DIR) + path.sep) || !fs.existsSync(fullPath)) {
        return res.status(404).json({ error: 'Attachment file missing.' });
      }
      res.setHeader('Content-Type', att.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${att.fileName.replace(/"/g, '')}"`);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.sendFile(fullPath);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to stream attachment',
      });
    }
  });

  app.get('/api/forum/events', requireAuth, async (req: AuthRequest, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const cleanup = await registerSseForumClient(req.dbUser!, res);
    req.on('close', () => {
      cleanup();
    });
  });

  app.get('/api/forum/rooms', requireAuth, async (req: AuthRequest, res) => {
    try {
      const rooms = await listUserForumRooms(req.dbUser!.id);
      res.json(rooms);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load forum rooms',
      });
    }
  });

  app.post('/api/forum/groups', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { title, description, subject, memberIds } = req.body || {};
      const room = await createForumGroupRoom({
        creatorId: req.dbUser!.id,
        title: String(title || ''),
        description: typeof description === 'string' ? description : '',
        subject: typeof subject === 'string' ? subject : 'General',
        memberIds: Array.isArray(memberIds) ? memberIds.map(Number) : [],
      });
      for (const m of room.members || []) {
        await subscribeUserToRoomRealtime(m.id, room.id);
        emitForumUserEvent(m.id, { type: 'room:created', room });
      }
      res.status(201).json(room);
    } catch (error: unknown) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to create study group',
      });
    }
  });

  app.post('/api/forum/groups/:id/members', requireAuth, async (req: AuthRequest, res) => {
    try {
      const roomId = Number(req.params.id);
      if (!Number.isFinite(roomId)) return res.status(400).json({ error: 'Invalid group ID' });
      const { memberIds } = req.body || {};
      const result = await addMembersToForumGroup({
        roomId,
        actorId: req.dbUser!.id,
        memberIds: Array.isArray(memberIds) ? memberIds.map(Number) : [],
      });
      for (const uid of result.addedUserIds) {
        await subscribeUserToRoomRealtime(uid, roomId);
        emitForumUserEvent(uid, { type: 'room:created', room: result.room });
      }
      res.json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to add group members';
      res.status(msg.includes('denied') ? 403 : 400).json({ error: msg });
    }
  });

  app.post('/api/forum/dm', requireAuth, async (req: AuthRequest, res) => {
    try {
      const targetUserId = Number(req.body?.targetUserId);
      if (!Number.isFinite(targetUserId)) {
        return res.status(400).json({ error: 'targetUserId is required.' });
      }
      const room = await getOrCreateDmRoom({
        userId: req.dbUser!.id,
        targetUserId,
      });
      await subscribeUserToRoomRealtime(req.dbUser!.id, room.id);
      await subscribeUserToRoomRealtime(targetUserId, room.id);
      emitForumUserEvent(targetUserId, { type: 'room:created', room });
      res.status(201).json(room);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to start direct chat';
      res.status(msg.includes('not found') ? 404 : 400).json({ error: msg });
    }
  });

  app.post('/api/forum/rooms/:id/read', requireAuth, async (req: AuthRequest, res) => {
    try {
      const roomId = Number(req.params.id);
      if (!Number.isFinite(roomId)) return res.status(400).json({ error: 'Invalid room ID' });
      await markForumRoomRead(roomId, req.dbUser!.id);
      res.json({ ok: true });
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to update read cursor',
      });
    }
  });

  app.get('/api/forum/rooms/:id/posts', requireAuth, async (req: AuthRequest, res) => {
    try {
      const roomId = Number(req.params.id);
      if (!Number.isFinite(roomId)) return res.status(400).json({ error: 'Invalid room ID' });
      const posts = await listForumRoomPosts({
        roomId,
        userId: req.dbUser!.id,
        postKind: typeof req.query.kind === 'string' ? req.query.kind : undefined,
        examBoard: typeof req.query.exam === 'string' ? req.query.exam : undefined,
        subject: typeof req.query.subject === 'string' ? req.query.subject : undefined,
        solved: typeof req.query.solved === 'string' ? req.query.solved : undefined,
      });
      res.json(posts);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to load forum posts';
      res.status(msg.includes('denied') ? 403 : 500).json({ error: msg });
    }
  });

  app.post('/api/forum/posts', requireAuth, async (req: AuthRequest, res) => {
    try {
      const {
        roomId,
        postKind,
        title,
        contentHtml,
        subject,
        examBoard,
        questionSpec,
        answerKey,
        officialExplanationHtml,
        attachmentIds,
      } = req.body || {};
      const parsedRoomId = Number(roomId);
      if (!Number.isFinite(parsedRoomId)) {
        return res.status(400).json({ error: 'roomId is required.' });
      }
      const created = await createForumPost({
        roomId: parsedRoomId,
        authorId: req.dbUser!.id,
        postKind: postKind === 'question' ? 'question' : 'message',
        title: String(title || ''),
        contentHtml: String(contentHtml || ''),
        subject: typeof subject === 'string' ? subject : undefined,
        examBoard: typeof examBoard === 'string' ? examBoard : undefined,
        questionSpec: questionSpec || null,
        answerKey: answerKey || null,
        officialExplanationHtml:
          typeof officialExplanationHtml === 'string' ? officialExplanationHtml : '',
        attachmentIds: Array.isArray(attachmentIds) ? attachmentIds.map(Number) : [],
      });
      emitForumRoomEvent(parsedRoomId, {
        type: 'post:created',
        roomId: parsedRoomId,
        post: { ...created, answerKey: null },
      });
      res.status(201).json(created);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to create post';
      res.status(msg.includes('denied') ? 403 : 400).json({ error: msg });
    }
  });

  app.get('/api/forum/posts/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const postId = Number(req.params.id);
      if (!Number.isFinite(postId)) return res.status(400).json({ error: 'Invalid post ID' });
      const post = await getForumPostDetail(postId, req.dbUser!.id);
      res.json(post);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to load post detail';
      res.status(msg.includes('access') ? 403 : msg.includes('not found') ? 404 : 500).json({
        error: msg,
      });
    }
  });

  app.post('/api/forum/posts/:id/attempt', requireAuth, async (req: AuthRequest, res) => {
    try {
      const postId = Number(req.params.id);
      if (!Number.isFinite(postId)) return res.status(400).json({ error: 'Invalid post ID' });
      const { attemptPayload } = req.body || {};
      const result = await submitQuestionAttempt({
        postId,
        userId: req.dbUser!.id,
        attemptPayload: attemptPayload || {},
      });
      emitForumRoomEvent(result.roomId, {
        type: 'attempt:created',
        roomId: result.roomId,
        postId,
        attemptCount: result.attemptCount,
      });
      res.status(201).json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to submit attempt';
      res.status(msg.includes('denied') ? 403 : 400).json({ error: msg });
    }
  });

  app.post('/api/forum/posts/:id/replies', requireAuth, async (req: AuthRequest, res) => {
    try {
      const postId = Number(req.params.id);
      if (!Number.isFinite(postId)) return res.status(400).json({ error: 'Invalid post ID' });
      const { parentReplyId, replyKind, contentHtml, attachmentIds, attemptPayload } =
        req.body || {};
      const kind =
        replyKind === 'solution' ||
        replyKind === 'refinement' ||
        replyKind === 'message'
          ? replyKind
          : 'opinion';
      const result = await createForumReply({
        postId,
        authorId: req.dbUser!.id,
        parentReplyId: parentReplyId ? Number(parentReplyId) : null,
        replyKind: kind,
        contentHtml: String(contentHtml || ''),
        attachmentIds: Array.isArray(attachmentIds) ? attachmentIds.map(Number) : [],
        attemptPayload: attemptPayload || null,
      });
      emitForumRoomEvent(result.roomId, {
        type: 'reply:created',
        roomId: result.roomId,
        postId,
        reply: result.reply,
      });
      res.status(201).json(result.reply);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to post reply';
      res.status(msg.includes('denied') ? 403 : 400).json({ error: msg });
    }
  });

  app.post('/api/forum/replies/:id/vote', requireAuth, async (req: AuthRequest, res) => {
    try {
      const replyId = Number(req.params.id);
      if (!Number.isFinite(replyId)) return res.status(400).json({ error: 'Invalid reply ID' });
      const result = await toggleForumReplyVote(replyId, req.dbUser!.id);
      emitForumRoomEvent(result.roomId, {
        type: 'reply:voted',
        roomId: result.roomId,
        postId: result.postId,
        replyId: result.replyId,
        upvoteCount: result.upvoteCount,
        userId: req.dbUser!.id,
        voted: result.voted,
      });
      res.json(result);
    } catch (error: unknown) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to toggle upvote',
      });
    }
  });

  app.post('/api/forum/posts/:id/satisfy', requireAuth, async (req: AuthRequest, res) => {
    try {
      const postId = Number(req.params.id);
      const replyId = Number(req.body?.replyId);
      if (!Number.isFinite(postId) || !Number.isFinite(replyId)) {
        return res.status(400).json({ error: 'Valid postId and replyId are required.' });
      }
      const result = await markForumReplySatisfactory({
        postId,
        replyId,
        actorUserId: req.dbUser!.id,
      });
      emitForumRoomEvent(result.roomId, {
        type: 'post:satisfied',
        roomId: result.roomId,
        postId: result.postId,
        replyId: result.replyId,
        solverUserId: result.solverUserId,
        pointsAwarded: result.pointsAwarded,
      });
      emitForumUserEvent(result.solverUserId, {
        type: 'points:updated',
        userId: result.solverUserId,
        points: result.solverNewPoints ?? 0,
        delta: result.pointsAwarded,
        reason: 'Forum Satisfactory Answer',
      });
      res.json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to mark answer satisfactory';
      const status = msg.includes('Only the question author') || msg.includes('Self-award') ? 403 : 400;
      res.status(status).json({ error: msg });
    }
  });

  app.get('/api/forum/highlights', optionalAuth, async (req: AuthRequest, res) => {
    try {
      const data = await getForumHighlights(req.dbUser?.id ?? null);
      res.json(data);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load forum highlights',
      });
    }
  });

  // --- FORMULA EQUATION CALCULATOR (Contributor-Defined Equations & Parameter Matching) ---
  app.get('/api/formula-access/status', requireAuth, async (req: AuthRequest, res) => {
    try {
      const status = await getFormulaAccessStatus(req.dbUser!);
      res.json(status);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to check formula access status',
      });
    }
  });

  app.post('/api/formula-access/start', requireAuth, async (req: AuthRequest, res) => {
    try {
      const couponCode =
        typeof req.body?.couponCode === 'string' ? req.body.couponCode : undefined;
      const status = await startFormulaMeteredSession(req.dbUser!, { couponCode });
      res.json(status);
    } catch (error: unknown) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to enable metered formula access',
      });
    }
  });

  app.post('/api/formula-access/renew', requireAuth, async (req: AuthRequest, res) => {
    try {
      const couponCode =
        typeof req.body?.couponCode === 'string' ? req.body.couponCode : undefined;
      const status = await renewFormulaMeteredSession(req.dbUser!, { couponCode });
      res.json(status);
    } catch (error: unknown) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to renew metered quarter',
      });
    }
  });

  app.post('/api/formula-access/stop', requireAuth, async (req: AuthRequest, res) => {
    try {
      const status = await stopFormulaMeteredSession(req.dbUser!);
      res.json(status);
    } catch (error: unknown) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to disable metered formula access',
      });
    }
  });

  app.post('/api/app-subscriptions/:id/cancel', requireAuth, async (req: AuthRequest, res) => {
    try {
      const subId = Number(req.params.id);
      if (!Number.isFinite(subId)) return res.status(400).json({ error: 'Invalid subscription ID' });
      const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
      const result = await cancelAppSubscription(req.dbUser!.id, subId, { reason });
      res.json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to cancel app subscription';
      res.status(msg.includes('not found') ? 404 : 400).json({ error: msg });
    }
  });

  app.post('/api/app-subscriptions/:id/extend', requireAuth, async (req: AuthRequest, res) => {
    try {
      const subId = Number(req.params.id);
      if (!Number.isFinite(subId)) return res.status(400).json({ error: 'Invalid subscription ID' });
      const { quarters, couponCode } = req.body || {};
      const result = await extendAppSubscription(req.dbUser!.id, subId, {
        quarters: Number(quarters) || 1,
        couponCode: typeof couponCode === 'string' ? couponCode : undefined,
      });
      res.json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to extend app subscription';
      res.status(msg.includes('not found') ? 404 : 400).json({ error: msg });
    }
  });

  app.get('/api/formulas', optionalAuth, async (_req, res) => {
    try {
      const rows = await listFormulaEquations();
      res.json(rows);
    } catch (error: unknown) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load formulas',
      });
    }
  });

  app.post('/api/formulas', requireAuth, async (req: AuthRequest, res) => {
    try {
      const isContributor =
        req.dbUser?.role === 'super' ||
        req.dbUser?.role === 'admin' ||
        (req.dbUser?.role === 'contributor' && req.dbUser?.contributorApproved);
      if (!isContributor) {
        return res.status(403).json({
          error: 'Defining formula equations requires approved Contributor, Admin, or Super role.',
        });
      }
      const { title, subject, caseName, expression, description, symbols } = req.body || {};
      const created = await createFormulaEquation({
        authorId: req.dbUser!.id,
        authorName: req.dbUser!.displayName,
        authorUsername: req.dbUser!.username,
        title: String(title || ''),
        subject: String(subject || 'General'),
        caseName: typeof caseName === 'string' && caseName.trim() ? caseName : 'General',
        expression: String(expression || ''),
        description: String(description || ''),
        symbols: Array.isArray(symbols) ? symbols : [],
      });
      res.status(201).json(created);
    } catch (error: unknown) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to create formula equation',
      });
    }
  });

  app.put('/api/formulas/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid formula ID' });
      const isAdminOrSuper = req.dbUser?.role === 'admin' || req.dbUser?.role === 'super';
      const updated = await updateFormulaEquation({
        id,
        actorId: req.dbUser!.id,
        isAdminOrSuper,
        ...(req.body?.title !== undefined ? { title: String(req.body.title) } : {}),
        ...(req.body?.subject !== undefined ? { subject: String(req.body.subject) } : {}),
        ...(req.body?.caseName !== undefined ? { caseName: String(req.body.caseName) } : {}),
        ...(req.body?.expression !== undefined ? { expression: String(req.body.expression) } : {}),
        ...(req.body?.description !== undefined ? { description: String(req.body.description) } : {}),
        ...(Array.isArray(req.body?.symbols) ? { symbols: req.body.symbols } : {}),
      });
      res.json(updated);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to update formula';
      res.status(msg.includes('Only the author') ? 403 : 400).json({ error: msg });
    }
  });

  app.delete('/api/formulas/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid formula ID' });
      const isAdminOrSuper = req.dbUser?.role === 'admin' || req.dbUser?.role === 'super';
      await deleteFormulaEquation(id, req.dbUser!.id, isAdminOrSuper);
      res.json({ ok: true });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to delete formula';
      res.status(msg.includes('Only the author') ? 403 : 400).json({ error: msg });
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

  // Inject official Google Analytics 4 tag into served HTML <head> when GA4_MEASUREMENT_ID is configured
  const injectGa4IntoHtml = (html: string): string => {
    const rawId = getPublicMeasurementId();
    if (!/^G-[A-Z0-9]+$/i.test(rawId)) return html;
    if (html.includes('googletagmanager.com/gtag/js')) return html;
    const safeId = rawId.toUpperCase();
    const snippet = `
    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=${safeId}" data-ga4="${safeId}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      window.gtag = gtag;
      window.__asanGa4Id = "${safeId}";
      gtag('js', new Date());
      gtag('config', "${safeId}", { send_page_view: false });
    </script>`;
    return html.replace('</head>', `${snippet}\n  </head>`);
  };

  // Public legal pages (accessible via /privacy-policy(.html) and /terms-of-service(.html) in dev & prod)
  const sendLegalPage = (filename: string, res: express.Response) => {
    const prodCandidate = path.resolve(__dirname, 'dist', filename);
    const devCandidate = path.resolve(__dirname, 'public', filename);
    const target = fs.existsSync(prodCandidate) && process.env.NODE_ENV === 'production' ? prodCandidate : devCandidate;
    if (fs.existsSync(target)) {
      res.status(200).sendFile(target);
    } else {
      res.status(404).send('Not found');
    }
  };
  app.get(['/privacy-policy', '/privacy-policy.html', '/privacy'], (_req, res) => {
    sendLegalPage('privacy-policy.html', res);
  });
  app.get(['/terms-of-service', '/terms-of-service.html', '/terms'], (_req, res) => {
    sendLegalPage('terms-of-service.html', res);
  });

  // Vite middleware for dev or static dist for production (Render Web Service + PWA)
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ...(process.env.DISABLE_HMR === 'true' ? { hmr: false } : {}),
      },
      appType: 'spa',
    });

    app.use(async (req, res, next) => {
      const reqPath = req.path || '/';
      const accept = String(req.headers.accept || '');
      const isHtmlRoute =
        req.method === 'GET' &&
        !reqPath.startsWith('/api/') &&
        !reqPath.startsWith('/@') &&
        !reqPath.startsWith('/src/') &&
        !reqPath.startsWith('/node_modules/') &&
        !path.extname(reqPath) &&
        accept.includes('text/html');

      if (!isHtmlRoute) {
        return next();
      }
      try {
        const indexPath = path.resolve(__dirname, 'index.html');
        const template = fs.readFileSync(indexPath, 'utf-8');
        const withGa4 = injectGa4IntoHtml(template);
        const transformed = await vite.transformIndexHtml(req.originalUrl, withGa4);
        res.status(200).set({ 'Content-Type': 'text/html; charset=utf-8' }).end(transformed);
      } catch (err) {
        vite.ssrFixStacktrace(err as Error);
        next(err);
      }
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(
      express.static(distPath, {
        index: false,
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
      const distIndex = path.join(distPath, 'index.html');
      try {
        const html = fs.readFileSync(distIndex, 'utf-8');
        res.status(200).set({ 'Content-Type': 'text/html; charset=utf-8' }).end(injectGa4IntoHtml(html));
      } catch {
        res.sendFile(distIndex);
      }
    });
  }

  const httpServer = http.createServer(app);
  attachForumWebSocketServer(httpServer);
  httpServer.listen(PORT, '0.0.0.0', () => {
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
