import { desc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import { appSettings, formulaEquations, users } from './schema.ts';
import {
  getLocalStore,
  isDbUnavailableError,
  nextSeq,
  persistLocalStore,
  type StoreFormulaMeteredSession,
} from './localStore.ts';
import { awardPoints } from './users.ts';
import type { FormulaAccessStatus, FormulaEquationItem, FormulaSymbolDef } from '../types.ts';

function parseSymbolsJson(raw: unknown): FormulaSymbolDef[] {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => x && typeof x.symbol === 'string' && typeof x.meaning === 'string')
      .map((x) => ({
        symbol: String(x.symbol).trim().slice(0, 24),
        meaning: String(x.meaning).trim().slice(0, 140),
        unit: typeof x.unit === 'string' ? x.unit.trim().slice(0, 40) : '',
      }))
      .filter((x) => x.symbol.length > 0 && x.meaning.length > 0);
  } catch {
    return [];
  }
}

function inferCaseFromSubjectOrTitle(subject: string, title: string): string {
  const hay = `${subject} ${title}`.toLowerCase();
  if (hay.includes('equation of motion') || hay.includes('kinematics')) {
    return 'Uniformly Accelerated Motion';
  }
  if (hay.includes('newton')) return 'Newtonian Dynamics';
  if (hay.includes('kinetic') || hay.includes('work & energy')) return 'Work & Kinetic Energy';
  if (hay.includes('ideal gas')) return 'Ideal Gas State';
  if (hay.includes('ohm') || hay.includes('electrical power')) return 'Ohmic DC Circuit';
  if (hay.includes('lens')) return 'Thin Lens Ray Optics';
  if (hay.includes('ellipse') || hay.includes('conic')) return 'Conic Sections — Ellipse';
  if (hay.includes('projectile')) return 'Projectile Motion (Level Ground)';
  return 'General';
}

function toFormulaItem(row: typeof formulaEquations.$inferSelect): FormulaEquationItem {
  const rawCase = (row.caseName || '').trim();
  const caseName =
    rawCase && rawCase !== 'General'
      ? rawCase
      : inferCaseFromSubjectOrTitle(row.subject, row.title);
  return {
    id: row.id,
    authorId: row.authorId,
    authorName: row.authorName,
    authorUsername: row.authorUsername,
    title: row.title,
    subject: row.subject,
    caseName,
    expression: row.expression,
    description: row.description,
    symbols: parseSymbolsJson(row.symbolsJson),
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString(),
  };
}

