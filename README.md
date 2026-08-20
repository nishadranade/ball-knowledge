# ⚽ Ball Knowledge

A browser-based soccer quiz game covering the **Premier League** and **Champions League**, with four
question formats and forgiving answer matching.

**▶ Play it live: https://nishadranade.github.io/ball-knowledge/**

## Question formats

1. **Top-N lists** — "Name the top 5 goalscorers in Premier League history." N answers (more if
   tied); up to **3 wrong guesses**.
2. **Career paths** — a player's club-by-club career (years, club, apps, goals) is shown with the
   name hidden; **1 answer**, up to **2 wrong guesses**.
3. **Match scorers** — a real fixture shown in full (teams, score, date, competition round): name
   everyone who scored in it, with up to **3 wrong guesses**. The score frames the question rather
   than being part of it.
   - **One slot per distinct scorer**, not per goal — a brace is a single slot, with the goal count
     shown on reveal. So a 4–2 can have four slots, and the prompt says how many to name.
   - **Own goals are excluded** from the answers (the scorer plays for the other side, which makes a
     rotten answer) but are counted and disclosed, so the arithmetic still adds up.
4. **Starting XI** — a real fixture's line-up for one side, laid out on a pitch by shirt number and
   formation row: name all **11** starters, with up to **6 wrong guesses**. Drawn from the same
   fixture pool as match scorers (see below), one side per fixture chosen deterministically, always
   biased toward the recognizable side when only one side of the fixture is "big" (see below).

## Modes

- **Daily** — a shared Wordle-style challenge: everyone gets the **same** questions each day, picked
  deterministically from the calendar date (no backend) — a list, two career paths, a match, and (from
  **2026-08-20** onward) a starting XI. The day rolls over at **US Pacific midnight**
  (`America/Los_Angeles`, DST-aware), so all players share the same puzzle regardless of their own
  timezone. Play once per day, then **share a spoiler-free result** (emoji grid + "Ball Knowledge #N"
  + per-question time + a **points score** — see Scoring below) via the Web Share API / clipboard.
  Progress and a streak are kept in `localStorage`. Daily lists are trimmed to **top 5** to keep the
  round short.
- **Practice** — free-play endless deck with all the filters below. Finishing a question also offers
  a **shareable result + deep link** to that exact question (`?q=<token>`), so you can send a
  favourite question to a friend.

**Frozen dailies.** Each day's questions are appended to a committed
`public/data/daily.json` as *full question objects*, so a day that has been played can never change
underneath players when the data is regenerated. Days not yet frozen fall back to hashing the live
pool. See `scripts/build-daily.ts`.

## Scoring

The daily's results screen shows a **points score** (e.g. `268/300 pts`) alongside the emoji grid, so
friends who played the same day have a number to compare, not just a grid to eyeball —
`computeDailyScore` in `src/game/daily.ts`, a pure function of that day's stored `RoundResult`s.

**Accuracy**, per question:

| | Points |
|---|---|
| Each answer slot found | **+10** |
| Each wrong guess | **−3**, floored so a question can't score below 0 |
| Finished the question with zero wrong guesses | **+10** perfect-round bonus |

**Speed**, once per day — only awarded if *every* question in the day recorded a time (an old
result saved before per-question timing existed won't falsely look instant):

| Total time across the whole day | Bonus |
|---|---|
| under 1:30 | **+40** |
| under 3:00 | **+25** |
| under 5:00 | **+10** |
| 5:00 or more | none |

The `/max` half of the score is the best achievable on that exact set of results — it varies with the
day's question/slot count, which has grown over time (career2, then match, then squad from
2026-08-20), so it's computed alongside the score rather than being a fixed constant.

