/** Duplicate detection: normalised word n-gram overlap between a new idea and everything seen before. */
import crypto from 'node:crypto';

const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'and', 'or', 'i', 'my', 'me', 'you', 'your', 'it', 'is', 'in', 'on', 'for', 'with', 'that', 'this', 'be', 'when', 'ai']);

export function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[*_"'“”‘’`]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
}

function grams(words: string[]): Set<string> {
  const out = new Set<string>(words);
  for (let i = 0; i < words.length - 1; i++) out.add(`${words[i]} ${words[i + 1]}`);
  return out;
}

/** Overlap coefficient on unigrams+bigrams (0..1). Robust to one text being much longer. */
export function similarity(a: string, b: string): number {
  const A = grams(normalize(a));
  const B = grams(normalize(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / Math.min(A.size, B.size);
}

export function fingerprint(text: string): string {
  return crypto.createHash('sha1').update(normalize(text).join(' ')).digest('hex').slice(0, 16);
}

export interface DupMatch {
  score: number;
  against: string;
}

/** Most similar previous idea, comparing hook-to-hook and full-text-to-full-text. */
export function closestMatch(idea: { hook: string; text: string }, history: Array<{ hook: string; text: string }>): DupMatch | null {
  let best: DupMatch | null = null;
  for (const h of history) {
    const s = Math.max(similarity(idea.hook, h.hook), similarity(idea.text, h.text) * 0.95);
    if (!best || s > best.score) best = { score: s, against: h.hook };
  }
  return best;
}
