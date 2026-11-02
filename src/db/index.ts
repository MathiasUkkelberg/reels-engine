import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { paths } from '../paths.ts';
import type { Spec } from '../spec/schema.ts';

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reels (
  id TEXT PRIMARY KEY,
  template TEXT NOT NULL,
  hook TEXT NOT NULL,
  premise TEXT,
  spec_json TEXT NOT NULL,
  features_json TEXT NOT NULL,
  arm TEXT NOT NULL DEFAULT 'exploit',
  hypothesis_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',     -- pending | rendered | posted | failed | archived
  source TEXT,
  duration_s REAL,
  caption_variant INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  rendered_at TEXT,
  posted_at TEXT,
  ig_media_id TEXT,
  permalink TEXT
);
CREATE INDEX IF NOT EXISTS reels_status ON reels(status);

-- Insight time series: one row per snapshot. bucket = the snapshot age it satisfies (1h/24h/72h/168h).
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reel_id TEXT NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
  captured_at TEXT NOT NULL,
  age_hours REAL NOT NULL,
  bucket TEXT,
  views INTEGER,
  reach INTEGER,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  saves INTEGER,
  total_interactions INTEGER,
  reposts INTEGER,
  avg_watch_time_s REAL,
  total_watch_time_s REAL,
  skip_rate REAL,
  follows INTEGER,
  source TEXT NOT NULL DEFAULT 'api',
  raw_json TEXT
);
CREATE INDEX IF NOT EXISTS snapshots_reel ON snapshots(reel_id, age_hours);

CREATE TABLE IF NOT EXISTS hypotheses (
  id TEXT PRIMARY KEY,
  statement TEXT NOT NULL,
  feature TEXT,
  value TEXT,
  status TEXT NOT NULL DEFAULT 'open',        -- open | supported | refuted | inconclusive
  n_test INTEGER NOT NULL DEFAULT 0,
  effect REAL,
  ci_low REAL,
  ci_high REAL,
  evidence TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reel_id TEXT NOT NULL UNIQUE REFERENCES reels(id) ON DELETE CASCADE,
  scheduled_for TEXT NOT NULL,               -- ISO UTC
  status TEXT NOT NULL DEFAULT 'queued',      -- queued | published | failed | skipped
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  published_at TEXT
);

