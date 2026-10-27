# Funge build journey

## Step 1: scaffold 
- Vite + vanilla TS. Pinned cashscript 0.14.0, cashc 0.14.0, mainnet-js 3.1.7.
- Chose mainnet-js 3.1.7 (stable) over 4.0.0-next.13, which is npm's "latest" tag but a prerelease.
- Fixed editor errors: added @types/node, and added "scripts" to tsconfig include.
- Chipnet wallet script works; funded from a faucet.

## Step 2a: contracts 
- Checked CashScript docs: `this.age` (not tx.age) reads the input's own nSequence.
- tokenCategory introspection includes the capability byte (0x01 mutable).
- Category byte order is reversed vs explorers; swapEndianness on the TS side.
- bytes4(int) is rejected in 0.14; using toPaddedBytes(value, 4).

## Step 2b: contract tests 
- Wrote scripts/test-contracts.ts using MockNetworkProvider: two consecutive passes, price/commitment/pot-address failures, pot-spend-without-NFT, settle failures, and a full settle.
- Local evaluation rejects a settle whose input sequence is below timeoutBlocks (this.age check). The "UTXO must be old enough" rule is enforced by the network (BIP68), so it will be proven on chipnet in Step 3.
- Test bug found and fixed: bob's PUSD change output was mistaken for the payout; the check now sums his PUSD outputs.


## Step 3a: chipnet test PUSD token 
- A token category is the txid of a genesis input at output index 0, so the script makes a spare vout-0 output first, then spends it to create the fungible category.
- Test PUSD category on chipnet: 8af14ba0...49eb (1,000,000 units).
- First run failed with a WebSocket 1006 error (transient Electrum connection drop); a plain retry worked.


## Step 3b: chipnet deploy
- scripts/deploy.ts does two transactions: a prep transaction whose output 0 becomes the game NFT genesis (its txid is the game category), then an init transaction that puts the mutable NFT directly into the FungeState contract and the seed PUSD into FungePot, so the creator never holds the mutable NFT.
- Writes public/game.chipnet.json (addresses, categories, params) for the front end to read.
- Game category: 29c5d721...a473f. State UTXO decoded as passCount 0 with the creator as initial holder.
- Needed three attempts: Electrum connection drops and a possible race on spending an unconfirmed output. Plan: wait for the previous tx to be visible and retry connection errors.


## Step 3c: chipnet smoke test
- scripts/smoke.ts has three commands: status, pass and settle. It rebuilds both contracts from public/game.chipnet.json and checks the rebuilt addresses match before sending anything.
- Real pass() on chipnet: passCount 0 to 1 at price 100, pot 1000 to 1100 (txid 13855b26...c8a6).
- A settle attempted right after the pass was rejected by the network: "BIP68 sequence lock not satisfied". The age rule is enforced by consensus rules, which the local mock cannot show.
- Settle after the timeout: (The pot went to the holder and a trophy NFT was minted. Run token-balance.ts to see the PUSD return)


## Step 4a: read-only game view
- Browser page loads public/game.chipnet.json, reads the state and pot UTXOs by contract address with CashScript's Electrum provider, decodes the commitment and refreshes every 25 seconds.
- The commitment codec moved to src/lib/commitment.ts so the scripts and the page share one copy.
- Production build passes (CashScript bundles fine for the browser).
- Added Tailwind v4 through its Vite plugin (pinned 4.3.3); no config file needed.


## Step 4b: blocks until settle
- A settle is accepted once the state UTXO's transaction has at least timeoutBlocks confirmations, so blocks to go = timeoutBlocks minus confirmations. This matches the ~40 minute wait seen with timeoutBlocks 3.
- CashScript UTXOs carry no confirmation height, so the page asks the Electrum server directly (blockchain.transaction.get, verbose) through the provider's performRequest.
- The page shows "N more blocks until settle", "Waiting for the latest grab to confirm", or a highlighted "Ready to settle".


