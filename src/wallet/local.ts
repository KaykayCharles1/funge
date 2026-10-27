import {
  deriveHdPath,
  deriveHdPrivateNodeFromBip39Mnemonic,
  generateBip39Mnemonic,
  hash160,
  binToHex,
  decodeBip39Mnemonic,
} from "@bitauth/libauth";
import { SignatureTemplate } from "cashscript";
import type { ElectrumNetworkProvider } from "cashscript";
import { pusdCategory } from "../config.ts";
import { lockToAddress, p2pkhLock } from "../lib/chain.ts";
import { retry } from "../lib/retry.ts";

// The path most BCH wallets use for their first receiving address (BIP44, coin type 145)
const FIRST_ADDRESS_PATH = "m/44'/145'/0'/0/0";
export const normalizeMnemonic = (mnemonic: string) => mnemonic.trim().toLowerCase().split(/\s+/).join(" ");

// Checks the words and the built-in checksum, which catches typos in an imported phrase
export function isValidMnemonic(mnemonic: string): boolean {
  return typeof decodeBip39Mnemonic(normalizeMnemonic(mnemonic)) !== "string";
}

export type Balances = {
  sats: bigint; // all BCH on this address, including the small amounts attached to token coins
  pusd: bigint; // units of the PUSD token, by the category in config.ts
  nfts: number; // number of NFT coins on this address, e.g. a trophy
};

export type LocalWallet = {
  readonly address: string;
  readonly tokenAddress: string;
  readonly pkhHex: string;
  readonly lock: Uint8Array;
  // The key never leaves this module: callers get a signing capability, not the key
  unlockP2PKH: () => ReturnType<SignatureTemplate["unlockP2PKH"]>;
  getBalances: (provider: ElectrumNetworkProvider) => Promise<Balances>;
};

export function newMnemonic(): string {
  return generateBip39Mnemonic();
}

export function walletFromMnemonic(mnemonic: string): LocalWallet {
  const phrase = normalizeMnemonic(mnemonic);
  const root = deriveHdPrivateNodeFromBip39Mnemonic(phrase);
  if (typeof root === "string") throw new Error("Could not derive a key from this seed phrase.");
  const node = deriveHdPath(root, FIRST_ADDRESS_PATH);
  if (typeof node === "string") throw new Error("Could not derive the wallet address.");

  const template = new SignatureTemplate(node.privateKey);
  const pkh = hash160(template.publicKey);
  const lock = p2pkhLock(pkh);

  return {
    address: lockToAddress(lock, false),
    tokenAddress: lockToAddress(lock, true),
    pkhHex: binToHex(pkh),
    lock,
    unlockP2PKH: () => template.unlockP2PKH(),
    async getBalances(provider) {
      const utxos = await retry(() => provider.getUtxosForLockingBytecode(lock));
      const category = pusdCategory();
      let sats = 0n;
      let pusd = 0n;
      let nfts = 0;
      for (const u of utxos) {
        sats += u.satoshis;
        if (u.token && u.token.category === category && !u.token.nft) pusd += u.token.amount;
        if (u.token?.nft) nfts += 1;
      }
      return { sats, pusd, nfts };
    },
  };
}