# Contributing to Ball Knowledge

Thanks for helping out! This is a static React + Vite quiz app (no backend) hosted on GitHub Pages.
See [README.md](./README.md) for the architecture and [SETUP.md](./SETUP.md) for local install.

## Workflow

1. **Branch** off `main` (or work from your fork) — don't commit directly to `main`.
2. Make your change; keep it focused.
3. **Run locally before pushing:**
   ```bash
   npm install      # first time
   npm test         # unit tests (matcher + generated-data guards)
   npm run build:app # typecheck + production bundle
   ```
4. Open a **pull request** against `main`. CI (`.github/workflows/ci.yml`) runs `test` + `build:app`
   automatically — the PR can't merge until it's green and the owner approves.
5. The owner reviews, approves, and merges. Merging to `main` triggers the Pages deploy
   (`deploy.yml`).

## Ground rules

- **Don't hand-edit generated data.** `public/data/questions.json`, `daily.json`, and
  `manifest.json` are produced by the pipeline — never edit them by hand.
- **Refreshing data** (only when changing players/stats/sources): run `npm run build:data` (fetches
  from the PL/CL APIs + Wikipedia, then chains `build:daily`), then commit the updated
  `public/data/*.json` **together with** your code change. `build:data` also freezes today's daily
  into `daily.json` — commit that too so the current day's puzzle stays locked.
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
| `npm run build:data` | Regenerate questions + daily from sources (several min cold cache) |
| `npm run preview` | Serve the production build locally |
