/**
 * reels-engine configuration.
 *
 * Secrets (API keys, tokens) live in `.env`. Everything here is safe to commit.
 * Every section explains *why* a default was chosen, so you can change it with intent.
 */
export const config = {
  brand: {
    handle: '@0xclaudemaxxer',
    /** The account's niche, fed to the idea generator. */
    niche: 'AI/tech memes and funny short reels for people who use AI tools (Claude, ChatGPT, Cursor, coding agents) every day',
    goalFollowers: 200_000,
  },

  render: {
    width: 1080,
    height: 1920,
    fps: 30,
    /** x264 constant-quality factor. 18 is visually lossless for flat graphics; IG re-encodes anyway. */
    crf: 18,
    /** Parallel browser pages used to capture frames. 0 = auto (half the CPU cores, max 4). */
    workers: 0,
    /**
     * Frame capture format. JPEG (q95) is ~25% faster than PNG and indistinguishable after H.264 encoding.
     * Use 'png' for lossless frames.
     */
    frameFormat: 'jpeg' as 'png' | 'jpeg',
  },

  /**
   * Instagram overlays UI on top of Reels. Key content (text, punchlines) must stay out of these zones.
   * The renderer runs an automatic check and warns when text crosses them.
   */
  safeZone: { top: 250, bottom: 420, right: 120, left: 56 },

  ideas: {
    defaultCount: 10,
    /** Share of each batch that builds on proven winners. The rest are labelled experiments. */
    exploitShare: 0.7,
    /** Generate this many candidates per kept idea, because the critic rejects some. */
    overgenerate: 1.5,
    /** The critic scores 1–10 per criterion. An idea must reach this weighted average… */
    criticThreshold: 6.8,
    /** …and no single criterion may fall below this floor (a great hook can't save an unclear reel). */
    criticFloor: 5,
    /** Weights for the critic's criteria. Shareability is weighted highest because DM shares drive Reels reach. */
    criticWeights: {
      hook: 0.25,
      relatability: 0.2,
      shareability: 0.3,
      clarity_without_sound: 0.15,
      loopability: 0.1,
    },
    /** Ideas whose text overlaps a past idea more than this (0–1 similarity) are rejected as repeats. */
    duplicateSimilarity: 0.55,
  },

  scoring: {
    /**
     * Virality score = weighted mean of component ratios, where each ratio is
     * (this reel's rate) / (rolling median rate of recent reels).
     *
     * Why these weights:
     * - shares/reach (0.35): a DM share or story repost is the strongest signal Instagram uses to
     *   push a Reel to non-followers, and it's the behaviour that grows a meme account.
     * - saves/reach (0.20): saves indicate "I'll come back to this". Strong for ranking, weaker for
     *   memes than for tutorials, so below shares.
     * - watch-through (0.25): avg watch time / reel length. Captures hook strength and rewatches
     *   (loops can push this above 100%). Short-form ranking leans heavily on retention.
     * - comments/reach (0.10): conversation is good but comment-bait inflates it cheaply.
     * - likes/reach (0.05): the weakest, most passive signal.
     * - reach (0.05): distribution relative to recent reels. Low weight because reach is mostly the
     *   *outcome* of the other signals and drifts with follower count.
     *
     * When a component is missing (e.g. watch time on a manual CSV import), the remaining weights
     * are re-normalised so the score stays comparable.
     */
    weights: {
      shares: 0.35,
      saves: 0.2,
      watch_through: 0.25,
      comments: 0.1,
      likes: 0.05,
      reach: 0.05,
    },
    /** Rolling-median window (number of prior posted reels) used to normalise each component. */
    baselineWindow: 20,
    /** Below this many prior reels, the baseline is the median of the first `baselineWindow` reels overall. */
    minBaseline: 5,
    /** Ratios are capped so one freak outlier can't dominate a group average. */
    ratioCap: 8,
    /** Which snapshot age to score on. 72h is when most Reels have finished their first push. */
    targetAgeHours: 72,
    /** Reels younger than this are too early to judge and are excluded from learning. */
    minAgeHours: 20,
  },

  learning: {
    /** Below this many scored reels a group result is labelled "anecdote" and never becomes a rule. */
    minGroupN: 3,
    /** Evidence levels by sample size (per group). */
    evidence: { weak: 3, moderate: 10, solid: 30 },
    /** Switch from grouped averages to regression/trees above this many scored reels. */
    modelThresholdN: 50,
    /** Empirical-Bayes shrinkage strength: a group with n reels is pulled toward the global mean by k/(n+k). */
    shrinkageK: 5,
    /** Hypotheses are judged once they have this many test reels. */
    hypothesisMinN: 3,
    /** After this many test reels with no clear result, a hypothesis is closed as inconclusive. */
    hypothesisMaxN: 12,
  },

  schedule: {
    /** IANA timezone for posting slots. */
    timezone: 'Europe/Oslo',
    /** 1–3 posts per day. Slots are local times; the first N slots are used. */
    postsPerDay: 2,
    slots: ['12:05', '19:35', '21:50'],
    /** How many days ahead the queue is planned. */
    horizonDays: 5,
  },

  metrics: {
    /** Snapshot ages (hours) for the insight time series: ~1h, 24h, 72h, 7d. */
    snapshotAgesHours: [1, 24, 72, 168],
  },

  publishing: {
    /** Off by default: the default workflow is manual posting so you can add trending audio in-app. */
    enabled: false,
    /** Graph API version (check Meta's changelog when upgrading). */
    graphVersion: 'v26.0',
    shareToFeed: true,
  },
} as const;

export type ReelsConfig = typeof config;
