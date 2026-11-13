---
name: Funge
description: A king-of-the-hill game on Bitcoin Cash, its landing page told as a painted medieval world in navy and gold.
colors:
  sky: "#125bce"
  box: "#0f1a33"
  box-deep: "#0a1226"
  board: "#15234a"
  foil: "#e0a93a"
  foil-hi: "#f3cf74"
  foil-lo: "#9c6f1c"
  cream: "#f4ead2"
  logo-cream: "#f8eeca"
  logo-navy: "#0f243d"
  logo-gold: "#fbbc28"
typography:
  hero:
    fontFamily: "Grenze Gotisch, Georgia, serif"
    fontSize: "min(clamp(3rem, 6.2vw, 7rem), 11.5svh)"
    fontWeight: 700
    lineHeight: 0.95
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Grenze Gotisch, Georgia, serif"
    fontSize: "clamp(2.5rem, 4.4vw, 4rem)"
    fontWeight: 700
    lineHeight: 1
  title:
    fontFamily: "Grenze Gotisch, Georgia, serif"
    fontSize: "clamp(1.5rem, 1.9vw, 1.875rem)"
    fontWeight: 700
    lineHeight: 1.05
  caps:
    fontFamily: "Cinzel, Georgia, serif"
    fontSize: "clamp(0.95rem, 1.2vw, 1.25rem)"
    fontWeight: 700
    letterSpacing: "0.16em"
    textTransform: "uppercase"
  body:
    fontFamily: "Alegreya Sans, Segoe UI, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 400
    lineHeight: 1.55
  small-body:
    fontFamily: "Alegreya Sans, Segoe UI, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.5
  button:
    fontFamily: "Alegreya Sans, Segoe UI, sans-serif"
    fontSize: "clamp(1.1875rem, 1.45vw, 1.5rem)"
    fontWeight: 700
    lineHeight: 1
rounded:
  card: "0.4rem"
  frame: "0.5rem"
  pill: "999px"
  disc: "50%"
spacing:
  section-gap: "clamp(4rem, 10vw, 8rem)"
  side-gutter: "clamp(1rem, 3.5vw, 3rem)"
  content-max: "72rem"
  faq-max: "52rem"
  reading-max: "34rem"
  touch-min: "2.75rem"
components:
  button-primary:
    backgroundColor: "{colors.logo-gold}"
    textColor: "{colors.logo-navy}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    height: "clamp(3.5rem, 4.4vw, 4.5rem)"
    shadow: "0 5px 0 {colors.logo-navy}"
  corner-button:
    backgroundColor: "{colors.logo-navy}"
    textColor: "{colors.logo-gold}"
    border: "2px solid {colors.logo-gold}"
    rounded: "{rounded.disc}"
    size: "clamp(2.1rem, 3vw, 2.6rem)"
  tooltip:
    backgroundColor: "{colors.logo-navy}"
    textColor: "{colors.logo-cream}"
    border: "1px solid logo-gold at 60%"
    rounded: "{rounded.card}"
  gold-frame:
    backgroundColor: "{colors.board}"
    border: "2px solid {colors.foil}"
    rounded: "{rounded.frame}"
  card:
    backgroundColor: "box at 92%"
    border: "1px solid foil at 55%"
    rounded: "{rounded.card}"
  parchment:
    backgroundColor: "{colors.logo-cream}"
    textColor: "{colors.logo-navy}"
  faq-item:
    backgroundColor: "box at 92%"
    border: "1px solid foil at 35%"
    rounded: "{rounded.card}"
---

# Design System: Funge

## Overview

**Creative North Star: "A Painted Kingdom in Navy and Gold"**

The landing page tells Funge as a painted medieval world. It opens in the daylight sky over the valley painting, where the four armies stand. Below that, the page falls into night navy. Everything after the hero lives on that navy ground, trimmed in gold the way the Funge logo is: cream letters on a hard navy edge, with crown gold.

The page is a sequence of scenes, not a document:
1. **The hero:** the valley painting.
2. **How to Play:** a pinned scene on the dusk battlefield with a gold timeline.
3. **The battle loop:** a recording of the real battlefield in a gold frame.
4. **The Fair Game Rules:** a parchment scroll between two painted rollers. It is the one light surface below the hero.
5. **The FAQ:** navy panels.
6. **The footer:** King Satoshi on his throne.

