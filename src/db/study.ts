import fs from 'fs';
import path from 'path';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { db } from './index.ts';
import {
  getLocalStore,
  isDbUnavailableError,
  nextSeq,
  persistLocalStore,
  UPLOADS_DIR,
} from './localStore.ts';
import {
  type A4PageContent,
  calendarEvents,
  contactMessages,
  contributorFiles,
  contributorFolders,
  examBlueprints,
  examCountdowns,
  examSchedules,
  licenseKeys,
  materialPurchases,
  notebooks,
  notePages,
  notifications,
  pointTransactions,
  proRefundRequests,
  studyLogs,
  studyMaterials,
  tasks,
  userMessages,
  users,
} from './schema.ts';
import {
  awardPoints,
  getContributorWeeklyPoints,
  getPointRewardsConfig,
  incrementCouponUsage,
  resolveValidCouponForScope,
  sanitizeUserForClient,
} from './users.ts';
import {
  calculateCancellationRefund,
  calculateRepoOrAppQuote,
  REPO_PLATFORM_FEE,
} from '../lib/pricing.ts';

const STUDY_KEYWORDS = [
  'study',
  'exam',
  'test',
  'mock',
  'revision',
  'revise',
  'lecture',
  'class',
  'lab',
  'assignment',
  'homework',
  'notes',
  'physics',
  'chemistry',
  'math',
  'maths',
  'biology',
  'calculus',
  'organic',
  'inorganic',
  'algebra',
  'geometry',
  'trigonometry',
  'syllabus',
  'chapter',
  'paper',
  'pyq',
  'jee',
  'neet',
  'cbse',
  'isc',
  'cuet',
  'practice',
  'quiz',
  'formula',
  'reading',
  'project',
  'thesis',
  'viva',
  'seminar',
  'coding',
  'tutorial',
  'workbook',
  'ncert',
  'mock test',
  'doubt',
];

const NON_STUDY_KEYWORDS = [
  'movie',
  'cinema',
  'party',
  'birthday',
  'dinner',
  'lunch',
  'shopping',
  'vacation',
  'trip',
  'holiday',
  'wedding',
  'gaming',
  'concert',
  'netflix',
  'picnic',
];

export function isStudyRelatedEvent(
  title: string,
  category?: string,
  notes?: string
): boolean {
  const cat = (category || '').trim().toLowerCase();
  const combined = `${title} ${notes || ''}`.toLowerCase();

  // Explicit non-study personal phrases fail the study verification unless paired with study keywords
  const hasNonStudy = NON_STUDY_KEYWORDS.some((kw) => combined.includes(kw));
  const hasStudyKeyword = STUDY_KEYWORDS.some((kw) => combined.includes(kw));

  if (hasStudyKeyword) return true;
  if (hasNonStudy) return false;
  if (cat === 'study' || cat === 'exam' || cat === 'deadline') return true;
  return false;
}

// --- TASKS ---
export async function getUserTasks(userId: number) {
  try {
    return await db
      .select()
      .from(tasks)
      .where(eq(tasks.userId, userId))
      .orderBy(desc(tasks.createdAt));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    return getLocalStore().tasks.filter((t) => t.userId === userId);
  }
}

export async function createTask(
  userId: number,
  data: {
    title: string;
    description?: string;
    subject?: string;
    priority?: string;
    dueDate?: string;
    dueTime?: string;
  }
) {
  try {
    const [created] = await db
      .insert(tasks)
      .values({
        userId,
        title: data.title,
        description: data.description || '',
        subject: data.subject || 'General',
        priority: data.priority || 'medium',
        status: 'todo',
        dueDate: data.dueDate || '',
        dueTime: data.dueTime || '',
      })
      .returning();
    return created;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const now = new Date();
    const created = {
      id: nextSeq('tasks'),
      userId,
      title: data.title,
      description: data.description || '',
      subject: data.subject || 'General',
      priority: data.priority || 'medium',
      status: 'todo',
      dueDate: data.dueDate || '',
      dueTime: data.dueTime || '',
      createdAt: now,
      updatedAt: now,
    };
    store.tasks.unshift(created);
    persistLocalStore();
    return created;
  }
}

export async function updateTask(
  userId: number,
  taskId: number,
  updates: {
    title?: string;
    description?: string;
    subject?: string;
    priority?: string;
    status?: string;
    dueDate?: string;
    dueTime?: string;
  }
) {
  try {
    const [updated] = await db
      .update(tasks)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
      .returning();
    return updated;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const item = store.tasks.find((t) => t.id === taskId && t.userId === userId);
    if (!item) return undefined;
    Object.assign(item, updates, { updatedAt: new Date() });
    persistLocalStore();
    return item;
  }
}

export async function deleteTask(userId: number, taskId: number) {
  try {
    await db.delete(tasks).where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    store.tasks = store.tasks.filter((t) => !(t.id === taskId && t.userId === userId));
    persistLocalStore();
  }
}

// --- CALENDAR EVENTS ---
export async function getUserCalendarEvents(userId: number) {
  try {
    return await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.userId, userId))
      .orderBy(calendarEvents.eventDate, calendarEvents.eventTime);
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    return getLocalStore()
      .calendarEvents.filter((e) => e.userId === userId)
      .sort((a, b) => `${a.eventDate} ${a.eventTime}`.localeCompare(`${b.eventDate} ${b.eventTime}`));
  }
}

export async function createCalendarEvent(
  userId: number,
  data: {
    title: string;
    eventDate: string;
    eventTime?: string;
    category?: string;
    notes?: string;
    meetLink?: string;
  }
) {
  const studyVerified = isStudyRelatedEvent(data.title, data.category, data.notes);
  const rewards = await getPointRewardsConfig();
  const pointsAwarded = studyVerified ? rewards.calendarStudyEvent : 0;

  try {
    const [created] = await db
      .insert(calendarEvents)
      .values({
        userId,
        title: data.title,
        eventDate: data.eventDate,
        eventTime: data.eventTime || '09:00',
        category: data.category || 'study',
        notes: data.notes || '',
        meetLink: data.meetLink || '',
      })
      .returning();

    if (pointsAwarded > 0) {
      await awardPoints(
        userId,
        pointsAwarded,
        `Study Calendar Event: ${data.title}`,
        'calendar_study'
      );
    }
    return { event: created, pointsAwarded, studyVerified };
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const created = {
      id: nextSeq('calendarEvents'),
      userId,
      title: data.title,
      eventDate: data.eventDate,
      eventTime: data.eventTime || '09:00',
      category: data.category || 'study',
      notes: data.notes || '',
      meetLink: data.meetLink || '',
      createdAt: new Date(),
    };
    store.calendarEvents.push(created);
    persistLocalStore();
    if (pointsAwarded > 0) {
      await awardPoints(
        userId,
        pointsAwarded,
        `Study Calendar Event: ${data.title}`,
        'calendar_study'
      );
    }
    return { event: created, pointsAwarded, studyVerified };
  }
}

export async function createCalendarEventsBulk(
  userId: number,
  data: {
    title: string;
    dates: string[];
    eventTime?: string;
    category?: string;
    notes?: string;
    meetLink?: string;
  }
) {
  const uniqueDates = Array.from(
    new Set(
      data.dates
        .map((d) => String(d).trim())
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    )
  ).sort();
  if (uniqueDates.length === 0) {
    throw new Error('Please provide at least one valid date (YYYY-MM-DD).');
  }
  if (uniqueDates.length > 366) {
    throw new Error('Maximum 366 dates can be scheduled in a single series.');
  }

  const studyVerified = isStudyRelatedEvent(data.title, data.category, data.notes);
  const rewards = await getPointRewardsConfig();
  const pointsAwarded = studyVerified ? rewards.calendarStudyEvent : 0;
  const eventTime = data.eventTime || '09:00';
  const category = data.category || 'study';
  const notes = data.notes || '';
  const meetLink = data.meetLink || '';

  try {
    const rows = await db
      .insert(calendarEvents)
      .values(
        uniqueDates.map((eventDate) => ({
          userId,
          title: data.title,
          eventDate,
          eventTime,
          category,
          notes,
          meetLink,
        }))
      )
      .returning();

    if (pointsAwarded > 0) {
      await awardPoints(
        userId,
        pointsAwarded,
        `Study Calendar Series (${uniqueDates.length} dates): ${data.title}`,
        'calendar_study'
      );
    }
    return { events: rows, count: rows.length, pointsAwarded, studyVerified };
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const created = uniqueDates.map((eventDate) => {
      const row = {
        id: nextSeq('calendarEvents'),
        userId,
        title: data.title,
        eventDate,
        eventTime,
        category,
        notes,
        meetLink,
        createdAt: new Date(),
      };
      store.calendarEvents.push(row);
      return row;
    });
    persistLocalStore();
    if (pointsAwarded > 0) {
      await awardPoints(
        userId,
        pointsAwarded,
        `Study Calendar Series (${uniqueDates.length} dates): ${data.title}`,
        'calendar_study'
      );
    }
    return { events: created, count: created.length, pointsAwarded, studyVerified };
  }
}

export async function deleteCalendarEvent(userId: number, eventId: number) {
  try {
    await db
      .delete(calendarEvents)
      .where(and(eq(calendarEvents.id, eventId), eq(calendarEvents.userId, userId)));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    store.calendarEvents = store.calendarEvents.filter(
      (e) => !(e.id === eventId && e.userId === userId)
    );
    persistLocalStore();
  }
}

// --- NOTEBOOKS & A4 NOTE PAGES ---
export async function getUserNotebooks(userId: number) {
  try {
    return await db
      .select()
      .from(notebooks)
      .where(eq(notebooks.userId, userId))
      .orderBy(desc(notebooks.updatedAt));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    return getLocalStore().notebooks.filter((n) => n.userId === userId);
  }
}

export async function createNotebook(
  userId: number,
  data: { title: string; subject?: string; color?: string }
) {
  try {
    const [created] = await db
      .insert(notebooks)
      .values({
        userId,
        title: data.title,
        subject: data.subject || 'General',
        color: data.color || '#2563EB',
      })
      .returning();
    return created;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const now = new Date();
    const created = {
      id: nextSeq('notebooks'),
      userId,
      title: data.title,
      subject: data.subject || 'General',
      color: data.color || '#2563EB',
      createdAt: now,
      updatedAt: now,
    };
    store.notebooks.unshift(created);
    persistLocalStore();
    return created;
  }
}

export async function deleteNotebook(userId: number, notebookId: number) {
  try {
    await db
      .delete(notebooks)
      .where(and(eq(notebooks.id, notebookId), eq(notebooks.userId, userId)));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    store.notebooks = store.notebooks.filter(
      (n) => !(n.id === notebookId && n.userId === userId)
    );
    store.notePages = store.notePages.filter(
      (p) => !(p.notebookId === notebookId && p.userId === userId)
    );
    persistLocalStore();
  }
}

export async function getUserNotePages(userId: number) {
  try {
    return await db
      .select()
      .from(notePages)
      .where(eq(notePages.userId, userId))
      .orderBy(desc(notePages.updatedAt));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    return getLocalStore().notePages.filter((p) => p.userId === userId);
  }
}

export async function createNotePage(
  userId: number,
  data: {
    notebookId: number;
    sectionName?: string;
    title: string;
    pagesData: A4PageContent[];
  }
) {
  const rewards = await getPointRewardsConfig();
  const studyVerified = isStudyRelatedEvent(data.title, data.sectionName);
  const pointsAwarded = studyVerified && rewards.noteCreate > 0 ? rewards.noteCreate : 0;

  try {
    const [created] = await db
      .insert(notePages)
      .values({
        userId,
        notebookId: data.notebookId,
        sectionName: data.sectionName || 'General',
        title: data.title,
        pagesData: data.pagesData,
      })
      .returning();
    if (pointsAwarded > 0) {
      await awardPoints(
        userId,
        pointsAwarded,
        `Study A4 Note: ${data.title}`,
        'note_create'
      );
    }
    return { ...created, pointsAwarded };
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const now = new Date();
    const created = {
      id: nextSeq('notePages'),
      userId,
      notebookId: data.notebookId,
      sectionName: data.sectionName || 'General',
      title: data.title,
      pagesData: data.pagesData,
      createdAt: now,
      updatedAt: now,
    };
    store.notePages.unshift(created);
    persistLocalStore();
    if (pointsAwarded > 0) {
      await awardPoints(
        userId,
        pointsAwarded,
        `Study A4 Note: ${data.title}`,
        'note_create'
      );
    }
    return { ...created, pointsAwarded };
  }
}

export async function updateNotePage(
  userId: number,
  pageId: number,
  updates: {
    sectionName?: string;
    title?: string;
    pagesData?: A4PageContent[];
  }
) {
  try {
    const [updated] = await db
      .update(notePages)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(notePages.id, pageId), eq(notePages.userId, userId)))
      .returning();
    return updated;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const item = store.notePages.find((p) => p.id === pageId && p.userId === userId);
    if (!item) return undefined;
    Object.assign(item, updates, { updatedAt: new Date() });
    persistLocalStore();
    return item;
  }
}

export async function deleteNotePage(userId: number, pageId: number) {
  try {
    await db
      .delete(notePages)
      .where(and(eq(notePages.id, pageId), eq(notePages.userId, userId)));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    store.notePages = store.notePages.filter(
      (p) => !(p.id === pageId && p.userId === userId)
    );
    persistLocalStore();
  }
}

// --- EXAM SCHEDULES ---
export async function getUserExams(userId: number) {
  try {
    return await db
      .select()
      .from(examSchedules)
      .where(eq(examSchedules.userId, userId))
      .orderBy(desc(examSchedules.createdAt));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    return getLocalStore().examSchedules.filter((ex) => ex.userId === userId);
  }
}

export async function createExamSchedule(
  userId: number,
  data: {
    subject: string;
    paperName?: string;
    examType: string;
    customExamType?: string;
    readingMinutes: number;
    writingMinutes: number;
    seatingTime?: string;
    alarmEnabled?: boolean;
    hourlyAlarm?: boolean;
    status?: string;
  }
) {
  try {
    const [created] = await db
      .insert(examSchedules)
      .values({
        userId,
        subject: data.subject,
        paperName: data.paperName || '',
        examType: data.examType,
        customExamType: data.customExamType || '',
        readingMinutes: data.readingMinutes,
        writingMinutes: data.writingMinutes,
        seatingTime: data.seatingTime || '',
        alarmEnabled: data.alarmEnabled ?? true,
        hourlyAlarm: data.hourlyAlarm ?? true,
        status: data.status || 'scheduled',
      })
      .returning();
    return created;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const created = {
      id: nextSeq('examSchedules'),
      userId,
      subject: data.subject,
      paperName: data.paperName || '',
      examType: data.examType,
      customExamType: data.customExamType || '',
      readingMinutes: data.readingMinutes,
      writingMinutes: data.writingMinutes,
      seatingTime: data.seatingTime || '',
      alarmEnabled: data.alarmEnabled ?? true,
      hourlyAlarm: data.hourlyAlarm ?? true,
      status: data.status || 'scheduled',
      createdAt: new Date(),
    };
    store.examSchedules.unshift(created);
    persistLocalStore();
    return created;
  }
}

export async function updateExamStatus(userId: number, examId: number, status: string) {
  try {
    const [updated] = await db
      .update(examSchedules)
      .set({ status })
      .where(and(eq(examSchedules.id, examId), eq(examSchedules.userId, userId)))
      .returning();
    return updated;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const item = store.examSchedules.find((ex) => ex.id === examId && ex.userId === userId);
    if (!item) return undefined;
    item.status = status;
    persistLocalStore();
    return item;
  }
}

export async function deleteExamSchedule(userId: number, examId: number) {
  try {
    await db
      .delete(examSchedules)
      .where(and(eq(examSchedules.id, examId), eq(examSchedules.userId, userId)));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    store.examSchedules = store.examSchedules.filter(
      (ex) => !(ex.id === examId && ex.userId === userId)
    );
    persistLocalStore();
  }
}

// --- STUDY LOGS & EXAM TIMER POINTS (+10 pts per 30 minutes) ---
export async function getUserStudyLogs(userId: number) {
  try {
    return await db
      .select()
      .from(studyLogs)
      .where(eq(studyLogs.userId, userId))
      .orderBy(desc(studyLogs.createdAt));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    return getLocalStore().studyLogs.filter((l) => l.userId === userId);
  }
}

export async function createStudyLog(
  userId: number,
  data: { mode: string; label: string; durationSeconds: number }
) {
  const isExamMode = data.mode === 'test_timer' || data.mode === 'exam_timer';
  const blocksOf30Min = Math.floor(Math.max(0, data.durationSeconds) / 1800);
  const rewards = await getPointRewardsConfig();
  const pointsAwarded = isExamMode ? blocksOf30Min * rewards.examTimer30Min : 0;

  try {
    const [created] = await db
      .insert(studyLogs)
      .values({
        userId,
        mode: data.mode,
        label: data.label,
        durationSeconds: data.durationSeconds,
      })
      .returning();

    if (pointsAwarded > 0) {
      await awardPoints(
        userId,
        pointsAwarded,
        `Exam Timer Session (${blocksOf30Min * 30} min): ${data.label}`,
        'exam_timer'
      );
    }
    return { log: created, pointsAwarded };
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const created = {
      id: nextSeq('studyLogs'),
      userId,
      mode: data.mode,
      label: data.label,
      durationSeconds: data.durationSeconds,
      createdAt: new Date(),
    };
    store.studyLogs.unshift(created);
    persistLocalStore();
    if (pointsAwarded > 0) {
      await awardPoints(
        userId,
        pointsAwarded,
        `Exam Timer Session (${blocksOf30Min * 30} min): ${data.label}`,
        'exam_timer'
      );
    }
    return { log: created, pointsAwarded };
  }
}

// --- CONTACT MESSAGES ---
export async function createContactMessage(data: {
  userId?: number;
  name: string;
  email: string;
  subject: string;
  message: string;
}) {
  try {
    const [created] = await db
      .insert(contactMessages)
      .values({
        userId: data.userId ?? null,
        name: data.name,
        email: data.email,
        subject: data.subject,
        message: data.message,
      })
      .returning();
    return created;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const created = {
      id: nextSeq('contactMessages'),
      userId: data.userId ?? null,
      name: data.name,
      email: data.email,
      subject: data.subject,
      message: data.message,
      createdAt: new Date(),
    };
    store.contactMessages.unshift(created);
    persistLocalStore();
    return created;
  }
}

export async function getContactMessages(userId: number, isAdmin: boolean) {
  try {
    if (isAdmin) {
      return await db
        .select()
        .from(contactMessages)
        .orderBy(desc(contactMessages.createdAt));
    }
    return await db
      .select()
      .from(contactMessages)
      .where(eq(contactMessages.userId, userId))
      .orderBy(desc(contactMessages.createdAt));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const all = getLocalStore().contactMessages;
    return isAdmin ? all : all.filter((c) => c.userId === userId);
  }
}

// --- UPGRADED IN-APP TOOL MAIL ---
function matchRecipientToken(
  token: string,
  user: { id: number; email: string; username: string; uid?: string; shortUid?: string }
): boolean {
  const clean = token.trim().toLowerCase();
  if (!clean) return false;
  const noAt = clean.replace(/^@/, '');
  const numericFromPrefix = clean.startsWith('asan-usr-')
    ? Number(clean.replace('asan-usr-', ''))
    : /^\d+$/.test(clean)
      ? Number(clean)
      : NaN;

  if (Number.isFinite(numericFromPrefix) && user.id === numericFromPrefix) return true;
  if (user.shortUid && user.shortUid.toLowerCase() === clean) return true;
  if (user.username && user.username.toLowerCase() === noAt) return true;
  if (user.email.toLowerCase() === clean) return true;
  if (user.uid && user.uid.toLowerCase() === clean) return true;
  return false;
}

export async function getUserMessages(userId: number) {
  const formatMsg = (m: typeof userMessages.$inferSelect | (typeof getLocalStore extends () => infer S ? S extends { userMessages: (infer U)[] } ? U : never : never)) => {
    const rawAttachments = Array.isArray((m as { attachmentsJson?: unknown }).attachmentsJson)
      ? ((m as { attachmentsJson?: Record<string, unknown>[] }).attachmentsJson || [])
      : [];
    return {
      ...m,
      bodyHtml: (m as { bodyHtml?: string }).bodyHtml || '',
      attachments: rawAttachments.map((att) => ({
        ...att,
        url: typeof att.url === 'string' && att.url ? att.url : `/api/forum/attachments/${att.id}/file`,
      })),
      questionSpec: (m as { questionSpecJson?: Record<string, unknown> | null }).questionSpecJson || null,
    };
  };

  try {
    const rows = await db
      .select()
      .from(userMessages)
      .where(
        or(
          eq(userMessages.senderId, userId),
          eq(userMessages.recipientId, userId),
          eq(userMessages.visibility, 'public')
        )
      )
      .orderBy(desc(userMessages.createdAt));
    return rows.map((r) => formatMsg(r));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    return getLocalStore()
      .userMessages.filter(
        (m) => m.senderId === userId || m.recipientId === userId || m.visibility === 'public'
      )
      .map((r) => formatMsg(r));
  }
}

export async function sendToolUserMessage(params: {
  senderId: number;
  senderEmail: string;
  senderUsername: string;
  recipients: string[];
  visibility: 'direct' | 'self' | 'public';
  isAdminMail?: boolean;
  subject: string;
  body: string;
  bodyHtml?: string;
  attachmentsJson?: Record<string, unknown>[];
  questionSpecJson?: Record<string, unknown> | null;
  attachmentTitle?: string;
  attachmentNoteId?: number | null;
}) {
  const sendWithList = async (
    allUsers: {
      id: number;
      uid: string;
      shortUid?: string;
      email: string;
      username: string;
      displayName: string;
    }[],
    insertMsg: (row: {
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
      bodyHtml: string;
      attachmentsJson: Record<string, unknown>[];
      questionSpecJson: Record<string, unknown> | null;
      attachmentTitle: string;
      attachmentNoteId: number | null;
    }) => Promise<unknown>,
    pushNotif: (n: {
      userId: number | null;
      senderId: number;
      senderLabel: string;
      title: string;
      message: string;
      type: string;
    }) => Promise<void>
  ) => {
    const createdRows: unknown[] = [];
    const safeHtml = params.bodyHtml || '';
    const safeAttachments = Array.isArray(params.attachmentsJson) ? params.attachmentsJson : [];
    const safeQuestionSpec = params.questionSpecJson || null;

    if (params.visibility === 'self') {
      const created = await insertMsg({
        senderId: params.senderId,
        recipientId: params.senderId,
        senderEmail: params.senderEmail,
        senderUsername: params.senderUsername,
        recipientEmail: params.senderEmail,
        recipientUsername: params.senderUsername,
        visibility: 'self',
        isAdminMail: Boolean(params.isAdminMail),
        recipientSummary: 'Self Archive',
        subject: params.subject,
        body: params.body,
        bodyHtml: safeHtml,
        attachmentsJson: safeAttachments,
        questionSpecJson: safeQuestionSpec,
        attachmentTitle: params.attachmentTitle || '',
        attachmentNoteId: params.attachmentNoteId ?? null,
      });
      createdRows.push(created);
      return createdRows;
    }

    if (params.visibility === 'public') {
      const created = await insertMsg({
        senderId: params.senderId,
        recipientId: null,
        senderEmail: params.senderEmail,
        senderUsername: params.senderUsername,
        recipientEmail: 'public@asan-study-tool',
        recipientUsername: 'public',
        visibility: 'public',
        isAdminMail: Boolean(params.isAdminMail),
        recipientSummary: 'Public Community Board',
        subject: params.subject,
        body: params.body,
        bodyHtml: safeHtml,
        attachmentsJson: safeAttachments,
        questionSpecJson: safeQuestionSpec,
        attachmentTitle: params.attachmentTitle || '',
        attachmentNoteId: params.attachmentNoteId ?? null,
      });
      createdRows.push(created);
      await pushNotif({
        userId: null,
        senderId: params.senderId,
        senderLabel: params.isAdminMail
          ? 'Admin Public Mail'
          : `@${params.senderUsername || params.senderEmail}`,
        title: params.subject,
        message: `New public mail posted: ${params.body.slice(0, 120)}`,
        type: params.isAdminMail ? 'admin_mail' : 'mail',
      });
      return createdRows;
    }

    // Direct mode: multiple recipients resolved by username, user ID, or email
    const tokens = params.recipients.map((r) => r.trim()).filter(Boolean);
    if (tokens.length === 0) {
      throw new Error(
        'Enter at least one recipient username, user ID (e.g. ASAN-USR-1 or 1), or email.'
      );
    }

    const matchedMap = new Map<number, (typeof allUsers)[number]>();
    const unmatched: string[] = [];

    for (const token of tokens) {
      const found = allUsers.find((u) => matchRecipientToken(token, u));
      if (!found) {
        unmatched.push(token);
      } else {
        matchedMap.set(found.id, found);
      }
    }

    if (unmatched.length > 0) {
      throw new Error(
        `Recipient(s) not found: ${unmatched.join(', ')}. Use a registered @username, User ID, or email.`
      );
    }

    const recipientsList = Array.from(matchedMap.values());
    const summaryLabel = recipientsList
      .map((r) => (r.username ? `@${r.username}` : r.email))
      .join(', ');

    for (const rec of recipientsList) {
      const created = await insertMsg({
        senderId: params.senderId,
        recipientId: rec.id,
        senderEmail: params.senderEmail,
        senderUsername: params.senderUsername,
        recipientEmail: rec.email,
        recipientUsername: rec.username,
        visibility: 'direct',
        isAdminMail: Boolean(params.isAdminMail),
        recipientSummary: summaryLabel,
        subject: params.subject,
        body: params.body,
        bodyHtml: safeHtml,
        attachmentsJson: safeAttachments,
        questionSpecJson: safeQuestionSpec,
        attachmentTitle: params.attachmentTitle || '',
        attachmentNoteId: params.attachmentNoteId ?? null,
      });
      createdRows.push(created);

      await pushNotif({
        userId: rec.id,
        senderId: params.senderId,
        senderLabel: params.isAdminMail
          ? 'Admin Mail'
          : `@${params.senderUsername || params.senderEmail}`,
        title: params.isAdminMail ? `[Admin Mail] ${params.subject}` : params.subject,
        message: params.body.slice(0, 140),
        type: params.isAdminMail ? 'admin_mail' : 'mail',
      });
    }

    return createdRows;
  };

  try {
    const allUsers = await db
      .select({
        id: users.id,
        uid: users.uid,
        shortUid: users.shortUid,
        email: users.email,
        username: users.username,
        displayName: users.displayName,
      })
      .from(users);

    return await sendWithList(
      allUsers,
      async (row) => {
        const [inserted] = await db.insert(userMessages).values(row).returning();
        return {
          ...inserted,
          attachments: inserted.attachmentsJson || [],
          questionSpec: inserted.questionSpecJson || null,
        };
      },
      async (n) => {
        await db.insert(notifications).values(n);
      }
    );
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      throw error instanceof Error ? error : new Error('Failed to send mail.');
    }
    const store = getLocalStore();
    return await sendWithList(
      store.users,
      async (row) => {
        const inserted = {
          id: nextSeq('userMessages'),
          ...row,
          isRead: false,
          createdAt: new Date(),
        };
        store.userMessages.unshift(inserted);
        persistLocalStore();
        return {
          ...inserted,
          attachments: inserted.attachmentsJson || [],
          questionSpec: inserted.questionSpecJson || null,
        };
      },
      async (n) => {
        store.notifications.unshift({
          id: nextSeq('notifications'),
          ...n,
          isRead: false,
          createdAt: new Date(),
        });
        persistLocalStore();
      }
    );
  }
}

