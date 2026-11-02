/**
 * Idea pipeline: plan → generate → validate (+1 repair round) → de-duplicate → critic → save.
 * Accepted ideas become specs/<id>.json (status "pending"); rejected ones go to rejected/<date>/ with reasons.
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { config } from '../../reels.config.ts';
import { paths } from '../paths.ts';
import { parseSpec, SpecError, specText } from '../spec/validate.ts';
import type { Spec } from '../spec/schema.ts';
import { getDb, ideaHistory, recordIdea, upsertHypothesis, upsertReel, type DB } from '../db/index.ts';
import { loadInsights } from '../learn/pipeline.ts';
import { closestMatch, fingerprint } from './dedupe.ts';
import { planBatch, type Slot } from './plan.ts';
import { criticPrompt, criticSystem, generatorPrompt, generatorSystem, pastePrompt } from './prompts.ts';
import { extractJson, type LLM } from './llm.ts';
import { env } from '../env.ts';

export const CRITERIA = ['hook', 'relatability', 'shareability', 'clarity_without_sound', 'loopability'] as const;

export const ReviewSchema = z.object({
  index: z.number().int().min(0),
  scores: z.object({
    hook: z.number().min(0).max(10),
    relatability: z.number().min(0).max(10),
    shareability: z.number().min(0).max(10),
    clarity_without_sound: z.number().min(0).max(10),
    loopability: z.number().min(0).max(10),
  }),
  reason: z.string().default(''),
  fix: z.string().optional().nullable(),
});
export type Review = z.infer<typeof ReviewSchema>;

export function criticScore(r: Review, weights: Record<string, number> = config.ideas.criticWeights): number {
  let s = 0;
  let w = 0;
  for (const k of CRITERIA) {
    s += (weights[k] ?? 0) * r.scores[k];
    w += weights[k] ?? 0;
  }
  return w ? s / w : 0;
}

export function passesCritic(r: Review): { ok: boolean; score: number; why?: string } {
  const score = criticScore(r);
  const low = CRITERIA.filter((k) => r.scores[k] < config.ideas.criticFloor);
  if (score < config.ideas.criticThreshold) return { ok: false, score, why: `critic score ${score.toFixed(1)} < ${config.ideas.criticThreshold}` };
  if (low.length) return { ok: false, score, why: `${low.join(', ')} below floor ${config.ideas.criticFloor}` };
  return { ok: true, score };
}

const slugify = (s: string, max = 40) =>
  s
    .toLowerCase()
    .replace(/\*/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');

function existingIds(db: DB): Set<string> {
  const ids = new Set<string>((db.prepare('SELECT id FROM reels').all() as Array<{ id: string }>).map((r) => r.id));
  if (fs.existsSync(paths.specs)) for (const f of fs.readdirSync(paths.specs)) if (f.endsWith('.json')) ids.add(f.slice(0, -5));
  return ids;
}

/** Everything that counts as "already done" for duplicate detection. */
export function historyTexts(db: DB): Array<{ hook: string; text: string }> {
  const out: Array<{ hook: string; text: string }> = ideaHistory(db).map((h) => ({ hook: h.hook, text: h.text }));
  const rows = db.prepare('SELECT spec_json FROM reels').all() as Array<{ spec_json: string }>;
  for (const r of rows) {
    try {
      const s = JSON.parse(r.spec_json) as Spec;
      out.push({ hook: s.hook, text: specText(s).join(' ') });
    } catch {
      /* ignore */
    }
  }
  for (const dir of [paths.specs, path.join(paths.examples, 'specs')]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      try {
        const s = parseSpec(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
        out.push({ hook: s.hook, text: specText(s).join(' ') });
      } catch {
        /* invalid specs don't count */
      }
    }
  }
  return out;
}

export interface Rejected {
  id: string;
  reason: string;
  idea: unknown;
  issues?: string[];
  review?: Review;
  critic_score?: number;
}

export interface ProcessResult {
  accepted: Array<{ spec: Spec; score: number | null; review?: Review }>;
  rejected: Rejected[];
}

