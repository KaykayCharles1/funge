// The top bar over the full-screen field: the Funge logo, the timer box, the King box, the Treasury box and the round
// buttons (Invite friends, Sound, Menu). Page elements, not canvas, so the field can fill any screen without cutting
// them off. The canvas HUD (hud.ts) still runs the sounds and the timing; it forwards what it shows to this bar.
// Laptop layout from the approved mockup (docs/REDESIGN_CHECKLIST.md, section 1). Names are shown only as text.
import "./topbar.css";
import { COPY } from "../copy.ts";
import type { FieldState } from "./director.ts";
import { clockText, money, type Urgency } from "./hud.ts";
import type { Identity, Portrait } from "./identity.ts";
import { isOn, onSoundChange, setSound } from "./sound.ts";

const T = COPY.battlefield;
const base = `${import.meta.env.BASE_URL}assets/`;
const SVG = (paths: string, w = 2) =>
  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICON = {
  invite: SVG('<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M19 8v6M16 11h6"/>'),
  soundOn: SVG('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
  soundOff: SVG('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>'),
  menu: SVG('<path d="M4 7h16M4 12h16M4 17h16"/>', 2.4),
};

// A round avatar from a full 512×640 portrait: the face box from the manifest, zoomed out to 1.45× the face, so the
// whole face and the crown show. Falls back to the portrait's own round avatar when there is no face box.
export function avatarStyle(p: Portrait, size: number): string {
  const f = p.face;
  if (!f) return `background-image: url("${base}${p.avatar}"); background-size: cover; background-position: center`;
  const R = f.size * 1.45, k = size / R;
  const left = Math.min(Math.max(f.x + f.size / 2 - R / 2, 0), 512 - R);
  const top = Math.min(Math.max(f.y + f.size / 2 - R / 2, 0), 640 - R);
  return `background-image: url("${base}${p.image}"); background-size: ${(512 * k).toFixed(1)}px ${(640 * k).toFixed(1)}px; ` +
    `background-position: ${(-left * k).toFixed(1)}px ${(-top * k).toFixed(1)}px`;
}

export type TopBarOptions = {
  isMe: (key: string | null) => boolean;
  onInvite: () => void;
  onMenu: () => void;
};

export class TopBar {
  readonly el: HTMLDivElement;
  private clockLbl: HTMLSpanElement;
  private clock: HTMLSpanElement;
  private bell: HTMLImageElement;
  private added: HTMLDivElement;
  private king: HTMLDivElement;
  private avatar: HTMLSpanElement;
  private noKing: HTMLSpanElement;
  private name: HTMLSpanElement;
  private sub: HTMLSpanElement;
  private shieldBox: HTMLSpanElement;
  private shields: HTMLImageElement[];
  private chest: HTMLImageElement;
  private treasury: HTMLSpanElement;
  private status: FieldState["status"] = "waiting";
  private capMs = 0;
  private urgency: Urgency = 0;
  private open = false;
  private left = 0;

  private o: TopBarOptions;

  constructor(host: HTMLElement, o: TopBarOptions) {
    this.o = o;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text) e.textContent = text;
      return e;
    };
    const img = (src: string, cls = "") => {
      const i = el("img", cls);
      i.src = base + src;
      i.alt = "";
      return i;
    };
    this.el = el("div", "fg-top");

    // Logo, back to the landing page
    const logo = el("a", "fg-logo");
    logo.href = import.meta.env.BASE_URL;
    logo.setAttribute("aria-label", T.homeAria);
    const logoImg = img("landing/funge-logo.webp");
    logoImg.alt = "Funge";
    logo.append(logoImg);

    // Timer
    const timer = el("div", "fg-plate fg-timer");
    this.bell = img("icons/bell.webp", "fg-bell");
    const tCol = el("span", "fg-col");
    this.clockLbl = el("span", "fg-plate-lbl");
    this.clock = el("span", "fg-plate-val fg-clock");
    this.clock.setAttribute("role", "timer");
    tCol.append(this.clockLbl, this.clock);
    timer.append(this.bell, tCol);
    this.added = el("div", "fg-added");
    this.added.setAttribute("aria-hidden", "true");

    // King
    this.king = el("div", "fg-king");
    this.avatar = el("span", "fg-avatar");
    this.avatar.setAttribute("role", "img");
    this.noKing = el("span", "fg-noking");
    this.noKing.append(img("icons/crown.webp"));
    const names = el("span", "fg-names");
    this.name = el("span", "fg-name", T.noKing);
    this.sub = el("span", "fg-sub");
    names.append(this.name, this.sub);
    this.shieldBox = el("span", "fg-shields");
    this.shieldBox.setAttribute("aria-label", T.protectsLeftAria);
    this.shields = [img("icons/shield.webp"), img("icons/shield.webp")];
    this.shieldBox.append(...this.shields);
    this.king.append(this.avatar, this.noKing, names, this.shieldBox);

    // Treasury
    const vault = el("div", "fg-plate fg-vault");
    this.chest = img("treasure/chest.webp", "fg-chest");
    const vCol = el("span", "fg-col");
    this.treasury = el("span", "fg-plate-val", "0.00");
    vCol.append(el("span", "fg-plate-lbl", T.treasury), this.treasury);
    vault.append(this.chest, vCol);

    // Round buttons
    const discs = el("div", "fg-discs");
    const disc = (label: string, html: string, onClick: () => void) => {
      const b = el("button", "fg-disc");
      b.type = "button";
      b.setAttribute("aria-label", label);
      b.title = label;
      b.innerHTML = html; // our own fixed icons, never player text
      b.addEventListener("click", onClick);
      discs.append(b);
      return b;
    };
    disc(COPY.invite.button, ICON.invite, () => this.o.onInvite());
    // Sound: the page's first tap also unlocks sound, so remember what the button showed before this tap
    let before = isOn();
    const sound = disc(T.soundAria, ICON.soundOff, () => setSound(!before));
    for (const type of ["pointerdown", "keydown"] as const) sound.addEventListener(type, () => (before = isOn()));
    const showSound = (on: boolean) => {
      sound.innerHTML = on ? ICON.soundOn : ICON.soundOff;
      sound.title = on ? T.soundOn : T.soundOff;
      sound.setAttribute("aria-pressed", String(on));
    };
    onSoundChange(showSound);
    showSound(isOn());
    disc(T.menuAria, ICON.menu, () => this.o.onMenu());

    this.el.append(logo, timer, this.added, this.king, vault, discs);
    host.append(this.el);
    this.paintClock(null);
    this.drawKing(null, null);
  }

  // Every value from the field state
  show(state: FieldState, king: Identity | null): void {
    this.status = state.status;
    this.capMs = state.capMs;
    this.open = state.status !== "waiting" && king !== null;
    this.left = state.protectsLeft;
    this.drawKing(this.open ? king : null, state);
    this.treasury.textContent = money(state.status === "waiting" ? 0n : state.treasury);
    this.paintShields();
    if (state.status === "waiting") this.paintClock(null);
  }

  // remainingMs null: no clock running (waiting shows the full clock, an ended round 0:00)
  setClock(remainingMs: number | null, capMs: number): void {
    if (capMs > 0) this.capMs = capMs;
    this.paintClock(remainingMs);
  }

  setUrgency(level: Urgency, frozen: boolean): void {
    this.urgency = level;
    this.bell.classList.toggle("fg-swing", level === 60 || level === 30);
    this.bell.classList.toggle("fg-swing-fast", level === 10);
    this.el.classList.toggle("fg-paused", frozen);
    this.clock.classList.toggle("fg-urgent", level === 10 && this.status === "open");
    this.paintShields();
  }

  toll(): void {
    this.bell.classList.remove("fg-swing", "fg-swing-fast", "fg-toll");
    void this.bell.offsetWidth; // restart the animation
    this.bell.classList.add("fg-toll");
  }

  floatAdded(text: string): void {
    this.added.textContent = text;
    this.added.classList.remove("fg-show");
    void this.added.offsetWidth;
    this.added.classList.add("fg-show");
  }

  glowPlate(on: boolean): void {
    this.king.classList.toggle("fg-glow", on);
  }

  useShield(protectsLeft: number): void {
    const sh = this.shields[protectsLeft];
    if (!sh) return;
    sh.classList.remove("fg-flash");
    void sh.offsetWidth;
    sh.classList.add("fg-flash");
    this.left = protectsLeft;
    this.paintShields();
  }

  bumpChest(): void {
    this.chest.classList.remove("fg-bump");
    void this.chest.offsetWidth;
    this.chest.classList.add("fg-bump");
  }

  // The chest's centre on screen (coins fly there)
  chestCenter(): { x: number; y: number } {
    const r = this.chest.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  private paintClock(remainingMs: number | null): void {
    const ended = this.status === "over" || this.status === "settled";
    const waiting = this.status === "waiting";
    this.clockLbl.textContent = waiting ? "" : ended ? COPY.kingdom.over : COPY.kingdom.running;
    this.clockLbl.style.display = waiting ? "none" : "";
    const ms = ended ? 0 : remainingMs ?? this.capMs;
    const text = clockText(ms);
    if (this.clock.textContent !== text) this.clock.textContent = text;
    this.clock.classList.toggle("fg-ended", ended);
  }

  private drawKing(king: Identity | null, state: FieldState | null): void {
    this.avatar.style.display = king ? "" : "none";
    this.noKing.style.display = king ? "none" : "";
    this.shieldBox.style.display = king ? "" : "none";
    if (!king || !state) {
      this.name.textContent = T.noKing;
      this.sub.textContent = "";
      this.sub.style.display = "none";
      return;
    }
    this.avatar.setAttribute("style", avatarStyle(king.portrait, 54));
    this.avatar.setAttribute("aria-label", king.name);
    this.name.textContent = this.o.isMe(state.king) ? T.youName(king.name) : king.name;
    const ended = state.status === "over" || state.status === "settled";
    this.sub.textContent = ended ? T.lastKingSub : T.throneValue(money(state.value));
    this.sub.style.display = "";
  }

  // Lit shields: the protects left; all dimmed while protect is closed (the last 30 seconds)
  private paintShields(): void {
    const closed = this.urgency === 30 || this.urgency === 10;
    this.shields.forEach((sh, i) => sh.classList.toggle("fg-used", !(this.open && i < this.left && !closed)));
  }
}
