---
name: Funge
description: A king-of-the-hill game on Bitcoin Cash, presented as the board game it is.
colors:
  box: "#0f1a33"
  box-deep: "#0a1226"
  board: "#15234a"
  board-hi: "#1c2d5a"
  groove-dark: "#050a18"
  groove-light: "#33497f"
  foil: "#e0a93a"
  foil-hi: "#f3cf74"
  foil-lo: "#9c6f1c"
  cream: "#f4ead2"
  cream-dim: "#c9c2b0"
  violet: "#8a55e0"
  crimson: "#d63a3c"
  obsidian: "#4a4a58"
  sapphire: "#2f73e0"
  silver: "#d0d3de"
typography:
  display:
    fontFamily: "Grenze Gotisch, Georgia, serif"
    fontSize: "clamp(5rem, 12vw, 11rem)"
    fontWeight: 900
    lineHeight: 0.85
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Grenze Gotisch, Georgia, serif"
    fontSize: "clamp(2.5rem, 5.5vw, 4rem)"
    fontWeight: 700
    lineHeight: 1
  title:
    fontFamily: "Grenze Gotisch, Georgia, serif"
    fontSize: "clamp(1.625rem, 2.4vw, 2rem)"
    fontWeight: 700
    lineHeight: 1.1
  body:
    fontFamily: "Alegreya Sans, Segoe UI, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Alegreya Sans, Segoe UI, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 700
    lineHeight: 1.2
  figure:
    fontFamily: "Alegreya Sans, Segoe UI, sans-serif"
    fontWeight: 700
    fontFeature: "\"tnum\" 1, \"lnum\" 1"
rounded:
  plate: "4px"
  frame: "6px"
  disc: "50%"
spacing:
  crease-gap: "3px"
  groove: "6px"
  lid-inset: "clamp(0.75rem, 1.6vw, 1.5rem)"
  fold-pad: "clamp(1.5rem, 2.6vw, 2.25rem)"
  part-pad-block: "clamp(3.25rem, 6.5vw, 5.5rem)"
  part-pad-inline: "clamp(1.25rem, 4vw, 3rem)"
  sheet-max: "76rem"
components:
  button-seal:
    backgroundColor: "{colors.foil}"
    textColor: "{colors.box}"
    typography: "{typography.headline}"
    rounded: "{rounded.frame}"
    padding: "0.85rem 1.6rem 0.85rem 1.8rem"
    height: "3.75rem"
  button-seal-hover:
    backgroundColor: "{colors.foil-hi}"
  fold-panel:
    backgroundColor: "{colors.board-hi}"
    textColor: "{colors.cream}"
    padding: "{spacing.fold-pad}"
  counter-token:
    backgroundColor: "{colors.foil}"
    textColor: "{colors.box}"
    typography: "{typography.figure}"
    rounded: "{rounded.disc}"
    size: "calc(var(--counter-base) + var(--v) * var(--counter-step))"
  rule-number:
    textColor: "{colors.foil-hi}"
    rounded: "{rounded.disc}"
    size: "2.5rem"
  tagline-plate:
    backgroundColor: "rgb(15 26 51 / 0.9)"
    textColor: "{colors.cream}"
    rounded: "{rounded.plate}"
    padding: "0.55rem 1rem 0.6rem"
  clockface:
    backgroundColor: "{colors.box}"
    textColor: "{colors.foil-hi}"
    rounded: "{rounded.frame}"
    padding: "0.55rem 0.9rem"
---

# Design System: Funge

## Overview

**Creative North Star: "The Box Lid and the Rule Sheet"**

Funge is shown as the board game it is. The painted valley is the box lid, framed in gold with printed corner marks and the title pressed into the sky as foil. Everything below the lid is one rule sheet printed on heavy navy board: ruled in gold hairlines, divided by crease grooves, its six rule panels hinging open along those creases as they scroll into view. Numbers are carried by punch-out counters in the four house colours, and a counter's size is what it is worth.

The world is dark, warm-on-cool and printed: navy board, gold foil and cream ink. Depth comes from print and fold, not from floating cards; panels are cut from one surface and separated by dark grooves with a lit edge. Density is generous and calm, with a few large blackletter headings over short, plain rule text.

Scope boundary: this system covers the landing page only (`landing.html`, `src/landing.ts`, `src/landing.css`). The game pages (`index.html` with `src/kingdomMode.ts`, and the Phaser battlefield in `src/battlefield/`) keep their own older look and are not governed by this file. Do not restyle them from it without a separate decision.

**Key Characteristics:**
- Navy board surfaces, gold foil for type and trim, cream for reading text.
- One surface, divided by creases: grooves and 3px dark gaps, never separate floating cards.
- Blackletter-hybrid display (Grenze Gotisch) over a humanist sans (Alegreya Sans); tabular figures for every amount.
- Counters sized by value with one formula per breakpoint; colour says who holds the money.
- The rules unfold panel by panel on scroll; static under reduced motion.
- Self-hosted fonts and the game's own art only.

