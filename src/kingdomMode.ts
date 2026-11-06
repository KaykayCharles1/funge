// The Kingdom page: state, price previews, event feed, the buttons to open,
// conquer and protect with either kind of wallet, the claim window, and the finished-round view.
import { hexToBin } from "@bitauth/libauth";
import type { ElectrumNetworkProvider } from "cashscript";
import kingdomJson from "../contracts/FungeKingdom.json";
import potJson from "../contracts/FungePot.json";
import { disconnectWallet, getWalletState, resumeIfStored, startConnection, subscribe } from "./bch_wallet.ts";
import type { WalletState } from "./bch_wallet.ts";
import { CONFIG } from "./config.ts";
import { COPY, errorText, pauseText } from "./copy.ts";
import { findEndedKingdom } from "./endedKingdom.ts";
import type { EndedKingdom } from "./endedKingdom.ts";
import { lockToAddress, p2pkhLock } from "./lib/chain.ts";
import { formatDuration, formatUnits } from "./lib/format.ts";
import type { GameKingdom } from "./lib/game.ts";
import { makeProvider } from "./lib/provider.ts";
import { qrDataUrl } from "./lib/qr.ts";
import { claim, getEvents, getRound, watchRound } from "./referee/api.ts";
import type { RefereeEvent, RoundSnapshot, WatchStatus } from "./referee/api.ts";
import { serverNow, shiftClockForMock, syncClock } from "./referee/clock.ts";
import { kingdomAct, kingdomProtect } from "./referee/kingdomActions.ts";
import { kingdomActExternal, kingdomProtectExternal } from "./referee/kingdomExternal.ts";
import { kingdomSettleWithoutReferee, watchKingdomChain } from "./referee/kingdomFallback.ts";
import type { KingdomChainWatch } from "./referee/kingdomFallback.ts";
import { playMockRound } from "./mockRound.ts";
import { emitSceneEvent, emitSceneSnapshot } from "./sceneBus.ts";
import { vault } from "./wallet/vault.ts";
import { getLocalWallet, initLocalWallet, onLocalWalletChange, refreshBalances } from "./walletUI.ts";

const $ = (id: string) => document.getElementById(id)!;
const show = (id: string, visible: boolean) => $(id).classList.toggle("hidden", !visible);
const shortKey = (hex: string) => `${hex.slice(0, 8)}…${hex.slice(-6)}`;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const units = (v: string | null | undefined) => (v == null ? "—" : formatUnits(BigInt(v), CONFIG.pusdDecimals));
const mmss = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const fmtClock = (ms: number) => formatDuration(Math.ceil(Math.max(0, ms) / 1000));

const CARD = "rounded-2xl p-5 ring-1";
const CARD_NORMAL = `${CARD} bg-slate-900 ring-slate-800`;
const CARD_READY = `${CARD} bg-amber-500/10 ring-amber-400`;
const POLL_MS = 20_000; // safety net: the live socket does the real work
const FEED_MAX = 12;
const SIGN_TIMEOUT_MS = 180_000; // how long we wait for the player to approve in their own wallet

// The compiled contracts, imported as JSON so the browser can build transactions
const artifacts = { pot: potJson as any, kingdom: kingdomJson as any };

type Outcome = { ok: true } | { ok: false; code: string; text: string };
type Kind = "open" | "conquer" | "protect";

let game: GameKingdom;
let provider: ElectrumNetworkProvider;
let round: RoundSnapshot | null = null;
let lastLive: RoundSnapshot | null = null; // the last snapshot that still had Kingdom details (they vanish after settlement)
let net: WatchStatus = "connecting";
let watcher: ReturnType<typeof watchRound> | null = null;
let failures = 0;
let running = false;
let lastQr = "";
let timer: ReturnType<typeof setTimeout> | undefined;
const feed = new Map<number, RefereeEvent>();

let acting = false;
let actMode: "local" | "external" | null = null;
let activeAct: AbortController | null = null;
let signPrompt = "";
let note: { text: string; expires: number } | null = null;
let coolUntil = 0; // after "outcome unknown", wait before allowing another move
let claiming = false;
let claimNote = "";
let endedShown = false;
let endedBusy = false;
let chain: KingdomChainWatch | null = null;
let chainBusy = false;
let fallbackBusy = false;
let fallbackNote = "";
let mockActive = false; // the dev-only mock round is on screen: the real server is not asked about anything
let mockShift = 0; // how far the mock moved the clock, so it can be put back
let mockRun = 0; // changes when a mock is started or stopped, so an old script notices it was cancelled
const warned = new Set<string>(); // "deadline:level" for each clock warning already raised

