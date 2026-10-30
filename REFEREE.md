# The referee: how the round clock works

Status: design (Step 1 of the referee-timer work). Nothing described here is built yet.

## In one paragraph
Every round has a visible countdown that everyone sees. A small server, the **referee**, keeps the clock.
A Bitcoin Cash contract cannot read a clock, so the contract requires the referee's signature on every
steal and every settle. The referee decides only whether the clock allows an action. It can never decide
who gets paid: the contract alone controls the money.

## Parameters
All of these live in config (shared by the app and the server). Names are fixed here.

| Name | Default | Meaning |
|---|---|---|
| RESET_SECONDS | `{ steal: 600 }` | Per action type: after that action, the deadline becomes now + this many seconds. Only `steal` exists. |
| GRACE_SECONDS | 1 | Lateness tolerated for a steal that arrives just after the deadline. |
| KEEPER_DELAY_SECONDS | 120 | After a round is over, how long the king has to press Claim before the server settles automatically. |
| FALLBACK_BLOCKS | 12 | Deploy-time contract setting (default in config). After this many blocks with no action, anyone can settle without the referee. Sized so it cannot realistically fire while a live round's clock is still running. |
| WAITING_FALLBACK_BLOCKS | 144 | Deploy-time contract setting (default in config). The same rule for a round nobody has stolen in yet (pass count 0), about a day. |
| MAX_CHAIN | measured | How many unconfirmed actions can be chained before the server pauses (measured in Step 4). |
| REFEREE_PUBKEY | per game | Stored in the game file and baked into the state contract. |

## Who is trusted for what

| Players trust the referee to... | The contract guarantees, no matter what the referee does |
|---|---|
| accept steals until the deadline | the pot is only ever paid to the holder recorded on chain |
| end the round when the clock runs out | the price of a steal and where it goes |
| not pick favorites or ignore players | the holder and pass count written on chain |
| be online | the referee's key alone can never spend the pot |
| | after the fallback block count, anyone can settle without the referee |

A dishonest referee **can** refuse to sign a player's steal, cancel a waiting round, or sign a settle early (which pays the *current holder*, nobody else). Those are timing and fairness powers, not custody powers.

The chain shows every action and their order, but **not the deadline the referee claimed**. The deadline and
its changes come only from the server. The game says plainly in its interface that the clock is run by the
Funge referee. An optional public audit trail is described under "Later, optional".

## Round states
`waiting` -> `open` -> `over` -> `settled`

- **waiting:** the round is deployed and nobody has stolen yet. There is **no deadline and no countdown**.
  The app shows "Waiting for the first steal". The referee signs steals only.
- **open:** counting down. The first successful steal moves a round from waiting to open and sets the deadline
  to now + RESET_SECONDS for that action.
- **over:** the deadline plus the grace has passed. The app shows "Round is over" to everyone and only the king
  sees Claim.
- **settled:** the pot has been paid out.
- **paused:** a flag on an open round (see below), not a separate state.

### If nobody ever steals
- A waiting round has no deadline, so the referee runs no clock for it. The pot holds the seed, and the recorded
  holder is the creator's key.
- **The referee can cancel a waiting round at any time** by signing a settle at pass count 0. The seed is paid
  back to the creator, and a trophy recording 0 passes is minted for the creator. The app shows
  "Round cancelled, seed returned" for any settle with zero steals.
- **If the referee is gone:** after WAITING_FALLBACK_BLOCKS (144, about a day) with no action, anyone can run the
  fallback settle, with the same result.
- Nobody else can ever receive the seed.


