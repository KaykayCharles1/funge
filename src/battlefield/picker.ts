// "Choose your king": before a player's first open or conquest in a round, they pick a portrait and a name. The window
// only collects the choice; the page sends it with the move and the referee has the final word (server/players.ts).
// Names are shown only as text (textContent), never as HTML. Keyboard: Tab stays inside, Esc closes.
import { COPY } from "../copy.ts";
import type { PlayerProfile } from "../referee/api.ts";
import { checkName, nameKey } from "../lib/playerName.ts";
import { css } from "./hud.ts";
import "./dialogs.css";
import { HOUSES, type Portrait } from "./identity.ts";

const T = COPY.battlefield;
const LAST_KEY = "funge:profile"; // the last choice, in this browser only
const base = `${import.meta.env.BASE_URL}assets/`;

export type PickerOpen = {
  portraits: Portrait[];
  players: Record<string, PlayerProfile>; // who already chose what in this round
  confirmLabel: () => string | null; // "Conquer 10.20 PUSD", live; null when the move is no longer possible
  onConfirm: (profile: { name: string; avatarId: string }) => void;
};

export function lastChoice(): { name: string; avatarId: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? "null") as { name?: unknown; avatarId?: unknown } | null;
    return v && typeof v.name === "string" && typeof v.avatarId === "string" ? { name: v.name, avatarId: v.avatarId } : null;
  } catch {
    return null;
  }
}
function remember(p: { name: string; avatarId: string }): void {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(p));
  } catch {
    // private window or blocked storage: nothing to remember
  }
}

const houseOf = (p: Portrait | undefined) => HOUSES.find((h) => h.id === p?.house) ?? HOUSES[0]!;

let openNow: (() => void) | null = null; // closes the window that is open, if any

