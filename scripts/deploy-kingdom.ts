// Deploys a Kingdom game and writes public/game.<network>.kingdom.json. One command, run by the owner.
//   node scripts/deploy-kingdom.ts [<33-byte referee public key in hex>]
// Without a key, on chipnet, it uses the test key in .referee.chipnet.json (made by scripts/gen-referee-key.ts). No PUSD is needed: the round starts
// "waiting", with a BCH-only pot coin and an empty state. The first player's open puts the first PUSD in.
// Chipnet test games can use a short fallback: FUNGE_FALLBACK_BLOCKS=3 node scripts/deploy-kingdom.ts
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Contract, SignatureTemplate, TransactionBuilder } from "cashscript";
import { binToHex, hexToBin } from "@bitauth/libauth";
import { parseKingdomGameFile } from "../server/games.ts";
import { CONFIG, pusdCategory } from "../src/config.ts";
import { WAITING_STATE, decodeKingdomCommitment, encodeKingdomCommitment } from "../src/lib/kingdom.ts";
import { loadEnv } from "./env.ts";
import { loadArtifact, retry, toVmCategory } from "./helpers.ts";

const FEE_RATE = 2;
const OUT = `public/game.${CONFIG.network}.kingdom.json`;
// The state and the pot each keep this much BCH for good. A settlement pays its own fee from them, and the
// Kingdom contract is large, so this is more than the steal game needed.
const CONTRACT_SATS = 5_000n;

// A test game can use a short fallback so the escape hatch can be tried on chipnet. Never on mainnet.
function fallbackBlocks(): number {
  const v = process.env.FUNGE_FALLBACK_BLOCKS;
  if (v === undefined) return CONFIG.fallbackBlocks;
  assert.ok(CONFIG.network !== "mainnet", "FUNGE_FALLBACK_BLOCKS cannot be used on mainnet.");
  const n = Number(v);
  assert.ok(Number.isInteger(n) && n >= 1 && n <= 1000, "FUNGE_FALLBACK_BLOCKS must be a whole number from 1 to 1000.");
  return n;
}

function refereeKey(): string {
  const given = (process.argv[2] ?? process.env.REFEREE_PUBKEY ?? "").toLowerCase();
  if (given) return given;
  // Chipnet: the test key made by gen-referee-key.ts (git-ignored) is the one the server signs with.
  const keyFile = new URL("../.referee.chipnet.json", import.meta.url);
  if (CONFIG.network === "chipnet" && existsSync(keyFile)) {
    console.log("No referee key given: using the chipnet test key from .referee.chipnet.json.");
    const privateKey = hexToBin(String(JSON.parse(readFileSync(keyFile, "utf8")).privateKeyHex));
    return binToHex(new SignatureTemplate(privateKey).publicKey);
  }
  return "";
}