export async function markToolMessageRead(userId: number, messageId: number) {
  try {
    const [updated] = await db
      .update(userMessages)
      .set({ isRead: true })
      .where(
        and(eq(userMessages.id, messageId), eq(userMessages.recipientId, userId))
      )
      .returning();
    return updated;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const item = store.userMessages.find(
      (m) => m.id === messageId && m.recipientId === userId
    );
    if (!item) return undefined;
    item.isRead = true;
    persistLocalStore();
    return item;
  }
}

export async function deleteToolMessage(userId: number, messageId: number) {
  try {
    await db
      .delete(userMessages)
      .where(
        and(
          eq(userMessages.id, messageId),
          or(eq(userMessages.senderId, userId), eq(userMessages.recipientId, userId))
        )
      );
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    store.userMessages = store.userMessages.filter(
      (m) => !(m.id === messageId && (m.senderId === userId || m.recipientId === userId))
    );
    persistLocalStore();
  }
}

// --- NOTIFICATIONS ---
export async function getNotificationsForUser(userId: number) {
  try {
    return await db
      .select()
      .from(notifications)
      .where(or(eq(notifications.userId, userId), isNull(notifications.userId)))
      .orderBy(desc(notifications.createdAt));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    return getLocalStore().notifications.filter(
      (n) => n.userId === userId || n.userId === null
    );
  }
}

export async function sendNotification(params: {
  senderId: number;
  senderLabel: string;
  senderRole: string;
  targetRecipient?: string; // 'all' (admin only) | username / userId / email
  title: string;
  message: string;
  type?: string;
}) {
  const target = (params.targetRecipient || '').trim();
  const isBroadcast = target === '' || target.toLowerCase() === 'all';
  if (isBroadcast && params.senderRole !== 'admin' && params.senderRole !== 'super') {
    throw new Error('Only Admins can broadcast global notifications to all users.');
  }

  try {
    if (isBroadcast) {
      const [created] = await db
        .insert(notifications)
        .values({
          userId: null,
          senderId: params.senderId,
          senderLabel: params.senderLabel,
          title: params.title,
          message: params.message,
          type: params.type || 'broadcast',
        })
        .returning();
      return created;
    }

    const allUsers = await db.select().from(users);
    const rec = allUsers.find((u) => matchRecipientToken(target, u));
    if (!rec) throw new Error(`Recipient "${target}" not found.`);

    const [created] = await db
      .insert(notifications)
      .values({
        userId: rec.id,
        senderId: params.senderId,
        senderLabel: params.senderLabel,
        title: params.title,
        message: params.message,
        type: params.type || 'ping',
      })
      .returning();
    return created;
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      throw error instanceof Error ? error : new Error('Failed to send notification.');
    }
    const store = getLocalStore();
    if (isBroadcast) {
      const created = {
        id: nextSeq('notifications'),
        userId: null,
        senderId: params.senderId,
        senderLabel: params.senderLabel,
        title: params.title,
        message: params.message,
        type: params.type || 'broadcast',
        isRead: false,
        createdAt: new Date(),
      };
      store.notifications.unshift(created);
      persistLocalStore();
      return created;
    }

    const rec = store.users.find((u) => matchRecipientToken(target, u));
    if (!rec) throw new Error(`Recipient "${target}" not found.`);
    const created = {
      id: nextSeq('notifications'),
      userId: rec.id,
      senderId: params.senderId,
      senderLabel: params.senderLabel,
      title: params.title,
      message: params.message,
      type: params.type || 'ping',
      isRead: false,
      createdAt: new Date(),
    };
    store.notifications.unshift(created);
    persistLocalStore();
    return created;
  }
}

export async function markNotificationRead(userId: number, notificationId: number) {
  try {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(
        and(
          eq(notifications.id, notificationId),
          or(eq(notifications.userId, userId), isNull(notifications.userId))
        )
      );
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const item = store.notifications.find(
      (n) => n.id === notificationId && (n.userId === userId || n.userId === null)
    );
    if (item) {
      item.isRead = true;
      persistLocalStore();
    }
  }
}

// --- STUDY MATERIAL NOTES & QUESTION PAPERS (+75 pts per question paper upload) ---
export async function listStudyMaterials() {
  try {
    return await db
      .select()
      .from(studyMaterials)
      .orderBy(desc(studyMaterials.createdAt));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    return getLocalStore().studyMaterials;
  }
}

export async function getStudyMaterialById(id: number) {
  try {
    const [row] = await db
      .select()
      .from(studyMaterials)
      .where(eq(studyMaterials.id, id))
      .limit(1);
    return row;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    return getLocalStore().studyMaterials.find((m) => m.id === id);
  }
}

export function detectPdfPageCountFromBuffer(buf: Buffer): number {
  if (!buf || buf.length === 0) return 1;
  // Scan up to first 6 MB as latin1 for PDF /Count or /Type /Page markers
  const text = buf.subarray(0, Math.min(buf.length, 6 * 1024 * 1024)).toString('latin1');
  if (!text.includes('%PDF')) return 1;
  const countMatches = [...text.matchAll(/\/Count\s+(\d+)/g)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 20000);
  if (countMatches.length > 0) {
    return Math.max(...countMatches);
  }
  const pageMatches = text.match(/\/Type\s*\/Page\b(?!s)/g);
  return pageMatches && pageMatches.length > 0 ? pageMatches.length : 1;
}

export function detectStudyMediaKind(
  fileName: string,
  mimeType: string,
  explicitHint?: string
): string {
  const hint = (explicitHint || '').trim().toLowerCase();
  if (
    ['photo', 'video', 'text', 'pdf', 'word', 'excel', 'ppt', 'recording'].includes(hint)
  ) {
    return hint;
  }
  const lower = (fileName || '').toLowerCase();
  const mime = (mimeType || '').toLowerCase();
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|svg)$/.test(lower)) return 'photo';
  if (mime.startsWith('video/') || /\.(mp4|mov|mkv|avi|m4v)$/.test(lower)) return 'video';
  if (
    mime.startsWith('audio/') ||
    /\.(mp3|wav|ogg|m4a|aac|flac)$/.test(lower) ||
    (mime === 'video/webm' && lower.includes('recording')) ||
    (mime.includes('webm') && (lower.includes('rec') || lower.includes('audio')))
  ) {
    return 'recording';
  }
  if (mime.includes('webm')) return 'video';
  if (mime.includes('pdf') || lower.endsWith('.pdf')) return 'pdf';
  if (
    mime.includes('wordprocessingml') ||
    mime.includes('msword') ||
    /\.(docx?|rtf|odt)$/.test(lower)
  ) {
    return 'word';
  }
  if (
    mime.includes('spreadsheetml') ||
    mime.includes('ms-excel') ||
    mime.includes('csv') ||
    /\.(xlsx?|csv|ods)$/.test(lower)
  ) {
    return 'excel';
  }
  if (
    mime.includes('presentationml') ||
    mime.includes('ms-powerpoint') ||
    /\.(pptx?|odp)$/.test(lower)
  ) {
    return 'ppt';
  }
  if (mime.startsWith('text/') || /\.(txt|md|markdown|log|tex)$/.test(lower)) return 'text';
  return 'pdf';
}

export async function createStudyMaterial(data: {
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
  mediaKind?: string;
  fileSizeBytes: number;
  pageCount?: number;
  hourlyRentCost: number;
  buyCost?: number;
}) {
  const hourlyRentCost = Math.round(Number(data.hourlyRentCost));
  if (!Number.isFinite(hourlyRentCost) || hourlyRentCost < 5 || hourlyRentCost > 100) {
    throw new Error('Hourly rent cost must be between 5 and 100 points per hour.');
  }
  const pageCount = Math.max(1, Math.round(Number(data.pageCount) || 1));
  const rawBuy = Number(data.buyCost);
  const buyCost = Number.isFinite(rawBuy) && rawBuy >= 5
    ? Math.round(rawBuy)
    : Math.max(hourlyRentCost, Math.min(5000, hourlyRentCost * 4));
  const cleanDescription = (data.description || '').trim().slice(0, 1000);
  const mediaKind = detectStudyMediaKind(data.fileName, data.mimeType, data.mediaKind);

  const rewards = await getPointRewardsConfig();
  const pointsAwarded =
    data.category === 'question_paper'
      ? rewards.questionPaperUpload
      : rewards.studyMaterialUpload;
  const awardReason =
    data.category === 'question_paper'
      ? `Uploaded Question Paper: ${data.title}`
      : `Uploaded Study Material: ${data.title}`;
  const awardCategory =
    data.category === 'question_paper' ? 'question_paper' : 'study_material';

  try {
    const [created] = await db
      .insert(studyMaterials)
      .values({
        uploaderId: data.uploaderId,
        uploaderEmail: data.uploaderEmail,
        uploaderName: data.uploaderName,
        title: data.title,
        subject: data.subject,
        category: data.category,
        description: cleanDescription,
        fileName: data.fileName,
        storedFileName: data.storedFileName,
        mimeType: data.mimeType,
        mediaKind,
        fileSizeBytes: data.fileSizeBytes,
        pageCount,
        hourlyRentCost,
        buyCost,
        status: 'approved',
      })
      .returning();

    if (pointsAwarded > 0) {
      await awardPoints(data.uploaderId, pointsAwarded, awardReason, awardCategory);
    }
    return { material: created, pointsAwarded };
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const created = {
      id: nextSeq('studyMaterials'),
      uploaderId: data.uploaderId,
      uploaderEmail: data.uploaderEmail,
      uploaderName: data.uploaderName,
      title: data.title,
      subject: data.subject,
      category: data.category,
      description: cleanDescription,
      fileName: data.fileName,
      storedFileName: data.storedFileName,
      mimeType: data.mimeType,
      mediaKind,
      fileSizeBytes: data.fileSizeBytes,
      pageCount,
      hourlyRentCost,
      buyCost,
      driveFileId: '',
      driveWebLink: '',
      status: 'approved',
      createdAt: new Date(),
    };
    store.studyMaterials.unshift(created);
    persistLocalStore();
    if (pointsAwarded > 0) {
      await awardPoints(data.uploaderId, pointsAwarded, awardReason, awardCategory);
    }
    return { material: created, pointsAwarded };
  }
}

