# Funge: instructions for Claude Code

Funge is a kingdom game on Bitcoin Cash: CashScript contracts, a referee server for the clock, a Vite and
TypeScript front end with Tailwind, and an in-browser game wallet. Owner: Charles. Windows with Git Bash.

## Where things stand
Funge is live on mainnet at https://funge.cash (a small-stakes hackathon demo) and on chipnet, with free test coins,
at https://test.funge.cash. The landing page is index.html and the game is /play/ (play/index.html). Each site is a
Cloudflare Worker that rebuilds on every push to `main` (wrangler.jsonc: Worker `funge` for mainnet, `funge-test`
for chipnet; worker/index.ts serves dist and adds one route). The network is the build setting VITE_FUNGE_NETWORK
(default chipnet; src/config.ts). Each network has its own referee on Render (free plan): mainnet at
https://referee-mainnet.funge.cash, chipnet at https://referee.funge.cash. UptimeRobot keeps them awake.

New rounds are automatic, and the next one is always prepared in advance:
- public/game.<network>.kingdom.json is the current round; public/game.<network>.next.json is the next round, already
  deployed and waiting. The referee reads both from the published site every 10 s (Render setting FUNGE_GAMES_URL)
  and refuses to open the next one until the current one is settled.
- When a round is settled, the page shows the winner for 10 seconds, then switches to the prepared round, without a
  reload. It also POSTs funge.cash/next-round; the Worker checks the referee and, if the round is settled, starts the
  GitHub workflow .github/workflows/next-round.yml (Cloudflare secret GITHUB_TOKEN). A 15-minute schedule is a backup.
- The workflow runs scripts/next-round.ts (decisions in scripts/robot-plan.ts): it promotes the prepared round to
  current once the current one is settled, deploys a new prepared round with deploy-kingdom.ts --next (paid by a
  separate deploy wallet per network, GitHub secrets FUNGE_DEPLOY_SEED and FUNGE_DEPLOY_SEED_MAINNET), and commits
  the files to `main` as github-actions[bot]. The schedule runs both networks; a run by hand picks one. Render's
  deploy hooks (RENDER_DEPLOY_HOOK, RENDER_DEPLOY_HOOK_MAINNET) are used only when a referee has not picked a file up
  for 5 minutes.
- Because the robot commits to `main`, run `git pull` before starting work.
- Test scripts/next-round.ts with `--check` only: a plain run really deploys rounds (paid by the deploy wallet; on
  mainnet with real BCH).
- Manual fallback: GitHub, Actions, Next round, Run workflow (tick "Rule change" only after a contract or PUSD change).

Background reading: docs/RUNBOOK.md, docs/KINGDOM.md, docs/REFEREE.md, docs/EVENTS.md, docs/KNOWN_ISSUES.md.
The landing page's design is in DESIGN.md.

## Commands (confirm against package.json)
- Install: npm install
- Dev server: npm run dev (landing page http://localhost:5173, game http://localhost:5173/play/)
- Build: npm run build
- Preview the production build: npm run preview (http://localhost:4173)
- Tests: scripts/test-kingdom-act.ts and scripts/test-mock-round.ts (see package.json for how they run)

## Working rules
- `main` is the live site: every push to it goes to funge.cash. Small changes (wording, a colour, a spacing
  fix) go on `main`; build and check them with `npm run build && npm run preview` before pushing. Bigger changes
  (a new section, a new feature) go on their own branch and are merged into `main` when finished.
- Small commits. Do not push to main, or merge into it, without my say-so.
- One step at a time. After each step: say what changed, how to run it, and wait for my OK.
- Commit messages must show only my authorship. Never add Co-Authored-By, Claude-Session or any Claude
  attribution to commit messages or commit commands.
- Never read, print or commit secrets: .env files, wallet or seed files, keys. If you need one, ask me.
- Verify library APIs against installed typings or docs. Do not guess.
- Do not touch: the contracts folder, the referee server, src/wallet/, the steal code, or the event format.
  If a change there seems needed, stop and tell me.
- No CDNs and no external fonts. Keep dependencies pinned, and tell me before adding any.
- All player-facing words come from src/copy.ts.
- Keep it simple: fewer files, plain code.