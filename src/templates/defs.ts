/**
 * Template catalog: data schemas (zod), beat structure and descriptions used by the idea generator.
 * The browser-side animation for each template lives in src/templates/<id>/template.js (+ style.css).
 */
import { z } from 'zod';

const txt = (max: number, what = 'Text') =>
  z
    .string()
    .trim()
    .min(1, `${what} can't be empty`)
    .max(max, `${what} is too long (max ${max} characters). Shorter text reads faster without sound`);

const tone = z.enum(['normal', 'good', 'bad', 'warn']).default('normal');
const emoji = z.string().max(8, 'Use a single emoji').optional();

/** Relative on-screen time for a beat, based on how long it takes to read. */
export function readWeight(text: string | string[] | undefined): number {
  const s = Array.isArray(text) ? text.join(' ') : (text ?? '');
  return 0.7 + Math.min(s.length, 200) / 42;
}

// ---------------------------------------------------------------------------------------------
// 1. chat — fake chat, message by message
const chat = z.object({
  ai_name: txt(24, 'ai_name').default('assistant'),
  user_name: txt(16, 'user_name').default('you'),
  messages: z
    .array(
      z.object({
        from: z.enum(['user', 'ai']),
        text: txt(170, 'Message'),
        hold: z.number().min(0.3).max(4).optional(),
      }),
    )
    .min(2, 'A chat needs at least 2 messages')
    .max(8, 'Max 8 messages: more than that is unreadable at Reel speed'),
});

// 2. pov — "POV:" text over an animated scene (a screen you're staring at, plus your reaction)
const pov = z.object({
  scene: z.enum(['laptop', 'phone']).default('laptop'),
  clock: z
    .object({ from: z.string().regex(/^\d{1,2}:\d{2}$/, 'clock.from must look like 23:58'), to: z.string().regex(/^\d{1,2}:\d{2}$/, 'clock.to must look like 05:47') })
    .optional(),
  beats: z
    .array(
      z.object({
        screen: txt(110, 'Screen text'),
        reaction: emoji,
        tone,
        hold: z.number().min(0.3).max(4).optional(),
      }),
    )
    .min(2)
    .max(6),
  caption_end: txt(80, 'caption_end').optional(),
});

// 3. terminal — coding agent session going wrong
const terminal = z.object({
  title: txt(40, 'title').default('~/startup — agent'),
  lines: z
    .array(
      z.object({
        kind: z.enum(['cmd', 'agent', 'out', 'error', 'success', 'warn']),
        text: txt(110, 'Terminal line'),
        hold: z.number().min(0.3).max(4).optional(),
      }),
    )
    .min(3)
    .max(12),
  chaos: z.enum(['none', 'rising']).default('rising'),
  final: txt(70, 'final').optional(),
});

// 4. expectation_reality — split screen
const panel = z.object({
  label: txt(20, 'label').optional(),
  text: txt(90, 'Panel text'),
  items: z.array(txt(60, 'Panel item')).max(4).default([]),
  emoji,
});
const expectation_reality = z.object({ expectation: panel, reality: panel });

// 5. tier_list — fills in live
const tier_list = z.object({
  tiers: z.array(txt(6, 'Tier label')).min(3).max(6).default(['S', 'A', 'B', 'C', 'D']),
  items: z
    .array(z.object({ text: txt(34, 'Tier item'), tier: txt(6, 'tier'), hold: z.number().min(0.3).max(4).optional() }))
    .min(3)
    .max(8),
  twist: z.object({ tier: txt(8, 'twist.tier'), text: txt(34, 'twist.text') }).optional(),
});

// 6. nobody — "Nobody: / AI:"
const nobody = z.object({
  setup: z.array(txt(40, 'Setup line')).min(1).max(3).default(['Nobody:', 'Absolutely no one:']),
  actor: txt(60, 'actor'),
  punchline: z.array(txt(90, 'Punchline line')).min(1).max(6),
  style: z.enum(['text', 'markdown', 'terminal']).default('text'),
});

