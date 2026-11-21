import type { ElectrumNetworkProvider } from "cashscript";
import { hexToBin } from "@bitauth/libauth";
import { CONFIG, pusdCategory } from "./config.ts";
import { COPY } from "./copy.ts";
import { formatUnits } from "./lib/format.ts";
import { readAmount } from "./lib/withdraw.ts";
import type { LocalWallet } from "./wallet/local.ts";
import { onLocalWalletChange } from "./walletUI.ts";
import type { ExternalSwapWallet } from "./swapExternal.ts";

// "Swap" in the game wallet: BCH and PUSD, either way, through Cauldron's pools, laid out like any exchange. The top
// coin is sold and the bottom one bought; the arrow switches them. Type either amount and the other fills in. Review
// shows the exact swap, which is then sent unchanged.
// The swap itself: src/lib/swap.ts, loaded the first time the box opens (it brings CashLab with it).
// It swaps for the wallet that plays: the game wallet (signed here) or an own wallet through WizardConnect, which
// signs in the wallet app (src/swapExternal.ts); then the button waits with "Approve in your wallet".
type SwapLib = typeof import("./lib/swap.ts");
type Quote = ReturnType<SwapLib["quote"]>;
type Ready = Awaited<ReturnType<SwapLib["buildSwap"]>>;
type Pools = Parameters<SwapLib["quote"]>[0];
type Side = "sell" | "buy";
type Coin = "BCH" | "PUSD";
type Direction = "toPusd" | "toBch";

const T = COPY.swap;
const $ = (id: string) => document.getElementById(id)!;
const input = (id: string) => $(id) as HTMLInputElement;
const button = (id: string) => $(id) as HTMLButtonElement;
const show = (id: string, visible: boolean) => $(id).classList.toggle("hidden", !visible);
const DEC = CONFIG.pusdDecimals;
const decimals = (c: Coin) => (c === "BCH" ? 8 : DEC);
const bch = (sats: bigint) => formatUnits(sats, 8).replace(/\.?0+$/, "") || "0"; // 0.00004023, trailing zeros cut
const pusd = (units: bigint) => formatUnits(units, DEC);
const amountText = (c: Coin, n: bigint) => (c === "BCH" ? bch(n) : pusd(n));
const plain = (text: string) => text.replace(/,/g, ""); // for putting a number back in a box
const SLIP_AUTO = 0.5; // percent
const SLIP_KEY = "funge:swapSlippage";

// The coins' logos (public/assets/tokens/); until the files are there, a drawn stand-in
const ICON_FILES: Record<Coin, string> = { BCH: "assets/tokens/bch.png", PUSD: "assets/tokens/pusd.jpg" };
const STAND_IN: Record<Coin, string> = {
  BCH: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#0AC18E"/><text x="16" y="22.5" text-anchor="middle" font-size="18" font-weight="700" font-family="system-ui,sans-serif" fill="#fff" transform="rotate(-25 16 16)">B</text></svg>',
  PUSD: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#2f6fde"/><text x="16" y="22.5" text-anchor="middle" font-size="18" font-weight="700" font-family="system-ui,sans-serif" fill="#fff">$</text></svg>',
};
function icon(c: Coin, size: string): HTMLElement {
  const img = document.createElement("img");
  img.src = `${import.meta.env.BASE_URL}${ICON_FILES[c]}`;
  img.alt = "";
  img.className = `${size} shrink-0 rounded-full`;
  img.addEventListener("error", () => {
    const span = document.createElement("span");
    span.className = `${size} shrink-0 block`;
    span.innerHTML = STAND_IN[c]; // a fixed drawing from this file, no outside data
    img.replaceWith(span);
  }, { once: true });
  return img;
}
function badge(id: string, c: Coin) {
  $(id).replaceChildren(icon(c, "h-6 w-6"), document.createTextNode(c));
}

let lib: SwapLib | null = null;
const loadLib = async () => (lib ??= await import("./lib/swap.ts"));

// ---- prices ----

