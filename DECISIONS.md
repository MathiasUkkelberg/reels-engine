# Decisions

A log of the non-obvious choices, why they were made, and what would change them.

## Rendering

**Frame-by-frame with a virtual clock, not screen recording.**
Every template is a pure function of time: `build()` returns `update(t)`, and `update(t)` sets every animated property from `t` alone, with no CSS transitions, timers or `Date.now()`. The renderer calls `seek(t)` for each frame and captures it over the Chrome DevTools Protocol, so output is smooth and identical on every run, and frames can be captured by several pages in parallel.

**Frames piped straight into ffmpeg (`image2pipe`).** No temp PNG folder, so disk use stays flat. JPEG q95 capture is the default because it's ~25% faster than PNG and indistinguishable after H.264. `frameFormat: 'png'` in `reels.config.ts` switches to lossless.

**Background pre-rasterised into canvases.** Profiling showed full-screen CSS gradients being re-painted in software for every screenshot, which roughly doubled frame time (~190 → ~100 ms). The glow, scanlines and grid are now painted once into `<canvas>` at boot; their parameters still live in `theme.css`.

**Transforms are cleared at rest and scroll offsets snapped to whole pixels.** Chromium keeps raster results for layers whose transform changes every frame. That made a frame depend on which frames a page had rendered before, so parallel workers produced slightly different text rasterisation (possible shimmer). `R.appear()` now sets `transform: none` once an element has settled, and list scrolling uses integer pixels. A test checks that a frame renders the same regardless of seek order.

**Fonts inlined as base64 woff2 (Inter + JetBrains Mono from @fontsource).** Renders are identical on macOS and Linux, and `out/<id>/index.html` works standalone. Emoji fall back to the system emoji font (Apple Color Emoji on Mac, Noto on Linux), so they differ slightly between machines. Templates avoid relying on newer emoji.

**Playwright pinned to 1.63.0 with a launcher fallback.** The pin matches the Chromium build available in the dev container. `launchBrowser()` tries `CHROMIUM_PATH`, then Playwright's own browser, then system Chrome/Chromium, so a blocked browser download doesn't stop rendering.

**Output spec follows Meta's Reels requirements:** 1080×1920, 30 fps, H.264 High, yuv420p, closed GOP (`+cgop`, 2s keyframes), BT.709 tags, AAC 48 kHz stereo silent track (`anullsrc`), `+faststart` (moov first), and `-use_editlist 0` because Meta asks for "no edit lists".

**Automatic QA on every render.** At each beat the browser lists visible text outside the safe zones (top 250 px, bottom 420 px, right 120 px), clipped to its visible area. It also checks that the hook is fully visible at 0.5s and finds the smallest font size. Loop reels get a seam check (PSNR between the last and first frame; ≥ 30 dB means seamless). Results go to `meta.json` and are printed as warnings.

**Loops: the content fades back to the empty first-frame state in the final 0.6s**, the hook is on screen from frame 0, and ambient motion (grid drift, cursor blink) uses periods that divide the duration. This is generic for all 12 templates. The measured seam is ~41 dB.

**Timing is computed in Node, not in the browser.** Beat weights come from reading time (~20 chars/s), and the last beat gets extra time because punchlines need a moment to land. The timeline is passed to the page, so timing is unit-testable and the validator can warn when a beat is too short to read.

## Specs

**zod discriminated union on `template`.** Errors are printed as `data.messages[1].text: Message is too long (max 170 characters)`. Derived learning features (`template`, `length_s`, `loop`, `text_density`) are always recomputed from the spec, so they can't drift from what was rendered.

**Text density = words per second of on-screen text** (< 3 low, < 4.5 medium, else high). It's simple and explainable, and calibrated on the examples.

**`*word*` highlights a word in the accent colour.** It's one convention for all templates, for hooks and lines alike.

## Ideas

**Plain JSON + zod validation + one repair round, instead of API structured outputs.** The spec is a 12-way discriminated union with many string limits, and some of that would not be enforced by a JSON schema anyway. Validating with the same zod schema the renderer uses, then sending the exact errors back once, is model-agnostic (any model in `.env` works) and gives better messages.

**Model `claude-opus-5-5` with adaptive thinking and streaming.** The model is configurable via `ANTHROPIC_MODEL`, and the critic can use a separate `ANTHROPIC_CRITIC_MODEL`. Server-side refusal fallback (`fallbacks: "default"`) is on so one declined request doesn't kill a daily batch; set `ANTHROPIC_FALLBACKS=off` for models or platforms without it.

**Over-generate ×1.5, then critic.** The critic scores hook, relatability, shareability (weighted highest at 0.30, since DM shares drive Reels distribution), clarity without sound, and loopability. It keeps ideas above a weighted 6.8/10 with no criterion under 5. Rejects are saved in `rejected/<date>/` with scores and reasons, and recorded in the DB so they count as "done" for de-duplication.

