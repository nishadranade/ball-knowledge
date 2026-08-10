# Contributing to Ball Knowledge

Thanks for helping out! This is a static React + Vite quiz app (no backend) hosted on GitHub Pages.
See [README.md](./README.md) for the architecture and [SETUP.md](./SETUP.md) for local install.

## Workflow

**The owner commits straight to `main`** — no feature branches, no pull requests. It's a solo
project, so the branch-and-merge ceremony added round trips without adding review.

1. Make your change; keep it focused.
2. **Run locally before pushing** — this matters more than it used to, because `ci.yml` only runs on
   pull requests and non-`main` branches, so a direct push to `main` never triggers it:
   ```bash
   npm install       # first time
   npm test          # unit tests (matcher, daily/share/links, generated-data guards)
   npm run build:app # typecheck + production bundle
   ```
3. Commit and `git push origin main`. That triggers `deploy.yml`, which re-runs `test` +
   `build:app` and then publishes to GitHub Pages.
4. The deploy job is gated on the build job, so **a failing test blocks the deploy but not the
   commit** — `main` can hold a red commit that never ships. Hence step 2.

> **Outside contributors:** fork and open a pull request instead. `ci.yml` runs `test` +
> `build:app` on PRs.

## Ground rules

- **Don't hand-edit generated data.** `public/data/q-list.json`, `q-career.json`, `q-match.json`,
  `daily.json` and `manifest.json` are produced by the pipeline — never edit them by hand. The bank
  is split one file per format so the browser fetches only what a view needs; there is no combined
  file, and `public/data/questions.json` is gitignored so a stale local copy can't be committed.
- **Refreshing data** (only when changing players/stats/sources): run `npm run build:data` (fetches
  from the PL/CL APIs + Wikipedia, then chains `build:matches` and `build:daily`), then commit the
  updated `public/data/*.json` **together with** your code change. `build:data` also freezes today's
  daily into `daily.json` — commit that too so the current day's puzzle stays locked.
- **Only touching match questions?** Run `npm run build:matches` instead. It regenerates the MATCH
  questions and merges them in, leaving list and career questions byte-identical — `build:data`
  would also re-crawl Wikipedia and reshuffle the (deliberately partial) career pool.
- **Keep `useGame` pure.** Game logic in `src/game/useGame.ts` is a pure reducer — no timers, no
  `Date.now()`, no side effects. Timing/IO belongs in components.
- **No new runtime dependencies** without discussion — the app ships to the browser, so bundle size
  and no-secrets matter.
- **Tests:** add/adjust tests for logic changes. Pure logic lives in `src/game/*` and is unit-tested
  in `tests/` (see `tests/matching.test.ts`, `tests/daily.test.ts`, `tests/questions.test.ts`).

## Handy commands

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm test` | Run all tests once |
| `npm run build:app` | Typecheck + bundle (what CI runs) |
| `npm run build:data` | Regenerate questions + matches + daily from sources (several min cold cache) |
| `npm run build:matches` | Regenerate ONLY match questions and merge them in (`MATCH_SEASONS=n` to limit) |
| `npm run build:daily` | Freeze today's daily into `daily.json` (append-only; no network) |
| `npm run preview` | Serve the production build locally |