const DEFAULT_SEED_FORMULAS: {
  title: string;
  subject: string;
  caseName: string;
  expression: string;
  description: string;
  symbols: FormulaSymbolDef[];
}[] = [
  {
    title: 'First Equation of Motion',
    subject: 'Physics — Kinematics',
    caseName: 'Uniformly Accelerated Motion',
    expression: 'v = u + a * t',
    description: 'Relates final velocity, initial velocity, constant acceleration, and time interval.',
    symbols: [
      { symbol: 'v', meaning: 'final velocity', unit: 'm/s' },
      { symbol: 'u', meaning: 'initial velocity', unit: 'm/s' },
      { symbol: 'a', meaning: 'acceleration', unit: 'm/s^2' },
      { symbol: 't', meaning: 'time interval', unit: 's' },
    ],
  },
  {
    title: 'Second Equation of Motion',
    subject: 'Physics — Kinematics',
    caseName: 'Uniformly Accelerated Motion',
    expression: 's = u * t + 1/2 * a * t^2',
    description: 'Calculates displacement under uniformly accelerated motion over a time interval.',
    symbols: [
      { symbol: 's', meaning: 'displacement', unit: 'm' },
      { symbol: 'u', meaning: 'initial velocity', unit: 'm/s' },
      { symbol: 't', meaning: 'time interval', unit: 's' },
      { symbol: 'a', meaning: 'acceleration', unit: 'm/s^2' },
    ],
  },
  {
    title: 'Third Equation of Motion',
    subject: 'Physics — Kinematics',
    caseName: 'Uniformly Accelerated Motion',
    expression: 'v^2 = u^2 + 2 * a * s',
    description: 'Time-independent relation between velocity, constant acceleration, and displacement.',
    symbols: [
      { symbol: 'v', meaning: 'final velocity', unit: 'm/s' },
      { symbol: 'u', meaning: 'initial velocity', unit: 'm/s' },
      { symbol: 'a', meaning: 'acceleration', unit: 'm/s^2' },
      { symbol: 's', meaning: 'displacement', unit: 'm' },
    ],
  },
  {
    title: 'Projectile Range on Level Ground',
    subject: 'Physics — Kinematics',
    caseName: 'Projectile Motion (Level Ground)',
    expression: 'R_proj = u^2 * sin(2 * theta) / g',
    description: 'Horizontal range of a projectile launched at speed u and angle theta.',
    symbols: [
      { symbol: 'R_proj', meaning: 'horizontal range', unit: 'm' },
      { symbol: 'u', meaning: 'launch speed', unit: 'm/s' },
      { symbol: 'theta', meaning: 'launch angle', unit: 'rad' },
      { symbol: 'g', meaning: 'gravitational acceleration', unit: 'm/s^2' },
    ],
  },
  {
    title: "Newton's Second Law",
    subject: 'Physics — Mechanics',
    caseName: 'Newtonian Dynamics',
    expression: 'F = m * a',
    description: 'Net force equals mass multiplied by acceleration.',
    symbols: [
      { symbol: 'F', meaning: 'net force', unit: 'N' },
      { symbol: 'm', meaning: 'mass', unit: 'kg' },
      { symbol: 'a', meaning: 'acceleration', unit: 'm/s^2' },
    ],
  },
  {
    title: 'Kinetic Energy',
    subject: 'Physics — Work & Energy',
    caseName: 'Work & Kinetic Energy',
    expression: 'K = 0.5 * m * v^2',
    description: 'Translational kinetic energy of a moving body.',
    symbols: [
      { symbol: 'K', meaning: 'kinetic energy', unit: 'J' },
      { symbol: 'm', meaning: 'mass', unit: 'kg' },
      { symbol: 'v', meaning: 'velocity', unit: 'm/s' },
    ],
  },
  {
    title: 'Ideal Gas Law',
    subject: 'Chemistry — Thermodynamics',
    caseName: 'Ideal Gas State',
    expression: 'P * V = n * R * T',
    description: 'Relates pressure, volume, moles, universal gas constant, and Kelvin temperature.',
    symbols: [
      { symbol: 'P', meaning: 'pressure', unit: 'Pa' },
      { symbol: 'V', meaning: 'volume', unit: 'm^3' },
      { symbol: 'n', meaning: 'number of moles', unit: 'mol' },
      { symbol: 'R', meaning: 'universal gas constant', unit: 'J/(mol·K)' },
      { symbol: 'T', meaning: 'temperature', unit: 'K' },
    ],
  },
  {
    title: "Ohm's Law",
    subject: 'Physics — Current Electricity',
    caseName: 'Ohmic DC Circuit',
    expression: 'V = I * R',
    description: 'Potential difference across an ohmic conductor.',
    symbols: [
      { symbol: 'V', meaning: 'voltage', unit: 'V' },
      { symbol: 'I', meaning: 'current', unit: 'A' },
      { symbol: 'R', meaning: 'resistance', unit: 'Ω' },
    ],
  },
  {
    title: 'Electrical Power',
    subject: 'Physics — Current Electricity',
    caseName: 'Ohmic DC Circuit',
    expression: 'P_elec = V * I',
    description: 'Electrical power dissipated across potential difference V carrying current I.',
    symbols: [
      { symbol: 'P_elec', meaning: 'electrical power', unit: 'W' },
      { symbol: 'V', meaning: 'voltage', unit: 'V' },
      { symbol: 'I', meaning: 'current', unit: 'A' },
    ],
  },
  {
    title: 'Lens Formula',
    subject: 'Physics — Ray Optics',
    caseName: 'Thin Lens Ray Optics',
    expression: '1 / f = 1 / v_img - 1 / u_obj',
    description: 'Thin lens relation between focal length, image distance, and object distance.',
    symbols: [
      { symbol: 'f', meaning: 'focal length', unit: 'cm' },
      { symbol: 'v_img', meaning: 'image distance', unit: 'cm' },
      { symbol: 'u_obj', meaning: 'object distance', unit: 'cm' },
    ],
  },
  {
    title: 'Ellipse Latus Rectum & Eccentricity Relation',
    subject: 'Mathematics — Conic Sections',
    caseName: 'Conic Sections — Ellipse',
    expression: 'L = 2 * a * (1 - e_conic^2)',
    description: 'Length of latus rectum of an ellipse in terms of semi-major axis and eccentricity.',
    symbols: [
      { symbol: 'L', meaning: 'latus rectum length', unit: 'units' },
      { symbol: 'a', meaning: 'semi-major axis', unit: 'units' },
      { symbol: 'e_conic', meaning: 'eccentricity', unit: '' },
    ],
  },
];

