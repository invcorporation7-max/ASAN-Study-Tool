import React, { useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  HardDrive,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  Video,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  apiFetch,
  createGoogleMeetRoom,
  deleteDriveFile,
  DriveFileItem,
  ensureAppDriveFolder,
  exportNoteToGoogleDoc,
  exportRowsToGoogleSheet,
  listDriveFilesInFolder,
  syncMasterExamSheet,
  syncScheduleToGoogleSheet,
  uploadFileToDriveFolder,
} from '../lib/api';
import type {
  CalendarEventItem,
  ExamBlueprintItem,
  ExamScheduleItem,
  StudyTask,
} from '../types';
import { ConfirmDialog } from './ConfirmDialog';

interface WorkspaceViewProps {
  tasks: StudyTask[];
  events: CalendarEventItem[];
  exams: ExamScheduleItem[];
}

export const WorkspaceView: React.FC<WorkspaceViewProps> = ({
  tasks,
  events,
  exams,
}) => {
  const { dbUser, workspaceToken, workspacePermissions, connectWorkspace, updateProfile } =
    useAuth();
  const anyPermEnabled =
    workspacePermissions.driveSync ||
    workspacePermissions.sheetsSync ||
    workspacePermissions.meetRooms ||
    workspacePermissions.docsExport;

  const [driveFiles, setDriveFiles] = useState<DriveFileItem[]>([]);
  const [folderInfo, setFolderInfo] = useState<{
    id: string;
    name: string;
    webViewLink?: string;
  } | null>(null);
  const [meetRoom, setMeetRoom] = useState<{
    meetingUri: string;
    meetingCode: string;
  } | null>(null);

  const [docTitle, setDocTitle] = useState('ASAN Study Summary');
  const [docBody, setDocBody] = useState('');
  const [createdDocUrl, setCreatedDocUrl] = useState<string | null>(null);
  const [createdSheetUrl, setCreatedSheetUrl] = useState<string | null>(
    dbUser?.scheduleSheetId
      ? `https://docs.google.com/spreadsheets/d/${dbUser.scheduleSheetId}/edit`
      : null
  );

  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [deleteFileTarget, setDeleteFileTarget] = useState<DriveFileItem | null>(null);

  const ensureTokenAndFolder = async (): Promise<{
    folderId: string;
    webViewLink?: string;
  } | null> => {
    if (!workspaceToken) {
      const tok = await connectWorkspace();
      if (!tok) return null;
    }
    const folder = await ensureAppDriveFolder(dbUser?.driveFolderId);
    setFolderInfo(folder);
    if (folder.id !== dbUser?.driveFolderId) {
      await updateProfile({ driveFolderId: folder.id });
    }
    return { folderId: folder.id, webViewLink: folder.webViewLink };
  };

  const handleConnectAndLoadFolder = async () => {
    if (!workspacePermissions.driveSync) {
      setStatusMsg('Google Drive Folder Sync is disabled in View Plans → Workspace Permissions.');
      return;
    }
    setBusy(true);
    setStatusMsg(null);
    try {
      const info = await ensureTokenAndFolder();
      if (!info) {
        setBusy(false);
        return;
      }
      const files = await listDriveFilesInFolder(info.folderId);
      setDriveFiles(files);
      setStatusMsg(
        `Connected to dedicated Google Drive folder "ASAN-user-content" (${files.length} file(s)).`
      );
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to access Drive folder');
    } finally {
      setBusy(false);
    }
  };

  const handleUploadToAppFolder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!workspacePermissions.driveSync) {
      setStatusMsg('Google Drive Folder Sync is disabled in View Plans → Workspace Permissions.');
      e.target.value = '';
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      const info = await ensureTokenAndFolder();
      if (!info) {
        setBusy(false);
        return;
      }
      const uploaded = await uploadFileToDriveFolder(file, info.folderId);
      const files = await listDriveFilesInFolder(info.folderId);
      setDriveFiles(files);
      setStatusMsg(`Uploaded "${uploaded.name}" inside ASAN-user-content folder.`);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  const handleConfirmDeleteDrive = async () => {
    if (!deleteFileTarget) return;
    setBusy(true);
    try {
      await deleteDriveFile(deleteFileTarget.id);
      setDriveFiles((prev) => prev.filter((f) => f.id !== deleteFileTarget.id));
      setStatusMsg(`Deleted "${deleteFileTarget.name}" from ASAN-user-content Drive folder.`);
      setDeleteFileTarget(null);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to delete Drive file');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspacePermissions.docsExport) {
      setStatusMsg('Google Docs export is disabled in View Plans → Workspace Permissions.');
      return;
    }
    setBusy(true);
    setStatusMsg(null);
    try {
      const info = await ensureTokenAndFolder();
      if (!info) {
        setBusy(false);
        return;
      }
      const res = await exportNoteToGoogleDoc(docTitle, docBody, info.folderId);
      setCreatedDocUrl(res.url);
      setStatusMsg('Created Google Doc strictly inside ASAN-user-content.');
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to create Google Doc');
    } finally {
      setBusy(false);
    }
  };

  const handleSyncScheduleSheet = async () => {
    if (!workspacePermissions.sheetsSync) {
      setStatusMsg('Google Sheets sync is disabled in View Plans → Workspace Permissions.');
      return;
    }
    setBusy(true);
    setStatusMsg(null);
    try {
      const info = await ensureTokenAndFolder();
      if (!info) {
        setBusy(false);
        return;
      }
      const combinedRows: (string | number)[][] = [
        ...events.map((ev) => [
          ev.eventDate,
          ev.eventTime || '09:00',
          ev.category || 'study',
          ev.title,
          ev.notes || '',
          ev.meetLink || '',
        ]),
        ...exams
          .filter((ex) => ex.seatingTime)
          .map((ex) => [
            ex.seatingTime.slice(0, 10),
            ex.seatingTime.slice(11, 16) || '09:00',
            'exam',
            `${ex.subject} (${ex.examType === 'Other' ? ex.customExamType : ex.examType})`,
            `Read ${ex.readingMinutes}m / Write ${ex.writingMinutes}m`,
            '',
          ]),
      ].sort((a, b) => `${a[0]} ${a[1]}`.localeCompare(`${b[0]} ${b[1]}`));

      const res = await syncScheduleToGoogleSheet(
        dbUser?.scheduleSheetId || '',
        combinedRows,
        info.folderId
      );
      if (res.spreadsheetId !== dbUser?.scheduleSheetId) {
        await updateProfile({ scheduleSheetId: res.spreadsheetId });
      }
      setCreatedSheetUrl(res.spreadsheetUrl);
      setStatusMsg(
        `Synced ${combinedRows.length} schedule item(s) to Google Sheets inside ASAN-user-content folder.`
      );
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to sync Schedule Sheet');
    } finally {
      setBusy(false);
    }
  };

  const handleSyncMasterExams = async () => {
    if (!workspacePermissions.sheetsSync) {
      setStatusMsg('Google Sheets sync is disabled in View Plans → Workspace Permissions.');
      return;
    }
    setBusy(true);
    setStatusMsg(null);
    try {
      const info = await ensureTokenAndFolder();
      if (!info) {
        setBusy(false);
        return;
      }
      const blueprints = await apiFetch<ExamBlueprintItem[]>('/api/exam-blueprints');
      const res = await syncMasterExamSheet(blueprints, info.folderId);
      setCreatedSheetUrl(res.spreadsheetUrl);
      setStatusMsg(
        `Synced ${blueprints.length} exam blueprint(s) to "master" → "test_dates" inside ASAN-user-content.`
      );
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to sync master exam sheet');
    } finally {
      setBusy(false);
    }
  };

  const handleExportTasksSheet = async () => {
    if (!workspacePermissions.sheetsSync) {
      setStatusMsg('Google Sheets sync is disabled in View Plans → Workspace Permissions.');
      return;
    }
    setBusy(true);
    setStatusMsg(null);
    try {
      const info = await ensureTokenAndFolder();
      if (!info) {
        setBusy(false);
        return;
      }
      const res = await exportRowsToGoogleSheet(
        `ASAN Tasks Export (${new Date().toISOString().slice(0, 10)})`,
        ['Title', 'Subject', 'Priority', 'Status', 'Due Date'],
        tasks.map((t) => [t.title, t.subject, t.priority, t.status, t.dueDate || '-']),
        info.folderId
      );
      setCreatedSheetUrl(res.spreadsheetUrl);
      setStatusMsg('Exported tasks to a Google Sheet inside ASAN-user-content.');
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to export Google Sheet');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateMeet = async () => {
    if (!workspacePermissions.meetRooms) {
      setStatusMsg('Google Meet study rooms are disabled in View Plans → Workspace Permissions.');
      return;
    }
    setBusy(true);
    setStatusMsg(null);
    try {
      if (!workspaceToken) {
        const tok = await connectWorkspace();
        if (!tok) {
          setBusy(false);
          return;
        }
      }
      const space = await createGoogleMeetRoom();
      setMeetRoom({ meetingUri: space.meetingUri, meetingCode: space.meetingCode });
      setStatusMsg('Google Meet study room created.');
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to create Meet');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            Google Workspace (Opt-In Folder Sync)
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Accesses only files inside a dedicated <code className="font-mono">ASAN-user-content</code> Google Drive folder when you choose to connect.
          </p>
        </div>

        {!workspaceToken ? (
          <button
            type="button"
            onClick={handleConnectAndLoadFolder}
            disabled={busy || !anyPermEnabled}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Connect Google Drive &amp; Workspace
          </button>
        ) : (
          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            Workspace Connected (ASAN-user-content)
          </div>
        )}
      </div>

      {(!workspacePermissions.driveSync ||
        !workspacePermissions.sheetsSync ||
        !workspacePermissions.meetRooms ||
        !workspacePermissions.docsExport) && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800/70 bg-amber-50/70 dark:bg-amber-950/40 px-4 py-2.5 text-xs text-amber-900 dark:text-amber-300">
          One or more Google Workspace functions are turned off under <strong>View Plans → Google Workspace Function Permissions</strong>. Re-enable them anytime in View Plans.
        </div>
      )}

      {!workspaceToken && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex items-start gap-3 text-xs text-slate-600 dark:text-slate-300">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <div>
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              Folder-Isolated Google Drive Access
            </div>
            <p className="mt-0.5 leading-relaxed">
              Workspace permissions are never requested on sign-in. Connecting creates a single
              <strong className="text-slate-800 dark:text-slate-100"> ASAN-user-content </strong>
              folder in your Google Drive using <code className="font-mono">drive.file</code> scope, so every Sheet, Doc, and export created by this app stays strictly inside that folder.
            </p>
          </div>
        </div>
      )}

      {statusMsg && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 text-xs text-slate-700 dark:text-slate-300">
          {statusMsg}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Folder-Scoped Google Drive */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                ASAN-user-content Drive Folder
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {workspacePermissions.driveSync ? (
                <>
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">
                    <Upload className="h-3.5 w-3.5" />
                    Upload
                    <input
                      type="file"
                      className="hidden"
                      onChange={handleUploadToAppFolder}
                      disabled={busy}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleConnectAndLoadFolder}
                    disabled={busy}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    Open App Folder
                  </button>
                </>
              ) : (
                <span className="text-xs font-medium text-slate-400 dark:text-slate-500">Disabled in View Plans</span>
              )}
            </div>
          </div>

          {folderInfo?.webViewLink && (
            <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-200">
                Folder: {folderInfo.name}
              </span>
              <a
                href={folderInfo.webViewLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                View in Drive
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}

          {driveFiles.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-4">
              Click "Open App Folder" to create or browse files strictly inside your ASAN-user-content Drive folder.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 lg:max-h-64 lg:overflow-y-auto">
              {driveFiles.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between gap-2 py-2.5 text-xs"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-900 dark:text-slate-100">{f.name}</div>
                    <div className="truncate text-slate-400 dark:text-slate-500">{f.mimeType}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {f.webViewLink && (
                      <a
                        href={f.webViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Open
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => setDeleteFileTarget(f)}
                      className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                      aria-label={`Delete ${f.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Google Sheets Schedule & Tasks + Meet */}
        <div className="space-y-6">
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  Google Sheets Schedule &amp; Tasks
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {workspacePermissions.sheetsSync ? (
                  <>
                    <button
                      type="button"
                      onClick={handleSyncScheduleSheet}
                      disabled={busy}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                    >
                      Sync Schedule
                    </button>
                    <button
                      type="button"
                      onClick={handleSyncMasterExams}
                      disabled={busy}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                    >
                      Sync Master Exams
                    </button>
                    <button
                      type="button"
                      onClick={handleExportTasksSheet}
                      disabled={busy}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      Export Tasks ({tasks.length})
                    </button>
                  </>
                ) : (
                  <span className="text-xs font-medium text-slate-400 dark:text-slate-500">Disabled in View Plans</span>
                )}
              </div>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Maintain schedules, tasks, and the 3-row Exam Blueprint (<code className="font-mono">master</code> → <code className="font-mono">test_dates</code>) strictly inside your <code className="font-mono">ASAN-user-content</code> folder.
            </p>
            {createdSheetUrl && (
              <a
                href={createdSheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                Open Google Schedule Sheet
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Video className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  Google Meet Study Room
                </h2>
              </div>
              {workspacePermissions.meetRooms ? (
                <button
                  type="button"
                  onClick={handleCreateMeet}
                  disabled={busy}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  Create Meet Room
                </button>
              ) : (
                <span className="text-xs font-medium text-slate-400 dark:text-slate-500">Disabled in View Plans</span>
              )}
            </div>
            {meetRoom ? (
              <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/50 dark:bg-emerald-950/30 p-3 text-xs space-y-1">
                <div className="font-semibold text-emerald-900 dark:text-emerald-300">
                  Room Ready · Code: {meetRoom.meetingCode}
                </div>
                <a
                  href={meetRoom.meetingUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {meetRoom.meetingUri}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Launch an instant Google Meet room for collaborative study sessions or doubt clearing.
              </p>
            )}
          </section>
        </div>

        {/* Google Docs */}
        <section className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
            <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Create Google Doc
            </h2>
          </div>
          <form onSubmit={handleCreateDoc} className="space-y-3">
            <input
              type="text"
              required
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
              placeholder="Document title"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <textarea
              rows={3}
              value={docBody}
              onChange={(e) => setDocBody(e.target.value)}
              placeholder="Initial content for your Google Doc..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <div className="flex items-center justify-between">
              <button
                type="submit"
                disabled={busy || !workspacePermissions.docsExport}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {workspacePermissions.docsExport ? 'Create Doc' : 'Docs Export Disabled in View Plans'}
              </button>
              {createdDocUrl && (
                <a
                  href={createdDocUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Open Document
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </form>
        </section>
      </div>

      <ConfirmDialog
        open={Boolean(deleteFileTarget)}
        title="Delete File from ASAN-user-content Drive Folder?"
        description={`Are you sure you want to delete "${deleteFileTarget?.name}" from your ASAN-user-content Google Drive folder?`}
        confirmLabel="Delete File"
        destructive
        busy={busy}
        onConfirm={handleConfirmDeleteDrive}
        onCancel={() => setDeleteFileTarget(null)}
      />
    </div>
  );
};
