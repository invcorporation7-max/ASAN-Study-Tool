// Deterministic Symbolic & Numerical Specialized Math Engines (No eval / No new Function / No LLM)

export interface CalcResult {
  title: string;
  primaryAnswer: string;
  secondaryAnswers?: { label: string; value: string }[];
  steps: string[];
  error?: string;
}

export function fmtNum(n: number, digits = 6): string {
  if (!Number.isFinite(n)) {
    if (Number.isNaN(n)) return 'Undefined';
    return n > 0 ? '+∞' : '-∞';
  }
  const clean = Math.abs(n) < 1e-11 ? 0 : n;
  if (Math.abs(clean - Math.round(clean)) < 1e-10) {
    return String(Math.round(clean));
  }
  return Number(clean.toPrecision(digits)).toString();
}

export function fmtComplex(re: number, im: number, digits = 5): string {
  const r = Math.abs(re) < 1e-10 ? 0 : re;
  const i = Math.abs(im) < 1e-10 ? 0 : im;
  if (i === 0) return fmtNum(r, digits);
  const absI = Math.abs(i);
  const iStr = Math.abs(absI - 1) < 1e-9 ? 'i' : `${fmtNum(absI, digits)}i`;
  if (r === 0) return i < 0 ? `-${iStr}` : iStr;
  return `${fmtNum(r, digits)} ${i < 0 ? '-' : '+'} ${iStr}`;
}

export function toExactFraction(val: number, maxDen = 1000, tol = 1e-8): { num: number; den: number } | null {
  if (!Number.isFinite(val)) return null;
  const sign = val < 0 ? -1 : 1;
  const x = Math.abs(val);
  let h1 = 1, h2 = 0, k1 = 0, k2 = 1;
  let b = x;
  for (let iter = 0; iter < 32; iter++) {
    const a = Math.floor(b);
    const h = a * h1 + h2;
    const k = a * k1 + k2;
    if (k > maxDen) break;
    h2 = h1; h1 = h;
    k2 = k1; k1 = k;
    if (Math.abs(x - h1 / k1) < tol) {
      return { num: sign * h1, den: k1 };
    }
    const rem = b - a;
    if (rem < 1e-12) break;
    b = 1 / rem;
  }
  return null;
}

export function fmtExactOrDecimal(val: number): string {
  if (!Number.isFinite(val)) return fmtNum(val);
  const frac = toExactFraction(val, 240, 1e-8);
  if (frac) {
    if (frac.den === 1) return String(frac.num);
    return `${frac.num}/${frac.den} (${fmtNum(val, 6)})`;
  }
  const piRatio = toExactFraction(val / Math.PI, 72, 1e-8);
  if (piRatio && piRatio.num !== 0) {
    const n = piRatio.num;
    const d = piRatio.den;
    const numStr = n === 1 ? 'π' : n === -1 ? '-π' : `${n}π`;
    const sym = d === 1 ? numStr : `${numStr}/${d}`;
    return `${sym} (${fmtNum(val, 6)})`;
  }
  return fmtNum(val, 6);
}

// ============================================================================
// 1. DETERMINISTIC EXPRESSION PARSER, AST, EVALUATOR & SYMBOLIC ENGINE
// ============================================================================

export type ExprNode =
  | { type: 'num'; value: number }
  | { type: 'var'; name: string }
  | { type: 'const'; name: 'pi' | 'e' }
  | { type: 'neg'; arg: ExprNode }
  | { type: 'bin'; op: '+' | '-' | '*' | '/' | '^'; left: ExprNode; right: ExprNode }
  | { type: 'fn'; name: string; arg: ExprNode };

type Token =
  | { type: 'num'; value: number }
  | { type: 'id'; value: string }
  | { type: 'op'; value: '+' | '-' | '*' | '/' | '^' }
  | { type: 'lparen' }
  | { type: 'rparen' };

const KNOWN_FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'csc', 'sec', 'cot',
  'asin', 'acos', 'atan', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh',
  'ln', 'log', 'log10', 'exp', 'sqrt', 'cbrt', 'abs',
]);

function normalizeFnName(name: string): string {
  const lower = name.toLowerCase();
  if (lower === 'arcsin') return 'asin';
  if (lower === 'arccos') return 'acos';
  if (lower === 'arctan') return 'atan';
  if (lower === 'log10') return 'log10';
  return lower;
}

export function tokenizeExpr(input: string): Token[] {
  const src = input
    .replace(/−|–/g, '-')
    .replace(/×|·/g, '*')
    .replace(/÷/g, '/')
    .replace(/π/g, 'pi')
    .replace(/\*\*/g, '^')
    .trim();

  const raw: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      let dotCount = 0;
      while (j < src.length && (/[0-9]/.test(src[j]) || (src[j] === '.' && dotCount === 0))) {
        if (src[j] === '.') dotCount++;
        j++;
      }
      if (j < src.length && (src[j] === 'e' || src[j] === 'E')) {
        const afterE = src[j + 1];
        const nextDigit = afterE === '+' || afterE === '-' ? src[j + 2] : afterE;
        if (nextDigit && /[0-9]/.test(nextDigit)) {
          j++;
          if (src[j] === '+' || src[j] === '-') j++;
          while (j < src.length && /[0-9]/.test(src[j])) j++;
        }
      }
      const num = Number(src.slice(i, j));
      if (!Number.isFinite(num)) throw new Error(`Invalid number near "${src.slice(i, j)}"`);
      raw.push({ type: 'num', value: num });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
      const word = src.slice(i, j);
      raw.push({ type: 'id', value: word });
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

  // Insert implicit multiplication tokens:
  // 2x -> 2 * x, 2(x+1) -> 2 * (x+1), )( -> ) * (, x( -> var x * (, )x -> ) * x
  const tokens: Token[] = [];
  for (let k = 0; k < raw.length; k++) {
    const cur = raw[k];
    const prev = tokens[tokens.length - 1];
    if (prev) {
      const prevIsValueEnd =
        prev.type === 'num' ||
        prev.type === 'rparen' ||
        (prev.type === 'id' && !KNOWN_FUNCTIONS.has(normalizeFnName(prev.value)));
      const curIsValueStart =
        cur.type === 'num' || cur.type === 'id' || cur.type === 'lparen';

      const isFnCall =
        prev.type === 'id' &&
        KNOWN_FUNCTIONS.has(normalizeFnName(prev.value)) &&
        cur.type === 'lparen';

      if (prevIsValueEnd && curIsValueStart && !isFnCall) {
        tokens.push({ type: 'op', value: '*' });
      }
    }
    tokens.push(cur);
  }
  return tokens;
}

export function parseExpr(input: string): ExprNode {
  const tokens = tokenizeExpr(input);
  if (tokens.length === 0) throw new Error('Expression cannot be empty.');
  let pos = 0;

  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];

  function parseAddSub(): ExprNode {
    let node = parseMulDiv();
    while (peek()?.type === 'op' && (peek() as { value: string }).value.match(/^[+-]$/)) {
      const op = (consume() as { type: 'op'; value: '+' | '-' }).value;
      node = { type: 'bin', op, left: node, right: parseMulDiv() };
    }
    return node;
  }

  function parseMulDiv(): ExprNode {
    let node = parseUnary();
    while (peek()?.type === 'op' && (peek() as { value: string }).value.match(/^[*/]$/)) {
      const op = (consume() as { type: 'op'; value: '*' | '/' }).value;
      node = { type: 'bin', op, left: node, right: parseUnary() };
    }
    return node;
  }

  function parseUnary(): ExprNode {
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

  function parsePow(): ExprNode {
    const base = parsePrimary();
    if (peek()?.type === 'op' && (peek() as { value: string }).value === '^') {
      consume();
      // Right-associative power: -x^2 -> -(x^2), x^2^3 -> x^(2^3)
      return { type: 'bin', op: '^', left: base, right: parseUnary() };
    }
    return base;
  }

  function parsePrimary(): ExprNode {
    const tok = peek();
    if (!tok) throw new Error('Unexpected end of expression.');
    if (tok.type === 'num') {
      consume();
      return { type: 'num', value: tok.value };
    }
    if (tok.type === 'lparen') {
      consume();
      const inner = parseAddSub();
      if (peek()?.type !== 'rparen') throw new Error('Missing closing parenthesis ")"');
      consume();
      return inner;
    }
    if (tok.type === 'id') {
      consume();
      const rawName = tok.value;
      const norm = normalizeFnName(rawName);
      if (KNOWN_FUNCTIONS.has(norm)) {
        if (peek()?.type === 'lparen') {
          consume();
          const arg = parseAddSub();
          if (peek()?.type !== 'rparen') throw new Error(`Missing ")" after ${rawName}(...)`);
          consume();
          return { type: 'fn', name: norm, arg };
        }
        // Allow shorthand like sin x
        const arg = parseUnary();
        return { type: 'fn', name: norm, arg };
      }
      const lower = rawName.toLowerCase();
      if (lower === 'pi') return { type: 'const', name: 'pi' };
      if (lower === 'e') return { type: 'const', name: 'e' };
      return { type: 'var', name: lower };
    }
    throw new Error('Invalid syntax in expression.');
  }

  const ast = parseAddSub();
  if (pos < tokens.length) {
    throw new Error('Unexpected trailing tokens in expression.');
  }
  return ast;
}

export function evalExpr(
  node: ExprNode,
  vars: Record<string, number> = {},
  angleUnit: 'rad' | 'deg' = 'rad'
): number {
  const toRad = (v: number) => (angleUnit === 'deg' ? (v * Math.PI) / 180 : v);
  const fromRad = (v: number) => (angleUnit === 'deg' ? (v * 180) / Math.PI : v);

  switch (node.type) {
    case 'num':
      return node.value;
    case 'const':
      return node.name === 'pi' ? Math.PI : Math.E;
    case 'var': {
      if (node.name in vars) return vars[node.name];
      throw new Error(`Unknown variable "${node.name}"`);
    }
    case 'neg':
      return -evalExpr(node.arg, vars, angleUnit);
    case 'bin': {
      const l = evalExpr(node.left, vars, angleUnit);
      const r = evalExpr(node.right, vars, angleUnit);
      switch (node.op) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/': return l / r;
        case '^': {
          if (l < 0 && !Number.isInteger(r)) {
            const frac = toExactFraction(r, 99, 1e-8);
            if (frac && frac.den % 2 === 1) {
              const mag = Math.pow(Math.abs(l), r);
              return frac.num % 2 === 0 ? mag : -mag;
            }
          }
          return Math.pow(l, r);
        }
      }
    }
    case 'fn': {
      const a = evalExpr(node.arg, vars, angleUnit);
      switch (node.name) {
        case 'sin': return Math.sin(toRad(a));
        case 'cos': return Math.cos(toRad(a));
        case 'tan': return Math.tan(toRad(a));
        case 'csc': return 1 / Math.sin(toRad(a));
        case 'sec': return 1 / Math.cos(toRad(a));
        case 'cot': return 1 / Math.tan(toRad(a));
        case 'asin': return fromRad(Math.asin(a));
        case 'acos': return fromRad(Math.acos(a));
        case 'atan': return fromRad(Math.atan(a));
        case 'sinh': return Math.sinh(a);
        case 'cosh': return Math.cosh(a);
        case 'tanh': return Math.tanh(a);
        case 'ln': return Math.log(a);
        case 'log': return Math.log(a);
        case 'log10': return Math.log10(a);
        case 'exp': return Math.exp(a);
        case 'sqrt': return Math.sqrt(a);
        case 'cbrt': return Math.cbrt(a);
        case 'abs': return Math.abs(a);
        default: throw new Error(`Unsupported function "${node.name}"`);
      }
    }
  }
}

function isZero(n: ExprNode): boolean {
  return n.type === 'num' && Math.abs(n.value) < 1e-12;
}
function isOne(n: ExprNode): boolean {
  return n.type === 'num' && Math.abs(n.value - 1) < 1e-12;
}
function isNum(n: ExprNode): n is { type: 'num'; value: number } {
  return n.type === 'num';
}

export function simplifyExpr(node: ExprNode): ExprNode {
  switch (node.type) {
    case 'num':
      return Math.abs(node.value) < 1e-13 ? { type: 'num', value: 0 } : node;
    case 'var':
    case 'const':
      return node;
    case 'neg': {
      const a = simplifyExpr(node.arg);
      if (isZero(a)) return { type: 'num', value: 0 };
      if (isNum(a)) return { type: 'num', value: -a.value };
      if (a.type === 'neg') return a.arg;
      return { type: 'neg', arg: a };
    }
    case 'fn':
      return { type: 'fn', name: node.name, arg: simplifyExpr(node.arg) };
    case 'bin': {
      const left = simplifyExpr(node.left);
      const right = simplifyExpr(node.right);
      if (isNum(left) && isNum(right)) {
        if (node.op === '+') return { type: 'num', value: left.value + right.value };
        if (node.op === '-') return { type: 'num', value: left.value - right.value };
        if (node.op === '*') return { type: 'num', value: left.value * right.value };
        if (node.op === '/' && right.value !== 0) {
          if (Number.isInteger(left.value) && Number.isInteger(right.value) && left.value % right.value !== 0) {
            // keep exact rational if clean
            return { type: 'bin', op: '/', left, right };
          }
          return { type: 'num', value: left.value / right.value };
        }
        if (node.op === '^' && Number.isInteger(right.value)) {
          return { type: 'num', value: Math.pow(left.value, right.value) };
        }
      }
      if (node.op === '+') {
        if (isZero(left)) return right;
        if (isZero(right)) return left;
        if (right.type === 'neg') return simplifyExpr({ type: 'bin', op: '-', left, right: right.arg });
        if (isNum(right) && right.value < 0) return { type: 'bin', op: '-', left, right: { type: 'num', value: -right.value } };
        return { type: 'bin', op: '+', left, right };
      }
      if (node.op === '-') {
        if (isZero(right)) return left;
        if (isZero(left)) return simplifyExpr({ type: 'neg', arg: right });
        if (right.type === 'neg') return simplifyExpr({ type: 'bin', op: '+', left, right: right.arg });
        return { type: 'bin', op: '-', left, right };
      }
      if (node.op === '*') {
        if (isZero(left) || isZero(right)) return { type: 'num', value: 0 };
        if (isOne(left)) return right;
        if (isOne(right)) return left;
        if (isNum(left) && Math.abs(left.value + 1) < 1e-12) return simplifyExpr({ type: 'neg', arg: right });
        if (isNum(right) && Math.abs(right.value + 1) < 1e-12) return simplifyExpr({ type: 'neg', arg: left });
        // Combine constant * (constant * expr)
        if (isNum(left) && right.type === 'bin' && right.op === '*' && isNum(right.left)) {
          return simplifyExpr({
            type: 'bin',
            op: '*',
            left: { type: 'num', value: left.value * right.left.value },
            right: right.right,
          });
        }
        if (isNum(right) && !isNum(left)) {
          return simplifyExpr({ type: 'bin', op: '*', left: right, right: left });
        }
        if (left.type === 'neg' && right.type === 'neg') {
          return simplifyExpr({ type: 'bin', op: '*', left: left.arg, right: right.arg });
        }
        return { type: 'bin', op: '*', left, right };
      }
      if (node.op === '/') {
        if (isZero(left)) return { type: 'num', value: 0 };
        if (isOne(right)) return left;
        return { type: 'bin', op: '/', left, right };
      }
      if (node.op === '^') {
        if (isZero(right)) return { type: 'num', value: 1 };
        if (isOne(right)) return left;
        if (isZero(left)) return { type: 'num', value: 0 };
        if (isOne(left)) return { type: 'num', value: 1 };
        return { type: 'bin', op: '^', left, right };
      }
      return { type: 'bin', op: node.op, left, right };
    }
  }
}

export function formatExpr(node: ExprNode, parentPrec = 0): string {
  const prec = (n: ExprNode): number => {
    if (n.type === 'num' || n.type === 'var' || n.type === 'const' || n.type === 'fn') return 5;
    if (n.type === 'neg') return 3;
    if (n.type === 'bin') {
      if (n.op === '+' || n.op === '-') return 1;
      if (n.op === '*' || n.op === '/') return 2;
      if (n.op === '^') return 4;
    }
    return 5;
  };
  const myPrec = prec(node);
  const wrap = (s: string) => (myPrec < parentPrec ? `(${s})` : s);

  switch (node.type) {
    case 'num':
      return fmtNum(node.value, 6);
    case 'const':
      return node.name === 'pi' ? 'π' : 'e';
    case 'var':
      return node.name;
    case 'neg':
      return wrap(`-${formatExpr(node.arg, 3)}`);
    case 'fn':
      return `${node.name}(${formatExpr(node.arg, 0)})`;
    case 'bin': {
      if (node.op === '+' || node.op === '-') {
        return wrap(`${formatExpr(node.left, 1)} ${node.op} ${formatExpr(node.right, node.op === '-' ? 2 : 1)}`);
      }
      if (node.op === '*') {
        const l = formatExpr(node.left, 2);
        const r = formatExpr(node.right, 2);
        if (node.left.type === 'num' && (node.right.type === 'var' || node.right.type === 'fn' || node.right.type === 'const')) {
          return wrap(`${l}${r}`);
        }
        return wrap(`${l}·${r}`);
      }
      if (node.op === '/') {
        return wrap(`${formatExpr(node.left, 2)} / ${formatExpr(node.right, 3)}`);
      }
      return wrap(`${formatExpr(node.left, 5)}^${formatExpr(node.right, 4)}`);
    }
  }
}

