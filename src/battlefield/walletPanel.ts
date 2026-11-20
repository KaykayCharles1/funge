// The Wallet tab's screens for getting into a wallet: Pick a Wallet, the Funge Game Wallet start, Create (password,
// then the recovery phrase), Import (12 or 24 words, then a password), the locked screen, Forgot Password and Reset.
// A wallet made before passwords were required gets the Create a password screen once.
// From the approved mockup (docs/REDESIGN_CHECKLIST.md, section 10). The vault (src/wallet/) does the keeping; this
// file only talks to it, then tells the old wallet code (walletUI.ts) so balances and listeners follow.
// Until the next sub-steps, a ready wallet and WizardConnect still show the old sections, moved into this tab.
import "./walletPanel.css";
import { COPY } from "../copy.ts";
import { CONFIG } from "../config.ts";
import { claimFaucet, faucetBusy } from "../faucetUI.ts";
import { formatUnits } from "../lib/format.ts";
import { FAUCET } from "../refereeParams.ts";
import { disconnectWallet, getWalletState, setExternalFlag, startConnection } from "../bch_wallet.ts";
import { pusdCategory } from "../config.ts";
import { lockToAddress, p2pkhLock } from "../lib/chain.ts";
import { qrDataUrl } from "../lib/qr.ts";
import { walletChanged } from "../walletUI.ts";
import { hexToBin } from "@bitauth/libauth";
import { isValidMnemonic, newMnemonic, normalizeMnemonic } from "../wallet/local.ts";
import { requestPersistentStorage, vault } from "../wallet/vault.ts";
import type { PageView } from "./actions.ts";

const T = COPY.walletPanel;
const MIN_PW = 8; // the vault's own minimum
const base = `${import.meta.env.BASE_URL}assets/`;

type Screen = "pick" | "start" | "pw" | "phrase" | "import" | "locked" | "forgot" | "home" | "backup" | "delete" | "swap-old" | "withdraw-old" | "wc";
const OLD_TOOLS: Screen[] = ["swap-old", "withdraw-old"]; // the swap and withdraw boxes (their own code, restyled here)
const ONBOARDING: Screen[] = ["start", "pw", "phrase", "import"];

const svg = (inner: string, size = 22, w = 2.2) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICON = {
  arrow: svg('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  chevron: svg('<path d="M15 6l-6 6 6 6"/>', 18, 2.4),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', 20, 2),
  eyeOff: svg('<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.3 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>', 54, 1.8),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', 32, 2),
  lockSmall: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', 18, 2.2),
  disconnect: svg('<path d="M8 6.5 16 4l1.2 2.5"/><path d="M13.5 19H19a2 2 0 0 0 2-2V8.5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v2.5"/><path d="M17 12.5h.5"/><circle cx="7.5" cy="16.5" r="4.5"/><path d="M5.9 14.9l3.2 3.2M9.1 14.9l-3.2 3.2"/>', 20, 2),
  lockAsk: svg('<rect x="4.5" y="10.5" width="15" height="11" rx="2.2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/><path d="M10.4 14.6a1.7 1.7 0 1 1 2.4 1.6c-.5.3-.8.6-.8 1.2"/><path d="M12 19.3v.2"/>', 44, 1.9),
  alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/>', 20, 2),
  shield: svg('<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><circle cx="12" cy="11" r="1.6"/><path d="M12 12.6V15"/>', 40, 1.8),
  tick: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0f243d" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
};

// Password boxes the browser leaves alone: no "strong password" suggestion and no offer to save it. A text box
// whose letters are drawn as dots does that; a browser that cannot draw them so gets a password box with autofill off.
const MASKS = typeof CSS !== "undefined" && CSS.supports("-webkit-text-security", "disc");
export function secretInput(placeholder: string, cls = ""): { input: HTMLInputElement; reveal: (on: boolean) => void } {
  const input = document.createElement("input");
  if (cls) input.className = cls;
  input.type = MASKS ? "text" : "password";
  if (MASKS) input.classList.add("fg-w-secret");
  input.autocomplete = "off";
  input.name = `fg-${Math.random().toString(36).slice(2)}`; // no name a password manager knows
  input.spellcheck = false;
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("autocorrect", "off");
  for (const a of ["data-lpignore", "data-1p-ignore", "data-bwignore", "data-form-type"]) input.setAttribute(a, a === "data-form-type" ? "other" : "true");
  input.placeholder = placeholder;
  input.setAttribute("aria-label", placeholder);
  return {
    input,
    reveal: (on) => {
      if (MASKS) input.classList.toggle("fg-w-secret", !on);
      else input.type = on ? "text" : "password";
    },
  };
}

