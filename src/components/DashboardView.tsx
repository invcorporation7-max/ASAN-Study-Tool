import React from 'react';
import {
  ArrowRight,
  BookOpen,
  Calendar,
  CheckSquare,
  Clock,
  Coins,
  FilePlus2,
  FolderOpen,
  Layers,
  Lock,
  Mail,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { FREE_TIER_MAX_NOTES, FREE_TIER_MAX_TASKS } from '../lib/guestStore';
import type {
  CalendarEventItem,
  DbUser,
  ExamScheduleItem,
  NavSection,
  StudyLogItem,
  StudyNotebook,
  StudyNotePage,
  StudyTask,
} from '../types';

interface DashboardViewProps {
  dbUser: DbUser | null;
  tasks: StudyTask[];
  events: CalendarEventItem[];
  notebooks: StudyNotebook[];
  notePages: StudyNotePage[];
  exams: ExamScheduleItem[];
  studyLogs: StudyLogItem[];
  onNavigate: (section: NavSection) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  dbUser,
  tasks,
  events,
  notebooks,
  notePages,
  exams,
  studyLogs,
  onNavigate,
}) => {
  const { isGuest, effectivePlan, isEffectiveProOrAdmin, exitGuestToSignIn } = useAuth();
  const isProOrAdmin = isEffectiveProOrAdmin;
  const openTasks = tasks.filter((t) => t.status !== 'done');
  const completedTasks = tasks.filter((t) => t.status === 'done');
  const scheduledExams = exams.filter((e) => e.status === 'scheduled');
  const totalLoggedMinutes = Math.round(
    studyLogs.reduce((acc, log) => acc + (log.durationSeconds || 0), 0) / 60
  );

  const todayStr = new Date().toISOString().slice(0, 10);
  const upcomingEvents = events
    .filter((e) => e.eventDate >= todayStr)
    .slice(0, 5);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-xs font-medium text-slate-500">
            Academic Workspace ·{' '}
            {isGuest
              ? 'Free Tier (Local Storage · Max 10 PDFs & 150 Tasks)'
              : `${effectivePlan.toUpperCase()} Plan · UID: ${dbUser?.shortUid || `U${dbUser?.id || 1}`} · Role: ${(dbUser?.role || 'user').toUpperCase()}`}
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900">
            Welcome back, {isGuest ? 'Guest Student' : dbUser?.displayName || 'Student'}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isGuest ? (
            <button
              type="button"
              onClick={exitGuestToSignIn}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
            >
              Sign in (Get 500 Pts &amp; Unlimited)
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('subscriptions')}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0 tabular-nums"
            >
              <Coins className="h-4 w-4 text-amber-600" />
              {dbUser?.points ?? 0} Points
            </button>
          )}
          <button
            type="button"
            onClick={() => onNavigate('notes')}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <FilePlus2 className="h-4 w-4 text-blue-600" />
            New A4 Note
          </button>
          <button
            type="button"
            onClick={() => onNavigate('timers')}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
          >
            <Clock className="h-4 w-4" />
            Launch Exam Timer
          </button>
        </div>
      </div>

      {/* Key Workspace Metrics Strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Open Tasks</div>
          <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {openTasks.length}
            {isGuest && (
              <span className="text-xs font-normal text-slate-400">
                {' '}
                / {FREE_TIER_MAX_TASKS}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {completedTasks.length} completed
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">A4 Note Documents</div>
          <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {notePages.length}
            {isGuest && (
              <span className="text-xs font-normal text-slate-400">
                {' '}
                / {FREE_TIER_MAX_NOTES}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            Across {notebooks.length} notebook{notebooks.length === 1 ? '' : 's'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Scheduled Exams</div>
          <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {scheduledExams.length}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {exams.length} total sessions (+10 pts / 30m)
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Logged Study Time</div>
          <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {totalLoggedMinutes} min
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {studyLogs.length} timed sessions
          </div>
        </div>
      </div>

      {/* Main 2-column grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2">
              <CheckSquare className="h-4 w-4 text-blue-600" />
              <h2 className="font-display text-base font-semibold text-slate-900">
                Active Tasks
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('tasks')}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap shrink-0"
            >
              Manage Tasks
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {openTasks.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-slate-500">
                No pending tasks yet. Add assignments or revision goals in My Tasks.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('tasks')}
                className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                Create First Task
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {openTasks.slice(0, 6).map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between gap-4 py-3.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">
                      {task.title}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                      <span>{task.subject}</span>
                      <span aria-hidden="true">·</span>
                      <span className="capitalize">{task.priority} priority</span>
                      {task.dueDate && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">Due {task.dueDate}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <span className="text-xs font-medium text-slate-600 capitalize whitespace-nowrap shrink-0">
                    {task.status.replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-blue-600" />
              <h2 className="font-display text-base font-semibold text-slate-900">
                Upcoming Exams &amp; Events
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('calendar')}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap shrink-0"
            >
              Open Calendar
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {scheduledExams.slice(0, 3).map((exam) => (
              <div key={`exam-${exam.id}`} className="py-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-900">
                    {exam.subject} {exam.paperName ? `(${exam.paperName})` : ''}
                  </span>
                  <span className="text-xs font-medium text-blue-600 whitespace-nowrap shrink-0">
                    {exam.examType === 'Other'
                      ? exam.customExamType || 'Custom Exam'
                      : exam.examType}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 tabular-nums">
                  <span>
                    {exam.readingMinutes}m reading + {exam.writingMinutes}m writing
                  </span>
                  {exam.seatingTime && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Seating: {exam.seatingTime.replace('T', ' ')}</span>
                    </>
                  )}
                </div>
              </div>
            ))}

            {upcomingEvents.map((ev) => (
              <div key={`ev-${ev.id}`} className="py-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-900">{ev.title}</span>
                  <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap shrink-0">
                    {ev.eventDate} {ev.eventTime}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-slate-500 capitalize">
                  {ev.category}
                </div>
              </div>
            ))}

            {scheduledExams.length === 0 && upcomingEvents.length === 0 && (
              <div className="py-10 text-center text-sm text-slate-500">
                No scheduled exams or events yet. Study events in Calendar earn +5 points.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Studio Launchers */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <button
          type="button"
          onClick={() => onNavigate('notes')}
          className="flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 text-left hover:border-blue-300 transition-colors"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900">A4 Notebooks</div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Export PDFs &amp; save .txt backups to your Drive folder.
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('study-materials')}
          className="flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 text-left hover:border-blue-300 transition-colors"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <FolderOpen className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900">
              Study Materials (+75 pts)
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Upload Question Papers (+75 pts) or Contributor Study Notes.
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('messages')}
          className="flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 text-left hover:border-blue-300 transition-colors"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
            <Mail className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900">Tool Mail</div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Message via @username, User ID, Self, or Public board.
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate(isProOrAdmin ? 'pdf-tool' : 'subscriptions')}
          className="flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 text-left hover:border-blue-300 transition-colors"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
            {isProOrAdmin ? <Layers className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900">
              {isProOrAdmin ? 'PDF Booklet Studio' : 'Subscriptions & Keys'}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              {isProOrAdmin
                ? 'Full, Half, and Quarter A4 imposition studio.'
                : 'Unlock Pro (500 pts/mo) or redeem an 8-char key.'}
            </p>
          </div>
        </button>
      </div>
    </div>
  );
};
