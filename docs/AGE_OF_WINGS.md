# Update 3 — Age of Wings: plan, audit and progress checklist

This file is the durable record for Update 3. Tick items only once they are implemented
**and** verified (tests or an actual browser check). "Implemented" without verification is
marked `[~]`.

## 1. Audit of the starting point (Phase 2 build, commit 92872f9)

**What exists**
- One mode: Dragon Rush (60 s side-scroller, mouse height steering, left-click/Space dash,
  Esc pause). Keyboard W/S/arrows steer. F toggles fullscreen.
- Four dragons: Ember (start), Tide (200 g + 80 f), Grove (10 lifetime pods + 250 g + 60 f),
  Gale (20 lifetime dash breaks + 350 g). Traits: dash reach, pickup reach, pod bonus, dash cooldown.
- Levels 1–3 via feeding (30 / 60 Emberfruit) → +5 % / +10 % banked haul.
- Two environments: Sky Isles, Sunset Canyon (wind rings; unlocks after 4 full flights).
- 12 objectives (3 active), cosmetic lantern garland, best-haul stats, lifetime counters.
- Screens: Home (perch, Play, env picker, collection strip, detail, objectives), Flight HUD,
  pause overlay, Results, hatch reveal. Single `#stage` scaled 1280×720.
- Save v2 in `localStorage['emberwild.dragonRush.save']`, backups `…backup.v1/.corrupt`.
- Build: Vite + TypeScript, `npm run build:single` inlines into `emberwild-dragon-rush.html`.

**Loop and collisions**
- `App.frame` (rAF) clamps dt ≤ 0.1 s → `FlightScreen.update` → `FlightSim.advance` with
  substeps ≤ 1/120 s. Circle–circle collisions; containers and rings use swept segments.
- Rendering: one shared `FlightRenderer`, background tiles pre-rendered per environment,
  dragon drawn as vector paths every frame (gradients created per frame).

**Save schema / history**
- v2 lifetime counters: outings, flights, gold/fruit collected, chests, pods, dashBreaks,
  rushes, rings, canyonFlights, flightsBy[dragon]. Not tracked: play time, abilities, per-dragon
  best haul, active seconds. These start at 0 in v3 (no fabrication from wallets).

**Bugs / risks found**
- Dragon cards re-render on select/feed, losing keyboard focus and scroll position (no scroll
  yet, but a 24-dragon grid will need it). → Rebuild Dragons screen with stable focus.
- Audio has no voice cap: dense moments can stack many oscillators. → Voice limiter.
- Dragon art creates gradients every frame; fine for 1 dragon, too slow for Arena crowds.
  → Cache sprites for enemies; keep the player dragon vector.
- Loading a save from a *newer* version is sanitized and then re-written (could drop data).
  → v3 refuses to overwrite newer saves; plays in a temporary session instead.
- No export/import, no volume levels, no low-effects mode, no music.
- Level system (1–3) and objectives are incompatible with the brief (1–30, contracts).

## 2. Architecture decisions

- Keep Vite + TypeScript modules; keep the single-file playable build.
- **Content as data** under `src/content/` (species, abilities, progression, regions, trials,
  mastery, contracts, cosmetics, hatchery tables). Validation tests cover every definition.
- **Shared ability primitives** (pulse, sweep, projectile, shield, magnet, dash, field) with
  per-species parameters and an explicit per-mode mapping.
- **Rigs**: six body families (classic, wyvern, serpent, drake, cloud, crystal) with species
  heads/horns/wings/tails/markings; four evolution stages; a separate top-down adapter.
- **Modes**: Rush and Trials share `FlightSim` (Trials = fixed seeded course, normalized stats);
  Arena is a separate pure `ArenaSim`.
- **Transactions**: every settlement/opening/purchase is a pure function returning a new save
  plus a transaction record; written in one `setItem`.

## 3. Interruption policy per mode
- Rush: reload/close mid-run abandons the unbanked haul (unchanged). Early return banks.
- Trials: reload abandons the attempt; no medal, no reward. Finishing settles once.
- Arena: reload abandons only *unbanked* progress. Victory settles a checkpoint; endless
  continuation settles the delta under the same run ID. Defeat or quitting banks earned
  resources/XP (never a victory that did not happen).
- Hatchery: the award is committed before the reel animates; reload shows the committed result.

## 4. Progress checklist

### Stage A — Baseline and reliability
- [ ] Plan, audit and checklist (this file)
- [ ] Content model with stable IDs (species, elements, rarities, regions, modes)
- [ ] Save v3 schema, idempotent v1/v2→v3 migration with backup, newer-save protection
- [ ] Export/import with validation and recoverable errors
- [ ] Settings: master/music/effects volume, mute, reduced motion, low effects, auto-ability
- [ ] Audio voice limiter

### Stage B — Art and UI foundation
- [ ] Family rig system + polished classic family with 4 evolution stages
- [ ] Development gallery (`?gallery`): every species × stage × state, side + top-down
- [ ] Navigation shell: Home / Play / Dragons / Hatchery / Journal + global Settings
- [ ] Improved Sunleaf Isles backdrop (layers, light shafts, waterfalls, distant dragons)

### Stage C — Progression and representative dragons
- [ ] XP/levels 1–30, feeding exchange, evolution stages, migration of old levels
- [ ] Talents (L10, L20 choices; L5/L15 upgrades; L30 elder title), reversible outside runs
- [ ] Actives on E with primitives; passives; per-mode mapping; auto-activate option
- [ ] Mastery (3 per species) and per-dragon records, names, favorites

### Stage D — New modes
- [ ] Sky Trials: 12 courses, checkpoints, medals, normalized stats, records, practice
- [ ] Dragon Arena: top-down, 5 enemy archetypes, upgrades, elite, boss, endless, settlement
- [ ] Results for every mode

### Stage E — Aether Hatchery
- [ ] Reward engine (crypto RNG, odds, pity 10/40, essence, catalog) + exhaustive tests
- [ ] Key progress meter (≈3 min active play), bonus keys, history, recovery
- [ ] Reel + hatch animation, skip, reduced-motion path, Open 5

### Stage F — Full content
- [ ] 24 species complete (data, art, evolution, abilities, mastery, personality)
- [ ] Five themes (side-view + Arena floors)
- [ ] 12 Trials with tested medals; Rush pattern modules
- [ ] Cosmetics: markings, trails, perches, banners, titles; guaranteed milestone unlocks

### Stage G — Integration and balance
- [ ] Contracts (3 active, free replacement), Journal records
- [ ] Economy comparison across modes (beginner/intermediate bots)
- [ ] Fresh save and upgraded old save journeys

### Stage H — Critic-led release pass
- [ ] Gate reviews (gameplay, UI/UX, art, QA) with findings and retests recorded below
- [ ] Packaged build, guide, changelog, developer note

## 5. Review log
(Findings are appended here with severity, fix and retest result.)