const serverDown = () => failures >= 2 || net === "offline";

// The player's own wallet (WizardConnect), when connected
const externalPkh = (): string | null => {
  const w = getWalletState();
  return w.status === "connected" ? w.pkhHex : null;
};
// Every key that counts as "you": the game wallet and/or a connected own wallet
const myKeys = () => [getLocalWallet()?.pkhHex, externalPkh()].filter((k): k is string => !!k);
const isMine = (key: string | null) => key !== null && myKeys().includes(key);
// The previous king is stored as the first 11 bytes of the key hash, so it is compared by prefix
const isMinePrefix = (prefix: string) => myKeys().some((k) => k.startsWith(prefix));
// The wallet that would play right now: a wallet the player explicitly connected wins; otherwise the game wallet
const actingPkh = (): string | null => externalPkh() ?? getLocalWallet()?.pkhHex ?? null;

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

function timeUp(): boolean {
  const r = round;
  if (!r) return false;
  const rem = remainingMs();
  return r.status === "over" || r.status === "settled" || (r.status === "open" && !r.paused && rem !== null && rem <= 0);
}

// The player's own wallet (WizardConnect) card
function renderWallet(s: WalletState) {
  if (s.status === "idle" && actMode === "external") activeAct?.abort(new Error("Wallet disconnected"));
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
  renderAll();
}

function renderStats() {
  const s = round?.kingdom ? round : lastLive;
  const k = s?.kingdom ?? null;
  if (!s || !k) return;
  const started = s.status === "open" || s.status === "over";
  const king = k.holder ?? s.king;
  $("kPool").textContent = units(s.pot);
  $("kValue").textContent = started ? units(k.value) : "—";
  $("kPass").textContent = started ? String(s.passCount) : "—";
  $("kKing").textContent = king === null ? COPY.kingdom.nobody : isMine(king) ? `${shortKey(king)} (${COPY.kingdom.you})` : shortKey(king);
  $("kPrev").textContent =
    k.previousKing === null ? "—" : `${k.previousKing.slice(0, 8)}…${isMinePrefix(k.previousKing) ? ` (${COPY.kingdom.you})` : ""}`;
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
    title = COPY.kingdom.waiting;
    detail = COPY.kingdom.waitingDetail;
    text = "--:--:--";
  } else {
    const rem = remainingMs() ?? 0;
    if (r.paused) {
      title = pauseText(r.paused.reason);
      detail = COPY.clock.pausedDetail;
      text = fmtClock(rem);
    } else if (r.status === "over" || rem <= 0) {
      title = COPY.kingdom.over;
      detail = r.status === "over" ? `${COPY.kingdom.overDetail} ${COPY.over.auto}` : COPY.clock.confirming; // inside the 1 s grace
      text = "00:00:00";
      ready = true;
    } else {
      title = COPY.kingdom.running;
      detail = COPY.kingdom.runningDetail;
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
  const s = round?.kingdom ? round : lastLive;
  const king = s?.kingdom?.holder ?? s?.king ?? null;
  const iAmKing = isMine(king);
  const pool = units(s?.pot);
  $("overTitle").textContent = COPY.over.title;
  $("overText").textContent = iAmKing
    ? COPY.kingdom.overYouWin(pool)
    : `${COPY.kingdom.overSomeone(pool, king ? shortKey(king) : "the last king")} ${COPY.over.auto}`;
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
    const c = await watchKingdomChain(game, provider);
    chain = c;
    if (!c.live) void loadEnded(); // the state coin is gone: the round was settled, show the result from the chain
    renderOutage();
  } catch (e) {
    console.error(e);
  } finally {
    chainBusy = false;
  }
}

