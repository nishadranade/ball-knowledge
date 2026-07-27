# Local Setup (macOS)

Instructions for running this project on a Mac from a fresh copy. Written for an agent or developer
doing the install locally.

## Prerequisites

- **Node.js 18 or newer** (developed on Node 20). Check with `node --version`.
  - Install via Homebrew: `brew install node`, or download from https://nodejs.org.
- npm (ships with Node).

## Steps

1. **Get the project onto the Mac.** Copy the whole project folder EXCEPT these regenerated /
   platform-specific dirs (they're in `.gitignore` and must not be copied):
   - `node_modules/` — reinstalled locally in step 2 (contains platform-specific binaries).
   - `dist/` — rebuilt on demand.
   - `scripts/.cache/` — Wikipedia response cache; optional, only speeds up `build:data`.

   The generated answer bank `public/data/questions.json` **is** committed and should be copied —
   the game runs from it immediately, no data fetch needed.

2. **Install dependencies:**
   ```bash
   cd soccer          # the project directory
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
npm test             # run the fuzzy-matcher unit tests (should be 17 passing)
npm run build        # regenerate data + typecheck + production bundle
npm run preview      # serve the production build locally
npm run build:data   # OPTIONAL: refresh public/data/questions.json from Wikipedia (~2 min)
```

## Verifying the install worked

- `npm test` → `Tests 17 passed (17)`.
- `npm run dev` → page titled "⚽ Ball Knowledge" with filter chips (All / Top-N lists / Career paths)
  and a question card. Try guessing a surname (e.g. on a "top goalscorers" question, type `Shearer`).

## Version note (not a problem on Mac)

`package.json` pins **Vite 4 / Vitest 0.34** because the ORIGINAL build host runs glibc 2.26, which
Vite 5's native Rollup binary can't load. **macOS is unaffected** — the pinned versions run fine on a
Mac, so no change is required.

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
- **Blank page / questions don't load** — confirm `public/data/questions.json` exists. If missing,
  run `npm run build:data` (needs internet to reach Wikipedia).