export function containsVar(node: ExprNode, v: string): boolean {
  switch (node.type) {
    case 'num':
    case 'const':
      return false;
    case 'var':
      return node.name === v;
    case 'neg':
    case 'fn':
      return containsVar(node.arg, v);
    case 'bin':
      return containsVar(node.left, v) || containsVar(node.right, v);
  }
}

export function diffExpr(node: ExprNode, v: string): ExprNode {
  const raw = ((): ExprNode => {
    switch (node.type) {
      case 'num':
      case 'const':
        return { type: 'num', value: 0 };
      case 'var':
        return { type: 'num', value: node.name === v ? 1 : 0 };
      case 'neg':
        return { type: 'neg', arg: diffExpr(node.arg, v) };
      case 'bin': {
        const u = node.left;
        const w = node.right;
        const du = diffExpr(u, v);
        const dw = diffExpr(w, v);
        if (node.op === '+' || node.op === '-') {
          return { type: 'bin', op: node.op, left: du, right: dw };
        }
        if (node.op === '*') {
          return {
            type: 'bin',
            op: '+',
            left: { type: 'bin', op: '*', left: du, right: w },
            right: { type: 'bin', op: '*', left: u, right: dw },
          };
        }
        if (node.op === '/') {
          if (!containsVar(w, v)) {
            return { type: 'bin', op: '/', left: du, right: w };
          }
          return {
            type: 'bin',
            op: '/',
            left: {
              type: 'bin',
              op: '-',
              left: { type: 'bin', op: '*', left: du, right: w },
              right: { type: 'bin', op: '*', left: u, right: dw },
            },
            right: { type: 'bin', op: '^', left: w, right: { type: 'num', value: 2 } },
          };
        }
        // u^w
        if (!containsVar(w, v)) {
          return {
            type: 'bin',
            op: '*',
            left: {
              type: 'bin',
              op: '*',
              left: w,
              right: { type: 'bin', op: '^', left: u, right: { type: 'bin', op: '-', left: w, right: { type: 'num', value: 1 } } },
            },
            right: du,
          };
        }
        if (!containsVar(u, v)) {
          const lnU: ExprNode =
            u.type === 'const' && u.name === 'e'
              ? { type: 'num', value: 1 }
              : { type: 'fn', name: 'ln', arg: u };
          return {
            type: 'bin',
            op: '*',
            left: { type: 'bin', op: '*', left: node, right: lnU },
            right: dw,
          };
        }
        // General f(x)^g(x) = f^g * (g' ln(f) + g f'/f)
        return {
          type: 'bin',
          op: '*',
          left: node,
          right: {
            type: 'bin',
            op: '+',
            left: { type: 'bin', op: '*', left: dw, right: { type: 'fn', name: 'ln', arg: u } },
            right: { type: 'bin', op: '/', left: { type: 'bin', op: '*', left: w, right: du }, right: u },
          },
        };
      }
      case 'fn': {
        const u = node.arg;
        const du = diffExpr(u, v);
        let outer: ExprNode;
        switch (node.name) {
          case 'sin':
            outer = { type: 'fn', name: 'cos', arg: u };
            break;
          case 'cos':
            outer = { type: 'neg', arg: { type: 'fn', name: 'sin', arg: u } };
            break;
          case 'tan':
            outer = { type: 'bin', op: '^', left: { type: 'fn', name: 'sec', arg: u }, right: { type: 'num', value: 2 } };
            break;
          case 'csc':
            outer = { type: 'neg', arg: { type: 'bin', op: '*', left: { type: 'fn', name: 'csc', arg: u }, right: { type: 'fn', name: 'cot', arg: u } } };
            break;
          case 'sec':
            outer = { type: 'bin', op: '*', left: { type: 'fn', name: 'sec', arg: u }, right: { type: 'fn', name: 'tan', arg: u } };
            break;
          case 'cot':
            outer = { type: 'neg', arg: { type: 'bin', op: '^', left: { type: 'fn', name: 'csc', arg: u }, right: { type: 'num', value: 2 } } };
            break;
          case 'asin':
            outer = { type: 'bin', op: '/', left: { type: 'num', value: 1 }, right: { type: 'fn', name: 'sqrt', arg: { type: 'bin', op: '-', left: { type: 'num', value: 1 }, right: { type: 'bin', op: '^', left: u, right: { type: 'num', value: 2 } } } } };
            break;
          case 'acos':
            outer = { type: 'bin', op: '/', left: { type: 'num', value: -1 }, right: { type: 'fn', name: 'sqrt', arg: { type: 'bin', op: '-', left: { type: 'num', value: 1 }, right: { type: 'bin', op: '^', left: u, right: { type: 'num', value: 2 } } } } };
            break;
          case 'atan':
            outer = { type: 'bin', op: '/', left: { type: 'num', value: 1 }, right: { type: 'bin', op: '+', left: { type: 'num', value: 1 }, right: { type: 'bin', op: '^', left: u, right: { type: 'num', value: 2 } } } };
            break;
          case 'sinh':
            outer = { type: 'fn', name: 'cosh', arg: u };
            break;
          case 'cosh':
            outer = { type: 'fn', name: 'sinh', arg: u };
            break;
          case 'tanh':
            outer = { type: 'bin', op: '/', left: { type: 'num', value: 1 }, right: { type: 'bin', op: '^', left: { type: 'fn', name: 'cosh', arg: u }, right: { type: 'num', value: 2 } } };
            break;
          case 'ln':
          case 'log':
            outer = { type: 'bin', op: '/', left: { type: 'num', value: 1 }, right: u };
            break;
          case 'log10':
            outer = { type: 'bin', op: '/', left: { type: 'num', value: 1 }, right: { type: 'bin', op: '*', left: u, right: { type: 'fn', name: 'ln', arg: { type: 'num', value: 10 } } } };
            break;
          case 'exp':
            outer = { type: 'fn', name: 'exp', arg: u };
            break;
          case 'sqrt':
            outer = { type: 'bin', op: '/', left: { type: 'num', value: 1 }, right: { type: 'bin', op: '*', left: { type: 'num', value: 2 }, right: { type: 'fn', name: 'sqrt', arg: u } } };
            break;
          case 'cbrt':
            outer = { type: 'bin', op: '/', left: { type: 'num', value: 1 }, right: { type: 'bin', op: '*', left: { type: 'num', value: 3 }, right: { type: 'bin', op: '^', left: u, right: { type: 'bin', op: '/', left: { type: 'num', value: 2 }, right: { type: 'num', value: 3 } } } } };
            break;
          case 'abs':
            outer = { type: 'bin', op: '/', left: u, right: { type: 'fn', name: 'abs', arg: u } };
            break;
          default:
            throw new Error(`Differentiation unsupported for "${node.name}"`);
        }
        return { type: 'bin', op: '*', left: outer, right: du };
      }
    }
  })();
  return simplifyExpr(raw);
}

// Match linear form a*x + b
function matchLinear(node: ExprNode, v: string): { a: number; b: number } | null {
  if (!containsVar(node, v)) {
    try {
      return { a: 0, b: evalExpr(node) };
    } catch {
      return null;
    }
  }
  const d1 = diffExpr(node, v);
  if (containsVar(d1, v)) return null;
  try {
    const a = evalExpr(d1);
    const val0 = evalExpr(node, { [v]: 0 });
    return { a, b: val0 };
  } catch {
    return null;
  }
}

export function integrateSymbolic(node: ExprNode, v: string): ExprNode | null {
  const s = simplifyExpr(node);
  if (!containsVar(s, v)) {
    return simplifyExpr({ type: 'bin', op: '*', left: s, right: { type: 'var', name: v } });
  }
  if (s.type === 'var' && s.name === v) {
    return {
      type: 'bin',
      op: '/',
      left: { type: 'bin', op: '^', left: { type: 'var', name: v }, right: { type: 'num', value: 2 } },
      right: { type: 'num', value: 2 },
    };
  }
  if (s.type === 'neg') {
    const inner = integrateSymbolic(s.arg, v);
    return inner ? simplifyExpr({ type: 'neg', arg: inner }) : null;
  }
  if (s.type === 'bin') {
    if (s.op === '+' || s.op === '-') {
      const l = integrateSymbolic(s.left, v);
      const r = integrateSymbolic(s.right, v);
      if (l && r) return simplifyExpr({ type: 'bin', op: s.op, left: l, right: r });
      return null;
    }
    if (s.op === '*') {
      if (!containsVar(s.left, v)) {
        const r = integrateSymbolic(s.right, v);
        return r ? simplifyExpr({ type: 'bin', op: '*', left: s.left, right: r }) : null;
      }
      if (!containsVar(s.right, v)) {
        const l = integrateSymbolic(s.left, v);
        return l ? simplifyExpr({ type: 'bin', op: '*', left: s.right, right: l }) : null;
      }
      // Common integration by parts: x * exp(ax), x * sin(ax), x * cos(ax), x^n * ln(x)
      const linLeft = matchLinear(s.left, v);
      if (linLeft && linLeft.a !== 0 && linLeft.b === 0) {
        if (s.right.type === 'fn') {
          const linArg = matchLinear(s.right.arg, v);
          if (linArg && linArg.a !== 0 && linArg.b === 0) {
            const k = linArg.a;
            const c = linLeft.a;
            if (s.right.name === 'exp') {
              // c * (x/k - 1/k^2) * exp(kx)
              return simplifyExpr({
                type: 'bin',
                op: '*',
                left: { type: 'num', value: c / (k * k) },
                right: {
                  type: 'bin',
                  op: '*',
                  left: { type: 'bin', op: '-', left: { type: 'bin', op: '*', left: { type: 'num', value: k }, right: { type: 'var', name: v } }, right: { type: 'num', value: 1 } },
                  right: s.right,
                },
              });
            }
            if (s.right.name === 'sin') {
              // c * (sin(kx)/k^2 - x cos(kx)/k)
              return simplifyExpr({
                type: 'bin',
                op: '*',
                left: { type: 'num', value: c },
                right: {
                  type: 'bin',
                  op: '-',
                  left: { type: 'bin', op: '/', left: { type: 'fn', name: 'sin', arg: s.right.arg }, right: { type: 'num', value: k * k } },
                  right: { type: 'bin', op: '/', left: { type: 'bin', op: '*', left: { type: 'var', name: v }, right: { type: 'fn', name: 'cos', arg: s.right.arg } }, right: { type: 'num', value: k } },
                },
              });
            }
            if (s.right.name === 'cos') {
              // c * (cos(kx)/k^2 + x sin(kx)/k)
              return simplifyExpr({
                type: 'bin',
                op: '*',
                left: { type: 'num', value: c },
                right: {
                  type: 'bin',
                  op: '+',
                  left: { type: 'bin', op: '/', left: { type: 'fn', name: 'cos', arg: s.right.arg }, right: { type: 'num', value: k * k } },
                  right: { type: 'bin', op: '/', left: { type: 'bin', op: '*', left: { type: 'var', name: v }, right: { type: 'fn', name: 'sin', arg: s.right.arg } }, right: { type: 'num', value: k } },
                },
              });
            }
          }
        }
      }
      // sec(u)*tan(u)
      if (s.left.type === 'fn' && s.right.type === 'fn' && formatExpr(s.left.arg) === formatExpr(s.right.arg)) {
        const pair = [s.left.name, s.right.name].sort().join(',');
        const linArg = matchLinear(s.left.arg, v);
        if (linArg && linArg.a !== 0) {
          if (pair === 'sec,tan') {
            return simplifyExpr({ type: 'bin', op: '/', left: { type: 'fn', name: 'sec', arg: s.left.arg }, right: { type: 'num', value: linArg.a } });
          }
          if (pair === 'cot,csc') {
            return simplifyExpr({ type: 'bin', op: '/', left: { type: 'neg', arg: { type: 'fn', name: 'csc', arg: s.left.arg } }, right: { type: 'num', value: linArg.a } });
          }
        }
      }
      return null;
    }
    if (s.op === '/') {
      if (!containsVar(s.right, v)) {
        const l = integrateSymbolic(s.left, v);
        return l ? simplifyExpr({ type: 'bin', op: '/', left: l, right: s.right }) : null;
      }
      if (!containsVar(s.left, v)) {
        const k = s.left;
        // k / (ax + b)
        const lin = matchLinear(s.right, v);
        if (lin && lin.a !== 0) {
          return simplifyExpr({
            type: 'bin',
            op: '/',
            left: { type: 'bin', op: '*', left: k, right: { type: 'fn', name: 'ln', arg: { type: 'fn', name: 'abs', arg: s.right } } },
            right: { type: 'num', value: lin.a },
          });
        }
        // k / (x^2 + a^2)
        if (s.right.type === 'bin' && s.right.op === '+' && s.right.left.type === 'bin' && s.right.left.op === '^' && s.right.left.left.type === 'var' && s.right.left.left.name === v && isNum(s.right.left.right) && s.right.left.right.value === 2 && !containsVar(s.right.right, v)) {
          const aSq = evalExpr(s.right.right);
          if (aSq > 0) {
            const a = Math.sqrt(aSq);
            return simplifyExpr({
              type: 'bin',
              op: '*',
              left: { type: 'bin', op: '/', left: k, right: { type: 'num', value: a } },
              right: { type: 'fn', name: 'atan', arg: { type: 'bin', op: '/', left: { type: 'var', name: v }, right: { type: 'num', value: a } } },
            });
          }
        }
        // k / sqrt(a^2 - x^2) -> k * asin(x/a)
        if (s.right.type === 'fn' && s.right.name === 'sqrt' && s.right.arg.type === 'bin' && s.right.arg.op === '-' && !containsVar(s.right.arg.left, v)) {
          const r = s.right.arg.right;
          if (r.type === 'bin' && r.op === '^' && r.left.type === 'var' && r.left.name === v && isNum(r.right) && r.right.value === 2) {
            const aSq = evalExpr(s.right.arg.left);
            if (aSq > 0) {
              const a = Math.sqrt(aSq);
              return simplifyExpr({
                type: 'bin',
                op: '*',
                left: k,
                right: { type: 'fn', name: 'asin', arg: { type: 'bin', op: '/', left: { type: 'var', name: v }, right: { type: 'num', value: a } } },
              });
            }
          }
        }
      }
      // sec^2 or csc^2 or (ax+b)^n handled below
      return null;
    }
    if (s.op === '^') {
      // (ax + b)^n
      const lin = matchLinear(s.left, v);
      if (lin && lin.a !== 0 && !containsVar(s.right, v)) {
        const n = evalExpr(s.right);
        if (Math.abs(n + 1) < 1e-10) {
          return simplifyExpr({
            type: 'bin',
            op: '/',
            left: { type: 'fn', name: 'ln', arg: { type: 'fn', name: 'abs', arg: s.left } },
            right: { type: 'num', value: lin.a },
          });
        }
        const np1 = n + 1;
        return simplifyExpr({
          type: 'bin',
          op: '/',
          left: { type: 'bin', op: '^', left: s.left, right: { type: 'num', value: np1 } },
          right: { type: 'num', value: lin.a * np1 },
        });
      }
      // c^(ax+b)
      if (!containsVar(s.left, v)) {
        const expLin = matchLinear(s.right, v);
        if (expLin && expLin.a !== 0) {
          const isE = s.left.type === 'const' && s.left.name === 'e';
          const denom = isE
            ? ({ type: 'num', value: expLin.a } as ExprNode)
            : ({ type: 'bin', op: '*', left: { type: 'num', value: expLin.a }, right: { type: 'fn', name: 'ln', arg: s.left } } as ExprNode);
          return simplifyExpr({ type: 'bin', op: '/', left: s, right: denom });
        }
      }
      // sec(ax+b)^2 -> tan(ax+b)/a, csc(ax+b)^2 -> -cot(ax+b)/a
      if (s.left.type === 'fn' && isNum(s.right) && s.right.value === 2) {
        const argLin = matchLinear(s.left.arg, v);
        if (argLin && argLin.a !== 0) {
          if (s.left.name === 'sec') {
            return simplifyExpr({ type: 'bin', op: '/', left: { type: 'fn', name: 'tan', arg: s.left.arg }, right: { type: 'num', value: argLin.a } });
          }
          if (s.left.name === 'csc') {
            return simplifyExpr({ type: 'bin', op: '/', left: { type: 'neg', arg: { type: 'fn', name: 'cot', arg: s.left.arg } }, right: { type: 'num', value: argLin.a } });
          }
        }
      }
      return null;
    }
  }
  if (s.type === 'fn') {
    const lin = matchLinear(s.arg, v);
    if (lin && lin.a !== 0) {
      const k = lin.a;
      const divK = (inner: ExprNode) =>
        simplifyExpr({ type: 'bin', op: '/', left: inner, right: { type: 'num', value: k } });
      switch (s.name) {
        case 'sin': return divK({ type: 'neg', arg: { type: 'fn', name: 'cos', arg: s.arg } });
        case 'cos': return divK({ type: 'fn', name: 'sin', arg: s.arg });
        case 'tan': return divK({ type: 'neg', arg: { type: 'fn', name: 'ln', arg: { type: 'fn', name: 'abs', arg: { type: 'fn', name: 'cos', arg: s.arg } } } });
        case 'cot': return divK({ type: 'fn', name: 'ln', arg: { type: 'fn', name: 'abs', arg: { type: 'fn', name: 'sin', arg: s.arg } } });
        case 'exp': return divK({ type: 'fn', name: 'exp', arg: s.arg });
        case 'sinh': return divK({ type: 'fn', name: 'cosh', arg: s.arg });
        case 'cosh': return divK({ type: 'fn', name: 'sinh', arg: s.arg });
        case 'sqrt':
          return divK({
            type: 'bin',
            op: '*',
            left: { type: 'bin', op: '/', left: { type: 'num', value: 2 }, right: { type: 'num', value: 3 } },
            right: { type: 'bin', op: '^', left: s.arg, right: { type: 'bin', op: '/', left: { type: 'num', value: 3 }, right: { type: 'num', value: 2 } } },
          });
        case 'ln':
        case 'log':
          if (lin.b === 0) {
            // int ln(kx) dx = x*ln(kx) - x
            return simplifyExpr({
              type: 'bin',
              op: '-',
              left: { type: 'bin', op: '*', left: { type: 'var', name: v }, right: s },
              right: { type: 'var', name: v },
            });
          }
          return null;
      }
    }
  }
  return null;
}