## Step 5a: wallet connection (WizardConnect)
- WizardConnect pairs the page with a wallet through a relay; the wallet shares xpubs and the page derives its public keys, so signing later only needs inputPaths for wallet-owned inputs.
- Pinned @wizardconnect/dapp 0.2.2 and @wizardconnect/core 0.2.5. The packages ship no README, so the type definitions were the reference.
- Paired successfully with Cashonize by copy-pasting the link. A QR code cannot be scanned from the same PC, so the page offers both a QR and a copy link.


## Step 5b: funding the wallet
- scripts/send-test-pusd.ts sends test PUSD plus 20,000 sats from the creator wallet to the connected wallet's token address (one output, so the wallet can pay its own fees).
- Cashonize shows the unnamed test token (no metadata) and the 20,000 sats.

## Step 5c: building the pass request in the browser (dry run)
- The page scans the wallet's receive and change addresses (derived from the xpubs shared at pairing), picks a PUSD coin, and builds the pass transaction with CashScript using placeholder unlockers for the wallet's inputs.
- WizardConnect sends plain JSON, so the request is converted by hand: the transaction as hex (libauth encodeTransaction), byte arrays as hex, bigints as "<bigint: Xn>". The library's own helpers are not exported.
- Bug found and fixed: libauth's lockingBytecodeToCashAddress returns an object rather than a plain string, so the address helper now reads the address from the result.
- Dry run result: price 1.40 PUSD, one wallet coin found at receive #0, network fee about 1,658 sats. Nothing is sent to the wallet yet.


## Step 5d: signing and broadcasting
- The Grab button rebuilds the pass transaction from the live state, asks the wallet to sign only its own input (inputPaths), then broadcasts the signed transaction itself.
- A Cancel button and a 3-minute timeout abort a pending signing request; the page maps rejection and stale-state errors to plain messages.
- First real grab: pass 4 to 5 for 1.40 test PUSD, with the connected wallet as the new holder.


## Step 5e: error handling and countdown estimate
- Tested on purpose: wallet rejection, cancel from the page, wallet disconnect mid-request, stale state (someone else grabbed while the wallet prompt was open), and insufficient PUSD.
- A broadcast that fails with a conflict or missing inputs is treated as "someone grabbed first": the page refreshes with the new price.
- Network failures during broadcast are reported without claiming the grab was or was not sent, because we cannot know.
- Known limit: the grab uses a single PUSD coin; if the PUSD is split across several small coins the page says so.
- Block arrivals are random, so the page shows an estimate in minutes (blocks left times about 10) plus a live "last grab confirmed … ago" line, instead of a clock that ticks to zero.


## Step 6a: settle button
- Settling needs no signature on either contract input, so the page builds and broadcasts it directly: no wallet is required. Anyone can press Settle.
- The fee is paid from the contracts' own BCH; the leftover BCH goes to the holder as change.
- The state is re-read right before building. A premature press is rejected by the network (BIP68) and the page says so plainly.


## Step 6b: end screen
- When the state and pot UTXOs are gone, the page reads the state contract's transaction history from the Electrum server. If the last transaction does not recreate the state contract, it is the settlement.
- The settlement transaction is decoded in the browser: payout address (winner), payout token amount (pot paid), trophy NFT commitment (number of passes), and the transaction id. A visitor who never saw the live round gets the same screen.
- First full round on chipnet: 10 passes, 24.50 test PUSD paid out to the last holder, matching the seed plus every grab price.
- Typing fix: copy the bytes into a fresh Uint8Array before passing them to crypto.subtle.digest.


## Step 7: generative art
- Each frame is an SVG drawn in code from the game category, pass count and holder key: same input, same picture. A seeded random number generator (mulberry32 over an FNV-1a hash) makes it deterministic with no libraries.
- Mutation per pass: skin heat (tan to red), dilating eyes and a smile that turns into a frown, steam, cracks, one new mark per pass (the newest tinted by the holder), holder-tinted background and aura, and frame-specific sparkles.
- The recent-frames strip is built from the state contract's history: every grab transaction carries the new state (pass, holder) and pot, so the frames are verifiable on chain.
- "Share frame" renders the SVG to a canvas and exports a PNG with the pass number and pot; phones use the share sheet, desktops download.


