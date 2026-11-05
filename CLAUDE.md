# Funge: instructions for Claude Code

Funge is a kingdom game on Bitcoin Cash: CashScript contracts, a referee server for the clock, a Vite and
TypeScript front end with Tailwind, and an in-browser game wallet. Owner: Charles. Windows with Git Bash.

## Current job
Build the animated battlefield on the branch `animation`. Read these first: docs/ANIMATION_BRIEF.md,
docs/EVENTS.md, docs/KINGDOM.md, docs/REFEREE.md, docs/KNOWN_ISSUES.md. Follow the steps in the brief one
at a time.

## Commands (confirm against package.json)
- Install: npm install
- Dev server: npm run dev (http://localhost:5173)
- Build: npm run build
- Preview the production build: npm run preview (http://localhost:4173)
- Tests: scripts/test-kingdom-act.ts and scripts/test-mock-round.ts (see package.json for how they run)

## Working rules
- Work only on the `animation` branch. Small commits. Do not push or merge to main without my say-so.
  Merge main into animation only when I ask.
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