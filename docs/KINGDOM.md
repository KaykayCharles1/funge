# Kingdom v1: rules, state and money flow

Status: built and running on chipnet. The old steal game was retired in K9d and is kept only in the git tags `v1-grab` and `v2-steal-timer`.

## Rules
- **Actions:** open, conquer, protect, settle, plus the existing no-referee settleFallback. No reclaim in v1.
- **Waiting:** a new game has no king, no pool and no PUSD in it. Nothing can be settled in this state.
- **Open:** the first player pays OPENING_PRICE (5 PUSD), 100% into the pool, becomes king, value = 5.
- **Conquer:** pay value + fee. The dethroned king gets value x (1 - CUT) + the fee. The pool gets the rest of the payment. The value does not change. Conquest stays open until the clock reaches zero plus the 1-second grace.
- **Protect:** king only. Amounts 1, 2 or 5 PUSD, 100% into the pool, raising the stored value. The value never exceeds CAP (50). At most 2 per reign; the counter resets on every conquest. Protect does not reset the clock and is refused in the last 30 seconds before the deadline (a referee rule).
- **Settle:** the last king takes the whole pool plus the trophy. If only the opener played, the pool goes back to the opener and the page says "No challengers, pool returned".
- **Cancel round:** the current king only, while the round is open with zero conquests, not paused, and before the deadline (no grace). It is the contract's settle, signed by the referee: the whole pool and the trophy go to the king, so the king gets back everything paid in. The king proves consent with a coin at the king's address as input 2, as for protect. A conquest and a cancel arriving together are decided by the round lock; the loser gets `round_over` (the conquest) or `not_cancellable` (the cancel). There is no other forfeit: a king who does not want to play lets the clock run out.
- **Take back your throne:** a normal conquest at the normal price. The page shows it to the player whose key is in the previous-king field.
- **Clock (referee only):** the open starts the clock at CAP (5:00). Every conquest, a take-back too, adds ADD = 0:30 to the time left, never above CAP. With less than ENDGAME = 1:00 left it adds ENDGAME_ADD = 0:10 instead, never above 1:00. MIN = 0 (off) is a floor no conquest goes below. "Left" is the time left when the referee records the move (never below 0: a conquest inside the grace gets 0:10). So 5:00 stays 5:00, 4:40 becomes 5:00, 3:20 becomes 3:50, 1:00 becomes 1:30, 0:55 becomes 1:00, 0:45 becomes 0:55, 0:10 becomes 0:20. Protect changes nothing. Every clock change publishes an event with a reason code.

## Deploy-time settings (in the contract)
| Setting | Value | Notes |
|---|---|---|
| OPENING_PRICE | 500 | base units (5.00 PUSD) |
| FEE_PERCENT | 2 | whole percent |
| CUT_PERCENT | 10 | whole percent |
| CAP | 5000 | base units (50.00 PUSD) |
| PROTECTS_PER_REIGN | 2 | |
| UNIT | 100 | base units in 1 PUSD; protect amounts are UNIT, 2 x UNIT, 5 x UNIT |
| FALLBACK_BLOCKS | 12 | |
| WAITING_FALLBACK_BLOCKS | dropped | the waiting state holds no PUSD; the setting no longer exists anywhere in the project |

The clock settings and the protect lockout live in the referee, not in the contract.

## State: the 40-byte commitment (the CashTokens limit)
| Bytes | Field | Notes |
|---|---|---|
| 0-3 | passCount | kings so far (open = 1); 0 = waiting. Same as today |
| 4-23 | holder | 20-byte key hash; zeros while waiting. Same as today |
| 24-27 | value | base units; 0 while waiting |
| 28 | protects used | protects used this reign, a plain number 0 to 2 (no bit tricks) |
| 29-39 | previous king | first 11 bytes of the dethroned king's key hash; zeros after open |

The trophy copies the final commitment. The first 24 bytes keep today's meaning, so the ended card keeps working.

## Transaction shapes
| Action | Inputs | Outputs |
|---|---|---|
| open | 0 state, 1 pot (BCH only), 2+ wallet | 0 state, 1 pot (PUSD = OPENING_PRICE), 2+ change |
| conquer | 0 state, 1 pot, 2+ wallet | 0 state, 1 pot, 2 payout to the dethroned king (PUSD), 3+ change |
| protect | 0 state, 1 pot, **2 = a coin at the holder's address**, more wallet inputs | 0 state, 1 pot, 2+ change |
| settle, settleFallback | 0 state, 1 pot | 0 pool to the king, 1 trophy |