// Gauss-Legendre 16-point quadrature on [a, b] with composite subdivisions
const GL16_X = [
  -0.9894009349916499, -0.9445750230732326, -0.8656312023878318, -0.7554044083550030,
  -0.6178762444026438, -0.4580167776572274, -0.2816035507792589, -0.0950125098376374,
  0.0950125098376374, 0.2816035507792589, 0.4580167776572274, 0.6178762444026438,
  0.7554044083550030, 0.8656312023878318, 0.9445750230732326, 0.9894009349916499,
];
const GL16_W = [
  0.0271524594117541, 0.0622535239386479, 0.0951585116824928, 0.1246289712555339,
  0.1495959888165767, 0.1691565193950025, 0.1826034150449236, 0.1894506104550685,
  0.1894506104550685, 0.1826034150449236, 0.1691565193950025, 0.1495959888165767,
  0.1246289712555339, 0.0951585116824928, 0.0622535239386479, 0.0271524594117541,
];

function gaussIntegrate(f: (x: number) => number, a: number, b: number, panels = 24): number {
  if (a === b) return 0;
  const sign = a > b ? -1 : 1;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const h = (hi - lo) / panels;
  let total = 0;
  for (let p = 0; p < panels; p++) {
    const x0 = lo + p * h;
    const x1 = x0 + h;
    const mid = 0.5 * (x0 + x1);
    const half = 0.5 * h;
    let sum = 0;
    for (let i = 0; i < 16; i++) {
      const val = f(mid + half * GL16_X[i]);
      if (Number.isFinite(val)) sum += GL16_W[i] * val;
    }
    total += half * sum;
  }
  return sign * total;
}

export interface CalculusInput {
  mode: 'derivative' | 'partial' | 'indefinite' | 'definite' | 'limit' | 'taylor' | 'extrema';
  expr: string;
  variable?: string;
  order?: number;
  pointX?: string;
  pointY?: string;
  lowerBound?: string;
  upperBound?: string;
  limitDirection?: 'both' | 'left' | 'right';
  taylorDegree?: number;
}

export function solveCalculus(input: CalculusInput): CalcResult {
  try {
    const v = (input.variable || 'x').trim().toLowerCase() || 'x';
    const ast = simplifyExpr(parseExpr(input.expr));
    const prettyExpr = formatExpr(ast);

    if (input.mode === 'derivative') {
      const n = Math.max(1, Math.min(6, Math.round(Number(input.order) || 1)));
      const steps: string[] = [`Given function: f(${v}) = ${prettyExpr}`];
      let cur = ast;
      for (let i = 1; i <= n; i++) {
        cur = diffExpr(cur, v);
        steps.push(`Order ${i} derivative f${"'".repeat(i)}(${v}) = ${formatExpr(cur)}`);
      }
      const derivStr = formatExpr(cur);
      const secondary: { label: string; value: string }[] = [];
      if (input.pointX && input.pointX.trim() !== '') {
        const x0 = evalExpr(parseExpr(input.pointX));
        const fx0 = evalExpr(ast, { [v]: x0 });
        const dfx0 = evalExpr(cur, { [v]: x0 });
        secondary.push({ label: `Value at ${v}=${fmtNum(x0)}`, value: `f' = ${fmtNum(dfx0)}` });
        if (n === 1 && Number.isFinite(fx0) && Number.isFinite(dfx0)) {
          const b = fx0 - dfx0 * x0;
          secondary.push({
            label: `Tangent line at (${fmtNum(x0)}, ${fmtNum(fx0)})`,
            value: `y = ${fmtNum(dfx0)}x ${b >= 0 ? '+' : '-'} ${fmtNum(Math.abs(b))}`,
          });
          if (Math.abs(dfx0) > 1e-10) {
            const mNorm = -1 / dfx0;
            const bn = fx0 - mNorm * x0;
            secondary.push({
              label: 'Normal line',
              value: `y = ${fmtNum(mNorm)}x ${bn >= 0 ? '+' : '-'} ${fmtNum(Math.abs(bn))}`,
            });
          } else {
            secondary.push({ label: 'Normal line', value: `x = ${fmtNum(x0)}` });
          }
        }
      }
      return {
        title: `Symbolic Derivative (${n === 1 ? '1st' : `${n}th`} order wrt ${v})`,
        primaryAnswer: derivStr,
        secondaryAnswers: secondary,
        steps,
      };
    }

    if (input.mode === 'partial') {
      const fx = diffExpr(ast, 'x');
      const fy = diffExpr(ast, 'y');
      const fxx = diffExpr(fx, 'x');
      const fyy = diffExpr(fy, 'y');
      const fxy = diffExpr(fx, 'y');
      const steps = [
        `Given f(x, y) = ${prettyExpr}`,
        `Treating y as constant: ∂f/∂x = ${formatExpr(fx)}`,
        `Treating x as constant: ∂f/∂y = ${formatExpr(fy)}`,
        `Second partials: f_xx = ${formatExpr(fxx)}, f_yy = ${formatExpr(fyy)}, f_xy = ${formatExpr(fxy)}`,
      ];
      const secondary: { label: string; value: string }[] = [
        { label: '∂f/∂x', value: formatExpr(fx) },
        { label: '∂f/∂y', value: formatExpr(fy) },
        { label: 'Mixed ∂²f/∂x∂y', value: formatExpr(fxy) },
        { label: 'Second partials (f_xx, f_yy)', value: `${formatExpr(fxx)},  ${formatExpr(fyy)}` },
      ];
      if (input.pointX?.trim() && input.pointY?.trim()) {
        const x0 = evalExpr(parseExpr(input.pointX));
        const y0 = evalExpr(parseExpr(input.pointY));
        const gx = evalExpr(fx, { x: x0, y: y0 });
        const gy = evalExpr(fy, { x: x0, y: y0 });
        const f0 = evalExpr(ast, { x: x0, y: y0 });
        secondary.push({
          label: `∇f(${fmtNum(x0)}, ${fmtNum(y0)})`,
          value: `(${fmtNum(gx)}, ${fmtNum(gy)})  |  |∇f| = ${fmtNum(Math.hypot(gx, gy))}`,
        });
        secondary.push({
          label: `Tangent plane at (${fmtNum(x0)}, ${fmtNum(y0)})`,
          value: `z = ${fmtNum(f0)} + ${fmtNum(gx)}(x - ${fmtNum(x0)}) + ${fmtNum(gy)}(y - ${fmtNum(y0)})`,
        });
      }
      return {
        title: 'Partial Derivatives & Gradient',
        primaryAnswer: `∇f = (${formatExpr(fx)}) î + (${formatExpr(fy)}) ĵ`,
        secondaryAnswers: secondary,
        steps,
      };
    }

    if (input.mode === 'indefinite') {
      const anti = integrateSymbolic(ast, v);
      if (anti) {
        const prettyAnti = formatExpr(anti);
        return {
          title: `Indefinite Integral wrt ${v}`,
          primaryAnswer: `${prettyAnti} + C`,
          secondaryAnswers: [
            { label: 'Verification d/d' + v, value: formatExpr(diffExpr(anti, v)) },
          ],
          steps: [
            `Integrand: ∫ (${prettyExpr}) d${v}`,
            `Apply linearity, power, substitution & elementary antiderivative rules.`,
            `Antiderivative: F(${v}) = ${prettyAnti} + C`,
          ],
        };
      }
      return {
        title: `Indefinite Integral wrt ${v}`,
        primaryAnswer: 'Non-elementary or composite form — switch to Definite Integral for exact numerical area',
        steps: [
          `Integrand: ∫ (${prettyExpr}) d${v}`,
          `This expression does not match direct elementary symbolic rules (or is non-elementary such as e^(-x^2)).`,
          `Use Definite Integral mode for 16-point Gauss-Legendre numerical integration.`,
        ],
      };
    }

    if (input.mode === 'definite') {
      const rawA = (input.lowerBound || '0').trim().toLowerCase();
      const rawB = (input.upperBound || '1').trim().toLowerCase();
      const isNegInfA = rawA === '-inf' || rawA === '-infinity' || rawA === '-∞';
      const isPosInfA = rawA === 'inf' || rawA === '+inf' || rawA === 'infinity' || rawA === '∞';
      const isPosInfB = rawB === 'inf' || rawB === '+inf' || rawB === 'infinity' || rawB === '∞';
      const isNegInfB = rawB === '-inf' || rawB === '-infinity' || rawB === '-∞';

      const fn = (x: number) => evalExpr(ast, { [v]: x });
      let val: number;
      const steps: string[] = [`Integrand: f(${v}) = ${prettyExpr}`];

      if (isNegInfA || isPosInfA || isNegInfB || isPosInfB) {
        // Transform (-inf, inf) or semi-infinite using x = t/(1-t^2) or a + t/(1-t)
        if (isNegInfA && isPosInfB) {
          val = gaussIntegrate((t) => {
            const d = 1 - t * t;
            if (Math.abs(d) < 1e-12) return 0;
            const x = t / d;
            const dx = (1 + t * t) / (d * d);
            return fn(x) * dx;
          }, -0.9999, 0.9999, 48);
          steps.push('Improper integral over (-∞, +∞) mapped via x = t/(1 - t²).');
        } else if (isPosInfB && !isNegInfA && !isPosInfA) {
          const a = evalExpr(parseExpr(rawA));
          val = gaussIntegrate((t) => {
            const x = a + t / (1 - t);
            const dx = 1 / ((1 - t) * (1 - t));
            return fn(x) * dx;
          }, 0, 0.9999, 48);
          steps.push(`Improper integral on [${fmtNum(a)}, +∞) mapped via x = ${fmtNum(a)} + t/(1 - t).`);
        } else if (isNegInfA && !isNegInfB && !isPosInfB) {
          const b = evalExpr(parseExpr(rawB));
          val = gaussIntegrate((t) => {
            const x = b - t / (1 - t);
            const dx = 1 / ((1 - t) * (1 - t));
            return fn(x) * dx;
          }, 0, 0.9999, 48);
          steps.push(`Improper integral on (-∞, ${fmtNum(b)}] mapped via x = ${fmtNum(b)} - t/(1 - t).`);
        } else {
          throw new Error('Unsupported infinite limit bounds combination.');
        }
        return {
          title: 'Improper Definite Integral',
          primaryAnswer: fmtNum(val, 8),
          steps: [...steps, `Converged numerical estimate ≈ ${fmtNum(val, 8)}`],
        };
      }

      const a = evalExpr(parseExpr(rawA));
      const b = evalExpr(parseExpr(rawB));
      val = gaussIntegrate(fn, a, b, 32);
      const anti = integrateSymbolic(ast, v);
      const secondary: { label: string; value: string }[] = [];
      if (anti) {
        const fa = evalExpr(anti, { [v]: a });
        const fb = evalExpr(anti, { [v]: b });
        if (Number.isFinite(fa) && Number.isFinite(fb)) {
          val = fb - fa;
          secondary.push({ label: 'Antiderivative F(' + v + ')', value: formatExpr(anti) });
          secondary.push({ label: `F(${fmtNum(b)}) - F(${fmtNum(a)})`, value: `${fmtNum(fb)} - ${fmtNum(fa)}` });
          steps.push(`Symbolic antiderivative F(${v}) = ${formatExpr(anti)}`);
        }
      } else {
        steps.push('Evaluated via 32-panel 16-point Gauss-Legendre numerical quadrature.');
      }
      steps.push(`∫ from ${fmtNum(a)} to ${fmtNum(b)} = ${fmtNum(val, 8)}`);
      return {
        title: `Definite Integral on [${fmtNum(a)}, ${fmtNum(b)}]`,
        primaryAnswer: fmtExactOrDecimal(val),
        secondaryAnswers: secondary,
        steps,
      };
    }

    if (input.mode === 'limit') {
      const rawC = (input.pointX || '0').trim().toLowerCase();
      const dir = input.limitDirection || 'both';
      const fn = (x: number) => evalExpr(ast, { [v]: x });

      if (rawC === 'inf' || rawC === '+inf' || rawC === 'infinity' || rawC === '∞' || rawC === '-inf' || rawC === '-infinity' || rawC === '-∞') {
        const sign = rawC.startsWith('-') ? -1 : 1;
        const probes = [1e2, 1e3, 1e4, 1e5, 1e6].map((m) => fn(sign * m));
        const last = probes[probes.length - 1];
        const prev = probes[probes.length - 2];
        let ans = fmtNum(last, 7);
        if (Math.abs(last) > 1e12 && Math.abs(last) > Math.abs(prev) * 5) {
          ans = last > 0 ? '+∞' : '-∞';
        } else if (Math.abs(last - prev) > Math.max(1e-2, Math.abs(last) * 1e-2)) {
          ans = 'Does Not Exist (oscillates or diverges)';
        }
        return {
          title: `Limit as ${v} → ${sign > 0 ? '+∞' : '-∞'}`,
          primaryAnswer: ans,
          steps: [
            `Expression: ${prettyExpr}`,
            `Sample sequence at ±10², ±10³, ±10⁴, ±10⁵, ±10⁶: ${probes.map((p) => fmtNum(p, 5)).join(', ')}`,
          ],
        };
      }

      const c = evalExpr(parseExpr(rawC));
      const sampleSide = (s: 1 | -1) => {
        const hs = [1e-3, 1e-4, 1e-5, 1e-6, 1e-7];
        const vals = hs.map((h) => fn(c + s * h));
        const last = vals[vals.length - 1];
        const prev = vals[vals.length - 2];
        if (!Number.isFinite(last) || (Math.abs(last) > 1e9 && Math.abs(last) > Math.abs(prev) * 5)) {
          return { kind: 'inf' as const, val: last >= 0 ? Infinity : -Infinity, vals };
        }
        if (Math.abs(last - prev) > 1e-2) {
          return { kind: 'dne' as const, val: NaN, vals };
        }
        return { kind: 'finite' as const, val: last, vals };
      };

      const leftRes = dir !== 'right' ? sampleSide(-1) : null;
      const rightRes = dir !== 'left' ? sampleSide(1) : null;

      let primary = '';
      if (dir === 'left' && leftRes) {
        primary = leftRes.kind === 'dne' ? 'Does Not Exist' : fmtExactOrDecimal(leftRes.val);
      } else if (dir === 'right' && rightRes) {
        primary = rightRes.kind === 'dne' ? 'Does Not Exist' : fmtExactOrDecimal(rightRes.val);
      } else if (leftRes && rightRes) {
        if (leftRes.kind === 'dne' || rightRes.kind === 'dne') {
          primary = 'Does Not Exist (DNE)';
        } else if (leftRes.kind === 'inf' || rightRes.kind === 'inf') {
          primary = leftRes.val === rightRes.val ? fmtNum(leftRes.val) : `DNE (LHL=${fmtNum(leftRes.val)}, RHL=${fmtNum(rightRes.val)})`;
        } else if (Math.abs(leftRes.val - rightRes.val) < 1e-4) {
          primary = fmtExactOrDecimal(0.5 * (leftRes.val + rightRes.val));
        } else {
          primary = `Does Not Exist (LHL = ${fmtNum(leftRes.val)} ≠ RHL = ${fmtNum(rightRes.val)})`;
        }
      }

      const steps = [`Target: lim (${v} → ${fmtNum(c)}${dir === 'left' ? '⁻' : dir === 'right' ? '⁺' : ''}) of ${prettyExpr}`];
      if (leftRes) steps.push(`Left-hand sequence (c - h): ${leftRes.vals.map((x) => fmtNum(x, 6)).join(' → ')}`);
      if (rightRes) steps.push(`Right-hand sequence (c + h): ${rightRes.vals.map((x) => fmtNum(x, 6)).join(' → ')}`);

      return {
        title: `Limit at ${v} = ${fmtNum(c)}`,
        primaryAnswer: primary,
        secondaryAnswers: [
          ...(leftRes ? [{ label: 'LHL (c⁻)', value: leftRes.kind === 'dne' ? 'DNE' : fmtNum(leftRes.val) }] : []),
          ...(rightRes ? [{ label: 'RHL (c⁺)', value: rightRes.kind === 'dne' ? 'DNE' : fmtNum(rightRes.val) }] : []),
        ],
        steps,
      };
    }

    if (input.mode === 'taylor') {
      const center = input.pointX?.trim() ? evalExpr(parseExpr(input.pointX)) : 0;
      const degree = Math.max(1, Math.min(8, Math.round(Number(input.taylorDegree) || 5)));
      let cur = ast;
      const terms: string[] = [];
      const steps: string[] = [`Taylor expansion around ${v} = ${fmtNum(center)} up to degree ${degree}`];
      let fact = 1;
      for (let k = 0; k <= degree; k++) {
        if (k > 0) {
          cur = diffExpr(cur, v);
          fact *= k;
        }
        const derivVal = evalExpr(cur, { [v]: center });
        if (!Number.isFinite(derivVal)) throw new Error(`Function or derivative undefined at center ${fmtNum(center)}`);
        const coeff = derivVal / fact;
        steps.push(`k = ${k}: f^(${k})(${fmtNum(center)}) = ${fmtNum(derivVal, 6)}  ⇒  coeff = ${fmtNum(coeff, 6)}`);
        if (Math.abs(coeff) > 1e-10) {
          const base = center === 0 ? v : `(${v} ${center > 0 ? '-' : '+'} ${fmtNum(Math.abs(center))})`;
          const pow = k === 0 ? '' : k === 1 ? base : `${base}^${k}`;
          const cAbs = Math.abs(coeff);
          const cStr = k > 0 && Math.abs(cAbs - 1) < 1e-9 ? '' : fmtNum(cAbs, 5);
          const sign = terms.length === 0 ? (coeff < 0 ? '-' : '') : coeff < 0 ? ' - ' : ' + ';
          terms.push(`${sign}${cStr}${pow}`);
        }
      }
      return {
        title: center === 0 ? `Maclaurin Series (degree ${degree})` : `Taylor Series around ${v} = ${fmtNum(center)}`,
        primaryAnswer: terms.length ? terms.join('') : '0',
        steps,
      };
    }

    // extrema (critical & inflection points on [a, b])
    const a = input.lowerBound?.trim() ? evalExpr(parseExpr(input.lowerBound)) : -10;
    const b = input.upperBound?.trim() ? evalExpr(parseExpr(input.upperBound)) : 10;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const d1 = diffExpr(ast, v);
    const d2 = diffExpr(d1, v);
    const f = (x: number) => evalExpr(ast, { [v]: x });
    const f1 = (x: number) => evalExpr(d1, { [v]: x });
    const f2 = (x: number) => evalExpr(d2, { [v]: x });

    const findRoots = (fn: (x: number) => number): number[] => {
      const roots: number[] = [];
      const stepsN = 400;
      const dx = (hi - lo) / stepsN;
      const pushRoot = (r: number) => {
        if (!Number.isFinite(r)) return;
        if (Math.abs(fn(r)) > 1e-4) return;
        if (!roots.some((existing) => Math.abs(existing - r) < 1e-4)) {
          roots.push(Math.abs(r) < 1e-9 ? 0 : r);
        }
      };
      for (let i = 0; i < stepsN; i++) {
        let xL = lo + i * dx;
        let xR = xL + dx;
        let yL = fn(xL);
        let yR = fn(xR);
        if (Number.isFinite(yL) && Math.abs(yL) < 1e-8) pushRoot(xL);
        if (Number.isFinite(yL) && Number.isFinite(yR) && yL * yR <= 0) {
          for (let it = 0; it < 40; it++) {
            const mid = 0.5 * (xL + xR);
            const ym = fn(mid);
            if (!Number.isFinite(ym)) break;
            if (yL * ym <= 0) {
              xR = mid; yR = ym;
            } else {
              xL = mid; yL = ym;
            }
          }
          pushRoot(0.5 * (xL + xR));
        }
      }
      return roots;
    };

    const crits = findRoots(f1);
    const inflects = findRoots(f2);
    const secondary: { label: string; value: string }[] = [
      { label: `f'(${v})`, value: formatExpr(d1) },
      { label: `f''(${v})`, value: formatExpr(d2) },
    ];
    crits.forEach((xc, idx) => {
      const yv = f(xc);
      const y2 = f2(xc);
      const kind = y2 > 1e-6 ? 'Local Minimum' : y2 < -1e-6 ? 'Local Maximum' : 'Stationary / Saddle';
      secondary.push({
        label: `Critical Point #${idx + 1}`,
        value: `${v} = ${fmtNum(xc)}, f(${v}) = ${fmtNum(yv)} (${kind})`,
      });
    });
    if (inflects.length) {
      secondary.push({
        label: 'Inflection Point(s)',
        value: inflects.map((xi) => `(${fmtNum(xi)}, ${fmtNum(f(xi))})`).join('; '),
      });
    }
    return {
      title: `Critical & Inflection Points on [${fmtNum(lo)}, ${fmtNum(hi)}]`,
      primaryAnswer: crits.length
        ? crits.map((c) => `${v} = ${fmtNum(c)}`).join(', ')
        : 'No critical points found in interval',
      secondaryAnswers: secondary,
      steps: [
        `Solve f'(${v}) = ${formatExpr(d1)} = 0 on [${fmtNum(lo)}, ${fmtNum(hi)}]`,
        `Solve f''(${v}) = ${formatExpr(d2)} = 0 for inflection points`,
      ],
    };
  } catch (err) {
    return {
      title: 'Calculus Solver Error',
      primaryAnswer: '',
      steps: [],
      error: err instanceof Error ? err.message : 'Unable to evaluate calculus expression.',
    };
  }
}

