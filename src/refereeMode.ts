import type { ElectrumNetworkProvider } from "cashscript";
import { CONFIG } from "./config.ts";
import { COPY, errorText, pauseText } from "./copy.ts";
import { findEndedRound } from "./ended.ts";
import { renderEndedRound } from "./endedView.ts";
import { frameSvg, svgToDataUrl } from "./lib/art.ts";
import { formatDuration, formatUnits } from "./lib/format.ts";
import type { GameV2 } from "./lib/game.ts";
import { makeProvider } from "./lib/provider.ts";
import { getRound, watchRound } from "./referee/api.ts";
import type { RefereeEvent, RoundSnapshot, WatchStatus } from "./referee/api.ts";
import { serverNow, syncClock } from "./referee/clock.ts";
import { getLocalWallet, initLocalWallet, onLocalWalletChange, refreshBalances } from "./walletUI.ts";
import { grabViaReferee } from "./referee/grab.ts";
import { vault } from "./wallet/vault.ts";


const $ = (id: string) => document.getElementById(id)!;
const show = (id: string, visible: boolean) => $(id).classList.toggle("hidden", !visible);
const shortKey = (hex: string) => `${hex.slice(0, 8)}…${hex.slice(-6)}`;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const CARD = "rounded-2xl p-5 ring-1";
const CARD_NORMAL = `${CARD} bg-slate-900 ring-slate-800`;
const CARD_READY = `${CARD} bg-amber-500/10 ring-amber-400`;
const POLL_MS = 20_000; // safety net: the live socket does the real work

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
let coolUntil = 0; // after "outcome unknown", wait before allowing another grab
let note: { text: string; expires: number | null; pass: number | null } | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

const priceFor = (pass: number) => BigInt(game.params.basePrice) + BigInt(game.params.priceStep) * BigInt(pass);
const fmtClock = (ms: number) => formatDuration(Math.ceil(Math.max(0, ms) / 1000));
const myKeys = () => [getLocalWallet()?.pkhHex].filter((k): k is string => !!k);

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
  const mine = s.king !== null && getLocalWallet()?.pkhHex === s.king;
  $("holder").textContent = s.king === null ? "No one yet" : mine ? `${shortKey(s.king)} (you)` : shortKey(s.king);
  if (artPass !== s.passCount) {
    artPass = s.passCount;
    ($("art") as HTMLImageElement).src = svgToDataUrl(
      frameSvg({ passCount: s.passCount, holderPkh: s.king ?? game.creatorPkh, gameCategory: game.gameCategory }),
    );
    $("artCaption").textContent = `Pass ${s.passCount} · pot ${s.pot === null ? "…" : formatUnits(BigInt(s.pot), dec)} PUSD`;
  }
  renderGrab();
}

function renderClock() {
  if (endedShown) return;
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
    title = "Connecting to the game server…";
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
  if (!getLocalWallet()) {
    return { enabled: false, label: base, hint: vault.state() === "locked" ? COPY.grab.locked : COPY.grab.noWallet };
  }
  if (Date.now() < coolUntil) return { enabled: false, label: base, hint: COPY.grab.cooling };
  return { enabled: price !== null, label: base, hint: "" };
}

function renderGrab() {
  const g = grabState();
  const btn = $("grabBtn") as HTMLButtonElement;
  btn.disabled = !g.enabled;
  btn.textContent = g.label;
  const noteVisible =
    note !== null &&
    (note.expires === null || Date.now() < note.expires) &&
    (note.pass === null || (shown?.passCount ?? 0) <= note.pass);
  $("grabMsg").textContent = grabbing ? COPY.grab.sending : noteVisible && note ? note.text : g.hint;
}

async function onGrab() {
  const wallet = getLocalWallet();
  if (grabbing || !wallet || !shown || shown.price === null || !grabState().enabled) return;
  grabbing = true; // set before anything is awaited, so a double click cannot send twice
  note = null;
  renderGrab();
  try {
    const out = await grabViaReferee(game, provider, wallet, BigInt(shown.price));
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
    grabbing = false;
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
      })
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
  show("useOwnWalletBtn", false);
  show("wallet", false);
  show("shareBtn", false);
  $("settleMsg").textContent = "";
  $("countdownAgo").textContent = "";
  $("refereeNotice").textContent = COPY.notice;
  show("refereeNotice", true);
  $("status").textContent = "Connecting to the game server…";

  provider = makeProvider();
  game = (await (await fetch(`${import.meta.env.BASE_URL}game.${CONFIG.network}.v2.json`)).json()) as GameV2;

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
  renderClock();
  renderGrab();
  void tick();
}