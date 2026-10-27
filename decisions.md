# Funge decisions

This file is the shared record of what is decided and what is not, so every chat and the repo agree.
Add to it whenever something is decided. Do not build anything listed as undecided.

## Decided

### Plan for v1
- Finish the built-in wallet roadmap, Steps 5 to 8 (winner and settle, speed, optional external wallet, hardening and docs), exactly as planned. Nothing new in between.
- Do not change the contracts until v1-grab is tagged.
- When Step 8 passes: commit, push, and tag the repo `v1-grab`, the demo-safe version.
- Step 8 Content-Security-Policy: keep the allowed connection sources in one easy-to-edit place. A referee server's address and its WebSocket must be allowed later, and a hard-coded policy would block them.

### Visible round timer with a referee server
- Status: decided. Starts after v1-grab is tagged.
- Everyone sees the same visible countdown.
- A small referee server must co-sign steal and settle.
- It works with the current Grab game.
- A numbered build prompt will be given only after v1-grab is tagged.

## Undecided

### Kingdom rebrand
- Idea: a gameplay rebrand to a kingdom concept (protect, conquer, take back your throne).
- Status: undecided. The rules are not final.
- Do not build any of it. Decided rules will be brought here when they are frozen.