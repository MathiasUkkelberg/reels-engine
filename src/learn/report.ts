import { config } from '../../reels.config.ts';
import type { Insights } from './pipeline.ts';
import { LEARN_FEATURES, type TreeNode } from './analyze.ts';
import { ciText, fmtNum, pct } from './format.ts';

function tree(node: TreeNode, depth = 0, out: string[] = []): string[] {
  out.push(`${'  '.repeat(depth)}- ${node.rule}: n=${node.n}, mean virality ${(2 ** node.mean).toFixed(2)}×`);
  node.children?.forEach((c) => tree(c, depth + 1, out));
  return out;
}

export function renderReport(ins: Insights, date: string): string {
  const a = ins.analysis;
  const L: string[] = [];
  L.push(`# Learning report: ${date}`);
  L.push('');
  L.push(`Posted: ${ins.n_posted} · scored: ${ins.n_scored} · too young to score: ${ins.n_too_young} · analysis mode: **${a.mode}**`);
  if (ins.followers !== null) L.push(`\nFollowers: ${ins.followers.toLocaleString('en-US')} (goal ${config.brand.goalFollowers.toLocaleString('en-US')})`);
  L.push('');
  L.push('> How to read this: virality 1.00 = a typical recent reel. Differences are "this group vs all other reels".');
  L.push('> Intervals are 95%. With small samples, intervals are wide on purpose: a group needs ≥ 3 reels to count at all,');
  L.push(`> and switching to regression waits for > ${config.learning.modelThresholdN} scored reels.`);
  L.push('');

  if (!ins.n_scored) {
    L.push('No scored reels yet. Post reels, then run `npm run sync` (API) or `npm run import:csv` (manual), and `npm run learn` again.');
    return L.join('\n') + '\n';
  }

  L.push('## Scored reels');
  L.push('| reel | posted | age (h) | virality | shares/reach | saves/reach | watch-through | template | hook type |');
  L.push('|---|---|---:|---:|---:|---:|---:|---|---|');
  for (const s of [...ins.scored].sort((x, y) => y.virality - x.virality)) {
    const c = s.components;
    L.push(
      `| ${s.id} | ${s.posted_at.slice(0, 10)} | ${Math.round(s.age_hours)} | **${s.virality.toFixed(2)}** | ${c.shares ? (c.shares.raw * 100).toFixed(2) + '%' : '–'} | ${c.saves ? (c.saves.raw * 100).toFixed(2) + '%' : '–'} | ${c.watch_through ? (c.watch_through.raw * 100).toFixed(0) + '%' : '–'} | ${s.template} | ${s.f.hook_type} |`,
    );
  }
  L.push('');

  L.push('## Feature comparisons');
  for (const feature of LEARN_FEATURES) {
    const gs = a.groups.filter((g) => g.feature === feature);
    if (!gs.length) continue;
    L.push(`### ${feature}`);
    L.push('| value | n | vs others | 95% CI | shrunk | P(better) | evidence | verdict |');
    L.push('|---|---:|---:|---|---:|---:|---|---|');
    for (const g of gs) {
      L.push(`| ${g.value} | ${g.n} | ${pct(g.diff)} | ${ciText(g.ci)} | ${pct(g.shrunk)} | ${(g.pBetter * 100).toFixed(0)}% | ${g.evidence} | ${g.verdict} |`);
    }
    L.push('');
  }

  if (a.ridge) {
    L.push('## Ridge regression');
    L.push(`n=${a.ridge.n}, λ=${a.ridge.lambda}, R²=${fmtNum(a.ridge.r2)}, 5-fold CV R²=${fmtNum(a.ridge.cvR2)}`);
    L.push('');
    L.push('| feature = value | n | effect | 90% bootstrap CI |');
    L.push('|---|---:|---:|---|');
    a.ridge.coefs.forEach((c) => L.push(`| ${c.feature} = ${c.value} | ${c.n} | ${pct(c.coef)} | ${pct(c.lo)} to ${pct(c.hi)} |`));
    L.push('');
  }
  if (a.tree) {
    L.push('## Regression tree (depth 2, min leaf 8)');
    L.push(...tree(a.tree));
    L.push('');
  }

  L.push('## Hypotheses');
  if (!ins.hypotheses.length) L.push('_None recorded yet._');
  else {
    L.push('| id | statement | status | evidence |');
    L.push('|---|---|---|---|');
    ins.hypotheses.forEach((h) => L.push(`| ${h.id} | ${h.statement} | ${h.status} | ${h.evidence} |`));
  }
  L.push('');
  return L.join('\n');
}