export async function getUserMaterialPurchases(userId: number) {
  try {
    return await db
      .select()
      .from(materialPurchases)
      .where(eq(materialPurchases.buyerId, userId))
      .orderBy(desc(materialPurchases.createdAt));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    return getLocalStore().materialPurchases.filter((p) => p.buyerId === userId);
  }
}

function resolveBuyerEffectivePlan(buyer: {
  plan?: string | null;
  eliteExpiresAt?: string | null;
  proExpiresAt?: string | null;
}): string {
  const nowMs = Date.now();
  if (buyer.plan === 'elite') {
    if (!buyer.eliteExpiresAt) return 'elite';
    const exp = new Date(buyer.eliteExpiresAt).getTime();
    if (!Number.isFinite(exp) || exp > nowMs) return 'elite';
  }
  if (buyer.plan === 'pro') {
    if (!buyer.proExpiresAt) return 'pro';
    const exp = new Date(buyer.proExpiresAt).getTime();
    if (!Number.isFinite(exp) || exp > nowMs) return 'pro';
  }
  return 'basic';
}

export async function hasActiveMaterialAccess(
  userId: number,
  userRole: string,
  item: { id: number; uploaderId: number }
): Promise<boolean> {
  if (userRole === 'admin' || userRole === 'super' || item.uploaderId === userId) return true;
  const purchases = await getUserMaterialPurchases(userId);
  const nowMs = Date.now();
  return purchases.some((p) => {
    if (p.materialId !== item.id) return false;
    if (p.status === 'cancelled') return false;
    if (p.accessType === 'buy') return true;
    if (p.accessType === 'rent' && p.expiresAt) {
      return new Date(p.expiresAt).getTime() > nowMs;
    }
    return false;
  });
}

export async function acquireStudyMaterial(
  userId: number,
  materialId: number,
  opts: { accessType: 'rent' | 'buy'; hours?: number; couponCode?: string }
) {
  const item = await getStudyMaterialById(materialId);
  if (!item) throw new Error('Study material not found.');
  if (item.uploaderId === userId) {
    throw new Error('You uploaded this material and already have permanent access.');
  }

  const accessType = opts.accessType === 'buy' ? 'buy' : 'rent';
  const hours = accessType === 'rent' ? Math.max(1, Math.min(720, Math.round(Number(opts.hours) || 1))) : 0;
  const hourlyRate = Math.max(5, Math.min(100, Number(item.hourlyRentCost) || 10));
  const pageCount = Math.max(1, Number(item.pageCount) || 1);
  const buyCost = Math.max(5, Number(item.buyCost) || hourlyRate * 4);
  const rawBaseCost = accessType === 'buy' ? buyCost : hourlyRate * hours;
  const targetScope = accessType === 'buy' ? 'repository_buy' : 'repository_rent';
  const coupon = opts.couponCode
    ? await resolveValidCouponForScope(opts.couponCode, targetScope)
    : null;
  const expiresAt =
    accessType === 'rent' ? new Date(Date.now() + hours * 3600 * 1000).toISOString() : '';

  try {
    const [buyer] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!buyer) throw new Error('User not found.');
    const effectivePlan = resolveBuyerEffectivePlan(buyer);
    const quote = calculateRepoOrAppQuote({
      targetScope,
      baseSubtotal: rawBaseCost,
      effectivePlan,
      role: buyer.role,
      coupon,
    });

    if (!buyer.infinitePoints && (buyer.points || 0) < quote.finalCost) {
      throw new Error(
        `Insufficient points. Need ${quote.finalCost} pts incl. ${quote.platformFee} fee (${buyer.points || 0} pts available).`
      );
    }

    const updatedBuyer = await awardPoints(
      userId,
      -quote.finalCost,
      `${accessType === 'buy' ? 'Purchased' : `Rented (${hours}h)`} "${item.title}" (${pageCount}p, ${quote.finalCost} pts incl. ${quote.platformFee} fee)`,
      accessType === 'buy' ? 'material_buy' : 'material_rent'
    );

    const royalty = Math.min(
      quote.finalCost,
      Math.max(0, Math.round((quote.finalCost * 0.7) / 10) * 10)
    );
    if (royalty > 0) {
      await awardPoints(
        item.uploaderId,
        royalty,
        `Royalty from ${buyer.displayName} (${accessType === 'buy' ? 'Buy' : `${hours}h Rent`}): ${item.title}`,
        'material_sale'
      );
    }

    if (coupon?.id) await incrementCouponUsage(coupon.id);

    const [purchase] = await db
      .insert(materialPurchases)
      .values({
        materialId: item.id,
        materialTitle: item.title,
        buyerId: buyer.id,
        buyerEmail: buyer.email,
        buyerName: buyer.displayName,
        uploaderId: item.uploaderId,
        accessType,
        hours,
        hourlyRate,
        pageCount,
        baseCost: quote.baseSubtotal,
        platformFee: quote.platformFee,
        discountPercent: quote.tierDiscountPercent,
        couponCode: quote.appliedCouponCode,
        totalCost: quote.finalCost,
        status: 'active',
        cancelledAt: '',
        refundAmount: 0,
        expiresAt,
      })
      .returning();

    await db.insert(notifications).values({
      userId: buyer.id,
      senderLabel: 'Study Material Repository',
      title: accessType === 'buy' ? `Purchased: ${item.title}` : `Rented (${hours}h): ${item.title}`,
      message: `${quote.finalCost} pts deducted (incl. ${quote.platformFee} non-refundable fee${
        quote.tierDiscountPercent > 0 ? `, ${quote.tierDiscountPercent}% off` : ''
      }${quote.appliedCouponCode ? `, coupon ${quote.appliedCouponCode}` : ''}).${
        expiresAt ? ` Access until ${new Date(expiresAt).toLocaleString()}.` : ' Permanent access unlocked.'
      }`,
      type: 'material_access',
    });

    return {
      purchase,
      quote,
      points: updatedBuyer?.points ?? Math.max(0, (buyer.points || 0) - quote.finalCost),
      message:
        accessType === 'buy'
          ? `Purchased "${item.title}" permanently for ${quote.finalCost} points (incl. ${quote.platformFee} platform fee).`
          : `Rented "${item.title}" for ${hours} hour(s) (${quote.finalCost} points incl. ${quote.platformFee} platform fee).`,
    };
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      throw error instanceof Error ? error : new Error('Failed to acquire study material.');
    }
    const store = getLocalStore();
    const buyer = store.users.find((u) => u.id === userId);
    if (!buyer) throw new Error('User not found.');
    const effectivePlan = resolveBuyerEffectivePlan(buyer);
    const quote = calculateRepoOrAppQuote({
      targetScope,
      baseSubtotal: rawBaseCost,
      effectivePlan,
      role: buyer.role,
      coupon,
    });

    if (!buyer.infinitePoints && (buyer.points || 0) < quote.finalCost) {
      throw new Error(
        `Insufficient points. Need ${quote.finalCost} pts incl. ${quote.platformFee} fee (${buyer.points || 0} pts available).`
      );
    }

    const updatedBuyer = await awardPoints(
      userId,
      -quote.finalCost,
      `${accessType === 'buy' ? 'Purchased' : `Rented (${hours}h)`} "${item.title}" (${pageCount}p, ${quote.finalCost} pts incl. ${quote.platformFee} fee)`,
      accessType === 'buy' ? 'material_buy' : 'material_rent'
    );

    const royalty = Math.min(
      quote.finalCost,
      Math.max(0, Math.round((quote.finalCost * 0.7) / 10) * 10)
    );
    if (royalty > 0) {
      await awardPoints(
        item.uploaderId,
        royalty,
        `Royalty from ${buyer.displayName} (${accessType === 'buy' ? 'Buy' : `${hours}h Rent`}): ${item.title}`,
        'material_sale'
      );
    }

    if (coupon?.id) await incrementCouponUsage(coupon.id);

    const purchase = {
      id: nextSeq('materialPurchases'),
      materialId: item.id,
      materialTitle: item.title,
      buyerId: buyer.id,
      buyerEmail: buyer.email,
      buyerName: buyer.displayName,
      uploaderId: item.uploaderId,
      accessType,
      hours,
      hourlyRate,
      pageCount,
      baseCost: quote.baseSubtotal,
      platformFee: quote.platformFee,
      discountPercent: quote.tierDiscountPercent,
      couponCode: quote.appliedCouponCode,
      totalCost: quote.finalCost,
      status: 'active',
      cancelledAt: '',
      refundAmount: 0,
      expiresAt,
      createdAt: new Date(),
    };
    store.materialPurchases.unshift(purchase);
    store.notifications.unshift({
      id: nextSeq('notifications'),
      userId: buyer.id,
      senderId: null,
      senderLabel: 'Study Material Repository',
      title: accessType === 'buy' ? `Purchased: ${item.title}` : `Rented (${hours}h): ${item.title}`,
      message: `${quote.finalCost} pts deducted (incl. ${quote.platformFee} fee).`,
      type: 'material_access',
      isRead: false,
      createdAt: new Date(),
    });
    persistLocalStore();

    return {
      purchase,
      quote,
      points: updatedBuyer?.points ?? buyer.points,
      message:
        accessType === 'buy'
          ? `Purchased "${item.title}" permanently for ${quote.finalCost} points (incl. ${quote.platformFee} platform fee).`
          : `Rented "${item.title}" for ${hours} hour(s) (${quote.finalCost} points incl. ${quote.platformFee} platform fee).`,
    };
  }
}