// ============================================================================
// 2. COORDINATE GEOMETRY SOLVER
// ============================================================================

export interface CoordInput {
  mode: 'two-points' | 'line-relations' | 'triangle' | 'circle' | 'conic';
  // 2-point / triangle / point
  x1?: number; y1?: number;
  x2?: number; y2?: number;
  x3?: number; y3?: number;
  ratioM?: number; ratioN?: number;
  // lines: a1*x + b1*y + c1 = 0
  a1?: number; b1?: number; c1?: number;
  a2?: number; b2?: number; c2?: number;
  // circle
  circleMode?: 'center-radius' | 'general' | 'three-points';
  h?: number; k?: number; r?: number;
  g?: number; f?: number; cCircle?: number;
  // conic Ax^2 + Bxy + Cy^2 + Dx + Ey + F = 0
  conicA?: number; conicB?: number; conicC?: number;
  conicD?: number; conicE?: number; conicF?: number;
}

export function solveCoordinateGeometry(input: CoordInput): CalcResult {
  try {
    if (input.mode === 'two-points') {
      const x1 = Number(input.x1 ?? 0), y1 = Number(input.y1 ?? 0);
      const x2 = Number(input.x2 ?? 4), y2 = Number(input.y2 ?? 3);
      const m = Number(input.ratioM ?? 1), n = Number(input.ratioN ?? 1);
      const dx = x2 - x1, dy = y2 - y1;
      const distSq = dx * dx + dy * dy;
      const dist = Math.sqrt(distSq);
      const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;

      const secondary: { label: string; value: string }[] = [
        { label: 'Midpoint M', value: `(${fmtNum(midX)}, ${fmtNum(midY)})` },
      ];

      if (Math.abs(dx) < 1e-12) {
        secondary.push({ label: 'Slope & Inclination', value: 'Undefined (Vertical), θ = 90°' });
        secondary.push({ label: 'Line Equation', value: `x = ${fmtNum(x1)}` });
      } else {
        const slope = dy / dx;
        const intercept = y1 - slope * x1;
        const deg = (Math.atan(slope) * 180) / Math.PI;
        const a = y1 - y2, b = x2 - x1, c = x1 * y2 - x2 * y1;
        secondary.push({ label: 'Slope m & Angle', value: `m = ${fmtExactOrDecimal(slope)}, θ = ${fmtNum(deg < 0 ? deg + 180 : deg)}°` });
        secondary.push({
          label: 'Slope-Intercept Form',
          value: `y = ${fmtNum(slope)}x ${intercept >= 0 ? '+' : '-'} ${fmtNum(Math.abs(intercept))}`,
        });
        secondary.push({
          label: 'General Form (ax + by + c = 0)',
          value: `${fmtNum(a)}x ${b >= 0 ? '+' : '-'} ${fmtNum(Math.abs(b))}y ${c >= 0 ? '+' : '-'} ${fmtNum(Math.abs(c))} = 0`,
        });
      }

      if (m + n !== 0) {
        const ix = (m * x2 + n * x1) / (m + n);
        const iy = (m * y2 + n * y1) / (m + n);
        secondary.push({ label: `Internal Section (${fmtNum(m)}:${fmtNum(n)})`, value: `(${fmtNum(ix)}, ${fmtNum(iy)})` });
      }
      if (m - n !== 0) {
        const ex = (m * x2 - n * x1) / (m - n);
        const ey = (m * y2 - n * y1) / (m - n);
        secondary.push({ label: `External Section (${fmtNum(m)}:${fmtNum(n)})`, value: `(${fmtNum(ex)}, ${fmtNum(ey)})` });
      }

      // Perpendicular bisector: (x2-x1)(x - midX) + (y2-y1)(y - midY) = 0
      const pbC = -(dx * midX + dy * midY);
      secondary.push({
        label: 'Perpendicular Bisector',
        value: `${fmtNum(dx)}x ${dy >= 0 ? '+' : '-'} ${fmtNum(Math.abs(dy))}y ${pbC >= 0 ? '+' : '-'} ${fmtNum(Math.abs(pbC))} = 0`,
      });

      return {
        title: `2-Point Line & Section Analysis: (${fmtNum(x1)}, ${fmtNum(y1)}) to (${fmtNum(x2)}, ${fmtNum(y2)})`,
        primaryAnswer: `Distance = ${fmtNum(dist)} (√${fmtNum(distSq)})`,
        secondaryAnswers: secondary,
        steps: [
          `d = √[(${fmtNum(x2)} - ${fmtNum(x1)})² + (${fmtNum(y2)} - ${fmtNum(y1)})²] = √${fmtNum(distSq)} = ${fmtNum(dist)}`,
          `Midpoint = ((${fmtNum(x1)}+${fmtNum(x2)})/2, (${fmtNum(y1)}+${fmtNum(y2)})/2) = (${fmtNum(midX)}, ${fmtNum(midY)})`,
        ],
      };
    }

    if (input.mode === 'line-relations') {
      const a1 = Number(input.a1 ?? 2), b1 = Number(input.b1 ?? -3), c1 = Number(input.c1 ?? 5);
      const a2 = Number(input.a2 ?? 3), b2 = Number(input.b2 ?? 2), c2 = Number(input.c2 ?? -6);
      const px = Number(input.x1 ?? 1), py = Number(input.y1 ?? 2);
      const denom = a1 * b2 - a2 * b1;
      const n1 = Math.hypot(a1, b1), n2 = Math.hypot(a2, b2);
      if (n1 < 1e-12 || n2 < 1e-12) throw new Error('Line normal coefficients (a, b) cannot both be zero.');

      const dot = a1 * a2 + b1 * b2;
      const cosTheta = Math.min(1, Math.max(-1, Math.abs(dot) / (n1 * n2)));
      const acuteDeg = (Math.acos(cosTheta) * 180) / Math.PI;
      const secondary: { label: string; value: string }[] = [];
      let primary = '';

      if (Math.abs(denom) < 1e-12) {
        // Parallel or coincident: scale L2 to match L1 normal
        const scale = Math.abs(a1) > Math.abs(b1) ? a1 / a2 : b1 / b2;
        const c2Scaled = c2 * scale;
        const pDist = Math.abs(c1 - c2Scaled) / n1;
        primary = pDist < 1e-10 ? 'Coincident Lines (Infinitely many intersections)' : `Parallel Lines (Distance = ${fmtNum(pDist)})`;
        secondary.push({ label: 'Angle Between Lines', value: '0° (Parallel)' });
      } else {
        const ix = (b1 * c2 - b2 * c1) / denom;
        const iy = (c1 * a2 - c2 * a1) / denom;
        primary = `Intersection (${fmtNum(ix)}, ${fmtNum(iy)})`;
        secondary.push({
          label: 'Angle Between Lines',
          value: `${fmtNum(acuteDeg)}° (acute)${Math.abs(dot) < 1e-10 ? ' — Perpendicular!' : ''}`,
        });
      }

      // Distance from P to L1, foot & reflection
      const valP = a1 * px + b1 * py + c1;
      const dPoint = Math.abs(valP) / n1;
      const kFoot = -valP / (a1 * a1 + b1 * b1);
      const footX = px + a1 * kFoot, footY = py + b1 * kFoot;
      const refX = px + 2 * a1 * kFoot, refY = py + 2 * b1 * kFoot;
      secondary.push({ label: `Distance from P(${fmtNum(px)}, ${fmtNum(py)}) to L₁`, value: fmtNum(dPoint) });
      secondary.push({ label: 'Foot of Perpendicular on L₁', value: `(${fmtNum(footX)}, ${fmtNum(footY)})` });
      secondary.push({ label: 'Reflection Image across L₁', value: `(${fmtNum(refX)}, ${fmtNum(refY)})` });

      // Angle bisectors: (a1x+b1y+c1)/n1 = ± (a2x+b2y+c2)/n2
      const baPlus = a1 / n1 - a2 / n2, bbPlus = b1 / n1 - b2 / n2, bcPlus = c1 / n1 - c2 / n2;
      const baMinus = a1 / n1 + a2 / n2, bbMinus = b1 / n1 + b2 / n2, bcMinus = c1 / n1 + c2 / n2;
      secondary.push({
        label: 'Angle Bisectors',
        value: `${fmtNum(baPlus)}x + ${fmtNum(bbPlus)}y + ${fmtNum(bcPlus)} = 0  and  ${fmtNum(baMinus)}x + ${fmtNum(bbMinus)}y + ${fmtNum(bcMinus)} = 0`,
      });

      return {
        title: 'Lines Intersection, Angle, Perpendicular & Reflection',
        primaryAnswer: primary,
        secondaryAnswers: secondary,
        steps: [
          `L₁: ${fmtNum(a1)}x + ${fmtNum(b1)}y + ${fmtNum(c1)} = 0`,
          `L₂: ${fmtNum(a2)}x + ${fmtNum(b2)}y + ${fmtNum(c2)} = 0`,
          `Determinant Δ = a₁b₂ - a₂b₁ = ${fmtNum(denom)}`,
          `Point distance |L₁(P)| / √(a₁² + b₁²) = ${fmtNum(dPoint)}`,
        ],
      };
    }

    if (input.mode === 'triangle') {
      const x1 = Number(input.x1 ?? 0), y1 = Number(input.y1 ?? 0);
      const x2 = Number(input.x2 ?? 6), y2 = Number(input.y2 ?? 0);
      const x3 = Number(input.x3 ?? 2), y3 = Number(input.y3 ?? 4);

      const area2 = Math.abs(x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
      const area = area2 / 2;
      const a = Math.hypot(x2 - x3, y2 - y3);
      const b = Math.hypot(x1 - x3, y1 - y3);
      const c = Math.hypot(x1 - x2, y1 - y2);
      const peri = a + b + c;
      const gx = (x1 + x2 + x3) / 3, gy = (y1 + y2 + y3) / 3;

      if (area < 1e-10) {
        return {
          title: 'Triangle Centers & Properties',
          primaryAnswer: 'Collinear Points (Area = 0)',
          secondaryAnswers: [
            { label: 'Side lengths', value: `a=${fmtNum(a)}, b=${fmtNum(b)}, c=${fmtNum(c)}` },
          ],
          steps: ['Determinant area is 0, so A, B, C lie on a straight line.'],
        };
      }

      const ix = (a * x1 + b * x2 + c * x3) / peri;
      const iy = (a * y1 + b * y2 + c * y3) / peri;
      const inradius = (2 * area) / peri;

      const dCirc = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
      const s1 = x1 * x1 + y1 * y1, s2 = x2 * x2 + y2 * y2, s3 = x3 * x3 + y3 * y3;
      const ox = (s1 * (y2 - y3) + s2 * (y3 - y1) + s3 * (y1 - y2)) / dCirc;
      const oy = (s1 * (x3 - x2) + s2 * (x1 - x3) + s3 * (x2 - x1)) / dCirc;
      const circumR = Math.hypot(x1 - ox, y1 - oy);

      // Orthocenter H = 3G - 2O (Euler line relation!)
      const hx = 3 * gx - 2 * ox;
      const hy = 3 * gy - 2 * oy;

      return {
        title: `Triangle (${fmtNum(x1)},${fmtNum(y1)}), (${fmtNum(x2)},${fmtNum(y2)}), (${fmtNum(x3)},${fmtNum(y3)})`,
        primaryAnswer: `Area = ${fmtNum(area)}  |  Perimeter = ${fmtNum(peri)}`,
        secondaryAnswers: [
          { label: 'Side Lengths (a, b, c)', value: `${fmtNum(a)}, ${fmtNum(b)}, ${fmtNum(c)}` },
          { label: 'Centroid (G)', value: `(${fmtNum(gx)}, ${fmtNum(gy)})` },
          { label: 'Circumcenter (O) & R', value: `(${fmtNum(ox)}, ${fmtNum(oy)}), R = ${fmtNum(circumR)}` },
          { label: 'Orthocenter (H)', value: `(${fmtNum(hx)}, ${fmtNum(hy)})` },
          { label: 'Incenter (I) & r', value: `(${fmtNum(ix)}, ${fmtNum(iy)}), r = ${fmtNum(inradius)}` },
        ],
        steps: [
          `Shoelace Area = ½|x₁(y₂-y₃)+x₂(y₃-y₁)+x₃(y₁-y₂)| = ${fmtNum(area)}`,
          `Centroid G = average of vertices = (${fmtNum(gx)}, ${fmtNum(gy)})`,
          `Euler line H = 3G - 2O gives Orthocenter (${fmtNum(hx)}, ${fmtNum(hy)})`,
        ],
      };
    }

    if (input.mode === 'circle') {
      let h = 0, k = 0, r = 1;
      const cm = input.circleMode || 'center-radius';
      const steps: string[] = [];

      if (cm === 'center-radius') {
        h = Number(input.h ?? 2); k = Number(input.k ?? -3); r = Math.abs(Number(input.r ?? 5));
        steps.push(`Given center (${fmtNum(h)}, ${fmtNum(k)}) and radius r = ${fmtNum(r)}.`);
      } else if (cm === 'general') {
        const g = Number(input.g ?? -2), f = Number(input.f ?? 3), c = Number(input.cCircle ?? -12);
        h = -g; k = -f;
        const rSq = g * g + f * f - c;
        if (rSq < 0) throw new Error('Imaginary circle (g² + f² - c < 0).');
        r = Math.sqrt(rSq);
        steps.push(`From x²+y²+2(${fmtNum(g)})x+2(${fmtNum(f)})y+${fmtNum(c)}=0 ⇒ Center (-g,-f)=(${fmtNum(h)},${fmtNum(k)}), r=√(g²+f²-c)=${fmtNum(r)}.`);
      } else {
        const x1 = Number(input.x1 ?? 0), y1 = Number(input.y1 ?? 0);
        const x2 = Number(input.x2 ?? 4), y2 = Number(input.y2 ?? 0);
        const x3 = Number(input.x3 ?? 0), y3 = Number(input.y3 ?? 3);
        const d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
        if (Math.abs(d) < 1e-12) throw new Error('The 3 points are collinear; no unique circle exists.');
        const s1 = x1 * x1 + y1 * y1, s2 = x2 * x2 + y2 * y2, s3 = x3 * x3 + y3 * y3;
        h = (s1 * (y2 - y3) + s2 * (y3 - y1) + s3 * (y1 - y2)) / d;
        k = (s1 * (x3 - x2) + s2 * (x1 - x3) + s3 * (x2 - x1)) / d;
        r = Math.hypot(x1 - h, y1 - k);
        steps.push(`Circumcircle of the 3 points ⇒ Center (${fmtNum(h)}, ${fmtNum(k)}), r = ${fmtNum(r)}.`);
      }

      const gCoeff = -2 * h, fCoeff = -2 * k, cCoeff = h * h + k * k - r * r;
      const stdForm = `(x ${h >= 0 ? '-' : '+'} ${fmtNum(Math.abs(h))})² + (y ${k >= 0 ? '-' : '+'} ${fmtNum(Math.abs(k))})² = ${fmtNum(r * r)}`;
      const genForm = `x² + y² ${gCoeff >= 0 ? '+' : '-'} ${fmtNum(Math.abs(gCoeff))}x ${fCoeff >= 0 ? '+' : '-'} ${fmtNum(Math.abs(fCoeff))}y ${cCoeff >= 0 ? '+' : '-'} ${fmtNum(Math.abs(cCoeff))} = 0`;
      const secondary: { label: string; value: string }[] = [
        { label: 'Standard Equation', value: stdForm },
        { label: 'General Equation', value: genForm },
        { label: 'Area & Circumference', value: `Area = ${fmtNum(Math.PI * r * r)},  C = ${fmtNum(2 * Math.PI * r)}` },
      ];

      if (cm !== 'three-points' && input.x1 !== undefined && input.y1 !== undefined) {
        const px = Number(input.x1), py = Number(input.y1);
        const s1 = (px - h) ** 2 + (py - k) ** 2 - r * r;
        const pos = s1 > 1e-9 ? 'Outside' : s1 < -1e-9 ? 'Inside' : 'On Circle';
        secondary.push({
          label: `Point P(${fmtNum(px)}, ${fmtNum(py)}) Position`,
          value: s1 > 1e-9 ? `${pos} (Tangent length = ${fmtNum(Math.sqrt(s1))})` : pos,
        });
        // Polar / Chord of contact / Tangent: x*px + y*py - h(x+px) - k(y+py) + c = 0
        const tx = px - h, ty = py - k, tc = -h * px - k * py + cCoeff;
        secondary.push({
          label: pos === 'On Circle' ? 'Tangent at P' : 'Chord of Contact / Polar of P',
          value: `${fmtNum(tx)}x ${ty >= 0 ? '+' : '-'} ${fmtNum(Math.abs(ty))}y ${tc >= 0 ? '+' : '-'} ${fmtNum(Math.abs(tc))} = 0`,
        });
      }

      return {
        title: 'Circle Analyzer',
        primaryAnswer: `Center (${fmtNum(h)}, ${fmtNum(k)}), Radius r = ${fmtNum(r)}`,
        secondaryAnswers: secondary,
        steps,
      };
    }

    // General Conic Section: Ax^2 + Bxy + Cy^2 + Dx + Ey + F = 0
    const A = Number(input.conicA ?? 1);
    const B = Number(input.conicB ?? 0);
    const C = Number(input.conicC ?? 4);
    const D = Number(input.conicD ?? -6);
    const E = Number(input.conicE ?? 16);
    const F = Number(input.conicF ?? -7);

    const disc = B * B - 4 * A * C;
    // 3x3 determinant | A B/2 D/2 ; B/2 C E/2 ; D/2 E/2 F |
    const b = B / 2, d = D / 2, e = E / 2;
    const det3 = A * (C * F - e * e) - b * (b * F - d * e) + d * (b * e - C * d);
    const steps: string[] = [
      `General form: ${fmtNum(A)}x² + ${fmtNum(B)}xy + ${fmtNum(C)}y² + ${fmtNum(D)}x + ${fmtNum(E)}y + ${fmtNum(F)} = 0`,
      `Discriminant B² - 4AC = ${fmtNum(disc)}`,
      `3×3 Determinant Δ = ${fmtNum(det3)}`,
    ];

    let classification = '';
    const secondary: { label: string; value: string }[] = [
      { label: 'B² - 4AC', value: fmtNum(disc) },
      { label: 'Conic Determinant Δ', value: fmtNum(det3) },
    ];

    // Rotate axes if B != 0
    const theta = Math.abs(B) < 1e-12 ? 0 : Math.abs(A - C) < 1e-12 ? (B > 0 ? Math.PI / 4 : -Math.PI / 4) : 0.5 * Math.atan2(B, A - C);
    const cosT = Math.cos(theta), sinT = Math.sin(theta);
    const A1 = A * cosT * cosT + B * cosT * sinT + C * sinT * sinT;
    const C1 = A * sinT * sinT - B * cosT * sinT + C * cosT * cosT;
    const D1 = D * cosT + E * sinT;
    const E1 = -D * sinT + E * cosT;
    if (Math.abs(B) >= 1e-12) {
      secondary.push({ label: 'Rotation Angle θ', value: `${fmtNum((theta * 180) / Math.PI)}°` });
      steps.push(`Rotated axes by θ = ${fmtNum((theta * 180) / Math.PI)}° to eliminate xy term: A'=${fmtNum(A1)}, C'=${fmtNum(C1)}`);
    }

    if (Math.abs(A1) < 1e-10 && Math.abs(C1) < 1e-10) {
      classification = 'Degenerate (Straight Line)';
    } else if (Math.abs(det3) < 1e-10) {
      classification = disc > 1e-10 ? 'Degenerate: Pair of Intersecting Lines' : Math.abs(disc) < 1e-10 ? 'Degenerate: Parallel/Coincident Lines' : 'Degenerate: Single Point';
    } else if (Math.abs(disc) < 1e-10) {
      classification = 'Parabola (e = 1)';
      if (Math.abs(B) < 1e-10) {
        if (Math.abs(A) > 1e-10) {
          // Ax^2 + Dx + Ey + F = 0 -> (x + D/(2A))^2 = (-E/A)(y + ...)
          const h = -D / (2 * A);
          const rhsConst = (D * D) / (4 * A) - F;
          const k = rhsConst / E;
          const fourP = -E / A;
          const p = fourP / 4;
          secondary.push({ label: 'Vertex', value: `(${fmtNum(h)}, ${fmtNum(k)})` });
          secondary.push({ label: 'Focus', value: `(${fmtNum(h)}, ${fmtNum(k + p)})` });
          secondary.push({ label: 'Equation of Directrix', value: `y = ${fmtNum(k - p)}` });
          secondary.push({ label: 'Axis of Symmetry', value: `x = ${fmtNum(h)}` });
          secondary.push({ label: 'Length of Latus Rectum', value: fmtNum(Math.abs(fourP)) });
          secondary.push({ label: 'Tangent at Vertex', value: `y = ${fmtNum(k)}` });
        } else {
          const k = -E / (2 * C);
          const rhsConst = (E * E) / (4 * C) - F;
          const h = rhsConst / D;
          const fourP = -D / C;
          const p = fourP / 4;
          secondary.push({ label: 'Vertex', value: `(${fmtNum(h)}, ${fmtNum(k)})` });
          secondary.push({ label: 'Focus', value: `(${fmtNum(h + p)}, ${fmtNum(k)})` });
          secondary.push({ label: 'Equation of Directrix', value: `x = ${fmtNum(h - p)}` });
          secondary.push({ label: 'Axis of Symmetry', value: `y = ${fmtNum(k)}` });
          secondary.push({ label: 'Length of Latus Rectum', value: fmtNum(Math.abs(fourP)) });
          secondary.push({ label: 'Tangent at Vertex', value: `x = ${fmtNum(h)}` });
        }
      }
    } else {
      // Central conic: find center in rotated frame, map back
      const u0 = -D1 / (2 * A1);
      const v0 = -E1 / (2 * C1);
      const cx = u0 * cosT - v0 * sinT;
      const cy = u0 * sinT + v0 * cosT;
      const rhs = (D1 * D1) / (4 * A1) + (E1 * E1) / (4 * C1) - F;
      const q1 = rhs / A1, q2 = rhs / C1;

      if (disc < 0) {
        if (q1 <= 0 && q2 <= 0) {
          classification = 'Empty / Imaginary Ellipse';
        } else {
          const isCircle = Math.abs(B) < 1e-10 && Math.abs(A - C) < 1e-10;
          const aAxis = Math.sqrt(Math.max(q1, q2));
          const bAxis = Math.sqrt(Math.min(q1, q2));
          const eEcc = Math.sqrt(Math.max(0, 1 - (bAxis * bAxis) / (aAxis * aAxis)));
          const lr = (2 * bAxis * bAxis) / aAxis;
          classification = isCircle ? 'Circle (e = 0)' : `Ellipse (e = ${fmtNum(eEcc)})`;
          secondary.push({ label: 'Center', value: `(${fmtNum(cx)}, ${fmtNum(cy)})` });
          secondary.push({ label: 'Semi-axes (a, b)', value: `a = ${fmtNum(aAxis)}, b = ${fmtNum(bAxis)}` });
          if (isCircle) {
            secondary.push({ label: 'Radius & Diameter', value: `r = ${fmtNum(aAxis)}, d = ${fmtNum(2 * aAxis)}` });
          } else {
            const horiz = q1 >= q2;
            const cFoc = Math.sqrt(Math.max(0, aAxis * aAxis - bAxis * bAxis));
            secondary.push({
              label: 'Major Axis (2a)',
              value: Math.abs(B) < 1e-10
                ? `Length = ${fmtNum(2 * aAxis)} (${horiz ? `y = ${fmtNum(cy)}` : `x = ${fmtNum(cx)}`})`
                : `Length = ${fmtNum(2 * aAxis)}`,
            });
            secondary.push({
              label: 'Minor Axis (2b)',
              value: Math.abs(B) < 1e-10
                ? `Length = ${fmtNum(2 * bAxis)} (${horiz ? `x = ${fmtNum(cx)}` : `y = ${fmtNum(cy)}`})`
                : `Length = ${fmtNum(2 * bAxis)}`,
            });
            secondary.push({ label: 'Length of Latus Rectum (2b²/a)', value: fmtNum(lr) });
            if (Math.abs(B) < 1e-10) {
              secondary.push({
                label: 'Vertices',
                value: horiz
                  ? `(${fmtNum(cx - aAxis)}, ${fmtNum(cy)}) & (${fmtNum(cx + aAxis)}, ${fmtNum(cy)})`
                  : `(${fmtNum(cx)}, ${fmtNum(cy - aAxis)}) & (${fmtNum(cx)}, ${fmtNum(cy + aAxis)})`,
              });
              secondary.push({
                label: 'Foci',
                value: horiz
                  ? `(${fmtNum(cx - cFoc)}, ${fmtNum(cy)}) & (${fmtNum(cx + cFoc)}, ${fmtNum(cy)})`
                  : `(${fmtNum(cx)}, ${fmtNum(cy - cFoc)}) & (${fmtNum(cx)}, ${fmtNum(cy + cFoc)})`,
              });
              secondary.push({
                label: 'Equations of Directrices',
                value: eEcc > 1e-10
                  ? horiz
                    ? `x = ${fmtNum(cx)} ± ${fmtNum(aAxis / eEcc)}`
                    : `y = ${fmtNum(cy)} ± ${fmtNum(aAxis / eEcc)}`
                  : 'At infinity',
              });
            }
          }
        }
      } else {
        const horiz = q1 > 0;
        const aAxis = Math.sqrt(Math.abs(horiz ? q1 : q2));
        const bAxis = Math.sqrt(Math.abs(horiz ? q2 : q1));
        const eEcc = Math.sqrt(1 + (bAxis * bAxis) / (aAxis * aAxis));
        const lr = (2 * bAxis * bAxis) / aAxis;
        const isRect = Math.abs(A + C) < 1e-10;
        classification = isRect ? `Rectangular Hyperbola (e = √2)` : `Hyperbola (e = ${fmtNum(eEcc)})`;
        secondary.push({ label: 'Center', value: `(${fmtNum(cx)}, ${fmtNum(cy)})` });
        secondary.push({ label: 'Transverse / Conjugate (a, b)', value: `a = ${fmtNum(aAxis)}, b = ${fmtNum(bAxis)}` });
        secondary.push({
          label: 'Transverse Axis (2a)',
          value: Math.abs(B) < 1e-10
            ? `Length = ${fmtNum(2 * aAxis)} (${horiz ? `y = ${fmtNum(cy)}` : `x = ${fmtNum(cx)}`})`
            : `Length = ${fmtNum(2 * aAxis)}`,
        });
        secondary.push({
          label: 'Conjugate Axis (2b)',
          value: Math.abs(B) < 1e-10
            ? `Length = ${fmtNum(2 * bAxis)} (${horiz ? `x = ${fmtNum(cx)}` : `y = ${fmtNum(cy)}`})`
            : `Length = ${fmtNum(2 * bAxis)}`,
        });
        secondary.push({ label: 'Length of Latus Rectum (2b²/a)', value: fmtNum(lr) });
        if (Math.abs(B) < 1e-10) {
          const cFoc = Math.hypot(aAxis, bAxis);
          secondary.push({
            label: 'Vertices',
            value: horiz
              ? `(${fmtNum(cx - aAxis)}, ${fmtNum(cy)}) & (${fmtNum(cx + aAxis)}, ${fmtNum(cy)})`
              : `(${fmtNum(cx)}, ${fmtNum(cy - aAxis)}) & (${fmtNum(cx)}, ${fmtNum(cy + aAxis)})`,
          });
          secondary.push({
            label: 'Foci',
            value: horiz
              ? `(${fmtNum(cx - cFoc)}, ${fmtNum(cy)}) & (${fmtNum(cx + cFoc)}, ${fmtNum(cy)})`
              : `(${fmtNum(cx)}, ${fmtNum(cy - cFoc)}) & (${fmtNum(cx)}, ${fmtNum(cy + cFoc)})`,
          });
          secondary.push({
            label: 'Equations of Directrices',
            value: horiz
              ? `x = ${fmtNum(cx)} ± ${fmtNum(aAxis / eEcc)}`
              : `y = ${fmtNum(cy)} ± ${fmtNum(aAxis / eEcc)}`,
          });
          const slope = horiz ? bAxis / aAxis : aAxis / bAxis;
          secondary.push({
            label: 'Asymptotes',
            value: `y ${cy >= 0 ? '-' : '+'} ${fmtNum(Math.abs(cy))} = ±${fmtNum(slope)}(x ${cx >= 0 ? '-' : '+'} ${fmtNum(Math.abs(cx))})`,
          });
        }
      }
    }

    return {
      title: 'Conic Section Classifier & Properties',
      primaryAnswer: classification,
      secondaryAnswers: secondary,
      steps,
    };
  } catch (err) {
    return {
      title: 'Coordinate Geometry Error',
      primaryAnswer: '',
      steps: [],
      error: err instanceof Error ? err.message : 'Unable to compute geometry properties.',
    };
  }
}

// ============================================================================
// 3. ALGEBRA SOLVER (POLYNOMIALS, SYSTEMS, INEQUALITIES, MATRICES, COMPLEX, SERIES)
// ============================================================================

export interface AlgebraInput {
  mode: 'polynomial' | 'system' | 'inequality' | 'matrix' | 'complex' | 'progressions';
  // polynomial equation e.g. "x^3 - 6x^2 + 11x - 6 = 0"
  equation?: string;
  // linear system A * X = B
  sysSize?: 2 | 3;
  matrixA?: number[][];
  matrixB?: number[][];
  vectorB?: number[];
  // quadratic/linear inequality a*x^2 + b*x + c <op> 0
  ineqA?: number; ineqB?: number; ineqC?: number;
  ineqOp?: '>' | '>=' | '<' | '<=';
  // matrix op
  matrixSize?: 2 | 3;
  matrixOp?: 'det-inv' | 'add' | 'sub' | 'mul';
  // complex
  c1Re?: number; c1Im?: number;
  c2Re?: number; c2Im?: number;
  complexN?: number;
  // progressions
  progType?: 'AP' | 'GP' | 'HP' | 'COMB';
  firstTerm?: number;
  diffOrRatio?: number;
  termCount?: number;
  combN?: number;
  combR?: number;
}

// Extract polynomial coefficients [c_n, ..., c_1, c_0] numerically using high-precision polynomial check or degree extraction
function extractPolyCoeffs(exprStr: string): number[] {
  const parts = exprStr.split('=');
  if (parts.length > 2) throw new Error('Equation may contain at most one "=" sign.');
  const ast = parts.length === 2
    ? parseExpr(`(${parts[0]}) - (${parts[1]})`)
    : parseExpr(parts[0]);

  const f = (x: number) => evalExpr(ast, { x });
  // Detect degree via finite differences up to degree 6
  const sampleX = [0, 1, 2, 3, 4, 5, 6, 7];
  let diffs = sampleX.map(f);
  if (diffs.some((y) => !Number.isFinite(y))) {
    throw new Error('Expression must be a valid polynomial in x.');
  }
  let deg = -1;
  for (let d = 0; d <= 6; d++) {
    if (diffs.every((val) => Math.abs(val) < 1e-7)) {
      deg = Math.max(0, d - 1);
      break;
    }
    const next: number[] = [];
    for (let i = 0; i < diffs.length - 1; i++) next.push(diffs[i + 1] - diffs[i]);
    diffs = next;
  }
  if (deg === -1) throw new Error('Only polynomials up to degree 6 are supported in this solver.');

  // Fit exact polynomial of degree deg using Vandermonde Gaussian elimination
  const n = deg + 1;
  const V: number[][] = [];
  for (let i = 0; i < n; i++) {
    const xi = i - Math.floor(n / 2);
    const row: number[] = [];
    for (let p = deg; p >= 0; p--) row.push(Math.pow(xi, p));
    row.push(f(xi));
    V.push(row);
  }
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(V[r][col]) > Math.abs(V[piv][col])) piv = r;
    [V[col], V[piv]] = [V[piv], V[col]];
    const div = V[col][col];
    for (let j = col; j <= n; j++) V[col][j] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const fac = V[r][col];
      for (let j = col; j <= n; j++) V[r][j] -= fac * V[col][j];
    }
  }
  const coeffs = V.map((r) => (Math.abs(r[n]) < 1e-9 ? 0 : r[n]));
  // Verify on extra test points to confirm it's truly polynomial
  for (const tx of [2.37, -1.83]) {
    let pv = 0;
    for (const c of coeffs) pv = pv * tx + c;
    if (Math.abs(pv - f(tx)) > 1e-4) throw new Error('Expression contains non-polynomial terms; use Calculus Critical Points solver instead.');
  }
  while (coeffs.length > 1 && Math.abs(coeffs[0]) < 1e-9) coeffs.shift();
  return coeffs;
}

