import type { GroupStat } from './analyze.ts';

/** log2 difference → "+25%" style multiplicative change. */
export function pct(log2diff: number): string {
  const v = Math.round((2 ** log2diff - 1) * 100);
  return `${v >= 0 ? '+' : ''}${v}%`;
}

export function ciText(ci: [number, number] | [number | null, number | null]): string {
  if (ci[0] === null || ci[1] === null) return 'n/a';
  return `${pct(ci[0])} to ${pct(ci[1])}`;
}

export const EVIDENCE_LABEL = {
  anecdote: 'anecdote (too few reels to mean anything)',
  weak: 'weak (early signal)',
  moderate: 'moderate',
  solid: 'solid',
} as const;

/** Careful wording that scales with the evidence. */
export function claim(g: GroupStat): string {
  const name = `\`${g.feature} = ${g.value}\``;
  const dir = g.verdict === 'better' ? 'above' : g.verdict === 'worse' ? 'below' : 'around';
  const lead = g.evidence === 'solid' ? 'Established' : g.evidence === 'moderate' ? 'Likely' : 'Early signal';
  return `${lead}: ${name} scores ${dir} other reels: ${pct(g.diff)} virality (95% CI ${ciText(g.ci)}; shrunk estimate ${pct(g.shrunk)}), n=${g.n}, evidence: ${g.evidence}.`;
}

export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return n.toFixed(digits);
}
