# Funge

Funge is a last-holder-wins game on Bitcoin Cash. One NFT, the potato, sits in a smart contract. Anyone can grab it by paying a rising price in PUSD, which goes into a shared pot. Every grab restarts a 10-minute clock. When the clock runs out, the last holder wins the whole pot and keeps a trophy NFT. Every state of the potato is generative art.

Built for the BCH BLAZE 2026 hackathon. It currently runs on chipnet (test coins); a mainnet round comes later.

## How it works
- **State contract** (`contracts/FungeStateV2.cash`) holds the potato NFT. Its commitment stores the pass count and the holder. Each grab must pay the next price into the pot and write the new holder.
- **Pot contract** (`contracts/FungePot.cash`) holds the PUSD. It can only be spent in a transaction that also spends the potato.
- **The referee** is the Funge game server. It runs the round clock and signs grabs that arrive before the deadline (plus one second of grace). The contract requires its signature to grab and to settle early. The referee decides *when*, never *who gets paid*: the contract always pays the last holder. See `REFEREE.md`.
- **Settling:** when time is up, the winner presses Claim. If nobody does, the server settles by itself after two minutes. If the server is gone, anyone can settle after 12 blocks (144 for a round nobody has joined) and the last holder is paid.

## Two ways to play
- **Game wallet (recommended).** A small wallet that lives in your browser. One tap per grab, no pop-ups. Your seed phrase is stored encrypted on your device (with an optional password); keep only what you play with in it and back up the phrase.
- **Your own wallet (WizardConnect).** Connect a WizardConnect wallet such as Cashonize and approve each grab in it. Slower, because every grab waits for your approval.

Both ways build the grab in the browser and send it to the game server, which adds the referee's signature and broadcasts it.

## Run it
Needs Node 24 (it runs the TypeScript scripts directly).

    npm install
    node scripts/gen-referee-key.ts                 chipnet referee key; the private part goes in .referee.chipnet.json (git ignores it)
    node scripts/deploy-referee.ts <public key>     deploy a game from the creator wallet (.wallet.chipnet.json, git ignores it)
    npm run server                                  the referee server, on 127.0.0.1:8787
    npm run dev                                     the page, on http://localhost:5173

For quick tests, shorten the clock when starting the server (refused on mainnet):

    FUNGE_RESET_SECONDS=60 FUNGE_KEEPER_DELAY_SECONDS=60 npm run server

Config lives in `src/config.ts` (network, prices, servers). `public/game.chipnet.v2.json` points the page and the server at the deployed game.

## Tests
Offline (no network, no coins):

    node scripts/test-contracts-v2.ts      contracts on a mock chain
    node scripts/test-rounds.ts            the round clock
    node scripts/test-act.ts               grab validation, races, timing
    node scripts/test-keeper.ts            automatic settlement
    node scripts/test-store.ts             saved state and restarts
    node scripts/test-env.ts               server settings checks
    node scripts/test-safelog.ts           secrets stay out of logs
    node scripts/test-local-wallet.ts      game wallet core
    node scripts/test-vault.ts             encrypted seed storage

On chipnet (real transactions, against a running server; read the header of each script first):
`chaos-live.ts`, `chaos-restart.ts`, `chaos-busy.ts`, `test-act-live.ts`, `test-fallback-live.ts`.

## Putting it online
The page is static; the server needs a host with HTTPS.
- **Before going live:** `node scripts/preflight.ts https://<server> https://<page>` checks both ends without sending anything. The full checklist, what to do when something breaks, and the backup-server plan are in `RUNBOOK.md`.

- **Page:** `VITE_REFEREE_URL=https://<server address> npm run build`, then upload `dist/`.
- **Server:** `FUNGE_HOST=0.0.0.0`, `FUNGE_ALLOWED_ORIGINS=https://<page address>`, `FUNGE_TRUST_PROXY=1` (only behind the host's proxy), `REFEREE_KEY_CHIPNET` or `REFEREE_KEY_MAINNET` (the key, as a secret of the host), and `FUNGE_DATA_DIR` on a disk that survives restarts. The server refuses to start with unsafe combinations.

## Built with
CashScript 0.14, libauth, Fastify, WizardConnect, Vite, TypeScript, Tailwind. Electrum servers for chain data.

## How this was built
Every step was run and tested by the author on chipnet. `journey.md` records the process, `REFEREE.md` explains the round clock and what the server can and cannot do, and `KNOWN_ISSUES.md` lists what is not finished. The first, block-timeout version of the game is kept in the git tag `v1-grab`.