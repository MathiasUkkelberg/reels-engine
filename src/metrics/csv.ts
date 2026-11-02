/** Manual metrics entry (before the API is set up): CSV → snapshots. */
import { config } from '../../reels.config.ts';
import { bucketFor, getReel, insertSnapshot, markPosted, type DB } from '../db/index.ts';

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, commas/newlines in quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === ';' || c === '\t') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const ALIASES: Record<string, string[]> = {
  reel_id: ['reel_id', 'id', 'reel', 'spec_id'],
  ig_media_id: ['ig_media_id', 'media_id', 'instagram_media_id'],
  posted_at: ['posted_at', 'publish_time', 'published_at'],
  captured_at: ['captured_at', 'date', 'snapshot_at'],
  age_hours: ['age_hours', 'age_h', 'hours_since_post'],
  views: ['views', 'plays'],
  reach: ['reach', 'accounts_reached'],
  likes: ['likes'],
  comments: ['comments'],
  shares: ['shares', 'sends'],
  saves: ['saves', 'saved'],
  total_interactions: ['total_interactions', 'interactions'],
  avg_watch_time_s: ['avg_watch_time_s', 'avg_watch_time', 'average_watch_time'],
  follows: ['follows', 'new_followers'],
};

export interface CsvImportResult {
  imported: number;
  errors: string[];
}

function num(v: string | undefined): number | null {
  if (v === undefined) return null;
  const s = v.trim().replace(/[\s,_]/g, '').replace(/s$/i, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function importCsv(db: DB, text: string, now = new Date()): CsvImportResult {
  const rows = parseCsv(text);
  if (rows.length < 2) return { imported: 0, errors: ['CSV has no data rows'] };
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'));
  const col: Record<string, number> = {};
  for (const [key, names] of Object.entries(ALIASES)) {
    const idx = header.findIndex((h) => names.includes(h));
    if (idx >= 0) col[key] = idx;
  }
  if (col.reel_id === undefined && col.ig_media_id === undefined) return { imported: 0, errors: ['CSV needs a reel_id or ig_media_id column'] };
  const res: CsvImportResult = { imported: 0, errors: [] };
  rows.slice(1).forEach((r, k) => {
    const line = k + 2;
    const get = (key: string) => (col[key] !== undefined ? r[col[key]]?.trim() : undefined);
    let id = get('reel_id');
    const media = get('ig_media_id');
    if (!id && media) id = (db.prepare('SELECT id FROM reels WHERE ig_media_id = ?').get(media) as { id: string } | undefined)?.id;
    if (!id || !getReel(db, id)) return res.errors.push(`line ${line}: unknown reel "${id ?? media}" (render/import the spec first)`);
    let reel = getReel(db, id)!;
    const postedAt = get('posted_at');
    if (postedAt && reel.status !== 'posted') {
      markPosted(db, id, media || null, new Date(postedAt).toISOString());
      reel = getReel(db, id)!;
    }
    if (!reel.posted_at) return res.errors.push(`line ${line}: "${id}" isn't marked as posted; add a posted_at column or run npm run mark-posted`);
    const capturedAt = get('captured_at') ? new Date(get('captured_at') as string) : now;
    if (Number.isNaN(capturedAt.getTime())) return res.errors.push(`line ${line}: bad captured_at`);
    const age = num(get('age_hours')) ?? (capturedAt.getTime() - new Date(reel.posted_at).getTime()) / 3600e3;
    if (age < 0) return res.errors.push(`line ${line}: snapshot is before posted_at`);
    insertSnapshot(db, {
      reel_id: id,
      captured_at: capturedAt.toISOString(),
      age_hours: Math.round(age * 10) / 10,
      bucket: bucketFor(age, config.metrics.snapshotAgesHours),
      views: num(get('views')),
      reach: num(get('reach')),
      likes: num(get('likes')),
      comments: num(get('comments')),
      shares: num(get('shares')),
      saves: num(get('saves')),
      total_interactions: num(get('total_interactions')),
      avg_watch_time_s: num(get('avg_watch_time_s')),
      follows: num(get('follows')),
      source: 'csv',
    });
    res.imported++;
  });
  return res;
}
