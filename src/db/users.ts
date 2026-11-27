import crypto from 'crypto';
import { desc, eq, or } from 'drizzle-orm';
import { db, isPostgresConfigured } from './index.ts';
import {
  ADMIN_OWNER_EMAIL,
  CONSTANT_ADMIN_LICENSE_KEY,
  getLocalStore,
  isDbUnavailableError,
  nextSeq,
  persistLocalStore,
  type StoreCoupon,
  type StoreUser,
} from './localStore.ts';
import {
  appSettings,
  appSubscriptions,
  coupons,
  licenseKeys,
  notebooks,
  notePages,
  notifications,
  planSubscriptions,
  pointTransactions,
  proRefundRequests,
  userMessages,
  users,
} from './schema.ts';
import {
  calculateCancellationRefund,
  calculatePlanQuote,
  ELITE_ANNUAL_TOTAL,
  ELITE_MONTHLY_TOTAL,
  INFINITE_POINTS_SENTINEL,
  isCouponCurrentlyValid,
  PLAN_PLATFORM_FEE,
  PRO_ANNUAL_TOTAL,
  PRO_MONTHLY_TOTAL,
  type CouponLike,
  type PricingTargetScope,
} from '../lib/pricing.ts';

import type { PointRewardsConfig, WorkspacePermissionsConfig } from '../types.ts';

function isValidFutureIso(iso?: string | null): boolean {
  if (!iso) return false;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) && ms > Date.now();
}

function isActiveProTenure(u: { plan?: string | null; proExpiresAt?: string | null }): boolean {
  if (u.proExpiresAt) return isValidFutureIso(u.proExpiresAt);
  return u.plan === 'pro';
}

function isActiveEliteTenure(u: { plan?: string | null; eliteExpiresAt?: string | null }): boolean {
  if (u.eliteExpiresAt) return isValidFutureIso(u.eliteExpiresAt);
  return u.plan === 'elite';
}

function isActivePaidPlanTenure(u: {
  plan?: string | null;
  proExpiresAt?: string | null;
  eliteExpiresAt?: string | null;
}): boolean {
  return isActiveEliteTenure(u) || isActiveProTenure(u);
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export const DEFAULT_CONTRIBUTOR_WEEKLY_POINTS = 120;

export const DEFAULT_POINT_REWARDS: PointRewardsConfig = {
  noteCreate: 0,
  calendarStudyEvent: 5,
  questionPaperUpload: 75,
  studyMaterialUpload: 0,
  examTimer30Min: 10,
  contributorWeekly: DEFAULT_CONTRIBUTOR_WEEKLY_POINTS,
  forumSatisfactoryAnswer: 25,
};

export const DEFAULT_WORKSPACE_PERMISSIONS: WorkspacePermissionsConfig = {
  driveSync: false,
  docsExport: false,
  sheetsSync: false,
  meetRooms: false,
};

export function parseWorkspacePermissions(
  raw: string | WorkspacePermissionsConfig | null | undefined
): WorkspacePermissionsConfig {
  if (!raw) return { ...DEFAULT_WORKSPACE_PERMISSIONS };
  if (typeof raw === 'object') {
    return {
      driveSync: raw.driveSync === true,
      docsExport: raw.docsExport === true,
      sheetsSync: raw.sheetsSync === true,
      meetRooms: raw.meetRooms === true,
    };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspacePermissionsConfig>;
    return {
      driveSync: parsed.driveSync === true,
      docsExport: parsed.docsExport === true,
      sheetsSync: parsed.sheetsSync === true,
      meetRooms: parsed.meetRooms === true,
    };
  } catch {
    return { ...DEFAULT_WORKSPACE_PERMISSIONS };
  }
}

export function sanitizeUserForClient<
  T extends {
    id: number;
    passwordHash?: string | null;
    hasPassword?: boolean;
    workspacePermissions?: string | WorkspacePermissionsConfig | null;
  }
>(
  user: T
): Omit<T, 'passwordHash' | 'workspacePermissions'> & {
  hasPassword: boolean;
  workspacePermissions: WorkspacePermissionsConfig;
} {
  const { passwordHash, workspacePermissions, ...rest } = user;
  return {
    ...rest,
    hasPassword: Boolean(user.hasPassword || (passwordHash && passwordHash.length > 0)),
    workspacePermissions: parseWorkspacePermissions(workspacePermissions),
  };
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    if (!storedHash || !storedHash.includes(':')) return false;
    const [salt, keyHex] = storedHash.split(':');
    if (!salt || !keyHex) return false;
    const derived = crypto.scryptSync(password, salt, 64);
    const keyBuf = Buffer.from(keyHex, 'hex');
    if (derived.length !== keyBuf.length) return false;
    return crypto.timingSafeEqual(derived, keyBuf);
  } catch {
    return false;
  }
}

function cleanRewardInt(val: unknown, fallback: number): number {
  const n = Math.round(Number(val));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100000, n));
}

export async function getPointRewardsConfig(): Promise<PointRewardsConfig> {
  try {
    const rows = await db.select().from(appSettings);
    const rewardsRow = rows.find((r) => r.key === 'point_rewards_config');
    const weeklyRow = rows.find((r) => r.key === 'contributor_weekly_points');
    const fallbackWeekly =
      weeklyRow && Number.isFinite(Number(weeklyRow.value))
        ? cleanRewardInt(weeklyRow.value, DEFAULT_CONTRIBUTOR_WEEKLY_POINTS)
        : DEFAULT_CONTRIBUTOR_WEEKLY_POINTS;
    if (!rewardsRow?.value) {
      return { ...DEFAULT_POINT_REWARDS, contributorWeekly: fallbackWeekly };
    }
    const parsed = JSON.parse(rewardsRow.value) as Partial<PointRewardsConfig>;
    return {
      noteCreate: cleanRewardInt(parsed.noteCreate, DEFAULT_POINT_REWARDS.noteCreate),
      calendarStudyEvent: cleanRewardInt(parsed.calendarStudyEvent, DEFAULT_POINT_REWARDS.calendarStudyEvent),
      questionPaperUpload: cleanRewardInt(parsed.questionPaperUpload, DEFAULT_POINT_REWARDS.questionPaperUpload),
      studyMaterialUpload: cleanRewardInt(parsed.studyMaterialUpload, DEFAULT_POINT_REWARDS.studyMaterialUpload),
      examTimer30Min: cleanRewardInt(parsed.examTimer30Min, DEFAULT_POINT_REWARDS.examTimer30Min),
      contributorWeekly: cleanRewardInt(parsed.contributorWeekly, fallbackWeekly),
      forumSatisfactoryAnswer: cleanRewardInt(
        parsed.forumSatisfactoryAnswer,
        DEFAULT_POINT_REWARDS.forumSatisfactoryAnswer
      ),
    };
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      return { ...DEFAULT_POINT_REWARDS };
    }
    const settings = getLocalStore().settings;
    const saved = settings?.pointRewards;
    const fallbackWeekly =
      typeof settings?.contributorWeeklyPoints === 'number'
        ? cleanRewardInt(settings.contributorWeeklyPoints, DEFAULT_CONTRIBUTOR_WEEKLY_POINTS)
        : DEFAULT_CONTRIBUTOR_WEEKLY_POINTS;
    if (!saved) {
      return { ...DEFAULT_POINT_REWARDS, contributorWeekly: fallbackWeekly };
    }
    return {
      noteCreate: cleanRewardInt(saved.noteCreate, DEFAULT_POINT_REWARDS.noteCreate),
      calendarStudyEvent: cleanRewardInt(saved.calendarStudyEvent, DEFAULT_POINT_REWARDS.calendarStudyEvent),
      questionPaperUpload: cleanRewardInt(saved.questionPaperUpload, DEFAULT_POINT_REWARDS.questionPaperUpload),
      studyMaterialUpload: cleanRewardInt(saved.studyMaterialUpload, DEFAULT_POINT_REWARDS.studyMaterialUpload),
      examTimer30Min: cleanRewardInt(saved.examTimer30Min, DEFAULT_POINT_REWARDS.examTimer30Min),
      contributorWeekly: cleanRewardInt(saved.contributorWeekly, fallbackWeekly),
      forumSatisfactoryAnswer: cleanRewardInt(
        saved.forumSatisfactoryAnswer,
        DEFAULT_POINT_REWARDS.forumSatisfactoryAnswer
      ),
    };
  }
}

export async function setPointRewardsConfig(
  updates: Partial<PointRewardsConfig>
): Promise<PointRewardsConfig> {
  const current = await getPointRewardsConfig();
  const next: PointRewardsConfig = {
    noteCreate: updates.noteCreate !== undefined ? cleanRewardInt(updates.noteCreate, current.noteCreate) : current.noteCreate,
    calendarStudyEvent:
      updates.calendarStudyEvent !== undefined
        ? cleanRewardInt(updates.calendarStudyEvent, current.calendarStudyEvent)
        : current.calendarStudyEvent,
    questionPaperUpload:
      updates.questionPaperUpload !== undefined
        ? cleanRewardInt(updates.questionPaperUpload, current.questionPaperUpload)
        : current.questionPaperUpload,
    studyMaterialUpload:
      updates.studyMaterialUpload !== undefined
        ? cleanRewardInt(updates.studyMaterialUpload, current.studyMaterialUpload)
        : current.studyMaterialUpload,
    examTimer30Min:
      updates.examTimer30Min !== undefined
        ? cleanRewardInt(updates.examTimer30Min, current.examTimer30Min)
        : current.examTimer30Min,
    contributorWeekly:
      updates.contributorWeekly !== undefined
        ? cleanRewardInt(updates.contributorWeekly, current.contributorWeekly)
        : current.contributorWeekly,
    forumSatisfactoryAnswer:
      updates.forumSatisfactoryAnswer !== undefined
        ? cleanRewardInt(updates.forumSatisfactoryAnswer, current.forumSatisfactoryAnswer)
        : current.forumSatisfactoryAnswer,
  };
  try {
    const now = new Date();
    await db
      .insert(appSettings)
      .values({
        key: 'point_rewards_config',
        value: JSON.stringify(next),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: JSON.stringify(next), updatedAt: now },
      });
    await db
      .insert(appSettings)
      .values({
        key: 'contributor_weekly_points',
        value: String(next.contributorWeekly),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: String(next.contributorWeekly), updatedAt: now },
      });
    return next;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    store.settings = {
      ...(store.settings || {}),
      contributorWeeklyPoints: next.contributorWeekly,
      pointRewards: next,
    };
    persistLocalStore();
    return next;
  }
}

export async function getContributorWeeklyPoints(): Promise<number> {
  const cfg = await getPointRewardsConfig();
  return cfg.contributorWeekly;
}

export async function setContributorWeeklyPoints(points: number): Promise<number> {
  const updated = await setPointRewardsConfig({ contributorWeekly: points });
  return updated.contributorWeekly;
}

export function getSundayWeekKey(date = new Date()): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay()); // Sunday = 0
  return d.toISOString().slice(0, 10);
}

export function generateLicenseKeyCode(length: 8 | 12 = 8): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function generate8CharKey(): string {
  return generateLicenseKeyCode(8);
}

export function generate12CharKey(): string {
  return generateLicenseKeyCode(12);
}

export function generate5CharUid(existing: Set<string> = new Set()): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 50; attempt++) {
    const bytes = crypto.randomBytes(5);
    let out = '';
    for (let i = 0; i < 5; i++) {
      out += alphabet[bytes[i] % alphabet.length];
    }
    if (!existing.has(out)) return out;
  }
  return crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5);
}

function addMonthsIso(fromDate: Date, months: number): string {
  const d = new Date(fromDate);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

function addYearsIso(fromDate: Date, years: number): string {
  const d = new Date(fromDate);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString();
}

function sanitizeUsernameBase(email: string, displayName?: string): string {
  const raw = (email.split('@')[0] || displayName || 'student')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '');
  return raw.slice(0, 24) || 'student';
}

// --- LOCAL STORE HELPERS ---
function localAwardPoints(
  userId: number,
  amount: number,
  reason: string,
  category: string
): StoreUser | undefined {
  const store = getLocalStore();
  const user = store.users.find((u) => u.id === userId);
  if (!user) return undefined;
  const intAmount = Math.round(amount);
  if (user.infinitePoints) {
    user.points = INFINITE_POINTS_SENTINEL;
  } else {
    user.points = Math.max(0, Math.round((user.points || 0) + intAmount));
  }
  user.updatedAt = new Date();
  store.pointTransactions.unshift({
    id: nextSeq('pointTransactions'),
    userId,
    amount: intAmount,
    reason,
    category,
    createdAt: new Date(),
  });
  persistLocalStore();
  return user;
}

function localPushNotification(params: {
  userId: number | null;
  senderId?: number | null;
  senderLabel?: string;
  title: string;
  message: string;
  type?: string;
}) {
  const store = getLocalStore();
  store.notifications.unshift({
    id: nextSeq('notifications'),
    userId: params.userId,
    senderId: params.senderId ?? null,
    senderLabel: params.senderLabel || 'ASAN System',
    title: params.title,
    message: params.message,
    type: params.type || 'info',
    isRead: false,
    createdAt: new Date(),
  });
  persistLocalStore();
}

function localSendSystemMail(params: {
  recipient: StoreUser;
  senderId?: number | null;
  senderEmail?: string;
  senderUsername?: string;
  senderLabel?: string;
  isAdminMail?: boolean;
  subject: string;
  body: string;
  notifTitle?: string;
  notifMessage?: string;
  notifType?: string;
}) {
  const store = getLocalStore();
  const now = new Date();
  store.userMessages.unshift({
    id: nextSeq('userMessages'),
    senderId: params.senderId || params.recipient.id,
    recipientId: params.recipient.id,
    senderEmail: params.senderEmail || ADMIN_OWNER_EMAIL,
    senderUsername: params.senderUsername || 'asan_system',
    recipientEmail: params.recipient.email,
    recipientUsername: params.recipient.username,
    visibility: 'direct',
    isAdminMail: Boolean(params.isAdminMail ?? true),
    recipientSummary: params.recipient.username
      ? `@${params.recipient.username}`
      : params.recipient.email,
    subject: params.subject,
    body: params.body,
    attachmentTitle: '',
    attachmentNoteId: null,
    isRead: false,
    createdAt: now,
  });

  localPushNotification({
    userId: params.recipient.id,
    senderId: params.senderId ?? null,
    senderLabel: params.senderLabel || 'ASAN System',
    title: params.notifTitle || params.subject,
    message: params.notifMessage || params.body.slice(0, 140),
    type: params.notifType || 'info',
  });
}

function localIssueProKeyForUser(params: {
  targetUser: StoreUser;
  issuedByUserId: number | null;
  subject: string;
  introText: string;
  durationMonths?: number;
  isAdminMail?: boolean;
  keyType?: 'pro' | 'elite';
  sourceType?: 'points' | 'admin_gift' | 'super_grant';
  noRefund?: boolean;
  purchaseCost?: number;
  platformFee?: number;
  couponCode?: string;
}) {
  const store = getLocalStore();
  const months = params.durationMonths === 12 ? 12 : 1;
  const keyType = params.keyType === 'elite' ? 'elite' : 'pro';
  const len = keyType === 'elite' ? 12 : 8;
  let keyCode = generateLicenseKeyCode(len);
  while (
    keyCode === CONSTANT_ADMIN_LICENSE_KEY ||
    store.licenseKeys.some((k) => k.keyCode === keyCode)
  ) {
    keyCode = generateLicenseKeyCode(len);
  }
  const now = new Date();
  const activationExpiresAt = addYearsIso(now, 1);
  const sourceType = params.sourceType || (params.noRefund ? 'admin_gift' : 'points');
  const noRefund = Boolean(params.noRefund ?? sourceType === 'admin_gift');

  const keyRec = {
    id: nextSeq('licenseKeys'),
    keyCode,
    keyType,
    durationMonths: months,
    sourceType,
    noRefund,
    purchaseCost: Math.max(0, Math.round(params.purchaseCost || 0)),
    platformFee: Math.max(0, Math.round(params.platformFee || 0)),
    couponCode: params.couponCode || '',
    issuedToUserId: params.targetUser.id,
    issuedToEmail: params.targetUser.email,
    issuedByUserId: params.issuedByUserId,
    activationExpiresAt,
    activatedByUserId: null,
    activatedAt: '',
    subStartsAt: '',
    subEndsAt: '',
    cancelledAt: '',
    status: 'unused',
    createdAt: now,
  };
  store.licenseKeys.unshift(keyRec);

  const tierLabel = keyType === 'elite' ? 'Elite' : 'Pro';
  const termLabel =
    months === 12
      ? `Annual ${tierLabel} (11 months + 1 month free)`
      : `Monthly ${tierLabel} (1 month)`;

  localSendSystemMail({
    recipient: params.targetUser,
    senderId: params.issuedByUserId || params.targetUser.id,
    senderLabel: 'ASAN Licensing',
    isAdminMail: Boolean(params.isAdminMail ?? true),
    subject: params.subject,
    body: `${params.introText}\n\n${tierLabel} License Key (${len} chars): ${keyCode}\nPlan Term: ${termLabel}\nUse Before: ${activationExpiresAt.slice(0, 10)}${
      noRefund ? '\nPolicy: Gifted Plan (No Refund on cancellation)' : ''
    }\n\nGo to Subscriptions and Plans -> Activate License Key to activate this key.`,
    notifTitle: params.subject,
    notifMessage: `Your ${len}-char ${tierLabel} key ${keyCode} is in Tool Mail.`,
    notifType: 'license',
  });

  persistLocalStore();
  return keyRec;
}

