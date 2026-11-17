import { binToHex, decodeTransaction, hash160, hexToBin } from "@bitauth/libauth";
import { TransactionBuilder, type NetworkProvider, type SpendableUtxo, type Unlocker } from "cashscript";
import { FAUCET } from "../src/refereeParams.ts";
import type { LockRunner } from "./lock.ts";

// The chipnet test faucet: one wallet with one fixed address pays each new player some test PUSD and BCH.
// The limits come from the chain itself (the faucet's own payouts in the last FAUCET.dayBlocks blocks), so a
// restart of the referee does not reset them. Only the per-visitor limit lives in memory.

export class FaucetError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export type FaucetWallet = {
  lock: Uint8Array; // P2PKH locking bytecode of the faucet's one address
  pkhHex: string;
  unlockP2PKH: () => Unlocker;
};

export type FaucetLimits = typeof FAUCET;

export type FaucetDeps = {
  provider: NetworkProvider;
  // The faucet address's transactions, newest last; height 0 or below = not yet in a block
  history: () => Promise<{ txid: string; height: number }[]>;
  wallet: FaucetWallet;
  pusdCategory: string;
  addressOf: (lock: Uint8Array, tokens: boolean) => string;
  locks: LockRunner;
  now: () => number;
  limits?: FaucetLimits; // tests use smaller ones
};

export type FaucetStatus = {
  address: string; // token-aware: send BCH and PUSD here
  sats: string;
  pusd: string;
  perClaim: { sats: string; pusd: string };
  claimsToday: number;
  perDay: number;
  claimsLeft: number; // what today's limit and the balance still allow
};

const DAY_MS = 24 * 60 * 60 * 1000;
const FEE_RATE = 1.2; // sats per byte; chipnet relays at 1
const HISTORY_TTL_MS = 20_000; // the status page reuses a recent read; a claim always reads again
const SPENT_TTL_MS = 10 * 60 * 1000; // coins just spent stay hidden this long, in case an indexer is slow

