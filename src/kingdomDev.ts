// Developer test page for the Kingdom with a WizardConnect wallet (kingdom-dev.html). Not part of the real game page.
import potJson from "../contracts/FungePot.json";
import kingdomJson from "../contracts/FungeKingdom.json";
import { disconnectWallet, getWalletState, startConnection, subscribe } from "./bch_wallet.ts";
import type { WalletState } from "./bch_wallet.ts";
import { CONFIG } from "./config.ts";
import { formatUnits } from "./lib/format.ts";
import type { GameKingdom } from "./lib/game.ts";
import { makeProvider } from "./lib/provider.ts";
import { qrDataUrl } from "./lib/qr.ts";
import { installSafeConsole } from "./lib/safeLog.ts";
import { getRound } from "./referee/api.ts";
import type { RoundSnapshot } from "./referee/api.ts";
import { kingdomActExternal, kingdomProtectExternal } from "./referee/kingdomExternal.ts";

installSafeConsole();

const $ = (id: string) => document.getElementById(id)!;
const show = (id: string, visible: boolean) => $(id).classList.toggle("hidden", !visible);
const short = (hex: string) => `${hex.slice(0, 8)}…${hex.slice(-6)}`;
const units = (v: string | null | undefined) => (v == null ? "—" : formatUnits(BigInt(v), CONFIG.pusdDecimals));
const SIGN_TIMEOUT_MS = 180_000;

const provider = makeProvider();
const artifacts = { pot: potJson as any, kingdom: kingdomJson as any };
let game: GameKingdom;
let round: RoundSnapshot | null = null;
let fetchedAt = 0;
let busy = false;
let prompt = "";
let controller: AbortController | null = null;

function log(text: string) {
  $("log").textContent = `${new Date().toLocaleTimeString()}  ${text}\n${$("log").textContent ?? ""}`;
}

const me = (): string | null => {
  const w = getWalletState();
  return w.status === "connected" ? w.pkhHex : null;
};

function renderWallet(w: WalletState) {
  show("walletIdle", w.status === "idle");
  show("walletWaiting", w.status === "waiting");
  show("walletConnected", w.status === "connected");
  if (w.qrUri) {
    ($("qr") as HTMLImageElement).src = qrDataUrl(w.qrUri);
    show("qr", true);
  } else show("qr", false);
  $("walletName").textContent = w.walletName ?? "";
  $("walletKey").textContent = w.pkhHex ? `King address key: ${w.pkhHex}` : "";
  $("walletError").textContent = w.error ?? "";
  renderAct();
}

function remainingMs(): number | null {
  if (!round || round.remainingMs === null) return null;
  return round.paused ? round.remainingMs : round.remainingMs - (Date.now() - fetchedAt);
}

function actState(): { label: string; enabled: boolean; hint: string } {
  const k = round?.kingdom;
  if (!round || !k) return { label: "…", enabled: false, hint: "" };
  if (busy) return { label: "Working…", enabled: false, hint: prompt };
  if (me() === null) return { label: "Connect a wallet first", enabled: false, hint: "" };
  if (round.status === "waiting") return { label: `Open the kingdom (${units(k.openingPrice)} PUSD)`, enabled: true, hint: "" };
  if (round.status === "open" && k.conquest) {
    if (round.king === me()) return { label: "You are the king", enabled: false, hint: "" };
    return { label: `Conquer (${units(k.conquest.pay)} PUSD)`, enabled: true, hint: "" };
  }
  return { label: `Round is ${round.status}`, enabled: false, hint: "" };
}

function renderAct() {
  const a = actState();
  ($("actBtn") as HTMLButtonElement).disabled = !a.enabled;
  $("actBtn").textContent = a.label;
  $("actMsg").textContent = a.hint;
  show("cancelActBtn", busy);
}

let protectKey = ""; // the buttons are only rebuilt when they change, so a click is never lost to a redraw

function renderProtect() {
  const k = round?.kingdom;
  const row = $("protectRow");
  const isKing = !!round && round.status === "open" && round.king !== null && round.king === me();
  if (!k || !isKing) {
    $("protectInfo").textContent = "";
    if (protectKey !== "") row.textContent = "";
    protectKey = "";
    return;
  }
  const closesIn = k.protectClosesInMs === null ? null : k.protectClosesInMs - (Date.now() - fetchedAt);
  const closed = closesIn !== null && closesIn <= 0;
  $("protectInfo").textContent = k.wallsAtMaximum
    ? "Walls at maximum."
    : k.protectsLeft === 0
      ? "No protects left in this reign."
      : closed
        ? "Protect is closed for the last seconds of the clock."
        : `Protects left: ${k.protectsLeft}. ${closesIn === null ? "" : `Protect closes in ${Math.ceil(closesIn / 1000)} s.`}`;
  const amounts = closed ? [] : k.protectAmounts;
  const key = `${busy}|${amounts.join(",")}`;
  if (key === protectKey) return;
  protectKey = key;
  row.textContent = "";
  for (const a of amounts) {
    const b = document.createElement("button");
    b.className = "small";
    b.textContent = `Protect +${units(a)}`;
    b.disabled = busy;
    b.addEventListener("click", () => void onProtect(BigInt(a)));
    row.appendChild(b);
  }
}

