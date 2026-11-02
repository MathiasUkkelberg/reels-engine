import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { getDb } from '../db/index.ts';
import { syncMetrics } from '../metrics/sync.ts';
import { importCsv } from '../metrics/csv.ts';
import { runLearn } from '../learn/pipeline.ts';
import { queue } from '../publish/queue.ts';

export async function syncCmd(args: string[]) {
  const { values } = parseArgs({ args, options: { force: { type: 'boolean' } } });
  const s = await syncMetrics(getDb(), { force: values.force, log: console.log });
  console.log(`Sync: ${s.checked} posted reels checked, ${s.snapshots} new snapshots${s.followers !== null ? `, followers ${s.followers}` : ''}.`);
  for (const e of s.errors) console.error(`  ⚠ ${e}`);
}

export async function importCsvCmd(args: string[]) {
  const file = args[0];
  if (!file) throw new Error('Usage: npm run import:csv -- metrics.csv   (template: examples/metrics-template.csv)');
  const r = importCsv(getDb(), fs.readFileSync(file, 'utf8'));
  console.log(`Imported ${r.imported} snapshot(s).`);
  for (const e of r.errors) console.error(`  ⚠ ${e}`);
  if (r.errors.length && !r.imported) process.exitCode = 1;
}

export async function learnCmd() {
  const r = runLearn();
  const a = r.insights.analysis;
  console.log(`Learn: ${r.insights.n_scored} scored reels (${r.insights.n_too_young} too young), mode=${a.mode}.`);
  const best = a.groups.filter((g) => g.verdict === 'better').slice(0, 3);
  for (const g of best) console.log(`  + ${g.feature}=${g.value}: ×${g.lift.toFixed(2)} (n=${g.n}, ${g.evidence})`);
  console.log(`  report:    ${path.relative(process.cwd(), r.reportPath)}\n  dashboard: ${path.relative(process.cwd(), r.dashboardPath)}\n  playbook:  ${path.relative(process.cwd(), r.playbookPath)}`);
}

export async function statusCmd() {
  const db = getDb();
  const counts = db.prepare('SELECT status, COUNT(*) n FROM reels GROUP BY status').all() as Array<{ status: string; n: number }>;
  const snaps = (db.prepare('SELECT COUNT(*) n FROM snapshots').get() as { n: number }).n;
  const hyps = db.prepare('SELECT status, COUNT(*) n FROM hypotheses GROUP BY status').all() as Array<{ status: string; n: number }>;
  console.log('Reels:', counts.map((c) => `${c.status}=${c.n}`).join('  ') || 'none');
  console.log('Snapshots:', snaps);
  console.log('Hypotheses:', hyps.map((c) => `${c.status}=${c.n}`).join('  ') || 'none');
  const q = queue(db).filter((x) => x.status === 'queued');
  console.log('Queued posts:', q.length);
}
