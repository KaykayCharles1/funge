import type { ElectrumNetworkProvider } from "cashscript";
import { disconnectWallet, getWalletState, resumeIfStored, startConnection, subscribe } from "./bch_wallet.ts";
import type { WalletState } from "./bch_wallet.ts";
import { CONFIG } from "./config.ts";
import { COPY, errorText, pauseText } from "./copy.ts";
import { findEndedRound } from "./ended.ts";
import { renderEndedRound } from "./endedView.ts";
import { frameSvg, svgToDataUrl } from "./lib/art.ts";
import { formatDuration, formatUnits } from "./lib/format.ts";
import type { GameV2 } from "./lib/game.ts";
import { makeProvider } from "./lib/provider.ts";
import { qrDataUrl } from "./lib/qr.ts";
import { claim, getRound, watchRound } from "./referee/api.ts";
import type { RefereeEvent, RoundSnapshot, WatchStatus } from "./referee/api.ts";
import { watchChain } from "./referee/chainWatch.ts";
import type { ChainWatch } from "./referee/chainWatch.ts";
import { serverNow, syncClock } from "./referee/clock.ts";
import { settleWithoutReferee } from "./referee/fallback.ts";
import { grabViaReferee } from "./referee/grab.ts";
import { grabViaExternalWallet } from "./referee/grabExternal.ts";
import { vault } from "./wallet/vault.ts";
import { getLocalWallet, initLocalWallet, onLocalWalletChange, refreshBalances } from "./walletUI.ts";

const $ = (id: string) => document.getElementById(id)!;
const show = (id: string, visible: boolean) => $(id).classList.toggle("hidden", !visible);
const shortKey = (hex: string) => `${hex.slice(0, 8)}…${hex.slice(-6)}`;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const CARD = "rounded-2xl p-5 ring-1";
const CARD_NORMAL = `${CARD} bg-slate-900 ring-slate-800`;
const CARD_READY = `${CARD} bg-amber-500/10 ring-amber-400`;
const POLL_MS = 20_000; // safety net: the live socket does the real work
const SIGN_TIMEOUT_MS = 180_000; // how long we wait for the player to approve in their own wallet

type Shown = { passCount: number; king: string | null; pot: string | null; price: string | null };

let game: GameV2;
let provider: ElectrumNetworkProvider;
let round: RoundSnapshot | null = null;
let shown: Shown | null = null; // never show an older chain state than one we have already seen
let artPass = -1;
let net: WatchStatus = "connecting";
let watcher: ReturnType<typeof watchRound> | null = null;
let endedShown = false;
let endedBusy = false;
let failures = 0;
let running = false;
let grabbing = false;
let grabMode: "local" | "external" | null = null;
let activeGrab: AbortController | null = null;
let signPrompt = "";
let lastQr = "";
let coolUntil = 0; // after "outcome unknown", wait before allowing another grab
let claiming = false;
let claimNote = "";
let chain: ChainWatch | null = null;
let chainBusy = false;
let fallbackBusy = false;
let fallbackNote = "";
let note: { text: string; expires: number | null; pass: number | null } | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

const serverDown = () => failures >= 2 || net === "offline";
const priceFor = (pass: number) => BigInt(game.params.basePrice) + BigInt(game.params.priceStep) * BigInt(pass);
const fmtClock = (ms: number) => formatDuration(Math.ceil(Math.max(0, ms) / 1000));

// The player's own wallet (WizardConnect), when connected
const externalPkh = (): string | null => {
  const w = getWalletState();
  return w.status === "connected" ? w.pkhHex : null;
};
// Every key that counts as "you": the game wallet and/or a connected own wallet
const myKeys = () => [getLocalWallet()?.pkhHex, externalPkh()].filter((k): k is string => !!k);
const isMine = (key: string | null) => key !== null && myKeys().includes(key);

const EXTERNAL_FLAG = "funge:external";
const externalWanted = () => {
  try {
    return localStorage.getItem(EXTERNAL_FLAG) === "1";
  } catch {
    return false;
  }
};
const setExternalFlag = (on: boolean) => {
  try {
    if (on) localStorage.setItem(EXTERNAL_FLAG, "1");
    else localStorage.removeItem(EXTERNAL_FLAG);
  } catch {
    // optional
  }
};
function setExternalVisible(visible: boolean) {
  show("wallet", visible);
  $("useOwnWalletBtn").textContent = visible ? "Hide the external wallet options" : "Use my own wallet instead (WizardConnect)";
}

