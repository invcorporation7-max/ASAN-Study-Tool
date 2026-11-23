export type NavSection =
  | 'dashboard'
  | 'all-apps'
  | 'calendar'
  | 'tasks'
  | 'notes'
  | 'timers'
  | 'calculator'
  | 'messages'
  | 'notifications'
  | 'study-materials'
  | 'contributor-console'
  | 'subscriptions'
  | 'pdf-tool'
  | 'workspace'
  | 'spectra'
  | 'admin'
  | 'super'
  | 'more'
  | 'plans'
  | 'about'
  | 'contact';

export interface WorkspacePermissionsConfig {
  driveSync: boolean;
  docsExport: boolean;
  sheetsSync: boolean;
  meetRooms: boolean;
}

export interface PointRewardsConfig {
  noteCreate: number;
  calendarStudyEvent: number;
  questionPaperUpload: number;
  studyMaterialUpload: number;
  examTimer30Min: number;
  contributorWeekly: number;
}

export interface DbUser {
  id: number;
  uid: string;
  shortUid: string;
  email: string;
  displayName: string;
  username: string;
  photoUrl: string;
  plan: 'free' | 'basic' | 'pro' | string;
  viewPlanMode?: 'auto' | 'basic' | string;
  role: 'user' | 'contributor' | 'admin' | 'super' | string;
  authMode?: 'google' | 'password' | string;
  hasPassword?: boolean;
  points: number;
  proStartedAt: string;
  proExpiresAt: string;
  lastExpiryReminderFor?: string;
  contributorApproved: boolean;
  contributorRequested: boolean;
  adminAuthorized: boolean;
  adminFirstGiftClaimed: boolean;
  lastWeeklyGrantWeek: string;
  spectraUrl: string;
  driveFolderId: string;
  scheduleSheetId: string;
  workspacePermissions?: WorkspacePermissionsConfig;
  createdAt?: string;
}

export interface ContributorFolderItem {
  id: number;
  userId: number;
  username: string;
  name: string;
  parentId: number | null;
  path: string;
  driveFolderId: string;
  masterDriveFolderId: string;
  createdAt: string;
}

export interface ContributorFileItem {
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
  createdAt: string;
}

export interface SavedAccountEntry {
  uid: string;
  shortUid: string;
  email: string;
  displayName: string;
  username: string;
  photoUrl: string;
  role: string;
  plan: string;
  authMode: 'google' | 'password';
  passwordToken?: string;
  token?: string;
  lastUsedAt: string;
}

export interface ToolUserSummary {
  id: number;
  shortUid: string;
  email: string;
  displayName: string;
  username: string;
  plan: string;
  role: string;
  contributorApproved: boolean;
  photoUrl?: string;
}

export interface CreditContributorItem {
  id: number;
  displayName: string;
  username: string;
  shortUid: string;
  plan: string;
  role: string;
  contributorApproved: boolean;
  photoUrl: string;
}

export interface InAppMessageItem {
  id: number;
  senderId: number;
  recipientId: number | null;
  senderEmail: string;
  senderUsername: string;
  recipientEmail: string;
  recipientUsername: string;
  visibility: 'direct' | 'self' | 'public' | string;
  isAdminMail: boolean;
  recipientSummary: string;
  subject: string;
  body: string;
  attachmentTitle: string;
  attachmentNoteId: number | null;
  isRead: boolean;
  createdAt: string;
}

export interface ContactMessageItem {
  id: number;
  userId: number | null;
  name: string;
  email: string;
  subject: string;
  message: string;
  createdAt: string;
}

export interface LicenseKeyItem {
  id: number;
  keyCode: string;
  keyType: 'pro' | 'admin' | string;
  durationMonths?: number;
  issuedToUserId: number | null;
  issuedToEmail: string;
  issuedByUserId: number | null;
  activationExpiresAt: string;
  activatedByUserId: number | null;
  activatedAt: string;
  subStartsAt: string;
  subEndsAt: string;
  status: 'unused' | 'active' | 'expired' | string;
  createdAt: string;
}

export interface ExamBlueprintItem {
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
  createdAt: string;
  updatedAt: string;
}

