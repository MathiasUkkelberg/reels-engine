/**
 * Bootstrap priors: established short-form best practices used until the account's own data
 * says otherwise. Each prior that maps to a measurable feature is checked against the data on
 * every `npm run learn`; once there is moderate evidence it is marked confirmed or contradicted
 * and the data takes over.
 */
import type { LearnFeature } from './analyze.ts';

export interface Prior {
  id: string;
  text: string;
  /** Feature/value the prior predicts will score above typical (if measurable). */
  feature?: LearnFeature;
  value?: string;
}

export const PRIORS: Prior[] = [
  { id: 'hook-first-second', text: 'Hook in the first second: the reason to keep watching must be on screen before 0.5s (every template enforces this).' },
  { id: 'no-sound', text: 'Readable without sound: most people watch muted. Big text, one idea per beat, no audio-dependent jokes.' },
  { id: 'short', text: 'Short wins: 7–12s reels get higher watch-through than 15–20s ones.', feature: 'length', value: '10-14s' },
  { id: 'loop', text: 'Seamless loops inflate watch time (rewatches count) and push watch-through above 100%.', feature: 'loop', value: 'yes' },
  { id: 'twist', text: 'Twist endings: a final beat that flips the setup drives rewatches and shares.', feature: 'has_twist', value: 'yes' },
  { id: 'relatable-pain', text: 'Relatable pain beats clever: "this happened to me" is what people DM to friends.', feature: 'hook_type', value: 'relatable_pain' },
  { id: 'escalation', text: 'Escalation structure (each beat worse than the last) holds attention to the end.', feature: 'humor_style', value: 'escalation' },
  { id: 'series', text: 'Recurring series formats ("agent diaries") build return viewers and make the account recognisable.', feature: 'series', value: 'agent-diaries' },
  { id: 'low-density', text: 'Low text density: fewer than ~3 words per second keeps reels readable at swipe speed.', feature: 'text_density', value: 'low' },
  { id: 'evening', text: 'Evening posts (18–22 local) reach people scrolling after work.', feature: 'post_slot', value: 'evening' },
  { id: 'comment-question', text: 'End captions with a specific question to invite comments (not "thoughts?").' },
  { id: 'niche-language', text: 'Use insider language of daily AI users ("you\'re absolutely right", context window, rate limits) to make the in-group feel seen.' },
];