function renderRound() {
  if (!round || !round.kingdom) return;
  const k = round.kingdom;
  $("round").textContent = `${round.status}, pass ${round.passCount}${round.chainStale ? " (chain view stale)" : ""}`;
  const mine = round.king !== null && round.king === me();
  $("king").textContent = round.king ? `${short(round.king)}${mine ? "  (you)" : ""}` : "nobody yet";
  $("value").textContent = `${units(k.value)} PUSD (cap ${units(k.cap)})`;
  $("pot").textContent = `${units(round.pot)} PUSD`;
  $("price").textContent = round.status === "waiting" ? `${units(k.openingPrice)} (opening)` : `${units(k.conquest?.pay)} PUSD`;
  const ms = remainingMs();
  $("clock").textContent =
    ms === null ? `next clock ${k.nextClockSeconds ?? "—"} s` : `${Math.ceil(Math.max(0, ms) / 1000)} s${round.paused ? " (paused)" : ""}`;
  $("protects").textContent = `${k.protectsLeft} of ${k.protectsPerReign}`;
  renderAct();
  renderProtect();
}

async function poll() {
  const res = await getRound(game.gameCategory);
  if (res.ok) {
    round = res.round;
    fetchedAt = Date.now();
    $("status").textContent = `Updated ${new Date().toLocaleTimeString()}`;
    renderRound();
  } else {
    $("status").textContent = `Server: ${res.error}`;
  }
}

async function onAct() {
  const w = me();
  const k = round?.kingdom;
  if (busy || !w || !round || !k) return;
  const action = round.status === "waiting" ? "open" : "conquer";
  const expectedPay = BigInt(action === "open" ? k.openingPrice : (k.conquest?.pay ?? "0"));
  busy = true;
  prompt = "Preparing the transaction…";
  controller = new AbortController();
  const c = controller;
  const timeout = setTimeout(() => c.abort(new Error("Timed out waiting for your wallet")), SIGN_TIMEOUT_MS);
  renderAct();
  log(`${action} for ${units(expectedPay.toString())} PUSD: asking the wallet`);
  try {
    const out = await kingdomActExternal({
      game, provider, walletPkhHex: w, action, expectedPay, artifacts, signal: c.signal,
      onPrompt: (text) => {
        prompt = text;
        renderAct();
      },
    });
    log(out.ok ? `${action} accepted: pass ${out.passCount}, txid ${out.txid}` : `${action} refused (${out.code}): ${out.text}`);
  } catch (e) {
    console.error(e);
    log(`${action} failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timeout);
    busy = false;
    prompt = "";
    controller = null;
    renderAct();
    setTimeout(() => void poll(), 1500);
    setTimeout(() => void poll(), 6000);
  }
}

async function onProtect(amount: bigint) {
  const w = me();
  if (busy || !w || !round) return;
  busy = true;
  prompt = "Preparing the transaction…";
  controller = new AbortController();
  const c = controller;
  const timeout = setTimeout(() => c.abort(new Error("Timed out waiting for your wallet")), SIGN_TIMEOUT_MS);
  renderAct();
  renderProtect();
  log(`protect +${units(amount.toString())} PUSD: asking the wallet`);
  try {
    const out = await kingdomProtectExternal({
      game, provider, walletPkhHex: w, amount, artifacts, signal: c.signal,
      onPrompt: (text) => {
        prompt = text;
        renderAct();
      },
    });
    log(out.ok ? `protect accepted, txid ${out.txid}` : `protect refused (${out.code}): ${out.text}`);
  } catch (e) {
    console.error(e);
    log(`protect failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timeout);
    busy = false;
    prompt = "";
    controller = null;
    renderAct();
    setTimeout(() => void poll(), 1500);
    setTimeout(() => void poll(), 6000);
  }
}

async function main() {
  game = (await (await fetch(`${import.meta.env.BASE_URL}game.${CONFIG.network}.kingdom.json`)).json()) as GameKingdom;
  $("connectBtn").addEventListener("click", () => startConnection(true));
  $("cancelBtn").addEventListener("click", () => void disconnectWallet());
  $("disconnectBtn").addEventListener("click", () => void disconnectWallet());
  $("copyUri").addEventListener("click", () => {
    const uri = getWalletState().uri;
    if (uri) void navigator.clipboard.writeText(uri);
  });
  $("actBtn").addEventListener("click", () => void onAct());
  $("cancelActBtn").addEventListener("click", () => controller?.abort(new Error("Cancelled by you")));
  subscribe(renderWallet);
  await poll();
  setInterval(() => void poll(), 3000);
  setInterval(renderRound, 500);
}

main().catch((e) => {
  console.error(e);
  $("status").textContent = `Error: ${e instanceof Error ? e.message : String(e)}`;
});