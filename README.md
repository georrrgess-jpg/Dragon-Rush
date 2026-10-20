# Emberwild: Dragon Rush

A small desktop-first browser game. Fly short 60-second outings, steer through gold and Emberfruit, dash through treasure, bank your haul, feed your dragons, complete objectives, and hatch new dragons.

Built with Vite, TypeScript, Canvas 2D and plain HTML/CSS. There is no backend, no game framework and no image assets: all art is drawn at runtime and all sound is generated with Web Audio.

## Run it

**Quickest:** open `emberwild-dragon-rush.html` in a desktop browser. It's one self-contained file, and progress saves in that browser.

**From source** (Node 18+, tested with Node 22):

```bash
npm install
npm run dev           # open the printed URL (default http://localhost:5173)
```

Other commands:

```bash
npm test              # unit, mechanics, animation, progression and balance tests (Vitest)
npm run balance       # balance tests only, with a table of simulated hauls
npm run typecheck     # TypeScript, no emit
npm run build         # typecheck + production build into dist/
npm run build:single  # rebuild emberwild-dragon-rush.html
```

## How to play

| Action | Mouse | Keyboard |
| --- | --- | --- |
| Steer | Move the mouse up/down over the playfield | ↑/↓ or W/S |
| Dash | Left-click | Space |
| Pause | Pause button | Esc |
| Fullscreen | Home settings | F |

- The world scrolls on its own. Only the dragon's height is yours to control.
- Coins give 1 gold each and Emberfruit gives 1 Emberfruit each. Nearby pickups drift toward you.
- Chests (8 gold) and Emberfruit pods (6 Emberfruit) have glowing cracks. Dash into them to break them; just touching one only nudges you.
- Mossy grey rocks are solid. Hitting one slows you briefly; you never lose resources.
- Each pickup adds 1 Rush charge and each container adds 3. A full meter starts **Dragon Rush** for 6 seconds: a huge pickup pull, containers break on contact, and a bonus trail of pickups appears.
- **Sunset Canyon** unlocks after 4 full flights. Flying through a wind ring adds 4 Rush charge. Rings never push the dragon, and they add nothing during an active Rush.

### Dragons

| Dragon | Trait | How to unlock |
| --- | --- | --- |
| Ember | Long dash: breaks containers from 20% farther | Starting dragon |
| Tide | Wide pull: attracts pickups from 25% farther | 200 gold + 80 Emberfruit |
| Grove | Green thumb: pods give 8 Emberfruit instead of 6 | Split 10 pods (lifetime), then 250 gold + 60 Emberfruit |
| Gale | Quick recovery: dash recharges in 2.4 s instead of 3 s | Dash through 20 containers (lifetime), then 350 gold |

Lifetime requirements count historical totals, so spending never lowers them. Feed a dragon 30, then 60 Emberfruit for levels 2 and 3. Those levels add +5% and +10% to every run's banked haul, rounded down once. After Tide hatches, a 300-gold cosmetic Lantern Garland is available.

### Objectives

Three objectives are active at a time, drawn from a curated pool of 12. Examples are breaking chests, collecting Emberfruit, triggering Rush, finishing a flight with a particular dragon, and flying through wind rings. Progress accumulates across outings, including early returns, and never resets after a collision. Each objective pays a modest reward once and is replaced by the next suitable one. Objectives never require a locked dragon or environment. There are no deadlines or streaks.

## Project layout

```
src/
  config.ts              tuning: flight, dash, Rush, rings, rewards, dragons, unlocks, environments
  sim/course.ts          teaching openings + course patterns per environment (editable data)
  sim/flight.ts          pure simulation (no DOM): steering, dash, collisions, rings, Rush, events
  economy.ts             pure progression rules: settle run, unlock, feed, select, decoration
  objectives.ts          objective pool, progress and exactly-once payout
  save.ts                versioned save, v1 -> v2 migration, backups, field-by-field defaults
  audio.ts               generated Web Audio effects
  render/dragonArt.ts    shared dragon rig and the four species
  render/dragonAnim.ts   animation states and blending (idle, flight, dash, recoil, Rush, feed, celebrate)
  render/                items, parallax backdrops (Sky Isles, Sunset Canyon), perch, flight renderer
  ui/                    Home, Flight HUD + pause, Results, hatch reveal
  app.ts                 screen flow, input routing, scaling, fullscreen, settlement
tests/                   flight, economy/save/objectives, animation, balance; bots.ts = scripted pilots
```

