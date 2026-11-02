// The Kingdom page (open it with ?mode=kingdom). Step K8a: it only shows the round, it has no action buttons yet.
// The old steal page (refereeMode.ts) is untouched until the Kingdom is approved to replace it.
import type { ElectrumNetworkProvider } from "cashscript";
import { disconnectWallet, getWalletState, resumeIfStored, startConnection, subscribe } from "./bch_wallet.ts";
import type { WalletState } from "./bch_wallet.ts";
import { CONFIG } from "./config.ts";
import { COPY, errorText, pauseText } from "./copy.ts";
import { formatDuration, formatUnits } from "./lib/format.ts";
import type { GameKingdom } from "./lib/game.ts";
import { makeProvider } from "./lib/provider.ts";
import { qrDataUrl } from "./lib/qr.ts";
import { getEvents, getRound, watchRound } from "./referee/api.ts";
import type { RefereeEvent, RoundSnapshot, WatchStatus } from "./referee/api.ts";
import { serverNow, syncClock } from "./referee/clock.ts";
import { getLocalWallet, initLocalWallet, onLocalWalletChange, refreshBalances } from "./walletUI.ts";

const $ = (id: string) => document.getElementById(id)!;
const show = (id: string, visible: boolean) => $(id).classList.toggle("hidden", !visible);
// Some blocks need a display type when they are shown (the "hidden" class and "grid"/"flex" would fight otherwise)
const showAs = (id: string, display: "grid" | "flex", visible: boolean) => {
  $(id).classList.toggle("hidden", !visible);
  $(id).classList.toggle(display, visible);
};
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

// The player's own wallet (WizardConnect) card
function renderWallet(s: WalletState) {
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
    detail = COPY.kingdom.finished;
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
  renderFeed();
}

async function loadHistory() {
  const res = await getEvents(game.gameCategory, 0);
  if (!res.ok || res.resync) return;
  for (const e of res.events) feed.set(e.seq, e);
  renderFeed();
}

function applySnapshot(s: RoundSnapshot) {
  round = s;
  if (s.kingdom) lastLive = s;
  watcher?.setSeq(s.lastSeq); // the snapshot already includes every event up to here
  renderAll();
  $("status").textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

// Instant reaction to a pushed event, then the server's snapshot confirms it
function onEvent(e: RefereeEvent) {
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

export async function startKingdomMode() {
  // Swap the steal page's parts for the Kingdom's
  $("tagline").textContent = COPY.kingdom.tagline;
  show("artCard", false);
  show("stealStats", false);
  show("actions", false);
  showAs("kingdomStats", "grid", true);
  showAs("kingdomView", "flex", true);
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

  await Promise.race([syncClock(), sleep(2000)]); // the countdown must follow the server's clock
  setInterval(() => void syncClock(3), 60_000);
  setInterval(() => {
    renderClock();
    renderPreview();
  }, 250);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      void syncClock(3);
      kick();
    }
  });
  renderAll();
  void tick();
}