// Time left, from the SERVER's clock. While paused it is frozen at the moment of the pause.
function remainingMs(): number | null {
  if (!round || round.deadline === null) return null;
  return round.paused ? round.deadline - round.paused.since : round.deadline - serverNow();
}

function renderStats() {
  const s = shown;
  if (!s) return;
  const dec = CONFIG.pusdDecimals;
  $("passCount").textContent = String(s.passCount);
  $("pot").textContent = s.pot === null ? "…" : formatUnits(BigInt(s.pot), dec);
  $("price").textContent = s.price === null ? "—" : formatUnits(BigInt(s.price), dec);
  $("holder").textContent = s.king === null ? "No one yet" : isMine(s.king) ? `${shortKey(s.king)} (you)` : shortKey(s.king);
  if (artPass !== s.passCount) {
    artPass = s.passCount;
    ($("art") as HTMLImageElement).src = svgToDataUrl(
      frameSvg({ passCount: s.passCount, holderPkh: s.king ?? game.creatorPkh, gameCategory: game.gameCategory }),
    );
    $("artCaption").textContent = `Pass ${s.passCount} · pot ${s.pot === null ? "…" : formatUnits(BigInt(s.pot), dec)} PUSD`;
  }
  renderGrab();
}

// The player's own wallet (WizardConnect) card
function renderWallet(s: WalletState) {
  if (s.status === "idle" && grabMode === "external") activeGrab?.abort(new Error("Wallet disconnected"));
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
  renderStats();
}

function renderClock() {
  if (endedShown) {
    show("overModal", false);
    return;
  }
  const section = $("countdown");
  const time = $("countdownTime");
  show("countdownTime", true);
  const r = round;
  let title: string;
  let detail = "";
  let text = "";
  let ready = false;
  let urgent = false;
  if (!r) {
    title = serverDown() ? COPY.network.unreachable : "Connecting to the game server…";
  } else if (r.status === "settled") {
    title = COPY.clock.settled;
    detail = COPY.clock.settling;
  } else if (r.status === "waiting") {
    title = COPY.clock.waiting;
    detail = COPY.clock.waitingDetail;
    text = "--:--:--";
  } else {
    const rem = remainingMs() ?? 0;
    if (r.paused) {
      title = pauseText(r.paused.reason);
      detail = COPY.clock.pausedDetail;
      text = fmtClock(rem);
    } else if (r.status === "over" || rem <= 0) {
      title = COPY.clock.over;
      detail = r.status === "over" ? COPY.clock.overDetail : COPY.clock.confirming; // inside the 1 s grace
      text = "00:00:00";
      ready = true;
    } else {
      title = COPY.clock.running;
      detail = COPY.clock.runningDetail;
      text = fmtClock(rem);
      urgent = rem < 30_000;
    }
  }
  section.className = ready ? CARD_READY : CARD_NORMAL;
  $("countdownTitle").textContent = title;
  $("countdownDetail").textContent = detail;
  time.textContent = text;
  time.className = `mt-2 font-mono text-5xl font-extrabold tabular-nums ${urgent ? "text-red-400" : "text-amber-400"}`;

  const notice = net === "offline" ? COPY.network.offline : r?.chainStale ? COPY.network.stale : "";
  $("netNotice").textContent = notice;
  show("netNotice", notice !== "");
  renderOver();
  renderOutage();
}

// The window everyone sees once the server says time is up. Only the winner gets the Claim button.
function renderOver() {
  const open = !!round && round.status === "over" && !endedShown;
  show("overModal", open);
  if (!open) return;
  const king = shown?.king ?? null;
  const iAmKing = isMine(king);
  const pot = shown?.pot == null ? "…" : formatUnits(BigInt(shown.pot), CONFIG.pusdDecimals);
  $("overTitle").textContent = COPY.over.title;
  $("overText").textContent = iAmKing
    ? COPY.over.youWin(pot)
    : `${COPY.over.someoneWins(pot, king ? shortKey(king) : "the last holder")} ${COPY.over.auto}`;
  show("claimBtn", iAmKing);
  const btn = $("claimBtn") as HTMLButtonElement;
  btn.disabled = claiming;
  btn.textContent = claiming ? COPY.claim.working : COPY.claim.button;
  const locked = !getLocalWallet() && externalPkh() === null && vault.state() === "locked";
  $("claimMsg").textContent = claimNote !== "" ? claimNote : !iAmKing && locked ? COPY.over.unlockHint : "";
}

