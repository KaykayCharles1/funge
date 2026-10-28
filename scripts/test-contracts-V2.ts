import assert from "node:assert/strict";
import {
  Contract, MockNetworkProvider, SignatureTemplate, TransactionBuilder, randomUtxo,
} from "cashscript";
import { binToHex, hexToBin } from "@bitauth/libauth";
import { CONFIG } from "../src/config.ts";
import {
  decodeCommitment, encodeCommitment, loadArtifact, p2pkhLock, pkhOf, toVmCategory,
} from "./helpers.ts";

const seq = (start: number) => binToHex(Uint8Array.from({ length: 32 }, (_, i) => start + i));
const PUSD_ID = seq(1);
const GAME_ID = seq(33);
const BASE_PRICE = 100n;
const PRICE_STEP = 10n;
const FALLBACK = CONFIG.fallbackBlocks;
const WAITING_FALLBACK = CONFIG.waitingFallbackBlocks;

const keyBytes = (n: number) => Uint8Array.from({ length: 32 }, (_, i) => ((n + i) % 255) + 1);
const referee = new SignatureTemplate(keyBytes(200));
const impostor = new SignatureTemplate(keyBytes(120));
type RefereeArg = "valid" | "wrong" | "missing";
const refereeArg = (kind: RefereeArg) =>
  kind === "valid" ? referee : kind === "wrong" ? impostor : new Uint8Array(0);

function person(n: number) {
  const tpl = new SignatureTemplate(keyBytes(n));
  const pkh = pkhOf(tpl.publicKey);
  const lock = p2pkhLock(pkh);
  return { tpl, pkh, pkhHex: binToHex(pkh), lock, lockHex: binToHex(lock) };
}
type Person = ReturnType<typeof person>;
const alice = person(1);
const bob = person(40);
const carol = person(90);

function setup(opts: { passCount?: number; holder?: Person; potAmount?: bigint } = {}) {
  const provider = new MockNetworkProvider();
  const pot = new Contract(loadArtifact("FungePot"), [toVmCategory(GAME_ID)], { provider });
  const state = new Contract(
    loadArtifact("FungeStateV2"),
    [
      hexToBin(pot.lockingBytecode),
      toVmCategory(PUSD_ID),
      BASE_PRICE,
      PRICE_STEP,
      referee.publicKey,
      BigInt(FALLBACK),
      BigInt(WAITING_FALLBACK),
    ],
    { provider },
  );
  const passCount = opts.passCount ?? 0;
  const holder = opts.holder ?? alice;
  const potAmount = opts.potAmount ?? 500n;
  const stateUtxo = provider.addUtxo(state.lockingBytecode, randomUtxo({
    satoshis: 10_000n,
    token: {
      amount: 0n,
      category: GAME_ID,
      nft: { capability: "mutable" as const, commitment: encodeCommitment(passCount, holder.pkhHex) },
    },
  }));
  const potUtxo = provider.addUtxo(pot.lockingBytecode, randomUtxo({
    satoshis: 10_000n,
    token: { amount: potAmount, category: PUSD_ID },
  }));
  return { provider, pot, state, stateUtxo, potUtxo, passCount, potAmount };
}
type Game = ReturnType<typeof setup>;

async function refresh(g: Game, passCount: number): Promise<Game> {
  const [stateUtxo] = await g.state.getUtxos();
  const [potUtxo] = await g.pot.getUtxos();
  return { ...g, stateUtxo, potUtxo, passCount, potAmount: potUtxo.token!.amount };
}

function fund(g: Game, who: Person, pusd: bigint) {
  return g.provider.addUtxo(who.lockHex, randomUtxo({
    satoshis: 100_000n,
    token: { amount: pusd, category: PUSD_ID },
  }));
}