function durandKernerRoots(coeffs: number[]): { re: number; im: number }[] {
  const lead = coeffs[0];
  const p = coeffs.map((c) => c / lead);
  const n = p.length - 1;
  if (n <= 0) return [];
  if (n === 1) return [{ re: -p[1], im: 0 }];
  if (n === 2) {
    const b = p[1], c = p[2];
    const disc = b * b - 4 * c;
    if (disc >= 0) {
      const sd = Math.sqrt(disc);
      return [{ re: (-b + sd) / 2, im: 0 }, { re: (-b - sd) / 2, im: 0 }];
    }
    const sd = Math.sqrt(-disc);
    return [{ re: -b / 2, im: sd / 2 }, { re: -b / 2, im: -sd / 2 }];
  }

  // Initialize distinct roots around Cauchy bound circle
  const maxC = Math.max(...p.slice(1).map((x) => Math.abs(x)), 1);
  const rad = 1 + maxC;
  const roots: { re: number; im: number }[] = [];
  for (let k = 0; k < n; k++) {
    const ang = (2 * Math.PI * k) / n + 0.37;
    roots.push({ re: rad * 0.5 * Math.cos(ang), im: rad * 0.5 * Math.sin(ang) });
  }
  const evalPolyC = (z: { re: number; im: number }) => {
    let re = p[0], im = 0;
    for (let i = 1; i < p.length; i++) {
      const nre = re * z.re - im * z.im + p[i];
      const nim = re * z.im + im * z.re;
      re = nre; im = nim;
    }
    return { re, im };
  };

  for (let iter = 0; iter < 150; iter++) {
    let maxStep = 0;
    for (let i = 0; i < n; i++) {
      const val = evalPolyC(roots[i]);
      let denRe = 1, denIm = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dre = roots[i].re - roots[j].re;
        const dim = roots[i].im - roots[j].im;
        const nre = denRe * dre - denIm * dim;
        const nim = denRe * dim + denIm * dre;
        denRe = nre; denIm = nim;
      }
      const d2 = denRe * denRe + denIm * denIm;
      if (d2 < 1e-24) continue;
      const stepRe = (val.re * denRe + val.im * denIm) / d2;
      const stepIm = (val.im * denRe - val.re * denIm) / d2;
      roots[i].re -= stepRe;
      roots[i].im -= stepIm;
      maxStep = Math.max(maxStep, Math.hypot(stepRe, stepIm));
    }
    if (maxStep < 1e-12) break;
  }
  return roots.map((z) => ({
    re: Math.abs(z.re) < 1e-8 ? 0 : z.re,
    im: Math.abs(z.im) < 1e-8 ? 0 : z.im,
  }));
}

