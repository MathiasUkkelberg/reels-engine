/** Posting queue in SQLite: 1–3 reels/day at configured local times. */
import { config } from '../../reels.config.ts';
import type { DB } from '../db/index.ts';

/** Offset (ms) of `timeZone` from UTC at `date`. */
export function tzOffsetMs(date: Date, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((asUtc - date.getTime()) / 60000) * 60000;
}

/** Local wall-clock time in `timeZone` → UTC Date (DST-safe). */
export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off = tzOffsetMs(new Date(guess), timeZone);
  let utc = guess - off;
  const off2 = tzOffsetMs(new Date(utc), timeZone);
  if (off2 !== off) utc = guess - off2;
  return new Date(utc);
}

export function localDate(date: Date, timeZone: string): { y: number; m: number; d: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
}

export interface ScheduleOptions {
  timezone: string;
  postsPerDay: number;
  slots: readonly string[];
  horizonDays: number;
}

export interface SlotTime {
  at: Date;
  local: string;
}

/** Upcoming posting slots from `now` over `horizonDays`. */
export function upcomingSlots(now: Date, opts: ScheduleOptions = config.schedule): SlotTime[] {
  const times = opts.slots.slice(0, Math.max(1, Math.min(3, opts.postsPerDay)));
  const out: SlotTime[] = [];
  const start = localDate(now, opts.timezone);
  for (let k = 0; k < opts.horizonDays; k++) {
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + k));
    for (const t of times) {
      const [hh, mm] = t.split(':').map(Number);
      const at = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm, opts.timezone);
      if (at.getTime() > now.getTime()) out.push({ at, local: `${day.toISOString().slice(0, 10)} ${t}` });
    }
  }
  return out;
}

export interface QueueItem {
  reel_id: string;
  scheduled_for: string;
  status: string;
  hook?: string;
  attempts?: number;
  last_error?: string | null;
}

/**
 * Put rendered, unposted reels into free slots. Reels whose planned_post_time matches a slot's time get
 * that slot first; otherwise first come, first served. Returns newly queued items.
 */
export function planQueue(db: DB, now = new Date(), opts: ScheduleOptions = config.schedule): QueueItem[] {
  const taken = new Set((db.prepare(`SELECT scheduled_for FROM schedule WHERE status IN ('queued','published')`).all() as Array<{ scheduled_for: string }>).map((r) => r.scheduled_for));
  const free = upcomingSlots(now, opts).filter((s) => !taken.has(s.at.toISOString()));
  const waiting = db
    .prepare(`SELECT id, hook, features_json FROM reels WHERE status = 'rendered' AND id NOT IN (SELECT reel_id FROM schedule) ORDER BY created_at, id`)
    .all() as Array<{ id: string; hook: string; features_json: string }>;
  const added: QueueItem[] = [];
  const insert = db.prepare(`INSERT INTO schedule (reel_id, scheduled_for, status) VALUES (?, ?, 'queued')`);
  for (const r of waiting) {
    if (!free.length) break;
    const planned = (JSON.parse(r.features_json).planned_post_time as string | null) ?? null;
    let idx = planned ? free.findIndex((s) => s.local.endsWith(planned)) : -1;
    // Don't push a reel more than a day later just to match its planned time.
    if (idx > 0 && free[idx].at.getTime() - free[0].at.getTime() > 24 * 3600e3) idx = -1;
    const slot = free.splice(idx >= 0 ? idx : 0, 1)[0];
    insert.run(r.id, slot.at.toISOString());
    added.push({ reel_id: r.id, scheduled_for: slot.at.toISOString(), status: 'queued', hook: r.hook });
  }
  return added;
}

export function queue(db: DB): QueueItem[] {
  return db
    .prepare(`SELECT s.reel_id, s.scheduled_for, s.status, s.attempts, s.last_error, r.hook FROM schedule s JOIN reels r ON r.id = s.reel_id ORDER BY s.scheduled_for`)
    .all() as QueueItem[];
}

export function dueItems(db: DB, now = new Date()): QueueItem[] {
  return queue(db).filter((q) => q.status === 'queued' && q.scheduled_for <= now.toISOString());
}
