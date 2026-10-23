import { lockingBytecodeToCashAddress, swapEndianness } from "@bitauth/libauth";
import { CONFIG } from "../config.ts";

export const p2pkhLock = (pkh: Uint8Array) => Uint8Array.from([0x76, 0xa9, 0x14, ...pkh, 0x88, 0xac]);

// Contracts see token categories in the opposite byte order from wallets/explorers
export const toVmCategory = (standardHex: string) => swapEndianness(standardHex);

export function lockToAddress(bytecode: Uint8Array, tokenSupport: boolean): string {
  const prefix = CONFIG.network === "mainnet" ? "bitcoincash" : "bchtest";
  const result: unknown = lockingBytecodeToCashAddress({ bytecode, prefix, tokenSupport });
  const address = typeof result === "string" ? result : (result as { address?: unknown } | null)?.address;
  if (typeof address !== "string" || !address.startsWith(`${prefix}:`)) {
    throw new Error(
      `Could not encode address: ${JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`,
    );
  }
  return address;
}