**No backend, no leaderboard.** The score is computed client-side and compared by pasting share text,
the same way the emoji grid already is — there's nowhere it's collected or ranked across visitors. See
[Known limitations & roadmap](#known-limitations--roadmap).

`.github/workflows/freeze-daily.yml` runs this nightly at 09:30 UTC (after Pacific midnight
year-round) and commits the result, so the unfrozen window stays one day rather than growing until
someone remembers. The freeze is append-only, so it can never disturb a day already recorded.

Each slot is **optional in the frozen schedule**, which is what lets the daily grow without
rewriting history: a day frozen before `career2`, `match` or `squad` existed simply lacks that key and
stays the length it was actually played at — days before **2026-08-20** have no `squad`, for instance.
Each slot also draws on its own hash salt, so adding one never shifts the others.

**Share links don't spoil answers.** A link is only obfuscated when its id would otherwise spell an
answer. List and match ids restate what's already on screen (the prompt; the fixture and date), so
they stay readable. Career-path ids *are* the player's name, so those use an **opaque hash token** —
`?q=ckkzpn`, not `?q=career_alan_shearer` (`questionParam` in `src/game/daily.ts`).

## Filters (Practice)

Filter by **competition** (Premier League / Champions League), **format** (lists / career paths /
match scorers / starting XI), and **difficulty**. **Difficulty applies to every format:** **Standard**
is approachable — famous career players (best rank ≤200), lists for major clubs/nations + overall
(full top 10), and matches/squads from the last 5 years. **Hard** adds rarer career players (rank
201–500), lists for lesser clubs/countries (capped at top 5, so their obscure rank 6–10 tail never
shows in Standard), and older matches/squads. The daily challenge is always Standard-only.

**Answer matching is forgiving:** a surname alone is enough, diacritics are optional
(`Ozil` = `Özil`), and minor typos are tolerated (`Lamperd` → Lampard). A **first name** on its own
also counts, for players nobody calls by their stored surname (`Vinicius` for Vinícius Júnior,
`Alisson` for Alisson Becker). Name fragments don't — `van` alone won't answer van Persie.

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
  fetch/plFixtures.ts        pulselive fixtures + per-match events → named, team-attributed scorers; + starting XIs/formations
  fetch/matchFilters.ts      "is this fixture worth asking about" — shared by build-matches.ts and build-squads.ts
  build-questions.ts         orchestrates: per-competition banks → generate → validate → write JSON
  build-matches.ts           MATCH questions only; rewrites just q-match.json, leaving list/career untouched
  build-squads.ts            SQUAD questions only; rewrites just q-squad.json
  build-daily.ts             append-only freeze of daily.json (epoch → today); never rewrites a past day
  bank.ts                    read/write the per-format bank files (single source of truth)
public/data/q-list.json      generated LIST questions   \
public/data/q-career.json    generated CAREER questions  \
public/data/q-match.json     generated MATCH questions   > fetched per view, not all at once
public/data/q-squad.json     generated SQUAD questions   /
public/data/daily.json       frozen per-day challenge (full question objects)
public/data/manifest.json    sources, retrieval dates, generated counts
src/
  game/types.ts              shared contract between pipeline and UI
  game/matching.ts           fuzzy last-name matcher (normalize + Levenshtein)
  game/useGame.ts            round state (lives, found answers, win/lose) — clock-free reducer
  game/daily.ts              date→question selection, frozen-schedule resolution, share text, deep links
  game/loadQuestions.ts      lazy per-format bank fetches + the policy for which are needed
  components/                ListQuestion, CareerPathQuestion, MatchQuestion, SquadQuestion, GuessInput, Lives, QuestionRouter, DailyView
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
- **MATCH questions** — the same pulselive API, via two endpoints: `/fixtures` (teams, scores, and a
  `goals[]` of person ids) to decide which matches qualify, then `/fixtures/{id}` for the ones that
  do, whose `teamLists` turn those ids into named scorers attributed to a side. A fixture whose
  scorer can't be found in either team list is dropped rather than shipped with a gap.

  Covered: the last 15 seasons, filtered so the fixture is one a fan would plausibly remember —

  | Fixture | Kept when |
  |---|---|
  | PL, **big vs big** | always — the marquee games |
  | PL, **big vs anyone else** | 3+ goals, **or** the non-big side won (an upset is memorable however few goals it took) |
  | PL, neither side big | never |
  | **Champions League** | knockout ties (the round is its own quality filter, and it avoids brittle matching on European club names) |

  "Big" is Arsenal, Chelsea, Liverpool, Manchester City, Manchester United, Tottenham Hotspur.
  Everything additionally needs **at least one nameable scorer**, which drops 0–0s and the freak
  game decided entirely by own goals.
- **SQUAD questions** — the same fixture-detail response MATCH uses also carries each side's
  `teamLists[].formation` (e.g. `{label: "4-3-3", players: [[gk],[def...],[mid...],[fwd...]]}`) and
  each starting player's shirt number and position, so no new API surface was needed. Draws from the
  same base fixture pool as MATCH (`fetch/matchFilters.ts` `qualifies()`), plus one filter of its own:
  naming a full unfamiliar starting XI is a bigger ask than naming a scorer, so
  - **PL** stays BIG_SIX-only, same as MATCH.
  - **CL** additionally requires a marquee side — BIG_SIX **or** a continental heavyweight
    (`BIG_EUROPE`: Real Madrid, Barcelona, Atlético Madrid, Bayern Munich, Dortmund, PSG, Juventus,
    Inter, Milan) — where MATCH asks about any knockout tie regardless.
  - **Which side gets asked about**: if only one side of the fixture is big, it's always THAT side
    (Bodø/Glimt vs Man City always asks Man City's line-up, never Bodø/Glimt's). Only when both sides
    are big does it fall back to a deterministic coin flip (hashed from the fixture, not
    `Math.random()`, so the build stays reproducible).

  A fixture whose formation doesn't resolve to a clean, fully-numbered 11 is dropped rather than
  shipped with a gap.

The PL API is undocumented/internal, so the pipeline insulates the game from it: it's called at
build time only, every response is cached on disk, and output is validated before the bank is
written. If the API ever changes, the shipped game keeps working from the last generated JSON.

## Commands

> **Running it locally (e.g. on a Mac)?** See [SETUP.md](./SETUP.md) for step-by-step install
> instructions, including which folders to copy and a version note for macOS.

```bash
npm install          # first-time setup
npm run dev          # dev server
npm run build:data   # regenerate the whole bank + daily.json (PL API + Wikipedia; several min cold cache)
npm run build:matches # regenerate ONLY q-match.json (MATCH_SEASONS=n to limit)
npm run build:squads  # regenerate ONLY q-squad.json (SQUAD_SEASONS=n to limit); cheap after build:matches
npm run build:daily  # freeze today's daily into public/data/daily.json (append-only)
npm run build:app    # typecheck + production bundle (uses the committed bank)
npm run build        # build:data + build:app (full local rebuild)
npm test             # run tests (matcher, daily/share/links, generated-data guards)
npm run preview      # serve the production build
```

## Deployment

Pushing to `main` auto-deploys to **GitHub Pages** via `.github/workflows/deploy.yml`
(→ https://nishadranade.github.io/ball-knowledge/). CI runs `build:app` only — it ships the
**committed** `public/data/q-*.json` bank and never calls the live data pipeline. Vite's `base` is
`/ball-knowledge/` (override with the `BASE_PATH` env var for other hosts, e.g. `BASE_PATH=/`).

Pull requests run `.github/workflows/ci.yml` (`npm ci` → `npm test` → `npm run build:app`) without
deploying. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the PR workflow.

> ### ⚠️ Pages must deploy from **GitHub Actions**, not from a branch
>
> Settings → Pages → Source must stay on **GitHub Actions** (`build_type: workflow`). If it is set
> to *"Deploy from a branch"* instead, GitHub serves the **repo root verbatim** — and the root
> `index.html` is the Vite *source* file, which loads `/src/main.tsx` (nonexistent in a build) and
> expects data at `data/`, not `public/data/`. The result is a blank page with
> `Loading module … was blocked because of a disallowed MIME type ("text/html")` in the console.
>
> The trap is that **both publishers can be active at once and race**, with the last one to finish
> winning — so `deploy.yml` goes green while the legacy build quietly overwrites it. This broke the
> live site on 2026-08-09. Check with:
>
> ```bash
> gh api repos/nishadranade/ball-knowledge/pages --jq .build_type   # must be "workflow"
> ```
>
> and fix with `gh api -X PUT repos/nishadranade/ball-knowledge/pages -f build_type=workflow`, then
> re-run the deploy. `deploy.yml` now smoke-checks the live URL after publishing and fails if the
> served HTML references `/src/main.tsx` or the JSON files 404, so this can't regress silently again.
> (`public/.nojekyll` is a leftover from the old branch-based setup — harmless, and not a sign that
> branch publishing is intended.)

**To refresh the data:** run `npm run build:data` locally, commit the updated
`public/data/q-*.json`, and push — the next deploy ships it.

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

Sources and retrieval dates are recorded in `public/data/manifest.json`. Current dataset: **5,963
questions** (354 list, 1,290 career, 2,342 match, 1,977 squad) across two competitions — **Premier
League** (4,739) and **Champions League** (1,224) — covering 48 nationalities, 46 clubs, and matches
from **2012-08-18 to 2026-05-30**. Questions are split **Standard** (2,558) / **Hard** (3,405) across
all four formats (see difficulty tiers below).

**The bank is split by format and fetched lazily**, because one combined file would mean every
visitor downloaded all **10.4 MB** of it before the game could start — most visitors play the
**frozen** daily, which needs none of it.

| File | Size | Fetched when |
|---|---|---|
| `daily.json` | 34 KB | always, first — a **frozen** day carries its questions as full objects and needs nothing else |
| `q-list.json` | 0.5 MB | Practice with lists (or All), an unfrozen daily, or a list deep link |
| `q-career.json` | 2.1 MB | Practice with career paths (or All), an unfrozen daily, or a career deep link |
| `q-match.json` | 2.6 MB | Practice with match scorers (or All), an unfrozen daily, or a match deep link |
| `q-squad.json` | 5.2 MB | Practice with starting XI (or All), an unfrozen daily, or a squad deep link |

So the default view — the daily — now costs **34 KB instead of 10.4 MB**. `formatsNeeded()` in
`src/game/loadQuestions.ts` is the single decision point and is unit-tested, including the rule that
nothing is fetched until the schedule says whether the day is frozen (guessing would defeat the
purpose). `DAILY_FORMATS` there names exactly the formats `selectDaily()` draws from — every format
today, since SQUAD joined the daily on 2026-08-20, but kept as its own list rather than reused from
`ALL_FORMATS` so a *future* practice-only format can't silently become an eager daily fetch just by
existing. Fetches are memoised per format, and failures deliberately aren't, so a later view retries.

> ⚠️ **Next payload concern: `daily.json` grows forever.** It's the one file every visitor fetches
> eagerly, and it gains a full day of question objects each night — roughly **1 MB/year** with the
> match question in every day, and set to grow faster still from 2026-08-20 onward, when a squad
> question (11 named, numbered players plus formation data) is added to every day's entry too. The
> fix is to serve one file per day (`data/daily/YYYY-MM-DD.json`) so the browser fetches only today's,
> falling back to live selection on a 404. Not urgent at 34 KB; will be within a year.

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

**Out of scope (future):** multiplayer across devices; La Liga / World Cup categories; accounts and a
real cross-visitor leaderboard. The daily score (`computeDailyScore`) is a genuine number now, but
it's computed client-side and compared by pasting share text, the same as the emoji grid — there's no
backend collecting or ranking it.