function detMatrix(M: number[][]): number {
  const n = M.length;
  if (n === 2) return M[0][0] * M[1][1] - M[0][1] * M[1][0];
  if (n === 3) {
    return (
      M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
      M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
      M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0])
    );
  }
  throw new Error('Matrix determinant supports 2×2 or 3×3.');
}

function inverseMatrix(M: number[][]): { det: number; inv: number[][] | null } {
  const n = M.length;
  const det = detMatrix(M);
  if (Math.abs(det) < 1e-11) return { det: 0, inv: null };
  if (n === 2) {
    return {
      det,
      inv: [
        [M[1][1] / det, -M[0][1] / det],
        [-M[1][0] / det, M[0][0] / det],
      ],
    };
  }
  const c00 = M[1][1] * M[2][2] - M[1][2] * M[2][1];
  const c01 = -(M[1][0] * M[2][2] - M[1][2] * M[2][0]);
  const c02 = M[1][0] * M[2][1] - M[1][1] * M[2][0];
  const c10 = -(M[0][1] * M[2][2] - M[0][2] * M[2][1]);
  const c11 = M[0][0] * M[2][2] - M[0][2] * M[2][0];
  const c12 = -(M[0][0] * M[2][1] - M[0][1] * M[2][0]);
  const c20 = M[0][1] * M[1][2] - M[0][2] * M[1][1];
  const c21 = -(M[0][0] * M[1][2] - M[0][2] * M[1][0]);
  const c22 = M[0][0] * M[1][1] - M[0][1] * M[1][0];
  return {
    det,
    inv: [
      [c00 / det, c10 / det, c20 / det],
      [c01 / det, c11 / det, c21 / det],
      [c02 / det, c12 / det, c22 / det],
    ],
  };
}

function fmtMatrix(M: number[][]): string {
  return M.map((row) => `[ ${row.map((v) => fmtNum(v, 5)).join(',  ')} ]`).join('  ;  ');
}

export function solveAlgebra(input: AlgebraInput): CalcResult {
  try {
    if (input.mode === 'polynomial') {
      const coeffs = extractPolyCoeffs(input.equation || 'x^2 - 5x + 6 = 0');
      const deg = coeffs.length - 1;
      if (deg === 0) {
        return {
          title: 'Constant Equation',
          primaryAnswer: Math.abs(coeffs[0]) < 1e-10 ? 'Identity (All real x)' : 'No Solution (Inconsistent)',
          steps: [`Simplified to ${fmtNum(coeffs[0])} = 0`],
        };
      }
      const roots = durandKernerRoots(coeffs);
      const formattedRoots = roots.map((r, i) => `x${i + 1} = ${fmtComplex(r.re, r.im)}`);
      const sumRoots = -coeffs[1] / coeffs[0];
      const prodRoots = ((deg % 2 === 0 ? 1 : -1) * coeffs[deg]) / coeffs[0];
      return {
        title: `Degree-${deg} Polynomial Equation Solver`,
        primaryAnswer: formattedRoots.join(',   '),
        secondaryAnswers: [
          { label: 'Normalized Coefficients', value: coeffs.map((c) => fmtNum(c)).join(', ') },
          { label: 'Sum of Roots (Vieta)', value: fmtNum(sumRoots) },
          { label: 'Product of Roots (Vieta)', value: fmtNum(prodRoots) },
        ],
        steps: [
          `Standard form P(x) = 0 with degree ${deg} and coefficients [${coeffs.map((c) => fmtNum(c)).join(', ')}]`,
          deg === 2
            ? `Discriminant Δ = b² - 4ac = ${fmtNum(coeffs[1] * coeffs[1] - 4 * coeffs[0] * coeffs[2])}`
            : `Solved all ${deg} real and complex roots via polynomial solver`,
        ],
      };
    }

    if (input.mode === 'system') {
      const n = input.sysSize || 2;
      const A = (input.matrixA || (n === 2 ? [[2, 3], [4, -1]] : [[1, 1, 1], [2, -1, 1], [1, 2, -1]]))
        .slice(0, n)
        .map((r) => r.slice(0, n).map(Number));
      const B = (input.vectorB || (n === 2 ? [8, 2] : [6, 3, 2])).slice(0, n).map(Number);

      // RREF Gaussian elimination on [A|B]
      const aug = A.map((row, i) => [...row, B[i]]);
      const steps: string[] = [`Augmented matrix [A | B] (${n}×${n})`];
      let rankA = 0;
      for (let col = 0; col < n; col++) {
        let piv = rankA;
        for (let r = rankA + 1; r < n; r++) if (Math.abs(aug[r][col]) > Math.abs(aug[piv][col])) piv = r;
        if (Math.abs(aug[piv][col]) < 1e-10) continue;
        [aug[rankA], aug[piv]] = [aug[piv], aug[rankA]];
        const div = aug[rankA][col];
        for (let j = col; j <= n; j++) aug[rankA][j] /= div;
        for (let r = 0; r < n; r++) {
          if (r === rankA) continue;
          const f = aug[r][col];
          for (let j = col; j <= n; j++) aug[r][j] -= f * aug[rankA][j];
        }
        rankA++;
      }
      const detA = detMatrix(A);
      let rankAug = rankA;
      for (let r = rankA; r < n; r++) {
        if (Math.abs(aug[r][n]) > 1e-8) rankAug++;
      }
      steps.push(`det(A) = ${fmtNum(detA)}, rank(A) = ${rankA}, rank([A|B]) = ${rankAug}`);

      if (rankAug > rankA) {
        return {
          title: `${n}×${n} Linear System`,
          primaryAnswer: 'No Solution (Inconsistent System)',
          steps,
        };
      }
      if (rankA < n) {
        return {
          title: `${n}×${n} Linear System`,
          primaryAnswer: 'Infinitely Many Solutions (Dependent System)',
          steps,
        };
      }
      const names = ['x', 'y', 'z'];
      const solStr = aug.slice(0, n).map((row, i) => `${names[i]} = ${fmtExactOrDecimal(row[n])}`).join(',   ');
      return {
        title: `${n}×${n} Linear System (Gauss-Jordan / Cramer)`,
        primaryAnswer: solStr,
        secondaryAnswers: [{ label: 'det(A)', value: fmtNum(detA) }],
        steps: [...steps, `Reduced Row Echelon Solution: ${solStr}`],
      };
    }

    if (input.mode === 'inequality') {
      const a = Number(input.ineqA ?? 1), b = Number(input.ineqB ?? -5), c = Number(input.ineqC ?? 6);
      const op = input.ineqOp || '>=';
      const strict = op === '>' || op === '<';
      const wantPositive = op === '>' || op === '>=';
      const lb = strict ? '(' : '[';
      const rb = strict ? ')' : ']';

      if (Math.abs(a) < 1e-12) {
        if (Math.abs(b) < 1e-12) {
          const holds = wantPositive ? (strict ? c > 0 : c >= 0) : (strict ? c < 0 : c <= 0);
          return {
            title: 'Inequality Solver',
            primaryAnswer: holds ? '(-∞, +∞) — All real x' : '∅ — No solution',
            steps: [`Reduced to constant inequality ${fmtNum(c)} ${op} 0`],
          };
        }
        const root = -c / b;
        const greaterSide = (b > 0 && wantPositive) || (b < 0 && !wantPositive);
        return {
          title: 'Linear Inequality Solver',
          primaryAnswer: greaterSide ? `${lb}${fmtNum(root)}, +∞)` : `(-∞, ${fmtNum(root)}${rb}`,
          steps: [`${fmtNum(b)}x + ${fmtNum(c)} ${op} 0 ⇒ boundary x = ${fmtNum(root)}`],
        };
      }

      const disc = b * b - 4 * a * c;
      const openUp = a > 0;
      let ans = '';
      const steps = [`Quadratic ${fmtNum(a)}x² + ${fmtNum(b)}x + ${fmtNum(c)} ${op} 0`, `Discriminant Δ = ${fmtNum(disc)}`];
      if (disc < -1e-10) {
        const alwaysPos = openUp;
        const holds = wantPositive ? alwaysPos : !alwaysPos;
        ans = holds ? '(-∞, +∞) — All real numbers' : '∅ — No real solution';
        steps.push(`No real roots; parabola is strictly ${openUp ? 'positive' : 'negative'} everywhere.`);
      } else if (Math.abs(disc) <= 1e-10) {
        const r0 = -b / (2 * a);
        const sameSign = (openUp && wantPositive) || (!openUp && !wantPositive);
        if (sameSign) {
          ans = strict ? `(-∞, ${fmtNum(r0)}) ∪ (${fmtNum(r0)}, +∞)` : '(-∞, +∞)';
        } else {
          ans = strict ? '∅ — No real solution' : `{ ${fmtNum(r0)} }`;
        }
        steps.push(`Double root at x = ${fmtNum(r0)}.`);
      } else {
        const sd = Math.sqrt(disc);
        const r1 = Math.min((-b - sd) / (2 * a), (-b + sd) / (2 * a));
        const r2 = Math.max((-b - sd) / (2 * a), (-b + sd) / (2 * a));
        const outside = (openUp && wantPositive) || (!openUp && !wantPositive);
        ans = outside
          ? `(-∞, ${fmtNum(r1)}${rb} ∪ ${lb}${fmtNum(r2)}, +∞)`
          : `${lb}${fmtNum(r1)}, ${fmtNum(r2)}${rb}`;
        steps.push(`Roots r₁ = ${fmtNum(r1)}, r₂ = ${fmtNum(r2)}; sign between roots is ${openUp ? 'negative' : 'positive'}.`);
      }
      return {
        title: `Inequality Solution (${op} 0)`,
        primaryAnswer: ans,
        steps,
      };
    }

    if (input.mode === 'matrix') {
      const n = input.matrixSize || 2;
      const A = (input.matrixA || (n === 2 ? [[4, 7], [2, 6]] : [[1, 2, 3], [0, 1, 4], [5, 6, 0]]))
        .slice(0, n)
        .map((r) => r.slice(0, n).map(Number));
      const B = (input.matrixB || (n === 2 ? [[1, 0], [0, 1]] : [[1, 0, 0], [0, 1, 0], [0, 0, 1]]))
        .slice(0, n)
        .map((r) => r.slice(0, n).map(Number));
      const op = input.matrixOp || 'det-inv';

      if (op === 'det-inv') {
        const { det, inv } = inverseMatrix(A);
        const trans = A[0].map((_, j) => A.map((row) => row[j]));
        const trace = A.reduce((s, r, i) => s + r[i], 0);
        return {
          title: `${n}×${n} Matrix Determinant, Inverse & Transpose`,
          primaryAnswer: inv ? `det(A) = ${fmtNum(det)}  |  A⁻¹ = ${fmtMatrix(inv)}` : `det(A) = 0 (Singular Matrix — Non-invertible)`,
          secondaryAnswers: [
            { label: 'Trace(A)', value: fmtNum(trace) },
            { label: 'Transpose Aᵀ', value: fmtMatrix(trans) },
          ],
          steps: [
            `A = ${fmtMatrix(A)}`,
            `det(A) = ${fmtNum(det)}`,
            inv ? `A⁻¹ = (1/det) · adj(A)` : 'Determinant is 0, so A⁻¹ does not exist.',
          ],
        };
      }

      const res: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (op === 'add') res[i][j] = A[i][j] + B[i][j];
          else if (op === 'sub') res[i][j] = A[i][j] - B[i][j];
          else {
            let s = 0;
            for (let k = 0; k < n; k++) s += A[i][k] * B[k][j];
            res[i][j] = s;
          }
        }
      }
      const label = op === 'add' ? 'A + B' : op === 'sub' ? 'A - B' : 'A × B';
      return {
        title: `${n}×${n} Matrix ${label}`,
        primaryAnswer: fmtMatrix(res),
        secondaryAnswers: [{ label: `det(${label})`, value: fmtNum(detMatrix(res)) }],
        steps: [`A = ${fmtMatrix(A)}`, `B = ${fmtMatrix(B)}`, `${label} = ${fmtMatrix(res)}`],
      };
    }

    if (input.mode === 'complex') {
      const a = Number(input.c1Re ?? 3), b = Number(input.c1Im ?? 4);
      const c = Number(input.c2Re ?? 1), d = Number(input.c2Im ?? -2);
      const n = Math.max(1, Math.min(8, Math.round(Number(input.complexN) || 2)));
      const mod1 = Math.hypot(a, b);
      const arg1Rad = Math.atan2(b, a);
      const arg1Deg = (arg1Rad * 180) / Math.PI;
      const denom2 = c * c + d * d;

      // De Moivre power z1^n
      const pMod = Math.pow(mod1, n);
      const pRe = pMod * Math.cos(n * arg1Rad);
      const pIm = pMod * Math.sin(n * arg1Rad);

      // n-th roots of z1
      const rMod = Math.pow(mod1, 1 / n);
      const nthRoots = Array.from({ length: n }, (_, k) => {
        const th = (arg1Rad + 2 * Math.PI * k) / n;
        return fmtComplex(rMod * Math.cos(th), rMod * Math.sin(th), 4);
      }).join(' ,  ');

      return {
        title: `Complex Numbers: z₁ = ${fmtComplex(a, b)} & z₂ = ${fmtComplex(c, d)}`,
        primaryAnswer: `z₁·z₂ = ${fmtComplex(a * c - b * d, a * d + b * c)}`,
        secondaryAnswers: [
          { label: 'z₁ + z₂  /  z₁ - z₂', value: `${fmtComplex(a + c, b + d)}   |   ${fmtComplex(a - c, b - d)}` },
          {
            label: 'z₁ / z₂',
            value: denom2 < 1e-12 ? 'Undefined (z₂ = 0)' : fmtComplex((a * c + b * d) / denom2, (b * c - a * d) / denom2),
          },
          { label: 'Polar Form of z₁', value: `${fmtNum(mod1)} · (cos ${fmtNum(arg1Deg)}° + i sin ${fmtNum(arg1Deg)}°)` },
          { label: `z₁^${n} (De Moivre)`, value: fmtComplex(pRe, pIm) },
          { label: `All ${n}th Roots of z₁`, value: nthRoots },
        ],
        steps: [
          `|z₁| = √(${fmtNum(a)}² + ${fmtNum(b)}²) = ${fmtNum(mod1)}, arg(z₁) = ${fmtNum(arg1Deg)}° (${fmtNum(arg1Rad)} rad)`,
          `De Moivre: z₁^${n} = |z₁|^${n} · cis(${n}θ) = ${fmtComplex(pRe, pIm)}`,
        ],
      };
    }

    // Progressions & Combinatorics
    const pt = input.progType || 'AP';
    if (pt === 'COMB') {
      const n = Math.max(0, Math.min(170, Math.round(Number(input.combN ?? 10))));
      const r = Math.max(0, Math.min(n, Math.round(Number(input.combR ?? 3))));
      let ncr = 1;
      for (let i = 1; i <= Math.min(r, n - r); i++) {
        ncr = (ncr * (n - i + 1)) / i;
      }
      let npr = 1;
      for (let i = 0; i < r; i++) npr *= n - i;
      return {
        title: `Combinatorics: n = ${n}, r = ${r}`,
        primaryAnswer: `${n}C${r} = ${fmtNum(ncr, 12)}   |   ${n}P${r} = ${fmtNum(npr, 12)}`,
        secondaryAnswers: [
          { label: `Factorial ${Math.min(n, 25)}!`, value: n <= 25 ? fmtNum(Array.from({ length: n }, (_, i) => i + 1).reduce((a, b) => a * b, 1), 15) : 'Use n ≤ 25 for exact factorial' },
        ],
        steps: [`nCr = n! / (r!(n-r)!) = ${fmtNum(ncr, 12)}`, `nPr = n! / (n-r)! = ${fmtNum(npr, 12)}`],
      };
    }

    const a = Number(input.firstTerm ?? 2);
    const dr = Number(input.diffOrRatio ?? 3);
    const n = Math.max(1, Math.min(1000, Math.round(Number(input.termCount ?? 10))));
    if (pt === 'AP') {
      const tn = a + (n - 1) * dr;
      const sn = (n / 2) * (2 * a + (n - 1) * dr);
      return {
        title: `Arithmetic Progression (a=${fmtNum(a)}, d=${fmtNum(dr)}, n=${n})`,
        primaryAnswer: `T_${n} = ${fmtNum(tn)}   |   S_${n} = ${fmtNum(sn)}`,
        steps: [`Tₙ = a + (n-1)d = ${fmtNum(tn)}`, `Sₙ = (n/2)(2a + (n-1)d) = ${fmtNum(sn)}`],
      };
    }
    if (pt === 'GP') {
      const tn = a * Math.pow(dr, n - 1);
      const sn = Math.abs(dr - 1) < 1e-12 ? a * n : (a * (Math.pow(dr, n) - 1)) / (dr - 1);
      const sInf = Math.abs(dr) < 1 ? fmtNum(a / (1 - dr)) : 'Diverges (|r| ≥ 1)';
      return {
        title: `Geometric Progression (a=${fmtNum(a)}, r=${fmtNum(dr)}, n=${n})`,
        primaryAnswer: `T_${n} = ${fmtNum(tn)}   |   S_${n} = ${fmtNum(sn)}`,
        secondaryAnswers: [{ label: 'Infinite Sum S_∞', value: sInf }],
        steps: [`Tₙ = a·r^(n-1) = ${fmtNum(tn)}`, `Sₙ = ${fmtNum(sn)}`],
      };
    }
    // HP: reciprocal of AP starting at 1/a with step dr (assuming AP terms a, a+d, ...)
    const apTn = a + (n - 1) * dr;
    const hpTn = Math.abs(apTn) < 1e-12 ? Infinity : 1 / apTn;
    return {
      title: `Harmonic Progression (1/${fmtNum(a)}, 1/${fmtNum(a + dr)}, ...)`,
      primaryAnswer: `T_${n} = ${fmtExactOrDecimal(hpTn)}`,
      steps: [`Corresponding AP term = ${fmtNum(apTn)}; HP term = 1 / (${fmtNum(apTn)}) = ${fmtNum(hpTn)}`],
    };
  } catch (err) {
    return {
      title: 'Algebra Solver Error',
      primaryAnswer: '',
      steps: [],
      error: err instanceof Error ? err.message : 'Unable to solve algebraic input.',
    };
  }
}

