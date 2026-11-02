/**
 * npm run learn: score posted reels → analyze features → update hypotheses →
 * write data/insights.json, reports/<date>.md, reports/dashboard.html and PLAYBOOK.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../reels.config.ts';
import { paths } from '../paths.ts';
import { getDb, listHypotheses, postedReels, snapshotsFor, type DB, logRun } from '../db/index.ts';
import { pickSnapshot, scoreReels, type MetricInput, type ScoredReel } from './score.ts';
import { analyze, evaluateHypothesis, extractFeatures, type Analysis, type HypothesisResult, type Observation } from './analyze.ts';
import { renderReport } from './report.ts';
import { renderPlaybook } from './playbook.ts';
import { renderDashboard } from './dashboard.ts';

export interface Insights {
  generated_at: string;
  n_posted: number;
  n_scored: number;
  n_too_young: number;
  followers: number | null;
  analysis: Analysis;
  scored: Array<ScoredReel & { hook: string; template: string; f: Observation['f'] }>;
  hypotheses: Array<HypothesisResult & { statement: string; feature: string | null; value: string | null }>;
}

export interface LearnData {
  observations: Observation[];
  scored: Insights['scored'];
  nPosted: number;
  nTooYoung: number;
}

/** Build observations (one per posted reel with a mature snapshot) from the database. */
export function collect(db: DB): LearnData {
  const reels = postedReels(db);
  const inputs: MetricInput[] = [];
  let tooYoung = 0;
  for (const r of reels) {
    const snap = pickSnapshot(snapshotsFor(db, r.id));
    if (!snap) {
      tooYoung++;
      continue;
    }
    inputs.push({
      id: r.id,
      posted_at: r.posted_at as string,
      duration_s: r.duration_s ?? 10,
      age_hours: snap.age_hours,
      reach: snap.reach,
      views: snap.views,
      likes: snap.likes,
      comments: snap.comments,
      shares: snap.shares,
      saves: snap.saves,
      avg_watch_time_s: snap.avg_watch_time_s,
    });
  }
  const scored = scoreReels(inputs);
  const byId = new Map(reels.map((r) => [r.id, r]));
  const observations: Observation[] = [];
  const scoredOut: Insights['scored'] = [];
  for (const s of scored) {
    const r = byId.get(s.id)!;
    const f = extractFeatures(JSON.parse(r.features_json), r.posted_at, r.arm);
    observations.push({ id: s.id, hook: r.hook, posted_at: s.posted_at, log_score: s.log_score, virality: s.virality, hypothesis_id: r.hypothesis_id, f });
    scoredOut.push({ ...s, hook: r.hook, template: r.template, f });
  }
  return { observations, scored: scoredOut, nPosted: reels.length, nTooYoung: tooYoung };
}

export function latestFollowers(db: DB): number | null {
  const row = db.prepare('SELECT followers FROM account_snapshots ORDER BY captured_at DESC LIMIT 1').get() as { followers: number } | undefined;
  return row?.followers ?? null;
}

export interface LearnResult {
  insights: Insights;
  reportPath: string;
  dashboardPath: string;
  playbookPath: string;
}

export function runLearn(opts: { db?: DB; date?: string; outDirs?: { reports: string; playbook: string; insights: string } } = {}): LearnResult {
  const db = opts.db ?? getDb();
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const out = opts.outDirs ?? { reports: paths.reports, playbook: paths.playbook, insights: paths.insights };
  const data = collect(db);
  const analysis = analyze(data.observations);

  // Hypotheses: evaluate and persist status.
  const hyps = listHypotheses(db).map((h) => {
    const r = evaluateHypothesis(h, data.observations);
    db.prepare(
      'UPDATE hypotheses SET status = ?, n_test = ?, effect = ?, ci_low = ?, ci_high = ?, evidence = ?, updated_at = ? WHERE id = ?',
    ).run(r.status, r.n_test, r.effect, r.ci_low, r.ci_high, r.evidence, new Date().toISOString(), h.id);
    return { ...r, statement: h.statement, feature: h.feature, value: h.value };
  });

  const insights: Insights = {
    generated_at: new Date().toISOString(),
    n_posted: data.nPosted,
    n_scored: data.observations.length,
    n_too_young: data.nTooYoung,
    followers: latestFollowers(db),
    analysis,
    scored: data.scored,
    hypotheses: hyps,
  };

  fs.mkdirSync(out.reports, { recursive: true });
  fs.mkdirSync(path.dirname(out.insights), { recursive: true });
  fs.writeFileSync(out.insights, JSON.stringify(insights, null, 2));
  const reportPath = path.join(out.reports, `${date}.md`);
  fs.writeFileSync(reportPath, renderReport(insights, date));
  const dashboardPath = path.join(out.reports, 'dashboard.html');
  fs.writeFileSync(dashboardPath, renderDashboard(insights, date));
  fs.writeFileSync(out.playbook, renderPlaybook(insights, date));
  logRun(db, 'learn', { n_scored: insights.n_scored, mode: analysis.mode });
  return { insights, reportPath, dashboardPath, playbookPath: out.playbook };
}

export function loadInsights(file = paths.insights): Insights | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Insights;
  } catch {
    return null;
  }
}

export const goal = config.brand.goalFollowers;