## One steal, step by step
1. The app builds the steal transaction: the state coin (with a placeholder where the referee's signature will go),
   the pot coin, and the player's own coins, which the player's wallet signs.
2. The app sends it to the server (`POST /rounds/:id/act`).
3. Under a lock for that round, the server checks that: the round is waiting or open (not over); the server's
   clock is at most the deadline plus the grace; the transaction spends the *current* state coin (read from
   chain, not trusted from the app); the steal is legal; the wallet inputs are signed.
4. The server signs the contract input and inserts the signature (to be proven in Step 3), then broadcasts the
   transaction itself and replies with the transaction id, or a typed error: `too_late`, `state_changed`,
   `round_over`, `invalid`.
5. Only on success: the deadline becomes now + RESET_SECONDS for that action, and an event is pushed to every
   connected player.

## Which action is it?
One small function decides which action type a transaction is. A new action type is one new branch in that
function plus one entry in RESET_SECONDS. Only `steal` and `settle` exist; nothing else is implemented.

## Settling
- **Round over:** at the deadline plus the grace, once the round lock is free, the server marks the round over and
  pushes "round over" to everyone.
- **The king** sees a Claim button. Pressing it asks the server for a settle.
- **The keeper:** if the king does not claim within KEEPER_DELAY_SECONDS, the server settles automatically.
- **Never early:** Claim and settle are not signed before the round is over.
- **The fee** is paid from the BCH held inside the contracts, so the server needs no funded wallet, only the
  signing key.
- **If the server is down:** after the fallback block count with no action, anyone can settle without the
  referee. The pot still goes to the current holder.

## Timer rules
- The **deadline is set by the server's clock** and is the only authority. Clients never decide it.
- Every reply and event carries `serverNow`. The app computes an offset between the server's clock and its own
  and counts down to the deadline using it, so everyone sees the same number.
- **The boundary:** the countdown shows zero **at the deadline**. A steal that arrives up to GRACE_SECONDS after
  it is still accepted. The round flips to `over` at deadline + GRACE_SECONDS, but only once the round lock is
  free: a steal that is being processed finishes first, and if it moves the deadline the round stays open.
  Between zero and the flip the app shows "waiting for the referee". It never shows Claim on its own.
- **Reason codes:** every deadline change publishes an event with a reason code (for example `steal`, `pause`),
  so the app can explain why the clock moved.
- The server's host clock must be synchronized to network time.

### Pausing
When the server is close to the chain's unconfirmed-chain limit (MAX_CHAIN), the round is **paused**: new steals
are refused with a clear message and the app shows "clock paused". The clock is frozen: when the pause ends, the
deadline is pushed out by the length of the pause and an event with reason `pause` is published.

## The referee key
- One referee key for v1, **but** chipnet and mainnet use **different keys**. The mainnet key is generated only
  on the production server. It is never created on a development machine, never pasted into chat, and never
  committed.
- The key lives only in the server's environment. The server obtains it through one function of the game ID, so
  later moving to a key per game changes that function and nothing else.
- Each game records the public key it was deployed with. The key cannot be changed for an existing game.

## What goes wrong, and what happens

| Situation | Result |
|---|---|
| Server offline mid-round | Steals stop (they need the referee). After the fallback block count anyone settles; the holder is paid. |
| Server restarts | Deadlines are stored durably and reloaded. |
| Two steals race | The lock serves one; the other gets `state_changed` and can retry at the new price. |
| Steal arrives after the deadline plus grace | `too_late`. |
| Referee key lost | Existing rounds can only end through the fallback. New games use a new key. |
| Referee key leaked | An attacker could censor players or end rounds early, but cannot move the pot. Switch to a new key for new games. |
| Block gap is very long | The timer is wall-clock, so it keeps counting. Chained unconfirmed actions continue until MAX_CHAIN, then the round pauses. |
| Server clock wrong | The deadline would be wrong. The host clock must be synced and the server logs large clock jumps. |

## The server, in outline
- Round registry keyed by the game's token category: status, deadline, king, last action.
- `GET /rounds/:id` returns state, deadline and serverNow. A WebSocket pushes deadline changes and events.
- `POST /rounds/:id/act` takes a grab built by the player's wallet, checks it, adds the referee signature and broadcasts it. `POST /rounds/:id/claim` settles a finished round.
- Both wallets use the same route: the game wallet signs its own coins in the browser; a WizardConnect wallet signs them in the wallet app. The wallet's signatures do not cover the contract input's unlocking script, so adding the referee signature afterwards keeps them valid.

## What was proven first
1. **Signature insertion:** the wallet signatures stay valid after the referee signature is inserted (Step 3 spike, repeated with a real WizardConnect wallet).
2. **Unconfirmed chain limit:** the server pauses the round before the node's limit on chained unconfirmed grabs (UNCONFIRMED_CAP), and lifts the pause at the next block.
3. **Failure drills on chipnet:** duplicate and stale grabs, last-second timing and grace, a crash and restart in the middle of a round, a busy network, the server being off for the fallback settle, and a full two-player round with the production build.

## Restart and downtime
- The server saves a heartbeat timestamp to its state file every few seconds (HEARTBEAT_SECONDS).
- On start it compares now with the last heartbeat. For every round of a loaded game that is open and not paused, the downtime is treated as a pause: the deadline is pushed out by the downtime, so players keep exactly the time they had left when the server went away. A `clock_resumed` event (reason `restart`, with the downtime) is published for each such round. Rounds that were paused stay paused. Rounds already marked over or settled are not touched.
- Settled rounds of games that are no longer loaded are removed from the state file. Unsettled ones are kept, because the contract may still owe a payout.
- The chain stays the source of truth for the king, the pass count and the state coin. The state file only holds what the chain cannot tell: deadline, status, pause info, recent events and the heartbeat. Every event carries a per-round sequence number, so a reconnecting client asks for events after its last number, or reloads the whole round if the history no longer reaches back that far.

## Server protection
- Listens on 127.0.0.1 unless told otherwise. On a network address it refuses to start without the page's exact https address in FUNGE_ALLOWED_ORIGINS (no wildcards, no plain http).
- Cross-origin requests and WebSocket connections are only accepted from those origins. Rate limits per visitor (behind a proxy, only with FUNGE_TRUST_PROXY=1), a small body limit on `/act`, and one lock per round.
- Timer overrides for testing are refused on mainnet, and a chipnet key is refused in a mainnet environment.
- Logs never contain secrets: every console message passes through a cleaner that removes CashScript debug links and anything shaped like a private key. The referee key exists only in the host's environment.
- A grab is judged by when it reaches the server, and a grab that arrived in time keeps the round open until it is processed.

## Later, optional
- **Public audit trail:** the server's timestamp in an `OP_RETURN` output of each action transaction. The player's wallet signs every output, so the app must get the timestamp from the server *before* it signs, which needs a small "prepare" call.