// ============================================================================
// 4. VECTOR & 3D GEOMETRY SOLVER
// ============================================================================

export type Vec3 = [number, number, number];
const vAdd = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vSub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vScale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const vDot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vCross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const vNorm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const fmtVec = (a: Vec3): string => `(${fmtNum(a[0])}, ${fmtNum(a[1])}, ${fmtNum(a[2])})`;
const fmtVecIJK = (a: Vec3): string =>
  `${fmtNum(a[0])}î ${a[1] >= 0 ? '+' : '-'} ${fmtNum(Math.abs(a[1]))}ĵ ${a[2] >= 0 ? '+' : '-'} ${fmtNum(Math.abs(a[2]))}k̂`;

export interface Vector3DInput {
  mode: 'vector-ops' | 'line-3d' | 'plane-3d';
  vecA?: Vec3;
  vecB?: Vec3;
  vecC?: Vec3;
  // Line 1: p1 + t * d1, Line 2: p2 + s * d2
  p1?: Vec3; d1?: Vec3;
  p2?: Vec3; d2?: Vec3;
  testPoint?: Vec3;
  // Plane modes
  planeMode?: 'three-points' | 'point-normal' | 'general';
  p3?: Vec3;
  plane1?: [number, number, number, number]; // a, b, c, d for ax+by+cz+d=0
  plane2?: [number, number, number, number];
}

export function solveVector3D(input: Vector3DInput): CalcResult {
  try {
    if (input.mode === 'vector-ops') {
      const a: Vec3 = (input.vecA || [2, -1, 3]).map(Number) as Vec3;
      const b: Vec3 = (input.vecB || [1, 4, -2]).map(Number) as Vec3;
      const c: Vec3 = (input.vecC || [0, 1, 2]).map(Number) as Vec3;
      const dot = vDot(a, b);
      const cross = vCross(a, b);
      const na = vNorm(a), nb = vNorm(b), nCross = vNorm(cross);
      const cosAng = na > 1e-12 && nb > 1e-12 ? Math.min(1, Math.max(-1, dot / (na * nb))) : 1;
      const angDeg = (Math.acos(cosAng) * 180) / Math.PI;
      const scalarProj = nb > 1e-12 ? dot / nb : 0;
      const vecProj = nb > 1e-12 ? vScale(b, dot / (nb * nb)) : ([0, 0, 0] as Vec3);
      const stp = vDot(a, vCross(b, c)); // [a b c]
      const vtp = vCross(a, vCross(b, c)); // a x (b x c)

      return {
        title: '3D Vector Algebra & Triple Products',
        primaryAnswer: `a·b = ${fmtNum(dot)}   |   a×b = ${fmtVecIJK(cross)}`,
        secondaryAnswers: [
          { label: '|a| , |b| , |a×b|', value: `${fmtNum(na)},  ${fmtNum(nb)},  ${fmtNum(nCross)}` },
          { label: 'Unit Vector â & Direction Cosines', value: na > 1e-12 ? fmtVec(vScale(a, 1 / na)) : 'Zero vector' },
          { label: 'Angle θ Between a & b', value: `${fmtNum(angDeg)}° (${fmtNum((angDeg * Math.PI) / 180)} rad)` },
          { label: 'Projection of a onto b', value: `Scalar = ${fmtNum(scalarProj)}  |  Vector = ${fmtVec(vecProj)}` },
          { label: 'Parallelogram / Triangle Area', value: `Parallelogram = ${fmtNum(nCross)},  Triangle = ${fmtNum(0.5 * nCross)}` },
          { label: 'Scalar Triple [a b c] (Volume)', value: `${fmtNum(stp)}${Math.abs(stp) < 1e-9 ? ' (Coplanar!)' : ''}` },
          { label: 'Vector Triple a × (b × c)', value: fmtVecIJK(vtp) },
        ],
        steps: [
          `a + b = ${fmtVec(vAdd(a, b))},   a - b = ${fmtVec(vSub(a, b))}`,
          `a·b = ${fmtNum(dot)},  angle = arccos(a·b / |a||b|) = ${fmtNum(angDeg)}°`,
          `[a b c] = a·(b×c) = ${fmtNum(stp)}`,
        ],
      };
    }

    if (input.mode === 'line-3d') {
      const p1: Vec3 = (input.p1 || [1, 2, 3]).map(Number) as Vec3;
      const d1: Vec3 = (input.d1 || [2, -1, 1]).map(Number) as Vec3;
      const p2: Vec3 = (input.p2 || [2, 0, -1]).map(Number) as Vec3;
      const d2: Vec3 = (input.d2 || [1, 3, -2]).map(Number) as Vec3;
      const pt: Vec3 = (input.testPoint || [0, 0, 0]).map(Number) as Vec3;

      const nd1 = vNorm(d1), nd2 = vNorm(d2);
      if (nd1 < 1e-12 || nd2 < 1e-12) throw new Error('Line direction vectors cannot be zero.');

      const nCross = vCross(d1, d2);
      const crossMag = vNorm(nCross);
      const p21 = vSub(p2, p1);
      const angDeg = (Math.acos(Math.min(1, Math.abs(vDot(d1, d2)) / (nd1 * nd2))) * 180) / Math.PI;

      // Distance from testPoint to L1
      const ptMinusP1 = vSub(pt, p1);
      const distPtToL1 = vNorm(vCross(ptMinusP1, d1)) / nd1;
      const tFoot = vDot(ptMinusP1, d1) / (nd1 * nd1);
      const footL1 = vAdd(p1, vScale(d1, tFoot));

      let relation = '';
      let primary = '';
      if (crossMag < 1e-10) {
        const distPar = vNorm(vCross(p21, d1)) / nd1;
        relation = distPar < 1e-9 ? 'Coincident Lines (d = 0)' : `Parallel Lines (Distance = ${fmtNum(distPar)})`;
        primary = relation;
      } else {
        const num = Math.abs(vDot(p21, nCross));
        const sd = num / crossMag;
        if (sd < 1e-8) {
          // Solve closest points on intersecting lines
          const a11 = vDot(d1, d1), a12 = -vDot(d1, d2), a22 = vDot(d2, d2);
          const b1 = vDot(d1, p21), b2 = -vDot(d2, p21);
          const det = a11 * a22 - a12 * a12;
          const t = (b1 * a22 - b2 * a12) / det;
          const inter = vAdd(p1, vScale(d1, t));
          relation = `Intersecting Lines at ${fmtVec(inter)}`;
          primary = relation;
        } else {
          relation = `Skew Lines (Shortest Distance = ${fmtNum(sd)})`;
          primary = relation;
        }
      }

      return {
        title: '3D Lines: Shortest Distance, Angle & Intersection',
        primaryAnswer: primary,
        secondaryAnswers: [
          { label: 'Angle Between L₁ & L₂', value: `${fmtNum(angDeg)}°` },
          { label: `Distance from P${fmtVec(pt)} to L₁`, value: `${fmtNum(distPtToL1)} (Foot: ${fmtVec(footL1)})` },
          { label: 'd₁ × d₂ (Common Normal)', value: fmtVec(nCross) },
        ],
        steps: [
          `L₁: r = ${fmtVec(p1)} + t${fmtVec(d1)}`,
          `L₂: r = ${fmtVec(p2)} + s${fmtVec(d2)}`,
          `Direction cross product d₁ × d₂ = ${fmtVec(nCross)}`,
          relation,
        ],
      };
    }

    // plane-3d
    const pm = input.planeMode || 'three-points';
    let a = 1, b = 1, c = 1, d = -3;
    const steps: string[] = [];
    if (pm === 'three-points') {
      const p = (input.p1 || [1, 0, 0]).map(Number) as Vec3;
      const q = (input.p2 || [0, 2, 0]).map(Number) as Vec3;
      const r = (input.p3 || [0, 0, 3]).map(Number) as Vec3;
      const nVec = vCross(vSub(q, p), vSub(r, p));
      if (vNorm(nVec) < 1e-12) throw new Error('The 3 points are collinear and do not define a unique plane.');
      a = nVec[0]; b = nVec[1]; c = nVec[2]; d = -vDot(nVec, p);
      steps.push(`Normal n = (Q - P) × (R - P) = ${fmtVec(nVec)}`);
    } else if (pm === 'point-normal') {
      const p = (input.p1 || [1, -2, 3]).map(Number) as Vec3;
      const nVec = (input.d1 || [2, 3, -1]).map(Number) as Vec3;
      if (vNorm(nVec) < 1e-12) throw new Error('Normal vector cannot be zero.');
      a = nVec[0]; b = nVec[1]; c = nVec[2]; d = -vDot(nVec, p);
      steps.push(`Point ${fmtVec(p)}, Normal n = ${fmtVec(nVec)}`);
    } else {
      const pl = input.plane1 || [2, -1, 2, -6];
      a = Number(pl[0]); b = Number(pl[1]); c = Number(pl[2]); d = Number(pl[3]);
    }
    const nMag = Math.hypot(a, b, c);
    if (nMag < 1e-12) throw new Error('Plane normal vector cannot be zero.');

    const pt: Vec3 = (input.testPoint || [0, 0, 0]).map(Number) as Vec3;
    const signed = a * pt[0] + b * pt[1] + c * pt[2] + d;
    const distPt = Math.abs(signed) / nMag;
    const k = -signed / (nMag * nMag);
    const foot: Vec3 = [pt[0] + a * k, pt[1] + b * k, pt[2] + c * k];
    const refl: Vec3 = [pt[0] + 2 * a * k, pt[1] + 2 * b * k, pt[2] + 2 * c * k];
    const eqStr = `${fmtNum(a)}x ${b >= 0 ? '+' : '-'} ${fmtNum(Math.abs(b))}y ${c >= 0 ? '+' : '-'} ${fmtNum(Math.abs(c))}z ${d >= 0 ? '+' : '-'} ${fmtNum(Math.abs(d))} = 0`;

    const secondary: { label: string; value: string }[] = [
      { label: 'Unit Normal n̂', value: fmtVec([a / nMag, b / nMag, c / nMag]) },
      { label: `Distance from P${fmtVec(pt)} to Plane`, value: fmtNum(distPt) },
      { label: 'Foot of Perpendicular', value: fmtVec(foot) },
      { label: 'Mirror Reflection Image', value: fmtVec(refl) },
    ];

    if (input.plane2) {
      const [a2, b2, c2, d2] = input.plane2.map(Number);
      const n2Mag = Math.hypot(a2, b2, c2);
      if (n2Mag > 1e-12) {
        const cosA = Math.min(1, Math.abs(a * a2 + b * b2 + c * c2) / (nMag * n2Mag));
        const angP = (Math.acos(cosA) * 180) / Math.PI;
        const dirInter = vCross([a, b, c], [a2, b2, c2]);
        secondary.push({
          label: 'Angle & Intersection Direction with Plane 2',
          value: `Angle = ${fmtNum(angP)}°  |  Line dir = ${fmtVec(dirInter)}`,
        });
        void d2;
      }
    }

    return {
      title: '3D Plane Equation, Distance, Foot & Reflection',
      primaryAnswer: eqStr,
      secondaryAnswers: secondary,
      steps: [...steps, `Cartesian Plane: ${eqStr}`, `Point-to-Plane distance = ${fmtNum(distPt)}`],
    };
  } catch (err) {
    return {
      title: 'Vector & 3D Geometry Error',
      primaryAnswer: '',
      steps: [],
      error: err instanceof Error ? err.message : 'Unable to compute 3D geometry.',
    };
  }
}

