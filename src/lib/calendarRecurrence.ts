export type ScheduleMode = 'single' | 'range' | 'specific' | 'recurring';

export type RecurrenceFrequency = 'weekly' | 'monthly' | 'annually';

export type MonthlyPatternKind = 'by_date' | 'by_weekday';

export type WeekdayOrdinal = 1 | 2 | 3 | 4 | -1; // 1st, 2nd, 3rd, 4th, Last

export type RecurrenceBoundMode = 'until' | 'count';

export interface ScheduleGenerationConfig {
  mode: ScheduleMode;
  singleDate: string;
  rangeStart: string;
  rangeEnd: string;
  rangeWeekdays: number[]; // empty = every day in stretch; non-empty = filter by weekdays 0..6
  specificDates: string[];
  recurStart: string;
  frequency: RecurrenceFrequency;
  weeklyDays: number[]; // 0..6
  monthlyPattern: MonthlyPatternKind;
  monthlyDay: number; // 1..31
  monthlySkipMissingDay: boolean; // true = skip months lacking day (e.g. Feb 30), false = clamp to last day
  monthlyOrdinal: WeekdayOrdinal;
  monthlyWeekday: number; // 0..6
  annualPattern: MonthlyPatternKind;
  annualMonth: number; // 0..11
  annualDay: number; // 1..31
  annualOrdinal: WeekdayOrdinal;
  annualWeekday: number; // 0..6
  boundMode: RecurrenceBoundMode;
  untilDate: string;
  count: number;
}

export const MAX_BULK_DATES = 366;

export const WEEKDAY_FULL = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const ORDINAL_OPTIONS: { value: WeekdayOrdinal; label: string }[] = [
  { value: 1, label: 'First' },
  { value: 2, label: 'Second' },
  { value: 3, label: 'Third' },
  { value: 4, label: 'Fourth' },
  { value: -1, label: 'Last' },
];

export function parseDateKey(dateKey: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(year, month, day);
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) {
    return null;
  }
  return d;
}

export function formatLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function resolveNthWeekdayInMonth(
  year: number,
  month: number,
  ordinal: WeekdayOrdinal,
  weekday: number
): Date | null {
  const daysInMonth = getDaysInMonth(year, month);
  if (ordinal === -1) {
    const lastDayWeekday = new Date(year, month, daysInMonth).getDay();
    const diff = (lastDayWeekday - weekday + 7) % 7;
    const day = daysInMonth - diff;
    return new Date(year, month, day);
  }
  const firstWeekday = new Date(year, month, 1).getDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  const day = 1 + offset + (ordinal - 1) * 7;
  if (day > daysInMonth) return null;
  return new Date(year, month, day);
}

export function resolveMonthDay(
  year: number,
  month: number,
  targetDay: number,
  skipMissingDay: boolean
): Date | null {
  const dim = getDaysInMonth(year, month);
  if (targetDay <= dim) {
    return new Date(year, month, targetDay);
  }
  if (skipMissingDay) return null;
  return new Date(year, month, dim);
}