async function onClaim() {
  if (claiming) return;
  claiming = true; // before anything is awaited, so a double click cannot send twice
  claimNote = "";
  renderOver();
  try {
    const res = await claim(game.gameCategory);
    if (res.ok) claimNote = COPY.claim.done;
    else if (res.error === "round_over" || res.error === "state_changed") claimNote = COPY.claim.already;
    else if (res.error === "outcome_unknown") claimNote = COPY.claim.unknown;
    else claimNote = errorText(res.error);
  } catch (e) {
    console.error(e);
    claimNote = errorText("internal");
  } finally {
    claiming = false;
    renderOver();
    kick();
  }
}

// While the server is unreachable, ask the chain directly
async function pollChain() {
  if (chainBusy || endedShown) return;
  chainBusy = true;
  try {
    const c = await watchChain(game, provider);
    chain = c;
    if (!c.live) {
      void loadEnded(); // the state coin is gone: the round was settled, show the result from the chain
    } else if (!shown) {
      shown = {
        passCount: c.passCount,
        king: c.passCount > 0 ? c.holderPkh : null,
        pot: c.pot === null ? null : c.pot.toString(),
        price: priceFor(c.passCount).toString(),
      };
      renderStats();
    }
    renderOutage();
  } catch (e) {
    console.error(e);
  } finally {
    chainBusy = false;
  }
}

function renderOutage() {
  const c = chain;
  const visible = serverDown() && !endedShown && c !== null && c.live;
  show("outageBox", visible);
  if (!visible || !c) return;
  const ready = c.confirmations !== null && c.confirmations >= c.limit;
  $("outageText").textContent = ready ? COPY.outage.ready : COPY.outage.waiting(c.confirmations ?? 0, c.limit);
  show("fallbackBtn", ready);
  const btn = $("fallbackBtn") as HTMLButtonElement;
  const wallet = getLocalWallet();
  btn.disabled = fallbackBusy || !wallet;
  btn.textContent = fallbackBusy ? COPY.fallback.working : COPY.fallback.button;
  $("fallbackMsg").textContent =
    fallbackNote !== ""
      ? fallbackNote
      : ready && !wallet
        ? vault.state() === "locked" ? COPY.fallback.locked : COPY.fallback.noWallet
        : "";
}

async function onFallback() {
  const wallet = getLocalWallet();
  if (fallbackBusy || !wallet) return;
  fallbackBusy = true; // before anything is awaited, so a double click cannot send twice
  fallbackNote = "";
  renderOutage();
  try {
    const out = await settleWithoutReferee(game, provider, wallet);
    fallbackNote = out.ok ? COPY.fallback.done : out.text;
    if (out.ok || out.code === "round_gone") setTimeout(() => void pollChain(), 3_000);
  } catch (e) {
    console.error(e);
    fallbackNote = COPY.fallback.failed;
  } finally {
    fallbackBusy = false;
    renderOutage();
  }
}

function grabState(): { enabled: boolean; label: string; hint: string } {
  const price = shown?.price ?? null;
  const base = price === null ? "Grab the potato" : `Grab the potato · ${formatUnits(BigInt(price), CONFIG.pusdDecimals)} PUSD`;
  const r = round;
  const rem = remainingMs();
  const timeUp =
    !!r && (r.status === "over" || r.status === "settled" || (r.status === "open" && !r.paused && rem !== null && rem <= 0));
  if (grabbing) return { enabled: false, label: base, hint: COPY.grab.sending };
  if (endedShown || timeUp) return { enabled: false, label: COPY.grab.roundOver, hint: "" };
  if (!r || net === "offline") return { enabled: false, label: base, hint: COPY.network.offline };
  if (r.paused) return { enabled: false, label: base, hint: pauseText(r.paused.reason) };
  const external = externalPkh() !== null;
  if (!external && !getLocalWallet()) {
    return { enabled: false, label: base, hint: vault.state() === "locked" ? COPY.grab.locked : COPY.grab.noWallet };
  }
  if (Date.now() < coolUntil) return { enabled: false, label: base, hint: COPY.grab.cooling };
  return { enabled: price !== null, label: base, hint: external ? COPY.external.ready : "" };
}