export async function cancelMaterialPurchase(
  userId: number,
  purchaseId: number,
  opts: { reason?: string } = {}
) {
  const now = new Date();
  const cleanReason = (opts.reason || '').trim().slice(0, 400) || 'User cancelled repository access.';
  try {
    const [purchase] = await db
      .select()
      .from(materialPurchases)
      .where(and(eq(materialPurchases.id, purchaseId), eq(materialPurchases.buyerId, userId)))
      .limit(1);
    if (!purchase) throw new Error('Repository purchase not found.');
    if (purchase.status === 'cancelled') throw new Error('Purchase is already cancelled.');

    const [buyer] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!buyer) throw new Error('User not found.');

    const startedIso =
      purchase.createdAt instanceof Date
        ? purchase.createdAt.toISOString()
        : String(purchase.createdAt || now.toISOString());
    const calc = calculateCancellationRefund({
      pointsPaid: purchase.totalCost,
      platformFee: purchase.platformFee ?? REPO_PLATFORM_FEE,
      noRefund: false,
      startedAt: startedIso,
      expiresAt: purchase.expiresAt || '',
      purchaseType: purchase.accessType === 'buy' ? 'non_timed' : 'timed',
    });

    const [updated] = await db
      .update(materialPurchases)
      .set({
        status: 'cancelled',
        cancelledAt: now.toISOString(),
        refundAmount: calc.requestedRefundPoints,
      })
      .where(eq(materialPurchases.id, purchase.id))
      .returning();

    let refundRequest = null;
    if (calc.requestedRefundPoints > 0) {
      const [insertedReq] = await db
        .insert(proRefundRequests)
        .values({
          userId: buyer.id,
          userEmail: buyer.email,
          username: buyer.username,
          displayName: buyer.displayName,
          shortUid: buyer.shortUid,
          planTerm: purchase.accessType === 'buy' ? 'repo_buy' : 'repo_rent',
          refundBasis: calc.refundBasis,
          pointsPaid: purchase.totalCost,
          remainingPercent: calc.remainingPercent,
          remainingDays: calc.remainingDays,
          totalDays: calc.totalDays,
          requestedRefundPoints: calc.requestedRefundPoints,
          reason: `Repository (${purchase.materialTitle || `#${purchase.materialId}`}): ${cleanReason}`,
          status: 'pending',
        })
        .returning();
      refundRequest = insertedReq;
    }

    return {
      purchase: updated,
      refundRequest,
      refundPreview: calc,
      message:
        calc.requestedRefundPoints > 0
          ? `Access cancelled. Refund request for ${calc.requestedRefundPoints} pts (excluding ${calc.platformFeeExcluded}-pt fee) sent for Admin review.`
          : 'Repository access cancelled.',
    };
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      throw error instanceof Error ? error : new Error('Failed to cancel purchase.');
    }
    const store = getLocalStore();
    const purchase = store.materialPurchases.find(
      (p) => p.id === purchaseId && p.buyerId === userId
    );
    if (!purchase) throw new Error('Repository purchase not found.');
    if (purchase.status === 'cancelled') throw new Error('Purchase is already cancelled.');
    const buyer = store.users.find((u) => u.id === userId);
    if (!buyer) throw new Error('User not found.');

    const startedIso =
      purchase.createdAt instanceof Date
        ? purchase.createdAt.toISOString()
        : String(purchase.createdAt || now.toISOString());
    const calc = calculateCancellationRefund({
      pointsPaid: purchase.totalCost,
      platformFee: purchase.platformFee ?? REPO_PLATFORM_FEE,
      noRefund: false,
      startedAt: startedIso,
      expiresAt: purchase.expiresAt || '',
      purchaseType: purchase.accessType === 'buy' ? 'non_timed' : 'timed',
    });

    purchase.status = 'cancelled';
    purchase.cancelledAt = now.toISOString();
    purchase.refundAmount = calc.requestedRefundPoints;

    let refundRequest = null;
    if (calc.requestedRefundPoints > 0) {
      refundRequest = {
        id: nextSeq('proRefundRequests'),
        userId: buyer.id,
        userEmail: buyer.email,
        username: buyer.username,
        displayName: buyer.displayName,
        shortUid: buyer.shortUid,
        planTerm: purchase.accessType === 'buy' ? 'repo_buy' : 'repo_rent',
        refundBasis: calc.refundBasis,
        pointsPaid: purchase.totalCost,
        remainingPercent: calc.remainingPercent,
        remainingDays: calc.remainingDays,
        totalDays: calc.totalDays,
        requestedRefundPoints: calc.requestedRefundPoints,
        reason: `Repository (${purchase.materialTitle || `#${purchase.materialId}`}): ${cleanReason}`,
        status: 'pending',
        adminNote: '',
        reviewedByUserId: null,
        reviewedByLabel: '',
        reviewedAt: '',
        createdAt: now,
      };
      store.proRefundRequests.unshift(refundRequest);
    }
    persistLocalStore();
    return {
      purchase,
      refundRequest,
      refundPreview: calc,
      message:
        calc.requestedRefundPoints > 0
          ? `Access cancelled. Refund request for ${calc.requestedRefundPoints} pts (excluding ${calc.platformFeeExcluded}-pt fee) sent for Admin review.`
          : 'Repository access cancelled.',
    };
  }
}

export async function extendMaterialPurchase(
  userId: number,
  purchaseId: number,
  opts: { hours?: number; couponCode?: string } = {}
) {
  const hours = Math.max(1, Math.min(720, Math.round(Number(opts.hours) || 1)));
  const coupon = opts.couponCode
    ? await resolveValidCouponForScope(opts.couponCode, 'repository_rent')
    : null;

  try {
    const [purchase] = await db
      .select()
      .from(materialPurchases)
      .where(and(eq(materialPurchases.id, purchaseId), eq(materialPurchases.buyerId, userId)))
      .limit(1);
    if (!purchase) throw new Error('Repository purchase not found.');
    if (purchase.accessType !== 'rent') {
      throw new Error('Permanent purchases do not need extension.');
    }
    if (purchase.status === 'cancelled') {
      throw new Error('Cancelled purchases cannot be extended.');
    }
    const [buyer] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!buyer) throw new Error('User not found.');

    const item = await getStudyMaterialById(purchase.materialId);
    const hourlyRate = item
      ? Math.max(5, Math.min(100, Number(item.hourlyRentCost) || 10))
      : Math.max(5, Number(purchase.hourlyRate) || 10);
    const quote = calculateRepoOrAppQuote({
      targetScope: 'repository_rent',
      baseSubtotal: hourlyRate * hours,
      effectivePlan: resolveBuyerEffectivePlan(buyer),
      role: buyer.role,
      coupon,
    });

    if (!buyer.infinitePoints && (buyer.points || 0) < quote.finalCost) {
      throw new Error(
        `Insufficient points to extend by ${hours}h. Need ${quote.finalCost} pts incl. ${quote.platformFee} fee.`
      );
    }

    const updatedBuyer = await awardPoints(
      userId,
      -quote.finalCost,
      `Extended rental (+${hours}h) for "${purchase.materialTitle}" (${quote.finalCost} pts incl. ${quote.platformFee} fee)`,
      'material_rent'
    );
    const royalty = Math.min(
      quote.finalCost,
      Math.max(0, Math.round((quote.finalCost * 0.7) / 10) * 10)
    );
    if (royalty > 0) {
      await awardPoints(
        purchase.uploaderId,
        royalty,
        `Extension royalty from ${buyer.displayName} (+${hours}h): ${purchase.materialTitle}`,
        'material_sale'
      );
    }
    if (coupon?.id) await incrementCouponUsage(coupon.id);

    const baseMs = Math.max(
      Date.now(),
      purchase.expiresAt ? new Date(purchase.expiresAt).getTime() : 0
    );
    const nextExpiresAt = new Date(baseMs + hours * 3600 * 1000).toISOString();

    const [updated] = await db
      .update(materialPurchases)
      .set({
        hours: (purchase.hours || 0) + hours,
        totalCost: (purchase.totalCost || 0) + quote.finalCost,
        baseCost: (purchase.baseCost || 0) + quote.baseSubtotal,
        status: 'active',
        expiresAt: nextExpiresAt,
      })
      .where(eq(materialPurchases.id, purchase.id))
      .returning();

    return {
      purchase: updated,
      quote,
      points: updatedBuyer?.points ?? Math.max(0, (buyer.points || 0) - quote.finalCost),
      message: `Extended "${purchase.materialTitle}" by ${hours} hour(s) until ${new Date(
        nextExpiresAt
      ).toLocaleString()}.`,
    };
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      throw error instanceof Error ? error : new Error('Failed to extend purchase.');
    }
    const store = getLocalStore();
    const purchase = store.materialPurchases.find(
      (p) => p.id === purchaseId && p.buyerId === userId
    );
    if (!purchase) throw new Error('Repository purchase not found.');
    if (purchase.accessType !== 'rent') {
      throw new Error('Permanent purchases do not need extension.');
    }
    if (purchase.status === 'cancelled') {
      throw new Error('Cancelled purchases cannot be extended.');
    }
    const buyer = store.users.find((u) => u.id === userId);
    if (!buyer) throw new Error('User not found.');
    const item = await getStudyMaterialById(purchase.materialId);
    const hourlyRate = item
      ? Math.max(5, Math.min(100, Number(item.hourlyRentCost) || 10))
      : Math.max(5, Number(purchase.hourlyRate) || 10);
    const quote = calculateRepoOrAppQuote({
      targetScope: 'repository_rent',
      baseSubtotal: hourlyRate * hours,
      effectivePlan: resolveBuyerEffectivePlan(buyer),
      role: buyer.role,
      coupon,
    });

    if (!buyer.infinitePoints && (buyer.points || 0) < quote.finalCost) {
      throw new Error(
        `Insufficient points to extend by ${hours}h. Need ${quote.finalCost} pts incl. ${quote.platformFee} fee.`
      );
    }

    const updatedBuyer = await awardPoints(
      userId,
      -quote.finalCost,
      `Extended rental (+${hours}h) for "${purchase.materialTitle}"`,
      'material_rent'
    );
    if (coupon?.id) await incrementCouponUsage(coupon.id);
    const baseMs = Math.max(
      Date.now(),
      purchase.expiresAt ? new Date(purchase.expiresAt).getTime() : 0
    );
    const nextExpiresAt = new Date(baseMs + hours * 3600 * 1000).toISOString();
    purchase.hours = (purchase.hours || 0) + hours;
    purchase.totalCost = (purchase.totalCost || 0) + quote.finalCost;
    purchase.baseCost = (purchase.baseCost || 0) + quote.baseSubtotal;
    purchase.status = 'active';
    purchase.expiresAt = nextExpiresAt;
    persistLocalStore();
    return {
      purchase,
      quote,
      points: updatedBuyer?.points ?? buyer.points,
      message: `Extended "${purchase.materialTitle}" by ${hours} hour(s).`,
    };
  }
}

export async function updateStudyMaterialDriveInfo(
  id: number,
  driveFileId: string,
  driveWebLink: string
) {
  try {
    const [updated] = await db
      .update(studyMaterials)
      .set({ driveFileId, driveWebLink })
      .where(eq(studyMaterials.id, id))
      .returning();
    return updated;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const item = store.studyMaterials.find((m) => m.id === id);
    if (!item) return undefined;
    item.driveFileId = driveFileId;
    item.driveWebLink = driveWebLink;
    persistLocalStore();
    return item;
  }
}

export async function deleteStudyMaterial(id: number) {
  const existing = await getStudyMaterialById(id);
  if (existing?.storedFileName) {
    const full = path.join(UPLOADS_DIR, existing.storedFileName);
    if (fs.existsSync(full)) {
      fs.unlinkSync(full);
    }
  }
  try {
    await db.delete(studyMaterials).where(eq(studyMaterials.id, id));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    store.studyMaterials = store.studyMaterials.filter((m) => m.id !== id);
    persistLocalStore();
  }
}

// --- ADMIN STORAGE & ANALYTICS OVERVIEW ---
export async function getAdminAnalytics() {
  const STORAGE_QUOTA_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB (>= 3 GB usable server storage pool)
  const contributorWeeklyPoints = await getContributorWeeklyPoints();
  try {
    const [
      allUsers,
      allMaterials,
      allPurchases,
      allKeys,
      allTx,
      allTasks,
      allNotes,
      allMsgs,
      allContribFolders,
      allContribFiles,
    ] = await Promise.all([
      db.select().from(users).orderBy(desc(users.createdAt)),
      db.select().from(studyMaterials).orderBy(desc(studyMaterials.createdAt)),
      db.select().from(materialPurchases).orderBy(desc(materialPurchases.createdAt)),
      db.select().from(licenseKeys).orderBy(desc(licenseKeys.createdAt)),
      db.select().from(pointTransactions),
      db.select().from(tasks),
      db.select().from(notePages),
      db.select().from(userMessages),
      db.select().from(contributorFolders).orderBy(desc(contributorFolders.createdAt)),
      db.select().from(contributorFiles).orderBy(desc(contributorFiles.createdAt)),
    ]);

    const usedBytes =
      allMaterials.reduce((acc, m) => acc + Number(m.fileSizeBytes || 0), 0) +
      allContribFiles.reduce((acc, f) => acc + Number(f.fileSizeBytes || 0), 0);
    return {
      storage: {
        usedBytes,
        quotaBytes: STORAGE_QUOTA_BYTES,
        fileCount: allMaterials.length + allContribFiles.length,
        driveMirrorFolder: 'ASAN-user-content',
      },
      contributorWeeklyPoints,
      analytics: {
        totalUsers: allUsers.length,
        basicUsers: allUsers.filter((u) => u.plan === 'basic').length,
        proUsers: allUsers.filter((u) => u.plan === 'pro').length,
        eliteUsers: allUsers.filter((u) => u.plan === 'elite').length,
        adminUsers: allUsers.filter((u) => u.role === 'admin' || u.role === 'super').length,
        approvedContributors: allUsers.filter((u) => Boolean(u.contributorApproved)).length,
        pendingContributorRequests: allUsers.filter((u) => u.contributorRequested).length,
        totalTasks: allTasks.length,
        totalNoteDocs: allNotes.length,
        totalMessages: allMsgs.length,
        totalPointsCirculating: allUsers.reduce((acc, u) => acc + (u.points || 0), 0),
        totalPointsAwarded: allTx
          .filter((t) => t.amount > 0)
          .reduce((acc, t) => acc + t.amount, 0),
        activeProKeys: allKeys.filter((k) => k.status === 'active').length,
        unusedProKeys: allKeys.filter((k) => k.status === 'unused').length,
        totalMaterialPurchases: allPurchases.length,
        totalMaterialRevenuePts: allPurchases.reduce((acc, p) => acc + (p.totalCost || 0), 0),
      },
      users: allUsers.map((u) => sanitizeUserForClient(u)),
      materials: allMaterials,
      materialPurchases: allPurchases,
      licenseKeys: allKeys,
      contributorFolders: allContribFolders,
      contributorFiles: allContribFiles,
    };
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const usedBytes =
      store.studyMaterials.reduce((acc, m) => acc + Number(m.fileSizeBytes || 0), 0) +
      (store.contributorFiles || []).reduce((acc, f) => acc + Number(f.fileSizeBytes || 0), 0);
    const purchases = [...(store.materialPurchases || [])].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
    return {
      storage: {
        usedBytes,
        quotaBytes: STORAGE_QUOTA_BYTES,
        fileCount: store.studyMaterials.length + (store.contributorFiles || []).length,
        driveMirrorFolder: 'ASAN-user-content',
      },
      contributorWeeklyPoints,
      analytics: {
        totalUsers: store.users.length,
        basicUsers: store.users.filter((u) => u.plan === 'basic').length,
        proUsers: store.users.filter((u) => u.plan === 'pro').length,
        eliteUsers: store.users.filter((u) => u.plan === 'elite').length,
        adminUsers: store.users.filter((u) => u.role === 'admin' || u.role === 'super').length,
        approvedContributors: store.users.filter((u) => Boolean(u.contributorApproved)).length,
        pendingContributorRequests: store.users.filter((u) => u.contributorRequested).length,
        totalTasks: store.tasks.length,
        totalNoteDocs: store.notePages.length,
        totalMessages: store.userMessages.length,
        totalPointsCirculating: store.users.reduce((acc, u) => acc + (u.points || 0), 0),
        totalPointsAwarded: store.pointTransactions
          .filter((t) => t.amount > 0)
          .reduce((acc, t) => acc + t.amount, 0),
        activeProKeys: store.licenseKeys.filter((k) => k.status === 'active').length,
        unusedProKeys: store.licenseKeys.filter((k) => k.status === 'unused').length,
        totalMaterialPurchases: purchases.length,
        totalMaterialRevenuePts: purchases.reduce((acc, p) => acc + (p.totalCost || 0), 0),
      },
      users: [...store.users]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((u) => sanitizeUserForClient(u)),
      materials: store.studyMaterials,
      materialPurchases: purchases,
      licenseKeys: store.licenseKeys,
      contributorFolders: store.contributorFolders || [],
      contributorFiles: store.contributorFiles || [],
    };
  }
}

