import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Calculator,
  Compass,
  FunctionSquare,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch, apiPublicFetch } from '../lib/api';
import {
  extractEquationSymbols,
  solveWithFormulaSystem,
  type FormulaSolveResponse,
  type UserOutputRequest,
  type UserParamInput,
} from '../lib/formulaEngine';
import type { FormulaEquationItem, FormulaSymbolDef } from '../types';

interface SolverPreset {
  id: string;
  label: string;
  subtitle: string;
  inputs: UserParamInput[];
  outputs: UserOutputRequest[];
}

const SOLVER_PRESETS: SolverPreset[] = [
  {
    id: 'conic-eq',
    label: 'Conic Equation → Axes, LR & Directrices',
    subtitle: '9x² + 16y² - 36x + 96y + 36 = 0',
    inputs: [{ description: 'Conic Equation', value: '9x^2 + 16y^2 - 36x + 96y + 36 = 0' }],
    outputs: [
      { description: 'Classification' },
      { description: 'Major Axis' },
      { description: 'Minor Axis' },
      { description: 'Latus Rectum' },
      { description: 'Equation of Directrix' },
      { description: 'Foci' },
    ],
  },
  {
    id: 'circle-center-radius',
    label: 'Circle (Center & Radius) → Equation & Intercepts',
    subtitle: 'Center (2, -3), Radius 5',
    inputs: [
      { description: 'Center', value: '(2, -3)' },
      { description: 'Radius', value: '5' },
    ],
    outputs: [
      { description: 'Equation of Circle' },
      { description: 'General Equation' },
      { description: 'Area' },
      { description: 'Length of x-intercept' },
    ],
  },
  {
    id: 'circle-3-pts',
    label: 'Circle from 3 Points',
    subtitle: '(0,0), (4,0), (0,3)',
    inputs: [
      { description: 'Point 1', value: '(0, 0)' },
      { description: 'Point 2', value: '(4, 0)' },
      { description: 'Point 3', value: '(0, 3)' },
    ],
    outputs: [
      { description: 'Equation of Circle' },
      { description: 'Center' },
      { description: 'Radius' },
    ],
  },
  {
    id: 'conic-focus-dir',
    label: 'Conic from Focus + Directrix + Eccentricity',
    subtitle: 'Focus (2, 0), Directrix x + 2 = 0, e = 1',
    inputs: [
      { description: 'Focus', value: '(2, 0)' },
      { description: 'Directrix', value: 'x + 2 = 0' },
      { description: 'Eccentricity', value: '1' },
    ],
    outputs: [
      { description: 'Standard Equation' },
      { description: 'Vertex' },
      { description: 'Latus Rectum' },
      { description: 'Axis of Symmetry' },
    ],
  },
  {
    id: 'kinematics-chain',
    label: 'Physics Multi-Equation Chaining',
    subtitle: 'Initial velocity 4, Final velocity 20, Time 4 → Accel & Distance',
    inputs: [
      { description: 'Initial velocity', value: '4', unit: 'm/s' },
      { description: 'Final velocity', value: '20', unit: 'm/s' },
      { description: 'Time elapsed', value: '4', unit: 's' },
    ],
    outputs: [
      { description: 'Uniform acceleration', unit: 'm/s²' },
      { description: 'Displacement', unit: 'm' },
    ],
  },
];

const QUICK_CONIC_OUTPUTS = [
  'Major Axis',
  'Minor Axis',
  'Latus Rectum',
  'Equation of Directrix',
  'Equation of Circle',
  'Center',
  'Radius',
  'Eccentricity',
  'Foci',
  'Vertices',
  'Asymptotes',
];

