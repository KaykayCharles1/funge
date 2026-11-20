// The dock at the bottom of the field: the wallet chip, the main button (Be the first king, Conquer the throne, Take
// back your throne, Claim your reward, or what the player needs first), the king's protect buttons and Cancel round.
// It is only a view. Every rule comes from the page (battlefieldPage() in kingdomMode.ts: who may act, the price, the
// wallet, pause, cooldown) and every click goes to the page's own handlers, which do the price guard, the signing and
// the referee request. The field itself never moves on a click: scenes play only from events.
// Laptop layout from the approved mockup (docs/REDESIGN_CHECKLIST.md, section 2). An unavailable button fades with
// the not-allowed cursor and says nothing, except a short tip when the player cannot afford it.
import "./dock.css";
import { COPY } from "../copy.ts";
import type { battlefieldDo, battlefieldPage } from "../kingdomMode.ts";
import { serverNow } from "../referee/clock.ts";
import { money } from "./hud.ts";
import type { Portrait } from "./identity.ts";
import { openPicker } from "./picker.ts";
import { ownWalletBalances } from "./walletPanel.ts";
import { formatUnits } from "../lib/format.ts";
import { CONFIG } from "../config.ts";

const T = COPY.battlefield;
export type PageView = ReturnType<typeof battlefieldPage>;
export type PageDo = typeof battlefieldDo;
const DONE = new Set<string>([COPY.kingdom.doneOpen, COPY.kingdom.doneConquer, COPY.kingdom.doneProtect, COPY.kingdom.doneCancel]);
const short = (units: string) => money(BigInt(units)).replace(/\.00$/, ""); // "500" -> "5"
const LOW_BCH_SATS = 1000n; // below this the game wallet cannot pay a move's network fee (the send checks it exactly)
const base = `${import.meta.env.BASE_URL}assets/`;
const PUSD_ICON = `${base}tokens/pusd.jpg`;
const BCH_ICON = `${base}tokens/bch.png`;

function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
// "12.34 PUSD" -> "12.34"; "0.15802 BCH" -> "0.158"
const amountOf = (text: string, decimals: number) => {
  const m = /^([\d.]+)/.exec(text.trim());
  return m ? (decimals >= 0 ? Number(m[1]).toFixed(decimals) : m[1]!) : "—";
};
const satsOf = (text: string) => {
  const m = /^(\d+)(?:\.(\d{1,8}))?/.exec(text.trim());
  return m ? BigInt(m[1]!) * 100_000_000n + BigInt((m[2] ?? "").padEnd(8, "0")) : null;
};

