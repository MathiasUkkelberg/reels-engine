import { z } from 'zod';
import { TEMPLATES, TEMPLATE_IDS, type TemplateId } from '../templates/defs.ts';

export const HOOK_TYPES = [
  'pov',
  'shock',
  'question',
  'relatable_pain',
  'nobody',
  'list',
  'reveal',
  'comparison',
  'story',
  'challenge',
  'other',
] as const;

export const HUMOR_STYLES = [
  'absurd',
  'relatable',
  'sarcastic',
  'deadpan',
  'escalation',
  'self_deprecating',
  'meta',
  'dark',
  'wholesome',
  'other',
] as const;

export const TEXT_DENSITIES = ['low', 'medium', 'high'] as const;
export const ACCENTS = ['green', 'amber', 'cyan', 'purple', 'coral', 'red'] as const;

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .transform((s) => s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
  .pipe(z.string().min(2, 'topic must be a short slug like "coding-agents"').max(40));

/** Learning features. Some are filled in automatically from the spec (template, length_s, loop, text_density). */
export const FeaturesSchema = z.object({
  hook_type: z.enum(HOOK_TYPES),
  topic: slug,
  humor_style: z.enum(HUMOR_STYLES),
  has_twist: z.boolean(),
  planned_post_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'planned_post_time must be HH:MM (24h)')
    .nullable()
    .default(null),
  series: slug.nullable().default(null),
  // Derived (overwritten by normalizeSpec):
  template: z.enum(TEMPLATE_IDS as [TemplateId, ...TemplateId[]]).optional(),
  length_s: z.number().optional(),
  loop: z.boolean().optional(),
  text_density: z.enum(TEXT_DENSITIES).optional(),
});

export const CaptionVariantSchema = z.object({
  hook_line: z.string().trim().min(3).max(150, 'Caption hook line is too long (max 150)'),
  hashtags: z
    .array(
      z
        .string()
        .trim()
        .transform((t) => (t.startsWith('#') ? t : `#${t}`))
        .pipe(z.string().regex(/^#[\p{L}\p{N}_]{2,40}$/u, 'Hashtags must be one word, e.g. #claudecode')),
    )
    .min(3, 'Use 3–5 targeted hashtags')
    .max(5, 'Use 3–5 targeted hashtags (Instagram now favours a few relevant tags)'),
  question: z.string().trim().min(5).max(150, 'Comment question is too long (max 150)'),
});

export const CaptionSchema = z.object({
  variants: z.array(CaptionVariantSchema).min(1, 'At least one caption variant').max(4),
  selected: z.number().int().min(0).default(0),
});

export const ExperimentSchema = z.object({
  arm: z.enum(['exploit', 'explore']).default('exploit'),
  /** For explore ideas: the testable hypothesis, e.g. "stat reveals get more shares than chats". */
  hypothesis: z.string().max(200).optional(),
  hypothesis_id: z.string().max(80).optional(),
  /** For exploit ideas: the past reel or format this one builds on. */
  based_on: z.string().max(120).optional(),
});

const base = {
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{2,79}$/, 'id must be lowercase letters, digits and dashes (3–80 chars)'),
  hook: z
    .string()
    .trim()
    .min(3, 'Hook is required')
    .max(90, 'Hook is too long (max 90 characters): it must be readable in the first second'),
  duration_s: z
    .number({ error: 'duration_s must be a number of seconds' })
    .min(5, 'duration_s must be at least 5 seconds')
    .max(20, 'duration_s must be at most 20 seconds'),
  loop: z.boolean().default(false),
  accent: z.enum(ACCENTS).default('green'),
  /** Optional time (seconds) of the frame used for cover.jpg. Defaults to just before the punchline. */
  cover_at_s: z.number().min(0).max(20).optional(),
  features: FeaturesSchema,
  caption: CaptionSchema,
  experiment: ExperimentSchema.default({ arm: 'exploit' }),
  premise: z.string().max(300).optional(),
  source: z.enum(['ai', 'import', 'manual', 'example']).default('manual'),
  created_at: z.string().optional(),
};

const variants = TEMPLATE_IDS.map((id) =>
  z.object({ ...base, template: z.literal(id), data: TEMPLATES[id].data }),
);

export const SpecSchema = z.discriminatedUnion(
  'template',
  variants as unknown as [(typeof variants)[number], ...(typeof variants)[number][]],
);

/** Spec as written (input) and after parsing (output, with defaults). */
export type SpecInput = z.input<typeof SpecSchema>;
type ParsedSpec = z.output<typeof SpecSchema>;
export type Spec = ParsedSpec & {
  features: ParsedSpec['features'] & {
    template: TemplateId;
    length_s: number;
    loop: boolean;
    text_density: (typeof TEXT_DENSITIES)[number];
  };
};
export type Features = Spec['features'];
export type CaptionVariant = z.output<typeof CaptionVariantSchema>;
