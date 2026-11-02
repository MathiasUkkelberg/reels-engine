/**
 * Explore/exploit batch planning.
 *  - exploit slots (~70%): Thompson-sample from the posterior of each feature value (shrunk effect ± se),
 *    so proven winners are picked most often but not exclusively. Before data, sample from priors.
 *  - explore slots (~30%): each tests one under-sampled feature value and carries an explicit hypothesis.
 */
import { config } from '../../reels.config.ts';
import { HOOK_TYPES, HUMOR_STYLES } from '../spec/schema.ts';
import { TEMPLATE_IDS } from '../templates/defs.ts';
import type { Insights } from '../learn/pipeline.ts';
import type { GroupStat } from '../learn/analyze.ts';
import { randn, rng as makeRng } from '../learn/stats.ts';

export interface Slot {
  n: number;
  arm: 'exploit' | 'explore';
  template: string;
  hook_type: string;
  humor_style: string;
  planned_post_time: string;
  loop: boolean;
  /** Explore only. */
  hypothesis?: { id: string; statement: string; feature: string; value: string };
  /** Exploit only: past reels to riff on. */
  build_on?: string[];
  note: string;
}

/** Prior preferences used before there is data (relative weights, not data). */
const PRIOR_WEIGHTS: Record<string, Record<string, number>> = {
  template: { chat: 3, terminal: 3, pov: 2.5, countdown: 2.5, notifications: 2, tier_list: 2, dialogue: 2, progress: 2, nobody: 1.5, expectation_reality: 1.5, stat: 1.5, keynote: 1.5 },
  hook_type: { relatable_pain: 3, pov: 2, list: 2, shock: 1.5, story: 1.5, comparison: 1.5, nobody: 1.2, reveal: 1.2, question: 1, challenge: 0.8, other: 0.3 },
  humor_style: { escalation: 3, relatable: 3, sarcastic: 2, deadpan: 1.5, absurd: 1.5, self_deprecating: 1.5, meta: 1, dark: 0.5, wholesome: 0.7, other: 0.3 },
};

const CHOICES: Record<string, readonly string[]> = { template: TEMPLATE_IDS, hook_type: HOOK_TYPES, humor_style: HUMOR_STYLES };