-- Every idea ever generated (accepted or rejected), for de-duplication.
CREATE TABLE IF NOT EXISTS ideas (
  fingerprint TEXT PRIMARY KEY,
  reel_id TEXT,
  hook TEXT NOT NULL,
  premise TEXT,
  text TEXT NOT NULL,
  status TEXT NOT NULL,                       -- accepted | rejected
  reason TEXT,
  scores_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_snapshots (
  captured_at TEXT PRIMARY KEY,
  followers INTEGER,
  media_count INTEGER
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  started_at TEXT NOT NULL,
  summary TEXT
);
`;

let shared: DB | null = null;

export function openDb(file = paths.db): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

/** Process-wide connection to data/reels.db. */
export function getDb(): DB {
  if (!shared) shared = openDb();
  return shared;
}

export const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------------------------
// Reels

export interface ReelRow {
  id: string;
  template: string;
  hook: string;
  premise: string | null;
  spec_json: string;
  features_json: string;
  arm: string;
  hypothesis_id: string | null;
  status: string;
  source: string | null;
  duration_s: number | null;
  caption_variant: number;
  created_at: string;
  rendered_at: string | null;
  posted_at: string | null;
  ig_media_id: string | null;
  permalink: string | null;
}

/** Insert or update a reel from its spec (keeps status/posting fields). */
export function upsertReel(db: DB, spec: Spec, status?: string): void {
  const existing = db.prepare('SELECT status FROM reels WHERE id = ?').get(spec.id) as { status: string } | undefined;
  const row = {
    id: spec.id,
    template: spec.template,
    hook: spec.hook,
    premise: spec.premise ?? null,
    spec_json: JSON.stringify(spec),
    features_json: JSON.stringify(spec.features),
    arm: spec.experiment.arm,
    hypothesis_id: spec.experiment.hypothesis_id ?? null,
    source: spec.source,
    duration_s: spec.duration_s,
    caption_variant: spec.caption.selected,
    created_at: spec.created_at ?? nowIso(),
  };
  if (existing) {
    db.prepare(
      `UPDATE reels SET template=@template, hook=@hook, premise=@premise, spec_json=@spec_json, features_json=@features_json,
       arm=@arm, hypothesis_id=@hypothesis_id, source=@source, duration_s=@duration_s, caption_variant=@caption_variant WHERE id=@id`,
    ).run(row);
    if (status) db.prepare('UPDATE reels SET status = ? WHERE id = ?').run(status, spec.id);
  } else {
    db.prepare(
      `INSERT INTO reels (id, template, hook, premise, spec_json, features_json, arm, hypothesis_id, status, source, duration_s, caption_variant, created_at)
       VALUES (@id, @template, @hook, @premise, @spec_json, @features_json, @arm, @hypothesis_id, @status, @source, @duration_s, @caption_variant, @created_at)`,
    ).run({ ...row, status: status ?? 'pending' });
  }
}

export function getReel(db: DB, id: string): ReelRow | undefined {
  return db.prepare('SELECT * FROM reels WHERE id = ?').get(id) as ReelRow | undefined;
}

export function markRendered(db: DB, id: string): void {
  db.prepare(`UPDATE reels SET status = CASE WHEN status IN ('posted') THEN status ELSE 'rendered' END, rendered_at = ? WHERE id = ?`).run(nowIso(), id);
}

export function markPosted(db: DB, id: string, igMediaId: string | null, postedAt = nowIso(), permalink: string | null = null): void {
  const r = db
    .prepare(`UPDATE reels SET status = 'posted', posted_at = ?, ig_media_id = COALESCE(?, ig_media_id), permalink = COALESCE(?, permalink) WHERE id = ?`)
    .run(postedAt, igMediaId, permalink, id);
  if (r.changes === 0) throw new Error(`Unknown reel id "${id}". Render it first (npm run render) or check the id.`);
  db.prepare(`UPDATE schedule SET status = 'published', published_at = ? WHERE reel_id = ?`).run(postedAt, id);
}

export function postedReels(db: DB): ReelRow[] {
  return db.prepare(`SELECT * FROM reels WHERE status = 'posted' AND posted_at IS NOT NULL ORDER BY posted_at`).all() as ReelRow[];
}

// ---------------------------------------------------------------------------------------------
// Snapshots

export interface Snapshot {
  reel_id: string;
  captured_at: string;
  age_hours: number;
  bucket?: string | null;
  views?: number | null;
  reach?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
  total_interactions?: number | null;
  reposts?: number | null;
  avg_watch_time_s?: number | null;
  total_watch_time_s?: number | null;
  skip_rate?: number | null;
  follows?: number | null;
  source?: string;
  raw_json?: string | null;
}

const SNAP_COLS = [
  'reel_id', 'captured_at', 'age_hours', 'bucket', 'views', 'reach', 'likes', 'comments', 'shares', 'saves',
  'total_interactions', 'reposts', 'avg_watch_time_s', 'total_watch_time_s', 'skip_rate', 'follows', 'source', 'raw_json',
] as const;

export function insertSnapshot(db: DB, s: Snapshot): void {
  const row: Record<string, unknown> = {};
  for (const c of SNAP_COLS) row[c] = (s as unknown as Record<string, unknown>)[c] ?? null;
  row.source = s.source ?? 'api';
  // One snapshot per (reel, bucket): a newer one for the same bucket replaces the old.
  if (row.bucket) db.prepare('DELETE FROM snapshots WHERE reel_id = ? AND bucket = ?').run(row.reel_id, row.bucket);
  db.prepare(`INSERT INTO snapshots (${SNAP_COLS.join(',')}) VALUES (${SNAP_COLS.map((c) => '@' + c).join(',')})`).run(row);
}

export function snapshotsFor(db: DB, reelId: string): Required<Snapshot>[] {
  return db.prepare('SELECT * FROM snapshots WHERE reel_id = ? ORDER BY age_hours').all(reelId) as Required<Snapshot>[];
}

/** The configured snapshot age (h) this age satisfies, e.g. 30h → "24h". */
export function bucketFor(ageHours: number, ages: readonly number[]): string | null {
  let best: number | null = null;
  for (const a of ages) if (ageHours >= a * 0.9) best = a;
  return best === null ? null : `${best}h`;
}

// ---------------------------------------------------------------------------------------------
// Hypotheses

export interface HypothesisRow {
  id: string;
  statement: string;
  feature: string | null;
  value: string | null;
  status: string;
  n_test: number;
  effect: number | null;
  ci_low: number | null;
  ci_high: number | null;
  evidence: string | null;
  created_at: string;
  updated_at: string;
}

export function upsertHypothesis(db: DB, h: Pick<HypothesisRow, 'id' | 'statement'> & Partial<HypothesisRow>): void {
  const now = nowIso();
  db.prepare(
    `INSERT INTO hypotheses (id, statement, feature, value, status, created_at, updated_at)
     VALUES (@id, @statement, @feature, @value, COALESCE(@status, 'open'), @now, @now)
     ON CONFLICT(id) DO UPDATE SET statement = excluded.statement,
       feature = COALESCE(excluded.feature, hypotheses.feature), value = COALESCE(excluded.value, hypotheses.value), updated_at = @now`,
  ).run({ id: h.id, statement: h.statement, feature: h.feature ?? null, value: h.value ?? null, status: h.status ?? null, now });
}

export function listHypotheses(db: DB): HypothesisRow[] {
  return db.prepare('SELECT * FROM hypotheses ORDER BY created_at').all() as HypothesisRow[];
}

// ---------------------------------------------------------------------------------------------
// Ideas (dedupe history)

export function recordIdea(
  db: DB,
  i: { fingerprint: string; reel_id?: string | null; hook: string; premise?: string | null; text: string; status: 'accepted' | 'rejected'; reason?: string | null; scores?: unknown },
): void {
  db.prepare(
    `INSERT OR REPLACE INTO ideas (fingerprint, reel_id, hook, premise, text, status, reason, scores_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(i.fingerprint, i.reel_id ?? null, i.hook, i.premise ?? null, i.text, i.status, i.reason ?? null, i.scores ? JSON.stringify(i.scores) : null, nowIso());
}

export function ideaHistory(db: DB): Array<{ hook: string; text: string; status: string }> {
  return db.prepare('SELECT hook, text, status FROM ideas ORDER BY created_at').all() as Array<{ hook: string; text: string; status: string }>;
}

export function logRun(db: DB, kind: string, summary: unknown): void {
  db.prepare('INSERT INTO runs (kind, started_at, summary) VALUES (?, ?, ?)').run(kind, nowIso(), JSON.stringify(summary));
}
