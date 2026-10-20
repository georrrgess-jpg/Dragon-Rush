# Changelog

## Update 5 — Rise of Legends

### New mode: Aether Ascent
- An **endless flight** that opens after 2 full Rush flights (a toast announces it). Same controls as Rush, **3 wards** with a moment of protection after each hit, and six hazard families introduced one at a time with a first-time banner: floating ruins, wind gates, crystal shutters, storm lanes, sky guardians (sentinels and announced hawks) and breaking bridges/debris.
- Built from **29 hand-made chunks**, seeded and checked by a reachability test so every sequence has a route that can be flown **without dashing**; speed is capped, calm stretches follow hard sections, and optional challenge routes and caches add score.
- **Shrines** pause for a choice of three capped upgrades (keys 1–3) and bank what you have earned. Every species' ability does something here (short ward, rubble clearing, slowing the sky).
- **Assist** (offered on the first-run intro and in Play): one extra ward, a gentler speed-up, 15 % slower hazards with earlier warnings, one ward restored per shrine. Assisted runs keep separate records.
- Rewards use the same per-minute caps as other modes; runs under 100 m don't count; settlement happens once; the run pauses on focus loss. The end screen shows distance, best, what ended the run, rewards, region and a tip, with **Retry**.

### Main menu
- A new **panoramic home scene** with your dragon on a region-themed overlook. The big gold **Play** button sits next to the chosen mode's objective and duration; other modes are one click away and the menu remembers the last one (Dragon Rush the first time).
- Your dragon's name, rarity badge and level sit on a nameplate with **Change dragon**; clicking the dragon makes it react in its own personality.
- Resource strip with labels on hover and keyboard focus, grouped navigation, one dismissible **next goal**, and notification dots that clear when you visit (the Hatchery dot only for keys you haven't seen yet).
- Distinct hover, focus, pressed, selected, disabled and loading states throughout; the home scene is cached and holds 55–60 fps at 1920×1080 in our headless measurement.

### Rarity language
- Common, Rare, Epic and Legendary each have their own symbol (one gem, two gems, three gems, a crown ♛), materials and anatomy: charms for Common, bands/crests/patterned scales for Rare, layered frills, armour and controlled glowing seams for Epic, and a signature motif per Legendary (Solpyre's solar fans, Leviara's regal fins and pearls, Glacielle's crystal crown, Astralux's constellations).
- Used consistently on the home hero, collection cards (frames, per-Legendary crests), Observatory (aura), eggs (rarity trim baked into each shell), the reel, the hatch, results and the Ascent end screen. Rarity is never shown by colour alone and stays visible with reduced motion and low effects. Radiant markings no longer borrow Legendary gold. Hitboxes and balance are unchanged.

### Dragons
- Polish pass on all 24 species, every stage, side and top view: faces (lids, catchlights, brows), horns seated on the head, distinct claw vs talon feet, wing joints per wing type, markings that follow the body, elder ornaments visible from above, serpents that fit cards, results and perches.
- **Personalities**: per-species idle gestures, a click reaction, an arrival pose (long for Epic and Legendary), a level-up reaction and a recovery after hits, layered under hit > dash > ability so nothing jumps. Reduced motion keeps only facial changes.

### Dragon Rush
- More responsive steering (mouse or W/S at any refresh rate), coin and fruit **trails** with a dotted guide and a score bonus for completing them, a fair pickup radius, a **TREASURE** edge route beside a safe route, a checkered finish, forgiving hits that explain themselves and never take resources, a bounded Rush charge that can't recharge itself during Rush, a glanceable HUD and a replayable tutorial.
- Results show what was awarded, score, best chain, trails and treasure, a tip, goal progress, **Retry** (R) and **Change mode**.

### Dragon Arena
- Contextual first-time tutorial, one role introduced at a time with an edge arrow, a new **Thorn Sower** enemy, red wind-ups with "!" and a short dazed recovery for every attack, fair spawns away from the player, sticky targeting with a reticle, pickup attraction, a three-phase boss with announced transitions and a safe roar, and upgrade breaks that pause everything with one Attack, one Defense and one Utility choice showing exact before → after numbers. About four minutes; endless continuation kept. Arena Emberfruit raised to ≈ 33–35 per minute (still within the shared cap); species effects tuned so no dragon is far ahead.

### Hatchery
- The reel accelerates from what's on screen and stops exactly under the marker (the marker card is verified against the saved award), then the egg travels to a pedestal and hatches with presentation scaled by rarity: Common hops and dust, Rare element beams, Epic light shaft and shockwaves, and a **unique environment for each Legendary**, plus a first-Legendary moment. About 4.8–5.5 s (6.7 s first Legendary), about 2.2–3.0 s with Quick reveal, 1 s with reduced motion; **Reveal now** skips.
- **Open 5** has its own stage, reveals the rarest last with a lasting Legendary presentation, lets you inspect each and ends with a summary (new, duplicates, Essence, best pull).
- Five eggs redesigned (Ember, Cinder, Spark, Voltwing, Thundercrest). Disabled actions explain why. Odds (55/28/14/3), pity, duplicate Essence and recovery are unchanged and covered by new tests.

### Collection, records and settings
- ★ Favorites filter, rarity filter chips with symbols and tooltips, search and focus remembered for the session.
- Journal **personal bests** per mode (Rush best haul, Ascent best and assisted best, Arena, Trials golds) and an Ascent guide.
- Five permanent milestones paid in existing currencies (first Ascent run, 1,000 m, 3,000 m, all four rarities, two Legendaries).
- Settings: **screen shake** toggle, auto-ability labelled as an assist, a controls reference, **Show the short tutorials again**, frame-time readout once enough samples exist. Escape behaves consistently (dialog → overlay → settings → back); confirmation dialogs focus Cancel; toasts sit at the bottom and never stack more than two.
- New sound cues for Rush, Arena, Ascent and the hatch, built on the existing Web Audio voices.

### Performance
- Home scene cached (no per-frame canvas creation), region and Arena floor caches capped, Low effects renders gameplay at 1× resolution, resize hooks on every canvas screen. See `docs/RISE_OF_LEGENDS.md` for measurements and their environment.

### Saves
- Still **save v3**. New optional fields default when absent: `prefs.lastMode`, `prefs.dismissedGoal`, `prefs.tutorials`, `prefs.keysSeen`, `settings.screenShake` and an `ascent` record. Nothing existing is changed or reset.

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
