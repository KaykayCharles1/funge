# Game page redesign: build checklist

The spec is the approved mockup: https://claude.ai/artifact/2gH3dsxYuWxnHPEFp1HYBs
(laptop board `project/Main.dc.html`, phone board `project/Phone.dc.html`). This list names every screen, state,
button and message in it, so each one can be ticked off as it is built. When this list and the mockup disagree,
the mockup wins.

- `[ ]` not built, `[x]` built and checked against the mockup.
- **new** = wording that is not in src/copy.ts yet; it goes there (all player-facing words live in src/copy.ts).
- Hover tooltips become a long press on phones.
- Unavailable actions fade (about 45% opacity) with the not-allowed cursor and no extra text, unless a line below
  says otherwise.
- Mockup-only controls are not built: the grey round/wallet bar, the Moments tray, and every grey "Mockup: …" button.

## 1. Battlefield frame

### Laptop (1440 wide)
- [ ] The field fills the screen (cover); a little sky and grass is cut, never the castle.
- [ ] Top left: Funge logo, links to the landing page.
- [ ] Timer box, left of the King box, same size and shape as the Treasury box: bell, label, clock.
  - [ ] Waiting: only `5:00`, no label.
  - [ ] Running: label `TIME LEFT`.
  - [ ] Ended: label `TIME IS UP`, clock `0:00` in gold.
  - [ ] Under 10 seconds the clock turns soft red. **new** (style only)
- [ ] `+0:30` in gold under the timer box after a conquest, for about 3.5 s (COPY.battlefield.clockAdded).
- [ ] King box, centred, 440×76:
  - [ ] No king: crown placeholder and `No king yet`.
  - [ ] A king: round portrait, name, `Throne value · 12.00 PUSD`, two shields at the right.
  - [ ] You: `King Arthur (you)`.
  - [ ] Ended: `Last king · wins the treasury`. **new**
  - [ ] A used protect dims one shield (grey, faded).
- [ ] Portrait in every round avatar: the full portrait cropped around the manifest face box, zoomed out to 1.45×
      the face size, so the whole face and crown show. Same crop wherever a round avatar appears (HUD, banners).
- [ ] Treasury box, right of the King box: chest, `TREASURY`, amount in gold.
- [ ] Top right, three round buttons: Invite friends, Sound on/off, Menu (hamburger; opens the side panel on Wallet).
      There is no Rules button and no Log button.
- [ ] Middle box, waiting: `Waiting for the first king` only, gold 2px border.

### Phone (390 wide, upright)
- [ ] Top strip 64px: bell + clock (left), round portrait + name + small line with throne value and two tiny
      shields (middle), chest + treasury (right). No TIME LEFT label.
- [ ] `+0:30` under the clock after a conquest.
- [ ] Field below the strip, castle centred, sides cut.
- [ ] Bottom area: the main button (or protect buttons) above one row: wallet chip, Invite, Sound, Menu.
- [ ] Middle boxes (waiting, ended, you won) narrower, same words.

## 2. Dock (laptop: a pill at the bottom centre; phone: the bottom area)

### Wallet chip (opens the wallet panel)
- [ ] Game wallet: PUSD icon + amount, BCH icon + amount, caret.
- [ ] WizardConnect: the same as the game wallet (PUSD icon, not the wizard hat).
- [ ] Locked: padlock + `Locked`. **new**
- [ ] No wallet: wallet icon + `No wallet yet` (COPY.battlefield.noWallet).
- [ ] The chip opens: game wallet home / WizardConnect screen / locked screen / Pick a Wallet.

### Main button
- [ ] Waiting: `Be the first king · 5.00 PUSD` (COPY.battlefield.pickConfirmOpen wording).
- [ ] Someone else is king: `Conquer the throne · 12.24 PUSD` (value + 2% fee, live). **new** (today `Conquer 12.24 PUSD`)
- [ ] Dethroned: `Take back your throne · 12.24 PUSD`.
- [ ] No wallet: `Connect a wallet to play`, opens Pick a Wallet. **new**
- [ ] Locked: `Unlock your game wallet`, opens the locked screen (COPY.battlefield.unlockWallet).
- [ ] Not enough PUSD: grey, not clickable, `Insufficient Amount`. **new** (replaces "You need X more PUSD")
- [ ] Not enough BCH for the fee: grey, `Insufficient BCH for the fee`. **new**
- [ ] Game server unreachable: grey, `Reconnecting…`. **new**
- [ ] Sending: grey, `Sending…`.
- [ ] WizardConnect approval: grey, `Approve in your wallet · 0:30 left` counting down, plus a `Cancel` button.
- [ ] Round ended: no dock, except the winner's Claim button (section 6).

