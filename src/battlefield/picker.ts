// "Choose your king": before a player's first open or conquest in a round, they pick a portrait and a name. The window
// only collects the choice; the page sends it with the move and the referee has the final word (server/players.ts).
// Names are shown only as text (textContent), never as HTML. Keyboard: Tab stays inside, Esc closes.
import { COPY } from "../copy.ts";
import type { PlayerProfile } from "../referee/api.ts";
import { checkName, NAME_MAX, nameKey } from "../lib/playerName.ts";
import { css } from "./hud.ts";
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

function lastChoice(): { name: string; avatarId: string } | null {
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
const BTN = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl px-4 py-2 font-bold " +
  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 disabled:cursor-not-allowed";

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
  const housesInUse = new Set(Object.values(o.players).map((p) => p.house).filter(Boolean));
  const free = o.portraits.filter((p) => !takenAvatars.has(p.id));

  const last = lastChoice();
  let chosen: Portrait | undefined = o.portraits.find((p) => p.id === last?.avatarId && !takenAvatars.has(p.id)) ?? free[0];

  const overlay = el("div", "fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4");
  const box = el("div", "max-h-full w-full max-w-xl overflow-y-auto rounded-2xl border-2 border-[#e0a93a] bg-[#0f1a33] p-4 text-[#f4ead2] shadow-2xl sm:p-6");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-labelledby", "pickTitle");
  const title = el("h2", "text-2xl font-extrabold text-[#e0a93a]", T.pickTitle);
  title.id = "pickTitle";
  const intro = el("p", "mt-1 text-sm text-[#f4ead2]/80", T.pickIntro);

  // the portraits
  const grid = el("div", "mt-3 grid grid-cols-5 gap-2");
  grid.setAttribute("role", "radiogroup");
  grid.setAttribute("aria-label", T.pickPortraits);
  const tiles = o.portraits.map((p) => {
    const taken = takenAvatars.has(p.id);
    const b = el("button", "relative flex min-h-11 flex-col items-center gap-1 rounded-xl border-2 p-1 text-xs focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-40");
    b.type = "button";
    b.disabled = taken;
    b.setAttribute("role", "radio");
    b.setAttribute("aria-label", taken ? T.pickTakenAria(p.title) : T.pickPortraitAria(p.title, houseName(p)));
    const img = el("img", "aspect-square w-full rounded-lg object-cover");
    (img as HTMLImageElement).src = base + p.avatar;
    (img as HTMLImageElement).alt = "";
    b.append(img, el("span", "font-semibold", taken ? T.pickTaken : p.title));
    b.addEventListener("click", () => {
      chosen = p;
      render();
    });
    grid.append(b);
    return { p, b };
  });

  // the name
  const nameRow = el("div", "mt-3 flex flex-col gap-1");
  const label = el("label", "text-sm font-semibold", T.pickNameLabel);
  label.setAttribute("for", "pickName");
  const inputRow = el("div", "flex gap-2");
  const input = el("input", "min-h-11 grow rounded-xl border-2 border-[#2a3550] bg-[#0b1226] px-3 text-lg text-[#f4ead2] focus-visible:border-[#e0a93a] focus-visible:outline-none") as HTMLInputElement;
  input.id = "pickName";
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.maxLength = 40; // room for a pasted "King " before it is stripped; the rule is checked below
  input.value = last?.name ?? "";
  input.setAttribute("aria-describedby", "pickRules pickProblem");
  const random = el("button", `${BTN} border-2 border-[#e0a93a] bg-[#0f1a33] hover:bg-[#1f2b4d]`, T.pickRandom);
  random.type = "button";
  inputRow.append(input, random);
  const rules = el("p", "text-xs text-[#f4ead2]/70", T.pickRules);
  rules.id = "pickRules";
  const counter = el("span", "text-xs text-[#f4ead2]/70");
  const problem = el("p", "min-h-5 text-sm text-rose-300");
  problem.id = "pickProblem";
  problem.setAttribute("aria-live", "polite");
  const rulesRow = el("div", "flex items-start justify-between gap-2");
  rulesRow.append(rules, counter);
  nameRow.append(label, inputRow, rulesRow, problem);

  // the preview card in the house colour
  const preview = el("div", "mt-2 flex items-center gap-3 rounded-2xl border-4 bg-[#0b1226] p-3");
  const pImg = el("img", "h-16 w-16 rounded-full border-4 object-cover") as HTMLImageElement;
  pImg.alt = "";
  const pText = el("div", "flex flex-col");
  const pName = el("span", "text-xl font-extrabold");
  const pHouse = el("span", "text-sm");
  const pHint = el("span", "text-xs text-amber-200");
  pText.append(pName, pHouse, pHint);
  preview.append(pImg, pText);

  // the buttons
  const actions = el("div", "mt-3 flex flex-wrap justify-end gap-2");
  const cancel = el("button", `${BTN} border-2 border-[#e0a93a] bg-[#0f1a33] hover:bg-[#1f2b4d]`, T.pickCancel);
  cancel.type = "button";
  const confirm = el("button", `${BTN} bg-[#e0a93a] text-[#0f1a33] enabled:hover:bg-amber-300 disabled:bg-[#2a3550] disabled:text-[#f4ead2]/60`);
  confirm.type = "button";
  actions.append(cancel, confirm);

  box.append(title, intro, grid, nameRow, preview, actions);
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
    counter.textContent = T.pickCounter([...(c.ok ? c.name : input.value.trim())].length, NAME_MAX);
    const err = chosen ? nameProblem() : T.pickChoosePortrait;
    problem.textContent = input.value === "" && chosen ? "" : err ?? "";
    const h = houseOf(chosen);
    preview.style.borderColor = css(h.color);
    pImg.style.borderColor = css(h.color);
    if (chosen) pImg.src = base + chosen.avatar;
    pName.textContent = chosen ? `${chosen.title} ${shown || "…"}` : "…";
    pName.style.color = css(h.text);
    pHouse.textContent = houseName(chosen);
    pHouse.style.color = css(h.text);
    pHint.textContent = chosen && housesInUse.has(h.id) ? T.pickHouseInUse(houseName(chosen)) : "";
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
  random.addEventListener("click", () => {
    const names = T.randomNames.filter((n) => !takenNames.has(nameKey(n)));
    if (free.length > 0) chosen = free[Math.floor(Math.random() * free.length)];
    input.value = names[Math.floor(Math.random() * names.length)] ?? "";
    render();
  });
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
