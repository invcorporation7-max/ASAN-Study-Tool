import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Download,
  Edit3,
  ExternalLink,
  FileSpreadsheet,
  Lock,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  apiFetch,
  ensureAppDriveFolder,
  pullMasterExamSheet,
  syncMasterExamSheet,
} from '../lib/api';
import { generateUniqueExamPaperCode } from '../lib/paperCode';
import type { ExamBlueprintItem } from '../types';
import { ConfirmDialog } from './ConfirmDialog';

const EXAM_TYPES = ['JEE Main', 'JEE ADV', 'ISC', 'CBSE', 'NEET UG', 'CUET', 'Other'];

export const ExamMasterCards: React.FC = () => {
  const {
    dbUser,
    isGuest,
    isWorkspaceEnabled,
    isEffectiveProOrAdmin,
    signIn,
    workspaceToken,
    connectWorkspace,
    updateProfile,
  } = useAuth();

  const [cards, setCards] = useState<ExamBlueprintItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Create / Edit Form State
  const [editingId, setEditingId] = useState<number | null>(null);
  const [subject, setSubject] = useState('Physics');
  const [examType, setExamType] = useState('JEE Main');
  const [examDate, setExamDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [examTime, setExamTime] = useState('09:00');
  const [totalMarks, setTotalMarks] = useState<string>('100');
  const [marksScored, setMarksScored] = useState<string>('');
  const [syllabusText, setSyllabusText] = useState('Electrostatics, Current Electricity, Capacitors');
  const [questionPaperUrl, setQuestionPaperUrl] = useState('');
  const [answerSheetUrl, setAnswerSheetUrl] = useState('');
  const [correctedAnswerSheetUrl, setCorrectedAnswerSheetUrl] = useState('');

  // 3-char destructive delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<ExamBlueprintItem | null>(null);

  const loadCards = useCallback(async () => {
    if (isGuest || !dbUser) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await apiFetch<ExamBlueprintItem[]>('/api/exam-blueprints');
      setCards(rows);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load exam master cards');
    } finally {
      setLoading(false);
    }
  }, [dbUser, isGuest]);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  const parsedSyllabus = useMemo(
    () =>
      syllabusText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    [syllabusText]
  );

  const previewPaperCode = useMemo(() => {
    const existingCodes = cards
      .filter((c) => c.id !== editingId)
      .map((c) => c.paperCode);
    return generateUniqueExamPaperCode({
      subject,
      examDate,
      totalMarks: Number(totalMarks) || 100,
      syllabusCount: parsedSyllabus.length,
      existingCodes,
    });
  }, [subject, examDate, totalMarks, parsedSyllabus.length, cards, editingId]);

  const computedPercentage = useMemo(() => {
    const t = Number(totalMarks);
    const m = Number(marksScored);
    if (marksScored.trim() === '' || !Number.isFinite(t) || t <= 0 || !Number.isFinite(m)) {
      return '—';
    }
    return `${((m / t) * 100).toFixed(1)}%`;
  }, [totalMarks, marksScored]);

  const resetForm = () => {
    setEditingId(null);
    setSubject('Physics');
    setExamType('JEE Main');
    setExamDate(new Date().toISOString().slice(0, 10));
    setExamTime('09:00');
    setTotalMarks('100');
    setMarksScored('');
    setSyllabusText('Electrostatics, Current Electricity');
    setQuestionPaperUrl('');
    setAnswerSheetUrl('');
    setCorrectedAnswerSheetUrl('');
  };

  const handleStartEdit = (card: ExamBlueprintItem) => {
    setEditingId(card.id);
    setSubject(card.subject);
    setExamType(card.examType);
    setExamDate(card.examDate);
    setExamTime(card.examTime);
    setTotalMarks(String(card.totalMarks));
    setMarksScored(card.marksScored !== null && card.marksScored !== undefined ? String(card.marksScored) : '');
    setSyllabusText(card.syllabus.join(', '));
    setQuestionPaperUrl(card.questionPaperUrl || '');
    setAnswerSheetUrl(card.answerSheetUrl || '');
    setCorrectedAnswerSheetUrl(card.correctedAnswerSheetUrl || '');
    setStatusMsg(null);
    setErrorMsg(null);
  };

  const handleSaveCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !examDate) return;
    setSaving(true);
    setErrorMsg(null);
    setStatusMsg(null);

    const tMarks = Math.max(1, Number(totalMarks) || 100);
    const scored = marksScored.trim() === '' ? null : Number(marksScored);
    const pct =
      scored !== null && Number.isFinite(scored)
        ? `${((scored / tMarks) * 100).toFixed(1)}%`
        : '';

    try {
      if (editingId) {
        const existingCard = cards.find((c) => c.id === editingId);
        const code = existingCard?.paperCode || previewPaperCode;
        await apiFetch(`/api/exam-blueprints/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            paperCode: code,
            subject: subject.trim(),
            examType,
            examDate,
            examTime,
            totalMarks: tMarks,
            marksScored: scored,
            percentage: pct,
            syllabus: parsedSyllabus,
            questionPaperUrl: questionPaperUrl.trim(),
            answerSheetUrl: answerSheetUrl.trim(),
            correctedAnswerSheetUrl: correctedAnswerSheetUrl.trim(),
          }),
        });
        setStatusMsg(`Updated Exam Master card (${code}).`);
      } else {
        const created = await apiFetch<ExamBlueprintItem>('/api/exam-blueprints', {
          method: 'POST',
          body: JSON.stringify({
            paperCode: previewPaperCode,
            subject: subject.trim(),
            examType,
            examDate,
            examTime,
            totalMarks: tMarks,
            marksScored: scored,
            percentage: pct,
            syllabus: parsedSyllabus,
            questionPaperUrl: questionPaperUrl.trim(),
            answerSheetUrl: answerSheetUrl.trim(),
            correctedAnswerSheetUrl: correctedAnswerSheetUrl.trim(),
          }),
        });
        setStatusMsg(`Created Exam Master card with Paper Code ${created.paperCode}.`);
      }
      resetForm();
      await loadCards();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save Exam Master card');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await apiFetch(`/api/exam-blueprints/${deleteTarget.id}`, { method: 'DELETE' });
      if (editingId === deleteTarget.id) resetForm();
      setStatusMsg(`Permanently deleted card ${deleteTarget.paperCode}.`);
      setDeleteTarget(null);
      await loadCards();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setSaving(false);
    }
  };

  const handleSyncToMasterSheet = async () => {
    if (!isEffectiveProOrAdmin) return;
    setSheetBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      if (!workspaceToken) {
        const tok = await connectWorkspace();
        if (!tok) {
          setSheetBusy(false);
          return;
        }
      }
      const folder = await ensureAppDriveFolder(dbUser?.driveFolderId);
      if (folder.id !== dbUser?.driveFolderId) {
        await updateProfile({ driveFolderId: folder.id });
      }
      const res = await syncMasterExamSheet(cards, folder.id);
      setSheetUrl(res.spreadsheetUrl);
      setStatusMsg(
        `Synced ${cards.length} 3×4 Exam Master card(s) to spreadsheet "master" -> sheet "test_dates".`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to sync to "master" sheet');
    } finally {
      setSheetBusy(false);
    }
  };

  const handlePullFromMasterSheet = async () => {
    if (!isEffectiveProOrAdmin) return;
    setSheetBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      if (!workspaceToken) {
        const tok = await connectWorkspace();
        if (!tok) {
          setSheetBusy(false);
          return;
        }
      }
      const pulled = await pullMasterExamSheet();
      const existingByCode = new Map(cards.map((c) => [c.paperCode.toUpperCase(), c]));
      let added = 0;
      let updated = 0;

      for (const row of pulled) {
        const code =
          row.paperCode ||
          generateUniqueExamPaperCode({
            subject: row.subject,
            examDate: row.examDate,
            totalMarks: row.totalMarks,
            syllabusCount: row.syllabus.length,
            existingCodes: existingByCode.keys(),
          });

        const match = existingByCode.get(code);
        if (match) {
          await apiFetch(`/api/exam-blueprints/${match.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ ...row, paperCode: code }),
          });
          updated += 1;
        } else {
          await apiFetch('/api/exam-blueprints', {
            method: 'POST',
            body: JSON.stringify({ ...row, paperCode: code }),
          });
          added += 1;
        }
      }
      await loadCards();
      setStatusMsg(
        `Pulled from "master" -> "test_dates": ${added} new card(s) added, ${updated} updated.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to pull from "master" sheet');
    } finally {
      setSheetBusy(false);
    }
  };

  if (isGuest) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center space-y-3">
        <Lock className="mx-auto h-6 w-6 text-blue-600 dark:text-blue-400" />
        <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
          Exam Master Cards Require Google Sign-In
        </h2>
        <p className="mx-auto max-w-lg text-xs leading-relaxed text-slate-600 dark:text-slate-400">
          Exam Master Cards (3×4 Blueprint with unique Paper Code &amp; Google Sheets <code className="font-mono">master / test_dates</code> arrangement) are viewable as cards for Basic and Pro users signed in with Google.
        </p>
        <button
          type="button"
          onClick={signIn}
          className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + Pro Google Sheets "master" -> "test_dates" Sync */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
            Exam Master Schedule Cards · &ldquo;master&rdquo; / &ldquo;test_dates&rdquo; Blueprint
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            3 rows × 4 columns per exam card with auto-generated unique Paper Code · Viewable as cards for Basic &amp; Pro users.
          </p>
        </div>

        {isWorkspaceEnabled && (isEffectiveProOrAdmin ? (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleSyncToMasterSheet}
              disabled={sheetBusy || cards.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {sheetBusy ? 'Syncing...' : 'Sync "master" -> test_dates'}
            </button>
            <button
              type="button"
              onClick={handlePullFromMasterSheet}
              disabled={sheetBusy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              Pull from &ldquo;master&rdquo;
            </button>
            {sheetUrl && (
              <a
                href={sheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
              >
                Open &ldquo;master&rdquo;
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        ) : (
          <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400 shrink-0">
            <FileSpreadsheet className="h-3.5 w-3.5 text-slate-400" />
            Google Sheet &ldquo;master&rdquo; sync requires Pro
          </div>
        ))}
      </div>

      {statusMsg && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-2.5 text-xs text-emerald-800 dark:text-emerald-300">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-lg border border-red-200 dark:border-red-800/70 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-xs text-red-700 dark:text-red-300">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Form to Add / Update Exam Blueprint Card */}
        <form
          onSubmit={handleSaveCard}
          className="lg:col-span-4 h-fit rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3.5"
        >
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              {editingId ? 'Edit Exam Master Card' : 'Add Exam Master Card'}
            </h3>
            <span className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 font-mono text-[11px] font-bold text-blue-700 dark:text-blue-400">
              {editingId
                ? cards.find((c) => c.id === editingId)?.paperCode
                : previewPaperCode}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">Subject</label>
              <input
                type="text"
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">Type (Row 3)</label>
              <select
                value={examType}
                onChange={(e) => setExamType(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
              >
                {EXAM_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">Date</label>
              <input
                type="date"
                required
                value={examDate}
                onChange={(e) => setExamDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-xs tabular-nums focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">Time</label>
              <input
                type="time"
                value={examTime}
                onChange={(e) => setExamTime(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-xs tabular-nums focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                Scored (Opt)
              </label>
              <input
                type="number"
                step="any"
                value={marksScored}
                onChange={(e) => setMarksScored(e.target.value)}
                placeholder="—"
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-xs tabular-nums focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">Total Marks</label>
              <input
                type="number"
                required
                min={1}
                value={totalMarks}
                onChange={(e) => setTotalMarks(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-xs tabular-nums focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">Percentage</label>
              <div className="mt-1 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 font-mono text-xs font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                {computedPercentage}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
              Syllabus Chapters (comma-separated · count = {parsedSyllabus.length}, hex{' '}
              {Math.min(255, parsedSyllabus.length).toString(16).toUpperCase().padStart(2, '0')})
            </label>
            <textarea
              rows={2}
              value={syllabusText}
              onChange={(e) => setSyllabusText(e.target.value)}
              placeholder="Kinematics, Laws of Motion, Work & Energy"
              className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-2">
            <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
              Col 4 Links (Optional)
            </div>
            <input
              type="text"
              value={questionPaperUrl}
              onChange={(e) => setQuestionPaperUrl(e.target.value)}
              placeholder="Question Paper URL or Ref"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
            />
            <input
              type="text"
              value={answerSheetUrl}
              onChange={(e) => setAnswerSheetUrl(e.target.value)}
              placeholder="Answer Sheet URL or Ref"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
            />
            <input
              type="text"
              value={correctedAnswerSheetUrl}
              onChange={(e) => setCorrectedAnswerSheetUrl(e.target.value)}
              placeholder="Corrected Answer Sheet URL (Optional)"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              <Plus className="h-3.5 w-3.5" />
              {saving ? 'Saving...' : editingId ? 'Update Exam Card' : 'Add Exam Card'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        {/* 3x4 Exam Blueprint Cards List */}
        <div className="lg:col-span-8 space-y-4">
          {loading ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-xs text-slate-500 dark:text-slate-400">
              Loading Exam Master cards...
            </div>
          ) : cards.length === 0 ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-xs text-slate-500 dark:text-slate-400">
              No Exam Master cards yet. Create one on the left or pull from your &ldquo;master&rdquo; Google Sheet (&ldquo;test_dates&rdquo; tab).
            </div>
          ) : (
            cards.map((card) => {
              const pct =
                card.marksScored !== null &&
                card.marksScored !== undefined &&
                card.totalMarks > 0
                  ? `${((card.marksScored / card.totalMarks) * 100).toFixed(1)}%`
                  : card.percentage || 'Pending';

              const renderCellValue = (val: string, label: string) => {
                if (!val) return <span className="text-slate-400 dark:text-slate-500">—</span>;
                if (val.startsWith('http://') || val.startsWith('https://')) {
                  return (
                    <a
                      href={val}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {label}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  );
                }
                return <span className="text-slate-800 dark:text-slate-200 break-all">{val}</span>;
              };

              return (
                <div
                  key={card.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-slate-900 dark:bg-blue-600 px-2 py-0.5 font-mono text-xs font-bold tracking-wider text-white">
                        {card.paperCode}
                      </span>
                      <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{card.subject}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">· {card.examType}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(card)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                      >
                        <Edit3 className="h-3 w-3" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(card)}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-400"
                        aria-label={`Delete ${card.paperCode}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Exact 3-row x 4-col Matrix Blueprint */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse tabular-nums">
                      <thead>
                        <tr className="bg-slate-50/70 dark:bg-slate-800/40 text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-800">
                          <th className="px-3 py-1.5 font-semibold w-1/5">Col 1 · Marks</th>
                          <th className="px-3 py-1.5 font-semibold w-2/5">Col 2 · Schedule &amp; Syllabus</th>
                          <th className="px-3 py-1.5 font-semibold w-1/5">Col 3 · Identity &amp; Type</th>
                          <th className="px-3 py-1.5 font-semibold w-1/5">Col 4 · Papers (Opt)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {/* Row 1 */}
                        <tr>
                          <td className="px-3 py-2.5">
                            <div className="text-[10px] text-slate-400 dark:text-slate-500">Marks Scored</div>
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {card.marksScored !== null && card.marksScored !== undefined
                                ? card.marksScored
                                : '—'}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="text-[10px] text-slate-400 dark:text-slate-500">
                              Syllabus ({card.syllabus.length} chapters)
                            </div>
                            <div className="text-slate-800 dark:text-slate-200">
                              {card.syllabus.length > 0 ? card.syllabus.join(', ') : '—'}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="text-[10px] text-slate-400 dark:text-slate-500">Subject</div>
                            <div className="font-semibold text-slate-900 dark:text-slate-100">{card.subject}</div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="text-[10px] text-slate-400 dark:text-slate-500">Question Paper</div>
                            <div>{renderCellValue(card.questionPaperUrl, 'Open QP')}</div>
                          </td>
                        </tr>
                        {/* Row 2 */}
                        <tr>
                          <td className="px-3 py-2.5">
                            <div className="text-[10px] text-slate-400 dark:text-slate-500">Total Marks</div>
                            <div className="font-semibold text-slate-900 dark:text-slate-100">{card.totalMarks}</div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="text-[10px] text-slate-400 dark:text-slate-500">Exam Date</div>
                            <div className="font-medium text-slate-900 dark:text-slate-100">{card.examDate}</div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="text-[10px] text-slate-400 dark:text-slate-500">Paper Code</div>
                            <div className="font-mono font-bold text-blue-700 dark:text-blue-400">
                              {card.paperCode}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="text-[10px] text-slate-400 dark:text-slate-500">Answer Sheet</div>
                            <div>{renderCellValue(card.answerSheetUrl, 'Open Sheet')}</div>
                          </td>
                        </tr>
                        {/* Row 3 */}
                        <tr>
                          <td className="px-3 py-2.5">
                            <div className="text-[10px] text-slate-400 dark:text-slate-500">Percentage</div>
                            <div className="font-semibold text-emerald-700 dark:text-emerald-400">{pct}</div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="text-[10px] text-slate-400 dark:text-slate-500">Time</div>
                            <div className="font-medium text-slate-900 dark:text-slate-100">{card.examTime || '09:00'}</div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="text-[10px] text-slate-400 dark:text-slate-500">Type (Row 3)</div>
                            <div className="font-medium text-slate-900 dark:text-slate-100">{card.examType}</div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="text-[10px] text-slate-400 dark:text-slate-500">Corrected Sheet</div>
                            <div>
                              {renderCellValue(card.correctedAnswerSheetUrl, 'Open Corrected')}
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Exam Master Card?"
        description={`Delete card ${deleteTarget?.paperCode} (${deleteTarget?.subject} on ${deleteTarget?.examDate})?`}
        confirmLabel="Delete Forever"
        destructive
        busy={saving}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
