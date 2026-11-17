import type { ElectrumNetworkProvider } from "cashscript";
import { CONFIG, pusdCategory } from "./config.ts";
import { COPY } from "./copy.ts";
import { formatUnits } from "./lib/format.ts";
import {
  planWithdraw, readAmount, readDestination, sendWithdraw, WithdrawFailure, type WithdrawPlan,
} from "./lib/withdraw.ts";
import type { LocalWallet } from "./wallet/local.ts";
import { onLocalWalletChange } from "./walletUI.ts";

// "Withdraw" in the game wallet: send PUSD, BCH and trophies to the player's own wallet, with a review step.
// The transfer itself: src/lib/withdraw.ts.
const T = COPY.withdraw;
const $ = (id: string) => document.getElementById(id)!;
const input = (id: string) => $(id) as HTMLInputElement;
const button = (id: string) => $(id) as HTMLButtonElement;
const show = (id: string, visible: boolean) => $(id).classList.toggle("hidden", !visible);
const bch = (sats: bigint) => formatUnits(sats, 8);
const pusd = (units: bigint) => formatUnits(units, CONFIG.pusdDecimals);

let bchAll = false; // "Max" on BCH: everything left after the fee, worked out when the transfer is built
let plan: WithdrawPlan | null = null;
let sending = false;

function say(text: string, isError: boolean) {
  $("wdMsg").textContent = text;
  $("wdMsg").className = `mt-2 min-h-5 text-sm ${isError ? "text-red-400" : "text-emerald-300"}`;
}

function step(which: "form" | "confirm") {
  show("wdForm", which === "form");
  show("wdConfirm", which === "confirm");
}

function close() {
  if (sending) return;
  show("wdBox", false);
  plan = null;
}

// wallet: the game wallet when it is unlocked; busy: a move is being sent; onSent: refresh the balances
export function initWithdraw(
  provider: ElectrumNetworkProvider,
  wallet: () => LocalWallet | null,
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
    if (!wallet()) close(); // locked or deleted: the form goes with it
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
    show("wdBox", true);
    $("wdBox").scrollIntoView({ behavior: "smooth", block: "nearest" });
    try {
      held = await w.getBalances(provider);
    } catch {
      held = { sats: 0n, pusd: 0n, nfts: 0 };
    }
    $("wdPusdHave").textContent = `(${T.have(`${pusd(held.pusd)} PUSD`)})`;
    $("wdBchHave").textContent = `(${T.have(`${bch(held.sats)} BCH`)})`;
    $("wdNftsText").textContent = T.nfts(held.nfts);
    show("wdNftsRow", held.nfts > 0);
  });

  $("wdPusdMax").addEventListener("click", () => {
    input("wdPusd").value = pusd(held.pusd).replace(/,/g, "");
  });
  $("wdBchMax").addEventListener("click", () => {
    bchAll = true;
    input("wdBch").value = T.allBch;
  });
  input("wdBch").addEventListener("input", () => {
    if (bchAll) {
      bchAll = false;
      input("wdBch").value = "";
    }
  });
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
    const dest = readDestination(input("wdAddress").value, CONFIG.network as "mainnet" | "chipnet", w.pkhHex);
    if (!dest.ok) return say(T.errors[dest.error]!, true);
    const pusdUnits = readAmount(input("wdPusd").value, CONFIG.pusdDecimals);
    const sats = bchAll ? "all" : readAmount(input("wdBch").value, 8);
    if (pusdUnits === null || sats === null) return say(T.errors.amount!, true);
    button("wdReview").disabled = true;
    say(T.checking, false);
    try {
      plan = await planWithdraw(provider, w, pusdCategory(), { to: dest.lock, pusd: pusdUnits, sats, nfts: input("wdNfts").checked });
      const list = $("wdConfirmList");
      list.replaceChildren();
      const line = (text: string) => list.append(Object.assign(document.createElement("li"), { textContent: text }));
      if (plan.pusd > 0n) line(T.confirmPusd(pusd(plan.pusd)));
      if (plan.sats > 0n) line(T.confirmBch(bch(plan.sats)));
      if (plan.nfts > 0) line(T.confirmNfts(plan.nfts));
      $("wdConfirmTo").textContent = dest.address;
      $("wdConfirmFee").textContent = T.confirmFee(bch(plan.fee));
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
    say(T.sending, false);
    try {
      const txid = await sendWithdraw(plan);
      plan = null;
      step("form");
      show("wdForm", false);
      say(`${T.sent} ${T.sentId(txid)}`, false);
      onSent();
    } catch (e) {
      console.error(e);
      say(T.errors.failed!, true);
    } finally {
      sending = false;
      button("wdSend").disabled = false;
      button("wdBack").disabled = false;
    }
  });
}

// While a withdrawal is being sent, moves wait (they would spend the same coins)
export const withdrawing = () => sending;
