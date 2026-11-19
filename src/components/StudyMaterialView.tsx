import React, { useCallback, useEffect, useState } from 'react';
import {
  Award,
  Clock,
  CloudUpload,
  Coins,
  Download,
  ExternalLink,
  FileUp,
  FolderOpen,
  Lock,
  ShoppingBag,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  apiFetch,
  downloadStudyMaterialFile,
  ensureNamedDriveFolder,
  fetchStudyMaterialBlob,
  uploadFileToDriveFolder,
  uploadStudyMaterialBinary,
} from '../lib/api';
import type { MaterialPurchaseItem, StudyMaterialItem } from '../types';
import { ConfirmDialog } from './ConfirmDialog';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function detectClientPdfPageCount(selectedFile: File): Promise<number> {
  const isPdf =
    selectedFile.type.toLowerCase().includes('pdf') ||
    selectedFile.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) return 1;
  try {
    const slice = selectedFile.slice(0, 4 * 1024 * 1024);
    const buffer = await slice.arrayBuffer();
    const raw = new TextDecoder('latin1').decode(buffer);
    const countMatches = [...raw.matchAll(/\/Count\s+(\d+)/g)].map((m) =>
      Number.parseInt(m[1], 10)
    );
    const plausible = countMatches.filter((n) => Number.isFinite(n) && n > 0 && n <= 50000);
    if (plausible.length > 0) {
      return Math.max(...plausible);
    }
    const pageMatches = raw.match(/\/Type\s*\/Page\b(?!s)/g);
    if (pageMatches && pageMatches.length > 0) {
      return pageMatches.length;
    }
  } catch {
    // ignore
  }
  return 1;
}

export const StudyMaterialView: React.FC = () => {
  const {
    dbUser,
    isGuest,
    isWorkspaceEnabled,
    signIn,
    refreshProfile,
    workspaceToken,
    connectBasicDrive,
  } = useAuth();

  const [materials, setMaterials] = useState<StudyMaterialItem[]>([]);
  const [purchases, setPurchases] = useState<MaterialPurchaseItem[]>([]);
  const [contributorAccess, setContributorAccess] = useState(false);
  const [contributorRequested, setContributorRequested] = useState(false);
  const [showRequestBox, setShowRequestBox] = useState(false);
  const [requestNote, setRequestNote] = useState('');
  const [requestSending, setRequestSending] = useState(false);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('Physics');
  const [category, setCategory] = useState<'question_paper' | 'study_notes' | 'booklet' | 'archive'>(
    'question_paper'
  );
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [hourlyRentCost, setHourlyRentCost] = useState(10);
  const [buyCost, setBuyCost] = useState(40);
  const [buyCostTouched, setBuyCostTouched] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [acquiringId, setAcquiringId] = useState<number | null>(null);
  const [rentHoursMap, setRentHoursMap] = useState<Record<number, number>>({});
  const [deleteTarget, setDeleteTarget] = useState<StudyMaterialItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadMaterials = useCallback(async () => {
    if (isGuest || !dbUser) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch<{
        materials: StudyMaterialItem[];
        purchases: MaterialPurchaseItem[];
        contributorAccess: boolean;
        contributorRequested: boolean;
      }>('/api/study-materials');
      setMaterials(res.materials || []);
      setPurchases(res.purchases || []);
      setContributorAccess(Boolean(res.contributorAccess));
      setContributorRequested(Boolean(res.contributorRequested));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load study materials');
    } finally {
      setLoading(false);
    }
  }, [dbUser, isGuest]);

  useEffect(() => {
    loadMaterials();
  }, [loadMaterials]);

  useEffect(() => {
    if (contributorAccess) {
      setCategory('study_notes');
    } else {
      setCategory('question_paper');
    }
  }, [contributorAccess]);

  const handleSelectFile = async (selected: File | null) => {
    setFile(selected);
    if (!selected) {
      setPageCount(1);
      return;
    }
    const detected = await detectClientPdfPageCount(selected);
    setPageCount(detected);
  };

  const handleApplyContributor = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setRequestSending(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await apiFetch('/api/contributor/request', {
        method: 'POST',
        body: JSON.stringify({ message: requestNote.trim() }),
      });
      await refreshProfile();
      await loadMaterials();
      setShowRequestBox(false);
      setRequestNote('');
      setStatusMsg(
        'Contributor request sent to Admin & Super via Tool Mail! Once approved, you unlock the Contributors Console and weekly stipend.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to submit request');
    } finally {
      setRequestSending(false);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setErrorMsg('Please choose a file to upload.');
      return;
    }
    const cleanHourly = Number(hourlyRentCost);
    const cleanPages = Math.max(1, Math.round(Number(pageCount) || 1));
    const cleanBuy = Math.max(5, Math.round(Number(buyCost) || cleanHourly * 4));
    if (!Number.isFinite(cleanHourly) || cleanHourly < 5 || cleanHourly > 100) {
      setErrorMsg('Hourly rent cost must be between 5 and 100 points.');
      return;
    }

    setUploading(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await uploadStudyMaterialBinary<{
        material: StudyMaterialItem;
        pointsAwarded: number;
      }>(file, {
        title: title.trim() || file.name,
        subject: subject.trim() || 'General',
        category,
        pageCount: cleanPages,
        hourlyRentCost: cleanHourly,
        buyCost: cleanBuy,
      });

      setTitle('');
      setFile(null);
      setPageCount(1);
      setHourlyRentCost(10);
      setBuyCost(40);
      setBuyCostTouched(false);
      await Promise.all([refreshProfile(), loadMaterials()]);
      setStatusMsg(
        res.pointsAwarded > 0
          ? `Uploaded "${res.material.title}" (${res.material.pageCount} pg · Rent ${res.material.hourlyRentCost} pts/hr · Buy ${res.material.buyCost} pts) and awarded +${res.pointsAwarded} points!`
          : `Uploaded "${res.material.title}" (${formatBytes(res.material.fileSizeBytes)}, ${res.material.pageCount} pg · Rent ${res.material.hourlyRentCost} pts/hr).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleAcquire = async (
    item: StudyMaterialItem,
    accessType: 'rent' | 'buy',
    hours = 2
  ) => {
    setAcquiringId(item.id);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await apiFetch<{ purchase: MaterialPurchaseItem; balanceAfter: number }>(
        `/api/study-materials/${item.id}/acquire`,
        {
          method: 'POST',
          body: JSON.stringify({ accessType, hours }),
        }
      );
      await Promise.all([refreshProfile(), loadMaterials()]);
      setStatusMsg(
        accessType === 'rent'
          ? `Rented "${item.title}" for ${hours}h (-${res.purchase.totalCost} pts). Balance: ${res.balanceAfter} pts.`
          : `Purchased permanent access to "${item.title}" (-${res.purchase.totalCost} pts). Balance: ${res.balanceAfter} pts.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not complete acquisition');
    } finally {
      setAcquiringId(null);
    }
  };

  const handleMirrorToAsanUserContentDrive = async (item: StudyMaterialItem) => {
    if (!isWorkspaceEnabled) {
      setErrorMsg('Google Drive sync is hidden in private Email & Password mode.');
      return;
    }
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      if (!workspaceToken) {
        const tok = await connectBasicDrive();
        if (!tok) return;
      }
      const folder = await ensureNamedDriveFolder('ASAN-user-content');
      const blob = await fetchStudyMaterialBlob(item.id);
      const driveFile = new File([blob], item.fileName, { type: item.mimeType });
      const uploaded = await uploadFileToDriveFolder(driveFile, folder.id);
      await apiFetch(`/api/study-materials/${item.id}/drive`, {
        method: 'PATCH',
        body: JSON.stringify({
          driveFileId: uploaded.id,
          driveWebLink: uploaded.webViewLink || '',
        }),
      });
      await loadMaterials();
      setStatusMsg(`Mirrored "${item.fileName}" to Google Drive folder "ASAN-user-content".`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Drive mirror failed');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setErrorMsg(null);
    try {
      await apiFetch(`/api/study-materials/${deleteTarget.id}`, { method: 'DELETE' });
      setStatusMsg(`Deleted "${deleteTarget.title}".`);
      setDeleteTarget(null);
      await loadMaterials();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
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
                Study Material Notes &amp; Question Papers
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                Sign in with Google to upload Question Papers (+75 points each), rent or buy repository materials (5–100 pts/hr), or apply to become an approved Contributor (+120 points/week).
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
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Study Material Notes &amp; Question Papers
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Upload Question Papers (+75 pts). Rent materials hourly (5–100 pts/hr) or buy permanent access with your points (50% royalty credited to uploader).
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          {contributorAccess ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 font-medium text-emerald-800">
              <Award className="h-3.5 w-3.5" />
              {dbUser?.role === 'admin' || dbUser?.role === 'super'
                ? 'Admin / Super Repository Access'
                : 'Approved Contributor Tag'}
            </span>
          ) : contributorRequested ? (
            <span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 font-medium text-amber-800">
              Contributor Request Pending Admin Approval
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setShowRequestBox((v) => !v)}
              className="rounded-lg border border-red-600 bg-white px-3.5 py-1.5 font-medium text-red-600 hover:bg-red-50 whitespace-nowrap shrink-0"
            >
              Request Admin for Contributor Tag
            </button>
          )}
        </div>
      </div>

      {showRequestBox && !contributorAccess && !contributorRequested && (
        <form
          onSubmit={handleApplyContributor}
          className="rounded-xl border border-red-200 bg-red-50/40 p-4 space-y-3"
        >
          <div className="text-xs font-semibold text-slate-900">
            Send Contributor Tag Request to Admin &amp; Super (Tool Mail)
          </div>
          <textarea
            rows={2}
            value={requestNote}
            onChange={(e) => setRequestNote(e.target.value)}
            placeholder="Optional message: subjects, notes, PDFs, or Word docs you plan to organize..."
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-red-500 focus:outline-none"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowRequestBox(false)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={requestSending}
              className="rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              {requestSending ? 'Sending Mail to Admin...' : 'Send Request Mail to Admin'}
            </button>
          </div>
        </form>
      )}

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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Upload Card */}
        <form
          onSubmit={handleUpload}
          className="lg:col-span-5 h-fit rounded-xl border border-slate-200 bg-white p-6 space-y-4"
        >
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <FileUp className="h-4 w-4 text-blue-600" />
            <h2 className="font-display text-base font-semibold text-slate-900">
              {contributorAccess
                ? 'Upload Study Material / Question Paper'
                : 'Upload Question Paper (+75 Points)'}
            </h2>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600">Title</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., JEE Adv 2024 Physics Paper 1"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600">Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">Category</label>
              <select
                value={category}
                onChange={(e) =>
                  setCategory(
                    e.target.value as 'question_paper' | 'study_notes' | 'booklet' | 'archive'
                  )
                }
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="question_paper">Question Paper (+75 pts)</option>
                {contributorAccess && (
                  <>
                    <option value="study_notes">Study Material Notes (Large)</option>
                    <option value="booklet">A4 Revision Booklet</option>
                    <option value="archive">Complete Subject Archive</option>
                  </>
                )}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600">PDF Pages</label>
              <input
                type="number"
                min={1}
                max={50000}
                value={pageCount}
                onChange={(e) => setPageCount(Math.max(1, Number(e.target.value) || 1))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm tabular-nums focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">
                Rent/Hr (5–100)
              </label>
              <input
                type="number"
                min={5}
                max={100}
                required
                value={hourlyRentCost}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setHourlyRentCost(val);
                  if (!buyCostTouched && Number.isFinite(val)) {
                    setBuyCost(Math.max(5, Math.round(val * 4)));
                  }
                }}
                className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm tabular-nums focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">Buy Cost (Pts)</label>
              <input
                type="number"
                min={5}
                required
                value={buyCost}
                onChange={(e) => {
                  setBuyCostTouched(true);
                  setBuyCost(Number(e.target.value));
                }}
                className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm tabular-nums focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600">
              Choose File (PDF pages auto-detected, up to 500 MB per upload)
            </label>
            <input
              type="file"
              required
              onChange={(e) => handleSelectFile(e.target.files?.[0] || null)}
              className="mt-1 block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200"
            />
            {file && (
              <div className="mt-1 text-[11px] text-slate-500 tabular-nums">
                Selected: {file.name} ({formatBytes(file.size)}) · {pageCount} page(s)
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={uploading || !file}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            <CloudUpload className="h-4 w-4" />
            {uploading
              ? 'Streaming Upload...'
              : category === 'question_paper'
                ? 'Upload & Earn +75 Pts'
                : 'Upload to Study Repository'}
          </button>

          {!contributorAccess && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600 leading-relaxed">
              <strong>Contributor-Only Note Repository:</strong> Full Study Material Notes archive access (browsing and uploading large multi-MB study packs stored in server storage &amp; <code className="font-mono">ASAN-user-content</code>) unlocks once an Admin approves your Contributor application.
            </div>
          )}
        </form>

        {/* Repository List */}
        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-blue-600" />
              <h2 className="font-display text-base font-semibold text-slate-900">
                {contributorAccess
                  ? `Contributor Study Material Repository (${materials.length})`
                  : `Uploaded Question Papers (${materials.length})`}
              </h2>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 tabular-nums">
              <Coins className="h-3.5 w-3.5" />
              {dbUser?.points ?? 0} pts
            </span>
          </div>

          {loading ? (
            <p className="py-8 text-center text-xs text-slate-500">Loading files...</p>
          ) : materials.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500">
              No files uploaded yet.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 max-h-[580px] overflow-y-auto">
              {materials.map((m) => {
                const isOwnerOrAdmin =
                  dbUser?.role === 'admin' ||
                  dbUser?.role === 'super' ||
                  m.uploaderId === dbUser?.id;
                const ownedBuy = purchases.find(
                  (p) => p.materialId === m.id && p.accessType === 'buy'
                );
                const activeRent = purchases.find(
                  (p) =>
                    p.materialId === m.id &&
                    p.accessType === 'rent' &&
                    p.expiresAt &&
                    new Date(p.expiresAt).getTime() > Date.now()
                );
                const hasAccess =
                  isOwnerOrAdmin || Boolean(ownedBuy) || Boolean(activeRent);
                const selectedHours = rentHoursMap[m.id] ?? 2;
                const hourlyRate = m.hourlyRentCost || 10;
                const fullBuyCost = m.buyCost || hourlyRate * 4;
                const isBusy = acquiringId === m.id;

                return (
                  <div
                    key={m.id}
                    className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-slate-900">
                          {m.title}
                        </span>
                        {ownedBuy && !isOwnerOrAdmin && (
                          <span className="rounded bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                            Owned
                          </span>
                        )}
                        {activeRent && !ownedBuy && !isOwnerOrAdmin && activeRent.expiresAt && (
                          <span className="inline-flex items-center gap-1 rounded bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 tabular-nums">
                            <Clock className="h-2.5 w-2.5" />
                            Rented until{' '}
                            {new Date(activeRent.expiresAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 tabular-nums">
                        {m.subject} · {m.category.replace('_', ' ')} ·{' '}
                        {m.pageCount || 1} pg · {formatBytes(m.fileSizeBytes)} · By{' '}
                        {m.uploaderName}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-600 tabular-nums">
                        <span className="rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-amber-800">
                          Rent: {hourlyRate} pts/hr
                        </span>
                        <span className="rounded bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-slate-700">
                          Buy: {fullBuyCost} pts
                        </span>
                      </div>
                      {m.driveWebLink && (
                        <a
                          href={m.driveWebLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 hover:underline"
                        >
                          Synced in ASAN-user-content
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {hasAccess ? (
                        <button
                          type="button"
                          onClick={() => downloadStudyMaterialFile(m.id, m.fileName)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download
                        </button>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <select
                            value={selectedHours}
                            onChange={(e) =>
                              setRentHoursMap((prev) => ({
                                ...prev,
                                [m.id]: Number(e.target.value),
                              }))
                            }
                            aria-label="Rental hours"
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
                          >
                            {[1, 2, 3, 6, 12, 24].map((h) => (
                              <option key={h} value={h}>
                                {h}h
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleAcquire(m, 'rent', selectedHours)}
                            className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60 tabular-nums"
                          >
                            <Clock className="h-3.5 w-3.5" />
                            Rent ({hourlyRate * selectedHours} pts)
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleAcquire(m, 'buy')}
                            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60 tabular-nums"
                          >
                            <ShoppingBag className="h-3.5 w-3.5" />
                            Buy ({fullBuyCost} pts)
                          </button>
                        </div>
                      )}

                      {isOwnerOrAdmin && isWorkspaceEnabled && (
                        <button
                          type="button"
                          onClick={() => handleMirrorToAsanUserContentDrive(m)}
                          title="Sync copy to Google Drive folder ASAN-user-content"
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <CloudUpload className="h-3.5 w-3.5 text-emerald-600" />
                          Drive Sync
                        </button>
                      )}

                      {isOwnerOrAdmin && (
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(m)}
                          className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          aria-label="Delete study material"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Study Material?"
        description={`Permanently delete "${deleteTarget?.title}" (${deleteTarget?.fileName}) from the server repository?`}
        confirmLabel="Delete Permanently"
        destructive
        busy={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