### King's dock (you are king)
- [ ] Three protect buttons with a shield: `1`, `2`, `5`.
  - [ ] Hover / long press: `Protect with 1 PUSD`, `Protect with 2 PUSD`, `Protect with 5 PUSD`.
  - [ ] Fade, no text: two protects used this reign; over the 50 PUSD cap; last 30 seconds; wallet locked,
        disconnected or deleted; game server unreachable.
  - [ ] Fade with a tooltip: not enough PUSD → `Insufficient Amount`; not enough BCH → `Insufficient BCH for the fee`.
- [ ] `Cancel round` (one line), only for the first king before anyone conquers.
  - [ ] Hover / long press: `Get your 5.00 PUSD back` (COPY.battlefield.cancelRoundLine).
  - [ ] Fades, no text, while the wallet is locked, disconnected or deleted, or the server is unreachable.
  - [ ] While cancelling: `Sending…`.
- [ ] While a protect or cancel is on its way, the protect group is replaced by the grey `Sending…` /
      `Approve in your wallet · 0:28 left` button.

## 3. Choose your King or Queen (first move of a round only)
- [ ] Window over the battlefield, gold border: `Choose your King or Queen`.
- [ ] 10 portraits, 5 per row; the chosen one has a border in its house colour.
- [ ] A portrait another player holds: grey, faded, `Taken`, not clickable.
- [ ] Name box `Type your name`; problems in red under it: `Use 2 to 16 characters.`,
      `Use letters, digits, spaces, apostrophes or hyphens, with at least one letter.` (plus the existing link, word
      and taken messages).
- [ ] Preview card in the house colour: portrait, `King Arthur`, `House Crimson`.
- [ ] `Cancel` and the confirm button: `Be the first king · 5.00 PUSD` / `Conquer · 12.24 PUSD` /
      `Take back your throne · 12.24 PUSD`; lights up only with a valid name.
- [ ] Phone: same window near full screen, preview card above Cancel + confirm.
- [ ] Later moves in the same round skip the window.

## 4. Moves and their results
- [ ] Open: banner `You are the first to rule`; you become king (value 5.00, treasury 5.00, clock 5:00);
      Cancel round appears.
- [ ] Conquer: banner `You conquered King Blaze's kingdom · +0:30`; `+0:30` by the clock; clock never past 5:00;
      treasury + 10% of the value; you pay value + 2%; no Cancel round.
- [ ] Protect: banner `You protected YOUR kingdom with 1.00 PUSD`; value and treasury + amount; one shield dims;
      the conquer price rises with the value.
- [ ] Cancel round: banner `You cancelled the round. Pool returned`; back to waiting.
- [ ] Banner style: gold border, Grenze Gotisch, under the top bar, about 3.5 s; wraps on a phone.

## 5. Battlefield moments
- [ ] Dethroned: banner `King Blaze conquered YOUR kingdom · +0:30`; you get 90% of the value + the fee; main
      button `Take back your throne · …`.
- [ ] `One minute left` at 1:00.
- [ ] `Protect closed` at 0:30; protect buttons fade.
- [ ] `Ten seconds left` at 0:10; clock soft red.

## 6. End of the round
- [ ] Someone else won: `THE ROUND IS OVER` / `King Blaze wins 41.20 PUSD` / `Next round in 0:07`.
- [ ] You won: `THE ROUND IS OVER` / `You won the pool!` (gold, brighter border). No other lines.
  - [ ] Dock: only `Claim your reward` → `Claiming…` → banner `King Arthur wins 41.20 PUSD`; the box switches to
        the normal winner box.

## 7. Errors and connection
- [ ] Error banner style: red border, plain bold text, about 5.5 s; nothing is charged.
- [ ] `Someone moved first. Check the new price and try again.` **new** (changes COPY.errors.state_changed)
- [ ] `Too late: the clock ran out before your move arrived.`
- [ ] Other existing COPY.errors messages use the same banner.
- [ ] Server unreachable: strip under the top bar with a spinner, `Reconnecting to the game server…`; main button
      `Reconnecting…`; protect and Cancel round fade.

