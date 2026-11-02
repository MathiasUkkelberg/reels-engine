/**
 * Virality score.
 *
 * For each component k (shares, saves, comments, likes per reach; watch-through; reach) we compute a
 * ratio against the rolling median of the reels posted just before this one:
 *
 *   count components:  ratio = (count + α) / (reach × baselineRate + α)      (α = pseudo-count, handles zeros)
 *   watch-through:     ratio = (avg watch time / length) / median(watch-through)
 *   reach:             ratio = reach / median(reach)
 *
 * virality = Σ w_k · ratio_k / Σ w_k   over the components that are available (weights in reels.config.ts).
 *
 * 1.0 means "a typical recent reel"; 2.0 means "twice as viral as typical". Because every component is
 * relative to the recent median, the score stays comparable as the account grows.
 */
import { config } from '../../reels.config.ts';
import { median } from './stats.ts';

export type ComponentKey = 'shares' | 'saves' | 'comments' | 'likes' | 'watch_through' | 'reach';
export const COMPONENTS: ComponentKey[] = ['shares', 'saves', 'watch_through', 'comments', 'likes', 'reach'];
const COUNT_KEYS: ComponentKey[] = ['shares', 'saves', 'comments', 'likes'];

export interface MetricInput {
  id: string;
  posted_at: string;
  duration_s: number;
  /** The snapshot used for scoring (closest to the target age). */
  age_hours: number;
  reach?: number | null;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
  avg_watch_time_s?: number | null;
}

export interface ScoreConfig {
  weights: Record<ComponentKey, number>;
  baselineWindow: number;
  minBaseline: number;
  ratioCap: number;
  pseudoCount: number;
}

export const defaultScoreConfig = (): ScoreConfig => ({
  weights: { ...config.scoring.weights },
  baselineWindow: config.scoring.baselineWindow,
  minBaseline: config.scoring.minBaseline,
  ratioCap: config.scoring.ratioCap,
  pseudoCount: 1,
});

export interface ComponentScore {
  raw: number;
  baseline: number;
  ratio: number;
}

export interface ScoredReel {
  id: string;
  posted_at: string;
  age_hours: number;
  denominator: 'reach' | 'views';
  components: Partial<Record<ComponentKey, ComponentScore>>;
  virality: number;
  /** log2(virality): 0 = typical, +1 = twice as viral, -1 = half. Used for averaging. */
  log_score: number;
}

/** Raw per-reel rates (null when the metric is missing). */
export function rawComponents(m: MetricInput): { denom: number | null; denomKind: 'reach' | 'views'; raw: Partial<Record<ComponentKey, number>> } {
  const denomKind = m.reach && m.reach > 0 ? 'reach' : 'views';
  const denom = denomKind === 'reach' ? (m.reach ?? null) : (m.views ?? null);
  const raw: Partial<Record<ComponentKey, number>> = {};
  if (denom && denom > 0) {
    for (const k of COUNT_KEYS) {
      const v = m[k as 'shares'];
      if (v !== null && v !== undefined) raw[k] = v / denom;
    }
    raw.reach = denom;
  }
  if (m.avg_watch_time_s !== null && m.avg_watch_time_s !== undefined && m.duration_s > 0) {
    raw.watch_through = Math.min(3, m.avg_watch_time_s / m.duration_s);
  }
  return { denom: denom && denom > 0 ? denom : null, denomKind, raw };
}

/**
 * Score a set of reels. Input order doesn't matter; baselines use posting order.
 * Reels without a usable denominator (reach/views) are skipped.
 */
export function scoreReels(items: MetricInput[], cfg: ScoreConfig = defaultScoreConfig()): ScoredReel[] {
  const sorted = [...items].sort((a, b) => a.posted_at.localeCompare(b.posted_at));
  const prepared = sorted.map((m) => ({ m, ...rawComponents(m) })).filter((p) => p.denom !== null);
  const cap = cfg.ratioCap;
  const clampRatio = (r: number) => Math.min(cap, Math.max(1 / cap, r));

  // Bootstrap baseline: the first `baselineWindow` reels overall (used until enough history exists).
  const early = prepared.slice(0, cfg.baselineWindow);
  const baselineFor = (i: number, k: ComponentKey): number | null => {
    const prior = prepared
      .slice(0, i)
      .map((p) => p.raw[k])
      .filter((v): v is number => v !== undefined)
      .slice(-cfg.baselineWindow);
    const pool = prior.length >= cfg.minBaseline ? prior : early.map((p) => p.raw[k]).filter((v): v is number => v !== undefined);
    if (!pool.length) return null;
    return median(pool);
  };

  return prepared.map((p, i) => {
    const components: Partial<Record<ComponentKey, ComponentScore>> = {};
    for (const k of COMPONENTS) {
      const raw = p.raw[k];
      if (raw === undefined) continue;
      const base = baselineFor(i, k);
      if (base === null) continue;
      let ratio: number;
      if (COUNT_KEYS.includes(k)) {
        const count = raw * (p.denom as number);
        ratio = (count + cfg.pseudoCount) / ((p.denom as number) * base + cfg.pseudoCount);
      } else {
        ratio = base > 0 ? raw / base : 1;
      }
      components[k] = { raw, baseline: base, ratio: clampRatio(ratio) };
    }
    let wsum = 0;
    let acc = 0;
    for (const [k, c] of Object.entries(components) as [ComponentKey, ComponentScore][]) {
      const w = cfg.weights[k] ?? 0;
      wsum += w;
      acc += w * c.ratio;
    }
    const virality = wsum > 0 ? acc / wsum : 1;
    return {
      id: p.m.id,
      posted_at: p.m.posted_at,
      age_hours: p.m.age_hours,
      denominator: p.denomKind,
      components,
      virality,
      log_score: Math.log2(virality),
    };
  });
}

/** Pick the snapshot closest to the target age, ignoring ones younger than minAge. */
export function pickSnapshot<T extends { age_hours: number }>(snaps: T[], targetAge = config.scoring.targetAgeHours, minAge = config.scoring.minAgeHours): T | null {
  const eligible = snaps.filter((s) => s.age_hours >= minAge);
  if (!eligible.length) return null;
  return eligible.reduce((best, s) => (Math.abs(s.age_hours - targetAge) < Math.abs(best.age_hours - targetAge) ? s : best));
}