export const FormulaCalculatorView: React.FC = () => {
  const { dbUser, isApprovedContributor, isAdmin, isSuper } = useAuth();
  const canAuthorFormulas = Boolean(isApprovedContributor || isAdmin || isSuper);

  const [activeTab, setActiveTab] = useState<'solver' | 'library'>('solver');
  const [formulas, setFormulas] = useState<FormulaEquationItem[]>([]);
  const [loadingFormulas, setLoadingFormulas] = useState(true);

  // Solver State
  const [angleUnit, setAngleUnit] = useState<'rad' | 'deg'>('rad');
  const [inputs, setInputs] = useState<UserParamInput[]>(SOLVER_PRESETS[0].inputs);
  const [outputsCount, setOutputsCount] = useState<number>(SOLVER_PRESETS[0].outputs.length);
  const [requestedOutputs, setRequestedOutputs] = useState<UserOutputRequest[]>(
    SOLVER_PRESETS[0].outputs
  );
  const [solveResult, setSolveResult] = useState<FormulaSolveResponse | null>(null);

  // Library Filter & Contributor Form
  const [libSearch, setLibSearch] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formSubject, setFormSubject] = useState('Physics');
  const [formExpression, setFormExpression] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formSymbols, setFormSymbols] = useState<FormulaSymbolDef[]>([]);
  const [savingFormula, setSavingFormula] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadFormulas = useCallback(async () => {
    setLoadingFormulas(true);
    try {
      const list = await apiPublicFetch<FormulaEquationItem[]>('/api/formulas');
      setFormulas(Array.isArray(list) ? list : []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load contributor formulas');
    } finally {
      setLoadingFormulas(false);
    }
  }, []);

  useEffect(() => {
    void loadFormulas();
  }, [loadFormulas]);

  // Run initial solve once formulas load
  useEffect(() => {
    if (!loadingFormulas && !solveResult) {
      setSolveResult(solveWithFormulaSystem(formulas, inputs, requestedOutputs, angleUnit));
    }
  }, [loadingFormulas, formulas, inputs, requestedOutputs, angleUnit, solveResult]);

  const allSymbolMeanings = useMemo(() => {
    const set = new Set<string>();
    for (const f of formulas) {
      for (const s of f.symbols || []) {
        if (s.meaning) set.add(s.meaning);
      }
    }
    return Array.from(set);
  }, [formulas]);

  const handleOutputCountChange = (count: number) => {
    const clean = Math.max(1, Math.min(10, Math.round(count) || 1));
    setOutputsCount(clean);
    setRequestedOutputs((prev) => {
      if (prev.length === clean) return prev;
      if (prev.length > clean) return prev.slice(0, clean);
      const next = [...prev];
      while (next.length < clean) {
        next.push({ description: '' });
      }
      return next;
    });
  };

  const handleApplyPreset = (preset: SolverPreset) => {
    setInputs(preset.inputs.map((i) => ({ ...i })));
    setOutputsCount(preset.outputs.length);
    setRequestedOutputs(preset.outputs.map((o) => ({ ...o })));
    setSolveResult(solveWithFormulaSystem(formulas, preset.inputs, preset.outputs, angleUnit));
  };

  const handleSolve = (e?: React.FormEvent) => {
    e?.preventDefault();
    const res = solveWithFormulaSystem(formulas, inputs, requestedOutputs, angleUnit);
    setSolveResult(res);
  };

  const syncDetectedSymbols = (expr: string) => {
    const detected = extractEquationSymbols(expr);
    setFormSymbols((prev) => {
      const bySym = new Map(prev.map((s) => [s.symbol, s]));
      return detected.map(
        (sym) =>
          bySym.get(sym) || {
            symbol: sym,
            meaning: '',
            unit: '',
          }
      );
    });
  };

  const handleSaveFormula = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingFormula(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const cleanedSymbols = formSymbols.filter((s) => s.symbol.trim() && s.meaning.trim());
      if (editingId) {
        await apiFetch(`/api/formulas/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify({
            title: formTitle.trim(),
            subject: formSubject.trim() || 'General',
            expression: formExpression.trim(),
            description: formDescription.trim(),
            symbols: cleanedSymbols,
          }),
        });
        setStatusMsg(`Updated formula "${formTitle.trim()}".`);
      } else {
        await apiFetch('/api/formulas', {
          method: 'POST',
          body: JSON.stringify({
            title: formTitle.trim(),
            subject: formSubject.trim() || 'General',
            expression: formExpression.trim(),
            description: formDescription.trim(),
            symbols: cleanedSymbols,
          }),
        });
        setStatusMsg(`Added new formula "${formTitle.trim()}" to the solver library.`);
      }
      setEditingId(null);
      setFormTitle('');
      setFormExpression('');
      setFormDescription('');
      setFormSymbols([]);
      await loadFormulas();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save formula');
    } finally {
      setSavingFormula(false);
    }
  };

  const handleDeleteFormula = async (f: FormulaEquationItem) => {
    try {
      await apiFetch(`/api/formulas/${f.id}`, { method: 'DELETE' });
      setStatusMsg(`Deleted formula "${f.title}".`);
      await loadFormulas();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to delete formula');
    }
  };

  const filteredFormulas = useMemo(() => {
    const q = libSearch.trim().toLowerCase();
    if (!q) return formulas;
    return formulas.filter(
      (f) =>
        f.title.toLowerCase().includes(q) ||
        f.subject.toLowerCase().includes(q) ||
        f.expression.toLowerCase().includes(q) ||
        f.symbols.some((s) => s.meaning.toLowerCase().includes(q) || s.symbol.toLowerCase().includes(q))
    );
  }, [formulas, libSearch]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Formula Equation &amp; Conic/Circle Parameter Calculator
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Enter known parameters &amp; desired outputs. Automatically matches and chains Contributor-defined equations or solves Circle &amp; Conic Section properties (Major/Minor Axis, Latus Rectum, Directrices).
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('solver')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${
              activeTab === 'solver'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            <Calculator className="h-3.5 w-3.5" />
            Parameter Solver
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('library')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${
              activeTab === 'library'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" />
            Formula Library ({formulas.length})
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-2.5 text-xs text-emerald-800 dark:text-emerald-300">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-xs text-red-700 dark:text-red-300">
          {errorMsg}
        </div>
      )}

      {activeTab === 'solver' ? (
        <div className="space-y-5">
          {/* Quick Presets */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                <Sparkles className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                Quick-Fill Examples (Conics, Circles &amp; Multi-Equation Chaining)
              </div>
              <div className="flex items-center gap-1 text-xs">
                <span className="text-slate-500 dark:text-slate-400">Angles:</span>
                {(['rad', 'deg'] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setAngleUnit(u)}
                    className={`rounded px-2 py-0.5 font-mono text-[11px] font-semibold uppercase ${
                      angleUnit === u
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {SOLVER_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleApplyPreset(p)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 px-3 py-1.5 text-left hover:border-blue-400 transition-colors"
                >
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                    {p.label}
                  </div>
                  <div className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                    {p.subtitle}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleSolve} className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-start">
            {/* Left: Inputs & Requested Outputs */}
            <div className="lg:col-span-6 space-y-5">
              {/* Input Parameters */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
                  <div>
                    <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                      1. Known Input Parameters ({inputs.length})
                    </h2>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Describe each given parameter (e.g. Center, Radius, Conic Equation, Initial velocity) &amp; enter its value.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setInputs((prev) => [...prev, { description: '', value: '', unit: '' }])
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Input
                  </button>
                </div>

                <datalist id="asan-param-suggestions">
                  {allSymbolMeanings.map((m) => (
                    <option key={m} value={m} />
                  ))}
                  <option value="Conic Equation" />
                  <option value="Equation of Circle" />
                  <option value="Center" />
                  <option value="Radius" />
                  <option value="Point 1" />
                  <option value="Point 2" />
                  <option value="Point 3" />
                  <option value="Focus" />
                  <option value="Directrix" />
                  <option value="Eccentricity" />
                </datalist>

                <div className="space-y-2.5">
                  {inputs.map((inp, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-1 gap-2 sm:grid-cols-12 items-center rounded-lg border border-slate-200 dark:border-slate-700/80 bg-slate-50/70 dark:bg-slate-800/40 p-2.5"
                    >
                      <input
                        type="text"
                        list="asan-param-suggestions"
                        value={inp.description}
                        onChange={(e) =>
                          setInputs((prev) =>
                            prev.map((x, i) =>
                              i === idx ? { ...x, description: e.target.value } : x
                            )
                          )
                        }
                        placeholder="Parameter description"
                        className="sm:col-span-5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                      />
                      <input
                        type="text"
                        value={inp.value}
                        onChange={(e) =>
                          setInputs((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, value: e.target.value } : x))
                          )
                        }
                        placeholder="Value / (h,k) / Eq"
                        className="sm:col-span-4 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
                      />
                      <input
                        type="text"
                        value={inp.unit || ''}
                        onChange={(e) =>
                          setInputs((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x))
                          )
                        }
                        placeholder="Unit"
                        className="sm:col-span-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                      />
                      <button
                        type="button"
                        disabled={inputs.length <= 1}
                        onClick={() => setInputs((prev) => prev.filter((_, i) => i !== idx))}
                        className="sm:col-span-1 flex justify-center text-slate-400 hover:text-red-600 disabled:opacity-30"
                        aria-label="Remove input parameter"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Requested Outputs */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2.5">
                  <div>
                    <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                      2. Requested Output Parameters
                    </h2>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Choose how many output parameters to compute and specify each target.
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200">
                    <span>Outputs:</span>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={outputsCount}
                      onChange={(e) => handleOutputCountChange(Number(e.target.value))}
                      className="w-16 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-center font-mono text-xs tabular-nums"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {QUICK_CONIC_OUTPUTS.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => {
                        const emptyIdx = requestedOutputs.findIndex((o) => !o.description.trim());
                        if (emptyIdx >= 0) {
                          setRequestedOutputs((prev) =>
                            prev.map((o, i) => (i === emptyIdx ? { ...o, description: chip } : o))
                          );
                        } else if (requestedOutputs.length < 10) {
                          const next = [...requestedOutputs, { description: chip }];
                          setRequestedOutputs(next);
                          setOutputsCount(next.length);
                        }
                      }}
                      className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300 hover:border-blue-400"
                    >
                      + {chip}
                    </button>
                  ))}
                </div>

                <div className="space-y-2">
                  {requestedOutputs.map((out, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-1 gap-2 sm:grid-cols-12 items-center"
                    >
                      <span className="sm:col-span-1 font-mono text-xs font-semibold text-slate-400 tabular-nums">
                        #{idx + 1}
                      </span>
                      <input
                        type="text"
                        list="asan-param-suggestions"
                        value={out.description}
                        onChange={(e) =>
                          setRequestedOutputs((prev) =>
                            prev.map((x, i) =>
                              i === idx ? { ...x, description: e.target.value } : x
                            )
                          )
                        }
                        placeholder="Desired output (e.g. Major Axis, Latus Rectum, Directrix, Kinetic energy)"
                        className="sm:col-span-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                      />
                      <input
                        type="text"
                        value={out.unit || ''}
                        onChange={(e) =>
                          setRequestedOutputs((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x))
                          )
                        }
                        placeholder="Unit"
                        className="sm:col-span-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  ))}
                </div>

                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  <Compass className="h-4 w-4" />
                  Solve &amp; Equate Parameters
                </button>
              </div>
            </div>

            {/* Right: Computed Outputs & Steps */}
            <div className="lg:col-span-6 space-y-4">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2.5">
                  <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                    Computed Output Parameters
                  </h2>
                  {solveResult && (
                    <span className="font-mono text-[11px] font-semibold text-blue-700 dark:text-blue-400 uppercase">
                      {solveResult.mode === 'geometry_symbolic'
                        ? 'Analytic Circle/Conic'
                        : solveResult.mode === 'mixed'
                          ? 'Hybrid Analytic + Formulas'
                          : 'Formula Chaining'}
                    </span>
                  )}
                </div>

                {!solveResult ? (
                  <p className="py-8 text-center text-xs text-slate-500">
                    Enter inputs and click Solve &amp; Equate Parameters.
                  </p>
                ) : (
                  <>
                    {solveResult.warnings.length > 0 && (
                      <div className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-300">
                        {solveResult.warnings.join(' ')}
                      </div>
                    )}

                    {solveResult.outputs.length > 0 && (
                      <div className="space-y-2.5">
                        {solveResult.outputs.map((item, idx) => (
                          <div
                            key={`${item.requestedDescription}-${idx}`}
                            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 p-3.5 space-y-1.5"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                                {item.requestedDescription}
                              </span>
                              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                {item.formulaTitle}
                              </span>
                            </div>
                            <div className="rounded-md bg-slate-900 dark:bg-slate-950 px-3 py-2 font-mono text-sm font-semibold text-emerald-300 tabular-nums break-words">
                              {item.valueDisplay}
                              {item.unit ? ` ${item.unit}` : ''}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 break-words">
                              Equation: {item.equationUsed}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {solveResult.unmatchedOutputs.length > 0 && (
                      <div className="rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 p-3 text-xs text-rose-800 dark:text-rose-200">
                        Could not match:{' '}
                        <strong>{solveResult.unmatchedOutputs.join(', ')}</strong>. Verify parameter descriptions match definitions in the Formula Library or standard Circle/Conic keywords.
                      </div>
                    )}

                    {solveResult.derivationSteps.length > 0 && (
                      <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
                        <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">
                          Equating &amp; Derivation Steps
                        </div>
                        <ol className="space-y-1.5 text-xs font-mono text-slate-600 dark:text-slate-300 list-decimal list-inside">
                          {solveResult.derivationSteps.map((step, idx) => (
                            <li key={idx} className="break-words tabular-nums">
                              {step}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </form>
        </div>
      ) : (
        /* Formula Library & Contributor Definition Tab */
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-start">
          {/* Contributor Equation Authoring Card */}
          <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <FunctionSquare className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                {editingId ? 'Edit Formula Equation' : 'Define Formula Equation'}
              </h2>
            </div>

            {!canAuthorFormulas ? (
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Approved <strong>Contributors</strong>, <strong>Admins</strong>, and <strong>Super</strong> define new equations and symbol meanings here. You can request Contributor status in <strong>Study Material Notes</strong>.
              </div>
            ) : (
              <form onSubmit={handleSaveFormula} className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                      Title
                    </label>
                    <input
                      type="text"
                      required
                      value={formTitle}
                      onChange={(e) => setFormTitle(e.target.value)}
                      placeholder="e.g., Kinetic Energy"
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                      Subject
                    </label>
                    <input
                      type="text"
                      value={formSubject}
                      onChange={(e) => setFormSubject(e.target.value)}
                      placeholder="Physics / Maths / Chemistry"
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Equation (must include =)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      value={formExpression}
                      onChange={(e) => {
                        setFormExpression(e.target.value);
                        syncDetectedSymbols(e.target.value);
                      }}
                      placeholder="e.g., KE = 0.5 * m * v^2"
                      className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Notes / Description
                  </label>
                  <input
                    type="text"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="When to apply this formula..."
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                      Symbol Definitions ({formSymbols.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => syncDetectedSymbols(formExpression)}
                      className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Re-detect from Equation
                    </button>
                  </div>
                  {formSymbols.map((sym, idx) => (
                    <div key={sym.symbol} className="grid grid-cols-12 gap-2 items-center">
                      <span className="col-span-2 rounded bg-slate-100 dark:bg-slate-800 px-2 py-1.5 text-center font-mono text-xs font-bold text-slate-900 dark:text-slate-100">
                        {sym.symbol}
                      </span>
                      <input
                        type="text"
                        required
                        value={sym.meaning}
                        onChange={(e) =>
                          setFormSymbols((prev) =>
                            prev.map((s, i) =>
                              i === idx ? { ...s, meaning: e.target.value } : s
                            )
                          )
                        }
                        placeholder="Parameter meaning (e.g. Mass)"
                        className="col-span-7 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                      />
                      <input
                        type="text"
                        value={sym.unit || ''}
                        onChange={(e) =>
                          setFormSymbols((prev) =>
                            prev.map((s, i) =>
                              i === idx ? { ...s, unit: e.target.value } : s
                            )
                          )
                        }
                        placeholder="Unit"
                        className="col-span-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  {editingId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        setFormTitle('');
                        setFormExpression('');
                        setFormDescription('');
                        setFormSymbols([]);
                      }}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-medium"
                    >
                      Cancel Edit
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={savingFormula}
                    className="flex-1 rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {savingFormula
                      ? 'Saving...'
                      : editingId
                        ? 'Update Formula Equation'
                        : 'Save Formula to Library'}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Existing Formula Equations List */}
          <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Defined Equations &amp; Symbol Maps ({filteredFormulas.length})
              </h2>
              <input
                type="search"
                value={libSearch}
                onChange={(e) => setLibSearch(e.target.value)}
                placeholder="Search title, subject, or parameter..."
                className="w-60 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>

            {loadingFormulas ? (
              <div className="py-8 text-center text-xs text-slate-500">Loading formulas...</div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredFormulas.map((f) => {
                  const canEdit =
                    f.authorId === dbUser?.id || isAdmin || isSuper;
                  return (
                    <div key={f.id} className="py-3.5 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {f.title}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {f.subject} · Defined by @{f.authorUsername}
                          </div>
                        </div>
                        {canEdit && f.id > 0 && (
                          <div className="flex items-center gap-2 text-xs">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(f.id);
                                setFormTitle(f.title);
                                setFormSubject(f.subject);
                                setFormExpression(f.expression);
                                setFormDescription(f.description);
                                setFormSymbols(f.symbols);
                              }}
                              className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteFormula(f)}
                              className="text-slate-400 hover:text-red-600"
                              aria-label="Delete formula"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="rounded-md bg-slate-900 dark:bg-slate-950 px-3 py-1.5 font-mono text-xs text-emerald-300">
                        {f.expression}
                      </div>
                      {f.description && (
                        <p className="text-xs text-slate-600 dark:text-slate-300">
                          {f.description}
                        </p>
                      )}
                      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 text-[11px]">
                        {f.symbols.map((s) => (
                          <div
                            key={s.symbol}
                            className="rounded border border-slate-200 dark:border-slate-700/80 bg-slate-50 dark:bg-slate-800/50 px-2.5 py-1 text-slate-700 dark:text-slate-200"
                          >
                            <span className="font-mono font-bold text-blue-700 dark:text-blue-400">
                              {s.symbol}
                            </span>{' '}
                            = {s.meaning}
                            {s.unit ? ` (${s.unit})` : ''}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
