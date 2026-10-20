# Emberwild: Age of Wings

A desktop-first browser game about collecting and raising dragons. Fly short **Dragon Rush** outings, master the designed courses of **Sky Trials**, survive the top-down **Dragon Arena**, raise 24 species from hatchling to elder, and open earned eggs in the **Aether Hatchery**.

Built with Vite, TypeScript, Canvas 2D and plain HTML/CSS. There is no backend, no accounts, no real-money purchases, no game framework and no image assets: all art is drawn at runtime and all sound is generated with Web Audio.

## Run it

**Quickest:** open `emberwild-dragon-rush.html` in a desktop browser (Chrome, Edge, Firefox or Safari). It is one self-contained file; progress saves in that browser.

**From source** (Node 18+, tested with Node 22):

```bash
npm install
npm run dev           # open the printed URL (default http://localhost:5173)
```

Other commands:

```bash
npm test              # all tests (Vitest): sims, economy, saves, hatchery, Trials, Arena, balance
npm run balance       # Rush balance table from scripted pilots
npm run typecheck     # TypeScript, no emit
npm run build         # typecheck + production build into dist/
npm run build:single  # rebuild emberwild-dragon-rush.html
```

Development pages: `?gallery` (every species × evolution stage, side view, top-down and egg; marking, pose and collision-outline toggles) and `?backgrounds` (the five regions and Arena floors).

## Controls

| | Dragon Rush & Sky Trials | Dragon Arena |
| --- | --- | --- |
| Move | Mouse height (or W/S, ↑/↓) | W A S D or arrows |
| Dash | Left-click or Space | Space or left-click (brief invulnerability) |
| Active ability | E | E |
| Attack | — | Automatic (nearest enemy) |
| Pause | Esc or the pause button | Esc |
| Fullscreen | F | F |

Menus are fully keyboard-navigable (Tab / Shift+Tab, Enter). Settings (gear icon) has master/music/effects volume, mute, reduced motion, low effects, auto-activate ability, collision outlines, and save export/import.

See [docs/PLAYER_GUIDE.md](docs/PLAYER_GUIDE.md) for modes, progression and the hatchery.

## Project layout

```
src/
  content/          data: species (24), progression (levels, talents), world (regions, milestones,
                    cosmetics, hatchery tables), mastery, trials (12 courses), shared types
  sim/flight.ts     pure Rush/Trials simulation: steering, dash, abilities, rocks, rings, lightning
  sim/course.ts     teaching openings and Rush pattern modules per region
  sim/arena.ts      pure Arena simulation: enemies, waves, upgrades, elite, boss, endless
  stats.ts          effective stats per mode (Trials normalized to level 1, no talents)
  economy.ts        transactions: settle runs (incl. Arena checkpoints), feed, talents, unlocks,
                    cosmetics, milestones/mastery/contracts payout, next goal
  hatchery.ts       egg odds, pity, crypto RNG, atomic openings, reveal recovery, reel builder
  contracts.ts      contract pool, progress, replacement
  save.ts           save v3, v1/v2 migration, backups, newer-save protection, export/import
  audio.ts          Web Audio buses, voice limiter, element motifs, music loops
  render/           dragon family rig (side + top-down), eggs, backgrounds, Arena floors,
                    flight and Arena renderers, hero/perch scene
  ui/               shell + screens (home, play, dragons, hatchery, journal), settings, results,
                    flight and Arena screens, dev gallery/preview
  app.ts            navigation, input routing, saving, mode launch and settlement
tests/              sims, economy/saves, hatchery, Trials and Arena calibration (scripted pilots)
docs/               plan & checklist (AGE_OF_WINGS.md), player guide, developer notes
```

## Saves

The save lives in `localStorage` under `emberwild.dragonRush.save` (version 3). Older saves are upgraded automatically: a one-time copy of the old save is kept under `emberwild.dragonRush.save.backup.v1`/`.v2`, dragons, levels (mapped so earned bonuses are kept), resources, settings, records, objectives (as contracts) and the lantern decoration (as a perch) carry over. A save from a newer version is never overwritten (the game runs in a temporary session). An unreadable save is kept under `…backup.corrupt` and can be downloaded from Settings. Export/import is in Settings; importing keeps a backup of the replaced save under `…backup.beforeImport`.

The game is a local single-player game: local saves are not tamper-proof and do not need to be.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
