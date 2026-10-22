import { binToHex, hexToBin } from "@bitauth/libauth";

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