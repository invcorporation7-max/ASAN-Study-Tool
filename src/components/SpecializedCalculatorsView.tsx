import React, { useMemo, useState } from 'react';
import { extractConicCoeffsFromEquation } from '../lib/formulaEngine';
import {
  solveAlgebra,
  solveCalculus,
  solveCoordinateGeometry,
  solveTrigonometry,
  solveVector3D,
  type AlgebraInput,
  type CalcResult,
  type CalculusInput,
  type CoordInput,
  type TrigInput,
  type Vec3,
  type Vector3DInput,
} from '../lib/mathCalculators';

type CalcSuiteTab = 'calculus' | 'coordinate' | 'algebra' | 'vector3d' | 'trigonometry';

const SUITE_TABS: { id: CalcSuiteTab; label: string; subtitle: string }[] = [
  { id: 'calculus', label: 'Calculus', subtitle: 'Limits, Derivatives, Integrals, Taylor & Extrema' },
  { id: 'coordinate', label: 'Coordinate Geometry', subtitle: 'Lines, Distance, Triangles, Circles & Conics' },
  { id: 'algebra', label: 'Algebra', subtitle: 'Equations, Systems, Inequalities, Matrices & Complex' },
  { id: 'vector3d', label: 'Vector & 3D Geometry', subtitle: 'Dot/Cross, Triple Products, 3D Lines & Planes' },
  { id: 'trigonometry', label: 'Trigonometry', subtitle: 'Exact Ratios, Triangle Solver, Equations & Polar' },
];

const inputCls =
  'w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none tabular-nums';
const labelCls = 'block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1';

function NumField({
  label,
  value,
  onChange,
  step = 'any',
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: string;
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className={inputCls}
      />
    </div>
  );
}