interface ProcessOptions {
  db: DB;
  rawIdeas: unknown[];
  slots: Slot[];
  /** Pre-computed reviews (paste mode) or a function that reviews valid ideas (API mode). */
  reviews?: Review[];
  review?: (ideas: Spec[]) => Promise<Review[]>;
  repair?: (bad: Array<{ idea: unknown; issues: string[] }>) => Promise<unknown[]>;
  source: 'ai' | 'import';
  keep: number;
  dryRun?: boolean;
  now?: Date;
}

export async function processIdeas(o: ProcessOptions): Promise<ProcessResult> {
  const now = o.now ?? new Date();
  const datePrefix = now.toISOString().slice(0, 10).replace(/-/g, '');
  const ids = existingIds(o.db);
  const rejected: Rejected[] = [];

  const prepare = (raw: unknown, i: number): Record<string, any> => {
    const idea = { ...(raw as Record<string, any>) };
    const slot = o.slots[i];
    idea.source = o.source;
    idea.created_at = now.toISOString();
    idea.features = { ...(idea.features ?? {}) };
    if (slot && !idea.features.planned_post_time) idea.features.planned_post_time = slot.planned_post_time;
    if (slot) {
      idea.experiment = { arm: slot.arm, ...(idea.experiment ?? {}) };
      if (slot.hypothesis) {
        idea.experiment.hypothesis ??= slot.hypothesis.statement;
        idea.experiment.hypothesis_id ??= slot.hypothesis.id;
        idea.experiment.test ??= { feature: slot.hypothesis.feature, value: slot.hypothesis.value };
      }
    }
    if (!idea.id) {
      let id = `${datePrefix}-${slugify(String(idea.template ?? 'reel'), 14)}-${slugify(String(idea.hook ?? 'idea'), 40)}`.replace(/-+$/, '');
      let k = 2;
      const base = id;
      while (ids.has(id)) id = `${base}-${k++}`;
      ids.add(id);
      idea.id = id;
    }
    return idea;
  };

  // 1) validate
  const valid: Array<{ spec: Spec; i: number }> = [];
  let invalid: Array<{ idea: Record<string, any>; issues: string[]; i: number }> = [];
  o.rawIdeas.forEach((raw, i) => {
    const idea = prepare(raw, i);
    try {
      valid.push({ spec: parseSpec(idea, idea.id), i });
    } catch (e) {
      invalid.push({ idea, issues: e instanceof SpecError ? e.issues : [(e as Error).message], i });
    }
  });
  // 2) one repair round
  if (invalid.length && o.repair) {
    const fixed = await o.repair(invalid.map((x) => ({ idea: x.idea, issues: x.issues })));
    const still: typeof invalid = [];
    invalid.forEach((x, k) => {
      const f = fixed[k];
      if (!f) return still.push(x);
      const idea = { ...(f as Record<string, any>), id: x.idea.id, source: x.idea.source, created_at: x.idea.created_at };
      try {
        valid.push({ spec: parseSpec(prepare(idea, x.i), x.idea.id), i: x.i });
      } catch (e) {
        still.push({ idea, issues: e instanceof SpecError ? e.issues : [(e as Error).message], i: x.i });
      }
    });
    invalid = still;
  }
  for (const x of invalid) rejected.push({ id: x.idea.id, reason: 'invalid spec', idea: x.idea, issues: x.issues });

  // 3) duplicates (against history and earlier ideas in this batch)
  const history = historyTexts(o.db);
  const fresh: Array<{ spec: Spec; i: number }> = [];
  for (const v of valid) {
    const text = specText(v.spec).join(' ');
    const m = closestMatch({ hook: v.spec.hook, text }, history);
    if (m && m.score >= config.ideas.duplicateSimilarity) {
      rejected.push({ id: v.spec.id, reason: `duplicate of "${m.against}" (similarity ${m.score.toFixed(2)})`, idea: v.spec });
      continue;
    }
    history.push({ hook: v.spec.hook, text });
    fresh.push(v);
  }

  // 4) critic
  // API mode reviews are indexed by position in `fresh`; paste-mode reviews by the original idea index.
  const reviews: Review[] = o.review && fresh.length ? await o.review(fresh.map((f) => f.spec)) : [];
  const scored = fresh.map((f, k) => {
    const review = o.review ? reviews.find((r) => r.index === k) : o.reviews?.find((r) => r.index === f.i);
    if (!review) return { ...f, review: undefined, verdict: { ok: true, score: NaN as number, why: 'no critic review' } };
    return { ...f, review, verdict: passesCritic(review) };
  });
  const passing: typeof scored = [];
  for (const s of scored) {
    if (s.verdict.ok) passing.push(s);
    else rejected.push({ id: s.spec.id, reason: s.verdict.why ?? 'critic', idea: s.spec, review: s.review, critic_score: s.verdict.score });
  }

  // 5) keep the best `keep`, preserving the explore/exploit mix
  const byScore = (a: (typeof scored)[number], b: (typeof scored)[number]) => (Number.isNaN(b.verdict.score) ? 0 : b.verdict.score) - (Number.isNaN(a.verdict.score) ? 0 : a.verdict.score);
  const nExploit = Math.round(o.keep * config.ideas.exploitShare);
  const ex = passing.filter((p) => p.spec.experiment.arm === 'exploit').sort(byScore);
  const xp = passing.filter((p) => p.spec.experiment.arm === 'explore').sort(byScore);
  let take = [...ex.slice(0, nExploit), ...xp.slice(0, o.keep - Math.min(nExploit, ex.length))];
  if (take.length < o.keep) take = [...take, ...[...ex, ...xp].filter((p) => !take.includes(p)).sort(byScore)].slice(0, o.keep);
  for (const p of passing) if (!take.includes(p)) rejected.push({ id: p.spec.id, reason: `over batch quota (critic ${p.verdict.score.toFixed?.(1)}); still a valid idea`, idea: p.spec, review: p.review, critic_score: p.verdict.score });

  const result: ProcessResult = {
    accepted: take.map((t) => ({ spec: t.spec, score: Number.isNaN(t.verdict.score) ? null : t.verdict.score, review: t.review })),
    rejected,
  };
  if (!o.dryRun) persist(o.db, result, now);
  return result;
}

