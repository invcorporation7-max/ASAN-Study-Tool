import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Info,
  Keyboard,
  Power,
  RotateCcw,
  Trash2,
} from 'lucide-react';

type CalcMode = 'COMP' | 'SD' | 'REG';
type AngleUnit = 'DEG' | 'RAD' | 'GRA';
type NumberFormat = 'NORM1' | 'NORM2' | 'FIX' | 'SCI';
type FractionDisplay = 'MIXED' | 'IMPROPER';
type VarName = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'X' | 'Y' | 'M';

type MenuState =
  | { kind: 'none' }
  | { kind: 'mode'; page: 1 | 2 | 3 | 4 }
  | { kind: 'fix_digits' }
  | { kind: 'sci_digits' }
  | { kind: 'norm_digits' }
  | { kind: 'clr' }
  | { kind: 'clr_confirm'; target: 'mcl' | 'mode' | 'all' }
  | { kind: 'drg' }
  | { kind: 's_sum'; page: 1 | 2 }
  | { kind: 's_var'; page: 1 | 2 | 3 };

interface HistoryEntry {
  expr: string;
  resultNum: number;
  displayText: string;
}

interface StatPoint {
  x: number;
  y?: number;
  freq: number;
}

const VARS_STORAGE_KEY = 'asan_fx82ms_vars_v1';
const SETTINGS_STORAGE_KEY = 'asan_fx82ms_settings_v1';
const MAX_REPLAY_HISTORY = 20;

const DEFAULT_VARS: Record<VarName, number> = {
  A: 0,
  B: 0,
  C: 0,
  D: 0,
  E: 0,
  F: 0,
  X: 0,
  Y: 0,
  M: 0,
};

function loadPersistedVars(): Record<VarName, number> {
  try {
    const raw = localStorage.getItem(VARS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_VARS };
    const parsed = JSON.parse(raw) as Partial<Record<VarName, unknown>>;
    const next = { ...DEFAULT_VARS };
    (Object.keys(DEFAULT_VARS) as VarName[]).forEach((k) => {
      if (typeof parsed[k] === 'number' && Number.isFinite(parsed[k])) {
        next[k] = parsed[k] as number;
      }
    });
    return next;
  } catch {
    return { ...DEFAULT_VARS };
  }
}

function savePersistedVars(vars: Record<VarName, number>) {
  try {
    localStorage.setItem(VARS_STORAGE_KEY, JSON.stringify(vars));
  } catch {
    // ignore quota errors
  }
}

function loadPersistedSettings(): {
  calcMode: CalcMode;
  angleUnit: AngleUnit;
  numFormat: NumberFormat;
  formatDigits: number;
  fractionDisplay: FractionDisplay;
} {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return {
        calcMode: 'COMP',
        angleUnit: 'DEG',
        numFormat: 'NORM1',
        formatDigits: 0,
        fractionDisplay: 'MIXED',
      };
    }
    const p = JSON.parse(raw);
    return {
      calcMode: p.calcMode === 'SD' || p.calcMode === 'REG' ? p.calcMode : 'COMP',
      angleUnit: p.angleUnit === 'RAD' || p.angleUnit === 'GRA' ? p.angleUnit : 'DEG',
      numFormat:
        p.numFormat === 'NORM2' || p.numFormat === 'FIX' || p.numFormat === 'SCI'
          ? p.numFormat
          : 'NORM1',
      formatDigits:
        typeof p.formatDigits === 'number' && p.formatDigits >= 0 && p.formatDigits <= 9
          ? Math.floor(p.formatDigits)
          : 0,
      fractionDisplay: p.fractionDisplay === 'IMPROPER' ? 'IMPROPER' : 'MIXED',
    };
  } catch {
    return {
      calcMode: 'COMP',
      angleUnit: 'DEG',
      numFormat: 'NORM1',
      formatDigits: 0,
      fractionDisplay: 'MIXED',
    };
  }
}

function toRadians(val: number, unit: AngleUnit): number {
  if (unit === 'DEG') return (val * Math.PI) / 180;
  if (unit === 'GRA') return (val * Math.PI) / 200;
  return val;
}

function fromRadians(rad: number, unit: AngleUnit): number {
  if (unit === 'DEG') return (rad * 180) / Math.PI;
  if (unit === 'GRA') return (rad * 200) / Math.PI;
  return rad;
}

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 69) {
    throw new Error('Math ERROR');
  }
  let res = 1;
  for (let i = 2; i <= n; i++) res *= i;
  return res;
}

function nPr(n: number, r: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(r) || n < 0 || r < 0 || r > n || n > 69) {
    throw new Error('Math ERROR');
  }
  let res = 1;
  for (let i = 0; i < r; i++) res *= n - i;
  return res;
}

function nCr(n: number, r: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(r) || n < 0 || r < 0 || r > n || n > 69) {
    throw new Error('Math ERROR');
  }
  const k = Math.min(r, n - r);
  let res = 1;
  for (let i = 1; i <= k; i++) {
    res = (res * (n - k + i)) / i;
  }
  return Math.round(res);
}

function approxFraction(
  val: number,
  maxDenom = 9999
): { sign: number; num: number; den: number } | null {
  if (!Number.isFinite(val)) return null;
  const sign = val < 0 ? -1 : 1;
  const abs = Math.abs(val);
  if (abs > 1e7) return null;

  let h1 = 1;
  let h0 = 0;
  let k1 = 0;
  let k0 = 1;
  let b = abs;
  for (let i = 0; i < 24; i++) {
    const a = Math.floor(b);
    const auxH = a * h1 + h0;
    const auxK = a * k1 + k0;
    if (auxK > maxDenom) break;
    h0 = h1;
    h1 = auxH;
    k0 = k1;
    k1 = auxK;
    const frac = b - a;
    if (frac < 1e-10) break;
    b = 1 / frac;
  }
  if (k1 <= 0 || Math.abs(abs - h1 / k1) > 1e-7) return null;
  return { sign, num: h1, den: k1 };
}

function formatDms(val: number): string {
  const sign = val < 0 ? '-' : '';
  const abs = Math.abs(val);
  const d = Math.floor(abs + 1e-9);
  const mFloat = (abs - d) * 60;
  const m = Math.floor(mFloat + 1e-7);
  const s = Math.max(0, (mFloat - m) * 60);
  return `${sign}${d}°${m}′${Number(s.toFixed(2))}″`;
}

function formatCasioNumber(
  num: number,
  numFormat: NumberFormat,
  formatDigits: number,
  engShift = 0
): { main: string; exp: string | null } {
  if (!Number.isFinite(num)) {
    throw new Error('Math ERROR');
  }
  const clean = Math.abs(num) < 1e-13 ? 0 : num;

  if (engShift !== 0 && clean !== 0) {
    const abs = Math.abs(clean);
    const baseExp3 = Math.floor(Math.log10(abs) / 3) * 3;
    const targetExp = baseExp3 + engShift * 3;
    const mantissa = clean / Math.pow(10, targetExp);
    const mStr = Number(mantissa.toPrecision(10)).toString();
    return { main: mStr, exp: String(targetExp) };
  }

  if (numFormat === 'FIX') {
    const fixed = clean.toFixed(formatDigits);
    if (fixed.replace('.', '').replace('-', '').length <= 10) {
      return { main: fixed === '-0' || fixed === '-0.0' ? fixed.slice(1) : fixed, exp: null };
    }
  }

  if (numFormat === 'SCI') {
    const sig = formatDigits === 0 ? 10 : formatDigits;
    const [m, e] = clean.toExponential(Math.max(0, sig - 1)).split('e');
    return { main: m, exp: String(Number(e)) };
  }

  const abs = Math.abs(clean);
  const normLow = numFormat === 'NORM2' ? 1e-9 : 1e-2;
  if (clean !== 0 && (abs >= 1e10 || abs < normLow)) {
    const [m, e] = clean.toExponential(9).split('e');
    const trimmedM = Number(m).toString();
    return { main: trimmedM, exp: String(Number(e)) };
  }

  const rounded = Number(clean.toPrecision(10));
  return { main: Object.is(rounded, -0) ? '0' : String(rounded), exp: null };
}

function formatFractionDisplay(
  num: number,
  mode: FractionDisplay
): string | null {
  const f = approxFraction(num);
  if (!f || f.den === 1) return null;
  const prefix = f.sign < 0 ? '-' : '';
  if (mode === 'IMPROPER') {
    return `${prefix}${f.num}┘${f.den}`;
  }
  const whole = Math.floor(f.num / f.den);
  const rem = f.num % f.den;
  if (whole === 0) return `${prefix}${rem}┘${f.den}`;
  return `${prefix}${whole}┘${rem}┘${f.den}`;
}

interface Token {
  type: 'num' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma' | 'postfix' | 'dms';
  value: string;
  numVal?: number;
}

const FUNC_NAMES = [
  'sinh⁻¹',
  'cosh⁻¹',
  'tanh⁻¹',
  'sin⁻¹',
  'cos⁻¹',
  'tan⁻¹',
  'sinh',
  'cosh',
  'tanh',
  'sin',
  'cos',
  'tan',
  'log',
  'ln',
  '³√',
  '√',
  'Pol',
  'Rec',
  'Rnd',
];

const MULTI_CHAR_DELETE_TOKENS = [
  'sinh⁻¹(',
  'cosh⁻¹(',
  'tanh⁻¹(',
  'sin⁻¹(',
  'cos⁻¹(',
  'tan⁻¹(',
  'sinh⁻¹',
  'cosh⁻¹',
  'tanh⁻¹',
  'sin⁻¹',
  'cos⁻¹',
  'tan⁻¹',
  'sinh(',
  'cosh(',
  'tanh(',
  'Pol(',
  'Rec(',
  'Rnd(',
  'sin(',
  'cos(',
  'tan(',
  'log(',
  '³√(',
  'ln(',
  '√(',
  '×10^',
  'Ran#',
  'Ans',
  '10^',
  'e^',
  'sinh',
  'cosh',
  'tanh',
  'Pol',
  'Rec',
  'Rnd',
  'sin',
  'cos',
  'tan',
  'log',
  'ln',
  '³√',
  'ˣ√',
  '⁻¹',
  '√',
];

