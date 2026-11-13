// The landing page (landing.html). The hero: the painted valley is the sky the page opens in. Below it, "How a round
// is played": a pinned section where scrolling walks through the five moves. Every word comes from COPY.landing, and
// every rule number from the rule constants. Its one action is Play Now, which opens the battlefield.
import "./landing.css";
import { COPY, type FaqBlock, type FaqNumbers, type HowtoNumbers, type RulesNumbers } from "./copy.ts";
import { CONFIG } from "./config.ts"; // plain constants only: no wallet, chain or Phaser code comes with it
// plain constants too (its one import is a type, so no server code comes with it)
import { CLOCK_CAP_SECONDS, CONQUEST_ADD_SECONDS, KEEPER_DELAY_SECONDS, PROTECT_LOCKOUT_SECONDS } from "./refereeParams.ts";

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
  // top right: a question mark that takes the visitor to How to Play (and plays it); its name shows on hover
  const help = h("a", { class: "help", href: "#howto", "aria-label": L.howto.title },
    svg("0 0 24 24", ["M8.6 9.2a3.4 3.4 0 1 1 4.9 3.05c-.95.47-1.5 1.25-1.5 2.25v.5", "M12 18.4v.1"], { fill: "none", stroke: "currentColor", "stroke-width": "2.6", "stroke-linecap": "round", "stroke-linejoin": "round" }),
    h("span", { class: "help__tip", "aria-hidden": "true" }, L.howto.title),
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
  return h("header", { class: "hero", id: "top" }, logo, help, sky, painting);
}

// After How to Play: a round on the real battlefield, a silent loop in the same gold frame as the paintings.
// It was recorded from the dev page's mock round with the two kings of How to Play: King Satoshi (violet) holds the
// throne, King Blaze (crimson) conquers it, King Satoshi takes it back (public/assets/landing/battle-loop.mp4.json).
function battle(): HTMLElement {
  return h("figure", { class: "shot" },
    h("div", { class: "shot__frame" },
      h("video", {
        src: `${ASSETS}landing/battle-loop.mp4`,
        poster: `${ASSETS}landing/battle-loop-poster.webp`,
        muted: "",
        loop: "",
        playsinline: "",
        preload: "none",
        width: "1280",
        height: "720",
        "aria-label": L.shotAlt,
      }),
    ),
  );
}

// The loop plays only while it is on screen. With reduced motion it does not play by itself: its first frame shows,
// with the video's own controls.
function battleLoop(): void {
  const video = document.querySelector<HTMLVideoElement>(".shot video");
  if (!video) return;
  video.muted = true; // the attribute alone does not let every browser start it
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    video.controls = true;
    return;
  }
  new IntersectionObserver(([en]) => {
    if (en?.isIntersecting) void video.play().catch(() => {});
    else video.pause();
  }, { threshold: 0.25 }).observe(video);
}

// The battle frame rises a little as it scrolls into view (never with reduced motion)
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

// Autoplay, timed like the reference clip. A move is a smooth scroll to the next spot; a hold is a pause there.
const AUTOPLAY_GROW_MS = 750; // the panel grows in, in the middle
const AUTOPLAY_INTRO_HOLD_MS = 1450; // and holds there
const AUTOPLAY_SHIFT_MS = 600; // the shift into two columns, landing on step 1
const AUTOPLAY_STEP_MS = 5000; // each step holds (time to read it)
const AUTOPLAY_MOVE_MS = 450; // the move from one step to the next
const AUTOPLAY_EXIT_MS = 800; // the exit into the closing
const AUTOPLAY_RESUME_MS = 1500; // how soon it resumes after the mouse leaves the timeline

// The intro stretch (--howto-intro): the panel grows in up to GROW_END of it, holds, and shifts left from SHIFT_START
const GROW_END = 0.35;
const SHIFT_START = 0.55;

// The timeline's node: a small crown
const crown = () => svg("0 0 24 24", ["M3 18.5h18l1.2-10.5-5.4 4.2L12 5 7.2 12.2 1.8 8z", "M3.5 20.5h17"], { class: "howto__crown" });

