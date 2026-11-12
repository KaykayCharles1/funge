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

// The five paintings, in step order (public/assets/howto, built by tools/build_howto.py)
const HOWTO_IMAGES = ["howto-1-first-king", "howto-2-protect", "howto-3-conqueror", "howto-4-reclaim", "howto-5-treasury"];

// The timeline's node: a small crown
const crown = () => svg("0 0 24 24", ["M3 18.5h18l1.2-10.5-5.4 4.2L12 5 7.2 12.2 1.8 8z", "M3.5 20.5h17"], { class: "howto__crown" });

// How a round is played. A tall track holds a sticky stage; while the stage is pinned, the scroll position walks
// through the five steps. Left: the image panel with the title under it. Right: the timeline of steps, an ordered list.
function howto(): HTMLElement {
  const H = L.howto;
  const steps = H.steps.map((s, i) =>
    h("li", { class: "howto__step", "data-i": String(i) },
      // the step's mark on the road; a button that jumps to the step
      h("button", { class: "howto__mark", type: "button", "data-i": String(i), "aria-label": H.goTo(i + 1, s.title) }),
      h("article", { class: "howto__card" },
        h("span", { class: "howto__no", "aria-hidden": "true" }, String(i + 1).padStart(2, "0")),
        h("h3", {}, s.title),
        h("p", {}, s.text(NUMBERS)),
      ),
    ),
  );
  const stage = h("div", { class: "howto__stage" },
    h("div", { class: "howto__media" },
      // the five paintings, stacked; no src until needed (see howtoScroll), so only the first loads early
      h("div", { class: "howto__frame" },
        ...H.steps.map((s, i) => h("img", {
          class: "howto__img",
          "data-i": String(i),
          "data-src": `${ASSETS}howto/${HOWTO_IMAGES[i]}.webp`,
          alt: s.alt,
          width: "1200",
          height: "1200",
          decoding: "async",
        })),
      ),
      h("h2", { class: "howto__title", id: "howto-title" }, H.title),
      h("p", { class: "howto__subtitle" }, H.subtitle),
    ),
    // The timeline. The column (the road, its gold fill and the steps) slides up past the crown, which stays put:
    // one transform, from the scroll progress. The connector from the crown points at the active card.
    h("div", { class: "howto__timeline" },
      h("div", { class: "howto__column" },
        h("div", { class: "howto__road", "aria-hidden": "true" }, h("div", { class: "howto__fill" })),
        h("ol", { class: "howto__steps", "aria-label": H.stepsLabel }, ...steps),
      ),
      h("div", { class: "howto__node", "aria-hidden": "true" }, crown()),
    ),
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
  const imgs = Array.from(section.querySelectorAll<HTMLImageElement>(".howto__img"));
  // An image gets its src only when it is needed: the first as the section comes near, the next one whenever a step
  // becomes active, so the fade never waits on the network
  const load = (i: number) => {
    const img = imgs[i];
    if (img && !img.src && img.dataset.src) img.src = img.dataset.src;
  };
  // The painting for step i fades in over the current one; only the shown painting is exposed to screen readers
  let shown = -1;
  let near = false; // nothing loads until the section is within a screen of the view
  const show = (i: number) => {
    const img = imgs[i];
    if (!near || !img || i === shown) return;
    load(i);
    const apply = () => {
      if (stage.dataset.step !== String(i)) return; // the visitor moved on while it decoded
      imgs.forEach((el, j) => {
        el.classList.toggle("is-active", j === i);
        el.classList.toggle("is-prev", j === shown);
        if (j === i) el.removeAttribute("aria-hidden");
        else el.setAttribute("aria-hidden", "true");
      });
      shown = i;
    };
    if (img.complete && img.naturalWidth) apply();
    else img.decode().catch(() => {}).then(apply);
  };
  const approach = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    near = true;
    approach.disconnect();
    const i = Math.max(0, Number(stage.dataset.step ?? 0));
    show(i);
    load(i + 1);
  }, { rootMargin: "100% 0px" });
  approach.observe(section);
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
    if (near) {
      show(i);
      load(i + 1);
    }
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
  // A mark jumps to its step: pinned, to the middle of that step's stretch; stacked, to its row
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  section.addEventListener("click", (e) => {
    const mark = (e.target as Element).closest<HTMLElement>(".howto__mark");
    if (!mark) return;
    const i = Number(mark.dataset.i);
    const behavior: ScrollBehavior = reduce.matches ? "auto" : "smooth";
    if (!pinned.matches) {
      items[i]?.scrollIntoView({ block: "center", behavior });
      return;
    }
    const total = len.intro + items.length * len.step + len.end;
    const top = track.getBoundingClientRect().top + window.scrollY;
    const range = track.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + range * ((len.intro + (i + 0.5) * len.step) / total), behavior });
  });
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
