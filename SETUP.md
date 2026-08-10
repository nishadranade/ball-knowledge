# Local Setup

Instructions for running this project on a fresh machine (written with macOS in mind, but the steps
are the same on Linux).

## Prerequisites

- **Node.js 18 or newer** (developed on Node 20). Check with `node --version`.
  - Install via Homebrew: `brew install node`, or download from https://nodejs.org.
- npm (ships with Node).

## Steps

1. **Clone the repo:**
   ```bash
   git clone https://github.com/nishadranade/ball-knowledge.git
   cd ball-knowledge
   ```
   The generated data (`public/data/q-*.json`, `daily.json`, `manifest.json`) is committed, so
   the game runs immediately — no data fetch needed. `node_modules/`, `dist/`, and the
   `scripts/.cache/` API cache are gitignored and don't need to be transferred.

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run the dev server:**
   ```bash
   npm run dev
   ```
   Open the printed URL (default http://localhost:5173).

That's it — the game loads with the pre-generated questions.

## Other commands

```bash
npm test             # unit tests (matcher, daily/share/links, generated-data guards)
npm run build:app    # typecheck + production bundle from the committed data
npm run build        # regenerate data + typecheck + production bundle
npm run preview      # serve the production build locally
npm run build:data   # OPTIONAL: refresh the data from the PL API + Wikipedia (several min cold cache)
```

## Verifying the install worked

- `npm test` → all tests pass (60 at the time of writing; the count grows with new features).
- `npm run dev` → page titled "⚽ Ball Knowledge" showing the **Daily** challenge, with a
  Daily/Practice switch. Switch to **Practice** for the filter chips (competition / format /
  difficulty) and try guessing a surname (e.g. on a "top goalscorers" question, type `Shearer`).

## Version note (not a problem on Mac)

`package.json` pins **Vite 4 / Vitest 0.34** because the machine the project was originally developed
on runs glibc 2.26, which Vite 5's native Rollup binary can't load. **macOS is unaffected** — the
pinned versions run fine on a Mac, so no change is required. Note that CI also builds with the pinned
versions, so if you upgrade locally, keep `package.json`/`package-lock.json` changes out of PRs unless
you intend to upgrade the project.

If you specifically want to upgrade to the latest Vite on the Mac (optional):
```bash
npm install -D vite@latest vitest@latest @vitejs/plugin-react@latest
npm test && npm run build   # retest after upgrading
```
Do this only if desired; the app works as-is without it.

## Troubleshooting

- **`npm install` errors about a native module / glibc** — that's the host-specific issue above; it
  should NOT occur on macOS. If it does, delete `node_modules/` and `package-lock.json` and retry
  `npm install`.
- **Port 5173 in use** — Vite will pick the next free port and print it; use that URL. Or run
  `npm run dev -- --port 3000`.
- **Blank page / questions don't load** — confirm `public/data/q-list.json` and its siblings exist. If missing,
  run `npm run build:data` (needs internet to reach the PL API + Wikipedia).
- **Assets 404 under `npm run preview`** — the production `base` is `/ball-knowledge/`, so the preview
  URL includes that path (`http://localhost:4173/ball-knowledge/`). For a root-path build, run
  `BASE_PATH=/ npm run build:app`.