let seedFormulasBackfilled = false;

async function ensureSeedFormulas(): Promise<void> {
  try {
    const existing = await db.select().from(formulaEquations);
    if (existing.length === 0) {
      const [seedUser] = await db.select({ id: users.id }).from(users).limit(1);
      if (!seedUser) return;
      for (const item of DEFAULT_SEED_FORMULAS) {
        await db.insert(formulaEquations).values({
          authorId: seedUser.id,
          authorName: 'ASAN Core Library',
          authorUsername: 'asan_library',
          title: item.title,
          subject: item.subject,
          caseName: item.caseName,
          expression: item.expression,
          description: item.description,
          symbolsJson: item.symbols,
        });
      }
      seedFormulasBackfilled = true;
      return;
    }

    if (!seedFormulasBackfilled) {
      seedFormulasBackfilled = true;
      for (const row of existing) {
        if (!row.caseName || row.caseName === 'General') {
          const seed = DEFAULT_SEED_FORMULAS.find((s) => s.title === row.title);
          const inferred = seed?.caseName || inferCaseFromSubjectOrTitle(row.subject, row.title);
          if (inferred !== 'General') {
            await db
              .update(formulaEquations)
              .set({ caseName: inferred })
              .where(eq(formulaEquations.id, row.id));
          }
        }
      }
    }
  } catch (error) {
    if (!isDbUnavailableError(error)) return;
    const store = getLocalStore();
    if (store.formulaEquations.length === 0) {
      const now = new Date();
      for (const item of DEFAULT_SEED_FORMULAS) {
        store.formulaEquations.push({
          id: nextSeq('formulaEquations'),
          authorId: 0,
          authorName: 'ASAN Core Library',
          authorUsername: 'asan_library',
          title: item.title,
          subject: item.subject,
          caseName: item.caseName,
          expression: item.expression,
          description: item.description,
          symbolsJson: item.symbols,
          createdAt: now,
          updatedAt: now,
        });
      }
      persistLocalStore();
    } else if (!seedFormulasBackfilled) {
      seedFormulasBackfilled = true;
      let changed = false;
      for (const row of store.formulaEquations) {
        if (!row.caseName || row.caseName === 'General') {
          const seed = DEFAULT_SEED_FORMULAS.find((s) => s.title === row.title);
          const inferred = seed?.caseName || inferCaseFromSubjectOrTitle(row.subject, row.title);
          if (inferred !== 'General') {
            row.caseName = inferred;
            changed = true;
          }
        }
      }
      if (changed) persistLocalStore();
    }
  }
}

export async function listFormulaEquations(): Promise<FormulaEquationItem[]> {
  await ensureSeedFormulas();
  try {
    const rows = await db
      .select()
      .from(formulaEquations)
      .orderBy(desc(formulaEquations.updatedAt));
    return rows.map(toFormulaItem);
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    return [...store.formulaEquations]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map((r) => ({
        id: r.id,
        authorId: r.authorId,
        authorName: r.authorName,
        authorUsername: r.authorUsername,
        title: r.title,
        subject: r.subject,
        caseName:
          r.caseName && r.caseName !== 'General'
            ? r.caseName
            : inferCaseFromSubjectOrTitle(r.subject, r.title),
        expression: r.expression,
        description: r.description,
        symbols: parseSymbolsJson(r.symbolsJson),
        createdAt: new Date(r.createdAt).toISOString(),
        updatedAt: new Date(r.updatedAt).toISOString(),
      }));
  }
}

