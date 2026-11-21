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
  ensureAppDriveFolder,
  fetchPublicCredits,
  saveJsonToDriveFolder,
} from '../lib/api';
import type { ContactMessageItem, CreditContributorItem, NavSection } from '../types';
import { UserAvatarBadge } from './UserAvatarBadge';

export const SpectraView: React.FC = () => {
  const { dbUser, updateProfile } = useAuth();
  const [urlInput, setUrlInput] = useState(
    dbUser?.spectraUrl || 'https://www.khanacademy.org'
  );
  const [saved, setSaved] = useState(false);

  const handleSaveUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateProfile({ spectraUrl: urlInput.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const activeUrl = dbUser?.spectraUrl || urlInput;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">
          Spectra AI
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Direct external portal link configured for your Pro study workflow.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Globe className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Launch Spectra AI External Portal
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 break-all">{activeUrl}</p>
            </div>
          </div>

          <a
            href={activeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
          >
            Open Spectra AI
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>

        <form onSubmit={handleSaveUrl} className="border-t border-slate-100 pt-4 space-y-3">
          <label className="block text-xs font-medium text-slate-600">
            Update Spectra AI Destination URL
          </label>
          <div className="flex gap-2">
            <input
              type="url"
              required
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
            >
              {saved ? 'Saved' : 'Update Link'}
            </button>
          </div>
        </form>
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
        <h1 className="font-display text-2xl font-bold text-slate-900">
          More Features
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Additional study modules planned for upcoming releases of ASAN-Study_tool.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {upcoming.map((item) => (
          <div
            key={item.title}
            className="rounded-xl border border-slate-200 bg-white p-6 space-y-2"
          >
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-medium text-blue-600">{item.tier} Roadmap</span>
              <Layers className="h-4 w-4 text-slate-400" />
            </div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              {item.title}
            </h2>
            <p className="text-xs leading-relaxed text-slate-600">
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
    effectivePlan,
    setViewPlanMode,
    signIn,
    switchPlanAdmin,
    refreshProfile,
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
        'Excludes Cloud Sync, Tool Mail, Points, PDF Booklet Tool, Workspace & Spectra AI',
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
        '500 initial points + earn points (+75 paper, +10/30m exam timer, +5 study calendar)',
        'Tool Mail (@username, 5-char UID, multi-recipient, Self, Public)',
        'Excludes Spectra AI, PDF Booklet Tool & Google Sheets Workspace',
      ],
    },
    {
      id: 'pro',
      name: 'Pro Plan',
      audience: 'Login required · Rainbow Ring · Monthly or Annual (15% Off)',
      price: '500 Pts / Mo · 5,100 Pts / Yr (15% Off)',
      features: [
        'Everything in Basic plan + Study Time Logger (In/Out − 2.5% − Sleep)',
        'PDF Tool: A4 Booklet & Imposition Studio (Full/Half/Quarter)',
        'Google Workspace (Sheets "master" / "test_dates" sync, Docs export, Meet rooms)',
        'Spectra AI portal launcher access',
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
          <h1 className="font-display text-2xl font-bold text-slate-900">
            View Plans &amp; Responsibilities
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Active View: <strong className="text-slate-900 capitalize">{currentPlan}</strong>
            {dbUser?.viewPlanMode === 'basic' && dbUser.plan === 'pro' && (
              <span className="text-xs text-blue-600">
                {' '}
                (Basic preview — Pro tenure still runs until {dbUser.proExpiresAt.slice(0, 10)})
              </span>
            )}
            {!isGuest && dbUser?.role !== 'user' && (
              <span>
                {' '}
                · Role: <strong className="capitalize text-blue-700">{dbUser?.role}</strong>
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canPreviewBasic && (
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white p-1.5">
              <span className="px-2 text-[11px] font-medium text-slate-500">
                Lower-Plan Preview:
              </span>
              <button
                type="button"
                disabled={switching}
                onClick={() => handleToggleLowerPreview('basic')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  dbUser?.viewPlanMode === 'basic'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
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
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Full Tier
              </button>
            </div>
          )}

          {isAdmin && (
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white p-1.5">
              <span className="px-2 text-[11px] font-medium text-slate-500">
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
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
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
              className={`rounded-xl border p-6 flex flex-col justify-between space-y-6 bg-white ${
                isCurrent ? 'border-blue-600' : 'border-slate-200'
              }`}
            >
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-lg font-bold text-slate-900">
                      {tier.name}
                    </h2>
                    {isCurrent && (
                      <span className="text-xs font-semibold text-blue-600">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{tier.audience}</p>
                </div>

                <div className="font-display text-2xl font-bold text-slate-900">
                  {tier.price}
                </div>

                <ul className="space-y-2.5 border-t border-slate-100 pt-4">
                  {tier.features.map((feat) => (
                    <li
                      key={feat}
                      className="flex items-start gap-2 text-xs text-slate-700"
                    >
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" />
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
                  className="w-full rounded-lg bg-slate-900 py-2.5 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  {isGuest ? 'Sign In to Upgrade to Pro' : 'Upgrade in Subscriptions'}
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  className={`w-full rounded-lg py-2.5 text-xs font-semibold ${
                    isCurrent
                      ? 'bg-blue-50 text-blue-700 border border-blue-200'
                      : 'bg-slate-100 text-slate-500'
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
          className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <KeyRound className="h-4 w-4 text-blue-600" />
              Activate 8-Character License Key
            </div>
            <p className="text-xs text-slate-500">
              Enter a Pro License Key or Admin Key to activate your plan immediately.
            </p>
            {keyStatus && <p className="text-xs font-medium text-emerald-700">{keyStatus}</p>}
            {keyError && <p className="text-xs font-medium text-red-600">{keyError}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              type="text"
              maxLength={12}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value.toUpperCase())}
              placeholder="8-CHAR KEY"
              className="w-40 rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs uppercase tracking-wider focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={redeeming || !keyInput.trim()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {redeeming ? 'Activating...' : 'Activate'}
            </button>
          </div>
        </form>
      )}

      {/* Extra Responsibilities: Contributor & Hand-Selected Admin */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
          <div className="text-xs font-semibold text-emerald-700">
            Extra Role · Study Material Contributors
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Contributors upload large Study Material Notes into the server storage pool (3 GB+ usable, mirrored to <code className="font-mono">ASAN-user-content</code>). Approved contributors receive <strong>+120 points every week (starting Sunday)</strong> as long as Admins are satisfied with their work.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
          <div className="text-xs font-semibold text-amber-700">
            Extra Responsibility · Hand-Selected Admins (Not a Plan)
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
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
        <h1 className="font-display text-2xl font-bold text-slate-900">
          About the Creators &amp; Credits
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Built for students preparing for competitive and board examinations.
        </p>
      </div>

      {/* Primary Creator & AI Attribution */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Users className="h-5 w-5" />
          </div>
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-blue-600">
              Creator &amp; Lead Architect
            </div>
            <h2 className="font-display text-xl font-bold text-slate-900">
              Arham Imam
            </h2>
            <p className="text-sm leading-relaxed text-slate-600">
              Creator of <strong>ASAN-Study_tool</strong> — combining OneNote-style structured A4 notebooks, duplex booklet imposition PDF printing, infinite calendar &amp; exam master blueprints, fullscreen exam hall timers (JEE, NEET, ISC, CBSE, CUET), Study Material Notes, and internal points &amp; license workflows.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2 text-xs text-slate-600">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-1">
            <div className="font-semibold text-slate-900">
              Spectra AI Integration
            </div>
            <p className="leading-relaxed">
              External AI study portal integration credited to{' '}
              <strong>Spectra AI</strong> (launched directly via external link for Pro members).
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-1">
            <div className="font-semibold text-slate-900">
              Application Engineering
            </div>
            <p className="leading-relaxed">
              Designed by <strong>Arham Imam</strong> and co-engineered for reliable offline-ready PWA delivery.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2 text-xs text-slate-600">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 text-blue-600 shrink-0" />
            <div>
              <div className="font-semibold text-slate-900">Privacy &amp; Opt-In Drive</div>
              <p className="mt-0.5">
                Drive permissions are never requested on sign-in. Basic &amp; Pro users opt in only when saving inside their dedicated <code className="font-mono">ASAN-user-content</code> folder.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <Layers className="mt-0.5 h-4 w-4 text-blue-600 shrink-0" />
            <div>
              <div className="font-semibold text-slate-900">Print-First A4 Standards</div>
              <p className="mt-0.5">
                Built around standard ISO 210 × 297 mm A4 geometry for immediate physical printing and digital sharing.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Currently Serving Contributors */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              Currently Serving Contributors
            </h2>
            <p className="text-xs text-slate-500">
              Approved contributors maintaining the ASAN-Study_tool Study Material repository.
            </p>
          </div>
          <span className="rounded-full bg-red-50 border border-red-200 px-2.5 py-0.5 text-[11px] font-semibold text-red-700 tabular-nums">
            {contributors.length} Serving
          </span>
        </div>

        {loadingCredits ? (
          <p className="py-4 text-xs text-slate-500">Loading contributor credits...</p>
        ) : contributors.length === 0 ? (
          <p className="py-4 text-xs text-slate-500">
            No additional approved contributors serving right now. Apply in Study Material Notes to become a Contributor.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            {contributors.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3"
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
                  <div className="truncate text-xs font-bold text-slate-900">
                    {c.displayName}
                  </div>
                  <div className="truncate font-mono text-[11px] text-blue-700">
                    @{c.username} · {c.shortUid}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* About Site & Release Tag v1.6 */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              About Site · Version <span className="font-mono text-blue-700">v1.6</span>
            </h2>
            <p className="text-xs text-slate-500">
              Current production build tag &amp; release highlights for ASAN-Study_tool.
            </p>
          </div>
          <span className="font-mono text-xs font-bold text-slate-800">
            Release v1.6
          </span>
        </div>

        <ul className="space-y-2 text-xs text-slate-600 leading-relaxed list-disc pl-5">
          <li>
            <strong>Casio fx-82MS Scientific Calculator Simulator:</strong> Authentic 2nd edition S-V.P.A.M. dual-line calculator with SHIFT &amp; ALPHA keys, COMP/SD/REG modes, CLR resets, persistent variables (A–F, X, Y, M), and 20-step session replay history erased upon power OFF.
          </li>
          <li>
            <strong>Admin Point Transaction Verification:</strong> Admins and Super can verify, revert, or dismiss every point award and deduction with automatic balance reversal and Tool Mail audit notices.
          </li>
          <li>
            <strong>PDF Studio Enhancements:</strong> Interactive image crop &amp; 90° rotation, multi-select &amp; group image drag/reorder controls, Single Page vs. Scroll All view modes, sheet jump bar, and responsive Fit zoom.
          </li>
          <li>
            <strong>Mobile &amp; Tablet UI Formatting:</strong> Responsive top bar search &amp; notification popovers, adaptive A4 note sheets, and clean touch layouts across 375px phones, tablets, and desktops.
          </li>
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
        <div className="rounded-xl border border-slate-200 bg-white p-8 space-y-4">
          <div className="flex items-start gap-3">
            <Lock className="mt-1 h-5 w-5 text-blue-600 shrink-0" />
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900">
                Contact &amp; Support Tickets
              </h1>
              <p className="mt-1 text-sm text-slate-600">
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
          <h1 className="font-display text-2xl font-bold text-slate-900">Contact</h1>
          <p className="mt-1 text-sm text-slate-500">
            Inquiries are stored directly in the ASAN-Study_tool server database and reviewed in-app—no external email required.
          </p>
        </div>

        {history.length > 0 && isWorkspaceEnabled && (
          <button
            type="button"
            onClick={handleBackupContactDrive}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <CloudUpload className="h-3.5 w-3.5 text-emerald-600" />
            Backup Inquiries to Drive Folder
          </button>
        )}
      </div>

      {backupMsg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">
          {backupMsg}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-6 space-y-4 h-fit"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-600">Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">Account Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600">Subject</label>
            <input
              type="text"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Feature feedback, Pro key inquiry..."
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600">Message</label>
            <textarea
              rows={4}
              required
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write your message..."
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          {submitted && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">
              Message saved to server database! View your submitted tickets on the right.
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
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

        <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="font-display text-base font-semibold text-slate-900">
              {isAdmin ? 'All User Contact Inquiries (Admin)' : 'Your Submitted Inquiries'}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Logged inside ASAN-Study_tool server storage ({history.length}).
            </p>
          </div>

          {history.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500">
              No contact inquiries submitted yet.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
              {history.map((item) => (
                <div key={item.id} className="py-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900">
                      {item.subject}
                    </span>
                    <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {item.name} · {item.email}
                  </div>
                  <p className="text-xs text-slate-700 whitespace-pre-wrap">
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
