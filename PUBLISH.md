# Publishing footy-quiz to GitHub + GitHub Pages

Handoff instructions for setting up the public repo and live site. Written for an agent (or
developer) working on the local machine where the GitHub account is authenticated.

**Target:**
- GitHub owner/user: `nishadranade`
- Repo name: `footy-quiz` (Public)
- Live URL after setup: **https://nishadranade.github.io/footy-quiz/**

## Current state (already done in this workspace)

The project is fully prepared and committed locally — do **not** redo these:
- Git repo initialized; one commit exists on branch `main`.
- Repo-local git identity is set to `Nishad Ranade <nishadranade@users.noreply.github.com>`
  (keeps the real email private). Leave it as-is.
- `LICENSE` (MIT), `README.md`, `.gitignore` present. No secrets/`.env` in the tree.
- `.github/workflows/deploy.yml` — GitHub Actions workflow that builds and deploys to Pages on
  every push to `main`.
- `vite.config.ts` has `base: '/footy-quiz/'` so assets resolve under the Pages project path.
- CI ships the committed `public/data/questions.json` (it runs `build:app`, NOT the live data
  pipeline).

There is **no git remote** configured yet. That's the main thing to add.

## Prerequisites

- The machine must be authenticated to GitHub as `nishadranade` (via `gh auth login`, or an SSH key,
  or a credential helper / personal access token for HTTPS).
- Run all commands from the project root (the directory containing `package.json` and `.git`).

## Step 1 — Create the GitHub repo and push

**Option A — using the GitHub CLI (`gh`), if installed and authenticated:**
```bash
gh repo create nishadranade/footy-quiz --public --source=. --remote=origin --push
```
This creates the repo, adds it as `origin`, and pushes `main` in one step.

**Option B — manual (no `gh`):**
1. Create an empty repo at https://github.com/new
   - Owner: `nishadranade`, Name: `footy-quiz`, Visibility: **Public**
   - Do NOT initialize with a README, .gitignore, or license (they already exist here).
2. Add the remote and push:
   ```bash
   git remote add origin https://github.com/nishadranade/footy-quiz.git
   git push -u origin main
   ```
   (For SSH instead: `git remote add origin git@github.com:nishadranade/footy-quiz.git`)

## Step 2 — Enable GitHub Pages (via Actions)

1. Go to the repo on github.com → **Settings** → **Pages**.
2. Under **Build and deployment** → **Source**, select **GitHub Actions**.
   (Do NOT pick "Deploy from a branch" — this project deploys via the included Actions workflow.)

## Step 3 — Trigger / confirm the deploy

- The push in Step 1 should already have triggered the **"Deploy to GitHub Pages"** workflow.
- Check the repo's **Actions** tab: the `build` job (npm ci → test → build:app) then `deploy` should
  both go green.
- If it didn't run (e.g. Pages source was set after the push): Actions tab → "Deploy to GitHub
  Pages" → **Run workflow** on `main`.
- When `deploy` finishes, the site is live at **https://nishadranade.github.io/footy-quiz/**.

## Verification

- Open https://nishadranade.github.io/footy-quiz/ — it should load the quiz (title "⚽ Soccer
  Quiz"), show competition + format filter chips, and a question card.
- Reload a couple of times: the first question should differ (order is randomized per session).
- Click **Champions League** → the deck count should shrink (CL-only questions).

## Troubleshooting

- **404 at the site URL:** confirm Pages Source = "GitHub Actions" (Step 2) and the `deploy` job
  succeeded. First deploy can take a couple of minutes to propagate.
- **Blank page / assets 404 in console:** the repo name must match the Vite `base`. This is set to
  `/footy-quiz/` in `vite.config.ts`. If the repo is named something else, update `base` to
  `'/<repo-name>/'`, commit, and push.
- **Workflow fails on `npm ci`:** ensure `package-lock.json` is committed (it is) and the runner
  uses Node 20 (the workflow pins this).
- **Auth failure on push:** run `gh auth login`, or set up an SSH key / PAT for the `nishadranade`
  account, then retry the push.

## Later: refreshing the quiz data

CI does not regenerate data. To update players/stats:
```bash
npm run build:data        # re-fetches from the PL/CL API + Wikipedia (several min on cold cache)
git add public/data/questions.json public/data/manifest.json
git commit -m "Refresh question data"
git push                  # next deploy ships the new data
```
