import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Contract, TransactionBuilder } from "cashscript";
import { hexToBin } from "@bitauth/libauth";
import { CONFIG } from "../src/config.ts";
import { loadEnv } from "./env.ts";
import { decodeCommitment, encodeCommitment, loadArtifact, p2pkhLock, retry, toVmCategory } from "./helpers.ts";

const FEE_RATE = 2;
const GAME_FILE = `public/game.${CONFIG.network}.json`;
const PROGRESS_FILE = ".wallet.smoke.json"; // gitignored by the .wallet.*.json rule
const game = JSON.parse(readFileSync(GAME_FILE, "utf8"));
const BASE = BigInt(game.params.basePrice);
const STEP = BigInt(game.params.priceStep);
const TIMEOUT: number = game.params.timeoutBlocks;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const firstLine = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0];

async function connect() {
  const env = await loadEnv();
  const { provider } = env;
  const pot = new Contract(loadArtifact("FungePot"), [toVmCategory(game.gameCategory)], { provider });
  const state = new Contract(
    loadArtifact("FungeState"),
    [hexToBin(pot.lockingBytecode), toVmCategory(game.pusdCategory), BASE, STEP, BigInt(TIMEOUT)],
    { provider },
  );
  assert.equal(state.tokenAddress, game.state.tokenAddress, "Rebuilt state address does not match the game file");
  assert.equal(pot.tokenAddress, game.pot.tokenAddress, "Rebuilt pot address does not match the game file");
  return { env, provider, pot, state };
}
type Ctx = Awaited<ReturnType<typeof connect>>;

async function readGame(ctx: Ctx) {
  const [s] = await retry(() => ctx.state.getUtxos());
  const [p] = await retry(() => ctx.pot.getUtxos());
  return { s, p };
}

const biggestBch = <T extends { satoshis: bigint; token?: unknown }>(utxos: T[]) =>
  utxos.filter((u) => !u.token).sort((a, b) => (a.satoshis < b.satoshis ? 1 : -1))[0];

// Only retry when the connection never opened (nothing was sent yet), so a retry cannot double-send
async function sendSafely(tx: TransactionBuilder) {
  for (let i = 0; i < 3; i++) {
    try {
      return await tx.send();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/Failed to establish connection/i.test(msg) && i < 2) {
        console.log("connection failed before sending, retrying...");
        await sleep(3000);
        continue;
      }
      throw e;
    }
  }
  throw new Error("unreachable");
}

async function status(ctx: Ctx) {
  const { s, p } = await readGame(ctx);
  const height = await retry(() => ctx.provider.getBlockHeight());
  if (!s || !p) {
    console.log("No state/pot UTXO visible: the game is settled, or the server has not caught up.");
    return;
  }
  const c = decodeCommitment(s.token!.nft!.commitment);
  console.log({
    passCount: c.passCount,
    holderPkh: c.holderPkh,
    pot: String(p.token!.amount),
    nextPrice: String(BASE + STEP * BigInt(c.passCount)),
    timeoutBlocks: TIMEOUT,
    chainHeight: height,
  });
  if (existsSync(PROGRESS_FILE)) {
    const { heightAtPass } = JSON.parse(readFileSync(PROGRESS_FILE, "utf8"));
    console.log(`last pass broadcast at height ${heightAtPass}; settle can open at about height ${heightAtPass + 1 + (TIMEOUT - 1)} at the earliest (later if the pass confirmed in a later block)`);
  }
}