export function mountActionBar(
  host: HTMLElement,
  page: () => PageView,
  run: PageDo,
  popup: (text: string) => void,
  openWallet: () => void,
  portraits: () => Portrait[],
  onNet: (offline: boolean) => void,
): void {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };
  const img = (src: string) => {
    const i = el("img");
    i.src = src;
    i.alt = "";
    return i;
  };
  const caret = () => {
    const s = el("span", "fg-caret");
    s.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f3cf74" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    return s;
  };

  host.append(el("div", "fg-shade-bottom"));
  const dock = el("section", "fg-dock");
  dock.setAttribute("aria-label", T.actionsLabel);
  host.append(dock);

  // Wallet chip: the active wallet's balances, or what the player needs to do first
  const chip = el("button", "fg-chip");
  chip.type = "button";
  chip.addEventListener("click", openWallet);
  const chipCoins = el("span", "");
  chipCoins.className = "fg-chip-part";
  const pusdAmt = el("strong"), bchAmt = el("strong");
  const bchIcon = img(BCH_ICON);
  bchIcon.style.marginLeft = "4px";
  chipCoins.append(img(PUSD_ICON), pusdAmt, bchIcon, bchAmt);
  const chipWord = el("span", "");
  chipWord.className = "fg-chip-part";
  const chipIcon = el("span"), chipText = el("strong");
  chipText.style.fontFamily = "inherit";
  chipWord.append(chipIcon, chipText);
  chip.append(chipCoins, chipWord, caret());

  // Main button, and Cancel while an own wallet waits for approval
  const main = el("button", "fg-main");
  main.type = "button";
  const spinner = el("span", "fg-spin");
  spinner.setAttribute("aria-hidden", "true");
  const mainText = el("span");
  main.append(spinner, mainText);
  const cancel = el("button", "fg-line", T.cancel);
  cancel.type = "button";
  cancel.addEventListener("click", () => run.cancel());

  // The king's row: three protects and Cancel round
  const kingRow = el("span", "fg-kingrow");
  const shield = `${base}icons/shield.webp`;
  const protBtns = [0, 1, 2].map((i) => {
    const b = el("button", "fg-pb");
    b.type = "button";
    const amt = el("span");
    const tip = el("span", "fg-tip");
    b.append(img(shield), amt, tip);
    b.addEventListener("click", (e) => {
      if (b.getAttribute("aria-disabled") === "true" || pressed(e)) return;
      run.protect(i);
    });
    longPress(b);
    kingRow.append(b);
    return { b, amt, tip };
  });
  const cancelRound = el("button", "fg-cr");
  cancelRound.type = "button";
  const cancelTitle = el("span", "", T.cancelRoundBtn);
  const cancelTip = el("span", "fg-tip");
  cancelRound.append(cancelTitle, cancelTip);
  cancelRound.addEventListener("click", (e) => {
    if (cancelRound.getAttribute("aria-disabled") === "true" || pressed(e)) return;
    run.cancelRound();
  });
  longPress(cancelRound);
  kingRow.append(cancelRound);

  dock.append(chip, main, cancel, kingRow);

  let mainAction: (() => void) | null = null;
  main.addEventListener("click", () => {
    if (main.getAttribute("aria-disabled") !== "true") mainAction?.();
  });

  // Only touch the DOM when something changed
  const set = (e: HTMLElement, text: string) => {
    if (e.textContent !== text) e.textContent = text;
  };
  const toggle = (e: HTMLElement, hidden: boolean) => {
    if (e.hidden !== hidden) e.hidden = hidden;
  };
  const off = (e: HTMLElement, isOff: boolean) => {
    const v = String(isOff);
    if (e.getAttribute("aria-disabled") !== v) e.setAttribute("aria-disabled", v);
  };
  let lastNote: string | null = null;

  function render(): void {
    const v = page();
    const r = v.round, k = r?.kingdom ?? null;
    const w = v.wallet;

    // Which wallet plays
    const own = w.externalName !== null;
    const hasWallet = w.game || own;
    const ownBal = own ? ownWalletBalances() : null;
    const coinsShown = (w.game && !own) || ownBal !== null;
    toggle(chipCoins, !coinsShown);
    toggle(chipWord, coinsShown);
    if (ownBal) {
      set(pusdAmt, Number(formatUnits(ownBal.pusd, CONFIG.pusdDecimals)).toFixed(2));
      set(bchAmt, Number(formatUnits(ownBal.sats, 8)).toFixed(3));
      chip.setAttribute("aria-label", `${w.externalName ?? ""}. ${T.openWallet}`);
    } else if (coinsShown) {
      set(pusdAmt, amountOf(w.pusdText, 2));
      set(bchAmt, amountOf(w.bchText, 3));
      chip.setAttribute("aria-label", `${T.gameWallet}: ${w.pusdText}. ${T.openWallet}`);
    } else {
      const word = own ? (w.externalName ?? "") : w.vault === "locked" ? T.walletLocked : T.noWallet;
      set(chipText, word);
      const icon = own ? "own" : w.vault === "locked" ? "locked" : "none";
      if (chipIcon.dataset.icon !== icon) {
        chipIcon.dataset.icon = icon;
        chipIcon.innerHTML = icon === "locked"
          ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f3cf74" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
          : icon === "none"
            ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f3cf74" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6.5 16 4l1.2 2.5"/><rect x="4" y="6.5" width="17" height="12.5" rx="2"/><path d="M17 12.5h.5"/></svg>'
            : `<img src="${PUSD_ICON}" alt="" style="width:26px;height:26px;border-radius:50%">`;
      }
      chip.setAttribute("aria-label", `${word}. ${T.openWallet}`);
    }
    const sats = w.game && !own ? satsOf(w.bchText) : null; // the game wallet's, when it is the one that plays
    const lowBch = w.game && !own && sats !== null && sats < LOW_BCH_SATS;

    // The round's state
    const king = k ? (k.holder ?? r!.king) : null;
    const mine = !!r && r.status === "open" && v.actingPkh !== null && king === v.actingPkh;
    const ended = !r || !!v.ended || r.status === "settled";
    const claimable = !!r && r.status === "over" && v.kingIsMine;

    // Main button. Hidden for the king (the protect row shows instead) and once the round is over, except the winner's Claim.
    let label = "…", enabled = false, busy = false, show = true;
    mainAction = null;
    if (v.busy) {
      busy = true;
      label = v.external && v.signLeftMs !== null ? T.approve(clockText(v.signLeftMs)) : T.sending;
    } else if (claimable) {
      label = v.claiming ? T.claiming : T.claimBtn;
      enabled = !v.claiming && !v.mock;
      busy = v.claiming;
      mainAction = run.claim;
    } else if (ended || !k || r!.status === "over" || mine) {
      show = false;
    } else {
      const price = r!.status === "waiting" ? k.openingPrice : (k.conquest?.pay ?? null);
      label = price === null ? COPY.kingdom.roundOver
        : r!.status === "waiting" ? T.openBtn(money(BigInt(price)))
        : v.previousKingIsMine ? T.takeBackBtn(money(BigInt(price)))
        : T.conquerBtn(money(BigInt(price)));
      enabled = v.act.enabled;
      // Before the player's first open or conquest in this round: "Choose your King or Queen" first, then the same move
      // at the price confirmed in the window (the page's price guard refuses it if the chain price moved meanwhile)
      mainAction = v.needsProfile && portraits().length > 0 ? () => choose() : () => run.act();
      if (v.act.label === COPY.kingdom.roundOver) {
        // The page's own clock says time is up; the referee may take a moment to say so
        show = false;
      } else if (!hasWallet) {
        label = w.vault === "locked" ? T.unlockWallet : T.connectWallet;
        enabled = true;
        mainAction = openWallet;
      } else if (v.net === "offline") {
        label = T.reconnecting;
        enabled = false;
      } else if (v.mock) {
        enabled = false;
      } else if (enabled && w.game && !own && w.pusd !== null && price !== null && w.pusd < BigInt(price)) {
        // Display only: the page's own check refuses it too
        label = T.insufficient;
        enabled = false;
      } else if (enabled && lowBch) {
        label = T.insufficientBch;
        enabled = false;
      }
    }
    toggle(main, !show);
    set(mainText, label);
    off(main, !enabled);
    main.classList.toggle("fg-off", !enabled);
    main.setAttribute("aria-busy", String(busy));
    toggle(spinner, !busy);
    toggle(cancel, !(v.busy && v.external));

    onNet(v.net === "offline");
    // The outcome of the last move: errors as a popup (the field shows the good news itself)
    if (v.note !== lastNote) {
      lastNote = v.note;
      if (v.note && !DONE.has(v.note)) popup(v.note);
    }

    // The king's row: while a move is on its way the main button says so instead
    toggle(kingRow, !(mine && !v.busy && !ended));
    toggle(dock, !show && kingRow.hidden === true);
    if (!k || !r || kingRow.hidden) return;

    const c = v.cancelRound;
    toggle(cancelRound, !c.show);
    if (c.show && c.pool !== null) {
      const pool = money(BigInt(c.pool));
      set(cancelTip, hasWallet && v.net !== "offline" ? T.cancelRoundLine(pool) : "");
      cancelRound.setAttribute("aria-label", T.cancelRoundAria(pool));
    }
    off(cancelRound, !c.enabled || v.busy || !hasWallet || v.net === "offline");

    const rem = r.deadline === null ? null : r.paused ? r.deadline - r.paused.since : r.deadline - serverNow();
    const closed = rem !== null && rem - k.protectLockoutSeconds * 1000 <= 0;
    protBtns.forEach(({ b, amt, tip }, i) => {
      const p = v.protect[i];
      const amount = p?.amount ?? (k.protectAmounts[i] ?? null);
      set(amt, amount === null ? "—" : short(amount));
      const aria = amount === null ? T.protectNotOpen : T.protectAria(money(BigInt(amount)));
      b.setAttribute("aria-label", aria);
      // Why it cannot be used: only money gets words; everything else just fades
      const cap = amount !== null && BigInt(k.value) + BigInt(amount) > BigInt(k.cap);
      const usable = hasWallet && v.net !== "offline" && !closed && !cap && k.protectsLeft > 0 && !r.paused && !v.mock;
      const poor = usable && w.game && !own && w.pusd !== null && amount !== null && w.pusd < BigInt(amount);
      const words = !usable ? "" : poor ? T.insufficient : lowBch ? T.insufficientBch : p?.enabled ? aria : "";
      set(tip, words);
      off(b, !p?.enabled || !!poor || !!lowBch);
    });
  }

  // The price the confirm button shows, live; null when the move is no longer possible
  function pickPrice(): { label: string; price: bigint } | null {
    const v = page();
    const r = v.round, k = r?.kingdom ?? null;
    if (!r || !k || v.busy || !v.act.enabled || v.ended) return null;
    if (r.status === "waiting") return { label: T.pickConfirmOpen(money(BigInt(k.openingPrice))), price: BigInt(k.openingPrice) };
    if (r.status !== "open" || !k.conquest) return null;
    const pay = BigInt(k.conquest.pay);
    return { label: v.previousKingIsMine ? T.pickConfirmTakeBack(money(pay)) : T.pickConfirmConquer(money(pay)), price: pay };
  }
  function choose(): void {
    let agreed: bigint | null = null;
    openPicker({
      portraits: portraits(),
      players: page().players,
      confirmLabel: () => {
        const p = pickPrice();
        agreed = p ? p.price : null;
        return p ? p.label : null;
      },
      onConfirm: (profile) => {
        if (agreed !== null) run.act(profile, agreed);
      },
    });
  }

  render();
  setInterval(render, 250);
}

// A long press shows a button's tip on a touch screen; the click that ends that press does nothing else
const LONG_MS = 450;
const longPressed = new WeakSet<HTMLElement>();
function longPress(b: HTMLElement): void {
  let timer = 0;
  b.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    longPressed.delete(b);
    timer = window.setTimeout(() => {
      longPressed.add(b);
      b.classList.add("fg-tip-on");
    }, LONG_MS);
  });
  const end = () => {
    clearTimeout(timer);
    window.setTimeout(() => b.classList.remove("fg-tip-on"), 1200);
  };
  for (const t of ["pointerup", "pointercancel", "pointerleave"] as const) b.addEventListener(t, end);
  b.addEventListener("contextmenu", (e) => e.preventDefault()); // no copy menu over the button on a long press
}
function pressed(e: Event): boolean {
  const b = e.currentTarget as HTMLElement;
  if (!longPressed.has(b)) return false;
  longPressed.delete(b);
  return true;
}
