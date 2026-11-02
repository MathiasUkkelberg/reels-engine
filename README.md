# reels-engine

A content pipeline for the Instagram account **@0xclaudemaxxer**: AI/tech memes and short, funny reels for people who use AI tools every day. The goal is 200k followers.

- **Reels are HTML/CSS/JS animations** driven by a JSON spec, rendered frame by frame with headless Chromium and encoded with ffmpeg. There are 12 meme templates and no paid AI video tools.
- **Ideas come from Claude** (or from a prompt you paste into Claude yourself). A second critic pass filters them, and the generator never repeats past ideas.
- **The system learns from performance data.** It pulls insights, scores every reel on a virality score, works out which features go with high scores (honestly, with sample sizes and intervals), rewrites `PLAYBOOK.md`, and steers the next batch: about 70% proven formats and 30% labelled experiments.

```
           ┌──────────── PLAYBOOK.md ◄──────────── learn ◄──── sync / import:csv ◄── Instagram insights
           ▼                                          ▲
 ideas (Claude + critic) ──► specs/*.json ──► render ──► out/<id>/ ──► post (manual or API) ──► mark-posted
```

Examples (12 templates, rendered by this repo) are in [`examples/`](examples/). Each folder has `reel.mp4`, `cover.jpg`, `caption.txt`, `meta.json` and a `storyboard.jpg` contact sheet.

---

## Setup (macOS, Apple Silicon)

```bash
brew install node ffmpeg        # Node 20+ and ffmpeg (with libx264, the default brew build)
git clone <this repo> && cd reels-engine
npm install
npx playwright install chromium # headless browser used for rendering
cp .env.example .env            # add ANTHROPIC_API_KEY (optional, see "No-API mode")
npm run learn                   # creates data/reels.db and the bootstrap PLAYBOOK.md
npm test                        # unit + render tests (~40s)
```

Render an example to check everything works:

```bash
npm run render -- examples/specs/chat-one-typo.json
open out/chat-one-typo/reel.mp4
```

If Playwright's browser download is blocked, set `CHROMIUM_PATH` in `.env` to any Chrome/Chromium binary (e.g. `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`). The launcher also finds system Chrome automatically.

---

## Commands

| Command | What it does |
|---|---|
| `npm run render -- specs/<id>.json` | Render one reel to `out/<id>/`: `reel.mp4` (1080×1920, 30 fps, H.264 + silent AAC), `cover.jpg`, `caption.txt`, `meta.json`, `storyboard.jpg`, `index.html`. Accepts a path or a bare id. |
| `npm run render:batch` | Render every spec in `specs/` without an up-to-date render (`--force` re-renders all). |
| `npm run preview -- <id>` | Open the live HTML in your browser with play/pause, a scrubber, frame stepping and a safe-zone overlay (`s`). It reloads when you save the spec, a template or the theme. |
| `npm run storyboard -- <id>` | Quick contact sheet (one frame per beat) without encoding video. |
| `npm run validate [-- files]` | Validate specs (all of `specs/` and `examples/specs/` by default) and show readability warnings. |
| `npm run ideas -- --count 20` | Generate reel specs with the Anthropic API: plan → generate → validate → de-dupe → critic. Accepted ideas go to `specs/`, rejected ones to `rejected/<date>/` with reasons. `--dry-run` writes nothing. |
| `npm run ideas:prompt -- --count 10` | No-API mode: print a ready-made prompt (generation + self-critique) to paste into Claude. Tip: `npm run -s ideas:prompt \| pbcopy`. |
| `npm run ideas:import -- reply.json` | Import Claude's JSON reply (file or stdin). It goes through the same validation, de-dupe and critic threshold. |
| `npm run mark-posted -- <id> <ig_media_id>` | Record a manual post (`--at 2026-11-03T19:35:00Z` for a past time). |
| `npm run sync` | Pull insights for posted reels at ~1h / 24h / 72h / 7d (official API) plus the follower count. |
| `npm run import:csv -- metrics.csv` | Enter metrics manually before the API is set up. See [`examples/metrics-template.csv`](examples/metrics-template.csv). |
| `npm run learn` | Score reels, analyze features, update hypotheses, and write `reports/<date>.md`, `reports/dashboard.html`, `data/insights.json` and **`PLAYBOOK.md`**. |
| `npm run schedule` | Maintain the posting queue (1–3/day at configured times). Publishes due reels if publishing is enabled; otherwise prints your manual posting plan. |
| `npm run publish -- <id>` | Publish one reel through the Instagram API (`--dry-run` to preview). Off by default; see [SETUP-INSTAGRAM.md](SETUP-INSTAGRAM.md). |
| `npm run daily` | sync → learn → ideas → render:batch → schedule, then a short summary. `--skip-ideas`, `--skip-render`, `--count N`. |
| `npm run status` | Counts of reels by status, snapshots, hypotheses and queued posts. |
| `npm run examples` | Re-render `examples/specs/*` into `examples/<id>/`. |
| `npm test` / `npm run typecheck` | Tests (vitest) and TypeScript check. |

---

## Your first week

