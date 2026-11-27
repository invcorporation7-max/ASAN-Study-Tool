import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Award,
  Clock,
  CloudUpload,
  Coins,
  Download,
  ExternalLink,
  Eye,
  FileUp,
  FolderOpen,
  Lock,
  Mic,
  ShoppingBag,
  Square,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  apiFetch,
  apiPublicFetch,
  downloadStudyMaterialFile,
  ensureNamedDriveFolder,
  fetchStudyMaterialBlob,
  uploadFileToDriveFolder,
  uploadStudyMaterialBinary,
} from '../lib/api';
import {
  INFINITE_POINTS_SENTINEL,
  REPO_PLATFORM_FEE,
  calculateRepoOrAppQuote,
  type CouponLike,
} from '../lib/pricing';
import type { MaterialPurchaseItem, PointRewardsConfig, StudyMaterialItem } from '../types';
import { ConfirmDialog } from './ConfirmDialog';
import { AuthMediaPreview } from './ForumAttachmentViewer';

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

type MaterialMediaKind =
  | 'pdf'
  | 'photo'
  | 'video'
  | 'text'
  | 'word'
  | 'excel'
  | 'ppt'
  | 'recording';

const MEDIA_KIND_LABELS: Record<MaterialMediaKind, string> = {
  pdf: 'PDF',
  photo: 'Photo',
  video: 'Video',
  recording: 'Recording',
  word: 'Word',
  excel: 'Excel',
  ppt: 'PPT',
  text: 'Text',
};

function detectMediaKindFromFile(f: File): MaterialMediaKind {
  const mime = (f.type || '').toLowerCase();
  const name = (f.name || '').toLowerCase();
  if (mime.includes('pdf') || name.endsWith('.pdf')) return 'pdf';
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|svg)$/.test(name)) return 'photo';
  if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/.test(name)) return 'recording';
  if (mime.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|m4v)$/.test(name)) {
    return name.includes('recording') ? 'recording' : 'video';
  }
  if (/\.(docx?|rtf|odt)$/.test(name) || mime.includes('wordprocessingml') || mime.includes('msword')) {
    return 'word';
  }
  if (/\.(xlsx?|ods)$/.test(name) || mime.includes('spreadsheetml') || mime.includes('ms-excel')) {
    return 'excel';
  }
  if (/\.(pptx?|odp)$/.test(name) || mime.includes('presentationml') || mime.includes('ms-powerpoint')) {
    return 'ppt';
  }
  if (mime.startsWith('text/') || /\.(txt|md|markdown|csv|log|tex)$/.test(name)) return 'text';
  return 'pdf';
}

