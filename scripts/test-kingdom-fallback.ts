// Live chipnet test of the escape hatch: settle a Kingdom round WITHOUT the game server, after enough quiet blocks.
//
// Prepare (the round must have a short fallback, and the server must NOT be running, or its keeper may settle first):
//   rm public/game.chipnet.kingdom.json
//   FUNGE_FALLBACK_BLOCKS=2 node scripts/deploy-kingdom.ts
//   npm run server                      (in another terminal)
//   node scripts/kingdom-play.ts open   (the opener becomes king)
//   then stop the server (Ctrl+C in its terminal) within a minute or two, before the clock runs out
// Run (any wallet with a little BCH pays the fee; it does not need PUSD):
//   read -rs SPIKE_MNEMONIC; export SPIKE_MNEMONIC
//   node scripts/test-kingdom-fallback.ts
// It tries once too early (expects a refusal), waits for enough blocks, settles, then checks that the pool went to the king.
import { readFileSync } from "node:fs";
import { CONFIG } from "../src/config.ts";
import { findEndedKingdom } from "../src/endedKingdom.ts";
import { makeProvider } from "../src/lib/provider.ts";
import { kingdomSettleWithoutReferee, watchKingdomChain } from "../src/referee/kingdomFallback.ts";
import { walletFromMnemonic } from "../src/wallet/local.ts";
import { loadArtifact } from "./helpers.ts";

const game = JSON.parse(readFileSync(new URL(`../public/game.${CONFIG.network}.kingdom.json`, import.meta.url), "utf8"));
const varName = process.env.MNEMONIC_VAR ?? "SPIKE_MNEMONIC";
const mnemonic = process.env[varName];
if (!mnemonic) throw new Error(`Set ${varName} first (read -rs ${varName}; export ${varName}).`);
const wallet = walletFromMnemonic(mnemonic);
const provider = makeProvider();
const artifacts = { pot: loadArtifact("FungePot"), kingdom: loadArtifact("FungeKingdom") };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (h: string | null) => (h ? `${h.slice(0, 8)}…${h.slice(-6)}` : "none");

let c = await watchKingdomChain(game, provider);
if (!c.live || c.passCount < 1) throw new Error("The round must be open (a king, and not yet settled). Run kingdom-play.ts open first.");
const king = c.holderPkh;
const pot = c.pot;
console.log(`round open: pass ${c.passCount}, king ${short(king)}, pool ${pot}, need ${c.limit} quiet blocks, so far ${c.confirmations}`);
console.log("Make sure the game server is stopped. Its keeper would settle this round when the clock runs out.");

// 1. too early: the contract and the network must refuse
if (c.confirmations === null || c.confirmations < c.limit) {
  const early = await kingdomSettleWithoutReferee(game, provider, wallet, artifacts);
  if (early.ok) throw new Error("A settlement before the limit was accepted. That must never happen.");
  console.log(`ok    too early is refused (${early.code})`);
  if (early.code !== "too_early") console.log(`note  expected the code too_early, got ${early.code}: ${early.text}`);
}

// 2. wait for the blocks (chipnet blocks can take a while)
for (let i = 0; i < 120; i++) {
  c = await watchKingdomChain(game, provider);
  if (!c.live) throw new Error("The round was settled by someone else while waiting.");
  if (c.confirmations !== null && c.confirmations >= c.limit) break;
  console.log(`waiting: ${c.confirmations} of ${c.limit} quiet blocks`);
  await sleep(60_000);
}
if (c.confirmations === null || c.confirmations < c.limit) throw new Error("Gave up waiting for blocks. Run the script again later.");

// 3. settle without the server
const done = await kingdomSettleWithoutReferee(game, provider, wallet, artifacts);
if (!done.ok) throw new Error(`fallback settlement failed (${done.code}): ${done.text}`);
console.log("ok    settled without the server, txid", done.txid);

// 4. the pool and the trophy must have gone to the king
let ended = null;
for (let i = 0; i < 20 && !ended; i++) {
  ended = await findEndedKingdom(game, provider).catch(() => null);
  if (!ended) await sleep(3000);
}
if (!ended) throw new Error("The settlement is not visible on the network yet. Check the txid above.");
if (ended.winnerPkh !== king) throw new Error(`The pool went to ${short(ended.winnerPkh)}, not the king ${short(king)}`);
if (ended.potPaid !== pot) throw new Error(`The pool paid was ${ended.potPaid}, expected ${pot}`);
console.log(`ok    the king ${short(king)} got the whole pool (${ended.potPaid}) and the trophy`);
console.log("\nKingdom fallback live test passed.");
process.exit(0);