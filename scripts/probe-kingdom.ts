import assert from "node:assert/strict";
import { Contract, MockNetworkProvider, SignatureTemplate, TransactionBuilder, randomUtxo } from "cashscript";
import { binToHex } from "@bitauth/libauth";
import { loadArtifact, p2pkhLock, pkhOf, toVmCategory } from "./helpers.ts";

const seq = (start: number) => binToHex(Uint8Array.from({ length: 32 }, (_, i) => start + i));
const PUSD_ID = seq(1);
const GAME_ID = seq(33);
const keyBytes = (n: number) => Uint8Array.from({ length: 32 }, (_, i) => ((n + i) % 255) + 1);

function person(n: number) {
  const tpl = new SignatureTemplate(keyBytes(n));
  const pkh = pkhOf(tpl.publicKey);
  const lock = p2pkhLock(pkh);
  return { tpl, pkh, pkhHex: binToHex(pkh), lock, lockHex: binToHex(lock) };
}
const alice = person(1);
const bob = person(40);

// little-endian number as hex, the way the commitment stores it
const le = (n: number, bytes: number) => {
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) out[i] = Math.floor(n / 256 ** i) % 256;
  return binToHex(out);
};

function setup() {
  const provider = new MockNetworkProvider();
  const probe = new Contract(loadArtifact("ProbeKingdom"), [toVmCategory(PUSD_ID)], { provider });
  return { provider, probe };
}

async function expectFail(name: string, expected: string | null, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (expected !== null) assert.ok(msg.includes(expected), `${name}: rejected, but with the wrong error:\n${msg}`);
    console.log(`ok    ${name}${expected === null ? `  (rejected: ${msg.split("\n")[0]})` : ""}`);
    return;
  }
  assert.fail(`${name}: expected the transaction to be rejected, but it was accepted`);
}

