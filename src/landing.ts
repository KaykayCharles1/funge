// The landing page (landing.html). The hero: the painted valley is the sky the page opens in. Below it, "How a round
// is played": a pinned section where scrolling walks through the five moves. Every word comes from COPY.landing, and
// every rule number from the rule constants. Its one action is Play Now, which opens the battlefield.
import "./landing.css";
import { COPY, type HowtoNumbers } from "./copy.ts";
import { CONFIG } from "./config.ts"; // plain constants only: no wallet, chain or Phaser code comes with it

const L = COPY.landing;
const BATTLE = "/?mode=battlefield";
const ASSETS = `${import.meta.env.BASE_URL}assets/`;

// Build the page with the DOM, so no copy is ever parsed as HTML
type Child = Node | string | null | false | undefined;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of children) if (c) e.append(c);
  return e;
}
const SVG = "http://www.w3.org/2000/svg";
function svg(viewBox: string, paths: string[], attrs: Record<string, string> = {}): SVGSVGElement {
  const s = document.createElementNS(SVG, "svg");
  s.setAttribute("viewBox", viewBox);
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("focusable", "false");
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  for (const d of paths) {
    const p = document.createElementNS(SVG, "path");
    p.setAttribute("d", d);
    s.append(p);
  }
  return s;
}

// The one drawn icon: an arrow into the battle
const arrow = () => svg("0 0 24 24", ["M4 12h14", "M13 6l6 6-6 6"], { fill: "none", stroke: "currentColor", "stroke-width": "2.5", "stroke-linecap": "round", "stroke-linejoin": "round" });

// The hero: the painted valley is the sky the page opens in. The logo and one line sit in its open sky, the painting
// fades into the light page, and the real battlefield rises in a frame across that line.
function hero(): HTMLElement {
  const logo = h("a", { class: "top-logo", href: "#top", "aria-label": L.logoAlt },
    h("img", { src: `${ASSETS}landing/funge-logo.webp`, alt: "", width: "708", height: "420" })
  );
  const sky = h("div", { class: "hero__sky" },
    // h("h1", { class: "hero__logo" }, h("img", { src: `${ASSETS}landing/funge-logo.webp`, alt: L.logoAlt, width: "708", height: "420", fetchpriority: "high" })),
    h("h1", { class: "hero__title" }, L.heroTitle),
    h("p", { class: "hero__line" }, ...L.heroLine.map((w) => h("span", {}, w))),
    h("div", { class: "hero__actions" }, h("a", { class: "btn btn--primary", href: BATTLE }, L.join, arrow())),
  );
  const painting = h("div", { class: "hero__art" },
    h("img", {
      src: `${ASSETS}landing/valley-2048.webp`,
      srcset: `${ASSETS}landing/valley-1280.webp 1280w, ${ASSETS}landing/valley-2048.webp 2048w, ${ASSETS}landing/valley-4096.webp 4096w`,
      sizes: "100vw",
      alt: L.valleyAlt,
      decoding: "async",
    }),
  );
  const shot = h("figure", { class: "shot" },
    h("div", { class: "shot__frame" },
      h("img", {
        src: `${ASSETS}landing/battlefield-1280.webp`,
        srcset: `${ASSETS}landing/battlefield-1280.webp 1280w, ${ASSETS}landing/battlefield-2048.webp 2048w`,
        sizes: "(min-width: 72rem) 64rem, 92vw",
        alt: L.shotAlt,
        width: "2048",
        height: "1152",
        loading: "lazy",
        decoding: "async",
      }),
    ),
    h("figcaption", { class: "shot__caption" }, L.shotCaption),
  );
  return h("header", { class: "hero", id: "top" }, logo, sky, painting, shot);
}

// The battlefield frame rises a little as the page scrolls past the painting (never with reduced motion)
function rise(): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const frame = document.querySelector<HTMLElement>(".shot");
  if (!frame) return;
  let ticking = false;
  const update = () => {
    ticking = false;
    const r = frame.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, 1 - r.top / window.innerHeight)); // 0 while below the fold, 1 once at the top
    frame.style.setProperty("--rise", String(p));
  };
  window.addEventListener("scroll", () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }, { passive: true });
  update();
}

// The rule numbers, read from the contract settings so the page can never drift from the game
const K = CONFIG.kingdom;
const unit = 10n ** BigInt(CONFIG.pusdDecimals);
const pusd = (v: bigint) => (v % unit === 0n ? String(v / unit) : (Number(v) / Number(unit)).toFixed(CONFIG.pusdDecimals));
const NUMBERS: HowtoNumbers = { open: pusd(K.openingPrice), fee: `${K.feePercent}%`, cut: `${K.cutPercent}%` };

