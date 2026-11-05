# The referee: how the round clock works

Status: built and running on chipnet. This describes the Kingdom game; the money rules are in `KINGDOM.md`.

## In one paragraph
Every round has a visible countdown that everyone sees. A small server, the **referee**, keeps the clock.
A Bitcoin Cash contract cannot read a clock, so the contract requires the referee's signature on every
open, conquest, protect and settle. The referee decides only whether the clock allows an action. It can never decide
who gets paid: the contract alone controls the money.

## Parameters
All of these live in config (shared by the app and the server). Names are fixed here.

| Name | Default | Meaning |
|---|---|---|
| BELL (`BELL_PRESETS`) | standard: 600 s start, 30 s step, 120 s floor. Demo: 300 s start | The open sets the clock to the start; each conquest sets it 30 s shorter than the one before, never below the floor. Chosen at server start with `FUNGE_BELL_PRESET`. |
| PROTECT_LOCKOUT_SECONDS | 30 | Protect is refused in the last 30 seconds before the deadline. Conquest is never affected. |
| GRACE_SECONDS | 1 | Lateness tolerated for a move that arrives just after the deadline. |
| KEEPER_DELAY_SECONDS | 120 | After a round is over, how long the king has to press Claim before the server settles automatically. |
| FALLBACK_BLOCKS | 12 | Deploy-time contract setting (default in config). After this many blocks with no action, anyone can settle without the referee. Sized so it cannot realistically fire while a live round's clock is still running. |
| UNCONFIRMED_CAP | 40 | How many unconfirmed moves can be chained before the server pauses the round (the node's limit is higher; this keeps a margin). |
| REFEREE_PUBKEY | per game | Stored in the game file and baked into the state contract. |

## Who is trusted for what

| Players trust the referee to... | The contract guarantees, no matter what the referee does |
|---|---|
| accept moves until the deadline | the pool is only ever paid to the king recorded on chain |
| end the round when the clock runs out | the price of a conquest and where every payment goes |
| not pick favorites or ignore players | the king, the value and the pass count written on chain |
| be online | the referee's key alone can never spend the pool |
| | after the fallback block count, anyone can settle without the referee |

A dishonest referee **can** refuse to sign a player's move, or sign a settle early (which pays the *current king*, nobody else). Those are timing and fairness powers, not custody powers.

The chain shows every action and their order, but **not the deadline the referee claimed**. The deadline and
its changes come only from the server. The game says plainly in its interface that the clock is run by the
Funge referee. An optional public audit trail is described under "Later, optional".

## Round states
`waiting` -> `open` -> `over` -> `settled`

- **waiting:** the game is deployed and nobody has opened it. There is **no deadline and no countdown**, and no PUSD in the game.
  The app shows "Waiting for the first player". The referee signs `open` only.
- **open:** counting down. The open moves a round from waiting to open and sets the clock to the bell's start.
  Each conquest sets the clock to the bell for that pass (30 s shorter, down to the floor). Protect changes nothing.
- **over:** the deadline plus the grace has passed. The app shows "Round is over" to everyone and only the king
  sees Claim.
- **settled:** the pool has been paid out.
- **paused:** a flag on an open round (see below), not a separate state.

### If only the opener plays
The opener is the king, so when the clock runs out the pool (their own 10.00) goes back to them and the page says
"No challengers, pool returned". Nobody else can ever receive it. The server settles it by itself after the keeper delay.

### If nobody ever opens
A waiting round has no PUSD and no clock, and the server never settles it. The only cost is the creator's small BCH
dust in the two contracts.

## One move, step by step
1. The app builds the move (open, conquer or protect): the state coin (with a placeholder where the referee's signature will go),
   the pool coin, and the player's own coins, which the player's wallet signs.
2. The app sends it to the server (`POST /rounds/:id/act`).
3. Under a lock for that round, the server checks that: the round is waiting or open (not over); the server's
   clock is at most the deadline plus the grace; the transaction spends the *current* state coin (read from
   chain, not trusted from the app); the move is legal for its kind (the exact payments, the new king and value, the dethroned king's payout, the protect rules); protect is also refused in the last 30 seconds; the wallet inputs are signed.
4. The server signs the contract input and inserts the signature (to be proven in Step 3), then broadcasts the
   transaction itself and replies with the transaction id, or a typed error: `too_late`, `state_changed`,
   `round_over`, `invalid`, and for Kingdom rules `not_open`, `protect_locked`, `already_king`, `walls_at_maximum`, `no_protects_left`, `not_king`.
5. Only on success: for an open or conquest the deadline becomes now + the bell for that pass; a protect leaves the deadline alone. An event is pushed to every
   connected player.

## Which action is it?
The `action` field of the request names the move: `open`, `conquer` or `protect`. Anything else, including the old `pass`, `steal` and `settle`, is refused as `invalid`. Settle is never sent by a player: it goes through the claim route or the keeper. A new move type is one new handler in `server/kingdomAct.ts` plus one line in the clock rules in `server/rounds.ts`.

## Settling
- **Round over:** at the deadline plus the grace, once the round lock is free, the server marks the round over and
  pushes "round over" to everyone.
- **The king** sees a Claim button (the opener, if they were alone, sees their pool come back). Pressing it asks the server for a settle.
- **The keeper:** if the king does not claim within KEEPER_DELAY_SECONDS, the server settles automatically.
- **Never early:** Claim and settle are not signed before the round is over.
- **The fee** is paid from the BCH held inside the contracts, so the server needs no funded wallet, only the
  signing key.
- **If the server is down:** after the fallback block count with no action, anyone can settle without the
  referee. The pool still goes to the current king.

## Timer rules
- The **deadline is set by the server's clock** and is the only authority. Clients never decide it.
- Every reply and event carries `serverNow`. The app computes an offset between the server's clock and its own
  and counts down to the deadline using it, so everyone sees the same number.
- **The boundary:** the countdown shows zero **at the deadline**. A move that arrives up to GRACE_SECONDS after
  it is still accepted. The round flips to `over` at deadline + GRACE_SECONDS, but only once the round lock is
  free: a move that is being processed finishes first, and if it moves the deadline the round stays open.
  Between zero and the flip the app shows "waiting for the referee". It never shows Claim on its own.
- **Reason codes:** every deadline change publishes an event with a reason code (`open`, `conquer`, `network_busy`, `network_ok`, `restart`, `observed_on_chain`) or a protect event carrying the unchanged deadline,
  so the app can explain why the clock moved.
- The server's host clock must be synchronized to network time.

### Pausing
When the server is close to the chain's unconfirmed-chain limit (UNCONFIRMED_CAP), the round is **paused**: new moves
are refused with a clear message and the app shows "clock paused". The clock is frozen: when the pause ends, the
deadline is pushed out by the length of the pause and a `clock_resumed` event is published.

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
| Server offline mid-round | Moves stop (they need the referee). After the fallback block count anyone settles; the king is paid. |
| Server restarts | Deadlines are stored durably and reloaded. |
| Two moves race | The lock serves one; the other gets `state_changed` and can retry against the new state. |
| Move arrives after the deadline plus grace | `too_late`. |
| Referee key lost | Existing rounds can only end through the fallback. New games use a new key. |
| Referee key leaked | An attacker could censor players or end rounds early, but cannot move the pot. Switch to a new key for new games. |
| Block gap is very long | The timer is wall-clock, so it keeps counting. Chained unconfirmed moves continue until UNCONFIRMED_CAP, then the round pauses. |
| Server clock wrong | The deadline would be wrong. The host clock must be synced and the server logs large clock jumps. |

## The server, in outline
- Round registry keyed by the game's token category: status, deadline, king, last action. `GET /rounds/:id` also describes the Kingdom: value, the exact price of the next conquest and how it splits, protects left and their allowed amounts, the current and next clock, and the previous king's short mark. All of it is computed on the server, so the page and the contract cannot disagree.
- `GET /rounds/:id` returns state, deadline and serverNow. A WebSocket pushes deadline changes and events.
- `POST /rounds/:id/act` takes a move built by the player's wallet, checks it, adds the referee signature and broadcasts it. `POST /rounds/:id/claim` settles a finished round.
- Both wallets use the same route: the game wallet signs its own coins in the browser; a WizardConnect wallet signs them in the wallet app. The wallet's signatures do not cover the contract input's unlocking script, so adding the referee signature afterwards keeps them valid.

## What was proven first
1. **Signature insertion:** the wallet signatures stay valid after the referee signature is inserted (proven with a real WizardConnect wallet).
2. **Unconfirmed chain limit:** the server pauses the round before the node's limit on chained unconfirmed moves (UNCONFIRMED_CAP), and lifts the pause at the next block.
3. **Failure drills on chipnet (`scripts/chaos-kingdom.ts`):** duplicate and stale moves, a conquest racing a protect, last-second timing and grace, the protect lockout, a hard server restart in the middle of a round, keeper settlement with every PUSD accounted for, rate limiting, and the fallback settle with the server off. Rounds were also played by three wallets, with Cashonize through WizardConnect.

## Restart and downtime
- The server saves a heartbeat timestamp to its state file every few seconds (HEARTBEAT_SECONDS).
- On start it compares now with the last heartbeat. For every round of a loaded game that is open and not paused, the downtime is treated as a pause: the deadline is pushed out by the downtime, so players keep exactly the time they had left when the server went away. A `clock_resumed` event (reason `restart`, with the downtime) is published for each such round. Rounds that were paused stay paused. Rounds already marked over or settled are not touched.
- Settled rounds of games that are no longer loaded are removed from the state file. Unsettled ones are kept, because the contract may still owe a payout.
- The chain stays the source of truth for the king, the pass count and the state coin. The state file only holds what the chain cannot tell: deadline, status, pause info, recent events and the heartbeat. Every event carries a per-round sequence number, so a reconnecting client asks for events after its last number, or reloads the whole round if the history no longer reaches back that far.

## Server protection
- Listens on 127.0.0.1 unless told otherwise. On a network address it refuses to start without the page's exact https address in FUNGE_ALLOWED_ORIGINS (no wildcards, no plain http).
- Cross-origin requests and WebSocket connections are only accepted from those origins. Rate limits per visitor (behind a proxy, only with FUNGE_TRUST_PROXY=1), a small body limit on `/act`, and one lock per round.
- Timer overrides for testing (`FUNGE_KEEPER_DELAY_SECONDS`, `FUNGE_UNCONFIRMED_CAP`) are refused on mainnet, and a chipnet key is refused in a mainnet environment.
- Logs never contain secrets: every console message passes through a cleaner that removes CashScript debug links and anything shaped like a private key. The referee key exists only in the host's environment.
- A move is judged by when it reaches the server, and a move that arrived in time keeps the round open until it is processed.

## Later, optional
- **Public audit trail:** the server's timestamp in an `OP_RETURN` output of each action transaction. The player's wallet signs every output, so the app must get the timestamp from the server *before* it signs, which needs a small "prepare" call.