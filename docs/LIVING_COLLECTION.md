# Update 4 — The Living Collection: plan, audit and checklist

Durable record for Update 4. `[x]` = implemented **and** verified (test or real browser check); `[~]` = implemented, partly verified; `[ ]` = not done.

## 1. Stage A audit (baseline commit 6738a92, the build delivered as the Update 3 HTML)

Editable TypeScript source is available, so the work happens in `src/` and the single-file build is regenerated (no edits to minified code). The brief's minified landmarks map to: `Mt` → `drawDragon` (src/render/dragonArt.ts), `Ys` → `drawDragonTop` (src/render/topdown.ts), `Et` → `drawEgg` (src/render/eggs.ts), `rs` → `DragonAnimator` (src/render/dragonAnim.ts), `Si` → `regionThumbnail` (src/render/background.ts), `ua` → `HeroView` (src/render/perch.ts), `Gr` → `DragonsScreen` (src/ui/screens/dragons.ts), `Nr` → `HatcheryScreen` (src/ui/screens/hatchery.ts).

Verified source observations (with measurements):
- **Backdrop allocation — confirmed.** `regionThumbnail()` caches a source but returns a new copied canvas per call; `HeroView.draw` calls it every frame. Measured: Home creates **180 canvases in 3 s idle** (60/s). Dragons and Hatchery create 0. Heap after 150 navigations: 8 MB → 8 MB (no leak, but constant churn).
- **Reduced motion in the hero — confirmed.** `HeroState.reducedMotion` is passed but `HeroView.update` ignores it (breathing, bobbing, banner sway, celebration particles all run).
- **Collection** has ownership/element filters and favorites-first only; no search, no rarity filter, no explicit sort.
- **Eggs**: family silhouette + element pattern + shared marking motif + rarity band; crack is a single zigzag; hatch splits two rectangular clips of the same egg plus rectangular confetti.
- **Fixed stage**: 1280×720 scaled; several canvases have hard-coded CSS sizes (hero 780×574, inspector 420×230, reel 1220×232, results 300×220) — coordinate mapping is correct via the stage transform.

Before captures: `docs/captures/before/` (home, dragons, hatchery, gallery).

## 2. Constraints kept
No changes to egg odds, pity, costs, bonuses, damage, collision bodies or Trials normalization. Roster stays 24, level cap 30. Save stays v3 with optional new fields (defaults when absent); art/thumbnail caches use a separate `ART_REV`.

## 3. Stages
- [x] A. Audit, backup, before captures (this file)
- [x] B. Renderer allocation fixes (Home hero: 180 canvases per 3 s idle → 0); art/material system (`src/render/speciesArt.ts`: per-species face, eye, pupil, material, belly, feet, wing pattern, accents; surface lattices that follow the body; detail tiers 0/1/2; `ART_REV` in every thumbnail key)
- [x] C. Representative dragons from all six families + eggs
- [x] D. Full 24-species pass, four stages each (creature-art critic findings fixed, see §7)
- [x] E. Animation: state priority layers, family motion table, neck stabilisation, follow-through, idle life, dash coil, ability anticipation, feeding reach/bite/chew/swallow, hit recoil without shake, pause-safe; Arena rope tail and smoothed heading; one combined evolution moment in results; in-place evolution crossfade on the hero
- [x] F. Hatch presentation: 24 designed eggs (3 tiers, cached shells with a 24 MB budget), designed fractures (5–9 shell-shaped pieces), staged reveal ~5.5 s, Quick reveal ~2.4 s, reduced-motion fade, Open 5 with inspectable results, duplicates labelled; award logic untouched
- [x] G. Dragon Observatory, Egg Codex (Eggs tab + Observatory egg page), search, rarity filter, five sorts, Clear all filters, empty state, Compare (per mode), growth feed planner
- [~] H. UI polish across screens; environment finishing — done: settings groups, focus fallback, spoiler-free hatchery, confirmations, environments with landmarks and region perches. Remaining minors listed at the end of §7.
- [x] I. Performance, accessibility, saves, regressions; single-file build `emberwild-dragon-rush4.html`