function getTokenSpansForDelete(expr: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < expr.length) {
    let matched: string | undefined;
    for (const tok of MULTI_CHAR_DELETE_TOKENS) {
      if (tok === '10^' && i > 0 && /[0-9.]/.test(expr[i - 1])) {
        continue;
      }
      if (expr.startsWith(tok, i)) {
        matched = tok;
        break;
      }
    }
    if (matched) {
      spans.push({ start: i, end: i + matched.length });
      i += matched.length;
    } else {
      spans.push({ start: i, end: i + 1 });
      i += 1;
    }
  }
  return spans;
}

function tokenizeExpression(input: string): Token[] {
  const s = input.replace(/\s+/g, '');
  const tokens: Token[] = [];
  let i = 0;

  while (i < s.length) {
    const ch = s[i];

    // Match multi-character constants/tokens
    if (s.startsWith('Ans', i)) {
      tokens.push({ type: 'ident', value: 'Ans' });
      i += 3;
      continue;
    }
    if (s.startsWith('Ran#', i)) {
      tokens.push({ type: 'ident', value: 'Ran#' });
      i += 4;
      continue;
    }
    if (s.startsWith('×10^', i)) {
      tokens.push({ type: 'op', value: '×10^' });
      i += 4;
      continue;
    }
    if (s.startsWith('10^', i) && (tokens.length === 0 || tokens[tokens.length - 1].type === 'op' || tokens[tokens.length - 1].type === 'lparen' || tokens[tokens.length - 1].type === 'comma')) {
      tokens.push({ type: 'num', value: '10', numVal: 10 });
      tokens.push({ type: 'op', value: '^' });
      i += 3;
      continue;
    }

    const matchedFn = FUNC_NAMES.find((fn) => s.startsWith(fn, i));
    if (matchedFn) {
      tokens.push({ type: 'ident', value: matchedFn });
      i += matchedFn.length;
      continue;
    }

    // Numbers (including decimal and fraction symbol ┘)
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      let j = i;
      let dots = 0;
      while (j < s.length && ((s[j] >= '0' && s[j] <= '9') || (s[j] === '.' && dots === 0))) {
        if (s[j] === '.') dots++;
        j++;
      }
      const numStr = s.slice(i, j);
      if (numStr === '.') throw new Error('Syntax ERROR');
      tokens.push({ type: 'num', value: numStr, numVal: Number(numStr) });
      i = j;
      continue;
    }

    // Mixed/Improper fraction separator '┘'
    if (ch === '┘') {
      tokens.push({ type: 'op', value: '┘' });
      i += 1;
      continue;
    }

    // Angle/Postfix symbols
    if (ch === '°' || ch === 'ʳ' || ch === 'ᵍ' || ch === '!' || ch === '%' || ch === '²' || ch === '³') {
      tokens.push({ type: 'postfix', value: ch });
      i += 1;
      continue;
    }
    if (s.startsWith('⁻¹', i)) {
      tokens.push({ type: 'postfix', value: '⁻¹' });
      i += 2;
      continue;
    }

    if (s.startsWith('ˣ√', i)) {
      tokens.push({ type: 'op', value: 'ˣ√' });
      i += 2;
      continue;
    }

    // Check nPr/nCr symbols before variable letters A..F so 'C' (var) never collides with 'ᴄ' (nCr)
    if (ch === 'ᴘ' || ch === 'P' || ch === 'ᴄ') {
      tokens.push({ type: 'op', value: ch === 'ᴄ' ? 'C' : 'P' });
      i += 1;
      continue;
    }

    if (ch === 'π' || ch === 'e' || (ch >= 'A' && ch <= 'F') || ch === 'X' || ch === 'Y' || ch === 'M') {
      tokens.push({ type: 'ident', value: ch });
      i += 1;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'lparen', value: '(' });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', value: ')' });
      i += 1;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'comma', value: ',' });
      i += 1;
      continue;
    }
    if (ch === '−') {
      tokens.push({ type: 'op', value: '−' });
      i += 1;
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '×' || ch === '*' || ch === '÷' || ch === '/' || ch === '^') {
      const normalized = ch === '*' ? '×' : ch === '/' ? '÷' : ch === '-' ? '−' : ch;
      tokens.push({ type: 'op', value: normalized });
      i += 1;
      continue;
    }

    throw new Error('Syntax ERROR');
  }

  // Handle Casio fraction literal chains a┘b or a┘b┘c into resolved numbers cleanly before parsing
  const resolvedFracs: Token[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (
      t.type === 'num' &&
      k + 2 < tokens.length &&
      tokens[k + 1].value === '┘' &&
      tokens[k + 2].type === 'num'
    ) {
      if (
        k + 4 < tokens.length &&
        tokens[k + 3].value === '┘' &&
        tokens[k + 4].type === 'num'
      ) {
        const w = t.numVal!;
        const n = tokens[k + 2].numVal!;
        const d = tokens[k + 4].numVal!;
        if (d === 0) throw new Error('Math ERROR');
        resolvedFracs.push({ type: 'num', value: `${w}┘${n}┘${d}`, numVal: w + n / d });
        k += 4;
        continue;
      } else {
        const n = t.numVal!;
        const d = tokens[k + 2].numVal!;
        if (d === 0) throw new Error('Math ERROR');
        resolvedFracs.push({ type: 'num', value: `${n}┘${d}`, numVal: n / d });
        k += 2;
        continue;
      }
    }
    resolvedFracs.push(t);
  }

  // Handle DMS syntax like 12°30°45° (stored via °′″ key as °)
  const resolvedDms: Token[] = [];
  for (let k = 0; k < resolvedFracs.length; k++) {
    const t = resolvedFracs[k];
    if (
      t.type === 'num' &&
      k + 1 < resolvedFracs.length &&
      resolvedFracs[k + 1].value === '°' &&
      k + 2 < resolvedFracs.length &&
      resolvedFracs[k + 2].type === 'num'
    ) {
      // Check d°m° or d°m°s°
      const deg = t.numVal!;
      const min = resolvedFracs[k + 2].numVal!;
      let sec = 0;
      let consumed = 2;
      if (k + 3 < resolvedFracs.length && resolvedFracs[k + 3].value === '°') {
        consumed = 3;
        if (k + 4 < resolvedFracs.length && resolvedFracs[k + 4].type === 'num') {
          sec = resolvedFracs[k + 4].numVal!;
          consumed = 4;
          if (k + 5 < resolvedFracs.length && resolvedFracs[k + 5].value === '°') {
            consumed = 5;
          }
        }
      }
      const val = deg + min / 60 + sec / 3600;
      resolvedDms.push({ type: 'num', value: `${deg}°${min}′`, numVal: val });
      k += consumed;
      continue;
    }
    resolvedDms.push(t);
  }

  // Insert implicit multiplication (e.g. 2π, 2(3), (2)(3), 2sin(30), 3A)
  const finalTokens: Token[] = [];
  for (let k = 0; k < resolvedDms.length; k++) {
    const cur = resolvedDms[k];
    if (k > 0) {
      const prev = resolvedDms[k - 1];
      const prevEndsAtom =
        prev.type === 'num' ||
        prev.type === 'rparen' ||
        prev.type === 'postfix' ||
        (prev.type === 'ident' && !FUNC_NAMES.includes(prev.value));
      const curStartsAtom =
        cur.type === 'lparen' ||
        cur.type === 'ident' ||
        (cur.type === 'num' && prev.type !== 'num');
      if (prevEndsAtom && curStartsAtom) {
        finalTokens.push({ type: 'op', value: '×_imp' });
      }
    }
    finalTokens.push(cur);
  }

  return finalTokens;
}

interface EvalContext {
  vars: Record<VarName, number>;
  ans: number;
  angleUnit: AngleUnit;
  numFormat: NumberFormat;
  formatDigits: number;
  onAssignVar: (name: VarName, value: number) => void;
}

