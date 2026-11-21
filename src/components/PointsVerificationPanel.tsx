import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type {
  AdminPointTransactionsResponse,
  SuperAuditTransactionItem,
} from '../types';

type VerificationFilter =
  | 'pending'
  | 'all'
  | 'awards'
  | 'deductions'
  | 'verified'
  | 'reverted';

export const PointsVerificationPanel: React.FC<{
  onReviewed?: () => void;
}> = ({ onReviewed }) => {
  const [data, setData] = useState<AdminPointTransactionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [filter, setFilter] = useState<VerificationFilter>('pending');
  const [query, setQuery] = useState('');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Active revert/dismiss review dialog state
  const [activeTx, setActiveTx] = useState<{
    tx: SuperAuditTransactionItem;
    action: 'revert' | 'dismiss';
  } | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch<AdminPointTransactionsResponse>(
        '/api/admin/point-transactions'
      );
      setData(res);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to load point transactions'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTransactions();
  }, [loadTransactions]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.transactions.filter((tx) => {
      const st = tx.verificationStatus || 'pending';
      if (filter === 'pending' && st !== 'pending') return false;
      if (filter === 'verified' && st !== 'verified') return false;
      if (filter === 'reverted' && st !== 'reverted' && st !== 'dismissed') {
        return false;
      }
      if (filter === 'awards' && tx.amount <= 0) return false;
      if (filter === 'deductions' && tx.amount >= 0) return false;
      if (!q) return true;
      const hay =
        `${tx.username} ${tx.displayName} ${tx.shortUid} ${tx.userEmail} ${tx.reason} ${tx.category}`.toLowerCase();
      return hay.includes(q);
    });
  }, [data, filter, query]);

  const handleVerify = async (tx: SuperAuditTransactionItem) => {
    setBusyId(tx.id);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      await apiFetch(`/api/admin/point-transactions/${tx.id}/review`, {
        method: 'POST',
        body: JSON.stringify({
          action: 'verify',
          note: 'Verified as justified by Admin',
        }),
      });
      setStatusMsg(
        `Verified transaction #${tx.id} (${tx.amount >= 0 ? `+${tx.amount}` : tx.amount} pts) for @${tx.username}.`
      );
      await loadTransactions();
      onReviewed?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmRevertOrDismiss = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTx) return;
    if (!reviewNote.trim()) {
      setErrorMsg('Please provide a justification reason for reverting or dismissing.');
      return;
    }
    setBusyId(activeTx.tx.id);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ reversedDelta?: number; newBalance?: number }>(
        `/api/admin/point-transactions/${activeTx.tx.id}/review`,
        {
          method: 'POST',
          body: JSON.stringify({
            action: activeTx.action,
            note: reviewNote.trim(),
          }),
        }
      );
      const deltaStr =
        typeof res.reversedDelta === 'number'
          ? `${res.reversedDelta >= 0 ? `+${res.reversedDelta}` : res.reversedDelta} pts`
          : 'balance adjusted';
      setStatusMsg(
        `${activeTx.action === 'dismiss' ? 'Dismissed' : 'Reverted'} transaction #${activeTx.tx.id} for @${activeTx.tx.username} (${deltaStr}) and sent Tool Mail justification.`
      );
      setActiveTx(null);
      setReviewNote('');
      await loadTransactions();
      onReviewed?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to reverse transaction');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4">
        <div className="flex items-start gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              Admin Point Award &amp; Deduction Verification
            </h2>
            <p className="text-xs text-slate-500">
              Inspect every point award (+pts) and deduction (−pts). Verify justified activity or revert/dismiss unjustified transactions with automatic balance reversal &amp; Tool Mail notice.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void loadTransactions()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 min-h-[38px] shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Queue
        </button>
      </div>

      {data && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5 text-xs tabular-nums">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[11px] text-slate-500">Total Logged</div>
            <div className="font-display text-base font-bold text-slate-900">
              {data.summary.total}
            </div>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2">
            <div className="text-[11px] text-amber-800">Pending Review</div>
            <div className="font-display text-base font-bold text-amber-900">
              {data.summary.pending}
            </div>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2">
            <div className="text-[11px] text-emerald-800">Verified</div>
            <div className="font-display text-base font-bold text-emerald-900">
              {data.summary.verified}
            </div>
          </div>
          <div className="rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-2">
            <div className="text-[11px] text-rose-800">Reverted</div>
            <div className="font-display text-base font-bold text-rose-900">
              {data.summary.reverted}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-100/80 px-3 py-2 col-span-2 sm:col-span-1">
            <div className="text-[11px] text-slate-600">Dismissed</div>
            <div className="font-display text-base font-bold text-slate-900">
              {data.summary.dismissed}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 text-xs">
          {(
            [
              { id: 'pending', label: `Pending (${data?.summary.pending ?? 0})` },
              { id: 'all', label: 'All' },
              { id: 'awards', label: 'Awards (+)' },
              { id: 'deductions', label: 'Deductions (−)' },
              { id: 'verified', label: 'Verified' },
              { id: 'reverted', label: 'Reverted / Dismissed' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`rounded-md px-2.5 py-1.5 font-medium whitespace-nowrap transition-colors ${
                filter === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by @user, UID, reason..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 py-2 text-xs focus:border-blue-500 focus:bg-white focus:outline-none"
          />
        </div>
      </div>

      {statusMsg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
          {errorMsg}
        </div>
      )}

      {activeTx && (
        <form
          onSubmit={handleConfirmRevertOrDismiss}
          className="rounded-xl border border-rose-200 bg-rose-50/60 p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-bold text-rose-950">
              {activeTx.action === 'dismiss' ? 'Dismiss & Reverse' : 'Revert & Reverse'} Tx #
              {activeTx.tx.id} — @{activeTx.tx.username} ({activeTx.tx.amount >= 0 ? `+${activeTx.tx.amount}` : activeTx.tx.amount} pts)
            </div>
            <button
              type="button"
              onClick={() => {
                setActiveTx(null);
                setReviewNote('');
              }}
              className="text-xs font-medium text-slate-600 hover:text-slate-900"
            >
              Cancel
            </button>
          </div>
          <p className="text-[11px] text-rose-900">
            Original reason: <strong>{activeTx.tx.reason}</strong>. Reversing this will adjust @{activeTx.tx.username}&apos;s balance by{' '}
            <strong>
              {activeTx.tx.amount >= 0
                ? `−${activeTx.tx.amount}`
                : `+${Math.abs(activeTx.tx.amount)}`}{' '}
              pts
            </strong>{' '}
            and deliver your justification to their Tool Mail.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              required
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder="Explain why this transaction is not justified (required)..."
              className="flex-1 rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs focus:border-rose-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={busyId === activeTx.tx.id}
              className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60 whitespace-nowrap"
            >
              {busyId === activeTx.tx.id
                ? 'Reversing...'
                : activeTx.action === 'dismiss'
                  ? 'Confirm Dismiss & Reverse'
                  : 'Confirm Revert & Reverse'}
            </button>
          </div>
        </form>
      )}

      {loading && !data ? (
        <p className="py-6 text-center text-xs text-slate-500">
          Loading point audit queue...
        </p>
      ) : filtered.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-500">
          No transactions match this filter.
        </p>
      ) : (
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full min-w-[740px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 pr-3 font-medium">Tx / User</th>
                <th className="py-2 pr-3 font-medium">Delta</th>
                <th className="py-2 pr-3 font-medium">Category &amp; Reason</th>
                <th className="py-2 pr-3 font-medium">Audit Status</th>
                <th className="py-2 text-right font-medium">Admin Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {filtered.map((tx) => {
                const st = tx.verificationStatus || 'pending';
                const isReversalRow = tx.category === 'admin_reversal';
                const alreadyReversed = st === 'reverted' || st === 'dismissed';
                return (
                  <tr key={tx.id} className="align-top hover:bg-slate-50/70">
                    <td className="py-2.5 pr-3">
                      <div className="font-semibold text-slate-900">
                        #{tx.id} · @{tx.username}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {tx.shortUid || `U${tx.userId}`} · Bal: {tx.currentBalance ?? 0} pts
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {new Date(tx.createdAt).toLocaleString()}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">
                      <span
                        className={`inline-block rounded px-2 py-0.5 font-mono font-bold ${
                          tx.amount >= 0
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-rose-50 text-rose-700'
                        }`}
                      >
                        {tx.amount >= 0 ? `+${tx.amount}` : tx.amount} pts
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 max-w-xs">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                        {tx.category.replace(/_/g, ' ')}
                      </div>
                      <div className="text-slate-800">{tx.reason}</div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                          st === 'verified'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : st === 'reverted'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : st === 'dismissed'
                                ? 'bg-slate-100 text-slate-700 border border-slate-300'
                                : 'bg-amber-50 text-amber-800 border border-amber-200'
                        }`}
                      >
                        {st}
                      </span>
                      {tx.verifiedByLabel && (
                        <div className="mt-1 text-[10px] text-slate-500">
                          {tx.verifiedByLabel}
                        </div>
                      )}
                      {tx.verificationNote && (
                        <div className="text-[10px] text-slate-600 italic">
                          &ldquo;{tx.verificationNote}&rdquo;
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      {!isReversalRow && !alreadyReversed ? (
                        <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                          {st !== 'verified' && (
                            <button
                              type="button"
                              disabled={busyId === tx.id}
                              onClick={() => void handleVerify(tx)}
                              className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Verify
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busyId === tx.id}
                            onClick={() => {
                              setActiveTx({ tx, action: 'revert' });
                              setReviewNote('');
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-100"
                          >
                            <RotateCcw className="h-3 w-3" />
                            Revert
                          </button>
                          <button
                            type="button"
                            disabled={busyId === tx.id}
                            onClick={() => {
                              setActiveTx({ tx, action: 'dismiss' });
                              setReviewNote('');
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            <XCircle className="h-3 w-3" />
                            Dismiss
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-400">
                          {isReversalRow ? 'Audit Reversal' : 'Closed'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
