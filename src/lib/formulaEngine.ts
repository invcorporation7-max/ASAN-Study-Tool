import type { FormulaEquationItem, FormulaSymbolDef } from '../types.ts';

// Deterministic Math & Parameter-Matching Equation Solver (Zero eval / Zero new Function)

export type FormulaAst =
  | { type: 'num'; value: number }
  | { type: 'var'; name: string }
  | { type: 'const'; name: 'pi' | 'e' }
  | { type: 'neg'; arg: FormulaAst }
  | { type: 'bin'; op: '+' | '-' | '*' | '/' | '^'; left: FormulaAst; right: FormulaAst }
  | { type: 'fn'; name: string; arg: FormulaAst };

type Tok =
  | { type: 'num'; value: number }
  | { type: 'id'; value: string }
  | { type: 'op'; value: '+' | '-' | '*' | '/' | '^' }
  | { type: 'lparen' }
  | { type: 'rparen' };

const MATH_FUNCS = new Set([
  'sin',
  'cos',
  'tan',
  'csc',
  'sec',
  'cot',
  'asin',
  'acos',
  'atan',
  'arcsin',
  'arccos',
  'arctan',
  'sinh',
  'cosh',
  'tanh',
  'ln',
  'log',
  'log10',
  'exp',
  'sqrt',
  'cbrt',
  'abs',
]);

const RESERVED_CONSTANTS = new Set(['pi', 'e']);

function normFn(raw: string): string {
  const l = raw.toLowerCase();
  if (l === 'arcsin') return 'asin';
  if (l === 'arccos') return 'acos';
  if (l === 'arctan') return 'atan';
  return l;
}

export function fmtCalcNumber(n: number, digits = 6): string {
  if (!Number.isFinite(n)) {
    if (Number.isNaN(n)) return 'Undefined';
    return n > 0 ? '+∞' : '-∞';
  }
  const clean = Math.abs(n) < 1e-10 ? 0 : n;
  if (Math.abs(clean - Math.round(clean)) < 1e-9) {
    return String(Math.round(clean));
  }
  return Number(clean.toPrecision(digits)).toString();
}

function splitCompositeIdentifier(
  rawId: string,
  knownSymbols?: string[]
): string[] {
  if (!knownSymbols || knownSymbols.length === 0) return [rawId];
  const fn = normFn(rawId);
  if (MATH_FUNCS.has(fn) || rawId.toLowerCase() === 'pi') return [rawId];
  if (knownSymbols.includes(rawId)) return [rawId];
  const lowerMatch = knownSymbols.find((s) => s.toLowerCase() === rawId.toLowerCase());
  if (lowerMatch) return [rawId];

  // Greedily decompose e.g. "ut" -> ["u", "t"] or "at" -> ["a", "t"] using knownSymbols
  const sorted = [...knownSymbols]
    .filter((s) => s.length > 0)
    .sort((a, b) => b.length - a.length);

  const parts: string[] = [];
  let idx = 0;
  while (idx < rawId.length) {
    const rest = rawId.slice(idx);
    let matched = sorted.find((s) => rest.startsWith(s));
    if (!matched) {
      matched = sorted.find((s) => rest.toLowerCase().startsWith(s.toLowerCase()));
    }
    if (!matched) return [rawId];
    parts.push(rest.slice(0, matched.length));
    idx += matched.length;
  }
  return parts.length > 1 ? parts : [rawId];
}

export function tokenizeFormula(input: string, knownSymbols?: string[]): Tok[] {
  const src = input
    .replace(/−|–/g, '-')
    .replace(/×|·/g, '*')
    .replace(/÷/g, '/')
    .replace(/π/g, 'pi')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/\*\*/g, '^')
    .trim();

  const raw: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      let dots = 0;
      while (j < src.length && (/[0-9]/.test(src[j]) || (src[j] === '.' && dots === 0))) {
        if (src[j] === '.') dots++;
        j++;
      }
      if (j < src.length && (src[j] === 'e' || src[j] === 'E')) {
        const nextCh = src[j + 1];
        const digitAfter = nextCh === '+' || nextCh === '-' ? src[j + 2] : nextCh;
        if (digitAfter && /[0-9]/.test(digitAfter)) {
          j++;
          if (src[j] === '+' || src[j] === '-') j++;
          while (j < src.length && /[0-9]/.test(src[j])) j++;
        }
      }
      const val = Number(src.slice(i, j));
      if (!Number.isFinite(val)) throw new Error(`Invalid number near "${src.slice(i, j)}"`);
      raw.push({ type: 'num', value: val });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
      const ident = src.slice(i, j);
      const splitIds = splitCompositeIdentifier(ident, knownSymbols);
      for (const part of splitIds) {
        raw.push({ type: 'id', value: part });
      }
      i = j;
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '^') {
      raw.push({ type: 'op', value: ch });
      i++;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      raw.push({ type: 'lparen' });
      i++;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      raw.push({ type: 'rparen' });
      i++;
      continue;
    }
    throw new Error(`Unexpected character "${ch}" in expression`);
  }

  const out: Tok[] = [];
  for (let k = 0; k < raw.length; k++) {
    const cur = raw[k];
    const prev = out[out.length - 1];
    if (prev) {
      const prevEnd =
        prev.type === 'num' ||
        prev.type === 'rparen' ||
        (prev.type === 'id' && !MATH_FUNCS.has(normFn(prev.value)));
      const curStart = cur.type === 'num' || cur.type === 'id' || cur.type === 'lparen';
      const isFnCall =
        prev.type === 'id' &&
        MATH_FUNCS.has(normFn(prev.value)) &&
        cur.type === 'lparen';
      if (prevEnd && curStart && !isFnCall) {
        out.push({ type: 'op', value: '*' });
      }
    }
    out.push(cur);
  }
  return out;
}

export function parseFormulaAst(expr: string, knownSymbols?: string[]): FormulaAst {
  const tokens = tokenizeFormula(expr, knownSymbols);
  if (tokens.length === 0) throw new Error('Expression is empty');
  let pos = 0;
  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];

  function parseAddSub(): FormulaAst {
    let node = parseMulDiv();
    while (peek()?.type === 'op' && ((peek() as { value: string }).value === '+' || (peek() as { value: string }).value === '-')) {
      const op = (consume() as { type: 'op'; value: '+' | '-' }).value;
      node = { type: 'bin', op, left: node, right: parseMulDiv() };
    }
    return node;
  }

  function parseMulDiv(): FormulaAst {
    let node = parseUnary();
    while (peek()?.type === 'op' && ((peek() as { value: string }).value === '*' || (peek() as { value: string }).value === '/')) {
      const op = (consume() as { type: 'op'; value: '*' | '/' }).value;
      node = { type: 'bin', op, left: node, right: parseUnary() };
    }
    return node;
  }

  function parseUnary(): FormulaAst {
    if (peek()?.type === 'op') {
      const op = (peek() as { value: string }).value;
      if (op === '+') {
        consume();
        return parseUnary();
      }
      if (op === '-') {
        consume();
        return { type: 'neg', arg: parseUnary() };
      }
    }
    return parsePow();
  }

  function parsePow(): FormulaAst {
    const base = parsePrimary();
    if (peek()?.type === 'op' && (peek() as { value: string }).value === '^') {
      consume();
      return { type: 'bin', op: '^', left: base, right: parseUnary() };
    }
    return base;
  }

  function parsePrimary(): FormulaAst {
    const t = peek();
    if (!t) throw new Error('Unexpected end of expression');
    if (t.type === 'num') {
      consume();
      return { type: 'num', value: t.value };
    }
    if (t.type === 'lparen') {
      consume();
      const inner = parseAddSub();
      if (peek()?.type !== 'rparen') throw new Error('Missing closing parenthesis ")"');
      consume();
      return inner;
    }
    if (t.type === 'id') {
      consume();
      const rawName = t.value;
      const fnName = normFn(rawName);
      if (MATH_FUNCS.has(fnName)) {
        if (peek()?.type === 'lparen') {
          consume();
          const arg = parseAddSub();
          if (peek()?.type !== 'rparen') throw new Error(`Missing ")" after ${rawName}(...)`);
          consume();
          return { type: 'fn', name: fnName, arg };
        }
        return { type: 'fn', name: fnName, arg: parseUnary() };
      }
      const lower = rawName.toLowerCase();
      if (lower === 'pi') return { type: 'const', name: 'pi' };
      if (lower === 'e' && !tokens.some((tk) => tk.type === 'id' && tk.value === 'e_')) {
        // Keep `e` as mathematical constant Euler's number unless caller explicitly provides `e` in vars
        return { type: 'const', name: 'e' };
      }
      return { type: 'var', name: rawName };
    }
    throw new Error('Invalid syntax in expression');
  }

  const ast = parseAddSub();
  if (pos < tokens.length) throw new Error('Unexpected trailing tokens in expression');
  return ast;
}

export function evalFormulaAst(
  node: FormulaAst,
  vars: Record<string, number>,
  angleUnit: 'rad' | 'deg' = 'rad'
): number {
  const toRad = (v: number) => (angleUnit === 'deg' ? (v * Math.PI) / 180 : v);
  const fromRad = (v: number) => (angleUnit === 'deg' ? (v * 180) / Math.PI : v);

  switch (node.type) {
    case 'num':
      return node.value;
    case 'const':
      if (node.name === 'e' && Object.prototype.hasOwnProperty.call(vars, 'e')) {
        return vars.e;
      }
      return node.name === 'pi' ? Math.PI : Math.E;
    case 'var': {
      if (Object.prototype.hasOwnProperty.call(vars, node.name)) return vars[node.name];
      const lower = node.name.toLowerCase();
      for (const [k, v] of Object.entries(vars)) {
        if (k.toLowerCase() === lower) return v;
      }
      throw new Error(`Missing variable "${node.name}"`);
    }
    case 'neg':
      return -evalFormulaAst(node.arg, vars, angleUnit);
    case 'bin': {
      const l = evalFormulaAst(node.left, vars, angleUnit);
      const r = evalFormulaAst(node.right, vars, angleUnit);
      switch (node.op) {
        case '+':
          return l + r;
        case '-':
          return l - r;
        case '*':
          return l * r;
        case '/':
          return l / r;
        case '^':
          return Math.pow(l, r);
      }
      break;
    }
    case 'fn': {
      const a = evalFormulaAst(node.arg, vars, angleUnit);
      switch (node.name) {
        case 'sin':
          return Math.sin(toRad(a));
        case 'cos':
          return Math.cos(toRad(a));
        case 'tan':
          return Math.tan(toRad(a));
        case 'csc':
          return 1 / Math.sin(toRad(a));
        case 'sec':
          return 1 / Math.cos(toRad(a));
        case 'cot':
          return 1 / Math.tan(toRad(a));
        case 'asin':
          return fromRad(Math.asin(a));
        case 'acos':
          return fromRad(Math.acos(a));
        case 'atan':
          return fromRad(Math.atan(a));
        case 'sinh':
          return Math.sinh(a);
        case 'cosh':
          return Math.cosh(a);
        case 'tanh':
          return Math.tanh(a);
        case 'ln':
          return Math.log(a);
        case 'log':
          return Math.log(a);
        case 'log10':
          return Math.log10(a);
        case 'exp':
          return Math.exp(a);
        case 'sqrt':
          return Math.sqrt(a);
        case 'cbrt':
          return Math.cbrt(a);
        case 'abs':
          return Math.abs(a);
        default:
          throw new Error(`Unsupported function "${node.name}"`);
      }
    }
  }
  return Number.NaN;
}

