// The side panel over the field: a Wallet tab and a Rules tab, opened by the Menu button and the wallet chip.
// A click anywhere outside it closes it (that first click does nothing else); so do Escape and the close button.
// Until the wallet screens are rebuilt (redesign step 6) the Wallet tab holds the old wallet sections, moved in with
// their handlers. Laptop: 420px on the right (docs/REDESIGN_CHECKLIST.md, section 9).
import "./panel.css";
import { COPY } from "../copy.ts";
import { RULES } from "../lib/rulesNumbers.ts";

const T = COPY.battlefield;
export type PanelTab = "wallet" | "rules";
export type Panel = { open: (tab: PanelTab) => void; close: () => void; walletPage: HTMLElement; onOpenWallet: (() => void) | null };

export function mountPanel(host: HTMLElement, walletIds: string[]): Panel {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };

  const scrim = el("div", "fg-scrim");
  scrim.hidden = true;
  const panel = el("aside", "fg-panel");
  panel.hidden = true;
  panel.setAttribute("aria-label", T.panelAria);

  // Tabs and the close button
  const head = el("div", "fg-panel-head");
  const tabList = el("div");
  tabList.setAttribute("role", "tablist");
  tabList.style.display = "flex";
  tabList.style.gap = "6px";
  const body = el("div", "fg-panel-body");
  const tabs = new Map<PanelTab, { tab: HTMLButtonElement; page: HTMLElement }>();
  for (const [id, label] of [["wallet", T.walletSection], ["rules", T.rulesTab]] as const) {
    const tab = el("button", "fg-tab", label);
    tab.type = "button";
    tab.id = `fg-tab-${id}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", `fg-page-${id}`);
    tab.addEventListener("click", () => show(id));
    const page = el("div");
    page.id = `fg-page-${id}`;
    page.setAttribute("role", "tabpanel");
    page.setAttribute("aria-labelledby", tab.id);
    tabList.append(tab);
    body.append(page);
    tabs.set(id, { tab, page });
  }
  const close = el("button", "fg-close");
  close.type = "button";
  close.setAttribute("aria-label", T.closeAria);
  close.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  close.addEventListener("click", () => hide());
  head.append(tabList, close);
  panel.append(head, body);

  // Wallet: the old sections, moved in (nothing is rebuilt yet)
  const walletPage = tabs.get("wallet")!.page;
  walletPage.className = "fg-wallet-old";
  for (const id of walletIds) {
    const e = document.getElementById(id);
    if (e) walletPage.append(e);
  }

  // Rules: the ten Fair Game Rules; rule 10 without the fallback sentence
  const R = COPY.landing.fairRules;
  const rulesPage = tabs.get("rules")!.page;
  const list = el("ol", "fg-rules");
  R.rules.forEach((r, i) => {
    const li = el("li");
    const text = i === R.rules.length - 1 ? T.ruleTenShort(RULES.claim) : r.text(RULES);
    li.append(el("span", "fg-n", String(i + 1)), el("strong", "", `${r.title(RULES)}.`), ` ${text}`);
    list.append(li);
  });
  rulesPage.append(el("div", "fg-kick", R.title), list);

  host.append(scrim, panel);

  let back: HTMLElement | null = null;
  function show(id: PanelTab): void {
    for (const [k, { tab, page }] of tabs) {
      const on = k === id;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      page.hidden = !on;
    }
  }
  function hide(): void {
    if (panel.hidden) return;
    panel.hidden = scrim.hidden = true;
    back?.focus({ preventScroll: true });
    back = null;
  }
  scrim.addEventListener("click", hide);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden && !document.querySelector('[aria-modal="true"]')) hide();
  });

  const api: Panel = {
    walletPage,
    onOpenWallet: null,
    open: (tab) => {
      if (tab === "wallet") api.onOpenWallet?.();
      show(tab);
      if (panel.hidden) back = document.activeElement as HTMLElement | null;
      panel.hidden = scrim.hidden = false;
      tabs.get(tab)!.tab.focus({ preventScroll: true });
    },
    close: hide,
  };
  return api;
}
