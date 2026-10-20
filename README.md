# Emberwild: Dragon Rush

A small desktop-first browser game. Fly for 60 seconds, steer through gold and Emberfruit, dash through treasure, bank your haul, feed your dragon, and save up to hatch a second dragon.

Built with Vite, TypeScript, Canvas 2D and plain HTML/CSS. There is no backend, no game framework and no image assets: all art is drawn at runtime and all sound is generated with Web Audio.

## Run it

Requires Node 18+ (tested with Node 22).

```bash
npm install
npm run dev        # open the printed URL (default http://localhost:5173)
```

Other commands:

```bash
npm test           # unit, mechanics, progression and balance tests (Vitest)
npm run balance    # balance tests only, with a table of simulated run hauls
npm run typecheck  # TypeScript, no emit
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
```

## How to play

| Action | Mouse | Keyboard |
| --- | --- | --- |
| Steer | Move the mouse up/down over the playfield | ↑/↓ or W/S |
| Dash | Left-click | Space |
| Pause | Pause button | Esc |

- The world scrolls on its own. Only the dragon's height is yours to control.
- Coins give 1 gold each and Emberfruit gives 1 fruit each. Nearby pickups drift toward you.
- Chests (8 gold) and ripe Emberfruit pods (6 fruit) have glowing cracks. Dash into them to break them; just touching one only nudges you.
- Mossy rocks are solid. Hitting one slows you briefly; you never lose resources.
- Each pickup adds 1 Rush charge and each container adds 3. A full meter starts **Dragon Rush** for 6 seconds: a huge pickup pull, containers break on contact, and a bonus trail of pickups appears.
- Ember (start): dash breaks containers from about 20% farther. Tide (unlockable): pulls in pickups from 25% farther.
- Hatch Tide's egg for 200 gold + 80 Emberfruit. Feed a dragon 30 then 60 Emberfruit to reach levels 2 and 3, which add +5% / +10% to each run's banked haul. After Tide hatches, a 300-gold cosmetic Lantern Garland is available for the nest.

## Project layout

```
src/
  config.ts              all tuning: speeds, dash, Rush, rewards, dragon traits, costs, save key
  sim/course.ts          teaching opening + 8 reusable course patterns (editable data)
  sim/flight.ts          pure simulation (no DOM): steering, dash, collisions, Rush, events
  sim/rng.ts             seeded PRNG
  economy.ts             pure progression rules: settle run, feed, hatch, decoration
  save.ts                versioned localStorage save with sanitizing
  audio.ts               generated Web Audio effects
  render/                canvas art (items, dragons, backdrop, perch) and the flight renderer
  ui/                    Home, Flight (HUD + pause), Results, hatch reveal
  app.ts                 screen flow, input routing, scaling, settlement
tests/
  flight.test.ts         mechanics (steering, dash, containers, rocks, Rush, bounds)
  economy.test.ts        settlement, purchases, save round-trips, fresh-save progression
  balance.test.ts        hauls from many headless runs with scripted pilots
  bots.ts                scripted pilots used by the tests
```

The save lives in `localStorage` under `emberwild.dragonRush.save` (version 1). The game never reads or writes other keys.

## Design notes

- **Fixed 1280×720 playfield.** It scales to fit the window, with letterboxing. Pointer positions are mapped through the canvas's on-screen rectangle, so steering stays accurate after a resize.
- **Frame-rate independence.** Each frame is capped at 0.1 s and simulated in substeps of at most 1/120 s. Container checks are swept from the previous position, so a dash can't skip a chest even at low frame rates.
- **Exactly-once payouts.** Pickups and containers have unique ids and a paid-once guard. Container sprays are visual only. A run marker is saved when a run starts and cleared in the same save write that banks the haul. If you reload mid-run, that run's unbanked haul is abandoned and a notice appears on the next load. Results and pause buttons act only once.
- **Pausing** (Esc, the pause button, or losing window focus) stops the simulation entirely, so the timer, cooldowns and Rush all freeze. A focus-loss pause needs a Resume click. That click lands on a button, not the playfield, and a short input guard means it can't trigger a dash.
- **Reduced motion** (Home setting; follows the OS preference on a fresh save) turns off camera shake and bright flashes.

## Balance (measured, not guaranteed)

`npm run balance` plays 40 seeded runs per scripted pilot. The latest results:

| Pilot | Gold | Emberfruit | Rush activations |
| --- | --- | --- | --- |
| Reasonable (0.25 s reactions, imperfect aim, dashes at ~70% of containers) | ~93 | ~32 | 2 |
| Never dashes | ~74 | ~24 | 2 |
| Careless (ignores the course) | ~31 | ~10 | ~1 |

With the reasonable pilot, a fresh save can hatch Tide in about 3 runs (tests require 2–5), or about one run later if Ember is fed first. These are bot figures, so real players may differ. Tune `src/config.ts` and `src/sim/course.ts` after playtesting.

The Rush threshold is 30 rather than the initially specified 25. At 25, simulated runs triggered Rush 3–4 times; at 30 they trigger about twice.

## Known limitations

- Desktop-first. Touch input isn't designed for, and phone layouts aren't supported.
- There's no music, only short generated effects. The optional web font loads from Google Fonts; offline, the game falls back to system fonts.
- Refreshing during a run abandons that run's haul by design. Pause and resume work normally.
- Balance comes from scripted pilots, not human playtests.