function passTx(
  g: Game,
  who: Person,
  tweak: { newCount?: number; potAdd?: bigint; potToPlayer?: boolean; newHolder?: Person; referee?: RefereeArg } = {},
) {
  const price = BASE_PRICE + PRICE_STEP * BigInt(g.passCount);
  const holder = tweak.newHolder ?? who;
  const potAdd = tweak.potAdd ?? price;
  const playerUtxo = fund(g, who, 1_000n);
  return new TransactionBuilder({ provider: g.provider })
    .addInput(g.stateUtxo, g.state.unlock.pass(holder.pkh, refereeArg(tweak.referee ?? "valid")))
    .addInput(g.potUtxo, g.pot.unlock.release())
    .addInput(playerUtxo, who.tpl.unlockP2PKH())
    .addOutput({
      to: g.state.tokenAddress,
      amount: g.stateUtxo.satoshis,
      token: {
        amount: 0n,
        category: GAME_ID,
        nft: {
          capability: "mutable",
          commitment: encodeCommitment(tweak.newCount ?? g.passCount + 1, holder.pkhHex),
        },
      },
    })
    .addOutput({
      to: tweak.potToPlayer ? who.lock : g.pot.tokenAddress,
      amount: g.potUtxo.satoshis,
      token: { amount: g.potAmount + potAdd, category: PUSD_ID },
    })
    .addOutput({
      to: who.lock,
      amount: playerUtxo.satoshis - 2_000n,
      token: { amount: 1_000n - potAdd, category: PUSD_ID },
    });
}

// Shared by settle() and settleFallback(): the same payout rules
function payoutTx(
  g: Game,
  bystander: Person,
  unlocker: ReturnType<Game["state"]["unlock"]["settle"]>,
  sequence: number | undefined,
  tweak: { payout?: bigint; trophyCap?: "none" | "mutable" } = {},
) {
  const commitment = g.stateUtxo.token!.nft!.commitment;
  const holderLock = p2pkhLock(hexToBin(decodeCommitment(commitment).holderPkh));
  const fee = 2_000n;
  const change = g.stateUtxo.satoshis + g.potUtxo.satoshis - 2_000n - fee;
  return new TransactionBuilder({ provider: g.provider, allowImplicitFungibleTokenBurn: true })
    .addInput(g.stateUtxo, unlocker, sequence === undefined ? undefined : { sequence })
    .addInput(g.potUtxo, g.pot.unlock.release())
    .addOutput({
      to: holderLock,
      amount: 1_000n,
      token: { amount: tweak.payout ?? g.potAmount, category: PUSD_ID },
    })
    .addOutput({
      to: holderLock,
      amount: 1_000n,
      token: {
        amount: 0n,
        category: GAME_ID,
        nft: { capability: tweak.trophyCap ?? "none", commitment },
      },
    })
    .addOutput({ to: bystander.lock, amount: change });
}

const settleTx = (
  g: Game,
  bystander: Person,
  tweak: { payout?: bigint; trophyCap?: "none" | "mutable"; referee?: RefereeArg } = {},
) => payoutTx(g, bystander, g.state.unlock.settle(refereeArg(tweak.referee ?? "valid")), undefined, tweak);

const fallbackTx = (
  g: Game,
  bystander: Person,
  sequence: number,
  tweak: { payout?: bigint } = {},
) => payoutTx(g, bystander, g.state.unlock.settleFallback(), sequence, tweak);

async function expectFail(name: string, expected: string | null, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (expected !== null) {
      assert.ok(msg.includes(expected), `${name}: rejected, but with the wrong error:\n${msg}`);
      console.log(`ok    ${name}`);
    } else {
      console.log(`ok    ${name}  (rejected: ${msg.split("\n")[0]})`);
    }
    return;
  }
  assert.fail(`${name}: expected the transaction to be rejected, but it was accepted`);
}

async function assertPaid(g: Game, who: Person, pot: bigint, passes: number) {
  const utxos = await g.provider.getUtxosForLockingBytecode(who.lock);
  const pusd = utxos
    .filter((u) => u.token && !u.token.nft && u.token.category === PUSD_ID)
    .map((u) => u.token!.amount);
  assert.ok(pusd.includes(pot), `expected a payout of ${pot}, found ${pusd}`);
  const trophy = utxos.find((u) => u.token?.nft?.capability === "none");
  assert.ok(trophy, "the trophy NFT is missing");
  assert.equal(decodeCommitment(trophy.token!.nft!.commitment).passCount, passes);
  assert.equal((await g.state.getUtxos()).length, 0);
  assert.equal((await g.pot.getUtxos()).length, 0);
}

