# Working on Ball Knowledge

Static React SPA, no backend, deployed to GitHub Pages. **[README.md](./README.md)** has the
architecture and the reasoning behind the data model; **[CONTRIBUTING.md](./CONTRIBUTING.md)** has
the workflow; **[SETUP.md](./SETUP.md)** has local install. This file is only the things that aren't
written in the code and are expensive to rediscover.

## This machine has no JavaScript runtime

`node`, `npm`, `npx`, `tsx`, `bun`, `deno` are all absent. Docker is available. Run everything
through a container:

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm \
  -v "$PWD":/app -w /app node:20 sh -c 'npm ci && npm test'
```

The `-u` / `HOME` / `npm_config_cache` flags matter — without them npm writes root-owned files into
the repo and fails on an unwritable HOME. `node_modules/` and `dist/` are gitignored, so the install
persists for later runs without dirtying the tree.

Injecting a scratch script via `-v host.ts:/app/x.ts` leaves a zero-byte root-owned file behind when
the container exits. Check `git status` after.

## Constraints that break things if violated

- **GitHub Pages must stay on `build_type: workflow`.** If it ever reverts to "deploy from a
  branch", GitHub serves the repo root verbatim — the Vite *source* `index.html`, whose
  `/src/main.tsx` doesn't exist in a build — and the site goes blank while `deploy.yml` still
  reports success. This happened on 2026-08-09. Check with
  `gh api repos/nishadranade/ball-knowledge/pages --jq .build_type`. `deploy.yml` now smoke-checks
  the live URL after publishing, so it can't regress silently.
- **A green deploy is not proof the site works.** Verify by fetching the live page, not by trusting
  the check mark.
- **The answer bank is split one file per format**
  (`public/data/q-list|q-career|q-match|q-squad.json`) so the browser fetches only what a view needs.
  Never reintroduce a combined `questions.json` — it is gitignored precisely so a stale copy can't be
  committed or served. All build scripts go through `scripts/bank.ts`.
- **SQUAD's fixture filter is stricter than MATCH's, on purpose.** Both start from the same
  `qualifies()` in `scripts/fetch/matchFilters.ts`, but SQUAD additionally requires a marquee side in
  CL fixtures (`isBigClFixture`/`BIG_EUROPE`) and always asks about the bigger side when only one
  qualifies (`isBigTeam`) — naming a full unfamiliar XI is a much bigger ask than naming a scorer.
  Don't "simplify" SQUAD to just reuse `qualifies()` outright; that would reintroduce asking players
  to name Bodø/Glimt's back four.
- **SQUAD joined the daily on 2026-08-20.** `DAILY_FORMATS` in `loadQuestions.ts` must list exactly
  the formats `selectDaily()` draws from — today that's every format, so it equals `ALL_FORMATS`, but
  it's kept as its own list rather than reused directly: a *future* Practice-only format must NOT be
  added to `DAILY_FORMATS` until `selectDaily()` actually draws from it, or an unfrozen daily fetches
  a file it never uses. Days frozen before 2026-08-20 simply have no `squad` key (same optional-slot
  pattern as `career2`/`match`) and are never back-filled.
- **A frozen day in `daily.json` is immutable.** `build-daily.ts` is append-only and must stay that
  way; players have already played those rounds. Every daily slot is optional in the schedule, which
  is what lets the daily grow without rewriting history.
- **`selectDaily`'s repeat guards only bite going forward, not backward.** It excludes ids used in the
  last 30 frozen days (`recentlyUsedIds`) and won't let a day's squad question share the match
  question's fixture (`fixtureKeyOf`) — both with a safety-net fallback if the exclusion would leave a
  slot empty. `build-daily.ts`'s freeze loop mutates `schedule` in place as it goes, so freezing
  several days in one run still avoids repeats among them, not just against what was already
  committed. If you add a new daily slot, thread its ids into `recentlyUsedIds` too, or it silently
  won't be covered by the cooldown.
- **`ZERO_SPEED_BONUS_AT_MS` in `computeDailyScore` (`src/game/daily.ts`) does NOT self-adjust.** The
  accuracy side of the score scales automatically with each question's own `maxWrong`, but the speed
  bonus decays over a flat time budget for the WHOLE day. This already broke once (with the old,
  since-replaced tiered version): squad joined the daily and the top tier — calibrated for a
  4-question day — went from "fast" to "basically unreachable" in the same breath, since typing 11
  names takes real time. Adding, removing, or reordering a daily slot — or changing a format's own
  answer count — should come with a check of whether the cutoff still makes sense, not just whether
  the code compiles.
- **The speed bonus is a smooth decay (`speedBonus()`), not tiers — keep it that way.** It used to be
  three discrete tiers; a couple of seconds near a cutoff could swing the score by 15 points, more
  than acing an entire question. If this ever needs adjusting again, don't reintroduce fixed tiers —
  that reintroduces the exact cliff-edge unfairness that was the point of removing them.
- **Question timers are pause-aware (`useElapsedTime`/`elapsedTimer.ts`), not bare `Date.now()`
  diffs.** Every question component calls `useElapsedTime()` and reports `getElapsedMs()` at round
  end; it pauses on `visibilitychange` so switching tabs or backgrounding mid-round doesn't get scored
  as "slow." Don't reintroduce a raw `useRef(Date.now())` timer in a new question component — it
  silently reopens the same unfairness.
- **Keep `src/game/useGame.ts` pure** — no timers, no `Date.now()`, no side effects. Timing and IO
  belong in components.
- **No new runtime dependencies** without discussion; this ships to the browser.

## Workflow

Commit **straight to `main`** — no branches, no PRs. Note that `ci.yml` only runs on PRs and
non-`main` branches, so a direct push never triggers it: `deploy.yml` is the only gate, and because
its deploy job is gated on its build job, **a failing test blocks the deploy but not the commit**.
Run `npm test` and `npm run build:app` locally first.

## Which data script to run

| Changed | Run | Notes |
|---|---|---|
| Only match fixtures | `npm run build:matches` | Rewrites just `q-match.json`. `MATCH_SEASONS=n` to limit. |
| Only squad line-ups | `npm run build:squads` | Rewrites just `q-squad.json`. Run after `build:matches` — same fixture detail endpoint, so it reuses that disk cache for free. `SQUAD_SEASONS=n` to limit. |
| Players / stats / sources | `npm run build:data` | Chains matches + squads + daily. Several minutes; hits the PL API and Wikipedia. |
| Nothing — just freezing today | `npm run build:daily` | No network. Runs nightly via `freeze-daily.yml`. |

Prefer `build:matches` when only fixtures changed: `build:data` also re-crawls Wikipedia, and that
crawl is deliberately partial, so it reshuffles the career pool as a side effect.

## Known next thing

`daily.json` is the one file every visitor fetches eagerly and it grows ~1 MB/year already — faster
from 2026-08-20 on, once days start embedding a squad question (11 named, numbered players) too. The
fix is one file per day (`data/daily/YYYY-MM-DD.json`), falling back to live selection on a 404. Not
urgent at 34 KB.
