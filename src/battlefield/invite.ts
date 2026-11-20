// Invite links on the battlefield: the "Invite friends" share, and the banner a friend sees when they open the link
// ("King Charles summons you to battle for the throne."). The link itself: src/lib/invite.ts.
// From the approved mockup (docs/REDESIGN_CHECKLIST.md, section 8).
import "./dialogs.css";
import { CONFIG } from "../config.ts";
import { COPY } from "../copy.ts";
import { checkName } from "../lib/playerName.ts";
import type { Portrait } from "./identity.ts";
import { lastChoice } from "./picker.ts";
import { invitedBy, inviteUrl } from "../lib/invite.ts";

const T = COPY.invite;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = "") => {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
};

// The four apps' own logos, white on their brand colour
const LOGOS = {
  telegram: { bg: "#26A5E4", size: 50, path: "M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" },
  whatsapp: { bg: "#25D366", size: 28, path: "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" },
  x: { bg: "#000000", size: 22, path: "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" },
  discord: { bg: "#5865F2", size: 28, path: "M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.028C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.1 14.1 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.331c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.332-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.332-.946 2.418-2.157 2.418z" },
} as const;
const DISCORD_APP = "https://discord.com/channels/@me"; // Discord has no share address: copy the invite, then open Discord
const logoSvg = (name: keyof typeof LOGOS) => {
  const L = LOGOS[name];
  return `<svg width="${L.size}" height="${L.size}" viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="${L.path}"/></svg>`;
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
  const overlay = el("div", "fg-dlg-back");
  overlay.style.background = "rgba(0, 0, 0, 0.6)";
  const panel = el("div", "fg-dlg fg-invite");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  const title = el("h2", "fg-dlg-title", T.panelTitle);
  title.style.fontSize = "32px";
  title.id = "inviteTitle";
  panel.setAttribute("aria-labelledby", title.id);
  const full = `${text}\n${url}`;
  const box = el("div", "fg-invite-box");
  box.append(el("div", "", text), el("div", "fg-invite-url", url));
  const msg = el("p", "fg-invite-msg");
  msg.setAttribute("aria-live", "polite");
  const copyText = (after?: () => void) =>
    navigator.clipboard.writeText(full).then(
      () => {
        msg.textContent = T.copied;
        msg.classList.remove("fg-bad");
        after?.();
      },
      () => {
        // Select the words so the player can copy them by hand
        const range = document.createRange();
        range.selectNodeContents(box);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        msg.textContent = T.copyFailed;
        msg.classList.add("fg-bad");
      },
    );
  const copy = el("button", "fg-gold", T.copy);
  copy.type = "button";
  copy.addEventListener("click", () => void copyText());

  // One row: the four apps, then Close
  const enc = encodeURIComponent;
  const share = el("div", "fg-share");
  for (const [name, label, href] of [
    ["telegram", T.telegram, `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`],
    ["whatsapp", T.whatsapp, `https://wa.me/?text=${enc(full)}`],
    ["x", T.x, `https://x.com/intent/post?text=${enc(text)}&url=${enc(url)}`],
  ] as const) {
    const a = el("a", "fg-logo-btn");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = label;
    a.setAttribute("aria-label", label);
    a.style.background = LOGOS[name].bg;
    if (name === "x") a.style.border = "1px solid #3f3f46";
    a.innerHTML = logoSvg(name); // a fixed icon, never player text
    share.append(a);
  }
  const discord = el("button", "fg-logo-btn");
  discord.type = "button";
  discord.title = T.discord;
  discord.setAttribute("aria-label", T.discord);
  discord.style.background = LOGOS.discord.bg;
  discord.innerHTML = logoSvg("discord");
  discord.addEventListener("click", () => void copyText(() => window.open(DISCORD_APP, "_blank", "noopener,noreferrer")));
  share.append(discord);
  const close = el("button", "fg-small", T.close);
  close.type = "button";
  share.append(close);
  panel.append(title, el("p", "fg-invite-lead", T.panelText), box, copy, msg, share);
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
export function mountInviteBanner(host: HTMLElement, openWallet: () => void): void {
  const who = invitedBy(location.search);
  if (!who) return;
  const banner = el("section", "fg-invited");
  banner.setAttribute("aria-label", T.summons(who));
  const words = el("div", "fg-invited-words");
  words.append(el("p", "fg-invited-who", T.summons(who)), el("p", "fg-invited-q", T.bannerQuestion));
  banner.append(words);
  if (CONFIG.network === "chipnet") {
    const coins = el("button", "fg-gold", T.bannerCoins);
    coins.type = "button";
    // The wallet panel, as this player needs it; the banner has done its job
    coins.addEventListener("click", () => {
      banner.remove();
      openWallet();
    });
    banner.append(coins);
  }
  const dismiss = el("button", "fg-x");
  dismiss.type = "button";
  dismiss.setAttribute("aria-label", T.bannerClose);
  dismiss.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  dismiss.addEventListener("click", () => banner.remove());
  banner.append(dismiss);
  host.append(banner);
}
