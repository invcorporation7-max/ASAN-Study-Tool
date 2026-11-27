import type {
  AppShortcutMap,
  DashboardPreferences,
  DashboardTileSize,
  DashboardWidgetId,
  ExamCountdownItem,
  NavSection,
} from '../types';

export const DEFAULT_DASHBOARD_WIDGET_ORDER: DashboardWidgetId[] = [
  'metrics',
  'exam-countdowns',
  'forum-highlights',
  'purchased-materials',
  'tasks',
  'schedule',
  'contributor-console',
  'admin-console',
  'super-console',
  'monthly-calendar',
  'quick-actions',
];

export const DEFAULT_HIDDEN_WIDGETS: DashboardWidgetId[] = ['monthly-calendar'];

export const DEFAULT_WIDGET_SIZES: Record<DashboardWidgetId, DashboardTileSize> = {
  metrics: { colSpan: 2, rowSpan: 1 },
  'exam-countdowns': { colSpan: 2, rowSpan: 1 },
  'forum-highlights': { colSpan: 1, rowSpan: 1 },
  'purchased-materials': { colSpan: 1, rowSpan: 1 },
  tasks: { colSpan: 1, rowSpan: 1 },
  schedule: { colSpan: 1, rowSpan: 1 },
  'contributor-console': { colSpan: 1, rowSpan: 1 },
  'admin-console': { colSpan: 1, rowSpan: 1 },
  'super-console': { colSpan: 1, rowSpan: 1 },
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
  'forum-highlights': {
    label: 'Study Forum (Popular & Recent)',
    description: 'Switch between the most popular discussions and latest posts in Study Forum.',
  },
  'purchased-materials': {
    label: 'Purchased Study Materials',
    description: 'Active rentals and purchased notes/papers with expiry timers and quick access.',
  },
  tasks: {
    label: 'Priority Study Tasks',
    description: 'Quick view of upcoming study tasks and completion status.',
  },
  schedule: {
    label: 'Upcoming Schedule',
    description: 'Next upcoming calendar sessions, tuition classes, and exams.',
  },
  'contributor-console': {
    label: "Contributors' Console Widget",
    description: 'Quick summary and launcher for approved Contributors.',
  },
  'admin-console': {
    label: 'Admin Console Widget',
    description: 'Pending point verifications, moderation overview, and Admin quick launcher.',
  },
  'super-console': {
    label: 'Super Console Widget',
    description: 'Circulating economy summary, role stats, and Super Console launcher.',
  },
  'monthly-calendar': {
    label: 'Current Month Calendar (Optional)',
    description: 'Optional live monthly calendar highlighting today, events, tasks, and exams.',
  },
  'quick-actions': {
    label: 'Quick Tool Launchers',
    description: 'One-click shortcuts to A4 Notes, PDF Studio, Math Solvers (Lite), and Tool Mail.',
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

export const SHORTCUT_UPDATED_EVENT = 'asan-app-shortcuts-updated';

export const SUGGESTED_APP_SHORTCUTS: AppShortcutMap = {
  dashboard: 'Alt+1',
  'all-apps': 'Alt+2',
  calendar: 'Alt+3',
  tasks: 'Alt+4',
  notes: 'Alt+5',
  timers: 'Alt+6',
  calculator: 'Alt+7',
  'study-materials': 'Alt+8',
  messages: 'Alt+9',
  plans: 'Alt+,',
};

export interface AppShortcutCatalogEntry {
  id: NavSection;
  label: string;
  category: string;
  proOnly?: boolean;
  eliteOnly?: boolean;
  requiresWorkspace?: boolean;
  requiresContributor?: boolean;
  requiresAdmin?: boolean;
  requiresSuper?: boolean;
}

export const APP_SHORTCUT_CATALOG: AppShortcutCatalogEntry[] = [
  { id: 'dashboard', label: 'Dashboard', category: 'Core' },
  { id: 'all-apps', label: 'All Apps', category: 'Core' },
  { id: 'calendar', label: 'Calendar', category: 'Study Workspace' },
  { id: 'tasks', label: 'My Tasks', category: 'Study Workspace' },
  { id: 'notes', label: 'My Notes', category: 'Study Workspace' },
  { id: 'timers', label: 'Timers', category: 'Study Workspace' },
  { id: 'calculator', label: 'fx-82MS Calc', category: 'Study Workspace' },
  { id: 'formula-calculator', label: 'Formula Calculator', category: 'Study Workspace' },
  { id: 'forum', label: 'Study Forum', category: 'Community & Account' },
  { id: 'messages', label: 'Tool Mail', category: 'Community & Account' },
  { id: 'study-materials', label: 'Study Material Notes', category: 'Community & Account' },
  { id: 'subscriptions', label: 'Subscriptions and Plans', category: 'Community & Account' },
  { id: 'notifications', label: 'Notifications', category: 'Community & Account' },
  { id: 'specialized-calculators', label: 'Specialized Calculators (Lite)', category: 'Pro Tools', proOnly: true },
  { id: 'chemistry-lab', label: 'Chemistry Virtual Lab', category: 'Elite Labs', eliteOnly: true },
  { id: 'physics-lab', label: 'Physics Virtual Lab', category: 'Elite Labs', eliteOnly: true },
  { id: 'motion-3d', label: '3D Motion Visualizer', category: 'Elite Labs', eliteOnly: true },
  { id: 'pdf-tool', label: 'PDF Tool', category: 'Pro Tools', proOnly: true },
  { id: 'workspace', label: 'Google Workspace', category: 'Pro Tools', proOnly: true, requiresWorkspace: true },
  { id: 'spectra', label: 'Spectra AI', category: 'Pro Tools', proOnly: true },
  { id: 'more', label: 'More Features', category: 'General' },
  { id: 'plans', label: 'Settings', category: 'Settings & Info' },
  { id: 'about', label: 'About the Creators', category: 'Settings & Info' },
  { id: 'contact', label: 'Contact', category: 'Settings & Info' },
  { id: 'contributor-console', label: "Contributors' Console", category: 'Roles', requiresContributor: true },
  { id: 'admin', label: 'Admin Console', category: 'Roles', requiresAdmin: true },
  { id: 'super', label: 'Super Console', category: 'Roles', requiresSuper: true },
];

const VALID_SHORTCUT_SECTIONS = new Set<NavSection>(APP_SHORTCUT_CATALOG.map((c) => c.id));

function shortcutPrefKey(userKey: string): string {
  return `asan_app_shortcuts_v1_${userKey || 'guest'}`;
}

export function normalizeShortcutCombo(combo: string): string {
  const parts = combo
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return '';
  const mods = new Set<string>();
  let mainKey = '';
  for (const part of parts) {
    const low = part.toLowerCase();
    if (low === 'ctrl' || low === 'control') mods.add('Ctrl');
    else if (low === 'alt' || low === 'option') mods.add('Alt');
    else if (low === 'shift') mods.add('Shift');
    else if (low === 'meta' || low === 'cmd' || low === 'command' || low === 'win') mods.add('Meta');
    else mainKey = part.length === 1 ? part.toUpperCase() : part;
  }
  if (!mainKey) return '';
  const orderedMods = ['Ctrl', 'Alt', 'Shift', 'Meta'].filter((m) => mods.has(m));
  return [...orderedMods, mainKey].join('+');
}

function resolveKeyNameFromEvent(e: { code?: string; key: string }): string | null {
  const code = e.code || '';
  if (/^Key([A-Z])$/.test(code)) {
    return code.slice(3);
  }
  if (/^Digit([0-9])$/.test(code)) {
    return code.slice(5);
  }
  if (/^Numpad([0-9])$/.test(code)) {
    return code.slice(6);
  }
  const key = e.key;
  if (!key) return null;
  if (
    key === 'Control' ||
    key === 'Shift' ||
    key === 'Alt' ||
    key === 'Meta' ||
    key === 'CapsLock' ||
    key === 'Tab' ||
    key === 'Escape' ||
    key === 'Dead'
  ) {
    return null;
  }
  if (/^F([1-9]|1[0-2])$/i.test(key)) return key.toUpperCase();
  if (key === ' ') return 'Space';
  if (code === 'Comma' || key === ',') return ',';
  if (code === 'Period' || key === '.') return '.';
  if (code === 'Slash' || key === '/') return '/';
  if (code === 'Semicolon' || key === ';') return ';';
  if (code === 'BracketLeft' || key === '[') return '[';
  if (code === 'BracketRight' || key === ']') return ']';
  if (code === 'Backquote' || key === '`') return '`';
  if (code === 'Minus' || key === '-') return '-';
  if (code === 'Equal' || key === '=') return '=';
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export function formatKeyboardEventCombo(e: {
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  key: string;
  code?: string;
}): string | null {
  const mainKey = resolveKeyNameFromEvent(e);
  if (!mainKey) return null;
  const isFnKey = /^F([1-9]|1[0-2])$/i.test(mainKey);
  if (!e.ctrlKey && !e.altKey && !e.metaKey && !isFnKey) {
    return null;
  }
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Meta');
  return [...mods, mainKey].join('+');
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.closest('[contenteditable="true"], [role="textbox"]')) return true;
  return false;
}

export function loadAppShortcuts(userKey: string): AppShortcutMap {
  try {
    const raw = localStorage.getItem(shortcutPrefKey(userKey));
    if (!raw) return { ...SUGGESTED_APP_SHORTCUTS };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return { ...SUGGESTED_APP_SHORTCUTS };
    const clean: AppShortcutMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (VALID_SHORTCUT_SECTIONS.has(k as NavSection) && typeof v === 'string') {
        const norm = normalizeShortcutCombo(v);
        if (norm) clean[k as NavSection] = norm;
      }
    }
    return clean;
  } catch {
    return { ...SUGGESTED_APP_SHORTCUTS };
  }
}

export function saveAppShortcuts(userKey: string, map: AppShortcutMap): void {
  try {
    localStorage.setItem(shortcutPrefKey(userKey), JSON.stringify(map));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(SHORTCUT_UPDATED_EVENT, { detail: { userKey, map } })
      );
    }
  } catch {
    // ignore storage errors
  }
}

