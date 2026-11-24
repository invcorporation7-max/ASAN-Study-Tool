import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  CloudUpload,
  Copy,
  Globe,
  Inbox,
  Lock,
  Mail,
  Send,
  Shield,
  Trash2,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  apiFetch,
  ensureAppDriveFolder,
  saveJsonToDriveFolder,
} from '../lib/api';
import type {
  InAppMessageItem,
  StudyNotePage,
  ToolUserSummary,
} from '../types';
import { ConfirmDialog } from './ConfirmDialog';
import { UserAvatarBadge } from './UserAvatarBadge';

interface MessagesViewProps {
  notePages: StudyNotePage[];
  preselectedNoteId?: number | null;
}

export const MessagesView: React.FC<MessagesViewProps> = ({
  notePages,
  preselectedNoteId = null,
}) => {
  const {
    dbUser,
    isGuest,
    isWorkspaceEnabled,
    isEffectiveProOrAdmin,
    signIn,
    workspaceToken,
    connectWorkspace,
    connectBasicDrive,
    updateProfile,
  } = useAuth();
  const isProOrAdmin = isEffectiveProOrAdmin;
  const isAdmin = dbUser?.role === 'admin' || dbUser?.role === 'super';

  const [tab, setTab] = useState<'inbox' | 'public' | 'self' | 'sent' | 'compose'>(
    preselectedNoteId ? 'compose' : 'inbox'
  );
  const [messages, setMessages] = useState<InAppMessageItem[]>([]);
  const [toolUsers, setToolUsers] = useState<ToolUserSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // Username editor
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState(dbUser?.username || '');
  const [savingUsername, setSavingUsername] = useState(false);

  // Compose state
  const [visibility, setVisibility] = useState<'direct' | 'self' | 'public'>('direct');
  const [isAdminMail, setIsAdminMail] = useState(false);
  const [recipientInput, setRecipientInput] = useState('');
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachmentNoteId, setAttachmentNoteId] = useState<string>(
    preselectedNoteId ? String(preselectedNoteId) : ''
  );
  const [sending, setSending] = useState(false);
  const [copiedUid, setCopiedUid] = useState(false);
  const [deleteMsgTarget, setDeleteMsgTarget] = useState<InAppMessageItem | null>(null);
  const [deletingMsg, setDeletingMsg] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setUsernameDraft(dbUser?.username || '');
  }, [dbUser?.username]);

  const loadData = useCallback(async () => {
    if (isGuest || !dbUser) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const [msgs, users] = await Promise.all([
        apiFetch<InAppMessageItem[]>('/api/messages'),
        apiFetch<ToolUserSummary[]>('/api/tool-users'),
      ]);
      setMessages(msgs);
      setToolUsers(users);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [dbUser, isGuest]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (preselectedNoteId) {
      setAttachmentNoteId(String(preselectedNoteId));
      const matched = notePages.find((n) => n.id === preselectedNoteId);
      if (matched) {
        setSubject(`Shared A4 Note: ${matched.title}`);
      }
      setTab('compose');
    }
  }, [preselectedNoteId, notePages]);

  const suggestions = useMemo(() => {
    const q = recipientInput.trim().toLowerCase().replace(/^@/, '');
    return toolUsers
      .filter((u) => {
        const tokenEmail = u.email.toLowerCase();
        const tokenUser = (u.username || '').toLowerCase();
        const tokenShortUid = (u.shortUid || '').toLowerCase();
        const already = selectedRecipients.some(
          (r) =>
            r.toLowerCase() === tokenEmail ||
            r.toLowerCase().replace(/^@/, '') === tokenUser ||
            (tokenShortUid && r.toLowerCase() === tokenShortUid) ||
            r.toUpperCase() === `ASAN-USR-${u.id}`
        );
        if (already) return false;
        if (!q) return true;
        return (
          tokenUser.includes(q) ||
          tokenEmail.includes(q) ||
          tokenShortUid.includes(q) ||
          u.displayName.toLowerCase().includes(q) ||
          `asan-usr-${u.id}`.includes(q) ||
          String(u.id) === q
        );
      })
      .slice(0, 6);
  }, [toolUsers, recipientInput, selectedRecipients]);

  const addRecipientToken = (token: string) => {
    const clean = token.trim();
    if (!clean) return;
    if (!selectedRecipients.some((r) => r.toLowerCase() === clean.toLowerCase())) {
      setSelectedRecipients((prev) => [...prev, clean]);
    }
    setRecipientInput('');
    setShowSuggestions(false);
  };

  const removeRecipientToken = (token: string) => {
    setSelectedRecipients((prev) => prev.filter((r) => r !== token));
  };

  const handleSaveUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingUsername(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await updateProfile({ username: usernameDraft });
      setEditingUsername(false);
      setStatusMsg(`Username updated to @${usernameDraft.trim().toLowerCase()}.`);
      await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update username');
    } finally {
      setSavingUsername(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setErrorMsg(null);
    setStatusMsg(null);

    const combinedRecipients = [...selectedRecipients];
    if (recipientInput.trim()) {
      recipientInput
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .forEach((x) => {
          if (!combinedRecipients.includes(x)) combinedRecipients.push(x);
        });
    }

    try {
      const matchedNote = notePages.find((n) => String(n.id) === attachmentNoteId);
      await apiFetch('/api/messages', {
        method: 'POST',
        body: JSON.stringify({
          recipients: visibility === 'direct' ? combinedRecipients : [],
          visibility,
          isAdminMail: isAdmin && isAdminMail,
          subject: subject.trim(),
          body: body.trim(),
          attachmentNoteId: matchedNote ? matchedNote.id : null,
          attachmentTitle: matchedNote ? matchedNote.title : '',
        }),
      });
      setStatusMsg(
        visibility === 'public'
          ? 'Published to Public Community Mail.'
          : visibility === 'self'
            ? 'Saved message to your Self Archive.'
            : `Sent mail to ${combinedRecipients.length} recipient(s).`
      );
      setSelectedRecipients([]);
      setRecipientInput('');
      setSubject('');
      setBody('');
      setAttachmentNoteId('');
      setIsAdminMail(false);
      await loadData();
      setTab(
        visibility === 'public' ? 'public' : visibility === 'self' ? 'self' : 'sent'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleMarkRead = async (id: number) => {
    await apiFetch(`/api/messages/${id}/read`, { method: 'PATCH' });
    await loadData();
  };

  const handleConfirmDelete = async () => {
    if (!deleteMsgTarget) return;
    setDeletingMsg(true);
    setErrorMsg(null);
    try {
      await apiFetch(`/api/messages/${deleteMsgTarget.id}`, { method: 'DELETE' });
      setStatusMsg(`Deleted message "${deleteMsgTarget.subject}".`);
      setDeleteMsgTarget(null);
      await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to delete message');
    } finally {
      setDeletingMsg(false);
    }
  };

  const handleBackupToDriveFolder = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      if (!workspaceToken) {
        const tok = isProOrAdmin ? await connectWorkspace() : await connectBasicDrive();
        if (!tok) return;
      }
      const folder = await ensureAppDriveFolder(dbUser?.driveFolderId);
      if (folder.id !== dbUser?.driveFolderId) {
        await updateProfile({ driveFolderId: folder.id });
      }
      const saved = await saveJsonToDriveFolder(
        `asan_messages_backup_${new Date().toISOString().slice(0, 10)}.json`,
        messages,
        folder.id
      );
      setStatusMsg(
        `Backed up ${messages.length} message(s) to Drive folder "ASAN-user-content" (${saved.name}).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Drive backup failed');
    }
  };

  if (isGuest) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 space-y-4">
          <div className="flex items-start gap-3">
            <Lock className="mt-1 h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                Tool Mail Requires Sign-In
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                In-app Tool Mail uses your unique <strong>@username</strong> and <strong>User ID</strong> to send Direct, Multiple-Recipient, Self, and Public messages between registered ASAN-Study_tool users. Sign in with Google to get your User ID + 500 Welcome Points.
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

  const inboxMessages = messages.filter(
    (m) => m.visibility === 'direct' && m.recipientId === dbUser?.id
  );
  const publicMessages = messages.filter((m) => m.visibility === 'public');
  const selfMessages = messages.filter(
    (m) => m.visibility === 'self' && m.senderId === dbUser?.id
  );
  const sentMessages = messages.filter(
    (m) => m.senderId === dbUser?.id && m.visibility !== 'self'
  );

  const visibleList =
    tab === 'inbox'
      ? inboxMessages
      : tab === 'public'
        ? publicMessages
        : tab === 'self'
          ? selfMessages
          : sentMessages;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Tool Mail · Internal Messaging
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Send mail via <strong>@username</strong>, <strong>User ID</strong>, or email to single/multiple recipients, Self Archive, or Public Community Board.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
            {(
              [
                { id: 'inbox', label: `Inbox (${inboxMessages.length})` },
                { id: 'public', label: `Public (${publicMessages.length})` },
                { id: 'self', label: `Self (${selfMessages.length})` },
                { id: 'sent', label: `Sent (${sentMessages.length})` },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                  tab === item.id
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setTab('compose')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                tab === 'compose'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Compose Mail
            </button>
          </div>

          {isWorkspaceEnabled && (
            <button
              type="button"
              onClick={handleBackupToDriveFolder}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
            >
              <CloudUpload className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              Backup to Drive Folder
            </button>
          )}
        </div>
      </div>

      {/* User Mail Identity Strip (5-char UID + @username + Avatar Ring) */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
          {dbUser && (
            <UserAvatarBadge
              name={dbUser.displayName}
              photoUrl={dbUser.photoUrl}
              plan={dbUser.plan}
              role={dbUser.role}
              contributorApproved={dbUser.contributorApproved}
              size="sm"
            />
          )}
          <button
            type="button"
            onClick={() => {
              const uid = dbUser?.shortUid || `ASAN-USR-${dbUser?.id || 1}`;
              navigator.clipboard?.writeText(uid);
              setCopiedUid(true);
              setTimeout(() => setCopiedUid(false), 1800);
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-700"
            title="Copy 5-char UID"
          >
            <span>5-Char UID:</span>
            <strong className="font-mono text-slate-900 dark:text-slate-100 tracking-wider">
              {dbUser?.shortUid || `U${dbUser?.id || 1}`}
            </strong>
            <Copy className="h-3 w-3 text-slate-500 dark:text-slate-400" />
            {copiedUid && <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">Copied</span>}
          </button>
          <span aria-hidden="true">·</span>
          <span>
            Username:{' '}
            <strong className="font-mono text-blue-700 dark:text-blue-400">
              @{dbUser?.username || 'student'}
            </strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>{dbUser?.email}</span>
        </div>

        {editingUsername ? (
          <form onSubmit={handleSaveUsername} className="flex items-center gap-2">
            <input
              type="text"
              value={usernameDraft}
              onChange={(e) => setUsernameDraft(e.target.value)}
              placeholder="new_username"
              className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-mono text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={savingUsername}
              className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditingUsername(false)}
              className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-xs text-slate-600 dark:text-slate-300"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setEditingUsername(true)}
            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0"
          >
            Edit @username
          </button>
        )}
      </div>

      {statusMsg && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/50 px-4 py-2.5 text-xs text-emerald-800 dark:text-emerald-300">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 px-4 py-2.5 text-xs text-red-700 dark:text-red-300">
          {errorMsg}
        </div>
      )}

      {tab === 'compose' ? (
        <form
          onSubmit={handleSend}
          className="max-w-3xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Compose Tool Mail
              </h2>
            </div>

            <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
              {(
                [
                  { id: 'direct', label: 'Direct Users', icon: UserPlus },
                  { id: 'self', label: 'Self Archive', icon: UserCheck },
                  { id: 'public', label: 'Public Board', icon: Globe },
                ] as const
              ).map((mode) => {
                const Icon = mode.icon;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setVisibility(mode.id)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                      visibility === mode.id
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Icon className="h-3 w-3" />
                    {mode.label}
                  </button>
                );
              })}
            </div>
          </div>

          {visibility === 'direct' && (
            <div className="relative space-y-2">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                Recipients (Add multiple by @username, 5-char UID like K7P9M, or Email)
              </label>

              {selectedRecipients.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedRecipients.map((rec) => (
                    <span
                      key={rec}
                      className="inline-flex items-center gap-1 rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 px-2 py-1 text-xs font-medium text-blue-800 dark:text-blue-200"
                    >
                      {rec}
                      <button
                        type="button"
                        onClick={() => removeRecipientToken(rec)}
                        className="text-blue-600 dark:text-blue-300 hover:text-blue-900"
                        aria-label={`Remove ${rec}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  value={recipientInput}
                  onFocus={() => setShowSuggestions(true)}
                  onChange={(e) => {
                    setRecipientInput(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      addRecipientToken(recipientInput.replace(/,$/, ''));
                    }
                  }}
                  placeholder="Type @username, 5-char UID (K7P9M), or email and press Enter..."
                  className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => addRecipientToken(recipientInput)}
                  disabled={!recipientInput.trim()}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 whitespace-nowrap"
                >
                  Add Recipient
                </button>
              </div>

              {/* Live Suggestions Dropdown + Quick Pick */}
              {showSuggestions && suggestions.length > 0 && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-md divide-y divide-slate-100 dark:divide-slate-800 max-h-56 overflow-y-auto">
                  <div className="px-3 py-1.5 text-[11px] font-medium text-slate-400 bg-slate-50 dark:bg-slate-800 flex items-center justify-between">
                    <span>Suggested Registered Tool Users</span>
                    <button
                      type="button"
                      onClick={() => setShowSuggestions(false)}
                      className="text-slate-500 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white"
                    >
                      Close
                    </button>
                  </div>
                  {suggestions.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() =>
                        addRecipientToken(
                          u.shortUid || (u.username ? `@${u.username}` : u.email)
                        )
                      }
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <UserAvatarBadge
                          name={u.displayName}
                          photoUrl={u.photoUrl}
                          plan={u.plan}
                          role={u.role}
                          contributorApproved={u.contributorApproved}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <div>
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {u.displayName}
                            </span>{' '}
                            <span className="font-mono text-blue-700 dark:text-blue-400">
                              @{u.username || 'user'}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                              {u.shortUid || `U${u.id}`}
                            </span>{' '}
                            · {u.email}
                          </div>
                        </div>
                      </div>
                      <span className="text-[11px] text-slate-400 capitalize shrink-0">
                        {u.role === 'admin' ? 'Admin' : u.plan}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {visibility === 'self' && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-xs text-slate-600 dark:text-slate-300">
              Self Archive saves this mail directly in your personal <strong>Self</strong> mailbox for formulas, study checklists, or credentials.
            </div>
          )}

          {visibility === 'public' && (
            <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 px-3.5 py-2.5 text-xs text-blue-800 dark:text-blue-200">
              Public Mail posts to the shared community board visible to all signed-in ASAN-Study_tool users.
            </div>
          )}

          {isAdmin && (
            <label className="flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3.5 py-2.5 text-xs font-medium text-amber-900 dark:text-amber-200 cursor-pointer">
              <input
                type="checkbox"
                checked={isAdminMail}
                onChange={(e) => setIsAdminMail(e.target.checked)}
                className="h-4 w-4 rounded border-amber-400 text-amber-600"
              />
              <Shield className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400" />
              Send as Official Admin Mail (badges sender as Workspace Admin)
            </label>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Subject</label>
            <input
              type="text"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g., Electrostatics Revision Sheet or Pro Key"
              className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
              Attach A4 Note Reference (Optional)
            </label>
            <select
              value={attachmentNoteId}
              onChange={(e) => setAttachmentNoteId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
            >
              <option value="">None</option>
              {notePages.map((np) => (
                <option key={np.id} value={np.id}>
                  {np.title} ({np.sectionName})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Message</label>
            <textarea
              rows={5}
              required
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your study note, message, or announcement..."
              className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={sending}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            <Send className="h-4 w-4" />
            {sending ? 'Sending...' : 'Send Mail'}
          </button>
        </form>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
          {loading ? (
            <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              Loading Tool Mail...
            </div>
          ) : visibleList.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <Inbox className="mx-auto h-6 w-6 text-slate-400" />
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No messages in {tab === 'public' ? 'Public Board' : tab === 'self' ? 'Self Archive' : tab} yet.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {visibleList.map((m) => (
                <div
                  key={m.id}
                  onClick={() => {
                    if (tab === 'inbox' && !m.isRead) handleMarkRead(m.id);
                  }}
                  className="flex items-start justify-between gap-4 py-4"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-sm ${
                          tab === 'inbox' && !m.isRead
                            ? 'font-bold text-slate-900 dark:text-white'
                            : 'font-semibold text-slate-800 dark:text-slate-100'
                        }`}
                      >
                        {m.subject}
                      </span>
                      {m.isAdminMail && (
                        <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                          · Admin Mail
                        </span>
                      )}
                      {tab === 'inbox' && !m.isRead && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                          <Check className="h-3 w-3" /> Unread
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      From:{' '}
                      <span className="font-mono text-slate-700 dark:text-slate-300">
                        @{m.senderUsername || m.senderEmail.split('@')[0]}
                      </span>{' '}
                      ({m.senderEmail})
                      {m.visibility === 'public'
                        ? ' · Public Community Mail'
                        : m.visibility === 'self'
                          ? ' · Self Archive'
                          : ` · To: ${m.recipientSummary || (m.recipientUsername ? `@${m.recipientUsername}` : m.recipientEmail)}`}
                      {' · '}
                      <span className="tabular-nums">
                        {new Date(m.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                      {m.body}
                    </p>
                    {m.attachmentTitle && (
                      <div className="text-xs font-medium text-blue-600 dark:text-blue-400">
                        Attached A4 Note: {m.attachmentTitle}
                      </div>
                    )}
                  </div>

                  {(m.senderId === dbUser?.id || m.recipientId === dbUser?.id) && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteMsgTarget(m);
                      }}
                      className="rounded p-1.5 text-slate-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-400 shrink-0"
                      aria-label="Delete message"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteMsgTarget)}
        title="Delete Tool Mail Message?"
        description={`Permanently delete message "${deleteMsgTarget?.subject}"? This cannot be undone.`}
        confirmLabel="Delete Permanently"
        destructive
        busy={deletingMsg}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteMsgTarget(null)}
      />
    </div>
  );
};
