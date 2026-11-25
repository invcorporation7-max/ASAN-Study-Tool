import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type {
  ExamPreset,
  ForumAnswerKey,
  ForumQuestionOption,
  ForumQuestionSpec,
  QuestionFieldType,
} from '../types';
import { SummernoteEditor } from './SummernoteEditor';

interface QuestionSpecBuilderProps {
  spec: ForumQuestionSpec;
  answerKey: ForumAnswerKey;
  officialExplanationHtml: string;
  onChangeSpec: (spec: ForumQuestionSpec) => void;
  onChangeAnswerKey: (key: ForumAnswerKey) => void;
  onChangeOfficialExplanationHtml: (html: string) => void;
}

const EXAM_PRESETS: { preset: ExamPreset; pos: number; neg: number }[] = [
  { preset: 'JEE Main', pos: 4, neg: 1 },
  { preset: 'JEE Advanced', pos: 4, neg: 2 },
  { preset: 'NEET UG', pos: 4, neg: 1 },
  { preset: 'ISC', pos: 1, neg: 0 },
  { preset: 'CBSE', pos: 1, neg: 0 },
  { preset: 'CUET', pos: 5, neg: 1 },
  { preset: 'Competitive / Custom', pos: 2, neg: 0 },
];

const FIELD_TYPES: { id: QuestionFieldType; label: string; hint: string }[] = [
  { id: 'mcq_single', label: 'Single Correct MCQ', hint: 'One correct option (A–F)' },
  { id: 'mcq_multi', label: 'Multi-Select MCQ', hint: 'One or more correct options' },
  { id: 'integer', label: 'Integer Type', hint: 'Exact integer value' },
  { id: 'double', label: 'Numerical / Double', hint: 'Decimal value ± tolerance' },
  { id: 'matrix_match', label: 'Matrix Match', hint: 'Match List I (P–S) with List II (1–5)' },
  { id: 'assertion_reason', label: 'Assertion & Reason', hint: 'Statement [A] and Reason [R]' },
  { id: 'comprehension', label: 'Comprehension', hint: 'Passage + sub-question' },
  { id: 'subjective', label: 'Subjective / Proof', hint: 'Written derivation or explanation' },
];

const DEFAULT_ASSERTION_OPTIONS: ForumQuestionOption[] = [
  { id: 'A', text: 'Both Assertion (A) and Reason (R) are true, and R is the correct explanation of A.' },
  { id: 'B', text: 'Both Assertion (A) and Reason (R) are true, but R is NOT the correct explanation of A.' },
  { id: 'C', text: 'Assertion (A) is true, but Reason (R) is false.' },
  { id: 'D', text: 'Assertion (A) is false, but Reason (R) is true.' },
];

const DEFAULT_OPTIONS: ForumQuestionOption[] = [
  { id: 'A', text: '' },
  { id: 'B', text: '' },
  { id: 'C', text: '' },
  { id: 'D', text: '' },
];

const DEFAULT_MATRIX_ROWS = [
  { id: 'P', label: '' },
  { id: 'Q', label: '' },
  { id: 'R', label: '' },
  { id: 'S', label: '' },
];

