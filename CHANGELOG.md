# Changelog

## Update 3 — Age of Wings

### New modes
- **Sky Trials**: 12 designed courses in three groups of four (Sunleaf Isles; Canyon & Coast; Frost & Storm) with checkpoints, rings, a live medal-pace readout, per-course Bronze/Silver/Gold thresholds calibrated with scripted pilots, standardized stats (levels and talents never change a medal), records per course, per dragon and rules version, one-time first-medal rewards, modest length-based repeat rewards, immediate restart and a practice option that records nothing. Courses unlock by finishing the previous one.
- **Dragon Arena**: a top-down survival mode (WASD, automatic attacks, Space dash with invulnerability, E ability). Four waves introduce five enemy archetypes (Bramble Grub chaser, Dart Wisp flanker, Spore Turret shooter, Plated Ram armored charger, Treasure Imp runner), three-choice upgrade breaks that pause the game, a telegraphed elite and the Stormcrown Wyrm boss with three readable attacks (gapped orb ring, lane-telegraphed charge, ground circles). Health with brief invulnerability, rewards banked on defeat, optional endless continuation after victory under the same run with checkpoint settlement.

### Dragons
- **24 species** across six elements (6 Common, 8 Rare, 6 Epic, 4 Legendary) with their own passive and **active ability on E**, each with an explicit effect in Rush, Trials and Arena built from shared primitives. Legendaries have overcharge meters (store up to 200% for a stronger effect) as their trade-off. Abilities can't refill themselves from what they collect.
- Ember, Tide, Grove and Gale keep their traits and guaranteed unlock routes.
- **Family rig**: six body families (classic, wyvern, serpent, drake, cloud, crystal) with species heads, horns, frills, wings, tails, back ridges and markings, seen from the side and from above. **Four evolution stages** (hatchling, juvenile, adult, elder) change proportions, horn growth, ridge count, wing structure, marking strength and animation character; collision bodies never change.
- **Levels 1–30** with one XP system (≈200 XP per active minute, feeding 20 Emberfruit = 100 XP), milestones at 5/10/15/20/30, reversible talents at 10 and 20, capped bonuses. Old levels 2 and 3 map to 6 and 11, keeping their +5% / +10% haul bonus.
- **Mastery** (3 per species, cosmetic rewards and a key), names, favorites, markings (Natural, Dusk, Radiant), titles and per-dragon records in a new inspector.

### Aether Hatchery
- Earned eggs only (no purchases): about one Aether Key per 3 minutes of active play plus labelled one-time rewards. Every egg awards one dragon; duplicates become Essence. Odds 55/28/14/3 with equal species chances within a tier, bad-luck protection (10th egg without Epic+ → Epic/Legendary 14:3; 40th without Legendary → Legendary), next-egg odds and counters always shown.
- The award is drawn with the browser's crypto RNG and saved in one transaction before the horizontal egg reel plays; Skip, reduced-motion fade, Open 5 (sequential draws), history, an Essence catalog for direct unlocks, and recovery of an interrupted reveal without recharging.

### World
- Five regions with layered backdrops — Sunleaf Isles, Sunset Canyon, Prism Coast (hanging pods), Frostglass Reach (chest corridors), Stormspire (telegraphed lightning) — and five top-down Arena floors. Region unlocks by full flights.
- Rush: 120-second Expeditions after 10 flights, waterfall set pieces, new pattern modules, consistent visual language.

### Interface
- New shell: Home / Play / Dragons / Hatchery / Journal and a global Settings panel. A next goal on every main screen. Results for every mode with Play Again.
- Journal: contracts (3 active, one free replacement), milestones, records, cosmetics (trails, perches, banners) and a guide.
- Settings: master/music/effects volume, mute, reduced motion, low effects, auto-activate ability, collision outlines, frame-time readout, save export/import, recovery download.

### Audio
- Music and effects buses, a voice limiter, element motifs for abilities and hatching, and light procedural music for menus, flight, Arena and boss.

### Saves
- Save v3 with an idempotent v1/v2 migration (one-time backup), field-by-field defaults, protection for saves from newer versions (never overwritten), recovery of unreadable saves, validated export/import with a backup before replacing, and single-write transactions for settlements, openings and purchases.

### Development
- Development pages `?gallery` and `?backgrounds`; tests for every system including bot-calibrated Trials medals and Arena difficulty; single-file build now bundles everything into one script.

## Phase 2
Four dragons with traits, animation rig, Sunset Canyon with wind rings, objectives, save v2.

## Phase 1
Playable prototype: 60-second flights, dash, Dragon Rush, feeding, hatching.
