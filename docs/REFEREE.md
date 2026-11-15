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
| CLOCK_CAP_SECONDS | 300 | The open sets the clock here, and the clock never shows more. |
| CONQUEST_ADD_SECONDS | 30 | What a conquest adds to the time left, never above the cap. |
| CONQUEST_ENDGAME_SECONDS | 60 | With less than this left, a conquest adds CONQUEST_ENDGAME_ADD_SECONDS instead, never above this. 0 = off. |
| CONQUEST_ENDGAME_ADD_SECONDS | 10 | What a conquest adds in the endgame. |
| CONQUEST_MIN_SECONDS | 0 (off) | A conquest never leaves less than this on the clock. |
| `CLOCK_SETTINGS` | | The one clock setting the server uses. There are no presets; the old `FUNGE_BELL_PRESET` is ignored if still set. |
| PROTECT_LOCKOUT_SECONDS | 30 | Protect is refused in the last 30 seconds before the deadline. Conquest is never affected. |
| GRACE_SECONDS | 1 | Lateness tolerated for a move that arrives just after the deadline. |
| KEEPER_DELAY_SECONDS | 30 | After a round is over, how long the king has to press Claim before the server settles automatically. |
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
- **open:** counting down. The open moves a round from waiting to open and sets the clock to the cap.
  Each conquest adds 0:30, never above the cap; under 1:00 left it adds 0:10, never above 1:00 (5:00 → 5:00, 4:40 → 5:00, 3:20 → 3:50, 1:00 → 1:30, 0:55 → 1:00, 0:10 → 0:20). Protect changes nothing.
- **over:** the deadline plus the grace has passed. The app shows "Round is over" to everyone and only the king
  sees Claim.
- **settled:** the pool has been paid out.
- **paused:** a flag on an open round (see below), not a separate state.

### If only the opener plays
The opener is the king, so when the clock runs out the pool (their own 5.00) goes back to them and the page says
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
   `round_over`, `invalid`, and for Kingdom rules `not_open`, `protect_locked`, `already_king`, `walls_at_maximum`, `no_protects_left`, `not_king`, `not_cancellable`, and for player profiles `bad_name`, `name_taken`, `avatar_taken`.
5. Only on success, still under the lock: for an open the deadline becomes now + the cap. For a conquest the server measures the time left at this
   instant and the deadline becomes now + the clock rule's result (src/lib/kingdomClock.ts): in effect the old deadline + 0:30 (+0:10 under 1:00 left),
   at most the cap (1:00 in the endgame) from now, and 0:10 from now if the move landed inside the grace. Slow checks or a slow wallet neither add nor take time. A protect leaves the deadline alone. An event is pushed to every
   connected player.

## Which action is it?
The `action` field of the request names the move: `open`, `conquer`, `protect` or `cancel`. Anything else, including the old `pass`, `steal` and `settle`, is refused as `invalid`. Settle is never sent by a player: it goes through the claim route or the keeper. A new move type is one new handler in `server/kingdomAct.ts` plus one line in the clock rules in `server/rounds.ts`.

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
- `GET /rounds/:id` returns state, deadline and serverNow. A WebSocket pushes deadline changes and events. Every event is self-contained (the kingdom after the change, the money moved, the deadline and the clock settings); `EVENTS.md` lists them all with examples.
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
## Cancel round
The king may end a round before anyone has challenged it and take the whole pool back. It goes through the same
`POST /rounds/:id/act` route, with `action: "cancel"`.
- **The transaction** is the contract's `settle`: the state coin (input 0) and the pot (input 1), output 0 the whole pool to
  the king in plain PUSD, output 1 the trophy to the king. The page adds one coin at the king's address as input 2 (the
  king's proof, as for protect), signed by the king's wallet; its change goes back to the king. No contract change: settle
  has no time lock. The referee signs input 0 with `settle` and broadcasts.
- **Allowed** only for the current king, while the round is open with zero conquests (pass count 1), not paused, and
  before the deadline itself (no grace). The referee answers `not_cancellable` before the open or after a conquest,
  `not_king` when input 2 is not at the king's address, `too_late` at or after the deadline, `paused` while paused, and
  `invalid` for a wrong shape (the pool not whole, sent elsewhere, no trophy, an unsigned coin).
- **The race** with a conquest is decided by the per-round lock: the first one through wins. A conquest after a cancel
  gets `round_over`; a cancel after a conquest gets `not_cancellable`.
- **On success** the round is settled at once and `round_settled` is published with reason `cancel`, `cancelled: true`
  and `payout` = the pool (see `EVENTS.md`). The keeper has nothing left to do.
- **The trophy** is minted as with any settle. A finished round whose trophy has pass count 1 (cancelled, or nobody
  challenged) says "Round cancelled. Pool returned", never "Wins X".

## Player profiles
An open or a conquest may carry `profile: { name, avatarId }` in the `/act` body (protect and cancel ignore it).
- **Checked before signing,** under the round lock: a bad profile refuses the whole move, with nothing broadcast.
  - `bad_name` (400): the name rules in `src/lib/playerName.ts`, shared with the picker: 2 to 16 characters of
    letters (accents included), digits, spaces, apostrophes and hyphens, with at least one letter; repeated spaces
    collapse; a leading "King" or "Queen" is stripped (the title comes from the portrait); nothing that looks like a
    link, a domain or a wallet address; no word from a short blocklist. An unknown portrait is `invalid`.
  - `name_taken` (409): another key in this round has the same name, compared without case and spaces.
  - `avatar_taken` (409): another key in this round has the same portrait.
- **Only from that key:** the profile is stored for the new king's key, and only when one of the wallet inputs sits at
  that key's address (the referee's signature covers the inputs' claimed coins, so this cannot be faked). Otherwise
  the move counts and the profile is ignored.
- **Once per round:** a key that already has a profile keeps it; a later profile from it is ignored.
- **Stored** after the broadcast succeeds, in the round's saved state (`players`, keyed by the first 22 hex
  characters of the key; older saved rounds have none). Shown as `actorName`/`actorAvatar` on that player's open,
  conquest and protect events, and as the `players` map of the round snapshot (see `EVENTS.md`). If the saved state is
  lost, the page shows its derived names.