// 7. notifications — stack of fake push notifications
const notifications = z.object({
  time: z.string().regex(/^\d{1,2}:\d{2}$/, 'time must look like 3:07').default('3:07'),
  date: txt(30, 'date').default('Tuesday 4 November'),
  items: z
    .array(
      z.object({
        app: txt(18, 'app'),
        icon: emoji,
        title: txt(40, 'Notification title'),
        body: txt(90, 'Notification body'),
        ago: txt(10, 'ago').default('now'),
        tone,
        hold: z.number().min(0.3).max(4).optional(),
      }),
    )
    .min(3)
    .max(7),
});

// 8. countdown — "N things that happen when…"
const countdown = z.object({
  direction: z.enum(['up', 'down']).default('up'),
  items: z
    .array(z.object({ text: txt(60, 'Item'), sub: txt(70, 'sub').optional(), emoji, hold: z.number().min(0.3).max(4).optional() }))
    .min(3, 'Countdown needs 3–5 beats')
    .max(5, 'Countdown needs 3–5 beats'),
});

// 9. keynote — fake product launch
const keynote = z.object({
  presenter: txt(30, 'presenter').default('LIVE · launch event'),
  product: txt(32, 'product'),
  slides: z
    .array(
      z.object({
        kind: z.enum(['title', 'bullet', 'stat', 'price', 'one_more_thing']),
        text: txt(70, 'Slide text'),
        sub: txt(80, 'Slide sub').optional(),
        hold: z.number().min(0.3).max(4).optional(),
      }),
    )
    .min(2)
    .max(6),
});

// 10. progress — loading bar with a twist ending
const progress = z.object({
  label: txt(50, 'label'),
  steps: z
    .array(z.object({ text: txt(60, 'Step'), pct: z.number().min(0).max(100) }))
    .min(2)
    .max(7),
  stall_at: z.number().min(50).max(99.9).default(99),
  stall_text: txt(50, 'stall_text').default('almost there…'),
  twist: z.object({
    text: txt(70, 'twist.text'),
    sub: txt(80, 'twist.sub').optional(),
    style: z.enum(['error', 'reset', 'success']).default('error'),
  }),
});

// 11. dialogue — two icon characters with speech bubbles
const mood = z.enum(['happy', 'neutral', 'smug', 'sweat', 'shock', 'dead']);
const dialogue = z.object({
  characters: z
    .array(z.object({ name: txt(18, 'Character name'), color: z.enum(['green', 'amber', 'cyan', 'purple', 'coral', 'red']).optional(), kind: z.enum(['human', 'bot']).default('human') }))
    .length(2, 'Dialogue needs exactly 2 characters'),
  lines: z
    .array(z.object({ who: z.union([z.literal(0), z.literal(1)]), text: txt(110, 'Line'), mood: mood.optional(), hold: z.number().min(0.3).max(4).optional() }))
    .min(2)
    .max(8),
});

// 12. stat — big number reveal
const stat = z.object({
  stats: z
    .array(
      z.object({
        label: txt(60, 'Stat label'),
        value: z.number(),
        prefix: z.string().max(4).default(''),
        suffix: z.string().max(8).default(''),
        decimals: z.number().int().min(0).max(2).default(0),
        tone,
        hold: z.number().min(0.3).max(4).optional(),
      }),
    )
    .min(1)
    .max(3),
  punchline: txt(80, 'punchline').optional(),
});

// ---------------------------------------------------------------------------------------------

export interface TemplateDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  id: string;
  label: string;
  /** One-paragraph description for humans and the idea generator. */
  description: string;
  data: S;
  /** Relative durations of the beats (one entry per beat). */
  beats(data: z.output<S>): number[];
  /** All on-screen text (for text density + duplicate detection). */
  text(data: z.output<S>): string[];
}

function def<S extends z.ZodTypeAny>(d: TemplateDef<S>): TemplateDef<S> {
  return d;
}

