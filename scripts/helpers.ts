import { readFileSync } from "node:fs";
import { binToHex, hexToBin, swapEndianness, hash160 } from "@bitauth/libauth";

// Compiled artifact (any-typed so Contract accepts it without extra config)
export const loadArtifact = (name: string) =>
  JSON.parse(readFileSync(new URL(`../contracts/${name}.json`, import.meta.url), "utf8"));

// Contracts see categories in the opposite byte order from wallets/explorers
export const toVmCategory = (standardHex: string) => swapEndianness(standardHex);

export const p2pkhLock = (pkh: Uint8Array) =>
  Uint8Array.from([0x76, 0xa9, 0x14, ...pkh, 0x88, 0xac]);

export const pkhOf = (publicKey: Uint8Array) => hash160(publicKey);

// Commitment = passCount (4 bytes, little-endian script number) + holderPkh (20 bytes)
export function encodeCommitment(passCount: number, holderPkhHex: string): string {
  const count = new Uint8Array(4);
  new DataView(count.buffer).setUint32(0, passCount, true);
  return binToHex(count) + holderPkhHex;
}

export function decodeCommitment(commitmentHex: string) {
  const bytes = hexToBin(commitmentHex);
  const raw = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true);
  return { passCount: raw & 0x7fffffff, holderPkh: binToHex(bytes.slice(4, 24)) };
}