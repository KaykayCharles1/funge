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
      // stacked rows: the step's painting is moved here, above its card (see howtoScroll)
      h("div", { class: "howto__slot" }),
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
    // The closing: the timeline narrows to one glowing gold line with the crown at its foot, then the question and the
    // one action. Pinned, it fades in over the last stretch of the track; stacked, it is the section's last block.
    h("div", { class: "howto__end" },
      h("div", { class: "howto__line", "aria-hidden": "true" }, h("div", { class: "howto__line-crown" }, crown())),
      h("h2", { class: "howto__question", id: "howto-end" }, H.closing),
      h("a", { class: "btn btn--primary howto__play", href: BATTLE }, L.join, arrow()),
    ),
  );
  return h("section", { class: "howto", id: "howto", "aria-labelledby": "howto-title" }, h("div", { class: "howto__track" }, stage));
}

// Scroll position -> progress. Native scroll is never touched: this only reads it, once per frame, and writes
//   --s  where the steps are, 0 when step 1 starts to 5 when step 5 ends (the column slides by it),
//   --e  how far the closing is, 0 to 1 over the last stretch of the track,
//   data-step and aria-current  the active step.
// The scroll lengths are CSS variables on .howto, read again on resize.
// Two modes. Pinned (700px wide and up, motion allowed): the stage sticks and the scroll walks through the steps.
// Stacked (narrow screens, or reduced motion): no pinning; each painting sits above its own card, and the row nearest
// the middle of the screen is the active one.
const PINNED = "(min-width: 43.75rem) and (prefers-reduced-motion: no-preference)";
function howtoScroll(): void {
  const section = document.querySelector<HTMLElement>(".howto");
  const track = section?.querySelector<HTMLElement>(".howto__track");
  const stage = section?.querySelector<HTMLElement>(".howto__stage");
  const frame = section?.querySelector<HTMLElement>(".howto__frame");
  if (!section || !track || !stage || !frame) return;
  const items = Array.from(section.querySelectorAll<HTMLElement>(".howto__step"));
  const slots = Array.from(section.querySelectorAll<HTMLElement>(".howto__slot"));
  const imgs = Array.from(section.querySelectorAll<HTMLImageElement>(".howto__img"));
  const play = section.querySelector<HTMLElement>(".howto__play");
  const pinned = window.matchMedia(PINNED);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Images get their src only when needed. Pinned: the first as the section comes near, then each next one as the
  // step before it becomes active, so a fade never waits on the network. Stacked: all of them, with native lazy loading.
  let near = false;
  const load = (i: number) => {
    const img = imgs[i];
    if (img && !img.src && img.dataset.src) img.src = img.dataset.src;
  };
  // Pinned: the painting for step i fades in over the current one; only the shown one is exposed to screen readers
  let shown = -1;
  const show = (i: number) => {
    const img = imgs[i];
    if (!near || !pinned.matches || !img || i === shown) return;
    load(i);
    const apply = () => {
      if (stage.dataset.step !== String(i) || !pinned.matches) return; // moved on while it decoded
      imgs.forEach((el, j) => {
        el.classList.toggle("is-active", j === i);
        el.classList.toggle("is-prev", j === shown);
        el.toggleAttribute("aria-hidden", j !== i);
      });
      shown = i;
    };
    if (img.complete && img.naturalWidth) apply();
    else img.decode().catch(() => {}).then(apply);
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

  let len = { intro: 0, step: 0.6, end: 1 };
  const readLengths = () => {
    const css = getComputedStyle(section);
    const n = (name: string, fallback: number) => {
      const v = parseFloat(css.getPropertyValue(name));
      return Number.isFinite(v) ? v : fallback;
    };
    len = { intro: n("--howto-intro", 0), step: n("--howto-step", 0.6), end: n("--howto-end", 1) };
  };
  const total = () => len.intro + items.length * len.step + len.end;
  // The scroll position for a point on the track, given in screens from the track's start
  const scrollFor = (screens: number) => {
    const top = track.getBoundingClientRect().top + window.scrollY;
    return top + (track.offsetHeight - window.innerHeight) * (screens / total());
  };

  let ticking = false;
  const update = () => {
    ticking = false;
    if (!pinned.matches) return;
    const r = track.getBoundingClientRect();
    const range = r.height - window.innerHeight;
    const p = range > 0 ? Math.min(1, Math.max(0, -r.top / range)) : 0;
    const at = p * total(); // screens into the track: [intro][steps x 5][end]
    const s = (at - len.intro) / len.step;
    const e = Math.min(1, Math.max(0, (at - len.intro - items.length * len.step) / len.end));
    stage.style.setProperty("--s", Math.min(items.length, Math.max(0, s)).toFixed(4));
    stage.style.setProperty("--e", e.toFixed(4));
    stage.toggleAttribute("data-end", e >= 0.5); // the closing takes clicks once it is mostly in
    // the step changes halfway through each step's stretch; a small margin stops it flickering at the boundary
    const HOLD = 0.08;
    if (active < 0 || s < active - HOLD || s > active + 1 + HOLD) setStep(Math.min(items.length - 1, Math.max(0, Math.floor(s))));
  };
  const request = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };

  // Stacked: the row crossing the middle of the screen is the active one
  const middle = new IntersectionObserver((entries) => {
    if (pinned.matches) return;
    for (const en of entries) if (en.isIntersecting) setStep(items.indexOf(en.target as HTMLElement));
  }, { rootMargin: "-45% 0px -45% 0px" });

  // Put the paintings where the mode wants them: all in the frame (pinned) or one above each card (stacked)
  const applyMode = () => {
    readLengths();
    imgs.forEach((el) => el.classList.remove("is-active", "is-prev"));
    shown = -1;
    if (pinned.matches) {
      for (const img of imgs) {
        frame.append(img);
        img.removeAttribute("loading");
      }
      items.forEach((el) => middle.unobserve(el));
      const i = Math.max(0, active);
      active = -1;
      setStep(i);
      update();
    } else {
      imgs.forEach((img, i) => {
        slots[i]?.append(img);
        img.setAttribute("loading", "lazy");
        img.removeAttribute("aria-hidden"); // each row's painting belongs to its own step
        load(i);
      });
      stage.style.removeProperty("--s");
      stage.style.removeProperty("--e");
      stage.removeAttribute("data-end");
      items.forEach((el) => middle.observe(el));
    }
  };

  // A mark jumps to its step: pinned, to the middle of that step's stretch; stacked, to its row
  section.addEventListener("click", (ev) => {
    const mark = (ev.target as Element).closest<HTMLElement>(".howto__mark");
    if (!mark) return;
    const i = Number(mark.dataset.i);
    const behavior: ScrollBehavior = reduce.matches ? "auto" : "smooth";
    if (!pinned.matches) items[i]?.scrollIntoView({ block: "center", behavior });
    else window.scrollTo({ top: scrollFor(len.intro + (i + 0.5) * len.step), behavior });
  });
  // Tabbing to Play Now before the closing is in view brings the closing in, so the focus is never on something unseen
  play?.addEventListener("focus", () => {
    if (pinned.matches && !stage.hasAttribute("data-end")) {
      window.scrollTo({ top: scrollFor(len.intro + items.length * len.step + 0.8 * len.end), behavior: "auto" });
    }
  });

  const approach = new IntersectionObserver((entries) => {
    if (!entries.some((en) => en.isIntersecting)) return;
    near = true;
    approach.disconnect();
    if (pinned.matches) {
      const i = Math.max(0, active);
      show(i);
      load(i + 1);
    }
  }, { rootMargin: "100% 0px" });
  approach.observe(section);

  applyMode();
  setStep(Math.max(0, active));
  window.addEventListener("scroll", request, { passive: true });
  window.addEventListener("resize", () => { readLengths(); request(); });
  pinned.addEventListener("change", applyMode);
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