Scope boundary: this system covers the landing page only (`index.html` at `/`, `src/landing.ts`, `src/landing.css`). The game page (`play/index.html` at `/play/`, with `src/kingdomMode.ts`) and the Phaser battlefield in `src/battlefield/` keep their own older look and are not governed by this file. Do not restyle them from it without a separate decision.

**Key characteristics:**
- Night-navy ground, gold trim and cream type, all taken from the logo.
- The game's own paintings carry the scenes: the valley, the dusk field, the five How to Play paintings, the roller, the throne.
- A blackletter-hybrid for headings (Grenze Gotisch), Cinzel capitals for small labels and numerals, a humanist sans for reading (Alegreya Sans).
- One gold button, Play Now, which appears three times: in the hero, at the end of How to Play, and in the footer.
- Motion is driven by scrolling and can always be played back in reverse. Under reduced motion, everything is shown at once and open.
- Self-hosted fonts and the game's own art only. Icons are drawn as inline SVG.

## Colors

The palette is the logo's three colours plus a three-step gold and three steps of navy.

### The logo's colours (sampled from the logo)
- **Logo Cream** (logo-cream): every heading on navy, the hero line, tooltips, FAQ questions. Also the parchment's centre.
- **Logo Navy** (logo-navy): the hard edge under cream headings (a text shadow 0.055em down), the face of the round buttons and tooltips, the ink of Play Now and of the parchment.
- **Logo Gold** (logo-gold): the face of Play Now, the borders and icons of the round buttons, the How to Play crown, the reached timeline marks, the open FAQ diamond, the gold corner flourishes on frames.

### Gold foil (three steps)
- **Foil** (foil): frame borders, card trims (at 35 to 75%), Cinzel step numbers, FAQ group titles.
- **Foil High** (foil-hi): the focus outline and the FAQ step numbers.
- **Foil Low** (foil-lo): the dark gold for lines (the timeline road, the rules divider, the outer ring of frames), the scrollbar thumb, and the parchment's edge shading. Mixed with logo navy, it is the Roman numerals and rule titles on the parchment.

### Navy (three steps)
- **Box Deep** (box-deep): the page background from the foot of the hero down.
- **Box** (box): card and FAQ panel faces, at 92%. Also the wash over the dusk field, at 70%.
- **Board** (board): the inside of the gold frames and the face of an open FAQ item.

