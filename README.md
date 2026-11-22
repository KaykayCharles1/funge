# Funge

**A fast-paced fantasy game on Bitcoin Cash where Kings and Queens battle for the treasury of Funge Kingdom. The last king at the end of a round wins it all.**

One kingdom, one throne, one PUSD treasury. Pay what the kingdom is worth to take the throne, raise its walls to make the next challenger pay more, and be the one on the throne when the clock runs out. Every move is a real Bitcoin Cash transaction, enforced by CashScript contracts. A referee server keeps the clock, but it can never decide who gets paid.

Built for **BCH BLAZE 2026**.

| | |
|---|---|
| Play (mainnet, real PUSD) | https://funge.cash |
| Try a demo round, no wallet needed | https://funge.cash/play/?mode=battlefield&demo=1 |
| Test site (chipnet, free test coins) | https://test.funge.cash |
| Presentation | [Google Slides](https://docs.google.com/presentation/d/1Mp6ganeNi_efnJHrHYXZPEYHYWe_ctCsJlwc_65o-iM/present?slide=id.p) |
| Earlier version of the project | https://github.com/KaykayCharles1/funge-pre-demo |
| Ember votes | `bitcoincash:zrrefj3c74fffqatf7l2cftfmr2p0xd8k5ma09clk2` |

## Try it in one minute

Open the **[demo round](https://funge.cash/play/?mode=battlefield&demo=1)**, or press **Play a demo round** in the bottom-left corner of the battlefield. It plays entirely in your browser with 50.00 demo PUSD. Nothing touches the chain, and you need no wallet.

King Satoshi holds the throne with one minute on the clock and raises his walls. Conquer him and he fights back: a few seconds later he takes the throne back and raises his walls twice more. Take it back once more and hold on until the clock hits zero to win the treasury. The prices, the clock and the protect rules are the real ones.

## How a round is played

- **Be the first king.** A new round waits for its first king, who pays the opening price of **5.00 PUSD** into the treasury. That becomes the kingdom's value.
- **Conquer.** Anyone can take the throne by paying the kingdom's value plus 2%. The king who loses the throne gets 92% of the value back, and 10% goes into the treasury. Every conquest makes the kingdom worth more.
- **Protect.** The king can raise the walls by 1, 2 or 5 PUSD, at most twice per reign, up to a value of 50.00. That money goes into the treasury and makes the next conquest cost more. Protecting closes in the last 30 seconds.
- **The clock.** A round starts with 5:00. Every conquest adds 0:30, never above 5:00. With under a minute left, a conquest adds 0:10 instead, never above 1:00. Protecting doesn't touch the clock.
- **Win.** When the clock runs out, the last king wins the whole treasury and a trophy NFT. The winner presses Claim. If nobody does, the referee settles the round by itself 30 seconds later. If the referee is ever gone, anyone can settle after 12 blocks, and the contract still pays the last king.
- **Cancel round.** While nobody has conquered yet, the first king may cancel the round and take the whole treasury back.

Full rules with worked examples: [docs/KINGDOM.md](docs/KINGDOM.md).

## Playing

**The battlefield.** The game is an animated battlefield built with Phaser. Armies march on the castle at every conquest, walls rise at every protect, and coins fly into the treasury. Each player chooses a name and a King or Queen portrait before their first move, and the top bar shows who holds the throne, its value, the treasury and the clock. Sound is off until you turn it on. An **Invite friends** button shares a link to the round.

**Two ways to pay:**
- **Game wallet.** A small wallet that lives in your browser, protected by a password, with your recovery phrase stored encrypted on your device. One tap per move, no pop-ups. It can swap and withdraw. Keep only what you play with in it, and back up the phrase.
- **Your own wallet, through WizardConnect.** Connect Paytaca, Cashonize or another WizardConnect wallet by scanning the QR code or copying the link. You approve each move in your wallet. The panel shows the balance across all of your wallet's addresses, the way your wallet app does.

**Getting PUSD.** The wallet panel has an in-game swap from BCH to PUSD and back, routed through Cauldron's pools. It shows the price impact and the network cost, and a **Swapped** card confirms each swap. It works with both kinds of wallet. On the test site, a faucet gives free test PUSD and BCH.

## How it works

- **The state contract** ([contracts/FungeKingdom.cash](contracts/FungeKingdom.cash)) holds the throne as an NFT. Its commitment stores the number of conquests, the king, the kingdom's value, the protects used this reign and a short mark of the previous king. It checks every payment: open, conquer, protect, cancel and settle.
- **The treasury contract** ([contracts/FungePot.cash](contracts/FungePot.cash)) holds the PUSD. It can only be spent in a transaction that also spends the throne.
- **The referee** ([server/](server/)) runs the clock. It signs moves that arrive before the deadline, plus one second of grace, and broadcasts them. The contract needs its signature to open, conquer, protect and settle early. The referee decides *when*, never *who gets paid*: the contract always pays the last king. It pushes every move to the page over a WebSocket, so all players see the same battle. See [docs/REFEREE.md](docs/REFEREE.md).
- **The page** builds each move in the browser and signs it with the player's wallet. The referee then adds its signature and broadcasts it. Chain data comes from several Electrum servers, and the page moves on to the next one if one fails.
- **New rounds are automatic.** The next round is always deployed in advance. When a round is settled, the page shows the winner for ten seconds, then switches to the prepared round without a reload. A GitHub workflow ([.github/workflows/next-round.yml](.github/workflows/next-round.yml), [scripts/next-round.ts](scripts/next-round.ts)) promotes the prepared round and deploys the one after it. The page triggers it when a round ends, and a schedule runs it as a backup.

## Mainnet and the test site

The network is one build setting, `VITE_FUNGE_NETWORK` (`mainnet` or `chipnet`, read in [src/config.ts](src/config.ts)). The page, the referee, the robot and the scripts all use it.

| | funge.cash | test.funge.cash |
|---|---|---|
| Network | BCH mainnet, real PUSD | chipnet, free test coins |
| Page | Cloudflare Worker `funge` | Cloudflare Worker `funge-test` |
| Referee | referee-mainnet.funge.cash | referee.funge.cash |

Both sites rebuild on every push to `main`. Each network has its own referee, its own referee key, its own deploy wallet and its own round files (`public/game.<network>.kingdom.json` and `public/game.<network>.next.json`).

## Run it locally

Needs Node 24, which runs the TypeScript scripts directly.

    npm install
    node scripts/gen-referee-key.ts      a chipnet referee key, saved in .referee.chipnet.json (ignored by git)
    node scripts/deploy-kingdom.ts       deploy a round from the creator wallet .wallet.chipnet.json (ignored by git)
    npm run server                       the referee, on 127.0.0.1:8787
    npm run dev                          the landing page on http://localhost:5173, the game on http://localhost:5173/play/?mode=battlefield

`npm run dev` runs chipnet. For mainnet, start it with `VITE_FUNGE_NETWORK=mainnet npm run dev`. To shorten the referee's wait before it settles a round while testing, use `FUNGE_KEEPER_DELAY_SECONDS=10 npm run server` (refused on mainnet).

## Tests

Offline (no network, no coins):

    node scripts/test-kingdom-contract.ts   the contracts on a mock chain
    node scripts/test-kingdom-act.ts        move checks, races, timing
    node scripts/test-rounds.ts             the round clock
    node scripts/test-clock.ts              the clock rule, the protect lockout, clock events
    node scripts/test-keeper.ts             automatic settlement
    node scripts/test-robot-plan.ts         the robot's next-round decisions
    node scripts/test-swap.ts               swap quotes, price impact, building the swap
    node scripts/test-wallet-coins.ts       finding an own wallet's coins across its addresses
    node scripts/test-mock-round.ts         the scripted round used for the animations
    node scripts/test-local-wallet.ts       the game wallet
    node scripts/test-vault.ts              encrypted seed storage
    node scripts/test-safelog.ts            secrets stay out of logs

There are more in [scripts/](scripts/), including live chipnet tests (`test-kingdom-live.ts`, `test-protect-live.ts`, `test-kingdom-fallback.ts`, `chaos-kingdom.ts`). These send real test transactions, so read each one's header first.

## Putting it online

The full checklist, what to do when something breaks, and the mainnet setup are in [docs/RUNBOOK.md](docs/RUNBOOK.md). `node scripts/preflight.ts https://<referee> https://<site>` checks a referee and a site without sending anything.

## Built with

CashScript 0.14, libauth, Cauldron (through `@cashlab/cauldron`), WizardConnect, Fastify, Phaser 3, Vite, TypeScript and Tailwind, with Electrum servers for chain data. The site runs on Cloudflare Workers and the referees on Render.

## More reading

- [docs/KINGDOM.md](docs/KINGDOM.md): the rules and the money, with examples
- [docs/REFEREE.md](docs/REFEREE.md): what the referee can and cannot do
- [docs/EVENTS.md](docs/EVENTS.md): the events the referee sends to the page
- [docs/RUNBOOK.md](docs/RUNBOOK.md): running Funge on mainnet and chipnet
- [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md): what is not finished
- [docs/journey.md](docs/journey.md): how Funge was built
