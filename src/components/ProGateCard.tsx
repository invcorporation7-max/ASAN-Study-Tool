import React, { useState } from 'react';
import { ArrowRight, KeyRound, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';
import type { NavSection } from '../types';

interface ProGateCardProps {
  featureName: string;
  description: string;
  onNavigate: (section: NavSection) => void;
}

export const ProGateCard: React.FC<ProGateCardProps> = ({
  featureName,
  description,
  onNavigate,
}) => {
  const { isGuest, signIn, refreshProfile } = useAuth();
  const [keyInput, setKeyInput] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleRedeemKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = keyInput.trim().toUpperCase();
    if (!cleaned) return;
    setRedeeming(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      await apiFetch('/api/subscriptions/redeem-key', {
        method: 'POST',
        body: JSON.stringify({ keyCode: cleaned }),
      });
      setKeyInput('');
      await refreshProfile();
      setStatusMsg('License key activated! Unlocking Pro workspace...');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Invalid license key');
    } finally {
      setRedeeming(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl py-8">
      <div className="rounded-xl border border-slate-200 bg-white p-8 space-y-5">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
            <Lock className="h-5 w-5" />
          </div>
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-slate-500">
              Pro Feature · Login Required (500 Points/Month or 8-Char License Key)
            </div>
            <h1 className="font-display text-xl font-bold text-slate-900">
              {featureName}
            </h1>
            <p className="text-sm leading-relaxed text-slate-600">
              {description}
            </p>
          </div>
        </div>

        {!isGuest && (
          <form
            onSubmit={handleRedeemKey}
            className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2.5"
          >
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
              <KeyRound className="h-3.5 w-3.5 text-blue-600" />
              Have an 8-Character License Key? Activate Now
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                maxLength={12}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value.toUpperCase())}
                placeholder="Enter 8-char License Key"
                className="flex-1 min-w-[180px] rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs uppercase tracking-wider focus:border-blue-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={redeeming || !keyInput.trim()}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {redeeming ? 'Activating...' : 'Activate Key'}
              </button>
            </div>
            {statusMsg && <p className="text-xs text-emerald-700">{statusMsg}</p>}
            {errorMsg && <p className="text-xs text-red-600">{errorMsg}</p>}
          </form>
        )}

        <div className="border-t border-slate-100 pt-5 flex flex-wrap items-center justify-between gap-4">
          <span className="text-xs text-slate-500">
            {isGuest
              ? 'Pro members must sign in with Google first (500 welcome points included).'
              : 'Redeem 500 points or activate an 8-character License Key in Subscriptions.'}
          </span>
          <div className="flex items-center gap-2">
            {isGuest ? (
              <button
                type="button"
                onClick={signIn}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
              >
                Sign in with Google
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate('subscriptions')}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
              >
                Go to Subscriptions
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
