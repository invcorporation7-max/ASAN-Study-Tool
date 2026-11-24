import fs from 'fs';
import path from 'path';
import type { A4PageContent } from './schema.ts';
import type { PointRewardsConfig } from '../types.ts';

export const ADMIN_OWNER_EMAIL = 'invcorporation7@gmail.com';
export const CONSTANT_ADMIN_LICENSE_KEY = 'ADM9ASAN';

export interface StoreUser {
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
  passwordHash: string;
  authMode: string;
  points: number;
  proStartedAt: string;
  proExpiresAt: string;
  lastExpiryReminderFor: string;
  contributorApproved: boolean;
  contributorRequested: boolean;
  adminAuthorized: boolean;
  adminFirstGiftClaimed: boolean;
  lastWeeklyGrantWeek: string;
  spectraUrl: string;
  driveFolderId: string;
  scheduleSheetId: string;
  workspacePermissions?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoreTask {
  id: number;
  userId: number;
  title: string;
  description: string;
  subject: string;
  priority: string;
  status: string;
  dueDate: string;
  dueTime: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoreEvent {
  id: number;
  userId: number;
  title: string;
  eventDate: string;
  eventTime: string;
  category: string;
  notes: string;
  meetLink: string;
  createdAt: Date;
}

export interface StoreNotebook {
  id: number;
  userId: number;
  title: string;
  subject: string;
  color: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoreNotePage {
  id: number;
  notebookId: number;
  userId: number;
  sectionName: string;
  title: string;
  pagesData: A4PageContent[];
  createdAt: Date;
  updatedAt: Date;
}

export interface StoreExam {
  id: number;
  userId: number;
  subject: string;
  paperName: string;
  examType: string;
  customExamType: string;
  readingMinutes: number;
  writingMinutes: number;
  seatingTime: string;
  alarmEnabled: boolean;
  hourlyAlarm: boolean;
  status: string;
  createdAt: Date;
}

export interface StoreStudyLog {
  id: number;
  userId: number;
  mode: string;
  label: string;
  durationSeconds: number;
  createdAt: Date;
}

export interface StoreContactMessage {
  id: number;
  userId: number | null;
  name: string;
  email: string;
  subject: string;
  message: string;
  createdAt: Date;
}

export interface StoreUserMessage {
  id: number;
  senderId: number;
  recipientId: number | null;
  senderEmail: string;
  senderUsername: string;
  recipientEmail: string;
  recipientUsername: string;
  visibility: string;
  isAdminMail: boolean;
  recipientSummary: string;
  subject: string;
  body: string;
  attachmentTitle: string;
  attachmentNoteId: number | null;
  isRead: boolean;
  createdAt: Date;
}

export interface StoreLicenseKey {
  id: number;
  keyCode: string;
  keyType: string;
  durationMonths: number;
  issuedToUserId: number | null;
  issuedToEmail: string;
  issuedByUserId: number | null;
  activationExpiresAt: string;
  activatedByUserId: number | null;
  activatedAt: string;
  subStartsAt: string;
  subEndsAt: string;
  status: string;
  createdAt: Date;
}

export interface StorePointTransaction {
  id: number;
  userId: number;
  amount: number;
  reason: string;
  category: string;
  verificationStatus?: string;
  verifiedByUserId?: number | null;
  verifiedByLabel?: string;
  verificationNote?: string;
  verifiedAt?: string;
  revertedTransactionId?: number | null;
  createdAt: Date;
}

export interface StoreNotification {
  id: number;
  userId: number | null;
  senderId: number | null;
  senderLabel: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: Date;
}

export interface StoreStudyMaterial {
  id: number;
  uploaderId: number;
  uploaderEmail: string;
  uploaderName: string;
  title: string;
  subject: string;
  category: string;
  description?: string;
  fileName: string;
  storedFileName: string;
  mimeType: string;
  fileSizeBytes: number;
  pageCount: number;
  hourlyRentCost: number;
  buyCost: number;
  driveFileId: string;
  driveWebLink: string;
  status: string;
  createdAt: Date;
}

export interface StoreMaterialPurchase {
  id: number;
  materialId: number;
  materialTitle: string;
  buyerId: number;
  buyerEmail: string;
  buyerName: string;
  uploaderId: number;
  accessType: string;
  hours: number;
  hourlyRate: number;
  pageCount: number;
  totalCost: number;
  expiresAt: string;
  createdAt: Date;
}

export interface StoreExamBlueprint {
  id: number;
  userId: number;
  paperCode: string;
  subject: string;
  examType: string;
  examDate: string;
  examTime: string;
  totalMarks: number;
  marksScored: number | null;
  percentage: string;
  syllabus: string[];
  questionPaperUrl: string;
  answerSheetUrl: string;
  correctedAnswerSheetUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoreContributorFolder {
  id: number;
  userId: number;
  username: string;
  name: string;
  parentId: number | null;
  path: string;
  driveFolderId: string;
  masterDriveFolderId: string;
  createdAt: Date;
}

export interface StoreContributorFile {
  id: number;
  userId: number;
  username: string;
  folderId: number | null;
  folderPath: string;
  fileName: string;
  storedFileName: string;
  mimeType: string;
  fileSizeBytes: number;
  driveFileId: string;
  driveWebLink: string;
  masterDriveFileId: string;
  masterDriveWebLink: string;
  createdAt: Date;
}

export interface StoreExamCountdown {
  id: number;
  userId: number | null;
  scope: string;
  title: string;
  category: string;
  targetDate: string;
  targetTime: string;
  pinnedByDefault: boolean;
  createdByLabel: string;
  createdAt: Date;
}

interface LocalStoreData {
  seq: Record<string, number>;
  settings: {
    contributorWeeklyPoints: number;
    pointRewards?: PointRewardsConfig;
  };
  users: StoreUser[];
  tasks: StoreTask[];
  calendarEvents: StoreEvent[];
  notebooks: StoreNotebook[];
  notePages: StoreNotePage[];
  examSchedules: StoreExam[];
  studyLogs: StoreStudyLog[];
  contactMessages: StoreContactMessage[];
  userMessages: StoreUserMessage[];
  licenseKeys: StoreLicenseKey[];
  pointTransactions: StorePointTransaction[];
  notifications: StoreNotification[];
  studyMaterials: StoreStudyMaterial[];
  materialPurchases: StoreMaterialPurchase[];
  examBlueprints: StoreExamBlueprint[];
  contributorFolders: StoreContributorFolder[];
  contributorFiles: StoreContributorFile[];
  examCountdowns: StoreExamCountdown[];
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const STORE_PATH = path.join(DATA_DIR, 'asan_store.json');

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

let cachedStore: LocalStoreData | null = null;

function reviveDates(data: LocalStoreData): LocalStoreData {
  const toDate = (v: unknown) => (v instanceof Date ? v : new Date(String(v || Date.now())));
  data.users.forEach((u) => {
    u.createdAt = toDate(u.createdAt);
    u.updatedAt = toDate(u.updatedAt);
    if (!u.viewPlanMode) u.viewPlanMode = 'auto';
    if (u.lastExpiryReminderFor === undefined) u.lastExpiryReminderFor = '';
    if (u.shortUid === undefined) u.shortUid = '';
    if (u.passwordHash === undefined) u.passwordHash = '';
    if (!u.authMode) u.authMode = 'google';
    if (u.email.toLowerCase() === ADMIN_OWNER_EMAIL) {
      u.role = 'super';
      u.adminAuthorized = true;
    }
  });
  data.tasks.forEach((t) => {
    t.createdAt = toDate(t.createdAt);
    t.updatedAt = toDate(t.updatedAt);
  });
  data.calendarEvents.forEach((e) => {
    e.createdAt = toDate(e.createdAt);
  });
  data.notebooks.forEach((n) => {
    n.createdAt = toDate(n.createdAt);
    n.updatedAt = toDate(n.updatedAt);
  });
  data.notePages.forEach((p) => {
    p.createdAt = toDate(p.createdAt);
    p.updatedAt = toDate(p.updatedAt);
  });
  data.examSchedules.forEach((ex) => {
    ex.createdAt = toDate(ex.createdAt);
  });
  data.studyLogs.forEach((l) => {
    l.createdAt = toDate(l.createdAt);
  });
  data.contactMessages.forEach((c) => {
    c.createdAt = toDate(c.createdAt);
  });
  data.userMessages.forEach((m) => {
    m.createdAt = toDate(m.createdAt);
  });
  data.licenseKeys.forEach((k) => {
    k.createdAt = toDate(k.createdAt);
  });
  data.pointTransactions.forEach((pt) => {
    pt.createdAt = toDate(pt.createdAt);
    if (!pt.verificationStatus) pt.verificationStatus = 'pending';
    if (pt.verifiedByLabel === undefined) pt.verifiedByLabel = '';
    if (pt.verificationNote === undefined) pt.verificationNote = '';
    if (pt.verifiedAt === undefined) pt.verifiedAt = '';
  });
  data.notifications.forEach((nt) => {
    nt.createdAt = toDate(nt.createdAt);
  });
  data.studyMaterials.forEach((sm) => {
    sm.createdAt = toDate(sm.createdAt);
    if (sm.description === undefined) sm.description = '';
    if (!sm.pageCount || sm.pageCount < 1) sm.pageCount = 1;
    if (!sm.hourlyRentCost || sm.hourlyRentCost < 5) sm.hourlyRentCost = 10;
    if (!sm.buyCost || sm.buyCost < 5) sm.buyCost = 40;
  });
  (data.materialPurchases || []).forEach((mp) => {
    mp.createdAt = toDate(mp.createdAt);
  });
  (data.examBlueprints || []).forEach((eb) => {
    eb.createdAt = toDate(eb.createdAt);
    eb.updatedAt = toDate(eb.updatedAt);
  });
  (data.contributorFolders || []).forEach((cf) => {
    cf.createdAt = toDate(cf.createdAt);
  });
  (data.contributorFiles || []).forEach((cfi) => {
    cfi.createdAt = toDate(cfi.createdAt);
  });
  (data.examCountdowns || []).forEach((ec) => {
    ec.createdAt = toDate(ec.createdAt);
  });
  if (!data.settings || typeof data.settings.contributorWeeklyPoints !== 'number') {
    data.settings = { contributorWeeklyPoints: 120 };
  }
  return data;
}

export function getLocalStore(): LocalStoreData {
  if (cachedStore) return cachedStore;
  ensureDirs();
  if (fs.existsSync(STORE_PATH)) {
    try {
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Partial<LocalStoreData>;
      cachedStore = reviveDates({
        seq: parsed.seq || {},
        settings: parsed.settings || { contributorWeeklyPoints: 120 },
        users: parsed.users || [],
        tasks: parsed.tasks || [],
        calendarEvents: parsed.calendarEvents || [],
        notebooks: parsed.notebooks || [],
        notePages: parsed.notePages || [],
        examSchedules: parsed.examSchedules || [],
        studyLogs: parsed.studyLogs || [],
        contactMessages: parsed.contactMessages || [],
        userMessages: parsed.userMessages || [],
        licenseKeys: parsed.licenseKeys || [],
        pointTransactions: parsed.pointTransactions || [],
        notifications: parsed.notifications || [],
        studyMaterials: parsed.studyMaterials || [],
        materialPurchases: parsed.materialPurchases || [],
        examBlueprints: parsed.examBlueprints || [],
        contributorFolders: parsed.contributorFolders || [],
        contributorFiles: parsed.contributorFiles || [],
        examCountdowns: parsed.examCountdowns || [],
      });
      return cachedStore;
    } catch {
      // fall through to fresh store
    }
  }
  cachedStore = {
    seq: {},
    settings: { contributorWeeklyPoints: 120 },
    users: [],
    tasks: [],
    calendarEvents: [],
    notebooks: [],
    notePages: [],
    examSchedules: [],
    studyLogs: [],
    contactMessages: [],
    userMessages: [],
    licenseKeys: [],
    pointTransactions: [],
    notifications: [],
    studyMaterials: [],
    materialPurchases: [],
    examBlueprints: [],
    contributorFolders: [],
    contributorFiles: [],
    examCountdowns: [],
  };
  persistLocalStore();
  return cachedStore;
}

export function persistLocalStore() {
  try {
    ensureDirs();
    if (!cachedStore) return;
    fs.writeFileSync(STORE_PATH, JSON.stringify(cachedStore, null, 2), 'utf8');
  } catch (err) {
    console.warn('Local store persist warning:', err instanceof Error ? err.message : err);
  }
}

export function nextSeq(table: string): number {
  const store = getLocalStore();
  const next = (store.seq[table] || 0) + 1;
  store.seq[table] = next;
  return next;
}

export function isDbUnavailableError(err: unknown): boolean {
  if (!err) return false;
  const visited = new Set<unknown>();
  const check = (e: unknown): boolean => {
    if (!e || typeof e !== 'object' || visited.has(e)) return false;
    visited.add(e);
    const rec = e as Record<string, unknown>;
    const msg = String(rec.message || '');
    const code = String(rec.code || '');
    const name = String(rec.name || '');
    if (
      code === 'ERR_INVALID_URL' ||
      code === 'ENOENT' ||
      code === 'ENOTFOUND' ||
      code === 'ECONNREFUSED' ||
      code === 'ECONNRESET' ||
      code === 'ECONNABORTED' ||
      code === 'ETIMEDOUT' ||
      code === 'ENETUNREACH' ||
      code === 'EHOSTUNREACH' ||
      code === 'EAI_AGAIN' ||
      code === 'EPIPE' ||
      code === '08001' ||
      code === '08003' ||
      code === '08004' ||
      code === '08006' ||
      code === '28000' ||
      code === '28P01' ||
      code === '3D000' ||
      code === '42P01' ||
      code === '42703' ||
      code === '57P01' ||
      code === '57P02' ||
      code === '57P03' ||
      msg.includes('Invalid URL') ||
      msg.includes('ENOENT') ||
      msg.includes('ENOTFOUND') ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('ECONNRESET') ||
      msg.includes('ENETUNREACH') ||
      msg.includes('EHOSTUNREACH') ||
      msg.includes('EAI_AGAIN') ||
      msg.includes('Connection terminated') ||
      msg.includes('timeout exceeded') ||
      msg.includes('SASL') ||
      msg.includes('timeout') ||
      msg.includes('does not exist') ||
      msg.includes('too many clients') ||
      msg.includes('starting up') ||
      name === 'AggregateError'
    ) {
      if (name === 'AggregateError' && Array.isArray(rec.errors)) {
        return rec.errors.some((sub) => check(sub)) || rec.errors.length === 0;
      }
      return true;
    }
    if (Array.isArray(rec.errors) && rec.errors.some((sub) => check(sub))) {
      return true;
    }
    if (rec.cause) return check(rec.cause);
    return false;
  };
  return check(err);
}