The referee signature goes in input 0 for open, conquer, protect and settle. For protect, the holder's own signature on input 2 proves the king agreed.

## Money flow
All amounts are integers in base units.
- `fee = floor(value x FEE_PERCENT / 100)`
- `payment = value + fee`
- `kingGets = floor(value x (100 - CUT_PERCENT) / 100) + fee`
- `poolGets = payment - kingGets` (the pool takes the remainder, so no unit is ever lost)

| Action | Payer pays | Dethroned king | Pool |
|---|---|---|---|
| open | 5.00 | none | +5.00 |
| conquer at value 5.00 | 5.10 | 4.60 | +0.50 |
| conquer at value 10.00 | 10.20 | 9.20 | +1.00 |
| conquer at value 15.00 | 15.30 | 13.80 | +1.50 |
| conquer, odd value 10.05 (rounding example) | 10.25 | 9.24 | +1.01 |
| protect +5 | 5.00 | none | +5.00 |

Worked example: A opens (pool 5.00). B conquers: B pays 5.10, A gets 4.60, pool 5.50. C conquers: C pays 5.10, B gets 4.60, pool 6.00. C wins the 6.00 pool, a net +0.90.

Every conquest conserves tokens: what the payer sends out equals what the king and the pool receive.

## Decisions made here, not in the brief (tell me if you disagree)
1. **Waiting state.** A token output with zero PUSD is invalid under CashTokens, so an "empty pot coin" cannot exist. The smallest alternative: the pot is a BCH-only coin until the opener pays, then becomes the PUSD pot. The creator's dust BCH in the two contracts is not recoverable if nobody ever opens (about 2,000 sats).
2. **Finding the pot coin.** The pot is always output 1 of the transaction that created the current state coin. Today's code takes the first coin at the pot address, so anyone can send a stray token there and confuse it. The kingdom path will not.
3. **Same-key conquest is refused, as an accident guard only.** The contract rejects a conquest whose new holder equals the current holder, so a king cannot do it by mistake. It does not prevent self-conquest with a second wallet. That costs about 10% net (returned through the pool if that wallet wins) and resets the protect counter. This is a known limitation of v1 (see KNOWN_ISSUES.md), with no design change.
4. **Fee and cut are whole percents.** The values are always whole PUSD, so the rounding rule rarely matters, but it is defined.
5. **Protect on a maxed value.** Refused by the contract ("Walls at maximum").
6. **Coexistence (finished).** New contract file, new game file `public/game.<network>.kingdom.json` (contractVersion 3). For a while the server loaded the old v2 game and the Kingdom game side by side and the page chose with `?mode=kingdom`. In K9d the old path was deleted, not moved aside: the server, the page, the deploy script, the preflight and the tests know only the Kingdom game, and the old code is reachable through the git tags. The server still takes a list of games, so a second game could be added later.
7. **How the next round starts (open point).** After a round settles, a new game must be deployed. For the hackathon, the owner runs a one-command deploy script, and the page shows "Next round is being prepared" until the new game file is live. Later, optionally, the server could auto-deploy: after a settlement it would deploy the next game using a separate small key that only holds deploy funds. This key is never the referee key, so a leak can lose only that small balance and cannot touch rounds or signatures. Not built in v1.
8. **What "PUSD payout" means to the contract.** It checks that the output's token category equals PUSD, so mutable and minting NFTs riding along are refused. An immutable NFT of the PUSD category is not detectable by the category check. It is harmless: the sender gives it away, and amount, destination and category are still enforced.

## Deferred
Reclaim, multi-kingdom, the design pass, trophy art for kingdoms, a Withdraw button, the mainnet round.

## PUSD token and decimals
- **Confirmed from the issuer.** The ParyonUSD launch post (https://paryonusd.com/blog/launch) gives the token ID `2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544` and states "PUSD has 2 decimal places": the smallest base unit is 0.01 PUSD.
- **Verify in a wallet before the first mainnet deploy** (token ID and decimals as the wallet's metadata shows them). Mainnet is not touched until the owner says so.
- Chipnet uses our own test token with 2 decimals, so nothing on chipnet depends on this.