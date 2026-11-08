# Events: what the referee tells the page, and how to listen

Every change in a round is published as an event. Each event is complete: it carries the picture of the kingdom after the change, so a scene can be drawn from the event alone, with no extra lookups. The examples below are real output of the mock round player (`src/mockRound.ts`, which mirrors the server's fields and is checked against them by `scripts/test-kingdom-act.ts` and `scripts/test-mock-round.ts`).

A note on words: the project says "pool" in the interface and in the other docs. The event fields call it `treasury`, because that is the word the animation brief uses. They are the same thing: the PUSD that the last king wins.

## The envelope (every event)

| Field | Type | Meaning |
|---|---|---|
| `seq` | number | Counts 1, 2, 3… per round. A client that sees a gap reloads the round. `0` only for page-made events (`clock_warning`). |
| `roundId` | string | The game's token category (64 hex). Also the round id in every URL. |
| `at` | number | Server time when the event was published, epoch milliseconds. |
| `type` | string | What happened (the table below). |
| `reason` | string | Why, as a short code. Together with `type` it says exactly which case this is. |
| `data` | object | The payload. Flat; values are strings, numbers, booleans or `null`. |

## The scene fields (in `data` of every event)

These are the kingdom as it stands **after** the event. Money is always a string of integer base units (2 decimals: `"1000"` is 10.00 PUSD). Keys are 40-character hex key hashes.

| Field | Meaning |
|---|---|
| `king` | The current king. `null` while the round is waiting. |
| `previousKing` | The king who was dethroned by the latest conquest: the full key hash right after a conquest, otherwise the first 22 characters the chain records, or `null` if there is none. Compare by prefix. |
| `passCount` | Kings so far (the open is 1). |
| `conquests` | Conquests so far (`passCount - 1`). |
| `value` | The kingdom's value now. |
| `treasury` | The pool now. |
| `protectsLeft` | Protects the king may still use this reign. |
| `deadline` | When the clock runs out, server time in ms (`null` before the open). |
| `clockSeconds` | Seconds on the clock right after the latest open or conquest (the open: the cap; a conquest: what the rule below gave). `null` before the open. |
| `clockCapSeconds` | The most time the clock can show. The open starts here. Standard 600, demo 300. |
| `conquestAddSeconds` | What a conquest adds to the time left (60). |
| `conquestMinSeconds` | A conquest never leaves less than this on the clock. `0` means off (the setting today). |
| `nextClockSeconds` | **Deprecated**, kept for older pages: what a conquest made at the moment of this event would set the clock to. It goes stale as the clock runs; compute from `deadline` and the three settings above instead. |

**The clock rule.** The open sets the clock to `clockCapSeconds`. Every conquest (a take-back too) sets the time left to `min(cap, max(min, left + add))`, where `left` is the time left at the instant the referee records the move (never below 0, so a conquest inside the one-second grace gets `add` from that moment). Protect never changes the clock. Examples with the standard settings: 10:00 left stays 10:00, 9:30 becomes 10:00, 8:00 becomes 9:00, 2:00 becomes 3:00, 0:10 becomes 1:10.

## The move fields (added to `deadline_changed` open/conquer and `protect_applied`)

| Field | Meaning |
|---|---|
| `actor` | Who made the move (the new king; for a protect, the king). |
| `paid` | PUSD the actor paid in total. |
| `refunded` | PUSD paid out to the dethroned king (conquest only, else `"0"`). |
| `toTreasury` | PUSD added to the pool. `paid = refunded + toTreasury` always holds. |
| `txid` | The transaction. |
| `action` | `open` or `conquer` (on `deadline_changed`). |
| `addedSeconds` | Conquests only: the seconds this conquest actually added to the time left (`add`, or less when the cap cut it). |
| `amount`, `protectsUsed` | On `protect_applied`: the protect amount and how many protects this reign has used. |

## The events

### `deadline_changed`, reason `open`
The first player opened the round. Status goes `waiting` → `open`; the clock starts at the cap (`clockCapSeconds`).

```json
{
  "seq": 1, "roundId": "00…00", "at": 1780000002000, "type": "deadline_changed", "reason": "open",
  "data": {
    "king": "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1", "previousKing": null, "passCount": 1, "conquests": 0,
    "value": "1000", "treasury": "1000", "protectsLeft": 2, "deadline": 1780000602000,
    "clockSeconds": 600, "nextClockSeconds": 600,
    "clockCapSeconds": 600, "conquestAddSeconds": 60, "conquestMinSeconds": 0, "action": "open",
    "txid": "00…01", "actor": "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
    "paid": "1000", "refunded": "0", "toTreasury": "1000"
  }
}
```

### `deadline_changed`, reason `conquer`
Someone took the throne. The clock gets `conquestAddSeconds` on top of the time left, at most the cap (the rule above). In this example Bob conquered 5 s after the open, with 9:55 left: 9:55 + 1:00 would be 10:55, so the cap cuts it to 10:00 and `addedSeconds` is 5. The dethroned king is `previousKing`; `refunded` is what they received.

```json
{
  "seq": 3, "roundId": "00…00", "at": 1780000007000, "type": "deadline_changed", "reason": "conquer",
  "data": {
    "king": "b2b2…b2b2", "previousKing": "a1a1…a1a1", "passCount": 2, "conquests": 1,
    "value": "1500", "treasury": "1650", "protectsLeft": 2, "deadline": 1780000607000,
    "clockSeconds": 600, "nextClockSeconds": 600, "clockCapSeconds": 600, "conquestAddSeconds": 60, "conquestMinSeconds": 0,
    "action": "conquer", "txid": "00…03", "actor": "b2b2…b2b2", "paid": "1530", "refunded": "1380", "toTreasury": "150",
    "addedSeconds": 5
  }
}
```

### `deadline_changed`, reason `observed_on_chain`
The server saw a move on the chain that it did not process itself (rare: it restarted, or someone sent a move directly). The same clock rule applies, from the moment the server noticed: an open gets the cap, a conquest adds to the time left. It has the scene fields and the clock fields, but no move fields (`actor`, `paid`, …).

### `protect_applied`, reason `protect`
The king added to the value. The clock does not move: `deadline` is the same as before.

```json
{
  "seq": 2, "roundId": "00…00", "at": 1780000004500, "type": "protect_applied", "reason": "protect",
  "data": {
    "king": "a1a1…a1a1", "previousKing": null, "passCount": 1, "conquests": 0,
    "value": "1500", "treasury": "1500", "protectsLeft": 1, "deadline": 1780000602000,
    "clockSeconds": 600, "nextClockSeconds": 600, "clockCapSeconds": 600, "conquestAddSeconds": 60, "conquestMinSeconds": 0,
    "txid": "00…02",
    "actor": "a1a1…a1a1", "paid": "500", "refunded": "0", "toTreasury": "500", "amount": "500", "protectsUsed": 1
  }
}
```

### `clock_paused`, reason `network_busy`
Too many unconfirmed moves; moves are refused until the next block. The scene fields are included, so a scene can freeze. `deadline` is the value at the moment of the pause.

### `clock_resumed`, reasons `network_ok`, `manual`, `restart`
The clock runs again and `deadline` has been pushed out by the time it was frozen. Extra fields: `pausedMs` (after a pause) or `downtimeMs` (reason `restart`: the server was off).

### `round_over`, reason `deadline`
The deadline plus the one-second grace has passed. The king may now claim (or the server settles after the keeper delay).

```json
{
  "seq": 4, "roundId": "00…00", "at": 1780000608100, "type": "round_over", "reason": "deadline",
  "data": {
    "king": "b2b2…b2b2", "previousKing": "a1a1…a1a1", "passCount": 2, "conquests": 1,
    "value": "1500", "treasury": "1650", "protectsLeft": 2, "deadline": 1780000607000,
    "clockSeconds": 600, "nextClockSeconds": 60, "clockCapSeconds": 600, "conquestAddSeconds": 60, "conquestMinSeconds": 0
  }
}
```

### `round_settled`, reasons `claim`, `keeper`, `chain`
The pool was paid out. `claim`: the king pressed the button. `keeper`: the server did it. `chain`: the server noticed the state coin is gone and has no details. After the payout `treasury` is `"0"`; `payout` is what the winner received (`null` for reason `chain`). Extra fields: `txid`, `winner`, `pot` (the same as `payout`, kept for older pages), `cancelled` (always `false` unless the round never opened).

```json
{
  "seq": 5, "roundId": "00…00", "at": 1780000700000, "type": "round_settled", "reason": "keeper",
  "data": {
    "king": "b2b2…b2b2", "previousKing": "a1a1…a1a1", "passCount": 2, "conquests": 1,
    "value": "1500", "treasury": "0", "payout": "1650", "protectsLeft": 2, "deadline": 1780000607000,
    "clockSeconds": 600, "nextClockSeconds": 60, "clockCapSeconds": 600, "conquestAddSeconds": 60, "conquestMinSeconds": 0,
    "txid": "00…05", "winner": "b2b2…b2b2", "pot": "1650", "cancelled": false
  }
}
```
If only the opener played, `winner` is the opener and `conquests` is `0` (the page says "No challengers, pool returned").

### `clock_warning` (made by the page, not the server)
The server only sets deadlines; each device counts down on its own against the server's clock. The page raises one `clock_warning` the first time the countdown reaches 60, 30 and 10 seconds for a given deadline (a jump past a level raises one warning for the level it lands on). `seq` is `0`, `reason` is `"60s"`, `"30s"` or `"10s"`. The 30-second one is also the moment protect closes. A conquest gives a new deadline, so the warnings fire again when the new countdown reaches each level. It also carries `clockCapSeconds`, `conquestAddSeconds` and `conquestMinSeconds` (from the snapshot, `null` when the server does not send them).

```json
{
  "seq": 0, "roundId": "<game id>", "at": 1780000577020, "type": "clock_warning", "reason": "30s",
  "data": {
    "level": 30, "remainingMs": 29980, "deadline": 1780000607000, "king": "b2b2…b2b2", "previousKing": "a1a1…a1a1",
    "passCount": 2, "conquests": 1, "value": "1500", "treasury": "1650", "protectsLeft": 2, "clockSeconds": 600, "nextClockSeconds": 90
  }
}
```

## How a client subscribes

**From the page code (what the animation uses).** `src/sceneBus.ts`:

```ts
import { onSceneEvent, onSceneSnapshot } from "./sceneBus.ts";

const stop = onSceneEvent((event, source) => { /* source: "server" | "client" | "mock" */ });
onSceneSnapshot((snapshot, source) => { /* the full round state, for the first frame and after resyncs */ });
```

- `onSceneEvent` receives every event in the order the page applies it: server events (live and the history the page reads at load do **not** replay through it; only new events do), the page's own `clock_warning`, and events from the mock player.
- `onSceneSnapshot` receives each full round snapshot the page gets (about every few seconds, and after each event). Use it to draw the starting scene when the page loads in the middle of a round. A snapshot has `status`, `deadline`, `king`, `pot`, `kingdom` (`holder`, `previousKing`, `value`, `protectsLeft`, `conquest`, `clockSeconds`, …) and `lastSeq`.
- A listener that throws is skipped; it cannot break the page.

**From the network (what the page itself does).** `src/referee/api.ts`:
- `GET /rounds/:id` → the snapshot (`serverNow`, `lastSeq`, `status`, `deadline`, `kingdom`, …).
- `GET /rounds/:id/events?after=<seq>` → `{ serverNow, resync, lastSeq, events }`. `resync: true` means the history no longer reaches back: reload the snapshot.
- WebSocket `/rounds/:id/ws?after=<seq>` → messages `{ "kind": "hello", "serverNow", "lastSeq" }`, `{ "kind": "event", "event": {…} }`, `{ "kind": "resync", "lastSeq" }`. The page reconnects by itself and asks for events after the last `seq` it has.
- History keeps the last 200 events per round. Events saved before `roundId` existed get it filled in when they are sent.

## The mock round (dev only)

`npm run dev`, then press **Play mock round** (bottom right of the page). It replays: waiting, open (Alice), protect +5.00, conquest (Bob), the 60/30/10-second warnings, round over. It uses fake kings `a1a1…` and `b2b2…`, skips time by moving the page's clock forward (the real countdown and warnings run on it), and goes through the same handlers as real events. While it is on, the page does not ask the real server about anything and the buttons cannot spend. **Back to the real round** puts the clock back and resumes. It is not part of the production build.

## Changing the format

Adding a field is not a breaking change for readers that ignore what they do not know. Renaming or removing a field, changing a type, or changing a `type`/`reason` code is. Any such change is announced to the animation branch **before** it is made on `main`.
