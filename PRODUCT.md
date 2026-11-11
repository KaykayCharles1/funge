# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences, served equally by the landing page:

- **Hackathon judges** (BCH BLAZE 2026), scanning many entries in a few minutes. They need to grasp what Funge is, see that it is new on Bitcoin Cash, and see that it really works.
- **Players**, people with a Bitcoin Cash wallet who may put PUSD on the throne. They need to understand the rules quickly, trust the game with their money, and know how to start.

## Product Purpose

Funge is a king-of-the-hill game on Bitcoin Cash. There is one throne and one shared pool of PUSD (a stablecoin). Anyone can pay to conquer the throne; when the clock runs out, the last king takes the whole pool and a trophy NFT. Success: a visitor understands the rules in seconds and joins the live battle.

## Positioning

The lead claim is **simple, fair rules** (confirmed):

- One throne, one clock, one shared PUSD pool.
- The first king opens the round for 10.00 PUSD; all of it goes into the pool.
- A conquest costs the throne's value plus 2%. The dethroned king gets 90% of the value plus that 2% back; the rest goes into the pool.
- Every conquest adds a minute to the clock (up to 10:00). The king may protect the throne (1, 5 or 10 PUSD into the pool, twice per reign, not in the last 30 seconds).
- When the clock runs out, the last king takes the whole pool and a trophy NFT.
- Before anyone conquers, the king may cancel the round and take the whole pool back.

Supporting truths (true from the code, may appear but do not lead): the Bitcoin Cash contract itself pays the last king, the referee server only runs the clock, and anyone can settle a round after 12 quiet blocks if the server disappears. Rounds play out on a live animated battlefield with four houses, armies, chosen names and portraits.

## Operating Context

- The landing page is a separate page from the game. Its main action is **"Join live battle"**, which leads to the battlefield page (`?mode=battlefield`), where players see the current king, the pool, the time left and the soldiers fighting.
- The landing page shows no live round data for now; live data belongs to the battlefield page.
- Players play with the in-browser game wallet or their own wallet through WizardConnect (e.g. Cashonize).
- The landing page does not mention the network (chipnet or mainnet); network details stay on the game page.

## Capabilities and Constraints

- Stack: Vite + TypeScript + Tailwind, in this repository. Work on the `landing` branch.
- All player-facing words live in `src/copy.ts`.
- No CDNs and no externally hosted fonts. Font files hosted with the site under an open licence (such as OFL) are allowed.
- Dependencies stay pinned; new ones are announced to the owner before they are added.
- Do not touch the contracts, the referee server, `src/wallet/` or the event format without the owner's say-so.

## Brand Commitments

- Name: **Funge**. Current tagline in the game: "Take the throne. The last king standing wins the pool."
- Money is called **PUSD**; the shared money is "the pool" (the battlefield calls it the Treasury).
- Four houses, each with a colour: violet, crimson, obsidian, sapphire. Players choose a portrait (King or Queen) and a name.
- Voice in the existing copy: plain, short, direct sentences; no hype.
- Approved hero image: `C:\Users\HP\Pictures\Funge Insp\funge animation\face-forward-4k.png` (4096 x 2313): open sky in the top 40%, a neutral silver-flagged castle low in the centre, four house armies on roads converging on it. Its source and an unupscaled prepared copy are next to it.

## Evidence on Hand

- The working game: battlefield page, live chipnet rounds played end to end (open, protect, conquer, take back, cancel, claim), contract and referee tests.
- Game art: `public/assets/` (portraits of 10 kings and queens, four house soldiers, castle, keep, walls, field by day and dusk, treasure, icons) and the source art in `art-source/` (git-ignored).
- Rules and mechanics: `docs/KINGDOM.md`, `docs/REFEREE.md`, `README.md`.
- None of these exist and must not be invented: player counts, volumes, testimonials, press, partners, audits, prize wins.

## Product Principles

1. The rules fit in a breath: say them plainly and let them be the hook.
2. Show the real game, never a stand-in: real art, real mechanics, real flows.
3. Earn trust with facts, not adjectives: who pays, how much, when.
4. One clear next step: join the live battle.

## Accessibility & Inclusion

Keep the game's existing standards: keyboard access, visible focus, labels on controls, touch targets of at least 44 px, readable contrast, and motion that respects reduced-motion settings.
