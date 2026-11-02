/**
 * Which features go with high virality?
 *
 * - Always: grouped comparisons (group vs. the rest) with sample sizes, 95% intervals,
 *   empirical-Bayes shrinkage and an evidence level that never lets small samples become rules.
 * - Above ~50 scored reels: ridge regression (effects adjusted for each other) with bootstrap
 *   intervals and cross-validated R², plus a depth-2 regression tree to surface interactions.
 */
import { config } from '../../reels.config.ts';
import { mean, median, quantile, rng, sd, solve, tCdf, tCritical95 } from './stats.ts';

export const LEARN_FEATURES = [
  'template',
  'hook_type',
  'topic',
  'humor_style',
  'text_density',
  'length',
  'loop',
  'has_twist',
  'post_slot',
  'weekday',
  'series',
  'arm',
] as const;
export type LearnFeature = (typeof LEARN_FEATURES)[number];

export interface Observation {
  id: string;
  hook: string;
  posted_at: string;
  log_score: number;
  virality: number;
  hypothesis_id?: string | null;
  f: Record<LearnFeature, string>;
}

export type Evidence = 'anecdote' | 'weak' | 'moderate' | 'solid';
export type Verdict = 'better' | 'worse' | 'unclear';

export interface GroupStat {
  feature: LearnFeature;
  value: string;
  n: number;
  /** Mean log2 score of the group. */
  mean: number;
  /** Group mean minus the mean of all other reels (log2 units). */
  diff: number;
  ci: [number, number];
  /** diff shrunk toward 0 by k/(n+k). */
  shrunk: number;
  /** Multiplicative virality lift implied by the shrunk diff (1.25 = +25%). */
  lift: number;
  pBetter: number;
  evidence: Evidence;
  verdict: Verdict;
}

export interface LearnConfig {
  minGroupN: number;
  evidence: { weak: number; moderate: number; solid: number };
  shrinkageK: number;
  modelThresholdN: number;
  hypothesisMinN: number;
  hypothesisMaxN: number;
}

export const defaultLearnConfig = (): LearnConfig => ({ ...config.learning, evidence: { ...config.learning.evidence } });

// ---------------------------------------------------------------------------------------------
// Feature extraction

export function lengthBucket(s: number): string {
  if (s < 10) return '5-9s';
  if (s < 15) return '10-14s';
  return '15-20s';
}

export function postSlot(hour: number): string {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 15) return 'midday';
  if (hour >= 15 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 22) return 'evening';
  return 'night';
}

export function localParts(iso: string, timeZone: string): { hour: number; weekday: string } {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const weekday = (parts.find((p) => p.type === 'weekday')?.value ?? 'Mon').toLowerCase();
  return { hour, weekday };
}

/** Turn a reel's stored features + posting time into categorical learning features. */
export function extractFeatures(
  features: Record<string, unknown>,
  postedAt: string | null,
  arm: string,
  timeZone = config.schedule.timezone,
): Record<LearnFeature, string> {
  let hour: number | null = null;
  let weekday = 'unknown';
  if (postedAt) {
    const lp = localParts(postedAt, timeZone);
    hour = lp.hour;
    weekday = lp.weekday;
  } else if (typeof features.planned_post_time === 'string') {
    hour = Number(features.planned_post_time.slice(0, 2));
  }
  const yn = (v: unknown) => (v ? 'yes' : 'no');
  return {
    template: String(features.template ?? 'unknown'),
    hook_type: String(features.hook_type ?? 'unknown'),
    topic: String(features.topic ?? 'unknown'),
    humor_style: String(features.humor_style ?? 'unknown'),
    text_density: String(features.text_density ?? 'unknown'),
    length: lengthBucket(Number(features.length_s ?? 10)),
    loop: yn(features.loop),
    has_twist: yn(features.has_twist),
    post_slot: hour === null ? 'unknown' : postSlot(hour),
    weekday,
    series: String(features.series ?? 'none') || 'none',
    arm,
  };
}

