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

`[x]` implemented and verified (tests and/or an actual browser run). `[~]` implemented, only partly verified.

### Stage A — Baseline and reliability
- [x] Plan, audit and checklist (this file)
- [x] Content model with stable IDs (species, elements, rarities, regions, modes)
- [x] Save v3 schema, idempotent v1/v2→v3 migration with backup, newer-save protection (unit tests + QA critic in browser)
- [x] Export/import with validation and recoverable errors (unit tests + browser)
- [x] Settings: master/music/effects volume, mute, reduced motion, low effects, auto-ability (browser)
- [~] Audio voice limiter, music and element motifs (implemented; verified only that no errors occur — no listening test in this environment)

### Stage B — Art and UI foundation
- [x] Family rig (6 families) with 4 evolution stages, side view and top-down (gallery screenshots, art critic)
- [x] Development gallery (`?gallery`) and background preview (`?backgrounds`)
- [x] Navigation shell: Home / Play / Dragons / Hatchery / Journal + global Settings (browser, UI critic)
- [x] Five region backdrops incl. improved Sunleaf Isles (screenshots, art critic)

### Stage C — Progression and representative dragons
- [x] XP/levels 1–30, feeding exchange, evolution stages, migration of old levels (unit tests)
- [x] Talents (L10, L20), reversible outside runs; L5/L15 ability upgrades; L30 elder title (unit tests + browser)
- [x] Actives on E for all 24 species with per-mode effects; auto-activate option (unit tests fire every active in Arena; bot measurements in Rush)
- [x] Mastery (3 per species), per-dragon records, names, favorites, markings, titles (unit tests + browser)

### Stage D — New modes
- [x] Sky Trials: 12 courses, checkpoints, medals calibrated with 4 scripted pilots, normalized stats, records, practice (tests + browser)
- [x] Dragon Arena: 5 archetypes, upgrades, elite, boss, endless, checkpoint settlement (tests with 3 pilots + browser)
- [x] Results for every mode (browser)

### Stage E — Aether Hatchery
- [x] Reward engine: crypto RNG, odds, pity 10/40, Essence, catalog, exhaustive boundary tests (unit tests)
- [x] Key progress (~3 min qualified play), one-time bonus keys, history, interrupted-reveal recovery (tests + QA critic)
- [x] Reel + hatch animation, Skip, reduced-motion fade, Open 5 (browser)

### Stage F — Full content
- [x] 24 species with data, art, evolution, abilities, mastery, personality lines
- [x] Five themes (side view + Arena floors)
- [x] 12 Trials with tested medals; Rush pattern modules incl. region features
- [x] Cosmetics: markings, trails, perches, banners, titles; guaranteed milestone unlocks (Bramble, Zephyr, Rime, Snowcap, Spark)

### Stage G — Integration and balance
- [x] Contracts (3 active, free replacement), Journal records
- [x] Economy comparison across modes with bots (see DEVELOPER_NOTES.md)
- [x] Fresh save and upgraded v1/v2 save journeys (QA critic, browser)

### Stage H — Critic-led release pass
- [x] Gate reviews (gameplay, UI/UX, art, QA) with findings, fixes and retests (below)
- [x] Packaged single-file build, player guide, changelog, developer notes

## 5. Review log

Four independent critic agents reviewed the playable build (commit c71dacd) in a real browser and with the test harness. Severity: B = blocker, M = major, m = minor, p = polish. "Retest" says how the fix was verified.

### Gameplay critic
| # | Sev | Finding | Fix | Retest |
|---|---|---|---|---|
| 1 | M | Ability HUD stuck at "99%", never READY | Re-render key distinguishes ≥100% | Code path fixed in both screens (logic reviewed) |
| 2 | M | Wave-4 elite survives into the boss wave in ~80% of runs | Elite retreats at the wave break, paying 15 gold + 8 Emberfruit | Unit test "elite … retreats" |
| 3 | M | Ember's Arena trail stacked ~12 patches (845 dmg in 4 s) | Trail burns once per enemy per step | Unit test: < 160 damage over the trail |
| 4 | M | Idle play counted as qualified (AFK XP and keys) | Only player input (steering, movement, dash, ability) keeps time qualified | Unit tests: idle Rush and idle Arena stop at 20 s |
| 5 | M | Level 30 in ~40 min with feeding | Quadratic XP term ×3 from level 15 | Unit test of the curve; level 30 now ≈30 000 XP (≈80 min feeding everything, ≈150 min without) |
| 6 | M | ~11 actives barely changed a Rush haul | Shields pay +2 gold and refund 40% per block and widen reach; ghost/soften burst rocks (+1 gold); bigger Cinder/Tempest/Frostfang/Gale/Snowcap effects; full overcharge refunds 35% | Bot measurement: casual pilots +1 to +12% haul with abilities; defensive actives cut rock hits (Rime 0.30→0.05, Cloudtail 0.35→0.10 per run). Reasonable pilots gain only +0–5% because they already collect most of each course — see limitations |
| 7 | M | Arena spread: Astralux 40/40 wins, Zephyr weak | Astralux chain 40→28, Zephyr strike 18→45 with two cooldown-free dashes, Rootwarden loses its −10% damage | Arena test suite (starter win rates 12/12 skilled, 11/12 reasonable, 6/12 casual) |
| 8 | m | Zephyr's wider rings applied in Trials | Ring size normalized in Trials | Unit test |
| 9 | m | Traversability test ran one region five times | Test passes the region; asserts ≤0.07 hits per run per region | Test passes for all five regions |
| 10 | m | Ability texts didn't match code (Solpyre 306 px, Astralux 9, Leviara direction) | Texts corrected | Reviewed against code |
| 11 | p | Saving to 200% overcharge barely paid | Firing at 200% refunds 35% of a charge | Code review |
| 12 | p | Boss arrival hint covered the boss bar; no Dart Wisp intro | Boss bar moved above the bottom HUD; wisp intro hint | CSS/code review (not re-screenshotted) |