let pools: { at: number; list: Pools } | null = null;
async function getPools(swap: SwapLib, provider: ElectrumNetworkProvider, fresh = false): Promise<Pools> {
  if (!fresh && pools && Date.now() - pools.at < 15_000) return pools.list;
  const category = pusdCategory();
  let list: Pools;
  if (CONFIG.network === "chipnet") {
    list = await swap.poolsOnChain(provider, hexToBin(CONFIG.swap.chipnetPoolOwner), category);
  } else {
    const res = await fetch(`${CONFIG.swap.indexerUrl}/cauldron/pool/active?token=${category}`);
    if (!res.ok) throw new Error(`pool list: HTTP ${res.status}`);
    const body = (await res.json()) as { active?: unknown };
    list = swap.poolsFromIndexer(Array.isArray(body.active) ? (body.active as Parameters<SwapLib["poolsFromIndexer"]>[0]) : [], category);
  }
  pools = { at: Date.now(), list };
  return list;
}

// Dollars per BCH at the real market price, from Cauldron's price of real PUSD (a dollar coin). The network fee is
// always shown at this price: it is what BCH fees really cost.
let usd: { at: number; perBch: number | null } | null = null;
async function realBchUsd(): Promise<number | null> {
  if (usd && Date.now() - usd.at < 60_000) return usd.perBch;
  let perBch: number | null = null;
  try {
    const res = await fetch(`${CONFIG.swap.indexerUrl}/cauldron/price/${CONFIG.pusdCategory.mainnet}/current`);
    const price = ((await res.json()) as { price?: unknown }).price; // sats per PUSD base unit
    if (typeof price === "number" && price > 0) perBch = 1e8 / (price * 10 ** DEC);
  } catch {
    perBch = null;
  }
  usd = { at: Date.now(), perBch };
  return perBch;
}
// Dollars per BCH for the amounts in the panels: on chipnet the practice pool's own (made-up) price, so both sides
// of a swap show the same dollars; on mainnet the real price
function panelBchUsd(swap: SwapLib, list: Pools, real: number | null): number | null {
  if (CONFIG.network === "mainnet") return real;
  const satsPerUnit = swap.marketPrice(list);
  return satsPerUnit ? 1e8 / (satsPerUnit * 10 ** DEC) : null;
}
const dollars = (x: number) =>
  x > 0 && x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const satsUsd = (sats: bigint, perBch: number | null) => (perBch === null ? "" : dollars((Number(sats) / 1e8) * perBch));
const valueOf = (c: Coin, n: bigint, perBch: number | null) => (c === "BCH" ? satsUsd(n, perBch) : dollars(Number(n) / 10 ** DEC));

// ---- settings: max slippage ----

function storedSlippage(): number | null {
  try {
    const raw = localStorage.getItem(SLIP_KEY);
    const v = raw === null ? NaN : Number(raw);
    return v > 0 && v <= 5 ? v : null;
  } catch {
    return null;
  }
}
const slippage = () => storedSlippage() ?? SLIP_AUTO;
function setSlippage(v: number | null) {
  try {
    if (v === null) localStorage.removeItem(SLIP_KEY);
    else localStorage.setItem(SLIP_KEY, String(v));
  } catch {
    /* the setting just isn't remembered */
  }
}

// While a swap is being sent, moves and withdrawals wait (they would spend the same coins)
let sendingNow: () => boolean = () => false;
export const swapping = () => sendingNow();

export type SwapSource = { kind: "local"; wallet: LocalWallet } | { kind: "external"; pkhHex: string };
const SIGN_TIMEOUT_MS = 180_000; // how long the own wallet has to approve, as for a move
let external: Promise<typeof import("./swapExternal.ts")> | null = null;
const loadExternal = () => (external ??= import("./swapExternal.ts"));

