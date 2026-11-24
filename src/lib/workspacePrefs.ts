import type {
  DashboardPreferences,
  DashboardTileSize,
  DashboardWidgetId,
  ExamCountdownItem,
} from '../types';

export const DEFAULT_DASHBOARD_WIDGET_ORDER: DashboardWidgetId[] = [
  'metrics',
  'exam-countdowns',
  'tasks',
  'schedule',
  'monthly-calendar',
  'quick-actions',
];

export const DEFAULT_HIDDEN_WIDGETS: DashboardWidgetId[] = ['monthly-calendar'];

export const DEFAULT_WIDGET_SIZES: Record<DashboardWidgetId, DashboardTileSize> = {
  metrics: { colSpan: 2, rowSpan: 1 },
  'exam-countdowns': { colSpan: 2, rowSpan: 1 },
  tasks: { colSpan: 1, rowSpan: 1 },
  schedule: { colSpan: 1, rowSpan: 1 },
  'monthly-calendar': { colSpan: 1, rowSpan: 1 },
  'quick-actions': { colSpan: 2, rowSpan: 1 },
};

export const DASHBOARD_WIDGET_META: Record<
  DashboardWidgetId,
  { label: string; description: string }
> = {
  metrics: {
    label: 'Study Overview Metrics',
    description: 'Pending tasks, completed tasks, calendar events, and study time cards.',
  },
  'exam-countdowns': {
    label: 'Exam Countdowns (Optional)',
    description: 'Optional live ticking cards for pinned national exams and custom countdowns.',
  },
  tasks: {
    label: 'Priority Study Tasks',
    description: 'Quick view of upcoming study tasks and completion status.',
  },
  schedule: {
    label: 'Upcoming Schedule',
    description: 'Next upcoming calendar sessions, tuition classes, and exams.',
  },
  'monthly-calendar': {
    label: 'Current Month Calendar (Optional)',
    description: 'Optional live monthly calendar highlighting today, events, tasks, and exams.',
  },
  'quick-actions': {
    label: 'Quick Tool Launchers',
    description: 'One-click shortcuts to A4 Notes, PDF Studio, Math Solvers, and Tool Mail.',
  },
};

function dashPrefKey(userKey: string): string {
  return `asan_dashboard_prefs_v1_${userKey || 'guest'}`;
}

function pinPrefKey(userKey: string): string {
  return `asan_countdown_pins_v1_${userKey || 'guest'}`;
}

function normalizeSizes(
  rawSizes?: Partial<Record<DashboardWidgetId, DashboardTileSize>>
): Partial<Record<DashboardWidgetId, DashboardTileSize>> {
  const out: Partial<Record<DashboardWidgetId, DashboardTileSize>> = {};
  for (const id of DEFAULT_DASHBOARD_WIDGET_ORDER) {
    const def = DEFAULT_WIDGET_SIZES[id];
    const s = rawSizes?.[id];
    out[id] = {
      colSpan: s?.colSpan === 1 || s?.colSpan === 2 ? s.colSpan : def.colSpan,
      rowSpan: s?.rowSpan === 1 || s?.rowSpan === 2 ? s.rowSpan : def.rowSpan,
    };
  }
  return out;
}

export function loadDashboardPrefs(userKey: string): DashboardPreferences {
  try {
    const raw = localStorage.getItem(dashPrefKey(userKey));
    if (!raw) {
      return {
        order: [...DEFAULT_DASHBOARD_WIDGET_ORDER],
        hidden: [...DEFAULT_HIDDEN_WIDGETS],
        sizes: normalizeSizes(),
      };
    }
    const parsed = JSON.parse(raw) as Partial<DashboardPreferences>;
    const validSet = new Set<DashboardWidgetId>(DEFAULT_DASHBOARD_WIDGET_ORDER);
    const parsedOrder = Array.isArray(parsed.order)
      ? parsed.order.filter((id): id is DashboardWidgetId => validSet.has(id as DashboardWidgetId))
      : [];
    const cleanedOrder = [...parsedOrder];
    const cleanedHidden = Array.isArray(parsed.hidden)
      ? parsed.hidden.filter((id): id is DashboardWidgetId => validSet.has(id as DashboardWidgetId))
      : [];

    for (const defId of DEFAULT_DASHBOARD_WIDGET_ORDER) {
      if (!cleanedOrder.includes(defId)) {
        cleanedOrder.push(defId);
        // Opt-in migration for monthly-calendar on existing profiles
        if (defId === 'monthly-calendar' && !cleanedHidden.includes(defId)) {
          cleanedHidden.push(defId);
        }
      }
    }

    return {
      order: cleanedOrder,
      hidden: cleanedHidden,
      sizes: normalizeSizes(parsed.sizes),
    };
  } catch {
    return {
      order: [...DEFAULT_DASHBOARD_WIDGET_ORDER],
      hidden: [...DEFAULT_HIDDEN_WIDGETS],
      sizes: normalizeSizes(),
    };
  }
}

