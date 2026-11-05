# Animation brief: the Funge battlefield

Goal: replace the plain play page with an animated field where every game event plays as a short scene.
The rules, contracts and referee are finished. This is only a new front-end layer that listens to events
(docs/EVENTS.md) and draws.

## Look
Painted-and-chibi fantasy. Palette: deep navy, teal, warm gold, crimson, cream, jewel accents. Day field by
default; dusk in the last 30 seconds. Words: "Treasury", "kingdom value", "conquer", "protect".

## Houses and people
- Four houses and soldiers: violet (spearman, #8a55e0), crimson (swordsman, #d63a3c), emerald (archer,
  #2fa655), sapphire (halberdier, #2f73e0).
- Events carry only key hashes. Until a name feature exists, derive identity per round in identity.ts: the
  first time a key appears (compare the first 22 hex characters), give it the next free house in order, a
  portrait picked by hash from assets/portraits/manifest.json, and the name stored with that portrait.
  Portrait outfit color does not need to match the house. The house color appears on the card header, banner,
  soldiers and HUD ring. Keep all of this in one file so chosen names and avatars can replace it later.
- "You" is the connected wallet's key (find the accessor in src/wallet/). Highlight your kingdom, say
  "John conquered YOUR kingdom", and show "Take back your throne" (a normal conquest, price shown) to the
  previous king.

## What the scene shows (from the fields after each event)
- Castle: keep while value < 2500 base units (25.00), the three-tower castle from 2500.
- Walls: min(8, 2 + floor((value - 1000) / 500)) pieces; one drops in per protect.
- Garrison: 6 + 2 * floor((value - 1000) / 500) soldiers of the king's house around the castle.
- Banner and castle flags: the king's house color. Chest and coin pile grow with the treasury (full at 6000).
- HUD: bell with a ring (remaining time / clockSeconds), king plate (avatar, name, value), two shield icons
  (protectsLeft), "Next conquest costs" = value plus the fee (2%, read from the game file).
- Money is in base units with 2 decimals. Format it with one helper.

## Events to scenes
| Event | Full scene | Short | Quick |
|---|---|---|---|
| open | "First king" coronation card, banner rises, castle pops, coins to chest (1.8 s) | 1 s | 0.4 s |
| protect_applied | A wall piece drops in with a bounce, shield ring, a shield dims, floating "-amount", coins to chest (0.9 s). Never blocks other scenes. | - | - |
| conquer | Face-off cards with VS (1.4 s), army marches in (1.8 s), clash with slashes, fallen soldiers drop coins and gems (1.5 s), "New king" card (1.6 s). Floating numbers: paid, refunded, toTreasury. | 3.5 s | 1.2 s |
| observed_on_chain | Banner flash, snap to the event's state | - | - |
| clock_warning 60s | Bell begins a slow swing | - | - |
| clock_warning 30s | Sky crossfades to dusk (2 s), red edge pulse, protect disabled | - | - |
| clock_warning 10s | Heartbeat pulse on the ring | - | - |
| clock_paused / resumed | Freeze the ring and dusk with a "Network busy" ribbon / remove it | - | - |
| round_over | Bell tolls, soldiers stand still, king card glows. The king sees "Claim your reward", others "Waiting for the king to claim" | - | - |
| round_settled | Coins burst from the chest to the winner, "Wins X" card, summary. If conquests = 0: "No challengers, pool returned" | - | - |
A resync or a gap in seq: cancel queued scenes and snap to the snapshot.

## Queue rule (important)
Events can arrive while a scene is playing. Keep a queue in director.ts. Play the full scene only when
nothing is waiting; one waiting: short; two or more: quick. HUD numbers must never lag the latest event by
more than 1.5 s. If more than 3 are waiting, drop to the snapshot.

## Assets (public/assets, WebP with transparency; manifest.json lists portraits, names and face crops)
portraits/ (10 kings and queens), soldiers/ (4 houses), castle/ (keep, castle, wall, banner), treasure/
(chest, coin_pile, coin, gem), icons/ (bell, shield, crown), backgrounds/ (field_day, field_dusk).
Show soldiers at about 56 px. Check every file for stray edges and leftover green. Budget: 6 MB total, and
load the dusk background after the first frame. Randomize soldier size by 8 percent, flip by direction,
offset the bobbing. If soldiers still have a base ring and flag, accept it for now.

## Technical rules
- Phaser 3 with TypeScript strict, version pinned. New code only in src/battlefield/ (index.ts, scene.ts,
  director.ts, identity.ts, hud.ts, assets.ts, mockScenarios.ts). One mount call in the play page, behind
  ?mode=battlefield and a config flag, so the old page keeps working.
- Subscribe with onSceneEvent and onSceneSnapshot from src/sceneBus.ts. Use the page's existing
  server-synced clock for countdowns, never Date.now().
- Extra mock scenarios (several conquests, a pause, a settle) go in src/battlefield/mockScenarios.ts through
  the mock source. Do not edit src/mockRound.ts.
- Same-origin files only. After the build, run preview and check the console for CSP violations.
- Provide a mute button and respect reduced motion.

## Steps (stop after each, show how to run it, wait for my OK)
A1 check assets and write manifest.json. A2 Phaser scene with the day field and HUD frame. A3 static scene
from a snapshot (castle, walls, banner, garrison). A4 director and queue fed by the mock player. A5 the scenes
in the table. A6 game-style Conquer and Protect buttons and "Take back your throne". A7 sound, mobile layout,
loading screen. A8 live chipnet round, phone test, performance check.

## Done when
The mock round plays end to end, 60 fps with 60 sprites on a mid laptop, works at 375 px wide, no console or
CSP errors in the preview build, and a resync snaps cleanly.