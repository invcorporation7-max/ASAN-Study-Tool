import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };
import { adminAuth } from '../lib/firebase-admin.ts';
import {
  ensureDatabaseSchema,
  getDatabaseStatus,
  isPostgresConfigured,
} from '../db/index.ts';
import { ADMIN_OWNER_EMAIL, isDbUnavailableError } from '../db/localStore.ts';
import { getOrCreateUser, getUserById } from '../db/users.ts';

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  `asan-study-${firebaseConfig.projectId || 'local'}-hmac-key`;

export interface AuthUserRecord {
  id: number;
  uid: string;
  shortUid: string;
  email: string;
  displayName: string;
  username: string;
  photoUrl: string;
  plan: string;
  viewPlanMode: string;
  role: string;
  authMode?: string;
  hasPassword?: boolean;
  points: number;
  infinitePoints?: boolean;
  proStartedAt: string;
  proExpiresAt: string;
  eliteStartedAt?: string;
  eliteExpiresAt?: string;
  eliteVisualEffects?: boolean;
  activeProGifted?: boolean;
  lastExpiryReminderFor: string;
  contributorApproved: boolean;
  contributorRequested: boolean;
  adminAuthorized: boolean;
  adminFirstGiftClaimed: boolean;
  lastWeeklyGrantWeek: string;
  spectraUrl: string;
  driveFolderId: string;
  scheduleSheetId: string;
}

export interface AuthRequest extends Request {
  user?: Partial<DecodedIdToken> & { uid: string; email?: string };
  dbUser?: AuthUserRecord;
  authMode?: 'google' | 'password';
}

export function signLocalSessionToken(payload: {
  userId: number;
  uid: string;
  email: string;
}): string {
  const body = {
    ...payload,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `local.${encoded}.${sig}`;
}

export function verifyLocalSessionToken(
  token: string
): { userId: number; uid: string; email: string } | null {
  try {
    if (!token || !token.startsWith('local.')) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [, encoded, sig] = parts;
    if (!encoded || !sig) return null;
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      userId: number;
      uid: string;
      email: string;
      exp: number;
    };
    if (!parsed.exp || Date.now() > parsed.exp || !parsed.userId || !parsed.uid) return null;
    return { userId: parsed.userId, uid: parsed.uid, email: parsed.email };
  } catch {
    return null;
  }
}

