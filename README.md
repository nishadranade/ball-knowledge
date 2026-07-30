# ⚽ Ball Knowledge

A browser-based soccer quiz game covering the **Premier League** and **Champions League**, with two
question formats and forgiving answer matching.

**▶ Play it live: https://nishadranade.github.io/ball-knowledge/**

## Question formats

1. **Top-N lists** — "Name the top 5 goalscorers in Premier League history." N answers (more if
   tied); up to **3 wrong guesses**.
2. **Career paths** — a player's club-by-club career (years, club, apps, goals) is shown with the
   name hidden; **1 answer**, up to **2 wrong guesses**.

## Modes

- **Daily** — a shared Wordle-style challenge: everyone gets the **same** 2 questions (one list +
  one career path) each day, picked deterministically from the calendar date (no backend). The day
  rolls over at **US Pacific midnight** (`America/Los_Angeles`, DST-aware), so all players share the
  same puzzle regardless of their own timezone. Play once per day, then **share a spoiler-free
  result** (emoji grid + "Ball Knowledge #N" + per-question time) via the Web Share API / clipboard.
  Progress and a streak are kept in `localStorage`. Daily lists are trimmed to **top 5** to keep the
  round short.
- **Practice** — free-play endless deck with all the filters below. Finishing a question also offers
  a **shareable result + deep link** to that exact question (`?q=<token>`), so you can send a
  favourite question to a friend.

**Frozen dailies.** Each day's two questions are appended to a committed
`public/data/daily.json` as *full question objects*, so a day that has been played can never change
underneath players when the data is regenerated. Days not yet frozen fall back to hashing the live
pool. See `scripts/build-daily.ts`.

**Share links don't spoil answers.** List deep links keep a readable id (it only restates the visible
prompt), but career-path ids are derived from the player's name, so career links use an **opaque hash
token** instead — `?q=ckkzpn`, not `?q=career_alan_shearer` (`questionParam` in `src/game/daily.ts`).

## Filters (Practice)

Filter by **competition** (Premier League / Champions League), **format** (lists / career paths),
and **difficulty**. **Difficulty applies to both formats:** **Standard** is approachable — famous
career players (best rank ≤200) and lists for major clubs/nations + overall (full top 10). **Hard**
adds rarer career players (rank 201–500) and lists for lesser clubs/countries (capped at top 5, so
their obscure rank 6–10 tail never shows in Standard). The daily challenge is always Standard-only.

**Answer matching is forgiving:** a surname alone is enough, diacritics are optional
(`Ozil` = `Özil`), and minor typos are tolerated (`Lamperd` → Lampard). Career-path answers also
accept the player's commonly-used first name (e.g. `Alisson`).

## Architecture

The game is a static React SPA. All data-gathering complexity lives in a build-time pipeline; the
browser only ever reads pre-generated JSON — no runtime network calls.

```
scripts/                     data-prep pipeline (Node, run at build time)
  question-templates.ts      WHAT questions can be asked (metrics, competitions, countries, clubs, prompts)
  fetch/premierLeague.ts     pulselive API client (comps=1 PL, comps=2 CL); disk cache
  fetch/plAggregate.ts       API responses → PlayerRow[] per metric (overall + per-club splits)
  fetch/clScorers.ts         Wikipedia all-time CL ranked lists (goals, appearances)
  fetch/wikipedia.ts         infobox → career stints (career-path questions)
  build-questions.ts         orchestrates: per-competition banks → generate → validate → write JSON
  build-daily.ts             append-only freeze of daily.json (epoch → today); never rewrites a past day
public/data/questions.json   generated answer bank shipped to the browser
public/data/daily.json       frozen per-day challenge (full question objects)
public/data/manifest.json    sources, retrieval dates, generated counts
src/
  game/types.ts              shared contract between pipeline and UI
  game/matching.ts           fuzzy last-name matcher (normalize + Levenshtein)
  game/useGame.ts            round state (lives, found answers, win/lose) — clock-free reducer
  game/daily.ts              date→question selection, frozen-schedule resolution, share text, deep links
  game/loadQuestions.ts      fetches the generated JSON under import.meta.env.BASE_URL
  components/                ListQuestion, CareerPathQuestion, GuessInput, Lives, QuestionRouter, DailyView
  App.tsx                    Daily/Practice modes, filters, deck, ?q= deep links
tests/                       matcher unit tests, daily/share/link tests, generated-data guards
```

**Data sources, one player model.**
- **Premier League LIST** — the **pulselive stats API** (`footballapi.pulselive.com`, comps=1):
  all-time, all players, per-club and per-country, for goals/assists/appearances/clean sheets.
- **Champions League LIST** — mixed, because pulselive's CL data (comps=2) only goes back to
  2004/05: **goals** and **appearances** come from Wikipedia's all-time ranked lists (genuinely
  all-time — Di Stéfano, Maldini, Crespo included); **assists** and **clean sheets** stay on
  pulselive and are labeled "since 2004/05" in the prompt (no clean all-time source exists yet —
  see roadmap). CL is overall + per-country only (no per-club).
- **CAREER questions** — **Wikipedia infoboxes** (top-K players per metric across both competitions).

The PL API is undocumented/internal, so the pipeline insulates the game from it: it's called at
build time only, every response is cached on disk, and output is validated before questions.json is
written. If the API ever changes, the shipped game keeps working from the last generated JSON.

