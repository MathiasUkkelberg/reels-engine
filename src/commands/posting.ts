import { parseArgs } from 'node:util';
import { env } from '../env.ts';
import { config } from '../../reels.config.ts';
import { getDb, markPosted, getReel } from '../db/index.ts';
import { dueItems, planQueue, queue } from '../publish/queue.ts';
import { publishReel } from '../publish/publisher.ts';

export async function markPostedCmd(args: string[]) {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: { at: { type: 'string' }, permalink: { type: 'string' } } });
  const [id, mediaId] = positionals;
  if (!id) throw new Error('Usage: npm run mark-posted -- <id> <instagram_media_id> [--at 2026-11-03T19:35:00Z]');
  const db = getDb();
  if (!getReel(db, id)) throw new Error(`Unknown reel "${id}". Render it first (npm run render -- specs/${id}.json).`);
  const at = values.at ? new Date(values.at) : new Date();
  if (Number.isNaN(at.getTime())) throw new Error(`Invalid --at date: ${values.at}`);
  markPosted(db, id, mediaId ?? null, at.toISOString(), values.permalink ?? null);
  console.log(`✓ ${id} marked as posted at ${at.toISOString()}${mediaId ? ` (media ${mediaId})` : ' (no media id: add it later for API sync)'}`);
}

export async function scheduleCmd(args: string[]) {
  const { values } = parseArgs({ args, options: { 'dry-run': { type: 'boolean' } } });
  const db = getDb();
  const added = planQueue(db);
  const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: config.schedule.timezone, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  if (added.length) console.log(`Queued ${added.length} reel(s).`);
  const q = queue(db).filter((x) => x.status === 'queued');
  console.log(`Posting queue (${config.schedule.postsPerDay}/day, ${config.schedule.timezone}):`);
  if (!q.length) console.log('  (empty: render more reels with npm run render:batch)');
  for (const item of q) console.log(`  ${fmt(item.scheduled_for)}  ${item.reel_id}  "${(item.hook ?? '').replace(/\*/g, '')}"${item.last_error ? `  ⚠ ${item.last_error}` : ''}`);
  if (!env.publishingEnabled) {
    console.log('\nPublishing is off: post these manually from out/<id>/ (reel.mp4 + caption.txt + cover.jpg), then npm run mark-posted -- <id> <media_id>.');
    return;
  }
  for (const item of dueItems(db)) {
    try {
      await publishReel(db, item.reel_id, { dryRun: values['dry-run'] });
    } catch (e) {
      db.prepare('UPDATE schedule SET attempts = attempts + 1, last_error = ? WHERE reel_id = ?').run((e as Error).message, item.reel_id);
      console.error(`✗ ${item.reel_id}: ${(e as Error).message}`);
      process.exitCode = 1;
    }
  }
}

export async function publishCmd(args: string[]) {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: { 'dry-run': { type: 'boolean' } } });
  if (!positionals[0]) throw new Error('Usage: npm run publish -- <id> [--dry-run]');
  await publishReel(getDb(), positionals[0], { dryRun: values['dry-run'] });
}