// If the server stays down, anyone can settle without it after enough quiet blocks. The contract still pays the last king.
function renderOutage() {
  const c = chain;
  const visible = serverDown() && !endedShown && c !== null && c.live && c.passCount >= 1;
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
    const out = await kingdomSettleWithoutReferee(game, provider, wallet, artifacts);
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

// What the next move costs, and what protecting looks like right now
function renderPreview() {
  const r = round;
  const k = r?.kingdom ?? null;
  let preview = "";
  let protects = "";
  let walls = false;
  let protectClock = "";
  let nextClock = "";
  if (r && r.status === "settled") {
    preview = COPY.kingdom.finished;
  } else if (r && k) {
    const king = k.holder ?? r.king;
    if (r.status === "waiting") {
      preview = COPY.kingdom.openPreview(units(k.openingPrice));
    } else if (r.status === "open") {
      if (isMine(king)) {
        preview = COPY.kingdom.youAreKing;
      } else if (k.conquest) {
        const c = k.conquest;
        preview =
          k.previousKing !== null && isMinePrefix(k.previousKing)
            ? COPY.kingdom.takeBack(units(c.pay))
            : COPY.kingdom.conquestPreview(units(c.pay), units(c.kingGets), units(c.poolGets));
      }
      protects = COPY.kingdom.protectsLeft(k.protectsLeft, k.protectsPerReign);
      walls = k.wallsAtMaximum;
      if (k.protectsLeft > 0 && !k.wallsAtMaximum) {
        const rem = remainingMs();
        if (rem !== null) {
          const closesIn = rem - k.protectLockoutSeconds * 1000;
          protectClock = closesIn > 0 ? COPY.kingdom.protectCloses(mmss(Math.ceil(closesIn / 1000))) : COPY.kingdom.protectClosed;
        }
      }
    }
    if ((r.status === "waiting" || r.status === "open") && k.nextClockSeconds !== null) {
      nextClock = COPY.kingdom.nextClock(mmss(k.nextClockSeconds));
    }
  }
  $("kPreview").textContent = preview;
  show("kPreview", preview !== "");
  $("kProtects").textContent = protects;
  show("kProtects", protects !== "");
  $("kWalls").textContent = COPY.kingdom.wallsMax;
  show("kWalls", walls);
  $("kProtectClock").textContent = protectClock;
  show("kProtectClock", protectClock !== "");
  $("kNextClock").textContent = nextClock;
  show("kNextClock", nextClock !== "");
}

// The main button: open (first player), conquer, or take back the throne
function actState(): { enabled: boolean; label: string; hint: string } {
  const r = round;
  const k = r?.kingdom ?? null;
  if (!r || !k) return { enabled: false, label: "…", hint: "" };
  const king = k.holder ?? r.king;
  const mine = actingPkh() !== null && king === actingPkh();
  let label: string = COPY.kingdom.roundOver;
  if (r.status === "waiting") label = COPY.kingdom.openBtn(units(k.openingPrice));
  else if (r.status === "open" && k.conquest) {
    label = mine
      ? COPY.kingdom.youKingBtn
      : k.previousKing !== null && isMinePrefix(k.previousKing)
        ? COPY.kingdom.takeBackBtn(units(k.conquest.pay))
        : COPY.kingdom.conquerBtn(units(k.conquest.pay));
  }
  if (acting) return { enabled: false, label, hint: COPY.kingdom.sending };
  if (endedShown || timeUp()) return { enabled: false, label: COPY.kingdom.roundOver, hint: "" };
  if (net === "offline") return { enabled: false, label, hint: COPY.network.offline };
  if (r.paused) return { enabled: false, label, hint: pauseText(r.paused.reason) };
  const external = externalPkh() !== null;
  if (!external && !getLocalWallet()) {
    return { enabled: false, label, hint: vault.state() === "locked" ? COPY.grab.locked : COPY.grab.noWallet };
  }
  if (Date.now() < coolUntil) return { enabled: false, label, hint: COPY.grab.cooling };
  if (r.status === "open" && mine) return { enabled: false, label, hint: "" };
  const playable = r.status === "waiting" || (r.status === "open" && k.conquest !== null);
  return { enabled: playable, label, hint: external ? COPY.external.ready : "" };
}

function renderActions() {
  const r = round;
  const k = r?.kingdom ?? null;
  const a = actState();
  const btn = $("kActBtn") as HTMLButtonElement;
  btn.disabled = !a.enabled;
  btn.textContent = a.label;
  show("kCancelBtn", acting && actMode === "external");
  const noteVisible = note !== null && Date.now() < note.expires;
  const busyText = actMode === "external" ? signPrompt || COPY.external.preparing : COPY.kingdom.sending;
  $("kActMsg").textContent = acting ? busyText : noteVisible && note ? note.text : a.hint;

  // Protect: only the king, only while the round runs
  const king = k ? (k.holder ?? r?.king ?? null) : null;
  const acts = actingPkh();
  const showProtect = !!r && !!k && r.status === "open" && !endedShown && acts !== null && king === acts;
  show("kProtectBox", showProtect);
  if (!showProtect || !k) return;
  $("kProtectTitle").textContent = COPY.kingdom.protectTitle;
  const rem = remainingMs();
  const closed = rem !== null && rem - k.protectLockoutSeconds * 1000 <= 0;
  const blocked = acting || !!r?.paused || closed || timeUp() || net === "offline" || Date.now() < coolUntil || k.protectsLeft <= 0;
  [0, 1, 2].forEach((i) => {
    const amount = k.protectAmounts[i];
    const b = $(`kProt${i}`) as HTMLButtonElement;
    if (amount === undefined) {
      b.disabled = true;
      return;
    }
    b.textContent = COPY.kingdom.protectBtn(units(amount));
    b.disabled = blocked || BigInt(k.value) + BigInt(amount) > BigInt(k.cap);
  });
  $("kProtectMsg").textContent = closed
    ? COPY.kingdom.protectClosed
    : k.protectsLeft <= 0
      ? COPY.errors.no_protects_left
      : k.wallsAtMaximum
        ? COPY.kingdom.wallsMax
        : COPY.kingdom.protectHint;
}

// Open, conquer or protect with whichever wallet is playing. `amount` is the price the player agreed to (open, conquer)
// or the protect amount. Nothing is spent beyond it: the helpers re-check the chain and refuse a changed price.
async function run(kind: Kind, amount: bigint) {
  if (acting || mockActive) return; // never spend anything while the mock round is showing
  const external = externalPkh();
  const local = getLocalWallet();
  if (external === null && !local) return;
  acting = true; // set before anything is awaited, so a double click cannot send twice
  actMode = external !== null ? "external" : "local";
  signPrompt = "";
  note = null;
  const controller = new AbortController();
  activeAct = controller;
  const timeout =
    external !== null ? setTimeout(() => controller.abort(new Error("Timed out waiting for your wallet")), SIGN_TIMEOUT_MS) : undefined;
  renderActions();
  try {
    let out: Outcome;
    const onPrompt = (text: string) => {
      signPrompt = text;
      renderActions();
    };
    if (kind === "protect") {
      out =
        external !== null
          ? await kingdomProtectExternal({ game, provider, walletPkhHex: external, amount, artifacts, signal: controller.signal, onPrompt })
          : await kingdomProtect({ game, provider, wallet: local!, amount, artifacts });
    } else {
      out =
        external !== null
          ? await kingdomActExternal({
              game, provider, walletPkhHex: external, action: kind, expectedPay: amount, artifacts, signal: controller.signal, onPrompt,
            })
          : await kingdomAct({ game, provider, wallet: local!, action: kind, expectedPay: amount, artifacts });
    }
    if (out.ok) {
      const text = kind === "open" ? COPY.kingdom.doneOpen : kind === "conquer" ? COPY.kingdom.doneConquer : COPY.kingdom.doneProtect;
      note = { text, expires: Date.now() + 8_000 };
      setTimeout(() => void refreshBalances(provider), 2_000);
      setTimeout(() => void refreshBalances(provider), 8_000);
    } else {
      note = { text: out.text, expires: Date.now() + 10_000 };
      if (out.code === "outcome_unknown") coolUntil = Date.now() + 8_000;
    }
  } catch (e) {
    console.error(e);
    note = { text: errorText("internal"), expires: Date.now() + 10_000 };
  } finally {
    clearTimeout(timeout);
    acting = false;
    actMode = null;
    activeAct = null;
    signPrompt = "";
    renderActions();
    kick();
    setTimeout(kick, 6_000);
  }
}

function onAct() {
  const r = round;
  const k = r?.kingdom ?? null;
  if (acting || !r || !k || !actState().enabled) return;
  if (r.status === "waiting") void run("open", BigInt(k.openingPrice));
  else if (k.conquest) void run("conquer", BigInt(k.conquest.pay));
}

function onProtect(i: number) {
  const k = round?.kingdom ?? null;
  const amount = k?.protectAmounts[i];
  if (acting || !k || amount === undefined || ($(`kProt${i}`) as HTMLButtonElement).disabled) return;
  void run("protect", BigInt(amount));
}

// One friendly line for each thing the server tells us. Events we have no wording for are not shown.
function describe(e: RefereeEvent): string | null {
  const d = e.data ?? {};
  const king = typeof d.king === "string" ? d.king : null;
  const who = king === null ? COPY.kingdom.someone : isMine(king) ? COPY.kingdom.youCap : shortKey(king);
  try {
    if (e.type === "deadline_changed") {
      const clock = typeof d.clockSeconds === "number" ? mmss(d.clockSeconds) : "";
      if (e.reason === "open") return COPY.kingdom.feedOpened(who, clock);
      if (e.reason === "conquer") return COPY.kingdom.feedConquered(who, Number(d.passCount), clock);
      return null;
    }
    if (e.type === "protect_applied") {
      return COPY.kingdom.feedProtected(who, units(String(d.amount)), units(String(d.value)));
    }
  } catch {
    return null;
  }
  if (e.type === "clock_paused") return COPY.kingdom.feedPaused;
  if (e.type === "clock_resumed") return COPY.kingdom.feedResumed;
  if (e.type === "round_over") return COPY.kingdom.feedOver;
  if (e.type === "round_settled") return COPY.kingdom.feedSettled;
  return null;
}

function renderFeed() {
  $("kFeedTitle").textContent = COPY.kingdom.feedTitle;
  const list = $("kFeed");
  list.replaceChildren();
  const lines = [...feed.values()]
    .sort((a, b) => b.seq - a.seq)
    .map((e) => ({ e, text: describe(e) }))
    .filter((x): x is { e: RefereeEvent; text: string } => x.text !== null)
    .slice(0, FEED_MAX);
  if (lines.length === 0) {
    const li = document.createElement("li");
    li.textContent = COPY.kingdom.feedEmpty;
    list.append(li);
    return;
  }
  for (const { e, text } of lines) {
    const li = document.createElement("li");
    const when = document.createElement("span");
    when.className = "mr-2 font-mono text-xs text-slate-500";
    when.textContent = new Date(e.at).toLocaleTimeString();
    li.append(when, document.createTextNode(text));
    list.append(li);
  }
}

function renderAll() {
  renderStats();
  renderClock();
  renderPreview();
  renderActions();
  renderFeed();
}

// The finished-round screen
function renderEnded(r: EndedKingdom) {
  show("live", false);
  show("ended", true);
  const mine = myKeys().includes(r.winnerPkh);
  const alone = r.passes === 1; // nobody challenged the first king: the pool went back to them
  const winner = lockToAddress(p2pkhLock(hexToBin(r.winnerPkh)), false);
  $("endedTitle").textContent = alone
    ? mine ? COPY.kingdom.aloneMine : COPY.kingdom.aloneOther
    : mine ? COPY.kingdom.wonTitle : COPY.kingdom.otherWonTitle;
  $("endedWinner").textContent = mine ? `${winner} (${COPY.kingdom.you})` : winner;
  $("endedPot").textContent = `${formatUnits(r.potPaid, CONFIG.pusdDecimals)} PUSD`;
  $("endedPassesLabel").textContent = COPY.kingdom.endedKings;
  $("endedPasses").textContent = String(r.passes);
  $("endedTrophy").textContent =
    getLocalWallet()?.pkhHex === r.winnerPkh ? COPY.kingdom.trophyGame : mine ? COPY.kingdom.trophyMine : COPY.kingdom.trophyOther;
  $("endedTx").textContent = `Settlement transaction: ${r.settleTxid}${r.confirmed ? "" : " (waiting for confirmation)"}`;
}

async function loadEnded() {
  if (endedBusy || endedShown) return;
  endedBusy = true;
  try {
    for (let i = 0; i < 6 && !endedShown; i++) {
      const r = await findEndedKingdom(game, provider).catch((e) => {
        console.error(e);
        return null;
      });
      if (r) {
        renderEnded(r);
        endedShown = true;
        show("overModal", false);
        $("status").textContent = `Updated ${new Date().toLocaleTimeString()}`;
        break;
      }
      await sleep(3000); // the settlement may not be visible on the network yet
    }
  } finally {
    endedBusy = false;
  }
}

async function loadHistory() {
  const res = await getEvents(game.gameCategory, 0);
  if (!res.ok || res.resync) return;
  for (const e of res.events) feed.set(e.seq, e);
  renderFeed();
}

function applySnapshot(s: RoundSnapshot) {
  round = s;
  emitSceneSnapshot(s, mockActive ? "mock" : "server");
  if (s.kingdom) lastLive = s;
  watcher?.setSeq(s.lastSeq); // the snapshot already includes every event up to here
  renderAll();
  $("status").textContent = `Updated ${new Date().toLocaleTimeString()}`;
  if (s.status === "settled" && !mockActive) void loadEnded();
}

// Instant reaction to a pushed event, then the server's snapshot confirms it
function onEvent(e: RefereeEvent) {
  emitSceneEvent(e, mockActive ? "mock" : "server");
  feed.set(e.seq, e);
  const r = round;
  if (r) {
    const d = e.data ?? {};
    if (e.type === "deadline_changed" && typeof d.deadline === "number") round = { ...r, status: "open", deadline: d.deadline };
    else if (e.type === "clock_paused") round = { ...r, paused: { since: e.at, reason: e.reason } };
    else if (e.type === "clock_resumed") {
      round = { ...r, paused: null, deadline: typeof d.deadline === "number" ? d.deadline : r.deadline };
    } else if (e.type === "round_over") round = { ...r, status: "over" };
    else if (e.type === "round_settled") round = { ...r, status: "settled" };
  }
  renderAll();
  kick();
}

// The page raises a "clock_warning" event when the countdown first reaches 60, 30 and 10 seconds. The server has no such
// event: it only sets the deadline, and every device counts down on its own against the server's clock.
const WARNING_LEVELS = [60, 30, 10];
function checkClockWarnings() {
  const r = round;
  if (!r || r.status !== "open" || r.paused || r.deadline === null) return;
  const rem = remainingMs();
  if (rem === null || rem <= 0) return;
  const level = WARNING_LEVELS.find((l, i) => rem <= l * 1000 && (WARNING_LEVELS[i + 1] === undefined || rem > WARNING_LEVELS[i + 1]! * 1000));
  if (level === undefined) return;
  const key = `${r.deadline}:${level}`;
  if (warned.has(key)) return;
  warned.add(key);
  for (const higher of WARNING_LEVELS.filter((l) => l > level)) warned.add(`${r.deadline}:${higher}`); // a jump past a level raises one warning, not two
  const k = r.kingdom ?? null;
  emitSceneEvent(
    {
      seq: 0, roundId: r.gameId, at: serverNow(), type: "clock_warning", reason: `${level}s`,
      data: {
        level, remainingMs: Math.round(rem), deadline: r.deadline, king: r.king, previousKing: k?.previousKing ?? null,
        passCount: r.passCount, conquests: Math.max(0, r.passCount - 1), value: k?.value ?? null, treasury: r.pot,
        protectsLeft: k?.protectsLeft ?? 0, clockSeconds: k?.clockSeconds ?? null, nextClockSeconds: k?.nextClockSeconds ?? null,
      },
    },
    mockActive ? "mock" : "client",
  );
}

// Dev page only: replay a scripted round through the same handlers that real events use
async function startMock(label: (t: string) => void) {
  mockActive = true;
  const me = ++mockRun;
  clearTimeout(timer);
  watcher?.close();
  watcher = null;
  feed.clear();
  warned.clear();
  round = null;
  await playMockRound({
    now: serverNow,
    shiftClock: (ms) => {
      mockShift += ms;
      shiftClockForMock(ms);
    },
    onEvent,
    onSnapshot: applySnapshot,
    sleep,
    cancelled: () => me !== mockRun,
    label,
  });
}
function stopMock() {
  mockRun++;
  shiftClockForMock(-mockShift);
  mockShift = 0;
  mockActive = false;
  feed.clear();
  warned.clear();
  round = null;
  renderAll();
  kick();
}
function installMockButton() {
  if (!import.meta.env.DEV) return; // not part of the production build
  const bar = document.createElement("div");
  bar.className = "fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded-xl bg-slate-800 px-3 py-2 text-xs text-slate-200 ring-1 ring-slate-600";
  const text = document.createElement("span");
  text.textContent = "Dev: mock round";
  const play = document.createElement("button");
  play.id = "mockPlayBtn";
  play.className = "rounded-lg bg-amber-500 px-3 py-1 font-semibold text-slate-900";
  play.textContent = "Play mock round";
  const stop = document.createElement("button");
  stop.id = "mockStopBtn";
  stop.className = "hidden rounded-lg bg-slate-600 px-3 py-1";
  stop.textContent = "Back to the real round";
  play.addEventListener("click", () => {
    play.disabled = true;
    show("mockStopBtn", true);
    void startMock((t) => (text.textContent = t)).finally(() => (play.disabled = false));
  });
  stop.addEventListener("click", () => {
    stopMock();
    text.textContent = "Dev: mock round";
    stop.classList.add("hidden");
  });
  bar.append(text, play, stop);
  document.body.append(bar);
}

async function tick() {
  if (running || mockActive) return;
  running = true;
  clearTimeout(timer);
  let ok = false;
  try {
    const res = await getRound(game.gameCategory);
    if (res.ok) {
      ok = true;
      failures = 0;
      if (res.round.kind !== "kingdom") {
        $("status").textContent = "The game server is not running this Kingdom round. Restart it after deploying.";
      } else {
        applySnapshot(res.round);
        void refreshBalances(provider);
        if (!watcher) {
          await loadHistory(); // after the first snapshot, so no event can fall between the two
          watcher = watchRound(game.gameCategory, res.round.lastSeq, {
            onEvent,
            onResync: () => {
              feed.clear();
              void loadHistory();
              kick();
            },
            onStatus: (s) => {
              net = s;
              renderClock();
            },
          });
        }
      }
    } else {
      failures++;
      $("status").textContent = res.error === "server_unreachable" ? COPY.network.offline : errorText(res.error);
      renderClock();
      if (serverDown()) void pollChain();
    }
  } finally {
    running = false;
  }
  timer = setTimeout(() => void tick(), ok ? POLL_MS : Math.min(3000 * failures, 15_000));
}

// Reload the round soon (after an event, or when the tab comes back)
function kick() {
  if (mockActive) return;
  clearTimeout(timer);
  timer = setTimeout(() => void tick(), 400);
}

export async function startKingdomMode() {
  mountBattlefieldIfAsked(); // battlefield block at the end of this file
  $("tagline").textContent = COPY.kingdom.tagline;
  $("refereeNotice").textContent = COPY.notice;
  show("refereeNotice", true);
  $("status").textContent = "Connecting to the game server…";

  provider = makeProvider();
  game = (await (await fetch(`${import.meta.env.BASE_URL}game.${CONFIG.network}.kingdom.json`)).json()) as GameKingdom;

  // The player's own wallet (WizardConnect): a second option next to the game wallet
  $("connectBtn").addEventListener("click", () => startConnection(true));
  $("cancelBtn").addEventListener("click", () => void disconnectWallet());
  $("disconnectBtn").addEventListener("click", () => void disconnectWallet());
  $("copyUri").addEventListener("click", () => {
    const uri = getWalletState().uri;
    if (uri) void navigator.clipboard.writeText(uri);
  });
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

  onLocalWalletChange(renderAll);
  void initLocalWallet(provider);

  $("kActBtn").addEventListener("click", onAct);
  $("kCancelBtn").addEventListener("click", () => activeAct?.abort(new Error("Cancelled by you")));
  [0, 1, 2].forEach((i) => $(`kProt${i}`).addEventListener("click", () => onProtect(i)));
  $("claimBtn").addEventListener("click", () => void onClaim());
  $("fallbackBtn").addEventListener("click", () => void onFallback());

  await Promise.race([syncClock(), sleep(2000)]); // the countdown must follow the server's clock
  setInterval(() => void syncClock(3), 60_000);
  setInterval(() => {
    renderClock();
    renderPreview();
    renderActions();
    checkClockWarnings();
  }, 250);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      void syncClock(3);
      kick();
    }
  });
  renderAll();
  installMockButton();
  void tick();
}