## Network resilience
- CashScript 0.14.0 hardcodes chipnet.bch.ninja as its chipnet Electrum server. When that server's TLS handshake failed, the page and scripts stopped working.
- Added a FailoverProvider (a subclass of ElectrumNetworkProvider overriding performRequest) that tries a configurable list of servers and sticks with the one that answers. Only connection errors cause a switch; a broadcast is retried elsewhere only if the connection never opened, so a transaction cannot be sent twice.
- Considered QuickNode, but it offers Bitcoin-style JSON-RPC rather than the Electrum protocol the app uses, and an API key would be exposed in a static front end.


## Built-in wallet, step 1: wallet core
- Decided to build the browser wallet on libauth and CashScript instead of mainnet-js: one network layer (our failover provider), a smaller bundle, and everything needed (seed to key to address, signing a P2PKH input, balances) was already in use.
- A seed phrase (BIP39) derives the first address on the standard BCH path m/44'/145'/0'/0/0. The module exposes a signing capability and balances, never the key.
- Tested in Node: create and restore give the same address, messy spacing and capitals are normalized, different phrases differ, and the balance read works. The seed phrase is never printed.


## Built-in wallet, step 2: encrypted vault
- The seed phrase is stored in IndexedDB, encrypted with AES-GCM. With a password, the key comes from PBKDF2-SHA256 (600,000 iterations, random salt). Without one ("device mode"), a random non-extractable key kept by the browser is used, which opens automatically and is honestly weaker.
- States are none, locked and unlocked; the decrypted phrase lives only in memory and is dropped on lock, wipe or page close. Creating refuses to overwrite an existing wallet, rejects invalid phrases (checksum validated) and passwords shorter than 8 characters.
- The storage sits behind a small interface, so the logic is tested in Node with an in-memory stand-in (create, reload, wrong password, unlock, lock, wipe) and the real IndexedDB path was checked from the browser console.


## Built-in wallet, step 3 (plain version): game wallet panel
- A plain working panel: create (optional password typed twice, or import a validated seed phrase), a backup box that hides itself after 60 seconds, unlock and lock, copy address, balances through the failover provider, and delete with confirmation.
- The seed field turns off spellcheck so browsers cannot send it to an outside service. The deposit QR, Withdraw and the final side-panel layout are deferred to the designed UI.


## Built-in wallet, step 4: instant steals
- With the game wallet unlocked, the button signs locally with CashScript and broadcasts through the failover provider: no popup, no pairing, no relay. The SDK evaluates the transaction against the contracts locally before broadcasting.
- The button shows the price the player is agreeing to. If the on-chain price differs when the click is processed, nothing is sent: the page explains the price change, refreshes, and waits for a new click, because an automatic retry would silently spend more than the player saw.
- The page updates optimistically right after the broadcast (pass, pot, price, holder, art, countdown), protected by the "never show an older state" check. The external-wallet (WizardConnect) path stays as a fallback.


## Built-in wallet, step 5: winner and settle with the game wallet
- A full chipnet round with the game wallet as the last holder: the pot and a trophy NFT were paid to its address, the end screen recognised the game wallet as "you", and the page showed the NFT count.
- Settling stays wallet-free: it was pressed from a window with no wallet and the winner in another window received the payout.
- The claim button is labelled for the holder ("Claim your pot"); the end screen explains that the trophy sits in the game wallet and can be seen elsewhere by restoring the seed phrase.


## Built-in wallet, step 6: speed
- The page shows the last known state straight away from a small browser cache (public chain data only: pass, holder, pot, recent frames, and a settled round's result), then replaces it with live data. The Grab button stays disabled until live data arrives, so a stale price can never be clicked.
- Reads are "hedged" across Electrum servers: the preferred server is asked first, and if it has not answered after 1.5 seconds the next one is asked too, first answer wins. The server that answered is remembered. Broadcasts go to one server at a time so a transaction can never be sent twice.
- The page refreshes immediately when the player returns to the tab. The provider has no push subscriptions, so polling stays.