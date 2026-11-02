/** Pull insights for posted reels at ~1h / 24h / 72h / 7d and store them as a time series. */
import { config } from '../../reels.config.ts';
import { env, igConfigured } from '../env.ts';
import { bucketFor, insertSnapshot, nowIso, postedReels, snapshotsFor, type DB } from '../db/index.ts';
import { InstagramClient } from '../publish/instagram.ts';

export interface SyncSummary {
  checked: number;
  snapshots: number;
  skipped: number;
  errors: string[];
  followers: number | null;
}

export async function syncMetrics(db: DB, opts: { client?: InstagramClient; now?: Date; force?: boolean; log?: (s: string) => void } = {}): Promise<SyncSummary> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? new Date();
  const summary: SyncSummary = { checked: 0, snapshots: 0, skipped: 0, errors: [], followers: null };
  if (!opts.client && !igConfigured()) {
    log('Instagram API not configured (IG_USER_ID / IG_ACCESS_TOKEN): skipping sync. Use npm run import:csv for manual metrics.');
    return summary;
  }
  const client = opts.client ?? new InstagramClient({ token: env.igAccessToken, userId: env.igUserId });
  const ages = config.metrics.snapshotAgesHours;
  for (const r of postedReels(db)) {
    if (!r.ig_media_id || !r.posted_at) continue;
    summary.checked++;
    const age = (now.getTime() - new Date(r.posted_at).getTime()) / 3600e3;
    const bucket = bucketFor(age, ages);
    const have = new Set(snapshotsFor(db, r.id).map((s) => s.bucket));
    // Past the last bucket and already captured: the series is complete.
    if (!bucket || (have.has(bucket) && !opts.force)) {
      summary.skipped++;
      continue;
    }
    try {
      const v = await client.reelInsights(r.ig_media_id);
      insertSnapshot(db, {
        reel_id: r.id,
        captured_at: now.toISOString(),
        age_hours: Math.round(age * 10) / 10,
        bucket,
        views: v.views ?? null,
        reach: v.reach ?? null,
        likes: v.likes ?? null,
        comments: v.comments ?? null,
        shares: v.shares ?? null,
        saves: v.saved ?? null,
        total_interactions: v.total_interactions ?? null,
        reposts: v.reposts ?? null,
        avg_watch_time_s: v.ig_reels_avg_watch_time !== undefined ? v.ig_reels_avg_watch_time / 1000 : null,
        total_watch_time_s: v.ig_reels_video_view_total_time !== undefined ? v.ig_reels_video_view_total_time / 1000 : null,
        skip_rate: v.reels_skip_rate ?? null,
        source: 'api',
        raw_json: JSON.stringify(v),
      });
      summary.snapshots++;
      log(`  ${r.id}: ${bucket} snapshot (age ${age.toFixed(1)}h) views=${v.views ?? '–'} reach=${v.reach ?? '–'} shares=${v.shares ?? '–'} saves=${v.saved ?? '–'}`);
    } catch (e) {
      summary.errors.push(`${r.id}: ${(e as Error).message}`);
    }
  }
  try {
    const acct = await client.account();
    if (typeof acct.followers_count === 'number') {
      summary.followers = acct.followers_count;
      db.prepare('INSERT OR REPLACE INTO account_snapshots (captured_at, followers, media_count) VALUES (?, ?, ?)').run(nowIso().slice(0, 13), acct.followers_count, acct.media_count ?? null);
    }
  } catch (e) {
    summary.errors.push(`account: ${(e as Error).message}`);
  }
  return summary;
}
