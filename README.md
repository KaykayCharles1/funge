# Funge

Funge is a last-holder-wins game on Bitcoin Cash. One NFT, the potato, sits in a smart contract. Anyone can take it by paying a rising price in PUSD, which goes into a shared pot. If nobody takes it for a set number of blocks, the current holder claims the whole pot and keeps a trophy NFT. Every state of the potato is generative art you can share as an image.

Built for the BCH BLAZE 2026 hackathon. Currently runs on chipnet (test coins); a mainnet round comes later.

## How it works
- **State contract** (`contracts/FungeState.cash`) holds the potato NFT. Its commitment stores the pass count and the holder. Each steal ("pass" in the code) must pay the next price into the pot and write the new holder.
- **Pot contract** (`contracts/FungePot.cash`) holds the PUSD. It can only be spent in a transaction that also spends the potato.
- **Settling** needs no signature: once the timeout has passed, anyone can send the pot to the holder and mint them the trophy. The fee comes from the BCH held inside the two contracts.
- The timeout counts **blocks**, so the countdown shown in the app is an estimate.

## Game wallet
The app includes a small wallet that lives in your browser, so playing needs no pop-ups and no second app. Your seed phrase is stored encrypted on your device (with an optional password); keep only what you play with in it and back up the phrase. An external wallet can still be connected through WizardConnect.

## Run it
Needs Node 20.19+ or 22.12+.

    npm install
    npm run dev

Config lives in `src/config.ts` (network, prices, timeout, servers). `public/game.chipnet.json` points the app at the deployed game.

## Scripts
    npx tsx scripts/test-contracts.ts      contract tests on a local mock chain
    npx tsx scripts/test-local-wallet.ts   wallet core tests
    npx tsx scripts/test-vault.ts          encrypted vault tests
    npx tsx scripts/deploy.ts              deploy a new game (chipnet)
    npx tsx scripts/smoke.ts status|pass|settle   chipnet smoke test

## Built with
CashScript 0.14, libauth, Vite, TypeScript, Tailwind. Electrum servers for chain data.

## How this was built
Every step was run and tested by the author on chipnet; `docs/JOURNEY.md` records the process, and `docs/KNOWN_ISSUES.md` lists what is not finished.