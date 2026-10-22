import { readFileSync } from "node:fs";
import { swapEndianness, hash160 } from "@bitauth/libauth";
export { encodeCommitment, decodeCommitment } from "../src/lib/commitment.ts";

// Compiled artifact (any-typed so Contract accepts it without extra config)
export const loadArtifact = (name: string) =>
  JSON.parse(readFileSync(new URL(`../contracts/${name}.json`, import.meta.url), "utf8"));

// Contracts see categories in the opposite byte order from wallets/explorers
export const toVmCategory = (standardHex: string) => swapEndianness(standardHex);

export const p2pkhLock = (pkh: Uint8Array) =>
  Uint8Array.from([0x76, 0xa9, 0x14, ...pkh, 0x88, 0xac]);

export const pkhOf = (publicKey: Uint8Array) => hash160(publicKey);


// Retry flaky network reads (Electrum connections sometimes drop on first attempt)
export async function retry<T>(fn: () => Promise<T>, tries = 3, delayMs = 2000): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw last;
}