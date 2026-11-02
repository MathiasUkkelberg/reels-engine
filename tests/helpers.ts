import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, upsertReel, markPosted, insertSnapshot, type DB } from '../src/db/index.ts';
import { parseSpec } from '../src/spec/validate.ts';
import type { Spec } from '../src/spec/schema.ts';
import type { Observation, LearnFeature } from '../src/learn/analyze.ts';
import { rng, randn } from '../src/learn/stats.ts';

export const EXAMPLES = path.resolve(import.meta.dirname, '../examples/specs');

export function exampleSpec(name = 'chat-one-typo'): Spec {
  return parseSpec(JSON.parse(fs.readFileSync(path.join(EXAMPLES, `${name}.json`), 'utf8')));
}

export function rawExample(name = 'chat-one-typo'): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(EXAMPLES, `${name}.json`), 'utf8'));
}

export function tmpDir(prefix = 'reels-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const BASE_F: Record<LearnFeature, string> = {
  template: 'chat',
  hook_type: 'relatable_pain',
  topic: 'coding-agents',
  humor_style: 'escalation',
  text_density: 'low',
  length: '10-14s',
  loop: 'no',
  has_twist: 'yes',
  post_slot: 'evening',
  weekday: 'tue',
  series: 'none',
  arm: 'exploit',
};

/**
 * Synthetic observations: log2 score = sum of true effects + noise.
 * `assign(i)` returns feature overrides for reel i.
 */
export function synthObs(n: number, assign: (i: number, r: () => number) => Partial<Record<LearnFeature, string>>, effects: Record<string, number>, noise = 0.5, seed = 1): Observation[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const f = { ...BASE_F, ...assign(i, r) };
    let y = randn(r) * noise;
    for (const [k, v] of Object.entries(effects)) {
      const [feat, val] = k.split('=');
      if (f[feat as LearnFeature] === val) y += v;
    }
    return { id: `r${i}`, hook: `hook ${i}`, posted_at: new Date(Date.UTC(2026, 0, 1) + i * 86400e3).toISOString(), log_score: y, virality: 2 ** y, f };
  });
}

/** A DB with `n` posted reels and one 72h snapshot each. */
export function seededDb(n: number, metrics: (i: number) => { reach: number; shares: number; saves: number; likes: number; comments: number; avg_watch_time_s?: number }, specFor?: (i: number) => Spec): DB {
  const db = openDb(':memory:');
  for (let i = 0; i < n; i++) {
    const base = specFor ? specFor(i) : exampleSpec();
    const spec = { ...base, id: `${base.id}-${i}` } as Spec;
    upsertReel(db, spec, 'rendered');
    const posted = new Date(Date.UTC(2026, 0, 1, 18) + i * 86400e3).toISOString();
    markPosted(db, spec.id, `ig${i}`, posted);
    const m = metrics(i);
    insertSnapshot(db, { reel_id: spec.id, captured_at: new Date(Date.parse(posted) + 72 * 3600e3).toISOString(), age_hours: 72, bucket: '72h', views: m.reach * 1.3, ...m, source: 'csv' });
  }
  return db;
}
