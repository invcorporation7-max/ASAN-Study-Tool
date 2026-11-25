import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export interface NoteBlock {
  id: string;
  type: 'heading' | 'text' | 'checklist' | 'formula' | 'image';
  content: string;
  fontSize?: number;
  checked?: boolean;
}

export interface A4PageContent {
  id: string;
  pageNumber: number;
  title?: string;
  blocks: NoteBlock[];
}

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  shortUid: text('short_uid').notNull().default(''),
  email: text('email').notNull(),
  displayName: text('display_name').notNull().default('Student'),
  username: text('username').notNull().default(''),
  photoUrl: text('photo_url').notNull().default(''),
  plan: text('plan').notNull().default('basic'), // 'basic' | 'pro'
  viewPlanMode: text('view_plan_mode').notNull().default('auto'), // 'auto' | 'basic'
  role: text('role').notNull().default('user'), // 'user' | 'contributor' | 'admin' | 'super'
  passwordHash: text('password_hash').notNull().default(''),
  authMode: text('auth_mode').notNull().default('google'), // 'google' | 'password'
  points: integer('points').notNull().default(500),
  proStartedAt: text('pro_started_at').notNull().default(''),
  proExpiresAt: text('pro_expires_at').notNull().default(''),
  lastExpiryReminderFor: text('last_expiry_reminder_for').notNull().default(''),
  contributorApproved: boolean('contributor_approved').notNull().default(false),
  contributorRequested: boolean('contributor_requested').notNull().default(false),
  adminAuthorized: boolean('admin_authorized').notNull().default(false),
  adminFirstGiftClaimed: boolean('admin_first_gift_claimed').notNull().default(false),
  lastWeeklyGrantWeek: text('last_weekly_grant_week').notNull().default(''),
  spectraUrl: text('spectra_url').notNull().default('https://www.khanacademy.org'),
  driveFolderId: text('drive_folder_id').notNull().default(''),
  scheduleSheetId: text('schedule_sheet_id').notNull().default(''),
  workspacePermissions: text('workspace_permissions').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const tasks = pgTable('tasks', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  subject: text('subject').notNull().default('General'),
  priority: text('priority').notNull().default('medium'),
  status: text('status').notNull().default('todo'),
  dueDate: text('due_date').notNull().default(''),
  dueTime: text('due_time').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const calendarEvents = pgTable('calendar_events', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  title: text('title').notNull(),
  eventDate: text('event_date').notNull(),
  eventTime: text('event_time').notNull().default('09:00'),
  category: text('category').notNull().default('study'),
  notes: text('notes').notNull().default(''),
  meetLink: text('meet_link').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const notebooks = pgTable('notebooks', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  title: text('title').notNull(),
  subject: text('subject').notNull().default('General'),
  color: text('color').notNull().default('#2563EB'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const notePages = pgTable('note_pages', {
  id: serial('id').primaryKey(),
  notebookId: integer('notebook_id')
    .references(() => notebooks.id, { onDelete: 'cascade' })
    .notNull(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  sectionName: text('section_name').notNull().default('Main Notes'),
  title: text('title').notNull(),
  pagesData: jsonb('pages_data').$type<A4PageContent[]>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const examSchedules = pgTable('exam_schedules', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  subject: text('subject').notNull(),
  paperName: text('paper_name').notNull().default(''),
  examType: text('exam_type').notNull(),
  customExamType: text('custom_exam_type').notNull().default(''),
  readingMinutes: integer('reading_minutes').notNull().default(15),
  writingMinutes: integer('writing_minutes').notNull().default(180),
  seatingTime: text('seating_time').notNull().default(''),
  alarmEnabled: boolean('alarm_enabled').notNull().default(true),
  hourlyAlarm: boolean('hourly_alarm').notNull().default(true),
  status: text('status').notNull().default('scheduled'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const studyLogs = pgTable('study_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  mode: text('mode').notNull(),
  label: text('label').notNull(),
  durationSeconds: integer('duration_seconds').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const contactMessages = pgTable('contact_messages', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  email: text('email').notNull(),
  subject: text('subject').notNull(),
  message: text('message').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const userMessages = pgTable('user_messages', {
  id: serial('id').primaryKey(),
  senderId: integer('sender_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  recipientId: integer('recipient_id').references(() => users.id, {
    onDelete: 'cascade',
  }),
  senderEmail: text('sender_email').notNull(),
  senderUsername: text('sender_username').notNull().default(''),
  recipientEmail: text('recipient_email').notNull().default(''),
  recipientUsername: text('recipient_username').notNull().default(''),
  visibility: text('visibility').notNull().default('direct'), // 'direct' | 'self' | 'public'
  isAdminMail: boolean('is_admin_mail').notNull().default(false),
  recipientSummary: text('recipient_summary').notNull().default(''),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  bodyHtml: text('body_html').notNull().default(''),
  attachmentsJson: jsonb('attachments_json').$type<Record<string, unknown>[]>().notNull().default([]),
  questionSpecJson: jsonb('question_spec_json').$type<Record<string, unknown> | null>(),
  attachmentTitle: text('attachment_title').notNull().default(''),
  attachmentNoteId: integer('attachment_note_id').references(() => notePages.id, {
    onDelete: 'set null',
  }),
  isRead: boolean('is_read').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const licenseKeys = pgTable('license_keys', {
  id: serial('id').primaryKey(),
  keyCode: text('key_code').notNull().unique(),
  keyType: text('key_type').notNull().default('pro'), // 'pro' | 'admin'
  durationMonths: integer('duration_months').notNull().default(1),
  issuedToUserId: integer('issued_to_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  issuedToEmail: text('issued_to_email').notNull().default(''),
  issuedByUserId: integer('issued_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  activationExpiresAt: text('activation_expires_at').notNull(),
  activatedByUserId: integer('activated_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  activatedAt: text('activated_at').notNull().default(''),
  subStartsAt: text('sub_starts_at').notNull().default(''),
  subEndsAt: text('sub_ends_at').notNull().default(''),
  status: text('status').notNull().default('unused'), // 'unused' | 'active' | 'expired'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const pointTransactions = pgTable('point_transactions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  amount: integer('amount').notNull(),
  reason: text('reason').notNull(),
  category: text('category').notNull(),
  verificationStatus: text('verification_status').notNull().default('pending'), // 'pending' | 'verified' | 'reverted' | 'dismissed'
  verifiedByUserId: integer('verified_by_user_id'),
  verifiedByLabel: text('verified_by_label').notNull().default(''),
  verificationNote: text('verification_note').notNull().default(''),
  verifiedAt: text('verified_at').notNull().default(''),
  revertedTransactionId: integer('reverted_transaction_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  senderId: integer('sender_id').references(() => users.id, { onDelete: 'set null' }),
  senderLabel: text('sender_label').notNull().default('System'),
  title: text('title').notNull(),
  message: text('message').notNull(),
  type: text('type').notNull().default('info'),
  isRead: boolean('is_read').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const studyMaterials = pgTable('study_materials', {
  id: serial('id').primaryKey(),
  uploaderId: integer('uploader_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  uploaderEmail: text('uploader_email').notNull(),
  uploaderName: text('uploader_name').notNull(),
  title: text('title').notNull(),
  subject: text('subject').notNull().default('General'),
  category: text('category').notNull().default('study_notes'), // 'question_paper' | 'study_notes' | 'booklet' | 'archive'
  mediaKind: text('media_kind').notNull().default('pdf'), // 'pdf' | 'photo' | 'video' | 'text' | 'word' | 'excel' | 'ppt' | 'recording'
  description: text('description').notNull().default(''),
  fileName: text('file_name').notNull(),
  storedFileName: text('stored_file_name').notNull(),
  mimeType: text('mime_type').notNull().default('application/octet-stream'),
  fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }).notNull().default(0),
  pageCount: integer('page_count').notNull().default(1),
  hourlyRentCost: integer('hourly_rent_cost').notNull().default(10),
  buyCost: integer('buy_cost').notNull().default(40),
  driveFileId: text('drive_file_id').notNull().default(''),
  driveWebLink: text('drive_web_link').notNull().default(''),
  status: text('status').notNull().default('approved'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const materialPurchases = pgTable('material_purchases', {
  id: serial('id').primaryKey(),
  materialId: integer('material_id')
    .references(() => studyMaterials.id, { onDelete: 'cascade' })
    .notNull(),
  materialTitle: text('material_title').notNull().default(''),
  buyerId: integer('buyer_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  buyerEmail: text('buyer_email').notNull(),
  buyerName: text('buyer_name').notNull(),
  uploaderId: integer('uploader_id').notNull(),
  accessType: text('access_type').notNull().default('rent'), // 'rent' | 'buy'
  hours: integer('hours').notNull().default(1),
  hourlyRate: integer('hourly_rate').notNull().default(10),
  pageCount: integer('page_count').notNull().default(1),
  totalCost: integer('total_cost').notNull().default(10),
  expiresAt: text('expires_at').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const examBlueprints = pgTable('exam_blueprints', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  paperCode: text('paper_code').notNull(),
  subject: text('subject').notNull(),
  examType: text('exam_type').notNull().default('JEE Main'),
  examDate: text('exam_date').notNull(),
  examTime: text('exam_time').notNull().default('09:00'),
  totalMarks: integer('total_marks').notNull().default(100),
  marksScored: integer('marks_scored'),
  percentage: text('percentage').notNull().default(''),
  syllabus: jsonb('syllabus').$type<string[]>().notNull(),
  questionPaperUrl: text('question_paper_url').notNull().default(''),
  answerSheetUrl: text('answer_sheet_url').notNull().default(''),
  correctedAnswerSheetUrl: text('corrected_answer_sheet_url').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const contributorFolders = pgTable('contributor_folders', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  username: text('username').notNull().default(''),
  name: text('name').notNull(),
  parentId: integer('parent_id'),
  path: text('path').notNull(),
  driveFolderId: text('drive_folder_id').notNull().default(''),
  masterDriveFolderId: text('master_drive_folder_id').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const contributorFiles = pgTable('contributor_files', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  username: text('username').notNull().default(''),
  folderId: integer('folder_id').references(() => contributorFolders.id, {
    onDelete: 'set null',
  }),
  folderPath: text('folder_path').notNull().default(''),
  fileName: text('file_name').notNull(),
  storedFileName: text('stored_file_name').notNull(),
  mimeType: text('mime_type').notNull().default('application/octet-stream'),
  fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }).notNull().default(0),
  driveFileId: text('drive_file_id').notNull().default(''),
  driveWebLink: text('drive_web_link').notNull().default(''),
  masterDriveFileId: text('master_drive_file_id').notNull().default(''),
  masterDriveWebLink: text('master_drive_web_link').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const examCountdowns = pgTable('exam_countdowns', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  scope: text('scope').notNull().default('user'), // 'admin' | 'user'
  title: text('title').notNull(),
  category: text('category').notNull().default(''),
  targetDate: text('target_date').notNull(), // YYYY-MM-DD
  targetTime: text('target_time').notNull().default(''), // '' or HH:mm
  pinnedByDefault: boolean('pinned_by_default').notNull().default(false),
  createdByLabel: text('created_by_label').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const proRefundRequests = pgTable('pro_refund_requests', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  userEmail: text('user_email').notNull(),
  username: text('username').notNull().default(''),
  displayName: text('display_name').notNull().default(''),
  shortUid: text('short_uid').notNull().default(''),
  planTerm: text('plan_term').notNull().default('monthly'),
  refundBasis: text('refund_basis').notNull().default('time_remaining_minus_5'), // 'time_remaining_minus_5' | 'flat_60_percent'
  pointsPaid: integer('points_paid').notNull().default(0),
  remainingPercent: integer('remaining_percent').notNull().default(0),
  remainingDays: integer('remaining_days').notNull().default(0),
  totalDays: integer('total_days').notNull().default(30),
  requestedRefundPoints: integer('requested_refund_points').notNull().default(0),
  reason: text('reason').notNull().default(''),
  status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected'
  adminNote: text('admin_note').notNull().default(''),
  reviewedByUserId: integer('reviewed_by_user_id'),
  reviewedByLabel: text('reviewed_by_label').notNull().default(''),
  reviewedAt: text('reviewed_at').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const forumRooms = pgTable('forum_rooms', {
  id: serial('id').primaryKey(),
  roomType: text('room_type').notNull().default('group'), // 'global_qa' | 'group' | 'dm'
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  subject: text('subject').notNull().default('General'),
  dmKey: text('dm_key').notNull().default(''),
  createdById: integer('created_by_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const forumMembers = pgTable('forum_members', {
  id: serial('id').primaryKey(),
  roomId: integer('room_id')
    .references(() => forumRooms.id, { onDelete: 'cascade' })
    .notNull(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  memberRole: text('member_role').notNull().default('member'), // 'owner' | 'member'
  lastReadAt: timestamp('last_read_at').defaultNow().notNull(),
  joinedAt: timestamp('joined_at').defaultNow().notNull(),
});

export const forumPosts = pgTable('forum_posts', {
  id: serial('id').primaryKey(),
  roomId: integer('room_id')
    .references(() => forumRooms.id, { onDelete: 'cascade' })
    .notNull(),
  authorId: integer('author_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  postKind: text('post_kind').notNull().default('question'), // 'question' | 'message'
  title: text('title').notNull().default(''),
  contentHtml: text('content_html').notNull().default(''),
  contentText: text('content_text').notNull().default(''),
  subject: text('subject').notNull().default('General'),
  examBoard: text('exam_board').notNull().default('Competitive / Custom'),
  questionSpec: jsonb('question_spec').$type<Record<string, unknown> | null>(),
  answerKey: jsonb('answer_key').$type<Record<string, unknown> | null>(),
  officialExplanationHtml: text('official_explanation_html').notNull().default(''),
  isSolved: boolean('is_solved').notNull().default(false),
  acceptedReplyId: integer('accepted_reply_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const forumAttempts = pgTable('forum_attempts', {
  id: serial('id').primaryKey(),
  postId: integer('post_id')
    .references(() => forumPosts.id, { onDelete: 'cascade' })
    .notNull(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  attemptPayload: jsonb('attempt_payload').$type<Record<string, unknown>>().notNull(),
  isCorrect: boolean('is_correct'),
  scoreNote: text('score_note').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const forumReplies = pgTable('forum_replies', {
  id: serial('id').primaryKey(),
  postId: integer('post_id')
    .references(() => forumPosts.id, { onDelete: 'cascade' })
    .notNull(),
  authorId: integer('author_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  parentReplyId: integer('parent_reply_id'),
  replyKind: text('reply_kind').notNull().default('opinion'), // 'solution' | 'opinion' | 'refinement' | 'message'
  contentHtml: text('content_html').notNull().default(''),
  contentText: text('content_text').notNull().default(''),
  attemptPayload: jsonb('attempt_payload').$type<Record<string, unknown> | null>(),
  isAcceptedSolution: boolean('is_accepted_solution').notNull().default(false),
  acceptedPointsAwarded: integer('accepted_points_awarded').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const forumReplyVotes = pgTable('forum_reply_votes', {
  id: serial('id').primaryKey(),
  replyId: integer('reply_id')
    .references(() => forumReplies.id, { onDelete: 'cascade' })
    .notNull(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const forumAttachments = pgTable('forum_attachments', {
  id: serial('id').primaryKey(),
  postId: integer('post_id').references(() => forumPosts.id, { onDelete: 'cascade' }),
  replyId: integer('reply_id').references(() => forumReplies.id, { onDelete: 'cascade' }),
  messageId: integer('message_id').references(() => userMessages.id, { onDelete: 'cascade' }),
  uploaderId: integer('uploader_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  fileName: text('file_name').notNull(),
  storedFileName: text('stored_file_name').notNull(),
  mimeType: text('mime_type').notNull().default('application/octet-stream'),
  fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }).notNull().default(0),
  pageCount: integer('page_count').notNull().default(1),
  kind: text('kind').notNull().default('image'), // 'image' | 'pdf'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const formulaEquations = pgTable('formula_equations', {
  id: serial('id').primaryKey(),
  authorId: integer('author_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  authorName: text('author_name').notNull().default('Contributor'),
  authorUsername: text('author_username').notNull().default('contributor'),
  title: text('title').notNull(),
  subject: text('subject').notNull().default('Physics'),
  caseName: text('case_name').notNull().default('General'),
  expression: text('expression').notNull(),
  description: text('description').notNull().default(''),
  symbolsJson: jsonb('symbols_json').$type<{ symbol: string; meaning: string; unit?: string }[]>().notNull().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  tasks: many(tasks),
  calendarEvents: many(calendarEvents),
  notebooks: many(notebooks),
  notePages: many(notePages),
  examSchedules: many(examSchedules),
  studyLogs: many(studyLogs),
}));

export const notebooksRelations = relations(notebooks, ({ one, many }) => ({
  owner: one(users, {
    fields: [notebooks.userId],
    references: [users.id],
  }),
  pages: many(notePages),
}));

export const notePagesRelations = relations(notePages, ({ one }) => ({
  notebook: one(notebooks, {
    fields: [notePages.notebookId],
    references: [notebooks.id],
  }),
  owner: one(users, {
    fields: [notePages.userId],
    references: [users.id],
  }),
}));