### Sky
- **Sky** (sky, #125bce): the hero's band above the painting, matched to the painting's own top edge so the join cannot be seen.

### Reading text
- **Cream** (cream): body text on navy (cards, FAQ answers).

### Named rules
**The Logo Colour Rule.** Headings, buttons and round controls use the logo's own cream, navy and gold. New controls take these three before anything else.

**The One Light Surface Rule.** Below the hero, the parchment scroll is the only light surface, and its text is navy ink. Everything else is navy with cream text.

**The Gold Is Trim Rule.** Gold is a border, a line, an icon, a numeral or the Play Now face. It is never a large background area.

## Typography

**Headings:** Grenze Gotisch, variable 100 to 900, self-hosted (falls back to Georgia, serif)
**Labels and numerals:** Cinzel, variable, self-hosted (falls back to Georgia, serif)
**Reading:** Alegreya Sans 400 and 700, self-hosted (falls back to Segoe UI, sans-serif)

### Hierarchy
- **Hero** (Grenze Gotisch 700, min(clamp(3rem, 6.2vw, 7rem), 11.5svh), line height 0.95): the hero headline only. It shrinks on short screens so the armies stay in view. On phones it is clamp(2.6rem, 12vw, 3.5rem).
- **Headline** (Grenze Gotisch 700, clamp(2.5rem, 4.4vw, 4rem), line height 1):
  - the section headings: How to Play, Fair Game Rules, FAQ;
  - the How to Play closing question, set larger at clamp(2.5rem, 5vw, 4.5rem);
  - the footer's closing line, at clamp(2.25rem, 4.6vw, 3.75rem).
- **Title** (Grenze Gotisch 700, clamp(1.5rem, 1.9vw, 1.875rem), line height 1.05): the How to Play card titles.
- **Caps** (Cinzel 700, uppercase, tracked 0.16em): the hero line (three words split by gold dots), the FAQ group names, the seal's line. Cinzel also sets:
  - the How to Play step numbers;
  - the rule titles, in title case, at clamp(1.05rem, 1.35vw, 1.2rem);
  - the Roman numerals.
- **Body** (Alegreya Sans 400, 1.1875rem, line height 1.55): the page default. Cards, rules and FAQ answers use 1.0625rem, at line height 1.45 to 1.55.
- **Strong** (Alegreya Sans 700): buttons, tooltips, FAQ questions (1.125rem).

### Named rules
**The Hard Edge Rule.** Cream headings on navy or sky carry the logo's hard navy edge (`text-shadow: 0 0.055em 0 var(--logo-navy)`). Where they sit on the painting, a soft glow is added as well.

**The Reading Width Rule.** Reading text is held to about 34rem in cards and the rules, and 42rem in FAQ answers.

## Layout

**The hero** fills the first screen:
- **Sky band:** a band of sky holds the headline, the hero line and Play Now, centred.
- **Painting:** the whole valley painting (4096 / 2313) is pulled up under the band, so its own open sky sits behind the words. Its foot fades into box-deep.
- **Logo and buttons:** the logo sits top left. The two round buttons sit top right: How to Play first, then Rules, with their feet on the logo's foot line.

**How to Play** is a pinned stage, one screen tall, over a scroll track:
- The heading runs across the top.
- The square painting panel is on the left and the timeline is on the right, centred at 72rem.
- The crown stays put while the column of steps slides past it.
- At the end, the panel shrinks away, a gold line draws down with the crown riding its tip, and the question and Play Now rise in.
- Below 43.75rem, or under reduced motion, it stacks: one row per step, its painting above its card, then the closing.

**The battle loop** is a 16:9 video in a gold frame, up to 64rem wide.

**The Fair Game Rules:**
- The parchment sheet hangs between two rollers, up to 72rem wide.
- The ten rules sit in two columns, each numbered with a Roman numeral hung in the margin.
- Below 900px, the rules form one column at 34rem.
- Below 700px, the rollers are thinner and the numerals lead the titles inline.

**The FAQ** is one 52rem column with three groups.

**The footer** is centred: the throne painting (up to 56rem, its edges fading into the page), the closing line, Play Now, and the X link under a hairline.

### Breakpoints
- 47.5rem: the hero becomes phone layout (sky band, then the whole painting, buttons stacked full width).
- 43.6875rem: How to Play stacks.
- 900px: the rules form one column.
- 700px: the rules and the FAQ use phone sizes.

## Elevation and depth

Depth comes from the paintings, gold frames and hard logo edges, not from floating cards.

### Shadow vocabulary
- **Hard edge** (`0 5px 0 logo-navy`, plus a soft navy fall-off): Play Now and the round buttons, the logo's pressed look. Hover lifts by 2px and deepens the edge. Pressing pushes down and flattens it.
- **Frame rings** (`0 0 0 0.4rem box-deep, 0 0 0 calc(0.4rem + 1px) foil-lo, 0 24px 60px box-deep at 70%`): the How to Play painting panel and the battle loop.
- **Card fall-off** (`0 18px 40px box-deep at 60%`): How to Play cards.
- **Glow** (logo-gold at 55 to 70%, 10 to 28px): the timeline's lit line, the crown and the closing line only.
- **Paper shadow** (`0 24px 50px black at 40%`): the parchment sheet. The rollers carry a drop shadow.

### Named rules
**The Gold Glow Rule.** Glow is reserved for the How to Play timeline and its crown. Nothing else glows.

## Shapes
- **Corners:** 0.4rem for cards, FAQ panels and tooltips; 0.5rem for the gold frames; pills for buttons; circles for the round buttons, the crown and the FAQ step numbers.
- **Diamonds:** the timeline marks and the FAQ's open or shut mark are small rotated squares. The rules divider has a diamond in its centre.
- **Corner flourishes:** gold flourishes (a rounded corner stroke with a small diamond, `--corner-tl/tr/br/bl`), drawn as masks so they take the element's colour. They sit on the gold frames (2rem) and How to Play cards (1.25rem).

## Components

### Play Now (button-primary)
The one action. Logo gold face, logo navy text in Alegreya Sans 700 with a drawn arrow, a pill shape at least 3.5rem tall, and a hard navy edge under it.
- **Hover:** the face lightens toward cream and lifts 2px over 160ms on cubic-bezier(0.16, 1, 0.3, 1).
- **Active:** it presses 3px down.
- **Where:** the hero, the end of How to Play, and the footer. It links to `/play/?mode=battlefield`.

### Round buttons (corner-button and social)
Logo navy discs with a 2px logo gold ring and a gold SVG icon:
- the question mark (How to Play);
- the scroll (Fair Game Rules);
- the X logo in the footer.

Each one's name shows as a tooltip on hover or focus: navy, a gold hairline, cream bold text and a small arrow. The touch area is always at least 2.75rem, even when the disc is drawn smaller (1.8rem on phones). The X button fills gold on hover.

### Gold frame
A board navy panel with a 2px foil border at 0.5rem corners, the frame rings, and gold corner flourishes. It holds the How to Play paintings and the battle loop.

### How to Play card and timeline
- **Card:** box navy at 92%, a 1px foil trim at 55%, corner flourishes, a Cinzel step number in foil, a Grenze title in logo cream, and cream body text.
- **Timeline:** a 2px road in foil-lo that fills gold as the steps pass. Each step has a diamond mark on the road with a 2.75rem target around it. A fixed crown node with a glow and a connector points at the active card.
- **Cards in view:** only the active card and the next one show (the next one at 42% and scaled to 0.94).

### Parchment scroll
- **Rollers:** one painted image (`public/assets/rules/roller.webp`), drawn as a border image so the gold ends keep their shape and only the shaft stretches.
- **Sheet:** a logo-cream radial gradient with a fine fractal-noise grain, warmer at the edges, and shaded where it rolls onto each roller.
- **Text:** navy ink, a Grenze heading over a gold divider with a diamond, ten Cinzel rule titles with Roman numerals, and a gold wax seal with the crown at the foot.

### FAQ item
A native `<details name="faq">`, so only one answer is open at a time. It is a box navy panel with a foil hairline at 35%, which brightens on hover.
- **Open:** a board face, a 75% trim, and the diamond filled gold and turned.
- **Steps:** answers can hold numbered steps on small gold-tinted discs.
- **Motion:** where the browser supports it, answers slide open over 280ms.

### Footer throne
A painting with no frame. A four-sided gradient mask fades its edges into box-deep, deepest at the foot, where the closing line follows.

## Motion
- **The hero:** no motion apart from button lifts.
- **How to Play:** driven by the scroll position (custom properties `--grow`, `--shift`, `--s`, `--e`), using transforms and opacity only, so scrolling back plays it in reverse.
  - Paintings change by squashing flat into a line (170ms) and opening out of it (260ms).
  - Card words rise in over 320ms.
  - An autoplay glides through the steps when the visitor arrives scrolling down, and lets go when they scroll up, click or tap.
- **The battle loop:** rises 2.5rem as it scrolls in.
- **The parchment scroll:**
  - **Opening:** it unrolls when its top passes 50% of the screen, over 1.9 to 3 seconds scaled by its height (1.6ms per pixel), on cubic-bezier(0.45, 0.05, 0.3, 1). The sheet's clipped edge stays under the moving roller.
  - **Closing:** it rolls shut over 900ms when it leaves the screen.
- **Easing:** the standard ease-out is cubic-bezier(0.16, 1, 0.3, 1), used for hovers, cards, FAQ and marks.
- **Reduced motion:** no pinning, no autoplay, no unrolling (the scroll stays open), no slides. Everything is shown at once.

## Do's and Don'ts

### Do:
- **Do** take colours for new headings and controls from the logo: cream, navy, gold.
- **Do** give cream headings the logo's hard navy edge.
- **Do** keep Play Now the only gold-faced button, and keep every other control a navy disc or panel with gold trim.
- **Do** frame paintings and video in the gold frame with corner flourishes.
- **Do** keep touch targets at least 2.75rem, and keep a visible focus outline (3px foil-hi, 3px offset).
- **Do** keep motion on transform and opacity, reversible with scrolling, and fully static under reduced motion.
- **Do** take every word from `COPY.landing` in `src/copy.ts`, and every rule number from the rule constants.
- **Do** use self-hosted fonts and the game's own art, and draw icons as inline SVG.

### Don't:
- **Don't** add a second light surface below the hero; the parchment is the only one.
- **Don't** use gold as a large background, or glow anything outside the How to Play timeline.
- **Don't** put a hard border or frame around the throne painting; it fades into the page.
- **Don't** load the game's code (libauth, Phaser, `src/lib/kingdom.ts`) into the landing page; it stays a small bundle.
- **Don't** apply this system to the game page (`play/index.html`, `src/battlefield/`) without a separate decision.

## Leftovers in the code
`landing.css` still declares tokens and classes from the earlier box-lid design that nothing on the page uses any more:
- the colours `--board-hi`, `--cream-dim`, `--violet`, `--crimson`, `--obsidian`, `--silver` and `--sapphire`;
- the button styles `.btn--small` and `.btn--quiet`.

They can be removed in a clean-up pass.