async function main() {
  assert.ok(!existsSync(OUT), `${OUT} already exists. Delete it first if you really want a new game.`);
  const refereeHex = refereeKey();
  assert.match(refereeHex, /^0[23][0-9a-f]{64}$/, "Usage: node scripts/deploy-kingdom.ts <33-byte referee public key in hex>");
  const blocks = fallbackBlocks();
  const k = CONFIG.kingdom;

  const env = await loadEnv();
  const { provider, tpl, lock, lockHex } = env;
  console.log("paying wallet:", env.address);
  const pusd = pusdCategory();
  assert.match(pusd, /^[0-9a-f]{64}$/, "pusdCategory in src/config.ts is not set");

  const utxos = await retry(() => provider.getUtxos(env.address));
  const funding = utxos
    .filter((u) => !u.token)
    .sort((a, b) => (a.satoshis < b.satoshis ? 1 : -1))[0];
  assert.ok(funding, "No BCH-only UTXO found");
  const prepSats = CONTRACT_SATS * 2n + 10_000n;
  assert.ok(funding.satoshis > prepSats + 5_000n, `The wallet needs a BCH coin of more than ${prepSats + 5_000n} sats.`);

  // Tx 1 (prep): a spare output at index 0. Its txid becomes the game's token category.
  const prep = await new TransactionBuilder({ provider })
    .addInput(funding, tpl.unlockP2PKH())
    .addOutput({ to: lock, amount: prepSats })
    .addBchChangeOutputIfNeeded({ to: lock, feeRate: FEE_RATE })
    .send();
  const gameCategory = prep.txid;
  console.log("prep txid / game category:", gameCategory);

  const pot = new Contract(loadArtifact("FungePot"), [toVmCategory(gameCategory)], { provider });
  const state = new Contract(
    loadArtifact("FungeKingdom"),
    [
      hexToBin(pot.lockingBytecode),
      toVmCategory(pusd),
      hexToBin(refereeHex),
      k.openingPrice,
      k.feePercent,
      k.cutPercent,
      k.cap,
      BigInt(k.protectsPerReign),
      k.unit,
      BigInt(blocks),
    ],
    { provider },
  );
  console.log("state contract:", state.tokenAddress);
  console.log("pot contract  :", pot.tokenAddress);

  const game = {
    contractVersion: 3,
    network: CONFIG.network,
    gameCategory,
    pusdCategory: pusd,
    state: { address: state.address, tokenAddress: state.tokenAddress, lockingBytecode: state.lockingBytecode },
    pot: { address: pot.address, tokenAddress: pot.tokenAddress, lockingBytecode: pot.lockingBytecode },
    refereePubkey: refereeHex,
    params: {
      openingPrice: k.openingPrice.toString(),
      feePercent: k.feePercent.toString(),
      cutPercent: k.cutPercent.toString(),
      cap: k.cap.toString(),
      protectsPerReign: k.protectsPerReign,
      unit: k.unit.toString(),
      fallbackBlocks: blocks,
    },
    creatorPkh: env.pkhHex,
    prepTxid: prep.txid,
    initTxid: "",
  };
  parseKingdomGameFile(game, CONFIG.network); // the server must be able to read this file; check before spending more

  // Tx 2 (init): the state NFT with an all-zero commitment ("waiting") into the state contract, and a BCH-only
  // coin into the pot contract. The pot MUST be output 1: the server and the page find it that way.
  const genesisInput = { txid: prep.txid, vout: 0, satoshis: prepSats, lockingBytecode: lockHex };
  const init = await new TransactionBuilder({ provider })
    .addInput(genesisInput, tpl.unlockP2PKH())
    .addOutput({
      to: state.tokenAddress,
      amount: CONTRACT_SATS,
      token: {
        amount: 0n,
        category: gameCategory,
        nft: { capability: "mutable", commitment: encodeKingdomCommitment(WAITING_STATE) },
      },
    })
    .addOutput({ to: pot.tokenAddress, amount: CONTRACT_SATS })
    .addBchChangeOutputIfNeeded({ to: lock, feeRate: FEE_RATE })
    .send();
  console.log("init txid:", init.txid);
  game.initTxid = init.txid;

  mkdirSync("public", { recursive: true });
  writeFileSync(OUT, JSON.stringify(game, null, 2));
  console.log("wrote", OUT);

  for (let i = 0; i < 10; i++) {
    const [[s], potCoins] = await Promise.all([retry(() => state.getUtxos()), retry(() => pot.getUtxos())]);
    const p = potCoins.find((u) => u.txid === init.txid && u.vout === 1);
    if (s?.token?.nft && p) {
      const c = decodeKingdomCommitment(s.token.nft.commitment);
      assert.deepEqual(c, WAITING_STATE, "the state did not start out waiting");
      assert.ok(!p.token, "the waiting pot must hold no tokens");
      console.log("state and pot are on the chain. Round is waiting, pass count", c.passCount);
      return;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log("State and pot not visible yet (server lag). Re-check in a minute.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });