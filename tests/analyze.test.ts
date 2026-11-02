import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze, compare, evaluateHypothesis, evidenceLevel, extractFeatures, groupStats, regressionTree, ridgeModel, defaultLearnConfig, postSlot } from '../src/learn/analyze.ts';
import { runLearn } from '../src/learn/pipeline.ts';
import { renderPlaybook } from '../src/learn/playbook.ts';
import { upsertHypothesis } from '../src/db/index.ts';
import { exampleSpec, seededDb, synthObs, tmpDir } from './helpers.ts';
import type { Spec } from '../src/spec/schema.ts';

const cfg = defaultLearnConfig();
const TEMPLATES = ['chat', 'terminal', 'pov', 'stat', 'keynote'];

describe('grouped analysis', () => {
  it('detects a real effect with enough data', () => {
    // terminal reels are truly 1.8x more viral (+0.85 log2); 60 reels across 5 templates.
    const obs = synthObs(60, (i) => ({ template: TEMPLATES[i % 5] }), { 'template=terminal': 0.85 }, 0.5);
    const g = groupStats(obs, cfg).find((x) => x.feature === 'template' && x.value === 'terminal')!;
    expect(g.n).toBe(12);
    expect(g.verdict).toBe('better');
    expect(g.evidence).toBe('moderate');
    expect(g.lift).toBeGreaterThan(1.3);
    // Shrinkage pulls the estimate toward 0.
    expect(Math.abs(g.shrunk)).toBeLessThan(Math.abs(g.diff));
  });

  it('never turns a tiny group into a finding', () => {
    const obs = synthObs(20, (i) => ({ template: i < 2 ? 'keynote' : 'chat' }), { 'template=keynote': 2.5 }, 0.3);
    const g = groupStats(obs, cfg).find((x) => x.value === 'keynote')!;
    expect(g.n).toBe(2);
    expect(g.evidence).toBe('anecdote');
    expect(g.verdict).toBe('unclear');
  });

  it('mostly finds nothing when there is nothing (false-positive check)', () => {
    let positives = 0;
    let total = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const obs = synthObs(40, (i, r) => ({ template: TEMPLATES[i % 5], loop: r() < 0.5 ? 'yes' : 'no' }), {}, 0.6, seed);
      for (const g of groupStats(obs, cfg)) {
        total++;
        if (g.verdict !== 'unclear') positives++;
      }
    }
    expect(positives / total).toBeLessThan(0.1);
  });

  it('wide intervals for small samples, narrower for large', () => {
    const small = compare([1, 0.5, 1.5], [0, 0.2, -0.1, 0.1], 0.5, cfg);
    const big = compare(Array(40).fill(0).map((_, i) => 1 + ((i % 5) - 2) * 0.2), Array(40).fill(0).map((_, i) => ((i % 5) - 2) * 0.2), 0.5, cfg);
    expect(small.ci[1] - small.ci[0]).toBeGreaterThan(big.ci[1] - big.ci[0]);
  });

  it('evidence levels follow sample size', () => {
    expect(evidenceLevel(2, cfg)).toBe('anecdote');
    expect(evidenceLevel(5, cfg)).toBe('weak');
    expect(evidenceLevel(15, cfg)).toBe('moderate');
    expect(evidenceLevel(40, cfg)).toBe('solid');
  });

  it('extracts post slot / weekday from posting time in the configured timezone', () => {
    const f = extractFeatures({ template: 'chat', length_s: 8, loop: true, has_twist: false }, '2026-11-03T18:35:00Z', 'explore', 'Europe/Oslo');
    expect(f.post_slot).toBe('evening');
    expect(f.weekday).toBe('tue');
    expect(f.length).toBe('5-9s');
    expect(f.loop).toBe('yes');
    expect(postSlot(3)).toBe('night');
  });
});

describe('models (> 50 reels)', () => {
  it('switches to regression mode above the threshold', () => {
    expect(analyze(synthObs(30, (i) => ({ template: TEMPLATES[i % 5] }), {}), cfg).mode).toBe('grouped');
    expect(analyze(synthObs(80, (i) => ({ template: TEMPLATES[i % 5] }), {}), cfg).mode).toBe('model');
  });

  it('ridge regression separates correlated features', () => {
    // loop=yes truly helps; template=stat is correlated with loop but has no effect itself.
    const obs = synthObs(
      120,
      (i, r) => {
        const isStat = i % 3 === 0;
        const loop = isStat ? r() < 0.8 : r() < 0.3;
        return { template: isStat ? 'stat' : TEMPLATES[i % 5] === 'stat' ? 'chat' : TEMPLATES[i % 5], loop: loop ? 'yes' : 'no' };
      },
      { 'loop=yes': 0.8 },
      0.4,
      3,
    );
    const m = ridgeModel(obs, cfg)!;
    const loop = m.coefs.find((c) => c.feature === 'loop' && c.value === 'yes')!;
    const stat = m.coefs.find((c) => c.feature === 'template' && c.value === 'stat')!;
    expect(loop.coef).toBeGreaterThan(0.25);
    expect(loop.lo).toBeGreaterThan(0);
    expect(Math.abs(stat.coef)).toBeLessThan(loop.coef);
    expect(m.cvR2).toBeGreaterThan(0.2);
  });

  it('tree finds the strongest split', () => {
    const obs = synthObs(80, (i) => ({ template: TEMPLATES[i % 5] }), { 'template=pov': 1.2 }, 0.3);
    const t = regressionTree(obs);
    expect(t.children?.[0].rule).toBe('template = pov');
  });
});

