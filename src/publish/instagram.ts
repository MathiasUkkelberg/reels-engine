/**
 * Official Instagram Platform API (professional accounts) — Reels publishing + insights.
 * Docs: https://developers.facebook.com/docs/instagram-platform/content-publishing/
 *       https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights
 * Host graph.instagram.com = "Instagram API with Instagram Login" (default);
 * graph.facebook.com = "Instagram API with Facebook Login for Business" (also enables resumable upload).
 */
import fs from 'node:fs';
import { env } from '../env.ts';

export type Fetch = typeof fetch;

export class GraphError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

/** Reels insight metrics we request (names per the current Meta docs). */
export const REEL_METRICS = [
  'views',
  'reach',
  'likes',
  'comments',
  'shares',
  'saved',
  'total_interactions',
  'ig_reels_avg_watch_time',
  'ig_reels_video_view_total_time',
  'reels_skip_rate',
  'reposts',
] as const;
/** Fallback set if the API rejects one of the newer metrics for a media object. */
export const CORE_METRICS = ['reach', 'likes', 'comments', 'shares', 'saved', 'ig_reels_avg_watch_time'] as const;

export interface InsightValues {
  views?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saved?: number;
  total_interactions?: number;
  ig_reels_avg_watch_time?: number;
  ig_reels_video_view_total_time?: number;
  reels_skip_rate?: number;
  reposts?: number;
}

export class InstagramClient {
  readonly base: string;
  constructor(
    private opts: { token: string; userId: string; host?: string; version?: string; fetchImpl?: Fetch; pollMs?: number; maxPolls?: number } = {
      token: env.igAccessToken,
      userId: env.igUserId,
    },
  ) {
    this.base = `https://${opts.host ?? env.igApiHost}/${opts.version ?? env.igGraphVersion}`;
  }

  private get f(): Fetch {
    return this.opts.fetchImpl ?? fetch;
  }

  private async call(method: 'GET' | 'POST', pathname: string, params: Record<string, string | undefined> = {}): Promise<any> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, v);
    q.set('access_token', this.opts.token);
    const url = `${this.base}/${pathname}${method === 'GET' ? `?${q}` : ''}`;
    const res = await this.f(url, method === 'POST' ? { method, body: q, headers: { 'content-type': 'application/x-www-form-urlencoded' } } : { method });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || (body as any).error) {
      const msg = (body as any).error?.message ?? `HTTP ${res.status}`;
      throw new GraphError(`Instagram API ${method} ${pathname}: ${msg}`, res.status, body);
    }
    return body;
  }

  /** Step 1: create a REELS media container from a public video URL. */
  async createReelContainer(o: { videoUrl: string; caption: string; coverUrl?: string; shareToFeed?: boolean; thumbOffsetMs?: number }): Promise<string> {
    const r = await this.call('POST', `${this.opts.userId}/media`, {
      media_type: 'REELS',
      video_url: o.videoUrl,
      caption: o.caption,
      cover_url: o.coverUrl,
      thumb_offset: o.coverUrl ? undefined : String(o.thumbOffsetMs ?? 0),
      share_to_feed: String(o.shareToFeed ?? true),
    });
    return r.id;
  }

  /** Resumable upload (Facebook Login for Business apps only): container first, then upload the file. */
  async createResumableReel(o: { caption: string; coverUrl?: string; shareToFeed?: boolean; file: string }): Promise<string> {
    const r = await this.call('POST', `${this.opts.userId}/media`, {
      media_type: 'REELS',
      upload_type: 'resumable',
      caption: o.caption,
      cover_url: o.coverUrl,
      share_to_feed: String(o.shareToFeed ?? true),
    });
    const data = fs.readFileSync(o.file);
    const up = await this.f(r.uri, {
      method: 'POST',
      headers: { Authorization: `OAuth ${this.opts.token}`, offset: '0', file_size: String(data.length) },
      body: data,
    });
    const body = await up.json().catch(() => ({}));
    if (!up.ok || !(body as any).success) throw new GraphError(`Resumable upload failed: ${JSON.stringify(body)}`, up.status, body);
    return r.id;
  }

  /** Step 2: poll the container until FINISHED (docs: poll about once a minute, up to ~5 minutes). */
  async waitForContainer(id: string): Promise<void> {
    const pollMs = this.opts.pollMs ?? 30_000;
    const maxPolls = this.opts.maxPolls ?? 12;
    for (let i = 0; i < maxPolls; i++) {
      const r = await this.call('GET', id, { fields: 'status_code,status' });
      if (r.status_code === 'FINISHED') return;
      if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') throw new GraphError(`Container ${id} ${r.status_code}: ${r.status ?? ''}`, 400, r);
      if (r.status_code === 'PUBLISHED') return;
      await new Promise((res) => setTimeout(res, pollMs));
    }
    throw new Error(`Container ${id} still processing after ${(maxPolls * pollMs) / 1000}s; run publish again later.`);
  }

  /** Step 3: publish the container. Returns the IG media id. */
  async publish(containerId: string): Promise<string> {
    const r = await this.call('POST', `${this.opts.userId}/media_publish`, { creation_id: containerId });
    return r.id;
  }

  async media(mediaId: string): Promise<{ id: string; permalink?: string; timestamp?: string; media_product_type?: string }> {
    return this.call('GET', mediaId, { fields: 'id,permalink,timestamp,media_product_type' });
  }

  async publishingLimit(): Promise<{ quota_usage: number; quota_total?: number }> {
    const r = await this.call('GET', `${this.opts.userId}/content_publishing_limit`, { fields: 'quota_usage,config' });
    const d = r.data?.[0] ?? {};
    return { quota_usage: d.quota_usage ?? 0, quota_total: d.config?.quota_total };
  }

  async account(): Promise<{ followers_count?: number; media_count?: number; username?: string }> {
    return this.call('GET', this.opts.userId, { fields: 'followers_count,media_count,username' });
  }

  /** Lifetime insights for a reel. Falls back to the core metric set if a newer metric is rejected. */
  async reelInsights(mediaId: string): Promise<InsightValues> {
    let body: any;
    try {
      body = await this.call('GET', `${mediaId}/insights`, { metric: REEL_METRICS.join(','), period: 'lifetime' });
    } catch (e) {
      if (!(e instanceof GraphError) || e.status >= 500) throw e;
      body = await this.call('GET', `${mediaId}/insights`, { metric: CORE_METRICS.join(','), period: 'lifetime' });
    }
    return parseInsights(body);
  }
}

export function parseInsights(body: any): InsightValues {
  const out: Record<string, number> = {};
  for (const m of body?.data ?? []) {
    const v = m.total_value?.value ?? m.values?.[0]?.value;
    if (typeof v === 'number') out[m.name] = v;
  }
  return out as InsightValues;
}