// ---------------------------------------------------------------------------------------------
// Grouped comparisons

export function evidenceLevel(n: number, cfg: LearnConfig): Evidence {
  if (n < cfg.minGroupN) return 'anecdote';
  if (n < cfg.evidence.moderate) return 'weak';
  if (n < cfg.evidence.solid) return 'moderate';
  return 'solid';
}

/** Compare a group of scores with the rest (Welch-style interval, regularised SDs for tiny groups). */
export function compare(group: number[], rest: number[], sdAll: number, cfg: LearnConfig) {
  const n = group.length;
  const m = mean(group);
  const mr = rest.length ? mean(rest) : 0;
  const diff = m - mr;
  // Regularise SDs toward the overall SD so n=2 groups can't produce a falsely tight interval.
  const reg = (xs: number[]) => {
    const k0 = 3;
    const s = xs.length > 1 ? sd(xs) : sdAll;
    const df = Math.max(0, xs.length - 1);
    return Math.sqrt((df * s * s + k0 * sdAll * sdAll) / (df + k0));
  };
  const se = Math.sqrt(reg(group) ** 2 / Math.max(n, 1) + (rest.length ? reg(rest) ** 2 / rest.length : 0));
  const df = Math.max(1, Math.min(n, rest.length || n) - 1);
  const t = tCritical95(df);
  const ci: [number, number] = [diff - t * se, diff + t * se];
  const pBetter = se > 0 ? tCdf(diff / se, df) : 0.5;
  const shrunk = diff * (n / (n + cfg.shrinkageK));
  return { n, mean: m, diff, ci, se, pBetter, shrunk };
}

export function groupStats(obs: Observation[], cfg: LearnConfig = defaultLearnConfig()): GroupStat[] {
  const all = obs.map((o) => o.log_score);
  const sdAll = Number.isFinite(sd(all)) && sd(all) > 0 ? sd(all) : 0.5;
  const out: GroupStat[] = [];
  for (const feature of LEARN_FEATURES) {
    const values = [...new Set(obs.map((o) => o.f[feature]))];
    if (values.length < 2) continue;
    for (const value of values) {
      const g = obs.filter((o) => o.f[feature] === value).map((o) => o.log_score);
      const r = obs.filter((o) => o.f[feature] !== value).map((o) => o.log_score);
      const c = compare(g, r, sdAll, cfg);
      const evidence = evidenceLevel(c.n, cfg);
      let verdict: Verdict = 'unclear';
      if (evidence !== 'anecdote') {
        if (c.ci[0] > 0) verdict = 'better';
        else if (c.ci[1] < 0) verdict = 'worse';
      }
      out.push({
        feature,
        value,
        n: c.n,
        mean: c.mean,
        diff: c.diff,
        ci: c.ci,
        shrunk: c.shrunk,
        lift: 2 ** c.shrunk,
        pBetter: c.pBetter,
        evidence,
        verdict,
      });
    }
  }
  return out.sort((a, b) => b.shrunk - a.shrunk);
}

// ---------------------------------------------------------------------------------------------
// Models (used above `modelThresholdN` scored reels)

export interface RidgeResult {
  n: number;
  lambda: number;
  r2: number;
  cvR2: number;
  coefs: Array<{ feature: LearnFeature; value: string; coef: number; lo: number; hi: number; lift: number; n: number }>;
}

function design(obs: Observation[], minN: number) {
  const cols: Array<{ feature: LearnFeature; value: string; n: number }> = [];
  for (const feature of LEARN_FEATURES) {
    if (feature === 'arm') continue;
    const counts = new Map<string, number>();
    for (const o of obs) counts.set(o.f[feature], (counts.get(o.f[feature]) ?? 0) + 1);
    if (counts.size < 2) continue;
    for (const [value, n] of counts) if (n >= minN) cols.push({ feature, value, n });
  }
  return cols;
}

