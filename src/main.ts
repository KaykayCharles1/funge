import "./style.css";
import { ElectrumNetworkProvider } from "cashscript";
import { CONFIG } from "./config.ts";
import { decodeCommitment } from "./lib/commitment.ts";
import type { Game } from "./lib/game.ts";
import { qrDataUrl } from "./lib/qr.ts";
import { blocksToSettle } from "./lib/timing.ts";
import { PassError, buildPassRequest, friendlyError, signAndBroadcast } from "./pass.ts";
import { disconnectWallet, getWalletState, resumeIfStored, startConnection, subscribe } from "./bch_wallet.ts";
import type { WalletState } from "./bch_wallet.ts";
import { formatDuration, formatUnits } from "./lib/format.ts";


const POLL_MS = 25_000;
const SIGN_TIMEOUT_MS = 180_000;
const $ = (id: string) => document.getElementById(id)!;

let highestPass = -1; // never show an older state than one we've already seen
let holderPkh: string | null = null;
let lastQr: string | null = null;
let activeGrab: AbortController | null = null;
const AVG_BLOCK_MIN = 10; // BCH blocks average about 10 minutes
let lastBlockTime: number | null = null; // unix seconds of the block that confirmed the latest grab

const shortKey = (hex: string) => `${hex.slice(0, 8)}…${hex.slice(-6)}`;
const show = (id: string, visible: boolean) => $(id).classList.toggle("hidden", !visible);

const CARD = "rounded-2xl p-5 ring-1";
const CARD_NORMAL = `${CARD} bg-slate-900 ring-slate-800`;
const CARD_READY = `${CARD} bg-amber-500/10 ring-amber-400`;

function renderHolder() {
  if (!holderPkh) return;
  const mine = getWalletState().pkhHex === holderPkh;
  $("holder").textContent = mine ? `${shortKey(holderPkh)} (you)` : shortKey(holderPkh);
}

function renderWallet(s: WalletState) {
  if (s.status === "idle") activeGrab?.abort(new Error("Wallet disconnected"));
  ($("grabBtn") as HTMLButtonElement).disabled = s.status !== "connected" || activeGrab !== null;
  show("walletIdle", s.status === "idle");
  show("walletWaiting", s.status === "waiting");
  show("walletConnected", s.status === "connected");
  $("walletError").textContent = s.error ?? "";
  if (s.status === "waiting") {
    $("walletWaitingText").textContent = s.qrUri
      ? "Scan this code with your wallet, or copy the link into it."
      : "Reconnecting to your wallet…";
    show("qr", !!s.qrUri);
    if (s.qrUri && s.qrUri !== lastQr) {
      lastQr = s.qrUri;
      ($("qr") as HTMLImageElement).src = qrDataUrl(s.qrUri);
    }
    const link = document.getElementById("openWallet") as HTMLAnchorElement | null;
    if (link) link.href = s.uri ?? "#";
  }
  if (s.status === "connected") {
    $("walletName").textContent = s.walletName ?? "Wallet";
    $("walletKey").textContent = s.pkhHex ? `Key ${shortKey(s.pkhHex)}` : "";
  }
    if (s.status !== "connected") {
    $("grabMsg").textContent = "Connect a wallet to play.";
  } else if ($("grabMsg").textContent === "Connect a wallet to play.") {
    $("grabMsg").textContent = "Ready. Tap the button to grab the potato.";
  }
  renderHolder();
}

async function loadGame(): Promise<Game> {
  const res = await fetch(`${import.meta.env.BASE_URL}game.${CONFIG.network}.json`);
  if (!res.ok) throw new Error(`Cannot load game.${CONFIG.network}.json (${res.status})`);
  return res.json();
}

// Confirmations of a transaction, or null if the server answers in an unexpected shape
type ConfirmationInfo = { confirmations: number; blocktime: number | null };

// Confirmations (and the block time, if the server gives it) of a transaction; null if the shape is unexpected
async function getConfirmationInfo(provider: ElectrumNetworkProvider, txid: string): Promise<ConfirmationInfo | null> {
  const res: unknown = await provider.performRequest("blockchain.transaction.get", txid, true);
  if (res instanceof Error) throw res;
  if (res && typeof res === "object") {
    const r = res as { confirmations?: unknown; blocktime?: unknown };
    if (r.confirmations === undefined) return { confirmations: 0, blocktime: null }; // still in the mempool
    const confirmations = Number(r.confirmations);
    if (Number.isFinite(confirmations)) {
      const bt = Number(r.blocktime);
      return { confirmations, blocktime: Number.isFinite(bt) && bt > 0 ? bt : null };
    }
  }
  console.warn("Unexpected blockchain.transaction.get response", res);
  return null;
}

function updateAgo() {
  const el = $("countdownAgo");
  if (lastBlockTime === null) {
    el.textContent = "";
    return;
  }
  const secs = Math.max(0, Math.floor(Date.now() / 1000 - lastBlockTime));
    el.textContent = `Last grab confirmed ${formatDuration(secs)} ago`;
}