function weightedPick<T>(items: T[], weights: number[], r: () => number): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let x = r() * total;
  for (let i = 0; i < items.length; i++) {
    x -= weights[i];
    if (x <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** Thompson sampling over a feature's values using the analysis groups (falls back to priors). */
function thompson(feature: string, groups: GroupStat[], r: () => number): string {
  const values = CHOICES[feature] as string[];
  const gs = groups.filter((g) => g.feature === feature);
  if (gs.reduce((a, g) => a + g.n, 0) < 6) {
    return weightedPick(values, values.map((v) => PRIOR_WEIGHTS[feature]?.[v] ?? 1), r);
  }
  let best = values[0];
  let bestDraw = -Infinity;
  for (const v of values) {
    const g = gs.find((x) => x.value === v);
    // Unseen values: optimistic-ish prior centred on 0 with wide spread.
    const meanV = g ? g.shrunk : 0;
    const spread = g ? Math.max(0.15, (g.ci[1] - g.ci[0]) / 3.92) : 0.6;
    const prior = Math.log2(PRIOR_WEIGHTS[feature]?.[v] ?? 1) * 0.1;
    const draw = meanV + prior + spread * randn(r);
    if (draw > bestDraw) {
      bestDraw = draw;
      best = v;
    }
  }
  return best;
}

/** Keep combos sensible: the "nobody" hook type only fits the nobody template (and vice versa). */
function harmonize(slot: Slot, r: () => number, groups: GroupStat[], locked?: string): void {
  if (slot.template === 'nobody' && locked !== 'hook_type') slot.hook_type = 'nobody';
  let guard = 0;
  while (slot.hook_type === 'nobody' && slot.template !== 'nobody' && guard++ < 20) {
    if (locked === 'hook_type') slot.template = 'nobody';
    else slot.hook_type = thompson('hook_type', groups, r);
  }
  if (slot.hook_type === 'nobody' && slot.template !== 'nobody') slot.hook_type = 'relatable_pain';
}

function slotTimes(): string[] {
  return config.schedule.slots.slice(0, config.schedule.postsPerDay);
}

export function hypothesisId(feature: string, value: string): string {
  return `${feature}-${value}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export function planBatch(count: number, insights: Insights | null, seed = Date.now()): Slot[] {
  const r = makeRng(seed);
  const groups = insights?.analysis.groups ?? [];
  const nExploit = Math.round(count * config.ideas.exploitShare);
  const times = slotTimes();
  const slots: Slot[] = [];
  const top = insights ? [...insights.scored].sort((a, b) => b.virality - a.virality).slice(0, 5) : [];

  for (let i = 0; i < nExploit; i++) {
    const template = thompson('template', groups, r);
    slots.push({
      n: i + 1,
      arm: 'exploit',
      template,
      hook_type: thompson('hook_type', groups, r),
      humor_style: thompson('humor_style', groups, r),
      planned_post_time: times[i % times.length],
      loop: r() < 0.35,
      build_on: top.filter((t) => t.template === template).map((t) => `${t.id}: "${t.hook}" (${t.virality.toFixed(2)}×)`).slice(0, 2),
      note: top.length ? 'Build on what has worked: a fresh joke in a proven format.' : 'No data yet: build on the priors in the playbook.',
    });
    harmonize(slots[slots.length - 1], r, groups);
  }

  // Explore: least-tested feature values first (ties broken randomly), skipping ones with solid evidence.
  const candidates: Array<{ feature: string; value: string; n: number }> = [];
  for (const feature of ['template', 'hook_type', 'humor_style'] as const) {
    for (const value of CHOICES[feature]) {
      if (value === 'other') continue;
      const g = groups.find((x) => x.feature === feature && x.value === value);
      if (g && (g.evidence === 'solid' || g.evidence === 'moderate')) continue;
      candidates.push({ feature, value, n: g?.n ?? 0 });
    }
  }
  for (const flag of [{ feature: 'loop', value: 'yes' }, { feature: 'length', value: '5-9s' }]) {
    const g = groups.find((x) => x.feature === flag.feature && x.value === flag.value);
    candidates.push({ ...flag, n: g?.n ?? 0 });
  }
  const openIds = new Set((insights?.hypotheses ?? []).filter((h) => h.status === 'open').map((h) => h.id));
  candidates.sort((a, b) => {
    // Keep feeding open hypotheses first, then the least-tested values.
    const ao = openIds.has(hypothesisId(a.feature, a.value)) ? -1 : 0;
    const bo = openIds.has(hypothesisId(b.feature, b.value)) ? -1 : 0;
    return ao - bo || a.n - b.n || r() - 0.5;
  });
  for (let i = nExploit; i < count; i++) {
    const c = candidates[(i - nExploit) % Math.max(1, candidates.length)];
    const base: Slot = {
      n: i + 1,
      arm: 'explore',
      template: thompson('template', groups, r),
      hook_type: thompson('hook_type', groups, r),
      humor_style: thompson('humor_style', groups, r),
      planned_post_time: times[i % times.length],
      loop: r() < 0.35,
      note: '',
    };
    if (c) {
      if (c.feature === 'template' || c.feature === 'hook_type' || c.feature === 'humor_style') (base as unknown as Record<string, string>)[c.feature] = c.value;
      if (c.feature === 'loop') base.loop = true;
      const statement =
        c.feature === 'length'
          ? 'Very short reels (5–9s) score above the account median'
          : c.feature === 'loop'
            ? 'Seamless loops score above the account median'
            : `Reels with ${c.feature.replace('_', ' ')} "${c.value}" score above the account median`;
      base.hypothesis = { id: hypothesisId(c.feature, c.value), statement, feature: c.feature, value: c.value };
      base.note = `Experiment: tests ${c.feature} = ${c.value} (${c.n} scored so far).`;
    }
    harmonize(base, r, groups, c?.feature);
    slots.push(base);
  }
  return slots;
}

export function describeSlots(slots: Slot[]): string {
  return slots
    .map((s) => {
      const parts = [
        `Slot ${s.n} [${s.arm.toUpperCase()}]: template=${s.template}, hook_type=${s.hook_type}, humor_style=${s.humor_style}, loop=${s.loop}, planned_post_time=${s.planned_post_time}`,
      ];
      if (s.hypothesis) parts.push(`  hypothesis (copy into experiment): "${s.hypothesis.statement}", experiment.test = {"feature":"${s.hypothesis.feature}","value":"${s.hypothesis.value}"}, hypothesis_id="${s.hypothesis.id}"`);
      if (s.build_on?.length) parts.push(`  build on: ${s.build_on.join('; ')}`);
      parts.push(`  ${s.note}`);
      return parts.join('\n');
    })
    .join('\n');
}