## 8. Invite
- [ ] Invite friends window: `Invite friends`, `Send this to a friend or a group:`, a box with the message
      (`King Arthur summons you to battle for the throne. Do you have what it takes to become the King of Funge?`)
      and the link (src/lib/invite.ts, unchanged) under it in gold.
- [ ] `Copy invite` → `Copied. Paste it in any chat.`
- [ ] One row: Telegram, WhatsApp, X, Discord as round official logos in their colours, then `Close` at the right.
      Discord has no share address: it copies the invite and opens Discord. **new**
- [ ] Clicking outside closes it. On a phone with a share sheet, the share sheet opens instead.
- [ ] Friend's banner (opened an invite link): `King Arthur summons you to battle for the throne.` /
      `Do you have what it takes to become the King of Funge?` / `Get free test coins` / ✕.
  - [ ] Phone: the ✕ on the same line as `Get free test coins`.
  - [ ] `Get free test coins` removes the banner and opens the wallet panel: connected → that wallet's screen;
        had a game wallet (locked or disconnected) → the locked screen; never had one → Pick a Wallet.

## 9. Side panel
- [ ] Laptop: 420px panel on the right. Phone: a bottom sheet with a grab handle.
- [ ] Tabs `Wallet` and `Rules` only (no Round details, no Log), and ✕.
- [ ] Clicking anywhere outside closes it (the first click only closes).

## 10. Wallet

### Pick a Wallet (no wallet, or after a disconnect)
- [ ] `Pick a Wallet`; rows `Funge Game Wallet` (crown) and `WizardConnect` (wizard hat logo on white). **new**
- [ ] Funge Game Wallet: had a wallet → locked screen; else the start screen.
- [ ] WizardConnect: straight to the QR screen.

### Funge Game Wallet start
- [ ] Back arrow and step dots; crown; `Funge Game Wallet`; `To get started, create a new wallet or import an
      existing one.`; `Create a New Wallet` (gold); `I Already Have a Wallet` (dark). No WizardConnect link. **new**

### Create
- [ ] `Create a password` / `You will use this to unlock your wallet.`; `Password` and `Confirm Password` with eye
      buttons; hint `At least 8 characters` / `The passwords don't match` / `Passwords match`; `Continue` lights up
      at 8+ characters and a match. No terms checkbox. A password is now required. **new**
- [ ] `Recovery Phrase`; gold `This phrase is the ONLY way to recover your wallet. Do NOT share it with anyone!`;
      12 words blurred under a crossed-out eye, shown only while the pointer is on them; cannot be selected,
      copied, dragged or right-clicked; `I saved my Recovery Phrase` checkbox; `Continue` lights up when ticked. **new**

### Import
- [ ] `Recovery Phrase` / `Import an existing wallet with your 12 or 24-word recovery phrase.`; 12 numbered boxes;
      Ctrl+V in a box fills the boxes from there (24 words open 24 boxes); `Import Wallet` lights up when every box
      has a word; then the password screen. No "24-word" toggle. **new**

### Home (game wallet)
- [ ] `FUNGE GAME WALLET`; at the right a round lock button (`Lock Wallet` on hover) then a round disconnect button
      (wallet with ✕, `Disconnect Wallet` on hover). **new**
- [ ] PUSD and BCH cards; address with `Copy` → `Copied`.
- [ ] `Swap` and `Withdraw` buttons.
- [ ] Faucet card `FREE TEST COINS` / `Claim 20 PUSD and 0.0002 BCH` / `Claim` → disabled `Next claim in 23:59:59`
      counting down. No "Sent …" line. **new**
- [ ] `Back up seed phrase` (small cream pill) and `Delete wallet` (small red pill). No WizardConnect link.

### Swap
- [ ] `‹ Wallet`; `Swap` centred with the gear at the right; settings only `Max slippage`, `Auto`, `0.5%`.
- [ ] Sell card with 25% / 50% / 75% / Max, flip, Buy card, rate and network cost, `Enter an amount` / `Review`.
- [ ] Review: `You're swapping`, Rate, Pool fee 0.3%, Network cost, Price impact, Max slippage, Route, `Swap`.
- [ ] No "Practice pool" line.

