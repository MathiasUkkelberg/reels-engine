/** One-command loop: sync → learn → ideas → render:batch → schedule (if publishing is on) → summary. */
import { parseArgs } from 'node:util';
import { config } from '../../reels.config.ts';
import { env } from '../env.ts';
import { getDb, logRun } from '../db/index.ts';
import { syncMetrics } from '../metrics/sync.ts';
import { runLearn } from '../learn/pipeline.ts';
import { generateIdeas } from '../ideas/generate.ts';
import { AnthropicLLM } from '../ideas/llm.ts';
import { renderBatchCmd } from './render.ts';
import { scheduleCmd } from './posting.ts';

export async function dailyCmd(args: string[]) {
  const { values } = parseArgs({ args, options: { count: { type: 'string' }, 'skip-ideas': { type: 'boolean' }, 'skip-render': { type: 'boolean' } } });
  const db = getDb();
  const summary: string[] = [];
  const step = (s: string) => console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 60 - s.length))}`);

  step('1/5 sync');
  const s = await syncMetrics(db, { log: console.log });
  summary.push(s.checked ? `sync: ${s.snapshots} new snapshots from ${s.checked} posted reels${s.followers !== null ? ` · ${s.followers} followers` : ''}` : 'sync: skipped (API not configured or nothing posted)');
  s.errors.forEach((e) => console.error(`  ⚠ ${e}`));

  step('2/5 learn');
  const l = runLearn({ db });
  summary.push(`learn: ${l.insights.n_scored} scored reels, mode=${l.insights.analysis.mode}, ${l.insights.hypotheses.filter((h) => h.status === 'open').length} open hypotheses`);

  step('3/5 ideas');
  if (values['skip-ideas']) summary.push('ideas: skipped (--skip-ideas)');
  else if (!env.anthropicApiKey) {
    console.log('ANTHROPIC_API_KEY not set: skipping. Use npm run ideas:prompt / ideas:import instead.');
    summary.push('ideas: skipped (no API key; use ideas:prompt)');
  } else {
    try {
      const r = await generateIdeas({ count: Number(values.count ?? config.ideas.defaultCount), llm: new AnthropicLLM(), db, log: console.log });
      summary.push(`ideas: ${r.accepted.length} accepted, ${r.rejected.length} rejected`);
    } catch (e) {
      console.error(`  ✗ ${(e as Error).message}`);
      summary.push(`ideas: failed (${(e as Error).message})`);
      process.exitCode = 1;
    }
  }

  step('4/5 render:batch');
  if (values['skip-render']) summary.push('render: skipped');
  else {
    await renderBatchCmd([]);
    const n = (db.prepare(`SELECT COUNT(*) n FROM reels WHERE status = 'rendered'`).get() as { n: number }).n;
    summary.push(`render: ${n} reel(s) rendered and waiting to be posted`);
  }

  step('5/5 schedule');
  await scheduleCmd([]);
  summary.push(env.publishingEnabled ? 'schedule: queue updated, due reels published' : 'schedule: queue planned (publishing off: post manually)');

  logRun(db, 'daily', summary);
  console.log(`\n══ daily summary ══\n${summary.map((x) => `• ${x}`).join('\n')}\n• playbook: PLAYBOOK.md · dashboard: reports/dashboard.html`);
}
