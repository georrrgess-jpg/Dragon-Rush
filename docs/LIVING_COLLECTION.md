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
- [ ] A. Audit, backup, before captures (this file)
- [ ] B. Renderer allocation fixes; art/material system (art bible below)
- [ ] C. Representative dragons from all six families + eggs
- [ ] D. Full 24-species pass, four stages each
- [ ] E. Animation blending, Arena views, feeding and evolution presentation
- [ ] F. Hatch presentation redesign (award logic untouched)
- [ ] G. Observatory, Egg Codex, search, sorts, comparison, growth panel
- [ ] H. UI polish across screens; environment finishing
- [ ] I. Performance, accessibility, saves, regressions; package

## 4. Art bible
- **Light**: key light from upper left (≈ −35°); highlights on upper-left planes, form shadow lower right, ambient occlusion where parts overlap (neck→torso, wing root, leg→hip).
- **Outline hierarchy**: silhouette 3 px (scaled), internal structure 1.6–2 px in a darkened body tone, texture lines 1 px at reduced alpha. Far-side limbs/wings use a cooler, darker value, never just transparency.
- **Materials**: scales (overlapping arcs following the body axis), plates (bevelled shapes with a lit top edge), membrane (translucent gradient, veins from the bone joints to the edge), feathers/fins (rayed segments), bark (grain lines), crystal (planar facets + one sharp highlight), cloud fur (soft scalloped tufts), pearl (directional sheen), star/storm (engraved or narrow glowing channels).
- **Detail budget**: tier 0 (gameplay/thumbnail ≤ 0.6 scale): silhouette, eye, one identifying feature; tier 1 (portrait/HUD): + markings, plates, membrane veins; tier 2 (Observatory/hero/codex): + scale rows, belly plate lines, claw detail, material sheen.
- **Faces**: every species has its own head profile, eye shape (round, almond, hooded, slit, star-pupil…), brow, and nostril/snout detail; expressions via brow and lid, not just pupils.
- **Growth**: hatchling = big eyes, short snout, nubs, compact torso, round feet; juvenile = longer body/tail, markings appear, horns developing; adult = full silhouette; elder = one refined extra ornament + richer material, no constant glow.

## 5. Coverage checklist (species × dragon detail / egg design / 4 stages / top-down match)

| Species | Family | Dragon detail | Egg design | Stages | Top-down |
|---|---|---|---|---|---|
| Ember | classic | [ ] | [ ] | [ ] | [ ] |
| Cinder | wyvern | [ ] | [ ] | [ ] | [ ] |
| Pyrelisk | drake | [ ] | [ ] | [ ] | [ ] |
| Solpyre | classic | [ ] | [ ] | [ ] | [ ] |
| Tide | classic | [ ] | [ ] | [ ] | [ ] |
| Ripple | cloud | [ ] | [ ] | [ ] | [ ] |
| Abyssfin | serpent | [ ] | [ ] | [ ] | [ ] |
| Leviara | serpent | [ ] | [ ] | [ ] | [ ] |
| Grove | classic | [ ] | [ ] | [ ] | [ ] |
| Bramble | drake | [ ] | [ ] | [ ] | [ ] |
| Orchid | classic | [ ] | [ ] | [ ] | [ ] |
| Rootwarden | drake | [ ] | [ ] | [ ] | [ ] |
| Gale | classic | [ ] | [ ] | [ ] | [ ] |
| Zephyr | serpent | [ ] | [ ] | [ ] | [ ] |
| Cloudtail | cloud | [ ] | [ ] | [ ] | [ ] |
| Tempest | wyvern | [ ] | [ ] | [ ] | [ ] |
| Rime | crystal | [ ] | [ ] | [ ] | [ ] |
| Snowcap | drake | [ ] | [ ] | [ ] | [ ] |
| Frostfang | wyvern | [ ] | [ ] | [ ] | [ ] |
| Glacielle | crystal | [ ] | [ ] | [ ] | [ ] |
| Spark | cloud | [ ] | [ ] | [ ] | [ ] |
| Voltwing | classic | [ ] | [ ] | [ ] | [ ] |
| Thundercrest | drake | [ ] | [ ] | [ ] | [ ] |
| Astralux | serpent | [ ] | [ ] | [ ] | [ ] |

## 6. Review log
(Critic findings with severity, fix and retest are appended here.)