function evaluateExpression(expr: string, ctx: EvalContext): number {
  const tokens = tokenizeExpression(expr);
  if (tokens.length === 0) throw new Error('Syntax ERROR');
  let pos = 0;

  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];

  function parseExpOrAdd(): number {
    let left = parseMulDiv();
    while (peek()?.type === 'op' && (peek()!.value === '+' || peek()!.value === '−')) {
      const op = consume().value;
      const right = parseMulDiv();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseMulDiv(): number {
    let left = parseImplicitMul();
    while (peek()?.type === 'op' && (peek()!.value === '×' || peek()!.value === '÷')) {
      const op = consume().value;
      const right = parseImplicitMul();
      if (op === '÷' && right === 0) throw new Error('Math ERROR');
      left = op === '×' ? left * right : left / right;
    }
    return left;
  }

  function parseImplicitMul(): number {
    let left = parseUnary();
    while (peek()?.type === 'op' && peek()!.value === '×_imp') {
      consume();
      const right = parseUnary();
      left = left * right;
    }
    return left;
  }

  function parseUnary(): number {
    if (peek()?.type === 'op' && (peek()!.value === '+' || peek()!.value === '−')) {
      const op = consume().value;
      const val = parseUnary();
      return op === '−' ? -val : val;
    }
    return parseCombPerm();
  }

  function parseCombPerm(): number {
    let left = parsePower();
    while (peek()?.type === 'op' && (peek()!.value === 'P' || peek()!.value === 'C')) {
      const op = consume().value;
      const right = parsePower();
      left = op === 'P' ? nPr(left, right) : nCr(left, right);
    }
    return left;
  }

  function parsePower(): number {
    let base = parseSciExp();
    while (
      peek()?.type === 'op' &&
      (peek()!.value === '^' || peek()!.value === 'ˣ√')
    ) {
      const op = consume().value;
      const right = parseUnary();
      if (op === '^') {
        base = Math.pow(base, right);
      } else {
        if (base === 0) throw new Error('Math ERROR');
        base = Math.pow(right, 1 / base);
      }
    }
    return base;
  }

  function parseSciExp(): number {
    let left = parsePostfix();
    while (peek()?.type === 'op' && peek()!.value === '×10^') {
      consume();
      const exp = parseUnary();
      left = left * Math.pow(10, exp);
    }
    return left;
  }

  function parsePostfix(): number {
    let val = parsePrimary();
    while (peek()?.type === 'postfix') {
      const p = consume().value;
      if (p === '!') val = factorial(val);
      else if (p === '%') val = val / 100;
      else if (p === '²') val = val * val;
      else if (p === '³') val = val * val * val;
      else if (p === '⁻¹') {
        if (val === 0) throw new Error('Math ERROR');
        val = 1 / val;
      } else if (p === '°') {
        // Degrees -> current unit
        const rad = (val * Math.PI) / 180;
        val = fromRadians(rad, ctx.angleUnit);
      } else if (p === 'ʳ') {
        val = fromRadians(val, ctx.angleUnit);
      } else if (p === 'ᵍ') {
        const rad = (val * Math.PI) / 200;
        val = fromRadians(rad, ctx.angleUnit);
      }
    }
    return val;
  }

  function parseFunctionArg(): number {
    if (peek()?.type === 'lparen') {
      consume();
      const v = parseExpOrAdd();
      if (peek()?.type === 'rparen') consume();
      return v;
    }
    return parseUnary();
  }

  function parsePrimary(): number {
    const t = peek();
    if (!t) throw new Error('Syntax ERROR');

    if (t.type === 'num') {
      consume();
      return t.numVal!;
    }

    if (t.type === 'lparen') {
      consume();
      const v = parseExpOrAdd();
      if (peek()?.type !== 'rparen') throw new Error('Syntax ERROR');
      consume();
      return v;
    }

    if (t.type === 'ident') {
      consume();
      const name = t.value;
      if (name === 'π') return Math.PI;
      if (name === 'e') return Math.E;
      if (name === 'Ans') return ctx.ans;
      if (name === 'Ran#') return Number(Math.random().toFixed(3));
      if (name in ctx.vars) return ctx.vars[name as VarName];

      if (name === 'Pol' || name === 'Rec') {
        if (peek()?.type === 'lparen') consume();
        const x = parseExpOrAdd();
        if (peek()?.type !== 'comma') throw new Error('Syntax ERROR');
        consume();
        const y = parseExpOrAdd();
        if (peek()?.type === 'rparen') consume();

        if (name === 'Pol') {
          const r = Math.hypot(x, y);
          const theta = fromRadians(Math.atan2(y, x), ctx.angleUnit);
          ctx.onAssignVar('E', r);
          ctx.onAssignVar('F', theta);
          return r;
        } else {
          const rad = toRadians(y, ctx.angleUnit);
          const rx = x * Math.cos(rad);
          const ry = x * Math.sin(rad);
          ctx.onAssignVar('E', rx);
          ctx.onAssignVar('F', ry);
          return rx;
        }
      }

      if (name === 'Rnd') {
        const arg = parseFunctionArg();
        const { main, exp } = formatCasioNumber(arg, ctx.numFormat, ctx.formatDigits);
        return Number(exp ? `${main}e${exp}` : main);
      }

      const arg = parseFunctionArg();
      if (name === '√') {
        if (arg < 0) throw new Error('Math ERROR');
        return Math.sqrt(arg);
      }
      if (name === '³√') return Math.cbrt(arg);
      if (name === 'log') {
        if (arg <= 0) throw new Error('Math ERROR');
        return Math.log10(arg);
      }
      if (name === 'ln') {
        if (arg <= 0) throw new Error('Math ERROR');
        return Math.log(arg);
      }
      if (name === 'sin') return Math.sin(toRadians(arg, ctx.angleUnit));
      if (name === 'cos') return Math.cos(toRadians(arg, ctx.angleUnit));
      if (name === 'tan') {
        const rad = toRadians(arg, ctx.angleUnit);
        if (Math.abs(Math.cos(rad)) < 1e-12) throw new Error('Math ERROR');
        return Math.tan(rad);
      }
      if (name === 'sin⁻¹') {
        if (arg < -1 || arg > 1) throw new Error('Math ERROR');
        return fromRadians(Math.asin(arg), ctx.angleUnit);
      }
      if (name === 'cos⁻¹') {
        if (arg < -1 || arg > 1) throw new Error('Math ERROR');
        return fromRadians(Math.acos(arg), ctx.angleUnit);
      }
      if (name === 'tan⁻¹') return fromRadians(Math.atan(arg), ctx.angleUnit);
      if (name === 'sinh') return Math.sinh(arg);
      if (name === 'cosh') return Math.cosh(arg);
      if (name === 'tanh') return Math.tanh(arg);
      if (name === 'sinh⁻¹') return Math.asinh(arg);
      if (name === 'cosh⁻¹') {
        if (arg < 1) throw new Error('Math ERROR');
        return Math.acosh(arg);
      }
      if (name === 'tanh⁻¹') {
        if (arg <= -1 || arg >= 1) throw new Error('Math ERROR');
        return Math.atanh(arg);
      }
    }

    throw new Error('Syntax ERROR');
  }

  const res = parseExpOrAdd();
  if (pos < tokens.length) throw new Error('Syntax ERROR');
  if (!Number.isFinite(res)) throw new Error('Math ERROR');
  return res;
}

export const CasioFx82MsView: React.FC = () => {
  const initialSettings = useMemo(() => loadPersistedSettings(), []);
  const [isOn, setIsOn] = useState(true);
  const [shift, setShift] = useState(false);
  const [alpha, setAlpha] = useState(false);
  const [hyp, setHyp] = useState(false);
  const [insMode, setInsMode] = useState(false);
  const [stoPending, setStoPending] = useState(false);
  const [rclPending, setRclPending] = useState(false);

  // Persisted settings + persisted Variables (survive OFF!)
  const [calcMode, setCalcMode] = useState<CalcMode>(initialSettings.calcMode);
  const [angleUnit, setAngleUnit] = useState<AngleUnit>(initialSettings.angleUnit);
  const [numFormat, setNumFormat] = useState<NumberFormat>(initialSettings.numFormat);
  const [formatDigits, setFormatDigits] = useState<number>(initialSettings.formatDigits);
  const [fractionDisplay, setFractionDisplay] = useState<FractionDisplay>(
    initialSettings.fractionDisplay
  );
  const [vars, setVars] = useState<Record<VarName, number>>(() => loadPersistedVars());

  // Transient session state (history & Ans cleared on SHIFT+AC OFF!)
  const [expr, setExpr] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  const [lastAnswer, setLastAnswer] = useState<number>(0);
  const [displayResult, setDisplayResult] = useState<{
    main: string;
    exp: string | null;
    rawNum: number | null;
    customText?: string;
  }>({ main: '0.', exp: null, rawNum: 0 });
  const [errorText, setErrorText] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const [justEvaluated, setJustEvaluated] = useState(false);
  const [engShift, setEngShift] = useState(0);
  const [asFraction, setAsFraction] = useState(false);
  const [asDms, setAsDms] = useState(false);
  const [menu, setMenu] = useState<MenuState>({ kind: 'none' });
  const [statData, setStatData] = useState<StatPoint[]>([]);
  const [showManual, setShowManual] = useState(false);

  const exprInputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    savePersistedVars(vars);
  }, [vars]);

  useEffect(() => {
    try {
      localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify({ calcMode, angleUnit, numFormat, formatDigits, fractionDisplay })
      );
    } catch {
      // ignore
    }
  }, [calcMode, angleUnit, numFormat, formatDigits, fractionDisplay]);

  const clearModifiers = () => {
    setShift(false);
    setAlpha(false);
    setHyp(false);
    setStoPending(false);
    setRclPending(false);
  };

  const renderNumberOutput = useCallback(
    (
      val: number,
      opts?: { fraction?: boolean; dms?: boolean; eng?: number; label?: string }
    ) => {
      if (opts?.dms) {
        setDisplayResult({
          main: formatDms(val),
          exp: null,
          rawNum: val,
          customText: opts?.label,
        });
        return;
      }
      if (opts?.fraction) {
        const fracText = formatFractionDisplay(val, fractionDisplay);
        if (fracText) {
          setDisplayResult({
            main: fracText,
            exp: null,
            rawNum: val,
            customText: opts?.label,
          });
          return;
        }
      }
      const { main, exp } = formatCasioNumber(
        val,
        numFormat,
        formatDigits,
        opts?.eng ?? 0
      );
      setDisplayResult({
        main,
        exp,
        rawNum: val,
        customText: opts?.label,
      });
    },
    [formatDigits, fractionDisplay, numFormat]
  );

  // Re-format visible answer if Format or Fraction display changes
  useEffect(() => {
    if (displayResult.rawNum !== null && !errorText && menu.kind === 'none') {
      try {
        renderNumberOutput(displayResult.rawNum, {
          fraction: asFraction,
          dms: asDms,
          eng: engShift,
          label: displayResult.customText,
        });
      } catch {
        // ignore
      }
    }
  }, [numFormat, formatDigits, fractionDisplay]);

  const insertToken = useCallback(
    (token: string, autoStartWithAns = false) => {
      if (!isOn) return;
      setErrorText(null);
      setMenu({ kind: 'none' });

      if (justEvaluated && autoStartWithAns && expr === '') {
        const nextExpr = `Ans${token}`;
        setExpr(nextExpr);
        setCursorPos(nextExpr.length);
        setJustEvaluated(false);
        return;
      }

      if (justEvaluated && !autoStartWithAns) {
        setExpr(token);
        setCursorPos(token.length);
        setJustEvaluated(false);
        setAsFraction(false);
        setAsDms(false);
        setEngShift(0);
        return;
      }

      setExpr((prev) => {
        const safePos = Math.max(0, Math.min(cursorPos, prev.length));
        const next = insMode
          ? prev.slice(0, safePos) + token + prev.slice(safePos + 1)
          : prev.slice(0, safePos) + token + prev.slice(safePos);
        setCursorPos(safePos + token.length);
        return next;
      });
      setJustEvaluated(false);
    },
    [cursorPos, expr, insMode, isOn, justEvaluated]
  );

  const handlePowerOff = useCallback(() => {
    setIsOn(false);
    clearModifiers();
    setMenu({ kind: 'none' });
    setExpr('');
    setCursorPos(0);
    setErrorText(null);
    // Requirement: replay history is erased once turned off, while variables (A..F, X, Y, M) stay persisted!
    setHistory([]);
    setHistoryIdx(-1);
    setLastAnswer(0);
    setStatData([]);
    setDisplayResult({ main: '', exp: null, rawNum: null });
  }, []);

  const handlePowerOn = useCallback(() => {
    setIsOn(true);
    clearModifiers();
    setMenu({ kind: 'none' });
    setExpr('');
    setCursorPos(0);
    setErrorText(null);
    setJustEvaluated(false);
    setEngShift(0);
    setAsFraction(false);
    setAsDms(false);
    setDisplayResult({ main: '0.', exp: null, rawNum: 0 });
  }, []);

  const handleAllClear = useCallback(() => {
    if (!isOn) return;
    if (shift) {
      handlePowerOff();
      return;
    }
    clearModifiers();
    setMenu({ kind: 'none' });
    setExpr('');
    setCursorPos(0);
    setErrorText(null);
    setJustEvaluated(false);
    setEngShift(0);
    setAsFraction(false);
    setAsDms(false);
    setDisplayResult({ main: '0.', exp: null, rawNum: 0 });
  }, [handlePowerOff, isOn, shift]);

  const handleVarKey = useCallback(
    (v: VarName): boolean => {
      if (stoPending) {
        let targetVal = lastAnswer;
        if (expr.trim().length > 0 && !justEvaluated) {
          try {
            const tempVars = { ...vars };
            targetVal = evaluateExpression(expr, {
              vars: tempVars,
              ans: lastAnswer,
              angleUnit,
              numFormat,
              formatDigits,
              onAssignVar: (k, val) => {
                tempVars[k] = val;
              },
            });
            setLastAnswer(targetVal);
          } catch (err) {
            setErrorText(err instanceof Error ? err.message : 'Syntax ERROR');
            clearModifiers();
            return true;
          }
        }
        setVars((prev) => ({ ...prev, [v]: targetVal }));
        setExpr(`${expr || 'Ans'}→${v}`);
        setJustEvaluated(true);
        renderNumberOutput(targetVal);
        clearModifiers();
        return true;
      }

      if (rclPending) {
        const val = vars[v] ?? 0;
        setExpr(`${v}=`);
        setJustEvaluated(true);
        renderNumberOutput(val);
        clearModifiers();
        return true;
      }

      if (alpha) {
        insertToken(v);
        clearModifiers();
        return true;
      }
      return false;
    },
    [
      alpha,
      angleUnit,
      expr,
      formatDigits,
      insertToken,
      justEvaluated,
      lastAnswer,
      numFormat,
      rclPending,
      renderNumberOutput,
      stoPending,
      vars,
    ]
  );

  const handleEvaluate = useCallback(() => {
    if (!isOn) return;

    if (menu.kind === 'clr_confirm') {
      if (menu.target === 'mcl') {
        setVars({ ...DEFAULT_VARS });
        setStatData([]);
      } else if (menu.target === 'mode') {
        setCalcMode('COMP');
        setAngleUnit('DEG');
        setNumFormat('NORM1');
        setFormatDigits(0);
        setFractionDisplay('MIXED');
      } else if (menu.target === 'all') {
        setVars({ ...DEFAULT_VARS });
        setStatData([]);
        setCalcMode('COMP');
        setAngleUnit('DEG');
        setNumFormat('NORM1');
        setFormatDigits(0);
        setFractionDisplay('MIXED');
        setHistory([]);
        setHistoryIdx(-1);
        setLastAnswer(0);
      }
      setMenu({ kind: 'none' });
      setExpr('');
      setCursorPos(0);
      setDisplayResult({ main: '0.', exp: null, rawNum: 0 });
      clearModifiers();
      return;
    }

    // Check STAT mode DT entry if user typed expression and hit =? On fx-82MS '=' evaluates COMP normally
    const sourceExpr = expr.trim();
    if (!sourceExpr) {
      if (displayResult.rawNum !== null) {
        renderNumberOutput(displayResult.rawNum, { fraction: asFraction, dms: asDms });
      }
      return;
    }

    // Handle multi-statement ':'
    const statements = sourceExpr.split(':').filter((s) => s.trim().length > 0);
    if (statements.length === 0) return;

    const workingVars = { ...vars };
    let runningAns = lastAnswer;
    let finalVal = 0;

    try {
      for (const stmt of statements) {
        finalVal = evaluateExpression(stmt, {
          vars: workingVars,
          ans: runningAns,
          angleUnit,
          numFormat,
          formatDigits,
          onAssignVar: (k, val) => {
            workingVars[k] = val;
          },
        });
        runningAns = finalVal;
      }
      setVars(workingVars);
      setLastAnswer(finalVal);
      setErrorText(null);
      setEngShift(0);
      setAsFraction(false);
      setAsDms(false);
      setJustEvaluated(true);

      const { main, exp } = formatCasioNumber(finalVal, numFormat, formatDigits);
      const formattedSummary = exp ? `${main}×10^${exp}` : main;
      setDisplayResult({ main, exp, rawNum: finalVal });

      setHistory((prev) => {
        const next = [
          ...prev,
          { expr: sourceExpr, resultNum: finalVal, displayText: formattedSummary },
        ];
        return next.slice(-MAX_REPLAY_HISTORY);
      });
      setHistoryIdx(-1);
      clearModifiers();
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'Syntax ERROR');
      clearModifiers();
    }
  }, [
    angleUnit,
    asDms,
    asFraction,
    displayResult.rawNum,
    expr,
    formatDigits,
    isOn,
    lastAnswer,
    menu,
    numFormat,
    renderNumberOutput,
    vars,
  ]);

  const computeStats = useMemo(() => {
    const n = statData.reduce((acc, p) => acc + p.freq, 0);
    if (n === 0) {
      return {
        n: 0,
        sumX: 0,
        sumX2: 0,
        meanX: 0,
        sxN: 0,
        sxNm1: 0,
        sumY: 0,
        sumY2: 0,
        sumXY: 0,
        meanY: 0,
        syN: 0,
        syNm1: 0,
        regA: 0,
        regB: 0,
        regR: 0,
      };
    }
    let sumX = 0;
    let sumX2 = 0;
    let sumY = 0;
    let sumY2 = 0;
    let sumXY = 0;
    for (const p of statData) {
      const y = p.y ?? 0;
      sumX += p.x * p.freq;
      sumX2 += p.x * p.x * p.freq;
      sumY += y * p.freq;
      sumY2 += y * y * p.freq;
      sumXY += p.x * y * p.freq;
    }
    const meanX = sumX / n;
    const meanY = sumY / n;
    const varX = Math.max(0, sumX2 / n - meanX * meanX);
    const varY = Math.max(0, sumY2 / n - meanY * meanY);
    const sxN = Math.sqrt(varX);
    const syN = Math.sqrt(varY);
    const sxNm1 = n > 1 ? Math.sqrt((varX * n) / (n - 1)) : 0;
    const syNm1 = n > 1 ? Math.sqrt((varY * n) / (n - 1)) : 0;

    const sxx = sumX2 - (sumX * sumX) / n;
    const syy = sumY2 - (sumY * sumY) / n;
    const sxy = sumXY - (sumX * sumY) / n;
    const regB = sxx !== 0 ? sxy / sxx : 0;
    const regA = meanY - regB * meanX;
    const regR = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;

    return { n, sumX, sumX2, meanX, sxN, sxNm1, sumY, sumY2, sumXY, meanY, syN, syNm1, regA, regB, regR };
  }, [statData]);

  const handleDigitSelectMenu = useCallback(
    (digit: number): boolean => {
      if (menu.kind === 'none') return false;

      if (menu.kind === 'mode') {
        if (menu.page === 1) {
          if (digit === 1) setCalcMode('COMP');
          else if (digit === 2) setCalcMode('SD');
          else if (digit === 3) setCalcMode('REG');
          else return true;
          setMenu({ kind: 'none' });
          return true;
        }
        if (menu.page === 2) {
          if (digit === 1) setAngleUnit('DEG');
          else if (digit === 2) setAngleUnit('RAD');
          else if (digit === 3) setAngleUnit('GRA');
          else return true;
          setMenu({ kind: 'none' });
          return true;
        }
        if (menu.page === 3) {
          if (digit === 1) setMenu({ kind: 'fix_digits' });
          else if (digit === 2) setMenu({ kind: 'sci_digits' });
          else if (digit === 3) setMenu({ kind: 'norm_digits' });
          return true;
        }
        if (menu.page === 4) {
          if (digit === 1) setFractionDisplay('MIXED');
          else if (digit === 2) setFractionDisplay('IMPROPER');
          else return true;
          setMenu({ kind: 'none' });
          return true;
        }
      }

      if (menu.kind === 'fix_digits' && digit >= 0 && digit <= 9) {
        setNumFormat('FIX');
        setFormatDigits(digit);
        setMenu({ kind: 'none' });
        return true;
      }
      if (menu.kind === 'sci_digits' && digit >= 0 && digit <= 9) {
        setNumFormat('SCI');
        setFormatDigits(digit);
        setMenu({ kind: 'none' });
        return true;
      }
      if (menu.kind === 'norm_digits' && (digit === 1 || digit === 2)) {
        setNumFormat(digit === 1 ? 'NORM1' : 'NORM2');
        setMenu({ kind: 'none' });
        return true;
      }
      if (menu.kind === 'clr') {
        if (digit === 1) setMenu({ kind: 'clr_confirm', target: 'mcl' });
        else if (digit === 2) setMenu({ kind: 'clr_confirm', target: 'mode' });
        else if (digit === 3) setMenu({ kind: 'clr_confirm', target: 'all' });
        return true;
      }
      if (menu.kind === 'drg') {
        if (digit === 1) insertToken('°');
        else if (digit === 2) insertToken('ʳ');
        else if (digit === 3) insertToken('ᵍ');
        setMenu({ kind: 'none' });
        return true;
      }
      if (menu.kind === 's_sum') {
        const s = computeStats;
        let v: number | null = null;
        if (menu.page === 1) {
          if (digit === 1) v = s.sumX2;
          else if (digit === 2) v = s.sumX;
          else if (digit === 3) v = s.n;
        } else {
          if (digit === 1) v = s.sumY2;
          else if (digit === 2) v = s.sumY;
          else if (digit === 3) v = s.sumXY;
        }
        if (v !== null) {
          setLastAnswer(v);
          setJustEvaluated(true);
          renderNumberOutput(v);
          setMenu({ kind: 'none' });
        }
        return true;
      }
      if (menu.kind === 's_var') {
        const s = computeStats;
        let v: number | null = null;
        if (menu.page === 1) {
          if (digit === 1) v = s.meanX;
          else if (digit === 2) v = s.sxN;
          else if (digit === 3) v = s.sxNm1;
        } else if (menu.page === 2) {
          if (digit === 1) v = s.meanY;
          else if (digit === 2) v = s.syN;
          else if (digit === 3) v = s.syNm1;
        } else {
          if (digit === 1) v = s.regA;
          else if (digit === 2) v = s.regB;
          else if (digit === 3) v = s.regR;
        }
        if (v !== null) {
          setLastAnswer(v);
          setJustEvaluated(true);
          renderNumberOutput(v);
          setMenu({ kind: 'none' });
        }
        return true;
      }
      return false;
    },
    [computeStats, insertToken, menu, renderNumberOutput]
  );

  const handleReplayPad = useCallback(
    (dir: 'up' | 'down' | 'left' | 'right') => {
      if (!isOn) return;
      if (menu.kind === 's_sum') {
        if (dir === 'right' || dir === 'down') {
          setMenu({ kind: 's_sum', page: calcMode === 'REG' && menu.page === 1 ? 2 : 1 });
        } else {
          setMenu({ kind: 's_sum', page: calcMode === 'REG' && menu.page === 2 ? 1 : 2 });
        }
        return;
      }
      if (menu.kind === 's_var' && calcMode === 'REG') {
        const nextPage =
          dir === 'right' || dir === 'down'
            ? ((menu.page % 3) + 1) as 1 | 2 | 3
            : (((menu.page + 1) % 3) + 1) as 1 | 2 | 3;
        setMenu({ kind: 's_var', page: nextPage });
        return;
      }

      if (errorText && (dir === 'left' || dir === 'right')) {
        setErrorText(null);
        setJustEvaluated(false);
        setCursorPos(dir === 'left' ? expr.length : 0);
        return;
      }

      if (dir === 'up') {
        if (history.length === 0) return;
        const nextIdx =
          historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1);
        setHistoryIdx(nextIdx);
        const item = history[nextIdx];
        setExpr(item.expr);
        setCursorPos(item.expr.length);
        setJustEvaluated(true);
        setErrorText(null);
        renderNumberOutput(item.resultNum);
      } else if (dir === 'down') {
        if (history.length === 0 || historyIdx === -1) return;
        if (historyIdx >= history.length - 1) {
          setHistoryIdx(-1);
          setExpr('');
          setCursorPos(0);
          setJustEvaluated(false);
          setDisplayResult({ main: '0.', exp: null, rawNum: 0 });
          return;
        }
        const nextIdx = historyIdx + 1;
        setHistoryIdx(nextIdx);
        const item = history[nextIdx];
        setExpr(item.expr);
        setCursorPos(item.expr.length);
        setJustEvaluated(true);
        renderNumberOutput(item.resultNum);
      } else if (dir === 'left') {
        setJustEvaluated(false);
        setCursorPos((p) => (p > 0 ? p - 1 : expr.length));
      } else if (dir === 'right') {
        setJustEvaluated(false);
        setCursorPos((p) => (p < expr.length ? p + 1 : 0));
      }
    },
    [calcMode, errorText, expr.length, history, historyIdx, isOn, menu, renderNumberOutput]
  );

  const handleDigit = (d: number) => {
    if (!isOn) return;
    if (handleDigitSelectMenu(d)) {
      clearModifiers();
      return;
    }

    if (shift && d === 1) {
      if (calcMode === 'COMP') {
        setErrorText('Stat Mode Only');
      } else {
        setMenu({ kind: 's_sum', page: 1 });
      }
      clearModifiers();
      return;
    }
    if (shift && d === 2) {
      if (calcMode === 'COMP') {
        setErrorText('Stat Mode Only');
      } else {
        setMenu({ kind: 's_var', page: 1 });
      }
      clearModifiers();
      return;
    }
    if (shift && d === 0) {
      insertToken('Rnd(');
      clearModifiers();
      return;
    }

    insertToken(String(d));
    clearModifiers();
  };

  const handleDelete = () => {
    if (!isOn) return;
    if (shift) {
      setInsMode((v) => !v);
      clearModifiers();
      return;
    }
    setErrorText(null);
    if (justEvaluated) {
      setJustEvaluated(false);
      setCursorPos(expr.length);
      return;
    }
    if (cursorPos <= 0 || expr.length === 0) return;
    const spans = getTokenSpansForDelete(expr);
    const targetSpan = spans.find((sp) => sp.start < cursorPos && cursorPos <= sp.end);
    if (targetSpan) {
      const next = expr.slice(0, targetSpan.start) + expr.slice(targetSpan.end);
      setExpr(next);
      setCursorPos(targetSpan.start);
      return;
    }
    const next = expr.slice(0, cursorPos - 1) + expr.slice(cursorPos);
    setExpr(next);
    setCursorPos(cursorPos - 1);
  };

  const handleMPlus = () => {
    if (!isOn) return;
    if (handleVarKey('M')) return;

    // In SD / REG mode, M+ acts as DT (and SHIFT+M+ acts as CL)
    if (calcMode === 'SD' || calcMode === 'REG') {
      if (shift) {
        setStatData([]);
        setExpr('');
        setDisplayResult({ main: '0.', exp: null, rawNum: 0, customText: 'Stat CL' });
        clearModifiers();
        return;
      }
      try {
        const raw = expr.trim();
        if (!raw) return;
        const [dataPart, freqPart] = raw.split(';');
        const freq = freqPart ? Math.max(1, Math.round(Number(freqPart))) : 1;
        if (calcMode === 'SD') {
          const xVal = evaluateExpression(dataPart, {
            vars,
            ans: lastAnswer,
            angleUnit,
            numFormat,
            formatDigits,
            onAssignVar: () => {},
          });
          setStatData((prev) => {
            const next = [...prev, { x: xVal, freq }];
            const count = next.reduce((acc, p) => acc + p.freq, 0);
            setDisplayResult({ main: String(count), exp: null, rawNum: count, customText: `n=` });
            return next;
          });
        } else {
          const [xPart, yPart] = dataPart.split(',');
          if (!yPart) throw new Error('Syntax ERROR');
          const xVal = evaluateExpression(xPart, {
            vars,
            ans: lastAnswer,
            angleUnit,
            numFormat,
            formatDigits,
            onAssignVar: () => {},
          });
          const yVal = evaluateExpression(yPart, {
            vars,
            ans: lastAnswer,
            angleUnit,
            numFormat,
            formatDigits,
            onAssignVar: () => {},
          });
          setStatData((prev) => {
            const next = [...prev, { x: xVal, y: yVal, freq }];
            const count = next.reduce((acc, p) => acc + p.freq, 0);
            setDisplayResult({ main: String(count), exp: null, rawNum: count, customText: `n=` });
            return next;
          });
        }
        setExpr('');
        setCursorPos(0);
        setJustEvaluated(true);
      } catch (err) {
        setErrorText(err instanceof Error ? err.message : 'Syntax ERROR');
      }
      clearModifiers();
      return;
    }

    // Standard COMP mode M+ / SHIFT M-
    try {
      const targetVal =
        expr.trim().length > 0 && !justEvaluated
          ? evaluateExpression(expr, {
              vars,
              ans: lastAnswer,
              angleUnit,
              numFormat,
              formatDigits,
              onAssignVar: () => {},
            })
          : lastAnswer;
      const delta = shift ? -targetVal : targetVal;
      setVars((prev) => ({ ...prev, M: prev.M + delta }));
      setLastAnswer(targetVal);
      setJustEvaluated(true);
      renderNumberOutput(targetVal);
      clearModifiers();
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'Syntax ERROR');
      clearModifiers();
    }
  };

  // Physical Keyboard Shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (!isOn) {
        if (e.key === 'Enter' || e.key === ' ') handlePowerOn();
        return;
      }

      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        handleDigit(Number(e.key));
      } else if (e.key === '.') {
        e.preventDefault();
        insertToken('.');
      } else if (e.key === '+') {
        e.preventDefault();
        insertToken('+', true);
      } else if (e.key === '-') {
        e.preventDefault();
        insertToken('−', true);
      } else if (e.key === '*') {
        e.preventDefault();
        insertToken('×', true);
      } else if (e.key === '/') {
        e.preventDefault();
        insertToken('÷', true);
      } else if (e.key === '^') {
        e.preventDefault();
        insertToken('^', true);
      } else if (e.key === '(' || e.key === ')' || e.key === ',') {
        e.preventDefault();
        insertToken(e.key);
      } else if (e.key === 'Enter' || e.key === '=') {
        e.preventDefault();
        handleEvaluate();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleDelete();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleAllClear();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        handleReplayPad('up');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        handleReplayPad('down');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleReplayPad('left');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleReplayPad('right');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // Render LCD Menu or Expression Text
  const renderLcdLines = () => {
    if (!isOn) {
      return {
        top: '',
        bottom: '',
        exp: null as string | null,
      };
    }

    if (menu.kind === 'mode') {
      if (menu.page === 1) return { top: 'COMP   SD   REG', bottom: ' 1      2     3 ', exp: null };
      if (menu.page === 2) return { top: 'Deg   Rad   Gra', bottom: ' 1     2     3 ', exp: null };
      if (menu.page === 3) return { top: 'Fix   Sci   Norm', bottom: ' 1     2     3  ', exp: null };
      return { top: 'Disp  ab/c  d/c', bottom: '       1     2 ', exp: null };
    }
    if (menu.kind === 'fix_digits') return { top: 'Fix  0 ~ 9 ?', bottom: '', exp: null };
    if (menu.kind === 'sci_digits') return { top: 'Sci  0 ~ 9 ?', bottom: '', exp: null };
    if (menu.kind === 'norm_digits') return { top: 'Norm  1 ~ 2 ?', bottom: '', exp: null };
    if (menu.kind === 'clr') return { top: 'Mcl  Mode  All', bottom: ' 1    2     3 ', exp: null };
    if (menu.kind === 'clr_confirm') {
      const label =
        menu.target === 'mcl'
          ? 'Mem Clear'
          : menu.target === 'mode'
            ? 'Mode Clear'
            : 'Reset All';
      return { top: label, bottom: '=:Yes   AC:No', exp: null };
    }
    if (menu.kind === 'drg') return { top: 'D     R     G', bottom: '1     2     3', exp: null };
    if (menu.kind === 's_sum') {
      return menu.page === 1
        ? { top: 'Σx²   Σx    n', bottom: ' 1     2     3', exp: null }
        : { top: 'Σy²   Σy   Σxy', bottom: ' 1     2     3', exp: null };
    }
    if (menu.kind === 's_var') {
      if (menu.page === 1) return { top: 'x̄    xσn  xσn-1', bottom: '1     2     3  ', exp: null };
      if (menu.page === 2) return { top: 'ȳ    yσn  yσn-1', bottom: '1     2     3  ', exp: null };
      return { top: 'A     B     r', bottom: '1     2     3', exp: null };
    }

    if (errorText) {
      return { top: errorText, bottom: '[AC]:Cancel  [◀][▶]:Goto', exp: null };
    }

    return {
      top: expr || '',
      bottom: displayResult.main,
      exp: displayResult.exp,
    };
  };

  const lcd = renderLcdLines();

  // Render expression with visible Casio cursor when editing
  const renderExprWithCursor = () => {
    if (menu.kind !== 'none' || errorText) {
      return <span>{lcd.top}</span>;
    }
    if (!isOn) return null;
    if (justEvaluated) return <span>{expr}</span>;
    const before = expr.slice(0, cursorPos);
    const at = expr[cursorPos] || ' ';
    const after = expr.slice(cursorPos + 1);
    return (
      <span>
        {before}
        <span
          className={`inline-block min-w-[0.55em] text-center ${
            insMode
              ? 'border-b-2 border-slate-900 bg-slate-900/15'
              : 'bg-slate-900 text-[#9AA692]'
          }`}
        >
          {at}
        </span>
        {after}
      </span>
    );
  };

  const stoActive = stoPending;
  const rclActive = rclPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            Casio fx-82MS Scientific Calculator Simulator
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Non-programmable 2-line S-V.P.A.M. 2nd Edition · SHIFT &amp; ALPHA keys · MODE/CLR · Persistent A–F, X, Y, M variables · Session replay history (erased on OFF).
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowManual((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 self-start sm:self-auto"
        >
          <Info className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
          {showManual ? 'Hide Key Guide' : 'Key & Mode Guide'}
        </button>
      </div>

      {/* Main 2-Zone Layout: Hardware Chassis + Live Memory/Replay Inspector */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* LEFT / CENTER: Authentic Casio fx-82MS Hardware Body */}
        <div className="lg:col-span-6 xl:col-span-5 flex justify-center">
          <div
            className="w-full max-w-[390px] rounded-[26px] border-2 border-[#1b1c20] bg-gradient-to-b from-[#3b3c41] via-[#2e2f34] to-[#232428] p-4 sm:p-5 shadow-2xl select-none text-white asan-card-hover"
            aria-label="Casio fx-82MS Calculator"
          >
            {/* Top Branding Bar */}
            <div className="flex items-start justify-between px-1 pb-2">
              <span className="font-sans text-lg font-extrabold tracking-wide text-slate-100">
                CASIO
              </span>
              <div className="text-right leading-tight">
                <div className="font-sans text-sm font-bold italic text-slate-200">
                  fx-82MS
                </div>
                <div className="text-[10px] font-semibold text-amber-300/90">
                  2nd edition
                </div>
              </div>
            </div>

            <div className="text-center pb-2.5">
              <div className="text-[11px] font-bold tracking-[0.22em] text-slate-100">
                S-V.P.A.M.
              </div>
            </div>

            {/* Dual-Line LCD Display */}
            <div className="rounded-xl border-4 border-[#1c1d21] bg-[#202125] p-1.5 shadow-inner mb-4">
              <div
                className={`rounded-md px-3 py-2.5 transition-colors font-mono ${
                  isOn
                    ? 'bg-[#9AA692] text-[#172017] shadow-inner'
                    : 'bg-[#646d5f] text-[#4c5347]'
                }`}
              >
                {/* Annunciator Status Bar */}
                <div className="flex items-center justify-between text-[9px] font-bold tracking-wider h-3.5 uppercase">
                  <div className="flex items-center gap-1.5">
                    <span className={shift && isOn ? 'opacity-100 bg-[#172017] text-[#9AA692] px-1 rounded-[2px]' : 'opacity-15'}>
                      S
                    </span>
                    <span className={alpha && isOn ? 'opacity-100 bg-[#172017] text-[#9AA692] px-1 rounded-[2px]' : 'opacity-15'}>
                      A
                    </span>
                    <span className={vars.M !== 0 && isOn ? 'opacity-100' : 'opacity-15'}>M</span>
                    <span className={stoActive && isOn ? 'opacity-100' : 'opacity-15'}>STO</span>
                    <span className={rclActive && isOn ? 'opacity-100' : 'opacity-15'}>RCL</span>
                    <span className={hyp && isOn ? 'opacity-100' : 'opacity-15'}>HYP</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={calcMode !== 'COMP' && isOn ? 'opacity-100' : 'opacity-15'}>
                      {calcMode === 'COMP' ? 'SD' : calcMode}
                    </span>
                    <span className={isOn ? 'opacity-100' : 'opacity-15'}>
                      {angleUnit === 'DEG' ? 'D' : angleUnit === 'RAD' ? 'R' : 'G'}
                    </span>
                    <span className={(numFormat === 'FIX' || numFormat === 'SCI') && isOn ? 'opacity-100' : 'opacity-15'}>
                      {numFormat === 'FIX' ? 'FIX' : numFormat === 'SCI' ? 'SCI' : 'FIX'}
                    </span>
                    <span className={history.length > 0 && isOn ? 'opacity-100' : 'opacity-15'}>
                      ▲▼
                    </span>
                  </div>
                </div>

                {/* Line 1: Expression / Menu Top Line */}
                <div
                  ref={exprInputRef}
                  className="mt-1 min-h-[26px] overflow-x-auto whitespace-nowrap text-base font-semibold tracking-tight leading-snug no-scrollbar"
                >
                  {isOn ? renderExprWithCursor() : <span className="text-[11px] opacity-40">POWER OFF (Vars Saved)</span>}
                </div>

                {/* Line 2: Numeric Result / Menu Prompt Bottom Line */}
                <div className="mt-1 flex min-h-[30px] items-baseline justify-end gap-1 overflow-x-auto whitespace-nowrap text-right tabular-nums">
                  {isOn && (
                    <>
                      {displayResult.customText && menu.kind === 'none' && !errorText && (
                        <span className="mr-auto text-xs font-bold opacity-80">
                          {displayResult.customText}
                        </span>
                      )}
                      <span className="text-xl font-bold tracking-tight">
                        {lcd.bottom}
                      </span>
                      {lcd.exp !== null && (
                        <span className="inline-flex items-start text-[11px] font-bold">
                          <span className="mr-0.5 text-[9px] mt-1">×10</span>
                          <span className="text-xs -mt-1">{lcd.exp}</span>
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* TOP CONTROL ROW: SHIFT, ALPHA, REPLAY D-PAD, MODE/CLR, ON */}
            <div className="grid grid-cols-6 items-center gap-1.5 mb-2">
              <div className="flex flex-col items-center">
                <span className="text-[9px] font-bold text-[#e5be46] mb-0.5">SHIFT</span>
                <button
                  type="button"
                  onClick={() => {
                    if (!isOn) return;
                    setShift((s) => !s);
                    setAlpha(false);
                  }}
                  className={`h-7 w-full rounded-full border border-slate-900 text-[10px] font-bold shadow ${
                    shift
                      ? 'bg-[#e5be46] text-slate-900'
                      : 'bg-[#3d3e44] text-slate-200 hover:bg-[#494b52]'
                  }`}
                >
                  SHIFT
                </button>
              </div>

              <div className="flex flex-col items-center">
                <span className="text-[9px] font-bold text-[#ea7aa6] mb-0.5">ALPHA</span>
                <button
                  type="button"
                  onClick={() => {
                    if (!isOn) return;
                    setAlpha((a) => !a);
                    setShift(false);
                  }}
                  className={`h-7 w-full rounded-full border border-slate-900 text-[10px] font-bold shadow ${
                    alpha
                      ? 'bg-[#ea7aa6] text-slate-900'
                      : 'bg-[#3d3e44] text-slate-200 hover:bg-[#494b52]'
                  }`}
                >
                  ALPHA
                </button>
              </div>

              {/* 4-Way REPLAY Pad */}
              <div className="col-span-2 flex items-center justify-center row-span-2">
                <div className="relative h-[74px] w-[96px] rounded-[28px] border border-slate-900 bg-[#27282c] shadow-inner flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => handleReplayPad('up')}
                    aria-label="Replay Up"
                    className="absolute top-1 left-1/2 -translate-x-1/2 flex h-5 w-8 items-center justify-center rounded-t-lg bg-[#3c3d43] hover:bg-[#4b4d55] text-slate-200"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReplayPad('down')}
                    aria-label="Replay Down"
                    className="absolute bottom-1 left-1/2 -translate-x-1/2 flex h-5 w-8 items-center justify-center rounded-b-lg bg-[#3c3d43] hover:bg-[#4b4d55] text-slate-200"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReplayPad('left')}
                    aria-label="Cursor Left"
                    className="absolute left-1 top-1/2 -translate-y-1/2 flex h-7 w-5 items-center justify-center rounded-l-lg bg-[#3c3d43] hover:bg-[#4b4d55] text-slate-200"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReplayPad('right')}
                    aria-label="Cursor Right"
                    className="absolute right-1 top-1/2 -translate-y-1/2 flex h-7 w-5 items-center justify-center rounded-r-lg bg-[#3c3d43] hover:bg-[#4b4d55] text-slate-200"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                  <span className="text-[8px] font-semibold tracking-wider text-slate-400 pointer-events-none">
                    REPLAY
                  </span>
                </div>
              </div>

              <div className="flex flex-col items-center">
                <div className="flex gap-1 text-[8px] font-bold mb-0.5">
                  <span className="text-slate-200">MODE</span>
                  <span className="text-[#e5be46]">CLR</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!isOn) return;
                    if (shift) {
                      setMenu({ kind: 'clr' });
                      clearModifiers();
                      return;
                    }
                    setMenu((prev) =>
                      prev.kind === 'mode'
                        ? { kind: 'mode', page: ((prev.page % 4) + 1) as 1 | 2 | 3 | 4 }
                        : { kind: 'mode', page: 1 }
                    );
                    clearModifiers();
                  }}
                  className="h-7 w-full rounded-full border border-slate-900 bg-[#3d3e44] text-[9px] font-bold text-slate-100 shadow hover:bg-[#494b52]"
                >
                  MODE
                </button>
              </div>

              <div className="flex flex-col items-center">
                <span className="text-[9px] font-bold text-slate-200 mb-0.5">ON</span>
                <button
                  type="button"
                  onClick={handlePowerOn}
                  className="h-7 w-full rounded-full border border-slate-900 bg-[#3d3e44] text-[9px] font-bold text-slate-100 shadow hover:bg-[#494b52]"
                >
                  ON
                </button>
              </div>

              {/* Row 1 Flanking Keys around D-Pad: x⁻¹ | nCr | [D-pad] | Pol( | x³ */}
              <SciKey
                shiftLabel="x!"
                mainLabel="x⁻¹"
                onClick={() => {
                  if (!isOn) return;
                  insertToken(shift ? '!' : '⁻¹', true);
                  clearModifiers();
                }}
              />
              <SciKey
                shiftLabel="nPr"
                mainLabel="nCr"
                onClick={() => {
                  if (!isOn) return;
                  insertToken(shift ? 'ᴘ' : 'ᴄ', true);
                  clearModifiers();
                }}
              />
              <SciKey
                shiftLabel="Rec("
                alphaLabel=":"
                mainLabel="Pol("
                onClick={() => {
                  if (!isOn) return;
                  if (alpha) insertToken(':');
                  else insertToken(shift ? 'Rec(' : 'Pol(');
                  clearModifiers();
                }}
              />
              <SciKey
                shiftLabel="³√"
                mainLabel="x³"
                onClick={() => {
                  if (!isOn) return;
                  insertToken(shift ? '³√(' : '³', !shift);
                  clearModifiers();
                }}
              />
            </div>

            {/* SCIENTIFIC FUNCTION ROWS (6 columns) */}
            <div className="grid grid-cols-6 gap-1.5 mb-3">
              {/* Row 2 */}
              <SciKey
                shiftLabel="d/c"
                mainLabel="a b/c"
                onClick={() => {
                  if (!isOn) return;
                  if (justEvaluated && displayResult.rawNum !== null) {
                    if (shift) setFractionDisplay((m) => (m === 'MIXED' ? 'IMPROPER' : 'MIXED'));
                    setAsFraction((f) => {
                      const next = !f;
                      renderNumberOutput(displayResult.rawNum!, { fraction: next });
                      return next;
                    });
                    clearModifiers();
                    return;
                  }
                  insertToken('┘');
                  clearModifiers();
                }}
              />
              <SciKey
                mainLabel="√"
                onClick={() => {
                  if (!isOn) return;
                  insertToken('√(');
                  clearModifiers();
                }}
              />
              <SciKey
                mainLabel="x²"
                onClick={() => {
                  if (!isOn) return;
                  insertToken('²', true);
                  clearModifiers();
                }}
              />
              <SciKey
                shiftLabel="ˣ√"
                mainLabel="^"
                onClick={() => {
                  if (!isOn) return;
                  insertToken(shift ? 'ˣ√' : '^', true);
                  clearModifiers();
                }}
              />
              <SciKey
                shiftLabel="10ˣ"
                mainLabel="log"
                onClick={() => {
                  if (!isOn) return;
                  insertToken(shift ? '10^' : 'log(');
                  clearModifiers();
                }}
              />
              <SciKey
                shiftLabel="eˣ"
                alphaLabel="e"
                mainLabel="ln"
                onClick={() => {
                  if (!isOn) return;
                  if (alpha) insertToken('e');
                  else insertToken(shift ? 'e^' : 'ln(');
                  clearModifiers();
                }}
              />

              {/* Row 3 */}
              <SciKey
                alphaLabel="A"
                mainLabel="(−)"
                onClick={() => {
                  if (!isOn) return;
                  if (handleVarKey('A')) return;
                  insertToken('−');
                  clearModifiers();
                }}
              />
              <SciKey
                shiftLabel="←"
                alphaLabel="B"
                mainLabel="°′″"
                onClick={() => {
                  if (!isOn) return;
                  if (handleVarKey('B')) return;
                  if (justEvaluated && displayResult.rawNum !== null) {
                    setAsDms((d) => {
                      const next = !d;
                      renderNumberOutput(displayResult.rawNum!, { dms: next });
                      return next;
                    });
                    clearModifiers();
                    return;
                  }
                  insertToken('°');
                  clearModifiers();
                }}
              />
              <SciKey
                alphaLabel="C"
                mainLabel="hyp"
                onClick={() => {
                  if (!isOn) return;
                  if (handleVarKey('C')) return;
                  setHyp((h) => !h);
                }}
              />
              <SciKey
                shiftLabel="sin⁻¹"
                alphaLabel="D"
                mainLabel="sin"
                onClick={() => {
                  if (!isOn) return;
                  if (handleVarKey('D')) return;
                  const fn = hyp ? (shift ? 'sinh⁻¹(' : 'sinh(') : shift ? 'sin⁻¹(' : 'sin(';
                  insertToken(fn);
                  clearModifiers();
                }}
              />
              <SciKey
                shiftLabel="cos⁻¹"
                alphaLabel="E"
                mainLabel="cos"
                onClick={() => {
                  if (!isOn) return;
                  if (handleVarKey('E')) return;
                  const fn = hyp ? (shift ? 'cosh⁻¹(' : 'cosh(') : shift ? 'cos⁻¹(' : 'cos(';
                  insertToken(fn);
                  clearModifiers();
                }}
              />
              <SciKey
                shiftLabel="tan⁻¹"
                alphaLabel="F"
                mainLabel="tan"
                onClick={() => {
                  if (!isOn) return;
                  if (handleVarKey('F')) return;
                  const fn = hyp ? (shift ? 'tanh⁻¹(' : 'tanh(') : shift ? 'tan⁻¹(' : 'tan(';
                  insertToken(fn);
                  clearModifiers();
                }}
              />

              {/* Row 4 */}
              <SciKey
                shiftLabel="STO"
                mainLabel="RCL"
                onClick={() => {
                  if (!isOn) return;
                  if (shift) {
                    setStoPending(true);
                    setRclPending(false);
                    setShift(false);
                  } else {
                    setRclPending(true);
                    setStoPending(false);
                  }
                }}
              />
              <SciKey
                shiftLabel="←"
                mainLabel="ENG"
                onClick={() => {
                  if (!isOn) return;
                  if (displayResult.rawNum !== null) {
                    setEngShift((e) => {
                      const next = shift ? e - 1 : e + 1;
                      renderNumberOutput(displayResult.rawNum!, { eng: next });
                      return next;
                    });
                  }
                  clearModifiers();
                }}
              />
              <SciKey
                mainLabel="("
                onClick={() => {
                  if (!isOn) return;
                  insertToken('(');
                  clearModifiers();
                }}
              />
              <SciKey
                alphaLabel="X"
                mainLabel=")"
                onClick={() => {
                  if (!isOn) return;
                  if (handleVarKey('X')) return;
                  insertToken(')');
                  clearModifiers();
                }}
              />
              <SciKey
                shiftLabel=";"
                alphaLabel="Y"
                mainLabel=","
                onClick={() => {
                  if (!isOn) return;
                  if (handleVarKey('Y')) return;
                  insertToken(shift ? ';' : ',');
                  clearModifiers();
                }}
              />
              <SciKey
                shiftLabel="M-"
                alphaLabel="M"
                statLabel={calcMode !== 'COMP' ? 'DT · CL' : undefined}
                mainLabel="M+"
                onClick={handleMPlus}
              />
            </div>

            {/* NUMERIC & ARITHMETIC KEYPAD (5 columns) */}
            <div className="grid grid-cols-5 gap-2">
              <NumKey mainLabel="7" onClick={() => handleDigit(7)} />
              <NumKey mainLabel="8" onClick={() => handleDigit(8)} />
              <NumKey mainLabel="9" onClick={() => handleDigit(9)} />
              <NumKey
                shiftLabel="INS"
                mainLabel="DEL"
                variant="accent"
                onClick={handleDelete}
              />
              <NumKey
                shiftLabel="OFF"
                mainLabel="AC"
                variant="accent"
                onClick={handleAllClear}
              />

              <NumKey mainLabel="4" onClick={() => handleDigit(4)} />
              <NumKey mainLabel="5" onClick={() => handleDigit(5)} />
              <NumKey mainLabel="6" onClick={() => handleDigit(6)} />
              <NumKey mainLabel="×" onClick={() => { insertToken('×', true); clearModifiers(); }} />
              <NumKey mainLabel="÷" onClick={() => { insertToken('÷', true); clearModifiers(); }} />

              <NumKey
                shiftLabel="S-SUM"
                mainLabel="1"
                onClick={() => handleDigit(1)}
              />
              <NumKey
                shiftLabel="S-VAR"
                mainLabel="2"
                onClick={() => handleDigit(2)}
              />
              <NumKey mainLabel="3" onClick={() => handleDigit(3)} />
              <NumKey mainLabel="+" onClick={() => { insertToken('+', true); clearModifiers(); }} />
              <NumKey mainLabel="−" onClick={() => { insertToken('−', true); clearModifiers(); }} />

              <NumKey
                shiftLabel="Rnd"
                mainLabel="0"
                onClick={() => handleDigit(0)}
              />
              <NumKey
                shiftLabel="Ran#"
                mainLabel="."
                onClick={() => {
                  if (!isOn) return;
                  insertToken(shift ? 'Ran#' : '.');
                  clearModifiers();
                }}
              />
              <NumKey
                shiftLabel="π"
                mainLabel="×10ˣ"
                onClick={() => {
                  if (!isOn) return;
                  insertToken(shift ? 'π' : '×10^');
                  clearModifiers();
                }}
              />
              <NumKey
                shiftLabel="DRG▸"
                mainLabel="Ans"
                onClick={() => {
                  if (!isOn) return;
                  if (shift) {
                    setMenu({ kind: 'drg' });
                    clearModifiers();
                    return;
                  }
                  insertToken('Ans');
                  clearModifiers();
                }}
              />
              <NumKey
                shiftLabel="%"
                mainLabel="="
                onClick={() => {
                  if (!isOn) return;
                  if (shift) {
                    insertToken('%', true);
                    clearModifiers();
                    return;
                  }
                  handleEvaluate();
                }}
              />
            </div>
          </div>
        </div>

        {/* RIGHT: Variables Persistence, Mode Quick Controls & Replay History */}
        <div className="lg:col-span-6 xl:col-span-7 space-y-4">
          {/* Power & Quick State Strip */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-wrap items-center justify-between gap-3 asan-card-hover">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`inline-flex items-center gap-1.5 font-semibold ${
                  isOn ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Power className="h-3.5 w-3.5" />
                {isOn ? 'Power ON' : 'Power OFF'}
              </span>
              <span className="text-slate-300 dark:text-slate-600">·</span>
              <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{calcMode}</span>
              <span className="text-slate-300 dark:text-slate-600">·</span>
              <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{angleUnit}</span>
              <span className="text-slate-300 dark:text-slate-600">·</span>
              <span className="font-mono text-slate-600 dark:text-slate-400">
                {numFormat}
                {(numFormat === 'FIX' || numFormat === 'SCI') ? `(${formatDigits})` : ''}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => (isOn ? handlePowerOff() : handlePowerOn())}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                  isOn
                    ? 'border-rose-200 dark:border-rose-800/70 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/50'
                    : 'border-emerald-200 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50'
                }`}
              >
                <Power className="h-3.5 w-3.5" />
                {isOn ? 'Turn OFF (Erases History)' : 'Turn ON'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setVars({ ...DEFAULT_VARS });
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Mcl (Clear Vars)
              </button>
            </div>
          </div>

          {/* Variables Memory Bank (A-F, X, Y, M) — Persists across OFF/ON */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 asan-card-hover">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Variable Storage (A–F, X, Y, M)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Use <code className="rounded bg-slate-100 dark:bg-slate-800 px-1 font-mono text-slate-800 dark:text-slate-200">SHIFT + RCL (STO)</code> + key to store, or <code className="rounded bg-slate-100 dark:bg-slate-800 px-1 font-mono text-slate-800 dark:text-slate-200">ALPHA</code> + key inside expressions. Variables persist even when turned OFF.
                </p>
              </div>
              <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                Persisted Across OFF
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:grid-cols-3">
              {(Object.keys(DEFAULT_VARS) as VarName[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    if (!isOn) return;
                    insertToken(v);
                  }}
                  title={`Click to insert variable ${v}`}
                  className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-left hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50/40 dark:hover:bg-blue-950/30"
                >
                  <span className="font-mono text-xs font-bold text-rose-700 dark:text-rose-400">{v}</span>
                  <span className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200 tabular-nums truncate max-w-[110px]">
                    {Number((vars[v] ?? 0).toPrecision(8))}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Session Replay History (20-entry limit, erased when OFF) */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 asan-card-hover">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                  Replay History ({history.length} / {MAX_REPLAY_HISTORY})
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Navigate with Replay ▲ / ▼. Just like the real Casio fx-82MS, history is cleared when turned OFF (<code className="rounded bg-slate-100 dark:bg-slate-800 px-1 font-mono text-slate-800 dark:text-slate-200">SHIFT + AC</code>).
                </p>
              </div>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setHistory([]);
                    setHistoryIdx(-1);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-700 py-6 text-center text-xs text-slate-400 dark:text-slate-500">
                {isOn
                  ? 'No expressions evaluated in this power-on session yet.'
                  : 'Calculator is OFF — Replay history was cleared on shutdown.'}
              </div>
            ) : (
              <div className="lg:max-h-60 space-y-1.5 lg:overflow-y-auto pr-1">
                {[...history].reverse().map((item, idx) => (
                  <button
                    key={`${item.expr}-${idx}`}
                    type="button"
                    onClick={() => {
                      if (!isOn) return;
                      setExpr(item.expr);
                      setCursorPos(item.expr.length);
                      setJustEvaluated(false);
                      renderNumberOutput(item.resultNum);
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 px-3 py-2 text-left hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50/40 dark:hover:bg-blue-950/30"
                  >
                    <span className="truncate font-mono text-xs text-slate-700 dark:text-slate-300">
                      {item.expr}
                    </span>
                    <span className="shrink-0 font-mono text-xs font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                      = {item.displayText}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Stat Mode Live Entries Preview when in SD / REG */}
          {calcMode !== 'COMP' && (
            <div className="rounded-xl border border-blue-200 dark:border-blue-800/70 bg-blue-50/40 dark:bg-blue-950/30 p-4 space-y-2 asan-card-hover">
              <div className="flex items-center justify-between text-xs font-semibold text-blue-900 dark:text-blue-200">
                <span>
                  {calcMode === 'SD' ? 'SD Statistics Register' : 'REG Linear Regression Register'} · n = {computeStats.n}
                </span>
                <button
                  type="button"
                  onClick={() => setStatData([])}
                  className="text-[11px] font-medium text-blue-700 dark:text-blue-400 hover:underline"
                >
                  Clear Data (CL)
                </button>
              </div>
              <p className="text-[11px] text-blue-800 dark:text-blue-300">
                {calcMode === 'SD'
                  ? 'Type value (or x;freq) and press M+ (DT). Use SHIFT+1 (S-SUM) or SHIFT+2 (S-VAR) to recall Σx², Σx, n, x̄, xσn, xσn-1.'
                  : 'Type x,y (e.g. 2,5) and press M+ (DT). Use SHIFT+1 (S-SUM) or SHIFT+2 (S-VAR) for x̄, ȳ, A, B, and correlation r.'}
              </p>
            </div>
          )}

          {showManual && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-2 text-xs text-slate-600 dark:text-slate-300 asan-card-hover">
              <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                <Keyboard className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                Quick Reference &amp; Physical Keyboard Shortcuts
              </div>
              <ul className="list-disc pl-5 space-y-1 leading-relaxed">
                <li><strong>Store Variable:</strong> Compute value (or type expression), press <code className="font-mono">SHIFT → RCL (STO)</code>, then press <code className="font-mono">(−) [A]</code> through <code className="font-mono">M+ [M]</code>.</li>
                <li><strong>Fractions:</strong> Enter <code className="font-mono">1 a b/c 2 a b/c 3</code> for 1⅔, then press <code className="font-mono">=</code>. Press <code className="font-mono">a b/c</code> or <code className="font-mono">SHIFT + a b/c (d/c)</code> to toggle fraction / decimal.</li>
                <li><strong>Pol / Rec:</strong> <code className="font-mono">Pol(3,4) =</code> returns <code className="font-mono">5</code> and automatically stores r in <code className="font-mono">E</code> and θ in <code className="font-mono">F</code>.</li>
                <li><strong>MODE &amp; CLR:</strong> Press <code className="font-mono">MODE</code> to cycle Mode / Angle / Fix-Sci-Norm / Disp. Press <code className="font-mono">SHIFT + MODE (CLR)</code> for <code className="font-mono">1:Mcl</code>, <code className="font-mono">2:Mode</code>, <code className="font-mono">3:All</code>.</li>
                <li><strong>Keyboard:</strong> Digits, <code className="font-mono">+ - * / ^ ( ) , .</code>, <code className="font-mono">Enter (=)</code>, <code className="font-mono">Backspace (DEL)</code>, <code className="font-mono">Esc (AC)</code>, and Arrow Keys (Replay/Cursor).</li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface SciKeyProps {
  shiftLabel?: string;
  alphaLabel?: string;
  statLabel?: string;
  mainLabel: string;
  onClick: () => void;
}

const SciKey: React.FC<SciKeyProps> = ({
  shiftLabel,
  alphaLabel,
  statLabel,
  mainLabel,
  onClick,
}) => (
  <div className="flex flex-col items-center">
    <div className="flex min-h-[13px] w-full items-center justify-between px-0.5 text-[8px] font-bold leading-none">
      <span className="text-[#e5be46] truncate">{shiftLabel || ''}</span>
      <span className="text-[#ea7aa6] truncate">{alphaLabel || ''}</span>
    </div>
    <button
      type="button"
      onClick={onClick}
      className="h-7 w-full rounded-[6px] border border-slate-950 bg-[#25262b] px-1 text-[10px] font-semibold text-slate-100 shadow-sm hover:bg-[#35373e] active:translate-y-[0.5px]"
    >
      {mainLabel}
    </button>
    {statLabel && (
      <span className="mt-0.5 text-[7px] font-bold text-sky-400 leading-none">
        {statLabel}
      </span>
    )}
  </div>
);

interface NumKeyProps {
  shiftLabel?: string;
  mainLabel: string;
  variant?: 'default' | 'accent';
  onClick: () => void;
}

const NumKey: React.FC<NumKeyProps> = ({
  shiftLabel,
  mainLabel,
  variant = 'default',
  onClick,
}) => (
  <div className="flex flex-col items-center">
    <div className="min-h-[13px] text-[8.5px] font-bold text-[#e5be46] leading-tight">
      {shiftLabel || ''}
    </div>
    <button
      type="button"
      onClick={onClick}
      className={`h-9 w-full rounded-[8px] border border-slate-950 text-sm font-bold shadow hover:brightness-110 active:translate-y-[0.5px] ${
        variant === 'accent'
          ? 'bg-[#c94a6a] text-white'
          : 'bg-[#45474e] text-white'
      }`}
    >
      {mainLabel}
    </button>
  </div>
);
