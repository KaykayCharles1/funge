# Funge build journey

## Step 1: scaffold 
- Vite + vanilla TS. Pinned cashscript 0.14.0, cashc 0.14.0, mainnet-js 3.1.7.
- Chose mainnet-js 3.1.7 (stable) over 4.0.0-next.13, which is npm's "latest" tag but a prerelease.
- Fixed editor errors: added @types/node, and added "scripts" to tsconfig include.
- Chipnet wallet script works; funded from a faucet.

## Step 2a: contracts 
- Checked CashScript docs: `this.age` (not tx.age) reads the input's own nSequence.
- tokenCategory introspection includes the capability byte (0x01 mutable).
- Category byte order is reversed vs explorers; swapEndianness on the TS side.
- bytes4(int) is rejected in 0.14; using toPaddedBytes(value, 4).

## Step 2b: contract tests 
- Wrote scripts/test-contracts.ts using MockNetworkProvider: two consecutive passes, price/commitment/pot-address failures, pot-spend-without-NFT, settle failures, and a full settle.
- Local evaluation rejects a settle whose input sequence is below timeoutBlocks (this.age check). The "UTXO must be old enough" rule is enforced by the network (BIP68), so it will be proven on chipnet in Step 3.
- Test bug found and fixed: bob's PUSD change output was mistaken for the payout; the check now sums his PUSD outputs.


## Step 3a: chipnet test PUSD token 
- A token category is the txid of a genesis input at output index 0, so the script makes a spare vout-0 output first, then spends it to create the fungible category.
- Test PUSD category on chipnet: 8af14ba0...49eb (1,000,000 units).
- First run failed with a WebSocket 1006 error (transient Electrum connection drop); a plain retry worked.