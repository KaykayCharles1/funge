# Funge

Funge is a king-of-the-hill game on Bitcoin Cash. One throne, one shared pool of PUSD. Pay to conquer the throne: the king you dethrone is paid back most of what their throne was worth, and a small share goes into the pool. When the clock runs out, the last king takes the whole pool and a trophy NFT. Every conquest makes the clock shorter.

Built for the BCH BLAZE 2026 hackathon. It currently runs on chipnet (test coins); a mainnet round comes later.

## How it works
- **State contract** (`contracts/FungeKingdom.cash`) holds the throne as an NFT. Its 40-byte commitment stores the pass count, the king, the throne's value, the protects used this reign and a short mark of the previous king. It enforces every payment: open, conquer, protect and settle.
- **Pot contract** (`contracts/FungePot.cash`) holds the PUSD pool. It can only be spent in a transaction that also spends the throne.
- **The referee** is the Funge game server. It runs the round clock and signs moves that arrive before the deadline (plus one second of grace). The contract requires its signature to open, conquer, protect and settle early. The referee decides *when*, never *who gets paid*: the contract always pays the last king. See `docs/REFEREE.md`.
- **Money:** the full rules and worked examples are in `docs/KINGDOM.md`. In short: open pays 10.00 PUSD into the pool; a conquest costs the throne's value plus 2%; the dethroned king gets 90% of the value plus the 2%; the pool gets the rest; the king can protect (add 1, 5 or 10 PUSD to the value, at most twice per reign, up to a cap of 50.00) but not in the last 30 seconds.
- **Clock:** 10:00 at the open, 30 seconds shorter with every conquest, never below 2:00 (the demo setting starts at 5:00).
- **Settling:** when time is up, the winner presses Claim. If nobody does, the server settles by itself after two minutes. If the server is gone, anyone can settle after 12 blocks and the last king is paid. A round where only the opener played pays the opener back.

## Two ways to play
- **Game wallet (recommended).** A small wallet that lives in your browser. One tap per move, no pop-ups. Your seed phrase is stored encrypted on your device (with an optional password); keep only what you play with in it and back up the phrase.
- **Your own wallet (WizardConnect).** Connect a WizardConnect wallet such as Cashonize and approve each move in it. Slower, because every move waits for your approval.

Both ways build the move in the browser and send it to the game server, which adds the referee's signature and broadcasts it.

## Run it
Needs Node 24 (it runs the TypeScript scripts directly).

    npm install
    node scripts/gen-referee-key.ts                 chipnet referee key; the private part goes in .referee.chipnet.json (git ignores it)
    node scripts/deploy-kingdom.ts                  deploy a game from the creator wallet (.wallet.chipnet.json, git ignores it); uses that key
    npm run server                                  the referee server, on 127.0.0.1:8787
    npm run dev                                     the page, on http://localhost:5173

For quick tests, shorten the keeper wait when starting the server, and use the 5:00 demo clock (both refused on mainnet, the keeper wait only):

    FUNGE_KEEPER_DELAY_SECONDS=60 FUNGE_BELL_PRESET=demo npm run server

Config lives in `src/config.ts` (network, prices, servers). `public/game.chipnet.kingdom.json` points the page and the server at the deployed game. The server reads it only at start, so restart the server after every deploy.

## Tests
Offline (no network, no coins):

    node scripts/test-kingdom-contract.ts  the contract on a mock chain
    node scripts/test-rounds.ts            the round clock
    node scripts/test-bell.ts              the bell, protect lockout, clock events
    node scripts/test-kingdom-act.ts       move validation, races, timing, the round description
    node scripts/test-keeper.ts            automatic settlement
    node scripts/test-protect-coins.ts     protect coin selection
    node scripts/test-store.ts             saved state and restarts
    node scripts/test-env.ts               server settings checks
    node scripts/test-safelog.ts           secrets stay out of logs
    node scripts/test-local-wallet.ts      game wallet core
    node scripts/test-vault.ts             encrypted seed storage

On chipnet (real transactions, against a running server; read the header of each script first):
`test-kingdom-live.ts`, `test-protect-live.ts`, `test-kingdom-fallback.ts`, `chaos-kingdom.ts`.

## Putting it online
The page is static; the server needs a host with HTTPS.
- **Before going live:** `node scripts/preflight.ts https://<server> https://<page>` checks both ends without sending anything. The full checklist, what to do when something breaks, and the backup-server plan are in `docs/RUNBOOK.md`.

- **Page:** `VITE_REFEREE_URL=https://<server address> npm run build`, then upload `dist/`.
- **Server:** `FUNGE_HOST=0.0.0.0`, `FUNGE_ALLOWED_ORIGINS=https://<page address>`, `FUNGE_TRUST_PROXY=1` (only behind the host's proxy), `REFEREE_KEY_CHIPNET` or `REFEREE_KEY_MAINNET` (the key, as a secret of the host), and `FUNGE_DATA_DIR` on a disk that survives restarts. The server refuses to start with unsafe combinations.

## Built with
CashScript 0.14, libauth, Fastify, WizardConnect, Vite, TypeScript, Tailwind. Electrum servers for chain data.

## How this was built
Every step was run and tested by the author on chipnet. `docs/journey.md` records the process, `docs/REFEREE.md` explains the round clock and what the server can and cannot do, and `docs/KNOWN_ISSUES.md` lists what is not finished. The first, block-timeout version of the game is kept in the git tag `v1-grab`, and the steal game that ran on the referee clock before Kingdom in the tag `v2-steal-timer`.