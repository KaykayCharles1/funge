# Runbook: putting Funge online and keeping it running

## The parts
| Part | Where | Notes |
|---|---|---|
| Page | static host | `VITE_REFEREE_URL=https://<server> npm run build`, upload `dist/` |
| Server (the referee) | cloud host with HTTPS | one running copy at a time, never two |
| Referee key | the server host's secret settings | never in the repo, chat or logs |
| Game file | `public/game.<network>.v2.json` | must be the same in the page build and the server checkout |
| Chain data | public Electrum servers | few and slow on chipnet; see `KNOWN_ISSUES.md` |

Fill in the addresses here once they exist: server ______, page ______, backup server ______.

## Rule: one clock
Only one server may run for a game at a time. Two servers would have two clocks and could disagree about who was in time. The backup stays stopped until the main one is confirmed gone.

## Before going live (once)
1. Finish every test with a throwaway game. The chaos scripts and tests act on whatever game is in `public/`, so never run them against the real game.
2. Rehearse on the real hosts: deploy a throwaway game, start the server with `FUNGE_RESET_SECONDS=60 FUNGE_KEEPER_DELAY_SECONDS=60`, build the page for the real server address, and play a full round from two devices (game wallet and WizardConnect).
3. Deploy the real game, last:
   - stop the server;
   - `rm public/game.<network>.v2.json`, then `node scripts/deploy-referee.ts <referee public key>` (default fallback 12 and 144 blocks; never set the FUNGE_*_BLOCKS test settings for it);
   - commit the game file;
   - on the server host: pull the commit, **restart the server without the test timers**;
   - rebuild and upload the page.
4. Run the preflight: `node scripts/preflight.ts https://<server> https://<page>`. Every line must pass.
5. Open the page on a phone and a laptop. Check the clock, the pot, the art, a grab with the game wallet, and a connection with Cashonize.

## Server host settings
- Start: `npm ci` then `npm run server`. Node 24.
- `FUNGE_HOST=0.0.0.0`, `FUNGE_ALLOWED_ORIGINS=https://<page>`, `FUNGE_TRUST_PROXY=1`, `REFEREE_KEY_<NETWORK>=<key>`, `FUNGE_DATA_DIR=<persistent disk folder>`.
- Do not set `FUNGE_RESET_SECONDS`, `FUNGE_KEEPER_DELAY_SECONDS` or `FUNGE_UNCONFIRMED_CAP` for the real round.
- Health check path: `/health`. Restart automatically if it crashes (restart is safe: downtime counts as a pause).
- The data folder must survive restarts. If it is lost, a round that already has grabs gets a fresh 10 minutes from the chain's state, and no one loses a payout.

## Demo day
- **A day before:** preflight; check the host's clock is synced; fund the demo wallets with PUSD and a little BCH; read the server log for errors.
- **An hour before:** preflight again; one grab round on the throwaway stack if you changed anything; open the page on the device you will present from; have the backup server's details ready.
- **During:** keep the server log and the page open side by side. A grab that is refused as "too late" is the rule working, not a fault.
- **After:** let the round end. The winner presses Claim, or the server settles about two minutes after the deadline. Save the settlement transaction id and a screenshot.

## When something breaks
| What you see | Likely cause | Do this |
|---|---|---|
| Page says it cannot reach the game server | Server down or its address changed | Check `/health` in a browser. Restart the server on its host. If it does not come back in a few minutes, use the backup (below). Players are safe: after 12 blocks anyone can settle. |
| Preflight says CORS fails | `FUNGE_ALLOWED_ORIGINS` differs from the page address | Set it to the exact page address (https, no slash), restart. |
| Preflight says the page cannot reach the server | Page built for another address | Rebuild with the right `VITE_REFEREE_URL`, upload again. |
| Live connection fails but the rest passes | Host blocks WebSockets | Enable WebSockets, or pick a host that supports them. |
| "Network busy, clock paused" | Many grabs in one block (the unconfirmed limit) | Wait for the next block; the clock resumes by itself and the round gets the paused time back. |
| Pages show old numbers or "chain view is stale" | Electrum servers slow or down | Wait; check `node scripts/ping-servers.ts`; reorder the list in `src/config.ts` and rebuild if needed. |
| A player says their grab "was too late" | It reached the server after the deadline plus one second | Expected. WizardConnect approvals count against the player's time. |
| Round is over but nobody claimed | Winner away | The server settles by itself after the keeper delay. If the server is down, use the Settle button after the fallback wait. |
| Server will not start | A safety check failed | Read the message: wrong key, missing origin, a test timer on mainnet, or a game file that does not match the key. Fix the setting, do not bypass the check. |
| The host clock looks wrong | Time sync stopped | Sync the clock and restart the server. Preflight shows the skew. |

## Backup server
1. Prepare a second host the same way as the main one: same code, same game file, same key in its secret settings, its own data folder. **Leave it stopped.**
2. Make failover quick. Best: give the server a name you control (for example `referee.<your domain>`) with a short record lifetime (60 s) and build the page for that name. To fail over, point the name at the backup host. Without your own name, rebuild the page with the backup's address and upload it again (a few minutes).
3. To fail over: confirm the main server is really down (not just slow), start the backup, run the preflight against it, switch the name or the page. Never run both.
4. The backup starts without the main server's saved clock, so a round that already has grabs gets a fresh 10 minutes. Players keep their position and the pot.
5. If you can reach the main server's data folder, copy `rounds.<network>.json` to the backup's data folder before starting it, and the old deadlines carry over, with the downtime counted as a pause.

## If the referee key is lost or leaked
- **Lost:** running rounds can only end through the fallback (12 blocks, or 144 for a round nobody joined). Deploy a new game with a new key.
- **Leaked:** an attacker could refuse players or end rounds early, but cannot move the pot or choose who is paid. Stop the server, deploy a new game with a new key, and tell players.

## For the mainnet round (not done yet)
- Generate the mainnet referee key on the production host only, never on a development machine.
- Set `network` to mainnet in `src/config.ts`, fill in the real PUSD category (and check its decimals), choose a mainnet Electrum server list, and rebuild.
- The server refuses test timers and chipnet keys on mainnet; do not look for ways around that.
- Start with a small seed and a rehearsal at small stakes. The game wallet shows a small-stakes banner on mainnet.