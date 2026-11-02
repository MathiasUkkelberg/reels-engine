import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/index.ts';
import { processIdeas, generateIdeas, criticScore, passesCritic, type Review } from '../src/ideas/generate.ts';
import { planBatch } from '../src/ideas/plan.ts';
import { similarity, closestMatch } from '../src/ideas/dedupe.ts';
import { extractJson, type LLM } from '../src/ideas/llm.ts';
import { pastePrompt } from '../src/ideas/prompts.ts';
import { rawExample } from './helpers.ts';

const good = (k: number): Review => ({ index: k, scores: { hook: 8, relatability: 8, shareability: 8, clarity_without_sound: 8, loopability: 7 }, reason: 'strong' });
const bad = (k: number): Review => ({ index: k, scores: { hook: 4, relatability: 5, shareability: 4, clarity_without_sound: 7, loopability: 3 }, reason: 'generic' });

function freshIdea(hook: string, punch: string) {
  const raw = rawExample('chat-one-typo');
  delete raw.id;
  raw.hook = hook;
  raw.data.messages = [
    { from: 'user', text: 'can you rename this variable' },
    { from: 'ai', text: punch },
  ];
  return raw;
}

describe('dedupe', () => {
  it('scores near-duplicates high and unrelated ideas low', () => {
    expect(similarity('asked the AI to fix *one* typo', 'asked AI to fix one typo pls')).toBeGreaterThan(0.6);
    expect(similarity('asked the AI to fix one typo', 'my phone after letting the agent run overnight')).toBeLessThan(0.2);
    expect(closestMatch({ hook: 'AI phrases ranked by how scared you should be', text: '' }, [{ hook: 'ranking AI phrases by how scared you should be', text: '' }])!.score).toBeGreaterThan(0.55);
  });
});

describe('critic', () => {
  it('weights criteria and enforces threshold + floor', () => {
    expect(criticScore(good(0))).toBeGreaterThan(7.5);
    expect(passesCritic(good(0)).ok).toBe(true);
    expect(passesCritic(bad(0)).ok).toBe(false);
    const oneWeak = { ...good(0), scores: { ...good(0).scores, clarity_without_sound: 3 } };
    expect(passesCritic(oneWeak).ok).toBe(false);
    expect(passesCritic(oneWeak).why).toMatch(/clarity_without_sound/);
  });
});

describe('batch planning', () => {
  it('splits ~70/30 exploit/explore and gives every experiment a hypothesis', () => {
    const slots = planBatch(20, null, 1);
    expect(slots.filter((s) => s.arm === 'exploit')).toHaveLength(14);
    const explore = slots.filter((s) => s.arm === 'explore');
    expect(explore).toHaveLength(6);
    for (const s of explore) expect(s.hypothesis?.statement).toBeTruthy();
    expect(new Set(explore.map((s) => s.hypothesis!.id)).size).toBe(6);
  });
});

describe('idea pipeline', () => {
  it('accepts good ideas, rejects invalid / duplicate / weak ones with reasons', async () => {
    const db = openDb(':memory:');
    const slots = planBatch(5, null, 2);
    const ideas = [
      freshIdea('asked the AI to rename *one* variable', 'Done! I also renamed you. You are now "user_final_v2".'),
      { template: 'chat', hook: 'broken' }, // invalid
      rawExample('chat-one-typo'), // duplicate of an example
      freshIdea('my agent explaining its *refactor*', 'I moved every function into one 9,000-line file for readability.'),
      freshIdea('when the AI says *trust me*', 'Trust me, deleting node_modules in production is a best practice.'),
    ];
    const reviews = [good(0), good(1), good(2), bad(3), good(4)];
    const res = await processIdeas({ db, rawIdeas: ideas, slots, reviews, source: 'import', keep: 5, dryRun: true });
    const reasons = res.rejected.map((r) => r.reason);
    expect(res.accepted.map((a) => a.spec.hook)).toEqual(expect.arrayContaining(['asked the AI to rename *one* variable', 'when the AI says *trust me*']));
    expect(reasons.some((r) => r === 'invalid spec')).toBe(true);
    expect(reasons.some((r) => r.startsWith('duplicate'))).toBe(true);
    expect(reasons.some((r) => r.startsWith('critic score'))).toBe(true);
    const inv = res.rejected.find((r) => r.reason === 'invalid spec')!;
    expect(inv.issues!.some((i) => i.startsWith('data'))).toBe(true);
    // ids, planned time and arm are filled in
    for (const a of res.accepted) {
      expect(a.spec.id).toMatch(/^\d{8}-chat-/);
      expect(a.spec.features.planned_post_time).toMatch(/^\d\d:\d\d$/);
      expect(['exploit', 'explore']).toContain(a.spec.experiment.arm);
    }
  });

  it('runs end to end with a mocked LLM (generate → repair → critic)', async () => {
    const db = openDb(':memory:');
    const calls: string[] = [];
    const llm: LLM = {
      async complete({ prompt }) {
        if (prompt.includes('failed validation')) {
          calls.push('repair');
          return JSON.stringify({ ideas: [freshIdea('the AI *fixed* my CSS', 'Centered the div. Uncentered your life.')] });
        }
        if (prompt.includes('Score each reel idea')) {
          calls.push('critic');
          const n = (prompt.match(/^\[\d+\]/gm) ?? []).length;
          return '```json\n' + JSON.stringify({ reviews: Array.from({ length: n }, (_, k) => good(k)) }) + '\n```';
        }
        calls.push('generate');
        expect(prompt).toContain('PLAYBOOK');
        expect(prompt).toContain('ALREADY DONE');
        return JSON.stringify({
          ideas: [
            freshIdea('the AI when I say *quick question*', 'Before I answer: a 14-section framework.'),
            { ...freshIdea('x', 'y'), duration_s: 99 },
          ],
        });
      },
    };
    const res = await generateIdeas({ count: 2, llm, db, dryRun: true, seed: 3 });
    expect(calls).toEqual(['generate', 'repair', 'critic']);
    expect(res.accepted).toHaveLength(2);
  });

  it('paste prompt contains generator + critic instructions', () => {
    const p = pastePrompt({ playbook: '# PLAYBOOK', history: ['old idea'], slots: planBatch(3, null, 1) });
    expect(p).toContain('"reviews"');
    expect(p).toContain('old idea');
    expect(p).toContain('Slot 1');
  });
});

describe('extractJson', () => {
  it('handles fenced and prose-wrapped JSON', () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('blah {"ideas":[]} blah')).toEqual({ ideas: [] });
    expect(() => extractJson('nothing')).toThrow();
  });
});