export const StudyMaterialView: React.FC = () => {
  const {
    dbUser,
    isGuest,
    effectivePlan,
    isWorkspaceEnabled,
    workspacePermissions,
    signIn,
    refreshProfile,
    workspaceToken,
    connectBasicDrive,
    error: authError,
    clearError,
  } = useAuth();
  const eliteGlow = effectivePlan === 'elite' && dbUser?.eliteVisualEffects !== false;
  const formatPts = (val: number | undefined | null) =>
    dbUser?.infinitePoints || (val ?? 0) >= INFINITE_POINTS_SENTINEL
      ? '∞ pts'
      : `${(val ?? 0).toLocaleString()} pts`;

  const [materials, setMaterials] = useState<StudyMaterialItem[]>([]);
  const [purchases, setPurchases] = useState<MaterialPurchaseItem[]>([]);
  const [contributorAccess, setContributorAccess] = useState(false);
  const [contributorRequested, setContributorRequested] = useState(false);
  const [showRequestBox, setShowRequestBox] = useState(false);
  const [requestNote, setRequestNote] = useState('');
  const [requestSending, setRequestSending] = useState(false);
  const requestLockRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [rewards, setRewards] = useState<PointRewardsConfig>({
    noteCreate: 5,
    calendarStudyEvent: 5,
    questionPaperUpload: 75,
    studyMaterialUpload: 0,
    examTimer30Min: 10,
    contributorWeekly: 120,
    forumSatisfactoryAnswer: 25,
  });

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState('Physics');
  const [category, setCategory] = useState<'question_paper' | 'study_notes' | 'booklet' | 'archive'>(
    'question_paper'
  );
  const [mediaKind, setMediaKind] = useState<'auto' | MaterialMediaKind>('auto');
  const [filterMediaKind, setFilterMediaKind] = useState<'all' | MaterialMediaKind>('all');
  const [previewItem, setPreviewItem] = useState<StudyMaterialItem | null>(null);
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
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<CouponLike | null>(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);

  // Built-in Microphone Recorder state
  const [recording, setRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [recordedPreviewUrl, setRecordedPreviewUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<BlobPart[]>([]);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const recordTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      recordStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (recordedPreviewUrl) URL.revokeObjectURL(recordedPreviewUrl);
    };
  }, [recordedPreviewUrl]);

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
    apiPublicFetch<PointRewardsConfig | { rewards?: PointRewardsConfig }>('/api/point-rewards')
      .then((r) => {
        const cfg = (r as { rewards?: PointRewardsConfig })?.rewards || (r as PointRewardsConfig);
        if (cfg && typeof cfg.questionPaperUpload === 'number') {
          setRewards({
            ...cfg,
            forumSatisfactoryAnswer: cfg.forumSatisfactoryAnswer ?? 25,
          });
        }
      })
      .catch(() => {});
  }, [loadMaterials]);

  useEffect(() => {
    if (contributorAccess) {
      setCategory('study_notes');
    } else {
      setCategory('question_paper');
    }
  }, [contributorAccess]);

  const handleSelectFile = async (selected: File | null, explicitKind?: MaterialMediaKind) => {
    setFile(selected);
    if (!selected) {
      setPageCount(1);
      return;
    }
    if (explicitKind) {
      setMediaKind(explicitKind);
    } else {
      setMediaKind('auto');
    }
    const detected = await detectClientPdfPageCount(selected);
    setPageCount(detected);
  };

  const handleToggleRecording = async () => {
    setErrorMsg(null);
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      if (recordTimerRef.current) {
        window.clearInterval(recordTimerRef.current);
        recordTimerRef.current = null;
      }
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErrorMsg('Audio recording is not supported in this browser. You can still upload .mp3/.wav/.m4a files.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;
      recordChunksRef.current = [];
      const mimeCandidate = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';
      const recorder = mimeCandidate
        ? new MediaRecorder(stream, { mimeType: mimeCandidate })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) recordChunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        recordStreamRef.current = null;
        const mime = recorder.mimeType || 'audio/webm';
        const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
        const blob = new Blob(recordChunksRef.current, { type: mime });
        if (blob.size > 0) {
          const recFile = new File(
            [blob],
            `study-recording-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`,
            { type: mime }
          );
          if (recordedPreviewUrl) URL.revokeObjectURL(recordedPreviewUrl);
          setRecordedPreviewUrl(URL.createObjectURL(blob));
          await handleSelectFile(recFile, 'recording');
        }
      };

      setRecordingSec(0);
      recorder.start();
      setRecording(true);
      recordTimerRef.current = window.setInterval(() => {
        setRecordingSec((s) => s + 1);
      }, 1000);
    } catch {
      setErrorMsg('Microphone permission denied or unavailable.');
    }
  };

  const handleApplyContributor = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (requestLockRef.current || requestSending || contributorRequested || contributorAccess) {
      return;
    }
    requestLockRef.current = true;
    setRequestSending(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await apiFetch('/api/contributor/request', {
        method: 'POST',
        body: JSON.stringify({ message: requestNote.trim() }),
      });
      setContributorRequested(true);
      await refreshProfile();
      await loadMaterials();
      setShowRequestBox(false);
      setRequestNote('');
      setStatusMsg(
        'Contributor request sent once to Admin & Super via Tool Mail! Duplicate requests are locked while pending.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to submit request');
    } finally {
      setRequestSending(false);
      requestLockRef.current = false;
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
    const resolvedKind = mediaKind === 'auto' ? detectMediaKindFromFile(file) : mediaKind;
    try {
      const res = await uploadStudyMaterialBinary<{
        material: StudyMaterialItem;
        pointsAwarded: number;
      }>(file, {
        title: title.trim() || file.name,
        description: description.trim(),
        subject: subject.trim() || 'General',
        category,
        mediaKind: resolvedKind,
        pageCount: cleanPages,
        hourlyRentCost: cleanHourly,
        buyCost: cleanBuy,
      });

      setTitle('');
      setDescription('');
      setFile(null);
      setMediaKind('auto');
      if (recordedPreviewUrl) {
        URL.revokeObjectURL(recordedPreviewUrl);
        setRecordedPreviewUrl(null);
      }
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

  const handleApplyCoupon = async () => {
    const code = couponInput.trim().toUpperCase();
    if (!code) {
      setAppliedCoupon(null);
      return;
    }
    setValidatingCoupon(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      let res: { valid: boolean; coupon: CouponLike };
      try {
        res = await apiFetch<{ valid: boolean; coupon: CouponLike }>('/api/coupons/validate', {
          method: 'POST',
          body: JSON.stringify({ code, targetScope: 'repository_rent', baseSubtotal: 100 }),
        });
      } catch {
        res = await apiFetch<{ valid: boolean; coupon: CouponLike }>('/api/coupons/validate', {
          method: 'POST',
          body: JSON.stringify({ code, targetScope: 'repository_buy', baseSubtotal: 100 }),
        });
      }
      setAppliedCoupon(res.coupon);
      setStatusMsg(`Coupon "${res.coupon.code}" applied to eligible repository rentals/purchases.`);
    } catch (err) {
      setAppliedCoupon(null);
      setErrorMsg(err instanceof Error ? err.message : 'Invalid repository coupon code.');
    } finally {
      setValidatingCoupon(false);
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
      const res = await apiFetch<{
        purchase: MaterialPurchaseItem;
        balanceAfter?: number;
        points?: number;
      }>(`/api/study-materials/${item.id}/acquire`, {
        method: 'POST',
        body: JSON.stringify({
          accessType,
          hours,
          couponCode: appliedCoupon?.code || undefined,
        }),
      });
      await Promise.all([refreshProfile(), loadMaterials()]);
      const nextBalance = res.balanceAfter ?? res.points ?? dbUser?.points ?? 0;
      setStatusMsg(
        accessType === 'rent'
          ? `Rented "${item.title}" for ${hours}h (-${res.purchase.totalCost} pts incl. ${REPO_PLATFORM_FEE}-pt fee). Balance: ${formatPts(nextBalance)}.`
          : `Purchased permanent access to "${item.title}" (-${res.purchase.totalCost} pts incl. ${REPO_PLATFORM_FEE}-pt fee). Balance: ${formatPts(nextBalance)}.`
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
    if (!workspacePermissions.driveSync) {
      setErrorMsg('Google Drive sync is disabled under Settings → Google Workspace Function Permissions.');
      return;
    }
    setErrorMsg(null);
    setStatusMsg(null);
    clearError();
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
        <div className="asan-card-hover rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 space-y-4">
          <div className="flex items-start gap-3">
            <Lock className="mt-1 h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                Study Material Notes &amp; Question Papers
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 tabular-nums">
                Sign in with Google to upload Question Papers (+{rewards.questionPaperUpload} points each), rent or buy repository materials (5–100 pts/hr), or apply to become an approved Contributor (+{rewards.contributorWeekly} points/week).
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
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Study Material Notes &amp; Question Papers
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            Upload Photos, Videos, Text, PDFs, Word, Excel, PPT, or Audio Recordings (+{rewards.questionPaperUpload} pts for Question Papers{rewards.studyMaterialUpload > 0 ? ` · +${rewards.studyMaterialUpload} pts for Study Materials` : ''}). Rent hourly (5–100 pts/hr) or buy permanent access (70% royalty rounded to nearest 10 credited to uploader).
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          {contributorAccess ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 px-3 py-1.5 font-medium text-emerald-800 dark:text-emerald-300">
              <Award className="h-3.5 w-3.5" />
              {dbUser?.role === 'admin' || dbUser?.role === 'super'
                ? 'Admin / Super Repository Access'
                : 'Approved Contributor Tag'}
            </span>
          ) : contributorRequested ? (
            <span className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 px-3 py-1.5 font-medium text-amber-800 dark:text-amber-300">
              Contributor Request Pending Admin Approval
            </span>
          ) : (
            <button
              type="button"
              disabled={requestSending}
              onClick={() => setShowRequestBox((v) => !v)}
              className="rounded-lg border border-red-600 bg-white dark:bg-slate-900 px-3.5 py-1.5 font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              Request Admin for Contributor Tag
            </button>
          )}
        </div>
      </div>

      {showRequestBox && !contributorAccess && !contributorRequested && (
        <form
          onSubmit={handleApplyContributor}
          className="asan-card-hover rounded-xl border border-red-200 dark:border-red-900 bg-red-50/40 dark:bg-red-950/30 p-4 space-y-3"
        >
          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Send Contributor Tag Request to Admin &amp; Super (Tool Mail)
          </div>
          <textarea
            rows={2}
            value={requestNote}
            onChange={(e) => setRequestNote(e.target.value)}
            placeholder="Optional message: subjects, notes, PDFs, or Word docs you plan to organize..."
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-red-500 focus:outline-none"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowRequestBox(false)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
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
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/50 px-4 py-2.5 text-xs text-emerald-800 dark:text-emerald-300">
          {statusMsg}
        </div>
      )}
      {(errorMsg || authError) && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 px-4 py-2.5 text-xs text-red-700 dark:text-red-300">
          {errorMsg || authError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Upload Card */}
        <form
          onSubmit={handleUpload}
          className={`asan-card-hover lg:col-span-5 h-fit rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 ${
            eliteGlow ? 'asan-elite-card' : ''
          }`}
        >
          <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
            <FileUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              {contributorAccess
                ? 'Upload Study Material / Question Paper'
                : `Upload Question Paper (+${rewards.questionPaperUpload} Points)`}
            </h2>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Title</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., JEE Adv 2024 Physics Paper 1"
              className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
              Description <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <textarea
              rows={2}
              maxLength={600}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Topics covered, exam year, syllabus notes, or page breakdown..."
              className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Category</label>
              <select
                value={category}
                onChange={(e) =>
                  setCategory(
                    e.target.value as 'question_paper' | 'study_notes' | 'booklet' | 'archive'
                  )
                }
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
              >
                <option value="question_paper">
                  Question Paper (+{rewards.questionPaperUpload} pts)
                </option>
                {contributorAccess && (
                  <>
                    <option value="study_notes">
                      Study Material Notes{rewards.studyMaterialUpload > 0 ? ` (+${rewards.studyMaterialUpload} pts)` : ' (Whole PDF / Large)'}
                    </option>
                    <option value="booklet">
                      A4 Revision Booklet{rewards.studyMaterialUpload > 0 ? ` (+${rewards.studyMaterialUpload} pts)` : ''}
                    </option>
                    <option value="archive">
                      Complete Subject Archive{rewards.studyMaterialUpload > 0 ? ` (+${rewards.studyMaterialUpload} pts)` : ''}
                    </option>
                  </>
                )}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">PDF Pages</label>
              <input
                type="number"
                min={1}
                max={50000}
                value={pageCount}
                onChange={(e) => setPageCount(Math.max(1, Number(e.target.value) || 1))}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-sm text-slate-900 dark:text-slate-100 tabular-nums focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
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
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-sm text-slate-900 dark:text-slate-100 tabular-nums focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Buy Cost (Pts)</label>
              <input
                type="number"
                min={5}
                required
                value={buyCost}
                onChange={(e) => {
                  setBuyCostTouched(true);
                  setBuyCost(Number(e.target.value));
                }}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-sm text-slate-900 dark:text-slate-100 tabular-nums focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                  File Format Type
                </label>
                <select
                  value={mediaKind}
                  onChange={(e) => setMediaKind(e.target.value as 'auto' | MaterialMediaKind)}
                  className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
                >
                  <option value="auto">
                    Auto-Detect ({file ? MEDIA_KIND_LABELS[detectMediaKindFromFile(file)] : 'PDF / Photo / Video / Office / Audio'})
                  </option>
                  <option value="pdf">PDF Document</option>
                  <option value="photo">Photo / Image</option>
                  <option value="video">Video Lecture</option>
                  <option value="recording">Audio Recording</option>
                  <option value="word">Word Document (.doc / .docx)</option>
                  <option value="excel">Excel Spreadsheet (.xls / .xlsx / .csv)</option>
                  <option value="ppt">PowerPoint (.ppt / .pptx)</option>
                  <option value="text">Text / Markdown (.txt / .md)</option>
                </select>
              </div>
              <div className="flex flex-col justify-end">
                <button
                  type="button"
                  onClick={() => void handleToggleRecording()}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                    recording
                      ? 'border-red-600 bg-red-600 text-white animate-pulse'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  {recording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />}
                  {recording
                    ? `Stop Recording (${Math.floor(recordingSec / 60)}:${String(recordingSec % 60).padStart(2, '0')})`
                    : 'Record Voice / Lecture'}
                </button>
              </div>
            </div>

            {recordedPreviewUrl && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-2.5 space-y-1.5">
                <div className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  Recorded Audio Ready for Upload
                </div>
                <audio src={recordedPreviewUrl} controls className="w-full h-8" />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                Choose File (Photos, Videos, Text, PDF, Word, Excel, PPT, Recordings · up to 500 MB)
              </label>
              <input
                type="file"
                required={!file}
                accept=".pdf,application/pdf,image/*,video/*,audio/*,.txt,.md,.markdown,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                onChange={(e) => void handleSelectFile(e.target.files?.[0] || null)}
                className="mt-1 block w-full text-xs text-slate-600 dark:text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 dark:file:bg-slate-800 file:px-3 file:py-2 file:text-xs file:font-medium file:text-slate-700 dark:file:text-slate-200 hover:file:bg-slate-200 dark:hover:file:bg-slate-700"
              />
              {file && (
                <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                  Selected: {file.name} ({formatBytes(file.size)}) ·{' '}
                  {MEDIA_KIND_LABELS[mediaKind === 'auto' ? detectMediaKindFromFile(file) : mediaKind]} · {pageCount} page(s)
                </div>
              )}
            </div>
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
                ? rewards.questionPaperUpload > 0
                  ? `Upload Question Paper & Earn +${rewards.questionPaperUpload} Pts`
                  : 'Upload Question Paper'
                : rewards.studyMaterialUpload > 0
                  ? `Upload Material & Earn +${rewards.studyMaterialUpload} Pts`
                  : 'Upload Study Material'}
          </button>

          {!contributorAccess && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
              <strong>Contributor-Only Note Repository:</strong> Full Study Material Notes archive access (browsing and uploading large multi-MB study packs stored in server storage &amp; <code className="font-mono">ASAN-user-content</code>) unlocks once an Admin approves your Contributor application.
            </div>
          )}
        </form>

        {/* Repository List */}
        <div
          className={`asan-card-hover lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 ${
            eliteGlow ? 'asan-elite-card' : ''
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                {contributorAccess
                  ? `Contributor Study Material Repository (${materials.length})`
                  : `Uploaded Question Papers (${materials.length})`}
              </h2>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-400 tabular-nums">
              <Coins className="h-3.5 w-3.5" />
              {formatPts(dbUser?.points ?? 0)}
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 px-3 py-2 text-[11px]">
            <div className="text-slate-600 dark:text-slate-300 tabular-nums">
              Repository fee: <strong>+{REPO_PLATFORM_FEE} pts</strong>
              {effectivePlan === 'elite'
                ? ' · Elite 50% discount active'
                : dbUser?.role === 'admin' || dbUser?.role === 'super'
                  ? ' · Admin/Super 5% discount active'
                  : ''}
            </div>
            <div className="flex items-center gap-1.5">
              <Tag className="h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                placeholder="Repo coupon code"
                className="w-32 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 font-mono text-[11px] uppercase text-slate-800 dark:text-slate-100"
              />
              <button
                type="button"
                disabled={validatingCoupon || !couponInput.trim()}
                onClick={() => void handleApplyCoupon()}
                className="rounded bg-slate-800 dark:bg-slate-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
              >
                {validatingCoupon ? '...' : 'Apply'}
              </button>
              {appliedCoupon && (
                <button
                  type="button"
                  onClick={() => {
                    setAppliedCoupon(null);
                    setCouponInput('');
                  }}
                  title="Remove coupon"
                  className="rounded border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-1 font-mono text-[10px] font-semibold text-emerald-700 dark:text-emerald-300"
                >
                  {appliedCoupon.code} ×
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ['all', 'All'],
                ['pdf', 'PDF'],
                ['photo', 'Photos'],
                ['video', 'Videos'],
                ['recording', 'Recordings'],
                ['word', 'Word'],
                ['excel', 'Excel'],
                ['ppt', 'PPT'],
                ['text', 'Text'],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilterMediaKind(k)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium border transition-colors ${
                  filterMediaKind === k
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>

          {loading ? (
            <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">Loading files...</p>
          ) : materials.filter((m) => filterMediaKind === 'all' || (m.mediaKind || 'pdf') === filterMediaKind).length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No matching files uploaded yet.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {materials
                .filter((m) => filterMediaKind === 'all' || (m.mediaKind || 'pdf') === filterMediaKind)
                .map((m) => {
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
                const rentQuote = calculateRepoOrAppQuote({
                  targetScope: 'repository_rent',
                  baseSubtotal: hourlyRate * selectedHours,
                  effectivePlan,
                  role: dbUser?.role || 'user',
                  coupon: appliedCoupon,
                });
                const buyQuote = calculateRepoOrAppQuote({
                  targetScope: 'repository_buy',
                  baseSubtotal: fullBuyCost,
                  effectivePlan,
                  role: dbUser?.role || 'user',
                  coupon: appliedCoupon,
                });
                const isBusy = acquiringId === m.id;

                return (
                  <div
                    key={m.id}
                    className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {m.title}
                        </span>
                        {ownedBuy && !isOwnerOrAdmin && (
                          <span className="rounded bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                            Owned
                          </span>
                        )}
                        {activeRent && !ownedBuy && !isOwnerOrAdmin && activeRent.expiresAt && (
                          <span className="inline-flex items-center gap-1 rounded bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-300 tabular-nums">
                            <Clock className="h-2.5 w-2.5" />
                            Rented until{' '}
                            {new Date(activeRent.expiresAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        {m.subject} · {MEDIA_KIND_LABELS[(m.mediaKind as MaterialMediaKind) || 'pdf'] || (m.mediaKind || 'PDF')} · {m.category.replace('_', ' ')} ·{' '}
                        {m.pageCount || 1} pg · {formatBytes(m.fileSizeBytes)} · By{' '}
                        {m.uploaderName}
                      </div>
                      {m.description && (
                        <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed">
                          {m.description}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-600 dark:text-slate-300 tabular-nums">
                        <span className="rounded bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 px-1.5 py-0.5 text-amber-800 dark:text-amber-300">
                          Rent: {hourlyRate} pts/hr
                        </span>
                        <span className="rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 text-slate-700 dark:text-slate-200">
                          Buy: {fullBuyCost} pts
                        </span>
                      </div>
                      {m.driveWebLink && (
                        <a
                          href={m.driveWebLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
                        >
                          Synced in ASAN-user-content
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {hasAccess ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setPreviewItem(m)}
                            className="inline-flex items-center gap-1 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 px-2.5 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Preview
                          </button>
                          <button
                            type="button"
                            onClick={() => downloadStudyMaterialFile(m.id, m.fileName)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Download
                          </button>
                        </>
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
                            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs text-slate-700 dark:text-slate-200"
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
                            Rent ({rentQuote.finalCost} pts)
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleAcquire(m, 'buy')}
                            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60 tabular-nums"
                          >
                            <ShoppingBag className="h-3.5 w-3.5" />
                            Buy ({buyQuote.finalCost} pts)
                          </button>
                        </div>
                      )}

                      {isOwnerOrAdmin && isWorkspaceEnabled && workspacePermissions.driveSync && (
                        <button
                          type="button"
                          onClick={() => handleMirrorToAsanUserContentDrive(m)}
                          title="Sync copy to Google Drive folder ASAN-user-content"
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                        >
                          <CloudUpload className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                          Drive Sync
                        </button>
                      )}

                      {isOwnerOrAdmin && (
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(m)}
                          className="rounded p-1.5 text-slate-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-400"
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

      {previewItem && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setPreviewItem(null)}
        >
          <div
            className="w-full max-w-4xl rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {previewItem.title}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {previewItem.fileName} · {previewItem.subject} · {formatBytes(previewItem.fileSizeBytes)}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => downloadStudyMaterialFile(previewItem.id, previewItem.fileName)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewItem(null)}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label="Close preview"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="p-4 max-h-[82vh] overflow-auto">
              <AuthMediaPreview
                url={`/api/study-materials/${previewItem.id}/download?inline=1`}
                mimeType={previewItem.mimeType}
                fileName={previewItem.fileName}
                mediaKind={previewItem.mediaKind || 'pdf'}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