async function main() {
  // --- fact 1: a BCH-only input ---
  {
    const { provider, probe } = setup();
    const probeCoin = provider.addUtxo(probe.lockingBytecode, randomUtxo({ satoshis: 10_000n }));
    const bchCoin = provider.addUtxo(alice.lockHex, randomUtxo({ satoshis: 20_000n })); // no tokens
    await new TransactionBuilder({ provider })
      .addInput(probeCoin, probe.unlock.bchOnlyInput())
      .addInput(bchCoin, alice.tpl.unlockP2PKH())
      .addOutput({ to: alice.lock, amount: 28_000n })
      .send();
    console.log("ok    fact 1: a BCH-only input shows an empty category, amount 0 and an empty commitment");
  }

  // --- fact 2: the rounding rule ---
  {
    const run = async (value: bigint) => {
      const { provider, probe } = setup();
      const probeCoin = provider.addUtxo(probe.lockingBytecode, randomUtxo({ satoshis: 10_000n }));
      const coin = provider.addUtxo(alice.lockHex, randomUtxo({ satoshis: 20_000n }));
      return new TransactionBuilder({ provider })
        .addInput(probeCoin, probe.unlock.mathRules(value))
        .addInput(coin, alice.tpl.unlockP2PKH())
        .addOutput({ to: alice.lock, amount: 28_000n })
        .send();
    };
    await run(1005n);
    console.log("ok    fact 2: value 1005 gives fee 20, king 924, pool 101 (the pool takes the odd unit)");
    await expectFail("fact 2: value 1000 is rejected by the same constants", "kingGets", () => run(1000n));
  }

  // --- fact 3: the 40-byte commitment ---
  {
    const holder = alice.pkhHex;
    const previous = "aa".repeat(11);
    const commitment = le(3, 4) + holder + le(1000, 4) + "02" + previous;
    assert.equal(commitment.length / 2, 40);
    const run = async (protectsOut: string) => {
      const { provider, probe } = setup();
      const probeCoin = provider.addUtxo(probe.lockingBytecode, randomUtxo({
        satoshis: 10_000n,
        token: { amount: 0n, category: GAME_ID, nft: { capability: "mutable" as const, commitment } },
      }));
      const coin = provider.addUtxo(alice.lockHex, randomUtxo({ satoshis: 20_000n }));
      const next = le(4, 4) + holder + le(1000, 4) + protectsOut + holder.slice(0, 22);
      return new TransactionBuilder({ provider })
        .addInput(probeCoin, probe.unlock.layout())
        .addInput(coin, alice.tpl.unlockP2PKH())
        .addOutput({
          to: probe.tokenAddress,
          amount: 9_000n,
          token: { amount: 0n, category: GAME_ID, nft: { capability: "mutable" as const, commitment: next } },
        })
        .addOutput({ to: alice.lock, amount: 19_000n })
        .send();
    };
    await run("00");
    console.log("ok    fact 3: a 40-byte commitment is sliced and rebuilt, and the SDK accepts it");
    await expectFail("fact 3: a commitment that kept the old protect counter is rejected", "rebuilt commitment", () => run("02"));
  }

  // --- fact 4: what counts as a PUSD payout ---
  {
    const run = async (opts: { amount: bigint; nft?: "none" | "mutable" }) => {
      const { provider, probe } = setup();
      const probeCoin = provider.addUtxo(probe.lockingBytecode, randomUtxo({ satoshis: 10_000n }));
      const nftPart = opts.nft ? { nft: { capability: opts.nft, commitment: "" } } : {};
      const coin = provider.addUtxo(alice.lockHex, randomUtxo({
        satoshis: 20_000n,
        token: { amount: 1_000n, category: PUSD_ID, ...nftPart },
      }));
      return new TransactionBuilder({ provider })
        .addInput(probeCoin, probe.unlock.payoutShape())
        .addInput(coin, alice.tpl.unlockP2PKH())
        .addOutput({ to: alice.lock, amount: 26_000n })
        .addOutput({ to: alice.lock, amount: 1_000n, token: { amount: 1_000n - opts.amount, category: PUSD_ID } })
        .addOutput({ to: bob.lock, amount: 1_000n, token: { amount: opts.amount, category: PUSD_ID, ...nftPart } })
        .send();
    };
    await run({ amount: 920n });
    console.log("ok    fact 4: a PUSD payout of 920 is accepted");
    await expectFail("fact 4: a payout of 919 is rejected", "payout amount", () => run({ amount: 919n }));
    await run({ amount: 920n, nft: "none" });
    console.log("ok    fact 4: an immutable NFT riding along is NOT detected (accepted; harmless, the sender gives it away)");
    await expectFail("fact 4: a mutable NFT riding along is rejected", "payout must be plain PUSD", () => run({ amount: 920n, nft: "mutable" }));
  }

  
  // --- fact 5: input 2 at the holder's address ---
  {
    const run = async (opts: { input2Owner: typeof alice; signer: typeof alice }) => {
      const { provider, probe } = setup();
      const probeCoin = provider.addUtxo(probe.lockingBytecode, randomUtxo({ satoshis: 10_000n }));
      const filler = provider.addUtxo(bob.lockHex, randomUtxo({ satoshis: 20_000n }));
      const third = provider.addUtxo(opts.input2Owner.lockHex, randomUtxo({ satoshis: 20_000n }));
      return new TransactionBuilder({ provider })
        .addInput(probeCoin, probe.unlock.holderInput(alice.pkh))
        .addInput(filler, bob.tpl.unlockP2PKH())
        .addInput(third, opts.signer.tpl.unlockP2PKH())
        .addOutput({ to: bob.lock, amount: 48_000n })
        .send();
    };
    await run({ input2Owner: alice, signer: alice });
    console.log("ok    fact 5: a signed coin at the holder's address is accepted as proof");
    await expectFail("fact 5: a coin at someone else's address is rejected", "input 2 must be the holder's",
      () => run({ input2Owner: bob, signer: bob }));
    await expectFail("fact 5: the holder's coin signed with another key is rejected", null,
      () => run({ input2Owner: alice, signer: bob }));
  }

  console.log("\nAll probe checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});