function Vec3Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Vec3;
  onChange: (v: Vec3) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700/80 bg-slate-50/70 dark:bg-slate-800/50 p-3">
      <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">{label}</div>
      <div className="grid grid-cols-3 gap-2">
        {(['x', 'y', 'z'] as const).map((axis, idx) => (
          <div key={axis}>
            <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5 uppercase">{axis}</label>
            <input
              type="number"
              step="any"
              value={value[idx]}
              onChange={(e) => {
                const next: Vec3 = [...value] as Vec3;
                next[idx] = parseFloat(e.target.value) || 0;
                onChange(next);
              }}
              className={inputCls}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultCard({ result }: { result: CalcResult }) {
  if (result.error) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-4 text-sm text-red-700 dark:text-red-300">
        <div className="font-semibold mb-1">{result.title}</div>
        <div>{result.error}</div>
      </div>
    );
  }

  return (
    <div className="asan-card-hover rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
          {result.title}
        </div>
        <div className="mt-1.5 rounded-lg bg-slate-900 dark:bg-slate-950 text-emerald-300 px-4 py-3 font-mono text-sm sm:text-base break-words tabular-nums border border-slate-800">
          {result.primaryAnswer}
        </div>
      </div>

      {result.secondaryAnswers && result.secondaryAnswers.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {result.secondaryAnswers.map((item, idx) => (
            <div
              key={`${item.label}-${idx}`}
              className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5"
            >
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                {item.label}
              </div>
              <div className="mt-0.5 font-mono text-xs sm:text-sm text-slate-900 dark:text-slate-100 break-words tabular-nums">
                {item.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {result.steps.length > 0 && (
        <div className="border-t border-slate-200 dark:border-slate-800 pt-3">
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
            Derivation & Method
          </div>
          <ol className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 list-decimal list-inside font-mono">
            {result.steps.map((step, i) => (
              <li key={i} className="break-words tabular-nums">
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

export function SpecializedCalculatorsView() {
  const [activeTab, setActiveTab] = useState<CalcSuiteTab>('calculus');

  // --- 1. Calculus State ---
  const [calcInput, setCalcInput] = useState<CalculusInput>({
    mode: 'derivative',
    expr: 'x^3 * sin(x) + 2*exp(x)',
    variable: 'x',
    order: 1,
    pointX: 'pi/2',
    pointY: '1',
    lowerBound: '0',
    upperBound: 'pi',
    limitDirection: 'both',
    taylorDegree: 5,
  });

  // --- 2. Coordinate Geometry State ---
  const [coordInput, setCoordInput] = useState<CoordInput>({
    mode: 'two-points',
    x1: 1, y1: 2,
    x2: 5, y2: 6,
    x3: 4, y3: 1,
    ratioM: 2, ratioN: 1,
    a1: 2, b1: -3, c1: 5,
    a2: 3, b2: 2, c2: -6,
    circleMode: 'center-radius',
    h: 2, k: -3, r: 5,
    g: -2, f: 3, cCircle: -12,
    conicA: 1, conicB: 0, conicC: 4, conicD: -6, conicE: 16, conicF: 9,
  });
  const [conicEqText, setConicEqText] = useState('9x^2 + 16y^2 - 36x + 96y + 36 = 0');
  const [conicEqErr, setConicEqErr] = useState<string | null>(null);

  // --- 3. Algebra State ---
  const [algInput, setAlgInput] = useState<AlgebraInput>({
    mode: 'polynomial',
    equation: 'x^3 - 6x^2 + 11x - 6 = 0',
    sysSize: 2,
    matrixSize: 2,
    matrixOp: 'det-inv',
    matrixA: [
      [2, 3, 1],
      [4, -1, 2],
      [1, 2, -1],
    ],
    matrixB: [
      [1, 0, 2],
      [0, 1, -1],
      [3, 1, 0],
    ],
    vectorB: [8, 2, 4],
    ineqA: 1, ineqB: -5, ineqC: 6, ineqOp: '>=',
    c1Re: 3, c1Im: 4, c2Re: 1, c2Im: -2, complexN: 3,
    progType: 'AP', firstTerm: 2, diffOrRatio: 3, termCount: 10, combN: 10, combR: 3,
  });

  // --- 4. Vector & 3D State ---
  const [vecInput, setVecInput] = useState<Vector3DInput>({
    mode: 'vector-ops',
    vecA: [2, -1, 3],
    vecB: [1, 4, -2],
    vecC: [0, 1, 2],
    p1: [1, 1, 0], d1: [2, -1, 1],
    p2: [2, 1, -1], d2: [3, -5, 2],
    p3: [0, 0, 3],
    testPoint: [1, 2, 3],
    planeMode: 'three-points',
    plane1: [2, -1, 2, -6],
    plane2: [1, 2, -1, 4],
  });

  // --- 5. Trigonometry State ---
  const [trigInput, setTrigInput] = useState<TrigInput>({
    mode: 'evaluate',
    angleUnit: 'deg',
    angleExpr: '75',
    triCase: 'SSA',
    a: 7, b: 10, c: 8,
    A: 30, B: 65, C: 60,
    equation: '2sin(x) - 1 = 0',
    convType: 'deg-rad-dms',
    convX: 45.5, convY: 60, convZ: 0,
  });

  const activeResult = useMemo<CalcResult>(() => {
    switch (activeTab) {
      case 'calculus':
        return solveCalculus(calcInput);
      case 'coordinate':
        return solveCoordinateGeometry(coordInput);
      case 'algebra':
        return solveAlgebra(algInput);
      case 'vector3d':
        return solveVector3D(vecInput);
      case 'trigonometry':
        return solveTrigonometry(trigInput);
    }
  }, [activeTab, calcInput, coordInput, algInput, vecInput, trigInput]);

  const updateMatrixCell = (
    target: 'matrixA' | 'matrixB',
    r: number,
    c: number,
    val: number
  ) => {
    setAlgInput((prev) => {
      const base = (prev[target] || [[0, 0, 0], [0, 0, 0], [0, 0, 0]]).map((row) => [...row]);
      while (base.length < 3) base.push([0, 0, 0]);
      base[r][c] = val;
      return { ...prev, [target]: base };
    });
  };

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="asan-pro-card asan-card-hover rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                Specialized Calculators Suite
              </h2>
              <span className="asan-pro-badge rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                Pro &amp; Admin
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-0.5">
              Deterministic symbolic &amp; numerical engines for Calculus, Coordinate Geometry, Algebra, Vector/3D Geometry, and Trigonometry — works 100% offline.
            </p>
          </div>
          <span className="inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-md bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 whitespace-nowrap shrink-0">
            5 Engines Active
          </span>
        </div>

        {/* 5 Specialized Calculator Tabs */}
        <div className="mt-4 flex flex-wrap gap-2">
          {SUITE_TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold border transition whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                    : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Split: Controls + Output (no nested height traps) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: Interactive Problem Input */}
        <div className="asan-card-hover lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4">
          {activeTab === 'calculus' && (
            <>
              <div>
                <label className={labelCls}>Calculus Operation</label>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ['derivative', 'Derivative'],
                      ['partial', 'Partial (x,y)'],
                      ['indefinite', 'Indefinite ∫'],
                      ['definite', 'Definite ∫ₐᵇ'],
                      ['limit', 'Limit'],
                      ['taylor', 'Taylor Series'],
                      ['extrema', 'Critical / Inflection'],
                    ] as const
                  ).map(([id, lbl]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setCalcInput((p) => ({ ...p, mode: id }))}
                      className={`px-2.5 py-1.5 rounded-md text-xs font-medium border cursor-pointer ${
                        calcInput.mode === id
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className={labelCls}>
                  Function Expression {calcInput.mode === 'partial' ? 'f(x, y)' : 'f(x)'}
                </label>
                <input
                  type="text"
                  value={calcInput.expr}
                  onChange={(e) => setCalcInput((p) => ({ ...p, expr: e.target.value }))}
                  placeholder="e.g. x^3 * sin(x) + ln(x)"
                  className={inputCls}
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[
                    { label: 'x³sin(x)', expr: 'x^3 * sin(x)', mode: 'derivative' as const },
                    { label: 'xe^(2x)', expr: 'x * exp(2x)', mode: 'indefinite' as const },
                    { label: 'e^(-x²) Gauss', expr: 'exp(-x^2)', mode: 'definite' as const, lb: '-inf', ub: 'inf' },
                    { label: 'sin(3x)/x', expr: 'sin(3x)/x', mode: 'limit' as const, px: '0' },
                    { label: 'x²y + sin(xy)', expr: 'x^2 * y + sin(x*y)', mode: 'partial' as const },
                  ].map((ex) => (
                    <button
                      key={ex.label}
                      type="button"
                      onClick={() =>
                        setCalcInput((p) => ({
                          ...p,
                          mode: ex.mode,
                          expr: ex.expr,
                          ...(ex.lb ? { lowerBound: ex.lb } : {}),
                          ...(ex.ub ? { upperBound: ex.ub } : {}),
                          ...(ex.px !== undefined ? { pointX: ex.px } : {}),
                        }))
                      }
                      className="text-[11px] px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-blue-400 cursor-pointer"
                    >
                      {ex.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {calcInput.mode !== 'partial' && (
                  <div>
                    <label className={labelCls}>Variable</label>
                    <input
                      type="text"
                      value={calcInput.variable || 'x'}
                      onChange={(e) => setCalcInput((p) => ({ ...p, variable: e.target.value || 'x' }))}
                      className={inputCls}
                    />
                  </div>
                )}

                {calcInput.mode === 'derivative' && (
                  <>
                    <NumField
                      label="Derivative Order (1–6)"
                      value={calcInput.order || 1}
                      step="1"
                      onChange={(n) => setCalcInput((p) => ({ ...p, order: Math.max(1, Math.min(6, Math.round(n))) }))}
                    />
                    <div className="sm:col-span-2">
                      <label className={labelCls}>Evaluate Tangent &amp; Value at x₀ (optional, e.g. pi/2 or 2)</label>
                      <input
                        type="text"
                        value={calcInput.pointX || ''}
                        onChange={(e) => setCalcInput((p) => ({ ...p, pointX: e.target.value }))}
                        placeholder="Leave blank or enter x0"
                        className={inputCls}
                      />
                    </div>
                  </>
                )}

                {calcInput.mode === 'partial' && (
                  <>
                    <div>
                      <label className={labelCls}>Point x₀ (optional)</label>
                      <input
                        type="text"
                        value={calcInput.pointX || ''}
                        onChange={(e) => setCalcInput((p) => ({ ...p, pointX: e.target.value }))}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Point y₀ (optional)</label>
                      <input
                        type="text"
                        value={calcInput.pointY || ''}
                        onChange={(e) => setCalcInput((p) => ({ ...p, pointY: e.target.value }))}
                        className={inputCls}
                      />
                    </div>
                  </>
                )}

                {(calcInput.mode === 'definite' || calcInput.mode === 'extrema') && (
                  <>
                    <div>
                      <label className={labelCls}>Lower Bound (supports -inf, pi)</label>
                      <input
                        type="text"
                        value={calcInput.lowerBound || '0'}
                        onChange={(e) => setCalcInput((p) => ({ ...p, lowerBound: e.target.value }))}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Upper Bound (supports inf, pi)</label>
                      <input
                        type="text"
                        value={calcInput.upperBound || '1'}
                        onChange={(e) => setCalcInput((p) => ({ ...p, upperBound: e.target.value }))}
                        className={inputCls}
                      />
                    </div>
                  </>
                )}

                {calcInput.mode === 'limit' && (
                  <>
                    <div>
                      <label className={labelCls}>Approach Point c (or inf / -inf)</label>
                      <input
                        type="text"
                        value={calcInput.pointX || '0'}
                        onChange={(e) => setCalcInput((p) => ({ ...p, pointX: e.target.value }))}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Direction</label>
                      <select
                        value={calcInput.limitDirection || 'both'}
                        onChange={(e) =>
                          setCalcInput((p) => ({
                            ...p,
                            limitDirection: e.target.value as 'both' | 'left' | 'right',
                          }))
                        }
                        className={inputCls}
                      >
                        <option value="both">Two-Sided (LHL &amp; RHL)</option>
                        <option value="left">Left-Hand (c⁻)</option>
                        <option value="right">Right-Hand (c⁺)</option>
                      </select>
                    </div>
                  </>
                )}

                {calcInput.mode === 'taylor' && (
                  <>
                    <div>
                      <label className={labelCls}>Expansion Center a (0 for Maclaurin)</label>
                      <input
                        type="text"
                        value={calcInput.pointX || '0'}
                        onChange={(e) => setCalcInput((p) => ({ ...p, pointX: e.target.value }))}
                        className={inputCls}
                      />
                    </div>
                    <NumField
                      label="Degree (1–8)"
                      value={calcInput.taylorDegree || 5}
                      step="1"
                      onChange={(n) => setCalcInput((p) => ({ ...p, taylorDegree: Math.max(1, Math.min(8, Math.round(n))) }))}
                    />
                  </>
                )}
              </div>
            </>
          )}

          {activeTab === 'coordinate' && (
            <>
              <div>
                <label className={labelCls}>Coordinate Geometry Module</label>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ['two-points', '2 Points & Section'],
                      ['line-relations', '2 Lines & Reflection'],
                      ['triangle', 'Triangle Centers'],
                      ['circle', 'Circle'],
                      ['conic', 'Conic Classifier'],
                    ] as const
                  ).map(([id, lbl]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setCoordInput((p) => ({ ...p, mode: id }))}
                      className={`px-2.5 py-1.5 rounded-md text-xs font-medium border cursor-pointer ${
                        coordInput.mode === id
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              {coordInput.mode === 'two-points' && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <NumField label="x₁" value={coordInput.x1 ?? 1} onChange={(n) => setCoordInput((p) => ({ ...p, x1: n }))} />
                  <NumField label="y₁" value={coordInput.y1 ?? 2} onChange={(n) => setCoordInput((p) => ({ ...p, y1: n }))} />
                  <NumField label="Ratio m" value={coordInput.ratioM ?? 2} onChange={(n) => setCoordInput((p) => ({ ...p, ratioM: n }))} />
                  <NumField label="x₂" value={coordInput.x2 ?? 5} onChange={(n) => setCoordInput((p) => ({ ...p, x2: n }))} />
                  <NumField label="y₂" value={coordInput.y2 ?? 6} onChange={(n) => setCoordInput((p) => ({ ...p, y2: n }))} />
                  <NumField label="Ratio n" value={coordInput.ratioN ?? 1} onChange={(n) => setCoordInput((p) => ({ ...p, ratioN: n }))} />
                </div>
              )}

              {coordInput.mode === 'line-relations' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <NumField label="Line 1: a₁" value={coordInput.a1 ?? 2} onChange={(n) => setCoordInput((p) => ({ ...p, a1: n }))} />
                    <NumField label="b₁" value={coordInput.b1 ?? -3} onChange={(n) => setCoordInput((p) => ({ ...p, b1: n }))} />
                    <NumField label="c₁" value={coordInput.c1 ?? 5} onChange={(n) => setCoordInput((p) => ({ ...p, c1: n }))} />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <NumField label="Line 2: a₂" value={coordInput.a2 ?? 3} onChange={(n) => setCoordInput((p) => ({ ...p, a2: n }))} />
                    <NumField label="b₂" value={coordInput.b2 ?? 2} onChange={(n) => setCoordInput((p) => ({ ...p, b2: n }))} />
                    <NumField label="c₂" value={coordInput.c2 ?? -6} onChange={(n) => setCoordInput((p) => ({ ...p, c2: n }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumField label="Test Point P x₀ (Foot/Mirror)" value={coordInput.x1 ?? 1} onChange={(n) => setCoordInput((p) => ({ ...p, x1: n }))} />
                    <NumField label="Test Point P y₀" value={coordInput.y1 ?? 2} onChange={(n) => setCoordInput((p) => ({ ...p, y1: n }))} />
                  </div>
                </div>
              )}

              {coordInput.mode === 'triangle' && (
                <div className="grid grid-cols-2 gap-3">
                  <NumField label="Vertex A: x₁" value={coordInput.x1 ?? 0} onChange={(n) => setCoordInput((p) => ({ ...p, x1: n }))} />
                  <NumField label="Vertex A: y₁" value={coordInput.y1 ?? 0} onChange={(n) => setCoordInput((p) => ({ ...p, y1: n }))} />
                  <NumField label="Vertex B: x₂" value={coordInput.x2 ?? 6} onChange={(n) => setCoordInput((p) => ({ ...p, x2: n }))} />
                  <NumField label="Vertex B: y₂" value={coordInput.y2 ?? 0} onChange={(n) => setCoordInput((p) => ({ ...p, y2: n }))} />
                  <NumField label="Vertex C: x₃" value={coordInput.x3 ?? 0} onChange={(n) => setCoordInput((p) => ({ ...p, x3: n }))} />
                  <NumField label="Vertex C: y₃" value={coordInput.y3 ?? 8} onChange={(n) => setCoordInput((p) => ({ ...p, y3: n }))} />
                </div>
              )}

              {coordInput.mode === 'circle' && (
                <div className="space-y-3">
                  <div>
                    <label className={labelCls}>Circle Definition</label>
                    <select
                      value={coordInput.circleMode || 'center-radius'}
                      onChange={(e) => setCoordInput((p) => ({ ...p, circleMode: e.target.value as CoordInput['circleMode'] }))}
                      className={inputCls}
                    >
                      <option value="center-radius">Center (h, k) &amp; Radius r</option>
                      <option value="general">General x² + y² + 2gx + 2fy + c = 0</option>
                      <option value="three-points">Passing through 3 Points</option>
                    </select>
                  </div>
                  {(coordInput.circleMode || 'center-radius') === 'center-radius' && (
                    <div className="grid grid-cols-3 gap-2">
                      <NumField label="Center h" value={coordInput.h ?? 2} onChange={(n) => setCoordInput((p) => ({ ...p, h: n }))} />
                      <NumField label="Center k" value={coordInput.k ?? -3} onChange={(n) => setCoordInput((p) => ({ ...p, k: n }))} />
                      <NumField label="Radius r" value={coordInput.r ?? 5} onChange={(n) => setCoordInput((p) => ({ ...p, r: n }))} />
                    </div>
                  )}
                  {coordInput.circleMode === 'general' && (
                    <div className="grid grid-cols-3 gap-2">
                      <NumField label="g (half x-coeff)" value={coordInput.g ?? -2} onChange={(n) => setCoordInput((p) => ({ ...p, g: n }))} />
                      <NumField label="f (half y-coeff)" value={coordInput.f ?? 3} onChange={(n) => setCoordInput((p) => ({ ...p, f: n }))} />
                      <NumField label="c" value={coordInput.cCircle ?? -12} onChange={(n) => setCoordInput((p) => ({ ...p, cCircle: n }))} />
                    </div>
                  )}
                  {coordInput.circleMode === 'three-points' ? (
                    <div className="grid grid-cols-2 gap-2">
                      <NumField label="x₁" value={coordInput.x1 ?? 0} onChange={(n) => setCoordInput((p) => ({ ...p, x1: n }))} />
                      <NumField label="y₁" value={coordInput.y1 ?? 0} onChange={(n) => setCoordInput((p) => ({ ...p, y1: n }))} />
                      <NumField label="x₂" value={coordInput.x2 ?? 4} onChange={(n) => setCoordInput((p) => ({ ...p, x2: n }))} />
                      <NumField label="y₂" value={coordInput.y2 ?? 0} onChange={(n) => setCoordInput((p) => ({ ...p, y2: n }))} />
                      <NumField label="x₃" value={coordInput.x3 ?? 0} onChange={(n) => setCoordInput((p) => ({ ...p, x3: n }))} />
                      <NumField label="y₃" value={coordInput.y3 ?? 3} onChange={(n) => setCoordInput((p) => ({ ...p, y3: n }))} />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <NumField label="Check Tangent/Position Point x₀" value={coordInput.x1 ?? 6} onChange={(n) => setCoordInput((p) => ({ ...p, x1: n }))} />
                      <NumField label="Check Point y₀" value={coordInput.y1 ?? 0} onChange={(n) => setCoordInput((p) => ({ ...p, y1: n }))} />
                    </div>
                  )}
                </div>
              )}

              {coordInput.mode === 'conic' && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 p-3 space-y-2">
                    <label className={labelCls}>
                      Parse Any Circle / Conic Equation String (Auto-fills A, B, C, D, E, F)
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={conicEqText}
                        onChange={(e) => {
                          setConicEqText(e.target.value);
                          setConicEqErr(null);
                        }}
                        placeholder="e.g. 9x^2 + 16y^2 - 36x + 96y + 36 = 0"
                        className={inputCls}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const parsed = extractConicCoeffsFromEquation(conicEqText);
                          if (!parsed) {
                            setConicEqErr('Could not parse quadratic equation in x and y.');
                            return;
                          }
                          setConicEqErr(null);
                          setCoordInput((p) => ({
                            ...p,
                            conicA: parsed.A,
                            conicB: parsed.B,
                            conicC: parsed.C,
                            conicD: parsed.D,
                            conicE: parsed.E,
                            conicF: parsed.F,
                          }));
                        }}
                        className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
                      >
                        Parse Equation
                      </button>
                    </div>
                    {conicEqErr && (
                      <div className="text-[11px] text-red-600 dark:text-red-400">{conicEqErr}</div>
                    )}
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {[
                        { label: 'Ellipse', eq: '9x^2 + 16y^2 - 36x + 96y + 36 = 0' },
                        { label: 'Parabola', eq: 'y^2 - 4y - 8x + 20 = 0' },
                        { label: 'Hyperbola', eq: '9x^2 - 16y^2 - 18x - 64y - 199 = 0' },
                        { label: 'Circle', eq: 'x^2 + y^2 - 4x + 6y - 12 = 0' },
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => {
                            setConicEqText(preset.eq);
                            const parsed = extractConicCoeffsFromEquation(preset.eq);
                            if (parsed) {
                              setConicEqErr(null);
                              setCoordInput((p) => ({
                                ...p,
                                conicA: parsed.A,
                                conicB: parsed.B,
                                conicC: parsed.C,
                                conicD: parsed.D,
                                conicE: parsed.E,
                                conicF: parsed.F,
                              }));
                            }
                          }}
                          className="text-[11px] px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-blue-400"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Or enter coefficients directly: Ax² + Bxy + Cy² + Dx + Ey + F = 0
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <NumField label="A (x²)" value={coordInput.conicA ?? 1} onChange={(n) => setCoordInput((p) => ({ ...p, conicA: n }))} />
                    <NumField label="B (xy)" value={coordInput.conicB ?? 0} onChange={(n) => setCoordInput((p) => ({ ...p, conicB: n }))} />
                    <NumField label="C (y²)" value={coordInput.conicC ?? 4} onChange={(n) => setCoordInput((p) => ({ ...p, conicC: n }))} />
                    <NumField label="D (x)" value={coordInput.conicD ?? -6} onChange={(n) => setCoordInput((p) => ({ ...p, conicD: n }))} />
                    <NumField label="E (y)" value={coordInput.conicE ?? 16} onChange={(n) => setCoordInput((p) => ({ ...p, conicE: n }))} />
                    <NumField label="F (const)" value={coordInput.conicF ?? 9} onChange={(n) => setCoordInput((p) => ({ ...p, conicF: n }))} />
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'algebra' && (
            <>
              <div>
                <label className={labelCls}>Algebra Module</label>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ['polynomial', 'Equation Solver'],
                      ['system', 'Linear Systems'],
                      ['inequality', 'Inequalities'],
                      ['matrix', 'Matrices'],
                      ['complex', 'Complex Numbers'],
                      ['progressions', 'AP / GP / nCr'],
                    ] as const
                  ).map(([id, lbl]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setAlgInput((p) => ({ ...p, mode: id }))}
                      className={`px-2.5 py-1.5 rounded-md text-xs font-medium border cursor-pointer ${
                        algInput.mode === id
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              {algInput.mode === 'polynomial' && (
                <div>
                  <label className={labelCls}>Polynomial Equation (up to degree 6, real + complex roots)</label>
                  <input
                    type="text"
                    value={algInput.equation || ''}
                    onChange={(e) => setAlgInput((p) => ({ ...p, equation: e.target.value }))}
                    placeholder="e.g. x^3 - 6x^2 + 11x - 6 = 0"
                    className={inputCls}
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {['x^2 + 2x + 5 = 0', 'x^3 - 6x^2 + 11x - 6 = 0', 'x^4 - 5x^2 + 4 = 0'].map((eq) => (
                      <button
                        key={eq}
                        type="button"
                        onClick={() => setAlgInput((p) => ({ ...p, equation: eq }))}
                        className="text-[11px] px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                      >
                        {eq}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {algInput.mode === 'system' && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    {([2, 3] as const).map((sz) => (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => setAlgInput((p) => ({ ...p, sysSize: sz }))}
                        className={`px-3 py-1 rounded text-xs font-semibold border cursor-pointer ${
                          (algInput.sysSize || 2) === sz
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {sz}×{sz} System
                      </button>
                    ))}
                  </div>
                  {Array.from({ length: algInput.sysSize || 2 }, (_, r) => (
                    <div key={r} className="grid grid-cols-4 gap-2 items-end">
                      {Array.from({ length: algInput.sysSize || 2 }, (__, c) => (
                        <NumField
                          key={c}
                          label={['x', 'y', 'z'][c]}
                          value={algInput.matrixA?.[r]?.[c] ?? 0}
                          onChange={(n) => updateMatrixCell('matrixA', r, c, n)}
                        />
                      ))}
                      <NumField
                        label="= RHS"
                        value={algInput.vectorB?.[r] ?? 0}
                        onChange={(n) =>
                          setAlgInput((p) => {
                            const vb = [...(p.vectorB || [0, 0, 0])];
                            vb[r] = n;
                            return { ...p, vectorB: vb };
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              )}

              {algInput.mode === 'inequality' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <NumField label="a (x²)" value={algInput.ineqA ?? 1} onChange={(n) => setAlgInput((p) => ({ ...p, ineqA: n }))} />
                  <NumField label="b (x)" value={algInput.ineqB ?? -5} onChange={(n) => setAlgInput((p) => ({ ...p, ineqB: n }))} />
                  <NumField label="c (const)" value={algInput.ineqC ?? 6} onChange={(n) => setAlgInput((p) => ({ ...p, ineqC: n }))} />
                  <div>
                    <label className={labelCls}>Operator (vs 0)</label>
                    <select
                      value={algInput.ineqOp || '>='}
                      onChange={(e) => setAlgInput((p) => ({ ...p, ineqOp: e.target.value as AlgebraInput['ineqOp'] }))}
                      className={inputCls}
                    >
                      <option value=">">&gt; 0</option>
                      <option value=">=">&ge; 0</option>
                      <option value="<">&lt; 0</option>
                      <option value="<=">&le; 0</option>
                    </select>
                  </div>
                </div>
              )}

              {algInput.mode === 'matrix' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <select
                      value={algInput.matrixSize || 2}
                      onChange={(e) => setAlgInput((p) => ({ ...p, matrixSize: Number(e.target.value) as 2 | 3 }))}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    >
                      <option value={2}>2 × 2 Matrix</option>
                      <option value={3}>3 × 3 Matrix</option>
                    </select>
                    <select
                      value={algInput.matrixOp || 'det-inv'}
                      onChange={(e) => setAlgInput((p) => ({ ...p, matrixOp: e.target.value as AlgebraInput['matrixOp'] }))}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    >
                      <option value="det-inv">det(A), A⁻¹, Aᵀ, Trace</option>
                      <option value="mul">Multiply (A × B)</option>
                      <option value="add">Add (A + B)</option>
                      <option value="sub">Subtract (A - B)</option>
                    </select>
                  </div>

                  <div>
                    <div className={labelCls}>Matrix A</div>
                    <div className="space-y-1.5">
                      {Array.from({ length: algInput.matrixSize || 2 }, (_, r) => (
                        <div key={r} className={`grid gap-2 ${(algInput.matrixSize || 2) === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                          {Array.from({ length: algInput.matrixSize || 2 }, (__, c) => (
                            <input
                              key={c}
                              type="number"
                              step="any"
                              value={algInput.matrixA?.[r]?.[c] ?? 0}
                              onChange={(e) => updateMatrixCell('matrixA', r, c, parseFloat(e.target.value) || 0)}
                              className={inputCls}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>

                  {(algInput.matrixOp || 'det-inv') !== 'det-inv' && (
                    <div>
                      <div className={labelCls}>Matrix B</div>
                      <div className="space-y-1.5">
                        {Array.from({ length: algInput.matrixSize || 2 }, (_, r) => (
                          <div key={r} className={`grid gap-2 ${(algInput.matrixSize || 2) === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                            {Array.from({ length: algInput.matrixSize || 2 }, (__, c) => (
                              <input
                                key={c}
                                type="number"
                                step="any"
                                value={algInput.matrixB?.[r]?.[c] ?? 0}
                                onChange={(e) => updateMatrixCell('matrixB', r, c, parseFloat(e.target.value) || 0)}
                                className={inputCls}
                              />
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {algInput.mode === 'complex' && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <NumField label="z₁ Real" value={algInput.c1Re ?? 3} onChange={(n) => setAlgInput((p) => ({ ...p, c1Re: n }))} />
                  <NumField label="z₁ Imag" value={algInput.c1Im ?? 4} onChange={(n) => setAlgInput((p) => ({ ...p, c1Im: n }))} />
                  <NumField label="Power / Root n" value={algInput.complexN ?? 3} step="1" onChange={(n) => setAlgInput((p) => ({ ...p, complexN: n }))} />
                  <NumField label="z₂ Real" value={algInput.c2Re ?? 1} onChange={(n) => setAlgInput((p) => ({ ...p, c2Re: n }))} />
                  <NumField label="z₂ Imag" value={algInput.c2Im ?? -2} onChange={(n) => setAlgInput((p) => ({ ...p, c2Im: n }))} />
                </div>
              )}

              {algInput.mode === 'progressions' && (
                <div className="space-y-3">
                  <div>
                    <label className={labelCls}>Series / Combinatorics Type</label>
                    <select
                      value={algInput.progType || 'AP'}
                      onChange={(e) => setAlgInput((p) => ({ ...p, progType: e.target.value as AlgebraInput['progType'] }))}
                      className={inputCls}
                    >
                      <option value="AP">Arithmetic Progression (AP)</option>
                      <option value="GP">Geometric Progression (GP)</option>
                      <option value="HP">Harmonic Progression (HP)</option>
                      <option value="COMB">Permutations &amp; Combinations (nPr / nCr)</option>
                    </select>
                  </div>
                  {algInput.progType === 'COMB' ? (
                    <div className="grid grid-cols-2 gap-3">
                      <NumField label="n" value={algInput.combN ?? 10} step="1" onChange={(n) => setAlgInput((p) => ({ ...p, combN: n }))} />
                      <NumField label="r" value={algInput.combR ?? 3} step="1" onChange={(n) => setAlgInput((p) => ({ ...p, combR: n }))} />
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      <NumField label="First Term a" value={algInput.firstTerm ?? 2} onChange={(n) => setAlgInput((p) => ({ ...p, firstTerm: n }))} />
                      <NumField label={algInput.progType === 'GP' ? 'Ratio r' : 'Diff d'} value={algInput.diffOrRatio ?? 3} onChange={(n) => setAlgInput((p) => ({ ...p, diffOrRatio: n }))} />
                      <NumField label="Terms n" value={algInput.termCount ?? 10} step="1" onChange={(n) => setAlgInput((p) => ({ ...p, termCount: n }))} />
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {activeTab === 'vector3d' && (
            <>
              <div>
                <label className={labelCls}>Vector &amp; 3D Geometry Module</label>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ['vector-ops', 'Vector Ops & Triple Products'],
                      ['line-3d', '3D Lines (Skew/Intersect)'],
                      ['plane-3d', '3D Planes & Reflection'],
                    ] as const
                  ).map(([id, lbl]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setVecInput((p) => ({ ...p, mode: id }))}
                      className={`px-2.5 py-1.5 rounded-md text-xs font-medium border cursor-pointer ${
                        vecInput.mode === id
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              {vecInput.mode === 'vector-ops' && (
                <div className="space-y-3">
                  <Vec3Field label="Vector a" value={vecInput.vecA || [2, -1, 3]} onChange={(v) => setVecInput((p) => ({ ...p, vecA: v }))} />
                  <Vec3Field label="Vector b" value={vecInput.vecB || [1, 4, -2]} onChange={(v) => setVecInput((p) => ({ ...p, vecB: v }))} />
                  <Vec3Field label="Vector c (for Triple Products)" value={vecInput.vecC || [0, 1, 2]} onChange={(v) => setVecInput((p) => ({ ...p, vecC: v }))} />
                </div>
              )}

              {vecInput.mode === 'line-3d' && (
                <div className="space-y-3">
                  <Vec3Field label="Line 1 Point r₁" value={vecInput.p1 || [1, 1, 0]} onChange={(v) => setVecInput((p) => ({ ...p, p1: v }))} />
                  <Vec3Field label="Line 1 Direction d₁" value={vecInput.d1 || [2, -1, 1]} onChange={(v) => setVecInput((p) => ({ ...p, d1: v }))} />
                  <Vec3Field label="Line 2 Point r₂" value={vecInput.p2 || [2, 1, -1]} onChange={(v) => setVecInput((p) => ({ ...p, p2: v }))} />
                  <Vec3Field label="Line 2 Direction d₂" value={vecInput.d2 || [3, -5, 2]} onChange={(v) => setVecInput((p) => ({ ...p, d2: v }))} />
                  <Vec3Field label="Point P (distance to L₁)" value={vecInput.testPoint || [0, 0, 0]} onChange={(v) => setVecInput((p) => ({ ...p, testPoint: v }))} />
                </div>
              )}

              {vecInput.mode === 'plane-3d' && (
                <div className="space-y-3">
                  <div>
                    <label className={labelCls}>Plane Definition</label>
                    <select
                      value={vecInput.planeMode || 'three-points'}
                      onChange={(e) => setVecInput((p) => ({ ...p, planeMode: e.target.value as Vector3DInput['planeMode'] }))}
                      className={inputCls}
                    >
                      <option value="three-points">Through 3 Points P, Q, R</option>
                      <option value="point-normal">Point P₀ &amp; Normal Vector n</option>
                      <option value="general">General ax + by + cz + d = 0</option>
                    </select>
                  </div>

                  {(vecInput.planeMode || 'three-points') === 'three-points' && (
                    <>
                      <Vec3Field label="Point P" value={vecInput.p1 || [1, 0, 0]} onChange={(v) => setVecInput((p) => ({ ...p, p1: v }))} />
                      <Vec3Field label="Point Q" value={vecInput.p2 || [0, 2, 0]} onChange={(v) => setVecInput((p) => ({ ...p, p2: v }))} />
                      <Vec3Field label="Point R" value={vecInput.p3 || [0, 0, 3]} onChange={(v) => setVecInput((p) => ({ ...p, p3: v }))} />
                    </>
                  )}
                  {vecInput.planeMode === 'point-normal' && (
                    <>
                      <Vec3Field label="Point P₀" value={vecInput.p1 || [1, -2, 3]} onChange={(v) => setVecInput((p) => ({ ...p, p1: v }))} />
                      <Vec3Field label="Normal Vector n" value={vecInput.d1 || [2, 3, -1]} onChange={(v) => setVecInput((p) => ({ ...p, d1: v }))} />
                    </>
                  )}
                  {vecInput.planeMode === 'general' && (
                    <div className="grid grid-cols-4 gap-2">
                      {(['a', 'b', 'c', 'd'] as const).map((lbl, idx) => (
                        <NumField
                          key={lbl}
                          label={lbl}
                          value={(vecInput.plane1 || [2, -1, 2, -6])[idx]}
                          onChange={(n) =>
                            setVecInput((p) => {
                              const next: [number, number, number, number] = [...(p.plane1 || [2, -1, 2, -6])] as [number, number, number, number];
                              next[idx] = n;
                              return { ...p, plane1: next };
                            })
                          }
                        />
                      ))}
                    </div>
                  )}

                  <Vec3Field label="Test Point P (Distance / Foot / Reflection)" value={vecInput.testPoint || [1, 2, 3]} onChange={(v) => setVecInput((p) => ({ ...p, testPoint: v }))} />
                </div>
              )}
            </>
          )}

          {activeTab === 'trigonometry' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ['evaluate', 'Ratios & Exact'],
                      ['triangle', 'Triangle Solver'],
                      ['equation', 'Trig Equation'],
                      ['conversions', 'DMS / Polar'],
                    ] as const
                  ).map(([id, lbl]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTrigInput((p) => ({ ...p, mode: id }))}
                      className={`px-2.5 py-1.5 rounded-md text-xs font-medium border cursor-pointer ${
                        trigInput.mode === id
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>

                <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                  {(['deg', 'rad'] as const).map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setTrigInput((p) => ({ ...p, angleUnit: u }))}
                      className={`px-2.5 py-1 text-xs font-semibold uppercase cursor-pointer ${
                        (trigInput.angleUnit || 'deg') === u
                          ? 'bg-blue-600 text-white'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>

              {trigInput.mode === 'evaluate' && (
                <div>
                  <label className={labelCls}>Angle Expression ({trigInput.angleUnit === 'rad' ? 'Radians, e.g. pi/6' : 'Degrees, e.g. 15, 75, 225'})</label>
                  <input
                    type="text"
                    value={trigInput.angleExpr || ''}
                    onChange={(e) => setTrigInput((p) => ({ ...p, angleExpr: e.target.value }))}
                    className={inputCls}
                  />
                </div>
              )}

              {trigInput.mode === 'triangle' && (
                <div className="space-y-3">
                  <div>
                    <label className={labelCls}>Given Triangle Configuration</label>
                    <select
                      value={trigInput.triCase || 'SSA'}
                      onChange={(e) => setTrigInput((p) => ({ ...p, triCase: e.target.value as TrigInput['triCase'] }))}
                      className={inputCls}
                    >
                      <option value="SSS">SSS (3 Sides: a, b, c)</option>
                      <option value="SAS">SAS (Sides a, b &amp; Included Angle C)</option>
                      <option value="ASA">ASA (Angles A, B &amp; Included Side c)</option>
                      <option value="AAS">AAS (Angles A, B &amp; Side a)</option>
                      <option value="SSA">SSA Ambiguous Case (Sides a, b &amp; Angle A)</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(trigInput.triCase === 'SSS' || trigInput.triCase === 'SAS' || trigInput.triCase === 'AAS' || trigInput.triCase === 'SSA') && (
                      <NumField label="Side a" value={trigInput.a ?? 7} onChange={(n) => setTrigInput((p) => ({ ...p, a: n }))} />
                    )}
                    {(trigInput.triCase === 'SSS' || trigInput.triCase === 'SAS' || trigInput.triCase === 'SSA') && (
                      <NumField label="Side b" value={trigInput.b ?? 10} onChange={(n) => setTrigInput((p) => ({ ...p, b: n }))} />
                    )}
                    {(trigInput.triCase === 'SSS' || trigInput.triCase === 'ASA') && (
                      <NumField label="Side c" value={trigInput.c ?? 8} onChange={(n) => setTrigInput((p) => ({ ...p, c: n }))} />
                    )}
                    {(trigInput.triCase === 'ASA' || trigInput.triCase === 'AAS' || trigInput.triCase === 'SSA') && (
                      <NumField label="Angle A" value={trigInput.A ?? 30} onChange={(n) => setTrigInput((p) => ({ ...p, A: n }))} />
                    )}
                    {(trigInput.triCase === 'ASA' || trigInput.triCase === 'AAS') && (
                      <NumField label="Angle B" value={trigInput.B ?? 65} onChange={(n) => setTrigInput((p) => ({ ...p, B: n }))} />
                    )}
                    {trigInput.triCase === 'SAS' && (
                      <NumField label="Angle C" value={trigInput.C ?? 60} onChange={(n) => setTrigInput((p) => ({ ...p, C: n }))} />
                    )}
                  </div>
                </div>
              )}

              {trigInput.mode === 'equation' && (
                <div>
                  <label className={labelCls}>Trig Equation in x</label>
                  <input
                    type="text"
                    value={trigInput.equation || ''}
                    onChange={(e) => setTrigInput((p) => ({ ...p, equation: e.target.value }))}
                    placeholder="e.g. 2sin(x) - 1 = 0"
                    className={inputCls}
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {['2sin(x) - 1 = 0', 'sin(x)^2 - cos(x) = 0.5', 'tan(2x) = 1'].map((eq) => (
                      <button
                        key={eq}
                        type="button"
                        onClick={() => setTrigInput((p) => ({ ...p, equation: eq }))}
                        className="text-[11px] px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                      >
                        {eq}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {trigInput.mode === 'conversions' && (
                <div className="space-y-3">
                  <div>
                    <label className={labelCls}>Conversion Mode</label>
                    <select
                      value={trigInput.convType || 'deg-rad-dms'}
                      onChange={(e) => setTrigInput((p) => ({ ...p, convType: e.target.value as TrigInput['convType'] }))}
                      className={inputCls}
                    >
                      <option value="deg-rad-dms">Angle → Deg / Rad / DMS / Grad</option>
                      <option value="polar-to-cart">Polar (r, θ) → Cartesian (x, y)</option>
                      <option value="cart-to-polar">Cartesian (x, y) → Polar (r, θ)</option>
                    </select>
                  </div>
                  {(trigInput.convType || 'deg-rad-dms') === 'deg-rad-dms' ? (
                    <NumField
                      label={`Angle (${trigInput.angleUnit === 'rad' ? 'Radians' : 'Degrees'})`}
                      value={trigInput.convX ?? 45.5}
                      onChange={(n) => setTrigInput((p) => ({ ...p, convX: n }))}
                    />
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <NumField
                        label={trigInput.convType === 'polar-to-cart' ? 'Radius r' : 'x'}
                        value={trigInput.convX ?? 5}
                        onChange={(n) => setTrigInput((p) => ({ ...p, convX: n }))}
                      />
                      <NumField
                        label={trigInput.convType === 'polar-to-cart' ? `Angle θ (${trigInput.angleUnit || 'deg'})` : 'y'}
                        value={trigInput.convY ?? 53.13}
                        onChange={(n) => setTrigInput((p) => ({ ...p, convY: n }))}
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Right: Structured Output & Derivation Steps */}
        <div className="lg:col-span-6">
          <ResultCard result={activeResult} />
        </div>
      </div>
    </div>
  );
}