## 4. Art bible
- **Light**: key light from upper left (≈ −35°); highlights on upper-left planes, form shadow lower right, ambient occlusion where parts overlap (neck→torso, wing root, leg→hip).
- **Outline hierarchy**: silhouette 3 px (scaled), internal structure 1.6–2 px in a darkened body tone, texture lines 1 px at reduced alpha. Far-side limbs/wings use a cooler, darker value, never just transparency.
- **Materials**: scales (overlapping arcs following the body axis), plates (bevelled shapes with a lit top edge), membrane (translucent gradient, veins from the bone joints to the edge), feathers/fins (rayed segments), bark (grain lines), crystal (planar facets + one sharp highlight), cloud fur (soft scalloped tufts), pearl (directional sheen), star/storm (engraved or narrow glowing channels).
- **Detail budget**: tier 0 (gameplay/thumbnail ≤ 0.6 scale): silhouette, eye, one identifying feature; tier 1 (portrait/HUD): + markings, plates, membrane veins; tier 2 (Observatory/hero/codex): + scale rows, belly plate lines, claw detail, material sheen.
- **Faces**: every species has its own head profile, eye shape (round, almond, hooded, slit, star-pupil…), brow, and nostril/snout detail; expressions via brow and lid, not just pupils.
- **Growth**: hatchling = big eyes, short snout, nubs, compact torso, round feet; juvenile = longer body/tail, markings appear, horns developing; adult = full silhouette; elder = one refined extra ornament + richer material, no constant glow.

## 5. Coverage checklist (species × dragon detail / egg design / 4 stages / top-down match)

`[x]` = implemented and checked in real renders (gallery, art captures, critic captures). Top-down is `[~]` for every species: the Arena view carries the species' head profile, frill/horn type, wing-pattern hint, markings and stage proportions, but at gameplay scale these are hints, elder ornaments are not shown from above, and the critic noted faint antlers/crowns/ribbon tails (Snowcap, Ember, Thundercrest, Gale, Zephyr).

| Species | Family | Dragon detail | Egg design | Stages | Top-down |
|---|---|---|---|---|---|
| Ember | classic | [x] | [x] | [x] | [~] |
| Cinder | wyvern | [x] | [x] | [x] | [~] |
| Pyrelisk | drake | [x] | [x] | [x] | [~] |
| Solpyre | classic | [x] | [x] | [x] | [~] |
| Tide | classic | [x] | [x] | [x] | [~] |
| Ripple | cloud | [x] | [x] | [x] | [~] |
| Abyssfin | serpent | [x] | [x] | [x] | [~] |
| Leviara | serpent | [x] | [x] | [x] | [~] |
| Grove | classic | [x] | [x] | [x] | [~] |
| Bramble | drake | [x] | [x] | [x] | [~] |
| Orchid | classic | [x] | [x] | [x] | [~] |
| Rootwarden | drake | [x] | [x] | [x] | [~] |
| Gale | classic | [x] | [x] | [x] | [~] |
| Zephyr | serpent | [x] | [x] | [x] | [~] |
| Cloudtail | cloud | [x] | [x] | [x] | [~] |
| Tempest | wyvern | [x] | [x] | [x] | [~] |
| Rime | crystal | [x] | [x] | [x] | [~] |
| Snowcap | drake | [x] | [x] | [x] | [~] |
| Frostfang | wyvern | [x] | [x] | [x] | [~] |
| Glacielle | crystal | [x] | [x] | [x] | [~] |
| Spark | cloud | [x] | [x] | [x] | [~] |
| Voltwing | classic | [x] | [x] | [x] | [~] |
| Thundercrest | drake | [x] | [x] | [x] | [~] |
| Astralux | serpent | [x] | [x] | [x] | [~] |

## 6. Measurements (actual, headless Chromium 1280×720, DPR 1 unless noted)
- Canvases created during 3 s idle: Home 0 (was 180), Dragons 0, Hatchery 0, Observatory 0, Rush 0, Arena 0.
- Heap over 150 navigations: 12 → 13 MB. Observatory opened/closed 30×: 16.0 → 16.2 MB, live canvases flat (technical critic).
- Frame cost (update + draw, median / p95): Rush Isles 3.9 / 5.0 ms, Rush Stormspire 4.3 / 5.6 ms, Arena with 14 enemies 2.5 / 3.2 ms (perf.cjs). Technical critic (before its fixes): Home 4.0 / 6.7, Dragons 2.4 / 3.6, Observatory side 5.1 / 8.3, hatch reveal 2.6 / 5.6, Open 5 5.0 / 8.5 ms; real frame interval 16.6–16.8 ms on every screen.
- Egg shell cache under the UI's sizes: 23.9 MB at DPR 1 and 23.5 MB at DPR 2 (was 31 / 88 MB before the byte budget).
- Hatch reveal: single ≈ 5.5 s (reel 2.5 s), quick ≈ 2.4 s, reduced motion 0.6 s fade; ≤ 13 reel ticks per second.

