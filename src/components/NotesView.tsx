import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  CheckSquare,
  CloudUpload,
  Download,
  FileText,
  Image as ImageIcon,
  Mail,
  Plus,
  Save,
  Share2,
  Trash2,
  Type,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  apiFetch,
  ensureAppDriveFolder,
  exportNoteToGoogleDoc,
  saveTextToDriveFolder,
  uploadFileToDriveFolder,
} from '../lib/api';
import {
  DOCS_SCOPE,
  DRIVE_FILE_SCOPE,
} from '../lib/firebase';
import {
  FREE_TIER_MAX_NOTES,
  guestCreateNotebook,
  guestCreateNotePage,
  guestDeleteNotebook,
  guestDeleteNotePage,
  guestUpdateNotePage,
} from '../lib/guestStore';
import { buildOneNoteA4Pdf, shareOrDownloadPdf } from '../lib/pdfGenerator';
import type {
  A4PageItem,
  NoteBlockItem,
  StudyNotebook,
  StudyNotePage,
} from '../types';
import { ConfirmDialog } from './ConfirmDialog';

interface NotesViewProps {
  notebooks: StudyNotebook[];
  notePages: StudyNotePage[];
  onRefresh: () => Promise<void>;
  onShareViaMessage?: (docId: number) => void;
}

