// Invite links on the battlefield: the "Invite friends" share, and the banner a friend sees when they open the link
// ("King Charles summons you to battle for the throne."). The link itself: src/lib/invite.ts.
import { CONFIG } from "../config.ts";
import { COPY } from "../copy.ts";
import { checkName } from "../lib/playerName.ts";
import type { Portrait } from "./identity.ts";
import { lastChoice } from "./picker.ts";
import { invitedBy, inviteUrl } from "../lib/invite.ts";

const T = COPY.invite;
const PLATE = "rounded-2xl border-2 border-[#e0a93a] bg-[#0f1a33]/95 text-[#f4ead2] shadow-lg";
const BTN = "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl px-4 py-2 font-bold " +
  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300";
const MAIN = `${BTN} bg-[#e0a93a] text-[#0f1a33] hover:bg-amber-300`;
const SMALL = `${BTN} border-2 border-[#e0a93a] bg-[#0f1a33] hover:bg-[#1f2b4d]`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = "") => {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
};

// "King Charles": the name the player chose in this round, else the last one chosen in this browser
export function inviterName(o: {
  actingPkh: string | null;
  players: Record<string, { name: string; avatarId: string }>;
  portraits: Portrait[];
}): string | null {
  const chosen = (o.actingPkh && o.players[o.actingPkh.slice(0, 22).toLowerCase()]) || lastChoice();
  if (!chosen) return null;
  const check = checkName(chosen.name);
  if (!check.ok) return null;
  const title = o.portraits.find((p) => p.id === chosen.avatarId)?.title === "Queen" ? "Queen" : "King";
  return `${title} ${check.name}`;
}

// Share: the phone's own share sheet when there is one; otherwise a small window with the text and quick links
export function openInvite(who: string | null): void {
  const name = who ?? T.someone;
  const text = T.message(name);
  const url = inviteUrl(location.origin, import.meta.env.BASE_URL, who);
  const phone = typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches;
  if (phone) {
    navigator.share({ title: T.shareTitle, text, url }).catch((e: unknown) => {
      if (!(e instanceof DOMException && e.name === "AbortError")) openPanel(text, url); // cancelled: nothing to do
    });
    return;
  }
  openPanel(text, url);
}

let closeOpen: (() => void) | null = null;

function openPanel(text: string, url: string): void {
  closeOpen?.();
  const back = document.activeElement as HTMLElement | null;
  const overlay = el("div", "fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4");
  const panel = el("div", `${PLATE} flex w-full max-w-md flex-col gap-3 p-5`);
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  const title = el("h2", "text-lg font-bold text-[#e0a93a]", T.panelTitle);
  title.id = "inviteTitle";
  panel.setAttribute("aria-labelledby", title.id);
  const full = `${text}\n${url}`;
  const box = el("textarea", "h-28 w-full resize-none rounded-lg bg-[#0a1226] p-3 text-sm text-[#f4ead2] ring-1 ring-[#e0a93a]/50");
  box.readOnly = true;
  box.value = full;
  const msg = el("p", "min-h-5 text-sm");
  msg.setAttribute("aria-live", "polite");
  const copy = el("button", `${MAIN} w-full`, T.copy);
  copy.type = "button";
  copy.addEventListener("click", () => {
    navigator.clipboard.writeText(full).then(
      () => {
        msg.textContent = T.copied;
        msg.className = "min-h-5 text-sm text-emerald-300";
      },
      () => {
        box.select();
        msg.textContent = T.copyFailed;
        msg.className = "min-h-5 text-sm text-rose-300";
      },
    );
  });
  const enc = encodeURIComponent;
  const links = el("div", "flex flex-wrap gap-2");
  for (const [label, href] of [
    [T.telegram, `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`],
    [T.whatsapp, `https://wa.me/?text=${enc(full)}`],
    [T.x, `https://x.com/intent/post?text=${enc(text)}&url=${enc(url)}`],
  ] as const) {
    const a = el("a", `${SMALL} grow`, label);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    links.append(a);
  }
  const close = el("button", `${SMALL} self-end text-sm`, T.close);
  close.type = "button";
  panel.append(title, el("p", "text-sm text-[#f4ead2]/80", T.panelText), box, copy, msg, links, close);
  overlay.append(panel);
  document.body.append(overlay);

  const done = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    closeOpen = null;
    back?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") done();
  };
  close.addEventListener("click", done);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) done();
  });
  document.addEventListener("keydown", onKey);
  closeOpen = done;
  copy.focus();
}

// The banner over the field for someone who opened an invite link. On chipnet it points to the free test coins.
export function mountInviteBanner(before: HTMLElement, openWallet: () => void): void {
  const who = invitedBy(location.search);
  if (!who) return;
  const banner = el("section", `${PLATE} mx-auto mb-2 flex w-full max-w-5xl flex-wrap items-center gap-3 p-3`);
  banner.setAttribute("aria-label", T.summons(who));
  const words = el("div", "grow");
  words.append(el("p", "font-bold text-[#e0a93a]", T.summons(who)), el("p", "text-sm", T.bannerQuestion));
  banner.append(words);
  if (CONFIG.network === "chipnet") {
    const coins = el("button", MAIN, T.bannerCoins);
    coins.type = "button";
    coins.addEventListener("click", () => openWallet()); // the faucet is in the panel's Wallet tab
    banner.append(coins);
  }
  const dismiss = el("button", `${SMALL} text-sm`, T.bannerClose);
  dismiss.type = "button";
  dismiss.addEventListener("click", () => banner.remove());
  banner.append(dismiss);
  before.before(banner);
}