async function verifyFirebaseViaRest(idToken: string): Promise<{
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
} | null> {
  const apiKey =
    process.env.FIREBASE_WEB_API_KEY?.trim() ||
    process.env.VITE_FIREBASE_API_KEY?.trim() ||
    (firebaseConfig as { apiKey?: string }).apiKey;
  if (!apiKey || !idToken) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
        signal: ctrl.signal,
      }
    );
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as {
      users?: {
        localId: string;
        email?: string;
        displayName?: string;
        photoUrl?: string;
      }[];
    } | null;
    const u = data?.users?.[0];
    if (!u?.localId) return null;
    return {
      uid: u.localId,
      email: u.email,
      name: u.displayName,
      picture: u.photoUrl,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function authenticateBearerToken(token: string): Promise<{
  user: Partial<DecodedIdToken> & { uid: string; email?: string };
  dbUser: AuthUserRecord;
  authMode: 'google' | 'password';
} | null> {
  if (!token) return null;

  if (isPostgresConfigured() && !getDatabaseStatus().connected) {
    const connected = await ensureDatabaseSchema();
    if (!connected) {
      const err = new Error('Database is waking up / connecting. Please wait a moment...');
      (err as { code?: string }).code = 'DB_CONNECTING';
      throw err;
    }
  }

  if (token.startsWith('local.')) {
    const session = verifyLocalSessionToken(token);
    if (!session) return null;
    const existing = await getUserById(session.userId);
    if (!existing) return null;
    const synced = await getOrCreateUser(
      existing.uid,
      existing.email,
      existing.displayName,
      existing.photoUrl
    );
    return {
      user: { uid: synced.uid, email: synced.email },
      dbUser: { ...(synced as unknown as AuthUserRecord), authMode: 'password' },
      authMode: 'password',
    };
  }

  let verifiedUser: {
    uid: string;
    email?: string;
    name?: string;
    picture?: string;
  } | null = null;

  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    verifiedUser = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name,
      picture: decodedToken.picture,
    };
  } catch {
    verifiedUser = await verifyFirebaseViaRest(token);
  }

  if (!verifiedUser) return null;

  const dbUser = await getOrCreateUser(
    verifiedUser.uid,
    verifiedUser.email || '',
    verifiedUser.name || undefined,
    verifiedUser.picture || undefined
  );
  return {
    user: verifiedUser,
    dbUser: { ...(dbUser as unknown as AuthUserRecord), authMode: 'google' },
    authMode: 'google',
  };
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing sign-in token' });
  }

  const token = authHeader.split('Bearer ')[1];

  try {
    const authResult = await authenticateBearerToken(token);
    if (!authResult) {
      return res.status(401).json({
        error: token.startsWith('local.')
          ? 'Unauthorized: Password session expired or invalid. Please sign in again.'
          : 'Unauthorized: Session expired or invalid. Please refresh sign-in.',
      });
    }
    req.user = authResult.user;
    req.dbUser = authResult.dbUser;
    req.authMode = authResult.authMode;
    return next();
  } catch (error) {
    console.error('Error synchronizing user workspace profile:', error);
    if (
      (error as { code?: string })?.code === 'DB_CONNECTING' ||
      (isPostgresConfigured() && isDbUnavailableError(error))
    ) {
      return res.status(503).json({
        error: 'Database is waking up / connecting. Please wait a moment...',
        code: 'DB_CONNECTING',
        database: getDatabaseStatus(),
      });
    }
    return res.status(500).json({ error: 'Unable to load workspace profile. Please try again.' });
  }
};

export const optionalAuth = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }
  const token = authHeader.split('Bearer ')[1];
  if (!token) return next();

  if (token.startsWith('local.')) {
    const session = verifyLocalSessionToken(token);
    if (!session) return next();
    try {
      const existing = await getUserById(session.userId);
      if (!existing) return next();
      const synced = await getOrCreateUser(
        existing.uid,
        existing.email,
        existing.displayName,
        existing.photoUrl
      );
      req.user = { uid: synced.uid, email: synced.email };
      req.dbUser = { ...(synced as unknown as AuthUserRecord), authMode: 'password' };
      req.authMode = 'password';
    } catch {
      // fallback as guest
    }
    return next();
  }

  try {
    let verifiedUser: {
      uid: string;
      email?: string;
      name?: string;
      picture?: string;
    } | null = null;
    try {
      const decodedToken = await adminAuth.verifyIdToken(token);
      verifiedUser = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        name: decodedToken.name,
        picture: decodedToken.picture,
      };
    } catch {
      verifiedUser = await verifyFirebaseViaRest(token);
    }
    if (verifiedUser) {
      req.user = verifiedUser;
      req.authMode = 'google';
      const dbUser = await getOrCreateUser(
        verifiedUser.uid,
        verifiedUser.email || '',
        verifiedUser.name || undefined,
        verifiedUser.picture || undefined
      );
      req.dbUser = { ...(dbUser as unknown as AuthUserRecord), authMode: 'google' };
    }
  } catch {
    // ignore optional auth failures and treat as guest
  }
  return next();
};

export const requireAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (req.dbUser?.role !== 'admin' && req.dbUser?.role !== 'super') {
    return res.status(403).json({ error: 'Forbidden: Admin responsibility required.' });
  }
  next();
};

export const requireSuper = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const email = (req.dbUser?.email || '').trim().toLowerCase();
  if (req.dbUser?.role !== 'super' || email !== ADMIN_OWNER_EMAIL) {
    return res.status(403).json({
      error: `Forbidden: Super Developer Mode is restricted strictly to ${ADMIN_OWNER_EMAIL}.`,
    });
  }
  next();
};