// Fair Game Rules: a parchment scroll between two painted rollers, after the battle loop. Only the rules How to Play
// does not already give. Each rule's number is a Roman numeral drawn by the page; the wax seal at the foot carries
// the crown. Every number comes from the rule constants.
const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const span = (seconds: number, one: string, many: string) => `${seconds} ${seconds === 1 ? one : many}`;
const RULES: RulesNumbers = {
  clock: String(CLOCK_CAP_SECONDS / 60),
  add: CONQUEST_ADD_SECONDS % 60 === 0 ? span(CONQUEST_ADD_SECONDS / 60, "minute", "minutes") : span(CONQUEST_ADD_SECONDS, "second", "seconds"),
  // the three protect amounts are 1x, 5x and 10x the unit (src/lib/kingdom.ts protectAmounts, not imported: it
  // brings the chain library)
  amounts: `${pusd(K.unit)}, ${pusd(K.unit * 5n)} or ${pusd(K.unit * 10n)}`,
  perReign: COUNT_WORDS[K.protectsPerReign] ?? String(K.protectsPerReign),
  lockout: span(PROTECT_LOCKOUT_SECONDS, "second", "seconds"),
  cap: pusd(K.cap),
  back: `${100n - K.cutPercent}%`,
  fee: `${K.feePercent}%`,
  claim: KEEPER_DELAY_SECONDS % 60 === 0 ? span(KEEPER_DELAY_SECONDS / 60, "minute", "minutes") : span(KEEPER_DELAY_SECONDS, "second", "seconds"),
  blocks: String(CONFIG.fallbackBlocks),
};

// the wax's outline: a disc whose rim swells and dips in eleven soft lobes, as poured wax does
function waxRim(): string {
  const pts = Array.from({ length: 88 }, (_, i) => {
    const a = (i / 88) * Math.PI * 2;
    const r = 45 + 2.6 * Math.sin(a * 11) + 1.2 * Math.sin(a * 4 + 1);
    return `${(50 + r * Math.cos(a)).toFixed(1)} ${(50 + r * Math.sin(a)).toFixed(1)}`;
  });
  return `M${pts.join("L")}z`;
}

// the wax seal: a pressed disc of gold wax with a ring and the crown in it
function seal(): SVGSVGElement {
  const s = svg("0 0 100 100", [
    waxRim(),
    // the pressed ring
    "M50 20a30 30 0 1 0 0.01 0z",
  ], { class: "rules__wax" });
  // the crown, centred in the ring
  const c = document.createElementNS(SVG, "path");
  c.setAttribute("d", "M3 18.5h18l1.2-10.5-5.4 4.2L12 5 7.2 12.2 1.8 8z M3.5 20.5h17");
  c.setAttribute("transform", "translate(29 28) scale(1.75)");
  c.setAttribute("class", "rules__seal-crown");
  s.append(c);
  return s;
}

function rules(): HTMLElement {
  const R = L.fairRules;
  const rod = (end: "top" | "bottom") => h("div", { class: `rules__rod rules__rod--${end}`, "aria-hidden": "true" });
  return h("section", { class: "rules", id: "rules", "aria-labelledby": "rules-title" },
    h("div", { class: "rules__scroll" },
      rod("top"),
      h("div", { class: "rules__sheet" },
        h("h2", { class: "rules__title", id: "rules-title" }, R.title),
        h("ol", { class: "rules__list" },
          ...R.rules.map((r) => h("li", { class: "rules__rule" },
            h("h3", {}, r.title(RULES)),
            h("p", {}, r.text(RULES)),
          )),
        ),
        h("div", { class: "rules__seal" }, seal(), h("p", {}, R.seal)),
      ),
      rod("bottom"),
    ),
  );
}