export function extractEquationSymbols(expression: string): string[] {
  const parts = expression.split('=');
  const found = new Set<string>();
  for (const part of parts) {
    if (!part.trim()) continue;
    try {
      const tokens = tokenizeFormula(part);
      for (const tok of tokens) {
        if (tok.type === 'id') {
          const fn = normFn(tok.value);
          if (MATH_FUNCS.has(fn)) continue;
          if (RESERVED_CONSTANTS.has(tok.value.toLowerCase())) continue;
          found.add(tok.value);
        }
      }
    } catch {
      // ignore partial typing
    }
  }
  return Array.from(found);
}

// ============================================================================
// SEMANTIC PARAMETER MATCHER + HYBRID NUMERIC ROOT SOLVER
// ============================================================================

const STOP_WORDS = new Set([
  'of',
  'the',
  'a',
  'an',
  'in',
  'on',
  'for',
  'to',
  'and',
  'with',
  'value',
  'parameter',
  'find',
  'calculate',
  'compute',
  'get',
]);

const SYNONYM_MAP: Record<string, string> = {
  vel: 'velocity',
  speed: 'velocity',
  init: 'initial',
  u: 'initial velocity',
  v: 'final velocity',
  acc: 'acceleration',
  accel: 'acceleration',
  dist: 'distance',
  disp: 'displacement',
  rad: 'radius',
  diam: 'diameter',
  temp: 'temperature',
  press: 'pressure',
  vol: 'volume',
  curr: 'current',
  volt: 'voltage',
  potential: 'voltage',
  res: 'resistance',
  ke: 'kinetic energy',
  pe: 'potential energy',
  freq: 'frequency',
  len: 'length',
  eqn: 'equation',
  eq: 'equation',
  ecc: 'eccentricity',
  lr: 'latus rectum',
  maj: 'major',
  min: 'minor',
  dir: 'directrix',
  asym: 'asymptote',
  asymp: 'asymptote',
  cen: 'center',
  centre: 'center',
};

export function normalizeSemanticText(text: string): string {
  const rawTokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const filtered =
    rawTokens.length > 1
      ? rawTokens.filter((w) => !STOP_WORDS.has(w))
      : rawTokens;
  return filtered
    .map((w) => SYNONYM_MAP[w] || w)
    .join(' ')
    .trim();
}

export function scoreMeaningMatch(userDesc: string, symbolDef: FormulaSymbolDef, userSymbolHint?: string): number {
  const hint = (userSymbolHint || '').trim();
  const rawDesc = (userDesc || '').trim();
  if (hint) {
    if (hint === symbolDef.symbol) return 100;
    if (hint.toLowerCase() === symbolDef.symbol.toLowerCase()) return 96;
    // If user explicitly provided a symbol identifier (e.g. `t`) and the target symbol is different (e.g. `a`), do not cross-match unless meaning explicitly matches
    if (rawDesc === hint && symbolDef.symbol && hint.length <= 3) {
      return 0;
    }
  }
  if (rawDesc) {
    if (rawDesc === symbolDef.symbol) return 100;
    if (rawDesc.toLowerCase() === symbolDef.symbol.toLowerCase()) return 94;
  }
  const uNorm = normalizeSemanticText(userDesc);
  const sNorm = normalizeSemanticText(symbolDef.meaning);
  if (!uNorm || !sNorm) return 0;
  if (uNorm === sNorm) return 95;
  if (uNorm === symbolDef.symbol.toLowerCase()) return 88;
  // Require at least 3 characters on both sides before substring matching (prevents 'a' matching 'acceleration', 't' matching 'time interval' via 't' in another word, etc.)
  if (
    Math.min(uNorm.length, sNorm.length) >= 3 &&
    (sNorm.includes(uNorm) || uNorm.includes(sNorm))
  ) {
    const ratio = Math.min(uNorm.length, sNorm.length) / Math.max(uNorm.length, sNorm.length);
    return Math.round(62 + ratio * 25);
  }
  const uTokens = new Set(uNorm.split(/\s+/));
  const sTokens = new Set(sNorm.split(/\s+/));
  let overlap = 0;
  for (const t of uTokens) {
    if (sTokens.has(t)) overlap++;
  }
  if (overlap === 0) return 0;
  const union = new Set([...uTokens, ...sTokens]).size;
  return Math.round((overlap / union) * 78);
}

function solveSingleUnknownEquation(
  expression: string,
  knownVars: Record<string, number>,
  unknownSymbol: string,
  angleUnit: 'rad' | 'deg' = 'rad',
  knownSymbols?: string[]
): number | null {
  const parts = expression.split('=');
  if (parts.length !== 2) return null;
  const lhsAst = parseFormulaAst(parts[0], knownSymbols);
  const rhsAst = parseFormulaAst(parts[1], knownSymbols);

  const f = (x: number): number => {
    const env = { ...knownVars, [unknownSymbol]: x };
    const lv = evalFormulaAst(lhsAst, env, angleUnit);
    const rv = evalFormulaAst(rhsAst, env, angleUnit);
    return lv - rv;
  };

  // 1. Check linear fast path: if f(x) = a*x + b everywhere
  try {
    const y0 = f(0);
    const y1 = f(1);
    const y2 = f(2);
    const yNeg = f(-1);
    if (
      Number.isFinite(y0) &&
      Number.isFinite(y1) &&
      Number.isFinite(y2) &&
      Number.isFinite(yNeg)
    ) {
      const slope1 = y1 - y0;
      const slope2 = y2 - y1;
      const slopeNeg = y0 - yNeg;
      if (
        Math.abs(slope1) > 1e-12 &&
        Math.abs(slope1 - slope2) < 1e-7 * Math.max(1, Math.abs(slope1)) &&
        Math.abs(slope1 - slopeNeg) < 1e-7 * Math.max(1, Math.abs(slope1))
      ) {
        const root = -y0 / slope1;
        if (Math.abs(f(root)) < 1e-6) return root;
      }
    }
  } catch {
    // 0 might be singular (e.g. 1/x); continue to multi-interval search
  }

  // 2. Scan sample points across positive and negative scales, preferring natural positive roots first
  const samples = [
    1e-6, 1e-4, 1e-2, 0.05, 0.1, 0.25, 0.5, 1, 1.5, 2, 3, 5, 8, 10, 15, 25, 40, 60,
    100, 200, 500, 1000, 5000, 25000, 100000,
    0, -1e-4, -0.05, -0.25, -0.5, -1, -2, -5, -10, -25, -100, -1000, -25000,
  ];

  const evalSafe = (x: number): number | null => {
    try {
      const v = f(x);
      return Number.isFinite(v) ? v : null;
    } catch {
      return null;
    }
  };

  const bisect = (aIn: number, bIn: number): number | null => {
    let a = aIn;
    let b = bIn;
    let fa = evalSafe(a);
    let fb = evalSafe(b);
    if (fa === null || fb === null) return null;
    if (Math.abs(fa) < 1e-10) return a;
    if (Math.abs(fb) < 1e-10) return b;
    if (fa * fb > 0) return null;
    for (let i = 0; i < 80; i++) {
      const mid = 0.5 * (a + b);
      const fm = evalSafe(mid);
      if (fm === null) break;
      if (Math.abs(fm) < 1e-11 || Math.abs(b - a) < 1e-11) return mid;
      if (fa * fm <= 0) {
        b = mid;
        fb = fm;
      } else {
        a = mid;
        fa = fm;
      }
    }
    return 0.5 * (a + b);
  };

  // Direct hit check
  for (const s of samples) {
    const fs = evalSafe(s);
    if (fs !== null && Math.abs(fs) < 1e-9) return s;
  }

  // Positive brackets first
  const positiveSamples = samples.filter((s) => s > 0).sort((a, b) => a - b);
  for (let i = 0; i < positiveSamples.length - 1; i++) {
    const r = bisect(positiveSamples[i], positiveSamples[i + 1]);
    if (r !== null) return r;
  }

  // Non-positive brackets next
  const negSamples = samples.filter((s) => s <= 0).sort((a, b) => b - a);
  for (let i = 0; i < negSamples.length - 1; i++) {
    const r = bisect(negSamples[i], negSamples[i + 1]);
    if (r !== null) return r;
  }

  // Fallback damped secant from positive seeds
  for (const seed of [1, 10, 0.1, -1, 100]) {
    let x0 = seed;
    let x1 = seed * 1.01 + 0.01;
    for (let iter = 0; iter < 50; iter++) {
      const f0 = evalSafe(x0);
      const f1 = evalSafe(x1);
      if (f0 === null || f1 === null) break;
      if (Math.abs(f1) < 1e-9) return x1;
      const denom = f1 - f0;
      if (Math.abs(denom) < 1e-14) break;
      const step = Math.max(-1e4, Math.min(1e4, (-f1 * (x1 - x0)) / denom));
      const x2 = x1 + step;
      x0 = x1;
      x1 = x2;
    }
    const check = evalSafe(x1);
    if (check !== null && Math.abs(check) < 1e-6) return x1;
  }

  return null;
}

