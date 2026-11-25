import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  CloudUpload,
  ExternalLink,
  Globe,
  KeyRound,
  Keyboard,
  Layers,
  Lock,
  Mail,
  RotateCcw,
  Send,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  apiFetch,
  apiPublicFetch,
  ensureAppDriveFolder,
  fetchPublicCredits,
  saveJsonToDriveFolder,
} from '../lib/api';
import {
  DOCS_SCOPE,
  DRIVE_FILE_SCOPE,
  MEET_SCOPES,
  SHEETS_SCOPE,
  WORKSPACE_SCOPES,
} from '../lib/firebase';
import {
  APP_SHORTCUT_CATALOG,
  SUGGESTED_APP_SHORTCUTS,
  formatKeyboardEventCombo,
  loadAppShortcuts,
  saveAppShortcuts,
} from '../lib/workspacePrefs';
import type {
  AppShortcutMap,
  ContactMessageItem,
  CreditContributorItem,
  NavSection,
  PointRewardsConfig,
  WorkspacePermissionsConfig,
} from '../types';
import { ConfirmDialog } from './ConfirmDialog';
import { UserAvatarBadge } from './UserAvatarBadge';

export const SpectraView: React.FC = () => {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
          Spectra AI
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Module availability status for ASAN-Study_tool.
        </p>
      </div>

      <div className="asan-pro-card asan-card-hover rounded-xl border border-indigo-200 dark:border-indigo-800/70 bg-white dark:bg-slate-900 p-6 sm:p-8 space-y-4">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400">
            <Globe className="h-5 w-5" />
          </div>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="asan-pro-badge rounded px-1.5 py-0.5 text-[9px]">PRO</span>
              <span className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                Unavailable
              </span>
            </div>
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
              Spectra AI is currently under development
            </h2>
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              The Spectra AI integration is temporarily unavailable while the module is under active development. Please use Specialized Calculators, Study Material Notes, Casio fx-82MS, and A4 Notebooks in the meantime.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export const MoreFeaturesView: React.FC = () => {
  const upcoming = [
    {
      title: 'Shared Classrooms & Peer Notebooks',
      tier: 'Pro',
      description:
        'Real-time collaborative A4 sections and shared revision folders across study groups.',
    },
    {
      title: 'Exam Analytics & Time-Per-Question Breakdown',
      tier: 'Pro',
      description:
        'Automated post-exam timing heatmaps derived from your Test Timer & Microsecond Stopwatch logs.',
    },
    {
      title: 'Contributor Curated Study Packs',
      tier: 'Contributor',
      description:
        'Approved contributors upload comprehensive subject notes stored in server storage & ASAN-user-content.',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
          More Features
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Additional study modules planned for upcoming releases of ASAN-Study_tool.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {upcoming.map((item) => (
          <div
            key={item.title}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-2 asan-card-hover"
          >
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium text-blue-600 dark:text-blue-400">{item.tier} Roadmap</span>
              <Layers className="h-4 w-4 text-slate-400" />
            </div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              {item.title}
            </h2>
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {item.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

interface PlansViewProps {
  onNavigate?: (section: NavSection) => void;
}

export const PlansView: React.FC<PlansViewProps> = ({ onNavigate }) => {
  const {
    dbUser,
    isGuest,
    isWorkspaceEnabled,
    isSuper,
    isApprovedContributor,
    workspaceToken,
    connectBasicDrive,
    connectWorkspace,
    effectivePlan,
    setViewPlanMode,
    signIn,
    switchPlanAdmin,
    refreshProfile,
    workspacePermissions,
    updateWorkspacePermissions,
  } = useAuth();
  const currentPlan = effectivePlan;
  const isAdmin = !isGuest && (dbUser?.role === 'admin' || dbUser?.role === 'super');
  const isActivePro =
    !isGuest &&
    dbUser?.plan === 'pro' &&
    (!dbUser.proExpiresAt || new Date(dbUser.proExpiresAt).getTime() > Date.now());
  const canPreviewBasic = !isGuest && !isActivePro && isAdmin;
  const userKey = isGuest ? 'guest' : dbUser?.uid || 'user';
  const [switching, setSwitching] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [keyStatus, setKeyStatus] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [permBusyKey, setPermBusyKey] = useState<string | null>(null);
  const [permStatusMsg, setPermStatusMsg] = useState<string | null>(null);
  const [pendingPermConfirm, setPendingPermConfirm] = useState<
    | { type: 'single'; key: keyof WorkspacePermissionsConfig; title: string; desc: string }
    | { type: 'all' }
    | null
  >(null);
  const [shortcutMap, setShortcutMap] = useState<AppShortcutMap>(() => loadAppShortcuts(userKey));
  const [recordingSection, setRecordingSection] = useState<NavSection | null>(null);
  const [shortcutNotice, setShortcutNotice] = useState<string | null>(null);
  const [rewards, setRewards] = useState<PointRewardsConfig>({
    noteCreate: 0,
    calendarStudyEvent: 5,
    questionPaperUpload: 75,
    studyMaterialUpload: 0,
    examTimer30Min: 10,
    contributorWeekly: 120,
    forumSatisfactoryAnswer: 25,
  });

  useEffect(() => {
    setShortcutMap(loadAppShortcuts(userKey));
  }, [userKey]);

  useEffect(() => {
    if (!recordingSection) {
      delete document.body.dataset.recordingShortcut;
      return;
    }
    document.body.dataset.recordingShortcut = '1';

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        setRecordingSection(null);
        setShortcutNotice('Shortcut recording cancelled.');
        return;
      }

      const combo = formatKeyboardEventCombo(e);
      if (!combo) {
        setShortcutNotice(
          'Hold Alt, Ctrl, or Meta + a key (or press F1–F12) to assign a shortcut. Press Esc to cancel.'
        );
        return;
      }

      const targetEntry = APP_SHORTCUT_CATALOG.find((item) => item.id === recordingSection);
      setShortcutMap((prev) => {
        const next: AppShortcutMap = { ...prev };
        let replacedLabel: string | null = null;
        for (const [sec, existing] of Object.entries(next) as [NavSection, string | undefined][]) {
          if (sec !== recordingSection && existing === combo) {
            delete next[sec];
            replacedLabel = APP_SHORTCUT_CATALOG.find((c) => c.id === sec)?.label || sec;
          }
        }
        next[recordingSection] = combo;
        saveAppShortcuts(userKey, next);
        setShortcutNotice(
          replacedLabel
            ? `Assigned ${combo} to ${targetEntry?.label || recordingSection} (removed from ${replacedLabel}).`
            : `Assigned ${combo} to ${targetEntry?.label || recordingSection}.`
        );
        return next;
      });
      setRecordingSection(null);
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      delete document.body.dataset.recordingShortcut;
    };
  }, [recordingSection, userKey]);

  useEffect(() => {
    let active = true;
    apiPublicFetch<PointRewardsConfig | { rewards?: PointRewardsConfig }>('/api/point-rewards')
      .then((res) => {
        const cfg = (res as { rewards?: PointRewardsConfig })?.rewards || (res as PointRewardsConfig);
        if (active && cfg && typeof cfg.questionPaperUpload === 'number') {
          setRewards({ ...cfg, forumSatisfactoryAnswer: cfg.forumSatisfactoryAnswer ?? 25 });
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const handleToggleWorkspacePerm = async (
    item: { key: keyof WorkspacePermissionsConfig; title: string; desc: string },
    nextVal: boolean
  ) => {
    setPermStatusMsg(null);
    if (nextVal) {
      setPendingPermConfirm({
        type: 'single',
        key: item.key,
        title: item.title,
        desc: item.desc,
      });
      return;
    }
    setPermBusyKey(item.key);
    try {
      await updateWorkspacePermissions({ [item.key]: false });
      setPermStatusMsg(`Disabled ${item.title}.`);
    } finally {
      setPermBusyKey(null);
    }
  };

  const handleSetAllWorkspacePerms = async (enabled: boolean) => {
    setPermStatusMsg(null);
    if (enabled) {
      setPendingPermConfirm({ type: 'all' });
      return;
    }
    setPermBusyKey('all');
    try {
      await updateWorkspacePermissions({
        driveSync: false,
        docsExport: false,
        sheetsSync: false,
        meetRooms: false,
      });
      setPermStatusMsg('All Google Workspace features have been disabled.');
    } finally {
      setPermBusyKey(null);
    }
  };

  const handleConfirmWorkspacePermEnable = async () => {
    if (!pendingPermConfirm) return;
    const action = pendingPermConfirm;
    setPermBusyKey(action.type === 'all' ? 'all' : action.key);
    try {
      if (isWorkspaceEnabled && !isGuest) {
        let tok: string | null = null;
        if (action.type === 'all') {
          tok = await connectWorkspace(WORKSPACE_SCOPES);
        } else if (action.key === 'driveSync') {
          tok = await connectBasicDrive();
        } else if (action.key === 'docsExport') {
          tok = await connectWorkspace([DRIVE_FILE_SCOPE, DOCS_SCOPE]);
        } else if (action.key === 'sheetsSync') {
          tok = await connectWorkspace([DRIVE_FILE_SCOPE, SHEETS_SCOPE]);
        } else if (action.key === 'meetRooms') {
          tok = await connectWorkspace(MEET_SCOPES);
        }
        if (!tok) {
          setPermStatusMsg(
            'Google Workspace authorization was cancelled or blocked. Permission was not turned on.'
          );
          setPendingPermConfirm(null);
          return;
        }
      }

      if (action.type === 'all') {
        await updateWorkspacePermissions({
          driveSync: true,
          docsExport: true,
          sheetsSync: true,
          meetRooms: true,
        });
        setPermStatusMsg('Permission granted: all Google Workspace features are now enabled.');
      } else {
        await updateWorkspacePermissions({ [action.key]: true });
        setPermStatusMsg(`Permission granted: ${action.title} is now enabled.`);
      }
      setPendingPermConfirm(null);
    } finally {
      setPermBusyKey(null);
    }
  };

  const handleRedeemKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = keyInput.trim().toUpperCase();
    if (!cleaned) return;
    setRedeeming(true);
    setKeyStatus(null);
    setKeyError(null);
    try {
      const res = await apiFetch<{ message?: string }>('/api/subscriptions/redeem-key', {
        method: 'POST',
        body: JSON.stringify({ keyCode: cleaned }),
      });
      setKeyInput('');
      await refreshProfile();
      setKeyStatus(res.message || 'License key activated successfully!');
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : 'Failed to activate license key');
    } finally {
      setRedeeming(false);
    }
  };

  const tiers = [
    {
      id: 'free',
      name: 'Free Tier',
      audience: 'No login required · Instant browser access',
      price: 'Free (0 Login)',
      features: [
        'Dashboard, Infinite Monthly Calendar & Persistent Timers',
        'Up to 10 A4 PDF note documents (local browser)',
        'Up to 150 tasks (local browser)',
        'Excludes Cloud Sync, Tool Mail, Points, PDF Booklet Tool, Workspace & Specialized Calculators',
      ],
    },
    {
      id: 'basic',
      name: 'Basic Plan',
      audience: 'Logged in with Google · 500 Initial Points · Blue Ring',
      price: 'Free on Login',
      features: [
        'Unlimited A4 PDF notes & unlimited tasks + Exam Master Cards view',
        'Optional ASAN-user-content Drive folder for .txt tasks & notes backup',
        `500 initial points + earn points (+${rewards.questionPaperUpload} paper, +${rewards.forumSatisfactoryAnswer} forum answer, +${rewards.examTimer30Min}/30m exam timer, +${rewards.calendarStudyEvent} study calendar${
          rewards.noteCreate > 0 ? `, +${rewards.noteCreate} note` : ''
        })`,
        'Study Forum (Global Q&A, Groups, 1-to-1 DMs), Contributor Formula Calculator & Upgraded Tool Mail',
        'Excludes Specialized Calculators, PDF Booklet Tool & Google Sheets Workspace',
      ],
    },
    {
      id: 'pro',
      name: 'Pro Plan',
      audience: 'Login required · Rainbow Ring · Monthly or Annual (15% Off)',
      price: '500 Pts / Mo · 5,100 Pts / Yr (15% Off)',
      features: [
        'Everything in Basic plan + Study Time Logger (In/Out − 2.5% − Sleep)',
        'Specialized Calculators Suite (Calculus, Coordinate Geometry, Algebra, Vector & 3D, Trigonometry)',
        'PDF Tool: A4 Booklet & Imposition Studio (Full/Half/Quarter)',
        'Google Workspace (Sheets "master" / "test_dates" sync, Docs export, Meet rooms)',
        'Expirable 8-char Pro Key (1 yr activation window, 1 mo or 12 mo Pro term)',
        'Locked until expiry or willing cancellation (Refund: 60% non-timed, remaining time − 5% timed; requires Admin approval)',
      ],
    },
  ];

  const handlePlanSwitch = async (planId: 'basic' | 'pro') => {
    setSwitching(true);
    try {
      await switchPlanAdmin(planId);
    } finally {
      setSwitching(false);
    }
  };

  const handleToggleLowerPreview = async (mode: 'auto' | 'basic') => {
    setSwitching(true);
    try {
      await setViewPlanMode(mode);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            View Plans and Settings
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Active View: <strong className="text-slate-900 dark:text-slate-100 capitalize">{currentPlan}</strong>
            {dbUser?.viewPlanMode === 'basic' && dbUser.plan === 'pro' && (
              <span className="text-xs text-blue-600 dark:text-blue-400">
                {' '}
                (Basic preview — Pro tenure still runs until {dbUser.proExpiresAt.slice(0, 10)})
              </span>
            )}
            {!isGuest && dbUser?.role !== 'user' && (
              <span>
                {' '}
                · Role: <strong className="capitalize text-blue-700 dark:text-blue-400">{dbUser?.role}</strong>
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canPreviewBasic && (
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1.5">
              <span className="px-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Lower-Plan Preview:
              </span>
              <button
                type="button"
                disabled={switching}
                onClick={() => handleToggleLowerPreview('basic')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  dbUser?.viewPlanMode === 'basic'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                Basic View
              </button>
              <button
                type="button"
                disabled={switching}
                onClick={() => handleToggleLowerPreview('auto')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  dbUser?.viewPlanMode !== 'basic'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                Full Tier
              </button>
            </div>
          )}

          {isAdmin && (
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1.5">
              <span className="px-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Admin Account Plan:
              </span>
              {(['basic', 'pro'] as const).map((p) => {
                const blocked = p === 'basic' && isActivePro;
                return (
                  <button
                    key={p}
                    type="button"
                    disabled={switching || blocked}
                    title={
                      blocked
                        ? 'Active Pro accounts stay on Pro until expiry or willing cancellation in Subscriptions'
                        : undefined
                    }
                    onClick={() => handlePlanSwitch(p)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize disabled:opacity-45 ${
                      dbUser?.plan === p
                        ? 'bg-slate-900 dark:bg-blue-600 text-white'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {tiers.map((tier) => {
          const isCurrent = currentPlan === tier.id;
          const isProTier = tier.id === 'pro';
          return (
            <div
              key={tier.id}
              className={`rounded-xl border p-6 flex flex-col justify-between space-y-6 asan-card-hover ${
                isProTier
                  ? 'asan-pro-card border-indigo-300 dark:border-indigo-700'
                  : 'bg-white dark:bg-slate-900'
              } ${
                isCurrent && !isProTier ? 'border-blue-600 dark:border-blue-500' : !isProTier ? 'border-slate-200 dark:border-slate-800' : ''
              }`}
            >
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                        {tier.name}
                      </h2>
                      {isProTier && (
                        <span className="asan-pro-badge rounded px-1.5 py-0.5 text-[9px]">PRO</span>
                      )}
                    </div>
                    {isCurrent && (
                      <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{tier.audience}</p>
                </div>

                <div className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                  {tier.price}
                </div>

                <ul className="space-y-2.5 border-t border-slate-100 dark:border-slate-800 pt-4">
                  {tier.features.map((feat) => (
                    <li
                      key={feat}
                      className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300"
                    >
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {tier.id === 'basic' && isGuest ? (
                <button
                  type="button"
                  onClick={signIn}
                  className="w-full rounded-lg bg-blue-600 py-2.5 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  Sign In to Unlock Basic (+500 Pts)
                </button>
              ) : tier.id === 'pro' && !isCurrent ? (
                <button
                  type="button"
                  onClick={() => (isGuest ? signIn() : onNavigate?.('subscriptions'))}
                  className="w-full rounded-lg bg-slate-900 dark:bg-blue-600 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-blue-700"
                >
                  {isGuest ? 'Sign In to Upgrade to Pro' : 'Upgrade in Subscriptions'}
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  className={`w-full rounded-lg py-2.5 text-xs font-semibold ${
                    isCurrent
                      ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {isCurrent ? 'Current Plan (Active)' : 'Included on Sign-In'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Inline 8-Character License Key Activation */}
      {!isGuest && (
        <form
          onSubmit={handleRedeemKey}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between asan-card-hover"
        >
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <KeyRound className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              Activate 8-Character License Key
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Enter a Pro License Key or Admin Key to activate your plan immediately.
            </p>
            {keyStatus && <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">{keyStatus}</p>}
            {keyError && <p className="text-xs font-medium text-red-600 dark:text-red-400">{keyError}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              type="text"
              maxLength={12}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value.toUpperCase())}
              placeholder="8-CHAR KEY"
              className="w-40 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono text-xs uppercase tracking-wider focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={redeeming || !keyInput.trim()}
              className="rounded-lg bg-slate-900 dark:bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-blue-700 disabled:opacity-60"
            >
              {redeeming ? 'Activating...' : 'Activate'}
            </button>
          </div>
        </form>
      )}

      {/* Google Workspace Function Permissions */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-4 asan-card-hover">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              Google Workspace Function Permissions
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Enable or disable individual Google Workspace actions across Notes, Tasks, Calendar, Study Materials, and Contact.
              {!isWorkspaceEnabled && (
                <span className="text-amber-700 dark:text-amber-400 font-medium">
                  {' '}
                  (Active only when signed in with Google; preferences are saved to your account/browser.)
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={permBusyKey !== null}
              onClick={() => void handleSetAllWorkspacePerms(true)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-60"
            >
              Enable All
            </button>
            <button
              type="button"
              disabled={permBusyKey !== null}
              onClick={() => void handleSetAllWorkspacePerms(false)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
            >
              Disable All
            </button>
          </div>
        </div>

        {permStatusMsg && (
          <div className="rounded-lg border border-blue-200 dark:border-blue-800/80 bg-blue-50/70 dark:bg-blue-950/40 px-3.5 py-2 text-xs text-blue-800 dark:text-blue-200">
            {permStatusMsg}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(
            [
              {
                key: 'driveSync',
                title: 'Google Drive Folder & File Sync',
                desc: 'Upload PDFs, backup .txt tasks/notes, and mirror files into ASAN-user-content.',
              },
              {
                key: 'docsExport',
                title: 'Google Docs Export',
                desc: 'Export A4 study notes and summaries as Google Docs inside ASAN-user-content.',
              },
              {
                key: 'sheetsSync',
                title: 'Google Sheets Sync (Schedule / Master / Tasks)',
                desc: 'Push or pull Calendar schedules, Tasks tables, and master -> test_dates sheets.',
              },
              {
                key: 'meetRooms',
                title: 'Google Meet Study Rooms',
                desc: 'Create instant Google Meet study links from Workspace or Calendar events.',
              },
            ] as const
          ).map((item) => {
            const enabled = workspacePermissions[item.key];
            return (
              <div
                key={item.key}
                onClick={() => {
                  if (permBusyKey === null) {
                    void handleToggleWorkspacePerm(item, !enabled);
                  }
                }}
                className="flex min-h-[44px] items-center justify-between gap-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/60 px-4 py-3 cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 asan-card-hover"
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">{item.title}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{item.desc}</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={`Toggle ${item.title}`}
                  disabled={permBusyKey !== null}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleToggleWorkspacePerm(item, !enabled);
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
                    enabled
                      ? 'border-blue-600 bg-blue-600'
                      : 'border-slate-300 dark:border-slate-600 bg-slate-200 dark:bg-slate-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* User-Defined Keyboard Shortcuts (Open Apps) */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-4 asan-card-hover">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <Keyboard className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Keyboard Shortcuts (Open Apps)
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Assign custom keyboard shortcuts (using <kbd className="rounded border border-slate-300 dark:border-slate-600 px-1 py-0.5 font-mono text-[10px]">Alt</kbd>,{' '}
              <kbd className="rounded border border-slate-300 dark:border-slate-600 px-1 py-0.5 font-mono text-[10px]">Ctrl</kbd>,{' '}
              <kbd className="rounded border border-slate-300 dark:border-slate-600 px-1 py-0.5 font-mono text-[10px]">Meta</kbd>, or{' '}
              <kbd className="rounded border border-slate-300 dark:border-slate-600 px-1 py-0.5 font-mono text-[10px]">F1–F12</kbd>) to jump directly to any app from anywhere outside typing fields.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                const next = { ...SUGGESTED_APP_SHORTCUTS };
                setShortcutMap(next);
                saveAppShortcuts(userKey, next);
                setRecordingSection(null);
                setShortcutNotice('Restored recommended default keyboard shortcuts.');
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Load Recommended
            </button>
            <button
              type="button"
              onClick={() => {
                setShortcutMap({});
                saveAppShortcuts(userKey, {});
                setRecordingSection(null);
                setShortcutNotice('Cleared all app keyboard shortcuts.');
              }}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Clear All
            </button>
          </div>
        </div>

        {shortcutNotice && (
          <div className="rounded-lg border border-blue-200 dark:border-blue-800/80 bg-blue-50/70 dark:bg-blue-950/40 px-3.5 py-2 text-xs text-blue-800 dark:text-blue-200">
            {shortcutNotice}
          </div>
        )}

        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {APP_SHORTCUT_CATALOG.filter(
            (entry) =>
              (entry.requiresWorkspace ? isWorkspaceEnabled : true) &&
              (entry.requiresContributor ? isApprovedContributor : true) &&
              (entry.requiresAdmin ? isAdmin : true) &&
              (entry.requiresSuper ? isSuper : true)
          ).map((entry) => {
            const isRecording = recordingSection === entry.id;
            const combo = shortcutMap[entry.id];
            return (
              <div
                key={entry.id}
                className={`flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 transition-colors ${
                  isRecording
                    ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/40'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/50'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {entry.label}
                    </span>
                    {entry.proOnly && (
                      <span className="asan-pro-badge rounded px-1 py-0.5 text-[9px] shrink-0">
                        PRO
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">{entry.category}</div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {combo && !isRecording && (
                    <kbd className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-200 shadow-2xs">
                      {combo}
                    </kbd>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setShortcutNotice(null);
                      setRecordingSection((prev) => (prev === entry.id ? null : entry.id));
                    }}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      isRecording
                        ? 'bg-blue-600 text-white animate-pulse'
                        : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {isRecording ? 'Press keys... (Esc)' : combo ? 'Change' : 'Set Key'}
                  </button>
                  {combo && !isRecording && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = { ...shortcutMap };
                        delete next[entry.id];
                        setShortcutMap(next);
                        saveAppShortcuts(userKey, next);
                        setShortcutNotice(`Removed shortcut for ${entry.label}.`);
                      }}
                      title={`Clear shortcut for ${entry.label}`}
                      aria-label={`Clear shortcut for ${entry.label}`}
                      className="rounded-md p-1 text-slate-400 hover:bg-white dark:hover:bg-slate-900 hover:text-red-600 dark:hover:text-red-400"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Extra Responsibilities: Contributor & Hand-Selected Admin */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-2 asan-card-hover">
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            Extra Role · Study Material Contributors
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            Contributors upload large Study Material Notes into the server storage pool (3 GB+ usable, mirrored to <code className="font-mono">ASAN-user-content</code>). Approved contributors receive <strong>+{rewards.contributorWeekly} points every week (starting Sunday)</strong> as long as Admins are satisfied with their work.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-2 asan-card-hover">
          <div className="text-xs font-semibold text-amber-700 dark:text-amber-400">
            Extra Responsibility · Hand-Selected Admins (Not a Plan)
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            Admin is an extra responsibility reserved solely for hand-selected users (never publicly claimable). Admins can hold either Basic or Pro plans, manage server storage &amp; analytics, send Admin Mail, generate Pro keys, and receive a free Pro key on first login + <strong>150 points weekly starting Sunday</strong>.
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={pendingPermConfirm !== null}
        title={
          pendingPermConfirm?.type === 'all'
            ? 'Allow All Google Workspace Features?'
            : `Allow ${pendingPermConfirm?.title || 'Google Workspace Feature'}?`
        }
        description={
          pendingPermConfirm?.type === 'all'
            ? 'Grant permission for ASAN-Study_tool to use Google Drive (ASAN-user-content folder), Google Docs export, Google Sheets sync, and Google Meet rooms on your Google account. You can revoke any toggle anytime here.'
            : `${pendingPermConfirm?.desc || ''} Do you grant permission for ASAN-Study_tool to enable this Google Workspace feature on your account?`
        }
        confirmLabel={
          isWorkspaceEnabled && !workspaceToken && !isGuest
            ? 'Allow & Connect Google'
            : 'Allow & Enable'
        }
        busy={permBusyKey !== null}
        onConfirm={() => void handleConfirmWorkspacePermEnable()}
        onCancel={() => setPendingPermConfirm(null)}
      />
    </div>
  );
};

export const AboutCreatorsView: React.FC = () => {
  const [contributors, setContributors] = useState<CreditContributorItem[]>([]);
  const [loadingCredits, setLoadingCredits] = useState(true);
  const [olderVersionsOpen, setOlderVersionsOpen] = useState(false);

  useEffect(() => {
    let active = true;
    fetchPublicCredits<{ contributors: CreditContributorItem[] }>()
      .then((d) => {
        if (active) setContributors(Array.isArray(d?.contributors) ? d.contributors : []);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingCredits(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
          About the Creators &amp; Credits
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Built for students preparing for competitive and board examinations.
        </p>
      </div>

      {/* Primary Creator & Attribution */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5 asan-card-hover">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
            <Users className="h-5 w-5" />
          </div>
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
              Creator &amp; Lead Architect
            </div>
            <h2 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">
              Arham Imam
            </h2>
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              Creator of <strong>ASAN-Study_tool</strong> — combining OneNote-style structured A4 notebooks, duplex booklet imposition PDF printing, infinite multi-date calendar &amp; exam master blueprints, fullscreen exam hall timers &amp; countdowns, Specialized STEM Calculators, Study Material Notes, and internal points &amp; license workflows.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 border-t border-slate-100 dark:border-slate-800 pt-5 sm:grid-cols-2 text-xs text-slate-600 dark:text-slate-300">
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-4 space-y-1 asan-card-hover">
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              Spectra AI Module
            </div>
            <p className="leading-relaxed">
              Currently <strong>under development</strong> and temporarily unavailable in this release.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-4 space-y-1 asan-card-hover">
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              Application Engineering
            </div>
            <p className="leading-relaxed">
              Designed by <strong>Arham Imam</strong> and co-engineered for reliable offline-ready PWA delivery.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 border-t border-slate-100 dark:border-slate-800 pt-5 sm:grid-cols-2 text-xs text-slate-600 dark:text-slate-300">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <div>
              <div className="font-semibold text-slate-900 dark:text-slate-100">Privacy &amp; Opt-In Drive</div>
              <p className="mt-0.5">
                Drive permissions are never requested on sign-in. Basic &amp; Pro users opt in only when saving inside their dedicated <code className="font-mono">ASAN-user-content</code> folder.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <Layers className="mt-0.5 h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <div>
              <div className="font-semibold text-slate-900 dark:text-slate-100">Print-First A4 Standards</div>
              <p className="mt-0.5">
                Built around standard ISO 210 × 297 mm A4 geometry for immediate physical printing and digital sharing.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Currently Serving Contributors */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 asan-card-hover">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              Currently Serving Contributors
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Approved contributors (including serving Admins &amp; Super) maintaining the ASAN-Study_tool Study Material repository.
            </p>
          </div>
          <span className="rounded-md bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800/80 px-2.5 py-0.5 text-[11px] font-semibold text-red-700 dark:text-red-300 tabular-nums whitespace-nowrap shrink-0">
            {contributors.length} Serving
          </span>
        </div>

        {loadingCredits ? (
          <p className="py-4 text-xs text-slate-500 dark:text-slate-400">Loading contributor credits...</p>
        ) : contributors.length === 0 ? (
          <p className="py-4 text-xs text-slate-500 dark:text-slate-400">
            No additional approved contributors serving right now. Apply in Study Material Notes to become a Contributor.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            {contributors.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 p-3 asan-card-hover"
              >
                <UserAvatarBadge
                  name={c.displayName}
                  photoUrl={c.photoUrl}
                  plan={c.plan}
                  role={c.role}
                  contributorApproved={c.contributorApproved}
                  size="md"
                />
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold text-slate-900 dark:text-slate-100">
                    {c.displayName}
                  </div>
                  <div className="truncate font-mono text-[11px] text-blue-700 dark:text-blue-400">
                    @{c.username} · {c.shortUid}
                  </div>
                  {(c.role === 'admin' || c.role === 'super') && (
                    <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                      {c.role === 'super' ? 'Super · Contributor' : 'Admin · Contributor'}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* About Site & Release Tag v1.8 */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 asan-card-hover">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              About Site · Version <span className="font-mono text-blue-700 dark:text-blue-400">v1.8</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Current production release highlights for ASAN-Study_tool.
            </p>
          </div>
          <span className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200">
            Release v1.8
          </span>
        </div>

        <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-300 leading-relaxed list-disc pl-5">
          <li>
            <strong>Real-Time Study Forum &amp; Upgraded Tool Mail:</strong> Global Q&amp;A Arena, Study Groups, and 1-to-1 Direct Messages powered by WebSocket/SSE live sync, a native Summernote rich-text editor (headings, tables, colors, embeds, PDF/image attachments), interactive competitive/board answer fields (<strong>JEE Main, JEE Advanced, NEET UG, ISC, CBSE, CUET</strong> — Single/Multi MCQ, Integer, Double, Matrix Match, Assertion-Reason, Comprehension, Subjective), collaborative peer discussions, and Super-controlled satisfaction point rewards (strictly non-self-awardable).
          </li>
          <li>
            <strong>Multi-Format Study Material Repository:</strong> Upload, filter, preview inline, and share <strong>Photos, Videos, Text, PDFs, Word, Excel, PowerPoint, and Audio Recordings</strong> (including built-in browser voice recording) with automatic format recognition.
          </li>
          <li>
            <strong>Contributor Formula Calculator &amp; Wide Conic/Circle Solver:</strong> Approved Contributors, Admins, and Super define formula equations with symbol meanings; students supply known input parameters and request N target outputs using semantic parameter matching, multi-equation chaining, and wide symbolic Circle &amp; Conic solvers (Major/Minor Axis, Latus Rectum, Directrix, Foci, Vertices, Asymptotes).
          </li>
          <li>
            <strong>Student Etiquette &amp; Updated Legal Terms:</strong> Updated Privacy Policy and Terms of Service establishing clear academic integrity, peer collaboration etiquette, and fair points governance.
          </li>
        </ul>
      </div>

      {/* Previous Releases Accordion (v1.7 & v1.6) */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 asan-card-hover">
        <button
          type="button"
          onClick={() => setOlderVersionsOpen((v) => !v)}
          aria-expanded={olderVersionsOpen}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              Previous Releases · <span className="font-mono text-blue-700 dark:text-blue-400">v1.7 &amp; v1.6</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Click to {olderVersionsOpen ? 'collapse' : 'expand'} update headings from earlier releases v1.7 and v1.6.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono text-xs font-semibold text-slate-600 dark:text-slate-300">
              Archive
            </span>
            <ChevronDown
              className={`h-4 w-4 text-slate-500 dark:text-slate-400 transition-transform duration-200 ${
                olderVersionsOpen ? 'rotate-180' : ''
              }`}
            />
          </div>
        </button>

        {olderVersionsOpen && (
          <div className="mt-4 border-t border-slate-100 dark:border-slate-800 pt-3.5 space-y-4 text-xs text-slate-700 dark:text-slate-300">
            <div>
              <div className="font-mono font-bold text-slate-900 dark:text-slate-100 mb-1.5">
                Release v1.7
              </div>
              <ul className="space-y-1.5 font-medium list-disc pl-5">
                <li>Specialized STEM Calculators Suite (Pro &amp; Admin): Calculus, Coordinate Geometry, Algebra, Vector &amp; 3D, Trigonometry</li>
                <li>Exam Countdown Timers &amp; Dashboard Pinning</li>
                <li>Customizable Dashboard Widgets &amp; Full Dark Theme Mode</li>
                <li>Multi-Date &amp; Recurring Calendar Scheduler</li>
                <li>Admin Contributor Credits, Tool Scrolling Polish &amp; Spectra AI Status</li>
              </ul>
            </div>
            <div>
              <div className="font-mono font-bold text-slate-900 dark:text-slate-100 mb-1.5">
                Release v1.6
              </div>
              <ul className="space-y-1.5 font-medium list-disc pl-5">
                <li>Casio fx-82MS Scientific Calculator Simulator</li>
                <li>Admin Point Verification &amp; Super Action Point Control</li>
                <li>PDF Studio Whole-PDF Import, Camera Scan &amp; Auto-Renumbering</li>
                <li>Custom Sidebar App Pinning &amp; Workspace Function Permissions</li>
                <li>Study Material 70% Owner Royalty &amp; Mobile/Tablet Layout Fixes</li>
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Legal & Compliance Links */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between asan-card-hover">
        <div>
          <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
            Privacy Policy &amp; Terms of Service
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Public legal documents for ASAN-Study_tool data handling, Google Workspace Limited Use, and subscriptions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <a
            href="/privacy-policy.html"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            Privacy Policy
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <a
            href="/terms-of-service.html"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            Terms of Service
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
};

export const ContactView: React.FC = () => {
  const {
    dbUser,
    isGuest,
    isWorkspaceEnabled,
    workspacePermissions,
    signIn,
    connectBasicDrive,
    updateProfile,
    error: authError,
    clearError,
  } = useAuth();
  const isAdmin = !isGuest && (dbUser?.role === 'admin' || dbUser?.role === 'super');

  const [name, setName] = useState(dbUser?.displayName || '');
  const [email, setEmail] = useState(dbUser?.email || '');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ContactMessageItem[]>([]);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    if (isGuest || !dbUser) return;
    try {
      const rows = await apiFetch<ContactMessageItem[]>('/api/contact');
      setHistory(rows);
    } catch {
      // ignore
    }
  }, [dbUser, isGuest]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isGuest) return;
    setSending(true);
    setError(null);
    try {
      await apiFetch('/api/contact', {
        method: 'POST',
        body: JSON.stringify({ name, email, subject, message }),
      });
      setSubmitted(true);
      setSubject('');
      setMessage('');
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleBackupContactDrive = async () => {
    setBackupMsg(null);
    setError(null);
    clearError();
    try {
      const tok = await connectBasicDrive();
      if (!tok) return;
      const folder = await ensureAppDriveFolder(dbUser?.driveFolderId);
      if (folder.id !== dbUser?.driveFolderId) {
        await updateProfile({ driveFolderId: folder.id });
      }
      const saved = await saveJsonToDriveFolder(
        `asan_contact_inquiries_${new Date().toISOString().slice(0, 10)}.json`,
        history,
        folder.id
      );
      setBackupMsg(
        `Backed up ${history.length} inquiry record(s) into Drive folder "ASAN-user-content" (${saved.name}).`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Drive backup failed');
    }
  };

  if (isGuest) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 space-y-4 asan-card-hover">
          <div className="flex items-start gap-3">
            <Lock className="mt-1 h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">
                Contact &amp; Support Tickets
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Sign in with Google to submit support inquiries directly to the ASAN-Study_tool server database and track replies.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={signIn}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">Contact</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Inquiries are stored directly in the ASAN-Study_tool server database and reviewed in-app—no external email required.
          </p>
        </div>

        {history.length > 0 && isWorkspaceEnabled && workspacePermissions.driveSync && (
          <button
            type="button"
            onClick={handleBackupContactDrive}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <CloudUpload className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            Backup Inquiries to Drive Folder
          </button>
        )}
      </div>

      {backupMsg && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 px-4 py-2.5 text-xs text-emerald-800 dark:text-emerald-300">
          {backupMsg}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 h-fit asan-card-hover"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Account Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Subject</label>
            <input
              type="text"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Feature feedback, Pro key inquiry..."
              className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Message</label>
            <textarea
              rows={4}
              required
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write your message..."
              className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          {submitted && (
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 px-4 py-2.5 text-xs text-emerald-800 dark:text-emerald-300">
              Message saved to server database! View your submitted tickets below.
            </div>
          )}
          {(error || authError) && (
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/60 px-4 py-2.5 text-xs text-red-700 dark:text-red-300">
              {error || authError}
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Mail className="h-3.5 w-3.5" />
              Stored in Server DB
            </div>
            <button
              type="submit"
              disabled={sending}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              <Send className="h-4 w-4" />
              {sending ? 'Sending...' : 'Submit Inquiry'}
            </button>
          </div>
        </form>

        <div className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 asan-card-hover">
          <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              {isAdmin ? 'All User Contact Inquiries (Admin)' : 'Your Submitted Inquiries'}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Logged inside ASAN-Study_tool server storage ({history.length}).
            </p>
          </div>

          {history.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No contact inquiries submitted yet.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {history.map((item) => (
                <div key={item.id} className="py-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {item.subject}
                    </span>
                    <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {item.name} · {item.email}
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                    {item.message}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
