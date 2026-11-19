import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  Clock,
  Coins,
  KeyRound,
  Lock,
  Mail,
  Shield,
  UserPlus,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { UserAvatarBadge } from './UserAvatarBadge';

export const AuthGate: React.FC = () => {
  const {
    signIn,
    signInWithPassword,
    registerWithPassword,
    switchAccount,
    removeSavedAccount,
    savedAccounts,
    prefillIdentifier,
    continueFreeGuest,
    loading,
    error,
  } = useAuth();

  const [authTab, setAuthTab] = useState<'google' | 'password'>(
    prefillIdentifier ? 'password' : 'google'
  );
  const [pwdMode, setPwdMode] = useState<'login' | 'register'>('login');
  const [identifier, setIdentifier] = useState(prefillIdentifier || '');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (prefillIdentifier) {
      setAuthTab('password');
      setPwdMode('login');
      setIdentifier(prefillIdentifier);
    }
  }, [prefillIdentifier]);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setSubmitting(true);
    try {
      if (pwdMode === 'register') {
        await registerWithPassword({
          email: identifier.trim(),
          password,
          displayName: displayName.trim() || undefined,
        });
      } else {
        await signInWithPassword(identifier.trim(), password);
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-4">
          <div className="flex items-center gap-2.5 shrink-0">
            <img
              src="/pwa-192x192.png"
              alt="ASAN-Study_tool"
              className="h-8 w-8 rounded-lg object-cover shadow-xs"
            />
            <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
              ASAN-Study_tool
            </span>
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <span className="whitespace-nowrap shrink-0">
              Free Tier · Basic (500 Pts on Login) · Pro
            </span>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={continueFreeGuest}
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              Free Tier (No Login)
            </button>
            <button
              type="button"
              onClick={signIn}
              disabled={loading || submitting}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors whitespace-nowrap disabled:opacity-60"
            >
              {loading ? 'Signing in...' : 'Google Sign In'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl flex-1 grid-cols-1 items-start gap-10 px-6 py-10 lg:grid-cols-12">
        <div className="lg:col-span-7 space-y-6">
          <div className="text-xs font-medium tracking-wide text-slate-500">
            Academic Workspace · Google Sign-In or Private Email &amp; Password Login
          </div>
          <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl text-balance">
            Structured A4 notebooks, exam timers, and study planning in one workspace.
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-slate-600">
            Start immediately on the Free Tier (10 A4 PDFs &amp; 150 tasks), sign in with Google for optional Drive/Workspace sync, or use <strong>Email &amp; Password</strong> for a private account without Google OAuth (gets its own 5-char UID, @username, and 500 welcome points).
          </p>

          {/* Login Method Selector */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 shadow-xs">
            <div className="flex border-b border-slate-200 gap-6">
              <button
                type="button"
                onClick={() => setAuthTab('google')}
                className={`pb-2.5 text-sm font-semibold border-b-2 transition-colors ${
                  authTab === 'google'
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                Google Sign-In (Full Workspace)
              </button>
              <button
                type="button"
                onClick={() => setAuthTab('password')}
                className={`pb-2.5 text-sm font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                  authTab === 'password'
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <KeyRound className="h-3.5 w-3.5" />
                Email &amp; Password (No Google Auth)
              </button>
            </div>

            {authTab === 'google' ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-4">
                  <button
                    type="button"
                    onClick={signIn}
                    disabled={loading}
                    className="gsi-material-button shadow-xs"
                  >
                    <div className="gsi-material-button-state"></div>
                    <div className="gsi-material-button-content-wrapper">
                      <div className="gsi-material-button-icon">
                        <svg
                          version="1.1"
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 48 48"
                          style={{ display: 'block' }}
                        >
                          <path
                            fill="#EA4335"
                            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                          />
                          <path
                            fill="#4285F4"
                            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                          />
                          <path
                            fill="#FBBC05"
                            d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                          />
                          <path
                            fill="#34A853"
                            d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                          />
                        </svg>
                      </div>
                      <span className="gsi-material-button-contents">
                        Sign in with Google (Basic · 500 Pts)
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={continueFreeGuest}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-100 transition-colors whitespace-nowrap"
                  >
                    Continue on Free Tier (No Login)
                  </button>
                </div>

                <p className="text-xs text-slate-500">
                  No Google Drive or Workspace permissions are asked during login. After login, we ask one step at a time if you want a single <code className="rounded bg-slate-100 px-1 py-0.5">ASAN-user-content</code> folder in your Drive.
                </p>
              </div>
            ) : (
              <form onSubmit={handlePasswordSubmit} className="space-y-3.5">
                <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <span className="flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                    Private login without Google Auth — Google Workspace features stay hidden.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setLocalError(null);
                      setPwdMode(pwdMode === 'login' ? 'register' : 'login');
                    }}
                    className="font-semibold text-blue-600 hover:underline whitespace-nowrap"
                  >
                    {pwdMode === 'login' ? 'Create Account' : 'Have an account? Sign In'}
                  </button>
                </div>

                {pwdMode === 'register' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Display Name (optional)
                    </label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="e.g., Aarav Sharma"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    {pwdMode === 'register'
                      ? 'Email Address (generates 5-char UID & @username)'
                      : 'Email, @username, or 5-char User ID'}
                  </label>
                  <input
                    type={pwdMode === 'register' ? 'email' : 'text'}
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder={pwdMode === 'register' ? 'you@example.com' : 'email, @username, or X9K2P'}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Password (min 6 characters)
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="submit"
                    disabled={submitting || loading}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {pwdMode === 'register' ? (
                      <>
                        <UserPlus className="h-4 w-4" />
                        {submitting ? 'Creating Account...' : 'Create Account (500 Pts)'}
                      </>
                    ) : (
                      <>
                        <KeyRound className="h-4 w-4" />
                        {submitting ? 'Signing In...' : 'Sign In with Password'}
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={continueFreeGuest}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Free Tier (No Login)
                  </button>
                </div>
              </form>
            )}

            {(localError || error) && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {localError || error}
              </div>
            )}
          </div>

          {savedAccounts.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Users className="h-3.5 w-3.5" />
                Switch Saved Accounts
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {savedAccounts.map((acc) => (
                  <div
                    key={acc.uid}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50"
                  >
                    <button
                      type="button"
                      onClick={() => switchAccount(acc)}
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
                        <div className="truncate text-xs font-semibold text-slate-900">
                          {acc.displayName}
                        </div>
                        <div className="truncate text-[11px] text-slate-500">
                          @{acc.username} · {acc.authMode === 'password' ? 'Password' : 'Google'}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSavedAccount(acc.uid)}
                      className="text-[11px] text-slate-400 hover:text-red-600 px-1"
                      title="Remove saved shortcut"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-5">
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Tier &amp; Points Structure
            </h2>
            <div className="divide-y divide-slate-100">
              <div className="flex items-start gap-3 py-3 first:pt-0">
                <BookOpen className="mt-0.5 h-4 w-4 text-blue-600 shrink-0" />
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    Free Tier vs Basic Login
                  </div>
                  <p className="text-xs text-slate-500">
                    Free Tier supports up to 10 A4 PDF notes &amp; 150 tasks locally. Basic (Google or Password Sign-In) unlocks unlimited notes, tasks, Tool Mail &amp; optional Drive backup.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 py-3">
                <Coins className="mt-0.5 h-4 w-4 text-amber-600 shrink-0" />
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    500 Initial Points &amp; Study Rewards
                  </div>
                  <p className="text-xs text-slate-500">
                    Earn +75 pts uploading question papers, +10 pts per 30 mins on Exam Timers, and +5 pts per study-verified Calendar event. Unlock Pro for 500 pts/month.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 py-3">
                <Clock className="mt-0.5 h-4 w-4 text-blue-600 shrink-0" />
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    Exam Test Timers &amp; Microsecond Stopwatch
                  </div>
                  <p className="text-xs text-slate-500">
                    JEE, NEET, CBSE, ISC &amp; CUET timers with seating schedules, reading/writing phases, and automated audio alarms.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 py-3">
                <Mail className="mt-0.5 h-4 w-4 text-blue-600 shrink-0" />
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    Tool Mail (Username, User ID, Public &amp; Self)
                  </div>
                  <p className="text-xs text-slate-500">
                    Send direct, multi-recipient, self-archived, or public mail to ASAN-Study_tool users with live suggestions.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 py-3 last:pb-0">
                <Lock className="mt-0.5 h-4 w-4 text-slate-400 shrink-0" />
                <div>
                  <div className="text-sm font-medium text-slate-700">
                    Pro Plan &amp; 8-Char License Keys
                  </div>
                  <p className="text-xs text-slate-500">
                    Pro requires sign-in (500 pts/month or 8-char License Key) and unlocks PDF Booklet Studio, Spectra AI, and optional Google Workspace tools (Google login only).
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
