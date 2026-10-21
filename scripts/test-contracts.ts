import assert from "node:assert/strict";
import {
  Contract, MockNetworkProvider, SignatureTemplate, TransactionBuilder, randomUtxo,
} from "cashscript";
import { binToHex, hexToBin } from "@bitauth/libauth";
import {
  decodeCommitment, encodeCommitment, loadArtifact, p2pkhLock, pkhOf, toVmCategory,
} from "./helpers.ts";

// Non-palindromic IDs so a byte-order mistake can't hide
const seq = (start: number) => binToHex(Uint8Array.from({ length: 32 }, (_, i) => start + i));
const PUSD_ID = seq(1);
const GAME_ID = seq(33);
const BASE_PRICE = 100n;
const PRICE_STEP = 10n;
const TIMEOUT = 3;

function person(n: number) {
  const key = Uint8Array.from({ length: 32 }, (_, i) => ((n + i) % 255) + 1);
  const tpl = new SignatureTemplate(key);
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
    loadArtifact("FungeState"),
    [hexToBin(pot.lockingBytecode), toVmCategory(PUSD_ID), BASE_PRICE, PRICE_STEP, BigInt(TIMEOUT)],
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
  tweak: { newCount?: number; potAdd?: bigint; potToPlayer?: boolean; newHolder?: Person } = {},
) {
  const price = BASE_PRICE + PRICE_STEP * BigInt(g.passCount);
  const holder = tweak.newHolder ?? who;
  const potAdd = tweak.potAdd ?? price;
  const playerUtxo = fund(g, who, 1_000n);
  return new TransactionBuilder({ provider: g.provider })
    .addInput(g.stateUtxo, g.state.unlock.pass(holder.pkh))
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

function settleTx(
  g: Game,
  bystander: Person,
  tweak: { sequence?: number; payout?: bigint; trophyCap?: "none" | "mutable" } = {},
) {
  const commitment = g.stateUtxo.token!.nft!.commitment;
  const holderLock = p2pkhLock(hexToBin(decodeCommitment(commitment).holderPkh));
  const fee = 2_000n;
  const change = g.stateUtxo.satoshis + g.potUtxo.satoshis - 2_000n - fee;
  return new TransactionBuilder({ provider: g.provider, allowImplicitFungibleTokenBurn: true })
    .addInput(g.stateUtxo, g.state.unlock.settle(), { sequence: tweak.sequence ?? TIMEOUT })
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

async function expectFail(name: string, expected: string, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    assert.ok(msg.includes(expected), `${name}: rejected, but with the wrong error:\n${msg}`);
    console.log(`ok    ${name}`);
    return;
  }
  assert.fail(`${name}: expected the transaction to be rejected, but it was accepted`);
}

async function main() {
  // 1 + 2: two passes in a row (catches commitment/price encoding mistakes)
  let g = setup();
  await passTx(g, alice).send();
  g = await refresh(g, 1);
  assert.deepEqual(decodeCommitment(g.stateUtxo.token!.nft!.commitment), { passCount: 1, holderPkh: alice.pkhHex });
  assert.equal(g.potAmount, 600n);
  console.log("ok    pass #1 (price 100): count 1, holder alice, pot 600");

  await passTx(g, bob).send();
  g = await refresh(g, 2);
  assert.deepEqual(decodeCommitment(g.stateUtxo.token!.nft!.commitment), { passCount: 2, holderPkh: bob.pkhHex });
  assert.equal(g.potAmount, 710n);
  console.log("ok    pass #2 (price 110): count 2, holder bob, pot 710");

  // Failure cases for pass()
  await expectFail("pass: price too low", "Price not paid",
    async () => passTx(setup(), alice, { potAdd: BASE_PRICE - 1n }).send());
  await expectFail("pass: wrong new commitment", "Bad new commitment",
    async () => passTx(setup(), alice, { newCount: 5 }).send());
  await expectFail("pass: pot output sent elsewhere", "Output 1 must be the pot",
    async () => passTx(setup(), alice, { potToPlayer: true }).send());

  // The pot cannot be spent without the state NFT in input 0
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

  // settle(): bob holds after pass #2; carol is a bystander who pays the fee
  await expectFail("settle: pot not fully paid", "Whole pot must be paid",
    async () => settleTx(g, carol, { payout: g.potAmount - 1n }).send());
  await expectFail("settle: trophy must be immutable", "Trophy must be immutable",
    async () => settleTx(g, carol, { trophyCap: "mutable" }).send());

  // Informational: the mock may not enforce the sequence check
  try {
    await settleTx(g, carol, { sequence: TIMEOUT - 1 }).debug();
    console.log("info  settle with sequence below timeout: NOT blocked by local evaluation");
  } catch (e) {
    console.log("info  settle with sequence below timeout: blocked ->", (e instanceof Error ? e.message : String(e)).split("\n")[0]);
  }

  await settleTx(g, carol).send();
  assert.equal((await g.state.getUtxos()).length, 0);
  assert.equal((await g.pot.getUtxos()).length, 0);
  const bobUtxos = await g.provider.getUtxosForLockingBytecode(bob.lock);
    const pusd = bobUtxos
    .filter((u) => u.token && !u.token.nft && u.token.category === PUSD_ID)
    .map((u) => u.token!.amount);
  const trophy = bobUtxos.find((u) => u.token?.nft?.capability === "none");
  assert.ok(pusd.includes(710n), `bob should hold a 710 payout, has: ${pusd}`);
  assert.equal(pusd.reduce((a, b) => a + b, 0n), 1_600n); // 890 change + 710 pot
  assert.ok(trophy, "bob should hold the trophy NFT");
  console.log("ok    settle: bob got the 710 pot and an immutable trophy");

  console.log("\nAll contract tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});