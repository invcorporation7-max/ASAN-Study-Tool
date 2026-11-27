import React, { useState } from 'react';
import { ArrowRight, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';
import type { NavSection } from '../types';

interface ProGateCardProps {
  featureName: string;
  description: string;
  requiredPlan?: 'pro' | 'elite';
  onNavigate: (section: NavSection) => void;
}

export const ProGateCard: React.FC<ProGateCardProps> = ({
  featureName,
  description,
  requiredPlan = 'pro',
  onNavigate,
}) => {
  const { dbUser, isGuest, signIn, exitGuestToSignIn, refreshProfile } = useAuth();
  const [keyInput, setKeyInput] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [overlapKeyPending, setOverlapKeyPending] = useState<string | null>(null);

  const isEliteGate = requiredPlan === 'elite';
  const visualEffectsOn = dbUser?.eliteVisualEffects !== false;

  const submitRedeem = async (cleaned: string, proHandling?: 'keep' | 'cancel') => {
    setRedeeming(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ message?: string }>('/api/subscriptions/redeem-key', {
        method: 'POST',
        body: JSON.stringify({
          keyCode: cleaned,
          ...(proHandling ? { proHandling } : {}),
        }),
      });
      setKeyInput('');
      setOverlapKeyPending(null);
      await refreshProfile();
      setStatusMsg(
        res.message ||
          `License key activated! Unlocking ${isEliteGate ? 'Elite' : 'Pro'} workspace...`
      );
    } catch (err) {
      const code = (err as { code?: string })?.code;
      const msg = err instanceof Error ? err.message : 'Invalid license key';
      if (
        code === 'PRO_OVERLAP_CHOICE_REQUIRED' ||
        /Choose whether to keep or cancel Pro|keep.*cancel Pro/i.test(msg)
      ) {
        setOverlapKeyPending(cleaned);
        setErrorMsg(
          'Your account currently has an active Pro plan. Elite already includes all Pro features — choose whether to Keep Pro (resumes after Elite expires) or Cancel Pro now.'
        );
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setRedeeming(false);
    }
  };

  const handleRedeemKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = keyInput.trim().toUpperCase();
    if (!cleaned) return;
    if (isEliteGate && cleaned.length !== 12) {
      setErrorMsg(
        'This app is exclusively for Elite members. Please enter a 12-character Elite license key (8-character Pro keys do not unlock Elite-only labs).'
      );
      return;
    }
    await submitRedeem(cleaned);
  };

  return (
    <div className="mx-auto max-w-2xl py-8">
      <div
        className={`asan-card-hover rounded-xl border p-8 space-y-5 bg-white dark:bg-slate-900 ${
          isEliteGate
            ? `${visualEffectsOn ? 'asan-elite-card' : ''} border-blue-900/40 dark:border-cyan-400/50`
            : 'asan-pro-card border-indigo-200 dark:border-indigo-800/70'
        }`}
      >
        <div className="flex items-start gap-4">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${
              isEliteGate
                ? 'bg-blue-950/10 dark:bg-cyan-950/60 text-blue-900 dark:text-cyan-300'
                : 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-300'
            }`}
          >
            {isEliteGate ? <ShieldCheck className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
          </div>
          <div className="space-y-1.5">
            <div
              className={`flex flex-wrap items-center gap-2 text-xs font-medium ${
                isEliteGate
                  ? 'text-blue-900 dark:text-cyan-300'
                  : 'text-indigo-700 dark:text-indigo-300'
              }`}
            >
              <span
                className={`${
                  isEliteGate ? 'asan-elite-badge' : 'asan-pro-badge'
                } rounded px-1.5 py-0.5 text-[10px] font-bold`}
              >
                {isEliteGate ? 'ELITE ONLY' : 'PRO & ELITE'}
              </span>
              <span>
                {isEliteGate
                  ? 'Exclusive to Elite Plan (750 Pts/Mo · 8,000 Pts/Yr or 12-Char Key)'
                  : 'Login Required (500 Pts/Mo Pro · 750 Pts/Mo Elite or License Key)'}
              </span>
            </div>
            <h1 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">
              {featureName}
            </h1>
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {description}
            </p>
          </div>
        </div>

        {!isGuest && (
          <form
            onSubmit={handleRedeemKey}
            className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-4 space-y-2.5"
          >
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
              <KeyRound className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              {isEliteGate
                ? 'Have a 12-Character Elite License Key? Activate Now'
                : 'Have an 8-Char Pro or 12-Char Elite License Key? Activate Now'}
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                maxLength={12}
                value={keyInput}
                onChange={(e) => {
                  setKeyInput(e.target.value.toUpperCase());
                  setOverlapKeyPending(null);
                }}
                placeholder={isEliteGate ? 'Enter 12-char Elite Key' : '8-char Pro / 12-char Elite'}
                className="flex-1 min-w-[180px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono text-xs uppercase tracking-wider focus:border-blue-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={redeeming || !keyInput.trim()}
                className="rounded-lg bg-slate-900 dark:bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                {redeeming ? 'Activating...' : 'Activate Key'}
              </button>
            </div>
            {overlapKeyPending && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={redeeming}
                  onClick={() => void submitRedeem(overlapKeyPending, 'keep')}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  Keep Pro Alongside Elite
                </button>
                <button
                  type="button"
                  disabled={redeeming}
                  onClick={() => void submitRedeem(overlapKeyPending, 'cancel')}
                  className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/60 px-3 py-1.5 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-100 disabled:opacity-60"
                >
                  Cancel Pro &amp; Activate Elite
                </button>
              </div>
            )}
            {statusMsg && (
              <p className="text-xs text-emerald-700 dark:text-emerald-400">{statusMsg}</p>
            )}
            {errorMsg && <p className="text-xs text-red-600 dark:text-red-400">{errorMsg}</p>}
          </form>
        )}

        <div className="border-t border-slate-100 dark:border-slate-800 pt-5 flex flex-wrap items-center justify-between gap-4">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {isGuest
              ? 'Sign in first to unlock points, subscriptions, and license activation.'
              : isEliteGate
                ? 'Upgrade to Elite with points or a 12-character Elite key in Subscriptions and Plans.'
                : 'Upgrade to Pro/Elite or activate a license key in Subscriptions and Plans.'}
          </span>
          <div className="flex items-center gap-2">
            {isGuest ? (
              <button
                type="button"
                onClick={exitGuestToSignIn || signIn}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
              >
                Sign In to Continue
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate('subscriptions')}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white whitespace-nowrap shrink-0 ${
                  isEliteGate
                    ? 'bg-blue-900 dark:bg-cyan-600 hover:bg-blue-800 dark:hover:bg-cyan-500'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                Go to Subscriptions and Plans
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
