import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar as CalendarIcon,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Lock,
  Plus,
  RefreshCw,
  Repeat,
  Search,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  apiFetch,
  apiPublicFetch,
  createGoogleMeetRoom,
  ensureAppDriveFolder,
  pullScheduleFromGoogleSheet,
  syncScheduleToGoogleSheet,
} from '../lib/api';
import {
  generateScheduleDates,
  MonthlyPatternKind,
  ORDINAL_OPTIONS,
  RecurrenceBoundMode,
  RecurrenceFrequency,
  ScheduleMode,
  WEEKDAY_FULL,
  WEEKDAY_SHORT,
  WeekdayOrdinal,
} from '../lib/calendarRecurrence';
import {
  guestCreateEvent,
  guestCreateEventsBulk,
  guestDeleteEvent,
} from '../lib/guestStore';
import type {
  CalendarEventItem,
  ExamScheduleItem,
  PointRewardsConfig,
  StudyTask,
} from '../types';
import { ConfirmDialog } from './ConfirmDialog';
import { ExamMasterCards } from './ExamMasterCards';

interface CalendarViewProps {
  events: CalendarEventItem[];
  tasks: StudyTask[];
  exams: ExamScheduleItem[];
  onRefresh: () => Promise<void>;
}

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

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface MonthKey {
  year: number;
  month: number; // 0..11
}

function addMonths(base: MonthKey, delta: number): MonthKey {
  const totalMonths = base.year * 12 + base.month + delta;
  const year = Math.floor(totalMonths / 12);
  const month = ((totalMonths % 12) + 12) % 12;
  return { year, month };
}