async function main() {
  // --- two passes in a row, each co-signed by the referee ---
  let g = setup();
  await passTx(g, alice).send();
  g = await refresh(g, 1);
  assert.deepEqual(decodeCommitment(g.stateUtxo.token!.nft!.commitment), { passCount: 1, holderPkh: alice.pkhHex });
  assert.equal(g.potAmount, 600n);
  console.log("ok    pass #1 with the referee signature");
  await passTx(g, bob).send();
  g = await refresh(g, 2);
  assert.deepEqual(decodeCommitment(g.stateUtxo.token!.nft!.commitment), { passCount: 2, holderPkh: bob.pkhHex });
  assert.equal(g.potAmount, 710n);
  console.log("ok    pass #2 with the referee signature");

  // --- money rules unchanged (with a valid referee signature) ---
  await expectFail("pass: price too low", "Price not paid",
    async () => passTx(setup(), alice, { potAdd: BASE_PRICE - 1n }).send());
  await expectFail("pass: wrong new commitment", "Bad new commitment",
    async () => passTx(setup(), alice, { newCount: 5 }).send());
  await expectFail("pass: pot output sent elsewhere", "Output 1 must be the pot",
    async () => passTx(setup(), alice, { potToPlayer: true }).send());

  // --- referee signature required for pass ---
  await expectFail("pass: referee signature missing", "Referee signature missing or wrong",
    async () => passTx(setup(), alice, { referee: "missing" }).send());
  await expectFail("pass: signed by the wrong key", null,
    async () => passTx(setup(), alice, { referee: "wrong" }).send());

  // --- the pot cannot be spent without the state NFT ---
  {
    const s = setup();
    const playerUtxo = fund(s, alice, 0n);
    await expectFail("pot: spend without the state NFT", "Input 0 must be the game state NFT", async () =>
      new TransactionBuilder({ provider: s.provider })
        .addInput(playerUtxo, alice.tpl.unlockP2PKH())
        .addInput(s.potUtxo, s.pot.unlock.release())
        .addOutput({
          to: alice.lock,
          amount: playerUtxo.satoshis + s.potUtxo.satoshis - 2_000n,
          token: { amount: s.potAmount, category: PUSD_ID },
        })
        .send());
  }

  // --- settle: referee required, money rules unchanged ---
  await expectFail("settle: referee signature missing", "Referee signature missing or wrong",
    async () => settleTx(g, carol, { referee: "missing" }).send());
  await expectFail("settle: signed by the wrong key", null,
    async () => settleTx(g, carol, { referee: "wrong" }).send());
  await expectFail("settle: pot not fully paid", "Whole pot must be paid",
    async () => settleTx(g, carol, { payout: g.potAmount - 1n }).send());
  await expectFail("settle: trophy must be immutable", "Trophy must be immutable",
    async () => settleTx(g, carol, { trophyCap: "mutable" }).send());

  // --- settle with the referee signature: no timing check in the contract ---
  await settleTx(g, carol).send();
  await assertPaid(g, bob, 710n, 2);
  console.log("ok    settle with the referee signature: bob got the 710 pot and a trophy (2 passes)");

  // --- cancel a waiting round: settle at pass count 0 returns the seed to the creator ---
  {
    const w = setup(); // pass count 0, holder = alice (the creator), seed 500
    await settleTx(w, carol).send();
    await assertPaid(w, alice, 500n, 0);
    console.log("ok    cancel: settle at pass count 0 returned the 500 seed to the creator (trophy shows 0 passes)");
  }

  // --- fallback: anyone, no referee, after enough blocks ---
  {
    const live = setup({ passCount: 2, holder: bob, potAmount: 710n });
    await expectFail(`fallback: too early on a live round (${FALLBACK - 1} blocks)`, null,
      async () => fallbackTx(live, carol, FALLBACK - 1).send());
    await expectFail("fallback: pot not fully paid", "Whole pot must be paid",
      async () => fallbackTx(live, carol, FALLBACK, { payout: 709n }).send());
    await fallbackTx(live, carol, FALLBACK).send();
    await assertPaid(live, bob, 710n, 2);
    console.log(`ok    fallback: after ${FALLBACK} blocks anyone settled a live round, bob was paid`);
  }
  {
    const waiting = setup(); // pass count 0
    await expectFail(`fallback: a waiting round needs ${WAITING_FALLBACK} blocks, not ${FALLBACK}`, null,
      async () => fallbackTx(waiting, carol, FALLBACK).send());
    await expectFail(`fallback: too early on a waiting round (${WAITING_FALLBACK - 1} blocks)`, null,
      async () => fallbackTx(waiting, carol, WAITING_FALLBACK - 1).send());
    await fallbackTx(waiting, carol, WAITING_FALLBACK).send();
    await assertPaid(waiting, alice, 500n, 0);
    console.log(`ok    fallback: after ${WAITING_FALLBACK} blocks a waiting round returned the seed to the creator`);
  }

  console.log("\nAll V2 contract tests passed.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });