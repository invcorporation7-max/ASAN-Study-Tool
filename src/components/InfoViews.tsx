import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  CloudUpload,
  ExternalLink,
  Globe,
  KeyRound,
  Layers,
  Lock,
  Mail,
  Send,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  apiFetch,
  apiPublicFetch,
  ensureAppDriveFolder,
  fetchPublicCredits,
  saveJsonToDriveFolder,
} from '../lib/api';
import type {
  ContactMessageItem,
  CreditContributorItem,
  NavSection,
  PointRewardsConfig,
  WorkspacePermissionsConfig,
} from '../types';
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

      <div className="rounded-xl border border-amber-200 dark:border-amber-800/70 bg-white dark:bg-slate-900 p-6 sm:p-8 space-y-4">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400">
            <Globe className="h-5 w-5" />
          </div>
          <div className="space-y-1.5">
            <div className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
              Unavailable
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
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-2"
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
  const canPreviewBasic =
    !isGuest &&
    (dbUser?.plan === 'pro' || dbUser?.role === 'admin' || dbUser?.role === 'super');
  const [switching, setSwitching] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [keyStatus, setKeyStatus] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [permBusyKey, setPermBusyKey] = useState<string | null>(null);
  const [rewards, setRewards] = useState<PointRewardsConfig>({
    noteCreate: 0,
    calendarStudyEvent: 5,
    questionPaperUpload: 75,
    studyMaterialUpload: 0,
    examTimer30Min: 10,
    contributorWeekly: 120,
  });

  useEffect(() => {
    let active = true;
    apiPublicFetch<{ rewards?: PointRewardsConfig }>('/api/point-rewards')
      .then((res) => {
        if (active && res?.rewards) {
          setRewards(res.rewards);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const handleToggleWorkspacePerm = async (
    key: keyof WorkspacePermissionsConfig,
    nextVal: boolean
  ) => {
    setPermBusyKey(key);
    try {
      await updateWorkspacePermissions({ [key]: nextVal });
    } finally {
      setPermBusyKey(null);
    }
  };

  const handleSetAllWorkspacePerms = async (enabled: boolean) => {
    setPermBusyKey('all');
    try {
      await updateWorkspacePermissions({
        driveSync: enabled,
        docsExport: enabled,
        sheetsSync: enabled,
        meetRooms: enabled,
      });
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
        `500 initial points + earn points (+${rewards.questionPaperUpload} paper, +${rewards.examTimer30Min}/30m exam timer, +${rewards.calendarStudyEvent} study calendar${
          rewards.noteCreate > 0 ? `, +${rewards.noteCreate} note` : ''
        })`,
        'Tool Mail (@username, 5-char UID, multi-recipient, Self, Public)',
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
            View Plans &amp; Responsibilities
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
              {(['basic', 'pro'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={switching}
                  onClick={() => handlePlanSwitch(p)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize ${
                    dbUser?.plan === p
                      ? 'bg-slate-900 dark:bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {tiers.map((tier) => {
          const isCurrent = currentPlan === tier.id;
          return (
            <div
              key={tier.id}
              className={`rounded-xl border p-6 flex flex-col justify-between space-y-6 bg-white dark:bg-slate-900 ${
                isCurrent ? 'border-blue-600 dark:border-blue-500' : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                      {tier.name}
                    </h2>
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
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
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
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-4">
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
              <label
                key={item.key}
                className="flex min-h-[44px] items-center justify-between gap-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/60 px-4 py-3 cursor-pointer hover:border-slate-300 dark:hover:border-slate-600"
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">{item.title}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{item.desc}</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  disabled={permBusyKey !== null}
                  onClick={() => void handleToggleWorkspacePerm(item.key, !enabled)}
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
              </label>
            );
          })}
        </div>
      </div>

      {/* Extra Responsibilities: Contributor & Hand-Selected Admin */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-2">
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            Extra Role · Study Material Contributors
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            Contributors upload large Study Material Notes into the server storage pool (3 GB+ usable, mirrored to <code className="font-mono">ASAN-user-content</code>). Approved contributors receive <strong>+{rewards.contributorWeekly} points every week (starting Sunday)</strong> as long as Admins are satisfied with their work.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-2">
          <div className="text-xs font-semibold text-amber-700 dark:text-amber-400">
            Extra Responsibility · Hand-Selected Admins (Not a Plan)
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            Admin is an extra responsibility reserved solely for hand-selected users (never publicly claimable). Admins can hold either Basic or Pro plans, manage server storage &amp; analytics, send Admin Mail, generate Pro keys, and receive a free Pro key on first login + <strong>150 points weekly starting Sunday</strong>.
          </p>
        </div>
      </div>
    </div>
  );
};

export const AboutCreatorsView: React.FC = () => {
  const [contributors, setContributors] = useState<CreditContributorItem[]>([]);
  const [loadingCredits, setLoadingCredits] = useState(true);

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
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5">
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
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-4 space-y-1">
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              Spectra AI Module
            </div>
            <p className="leading-relaxed">
              Currently <strong>under development</strong> and temporarily unavailable in this release.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-4 space-y-1">
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
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
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
                className="flex items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 p-3"
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

      {/* About Site & Release Tag v1.7 */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              About Site · Version <span className="font-mono text-blue-700 dark:text-blue-400">v1.7</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Current production release highlights for ASAN-Study_tool.
            </p>
          </div>
          <span className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200">
            Release v1.7
          </span>
        </div>

        <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-300 leading-relaxed list-disc pl-5">
          <li>
            <strong>Specialized STEM Calculators Suite (Pro &amp; Admin):</strong> Five deterministic math engines bundled together — <strong>Calculus</strong> (symbolic derivatives, definite/improper integrals, limits, Taylor series, critical points), <strong>Coordinate Geometry</strong> (lines, triangles, circles, parabolas/ellipses/hyperbolas), <strong>Algebra</strong> (linear systems, polynomials up to cubic, 2×2 &amp; 3×3 matrices, quadratic inequalities), <strong>Vector &amp; 3D Geometry</strong> (dot/cross products, planes, skew line distance), and <strong>Trigonometry</strong> (identities, equation roots, SSA/SSS/SAS triangles).
          </li>
          <li>
            <strong>Exam Countdown Timers &amp; Dashboard Pinning:</strong> Admins publish top-level upcoming national/board exam countdowns, students create custom countdowns (name, date, optional time), and any countdown can be pinned to the Dashboard with live second-by-second ticking.
          </li>
          <li>
            <strong>Customizable Dashboard &amp; Dark Theme Mode:</strong> Show/hide and reorder Dashboard widgets per account, plus a full Light/Dark theme switch synced across the entire workspace.
          </li>
          <li>
            <strong>Multi-Date &amp; Recurring Calendar Scheduler:</strong> Create a single event across a date stretch (with weekday filters), far-separated specific dates (click calendar dates directly), or recurring Weekly / Monthly / Annual rules (by calendar date or Nth weekday such as First Sunday).
          </li>
          <li>
            <strong>Admin Contributor Credits, Tool Scrolling Polish &amp; Spectra AI Status:</strong> Admins and Super can also serve and receive credit under Currently Serving Contributors, tool scroll containers adapt cleanly on mobile/tablet/desktop, and Spectra AI is marked under development.
          </li>
        </ul>
      </div>

      {/* About Site & Release Tag v1.6 (Older Version — Headings Only) */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              Previous Release · Version <span className="font-mono text-blue-700 dark:text-blue-400">v1.6</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Update headings from earlier release v1.6.
            </p>
          </div>
          <span className="font-mono text-xs font-semibold text-slate-600 dark:text-slate-300">
            Release v1.6
          </span>
        </div>

        <ul className="space-y-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 list-disc pl-5">
          <li>Casio fx-82MS Scientific Calculator Simulator</li>
          <li>Admin Point Verification &amp; Super Action Point Control</li>
          <li>PDF Studio Whole-PDF Import, Camera Scan &amp; Auto-Renumbering</li>
          <li>Custom Sidebar App Pinning &amp; Workspace Function Permissions</li>
          <li>Study Material 70% Owner Royalty &amp; Mobile/Tablet Layout Fixes</li>
        </ul>
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
    isEffectiveProOrAdmin,
    signIn,
    workspaceToken,
    connectWorkspace,
    connectBasicDrive,
    updateProfile,
  } = useAuth();
  const isProOrAdmin = isEffectiveProOrAdmin;
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
    try {
      if (!workspaceToken) {
        const tok = isProOrAdmin ? await connectWorkspace() : await connectBasicDrive();
        if (!tok) return;
      }
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
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 space-y-4">
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
          className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 h-fit"
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
          {error && (
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/60 px-4 py-2.5 text-xs text-red-700 dark:text-red-300">
              {error}
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

        <div className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
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
            <div className="divide-y divide-slate-100 dark:divide-slate-800 lg:max-h-[420px] lg:overflow-y-auto">
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