// source: the wallet that plays (null: none); busy: a move is being sent; onDone: refresh the balances
export function initSwap(
  provider: ElectrumNetworkProvider,
  source: () => SwapSource | null,
  busy: () => boolean,
  onDone: () => void,
) {
  const wallet = source;
  let direction: Direction = "toPusd";
  let side: Side = "sell";
  let spendable = 0n; // plain BCH coins: what a BCH sale can spend
  let pusdHeld = 0n;
  let quoted: Quote | null = null;
  let ready: {
    tx: Ready; q: Quote; panelUsd: number | null; realUsd: number | null; side: Side; amount: bigint; own: ExternalSwapWallet | null;
  } | null = null;
  let sending = false;
  let runId = 0;
  sendingNow = () => sending;
  const top = (): Coin => (direction === "toPusd" ? "BCH" : "PUSD");
  const bottom = (): Coin => (direction === "toPusd" ? "PUSD" : "BCH");
  const topAmount = (q: { sats: bigint; pusd: bigint }) => (direction === "toPusd" ? q.sats : q.pusd);
  const bottomAmount = (q: { sats: bigint; pusd: bigint }) => (direction === "toPusd" ? q.pusd : q.sats);

  $("lwSwapBtn").textContent = T.button;
  $("swTitle").textContent = T.title;
  $("swPractice").textContent = T.practice;
  show("swPractice", CONFIG.network === "chipnet");
  $("swSellLabel").textContent = T.sell;
  $("swBuyLabel").textContent = T.buy;
  $("swSlipLabel").textContent = T.slippage;
  $("swSlipAuto").textContent = T.slippageAuto;
  $("swSlipHelp").textContent = T.slippageHelp;
  $("swGear").setAttribute("aria-label", T.settings);
  $("swFlip").setAttribute("aria-label", T.flip);
  $("swFlip").title = T.flip;
  $("swGasWrap").title = T.networkCost;
  $("swRvTitle").textContent = T.confirmTitle;
  $("swRvClose").setAttribute("aria-label", T.close);
  $("swRvSend").textContent = T.send;

  // What the top coin can sell: BCH less the reserve for the fee and the PUSD output; PUSD all of it
  const maxSell = (swap: SwapLib) =>
    top() === "PUSD" ? pusdHeld : spendable > swap.SWAP_RESERVE ? spendable - swap.SWAP_RESERVE : 0n;

  function renderCoins() {
    badge("swTopToken", top());
    badge("swBotToken", bottom());
    const have = (c: Coin) => (c === "BCH" ? `${bch(spendable)} BCH` : `${pusd(pusdHeld)} PUSD`);
    $("swSellHave").textContent = have(top());
    $("swBuyHave").textContent = have(bottom());
  }

  for (const p of [...T.percents, 100]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rounded-full bg-slate-800 px-2 py-0.5 text-xs font-bold text-slate-200 ring-1 ring-slate-700 hover:bg-slate-700";
    b.textContent = p === 100 ? T.max : `${p}%`;
    b.addEventListener("click", async () => {
      const swap = await loadLib();
      const max = maxSell(swap);
      const held = top() === "BCH" ? spendable : pusdHeld;
      const part = (held * BigInt(p)) / 100n;
      const n = p === 100 || part > max ? max : part;
      input("swSell").value = n > 0n ? plain(amountText(top(), n)) : "";
      side = "sell";
      void update();
    });
    $("swChips").append(b);
  }

  // The arrow: switch the two coins, and the amounts with them
  $("swFlip").addEventListener("click", () => {
    const below = input("swBuy").value;
    direction = direction === "toPusd" ? "toBch" : "toPusd";
    input("swSell").value = below;
    input("swBuy").value = "";
    side = "sell";
    renderCoins();
    void update();
  });

  // ---- the main button and the lines under the panels ----

  function action(text: string, enabled: boolean) {
    button("swAction").textContent = text;
    button("swAction").disabled = !enabled;
  }
  function short(on: boolean) {
    // "Not enough …": the amount and the balance turn red
    $("swSell").classList.toggle("text-red-400", on);
    $("swSell").classList.toggle("text-slate-100", !on);
    $("swSellHave").classList.toggle("text-red-400", on);
  }
  // About what the network will charge (Review shows the exact figure): a pool and a coin are ~150-300 bytes, 1 sat a byte
  const estimateFee = (q: Quote) => 450n + 300n * BigInt(q.trade.entries.length - 1);
  function footer(q: Quote | null, panelUsd: number | null, realUsd: number | null) {
    if (!q) {
      $("swRate").textContent = "";
      $("swGas").textContent = "";
      return;
    }
    const perPusd = (q.sats * 10n ** BigInt(DEC)) / q.pusd; // sats per whole PUSD
    $("swRate").textContent = T.rate(bch(perPusd), satsUsd(perPusd, panelUsd));
    $("swGas").textContent = satsUsd(estimateFee(q), realUsd) || `${estimateFee(q)} sats`;
  }

  async function balances() {
    const w = wallet();
    if (!w) return;
    try {
      if (w.kind === "external") {
        const ext = await loadExternal();
        const own = await ext.externalSwapWallet(provider, w.pkhHex);
        const b = ext.externalBalances(own.coins, pusdCategory());
        spendable = b.sats;
        pusdHeld = b.pusd;
      } else {
        const coins = await provider.getUtxosForLockingBytecode(w.wallet.lock);
        spendable = coins.filter((u) => !u.token).reduce((s, u) => s + u.satoshis, 0n);
        pusdHeld = coins.reduce((s, u) => s + (u.token?.category === pusdCategory() && !u.token.nft ? u.token.amount : 0n), 0n);
      }
      renderCoins();
    } catch {
      /* keep the last figures */
    }
  }

  // Recompute after typing: fill the other side, the dollar values, the rate, the gas and the button
  async function update() {
    const id = ++runId;
    const typed = side === "sell" ? readAmount(input("swSell").value, decimals(top())) : readAmount(input("swBuy").value, decimals(bottom()));
    const other = side === "sell" ? "swBuy" : "swSell";
    short(false);
    if (!typed) {
      quoted = null;
      input(other).value = "";
      $("swSellUsd").textContent = "";
      $("swBuyUsd").textContent = "";
      footer(null, null, null);
      action(T.enter, false);
      return;
    }
    action(T.loading, false);
    try {
      const swap = await loadLib();
      const [list, realUsd] = await Promise.all([getPools(swap, provider), realBchUsd()]);
      if (id !== runId) return;
      const q = swap.quote(list, pusdCategory(), typed, side, direction);
      const panelUsd = panelBchUsd(swap, list, realUsd);
      quoted = q;
      if (side === "sell") input("swBuy").value = plain(amountText(bottom(), bottomAmount(q)));
      else input("swSell").value = plain(amountText(top(), topAmount(q)));
      $("swSellUsd").textContent = valueOf(top(), topAmount(q), panelUsd);
      $("swBuyUsd").textContent = valueOf(bottom(), bottomAmount(q), panelUsd);
      footer(q, panelUsd, realUsd);
      if (topAmount(q) > maxSell(swap)) {
        short(true);
        action(T.notEnough(top()), false);
      } else if (q.priceMove > swap.MAX_PRICE_MOVE) action(T.tooMuchImpact(String(Math.round(swap.MAX_PRICE_MOVE * 100))), false);
      else action(T.review, true);
    } catch (e) {
      if (id !== runId) return;
      quoted = null;
      input(other).value = "";
      footer(null, null, null);
      const code = lib && e instanceof lib.SwapFailure ? e.code : null;
      action(code === "too_big" ? T.tooBig(bottom()) : code === "too_small" ? T.tooSmall : T.unavailable, false);
      if (!code) console.error(e);
    }
  }

  let typing: ReturnType<typeof setTimeout> | undefined;
  for (const [id, s] of [["swSell", "sell"], ["swBuy", "buy"]] as const) {
    input(id).addEventListener("input", () => {
      side = s;
      clearTimeout(typing);
      typing = setTimeout(() => void update(), 300);
    });
  }

  function say(text: string, isError: boolean) {
    $("swMsg").textContent = text;
    $("swMsg").className = `mt-2 min-h-5 text-sm ${isError ? "text-red-400" : "text-emerald-300"}`;
  }

  // ---- settings ----

  function renderSlippage() {
    const auto = storedSlippage() === null;
    $("swSlipAuto").className = `rounded-full px-2 py-0.5 text-xs font-bold ${auto ? "bg-amber-400 text-slate-950" : "text-slate-300 hover:bg-slate-700"}`;
    if (document.activeElement !== $("swSlip")) input("swSlip").value = String(slippage());
  }
  function closeSettings() {
    show("swSettings", false);
    $("swGear").setAttribute("aria-expanded", "false");
  }
  $("swGear").addEventListener("click", (e) => {
    e.stopPropagation();
    const open = $("swSettings").classList.contains("hidden");
    show("swSettings", open);
    $("swGear").setAttribute("aria-expanded", String(open));
    renderSlippage();
  });
  $("swSettings").addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", closeSettings);
  $("swSlipAuto").addEventListener("click", () => {
    setSlippage(null);
    renderSlippage();
  });
  input("swSlip").addEventListener("change", () => {
    const v = Number(input("swSlip").value.replace(",", "."));
    setSlippage(v > 0 && v <= 5 ? Math.round(v * 100) / 100 : null);
    renderSlippage();
  });

  // ---- the review window ----

  let more = false;
  function rows() {
    if (!ready) return;
    const { tx, q, panelUsd, realUsd } = ready;
    const list = $("swRvRows");
    list.replaceChildren();
    const row = (label: string, value: string) => {
      const div = document.createElement("div");
      div.className = "flex justify-between gap-3";
      div.append(
        Object.assign(document.createElement("dt"), { className: "text-slate-400", textContent: label }),
        Object.assign(document.createElement("dd"), { className: "text-right text-slate-100", textContent: value }),
      );
      list.append(div);
    };
    if (more) row(T.rowRate, T.rateLine(pusd((q.pusd * 10n ** 8n) / q.sats)));
    row(T.rowFee, satsUsd(q.poolFee, panelUsd) || `${bch(q.poolFee)} BCH`);
    row(T.rowNetwork, satsUsd(tx.fee, realUsd) || `${tx.fee} sats`);
    if (more) {
      row(T.rowImpact, `${(Math.max(0, q.priceMove) * 100).toFixed(2)}%`);
      row(T.rowSlippage, `${slippage()}%`);
      row(T.rowRoute, T.route);
    }
    $("swRvMore").textContent = more ? `${T.showLess} ▴` : `${T.showMore} ▾`;
  }
  function openReview() {
    if (!ready) return;
    const { tx, panelUsd } = ready;
    more = false;
    $("swRvSell").textContent = `${amountText(top(), topAmount(tx))} ${top()}`;
    $("swRvSellUsd").textContent = valueOf(top(), topAmount(tx), panelUsd);
    $("swRvBuy").textContent = `${amountText(bottom(), bottomAmount(tx))} ${bottom()}`;
    $("swRvBuyUsd").textContent = valueOf(bottom(), bottomAmount(tx), panelUsd);
    $("swRvSellIcon").replaceChildren(icon(top(), "h-10 w-10"));
    $("swRvBuyIcon").replaceChildren(icon(bottom(), "h-10 w-10"));
    $("swRvMsg").textContent = "";
    button("swRvSend").textContent = T.send;
    button("swRvSend").disabled = false;
    rows();
    $("swReview").classList.replace("hidden", "flex");
    button("swRvSend").focus();
  }
  function closeReview() {
    if (sending) return;
    $("swReview").classList.replace("flex", "hidden");
    ready = null;
  }
  $("swRvMore").addEventListener("click", () => {
    more = !more;
    rows();
  });
  $("swRvClose").addEventListener("click", closeReview);
  $("swReview").addEventListener("click", (e) => {
    if (e.target === $("swReview")) closeReview();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if ($("swReview").classList.contains("flex")) closeReview();
    else closeSettings();
  });

  // ---- open and close the box ----

  function close() {
    if (sending) return;
    show("swBox", false);
    closeSettings();
    closeReview();
  }
  onLocalWalletChange(() => {
    if (!wallet()) close();
  });
  $("lwSwapBtn").addEventListener("click", () => {
    if (!wallet()) return;
    if (!$("swBox").classList.contains("hidden")) return close();
    input("swSell").value = "";
    input("swBuy").value = "";
    side = "sell";
    say("", false);
    renderCoins();
    show("swBox", true);
    $("swBox").scrollIntoView({ behavior: "smooth", block: "nearest" });
    void update();
    void balances();
    void loadLib().catch(() => undefined);
    void realBchUsd();
  });

  // Review: fresh pools, a fresh quote, and the exact transaction that Swap will send
  $("swAction").addEventListener("click", async () => {
    const w = wallet();
    if (!w || !quoted) return;
    if (busy()) return say(T.errors.busy!, true);
    const amount = side === "sell" ? readAmount(input("swSell").value, decimals(top())) : readAmount(input("swBuy").value, decimals(bottom()));
    if (!amount) return;
    action(T.loading, false);
    try {
      const swap = await loadLib();
      const [list, realUsd] = await Promise.all([getPools(swap, provider, true), realBchUsd()]);
      const q = swap.quote(list, pusdCategory(), amount, side, direction);
      const own = w.kind === "external" ? await (await loadExternal()).externalSwapWallet(provider, w.pkhHex) : null;
      const tx = await swap.buildSwap(provider, w.kind === "external" ? own!.wallet : w.wallet, q);
      ready = { tx, q, panelUsd: panelBchUsd(swap, list, realUsd), realUsd, side, amount, own };
      openReview();
      action(T.review, true);
    } catch {
      await update(); // the button says why
    }
  });

  // Swap: send the reviewed transaction. If a pool was traded first, try once more at the new price when it is
  // within the max slippage of the reviewed one; otherwise stop and ask for a new review.
  $("swRvSend").addEventListener("click", async () => {
    const w = wallet();
    if (!w || !ready || sending) return;
    const msg = (text: string, tone: "error" | "info") => {
      $("swRvMsg").textContent = text;
      $("swRvMsg").className = `mt-2 min-h-5 text-center text-sm ${tone === "error" ? "text-red-400" : "text-slate-300"}`;
    };
    if (busy()) return msg(T.errors.busy!, "error");
    const swap = await loadLib();
    const r = ready;
    sending = true;
    button("swRvSend").disabled = true;
    button("swRvSend").textContent = T.sending;
    msg("", "info");
    let got: bigint | null = null;
    // An own wallet: it signs in its app, then the page sends it. A moved pool means a new review (and approval).
    if (w.kind === "external") {
      button("swRvSend").textContent = T.approve;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error("Timed out waiting for your wallet")), SIGN_TIMEOUT_MS);
      try {
        const prompt = T.walletPrompt(`${amountText(top(), topAmount(r.tx))} ${top()}`, `${amountText(bottom(), bottomAmount(r.tx))} ${bottom()}`);
        const signed = await (await loadExternal()).signSwap(r.tx, r.own!.coins, prompt, controller.signal);
        if (!signed.ok) msg(signed.text, "error");
        else {
          button("swRvSend").textContent = T.sending;
          await swap.sendSwap(provider, { ...r.tx, hex: signed.signedHex });
          got = bottomAmount(r.tx);
        }
      } catch (e) {
        if (e instanceof swap.SwapFailure && e.code === "pools_changed") msg(T.errors.pools_changed!, "error");
        else {
          console.error(e);
          msg(T.errors.failed!, "error");
        }
      } finally {
        clearTimeout(timer);
        sending = false;
      }
      if (got === null) {
        button("swRvSend").textContent = T.send;
        button("swRvSend").disabled = false;
        return;
      }
      closeReview();
      input("swSell").value = "";
      input("swBuy").value = "";
      void update();
      say(T.done(amountText(bottom(), got), bottom()), false);
      onDone();
      setTimeout(() => void balances(), 2_000);
      setTimeout(() => void balances(), 8_000);
      return;
    }
    try {
      await swap.sendSwap(provider, r.tx);
      got = bottomAmount(r.tx);
    } catch (e) {
      if (e instanceof swap.SwapFailure && e.code === "pools_changed") {
        msg(T.retrying, "info");
        try {
          const slip = slippage() / 100;
          const q = swap.quote(await getPools(swap, provider, true), pusdCategory(), r.amount, r.side, direction);
          // typed what to sell: get at least (1 - slippage) of what was reviewed; typed what to buy: pay at most (1 + slippage)
          const within = r.side === "sell"
            ? Number(bottomAmount(q)) >= Number(bottomAmount(r.tx)) * (1 - slip)
            : Number(topAmount(q)) <= Number(topAmount(r.tx)) * (1 + slip);
          if (within) {
            const tx = await swap.buildSwap(provider, w.wallet, q);
            await swap.sendSwap(provider, tx);
            got = bottomAmount(tx);
          }
        } catch (e2) {
          console.error(e2);
        }
        if (got === null) msg(T.errors.pools_changed!, "error");
      } else {
        console.error(e);
        msg(T.errors.failed!, "error");
      }
    } finally {
      sending = false;
    }
    if (got === null) {
      button("swRvSend").textContent = T.send;
      return; // the window stays open with the reason; Close goes back to the form
    }
    closeReview();
    input("swSell").value = "";
    input("swBuy").value = "";
    void update();
    say(T.done(amountText(bottom(), got), bottom()), false);
    onDone();
    setTimeout(() => void balances(), 2_000);
    setTimeout(() => void balances(), 8_000);
  });
}