// ============================================================================
// WIDE-RANGE SYMBOLIC & PARAMETER-BASED MATH SOLVER (CIRCLE, CONICS, LINES)
// ============================================================================

export interface UserParamInput {
  description: string;
  value: string;
  unit?: string;
  symbolHint?: string;
}

export interface UserOutputRequest {
  description: string;
  unit?: string;
  symbolHint?: string;
}

export interface SolvedOutputItem {
  requestedDescription: string;
  matchedSymbol: string;
  matchedMeaning: string;
  valueDisplay: string;
  numericValue?: number;
  unit: string;
  formulaTitle: string;
  equationUsed: string;
  steps: string[];
}

export const GEOMETRY_CASE_LABEL = 'Circle & Conic Geometry';

export interface FormulaSolveResponse {
  ok: boolean;
  mode: 'geometry_symbolic' | 'formula_chain' | 'mixed';
  detectedCase?: string;
  caseMode?: 'auto' | 'manual';
  outputs: SolvedOutputItem[];
  unmatchedOutputs: string[];
  derivationSteps: string[];
  warnings: string[];
}

export function parseQuickParamString(raw: string): UserParamInput[] {
  const segments: string[] = [];
  let cur = '';
  let depth = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if ((ch === ')' || ch === ']' || ch === '}') && depth > 0) depth--;
    if ((ch === ',' || ch === ';' || ch === '\n') && depth === 0) {
      if (cur.trim()) segments.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) segments.push(cur.trim());

  const parsed: UserParamInput[] = [];
  for (const seg of segments) {
    const eqIdx = seg.indexOf('=');
    if (eqIdx === -1) continue;
    const lhs = seg.slice(0, eqIdx).trim();
    const rhs = seg.slice(eqIdx + 1).trim();
    if (!lhs || !rhs) continue;
    const isShortSymbol = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(lhs) && lhs.length <= 12;
    parsed.push({
      description: lhs,
      symbolHint: isShortSymbol ? lhs : undefined,
      value: rhs,
    });
  }
  return parsed;
}

function parsePointTuple(raw: string): [number, number] | null {
  const cleaned = raw.replace(/[()[\]{}]/g, '').trim();
  const parts = cleaned.split(/[,;\s]+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const x = evalSimpleConstant(parts[0]);
  const y = evalSimpleConstant(parts[1]);
  if (x === null || y === null) return null;
  return [x, y];
}

function evalSimpleConstant(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const ast = parseFormulaAst(s);
    const val = evalFormulaAst(ast, {});
    return Number.isFinite(val) ? val : null;
  } catch {
    return null;
  }
}

function parseLineCoeff(raw: string): { a: number; b: number; c: number } | null {
  // Parse ax + by + c = 0 (or y = mx + c, x = k, y = k)
  const s = raw.trim();
  if (!s) return null;
  try {
    const parts = s.split('=');
    const expr =
      parts.length === 2 ? `(${parts[0]}) - (${parts[1]})` : parts[0];
    const ast = parseFormulaAst(expr);
    const f = (x: number, y: number) => evalFormulaAst(ast, { x, y });
    const f00 = f(0, 0);
    const f10 = f(1, 0);
    const f01 = f(0, 1);
    const f21 = f(2, 1);
    if (![f00, f10, f01, f21].every(Number.isFinite)) return null;
    const a = f10 - f00;
    const b = f01 - f00;
    const c = f00;
    if (Math.abs(f21 - (2 * a + b + c)) > 1e-6) return null;
    if (Math.abs(a) < 1e-12 && Math.abs(b) < 1e-12) return null;
    return { a, b, c };
  } catch {
    return null;
  }
}

export function extractConicCoeffsFromEquation(raw: string): {
  A: number;
  B: number;
  C: number;
  D: number;
  E: number;
  F: number;
} | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const parts = s.split('=');
    if (parts.length > 2) return null;
    const expr =
      parts.length === 2 ? `(${parts[0]}) - (${parts[1]})` : parts[0];
    const ast = parseFormulaAst(expr);
    const f = (x: number, y: number) => evalFormulaAst(ast, { x, y });
    const F = f(0, 0);
    const f10 = f(1, 0);
    const fm10 = f(-1, 0);
    const f01 = f(0, 1);
    const f0m1 = f(0, -1);
    const f11 = f(1, 1);
    const f22 = f(2, 2);
    if (![F, f10, fm10, f01, f0m1, f11, f22].every(Number.isFinite)) return null;

    // f(x, y) = A x^2 + B x y + C y^2 + D x + E y + F
    const A = 0.5 * (f10 + fm10 - 2 * F);
    const D = 0.5 * (f10 - fm10);
    const C = 0.5 * (f01 + f0m1 - 2 * F);
    const E = 0.5 * (f01 - f0m1);
    const B = f11 - A - C - D - E - F;

    // Verify quadratic identity at test point (2, 2) and (-1.5, 2.5)
    const expected22 = A * 4 + B * 4 + C * 4 + D * 2 + E * 2 + F;
    const testX = -1.5;
    const testY = 2.5;
    const fTest = f(testX, testY);
    const expTest =
      A * testX * testX + B * testX * testY + C * testY * testY + D * testX + E * testY + F;
    if (
      Math.abs(f22 - expected22) > 1e-5 * Math.max(1, Math.abs(f22)) ||
      Math.abs(fTest - expTest) > 1e-5 * Math.max(1, Math.abs(fTest))
    ) {
      return null;
    }
    return { A, B, C, D, E, F };
  } catch {
    return null;
  }
}

function fmtSignedTerm(coeff: number, variable: string, isFirst = false): string {
  if (Math.abs(coeff) < 1e-9) return '';
  const absVal = Math.abs(coeff);
  const coeffStr =
    variable && Math.abs(absVal - 1) < 1e-9 ? '' : fmtCalcNumber(absVal, 5);
  if (isFirst) {
    return `${coeff < 0 ? '-' : ''}${coeffStr}${variable}`;
  }
  return ` ${coeff < 0 ? '-' : '+'} ${coeffStr}${variable}`;
}

function formatLineEq(a: number, b: number, c: number): string {
  if (Math.abs(b) < 1e-10 && Math.abs(a) > 1e-10) {
    return `x = ${fmtCalcNumber(-c / a)}`;
  }
  if (Math.abs(a) < 1e-10 && Math.abs(b) > 1e-10) {
    return `y = ${fmtCalcNumber(-c / b)}`;
  }
  // Normalize sign so a > 0
  let A = a;
  let B = b;
  let C = c;
  if (A < 0) {
    A = -A;
    B = -B;
    C = -C;
  }
  const parts =
    fmtSignedTerm(A, 'x', true) +
    fmtSignedTerm(B, 'y', false) +
    fmtSignedTerm(C, '', false);
  return `${parts.trim()} = 0`;
}

function formatGeneralConicEq(A: number, B: number, C: number, D: number, E: number, F: number): string {
  const terms: { val: number; label: string }[] = [
    { val: A, label: 'x²' },
    { val: B, label: 'xy' },
    { val: C, label: 'y²' },
    { val: D, label: 'x' },
    { val: E, label: 'y' },
    { val: F, label: '' },
  ];
  let out = '';
  for (const t of terms) {
    if (Math.abs(t.val) < 1e-9) continue;
    out += fmtSignedTerm(t.val, t.label, out.length === 0);
  }
  return `${(out || '0').trim()} = 0`;
}

interface GeometryComputedProperties {
  summaryType: string;
  steps: string[];
  fields: Record<string, { label: string; value: string; numeric?: number; equation: string }>;
}

function computeCircleProperties(
  h: number,
  k: number,
  r: number,
  steps: string[]
): GeometryComputedProperties {
  const gCoeff = -2 * h;
  const fCoeff = -2 * k;
  const cCoeff = h * h + k * k - r * r;
  const stdEq = `(x ${h >= 0 ? '-' : '+'} ${fmtCalcNumber(Math.abs(h))})² + (y ${k >= 0 ? '-' : '+'} ${fmtCalcNumber(Math.abs(k))})² = ${fmtCalcNumber(r * r)}`;
  const genEq = formatGeneralConicEq(1, 0, 1, gCoeff, fCoeff, cCoeff);

  const xDisc = h * h - (h * h + k * k - r * r); // = r^2 - k^2
  const yDisc = r * r - h * h;
  const xInterceptLen = xDisc >= 0 ? 2 * Math.sqrt(xDisc) : 0;
  const yInterceptLen = yDisc >= 0 ? 2 * Math.sqrt(yDisc) : 0;

  return {
    summaryType: 'Circle',
    steps,
    fields: {
      classification: { label: 'Classification', value: 'Circle (e = 0)', equation: stdEq },
      equation_circle: { label: 'Equation of Circle (Standard)', value: stdEq, equation: genEq },
      standard_equation: { label: 'Standard Form Equation', value: stdEq, equation: stdEq },
      general_equation: { label: 'General Form Equation', value: genEq, equation: genEq },
      center: { label: 'Center (h, k)', value: `(${fmtCalcNumber(h)}, ${fmtCalcNumber(k)})`, equation: stdEq },
      radius: { label: 'Radius (r)', value: fmtCalcNumber(r), numeric: r, equation: stdEq },
      diameter: { label: 'Diameter (2r)', value: fmtCalcNumber(2 * r), numeric: 2 * r, equation: 'd = 2r' },
      area: { label: 'Area (πr²)', value: fmtCalcNumber(Math.PI * r * r), numeric: Math.PI * r * r, equation: 'A = πr²' },
      circumference: { label: 'Circumference (2πr)', value: fmtCalcNumber(2 * Math.PI * r), numeric: 2 * Math.PI * r, equation: 'C = 2πr' },
      eccentricity: { label: 'Eccentricity (e)', value: '0', numeric: 0, equation: stdEq },
      x_intercept: {
        label: 'Length of x-intercept',
        value: xDisc >= 0 ? fmtCalcNumber(xInterceptLen) : 'Does not intersect x-axis',
        numeric: xDisc >= 0 ? xInterceptLen : undefined,
        equation: '2√(g² - c)',
      },
      y_intercept: {
        label: 'Length of y-intercept',
        value: yDisc >= 0 ? fmtCalcNumber(yInterceptLen) : 'Does not intersect y-axis',
        numeric: yDisc >= 0 ? yInterceptLen : undefined,
        equation: '2√(f² - c)',
      },
    },
  };
}