## Commands

> **Running it locally (e.g. on a Mac)?** See [SETUP.md](./SETUP.md) for step-by-step install
> instructions, including which folders to copy and a version note for macOS.

```bash
npm install          # first-time setup
npm run dev          # dev server
npm run build:data   # regenerate questions.json + daily.json (PL API + Wikipedia; several min cold cache)
npm run build:daily  # freeze today's daily into public/data/daily.json (append-only)
npm run build:app    # typecheck + production bundle (uses the committed questions.json)
npm run build        # build:data + build:app (full local rebuild)
npm test             # run tests (matcher, daily/share/links, generated-data guards)
npm run preview      # serve the production build
```

## Deployment

Pushing to `main` auto-deploys to **GitHub Pages** via `.github/workflows/deploy.yml`
(→ https://nishadranade.github.io/ball-knowledge/). CI runs `build:app` only — it ships the
**committed** `public/data/questions.json` and never calls the live data pipeline. Vite's `base` is
`/ball-knowledge/` (override with the `BASE_PATH` env var for other hosts, e.g. `BASE_PATH=/`).

Pull requests run `.github/workflows/ci.yml` (`npm ci` → `npm test` → `npm run build:app`) without
deploying. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the PR workflow.

**To refresh the data:** run `npm run build:data` locally, commit the updated
`public/data/questions.json`, and push — the next deploy ships it.

> Note: pinned to Vite 4 / Vitest 0.34 because the build host runs glibc 2.26, which Vite 5's
> native Rollup binary does not support.

## Analytics

Page views are tracked with **[GoatCounter](https://www.goatcounter.com/)** — a cookieless,
privacy-friendly analytics service (no consent banner needed). It's a single `<script>` tag in
`index.html` pointing at the dashboard `https://ballknowledge.goatcounter.com`. Numbers are a close
estimate (visitors with JS disabled or a tracker-blocker on `gc.zgo.at` aren't counted). If a real
visit doesn't register, the usual cause is an adblocker blocking `gc.zgo.at`.

## Data source & attribution

- **LIST stats:** the Premier League's official stats API (premierleague.com). All-time, complete
  per-player data. This is the PL's internal/undocumented API — free, no key, but not an official
  public product; fine for a personal non-commercial project.
- **Career paths:** Wikipedia player infoboxes (CC BY-SA 4.0).

Sources and retrieval dates are recorded in `public/data/manifest.json`. Current dataset: **1,644
questions** (354 list, 1,290 career) across two competitions — **Premier League** (1,105) and
**Champions League** (539) — covering 48 nationalities and 46 clubs. Questions are split **Standard**
(807) / **Hard** (837) across both formats (see difficulty tiers below).

> The career pool is bounded by best rank ≤500 across metrics; the Wikipedia crawl for the deepest
> (rarest) players is partial. Re-running `npm run build:data` resumes from cache and fills in more
> — coverage grows monotonically across runs.

**List sizing & quality floors.** A player only counts as a valid answer if they clear a per-metric
floor (goals ≥10, assists ≥5, appearances ≥50, clean sheets ≥10), so lists never pad with players
who barely recorded the stat. Each scope then asks for the largest tier that fits — **top 10 → 5 →
3** — or is dropped if fewer than 3 players qualify. E.g. "top 5 Algerian assist providers" (only 6
clear the floor) instead of a top-10 padded with 3-assist players. Clean-sheet lists are restricted
to goalkeepers.

**Difficulty tiers (clubs & countries).** Countries and clubs are curated into "major" vs the rest
(`MAJOR_COUNTRIES` / `MAJOR_CLUBS` in `scripts/question-templates.ts`). Major nations/clubs + overall
scopes are **Standard**, full 10 → 5 → 3. Lesser nations/clubs are **Hard-only** and capped at
**top 5** (5 → 3), because their rank 6–10 tail is too hard/unfun (e.g. no "top 10 Cameroonian
appearance makers" or "top 10 Charlton assisters" in Standard). ~16 clubs are major (the big six +
Everton, Villa, West Ham, Newcastle, Leeds, Leicester, Southampton, Forest, Wolves, Crystal Palace).

## Known limitations & roadmap

- **Premier League & Champions League only.** La Liga and World Cup categories (the data model
  supports them) need a different source — the pulselive API doesn't cover them.
- **Champions League has no per-club questions.** The API's team IDs are English-club-only, so CL is
  overall + per-country only.
- **CL assists & clean sheets are "since 2004/05".** pulselive only holds CL data from 2004/05; CL
  goals & appearances are fixed to all-time via Wikipedia, but no clean all-time source exists yet
  for CL assists/clean sheets. Roadmap: UEFA's own stats API (`compstats.uefa.com`) has all-time
  data for all metrics but returns only player IDs — pending a reliable ID→name resolver.
- **Undocumented API.** The pulselive stats API could change format without notice. Mitigated by
  build-time caching + validation; the shipped game reads only the generated JSON, so a break never
  affects players, only refreshes.
- **Wikipedia rate limits.** The career-path build hits Wikipedia per player and can get throttled
  (429). The fetch retries with backoff and caches, so re-running `npm run build:data` recovers any
  players skipped on a prior run (the cache makes repeat runs cheap).

**Out of scope (future):** multiplayer across devices; La Liga / World Cup categories; accounts and
persistent scoring (a per-question timer already ships in the share text, but there's no leaderboard).
