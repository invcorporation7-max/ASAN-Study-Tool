import React, { useCallback, useEffect, useState } from 'react';
import { Bell, BellRing, Check, Lock, Send } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';
import type { NotificationItem, ToolUserSummary } from '../types';

interface NotificationsViewProps {
  onCountChange?: (unreadCount: number) => void;
}

export const NotificationsView: React.FC<NotificationsViewProps> = ({
  onCountChange,
}) => {
  const { dbUser, isGuest, signIn } = useAuth();
  const isAdmin = dbUser?.role === 'admin' || dbUser?.role === 'super';

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [toolUsers, setToolUsers] = useState<ToolUserSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const [targetRecipient, setTargetRecipient] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [browserPerm, setBrowserPerm] = useState<string>(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );

  const loadNotifications = useCallback(async () => {
    if (isGuest || !dbUser) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [rows, users] = await Promise.all([
        apiFetch<NotificationItem[]>('/api/notifications'),
        apiFetch<ToolUserSummary[]>('/api/tool-users'),
      ]);
      setNotifications(rows);
      setToolUsers(users);
      onCountChange?.(rows.filter((n) => !n.isRead).length);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, [dbUser, isGuest, onCountChange]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const handleRequestBrowserNotifications = async () => {
    if (typeof Notification === 'undefined') return;
    const perm = await Notification.requestPermission();
    setBrowserPerm(perm);
    if (perm === 'granted') {
      new Notification('ASAN-Study_tool Notifications Enabled', {
        body: 'You will receive desktop alerts for new mail, points, and study reminders.',
      });
    }
  };

  const handleMarkRead = async (id: number) => {
    await apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
    await loadNotifications();
  };

  const handleSendNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await apiFetch('/api/notifications', {
        method: 'POST',
        body: JSON.stringify({
          targetRecipient: targetRecipient.trim(),
          title: title.trim(),
          message: message.trim(),
        }),
      });
      setStatusMsg(
        !targetRecipient.trim() || targetRecipient.trim().toLowerCase() === 'all'
          ? 'Broadcast notification sent to all ASAN-Study_tool users.'
          : `Notification sent to ${targetRecipient.trim()}.`
      );
      setTitle('');
      setMessage('');
      setTargetRecipient('');
      await loadNotifications();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to send notification');
    } finally {
      setSending(false);
    }
  };

  if (isGuest) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 space-y-4 asan-card-hover">
          <div className="flex items-start gap-3">
            <Lock className="mt-1 h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                Notifications Require Sign-In
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Sign in with Google to receive points alerts, license key notifications, Tool Mail alerts, and send study pings to teammates.
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
            Notifications Center
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Real-time alerts for points rewards, Tool Mail, license keys, and direct study notifications.
          </p>
        </div>

        {browserPerm !== 'unsupported' && (
          <button
            type="button"
            onClick={handleRequestBrowserNotifications}
            disabled={browserPerm === 'granted'}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <BellRing className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            {browserPerm === 'granted'
              ? 'Browser Alerts Active'
              : 'Enable Browser Alerts'}
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Send Notification Form */}
        <form
          onSubmit={handleSendNotification}
          className="lg:col-span-5 h-fit rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 asan-card-hover"
        >
          <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
            <Send className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Send Notification
            </h2>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
              Target User (@username, 5-char UID, Email{isAdmin ? ', or "all" to broadcast' : ''})
            </label>
            <input
              type="text"
              required={!isAdmin}
              list="notif-user-suggestions"
              value={targetRecipient}
              onChange={(e) => setTargetRecipient(e.target.value)}
              placeholder={
                isAdmin
                  ? 'Leave blank or "all" for broadcast, @username, or 5-char UID...'
                  : 'e.g. @rahul or K7P9M'
              }
              className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
            />
            <datalist id="notif-user-suggestions">
              {isAdmin && <option value="all">All Users (Broadcast)</option>}
              {toolUsers.map((u) => (
                <option key={u.id} value={u.shortUid || `@${u.username}`}>
                  {u.displayName} ({u.shortUid || `U${u.id}`} · @{u.username} · {u.email})
                </option>
              ))}
            </datalist>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
              Notification Title
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Physics Mock Exam at 6 PM"
              className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Message</label>
            <textarea
              rows={3}
              required
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Short alert message..."
              className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={sending}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            <Bell className="h-3.5 w-3.5" />
            {sending ? 'Sending...' : 'Send Notification'}
          </button>
        </form>

        {/* Notification Inbox */}
        <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 asan-card-hover">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Your Alerts ({notifications.length})
            </h2>
          </div>

          {loading ? (
            <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              Loading notifications...
            </p>
          ) : notifications.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No notifications yet.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 lg:max-h-[540px] lg:overflow-y-auto">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className="flex items-start justify-between gap-4 py-3.5"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-sm ${
                          n.isRead
                            ? 'font-medium text-slate-800 dark:text-slate-200'
                            : 'font-bold text-slate-900 dark:text-white'
                        }`}
                      >
                        {n.title}
                      </span>
                      {!n.isRead && (
                        <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                          New
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300">{n.message}</p>
                    <div className="text-[11px] text-slate-400 tabular-nums">
                      {n.senderLabel} · {new Date(n.createdAt).toLocaleString()}
                    </div>
                  </div>
                  {!n.isRead && (
                    <button
                      type="button"
                      onClick={() => handleMarkRead(n.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 shrink-0"
                    >
                      <Check className="h-3 w-3" />
                      Read
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
