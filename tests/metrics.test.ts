import { describe, expect, it } from 'vitest';
import { openDb, upsertReel, markPosted, snapshotsFor, bucketFor } from '../src/db/index.ts';
import { parseCsv, importCsv } from '../src/metrics/csv.ts';
import { syncMetrics } from '../src/metrics/sync.ts';
import { InstagramClient, parseInsights } from '../src/publish/instagram.ts';
import { planQueue, zonedToUtc, upcomingSlots, queue } from '../src/publish/queue.ts';
import { signingKey, signPut } from '../src/publish/hosting.ts';
import { exampleSpec } from './helpers.ts';

describe('csv import', () => {
  it('parses quoted CSV', () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"']]);
  });

  it('imports snapshots, marks posted, reports unknown reels', () => {
    const db = openDb(':memory:');
    upsertReel(db, exampleSpec(), 'rendered');
    const csv = 'reel_id,posted_at,captured_at,views,reach,likes,comments,shares,saves,avg_watch_time_s\nchat-one-typo,2026-11-01T18:00:00Z,2026-11-04T18:00:00Z,"12,000",9000,700,50,210,80,9.5\nghost,,,1,1,1,1,1,1,1\n';
    const r = importCsv(db, csv);
    expect(r.imported).toBe(1);
    expect(r.errors[0]).toMatch(/unknown reel "ghost"/);
    const s = snapshotsFor(db, 'chat-one-typo');
    expect(s[0].age_hours).toBe(72);
    expect(s[0].bucket).toBe('72h');
    expect(s[0].views).toBe(12000);
  });

  it('buckets ages', () => {
    expect(bucketFor(0.5, [1, 24, 72, 168])).toBeNull();
    expect(bucketFor(1.1, [1, 24, 72, 168])).toBe('1h');
    expect(bucketFor(30, [1, 24, 72, 168])).toBe('24h');
    expect(bucketFor(400, [1, 24, 72, 168])).toBe('168h');
  });
});

function mockFetch(routes: Array<[RegExp, (url: string, init?: RequestInit) => unknown]>, log: string[] = []) {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    log.push(`${init?.method ?? 'GET'} ${url.replace(/access_token=[^&]+/, 'access_token=…')}`);
    for (const [re, fn] of routes) if (re.test(url)) return new Response(JSON.stringify(fn(url, init)), { status: 200 });
    return new Response(JSON.stringify({ error: { message: 'not mocked: ' + url } }), { status: 400 });
  }) as typeof fetch;
}

describe('instagram api', () => {
  it('container → poll → publish uses the documented endpoints', async () => {
    const log: string[] = [];
    let polls = 0;
    const f = mockFetch(
      [
        [/\/123\/media$/, (_u, init) => { expect(String(init?.body)).toContain('media_type=REELS'); return { id: 'c1' }; }],
        [/\/c1\?/, () => ({ status_code: ++polls < 2 ? 'IN_PROGRESS' : 'FINISHED' })],
        [/\/123\/media_publish$/, (_u, init) => { expect(String(init?.body)).toContain('creation_id=c1'); return { id: 'm1' }; }],
      ],
      log,
    );
    const c = new InstagramClient({ token: 't', userId: '123', host: 'graph.instagram.com', version: 'v26.0', fetchImpl: f, pollMs: 1 });
    const id = await c.createReelContainer({ videoUrl: 'https://x/v.mp4', caption: 'hi', coverUrl: 'https://x/c.jpg' });
    await c.waitForContainer(id);
    expect(await c.publish(id)).toBe('m1');
    expect(log[0]).toMatch(/^POST https:\/\/graph\.instagram\.com\/v26\.0\/123\/media/);
  });

  it('parses insights (values[] and total_value shapes)', () => {
    expect(parseInsights({ data: [{ name: 'reach', values: [{ value: 10 }] }, { name: 'shares', total_value: { value: 3 } }] })).toEqual({ reach: 10, shares: 3 });
  });

  it('sync stores one snapshot per due bucket', async () => {
    const db = openDb(':memory:');
    upsertReel(db, exampleSpec(), 'rendered');
    markPosted(db, 'chat-one-typo', '999', '2026-11-01T00:00:00Z');
    const f = mockFetch([
      [/\/999\/insights/, () => ({ data: [{ name: 'reach', values: [{ value: 5000 }] }, { name: 'shares', values: [{ value: 50 }] }, { name: 'ig_reels_avg_watch_time', values: [{ value: 7200 }] }] })],
      [/\/123\?/, () => ({ followers_count: 4321 })],
    ]);
    const client = new InstagramClient({ token: 't', userId: '123', fetchImpl: f });
    await syncMetrics(db, { client, now: new Date('2026-11-01T01:30:00Z') });
    await syncMetrics(db, { client, now: new Date('2026-11-01T02:00:00Z') }); // same bucket → skipped
    const s = await syncMetrics(db, { client, now: new Date('2026-11-02T01:00:00Z') });
    const snaps = snapshotsFor(db, 'chat-one-typo');
    expect(snaps.map((x) => x.bucket)).toEqual(['1h', '24h']);
    expect(snaps[0].avg_watch_time_s).toBeCloseTo(7.2);
    expect(s.followers).toBe(4321);
  });
});

describe('posting queue', () => {
  it('converts local slot times to UTC across DST', () => {
    expect(zonedToUtc(2026, 7, 1, 19, 35, 'Europe/Oslo').toISOString()).toBe('2026-07-01T17:35:00.000Z');
    expect(zonedToUtc(2026, 12, 1, 19, 35, 'Europe/Oslo').toISOString()).toBe('2026-12-01T18:35:00.000Z');
  });

  it('fills free slots, preferring each reel\'s planned time', () => {
    const db = openDb(':memory:');
    const a = { ...exampleSpec('chat-one-typo'), id: 'a' };
    const b = { ...exampleSpec('pov-one-last-change'), id: 'b' };
    a.features = { ...a.features, planned_post_time: '19:35' };
    b.features = { ...b.features, planned_post_time: '12:05' };
    upsertReel(db, a as any, 'rendered');
    upsertReel(db, b as any, 'rendered');
    const opts = { timezone: 'Europe/Oslo', postsPerDay: 2, slots: ['12:05', '19:35', '21:50'], horizonDays: 3 };
    const now = new Date('2026-11-02T08:00:00Z');
    expect(upcomingSlots(now, opts)).toHaveLength(6);
    const added = planQueue(db, now, opts);
    expect(added.find((x) => x.reel_id === 'a')!.scheduled_for).toBe('2026-11-02T18:35:00.000Z');
    expect(added.find((x) => x.reel_id === 'b')!.scheduled_for).toBe('2026-11-02T11:05:00.000Z');
    expect(planQueue(db, now, opts)).toHaveLength(0); // idempotent
    expect(queue(db)).toHaveLength(2);
  });
});

describe('S3/R2 signing', () => {
  it('derives the SigV4 signing key (AWS documented example)', () => {
    expect(signingKey('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20120215', 'us-east-1', 'iam').toString('hex')).toBe('f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d');
  });

  it('builds a path-style signed PUT', () => {
    const r = signPut({ endpoint: 'https://acct.r2.cloudflarestorage.com', bucket: 'b', key: 'reels/x y.mp4', body: Buffer.from('hi'), contentType: 'video/mp4', region: 'auto', accessKeyId: 'AK', secretAccessKey: 'SK', now: new Date('2026-01-01T00:00:00Z') });
    expect(r.url).toBe('https://acct.r2.cloudflarestorage.com/b/reels/x%20y.mp4');
    expect(r.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\/20260101\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  });
});