export async function getSuperUsersAndPointsLedger() {
  const contributorWeeklyPoints = await getContributorWeeklyPoints();

  const buildPayload = (
    allUsers: ReturnType<typeof sanitizeUserForClient>[],
    allTx: {
      id: number;
      userId: number;
      amount: number;
      reason: string;
      category: string;
      createdAt: Date | string;
    }[],
    allMaterials: { uploaderId: number }[],
    allNotes: { userId: number }[],
    allTasks: { userId: number }[]
  ) => {
    const userMap = new Map(allUsers.map((u) => [u.id, u]));
    const txStats = new Map<
      number,
      { earned: number; spent: number; count: number }
    >();
    let totalPointsEarned = 0;
    let totalPointsSpent = 0;

    for (const tx of allTx) {
      const cur = txStats.get(tx.userId) || { earned: 0, spent: 0, count: 0 };
      cur.count += 1;
      if (tx.amount > 0) {
        cur.earned += tx.amount;
        totalPointsEarned += tx.amount;
      } else if (tx.amount < 0) {
        cur.spent += Math.abs(tx.amount);
        totalPointsSpent += Math.abs(tx.amount);
      }
      txStats.set(tx.userId, cur);
    }

    const materialCounts = new Map<number, number>();
    for (const m of allMaterials) {
      materialCounts.set(m.uploaderId, (materialCounts.get(m.uploaderId) || 0) + 1);
    }
    const noteCounts = new Map<number, number>();
    for (const n of allNotes) {
      noteCounts.set(n.userId, (noteCounts.get(n.userId) || 0) + 1);
    }
    const taskCounts = new Map<number, number>();
    for (const t of allTasks) {
      taskCounts.set(t.userId, (taskCounts.get(t.userId) || 0) + 1);
    }

    const enrichedUsers = allUsers.map((u) => {
      const st = txStats.get(u.id) || { earned: 0, spent: 0, count: 0 };
      return {
        ...u,
        pointsEarned: st.earned,
        pointsSpent: st.spent,
        txCount: st.count,
        materialsCount: materialCounts.get(u.id) || 0,
        notesCount: noteCounts.get(u.id) || 0,
        tasksCount: taskCounts.get(u.id) || 0,
      };
    });

    const allTxTyped = allTx as {
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
      createdAt: Date | string;
    }[];

    const recentTransactions = allTxTyped.slice(0, 150).map((tx) => {
      const u = userMap.get(tx.userId);
      return {
        id: tx.id,
        userId: tx.userId,
        amount: tx.amount,
        reason: tx.reason,
        category: tx.category,
        verificationStatus: tx.verificationStatus || 'pending',
        verifiedByUserId: tx.verifiedByUserId ?? null,
        verifiedByLabel: tx.verifiedByLabel || '',
        verificationNote: tx.verificationNote || '',
        verifiedAt: tx.verifiedAt || '',
        revertedTransactionId: tx.revertedTransactionId ?? null,
        createdAt:
          tx.createdAt instanceof Date
            ? tx.createdAt.toISOString()
            : String(tx.createdAt),
        userEmail: u?.email || '',
        username: u?.username || `user_${tx.userId}`,
        displayName: u?.displayName || 'Unknown User',
        shortUid: u?.shortUid || '',
        currentBalance: u?.points ?? 0,
      };
    });

    return {
      summary: {
        totalUsers: enrichedUsers.length,
        totalPointsCirculating: enrichedUsers.reduce((s, u) => s + (u.points || 0), 0),
        totalPointsEarned,
        totalPointsSpent,
        proUsers: enrichedUsers.filter((u) => u.plan === 'pro').length,
        eliteUsers: enrichedUsers.filter((u) => u.plan === 'elite').length,
        basicUsers: enrichedUsers.filter((u) => u.plan === 'basic').length,
        approvedContributors: enrichedUsers.filter((u) => Boolean(u.contributorApproved)).length,
        contributorWeeklyPoints,
      },
      users: enrichedUsers,
      recentTransactions,
    };
  };

  try {
    const [allUsers, allTx, allMaterials, allNotes, allTasks] = await Promise.all([
      db.select().from(users).orderBy(desc(users.points)),
      db.select().from(pointTransactions).orderBy(desc(pointTransactions.createdAt)),
      db.select({ uploaderId: studyMaterials.uploaderId }).from(studyMaterials),
      db.select({ userId: notePages.userId }).from(notePages),
      db.select({ userId: tasks.userId }).from(tasks),
    ]);
    return buildPayload(
      allUsers.map((u) => sanitizeUserForClient(u)),
      allTx,
      allMaterials,
      allNotes,
      allTasks
    );
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const sortedUsers = [...store.users]
      .sort((a, b) => (b.points || 0) - (a.points || 0))
      .map((u) => sanitizeUserForClient(u));
    const sortedTx = [...store.pointTransactions].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
    return buildPayload(
      sortedUsers,
      sortedTx,
      store.studyMaterials,
      store.notePages,
      store.tasks
    );
  }
}

export async function listPointTransactionsForAdmin() {
  const buildResponse = (
    allUsers: ReturnType<typeof sanitizeUserForClient>[],
    allTx: {
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
      createdAt: Date | string;
    }[]
  ) => {
    const userMap = new Map(allUsers.map((u) => [u.id, u]));
    let pending = 0;
    let verified = 0;
    let reverted = 0;
    let dismissed = 0;

    const transactions = allTx.slice(0, 250).map((tx) => {
      const status = tx.verificationStatus || 'pending';
      if (status === 'verified') verified += 1;
      else if (status === 'reverted') reverted += 1;
      else if (status === 'dismissed') dismissed += 1;
      else pending += 1;

      const u = userMap.get(tx.userId);
      return {
        id: tx.id,
        userId: tx.userId,
        amount: tx.amount,
        reason: tx.reason,
        category: tx.category,
        verificationStatus: status,
        verifiedByUserId: tx.verifiedByUserId ?? null,
        verifiedByLabel: tx.verifiedByLabel || '',
        verificationNote: tx.verificationNote || '',
        verifiedAt: tx.verifiedAt || '',
        revertedTransactionId: tx.revertedTransactionId ?? null,
        createdAt:
          tx.createdAt instanceof Date ? tx.createdAt.toISOString() : String(tx.createdAt),
        userEmail: u?.email || '',
        username: u?.username || `user_${tx.userId}`,
        displayName: u?.displayName || 'Unknown User',
        shortUid: u?.shortUid || '',
        currentBalance: u?.points ?? 0,
      };
    });

    return {
      summary: {
        total: transactions.length,
        pending,
        verified,
        reverted,
        dismissed,
      },
      transactions,
    };
  };

  try {
    const [allUsers, allTx] = await Promise.all([
      db.select().from(users),
      db.select().from(pointTransactions).orderBy(desc(pointTransactions.createdAt)),
    ]);
    return buildResponse(
      allUsers.map((u) => sanitizeUserForClient(u)),
      allTx
    );
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const sortedTx = [...store.pointTransactions].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
    return buildResponse(
      store.users.map((u) => sanitizeUserForClient(u)),
      sortedTx
    );
  }
}

