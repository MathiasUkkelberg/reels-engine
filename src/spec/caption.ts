import type { CaptionVariant, Spec } from './schema.ts';

/** Instagram caption text: hook line, comment question, then hashtags. */
export function formatCaption(v: CaptionVariant): string {
  return `${v.hook_line.trim()}\n\n${v.question.trim()}\n\n${v.hashtags.join(' ')}`;
}

export function selectedCaption(spec: Spec): CaptionVariant {
  return spec.caption.variants[spec.caption.selected] ?? spec.caption.variants[0];
}

/** caption.txt: the selected caption first, other variants below a divider for A/B or reposts. */
export function captionFile(spec: Spec): string {
  const chosen = formatCaption(selectedCaption(spec));
  const others = spec.caption.variants
    .map((v, i) => ({ v, i }))
    .filter(({ i }) => i !== spec.caption.selected)
    .map(({ v, i }) => `--- variant ${i + 1} ---\n${formatCaption(v)}`);
  return others.length ? `${chosen}\n\n\n=== other caption variants (not posted) ===\n\n${others.join('\n\n')}\n` : `${chosen}\n`;
}