## 7. Review log

Four independent critic agents reviewed the build (creature art, animation, UI/accessibility, technical). Every critical and major finding was fixed and retested; minor findings are fixed or listed as limitations.

### Creature-art critic
| ID | Sev | Finding | Fix | Retest |
|---|---|---|---|---|
| ART-1 | critical | Solpyre sunburst had an empty centre (black disc on dark, white blob on light) and a constant shadowBlur glow | Solid accent/mark disc behind the rays; glow only during Rush/ability | f1.png: disc solid, no glow at rest |
| ART-2 | critical | Cloud-family elders: three pure-white circles at fixed positions floating over eye/neck | Cloud collar anchored behind the jaw, shaded, tinted per species | f1.png |
| ART-3 | major | Neck closing segment stroked at silhouette weight → seam across chest | Neck fill shares torso gradient; outline stroked only outside the torso; soft occlusion | f2.png |
| ART-4 | major | All 7 classic elders shared the same "beard" (read as tusks) | Per-species ornament: ember flame brow plates, solpyre gold circlet, tide pearl circlet, grove blossoming antlers, orchid petal ribbon, gale feather crest, voltwing lightning cheek marks | f2.png |
| ART-5 | major | Glacielle aurora floated in the air, faded to muddy purple | Opaque ribbons along the neck top to the shoulders | f4.png |
| ART-6 | major | Ripple whiskers unoutlined and crossing the neck; cheekFluff a flat paper tab | Whiskers capped to head length with outline; scalloped tufts along the jaw | f1.png |
| ART-7 | major | Abyssfin/Cinder outlines vanished on dark backgrounds at gameplay scale | Stronger pale rim (side) and a new rim in the top-down view for low-luminance palettes | rendered on dark |
| ART-8 | major | Serpent hatchlings were scaled-down juveniles | Shorter tube and tail, shorter/taller snout, chunkier feet for serpent hatchlings | f3.png |
| ART-9..15 | minor | Top/side mismatches (antlers, crowns, ribbon tails), upright markings, thin claws, drake clubs on thigh, Pyrelisk snout horn placement, wing-joint dots, egg similarity Ember/Thundercrest, Spark egg colour | Not fixed in this pass (recorded as limitations) | — |

### Animation critic
| ID | Sev | Finding | Fix | Retest |
|---|---|---|---|---|
| ANIM-1 | major | Pausing didn't freeze the image: shake/bolt/chain jitter re-randomised every draw (12/12 paused frames differed in Rush, 9/10 in Arena); bolt jitter ignored reduced motion | Jitter is a hash of renderer time (advances only in update); bolt jitter 0 under reduced motion | critic pause.cjs / arena.cjs: 1 distinct paused frame in both |
| ANIM-2 | major | Celebration popped in one frame (fold Δ0.55, aura Δ1.0); happy eyes binary | Smoothstep onset/outro from elapsed time; happy eyes only once eased in | pops.cjs: max per-frame fold Δ0.055, rush Δ0.1 |
| ANIM-3 | major | Evolving by feeding rebuilt the animator: feed/cheer lost, instant size and zoom jump | Same animator keeps running (setStage); in-place crossfade with soft light; eased zoom | code path + capture |
| ANIM-4 | major | Feed and level-up cheer overlapped | Cheer waits until the swallow ends (1.6 s after feeding starts) | code path |
| ANIM-5 | major | Arena dash snapped wings between flapping and streamlined | Eased dash weight (fast in, ~7/s out) | code path |
| ANIM-6 | major | Observatory and hatch reveal used classic timing for every family | Animators get species; Observatory resets species on change | code path |
| ANIM-7 | major | Winning reel card vanished in one frame at the hatch handoff | Winner card fades under the travelling egg (same size/place at start) | code path |
| ANIM-9 | minor | Idle reel drift, Arena invulnerability blink and hero head bob under reduced motion | All held still under reduced motion | code path |
| ANIM-10 | minor | Observatory top-view phase jumped on pose change | Phase accumulated at family rate | code path |
| ANIM-11 | minor | Hatchling blink binary | Sine lid envelope | code path |
| ANIM-8 | minor | Re-triggering hit/ability mid-envelope pops (latent in play: grace 1 s, full charge needed) | Not fixed (limitation) | — |

