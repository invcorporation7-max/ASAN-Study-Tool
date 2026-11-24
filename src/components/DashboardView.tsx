import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Calendar,
  CalendarDays,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coins,
  Eye,
  EyeOff,
  FilePlus2,
  FolderOpen,
  GripVertical,
  Layers,
  Lock,
  Mail,
  Maximize2,
  Pin,
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
  DEFAULT_HIDDEN_WIDGETS,
  DEFAULT_WIDGET_SIZES,
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
  DashboardTileSize,
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

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
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
  const [resizeReorderMode, setResizeReorderMode] = useState(false);
  const [managePinsOpen, setManagePinsOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [draggedWidgetId, setDraggedWidgetId] = useState<DashboardWidgetId | null>(null);
  const [dragOverWidgetId, setDragOverWidgetId] = useState<DashboardWidgetId | null>(null);

  const today = new Date();
  const todayStr = fmtDate(today);
  const [calMonth, setCalMonth] = useState(() => ({
    year: today.getFullYear(),
    month: today.getMonth(),
  }));
  const [selectedCalDate, setSelectedCalDate] = useState(todayStr);

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

  const getWidgetSize = (id: DashboardWidgetId): DashboardTileSize => {
    return prefs.sizes?.[id] || DEFAULT_WIDGET_SIZES[id] || { colSpan: 1, rowSpan: 1 };
  };

  const toggleWidgetColSpan = (id: DashboardWidgetId) => {
    const cur = getWidgetSize(id);
    const nextSize: DashboardTileSize = {
      ...cur,
      colSpan: cur.colSpan === 2 ? 1 : 2,
    };
    updatePrefs({
      ...prefs,
      sizes: { ...(prefs.sizes || {}), [id]: nextSize },
    });
  };

  const toggleWidgetRowSpan = (id: DashboardWidgetId) => {
    const cur = getWidgetSize(id);
    const nextSize: DashboardTileSize = {
      ...cur,
      rowSpan: cur.rowSpan === 2 ? 1 : 2,
    };
    updatePrefs({
      ...prefs,
      sizes: { ...(prefs.sizes || {}), [id]: nextSize },
    });
  };

  const toggleWidgetHidden = (id: DashboardWidgetId) => {
    const isHidden = prefs.hidden.includes(id);
    const hidden = isHidden
      ? prefs.hidden.filter((w) => w !== id)
      : [...prefs.hidden, id];
    updatePrefs({ ...prefs, hidden });
  };

  const reorderWidgets = (sourceId: DashboardWidgetId, targetId: DashboardWidgetId) => {
    if (sourceId === targetId) return;
    const fromIdx = prefs.order.indexOf(sourceId);
    const toIdx = prefs.order.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const order = [...prefs.order];
    const [item] = order.splice(fromIdx, 1);
    order.splice(toIdx, 0, item);
    updatePrefs({ ...prefs, order });
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
    updatePrefs({
      order: [...DEFAULT_DASHBOARD_WIDGET_ORDER],
      hidden: [...DEFAULT_HIDDEN_WIDGETS],
      sizes: { ...DEFAULT_WIDGET_SIZES },
    });
  };

  const openTasks = tasks.filter((t) => t.status !== 'done');
  const completedTasks = tasks.filter((t) => t.status === 'done');
  const scheduledExams = exams.filter((e) => e.status === 'scheduled');
  const totalLoggedMinutes = Math.round(
    studyLogs.reduce((acc, log) => acc + (log.durationSeconds || 0), 0) / 60
  );
  const upcomingEvents = events.filter((e) => e.eventDate >= todayStr).slice(0, 6);

  // Calendar grid for optional Monthly Calendar widget
  const calGridDays = useMemo(() => {
    const first = new Date(calMonth.year, calMonth.month, 1);
    const startOffset = first.getDay();
    const daysInMonth = new Date(calMonth.year, calMonth.month + 1, 0).getDate();
    const cells: { dateStr: string; day: number; inMonth: boolean }[] = [];
    for (let i = startOffset - 1; i >= 0; i--) {
      const d = new Date(calMonth.year, calMonth.month, -i);
      cells.push({ dateStr: fmtDate(d), day: d.getDate(), inMonth: false });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(calMonth.year, calMonth.month, day);
      cells.push({ dateStr: fmtDate(d), day, inMonth: true });
    }
    while (cells.length % 7 !== 0) {
      const idx = cells.length - (startOffset + daysInMonth) + 1;
      const d = new Date(calMonth.year, calMonth.month + 1, idx);
      cells.push({ dateStr: fmtDate(d), day: d.getDate(), inMonth: false });
    }
    return cells;
  }, [calMonth]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEventItem[]>();
    events.forEach((ev) => {
      const list = map.get(ev.eventDate) || [];
      list.push(ev);
      map.set(ev.eventDate, list);
    });
    return map;
  }, [events]);

  const tasksByDueDate = useMemo(() => {
    const map = new Map<string, StudyTask[]>();
    tasks.forEach((t) => {
      if (!t.dueDate) return;
      const list = map.get(t.dueDate) || [];
      list.push(t);
      map.set(t.dueDate, list);
    });
    return map;
  }, [tasks]);

  const selectedDayEvents = eventsByDate.get(selectedCalDate) || [];
  const selectedDayTasks = tasksByDueDate.get(selectedCalDate) || [];

  const monthlyCalendarHidden = prefs.hidden.includes('monthly-calendar');

  const wrapWidgetTile = (
    widgetId: DashboardWidgetId,
    content: React.ReactNode,
    outerCard = true
  ) => {
    const size = getWidgetSize(widgetId);
    const meta = DASHBOARD_WIDGET_META[widgetId];
    const isDragging = draggedWidgetId === widgetId;
    const isDragOver = dragOverWidgetId === widgetId && draggedWidgetId !== widgetId;

    return (
      <div
        key={widgetId}
        draggable={resizeReorderMode}
        onDragStart={(e) => {
          if (!resizeReorderMode) return;
          setDraggedWidgetId(widgetId);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          if (!resizeReorderMode) return;
          e.preventDefault();
          if (draggedWidgetId && draggedWidgetId !== widgetId) {
            setDragOverWidgetId(widgetId);
          }
        }}
        onDragLeave={() => {
          if (dragOverWidgetId === widgetId) setDragOverWidgetId(null);
        }}
        onDrop={(e) => {
          if (!resizeReorderMode) return;
          e.preventDefault();
          if (draggedWidgetId) reorderWidgets(draggedWidgetId, widgetId);
          setDraggedWidgetId(null);
          setDragOverWidgetId(null);
        }}
        onDragEnd={() => {
          setDraggedWidgetId(null);
          setDragOverWidgetId(null);
        }}
        className={`group/tile relative flex flex-col ${
          size.colSpan === 2 ? 'lg:col-span-2' : 'lg:col-span-1'
        } ${size.rowSpan === 2 ? 'lg:row-span-2' : 'lg:row-span-1'} ${
          isDragging ? 'opacity-45 scale-[0.99]' : ''
        } ${
          isDragOver
            ? 'ring-2 ring-blue-500 rounded-xl'
            : resizeReorderMode
              ? 'ring-1 ring-blue-300/70 dark:ring-blue-700/70 rounded-xl p-1 -m-1'
              : ''
        } transition-all duration-200`}
      >
        {/* Tile Drag & Layout Controls Strip (active only in Resize / Reorder mode) */}
        {resizeReorderMode && (
          <div className="flex items-center justify-between gap-2 px-1 pb-1.5 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1 cursor-grab font-medium text-blue-600 dark:text-blue-400">
              <GripVertical className="h-3.5 w-3.5" />
              {meta.label}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => toggleWidgetColSpan(widgetId)}
                title="Toggle Half / Full Width"
                className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {size.colSpan === 2 ? 'Full' : '1/2 W'}
              </button>
              <button
                type="button"
                onClick={() => toggleWidgetRowSpan(widgetId)}
                title="Toggle 1x / 2x Height"
                className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {size.rowSpan === 2 ? '2x H' : '1x H'}
              </button>
              <button
                type="button"
                onClick={() => toggleWidgetHidden(widgetId)}
                title={`Hide ${meta.label}`}
                className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400"
              >
                Hide
              </button>
            </div>
          </div>
        )}

        <div
          className={`flex-1 flex flex-col ${
            outerCard
              ? 'rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 asan-card-hover'
              : ''
          }`}
        >
          {content}
        </div>
      </div>
    );
  };

  const renderWidget = (widgetId: DashboardWidgetId) => {
    if (prefs.hidden.includes(widgetId)) return null;
    const size = getWidgetSize(widgetId);

    if (widgetId === 'metrics') {
      return wrapWidgetTile(
        'metrics',
        <div
          className={`grid gap-4 ${
            size.colSpan === 1 ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'
          }`}
        >
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 asan-card-hover">
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

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 asan-card-hover">
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

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 asan-card-hover">
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

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 asan-card-hover">
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
        </div>,
        false
      );
    }

    if (widgetId === 'exam-countdowns') {
      return wrapWidgetTile(
        'exam-countdowns',
        <section className="p-5 sm:p-6 space-y-4 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3.5">
            <div className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Pinned Exam Countdowns
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {countdowns.length > 0 && (
                <button
                  type="button"
                  onClick={() => setManagePinsOpen((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  <Pin className="h-3 w-3" />
                  {managePinsOpen ? 'Done Choosing' : 'Choose Pins'}
                </button>
              )}
              <button
                type="button"
                onClick={() => onNavigate('timers')}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
              >
                Manage &amp; Add Countdowns
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {managePinsOpen && countdowns.length > 0 && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3 space-y-2">
              <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                Pin or unpin individual countdown cards for your Dashboard:
              </div>
              <div className="flex flex-wrap gap-2">
                {countdowns.map((c) => {
                  const pinned = isCountdownPinned(c, pinState);
                  return (
                    <button
                      key={`pin-choice-${c.id}`}
                      type="button"
                      onClick={() => setPinState(toggleCountdownPin(userKey, c, pinned))}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                        pinned
                          ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                      {c.title}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {pinnedCountdowns.length === 0 ? (
            <div className="py-5 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2.5">
              <p>
                No countdown cards pinned on Dashboard. Pin individual countdowns or hide this section anytime.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => onNavigate('timers')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-1.5 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  Open Exam Countdowns
                </button>
                <button
                  type="button"
                  onClick={() => toggleWidgetHidden('exam-countdowns')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-1.5 font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Hide Widget
                </button>
              </div>
            </div>
          ) : (
            <div
              className={`grid grid-cols-1 gap-3 ${
                size.colSpan === 1 ? 'md:grid-cols-1' : 'md:grid-cols-2 xl:grid-cols-3'
              }`}
            >
              {pinnedCountdowns.map((item) => {
                const rem = getCountdownRemaining(item, nowMs);
                return (
                  <div
                    key={item.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/60 p-4 flex flex-col justify-between gap-3 asan-card-hover"
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
      return wrapWidgetTile(
        'tasks',
        <div className="p-6 flex-1 flex flex-col">
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
            <div className="py-10 text-center flex-1 flex flex-col items-center justify-center">
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
              {openTasks.slice(0, size.rowSpan === 2 ? 12 : 6).map((task) => (
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
      return wrapWidgetTile(
        'schedule',
        <div className="p-6 flex-1 flex flex-col">
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
            {scheduledExams.slice(0, size.rowSpan === 2 ? 6 : 3).map((exam) => (
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

            {upcomingEvents.slice(0, size.rowSpan === 2 ? 10 : 5).map((ev) => (
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

    if (widgetId === 'monthly-calendar') {
      return wrapWidgetTile(
        'monthly-calendar',
        <div className="p-5 sm:p-6 flex-1 flex flex-col space-y-4">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3.5">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                {MONTH_NAMES[calMonth.month]} {calMonth.year}
              </h2>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  setCalMonth((prev) =>
                    prev.month === 0
                      ? { year: prev.year - 1, month: 11 }
                      : { year: prev.year, month: prev.month - 1 }
                  )
                }
                aria-label="Previous month"
                className="rounded-md border border-slate-200 dark:border-slate-700 p-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setCalMonth({ year: today.getFullYear(), month: today.getMonth() });
                  setSelectedCalDate(todayStr);
                }}
                className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() =>
                  setCalMonth((prev) =>
                    prev.month === 11
                      ? { year: prev.year + 1, month: 0 }
                      : { year: prev.year, month: prev.month + 1 }
                  )
                }
                aria-label="Next month"
                className="rounded-md border border-slate-200 dark:border-slate-700 p-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onNavigate('calendar')}
                className="ml-1 inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
              >
                Open
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAY_SHORT.map((d) => (
              <div
                key={d}
                className="py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400"
              >
                {d}
              </div>
            ))}
            {calGridDays.map((cell) => {
              const isToday = cell.dateStr === todayStr;
              const isSelected = cell.dateStr === selectedCalDate;
              const dayEvents = eventsByDate.get(cell.dateStr) || [];
              const dayTasks = tasksByDueDate.get(cell.dateStr) || [];
              const hasEvent = dayEvents.length > 0;
              const hasTask = dayTasks.length > 0;
              return (
                <button
                  key={cell.dateStr}
                  type="button"
                  onClick={() => setSelectedCalDate(cell.dateStr)}
                  className={`relative flex flex-col items-center justify-center rounded-lg py-1.5 text-xs transition-colors tabular-nums ${
                    isSelected
                      ? 'bg-blue-600 font-bold text-white shadow-xs'
                      : isToday
                        ? 'bg-blue-50 dark:bg-blue-950/70 font-bold text-blue-700 dark:text-blue-300 ring-1 ring-blue-300 dark:ring-blue-700'
                        : cell.inMonth
                          ? 'text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                          : 'text-slate-400 dark:text-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <span>{cell.day}</span>
                  {(hasEvent || hasTask) && (
                    <span className="mt-0.5 flex items-center gap-0.5">
                      {hasEvent && (
                        <span
                          className={`h-1 w-1 rounded-full ${
                            isSelected ? 'bg-white' : 'bg-blue-500'
                          }`}
                        />
                      )}
                      {hasTask && (
                        <span
                          className={`h-1 w-1 rounded-full ${
                            isSelected ? 'bg-amber-200' : 'bg-emerald-500'
                          }`}
                        />
                      )}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 text-xs space-y-1.5">
            <div className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
              {selectedCalDate === todayStr ? `Today (${selectedCalDate})` : selectedCalDate}
            </div>
            {selectedDayEvents.length === 0 && selectedDayTasks.length === 0 ? (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                No scheduled events or task deadlines on this date.
              </p>
            ) : (
              <div className="space-y-1">
                {selectedDayEvents.slice(0, 3).map((ev) => (
                  <div
                    key={`cal-ev-${ev.id}`}
                    className="flex items-center justify-between gap-2 text-[11px]"
                  >
                    <span className="truncate font-medium text-blue-700 dark:text-blue-300">
                      • {ev.title}
                    </span>
                    <span className="text-slate-400 tabular-nums shrink-0">
                      {ev.eventTime || ev.category}
                    </span>
                  </div>
                ))}
                {selectedDayTasks.slice(0, 3).map((t) => (
                  <div
                    key={`cal-task-${t.id}`}
                    className="flex items-center justify-between gap-2 text-[11px]"
                  >
                    <span className="truncate font-medium text-emerald-700 dark:text-emerald-300">
                      ✓ {t.title}
                    </span>
                    <span className="text-slate-400 capitalize shrink-0">{t.priority}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    // quick-actions
    return wrapWidgetTile(
      'quick-actions',
      <div
        className={`grid gap-4 ${
          size.colSpan === 1 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5'
        }`}
      >
        <button
          type="button"
          onClick={() => onNavigate('notes')}
          className="flex items-start gap-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-left hover:border-blue-300 dark:hover:border-blue-700 asan-card-hover"
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
          className="flex items-start gap-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-left hover:border-blue-300 dark:hover:border-blue-700 asan-card-hover"
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
          className="asan-pro-card asan-card-hover flex items-start gap-3.5 rounded-xl border border-indigo-200 dark:border-indigo-800/70 p-4 text-left"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-300">
            {isProOrAdmin ? <Sigma className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Math Solvers
              </span>
              <span className="asan-pro-badge rounded px-1.5 py-0.5 text-[9px]">PRO</span>
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
          className="flex items-start gap-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-left hover:border-blue-300 dark:hover:border-blue-700 asan-card-hover"
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
          className="asan-pro-card asan-card-hover flex items-start gap-3.5 rounded-xl border border-indigo-200 dark:border-indigo-800/70 p-4 text-left"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-300">
            {isProOrAdmin ? <Layers className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {isProOrAdmin ? 'PDF Studio' : 'Pro & Keys'}
              </span>
              <span className="asan-pro-badge rounded px-1.5 py-0.5 text-[9px]">PRO</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {isProOrAdmin
                ? 'Full, Half, and Quarter A4 imposition studio.'
                : 'Unlock Pro (500 pts/mo) or redeem an 8-char key.'}
            </p>
          </div>
        </button>
      </div>,
      false
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
          {monthlyCalendarHidden && (
            <button
              type="button"
              onClick={() => toggleWidgetHidden('monthly-calendar')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <CalendarDays className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              + Monthly Calendar
            </button>
          )}
          <button
            type="button"
            onClick={() => setResizeReorderMode((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              resizeReorderMode
                ? 'border-blue-500 bg-blue-600 text-white hover:bg-blue-700'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <GripVertical className="h-3.5 w-3.5" />
            {resizeReorderMode ? 'Done Resize / Reorder' : 'Resize / Reorder'}
          </button>
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
        <div className="rounded-xl border border-blue-200 dark:border-blue-800/80 bg-white dark:bg-slate-900 p-5 space-y-4 shadow-xs asan-card-hover">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Customize Dashboard Layout
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Enable <strong>Resize / Reorder</strong> to drag and drop tiles directly on the Dashboard, or adjust order, half/full width, and 1x/2x height below.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setResizeReorderMode((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  resizeReorderMode
                    ? 'border-blue-500 bg-blue-600 text-white hover:bg-blue-700'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                <GripVertical className="h-3.5 w-3.5" />
                {resizeReorderMode ? 'Done Drag & Resize' : 'Enable Drag & Resize'}
              </button>
              <button
                type="button"
                onClick={resetDashboardPrefs}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset Default
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {prefs.order.map((wId, idx) => {
              const meta = DASHBOARD_WIDGET_META[wId];
              const isHidden = prefs.hidden.includes(wId);
              const size = getWidgetSize(wId);
              return (
                <div
                  key={wId}
                  draggable={resizeReorderMode}
                  onDragStart={(e) => {
                    if (!resizeReorderMode) return;
                    setDraggedWidgetId(wId);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => {
                    if (!resizeReorderMode) return;
                    e.preventDefault();
                    if (draggedWidgetId && draggedWidgetId !== wId) {
                      setDragOverWidgetId(wId);
                    }
                  }}
                  onDrop={(e) => {
                    if (!resizeReorderMode) return;
                    e.preventDefault();
                    if (draggedWidgetId) reorderWidgets(draggedWidgetId, wId);
                    setDraggedWidgetId(null);
                    setDragOverWidgetId(null);
                  }}
                  onDragEnd={() => {
                    setDraggedWidgetId(null);
                    setDragOverWidgetId(null);
                  }}
                  className={`flex flex-col justify-between gap-2.5 rounded-lg border px-3.5 py-2.5 ${
                    resizeReorderMode ? 'cursor-grab' : ''
                  } ${
                    dragOverWidgetId === wId ? 'ring-2 ring-blue-500' : ''
                  } ${
                    isHidden
                      ? 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 opacity-75'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/70'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {meta.label}
                        </div>
                        <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                          #{idx + 1} · {size.colSpan === 2 ? 'Full' : 'Half'} W ·{' '}
                          {size.rowSpan === 2 ? '2x' : '1x'} H
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleWidgetHidden(wId)}
                      aria-label={isHidden ? `Show ${meta.label}` : `Hide ${meta.label}`}
                      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium shrink-0 ${
                        isHidden
                          ? 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                          : 'border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                      }`}
                    >
                      {isHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      {isHidden ? 'Show' : 'Hide'}
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-1.5 border-t border-slate-100 dark:border-slate-700/70 pt-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => toggleWidgetColSpan(wId)}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                      >
                        <Maximize2 className="h-2.5 w-2.5" />
                        {size.colSpan === 2 ? 'Full Width' : 'Half Width'}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleWidgetRowSpan(wId)}
                        className="rounded border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                      >
                        {size.rowSpan === 2 ? '2x Height' : '1x Height'}
                      </button>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => moveWidgetOrder(wId, -1)}
                        aria-label={`Move ${meta.label} up`}
                        className="rounded border border-slate-200 dark:border-slate-700 p-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-35"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === prefs.order.length - 1}
                        onClick={() => moveWidgetOrder(wId, 1)}
                        aria-label={`Move ${meta.label} down`}
                        className="rounded border border-slate-200 dark:border-slate-700 p-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-35"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Render Dashboard Tiles in Custom Order & 2-Column Dense Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 grid-flow-row-dense items-stretch">
        {prefs.order.map((wId) => renderWidget(wId))}
      </div>
    </div>
  );
};