export function makeFaucet(deps: FaucetDeps) {
  const limits = deps.limits ?? FAUCET;
  const { provider, wallet, pusdCategory } = deps;
  const ourLockHex = binToHex(wallet.lock);
  const address = deps.addressOf(wallet.lock, false);
  const tokenAddress = deps.addressOf(wallet.lock, true);

  const rawCache = new Map<string, string>(); // txid -> raw transaction (transactions never change)
  const sent: { txid: string; recipient: string; at: number }[] = []; // payouts the chain may not show yet
  const spent = new Map<string, number>(); // "txid:vout" -> when this faucet spent it
  const byIp = new Map<string, number[]>(); // visitor -> times of their claims
  let cached: { at: number; recipients: string[] } | null = null;

  // A P2PKH input signed by the faucet ends with a push of its 33-byte public key
  const signedByUs = (unlocking: Uint8Array) => {
    if (unlocking.length < 34 || unlocking[unlocking.length - 34] !== 33) return false;
    return binToHex(hash160(unlocking.slice(-33))) === wallet.pkhHex;
  };

  // The locking bytecode of everyone the faucet paid "today", one entry per payout
  async function recentRecipients(fresh: boolean): Promise<string[]> {
    if (!fresh && cached && deps.now() - cached.at < HISTORY_TTL_MS) return cached.recipients;
    const [tip, history] = await Promise.all([provider.getBlockHeight(), deps.history()]);
    const recent = history.filter((h) => h.height <= 0 || h.height > tip - limits.dayBlocks);
    const recipients: string[] = [];
    for (const { txid } of recent) {
      let raw = rawCache.get(txid);
      if (!raw) rawCache.set(txid, (raw = await provider.getRawTransaction(txid)));
      const tx = decodeTransaction(hexToBin(raw));
      if (typeof tx === "string") continue;
      if (!tx.inputs.some((i) => signedByUs(i.unlockingBytecode))) continue; // a top-up, not a payout
      for (const out of tx.outputs) {
        const lockHex = binToHex(out.lockingBytecode);
        if (lockHex === ourLockHex || !out.token || out.token.nft) continue;
        if (binToHex(out.token.category) === pusdCategory) recipients.push(lockHex);
      }
    }
    // Payouts sent in the last day that the history does not list yet
    const listed = new Set(recent.map((h) => h.txid));
    for (const s of sent) if (!listed.has(s.txid) && deps.now() - s.at < DAY_MS) recipients.push(s.recipient);
    cached = { at: deps.now(), recipients };
    return recipients;
  }

  async function coins(): Promise<SpendableUtxo[]> {
    const now = deps.now();
    for (const [k, at] of spent) if (now - at > SPENT_TTL_MS) spent.delete(k);
    const utxos = await provider.getUtxos(address);
    return utxos.filter((u) => !spent.has(`${u.txid}:${u.vout}`));
  }

  const largestFirst = (a: SpendableUtxo, b: SpendableUtxo) => (a.satoshis < b.satoshis ? 1 : a.satoshis > b.satoshis ? -1 : 0);
  const pusdOf = (u: SpendableUtxo) => (u.token && u.token.category === pusdCategory && !u.token.nft ? u.token.amount : 0n);

  async function status(): Promise<FaucetStatus> {
    const [utxos, recipients] = await Promise.all([coins(), recentRecipients(false)]);
    const sats = utxos.reduce((sum, u) => sum + u.satoshis, 0n);
    const pusd = utxos.reduce((sum, u) => sum + pusdOf(u), 0n);
    const left = Math.min(
      Math.max(0, limits.perDay - recipients.length),
      Number(sats / (limits.sats + 1_000n)),
      Number(pusd / limits.pusdUnits),
    );
    return {
      address: tokenAddress,
      sats: sats.toString(),
      pusd: pusd.toString(),
      perClaim: { sats: limits.sats.toString(), pusd: limits.pusdUnits.toString() },
      claimsToday: recipients.length,
      perDay: limits.perDay,
      claimsLeft: left,
    };
  }

  async function claim(pkhHex: unknown, ip: string) {
    if (typeof pkhHex !== "string" || !/^[0-9a-f]{40}$/.test(pkhHex)) {
      throw new FaucetError("invalid", 400, "Send the wallet's public key hash as 40 hex characters.");
    }
    if (pkhHex === wallet.pkhHex) throw new FaucetError("invalid", 400, "The faucet cannot pay itself.");
    const recipient = Uint8Array.from([0x76, 0xa9, 0x14, ...hexToBin(pkhHex), 0x88, 0xac]);
    const recipientHex = binToHex(recipient);

    return deps.locks("faucet", async () => {
      const now = deps.now();
      const mine = (byIp.get(ip) ?? []).filter((t) => now - t < DAY_MS);
      if (mine.length >= limits.perIpPerDay) {
        throw new FaucetError("ip_limit", 429, "This connection already claimed test coins several times today.");
      }
      const recipients = await recentRecipients(true);
      if (recipients.includes(recipientHex)) {
        throw new FaucetError("already_claimed", 429, "This wallet already got test coins today.");
      }
      if (recipients.length >= limits.perDay) {
        throw new FaucetError("daily_limit", 429, "The faucet has given out all of today's test coins.");
      }

      const utxos = await coins();
      const pusdCoins: SpendableUtxo[] = [];
      let pusdIn = 0n;
      for (const u of utxos.filter((x) => pusdOf(x) > 0n).sort((a, b) => (pusdOf(a) < pusdOf(b) ? 1 : -1))) {
        if (pusdIn >= limits.pusdUnits) break;
        pusdCoins.push(u);
        pusdIn += pusdOf(u);
      }
      const bchCoins: SpendableUtxo[] = [];
      let satsIn = pusdCoins.reduce((sum, u) => sum + u.satoshis, 0n);
      const satsNeeded = limits.sats + 5_000n; // the payout, a token change coin, the BCH change and the fee
      for (const u of utxos.filter((x) => !x.token).sort(largestFirst)) {
        if (satsIn >= satsNeeded || bchCoins.length >= 30) break;
        bchCoins.push(u);
        satsIn += u.satoshis;
      }
      if (pusdIn < limits.pusdUnits || satsIn < satsNeeded) {
        throw new FaucetError("empty", 503, "The faucet is empty right now.");
      }

      const unlocker = wallet.unlockP2PKH();
      const builder = new TransactionBuilder({ provider })
        .addInputs([...pusdCoins, ...bchCoins], unlocker)
        .addOutput({ to: recipient, amount: limits.sats, token: { amount: limits.pusdUnits, category: pusdCategory } });
      const { txid } = await builder
        .addTokenChangeOutputIfNeeded({ category: pusdCategory, to: tokenAddress })
        .addBchChangeOutputIfNeeded({ to: wallet.lock, feeRate: FEE_RATE })
        .send();

      for (const u of [...pusdCoins, ...bchCoins]) spent.set(`${u.txid}:${u.vout}`, now);
      sent.push({ txid, recipient: recipientHex, at: now });
      while (sent.length > 0 && now - sent[0]!.at > DAY_MS) sent.shift();
      byIp.set(ip, [...mine, now]);
      cached = null;
      return {
        txid,
        address: deps.addressOf(recipient, true),
        sats: limits.sats.toString(),
        pusd: limits.pusdUnits.toString(),
      };
    });
  }

  return { address: tokenAddress, status, claim };
}

export type Faucet = ReturnType<typeof makeFaucet>;
