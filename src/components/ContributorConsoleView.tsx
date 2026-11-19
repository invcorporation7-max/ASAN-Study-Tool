import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  CloudUpload,
  Download,
  ExternalLink,
  FileImage,
  FileText,
  Folder,
  FolderPlus,
  FolderUp,
  HardDrive,
  RefreshCw,
  Send,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  apiFetch,
  downloadContributorFile,
  ensureAppDriveFolder,
  ensureNamedDriveFolder,
  ensureSubfolderInDrive,
  fetchContributorFileBlob,
  uploadContributorFileBinary,
  uploadFileToDriveFolder,
} from '../lib/api';
import type { ContributorFileItem, ContributorFolderItem } from '../types';
import { ConfirmDialog } from './ConfirmDialog';

function classifyFileKind(fileName: string, mimeType: string): 'pdf' | 'word' | 'image' | 'other' {
  const lowerName = fileName.toLowerCase();
  const lowerMime = (mimeType || '').toLowerCase();
  if (lowerMime.includes('pdf') || lowerName.endsWith('.pdf')) return 'pdf';
  if (
    lowerMime.includes('word') ||
    lowerMime.includes('msword') ||
    lowerMime.includes('wordprocessingml') ||
    lowerName.endsWith('.doc') ||
    lowerName.endsWith('.docx')
  ) {
    return 'word';
  }
  if (
    lowerMime.startsWith('image/') ||
    /\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(lowerName)
  ) {
    return 'image';
  }
  return 'other';
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const ContributorConsoleView: React.FC = () => {
  const {
    dbUser,
    isApprovedContributor,
    isSuper,
    isWorkspaceEnabled,
    workspaceToken,
    connectBasicDrive,
    updateProfile,
    refreshProfile,
  } = useAuth();

  const [folders, setFolders] = useState<ContributorFolderItem[]>([]);
  const [files, setFiles] = useState<ContributorFileItem[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'all' | 'pdf' | 'word' | 'image' | 'other'>('all');
  const [requestNote, setRequestNote] = useState('');
  const [requestingContributor, setRequestingContributor] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<{
    kind: 'folder' | 'file';
    id: number;
    label: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute('webkitdirectory', '');
      folderInputRef.current.setAttribute('directory', '');
    }
  }, []);

  const loadWorkspace = useCallback(async () => {
    if (!isApprovedContributor) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{
        folders: ContributorFolderItem[];
        files: ContributorFileItem[];
      }>('/api/contributor-console');
      setFolders(data.folders || []);
      setFiles(data.files || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Contributors Console');
    } finally {
      setLoading(false);
    }
  }, [isApprovedContributor]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const currentFolder = useMemo(
    () => folders.find((f) => f.id === currentFolderId) || null,
    [folders, currentFolderId]
  );

  const breadcrumbs = useMemo(() => {
    const chain: ContributorFolderItem[] = [];
    let cursor = currentFolder;
    const seen = new Set<number>();
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      chain.unshift(cursor);
      const pid = cursor.parentId;
      cursor = pid ? folders.find((f) => f.id === pid) || null : null;
    }
    return chain;
  }, [currentFolder, folders]);

  const childFolders = useMemo(
    () => folders.filter((f) => (f.parentId ?? null) === currentFolderId),
    [folders, currentFolderId]
  );

  const childFiles = useMemo(() => {
    const inCurrent = files.filter((f) => (f.folderId ?? null) === currentFolderId);
    if (typeFilter === 'all') return inCurrent;
    return inCurrent.filter((f) => classifyFileKind(f.fileName, f.mimeType) === typeFilter);
  }, [files, currentFolderId, typeFilter]);

  const ensureFolderPathInDb = useCallback(
    async (
      segments: string[],
      localFolderCache: Map<string, ContributorFolderItem>,
      baseFolder: ContributorFolderItem | null
    ): Promise<ContributorFolderItem | null> => {
      let parent: ContributorFolderItem | null = baseFolder;
      for (const rawSeg of segments) {
        const seg = rawSeg.trim();
        if (!seg) continue;
        const fullPath = parent ? `${parent.path}/${seg}` : seg;
        const cached = localFolderCache.get(fullPath.toLowerCase());
        if (cached) {
          parent = cached;
          continue;
        }
        const created = await apiFetch<ContributorFolderItem>('/api/contributor-console/folders', {
          method: 'POST',
          body: JSON.stringify({
            name: seg,
            parentId: parent?.id ?? null,
            path: fullPath,
          }),
        });
        localFolderCache.set(fullPath.toLowerCase(), created);
        parent = created;
      }
      return parent;
    },
    []
  );

  const handleCreateSubfolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    setCreatingFolder(true);
    setError(null);
    setNotice(null);
    try {
      const folderPath = currentFolder ? `${currentFolder.path}/${trimmed}` : trimmed;
      await apiFetch<ContributorFolderItem>('/api/contributor-console/folders', {
        method: 'POST',
        body: JSON.stringify({
          name: trimmed,
          parentId: currentFolderId,
          path: folderPath,
        }),
      });
      setNewFolderName('');
      setNotice(`Subfolder "${trimmed}" created.`);
      await loadWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create subfolder');
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleUploadFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const selected = Array.from(fileList);
    setError(null);
    setNotice(null);
    setBusyMessage(`Uploading ${selected.length} file(s)...`);

    try {
      const folderCache = new Map<string, ContributorFolderItem>();
      folders.forEach((f) => folderCache.set(f.path.toLowerCase(), f));

      let uploadedCount = 0;
      for (const file of selected) {
        const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || '';
        let targetFolder = currentFolder;
        if (rel && rel.includes('/')) {
          const parts = rel.split('/').filter(Boolean);
          parts.pop(); // remove filename
          if (parts.length > 0) {
            targetFolder = await ensureFolderPathInDb(parts, folderCache, currentFolder);
          }
        }
        await uploadContributorFileBinary(file, {
          folderId: targetFolder?.id ?? null,
          folderPath: targetFolder?.path || '',
        });
        uploadedCount += 1;
        setBusyMessage(`Uploaded ${uploadedCount} / ${selected.length} file(s)...`);
      }

      setNotice(
        `Uploaded ${uploadedCount} file(s) successfully into "${currentFolder?.path || 'Contributions Root'}".`
      );
      await loadWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'File upload failed');
    } finally {
      setBusyMessage(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  const handleSyncTreeToDrive = async (target: 'personal' | 'master') => {
    if (!isWorkspaceEnabled) return;
    setError(null);
    setNotice(null);
    setBusyMessage(
      target === 'master'
        ? 'Syncing folder tree to ASAN-Master-Folder...'
        : 'Syncing folder tree to ASAN-user-content/Contributions...'
    );

    try {
      let token = workspaceToken;
      if (!token) {
        token = await connectBasicDrive();
      }
      if (!token) {
        setBusyMessage(null);
        return;
      }

      let baseDriveFolderId = '';
      if (target === 'master') {
        const masterRoot = await ensureNamedDriveFolder('ASAN-Master-Folder');
        const userFolder = await ensureSubfolderInDrive(
          dbUser?.username || 'contributor',
          masterRoot.id
        );
        baseDriveFolderId = userFolder.id;
      } else {
        const appFolder = await ensureAppDriveFolder(dbUser?.driveFolderId);
        if (!dbUser?.driveFolderId) {
          await updateProfile({ driveFolderId: appFolder.id }).catch(() => {});
        }
        const contribFolder = await ensureSubfolderInDrive('Contributions', appFolder.id);
        baseDriveFolderId = contribFolder.id;
      }

      // Sort folders shallow-to-deep by segment count
      const sortedFolders = [...folders].sort(
        (a, b) => a.path.split('/').length - b.path.split('/').length
      );
      const pathToDriveId = new Map<string, string>();
      pathToDriveId.set('', baseDriveFolderId);

      for (const folder of sortedFolders) {
        const segments = folder.path.split('/').filter(Boolean);
        let parentDriveId = baseDriveFolderId;
        let runningPath = '';
        for (const seg of segments) {
          runningPath = runningPath ? `${runningPath}/${seg}` : seg;
          const existingId = pathToDriveId.get(runningPath);
          if (existingId) {
            parentDriveId = existingId;
          } else {
            const sub = await ensureSubfolderInDrive(seg, parentDriveId);
            pathToDriveId.set(runningPath, sub.id);
            parentDriveId = sub.id;
          }
        }
        const finalId = pathToDriveId.get(folder.path) || parentDriveId;
        await apiFetch(`/api/contributor-console/folders/${folder.id}/drive`, {
          method: 'PATCH',
          body: JSON.stringify(
            target === 'master'
              ? { masterDriveFolderId: finalId }
              : { driveFolderId: finalId }
          ),
        });
      }

      let syncedFiles = 0;
      for (const fileItem of files) {
        const alreadySynced =
          target === 'master' ? Boolean(fileItem.masterDriveFileId) : Boolean(fileItem.driveFileId);
        if (alreadySynced) continue;
        const parentDriveId = pathToDriveId.get(fileItem.folderPath || '') || baseDriveFolderId;
        const blob = await fetchContributorFileBlob(fileItem.id);
        const fileObj = new File([blob], fileItem.fileName, {
          type: fileItem.mimeType || 'application/octet-stream',
        });
        const uploaded = await uploadFileToDriveFolder(fileObj, parentDriveId);
        await apiFetch(`/api/contributor-console/files/${fileItem.id}/drive`, {
          method: 'PATCH',
          body: JSON.stringify(
            target === 'master'
              ? {
                  masterDriveFileId: uploaded.id,
                  masterDriveWebLink: uploaded.webViewLink || '',
                }
              : {
                  driveFileId: uploaded.id,
                  driveWebLink: uploaded.webViewLink || '',
                }
          ),
        });
        syncedFiles += 1;
        setBusyMessage(`Synced ${syncedFiles} file(s) to Drive...`);
      }

      setNotice(
        target === 'master'
          ? `Synced ${syncedFiles} file(s) & subfolders into ASAN-Master-Folder/${dbUser?.username || 'contributor'}.`
          : `Synced ${syncedFiles} file(s) & subfolders into ASAN-user-content/Contributions.`
      );
      await loadWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Drive sync failed');
    } finally {
      setBusyMessage(null);
    }
  };

  const executeDelete = async () => {
    if (!confirmDelete) return;
    setError(null);
    try {
      if (confirmDelete.kind === 'folder') {
        await apiFetch(`/api/contributor-console/folders/${confirmDelete.id}`, {
          method: 'DELETE',
        });
        if (currentFolderId === confirmDelete.id) {
          setCurrentFolderId(null);
        }
      } else {
        await apiFetch(`/api/contributor-console/files/${confirmDelete.id}`, {
          method: 'DELETE',
        });
      }
      setNotice(`Deleted ${confirmDelete.kind} "${confirmDelete.label}".`);
      setConfirmDelete(null);
      await loadWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleRequestAdminContributor = async () => {
    setRequestingContributor(true);
    setError(null);
    try {
      await apiFetch('/api/contributor/request', {
        method: 'POST',
        body: JSON.stringify({ message: requestNote.trim() }),
      });
      await refreshProfile();
      setNotice(
        'Contributor request sent! Admin / Super received your request via internal Tool Mail and Notification.'
      );
      setRequestNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send contributor request');
    } finally {
      setRequestingContributor(false);
    }
  };

  if (!isApprovedContributor) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-600">
              <FolderUp className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                Contributors&apos; Console
              </h2>
              <p className="text-xs text-slate-500">
                Requires an approved Contributor Tag to create contribution folders, organize PDFs/Word docs/images, and upload full folders.
              </p>
            </div>
          </div>

          {dbUser?.contributorRequested ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Your Contributor Tag request is pending Admin / Super review. You will receive Tool Mail and a red contributor glow badge once approved.
            </div>
          ) : (
            <div className="space-y-3 border-t border-slate-100 pt-4">
              <label className="block text-xs font-medium text-slate-700">
                Request Admin for Contributor Tag (sends Tool Mail to Admin &amp; Super)
              </label>
              <textarea
                rows={3}
                value={requestNote}
                onChange={(e) => setRequestNote(e.target.value)}
                placeholder="Briefly mention the subjects, PDFs, or folders you plan to contribute..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleRequestAdminContributor}
                disabled={requestingContributor}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                <Send className="h-4 w-4" />
                {requestingContributor ? 'Sending Request...' : 'Request Admin for Contributor Tag'}
              </button>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
          {notice && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              {notice}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-xl font-bold text-slate-900">
                Contributors&apos; Console
              </h2>
              <span className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                @{dbUser?.username || 'contributor'}
              </span>
            </div>
            <p className="text-xs text-slate-600">
              Organize PDFs, Word docs, and images inside nested subfolders.
              Personal Drive target: <code className="rounded bg-slate-100 px-1 py-0.5">ASAN-user-content/Contributions</code> · Master Drive folder: <code className="rounded bg-slate-100 px-1 py-0.5">ASAN-Master-Folder/{dbUser?.username || 'username'}</code>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadWorkspace()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>

            {isWorkspaceEnabled && (
              <button
                type="button"
                onClick={() => void handleSyncTreeToDrive('personal')}
                disabled={Boolean(busyMessage)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                <CloudUpload className="h-3.5 w-3.5" />
                Sync to Drive (ASAN-user-content/Contributions)
              </button>
            )}

            {isWorkspaceEnabled && isSuper && (
              <button
                type="button"
                onClick={() => void handleSyncTreeToDrive('master')}
                disabled={Boolean(busyMessage)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-violet-800 disabled:opacity-60"
              >
                <HardDrive className="h-3.5 w-3.5" />
                Sync My Tree to ASAN-Master-Folder
              </button>
            )}
          </div>
        </div>

        {!isWorkspaceEnabled && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs text-slate-600">
            Logged in with Email &amp; Password: Google Drive sync is hidden. All subfolders and uploaded files are stored cleanly in ASAN storage and queued for Admin Master Folder sync.
          </div>
        )}

        {busyMessage && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-medium text-blue-700">
            {busyMessage}
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs text-emerald-700">
            {notice}
          </div>
        )}
      </div>

      {/* Controls Toolbar: Breadcrumbs + Create Subfolder + Upload Files / Upload Whole Folder */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <nav className="flex flex-wrap items-center gap-1 text-xs font-medium">
            <button
              type="button"
              onClick={() => setCurrentFolderId(null)}
              className={`rounded px-2 py-1 ${
                currentFolderId === null
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Contributions Root ({dbUser?.username})
            </button>
            {breadcrumbs.map((bc) => (
              <React.Fragment key={bc.id}>
                <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                <button
                  type="button"
                  onClick={() => setCurrentFolderId(bc.id)}
                  className={`rounded px-2 py-1 ${
                    currentFolderId === bc.id
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {bc.name}
                </button>
              </React.Fragment>
            ))}
          </nav>

          <div className="flex items-center gap-1 border border-slate-200 rounded-lg p-0.5 text-xs">
            {(
              [
                ['all', 'All'],
                ['pdf', 'PDFs'],
                ['word', 'Word Docs'],
                ['image', 'Images'],
                ['other', 'Other'],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTypeFilter(k)}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  typeFilter === k
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <form onSubmit={handleCreateSubfolder} className="lg:col-span-6 flex gap-2">
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder={`New subfolder inside "${currentFolder?.name || 'Root'}"...`}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={creatingFolder || !newFolderName.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              <FolderPlus className="h-4 w-4 text-blue-600" />
              Create Subfolder
            </button>
          </form>

          <div className="lg:col-span-6 flex flex-wrap items-center justify-end gap-2.5">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*"
              onChange={(e) => void handleUploadFiles(e.target.files)}
              className="hidden"
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              onChange={(e) => void handleUploadFiles(e.target.files)}
              className="hidden"
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={Boolean(busyMessage)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              <Upload className="h-4 w-4" />
              Upload PDFs / Docs / Images
            </button>
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              disabled={Boolean(busyMessage)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              <FolderUp className="h-4 w-4" />
              Upload Whole Folder
            </button>
          </div>
        </div>
      </div>

      {/* Subfolders Grid */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Subfolders ({childFolders.length})
          </h3>
          <span className="text-xs text-slate-500">
            Total folders: {folders.length} · Total files: {files.length}
          </span>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-slate-500">
            Loading contributor directory...
          </div>
        ) : childFolders.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 py-5 text-center text-xs text-slate-500">
            No subfolders inside this directory yet. Create one above or upload a whole folder!
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {childFolders.map((folder) => (
              <div
                key={folder.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3.5 py-3 hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
              >
                <button
                  type="button"
                  onClick={() => setCurrentFolderId(folder.id)}
                  className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
                >
                  <Folder className="h-5 w-5 text-amber-500 shrink-0" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">
                      {folder.name}
                    </div>
                    <div className="truncate text-[11px] text-slate-500">
                      {folder.path}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setConfirmDelete({ kind: 'folder', id: folder.id, label: folder.name })
                  }
                  className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  title="Delete folder"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Files Table */}
        <div className="pt-3 border-t border-slate-100 space-y-3">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Files in {currentFolder ? `"${currentFolder.name}"` : 'Contributions Root'} ({childFiles.length})
          </h3>

          {childFiles.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-xs text-slate-500">
              No files matching this filter in the current folder. Upload PDFs, Word documents (.doc/.docx), or images above.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 uppercase tracking-wide">
                    <th className="py-2 pr-3 font-semibold">File</th>
                    <th className="py-2 pr-3 font-semibold">Type</th>
                    <th className="py-2 pr-3 font-semibold">Size</th>
                    <th className="py-2 pr-3 font-semibold">Drive / Master Status</th>
                    <th className="py-2 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {childFiles.map((f) => {
                    const kind = classifyFileKind(f.fileName, f.mimeType);
                    return (
                      <tr key={f.id} className="hover:bg-slate-50">
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center gap-2">
                            {kind === 'image' ? (
                              <FileImage className="h-4 w-4 text-emerald-600 shrink-0" />
                            ) : (
                              <FileText
                                className={`h-4 w-4 shrink-0 ${
                                  kind === 'pdf'
                                    ? 'text-red-600'
                                    : kind === 'word'
                                      ? 'text-blue-600'
                                      : 'text-slate-500'
                                }`}
                              />
                            )}
                            <span className="font-medium text-slate-900">{f.fileName}</span>
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 uppercase text-slate-500">{kind}</td>
                        <td className="py-2.5 pr-3 text-slate-600 tabular-nums">
                          {formatBytes(f.fileSizeBytes)}
                        </td>
                        <td className="py-2.5 pr-3">
                          <div className="flex flex-wrap items-center gap-2">
                            {f.driveWebLink ? (
                              <a
                                href={f.driveWebLink}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                              >
                                My Drive <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : (
                              <span className="text-slate-400">ASAN Storage</span>
                            )}
                            {f.masterDriveWebLink ? (
                              <a
                                href={f.masterDriveWebLink}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-violet-700 hover:underline"
                              >
                                Master Folder <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : (
                              <span className="text-amber-600">· Queued for Master</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void downloadContributorFile(f.id, f.fileName)}
                              className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                              title="Download file"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmDelete({ kind: 'file', id: f.id, label: f.fileName })
                              }
                              className="rounded border border-slate-200 p-1.5 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                              title="Delete file"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title={`Delete ${confirmDelete?.kind === 'folder' ? 'Subfolder' : 'File'}?`}
        description={
          confirmDelete?.kind === 'folder'
            ? `Delete "${confirmDelete.label}" and all files inside it from Contributors Console?`
            : `Delete "${confirmDelete?.label}" from Contributors Console?`
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => void executeDelete()}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
};