## Colors

A printed-board palette: three steps of deep navy, a three-step gold foil, two creams for ink, and the four house colours reserved for counters.

### Primary
- **Pressed Gold Foil** (foil): the seal button face, the lid frame and band borders, the rule-number rings, the split operators, the pool's counters, selection and caret. At 40 to 70% alpha it draws every hairline rule on the sheet.
- **Lit Foil** (foil-hi): the face of foil type (the title, section headings, fact headings, clock figures), the corner marks, the hover face of the seal, and the focus ring.
- **Foil Rim** (foil-lo): the dark edge of pressed foil (title stroke, seal outer ring) and the scrollbar thumb. Never a text colour on navy.

### Secondary
The four house colours appear only as counter faces, with white figures (all at least 4.5:1).
- **House Violet** (violet), **House Crimson** (crimson), **House Sapphire** (sapphire): flat counter discs for a player's money.
- **House Obsidian** (obsidian): flat counter disc, always with an inner **Flag Silver** (silver) ring so it reads against the navy board. Silver has no other role.

### Neutral
- **Box Navy** (box): the lid's board, the box-side band, the clockface, and the ink on gold.
- **Box Bottom** (box-deep): page background, and the closing section as the bottom of the box.
- **Sheet Board** (board): the rule sheet's surface.
- **Raised Panel** (board-hi): each fold panel; also the ring that separates a counter from the board.
- **Groove Cut** (groove-dark) and **Groove Light** (groove-light): the two edges of a crease; the cut fills the 3px gaps between panels and the light line sits on every panel's top edge.
- **Cream Ink** (cream): body text and panel headings.
- **Dim Cream Ink** (cream-dim): intros, captions, counter labels, step text, footer.

### Named Rules
**The Colour Means Holder Rule.** A house colour on a counter says which player holds that money; gold says it is the pool. House colours are never used for decoration, borders or text.

**The Gold Is Printed Rule.** Gold is foil or a ruled line: a type face, a frame, a hairline, the seal. It is never a background wash or a gradient fill on large areas.

## Typography

**Display Font:** Grenze Gotisch, variable 100-900, self-hosted (with Georgia, serif)
**Body Font:** Alegreya Sans 400 and 700, self-hosted (with Segoe UI, sans-serif)

**Character:** A blackletter-hybrid box title and rule headings give the old-game, printed-box voice; the humanist sans keeps the rules plain and quick to read. Figures are always tabular lining numerals.

### Hierarchy
- **Display** (900, clamp(5rem, 12vw, 11rem); phones clamp(4.5rem, 24vw, 7rem); 0.85): the box title only, in foil.
- **Headline** (700, clamp(2.5rem, 5.5vw, 4rem), 1): section headings on the sheet and in the close, in lit foil. The seal button uses the display face at 700, clamp(1.5rem, 2.4vw, 1.875rem).
- **Title** (700, clamp(1.625rem, 2.4vw, 2rem), 1.05 to 1.1): fold, fact and step headings. The lead rule (conquer) steps up to clamp(2rem, 3.4vw, 2.75rem).
- **Body** (400, 1.1875rem, 1.55): rule and fact text, held to 34rem in panels and 40rem in facts. Intros at 1.25rem in dim cream.
- **Label** (700, 0.95rem, 1.2): counter labels, captions (1rem), spec strip items (1.0625rem), footer. Sentence case, no tracking.

### Named Rules
**The Tabular Money Rule.** Every amount, time and count is set with tabular lining figures, at two decimals for PUSD.

**The Two Faces Rule.** The display face is for the title, headings, rule numbers, the seal, operators and the clock figure; everything a visitor reads in sentences is the sans.

## Layout

The page is a lid and a sheet. The lid fills the first viewport minus 3rem (calc(100svh - 3rem), between 36rem and 64rem tall) so the sheet's first crease shows below it; inside a box-navy inset (lid-inset) sits the gold-framed art, with the title upper left over the painted sky and the box-side band along the bottom edge carrying the spec strip left and the seal right. The seal lifts 2.25rem out of the band.

The sheet is centred at 76rem with clamp-driven part padding, its parts separated by full-width 6px grooves. The rules sit in a 6-column grid of folds (open 2, conquer 4, then four panels of 3), cut from one surface with 3px dark gaps inside a gold hairline border. Facts are a two-column rule table (1fr / 1.6fr) between gold hairlines; steps are three columns split by gold hairlines.

At 64rem the folds go to two columns (conquer spans both) and facts stack. At 47.5rem (phones) the lid becomes a portrait box: title and tagline on navy board, then the whole valley at its native 4096 / 2313 aspect under a gold line, then the band stacked; folds and steps go to one column, and the counter formula tightens.

## Elevation & Depth

Depth is printed and folded, not floated. Surfaces sit flat; separation comes from crease grooves (a 2px dark cut, a 1px lit line, a soft fall-off), the lit top edge of each panel, and thin die-cut rings. Shadows are reserved for things that sit on top of the art or rise from the board: the foil title, the tagline plate and the seal.

