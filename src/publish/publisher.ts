import fs from 'node:fs';
import path from 'node:path';
import { env, igConfigured } from '../env.ts';
import { config } from '../../reels.config.ts';
import { outDirFor } from '../paths.ts';
import { getReel, markPosted, type DB } from '../db/index.ts';
import { InstagramClient } from './instagram.ts';
import { hostFile } from './hosting.ts';
import type { RenderMeta } from '../render/renderer.ts';
import { formatCaption } from '../spec/caption.ts';

export function assertPublishingReady(): void {
  if (!env.publishingEnabled) throw new Error('Publishing is disabled. Set PUBLISHING_ENABLED=true in .env (and follow SETUP-INSTAGRAM.md). Default workflow: post manually from out/ and run npm run mark-posted.');
  if (!igConfigured()) throw new Error('IG_USER_ID and IG_ACCESS_TOKEN must be set in .env (see SETUP-INSTAGRAM.md).');
}

export interface PublishResult {
  mediaId: string;
  permalink?: string;
  videoUrl?: string;
}

/** Publish out/<id>/ as a Reel through the official API and record it as posted. */
export async function publishReel(db: DB, id: string, opts: { client?: InstagramClient; dryRun?: boolean; log?: (s: string) => void } = {}): Promise<PublishResult | null> {
  const log = opts.log ?? console.log;
  const dir = outDirFor(id);
  const metaFile = path.join(dir, 'meta.json');
  if (!fs.existsSync(metaFile)) throw new Error(`No render for "${id}" in out/. Run: npm run render -- specs/${id}.json`);
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as RenderMeta;
  const reel = getReel(db, id);
  if (reel?.status === 'posted') throw new Error(`"${id}" is already posted (${reel.ig_media_id ?? 'no media id'}).`);
  const variant = meta.caption.variants[meta.caption.selected] ?? meta.caption.variants[0];
  const caption = formatCaption(variant);
  if (opts.dryRun) {
    log(`[dry run] would publish ${id} via ${env.igApiHost} (${env.videoHost} hosting)\n--- caption ---\n${caption}`);
    return null;
  }
  assertPublishingReady();
  const client = opts.client ?? new InstagramClient({ token: env.igAccessToken, userId: env.igUserId });
  const limit = await client.publishingLimit().catch(() => null);
  if (limit?.quota_total && limit.quota_usage >= limit.quota_total) throw new Error(`Publishing quota used up (${limit.quota_usage}/${limit.quota_total} in 24h).`);

  let containerId: string;
  let videoUrl: string | undefined;
  const stamp = Date.now();
  if (env.videoHost === 'resumable') {
    log('Uploading directly to Instagram (resumable)…');
    containerId = await client.createResumableReel({ caption, shareToFeed: config.publishing.shareToFeed, file: path.join(dir, 'reel.mp4') });
  } else {
    log(`Uploading video + cover (${env.videoHost})…`);
    videoUrl = await hostFile(path.join(dir, 'reel.mp4'), `reels/${id}-${stamp}.mp4`, 'video/mp4');
    const coverUrl = await hostFile(path.join(dir, 'cover.jpg'), `reels/${id}-${stamp}.jpg`, 'image/jpeg');
    log('Creating Reels container…');
    containerId = await client.createReelContainer({ videoUrl, caption, coverUrl, shareToFeed: config.publishing.shareToFeed });
  }
  log(`Waiting for Instagram to process container ${containerId}…`);
  await client.waitForContainer(containerId);
  const mediaId = await client.publish(containerId);
  const m = await client.media(mediaId).catch(() => ({ permalink: undefined, timestamp: undefined }));
  markPosted(db, id, mediaId, m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString(), m.permalink ?? null);
  log(`✓ Published ${id} → ${m.permalink ?? mediaId}`);
  return { mediaId, permalink: m.permalink, videoUrl };
}
