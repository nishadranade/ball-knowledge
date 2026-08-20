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
- **SQUAD is practice-only.** `selectDaily()` doesn't draw a squad slot, and `loadQuestions.ts`
  deliberately keeps `SQUAD` out of `DAILY_FORMATS` (the unfrozen-daily fetch list) even though it's
  in `ALL_FORMATS` (Practice). If SQUAD ever joins the daily, both of those need updating together —
  otherwise the daily either 404s on a slot it can't fill, or silently fetches a file it never uses.
- **A frozen day in `daily.json` is immutable.** `build-daily.ts` is append-only and must stay that
  way; players have already played those rounds. Every daily slot is optional in the schedule, which
  is what lets the daily grow without rewriting history.
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

`daily.json` is the one file every visitor fetches eagerly and it grows ~2.6 KB/day (~1 MB/year).
The fix is one file per day (`data/daily/YYYY-MM-DD.json`), falling back to live selection on a 404.
Not urgent at 34 KB.