export async function reviewPointTransaction(params: {
  reviewerId: number;
  reviewerEmail: string;
  reviewerUsername: string;
  reviewerShortUid: string;
  reviewerRole: string;
  transactionId: number;
  action: 'verify' | 'revert' | 'dismiss';
  note?: string;
}) {
  const reviewerLabel = `${params.reviewerRole === 'super' ? 'Super' : 'Admin'} (@${
    params.reviewerUsername || params.reviewerEmail
  }${params.reviewerShortUid ? ` · ${params.reviewerShortUid}` : ''})`;
  const nowIso = new Date().toISOString();
  const cleanNote = (params.note || '').trim().slice(0, 300);

  if ((params.action === 'revert' || params.action === 'dismiss') && !cleanNote) {
    throw new Error('Please enter a justification note when reverting or dismissing a transaction.');
  }

  try {
    const [tx] = await db
      .select()
      .from(pointTransactions)
      .where(eq(pointTransactions.id, params.transactionId))
      .limit(1);
    if (!tx) throw new Error('Point transaction not found.');
    if (tx.category === 'admin_reversal') {
      throw new Error('Admin reversal entries cannot be reverted again.');
    }
    if (
      (params.action === 'revert' || params.action === 'dismiss') &&
      (tx.verificationStatus === 'reverted' || tx.verificationStatus === 'dismissed')
    ) {
      throw new Error(`This transaction has already been ${tx.verificationStatus}.`);
    }

    if (params.action === 'verify') {
      const [updated] = await db
        .update(pointTransactions)
        .set({
          verificationStatus: 'verified',
          verifiedByUserId: params.reviewerId,
          verifiedByLabel: reviewerLabel,
          verificationNote: cleanNote || 'Verified by Admin',
          verifiedAt: nowIso,
        })
        .where(eq(pointTransactions.id, tx.id))
        .returning();
      return { transaction: updated, reversedDelta: 0 };
    }

    const [targetUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, tx.userId))
      .limit(1);
    if (!targetUser) throw new Error('Associated user account not found.');

    const currentBalance = targetUser.points || 0;
    const requestedDelta = -tx.amount;
    const nextBalance = Math.max(0, currentBalance + requestedDelta);
    const appliedDelta = nextBalance - currentBalance;
    const targetStatus = params.action === 'dismiss' ? 'dismissed' : 'reverted';

    await db
      .update(users)
      .set({ points: nextBalance, updatedAt: new Date() })
      .where(eq(users.id, targetUser.id));

    const [updatedTx] = await db
      .update(pointTransactions)
      .set({
        verificationStatus: targetStatus,
        verifiedByUserId: params.reviewerId,
        verifiedByLabel: reviewerLabel,
        verificationNote: cleanNote,
        verifiedAt: nowIso,
      })
      .where(eq(pointTransactions.id, tx.id))
      .returning();

    const reversalReason = `Admin ${targetStatus} Tx #${tx.id} (${tx.amount >= 0 ? `+${tx.amount}` : tx.amount} pts · "${tx.reason}"): ${cleanNote}`;
    const [reversalEntry] = await db
      .insert(pointTransactions)
      .values({
        userId: targetUser.id,
        amount: appliedDelta,
        reason: reversalReason.slice(0, 320),
        category: 'admin_reversal',
        verificationStatus: 'verified',
        verifiedByUserId: params.reviewerId,
        verifiedByLabel: reviewerLabel,
        verificationNote: cleanNote,
        verifiedAt: nowIso,
        revertedTransactionId: tx.id,
      })
      .returning();

    const signDelta = appliedDelta >= 0 ? `+${appliedDelta}` : `${appliedDelta}`;
    const mailSubject = `Admin ${targetStatus === 'dismissed' ? 'Dismissed' : 'Reverted'} Point Transaction (${signDelta} pts)`;
    const mailBody = `Hello ${targetUser.displayName},\n\n${reviewerLabel} reviewed and ${targetStatus} your point transaction #${tx.id}.\n\nOriginal Transaction: ${tx.amount >= 0 ? `+${tx.amount}` : tx.amount} pts (${tx.reason})\nBalance Adjustment Applied: ${signDelta} pts\nUpdated Balance: ${nextBalance} pts\nAdmin Justification: ${cleanNote}`;

    await Promise.all([
      db.insert(userMessages).values({
        senderId: params.reviewerId,
        recipientId: targetUser.id,
        senderEmail: params.reviewerEmail,
        senderUsername: params.reviewerUsername,
        recipientEmail: targetUser.email,
        recipientUsername: targetUser.username,
        visibility: 'direct',
        isAdminMail: true,
        recipientSummary: `@${targetUser.username || targetUser.email}`,
        subject: mailSubject,
        body: mailBody,
      }),
      db.insert(notifications).values({
        userId: targetUser.id,
        senderId: params.reviewerId,
        senderLabel: reviewerLabel,
        title: mailSubject,
        message: `${signDelta} pts adjustment (${cleanNote})`,
        type: 'points',
      }),
    ]);

    return {
      transaction: updatedTx,
      reversalEntry,
      reversedDelta: appliedDelta,
      newBalance: nextBalance,
    };
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const tx = store.pointTransactions.find((t) => t.id === params.transactionId);
    if (!tx) throw new Error('Point transaction not found.');
    if (tx.category === 'admin_reversal') {
      throw new Error('Admin reversal entries cannot be reverted again.');
    }
    if (
      (params.action === 'revert' || params.action === 'dismiss') &&
      (tx.verificationStatus === 'reverted' || tx.verificationStatus === 'dismissed')
    ) {
      throw new Error(`This transaction has already been ${tx.verificationStatus}.`);
    }

    if (params.action === 'verify') {
      tx.verificationStatus = 'verified';
      tx.verifiedByUserId = params.reviewerId;
      tx.verifiedByLabel = reviewerLabel;
      tx.verificationNote = cleanNote || 'Verified by Admin';
      tx.verifiedAt = nowIso;
      persistLocalStore();
      return { transaction: tx, reversedDelta: 0 };
    }

    const targetUser = store.users.find((u) => u.id === tx.userId);
    if (!targetUser) throw new Error('Associated user account not found.');

    const currentBalance = targetUser.points || 0;
    const requestedDelta = -tx.amount;
    const nextBalance = Math.max(0, currentBalance + requestedDelta);
    const appliedDelta = nextBalance - currentBalance;
    const targetStatus = params.action === 'dismiss' ? 'dismissed' : 'reverted';

    targetUser.points = nextBalance;
    targetUser.updatedAt = new Date();
    tx.verificationStatus = targetStatus;
    tx.verifiedByUserId = params.reviewerId;
    tx.verifiedByLabel = reviewerLabel;
    tx.verificationNote = cleanNote;
    tx.verifiedAt = nowIso;

    const reversalReason = `Admin ${targetStatus} Tx #${tx.id} (${tx.amount >= 0 ? `+${tx.amount}` : tx.amount} pts · "${tx.reason}"): ${cleanNote}`;
    const reversalEntry = {
      id: nextSeq('pointTransactions'),
      userId: targetUser.id,
      amount: appliedDelta,
      reason: reversalReason.slice(0, 320),
      category: 'admin_reversal',
      verificationStatus: 'verified',
      verifiedByUserId: params.reviewerId,
      verifiedByLabel: reviewerLabel,
      verificationNote: cleanNote,
      verifiedAt: nowIso,
      revertedTransactionId: tx.id,
      createdAt: new Date(),
    };
    store.pointTransactions.unshift(reversalEntry);

    const signDelta = appliedDelta >= 0 ? `+${appliedDelta}` : `${appliedDelta}`;
    const mailSubject = `Admin ${targetStatus === 'dismissed' ? 'Dismissed' : 'Reverted'} Point Transaction (${signDelta} pts)`;
    const mailBody = `Hello ${targetUser.displayName},\n\n${reviewerLabel} reviewed and ${targetStatus} your point transaction #${tx.id}.\n\nOriginal Transaction: ${tx.amount >= 0 ? `+${tx.amount}` : tx.amount} pts (${tx.reason})\nBalance Adjustment Applied: ${signDelta} pts\nUpdated Balance: ${nextBalance} pts\nAdmin Justification: ${cleanNote}`;

    store.userMessages.unshift({
      id: nextSeq('userMessages'),
      senderId: params.reviewerId,
      recipientId: targetUser.id,
      senderEmail: params.reviewerEmail,
      senderUsername: params.reviewerUsername,
      recipientEmail: targetUser.email,
      recipientUsername: targetUser.username,
      visibility: 'direct',
      isAdminMail: true,
      recipientSummary: `@${targetUser.username || targetUser.email}`,
      subject: mailSubject,
      body: mailBody,
      attachmentTitle: '',
      attachmentNoteId: null,
      isRead: false,
      createdAt: new Date(),
    });
    store.notifications.unshift({
      id: nextSeq('notifications'),
      userId: targetUser.id,
      senderId: params.reviewerId,
      senderLabel: reviewerLabel,
      title: mailSubject,
      message: `${signDelta} pts adjustment (${cleanNote})`,
      type: 'points',
      isRead: false,
      createdAt: new Date(),
    });

    persistLocalStore();
    return {
      transaction: tx,
      reversalEntry,
      reversedDelta: appliedDelta,
      newBalance: nextBalance,
    };
  }
}

// --- CONTRIBUTORS' CONSOLE (Nested Subfolders & Files + ASAN-Master-Folder Tracking) ---
export async function listContributorWorkspace(userId: number) {
  try {
    const [folders, files] = await Promise.all([
      db
        .select()
        .from(contributorFolders)
        .where(eq(contributorFolders.userId, userId))
        .orderBy(contributorFolders.path),
      db
        .select()
        .from(contributorFiles)
        .where(eq(contributorFiles.userId, userId))
        .orderBy(desc(contributorFiles.createdAt)),
    ]);
    return { folders, files };
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    return {
      folders: (store.contributorFolders || [])
        .filter((f) => f.userId === userId)
        .sort((a, b) => a.path.localeCompare(b.path)),
      files: (store.contributorFiles || []).filter((f) => f.userId === userId),
    };
  }
}

export async function listAllContributorAssetsForMasterSync() {
  try {
    const [folders, files] = await Promise.all([
      db.select().from(contributorFolders).orderBy(contributorFolders.path),
      db.select().from(contributorFiles).orderBy(desc(contributorFiles.createdAt)),
    ]);
    return { folders, files };
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    return {
      folders: [...(store.contributorFolders || [])].sort((a, b) => a.path.localeCompare(b.path)),
      files: store.contributorFiles || [],
    };
  }
}

export async function createContributorFolder(params: {
  userId: number;
  username: string;
  name: string;
  parentId?: number | null;
  path: string;
}) {
  const cleanName = params.name.trim().replace(/[\\/]+/g, '-').slice(0, 120);
  if (!cleanName) throw new Error('Folder name is required.');
  const cleanPath = params.path.trim().replace(/^\/+|\/+$/g, '') || cleanName;
  try {
    const existing = await db
      .select()
      .from(contributorFolders)
      .where(
        and(
          eq(contributorFolders.userId, params.userId),
          eq(contributorFolders.path, cleanPath)
        )
      )
      .limit(1);
    if (existing[0]) return existing[0];
    const [created] = await db
      .insert(contributorFolders)
      .values({
        userId: params.userId,
        username: params.username,
        name: cleanName,
        parentId: params.parentId ?? null,
        path: cleanPath,
      })
      .returning();
    return created;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const existing = (store.contributorFolders || []).find(
      (f) => f.userId === params.userId && f.path === cleanPath
    );
    if (existing) return existing;
    const created = {
      id: nextSeq('contributorFolders'),
      userId: params.userId,
      username: params.username,
      name: cleanName,
      parentId: params.parentId ?? null,
      path: cleanPath,
      driveFolderId: '',
      masterDriveFolderId: '',
      createdAt: new Date(),
    };
    store.contributorFolders.push(created);
    persistLocalStore();
    return created;
  }
}

export async function updateContributorFolderDrive(
  folderId: number,
  updates: { driveFolderId?: string; masterDriveFolderId?: string }
) {
  try {
    const [updated] = await db
      .update(contributorFolders)
      .set({
        ...(updates.driveFolderId !== undefined ? { driveFolderId: updates.driveFolderId } : {}),
        ...(updates.masterDriveFolderId !== undefined
          ? { masterDriveFolderId: updates.masterDriveFolderId }
          : {}),
      })
      .where(eq(contributorFolders.id, folderId))
      .returning();
    return updated;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const item = store.contributorFolders.find((f) => f.id === folderId);
    if (!item) return undefined;
    if (updates.driveFolderId !== undefined) item.driveFolderId = updates.driveFolderId;
    if (updates.masterDriveFolderId !== undefined) {
      item.masterDriveFolderId = updates.masterDriveFolderId;
    }
    persistLocalStore();
    return item;
  }
}

export async function deleteContributorFolder(
  userId: number,
  folderId: number,
  isElevated: boolean
) {
  try {
    const [target] = await db
      .select()
      .from(contributorFolders)
      .where(eq(contributorFolders.id, folderId))
      .limit(1);
    if (!target) return;
    if (!isElevated && target.userId !== userId) {
      throw new Error('Forbidden: You can only delete your own folders.');
    }
    const prefix = `${target.path}/`;
    const allFolders = await db
      .select()
      .from(contributorFolders)
      .where(eq(contributorFolders.userId, target.userId));
    const folderIdsToRemove = allFolders
      .filter((f) => f.id === target.id || f.path.startsWith(prefix))
      .map((f) => f.id);
    const allFiles = await db
      .select()
      .from(contributorFiles)
      .where(eq(contributorFiles.userId, target.userId));
    for (const file of allFiles) {
      if (
        (file.folderId && folderIdsToRemove.includes(file.folderId)) ||
        file.folderPath === target.path ||
        file.folderPath.startsWith(prefix)
      ) {
        if (file.storedFileName) {
          const full = path.join(UPLOADS_DIR, file.storedFileName);
          if (fs.existsSync(full)) fs.unlinkSync(full);
        }
        await db.delete(contributorFiles).where(eq(contributorFiles.id, file.id));
      }
    }
    for (const fid of folderIdsToRemove) {
      await db.delete(contributorFolders).where(eq(contributorFolders.id, fid));
    }
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const target = store.contributorFolders.find((f) => f.id === folderId);
    if (!target) return;
    if (!isElevated && target.userId !== userId) {
      throw new Error('Forbidden: You can only delete your own folders.');
    }
    const prefix = `${target.path}/`;
    const removedIds = new Set(
      store.contributorFolders
        .filter((f) => f.userId === target.userId && (f.id === target.id || f.path.startsWith(prefix)))
        .map((f) => f.id)
    );
    store.contributorFiles = store.contributorFiles.filter((file) => {
      const shouldDelete =
        file.userId === target.userId &&
        ((file.folderId && removedIds.has(file.folderId)) ||
          file.folderPath === target.path ||
          file.folderPath.startsWith(prefix));
      if (shouldDelete && file.storedFileName) {
        const full = path.join(UPLOADS_DIR, file.storedFileName);
        if (fs.existsSync(full)) fs.unlinkSync(full);
      }
      return !shouldDelete;
    });
    store.contributorFolders = store.contributorFolders.filter((f) => !removedIds.has(f.id));
    persistLocalStore();
  }
}