function computeConicPropertiesFromCoeffs(
  A: number,
  B: number,
  C: number,
  D: number,
  E: number,
  F: number,
  initialSteps: string[]
): GeometryComputedProperties {
  const genEq = formatGeneralConicEq(A, B, C, D, E, F);
  const steps = [...initialSteps, `General quadratic: ${genEq}`];
  const disc = B * B - 4 * A * C;
  const b = B / 2;
  const d = D / 2;
  const e = E / 2;
  const det3 = A * (C * F - e * e) - b * (b * F - d * e) + d * (b * e - C * d);
  steps.push(`Discriminant B² - 4AC = ${fmtCalcNumber(disc)}, Determinant Δ = ${fmtCalcNumber(det3)}.`);

  const fields: GeometryComputedProperties['fields'] = {
    general_equation: { label: 'General Conic Equation', value: genEq, equation: genEq },
  };

  if (Math.abs(det3) < 1e-9 && (Math.abs(A) > 1e-10 || Math.abs(B) > 1e-10 || Math.abs(C) > 1e-10)) {
    const label =
      disc > 1e-9
        ? 'Degenerate Conic: Pair of Intersecting Lines'
        : Math.abs(disc) < 1e-9
          ? 'Degenerate Conic: Parallel or Coincident Lines'
          : 'Degenerate Conic: Single Point';
    fields.classification = { label: 'Conic Classification', value: label, equation: genEq };
    return { summaryType: label, steps, fields };
  }

  // Rotation angle to eliminate Bxy term
  const theta =
    Math.abs(B) < 1e-11
      ? 0
      : Math.abs(A - C) < 1e-11
        ? B > 0
          ? Math.PI / 4
          : -Math.PI / 4
        : 0.5 * Math.atan2(B, A - C);
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  // Transform point (u, v) in rotated axes back to (x, y): x = u cos - v sin, y = u sin + v cos
  const toXY = (u: number, v: number): [number, number] => [
    u * cosT - v * sinT,
    u * sinT + v * cosT,
  ];
  // Transform line l_u * u + l_v * v + l_c = 0 back to a x + b y + c = 0
  const lineToXY = (lu: number, lv: number, lc: number): string =>
    formatLineEq(lu * cosT - lv * sinT, lu * sinT + lv * cosT, lc);

  const A1 = A * cosT * cosT + B * cosT * sinT + C * sinT * sinT;
  const C1 = A * sinT * sinT - B * cosT * sinT + C * cosT * cosT;
  const D1 = D * cosT + E * sinT;
  const E1 = -D * sinT + E * cosT;

  if (Math.abs(B) >= 1e-11) {
    steps.push(`Rotated axes by θ = ${fmtCalcNumber((theta * 180) / Math.PI)}° to eliminate xy term.`);
  }

  // 1. PARABOLA (B^2 - 4AC == 0)
  if (Math.abs(disc) < 1e-9) {
    fields.classification = { label: 'Conic Classification', value: 'Parabola', equation: genEq };
    fields.eccentricity = { label: 'Eccentricity (e)', value: '1', numeric: 1, equation: 'e = 1 (Parabola)' };

    // Choose non-zero quadratic axis in rotated coords
    if (Math.abs(A1) >= Math.abs(C1)) {
      // A1 u^2 + D1 u + E1 v + F = 0 => (u - u0)^2 = 4p (v - v0)
      const u0 = -D1 / (2 * A1);
      const v0 = ((D1 * D1) / (4 * A1) - F) / E1;
      const fourP = -E1 / A1;
      const p = fourP / 4;
      const lr = Math.abs(fourP);
      const vertex = toXY(u0, v0);
      const focus = toXY(u0, v0 + p);
      const directrixEq = lineToXY(0, 1, -(v0 - p));
      const axisEq = lineToXY(1, 0, -u0);
      const tangentVertexEq = lineToXY(0, 1, -v0);
      const latusRectumEq = lineToXY(0, 1, -(v0 + p));
      const stdEq =
        Math.abs(B) < 1e-10
          ? `(x ${vertex[0] >= 0 ? '-' : '+'} ${fmtCalcNumber(Math.abs(vertex[0]))})² = ${fmtCalcNumber(fourP)}(y ${vertex[1] >= 0 ? '-' : '+'} ${fmtCalcNumber(Math.abs(vertex[1]))})`
          : `u² = ${fmtCalcNumber(fourP)}v (rotated frame θ = ${fmtCalcNumber((theta * 180) / Math.PI)}°)`;

      steps.push(`Completed square in u: ${stdEq}. Focal distance p = ${fmtCalcNumber(p)}, Latus Rectum = 4|p| = ${fmtCalcNumber(lr)}.`);
      fields.standard_equation = { label: 'Standard Form Equation', value: stdEq, equation: stdEq };
      fields.vertex = { label: 'Vertex', value: `(${fmtCalcNumber(vertex[0])}, ${fmtCalcNumber(vertex[1])})`, equation: stdEq };
      fields.focus = { label: 'Focus', value: `(${fmtCalcNumber(focus[0])}, ${fmtCalcNumber(focus[1])})`, equation: stdEq };
      fields.latus_rectum = { label: 'Length of Latus Rectum', value: fmtCalcNumber(lr), numeric: lr, equation: `4|p| = ${fmtCalcNumber(lr)}` };
      fields.latus_rectum_equation = { label: 'Equation of Latus Rectum', value: latusRectumEq, equation: latusRectumEq };
      fields.directrix = { label: 'Equation of Directrix', value: directrixEq, equation: directrixEq };
      fields.axis = { label: 'Axis of Symmetry', value: axisEq, equation: axisEq };
      fields.tangent_at_vertex = { label: 'Tangent at Vertex', value: tangentVertexEq, equation: tangentVertexEq };
      fields.major_axis = { label: 'Principal Axis (Parabola)', value: `${axisEq} (infinite length)`, equation: axisEq };
      fields.minor_axis = { label: 'Tangent at Vertex (Perpendicular Axis)', value: tangentVertexEq, equation: tangentVertexEq };
      return { summaryType: 'Parabola', steps, fields };
    } else {
      // C1 v^2 + D1 u + E1 v + F = 0 => (v - v0)^2 = 4p (u - u0)
      const v0 = -E1 / (2 * C1);
      const u0 = ((E1 * E1) / (4 * C1) - F) / D1;
      const fourP = -D1 / C1;
      const p = fourP / 4;
      const lr = Math.abs(fourP);
      const vertex = toXY(u0, v0);
      const focus = toXY(u0 + p, v0);
      const directrixEq = lineToXY(1, 0, -(u0 - p));
      const axisEq = lineToXY(0, 1, -v0);
      const tangentVertexEq = lineToXY(1, 0, -u0);
      const latusRectumEq = lineToXY(1, 0, -(u0 + p));
      const stdEq =
        Math.abs(B) < 1e-10
          ? `(y ${vertex[1] >= 0 ? '-' : '+'} ${fmtCalcNumber(Math.abs(vertex[1]))})² = ${fmtCalcNumber(fourP)}(x ${vertex[0] >= 0 ? '-' : '+'} ${fmtCalcNumber(Math.abs(vertex[0]))})`
          : `v² = ${fmtCalcNumber(fourP)}u (rotated frame θ = ${fmtCalcNumber((theta * 180) / Math.PI)}°)`;

      steps.push(`Completed square in v: ${stdEq}. Focal distance p = ${fmtCalcNumber(p)}, Latus Rectum = 4|p| = ${fmtCalcNumber(lr)}.`);
      fields.standard_equation = { label: 'Standard Form Equation', value: stdEq, equation: stdEq };
      fields.vertex = { label: 'Vertex', value: `(${fmtCalcNumber(vertex[0])}, ${fmtCalcNumber(vertex[1])})`, equation: stdEq };
      fields.focus = { label: 'Focus', value: `(${fmtCalcNumber(focus[0])}, ${fmtCalcNumber(focus[1])})`, equation: stdEq };
      fields.latus_rectum = { label: 'Length of Latus Rectum', value: fmtCalcNumber(lr), numeric: lr, equation: `4|p| = ${fmtCalcNumber(lr)}` };
      fields.latus_rectum_equation = { label: 'Equation of Latus Rectum', value: latusRectumEq, equation: latusRectumEq };
      fields.directrix = { label: 'Equation of Directrix', value: directrixEq, equation: directrixEq };
      fields.axis = { label: 'Axis of Symmetry', value: axisEq, equation: axisEq };
      fields.tangent_at_vertex = { label: 'Tangent at Vertex', value: tangentVertexEq, equation: tangentVertexEq };
      fields.major_axis = { label: 'Principal Axis (Parabola)', value: `${axisEq} (infinite length)`, equation: axisEq };
      fields.minor_axis = { label: 'Tangent at Vertex (Perpendicular Axis)', value: tangentVertexEq, equation: tangentVertexEq };
      return { summaryType: 'Parabola', steps, fields };
    }
  }

  // 2. CENTRAL CONIC (ELLIPSE / CIRCLE / HYPERBOLA)
  const u0 = -D1 / (2 * A1);
  const v0 = -E1 / (2 * C1);
  const [cx, cy] = toXY(u0, v0);
  const rhs = (D1 * D1) / (4 * A1) + (E1 * E1) / (4 * C1) - F;
  const q1 = rhs / A1;
  const q2 = rhs / C1;

  if (disc < 0) {
    if (q1 <= 0 && q2 <= 0) {
      fields.classification = { label: 'Conic Classification', value: 'Empty / Imaginary Ellipse', equation: genEq };
      return { summaryType: 'Imaginary Ellipse', steps, fields };
    }
    const isCircle = Math.abs(B) < 1e-10 && Math.abs(A - C) < 1e-10;
    if (isCircle) {
      const r = Math.sqrt(Math.max(q1, q2));
      steps.push(`Recognized as Circle with center (${fmtCalcNumber(cx)}, ${fmtCalcNumber(cy)}) and radius r = ${fmtCalcNumber(r)}.`);
      return computeCircleProperties(cx, cy, r, steps);
    }
    const horiz = q1 >= q2;
    const aAxis = Math.sqrt(Math.max(q1, q2));
    const bAxis = Math.sqrt(Math.min(q1, q2));
    const cFoc = Math.sqrt(Math.max(0, aAxis * aAxis - bAxis * bAxis));
    const eEcc = aAxis > 0 ? cFoc / aAxis : 0;
    const lr = (2 * bAxis * bAxis) / aAxis;

    const stdEq =
      Math.abs(B) < 1e-10
        ? `(x ${cx >= 0 ? '-' : '+'} ${fmtCalcNumber(Math.abs(cx))})²/${fmtCalcNumber(q1)} + (y ${cy >= 0 ? '-' : '+'} ${fmtCalcNumber(Math.abs(cy))})²/${fmtCalcNumber(q2)} = 1`
        : `(u - u₀)²/${fmtCalcNumber(q1)} + (v - v₀)²/${fmtCalcNumber(q2)} = 1`;

    const f1 = horiz ? toXY(u0 - cFoc, v0) : toXY(u0, v0 - cFoc);
    const f2 = horiz ? toXY(u0 + cFoc, v0) : toXY(u0, v0 + cFoc);
    const v1 = horiz ? toXY(u0 - aAxis, v0) : toXY(u0, v0 - aAxis);
    const v2 = horiz ? toXY(u0 + aAxis, v0) : toXY(u0, v0 + aAxis);
    const cv1 = horiz ? toXY(u0, v0 - bAxis) : toXY(u0 - bAxis, v0);
    const cv2 = horiz ? toXY(u0, v0 + bAxis) : toXY(u0 + bAxis, v0);

    const majorAxisEq = horiz ? lineToXY(0, 1, -v0) : lineToXY(1, 0, -u0);
    const minorAxisEq = horiz ? lineToXY(1, 0, -u0) : lineToXY(0, 1, -v0);
    const dirDist = eEcc > 1e-11 ? aAxis / eEcc : Infinity;
    const dir1Eq = horiz ? lineToXY(1, 0, -(u0 - dirDist)) : lineToXY(0, 1, -(v0 - dirDist));
    const dir2Eq = horiz ? lineToXY(1, 0, -(u0 + dirDist)) : lineToXY(0, 1, -(v0 + dirDist));
    const lr1Eq = horiz ? lineToXY(1, 0, -(u0 - cFoc)) : lineToXY(0, 1, -(v0 - cFoc));
    const lr2Eq = horiz ? lineToXY(1, 0, -(u0 + cFoc)) : lineToXY(0, 1, -(v0 + cFoc));

    steps.push(
      `Ellipse standard form: ${stdEq}`,
      `Semi-major a = ${fmtCalcNumber(aAxis)}, Semi-minor b = ${fmtCalcNumber(bAxis)}, c = √(a² - b²) = ${fmtCalcNumber(cFoc)}, e = ${fmtCalcNumber(eEcc)}.`,
      `Major axis = 2a = ${fmtCalcNumber(2 * aAxis)}, Minor axis = 2b = ${fmtCalcNumber(2 * bAxis)}, Latus Rectum = 2b²/a = ${fmtCalcNumber(lr)}.`
    );

    fields.classification = { label: 'Conic Classification', value: `Ellipse (e = ${fmtCalcNumber(eEcc)})`, equation: stdEq };
    fields.standard_equation = { label: 'Standard Form Equation', value: stdEq, equation: stdEq };
    fields.center = { label: 'Center', value: `(${fmtCalcNumber(cx)}, ${fmtCalcNumber(cy)})`, equation: stdEq };
    fields.eccentricity = { label: 'Eccentricity (e)', value: fmtCalcNumber(eEcc), numeric: eEcc, equation: 'e = √(1 - b²/a²)' };
    fields.semi_major = { label: 'Semi-Major Axis (a)', value: fmtCalcNumber(aAxis), numeric: aAxis, equation: stdEq };
    fields.semi_minor = { label: 'Semi-Minor Axis (b)', value: fmtCalcNumber(bAxis), numeric: bAxis, equation: stdEq };
    fields.major_axis = { label: 'Major Axis Length & Equation', value: `Length = ${fmtCalcNumber(2 * aAxis)} | Eq: ${majorAxisEq}`, numeric: 2 * aAxis, equation: majorAxisEq };
    fields.minor_axis = { label: 'Minor Axis Length & Equation', value: `Length = ${fmtCalcNumber(2 * bAxis)} | Eq: ${minorAxisEq}`, numeric: 2 * bAxis, equation: minorAxisEq };
    fields.latus_rectum = { label: 'Length of Latus Rectum', value: fmtCalcNumber(lr), numeric: lr, equation: `2b²/a = ${fmtCalcNumber(lr)}` };
    fields.latus_rectum_equation = { label: 'Equations of Latera Recta', value: `${lr1Eq}  and  ${lr2Eq}`, equation: lr1Eq };
    fields.directrix = {
      label: 'Equations of Directrices',
      value: Number.isFinite(dirDist) ? `${dir1Eq}  and  ${dir2Eq}` : 'At infinity (Circle)',
      equation: dir1Eq,
    };
    fields.foci = {
      label: 'Foci',
      value: `(${fmtCalcNumber(f1[0])}, ${fmtCalcNumber(f1[1])})  &  (${fmtCalcNumber(f2[0])}, ${fmtCalcNumber(f2[1])})`,
      equation: stdEq,
    };
    fields.vertices = {
      label: 'Vertices & Co-Vertices',
      value: `Vertices: (${fmtCalcNumber(v1[0])}, ${fmtCalcNumber(v1[1])}), (${fmtCalcNumber(v2[0])}, ${fmtCalcNumber(v2[1])}) | Co-vertices: (${fmtCalcNumber(cv1[0])}, ${fmtCalcNumber(cv1[1])}), (${fmtCalcNumber(cv2[0])}, ${fmtCalcNumber(cv2[1])})`,
      equation: stdEq,
    };
    return { summaryType: 'Ellipse', steps, fields };
  }

  // HYPERBOLA (disc > 0)
  const horiz = q1 > 0;
  const aAxis = Math.sqrt(Math.abs(horiz ? q1 : q2));
  const bAxis = Math.sqrt(Math.abs(horiz ? q2 : q1));
  const cFoc = Math.hypot(aAxis, bAxis);
  const eEcc = aAxis > 0 ? cFoc / aAxis : 1;
  const lr = (2 * bAxis * bAxis) / aAxis;
  const isRect = Math.abs(A + C) < 1e-9;

  const stdEq =
    Math.abs(B) < 1e-10
      ? horiz
        ? `(x ${cx >= 0 ? '-' : '+'} ${fmtCalcNumber(Math.abs(cx))})²/${fmtCalcNumber(aAxis * aAxis)} - (y ${cy >= 0 ? '-' : '+'} ${fmtCalcNumber(Math.abs(cy))})²/${fmtCalcNumber(bAxis * bAxis)} = 1`
        : `(y ${cy >= 0 ? '-' : '+'} ${fmtCalcNumber(Math.abs(cy))})²/${fmtCalcNumber(aAxis * aAxis)} - (x ${cx >= 0 ? '-' : '+'} ${fmtCalcNumber(Math.abs(cx))})²/${fmtCalcNumber(bAxis * bAxis)} = 1`
      : horiz
        ? `(u - u₀)²/${fmtCalcNumber(aAxis * aAxis)} - (v - v₀)²/${fmtCalcNumber(bAxis * bAxis)} = 1`
        : `(v - v₀)²/${fmtCalcNumber(aAxis * aAxis)} - (u - u₀)²/${fmtCalcNumber(bAxis * bAxis)} = 1`;

  const f1 = horiz ? toXY(u0 - cFoc, v0) : toXY(u0, v0 - cFoc);
  const f2 = horiz ? toXY(u0 + cFoc, v0) : toXY(u0, v0 + cFoc);
  const v1 = horiz ? toXY(u0 - aAxis, v0) : toXY(u0, v0 - aAxis);
  const v2 = horiz ? toXY(u0 + aAxis, v0) : toXY(u0, v0 + aAxis);

  const transAxisEq = horiz ? lineToXY(0, 1, -v0) : lineToXY(1, 0, -u0);
  const conjAxisEq = horiz ? lineToXY(1, 0, -u0) : lineToXY(0, 1, -v0);
  const dirDist = aAxis / eEcc;
  const dir1Eq = horiz ? lineToXY(1, 0, -(u0 - dirDist)) : lineToXY(0, 1, -(v0 - dirDist));
  const dir2Eq = horiz ? lineToXY(1, 0, -(u0 + dirDist)) : lineToXY(0, 1, -(v0 + dirDist));
  const lr1Eq = horiz ? lineToXY(1, 0, -(u0 - cFoc)) : lineToXY(0, 1, -(v0 - cFoc));
  const lr2Eq = horiz ? lineToXY(1, 0, -(u0 + cFoc)) : lineToXY(0, 1, -(v0 + cFoc));

  const asym1 = horiz
    ? lineToXY(bAxis, -aAxis, -(bAxis * u0 - aAxis * v0))
    : lineToXY(aAxis, -bAxis, -(aAxis * u0 - bAxis * v0));
  const asym2 = horiz
    ? lineToXY(bAxis, aAxis, -(bAxis * u0 + aAxis * v0))
    : lineToXY(aAxis, bAxis, -(aAxis * u0 + bAxis * v0));

  steps.push(
    `Hyperbola standard form: ${stdEq}`,
    `Transverse semi-axis a = ${fmtCalcNumber(aAxis)}, Conjugate semi-axis b = ${fmtCalcNumber(bAxis)}, c = √(a² + b²) = ${fmtCalcNumber(cFoc)}, e = ${fmtCalcNumber(eEcc)}.`,
    `Transverse (Major) axis = 2a = ${fmtCalcNumber(2 * aAxis)}, Conjugate (Minor) axis = 2b = ${fmtCalcNumber(2 * bAxis)}, Latus Rectum = 2b²/a = ${fmtCalcNumber(lr)}.`
  );

  fields.classification = {
    label: 'Conic Classification',
    value: isRect ? 'Rectangular Hyperbola (e = √2)' : `Hyperbola (e = ${fmtCalcNumber(eEcc)})`,
    equation: stdEq,
  };
  fields.standard_equation = { label: 'Standard Form Equation', value: stdEq, equation: stdEq };
  fields.center = { label: 'Center', value: `(${fmtCalcNumber(cx)}, ${fmtCalcNumber(cy)})`, equation: stdEq };
  fields.eccentricity = { label: 'Eccentricity (e)', value: fmtCalcNumber(eEcc), numeric: eEcc, equation: 'e = √(1 + b²/a²)' };
  fields.semi_major = { label: 'Semi-Transverse Axis (a)', value: fmtCalcNumber(aAxis), numeric: aAxis, equation: stdEq };
  fields.semi_minor = { label: 'Semi-Conjugate Axis (b)', value: fmtCalcNumber(bAxis), numeric: bAxis, equation: stdEq };
  fields.major_axis = { label: 'Transverse / Major Axis Length & Equation', value: `Length = ${fmtCalcNumber(2 * aAxis)} | Eq: ${transAxisEq}`, numeric: 2 * aAxis, equation: transAxisEq };
  fields.minor_axis = { label: 'Conjugate / Minor Axis Length & Equation', value: `Length = ${fmtCalcNumber(2 * bAxis)} | Eq: ${conjAxisEq}`, numeric: 2 * bAxis, equation: conjAxisEq };
  fields.latus_rectum = { label: 'Length of Latus Rectum', value: fmtCalcNumber(lr), numeric: lr, equation: `2b²/a = ${fmtCalcNumber(lr)}` };
  fields.latus_rectum_equation = { label: 'Equations of Latera Recta', value: `${lr1Eq}  and  ${lr2Eq}`, equation: lr1Eq };
  fields.directrix = { label: 'Equations of Directrices', value: `${dir1Eq}  and  ${dir2Eq}`, equation: dir1Eq };
  fields.foci = {
    label: 'Foci',
    value: `(${fmtCalcNumber(f1[0])}, ${fmtCalcNumber(f1[1])})  &  (${fmtCalcNumber(f2[0])}, ${fmtCalcNumber(f2[1])})`,
    equation: stdEq,
  };
  fields.vertices = {
    label: 'Vertices',
    value: `(${fmtCalcNumber(v1[0])}, ${fmtCalcNumber(v1[1])})  &  (${fmtCalcNumber(v2[0])}, ${fmtCalcNumber(v2[1])})`,
    equation: stdEq,
  };
  fields.asymptotes = { label: 'Equations of Asymptotes', value: `${asym1}  and  ${asym2}`, equation: asym1 };

  return { summaryType: isRect ? 'Rectangular Hyperbola' : 'Hyperbola', steps, fields };
}

