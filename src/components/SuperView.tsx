import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownUp,
  Ban,
  CloudUpload,
  Coins,
  Crown,
  Download,
  RefreshCw,
  Search,
  ShieldAlert,
  Sliders,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  apiFetch,
  ensureNamedDriveFolder,
  ensureSubfolderInDrive,
  fetchContributorFileBlob,
  uploadFileToDriveFolder,
} from '../lib/api';
import type {
  ContributorFileItem,
  ContributorFolderItem,
  LicenseKeyItem,
  SuperUserPointRow,
  SuperUsersPointsResponse,
} from '../types';
import { GA4AnalyticsPanel } from './GA4AnalyticsPanel';
import { UserAvatarBadge } from './UserAvatarBadge';

type UserFilter = 'all' | 'pro' | 'basic' | 'contributors' | 'admins' | 'google' | 'password';
type UserSort = 'points_desc' | 'points_asc' | 'newest' | 'name_asc';

export const SuperView: React.FC = () => {
  const { dbUser, isSuper, isWorkspaceEnabled, workspaceToken, connectBasicDrive, refreshProfile } =
    useAuth();

  const [ledger, setLedger] = useState<SuperUsersPointsResponse | null>(null);
  const [licenseKeys, setLicenseKeys] = useState<LicenseKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // User Directory filter/sort
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState<UserFilter>('all');
  const [sortBy, setSortBy] = useState<UserSort>('points_desc');
  const [txFilter, setTxFilter] = useState('');

  // Super Controls State
  const [pointsUserId, setPointsUserId] = useState('');
  const [pointsOp, setPointsOp] = useState<'add' | 'deduct'>('add');
  const [pointsAmount, setPointsAmount] = useState('100');
  const [pointsReason, setPointsReason] = useState('');

  const [actionUserId, setActionUserId] = useState('');
  const [superAction, setSuperAction] = useState<
    'terminate_pro' | 'grant_pro' | 'cancel_contributor' | 'revoke_admin'
  >('terminate_pro');
  const [superActionReason, setSuperActionReason] = useState('');

  const [weeklyStipendInput, setWeeklyStipendInput] = useState('120');
  const [syncingMaster, setSyncingMaster] = useState(false);

  const loadSuperData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [superRes, adminRes] = await Promise.all([
        apiFetch<SuperUsersPointsResponse>('/api/super/users-points'),
        apiFetch<{ licenseKeys?: LicenseKeyItem[] }>('/api/admin/overview').catch(() => ({
          licenseKeys: [],
        })),
      ]);
      setLedger(superRes);
      setLicenseKeys(adminRes.licenseKeys || []);
      setWeeklyStipendInput(String(superRes.summary.contributorWeeklyPoints));
      if (superRes.users.length > 0) {
        setPointsUserId((prev) => prev || String(superRes.users[0].id));
        setActionUserId((prev) => prev || String(superRes.users[0].id));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load Super Console');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSuper) {
      void loadSuperData();
    }
  }, [isSuper, loadSuperData]);

  const filteredUsers = useMemo<SuperUserPointRow[]>(() => {
    if (!ledger) return [];
    const q = searchTerm.trim().toLowerCase();
    const list = ledger.users.filter((u) => {
      if (filterMode === 'pro' && u.plan !== 'pro') return false;
      if (filterMode === 'basic' && u.plan === 'pro') return false;
      if (filterMode === 'contributors' && !u.contributorApproved) return false;
      if (filterMode === 'admins' && u.role !== 'admin' && u.role !== 'super') return false;
      if (filterMode === 'google' && (u.authMode || 'google') !== 'google') return false;
      if (filterMode === 'password' && u.authMode !== 'password') return false;

      if (!q) return true;
      return (
        u.displayName.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.shortUid || '').toLowerCase().includes(q)
      );
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'points_desc') return (b.points || 0) - (a.points || 0);
      if (sortBy === 'points_asc') return (a.points || 0) - (b.points || 0);
      if (sortBy === 'name_asc') return a.displayName.localeCompare(b.displayName);
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
  }, [ledger, searchTerm, filterMode, sortBy]);

  const filteredTransactions = useMemo(() => {
    if (!ledger) return [];
    const q = txFilter.trim().toLowerCase();
    if (!q) return ledger.recentTransactions;
    return ledger.recentTransactions.filter(
      (tx) =>
        tx.username.toLowerCase().includes(q) ||
        tx.userEmail.toLowerCase().includes(q) ||
        tx.shortUid.toLowerCase().includes(q) ||
        tx.reason.toLowerCase().includes(q) ||
        tx.category.toLowerCase().includes(q)
    );
  }, [ledger, txFilter]);

  if (!isSuper) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <div className="rounded-xl border border-violet-200 bg-white p-8 text-center space-y-2">
          <Crown className="mx-auto h-6 w-6 text-violet-600" />
          <h1 className="font-display text-lg font-bold text-slate-900">
            Super Developer Mode Restricted
          </h1>
          <p className="text-xs text-slate-500">
            This console is restricted exclusively to the workspace owner (invcorporation7@gmail.com).
          </p>
        </div>
      </div>
    );
  }

  const handleAdjustPoints = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pointsUserId || !pointsReason.trim()) return;
    const rawAmt = Math.abs(Math.round(Number(pointsAmount) || 0));
    if (rawAmt <= 0) {
      setErrorMsg('Enter a point amount greater than 0.');
      return;
    }
    const signedAmount = pointsOp === 'deduct' ? -rawAmt : rawAmt;
    setBusy(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ user: SuperUserPointRow }>('/api/super/adjust-points', {
        method: 'POST',
        body: JSON.stringify({
          targetUserId: Number(pointsUserId),
          amount: signedAmount,
          reason: pointsReason.trim(),
        }),
      });
      setPointsReason('');
      setStatusMsg(
        `Updated @${res.user.username} to ${res.user.points.toLocaleString()} pts (${
          signedAmount > 0 ? `+${signedAmount}` : signedAmount
        } pts) and delivered Tool Mail notice.`
      );
      await loadSuperData();
      await refreshProfile();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to adjust points');
    } finally {
      setBusy(false);
    }
  };

  const handleSuperAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionUserId) return;
    setBusy(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ message: string }>('/api/super/terminate-plan', {
        method: 'POST',
        body: JSON.stringify({
          targetUserId: Number(actionUserId),
          action: superAction,
          reason: superActionReason.trim(),
        }),
      });
      setSuperActionReason('');
      setStatusMsg(res.message || 'Super action completed.');
      await loadSuperData();
      await refreshProfile();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to execute Super action');
    } finally {
      setBusy(false);
    }
  };

  const handleCancelLicenseKey = async (k: LicenseKeyItem) => {
    setBusy(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ message: string }>('/api/super/terminate-plan', {
        method: 'POST',
        body: JSON.stringify({
          action: 'cancel_key',
          keyId: k.id,
          reason: 'Cancelled by Super Developer Mode',
        }),
      });
      setStatusMsg(res.message || `Cancelled key ${k.keyCode}`);
      await loadSuperData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to cancel license key');
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateWeeklyStipend = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ contributorWeeklyPoints: number }>(
        '/api/super/contributor-weekly-points',
        {
          method: 'POST',
          body: JSON.stringify({ points: Number(weeklyStipendInput) }),
        }
      );
      setStatusMsg(`Contributor weekly income updated to ${res.contributorWeeklyPoints} pts/week.`);
      await loadSuperData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update weekly stipend');
    } finally {
      setBusy(false);
    }
  };

  const handleSyncAllContributorsToMasterDrive = async () => {
    setSyncingMaster(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      if (!workspaceToken) {
        const tok = await connectBasicDrive();
        if (!tok) {
          setSyncingMaster(false);
          return;
        }
      }
      const queue = await apiFetch<{
        folders: ContributorFolderItem[];
        files: ContributorFileItem[];
      }>('/api/super/master-sync-queue');
      const masterRoot = await ensureNamedDriveFolder('ASAN-Master-Folder');
      const usernameMap = new Map<string, string>();
      const folderDriveMap = new Map<string, string>();

      const getContribRoot = async (username: string) => {
        const clean = username || 'contributor';
        const existing = usernameMap.get(clean);
        if (existing) return existing;
        const created = await ensureSubfolderInDrive(clean, masterRoot.id);
        usernameMap.set(clean, created.id);
        return created.id;
      };

      let syncedCount = 0;
      for (const f of queue.files.filter((x) => !x.masterDriveFileId)) {
        const rootId = await getContribRoot(f.username);
        let targetParentId = rootId;
        if (f.folderPath) {
          const segments = f.folderPath.split('/').filter(Boolean);
          let curPath = f.username;
          for (const seg of segments) {
            curPath = `${curPath}/${seg}`;
            let subId = folderDriveMap.get(curPath);
            if (!subId) {
              const sub = await ensureSubfolderInDrive(seg, targetParentId);
              subId = sub.id;
              folderDriveMap.set(curPath, subId);
            }
            targetParentId = subId;
          }
        }
        const blob = await fetchContributorFileBlob(f.id);
        const fileObj = new File([blob], f.fileName, {
          type: f.mimeType || 'application/octet-stream',
        });
        const uploaded = await uploadFileToDriveFolder(fileObj, targetParentId);
        await apiFetch(`/api/contributor-console/files/${f.id}/drive`, {
          method: 'PATCH',
          body: JSON.stringify({
            masterDriveFileId: uploaded.id,
            masterDriveWebLink: uploaded.webViewLink || '',
          }),
        });
        syncedCount += 1;
      }
      setStatusMsg(
        syncedCount > 0
          ? `Synced ${syncedCount} contributor file(s) into ASAN-Master-Folder/<username>.`
          : 'All contributor files are already synced inside ASAN-Master-Folder.'
      );
      await loadSuperData();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to sync contributor files to ASAN-Master-Folder'
      );
    } finally {
      setSyncingMaster(false);
    }
  };

  const handleExportUsersCsv = () => {
    if (!filteredUsers.length) return;
    const headers = [
      'ID',
      'ShortUID',
      'DisplayName',
      'Username',
      'Email',
      'AuthMode',
      'Role',
      'Plan',
      'CurrentPoints',
      'PointsEarned',
      'PointsSpent',
      'ContributorApproved',
      'CreatedAt',
    ];
    const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      headers.join(','),
      ...filteredUsers.map((u) =>
        [
          u.id,
          u.shortUid,
          u.displayName,
          u.username,
          u.email,
          u.authMode || 'google',
          u.role,
          u.plan,
          u.points,
          u.pointsEarned,
          u.pointsSpent,
          u.contributorApproved,
          u.createdAt || '',
        ]
          .map(escape)
          .join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `asan-super-users-points-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-violet-700" />
            <h1 className="font-display text-2xl font-bold text-slate-900">
              Super Console · All Users, Points &amp; GA4 Reporting
            </h1>
            <span className="rounded border border-violet-300 bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-800">
              OWNER ONLY
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            Signed in as <strong>{dbUser?.email}</strong> · Complete user points ledger, point overrides with Tool Mail reasons, and Google Analytics 4 traffic.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isWorkspaceEnabled && (
            <button
              type="button"
              disabled={syncingMaster}
              onClick={() => void handleSyncAllContributorsToMasterDrive()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-violet-800 disabled:opacity-60"
            >
              <CloudUpload className="h-3.5 w-3.5" />
              {syncingMaster ? 'Syncing...' : 'Sync All → ASAN-Master-Folder'}
            </button>
          )}
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadSuperData()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Reload Ledger
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
          {errorMsg}
        </div>
      )}

      {/* GA4 Reporting on Super Page */}
      <GA4AnalyticsPanel title="Google Analytics (GA4) — Super Overview" />

      {loading || !ledger ? (
        <div className="py-10 text-center text-xs text-slate-500">
          Loading Super users &amp; points ledger...
        </div>
      ) : (
        <>
          {/* Economy Summary Strip */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5 tabular-nums">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                <span>Total Users</span>
                <Users className="h-4 w-4 text-blue-600" />
              </div>
              <div className="mt-1.5 font-display text-2xl font-bold text-slate-900">
                {ledger.summary.totalUsers}
              </div>
              <div className="text-[11px] text-slate-500">
                {ledger.summary.proUsers} Pro · {ledger.summary.basicUsers} Basic
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
              <div className="flex items-center justify-between text-xs font-medium text-amber-800">
                <span>Points Circulating</span>
                <Coins className="h-4 w-4 text-amber-600" />
              </div>
              <div className="mt-1.5 font-display text-2xl font-bold text-amber-950">
                {ledger.summary.totalPointsCirculating.toLocaleString()}
              </div>
              <div className="text-[11px] text-amber-700">Combined user balances</div>
            </div>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
              <div className="flex items-center justify-between text-xs font-medium text-emerald-800">
                <span>Total Awarded</span>
                <TrendingUp className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="mt-1.5 font-display text-2xl font-bold text-emerald-950">
                +{ledger.summary.totalPointsEarned.toLocaleString()}
              </div>
              <div className="text-[11px] text-emerald-700">Rewards, bonuses &amp; stipends</div>
            </div>

            <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-4">
              <div className="flex items-center justify-between text-xs font-medium text-rose-800">
                <span>Spent / Deducted</span>
                <TrendingDown className="h-4 w-4 text-rose-600" />
              </div>
              <div className="mt-1.5 font-display text-2xl font-bold text-rose-950">
                −{ledger.summary.totalPointsSpent.toLocaleString()}
              </div>
              <div className="text-[11px] text-rose-700">Plans, materials &amp; deductions</div>
            </div>

            <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
              <div className="flex items-center justify-between text-xs font-medium text-violet-800">
                <span>Contributors</span>
                <Sliders className="h-4 w-4 text-violet-600" />
              </div>
              <div className="mt-1.5 font-display text-2xl font-bold text-violet-950">
                {ledger.summary.approvedContributors}
              </div>
              <div className="text-[11px] text-violet-700">
                {ledger.summary.contributorWeeklyPoints} pts / Sunday
              </div>
            </div>
          </div>

          {/* All Users & Their Points Directory */}
          <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  All Registered Users &amp; Points ({filteredUsers.length} of {ledger.users.length})
                </h2>
                <p className="text-xs text-slate-500">
                  Click &ldquo;Adjust +/−&rdquo; on any user to credit or deduct points with an instant Tool Mail explanation.
                </p>
              </div>
              <button
                type="button"
                onClick={handleExportUsersCsv}
                disabled={filteredUsers.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </button>
            </div>

            {/* Search, Filter, Sort */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative flex-1 max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by name, @username, email, or 5-char UID..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 py-2 text-xs focus:border-violet-500 focus:bg-white focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 text-[11px]">
                  {(
                    [
                      ['all', 'All'],
                      ['pro', 'Pro'],
                      ['basic', 'Basic'],
                      ['contributors', 'Contributors'],
                      ['admins', 'Admins'],
                      ['google', 'Google'],
                      ['password', 'Password'],
                    ] as const
                  ).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setFilterMode(val)}
                      className={`rounded-md px-2.5 py-1 font-medium ${
                        filterMode === val
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs">
                  <ArrowDownUp className="h-3.5 w-3.5 text-slate-400" />
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as UserSort)}
                    className="bg-transparent text-xs font-medium text-slate-700 focus:outline-none"
                  >
                    <option value="points_desc">Highest Points</option>
                    <option value="points_asc">Lowest Points</option>
                    <option value="newest">Newest Users</option>
                    <option value="name_asc">Name A–Z</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2.5 pr-3 font-medium">User / 5-Char UID</th>
                    <th className="py-2.5 pr-3 font-medium">Auth &amp; Role</th>
                    <th className="py-2.5 pr-3 font-medium">Plan</th>
                    <th className="py-2.5 pr-3 font-medium text-right">Current Points</th>
                    <th className="py-2.5 pr-3 font-medium text-right">Earned / Spent</th>
                    <th className="py-2.5 pr-3 font-medium text-right">Activity</th>
                    <th className="py-2.5 font-medium text-right">Quick Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500">
                        No users match your search or filter.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((u) => (
                      <tr key={u.id} className="hover:bg-slate-50/70">
                        <td className="py-3 pr-3">
                          <div className="flex items-center gap-2.5">
                            <UserAvatarBadge
                              name={u.displayName}
                              photoUrl={u.photoUrl}
                              plan={u.plan}
                              role={u.role}
                              contributorApproved={u.contributorApproved}
                              size="sm"
                            />
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-900">
                                {u.displayName}{' '}
                                <span className="font-mono text-blue-700">@{u.username}</span>
                              </div>
                              <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-1.5">
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono font-bold text-slate-800">
                                  {u.shortUid || `U${u.id}`}
                                </span>
                                <span>{u.email}</span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 pr-3">
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-700">
                              {u.authMode === 'password' ? 'Password' : 'Google'}
                            </span>
                            {u.role === 'super' && (
                              <span className="rounded border border-violet-300 bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-900">
                                SUPER
                              </span>
                            )}
                            {u.role === 'admin' && (
                              <span className="rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                                ADMIN
                              </span>
                            )}
                            {u.contributorApproved && (
                              <span className="rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                                Contributor
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 pr-3">
                          <span
                            className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase ${
                              u.plan === 'pro'
                                ? 'border border-indigo-200 bg-indigo-50 text-indigo-700'
                                : 'border border-blue-200 bg-blue-50 text-blue-700'
                            }`}
                          >
                            {u.plan}
                          </span>
                          {u.plan === 'pro' && u.proExpiresAt && (
                            <div className="mt-0.5 text-[10px] text-slate-500">
                              ends {u.proExpiresAt.slice(0, 10)}
                            </div>
                          )}
                        </td>
                        <td className="py-3 pr-3 text-right">
                          <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 font-mono text-xs font-bold text-amber-900">
                            {u.points.toLocaleString()} pts
                          </span>
                        </td>
                        <td className="py-3 pr-3 text-right text-[11px]">
                          <span className="font-semibold text-emerald-700">
                            +{u.pointsEarned.toLocaleString()}
                          </span>
                          {' / '}
                          <span className="font-semibold text-rose-700">
                            −{u.pointsSpent.toLocaleString()}
                          </span>
                          <div className="text-[10px] text-slate-400">{u.txCount} tx</div>
                        </td>
                        <td className="py-3 pr-3 text-right text-[11px] text-slate-500">
                          {u.notesCount} notes · {u.tasksCount} tasks · {u.materialsCount} uploads
                        </td>
                        <td className="py-3 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setPointsUserId(String(u.id));
                              setActionUserId(String(u.id));
                            }}
                            className="rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-800 hover:bg-violet-100"
                          >
                            Select for +/−
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Super Developer Controls */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* Adjust Points */}
            <form
              onSubmit={handleAdjustPoints}
              className="rounded-xl border border-slate-200 bg-white p-5 space-y-3"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Coins className="h-4 w-4 text-amber-600" />
                Add / Deduct Any User&apos;s Points
              </div>
              <select
                value={pointsUserId}
                onChange={(e) => setPointsUserId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                {ledger.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    @{u.username} ({u.shortUid}) · {u.points.toLocaleString()} pts
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={pointsOp}
                  onChange={(e) => setPointsOp(e.target.value as 'add' | 'deduct')}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium"
                >
                  <option value="add">Add (+)</option>
                  <option value="deduct">Deduct (−)</option>
                </select>
                <input
                  type="number"
                  min={1}
                  max={1000000}
                  required
                  value={pointsAmount}
                  onChange={(e) => setPointsAmount(e.target.value)}
                  placeholder="Amount"
                  className="rounded-lg border border-slate-200 px-3 py-2 text-xs tabular-nums"
                />
              </div>
              <input
                type="text"
                required
                value={pointsReason}
                onChange={(e) => setPointsReason(e.target.value)}
                placeholder="Reason (sent directly to user's Tool Mail)"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
              />
              <button
                type="submit"
                disabled={busy}
                className={`w-full rounded-lg py-2 text-xs font-semibold text-white ${
                  pointsOp === 'deduct'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {pointsOp === 'deduct' ? 'Deduct Points & Send Mail' : 'Add Points & Send Mail'}
              </button>
            </form>

            {/* Terminate / Cancel Plans & Approvals */}
            <form
              onSubmit={handleSuperAction}
              className="rounded-xl border border-slate-200 bg-white p-5 space-y-3"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ShieldAlert className="h-4 w-4 text-red-600" />
                Terminate Plans &amp; Cancel Approvals
              </div>
              <select
                value={actionUserId}
                onChange={(e) => setActionUserId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                {ledger.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    @{u.username} · {u.plan.toUpperCase()} · {u.role}
                  </option>
                ))}
              </select>
              <select
                value={superAction}
                onChange={(e) =>
                  setSuperAction(
                    e.target.value as
                      | 'terminate_pro'
                      | 'grant_pro'
                      | 'cancel_contributor'
                      | 'revoke_admin'
                  )
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium"
              >
                <option value="terminate_pro">Terminate Pro Plan (Revert to Basic)</option>
                <option value="grant_pro">Grant 1-Month Pro Plan</option>
                <option value="cancel_contributor">Cancel Contributor Approval</option>
                <option value="revoke_admin">Revoke Admin Authorization</option>
              </select>
              <input
                type="text"
                value={superActionReason}
                onChange={(e) => setSuperActionReason(e.target.value)}
                placeholder="Reason for Tool Mail notification..."
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
              />
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-slate-900 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Execute Super Action
              </button>
            </form>

            {/* Contributor Weekly Income */}
            <form
              onSubmit={handleUpdateWeeklyStipend}
              className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 flex flex-col justify-between"
            >
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Sliders className="h-4 w-4 text-violet-700" />
                  Contributor Weekly Income
                </div>
                <p className="text-xs text-slate-500">
                  Points credited every Sunday to approved Contributors. Currently{' '}
                  <strong>{ledger.summary.contributorWeeklyPoints} pts/week</strong>.
                </p>
                <input
                  type="number"
                  min={0}
                  max={100000}
                  required
                  value={weeklyStipendInput}
                  onChange={(e) => setWeeklyStipendInput(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold tabular-nums"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-violet-700 py-2 text-xs font-semibold text-white hover:bg-violet-800"
              >
                Save Contributor Weekly Points
              </button>
            </form>
          </div>

          {/* Global Point Transactions Audit Log */}
          <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  Global Points Audit Ledger ({filteredTransactions.length})
                </h2>
                <p className="text-xs text-slate-500">
                  Every point addition, deduction, Pro upgrade, study reward, and weekly stipend recorded across all accounts.
                </p>
              </div>
              <input
                type="search"
                value={txFilter}
                onChange={(e) => setTxFilter(e.target.value)}
                placeholder="Filter ledger by @user, UID, or reason..."
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs focus:border-violet-500 focus:bg-white focus:outline-none w-64"
              />
            </div>

            {filteredTransactions.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">
                No matching point transactions logged yet.
              </p>
            ) : (
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 pr-3 font-medium">User</th>
                      <th className="py-2 pr-3 font-medium">Change</th>
                      <th className="py-2 pr-3 font-medium">Category</th>
                      <th className="py-2 pr-3 font-medium">Reason</th>
                      <th className="py-2 font-medium text-right">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {filteredTransactions.map((tx) => (
                      <tr key={tx.id}>
                        <td className="py-2.5 pr-3">
                          <span className="font-semibold text-slate-900">@{tx.username}</span>{' '}
                          <span className="font-mono text-[10px] text-slate-500">
                            {tx.shortUid}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3">
                          <span
                            className={`rounded px-2 py-0.5 font-mono font-bold ${
                              tx.amount >= 0
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-rose-50 text-rose-700'
                            }`}
                          >
                            {tx.amount >= 0 ? `+${tx.amount}` : tx.amount} pts
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 text-slate-500 capitalize">
                          {tx.category.replace(/_/g, ' ')}
                        </td>
                        <td className="py-2.5 pr-3 text-slate-700">{tx.reason}</td>
                        <td className="py-2.5 text-right text-slate-500">
                          {new Date(tx.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* License Key Cancellation Control */}
          {licenseKeys.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-sm font-bold text-slate-900">
                  License Key Cancellation Control ({licenseKeys.length})
                </h2>
                <span className="text-[11px] text-slate-500">
                  Revoke unused or active 8-char Pro license keys
                </span>
              </div>
              <div className="overflow-x-auto max-h-56 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 pr-3 font-medium">Key</th>
                      <th className="py-2 pr-3 font-medium">Issued To</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 pr-3 font-medium">Term</th>
                      <th className="py-2 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {licenseKeys.slice(0, 30).map((k) => (
                      <tr key={k.id}>
                        <td className="py-2 pr-3 font-mono font-semibold text-slate-900">
                          {k.keyCode}
                        </td>
                        <td className="py-2 pr-3 text-slate-600">
                          {k.issuedToEmail || 'Unassigned'}
                        </td>
                        <td className="py-2 pr-3 capitalize">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              k.status === 'cancelled'
                                ? 'bg-red-50 text-red-700'
                                : k.status === 'active'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-blue-50 text-blue-700'
                            }`}
                          >
                            {k.status}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-slate-500">
                          {k.durationMonths === 12 ? '12 mo' : '1 mo'}
                        </td>
                        <td className="py-2 text-right">
                          {k.status !== 'cancelled' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleCancelLicenseKey(k)}
                              className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-100"
                            >
                              <Ban className="h-3 w-3" />
                              Cancel Key
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
};