describe('hypotheses', () => {
  it('stays open until enough test reels, then resolves', () => {
    const h = { id: 'template-stat', statement: 'stat beats median', feature: 'template', value: 'stat' };
    const few = synthObs(12, (i) => ({ template: i < 2 ? 'stat' : 'chat' }), { 'template=stat': 1 }, 0.3);
    expect(evaluateHypothesis(h, few, cfg).status).toBe('open');
    const many = synthObs(40, (i) => ({ template: i % 4 === 0 ? 'stat' : 'chat' }), { 'template=stat': 1 }, 0.3);
    expect(evaluateHypothesis(h, many, cfg).status).toBe('supported');
    const worse = synthObs(40, (i) => ({ template: i % 4 === 0 ? 'stat' : 'chat' }), { 'template=stat': -1 }, 0.3);
    expect(evaluateHypothesis(h, worse, cfg).status).toBe('refuted');
    const nothing = synthObs(60, (i) => ({ template: i % 4 === 0 ? 'stat' : 'chat' }), {}, 0.8, 9);
    expect(['inconclusive', 'open']).toContain(evaluateHypothesis(h, nothing, cfg).status);
  });
});

describe('learn pipeline (synthetic database)', () => {
  it('scores, writes report, dashboard, playbook and updates hypotheses', () => {
    const specFor = (i: number): Spec => (i % 2 === 0 ? exampleSpec('terminal-make-tests-pass') : exampleSpec('dialogue-honest-feedback'));
    // terminal reels (even) get 3x shares.
    const db = seededDb(24, (i) => ({ reach: 10000 + i * 500, shares: (i % 2 === 0 ? 300 : 100) + (i % 3) * 10, saves: 60, likes: 600, comments: 40, avg_watch_time_s: 9 }), specFor);
    upsertHypothesis(db, { id: 'template-terminal', statement: 'Terminal reels beat median', feature: 'template', value: 'terminal' });
    const dir = tmpDir();
    const res = runLearn({ db, date: '2026-11-02', outDirs: { reports: dir, playbook: path.join(dir, 'PLAYBOOK.md'), insights: path.join(dir, 'insights.json') } });
    expect(res.insights.n_scored).toBe(24);
    const g = res.insights.analysis.groups.find((x) => x.feature === 'template' && x.value === 'terminal')!;
    expect(g.verdict).toBe('better');
    const h = res.insights.hypotheses.find((x) => x.id === 'template-terminal')!;
    expect(h.status).toBe('supported');
    expect(fs.readFileSync(path.join(dir, '2026-11-02.md'), 'utf8')).toMatch(/Feature comparisons/);
    expect(fs.readFileSync(path.join(dir, 'dashboard.html'), 'utf8')).toMatch(/<svg/);
    const pb = fs.readFileSync(path.join(dir, 'PLAYBOOK.md'), 'utf8');
    expect(pb).toMatch(/## What works/);
    expect(pb).toMatch(/template = terminal/);
    expect(pb).toMatch(/\[PRIOR\]|\[DATA\]/);
  });

  it('bootstrap playbook (no data) is all priors and claims nothing', () => {
    const db = seededDb(0, () => ({ reach: 1, shares: 0, saves: 0, likes: 0, comments: 0 }));
    const dir = tmpDir();
    const res = runLearn({ db, date: '2026-11-02', outDirs: { reports: dir, playbook: path.join(dir, 'PLAYBOOK.md'), insights: path.join(dir, 'i.json') } });
    const pb = renderPlaybook(res.insights, '2026-11-02');
    expect(pb).toMatch(/bootstrap/);
    expect(pb).toMatch(/Nothing yet has enough evidence/);
    expect(pb).not.toMatch(/Established:|Likely:/);
    expect((pb.match(/\*\*\[PRIOR\]\*\*/g) ?? []).length).toBeGreaterThan(8);
  });

  it('with a handful of reels, uses cautious wording only', () => {
    const db = seededDb(5, (i) => ({ reach: 10000, shares: i === 0 ? 900 : 100, saves: 50, likes: 500, comments: 30, avg_watch_time_s: 8 }));
    const dir = tmpDir();
    const res = runLearn({ db, date: '2026-11-02', outDirs: { reports: dir, playbook: path.join(dir, 'P.md'), insights: path.join(dir, 'i.json') } });
    const pb = fs.readFileSync(path.join(dir, 'P.md'), 'utf8');
    expect(res.insights.analysis.mode).toBe('grouped');
    expect(pb).not.toMatch(/Established:/);
  });
});
