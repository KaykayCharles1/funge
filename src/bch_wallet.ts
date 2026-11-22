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

// The player chose to play with their own wallet (remembered in this browser): only then is an old pairing resumed
const EXTERNAL_FLAG = "funge:external";
export const externalWanted = () => {
  try {
    return localStorage.getItem(EXTERNAL_FLAG) === "1";
  } catch {
    return false;
  }
};
export const setExternalFlag = (on: boolean) => {
  try {
    if (on) localStorage.setItem(EXTERNAL_FLAG, "1");
    else localStorage.removeItem(EXTERNAL_FLAG);
  } catch {
    // optional
  }
};
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

// Pairing by the copied link: the player leaves this tab for the wallet app, and the relay library, on a hidden tab,
// closes its connection and treats every message before that moment as already read. The wallet's answer
// (wallet_ready) arrives while the tab is hidden, so on return it would be dropped as old and the panel would wait
// forever. While not yet paired, when the tab is shown again, accept messages from the moment the link was made.
let relayClient: { setLastProcessedTimestamp(t: number): void } | null = null;
let linkMadeAt = 0;
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || state.status !== "waiting" || !state.qrUri || !relayClient) return;
    try {
      relayClient.setLastProcessedTimestamp(Math.max(1, linkMadeAt - 2));
    } catch (e) {
      console.warn(e);
    }
  });
}

export function startConnection(forceNew: boolean) {
  cleanupRelay();
  if (forceNew) manager.clearStoredSession();
  const stored = forceNew ? null : manager.loadStoredSession();
  const resume =
    stored && stored.walletPublicKey
      ? { privateKey: stored.privateKey, secret: stored.secret, walletPublicKey: stored.walletPublicKey }
      : undefined;
  if (stored?.paths && resume) manager.restoreSessionPaths(stored.paths);

  linkMadeAt = Math.floor(Date.now() / 1000);
  relayClient = null;
  // The manager hooks its message listener onto the first relay client it is given, once per page
  // (@wizardconnect/dapp updateConnection: listenerAttached). Each connection here makes a new client, so without this
  // a second connection in the same page (Cancel and try again, Disconnect then connect, a resume then a new pairing)
  // never hears the wallet's wallet_ready and waits until a reload.
  (manager as unknown as { listenerAttached: boolean }).listenerAttached = false;
  relay = initiateDappRelay(({ client, status }) => {
    relayClient = client;
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