const DEFAULT_MATRIX_COLS = [
  { id: '1', label: '' },
  { id: '2', label: '' },
  { id: '3', label: '' },
  { id: '4', label: '' },
];

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export const QuestionSpecBuilder: React.FC<QuestionSpecBuilderProps> = ({
  spec,
  answerKey,
  officialExplanationHtml,
  onChangeSpec,
  onChangeAnswerKey,
  onChangeOfficialExplanationHtml,
}) => {
  const effectiveType =
    spec.fieldType === 'comprehension'
      ? spec.subQuestionType || 'mcq_single'
      : spec.fieldType;

  const options =
    spec.options && spec.options.length > 0
      ? spec.options
      : spec.fieldType === 'assertion_reason'
        ? DEFAULT_ASSERTION_OPTIONS
        : DEFAULT_OPTIONS;

  const matrixRows =
    spec.matrixRows && spec.matrixRows.length > 0 ? spec.matrixRows : DEFAULT_MATRIX_ROWS;
  const matrixCols =
    spec.matrixCols && spec.matrixCols.length > 0 ? spec.matrixCols : DEFAULT_MATRIX_COLS;

  const handleFieldTypeChange = (nextType: QuestionFieldType) => {
    const nextSpec: ForumQuestionSpec = {
      ...spec,
      fieldType: nextType,
    };
    if (nextType === 'assertion_reason') {
      nextSpec.options = DEFAULT_ASSERTION_OPTIONS;
      nextSpec.assertionText = spec.assertionText || '';
      nextSpec.reasonText = spec.reasonText || '';
    } else if (nextType === 'mcq_single' || nextType === 'mcq_multi') {
      nextSpec.options =
        spec.options && spec.options.length >= 2 ? spec.options : DEFAULT_OPTIONS;
    } else if (nextType === 'matrix_match') {
      nextSpec.matrixRows =
        spec.matrixRows && spec.matrixRows.length > 0 ? spec.matrixRows : DEFAULT_MATRIX_ROWS;
      nextSpec.matrixCols =
        spec.matrixCols && spec.matrixCols.length > 0 ? spec.matrixCols : DEFAULT_MATRIX_COLS;
      nextSpec.matrixMultiMatch = spec.matrixMultiMatch ?? true;
    } else if (nextType === 'comprehension') {
      nextSpec.subQuestionType = spec.subQuestionType || 'mcq_single';
      nextSpec.options =
        spec.options && spec.options.length >= 2 ? spec.options : DEFAULT_OPTIONS;
      nextSpec.passageText = spec.passageText || '';
    } else if (nextType === 'double') {
      nextSpec.numericTolerance = spec.numericTolerance ?? 0.01;
    } else if (nextType === 'integer') {
      nextSpec.integerMin = spec.integerMin ?? 0;
      nextSpec.integerMax = spec.integerMax ?? 9999;
    }
    onChangeSpec(nextSpec);
    onChangeAnswerKey({});
  };

  const toggleMatrixKeyCell = (rowId: string, colId: string) => {
    const curMap = { ...(answerKey.matrixMap || {}) };
    const existing = new Set(curMap[rowId] || []);
    if (existing.has(colId)) {
      existing.delete(colId);
    } else {
      if (!spec.matrixMultiMatch) existing.clear();
      existing.add(colId);
    }
    curMap[rowId] = Array.from(existing);
    onChangeAnswerKey({ ...answerKey, matrixMap: curMap });
  };

  return (
    <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/30 dark:bg-blue-950/20 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-100 dark:border-blue-900/40 pb-2.5">
        <div>
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
            Competitive &amp; Board Question Answering Specification
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Configure exam pattern, marking scheme, interactive answering field, and optional verification key.
          </p>
        </div>
        <select
          value={spec.revealMode}
          onChange={(e) =>
            onChangeSpec({
              ...spec,
              revealMode: e.target.value === 'immediate' ? 'immediate' : 'after_attempt',
            })
          }
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200"
        >
          <option value="after_attempt">Reveal Answer After Attempt</option>
          <option value="immediate">Allow Immediate Reveal</option>
        </select>
      </div>

      {/* Exam Preset + Topic + Marks */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div>
          <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
            Exam Board / Pattern
          </label>
          <select
            value={spec.examPreset}
            onChange={(e) => {
              const found = EXAM_PRESETS.find((p) => p.preset === e.target.value);
              onChangeSpec({
                ...spec,
                examPreset: (found?.preset || 'Competitive / Custom') as ExamPreset,
                positiveMarks: found ? found.pos : spec.positiveMarks,
                negativeMarks: found ? found.neg : spec.negativeMarks,
              });
            }}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100"
          >
            {EXAM_PRESETS.map((p) => (
              <option key={p.preset} value={p.preset}>
                {p.preset}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
            Chapter / Topic (Optional)
          </label>
          <input
            type="text"
            value={spec.topic || ''}
            onChange={(e) => onChangeSpec({ ...spec, topic: e.target.value })}
            placeholder="e.g., Rotational Dynamics"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100"
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
            Positive Marks (+)
          </label>
          <input
            type="number"
            min={0}
            step="0.5"
            value={spec.positiveMarks ?? 4}
            onChange={(e) =>
              onChangeSpec({ ...spec, positiveMarks: Math.max(0, Number(e.target.value) || 0) })
            }
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs tabular-nums text-slate-900 dark:text-slate-100"
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
            Negative Marks (−)
          </label>
          <input
            type="number"
            min={0}
            step="0.25"
            value={spec.negativeMarks ?? 1}
            onChange={(e) =>
              onChangeSpec({ ...spec, negativeMarks: Math.max(0, Number(e.target.value) || 0) })
            }
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs tabular-nums text-slate-900 dark:text-slate-100"
          />
        </div>
      </div>

      {/* Field Type Selector */}
      <div>
        <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1.5">
          Answer Field Type
        </label>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {FIELD_TYPES.map((ft) => {
            const active = spec.fieldType === ft.id;
            return (
              <button
                key={ft.id}
                type="button"
                onClick={() => handleFieldTypeChange(ft.id)}
                className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
                  active
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                <div className="text-[11px] font-semibold leading-tight">{ft.label}</div>
                <div
                  className={`mt-0.5 text-[10px] leading-tight ${
                    active ? 'text-blue-100' : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {ft.hint}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Comprehension Passage + Sub-Question Type */}
      {spec.fieldType === 'comprehension' && (
        <div className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
              Comprehension / Case-Study Passage
            </label>
            <textarea
              rows={3}
              value={spec.passageText || ''}
              onChange={(e) => onChangeSpec({ ...spec, passageText: e.target.value })}
              placeholder="Paste or write the paragraph/case study on which the question is based..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
              Sub-Question Format
            </label>
            <select
              value={spec.subQuestionType || 'mcq_single'}
              onChange={(e) => {
                onChangeSpec({
                  ...spec,
                  subQuestionType: e.target.value as ForumQuestionSpec['subQuestionType'],
                });
                onChangeAnswerKey({});
              }}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            >
              <option value="mcq_single">Single Correct MCQ</option>
              <option value="mcq_multi">Multiple Correct MCQ</option>
              <option value="integer">Integer Type</option>
              <option value="double">Numerical / Double Type</option>
              <option value="subjective">Subjective Answer</option>
            </select>
          </div>
        </div>
      )}

      {/* Assertion & Reason Texts */}
      {spec.fieldType === 'assertion_reason' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
              Assertion (A)
            </label>
            <textarea
              rows={2}
              value={spec.assertionText || ''}
              onChange={(e) => onChangeSpec({ ...spec, assertionText: e.target.value })}
              placeholder="Statement of Assertion (A)..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
              Reason (R)
            </label>
            <textarea
              rows={2}
              value={spec.reasonText || ''}
              onChange={(e) => onChangeSpec({ ...spec, reasonText: e.target.value })}
              placeholder="Statement of Reason (R)..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>
        </div>
      )}

      {/* Options Editor for MCQ Single / Multi / Assertion-Reason */}
      {(effectiveType === 'mcq_single' ||
        effectiveType === 'mcq_multi' ||
        effectiveType === 'assertion_reason') && (
        <div className="space-y-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
              Options &amp; Optional Correct Answer Key (
              {effectiveType === 'mcq_multi' ? 'Select all correct' : 'Pick one correct'})
            </span>
            {options.length < 6 && spec.fieldType !== 'assertion_reason' && (
              <button
                type="button"
                onClick={() => {
                  const nextId = OPTION_LETTERS[options.length] || `O${options.length + 1}`;
                  onChangeSpec({
                    ...spec,
                    options: [...options, { id: nextId, text: '' }],
                  });
                }}
                className="inline-flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Plus className="h-3 w-3" /> Add Option
              </button>
            )}
          </div>

          <div className="space-y-2">
            {options.map((opt, idx) => {
              const isSelectedKey =
                effectiveType === 'mcq_multi'
                  ? (answerKey.selectedOptions || []).includes(opt.id)
                  : answerKey.selectedOption === opt.id;
              return (
                <div key={opt.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (effectiveType === 'mcq_multi') {
                        const prev = new Set(answerKey.selectedOptions || []);
                        if (prev.has(opt.id)) prev.delete(opt.id);
                        else prev.add(opt.id);
                        onChangeAnswerKey({ ...answerKey, selectedOptions: Array.from(prev) });
                      } else {
                        onChangeAnswerKey({
                          ...answerKey,
                          selectedOption: isSelectedKey ? undefined : opt.id,
                        });
                      }
                    }}
                    title="Mark as official correct option"
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border font-mono text-xs font-bold transition-colors ${
                      isSelectedKey
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {opt.id}
                  </button>
                  <input
                    type="text"
                    value={opt.text}
                    onChange={(e) => {
                      const next = options.map((o, i) =>
                        i === idx ? { ...o, text: e.target.value } : o
                      );
                      onChangeSpec({ ...spec, options: next });
                    }}
                    placeholder={`Option ${opt.id} text...`}
                    className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                  />
                  {options.length > 2 && spec.fieldType !== 'assertion_reason' && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = options
                          .filter((_, i) => i !== idx)
                          .map((o, newIdx) => ({ ...o, id: OPTION_LETTERS[newIdx] || o.id }));
                        onChangeSpec({ ...spec, options: next });
                      }}
                      className="rounded p-1 text-slate-400 hover:text-red-600"
                      aria-label={`Remove option ${opt.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400">
            Click option letter badge to highlight it green as the optional Official Key (leave unselected if open question).
          </div>
        </div>
      )}

      {/* Integer Spec */}
      {effectiveType === 'integer' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
              Min Allowed Integer
            </label>
            <input
              type="number"
              value={spec.integerMin ?? 0}
              onChange={(e) => onChangeSpec({ ...spec, integerMin: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs tabular-nums text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
              Max Allowed Integer
            </label>
            <input
              type="number"
              value={spec.integerMax ?? 9999}
              onChange={(e) => onChangeSpec({ ...spec, integerMax: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs tabular-nums text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
              Official Integer Key (Optional)
            </label>
            <input
              type="number"
              step={1}
              value={answerKey.integerValue ?? ''}
              onChange={(e) =>
                onChangeAnswerKey({
                  ...answerKey,
                  integerValue: e.target.value === '' ? null : Math.round(Number(e.target.value)),
                })
              }
              placeholder="e.g. 5"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs tabular-nums text-slate-900 dark:text-slate-100"
            />
          </div>
        </div>
      )}

      {/* Double / Numerical Spec */}
      {effectiveType === 'double' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
              Tolerance (±)
            </label>
            <input
              type="number"
              min={0}
              step="0.001"
              value={spec.numericTolerance ?? 0.01}
              onChange={(e) =>
                onChangeSpec({ ...spec, numericTolerance: Math.max(0, Number(e.target.value) || 0) })
              }
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs tabular-nums text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
              Unit (Optional)
            </label>
            <input
              type="text"
              value={spec.unit || ''}
              onChange={(e) => onChangeSpec({ ...spec, unit: e.target.value })}
              placeholder="e.g., m/s, J, mol/L"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
              Official Numerical Key (Optional)
            </label>
            <input
              type="number"
              step="any"
              value={answerKey.doubleValue ?? ''}
              onChange={(e) =>
                onChangeAnswerKey({
                  ...answerKey,
                  doubleValue: e.target.value === '' ? null : Number(e.target.value),
                })
              }
              placeholder="e.g. 9.81"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs tabular-nums text-slate-900 dark:text-slate-100"
            />
          </div>
        </div>
      )}

      {/* Matrix Match Builder */}
      {effectiveType === 'matrix_match' && (
        <div className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
              Matrix Match Setup (List I × List II)
            </span>
            <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={spec.matrixMultiMatch ?? true}
                onChange={(e) => onChangeSpec({ ...spec, matrixMultiMatch: e.target.checked })}
                className="rounded border-slate-300 text-blue-600"
              />
              Allow multiple matches per row (JEE Advanced style)
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">List I (Rows)</div>
              {matrixRows.map((r, idx) => (
                <div key={r.id} className="flex items-center gap-1.5">
                  <span className="w-6 text-center font-mono text-xs font-bold text-slate-700 dark:text-slate-200">
                    ({r.id})
                  </span>
                  <input
                    type="text"
                    value={r.label}
                    onChange={(e) => {
                      const next = matrixRows.map((x, i) =>
                        i === idx ? { ...x, label: e.target.value } : x
                      );
                      onChangeSpec({ ...spec, matrixRows: next });
                    }}
                    placeholder={`Item ${r.id}`}
                    className="flex-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">List II (Columns)</span>
                {matrixCols.length < 5 && (
                  <button
                    type="button"
                    onClick={() =>
                      onChangeSpec({
                        ...spec,
                        matrixCols: [...matrixCols, { id: String(matrixCols.length + 1), label: '' }],
                      })
                    }
                    className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    + Col 5
                  </button>
                )}
              </div>
              {matrixCols.map((c, idx) => (
                <div key={c.id} className="flex items-center gap-1.5">
                  <span className="w-6 text-center font-mono text-xs font-bold text-slate-700 dark:text-slate-200">
                    ({c.id})
                  </span>
                  <input
                    type="text"
                    value={c.label}
                    onChange={(e) => {
                      const next = matrixCols.map((x, i) =>
                        i === idx ? { ...x, label: e.target.value } : x
                      );
                      onChangeSpec({ ...spec, matrixCols: next });
                    }}
                    placeholder={`Match ${c.id}`}
                    className="flex-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
              Optional Answer Key Matrix Grid
            </div>
            <div className="overflow-x-auto">
              <table className="w-full max-w-sm border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="border border-slate-200 dark:border-slate-700 px-2 py-1 text-left">Row</th>
                    {matrixCols.map((c) => (
                      <th key={c.id} className="border border-slate-200 dark:border-slate-700 px-2 py-1 font-mono">
                        {c.id}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrixRows.map((r) => (
                    <tr key={r.id}>
                      <td className="border border-slate-200 dark:border-slate-700 px-2 py-1 font-mono font-bold">
                        {r.id}
                      </td>
                      {matrixCols.map((c) => {
                        const checked = (answerKey.matrixMap?.[r.id] || []).includes(c.id);
                        return (
                          <td
                            key={c.id}
                            className="border border-slate-200 dark:border-slate-700 px-2 py-1 text-center"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleMatrixKeyCell(r.id, c.id)}
                              aria-label={`Key ${r.id} matches ${c.id}`}
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
        </div>
      )}

      {/* Subjective Model Key */}
      {effectiveType === 'subjective' && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
          <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
            Reference Answer Summary (Optional)
          </label>
          <input
            type="text"
            value={answerKey.subjectiveAnswer || ''}
            onChange={(e) => onChangeAnswerKey({ ...answerKey, subjectiveAnswer: e.target.value })}
            placeholder="Key result or expected conclusion..."
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
          />
        </div>
      )}

      {/* Official Solution / Explanation */}
      <div className="space-y-1.5">
        <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300">
          Author&apos;s Hint or Official Explanation (Optional · Revealed based on reveal rule)
        </label>
        <SummernoteEditor
          valueHtml={officialExplanationHtml}
          onChangeHtml={onChangeOfficialExplanationHtml}
          allowAttachments={false}
          minHeight={105}
          placeholder="Optional step-by-step derivation or hint..."
        />
      </div>
    </div>
  );
};
