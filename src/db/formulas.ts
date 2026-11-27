import { and, desc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  appSettings,
  appSubscriptions,
  formulaEquations,
  proRefundRequests,
  users,
} from './schema.ts';
import {
  getLocalStore,
  isDbUnavailableError,
  nextSeq,
  persistLocalStore,
  type StoreFormulaMeteredSession,
} from './localStore.ts';
import {
  awardPoints,
  incrementCouponUsage,
  resolveValidCouponForScope,
} from './users.ts';
import {
  APP_PLATFORM_FEE,
  calculateCancellationRefund,
  calculateRepoOrAppQuote,
  INFINITE_POINTS_SENTINEL,
} from '../lib/pricing.ts';
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

function resolveFormulaEffectivePlan(u: {
  plan?: string | null;
  proExpiresAt?: string | null;
  eliteExpiresAt?: string | null;
}): string {
  const now = Date.now();
  if (u.plan === 'elite') {
    if (!u.eliteExpiresAt) return 'elite';
    const exp = new Date(u.eliteExpiresAt).getTime();
    if (!Number.isFinite(exp) || exp > now) return 'elite';
  }
  if (u.plan === 'pro') {
    if (!u.proExpiresAt) return 'pro';
    const exp = new Date(u.proExpiresAt).getTime();
    if (!Number.isFinite(exp) || exp > now) return 'pro';
  }
  return 'basic';
}

function userHasProOrAdminFormulaAccess(u: {
  role?: string | null;
  plan?: string | null;
  proExpiresAt?: string | null;
  eliteExpiresAt?: string | null;
  adminAuthorized?: boolean | null;
}): boolean {
  if (u.role === 'super') return true;
  if (u.role === 'admin' && u.adminAuthorized !== false) return true;
  const effectivePlan = resolveFormulaEffectivePlan(u);
  return effectivePlan === 'elite' || effectivePlan === 'pro';
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

async function getCurrentUserPointsInfo(
  userId: number
): Promise<{ points: number; infinitePoints: boolean }> {
  try {
    const [u] = await db
      .select({ points: users.points, infinitePoints: users.infinitePoints })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return {
      points: u ? Number(u.points || 0) : 0,
      infinitePoints: Boolean(u?.infinitePoints),
    };
  } catch (error) {
    if (!isDbUnavailableError(error)) return { points: 0, infinitePoints: false };
    const u = getLocalStore().users.find((x) => x.id === userId);
    return {
      points: u ? Number(u.points || 0) : 0,
      infinitePoints: Boolean(u?.infinitePoints),
    };
  }
}

function buildStatusResponse(
  u: {
    id: number;
    points?: number;
    role?: string | null;
    plan?: string | null;
    proExpiresAt?: string | null;
    eliteExpiresAt?: string | null;
    adminAuthorized?: boolean | null;
    infinitePoints?: boolean | null;
  },
  session: StoreFormulaMeteredSession,
  pointsOverride?: number
): FormulaAccessStatus {
  const proIncluded = userHasProOrAdminFormulaAccess(u);
  const currentPoints = u.infinitePoints
    ? INFINITE_POINTS_SENTINEL
    : pointsOverride ?? Number(u.points || 0);
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
  eliteExpiresAt?: string | null;
  adminAuthorized?: boolean | null;
  infinitePoints?: boolean | null;
}): Promise<FormulaAccessStatus> {
  const session = await readFormulaMeteredSession(user.id);
  const info = await getCurrentUserPointsInfo(user.id);
  return buildStatusResponse(user, session, info.points);
}

export async function startFormulaMeteredSession(
  user: {
    id: number;
    points: number;
    role?: string | null;
    plan?: string | null;
    proExpiresAt?: string | null;
    eliteExpiresAt?: string | null;
    adminAuthorized?: boolean | null;
    infinitePoints?: boolean | null;
  },
  opts: { couponCode?: string } = {}
): Promise<FormulaAccessStatus> {
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
    const info = await getCurrentUserPointsInfo(user.id);
    return buildStatusResponse(user, session, info.points);
  }

  const coupon = opts.couponCode
    ? await resolveValidCouponForScope(opts.couponCode, 'apps_metered')
    : null;
  const nextQuarter = session.quarterNumber + 1;
  const rawQuarterCost = getQuarterCost(nextQuarter);
  const effectivePlan = resolveFormulaEffectivePlan(user);
  const quote = calculateRepoOrAppQuote({
    targetScope: 'apps_metered',
    baseSubtotal: rawQuarterCost,
    effectivePlan,
    role: user.role || 'user',
    coupon,
  });

  const ptsInfo = await getCurrentUserPointsInfo(user.id);
  if (!ptsInfo.infinitePoints && ptsInfo.points < quote.finalCost) {
    session.enabled = false;
    session.updatedAt = now.toISOString();
    await writeFormulaMeteredSession(user.id, session);
    throw new Error(
      `Insufficient points to enable metered Formula Calculator. Need ${quote.finalCost} pts (Quarter ${nextQuarter}: ${quote.baseSubtotal} + ${quote.platformFee} app platform fee), you have ${ptsInfo.points} pts.`
    );
  }

  const updatedUser = await awardPoints(
    user.id,
    -quote.finalCost,
    `Formula Calculator Metered Access — Quarter ${nextQuarter} (${quote.finalCost} pts incl. ${quote.platformFee} app fee)`,
    'formula_metered'
  );
  if (coupon?.id) await incrementCouponUsage(coupon.id);

  const nowIso = now.toISOString();
  const nextExp = new Date(now.getTime() + QUARTER_MS).toISOString();
  const nextSession: StoreFormulaMeteredSession = {
    enabled: true,
    quarterNumber: nextQuarter,
    quarterExpiresAt: nextExp,
    lastChargedPoints: quote.finalCost,
    totalSessionPoints: session.totalSessionPoints + quote.finalCost,
    startedAt: session.startedAt || nowIso,
    updatedAt: nowIso,
  };
  await writeFormulaMeteredSession(user.id, nextSession);

  try {
    await db.insert(appSubscriptions).values({
      userId: user.id,
      appKey: 'formula_calculator',
      appName: 'Formula Equation Calculator',
      billingMode: 'metered_hourly',
      hourlyRate: FORMULA_HOURLY_RATE,
      baseCost: quote.baseSubtotal,
      platformFee: quote.platformFee,
      discountPercent: quote.tierDiscountPercent,
      couponCode: quote.appliedCouponCode,
      totalCost: quote.finalCost,
      status: 'active',
      startedAt: nowIso,
      expiresAt: nextExp,
      cancelledAt: '',
      refundAmount: 0,
    });
  } catch (error) {
    if (isDbUnavailableError(error)) {
      const store = getLocalStore();
      if (!store.appSubscriptions) store.appSubscriptions = [];
      store.appSubscriptions.unshift({
        id: nextSeq('appSubscriptions'),
        userId: user.id,
        appKey: 'formula_calculator',
        appName: 'Formula Equation Calculator',
        billingMode: 'metered_hourly',
        hourlyRate: FORMULA_HOURLY_RATE,
        baseCost: quote.baseSubtotal,
        platformFee: quote.platformFee,
        discountPercent: quote.tierDiscountPercent,
        couponCode: quote.appliedCouponCode,
        totalCost: quote.finalCost,
        status: 'active',
        startedAt: nowIso,
        expiresAt: nextExp,
        cancelledAt: '',
        refundAmount: 0,
        createdAt: now,
      });
      persistLocalStore();
    }
  }

  const finalPts = updatedUser ? Number(updatedUser.points) : Math.max(0, ptsInfo.points - quote.finalCost);
  return buildStatusResponse(user, nextSession, finalPts);
}

export async function renewFormulaMeteredSession(
  user: {
    id: number;
    points: number;
    role?: string | null;
    plan?: string | null;
    proExpiresAt?: string | null;
    eliteExpiresAt?: string | null;
    adminAuthorized?: boolean | null;
    infinitePoints?: boolean | null;
  },
  opts: { couponCode?: string } = {}
): Promise<FormulaAccessStatus> {
  if (userHasProOrAdminFormulaAccess(user)) {
    const session = await readFormulaMeteredSession(user.id);
    return buildStatusResponse(user, session);
  }

  const session = await readFormulaMeteredSession(user.id);
  if (!session.enabled) {
    const info = await getCurrentUserPointsInfo(user.id);
    return buildStatusResponse(user, session, info.points);
  }

  const now = new Date();
  const expMs = session.quarterExpiresAt ? new Date(session.quarterExpiresAt).getTime() : 0;
  // Prevent premature duplicate charges if > 15s remain in current quarter
  if (Number.isFinite(expMs) && expMs - now.getTime() > 15000) {
    const info = await getCurrentUserPointsInfo(user.id);
    return buildStatusResponse(user, session, info.points);
  }

  const coupon = opts.couponCode
    ? await resolveValidCouponForScope(opts.couponCode, 'apps_metered')
    : null;
  const nextQuarter = session.quarterNumber + 1;
  const rawCost = getQuarterCost(nextQuarter);
  const effectivePlan = resolveFormulaEffectivePlan(user);
  // Apply Admin/Elite/Coupon discount on quarter renewal without repeating initial app fee inside continuous session
  const dummyQuote = calculateRepoOrAppQuote({
    targetScope: 'apps_metered',
    baseSubtotal: rawCost,
    effectivePlan,
    role: user.role || 'user',
    coupon,
  });
  const renewalCost = Math.max(0, dummyQuote.finalCost - dummyQuote.platformFee);

  const ptsInfo = await getCurrentUserPointsInfo(user.id);
  if (!ptsInfo.infinitePoints && ptsInfo.points < renewalCost) {
    session.enabled = false;
    session.updatedAt = now.toISOString();
    await writeFormulaMeteredSession(user.id, session);
    throw new Error(
      `Metered session paused: insufficient points for next quarter (${renewalCost} pts required, ${ptsInfo.points} pts available).`
    );
  }

  const updatedUser = await awardPoints(
    user.id,
    -renewalCost,
    `Formula Calculator Metered Renewal — Quarter ${nextQuarter} (${renewalCost} pts @ 30 pts/hr)`,
    'formula_metered'
  );
  if (coupon?.id) await incrementCouponUsage(coupon.id);

  const nextExp = new Date(now.getTime() + QUARTER_MS).toISOString();
  const nextSession: StoreFormulaMeteredSession = {
    enabled: true,
    quarterNumber: nextQuarter,
    quarterExpiresAt: nextExp,
    lastChargedPoints: renewalCost,
    totalSessionPoints: session.totalSessionPoints + renewalCost,
    startedAt: session.startedAt || now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await writeFormulaMeteredSession(user.id, nextSession);

  // Sync latest active app_subscription row if any
  try {
    const rows = await db
      .select()
      .from(appSubscriptions)
      .where(and(eq(appSubscriptions.userId, user.id), eq(appSubscriptions.status, 'active')))
      .orderBy(desc(appSubscriptions.createdAt))
      .limit(1);
    if (rows[0]) {
      await db
        .update(appSubscriptions)
        .set({
          baseCost: (rows[0].baseCost || 0) + rawCost,
          totalCost: (rows[0].totalCost || 0) + renewalCost,
          expiresAt: nextExp,
        })
        .where(eq(appSubscriptions.id, rows[0].id));
    }
  } catch (error) {
    if (isDbUnavailableError(error)) {
      const store = getLocalStore();
      const row = (store.appSubscriptions || []).find(
        (s) => s.userId === user.id && s.status === 'active'
      );
      if (row) {
        row.baseCost = (row.baseCost || 0) + rawCost;
        row.totalCost = (row.totalCost || 0) + renewalCost;
        row.expiresAt = nextExp;
        persistLocalStore();
      }
    }
  }

  const finalPts = updatedUser
    ? Number(updatedUser.points)
    : Math.max(0, ptsInfo.points - renewalCost);
  return buildStatusResponse(user, nextSession, finalPts);
}

export async function stopFormulaMeteredSession(user: {
  id: number;
  points: number;
  role?: string | null;
  plan?: string | null;
  proExpiresAt?: string | null;
  eliteExpiresAt?: string | null;
  adminAuthorized?: boolean | null;
  infinitePoints?: boolean | null;
}): Promise<FormulaAccessStatus> {
  const session = await readFormulaMeteredSession(user.id);
  session.enabled = false;
  session.updatedAt = new Date().toISOString();
  await writeFormulaMeteredSession(user.id, session);
  const info = await getCurrentUserPointsInfo(user.id);
  return buildStatusResponse(user, session, info.points);
}

export async function cancelAppSubscription(
  userId: number,
  subId: number,
  opts: { reason?: string } = {}
) {
  const now = new Date();
  const cleanReason = (opts.reason || '').trim().slice(0, 400) || 'User cancelled app subscription.';
  try {
    const [sub] = await db
      .select()
      .from(appSubscriptions)
      .where(and(eq(appSubscriptions.id, subId), eq(appSubscriptions.userId, userId)))
      .limit(1);
    if (!sub) throw new Error('App subscription not found.');
    if (sub.status === 'cancelled') throw new Error('App subscription is already cancelled.');

    const [buyer] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!buyer) throw new Error('User not found.');

    const calc = calculateCancellationRefund({
      pointsPaid: sub.totalCost,
      platformFee: sub.platformFee ?? APP_PLATFORM_FEE,
      noRefund: false,
      startedAt: sub.startedAt || (sub.createdAt instanceof Date ? sub.createdAt.toISOString() : String(sub.createdAt)),
      expiresAt: sub.expiresAt || '',
      purchaseType: 'timed',
    });

    const [updated] = await db
      .update(appSubscriptions)
      .set({
        status: 'cancelled',
        cancelledAt: now.toISOString(),
        refundAmount: calc.requestedRefundPoints,
      })
      .where(eq(appSubscriptions.id, sub.id))
      .returning();

    const sess = await readFormulaMeteredSession(userId);
    if (sess.enabled) {
      sess.enabled = false;
      sess.updatedAt = now.toISOString();
      await writeFormulaMeteredSession(userId, sess);
    }

    let refundRequest = null;
    if (calc.requestedRefundPoints > 0) {
      const [inserted] = await db
        .insert(proRefundRequests)
        .values({
          userId: buyer.id,
          userEmail: buyer.email,
          username: buyer.username,
          displayName: buyer.displayName,
          shortUid: buyer.shortUid,
          planTerm: 'app_metered',
          refundBasis: calc.refundBasis,
          pointsPaid: sub.totalCost,
          remainingPercent: calc.remainingPercent,
          remainingDays: calc.remainingDays,
          totalDays: calc.totalDays,
          requestedRefundPoints: calc.requestedRefundPoints,
          reason: `App (${sub.appName}): ${cleanReason}`,
          status: 'pending',
        })
        .returning();
      refundRequest = inserted;
    }

    return {
      subscription: updated,
      refundRequest,
      refundPreview: calc,
      message:
        calc.requestedRefundPoints > 0
          ? `App subscription cancelled. Refund request for ${calc.requestedRefundPoints} pts (excluding ${calc.platformFeeExcluded}-pt fee) sent for Admin review.`
          : 'App subscription cancelled.',
    };
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      throw error instanceof Error ? error : new Error('Failed to cancel app subscription.');
    }
    const store = getLocalStore();
    const sub = (store.appSubscriptions || []).find(
      (s) => s.id === subId && s.userId === userId
    );
    if (!sub) throw new Error('App subscription not found.');
    if (sub.status === 'cancelled') throw new Error('App subscription is already cancelled.');
    const buyer = store.users.find((u) => u.id === userId);
    if (!buyer) throw new Error('User not found.');

    const calc = calculateCancellationRefund({
      pointsPaid: sub.totalCost,
      platformFee: sub.platformFee ?? APP_PLATFORM_FEE,
      noRefund: false,
      startedAt: sub.startedAt || (sub.createdAt instanceof Date ? sub.createdAt.toISOString() : String(sub.createdAt)),
      expiresAt: sub.expiresAt || '',
      purchaseType: 'timed',
    });

    sub.status = 'cancelled';
    sub.cancelledAt = now.toISOString();
    sub.refundAmount = calc.requestedRefundPoints;

    const sess = await readFormulaMeteredSession(userId);
    if (sess.enabled) {
      sess.enabled = false;
      sess.updatedAt = now.toISOString();
      await writeFormulaMeteredSession(userId, sess);
    }

    let refundRequest = null;
    if (calc.requestedRefundPoints > 0) {
      refundRequest = {
        id: nextSeq('proRefundRequests'),
        userId: buyer.id,
        userEmail: buyer.email,
        username: buyer.username,
        displayName: buyer.displayName,
        shortUid: buyer.shortUid,
        planTerm: 'app_metered',
        refundBasis: calc.refundBasis,
        pointsPaid: sub.totalCost,
        remainingPercent: calc.remainingPercent,
        remainingDays: calc.remainingDays,
        totalDays: calc.totalDays,
        requestedRefundPoints: calc.requestedRefundPoints,
        reason: `App (${sub.appName}): ${cleanReason}`,
        status: 'pending',
        adminNote: '',
        reviewedByUserId: null,
        reviewedByLabel: '',
        reviewedAt: '',
        createdAt: now,
      };
      store.proRefundRequests.unshift(refundRequest);
    }
    persistLocalStore();
    return {
      subscription: sub,
      refundRequest,
      refundPreview: calc,
      message:
        calc.requestedRefundPoints > 0
          ? `App subscription cancelled. Refund request for ${calc.requestedRefundPoints} pts (excluding ${calc.platformFeeExcluded}-pt fee) sent for Admin review.`
          : 'App subscription cancelled.',
    };
  }
}

export async function extendAppSubscription(
  userId: number,
  subId: number,
  opts: { quarters?: number; couponCode?: string } = {}
) {
  const quarters = Math.max(1, Math.min(16, Math.round(Number(opts.quarters) || 1)));
  const coupon = opts.couponCode
    ? await resolveValidCouponForScope(opts.couponCode, 'apps_metered')
    : null;

  try {
    const [sub] = await db
      .select()
      .from(appSubscriptions)
      .where(and(eq(appSubscriptions.id, subId), eq(appSubscriptions.userId, userId)))
      .limit(1);
    if (!sub) throw new Error('App subscription not found.');
    if (sub.status === 'cancelled') throw new Error('Cancelled subscriptions cannot be extended.');
    const [buyer] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!buyer) throw new Error('User not found.');

    let rawBase = 0;
    for (let i = 1; i <= quarters; i += 1) {
      rawBase += getQuarterCost(i);
    }
    const quote = calculateRepoOrAppQuote({
      targetScope: 'apps_metered',
      baseSubtotal: rawBase,
      effectivePlan: resolveFormulaEffectivePlan(buyer),
      role: buyer.role,
      coupon,
    });
    if (!buyer.infinitePoints && (buyer.points || 0) < quote.finalCost) {
      throw new Error(
        `Insufficient points to extend app subscription. Need ${quote.finalCost} pts incl. ${quote.platformFee} fee.`
      );
    }

    const updatedBuyer = await awardPoints(
      userId,
      -quote.finalCost,
      `Extended ${sub.appName} (+${quarters * 15} min, ${quote.finalCost} pts incl. ${quote.platformFee} fee)`,
      'formula_metered'
    );
    if (coupon?.id) await incrementCouponUsage(coupon.id);

    const baseMs = Math.max(Date.now(), sub.expiresAt ? new Date(sub.expiresAt).getTime() : 0);
    const nextExp = new Date(baseMs + quarters * QUARTER_MS).toISOString();
    const [updated] = await db
      .update(appSubscriptions)
      .set({
        baseCost: (sub.baseCost || 0) + quote.baseSubtotal,
        totalCost: (sub.totalCost || 0) + quote.finalCost,
        status: 'active',
        expiresAt: nextExp,
      })
      .where(eq(appSubscriptions.id, sub.id))
      .returning();

    const sess = await readFormulaMeteredSession(userId);
    sess.enabled = true;
    sess.quarterNumber += quarters;
    sess.quarterExpiresAt = nextExp;
    sess.lastChargedPoints = quote.finalCost;
    sess.totalSessionPoints += quote.finalCost;
    sess.startedAt = sess.startedAt || new Date().toISOString();
    sess.updatedAt = new Date().toISOString();
    await writeFormulaMeteredSession(userId, sess);

    return {
      subscription: updated,
      quote,
      points: updatedBuyer?.points ?? Math.max(0, (buyer.points || 0) - quote.finalCost),
      message: `Extended ${sub.appName} by ${quarters * 15} minutes until ${new Date(
        nextExp
      ).toLocaleString()}.`,
    };
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      throw error instanceof Error ? error : new Error('Failed to extend app subscription.');
    }
    const store = getLocalStore();
    const sub = (store.appSubscriptions || []).find(
      (s) => s.id === subId && s.userId === userId
    );
    if (!sub) throw new Error('App subscription not found.');
    if (sub.status === 'cancelled') throw new Error('Cancelled subscriptions cannot be extended.');
    const buyer = store.users.find((u) => u.id === userId);
    if (!buyer) throw new Error('User not found.');

    let rawBase = 0;
    for (let i = 1; i <= quarters; i += 1) {
      rawBase += getQuarterCost(i);
    }
    const quote = calculateRepoOrAppQuote({
      targetScope: 'apps_metered',
      baseSubtotal: rawBase,
      effectivePlan: resolveFormulaEffectivePlan(buyer),
      role: buyer.role,
      coupon,
    });
    if (!buyer.infinitePoints && (buyer.points || 0) < quote.finalCost) {
      throw new Error(
        `Insufficient points to extend app subscription. Need ${quote.finalCost} pts incl. ${quote.platformFee} fee.`
      );
    }

    const updatedBuyer = await awardPoints(
      userId,
      -quote.finalCost,
      `Extended ${sub.appName} (+${quarters * 15} min)`,
      'formula_metered'
    );
    if (coupon?.id) await incrementCouponUsage(coupon.id);
    const baseMs = Math.max(Date.now(), sub.expiresAt ? new Date(sub.expiresAt).getTime() : 0);
    const nextExp = new Date(baseMs + quarters * QUARTER_MS).toISOString();
    sub.baseCost = (sub.baseCost || 0) + quote.baseSubtotal;
    sub.totalCost = (sub.totalCost || 0) + quote.finalCost;
    sub.status = 'active';
    sub.expiresAt = nextExp;

    const sess = await readFormulaMeteredSession(userId);
    sess.enabled = true;
    sess.quarterNumber += quarters;
    sess.quarterExpiresAt = nextExp;
    sess.lastChargedPoints = quote.finalCost;
    sess.totalSessionPoints += quote.finalCost;
    sess.startedAt = sess.startedAt || new Date().toISOString();
    sess.updatedAt = new Date().toISOString();
    await writeFormulaMeteredSession(userId, sess);

    persistLocalStore();
    return {
      subscription: sub,
      quote,
      points: updatedBuyer?.points ?? buyer.points,
      message: `Extended ${sub.appName} by ${quarters * 15} minutes.`,
    };
  }
}