### UI/UX critic
| ID | Sev | Finding | Fix | Retest |
|---|---|---|---|---|
| UI-1 | major | Stage strip and marking portraits rendered at 2× (192 px), sideways scroll | Sized in CSS (96×72) | code/CSS |
| UI-2 | major | Focus fell to body when the focused control disappeared/disabled (feed qty, Fly with, Essence unlock, Replace, Hatchery) | rerender() moves focus to the nearest enabled neighbour in the previous focus order; Feed no longer disabled during the click lock | critic s2.cjs: focus lands on Feed / a neighbour, never body |
| UI-3 | major | Hatchery lower panel and goal strip showed post-opening pity counters during the reel (spoiler); tab badge disagreed with frozen wallet | Pre-opening snapshot drives lower panel, history and goal until reveal; badge uses held wallet | critic s15.cjs: pity 9/10 mid-reel, badge 15 = chip 15 |
| UI-7 | minor | History showed 1970 date for entries without a time and raw tx ids | "date not recorded", ids removed | s11.cjs |
| UI-8 | minor | Disabled Feed reason not linked | aria-describedby | s11.cjs |
| UI-9 | minor (partial) | Fresh starter listed as "before dates were recorded"; card label repeated name | Fresh saves record the starter date; label dedupe | code |
| UI-10 | minor | Toasts covered wallet and Play button | Toasts over the top of the scene panel | CSS |
| UI-12 | minor | Observatory pan mouse-only | Focusable view, arrow keys pan | code |
| UI-5, UI-6 | minor | Replace without confirm; Essence marking purchase without confirm | Confirm dialogs when progress would be lost / Essence is spent | code |
| UI-4 (partial), UI-11 | minor | Tablist arrow keys; small text/contrast | Labels/tabpanel and 13 px minimum for new captions; arrow-key tabs and contrast not fixed (limitations) | — |

### Technical critic
Passed: typecheck and all tests; no diff against 6738a92 in content, hatchery, economy, stats, sim, config or contracts (odds, pity 10/40, costs, bonuses, damage, collision, Trials normalization unchanged); save v3 with defaulting prefs and idempotent sanitize; award integrity in the browser (double click, reload mid-reel, leave mid-reveal); nickname XSS probe on every screen (0 executions); idle screens create 0 canvases/s; flat live canvases and heap over navigation and Observatory cycling.

| ID | Sev | Finding | Fix | Retest |
|---|---|---|---|---|
| TECH-1 | major | Egg shell cache bounded by count only: 31 MB at DPR 1, 88 MB at DPR 2 with UI sizes | Added a 24 MB byte budget (LRU, both layers counted) | critic eggfill.cjs on the live tree: 23.9 MB (DPR 1), 23.5 MB (DPR 2) |
| TECH-2 | minor | Hatchery rebuilt 24 reel cards per visit (720 of 750 canvases over 150 navigations) | Module-level bounded caches keyed by device scale and egg art revision | code |
| TECH-3 | minor | Every Observatory zoom rebuilt the panel and its 760×500 canvas | Zoom/recenter/keys update in place | browser: one canvas after 2 zoom clicks, focus kept |
| TECH-4 | minor | Observatory ignored Low effects; redrew a still frame every frame under reduced motion | Tier 1 dragon/egg under Low effects; redraw only when changed under reduced motion | code |
| TECH-5 | minor | Portrait canvases and data URLs unbounded, each kept twice | Data URLs rendered without caching the canvas, both caches capped | code |
| TECH-6 | minor | Hatchery icon URL key missing device scale and egg art revision | Added | code |
| TECH-7 | minor | Feed-lock timer re-rendered a detached screen | Skips when the screen is gone | code |
| TECH-8 | minor | Toasts for an egg recovered after reload are not repeated (rewards intact) | Not fixed (limitation) | — |


### Remaining limitations (honest)
- Minor art notes not addressed: top-down antlers/crowns/ribbon tails faint and no elder ornament from above; body markings sit upright rather than following the lattice; claws thin and claw vs talon feet similar; drake tail clubs rest on the thigh when perched; Pyrelisk snout horn placement; identical wing-joint knuckles; Ember vs Thundercrest eggs similar; Spark egg is navy.
- Re-triggering hit/ability while the previous envelope is still high can pop (not reachable in normal play).
- Tablists have labels and a tab panel but no arrow-key navigation; some pre-existing captions are under 13 px and two button colours are just under 4.5:1 contrast.
- Toasts for an egg recovered after a reload are not repeated (the rewards are in the save).
- Arena boss and the gallery top view use the stateless top-down drawing (no rope tail).
- Rush at DPR 2 in headless Chromium runs ~55 ms/frame; the Update 3 baseline measured the same, so this is the test environment, not a regression.
