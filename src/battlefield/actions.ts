// The action bar under the field: Conquer (or Take back your throne), Protect +1 / +5 / +10, Claim, and a wallet chip.
// It is only a view. Every rule comes from the page (battlefieldPage() in kingdomMode.ts: who may act, the price,
// the wallet, pause, cooldown) and every click goes to the page's own handlers, which do the price guard, the signing
// and the referee request. The field itself never moves on a click: scenes play only from events.
import { COPY, pauseText } from "../copy.ts";
import type { battlefieldDo, battlefieldPage } from "../kingdomMode.ts";
import { serverNow } from "../referee/clock.ts";
import { money } from "./hud.ts";
import type { Portrait } from "./identity.ts";
import { openPicker } from "./picker.ts";
import { isOn, onSoundChange, setSound } from "./sound.ts";

const T = COPY.battlefield;
export type PageView = ReturnType<typeof battlefieldPage>;
export type PageDo = typeof battlefieldDo;

const PLATE = "rounded-2xl border-2 border-[#e0a93a] bg-[#0f1a33]/95 text-[#f4ead2] shadow-lg";
const BTN = "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl px-4 py-2 font-bold " +
  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 disabled:cursor-not-allowed";
const MAIN = `${BTN} bg-[#e0a93a] text-[#0f1a33] enabled:hover:bg-amber-300 disabled:bg-[#2a3550] disabled:text-[#f4ead2]/60`;
const SMALL = `${BTN} border-2 border-[#e0a93a] bg-[#0f1a33] enabled:hover:bg-[#1f2b4d] disabled:border-[#2a3550] disabled:text-[#f4ead2]/40`;
const DONE = new Set<string>([COPY.kingdom.doneOpen, COPY.kingdom.doneConquer, COPY.kingdom.doneProtect, COPY.kingdom.doneCancel]);
const short = (units: string) => money(BigInt(units)).replace(/\.00$/, ""); // "500" -> "5"

