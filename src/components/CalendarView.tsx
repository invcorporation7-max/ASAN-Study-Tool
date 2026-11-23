import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar as CalendarIcon,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Video,
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
import { guestCreateEvent, guestDeleteEvent } from '../lib/guestStore';
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
  const [selectedDate, setSelectedDate] = useState<string>(
    formatDateKey(now.getFullYear(), now.getMonth(), now.getDate())
  );

  // Add event form
  const [title, setTitle] = useState('');
  const [eventTime, setEventTime] = useState('09:00');
  const [category, setCategory] = useState('study');
  const [notes, setNotes] = useState('');
  const [meetLink, setMeetLink] = useState('');
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

  const handleAddEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setStatusMsg(null);
    setEventRewardMsg(null);
    try {
      if (isGuest) {
        guestCreateEvent({
          title: title.trim(),
          eventDate: selectedDate,
          eventTime,
          category,
          notes,
        });
        setEventRewardMsg(
          `Saved locally (Sign in to earn +${studyEventPts} points per study event).`
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
            eventDate: selectedDate,
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
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 w-fit">
          <button
            type="button"
            onClick={() => setCalendarSubView('calendar')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              calendarSubView === 'calendar'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Infinite Monthly Calendar
          </button>
          <button
            type="button"
            onClick={() => setCalendarSubView('exam-master')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              calendarSubView === 'exam-master'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
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
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-900">
            Infinite Academic Calendar
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Scroll infinitely up or down through months, or search any month and year directly.
          </p>
        </div>

        <form
          onSubmit={handleJumpToMonthYear}
          className="flex flex-wrap items-center gap-2.5"
        >
          <select
            value={searchMonth}
            onChange={(e) => setSearchMonth(Number(e.target.value))}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
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
            className="w-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 tabular-nums focus:border-blue-500 focus:outline-none"
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
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            Today
          </button>
        </form>
      </div>

      {/* Google Sheets Schedule Sync Bar (only shown when enabled for Google Auth accounts) */}
      {isWorkspaceEnabled && !workspacePermissions.sheetsSync && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-2.5 text-xs text-slate-500">
          Google Sheets schedule sync is disabled in View Plans → Google Workspace Function Permissions.
        </div>
      )}
      {isWorkspaceEnabled && workspacePermissions.sheetsSync && (
        <>
          <div className="rounded-xl border border-slate-200 bg-white px-5 py-3.5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5 text-xs text-slate-600">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-600" />
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
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
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
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline whitespace-nowrap shrink-0"
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

          {sheetMsg && (
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-700">
              {sheetMsg}
            </div>
          )}
        </>
      )}

      {/* Main Layout: Infinite Scroll Months + Day Inspector */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div
          ref={scrollContainerRef}
          className="lg:col-span-8 h-[72vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 space-y-10"
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
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 py-2 backdrop-blur-xs">
                  <h2 className="font-display text-lg font-bold text-slate-900">
                    {MONTH_NAMES[month]}{' '}
                    <span className="font-mono text-slate-500 tabular-nums">
                      {year}
                    </span>
                  </h2>
                  <span className="text-xs text-slate-400 tabular-nums">
                    {daysInMonth} days
                  </span>
                </div>

                <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500">
                  {WEEKDAYS.map((wd) => (
                    <div key={wd} className="py-1">
                      {wd}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1.5">
                  {cells.map((day, idx) => {
                    if (!day) {
                      return (
                        <div
                          key={`empty-${year}-${month}-${idx}`}
                          className="h-20 rounded-lg bg-slate-50/50"
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
                    const isToday = dateKey === todayKey;

                    return (
                      <button
                        key={dateKey}
                        type="button"
                        onClick={() => setSelectedDate(dateKey)}
                        className={`flex h-20 flex-col justify-between rounded-lg border p-2 text-left transition-colors ${
                          isSelected
                            ? 'border-blue-600 bg-blue-50/50'
                            : isToday
                              ? 'border-slate-400 bg-slate-50'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`text-xs font-semibold tabular-nums ${
                              isToday
                                ? 'text-blue-700'
                                : isSelected
                                  ? 'text-blue-900'
                                  : 'text-slate-800'
                            }`}
                          >
                            {day}
                          </span>
                          {totalCount > 0 && (
                            <span className="text-[11px] font-medium text-blue-600 tabular-nums">
                              {totalCount}
                            </span>
                          )}
                        </div>

                        <div className="space-y-0.5 overflow-hidden">
                          {dayItems?.exams.slice(0, 1).map((ex) => (
                            <div
                              key={`ex-${ex.id}`}
                              className="truncate text-[10px] font-medium text-amber-700"
                            >
                              Exam: {ex.subject}
                            </div>
                          ))}
                          {dayItems?.events.slice(0, 1).map((ev) => (
                            <div
                              key={`ev-${ev.id}`}
                              className="truncate text-[10px] font-medium text-blue-700"
                            >
                              {ev.title}
                            </div>
                          ))}
                          {dayItems?.tasks.slice(0, 1).map((t) => (
                            <div
                              key={`tk-${t.id}`}
                              className="truncate text-[10px] text-slate-600"
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

          <div ref={bottomSentinelRef} className="h-4 text-center text-xs text-slate-400">
            Loading more months...
          </div>
        </div>

        {/* Selected Date Inspector & Event Creator */}
        <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-6 space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
              <CalendarIcon className="h-3.5 w-3.5 text-blue-600" />
              Selected Date
            </div>
            <h3 className="mt-1 font-display text-lg font-bold text-slate-900 tabular-nums">
              {selectedDate}
            </h3>
          </div>

          <div className="space-y-3 max-h-56 overflow-y-auto">
            {selectedDayData.exams.map((ex) => (
              <div
                key={`d-ex-${ex.id}`}
                className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-xs"
              >
                <div className="font-semibold text-amber-900">
                  Exam: {ex.subject} ({ex.examType === 'Other' ? ex.customExamType : ex.examType})
                </div>
                <div className="mt-0.5 text-amber-800 tabular-nums">
                  {ex.seatingTime.replace('T', ' ')} · {ex.readingMinutes}m read / {ex.writingMinutes}m write
                </div>
              </div>
            ))}

            {selectedDayData.tasks.map((t) => (
              <div
                key={`d-t-${t.id}`}
                className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs"
              >
                <div className="font-semibold text-slate-900">Task: {t.title}</div>
                <div className="mt-0.5 text-slate-500">
                  {t.subject} · {t.status.replace('_', ' ')}
                </div>
              </div>
            ))}

            {selectedDayData.events.map((ev) => (
              <div
                key={`d-ev-${ev.id}`}
                className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900">{ev.title}</div>
                  <div className="mt-0.5 text-slate-500 tabular-nums">
                    {ev.eventTime} · {ev.category}
                  </div>
                  {ev.notes && <p className="mt-1 text-slate-600">{ev.notes}</p>}
                  {ev.meetLink && (
                    <a
                      href={ev.meetLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 font-medium text-blue-600 hover:underline"
                    >
                      <Video className="h-3 w-3" />
                      Join Google Meet
                    </a>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setDeleteEventTarget(ev)}
                  className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  aria-label="Delete event"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}

            {selectedDayData.events.length === 0 &&
              selectedDayData.tasks.length === 0 &&
              selectedDayData.exams.length === 0 && (
                <p className="text-xs text-slate-500">
                  Nothing scheduled for {selectedDate}. Add a study block below.
                </p>
              )}
          </div>

          <form onSubmit={handleAddEvent} className="space-y-3 border-t border-slate-100 pt-4">
            <h4 className="text-sm font-semibold text-slate-900 tabular-nums">
              Schedule Study Event (+{studyEventPts} pts if study-verified)
            </h4>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Event title (e.g., Organic Chemistry Revision)"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="time"
                value={eventTime}
                onChange={(e) => setEventTime(e.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums focus:border-blue-500 focus:outline-none"
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="study">Study Block (+{studyEventPts} pts)</option>
                <option value="exam">Mock Exam (+{studyEventPts} pts)</option>
                <option value="deadline">Study Deadline (+{studyEventPts} pts)</option>
                <option value="meeting">Study Group</option>
                <option value="personal">Personal / Other (0 pts)</option>
              </select>
            </div>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes or syllabus chapters..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            {isWorkspaceEnabled && isProOrAdmin && workspacePermissions.meetRooms && (
              <div className="flex items-center gap-2">
                <input
                  type="url"
                  value={meetLink}
                  onChange={(e) => setMeetLink(e.target.value)}
                  placeholder="Meet URL (optional)"
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleGenerateMeet}
                  disabled={creatingMeet}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
                >
                  <Video className="h-3.5 w-3.5 text-blue-600" />
                  {creatingMeet ? 'Creating...' : 'Create Meet'}
                </button>
              </div>
            )}
            {eventRewardMsg && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                {eventRewardMsg}
              </div>
            )}
            {statusMsg && (
              <div className="text-xs text-red-600">{statusMsg}</div>
            )}
            <button
              type="submit"
              disabled={saving}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              <Plus className="h-4 w-4" />
              {saving ? 'Saving...' : 'Add to Calendar'}
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
