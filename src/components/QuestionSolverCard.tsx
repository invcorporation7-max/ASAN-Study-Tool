import React, { useEffect, useState } from 'react';
import { CheckCircle2, Eye, HelpCircle, Loader2, Send, Users, XCircle } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type {
  ForumAnswerKey,
  ForumAttemptItem,
  ForumAttemptPayload,
  ForumPostItem,
} from '../types';
import { SafeHtmlContent } from './SafeHtmlContent';

interface QuestionSolverCardProps {
  post: ForumPostItem;
  currentUserId: number | null;
  onAttemptSubmitted: (updatedPost: ForumPostItem) => void;
}

export const QuestionSolverCard: React.FC<QuestionSolverCardProps> = ({
  post,
  currentUserId,
  onAttemptSubmitted,
}) => {
  const spec = post.questionSpec;
  if (!spec) return null;

  const effectiveType =
    spec.fieldType === 'comprehension'
      ? spec.subQuestionType || 'mcq_single'
      : spec.fieldType;

  const [payload, setPayload] = useState<ForumAttemptPayload>(
    post.myAttempt?.attemptPayload || {}
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [revealedKey, setRevealedKey] = useState<ForumAnswerKey | null>(post.answerKey || null);
  const [revealedExplanation, setRevealedExplanation] = useState<string>(
    post.officialExplanationHtml || ''
  );
  const [showKeyPanel, setShowKeyPanel] = useState(
    Boolean(post.answerKey && (post.myAttempt || post.authorId === currentUserId))
  );

  useEffect(() => {
    setPayload(post.myAttempt?.attemptPayload || {});
    setRevealedKey(post.answerKey || null);
    setRevealedExplanation(post.officialExplanationHtml || '');
    setShowKeyPanel(
      Boolean(post.answerKey && (post.myAttempt || post.authorId === currentUserId))
    );
    setError('');
  }, [post.id, post.myAttempt, post.answerKey, post.officialExplanationHtml, post.authorId, currentUserId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const res = await apiFetch<{
        attempt: ForumAttemptItem;
        attemptCount: number;
        revealKey?: ForumAnswerKey | null;
        officialExplanationHtml?: string;
      }>(`/api/forum/posts/${post.id}/attempt`, {
        method: 'POST',
        body: JSON.stringify({ attemptPayload: payload }),
      });

      const nextKey = res.revealKey || post.answerKey || null;
      const nextExp = res.officialExplanationHtml || post.officialExplanationHtml || '';
      if (nextKey) setRevealedKey(nextKey);
      if (nextExp) setRevealedExplanation(nextExp);
      setShowKeyPanel(true);

      onAttemptSubmitted({
        ...post,
        attemptCount: res.attemptCount,
        myAttempt: res.attempt,
        answerKey: nextKey,
        officialExplanationHtml: nextExp,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit answer attempt');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleMultiOption = (optId: string) => {
    const cur = new Set(payload.selectedOptions || []);
    if (cur.has(optId)) cur.delete(optId);
    else cur.add(optId);
    setPayload({ ...payload, selectedOptions: Array.from(cur) });
  };

  const toggleMatrixCell = (rowId: string, colId: string) => {
    const cur = { ...(payload.matrixMap || {}) };
    const set = new Set(cur[rowId] || []);
    if (set.has(colId)) set.delete(colId);
    else {
      if (spec.matrixMultiMatch === false) set.clear();
      set.add(colId);
    }
    cur[rowId] = Array.from(set);
    setPayload({ ...payload, matrixMap: cur });
  };

  const formatAnswerKeySummary = (k: ForumAnswerKey): string => {
    if (k.selectedOption) return `Option ${k.selectedOption}`;
    if (k.selectedOptions && k.selectedOptions.length > 0) {
      return `Options ${[...k.selectedOptions].sort().join(', ')}`;
    }
    if (typeof k.integerValue === 'number') return String(k.integerValue);
    if (typeof k.doubleValue === 'number') {
      return `${k.doubleValue}${spec.unit ? ` ${spec.unit}` : ''}`;
    }
    if (k.matrixMap) {
      return Object.entries(k.matrixMap)
        .map(([r, cols]) => `${r}→[${cols.join(',')}]`)
        .join(' · ');
    }
    if (k.subjectiveAnswer) return k.subjectiveAnswer;
    return 'No fixed key configured';
  };

  const myAttempt = post.myAttempt;

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-4 space-y-4"
    >
      {/* Question Spec Metadata Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700/80 pb-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-300 font-medium">
          <span className="font-semibold text-blue-700 dark:text-blue-400">
            {spec.examPreset}
          </span>
          <span aria-hidden="true">·</span>
          <span>{spec.subject || post.subject}</span>
          {spec.topic && (
            <>
              <span aria-hidden="true">·</span>
              <span>{spec.topic}</span>
            </>
          )}
          <span aria-hidden="true">·</span>
          <span className="font-mono text-[11px] uppercase">
            {spec.fieldType.replace('_', ' ')}
          </span>
          {(typeof spec.positiveMarks === 'number' || typeof spec.negativeMarks === 'number') && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-[11px]">
                +{spec.positiveMarks ?? 4} / −{spec.negativeMarks ?? 1}
              </span>
            </>
          )}
        </div>
        <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
          <Users className="h-3.5 w-3.5" />
          {post.attemptCount} {post.attemptCount === 1 ? 'attempt' : 'attempts'}
        </span>
      </div>

      {/* Comprehension Passage */}
      {spec.fieldType === 'comprehension' && spec.passageText && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3.5 space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Comprehension Passage
          </div>
          <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
            {spec.passageText}
          </p>
        </div>
      )}

      {/* Assertion & Reason Statements */}
      {spec.fieldType === 'assertion_reason' && (spec.assertionText || spec.reasonText) && (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
            <div className="text-[11px] font-semibold text-blue-700 dark:text-blue-400">
              Assertion (A)
            </div>
            <p className="mt-1 text-xs text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
              {spec.assertionText}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
            <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
              Reason (R)
            </div>
            <p className="mt-1 text-xs text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
              {spec.reasonText}
            </p>
          </div>
        </div>
      )}

      {/* MCQ Single / Assertion-Reason Options */}
      {(effectiveType === 'mcq_single' || effectiveType === 'assertion_reason') &&
        spec.options &&
        spec.options.length > 0 && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {spec.options.map((opt) => {
              const selected = payload.selectedOption === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPayload({ ...payload, selectedOption: opt.id })}
                  className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left text-xs transition-colors ${
                    selected
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-slate-900 dark:text-white'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-bold ${
                      selected
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {opt.id}
                  </span>
                  <span className="leading-relaxed">{opt.text || `Option ${opt.id}`}</span>
                </button>
              );
            })}
          </div>
        )}

      {/* Multi-Select MCQ Options */}
      {effectiveType === 'mcq_multi' && spec.options && spec.options.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Select all options that apply (Multi-correct):
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {spec.options.map((opt) => {
              const selected = (payload.selectedOptions || []).includes(opt.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => toggleMultiOption(opt.id)}
                  className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left text-xs transition-colors ${
                    selected
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-slate-900 dark:text-white'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border font-mono text-[11px] font-bold ${
                      selected
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {opt.id}
                  </span>
                  <span className="leading-relaxed">{opt.text || `Option ${opt.id}`}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Integer Input */}
      {effectiveType === 'integer' && (
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="number"
            step={1}
            min={spec.integerMin}
            max={spec.integerMax}
            value={payload.integerValue ?? ''}
            onChange={(e) => setPayload({ ...payload, integerValue: e.target.value })}
            placeholder="Enter integer answer..."
            className="w-48 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 font-mono text-sm tabular-nums text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
          />
          <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            Range: {spec.integerMin ?? -999999} to {spec.integerMax ?? 999999}
          </span>
        </div>
      )}

      {/* Double / Numerical Input */}
      {effectiveType === 'double' && (
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="number"
            step="any"
            value={payload.doubleValue ?? ''}
            onChange={(e) => setPayload({ ...payload, doubleValue: e.target.value })}
            placeholder="Enter numerical value..."
            className="w-52 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 font-mono text-sm tabular-nums text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
          />
          {spec.unit && (
            <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
              {spec.unit}
            </span>
          )}
          <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            Tolerance ±{spec.numericTolerance ?? 0.01}
          </span>
        </div>
      )}

      {/* Matrix Match Grid */}
      {effectiveType === 'matrix_match' && spec.matrixRows && spec.matrixCols && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 space-y-1">
              <div className="font-semibold text-slate-700 dark:text-slate-200">List I</div>
              {spec.matrixRows.map((r) => (
                <div key={r.id} className="text-slate-600 dark:text-slate-300">
                  <strong className="font-mono">({r.id})</strong> {r.label}
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 space-y-1">
              <div className="font-semibold text-slate-700 dark:text-slate-200">List II</div>
              {spec.matrixCols.map((c) => (
                <div key={c.id} className="text-slate-600 dark:text-slate-300">
                  <strong className="font-mono">({c.id})</strong> {c.label}
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full max-w-md border-collapse bg-white dark:bg-slate-900 text-xs">
              <thead>
                <tr>
                  <th className="border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-left">
                    Match
                  </th>
                  {spec.matrixCols.map((c) => (
                    <th
                      key={c.id}
                      className="border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 font-mono text-center"
                    >
                      {c.id}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {spec.matrixRows.map((r) => (
                  <tr key={r.id}>
                    <td className="border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 font-mono font-bold">
                      {r.id}
                    </td>
                    {spec.matrixCols!.map((c) => {
                      const checked = (payload.matrixMap?.[r.id] || []).includes(c.id);
                      return (
                        <td
                          key={c.id}
                          className="border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-center"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleMatrixCell(r.id, c.id)}
                            aria-label={`Match ${r.id} to ${c.id}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Subjective Input */}
      {effectiveType === 'subjective' && (
        <textarea
          rows={3}
          value={payload.subjectiveText || ''}
          onChange={(e) => setPayload({ ...payload, subjectiveText: e.target.value })}
          placeholder="Write your concise answer or final result here (and post detailed working in the discussion thread below)..."
          className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
        />
      )}

      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Action Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {myAttempt ? 'Update My Attempt' : 'Submit Answer Attempt'}
          </button>

          {(spec.revealMode === 'immediate' || post.authorId === currentUserId || myAttempt) &&
            (revealedKey || revealedExplanation) && (
              <button
                type="button"
                onClick={() => setShowKeyPanel((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Eye className="h-3.5 w-3.5" />
                {showKeyPanel ? 'Hide Official Key' : 'View Official Key'}
              </button>
            )}
        </div>
      </div>

      {/* Instant Attempt Feedback */}
      {myAttempt && (
        <div
          className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs ${
            myAttempt.isCorrect === true
              ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200'
              : myAttempt.isCorrect === false
                ? 'border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200'
                : 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200'
          }`}
        >
          {myAttempt.isCorrect === true ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : myAttempt.isCorrect === false ? (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <HelpCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <div>
            <div className="font-semibold">{myAttempt.scoreNote}</div>
            <div className="text-[11px] opacity-80">
              Attempt saved {new Date(myAttempt.createdAt).toLocaleString()}
            </div>
          </div>
        </div>
      )}

      {/* Official Key & Explanation */}
      {showKeyPanel && (revealedKey || revealedExplanation) && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/70 bg-white dark:bg-slate-900 p-3.5 space-y-2">
          {revealedKey && (
            <div className="text-xs">
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                Official Answer Key:{' '}
              </span>
              <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                {formatAnswerKeySummary(revealedKey)}
              </span>
            </div>
          )}
          {revealedExplanation && (
            <div className="border-t border-slate-100 dark:border-slate-800 pt-2">
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Author Explanation
              </div>
              <SafeHtmlContent html={revealedExplanation} className="text-xs" />
            </div>
          )}
        </div>
      )}
    </form>
  );
};