async function pass(ctx: Ctx) {
  const { env, provider, state, pot } = ctx;
  const { s, p } = await readGame(ctx);
  assert.ok(s && p, "State or pot UTXO not found");
  const c = decodeCommitment(s.token!.nft!.commitment);
  const price = BASE + STEP * BigInt(c.passCount);

  const utxos = await retry(() => provider.getUtxos(env.address));
  const pusdUtxo = utxos.find(
    (u) => u.token && 
    u.token.category === game.pusdCategory && 
    !u.token.nft && 
    u.token.amount >= price,
  );
  const bchUtxo = biggestBch(utxos);
  assert.ok(pusdUtxo, `No PUSD UTXO with at least ${price} units`);
  assert.ok(bchUtxo, "No BCH-only UTXO");

  const tx = new TransactionBuilder({ provider })
    .addInput(s, state.unlock.pass(env.pkh))
    .addInput(p, pot.unlock.release())
    .addInput(pusdUtxo, env.tpl.unlockP2PKH())
    .addInput(bchUtxo, env.tpl.unlockP2PKH())
    .addOutput({
      to: state.tokenAddress,
      amount: s.satoshis,
      token: {
        amount: 0n,
        category: game.gameCategory,
        nft: { capability: "mutable", commitment: encodeCommitment(c.passCount + 1, env.pkhHex) },
      },
    })
    .addOutput({
      to: pot.tokenAddress,
      amount: p.satoshis,
      token: { amount: p.token!.amount + price, category: game.pusdCategory },
    })
    .addTokenChangeOutputIfNeeded({ category: game.pusdCategory, to: env.tokenAddress })
    .addBchChangeOutputIfNeeded({ to: env.lock, feeRate: FEE_RATE });

  const heightAtPass = await retry(() => provider.getBlockHeight());
  const sent = await sendSafely(tx);
  writeFileSync(PROGRESS_FILE, JSON.stringify({ heightAtPass }));
  console.log(`pass broadcast. txid: ${sent.txid} (price ${price}, new passCount ${c.passCount + 1})`);

  for (let i = 0; i < 10; i++) {
    const { s: ns } = await readGame(ctx);
    if (ns?.token?.nft && decodeCommitment(ns.token.nft.commitment).passCount === c.passCount + 1) {
      console.log("new state UTXO visible. Now try `settle` straight away: it should be rejected as too early.");
      return;
    }
    await sleep(3000);
  }
  console.log("New state not visible yet (server lag); run `status` in a minute.");
}

async function settle(ctx: Ctx) {
  const { env, provider, state, pot } = ctx;
  const { s, p } = await readGame(ctx);
  assert.ok(s && p, "State or pot UTXO not found (already settled?)");
  const commitment = s.token!.nft!.commitment;
  const holderLock = p2pkhLock(hexToBin(decodeCommitment(commitment).holderPkh));

  const utxos = await retry(() => provider.getUtxos(env.address));
  const bchUtxo = biggestBch(utxos);
  assert.ok(bchUtxo, "No BCH-only UTXO to pay the fee");

  const tx = new TransactionBuilder({ provider })
    .addInput(s, state.unlock.settle(), { sequence: TIMEOUT })
    .addInput(p, pot.unlock.release())
    .addInput(bchUtxo, env.tpl.unlockP2PKH())
    .addOutput({ to: holderLock, amount: 1_000n, token: { amount: p.token!.amount, category: game.pusdCategory } })
    .addOutput({
      to: holderLock,
      amount: 1_000n,
      token: { amount: 0n, category: game.gameCategory, nft: { capability: "none", commitment } },
    })
    .addBchChangeOutputIfNeeded({ to: env.lock, feeRate: FEE_RATE });

  try {
    const sent = await sendSafely(tx);
    console.log(`SETTLED. txid: ${sent.txid}`);
    console.log("The pot went to the holder and a trophy NFT was minted. Run token-balance.ts to see the PUSD return.");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/BIP68|non-BIP68-final/i.test(msg)) {
      console.log("REJECTED AS EXPECTED: the network enforces the timeout (too early).");
      console.log("node said:", firstLine(e));
    } else {
      console.log("Rejected for a different reason than the age rule:");
      console.log(msg.split("\n").slice(0, 6).join("\n"));
      process.exitCode = 1;
    }
  }
}

async function main() {
  const cmd = process.argv[2];
  const ctx = await connect();
  if (cmd === "status") await status(ctx);
  else if (cmd === "pass") await pass(ctx);
  else if (cmd === "settle") await settle(ctx);
  else console.log("Usage: npx tsx scripts/smoke.ts status | pass | settle");
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });