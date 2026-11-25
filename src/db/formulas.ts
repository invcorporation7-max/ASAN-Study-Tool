import { desc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import { formulaEquations, users } from './schema.ts';
import { getLocalStore, isDbUnavailableError, nextSeq, persistLocalStore } from './localStore.ts';
import type { FormulaEquationItem, FormulaSymbolDef } from '../types.ts';

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

function toFormulaItem(row: typeof formulaEquations.$inferSelect): FormulaEquationItem {
  return {
    id: row.id,
    authorId: row.authorId,
    authorName: row.authorName,
    authorUsername: row.authorUsername,
    title: row.title,
    subject: row.subject,
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
  expression: string;
  description: string;
  symbols: FormulaSymbolDef[];
}[] = [
  {
    title: 'First Equation of Motion',
    subject: 'Physics — Kinematics',
    expression: 'v = u + a * t',
    description: 'Relates final velocity, initial velocity, constant acceleration, and time.',
    symbols: [
      { symbol: 'v', meaning: 'final velocity', unit: 'm/s' },
      { symbol: 'u', meaning: 'initial velocity', unit: 'm/s' },
      { symbol: 'a', meaning: 'acceleration', unit: 'm/s^2' },
      { symbol: 't', meaning: 'time', unit: 's' },
    ],
  },
  {
    title: 'Second Equation of Motion',
    subject: 'Physics — Kinematics',
    expression: 's = u * t + 0.5 * a * t^2',
    description: 'Calculates displacement under uniform acceleration over time.',
    symbols: [
      { symbol: 's', meaning: 'displacement', unit: 'm' },
      { symbol: 'u', meaning: 'initial velocity', unit: 'm/s' },
      { symbol: 't', meaning: 'time', unit: 's' },
      { symbol: 'a', meaning: 'acceleration', unit: 'm/s^2' },
    ],
  },
  {
    title: 'Third Equation of Motion',
    subject: 'Physics — Kinematics',
    expression: 'v^2 = u^2 + 2 * a * s',
    description: 'Time-independent relation between velocity, acceleration, and displacement.',
    symbols: [
      { symbol: 'v', meaning: 'final velocity', unit: 'm/s' },
      { symbol: 'u', meaning: 'initial velocity', unit: 'm/s' },
      { symbol: 'a', meaning: 'acceleration', unit: 'm/s^2' },
      { symbol: 's', meaning: 'displacement', unit: 'm' },
    ],
  },
  {
    title: "Newton's Second Law",
    subject: 'Physics — Mechanics',
    expression: 'F = m * a',
    description: 'Net force equals mass multiplied by acceleration.',
    symbols: [
      { symbol: 'F', meaning: 'force', unit: 'N' },
      { symbol: 'm', meaning: 'mass', unit: 'kg' },
      { symbol: 'a', meaning: 'acceleration', unit: 'm/s^2' },
    ],
  },
  {
    title: 'Kinetic Energy',
    subject: 'Physics — Work & Energy',
    expression: 'K = 0.5 * m * v^2',
    description: 'Translational kinetic energy of a moving body.',
    symbols: [
      { symbol: 'K', meaning: 'kinetic energy', unit: 'J' },
      { symbol: 'm', meaning: 'mass', unit: 'kg' },
      { symbol: 'v', meaning: 'final velocity', unit: 'm/s' },
    ],
  },
  {
    title: 'Ideal Gas Law',
    subject: 'Chemistry — Thermodynamics',
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
    expression: 'L = 2 * a * (1 - e_conic^2)',
    description: 'Length of latus rectum of an ellipse in terms of semi-major axis and eccentricity.',
    symbols: [
      { symbol: 'L', meaning: 'latus rectum length', unit: 'units' },
      { symbol: 'a', meaning: 'semi-major axis', unit: 'units' },
      { symbol: 'e_conic', meaning: 'eccentricity', unit: '' },
    ],
  },
];

async function ensureSeedFormulas(): Promise<void> {
  try {
    const existing = await db.select({ id: formulaEquations.id }).from(formulaEquations).limit(1);
    if (existing.length > 0) return;
    const [seedUser] = await db.select({ id: users.id }).from(users).limit(1);
    if (!seedUser) return;
    for (const item of DEFAULT_SEED_FORMULAS) {
      await db.insert(formulaEquations).values({
        authorId: seedUser.id,
        authorName: 'ASAN Core Library',
        authorUsername: 'asan_library',
        title: item.title,
        subject: item.subject,
        expression: item.expression,
        description: item.description,
        symbolsJson: item.symbols,
      });
    }
  } catch (error) {
    if (!isDbUnavailableError(error)) return;
    const store = getLocalStore();
    if (store.formulaEquations.length > 0) return;
    const now = new Date();
    for (const item of DEFAULT_SEED_FORMULAS) {
      store.formulaEquations.push({
        id: nextSeq('formulaEquations'),
        authorId: 0,
        authorName: 'ASAN Core Library',
        authorUsername: 'asan_library',
        title: item.title,
        subject: item.subject,
        expression: item.expression,
        description: item.description,
        symbolsJson: item.symbols,
        createdAt: now,
        updatedAt: now,
      });
    }
    persistLocalStore();
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
  expression: string;
  description: string;
  symbols: FormulaSymbolDef[];
}): Promise<FormulaEquationItem> {
  const cleanTitle = params.title.trim().slice(0, 140);
  const cleanSubject = (params.subject || 'General').trim().slice(0, 80);
  const cleanExpr = params.expression.trim().slice(0, 400);
  const cleanDesc = (params.description || '').trim().slice(0, 600);
  if (!cleanTitle || !cleanExpr || !cleanExpr.includes('=')) {
    throw new Error('Title and an equation containing "=" (e.g. F = m * a) are required.');
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