function makeId(prefix = 'id'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export const NotesView: React.FC<NotesViewProps> = ({
  notebooks,
  notePages,
  onRefresh,
  onShareViaMessage,
}) => {
  const {
    dbUser,
    isGuest,
    isWorkspaceEnabled,
    workspacePermissions,
    isEffectiveProOrAdmin,
    connectBasicDrive,
    connectWorkspace,
    error: authError,
    clearError,
    refreshProfile,
    updateProfile,
  } = useAuth();
  const isProOrAdmin = isEffectiveProOrAdmin;

  const [selectedNotebookId, setSelectedNotebookId] = useState<number | null>(
    notebooks[0]?.id ?? null
  );
  const [selectedDocId, setSelectedDocId] = useState<number | null>(
    notePages[0]?.id ?? null
  );

  // Create notebook modal/inline state
  const [newNotebookTitle, setNewNotebookTitle] = useState('');
  const [newNotebookSubject, setNewNotebookSubject] = useState('');
  const [showNewNotebook, setShowNewNotebook] = useState(false);

  // Active document editing buffer
  const [docTitle, setDocTitle] = useState('');
  const [sectionName, setSectionName] = useState('Main Notes');
  const [pages, setPages] = useState<A4PageItem[]>([]);
  const [activePageIndex, setActivePageIndex] = useState(0);

  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [externalLink, setExternalLink] = useState<{ label: string; url: string } | null>(null);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<{
    type: 'notebook' | 'doc';
    id: number;
    label: string;
  } | null>(null);

  useEffect(() => {
    if (notebooks.length > 0 && !notebooks.some((n) => n.id === selectedNotebookId)) {
      setSelectedNotebookId(notebooks[0].id);
    }
  }, [notebooks, selectedNotebookId]);

  const docsInNotebook = useMemo(
    () => notePages.filter((p) => p.notebookId === selectedNotebookId),
    [notePages, selectedNotebookId]
  );

  useEffect(() => {
    if (docsInNotebook.length > 0 && !docsInNotebook.some((d) => d.id === selectedDocId)) {
      setSelectedDocId(docsInNotebook[0].id);
    } else if (docsInNotebook.length === 0) {
      setSelectedDocId(null);
    }
  }, [docsInNotebook, selectedDocId]);

  const activeDoc = useMemo(
    () => notePages.find((d) => d.id === selectedDocId) || null,
    [notePages, selectedDocId]
  );

  useEffect(() => {
    if (activeDoc) {
      setDocTitle(activeDoc.title);
      setSectionName(activeDoc.sectionName || 'Main Notes');
      setPages(
        Array.isArray(activeDoc.pagesData) && activeDoc.pagesData.length > 0
          ? activeDoc.pagesData
          : [
              {
                id: makeId('a4'),
                pageNumber: 1,
                title: 'Page 1',
                blocks: [{ id: makeId('blk'), type: 'text', content: '', fontSize: 10 }],
              },
            ]
      );
      setActivePageIndex(0);
    } else {
      setDocTitle('');
      setPages([]);
    }
  }, [activeDoc]);

  const handleCreateNotebook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNotebookTitle.trim()) return;
    setStatusMsg(null);
    try {
      const created = isGuest
        ? guestCreateNotebook({
            title: newNotebookTitle.trim(),
            subject: newNotebookSubject.trim() || 'General',
          })
        : await apiFetch<StudyNotebook>('/api/notebooks', {
            method: 'POST',
            body: JSON.stringify({
              title: newNotebookTitle.trim(),
              subject: newNotebookSubject.trim() || 'General',
            }),
          });
      setNewNotebookTitle('');
      setNewNotebookSubject('');
      setShowNewNotebook(false);
      await onRefresh();
      setSelectedNotebookId(created.id);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to create notebook');
    }
  };

  const handleCreateDoc = async () => {
    if (!selectedNotebookId) return;
    setStatusMsg(null);
    const initialPages: A4PageItem[] = [
      {
        id: makeId('a4'),
        pageNumber: 1,
        title: 'Page 1',
        blocks: [
          {
            id: makeId('blk'),
            type: 'heading',
            content: 'Untitled Study Section',
            fontSize: 14,
          },
          {
            id: makeId('blk'),
            type: 'text',
            content: '',
            fontSize: 10,
          },
        ],
      },
    ];
    try {
      const created = isGuest
        ? guestCreateNotePage({
            notebookId: selectedNotebookId,
            sectionName: 'Lecture Notes',
            title: 'Untitled A4 Document',
            pagesData: initialPages,
          })
        : await apiFetch<StudyNotePage>('/api/note-pages', {
            method: 'POST',
            body: JSON.stringify({
              notebookId: selectedNotebookId,
              sectionName: 'Lecture Notes',
              title: 'Untitled A4 Document',
              pagesData: initialPages,
            }),
          });
      await onRefresh();
      setSelectedDocId(created.id);
      if (!isGuest && created.pointsAwarded && created.pointsAwarded > 0) {
        setStatusMsg(
          `Created A4 document · +${created.pointsAwarded} points awarded!`
        );
        await refreshProfile();
      }
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to create note document');
    }
  };

  const handleSaveDoc = async () => {
    if (!activeDoc) return;
    setSaving(true);
    setStatusMsg(null);
    try {
      const payload = {
        title: docTitle.trim() || 'Untitled Document',
        sectionName: sectionName.trim() || 'Main Notes',
        pagesData: pages,
      };
      if (isGuest) {
        guestUpdateNotePage(activeDoc.id, payload);
      } else {
        await apiFetch(`/api/note-pages/${activeDoc.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      }
      await onRefresh();
      setStatusMsg(
        isGuest
          ? 'Saved A4 document locally (Free Tier).'
          : 'Saved A4 document to cloud workspace.'
      );
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to save document');
    } finally {
      setSaving(false);
    }
  };

  const handleAddA4Page = () => {
    setPages((prev) => [
      ...prev,
      {
        id: makeId('a4'),
        pageNumber: prev.length + 1,
        title: `Page ${prev.length + 1}`,
        blocks: [{ id: makeId('blk'), type: 'text', content: '', fontSize: 10 }],
      },
    ]);
    setActivePageIndex(pages.length);
  };

  const handleRemoveA4Page = (pageIdx: number) => {
    if (pages.length <= 1) return;
    setPages((prev) =>
      prev
        .filter((_, idx) => idx !== pageIdx)
        .map((p, idx) => ({ ...p, pageNumber: idx + 1 }))
    );
    setActivePageIndex(Math.max(0, pageIdx - 1));
  };

  const updateBlock = (pageIdx: number, blockId: string, patch: Partial<NoteBlockItem>) => {
    setPages((prev) =>
      prev.map((page, idx) => {
        if (idx !== pageIdx) return page;
        return {
          ...page,
          blocks: page.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)),
        };
      })
    );
  };

  const addBlockToPage = (
    pageIdx: number,
    type: NoteBlockItem['type'],
    content = ''
  ) => {
    setPages((prev) =>
      prev.map((page, idx) => {
        if (idx !== pageIdx) return page;
        return {
          ...page,
          blocks: [
            ...page.blocks,
            {
              id: makeId('blk'),
              type,
              content,
              fontSize: type === 'heading' ? 14 : 10,
              checked: false,
            },
          ],
        };
      })
    );
  };

  const removeBlockFromPage = (pageIdx: number, blockId: string) => {
    setPages((prev) =>
      prev.map((page, idx) => {
        if (idx !== pageIdx) return page;
        const remaining = page.blocks.filter((b) => b.id !== blockId);
        return {
          ...page,
          blocks: remaining.length
            ? remaining
            : [{ id: makeId('blk'), type: 'text', content: '', fontSize: 10 }],
        };
      })
    );
  };

  const handleImagePasteOrUpload = (
    pageIdx: number,
    file: File
  ) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        addBlockToPage(pageIdx, 'image', reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handlePasteOnCanvas = (e: React.ClipboardEvent, pageIdx: number) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          handleImagePasteOrUpload(pageIdx, file);
          return;
        }
      }
    }
  };

  const handleAutoDistributePages = () => {
    // Splits oversized text blocks (> 2400 chars per A4 page) cleanly across multiple A4 pages
    const MAX_CHARS_PER_PAGE = 2400;
    const redistributed: A4PageItem[] = [];
    pages.forEach((p) => {
      let currentBlocks: NoteBlockItem[] = [];
      let charCount = 0;

      p.blocks.forEach((blk) => {
        if (blk.type === 'text' && blk.content.length > MAX_CHARS_PER_PAGE) {
          const chunks: string[] = [];
          for (let i = 0; i < blk.content.length; i += MAX_CHARS_PER_PAGE) {
            chunks.push(blk.content.slice(i, i + MAX_CHARS_PER_PAGE));
          }
          chunks.forEach((chunk) => {
            if (currentBlocks.length > 0 && charCount + chunk.length > MAX_CHARS_PER_PAGE) {
              redistributed.push({
                id: makeId('a4'),
                pageNumber: redistributed.length + 1,
                title: `Page ${redistributed.length + 1}`,
                blocks: currentBlocks,
              });
              currentBlocks = [];
              charCount = 0;
            }
            currentBlocks.push({ ...blk, id: makeId('blk'), content: chunk });
            charCount += chunk.length;
          });
        } else {
          const len = blk.type === 'image' ? 800 : blk.content.length;
          if (currentBlocks.length > 0 && charCount + len > MAX_CHARS_PER_PAGE) {
            redistributed.push({
              id: makeId('a4'),
              pageNumber: redistributed.length + 1,
              title: `Page ${redistributed.length + 1}`,
              blocks: currentBlocks,
            });
            currentBlocks = [];
            charCount = 0;
          }
          currentBlocks.push(blk);
          charCount += len;
        }
      });

      if (currentBlocks.length > 0) {
        redistributed.push({
          id: makeId('a4'),
          pageNumber: redistributed.length + 1,
          title: p.title || `Page ${redistributed.length + 1}`,
          blocks: currentBlocks,
        });
      }
    });

    if (redistributed.length > 0) {
      setPages(redistributed);
      setStatusMsg(`Distributed document cleanly across ${redistributed.length} A4 page(s).`);
    }
  };

  const handleDownloadPdf = async () => {
    if (!activeDoc) return;
    setExporting(true);
    setStatusMsg(null);
    try {
      const pdfFile = await buildOneNoteA4Pdf(docTitle || 'Study_Note', sectionName, pages);
      const url = URL.createObjectURL(pdfFile);
      const a = document.createElement('a');
      a.href = url;
      a.download = pdfFile.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatusMsg(`Downloaded ${pdfFile.name}.`);
    } finally {
      setExporting(false);
    }
  };

  const handleSharePdf = async () => {
    if (!activeDoc) return;
    setExporting(true);
    setStatusMsg(null);
    try {
      const pdfFile = await buildOneNoteA4Pdf(docTitle || 'Study_Note', sectionName, pages);
      const mode = await shareOrDownloadPdf(pdfFile, docTitle || 'ASAN Study Document');
      setStatusMsg(
        mode === 'shared'
          ? 'Opened native share sheet with your compiled A4 PDF.'
          : 'Browser share sheet unavailable here — downloaded PDF so you can attach it to any app.'
      );
    } finally {
      setExporting(false);
    }
  };

  const handleSaveToDrive = async () => {
    if (!activeDoc || !isProOrAdmin) return;
    setExporting(true);
    setStatusMsg(null);
    setExternalLink(null);
    clearError();
    try {
      const tok = await connectBasicDrive();
      if (!tok) {
        setExporting(false);
        return;
      }
      const folder = await ensureAppDriveFolder(dbUser?.driveFolderId);
      if (folder.id !== dbUser?.driveFolderId) {
        await updateProfile({ driveFolderId: folder.id });
      }
      const pdfFile = await buildOneNoteA4Pdf(docTitle || 'Study_Note', sectionName, pages);
      const uploaded = await uploadFileToDriveFolder(pdfFile, folder.id);
      setStatusMsg(`Saved "${uploaded.name}" inside Drive folder "ASAN-user-content".`);
      if (uploaded.webViewLink) {
        setExternalLink({ label: 'Open in Google Drive', url: uploaded.webViewLink });
      }
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Google Drive upload failed');
    } finally {
      setExporting(false);
    }
  };

  const handleExportGoogleDoc = async () => {
    if (!activeDoc || !isProOrAdmin) return;
    setExporting(true);
    setStatusMsg(null);
    setExternalLink(null);
    clearError();
    try {
      const tok = await connectWorkspace([DRIVE_FILE_SCOPE, DOCS_SCOPE]);
      if (!tok) {
        setExporting(false);
        return;
      }
      const folder = await ensureAppDriveFolder(dbUser?.driveFolderId);
      if (folder.id !== dbUser?.driveFolderId) {
        await updateProfile({ driveFolderId: folder.id });
      }
      const plainText = pages
        .map((p, idx) => {
          const body = p.blocks
            .map((b) => {
              if (b.type === 'image') return '[Embedded Study Diagram]';
              if (b.type === 'checklist') return `${b.checked ? '[x]' : '[ ]'} ${b.content}`;
              return b.content;
            })
            .join('\n');
          return `--- Page ${idx + 1} ---\n${body}`;
        })
        .join('\n\n');
      const created = await exportNoteToGoogleDoc(
        `${docTitle || 'Study Notes'} (${sectionName})`,
        plainText,
        folder.id
      );
      setStatusMsg('Exported note document to Google Docs inside ASAN-user-content.');
      setExternalLink({ label: 'Open Google Doc', url: created.url });
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Google Docs export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleSaveNotesTxtToDrive = async () => {
    if (isGuest) return;
    setExporting(true);
    setStatusMsg(null);
    setExternalLink(null);
    clearError();
    try {
      const tok = await connectBasicDrive();
      if (!tok) {
        setExporting(false);
        return;
      }
      const folder = await ensureAppDriveFolder(dbUser?.driveFolderId);
      if (folder.id !== dbUser?.driveFolderId) {
        await updateProfile({ driveFolderId: folder.id });
      }

      const txtBody = notePages
        .map((doc) => {
          const docPages = (doc.pagesData || [])
            .map((pg, idx) => {
              const lines = (pg.blocks || [])
                .map((b) => {
                  if (b.type === 'image') return '[Embedded Image]';
                  if (b.type === 'checklist') return `${b.checked ? '[x]' : '[ ]'} ${b.content}`;
                  return b.content;
                })
                .join('\n');
              return `-- Page ${idx + 1} --\n${lines}`;
            })
            .join('\n\n');
          return `=== ${doc.title} (${doc.sectionName}) ===\n${docPages}`;
        })
        .join('\n\n\n');

      const uploaded = await saveTextToDriveFolder(
        'asan_notes.txt',
        txtBody || 'No notes yet.',
        folder.id
      );
      setStatusMsg(
        `Saved unlimited notes (.txt) as "${uploaded.name}" inside your Google Drive folder "ASAN-user-content".`
      );
      if (uploaded.webViewLink) {
        setExternalLink({ label: 'Open in Google Drive', url: uploaded.webViewLink });
      }
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Google Drive .txt save failed');
    } finally {
      setExporting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === 'notebook') {
      if (isGuest) {
        guestDeleteNotebook(deleteTarget.id);
      } else {
        await apiFetch(`/api/notebooks/${deleteTarget.id}`, { method: 'DELETE' });
      }
    } else {
      if (isGuest) {
        guestDeleteNotePage(deleteTarget.id);
      } else {
        await apiFetch(`/api/note-pages/${deleteTarget.id}`, { method: 'DELETE' });
      }
    }
    setDeleteTarget(null);
    await onRefresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            My Notes · OneNote A4 Studio
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            Organize notebooks and sections distributed into A4 pages, ready to export or share as PDF ·{' '}
            {isGuest
              ? `${notePages.length} / ${FREE_TIER_MAX_NOTES} PDF Notes (Free Tier)`
              : `${notePages.length} A4 Notes (Unlimited)`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isGuest && isWorkspaceEnabled && workspacePermissions.driveSync && (
            <button
              type="button"
              onClick={handleSaveNotesTxtToDrive}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
            >
              <CloudUpload className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              Save Notes (.txt) to Drive
            </button>
          )}
          {activeDoc && (
            <>
              <button
                type="button"
                onClick={handleSaveDoc}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-700 whitespace-nowrap shrink-0 disabled:opacity-60"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                type="button"
                onClick={handleSharePdf}
                disabled={exporting}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
              >
                <Share2 className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                Share PDF
              </button>
              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={exporting}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                Download PDF
              </button>
              {isProOrAdmin && isWorkspaceEnabled && workspacePermissions.driveSync && (
                <button
                  type="button"
                  onClick={handleSaveToDrive}
                  disabled={exporting}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
                >
                  <CloudUpload className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  Save PDF to Drive
                </button>
              )}
              {isProOrAdmin && isWorkspaceEnabled && workspacePermissions.docsExport && (
                <button
                  type="button"
                  onClick={handleExportGoogleDoc}
                  disabled={exporting}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
                >
                  <FileText className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  To Docs
                </button>
              )}
              {!isGuest && onShareViaMessage && (
                <button
                  type="button"
                  onClick={() => onShareViaMessage(activeDoc.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
                >
                  <Mail className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  Share via Tool Mail
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {(statusMsg || authError) && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-2.5 text-xs ${
            !statusMsg && authError
              ? 'border-red-200 dark:border-red-800/70 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300'
              : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200'
          }`}
        >
          <span>{statusMsg || authError}</span>
          {externalLink && (
            <a
              href={externalLink.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-blue-600 dark:text-blue-400 hover:underline"
            >
              {externalLink.label}
            </a>
          )}
        </div>
      )}

      {/* OneNote Three-Pane Layout: Notebooks/Sections | A4 Page Canvas */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-start">
        {/* Left Navigation Tree (Notebooks + Pages) */}
        <aside className="asan-card-hover lg:col-span-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-5 h-fit">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">Notebooks</span>
              <button
                type="button"
                onClick={() => setShowNewNotebook((v) => !v)}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700"
              >
                <Plus className="h-3.5 w-3.5" />
                New
              </button>
            </div>

            {showNewNotebook && (
              <form onSubmit={handleCreateNotebook} className="mt-3 space-y-2 border-t border-slate-100 dark:border-slate-800 pt-3">
                <input
                  type="text"
                  required
                  value={newNotebookTitle}
                  onChange={(e) => setNewNotebookTitle(e.target.value)}
                  placeholder="Notebook title"
                  className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
                />
                <input
                  type="text"
                  value={newNotebookSubject}
                  onChange={(e) => setNewNotebookSubject(e.target.value)}
                  placeholder="Subject (e.g., Chemistry)"
                  className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="submit"
                  className="w-full rounded-md bg-blue-600 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  Create Notebook
                </button>
              </form>
            )}

            <div className="mt-3 space-y-1">
              {notebooks.map((nb) => {
                const active = nb.id === selectedNotebookId;
                return (
                  <div
                    key={nb.id}
                    className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-xs transition-colors ${
                      active
                        ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-900 dark:text-blue-200 font-semibold'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedNotebookId(nb.id)}
                      className="flex flex-1 items-center gap-2 text-left min-w-0"
                    >
                      <BookOpen className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                      <span className="truncate">{nb.title}</span>
                    </button>
                    {notebooks.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setDeleteTarget({
                            type: 'notebook',
                            id: nb.id,
                            label: nb.title,
                          })
                        }
                        className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                        aria-label={`Delete ${nb.title}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Sections & Documents
              </span>
              <button
                type="button"
                onClick={handleCreateDoc}
                disabled={!selectedNotebookId}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                Doc
              </button>
            </div>

            <div className="mt-3 space-y-1">
              {docsInNotebook.length === 0 ? (
                <p className="text-xs text-slate-400 py-3">
                  No documents in this notebook yet.
                </p>
              ) : (
                docsInNotebook.map((docItem) => {
                  const active = docItem.id === selectedDocId;
                  return (
                    <div
                      key={docItem.id}
                      className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-xs transition-colors ${
                        active
                          ? 'bg-slate-900 dark:bg-blue-600 text-white'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedDocId(docItem.id)}
                        className="flex-1 text-left min-w-0"
                      >
                        <div className="truncate font-medium">{docItem.title}</div>
                        <div
                          className={`truncate text-[11px] tabular-nums ${
                            active ? 'text-slate-200' : 'text-slate-400'
                          }`}
                        >
                          {docItem.sectionName} · {docItem.pagesData?.length || 1} A4 pg
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDeleteTarget({
                            type: 'doc',
                            id: docItem.id,
                            label: docItem.title,
                          })
                        }
                        className={`p-1 ${
                          active
                            ? 'text-slate-200 hover:text-white'
                            : 'text-slate-400 hover:text-red-600 dark:hover:text-red-400'
                        }`}
                        aria-label={`Delete ${docItem.title}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </aside>

        {/* Main A4 Page Distribution Workspace */}
        <div className="lg:col-span-9 space-y-4">
          {!activeDoc ? (
            <div className="asan-card-hover rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Select or create a document in your notebook to start writing on A4 sheets.
              </p>
              <button
                type="button"
                onClick={handleCreateDoc}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" />
                Create A4 Document
              </button>
            </div>
          ) : (
            <>
              {/* Document Metadata & A4 Page Controls */}
              <div className="asan-card-hover rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    type="text"
                    value={docTitle}
                    onChange={(e) => setDocTitle(e.target.value)}
                    placeholder="Document Title"
                    className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
                  />
                  <input
                    type="text"
                    value={sectionName}
                    onChange={(e) => setSectionName(e.target.value)}
                    placeholder="Section Name"
                    className="sm:w-44 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleAutoDistributePages}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
                  >
                    Auto-Distribute A4
                  </button>
                  <button
                    type="button"
                    onClick={handleAddA4Page}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-900 dark:bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 dark:hover:bg-blue-700 whitespace-nowrap shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add A4 Page
                  </button>
                </div>
              </div>

              {/* A4 Sheet Stream (210mm x 297mm proportion) */}
              <div className="asan-card-hover rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950/60 p-3 sm:p-6 space-y-6 sm:space-y-8 lg:overflow-y-auto lg:max-h-[calc(100vh-12rem)]">
                {pages.map((page, pageIdx) => (
                  <div
                    key={page.id}
                    onClick={() => setActivePageIndex(pageIdx)}
                    onPaste={(e) => handlePasteOnCanvas(e, pageIdx)}
                    className={`mx-auto w-full max-w-[740px] min-h-[520px] sm:min-h-[820px] lg:min-h-[1046px] rounded-sm bg-white p-4 sm:p-8 lg:p-10 shadow-sm border transition-colors flex flex-col justify-between ${
                      activePageIndex === pageIdx
                        ? 'border-blue-400'
                        : 'border-slate-200'
                    }`}
                  >
                    <div>
                      {/* A4 Sheet Header */}
                      <div className="flex items-center justify-between border-b border-slate-200 pb-3 text-xs text-slate-400">
                        <span>
                          {docTitle || 'Untitled Document'} · {sectionName}
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="tabular-nums">
                            A4 Page {pageIdx + 1} of {pages.length}
                          </span>
                          {pages.length > 1 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveA4Page(pageIdx);
                              }}
                              className="text-slate-400 hover:text-red-600"
                              aria-label="Remove page"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Blocks inside this A4 Sheet */}
                      <div className="mt-5 space-y-3">
                        {page.blocks.map((block) => (
                          <div key={block.id} className="group relative flex items-start gap-2">
                            <div className="flex-1">
                              {block.type === 'heading' ? (
                                <input
                                  type="text"
                                  value={block.content}
                                  onChange={(e) =>
                                    updateBlock(pageIdx, block.id, {
                                      content: e.target.value,
                                    })
                                  }
                                  placeholder="Section Heading..."
                                  className="w-full border-0 bg-transparent font-display text-base font-bold text-slate-900 focus:outline-none"
                                />
                              ) : block.type === 'checklist' ? (
                                <div className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(block.checked)}
                                    onChange={(e) =>
                                      updateBlock(pageIdx, block.id, {
                                        checked: e.target.checked,
                                      })
                                    }
                                    className="h-4 w-4 rounded border-slate-300 text-blue-600"
                                  />
                                  <input
                                    type="text"
                                    value={block.content}
                                    onChange={(e) =>
                                      updateBlock(pageIdx, block.id, {
                                        content: e.target.value,
                                      })
                                    }
                                    placeholder="Action item..."
                                    className={`w-full border-0 bg-transparent text-[13px] focus:outline-none ${
                                      block.checked
                                        ? 'text-slate-400 line-through'
                                        : 'text-slate-800'
                                    }`}
                                  />
                                </div>
                              ) : block.type === 'formula' ? (
                                <textarea
                                  rows={2}
                                  value={block.content}
                                  onChange={(e) =>
                                    updateBlock(pageIdx, block.id, {
                                      content: e.target.value,
                                    })
                                  }
                                  placeholder="Formula / Derivation / Code snippet..."
                                  className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800 focus:border-blue-400 focus:outline-none"
                                />
                              ) : block.type === 'image' ? (
                                <div className="rounded-lg border border-slate-200 p-2 bg-slate-50">
                                  <img
                                    src={block.content}
                                    alt="Inserted study diagram"
                                    referrerPolicy="no-referrer"
                                    className="max-h-96 mx-auto object-contain rounded"
                                  />
                                </div>
                              ) : (
                                <textarea
                                  rows={Math.max(
                                    3,
                                    Math.min(18, Math.ceil((block.content?.length || 1) / 85))
                                  )}
                                  value={block.content}
                                  onChange={(e) =>
                                    updateBlock(pageIdx, block.id, {
                                      content: e.target.value,
                                    })
                                  }
                                  placeholder="Type notes or press Ctrl+V to paste clipboard screenshots..."
                                  className="w-full resize-y border-0 bg-transparent text-[13px] leading-relaxed text-slate-800 focus:outline-none"
                                />
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={() => removeBlockFromPage(pageIdx, block.id)}
                              className="opacity-0 group-hover:opacity-100 rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-600 transition-opacity"
                              aria-label="Delete block"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>

                      {/* Quick Block Inserters for this A4 Sheet */}
                      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-dashed border-slate-200 pt-4">
                        <button
                          type="button"
                          onClick={() => addBlockToPage(pageIdx, 'heading')}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                        >
                          <Type className="h-3 w-3" />
                          Heading
                        </button>
                        <button
                          type="button"
                          onClick={() => addBlockToPage(pageIdx, 'text')}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                        >
                          <FileText className="h-3 w-3" />
                          Paragraph
                        </button>
                        <button
                          type="button"
                          onClick={() => addBlockToPage(pageIdx, 'checklist')}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                        >
                          <CheckSquare className="h-3 w-3" />
                          Checklist
                        </button>
                        <button
                          type="button"
                          onClick={() => addBlockToPage(pageIdx, 'formula')}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                        >
                          Formula Box
                        </button>
                        <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">
                          <ImageIcon className="h-3 w-3" />
                          Image
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleImagePasteOrUpload(pageIdx, file);
                              e.target.value = '';
                            }}
                          />
                        </label>
                      </div>
                    </div>

                    <div className="mt-8 border-t border-slate-100 pt-3 text-[11px] text-slate-400 flex items-center justify-between">
                      <span>ASAN-Study_tool · A4 Sheet Format (210 × 297 mm)</span>
                      <span className="tabular-nums">Page {pageIdx + 1}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Delete confirmation */}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete ${deleteTarget?.type === 'notebook' ? 'Notebook' : 'Document'}?`}
        description={`Are you sure you want to permanently delete "${deleteTarget?.label}"? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