export function generateScheduleDates(config: ScheduleGenerationConfig): {
  dates: string[];
  truncated: boolean;
  error?: string;
} {
  if (config.mode === 'single') {
    const parsed = parseDateKey(config.singleDate);
    if (!parsed) return { dates: [], truncated: false, error: 'Select a valid date.' };
    return { dates: [formatLocalDateKey(parsed)], truncated: false };
  }

  if (config.mode === 'specific') {
    const unique = new Set<string>();
    for (const raw of config.specificDates) {
      const parsed = parseDateKey(raw);
      if (parsed) unique.add(formatLocalDateKey(parsed));
    }
    const sorted = Array.from(unique).sort();
    if (sorted.length > MAX_BULK_DATES) {
      return {
        dates: sorted.slice(0, MAX_BULK_DATES),
        truncated: true,
      };
    }
    return { dates: sorted, truncated: false };
  }

  if (config.mode === 'range') {
    const start = parseDateKey(config.rangeStart);
    const end = parseDateKey(config.rangeEnd);
    if (!start || !end) {
      return { dates: [], truncated: false, error: 'Enter valid start and end dates.' };
    }
    if (end.getTime() < start.getTime()) {
      return { dates: [], truncated: false, error: 'End date must be on or after start date.' };
    }
    const filterSet = config.rangeWeekdays.length > 0 ? new Set(config.rangeWeekdays) : null;
    const out: string[] = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    let truncated = false;
    while (cursor.getTime() <= end.getTime()) {
      if (!filterSet || filterSet.has(cursor.getDay())) {
        if (out.length >= MAX_BULK_DATES) {
          truncated = true;
          break;
        }
        out.push(formatLocalDateKey(cursor));
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return { dates: out, truncated };
  }

  // Recurring mode
  const start = parseDateKey(config.recurStart);
  if (!start) {
    return { dates: [], truncated: false, error: 'Select a valid recurrence start date.' };
  }

  const maxTargetCount =
    config.boundMode === 'count'
      ? Math.max(1, Math.min(MAX_BULK_DATES, Math.floor(config.count) || 1))
      : MAX_BULK_DATES;

  const untilDate = config.boundMode === 'until' ? parseDateKey(config.untilDate) : null;
  if (config.boundMode === 'until') {
    if (!untilDate) {
      return { dates: [], truncated: false, error: 'Select a valid end ("until") date.' };
    }
    if (untilDate.getTime() < start.getTime()) {
      return { dates: [], truncated: false, error: 'End ("until") date must be on or after start date.' };
    }
  }

  const out: string[] = [];
  let truncated = false;

  if (config.frequency === 'weekly') {
    const daySet = new Set(config.weeklyDays.length > 0 ? config.weeklyDays : [start.getDay()]);
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    // Hard safety guard ~12 years of scanning
    for (let iter = 0; iter < 4500; iter++) {
      if (untilDate && cursor.getTime() > untilDate.getTime()) break;
      if (out.length >= maxTargetCount) {
        if (config.boundMode === 'until') truncated = true;
        break;
      }
      if (daySet.has(cursor.getDay())) {
        out.push(formatLocalDateKey(cursor));
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return { dates: out, truncated };
  }

  if (config.frequency === 'monthly') {
    const startYear = start.getFullYear();
    const startMonth = start.getMonth();
    const targetDay = Math.max(1, Math.min(31, Math.floor(config.monthlyDay) || start.getDate()));
    for (let mOffset = 0; mOffset < 480; mOffset++) {
      const totalM = startYear * 12 + startMonth + mOffset;
      const y = Math.floor(totalM / 12);
      const m = totalM % 12;

      const candidate =
        config.monthlyPattern === 'by_date'
          ? resolveMonthDay(y, m, targetDay, config.monthlySkipMissingDay)
          : resolveNthWeekdayInMonth(y, m, config.monthlyOrdinal, config.monthlyWeekday);

      if (!candidate) continue;
      if (candidate.getTime() < start.getTime()) continue;
      if (untilDate && candidate.getTime() > untilDate.getTime()) break;

      if (out.length >= maxTargetCount) {
        if (config.boundMode === 'until') truncated = true;
        break;
      }
      out.push(formatLocalDateKey(candidate));
    }
    return { dates: out, truncated };
  }

  // Annually
  const startYear = start.getFullYear();
  const targetMonth = Math.max(0, Math.min(11, config.annualMonth));
  const targetDay = Math.max(1, Math.min(31, Math.floor(config.annualDay) || start.getDate()));
  for (let yOffset = 0; yOffset < 100; yOffset++) {
    const y = startYear + yOffset;
    const candidate =
      config.annualPattern === 'by_date'
        ? resolveMonthDay(y, targetMonth, targetDay, config.monthlySkipMissingDay)
        : resolveNthWeekdayInMonth(y, targetMonth, config.annualOrdinal, config.annualWeekday);

    if (!candidate) continue;
    if (candidate.getTime() < start.getTime()) continue;
    if (untilDate && candidate.getTime() > untilDate.getTime()) break;

    if (out.length >= maxTargetCount) {
      if (config.boundMode === 'until') truncated = true;
      break;
    }
    out.push(formatLocalDateKey(candidate));
  }

  return { dates: out, truncated };
}