const last = (ws: number[], k = 1.5) => ws.map((w, i) => (i === ws.length - 1 ? w * k : w));
const h = <T extends { hold?: number }>(x: T, w: number) => (x.hold ? w * x.hold : w);

export const TEMPLATES = {
  chat: def({
    id: 'chat',
    label: 'Fake chat',
    description:
      'A chat between the user and an AI, revealed message by message with typing indicators. Classic setup: innocent request → AI does something unhinged/overconfident → user reacts → AI doubles down. 3–6 messages work best. Last message is the punchline.',
    data: chat,
    beats: (d) => last(d.messages.map((m) => h(m, readWeight(m.text) + (m.from === 'ai' ? 0.35 : 0)))),
    text: (d) => d.messages.map((m) => m.text),
  }),
  pov: def({
    id: 'pov',
    label: 'POV scene',
    description:
      'A "POV:" hook over a scene: a laptop or phone screen you are staring at, showing what changes beat by beat, with an optional clock that advances and your emoji reaction under the screen. Ends with an optional big caption. Good for "it is 3am and…" situations.',
    data: pov,
    beats: (d) => {
      const ws = d.beats.map((b) => h(b, readWeight(b.screen)));
      if (d.caption_end) ws.push(readWeight(d.caption_end) * 1.3);
      return last(ws, 1.3);
    },
    text: (d) => [...d.beats.map((b) => b.screen), ...(d.caption_end ? [d.caption_end] : [])],
  }),
  terminal: def({
    id: 'terminal',
    label: 'Terminal / agent meltdown',
    description:
      'A terminal where a coding agent session goes wrong. "cmd" lines are typed out, "agent" lines are the AI narrating, error/warn/success lines are colored. Chaos rises (shake, red tint) toward the end. Optional "final" overlay text lands the joke.',
    data: terminal,
    beats: (d) => {
      const ws = d.lines.map((l) => h(l, readWeight(l.text) * (l.kind === 'cmd' ? 1.2 : 0.85)));
      if (d.final) ws.push(readWeight(d.final) * 1.4);
      return last(ws, 1.3);
    },
    text: (d) => [...d.lines.map((l) => l.text), ...(d.final ? [d.final] : [])],
  }),
  expectation_reality: def({
    id: 'expectation_reality',
    label: 'Expectation vs reality',
    description:
      'Split screen. Top panel: the clean, hyped EXPECTATION. Bottom panel: the messy REALITY, revealed after a beat, its items appearing one by one. Reality items should escalate.',
    data: expectation_reality,
    beats: (d) => {
      const ws = [readWeight([d.expectation.text, ...d.expectation.items]), readWeight(d.reality.text)];
      d.reality.items.forEach((it) => ws.push(readWeight(it)));
      return last(ws, 1.4);
    },
    text: (d) => [d.expectation.text, ...d.expectation.items, d.reality.text, ...d.reality.items],
  }),
  tier_list: def({
    id: 'tier_list',
    label: 'Tier list',
    description:
      'A tier list (S/A/B/C/D by default) that fills in live: each item pops up big, then flies into its tier. Optional twist: a final item gets a brand-new tier (e.g. "RUN", "LEAVE") that appears below the list.',
    data: tier_list,
    beats: (d) => {
      const ws = d.items.map((it) => h(it, readWeight(it.text) + 0.3));
      if (d.twist) ws.push(readWeight(d.twist.text) + 0.8);
      return last(ws, 1.4);
    },
    text: (d) => [...d.items.map((i) => i.text), ...(d.twist ? [d.twist.text] : [])],
  }),
  nobody: def({
    id: 'nobody',
    label: 'Nobody: / AI:',
    description:
      'The "Nobody: / Absolutely no one: / <actor>:" meme. Setup lines are silent beats, then the actor line, then the punchline lines appear one by one. style=markdown renders the punchline as an over-formatted AI answer (headers, bullets); style=terminal renders it as console output.',
    data: nobody,
    beats: (d) => last([...d.setup.map((s) => Math.max(0.55, readWeight(s) * 0.8)), 0.8, ...d.punchline.map((p) => readWeight(p))], 1.4),
    text: (d) => [...d.setup, d.actor, ...d.punchline],
  }),
  notifications: def({
    id: 'notifications',
    label: 'Push notification stack',
    description:
      'A phone lock screen with a clock. Push notifications slide in one by one and stack (newest on top), telling a story that escalates (GitHub → Slack → AWS bill → …). The last notification is the punchline.',
    data: notifications,
    beats: (d) => last(d.items.map((n) => h(n, readWeight([n.title, n.body]) * 0.9))),
    text: (d) => d.items.flatMap((n) => [n.title, n.body]),
  }),
  countdown: def({
    id: 'countdown',
    label: 'Countdown list',
    description:
      'The hook names a list ("4 stages of asking AI to fix a bug"); 3–5 numbered beats appear one at a time with a huge number, earlier items shrink into a list. The final beat is the twist.',
    data: countdown,
    beats: (d) => last(d.items.map((it) => h(it, readWeight([it.text, it.sub ?? '']) + 0.3))),
    text: (d) => d.items.flatMap((i) => [i.text, ...(i.sub ? [i.sub] : [])]),
  }),
  keynote: def({
    id: 'keynote',
    label: 'Fake keynote',
    description:
      'A parody product launch on a dark stage: big slide transitions (title → bullet/stat → price → "one more thing"). The last slide undercuts the hype. Keep slide text short and punchy.',
    data: keynote,
    beats: (d) => last(d.slides.map((s) => h(s, readWeight([s.text, s.sub ?? '']) + 0.4))),
    text: (d) => [d.product, ...d.slides.flatMap((s) => [s.text, ...(s.sub ? [s.sub] : [])])],
  }),
  progress: def({
    id: 'progress',
    label: 'Progress bar twist',
    description:
      'A big progress bar with status messages that change as it fills (steps with pct), stalls at stall_at (e.g. 99%), then a twist ending: error, reset to 0 or an absurd "success".',
    data: progress,
    beats: (d) => [...d.steps.map((s) => readWeight(s.text) * 0.8), 1.4, readWeight([d.twist.text, d.twist.sub ?? '']) * 1.5],
    text: (d) => [d.label, ...d.steps.map((s) => s.text), d.stall_text, d.twist.text, ...(d.twist.sub ? [d.twist.sub] : [])],
  }),
  dialogue: def({
    id: 'dialogue',
    label: 'Two-character dialogue',
    description:
      'Two simple icon characters (human or bot) facing each other with speech bubbles. Lines alternate; each line can set the speaker\'s mood (happy, neutral, smug, sweat, shock, dead). Great for PM vs engineer, me vs my AI, junior vs senior.',
    data: dialogue,
    beats: (d) => last(d.lines.map((l) => h(l, readWeight(l.text)))),
    text: (d) => d.lines.map((l) => l.text),
  }),
  stat: def({
    id: 'stat',
    label: 'Stat reveal',
    description:
      'Huge numbers counting up, one stat per beat (1–3 stats), with tone colors. The contrast between stats is the joke (time saved vs time spent fixing). Optional punchline line at the end.',
    data: stat,
    beats: (d) => {
      const ws = d.stats.map((s) => h(s, readWeight(s.label) + 0.9));
      if (d.punchline) ws.push(readWeight(d.punchline) * 1.2);
      return last(ws, 1.3);
    },
    text: (d) => [...d.stats.map((s) => s.label), ...(d.punchline ? [d.punchline] : [])],
  }),
} as const;

export type TemplateId = keyof typeof TEMPLATES;
export const TEMPLATE_IDS = Object.keys(TEMPLATES) as TemplateId[];
export type TemplateData<T extends TemplateId> = z.output<(typeof TEMPLATES)[T]['data']>;