function tryBuildGeometryModel(inputs: UserParamInput[]): GeometryComputedProperties | null {
  const byKey = new Map<string, UserParamInput>();
  const pointsList: [number, number][] = [];
  for (const inp of inputs) {
    const k = normalizeSemanticText(inp.description);
    if (!inp.value.trim()) continue;
    byKey.set(k, inp);
    if (k.includes('point') || k.includes('vertex') || k.includes('focus') || k.includes('center') || k.includes('diameter end')) {
      const pt = parsePointTuple(inp.value);
      if (pt && k.includes('point')) {
        pointsList.push(pt);
      }
    }
  }

  const findVal = (...terms: string[]): string | null => {
    for (const inp of inputs) {
      const k = normalizeSemanticText(inp.description);
      const raw = inp.description.toLowerCase();
      if (terms.some((t) => k.includes(t) || raw.includes(t)) && inp.value.trim()) {
        return inp.value.trim();
      }
    }
    return null;
  };

  // 1. Direct Conic or Circle equation string
  const eqRaw = findVal('conic equation', 'circle equation', 'equation of conic', 'equation of circle', 'equation');
  if (eqRaw && (eqRaw.includes('x') || eqRaw.includes('y'))) {
    const coeffs = extractConicCoeffsFromEquation(eqRaw);
    if (coeffs) {
      return computeConicPropertiesFromCoeffs(
        coeffs.A,
        coeffs.B,
        coeffs.C,
        coeffs.D,
        coeffs.E,
        coeffs.F,
        [`Parsed input equation: ${eqRaw}`]
      );
    }
  }

  // 2. Focus + Directrix (+ optional Eccentricity) -> General Conic by Definition SP = e * PM
  const focusRaw = findVal('focus');
  const directrixRaw = findVal('directrix');
  const eccRaw = findVal('eccentricity');
  if (focusRaw && directrixRaw) {
    const foc = parsePointTuple(focusRaw);
    const dirLine = parseLineCoeff(directrixRaw);
    const ecc = eccRaw ? evalSimpleConstant(eccRaw) : 1;
    if (foc && dirLine && ecc !== null && ecc > 0) {
      const [fx, fy] = foc;
      const { a, b, c } = dirLine;
      const denom = a * a + b * b;
      const e2 = ecc * ecc;
      // (a^2+b^2)((x-fx)^2 + (y-fy)^2) - e^2(ax+by+c)^2 = 0
      const A = denom - e2 * a * a;
      const B = -2 * e2 * a * b;
      const C = denom - e2 * b * b;
      const D = -2 * denom * fx - 2 * e2 * a * c;
      const E = -2 * denom * fy - 2 * e2 * b * c;
      const F = denom * (fx * fx + fy * fy) - e2 * c * c;
      return computeConicPropertiesFromCoeffs(A, B, C, D, E, F, [
        `Constructed conic using SP = e·PM with Focus (${fmtCalcNumber(fx)}, ${fmtCalcNumber(fy)}), Directrix ${directrixRaw}, and e = ${fmtCalcNumber(ecc)}.`,
      ]);
    }
  }

  // 3. Vertex + Focus -> Parabola
  const vertexRaw = findVal('vertex');
  if (vertexRaw && focusRaw && !eccRaw) {
    const vtx = parsePointTuple(vertexRaw);
    const foc = parsePointTuple(focusRaw);
    if (vtx && foc) {
      const [vx, vy] = vtx;
      const [fx, fy] = foc;
      if (Math.abs(vx - fx) < 1e-10 && Math.abs(vy - fy) > 1e-10) {
        const p = fy - vy;
        // (x - vx)^2 = 4p(y - vy) => x^2 - 2vx*x - 4p*y + (vx^2 + 4p*vy) = 0
        return computeConicPropertiesFromCoeffs(
          1,
          0,
          0,
          -2 * vx,
          -4 * p,
          vx * vx + 4 * p * vy,
          [`Vertical parabola from Vertex (${fmtCalcNumber(vx)}, ${fmtCalcNumber(vy)}) and Focus (${fmtCalcNumber(fx)}, ${fmtCalcNumber(fy)}).`]
        );
      }
      if (Math.abs(vy - fy) < 1e-10 && Math.abs(vx - fx) > 1e-10) {
        const p = fx - vx;
        return computeConicPropertiesFromCoeffs(
          0,
          0,
          1,
          -4 * p,
          -2 * vy,
          vy * vy + 4 * p * vx,
          [`Horizontal parabola from Vertex (${fmtCalcNumber(vx)}, ${fmtCalcNumber(vy)}) and Focus (${fmtCalcNumber(fx)}, ${fmtCalcNumber(fy)}).`]
        );
      }
    }
  }

  // 4. Circle by 3 points
  if (pointsList.length >= 3) {
    const [x1, y1] = pointsList[0];
    const [x2, y2] = pointsList[1];
    const [x3, y3] = pointsList[2];
    const det = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
    if (Math.abs(det) > 1e-11) {
      const s1 = x1 * x1 + y1 * y1;
      const s2 = x2 * x2 + y2 * y2;
      const s3 = x3 * x3 + y3 * y3;
      const h = (s1 * (y2 - y3) + s2 * (y3 - y1) + s3 * (y1 - y2)) / det;
      const k = (s1 * (x3 - x2) + s2 * (x1 - x3) + s3 * (x2 - x1)) / det;
      const r = Math.hypot(x1 - h, y1 - k);
      return computeCircleProperties(h, k, r, [
        `Solved circumcircle passing through (${fmtCalcNumber(x1)}, ${fmtCalcNumber(y1)}), (${fmtCalcNumber(x2)}, ${fmtCalcNumber(y2)}), (${fmtCalcNumber(x3)}, ${fmtCalcNumber(y3)}).`,
      ]);
    }
  }

  // 5. Circle by diameter endpoints
  const diamEnd1 = findVal('diameter endpoint 1', 'diameter end 1', 'endpoint 1');
  const diamEnd2 = findVal('diameter endpoint 2', 'diameter end 2', 'endpoint 2');
  if (diamEnd1 && diamEnd2) {
    const p1 = parsePointTuple(diamEnd1);
    const p2 = parsePointTuple(diamEnd2);
    if (p1 && p2) {
      const h = 0.5 * (p1[0] + p2[0]);
      const k = 0.5 * (p1[1] + p2[1]);
      const r = 0.5 * Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      return computeCircleProperties(h, k, r, [
        `Circle with diameter endpoints (${fmtCalcNumber(p1[0])}, ${fmtCalcNumber(p1[1])}) and (${fmtCalcNumber(p2[0])}, ${fmtCalcNumber(p2[1])}): (x-x₁)(x-x₂)+(y-y₁)(y-y₂)=0.`,
      ]);
    }
  }

  // 6. Central conic or circle from center + radius / semi-axes / major+minor / eccentricity
  const centerRaw = findVal('center', 'centre');
  const centerPt = centerRaw ? parsePointTuple(centerRaw) : null;
  const hxRaw = findVal('center x', 'centre x', 'h');
  const kyRaw = findVal('center y', 'centre y', 'k');
  const hVal = centerPt ? centerPt[0] : hxRaw ? evalSimpleConstant(hxRaw) : 0;
  const kVal = centerPt ? centerPt[1] : kyRaw ? evalSimpleConstant(kyRaw) : 0;
  const hasCenterOrAxis = Boolean(centerPt || hxRaw || kyRaw);

  const radiusRaw = findVal('radius');
  const diamRaw = findVal('diameter');
  if (radiusRaw || diamRaw) {
    const rVal = radiusRaw
      ? evalSimpleConstant(radiusRaw)
      : diamRaw
        ? (evalSimpleConstant(diamRaw) ?? NaN) / 2
        : null;
    if (rVal !== null && Number.isFinite(rVal) && rVal > 0 && hVal !== null && kVal !== null) {
      return computeCircleProperties(hVal, kVal, rVal, [
        `Circle from Center (${fmtCalcNumber(hVal)}, ${fmtCalcNumber(kVal)}) and Radius r = ${fmtCalcNumber(rVal)}.`,
      ]);
    }
  }

  // Circle from center + point on circle
  const pointOnCircleRaw = findVal('point on circle', 'point');
  if (hasCenterOrAxis && pointOnCircleRaw && hVal !== null && kVal !== null) {
    const pt = parsePointTuple(pointOnCircleRaw);
    if (pt) {
      const r = Math.hypot(pt[0] - hVal, pt[1] - kVal);
      if (r > 0) {
        return computeCircleProperties(hVal, kVal, r, [
          `Circle centered at (${fmtCalcNumber(hVal)}, ${fmtCalcNumber(kVal)}) passing through (${fmtCalcNumber(pt[0])}, ${fmtCalcNumber(pt[1])}) ⇒ r = ${fmtCalcNumber(r)}.`,
        ]);
      }
    }
  }

  // Ellipse / Hyperbola from major/minor axis or semi-axes
  const majorLenRaw = findVal('major axis length', 'length of major axis', 'transverse axis length', 'major axis');
  const minorLenRaw = findVal('minor axis length', 'length of minor axis', 'conjugate axis length', 'minor axis');
  const semiMajorRaw = findVal('semi major', 'semi-major', 'semi transverse');
  const semiMinorRaw = findVal('semi minor', 'semi-minor', 'semi conjugate');
  const latusRaw = findVal('latus rectum');
  const typeHint = (findVal('conic type', 'type') || '').toLowerCase();
  const orientHint = (findVal('orientation', 'axis orientation') || 'horizontal').toLowerCase();
  const isVertical = orientHint.includes('vert') || orientHint.includes('y');

  let aSemi = semiMajorRaw ? evalSimpleConstant(semiMajorRaw) : majorLenRaw ? (evalSimpleConstant(majorLenRaw) ?? NaN) / 2 : null;
  let bSemi = semiMinorRaw ? evalSimpleConstant(semiMinorRaw) : minorLenRaw ? (evalSimpleConstant(minorLenRaw) ?? NaN) / 2 : null;
  const eVal = eccRaw ? evalSimpleConstant(eccRaw) : null;
  const lrVal = latusRaw ? evalSimpleConstant(latusRaw) : null;

  if (aSemi !== null && bSemi === null && lrVal !== null && lrVal > 0 && aSemi > 0) {
    bSemi = Math.sqrt((lrVal * aSemi) / 2);
  } else if (aSemi === null && bSemi !== null && lrVal !== null && lrVal > 0 && bSemi > 0) {
    aSemi = (2 * bSemi * bSemi) / lrVal;
  } else if (aSemi !== null && bSemi === null && eVal !== null && eVal >= 0 && aSemi > 0) {
    if (eVal < 1) bSemi = aSemi * Math.sqrt(1 - eVal * eVal);
    else if (eVal > 1) bSemi = aSemi * Math.sqrt(eVal * eVal - 1);
  }

  if (aSemi !== null && bSemi !== null && Number.isFinite(aSemi) && Number.isFinite(bSemi) && aSemi > 0 && bSemi > 0 && hVal !== null && kVal !== null) {
    const isHyper = typeHint.includes('hyper') || (eVal !== null && eVal > 1);
    const q1 = isVertical ? bSemi * bSemi : aSemi * aSemi;
    const q2 = isVertical ? aSemi * aSemi : bSemi * bSemi;
    if (isHyper) {
      // (x-h)^2/a^2 - (y-k)^2/b^2 = 1 or (y-k)^2/a^2 - (x-h)^2/b^2 = 1
      const c2x = isVertical ? -1 / (bSemi * bSemi) : 1 / (aSemi * aSemi);
      const c2y = isVertical ? 1 / (aSemi * aSemi) : -1 / (bSemi * bSemi);
      const scale = aSemi * aSemi * bSemi * bSemi;
      const A = c2x * scale;
      const C = c2y * scale;
      const D = -2 * A * hVal;
      const E = -2 * C * kVal;
      const F = A * hVal * hVal + C * kVal * kVal - scale;
      return computeConicPropertiesFromCoeffs(A, 0, C, D, E, F, [
        `Constructed Hyperbola with center (${fmtCalcNumber(hVal)}, ${fmtCalcNumber(kVal)}), a = ${fmtCalcNumber(aSemi)}, b = ${fmtCalcNumber(bSemi)}.`,
      ]);
    } else {
      // Ellipse: (x-h)^2/q1 + (y-k)^2/q2 = 1
      const scale = q1 * q2;
      const A = q2;
      const C = q1;
      const D = -2 * A * hVal;
      const E = -2 * C * kVal;
      const F = A * hVal * hVal + C * kVal * kVal - scale;
      return computeConicPropertiesFromCoeffs(A, 0, C, D, E, F, [
        `Constructed Ellipse with center (${fmtCalcNumber(hVal)}, ${fmtCalcNumber(kVal)}), a = ${fmtCalcNumber(aSemi)}, b = ${fmtCalcNumber(bSemi)}.`,
      ]);
    }
  }

  return null;
}