export function openPicker(o: PickerOpen): void {
  openNow?.();
  const back = document.activeElement as HTMLElement | null;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => {
    const e = document.createElement(tag);
    e.className = cls;
    e.textContent = text;
    return e;
  };
  const takenAvatars = new Set(Object.values(o.players).map((p) => p.avatarId));
  const takenNames = new Set(Object.values(o.players).map((p) => nameKey(p.name)));
  const free = o.portraits.filter((p) => !takenAvatars.has(p.id));

  const last = lastChoice();
  let chosen: Portrait | undefined = o.portraits.find((p) => p.id === last?.avatarId && !takenAvatars.has(p.id)) ?? free[0];

  const overlay = el("div", "fg-dlg-back");
  const box = el("div", "fg-dlg fg-picker");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-labelledby", "pickTitle");
  const title = el("h2", "fg-dlg-title", T.pickTitle);
  title.id = "pickTitle";

  // the portraits
  const grid = el("div", "fg-portraits");
  grid.setAttribute("role", "radiogroup");
  grid.setAttribute("aria-label", T.pickPortraits);
  const tiles = o.portraits.map((p) => {
    const taken = takenAvatars.has(p.id);
    const b = el("button", "fg-portrait");
    b.type = "button";
    b.disabled = taken;
    b.setAttribute("role", "radio");
    b.setAttribute("aria-label", taken ? T.pickTakenAria(p.title) : T.pickPortraitAria(p.title, houseName(p)));
    // The whole portrait, so the colour of the outfit (the house) shows
    const img = el("img");
    (img as HTMLImageElement).src = base + p.image;
    (img as HTMLImageElement).alt = "";
    b.append(img);
    if (taken) b.append(el("span", "fg-taken", T.pickTaken));
    b.addEventListener("click", () => {
      chosen = p;
      render();
    });
    grid.append(b);
    return { p, b };
  });

  // the name
  const nameRow = el("div", "fg-name-row");
  const input = el("input", "fg-name-input") as HTMLInputElement;
  input.id = "pickName";
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.maxLength = 40; // room for a pasted "King " before it is stripped; the rule is checked below
  input.value = last?.name ?? "";
  input.placeholder = T.pickNameLabel;
  input.setAttribute("aria-label", T.pickNameLabel);
  input.setAttribute("aria-describedby", "pickProblem"); // what is wrong with the name, if anything
  const problem = el("p", "fg-problem");
  problem.id = "pickProblem";
  problem.setAttribute("aria-live", "polite");
  nameRow.append(input, problem);

  // the preview card in the house colour
  const preview = el("div", "fg-preview");
  const pImg = el("img") as HTMLImageElement;
  pImg.alt = "";
  const pText = el("div");
  pText.style.cssText = "display:flex;flex-direction:column;min-width:0";
  const pName = el("span", "fg-preview-name");
  const pHouse = el("span", "fg-preview-house");
  pText.append(pName, pHouse);
  preview.append(pImg, pText);

  // the buttons
  const cancel = el("button", "fg-outline", T.pickCancel);
  cancel.type = "button";
  const confirm = el("button", "fg-gold");
  confirm.type = "button";
  const bottom = el("div", "fg-pick-foot");
  bottom.append(preview, cancel, confirm);
  box.append(title, grid, nameRow, bottom);
  overlay.append(box);
  document.body.append(overlay);

  function houseName(p: Portrait | undefined): string {
    return T.houseName(houseOf(p).id);
  }

  // What is wrong with the name right now, in words (the referee checks again)
  function nameProblem(): string | null {
    const c = checkName(input.value);
    if (!c.ok) return input.value.trim() === "" ? T.pickNeedName : T.pickProblem[c.problem];
    if (takenNames.has(c.key)) return T.pickProblem.taken;
    return null;
  }

  function render(): void {
    for (const { p, b } of tiles) {
      const on = p === chosen;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on || (!chosen && p === free[0]) ? 0 : -1;
      b.style.borderColor = on ? css(houseOf(p).color) : "#2a3550";
      b.style.background = on ? "#1f2b4d" : "transparent";
    }
    const c = checkName(input.value);
    const shown = c.ok ? c.name : input.value.trim();
    const err = chosen ? nameProblem() : T.pickChoosePortrait;
    problem.textContent = input.value === "" && chosen ? "" : err ?? "";
    const h = houseOf(chosen);
    preview.style.borderColor = css(h.color);
    pImg.style.borderColor = css(h.color);
    if (chosen) pImg.src = base + chosen.image;
    pName.textContent = chosen ? `${chosen.title} ${shown || "…"}` : "…";
    pName.style.color = css(h.text);
    pHouse.textContent = houseName(chosen);
    pHouse.style.color = css(h.text);
    const label = o.confirmLabel();
    confirm.textContent = label ?? T.pickClosed;
    confirm.disabled = !chosen || err !== null || label === null;
  }

  function close(): void {
    openNow = null;
    clearInterval(timer);
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    back?.focus();
  }
  openNow = close;

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "Tab") {
      // keep the focus inside the window
      const items = [...box.querySelectorAll<HTMLElement>("button, input")].filter((x) => !(x as HTMLButtonElement).disabled && x.tabIndex !== -1);
      if (items.length === 0) return;
      const first = items[0]!, lastItem = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        first.focus();
      }
    }
    // arrow keys move between portraits
    if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && tiles.some((t) => t.b === document.activeElement)) {
      e.preventDefault();
      const open = tiles.filter((t) => !t.b.disabled);
      const at = open.findIndex((t) => t.b === document.activeElement);
      const next = open[(at + (e.key === "ArrowRight" ? 1 : open.length - 1)) % open.length];
      if (next) {
        chosen = next.p;
        render();
        next.b.focus();
      }
    }
  }
  document.addEventListener("keydown", onKey, true);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  cancel.addEventListener("click", close);
  input.addEventListener("input", render);
  confirm.addEventListener("click", () => {
    const c = checkName(input.value);
    if (!chosen || !c.ok || confirm.disabled) return;
    const profile = { name: c.name, avatarId: chosen.id };
    remember(profile);
    close();
    o.onConfirm(profile);
  });
  const timer = setInterval(render, 500); // the price on the confirm button follows the round
  render();
  (chosen ? tiles.find((t) => t.p === chosen)?.b : input)?.focus();
}