function fitRidge(X: number[][], y: number[], lambda: number): { beta: number[]; xm: number[]; ym: number } {
  const p = X[0]?.length ?? 0;
  const xm = Array.from({ length: p }, (_, j) => mean(X.map((r) => r[j])));
  const ym = mean(y);
  const Xc = X.map((r) => r.map((v, j) => v - xm[j]));
  const yc = y.map((v) => v - ym);
  const A = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => Xc.reduce((s, r) => s + r[i] * r[j], 0) + (i === j ? lambda : 0)));
  const b = Array.from({ length: p }, (_, i) => Xc.reduce((s, r, k) => s + r[i] * yc[k], 0));
  return { beta: p ? solve(A, b) : [], xm, ym };
}

const predict = (m: { beta: number[]; xm: number[]; ym: number }, x: number[]) => m.ym + x.reduce((s, v, j) => s + (v - m.xm[j]) * m.beta[j], 0);

export function ridgeModel(obs: Observation[], cfg: LearnConfig = defaultLearnConfig(), lambda = 3, boot = 200): RidgeResult | null {
  const cols = design(obs, Math.max(3, cfg.minGroupN));
  if (!cols.length || obs.length < 10) return null;
  const X = obs.map((o) => cols.map((c) => (o.f[c.feature] === c.value ? 1 : 0)));
  const y = obs.map((o) => o.log_score);
  const fit = fitRidge(X, y, lambda);
  const ssTot = y.reduce((s, v) => s + (v - fit.ym) ** 2, 0) || 1;
  const r2 = 1 - y.reduce((s, v, i) => s + (v - predict(fit, X[i])) ** 2, 0) / ssTot;
  // 5-fold cross-validated R²: honest about predictive power.
  const folds = 5;
  let ssRes = 0;
  for (let f = 0; f < folds; f++) {
    const trainIdx = y.map((_, i) => i).filter((i) => i % folds !== f);
    const testIdx = y.map((_, i) => i).filter((i) => i % folds === f);
    const m = fitRidge(trainIdx.map((i) => X[i]), trainIdx.map((i) => y[i]), lambda);
    for (const i of testIdx) ssRes += (y[i] - predict(m, X[i])) ** 2;
  }
  const cvR2 = 1 - ssRes / ssTot;
  // Bootstrap intervals.
  const r = rng(7);
  const samples: number[][] = cols.map(() => []);
  for (let b = 0; b < boot; b++) {
    const idx = y.map(() => Math.floor(r() * y.length));
    const m = fitRidge(idx.map((i) => X[i]), idx.map((i) => y[i]), lambda);
    m.beta.forEach((v, j) => samples[j].push(v));
  }
  const coefs = cols
    .map((c, j) => ({
      feature: c.feature,
      value: c.value,
      n: c.n,
      coef: fit.beta[j],
      lo: quantile(samples[j], 0.05),
      hi: quantile(samples[j], 0.95),
      lift: 2 ** fit.beta[j],
    }))
    .sort((a, b) => b.coef - a.coef);
  return { n: obs.length, lambda, r2, cvR2, coefs };
}

export interface TreeNode {
  rule: string;
  n: number;
  mean: number;
  children?: TreeNode[];
}

/** Depth-2 regression tree on "feature = value" splits (min leaf size keeps it honest). */
export function regressionTree(obs: Observation[], minLeaf = 8, depth = 2, rule = 'all reels'): TreeNode {
  const ys = obs.map((o) => o.log_score);
  const node: TreeNode = { rule, n: obs.length, mean: mean(ys) };
  if (depth === 0 || obs.length < 2 * minLeaf) return node;
  const sse = (xs: number[]) => {
    const m = mean(xs);
    return xs.reduce((s, v) => s + (v - m) ** 2, 0);
  };
  const base = sse(ys);
  let best: { feature: LearnFeature; value: string; gain: number } | null = null;
  for (const feature of LEARN_FEATURES) {
    if (feature === 'arm') continue;
    for (const value of new Set(obs.map((o) => o.f[feature]))) {
      const a = obs.filter((o) => o.f[feature] === value).map((o) => o.log_score);
      const b = obs.filter((o) => o.f[feature] !== value).map((o) => o.log_score);
      if (a.length < minLeaf || b.length < minLeaf) continue;
      const gain = base - sse(a) - sse(b);
      if (!best || gain > best.gain) best = { feature, value, gain };
    }
  }
  if (!best || best.gain <= base * 0.05) return node;
  const b = best;
  node.children = [
    regressionTree(obs.filter((o) => o.f[b.feature] === b.value), minLeaf, depth - 1, `${b.feature} = ${b.value}`),
    regressionTree(obs.filter((o) => o.f[b.feature] !== b.value), minLeaf, depth - 1, `${b.feature} ≠ ${b.value}`),
  ];
  return node;
}