function renderGrab() {
  const g = grabState();
  const btn = $("grabBtn") as HTMLButtonElement;
  btn.disabled = !g.enabled;
  btn.textContent = g.label;
  show("cancelGrabBtn", grabbing && grabMode === "external");
  const noteVisible =
    note !== null &&
    (note.expires === null || Date.now() < note.expires) &&
    (note.pass === null || (shown?.passCount ?? 0) <= note.pass);
  const busyText = grabMode === "external" ? signPrompt || COPY.external.preparing : COPY.grab.sending;
  $("grabMsg").textContent = grabbing ? busyText : noteVisible && note ? note.text : g.hint;
}

async function onGrab() {
  if (grabbing || !shown || shown.price === null || !grabState().enabled) return;
  const price = BigInt(shown.price);
  const external = externalPkh(); // a wallet the player explicitly connected wins; otherwise the game wallet plays
  const local = getLocalWallet();
  if (external === null && !local) return;
  grabbing = true; // set before anything is awaited, so a double click cannot send twice
  grabMode = external !== null ? "external" : "local";
  signPrompt = "";
  note = null;
  const controller = new AbortController();
  activeGrab = controller;
  const timeout =
    external !== null ? setTimeout(() => controller.abort(new Error("Timed out waiting for your wallet")), SIGN_TIMEOUT_MS) : undefined;
  renderGrab();
  try {
    const out =
      external !== null
        ? await grabViaExternalWallet(game, provider, external, price, controller.signal, (text) => {
            signPrompt = text;
            renderGrab();
          })
        : await grabViaReferee(game, provider, local!, price);
    if (out.ok) {
      note = { text: COPY.grab.done, expires: null, pass: out.passCount };
      setTimeout(() => void refreshBalances(provider), 2_000);
      setTimeout(() => void refreshBalances(provider), 8_000);
    } else {
      note = { text: out.text, expires: Date.now() + 10_000, pass: null };
      if (out.code === "outcome_unknown") coolUntil = Date.now() + 8_000;
    }
  } catch (e) {
    console.error(e);
    note = { text: errorText("internal"), expires: Date.now() + 10_000, pass: null };
  } finally {
    clearTimeout(timeout);
    grabbing = false;
    grabMode = null;
    activeGrab = null;
    signPrompt = "";
    renderGrab();
    kick();
  }
}

async function loadEnded() {
  if (endedBusy || endedShown) return;
  endedBusy = true;
  try {
    for (let i = 0; i < 6 && !endedShown; i++) {
      const r = await findEndedRound(game, provider).catch((e) => {
        console.error(e);
        return null;
      });
      if (r) {
        renderEndedRound(r, game.gameCategory, myKeys(), getLocalWallet()?.pkhHex ?? null);
        endedShown = true;
        $("status").textContent = `Updated ${new Date().toLocaleTimeString()}`;
        break;
      }
      await sleep(3000); // the settlement may not be visible on the network yet
    }
  } finally {
    endedBusy = false;
  }
}

function applySnapshot(s: RoundSnapshot) {
  round = s;
  if (!shown || s.passCount >= shown.passCount) {
    shown = { passCount: s.passCount, king: s.king, pot: s.pot, price: s.price };
  }
  watcher?.setSeq(s.lastSeq); // the snapshot already includes every event up to here
  renderStats();
  renderClock();
  $("status").textContent = `Updated ${new Date().toLocaleTimeString()}`;
  if (s.status === "settled") void loadEnded();
}

