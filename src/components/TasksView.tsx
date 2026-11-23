import React, { useMemo, useState } from 'react';
import { Check, CloudUpload, FileSpreadsheet, Lock, Plus, Search, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  apiFetch,
  ensureAppDriveFolder,
  exportRowsToGoogleSheet,
  saveTextToDriveFolder,
} from '../lib/api';
import {
  FREE_TIER_MAX_TASKS,
  guestCreateTask,
  guestDeleteTask,
  guestUpdateTask,
} from '../lib/guestStore';
import type { StudyTask } from '../types';
import { ConfirmDialog } from './ConfirmDialog';

interface TasksViewProps {
  tasks: StudyTask[];
  onRefresh: () => Promise<void>;
}

export const TasksView: React.FC<TasksViewProps> = ({ tasks, onRefresh }) => {
  const {
    dbUser,
    isGuest,
    isWorkspaceEnabled,
    workspacePermissions,
    isEffectiveProOrAdmin,
    workspaceToken,
    connectWorkspace,
    connectBasicDrive,
    updateProfile,
  } = useAuth();
  const isProOrAdmin = isEffectiveProOrAdmin;
  const [driveTxtSaving, setDriveTxtSaving] = useState(false);

  const [filter, setFilter] = useState<'all' | 'todo' | 'in_progress' | 'done'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Create form
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('Physics');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleteTaskTarget, setDeleteTaskTarget] = useState<StudyTask | null>(null);
  const [deletingTask, setDeletingTask] = useState(false);

  const [sheetExporting, setSheetExporting] = useState(false);
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (filter !== 'all' && t.status !== filter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          t.title.toLowerCase().includes(q) ||
          t.subject.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [tasks, filter, searchQuery]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      if (isGuest) {
        guestCreateTask({
          title: title.trim(),
          subject: subject.trim() || 'General',
          priority,
          dueDate,
          description: description.trim(),
        });
      } else {
        await apiFetch('/api/tasks', {
          method: 'POST',
          body: JSON.stringify({
            title: title.trim(),
            subject: subject.trim() || 'General',
            priority,
            dueDate,
            description: description.trim(),
          }),
        });
      }
      setTitle('');
      setDescription('');
      await onRefresh();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to add task');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (task: StudyTask, nextStatus: StudyTask['status']) => {
    if (isGuest) {
      guestUpdateTask(task.id, { status: nextStatus });
    } else {
      await apiFetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
    }
    await onRefresh();
  };

  const handleConfirmDeleteTask = async () => {
    if (!deleteTaskTarget) return;
    setDeletingTask(true);
    setFeedback(null);
    try {
      if (isGuest) {
        guestDeleteTask(deleteTaskTarget.id);
      } else {
        await apiFetch(`/api/tasks/${deleteTaskTarget.id}`, { method: 'DELETE' });
      }
      setDeleteTaskTarget(null);
      await onRefresh();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to delete task');
    } finally {
      setDeletingTask(false);
    }
  };

  const handleBackupTxtToDrive = async () => {
    if (isGuest) return;
    setDriveTxtSaving(true);
    setFeedback(null);
    try {
      if (!workspaceToken) {
        const tok = isProOrAdmin ? await connectWorkspace() : await connectBasicDrive();
        if (!tok) {
          setDriveTxtSaving(false);
          return;
        }
      }
      const folder = await ensureAppDriveFolder(dbUser?.driveFolderId);
      if (folder.id !== dbUser?.driveFolderId) {
        await updateProfile({ driveFolderId: folder.id });
      }
      const txtLines = tasks.map(
        (t) =>
          `[${t.status.toUpperCase()}] ${t.title} | Subject: ${t.subject} | Priority: ${t.priority} | Due: ${t.dueDate || '-'} | Notes: ${t.description || '-'}`
      );
      const saved = await saveTextToDriveFolder(
        'asan_tasks.txt',
        `ASAN-Study_tool Tasks Backup (${new Date().toISOString()})\nTotal Tasks: ${tasks.length}\n\n${txtLines.join('\n')}\n`,
        folder.id
      );
      setFeedback(
        `Saved unlimited tasks as "${saved.name}" inside your ASAN-user-content Google Drive folder.`
      );
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Drive .txt backup failed');
    } finally {
      setDriveTxtSaving(false);
    }
  };

  const handleExportToSheets = async () => {
    if (!isProOrAdmin) {
      setFeedback('Google Sheets export is excluded from the Basic plan. Upgrade to Pro or Admin to sync with Google Workspace.');
      return;
    }
    setSheetExporting(true);
    setFeedback(null);
    setSheetUrl(null);
    try {
      if (!workspaceToken) {
        const tok = await connectWorkspace();
        if (!tok) {
          setSheetExporting(false);
          return;
        }
      }
      const folder = await ensureAppDriveFolder(dbUser?.driveFolderId);
      if (folder.id !== dbUser?.driveFolderId) {
        await updateProfile({ driveFolderId: folder.id });
      }
      const headers = ['ID', 'Title', 'Subject', 'Priority', 'Status', 'Due Date', 'Notes'];
      const rows = tasks.map((t) => [
        t.id,
        t.title,
        t.subject,
        t.priority,
        t.status,
        t.dueDate || '-',
        t.description || '',
      ]);
      const res = await exportRowsToGoogleSheet(
        `ASAN Study Tasks (${new Date().toISOString().slice(0, 10)})`,
        headers,
        rows,
        folder.id
      );
      setSheetUrl(res.spreadsheetUrl);
      setFeedback('Exported task log to Google Sheets inside ASAN-user-content.');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to export to Google Sheets');
    } finally {
      setSheetExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">My Tasks</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {isGuest
              ? `Free Tier: ${tasks.length} / ${FREE_TIER_MAX_TASKS} tasks used locally. Sign in (Basic) for unlimited tasks & Drive .txt folder storage.`
              : `Unlimited tasks synced (${tasks.length} total). Optionally store as .txt inside your ASAN-user-content Drive folder.`}
          </p>
        </div>

        {isWorkspaceEnabled && (
          <div className="flex flex-wrap items-center gap-2">
            {!isGuest && workspacePermissions.driveSync && (
              <button
                type="button"
                onClick={handleBackupTxtToDrive}
                disabled={driveTxtSaving}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <CloudUpload className="h-3.5 w-3.5 text-blue-600" />
                {driveTxtSaving ? 'Saving .txt...' : 'Save as .txt in Drive Folder'}
              </button>
            )}
            {isProOrAdmin ? (
              workspacePermissions.sheetsSync ? (
                <button
                  type="button"
                  onClick={handleExportToSheets}
                  disabled={sheetExporting || tasks.length === 0}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                  {sheetExporting ? 'Exporting...' : 'Export to Google Sheets'}
                </button>
              ) : (
                <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 whitespace-nowrap shrink-0">
                  Sheets sync off (View Plans)
                </div>
              )
            ) : (
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 whitespace-nowrap shrink-0">
                <Lock className="h-3.5 w-3.5" />
                Google Sheets export (Pro)
              </div>
            )}
          </div>
        )}
      </div>

      {feedback && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
          <span>{feedback}</span>
          {sheetUrl && (
            <a
              href={sheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-blue-600 hover:underline"
            >
              Open Google Sheet
            </a>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* New Task Form */}
        <form
          onSubmit={handleCreate}
          className="lg:col-span-4 h-fit rounded-xl border border-slate-200 bg-white p-6 space-y-4"
        >
          <h2 className="font-display text-base font-semibold text-slate-900">
            Add Study Task
          </h2>

          <div>
            <label className="block text-xs font-medium text-slate-600">Task Title</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Solve Electrostatics PYQs"
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
              <label className="block text-xs font-medium text-slate-600">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as 'low' | 'medium' | 'high')}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600">Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600">Notes</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Page numbers, chapter details..."
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            {submitting ? 'Adding...' : 'Add Task'}
          </button>
        </form>

        {/* Task List & Filters */}
        <div className="lg:col-span-8 rounded-xl border border-slate-200 bg-white p-6 space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              {(['all', 'todo', 'in_progress', 'done'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setFilter(tab)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    filter === tab
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab === 'all'
                    ? 'All'
                    : tab === 'todo'
                      ? 'To Do'
                      : tab === 'in_progress'
                        ? 'In Progress'
                        : 'Done'}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tasks..."
                className="w-full sm:w-56 rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {filteredTasks.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">
              No tasks match this filter. Add a new study task on the left.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredTasks.map((task) => {
                const isDone = task.status === 'done';
                return (
                  <div
                    key={task.id}
                    className="flex items-start justify-between gap-4 py-4"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <button
                        type="button"
                        onClick={() =>
                          handleStatusChange(task, isDone ? 'todo' : 'done')
                        }
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                          isDone
                            ? 'border-blue-600 bg-blue-600 text-white'
                            : 'border-slate-300 bg-white hover:border-blue-500'
                        }`}
                        aria-label={isDone ? 'Mark incomplete' : 'Mark complete'}
                      >
                        {isDone && <Check className="h-3.5 w-3.5" />}
                      </button>

                      <div className="min-w-0">
                        <div
                          className={`text-sm font-medium ${
                            isDone ? 'text-slate-400 line-through' : 'text-slate-900'
                          }`}
                        >
                          {task.title}
                        </div>
                        {task.description && (
                          <p className="mt-1 text-xs text-slate-600">{task.description}</p>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span>{task.subject}</span>
                          <span aria-hidden="true">·</span>
                          <span className="capitalize">{task.priority} priority</span>
                          {task.dueDate && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="tabular-nums">Due {task.dueDate}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        value={task.status}
                        onChange={(e) =>
                          handleStatusChange(
                            task,
                            e.target.value as StudyTask['status']
                          )
                        }
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                        aria-label="Task status"
                      >
                        <option value="todo">To Do</option>
                        <option value="in_progress">In Progress</option>
                        <option value="done">Done</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => setDeleteTaskTarget(task)}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        aria-label="Delete task"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTaskTarget)}
        title="Delete Study Task?"
        description={`Permanently delete task "${deleteTaskTarget?.title}"?`}
        confirmLabel="Delete Permanently"
        destructive
        busy={deletingTask}
        onConfirm={handleConfirmDeleteTask}
        onCancel={() => setDeleteTaskTarget(null)}
      />
    </div>
  );
};