// The scroll opens by itself when the visitor arrives and rolls shut when they leave. The top roller stays put; the
// bottom one rolls down to its place and back, and the sheet shows down to it (both CSS transitions, so a change of
// mind half way reverses smoothly). The page keeps the open scroll's height throughout, so nothing below it moves.
// It counts as arrived once the closed scroll is in the upper half of the screen (so the visitor sees it unroll) and
// some of it is still below the top 30%; it counts as left once it is all but off screen (a gap between the two, so it never flutters at an edge).
// Never with reduced motion: the scroll is simply open.
// The FAQ after the scroll: three groups of questions, each a native disclosure (keyboard and screen readers work as
// they do everywhere). They share one name, so opening a question closes the one that was open. Every answer is in
// the page, opened or not; every number comes from the rule constants.
const FRACTION_WORDS: Record<string, string> = { "10": "a tenth", "20": "a fifth", "25": "a quarter", "50": "half" };
const FAQ: FaqNumbers = {
  ...RULES,
  clockTime: `${CLOCK_CAP_SECONDS / 60}:${String(CLOCK_CAP_SECONDS % 60).padStart(2, "0")}`,
  addPhrase: CONQUEST_ADD_SECONDS === 60 ? "a minute" : RULES.add,
  open: pusd(K.openingPrice),
  example: pusd((K.openingPrice * (100n + K.feePercent)) / 100n),
  maxConquest: pusd((K.cap * (100n + K.feePercent)) / 100n),
  lossShare: FRACTION_WORDS[String(K.cutPercent)] ?? `${K.cutPercent}%`,
};
const answer = (blocks: FaqBlock[]) =>
  blocks.map((b) => (typeof b === "string" ? h("p", {}, b) : h("ol", {}, ...b.steps.map((st) => h("li", {}, st)))));

function faq(): HTMLElement {
  const F = L.faq;
  return h("section", { class: "faq", id: "faq", "aria-labelledby": "faq-title" },
    h("h2", { class: "faq__title", id: "faq-title" }, F.title),
    ...F.groups.map((g) => h("div", { class: "faq__group" },
      h("h3", { class: "faq__group-title" }, g.title),
      ...g.items.map((it) => h("details", { class: "faq__item", name: "faq" },
        h("summary", {}, h("span", { class: "faq__q" }, it.q), h("span", { class: "faq__mark", "aria-hidden": "true" })),
        h("div", { class: "faq__a" }, ...answer(it.a(FAQ))),
      )),
    )),
  );
}

const RULES_OPEN_MS = 1900; // the opening, at least
const RULES_OPEN_MAX_MS = 3000; // and at most
const RULES_OPEN_MS_PER_PX = 1.6; // per pixel the roller travels
function rulesScroll(): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const scroll = document.querySelector<HTMLElement>(".rules__scroll");
  const top = scroll?.querySelector<HTMLElement>(".rules__rod--top");
  const bottom = scroll?.querySelector<HTMLElement>(".rules__rod--bottom");
  if (!scroll || !top || !bottom) return;
  // how far the bottom roller travels: from its place up to the top roller (the layout ignores transforms). A longer
  // scroll (one column on a phone) takes longer to open, so the roller moves at about the same speed on any screen.
  const measure = () => {
    const travel = bottom.offsetTop - top.offsetTop;
    scroll.style.setProperty("--travel", `${travel}px`);
    scroll.style.setProperty("--open-ms", `${Math.round(Math.min(RULES_OPEN_MAX_MS, Math.max(RULES_OPEN_MS, travel * RULES_OPEN_MS_PER_PX)))}ms`);
  };
  measure();
  new ResizeObserver(measure).observe(scroll);
  scroll.dataset.state = "closed";
  let ticking = false;
  const update = () => {
    ticking = false;
    const r = scroll.getBoundingClientRect();
    const vh = window.innerHeight;
    const open = scroll.dataset.state === "open";
    if (!open && r.top < vh * 0.5 && r.bottom > vh * 0.3) scroll.dataset.state = "open";
    else if (open && (r.top > vh * 0.92 || r.bottom < vh * 0.08)) scroll.dataset.state = "closed";
  };
  window.addEventListener("scroll", () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }, { passive: true });
  window.addEventListener("resize", update, { passive: true });
  // already on screen when the page loads: open after the closed scroll has been drawn once, so the opening plays
  requestAnimationFrame(() => requestAnimationFrame(update));
}