function matchGeometryFieldKey(desc: string): string | null {
  const n = normalizeSemanticText(desc);
  if (!n) return null;
  if ((n.includes('equation') && n.includes('circle')) || n === 'circle') return 'equation_circle';
  if (n.includes('standard') && n.includes('equation')) return 'standard_equation';
  if (n.includes('general') && n.includes('equation')) return 'general_equation';
  if (n.includes('directrix') || n.includes('directrices')) return 'directrix';
  if (n.includes('latus rectum') && n.includes('equation')) return 'latus_rectum_equation';
  if (n.includes('latus rectum')) return 'latus_rectum';
  if (n.includes('semi major') || n.includes('semi transverse')) return 'semi_major';
  if (n.includes('semi minor') || n.includes('semi conjugate')) return 'semi_minor';
  if (n.includes('major axis') || n.includes('transverse axis')) return 'major_axis';
  if (n.includes('minor axis') || n.includes('conjugate axis')) return 'minor_axis';
  if (n.includes('eccentricity')) return 'eccentricity';
  if (n.includes('center') || n.includes('centre')) return 'center';
  if (n.includes('radius')) return 'radius';
  if (n.includes('diameter')) return 'diameter';
  if (n.includes('area')) return 'area';
  if (n.includes('circumference')) return 'circumference';
  if (n.includes('x intercept')) return 'x_intercept';
  if (n.includes('y intercept')) return 'y_intercept';
  if (n.includes('focus') || n.includes('foci')) return n.includes('foci') ? 'foci' : 'focus';
  if (n.includes('vertex') || n.includes('vertices')) return n.includes('vertices') ? 'vertices' : 'vertex';
  if (n.includes('asymptote')) return 'asymptotes';
  if (n.includes('tangent') && n.includes('vertex')) return 'tangent_at_vertex';
  if (n.includes('axis') && n.includes('symmetry')) return 'axis';
  if (n.includes('classification') || n.includes('type') || n.includes('conic')) return 'classification';
  if (n.includes('equation')) return 'standard_equation';
  return null;
}

