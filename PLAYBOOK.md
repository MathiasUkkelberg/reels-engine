# PLAYBOOK: @0xclaudemaxxer

_Rewritten by `npm run learn` on 2026-11-02. The idea generator reads this file. Edit priors in `src/learn/priors.ts` and house rules in `src/learn/playbook.ts`; everything else comes from data._

## Status
- Phase: **early (treat everything as hypotheses)**
- Posted reels: 1 · scored (≥ 20h old): 1 · too young: 0
- Virality score: 1.0 = a typical recent reel. Weighted toward shares and saves per reach, plus watch-through (see `reels.config.ts`).
- Evidence levels: anecdote (n<3, ignored) · weak (3–9) · moderate (10–29) · solid (30+). Only intervals that exclude zero count as findings.

## What works (from data)
_Nothing yet has enough evidence. Until it does, follow the priors below and keep experimenting._

## What doesn't (from data)
_Nothing has been shown to underperform yet._

## Open hypotheses
_No open hypotheses. The next idea batch will propose experiments._

## Priors (best practices, to be replaced by data)
_Marked **PRIOR** until the account has moderate evidence for or against them._
- **[PRIOR]** Hook in the first second: the reason to keep watching must be on screen before 0.5s (every template enforces this). _(not directly measurable; keep following it)_
- **[PRIOR]** Readable without sound: most people watch muted. Big text, one idea per beat, no audio-dependent jokes. _(not directly measurable; keep following it)_
- **[PRIOR]** Short wins: 7–12s reels get higher watch-through than 15–20s ones. _(untested (no reels with this feature yet))_
- **[PRIOR]** Seamless loops inflate watch time (rewatches count) and push watch-through above 100%. _(untested (no reels with this feature yet))_
- **[PRIOR]** Twist endings: a final beat that flips the setup drives rewatches and shares. _(untested (no reels with this feature yet))_
- **[PRIOR]** Relatable pain beats clever: "this happened to me" is what people DM to friends. _(untested (no reels with this feature yet))_
- **[PRIOR]** Escalation structure (each beat worse than the last) holds attention to the end. _(untested (no reels with this feature yet))_
- **[PRIOR]** Recurring series formats ("agent diaries") build return viewers and make the account recognisable. _(untested (no reels with this feature yet))_
- **[PRIOR]** Low text density: fewer than ~3 words per second keeps reels readable at swipe speed. _(untested (no reels with this feature yet))_
- **[PRIOR]** Evening posts (18–22 local) reach people scrolling after work. _(untested (no reels with this feature yet))_
- **[PRIOR]** End captions with a specific question to invite comments (not "thoughts?"). _(not directly measurable; keep following it)_
- **[PRIOR]** Use insider language of daily AI users ("you're absolutely right", context window, rate limits) to make the in-group feel seen. _(not directly measurable; keep following it)_

## Top reels so far
- **1.00×** `stat-productivity-audit` (stat, reveal, ai-productivity): "my AI productivity this week, *audited*"

## Formats to build on (exploit list)
- No proven winners yet: build on priors. Strong starting formats: fake chat where the AI escalates, coding-agent terminal meltdowns, POV late-night sessions, numbered "stages of…" lists with a twist.
- Variation candidate: `stat-productivity-audit` (stat): "my AI productivity this week, *audited*"

## House rules (always)
- Every reel needs a hook that works in one glance (≤ 60 characters ideal) and a payoff in the final beat.
- Write for people who use AI tools daily: specific, insider details (exact error messages, rate limits, "You're absolutely right!") beat generic "AI is taking over" jokes.
- Punch at situations and tools, never at people. No real private individuals, no impersonating real brands or accounts.
- No engagement bait that lies ("wait for it" with no payoff). The caption question should be specific and easy to answer.
- Prefer formats that can become a series; name the series in `features.series`.
- Keep text big and short: one idea per beat, ≤ 3 words per second on average.