### Withdraw
- [ ] Heading `Withdraw` on every step.
- [ ] `BCH Address`; `PUSD` with `Max`; `BCH` with `Max`; `Withdraw`. Empty → `Enter how much PUSD or BCH to send.`
      No NFT checkbox. **new**
- [ ] `Confirm Transaction`: a PUSD line and/or a BCH line (only what was filled), To, Network fee; `Back` and
      `Withdraw`. No warning line. **new**
- [ ] `Transaction Successful` + `View on the testnet explorer ↗` (explorer to be chosen) + `Done`. **new**

### Back up seed phrase
- [ ] Password dialog `Backup Seed Phrase` / `Enter the password to confirm` / `Cancel` / `Confirm`.
- [ ] `Backup Seed Phrase`; red warning `This Seed Phrase is the credential to your assets. DO NOT lose it or reveal
      it to others, otherwise you might lose your assets forever. Please view it in a secure environment and keep it
      carefully.`; words under a dark grey cover with a shield, `Click to show Seed Phrase`; `I've saved the Seed
      Phrase`. **new**

### Lock and unlock
- [ ] Locked screen: `‹ Wallet` (to Pick a Wallet); padlock; `Your wallet is locked`; `Unlock your game wallet to
      play.`; empty `Password`; Enter or `Unlock`; `Forgot Password?` as white text under the button. **new**

### Forgot password and reset
- [ ] `‹ Wallet` (to the locked screen); padlock with a question mark; `Forgot Password`; `Funge doesn't store your
      password and can't help you get it back. Reset your wallet to set up a new one.`; red `Reset Wallet`. **new**
- [ ] Popup `Reset Wallet?` / `Resetting your wallet wipes your password from browser memory.` / (red) `Your wallet
      is removed from this browser. You can only get it back with your recovery phrase.` / `Cancel` / red
      `Reset Wallet` → Pick a Wallet. **new**

### Disconnect and delete
- [ ] Disconnect → Pick a Wallet; the game wallet stays saved; picking it again → the locked screen.
- [ ] Delete: `Delete this wallet?` + text; `Back up seed phrase first` (cream pill, same password flow);
      `Cancel` / red `Delete wallet` → Pick a Wallet.

### WizardConnect
- [ ] `‹ Wallet`; `WizardConnect` centred; `Scan wallet to connect`; QR; `Copy link` and `Cancel`. No "Open in
      wallet app" and no reload hint. Cancel and ‹ Wallet go back to where the player came from. **new**
- [ ] Connected: `WIZARDCONNECT` with the disconnect button at the right; wizard hat, wallet name, green
      `Connected`; PUSD and BCH; address + Copy; the faucet card. No swap, withdraw, backup or delete; no note. **new**

## 11. Rules tab
- [ ] `FAIR GAME RULES` 1 to 10 only (no How to Play, no link).
- [ ] Rule 10: `If the winner doesn't claim within 30 seconds, the prize is paid automatically.` (the 12-block
      sentence is removed). **new**

## 12. To settle in code before or while building
- [ ] Required password: src/walletUI.ts already passes the password to `vault.create`; making it required needs no
      change in src/wallet/. Existing wallets without a password: decide what Back up and Lock do for them.
- [ ] Seed reveal behind a password: check it with `vault.unlock(password)`; no src/wallet change expected.
- [ ] Faucet countdown: the server limits by "today" in blocks and does not send a next-claim time. Count 24 h from
      the claim time saved in the browser; an `already_claimed` reply shows the countdown too.
- [ ] Swap: the Max slippage setting already exists (COPY.swap.slippage), so it can stay.
- [ ] Explorer for the withdraw link: chipnet.imaginary.cash or another; Charles to choose.
- [ ] Battlefield banners and HUD move from the Phaser canvas to DOM where the mockup needs it (Phase A).
- [ ] Many wallet words live in play/index.html today, not src/copy.ts (for example `Your wallet is locked`,
      `Copy link`). The rebuilt panel takes all of them from src/copy.ts.
- [ ] If anything needs a change in src/wallet/, the contracts, the referee or the event format: stop and ask.
