# Funge: instructions for Claude Code

Funge is a kingdom game on Bitcoin Cash: CashScript contracts, a referee server for the clock, a Vite and
TypeScript front end with Tailwind, and an in-browser game wallet. Owner: Charles. Windows with Git Bash.

## Where things stand
Funge is live on chipnet. The landing page is at https://funge.cash (index.html) and the game at
https://funge.cash/play/ (play/index.html). The site is a Cloudflare Worker that rebuilds on every push to
`main`. The referee runs on Render (free plan) at https://referee.funge.cash and only updates when Charles clicks
Manual Deploy. Background reading: docs/RUNBOOK.md, docs/KINGDOM.md, docs/REFEREE.md, docs/EVENTS.md,
docs/KNOWN_ISSUES.md. The landing page's design is in DESIGN.md.

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