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
  examSchedules,
  licenseKeys,
  materialPurchases,
  notebooks,
  notePages,
  notifications,
  pointTransactions,
  studyLogs,
  studyMaterials,
  tasks,
  userMessages,
  users,
} from './schema.ts';
import {
  awardPoints,
  getContributorWeeklyPoints,
  sanitizeUserForClient,
} from './users.ts';

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
  const pointsAwarded = studyVerified ? 5 : 0;

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
    return created;
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
    return created;
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
  const pointsAwarded = isExamMode ? blocksOf30Min * 10 : 0;

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
  try {
    return await db
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
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    return getLocalStore().userMessages.filter(
      (m) => m.senderId === userId || m.recipientId === userId || m.visibility === 'public'
    );
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
        return inserted;
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
        return inserted;
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

export async function createStudyMaterial(data: {
  uploaderId: number;
  uploaderEmail: string;
  uploaderName: string;
  title: string;
  subject: string;
  category: string;
  fileName: string;
  storedFileName: string;
  mimeType: string;
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

  const pointsAwarded = data.category === 'question_paper' ? 75 : 0;
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
        fileName: data.fileName,
        storedFileName: data.storedFileName,
        mimeType: data.mimeType,
        fileSizeBytes: data.fileSizeBytes,
        pageCount,
        hourlyRentCost,
        buyCost,
        status: 'approved',
      })
      .returning();

    if (pointsAwarded > 0) {
      await awardPoints(
        data.uploaderId,
        pointsAwarded,
        `Uploaded Question Paper: ${data.title}`,
        'question_paper'
      );
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
      fileName: data.fileName,
      storedFileName: data.storedFileName,
      mimeType: data.mimeType,
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
      await awardPoints(
        data.uploaderId,
        pointsAwarded,
        `Uploaded Question Paper: ${data.title}`,
        'question_paper'
      );
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
  opts: { accessType: 'rent' | 'buy'; hours?: number }
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
  const totalCost = accessType === 'buy' ? buyCost : hourlyRate * hours;
  const expiresAt =
    accessType === 'rent' ? new Date(Date.now() + hours * 3600 * 1000).toISOString() : '';

  try {
    const [buyer] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!buyer) throw new Error('User not found.');
    if ((buyer.points || 0) < totalCost) {
      throw new Error(
        `Insufficient points. Need ${totalCost} pts (${buyer.points || 0} pts available).`
      );
    }

    const updatedBuyer = await awardPoints(
      userId,
      -totalCost,
      `${accessType === 'buy' ? 'Purchased' : `Rented (${hours}h)`} "${item.title}" (${pageCount}p)`,
      accessType === 'buy' ? 'material_buy' : 'material_rent'
    );

    const royalty = Math.max(1, Math.round(totalCost * 0.5));
    await awardPoints(
      item.uploaderId,
      royalty,
      `Royalty from ${buyer.displayName} (${accessType === 'buy' ? 'Buy' : `${hours}h Rent`}): ${item.title}`,
      'material_sale'
    );

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
        totalCost,
        expiresAt,
      })
      .returning();

    await db.insert(notifications).values({
      userId: buyer.id,
      senderLabel: 'Study Material Repository',
      title: accessType === 'buy' ? `Purchased: ${item.title}` : `Rented (${hours}h): ${item.title}`,
      message: `${totalCost} pts deducted (${pageCount} pages, ${hourlyRate} pts/hr rate).${
        expiresAt ? ` Access until ${new Date(expiresAt).toLocaleString()}.` : ' Permanent access unlocked.'
      }`,
      type: 'material_access',
    });

    return {
      purchase,
      points: updatedBuyer?.points ?? Math.max(0, (buyer.points || 0) - totalCost),
      message:
        accessType === 'buy'
          ? `Purchased "${item.title}" permanently for ${totalCost} points.`
          : `Rented "${item.title}" for ${hours} hour(s) (${totalCost} points).`,
    };
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      throw error instanceof Error ? error : new Error('Failed to acquire study material.');
    }
    const store = getLocalStore();
    const buyer = store.users.find((u) => u.id === userId);
    if (!buyer) throw new Error('User not found.');
    if ((buyer.points || 0) < totalCost) {
      throw new Error(
        `Insufficient points. Need ${totalCost} pts (${buyer.points || 0} pts available).`
      );
    }

    const updatedBuyer = await awardPoints(
      userId,
      -totalCost,
      `${accessType === 'buy' ? 'Purchased' : `Rented (${hours}h)`} "${item.title}" (${pageCount}p)`,
      accessType === 'buy' ? 'material_buy' : 'material_rent'
    );

    const royalty = Math.max(1, Math.round(totalCost * 0.5));
    await awardPoints(
      item.uploaderId,
      royalty,
      `Royalty from ${buyer.displayName} (${accessType === 'buy' ? 'Buy' : `${hours}h Rent`}): ${item.title}`,
      'material_sale'
    );

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
      totalCost,
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
      message: `${totalCost} pts deducted (${pageCount} pages, ${hourlyRate} pts/hr rate).`,
      type: 'material_access',
      isRead: false,
      createdAt: new Date(),
    });
    persistLocalStore();

    return {
      purchase,
      points: updatedBuyer?.points ?? buyer.points,
      message:
        accessType === 'buy'
          ? `Purchased "${item.title}" permanently for ${totalCost} points.`
          : `Rented "${item.title}" for ${hours} hour(s) (${totalCost} points).`,
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
        adminUsers: allUsers.filter((u) => u.role === 'admin' || u.role === 'super').length,
        approvedContributors: allUsers.filter(
          (u) => u.role === 'contributor' && u.contributorApproved
        ).length,
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
        adminUsers: store.users.filter((u) => u.role === 'admin' || u.role === 'super').length,
        approvedContributors: store.users.filter(
          (u) => u.role === 'contributor' && u.contributorApproved
        ).length,
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
        basicUsers: enrichedUsers.filter((u) => u.plan !== 'pro').length,
        approvedContributors: enrichedUsers.filter(
          (u) => u.role === 'contributor' && u.contributorApproved
        ).length,
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