export function saveDashboardPrefs(userKey: string, prefs: DashboardPreferences): void {
  try {
    localStorage.setItem(dashPrefKey(userKey), JSON.stringify(prefs));
  } catch {
    // ignore storage errors
  }
}

export interface CountdownPinState {
  pinnedIds: number[];
  unpinnedDefaultIds: number[];
}

export function loadCountdownPins(userKey: string): CountdownPinState {
  try {
    const raw = localStorage.getItem(pinPrefKey(userKey));
    if (!raw) return { pinnedIds: [], unpinnedDefaultIds: [] };
    const parsed = JSON.parse(raw) as Partial<CountdownPinState>;
    return {
      pinnedIds: Array.isArray(parsed.pinnedIds)
        ? parsed.pinnedIds.map(Number).filter(Number.isFinite)
        : [],
      unpinnedDefaultIds: Array.isArray(parsed.unpinnedDefaultIds)
        ? parsed.unpinnedDefaultIds.map(Number).filter(Number.isFinite)
        : [],
    };
  } catch {
    return { pinnedIds: [], unpinnedDefaultIds: [] };
  }
}

export function saveCountdownPins(userKey: string, state: CountdownPinState): void {
  try {
    localStorage.setItem(pinPrefKey(userKey), JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
}

export function isCountdownPinned(
  item: ExamCountdownItem,
  pinState: CountdownPinState
): boolean {
  if (pinState.pinnedIds.includes(item.id)) return true;
  if (item.pinnedByDefault && !pinState.unpinnedDefaultIds.includes(item.id)) return true;
  return false;
}

export function toggleCountdownPin(
  userKey: string,
  item: ExamCountdownItem,
  currentlyPinned: boolean
): CountdownPinState {
  const prev = loadCountdownPins(userKey);
  const pinnedSet = new Set(prev.pinnedIds);
  const unpinnedSet = new Set(prev.unpinnedDefaultIds);

  if (currentlyPinned) {
    pinnedSet.delete(item.id);
    if (item.pinnedByDefault) unpinnedSet.add(item.id);
  } else {
    pinnedSet.add(item.id);
    unpinnedSet.delete(item.id);
  }

  const next: CountdownPinState = {
    pinnedIds: Array.from(pinnedSet),
    unpinnedDefaultIds: Array.from(unpinnedSet),
  };
  saveCountdownPins(userKey, next);
  return next;
}

export interface CountdownRemaining {
  expired: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  hasTime: boolean;
  targetTimestamp: number;
}

export function getCountdownRemaining(
  item: Pick<ExamCountdownItem, 'targetDate' | 'targetTime'>,
  nowMs: number = Date.now()
): CountdownRemaining {
  const hasTime = Boolean(item.targetTime && /^\d{2}:\d{2}$/.test(item.targetTime));
  const timeStr = hasTime ? `${item.targetTime}:00` : '00:00:00';
  const [y, m, d] = item.targetDate.split('-').map(Number);
  const [hh, mm, ss] = timeStr.split(':').map(Number);
  const target = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, ss || 0).getTime();
  const diff = target - nowMs;
  if (!Number.isFinite(target) || diff <= 0) {
    return {
      expired: true,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      hasTime,
      targetTimestamp: target || nowMs,
    };
  }
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return {
    expired: false,
    days,
    hours,
    minutes,
    seconds,
    hasTime,
    targetTimestamp: target,
  };
}
