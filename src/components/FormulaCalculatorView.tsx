import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Calculator,
  Clock,
  Compass,
  Crown,
  FunctionSquare,
  Lock,
  Play,
  Plus,
  Sparkles,
  Square,
  Trash2,
  Zap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch, apiPublicFetch } from '../lib/api';
import {
  GEOMETRY_CASE_LABEL,
  autoDetectFormulaCase,
  extractEquationSymbols,
  parseQuickParamString,
  solveWithFormulaSystem,
  type FormulaSolveResponse,
  type UserOutputRequest,
  type UserParamInput,
} from '../lib/formulaEngine';
import type {
  FormulaAccessStatus,
  FormulaEquationItem,
  FormulaSymbolDef,
  NavSection,
} from '../types';

interface FormulaCalculatorViewProps {
  onNavigate?: (section: NavSection) => void;
}

interface SolverPreset {
  id: string;
  label: string;
  subtitle: string;
  preferredCase: string;
  quickText: string;
  inputs: UserParamInput[];
  outputs: UserOutputRequest[];
}

const SOLVER_PRESETS: SolverPreset[] = [
  {
    id: 'kinematics-uam',
    label: 'Uniformly Accelerated Motion → Solve a',
    subtitle: 's = ut + 1/2at² · u=5, t=5, s=250 → a',
    preferredCase: '__auto__',
    quickText: 'u=5, t = 5, s = 250',
    inputs: [
      { description: 'u', symbolHint: 'u', value: '5', unit: 'm/s' },
      { description: 't', symbolHint: 't', value: '5', unit: 's' },
      { description: 's', symbolHint: 's', value: '250', unit: 'm' },
    ],
    outputs: [{ description: 'a', symbolHint: 'a', unit: 'm/s²' }],
  },
  {
    id: 'conic-eq',
    label: 'Conic Equation → Axes, LR & Directrices',
    subtitle: '9x² + 16y² - 36x + 96y + 36 = 0',
    preferredCase: '__auto__',
    quickText: 'Conic Equation = 9x^2 + 16y^2 - 36x + 96y + 36 = 0',
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
    preferredCase: '__auto__',
    quickText: 'Center = (2, -3), Radius = 5',
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
    preferredCase: '__auto__',
    quickText: 'Point 1 = (0, 0), Point 2 = (4, 0), Point 3 = (0, 3)',
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
    preferredCase: '__auto__',
    quickText: 'Focus = (2, 0), Directrix = x + 2 = 0, Eccentricity = 1',
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
    label: 'Multi-Equation Chaining (v, u, t → a & s)',
    subtitle: 'Initial velocity 4, Final velocity 20, Time 4 → Accel & Displacement',
    preferredCase: 'Uniformly Accelerated Motion',
    quickText: 'Initial velocity = 4, Final velocity = 20, Time interval = 4',
    inputs: [
      { description: 'Initial velocity', value: '4', unit: 'm/s' },
      { description: 'Final velocity', value: '20', unit: 'm/s' },
      { description: 'Time interval', value: '4', unit: 's' },
    ],
    outputs: [
      { description: 'Acceleration', unit: 'm/s²' },
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

function formatCountdownMmSs(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const FormulaCalculatorView: React.FC<FormulaCalculatorViewProps> = ({
  onNavigate,
}) => {
  const {
    dbUser,
    isGuest,
    isEffectiveProOrAdmin,
    isApprovedContributor,
    isAdmin,
    isSuper,
    refreshProfile,
    exitGuestToSignIn,
  } = useAuth();
  const canAuthorFormulas = Boolean(isApprovedContributor || isAdmin || isSuper);

  const [activeTab, setActiveTab] = useState<'solver' | 'library'>('solver');
  const [formulas, setFormulas] = useState<FormulaEquationItem[]>([]);
  const [loadingFormulas, setLoadingFormulas] = useState(true);

  // Metered / Pro Access State
  const [accessStatus, setAccessStatus] = useState<FormulaAccessStatus | null>(null);
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [togglingAccess, setTogglingAccess] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const renewInFlightRef = useRef(false);

  // Solver State
  const [selectedCase, setSelectedCase] = useState<string>('__auto__');
  const [angleUnit, setAngleUnit] = useState<'rad' | 'deg'>('rad');
  const [quickAssignText, setQuickAssignText] = useState<string>(SOLVER_PRESETS[0].quickText);
  const [inputs, setInputs] = useState<UserParamInput[]>(SOLVER_PRESETS[0].inputs);
  const [outputsCount, setOutputsCount] = useState<number>(SOLVER_PRESETS[0].outputs.length);
  const [requestedOutputs, setRequestedOutputs] = useState<UserOutputRequest[]>(
    SOLVER_PRESETS[0].outputs
  );
  const [solveResult, setSolveResult] = useState<FormulaSolveResponse | null>(null);
  const initialSolvedRef = useRef(false);

  // Library Filter & Contributor Form
  const [libSearch, setLibSearch] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formSubject, setFormSubject] = useState('Physics');
  const [formCaseName, setFormCaseName] = useState('Uniformly Accelerated Motion');
  const [formExpression, setFormExpression] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formSymbols, setFormSymbols] = useState<FormulaSymbolDef[]>([]);
  const [savingFormula, setSavingFormula] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isProIncluded = Boolean(isEffectiveProOrAdmin || accessStatus?.proIncluded);
  const hasSolverAccess = Boolean(!isGuest && (isProIncluded || accessStatus?.hasAccess));

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

  const loadAccessStatus = useCallback(async () => {
    if (isGuest || !dbUser) {
      setAccessStatus(null);
      return;
    }
    setLoadingAccess(true);
    try {
      const st = await apiFetch<FormulaAccessStatus>('/api/formula-access/status');
      setAccessStatus(st);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to check Formula Calculator access');
    } finally {
      setLoadingAccess(false);
    }
  }, [isGuest, dbUser]);

  useEffect(() => {
    void loadFormulas();
  }, [loadFormulas]);

  useEffect(() => {
    void loadAccessStatus();
  }, [loadAccessStatus]);

  // Live 15-minute quarter countdown & automatic quarterly renewal while enabled
  useEffect(() => {
    if (isGuest || isProIncluded || !accessStatus?.enabled || !accessStatus.quarterExpiresAt) {
      setRemainingSeconds(0);
      return;
    }

    const computeRemaining = () => {
      const expMs = new Date(accessStatus.quarterExpiresAt).getTime();
      if (!Number.isFinite(expMs)) return 0;
      return Math.max(0, Math.ceil((expMs - Date.now()) / 1000));
    };

    const tick = () => {
      const rem = computeRemaining();
      setRemainingSeconds(rem);
      if (rem <= 0 && !renewInFlightRef.current) {
        renewInFlightRef.current = true;
        void apiFetch<FormulaAccessStatus>('/api/formula-access/renew', {
          method: 'POST',
        })
          .then(async (next) => {
            setAccessStatus(next);
            setStatusMsg(
              `Quarterly billing renewed (${next.lastChargedPoints} pts for 15 min · Quarter #${next.quarterNumber}).`
            );
            await refreshProfile();
          })
          .catch(async (err) => {
            setErrorMsg(
              err instanceof Error
                ? err.message
                : 'Metered quarter expired and could not renew.'
            );
            await loadAccessStatus();
          })
          .finally(() => {
            renewInFlightRef.current = false;
          });
      }
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [
    isGuest,
    isProIncluded,
    accessStatus?.enabled,
    accessStatus?.quarterExpiresAt,
    refreshProfile,
    loadAccessStatus,
  ]);

  // Run initial solve once formulas load & access is unlocked
  useEffect(() => {
    if (!loadingFormulas && hasSolverAccess && !initialSolvedRef.current) {
      initialSolvedRef.current = true;
      setSolveResult(
        solveWithFormulaSystem(formulas, inputs, requestedOutputs, angleUnit, selectedCase)
      );
    }
  }, [
    loadingFormulas,
    hasSolverAccess,
    formulas,
    inputs,
    requestedOutputs,
    angleUnit,
    selectedCase,
  ]);

  const handleEnableMetered = async () => {
    setTogglingAccess(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await apiFetch<FormulaAccessStatus>('/api/formula-access/start', {
        method: 'POST',
      });
      setAccessStatus(res);
      await refreshProfile();
      setStatusMsg(
        res.proIncluded
          ? 'Pro / Admin access active — unlimited usage.'
          : res.lastChargedPoints > 0
            ? `Metered access enabled: ${res.lastChargedPoints} pts billed for 15 min (30 pts/hr rate).`
            : `Metered access resumed inside your active 15-min quarter.`
      );
      if (formulas.length > 0) {
        setSolveResult(
          solveWithFormulaSystem(formulas, inputs, requestedOutputs, angleUnit, selectedCase)
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to enable metered access');
    } finally {
      setTogglingAccess(false);
    }
  };

  const handleDisableMetered = async () => {
    setTogglingAccess(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await apiFetch<FormulaAccessStatus>('/api/formula-access/stop', {
        method: 'POST',
      });
      setAccessStatus(res);
      setStatusMsg('Metered Formula Calculator paused. No further quarters will be billed.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to pause metered access');
    } finally {
      setTogglingAccess(false);
    }
  };

  const availableCases = useMemo(() => {
    const set = new Set<string>([GEOMETRY_CASE_LABEL]);
    for (const f of formulas) {
      const c = (f.caseName || 'General').trim() || 'General';
      set.add(c);
    }
    const priorityOrder = [GEOMETRY_CASE_LABEL, 'Uniformly Accelerated Motion'];
    const rest = Array.from(set)
      .filter((c) => !priorityOrder.includes(c))
      .sort((a, b) => a.localeCompare(b));
    return [...priorityOrder.filter((c) => set.has(c)), ...rest];
  }, [formulas]);

  const activeCaseInfo = useMemo(() => {
    if (selectedCase !== '__auto__') {
      return { caseName: selectedCase, confidence: 100, mode: 'manual' as const };
    }
    if (solveResult?.detectedCase) {
      return {
        caseName: solveResult.detectedCase,
        confidence: 100,
        mode: 'auto' as const,
      };
    }
    const detected = autoDetectFormulaCase(formulas, inputs, requestedOutputs);
    return { ...detected, mode: 'auto' as const };
  }, [selectedCase, solveResult?.detectedCase, formulas, inputs, requestedOutputs]);

  const caseEquations = useMemo(() => {
    return formulas.filter(
      (f) => ((f.caseName || 'General').trim() || 'General') === activeCaseInfo.caseName
    );
  }, [formulas, activeCaseInfo.caseName]);

  const allSymbolMeanings = useMemo(() => {
    const set = new Set<string>();
    for (const f of formulas) {
      for (const s of f.symbols || []) {
        if (s.symbol) set.add(s.symbol);
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
    const nextCase = preset.preferredCase || '__auto__';
    setSelectedCase(nextCase);
    setQuickAssignText(preset.quickText);
    const clonedIn = preset.inputs.map((i) => ({ ...i }));
    const clonedOut = preset.outputs.map((o) => ({ ...o }));
    setInputs(clonedIn);
    setOutputsCount(clonedOut.length);
    setRequestedOutputs(clonedOut);
    if (hasSolverAccess) {
      setSolveResult(
        solveWithFormulaSystem(formulas, clonedIn, clonedOut, angleUnit, nextCase)
      );
    }
  };

  const handleApplyQuickAssign = () => {
    const parsed = parseQuickParamString(quickAssignText);
    if (parsed.length === 0) {
      setErrorMsg('Enter comma-separated assignments like: u=5, t = 5, s = 250');
      return;
    }
    setErrorMsg(null);
    setInputs(parsed);
    if (hasSolverAccess) {
      setSolveResult(
        solveWithFormulaSystem(formulas, parsed, requestedOutputs, angleUnit, selectedCase)
      );
    }
  };

  const handleInsertSymbolAsInput = (sym: FormulaSymbolDef) => {
    setInputs((prev) => {
      const existsIdx = prev.findIndex(
        (p) =>
          p.symbolHint?.toLowerCase() === sym.symbol.toLowerCase() ||
          p.description.trim().toLowerCase() === sym.symbol.toLowerCase() ||
          p.description.trim().toLowerCase() === sym.meaning.toLowerCase()
      );
      if (existsIdx >= 0) return prev;
      const emptyIdx = prev.findIndex((p) => !p.description.trim() && !p.value.trim());
      const entry: UserParamInput = {
        description: sym.meaning || sym.symbol,
        symbolHint: sym.symbol,
        value: '',
        unit: sym.unit || '',
      };
      if (emptyIdx >= 0) {
        return prev.map((x, i) => (i === emptyIdx ? entry : x));
      }
      return [...prev, entry];
    });
  };

  const handleSetSymbolAsOutput = (sym: FormulaSymbolDef) => {
    setRequestedOutputs((prev) => {
      const emptyIdx = prev.findIndex((o) => !o.description.trim());
      const nextOut: UserOutputRequest = {
        description: sym.symbol,
        symbolHint: sym.symbol,
        unit: sym.unit || '',
      };
      if (emptyIdx >= 0) {
        return prev.map((x, i) => (i === emptyIdx ? nextOut : x));
      }
      if (prev.length === 1) {
        return [nextOut];
      }
      if (prev.length < 10) {
        const next = [...prev, nextOut];
        setOutputsCount(next.length);
        return next;
      }
      return prev;
    });
  };

  const handleSolve = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!hasSolverAccess) {
      setErrorMsg(
        isGuest
          ? 'Sign in and enable Metered Access (30 pts/hr) or upgrade to Pro to run the Formula Calculator.'
          : 'Enable Metered Access (30 pts/hr, billed quarterly) or upgrade to Pro to solve equations.'
      );
      return;
    }
    setErrorMsg(null);
    const res = solveWithFormulaSystem(
      formulas,
      inputs,
      requestedOutputs,
      angleUnit,
      selectedCase
    );
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
      const payload = {
        title: formTitle.trim(),
        subject: formSubject.trim() || 'General',
        caseName: formCaseName.trim() || 'General',
        expression: formExpression.trim(),
        description: formDescription.trim(),
        symbols: cleanedSymbols,
      };
      if (editingId) {
        await apiFetch(`/api/formulas/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setStatusMsg(`Updated formula "${formTitle.trim()}".`);
      } else {
        await apiFetch('/api/formulas', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setStatusMsg(`Added new formula "${formTitle.trim()}" to case "${payload.caseName}".`);
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
        (f.caseName || '').toLowerCase().includes(q) ||
        f.expression.toLowerCase().includes(q) ||
        f.symbols.some(
          (s) => s.meaning.toLowerCase().includes(q) || s.symbol.toLowerCase().includes(q)
        )
    );
  }, [formulas, libSearch]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
              Formula Equation &amp; Case Parameter Calculator
            </h1>
            <span className="asan-pro-badge rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              Pro or 30 pts/hr
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Select a physics/math case or use Auto-Detect, provide known parameters (e.g.{' '}
            <code className="font-mono">u=5, t = 5, s = 250</code>), and request output symbols or Circle/Conic properties.
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

      {/* Pro / Metered Hourly Access Strip (30 pts/hr billed quarterly every 15 min) */}
      <div
        className={`rounded-xl border p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${
          isProIncluded
            ? 'asan-pro-card border-indigo-200 dark:border-indigo-800/70'
            : hasSolverAccess
              ? 'border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/60 dark:bg-emerald-950/30'
              : 'border-amber-200 dark:border-amber-800/80 bg-amber-50/70 dark:bg-amber-950/30'
        }`}
      >
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {isProIncluded ? (
              <>
                <Crown className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  Formula Calculator Included in Pro / Admin
                </span>
                <span className="rounded bg-indigo-100 dark:bg-indigo-900/60 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:text-indigo-300">
                  Unlimited · 0 pts/hr
                </span>
              </>
            ) : isGuest ? (
              <>
                <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  Pro Plan or Metered Access Required (30 pts/hr · Quarterly 15-min billing)
                </span>
              </>
            ) : (
              <>
                <Clock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  Metered Hourly Access · 30 pts/hr (Calculated Quarterly: 8 / 7 / 8 / 7 pts per 15 min)
                </span>
                {accessStatus?.enabled && (
                  <span className="rounded bg-emerald-600 px-2 py-0.5 font-mono text-[10px] font-bold text-white tabular-nums">
                    ACTIVE · Q#{accessStatus.quarterNumber} · {formatCountdownMmSs(remainingSeconds)}
                  </span>
                )}
              </>
            )}
          </div>

          <p className="text-[11px] text-slate-600 dark:text-slate-300 tabular-nums">
            {isProIncluded
              ? 'Your active Pro, Admin, or Super privileges include unrestricted access to all case equations and symbolic conic solvers.'
              : isGuest
                ? 'Sign in with Google or Email/Password to toggle Metered Access (30 pts/hr billed every 15 minutes) or activate Pro.'
                : loadingAccess
                  ? 'Checking metered session status...'
                  : accessStatus?.enabled
                    ? `Balance: ${dbUser?.points ?? accessStatus.points ?? 0} pts · Session billed: ${accessStatus.totalSessionPoints} pts · Re-bills automatically every 15 minutes until manually disabled.`
                    : `Balance: ${dbUser?.points ?? accessStatus?.points ?? 0} pts · Manual Enable/Disable — starts at ${accessStatus?.nextQuarterCost ?? 8} pts for the first 15-minute quarter (exact 30 pts/hr across 4 quarters).`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {isGuest ? (
            <button
              type="button"
              onClick={exitGuestToSignIn}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700"
            >
              Sign In to Enable / Upgrade
            </button>
          ) : !isProIncluded ? (
            <>
              {accessStatus?.enabled ? (
                <button
                  type="button"
                  disabled={togglingAccess}
                  onClick={() => void handleDisableMetered()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 dark:border-red-800 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-60"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                  {togglingAccess ? 'Pausing...' : 'Disable Metered Access'}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={togglingAccess || loadingAccess}
                  onClick={() => void handleEnableMetered()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  {togglingAccess
                    ? 'Enabling...'
                    : `Enable Metered (${accessStatus?.nextQuarterCost ?? 8} pts / 15m)`}
                </button>
              )}
              {onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate('subscriptions')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 dark:border-indigo-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                >
                  <Crown className="h-3.5 w-3.5" />
                  Go Pro
                </button>
              )}
            </>
          ) : null}
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
          {/* Case Selector + Quick Presets */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3.5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end">
              <div className="md:col-span-6">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
                  Case / Scenario (Auto-Detect First, or Select Manually)
                </label>
                <select
                  value={selectedCase}
                  onChange={(e) => {
                    const nextCase = e.target.value;
                    setSelectedCase(nextCase);
                    if (hasSolverAccess) {
                      setSolveResult(
                        solveWithFormulaSystem(
                          formulas,
                          inputs,
                          requestedOutputs,
                          angleUnit,
                          nextCase
                        )
                      );
                    }
                  }}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100"
                >
                  <option value="__auto__">Auto-Detect Case (Recommended)</option>
                  {availableCases.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-4 flex items-center gap-2">
                <div className="w-full rounded-lg border border-blue-200 dark:border-blue-800/70 bg-blue-50/70 dark:bg-blue-950/40 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                    {activeCaseInfo.mode === 'auto' ? 'Auto-Detected Case' : 'Manual Case'}
                  </div>
                  <div className="truncate text-xs font-bold text-slate-900 dark:text-slate-100">
                    {activeCaseInfo.caseName}
                  </div>
                </div>
              </div>

              <div className="md:col-span-2 flex items-center justify-end gap-1 text-xs">
                <span className="text-slate-500 dark:text-slate-400">Angles:</span>
                {(['rad', 'deg'] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setAngleUnit(u)}
                    className={`rounded px-2 py-1 font-mono text-[11px] font-semibold uppercase ${
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

            {/* Active Case Equation Reference & Clickable Symbol Definitions */}
            {caseEquations.length > 0 && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-700/80 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                    Equation Reference · {activeCaseInfo.caseName}
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">
                    Click any symbol to add as Input or set as Target Output
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {caseEquations.slice(0, 4).map((eq) => (
                    <div
                      key={eq.id}
                      className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {eq.title}
                        </span>
                        <code className="rounded bg-slate-900 px-2 py-0.5 font-mono text-[11px] text-emerald-300">
                          [{eq.expression}]
                        </code>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {eq.symbols.map((sym) => (
                          <div
                            key={`${eq.id}-${sym.symbol}`}
                            className="inline-flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-700 dark:text-slate-200"
                          >
                            <span className="font-mono font-bold text-blue-700 dark:text-blue-400">
                              {sym.symbol}
                            </span>
                            <span>= {sym.meaning}</span>
                            <button
                              type="button"
                              onClick={() => handleInsertSymbolAsInput(sym)}
                              title={`Add ${sym.symbol} to inputs`}
                              className="ml-1 rounded bg-blue-50 dark:bg-blue-950/60 px-1 font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-100"
                            >
                              +In
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSetSymbolAsOutput(sym)}
                              title={`Find ${sym.symbol} as output`}
                              className="rounded bg-emerald-50 dark:bg-emerald-950/60 px-1 font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100"
                            >
                              ?Out
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick-Fill Examples */}
            <div className="space-y-2 pt-1 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                <Sparkles className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                Quick-Fill Examples
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
                      Type quick pairs (<code className="font-mono">u=5, t = 5, s = 250</code>) or edit structured parameters below.
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

                {/* Quick Parameter Assignment Bar */}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center rounded-lg border border-blue-100 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/20 p-2.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-700 dark:text-blue-300 shrink-0">
                    <Zap className="h-3.5 w-3.5" />
                    Quick Assign:
                  </div>
                  <input
                    type="text"
                    value={quickAssignText}
                    onChange={(e) => setQuickAssignText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleApplyQuickAssign();
                      }
                    }}
                    placeholder="e.g. u=5, t = 5, s = 250"
                    className="flex-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={handleApplyQuickAssign}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 shrink-0"
                  >
                    Apply &amp; Parse
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
                        onChange={(e) => {
                          const val = e.target.value;
                          const isSym = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(val.trim()) && val.trim().length <= 8;
                          setInputs((prev) =>
                            prev.map((x, i) =>
                              i === idx
                                ? {
                                    ...x,
                                    description: val,
                                    symbolHint: isSym ? val.trim() : undefined,
                                  }
                                : x
                            )
                          );
                        }}
                        placeholder="Symbol or meaning (e.g. u, displacement)"
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
                      Enter target symbol (<code className="font-mono">a</code>) or parameter description (<code className="font-mono">Acceleration</code>, <code className="font-mono">Latus Rectum</code>).
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
                        onChange={(e) => {
                          const val = e.target.value;
                          const isSym = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(val.trim()) && val.trim().length <= 8;
                          setRequestedOutputs((prev) =>
                            prev.map((x, i) =>
                              i === idx
                                ? {
                                    ...x,
                                    description: val,
                                    symbolHint: isSym ? val.trim() : undefined,
                                  }
                                : x
                            )
                          );
                        }}
                        placeholder="Output symbol or meaning (e.g. a, Acceleration, Major Axis)"
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

                {hasSolverAccess ? (
                  <button
                    type="submit"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    <Compass className="h-4 w-4" />
                    Solve &amp; Equate Parameters
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={togglingAccess}
                    onClick={() =>
                      isGuest ? exitGuestToSignIn() : void handleEnableMetered()
                    }
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    <Lock className="h-4 w-4" />
                    {isGuest
                      ? 'Sign In for Metered Mode (30 pts/hr) or Pro'
                      : `Enable Metered Access (${accessStatus?.nextQuarterCost ?? 8} pts / 15 min) & Solve`}
                  </button>
                )}
              </div>
            </div>

            {/* Right: Computed Outputs & Steps */}
            <div className="lg:col-span-6 space-y-4">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2.5">
                  <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                    Computed Output Parameters
                  </h2>
                  {hasSolverAccess && solveResult && (
                    <span className="font-mono text-[11px] font-semibold text-blue-700 dark:text-blue-400 uppercase">
                      {solveResult.mode === 'geometry_symbolic'
                        ? 'Analytic Circle/Conic'
                        : solveResult.mode === 'mixed'
                          ? 'Hybrid Analytic + Formulas'
                          : 'Formula Chaining'}
                    </span>
                  )}
                </div>

                {!hasSolverAccess ? (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 p-6 text-center space-y-3">
                    <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/70 text-amber-600 dark:text-amber-400">
                      <Lock className="h-5 w-5" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                        Formula Calculator Solver Locked
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed max-w-md mx-auto">
                        This case-aware symbolic calculator is included with <strong>Pro</strong> or available via manual <strong>Metered Hourly Access (30 pts/hr billed quarterly every 15 minutes)</strong>. Note: Specialized Math Calculators remain available as the Lite Version for Pro &amp; Admin.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                      {isGuest ? (
                        <button
                          type="button"
                          onClick={exitGuestToSignIn}
                          className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                        >
                          Sign In to Continue
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={togglingAccess}
                            onClick={() => void handleEnableMetered()}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                          >
                            <Play className="h-3.5 w-3.5 fill-current" />
                            Enable Metered ({accessStatus?.nextQuarterCost ?? 8} pts / 15m)
                          </button>
                          {onNavigate && (
                            <button
                              type="button"
                              onClick={() => onNavigate('subscriptions')}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 dark:border-indigo-700 bg-white dark:bg-slate-900 px-4 py-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50"
                            >
                              <Crown className="h-3.5 w-3.5" />
                              Upgrade to Pro
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ) : !solveResult ? (
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
                                {item.matchedMeaning &&
                                item.matchedMeaning.toLowerCase() !==
                                  item.requestedDescription.toLowerCase()
                                  ? ` · ${item.matchedMeaning}`
                                  : ''}
                              </span>
                              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                {item.formulaTitle}
                              </span>
                            </div>
                            <div className="rounded-md bg-slate-900 dark:bg-slate-950 px-3 py-2 font-mono text-sm font-semibold text-emerald-300 tabular-nums break-words">
                              {item.matchedSymbol && item.matchedSymbol !== 'expr'
                                ? `${item.matchedSymbol} = `
                                : ''}
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
                        <strong>{solveResult.unmatchedOutputs.join(', ')}</strong>. Verify parameter descriptions match definitions in the selected case or try Auto-Detect Case.
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
                Approved <strong>Contributors</strong>, <strong>Admins</strong>, and <strong>Super</strong> define new case-scoped equations and symbol meanings here. You can request Contributor status in <strong>Study Material Notes</strong>.
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
                      placeholder="e.g., Second Equation of Motion"
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
                    Case / Scenario
                  </label>
                  <datalist id="asan-case-suggestions">
                    {availableCases
                      .filter((c) => c !== GEOMETRY_CASE_LABEL)
                      .map((c) => (
                        <option key={c} value={c} />
                      ))}
                  </datalist>
                  <input
                    type="text"
                    required
                    list="asan-case-suggestions"
                    value={formCaseName}
                    onChange={(e) => setFormCaseName(e.target.value)}
                    placeholder="e.g., Uniformly Accelerated Motion"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Equation (must include =; supports ut or u * t)
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
                      placeholder="e.g., s = u * t + 1/2 * a * t^2"
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
                        placeholder="Parameter meaning (e.g. displacement)"
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
                placeholder="Search title, case, subject, or symbol..."
                className="w-64 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
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
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                              {f.title}
                            </span>
                            <span className="rounded bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-300">
                              {f.caseName || 'General'}
                            </span>
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
                                setFormCaseName(f.caseName || 'General');
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