### UI/UX critic
| # | Sev | Finding | Fix | Retest |
|---|---|---|---|---|
| 1 | M | Settings didn't trap focus: a key could be spent behind the dialog | Everything behind dialogs is `inert`; focus returns to the gear | Browser: 20 Tabs stay inside; `#screen-root.inert === true` |
| 2 | M | Reel didn't lock unrelated controls (bought Grove mid-reel) | Lower panel and goal strip inert during the reel; buy guarded; leaving mid-reel reveals the saved result | Browser: buy click ignored; unrevealed count 0 after leaving |
| 3 | m | Pause overlay leaked focus; Space didn't press Resume | HUD inert while paused; Space passes through | Browser: Space resumes |
| 4 | m | Arena intro had no way back | Back button / Esc cancels without counting a session | Browser: `activeRun` null, `arenaRuns` 0 |
| 5 | m | Home "Recent" clipped | Shows 2 entries | Screenshot |
| 6 | m | Disabled ghost buttons looked enabled | `.btn.ghost:disabled` style | Screenshot |
| 7 | m | Hatchery odds partly below the fold | Shorter reel, compact table | Screenshot: all four tiers and the protection text visible |
| 8 | m | Toasts covered controls / carried across modes | Toasts sit in the top bar gap, never take clicks, cleared when a mode starts | Screenshot |
| 9 | m | Results: milestone rewards missing, raw region id, no Feed button | All three fixed | Browser |
| 10 | m | Captions < 10 px on small windows | 12–13 px minimum at stage size | CSS |
| 11 | p | Weak focus ring | Dark outline + gold halo | Screenshot |
| 12 | p | Toggles/filters lacked accessible names | `aria-label`s | Code |
| 13 | p | Inspector art covered names; grid row cut | Smaller inspector art, compact cards | Screenshot |
| 14 | p | Wallet spoiled duplicates before the reveal | Wallet display held until the reveal | Browser: wallet unchanged during reel |
| 15 | p | "fruit" vs "Emberfruit" | Fixed | — |

### Art critic
| # | Sev | Finding | Fix | Retest |
|---|---|---|---|---|
| 1 | M | Crystal family = classic rig; some legendaries read as recolors | Crystal rig: raised shoulders, segmented neck, higher head; Solpyre sunburst halo; Glacielle aurora ribbons and longer neck; Frostfang icicle wings + fangs; Tempest ragged storm wings | Gallery screenshots |
| 2 | M | Snowcap read as a cloud dragon | Grey-blue armored drake: club tail, snow-capped plates, stub wings | Gallery |
| 3 | M | Decorative stone in the flight band used the hazard look | Coast stacks/canyon ledges hazed, no moss or cracks; no green-on-grey anywhere in backdrops | In-game screenshots |
| 4 | M | Arena player/enemies blended into floors | Player ground ring; olive-brown canyon tufts; lighter isles grass | Preview + in-game |
| 5 | M | Glowing Stormspire floor runes broke the visual language | Dim engraved grooves | Preview |
| 6 | M | Folded wings collapsed into slats | Fold clamped to 0.72, spread ≥ 42%, smaller length loss | Gallery (upstroke still narrower on hatchlings) |
| 7 | m | Canyon lacked arches; Isles lacked timber | Two full sandstone arches per tile; huts and rope bridges on far isles | Preview + in-game |
| 8 | m | Dark dragons muddy on Stormspire | Light rim stroke for palettes with luminance < 0.16 | Gallery |
| 9 | m | Eggs set by element only | Per-species marking motif + rarity trim band (dashed/dotted/gold+star); S-curve air gusts | Gallery |
| 10 | m | Hatch had no payoff | Shell splits along the crack, flash ring, shards, squash-and-stretch pop | Browser |
| 11 | p | Same elder beard on all; feeding hearts off-mouth | Family-specific elder traits; hearts from the mouth | Gallery |

### QA critic
| # | Sev | Finding | Fix | Retest |
|---|---|---|---|---|
| 1 | M | Stored XSS through imported hatchery history `tx` | Escaped in the UI and validated (`^[\w#.-]{1,64}$`) on load | Unit test (markup entry dropped) |
| 2 | M | A second corrupt save was lost; recovery download only in that session | Every distinct backup kept under a unique key; Settings lists copies from storage | Unit test (both corrupt copies kept) |
| 3 | M | Two tabs overwrote each other (spent key could return) | `storage` event: the stale tab stops saving and shows a banner | Browser with two tabs: storage unchanged by the stale tab |
| 4 | m | Import reported success when storage was full | Backup and write results checked; import aborts with a message | Unit test for backup failure |
| 5 | m | Load notices pushed out by other toasts | Notice shown last | Code review |
| 6 | m | Read-only session announced unsaved rewards | Announcements muted in read-only sessions | Code |
| 7 | m | v3 save with string/missing version treated as v1 | `detectVersion` | Unit test |
| 8 | m | Wording "page closed" after leaving mid-reel | Fixed (and leaving now reveals immediately) | Browser |
| 9 | m | Feed ignored rapid clicks silently | Guard shortened to 120 ms; each accepted click charged once | Code |