export interface PointTransactionItem {
  id: number;
  userId: number;
  amount: number;
  reason: string;
  category: string;
  verificationStatus?: 'pending' | 'verified' | 'reverted' | 'dismissed' | string;
  verifiedByUserId?: number | null;
  verifiedByLabel?: string;
  verificationNote?: string;
  verifiedAt?: string;
  revertedTransactionId?: number | null;
  createdAt: string;
}

export interface NotificationItem {
  id: number;
  userId: number | null;
  senderId: number | null;
  senderLabel: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: string;
}

export interface StudyMaterialItem {
  id: number;
  uploaderId: number;
  uploaderEmail: string;
  uploaderName: string;
  title: string;
  subject: string;
  category: 'question_paper' | 'study_notes' | 'booklet' | 'archive' | string;
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
  createdAt: string;
}

export interface MaterialPurchaseItem {
  id: number;
  materialId: number;
  materialTitle: string;
  buyerId: number;
  buyerEmail: string;
  buyerName: string;
  uploaderId: number;
  accessType: 'rent' | 'buy' | string;
  hours: number;
  hourlyRate: number;
  pageCount: number;
  totalCost: number;
  expiresAt: string;
  createdAt: string;
}

export interface StudyTask {
  id: number;
  userId: number;
  title: string;
  description: string;
  subject: string;
  priority: 'low' | 'medium' | 'high';
  status: 'todo' | 'in_progress' | 'done';
  dueDate: string;
  dueTime: string;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEventItem {
  id: number;
  userId: number;
  title: string;
  eventDate: string;
  eventTime: string;
  category: string;
  notes: string;
  meetLink: string;
  createdAt: string;
}

export interface StudyNotebook {
  id: number;
  userId: number;
  title: string;
  subject: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteBlockItem {
  id: string;
  type: 'heading' | 'text' | 'checklist' | 'formula' | 'image';
  content: string;
  fontSize?: number;
  checked?: boolean;
}

export interface A4PageItem {
  id: string;
  pageNumber: number;
  title?: string;
  blocks: NoteBlockItem[];
}

export interface StudyNotePage {
  id: number;
  notebookId: number;
  userId: number;
  sectionName: string;
  title: string;
  pagesData: A4PageItem[];
  pointsAwarded?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExamScheduleItem {
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
  createdAt: string;
}

export interface StudyLogItem {
  id: number;
  userId: number;
  mode: string;
  label: string;
  durationSeconds: number;
  createdAt: string;
}

export interface GA4ReportResponse {
  configured: boolean;
  trackingConfigured: boolean;
  measurementId: string;
  propertyId?: string;
  range: '7d' | '28d' | '90d';
  fetchedAt: string;
  cached?: boolean;
  reason?: string;
  realtimeActiveUsers: number;
  overview: {
    activeUsers: number;
    newUsers: number;
    sessions: number;
    engagedSessions: number;
    pageViews: number;
    engagementRate: number;
    avgSessionDurationSec: number;
  };
  daily: {
    date: string;
    activeUsers: number;
    sessions: number;
    pageViews: number;
  }[];
  topPages: {
    path: string;
    title: string;
    pageViews: number;
    activeUsers: number;
  }[];
  devices: {
    device: string;
    activeUsers: number;
    sessions: number;
  }[];
  countries: {
    country: string;
    activeUsers: number;
  }[];
}

export interface SuperUserPointRow extends DbUser {
  pointsEarned: number;
  pointsSpent: number;
  txCount: number;
  materialsCount: number;
  notesCount: number;
  tasksCount: number;
}

export interface SuperAuditTransactionItem extends PointTransactionItem {
  userEmail: string;
  username: string;
  displayName: string;
  shortUid: string;
  currentBalance?: number;
}

export interface AdminPointTransactionsResponse {
  summary: {
    total: number;
    pending: number;
    verified: number;
    reverted: number;
    dismissed: number;
  };
  transactions: SuperAuditTransactionItem[];
}

export interface SuperUsersPointsResponse {
  summary: {
    totalUsers: number;
    totalPointsCirculating: number;
    totalPointsEarned: number;
    totalPointsSpent: number;
    proUsers: number;
    basicUsers: number;
    approvedContributors: number;
    contributorWeeklyPoints: number;
  };
  users: SuperUserPointRow[];
  recentTransactions: SuperAuditTransactionItem[];
}

