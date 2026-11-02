/** Prompts for the generator and the critic. Shared by the API mode and the paste-into-Claude mode. */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../reels.config.ts';
import { paths } from '../paths.ts';
import { TEMPLATES, TEMPLATE_IDS } from '../templates/defs.ts';
import { HOOK_TYPES, HUMOR_STYLES } from '../spec/schema.ts';
import { describeSlots, type Slot } from './plan.ts';

export function templateCatalog(): string {
  const exDir = path.join(paths.examples, 'specs');
  const examples = fs.existsSync(exDir) ? fs.readdirSync(exDir).filter((f) => f.endsWith('.json')) : [];
  return TEMPLATE_IDS.map((id) => {
    const t = TEMPLATES[id];
    const file = examples.find((f) => JSON.parse(fs.readFileSync(path.join(exDir, f), 'utf8')).template === id);
    const ex = file ? JSON.parse(fs.readFileSync(path.join(exDir, file), 'utf8')) : null;
    return `### ${id}: ${t.label}\n${t.description}\n${ex ? `Example data: ${JSON.stringify(ex.data)}` : ''}`;
  }).join('\n\n');
}

export const SPEC_SHAPE = `{
  "template": "<one of: ${TEMPLATE_IDS.join(' | ')}>",
  "hook": "<on-screen hook, ≤ 60 chars ideal (max 90). Wrap one key word in *asterisks* to highlight it>",
  "premise": "<one sentence: what's the joke and why the audience relates>",
  "duration_s": <5–20; 9–14 is the sweet spot>,
  "loop": <true|false>,
  "accent": "<green | amber | cyan | purple | coral | red>",
  "data": { <template-specific, follow the example data for that template exactly> },
  "features": {
    "hook_type": "<${HOOK_TYPES.join(' | ')}>",
    "topic": "<short slug, e.g. coding-agents, rate-limits, context-window, sycophancy, vibe-coding, ai-hype, prompting, hallucinations, ai-pricing>",
    "humor_style": "<${HUMOR_STYLES.join(' | ')}>",
    "has_twist": <true|false>,
    "planned_post_time": "<HH:MM from the slot>",
    "series": <null or a short slug for a recurring series, e.g. "agent-diaries">
  },
  "caption": {
    "variants": [
      { "hook_line": "<first caption line, a second joke, not a repeat of the on-screen hook>", "hashtags": ["#3 to #5 targeted tags"], "question": "<specific question that invites comments>" },
      { "...": "2–3 variants total" }
    ],
    "selected": 0
  },
  "experiment": { "arm": "<exploit|explore, from the slot>", "hypothesis": "<explore only>", "hypothesis_id": "<explore only>", "test": {"feature": "...", "value": "..."}, "based_on": "<exploit: what it builds on>" }
}`;

export function generatorSystem(): string {
  return `You are the head writer for ${config.brand.handle}, an Instagram account of ${config.brand.niche}. Goal: ${config.brand.goalFollowers.toLocaleString('en-US')} followers.
You write short, genuinely funny reels that people DM to friends who use AI tools. Your jokes come from specific, true-to-life details of using AI daily (agents going rogue, "You're absolutely right!", rate limits, context windows, sycophancy, hallucinated APIs, vibe coding, prompt rituals, AI pricing tiers, model launch hype).
Each reel is rendered from a JSON spec into one of the fixed HTML templates below. Text must be readable without sound: short lines, one idea per beat, a twist or escalation at the end.
Never impersonate real people or brands as if they were speaking; generic names like "the AI", "assistant", "agent", "Model 9 Ultra" are fine. No punching down. Avoid stale memes unless you give them a fresh AI-specific twist.
Output only JSON. No commentary.`;
}

export function generatorPrompt(opts: { playbook: string; history: string[]; slots: Slot[] }): string {
  const hist = opts.history.slice(-200);
  return `# PLAYBOOK (what we've learned; follow it, especially "What works", "Priors" and "House rules")
${opts.playbook}

# TEMPLATES
${templateCatalog()}

# ALREADY DONE: do not repeat these premises or punchlines (also avoid close variations)
${hist.length ? hist.map((h) => `- ${h}`).join('\n') : '- (nothing yet)'}

# THIS BATCH: one idea per slot, in order
${describeSlots(opts.slots)}

Rules for slots:
- The template is fixed per slot. hook_type and humor_style are strong suggestions: in EXPLOIT slots you may change them if the joke is clearly better another way (tag what you actually wrote).
- EXPLOIT slots: a new joke in a format that has worked; it may riff on the "build on" reels but must not copy them.
- EXPLORE slots are experiments: never change the feature under test, keep everything else strong so the test is fair, and copy the slot's hypothesis, hypothesis_id and test into "experiment".
- Use each slot's planned_post_time and loop value.

# OUTPUT
Return exactly: {"ideas": [ <spec>, ... ]} with ${opts.slots.length} specs, where each spec has this shape:
${SPEC_SHAPE}

Check before answering: every text field is within its length limit, the template's data matches its example structure, the hook is visible on its own, the last beat pays off.`;
}

export function criticSystem(): string {
  return `You are a ruthless short-form video editor for ${config.brand.handle} (${config.brand.niche}). You have watched thousands of AI memes and you reject anything generic, confusing, stale or unfunny. Score honestly; most ideas are 5–7. Output only JSON.`;
}

export function criticPrompt(ideas: Array<{ hook: string; premise?: string; template: string; data: unknown }>): string {
  return `Score each reel idea from 1–10 on:
- hook: does the on-screen hook stop the scroll in under a second?
- relatability: will daily AI users feel "this is literally me"?
- shareability: would someone DM this to a friend or post it to their story?
- clarity_without_sound: is it fully understandable muted, at reel speed?
- loopability: does the ending make people rewatch or loop?
Also give a one-sentence reason (what's weak or strong) and an optional concrete fix.

Ideas:
${ideas.map((i, k) => `[${k}] template=${i.template} hook="${i.hook}"\npremise: ${i.premise ?? ''}\ndata: ${JSON.stringify(i.data)}`).join('\n\n')}

Return exactly: {"reviews": [{"index": 0, "scores": {"hook": n, "relatability": n, "shareability": n, "clarity_without_sound": n, "loopability": n}, "reason": "...", "fix": "..."}, ...]} with one review per idea.`;
}

/** Single prompt for the no-API mode: generate, then self-critique in the same answer. */
export function pastePrompt(opts: { playbook: string; history: string[]; slots: Slot[] }): string {
  return `${generatorSystem()}

${generatorPrompt(opts)}

# THEN CRITIQUE YOUR OWN IDEAS
After writing the ideas, switch roles: ${criticSystem().replace('Output only JSON.', '')}
${criticPrompt([]).split('Ideas:')[0].trim()}

Put the reviews in the same JSON object, so the final answer is a single JSON code block:
{"ideas": [ ... ], "reviews": [{"index": 0, "scores": {...}, "reason": "...", "fix": "..."}, ...]}`;
}
