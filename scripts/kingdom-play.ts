// Plays ONE Kingdom action with a game wallet on chipnet, through the real referee server.
//   read -rs SPIKE_MNEMONIC; export SPIKE_MNEMONIC
//   node scripts/kingdom-play.ts open             (first player, pays the opening price)
//   node scripts/kingdom-play.ts conquer          (pays the price the server shows)
//   node scripts/kingdom-play.ts protect 100      (the king adds 1.00 PUSD; amounts are 100, 500 or 1000 units)
// To use the second wallet: MNEMONIC_VAR=SPIKE_MNEMONIC_2 node scripts/kingdom-play.ts conquer
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONFIG } from "../src/config.ts";
import { makeProvider } from "../src/lib/provider.ts";
import { getRound } from "../src/referee/api.ts";
import { kingdomAct, kingdomProtect } from "../src/referee/kingdomActions.ts";
import { walletFromMnemonic } from "../src/wallet/local.ts";
import { loadArtifact } from "./helpers.ts";

const action = process.argv[2];
assert.ok(
  action === "open" || action === "conquer" || action === "protect",
  "Usage: node scripts/kingdom-play.ts open | conquer | protect <amount in units>",
);
const name = process.env.MNEMONIC_VAR ?? "SPIKE_MNEMONIC";
const phrase = process.env[name];
if (!phrase) throw new Error(`Set ${name} first.`);

const game = JSON.parse(readFileSync(new URL(`../public/game.${CONFIG.network}.kingdom.json`, import.meta.url), "utf8"));
const wallet = walletFromMnemonic(phrase);
const provider = makeProvider();
const artifacts = { pot: loadArtifact("FungePot"), kingdom: loadArtifact("FungeKingdom") };

const snap = await getRound(game.gameCategory);
if (!snap.ok) throw new Error(`server: ${JSON.stringify(snap)}`);
const k = snap.round.kingdom;
if (!k) throw new Error("the server did not report a Kingdom round");

let out;
if (action === "protect") {
  assert.ok(/^\d+$/.test(process.argv[3] ?? ""), "Give the protect amount in units: 100, 500 or 1000");
  const amount = BigInt(process.argv[3]!);
  console.log(`${name} protects with ${amount} units (round is ${snap.round.status}, pass ${snap.round.passCount})`);
  out = await kingdomProtect({ game, provider, wallet, amount, artifacts });
} else {
  const expectedPay = BigInt(action === "open" ? k.openingPrice : (k.conquest?.pay ?? "0"));
  console.log(`${name} plays ${action} for ${expectedPay} units (round is ${snap.round.status}, pass ${snap.round.passCount})`);
  out = await kingdomAct({ game, provider, wallet, action, expectedPay, artifacts });
}
console.log(out.ok ? `accepted: pass ${out.passCount}, txid ${out.txid}` : `refused (${out.code}): ${out.text}`);
process.exit(out.ok ? 0 : 1);