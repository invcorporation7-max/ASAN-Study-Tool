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
import type { LicenseKeyItem, PointTransactionItem } from '../types';

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
  const [loading, setLoading] = useState(true);

  const [selectedTerm, setSelectedTerm] = useState<'monthly' | 'annual'>('monthly');
  const [keyInput, setKeyInput] = useState('');
  const [giftRecipient, setGiftRecipient] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [switchingPreview, setSwitchingPreview] = useState(false);
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
      }>('/api/subscriptions');
      setKeys(data.keys || []);
      setTransactions(data.transactions || []);
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

  if (isGuest) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <div className="rounded-xl border border-slate-200 bg-white p-8 space-y-4">
          <div className="flex items-start gap-3">
            <Lock className="mt-1 h-5 w-5 text-blue-600 shrink-0" />
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900">
                Subscriptions &amp; Points Require Sign-In
              </h1>
              <p className="mt-1 text-sm text-slate-600">
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
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
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
  const canPreviewBasic =
    dbUser?.plan === 'pro' || dbUser?.role === 'admin' || dbUser?.role === 'super';
  const isPreviewBasic = dbUser?.viewPlanMode === 'basic';

  let daysUntilExpiry: number | null = null;
  if (isPro && dbUser?.proExpiresAt) {
    const msLeft = new Date(dbUser.proExpiresAt).getTime() - Date.now();
    if (Number.isFinite(msLeft)) {
      daysUntilExpiry = Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Subscriptions, Points &amp; License Keys
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            500 pts/month or <strong>5,100 pts/year (15% Annual Discount)</strong> · Email confirmation &amp; 3-day expiry reminders sent automatically.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5">
          <Coins className="h-4 w-4 text-amber-600" />
          <div className="text-xs">
            <span className="text-slate-500">Balance: </span>
            <strong className="font-display text-base text-slate-900 tabular-nums">
              {points.toLocaleString()} pts
            </strong>
          </div>
        </div>
      </div>

      {/* 3-Day Renewal Reminder Banner */}
      {isPro && daysUntilExpiry !== null && daysUntilExpiry <= 3 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs text-amber-900">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
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
            className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
          >
            Open Gmail Reminder
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      {statusMsg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {errorMsg}
        </div>
      )}

      {lastPurchasedKey && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="text-xs text-blue-900 space-y-1">
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
              className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
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
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Account Plan (Effective View)</div>
          <div className="mt-2 font-display text-2xl font-bold text-slate-900 uppercase">
            {dbUser?.plan || 'basic'}
            {isPreviewBasic && (
              <span className="ml-2 text-xs font-semibold text-blue-600 normal-case">
                (Viewing Basic)
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Role: <strong className="capitalize text-slate-700">{dbUser?.role || 'user'}</strong>{' '}
            · UID: <strong className="font-mono text-slate-800">{dbUser?.shortUid}</strong>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Subscription Start Date</div>
          <div className="mt-2 font-display text-lg font-bold text-slate-900 tabular-nums">
            {isPro && dbUser?.proStartedAt ? dbUser.proStartedAt.slice(0, 10) : '—'}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {isPro ? 'Active Pro tenure' : 'Basic plan (no expiry)'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Subscription End Date</div>
          <div className="mt-2 font-display text-lg font-bold text-slate-900 tabular-nums">
            {isPro && dbUser?.proExpiresAt ? dbUser.proExpiresAt.slice(0, 10) : '—'}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {isPro
              ? isPreviewBasic
                ? 'Still counting down during Basic preview'
                : `${daysUntilExpiry ?? 0} day(s) left`
              : '500 pts/mo or 5,100 pts/yr (15% off)'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Available Points</div>
          <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {points.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {points >= 5100
              ? 'Enough for Annual Pro (5,100 pts · 15% Off)'
              : points >= 500
                ? 'Enough for Monthly Pro (500 pts)'
                : `Need ${500 - points} more pts for Monthly Pro`}
          </div>
        </div>
      </div>

      {/* Lower-Plan Switch (Pro/Admin -> Basic) + How to Test Basic Version */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {canPreviewBasic && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 flex items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                Use Lower Plan (Basic Preview Mode)
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Experience Basic-tier restrictions even while holding Pro or Admin.{' '}
                <strong>Does NOT stop or pause your Pro plan expiry countdown.</strong>
              </p>
            </div>
            <button
              type="button"
              disabled={switchingPreview}
              onClick={handleToggleLowerPlanMode}
              className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold shrink-0 transition-colors ${
                isPreviewBasic
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'border border-slate-300 bg-slate-50 text-slate-800 hover:bg-slate-100'
              }`}
            >
              {isPreviewBasic ? (
                <>
                  <ToggleRight className="h-4 w-4" />
                  Basic Preview ON (Restore {dbUser?.plan?.toUpperCase()})
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

        <div
          className={`rounded-xl border border-slate-200 bg-white p-5 space-y-1.5 ${
            canPreviewBasic ? '' : 'lg:col-span-2'
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <FlaskConical className="h-4 w-4 text-blue-600" />
            How to Test Basic &amp; Free Versions
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            <strong>1) Lower-Plan Switch:</strong> Pro, Admin &amp; Super users can toggle &ldquo;Basic Preview&rdquo; above without losing their Pro expiry date (active view: <strong className="uppercase">{effectivePlan}</strong>).{' '}
            <strong>2) Fresh Account:</strong> Any newly signed-in account starts on the <strong>Basic Plan</strong> with 500 points.{' '}
            <strong>3) Free Tier:</strong> Sign out and choose &ldquo;Continue Free&rdquo; on the login screen.
          </p>
        </div>
      </div>

      {/* Password Login Setup (Allows non-Google private login) */}
      <form
        onSubmit={handleSavePassword}
        className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"
      >
        <div className="space-y-1 max-w-xl">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <KeyRound className="h-4 w-4 text-slate-700" />
            Password Login Setup ({dbUser?.hasPassword ? 'Password Configured' : 'Not Set Yet'})
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
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
            className="w-40 rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
          />
          <input
            type="password"
            minLength={6}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm password"
            className="w-40 rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={savingPwd || !newPassword}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {savingPwd ? 'Saving...' : dbUser?.hasPassword ? 'Update Password' : 'Set Password'}
          </button>
        </div>
      </form>

      {/* Billing Term Selector (Monthly 500 pts vs Annual 5,100 pts 15% Off) */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="text-xs text-slate-700">
          <strong className="text-sm text-slate-900">Select Pro Plan Term:</strong>{' '}
          Choose Monthly (500 pts) or Annual (5,100 pts — <strong>15% discount</strong> off 6,000 pts).
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedTerm('monthly')}
            className={`rounded-lg border px-4 py-2 text-xs font-semibold transition-colors ${
              selectedTerm === 'monthly'
                ? 'border-blue-600 bg-blue-50 text-blue-700'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            Monthly · 500 pts (1 mo)
          </button>
          <button
            type="button"
            onClick={() => setSelectedTerm('annual')}
            className={`rounded-lg border px-4 py-2 text-xs font-semibold transition-colors ${
              selectedTerm === 'annual'
                ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            Annual · 5,100 pts (12 mos · 15% Off)
          </button>
        </div>
      </div>

      {/* Action Row: Redeem Points / Purchase Key / Activate Key */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Direct Points Upgrade */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4 flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Sparkles className="h-4 w-4 text-blue-600" />
              Instant Pro via Points ({planCost.toLocaleString()} Pts)
            </div>
            <p className="text-xs leading-relaxed text-slate-600">
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
                className="inline-flex w-full items-center justify-center gap-1 text-[11px] font-medium text-blue-600 hover:underline"
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
          className="rounded-xl border border-slate-200 bg-white p-6 space-y-4 flex flex-col justify-between"
        >
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <KeyRound className="h-4 w-4 text-emerald-600" />
              Purchase 8-Char Pro Key ({planCost.toLocaleString()} Pts)
            </div>
            <p className="text-xs leading-relaxed text-slate-600">
              Generates an expirable 8-char Pro key (valid <strong>1 year</strong> to activate, gives{' '}
              <strong>{selectedTerm === 'annual' ? '12 months' : '1 month'}</strong> Pro upon activation) and delivers it to Tool Mail + Gmail Mailbox.
            </p>
            <input
              type="text"
              value={giftRecipient}
              onChange={(e) => setGiftRecipient(e.target.value)}
              placeholder="@username, 5-char UID, or email (default: you)"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={busy || points < planCost}
            className="w-full rounded-lg border border-slate-300 bg-slate-900 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Purchase {selectedTerm === 'annual' ? 'Annual' : 'Monthly'} Key ({planCost.toLocaleString()} Pts)
          </button>
        </form>

        {/* Activate 8-Char Key */}
        <form
          onSubmit={handleRedeemKey}
          className="rounded-xl border border-slate-200 bg-white p-6 space-y-4 flex flex-col justify-between"
        >
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <CheckCircle2 className="h-4 w-4 text-blue-600" />
              Activate 8-Character License Key
            </div>
            <p className="text-xs leading-relaxed text-slate-600">
              Enter your 8-character Pro License Key (monthly or annual) or constant Admin key if hand-selected by the workspace owner.
            </p>
            <input
              type="text"
              required
              maxLength={8}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value.toUpperCase())}
              placeholder="e.g. A7K9M2P4"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm uppercase tracking-widest focus:border-blue-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={busy || keyInput.trim().length !== 8}
            className="w-full rounded-lg border border-blue-600 bg-white py-2.5 text-xs font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-50"
          >
            Activate License Key
          </button>
        </form>
      </div>

      {/* Earning Rules + History */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Your License Keys &amp; Subscription History
            </h2>
            <CalendarClock className="h-4 w-4 text-slate-400" />
          </div>

          {loading ? (
            <p className="text-xs text-slate-500 py-6">Loading license keys...</p>
          ) : keys.length === 0 ? (
            <p className="text-xs text-slate-500 py-6">
              No license keys issued or activated yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-3 font-medium">Key / Term</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Activate Before</th>
                    <th className="py-2 pr-3 font-medium">Sub Start → End</th>
                    <th className="py-2 font-medium text-right">Gmail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {keys.map((k) => (
                    <tr key={k.id}>
                      <td className="py-2.5 pr-3">
                        <span className="font-mono font-semibold text-slate-900">
                          {k.keyCode}
                        </span>
                        <span className="ml-1.5 text-[10px] text-slate-500">
                          ({k.durationMonths === 12 ? '12m' : '1m'})
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 capitalize text-slate-700">{k.status}</td>
                      <td className="py-2.5 pr-3 text-slate-500">
                        {k.activationExpiresAt.slice(0, 10)}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-600">
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
                          className="text-blue-600 hover:underline whitespace-nowrap"
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

        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Points Ledger &amp; Earning Rules
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              +75 pts Question Paper · +10 pts / 30m Exam Timer · +5 pts Study Calendar Event · +120 pts/wk Contributor · +150 pts/wk Admin
            </p>
          </div>

          {transactions.length === 0 ? (
            <p className="text-xs text-slate-500 py-6">No point activity yet.</p>
          ) : (
            <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between gap-3 py-2.5 text-xs"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-800">{tx.reason}</div>
                    <div className="text-[11px] text-slate-400 tabular-nums">
                      {new Date(tx.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <span
                    className={`font-mono font-bold tabular-nums shrink-0 ${
                      tx.amount >= 0 ? 'text-emerald-600' : 'text-red-600'
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
    </div>
  );
};
