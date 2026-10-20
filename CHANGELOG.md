# Changelog

## Update 4 — The Living Collection

### Dragons
- **Every species redrawn in detail**: its own head proportions, eye shape and pupil (round, almond, hooded, narrow, gentle, bright; slit, star, glowing), face features (crests, brows, cheek fins or fluff, jaw plates, barbel lure, snout horn), surface material that follows the body (overlapping scales, plates, basalt, bark, leaf scales, crystal facets, fur, pearl, soot), belly plates or scutes, species feet (claws, talons, paws, webbed, roots, broad pads) and a membrane pattern on the wings. Consistent upper-left light, outline hierarchy and a pale rim for very dark dragons.
- **Evolution stages read clearly**: hatchlings have big eyes, short snouts, round feet and soft skin (serpent hatchlings too); elders have one refined ornament per species or family and no constant glow.
- **Detail tiers**: gameplay keeps the silhouette clean; cards, the hero and the Observatory show more. Low effects draws gameplay dragons at the simplest tier.
- **Animation pass**: hit > dash > ability > flight blending, family wing rhythms (wyvern slow, cloud flutter, serpent undulation…), a steadier head, tail and frill follow-through, idle breathing, blinks, glances and weight shifts, a dash coil, ability wind-up and release, feeding that reaches the fruit, bites, chews and swallows, and a gentle hit recoil. Pausing freezes everything; reduced motion holds calm poses.
- **Arena view** matches each species (head, frills, horns, wing pattern, markings, stage proportions), turns smoothly and trails its tail.
- **Evolution moments**: one combined moment on the results screen (even when several stages are crossed) and a soft in-place transformation when feeding causes an evolution.

### Eggs and hatching
- **24 designed eggs** with their own shape, material, crown or base, at icon, card and codex detail; cracks follow each egg's designed seams.
- **New reveal**: the reel decelerates smoothly and stops exactly under the marker, then the egg settles on an element pedestal, wobbles, fractures into shell-shaped pieces and the hatchling emerges — about 5.5 s, or about 2.4 s with **Quick reveal**, or a short fade with reduced motion. Open 5 cracks five eggs and lets you inspect each. Duplicates show your dragon and its level. The award is still decided and saved before any animation, and nothing on screen gives it away early.

### Collection
- **Dragon Observatory**: a large viewer with side and Arena views, idle/fly/dash/ability, evolution-stage and marking previews (clearly marked, nothing is unlocked), zoom, pan (mouse or keyboard), recenter and screenshot export.
- **Egg Codex**: an Eggs tab and an egg page in the Observatory with how to obtain, discovery status from your saved records (no invented dates for older saves), the exact chance for your next egg and the related elemental eggs.
- **Search** by name or nickname, rarity filter, sorts (favorites, name, level, rarity, recently obtained), Clear all filters and an empty state.
- **Compare** two owned dragons for Rush, Sky Trials or Arena, using only game data.
- **Growth panel**: choose portions, see the exact Emberfruit cost, the levels it would give and the next evolution; disabled reasons are explained and a double click can't repeat a large spend.

### World and interface
- Five regions refinished with a shared upper-left light, one landmark each, and a region-themed home perch where the dragon stands on the ledge with a steady contact shadow. The home scene is cached (no more per-frame canvas creation).
- Settings grouped into Audio, Accessibility and Performance with measured frame time and memory. Focus never falls off the page when a button disappears; dialogs trap focus and restore it; confirmations before losing contract progress or spending Essence.
- Development gallery (`?gallery`): every stage from the side and above, eggs at three tiers, pose/detail/background switches, frozen time, collision and attachment-point overlays.

### Saves
- Still save v3. New optional view preferences (collection sort, Observatory pose, Quick reveal) default when absent; new saves record when the starter joined. Odds, pity, costs, bonuses, damage, collision and Trials rules are unchanged.

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

### Release pass (critic reviews)
- Gameplay: ability meter shows READY reliably; the wave-4 elite retreats before the boss; Ember's Arena trail no longer stacks; idle play no longer counts toward XP/keys; adult levels slower; defensive abilities pay on a block and burst rocks; Arena legendary/Zephyr/Rootwarden rebalanced; Trials ignore ring-size passives.
- Interface: dialogs trap focus, the egg reel locks unrelated controls and hides the wallet change until the reveal, Arena intro has Back, results list rewards and offer Feed, stronger focus ring, larger captions, accessible names.
- Art: distinct crystal rig and legendary features, Snowcap redesigned as a drake, better wing folds, rim light for dark dragons, family-specific elders, per-species eggs with rarity trim, a proper hatch, backgrounds that never use the hazard look for scenery.
- Saves: imported data can't inject markup, every unreadable save is kept, a second tab stops saving instead of overwriting, failed imports change nothing.

### Development
- Development pages `?gallery` and `?backgrounds`; tests for every system including bot-calibrated Trials medals and Arena difficulty; single-file build now bundles everything into one script.

## Phase 2
Four dragons with traits, animation rig, Sunset Canyon with wind rings, objectives, save v2.

## Phase 1
Playable prototype: 60-second flights, dash, Dragon Rush, feeding, hatching.