// How to Play. A tall track holds a sticky stage; while the stage is pinned, the scroll position plays the section
// like the reference clip: the panel grows in, shifts left as the timeline draws in, the steps pass the crown, and the
// exit turns the timeline into the closing. The heading stays at the top of the stage throughout.
// Left: the image panel. Right: the steps, an ordered list.
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
    h("h2", { class: "howto__title", id: "howto-title" }, H.title),
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
    ),
    // The timeline. The column (the road, its gold fill and the steps) slides up past the crown, which stays put:
    // one transform, from the scroll progress. The connector from the crown points at the active card.
    h("div", { class: "howto__timeline" },
      h("div", { class: "howto__column" },
        h("div", { class: "howto__road", "aria-hidden": "true" }, h("div", { class: "howto__fill" })),
        h("ol", { class: "howto__steps", "aria-label": H.stepsLabel }, ...steps),
      ),
      h("div", { class: "howto__node", "aria-hidden": "true" }, h("span", { class: "howto__flash" }), crown()),
    ),
    // The closing: the timeline, moved to the middle, runs down to the crown; then the question and the one action.
    // Pinned, it plays over the last stretch of the track; stacked, it is the section's last block.
    h("div", { class: "howto__end" },
      h("div", { class: "howto__line", "aria-hidden": "true" }, h("div", { class: "howto__line-crown" }, crown())),
      h("h2", { class: "howto__question", id: "howto-end" }, H.closing),
      h("a", { class: "btn btn--primary howto__play", href: BATTLE }, L.join, arrow()),
    ),
  );
  return h("section", { class: "howto", id: "howto", "aria-labelledby": "howto-title" }, h("div", { class: "howto__track" }, stage));
}

