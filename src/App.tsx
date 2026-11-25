import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  Bell,
  BookOpen,
  Calculator,
  Calendar,
  CheckCircle2,
  CheckSquare,
  Clock,
  Cloud,
  CreditCard,
  Crown,
  FolderOpen,
  FolderUp,
  FunctionSquare,
  Globe,
  GripVertical,
  Info,
  KeyRound,
  Keyboard,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  Menu,
  MessageSquare,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  RefreshCw,
  Search,
  ShieldCheck,
  Sigma,
  Sparkles,
  Sun,
  UserCheck,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import { AdminView } from './components/AdminView';
import { AuthGate } from './components/AuthGate';
import { CalendarView } from './components/CalendarView';
import { CasioFx82MsView } from './components/CasioFx82MsView';
import { ContributorConsoleView } from './components/ContributorConsoleView';
import { DashboardView } from './components/DashboardView';
import { FormulaCalculatorView } from './components/FormulaCalculatorView';
import { ForumView } from './components/ForumView';
import {
  AboutCreatorsView,
  ContactView,
  MoreFeaturesView,
  PlansView,
  SpectraView,
} from './components/InfoViews';
import { MessagesView } from './components/MessagesView';
import { NotesView } from './components/NotesView';
import { NotificationsView } from './components/NotificationsView';
import { PdfStudioView } from './components/PdfStudioView';
import { ProGateCard } from './components/ProGateCard';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallBanner';
import { SpecializedCalculatorsView } from './components/SpecializedCalculatorsView';
import { StudyMaterialView } from './components/StudyMaterialView';
import { SubscriptionsView } from './components/SubscriptionsView';
import { SuperView } from './components/SuperView';
import { TasksView } from './components/TasksView';
import { TechnicalLoadingScreen } from './components/TechnicalLoadingScreen';
import { TimersView } from './components/TimersView';
import { UserAvatarBadge } from './components/UserAvatarBadge';
import { WorkspaceView } from './components/WorkspaceView';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { initGoogleAnalytics, trackGa4PageView } from './lib/analytics';
import { apiFetch, apiOptionalAuthFetch, getPasswordSessionToken } from './lib/api';
import { useForumSocket } from './lib/forumSocket';
import { loadGuestWorkspace } from './lib/guestStore';
import {
  SHORTCUT_UPDATED_EVENT,
  formatKeyboardEventCombo,
  isEditableTarget,
  loadAppShortcuts,
} from './lib/workspacePrefs';
import type {
  AppShortcutMap,
  CalendarEventItem,
  ExamBlueprintItem,
  ExamCountdownItem,
  ExamScheduleItem,
  InAppMessageItem,
  NavSection,
  NotificationItem,
  StudyLogItem,
  StudyMaterialItem,
  StudyNotebook,
  StudyNotePage,
  StudyTask,
  ToolUserSummary,
} from './types';

interface AppCatalogEntry {
  id: NavSection;
  label: string;
  description: string;
  category: 'Core Study Workspace' | 'Community & Account' | 'Pro & Extended Tools';
  icon: React.FC<{ className?: string }>;
  proOnly?: boolean;
}

const ALL_TOOLS_CATALOG: AppCatalogEntry[] = [
  {
    id: 'calendar',
    label: 'Calendar',
    description: 'Exam schedules, subject routines, and Google Sheets sync.',
    category: 'Core Study Workspace',
    icon: Calendar,
  },
  {
    id: 'tasks',
    label: 'My Tasks',
    description: 'Track assignments, Kanban status, priorities, and due dates.',
    category: 'Core Study Workspace',
    icon: CheckSquare,
  },
  {
    id: 'notes',
    label: 'My Notes',
    description: 'OneNote-style A4 study notebooks with PDF and Google Docs export.',
    category: 'Core Study Workspace',
    icon: BookOpen,
  },
  {
    id: 'timers',
    label: 'Timers',
    description: 'Exam countdowns, Pomodoro sessions, and focus study logs.',
    category: 'Core Study Workspace',
    icon: Clock,
  },
  {
    id: 'calculator',
    label: 'fx-82MS Calc',
    description: 'Casio fx-82MS non-programmable scientific calculator simulator.',
    category: 'Core Study Workspace',
    icon: Calculator,
  },
  {
    id: 'formula-calculator',
    label: 'Formula Calculator',
    description:
      'Contributor-defined formula & parameter-matching calculator + wide symbolic circle & conic solver.',
    category: 'Core Study Workspace',
    icon: FunctionSquare,
  },
  {
    id: 'forum',
    label: 'Study Forum',
    description:
      'Real-time Global Q&A Arena, Study Groups, 1-to-1 DMs, competitive question fields & Summernote formatting.',
    category: 'Community & Account',
    icon: Users,
  },
  {
    id: 'messages',
    label: 'Tool Mail',
    description: 'In-app study mail, rich formatting, attachments, and contributor requests.',
    category: 'Community & Account',
    icon: MessageSquare,
  },
  {
    id: 'study-materials',
    label: 'Study Material Notes',
    description: 'Upload and unlock photos, videos, recordings, PDFs, Word, Excel, PPT & text with points.',
    category: 'Community & Account',
    icon: FolderOpen,
  },
  {
    id: 'subscriptions',
    label: 'Subscriptions',
    description: 'Manage your plan tier, ASAN points balance, and renewals.',
    category: 'Community & Account',
    icon: Sparkles,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'Alerts, points activity updates, and announcements.',
    category: 'Community & Account',
    icon: Bell,
  },
  {
    id: 'specialized-calculators',
    label: 'Specialized Calculators',
    description:
      'Deterministic solvers for Calculus, Coordinate Geometry, Algebra, Vectors & 3D, and Trigonometry.',
    category: 'Pro & Extended Tools',
    icon: Sigma,
    proOnly: true,
  },
  {
    id: 'pdf-tool',
    label: 'PDF Tool',
    description: 'A4 booklet imposition, whole PDF import, camera scan & cropping.',
    category: 'Pro & Extended Tools',
    icon: Layers,
    proOnly: true,
  },
  {
    id: 'workspace',
    label: 'Google Workspace',
    description: 'Opt-in ASAN Drive folder, Docs export, Sheets sync, and Meet.',
    category: 'Pro & Extended Tools',
    icon: Cloud,
    proOnly: true,
  },
  {
    id: 'spectra',
    label: 'Spectra AI',
    description: 'Currently unavailable — under development.',
    category: 'Pro & Extended Tools',
    icon: Globe,
    proOnly: true,
  },
  {
    id: 'more',
    label: 'More Features',
    description: 'Additional study utilities and quick shortcuts.',
    category: 'Pro & Extended Tools',
    icon: MoreHorizontal,
  },
];

const PINNED_APPS_STORAGE_KEY = 'asan_pinned_sidebar_apps_v1';
const DEFAULT_PINNED_APPS: NavSection[] = [
  'calendar',
  'tasks',
  'notes',
  'timers',
  'calculator',
  'formula-calculator',
  'forum',
  'study-materials',
  'messages',
];

function loadPinnedApps(): NavSection[] {
  try {
    const raw = localStorage.getItem(PINNED_APPS_STORAGE_KEY);
    if (!raw) return [...DEFAULT_PINNED_APPS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_PINNED_APPS];
    const validIds = new Set(ALL_TOOLS_CATALOG.map((t) => t.id));
    return parsed.filter((id): id is NavSection => typeof id === 'string' && validIds.has(id as NavSection));
  } catch {
    return [...DEFAULT_PINNED_APPS];
  }
}

const SECONDARY_NAV: {
  id: NavSection;
  label: string;
  icon: React.FC<{ className?: string }>;
}[] = [
  { id: 'plans', label: 'View Plans and Settings', icon: CreditCard },
  { id: 'about', label: 'About the Creators', icon: Info },
  { id: 'contact', label: 'Contact', icon: Mail },
];

const SECTION_LABELS: Record<NavSection, string> = {
  dashboard: 'Dashboard',
  'all-apps': 'All Apps',
  forum: 'Study Forum',
  calendar: 'Calendar',
  tasks: 'My Tasks',
  notes: 'My Notes',
  timers: 'Timers',
  calculator: 'fx-82MS Calc',
  'formula-calculator': 'Formula Calculator',
  'specialized-calculators': 'Specialized Calculators',
  messages: 'Tool Mail',
  'study-materials': 'Study Material Notes',
  'contributor-console': "Contributors' Console",
  subscriptions: 'Subscriptions',
  notifications: 'Notifications',
  admin: 'Admin Console',
  super: 'Super Console',
  'pdf-tool': 'PDF Tool',
  workspace: 'Google Workspace',
  spectra: 'Spectra AI',
  more: 'More Features',
  plans: 'View Plans and Settings',
  about: 'About the Creators',
  contact: 'Contact',
};

type SearchCategory =
  | 'all'
  | 'notes'
  | 'tasks_cal'
  | 'mail_alerts'
  | 'users'
  | 'sections';

interface SearchResultItem {
  id: string;
  title: string;
  subtitle: string;
  snippet?: string;
  section: NavSection;
  categoryKey: Exclude<SearchCategory, 'all'>;
}

function buildSnippet(text: string, q: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const idx = clean.toLowerCase().indexOf(q);
  if (idx < 0) return clean.slice(0, 90);
  const start = Math.max(0, idx - 24);
  const end = Math.min(clean.length, idx + q.length + 56);
  return `${start > 0 ? '…' : ''}${clean.slice(start, end)}${end < clean.length ? '…' : ''}`;
}

const MainShell: React.FC = () => {
  const {
    firebaseUser,
    dbUser,
    isGuest,
    authMode,
    isWorkspaceEnabled,
    isSuper,
    isAdmin,
    isApprovedContributor,
    effectivePlan,
    isEffectiveProOrAdmin,
    setViewPlanMode,
    loading,
    error: authError,
    clearError,
    dbStatus,
    dbStatusMessage,
    dbRetryCount,
    dbWaitSeconds,
    retryDbConnection,
    permissionStep,
    savedAccounts,
    acceptDriveFolderPermissionStep,
    acceptWorkspacePermissionStep,
    skipPermissionStep,
    openPermissionFlow,
    switchAccount,
    startSwitchToNewLogin,
    removeSavedAccount,
    continueFreeGuest,
    exitGuestToSignIn,
    signOutUser,
    refreshProfile,
  } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const isProOrAdmin = isEffectiveProOrAdmin;
  const hasSessionToken = Boolean(firebaseUser || dbUser || getPasswordSessionToken());
  const userKey = isGuest ? 'guest' : dbUser?.uid || 'user';

  const [section, setSection] = useState<NavSection>('dashboard');
  const [pinnedAppIds, setPinnedAppIds] = useState<NavSection[]>(() => loadPinnedApps());
  const [appShortcuts, setAppShortcuts] = useState<AppShortcutMap>(() => loadAppShortcuts(userKey));
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [draggedPinId, setDraggedPinId] = useState<NavSection | null>(null);
  const [dragOverPinId, setDragOverPinId] = useState<NavSection | null>(null);
  const [preselectedMessageNoteId, setPreselectedMessageNoteId] = useState<number | null>(
    null
  );
  const [switchModalOpen, setSwitchModalOpen] = useState(false);
  const [permBusy, setPermBusy] = useState(false);
  const mainScrollRef = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(PINNED_APPS_STORAGE_KEY, JSON.stringify(pinnedAppIds));
    } catch {
      // ignore storage quota errors
    }
  }, [pinnedAppIds]);

  useEffect(() => {
    setAppShortcuts(loadAppShortcuts(userKey));
  }, [userKey]);

  useEffect(() => {
    const onShortcutUpdate = () => setAppShortcuts(loadAppShortcuts(userKey));
    window.addEventListener(SHORTCUT_UPDATED_EVENT, onShortcutUpdate);
    window.addEventListener('storage', onShortcutUpdate);
    return () => {
      window.removeEventListener(SHORTCUT_UPDATED_EVENT, onShortcutUpdate);
      window.removeEventListener('storage', onShortcutUpdate);
    };
  }, [userKey]);

  // Study Workspace State
  const [tasks, setTasks] = useState<StudyTask[]>([]);
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [notebooks, setNotebooks] = useState<StudyNotebook[]>([]);
  const [notePages, setNotePages] = useState<StudyNotePage[]>([]);
  const [exams, setExams] = useState<ExamScheduleItem[]>([]);
  const [countdowns, setCountdowns] = useState<ExamCountdownItem[]>([]);
  const [studyLogs, setStudyLogs] = useState<StudyLogItem[]>([]);
  const [studyMaterials, setStudyMaterials] = useState<StudyMaterialItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [messages, setMessages] = useState<InAppMessageItem[]>([]);
  const [toolUsers, setToolUsers] = useState<ToolUserSummary[]>([]);
  const [blueprints, setBlueprints] = useState<ExamBlueprintItem[]>([]);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  // Navbar Search & Bell Popover State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchCategory, setSearchCategory] = useState<SearchCategory>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  // Guard inaccessible routes when auth mode or role changes
  useEffect(() => {
    if (section === 'workspace' && !isWorkspaceEnabled) {
      setSection('dashboard');
    } else if (section === 'super' && !isSuper) {
      setSection('dashboard');
    } else if (section === 'admin' && !isAdmin) {
      setSection('dashboard');
    } else if (section === 'contributor-console' && !isApprovedContributor) {
      setSection('dashboard');
    }
  }, [section, isWorkspaceEnabled, isSuper, isAdmin, isApprovedContributor]);

  // Initialize Google Analytics 4 and record SPA section views
  const initialSectionRef = useRef(section);
  initialSectionRef.current = section;

  useEffect(() => {
    void initGoogleAnalytics().then((id) => {
      if (id) {
        const cur = initialSectionRef.current;
        trackGa4PageView(cur, `ASAN-Study_tool — ${SECTION_LABELS[cur]}`);
      }
    });
  }, []);

  useEffect(() => {
    trackGa4PageView(section, `ASAN-Study_tool — ${SECTION_LABELS[section]}`);
    mainScrollRef.current?.scrollTo({ top: 0 });
  }, [section]);

  useEffect(() => {
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      if (document.body.dataset.recordingShortcut === '1') return;
      if (switchModalOpen || Boolean(permissionStep)) return;
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;

      const combo = formatKeyboardEventCombo(e);
      if (!combo) return;

      let matched: NavSection | null = null;
      for (const [sec, assigned] of Object.entries(appShortcuts) as [NavSection, string | undefined][]) {
        if (assigned === combo) {
          matched = sec;
          break;
        }
      }
      if (!matched) return;

      if (matched === 'super' && !isSuper) return;
      if (matched === 'admin' && !isAdmin) return;
      if (matched === 'contributor-console' && !isApprovedContributor) return;
      if (matched === 'workspace' && !isWorkspaceEnabled) return;

      e.preventDefault();
      setSection(matched);
      setMobileMenuOpen(false);
      setBellOpen(false);
      setSearchOpen(false);
    };

    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, [
    appShortcuts,
    switchModalOpen,
    permissionStep,
    isSuper,
    isAdmin,
    isApprovedContributor,
    isWorkspaceEnabled,
  ]);

  const loadAllStudyData = useCallback(async () => {
    if (isGuest) {
      const guest = loadGuestWorkspace();
      const serverCountdowns = await apiOptionalAuthFetch<ExamCountdownItem[]>(
        '/api/countdowns'
      ).catch(() => []);
      setTasks(guest.tasks);
      setEvents(guest.events);
      setNotebooks(guest.notebooks);
      setNotePages(guest.notePages);
      setExams(guest.exams);
      setCountdowns([...serverCountdowns, ...(guest.countdowns || [])]);
      setStudyLogs(guest.studyLogs);
      setStudyMaterials([]);
      setNotifications([]);
      setMessages([]);
      setToolUsers([]);
      setBlueprints([]);
      setUnreadNotifCount(0);
      setDataError(null);
      return;
    }

    if (!dbUser) return;
    setDataLoading(true);
    setDataError(null);
    try {
      const [
        tasksRes,
        eventsRes,
        nbRes,
        examsRes,
        countdownsRes,
        logsRes,
        matRes,
        notifRes,
        msgRes,
        usersRes,
        bpRes,
      ] = await Promise.all([
        apiFetch<StudyTask[]>('/api/tasks'),
        apiFetch<CalendarEventItem[]>('/api/events'),
        apiFetch<{ notebooks: StudyNotebook[]; pages: StudyNotePage[] }>('/api/notebooks'),
        apiFetch<ExamScheduleItem[]>('/api/exams'),
        apiOptionalAuthFetch<ExamCountdownItem[]>('/api/countdowns').catch(() => []),
        apiFetch<StudyLogItem[]>('/api/study-logs'),
        apiFetch<{ materials: StudyMaterialItem[] }>('/api/study-materials').catch(() => ({
          materials: [],
        })),
        apiFetch<NotificationItem[]>('/api/notifications').catch(() => []),
        apiFetch<InAppMessageItem[]>('/api/messages').catch(() => []),
        apiFetch<ToolUserSummary[]>('/api/tool-users').catch(() => []),
        apiFetch<ExamBlueprintItem[]>('/api/exam-blueprints').catch(() => []),
      ]);
      setTasks(tasksRes);
      setEvents(eventsRes);
      setNotebooks(nbRes.notebooks);
      setNotePages(nbRes.pages);
      setExams(examsRes);
      setCountdowns(countdownsRes);
      setStudyLogs(logsRes);
      setStudyMaterials(matRes.materials || []);
      setNotifications(notifRes);
      setMessages(msgRes);
      setToolUsers(usersRes);
      setBlueprints(bpRes);
      setUnreadNotifCount(notifRes.filter((n) => !n.isRead).length);
    } catch (err) {
      setDataError(
        err instanceof Error ? err.message : 'Unable to sync study data from database'
      );
    } finally {
      setDataLoading(false);
    }
  }, [dbUser, isGuest]);

  useEffect(() => {
    if (dbUser || isGuest) {
      void loadAllStudyData();
    }
  }, [dbUser, isGuest, loadAllStudyData]);

  useForumSocket({
    enabled: !isGuest && Boolean(dbUser),
    activeRoomId: null,
    onEvent: (evt) => {
      if (evt.type === 'mail:new') {
        setMessages((prev) => (prev.some((m) => m.id === evt.message.id) ? prev : [evt.message, ...prev]));
      } else if (evt.type === 'points:updated' && dbUser && evt.userId === dbUser.id) {
        void refreshProfile();
      }
    },
  });

  // Close navbar popovers on outside click
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Advanced unified search index across all workspace data, notes content, mail, blueprints & users
  const searchResults = useMemo<SearchResultItem[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const results: SearchResultItem[] = [];

    (Object.keys(SECTION_LABELS) as NavSection[]).forEach((secId) => {
      if (secId === 'super' && !isSuper) return;
      if (secId === 'admin' && !isAdmin) return;
      if (secId === 'contributor-console' && !isApprovedContributor) return;
      if (secId === 'workspace' && !isWorkspaceEnabled) return;
      const label = SECTION_LABELS[secId];
      if (label.toLowerCase().includes(q) || secId.toLowerCase().includes(q)) {
        results.push({
          id: `sec-${secId}`,
          title: label,
          subtitle: 'App Section',
          section: secId,
          categoryKey: 'sections',
        });
      }
    });

    notebooks.forEach((nb) => {
      if (
        nb.title.toLowerCase().includes(q) ||
        nb.subject.toLowerCase().includes(q)
      ) {
        results.push({
          id: `nb-${nb.id}`,
          title: nb.title,
          subtitle: `Notebook · ${nb.subject}`,
          section: 'notes',
          categoryKey: 'notes',
        });
      }
    });

    notePages.forEach((p) => {
      const titleMatch =
        p.title.toLowerCase().includes(q) ||
        p.sectionName.toLowerCase().includes(q);
      let blockSnippet: string | undefined;
      if (Array.isArray(p.pagesData)) {
        for (const page of p.pagesData) {
          if (page.title && page.title.toLowerCase().includes(q)) {
            blockSnippet = `Page ${page.pageNumber}: ${page.title}`;
            break;
          }
          for (const block of page.blocks || []) {
            if (
              block.type !== 'image' &&
              block.content &&
              block.content.toLowerCase().includes(q)
            ) {
              blockSnippet = `Page ${page.pageNumber}: ${buildSnippet(block.content, q)}`;
              break;
            }
          }
          if (blockSnippet) break;
        }
      }
      if (titleMatch || blockSnippet) {
        results.push({
          id: `note-${p.id}`,
          title: p.title,
          subtitle: `A4 Note · ${p.sectionName}`,
          snippet: blockSnippet,
          section: 'notes',
          categoryKey: 'notes',
        });
      }
    });

    blueprints.forEach((bp) => {
      const syllabusText = Array.isArray(bp.syllabus) ? bp.syllabus.join(', ') : '';
      const haystack = `${bp.subject} ${bp.paperCode} ${bp.examType} ${syllabusText}`.toLowerCase();
      if (haystack.includes(q)) {
        results.push({
          id: `bp-${bp.id}`,
          title: `${bp.subject} (${bp.paperCode})`,
          subtitle: `Exam Master · ${bp.examType} · ${bp.examDate || 'Scheduled'}`,
          snippet: syllabusText.toLowerCase().includes(q)
            ? buildSnippet(syllabusText, q)
            : undefined,
          section: 'calendar',
          categoryKey: 'notes',
        });
      }
    });

    studyMaterials.forEach((m) => {
      const haystack = `${m.title} ${m.subject} ${m.fileName} ${m.uploaderName} ${m.category}`.toLowerCase();
      if (haystack.includes(q)) {
        results.push({
          id: `mat-${m.id}`,
          title: m.title,
          subtitle: `Study Material · ${m.subject} · by ${m.uploaderName}`,
          snippet: m.fileName,
          section: 'study-materials',
          categoryKey: 'notes',
        });
      }
    });

    tasks.forEach((t) => {
      const haystack = `${t.title} ${t.subject} ${t.description} ${t.priority} ${t.status} ${t.dueDate}`.toLowerCase();
      if (haystack.includes(q)) {
        results.push({
          id: `task-${t.id}`,
          title: t.title,
          subtitle: `Task · ${t.subject} · ${t.status.replace('_', ' ')} (${t.priority})`,
          snippet:
            t.description && t.description.toLowerCase().includes(q)
              ? buildSnippet(t.description, q)
              : t.dueDate
                ? `Due ${t.dueDate}`
                : undefined,
          section: 'tasks',
          categoryKey: 'tasks_cal',
        });
      }
    });

    events.forEach((ev) => {
      const haystack = `${ev.title} ${ev.category} ${ev.notes} ${ev.eventDate} ${ev.eventTime}`.toLowerCase();
      if (haystack.includes(q)) {
        results.push({
          id: `ev-${ev.id}`,
          title: ev.title,
          subtitle: `Calendar · ${ev.eventDate} ${ev.eventTime || ''} · ${ev.category}`,
          snippet:
            ev.notes && ev.notes.toLowerCase().includes(q)
              ? buildSnippet(ev.notes, q)
              : undefined,
          section: 'calendar',
          categoryKey: 'tasks_cal',
        });
      }
    });

    exams.forEach((ex) => {
      const haystack = `${ex.subject} ${ex.examType} ${ex.customExamType} ${ex.paperName} ${ex.seatingTime}`.toLowerCase();
      if (haystack.includes(q)) {
        results.push({
          id: `exam-${ex.id}`,
          title: `${ex.subject} (${ex.examType === 'Other' ? ex.customExamType : ex.examType})`,
          subtitle: `Exam Timer · ${ex.writingMinutes}m writing${ex.paperName ? ` · ${ex.paperName}` : ''}`,
          section: 'timers',
          categoryKey: 'tasks_cal',
        });
      }
    });

    studyLogs.forEach((log) => {
      if (
        log.label.toLowerCase().includes(q) ||
        log.mode.toLowerCase().includes(q)
      ) {
        results.push({
          id: `log-${log.id}`,
          title: log.label || 'Focus Session',
          subtitle: `Study Log · ${log.mode} · ${Math.round(log.durationSeconds / 60)}m`,
          section: 'timers',
          categoryKey: 'tasks_cal',
        });
      }
    });

    messages.forEach((msg) => {
      const haystack = `${msg.subject} ${msg.body} ${msg.senderUsername} ${msg.senderEmail} ${msg.recipientSummary} ${msg.attachmentTitle}`.toLowerCase();
      if (haystack.includes(q)) {
        results.push({
          id: `msg-${msg.id}`,
          title: msg.subject || '(No Subject)',
          subtitle: `Tool Mail · @${msg.senderUsername || msg.senderEmail} -> ${msg.recipientSummary || msg.visibility}`,
          snippet: msg.body ? buildSnippet(msg.body, q) : undefined,
          section: 'messages',
          categoryKey: 'mail_alerts',
        });
      }
    });

    notifications.forEach((n) => {
      const haystack = `${n.title} ${n.message} ${n.senderLabel} ${n.type}`.toLowerCase();
      if (haystack.includes(q)) {
        results.push({
          id: `notif-${n.id}`,
          title: n.title,
          subtitle: `Notification · ${n.senderLabel}`,
          snippet: n.message ? buildSnippet(n.message, q) : undefined,
          section: 'notifications',
          categoryKey: 'mail_alerts',
        });
      }
    });

    toolUsers.forEach((u) => {
      const haystack = `${u.displayName} ${u.username} ${u.shortUid} ${u.email} ${u.role}`.toLowerCase();
      if (haystack.includes(q)) {
        results.push({
          id: `user-${u.id}`,
          title: `${u.displayName} (@${u.username})`,
          subtitle: `User · UID ${u.shortUid} · ${u.role.toUpperCase()}`,
          snippet: u.email,
          section: 'messages',
          categoryKey: 'users',
        });
      }
    });

    return results;
  }, [
    searchQuery,
    isSuper,
    isAdmin,
    isApprovedContributor,
    isWorkspaceEnabled,
    notebooks,
    notePages,
    blueprints,
    studyMaterials,
    tasks,
    events,
    exams,
    studyLogs,
    messages,
    notifications,
    toolUsers,
  ]);

  const filteredSearchResults = useMemo(() => {
    const base =
      searchCategory === 'all'
        ? searchResults
        : searchResults.filter((r) => r.categoryKey === searchCategory);
    return base.slice(0, 18);
  }, [searchResults, searchCategory]);

  if (loading) {
    return (
      <TechnicalLoadingScreen>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm text-center space-y-3">
          <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
            Please wait while we load your account data.
          </p>
          <button
            type="button"
            onClick={continueFreeGuest}
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            Continue Without Sign In
          </button>
        </div>
      </TechnicalLoadingScreen>
    );
  }

  if (!hasSessionToken && !isGuest) {
    return <AuthGate />;
  }

  // Wait cleanly for account data hydration without showing a partial Free/Basic state or mentioning backend internals
  if (!isGuest && hasSessionToken && !dbUser) {
    const isDelayedWake =
      dbStatus === 'connecting' || dbStatus === 'offline' || dbWaitSeconds >= 2;
    return (
      <TechnicalLoadingScreen>
        {isDelayedWake ? (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4 text-slate-900 dark:text-slate-100">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 border border-sky-100 dark:border-sky-800">
                {dbStatus === 'offline' ? (
                  <WifiOff className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                ) : (
                  <UserCheck className="h-5 w-5" />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                  Account Sync
                </div>
                <h1 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  {dbStatus === 'offline'
                    ? 'You Appear to Be Offline'
                    : 'Please Wait While We Load Your Account Data'}
                </h1>
              </div>
            </div>

            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {dbStatus === 'offline'
                ? 'An active connection is needed to restore your Pro plan, points, and roles, or you can continue offline without sign in.'
                : 'Please wait while we load your account data so your Pro plan, points balance, and workspace access appear accurately.'}
            </p>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-3 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-600 dark:text-slate-300">1. Sign-In Session</span>
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Verified{firebaseUser?.email ? ` (${firebaseUser.email})` : ''}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-600 dark:text-slate-300">2. Account Profile &amp; Plan</span>
                <span className="inline-flex items-center gap-1.5 font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {dbStatus === 'offline'
                    ? 'Offline'
                    : `Loading${dbWaitSeconds > 0 ? ` (${dbWaitSeconds}s)` : '...'}`}
                </span>
              </div>
              {authError && !authError.toLowerCase().includes('database') && !authError.toLowerCase().includes('postgres') && (
                <div className="border-t border-slate-200 dark:border-slate-700 pt-2 text-[11px] text-slate-500 dark:text-slate-400">
                  {authError}
                  {dbRetryCount > 0 ? ` · Attempt #${dbRetryCount}` : ''}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => void retryDbConnection()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-sky-700"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry Sync
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={continueFreeGuest}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  Continue Without Sign In
                </button>
                <button
                  type="button"
                  onClick={() => void signOutUser()}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  Sign Out
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm text-center space-y-3">
            <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Please wait while we load your account data.
            </p>
            <button
              type="button"
              onClick={continueFreeGuest}
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              Continue Without Sign In
            </button>
          </div>
        )}
      </TechnicalLoadingScreen>
    );
  }

  const handleNavClick = (id: NavSection) => {
    setSection(id);
    setMobileMenuOpen(false);
    setBellOpen(false);
    setSearchOpen(false);
  };

  const availableTools = ALL_TOOLS_CATALOG.filter(
    (item) => isWorkspaceEnabled || item.id !== 'workspace'
  );
  // Preserve exact user-dragged order stored in pinnedAppIds
  const pinnedTools = pinnedAppIds
    .map((id) => availableTools.find((item) => item.id === id))
    .filter((item): item is AppCatalogEntry => Boolean(item));

  const togglePinnedApp = (id: NavSection) => {
    setPinnedAppIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const reorderPinnedApps = (sourceId: NavSection, targetId: NavSection) => {
    if (sourceId === targetId) return;
    setPinnedAppIds((prev) => {
      const fromIdx = prev.indexOf(sourceId);
      const toIdx = prev.indexOf(targetId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  const movePinnedApp = (id: NavSection, dir: -1 | 1) => {
    setPinnedAppIds((prev) => {
      const idx = prev.indexOf(id);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.splice(target, 0, moved);
      return next;
    });
  };

  const renderSidebarContent = () => (
    <div className="flex h-full w-64 flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800">
      <div className="shrink-0 px-4 pt-5 pb-3">
        <div className="flex items-center justify-between gap-2 px-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src="/pwa-192x192.png"
              alt="ASAN-Study_tool"
              className="h-7 w-7 rounded-md object-cover shadow-xs shrink-0"
            />
            <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap truncate">
              ASAN-Study_tool
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setDesktopSidebarOpen(false);
              setMobileMenuOpen(false);
            }}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors shrink-0"
          >
            <PanelLeftClose className="h-4 w-4 hidden lg:block" />
            <X className="h-4 w-4 lg:hidden" />
          </button>
        </div>
      </div>

      <nav
        className="asan-scroll flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-1 space-y-1"
        aria-label="Main navigation"
      >
          {/* Always present: Dashboard & All Apps */}
          <button
            type="button"
            onClick={() => handleNavClick('dashboard')}
            className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
              section === 'dashboard'
                ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <span className="flex items-center gap-3 min-w-0">
              <LayoutDashboard
                className={`h-4 w-4 shrink-0 ${
                  section === 'dashboard' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'
                }`}
              />
              <span className="truncate">Dashboard</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleNavClick('all-apps')}
            className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
              section === 'all-apps'
                ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <span className="flex items-center gap-3 min-w-0">
              <LayoutGrid
                className={`h-4 w-4 shrink-0 ${
                  section === 'all-apps' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'
                }`}
              />
              <span className="truncate">All Apps</span>
            </span>
            <span className="text-[10px] font-medium text-slate-400 tabular-nums">
              {pinnedTools.length}/{availableTools.length}
            </span>
          </button>

          {pinnedTools.length > 0 && (
            <div className="pt-2 pb-1 px-3 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              <span>Pinned Apps</span>
            </div>
          )}

          {pinnedTools.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            const locked = Boolean(item.proOnly && !isProOrAdmin);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                className={`group flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      active ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'
                    }`}
                  />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.id === 'notifications' && unreadNotifCount > 0 && (
                  <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white tabular-nums">
                    {unreadNotifCount}
                  </span>
                )}
                {item.proOnly && (
                  <span
                    className={
                      locked
                        ? 'text-[10px] font-semibold text-indigo-500 dark:text-indigo-400'
                        : 'asan-pro-badge rounded px-1.5 py-0.5 text-[9px]'
                    }
                  >
                    PRO
                  </span>
                )}
              </button>
            );
          })}

          {isApprovedContributor && (
            <button
              type="button"
              onClick={() => handleNavClick('contributor-console')}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                section === 'contributor-console'
                  ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-emerald-50/60 dark:hover:bg-emerald-950/30 hover:text-emerald-900 dark:hover:text-emerald-200'
              }`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <FolderUp
                  className={`h-4 w-4 shrink-0 ${
                    section === 'contributor-console'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                />
                <span className="truncate">Contributors&apos; Console</span>
              </span>
            </button>
          )}

          {isSuper && (
            <button
              type="button"
              onClick={() => handleNavClick('super')}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                section === 'super'
                  ? 'bg-violet-50 text-violet-900 dark:bg-violet-950/60 dark:text-violet-300'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-violet-50/70 dark:hover:bg-violet-950/30 hover:text-violet-900 dark:hover:text-violet-200'
              }`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <Crown
                  className={`h-4 w-4 shrink-0 ${
                    section === 'super' ? 'text-violet-700 dark:text-violet-400' : 'text-violet-600 dark:text-violet-400'
                  }`}
                />
                <span className="truncate">Super Console</span>
              </span>
              <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400">
                SUPER
              </span>
            </button>
          )}

          {isAdmin && (
            <button
              type="button"
              onClick={() => handleNavClick('admin')}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                section === 'admin'
                  ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-amber-50/60 dark:hover:bg-amber-950/30 hover:text-amber-900 dark:hover:text-amber-200'
              }`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <ShieldCheck
                  className={`h-4 w-4 shrink-0 ${
                    section === 'admin' ? 'text-amber-700 dark:text-amber-400' : 'text-amber-600 dark:text-amber-400'
                  }`}
                />
                <span className="truncate">Admin Console</span>
              </span>
            </button>
          )}
        </nav>

      <div className="shrink-0 space-y-3 border-t border-slate-100 dark:border-slate-800 px-4 pt-3 pb-4">
        <nav className="space-y-1" aria-label="Information navigation">
          {SECONDARY_NAV.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={toggleTheme}
            className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            <span className="flex items-center gap-3">
              {theme === 'dark' ? (
                <Sun className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              ) : (
                <Moon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
              )}
              <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
            </span>
            <span className="text-[10px] uppercase tracking-wider text-slate-400">
              {theme === 'dark' ? 'ON' : 'OFF'}
            </span>
          </button>
        </nav>

        {isGuest ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                Free Tier (Local)
              </div>
              <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                10 Notes · 150 Tasks max
              </div>
            </div>
            <button
              type="button"
              onClick={exitGuestToSignIn}
              title="Sign in with Google or Password"
              aria-label="Sign in"
              className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700 shrink-0"
            >
              <LogIn className="h-3 w-3" />
              Sign In
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                {dbUser && (
                  <UserAvatarBadge
                    name={dbUser.displayName || firebaseUser?.displayName || 'Student'}
                    photoUrl={dbUser.photoUrl}
                    plan={dbUser.plan}
                    role={dbUser.role}
                    contributorApproved={dbUser.contributorApproved}
                    size="sm"
                  />
                )}
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {dbUser?.displayName || firebaseUser?.displayName || 'Student'}
                  </div>
                  <div className="truncate text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                    {dbUser?.shortUid ? `${dbUser.shortUid} · ` : ''}
                    {effectivePlan.toUpperCase()}
                    {isSuper ? ' · SUPER' : dbUser?.role === 'admin' ? ' · ADMIN' : ''}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setSwitchModalOpen(true)}
                  title="Switch Account"
                  aria-label="Switch Account"
                  className="rounded-md p-1.5 text-slate-500 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-700 hover:text-blue-600 dark:hover:text-blue-400"
                >
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={signOutUser}
                  title="Sign out"
                  aria-label="Sign out"
                  className="rounded-md p-1.5 text-slate-500 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-700 hover:text-red-600 dark:hover:text-red-400"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 border-t border-slate-200/70 dark:border-slate-700 pt-1.5">
              <span className="truncate">
                @{dbUser?.username} ·{' '}
                {authMode === 'password' ? 'Password Auth' : 'Google Auth'}
              </span>
              <button
                type="button"
                onClick={() => setSwitchModalOpen(true)}
                className="font-semibold text-blue-600 dark:text-blue-400 hover:underline shrink-0 ml-2"
              >
                Switch
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="asan-app-shell h-dvh w-full bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 flex overflow-hidden">
      {/* Smooth Collapsible Desktop Sidebar */}
      <aside
        className={`no-print hidden lg:block shrink-0 h-full overflow-hidden transition-[width,opacity] duration-300 ease-in-out ${
          desktopSidebarOpen ? 'w-64 opacity-100' : 'w-0 opacity-0'
        }`}
        aria-hidden={!desktopSidebarOpen}
      >
        {renderSidebarContent()}
      </aside>

      {/* Smooth Slide-In Mobile Drawer (mounted for transitions) */}
      <div
        className={`no-print fixed inset-0 z-50 flex lg:hidden transition-opacity duration-300 ease-out ${
          mobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden={!mobileMenuOpen}
      >
        <div
          className="fixed inset-0 bg-slate-900/45 backdrop-blur-[1px] transition-opacity duration-300"
          onClick={() => setMobileMenuOpen(false)}
        />
        <div
          className={`relative z-10 w-64 h-full transition-transform duration-300 ease-out ${
            mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {renderSidebarContent()}
        </div>
      </div>

      {/* Main Content Shell */}
      <div className="flex flex-1 flex-col min-w-0 min-h-0 h-full overflow-hidden">
        {/* Top Navbar: Breadcrumb | Advanced Search | Theme Toggle + Notifications + Switch/Plan */}
        <header className="no-print shrink-0 z-30 flex flex-wrap items-center justify-between gap-2 sm:gap-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 sm:px-6 py-2.5 sm:py-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="lg:hidden rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 text-slate-700 dark:text-slate-200 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => setDesktopSidebarOpen((v) => !v)}
              className="hidden lg:inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 text-slate-700 dark:text-slate-200 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
              title={desktopSidebarOpen ? 'Hide Sidebar' : 'Show Sidebar'}
              aria-label={desktopSidebarOpen ? 'Hide Sidebar' : 'Show Sidebar'}
            >
              {desktopSidebarOpen ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeftOpen className="h-4 w-4" />
              )}
            </button>
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 truncate">
              <img
                src="/pwa-192x192.png"
                alt=""
                className="hidden sm:block h-6 w-6 rounded-md object-cover shrink-0"
              />
              <span className="font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">
                ASAN-Study_tool
              </span>
              <span aria-hidden="true">/</span>
              <span className="font-semibold text-slate-900 dark:text-white truncate">
                {SECTION_LABELS[section]}
              </span>
            </div>
          </div>

          {/* Center Advanced Global Search */}
          <div ref={searchRef} className="relative flex-1 max-w-lg min-w-0">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchQuery}
                onFocus={() => setSearchOpen(true)}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setSearchOpen(false);
                  } else if (e.key === 'Enter' && filteredSearchResults.length > 0) {
                    e.preventDefault();
                    handleNavClick(filteredSearchResults[0].section);
                    setSearchQuery('');
                  }
                }}
                placeholder="Search notes, tasks, mail, @users, UID..."
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pl-9 pr-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white dark:focus:bg-slate-800 focus:outline-none"
              />
            </div>

            {searchOpen && searchQuery.trim().length > 0 && (
              <div className="fixed inset-x-3 top-14 sm:absolute sm:inset-x-auto sm:left-0 sm:right-0 sm:top-full mt-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg overflow-hidden z-40">
                <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 px-3 py-2 text-[11px]">
                  {(
                    [
                      { id: 'all', label: `All (${searchResults.length})` },
                      { id: 'notes', label: 'Notes & Materials' },
                      { id: 'tasks_cal', label: 'Tasks & Exams' },
                      { id: 'mail_alerts', label: 'Mail & Alerts' },
                      { id: 'users', label: 'Users' },
                      { id: 'sections', label: 'Sections' },
                    ] as const
                  ).map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSearchCategory(cat.id)}
                      className={`rounded-md px-2 py-1 font-medium transition-colors ${
                        searchCategory === cat.id
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                {filteredSearchResults.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                    No matching items found for &ldquo;{searchQuery}&rdquo; in this category.
                  </div>
                ) : (
                  <div className="asan-scroll divide-y divide-slate-100 dark:divide-slate-800 max-h-80 overflow-y-auto overscroll-contain">
                    {filteredSearchResults.map((res) => (
                      <button
                        key={res.id}
                        type="button"
                        onClick={() => {
                          handleNavClick(res.section);
                          setSearchQuery('');
                        }}
                        className="flex w-full items-start justify-between gap-2 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                            {res.title}
                          </div>
                          <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                            {res.subtitle}
                          </div>
                          {res.snippet && (
                            <div className="truncate text-[11px] text-blue-700/90 dark:text-blue-400">
                              {res.snippet}
                            </div>
                          )}
                        </div>
                        <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400 shrink-0 pt-0.5">
                          Open
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: Theme Toggle + Notification Bell + Switch + Points/Plan CTA */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-slate-600 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              {theme === 'dark' ? (
                <Sun className="h-4 w-4 text-amber-400" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>

            <div ref={bellRef} className="relative">
              <button
                type="button"
                onClick={() => setBellOpen((v) => !v)}
                aria-label="Notifications"
                className="relative rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-slate-600 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900"
              >
                <Bell className="h-4 w-4" />
                {unreadNotifCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white tabular-nums">
                    {unreadNotifCount}
                  </span>
                )}
              </button>

              {bellOpen && (
                <div className="fixed inset-x-3 top-14 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full mt-2 sm:w-80 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg z-40 overflow-hidden">
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-4 py-2.5">
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Notifications
                    </span>
                    <button
                      type="button"
                      onClick={() => handleNavClick('notifications')}
                      className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Send / View All
                    </button>
                  </div>
                  {isGuest ? (
                    <div className="p-4 text-xs text-slate-500 dark:text-slate-400 space-y-2">
                      <p>Sign in to send and receive real-time study notifications.</p>
                      <button
                        type="button"
                        onClick={exitGuestToSignIn}
                        className="rounded-md bg-blue-600 px-3 py-1.5 text-[11px] font-medium text-white"
                      >
                        Sign in
                      </button>
                    </div>
                  ) : notifications.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-500 dark:text-slate-400">
                      No notifications yet.
                    </div>
                  ) : (
                    <div className="asan-scroll divide-y divide-slate-100 dark:divide-slate-800 max-h-64 overflow-y-auto overscroll-contain">
                      {notifications.slice(0, 6).map((n) => (
                        <div key={n.id} className="px-4 py-2.5 space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                              {n.title}
                            </span>
                            {!n.isRead && (
                              <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 shrink-0">
                                New
                              </span>
                            )}
                          </div>
                          <p className="line-clamp-2 text-[11px] text-slate-600 dark:text-slate-400">
                            {n.message}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <PWAInstallButton />

            {!isGuest &&
              dbUser?.viewPlanMode === 'basic' &&
              dbUser.plan !== 'pro' &&
              isAdmin && (
                <button
                  type="button"
                  onClick={() => setViewPlanMode('auto')}
                  className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 px-2.5 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-100 whitespace-nowrap shrink-0"
                >
                  Basic Preview · Exit
                </button>
              )}

            {isGuest ? (
              <button
                type="button"
                onClick={exitGuestToSignIn}
                className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
              >
                Free Tier · Sign In
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setSwitchModalOpen(true)}
                  title="Switch Account"
                  className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
                >
                  <ArrowRightLeft className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                  Switch
                </button>
                <button
                  type="button"
                  onClick={() => handleNavClick('subscriptions')}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap shrink-0 tabular-nums"
                >
                  {dbUser && (
                    <UserAvatarBadge
                      name={dbUser.displayName}
                      photoUrl={dbUser.photoUrl}
                      plan={dbUser.plan}
                      role={dbUser.role}
                      contributorApproved={dbUser.contributorApproved}
                      size="sm"
                    />
                  )}
                  <span>
                    {dbUser?.points ?? 0} pts · {effectivePlan.toUpperCase()}
                    {dbUser?.shortUid ? ` · ${dbUser.shortUid}` : ''}
                  </span>
                </button>
              </>
            )}
          </div>
        </header>

        <main
          ref={mainScrollRef}
          className="asan-main-scroll asan-scroll flex-1 min-h-0 overflow-y-auto overscroll-y-contain"
        >
          <div className="p-3 sm:p-5 lg:p-8 max-w-[1440px] w-full mx-auto">
          {(dbStatus === 'connecting' || dataError) && (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 px-4 py-3 text-xs text-amber-900 dark:text-amber-200">
              <div className="flex items-center gap-2.5 min-w-0">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-600 dark:text-amber-400" />
                <span>
                  {dbStatus === 'connecting'
                    ? `Please wait while we load your account data${dbWaitSeconds > 0 ? ` (${dbWaitSeconds}s)` : ''}...`
                    : dataError}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    void retryDbConnection();
                    void loadAllStudyData();
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-slate-800 shrink-0"
                >
                  <RefreshCw className="h-3 w-3" />
                  Retry Sync
                </button>
                {!isGuest && (
                  <button
                    type="button"
                    onClick={continueFreeGuest}
                    className="rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-amber-100 dark:hover:bg-slate-800 shrink-0"
                  >
                    Continue Without Sign In
                  </button>
                )}
              </div>
            </div>
          )}

          {dataLoading && tasks.length === 0 && notePages.length === 0 ? (
            <div className="space-y-4">
              <div className="h-10 w-64 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                <div className="h-24 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
                <div className="h-24 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
                <div className="h-24 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
                <div className="h-24 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
              </div>
            </div>
          ) : (
            <>
              {section === 'dashboard' && (
                <DashboardView
                  dbUser={dbUser}
                  tasks={tasks}
                  events={events}
                  notebooks={notebooks}
                  notePages={notePages}
                  exams={exams}
                  countdowns={countdowns}
                  studyLogs={studyLogs}
                  onNavigate={setSection}
                />
              )}
              {section === 'all-apps' && (
                <div className="space-y-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
                        All Apps &amp; Sidebar Pins
                      </h1>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Browse every tool in ASAN-Study_tool, pin any number of apps, and drag or reorder how they appear in your sidebar.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-medium text-slate-600 dark:text-slate-300 tabular-nums mr-1">
                        {pinnedTools.length} of {availableTools.length} pinned
                      </span>
                      <button
                        type="button"
                        onClick={() => handleNavClick('plans')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                      >
                        <Keyboard className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                        App Shortcuts
                      </button>
                      <button
                        type="button"
                        onClick={() => setPinnedAppIds([...DEFAULT_PINNED_APPS])}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                      >
                        Reset Default
                      </button>
                      <button
                        type="button"
                        onClick={() => setPinnedAppIds(availableTools.map((t) => t.id))}
                        className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 px-3 py-1.5 font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100"
                      >
                        Pin All
                      </button>
                      <button
                        type="button"
                        onClick={() => setPinnedAppIds([])}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                      >
                        Unpin All
                      </button>
                    </div>
                  </div>

                  {pinnedTools.length > 0 && (
                    <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2.5 asan-card-hover">
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          Sidebar Order (Drag &amp; Drop or Reorder)
                        </h2>
                        <span className="text-[11px] text-slate-400">
                          Matches your left sidebar top-to-bottom
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {pinnedTools.map((tool, idx) => {
                          const Icon = tool.icon;
                          return (
                            <div
                              key={`order-${tool.id}`}
                              draggable
                              onDragStart={(e) => {
                                setDraggedPinId(tool.id);
                                e.dataTransfer.effectAllowed = 'move';
                              }}
                              onDragOver={(e) => {
                                e.preventDefault();
                                if (draggedPinId && draggedPinId !== tool.id) {
                                  setDragOverPinId(tool.id);
                                }
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                if (draggedPinId) reorderPinnedApps(draggedPinId, tool.id);
                                setDraggedPinId(null);
                                setDragOverPinId(null);
                              }}
                              onDragEnd={() => {
                                setDraggedPinId(null);
                                setDragOverPinId(null);
                              }}
                              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium cursor-grab transition-all ${
                                dragOverPinId === tool.id
                                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/60'
                                  : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-slate-800 dark:text-slate-200'
                              }`}
                            >
                              <GripVertical className="h-3.5 w-3.5 text-slate-400" />
                              <Icon className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                              <span>{tool.label}</span>
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => movePinnedApp(tool.id, -1)}
                                aria-label={`Move ${tool.label} earlier`}
                                className="rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30"
                              >
                                <ArrowUp className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === pinnedTools.length - 1}
                                onClick={() => movePinnedApp(tool.id, 1)}
                                aria-label={`Move ${tool.label} later`}
                                className="rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30"
                              >
                                <ArrowDown className="h-3 w-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {(
                    [
                      'Core Study Workspace',
                      'Community & Account',
                      'Pro & Extended Tools',
                    ] as const
                  ).map((category) => {
                    const groupItems = availableTools.filter((t) => t.category === category);
                    if (groupItems.length === 0) return null;
                    return (
                      <section key={category} className="space-y-3">
                        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          {category}
                        </h2>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          {groupItems.map((tool) => {
                            const Icon = tool.icon;
                            const isPinned = pinnedAppIds.includes(tool.id);
                            const isLocked = Boolean(tool.proOnly && !isProOrAdmin);
                            return (
                              <div
                                key={tool.id}
                                className={`flex flex-col justify-between rounded-xl border p-4 asan-card-hover ${
                                  tool.proOnly
                                    ? 'asan-pro-card border-indigo-200 dark:border-indigo-800/70'
                                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                                }`}
                              >
                                <div className="space-y-2">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      <div
                                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                                          tool.proOnly
                                            ? 'border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-300'
                                            : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-blue-600 dark:text-blue-400'
                                        }`}
                                      >
                                        <Icon className="h-4 w-4" />
                                      </div>
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-1.5">
                                          <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                            {tool.label}
                                          </span>
                                          {tool.proOnly && (
                                            <span className="asan-pro-badge rounded px-1.5 py-0.5 text-[9px] shrink-0">
                                              PRO
                                            </span>
                                          )}
                                        </div>
                                        {tool.proOnly && (
                                          <div className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400">
                                            {isLocked ? 'Pro Plan Feature' : 'Pro Unlocked'}
                                          </div>
                                        )}
                                        {tool.id === 'spectra' && (
                                          <div className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                                            Under Development
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                    {tool.id === 'notifications' && unreadNotifCount > 0 && (
                                      <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 tabular-nums shrink-0">
                                        {unreadNotifCount} unread
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                                    {tool.description}
                                  </p>
                                </div>

                                <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800 pt-3">
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleNavClick(tool.id)}
                                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white ${
                                        tool.proOnly
                                          ? 'bg-indigo-600 hover:bg-indigo-700'
                                          : 'bg-blue-600 hover:bg-blue-700'
                                      }`}
                                    >
                                      Open App
                                    </button>
                                    {appShortcuts[tool.id] && (
                                      <kbd
                                        title="Assigned keyboard shortcut"
                                        className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600 dark:text-slate-300"
                                      >
                                        {appShortcuts[tool.id]}
                                      </kbd>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => togglePinnedApp(tool.id)}
                                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                                      isPinned
                                        ? 'border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 hover:bg-blue-100'
                                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                                    }`}
                                  >
                                    {isPinned ? (
                                      <>
                                        <PinOff className="h-3.5 w-3.5" />
                                        Pinned
                                      </>
                                    ) : (
                                      <>
                                        <Pin className="h-3.5 w-3.5" />
                                        Pin to Sidebar
                                      </>
                                    )}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}
              {section === 'calendar' && (
                <CalendarView
                  events={events}
                  tasks={tasks}
                  exams={exams}
                  onRefresh={loadAllStudyData}
                />
              )}
              {section === 'tasks' && (
                <TasksView tasks={tasks} onRefresh={loadAllStudyData} />
              )}
              {section === 'notes' && (
                <NotesView
                  notebooks={notebooks}
                  notePages={notePages}
                  onRefresh={loadAllStudyData}
                  onShareViaMessage={(docId) => {
                    setPreselectedMessageNoteId(docId);
                    setSection('messages');
                  }}
                />
              )}
              {section === 'timers' && (
                <TimersView
                  exams={exams}
                  countdowns={countdowns}
                  studyLogs={studyLogs}
                  onRefresh={loadAllStudyData}
                />
              )}
              {section === 'calculator' && <CasioFx82MsView />}
              {section === 'formula-calculator' && <FormulaCalculatorView />}
              {section === 'forum' && <ForumView />}
              {section === 'specialized-calculators' &&
                (isProOrAdmin ? (
                  <SpecializedCalculatorsView />
                ) : (
                  <ProGateCard
                    featureName="Specialized Math Calculators Suite"
                    description="Solve Calculus, Coordinate Geometry, Algebra, Vectors & 3D Geometry, and Trigonometry problems deterministically with step-by-step exact & numerical results. Available exclusively for Pro & Admin accounts."
                    onNavigate={setSection}
                  />
                ))}
              {section === 'messages' && (
                <MessagesView
                  notePages={notePages}
                  preselectedNoteId={preselectedMessageNoteId}
                />
              )}
              {section === 'study-materials' && <StudyMaterialView />}
              {section === 'contributor-console' && <ContributorConsoleView />}
              {section === 'subscriptions' && <SubscriptionsView />}
              {section === 'notifications' && (
                <NotificationsView onCountChange={setUnreadNotifCount} />
              )}
              {section === 'super' && isSuper && <SuperView />}
              {section === 'admin' && (
                <AdminView onRefreshCountdowns={loadAllStudyData} />
              )}
              {section === 'pdf-tool' &&
                (isProOrAdmin ? (
                  <PdfStudioView />
                ) : (
                  <ProGateCard
                    featureName="PDF Tool · A4 Booklet & Imposition Studio"
                    description="Create imposed Full, Half, and Quarter A4 booklets with clipboard image & 10pt text placeholders, Autocorrect, fold/cut guidelines, and direct PDF/PNG export. Excluded from Free & Basic plans."
                    onNavigate={setSection}
                  />
                ))}
              {section === 'workspace' &&
                isWorkspaceEnabled &&
                (isProOrAdmin ? (
                  <WorkspaceView tasks={tasks} events={events} exams={exams} />
                ) : (
                  <ProGateCard
                    featureName="Google Workspace (Opt-In Drive Folder & Sheets Sync)"
                    description="Connect your dedicated ASAN-user-content Google Drive folder, maintain schedules in Google Sheets, export Google Docs, and launch Google Meet rooms. Excluded from Free & Basic plans."
                    onNavigate={setSection}
                  />
                ))}
              {section === 'spectra' &&
                (isProOrAdmin ? (
                  <SpectraView />
                ) : (
                  <ProGateCard
                    featureName="Spectra AI (Under Development)"
                    description="Spectra AI is a Pro & Admin module currently under development."
                    onNavigate={setSection}
                  />
                ))}
              {section === 'more' && <MoreFeaturesView />}
              {section === 'plans' && <PlansView onNavigate={setSection} />}
              {section === 'about' && <AboutCreatorsView />}
              {section === 'contact' && <ContactView />}
            </>
          )}
          </div>
        </main>
      </div>

      {/* Sequential On-Login Permission Modal (One step at a time, singular site scope) */}
      {!isGuest && isWorkspaceEnabled && permissionStep && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-xl space-y-4">
            {permissionStep === 'drive' ? (
              <>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
                    <Cloud className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                      Step 1 · Google Drive Storage
                    </div>
                    <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                      Create an ASAN folder in Google Drive?
                    </h2>
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                  Do you want to make a Google Drive folder (<strong>ASAN-user-content</strong>) and store all the files you create using ASAN on your Drive within one folder?
                </p>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-[11px] text-slate-600 dark:text-slate-300">
                  We only request the single <code className="font-mono">drive.file</code> scope for this site so ASAN can access only the folder &amp; files it creates.
                </div>
                {authError && (
                  <div className="rounded-lg border border-red-200 dark:border-red-800/70 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                    {authError}
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    disabled={permBusy}
                    onClick={() => {
                      clearError();
                      skipPermissionStep();
                    }}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    Skip for Now
                  </button>
                  <button
                    type="button"
                    disabled={permBusy}
                    onClick={async () => {
                      clearError();
                      setPermBusy(true);
                      try {
                        await acceptDriveFolderPermissionStep();
                      } finally {
                        setPermBusy(false);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {permBusy ? 'Connecting...' : 'Allow & Create Folder'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                      Step 2 · Optional Workspace Sync
                    </div>
                    <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                      Enable Google Docs, Sheets &amp; Meet?
                    </h2>
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                  Do you want to authorize Google Docs, Sheets, and Meet for your Pro/Admin workspace (for Schedule Sheet sync, Study Note Doc exports, and study rooms)?
                </p>
                {authError && (
                  <div className="rounded-lg border border-red-200 dark:border-red-800/70 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                    {authError}
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    disabled={permBusy}
                    onClick={() => {
                      clearError();
                      skipPermissionStep();
                    }}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    No Thanks
                  </button>
                  <button
                    type="button"
                    disabled={permBusy}
                    onClick={async () => {
                      clearError();
                      setPermBusy(true);
                      try {
                        await acceptWorkspacePermissionStep();
                      } finally {
                        setPermBusy(false);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {permBusy ? 'Connecting...' : 'Connect Workspace'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Switch Account Modal */}
      {switchModalOpen && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  Switch Account
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSwitchModalOpen(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
                aria-label="Close switch account modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {dbUser && (
              <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/40 p-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <UserAvatarBadge
                    name={dbUser.displayName}
                    photoUrl={dbUser.photoUrl}
                    plan={dbUser.plan}
                    role={dbUser.role}
                    contributorApproved={dbUser.contributorApproved}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {dbUser.displayName} (Active)
                    </div>
                    <div className="truncate text-[11px] text-slate-600 dark:text-slate-400">
                      @{dbUser.username} · {dbUser.shortUid} ·{' '}
                      {authMode === 'password' ? 'Email/Password' : 'Google'}
                    </div>
                  </div>
                </div>
                {isWorkspaceEnabled && !dbUser.driveFolderId && (
                  <button
                    type="button"
                    onClick={() => {
                      setSwitchModalOpen(false);
                      openPermissionFlow();
                    }}
                    className="rounded-md border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-slate-700 shrink-0"
                  >
                    Link Drive
                  </button>
                )}
              </div>
            )}

            <div className="asan-scroll space-y-2 max-h-60 overflow-y-auto overscroll-contain">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Saved Accounts
              </div>
              {savedAccounts.filter((a) => a.uid !== dbUser?.uid).length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-2">
                  No other saved accounts on this browser yet. Sign into another Google or Email/Password account below.
                </p>
              ) : (
                savedAccounts
                  .filter((a) => a.uid !== dbUser?.uid)
                  .map((acc) => (
                    <div
                      key={acc.uid}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <button
                        type="button"
                        onClick={async () => {
                          setSwitchModalOpen(false);
                          await switchAccount(acc);
                        }}
                        className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
                      >
                        <UserAvatarBadge
                          name={acc.displayName}
                          photoUrl={acc.photoUrl}
                          plan={acc.plan}
                          role={acc.role}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                            {acc.displayName}
                          </div>
                          <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                            @{acc.username} · {acc.shortUid} ·{' '}
                            {acc.authMode === 'password' ? 'Password' : 'Google'}
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeSavedAccount(acc.uid)}
                        className="text-xs text-slate-400 hover:text-red-600 px-1.5"
                        title="Remove saved account"
                      >
                        ×
                      </button>
                    </div>
                  ))
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800 pt-3">
              <button
                type="button"
                onClick={async () => {
                  setSwitchModalOpen(false);
                  await startSwitchToNewLogin();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                <KeyRound className="h-3.5 w-3.5" />
                Sign In / Create Another Account
              </button>
              <button
                type="button"
                onClick={() => setSwitchModalOpen(false)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <OfflineIndicator />
    </div>
  );
};

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <MainShell />
      </AuthProvider>
    </ThemeProvider>
  );
}
