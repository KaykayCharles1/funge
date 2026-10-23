import { binToHex } from "@bitauth/libauth";

// WizardConnect sends messages with plain JSON.stringify, so byte arrays and bigints
// must be converted first: bytes become hex strings, bigints become "<bigint: 123n>"
export function toRelaySafe(value: unknown): unknown {
  if (value instanceof Uint8Array) return binToHex(value);
  if (typeof value === "bigint") return `<bigint: ${value}n>`;
  if (Array.isArray(value)) return value.map(toRelaySafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toRelaySafe(v)]));
  }
  return value;
}