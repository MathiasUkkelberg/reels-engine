import { config } from '../../reels.config.ts';
import type { Insights } from './pipeline.ts';
import { PRIORS } from './priors.ts';
import { claim, ciText, pct } from './format.ts';
import type { GroupStat } from './analyze.ts';

const HOUSE_RULES = [
  'Every reel needs a hook that works in one glance (≤ 60 characters ideal) and a payoff in the final beat.',
  'Write for people who use AI tools daily: specific, insider details (exact error messages, rate limits, "You\'re absolutely right!") beat generic "AI is taking over" jokes.',
  'Punch at situations and tools, never at people. No real private individuals, no impersonating real brands or accounts.',
  'No engagement bait that lies ("wait for it" with no payoff). The caption question should be specific and easy to answer.',
  'Prefer formats that can become a series; name the series in `features.series`.',
  'Keep text big and short: one idea per beat, ≤ 3 words per second on average.',
];

function status(g: GroupStat | undefined, minEvidence: GroupStat['evidence'][]): string {
  if (!g) return 'untested (no reels with this feature yet)';
  if (!minEvidence.includes(g.evidence)) return `untested so far (n=${g.n}, ${pct(g.diff)} vs others, CI ${ciText(g.ci)})`;
  if (g.verdict === 'better') return `**confirmed by data**: ${pct(g.diff)} (CI ${ciText(g.ci)}), n=${g.n}`;
  if (g.verdict === 'worse') return `**contradicted by data**: ${pct(g.diff)} (CI ${ciText(g.ci)}), n=${g.n}`;
  return `not supported so far: ${pct(g.diff)} (CI ${ciText(g.ci)}), n=${g.n}`;
}

