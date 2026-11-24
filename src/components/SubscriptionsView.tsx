import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Coins,
  Copy,
  ExternalLink,
  FlaskConical,
  KeyRound,
  Lock,
  ShieldAlert,
  Sparkles,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  apiFetch,
  buildGmailConfirmationUrl,
  buildGmailLicenseComposeUrl,
} from '../lib/api';
import type { LicenseKeyItem, PointTransactionItem, ProRefundRequestItem } from '../types';
import { ConfirmDialog } from './ConfirmDialog';

export const SubscriptionsView: React.FC = () => {
  const {
    dbUser,
    isGuest,
    authMode,
    effectivePlan,
    setViewPlanMode,
    signIn,
    exitGuestToSignIn,
    setAccountPassword,
    refreshProfile,
  } = useAuth();
  const [keys, setKeys] = useState<LicenseKeyItem[]>([]);
  const [transactions, setTransactions] = useState<PointTransactionItem[]>([]);
  const [refundRequests, setRefundRequests] = useState<ProRefundRequestItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedTerm, setSelectedTerm] = useState<'monthly' | 'annual'>('monthly');
  const [keyInput, setKeyInput] = useState('');
  const [giftRecipient, setGiftRecipient] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [switchingPreview, setSwitchingPreview] = useState(false);
  const [cancelPurchaseType, setCancelPurchaseType] = useState<'time_dependent' | 'non_timed'>('time_dependent');
  const [cancelReason, setCancelReason] = useState('');
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastPurchasedKey, setLastPurchasedKey] = useState<{
    keyCode: string;
    recipientEmail: string;
    activationExpiresAt: string;
  } | null>(null);

  const loadSubscriptions = useCallback(async () => {
    if (isGuest || !dbUser) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch<{
        keys: LicenseKeyItem[];
        transactions: PointTransactionItem[];
        refundRequests?: ProRefundRequestItem[];
      }>('/api/subscriptions');
      setKeys(data.keys || []);
      setTransactions(data.transactions || []);
      setRefundRequests(data.refundRequests || []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load subscription records');
    } finally {
      setLoading(false);
    }
  }, [dbUser, isGuest]);

  useEffect(() => {
    loadSubscriptions();
  }, [loadSubscriptions]);

  const planCost = selectedTerm === 'annual' ? 5100 : 500;
  const termLabel = selectedTerm === 'annual' ? 'Annual (12 Months · 15% Off)' : 'Monthly (1 Month)';

  const handleActivateWithPoints = async () => {
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await apiFetch<{ message: string }>('/api/subscriptions/redeem-points', {
        method: 'POST',
        body: JSON.stringify({ term: selectedTerm }),
      });
      await Promise.all([refreshProfile(), loadSubscriptions()]);
      setStatusMsg(`${res.message} Confirmation delivered to Tool Mail.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not activate Pro with points');
    } finally {
      setBusy(false);
    }
  };

  const handlePurchaseProKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await apiFetch<{
        key: LicenseKeyItem;
        recipientEmail: string;
      }>('/api/subscriptions/purchase-key', {
        method: 'POST',
        body: JSON.stringify({
          recipientEmail: giftRecipient.trim() || dbUser?.email,
          term: selectedTerm,
        }),
      });
      setLastPurchasedKey({
        keyCode: res.key.keyCode,
        recipientEmail: res.recipientEmail,
        activationExpiresAt: res.key.activationExpiresAt,
      });
      setGiftRecipient('');
      await Promise.all([refreshProfile(), loadSubscriptions()]);
      setStatusMsg(
        `Generated 8-char ${selectedTerm === 'annual' ? 'Annual' : 'Monthly'} Pro Key ${
          res.key.keyCode
        } and sent to ${res.recipientEmail} in Tool Mail.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to purchase license key');
    } finally {
      setBusy(false);
    }
  };

  const handleRedeemKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim()) return;
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await apiFetch<{ message: string }>('/api/subscriptions/redeem-key', {
        method: 'POST',
        body: JSON.stringify({ keyCode: keyInput.trim().toUpperCase() }),
      });
      setKeyInput('');
      await Promise.all([refreshProfile(), loadSubscriptions()]);
      setStatusMsg(res.message);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Invalid or expired license key');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleLowerPlanMode = async () => {
    if (!dbUser) return;
    setSwitchingPreview(true);
    setErrorMsg(null);
    try {
      const nextMode = dbUser.viewPlanMode === 'basic' ? 'auto' : 'basic';
      await setViewPlanMode(nextMode);
      setStatusMsg(
        nextMode === 'basic'
          ? 'Switched to Lower-Plan (Basic) preview mode. Your Pro tenure countdown continues normally.'
          : 'Restored Full Active Tier view.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to switch preview mode');
    } finally {
      setSwitchingPreview(false);
    }
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    if (newPassword.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    setSavingPwd(true);
    try {
      const msg = await setAccountPassword(newPassword);
      setNewPassword('');
      setConfirmPassword('');
      setStatusMsg(msg);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save password');
    } finally {
      setSavingPwd(false);
    }
  };

  const handleConfirmCancelPro = async () => {
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await apiFetch<{ message: string }>('/api/subscriptions/cancel-pro', {
        method: 'POST',
        body: JSON.stringify({
          reason: cancelReason.trim(),
          purchaseType: cancelPurchaseType,
        }),
      });
      setConfirmCancelOpen(false);
      setCancelReason('');
      await Promise.all([refreshProfile(), loadSubscriptions()]);
      setStatusMsg(res.message);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to cancel Pro subscription');
    } finally {
      setBusy(false);
    }
  };

  if (isGuest) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 space-y-4 asan-card-hover">
          <div className="flex items-start gap-3">
            <Lock className="mt-1 h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                Subscriptions &amp; Points Require Sign-In
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Pro members must sign in. Sign in with Google or Email &amp; Password to receive <strong>500 initial points</strong>, purchase Monthly (500 pts) or Annual (5,100 pts · 15% off) Pro plans, or redeem 8-character License Keys.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={signIn}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Sign in with Google
            </button>
            <button
              type="button"
              onClick={exitGuestToSignIn}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              Email &amp; Password Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isPro = dbUser?.plan === 'pro';
  const points = dbUser?.points ?? 0;
  // Pro users cannot re-enter Basic until expiry or willing cancellation
  const canPreviewBasic =
    !isPro && (dbUser?.role === 'admin' || dbUser?.role === 'super');
  const isPreviewBasic = !isPro && dbUser?.viewPlanMode === 'basic';

  let daysUntilExpiry: number | null = null;
  let remainingPercent = 0;
  let totalTermDays = 30;
  if (isPro && dbUser?.proExpiresAt) {
    const nowMs = Date.now();
    const expMs = new Date(dbUser.proExpiresAt).getTime();
    const startMs = dbUser.proStartedAt ? new Date(dbUser.proStartedAt).getTime() : nowMs;
    const totalMs = expMs > startMs ? expMs - startMs : 30 * 24 * 60 * 60 * 1000;
    const msLeft = expMs - nowMs;
    if (Number.isFinite(msLeft)) {
      daysUntilExpiry = Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
      totalTermDays = Math.max(1, Math.round(totalMs / (24 * 60 * 60 * 1000)));
      remainingPercent = Math.round(Math.max(0, Math.min(1, msLeft / totalMs)) * 100);
    }
  }

  const recentProTx = transactions.find(
    (t) =>
      t.amount < 0 &&
      (t.category === 'pro_purchase' || t.category === 'pro_key_purchase') &&
      t.verificationStatus !== 'reverted'
  );
  const estimatedPointsPaid = recentProTx ? Math.abs(recentProTx.amount) : 0;
  const estimatedRefundFraction =
    cancelPurchaseType === 'non_timed'
      ? 0.6
      : Math.max(0, remainingPercent - 5) / 100;
  const estimatedRefundPoints =
    estimatedPointsPaid > 0
      ? Math.max(0, Math.round(estimatedPointsPaid * estimatedRefundFraction))
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Subscriptions, Points &amp; License Keys
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            500 pts/month or <strong>5,100 pts/year (15% Annual Discount)</strong> · Email confirmation &amp; 3-day expiry reminders sent automatically.
          </p>
        </div>
        <div className="asan-card-hover flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2.5">
          <Coins className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <div className="text-xs">
            <span className="text-slate-500 dark:text-slate-400">Balance: </span>
            <strong className="font-display text-base text-slate-900 dark:text-white tabular-nums">
              {points.toLocaleString()} pts
            </strong>
          </div>
        </div>
      </div>

      {/* 3-Day Renewal Reminder Banner */}
      {isPro && daysUntilExpiry !== null && daysUntilExpiry <= 3 && (
        <div className="asan-card-hover rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
            <div>
              <strong>Pro Renewal Reminder:</strong> Your Pro plan expires in{' '}
              <strong>{daysUntilExpiry} day(s)</strong> ({dbUser?.proExpiresAt.slice(0, 10)}). Renew below with 500 pts (Monthly) or 5,100 pts (Annual · 15% Off).
            </div>
          </div>
          <a
            href={buildGmailConfirmationUrl({
              recipientEmail: dbUser?.email || '',
              subject: 'ASAN-Study_tool Pro Plan Renewal Reminder',
              body: `Reminder: Your ASAN-Study_tool Pro Plan expires on ${dbUser?.proExpiresAt.slice(
                0,
                10
              )}. Open ASAN-Study_tool -> Subscriptions to renew (500 pts/month or 5,100 pts/year with 15% discount).`,
            })}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-100"
          >
            Open Gmail Reminder
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      {statusMsg && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/50 px-4 py-3 text-xs text-emerald-800 dark:text-emerald-300">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-xs text-red-700 dark:text-red-300">
          {errorMsg}
        </div>
      )}

      {lastPurchasedKey && (
        <div className="asan-card-hover rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="text-xs text-blue-900 dark:text-blue-200 space-y-1">
            <div className="font-semibold">
              Pro License Key Ready:{' '}
              <span className="font-mono text-sm tracking-wider">
                {lastPurchasedKey.keyCode}
              </span>
            </div>
            <div>
              Sent to Tool Mail for {lastPurchasedKey.recipientEmail} · Activate before{' '}
              {lastPurchasedKey.activationExpiresAt.slice(0, 10)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(lastPurchasedKey.keyCode)}
              className="inline-flex items-center gap-1 rounded-lg border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-slate-700"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy Key
            </button>
            <a
              href={buildGmailLicenseComposeUrl(lastPurchasedKey)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              Send to Gmail Mailbox
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      )}

      {/* Active Subscription Summary Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div
          className={`rounded-xl border p-5 asan-card-hover ${
            isPro
              ? 'asan-pro-card border-indigo-200 dark:border-indigo-800/70'
              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Account Plan</span>
            {isPro && <span className="asan-pro-badge rounded px-1.5 py-0.5 text-[9px]">PRO</span>}
          </div>
          <div className="mt-2 font-display text-2xl font-bold text-slate-900 dark:text-white uppercase">
            {dbUser?.plan || 'basic'}
            {isPreviewBasic && (
              <span className="ml-2 text-xs font-semibold text-blue-600 dark:text-blue-400 normal-case">
                (Viewing Basic)
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Role: <strong className="capitalize text-slate-700 dark:text-slate-200">{dbUser?.role || 'user'}</strong>{' '}
            · UID: <strong className="font-mono text-slate-800 dark:text-slate-200">{dbUser?.shortUid}</strong>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 asan-card-hover">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Subscription Start Date</div>
          <div className="mt-2 font-display text-lg font-bold text-slate-900 dark:text-white tabular-nums">
            {isPro && dbUser?.proStartedAt ? dbUser.proStartedAt.slice(0, 10) : '—'}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {isPro ? 'Active Pro tenure' : 'Basic plan (no expiry)'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 asan-card-hover">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Subscription End Date</div>
          <div className="mt-2 font-display text-lg font-bold text-slate-900 dark:text-white tabular-nums">
            {isPro && dbUser?.proExpiresAt ? dbUser.proExpiresAt.slice(0, 10) : '—'}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {isPro
              ? `${daysUntilExpiry ?? 0} day(s) left (${remainingPercent}% remaining)`
              : '500 pts/mo or 5,100 pts/yr (15% off)'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 asan-card-hover">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Available Points</div>
          <div className="mt-2 font-display text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
            {points.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {points >= 5100
              ? 'Enough for Annual Pro (5,100 pts · 15% Off)'
              : points >= 500
                ? 'Enough for Monthly Pro (500 pts)'
                : `Need ${500 - points} more pts for Monthly Pro`}
          </div>
        </div>
      </div>

      {/* Cancellation & Refund Policy + Pro Lock Notice / Admin Lower-Plan Switch */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-indigo-200 dark:border-indigo-800/80 bg-indigo-50/50 dark:bg-indigo-950/30 p-5 space-y-2 asan-card-hover">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <ShieldAlert className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            Subscription Lock &amp; Refund Policy
          </div>
          <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed list-disc pl-4">
            <li>
              <strong>Active Pro Lock:</strong> Pro users cannot return to the Basic plan until their Pro term expires or they willingly cancel below.
            </li>
            <li>
              <strong>Non-Time-Dependent Purchases:</strong> <strong>60%</strong> of points paid are eligible for refund upon cancellation.
            </li>
            <li>
              <strong>Time-Dependent Subscriptions:</strong> Refund equals <strong>remaining percentage of time − 5%</strong> of points paid.
            </li>
            <li>
              <strong>Admin Approval Required:</strong> All cancellation refund requests are sent to Admin Oversight for approval before points are credited back.
            </li>
          </ul>
        </div>

        {isPro ? (
          <div className="rounded-xl border border-amber-200 dark:border-amber-800/80 bg-white dark:bg-slate-900 p-5 space-y-3 asan-card-hover">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                Willing Pro Cancellation &amp; Refund Request
              </div>
              <span className="rounded bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300">
                Admin Approval
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 text-xs">
              <select
                value={cancelPurchaseType}
                onChange={(e) =>
                  setCancelPurchaseType(e.target.value as 'time_dependent' | 'non_timed')
                }
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100"
              >
                <option value="time_dependent">
                  Time-Dependent ({Math.max(0, remainingPercent - 5)}% = {remainingPercent}% left − 5%)
                </option>
                <option value="non_timed">Non-Time-Dependent (60% Flat)</option>
              </select>
              <input
                type="text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Optional reason for cancellation..."
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-xs">
              <span className="text-slate-600 dark:text-slate-300 tabular-nums">
                {estimatedPointsPaid > 0 ? (
                  <>
                    Paid: <strong>{estimatedPointsPaid} pts</strong> · {daysUntilExpiry ?? 0}/
                    {totalTermDays}d left · Est. Refund:{' '}
                    <strong className="text-emerald-700 dark:text-emerald-400">
                      {estimatedRefundPoints} pts
                    </strong>
                  </>
                ) : (
                  'Key / Admin-granted Pro: will revert to Basic and log a 0 pt refund ticket.'
                )}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmCancelOpen(true)}
                className="rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                Cancel Pro &amp; Request Refund
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between gap-3 asan-card-hover">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <FlaskConical className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                Account Tier &amp; Free/Basic Access
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Active view: <strong className="uppercase">{effectivePlan}</strong>. Signed-in accounts start on <strong>Basic</strong> with 500 points. To test the Free Tier, sign out and choose &ldquo;Continue Without Login&rdquo;.
              </p>
            </div>
            {canPreviewBasic && (
              <div className="flex items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800 pt-3">
                <span className="text-xs text-slate-600 dark:text-slate-300">
                  Admin Basic Preview Mode:
                </span>
                <button
                  type="button"
                  disabled={switchingPreview}
                  onClick={handleToggleLowerPlanMode}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    isPreviewBasic
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  {isPreviewBasic ? (
                    <>
                      <ToggleRight className="h-4 w-4" />
                      Basic Preview ON
                    </>
                  ) : (
                    <>
                      <ToggleLeft className="h-4 w-4" />
                      Switch to Basic Preview
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Password Login Setup (Allows non-Google private login) */}
      <form
        onSubmit={handleSavePassword}
        className="asan-card-hover rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"
      >
        <div className="space-y-1 max-w-xl">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <KeyRound className="h-4 w-4 text-slate-700 dark:text-slate-300" />
            Password Login Setup ({dbUser?.hasPassword ? 'Password Configured' : 'Not Set Yet'})
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            Current session: <strong className="uppercase">{authMode}</strong>. Set a password for <strong>{dbUser?.email}</strong> so you can also sign in via Email &amp; Password without Google/Firebase OAuth (Google Workspace features stay hidden in password sessions).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <input
            type="password"
            minLength={6}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password (min 6)"
            className="w-40 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
          />
          <input
            type="password"
            minLength={6}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm password"
            className="w-40 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={savingPwd || !newPassword}
            className="rounded-lg bg-slate-900 dark:bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-blue-700 disabled:opacity-50"
          >
            {savingPwd ? 'Saving...' : dbUser?.hasPassword ? 'Update Password' : 'Set Password'}
          </button>
        </div>
      </form>

      {/* Billing Term Selector (Monthly 500 pts vs Annual 5,100 pts 15% Off) */}
      <div className="asan-card-hover rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="text-xs text-slate-700 dark:text-slate-300">
          <strong className="text-sm text-slate-900 dark:text-white">Select Pro Plan Term:</strong>{' '}
          Choose Monthly (500 pts) or Annual (5,100 pts — <strong>15% discount</strong> off 6,000 pts).
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedTerm('monthly')}
            className={`rounded-lg border px-4 py-2 text-xs font-semibold transition-colors ${
              selectedTerm === 'monthly'
                ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            Monthly · 500 pts (1 mo)
          </button>
          <button
            type="button"
            onClick={() => setSelectedTerm('annual')}
            className={`rounded-lg border px-4 py-2 text-xs font-semibold transition-colors ${
              selectedTerm === 'annual'
                ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            Annual · 5,100 pts (12 mos · 15% Off)
          </button>
        </div>
      </div>

      {/* Action Row: Redeem Points / Purchase Key / Activate Key */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Direct Points Upgrade */}
        <div className="asan-pro-card asan-card-hover rounded-xl border border-indigo-200 dark:border-indigo-800/70 p-6 space-y-4 flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                Instant Pro via Points ({planCost.toLocaleString()} Pts)
              </div>
              <span className="asan-pro-badge rounded px-1.5 py-0.5 text-[9px]">PRO</span>
            </div>
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              Spend <strong>{planCost.toLocaleString()} points</strong> for <strong>{termLabel}</strong> immediately on your signed-in account. Sends email confirmation to Tool Mail (plus Gmail link).
            </p>
          </div>
          <div className="space-y-2">
            <button
              type="button"
              disabled={busy || points < planCost}
              onClick={handleActivateWithPoints}
              className="w-full rounded-lg bg-blue-600 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isPro
                ? `Extend Pro (${termLabel}) · ${planCost.toLocaleString()} Pts`
                : `Activate ${selectedTerm === 'annual' ? 'Annual' : 'Monthly'} Pro (${planCost.toLocaleString()} Pts)`}
            </button>
            {isPro && dbUser?.email && (
              <a
                href={buildGmailConfirmationUrl({
                  recipientEmail: dbUser.email,
                  subject: `ASAN-Study_tool Pro Plan Receipt (Until ${dbUser.proExpiresAt.slice(0, 10)})`,
                  body: `Your ASAN-Study_tool Pro Plan is active from ${dbUser.proStartedAt.slice(
                    0,
                    10
                  )} until ${dbUser.proExpiresAt.slice(0, 10)}.`,
                })}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full items-center justify-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                Open Purchase Confirmation in Gmail
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>

        {/* Purchase 8-Char Pro License Key */}
        <form
          onSubmit={handlePurchaseProKey}
          className="asan-card-hover rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 flex flex-col justify-between"
        >
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <KeyRound className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Purchase 8-Char Pro Key ({planCost.toLocaleString()} Pts)
            </div>
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              Generates an expirable 8-char Pro key (valid <strong>1 year</strong> to activate, gives{' '}
              <strong>{selectedTerm === 'annual' ? '12 months' : '1 month'}</strong> Pro upon activation) and delivers it to Tool Mail + Gmail Mailbox.
            </p>
            <input
              type="text"
              value={giftRecipient}
              onChange={(e) => setGiftRecipient(e.target.value)}
              placeholder="@username, 5-char UID, or email (default: you)"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={busy || points < planCost}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-900 dark:bg-slate-800 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            Purchase {selectedTerm === 'annual' ? 'Annual' : 'Monthly'} Key ({planCost.toLocaleString()} Pts)
          </button>
        </form>

        {/* Activate 8-Char Key */}
        <form
          onSubmit={handleRedeemKey}
          className="asan-card-hover rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 flex flex-col justify-between"
        >
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <CheckCircle2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              Activate 8-Character License Key
            </div>
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              Enter your 8-character Pro License Key (monthly or annual) or constant Admin key if hand-selected by the workspace owner.
            </p>
            <input
              type="text"
              required
              maxLength={8}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value.toUpperCase())}
              placeholder="e.g. A7K9M2P4"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 font-mono text-sm text-slate-900 dark:text-slate-100 uppercase tracking-widest focus:border-blue-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={busy || keyInput.trim().length !== 8}
            className="w-full rounded-lg border border-blue-600 dark:border-blue-500 bg-white dark:bg-slate-800 py-2.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            Activate License Key
          </button>
        </form>
      </div>

      {/* Earning Rules + History */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="asan-card-hover lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Your License Keys &amp; Subscription History
            </h2>
            <CalendarClock className="h-4 w-4 text-slate-400" />
          </div>

          {loading ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-6">Loading license keys...</p>
          ) : keys.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-6">
              No license keys issued or activated yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-3 font-medium">Key / Term</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Activate Before</th>
                    <th className="py-2 pr-3 font-medium">Sub Start → End</th>
                    <th className="py-2 font-medium text-right">Gmail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 tabular-nums">
                  {keys.map((k) => (
                    <tr key={k.id}>
                      <td className="py-2.5 pr-3">
                        <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {k.keyCode}
                        </span>
                        <span className="ml-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                          ({k.durationMonths === 12 ? '12m' : '1m'})
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 capitalize text-slate-700 dark:text-slate-300">{k.status}</td>
                      <td className="py-2.5 pr-3 text-slate-500 dark:text-slate-400">
                        {k.activationExpiresAt.slice(0, 10)}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-600 dark:text-slate-300">
                        {k.subStartsAt
                          ? `${k.subStartsAt.slice(0, 10)} → ${k.subEndsAt.slice(0, 10)}`
                          : 'Not activated'}
                      </td>
                      <td className="py-2.5 text-right">
                        <a
                          href={buildGmailLicenseComposeUrl({
                            recipientEmail: k.issuedToEmail || dbUser?.email || '',
                            keyCode: k.keyCode,
                            activationExpiresAt: k.activationExpiresAt,
                          })}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                        >
                          Open Gmail
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="asan-card-hover lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
          <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Points Ledger &amp; Earning Rules
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              +75 pts Question Paper · +10 pts / 30m Exam Timer · +5 pts Study Calendar Event · +120 pts/wk Contributor · +150 pts/wk Admin
            </p>
          </div>

          {transactions.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-6">No point activity yet.</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 lg:max-h-72 lg:overflow-y-auto">
              {transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between gap-3 py-2.5 text-xs"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-800 dark:text-slate-200">{tx.reason}</div>
                    <div className="text-[11px] text-slate-400 tabular-nums">
                      {new Date(tx.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <span
                    className={`font-mono font-bold tabular-nums shrink-0 ${
                      tx.amount >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {tx.amount >= 0 ? `+${tx.amount}` : tx.amount}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cancellation & Refund Request History */}
      {refundRequests.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-3 asan-card-hover">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            Your Cancellation &amp; Refund Requests ({refundRequests.length})
          </h2>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {refundRequests.map((req) => (
              <div
                key={req.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {req.refundBasis === 'flat_60_percent'
                      ? '60% Refund (Non-Time-Dependent)'
                      : `Remaining Time (${req.remainingPercent}%) − 5%`}
                    {' · '}
                    <span className="font-mono text-emerald-700 dark:text-emerald-400">
                      {req.requestedRefundPoints} pts
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Paid: {req.pointsPaid} pts · Left: {req.remainingDays}/{req.totalDays}d · {req.reason}
                  </div>
                  {req.adminNote && (
                    <div className="text-[11px] text-slate-600 dark:text-slate-300">
                      Admin Note: {req.adminNote} ({req.reviewedByLabel})
                    </div>
                  )}
                </div>
                <span
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase ${
                    req.status === 'approved'
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                      : req.status === 'rejected'
                        ? 'bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                        : 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                  }`}
                >
                  {req.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmCancelOpen}
        title="Cancel Pro Subscription & Request Refund?"
        description={`Your account will immediately revert to Basic. Refund basis: ${
          cancelPurchaseType === 'non_timed'
            ? '60% of points paid (non-time-dependent)'
            : `Remaining time (${remainingPercent}%) − 5%`
        } (${estimatedRefundPoints} estimated pts). An Admin must approve the request before points are credited.`}
        confirmLabel="Cancel Pro & Submit Refund"
        destructive
        busy={busy}
        onConfirm={handleConfirmCancelPro}
        onCancel={() => setConfirmCancelOpen(false)}
      />
    </div>
  );
};