**De-duplication = overlap coefficient on word unigrams+bigrams** (stopwords removed) against every past idea: accepted, rejected, posted and examples. It's cheap and transparent. The threshold is 0.55, tuned so "asked AI to fix one typo" matches its rephrasings but different jokes on the same topic pass.

**Explore/exploit = Thompson sampling.** Exploit slots (70%) draw template, hook type and humor style from posteriors built from shrunk effects ± uncertainty, so winners are picked most but not always. Before there is data, they draw from prior weights. Explore slots (30%) each test one under-sampled feature value with an explicit hypothesis and `experiment.test = {feature, value}`. Hypotheses get stable ids (`template-keynote`), so repeated experiments accumulate evidence.

**No-API mode = one combined prompt (generate + self-critique).** `ideas:prompt` saves the slot plan, and `ideas:import` re-applies it, so hypotheses and planned times survive the round trip.

## Learning

**Virality score = weighted mean of component ratios vs the rolling median of the previous 20 reels.** Weights: shares 0.35, watch-through 0.25, saves 0.20, comments 0.10, likes 0.05, reach 0.05. The reasoning is in `reels.config.ts`: shares/saves per reach are the strongest "send to a friend / come back" signals and grow a meme account. Watch-through captures hook strength and rewatches. Reach is mostly an outcome and drifts with growth, so it gets little weight. Count rates use a pseudo-count (`(count+1)/(expected+1)`), so small reels with 0 shares don't produce infinities. Ratios are capped at 8×. Missing components (e.g. watch time on CSV imports) re-normalise the weights. Score 1.0 = typical recent reel.

**Score each reel on the snapshot closest to 72h**, ignoring snapshots younger than 20h, so reels are compared at similar ages. Most of a Reel's first push is done by ~72h.

**Analysis is on log2(virality)**, so 2× and 0.5× are symmetric and outliers matter less.

**Small-sample honesty is built in, not left to wording:**
- Group vs the rest, Welch-style intervals. Group SDs are regularised toward the overall SD, so n=2 groups can't look precise.
- Evidence levels: anecdote (n<3: never a finding), weak (3–9), moderate (10–29), solid (30+).
- A finding needs a 95% interval that excludes zero. Wording scales with evidence ("Early signal" / "Likely" / "Established").
- Empirical-Bayes shrinkage (k=5) for the lift used in planning.
- A false-positive test checks that pure-noise data produces findings < 10% of the time.

**Above 50 scored reels: ridge regression + depth-2 tree.** Ridge (λ=3, one-hot features with n≥3) separates correlated features: if most stat reels also loop, it tells you which one matters. Bootstrap 90% intervals and **5-fold cross-validated R²** are reported, so a model that can't predict says so. The tree surfaces simple interactions with a minimum leaf of 8. Grouped results stay in the report.

**Priors are explicit and replaceable.** `src/learn/priors.ts` lists established short-form practices, each linked (where measurable) to a feature/value. The playbook marks each one **[PRIOR]** until there's moderate evidence, then **[DATA]** with "confirmed/contradicted/not supported".

**PLAYBOOK.md is fully regenerated** by `npm run learn`. House rules and priors live in code, so hand edits don't silently get overwritten. The idea generator reads the whole file.

## Publishing & data

**SQLite (better-sqlite3), one file `data/reels.db`.** Tables: reels, snapshots (time series), hypotheses, schedule, ideas (dedupe history), account_snapshots (followers), runs. Spec files in `specs/` remain the source of truth for content; the DB tracks state and metrics.

**Snapshots are bucketed by age (1h/24h/72h/168h).** Sync takes one snapshot when a new bucket becomes due, labelled with its real age. Missed buckets can't be backfilled because insights are cumulative.

**Publishing off by default; `PUBLISHING_ENABLED=true` required even for `npm run publish`.** This prevents accidental posts. Manual posting stays the main flow because API posts can't use trending audio.

**S3/R2 upload with a ~50-line SigV4 signer instead of the AWS SDK.** It avoids a large dependency for one PUT. The signing-key derivation is tested against AWS's published example vector.

**Instagram API with Instagram Login (`graph.instagram.com`) by default.** It doesn't need a Facebook Page. Facebook Login (`graph.facebook.com`) is supported via `IG_API_HOST` and unlocks resumable upload. Metric names follow the current docs (`views`, `reach`, `saved`, `shares`, `ig_reels_avg_watch_time`, …). If a newer metric is rejected, sync falls back to a core set.

**Posting slots in local time (Europe/Oslo by default), DST-safe** via `Intl`, without a date library.

## Process

- The 12 examples use generic product names ("Model 9 Ultra", "the AI", "agent") rather than impersonating real companies, in line with the house rules.
- Examples are encoded at CRF 22 (production default 18) to keep the repo small.
- The daily GitHub Action ships disabled (manual trigger only, gated by a repo variable). See `.github/workflows/daily.yml`.
