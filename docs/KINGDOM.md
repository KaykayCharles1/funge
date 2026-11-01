# Kingdom v1: rules, state and money flow

Status: spec for the build steps K2 onward. The old steal contract and page keep working until the old path is retired (K9).

## Rules
- **Actions:** open, conquer, protect, settle, plus the existing no-referee settleFallback. No reclaim in v1.
- **Waiting:** a new game has no king, no pool and no PUSD in it. Nothing can be settled in this state.
- **Open:** the first player pays OPENING_PRICE (10 PUSD), 100% into the pool, becomes king, value = 10.
- **Conquer:** pay value + fee. The dethroned king gets value x (1 - CUT) + the fee. The pool gets the rest of the payment. The value does not change. Conquest stays open until the clock reaches zero plus the 1-second grace.
- **Protect:** king only. Amounts 1, 5 or 10 PUSD, 100% into the pool, raising the stored value. The value never exceeds CAP (50). At most 2 per reign; the counter resets on every conquest. Protect does not reset the clock and is refused in the last 30 seconds before the deadline (a referee rule).
- **Settle:** the last king takes the whole pool plus the trophy. If only the opener played, the pool goes back to the opener and the page says "No challengers, pool returned".
- **Take back your throne:** a normal conquest at the normal price. The page shows it to the player whose key is in the previous-king field.
- **Clock (referee only):** the bell starts at 10:00 on open and drops 30 s per conquest, floor 2:00. Demo preset: 5:00, 30 s, 2:00. Every open or conquest resets the clock to the current bell. Protect changes nothing. Every clock change publishes an event with a reason code.

## Deploy-time settings (in the contract)
| Setting | Value | Notes |
|---|---|---|
| OPENING_PRICE | 1000 | base units (10.00 PUSD) |
| FEE_PERCENT | 2 | whole percent |
| CUT_PERCENT | 10 | whole percent |
| CAP | 5000 | base units (50.00 PUSD) |
| PROTECTS_PER_REIGN | 2 | |
| UNIT | 100 | base units in 1 PUSD; protect amounts are UNIT, 5 x UNIT, 10 x UNIT |
| FALLBACK_BLOCKS | 12 | |
| WAITING_FALLBACK_BLOCKS | dropped | the waiting state holds no PUSD |

The clock settings and the protect lockout live in the referee, not in the contract.

## State: the 40-byte commitment (the CashTokens limit)
| Bytes | Field | Notes |
|---|---|---|
| 0-3 | passCount | kings so far (open = 1); 0 = waiting. Same as today |
| 4-23 | holder | 20-byte key hash; zeros while waiting. Same as today |
| 24-27 | value | base units; 0 while waiting |
| 28 | flags | bits 0-1: protects used this reign; other bits must be 0 |
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
| open | 10.00 | none | +10.00 |
| conquer at value 10.00 | 10.20 | 9.20 | +1.00 |
| conquer at value 15.00 | 15.30 | 13.80 | +1.50 |
| conquer, odd value 10.05 (rounding example) | 10.25 | 9.24 | +1.01 |
| protect +5 | 5.00 | none | +5.00 |

Worked example: A opens (pool 10.00). B conquers: B pays 10.20, A gets 9.20, pool 11.00. C conquers: C pays 10.20, B gets 9.20, pool 12.00. C wins the 12.00 pool, a net +1.80.

Every conquest conserves tokens: what the payer sends out equals what the king and the pool receive.

## Decisions made here, not in the brief (tell me if you disagree)
1. **Waiting state.** A token output with zero PUSD is invalid under CashTokens, so an "empty pot coin" cannot exist. The smallest alternative: the pot is a BCH-only coin until the opener pays, then becomes the PUSD pot. The creator's dust BCH in the two contracts is not recoverable if nobody ever opens (about 2,000 sats).
2. **Finding the pot coin.** The pot is always output 1 of the transaction that created the current state coin. Today's code takes the first coin at the pot address, so anyone can send a stray token there and confuse it. The kingdom path will not.
3. **Same-key conquest is refused, as an accident guard only.** The contract rejects a conquest whose new holder equals the current holder, so a king cannot do it by mistake. It does not prevent self-conquest with a second wallet. That costs about 10% net (returned through the pool if that wallet wins) and resets the protect counter. This is a known limitation of v1 (see KNOWN_ISSUES.md), with no design change.
4. **Fee and cut are whole percents.** The values are always whole PUSD, so the rounding rule rarely matters, but it is defined.
5. **Protect on a maxed value.** Refused by the contract ("Walls at maximum").
6. **Coexistence.** New contract file, new game file `public/game.<network>.kingdom.json` (contractVersion 3). The server will load the old v2 game and the kingdom game side by side, and the page picks one (a config flag, plus `?mode=kingdom` for testing) until the old path is retired.
7. **How the next round starts (open point).** After a round settles, a new game must be deployed. For the hackathon, the owner runs a one-command deploy script, and the page shows "Next round is being prepared" until the new game file is live. Later, optionally, the server could auto-deploy: after a settlement it would deploy the next game using a separate small key that only holds deploy funds. This key is never the referee key, so a leak can lose only that small balance and cannot touch rounds or signatures. Not built in v1.

## Deferred
Reclaim, multi-kingdom, the design pass, trophy art for kingdoms, a Withdraw button, the mainnet round.

## PUSD token and decimals
- **Confirmed from the issuer.** The ParyonUSD launch post (https://paryonusd.com/blog/launch) gives the token ID `2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544` and states "PUSD has 2 decimal places": the smallest base unit is 0.01 PUSD.
- **Verify in a wallet before the first mainnet deploy** (token ID and decimals as the wallet's metadata shows them). Mainnet is not touched until the owner says so.
- Chipnet uses our own test token with 2 decimals, so nothing on chipnet depends on this.