function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function mountActionBar(
  after: HTMLElement,
  page: () => PageView,
  run: PageDo,
  popup: (text: string) => void,
  openWallet: () => void,
  portraits: () => Portrait[],
): void {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = "") => {
    const e = document.createElement(tag);
    e.className = cls;
    e.textContent = text;
    return e;
  };
  const bar = el("section", `${PLATE} mx-auto mt-2 flex w-full max-w-5xl flex-col gap-3 p-3`);
  bar.setAttribute("aria-label", T.actionsLabel);
  after.after(bar);

  const top = el("div", "flex flex-wrap items-center gap-3");
  const chip = el("button", `${SMALL} text-sm font-semibold`);
  chip.type = "button";
  chip.setAttribute("aria-label", T.openWallet);
  chip.addEventListener("click", openWallet);
  const main = el("button", `${MAIN} grow text-lg`);
  main.type = "button";
  const spinner = el("span", "h-5 w-5 animate-spin rounded-full border-4 border-[#0f1a33]/30 border-t-[#0f1a33] motion-reduce:animate-none");
  spinner.setAttribute("aria-hidden", "true");
  const mainText = el("span", "");
  main.append(spinner, mainText);
  const cancel = el("button", SMALL, T.cancel);
  cancel.type = "button";
  cancel.addEventListener("click", () => run.cancel());
  // Sound: off until the first tap, then on unless the player turned it off (remembered in this browser)
  const mute = el("button", `${SMALL} text-sm`);
  mute.type = "button";
  mute.setAttribute("aria-label", T.soundAria);
  const showSound = (on: boolean) => {
    mute.textContent = on ? `🔊 ${T.soundOn}` : `🔇 ${T.soundOff}`;
    mute.setAttribute("aria-pressed", String(on));
  };
  // The page's first tap also unlocks sound (on the window, just after this button sees it), so remember what the
  // button showed before the tap: a first tap on "Sound off" turns it on, not on-and-off again
  let before = isOn();
  for (const type of ["pointerdown", "keydown"] as const) mute.addEventListener(type, () => (before = isOn()));
  mute.addEventListener("click", () => {
    setSound(!before);
    before = isOn();
  });
  onSoundChange(showSound);
  showSound(isOn());
  top.append(chip, main, cancel, mute);

  const prot = el("div", "flex flex-wrap items-center gap-2");
  const protTitle = el("span", "text-sm text-[#e0a93a]");
  const protBtns = [0, 1, 2].map((i) => {
    const b = el("button", SMALL);
    b.type = "button";
    b.addEventListener("click", () => {
      if (!b.disabled) run.protect(i);
    });
    return b;
  });
  prot.append(protTitle, ...protBtns);

  // Cancel round: the king only, while nobody has conquered. "Get your X PUSD back" under it.
  const cancelRow = el("div", "flex flex-wrap items-center gap-2");
  const cancelRound = el("button", `${SMALL} flex-col items-start gap-0 text-left`);
  cancelRound.type = "button";
  const cancelTitle = el("span", "", T.cancelRoundBtn);
  const cancelLine = el("span", "text-xs font-normal text-[#f4ead2]/80");
  cancelRound.append(cancelTitle, cancelLine);
  cancelRound.addEventListener("click", () => {
    if (!cancelRound.disabled) run.cancelRound();
  });
  cancelRow.append(cancelRound);

  const status = el("p", "min-h-6 text-sm");
  status.setAttribute("aria-live", "polite");
  bar.append(top, prot, cancelRow, status);

  let mainAction: (() => void) | null = null;
  main.addEventListener("click", () => {
    if (!main.disabled) mainAction?.();
  });

  // Only touch the DOM when something changed
  const set = (e: HTMLElement, text: string) => {
    if (e.textContent !== text) e.textContent = text;
  };
  // The hidden attribute, not a class: Tailwind's display classes (flex, inline-flex) would win over "hidden"
  const toggle = (e: HTMLElement, hidden: boolean) => {
    if (e.hidden !== hidden) e.hidden = hidden;
  };
  let lastNote: string | null = null;

  function render(): void {
    const v = page();
    const r = v.round, k = r?.kingdom ?? null;

    // Wallet chip: which wallet plays, and the game wallet's balances
    const w = v.wallet;
    set(chip, w.externalName ?? (w.game ? [T.gameWallet, w.pusdText, w.bchText].filter(Boolean).join(" · ") : w.vault === "locked" ? T.unlockWallet : T.noWallet));

    // Main button
    let label = "…", enabled = false, reason = "", busy = false;
    mainAction = null;
    if (v.busy) {
      busy = true;
      label = v.external ? (v.signLeftMs !== null ? T.approve(clockText(v.signLeftMs)) : T.sending) : T.sending;
      reason = v.external ? v.signPrompt : "";
    } else if (r && (v.ended || r.status === "settled")) {
      label = COPY.kingdom.roundOver;
      reason = T.nextRound;
    } else if (!r || !k) {
      label = "…";
    } else if (r.status === "over") {
      if (v.kingIsMine) {
        label = v.claiming ? T.claiming : T.claimBtn;
        enabled = !v.claiming && !v.mock;
        mainAction = run.claim;
        busy = v.claiming;
        reason = v.mock ? T.mockOff : v.claimNote;
      } else {
        label = T.waitingClaim;
      }
    } else {
      const king = k.holder ?? r.king;
      const price = r.status === "waiting" ? k.openingPrice : (k.conquest?.pay ?? null);
      const mine = r.status === "open" && v.actingPkh !== null && king === v.actingPkh;
      label = price === null ? COPY.kingdom.roundOver
        : r.status === "waiting" ? T.openBtn(money(BigInt(price)))
        : mine ? T.holdThrone
        : v.previousKingIsMine ? T.takeBackBtn(money(BigInt(price)))
        : T.conquerBtn(money(BigInt(price)));
      enabled = v.act.enabled && !mine;
      reason = v.act.hint;
      // Before the player's first open or conquest in this round: "Choose your king" first, then the same move at the
      // price confirmed in the window (the page's price guard refuses it if the chain price moved meanwhile)
      mainAction = v.needsProfile && portraits().length > 0 ? () => choose() : () => run.act();
      if (v.act.label === COPY.kingdom.roundOver) {
        // The page's own clock says time is up (actState returns this label then). The referee may take a while
        // to announce the end, so say so instead of showing a price that can no longer be paid.
        label = COPY.kingdom.roundOver;
        enabled = false;
        mainAction = null;
        reason = COPY.clock.confirming;
      } else if (v.act.hint === COPY.grab.noWallet || v.act.hint === COPY.grab.locked) {
        // Needs a wallet: the button opens the wallet panel instead
        label = v.act.hint === COPY.grab.locked ? T.unlockWallet : T.createWallet;
        enabled = true;
        mainAction = openWallet;
      } else if (v.mock) {
        enabled = false;
        reason = T.mockOff;
      } else if (enabled && !v.external && w.pusd !== null && price !== null && w.pusd < BigInt(price)) {
        // Display only: the page's own check refuses it too, this just says so before the click
        enabled = false;
        reason = T.needsFunds(money(BigInt(price) - w.pusd));
      }
    }
    set(mainText, label);
    main.disabled = !enabled;
    main.setAttribute("aria-busy", String(busy));
    toggle(spinner, !busy);
    toggle(cancel, !(v.busy && v.external));

    // The outcome of the last move: done, or the page's own error text (also as a popup)
    if (v.note !== lastNote) {
      lastNote = v.note;
      if (v.note && !DONE.has(v.note)) popup(v.note);
    }
    const ok = v.note !== null && DONE.has(v.note);
    const text = v.busy ? reason : v.note ?? reason;
    set(status, text ? (ok ? `✓ ${text}` : text) : "");
    status.classList.toggle("text-emerald-300", ok);
    status.classList.toggle("text-rose-300", !ok && v.note !== null && !v.busy);

    // Cancel round: shown and enabled exactly when the page offers it
    const c = v.cancelRound;
    toggle(cancelRow, !c.show);
    if (c.show && c.pool !== null) {
      const pool = money(BigInt(c.pool));
      set(cancelLine, T.cancelRoundLine(pool));
      cancelRound.setAttribute("aria-label", T.cancelRoundAria(pool));
    }
    cancelRound.disabled = !c.enabled || v.busy;

    // Protect: enabled exactly when the page enables it; the reason is said in words
    const open = r?.status === "open";
    toggle(prot, !k || r?.status === "settled" || !!v.ended);
    if (!k || !r) return;
    const king = k.holder ?? r.king;
    const rem = r.deadline === null ? null : r.paused ? r.deadline - r.paused.since : r.deadline - serverNow();
    const closed = rem !== null && rem - k.protectLockoutSeconds * 1000 <= 0;
    const over = (amount: string | null) => amount !== null && BigInt(k.value) + BigInt(amount) > BigInt(k.cap);
    const why = !open ? T.protectNotOpen
      : v.actingPkh === null || king !== v.actingPkh ? T.protectNotKing
      : r.paused ? pauseText(r.paused.reason)
      : closed ? T.popProtectClosed
      : k.protectsLeft <= 0 ? COPY.errors.no_protects_left
      : v.protect.every((p) => p.amount === null || over(p.amount)) ? T.protectCap(money(BigInt(k.cap)))
      : v.mock ? T.mockOff
      : "";
    set(protTitle, why ? `${T.protectTitle(k.protectsLeft, k.protectsPerReign, money(BigInt(k.cap)))} · ${why}` : T.protectTitle(k.protectsLeft, k.protectsPerReign, money(BigInt(k.cap))));
    protBtns.forEach((b, i) => {
      const p = v.protect[i];
      const amount = p?.amount ?? (k.protectAmounts[i] ?? null);
      set(b, amount === null ? "—" : T.protectBtn(short(amount)));
      b.setAttribute("aria-label", amount === null ? T.protectNotOpen : T.protectAria(money(BigInt(amount))));
      b.disabled = !p?.enabled || v.busy || v.mock;
      b.title = amount !== null && over(amount) ? T.protectCap(money(BigInt(k.cap))) : why;
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