export async function createContributorFile(params: {
  userId: number;
  username: string;
  folderId?: number | null;
  folderPath: string;
  fileName: string;
  storedFileName: string;
  mimeType: string;
  fileSizeBytes: number;
}) {
  try {
    const [created] = await db
      .insert(contributorFiles)
      .values({
        userId: params.userId,
        username: params.username,
        folderId: params.folderId ?? null,
        folderPath: params.folderPath || '',
        fileName: params.fileName,
        storedFileName: params.storedFileName,
        mimeType: params.mimeType,
        fileSizeBytes: params.fileSizeBytes,
      })
      .returning();
    return created;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const created = {
      id: nextSeq('contributorFiles'),
      userId: params.userId,
      username: params.username,
      folderId: params.folderId ?? null,
      folderPath: params.folderPath || '',
      fileName: params.fileName,
      storedFileName: params.storedFileName,
      mimeType: params.mimeType,
      fileSizeBytes: params.fileSizeBytes,
      driveFileId: '',
      driveWebLink: '',
      masterDriveFileId: '',
      masterDriveWebLink: '',
      createdAt: new Date(),
    };
    store.contributorFiles.unshift(created);
    persistLocalStore();
    return created;
  }
}

export async function getContributorFileById(id: number) {
  try {
    const [row] = await db
      .select()
      .from(contributorFiles)
      .where(eq(contributorFiles.id, id))
      .limit(1);
    return row;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    return (getLocalStore().contributorFiles || []).find((f) => f.id === id);
  }
}

export async function updateContributorFileDrive(
  fileId: number,
  updates: {
    driveFileId?: string;
    driveWebLink?: string;
    masterDriveFileId?: string;
    masterDriveWebLink?: string;
  }
) {
  try {
    const [updated] = await db
      .update(contributorFiles)
      .set({
        ...(updates.driveFileId !== undefined ? { driveFileId: updates.driveFileId } : {}),
        ...(updates.driveWebLink !== undefined ? { driveWebLink: updates.driveWebLink } : {}),
        ...(updates.masterDriveFileId !== undefined
          ? { masterDriveFileId: updates.masterDriveFileId }
          : {}),
        ...(updates.masterDriveWebLink !== undefined
          ? { masterDriveWebLink: updates.masterDriveWebLink }
          : {}),
      })
      .where(eq(contributorFiles.id, fileId))
      .returning();
    return updated;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const item = store.contributorFiles.find((f) => f.id === fileId);
    if (!item) return undefined;
    if (updates.driveFileId !== undefined) item.driveFileId = updates.driveFileId;
    if (updates.driveWebLink !== undefined) item.driveWebLink = updates.driveWebLink;
    if (updates.masterDriveFileId !== undefined) {
      item.masterDriveFileId = updates.masterDriveFileId;
    }
    if (updates.masterDriveWebLink !== undefined) {
      item.masterDriveWebLink = updates.masterDriveWebLink;
    }
    persistLocalStore();
    return item;
  }
}

export async function deleteContributorFile(
  userId: number,
  fileId: number,
  isElevated: boolean
) {
  const existing = await getContributorFileById(fileId);
  if (!existing) return;
  if (!isElevated && existing.userId !== userId) {
    throw new Error('Forbidden: You can only delete your own contributor files.');
  }
  if (existing.storedFileName) {
    const full = path.join(UPLOADS_DIR, existing.storedFileName);
    if (fs.existsSync(full)) fs.unlinkSync(full);
  }
  try {
    await db.delete(contributorFiles).where(eq(contributorFiles.id, fileId));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    store.contributorFiles = store.contributorFiles.filter((f) => f.id !== fileId);
    persistLocalStore();
  }
}

// --- EXAM MASTER BLUEPRINTS ("master" -> "test_dates" Google Sheet layout) ---
export async function getUserExamBlueprints(userId: number) {
  try {
    return await db
      .select()
      .from(examBlueprints)
      .where(eq(examBlueprints.userId, userId))
      .orderBy(desc(examBlueprints.examDate), desc(examBlueprints.createdAt));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    return getLocalStore()
      .examBlueprints.filter((b) => b.userId === userId)
      .sort((a, b) => b.examDate.localeCompare(a.examDate));
  }
}

export async function createExamBlueprint(
  userId: number,
  data: {
    paperCode: string;
    subject: string;
    examType: string;
    examDate: string;
    examTime: string;
    totalMarks: number;
    marksScored?: number | null;
    percentage?: string;
    syllabus: string[];
    questionPaperUrl?: string;
    answerSheetUrl?: string;
    correctedAnswerSheetUrl?: string;
  }
) {
  const totalMarks = Math.max(1, Math.round(Number(data.totalMarks) || 100));
  const marksScored =
    data.marksScored !== undefined && data.marksScored !== null && Number.isFinite(Number(data.marksScored))
      ? Number(data.marksScored)
      : null;
  const computedPct =
    marksScored !== null
      ? `${((marksScored / totalMarks) * 100).toFixed(1)}%`
      : data.percentage || '';

  try {
    const [created] = await db
      .insert(examBlueprints)
      .values({
        userId,
        paperCode: data.paperCode.toUpperCase(),
        subject: data.subject,
        examType: data.examType || 'JEE Main',
        examDate: data.examDate,
        examTime: data.examTime || '09:00',
        totalMarks,
        marksScored,
        percentage: computedPct,
        syllabus: data.syllabus,
        questionPaperUrl: data.questionPaperUrl || '',
        answerSheetUrl: data.answerSheetUrl || '',
        correctedAnswerSheetUrl: data.correctedAnswerSheetUrl || '',
      })
      .returning();
    return created;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const now = new Date();
    const created = {
      id: nextSeq('examBlueprints'),
      userId,
      paperCode: data.paperCode.toUpperCase(),
      subject: data.subject,
      examType: data.examType || 'JEE Main',
      examDate: data.examDate,
      examTime: data.examTime || '09:00',
      totalMarks,
      marksScored,
      percentage: computedPct,
      syllabus: data.syllabus,
      questionPaperUrl: data.questionPaperUrl || '',
      answerSheetUrl: data.answerSheetUrl || '',
      correctedAnswerSheetUrl: data.correctedAnswerSheetUrl || '',
      createdAt: now,
      updatedAt: now,
    };
    store.examBlueprints.unshift(created);
    persistLocalStore();
    return created;
  }
}

export async function updateExamBlueprint(
  userId: number,
  blueprintId: number,
  updates: {
    paperCode?: string;
    subject?: string;
    examType?: string;
    examDate?: string;
    examTime?: string;
    totalMarks?: number;
    marksScored?: number | null;
    percentage?: string;
    syllabus?: string[];
    questionPaperUrl?: string;
    answerSheetUrl?: string;
    correctedAnswerSheetUrl?: string;
  }
) {
  try {
    const [existing] = await db
      .select()
      .from(examBlueprints)
      .where(and(eq(examBlueprints.id, blueprintId), eq(examBlueprints.userId, userId)))
      .limit(1);
    if (!existing) return undefined;

    const totalMarks =
      updates.totalMarks !== undefined
        ? Math.max(1, Math.round(Number(updates.totalMarks) || 100))
        : existing.totalMarks;
    const marksScored =
      updates.marksScored !== undefined ? updates.marksScored : existing.marksScored;
    const percentage =
      marksScored !== null && marksScored !== undefined
        ? `${((marksScored / totalMarks) * 100).toFixed(1)}%`
        : updates.percentage !== undefined
          ? updates.percentage
          : '';

    const [updated] = await db
      .update(examBlueprints)
      .set({
        ...updates,
        totalMarks,
        marksScored,
        percentage,
        updatedAt: new Date(),
      })
      .where(and(eq(examBlueprints.id, blueprintId), eq(examBlueprints.userId, userId)))
      .returning();
    return updated;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const item = store.examBlueprints.find(
      (b) => b.id === blueprintId && b.userId === userId
    );
    if (!item) return undefined;
    Object.assign(item, updates);
    const totalMarks = Math.max(1, Math.round(Number(item.totalMarks) || 100));
    item.totalMarks = totalMarks;
    item.percentage =
      item.marksScored !== null && item.marksScored !== undefined
        ? `${((item.marksScored / totalMarks) * 100).toFixed(1)}%`
        : updates.percentage || '';
    item.updatedAt = new Date();
    persistLocalStore();
    return item;
  }
}

export async function deleteExamBlueprint(userId: number, blueprintId: number) {
  try {
    await db
      .delete(examBlueprints)
      .where(and(eq(examBlueprints.id, blueprintId), eq(examBlueprints.userId, userId)));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    store.examBlueprints = store.examBlueprints.filter(
      (b) => !(b.id === blueprintId && b.userId === userId)
    );
    persistLocalStore();
  }
}

// --- EXAM COUNTDOWN TIMERS ---
export async function listExamCountdowns(userId?: number) {
  const sortCountdowns = <T extends { targetDate: string; targetTime: string; id: number }>(rows: T[]) =>
    [...rows].sort((a, b) => {
      const ka = `${a.targetDate} ${a.targetTime || '00:00'}`;
      const kb = `${b.targetDate} ${b.targetTime || '00:00'}`;
      return ka.localeCompare(kb) || a.id - b.id;
    });

  try {
    const rows = userId
      ? await db
          .select()
          .from(examCountdowns)
          .where(or(eq(examCountdowns.scope, 'admin'), eq(examCountdowns.userId, userId)))
      : await db
          .select()
          .from(examCountdowns)
          .where(eq(examCountdowns.scope, 'admin'));
    return sortCountdowns(rows);
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const list = (store.examCountdowns || []).filter(
      (c) => c.scope === 'admin' || (userId !== undefined && c.userId === userId)
    );
    return sortCountdowns(list);
  }
}

export async function createExamCountdown(data: {
  userId: number | null;
  scope: 'admin' | 'user';
  title: string;
  category?: string;
  targetDate: string;
  targetTime?: string;
  pinnedByDefault?: boolean;
  createdByLabel?: string;
}) {
  const cleanTitle = data.title.trim().slice(0, 140);
  const cleanDate = data.targetDate.trim().slice(0, 16);
  const cleanTime = (data.targetTime || '').trim().slice(0, 10);
  if (!cleanTitle) throw new Error('Countdown name is required.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    throw new Error('Target date must be in YYYY-MM-DD format.');
  }
  if (cleanTime && !/^\d{2}:\d{2}$/.test(cleanTime)) {
    throw new Error('Optional target time must be in HH:mm format.');
  }

  try {
    const [created] = await db
      .insert(examCountdowns)
      .values({
        userId: data.scope === 'admin' ? null : data.userId,
        scope: data.scope,
        title: cleanTitle,
        category: (data.category || '').trim().slice(0, 60),
        targetDate: cleanDate,
        targetTime: cleanTime,
        pinnedByDefault: Boolean(data.pinnedByDefault),
        createdByLabel: (data.createdByLabel || '').trim().slice(0, 80),
      })
      .returning();
    return created;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    if (!store.examCountdowns) store.examCountdowns = [];
    const created = {
      id: nextSeq('examCountdowns'),
      userId: data.scope === 'admin' ? null : data.userId,
      scope: data.scope,
      title: cleanTitle,
      category: (data.category || '').trim().slice(0, 60),
      targetDate: cleanDate,
      targetTime: cleanTime,
      pinnedByDefault: Boolean(data.pinnedByDefault),
      createdByLabel: (data.createdByLabel || '').trim().slice(0, 80),
      createdAt: new Date(),
    };
    store.examCountdowns.push(created);
    persistLocalStore();
    return created;
  }
}

export async function deleteExamCountdown(
  userId: number,
  countdownId: number,
  isAdmin: boolean
) {
  try {
    const [existing] = await db
      .select()
      .from(examCountdowns)
      .where(eq(examCountdowns.id, countdownId))
      .limit(1);
    if (!existing) return false;
    if (existing.scope === 'admin') {
      if (!isAdmin) {
        throw new Error('Only Admin or Super can remove top-level exam countdowns.');
      }
      await db.delete(examCountdowns).where(eq(examCountdowns.id, countdownId));
      return true;
    }
    if (existing.userId !== userId && !isAdmin) {
      throw new Error('You can only delete your own custom countdown timers.');
    }
    await db.delete(examCountdowns).where(eq(examCountdowns.id, countdownId));
    return true;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const list = store.examCountdowns || [];
    const existing = list.find((c) => c.id === countdownId);
    if (!existing) return false;
    if (existing.scope === 'admin' && !isAdmin) {
      throw new Error('Only Admin or Super can remove top-level exam countdowns.');
    }
    if (existing.scope !== 'admin' && existing.userId !== userId && !isAdmin) {
      throw new Error('You can only delete your own custom countdown timers.');
    }
    store.examCountdowns = list.filter((c) => c.id !== countdownId);
    persistLocalStore();
    return true;
  }
}