## Saves

- The save lives in `localStorage` under `emberwild.dragonRush.save` and is now **version 2**.
- Before migrating, a raw copy of the older save is written once to `emberwild.dragonRush.save.backup.v1`. It's never overwritten.
- Corrupt data is also copied, to `...backup.corrupt`, before a fresh save starts.
- Migration keeps the wallet, owned dragons, levels, selection, decoration, settings and best haul.
- Version 1 didn't track containers, pods, dashes or Rushes. Lifetime totals for those start from a small allowance based on the runs version 1 did count (up to 6 runs' worth). The allowance never comes from the wallet and is below every unlock target.
- Missing fields get defaults; nothing is erased because a field is missing.
- The game never reads or writes other keys.

## Design notes

- **Fixed 1280×720 playfield.** It scales to fit the window or fullscreen, with letterboxing. Pointer positions are mapped through the canvas's on-screen rectangle. Pointer movement over or near HUD buttons, and over menus, never steers.
- **Steering** uses critically damped smoothing, so the dragon moves without overshoot or lag. The dragon covers 90% of a 280 px move in about 0.35 s.
- **Frame-rate independence.** Each frame is capped at 0.1 s and simulated in substeps of at most 1/120 s. Container and ring checks are swept from the previous position, so fast dashes can't skip them. Below 10 fps the game slows down instead of jumping.
- **Exactly-once payouts.** Pickups, containers, rings, objectives and purchases each resolve once. Visual fragments never pay. A run marker is saved at run start and cleared in the same write that banks the haul, lifetime totals and objective rewards. Reloading mid-run abandons that run's unbanked haul and shows a notice.
- **Pausing** (Esc, the pause button, or losing focus) freezes the timer, cooldowns and Rush. A focus-loss pause needs an intentional Resume. A short input guard stops that click from also dashing.
- **Animation.** All dragons share one rig. The jointed wings beat with a fast downstroke and fold on the recovery. The body bobs with the wingbeat, banking is smoothed, the tail lags behind steering, and the head stays readable while banking. Dash, recoil, Rush, feeding, level-up and hatching blend in and out as weights, never resetting the wingbeat.
- **Reduced motion** (Home setting; follows the OS on a fresh save) removes camera shake, bright flashes and interface animation, and halves particle counts.

## Balance (measured, not guaranteed)

`npm run balance` plays 40 seeded runs per scripted pilot:

| Pilot | Gold | Emberfruit | Rush |
| --- | --- | --- | --- |
| Reasonable, Sky Isles (0.25 s reactions, imperfect aim, dashes at ~70% of containers) | ~92 | ~34 | 2 |
| Reasonable, Sunset Canyon | ~85 | ~31 | ~2.8 (≈11 rings) |
| Never dashes | ~74 | ~24 | 2 |
| Careless (ignores the course) | ~31 | ~10 | ~1 |

From a fresh save, a greedy reasonable pilot that never feeds its dragons hatches Tide by run 2–3, unlocks the canyon at run 4, and hatches Grove at runs 5–8 and Gale by run 8. Feeding stretches that out. These are bot figures; tune `src/config.ts` and `src/sim/course.ts` after real playtests.

## Known limitations

- Desktop-first. Touch input and phone layouts aren't supported.
- There's no music, only short generated effects. The optional web font loads from Google Fonts; offline, the game falls back to system fonts.
- Refreshing during a run abandons that run's haul by design.
- Balance comes from scripted pilots, not human playtests.
