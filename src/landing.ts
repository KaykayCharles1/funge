// The landing page (landing.html): Funge presented as a board game. The painted valley is the box lid; the rules,
// the fairness facts and the first steps are one rule sheet below it. Every word comes from COPY.landing.
// Its one action is Join live battle, which opens the battlefield.
import "./landing.css";
import { COPY } from "./copy.ts";

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

const money = (v: number) => v.toFixed(2);
const groove = () => h("div", { class: "groove", "aria-hidden": "true" });
const joinButton = () => h("a", { class: "btn btn--primary", href: BATTLE }, L.join, arrow());

// A punch-out counter: its size follows what it is worth, its colour who holds it
// (a house colour for a player, gold for the pool)
type Holder = "pool" | "violet" | "crimson" | "obsidian" | "sapphire";
function counter(value: number, label: string, holder: Holder): HTMLElement {
  const el = h("div", { class: `counter counter--${holder}` },
    h("span", { class: "counter__token num" }, money(value)),
    h("span", { class: "counter__label" }, label),
  );
  el.style.setProperty("--v", String(value));
  if (holder !== "pool") el.style.setProperty("--c", `var(--${holder})`);
  return el;
}
const op = (sign: string) => h("span", { class: "split__op" }, sign);

// A worked example: a caption, then the counters with their split. The figure's label reads it as one sentence.
function split(caption: string, spoken: string, ...row: HTMLElement[]): HTMLElement {
  return h("figure", { class: "split", "aria-label": `${caption}: ${spoken}` },
    h("figcaption", { class: "split__caption" }, caption),
    h("div", { class: "split__row", "aria-hidden": "true" }, ...row),
  );
}

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

function rules(): HTMLElement {
  const kinds = ["open", "conquer", "protect", "clock", "win", "cancel"] as const;
  const folds = L.rules.map((r, i) => {
    const kind = kinds[i]!;
    const fold = h("article", { class: `fold fold--${kind}` },
      h("div", { class: "fold__head" }, h("span", { class: "rule-no", "aria-hidden": "true" }, String(i + 1)), h("h3", {}, r.title)),
      h("p", {}, r.text),
    );
    if (kind === "open") {
      fold.append(split(L.openCaption, `${L.openPaid} 10.00 = ${L.openPool} 10.00`,
        counter(10, L.openPaid, "violet"), op("="), counter(10, L.openPool, "pool")));
    }
    if (kind === "conquer") {
      // A throne worth 10.00. The numbers check each other: 10.20 = 9.20 + 1.00.
      fold.append(split(L.splitCaption, `${L.splitPaid} 10.20 = ${L.splitBack} 9.20 + ${L.splitPool} 1.00`,
        counter(10.2, L.splitPaid, "sapphire"), op("="), counter(9.2, L.splitBack, "crimson"), op("+"), counter(1, L.splitPool, "pool")));
    }
    if (kind === "protect") {
      const or = () => h("span", { class: "split__or" }, L.protectOr);
      fold.append(split(L.protectCaption, `${L.protectAdd} 1.00 ${L.protectOr} 5.00 ${L.protectOr} 10.00`,
        counter(1, L.protectAdd, "obsidian"), or(), counter(5, L.protectAdd, "obsidian"), or(), counter(10, L.protectAdd, "obsidian")));
    }
    if (kind === "clock") {
      fold.append(h("div", { class: "clockface" },
        h("strong", { class: "num" }, L.clockAdd),
        h("span", { class: "nowrap" }, L.clockCaption),
        h("span", { class: "nowrap num" }, L.clockCap),
      ));
    }
    if (kind === "win") {
      fold.append(h("img", { class: "fold__art", src: `${ASSETS}treasure/chest.webp`, alt: "", height: "72" }));
    }
    return fold;
  });
  return h("section", { class: "sheet__part", id: "rules", "aria-labelledby": "rules-title" },
    h("h2", { id: "rules-title" }, L.rulesTitle),
    h("p", { class: "sheet__intro" }, L.rulesIntro),
    h("div", { class: "folds" }, ...folds),
  );
}

function fair(): HTMLElement {
  return h("section", { class: "sheet__part", id: "fair", "aria-labelledby": "fair-title" },
    h("h2", { id: "fair-title" }, L.trustTitle),
    h("ul", { class: "facts" }, ...L.trust.map((t) => h("li", {}, h("h3", {}, t.title), h("p", {}, t.text)))),
  );
}

function start(): HTMLElement {
  return h("section", { class: "sheet__part", id: "start", "aria-labelledby": "start-title" },
    h("h2", { id: "start-title" }, L.startTitle),
    h("ol", { class: "steps" }, ...L.start.map((s) => h("li", {}, h("h3", {}, s.title), h("p", {}, s.text)))),
  );
}

// The rule sheet: one board, its parts divided by crease grooves
function sheet(): HTMLElement {
  return h("div", { class: "sheet" }, groove(), rules(), groove(), fair(), groove(), start(), groove());
}

function close(): HTMLElement {
  return h("section", { class: "close", "aria-labelledby": "close-title" },
    h("img", { class: "close__keep", src: `${ASSETS}castle/keep.webp`, alt: "" }),
    h("h2", { id: "close-title" }, L.closing),
    joinButton(),
    h("p", { class: "close__note" }, L.joinNote),
  );
}

// The signature motion: the rule sheet unfolds as you scroll. Each panel hinges down from the crease above it the
// moment it comes into view; panels arriving together (one row on a wide screen) open in rule order, a beat apart.
// Panels are open by default; the folded start exists only while this script runs and motion is allowed.
function unfold(): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
  const folds = Array.from(document.querySelectorAll<HTMLElement>(".fold"));
  const io = new IntersectionObserver((entries) => {
    const arriving = entries.filter((e) => e.isIntersecting).map((e) => e.target as HTMLElement);
    arriving.sort((a, b) => folds.indexOf(a) - folds.indexOf(b));
    arriving.forEach((el, i) => {
      el.style.transitionDelay = `${i * 120}ms`;
      el.classList.add("is-open");
      io.unobserve(el);
    });
  }, { threshold: 0, rootMargin: "0px 0px -12% 0px" });
  document.documentElement.classList.add("js-unfold");
  for (const f of folds) io.observe(f);
}

document.title = L.pageTitle;
document.head.append(h("meta", { name: "description", content: L.description }));
document.getElementById("landing")!.append(
  h("a", { class: "skip", href: "#rules" }, L.rulesTitle),
  hero(),
  h("main", {}, sheet(), close()),
);
unfold();
rise();