function formatDateKey(year: number, month: number, day: number): string {
  const m = String(month + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

export const CalendarView: React.FC<CalendarViewProps> = ({
  events,
  tasks,
  exams,
  onRefresh,
}) => {
  const {
    dbUser,
    isGuest,
    isWorkspaceEnabled,
    workspacePermissions,
    isEffectiveProOrAdmin,
    refreshProfile,
    workspaceToken,
    connectWorkspace,
    updateProfile,
    error: authError,
    clearError,
  } = useAuth();
  const isProOrAdmin = isEffectiveProOrAdmin;
  const [studyEventPts, setStudyEventPts] = useState(5);
  const [calendarSubView, setCalendarSubView] = useState<'calendar' | 'exam-master'>('calendar');
  const [deleteEventTarget, setDeleteEventTarget] = useState<CalendarEventItem | null>(null);

  useEffect(() => {
    apiPublicFetch<PointRewardsConfig>('/api/point-rewards')
      .then((r) => {
        if (typeof r?.calendarStudyEvent === 'number') setStudyEventPts(r.calendarStudyEvent);
      })
      .catch(() => {});
  }, []);

  const now = new Date();
  const initialCenter: MonthKey = { year: now.getFullYear(), month: now.getMonth() };

  const [months, setMonths] = useState<MonthKey[]>(() =>
    Array.from({ length: 7 }, (_, i) => addMonths(initialCenter, i - 1))
  );
  const [searchMonth, setSearchMonth] = useState<number>(now.getMonth());
  const [searchYear, setSearchYear] = useState<string>(String(now.getFullYear()));
  const todayDefault = formatDateKey(now.getFullYear(), now.getMonth(), now.getDate());
  const [selectedDate, setSelectedDate] = useState<string>(todayDefault);

  // Add event & Multi-date / Recurrence form
  const [title, setTitle] = useState('');
  const [eventTime, setEventTime] = useState('09:00');
  const [category, setCategory] = useState('study');
  const [notes, setNotes] = useState('');
  const [meetLink, setMeetLink] = useState('');

  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('single');
  const [rangeStart, setRangeStart] = useState<string>(todayDefault);
  const [rangeEnd, setRangeEnd] = useState<string>(todayDefault);
  const [rangeWeekdays, setRangeWeekdays] = useState<number[]>([]);
  const [specificDates, setSpecificDates] = useState<string[]>([todayDefault]);
  const [specificInputDate, setSpecificInputDate] = useState<string>(todayDefault);

  const [recurStart, setRecurStart] = useState<string>(todayDefault);
  const [frequency, setFrequency] = useState<RecurrenceFrequency>('weekly');
  const [weeklyDays, setWeeklyDays] = useState<number[]>([now.getDay()]);
  const [monthlyPattern, setMonthlyPattern] = useState<MonthlyPatternKind>('by_date');
  const [monthlyDay, setMonthlyDay] = useState<number>(now.getDate());
  const [monthlySkipMissingDay, setMonthlySkipMissingDay] = useState<boolean>(false);
  const [monthlyOrdinal, setMonthlyOrdinal] = useState<WeekdayOrdinal>(1);
  const [monthlyWeekday, setMonthlyWeekday] = useState<number>(0);
  const [annualPattern, setAnnualPattern] = useState<MonthlyPatternKind>('by_date');
  const [annualMonth, setAnnualMonth] = useState<number>(now.getMonth());
  const [annualDay, setAnnualDay] = useState<number>(now.getDate());
  const [annualOrdinal, setAnnualOrdinal] = useState<WeekdayOrdinal>(1);
  const [annualWeekday, setAnnualWeekday] = useState<number>(0);
  const [boundMode, setBoundMode] = useState<RecurrenceBoundMode>('count');
  const [untilDate, setUntilDate] = useState<string>(todayDefault);
  const [recurCount, setRecurCount] = useState<number>(8);

  const [saving, setSaving] = useState(false);
  const [creatingMeet, setCreatingMeet] = useState(false);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetMsg, setSheetMsg] = useState<string | null>(null);
  const [sheetUrl, setSheetUrl] = useState<string | null>(
    dbUser?.scheduleSheetId
      ? `https://docs.google.com/spreadsheets/d/${dbUser.scheduleSheetId}/edit`
      : null
  );
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [eventRewardMsg, setEventRewardMsg] = useState<string | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null);

  const loadMoreBottom = useCallback(() => {
    setMonths((prev) => {
      const last = prev[prev.length - 1];
      const nextBatch = Array.from({ length: 4 }, (_, i) => addMonths(last, i + 1));
      return [...prev, ...nextBatch];
    });
  }, []);

  const loadMoreTop = useCallback(() => {
    const container = scrollContainerRef.current;
    const prevScrollHeight = container?.scrollHeight || 0;
    setMonths((prev) => {
      const first = prev[0];
      const prevBatch = Array.from({ length: 3 }, (_, i) => addMonths(first, -(3 - i)));
      return [...prevBatch, ...prev];
    });
    requestAnimationFrame(() => {
      if (container) {
        const diff = container.scrollHeight - prevScrollHeight;
        container.scrollTop += diff;
      }
    });
  }, []);

  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root) return;

    const bottomObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMoreBottom();
        }
      },
      { root, rootMargin: '300px' }
    );

    const topObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMoreTop();
        }
      },
      { root, rootMargin: '150px' }
    );

    if (bottomSentinelRef.current) bottomObserver.observe(bottomSentinelRef.current);
    if (topSentinelRef.current) topObserver.observe(topSentinelRef.current);

    return () => {
      bottomObserver.disconnect();
      topObserver.disconnect();
    };
  }, [loadMoreBottom, loadMoreTop]);

  const handleJumpToMonthYear = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedYear = parseInt(searchYear, 10);
    if (Number.isNaN(parsedYear) || parsedYear < 1 || parsedYear > 9999) {
      setStatusMsg('Please enter a valid year (1–9999).');
      return;
    }
    setStatusMsg(null);
    const target: MonthKey = { year: parsedYear, month: searchMonth };
    setMonths(Array.from({ length: 7 }, (_, i) => addMonths(target, i - 1)));
    setTimeout(() => {
      const el = document.getElementById(`cal-month-${target.year}-${target.month}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 60);
  };

  const handleJumpToday = () => {
    const current = new Date();
    const target = { year: current.getFullYear(), month: current.getMonth() };
    setSearchMonth(target.month);
    setSearchYear(String(target.year));
    setSelectedDate(
      formatDateKey(current.getFullYear(), current.getMonth(), current.getDate())
    );
    setMonths(Array.from({ length: 7 }, (_, i) => addMonths(target, i - 1)));
    setTimeout(() => {
      const el = document.getElementById(`cal-month-${target.year}-${target.month}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  // Map items by YYYY-MM-DD
  const itemsByDate = useMemo(() => {
    const map = new Map<
      string,
      {
        events: CalendarEventItem[];
        tasks: StudyTask[];
        exams: ExamScheduleItem[];
      }
    >();

    const ensure = (dateKey: string) => {
      if (!map.has(dateKey)) {
        map.set(dateKey, { events: [], tasks: [], exams: [] });
      }
      return map.get(dateKey)!;
    };

    events.forEach((ev) => {
      if (ev.eventDate) ensure(ev.eventDate).events.push(ev);
    });
    tasks.forEach((t) => {
      if (t.dueDate) ensure(t.dueDate).tasks.push(t);
    });
    exams.forEach((ex) => {
      if (ex.seatingTime) {
        const datePart = ex.seatingTime.slice(0, 10);
        if (datePart) ensure(datePart).exams.push(ex);
      }
    });

    return map;
  }, [events, tasks, exams]);

  const selectedDayData = itemsByDate.get(selectedDate) || {
    events: [],
    tasks: [],
    exams: [],
  };

  const generatedSchedule = useMemo(
    () =>
      generateScheduleDates({
        mode: scheduleMode,
        singleDate: selectedDate,
        rangeStart,
        rangeEnd,
        rangeWeekdays,
        specificDates,
        recurStart,
        frequency,
        weeklyDays,
        monthlyPattern,
        monthlyDay,
        monthlySkipMissingDay,
        monthlyOrdinal,
        monthlyWeekday,
        annualPattern,
        annualMonth,
        annualDay,
        annualOrdinal,
        annualWeekday,
        boundMode,
        untilDate,
        count: recurCount,
      }),
    [
      scheduleMode,
      selectedDate,
      rangeStart,
      rangeEnd,
      rangeWeekdays,
      specificDates,
      recurStart,
      frequency,
      weeklyDays,
      monthlyPattern,
      monthlyDay,
      monthlySkipMissingDay,
      monthlyOrdinal,
      monthlyWeekday,
      annualPattern,
      annualMonth,
      annualDay,
      annualOrdinal,
      annualWeekday,
      boundMode,
      untilDate,
      recurCount,
    ]
  );

  const specificDateSet = useMemo(() => new Set(specificDates), [specificDates]);

  const handleToggleDaySelection = (dateKey: string) => {
    setSelectedDate(dateKey);
    if (scheduleMode === 'specific') {
      setSpecificDates((prev) =>
        prev.includes(dateKey) ? prev.filter((d) => d !== dateKey) : [...prev, dateKey].sort()
      );
    }
  };

  const handleAddEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    if (generatedSchedule.error) {
      setStatusMsg(generatedSchedule.error);
      return;
    }
    const targetDates = generatedSchedule.dates;
    if (targetDates.length === 0) {
      setStatusMsg('Select at least one valid date for this event.');
      return;
    }

    setSaving(true);
    setStatusMsg(null);
    setEventRewardMsg(null);
    try {
      if (targetDates.length === 1) {
        const singleDate = targetDates[0];
        if (isGuest) {
          guestCreateEvent({
            title: title.trim(),
            eventDate: singleDate,
            eventTime,
            category,
            notes,
          });
          setEventRewardMsg(
            `Saved locally on ${singleDate} (Sign in to earn +${studyEventPts} points per study event).`
          );
        } else {
          const res = await apiFetch<{
            event: CalendarEventItem;
            pointsAwarded: number;
            studyVerified: boolean;
          }>('/api/events', {
            method: 'POST',
            body: JSON.stringify({
              title: title.trim(),
              eventDate: singleDate,
              eventTime,
              category,
              notes,
              meetLink,
            }),
          });
          setEventRewardMsg(
            res.pointsAwarded > 0
              ? `Study event verified — +${res.pointsAwarded} points awarded!`
              : `Event saved (0 points — only verified study/exam events earn +${studyEventPts} pts).`
          );
          await refreshProfile();
        }
      } else {
        if (isGuest) {
          const created = guestCreateEventsBulk({
            title: title.trim(),
            dates: targetDates,
            eventTime,
            category,
            notes,
          });
          setEventRewardMsg(
            `Created ${created.length} recurring/multi-date cards locally (Sign in to earn points).`
          );
        } else {
          const res = await apiFetch<{
            createdCount: number;
            pointsAwarded: number;
            studyVerified: boolean;
          }>('/api/events/bulk', {
            method: 'POST',
            body: JSON.stringify({
              title: title.trim(),
              dates: targetDates,
              eventTime,
              category,
              notes,
              meetLink,
            }),
          });
          setEventRewardMsg(
            res.pointsAwarded > 0
              ? `Created ${res.createdCount} event dates (+${res.pointsAwarded} points awarded for this series)!`
              : `Created ${res.createdCount} event dates across the selected schedule.`
          );
          await refreshProfile();
        }
      }
      setTitle('');
      setNotes('');
      setMeetLink('');
      await onRefresh();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Could not add event');
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateMeet = async () => {
    if (!isWorkspaceEnabled) {
      setStatusMsg('Google Meet requires a Google-linked login.');
      return;
    }
    if (!isProOrAdmin) {
      setStatusMsg('Google Meet creation is excluded from the Basic plan. Upgrade to Pro or Admin.');
      return;
    }
    setCreatingMeet(true);
    setStatusMsg(null);
    clearError();
    try {
      if (!workspaceToken) {
        const tok = await connectWorkspace();
        if (!tok) {
          setCreatingMeet(false);
          return;
        }
      }
      const space = await createGoogleMeetRoom();
      setMeetLink(space.meetingUri);
      setCategory('meeting');
    } catch (err) {
      setStatusMsg(
        err instanceof Error ? err.message : 'Unable to create Google Meet link'
      );
    } finally {
      setCreatingMeet(false);
    }
  };

  const handleSyncToGoogleSheet = async () => {
    if (!isWorkspaceEnabled || !isProOrAdmin) return;
    setSheetBusy(true);
    setSheetMsg(null);
    clearError();
    try {
      if (!workspaceToken) {
        const tok = await connectWorkspace();
        if (!tok) {
          setSheetBusy(false);
          return;
        }
      }
      const folder = await ensureAppDriveFolder(dbUser?.driveFolderId);
      if (folder.id !== dbUser?.driveFolderId) {
        await updateProfile({ driveFolderId: folder.id });
      }
      const combinedRows: (string | number)[][] = [
        ...events.map((ev) => [
          ev.eventDate,
          ev.eventTime || '09:00',
          ev.category || 'study',
          ev.title,
          ev.notes || '',
          ev.meetLink || '',
        ]),
        ...exams
          .filter((ex) => ex.seatingTime)
          .map((ex) => [
            ex.seatingTime.slice(0, 10),
            ex.seatingTime.slice(11, 16) || '09:00',
            'exam',
            `${ex.subject} (${ex.examType === 'Other' ? ex.customExamType : ex.examType})`,
            `Read ${ex.readingMinutes}m / Write ${ex.writingMinutes}m`,
            '',
          ]),
      ].sort((a, b) => `${a[0]} ${a[1]}`.localeCompare(`${b[0]} ${b[1]}`));

      const res = await syncScheduleToGoogleSheet(
        dbUser?.scheduleSheetId || '',
        combinedRows,
        folder.id
      );
      if (res.spreadsheetId !== dbUser?.scheduleSheetId) {
        await updateProfile({ scheduleSheetId: res.spreadsheetId });
      }
      setSheetUrl(res.spreadsheetUrl);
      setSheetMsg(
        `Synced ${combinedRows.length} schedule item(s) to Google Sheets inside your ASAN-user-content Drive folder.`
      );
    } catch (err) {
      setSheetMsg(err instanceof Error ? err.message : 'Google Sheets sync failed');
    } finally {
      setSheetBusy(false);
    }
  };

  const handleImportFromGoogleSheet = async () => {
    if (!isProOrAdmin || !dbUser?.scheduleSheetId) return;
    setSheetBusy(true);
    setSheetMsg(null);
    clearError();
    try {
      if (!workspaceToken) {
        const tok = await connectWorkspace();
        if (!tok) {
          setSheetBusy(false);
          return;
        }
      }
      const rows = await pullScheduleFromGoogleSheet(dbUser.scheduleSheetId);
      const existingKeys = new Set(
        events.map((ev) => `${ev.eventDate}|${ev.eventTime}|${ev.title}`)
      );
      let importedCount = 0;
      for (const row of rows) {
        const key = `${row.eventDate}|${row.eventTime}|${row.title}`;
        if (!existingKeys.has(key) && row.category !== 'exam') {
          await apiFetch('/api/events', {
            method: 'POST',
            body: JSON.stringify(row),
          });
          importedCount += 1;
        }
      }
      await onRefresh();
      setSheetMsg(
        importedCount > 0
          ? `Imported ${importedCount} new schedule row(s) from Google Sheets.`
          : 'Calendar is already up to date with your Google Schedule Sheet.'
      );
    } catch (err) {
      setSheetMsg(err instanceof Error ? err.message : 'Could not import from Sheet');
    } finally {
      setSheetBusy(false);
    }
  };

  const handleConfirmDeleteEvent = async () => {
    if (!deleteEventTarget) return;
    if (isGuest) {
      guestDeleteEvent(deleteEventTarget.id);
    } else {
      await apiFetch(`/api/events/${deleteEventTarget.id}`, { method: 'DELETE' });
    }
    setDeleteEventTarget(null);
    await onRefresh();
  };

  const todayKey = formatDateKey(now.getFullYear(), now.getMonth(), now.getDate());

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1 w-fit">
          <button
            type="button"
            onClick={() => setCalendarSubView('calendar')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              calendarSubView === 'calendar'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Infinite Monthly Calendar
          </button>
          <button
            type="button"
            onClick={() => setCalendarSubView('exam-master')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              calendarSubView === 'exam-master'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Exam Master (&ldquo;master&rdquo; · test_dates)
          </button>
        </div>
      </div>

      {calendarSubView === 'exam-master' ? (
        <ExamMasterCards />
      ) : (
        <>
          {/* Header & Month/Year Search */}
          <div className="flex flex-col gap-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 lg:flex-row lg:items-center lg:justify-between asan-card-hover">
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">
                Infinite Academic Calendar
              </h1>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Scroll through months, jump to any year, or schedule stretches, far-separated dates, and recurring classes.
              </p>
            </div>

            <form
              onSubmit={handleJumpToMonthYear}
              className="flex flex-wrap items-center gap-2.5"
            >
              <select
                value={searchMonth}
                onChange={(e) => setSearchMonth(Number(e.target.value))}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
                aria-label="Select month"
              >
                {MONTH_NAMES.map((name, idx) => (
                  <option key={name} value={idx}>
                    {name}
                  </option>
                ))}
              </select>

              <input
                type="number"
                min={1}
                max={9999}
                value={searchYear}
                onChange={(e) => setSearchYear(e.target.value)}
                placeholder="Year"
                className="w-24 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 tabular-nums focus:border-blue-500 focus:outline-none"
                aria-label="Enter year"
              />

              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
              >
                <Search className="h-4 w-4" />
                Show Month
              </button>

              <button
                type="button"
                onClick={handleJumpToday}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
              >
                Today
              </button>
            </form>
          </div>

          {/* Google Sheets Schedule Sync Bar */}
          {isWorkspaceEnabled && !workspacePermissions.sheetsSync && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-5 py-2.5 text-xs text-slate-500 dark:text-slate-400 asan-card-hover">
              Google Sheets schedule sync is disabled in View Plans and Settings → Google Workspace Function Permissions.
            </div>
          )}
          {isWorkspaceEnabled && workspacePermissions.sheetsSync && (
            <>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-3.5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between asan-card-hover">
                <div className="flex items-center gap-2.5 text-xs text-slate-600 dark:text-slate-300">
                  <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  {isProOrAdmin ? (
                    <span>
                      Maintain schedules using Google Sheets (syncs events &amp; exams inside your ASAN-user-content folder).
                    </span>
                  ) : (
                    <span>
                      Maintain schedules using Google Sheets · Pro &amp; Admin feature (Basic excludes Google Workspace).
                    </span>
                  )}
                </div>

                {isProOrAdmin ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSyncToGoogleSheet}
                      disabled={sheetBusy}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60 whitespace-nowrap shrink-0"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      {sheetBusy ? 'Syncing...' : 'Sync Schedule to Sheet'}
                    </button>
                    {dbUser?.scheduleSheetId && (
                      <button
                        type="button"
                        onClick={handleImportFromGoogleSheet}
                        disabled={sheetBusy}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Pull from Sheet
                      </button>
                    )}
                    {sheetUrl && (
                      <a
                        href={sheetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0"
                      >
                        Open Sheet
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 whitespace-nowrap shrink-0">
                    <Lock className="h-3.5 w-3.5" />
                    Pro Feature
                  </div>
                )}
              </div>

              {(sheetMsg || authError) && (
                <div
                  className={`rounded-lg border px-4 py-2.5 text-xs ${
                    !sheetMsg && authError
                      ? 'border-red-200 dark:border-red-800/70 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {sheetMsg || authError}
                </div>
              )}
            </>
          )}

          {/* Main Layout: Infinite Scroll Months + Day Inspector & Multi-Date Event Creator */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
            <div
              ref={scrollContainerRef}
              className="lg:col-span-7 xl:col-span-8 min-h-[420px] max-h-[65vh] lg:max-h-none lg:h-[calc(100vh-14rem)] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-10 asan-card-hover"
            >
              <div ref={topSentinelRef} className="h-2" />

              {months.map(({ year, month }) => {
                const firstWeekday = new Date(year, month, 1).getDay();
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                const cells: (number | null)[] = [
                  ...Array.from({ length: firstWeekday }, () => null),
                  ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
                ];
                while (cells.length % 7 !== 0) {
                  cells.push(null);
                }

                return (
                  <section
                    key={`${year}-${month}`}
                    id={`cal-month-${year}-${month}`}
                    className="space-y-3"
                  >
                    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 py-2 backdrop-blur-xs">
                      <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                        {MONTH_NAMES[month]}{' '}
                        <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                          {year}
                        </span>
                      </h2>
                      <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums">
                        {daysInMonth} days
                      </span>
                    </div>

                    <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500 dark:text-slate-400">
                      {WEEKDAYS.map((wd) => (
                        <div key={wd} className="py-1">
                          {wd}
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                      {cells.map((day, idx) => {
                        if (!day) {
                          return (
                            <div
                              key={`empty-${year}-${month}-${idx}`}
                              className="h-16 sm:h-20 rounded-lg bg-slate-50/50 dark:bg-slate-800/30"
                            />
                          );
                        }

                        const dateKey = formatDateKey(year, month, day);
                        const dayItems = itemsByDate.get(dateKey);
                        const totalCount =
                          (dayItems?.events.length || 0) +
                          (dayItems?.tasks.length || 0) +
                          (dayItems?.exams.length || 0);
                        const isSelected = dateKey === selectedDate;
                        const isPickedSpecific =
                          scheduleMode === 'specific' && specificDateSet.has(dateKey);
                        const isToday = dateKey === todayKey;

                        return (
                          <button
                            key={dateKey}
                            type="button"
                            onClick={() => handleToggleDaySelection(dateKey)}
                            className={`flex h-16 sm:h-20 flex-col justify-between rounded-lg border p-1.5 sm:p-2 text-left transition-colors ${
                              isPickedSpecific
                                ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/50 ring-1 ring-emerald-400'
                                : isSelected
                                  ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/50'
                                  : isToday
                                    ? 'border-slate-400 dark:border-slate-500 bg-slate-50 dark:bg-slate-800/80'
                                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span
                                className={`text-xs font-semibold tabular-nums ${
                                  isToday
                                    ? 'text-blue-700 dark:text-blue-400'
                                    : isSelected
                                      ? 'text-blue-900 dark:text-blue-200'
                                      : 'text-slate-800 dark:text-slate-200'
                                }`}
                              >
                                {day}
                              </span>
                              {totalCount > 0 && (
                                <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400 tabular-nums">
                                  {totalCount}
                                </span>
                              )}
                            </div>

                            <div className="space-y-0.5 overflow-hidden">
                              {dayItems?.exams.slice(0, 1).map((ex) => (
                                <div
                                  key={`ex-${ex.id}`}
                                  className="truncate text-[10px] font-medium text-amber-700 dark:text-amber-300"
                                >
                                  Exam: {ex.subject}
                                </div>
                              ))}
                              {dayItems?.events.slice(0, 1).map((ev) => (
                                <div
                                  key={`ev-${ev.id}`}
                                  className="truncate text-[10px] font-medium text-blue-700 dark:text-blue-300"
                                >
                                  {ev.title}
                                </div>
                              ))}
                              {dayItems?.tasks.slice(0, 1).map((t) => (
                                <div
                                  key={`tk-${t.id}`}
                                  className="truncate text-[10px] text-slate-600 dark:text-slate-400"
                                >
                                  {t.title}
                                </div>
                              ))}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}

              <div
                ref={bottomSentinelRef}
                className="h-4 text-center text-xs text-slate-400 dark:text-slate-500"
              >
                Loading more months...
              </div>
            </div>

            {/* Selected Date Inspector & Multi-Date / Recurring Event Creator */}
            <div className="lg:col-span-5 xl:col-span-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-5 asan-card-hover">
              <div className="border-b border-slate-100 dark:border-slate-800 pb-3.5">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <CalendarIcon className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  Selected Date
                </div>
                <h3 className="mt-1 font-display text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                  {selectedDate}
                </h3>
              </div>

              <div className="space-y-2.5 lg:max-h-64 lg:overflow-y-auto">
                {selectedDayData.exams.map((ex) => (
                  <div
                    key={`d-ex-${ex.id}`}
                    className="rounded-lg border border-amber-200 dark:border-amber-800/70 bg-amber-50/50 dark:bg-amber-950/40 p-3 text-xs"
                  >
                    <div className="font-semibold text-amber-900 dark:text-amber-200">
                      Exam: {ex.subject} ({ex.examType === 'Other' ? ex.customExamType : ex.examType})
                    </div>
                    <div className="mt-0.5 text-amber-800 dark:text-amber-300 tabular-nums">
                      {ex.seatingTime.replace('T', ' ')} · {ex.readingMinutes}m read / {ex.writingMinutes}m write
                    </div>
                  </div>
                ))}

                {selectedDayData.tasks.map((t) => (
                  <div
                    key={`d-t-${t.id}`}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-3 text-xs"
                  >
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      Task: {t.title}
                    </div>
                    <div className="mt-0.5 text-slate-500 dark:text-slate-400">
                      {t.subject} · {t.status.replace('_', ' ')}
                    </div>
                  </div>
                ))}

                {selectedDayData.events.map((ev) => (
                  <div
                    key={`d-ev-${ev.id}`}
                    className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {ev.title}
                      </div>
                      <div className="mt-0.5 text-slate-500 dark:text-slate-400 tabular-nums">
                        {ev.eventTime} · {ev.category}
                      </div>
                      {ev.notes && (
                        <p className="mt-1 text-slate-600 dark:text-slate-300">{ev.notes}</p>
                      )}
                      {ev.meetLink && (
                        <a
                          href={ev.meetLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 font-medium text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          <Video className="h-3 w-3" />
                          Join Google Meet
                        </a>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setDeleteEventTarget(ev)}
                      className="rounded p-1 text-slate-400 hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-600"
                      aria-label="Delete event"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}

                {selectedDayData.events.length === 0 &&
                  selectedDayData.tasks.length === 0 &&
                  selectedDayData.exams.length === 0 && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Nothing scheduled for {selectedDate}. Add a single, stretched, or recurring event below.
                    </p>
                  )}
              </div>

              <form
                onSubmit={handleAddEvent}
                className="space-y-3 border-t border-slate-100 dark:border-slate-800 pt-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                    Add Event / Series (+{studyEventPts} pts)
                  </h4>
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 tabular-nums">
                    <Repeat className="h-3 w-3" />
                    {generatedSchedule.dates.length} date
                    {generatedSchedule.dates.length === 1 ? '' : 's'}
                  </span>
                </div>

                {/* Schedule Mode Switcher */}
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1 text-[11px] font-medium">
                  {(
                    [
                      { id: 'single', label: 'Single Date' },
                      { id: 'range', label: 'Date Stretch' },
                      { id: 'specific', label: 'Specific Dates' },
                      { id: 'recurring', label: 'Repeat Rule' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setScheduleMode(m.id)}
                      className={`rounded-md py-1.5 px-2 transition-colors ${
                        scheduleMode === m.id
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                          : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Event title (e.g., Physics Tuition / Revision)"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
                />

                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="time"
                    value={eventTime}
                    onChange={(e) => setEventTime(e.target.value)}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 tabular-nums focus:border-blue-500 focus:outline-none"
                  />
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="study">Study Block (+{studyEventPts} pts)</option>
                    <option value="exam">Mock Exam (+{studyEventPts} pts)</option>
                    <option value="deadline">Study Deadline (+{studyEventPts} pts)</option>
                    <option value="meeting">Tuition / Study Group</option>
                    <option value="personal">Personal / Other (0 pts)</option>
                  </select>
                </div>

                {/* Mode-specific Controls */}
                {scheduleMode === 'range' && (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3 space-y-2.5 text-xs">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] text-slate-500 dark:text-slate-400">
                          Start Date
                        </label>
                        <input
                          type="date"
                          value={rangeStart}
                          onChange={(e) => setRangeStart(e.target.value)}
                          className="mt-0.5 w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs text-slate-900 dark:text-slate-100 tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500 dark:text-slate-400">
                          End Date
                        </label>
                        <input
                          type="date"
                          value={rangeEnd}
                          onChange={(e) => setRangeEnd(e.target.value)}
                          className="mt-0.5 w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs text-slate-900 dark:text-slate-100 tabular-nums"
                        />
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                        Optional weekday filter (leave empty for every day in stretch):
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {WEEKDAY_SHORT.map((lbl, idx) => {
                          const active = rangeWeekdays.includes(idx);
                          return (
                            <button
                              key={lbl}
                              type="button"
                              onClick={() =>
                                setRangeWeekdays((prev) =>
                                  prev.includes(idx)
                                    ? prev.filter((d) => d !== idx)
                                    : [...prev, idx].sort()
                                )
                              }
                              className={`rounded px-2 py-1 text-[11px] font-medium border ${
                                active
                                  ? 'border-blue-600 bg-blue-600 text-white'
                                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              {lbl}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {scheduleMode === 'specific' && (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3 space-y-2.5 text-xs">
                    <div className="text-[11px] text-slate-600 dark:text-slate-300">
                      Click days directly on the calendar grid or add far-separated dates below:
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={specificInputDate}
                        onChange={(e) => setSpecificInputDate(e.target.value)}
                        className="flex-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 tabular-nums"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!specificInputDate) return;
                          setSpecificDates((prev) =>
                            prev.includes(specificInputDate)
                              ? prev
                              : [...prev, specificInputDate].sort()
                          );
                        }}
                        className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 shrink-0"
                      >
                        Add Date
                      </button>
                    </div>
                    {specificDates.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                        {specificDates.map((d) => (
                          <span
                            key={d}
                            className="inline-flex items-center gap-1 rounded border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 text-[11px] font-mono text-emerald-800 dark:text-emerald-200 tabular-nums"
                          >
                            {d}
                            <button
                              type="button"
                              onClick={() =>
                                setSpecificDates((prev) => prev.filter((item) => item !== d))
                              }
                              aria-label={`Remove ${d}`}
                              className="hover:text-red-600"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {scheduleMode === 'recurring' && (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3 space-y-3 text-xs">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] text-slate-500 dark:text-slate-400">
                          Repeat Frequency
                        </label>
                        <select
                          value={frequency}
                          onChange={(e) => setFrequency(e.target.value as RecurrenceFrequency)}
                          className="mt-0.5 w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                        >
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                          <option value="annually">Annually</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500 dark:text-slate-400">
                          Starts On
                        </label>
                        <input
                          type="date"
                          value={recurStart}
                          onChange={(e) => setRecurStart(e.target.value)}
                          className="mt-0.5 w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100 tabular-nums"
                        />
                      </div>
                    </div>

                    {frequency === 'weekly' && (
                      <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                          Repeat every week on:
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {WEEKDAY_SHORT.map((lbl, idx) => {
                            const active = weeklyDays.includes(idx);
                            return (
                              <button
                                key={lbl}
                                type="button"
                                onClick={() =>
                                  setWeeklyDays((prev) =>
                                    prev.includes(idx)
                                      ? prev.filter((d) => d !== idx)
                                      : [...prev, idx].sort()
                                  )
                                }
                                className={`rounded px-2 py-1 text-[11px] font-medium border ${
                                  active
                                    ? 'border-blue-600 bg-blue-600 text-white'
                                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                                }`}
                              >
                                {lbl}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {frequency === 'monthly' && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <label className="inline-flex items-center gap-1 cursor-pointer text-slate-700 dark:text-slate-200">
                            <input
                              type="radio"
                              name="monthlyPattern"
                              checked={monthlyPattern === 'by_date'}
                              onChange={() => setMonthlyPattern('by_date')}
                            />
                            By Calendar Date
                          </label>
                          <label className="inline-flex items-center gap-1 cursor-pointer text-slate-700 dark:text-slate-200">
                            <input
                              type="radio"
                              name="monthlyPattern"
                              checked={monthlyPattern === 'by_weekday'}
                              onChange={() => setMonthlyPattern('by_weekday')}
                            />
                            By Day (e.g. First Sunday)
                          </label>
                        </div>

                        {monthlyPattern === 'by_date' ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-slate-600 dark:text-slate-300">Day of month:</span>
                              <input
                                type="number"
                                min={1}
                                max={31}
                                value={monthlyDay}
                                onChange={(e) =>
                                  setMonthlyDay(Math.max(1, Math.min(31, Number(e.target.value) || 1)))
                                }
                                className="w-16 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs text-slate-900 dark:text-slate-100 tabular-nums"
                              />
                            </div>
                            <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={monthlySkipMissingDay}
                                onChange={(e) => setMonthlySkipMissingDay(e.target.checked)}
                              />
                              Skip shorter months (uncheck to use last day of month)
                            </label>
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              value={monthlyOrdinal}
                              onChange={(e) =>
                                setMonthlyOrdinal(Number(e.target.value) as WeekdayOrdinal)
                              }
                              className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                            >
                              {ORDINAL_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                            <select
                              value={monthlyWeekday}
                              onChange={(e) => setMonthlyWeekday(Number(e.target.value))}
                              className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                            >
                              {WEEKDAY_FULL.map((wd, idx) => (
                                <option key={wd} value={idx}>
                                  {wd}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    )}

                    {frequency === 'annually' && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <label className="inline-flex items-center gap-1 cursor-pointer text-slate-700 dark:text-slate-200">
                            <input
                              type="radio"
                              name="annualPattern"
                              checked={annualPattern === 'by_date'}
                              onChange={() => setAnnualPattern('by_date')}
                            />
                            By Calendar Date
                          </label>
                          <label className="inline-flex items-center gap-1 cursor-pointer text-slate-700 dark:text-slate-200">
                            <input
                              type="radio"
                              name="annualPattern"
                              checked={annualPattern === 'by_weekday'}
                              onChange={() => setAnnualPattern('by_weekday')}
                            />
                            By Day in Month
                          </label>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <select
                            value={annualMonth}
                            onChange={(e) => setAnnualMonth(Number(e.target.value))}
                            className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                          >
                            {MONTH_NAMES.map((mName, idx) => (
                              <option key={mName} value={idx}>
                                {mName}
                              </option>
                            ))}
                          </select>
                          {annualPattern === 'by_date' ? (
                            <input
                              type="number"
                              min={1}
                              max={31}
                              value={annualDay}
                              onChange={(e) =>
                                setAnnualDay(Math.max(1, Math.min(31, Number(e.target.value) || 1)))
                              }
                              className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100 tabular-nums"
                            />
                          ) : (
                            <select
                              value={annualOrdinal}
                              onChange={(e) =>
                                setAnnualOrdinal(Number(e.target.value) as WeekdayOrdinal)
                              }
                              className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                            >
                              {ORDINAL_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                        {annualPattern === 'by_weekday' && (
                          <select
                            value={annualWeekday}
                            onChange={(e) => setAnnualWeekday(Number(e.target.value))}
                            className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                          >
                            {WEEKDAY_FULL.map((wd, idx) => (
                              <option key={wd} value={idx}>
                                {wd}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}

                    {/* Bound: Count or Until Date */}
                    <div className="border-t border-slate-200 dark:border-slate-700 pt-2.5 grid grid-cols-2 gap-2 items-end">
                      <div>
                        <label className="block text-[11px] text-slate-500 dark:text-slate-400">
                          Repeat Until / Count
                        </label>
                        <select
                          value={boundMode}
                          onChange={(e) => setBoundMode(e.target.value as RecurrenceBoundMode)}
                          className="mt-0.5 w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                        >
                          <option value="count">Occurrences (Max 366)</option>
                          <option value="until">End Date (Until)</option>
                        </select>
                      </div>
                      {boundMode === 'count' ? (
                        <div>
                          <label className="block text-[11px] text-slate-500 dark:text-slate-400">
                            Count
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={366}
                            value={recurCount}
                            onChange={(e) =>
                              setRecurCount(Math.max(1, Math.min(366, Number(e.target.value) || 1)))
                            }
                            className="mt-0.5 w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100 tabular-nums"
                          />
                        </div>
                      ) : (
                        <div>
                          <label className="block text-[11px] text-slate-500 dark:text-slate-400">
                            Until Date
                          </label>
                          <input
                            type="date"
                            value={untilDate}
                            onChange={(e) => setUntilDate(e.target.value)}
                            className="mt-0.5 w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100 tabular-nums"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Preview dates summary */}
                {scheduleMode !== 'single' && generatedSchedule.dates.length > 0 && (
                  <div className="rounded-lg border border-blue-200 dark:border-blue-800/70 bg-blue-50/70 dark:bg-blue-950/40 px-3 py-2 text-[11px] text-blue-900 dark:text-blue-200 tabular-nums">
                    <div className="font-semibold">
                      Preview: {generatedSchedule.dates.length} event card
                      {generatedSchedule.dates.length === 1 ? '' : 's'}
                      {generatedSchedule.truncated ? ' (capped at 366)' : ''}
                    </div>
                    <div className="mt-1 truncate font-mono text-[10px]">
                      {generatedSchedule.dates.slice(0, 5).join(', ')}
                      {generatedSchedule.dates.length > 5
                        ? ` … +${generatedSchedule.dates.length - 5} more (ends ${
                            generatedSchedule.dates[generatedSchedule.dates.length - 1]
                          })`
                        : ''}
                    </div>
                  </div>
                )}

                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional notes or syllabus chapters..."
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
                />
                {isWorkspaceEnabled && isProOrAdmin && workspacePermissions.meetRooms && (
                  <div className="flex items-center gap-2">
                    <input
                      type="url"
                      value={meetLink}
                      onChange={(e) => setMeetLink(e.target.value)}
                      placeholder="Meet URL (optional)"
                      className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleGenerateMeet}
                      disabled={creatingMeet}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
                    >
                      <Video className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                      {creatingMeet ? 'Creating...' : 'Create Meet'}
                    </button>
                  </div>
                )}
                {eventRewardMsg && (
                  <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200">
                    {eventRewardMsg}
                  </div>
                )}
                {(statusMsg || authError || generatedSchedule.error) && (
                  <div className="text-xs text-red-600 dark:text-red-400">
                    {statusMsg || authError || generatedSchedule.error}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={saving || generatedSchedule.dates.length === 0 || Boolean(generatedSchedule.error)}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  <Plus className="h-4 w-4" />
                  {saving
                    ? 'Saving...'
                    : generatedSchedule.dates.length > 1
                      ? `Create ${generatedSchedule.dates.length} Event Dates`
                      : 'Add to Calendar'}
                </button>
              </form>
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        open={Boolean(deleteEventTarget)}
        title="Delete Calendar Event?"
        description={`Delete "${deleteEventTarget?.title}" (${deleteEventTarget?.eventDate})?`}
        confirmLabel="Delete Permanently"
        destructive
        onConfirm={handleConfirmDeleteEvent}
        onCancel={() => setDeleteEventTarget(null)}
      />
    </div>
  );
};