function renderCountdown(timeoutBlocks: number, info: ConfirmationInfo | null) {
  const section = $("countdown");
  lastBlockTime = info?.blocktime ?? null;
  updateAgo();
  if (info === null) {
    section.className = CARD_NORMAL;
    $("countdownTitle").textContent = "Countdown unavailable";
    $("countdownDetail").textContent = "Could not read the confirmation count from the network server.";
    return;
  }
  const togo = blocksToSettle(timeoutBlocks, info.confirmations);
  if (togo === 0) {
    section.className = CARD_READY;
    $("countdownTitle").textContent = "Ready to settle";
    $("countdownDetail").textContent = "Nobody grabbed in time. The holder can claim the pot now.";
  } else if (info.confirmations === 0) {
    section.className = CARD_NORMAL;
    $("countdownTitle").textContent = `Waiting for the latest grab to confirm (0 of ${timeoutBlocks} blocks)`;
    $("countdownDetail").textContent =
      `Settle opens after ${timeoutBlocks} blocks with no new grab. The block that confirms this grab counts as the first, so the whole wait is about ${timeoutBlocks * AVG_BLOCK_MIN} minutes from the grab. Every grab restarts it.`;
  } else {
    section.className = CARD_NORMAL;
    $("countdownTitle").textContent =
      `About ${togo * AVG_BLOCK_MIN} minutes until settle (${info.confirmations} of ${timeoutBlocks} blocks)`;
    $("countdownDetail").textContent =
      `${togo} more block${togo === 1 ? "" : "s"} needed. Blocks average ${AVG_BLOCK_MIN} minutes but vary a lot, so this is an estimate. Anyone can still grab until then.`;
  }
}

async function refresh(game: Game, provider: ElectrumNetworkProvider) {
  const [stateUtxos, potUtxos] = await Promise.all([
    provider.getUtxos(game.state.address),
    provider.getUtxos(game.pot.address),
  ]);
  const s = stateUtxos[0];
  const p = potUtxos[0];
  if (!s?.token?.nft || !p?.token) {
    $("status").textContent = "No live round found (it may have been settled, or the server is catching up).";
    return;
  }
  const c = decodeCommitment(s.token.nft.commitment);
  if (c.passCount < highestPass) {
    $("status").textContent = "Server is catching up…";
    return;
  }
  highestPass = c.passCount;
  const price = BigInt(game.params.basePrice) + BigInt(game.params.priceStep) * BigInt(c.passCount);
  $("passCount").textContent = String(c.passCount);
  holderPkh = c.holderPkh;
  renderHolder();
  $("pot").textContent = formatUnits(p.token.amount, CONFIG.pusdDecimals);
  $("price").textContent = formatUnits(price, CONFIG.pusdDecimals);

    const info = await getConfirmationInfo(provider, s.txid).catch((e) => {
    console.error(e);
    return null;
  });
  renderCountdown(game.params.timeoutBlocks, info);
  $("status").textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

function setGrabbing(on: boolean) {
  ($("grabBtn") as HTMLButtonElement).disabled = on || getWalletState().status !== "connected";
  show("cancelGrabBtn", on);
}

async function grab(game: Game, provider: ElectrumNetworkProvider) {
  const w = getWalletState();
  if (w.status !== "connected" || !w.pkhHex || activeGrab) return;
  const controller = new AbortController();
  activeGrab = controller;
  const timer = setTimeout(() => controller.abort(new Error("Timed out waiting for your wallet")), SIGN_TIMEOUT_MS);
  setGrabbing(true);
  try {
    $("grabMsg").textContent = "Preparing transaction…";
    const plan = await buildPassRequest(game, provider, w.pkhHex);
    $("grabMsg").textContent =
      `Approve in your wallet: pay ${formatUnits(plan.price, CONFIG.pusdDecimals)} PUSD (network fee about ${plan.feeSats} sats).`;
    const txid = await signAndBroadcast(plan, provider, controller.signal);
    console.log("Pass broadcast, txid:", txid);
    $("grabMsg").textContent = `Sent (${txid.slice(0, 12)}…). The page updates as soon as the network shows it.`;
    for (const delay of [2_000, 6_000, 12_000]) {
      setTimeout(() => void refresh(game, provider).catch(console.error), delay);
    }
  } catch (e) {
    console.error(e);
    if (e instanceof PassError && e.code === "stale") {
      for (const delay of [0, 4_000]) setTimeout(() => void refresh(game, provider).catch(console.error), delay);
    }
    $("grabMsg").textContent = friendlyError(e);
  } finally {
    clearTimeout(timer);
    activeGrab = null;
    setGrabbing(false);
  }
}

async function main() {
  const game = await loadGame();
  const provider = new ElectrumNetworkProvider(CONFIG.network);

  $("connectBtn").addEventListener("click", () => startConnection(true));
  $("cancelBtn").addEventListener("click", () => void disconnectWallet());
  $("disconnectBtn").addEventListener("click", () => void disconnectWallet());
  $("copyUri").addEventListener("click", () => {
    const uri = getWalletState().uri;
    if (uri) void navigator.clipboard.writeText(uri);
  });
  $("grabBtn").addEventListener("click", () => void grab(game, provider));
  $("cancelGrabBtn").addEventListener("click", () => activeGrab?.abort(new Error("Cancelled by you")));
  subscribe(renderWallet);
  setInterval(updateAgo, 1000);
  resumeIfStored();

  let lastOk: Date | null = null;
  let failures = 0;
  const tick = async () => {
    let delay = POLL_MS;
    try {
      await refresh(game, provider);
      lastOk = new Date();
      failures = 0;
    } catch (e) {
      console.error(e);
      failures++;
      $("status").textContent = lastOk
        ? `Network hiccup. Showing data from ${lastOk.toLocaleTimeString()}. Retrying…`
        : "Connecting to the network…";
      delay = Math.min(3_000 * failures, POLL_MS);
    }
    setTimeout(tick, delay);
  };
  void tick();
}

main().catch((e) => {
  console.error(e);
  $("status").textContent = `Error: ${e instanceof Error ? e.message : e}`;
});