// ============================================================================
// 5. TRIGONOMETRY SOLVER
// ============================================================================

export interface TrigInput {
  mode: 'evaluate' | 'triangle' | 'equation' | 'conversions';
  angleUnit?: 'deg' | 'rad';
  angleExpr?: string;
  // triangle solver
  triCase?: 'SSS' | 'SAS' | 'ASA' | 'AAS' | 'SSA';
  a?: number; b?: number; c?: number;
  A?: number; B?: number; C?: number;
  // trig equation LHS = RHS (or expr = 0)
  equation?: string;
  // conversions
  convType?: 'deg-rad-dms' | 'polar-to-cart' | 'cart-to-polar';
  convX?: number; convY?: number; convZ?: number;
}

const EXACT_SIN_TABLE: Record<number, string> = {
  0: '0',
  15: '(√6 - √2)/4',
  30: '1/2',
  45: '√2/2',
  60: '√3/2',
  75: '(√6 + √2)/4',
  90: '1',
};

function exactSinLookup(degRaw: number): string | null {
  const norm = ((degRaw % 360) + 360) % 360;
  const rounded = Math.round(norm);
  if (Math.abs(norm - rounded) > 1e-7 || rounded % 15 !== 0) return null;
  let ref = rounded;
  let sign = '';
  if (ref > 180) {
    sign = '-';
    ref = 360 - ref;
  }
  if (ref > 90) ref = 180 - ref;
  const base = EXACT_SIN_TABLE[ref];
  if (!base) return null;
  return base === '0' ? '0' : `${sign}${base}`;
}

export function solveTrigonometry(input: TrigInput): CalcResult {
  try {
    const unit = input.angleUnit || 'deg';

    if (input.mode === 'evaluate') {
      const val = evalExpr(parseExpr(input.angleExpr || '30'), {}, unit);
      const deg = unit === 'deg' ? val : (val * 180) / Math.PI;
      const rad = unit === 'rad' ? val : (val * Math.PI) / 180;
      const s = Math.sin(rad), c = Math.cos(rad);
      const t = Math.abs(c) < 1e-12 ? Infinity : s / c;
      const normDeg = ((deg % 360) + 360) % 360;
      const quad =
        normDeg === 0 || normDeg === 90 || normDeg === 180 || normDeg === 270
          ? 'Quadrantal axis'
          : normDeg < 90 ? 'Quadrant I' : normDeg < 180 ? 'Quadrant II' : normDeg < 270 ? 'Quadrant III' : 'Quadrant IV';

      const exSin = exactSinLookup(deg);
      const exCos = exactSinLookup(90 - deg);

      return {
        title: `Trigonometric Ratios at ${fmtNum(deg)}° (${fmtExactOrDecimal(rad)} rad)`,
        primaryAnswer: `sin = ${exSin ? `${exSin} (${fmtNum(s)})` : fmtNum(s)}  |  cos = ${exCos ? `${exCos} (${fmtNum(c)})` : fmtNum(c)}  |  tan = ${fmtNum(t)}`,
        secondaryAnswers: [
          { label: 'csc / sec / cot', value: `csc = ${Math.abs(s) < 1e-12 ? '∞' : fmtNum(1 / s)},  sec = ${Math.abs(c) < 1e-12 ? '∞' : fmtNum(1 / c)},  cot = ${Math.abs(s) < 1e-12 ? '∞' : fmtNum(c / s)}` },
          { label: 'Quadrant & Coterminal Angle', value: `${quad} (${fmtNum(normDeg)}°)` },
        ],
        steps: [
          `Angle: ${fmtNum(deg)}° = ${fmtExactOrDecimal(rad)} rad`,
          `Normalized coterminal angle: ${fmtNum(normDeg)}° (${quad})`,
        ],
      };
    }

    if (input.mode === 'triangle') {
      const toR = (d: number) => (unit === 'deg' ? (d * Math.PI) / 180 : d);
      const toD = (r: number) => (r * 180) / Math.PI;
      const tCase = input.triCase || 'SAS';
      const solutions: { a: number; b: number; c: number; A: number; B: number; C: number }[] = [];

      const pushSol = (a: number, b: number, c: number, A: number, B: number, C: number) => {
        if ([a, b, c, A, B, C].every((x) => Number.isFinite(x) && x > 1e-9)) {
          solutions.push({ a, b, c, A, B, C });
        }
      };

      if (tCase === 'SSS') {
        const a = Number(input.a ?? 5), b = Number(input.b ?? 6), c = Number(input.c ?? 7);
        if (a <= 0 || b <= 0 || c <= 0 || a + b <= c || a + c <= b || b + c <= a) {
          throw new Error('Triangle inequality violated (sum of any two sides must exceed third).');
        }
        const A = toD(Math.acos((b * b + c * c - a * a) / (2 * b * c)));
        const B = toD(Math.acos((a * a + c * c - b * b) / (2 * a * c)));
        const C = 180 - A - B;
        pushSol(a, b, c, A, B, C);
      } else if (tCase === 'SAS') {
        // sides a, b and included angle C
        const a = Number(input.a ?? 5), b = Number(input.b ?? 7), Cdeg = toD(toR(Number(input.C ?? 60)));
        if (a <= 0 || b <= 0 || Cdeg <= 0 || Cdeg >= 180) throw new Error('Sides must be > 0 and included angle in (0°, 180°).');
        const Crad = (Cdeg * Math.PI) / 180;
        const c = Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(Crad));
        const A = toD(Math.acos(Math.min(1, Math.max(-1, (b * b + c * c - a * a) / (2 * b * c)))));
        const B = 180 - A - Cdeg;
        pushSol(a, b, c, A, B, Cdeg);
      } else if (tCase === 'ASA') {
        // angles A, B and included side c
        const Adeg = toD(toR(Number(input.A ?? 40))), Bdeg = toD(toR(Number(input.B ?? 65))), c = Number(input.c ?? 8);
        const Cdeg = 180 - Adeg - Bdeg;
        if (Adeg <= 0 || Bdeg <= 0 || Cdeg <= 0 || c <= 0) throw new Error('Angles must sum to < 180° and side > 0.');
        const sinC = Math.sin((Cdeg * Math.PI) / 180);
        const a = (c * Math.sin((Adeg * Math.PI) / 180)) / sinC;
        const b = (c * Math.sin((Bdeg * Math.PI) / 180)) / sinC;
        pushSol(a, b, c, Adeg, Bdeg, Cdeg);
      } else if (tCase === 'AAS') {
        // angles A, B and side a
        const Adeg = toD(toR(Number(input.A ?? 40))), Bdeg = toD(toR(Number(input.B ?? 65))), a = Number(input.a ?? 8);
        const Cdeg = 180 - Adeg - Bdeg;
        if (Adeg <= 0 || Bdeg <= 0 || Cdeg <= 0 || a <= 0) throw new Error('Angles must sum to < 180° and side > 0.');
        const sinA = Math.sin((Adeg * Math.PI) / 180);
        const b = (a * Math.sin((Bdeg * Math.PI) / 180)) / sinA;
        const c = (a * Math.sin((Cdeg * Math.PI) / 180)) / sinA;
        pushSol(a, b, c, Adeg, Bdeg, Cdeg);
      } else {
        // SSA ambiguous case: a, b, A
        const a = Number(input.a ?? 7), b = Number(input.b ?? 10), Adeg = toD(toR(Number(input.A ?? 30)));
        if (a <= 0 || b <= 0 || Adeg <= 0 || Adeg >= 180) throw new Error('Sides must be > 0 and angle in (0°, 180°).');
        const Arad = (Adeg * Math.PI) / 180;
        const sinB = (b * Math.sin(Arad)) / a;
        if (sinB > 1 + 1e-9) {
          return {
            title: 'SSA Ambiguous Triangle Check',
            primaryAnswer: '0 Valid Triangles (a < b·sin(A))',
            steps: [`sin(B) = ${fmtNum(sinB)} > 1, so no triangle can be formed.`],
          };
        }
        const clamped = Math.min(1, sinB);
        const B1 = toD(Math.asin(clamped));
        const B2 = 180 - B1;
        const sinA = Math.sin(Arad);
        if (Adeg + B1 < 180 - 1e-7) {
          const C1 = 180 - Adeg - B1;
          pushSol(a, b, (a * Math.sin((C1 * Math.PI) / 180)) / sinA, Adeg, B1, C1);
        }
        if (Math.abs(B2 - B1) > 1e-6 && Adeg + B2 < 180 - 1e-7) {
          const C2 = 180 - Adeg - B2;
          pushSol(a, b, (a * Math.sin((C2 * Math.PI) / 180)) / sinA, Adeg, B2, C2);
        }
        if (solutions.length === 0) {
          return { title: 'SSA Triangle Solver', primaryAnswer: '0 Valid Triangles', steps: ['No valid positive third angle found.'] };
        }
      }

      const main = solutions[0];
      const s = 0.5 * (main.a + main.b + main.c);
      const area = Math.sqrt(Math.max(0, s * (s - main.a) * (s - main.b) * (s - main.c)));
      const R = (main.a * main.b * main.c) / (4 * area);
      const r = area / s;

      const secondary: { label: string; value: string }[] = [
        { label: 'Area & Perimeter', value: `Area = ${fmtNum(area)},  Perimeter = ${fmtNum(2 * s)}` },
        { label: 'Circumradius R & Inradius r', value: `R = ${fmtNum(R)},  r = ${fmtNum(r)}` },
        { label: 'Altitudes (h_a, h_b, h_c)', value: `${fmtNum((2 * area) / main.a)},  ${fmtNum((2 * area) / main.b)},  ${fmtNum((2 * area) / main.c)}` },
      ];
      if (solutions.length > 1) {
        const s2 = solutions[1];
        secondary.unshift({
          label: 'Second Ambiguous Solution (#2)',
          value: `a=${fmtNum(s2.a)}, b=${fmtNum(s2.b)}, c=${fmtNum(s2.c)} | A=${fmtNum(s2.A)}°, B=${fmtNum(s2.B)}°, C=${fmtNum(s2.C)}°`,
        });
      }

      return {
        title: `Triangle Solution (${tCase}${solutions.length > 1 ? ' — 2 Solutions Found' : ''})`,
        primaryAnswer: `a=${fmtNum(main.a)}, b=${fmtNum(main.b)}, c=${fmtNum(main.c)}  |  A=${fmtNum(main.A)}°, B=${fmtNum(main.B)}°, C=${fmtNum(main.C)}°`,
        secondaryAnswers: secondary,
        steps: [
          `Solved using Law of Sines / Law of Cosines (${tCase})`,
          `Sum of angles: ${fmtNum(main.A)}° + ${fmtNum(main.B)}° + ${fmtNum(main.C)}° = 180°`,
          `Heron's semi-perimeter s = ${fmtNum(s)}, Area = ${fmtNum(area)}`,
        ],
      };
    }

    if (input.mode === 'equation') {
      const raw = (input.equation || '2sin(x) - 1 = 0').trim();
      const parts = raw.split('=');
      if (parts.length > 2) throw new Error('Equation may contain at most one "=" sign.');
      const ast = parts.length === 2 ? parseExpr(`(${parts[0]}) - (${parts[1]})`) : parseExpr(parts[0]);
      // Solve on [0, 2pi) in radians internally, then format in unit
      const period = 2 * Math.PI;
      const fn = (rad: number) => evalExpr(ast, { x: unit === 'deg' ? (rad * 180) / Math.PI : rad }, unit);
      const N = 720;
      const dx = period / N;
      const roots: number[] = [];
      const addRoot = (r: number) => {
        const norm = ((r % period) + period) % period;
        if (Math.abs(norm - period) < 1e-4) return;
        if (Math.abs(fn(norm)) > 1e-3) return;
        if (!roots.some((x) => Math.abs(x - norm) < 1e-3)) roots.push(Math.abs(norm) < 1e-8 ? 0 : norm);
      };
      for (let i = 0; i < N; i++) {
        let xL = i * dx;
        let xR = xL + dx;
        let yL = fn(xL);
        let yR = fn(xR);
        if (Number.isFinite(yL) && Math.abs(yL) < 1e-7) addRoot(xL);
        if (Number.isFinite(yL) && Number.isFinite(yR) && Math.abs(yL) < 50 && Math.abs(yR) < 50 && yL * yR <= 0) {
          for (let it = 0; it < 38; it++) {
            const m = 0.5 * (xL + xR);
            const ym = fn(m);
            if (!Number.isFinite(ym)) break;
            if (yL * ym <= 0) { xR = m; yR = ym; } else { xL = m; yL = ym; }
          }
          addRoot(0.5 * (xL + xR));
        }
      }
      roots.sort((u, v) => u - v);
      const formatted = roots.map((r) => (unit === 'deg' ? `${fmtNum((r * 180) / Math.PI)}°` : fmtExactOrDecimal(r)));
      return {
        title: `Trig Equation Roots on ${unit === 'deg' ? '[0°, 360°)' : '[0, 2π)'}`,
        primaryAnswer: formatted.length ? formatted.join(',   ') : 'No real solutions in primary period',
        secondaryAnswers: roots.length
          ? [{
              label: 'Also expressed in ' + (unit === 'deg' ? 'radians' : 'degrees'),
              value: roots.map((r) => (unit === 'deg' ? fmtExactOrDecimal(r) : `${fmtNum((r * 180) / Math.PI)}°`)).join(',   '),
            }]
          : [],
        steps: [
          `Scanned 720 subintervals across ${unit === 'deg' ? '[0°, 360°)' : '[0, 2π)'} with bisection refinement.`,
          `Found ${roots.length} solution(s) in primary period.`,
        ],
      };
    }

    // Conversions
    const ct = input.convType || 'deg-rad-dms';
    if (ct === 'deg-rad-dms') {
      const x = Number(input.convX ?? 45.5);
      const deg = unit === 'deg' ? x : (x * 180) / Math.PI;
      const rad = unit === 'rad' ? x : (x * Math.PI) / 180;
      const sign = deg < 0 ? '-' : '';
      const absD = Math.abs(deg);
      const dPart = Math.floor(absD);
      const mFloat = (absD - dPart) * 60;
      const mPart = Math.floor(mFloat);
      const sPart = (mFloat - mPart) * 60;
      const grad = (deg * 10) / 9;
      return {
        title: 'Angle Conversion (Degrees ↔ Radians ↔ DMS ↔ Gradians)',
        primaryAnswer: `${fmtNum(deg)}°  =  ${fmtExactOrDecimal(rad)} rad`,
        secondaryAnswers: [
          { label: 'DMS (Deg° Min\' Sec")', value: `${sign}${dPart}° ${mPart}' ${fmtNum(sPart, 5)}"` },
          { label: 'Gradians', value: `${fmtNum(grad)} gon` },
        ],
        steps: [`180° = π radians`, `DMS breakdown: ${dPart}° + ${mPart}/60° + ${fmtNum(sPart, 4)}/3600°`],
      };
    }
    if (ct === 'polar-to-cart') {
      const r = Number(input.convX ?? 5);
      const th = Number(input.convY ?? 53.13);
      const rad = unit === 'deg' ? (th * Math.PI) / 180 : th;
      const x = r * Math.cos(rad);
      const y = r * Math.sin(rad);
      return {
        title: 'Polar (r, θ) → Cartesian (x, y)',
        primaryAnswer: `(x, y) = (${fmtNum(x)}, ${fmtNum(y)})`,
        steps: [`x = r·cos(θ) = ${fmtNum(x)}`, `y = r·sin(θ) = ${fmtNum(y)}`],
      };
    }
    // cart-to-polar
    const x = Number(input.convX ?? 3), y = Number(input.convY ?? 4);
    const r = Math.hypot(x, y);
    const rad = Math.atan2(y, x);
    const deg = (rad * 180) / Math.PI;
    return {
      title: 'Cartesian (x, y) → Polar (r, θ)',
      primaryAnswer: `r = ${fmtNum(r)},  θ = ${fmtNum(deg)}° (${fmtExactOrDecimal(rad)} rad)`,
      steps: [`r = √(x² + y²) = ${fmtNum(r)}`, `θ = atan2(y, x) = ${fmtNum(deg)}°`],
    };
  } catch (err) {
    return {
      title: 'Trigonometry Solver Error',
      primaryAnswer: '',
      steps: [],
      error: err instanceof Error ? err.message : 'Unable to evaluate trigonometry problem.',
    };
  }
}