// How a round is played. A tall track holds a sticky stage; while the stage is pinned, the scroll position walks
// through the five steps. Left: the image panel with the title under it. Right: the timeline of steps, an ordered list.
function howto(): HTMLElement {
  const H = L.howto;
  const steps = H.steps.map((s, i) =>
    h("li", { class: "howto__step", "data-i": String(i) },
      h("button", { class: "howto__node", type: "button", "aria-label": H.goTo(i + 1, s.title) }),
      h("article", { class: "howto__card" },
        h("span", { class: "howto__no", "aria-hidden": "true" }, String(i + 1).padStart(2, "0")),
        h("h3", {}, s.title),
        h("p", {}, s.text(NUMBERS)),
      ),
    ),
  );
  const stage = h("div", { class: "howto__stage" },
    h("div", { class: "howto__media" },
      h("div", { class: "howto__frame" }), // the five images go here (step 3)
      h("h2", { class: "howto__title", id: "howto-title" }, H.title),
      h("p", { class: "howto__subtitle" }, H.subtitle),
    ),
    h("div", { class: "howto__timeline" }, h("ol", { class: "howto__steps", "aria-label": H.stepsLabel }, ...steps)),
  );
  return h("section", { class: "howto", id: "howto", "aria-labelledby": "howto-title" }, h("div", { class: "howto__track" }, stage));
}

// Scroll position -> progress. Native scroll is never touched: this only reads it, once per frame, and writes the
// progress (--p, 0 to 1 over the whole track) and the active step (data-step, aria-current). The scroll lengths are
// CSS variables on .howto, read again on resize. Pinned only from 700px wide and without reduced motion.
const PINNED = "(min-width: 43.75rem) and (prefers-reduced-motion: no-preference)";
function howtoScroll(): void {
  const section = document.querySelector<HTMLElement>(".howto");
  const track = section?.querySelector<HTMLElement>(".howto__track");
  const stage = section?.querySelector<HTMLElement>(".howto__stage");
  if (!section || !track || !stage) return;
  const items = Array.from(section.querySelectorAll<HTMLElement>(".howto__step"));
  const pinned = window.matchMedia(PINNED);
  let len = { intro: 0, step: 0.6, end: 1 };
  const readLengths = () => {
    const css = getComputedStyle(section);
    const n = (name: string, fallback: number) => {
      const v = parseFloat(css.getPropertyValue(name));
      return Number.isFinite(v) ? v : fallback;
    };
    len = { intro: n("--howto-intro", 0), step: n("--howto-step", 0.6), end: n("--howto-end", 1) };
  };
  let active = -1;
  const setStep = (i: number) => {
    if (i === active) return;
    active = i;
    stage.dataset.step = String(i);
    items.forEach((el, j) => (j === i ? el.setAttribute("aria-current", "step") : el.removeAttribute("aria-current")));
  };
  const update = () => {
    ticking = false;
    if (!pinned.matches) return; // stacked rows: the active row is set by its own rule (step 4)
    const r = track.getBoundingClientRect();
    const range = r.height - window.innerHeight;
    const p = range > 0 ? Math.min(1, Math.max(0, -r.top / range)) : 0;
    stage.style.setProperty("--p", p.toFixed(4));
    // where the steps sit on the track, in screens: [intro][steps x 5][end]
    const total = len.intro + items.length * len.step + len.end;
    const s = (p * total - len.intro) / len.step; // 0 at step 1's start, 5 at the end of step 5
    stage.style.setProperty("--s", Math.min(items.length, Math.max(0, s)).toFixed(4));
    // the step changes halfway through each step's stretch; a small margin stops it flickering at the boundary
    const HOLD = 0.08;
    const lo = active - HOLD, hi = active + 1 + HOLD;
    if (active < 0 || s < lo || s > hi) setStep(Math.min(items.length - 1, Math.max(0, Math.floor(s))));
  };
  let ticking = false;
  const request = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };
  readLengths();
  setStep(0);
  window.addEventListener("scroll", request, { passive: true });
  window.addEventListener("resize", () => { readLengths(); request(); });
  pinned.addEventListener("change", request);
  update();
}

document.title = L.pageTitle;
document.head.append(h("meta", { name: "description", content: L.description }));
document.getElementById("landing")!.append(
  h("a", { class: "skip", href: "#howto" }, L.howto.title),
  hero(),
  h("main", {},
    howto(),
    // the "Fair Game Rules" section goes here (later); its rule strings are kept in COPY.landing
  ),
);
rise();
howtoScroll();