// The own wallet's balances, once read (the dock's wallet chip shows them)
let ownBalances: { pusd: bigint; sats: bigint; pkhHex: string } | null = null;
export const ownWalletBalances = () => {
  const w = getWalletState();
  return w.status === "connected" && ownBalances && ownBalances.pkhHex === w.pkhHex ? ownBalances : null;
};

// A long press shows a round button's tip on a touch screen; the tap that ends that press does nothing else
function holdTip(b: HTMLButtonElement): HTMLButtonElement {
  let timer = 0, held = false;
  b.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    held = false;
    timer = window.setTimeout(() => {
      held = true;
      b.classList.add("fg-tip-on");
    }, 450);
  });
  const end = () => {
    clearTimeout(timer);
    window.setTimeout(() => b.classList.remove("fg-tip-on"), 1200);
  };
  for (const t of ["pointerup", "pointercancel", "pointerleave"] as const) b.addEventListener(t, end);
  b.addEventListener("contextmenu", (e) => e.preventDefault());
  b.addEventListener("click", (e) => {
    if (!held) return;
    held = false;
    e.stopImmediatePropagation(); // the press showed the tip; it does not also lock or disconnect
  }, { capture: true });
  return b;
}

export function mountWalletPanel(page: HTMLElement, view: () => PageView): { onOpen: () => void } {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };
  const button = (cls: string, text: string, onClick: () => void) => {
    const b = el("button", cls, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  };
  const icon = (html: string) => {
    const s = el("span");
    s.style.display = "inline-flex";
    s.innerHTML = html; // fixed icons only
    return s;
  };

  const box = el("div", "fg-w");
  page.prepend(box);
  // The old swap, withdraw and seed boxes wait here, with their handlers, until their screens are rebuilt
  const hold = el("div", "fg-w-hold");
  box.after(hold);
  for (const id of ["swBox", "swReview", "wdBox"]) {
    const e = document.getElementById(id);
    if (e) hold.append(e);
  }
  hold.addEventListener("withdraw-done", () => go("home"));
  const old = {
    local: document.getElementById("localWallet"),
    own: document.getElementById("wallet"),
    faucet: document.getElementById("faucet"),
  };

  // What the player is doing (secrets live only here, and only until the wallet is saved)
  let screen: Screen = "pick";
  let flow: "create" | "import" = "create";
  let mnemonic: string | null = null;
  let p1 = "", p2 = "";
  let saved = false;
  let words: string[] = [];
  let long = false; // 24 words
  let error = "";
  let wantsOwn = false; // picked WizardConnect
  let backupWords: string | null = null; // the seed phrase, only while the Backup screen shows it
  let pickFirst = false; // the player stepped back to Pick a Wallet (or reset): a locked wallet waits behind it

  const clearSecrets = () => {
    mnemonic = null;
    p1 = p2 = "";
    saved = false;
    words = [];
    long = false;
  };

  // The screen the wallet's state calls for (an onboarding flow in progress keeps its screen)
  function auto(): Screen {
    const own = getWalletState().status !== "idle";
    if (own || wantsOwn) return "wc";
    const state = vault.state();
    if (state === "unlocked") return !vault.hasPassword() ? "pick" : [...OLD_TOOLS, "backup", "delete"].includes(screen) ? screen : "home";
    if (state === "locked") return pickFirst ? "pick" : screen === "forgot" ? "forgot" : "locked";
    return ONBOARDING.includes(screen) ? screen : "pick";
  }

  function go(next: Screen): void {
    if (next !== screen) error = "";
    if (next !== "backup") backupWords = null;
    screen = next;
    draw();
  }

  function draw(): void {
    box.replaceChildren();
    for (const e of [old.local, old.own, old.faucet]) if (e) e.style.display = "none"; // the old sections are no longer shown
    hold.hidden = !OLD_TOOLS.includes(screen);
    if (OLD_TOOLS.includes(screen)) return oldTool();
    const build = { pick, start, pw: password, phrase, import: importScreen, locked, forgot, home, backup, delete: deleteScreen, wc: wcScreen }[screen as Exclude<Screen, "swap-old" | "withdraw-old">];
    build?.();
  }

  // ---- pieces ----
  const steps = (index: number, onBack: () => void) => {
    const bar = el("div", "fg-w-steps");
    const back = button("fg-w-back", "", onBack);
    back.setAttribute("aria-label", T.back);
    back.append(icon(ICON.arrow));
    const dots = el("div", "fg-w-dots");
    for (let i = 0; i < 3; i++) dots.append(el("span", i <= index ? "fg-w-dot fg-on" : "fg-w-dot"));
    bar.append(back, dots);
    return bar;
  };
  const walletBack = (onClick: () => void) => {
    const b = button("fg-w-back", "", onClick);
    b.append(icon(ICON.chevron), T.walletBack);
    return b;
  };
  const errLine = () => {
    const p = el("p", "fg-w-err", error);
    p.setAttribute("role", "alert");
    return p;
  };
  // A gold button that is on only when ready() says so
  const goldWhen = (text: string, ready: () => boolean, onClick: () => void) => {
    const b = button("fg-w-gold", text, () => {
      if (ready()) onClick();
    });
    const refresh = () => (b.disabled = !ready());
    refresh();
    return { b, refresh };
  };

  // ---- Pick a Wallet ----
  function pick(): void {
    const row = (label: string, img: string, white: boolean, onClick: () => void) => {
      const b = button("fg-w-row", "", onClick);
      const ic = el("span", white ? "fg-w-icon fg-white" : "fg-w-icon");
      const i = el("img");
      i.src = base + img;
      i.alt = "";
      i.style.width = white ? "40px" : "34px";
      ic.append(i);
      b.append(ic, label);
      return b;
    };
    const t = el("h2", "fg-w-title", T.pickTitle);
    t.style.fontSize = "32px";
    t.style.marginBottom = "10px";
    box.append(
      t,
      row(T.gameWallet, "icons/crown.webp", false, () => {
        pickFirst = false;
        go(vault.state() === "none" ? "start" : auto());
      }),
      row(T.wizardConnect, "icons/wizardconnect.png", true, () => {
        wantsOwn = true;
        setExternalFlag(true);
        if (getWalletState().status === "idle") startConnection(true);
        go("wc");
      }),
    );
  }

  // ---- Funge Game Wallet start ----
  function start(): void {
    const crown = el("img");
    crown.src = `${base}icons/crown.webp`;
    crown.alt = "";
    crown.style.cssText = "width: 76px; margin: 26px auto 0";
    const t = el("h2", "fg-w-title fg-w-center", T.gameWallet);
    t.style.fontSize = "34px";
    const text = el("p", "fg-w-mute fg-w-center", T.startText);
    text.style.marginBottom = "120px";
    box.append(
      steps(0, () => go("pick")), crown, t, text,
      button("fg-w-gold", T.createNew, () => {
        clearSecrets();
        flow = "create";
        mnemonic = newMnemonic();
        go("pw");
      }),
      button("fg-w-dark", T.haveWallet, () => {
        clearSecrets();
        flow = "import";
        go("import");
      }),
    );
  }

  // ---- Create a password (create and import) ----
  function password(): void {
    const hint = el("p", "fg-w-err");
    const field = (placeholder: string, value: string, onInput: (v: string) => void) => {
      const wrap = el("div", "fg-w-pw");
      const { input, reveal } = secretInput(placeholder);
      input.value = value;
      input.addEventListener("input", () => {
        onInput(input.value);
        update();
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") cont.b.click();
      });
      const eye = button("fg-w-eye", "", () => {
        const showing = eye.getAttribute("aria-pressed") === "true";
        reveal(!showing);
        eye.setAttribute("aria-pressed", String(!showing));
      });
      eye.setAttribute("aria-label", T.showPassword);
      eye.setAttribute("aria-pressed", "false");
      eye.append(icon(ICON.eye));
      wrap.append(input, eye);
      return { wrap, input };
    };
    const ok = () => p1.length >= MIN_PW && p1 === p2;
    const a = field(T.password, p1, (v) => (p1 = v));
    const b = field(T.confirmPassword, p2, (v) => (p2 = v));
    const cont = goldWhen(T.continue, ok, () => {
      if (flow === "create") go("phrase");
      else void save(mnemonic!, p1);
    });
    function update(): void {
      const text = p1 === "" ? "" : p1.length < MIN_PW ? T.pwShort : p2 === "" ? "" : p1 !== p2 ? T.pwMismatch : T.pwMatch;
      hint.textContent = text;
      hint.classList.toggle("fg-w-ok", text === T.pwMatch);
      cont.refresh();
    }
    const head = el("div", "fg-w fg-w-center");
    head.style.paddingTop = "40px";
    head.append(el("h2", "fg-w-title", T.pwTitle), el("p", "fg-w-mute", T.pwText));
    const spacer = el("div");
    spacer.style.height = "90px";
    box.append(steps(flow === "create" ? 1 : 2, () => go(flow === "create" ? "start" : "import")));
    box.append(head, a.wrap, b.wrap, hint, spacer, cont.b, errLine());
    update();
    a.input.focus();
  }

  // ---- Recovery phrase (create): blurred until pointed at or held; never selectable or copyable ----
  function phrase(): void {
    const seed = el("div", "fg-w-seed");
    seed.setAttribute("role", "img");
    seed.setAttribute("aria-label", T.phraseAria);
    const grid = el("div", "fg-w-seedgrid");
    (mnemonic ?? "").split(" ").forEach((w, i) => {
      const cell = el("div", "fg-w-word");
      cell.append(el("i", "", String(i + 1)), el("b", "", w));
      grid.append(cell);
    });
    const eye = el("div", "fg-w-seedeye");
    eye.innerHTML = ICON.eyeOff;
    seed.append(grid, eye);
    for (const t of ["copy", "cut", "contextmenu", "dragstart", "selectstart"] as const) seed.addEventListener(t, (e) => e.preventDefault());
    seed.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse") seed.classList.add("fg-held");
    });
    for (const t of ["pointerup", "pointercancel", "pointerleave"] as const) seed.addEventListener(t, () => seed.classList.remove("fg-held"));

    const check = button("fg-w-check", "", () => {
      saved = !saved;
      paint();
    });
    check.setAttribute("role", "checkbox");
    const boxEl = el("span", "fg-w-box");
    check.append(boxEl, T.saved);
    const cont = goldWhen(T.continue, () => saved, () => void save(mnemonic!, p1));
    function paint(): void {
      check.setAttribute("aria-checked", String(saved));
      boxEl.innerHTML = saved ? ICON.tick : "";
      cont.refresh();
    }
    const head = el("div", "fg-w fg-w-center");
    head.style.paddingTop = "24px";
    head.append(el("h2", "fg-w-title", T.phraseTitle), el("p", "fg-w-warn", T.phraseWarn));
    box.append(steps(2, () => go("pw")), head, seed, check, cont.b, errLine());
    paint();
  }

  // ---- Import: type or paste the words ----
  function importScreen(): void {
    const head = el("div", "fg-w fg-w-center");
    head.style.paddingTop = "16px";
    head.append(el("h2", "fg-w-title", T.phraseTitle), el("p", "fg-w-mute", T.importText));
    const grid = el("div", "fg-w-words");
    const inputs: HTMLInputElement[] = [];
    const ready = () => {
      const n = long ? 24 : 12;
      return Array.from({ length: n }, (_, i) => (words[i] ?? "").trim()).every((w) => /^[a-z]+$/i.test(w));
    };
    const imp = goldWhen(T.importBtn, ready, () => {
      const phrase = normalizeMnemonic(words.slice(0, long ? 24 : 12).join(" "));
      if (!isValidMnemonic(phrase)) {
        err.textContent = error = T.badPhrase;
        return;
      }
      mnemonic = phrase;
      go("pw");
    });
    const err = errLine();
    const fill = (from: number, text: string) => {
      const parts = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
      parts.forEach((w, k) => (words[from + k] = w));
      if (from + parts.length > 12 && !long) {
        long = true;
        go("import"); // redraw with 24 boxes
        return;
      }
      inputs.forEach((inp, i) => (inp.value = words[i] ?? ""));
      inputs[Math.min(from + parts.length, inputs.length - 1)]?.focus();
      imp.refresh();
    };
    for (let i = 0; i < (long ? 24 : 12); i++) {
      const label = el("label", "fg-w-wordin");
      const input = el("input");
      input.type = "text";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.setAttribute("autocapitalize", "off");
      input.setAttribute("aria-label", T.wordAria(i + 1));
      input.value = words[i] ?? "";
      input.addEventListener("paste", (e) => {
        const text = e.clipboardData?.getData("text") ?? "";
        if (text.trim().split(/\s+/).length > 1) {
          e.preventDefault();
          fill(i, text);
        }
      });
      input.addEventListener("input", () => {
        if (/\s/.test(input.value.trim())) return fill(i, input.value);
        words[i] = input.value.trim().toLowerCase();
        imp.refresh();
      });
      inputs.push(input);
      label.append(el("span", "", `${i + 1}.`), input);
      grid.append(label);
    }
    box.append(steps(1, () => go("start")), head, grid, imp.b, err);
    inputs[0]?.focus();
  }

  // ---- Locked ----
  function locked(): void {
    const badge = el("div", "fg-w-badge");
    badge.innerHTML = ICON.lock;
    badge.style.marginTop = "16px";
    const { input } = secretInput(T.password, "fg-w-input");
    const err = errLine();
    const unlock = async () => {
      if (!input.value) return;
      const ok = await vault.unlock(input.value);
      if (!ok) {
        err.textContent = error = T.wrongPassword;
        return;
      }
      input.value = "";
      walletChanged();
      go(auto());
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void unlock();
    });
    const head = el("div", "fg-w fg-w-center");
    head.append(badge, el("h2", "fg-w-title", T.lockedTitle), el("p", "fg-w-mute", T.lockedText));
    box.append(walletBack(() => {
      pickFirst = true;
      go("pick");
    }), head, input, button("fg-w-gold", T.unlock, () => void unlock()), button("fg-w-textlink", T.forgot, () => go("forgot")), err);
    input.focus();
  }

  // ---- Forgot password: reset the wallet ----
  function forgot(): void {
    const badge = el("div", "fg-w-badge fg-big");
    badge.innerHTML = ICON.lockAsk;
    badge.style.marginTop = "70px";
    const head = el("div", "fg-w fg-w-center");
    const t = el("h2", "fg-w-title", T.forgotTitle);
    t.style.fontSize = "32px";
    head.append(badge, t, el("p", "fg-w-mute", T.forgotText));
    const spacer = el("div");
    spacer.style.height = "160px";
    box.append(walletBack(() => go("locked")), head, spacer, button("fg-w-red", T.reset, confirmReset));
  }
  function confirmReset(): void {
    const modal = el("div", "fg-w-modal");
    const m = el("div", "fg-w-modal-box");
    m.setAttribute("role", "alertdialog");
    m.setAttribute("aria-modal", "true");
    const warn = el("p", "fg-w-mute", T.resetWarn);
    warn.style.color = "#fca5a5";
    const cancel = button("fg-w-line", T.cancel, () => modal.remove());
    const reset = button("fg-w-red", T.reset, async () => {
      await vault.wipe();
      clearSecrets();
      modal.remove();
      walletChanged();
      pickFirst = false;
      go("pick");
    });
    const two = el("div", "fg-w-two");
    two.append(cancel, reset);
    m.append(el("h2", "fg-w-title", T.resetTitle), el("p", "fg-w-mute", T.resetText), warn, two);
    modal.append(m);
    (page.closest(".fg-panel") ?? page).append(modal);
    cancel.focus();
  }

  // ---- The game wallet's home ----
  function home(): void {
    const w = vault.wallet();
    if (!w) return;
    // Title, then Lock and Disconnect at the right
    const top = el("div", "fg-w-top");
    const iconBtn = (label: string, html: string, onClick: () => void) => {
      const b = holdTip(button("fg-w-iconbtn", "", onClick));
      b.setAttribute("aria-label", label);
      b.append(icon(html), el("span", "fg-w-tip", label));
      return b;
    };
    const lock = iconBtn(T.lockWallet, ICON.lockSmall, () => {
      vault.lock();
      walletChanged();
      pickFirst = false;
      go("locked");
    });
    const disconnect = iconBtn(T.disconnectWallet, ICON.disconnect, () => {
      vault.lock(); // the wallet stays saved; picking it again asks for the password
      walletChanged();
      pickFirst = true;
      go("pick");
    });
    const icons = el("span", "fg-w-icons");
    icons.append(lock, disconnect);
    top.append(el("div", "fg-w-kick", T.gameWallet), icons);

    // Balances
    const coin = (src: string, label: string) => {
      const card = el("div", "fg-w-card fg-w-coin");
      const head = el("div", "fg-w-coinhead");
      const i = el("img");
      i.src = base + src;
      i.alt = "";
      head.append(i, label);
      const amount = el("div", "fg-w-amount", "—");
      card.append(head, amount);
      return { card, amount };
    };
    const pusd = coin("tokens/pusd.jpg", "PUSD"), bch = coin("tokens/bch.png", "BCH");
    const coins = el("div", "fg-w-coins");
    coins.append(pusd.card, bch.card);

    // Address
    const addr = el("div", "fg-w-addr");
    const full = w.tokenAddress;
    const shortAddr = full.length > 28 ? `${full.slice(0, 16)}…${full.slice(-8)}` : full;
    const addrText = el("span", "", shortAddr);
    addrText.setAttribute("aria-label", T.addressAria);
    addrText.title = full;
    const copy = button("fg-w-small", T.copyAddress, () => {
      void navigator.clipboard.writeText(full).then(() => {
        copy.textContent = T.copiedAddress;
        window.setTimeout(() => (copy.textContent = T.copyAddress), 1500);
      });
    });
    addr.append(addrText, copy);

    // Swap and Withdraw (the old boxes for now)
    const tools = el("div", "fg-w-two");
    tools.style.marginTop = "0";
    tools.append(
      button("fg-w-line", COPY.swap.button, () => go("swap-old")),
      button("fg-w-line", COPY.withdraw.button, () => go("withdraw-old")),
    );

    box.append(top, coins, addr, tools);
    if (CONFIG.network === "chipnet") box.append(faucetCard(w.pkhHex));

    // Back up and Delete (the old flows for now)
    const pills = el("div", "fg-w-pills");
    pills.append(
      button("fg-w-pill", T.backup, () => askPassword()),
      button("fg-w-pill fg-w-pill-red", T.deleteWallet, () => go("delete")),
    );
    box.append(pills);

    // Balances follow the wallet
    const num = (t: string, d: number) => {
      const m = /^([\d.]+)/.exec(t.trim());
      return m ? Number(m[1]).toFixed(d) : "—";
    };
    const paint = () => {
      const v = view().wallet;
      pusd.amount.textContent = num(v.pusdText, 2);
      bch.amount.textContent = num(v.bchText, 5);
    };
    paint();
    const timer = window.setInterval(() => (box.isConnected && screen === "home" ? paint() : window.clearInterval(timer)), 1000);
  }

  // Free test coins: Claim, then "Next claim in 23:59:59" for a day (counted from the claim, in this browser)
  function faucetCard(pkhHex: string): HTMLElement {
    const card = el("div", "fg-w-card fg-w-faucet");
    const plain = (t: string) => (t.includes(".") ? t.replace(/\.?0+$/, "") : t); // "20.00" -> "20", "0.00020000" -> "0.0002"
    const pusdAmt = plain(formatUnits(FAUCET.pusdUnits, CONFIG.pusdDecimals));
    const bchAmt = plain(formatUnits(FAUCET.sats, 8));
    const key = `funge:faucet:${pkhHex}`;
    const claimedAt = (): number | null => {
      try {
        const v = Number(localStorage.getItem(key));
        return v > 0 ? v : null;
      } catch {
        return null;
      }
    };
    const remember = () => {
      try {
        localStorage.setItem(key, String(Date.now()));
      } catch {
        // storage blocked: the countdown simply does not survive a reload
      }
    };
    const err = el("p", "fg-w-err");
    err.style.minHeight = "0";
    const btn = button("fg-w-gold", T.claim, async () => {
      if (btn.disabled) return;
      err.textContent = "";
      const r = await claimFaucet();
      if (r.ok || r.code === "already_claimed") remember();
      else if (r.code !== "no_wallet") err.textContent = COPY.faucet.errors[r.code] ?? COPY.faucet.errors.failed!;
      paint();
    });
    btn.style.height = "48px";
    btn.style.marginTop = "12px";
    const two = (n: number) => String(n).padStart(2, "0");
    const paint = () => {
      const at = claimedAt();
      const left = at === null ? 0 : Math.max(0, 86_400 - Math.floor((Date.now() - at) / 1000));
      btn.disabled = left > 0 || faucetBusy();
      btn.classList.toggle("fg-w-count", left > 0);
      btn.textContent = left > 0 ? T.nextClaim(`${two(Math.floor(left / 3600))}:${two(Math.floor(left / 60) % 60)}:${two(left % 60)}`) : T.claim;
    };
    card.append(el("div", "fg-w-kick", COPY.faucet.title), el("div", "fg-w-faucetline", T.faucetLine(pusdAmt, bchAmt)), btn, err);
    paint();
    const timer = window.setInterval(() => (card.isConnected ? paint() : window.clearInterval(timer)), 1000);
    return card;
  }

  // The old swap, withdraw or seed box, under a way back home
  function oldTool(): void {
    const ids = { "swap-old": "swBox", "withdraw-old": "wdBox" } as const;
    const id = ids[screen as keyof typeof ids];
    for (const e of Array.from(hold.children) as HTMLElement[]) if (e.id !== "swReview") e.style.display = e.id === id ? "" : "none";
    const opener = { "swap-old": "lwSwapBtn", "withdraw-old": "lwWithdrawBtn" } as const;
    const closer = { "swap-old": "lwSwapBtn", "withdraw-old": "wdCancel" } as const;
    const which = screen as keyof typeof ids;
    const target = document.getElementById(id);
    if (target?.classList.contains("hidden")) document.getElementById(opener[which])?.click();
    box.append(walletBack(() => {
      // close the old box the way its own code does
      const t = document.getElementById(id);
      if (t && !t.classList.contains("hidden")) document.getElementById(closer[which])?.click();
      go("home");
    }));
  }

  // ---- Back up: the password first (askPassword), then the words under a grey cover ----
  function backup(): void {
    const phrase = backupWords;
    if (!phrase) return go("home");
    const warn = el("div", "fg-w-redbox");
    warn.append(icon(ICON.alert), el("span", "", T.backupWarn));
    const seed = el("div", "fg-w-seed fg-w-backup fg-w-covered");
    seed.setAttribute("role", "img");
    seed.setAttribute("aria-label", T.seedAria);
    const grid = el("div", "fg-w-seedgrid");
    phrase.split(" ").forEach((w, i) => {
      const cell = el("div", "fg-w-word");
      cell.append(el("i", "", String(i + 1)), el("b", "", w));
      grid.append(cell);
    });
    const cover = button("fg-w-cover", "", () => {
      seed.classList.remove("fg-w-covered");
      cover.remove();
    });
    cover.append(icon(ICON.shield), el("span", "", T.showSeed));
    seed.append(grid, cover);
    for (const t of ["copy", "cut", "contextmenu", "dragstart", "selectstart"] as const) seed.addEventListener(t, (e) => e.preventDefault());
    const t = el("h2", "fg-w-title fg-w-center", T.backupTitle);
    const done = button("fg-w-gold", T.seedSaved, () => {
      backupWords = null; // the words leave the screen and this file's memory
      go("home");
    });
    box.append(walletBack(() => {
      backupWords = null;
      go("home");
    }), t, warn, seed, done);
  }

  // ---- Delete ----
  function deleteScreen(): void {
    const card = el("div", "fg-w-card fg-w-delete");
    const t = el("h2", "fg-w-title", T.deleteTitle);
    t.style.color = "#fecaca";
    t.style.fontSize = "28px";
    const text = el("p", "fg-w-mute", T.deleteText);
    text.style.marginTop = "8px";
    text.style.fontSize = "15px";
    const first = button("fg-w-pill", T.backupFirst, () => askPassword());
    first.style.marginTop = "12px";
    const two = el("div", "fg-w-two");
    two.style.marginTop = "16px";
    two.append(
      button("fg-w-line", T.cancel, () => go("home")),
      button("fg-w-red", T.deleteWallet, async () => {
        await vault.wipe();
        clearSecrets();
        walletChanged();
        pickFirst = false;
        go("pick");
      }),
    );
    card.append(t, text, first, two);
    box.append(walletBack(() => go("home")), card);
  }

  // The password box before the seed phrase shows: checked against the vault, which stays open as it was
  function askPassword(): void {
    const modal = el("div", "fg-w-modal");
    const m = el("div", "fg-w-modal-box fg-w-gold-box");
    m.setAttribute("role", "dialog");
    m.setAttribute("aria-modal", "true");
    const t = el("h2", "fg-w-title fg-w-center", T.backupTitle);
    const { input } = secretInput(T.confirmPassword2, "fg-w-input");
    input.style.height = "50px";
    const err = el("p", "fg-w-err");
    err.setAttribute("role", "alert");
    const close = () => {
      modal.remove();
      input.value = "";
    };
    const confirm = async () => {
      if (!input.value) return;
      const ok = await vault.unlock(input.value); // the same wallet opens again: a check, nothing changes
      if (!ok) {
        err.textContent = T.wrongPassword;
        return;
      }
      backupWords = vault.revealMnemonic();
      close();
      walletChanged();
      go("backup");
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void confirm();
      if (e.key === "Escape") close();
    });
    const two = el("div", "fg-w-two");
    two.append(button("fg-w-line", T.cancel, close), button("fg-w-gold", T.confirm, () => void confirm()));
    m.append(t, input, err, two);
    modal.append(m);
    (page.closest(".fg-panel") ?? page).append(modal);
    input.focus();
  }

  // ---- WizardConnect: the QR to scan, then the connected wallet ----
  function wcScreen(): void {
    const s = getWalletState();
    if (s.status === "connected") return wcConnected();
    const t = el("h2", "fg-w-title fg-w-center", T.wizardConnect);
    const err = el("p", "fg-w-err fg-w-center", s.error ?? "");
    const leave = () => {
      if (getWalletState().status !== "idle") void disconnectWallet();
      setExternalFlag(false);
      wantsOwn = false;
      pickFirst = true;
      go(auto());
    };
    box.append(walletBack(leave), t);
    if (s.status === "waiting" && s.qrUri) {
      const lead = el("p", "fg-w-mute fg-w-center", T.wcScan);
      const qr = el("img", "fg-w-qr");
      qr.src = qrDataUrl(s.qrUri);
      qr.alt = T.wcQrAlt;
      const row = el("div", "fg-w-qrbtns");
      const copy = button("fg-w-small", T.wcCopyLink, () => {
        const uri = getWalletState().uri;
        if (uri) void navigator.clipboard.writeText(uri).then(() => {
          copy.textContent = T.copiedAddress;
          window.setTimeout(() => (copy.textContent = T.wcCopyLink), 1500);
        });
      });
      row.append(copy, button("fg-w-small", T.cancel, leave));
      box.append(lead, qr, row, err);
    } else if (s.status === "waiting") {
      box.append(el("p", "fg-w-mute fg-w-center", T.wcReconnecting), err);
    } else {
      box.append(err);
    }
  }

  function wcConnected(): void {
    const s = getWalletState();
    const top = el("div", "fg-w-top");
    const off = holdTip(button("fg-w-iconbtn", "", () => {
      void disconnectWallet();
      setExternalFlag(false);
      wantsOwn = false;
      pickFirst = true;
      go(auto());
    }));
    off.setAttribute("aria-label", T.disconnectWallet);
    off.append(icon(ICON.disconnect), el("span", "fg-w-tip", T.disconnectWallet));
    top.append(el("div", "fg-w-kick", T.wizardConnect), off);

    const who = el("div", "fg-w-who");
    const hat = el("span", "fg-w-icon fg-white");
    const img = el("img");
    img.src = `${base}icons/wizardconnect.png`;
    img.alt = "";
    img.style.width = "40px";
    hat.append(img);
    const names = el("span", "fg-w-whonames");
    const ok = el("span", "fg-w-connected", T.wcConnected);
    names.append(el("span", "fg-w-whoname", s.walletName ?? T.wizardConnect), ok);
    who.append(hat, names);

    const coin = (src: string, label: string) => {
      const card = el("div", "fg-w-card fg-w-coin");
      const head = el("div", "fg-w-coinhead");
      const i = el("img");
      i.src = base + src;
      i.alt = "";
      head.append(i, label);
      const amount = el("div", "fg-w-amount", "—");
      card.append(head, amount);
      return { card, amount };
    };
    const pusd = coin("tokens/pusd.jpg", "PUSD"), bch = coin("tokens/bch.png", "BCH");
    const coins = el("div", "fg-w-coins");
    coins.append(pusd.card, bch.card);

    box.append(top, who, coins);
    if (s.pkhHex) {
      const full = lockToAddress(p2pkhLock(hexToBin(s.pkhHex)), true);
      const addr = el("div", "fg-w-addr");
      const text = el("span", "", full.length > 28 ? `${full.slice(0, 16)}…${full.slice(-8)}` : full);
      text.title = full;
      const copy = button("fg-w-small", T.copyAddress, () => {
        void navigator.clipboard.writeText(full).then(() => {
          copy.textContent = T.copiedAddress;
          window.setTimeout(() => (copy.textContent = T.copyAddress), 1500);
        });
      });
      addr.append(text, copy);
      box.append(addr);
      // Balances of the own wallet's first address (what the game plays with), read from the chain
      const read = async () => {
        const provider = view().provider;
        if (!provider) return;
        try {
          const utxos = await provider.getUtxosForLockingBytecode(p2pkhLock(hexToBin(s.pkhHex!)));
          const category = pusdCategory();
          let sats = 0n, units = 0n;
          for (const u of utxos) {
            sats += u.satoshis;
            if (u.token && u.token.category === category && !u.token.nft) units += u.token.amount;
          }
          pusd.amount.textContent = Number(formatUnits(units, CONFIG.pusdDecimals)).toFixed(2);
          bch.amount.textContent = Number(formatUnits(sats, 8)).toFixed(5);
          ownBalances = { pusd: units, sats, pkhHex: s.pkhHex! };
        } catch (e) {
          console.error(e);
        }
      };
      void read();
      const timer = window.setInterval(() => (box.isConnected && screen === "wc" ? void read() : window.clearInterval(timer)), 15_000);
    }
    if (CONFIG.network === "chipnet") box.append(faucetCard(s.pkhHex ?? ""));
  }

  // ---- Saving ----
  async function save(phrase: string, pw: string): Promise<void> {
    try {
      await vault.create(phrase, pw);
      void requestPersistentStorage();
      clearSecrets();
      walletChanged();
      go(auto());
    } catch (e) {
      console.error(e);
      error = T.failed;
      draw();
    }
  }

  // The vault or the own wallet changed somewhere else
  // A wallet saved before passwords were required (no password) is removed from this browser: the player starts at
  // Pick a Wallet and can bring it back with its recovery phrase (I Already Have a Wallet)
  let wiping = false;
  const wipeOld = () => {
    if (wiping || vault.state() === "none" || vault.hasPassword()) return;
    wiping = true;
    void vault.wipe().then(() => {
      wiping = false;
      clearSecrets();
      pickFirst = false;
      walletChanged();
      go(auto());
    });
  };

  let lastKey = "";
  setInterval(() => {
    wipeOld();
    const w = getWalletState();
    const key = `${vault.state()}|${vault.hasPassword()}|${w.status}|${w.qrUri ?? ""}|${w.walletName ?? ""}|${w.error ?? ""}`;
    if (key === lastKey) return;
    lastKey = key;
    const next = auto();
    if (next !== screen) go(next);
    else if (screen === "wc") draw();
  }, 300);

  go(auto());
  return {
    onOpen: () => {
      const next = auto();
      if (next !== screen) go(next);
    },
  };
}