export async function createFormulaEquation(params: {
  authorId: number;
  authorName: string;
  authorUsername: string;
  title: string;
  subject: string;
  caseName?: string;
  expression: string;
  description: string;
  symbols: FormulaSymbolDef[];
}): Promise<FormulaEquationItem> {
  const cleanTitle = params.title.trim().slice(0, 140);
  const cleanSubject = (params.subject || 'General').trim().slice(0, 80);
  const cleanCase = (params.caseName || 'General').trim().slice(0, 100) || 'General';
  const cleanExpr = params.expression.trim().slice(0, 400);
  const cleanDesc = (params.description || '').trim().slice(0, 600);
  if (!cleanTitle || !cleanExpr || !cleanExpr.includes('=')) {
    throw new Error('Title and an equation containing "=" (e.g. s = u*t + 1/2*a*t^2) are required.');
  }
  const cleanSymbols = (params.symbols || [])
    .filter((s) => s.symbol.trim() && s.meaning.trim())
    .map((s) => ({
      symbol: s.symbol.trim().slice(0, 24),
      meaning: s.meaning.trim().slice(0, 140),
      unit: (s.unit || '').trim().slice(0, 40),
    }));
  if (cleanSymbols.length === 0) {
    throw new Error('Define at least one symbol and its meaning.');
  }

  try {
    const [created] = await db
      .insert(formulaEquations)
      .values({
        authorId: params.authorId,
        authorName: params.authorName,
        authorUsername: params.authorUsername,
        title: cleanTitle,
        subject: cleanSubject,
        caseName: cleanCase,
        expression: cleanExpr,
        description: cleanDesc,
        symbolsJson: cleanSymbols,
      })
      .returning();
    return toFormulaItem(created);
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const now = new Date();
    const row = {
      id: nextSeq('formulaEquations'),
      authorId: params.authorId,
      authorName: params.authorName,
      authorUsername: params.authorUsername,
      title: cleanTitle,
      subject: cleanSubject,
      caseName: cleanCase,
      expression: cleanExpr,
      description: cleanDesc,
      symbolsJson: cleanSymbols,
      createdAt: now,
      updatedAt: now,
    };
    store.formulaEquations.unshift(row);
    persistLocalStore();
    return {
      ...row,
      symbols: cleanSymbols,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }
}

export async function updateFormulaEquation(params: {
  id: number;
  actorId: number;
  isAdminOrSuper: boolean;
  title?: string;
  subject?: string;
  caseName?: string;
  expression?: string;
  description?: string;
  symbols?: FormulaSymbolDef[];
}): Promise<FormulaEquationItem> {
  try {
    const [existing] = await db
      .select()
      .from(formulaEquations)
      .where(eq(formulaEquations.id, params.id))
      .limit(1);
    if (!existing) throw new Error('Formula equation not found.');
    if (!params.isAdminOrSuper && existing.authorId !== params.actorId) {
      throw new Error('Only the author or an Admin can edit this formula.');
    }
    const cleanExpr =
      params.expression !== undefined ? params.expression.trim().slice(0, 400) : existing.expression;
    if (!cleanExpr.includes('=')) {
      throw new Error('Equation must contain "=".');
    }
    const cleanSymbolsArr =
      params.symbols !== undefined
        ? params.symbols
            .filter((s) => s.symbol.trim() && s.meaning.trim())
            .map((s) => ({
              symbol: s.symbol.trim().slice(0, 24),
              meaning: s.meaning.trim().slice(0, 140),
              unit: (s.unit || '').trim().slice(0, 40),
            }))
        : parseSymbolsJson(existing.symbolsJson);
    const [updated] = await db
      .update(formulaEquations)
      .set({
        title: params.title !== undefined ? params.title.trim().slice(0, 140) : existing.title,
        subject: params.subject !== undefined ? params.subject.trim().slice(0, 80) : existing.subject,
        caseName:
          params.caseName !== undefined
            ? params.caseName.trim().slice(0, 100) || 'General'
            : existing.caseName || 'General',
        expression: cleanExpr,
        description:
          params.description !== undefined ? params.description.trim().slice(0, 600) : existing.description,
        symbolsJson: cleanSymbolsArr,
        updatedAt: new Date(),
      })
      .where(eq(formulaEquations.id, params.id))
      .returning();
    return toFormulaItem(updated);
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const existing = store.formulaEquations.find((f) => f.id === params.id);
    if (!existing) throw new Error('Formula equation not found.');
    if (!params.isAdminOrSuper && existing.authorId !== params.actorId) {
      throw new Error('Only the author or an Admin can edit this formula.');
    }
    if (params.title !== undefined) existing.title = params.title.trim().slice(0, 140);
    if (params.subject !== undefined) existing.subject = params.subject.trim().slice(0, 80);
    if (params.caseName !== undefined) existing.caseName = params.caseName.trim().slice(0, 100) || 'General';
    if (params.expression !== undefined) {
      const expr = params.expression.trim().slice(0, 400);
      if (!expr.includes('=')) throw new Error('Equation must contain "=".');
      existing.expression = expr;
    }
    if (params.description !== undefined) existing.description = params.description.trim().slice(0, 600);
    if (params.symbols !== undefined) {
      existing.symbolsJson = params.symbols
        .filter((s) => s.symbol.trim() && s.meaning.trim())
        .map((s) => ({
          symbol: s.symbol.trim().slice(0, 24),
          meaning: s.meaning.trim().slice(0, 140),
          unit: (s.unit || '').trim().slice(0, 40),
        }));
    }
    existing.updatedAt = new Date();
    persistLocalStore();
    return {
      id: existing.id,
      authorId: existing.authorId,
      authorName: existing.authorName,
      authorUsername: existing.authorUsername,
      title: existing.title,
      subject: existing.subject,
      caseName: existing.caseName || 'General',
      expression: existing.expression,
      description: existing.description,
      symbols: parseSymbolsJson(existing.symbolsJson),
      createdAt: new Date(existing.createdAt).toISOString(),
      updatedAt: existing.updatedAt.toISOString(),
    };
  }
}

export async function deleteFormulaEquation(
  id: number,
  actorId: number,
  isAdminOrSuper: boolean
): Promise<void> {
  try {
    const [existing] = await db
      .select()
      .from(formulaEquations)
      .where(eq(formulaEquations.id, id))
      .limit(1);
    if (!existing) throw new Error('Formula equation not found.');
    if (!isAdminOrSuper && existing.authorId !== actorId) {
      throw new Error('Only the author or an Admin can delete this formula.');
    }
    await db.delete(formulaEquations).where(eq(formulaEquations.id, id));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const existing = store.formulaEquations.find((f) => f.id === id);
    if (!existing) throw new Error('Formula equation not found.');
    if (!isAdminOrSuper && existing.authorId !== actorId) {
      throw new Error('Only the author or an Admin can delete this formula.');
    }
    store.formulaEquations = store.formulaEquations.filter((f) => f.id !== id);
    persistLocalStore();
  }
}

// ============================================================================
// PRO OR METERED HOURLY (30 PTS/HR CALCULATED QUARTERLY) ACCESS CONTROL
// ============================================================================

const FORMULA_HOURLY_RATE = 30;
const QUARTER_MINUTES = 15;
const QUARTER_MS = QUARTER_MINUTES * 60 * 1000;

export function getQuarterCost(quarterNumber: number): number {
  // Alternating 8 / 7 / 8 / 7 integer points per 15-minute quarter => 30 pts/hr exact
  return quarterNumber % 2 === 1 ? 8 : 7;
}

function userHasProOrAdminFormulaAccess(u: {
  role?: string | null;
  plan?: string | null;
  proExpiresAt?: string | null;
  adminAuthorized?: boolean | null;
}): boolean {
  if (u.role === 'super') return true;
  if (u.role === 'admin' && u.adminAuthorized !== false) return true;
  if (u.plan !== 'pro') return false;
  if (!u.proExpiresAt) return true;
  const exp = new Date(u.proExpiresAt).getTime();
  return !Number.isFinite(exp) || exp > Date.now();
}

function defaultMeteredSession(): StoreFormulaMeteredSession {
  return {
    enabled: false,
    quarterNumber: 0,
    quarterExpiresAt: '',
    lastChargedPoints: 0,
    totalSessionPoints: 0,
    startedAt: '',
    updatedAt: '',
  };
}

async function readFormulaMeteredSession(userId: number): Promise<StoreFormulaMeteredSession> {
  const key = `formula_metered_${userId}`;
  try {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
    if (!row?.value) return defaultMeteredSession();
    const parsed = JSON.parse(row.value) as Partial<StoreFormulaMeteredSession>;
    return {
      enabled: Boolean(parsed.enabled),
      quarterNumber: Number(parsed.quarterNumber || 0),
      quarterExpiresAt: String(parsed.quarterExpiresAt || ''),
      lastChargedPoints: Number(parsed.lastChargedPoints || 0),
      totalSessionPoints: Number(parsed.totalSessionPoints || 0),
      startedAt: String(parsed.startedAt || ''),
      updatedAt: String(parsed.updatedAt || ''),
    };
  } catch (error) {
    if (!isDbUnavailableError(error)) return defaultMeteredSession();
    const store = getLocalStore();
    const saved = store.formulaMeteredSessions?.[String(userId)];
    return saved ? { ...defaultMeteredSession(), ...saved } : defaultMeteredSession();
  }
}

async function writeFormulaMeteredSession(
  userId: number,
  session: StoreFormulaMeteredSession
): Promise<void> {
  const key = `formula_metered_${userId}`;
  try {
    const [existing] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
    const val = JSON.stringify(session);
    if (existing) {
      await db
        .update(appSettings)
        .set({ value: val, updatedAt: new Date() })
        .where(eq(appSettings.key, key));
    } else {
      await db.insert(appSettings).values({ key, value: val });
    }
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    if (!store.formulaMeteredSessions) store.formulaMeteredSessions = {};
    store.formulaMeteredSessions[String(userId)] = session;
    persistLocalStore();
  }
}

async function getCurrentUserPoints(userId: number): Promise<number> {
  try {
    const [u] = await db.select({ points: users.points }).from(users).where(eq(users.id, userId)).limit(1);
    return u ? Number(u.points || 0) : 0;
  } catch (error) {
    if (!isDbUnavailableError(error)) return 0;
    const u = getLocalStore().users.find((x) => x.id === userId);
    return u ? Number(u.points || 0) : 0;
  }
}

function buildStatusResponse(
  u: {
    id: number;
    points?: number;
    role?: string | null;
    plan?: string | null;
    proExpiresAt?: string | null;
    adminAuthorized?: boolean | null;
  },
  session: StoreFormulaMeteredSession,
  pointsOverride?: number
): FormulaAccessStatus {
  const proIncluded = userHasProOrAdminFormulaAccess(u);
  const currentPoints = pointsOverride ?? Number(u.points || 0);
  if (proIncluded) {
    return {
      accessMode: 'pro',
      hasAccess: true,
      proIncluded: true,
      enabled: true,
      hourlyRate: FORMULA_HOURLY_RATE,
      quarterMinutes: QUARTER_MINUTES,
      quarterNumber: session.quarterNumber,
      quarterExpiresAt: session.quarterExpiresAt,
      lastChargedPoints: session.lastChargedPoints,
      nextQuarterCost: 0,
      totalSessionPoints: session.totalSessionPoints,
      needsRenewal: false,
      points: currentPoints,
    };
  }

  const nowMs = Date.now();
  const expMs = session.quarterExpiresAt ? new Date(session.quarterExpiresAt).getTime() : 0;
  const quarterActive = session.enabled && Number.isFinite(expMs) && expMs > nowMs;
  const needsRenewal = session.enabled && !quarterActive;
  const nextQuarterNum = session.quarterNumber + 1;

  return {
    accessMode: 'metered',
    hasAccess: quarterActive,
    proIncluded: false,
    enabled: session.enabled,
    hourlyRate: FORMULA_HOURLY_RATE,
    quarterMinutes: QUARTER_MINUTES,
    quarterNumber: session.quarterNumber,
    quarterExpiresAt: session.quarterExpiresAt,
    lastChargedPoints: session.lastChargedPoints,
    nextQuarterCost: getQuarterCost(nextQuarterNum),
    totalSessionPoints: session.totalSessionPoints,
    needsRenewal,
    points: currentPoints,
  };
}

export async function getFormulaAccessStatus(user: {
  id: number;
  points: number;
  role?: string | null;
  plan?: string | null;
  proExpiresAt?: string | null;
  adminAuthorized?: boolean | null;
}): Promise<FormulaAccessStatus> {
  const session = await readFormulaMeteredSession(user.id);
  const pts = await getCurrentUserPoints(user.id);
  return buildStatusResponse(user, session, pts);
}

export async function startFormulaMeteredSession(user: {
  id: number;
  points: number;
  role?: string | null;
  plan?: string | null;
  proExpiresAt?: string | null;
  adminAuthorized?: boolean | null;
}): Promise<FormulaAccessStatus> {
  if (userHasProOrAdminFormulaAccess(user)) {
    const session = await readFormulaMeteredSession(user.id);
    return buildStatusResponse(user, session);
  }

  const session = await readFormulaMeteredSession(user.id);
  const now = new Date();
  const expMs = session.quarterExpiresAt ? new Date(session.quarterExpiresAt).getTime() : 0;

  // Resume active already-paid quarter without double-charging
  if (Number.isFinite(expMs) && expMs > now.getTime() + 1000) {
    session.enabled = true;
    session.updatedAt = now.toISOString();
    await writeFormulaMeteredSession(user.id, session);
    const pts = await getCurrentUserPoints(user.id);
    return buildStatusResponse(user, session, pts);
  }

  const nextQuarter = session.quarterNumber + 1;
  const cost = getQuarterCost(nextQuarter);
  const currentPts = await getCurrentUserPoints(user.id);
  if (currentPts < cost) {
    session.enabled = false;
    session.updatedAt = now.toISOString();
    await writeFormulaMeteredSession(user.id, session);
    throw new Error(
      `Insufficient points to enable metered Formula Calculator. Need ${cost} pts for Quarter ${nextQuarter} (30 pts/hr quarterly), you have ${currentPts} pts.`
    );
  }

  const updatedUser = await awardPoints(
    user.id,
    -cost,
    `Formula Calculator Metered Access — Quarter ${nextQuarter} (15 min @ 30 pts/hr)`,
    'formula_metered'
  );
  const nextExp = new Date(now.getTime() + QUARTER_MS).toISOString();
  const nextSession: StoreFormulaMeteredSession = {
    enabled: true,
    quarterNumber: nextQuarter,
    quarterExpiresAt: nextExp,
    lastChargedPoints: cost,
    totalSessionPoints: session.totalSessionPoints + cost,
    startedAt: session.startedAt || now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await writeFormulaMeteredSession(user.id, nextSession);
  const finalPts = updatedUser ? Number(updatedUser.points) : currentPts - cost;
  return buildStatusResponse(user, nextSession, finalPts);
}

export async function renewFormulaMeteredSession(user: {
  id: number;
  points: number;
  role?: string | null;
  plan?: string | null;
  proExpiresAt?: string | null;
  adminAuthorized?: boolean | null;
}): Promise<FormulaAccessStatus> {
  if (userHasProOrAdminFormulaAccess(user)) {
    const session = await readFormulaMeteredSession(user.id);
    return buildStatusResponse(user, session);
  }

  const session = await readFormulaMeteredSession(user.id);
  if (!session.enabled) {
    const pts = await getCurrentUserPoints(user.id);
    return buildStatusResponse(user, session, pts);
  }

  const now = new Date();
  const expMs = session.quarterExpiresAt ? new Date(session.quarterExpiresAt).getTime() : 0;
  // Prevent premature duplicate charges if > 15s remain in current quarter
  if (Number.isFinite(expMs) && expMs - now.getTime() > 15000) {
    const pts = await getCurrentUserPoints(user.id);
    return buildStatusResponse(user, session, pts);
  }

  const nextQuarter = session.quarterNumber + 1;
  const cost = getQuarterCost(nextQuarter);
  const currentPts = await getCurrentUserPoints(user.id);
  if (currentPts < cost) {
    session.enabled = false;
    session.updatedAt = now.toISOString();
    await writeFormulaMeteredSession(user.id, session);
    throw new Error(
      `Metered session paused: insufficient points for next quarter (${cost} pts required, ${currentPts} pts available).`
    );
  }

  const updatedUser = await awardPoints(
    user.id,
    -cost,
    `Formula Calculator Metered Renewal — Quarter ${nextQuarter} (15 min @ 30 pts/hr)`,
    'formula_metered'
  );
  const nextSession: StoreFormulaMeteredSession = {
    enabled: true,
    quarterNumber: nextQuarter,
    quarterExpiresAt: new Date(now.getTime() + QUARTER_MS).toISOString(),
    lastChargedPoints: cost,
    totalSessionPoints: session.totalSessionPoints + cost,
    startedAt: session.startedAt || now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await writeFormulaMeteredSession(user.id, nextSession);
  const finalPts = updatedUser ? Number(updatedUser.points) : currentPts - cost;
  return buildStatusResponse(user, nextSession, finalPts);
}

export async function stopFormulaMeteredSession(user: {
  id: number;
  points: number;
  role?: string | null;
  plan?: string | null;
  proExpiresAt?: string | null;
  adminAuthorized?: boolean | null;
}): Promise<FormulaAccessStatus> {
  const session = await readFormulaMeteredSession(user.id);
  session.enabled = false;
  session.updatedAt = new Date().toISOString();
  await writeFormulaMeteredSession(user.id, session);
  const pts = await getCurrentUserPoints(user.id);
  return buildStatusResponse(user, session, pts);
}