**Day 0 (setup, ~20 min)**
1. Do the setup above. Run `npm run preview -- chat-one-typo` and play with the scrubber and the safe-zone overlay (`s`).
2. Watch the 12 rendered examples in `examples/`. Post the 3–4 you like best over the first days to get a baseline (copy them to `specs/` first so they're tracked: `cp examples/specs/chat-one-typo.json specs/ && npm run render -- chat-one-typo`).

**Day 1 (first batch)**
1. `npm run ideas -- --count 10`, or without an API key: `npm run -s ideas:prompt | pbcopy`, paste into Claude, save the JSON reply as `reply.json`, then `npm run ideas:import -- reply.json`.
2. Skim `specs/` and delete anything you wouldn't post. Tweak hooks while watching `npm run preview -- <id>` (it reloads on save).
3. `npm run render:batch`, then `npm run schedule` to see when to post what.

**Every day (5 min)**
1. Post 1–2 reels from `out/<id>/`: upload `reel.mp4`, pick `cover.jpg` as the cover, paste the first block of `caption.txt`, and add a trending sound in the app (keep it low or muted; the reels work without sound).
2. Copy the media id (from the post URL or the API) and run `npm run mark-posted -- <id> <media_id>`.
3. `npm run daily`. It syncs metrics (if the API is set up), relearns, writes new ideas and renders them.

**Before the API is connected:** once a day, copy the numbers from Instagram's insights into a CSV (`reel_id, captured_at, views, reach, likes, comments, shares, saves, avg_watch_time_s`) and run `npm run import:csv -- today.csv`. Snapshots around 24h and 72h matter most.

**End of week 1:** open `reports/dashboard.html` and `PLAYBOOK.md`. Expect almost everything to still say "weak" or "anecdote". That's correct with ~10 reels, and the playbook won't pretend otherwise. Keep the 70/30 mix running; evidence becomes useful from about 20–30 scored reels, and regression kicks in after 50.

Connect the API ([SETUP-INSTAGRAM.md](SETUP-INSTAGRAM.md)) as soon as you can. Automatic 1h/24h/72h/7d snapshots with watch time are much better data than manual entry.

---

## Templates

All templates share one theme (`src/theme/theme.css`): a dark terminal palette, Inter + JetBrains Mono, a fixed `> @0xclaudemaxxer` watermark above Instagram's caption area, and big text sized to fit.

| id | Format |
|---|---|
| `chat` | Fake chat, message by message with typing indicators (user vs an unhinged AI) |
| `pov` | "POV:" over a laptop/phone scene with an advancing clock and emoji reactions |
| `terminal` | Coding-agent terminal session going wrong: typed commands, colored output, rising chaos |
| `expectation_reality` | Split screen: clean expectation, messy reality revealed item by item |
| `tier_list` | Tier list filling in live, with an optional twist tier |
| `nobody` | "Nobody: / AI:", with plain, markdown-parody or terminal punchlines |
| `notifications` | Lock screen with push notifications stacking up |
| `countdown` | "N stages of…" with 3–5 huge numbered beats |
| `keynote` | Fake product launch slides with "one more thing" |
| `progress` | Progress bar with status lines, a 99% stall and a twist ending |
| `dialogue` | Two icon characters (human/bot) with speech bubbles and moods |
| `stat` | Big number reveals that count up |

Every template has:
- the **hook on screen within 0.25s** (or from frame 0 when looping)
- **beats** timed by reading time across an adjustable **5–20s**
- an optional **seamless loop**
- **big text**, auto-fitted and never below ~30px
- **safe zones** respected (top 250, bottom 420, right 120 px). Every render checks them automatically.

### Spec format

```jsonc
{
  "id": "chat-one-typo",
  "template": "chat",
  "hook": "asked the AI to fix *one* typo",      // *word* = accent highlight
  "duration_s": 13,                               // 5–20
  "loop": false,
  "accent": "green",                              // green | amber | cyan | purple | coral | red
  "data": { "messages": [{ "from": "user", "text": "fix the typo on line 12 pls" }, ...] },
  "features": {                                   // tags for learning
    "hook_type": "relatable_pain", "topic": "coding-agents", "humor_style": "escalation",
    "has_twist": true, "planned_post_time": "19:35", "series": null
    // template, length_s, loop, text_density are filled in automatically
  },
  "caption": { "variants": [{ "hook_line": "...", "hashtags": ["#claudecode", "..."], "question": "..." }], "selected": 0 },
  "experiment": { "arm": "explore", "hypothesis": "...", "test": { "feature": "template", "value": "stat" } }
}
```

Each template's `data` shape is defined with zod in `src/templates/defs.ts`; see `examples/specs/` for one of each. Invalid specs fail with path-prefixed messages such as `data.messages[1].text: Message is too long (max 170 characters)`.

To add a template: create `src/templates/<id>/template.js` (+ `style.css`) using `Reel.register(id, { build(root, ctx) { …; return (t) => { … } } })`, add its schema to `defs.ts`, and add an example spec. The rule is that `update(t)` must be a pure function of `t`.

---

## The learning loop

**Virality score** (`src/learn/score.ts`, weights in `reels.config.ts`). For each reel, every component is compared with the **rolling median of the 20 reels posted before it**:

| component | weight | why |
|---|---|---|
| shares / reach | 0.35 | DM shares and story reposts are the strongest growth signal for a meme account |
| watch-through (avg watch time ÷ length) | 0.25 | hook strength + rewatches (loops can exceed 100%) |
| saves / reach | 0.20 | "I'll come back to this" |
| comments / reach | 0.10 | conversation (but cheap to bait) |
| likes / reach | 0.05 | weakest, most passive signal |
| reach | 0.05 | distribution; mostly an outcome, drifts with follower count |

The score is the weighted mean of those ratios: **1.0 = a typical recent reel, 2.0 = twice as viral**. Because everything is relative to recent reels, account growth doesn't inflate later scores. Reels are scored on the snapshot closest to 72h old.

**Analysis** (`npm run learn`):
- **Grouped comparisons** for template, hook type, topic, humor style, text density, length, loop, twist, posting slot, weekday, series and arm. Each group is compared with all other reels and shows n, the difference, a 95% interval, a shrunk estimate and an evidence level (anecdote < 3 ≤ weak < 10 ≤ moderate < 30 ≤ solid).
- **Above 50 scored reels**: ridge regression (effects adjusted for each other, bootstrap intervals, cross-validated R²) and a depth-2 regression tree for interactions.
- **Hypotheses**: every experiment tests one `feature = value`. After ≥ 3 test reels it can be *supported* or *refuted* (95% interval excludes zero); after 12 without a clear result it closes as *inconclusive*.
- **Outputs**: `reports/<date>.md` (full tables), `reports/dashboard.html` (followers vs goal, virality over time, effect charts, hypotheses), `data/insights.json` (read by the idea planner), and a rewritten **`PLAYBOOK.md`** with what works, what doesn't, open hypotheses, model view, priors, top reels and formats to build on.

**It never overstates.** Groups under 3 reels are never findings, intervals for small groups are deliberately wide, and the wording scales with evidence ("Early signal" → "Likely" → "Established"). Until data exists, the playbook runs on clearly marked **[PRIOR]** best practices: hook in the first second, readable without sound, short, loops, twist endings, relatable pain, recurring series. Each prior flips to **[DATA]** (confirmed, contradicted or not supported) once there is moderate evidence.

**Explore/exploit**: each `ideas` batch plans ~70% exploit slots (Thompson sampling over proven templates, hook types and humor styles) and ~30% explore slots. Each explore slot tests one under-sampled value with an explicit hypothesis, which is stored in the `hypotheses` table and tracked until resolved.

---

## Publishing (optional)

The default is **manual posting**, so you can add trending audio. The system still records what was posted and when (`mark-posted`) and pulls insights. To publish through the official Instagram API (Reels container → status poll → `media_publish`), with the video served from Cloudflare R2, S3, any static host or a resumable upload, follow **[SETUP-INSTAGRAM.md](SETUP-INSTAGRAM.md)**.

## Running it on a schedule

`.github/workflows/daily.yml` runs `npm run daily` on GitHub Actions. It is **disabled by default**: manual trigger only, and it also requires the repo variable `REELS_DAILY_ENABLED=true`. It persists the SQLite DB, PLAYBOOK and reports by committing them back, and uploads renders as artifacts. Uncomment the `schedule:` block to run it every day. On your Mac, a `launchd`/cron entry running `npm run daily` works the same way.

---

## Project layout

```
reels.config.ts          all tunables (scoring weights + rationale, thresholds, schedule, render)
src/theme/theme.css      the one brand theme (palette, fonts, watermark, safe zones)
src/templates/<id>/      template.js + style.css per template; defs.ts = data schemas
src/render/              runtime.js (virtual clock), html builder, renderer, ffmpeg, browser launcher
src/spec/                zod schema, validation, timing, captions
src/ideas/               planner (explore/exploit), prompts, Anthropic client, de-dupe, critic pipeline
src/learn/               score, analyze (groups, ridge, tree, hypotheses), priors, report, dashboard, playbook
src/publish/             Instagram Graph client, R2/S3 hosting, posting queue
src/metrics/             insights sync, CSV import
src/db/                  SQLite schema + helpers (data/reels.db)
specs/  out/  rejected/  reports/  examples/
```

Decisions and their reasoning: [DECISIONS.md](DECISIONS.md).

## Troubleshooting

- **`ffmpeg not found`**: `brew install ffmpeg`, or set `FFMPEG_PATH`.
- **`Could not launch Chromium`**: `npx playwright install chromium`, or set `CHROMIUM_PATH`.
- **Render warnings about beats being too short**: increase `duration_s` or cut words. They're warnings, not errors.
- **`ANTHROPIC_API_KEY is not set`**: use `ideas:prompt` / `ideas:import`, or add the key to `.env`.
- **Insights missing `views` / watch time**: Meta marks some Reels metrics as "in development". Sync falls back to a core set, and the score re-normalises its weights.
