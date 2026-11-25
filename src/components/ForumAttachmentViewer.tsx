import React, { useEffect, useState } from 'react';
import {
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Music,
  Presentation,
  X,
} from 'lucide-react';
import { fetchAuthMediaBlobUrl } from '../lib/api';
import type { ForumAttachmentItem } from '../types';

export function formatBytesCompact(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const AuthMediaPreview: React.FC<{
  url: string;
  mimeType?: string;
  fileName?: string;
  mediaKind?: string;
  compact?: boolean;
}> = ({ url, mimeType = '', fileName = 'file', mediaKind, compact = false }) => {
  const [blobUrl, setBlobUrl] = useState<string>('');
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const lowerName = fileName.toLowerCase();
  const isImage =
    mediaKind === 'photo' ||
    mimeType.startsWith('image/') ||
    /\.(png|jpe?g|webp|gif|bmp|svg)$/.test(lowerName);
  const isVideo =
    mediaKind === 'video' ||
    (mimeType.startsWith('video/') && mediaKind !== 'recording') ||
    /\.(mp4|mov|mkv|avi|m4v)$/.test(lowerName);
  const isAudio =
    mediaKind === 'recording' ||
    mimeType.startsWith('audio/') ||
    /\.(mp3|wav|ogg|m4a|aac|flac)$/.test(lowerName);
  const isPdf = mediaKind === 'pdf' || mimeType.includes('pdf') || lowerName.endsWith('.pdf');
  const isText =
    mediaKind === 'text' ||
    mimeType.startsWith('text/') ||
    /\.(txt|md|markdown|csv|log|tex)$/.test(lowerName);

  useEffect(() => {
    let active = true;
    let revokeFn: (() => void) | null = null;
    setLoading(true);
    setErr('');
    setTextContent(null);

    void fetchAuthMediaBlobUrl(url)
      .then(async (res) => {
        if (!active) {
          res.revoke();
          return;
        }
        revokeFn = res.revoke;
        setBlobUrl(res.objectUrl);
        if (isText && res.blob && res.blob.size > 0 && res.blob.size < 2 * 1024 * 1024) {
          const txt = await res.blob.text().catch(() => null);
          if (active && txt !== null) setTextContent(txt);
        }
      })
      .catch((e: unknown) => {
        if (active) setErr(e instanceof Error ? e.message : 'Unable to load preview');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      revokeFn?.();
    };
  }, [url, isText]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-500 dark:text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading preview...
      </div>
    );
  }

  if (err || !blobUrl) {
    return (
      <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300">
        {err || 'Preview unavailable'}
      </div>
    );
  }

  if (isImage) {
    return (
      <img
        src={blobUrl}
        alt={fileName}
        className={
          compact
            ? 'max-h-64 w-auto rounded-lg border border-slate-200 dark:border-slate-700 object-contain bg-slate-50 dark:bg-slate-900'
            : 'max-h-[75vh] w-auto mx-auto rounded-lg object-contain'
        }
      />
    );
  }

  if (isVideo) {
    return (
      <video
        src={blobUrl}
        controls
        className={
          compact
            ? 'w-full max-h-72 rounded-lg bg-black'
            : 'w-full max-h-[72vh] rounded-lg bg-black'
        }
      />
    );
  }

  if (isAudio) {
    return (
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-4 flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200">
          <Music className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <span className="truncate">{fileName}</span>
        </div>
        <audio src={blobUrl} controls className="w-full" />
      </div>
    );
  }

  if (isText && textContent !== null) {
    return (
      <pre className="max-h-[68vh] overflow-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-4 text-xs font-mono text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words">
        {textContent}
      </pre>
    );
  }

  if (isPdf) {
    return (
      <iframe
        src={blobUrl}
        title={fileName}
        className={
          compact
            ? 'w-full h-72 rounded-lg border border-slate-200 dark:border-slate-700 bg-white'
            : 'w-full h-[75vh] rounded-lg border border-slate-200 dark:border-slate-700 bg-white'
        }
      />
    );
  }

  // Word / Excel / PPT / generic document preview fallback with direct download button
  const DocIcon =
    mediaKind === 'excel'
      ? FileSpreadsheet
      : mediaKind === 'ppt'
        ? Presentation
        : mediaKind === 'video'
          ? Film
          : FileText;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-6 text-center space-y-3">
      <DocIcon className="h-10 w-10 mx-auto text-blue-600 dark:text-blue-400" />
      <div>
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{fileName}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Office / binary document ready to open or download locally.
        </div>
      </div>
      <div className="flex items-center justify-center gap-2">
        <a
          href={blobUrl}
          download={fileName}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-xs font-semibold"
        >
          <Download className="h-3.5 w-3.5" />
          Download File
        </a>
        <a
          href={blobUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open Tab
        </a>
      </div>
    </div>
  );
};

export const ForumAttachmentGrid: React.FC<{
  attachments?: ForumAttachmentItem[];
}> = ({ attachments }) => {
  const [previewItem, setPreviewItem] = useState<ForumAttachmentItem | null>(null);

  if (!attachments || attachments.length === 0) return null;

  const handleDownload = async (att: ForumAttachmentItem) => {
    try {
      const res = await fetchAuthMediaBlobUrl(att.url);
      const a = document.createElement('a');
      a.href = res.objectUrl;
      a.download = att.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => res.revoke(), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {attachments.map((att) => (
          <div
            key={att.id}
            className="rounded-xl border border-slate-200 dark:border-slate-700/80 bg-slate-50/70 dark:bg-slate-800/50 p-2.5 flex flex-col gap-2"
          >
            {att.kind === 'image' ? (
              <div
                onClick={() => setPreviewItem(att)}
                className="cursor-pointer overflow-hidden rounded-lg bg-white dark:bg-slate-900 flex items-center justify-center max-h-56"
              >
                <AuthMediaPreview
                  url={att.url}
                  mimeType={att.mimeType}
                  fileName={att.fileName}
                  mediaKind="photo"
                  compact
                />
              </div>
            ) : (
              <div className="flex items-center gap-2.5 p-1">
                <div className="h-9 w-9 rounded-lg bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-300 flex items-center justify-center shrink-0">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                    {att.fileName}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    PDF · {att.pageCount || 1} pg · {formatBytesCompact(att.fileSizeBytes)}
                  </div>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 text-[11px] pt-1 border-t border-slate-200/70 dark:border-slate-700/60">
              <span className="truncate text-slate-500 dark:text-slate-400 flex items-center gap-1">
                {att.kind === 'image' ? (
                  <ImageIcon className="h-3 w-3 shrink-0" />
                ) : (
                  <FileText className="h-3 w-3 shrink-0" />
                )}
                {att.fileName}
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setPreviewItem(att)}
                  className="inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                >
                  <Maximize2 className="h-3 w-3" />
                  View
                </button>
                <button
                  type="button"
                  onClick={() => void handleDownload(att)}
                  className="inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700"
                >
                  <Download className="h-3 w-3" />
                  Save
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

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
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                {previewItem.fileName}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleDownload(previewItem)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewItem(null)}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="p-4 max-h-[82vh] overflow-auto">
              <AuthMediaPreview
                url={previewItem.url}
                mimeType={previewItem.mimeType}
                fileName={previewItem.fileName}
                mediaKind={previewItem.kind === 'pdf' ? 'pdf' : 'photo'}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
};