// Instant reaction to a pushed event, then the server's snapshot confirms it
function onEvent(e: RefereeEvent) {
  const r = round;
  if (!r) {
    kick();
    return;
  }
  const d = e.data ?? {};
  if (e.type === "deadline_changed" && typeof d.deadline === "number") {
    round = { ...r, status: "open", deadline: d.deadline };
    if (typeof d.passCount === "number" && typeof d.king === "string" && shown && d.passCount === shown.passCount + 1) {
      const paid = shown.price === null ? 0n : BigInt(shown.price);
      shown = {
        passCount: d.passCount,
        king: d.king,
        pot: shown.pot === null ? null : (BigInt(shown.pot) + paid).toString(),
        price: priceFor(d.passCount).toString(),
      };
      renderStats();
    }
  } else if (e.type === "clock_paused") {
    round = { ...r, paused: { since: e.at, reason: e.reason } };
  } else if (e.type === "clock_resumed") {
    round = { ...r, paused: null, deadline: typeof d.deadline === "number" ? d.deadline : r.deadline };
  } else if (e.type === "round_over") {
    round = { ...r, status: "over" };
  } else if (e.type === "round_settled") {
    round = { ...r, status: "settled" };
  }
  renderClock();
  kick();
}

async function tick() {
  if (running) return;
  running = true;
  clearTimeout(timer);
  let ok = false;
  try {
    const res = await getRound(game.gameCategory);
    if (res.ok) {
      ok = true;
      failures = 0;
      applySnapshot(res.round);
      void refreshBalances(provider);
      if (!watcher) {
        watcher = watchRound(game.gameCategory, res.round.lastSeq, {
          onEvent,
          onResync: () => kick(),
          onStatus: (s) => {
            net = s;
            renderClock();
          },
        });
      }
    } else {
      failures++;
      $("status").textContent = res.error === "server_unreachable" ? COPY.network.offline : errorText(res.error);
      if (serverDown()) void pollChain();
    }
  } finally {
    running = false;
  }
  timer = setTimeout(() => void tick(), ok ? POLL_MS : Math.min(3000 * failures, 15_000));
}

// Reload the round soon (after an event, or when the tab comes back)
function kick() {
  clearTimeout(timer);
  timer = setTimeout(() => void tick(), 400);
}

export async function startRefereeMode() {
  // The original block-based controls do not apply here
  show("settleBtn", false);
  show("shareBtn", false);
  $("settleMsg").textContent = "";
  $("countdownAgo").textContent = "";
  $("refereeNotice").textContent = COPY.notice;
  show("refereeNotice", true);
  $("status").textContent = "Connecting to the game server…";

  provider = makeProvider();
  game = (await (await fetch(`${import.meta.env.BASE_URL}game.${CONFIG.network}.v2.json`)).json()) as GameV2;

  // The player's own wallet (WizardConnect): a second option next to the game wallet
  $("connectBtn").addEventListener("click", () => startConnection(true));
  $("cancelBtn").addEventListener("click", () => void disconnectWallet());
  $("disconnectBtn").addEventListener("click", () => void disconnectWallet());
  $("copyUri").addEventListener("click", () => {
    const uri = getWalletState().uri;
    if (uri) void navigator.clipboard.writeText(uri);
  });
  $("cancelGrabBtn").addEventListener("click", () => activeGrab?.abort(new Error("Cancelled by you")));
  setExternalVisible(externalWanted());
  $("useOwnWalletBtn").addEventListener("click", () => {
    const opening = $("wallet").classList.contains("hidden");
    setExternalVisible(opening);
    setExternalFlag(opening);
    // Hiding the option also disconnects it, so the game wallet is the active one again
    if (!opening && getWalletState().status !== "idle") void disconnectWallet();
  });
  subscribe(renderWallet);
  if (externalWanted()) resumeIfStored(); // only reconnect an old pairing if the player opted in

  onLocalWalletChange(() => renderStats());
  void initLocalWallet(provider);

  await Promise.race([syncClock(), sleep(2000)]); // the countdown must follow the server's clock
  setInterval(() => void syncClock(3), 60_000);
  setInterval(() => {
    renderClock();
    renderGrab();
  }, 250);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      void syncClock(3);
      kick();
    }
  });
  $("grabBtn").addEventListener("click", () => void onGrab());
  $("claimBtn").addEventListener("click", () => void onClaim());
  $("fallbackBtn").addEventListener("click", () => void onFallback());
  renderClock();
  renderGrab();
  void tick();
}