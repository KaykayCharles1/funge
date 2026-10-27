import "./style.css";
import { hexToBin } from "@bitauth/libauth";
import type { ElectrumNetworkProvider } from "cashscript";
import { CONFIG } from "./config.ts";
import { findEndedRound } from "./ended.ts";
import type { EndedRound } from "./ended.ts";
import { frameSvg, shareOrDownload, svgToDataUrl, svgToPngBlob } from "./lib/art.ts";
import { lockToAddress, p2pkhLock } from "./lib/chain.ts";
import { decodeCommitment } from "./lib/commitment.ts";
import { formatDuration, formatUnits } from "./lib/format.ts";
import type { Game } from "./lib/game.ts";
import { loadRecentFrames } from "./lib/history.ts";
import type { Frame } from "./lib/history.ts";
import { makeProvider } from "./lib/provider.ts";
import { qrDataUrl } from "./lib/qr.ts";
import { blocksToSettle } from "./lib/timing.ts";
import { PassError, buildPassRequest, friendlyError, signAndBroadcast } from "./pass.ts";
import { friendlySettleError, settleRound } from "./settle.ts";
import { stealWithLocalWallet } from "./steal.ts";
import { vault } from "./wallet/vault.ts";
import { disconnectWallet, getWalletState, resumeIfStored, startConnection, subscribe } from "./bch_wallet.ts";
import type { WalletState } from "./bch_wallet.ts";
import { getLocalWallet, initLocalWallet, onLocalWalletChange, refreshBalances } from "./walletUI.ts";
import { loadCachedEnded, loadCachedState, saveEnded, saveState } from "./lib/cache.ts";
import type { CachedState } from "./lib/cache.ts";


const POLL_MS = 25_000;
const SIGN_TIMEOUT_MS = 180_000;
const AVG_BLOCK_MIN = 10; // BCH blocks average about 10 minutes
const PLACEHOLDER_MESSAGES = [
  "",
  "Connect a wallet to play.",
  "Create a game wallet to play.",
  "Unlock your game wallet to play.",
  "Ready. Tap the button to grab the potato.",
];

const $ = (id: string) => document.getElementById(id)!;
const show = (id: string, visible: boolean) => $(id).classList.toggle("hidden", !visible);
const shortKey = (hex: string) => `${hex.slice(0, 8)}…${hex.slice(-6)}`;

const CARD = "rounded-2xl p-5 ring-1";
const CARD_NORMAL = `${CARD} bg-slate-900 ring-slate-800`;
const CARD_READY = `${CARD} bg-amber-500/10 ring-amber-400`;

type ArtFrame = { passCount: number; holderPkh: string; pot: bigint };
type ConfirmationInfo = { confirmations: number; blocktime: number | null };

let highestPass = -1; // never show an older state than one we've already seen
let holderPkh: string | null = null;
let currentPrice: bigint | null = null;
let lastQr: string | null = null;
let activeGrab: AbortController | null = null;
let activeGrabMode: "walletconnect" | "local" | null = null;
let settling = false;
let lastEnded: EndedRound | null = null;
let activeGame: Game | null = null;
let liveFrame: ArtFrame | null = null;
let shownFrame: ArtFrame | null = null;
let frames: Frame[] = [];
let stripKey = "";
let lastBlockTime: number | null = null; // unix seconds of the block that confirmed the latest grab

// The keys that count as "you": the game wallet and/or a connected external wallet
const myPkhs = () =>
  [getLocalWallet()?.pkhHex, getWalletState().pkhHex].filter((k): k is string => !!k);

function renderHolder() {
  if (!holderPkh) return;
  const mine = myPkhs().includes(holderPkh);
  $("holder").textContent = mine ? `${shortKey(holderPkh)} (you)` : shortKey(holderPkh);
}

