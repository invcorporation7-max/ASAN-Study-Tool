import type {
  A4PageItem,
  CalendarEventItem,
  ExamScheduleItem,
  StudyLogItem,
  StudyNotebook,
  StudyNotePage,
  StudyTask,
} from '../types';

export const FREE_TIER_MAX_NOTES = 10;
export const FREE_TIER_MAX_TASKS = 150;

const GUEST_DATA_KEY = 'asan_free_tier_workspace_v1';

export interface GuestWorkspaceState {
  seq: number;
  tasks: StudyTask[];
  events: CalendarEventItem[];
  notebooks: StudyNotebook[];
  notePages: StudyNotePage[];
  exams: ExamScheduleItem[];
  studyLogs: StudyLogItem[];
}

function defaultGuestState(): GuestWorkspaceState {
  const now = new Date().toISOString();
  return {
    seq: 10,
    tasks: [],
    events: [],
    notebooks: [
      {
        id: 1,
        userId: 0,
        title: 'Free Tier Study Notebook',
        subject: 'General Studies',
        color: '#2563EB',
        createdAt: now,
        updatedAt: now,
      },
    ],
    notePages: [
      {
        id: 1,
        notebookId: 1,
        userId: 0,
        sectionName: 'Quick Start',
        title: 'Free Tier A4 Sample Note',
        pagesData: [
          {
            id: 'guest-p1',
            pageNumber: 1,
            title: 'Page 1',
            blocks: [
              {
                id: 'guest-b1',
                type: 'heading',
                content: 'Free Tier A4 Note (Up to 10 Notes & 150 Tasks)',
                fontSize: 16,
              },
              {
                id: 'guest-b2',
                type: 'text',
                content:
                  'You are using ASAN-Study_tool Free Tier locally without login. Sign in with Google for unlimited notes/tasks in your Google Drive folder + 500 initial points.',
                fontSize: 10,
              },
            ],
          },
        ],
        createdAt: now,
        updatedAt: now,
      },
    ],
    exams: [],
    studyLogs: [],
  };
}

export function loadGuestWorkspace(): GuestWorkspaceState {
  try {
    const raw = localStorage.getItem(GUEST_DATA_KEY);
    if (!raw) {
      const def = defaultGuestState();
      localStorage.setItem(GUEST_DATA_KEY, JSON.stringify(def));
      return def;
    }
    const parsed = JSON.parse(raw) as Partial<GuestWorkspaceState>;
    const def = defaultGuestState();
    return {
      seq: parsed.seq || 10,
      tasks: parsed.tasks || [],
      events: parsed.events || [],
      notebooks: parsed.notebooks?.length ? parsed.notebooks : def.notebooks,
      notePages: parsed.notePages || def.notePages,
      exams: parsed.exams || [],
      studyLogs: parsed.studyLogs || [],
    };
  } catch {
    return defaultGuestState();
  }
}

export function saveGuestWorkspace(state: GuestWorkspaceState) {
  try {
    localStorage.setItem(GUEST_DATA_KEY, JSON.stringify(state));
  } catch {
    // ignore quota errors
  }
}

export function guestCreateTask(data: {
  title: string;
  description?: string;
  subject?: string;
  priority?: 'low' | 'medium' | 'high';
  dueDate?: string;
}) {
  const state = loadGuestWorkspace();
  if (state.tasks.length >= FREE_TIER_MAX_TASKS) {
    throw new Error(
      `Free Tier limit reached (${FREE_TIER_MAX_TASKS} tasks). Sign in with Google (Basic) for unlimited tasks stored in your Drive folder.`
    );
  }
  const now = new Date().toISOString();
  const id = ++state.seq;
  const created: StudyTask = {
    id,
    userId: 0,
    title: data.title,
    description: data.description || '',
    subject: data.subject || 'General',
    priority: data.priority || 'medium',
    status: 'todo',
    dueDate: data.dueDate || '',
    dueTime: '',
    createdAt: now,
    updatedAt: now,
  };
  state.tasks.unshift(created);
  saveGuestWorkspace(state);
  return created;
}

export function guestUpdateTask(id: number, patch: Partial<StudyTask>) {
  const state = loadGuestWorkspace();
  state.tasks = state.tasks.map((t) =>
    t.id === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t
  );
  saveGuestWorkspace(state);
}