function persist(db: DB, r: ProcessResult, now: Date): void {
  fs.mkdirSync(paths.specs, { recursive: true });
  const rejDir = path.join(paths.rejected, now.toISOString().slice(0, 10));
  for (const a of r.accepted) {
    fs.writeFileSync(path.join(paths.specs, `${a.spec.id}.json`), JSON.stringify(a.spec, null, 2) + '\n');
    upsertReel(db, a.spec, 'pending');
    recordIdea(db, {
      fingerprint: fingerprint(specText(a.spec).join(' ')),
      reel_id: a.spec.id,
      hook: a.spec.hook,
      premise: a.spec.premise,
      text: specText(a.spec).join(' '),
      status: 'accepted',
      scores: a.review?.scores,
    });
    const t = a.spec.experiment.test;
    if (a.spec.experiment.arm === 'explore' && a.spec.experiment.hypothesis_id) {
      upsertHypothesis(db, {
        id: a.spec.experiment.hypothesis_id,
        statement: a.spec.experiment.hypothesis ?? `${t?.feature} = ${t?.value} scores above median`,
        feature: t?.feature ?? null,
        value: t?.value ?? null,
      });
    }
  }
  if (r.rejected.length) fs.mkdirSync(rejDir, { recursive: true });
  for (const x of r.rejected) {
    fs.writeFileSync(path.join(rejDir, `${x.id}.json`), JSON.stringify(x, null, 2) + '\n');
    const idea = x.idea as { hook?: string; premise?: string };
    const text = (() => {
      try {
        return specText(x.idea as Spec).join(' ');
      } catch {
        return String(idea.hook ?? '');
      }
    })();
    recordIdea(db, { fingerprint: fingerprint(text || x.id), hook: String(idea.hook ?? x.id), premise: idea.premise ?? null, text, status: 'rejected', reason: x.reason, scores: x.review?.scores });
  }
}

// ---------------------------------------------------------------------------------------------
// Entry points

function readPlaybook(): string {
  try {
    return fs.readFileSync(paths.playbook, 'utf8');
  } catch {
    return '(no playbook yet: run npm run learn)';
  }
}

function historyHooks(db: DB): string[] {
  return historyTexts(db).map((h) => h.hook.replace(/\*/g, ''));
}

const PLAN_FILE = path.join(paths.data, 'pending-plan.json');