export function renderPlaybook(ins: Insights, date: string): string {
  const a = ins.analysis;
  // Yes/no features mirror each other ("loop = no" is just the flip side of "loop = yes"); report the "yes" side.
  const groups = a.groups.filter((g) => !((g.feature === 'loop' || g.feature === 'has_twist') && g.value === 'no'));
  const works = groups.filter((g) => g.verdict === 'better' && g.evidence !== 'anecdote').slice(0, 10);
  const fails = groups.filter((g) => g.verdict === 'worse' && g.evidence !== 'anecdote').sort((x, y) => x.shrunk - y.shrunk).slice(0, 10);
  const hints = groups
    .filter((g) => g.verdict === 'unclear' && g.n >= 2 && (g.pBetter >= 0.85 || g.pBetter <= 0.15))
    .slice(0, 6);
  const phase =
    ins.n_scored === 0 ? 'bootstrap (no scored reels yet: priors only)' : ins.n_scored < 15 ? 'early (treat everything as hypotheses)' : ins.n_scored <= config.learning.modelThresholdN ? 'building evidence (grouped comparisons)' : 'established (regression + grouped comparisons)';

  const L: string[] = [];
  L.push('# PLAYBOOK: @0xclaudemaxxer');
  L.push('');
  L.push(`_Rewritten by \`npm run learn\` on ${date}. The idea generator reads this file. Edit priors in \`src/learn/priors.ts\` and house rules in \`src/learn/playbook.ts\`; everything else comes from data._`);
  L.push('');
  L.push('## Status');
  L.push(`- Phase: **${phase}**`);
  L.push(`- Posted reels: ${ins.n_posted} · scored (≥ ${config.scoring.minAgeHours}h old): ${ins.n_scored} · too young: ${ins.n_too_young}`);
  if (ins.followers !== null) L.push(`- Followers: ${ins.followers.toLocaleString('en-US')} / ${config.brand.goalFollowers.toLocaleString('en-US')} goal (${((ins.followers / config.brand.goalFollowers) * 100).toFixed(1)}%)`);
  L.push('- Virality score: 1.0 = a typical recent reel. Weighted toward shares and saves per reach, plus watch-through (see `reels.config.ts`).');
  L.push('- Evidence levels: anecdote (n<3, ignored) · weak (3–9) · moderate (10–29) · solid (30+). Only intervals that exclude zero count as findings.');
  L.push('');

  L.push('## What works (from data)');
  if (!works.length) L.push('_Nothing yet has enough evidence. Until it does, follow the priors below and keep experimenting._');
  works.forEach((g) => L.push(`- ${claim(g)}`));
  L.push('');
  L.push("## What doesn't (from data)");
  if (!fails.length) L.push('_Nothing has been shown to underperform yet._');
  fails.forEach((g) => L.push(`- ${claim(g)}`));
  L.push('');

  L.push('## Open hypotheses');
  const open = ins.hypotheses.filter((h) => h.status === 'open');
  if (!open.length && !hints.length) L.push('_No open hypotheses. The next idea batch will propose experiments._');
  open.forEach((h) => L.push(`- [ ] **${h.statement}** (\`${h.id}\`): ${h.evidence}`));
  hints.forEach((g) =>
    L.push(`- [ ] Hint (not a finding): \`${g.feature} = ${g.value}\` trends ${g.diff > 0 ? 'up' : 'down'} (${pct(g.diff)}, CI ${ciText(g.ci)}, n=${g.n}). Test more before trusting it.`),
  );
  L.push('');
  const closed = ins.hypotheses.filter((h) => h.status !== 'open');
  if (closed.length) {
    L.push('## Concluded experiments');
    closed.forEach((h) => L.push(`- [${h.status.toUpperCase()}] ${h.statement}: ${h.evidence}`));
    L.push('');
  }

  if (a.ridge) {
    L.push('## Model view (effects adjusted for each other)');
    L.push(
      `Ridge regression on ${a.ridge.n} reels, in-sample R² ${a.ridge.r2.toFixed(2)}, cross-validated R² ${a.ridge.cvR2.toFixed(2)}${a.ridge.cvR2 < 0.05 ? ' (the model barely predicts anything yet, so read the coefficients as weak hints)' : ''}.`,
    );
    a.ridge.coefs
      .filter((c) => c.lo > 0 || c.hi < 0)
      .slice(0, 8)
      .forEach((c) => L.push(`- \`${c.feature} = ${c.value}\`: ${pct(c.coef)} (90% bootstrap CI ${pct(c.lo)} to ${pct(c.hi)}), n=${c.n}`));
    L.push('');
  }

  L.push('## Priors (best practices, to be replaced by data)');
  L.push('_Marked **PRIOR** until the account has moderate evidence for or against them._');
  for (const p of PRIORS) {
    const g = p.feature ? a.groups.find((x) => x.feature === p.feature && x.value === p.value) : undefined;
    const st = p.feature ? status(g, ['moderate', 'solid']) : 'not directly measurable; keep following it';
    const tag = p.feature && g && ['moderate', 'solid'].includes(g.evidence) ? 'DATA' : 'PRIOR';
    L.push(`- **[${tag}]** ${p.text} _(${st})_`);
  }
  L.push('');

  L.push('## Top reels so far');
  const top = [...ins.scored].sort((x, y) => y.virality - x.virality).slice(0, 5);
  if (!top.length) L.push('_None scored yet._');
  top.forEach((s) => L.push(`- **${s.virality.toFixed(2)}×** \`${s.id}\` (${s.template}, ${s.f.hook_type}, ${s.f.topic}): "${s.hook}"`));
  L.push('');

  L.push('## Formats to build on (exploit list)');
  const exploit = works.filter((g) => ['template', 'hook_type', 'humor_style', 'topic', 'series'].includes(g.feature));
  if (exploit.length) exploit.slice(0, 6).forEach((g) => L.push(`- \`${g.feature} = ${g.value}\` (${pct(g.shrunk)} shrunk lift, n=${g.n})`));
  else {
    L.push('- No proven winners yet: build on priors. Strong starting formats: fake chat where the AI escalates, coding-agent terminal meltdowns, POV late-night sessions, numbered "stages of…" lists with a twist.');
    top.slice(0, 3).forEach((s) => L.push(`- Variation candidate: \`${s.id}\` (${s.template}): "${s.hook}"`));
  }
  L.push('');

  L.push('## House rules (always)');
  HOUSE_RULES.forEach((r) => L.push(`- ${r}`));
  L.push('');
  return L.join('\n');
}