export function guestDeleteTask(id: number) {
  const state = loadGuestWorkspace();
  state.tasks = state.tasks.filter((t) => t.id !== id);
  saveGuestWorkspace(state);
}

export function guestCreateEvent(data: {
  title: string;
  eventDate: string;
  eventTime?: string;
  category?: string;
  notes?: string;
}) {
  const state = loadGuestWorkspace();
  const id = ++state.seq;
  const created: CalendarEventItem = {
    id,
    userId: 0,
    title: data.title,
    eventDate: data.eventDate,
    eventTime: data.eventTime || '09:00',
    category: data.category || 'study',
    notes: data.notes || '',
    meetLink: '',
    createdAt: new Date().toISOString(),
  };
  state.events.push(created);
  saveGuestWorkspace(state);
  return created;
}

export function guestDeleteEvent(id: number) {
  const state = loadGuestWorkspace();
  state.events = state.events.filter((e) => e.id !== id);
  saveGuestWorkspace(state);
}

export function guestCreateNotebook(data: { title: string; subject?: string }) {
  const state = loadGuestWorkspace();
  const now = new Date().toISOString();
  const created: StudyNotebook = {
    id: ++state.seq,
    userId: 0,
    title: data.title,
    subject: data.subject || 'General',
    color: '#2563EB',
    createdAt: now,
    updatedAt: now,
  };
  state.notebooks.unshift(created);
  saveGuestWorkspace(state);
  return created;
}

export function guestDeleteNotebook(id: number) {
  const state = loadGuestWorkspace();
  state.notebooks = state.notebooks.filter((n) => n.id !== id);
  state.notePages = state.notePages.filter((p) => p.notebookId !== id);
  saveGuestWorkspace(state);
}

export function guestCreateNotePage(data: {
  notebookId: number;
  sectionName: string;
  title: string;
  pagesData: A4PageItem[];
}) {
  const state = loadGuestWorkspace();
  if (state.notePages.length >= FREE_TIER_MAX_NOTES) {
    throw new Error(
      `Free Tier limit reached (${FREE_TIER_MAX_NOTES} PDF note documents). Sign in with Google (Basic) for unlimited notes stored in your Drive folder.`
    );
  }
  const now = new Date().toISOString();
  const created: StudyNotePage = {
    id: ++state.seq,
    notebookId: data.notebookId,
    userId: 0,
    sectionName: data.sectionName,
    title: data.title,
    pagesData: data.pagesData,
    createdAt: now,
    updatedAt: now,
  };
  state.notePages.unshift(created);
  saveGuestWorkspace(state);
  return created;
}

export function guestUpdateNotePage(
  id: number,
  patch: { title?: string; sectionName?: string; pagesData?: A4PageItem[] }
) {
  const state = loadGuestWorkspace();
  state.notePages = state.notePages.map((p) =>
    p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p
  );
  saveGuestWorkspace(state);
}

export function guestDeleteNotePage(id: number) {
  const state = loadGuestWorkspace();
  state.notePages = state.notePages.filter((p) => p.id !== id);
  saveGuestWorkspace(state);
}

export function guestCreateExam(data: Omit<ExamScheduleItem, 'id' | 'userId' | 'createdAt'>) {
  const state = loadGuestWorkspace();
  const created: ExamScheduleItem = {
    id: ++state.seq,
    userId: 0,
    ...data,
    createdAt: new Date().toISOString(),
  };
  state.exams.unshift(created);
  saveGuestWorkspace(state);
  return created;
}

export function guestDeleteExam(id: number) {
  const state = loadGuestWorkspace();
  state.exams = state.exams.filter((ex) => ex.id !== id);
  saveGuestWorkspace(state);
}

export function guestCreateStudyLog(data: {
  mode: string;
  label: string;
  durationSeconds: number;
}) {
  const state = loadGuestWorkspace();
  const created: StudyLogItem = {
    id: ++state.seq,
    userId: 0,
    ...data,
    createdAt: new Date().toISOString(),
  };
  state.studyLogs.unshift(created);
  saveGuestWorkspace(state);
  return created;
}
