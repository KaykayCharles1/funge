import type { ElectrumNetworkProvider } from "cashscript";
import { CONFIG, pusdCategory } from "./config.ts";
import { COPY } from "./copy.ts";
import { formatUnits } from "./lib/format.ts";
import {
  planWithdraw, readAmount, readDestination, sendWithdraw, WithdrawFailure, type WithdrawPlan,
} from "./lib/withdraw.ts";
import type { WalletCoin } from "./lib/walletCoins.ts";
import type { SwapSource } from "./swapUI.ts";
import { onLocalWalletChange } from "./walletUI.ts";

// "Withdraw": send PUSD, BCH and trophies from the wallet that plays to another wallet, with a review step. The game
// wallet signs at once; an own wallet (WizardConnect) is asked to approve in its app, then the page sends it.
// The transfer itself: src/lib/withdraw.ts.
const SIGN_TIMEOUT_MS = 180_000; // how long the own wallet has to approve, as for a move
let external: Promise<typeof import("./swapExternal.ts")> | null = null;
const loadExternal = () => (external ??= import("./swapExternal.ts"));
const T = COPY.withdraw;
const $ = (id: string) => document.getElementById(id)!;
const input = (id: string) => $(id) as HTMLInputElement;
const button = (id: string) => $(id) as HTMLButtonElement;
const show = (id: string, visible: boolean) => $(id).classList.toggle("hidden", !visible);
const bch = (sats: bigint) => formatUnits(sats, 8);
const pusd = (units: bigint) => formatUnits(units, CONFIG.pusdDecimals);

let bchAll = false; // "Max" on BCH: everything left after the fee, worked out when the transfer is built

// One coin at a time: once there is an address and an amount of one coin, the other coin's box and Max are off
function oneCoin() {
  const has = (id: string) => {
    const n = readAmount(input(id).value, 8);
    return n === null || n > 0n; // something typed (even a wrong number) counts as chosen
  };
  const addr = input("wdAddress").value.trim() !== "";
  const pusdOn = has("wdPusd");
  const bchOn = bchAll || has("wdBch");
  const lock = (ids: string[], off: boolean) => ids.forEach((id) => (($(id) as HTMLInputElement | HTMLButtonElement).disabled = off));
  lock(["wdBch", "wdBchMax"], addr && pusdOn && !bchOn);
  lock(["wdPusd", "wdPusdMax"], addr && bchOn && !pusdOn);
}
let plan: WithdrawPlan | null = null;
let ownCoins: WalletCoin[] | null = null; // an own wallet's coins, for its signing (null: the game wallet)
let sending = false;

function say(text: string, isError: boolean) {
  $("wdMsg").textContent = text;
  $("wdMsg").className = `mt-2 min-h-5 text-sm ${isError ? "text-red-400" : "text-emerald-300"}`;
}

function step(which: "form" | "confirm" | "done") {
  show("wdForm", which === "form");
  show("wdConfirm", which === "confirm");
  doneBox()?.classList.toggle("hidden", which !== "done");
}

// "Transaction Successful", a link to the transaction, and Done (built here, so the page needs no new markup)
let done: HTMLDivElement | null = null;
function doneBox(): HTMLDivElement | null {
  if (done) return done;
  const box = document.getElementById("wdBox");
  if (!box) return null;
  done = document.createElement("div");
  done.id = "wdDone";
  done.className = "hidden";
  const tick = document.createElement("div");
  tick.className = "wd-tick";
  tick.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';
  const title = document.createElement("p");
  title.id = "wdDoneTitle";
  title.textContent = T.sent;
  const link = document.createElement("a");
  link.id = "wdDoneLink";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = T.explorer(CONFIG.network);
  const ok = document.createElement("button");
  ok.id = "wdDoneBtn";
  ok.type = "button";
  ok.textContent = T.done;
  ok.addEventListener("click", () => {
    close();
    box.dispatchEvent(new CustomEvent("withdraw-done", { bubbles: true })); // the battlefield's panel goes home
  });
  done.append(tick, title, link, ok);
  $("wdMsg").before(done);
  return done;
}

function close() {
  if (sending) return;
  show("wdBox", false);
  plan = null;
  ownCoins = null;
}