// ---- Battlefield (docs/ANIMATION_BRIEF.md). Every battlefield hook in this file lives in this block. ----
// Only ?mode=battlefield (with CONFIG.battlefield on) downloads it, so the normal page never loads Phaser.
function mountBattlefieldIfAsked() {
  if (!CONFIG.battlefield || new URLSearchParams(location.search).get("mode") !== "battlefield") return;
  // A placeholder while the battlefield's code downloads; the battlefield's own loading screen replaces it
  const boot = document.createElement("div");
  boot.id = "battlefield-boot";
  boot.className = "mx-auto flex aspect-video w-full max-w-5xl items-center justify-center rounded-2xl bg-[#0f1a33] text-lg font-bold text-[#f4ead2]";
  boot.textContent = COPY.battlefield.loading;
  document.body.prepend(boot);
  import("./battlefield/index.ts")
    // "you" (both wallets), and the page's own state and handlers for the action bar (see battlefieldPage below)
    .then((m) => m.mountBattlefield({ myKeys, page: battlefieldPage, run: battlefieldDo }))
    .catch((e) => console.error("battlefield failed to load:", e instanceof Error ? e.message : String(e)));
}

// Dev only: the battlefield's extra mock scenarios (src/battlefield/mockScenarios.ts) play through the same
// doors as the mock round above: the page's event and snapshot handlers, its clock and its cancel check.
export async function playMockScenario(play: (h: Parameters<typeof playMockRound>[0]) => Promise<void>, label: (t: string) => void): Promise<void> {
  if (!import.meta.env.DEV) return;
  mockActive = true;
  const me = ++mockRun;
  clearTimeout(timer);
  watcher?.close();
  watcher = null;
  feed.clear();
  warned.clear();
  round = null;
  await play({
    now: serverNow,
    shiftClock: (ms) => {
      mockShift += ms;
      shiftClockForMock(ms);
    },
    onEvent,
    onSnapshot: applySnapshot,
    sleep,
    cancelled: () => me !== mockRun,
    label,
  });
}
export function stopMockScenario(): void {
  if (import.meta.env.DEV && mockActive) stopMock();
}

