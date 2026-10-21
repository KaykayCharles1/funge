# Funge build journey

## Step 1: scaffold (Oct 21, 2026)
- Vite + vanilla TS. Pinned cashscript 0.14.0, cashc 0.14.0, mainnet-js 3.1.7.
- Chose mainnet-js 3.1.7 (stable) over 4.0.0-next.13, which is npm's "latest" tag but a prerelease.
- Fixed editor errors: added @types/node, and added "scripts" to tsconfig include.
- Chipnet wallet script works; funded from a faucet.

## Step 2a: contracts (Oct 21, 2026)
- Checked CashScript docs: `this.age` (not tx.age) reads the input's own nSequence.
- tokenCategory introspection includes the capability byte (0x01 mutable).
- Category byte order is reversed vs explorers; swapEndianness on the TS side.
- bytes4(int) is rejected in 0.14; using toPaddedBytes(value, 4).