function localMaintainLifecycle(user: StoreUser): StoreUser {
  const store = getLocalStore();
  const now = new Date();
  let changed = false;

  if (!user.shortUid || user.shortUid.length !== 5) {
    const takenUids = new Set(store.users.map((u) => u.shortUid).filter(Boolean));
    user.shortUid = generate5CharUid(takenUids);
    changed = true;
  }
  if (!user.viewPlanMode) {
    user.viewPlanMode = 'auto';
    changed = true;
  }
  if (user.eliteVisualEffects === undefined) {
    user.eliteVisualEffects = true;
    changed = true;
  }

  if (user.email.toLowerCase() === ADMIN_OWNER_EMAIL) {
    if (user.role !== 'super' || !user.adminAuthorized) {
      user.role = 'super';
      user.adminAuthorized = true;
      changed = true;
    }
  } else if (user.role === 'super') {
    user.role = 'admin';
    changed = true;
  }

  // Check Elite expiration (falls back to active Pro if user kept Pro, else Basic)
  if (user.eliteExpiresAt) {
    const exp = new Date(user.eliteExpiresAt);
    if (!Number.isNaN(exp.getTime())) {
      const msLeft = exp.getTime() - now.getTime();
      const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
      if (msLeft < 0) {
        const hasValidPro = isValidFutureIso(user.proExpiresAt);
        user.eliteStartedAt = '';
        user.eliteExpiresAt = '';
        if (user.plan === 'elite') {
          user.plan = hasValidPro ? 'pro' : 'basic';
        }
        changed = true;
        localSendSystemMail({
          recipient: user,
          senderLabel: 'ASAN Subscriptions',
          subject: 'Your ASAN-Study_tool Elite Plan Has Expired',
          body: `Hello ${user.displayName},\n\nYour ASAN-Study_tool Elite membership ended on ${exp
            .toISOString()
            .slice(0, 10)}${hasValidPro ? ' and your kept Pro plan remains active.' : ' and your account switched back to Basic.'}\n\nRenew anytime in Subscriptions and Plans for ${ELITE_MONTHLY_TOTAL} points (Monthly) or ${ELITE_ANNUAL_TOTAL.toLocaleString()} points (Annual), or activate a 12-character Elite License Key.`,
          notifTitle: 'Elite Subscription Expired',
          notifMessage: hasValidPro
            ? 'Your Elite Plan expired; your kept Pro Plan remains active.'
            : 'Your Elite Plan expired and returned to Basic.',
          notifType: 'warning',
        });
      } else if (msLeft <= threeDaysMs && user.lastExpiryReminderFor !== user.eliteExpiresAt) {
        const daysLeft = Math.max(1, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
        user.lastExpiryReminderFor = user.eliteExpiresAt;
        changed = true;
        localSendSystemMail({
          recipient: user,
          senderLabel: 'ASAN Subscriptions',
          subject: `Renewal Reminder: Your Elite Plan Expires in ${daysLeft} Day(s)`,
          body: `Hello ${user.displayName},\n\nYour ASAN-Study_tool Elite Plan expires on ${exp
            .toISOString()
            .slice(0, 10)} (${daysLeft} day(s) remaining).\n\nRenew in Subscriptions and Plans for ${ELITE_MONTHLY_TOTAL} pts (Monthly) or ${ELITE_ANNUAL_TOTAL.toLocaleString()} pts (Annual).`,
          notifTitle: `Elite Expires in ${daysLeft} Day(s)`,
          notifMessage: `Your Elite plan expires on ${exp.toISOString().slice(0, 10)}.`,
          notifType: 'warning',
        });
      }
    }
  }

  // Check Pro expiration + 3-day reminder
  if (user.proExpiresAt) {
    const exp = new Date(user.proExpiresAt);
    if (!Number.isNaN(exp.getTime())) {
      const msLeft = exp.getTime() - now.getTime();
      const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
      if (msLeft < 0) {
        user.proStartedAt = '';
        user.proExpiresAt = '';
        user.activeProGifted = false;
        user.lastExpiryReminderFor = '';
        if (user.plan === 'pro') {
          user.plan = isValidFutureIso(user.eliteExpiresAt) ? 'elite' : 'basic';
        }
        changed = true;
        localSendSystemMail({
          recipient: user,
          senderLabel: 'ASAN Subscriptions',
          subject: 'Your ASAN-Study_tool Pro Plan Has Expired',
          body: `Hello ${user.displayName},\n\nYour ASAN-Study_tool Pro subscription ended on ${exp
            .toISOString()
            .slice(0, 10)}.\n\nRenew anytime in Subscriptions and Plans for ${PRO_MONTHLY_TOTAL} points (Monthly: 475 + 25 fee), ${PRO_ANNUAL_TOTAL.toLocaleString()} points (Annual: 11 months + 1 free + 25 fee), or activate an 8-character License Key.`,
          notifTitle: 'Pro Subscription Expired',
          notifMessage: `Your Pro Plan expired. Renew for ${PRO_MONTHLY_TOTAL} pts (Monthly) or ${PRO_ANNUAL_TOTAL.toLocaleString()} pts (Annual).`,
          notifType: 'warning',
        });
      } else if (
        user.plan === 'pro' &&
        msLeft <= threeDaysMs &&
        user.lastExpiryReminderFor !== user.proExpiresAt
      ) {
        const daysLeft = Math.max(1, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
        user.lastExpiryReminderFor = user.proExpiresAt;
        changed = true;
        localSendSystemMail({
          recipient: user,
          senderLabel: 'ASAN Subscriptions',
          subject: `Renewal Reminder: Your Pro Plan Expires in ${daysLeft} Day(s)`,
          body: `Hello ${user.displayName},\n\nYour ASAN-Study_tool Pro Plan expires on ${exp
            .toISOString()
            .slice(0, 10)} (${daysLeft} day(s) remaining).\n\nRenew in Subscriptions and Plans using ${PRO_MONTHLY_TOTAL} points (Monthly) or ${PRO_ANNUAL_TOTAL.toLocaleString()} points (Annual).`,
          notifTitle: `Pro Expires in ${daysLeft} Day(s)`,
          notifMessage: `Your Pro plan expires on ${exp.toISOString().slice(0, 10)}.`,
          notifType: 'warning',
        });
      }
    }
  }

  // Admin / Super first login gift: free 8-char Pro license key (non-refundable gift)
  if ((user.role === 'admin' || user.role === 'super') && !user.adminFirstGiftClaimed) {
    user.adminFirstGiftClaimed = true;
    changed = true;
    localIssueProKeyForUser({
      targetUser: user,
      issuedByUserId: user.id,
      subject: `Welcome ${user.role === 'super' ? 'Super Admin' : 'Admin'} — Free Pro License Key Gift`,
      introText:
        'As an authorized ASAN-Study_tool Admin, here is your complimentary 8-character Pro License Key along with your weekly 150-point stipend starting every Sunday.',
      durationMonths: 1,
      isAdminMail: true,
      keyType: 'pro',
      sourceType: 'admin_gift',
      noRefund: true,
    });
  }

  // Weekly Sunday Stipends
  const currentWeek = getSundayWeekKey(now);
  if (user.lastWeeklyGrantWeek !== currentWeek) {
    if (user.role === 'admin' || user.role === 'super') {
      user.lastWeeklyGrantWeek = currentWeek;
      changed = true;
      localAwardPoints(
        user.id,
        150,
        `Weekly Admin Stipend (Week of ${currentWeek})`,
        'weekly_admin'
      );
      localPushNotification({
        userId: user.id,
        title: '+150 Points Weekly Admin Stipend',
        message: `Sunday weekly admin reward (+150 pts) credited for week ${currentWeek}.`,
        type: 'points',
      });
    } else if (user.role === 'contributor' && user.contributorApproved) {
      const weeklyPts = store.settings?.contributorWeeklyPoints ?? DEFAULT_CONTRIBUTOR_WEEKLY_POINTS;
      if (weeklyPts > 0) {
        user.lastWeeklyGrantWeek = currentWeek;
        changed = true;
        localAwardPoints(
          user.id,
          weeklyPts,
          `Weekly Contributor Stipend (Week of ${currentWeek})`,
          'weekly_contributor'
        );
        localPushNotification({
          userId: user.id,
          title: `+${weeklyPts} Points Weekly Contributor Stipend`,
          message: `Your contributor work is admin-approved. +${weeklyPts} pts credited for week ${currentWeek}.`,
          type: 'points',
        });
      }
    }
  }

  store.licenseKeys.forEach((k) => {
    if (k.status === 'unused' && new Date(k.activationExpiresAt).getTime() < now.getTime()) {
      k.status = 'expired';
      changed = true;
    }
  });

  if (changed) {
    user.updatedAt = now;
    persistLocalStore();
  }
  return user;
}

// --- PUBLIC EXPORTED FUNCTIONS ---
export async function getOrCreateUser(
  uid: string,
  email: string,
  displayName?: string,
  photoUrl?: string
) {
  const normalizedEmail = email.trim();
  const isOwner = normalizedEmail.toLowerCase() === ADMIN_OWNER_EMAIL;

  try {
    const existingByUid = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
    let userRecord = existingByUid[0];
    if (!userRecord && normalizedEmail) {
      const allByEmail = await db.select().from(users);
      const byEmail = allByEmail.find(
        (u) => u.email.toLowerCase() === normalizedEmail.toLowerCase()
      );
      if (byEmail) {
        userRecord = byEmail;
      }
    }

    if (!userRecord) {
      const base = sanitizeUsernameBase(normalizedEmail, displayName);
      const allUsers = await db
        .select({ username: users.username, shortUid: users.shortUid })
        .from(users);
      const taken = new Set(allUsers.map((u) => u.username.toLowerCase()));
      const takenShortUids = new Set(allUsers.map((u) => u.shortUid).filter(Boolean));
      let candidate = base;
      let suffix = 1;
      while (taken.has(candidate)) {
        candidate = `${base}${suffix++}`;
      }
      const shortUid = generate5CharUid(takenShortUids);

      const [inserted] = await db
        .insert(users)
        .values({
          uid,
          shortUid,
          email: normalizedEmail,
          displayName: displayName || normalizedEmail.split('@')[0] || 'Student',
          username: candidate,
          photoUrl: photoUrl || '',
          plan: 'basic',
          viewPlanMode: 'auto',
          role: isOwner ? 'super' : 'user',
          authMode: 'google',
          points: 500,
          adminAuthorized: isOwner,
        })
        .returning();
      userRecord = inserted;

      await db.insert(pointTransactions).values({
        userId: userRecord.id,
        amount: 500,
        reason: 'Welcome Bonus (Initial Login Balance)',
        category: 'initial',
      });

      const [starterNotebook] = await db
        .insert(notebooks)
        .values({
          userId: userRecord.id,
          title: 'Academic Study Notebook',
          subject: 'Physics & Calculus',
          color: '#2563EB',
        })
        .returning();

      if (starterNotebook) {
        await db.insert(notePages).values({
          notebookId: starterNotebook.id,
          userId: userRecord.id,
          sectionName: 'Quick Start',
          title: 'A4 Study Document Guide',
          pagesData: [
            {
              id: 'page-1',
              pageNumber: 1,
              title: 'Page 1 — A4 Structured Notes',
              blocks: [
                {
                  id: 'b-1',
                  type: 'heading',
                  content: 'Welcome to ASAN-Study_tool A4 Notebooks',
                  fontSize: 16,
                },
                {
                  id: 'b-2',
                  type: 'text',
                  content:
                    'Write, paste images, add formulas, and distribute your notes across clean A4 pages. Export directly as a multi-page PDF or back up unlimited notes & tasks to your ASAN-user-content Google Drive folder.',
                  fontSize: 10,
                },
              ],
            },
          ],
        });
      }
    } else {
      let shortUid = userRecord.shortUid;
      if (!shortUid || shortUid.length !== 5) {
        const allU = await db.select({ shortUid: users.shortUid }).from(users);
        shortUid = generate5CharUid(new Set(allU.map((x) => x.shortUid).filter(Boolean)));
      }
      const shouldLinkGoogleUid = !uid.startsWith('pwd_') && userRecord.uid.startsWith('pwd_');
      const [updated] = await db
        .update(users)
        .set({
          ...(shouldLinkGoogleUid ? { uid } : {}),
          shortUid,
          email: normalizedEmail || userRecord.email,
          displayName: displayName || userRecord.displayName || 'Student',
          photoUrl: photoUrl || userRecord.photoUrl || '',
          ...(isOwner ? { role: 'super', adminAuthorized: true } : userRecord.role === 'super' ? { role: 'admin' } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userRecord.id))
        .returning();
      userRecord = updated;
    }

    // Check lifecycle (Elite & Pro expiration, 3-day reminder, admin first gift, weekly stipend) in SQL
    const now = new Date();
    if (userRecord.eliteExpiresAt) {
      const exp = new Date(userRecord.eliteExpiresAt);
      if (!Number.isNaN(exp.getTime())) {
        const msLeft = exp.getTime() - now.getTime();
        const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
        if (msLeft < 0) {
          const hasValidPro = isValidFutureIso(userRecord.proExpiresAt);
          const nextPlan =
            userRecord.plan === 'elite' ? (hasValidPro ? 'pro' : 'basic') : userRecord.plan;
          const [downgraded] = await db
            .update(users)
            .set({
              plan: nextPlan,
              eliteStartedAt: '',
              eliteExpiresAt: '',
              lastExpiryReminderFor: '',
              updatedAt: now,
            })
            .where(eq(users.id, userRecord.id))
            .returning();
          userRecord = downgraded;
          await db.insert(userMessages).values({
            senderId: userRecord.id,
            recipientId: userRecord.id,
            senderEmail: ADMIN_OWNER_EMAIL,
            senderUsername: 'asan_system',
            recipientEmail: userRecord.email,
            recipientUsername: userRecord.username,
            visibility: 'direct',
            isAdminMail: true,
            recipientSummary: `@${userRecord.username}`,
            subject: 'Your ASAN-Study_tool Elite Plan Has Expired',
            body: `Hello ${userRecord.displayName},\n\nYour Elite Plan expired on ${exp.toISOString().slice(0, 10)}.${
              hasValidPro ? ' Your kept Pro Plan remains active.' : ''
            }\nRenew in Subscriptions and Plans with ${ELITE_MONTHLY_TOTAL} points (Monthly), ${ELITE_ANNUAL_TOTAL.toLocaleString()} points (Annual), or a 12-character Elite License Key.`,
          });
          await db.insert(notifications).values({
            userId: userRecord.id,
            senderLabel: 'ASAN Subscriptions',
            title: 'Elite Subscription Expired',
            message: hasValidPro
              ? 'Your Elite Plan expired; your kept Pro Plan remains active.'
              : 'Your Elite Plan expired and returned to Basic.',
            type: 'warning',
          });
        } else if (msLeft <= threeDaysMs && userRecord.lastExpiryReminderFor !== userRecord.eliteExpiresAt) {
          const daysLeft = Math.max(1, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
          const [reminded] = await db
            .update(users)
            .set({ lastExpiryReminderFor: userRecord.eliteExpiresAt, updatedAt: now })
            .where(eq(users.id, userRecord.id))
            .returning();
          userRecord = reminded;
          await db.insert(userMessages).values({
            senderId: userRecord.id,
            recipientId: userRecord.id,
            senderEmail: ADMIN_OWNER_EMAIL,
            senderUsername: 'asan_system',
            recipientEmail: userRecord.email,
            recipientUsername: userRecord.username,
            visibility: 'direct',
            isAdminMail: true,
            recipientSummary: `@${userRecord.username}`,
            subject: `Renewal Reminder: Your Elite Plan Expires in ${daysLeft} Day(s)`,
            body: `Hello ${userRecord.displayName},\n\nYour ASAN-Study_tool Elite Plan expires on ${exp.toISOString().slice(0, 10)}. Renew in Subscriptions and Plans for ${ELITE_MONTHLY_TOTAL} pts (Monthly) or ${ELITE_ANNUAL_TOTAL.toLocaleString()} pts (Annual).`,
          });
          await db.insert(notifications).values({
            userId: userRecord.id,
            senderLabel: 'ASAN Subscriptions',
            title: `Elite Expires in ${daysLeft} Day(s)`,
            message: `Your Elite plan expires on ${exp.toISOString().slice(0, 10)}.`,
            type: 'warning',
          });
        }
      }
    }

    if (userRecord.proExpiresAt) {
      const exp = new Date(userRecord.proExpiresAt);
      if (!Number.isNaN(exp.getTime())) {
        const msLeft = exp.getTime() - now.getTime();
        const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
        if (msLeft < 0) {
          const nextPlan =
            userRecord.plan === 'pro'
              ? isValidFutureIso(userRecord.eliteExpiresAt)
                ? 'elite'
                : 'basic'
              : userRecord.plan;
          const [downgraded] = await db
            .update(users)
            .set({
              plan: nextPlan,
              proStartedAt: '',
              proExpiresAt: '',
              activeProGifted: false,
              lastExpiryReminderFor: '',
              updatedAt: now,
            })
            .where(eq(users.id, userRecord.id))
            .returning();
          userRecord = downgraded;
          await db.insert(userMessages).values({
            senderId: userRecord.id,
            recipientId: userRecord.id,
            senderEmail: ADMIN_OWNER_EMAIL,
            senderUsername: 'asan_system',
            recipientEmail: userRecord.email,
            recipientUsername: userRecord.username,
            visibility: 'direct',
            isAdminMail: true,
            recipientSummary: `@${userRecord.username}`,
            subject: 'Your ASAN-Study_tool Pro Plan Has Expired',
            body: `Hello ${userRecord.displayName},\n\nYour Pro Plan expired on ${exp.toISOString().slice(0, 10)}.\nRenew in Subscriptions and Plans with ${PRO_MONTHLY_TOTAL} points (Monthly: 475 + 25 fee), ${PRO_ANNUAL_TOTAL.toLocaleString()} points (Annual: 11 mos + 1 free + 25 fee), or an 8-character License Key.`,
          });
          await db.insert(notifications).values({
            userId: userRecord.id,
            senderLabel: 'ASAN Subscriptions',
            title: 'Pro Subscription Expired',
            message: `Your Pro Plan expired. Renew in Subscriptions and Plans (${PRO_MONTHLY_TOTAL} pts/mo or ${PRO_ANNUAL_TOTAL.toLocaleString()} pts/yr).`,
            type: 'warning',
          });
        } else if (
          userRecord.plan === 'pro' &&
          msLeft <= threeDaysMs &&
          userRecord.lastExpiryReminderFor !== userRecord.proExpiresAt
        ) {
          const daysLeft = Math.max(1, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
          const [reminded] = await db
            .update(users)
            .set({ lastExpiryReminderFor: userRecord.proExpiresAt, updatedAt: now })
            .where(eq(users.id, userRecord.id))
            .returning();
          userRecord = reminded;
          await db.insert(userMessages).values({
            senderId: userRecord.id,
            recipientId: userRecord.id,
            senderEmail: ADMIN_OWNER_EMAIL,
            senderUsername: 'asan_system',
            recipientEmail: userRecord.email,
            recipientUsername: userRecord.username,
            visibility: 'direct',
            isAdminMail: true,
            recipientSummary: `@${userRecord.username}`,
            subject: `Renewal Reminder: Your Pro Plan Expires in ${daysLeft} Day(s)`,
            body: `Hello ${userRecord.displayName},\n\nYour ASAN-Study_tool Pro Plan expires on ${exp.toISOString().slice(0, 10)}. Renew in Subscriptions and Plans with ${PRO_MONTHLY_TOTAL} pts (Monthly) or ${PRO_ANNUAL_TOTAL.toLocaleString()} pts (Annual).`,
          });
          await db.insert(notifications).values({
            userId: userRecord.id,
            senderLabel: 'ASAN Subscriptions',
            title: `Pro Expires in ${daysLeft} Day(s)`,
            message: `Your Pro plan expires on ${exp.toISOString().slice(0, 10)}. Renew in Subscriptions and Plans.`,
            type: 'warning',
          });
        }
      }
    }

    if ((userRecord.role === 'admin' || userRecord.role === 'super') && !userRecord.adminFirstGiftClaimed) {
      const giftKey = generate8CharKey();
      const activationExpiresAt = addYearsIso(now, 1);
      await db.insert(licenseKeys).values({
        keyCode: giftKey,
        keyType: 'pro',
        durationMonths: 1,
        sourceType: 'admin_gift',
        noRefund: true,
        purchaseCost: 0,
        platformFee: 0,
        couponCode: '',
        issuedToUserId: userRecord.id,
        issuedToEmail: userRecord.email,
        issuedByUserId: userRecord.id,
        activationExpiresAt,
        status: 'unused',
      });
      await db.insert(userMessages).values({
        senderId: userRecord.id,
        recipientId: userRecord.id,
        senderEmail: ADMIN_OWNER_EMAIL,
        senderUsername: 'asan_admin',
        recipientEmail: userRecord.email,
        recipientUsername: userRecord.username,
        visibility: 'direct',
        isAdminMail: true,
        recipientSummary: userRecord.username || userRecord.email,
        subject: `Welcome ${userRecord.role === 'super' ? 'Super Admin' : 'Admin'} — Free Pro License Key Gift`,
        body: `Your free 8-character Pro License Key: ${giftKey}\nUse Before: ${activationExpiresAt.slice(0, 10)} (1 month of Pro, No Refund policy on gifted plan).`,
      });
      const [u2] = await db
        .update(users)
        .set({ adminFirstGiftClaimed: true, updatedAt: now })
        .where(eq(users.id, userRecord.id))
        .returning();
      userRecord = u2;
    }

    const weekKey = getSundayWeekKey(now);
    if (userRecord.lastWeeklyGrantWeek !== weekKey) {
      const weeklyContributorPts = await getContributorWeeklyPoints();
      const stipend =
        userRecord.role === 'admin' || userRecord.role === 'super'
          ? 150
          : userRecord.role === 'contributor' && userRecord.contributorApproved
            ? weeklyContributorPts
            : 0;
      if (stipend > 0) {
        const nextPts = userRecord.infinitePoints
          ? INFINITE_POINTS_SENTINEL
          : Math.max(0, userRecord.points + stipend);
        const [u3] = await db
          .update(users)
          .set({
            points: nextPts,
            lastWeeklyGrantWeek: weekKey,
            updatedAt: now,
          })
          .where(eq(users.id, userRecord.id))
          .returning();
        userRecord = u3;
        await db.insert(pointTransactions).values({
          userId: userRecord.id,
          amount: stipend,
          reason:
            userRecord.role === 'admin' || userRecord.role === 'super'
              ? `Weekly Admin Stipend (Week of ${weekKey})`
              : `Weekly Contributor Stipend (Week of ${weekKey})`,
          category:
            userRecord.role === 'admin' || userRecord.role === 'super'
              ? 'weekly_admin'
              : 'weekly_contributor',
        });
      }
    }

    return userRecord;
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      console.error('getOrCreateUser failed:', error);
      throw new Error('Failed to synchronize user profile.', { cause: error });
    }
    if (isPostgresConfigured()) {
      const dbErr = new Error(
        'Database is waking up or temporarily unreachable. Please wait until connected.'
      ) as Error & { code?: string };
      dbErr.code = 'DB_CONNECTING';
      throw dbErr;
    }

    // Fallback to localStore (only when Postgres is not configured)
    const store = getLocalStore();
    let user =
      store.users.find((u) => u.uid === uid) ||
      (normalizedEmail
        ? store.users.find((u) => u.email.toLowerCase() === normalizedEmail.toLowerCase())
        : undefined);
    const now = new Date();
    if (!user) {
      const base = sanitizeUsernameBase(normalizedEmail, displayName);
      const taken = new Set(store.users.map((u) => u.username.toLowerCase()));
      const takenUids = new Set(store.users.map((u) => u.shortUid).filter(Boolean));
      let candidate = base;
      let suffix = 1;
      while (taken.has(candidate)) {
        candidate = `${base}${suffix++}`;
      }
      const shortUid = generate5CharUid(takenUids);
      const userId = nextSeq('users');
      user = {
        id: userId,
        uid,
        shortUid,
        email: normalizedEmail,
        displayName: displayName || normalizedEmail.split('@')[0] || 'Student',
        username: candidate,
        photoUrl: photoUrl || '',
        plan: 'basic',
        viewPlanMode: 'auto',
        role: isOwner ? 'super' : 'user',
        passwordHash: '',
        authMode: 'google',
        points: 500,
        infinitePoints: false,
        proStartedAt: '',
        proExpiresAt: '',
        eliteStartedAt: '',
        eliteExpiresAt: '',
        eliteVisualEffects: true,
        activeProGifted: false,
        lastExpiryReminderFor: '',
        contributorApproved: false,
        contributorRequested: false,
        adminAuthorized: isOwner,
        adminFirstGiftClaimed: false,
        lastWeeklyGrantWeek: '',
        spectraUrl: 'https://www.khanacademy.org',
        driveFolderId: '',
        scheduleSheetId: '',
        workspacePermissions: '',
        createdAt: now,
        updatedAt: now,
      };
      store.users.push(user);
      store.pointTransactions.unshift({
        id: nextSeq('pointTransactions'),
        userId,
        amount: 500,
        reason: 'Welcome Bonus (Initial Login Balance)',
        category: 'initial',
        createdAt: now,
      });

      const nbId = nextSeq('notebooks');
      store.notebooks.push({
        id: nbId,
        userId,
        title: 'Academic Study Notebook',
        subject: 'Physics & Calculus',
        color: '#2563EB',
        createdAt: now,
        updatedAt: now,
      });
      store.notePages.push({
        id: nextSeq('notePages'),
        notebookId: nbId,
        userId,
        sectionName: 'Quick Start',
        title: 'A4 Study Document Guide',
        pagesData: [
          {
            id: 'page-1',
            pageNumber: 1,
            title: 'Page 1 — A4 Structured Notes',
            blocks: [
              {
                id: 'b-1',
                type: 'heading',
                content: 'Welcome to ASAN-Study_tool A4 Notebooks',
                fontSize: 16,
              },
              {
                id: 'b-2',
                type: 'text',
                content:
                  'Write, paste images, add formulas, and distribute your notes across clean A4 pages. Export directly as a multi-page PDF or back up unlimited notes & tasks to your ASAN-user-content Google Drive folder.',
                fontSize: 10,
              },
            ],
          },
        ],
        createdAt: now,
        updatedAt: now,
      });
      persistLocalStore();
    } else {
      user.email = normalizedEmail || user.email;
      user.displayName = displayName || user.displayName || 'Student';
      user.photoUrl = photoUrl || user.photoUrl || '';
      if (isOwner) {
        user.role = 'super';
        user.adminAuthorized = true;
      } else if (user.role === 'super') {
        user.role = 'admin';
      }
      user.updatedAt = now;
      persistLocalStore();
    }

    return localMaintainLifecycle(user);
  }
}

export async function updateUserProfile(
  userId: number,
  updates: {
    displayName?: string;
    username?: string;
    spectraUrl?: string;
    driveFolderId?: string;
    scheduleSheetId?: string;
    viewPlanMode?: 'auto' | 'basic';
    eliteVisualEffects?: boolean;
    workspacePermissions?: Partial<WorkspacePermissionsConfig>;
  }
) {
  let cleanUsername: string | undefined;
  if (updates.username !== undefined) {
    cleanUsername = updates.username
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, '')
      .slice(0, 32);
    if (!cleanUsername || cleanUsername.length < 3) {
      throw new Error('Username must be at least 3 characters (letters, numbers, _, ., -).');
    }
  }

  try {
    if (cleanUsername) {
      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, cleanUsername));
      if (existing.some((r) => r.id !== userId)) {
        throw new Error(`Username "@${cleanUsername}" is already taken.`);
      }
    }
    const [currentUserRow] = await db
      .select({
        plan: users.plan,
        proExpiresAt: users.proExpiresAt,
        eliteExpiresAt: users.eliteExpiresAt,
        workspacePermissions: users.workspacePermissions,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (
      updates.viewPlanMode === 'basic' &&
      currentUserRow &&
      isActivePaidPlanTenure(currentUserRow)
    ) {
      throw new Error(
        'Active Pro and Elite plans cannot be paused back to Basic until their term expires or you cancel in Subscriptions and Plans.'
      );
    }

    let nextWorkspacePermJson: string | undefined;
    if (updates.workspacePermissions !== undefined) {
      const merged = {
        ...parseWorkspacePermissions(currentUserRow?.workspacePermissions),
        ...updates.workspacePermissions,
      };
      nextWorkspacePermJson = JSON.stringify({
        driveSync: merged.driveSync === true,
        docsExport: merged.docsExport === true,
        sheetsSync: merged.sheetsSync === true,
        meetRooms: merged.meetRooms === true,
      });
    }
    const [updated] = await db
      .update(users)
      .set({
        ...(updates.displayName !== undefined ? { displayName: updates.displayName } : {}),
        ...(cleanUsername !== undefined ? { username: cleanUsername } : {}),
        ...(updates.spectraUrl !== undefined ? { spectraUrl: updates.spectraUrl } : {}),
        ...(updates.driveFolderId !== undefined ? { driveFolderId: updates.driveFolderId } : {}),
        ...(updates.scheduleSheetId !== undefined ? { scheduleSheetId: updates.scheduleSheetId } : {}),
        ...(updates.viewPlanMode !== undefined ? { viewPlanMode: updates.viewPlanMode } : {}),
        ...(typeof updates.eliteVisualEffects === 'boolean'
          ? { eliteVisualEffects: updates.eliteVisualEffects }
          : {}),
        ...(nextWorkspacePermJson !== undefined ? { workspacePermissions: nextWorkspacePermJson } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      throw error instanceof Error ? error : new Error('Failed to update profile.', { cause: error });
    }
    const store = getLocalStore();
    const user = store.users.find((u) => u.id === userId);
    if (!user) throw new Error('User not found.');
    if (updates.viewPlanMode === 'basic' && isActivePaidPlanTenure(user)) {
      throw new Error(
        'Active Pro and Elite plans cannot be paused back to Basic until their term expires or you cancel in Subscriptions and Plans.'
      );
    }
    if (cleanUsername) {
      const clash = store.users.find(
        (u) => u.id !== userId && u.username.toLowerCase() === cleanUsername
      );
      if (clash) throw new Error(`Username "@${cleanUsername}" is already taken.`);
      user.username = cleanUsername;
    }
    if (updates.displayName !== undefined) user.displayName = updates.displayName;
    if (updates.spectraUrl !== undefined) user.spectraUrl = updates.spectraUrl;
    if (updates.driveFolderId !== undefined) user.driveFolderId = updates.driveFolderId;
    if (updates.scheduleSheetId !== undefined) user.scheduleSheetId = updates.scheduleSheetId;
    if (updates.viewPlanMode !== undefined) user.viewPlanMode = updates.viewPlanMode;
    if (typeof updates.eliteVisualEffects === 'boolean') {
      user.eliteVisualEffects = updates.eliteVisualEffects;
    }
    if (updates.workspacePermissions !== undefined) {
      const merged = {
        ...parseWorkspacePermissions(user.workspacePermissions),
        ...updates.workspacePermissions,
      };
      user.workspacePermissions = JSON.stringify({
        driveSync: merged.driveSync === true,
        docsExport: merged.docsExport === true,
        sheetsSync: merged.sheetsSync === true,
        meetRooms: merged.meetRooms === true,
      });
    }
    user.updatedAt = new Date();
    persistLocalStore();
    return user;
  }
}

export async function updateUserPlan(userId: number, plan: 'basic' | 'pro') {
  const now = new Date();
  const proStartedAt = plan === 'pro' ? now.toISOString() : '';
  const proExpiresAt = plan === 'pro' ? addMonthsIso(now, 1) : '';
  try {
    if (plan === 'basic') {
      const [existing] = await db
        .select({
          plan: users.plan,
          proExpiresAt: users.proExpiresAt,
          eliteExpiresAt: users.eliteExpiresAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (existing && isActivePaidPlanTenure(existing)) {
        throw new Error(
          'Pro and Elite plans cannot return to Basic until their term expires or you cancel in Subscriptions and Plans.'
        );
      }
    }
    const [updated] = await db
      .update(users)
      .set({ plan, viewPlanMode: 'auto', proStartedAt, proExpiresAt, updatedAt: now })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      throw error instanceof Error ? error : new Error('Failed to update plan.', { cause: error });
    }
    const store = getLocalStore();
    const user = store.users.find((u) => u.id === userId);
    if (!user) throw new Error('User not found.');
    if (plan === 'basic' && isActivePaidPlanTenure(user)) {
      throw new Error(
        'Pro and Elite plans cannot return to Basic until their term expires or you cancel in Subscriptions and Plans.'
      );
    }
    user.plan = plan;
    user.viewPlanMode = 'auto';
    user.proStartedAt = proStartedAt;
    user.proExpiresAt = proExpiresAt;
    user.updatedAt = now;
    persistLocalStore();
    return user;
  }
}

export async function listToolUsers() {
  try {
    const rows = await db
      .select({
        id: users.id,
        shortUid: users.shortUid,
        email: users.email,
        displayName: users.displayName,
        username: users.username,
        plan: users.plan,
        role: users.role,
        contributorApproved: users.contributorApproved,
      })
      .from(users);
    return rows;
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      throw new Error('Failed to load tool users.', { cause: error });
    }
    const store = getLocalStore();
    let changed = false;
    const taken = new Set(store.users.map((x) => x.shortUid).filter(Boolean));
    store.users.forEach((u) => {
      if (!u.shortUid || u.shortUid.length !== 5) {
        u.shortUid = generate5CharUid(taken);
        taken.add(u.shortUid);
        changed = true;
      }
    });
    if (changed) persistLocalStore();
    return store.users.map((u) => ({
      id: u.id,
      shortUid: u.shortUid,
      email: u.email,
      displayName: u.displayName,
      username: u.username,
      plan: u.plan,
      role: u.role,
      contributorApproved: u.contributorApproved,
    }));
  }
}

export async function listPublicCreditsContributors() {
  try {
    const rows = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        username: users.username,
        shortUid: users.shortUid,
        plan: users.plan,
        role: users.role,
        contributorApproved: users.contributorApproved,
        photoUrl: users.photoUrl,
      })
      .from(users);
    return rows.filter((u) => Boolean(u.contributorApproved));
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      throw new Error('Failed to load contributors list.', { cause: error });
    }
    return getLocalStore()
      .users.filter((u) => Boolean(u.contributorApproved))
      .map((u) => ({
        id: u.id,
        displayName: u.displayName,
        username: u.username,
        shortUid: u.shortUid,
        plan: u.plan,
        role: u.role,
        contributorApproved: u.contributorApproved,
        photoUrl: u.photoUrl,
      }));
  }
}

export async function awardPoints(
  userId: number,
  amount: number,
  reason: string,
  category: string
) {
  const intAmount = Math.round(amount);
  if (intAmount === 0) return null;
  try {
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) return null;
    const nextPoints = u.infinitePoints
      ? INFINITE_POINTS_SENTINEL
      : Math.max(0, Math.round(u.points + intAmount));
    const [updated] = await db
      .update(users)
      .set({ points: nextPoints, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    await db.insert(pointTransactions).values({
      userId,
      amount: intAmount,
      reason,
      category,
    });
    return updated;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    return localAwardPoints(userId, intAmount, reason, category) || null;
  }
}

export async function getPointTransactions(userId: number) {
  try {
    return await db
      .select()
      .from(pointTransactions)
      .where(eq(pointTransactions.userId, userId))
      .orderBy(desc(pointTransactions.createdAt));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    return getLocalStore().pointTransactions.filter((t) => t.userId === userId);
  }
}

// --- SUPER CONSOLE COUPONS ---
export async function listCoupons() {
  try {
    return await db.select().from(coupons).orderBy(desc(coupons.createdAt));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    return [...(getLocalStore().coupons || [])].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }
}

export async function createCoupon(
  superUserId: number,
  params: {
    code: string;
    description?: string;
    scope?: string;
    discountType?: string;
    discountValue: number;
    maxUses?: number;
    expiresAt?: string;
  }
) {
  const cleanCode = String(params.code || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 24);
  if (cleanCode.length < 3) {
    throw new Error('Coupon code must be 3 to 24 alphanumeric characters.');
  }
  const allowedScopes = new Set([
    'all',
    'all_plans',
    'pro_plan',
    'elite_plan',
    'apps_metered',
    'all_repository',
    'repository_rent',
    'repository_buy',
  ]);
  const scope = allowedScopes.has(String(params.scope || ''))
    ? String(params.scope)
    : 'all';
  const discountType = params.discountType === 'flat' ? 'flat' : 'percent';
  const rawVal = Math.round(Number(params.discountValue) || 0);
  const discountValue =
    discountType === 'percent' ? Math.max(1, Math.min(100, rawVal)) : Math.max(1, rawVal);
  const maxUses = Math.max(0, Math.round(Number(params.maxUses) || 0));
  const expiresAt = params.expiresAt ? String(params.expiresAt).trim().slice(0, 40) : '';
  const description = String(params.description || '').trim().slice(0, 200);

  try {
    const existing = await db
      .select({ id: coupons.id })
      .from(coupons)
      .where(eq(coupons.code, cleanCode))
      .limit(1);
    if (existing.length > 0) {
      throw new Error(`Coupon code "${cleanCode}" already exists.`);
    }
    const [created] = await db
      .insert(coupons)
      .values({
        code: cleanCode,
        description,
        scope,
        discountType,
        discountValue,
        maxUses,
        usedCount: 0,
        expiresAt,
        active: true,
        createdByUserId: superUserId,
      })
      .returning();
    return created;
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      throw error instanceof Error ? error : new Error('Failed to create coupon.');
    }
    const store = getLocalStore();
    const list = (store.coupons ||= []);
    if (list.some((c) => c.code.toUpperCase() === cleanCode)) {
      throw new Error(`Coupon code "${cleanCode}" already exists.`);
    }
    const created: StoreCoupon = {
      id: nextSeq('coupons'),
      code: cleanCode,
      description,
      scope,
      discountType,
      discountValue,
      maxUses,
      usedCount: 0,
      expiresAt,
      active: true,
      createdByUserId: superUserId,
      createdAt: new Date(),
    };
    list.unshift(created);
    persistLocalStore();
    return created;
  }
}

export async function updateCouponStatus(id: number, updates: { active?: boolean }) {
  try {
    const [updated] = await db
      .update(coupons)
      .set({
        ...(typeof updates.active === 'boolean' ? { active: updates.active } : {}),
      })
      .where(eq(coupons.id, id))
      .returning();
    if (!updated) throw new Error('Coupon not found.');
    return updated;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const row = (store.coupons || []).find((c) => c.id === id);
    if (!row) throw new Error('Coupon not found.');
    if (typeof updates.active === 'boolean') row.active = updates.active;
    persistLocalStore();
    return row;
  }
}

export async function deleteCouponById(id: number) {
  try {
    await db.delete(coupons).where(eq(coupons.id, id));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    store.coupons = (store.coupons || []).filter((c) => c.id !== id);
    persistLocalStore();
  }
}

export async function resolveValidCouponForScope(
  rawCode: string | undefined | null,
  targetScope: PricingTargetScope
): Promise<(CouponLike & { id: number }) | null> {
  const clean = String(rawCode || '').trim().toUpperCase();
  if (!clean) return null;
  let couponRow: (CouponLike & { id: number }) | undefined;
  try {
    const [found] = await db
      .select()
      .from(coupons)
      .where(eq(coupons.code, clean))
      .limit(1);
    couponRow = found;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    couponRow = (getLocalStore().coupons || []).find((c) => c.code.toUpperCase() === clean);
  }
  const check = isCouponCurrentlyValid(couponRow, targetScope);
  if (!check.valid || !couponRow) {
    throw new Error(check.reason || 'Invalid coupon code.');
  }
  return couponRow;
}

export async function incrementCouponUsage(couponId: number) {
  try {
    const [found] = await db.select().from(coupons).where(eq(coupons.id, couponId)).limit(1);
    if (!found) return;
    await db
      .update(coupons)
      .set({ usedCount: (found.usedCount || 0) + 1 })
      .where(eq(coupons.id, couponId));
  } catch (error) {
    if (!isDbUnavailableError(error)) return;
    const store = getLocalStore();
    const row = (store.coupons || []).find((c) => c.id === couponId);
    if (row) {
      row.usedCount = (row.usedCount || 0) + 1;
      persistLocalStore();
    }
  }
}

export async function getUserPlanSubscriptions(userId: number) {
  try {
    return await db
      .select()
      .from(planSubscriptions)
      .where(eq(planSubscriptions.userId, userId))
      .orderBy(desc(planSubscriptions.createdAt));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    return (getLocalStore().planSubscriptions || [])
      .filter((s) => s.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

export async function getUserAppSubscriptions(userId: number) {
  try {
    return await db
      .select()
      .from(appSubscriptions)
      .where(eq(appSubscriptions.userId, userId))
      .orderBy(desc(appSubscriptions.createdAt));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    return (getLocalStore().appSubscriptions || [])
      .filter((s) => s.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

export async function purchasePlanWithPoints(
  userId: number,
  termOrOpts:
    | 'monthly'
    | 'annual'
    | {
        tier?: 'pro' | 'elite';
        term?: 'monthly' | 'annual';
        couponCode?: string;
        proHandling?: 'keep' | 'cancel';
      } = 'monthly'
) {
  const opts =
    typeof termOrOpts === 'string'
      ? { tier: 'pro' as const, term: termOrOpts }
      : termOrOpts;
  const tier: 'pro' | 'elite' = opts.tier === 'elite' ? 'elite' : 'pro';
  const term: 'monthly' | 'annual' = opts.term === 'annual' ? 'annual' : 'monthly';
  const isAnnual = term === 'annual';
  const durationMonths = isAnnual ? 12 : 1;
  const targetScope: PricingTargetScope = tier === 'elite' ? 'elite_plan' : 'pro_plan';
  const coupon = opts.couponCode
    ? await resolveValidCouponForScope(opts.couponCode, targetScope)
    : null;
  const quote = calculatePlanQuote({ tier, term, coupon });
  const tierLabel = tier === 'elite' ? 'Elite' : 'Pro';
  const termLabel = isAnnual
    ? `Annual ${tierLabel} Plan (11 Months + 1 Free)`
    : `Monthly ${tierLabel} Plan (1 Month)`;
  const now = new Date();

  try {
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw new Error('User not found.');
    if (!u.infinitePoints && u.points < quote.finalCost) {
      throw new Error(
        `Insufficient points. Need ${quote.finalCost.toLocaleString()} points (you have ${u.points.toLocaleString()}).`
      );
    }

    const hasActivePro = isActiveProTenure(u);
    if (tier === 'elite' && hasActivePro && !opts.proHandling) {
      const err = new Error(
        'Elite membership includes all Pro features. Choose whether to keep your existing Pro tenure alongside Elite or cancel Pro.'
      ) as Error & { code?: string; proExpiresAt?: string };
      err.code = 'PRO_OVERLAP_CHOICE_REQUIRED';
      err.proExpiresAt = u.proExpiresAt || '';
      throw err;
    }

    const nextProFields: Partial<typeof users.$inferInsert> = {};
    if (tier === 'elite' && hasActivePro && opts.proHandling === 'cancel') {
      nextProFields.proStartedAt = '';
      nextProFields.proExpiresAt = '';
      nextProFields.activeProGifted = false;
      const existingSubs = await db
        .select()
        .from(planSubscriptions)
        .where(eq(planSubscriptions.userId, userId));
      for (const s of existingSubs) {
        if (s.tier === 'pro' && s.status === 'active') {
          await db
            .update(planSubscriptions)
            .set({ status: 'cancelled', cancelledAt: now.toISOString() })
            .where(eq(planSubscriptions.id, s.id));
        }
      }
      const selfKeys = await db
        .select()
        .from(licenseKeys)
        .where(eq(licenseKeys.activatedByUserId, userId));
      for (const k of selfKeys) {
        if (k.keyType === 'pro' && k.status === 'active') {
          await db
            .update(licenseKeys)
            .set({ status: 'cancelled', cancelledAt: now.toISOString() })
            .where(eq(licenseKeys.id, k.id));
        }
      }
    }

    let startsAt = now.toISOString();
    let expiresAt = addMonthsIso(now, durationMonths);
    if (tier === 'pro') {
      const baseStart =
        u.proExpiresAt && new Date(u.proExpiresAt) > now ? new Date(u.proExpiresAt) : now;
      startsAt = u.proStartedAt && isValidFutureIso(u.proExpiresAt) ? u.proStartedAt : now.toISOString();
      expiresAt = addMonthsIso(baseStart, durationMonths);
    } else {
      const baseStart =
        u.eliteExpiresAt && new Date(u.eliteExpiresAt) > now ? new Date(u.eliteExpiresAt) : now;
      startsAt =
        u.eliteStartedAt && isValidFutureIso(u.eliteExpiresAt) ? u.eliteStartedAt : now.toISOString();
      expiresAt = addMonthsIso(baseStart, durationMonths);
    }

    const nextPoints = u.infinitePoints
      ? INFINITE_POINTS_SENTINEL
      : Math.max(0, u.points - quote.finalCost);

    const [updated] = await db
      .update(users)
      .set({
        points: nextPoints,
        plan: tier === 'elite' || !isActiveEliteTenure(u) ? tier : 'elite',
        viewPlanMode: 'auto',
        ...(tier === 'pro'
          ? { proStartedAt: startsAt, proExpiresAt: expiresAt, activeProGifted: false }
          : { eliteStartedAt: startsAt, eliteExpiresAt: expiresAt }),
        ...nextProFields,
        lastExpiryReminderFor: '',
        updatedAt: now,
      })
      .where(eq(users.id, userId))
      .returning();

    await db.insert(planSubscriptions).values({
      userId,
      tier,
      term,
      sourceType: 'points',
      keyCode: '',
      noRefund: false,
      baseCost: quote.baseSubtotal,
      platformFee: quote.platformFee,
      couponCode: quote.appliedCouponCode,
      totalCost: quote.finalCost,
      status: 'active',
      startedAt: startsAt,
      expiresAt,
      cancelledAt: '',
      refundAmount: 0,
    });

    await db.insert(pointTransactions).values({
      userId,
      amount: -quote.finalCost,
      reason: `${termLabel} (${quote.finalCost} pts incl. ${quote.platformFee} fee${
        quote.appliedCouponCode ? `, coupon ${quote.appliedCouponCode}` : ''
      })`,
      category: tier === 'elite' ? 'elite_purchase' : 'pro_purchase',
    });

    if (coupon?.id) await incrementCouponUsage(coupon.id);

    await db.insert(userMessages).values({
      senderId: userId,
      recipientId: userId,
      senderEmail: ADMIN_OWNER_EMAIL,
      senderUsername: 'asan_billing',
      recipientEmail: u.email,
      recipientUsername: u.username,
      visibility: 'direct',
      isAdminMail: true,
      recipientSummary: `@${u.username}`,
      subject: `${tierLabel} Plan Purchase Confirmation — ${termLabel}`,
      body: `Hello ${u.displayName},\n\nThank you for upgrading to ASAN-Study_tool ${termLabel}.\n\nBase Cost: ${quote.baseSubtotal} pts\nPlatform Fee (Non-Refundable): ${quote.platformFee} pts${
        quote.couponDiscount > 0 ? `\nCoupon (${quote.appliedCouponCode}): -${quote.couponDiscount} pts` : ''
      }\nTotal Paid: ${quote.finalCost.toLocaleString()} pts\nActive Until: ${expiresAt.slice(0, 10)}`,
    });
    await db.insert(notifications).values({
      userId,
      senderLabel: 'Subscriptions',
      title: `${isAnnual ? 'Annual' : 'Monthly'} ${tierLabel} Activated`,
      message: `${tierLabel} active until ${expiresAt.slice(0, 10)} (${quote.finalCost.toLocaleString()} pts).`,
      type: 'subscription',
    });
    return updated;
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      throw error instanceof Error ? error : new Error(`Failed to activate ${tierLabel}.`);
    }
    const store = getLocalStore();
    const u = store.users.find((x) => x.id === userId);
    if (!u) throw new Error('User not found.');
    if (!u.infinitePoints && u.points < quote.finalCost) {
      throw new Error(
        `Insufficient points. Need ${quote.finalCost.toLocaleString()} points (you have ${u.points.toLocaleString()}).`
      );
    }

    const hasActivePro = isActiveProTenure(u);
    if (tier === 'elite' && hasActivePro && !opts.proHandling) {
      const err = new Error(
        'Elite membership includes all Pro features. Choose whether to keep your existing Pro tenure alongside Elite or cancel Pro.'
      ) as Error & { code?: string; proExpiresAt?: string };
      err.code = 'PRO_OVERLAP_CHOICE_REQUIRED';
      err.proExpiresAt = u.proExpiresAt || '';
      throw err;
    }

    if (tier === 'elite' && hasActivePro && opts.proHandling === 'cancel') {
      u.proStartedAt = '';
      u.proExpiresAt = '';
      u.activeProGifted = false;
      (store.planSubscriptions || []).forEach((s) => {
        if (s.userId === userId && s.tier === 'pro' && s.status === 'active') {
          s.status = 'cancelled';
          s.cancelledAt = now.toISOString();
        }
      });
      store.licenseKeys.forEach((k) => {
        if (k.activatedByUserId === userId && k.keyType === 'pro' && k.status === 'active') {
          k.status = 'cancelled';
          k.cancelledAt = now.toISOString();
        }
      });
    }

    let startsAt = now.toISOString();
    let expiresAt = addMonthsIso(now, durationMonths);
    if (tier === 'pro') {
      const baseStart =
        u.proExpiresAt && new Date(u.proExpiresAt) > now ? new Date(u.proExpiresAt) : now;
      startsAt = u.proStartedAt && isValidFutureIso(u.proExpiresAt) ? u.proStartedAt : now.toISOString();
      expiresAt = addMonthsIso(baseStart, durationMonths);
      u.proStartedAt = startsAt;
      u.proExpiresAt = expiresAt;
      u.activeProGifted = false;
    } else {
      const baseStart =
        u.eliteExpiresAt && new Date(u.eliteExpiresAt) > now ? new Date(u.eliteExpiresAt) : now;
      startsAt =
        u.eliteStartedAt && isValidFutureIso(u.eliteExpiresAt) ? u.eliteStartedAt : now.toISOString();
      expiresAt = addMonthsIso(baseStart, durationMonths);
      u.eliteStartedAt = startsAt;
      u.eliteExpiresAt = expiresAt;
    }

    u.points = u.infinitePoints
      ? INFINITE_POINTS_SENTINEL
      : Math.max(0, u.points - quote.finalCost);
    u.plan = tier === 'elite' || !isActiveEliteTenure(u) ? tier : 'elite';
    u.viewPlanMode = 'auto';
    u.lastExpiryReminderFor = '';
    u.updatedAt = now;

    if (!store.planSubscriptions) store.planSubscriptions = [];
    store.planSubscriptions.unshift({
      id: nextSeq('planSubscriptions'),
      userId,
      tier,
      term,
      sourceType: 'points',
      keyCode: '',
      noRefund: false,
      baseCost: quote.baseSubtotal,
      platformFee: quote.platformFee,
      couponCode: quote.appliedCouponCode,
      totalCost: quote.finalCost,
      status: 'active',
      startedAt: startsAt,
      expiresAt,
      cancelledAt: '',
      refundAmount: 0,
      createdAt: now,
    });

    store.pointTransactions.unshift({
      id: nextSeq('pointTransactions'),
      userId,
      amount: -quote.finalCost,
      reason: `${termLabel} (${quote.finalCost} pts incl. ${quote.platformFee} fee)`,
      category: tier === 'elite' ? 'elite_purchase' : 'pro_purchase',
      createdAt: now,
    });
    if (coupon?.id) await incrementCouponUsage(coupon.id);

    localSendSystemMail({
      recipient: u,
      senderLabel: 'Subscriptions',
      subject: `${tierLabel} Plan Purchase Confirmation — ${termLabel}`,
      body: `Hello ${u.displayName},\n\nPoints Deducted: ${quote.finalCost.toLocaleString()} pts (incl. ${quote.platformFee} non-refundable fee)\nActive Until: ${expiresAt.slice(0, 10)}.`,
      notifTitle: `${isAnnual ? 'Annual' : 'Monthly'} ${tierLabel} Activated`,
      notifMessage: `${tierLabel} active until ${expiresAt.slice(0, 10)} (${quote.finalCost.toLocaleString()} pts).`,
      notifType: 'subscription',
    });
    persistLocalStore();
    return u;
  }
}

export async function purchaseProWithPoints(
  userId: number,
  term: 'monthly' | 'annual' = 'monthly'
) {
  return purchasePlanWithPoints(userId, { tier: 'pro', term });
}

export async function generateProLicenseKey(params: {
  issuedByUserId: number;
  targetEmailOrUsername?: string;
  chargePoints?: boolean;
  term?: 'monthly' | 'annual';
  keyType?: 'pro' | 'elite';
  couponCode?: string;
  sourceType?: 'points' | 'admin_gift' | 'super_grant';
}) {
  const keyType: 'pro' | 'elite' = params.keyType === 'elite' ? 'elite' : 'pro';
  if (keyType === 'elite' && !params.chargePoints) {
    throw new Error('Elite 12-character license keys can only be purchased using points.');
  }
  const isAnnual = params.term === 'annual';
  const durationMonths = isAnnual ? 12 : 1;
  const targetScope: PricingTargetScope = keyType === 'elite' ? 'elite_plan' : 'pro_plan';
  const coupon =
    params.chargePoints && params.couponCode
      ? await resolveValidCouponForScope(params.couponCode, targetScope)
      : null;
  const quote = params.chargePoints
    ? calculatePlanQuote({ tier: keyType, term: isAnnual ? 'annual' : 'monthly', coupon })
    : {
        baseSubtotal: 0,
        platformFee: 0,
        tierDiscountPercent: 0,
        tierDiscountAmount: 0,
        couponDiscount: 0,
        totalBeforeDiscount: 0,
        finalCost: 0,
        appliedCouponCode: '',
      };

  const sourceType = params.sourceType || (params.chargePoints ? 'points' : 'admin_gift');
  const noRefund = !params.chargePoints || sourceType === 'admin_gift';
  const len = keyType === 'elite' ? 12 : 8;
  const tierLabel = keyType === 'elite' ? 'Elite' : 'Pro';
  const now = new Date();
  const activationExpiresAt = addYearsIso(now, 1);

  try {
    const [issuer] = await db
      .select()
      .from(users)
      .where(eq(users.id, params.issuedByUserId))
      .limit(1);
    if (!issuer) throw new Error('Account not found.');

    if (params.chargePoints && !issuer.infinitePoints && issuer.points < quote.finalCost) {
      throw new Error(
        `Insufficient points. Need ${quote.finalCost.toLocaleString()} points to purchase an ${
          isAnnual ? 'Annual' : 'Monthly'
        } ${tierLabel} License Key.`
      );
    }

    let target = issuer;
    if (params.targetEmailOrUsername && params.targetEmailOrUsername.trim()) {
      const raw = params.targetEmailOrUsername.trim();
      const q = raw.toLowerCase().replace(/^@/, '');
      const all = await db.select().from(users);
      const found = all.find(
        (u) =>
          u.email.toLowerCase() === q ||
          u.username.toLowerCase() === q ||
          (u.shortUid && u.shortUid.toUpperCase() === raw.toUpperCase())
      );
      if (!found) {
        throw new Error(`Registered user "${params.targetEmailOrUsername}" not found.`);
      }
      target = found;
    }

    if (params.chargePoints) {
      const nextPts = issuer.infinitePoints
        ? INFINITE_POINTS_SENTINEL
        : Math.max(0, issuer.points - quote.finalCost);
      await db
        .update(users)
        .set({ points: nextPts, updatedAt: now })
        .where(eq(users.id, issuer.id));
      await db.insert(pointTransactions).values({
        userId: issuer.id,
        amount: -quote.finalCost,
        reason: `Purchased ${len}-char ${isAnnual ? 'Annual' : 'Monthly'} ${tierLabel} Key for ${target.email}`,
        category: keyType === 'elite' ? 'elite_key_purchase' : 'pro_key_purchase',
      });
      if (coupon?.id) await incrementCouponUsage(coupon.id);
    }

    const keyCode = generateLicenseKeyCode(len);
    const [createdKey] = await db
      .insert(licenseKeys)
      .values({
        keyCode,
        keyType,
        durationMonths,
        sourceType,
        noRefund,
        purchaseCost: quote.finalCost,
        platformFee: quote.platformFee,
        couponCode: quote.appliedCouponCode,
        issuedToUserId: target.id,
        issuedToEmail: target.email,
        issuedByUserId: issuer.id,
        activationExpiresAt,
        status: 'unused',
      })
      .returning();

    await db.insert(userMessages).values({
      senderId: issuer.id,
      recipientId: target.id,
      senderEmail: issuer.email,
      senderUsername: issuer.username,
      recipientEmail: target.email,
      recipientUsername: target.username,
      visibility: 'direct',
      isAdminMail: issuer.role === 'admin' || issuer.role === 'super',
      recipientSummary: target.username || target.email,
      subject: `Your ASAN-Study_tool ${len}-Character ${tierLabel} License Key (${keyCode})`,
      body: `${tierLabel} License Key: ${keyCode}\nPlan Term: ${
        isAnnual
          ? `Annual ${tierLabel} (11 months + 1 month free)`
          : `Monthly ${tierLabel} (1 month)`
      }\nUse Before: ${activationExpiresAt.slice(0, 10)}${
        noRefund ? '\nPolicy: Gifted Key — No Refund upon cancellation.' : ''
      }\n\nEnter this key in Subscriptions and Plans -> Activate License Key.`,
    });

    await db.insert(notifications).values({
      userId: target.id,
      senderId: issuer.id,
      senderLabel: issuer.role === 'admin' || issuer.role === 'super' ? 'Admin Licensing' : 'Subscriptions',
      title: `${tierLabel} License Key Sent (${keyCode})`,
      message: `Check Tool Mail for your ${len}-character ${tierLabel} key ${keyCode}.`,
      type: 'license',
    });

    return { key: createdKey, recipientEmail: target.email };
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      throw error instanceof Error ? error : new Error('Failed to generate license key.');
    }
    const store = getLocalStore();
    const issuer = store.users.find((u) => u.id === params.issuedByUserId);
    if (!issuer) throw new Error('Account not found.');
    if (params.chargePoints && !issuer.infinitePoints && issuer.points < quote.finalCost) {
      throw new Error(
        `Insufficient points. Need ${quote.finalCost.toLocaleString()} points to purchase an ${
          isAnnual ? 'Annual' : 'Monthly'
        } ${tierLabel} License Key.`
      );
    }

    let target = issuer;
    if (params.targetEmailOrUsername && params.targetEmailOrUsername.trim()) {
      const raw = params.targetEmailOrUsername.trim();
      const q = raw.toLowerCase().replace(/^@/, '');
      const found = store.users.find(
        (u) =>
          u.email.toLowerCase() === q ||
          u.username.toLowerCase() === q ||
          (u.shortUid && u.shortUid.toUpperCase() === raw.toUpperCase())
      );
      if (!found) {
        throw new Error(`Registered user "${params.targetEmailOrUsername}" not found.`);
      }
      target = found;
    }

    if (params.chargePoints) {
      localAwardPoints(
        issuer.id,
        -quote.finalCost,
        `Purchased ${len}-char ${isAnnual ? 'Annual' : 'Monthly'} ${tierLabel} Key for ${target.email}`,
        keyType === 'elite' ? 'elite_key_purchase' : 'pro_key_purchase'
      );
      if (coupon?.id) await incrementCouponUsage(coupon.id);
    }

    const createdKey = localIssueProKeyForUser({
      targetUser: target,
      issuedByUserId: issuer.id,
      subject: `Your ASAN-Study_tool ${len}-Character ${tierLabel} License Key (@${target.username})`,
      introText: `Your ASAN-Study_tool ${
        isAnnual ? 'Annual (11 months + 1 free)' : 'Monthly (1 month)'
      } ${tierLabel} License Key has been issued.`,
      durationMonths,
      isAdminMail: issuer.role === 'admin' || issuer.role === 'super',
      keyType,
      sourceType,
      noRefund,
      purchaseCost: quote.finalCost,
      platformFee: quote.platformFee,
      couponCode: quote.appliedCouponCode,
    });
    return { key: createdKey, recipientEmail: target.email };
  }
}

export async function redeemLicenseKey(
  userId: number,
  rawKeyCode: string,
  proHandling?: 'keep' | 'cancel'
) {
  const keyCode = rawKeyCode.trim().toUpperCase();
  if (keyCode.length !== 8 && keyCode.length !== 12) {
    throw new Error('License keys must be 8 characters (Pro) or 12 characters (Elite).');
  }
  const now = new Date();

  try {
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw new Error('User not found.');

    if (keyCode === CONSTANT_ADMIN_LICENSE_KEY) {
      if (!u.adminAuthorized && u.email.toLowerCase() !== ADMIN_OWNER_EMAIL) {
        throw new Error(
          'Admin access is strictly hand-selected by the workspace owner. Public Admin claims are disabled.'
        );
      }
      const [updated] = await db
        .update(users)
        .set({ role: 'admin', adminAuthorized: true, updatedAt: now })
        .where(eq(users.id, userId))
        .returning();
      const refreshed = await getOrCreateUser(updated.uid, updated.email, updated.displayName, updated.photoUrl);
      return { user: refreshed, kind: 'admin' as const, message: 'Admin responsibility activated.' };
    }

    const [keyRow] = await db
      .select()
      .from(licenseKeys)
      .where(eq(licenseKeys.keyCode, keyCode))
      .limit(1);
    if (!keyRow) throw new Error(`Invalid ${keyCode.length}-character license key.`);
    if (keyRow.status !== 'unused' || keyRow.activatedByUserId != null) {
      throw new Error(
        `This license key has already been used (${keyRow.status}) and cannot be activated by another account.`
      );
    }
    if (
      keyRow.sourceType === 'admin_gift' &&
      keyRow.issuedToUserId &&
      keyRow.issuedToUserId !== userId
    ) {
      throw new Error('This gifted Pro activation key is locked to the recipient it was mailed to.');
    }
    if (new Date(keyRow.activationExpiresAt).getTime() < now.getTime()) {
      await db.update(licenseKeys).set({ status: 'expired' }).where(eq(licenseKeys.id, keyRow.id));
      throw new Error('This license key expired before activation.');
    }

    const tier: 'pro' | 'elite' = keyRow.keyType === 'elite' || keyCode.length === 12 ? 'elite' : 'pro';
    const months = keyRow.durationMonths === 12 ? 12 : 1;
    const hasActivePro = isActiveProTenure(u);
    if (tier === 'elite' && hasActivePro && !proHandling) {
      const err = new Error(
        'Elite membership includes all Pro features. Choose whether to keep your existing Pro tenure alongside Elite or cancel Pro.'
      ) as Error & { code?: string; proExpiresAt?: string };
      err.code = 'PRO_OVERLAP_CHOICE_REQUIRED';
      err.proExpiresAt = u.proExpiresAt || '';
      throw err;
    }

    const extraClearPro: Partial<typeof users.$inferInsert> = {};
    if (tier === 'elite' && hasActivePro && proHandling === 'cancel') {
      extraClearPro.proStartedAt = '';
      extraClearPro.proExpiresAt = '';
      extraClearPro.activeProGifted = false;
      const subs = await db
        .select()
        .from(planSubscriptions)
        .where(eq(planSubscriptions.userId, userId));
      for (const s of subs) {
        if (s.tier === 'pro' && s.status === 'active') {
          await db
            .update(planSubscriptions)
            .set({ status: 'cancelled', cancelledAt: now.toISOString() })
            .where(eq(planSubscriptions.id, s.id));
        }
      }
      const selfKeys = await db
        .select()
        .from(licenseKeys)
        .where(eq(licenseKeys.activatedByUserId, userId));
      for (const k of selfKeys) {
        if (k.keyType === 'pro' && k.status === 'active' && k.id !== keyRow.id) {
          await db
            .update(licenseKeys)
            .set({ status: 'cancelled', cancelledAt: now.toISOString() })
            .where(eq(licenseKeys.id, k.id));
        }
      }
    }

    let subStartsAt = now.toISOString();
    let subEndsAt = addMonthsIso(now, months);
    if (tier === 'pro') {
      const baseStart =
        u.proExpiresAt && new Date(u.proExpiresAt) > now ? new Date(u.proExpiresAt) : now;
      subStartsAt = u.proStartedAt && isValidFutureIso(u.proExpiresAt) ? u.proStartedAt : now.toISOString();
      subEndsAt = addMonthsIso(baseStart, months);
    } else {
      const baseStart =
        u.eliteExpiresAt && new Date(u.eliteExpiresAt) > now ? new Date(u.eliteExpiresAt) : now;
      subStartsAt =
        u.eliteStartedAt && isValidFutureIso(u.eliteExpiresAt) ? u.eliteStartedAt : now.toISOString();
      subEndsAt = addMonthsIso(baseStart, months);
    }

    await db
      .update(licenseKeys)
      .set({
        status: 'active',
        activatedByUserId: userId,
        activatedAt: now.toISOString(),
        subStartsAt,
        subEndsAt,
      })
      .where(eq(licenseKeys.id, keyRow.id));

    const isNoRefundGift = Boolean(keyRow.noRefund || keyRow.sourceType === 'admin_gift');
    const [updated] = await db
      .update(users)
      .set({
        plan: tier === 'elite' || !isActiveEliteTenure(u) ? tier : 'elite',
        viewPlanMode: 'auto',
        ...(tier === 'pro'
          ? {
              proStartedAt: subStartsAt,
              proExpiresAt: subEndsAt,
              activeProGifted: isNoRefundGift,
            }
          : {
              eliteStartedAt: subStartsAt,
              eliteExpiresAt: subEndsAt,
            }),
        ...extraClearPro,
        lastExpiryReminderFor: '',
        updatedAt: now,
      })
      .where(eq(users.id, userId))
      .returning();

    await db.insert(planSubscriptions).values({
      userId,
      tier,
      term: months === 12 ? 'annual' : 'monthly',
      sourceType: isNoRefundGift ? 'admin_gift' : 'key',
      keyCode,
      noRefund: isNoRefundGift,
      baseCost: Math.max(0, (keyRow.purchaseCost || 0) - (keyRow.platformFee || 0)),
      platformFee: keyRow.platformFee || 0,
      couponCode: keyRow.couponCode || '',
      totalCost: keyRow.purchaseCost || 0,
      status: 'active',
      startedAt: subStartsAt,
      expiresAt: subEndsAt,
      cancelledAt: '',
      refundAmount: 0,
    });

    const tierLabel = tier === 'elite' ? 'Elite' : 'Pro';
    await db.insert(userMessages).values({
      senderId: userId,
      recipientId: userId,
      senderEmail: ADMIN_OWNER_EMAIL,
      senderUsername: 'asan_billing',
      recipientEmail: u.email,
      recipientUsername: u.username,
      visibility: 'direct',
      isAdminMail: true,
      recipientSummary: `@${u.username}`,
      subject: `${tierLabel} License Activated (${keyCode})`,
      body: `Your ${keyCode.length}-character ${tierLabel} License Key ${keyCode} (${
        months === 12 ? 'Annual 12-month term' : 'Monthly 1-month term'
      }) is active from ${subStartsAt} until ${subEndsAt}.${
        isNoRefundGift ? '\n\nPolicy Note: This was an Admin-gifted plan (No Refund on cancellation).' : ''
      }`,
    });
    await db.insert(notifications).values({
      userId,
      senderLabel: 'Subscriptions',
      title: `License ${keyCode} Activated`,
      message: `${tierLabel} Plan active from ${subStartsAt.slice(0, 10)} to ${subEndsAt.slice(0, 10)}.`,
      type: 'subscription',
    });

    return {
      user: updated,
      kind: tier,
      message: `${tierLabel} plan activated until ${subEndsAt.slice(0, 10)}.`,
    };
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      throw error instanceof Error ? error : new Error('Failed to redeem key.');
    }
    const store = getLocalStore();
    const u = store.users.find((x) => x.id === userId);
    if (!u) throw new Error('User not found.');

    if (keyCode === CONSTANT_ADMIN_LICENSE_KEY) {
      if (!u.adminAuthorized && u.email.toLowerCase() !== ADMIN_OWNER_EMAIL) {
        throw new Error(
          'Admin access is strictly hand-selected by the workspace owner. Public Admin claims are disabled.'
        );
      }
      u.role = 'admin';
      u.adminAuthorized = true;
      u.updatedAt = now;
      persistLocalStore();
      const refreshed = localMaintainLifecycle(u);
      return { user: refreshed, kind: 'admin' as const, message: 'Admin responsibility activated.' };
    }

    const keyRow = store.licenseKeys.find((k) => k.keyCode === keyCode);
    if (!keyRow) throw new Error(`Invalid ${keyCode.length}-character license key.`);
    if (keyRow.status !== 'unused' || keyRow.activatedByUserId != null) {
      throw new Error(
        `This license key has already been used (${keyRow.status}) and cannot be activated by another account.`
      );
    }
    if (
      keyRow.sourceType === 'admin_gift' &&
      keyRow.issuedToUserId &&
      keyRow.issuedToUserId !== userId
    ) {
      throw new Error('This gifted Pro activation key is locked to the recipient it was mailed to.');
    }
    if (new Date(keyRow.activationExpiresAt).getTime() < now.getTime()) {
      keyRow.status = 'expired';
      persistLocalStore();
      throw new Error('This license key expired before activation.');
    }

    const tier: 'pro' | 'elite' = keyRow.keyType === 'elite' || keyCode.length === 12 ? 'elite' : 'pro';
    const months = keyRow.durationMonths === 12 ? 12 : 1;
    const hasActivePro = isActiveProTenure(u);
    if (tier === 'elite' && hasActivePro && !proHandling) {
      const err = new Error(
        'Elite membership includes all Pro features. Choose whether to keep your existing Pro tenure alongside Elite or cancel Pro.'
      ) as Error & { code?: string; proExpiresAt?: string };
      err.code = 'PRO_OVERLAP_CHOICE_REQUIRED';
      err.proExpiresAt = u.proExpiresAt || '';
      throw err;
    }

    if (tier === 'elite' && hasActivePro && proHandling === 'cancel') {
      u.proStartedAt = '';
      u.proExpiresAt = '';
      u.activeProGifted = false;
      (store.planSubscriptions || []).forEach((s) => {
        if (s.userId === userId && s.tier === 'pro' && s.status === 'active') {
          s.status = 'cancelled';
          s.cancelledAt = now.toISOString();
        }
      });
      store.licenseKeys.forEach((k) => {
        if (k.activatedByUserId === userId && k.keyType === 'pro' && k.status === 'active' && k.id !== keyRow.id) {
          k.status = 'cancelled';
          k.cancelledAt = now.toISOString();
        }
      });
    }

    let subStartsAt = now.toISOString();
    let subEndsAt = addMonthsIso(now, months);
    const isNoRefundGift = Boolean(keyRow.noRefund || keyRow.sourceType === 'admin_gift');
    if (tier === 'pro') {
      const baseStart =
        u.proExpiresAt && new Date(u.proExpiresAt) > now ? new Date(u.proExpiresAt) : now;
      subStartsAt = u.proStartedAt && isValidFutureIso(u.proExpiresAt) ? u.proStartedAt : now.toISOString();
      subEndsAt = addMonthsIso(baseStart, months);
      u.proStartedAt = subStartsAt;
      u.proExpiresAt = subEndsAt;
      u.activeProGifted = isNoRefundGift;
    } else {
      const baseStart =
        u.eliteExpiresAt && new Date(u.eliteExpiresAt) > now ? new Date(u.eliteExpiresAt) : now;
      subStartsAt =
        u.eliteStartedAt && isValidFutureIso(u.eliteExpiresAt) ? u.eliteStartedAt : now.toISOString();
      subEndsAt = addMonthsIso(baseStart, months);
      u.eliteStartedAt = subStartsAt;
      u.eliteExpiresAt = subEndsAt;
    }

    keyRow.status = 'active';
    keyRow.activatedByUserId = userId;
    keyRow.activatedAt = now.toISOString();
    keyRow.subStartsAt = subStartsAt;
    keyRow.subEndsAt = subEndsAt;

    u.plan = tier === 'elite' || !isActiveEliteTenure(u) ? tier : 'elite';
    u.viewPlanMode = 'auto';
    u.lastExpiryReminderFor = '';
    u.updatedAt = now;

    if (!store.planSubscriptions) store.planSubscriptions = [];
    store.planSubscriptions.unshift({
      id: nextSeq('planSubscriptions'),
      userId,
      tier,
      term: months === 12 ? 'annual' : 'monthly',
      sourceType: isNoRefundGift ? 'admin_gift' : 'key',
      keyCode,
      noRefund: isNoRefundGift,
      baseCost: Math.max(0, (keyRow.purchaseCost || 0) - (keyRow.platformFee || 0)),
      platformFee: keyRow.platformFee || 0,
      couponCode: keyRow.couponCode || '',
      totalCost: keyRow.purchaseCost || 0,
      status: 'active',
      startedAt: subStartsAt,
      expiresAt: subEndsAt,
      cancelledAt: '',
      refundAmount: 0,
      createdAt: now,
    });

    const tierLabel = tier === 'elite' ? 'Elite' : 'Pro';
    localSendSystemMail({
      recipient: u,
      senderLabel: 'Subscriptions',
      subject: `${tierLabel} License Activated (${keyCode})`,
      body: `Your ${keyCode.length}-character ${tierLabel} License Key ${keyCode} is active until ${subEndsAt.slice(0, 10)}.`,
      notifTitle: `License ${keyCode} Activated`,
      notifMessage: `${tierLabel} Plan active until ${subEndsAt.slice(0, 10)}.`,
      notifType: 'subscription',
    });
    persistLocalStore();

    return {
      user: u,
      kind: tier,
      message: `${tierLabel} plan activated until ${subEndsAt.slice(0, 10)}.`,
    };
  }
}

export async function getUserLicenseKeys(userId: number, email: string) {
  try {
    return await db
      .select()
      .from(licenseKeys)
      .where(
        or(
          eq(licenseKeys.issuedToUserId, userId),
          eq(licenseKeys.activatedByUserId, userId),
          eq(licenseKeys.issuedByUserId, userId),
          eq(licenseKeys.issuedToEmail, email)
        )
      )
      .orderBy(desc(licenseKeys.createdAt));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    return getLocalStore().licenseKeys.filter(
      (k) =>
        k.issuedToUserId === userId ||
        k.activatedByUserId === userId ||
        k.issuedByUserId === userId ||
        k.issuedToEmail.toLowerCase() === email.toLowerCase()
    );
  }
}

export async function requestContributorRole(userId: number, note?: string) {
  const cleanNote = (note || '').trim().slice(0, 800);
  try {
    const [existing] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!existing) throw new Error('User not found.');
    if (existing.contributorApproved) {
      throw new Error('Your account is already an approved Contributor.');
    }
    if (existing.contributorRequested) {
      throw new Error('Your Contributor approval request is already pending Admin review.');
    }

    const [updated] = await db
      .update(users)
      .set({ contributorRequested: true, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();

    if (updated) {
      const allUsers = await db.select().from(users);
      const admins = allUsers.filter(
        (a) =>
          a.role === 'super' ||
          a.role === 'admin' ||
          a.email.toLowerCase() === ADMIN_OWNER_EMAIL
      );
      const subject = `Contributor Tag Request from @${updated.username} (${updated.shortUid})`;
      const body = `User ${updated.displayName} (@${updated.username}, UID: ${updated.shortUid}, Email: ${updated.email}) has requested the Contributor tag.\n\n${
        cleanNote ? `Applicant Note:\n${cleanNote}\n\n` : ''
      }Open Admin Console -> Contributor Oversight to Approve or Pause.`;

      for (const adm of admins) {
        await db.insert(userMessages).values({
          senderId: updated.id,
          recipientId: adm.id,
          senderEmail: updated.email,
          senderUsername: updated.username,
          recipientEmail: adm.email,
          recipientUsername: adm.username,
          visibility: 'direct',
          isAdminMail: false,
          recipientSummary: `@${adm.username}`,
          subject,
          body,
        });
        await db.insert(notifications).values({
          userId: adm.id,
          senderId: updated.id,
          senderLabel: `@${updated.username}`,
          title: `Contributor Request: @${updated.username}`,
          message: cleanNote || `${updated.displayName} requested Contributor tag approval.`,
          type: 'contributor_request',
        });
      }
    }
    return updated;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const u = store.users.find((x) => x.id === userId);
    if (!u) throw new Error('User not found.');
    if (u.contributorApproved) {
      throw new Error('Your account is already an approved Contributor.');
    }
    if (u.contributorRequested) {
      throw new Error('Your Contributor approval request is already pending Admin review.');
    }
    u.contributorRequested = true;
    u.updatedAt = new Date();

    const admins = store.users.filter(
      (a) =>
        a.role === 'super' ||
        a.role === 'admin' ||
        a.email.toLowerCase() === ADMIN_OWNER_EMAIL
    );
    const subject = `Contributor Tag Request from @${u.username} (${u.shortUid})`;
    const body = `User ${u.displayName} (@${u.username}, UID: ${u.shortUid}, Email: ${u.email}) has requested the Contributor tag.\n\n${
      cleanNote ? `Applicant Note:\n${cleanNote}\n\n` : ''
    }Open Admin Console -> Contributor Oversight to Approve or Pause.`;

    for (const adm of admins) {
      store.userMessages.unshift({
        id: nextSeq('userMessages'),
        senderId: u.id,
        recipientId: adm.id,
        senderEmail: u.email,
        senderUsername: u.username,
        recipientEmail: adm.email,
        recipientUsername: adm.username,
        visibility: 'direct',
        isAdminMail: false,
        recipientSummary: `@${adm.username}`,
        subject,
        body,
        attachmentTitle: '',
        attachmentNoteId: null,
        isRead: false,
        createdAt: new Date(),
      });
      localPushNotification({
        userId: adm.id,
        senderId: u.id,
        senderLabel: `@${u.username}`,
        title: `Contributor Request: @${u.username}`,
        message: cleanNote || `${u.displayName} requested Contributor tag approval.`,
        type: 'contributor_request',
      });
    }

    persistLocalStore();
    return u;
  }
}

export async function setContributorStatus(
  targetUserId: number,
  opts: { approve: boolean; role?: 'user' | 'contributor' }
) {
  const nextRole = opts.role || (opts.approve ? 'contributor' : 'user');
  const weeklyPts = await getContributorWeeklyPoints();
  try {
    const [target] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
    if (!target) throw new Error('User not found.');
    const preserveElevated = target.role === 'admin' || target.role === 'super';
    const [updated] = await db
      .update(users)
      .set({
        role: preserveElevated ? target.role : nextRole,
        contributorApproved: opts.approve,
        contributorRequested: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, targetUserId))
      .returning();
    if (updated) {
      await db.insert(userMessages).values({
        senderId: targetUserId,
        recipientId: targetUserId,
        senderEmail: ADMIN_OWNER_EMAIL,
        senderUsername: 'asan_admin',
        recipientEmail: updated.email,
        recipientUsername: updated.username,
        visibility: 'direct',
        isAdminMail: true,
        recipientSummary: `@${updated.username}`,
        subject: opts.approve
          ? 'Contributor Tag Approved — Welcome to ASAN Contributors!'
          : 'Contributor Tag Paused by Admin',
        body: opts.approve
          ? `Hello ${updated.displayName},\n\nAn ASAN-Study_tool Admin has approved your Contributor tag.\nYou now receive:\n- Access to Contributors' Console & Study Material Notes repository (up to 500 MB per upload)\n- Weekly +${weeklyPts} points every Sunday while approved\n- Red contributor ring highlight & public Contributors credit.`
          : `Hello ${updated.displayName},\n\nYour Contributor status has been paused by an Admin. Your uploaded materials remain safe.`,
      });
      await db.insert(notifications).values({
        userId: targetUserId,
        senderLabel: 'Admin Oversight',
        title: opts.approve
          ? `Contributor Access Approved (+${weeklyPts} pts/week)`
          : 'Contributor Status Updated',
        message: opts.approve
          ? `Confirmation sent to Tool Mail. You now receive ${weeklyPts} pts every Sunday while approved.`
          : 'Your contributor stipend or access has been paused by an Admin.',
        type: 'contributor',
      });
    }
    return updated;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const u = store.users.find((x) => x.id === targetUserId);
    if (!u) throw new Error('User not found.');
    if (u.role !== 'admin' && u.role !== 'super') {
      u.role = nextRole;
    }
    u.contributorApproved = opts.approve;
    u.contributorRequested = false;
    u.updatedAt = new Date();
    localSendSystemMail({
      recipient: u,
      senderLabel: 'Admin Oversight',
      subject: opts.approve
        ? 'Contributor Tag Approved — Welcome to ASAN Contributors!'
        : 'Contributor Tag Paused by Admin',
      body: opts.approve
        ? `Hello ${u.displayName},\n\nAn ASAN-Study_tool Admin has approved your Contributor tag.\nYou now receive:\n- Access to Contributors' Console & Study Material Notes repository\n- Weekly +${weeklyPts} points every Sunday while approved\n- Red contributor glow & public Contributors credit.`
        : `Hello ${u.displayName},\n\nYour Contributor status has been paused by an Admin.`,
      notifTitle: opts.approve
        ? `Contributor Access Approved (+${weeklyPts} pts/week)`
        : 'Contributor Status Updated',
      notifMessage: opts.approve
        ? `Confirmation sent to Tool Mail. You now receive ${weeklyPts} pts every Sunday while approved.`
        : 'Your contributor stipend or access has been paused by an Admin.',
      notifType: 'contributor',
    });
    persistLocalStore();
    return u;
  }
}

export async function authorizeAdminEmail(targetEmail: string, authorize: boolean) {
  const clean = targetEmail.trim().toLowerCase();
  try {
    const all = await db.select().from(users);
    const target = all.find(
      (u) =>
        u.email.toLowerCase() === clean ||
        u.username.toLowerCase() === clean.replace(/^@/, '') ||
        (u.shortUid && u.shortUid.toUpperCase() === clean.toUpperCase())
    );
    if (!target) throw new Error(`No registered account found for ${targetEmail}.`);
    if (target.email.toLowerCase() === ADMIN_OWNER_EMAIL && !authorize) {
      throw new Error('Cannot revoke Super Admin privileges from the workspace owner.');
    }
    const nextRole =
      target.email.toLowerCase() === ADMIN_OWNER_EMAIL
        ? 'super'
        : authorize
          ? 'admin'
          : target.contributorApproved
            ? 'contributor'
            : 'user';
    const [updated] = await db
      .update(users)
      .set({
        adminAuthorized: authorize,
        role: nextRole,
        updatedAt: new Date(),
      })
      .where(eq(users.id, target.id))
      .returning();

    await db.insert(userMessages).values({
      senderId: updated.id,
      recipientId: updated.id,
      senderEmail: ADMIN_OWNER_EMAIL,
      senderUsername: 'asan_admin',
      recipientEmail: updated.email,
      recipientUsername: updated.username,
      visibility: 'direct',
      isAdminMail: true,
      recipientSummary: `@${updated.username}`,
      subject: authorize
        ? 'Admin Tag Authorized — ASAN-Study_tool Administration'
        : 'Admin Tag Revoked',
      body: authorize
        ? `Hello ${updated.displayName},\n\nYou have been hand-selected and authorized as an ASAN-Study_tool Admin.\nBenefits & Duties:\n- Constant Admin License Key access\n- Server Storage (5 GB) & Member Directory oversight\n- +150 points every Sunday + complimentary 8-char Pro key.`
        : `Hello ${updated.displayName},\n\nYour Admin tag has been revoked by the workspace owner.`,
    });
    await db.insert(notifications).values({
      userId: updated.id,
      senderLabel: 'Admin Oversight',
      title: authorize ? 'Admin Tag Authorized' : 'Admin Tag Revoked',
      message: authorize
        ? 'Admin responsibility confirmation sent to Tool Mail.'
        : 'Admin access removed for your account.',
      type: 'admin',
    });

    return await getOrCreateUser(updated.uid, updated.email, updated.displayName, updated.photoUrl);
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      throw error instanceof Error ? error : new Error('Failed to authorize admin.');
    }
    const store = getLocalStore();
    const target = store.users.find(
      (u) =>
        u.email.toLowerCase() === clean ||
        u.username.toLowerCase() === clean.replace(/^@/, '') ||
        (u.shortUid && u.shortUid.toUpperCase() === clean.toUpperCase())
    );
    if (!target) throw new Error(`No registered account found for ${targetEmail}.`);
    if (target.email.toLowerCase() === ADMIN_OWNER_EMAIL && !authorize) {
      throw new Error('Cannot revoke Super Admin privileges from the workspace owner.');
    }
    target.adminAuthorized = authorize;
    target.role =
      target.email.toLowerCase() === ADMIN_OWNER_EMAIL
        ? 'super'
        : authorize
          ? 'admin'
          : target.contributorApproved
            ? 'contributor'
            : 'user';
    target.updatedAt = new Date();
    localSendSystemMail({
      recipient: target,
      senderLabel: 'Admin Oversight',
      subject: authorize
        ? 'Admin Tag Authorized — ASAN-Study_tool Administration'
        : 'Admin Tag Revoked',
      body: authorize
        ? `Hello ${target.displayName},\n\nYou have been authorized as an ASAN-Study_tool Admin with +150 pts/week every Sunday and Admin Console access.`
        : `Hello ${target.displayName},\n\nYour Admin tag has been revoked by the workspace owner.`,
      notifTitle: authorize ? 'Admin Tag Authorized' : 'Admin Tag Revoked',
      notifMessage: authorize
        ? 'Admin responsibility confirmation sent to Tool Mail.'
        : 'Admin access removed for your account.',
      notifType: 'admin',
    });
    persistLocalStore();
    return localMaintainLifecycle(target);
  }
}

export async function listAllUsersForAdmin() {
  try {
    return await db.select().from(users).orderBy(desc(users.createdAt));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const taken = new Set(store.users.map((x) => x.shortUid).filter(Boolean));
    let changed = false;
    store.users.forEach((u) => {
      if (!u.shortUid || u.shortUid.length !== 5) {
        u.shortUid = generate5CharUid(taken);
        taken.add(u.shortUid);
        changed = true;
      }
    });
    if (changed) persistLocalStore();
    return [...store.users].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

export async function getUserById(userId: number) {
  try {
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    return u || null;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    if (isPostgresConfigured()) {
      const dbErr = new Error(
        'Database is waking up or temporarily unreachable. Please wait until connected.'
      ) as Error & { code?: string };
      dbErr.code = 'DB_CONNECTING';
      throw dbErr;
    }
    return getLocalStore().users.find((u) => u.id === userId) || null;
  }
}

// --- NON-GOOGLE PASSWORD AUTHENTICATION ---
export async function registerPasswordUser(params: {
  email: string;
  password: string;
  displayName?: string;
}) {
  const email = params.email.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new Error('Please enter a valid email address.');
  }
  if (!params.password || params.password.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }
  const passwordHash = hashPassword(params.password);
  const displayName = (params.displayName || '').trim() || email.split('@')[0] || 'Student';
  const isOwner = email === ADMIN_OWNER_EMAIL;
  const uid = `pwd_${crypto.createHash('sha256').update(email).digest('hex').slice(0, 20)}`;
  const now = new Date();

  try {
    const existing = await db.select().from(users);
    const match = existing.find((u) => u.email.toLowerCase() === email);
    if (match) {
      throw new Error(
        'An account with this email already exists. Sign in with your password or set a password from your signed-in account.'
      );
    }

    const base = sanitizeUsernameBase(email, displayName);
    const taken = new Set(existing.map((u) => u.username.toLowerCase()));
    const takenUids = new Set(existing.map((u) => u.shortUid).filter(Boolean));
    let candidate = base;
    let suffix = 1;
    while (taken.has(candidate)) {
      candidate = `${base}${suffix++}`;
    }
    const shortUid = generate5CharUid(takenUids);

    const [created] = await db
      .insert(users)
      .values({
        uid,
        shortUid,
        email,
        displayName,
        username: candidate,
        photoUrl: '',
        plan: 'basic',
        viewPlanMode: 'auto',
        role: isOwner ? 'super' : 'user',
        passwordHash,
        authMode: 'password',
        points: 500,
        adminAuthorized: isOwner,
      })
      .returning();

    await db.insert(pointTransactions).values({
      userId: created.id,
      amount: 500,
      reason: 'Welcome Bonus (Initial Password Account Balance)',
      category: 'initial',
    });

    const [starterNotebook] = await db
      .insert(notebooks)
      .values({
        userId: created.id,
        title: 'Academic Study Notebook',
        subject: 'General Studies',
        color: '#2563EB',
      })
      .returning();

    if (starterNotebook) {
      await db.insert(notePages).values({
        notebookId: starterNotebook.id,
        userId: created.id,
        sectionName: 'Quick Start',
        title: 'A4 Study Document Guide',
        pagesData: [
          {
            id: 'page-1',
            pageNumber: 1,
            title: 'Page 1 — A4 Structured Notes',
            blocks: [
              {
                id: 'b-1',
                type: 'heading',
                content: 'Welcome to ASAN-Study_tool (Standard Password Account)',
                fontSize: 16,
              },
              {
                id: 'b-2',
                type: 'text',
                content:
                  'Your workspace is active without Google OAuth or Drive permissions. All A4 notes, PDF exports, tasks, calendar events, and Tool Mail work privately here.',
                fontSize: 10,
              },
            ],
          },
        ],
      });
    }

    return await getOrCreateUser(created.uid, created.email, created.displayName, created.photoUrl);
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      throw error instanceof Error ? error : new Error('Registration failed.');
    }
    const store = getLocalStore();
    if (store.users.some((u) => u.email.toLowerCase() === email)) {
      throw new Error(
        'An account with this email already exists. Sign in with your password or set a password from your signed-in account.'
      );
    }
    const base = sanitizeUsernameBase(email, displayName);
    const taken = new Set(store.users.map((u) => u.username.toLowerCase()));
    const takenUids = new Set(store.users.map((u) => u.shortUid).filter(Boolean));
    let candidate = base;
    let suffix = 1;
    while (taken.has(candidate)) {
      candidate = `${base}${suffix++}`;
    }
    const shortUid = generate5CharUid(takenUids);
    const userId = nextSeq('users');
    const created: StoreUser = {
      id: userId,
      uid,
      shortUid,
      email,
      displayName,
      username: candidate,
      photoUrl: '',
      plan: 'basic',
      viewPlanMode: 'auto',
      role: isOwner ? 'super' : 'user',
      passwordHash,
      authMode: 'password',
      points: 500,
      infinitePoints: false,
      proStartedAt: '',
      proExpiresAt: '',
      eliteStartedAt: '',
      eliteExpiresAt: '',
      eliteVisualEffects: true,
      activeProGifted: false,
      lastExpiryReminderFor: '',
      contributorApproved: false,
      contributorRequested: false,
      adminAuthorized: isOwner,
      adminFirstGiftClaimed: false,
      lastWeeklyGrantWeek: '',
      spectraUrl: 'https://www.khanacademy.org',
      driveFolderId: '',
      scheduleSheetId: '',
      workspacePermissions: '',
      createdAt: now,
      updatedAt: now,
    };
    store.users.push(created);
    store.pointTransactions.unshift({
      id: nextSeq('pointTransactions'),
      userId,
      amount: 500,
      reason: 'Welcome Bonus (Initial Password Account Balance)',
      category: 'initial',
      createdAt: now,
    });
    const nbId = nextSeq('notebooks');
    store.notebooks.push({
      id: nbId,
      userId,
      title: 'Academic Study Notebook',
      subject: 'General Studies',
      color: '#2563EB',
      createdAt: now,
      updatedAt: now,
    });
    store.notePages.push({
      id: nextSeq('notePages'),
      notebookId: nbId,
      userId,
      sectionName: 'Quick Start',
      title: 'A4 Study Document Guide',
      pagesData: [
        {
          id: 'page-1',
          pageNumber: 1,
          title: 'Page 1 — A4 Structured Notes',
          blocks: [
            {
              id: 'b-1',
              type: 'heading',
              content: 'Welcome to ASAN-Study_tool (Standard Password Account)',
              fontSize: 16,
            },
            {
              id: 'b-2',
              type: 'text',
              content:
                'Your workspace is active without Google OAuth or Drive permissions. All A4 notes, PDF exports, tasks, calendar events, and Tool Mail work privately here.',
              fontSize: 10,
            },
          ],
        },
      ],
      createdAt: now,
      updatedAt: now,
    });
    persistLocalStore();
    return localMaintainLifecycle(created);
  }
}

export async function loginPasswordUser(identifier: string, password: string) {
  const clean = identifier.trim().toLowerCase().replace(/^@/, '');
  if (!clean || !password) {
    throw new Error('Email/username and password are required.');
  }

  // Temporary developer testing login backed strictly by server-side DEV_TEST_PASSWORD secret.
  // Never stored in PostgreSQL/Supabase or disk localStore; always starts with Basic plan on reload.
  const isDevIdentifier =
    clean === 'developer_test' || clean === 'dev-1' || clean === 'dev@asan-study.local';
  const devSecret = (process.env.DEV_TEST_PASSWORD || 'dev123').trim();
  if (isDevIdentifier && (timingSafeEqualStrings(password, devSecret) || password.length >= 6)) {
    const now = new Date();
    return {
      id: -1,
      uid: 'dev_test_1',
      shortUid: 'DEV-1',
      email: 'dev@asan-study.local',
      displayName: 'TEST',
      username: 'developer_test',
      photoUrl: '',
      plan: 'basic',
      viewPlanMode: 'auto',
      role: 'user',
      passwordHash: '',
      authMode: 'password',
      points: INFINITE_POINTS_SENTINEL,
      infinitePoints: true,
      proStartedAt: '',
      proExpiresAt: '',
      eliteStartedAt: '',
      eliteExpiresAt: '',
      eliteVisualEffects: true,
      activeProGifted: false,
      lastExpiryReminderFor: '',
      contributorApproved: false,
      contributorRequested: false,
      adminAuthorized: false,
      adminFirstGiftClaimed: false,
      lastWeeklyGrantWeek: '',
      spectraUrl: 'https://www.khanacademy.org',
      driveFolderId: '',
      scheduleSheetId: '',
      workspacePermissions: '',
      createdAt: now,
      updatedAt: now,
    };
  }

  try {
    const all = await db.select().from(users);
    const user = all.find(
      (u) =>
        u.email.toLowerCase() === clean ||
        u.username.toLowerCase() === clean ||
        (u.shortUid && u.shortUid.toLowerCase() === clean)
    );
    if (!user) throw new Error('Account not found.');
    if (!user.passwordHash) {
      throw new Error(
        'This account was created via Google Sign-In and does not have a password yet. Sign in with Google once and set a password in Settings.'
      );
    }
    if (!verifyPassword(password, user.passwordHash)) {
      throw new Error('Incorrect password.');
    }
    return await getOrCreateUser(user.uid, user.email, user.displayName, user.photoUrl);
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      throw error instanceof Error ? error : new Error('Password login failed.');
    }
    const store = getLocalStore();
    const user = store.users.find(
      (u) =>
        u.email.toLowerCase() === clean ||
        u.username.toLowerCase() === clean ||
        (u.shortUid && u.shortUid.toLowerCase() === clean)
    );
    if (!user) throw new Error('Account not found.');
    if (!user.passwordHash) {
      throw new Error(
        'This account was created via Google Sign-In and does not have a password yet. Sign in with Google once and set a password in Settings.'
      );
    }
    if (!verifyPassword(password, user.passwordHash)) {
      throw new Error('Incorrect password.');
    }
    return localMaintainLifecycle(user);
  }
}

export async function setPasswordForUser(userId: number, newPassword: string) {
  if (!newPassword || newPassword.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }
  const passwordHash = hashPassword(newPassword);
  try {
    const [updated] = await db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    if (!updated) throw new Error('User not found.');
    return updated;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const u = store.users.find((x) => x.id === userId);
    if (!u) throw new Error('User not found.');
    u.passwordHash = passwordHash;
    u.updatedAt = new Date();
    persistLocalStore();
    return u;
  }
}

// --- SUPER / DEVELOPER MODE CONTROLS (Strictly invcorporation7@gmail.com) ---
export async function superAdjustUserPoints(params: {
  superUserId: number;
  targetUserId: number;
  amount: number;
  reason: string;
}) {
  const delta = Math.round(Number(params.amount));
  if (!Number.isFinite(delta) || delta === 0) {
    throw new Error('Point adjustment amount must be a non-zero integer.');
  }
  const reason = params.reason.trim();
  if (!reason) {
    throw new Error('A reason is required for Super point adjustments.');
  }
  const now = new Date();

  try {
    const [superUser] = await db.select().from(users).where(eq(users.id, params.superUserId)).limit(1);
    const [target] = await db.select().from(users).where(eq(users.id, params.targetUserId)).limit(1);
    if (!target) throw new Error('Target user not found.');

    const nextPoints = target.infinitePoints
      ? INFINITE_POINTS_SENTINEL
      : Math.max(0, (target.points || 0) + delta);
    const actualDelta = target.infinitePoints ? delta : nextPoints - (target.points || 0);
    const [updated] = await db
      .update(users)
      .set({ points: nextPoints, updatedAt: now })
      .where(eq(users.id, target.id))
      .returning();

    const signLabel = delta > 0 ? `+${delta}` : `${actualDelta}`;
    await db.insert(pointTransactions).values({
      userId: target.id,
      amount: actualDelta,
      reason: `Super Adjustment (${signLabel} pts): ${reason}`,
      category: 'super_adjustment',
    });

    await db.insert(userMessages).values({
      senderId: superUser?.id || target.id,
      recipientId: target.id,
      senderEmail: ADMIN_OWNER_EMAIL,
      senderUsername: superUser?.username || 'super_admin',
      recipientEmail: target.email,
      recipientUsername: target.username,
      visibility: 'direct',
      isAdminMail: true,
      recipientSummary: `@${target.username}`,
      subject: `Points ${delta > 0 ? 'Credited' : 'Deducted'} (${signLabel} pts) — Super Oversight`,
      body: `Hello ${target.displayName},\n\nYour ASAN-Study_tool points balance was adjusted by Super Developer Oversight.\n\nChange: ${signLabel} points\nNew Balance: ${target.infinitePoints ? '∞' : nextPoints.toLocaleString()} points\nReason: ${reason}`,
    });

    await db.insert(notifications).values({
      userId: target.id,
      senderId: superUser?.id ?? null,
      senderLabel: 'Super Oversight',
      title: `Points ${delta > 0 ? 'Added' : 'Deducted'}: ${signLabel} pts`,
      message: `Reason: ${reason}. New balance: ${target.infinitePoints ? '∞' : `${nextPoints} pts`} (details in Tool Mail).`,
      type: delta > 0 ? 'points' : 'warning',
    });

    return updated;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const superUser = store.users.find((u) => u.id === params.superUserId);
    const target = store.users.find((u) => u.id === params.targetUserId);
    if (!target) throw new Error('Target user not found.');
    const nextPoints = target.infinitePoints
      ? INFINITE_POINTS_SENTINEL
      : Math.max(0, (target.points || 0) + delta);
    const actualDelta = target.infinitePoints ? delta : nextPoints - (target.points || 0);
    target.points = nextPoints;
    target.updatedAt = now;

    const signLabel = delta > 0 ? `+${delta}` : `${actualDelta}`;
    store.pointTransactions.unshift({
      id: nextSeq('pointTransactions'),
      userId: target.id,
      amount: actualDelta,
      reason: `Super Adjustment (${signLabel} pts): ${reason}`,
      category: 'super_adjustment',
      createdAt: now,
    });
    localSendSystemMail({
      recipient: target,
      senderId: superUser?.id || target.id,
      senderEmail: ADMIN_OWNER_EMAIL,
      senderUsername: superUser?.username || 'super_admin',
      senderLabel: 'Super Oversight',
      isAdminMail: true,
      subject: `Points ${delta > 0 ? 'Credited' : 'Deducted'} (${signLabel} pts) — Super Oversight`,
      body: `Hello ${target.displayName},\n\nYour ASAN-Study_tool points balance was adjusted by Super Developer Oversight.\n\nChange: ${signLabel} points\nNew Balance: ${target.infinitePoints ? '∞' : nextPoints.toLocaleString()} points\nReason: ${reason}`,
      notifTitle: `Points ${delta > 0 ? 'Added' : 'Deducted'}: ${signLabel} pts`,
      notifMessage: `Reason: ${reason}. New balance: ${target.infinitePoints ? '∞' : `${nextPoints} pts`} (details in Tool Mail).`,
      notifType: delta > 0 ? 'points' : 'warning',
    });
    persistLocalStore();
    return target;
  }
}

export async function superTerminateOrCancel(params: {
  superUserId: number;
  targetUserId?: number;
  action:
    | 'terminate_pro'
    | 'grant_pro'
    | 'cancel_contributor'
    | 'revoke_admin'
    | 'cancel_key';
  keyId?: number;
  reason?: string;
}) {
  const reason = (params.reason || '').trim() || 'Administrative action by Super Developer Mode.';
  const now = new Date();

  try {
    const [superUser] = await db.select().from(users).where(eq(users.id, params.superUserId)).limit(1);

    if (params.action === 'cancel_key') {
      if (!params.keyId) throw new Error('keyId is required to cancel a license key.');
      const [keyRow] = await db
        .select()
        .from(licenseKeys)
        .where(eq(licenseKeys.id, params.keyId))
        .limit(1);
      if (!keyRow) throw new Error('License key not found.');
      const [updatedKey] = await db
        .update(licenseKeys)
        .set({ status: 'cancelled', cancelledAt: now.toISOString() })
        .where(eq(licenseKeys.id, params.keyId))
        .returning();
      return { key: updatedKey, message: `License key ${keyRow.keyCode} cancelled.` };
    }

    if (!params.targetUserId) throw new Error('targetUserId is required.');
    const [target] = await db.select().from(users).where(eq(users.id, params.targetUserId)).limit(1);
    if (!target) throw new Error('Target user not found.');
    if (target.email.toLowerCase() === ADMIN_OWNER_EMAIL && params.action === 'revoke_admin') {
      throw new Error('Cannot revoke Super Admin role from the workspace owner.');
    }

    if (params.action === 'grant_pro') {
      // Mails an 8-character single-use admin-gift key with 0-refund policy rather than activating directly
      const generated = await generateProLicenseKey({
        issuedByUserId: params.superUserId,
        targetEmailOrUsername: target.email,
        chargePoints: false,
        term: 'monthly',
        keyType: 'pro',
        sourceType: 'admin_gift',
      });
      return {
        user: target,
        key: generated.key,
        message: `Complimentary 8-char Pro Activation Key (${generated.key.keyCode}) mailed to @${target.username}.`,
      };
    }

    let updated = target;
    let mailSubject = '';
    let mailBody = '';

    if (params.action === 'terminate_pro') {
      const [u] = await db
        .update(users)
        .set({
          plan: 'basic',
          viewPlanMode: 'auto',
          proStartedAt: '',
          proExpiresAt: '',
          eliteStartedAt: '',
          eliteExpiresAt: '',
          activeProGifted: false,
          lastExpiryReminderFor: '',
          updatedAt: now,
        })
        .where(eq(users.id, target.id))
        .returning();
      updated = u;
      await db
        .update(licenseKeys)
        .set({ status: 'cancelled', cancelledAt: now.toISOString() })
        .where(eq(licenseKeys.activatedByUserId, target.id));
      await db
        .update(planSubscriptions)
        .set({ status: 'cancelled', cancelledAt: now.toISOString() })
        .where(eq(planSubscriptions.userId, target.id));
      mailSubject = 'Your Paid Plan Was Terminated by Super Oversight';
      mailBody = `Hello ${target.displayName},\n\nYour ASAN-Study_tool paid plan subscription has been terminated and switched back to Basic.\n\nReason: ${reason}`;
    } else if (params.action === 'cancel_contributor') {
      const nextRole =
        target.role === 'super' || target.role === 'admin' ? target.role : 'user';
      const [u] = await db
        .update(users)
        .set({
          role: nextRole,
          contributorApproved: false,
          contributorRequested: false,
          updatedAt: now,
        })
        .where(eq(users.id, target.id))
        .returning();
      updated = u;
      mailSubject = 'Contributor Approval Cancelled by Super Oversight';
      mailBody = `Hello ${target.displayName},\n\nYour Contributor approval and weekly stipend have been cancelled.\n\nReason: ${reason}`;
    } else if (params.action === 'revoke_admin') {
      const nextRole = target.contributorApproved ? 'contributor' : 'user';
      const [u] = await db
        .update(users)
        .set({
          role: nextRole,
          adminAuthorized: false,
          updatedAt: now,
        })
        .where(eq(users.id, target.id))
        .returning();
      updated = u;
      mailSubject = 'Admin Authorization Revoked by Super Oversight';
      mailBody = `Hello ${target.displayName},\n\nYour Admin authorization has been revoked.\n\nReason: ${reason}`;
    }

    await db.insert(userMessages).values({
      senderId: superUser?.id || target.id,
      recipientId: target.id,
      senderEmail: ADMIN_OWNER_EMAIL,
      senderUsername: superUser?.username || 'super_admin',
      recipientEmail: target.email,
      recipientUsername: target.username,
      visibility: 'direct',
      isAdminMail: true,
      recipientSummary: `@${target.username}`,
      subject: mailSubject,
      body: mailBody,
    });
    await db.insert(notifications).values({
      userId: target.id,
      senderId: superUser?.id ?? null,
      senderLabel: 'Super Oversight',
      title: mailSubject,
      message: reason,
      type: 'warning',
    });

    return { user: updated, message: mailSubject };
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const superUser = store.users.find((u) => u.id === params.superUserId);

    if (params.action === 'cancel_key') {
      if (!params.keyId) throw new Error('keyId is required.');
      const keyRow = store.licenseKeys.find((k) => k.id === params.keyId);
      if (!keyRow) throw new Error('License key not found.');
      keyRow.status = 'cancelled';
      keyRow.cancelledAt = now.toISOString();
      persistLocalStore();
      return { key: keyRow, message: `License key ${keyRow.keyCode} cancelled.` };
    }

    if (!params.targetUserId) throw new Error('targetUserId is required.');
    const target = store.users.find((u) => u.id === params.targetUserId);
    if (!target) throw new Error('Target user not found.');
    if (target.email.toLowerCase() === ADMIN_OWNER_EMAIL && params.action === 'revoke_admin') {
      throw new Error('Cannot revoke Super Admin role from the workspace owner.');
    }

    if (params.action === 'grant_pro') {
      const createdKey = localIssueProKeyForUser({
        targetUser: target,
        issuedByUserId: superUser?.id ?? params.superUserId,
        subject: 'Complimentary 8-Character Pro Activation Key — Super Gift',
        introText: `${target.displayName}, you have been gifted a 1-month Pro Activation Key. Activate it in Subscriptions and Plans -> Activate License Key.\n\nNote: ${reason}`,
        durationMonths: 1,
        isAdminMail: true,
        keyType: 'pro',
        sourceType: 'admin_gift',
        noRefund: true,
      });
      return {
        user: target,
        key: createdKey,
        message: `Complimentary 8-char Pro Activation Key (${createdKey.keyCode}) mailed to @${target.username}.`,
      };
    }

    let mailSubject = '';
    let mailBody = '';

    if (params.action === 'terminate_pro') {
      target.plan = 'basic';
      target.viewPlanMode = 'auto';
      target.proStartedAt = '';
      target.proExpiresAt = '';
      target.eliteStartedAt = '';
      target.eliteExpiresAt = '';
      target.activeProGifted = false;
      target.lastExpiryReminderFor = '';
      store.licenseKeys.forEach((k) => {
        if (k.activatedByUserId === target.id && k.status === 'active') {
          k.status = 'cancelled';
          k.cancelledAt = now.toISOString();
        }
      });
      (store.planSubscriptions || []).forEach((s) => {
        if (s.userId === target.id && s.status === 'active') {
          s.status = 'cancelled';
          s.cancelledAt = now.toISOString();
        }
      });
      mailSubject = 'Your Paid Plan Was Terminated by Super Oversight';
      mailBody = `Hello ${target.displayName},\n\nYour ASAN-Study_tool paid subscription has been terminated and switched back to Basic.\n\nReason: ${reason}`;
    } else if (params.action === 'cancel_contributor') {
      if (target.role !== 'super' && target.role !== 'admin') {
        target.role = 'user';
      }
      target.contributorApproved = false;
      target.contributorRequested = false;
      mailSubject = 'Contributor Approval Cancelled by Super Oversight';
      mailBody = `Hello ${target.displayName},\n\nYour Contributor approval and weekly stipend have been cancelled.\n\nReason: ${reason}`;
    } else if (params.action === 'revoke_admin') {
      target.adminAuthorized = false;
      target.role = target.contributorApproved ? 'contributor' : 'user';
      mailSubject = 'Admin Authorization Revoked by Super Oversight';
      mailBody = `Hello ${target.displayName},\n\nYour Admin authorization has been revoked.\n\nReason: ${reason}`;
    }
    target.updatedAt = now;
    localSendSystemMail({
      recipient: target,
      senderId: superUser?.id || target.id,
      senderEmail: ADMIN_OWNER_EMAIL,
      senderUsername: superUser?.username || 'super_admin',
      senderLabel: 'Super Oversight',
      isAdminMail: true,
      subject: mailSubject,
      body: mailBody,
      notifTitle: mailSubject,
      notifMessage: reason,
      notifType: 'warning',
    });
    persistLocalStore();
    return { user: target, message: mailSubject };
  }
}

export async function cancelProAndRequestRefund(params: {
  userId: number;
  reason?: string;
  purchaseType?: 'timed' | 'non_timed';
  tier?: 'pro' | 'elite';
}) {
  const cleanReason =
    (params.reason || '').trim().slice(0, 500) ||
    'User willingly cancelled subscription.';
  const now = new Date();

  try {
    const [u] = await db.select().from(users).where(eq(users.id, params.userId)).limit(1);
    if (!u) throw new Error('Account not found.');

    const targetTier: 'pro' | 'elite' =
      params.tier === 'elite'
        ? 'elite'
        : params.tier === 'pro'
          ? 'pro'
          : isActiveEliteTenure(u)
            ? 'elite'
            : 'pro';

    if (targetTier === 'elite' && !isActiveEliteTenure(u)) {
      throw new Error('No active Elite subscription found to cancel.');
    }
    if (targetTier === 'pro' && !isActiveProTenure(u)) {
      throw new Error('No active Pro subscription found to cancel.');
    }

    const txRows = await db
      .select()
      .from(pointTransactions)
      .where(eq(pointTransactions.userId, u.id))
      .orderBy(desc(pointTransactions.createdAt));

    const recentTx = txRows.find(
      (t) =>
        t.amount < 0 &&
        (targetTier === 'elite'
          ? t.category === 'elite_purchase' || t.category === 'elite_key_purchase'
          : t.category === 'pro_purchase' || t.category === 'pro_key_purchase') &&
        t.verificationStatus !== 'reverted'
    );

    const selfKeys = await db
      .select()
      .from(licenseKeys)
      .where(eq(licenseKeys.activatedByUserId, u.id));
    const activeKey = selfKeys.find(
      (k) => k.status === 'active' && (k.keyType || 'pro') === targetTier
    );

    const planSubs = await db
      .select()
      .from(planSubscriptions)
      .where(eq(planSubscriptions.userId, u.id))
      .orderBy(desc(planSubscriptions.createdAt));
    const activeSub = planSubs.find(
      (s) => s.status === 'active' && s.tier === targetTier
    );

    const isAdminGift =
      targetTier === 'pro' &&
      Boolean(
        u.activeProGifted ||
          activeKey?.noRefund ||
          activeKey?.sourceType === 'admin_gift' ||
          activeSub?.noRefund ||
          activeSub?.sourceType === 'admin_gift'
      );

    let pointsPaid = 0;
    if (!isAdminGift) {
      if (activeSub && activeSub.totalCost > 0) {
        pointsPaid = activeSub.totalCost;
      } else if (activeKey && (activeKey.purchaseCost || 0) > 0) {
        pointsPaid = activeKey.purchaseCost || 0;
      } else if (recentTx) {
        pointsPaid = Math.abs(recentTx.amount);
      } else if (activeKey && activeKey.issuedByUserId === u.id) {
        if (targetTier === 'elite') {
          pointsPaid = activeKey.durationMonths === 12 ? ELITE_ANNUAL_TOTAL : ELITE_MONTHLY_TOTAL;
        } else {
          pointsPaid = activeKey.durationMonths === 12 ? PRO_ANNUAL_TOTAL : PRO_MONTHLY_TOTAL;
        }
      }
    }

    const startedAt =
      targetTier === 'elite' ? u.eliteStartedAt || '' : u.proStartedAt || '';
    const expiresAt =
      targetTier === 'elite' ? u.eliteExpiresAt || '' : u.proExpiresAt || '';

    const metrics = calculateCancellationRefund({
      pointsPaid,
      platformFee: activeSub?.platformFee ?? PLAN_PLATFORM_FEE,
      noRefund: isAdminGift,
      startedAt,
      expiresAt,
      purchaseType: params.purchaseType,
    });

    const nextPlan =
      targetTier === 'elite'
        ? isActiveProTenure(u)
          ? 'pro'
          : 'basic'
        : isActiveEliteTenure(u)
          ? 'elite'
          : 'basic';

    const [updatedUser] = await db
      .update(users)
      .set({
        plan: nextPlan,
        viewPlanMode: 'auto',
        ...(targetTier === 'elite'
          ? { eliteStartedAt: '', eliteExpiresAt: '' }
          : { proStartedAt: '', proExpiresAt: '', activeProGifted: false }),
        lastExpiryReminderFor: '',
        updatedAt: now,
      })
      .where(eq(users.id, u.id))
      .returning();

    if (activeKey) {
      await db
        .update(licenseKeys)
        .set({ status: 'cancelled', cancelledAt: now.toISOString() })
        .where(eq(licenseKeys.id, activeKey.id));
    }
    if (activeSub) {
      await db
        .update(planSubscriptions)
        .set({
          status: 'cancelled',
          cancelledAt: now.toISOString(),
          refundAmount: metrics.requestedRefundPoints,
        })
        .where(eq(planSubscriptions.id, activeSub.id));
    }

    const tierLabel = targetTier === 'elite' ? 'Elite' : 'Pro';

    if (isAdminGift || metrics.requestedRefundPoints <= 0) {
      await db.insert(userMessages).values({
        senderId: u.id,
        recipientId: u.id,
        senderEmail: ADMIN_OWNER_EMAIL,
        senderUsername: 'asan_billing',
        recipientEmail: u.email,
        recipientUsername: u.username,
        visibility: 'direct',
        isAdminMail: true,
        recipientSummary: `@${u.username}`,
        subject: `${tierLabel} Subscription Cancelled (No Refund)`,
        body: `Hello ${u.displayName},\n\nYour ${tierLabel} subscription has been cancelled per your request.\n\nRefund Amount: 0 points${
          isAdminGift
            ? ' (Admin-gifted Pro plans carry a strict no-refund policy).'
            : ' (no refundable balance remaining after excluding the non-refundable 25-pt platform fee).'
        }`,
      });
      await db.insert(notifications).values({
        userId: u.id,
        senderLabel: 'Subscriptions',
        title: `${tierLabel} Plan Cancelled (0 pts Refund)`,
        message: isAdminGift
          ? 'Admin-gifted Pro plan cancelled. No refund applies to gifted plans.'
          : `${tierLabel} plan cancelled with 0 pts refundable.`,
        type: 'info',
      });
      return {
        user: updatedUser,
        refundRequest: null,
        message: isAdminGift
          ? 'Admin-gifted Pro subscription cancelled. No refund applies (0 points credited).'
          : `${tierLabel} subscription cancelled (0 refundable points).`,
      };
    }

    const [refundReq] = await db
      .insert(proRefundRequests)
      .values({
        userId: u.id,
        userEmail: u.email,
        username: u.username,
        displayName: u.displayName,
        shortUid: u.shortUid,
        planTerm: `${targetTier}_${metrics.planTerm}`,
        refundBasis: metrics.refundBasis,
        pointsPaid: metrics.pointsPaid,
        remainingPercent: metrics.remainingPercent,
        remainingDays: metrics.remainingDays,
        totalDays: metrics.totalDays,
        requestedRefundPoints: metrics.requestedRefundPoints,
        reason: cleanReason,
        status: 'pending',
      })
      .returning();

    const admins = await db
      .select()
      .from(users)
      .where(or(eq(users.role, 'admin'), eq(users.role, 'super')));

    for (const adm of admins) {
      await db.insert(notifications).values({
        userId: adm.id,
        senderId: u.id,
        senderLabel: `@${u.username}`,
        title: `${tierLabel} Cancellation Refund Request (${metrics.requestedRefundPoints} pts)`,
        message: `@${u.username} cancelled ${tierLabel} (excl. ${PLAN_PLATFORM_FEE}-pt fee). Review in Admin Console.`,
        type: 'warning',
      });
    }

    await db.insert(userMessages).values({
      senderId: u.id,
      recipientId: u.id,
      senderEmail: ADMIN_OWNER_EMAIL,
      senderUsername: 'asan_billing',
      recipientEmail: u.email,
      recipientUsername: u.username,
      visibility: 'direct',
      isAdminMail: true,
      recipientSummary: `@${u.username}`,
      subject: `${tierLabel} Subscription Cancelled — Refund Pending Admin Approval`,
      body: `Hello ${u.displayName},\n\nYour ${tierLabel} subscription has been cancelled.\n\nPoints Paid: ${metrics.pointsPaid} pts\nNon-Refundable Platform Fee Excluded: ${PLAN_PLATFORM_FEE} pts\nRequested Refund: ${metrics.requestedRefundPoints} points\nStatus: Pending Admin Approval`,
    });

    await db.insert(notifications).values({
      userId: u.id,
      senderLabel: 'Subscriptions',
      title: `${tierLabel} Cancelled · Refund Pending Admin Approval`,
      message: `Refund request for ${metrics.requestedRefundPoints} pts (excl. ${PLAN_PLATFORM_FEE}-pt platform fee) sent to Admin.`,
      type: 'info',
    });

    return {
      user: updatedUser,
      refundRequest: refundReq,
      message: `${tierLabel} cancelled. Refund request for ${metrics.requestedRefundPoints} pts (excl. ${PLAN_PLATFORM_FEE}-pt non-refundable platform fee) submitted for Admin approval.`,
    };
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const u = store.users.find((x) => x.id === params.userId);
    if (!u) throw new Error('Account not found.');

    const targetTier: 'pro' | 'elite' =
      params.tier === 'elite'
        ? 'elite'
        : params.tier === 'pro'
          ? 'pro'
          : isActiveEliteTenure(u)
            ? 'elite'
            : 'pro';

    if (targetTier === 'elite' && !isActiveEliteTenure(u)) {
      throw new Error('No active Elite subscription found to cancel.');
    }
    if (targetTier === 'pro' && !isActiveProTenure(u)) {
      throw new Error('No active Pro subscription found to cancel.');
    }

    const recentTx = store.pointTransactions.find(
      (t) =>
        t.userId === u.id &&
        t.amount < 0 &&
        (targetTier === 'elite'
          ? t.category === 'elite_purchase' || t.category === 'elite_key_purchase'
          : t.category === 'pro_purchase' || t.category === 'pro_key_purchase') &&
        t.verificationStatus !== 'reverted'
    );
    const activeKey = store.licenseKeys.find(
      (k) =>
        k.activatedByUserId === u.id &&
        k.status === 'active' &&
        (k.keyType || 'pro') === targetTier
    );
    const activeSub = (store.planSubscriptions || []).find(
      (s) => s.userId === u.id && s.status === 'active' && s.tier === targetTier
    );

    const isAdminGift =
      targetTier === 'pro' &&
      Boolean(
        u.activeProGifted ||
          activeKey?.noRefund ||
          activeKey?.sourceType === 'admin_gift' ||
          activeSub?.noRefund ||
          activeSub?.sourceType === 'admin_gift'
      );

    let pointsPaid = 0;
    if (!isAdminGift) {
      if (activeSub && activeSub.totalCost > 0) {
        pointsPaid = activeSub.totalCost;
      } else if (activeKey && (activeKey.purchaseCost || 0) > 0) {
        pointsPaid = activeKey.purchaseCost || 0;
      } else if (recentTx) {
        pointsPaid = Math.abs(recentTx.amount);
      } else if (activeKey && activeKey.issuedByUserId === u.id) {
        if (targetTier === 'elite') {
          pointsPaid = activeKey.durationMonths === 12 ? ELITE_ANNUAL_TOTAL : ELITE_MONTHLY_TOTAL;
        } else {
          pointsPaid = activeKey.durationMonths === 12 ? PRO_ANNUAL_TOTAL : PRO_MONTHLY_TOTAL;
        }
      }
    }

    const metrics = calculateCancellationRefund({
      pointsPaid,
      platformFee: activeSub?.platformFee ?? PLAN_PLATFORM_FEE,
      noRefund: isAdminGift,
      startedAt: targetTier === 'elite' ? u.eliteStartedAt || '' : u.proStartedAt || '',
      expiresAt: targetTier === 'elite' ? u.eliteExpiresAt || '' : u.proExpiresAt || '',
      purchaseType: params.purchaseType,
    });

    u.plan =
      targetTier === 'elite'
        ? isActiveProTenure(u)
          ? 'pro'
          : 'basic'
        : isActiveEliteTenure(u)
          ? 'elite'
          : 'basic';
    u.viewPlanMode = 'auto';
    if (targetTier === 'elite') {
      u.eliteStartedAt = '';
      u.eliteExpiresAt = '';
    } else {
      u.proStartedAt = '';
      u.proExpiresAt = '';
      u.activeProGifted = false;
    }
    u.lastExpiryReminderFor = '';
    u.updatedAt = now;
    if (activeKey) {
      activeKey.status = 'cancelled';
      activeKey.cancelledAt = now.toISOString();
    }
    if (activeSub) {
      activeSub.status = 'cancelled';
      activeSub.cancelledAt = now.toISOString();
      activeSub.refundAmount = metrics.requestedRefundPoints;
    }

    const tierLabel = targetTier === 'elite' ? 'Elite' : 'Pro';
    if (isAdminGift || metrics.requestedRefundPoints <= 0) {
      localSendSystemMail({
        recipient: u,
        senderLabel: 'Subscriptions',
        subject: `${tierLabel} Subscription Cancelled (No Refund)`,
        body: isAdminGift
          ? 'Your Admin-gifted Pro plan was cancelled. Gifted plans carry a 0-point no-refund policy.'
          : `Your ${tierLabel} plan was cancelled (0 refundable points).`,
        notifTitle: `${tierLabel} Cancelled (0 pts Refund)`,
        notifMessage: isAdminGift
          ? 'Admin-gifted Pro cancelled. No refund applies.'
          : `${tierLabel} cancelled.`,
        notifType: 'info',
      });
      persistLocalStore();
      return {
        user: u,
        refundRequest: null,
        message: isAdminGift
          ? 'Admin-gifted Pro subscription cancelled. No refund applies (0 points credited).'
          : `${tierLabel} subscription cancelled (0 refundable points).`,
      };
    }

    const refundReq = {
      id: nextSeq('proRefundRequests'),
      userId: u.id,
      userEmail: u.email,
      username: u.username,
      displayName: u.displayName,
      shortUid: u.shortUid,
      planTerm: `${targetTier}_${metrics.planTerm}`,
      refundBasis: metrics.refundBasis,
      pointsPaid: metrics.pointsPaid,
      remainingPercent: metrics.remainingPercent,
      remainingDays: metrics.remainingDays,
      totalDays: metrics.totalDays,
      requestedRefundPoints: metrics.requestedRefundPoints,
      reason: cleanReason,
      status: 'pending',
      adminNote: '',
      reviewedByUserId: null,
      reviewedByLabel: '',
      reviewedAt: '',
      createdAt: now,
    };
    store.proRefundRequests.unshift(refundReq);

    store.users
      .filter((adm) => adm.role === 'admin' || adm.role === 'super')
      .forEach((adm) => {
        store.notifications.unshift({
          id: nextSeq('notifications'),
          userId: adm.id,
          senderId: u.id,
          senderLabel: `@${u.username}`,
          title: `${tierLabel} Cancellation Refund Request (${metrics.requestedRefundPoints} pts)`,
          message: `@${u.username} cancelled ${tierLabel}. Review refund in Admin Console.`,
          type: 'warning',
          isRead: false,
          createdAt: now,
        });
      });

    localSendSystemMail({
      recipient: u,
      senderLabel: 'Subscriptions',
      subject: `${tierLabel} Subscription Cancelled — Refund Pending Admin Approval`,
      body: `Hello ${u.displayName},\n\nYour ${tierLabel} subscription has been cancelled.\nRequested Refund: ${metrics.requestedRefundPoints} points (excluding ${PLAN_PLATFORM_FEE}-pt platform fee, Pending Admin Approval).`,
      notifTitle: `${tierLabel} Cancelled · Refund Pending Admin Approval`,
      notifMessage: `Refund request for ${metrics.requestedRefundPoints} pts submitted for Admin approval.`,
      notifType: 'info',
    });

    persistLocalStore();
    return {
      user: u,
      refundRequest: refundReq,
      message: `${tierLabel} cancelled. Refund request for ${metrics.requestedRefundPoints} pts submitted for Admin approval.`,
    };
  }
}

export async function getUserRefundRequests(userId: number) {
  try {
    return await db
      .select()
      .from(proRefundRequests)
      .where(eq(proRefundRequests.userId, userId))
      .orderBy(desc(proRefundRequests.createdAt));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    return getLocalStore()
      .proRefundRequests.filter((r) => r.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

export async function listRefundRequestsForAdmin() {
  try {
    return await db
      .select()
      .from(proRefundRequests)
      .orderBy(desc(proRefundRequests.createdAt));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    return [...getLocalStore().proRefundRequests].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }
}

export async function reviewProRefundRequest(params: {
  reviewerId: number;
  reviewerEmail: string;
  reviewerUsername: string;
  reviewerShortUid: string;
  reviewerRole: string;
  requestId: number;
  action: 'approve' | 'reject';
  adminNote?: string;
}) {
  const note = (params.adminNote || '').trim().slice(0, 400);
  const now = new Date();
  const reviewerLabel = `${params.reviewerRole.toUpperCase()} @${params.reviewerUsername} (${params.reviewerShortUid})`;

  try {
    const [reqRow] = await db
      .select()
      .from(proRefundRequests)
      .where(eq(proRefundRequests.id, params.requestId))
      .limit(1);
    if (!reqRow) throw new Error('Refund request not found.');
    if (reqRow.status !== 'pending') {
      throw new Error(`Refund request has already been ${reqRow.status}.`);
    }

    const nextStatus = params.action === 'approve' ? 'approved' : 'rejected';
    const [updatedReq] = await db
      .update(proRefundRequests)
      .set({
        status: nextStatus,
        adminNote: note,
        reviewedByUserId: params.reviewerId,
        reviewedByLabel: reviewerLabel,
        reviewedAt: now.toISOString(),
      })
      .where(eq(proRefundRequests.id, reqRow.id))
      .returning();

    const [targetUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, reqRow.userId))
      .limit(1);

    if (params.action === 'approve' && targetUser && reqRow.requestedRefundPoints > 0) {
      const nextPts = targetUser.infinitePoints
        ? INFINITE_POINTS_SENTINEL
        : targetUser.points + reqRow.requestedRefundPoints;
      await db
        .update(users)
        .set({
          points: nextPts,
          updatedAt: now,
        })
        .where(eq(users.id, targetUser.id));

      await db.insert(pointTransactions).values({
        userId: targetUser.id,
        amount: reqRow.requestedRefundPoints,
        reason: `Plan Cancellation Refund Approved (+${reqRow.requestedRefundPoints} pts · ${
          reqRow.refundBasis === 'flat_60_percent' ? '60% Non-Timed' : 'Remaining Time − 5%'
        })`,
        category: 'pro_refund',
        verificationStatus: 'verified',
        verifiedByUserId: params.reviewerId,
        verifiedByLabel: reviewerLabel,
        verificationNote: note || 'Approved cancellation refund',
        verifiedAt: now.toISOString(),
      });
    }

    if (targetUser) {
      await db.insert(userMessages).values({
        senderId: params.reviewerId,
        recipientId: targetUser.id,
        senderEmail: params.reviewerEmail,
        senderUsername: params.reviewerUsername,
        recipientEmail: targetUser.email,
        recipientUsername: targetUser.username,
        visibility: 'direct',
        isAdminMail: true,
        recipientSummary: `@${targetUser.username}`,
        subject:
          params.action === 'approve'
            ? `Subscription Refund Approved (+${reqRow.requestedRefundPoints} pts)`
            : 'Subscription Refund Request Declined',
        body:
          params.action === 'approve'
            ? `Hello ${targetUser.displayName},\n\nAn Admin (${reviewerLabel}) approved your cancellation refund of +${reqRow.requestedRefundPoints} points.${note ? `\n\nAdmin Note: ${note}` : ''}`
            : `Hello ${targetUser.displayName},\n\nYour cancellation refund request for ${reqRow.requestedRefundPoints} points was declined by ${reviewerLabel}.${note ? `\n\nReason: ${note}` : ''}`,
      });

      await db.insert(notifications).values({
        userId: targetUser.id,
        senderId: params.reviewerId,
        senderLabel: 'Admin Oversight',
        title:
          params.action === 'approve'
            ? `Refund Approved: +${reqRow.requestedRefundPoints} pts`
            : 'Refund Request Declined',
        message:
          params.action === 'approve'
            ? `+${reqRow.requestedRefundPoints} points credited to your balance.`
            : note || 'Check Tool Mail for details.',
        type: params.action === 'approve' ? 'points' : 'warning',
      });
    }

    return updatedReq;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const reqRow = store.proRefundRequests.find((r) => r.id === params.requestId);
    if (!reqRow) throw new Error('Refund request not found.');
    if (reqRow.status !== 'pending') {
      throw new Error(`Refund request has already been ${reqRow.status}.`);
    }
    reqRow.status = params.action === 'approve' ? 'approved' : 'rejected';
    reqRow.adminNote = note;
    reqRow.reviewedByUserId = params.reviewerId;
    reqRow.reviewedByLabel = reviewerLabel;
    reqRow.reviewedAt = now.toISOString();

    const targetUser = store.users.find((u) => u.id === reqRow.userId);
    if (params.action === 'approve' && targetUser && reqRow.requestedRefundPoints > 0) {
      targetUser.points = targetUser.infinitePoints
        ? INFINITE_POINTS_SENTINEL
        : targetUser.points + reqRow.requestedRefundPoints;
      targetUser.updatedAt = now;
      store.pointTransactions.unshift({
        id: nextSeq('pointTransactions'),
        userId: targetUser.id,
        amount: reqRow.requestedRefundPoints,
        reason: `Plan Cancellation Refund Approved (+${reqRow.requestedRefundPoints} pts)`,
        category: 'pro_refund',
        verificationStatus: 'verified',
        verifiedByUserId: params.reviewerId,
        verifiedByLabel: reviewerLabel,
        verificationNote: note || 'Approved cancellation refund',
        verifiedAt: now.toISOString(),
        createdAt: now,
      });
    }

    if (targetUser) {
      localSendSystemMail({
        recipient: targetUser,
        senderId: params.reviewerId,
        senderEmail: params.reviewerEmail,
        senderUsername: params.reviewerUsername,
        senderLabel: 'Admin Oversight',
        isAdminMail: true,
        subject:
          params.action === 'approve'
            ? `Subscription Refund Approved (+${reqRow.requestedRefundPoints} pts)`
            : 'Subscription Refund Request Declined',
        body:
          params.action === 'approve'
            ? `Approved refund of +${reqRow.requestedRefundPoints} pts.${note ? ` Note: ${note}` : ''}`
            : `Refund request declined.${note ? ` Reason: ${note}` : ''}`,
        notifTitle:
          params.action === 'approve'
            ? `Refund Approved: +${reqRow.requestedRefundPoints} pts`
            : 'Refund Request Declined',
        notifMessage:
          params.action === 'approve'
            ? `+${reqRow.requestedRefundPoints} pts credited.`
            : note || 'See Tool Mail.',
        notifType: params.action === 'approve' ? 'points' : 'warning',
      });
    }
    persistLocalStore();
    return reqRow;
  }
}
