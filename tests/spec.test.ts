import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSpec, SpecError, specHash, specWarnings, textDensity, timelineFor } from '../src/spec/validate.ts';
import { TEMPLATE_IDS } from '../src/templates/defs.ts';
import { formatCaption, captionFile } from '../src/spec/caption.ts';
import { EXAMPLES, exampleSpec, rawExample } from './helpers.ts';

function issuesOf(input: unknown): string[] {
  try {
    parseSpec(input);
  } catch (e) {
    if (e instanceof SpecError) return e.issues;
    throw e;
  }
  return [];
}

describe('spec validation', () => {
  const files = fs.readdirSync(EXAMPLES).filter((f) => f.endsWith('.json'));

  it('has a valid example for every template', () => {
    const templates = new Set(files.map((f) => JSON.parse(fs.readFileSync(path.join(EXAMPLES, f), 'utf8')).template));
    for (const t of TEMPLATE_IDS) expect(templates.has(t), `example for ${t}`).toBe(true);
    for (const f of files) expect(() => parseSpec(JSON.parse(fs.readFileSync(path.join(EXAMPLES, f), 'utf8')), f)).not.toThrow();
  });

  it('fills derived learning features from the spec', () => {
    const s = exampleSpec('chat-one-typo');
    expect(s.features.template).toBe('chat');
    expect(s.features.length_s).toBe(s.duration_s);
    expect(s.features.loop).toBe(false);
    expect(['low', 'medium', 'high']).toContain(s.features.text_density);
  });

  it('rejects unknown templates with the list of valid ones', () => {
    const issues = issuesOf({ ...rawExample(), template: 'slideshow' });
    expect(issues[0]).toMatch(/not a template/);
    expect(issues[0]).toMatch(/chat/);
  });

  it('gives path-prefixed messages for bad fields', () => {
    const raw = rawExample();
    raw.hook = 'x'.repeat(120);
    raw.duration_s = 30;
    raw.data.messages[1].text = 'y'.repeat(300);
    raw.caption.variants[0].hashtags = ['#one'];
    const issues = issuesOf(raw);
    expect(issues.some((i) => i.startsWith('hook:') && /max 90/.test(i))).toBe(true);
    expect(issues.some((i) => i.startsWith('duration_s:') && /at most 20/.test(i))).toBe(true);
    expect(issues.some((i) => i.startsWith('data.messages[1].text:'))).toBe(true);
    expect(issues.some((i) => i.startsWith('caption.variants[0].hashtags:') && /3–5/.test(i))).toBe(true);
  });

  it('reports missing template data clearly', () => {
    const raw = rawExample();
    delete raw.data.messages;
    expect(issuesOf(raw).some((i) => i.startsWith('data.messages:'))).toBe(true);
  });

  it('validates enum features', () => {
    const raw = rawExample();
    raw.features.hook_type = 'clickbait';
    expect(issuesOf(raw).some((i) => i.startsWith('features.hook_type:'))).toBe(true);
  });

  it('normalises hashtags and topics', () => {
    const raw = rawExample();
    raw.caption.variants[0].hashtags = ['aicoding', '#claudecode', 'devhumor'];
    raw.features.topic = 'Coding Agents!';
    const s = parseSpec(raw);
    expect(s.caption.variants[0].hashtags).toEqual(['#aicoding', '#claudecode', '#devhumor']);
    expect(s.features.topic).toBe('coding-agents');
  });

  it('enforces 3–5 countdown beats', () => {
    const raw = rawExample('countdown-fix-a-bug');
    raw.data.items = raw.data.items.slice(0, 2);
    expect(issuesOf(raw).some((i) => /3–5 beats/.test(i))).toBe(true);
  });

  it('computes text density from words per second', () => {
    expect(textDensity({ duration_s: 10, text: ['one two three'] })).toBe('low');
    expect(textDensity({ duration_s: 10, text: [Array(40).fill('w').join(' ')] })).toBe('medium');
    expect(textDensity({ duration_s: 5, text: [Array(40).fill('w').join(' ')] })).toBe('high');
  });

  it('hash is stable and changes with content', () => {
    const a = exampleSpec();
    const b = exampleSpec();
    expect(specHash(a)).toBe(specHash(b));
    b.hook = 'different';
    expect(specHash(a)).not.toBe(specHash(b));
  });

  it('warns when a beat is too short to read', () => {
    const raw = rawExample();
    raw.duration_s = 5;
    expect(specWarnings(parseSpec(raw)).some((w) => /Increase duration_s/.test(w))).toBe(true);
  });

  it('formats captions with hook line, question and hashtags', () => {
    const s = exampleSpec();
    const c = formatCaption(s.caption.variants[0]);
    expect(c.split('\n\n')).toHaveLength(3);
    expect(c).toMatch(/#claudecode/);
    expect(captionFile(s)).toMatch(/other caption variants/);
  });
});

describe('timeline', () => {
  for (const name of fs.readdirSync(EXAMPLES).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''))) {
    it(`${name}: beats fit, hook in time`, () => {
      const s = exampleSpec(name);
      const tl = timelineFor(s);
      expect(tl.frames).toBe(Math.round(s.duration_s * 30));
      expect(tl.hookIn).toBeLessThanOrEqual(0.5);
      expect(tl.beats[0].at).toBeGreaterThan(0);
      const last = tl.beats[tl.beats.length - 1];
      expect(last.end).toBeLessThanOrEqual(tl.contentEnd + 1e-6);
      for (let i = 1; i < tl.beats.length; i++) expect(tl.beats[i].at).toBeGreaterThan(tl.beats[i - 1].at);
      if (s.loop) {
        expect(tl.hookIn).toBe(0);
        expect(tl.contentEnd).toBeCloseTo(s.duration_s - 0.6, 5);
      }
      expect(tl.coverAt).toBeLessThan(s.duration_s);
    });
  }

  it('scales with duration (5–20s)', () => {
    const raw = rawExample();
    for (const d of [5, 12, 20]) {
      raw.duration_s = d;
      const tl = timelineFor(parseSpec(raw));
      expect(tl.contentEnd).toBeCloseTo(d, 5);
      expect(tl.beats.at(-1)!.end).toBeCloseTo(d, 2);
    }
  });
});
