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
- **`q-list.json` has multiple owners, unlike the other three bank files.** `build-questions.ts`
  generates the all-time metrics; `build-season-stats.ts` (`list_premier_league_stat_`) and
  `build-club-history.ts` (`list_premier_league_club_`) each own a separate slice by id prefix and
  merge into whatever's already there rather than replacing the file. `build-questions.ts` in turn
  preserves those foreign slices via `FOREIGN_LIST_PREFIXES` — **if you add another script that
  contributes to `q-list.json` (managers, transfer fees — see README's roadmap), add its prefix to
  that list too**, or the next `build-questions.ts` run silently wipes it. (Caught this exact class of
  mistake once already this session, the OTHER direction: testing `build-questions.ts` with
  `CACHE_ONLY=1` and an empty Wikipedia cache wiped `q-career.json` to 0 entries, since CAREER_PATH has
  no such preservation — it's fully, unconditionally owned by that one script. Restored from git;
  nothing had been pushed. Lesson: don't run `build-questions.ts` speculatively against uncommitted
  local state without checking `git diff` after.)
- **Club-shaped `Player` answers MUST set `noAutoTokens: true`.** Without it, matching.ts derives a
  standalone guess from the first/last word of the full name — fine for humans, wrong for clubs, where
  two different clubs sharing a word (Manchester United/City, the three "___ United"s) is the norm.
  Use the API's own `club.shortName` as `lastName`; it's already unique per club, no alias curation
  needed.
- **`fetch/wikiManagers.ts` is fragile — read its comments before touching it, and re-run
  `build:managers` + `npm test` after any change, not just typecheck.** This page family is far less
  consistently templated than career-path infoboxes; every quirk in that file's comments was a REAL
  bug that shipped wrong data at some point during development, caught by manually spot-checking
  output against known football history rather than by any test failing (there were no tests yet).
  The two worst: an empty "To" cell is ambiguous between "still in charge" and "old row, departure
  date just never recorded" — resolving that wrong once put a 1928 Crystal Palace manager at the top
  of "most recent"; and a club's history can be split across two separate wikitables (confirmed:
  Birmingham City), so "who's current" has to be resolved ONCE, globally, not per-table. `tests/
  wikiManagers.test.ts` pins each of these with a fixture reproducing the real page snippet that broke
  — treat a new club failing validation as the correct, safe outcome, not a bug to route around.
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
| Only per-season stats | `npm run build:season-stats` | Rewrites just its own slice of `q-list.json`. `SEASON_STATS_SEASONS=n` to limit. |
| Only club history (relegated/promoted/top-N) | `npm run build:club-history` | Rewrites just its own slice of `q-list.json`. No env override — always uses full PL standings history. |
| Only manager questions | `npm run build:managers` | Rewrites just its own slice of `q-list.json`. Attempts all 51 clubs, keeps only the ~18 that validate cleanly — see the note below. |
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