export function autoDetectFormulaCase(
  formulas: FormulaEquationItem[],
  inputs: UserParamInput[],
  requestedOutputs: UserOutputRequest[]
): { caseName: string; confidence: number } {
  // Check Geometry model first if user supplied conic/circle style inputs
  const geoModel = tryBuildGeometryModel(inputs);
  if (geoModel) {
    const geoOutHit = requestedOutputs.some((req) => Boolean(matchGeometryFieldKey(req.description)));
    if (geoOutHit || requestedOutputs.length === 0) {
      return { caseName: GEOMETRY_CASE_LABEL, confidence: 100 };
    }
  }

  const caseBuckets = new Map<string, FormulaEquationItem[]>();
  for (const f of formulas) {
    const cName = (f.caseName || 'General').trim() || 'General';
    const arr = caseBuckets.get(cName) || [];
    arr.push(f);
    caseBuckets.set(cName, arr);
  }

  let bestCase = 'General';
  let bestScore = -1;

  for (const [cName, list] of caseBuckets.entries()) {
    let caseScore = 0;
    for (const f of list) {
      const symDefs = f.symbols || [];
      if (symDefs.length === 0) continue;
      let matchedInputs = 0;
      let matchedOutputs = 0;
      let qualitySum = 0;

      for (const sd of symDefs) {
        let bestIn = 0;
        for (const inp of inputs) {
          if (!inp.description.trim() && !inp.symbolHint?.trim()) continue;
          const sc = scoreMeaningMatch(inp.description, sd, inp.symbolHint);
          if (sc > bestIn) bestIn = sc;
        }
        if (bestIn >= 55) {
          matchedInputs++;
          qualitySum += bestIn;
        }

        let bestOut = 0;
        for (const req of requestedOutputs) {
          if (!req.description.trim() && !req.symbolHint?.trim()) continue;
          const sc = scoreMeaningMatch(req.description, sd, req.symbolHint);
          if (sc > bestOut) bestOut = sc;
        }
        if (bestOut >= 55) {
          matchedOutputs++;
          qualitySum += bestOut;
        }
      }

      // Bonus when an equation has exactly 1 missing symbol (exact solve!) & matches a requested output
      const missingCount = Math.max(0, symDefs.length - matchedInputs);
      let eqScore = qualitySum + matchedInputs * 25 + matchedOutputs * 35;
      if (missingCount === 1 && matchedOutputs >= 1) {
        eqScore += 160;
      } else if (missingCount === 1) {
        eqScore += 70;
      }
      if (eqScore > caseScore) caseScore = eqScore;
    }

    if (caseScore > bestScore) {
      bestScore = caseScore;
      bestCase = cName;
    }
  }

  return { caseName: bestCase, confidence: Math.max(0, bestScore) };
}