// source: the wallet that plays (null: none); busy: a move is being sent; onSent: refresh the balances
export function initWithdraw(
  provider: ElectrumNetworkProvider,
  wallet: () => SwapSource | null,
  busy: () => boolean,
  onSent: () => void,
) {
  $("lwWithdrawBtn").textContent = T.button;
  $("wdTitle").textContent = T.title;
  $("wdText").textContent = T.text;
  $("wdAddressLabel").textContent = T.addressLabel;
  input("wdAddress").placeholder = T.addressPlaceholder(CONFIG.network);
  $("wdPusdLabel").textContent = T.pusdLabel;
  $("wdBchLabel").textContent = T.bchLabel;
  input("wdPusd").placeholder = "0.00";
  input("wdBch").placeholder = "0.00000";
  $("wdPusdMax").textContent = T.max;
  $("wdBchMax").textContent = T.max;
  $("wdReview").textContent = T.review;
  $("wdCancel").textContent = T.cancel;
  $("wdConfirmTitle").textContent = T.confirmTitle;
  $("wdConfirmToLabel").textContent = T.confirmTo;
  $("wdConfirmWarn").textContent = T.confirmWarn;
  $("wdSend").textContent = T.send;
  $("wdBack").textContent = T.back;

  let held = { sats: 0n, pusd: 0n, nfts: 0 };
  onLocalWalletChange(() => {
    if (!wallet()) close(); // locked or deleted, and no own wallet: the form goes with it
  });

  $("lwWithdrawBtn").addEventListener("click", async () => {
    const w = wallet();
    if (!w) return;
    if (!$("wdBox").classList.contains("hidden")) return close();
    plan = null;
    bchAll = false;
    input("wdPusd").value = "";
    input("wdBch").value = "";
    input("wdNfts").checked = false;
    say("", false);
    step("form");
    oneCoin();
    show("wdBox", true);
    $("wdBox").scrollIntoView({ behavior: "smooth", block: "nearest" });
    try {
      if (w.kind === "external") {
        const ext = await loadExternal();
        const own = await ext.externalSwapWallet(provider, w.pkhHex);
        held = { ...ext.externalBalances(own.coins, pusdCategory()), nfts: own.coins.filter((c) => c.utxo.token?.nft).length };
      } else held = await w.wallet.getBalances(provider);
    } catch {
      held = { sats: 0n, pusd: 0n, nfts: 0 };
    }
    $("wdPusdHave").textContent = T.have(pusd(held.pusd));
    $("wdBchHave").textContent = T.have(bch(held.sats));
    $("wdNftsText").textContent = T.nfts(held.nfts);
    show("wdNftsRow", held.nfts > 0);
  });

  $("wdPusdMax").addEventListener("click", () => {
    input("wdPusd").value = pusd(held.pusd).replace(/,/g, "");
    oneCoin();
  });
  $("wdBchMax").addEventListener("click", () => {
    bchAll = true;
    input("wdBch").value = T.allBch;
    oneCoin();
  });
  input("wdBch").addEventListener("input", () => {
    if (bchAll) {
      bchAll = false;
      input("wdBch").value = "";
    }
    oneCoin();
  });
  input("wdPusd").addEventListener("input", oneCoin);
  input("wdAddress").addEventListener("input", oneCoin);
  $("wdCancel").addEventListener("click", close);
  $("wdBack").addEventListener("click", () => {
    if (sending) return;
    plan = null;
    say("", false);
    step("form");
  });

  $("wdReview").addEventListener("click", async () => {
    const w = wallet();
    if (!w) return;
    if (busy()) return say(T.errors.busy!, true);
    const pkhHex = w.kind === "external" ? w.pkhHex : w.wallet.pkhHex;
    const dest = readDestination(input("wdAddress").value, CONFIG.network as "mainnet" | "chipnet", pkhHex);
    if (!dest.ok) return say(T.errors[dest.error]!, true);
    const pusdUnits = readAmount(input("wdPusd").value, CONFIG.pusdDecimals);
    const sats = bchAll ? "all" : readAmount(input("wdBch").value, 8);
    if (pusdUnits === null || sats === null) return say(T.errors.amount!, true);
    button("wdReview").disabled = true;
    say("", false); // no "Checking…" line: the button waits quietly
    try {
      // An own wallet: all its coins across its addresses, each signed later in the wallet app
      const own = w.kind === "external" ? await (await loadExternal()).externalSwapWallet(provider, w.pkhHex) : null;
      const from = own ? { ...own.wallet, pkhHex } : w.kind === "local" ? w.wallet : null;
      if (!from) return;
      plan = await planWithdraw(provider, from, pusdCategory(), { to: dest.lock, pusd: pusdUnits, sats, nfts: input("wdNfts").checked });
      ownCoins = own ? own.coins : null;
      // One row per thing sent (only what was filled in), then the address and the fee
      const list = $("wdConfirmList");
      list.replaceChildren();
      const row = (label: string, value: string, title?: string) => {
        const li = document.createElement("li");
        const k = document.createElement("span");
        k.textContent = label;
        const v = document.createElement("span");
        v.textContent = value;
        if (title) v.title = title;
        li.append(k, v);
        list.append(li);
      };
      if (plan.pusd > 0n) row(T.pusdLabel, T.confirmPusd(pusd(plan.pusd)));
      // BCH only when the player asked for it: a PUSD payment carries a little BCH of its own (the network's minimum
      // for a token output), and that arrives with the PUSD, so it is not a separate line
      if (sats === "all" || sats > 0n) row(T.bchLabel, T.confirmBch(bch(plan.sats)));
      if (plan.nfts > 0) row("NFT", T.confirmNfts(plan.nfts));
      const short = dest.address.length > 30 ? `${dest.address.slice(0, 16)}…${dest.address.slice(-8)}` : dest.address;
      row(T.confirmTo, short, dest.address);
      row(T.feeLabel, T.confirmFee(bch(plan.fee)));
      show("wdConfirmToLabel", false);
      show("wdConfirmTo", false);
      show("wdConfirmFee", false);
      say("", false);
      step("confirm");
      button("wdSend").focus();
    } catch (e) {
      say(T.errors[e instanceof WithdrawFailure ? e.code : "failed"]!, true);
      if (!(e instanceof WithdrawFailure)) console.error(e);
    } finally {
      button("wdReview").disabled = false;
    }
  });

  $("wdSend").addEventListener("click", async () => {
    if (!plan || sending) return;
    if (busy()) return say(T.errors.busy!, true);
    sending = true;
    button("wdSend").disabled = true;
    button("wdBack").disabled = true;
    say("", false); // no "Sending…" line: the buttons wait quietly
    try {
      let txid: string;
      if (ownCoins) {
        // The own wallet signs every input (they are all its coins), then the page sends it
        button("wdSend").textContent = T.approve;
        const what = [plan.pusd > 0n ? `${pusd(plan.pusd)} PUSD` : "", plan.sats > 0n && plan.pusd === 0n ? `${bch(plan.sats)} BCH` : ""]
          .filter(Boolean).join(" + ") || T.confirmNfts(plan.nfts);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error("Timed out waiting for your wallet")), SIGN_TIMEOUT_MS);
        try {
          const signed = await (await loadExternal()).signOwnInputs(plan.builder, plan.inputs, 0, ownCoins, T.walletPrompt(what), controller.signal);
          if (!signed.ok) {
            say(signed.text, true);
            return;
          }
          button("wdSend").textContent = T.sending;
          txid = await provider.sendRawTransaction(signed.signedHex);
        } finally {
          clearTimeout(timer);
        }
      } else txid = await sendWithdraw(plan);
      plan = null;
      say("", false);
      const link = doneBox()?.querySelector("a");
      if (link) link.href = `${CONFIG.explorerTx[CONFIG.network as "mainnet" | "chipnet"]}${txid}`;
      step("done");
      onSent();
    } catch (e) {
      console.error(e);
      say(T.errors.failed!, true);
    } finally {
      sending = false;
      button("wdSend").textContent = T.send;
      button("wdSend").disabled = false;
      button("wdBack").disabled = false;
    }
  });
}

// While a withdrawal is being sent, moves wait (they would spend the same coins)
export const withdrawing = () => sending;