### Shadow Vocabulary
- **Foil press** (`text-shadow: 0 -1px 0 #fff3c9, 0 2px 0 var(--foil-lo), 0 6px 14px rgb(10 18 38 / 0.45)` with a 2px foil-lo stroke): the box title only.
- **Seal rings** (`box-shadow: 0 0 0 3px var(--box), 0 0 0 4px var(--foil-lo), 0 10px 22px rgb(10 18 38 / 0.5)`): the one action.
- **Plate fall-off** (`box-shadow: 0 6px 14px rgb(10 18 38 / 0.35)`): the tagline plate over the sky.
- **Die-cut ring** (`box-shadow: 0 0 0 3px var(--board-hi), 0 0 0 4px rgb(5 10 24 / 0.7)`): every counter.
- **Panel lit edge** (`box-shadow: inset 0 1px 0 var(--groove-light)`): every fold panel.

### Named Rules
**The One Board Rule.** Panels are cut from one surface: a shared border, 3px groove-dark gaps, no per-panel radius or drop shadow.

**The Flat Counter Rule.** Counters are flat printed discs with a die-cut ring; no gradients, bevels or drop shadows on them.

## Shapes

Square-cut board with barely softened corners: 4px for plates and the fold grid, 6px for the lid frame, the seal, the clockface and the skip link. Circles only for counters and rule-number rings. Lines are gold: 2px for the lid frame, band top and close top; 1px at 40 to 70% alpha for rules on the sheet. The lid carries four drawn gold corner marks (a double rounded L, mirrored per corner).

## Components

### Buttons
The seal: the one action, gold and plainly a button.
- **Shape:** gently cut corners (6px), 2px lit-foil border, at least 3.75rem tall.
- **Primary:** foil face, box-navy display type at 700 with a drawn arrow icon, ringed in box navy then foil rim.
- **Hover / Focus:** lit-foil face and a 2px lift over 180ms on cubic-bezier(0.16, 1, 0.3, 1); returns on press. Focus is the global 3px lit-foil outline at 3px offset.
- **Placement:** rises out of the lid band; repeated once in the close.

### Fold Panels
- **Corner Style:** none per panel; the grid carries a 4px radius and gold hairline.
- **Background:** raised panel navy with a lit top edge.
- **Internal Padding:** fold-pad.
- **Head:** a rule-number ring (2.5rem circle, 2px foil ring, lit-foil display numeral) beside a cream title.

### Counters (signature)
- **Size:** calc(base + value x step); desktop 2.6rem + v x 0.42rem with text 0.95rem + v x 0.07rem; phones 2.2rem + v x 0.27rem with text 0.95rem + v x 0.04rem. The caption wraps under the disc, never widens it.
- **Colour:** house colour with white figures for a player; foil with box-navy figures for the pool; obsidian adds the silver inner ring.
- **Splits:** counters set in a row with display-face foil operators (= and +) or a bold dim-cream "or", under a bold dim-cream caption, read aloud as one sentence.

### Tagline Plate
A box-navy plate at 90% over the painted sky, 1px gold border at 70%, 4px corners, bold text balanced to 36rem. On phones the tagline prints straight on the board with no plate.

### Spec Strip
Bold items with 1.75rem game-art icons, divided by 1px gold hairlines at 45%.

### Clockface
Box-navy inset with a 1px gold border at 60% and 6px corners; a 2rem lit-foil display figure followed by dim-cream bold notes.

### Motion: the unfold
Each fold starts hinged up (rotateX(-82deg), brightness 0.45) from its top crease and opens over 760ms on cubic-bezier(0.16, 1, 0.3, 1) as it enters the view; panels arriving together open in rule order 120ms apart. Panels are open by default; the folded start exists only while the script runs and motion is allowed.

## Do's and Don'ts

### Do:
- **Do** print the sheet on navy board (board, board-hi) with cream ink and gold rules.
- **Do** size every counter with the one formula for its breakpoint, and show every payment as a split whose numbers add up.
- **Do** set every amount in tabular lining figures at two decimals.
- **Do** separate sheet parts with the crease groove and panels with 3px groove-dark gaps.
- **Do** keep the seal the only gold-faced button, with the foil press reserved for the box title.
- **Do** keep the unfold static under prefers-reduced-motion, with panels open when the script does not run.
- **Do** use self-hosted fonts and the game's own art; draw icons as SVG.

### Don't:
- **Don't** print the rule sheet on cream paper; cream is ink, not a surface.
- **Don't** use house colours for anything but counters.
- **Don't** float panels as separate cards with their own radius and drop shadow.
- **Don't** give counters gradients, bevels or drop shadows.
- **Don't** round corners beyond 6px except the circles of counters and rule numbers.
- **Don't** apply this system to the game pages (index.html, src/battlefield/) without a separate decision.