export function solveWithFormulaSystem(
  formulas: FormulaEquationItem[],
  inputs: UserParamInput[],
  requestedOutputs: UserOutputRequest[],
  angleUnit: 'rad' | 'deg' = 'rad',
  selectedCase = '__auto__'
): FormulaSolveResponse {
  const derivationSteps: string[] = [];
  const warnings: string[] = [];
  const outputs: SolvedOutputItem[] = [];
  const unmatchedOutputs: string[] = [];

  const isManual = Boolean(selectedCase && selectedCase !== '__auto__' && selectedCase !== '__all__');
  const caseMode: 'auto' | 'manual' = isManual ? 'manual' : 'auto';

  const autoInfo = isManual
    ? { caseName: selectedCase, confidence: 100 }
    : autoDetectFormulaCase(formulas, inputs, requestedOutputs);
  const resolvedCase = autoInfo.caseName;

  if (caseMode === 'auto' && resolvedCase) {
    derivationSteps.push(`Auto-detected case: "${resolvedCase}"`);
  } else if (caseMode === 'manual') {
    derivationSteps.push(`Selected case: "${resolvedCase}"`);
  }

  // Step A: Symbolic Coordinate Geometry / Circle / Conic Solver when applicable
  const allowGeometry =
    resolvedCase === GEOMETRY_CASE_LABEL || !isManual;
  const geoModel = allowGeometry ? tryBuildGeometryModel(inputs) : null;
  const remainingOutputs: UserOutputRequest[] = [];

  if (geoModel) {
    derivationSteps.push(...geoModel.steps);
    for (const req of requestedOutputs) {
      const key = matchGeometryFieldKey(req.description);
      const resolvedField =
        (key && geoModel.fields[key]) ||
        (key === 'focus' && geoModel.fields.foci) ||
        (key === 'foci' && geoModel.fields.focus) ||
        (key === 'vertex' && geoModel.fields.vertices) ||
        (key === 'vertices' && geoModel.fields.vertex) ||
        (key === 'equation_circle' && geoModel.fields.standard_equation);

      if (resolvedField) {
        outputs.push({
          requestedDescription: req.description,
          matchedSymbol: key || 'expr',
          matchedMeaning: resolvedField.label,
          valueDisplay: resolvedField.value,
          numericValue: resolvedField.numeric,
          unit: req.unit || '',
          formulaTitle: `${geoModel.summaryType} Analytic Solver`,
          equationUsed: resolvedField.equation,
          steps: geoModel.steps,
        });
      } else {
        remainingOutputs.push(req);
      }
    }
  } else {
    remainingOutputs.push(...requestedOutputs);
  }

  if (remainingOutputs.length === 0 && outputs.length > 0) {
    return {
      ok: true,
      mode: 'geometry_symbolic',
      detectedCase: GEOMETRY_CASE_LABEL,
      caseMode,
      outputs,
      unmatchedOutputs: [],
      derivationSteps,
      warnings,
    };
  }

  // Step B: Contributor Multi-Equation Parameter-Matching Chained Solver
  interface KnownQuantity {
    meaningNorm: string;
    meaningLabel: string;
    value: number;
    symbolHint?: string;
    source: string;
    caseName?: string;
  }

  const knownQuantities: KnownQuantity[] = [];
  for (const inp of inputs) {
    const label = inp.description.trim() || (inp.symbolHint || '').trim();
    if (!label) continue;
    const numVal = evalSimpleConstant(inp.value);
    if (numVal === null) continue;
    knownQuantities.push({
      meaningNorm: normalizeSemanticText(label),
      meaningLabel: label,
      value: numVal,
      symbolHint: inp.symbolHint?.trim(),
      source: 'user_input',
    });
  }

  // Filter / prioritize formulas by resolved case
  const scopedFormulas = isManual
    ? formulas.filter((f) => ((f.caseName || 'General').trim() || 'General') === resolvedCase)
    : [
        ...formulas.filter((f) => ((f.caseName || 'General').trim() || 'General') === resolvedCase),
        ...formulas.filter((f) => ((f.caseName || 'General').trim() || 'General') !== resolvedCase),
      ];

  const derivedByFormulaSymbol = new Map<string, number>();
  const usedFormulas = new Set<number>();

  for (let pass = 0; pass < 6; pass++) {
    let progressed = false;

    interface CandidateSolve {
      formula: FormulaEquationItem;
      targetDef: FormulaSymbolDef;
      env: Record<string, number>;
      priority: number;
    }
    const candidates: CandidateSolve[] = [];

    for (const formula of scopedFormulas) {
      if (usedFormulas.has(formula.id)) continue;
      const symDefs = formula.symbols || [];
      if (symDefs.length === 0) continue;

      const env: Record<string, number> = {};
      const missingSyms: FormulaSymbolDef[] = [];

      for (const sd of symDefs) {
        const directKey = `${formula.id}:${sd.symbol}`;
        if (derivedByFormulaSymbol.has(directKey)) {
          env[sd.symbol] = derivedByFormulaSymbol.get(directKey)!;
          continue;
        }
        let bestScore = 0;
        let bestQty: KnownQuantity | null = null;
        for (const kq of knownQuantities) {
          const score = scoreMeaningMatch(kq.meaningLabel, sd, kq.symbolHint);
          if (score > bestScore) {
            bestScore = score;
            bestQty = kq;
          }
        }
        if (bestQty && bestScore >= 55) {
          env[sd.symbol] = bestQty.value;
        } else {
          missingSyms.push(sd);
        }
      }

      if (missingSyms.length === 1) {
        const targetDef = missingSyms[0];
        const fCase = (formula.caseName || 'General').trim() || 'General';
        const isSameCase = fCase === resolvedCase ? 100 : 0;
        const matchesRequestedOutput = remainingOutputs.some(
          (req) => scoreMeaningMatch(req.description, targetDef, req.symbolHint) >= 55
        )
          ? 200
          : 0;
        candidates.push({
          formula,
          targetDef,
          env,
          priority: isSameCase + matchesRequestedOutput,
        });
      }
    }

    candidates.sort((a, b) => b.priority - a.priority);

    for (const cand of candidates) {
      if (usedFormulas.has(cand.formula.id)) continue;
      // Skip if target symbol is already solved within the same case unless needed by a new formula
      const knownSymbols = (cand.formula.symbols || []).map((s) => s.symbol);
      const solvedVal = solveSingleUnknownEquation(
        cand.formula.expression,
        cand.env,
        cand.targetDef.symbol,
        angleUnit,
        knownSymbols
      );
      if (solvedVal !== null && Number.isFinite(solvedVal)) {
        usedFormulas.add(cand.formula.id);
        derivedByFormulaSymbol.set(`${cand.formula.id}:${cand.targetDef.symbol}`, solvedVal);
        const substSummary = Object.entries(cand.env)
          .map(([k, v]) => `${k}=${fmtCalcNumber(v)}`)
          .join(', ');
        const stepLine = `Using "${cand.formula.title}" (${cand.formula.caseName || 'General'}) [${cand.formula.expression}] with ${substSummary} ⇒ ${cand.targetDef.symbol} (${cand.targetDef.meaning}) = ${fmtCalcNumber(solvedVal)}${cand.targetDef.unit ? ` ${cand.targetDef.unit}` : ''}.`;
        derivationSteps.push(stepLine);

        knownQuantities.push({
          meaningNorm: normalizeSemanticText(cand.targetDef.meaning),
          meaningLabel: cand.targetDef.meaning,
          value: solvedVal,
          symbolHint: cand.targetDef.symbol,
          source: cand.formula.title,
          caseName: cand.formula.caseName || 'General',
        });
        progressed = true;
      }
    }

    if (!progressed) break;
  }

  for (const req of remainingOutputs) {
    const reqLabel = req.description.trim() || (req.symbolHint || '').trim();
    const reqNorm = normalizeSemanticText(reqLabel);
    let bestQty: KnownQuantity | null = null;
    let bestScore = 0;

    for (const kq of knownQuantities) {
      const fakeDef: FormulaSymbolDef = {
        symbol: kq.symbolHint || '',
        meaning: kq.meaningLabel,
        unit: '',
      };
      const sc = scoreMeaningMatch(reqLabel, fakeDef, req.symbolHint);
      const derivedBonus = kq.source !== 'user_input' ? 6 : 0;
      const caseBonus = kq.caseName === resolvedCase ? 5 : 0;
      if (sc + derivedBonus + caseBonus > bestScore) {
        bestScore = sc + derivedBonus + caseBonus;
        bestQty = kq;
      }
    }

    if (bestQty && bestScore >= 55 && (reqNorm || reqLabel)) {
      const matchingFormula = scopedFormulas.find((f) => f.title === bestQty!.source);
      const symDef = matchingFormula?.symbols.find(
        (s) =>
          s.symbol === bestQty!.symbolHint ||
          normalizeSemanticText(s.meaning) === bestQty!.meaningNorm
      );
      outputs.push({
        requestedDescription: req.description || reqLabel,
        matchedSymbol: bestQty.symbolHint || symDef?.symbol || 'val',
        matchedMeaning: bestQty.meaningLabel,
        valueDisplay: fmtCalcNumber(bestQty.value),
        numericValue: bestQty.value,
        unit: req.unit || symDef?.unit || '',
        formulaTitle:
          bestQty.source === 'user_input'
            ? 'Direct Parameter Match'
            : bestQty.source,
        equationUsed: matchingFormula?.expression || 'Given input parameter',
        steps: derivationSteps.filter((s) => !matchingFormula || s.includes(matchingFormula.title)),
      });
    } else {
      unmatchedOutputs.push(req.description || reqLabel);
    }
  }

  if (unmatchedOutputs.length > 0 && outputs.length === 0 && inputs.length > 0) {
    warnings.push(
      isManual
        ? `No equation in case "${resolvedCase}" matched all input & output parameters. Try switching Case to "Auto-Detect Case" or verify your parameters.`
        : 'No contributor equation or coordinate geometry rule matched all input & output parameter descriptions. Check parameter descriptions or ask a Contributor to add the equation.'
    );
  }

  return {
    ok: outputs.length > 0,
    mode: geoModel && outputs.some((o) => !o.formulaTitle.includes('Analytic Solver'))
      ? 'mixed'
      : geoModel
        ? 'geometry_symbolic'
        : 'formula_chain',
    detectedCase: resolvedCase,
    caseMode,
    outputs,
    unmatchedOutputs,
    derivationSteps,
    warnings,
  };
}