// Scroll position -> progress. Native scroll is never touched: this only reads it, once per frame, and writes
//   --grow   the panel growing in (0 to 1), --shift  the move into two columns (0 to 1),
//   --s      where the steps are (0 when step 1's stretch starts, 5 when step 5's ends),
//   --e      the exit into the closing (0 to 1),
//   data-step and aria-current  the active step, data-moving  while the column is between two steps.
// The track is [intro][5 steps][end]; the lengths are CSS variables on .howto, read again on resize.
// Two modes. Pinned (700px wide and up, motion allowed): the stage sticks and the scroll plays the section.
// Stacked (narrow screens, or reduced motion): no pinning; each painting sits above its own card, and the row nearest
// the middle of the screen is the active one.
const PINNED = "(min-width: 43.75rem) and (prefers-reduced-motion: no-preference)";
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
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
  const flash = section.querySelector<HTMLElement>(".howto__flash");
  const pinned = window.matchMedia(PINNED);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Images get their src only when needed. Pinned: the first as the section comes near, then each next one as the
  // step before it becomes active, so a change never waits on the network. Stacked: all, with native lazy loading.
  let near = false;
  const load = (i: number) => {
    const img = imgs[i];
    if (img && !img.src && img.dataset.src) img.src = img.dataset.src;
  };
  // Pinned: the shown painting squashes flat and the next one opens out of the same line, like the reference.
  // Only the shown painting is exposed to screen readers.
  let shown = -1;
  const show = (i: number) => {
    const img = imgs[i];
    if (!near || !pinned.matches || !img || i === shown) return;
    load(i);
    const apply = () => {
      if (stage.dataset.step !== String(i) || !pinned.matches) return; // moved on while it decoded
      const old = imgs[shown];
      imgs.forEach((el, j) => {
        if (j !== i && j !== shown) el.classList.remove("is-active", "is-in", "is-out");
        el.toggleAttribute("aria-hidden", j !== i);
      });
      if (old && old !== img) {
        old.classList.remove("is-active", "is-in");
        old.classList.add("is-out");
        old.addEventListener("animationend", () => old.classList.remove("is-out"), { once: true });
        img.classList.add("is-active", "is-in");
        img.addEventListener("animationend", () => img.classList.remove("is-in"), { once: true });
      } else {
        img.classList.add("is-active");
      }
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

  let len = { intro: 0.6, step: 0.6, end: 1 };
  const readLengths = () => {
    const css = getComputedStyle(section);
    const n = (name: string, fallback: number) => {
      const v = parseFloat(css.getPropertyValue(name));
      return Number.isFinite(v) ? v : fallback;
    };
    len = { intro: n("--howto-intro", 0.6), step: n("--howto-step", 0.6), end: n("--howto-end", 1) };
  };
  const total = () => len.intro + items.length * len.step + len.end;
  const stepAt = (i: number) => len.intro + (i + 0.5) * len.step; // a step's middle, in screens from the track's start
  // The scroll position for a point on the track, in screens from its start; and the other way round
  const scrollFor = (screens: number) => {
    const top = track.getBoundingClientRect().top + window.scrollY;
    return top + (track.offsetHeight - window.innerHeight) * (screens / total());
  };
  const position = () => {
    const r = track.getBoundingClientRect();
    const range = r.height - window.innerHeight;
    return range > 0 ? clamp01(-r.top / range) * total() : 0;
  };

  let moving = false;
  let ticking = false;
  const update = () => {
    ticking = false;
    if (!pinned.matches) return;
    const at = position(); // screens into the track
    const intro = len.intro > 0 ? clamp01(at / len.intro) : 1;
    const grow = clamp01(intro / GROW_END);
    const shift = clamp01((intro - SHIFT_START) / (1 - SHIFT_START));
    const s = (at - len.intro) / len.step;
    const e = clamp01((at - len.intro - items.length * len.step) / len.end);
    stage.style.setProperty("--grow", grow.toFixed(4));
    stage.style.setProperty("--shift", shift.toFixed(4));
    stage.style.setProperty("--s", Math.min(items.length, Math.max(0, s)).toFixed(4));
    stage.style.setProperty("--e", e.toFixed(4));
    stage.toggleAttribute("data-end", e >= 0.75); // the closing takes clicks once it is in
    stage.toggleAttribute("data-cards", shift >= 0.6 && e === 0); // the active card's words rise in once it is shown

    // the step changes halfway through each step's stretch; a small margin stops it flickering at the boundary
    const HOLD = 0.08;
    if (active < 0 || s < active - HOLD || s > active + 1 + HOLD) setStep(Math.min(items.length - 1, Math.max(0, Math.floor(s))));

    // the crown dims while the column is between two steps and flashes when the next card arrives
    const nearest = Math.min(items.length - 1, Math.max(0, Math.round(s - 0.5)));
    const nowMoving = s > 0.5 && s < items.length - 0.5 && Math.abs(s - (nearest + 0.5)) > 0.06;
    if (nowMoving !== moving) {
      moving = nowMoving;
      stage.toggleAttribute("data-moving", moving);
      if (!moving) flash?.animate([{ opacity: 0.9, transform: "scale(0.6)" }, { opacity: 0, transform: "scale(1.9)" }], { duration: 450, easing: "ease-out" });
    }
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
    imgs.forEach((el) => el.classList.remove("is-active", "is-in", "is-out"));
    shown = -1;
    if (pinned.matches) {
      for (const img of imgs) {
        frame.append(img);
        img.removeAttribute("loading");
      }
      items.forEach((el) => middle.unobserve(el));
      moving = false;
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
      for (const v of ["--grow", "--shift", "--s", "--e"]) stage.style.removeProperty(v);
      for (const a of ["data-end", "data-moving", "data-cards"]) stage.removeAttribute(a);
      items.forEach((el) => middle.observe(el));
    }
  };

  // A mark jumps to its step, and so does the dimmed next card (a click on it moves on, like its mark):
  // pinned, to the middle of that step's stretch; stacked, to its row
  section.addEventListener("click", (ev) => {
    const target = ev.target as Element;
    const mark = target.closest<HTMLElement>(".howto__mark");
    const next = pinned.matches ? target.closest<HTMLElement>(".howto__step:not([aria-current])") : null;
    if (!mark && !(next && target.closest(".howto__card"))) return;
    const i = Number((mark ?? next)!.dataset.i);
    const behavior: ScrollBehavior = reduce.matches ? "auto" : "smooth";
    if (!pinned.matches) items[i]?.scrollIntoView({ block: "center", behavior });
    else window.scrollTo({ top: scrollFor(stepAt(i)), behavior });
  });
  // Tabbing to Play Now before the closing is in view brings the closing in, so the focus is never on something unseen
  play?.addEventListener("focus", () => {
    if (pinned.matches && !stage.hasAttribute("data-end")) window.scrollTo({ top: scrollFor(total()), behavior: "auto" });
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

  // The autoplay route, in screens: grow in and hold, shift onto step 1, each next step, then the exit to the closing
  const route = (): Stop[] => [
    ...(len.intro > 0 ? [{ at: len.intro * GROW_END, move: AUTOPLAY_GROW_MS, hold: AUTOPLAY_INTRO_HOLD_MS }] : []),
    { at: stepAt(0), move: AUTOPLAY_SHIFT_MS, hold: AUTOPLAY_STEP_MS },
    ...items.slice(1).map((_, k) => ({ at: stepAt(k + 1), move: AUTOPLAY_MOVE_MS, hold: AUTOPLAY_STEP_MS })),
    { at: total(), move: AUTOPLAY_EXIT_MS, hold: 0 },
  ];
  const heading = section.querySelector<HTMLElement>(".howto__title")!;
  const auto = autoplay({ section, track, heading, pinned, route, position, scrollFor, total });
  pinned.addEventListener("change", () => {
    applyMode();
    auto.reset();
  });

  // The help button at the top of the page: brings the visitor to the start of the section and plays it at once
  document.querySelector<HTMLElement>(".help")?.addEventListener("click", (ev) => {
    if (!pinned.matches) return; // stacked: the plain link to #howto is enough
    ev.preventDefault();
    auto.startNow();
  });
}

// Autoplay. It moves the real scroll position along the route (a smooth scroll through the pinned range only), so what
// is shown and where the page is always agree. It follows the visitor's direction:
//   scrolling down, it takes over as soon as the How to Play heading is on screen: it glides the page to where the
//   section pins and plays on from there (a scroll down during a hold moves on from wherever the page now is);
//   scrolling up, it lets go and does not start again until the visitor scrolls down.
// A click or tap, or an upward key, lets go too. A mouse over the timeline pauses it until a moment after the mouse
// leaves. It stops on the closing. Native scrolling is never blocked. Never with reduced motion: no pinning then.
type Stop = { at: number; move: number; hold: number }; // where (screens into the track), the move there, the hold (ms)
type AutoplayContext = {
  section: HTMLElement;
  track: HTMLElement;
  heading: HTMLElement;
  pinned: MediaQueryList;
  route: () => Stop[];
  position: () => number;
  scrollFor: (screens: number) => number;
  total: () => number;
};
function autoplay(c: AutoplayContext) {
  const timeline = c.section.querySelector<HTMLElement>(".howto__timeline");
  type State = "idle" | "playing" | "paused" | "done";
  let state: State = "idle";
  // the state is also on the section (data-auto), for styling and for checking it in the browser
  const setState = (next: State) => {
    state = next;
    c.section.dataset.auto = next;
  };
  let hovered = false;
  let timer = 0; // a hold
  let resumeTimer = 0;
  let frame = 0; // the scroll animation
  let left = 0; // what is left of the current hold
  let heldSince = 0;
  let pending = -1; // a move that a pause interrupted: the route stop it was going to
  let ours = -1; // the scroll position our own animation last set, so its scroll events are not taken for the visitor's
  let oursAt = 0; // when it set it (its scroll event follows within a frame or two)
  let lastY = window.scrollY;
  let handsOffUntil = 0; // after a click or tap (a mark, the scrollbar), the visitor's own scrolling is left alone

  // the heading on screen, and the closing not yet reached
  const inReach = () => {
    if (!c.pinned.matches || document.hidden) return false;
    const r = c.heading.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight && c.position() < c.total() - 0.01;
  };
  const pinnedNow = () => c.track.getBoundingClientRect().top <= 1;
  const clear = () => {
    clearTimeout(timer);
    clearTimeout(resumeTimer);
    cancelAnimationFrame(frame);
    frame = 0;
  };
  // the next stop from here (a stop we are already at counts as the next one, so its hold plays)
  const nextStop = () => {
    const at = c.position();
    return c.route().findIndex((st) => st.at > at - 0.01);
  };
  // a smooth scroll to a page position, then what comes next
  const glide = (to: number, ms: number, then: () => void) => {
    const from = window.scrollY;
    const start = performance.now();
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      ours = Math.round(from + (to - from) * ease(t));
      oursAt = performance.now();
      window.scrollTo(0, ours);
      if (t < 1) frame = requestAnimationFrame(step);
      else {
        frame = 0;
        then();
      }
    };
    frame = requestAnimationFrame(step);
  };
  const hold = (k: number, ms: number) => {
    clearTimeout(timer);
    left = ms;
    heldSince = performance.now();
    timer = window.setTimeout(() => moveTo(k + 1), ms);
  };
  const moveTo = (k: number) => {
    const stop = c.route()[k];
    if (!stop) {
      setState("done");
      return;
    }
    pending = k;
    left = 0;
    glide(c.scrollFor(stop.at), stop.move, () => {
      pending = -1;
      if (k >= c.route().length - 1) setState("done");
      else hold(k, stop.hold);
    });
  };
  const play = () => {
    if (!inReach()) return;
    clear();
    setState("playing");
    // not pinned yet (the heading has only just come on screen): glide to where the section pins first
    if (!pinnedNow()) {
      const to = c.scrollFor(0);
      const ms = Math.min(1200, Math.max(400, Math.abs(to - window.scrollY) * 0.9));
      return glide(to, ms, () => play());
    }
    if (pending >= 0) return moveTo(pending); // finish the move a pause interrupted
    const k = nextStop();
    if (k < 0) {
      setState("done");
      return;
    }
    const route = c.route();
    if (Math.abs(route[k]!.at - c.position()) < 0.01) hold(k, left > 0 ? left : route[k]!.hold);
    else moveTo(k);
  };
  const pause = () => {
    if (state !== "playing") return;
    const moving = frame !== 0;
    clear();
    left = moving ? 0 : Math.max(0, left - (performance.now() - heldSince));
    setState("paused");
  };
  // the visitor takes over: let go, and wait for them to scroll down again
  const letGo = () => {
    clear();
    pending = -1;
    left = 0;
    if (state !== "done") setState("idle");
  };

  // The visitor's own scrolling, told apart from ours by where our animation last put the page
  const onScroll = () => {
    const y = window.scrollY;
    const dir = Math.sign(y - lastY);
    lastY = y;
    if (dir === 0 || (Math.abs(y - ours) < 2 && performance.now() - oursAt < 150)) return; // our own move
    if (performance.now() < handsOffUntil) return;
    if (dir < 0) {
      if (state === "done" && c.position() < c.total() - 0.05) setState("idle"); // back up from the closing
      if (state === "playing" || state === "paused") letGo();
      return;
    }
    // scrolling down (a deliberate scroll counts even with the mouse resting over the timeline)
    if (state === "done") return;
    if (state === "playing" && frame !== 0) return; // already moving that way
    // during a hold, a scroll down moves on from wherever the page now is (but not the tail of a fling that just
    // brought it here)
    if (state === "playing" && performance.now() - heldSince < 800) return;
    if (inReach()) {
      left = 0;
      pending = -1;
      play();
    }
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("pointerdown", () => {
    handsOffUntil = performance.now() + 1200;
    letGo();
  }, { passive: true });
  window.addEventListener("touchstart", letGo, { passive: true });
  window.addEventListener("keydown", (ev) => {
    if (["ArrowUp", "PageUp", "Home"].includes(ev.key) || (ev.key === " " && ev.shiftKey)) letGo();
  });

  // A mouse over the timeline pauses it; it resumes a moment after the mouse leaves
  timeline?.addEventListener("pointerenter", (ev) => {
    if (ev.pointerType !== "mouse") return;
    hovered = true;
    clearTimeout(resumeTimer);
    pause();
  });
  timeline?.addEventListener("pointerleave", (ev) => {
    if (ev.pointerType !== "mouse") return;
    hovered = false;
    if (state === "paused") resumeTimer = window.setTimeout(() => state === "paused" && play(), AUTOPLAY_RESUME_MS);
  });

  // A hidden tab holds the timer; coming back resumes it
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
    else if (state === "paused" && !hovered) play();
  });

  return {
    // Start at once (the help button): from anywhere above, it glides to the section and plays it
    startNow: () => {
      letGo();
      setState("playing");
      clear();
      if (!c.pinned.matches) return;
      const to = c.scrollFor(0);
      const ms = Math.min(1400, Math.max(400, Math.abs(to - window.scrollY) * 0.6));
      glide(to, ms, () => play());
    },
    reset: () => {
      clear();
      pending = -1;
      setState("idle");
    },
  };
}

document.title = L.pageTitle;
document.head.append(h("meta", { name: "description", content: L.description }));
document.getElementById("landing")!.append(
  h("a", { class: "skip", href: "#howto" }, L.howto.title),
  hero(),
  h("main", {},
    howto(),
    battle(),
    rules(),
    faq(),
  ),
);
rise();
battleLoop();
howtoScroll();
rulesScroll();