// ---------------------------------------------------------------------------------------------
// Hypotheses

export interface HypothesisInput {
  id: string;
  statement: string;
  feature: string | null;
  value: string | null;
}

export interface HypothesisResult {
  id: string;
  n_test: number;
  effect: number | null;
  ci_low: number | null;
  ci_high: number | null;
  status: 'open' | 'supported' | 'refuted' | 'inconclusive';
  evidence: string;
}

export function evaluateHypothesis(h: HypothesisInput, obs: Observation[], cfg: LearnConfig = defaultLearnConfig()): HypothesisResult {
  const inTest = (o: Observation) =>
    o.hypothesis_id === h.id || (h.feature !== null && h.value !== null && (o.f as Record<string, string>)[h.feature] === h.value);
  const g = obs.filter(inTest).map((o) => o.log_score);
  const r = obs.filter((o) => !inTest(o)).map((o) => o.log_score);
  const all = obs.map((o) => o.log_score);
  const sdAll = Number.isFinite(sd(all)) && sd(all) > 0 ? sd(all) : 0.5;
  if (g.length < cfg.hypothesisMinN || r.length < 2) {
    return {
      id: h.id,
      n_test: g.length,
      effect: g.length ? mean(g) - (r.length ? mean(r) : 0) : null,
      ci_low: null,
      ci_high: null,
      status: 'open',
      evidence: `${g.length} test reel(s) scored; needs ≥ ${cfg.hypothesisMinN} to judge.`,
    };
  }
  const c = compare(g, r, sdAll, cfg);
  let status: HypothesisResult['status'] = 'open';
  if (c.ci[0] > 0) status = 'supported';
  else if (c.ci[1] < 0) status = 'refuted';
  else if (g.length >= cfg.hypothesisMaxN) status = 'inconclusive';
  const pct = (x: number) => `${x >= 0 ? '+' : ''}${Math.round((2 ** x - 1) * 100)}%`;
  return {
    id: h.id,
    n_test: g.length,
    effect: c.diff,
    ci_low: c.ci[0],
    ci_high: c.ci[1],
    status,
    evidence: `n=${g.length} test vs ${r.length} other reels; virality ${pct(c.diff)} (95% CI ${pct(c.ci[0])} to ${pct(c.ci[1])}).`,
  };
}

// ---------------------------------------------------------------------------------------------

export interface Analysis {
  n: number;
  globalMedianVirality: number;
  groups: GroupStat[];
  ridge: RidgeResult | null;
  tree: TreeNode | null;
  mode: 'none' | 'grouped' | 'model';
}

export function analyze(obs: Observation[], cfg: LearnConfig = defaultLearnConfig()): Analysis {
  if (!obs.length) return { n: 0, globalMedianVirality: 1, groups: [], ridge: null, tree: null, mode: 'none' };
  const groups = groupStats(obs, cfg);
  const useModel = obs.length > cfg.modelThresholdN;
  return {
    n: obs.length,
    globalMedianVirality: median(obs.map((o) => o.virality)),
    groups,
    ridge: useModel ? ridgeModel(obs, cfg) : null,
    tree: useModel ? regressionTree(obs) : null,
    mode: useModel ? 'model' : 'grouped',
  };
}