export async function generateIdeas(opts: { count: number; llm: LLM; db?: DB; dryRun?: boolean; seed?: number; log?: (s: string) => void }): Promise<ProcessResult> {
  const db = opts.db ?? getDb();
  const log = opts.log ?? (() => {});
  const nCandidates = Math.ceil(opts.count * config.ideas.overgenerate);
  const slots = planBatch(nCandidates, loadInsights(), opts.seed);
  log(`Planned ${slots.length} candidate slots (${slots.filter((s) => s.arm === 'exploit').length} exploit / ${slots.filter((s) => s.arm === 'explore').length} explore) for ${opts.count} reels.`);
  const prompt = generatorPrompt({ playbook: readPlaybook(), history: historyHooks(db), slots });
  log(`Generating with ${env.anthropicModel}…`);
  const json = extractJson(await opts.llm.complete({ system: generatorSystem(), prompt })) as { ideas?: unknown[] };
  const rawIdeas = Array.isArray(json.ideas) ? json.ideas : [];
  log(`Got ${rawIdeas.length} ideas. Validating, de-duplicating and running the critic…`);
  return processIdeas({
    db,
    rawIdeas,
    slots,
    source: 'ai',
    keep: opts.count,
    dryRun: opts.dryRun,
    repair: async (bad) => {
      const res = await opts.llm.complete({
        system: generatorSystem(),
        prompt: `These reel specs failed validation. Fix ONLY the listed problems and return {"ideas": [ ...fixed specs in the same order ]}.\n\n${bad
          .map((b, k) => `[${k}] problems:\n${b.issues.map((i) => `  - ${i}`).join('\n')}\nspec: ${JSON.stringify(b.idea)}`)
          .join('\n\n')}`,
        effort: 'medium',
      });
      const j = extractJson(res) as { ideas?: unknown[] };
      return Array.isArray(j.ideas) ? j.ideas : [];
    },
    review: async (specs) => {
      const res = await opts.llm.complete({ system: criticSystem(), prompt: criticPrompt(specs), model: env.anthropicCriticModel, effort: 'medium', maxTokens: 32000 });
      const j = extractJson(res) as { reviews?: unknown[] };
      return (j.reviews ?? []).map((r) => ReviewSchema.safeParse(r)).filter((r) => r.success).map((r) => r.data as Review);
    },
  });
}

/** No-API mode, step 1: print a prompt to paste into Claude, and remember the slot plan for the import. */
export function buildPastePrompt(opts: { count: number; db?: DB; seed?: number }): string {
  const db = opts.db ?? getDb();
  const slots = planBatch(Math.ceil(opts.count * config.ideas.overgenerate), loadInsights(), opts.seed);
  fs.mkdirSync(paths.data, { recursive: true });
  fs.writeFileSync(PLAN_FILE, JSON.stringify({ created_at: new Date().toISOString(), keep: opts.count, slots }, null, 2));
  return pastePrompt({ playbook: readPlaybook(), history: historyHooks(db), slots });
}

/** No-API mode, step 2: import Claude's JSON answer (ideas + self-critique reviews). */
export async function importIdeas(opts: { text: string; db?: DB; keep?: number; dryRun?: boolean }): Promise<ProcessResult> {
  const db = opts.db ?? getDb();
  const json = extractJson(opts.text) as { ideas?: unknown[]; reviews?: unknown[] };
  if (!Array.isArray(json.ideas)) throw new Error('Expected a JSON object with an "ideas" array.');
  let plan: { keep: number; slots: Slot[] } | null = null;
  try {
    plan = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8'));
  } catch {
    /* plan is optional */
  }
  const reviews = (json.reviews ?? []).map((r) => ReviewSchema.safeParse(r)).filter((r) => r.success).map((r) => r.data as Review);
  const res = await processIdeas({
    db,
    rawIdeas: json.ideas,
    slots: plan?.slots ?? [],
    reviews,
    source: 'import',
    keep: opts.keep ?? plan?.keep ?? json.ideas.length,
    dryRun: opts.dryRun,
  });
  if (!opts.dryRun && fs.existsSync(PLAN_FILE)) fs.rmSync(PLAN_FILE);
  return res;
}
