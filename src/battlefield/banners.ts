// Words over the field, as page elements: the popups under the top bar (good news in gold, errors in red), one status
// strip (connecting, the game server unreachable, the clock paused), and the box in the middle of the field:
// "Waiting for the first king", the round-over box with the winner and the next round's countdown, or "You won the
// pool!" for the winner before the claim. From the approved mockup (docs/REDESIGN_CHECKLIST.md, sections 4 to 7).
// Every text is set with textContent: chosen names are never read as HTML.
import "./banners.css";
import { COPY } from "../copy.ts";
import { nextRoundLine } from "../nextRound.ts";
import { isCancelled, type FieldState } from "./director.ts";
import { money } from "./hud.ts";
import type { Identity } from "./identity.ts";

const T = COPY.battlefield;
const POP_MS = 3500, ERROR_MS = 5500, FADE_MS = 500, MAX_POPS = 2;

export class Banners {
  private pops: HTMLDivElement;
  private strip: HTMLDivElement;
  private stripSpin: HTMLSpanElement;
  private stripText: HTMLSpanElement;
  private ribbonText: string | null = null;
  private ribbonAlert = false;
  private offline = false;
  private mid: HTMLDivElement;
  private midKick: HTMLDivElement;
  private midTitle: HTMLDivElement;
  private midNext: HTMLDivElement;
  private counting = false; // the box shows the next round's countdown

  private isMe: (key: string | null) => boolean;

  constructor(host: HTMLElement, isMe: (key: string | null) => boolean) {
    this.isMe = isMe;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "") => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      return e;
    };
    this.pops = el("div", "fg-pops");
    this.pops.setAttribute("aria-live", "polite");
    this.strip = el("div", "fg-strip");
    this.strip.setAttribute("role", "status");
    this.strip.hidden = true;
    this.stripSpin = el("span", "fg-spin");
    this.stripText = el("span");
    this.strip.append(this.stripSpin, this.stripText);
    this.mid = el("div", "fg-mid");
    this.mid.hidden = true;
    this.midKick = el("div", "fg-mid-kick");
    this.midTitle = el("div", "fg-mid-title");
    this.midNext = el("div", "fg-mid-next");
    this.mid.append(this.midKick, this.midTitle, this.midNext);
    host.append(this.mid, this.strip, this.pops);
    setInterval(() => {
      if (this.counting) this.paintNext();
    }, 250);
  }

  // A popup for a few seconds; at most two show, the newest on top. error: a move failed (red).
  popup(text: string, error = false): void {
    const p = document.createElement("div");
    p.className = error ? "fg-pop fg-error" : "fg-pop";
    p.textContent = text;
    this.pops.prepend(p);
    while (this.pops.children.length > MAX_POPS) this.pops.lastElementChild?.remove();
    const ms = error ? ERROR_MS : POP_MS;
    window.setTimeout(() => p.classList.add("fg-fade"), ms - FADE_MS);
    window.setTimeout(() => p.remove(), ms);
  }

  // The status strip: a notice, or null to clear it. A spinner shows while the page is waiting on the server.
  ribbon(text: string | null, alert = false): void {
    this.ribbonText = text;
    this.ribbonAlert = alert;
    this.paintStrip();
  }

  // The page lost the game server (the dock knows): this wins over any other notice
  setOffline(on: boolean): void {
    if (on === this.offline) return;
    this.offline = on;
    this.paintStrip();
  }

  private paintStrip(): void {
    const text = this.offline ? COPY.network.offline : this.ribbonText;
    this.strip.hidden = text === null;
    if (text === null) return;
    this.stripText.textContent = text;
    const waiting = this.offline || text === T.connecting || text === COPY.network.unreachable;
    this.stripSpin.hidden = !waiting;
    this.strip.classList.toggle("fg-alert", !this.offline && this.ribbonAlert);
  }

  // The box in the middle of the field, from the round's state
  show(state: FieldState, king: Identity | null): void {
    this.counting = false;
    this.mid.className = "fg-mid";
    const box = (kind: string, kick: string, title: string) => {
      this.mid.classList.add(kind);
      this.midKick.textContent = kick;
      this.midKick.hidden = kick === "";
      this.midTitle.textContent = title;
      this.midNext.textContent = "";
      this.mid.hidden = false;
    };
    if (state.status === "waiting") return box("fg-waiting", "", T.waitingTitle);
    if (state.status === "open") {
      this.mid.hidden = true;
      return;
    }
    if (state.status === "over") {
      // Time is up and the winner has not claimed yet
      if (this.isMe(state.king)) return box("fg-won", T.roundOverKick, COPY.kingdom.wonTitle);
      return box("fg-over", T.roundOverKick, king ? T.popWins(king.name, money(state.treasury)) : COPY.kingdom.finished);
    }
    // Settled: who won, and when the next round starts
    const title = !king ? COPY.kingdom.finished
      : isCancelled(state) ? T.roundCancelled
      : state.conquests === 0 ? T.noChallengers
      : T.popWins(king.name, money(state.payout ?? state.treasury));
    box("fg-over", T.roundOverKick, title);
    this.counting = true;
    this.paintNext();
  }

  // "Next round in 0:07", the time in gold
  private paintNext(): void {
    const line = nextRoundLine();
    if (this.midNext.dataset.line === line) return;
    this.midNext.dataset.line = line;
    this.midNext.textContent = "";
    const m = /^(.*\s)(\d+:\d{2})$/.exec(line);
    if (!m) {
      this.midNext.textContent = line;
      return;
    }
    const strong = document.createElement("strong");
    strong.textContent = m[2]!;
    this.midNext.append(m[1]!, strong);
  }
}
