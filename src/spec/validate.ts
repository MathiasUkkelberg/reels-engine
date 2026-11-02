import fs from 'node:fs';
import crypto from 'node:crypto';
import type { z } from 'zod';
import { SpecSchema, type Spec } from './schema.ts';
import { TEMPLATES, TEMPLATE_IDS } from '../templates/defs.ts';
import { computeTimeline, type Timeline } from './timing.ts';
import { config } from '../../reels.config.ts';

export class SpecError extends Error {
  constructor(
    message: string,
    public issues: string[],
  ) {
    super(message);
    this.name = 'SpecError';
  }
}

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((iss) => {
    const where = iss.path.length ? iss.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join('').replace(/^\./, '') : '(root)';
    let msg = iss.message;
    if (iss.code === 'invalid_union' && iss.path.length === 0) msg = `Unknown template. Use one of: ${TEMPLATE_IDS.join(', ')}`;
    return `${where}: ${msg}`;
  });
}

/** Parse + normalise a spec. Throws SpecError with readable, path-prefixed messages. */
export function parseSpec(input: unknown, label = 'spec'): Spec {
  const raw = input as Record<string, unknown> | null;
  if (raw && typeof raw === 'object' && typeof raw.template === 'string' && !TEMPLATE_IDS.includes(raw.template as never)) {
    throw new SpecError(`${label} is invalid`, [`template: "${raw.template}" is not a template. Use one of: ${TEMPLATE_IDS.join(', ')}`]);
  }
  const res = SpecSchema.safeParse(input);
  if (!res.success) {
    throw new SpecError(`${label} is invalid`, formatIssues(res.error));
  }
  return normalizeSpec(res.data as Spec);
}

export function loadSpecFile(file: string): Spec {
  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new SpecError(`${file} is not valid JSON`, [(err as Error).message]);
  }
  return parseSpec(json, file);
}

/** All on-screen text of a spec (hook included). */
export function specText(spec: Spec): string[] {
  const t = TEMPLATES[spec.template] as { text(d: unknown): string[] };
  return [spec.hook, ...t.text(spec.data)];
}

/** Words per second of on-screen text → low / medium / high. */
export function textDensity(spec: Pick<Spec, 'duration_s'> & { text: string[] }): 'low' | 'medium' | 'high' {
  const words = spec.text.join(' ').split(/\s+/).filter(Boolean).length;
  const wps = words / spec.duration_s;
  if (wps < 3) return 'low';
  if (wps < 4.5) return 'medium';
  return 'high';
}

/** Fill derived learning features so they always agree with the spec. */
export function normalizeSpec(spec: Spec): Spec {
  const text = specText(spec);
  spec.features = {
    ...spec.features,
    template: spec.template,
    length_s: spec.duration_s,
    loop: spec.loop,
    text_density: textDensity({ duration_s: spec.duration_s, text }),
  };
  if (spec.caption.selected >= spec.caption.variants.length) spec.caption.selected = 0;
  return spec;
}

export function beatWeights(spec: Spec): number[] {
  const t = TEMPLATES[spec.template] as { beats(d: unknown): number[] };
  return t.beats(spec.data);
}

export function timelineFor(spec: Spec): Timeline {
  return computeTimeline({
    duration: spec.duration_s,
    fps: config.render.fps,
    loop: spec.loop,
    weights: beatWeights(spec),
    coverAt: spec.cover_at_s,
  });
}

/**
 * Soft checks: things that render fine but will probably perform worse.
 * Returned as human-readable warnings (never thrown).
 */
export function specWarnings(spec: Spec): string[] {
  const warnings: string[] = [];
  const tl = timelineFor(spec);
  const weights = beatWeights(spec);
  const texts = beatTexts(spec);
  tl.beats.forEach((b, i) => {
    const chars = texts[i]?.length ?? 0;
    // ~20 characters/second is a brisk but comfortable reading speed for short on-screen lines,
    // plus 0.3s to notice the change. Earlier beats stay on screen, so a little under is fine.
    const needed = chars / 20 + 0.3;
    if (chars > 0 && b.dur < needed * 0.75) {
      warnings.push(
        `beat ${i + 1} gets ${b.dur.toFixed(1)}s for ${chars} characters (needs ~${needed.toFixed(1)}s). Increase duration_s or cut text.`,
      );
    }
  });
  if (spec.hook.length > 60) warnings.push(`hook is ${spec.hook.length} characters; under 60 reads faster in the first second.`);
  if (spec.features.text_density === 'high') warnings.push('text density is high; consider cutting words or adding a second.');
  if (weights.length > 9) warnings.push(`${weights.length} beats is a lot for one reel.`);
  return warnings;
}

/** Text per beat, used for the reading-time check. */
function beatTexts(spec: Spec): string[] {
  const d = spec.data as Record<string, any>;
  switch (spec.template) {
    case 'chat':
      return d.messages.map((m: any) => m.text);
    case 'pov':
      return [...d.beats.map((b: any) => b.screen), ...(d.caption_end ? [d.caption_end] : [])];
    case 'terminal':
      return [...d.lines.map((l: any) => l.text), ...(d.final ? [d.final] : [])];
    case 'expectation_reality':
      return [[d.expectation.text, ...d.expectation.items].join(' '), d.reality.text, ...d.reality.items];
    case 'tier_list':
      return [...d.items.map((i: any) => i.text), ...(d.twist ? [d.twist.text] : [])];
    case 'nobody':
      return [...d.setup, d.actor, ...d.punchline];
    case 'notifications':
      return d.items.map((n: any) => `${n.title} ${n.body}`);
    case 'countdown':
      return d.items.map((i: any) => `${i.text} ${i.sub ?? ''}`.trim());
    case 'keynote':
      return d.slides.map((s: any) => `${s.text} ${s.sub ?? ''}`.trim());
    case 'progress':
      return [...d.steps.map((s: any) => s.text), d.stall_text, `${d.twist.text} ${d.twist.sub ?? ''}`.trim()];
    case 'dialogue':
      return d.lines.map((l: any) => l.text);
    case 'stat':
      return [...d.stats.map((s: any) => s.label), ...(d.punchline ? [d.punchline] : [])];
    default:
      return [];
  }
}

/** Stable hash of the spec content (used to skip re-rendering unchanged specs). */
export function specHash(spec: Spec): string {
  const { created_at: _c, ...rest } = spec;
  return crypto.createHash('sha256').update(stableStringify(rest)).digest('hex').slice(0, 16);
}

export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}