function renderEnded(r: EndedRound) {
  lastEnded = r;
  show("live", false);
  show("ended", true);
  if (activeGame) {
    ($("endedArt") as HTMLImageElement).src = svgToDataUrl(
      frameSvg({ passCount: r.passes, holderPkh: r.winnerPkh, gameCategory: activeGame.gameCategory }),
    );
  }
  const mine = myPkhs().includes(r.winnerPkh);
  const winner = lockToAddress(p2pkhLock(hexToBin(r.winnerPkh)), false);
  $("endedTitle").textContent = mine ? "You won the pot!" : "The potato has a winner";
  $("endedWinner").textContent = mine ? `${winner} (you)` : winner;
  $("endedPot").textContent = `${formatUnits(r.potPaid, CONFIG.pusdDecimals)} PUSD`;
  $("endedPasses").textContent = String(r.passes);
  $("endedTrophy").textContent =
  getLocalWallet()?.pkhHex === r.winnerPkh
    ? "An immutable trophy NFT is in your game wallet. To see it in another wallet, restore your seed phrase there."
    : mine
      ? "An immutable trophy NFT was sent to your wallet."
      : "An immutable trophy NFT was sent to the winner.";
  $("endedTx").textContent = `Settlement transaction: ${r.settleTxid}${r.confirmed ? "" : " (waiting for confirmation)"}`;
  $("status").textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

function showFrame(game: Game, f: ArtFrame) {
  shownFrame = f;
  const svg = frameSvg({ passCount: f.passCount, holderPkh: f.holderPkh, gameCategory: game.gameCategory });
  ($("art") as HTMLImageElement).src = svgToDataUrl(svg);
  $("artCaption").textContent =
    `Pass ${f.passCount} · pot ${formatUnits(f.pot, CONFIG.pusdDecimals)} PUSD` +
    (liveFrame && f.passCount !== liveFrame.passCount ? " (earlier frame)" : "");
}

function renderFrameStrip(game: Game) {
  const key = frames.map((f) => f.txid).join(",");
  if (key === stripKey) return;
  stripKey = key;
  $("frames").replaceChildren(
    ...frames.map((f) => {
      const button = document.createElement("button");
      button.className = "shrink-0 overflow-hidden rounded-lg ring-1 ring-slate-700 hover:ring-amber-400";
      button.title = `Pass ${f.passCount}`;
      const img = document.createElement("img");
      img.width = 64;
      img.height = 64;
      img.alt = `Pass ${f.passCount}`;
      img.src = svgToDataUrl(frameSvg({ passCount: f.passCount, holderPkh: f.holderPkh, gameCategory: game.gameCategory }));
      button.append(img);
      button.addEventListener("click", () => showFrame(game, f));
      return button;
    }),
  );
}

async function updateFrames(game: Game, provider: ElectrumNetworkProvider) {
  frames = await loadRecentFrames(game, provider);
  renderFrameStrip(game);
}

async function shareFrame(game: Game) {
  const f = shownFrame;
  if (!f) return;
  $("shareMsg").textContent = "Preparing image…";
  try {
    const pot = formatUnits(f.pot, CONFIG.pusdDecimals);
    const svg = frameSvg(
      { passCount: f.passCount, holderPkh: f.holderPkh, gameCategory: game.gameCategory },
      { line1: `FUNGE · PASS ${f.passCount}`, line2: `Pot ${pot} PUSD` },
    );
    const how = await shareOrDownload(
      await svgToPngBlob(svg),
      `funge-pass-${f.passCount}.png`,
      `Funge pass ${f.passCount}: pot ${pot} PUSD`,
    );
    $("shareMsg").textContent = how === "downloaded" ? "Saved as a PNG in your downloads." : "";
  } catch (e) {
    console.error(e);
    $("shareMsg").textContent = "Could not create the image. Please try again.";
  }
}

// External wallet (WizardConnect) card
function renderWallet(s: WalletState) {
  if (s.status === "idle" && activeGrabMode === "walletconnect") activeGrab?.abort(new Error("Wallet disconnected"));
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
  renderHolder();
  if (lastEnded) renderEnded(lastEnded);
  updateGrabButton();
}

async function loadGame(): Promise<Game> {
  const res = await fetch(`${import.meta.env.BASE_URL}game.${CONFIG.network}.json`);
  if (!res.ok) throw new Error(`Cannot load game.${CONFIG.network}.json (${res.status})`);
  return res.json();
}

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
  show("settleBtn", false);
  if (info === null) {
    section.className = CARD_NORMAL;
    $("countdownTitle").textContent = "Countdown unavailable";
    $("countdownDetail").textContent = "Could not read the confirmation count from the network server.";
    return;
  }
  const togo = blocksToSettle(timeoutBlocks, info.confirmations);
  if (togo === 0) {
    section.className = CARD_READY;
    show("settleBtn", true);
    $("settleBtn").textContent =
      holderPkh && myPkhs().includes(holderPkh) ? "Claim your pot" : "Settle: pay the pot to the holder";
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
    show("settleBtn", false);
    const ended = await findEndedRound(game, provider);
    if (ended) {
      saveEnded(game.gameCategory, ended);
      currentPrice = null;
      updateGrabButton();
      renderEnded(ended);
      return;
    }
    $("status").textContent = "No live round found (the server may be catching up).";
    return;
  }
  lastEnded = null;
  show("ended", false);
  show("live", true);

  const c = decodeCommitment(s.token.nft.commitment);
  if (c.passCount < highestPass) {
    $("status").textContent = "Server is catching up…";
    return;
  }
  highestPass = c.passCount;
  const price = BigInt(game.params.basePrice) + BigInt(game.params.priceStep) * BigInt(c.passCount);
  currentPrice = price;
  $("passCount").textContent = String(c.passCount);
  holderPkh = c.holderPkh;
  renderHolder();
  $("pot").textContent = formatUnits(p.token.amount, CONFIG.pusdDecimals);
  $("price").textContent = formatUnits(price, CONFIG.pusdDecimals);

  const previous = liveFrame;
  liveFrame = { passCount: c.passCount, holderPkh: c.holderPkh, pot: p.token.amount };
  if (!previous || previous.passCount !== c.passCount || !shownFrame) showFrame(game, liveFrame);
  void updateFrames(game, provider).catch(console.error);
  updateGrabButton();

  const info = await getConfirmationInfo(provider, s.txid).catch((e) => {
    console.error(e);
    return null;
  });
  renderCountdown(game.params.timeoutBlocks, info);
  saveState(game.gameCategory, { passCount: c.passCount, holderPkh: c.holderPkh, pot: p.token.amount, blocktime: info?.blocktime ?? null });
  $("status").textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

// Show the result of our own steal straight away, before the network catches up
function applyOptimistic(game: Game, passCount: number, holder: string, pot: bigint) {
  highestPass = passCount;
  holderPkh = holder;
  currentPrice = BigInt(game.params.basePrice) + BigInt(game.params.priceStep) * BigInt(passCount);
  $("passCount").textContent = String(passCount);
  $("pot").textContent = formatUnits(pot, CONFIG.pusdDecimals);
  $("price").textContent = formatUnits(currentPrice, CONFIG.pusdDecimals);
  renderHolder();
  liveFrame = { passCount, holderPkh: holder, pot };
  showFrame(game, liveFrame);
  renderCountdown(game.params.timeoutBlocks, { confirmations: 0, blocktime: null });
  updateGrabButton();
}

// Show the last known state straight away while the first network answer is on its way
function renderCached(game: Game, c: CachedState) {
  highestPass = c.passCount;
  holderPkh = c.holderPkh;
  const price = BigInt(game.params.basePrice) + BigInt(game.params.priceStep) * BigInt(c.passCount);
  $("passCount").textContent = String(c.passCount);
  $("pot").textContent = formatUnits(c.pot, CONFIG.pusdDecimals);
  $("price").textContent = formatUnits(price, CONFIG.pusdDecimals);
  renderHolder();
  liveFrame = { passCount: c.passCount, holderPkh: c.holderPkh, pot: c.pot };
  showFrame(game, liveFrame);
  lastBlockTime = c.blocktime;
  updateAgo();
  $("countdownTitle").textContent = "Checking the countdown…";
  $("countdownDetail").textContent = "Showing the last known state while we connect.";
  $("status").textContent = "Showing the last known state. Updating…";
}

function updateGrabButton() {
  const btn = $("grabBtn") as HTMLButtonElement;
  const local = getLocalWallet();
  const external = getWalletState().status === "connected";
  const busy = activeGrab !== null;
  btn.disabled = busy || currentPrice === null || (!local && !external);
  btn.textContent =
    currentPrice !== null
      ? `Grab the potato · ${formatUnits(currentPrice, CONFIG.pusdDecimals)} PUSD`
      : "Grab the potato";
  show("cancelGrabBtn", busy && activeGrabMode === "walletconnect");
  const msg = $("grabMsg");
  if (!busy && PLACEHOLDER_MESSAGES.includes(msg.textContent ?? "")) {
    msg.textContent =
      local || external ? "" : vault.state() === "locked" ? "Unlock your game wallet to play." : "Create a game wallet to play.";
  }
}

function refreshSoon(game: Game, provider: ElectrumNetworkProvider, delays: number[]) {
  for (const delay of delays) setTimeout(() => void refresh(game, provider).catch(console.error), delay);
}

// Instant path: the game wallet signs locally and broadcasts, with no popup
async function stealLocal(game: Game, provider: ElectrumNetworkProvider) {
  const wallet = getLocalWallet();
  if (!wallet) {
    $("grabMsg").textContent =
      vault.state() === "locked" ? "Your wallet is locked. Unlock it to play." : "Create a game wallet to play.";
    return;
  }
  if (currentPrice === null || activeGrab) return;
  activeGrab = new AbortController(); // only used as a "busy" marker here
  activeGrabMode = "local";
  updateGrabButton();
  try {
    $("grabMsg").textContent = "Sending…";
    const result = await stealWithLocalWallet(game, provider, wallet, currentPrice);
    applyOptimistic(game, result.passCount, wallet.pkhHex, result.pot);
    $("grabMsg").textContent = `Done! You hold the potato (${result.txid.slice(0, 12)}…).`;
    void refreshBalances(provider);
    refreshSoon(game, provider, [2_000, 6_000, 12_000]);
  } catch (e) {
    console.error(e);
    $("grabMsg").textContent = friendlyError(e);
    if (e instanceof PassError && (e.code === "stale" || e.code === "price-changed")) {
      refreshSoon(game, provider, [0, 4_000]);
    }
  } finally {
    activeGrab = null;
    activeGrabMode = null;
    updateGrabButton();
  }
}

// Fallback path: ask an external wallet (WizardConnect) to sign
async function grabWithExternalWallet(game: Game, provider: ElectrumNetworkProvider) {
  const w = getWalletState();
  if (w.status !== "connected" || !w.pkhHex || activeGrab) return;
  const controller = new AbortController();
  activeGrab = controller;
  activeGrabMode = "walletconnect";
  const timer = setTimeout(() => controller.abort(new Error("Timed out waiting for your wallet")), SIGN_TIMEOUT_MS);
  updateGrabButton();
  try {
    $("grabMsg").textContent = "Preparing transaction…";
    const plan = await buildPassRequest(game, provider, w.pkhHex);
    $("grabMsg").textContent =
      `Approve in your wallet: pay ${formatUnits(plan.price, CONFIG.pusdDecimals)} PUSD (network fee about ${plan.feeSats} sats).`;
    const txid = await signAndBroadcast(plan, provider, controller.signal);
    console.log("Pass broadcast, txid:", txid);
    $("grabMsg").textContent = `Sent (${txid.slice(0, 12)}…). The page updates as soon as the network shows it.`;
    refreshSoon(game, provider, [2_000, 6_000, 12_000]);
  } catch (e) {
    console.error(e);
    $("grabMsg").textContent = friendlyError(e);
    if (e instanceof PassError && e.code === "stale") refreshSoon(game, provider, [0, 4_000]);
  } finally {
    clearTimeout(timer);
    activeGrab = null;
    activeGrabMode = null;
    updateGrabButton();
  }
}

function onGrabClick(game: Game, provider: ElectrumNetworkProvider) {
  if (getLocalWallet()) void stealLocal(game, provider);
  else void grabWithExternalWallet(game, provider);
}

async function settle(game: Game, provider: ElectrumNetworkProvider) {
  if (settling) return;
  settling = true;
  const btn = $("settleBtn") as HTMLButtonElement;
  btn.disabled = true;
  $("settleMsg").textContent = "Preparing settlement…";
  try {
    const txid = await settleRound(game, provider);
    console.log("Settle broadcast, txid:", txid);
    const mine = holderPkh !== null && myPkhs().includes(holderPkh);
    $("settleMsg").textContent = mine
      ? `Claimed (${txid.slice(0, 12)}…). The pot is on its way to your wallet.`
      : `Settled (${txid.slice(0, 12)}…). The pot is on its way to the holder.`;
  } catch (e) {
    console.error(e);
    $("settleMsg").textContent = friendlySettleError(e);
  } finally {
    settling = false;
    btn.disabled = false;
    void refreshBalances(provider);
    refreshSoon(game, provider, [2_000, 6_000, 12_000]);
  }
}

async function main() {
  const game = await loadGame();
  activeGame = game;
  const cachedEnded = loadCachedEnded(game.gameCategory);
  if (cachedEnded) {
    renderEnded(cachedEnded);
  } else {
    const cached = loadCachedState(game.gameCategory);
    if (cached) renderCached(game, cached);
  }
  const provider = makeProvider();

  $("connectBtn").addEventListener("click", () => startConnection(true));
  $("cancelBtn").addEventListener("click", () => void disconnectWallet());
  $("disconnectBtn").addEventListener("click", () => void disconnectWallet());
  $("copyUri").addEventListener("click", () => {
    const uri = getWalletState().uri;
    if (uri) void navigator.clipboard.writeText(uri);
  });
  $("grabBtn").addEventListener("click", () => onGrabClick(game, provider));
  $("cancelGrabBtn").addEventListener("click", () => activeGrab?.abort(new Error("Cancelled by you")));
  $("settleBtn").addEventListener("click", () => void settle(game, provider));
  $("shareBtn").addEventListener("click", () => void shareFrame(game));

  subscribe(renderWallet);
  onLocalWalletChange(() => {
    renderHolder();
    if (lastEnded) renderEnded(lastEnded);
    updateGrabButton();
  });
  resumeIfStored();
  void initLocalWallet(provider);
  setInterval(updateAgo, 1000);

  let lastOk: Date | null = null;
  let failures = 0;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    if (running) return;
    running = true;
    clearTimeout(timer);
    let delay = POLL_MS;
    try {
      await refresh(game, provider);
      void refreshBalances(provider);
      lastOk = new Date();
      failures = 0;
    } catch (e) {
      console.error(e);
      failures++;
      $("status").textContent = lastOk
        ? `Network hiccup. Showing data from ${lastOk.toLocaleTimeString()}. Retrying…`
        : failures >= 3
          ? "The network servers are not responding. Check your connection. Retrying…"
          : "Connecting to the network…";
      delay = Math.min(3_000 * failures, POLL_MS);
    } finally {
      running = false;
    }
    timer = setTimeout(tick, delay);
  };
  // Refresh as soon as the player comes back to the tab
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void tick();
  });
  void tick();
}

main().catch((e) => {
  console.error(e);
  $("status").textContent = `Error: ${e instanceof Error ? e.message : e}`;
});