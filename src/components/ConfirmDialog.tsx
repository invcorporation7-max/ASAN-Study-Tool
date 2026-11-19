import React, { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const CONFIRM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function make3CharSequence(): string {
  let out = '';
  for (let i = 0; i < 3; i++) {
    out += CONFIRM_CHARS[Math.floor(Math.random() * CONFIRM_CHARS.length)];
  }
  return out;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}) => {
  const [challenge, setChallenge] = useState('');
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (open && destructive) {
      setChallenge(make3CharSequence());
      setTyped('');
    } else if (!open) {
      setTyped('');
    }
  }, [open, destructive]);

  if (!open) return null;

  const isMatch = !destructive || typed.trim().toUpperCase() === challenge;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                destructive ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
              }`}
            >
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h3
                id="confirm-dialog-title"
                className="text-base font-semibold text-slate-900"
              >
                {title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                {description}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {destructive && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50/70 p-3.5">
            <p className="text-xs font-medium text-red-800">
              Permanent deletion warning: deleted data is lost permanently and cannot be recovered.
            </p>
            <div className="mt-2.5 flex items-center justify-between gap-2">
              <span className="text-xs text-slate-700">
                Type this 3-character sequence to confirm:
              </span>
              <div className="flex items-center gap-1.5">
                <code className="rounded bg-white px-2.5 py-1 font-mono text-sm font-bold tracking-widest text-red-700 border border-red-200">
                  {challenge}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    setChallenge(make3CharSequence());
                    setTyped('');
                  }}
                  title="New sequence"
                  className="rounded p-1 text-slate-500 hover:bg-white hover:text-slate-800"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <input
              type="text"
              maxLength={3}
              value={typed}
              onChange={(e) => setTyped(e.target.value.toUpperCase())}
              placeholder="Retype 3 chars"
              autoFocus
              className="mt-2.5 w-full rounded-lg border border-red-200 bg-white px-3 py-2 font-mono text-sm font-semibold uppercase tracking-widest text-slate-900 outline-none focus:border-red-500"
            />
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || !isMatch}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white whitespace-nowrap shrink-0 disabled:cursor-not-allowed disabled:opacity-50 ${
              destructive
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {busy ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
