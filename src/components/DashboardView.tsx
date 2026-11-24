import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Calendar,
  CheckSquare,
  Clock,
  Coins,
  Eye,
  EyeOff,
  FilePlus2,
  FolderOpen,
  Layers,
  Lock,
  Mail,
  PinOff,
  RotateCcw,
  Sigma,
  SlidersHorizontal,
  Timer,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { FREE_TIER_MAX_NOTES, FREE_TIER_MAX_TASKS } from '../lib/guestStore';
import {
  CountdownPinState,
  DASHBOARD_WIDGET_META,
  DEFAULT_DASHBOARD_WIDGET_ORDER,
  getCountdownRemaining,
  isCountdownPinned,
  loadCountdownPins,
  loadDashboardPrefs,
  saveDashboardPrefs,
  toggleCountdownPin,
} from '../lib/workspacePrefs';
import type {
  CalendarEventItem,
  DashboardPreferences,
  DashboardWidgetId,
  DbUser,
  ExamCountdownItem,
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
  countdowns: ExamCountdownItem[];
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
  countdowns,
  studyLogs,
  onNavigate,
}) => {
  const { isGuest, effectivePlan, isEffectiveProOrAdmin, exitGuestToSignIn } = useAuth();
  const isProOrAdmin = isEffectiveProOrAdmin;
  const userKey = isGuest ? 'guest' : dbUser?.uid || String(dbUser?.id || 'user');

  const [prefs, setPrefs] = useState<DashboardPreferences>(() => loadDashboardPrefs(userKey));
  const [pinState, setPinState] = useState<CountdownPinState>(() => loadCountdownPins(userKey));
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setPrefs(loadDashboardPrefs(userKey));
    setPinState(loadCountdownPins(userKey));
  }, [userKey]);

  const pinnedCountdowns = useMemo(() => {
    return countdowns
      .filter((c) => isCountdownPinned(c, pinState))
      .sort((a, b) => {
        const ra = getCountdownRemaining(a, nowMs);
        const rb = getCountdownRemaining(b, nowMs);
        if (ra.expired !== rb.expired) return ra.expired ? 1 : -1;
        return ra.targetTimestamp - rb.targetTimestamp;
      });
  }, [countdowns, pinState, nowMs]);

  const showCountdownWidget =
    !prefs.hidden.includes('exam-countdowns') && pinnedCountdowns.length > 0;

  useEffect(() => {
    if (!showCountdownWidget) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [showCountdownWidget]);

  const updatePrefs = (next: DashboardPreferences) => {
    setPrefs(next);
    saveDashboardPrefs(userKey, next);
  };

  const toggleWidgetHidden = (id: DashboardWidgetId) => {
    const isHidden = prefs.hidden.includes(id);
    const hidden = isHidden
      ? prefs.hidden.filter((w) => w !== id)
      : [...prefs.hidden, id];
    updatePrefs({ ...prefs, hidden });
  };

  const moveWidgetOrder = (id: DashboardWidgetId, dir: -1 | 1) => {
    const idx = prefs.order.indexOf(id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= prefs.order.length) return;
    const order = [...prefs.order];
    const [item] = order.splice(idx, 1);
    order.splice(target, 0, item);
    updatePrefs({ ...prefs, order });
  };

  const resetDashboardPrefs = () => {
    updatePrefs({ order: [...DEFAULT_DASHBOARD_WIDGET_ORDER], hidden: [] });
  };

  const openTasks = tasks.filter((t) => t.status !== 'done');
  const completedTasks = tasks.filter((t) => t.status === 'done');
  const scheduledExams = exams.filter((e) => e.status === 'scheduled');
  const totalLoggedMinutes = Math.round(
    studyLogs.reduce((acc, log) => acc + (log.durationSeconds || 0), 0) / 60
  );

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
  const upcomingEvents = events.filter((e) => e.eventDate >= todayStr).slice(0, 6);

  const renderWidget = (widgetId: DashboardWidgetId) => {
    if (prefs.hidden.includes(widgetId)) return null;

    if (widgetId === 'metrics') {
      return (
        <div key="metrics" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Open Tasks</div>
            <div className="mt-2 font-display text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {openTasks.length}
              {isGuest && (
                <span className="text-xs font-normal text-slate-400 dark:text-slate-500">
                  {' '}
                  / {FREE_TIER_MAX_TASKS}
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {completedTasks.length} completed
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              A4 Note Documents
            </div>
            <div className="mt-2 font-display text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {notePages.length}
              {isGuest && (
                <span className="text-xs font-normal text-slate-400 dark:text-slate-500">
                  {' '}
                  / {FREE_TIER_MAX_NOTES}
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              Across {notebooks.length} notebook{notebooks.length === 1 ? '' : 's'}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Scheduled Exams
            </div>
            <div className="mt-2 font-display text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {scheduledExams.length}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {exams.length} total sessions (+10 pts / 30m)
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Logged Study Time
            </div>
            <div className="mt-2 font-display text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {totalLoggedMinutes} min
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {studyLogs.length} timed sessions
            </div>
          </div>
        </div>
      );
    }

    if (widgetId === 'exam-countdowns') {
      return (
        <section
          key="exam-countdowns"
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3.5">
            <div className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Pinned Exam Countdowns
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('timers')}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
            >
              Manage &amp; Add Countdowns
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {pinnedCountdowns.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
              <p>
                No exam countdowns pinned yet. Pin a top-level national exam or create your own custom countdown in Timers.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('timers')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-1.5 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                Open Exam Countdowns
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {pinnedCountdowns.map((item) => {
                const rem = getCountdownRemaining(item, nowMs);
                return (
                  <div
                    key={item.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/60 p-4 flex flex-col justify-between gap-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                          {item.scope === 'admin' ? `Official · ${item.category}` : item.category}
                        </div>
                        <div className="mt-0.5 truncate text-sm font-bold text-slate-900 dark:text-slate-100">
                          {item.title}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                          {item.targetDate}
                          {item.targetTime ? ` · ${item.targetTime}` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPinState(toggleCountdownPin(userKey, item, true))}
                        title="Unpin from Dashboard"
                        aria-label={`Unpin ${item.title}`}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-white dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 shrink-0"
                      >
                        <PinOff className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {rem.expired ? (
                      <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-3 py-2 text-center text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                        Target Date Reached
                      </div>
                    ) : (
                      <div className="grid grid-cols-4 gap-1.5 text-center tabular-nums">
                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-1.5">
                          <div className="font-mono text-base font-bold text-slate-900 dark:text-slate-100">
                            {String(rem.days).padStart(2, '0')}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">Days</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-1.5">
                          <div className="font-mono text-base font-bold text-slate-900 dark:text-slate-100">
                            {String(rem.hours).padStart(2, '0')}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">Hrs</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-1.5">
                          <div className="font-mono text-base font-bold text-slate-900 dark:text-slate-100">
                            {String(rem.minutes).padStart(2, '0')}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">Min</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-1.5">
                          <div className="font-mono text-base font-bold text-blue-600 dark:text-blue-400">
                            {String(rem.seconds).padStart(2, '0')}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">Sec</div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      );
    }

    if (widgetId === 'tasks') {
      return (
        <div
          key="tasks"
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6"
        >
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="flex items-center gap-2">
              <CheckSquare className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Active Tasks
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('tasks')}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0"
            >
              Manage Tasks
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {openTasks.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No pending tasks yet. Add assignments or revision goals in My Tasks.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('tasks')}
                className="mt-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                Create First Task
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {openTasks.slice(0, 6).map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between gap-4 py-3.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                      {task.title}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
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
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300 capitalize whitespace-nowrap shrink-0">
                    {task.status.replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (widgetId === 'schedule') {
      return (
        <div
          key="schedule"
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6"
        >
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Upcoming Exams &amp; Events
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('calendar')}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0"
            >
              Open Calendar
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {scheduledExams.slice(0, 3).map((exam) => (
              <div key={`exam-${exam.id}`} className="py-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {exam.subject} {exam.paperName ? `(${exam.paperName})` : ''}
                  </span>
                  <span className="text-xs font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap shrink-0">
                    {exam.examType === 'Other'
                      ? exam.customExamType || 'Custom Exam'
                      : exam.examType}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
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
                  <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {ev.title}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap shrink-0">
                    {ev.eventDate} {ev.eventTime}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 capitalize">
                  {ev.category}
                </div>
              </div>
            ))}

            {scheduledExams.length === 0 && upcomingEvents.length === 0 && (
              <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                No scheduled exams or events yet. Study events in Calendar earn points.
              </div>
            )}
          </div>
        </div>
      );
    }

    // quick-actions
    return (
      <div key="quick-actions" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <button
          type="button"
          onClick={() => onNavigate('notes')}
          className="flex items-start gap-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-left hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              A4 Notebooks
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Export PDFs &amp; save .txt backups to your Drive folder.
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('study-materials')}
          className="flex items-start gap-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-left hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
            <FolderOpen className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Study Materials
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Upload Question Papers or Contributor Study Notes.
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('specialized-calculators')}
          className="flex items-start gap-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-left hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
            {isProOrAdmin ? <Sigma className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Math Solvers Suite
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {isProOrAdmin
                ? 'Calculus, Coordinate, Algebra, Vectors 3D & Trig.'
                : 'Pro & Admin specialized math solvers suite.'}
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('messages')}
          className="flex items-start gap-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-left hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
            <Mail className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Tool Mail
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Message via @username, User ID, Self, or Public board.
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate(isProOrAdmin ? 'pdf-tool' : 'subscriptions')}
          className="flex items-start gap-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-left hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
            {isProOrAdmin ? <Layers className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {isProOrAdmin ? 'PDF Booklet Studio' : 'Subscriptions & Keys'}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {isProOrAdmin
                ? 'Full, Half, and Quarter A4 imposition studio.'
                : 'Unlock Pro (500 pts/mo) or redeem an 8-char key.'}
            </p>
          </div>
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Academic Workspace ·{' '}
            {isGuest
              ? 'Free Tier (Local Storage · Max 10 PDFs & 150 Tasks)'
              : `${effectivePlan.toUpperCase()} Plan · UID: ${dbUser?.shortUid || `U${dbUser?.id || 1}`} · Role: ${(dbUser?.role || 'user').toUpperCase()}`}
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Welcome back, {isGuest ? 'Guest Student' : dbUser?.displayName || 'Student'}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setCustomizeOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              customizeOpen
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Customize Dashboard
          </button>

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
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 tabular-nums"
            >
              <Coins className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              {dbUser?.points ?? 0} Points
            </button>
          )}
          <button
            type="button"
            onClick={() => onNavigate('notes')}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <FilePlus2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
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

      {/* Inline Customize Dashboard Panel */}
      {customizeOpen && (
        <div className="rounded-xl border border-blue-200 dark:border-blue-800/80 bg-white dark:bg-slate-900 p-5 space-y-4 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Customize Dashboard Layout
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Reorder or hide widgets on your Dashboard. Changes save automatically for your account.
              </p>
            </div>
            <button
              type="button"
              onClick={resetDashboardPrefs}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset Default
            </button>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {prefs.order.map((wId, idx) => {
              const meta = DASHBOARD_WIDGET_META[wId];
              const isHidden = prefs.hidden.includes(wId);
              return (
                <div
                  key={wId}
                  className={`flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 ${
                    isHidden
                      ? 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 opacity-70'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/70'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {meta.label}
                    </div>
                    <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                      Position #{idx + 1} · {isHidden ? 'Hidden' : 'Visible'}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveWidgetOrder(wId, -1)}
                      aria-label={`Move ${meta.label} up`}
                      className="rounded border border-slate-200 dark:border-slate-700 p-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-35"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === prefs.order.length - 1}
                      onClick={() => moveWidgetOrder(wId, 1)}
                      aria-label={`Move ${meta.label} down`}
                      className="rounded border border-slate-200 dark:border-slate-700 p-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-35"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleWidgetHidden(wId)}
                      aria-label={isHidden ? `Show ${meta.label}` : `Hide ${meta.label}`}
                      className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium ${
                        isHidden
                          ? 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                          : 'border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                      }`}
                    >
                      {isHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      {isHidden ? 'Show' : 'Hide'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Render Widgets in Custom Order */}
      <div className="space-y-6">{prefs.order.map((wId) => renderWidget(wId))}</div>
    </div>
  );
};

