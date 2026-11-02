import { describe, expect, it } from 'vitest';
import { scoreReels, pickSnapshot, rawComponents, defaultScoreConfig, type MetricInput } from '../src/learn/score.ts';

const day = (i: number) => new Date(Date.UTC(2026, 0, 1 + i, 18)).toISOString();

function typical(i: number, scale = 1, over: Partial<MetricInput> = {}): MetricInput {
  const reach = 10000 * scale;
  return {
    id: `r${i}`,
    posted_at: day(i),
    duration_s: 10,
    age_hours: 72,
    reach,
    views: reach * 1.4,
    likes: reach * 0.06,
    comments: reach * 0.004,
    shares: reach * 0.01,
    saves: reach * 0.005,
    avg_watch_time_s: 7,
    ...over,
  };
}

describe('virality score', () => {
  it('scores a typical reel at ~1.0', () => {
    const s = scoreReels(Array.from({ length: 10 }, (_, i) => typical(i)));
    for (const r of s) expect(r.virality).toBeCloseTo(1, 1);
  });

  it('rewards shares and saves per reach most', () => {
    const base = Array.from({ length: 10 }, (_, i) => typical(i));
    const sharer = typical(10, 1, { shares: 10000 * 0.03 }); // 3x shares
    const liker = typical(11, 1, { likes: 10000 * 0.18 }); // 3x likes
    const s = scoreReels([...base, sharer, liker]);
    const vs = s.find((x) => x.id === 'r10')!.virality;
    const vl = s.find((x) => x.id === 'r11')!.virality;
    expect(vs).toBeGreaterThan(1.5);
    expect(vl).toBeLessThan(1.2);
    expect(vs).toBeGreaterThan(vl);
  });

  it('is not skewed by account growth (same rates, 10x reach)', () => {
    // Reach grows 10% per reel (~10x over 25 reels); per-reach rates stay the same.
    const items = Array.from({ length: 25 }, (_, i) => typical(i, 1.1 ** i));
    const s = scoreReels(items);
    // Later reels are compared against the rolling median of recent reels, so only the small
    // reach component moves (and is capped); the score stays near 1.
    for (const r of s.slice(10)) {
      expect(r.virality).toBeGreaterThan(0.9);
      expect(r.virality).toBeLessThan(1.25);
    }
    // Without normalisation, raw reach would differ ~10x between first and last.
    expect(items[24].reach! / items[0].reach!).toBeGreaterThan(9);
  });

  it('re-normalises weights when watch time is missing', () => {
    const items = Array.from({ length: 8 }, (_, i) => typical(i, 1, { avg_watch_time_s: null }));
    const s = scoreReels(items);
    expect(s[0].components.watch_through).toBeUndefined();
    expect(s[3].virality).toBeCloseTo(1, 1);
  });

  it('handles zero shares without dividing by zero (pseudo-count)', () => {
    const items = Array.from({ length: 8 }, (_, i) => typical(i, 0.01, { shares: 0, saves: 0 }));
    const s = scoreReels(items);
    for (const r of s) expect(Number.isFinite(r.virality)).toBe(true);
  });

  it('caps extreme ratios', () => {
    const items = [...Array.from({ length: 8 }, (_, i) => typical(i)), typical(8, 1, { shares: 10000 })];
    const cap = defaultScoreConfig().ratioCap;
    expect(scoreReels(items).at(-1)!.components.shares!.ratio).toBeLessThanOrEqual(cap);
  });

  it('uses only prior reels for the rolling baseline once enough history exists', () => {
    const items = Array.from({ length: 12 }, (_, i) => typical(i));
    items[11] = typical(11, 1, { shares: 10000 * 0.05 });
    const s = scoreReels(items);
    // Reel 11's baseline is the median of reels 0–10 (not including itself).
    expect(s[11].components.shares!.baseline).toBeCloseTo(0.01, 5);
  });

  it('falls back to views when reach is missing', () => {
    const c = rawComponents({ ...typical(0), reach: null });
    expect(c.denomKind).toBe('views');
  });

  it('picks the snapshot closest to the target age, ignoring very young ones', () => {
    const snaps = [{ age_hours: 1 }, { age_hours: 24 }, { age_hours: 70 }, { age_hours: 168 }];
    expect(pickSnapshot(snaps, 72, 20)!.age_hours).toBe(70);
    expect(pickSnapshot([{ age_hours: 2 }], 72, 20)).toBeNull();
  });
});
