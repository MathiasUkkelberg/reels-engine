/**
 * Beat timing. Everything is computed up front from the spec so the animation is a pure function of
 * time (virtual clock) and can be unit-tested without a browser.
 */
export interface Beat {
  i: number;
  /** Start time (s). */
  at: number;
  /** Time until the next beat starts (s). */
  dur: number;
  end: number;
}

export interface Timeline {
  duration: number;
  fps: number;
  frames: number;
  loop: boolean;
  /** Hook pop-in duration. 0 when looping (hook already on screen at frame 0 so the loop is seamless). */
  hookIn: number;
  /** When the first beat starts. */
  contentStart: number;
  /** When beats stop (loop tail starts). */
  contentEnd: number;
  /** Seconds at the end used to return to the first frame's state (loop only). */
  loopTail: number;
  beats: Beat[];
  /** Default cover frame time. */
  coverAt: number;
}

export const HOOK_IN = 0.25;
export const LOOP_TAIL = 0.6;

export function computeTimeline(opts: {
  duration: number;
  fps: number;
  loop: boolean;
  weights: number[];
  coverAt?: number;
}): Timeline {
  const { duration, fps, loop } = opts;
  const weights = opts.weights.length ? opts.weights : [1];
  const hookIn = loop ? 0 : HOOK_IN;
  // Start content fast: the hook alone holds attention for well under a second.
  const contentStart = round(Math.min(0.7, duration * 0.07));
  const loopTail = loop ? LOOP_TAIL : 0;
  const contentEnd = round(duration - loopTail);
  const span = contentEnd - contentStart;
  const total = weights.reduce((a, b) => a + b, 0);
  const beats: Beat[] = [];
  let at = contentStart;
  weights.forEach((w, i) => {
    const dur = (w / total) * span;
    beats.push({ i, at: round(at), dur: round(dur), end: round(at + dur) });
    at += dur;
  });
  const lastBeat = beats[beats.length - 1];
  // Default cover: the setup is visible but the punchline is not yet revealed.
  const defaultCover = beats.length > 1 ? Math.max(hookIn + 0.1, lastBeat.at - 0.05) : contentStart + 0.6;
  const coverAt = round(Math.min(opts.coverAt ?? defaultCover, duration - 1 / fps));
  return {
    duration,
    fps,
    frames: Math.round(duration * fps),
    loop,
    hookIn,
    contentStart,
    contentEnd,
    loopTail,
    beats,
    coverAt,
  };
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
