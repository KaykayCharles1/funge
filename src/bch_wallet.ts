import { initiateDappRelay } from "@wizardconnect/core";
import type { DappRelayResult } from "@wizardconnect/core";
import { DappConnectionManager } from "@wizardconnect/dapp";
import { binToHex, hash160 } from "@bitauth/libauth";

const RECEIVE = 0; // child index 0 = receive path (per the dapp typings: 0 = receive, 1 = change)

export type WalletState = {
  status: "idle" | "waiting" | "connected";
  walletName: string | null;
  pkhHex: string | null; // hash160 of the wallet's first receive key
  uri: string | null;
  qrUri: string | null; // null when resuming a saved session (no new scan needed)
  error: string | null;
};

export const manager = new DappConnectionManager("Funge");
let relay: DappRelayResult | null = null;

let state: WalletState = { status: "idle", walletName: null, pkhHex: null, uri: null, qrUri: null, error: null };
const listeners = new Set<(s: WalletState) => void>();
const set = (patch: Partial<WalletState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
};

export const getWalletState = () => state;
export function subscribe(listener: (s: WalletState) => void) {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

function cleanupRelay() {
  relay?.cleanup();
  relay = null;
}

manager.on("walletready", () => {
  const pubkey = manager.getPubkey(RECEIVE, 0n);
  set({
    status: "connected",
    walletName: manager.walletName,
    pkhHex: pubkey ? binToHex(hash160(pubkey)) : null,
    error: null,
  });
});

manager.on("disconnect", (_reason, message) => {
  cleanupRelay();
  set({ status: "idle", walletName: null, pkhHex: null, uri: null, qrUri: null, error: message ?? "Wallet disconnected." });
});

manager.on("reconnecting", () => set({ error: "Connection to the wallet relay dropped. Reconnecting…" }));

export function startConnection(forceNew: boolean) {
  cleanupRelay();
  if (forceNew) manager.clearStoredSession();
  const stored = forceNew ? null : manager.loadStoredSession();
  const resume =
    stored && stored.walletPublicKey
      ? { privateKey: stored.privateKey, secret: stored.secret, walletPublicKey: stored.walletPublicKey }
      : undefined;
  if (stored?.paths && resume) manager.restoreSessionPaths(stored.paths);

  relay = initiateDappRelay(({ client, status }) => {
    manager.updateConnection(client, status);
    if (status.status === "connected") set({ error: null });
  }, resume ? { existingCredentials: resume } : undefined);
  manager.attachRelay(relay);

  set({
    status: "waiting",
    uri: relay.uri,
    qrUri: resume ? null : relay.qrUri,
    walletName: null,
    pkhHex: null,
    error: null,
  });
}

// On page load: reconnect to a previously paired wallet without a new QR scan
export function resumeIfStored() {
  if (manager.loadStoredSession()?.walletPublicKey) startConnection(false);
}

export async function disconnectWallet() {
  try {
    await Promise.race([
      manager.sendDisconnect("Disconnected from Funge"),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch (e) {
    console.warn(e);
  }
  cleanupRelay();
  manager.clearStoredSession();
  set({ status: "idle", walletName: null, pkhHex: null, uri: null, qrUri: null, error: null });
}