// The battlefield's action bar (src/battlefield/actions.ts) shows this page's own state and calls this page's own
// handlers. It holds no rules and no transaction code of its own: what is allowed, the price guard, the signing
// with either wallet, the referee requests and the error texts all stay here, exactly as the old buttons use them.
let bfActStartedAt = 0; // when the battlefield started a move, for "Approve in your wallet · time left"
export function battlefieldPage() {
  const protectBtn = (i: number) => document.getElementById(`kProt${i}`) as HTMLButtonElement | null;
  const pusdText = document.getElementById("lwPusd")?.textContent ?? "";
  const m = /^(\d+)\.(\d{2}) PUSD$/.exec(pusdText);
  return {
    round,
    mock: mockActive,
    ended: endedShown,
    net,
    act: actState(), // { enabled, label, hint } as the old main button shows it
    actingPkh: actingPkh(),
    previousKingIsMine: !!round?.kingdom?.previousKing && isMinePrefix(round.kingdom.previousKing),
    kingIsMine: isMine(round?.kingdom?.holder ?? round?.king ?? null),
    busy: acting,
    external: actMode === "external",
    signPrompt,
    signLeftMs: acting && actMode === "external" ? Math.max(0, SIGN_TIMEOUT_MS - (Date.now() - bfActStartedAt)) : null,
    note: note !== null && Date.now() < note.expires ? note.text : null,
    // Each protect button exactly as the old page enabled it
    protect: [0, 1, 2].map((i) => ({
      amount: round?.kingdom?.protectAmounts[i] ?? null,
      enabled: !document.getElementById("kProtectBox")?.classList.contains("hidden") && protectBtn(i)?.disabled === false,
    })),
    claiming,
    claimNote,
    wallet: {
      game: getLocalWallet() !== null,
      vault: vault.state(), // "none" | "locked" | "unlocked"
      externalName: externalPkh() !== null ? getWalletState().walletName : null,
      pusdText,
      bchText: document.getElementById("lwBch")?.textContent ?? "",
      pusd: m ? BigInt(m[1] + m[2]) : null, // game wallet PUSD in base units, when shown
    },
  };
}
export const battlefieldDo = {
  act: () => {
    bfActStartedAt = Date.now();
    onAct();
  },
  protect: (i: number) => {
    bfActStartedAt = Date.now();
    onProtect(i);
  },
  claim: () => void onClaim(),
  cancel: () => activeAct?.abort(new Error("Cancelled by you")),
};

