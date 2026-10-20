# Developer notes — Update 3 (Age of Wings)

## Architecture in one page

- **Content is data** (`src/content/`). Species, abilities, levels, talents, regions, milestones, cosmetics, hatchery tables, mastery and Trials courses are plain objects with stable ids. Adding a species means adding a `SpeciesDef` (palette, family + parts, passive, active with explicit Rush/Trials/Arena effects, acquisition) — the rig, egg, inspector, catalog and hatchery pick it up.
- **Pure simulations** (`src/sim/`): `FlightSim` (Rush and Trials) and `ArenaSim` have no DOM, take input and real time, advance in bounded substeps (≤ 1/120 s, frame dt clamped to 0.1 s) and emit events. Renderers and screens only read state and events. All tests drive the sims headlessly.
- **Effective stats** come from `stats.ts` (`flightStats(loadout, mode)`, `arenaStats`): species passive × level milestones × talents. Trials pass `mode: 'trials'`, which forces level 1, no talents and standard ring size.
- **Transactions** (`economy.ts`, `hatchery.ts`, `contracts.ts`): every action is a pure function from a save to a new save (+ a result record). The app persists the result with one `setItem` (`App.commit`). Settlement is guarded by the run marker and a settled-id list; Arena checkpoints store cumulative banked totals so a continuation pays only the difference.
- **Hatchery**: `openEggs` validates keys and pools, draws with `crypto.getRandomValues`, applies pity, converts duplicates, writes the history record (`revealed: false`) and returns the new save; only then does the UI animate. `unrevealed()` recovers interrupted reveals.
- **Rig** (`render/dragonArt.ts`): family rigs build torso/legs/anchors; species parts are drawn from `Look`; `STAGE_RIG` changes proportions per evolution stage. `render/topdown.ts` is the Arena adapter with the same palette/parts. Collision is never derived from art.
- **UI**: DOM screens over a fixed 1280×720 stage scaled to the window. `ui/dom.ts#rerender` preserves focus (`data-fk`) and scroll (`data-scroll`) across re-renders. Dialogs make the app behind them `inert`.

## Tuning numbers and how they were measured

All balance numbers below come from scripted pilots (`tests/bots.ts`, `tests/arenaBot.ts`), not from human play.

| Mode (starter, level 1) | Gold / active min | Emberfruit / active min | Notes |
|---|---|---|---|
| Rush, reasonable pilot | ≈ 89 | ≈ 40 | 60-s flights, Sunleaf Isles |
| Rush, careless pilot | ≈ 27 | ≈ 11 | still progresses |
| Arena, reasonable pilot | ≈ 80 | ≈ 27 | plus 60 gold / 20 fruit per victory (wins 11/12) |
| Arena, casual pilot | ≈ 66 | ≈ 21 | wins 6/12; rewards banked on defeat |
| Sky Trials repeat | ≈ 30 + course coins | — | first medals pay 40 gold / 25 Essence / 1 key once per course |

- XP: 200 per qualified minute in every mode; feeding 20 Emberfruit = 100 XP. Level 5 after ~2 flights; level 15 ≈ 14 min of play (faster with feeding); level 30 ≈ 30 000 XP total (≈ 150 min of play alone, ≈ 80 min feeding every Emberfruit into one dragon).
- Keys: one per 180 qualified seconds (≈ 1 per 3 minutes of active play), carried across modes. Qualified time requires player input in the last 20 s.
- Trials medals: per course, Gold is earned by the skilled pilot 16/16, Silver+ by the reasonable pilot ≥ 15/16, Gold by the casual pilot 0–8/16 depending on the course (table printed by `npx vitest run tests/trials.test.ts`).
- Ability value (Rush, 15–20 runs each, ability fired whenever full): casual pilots +1 to +12% haul (Spark highest, Cloudtail ≈ 0); defensive actives cut rock hits (Rime 0.30 → 0.05 per run). Reasonable pilots gain only 0–5% because they already collect most of each course.

## Test results (this environment)

- `npm test`: **122 tests pass** (7 files: flight, balance, economy/saves, hatchery, Trials, Arena, animation).
- `npm run typecheck` and `npm run build` pass; `npm run build:single` produces `emberwild-dragon-rush.html` (~430 KB), verified to load and start a flight from `file://` in headless Chromium.
- Browser checks were done with Playwright in headless Chromium at 1280×720 (plus 1024×600, 1366×768 and 1920×1080 by the UI critic). Frame cost in headless software rendering: Rush ≈ 3.4 ms median / 6 ms p95, Arena ≈ 2.3 / 4 ms with 15+ enemies; background draw 1–1.8 ms.
- Four critic agents (gameplay, UI/UX, art, QA) reviewed the build; findings, fixes and retests are in `docs/AGE_OF_WINGS.md` §5.

## Known limitations (honest list)

- **No human playtesting.** Difficulty, medal thresholds, Arena win rates and economy are calibrated with bots. Bots steer perfectly toward visible targets; humans will find early Trials harder and may find Rush easier to master than the careless bot suggests.
- **Audio was not listened to.** Music loops, element motifs and the voice limiter run without errors, but their sound quality was not evaluated in this environment.
- **Browsers**: only Chromium (headless) was exercised. Firefox/Safari should work (standard Canvas 2D and Web Audio; `inert` and `:has()` need recent versions) but were not tested. Desktop mouse/keyboard only; no touch controls.
- **Ability impact** in Rush is modest for skilled play (see above). Abilities matter more for safety and for less precise players.
- **Art**: six families cover 24 species; a few same-family species still share a silhouette closely (e.g. Cinder and Tempest differ mainly by wings, tail tip and palette). Hatchling wings remain narrow at the top of the upstroke. The tall canyon arch's faint legs cross the middle band as it scrolls by.
- **Toasts** can briefly overlap content when several stack up.
- Saves are local (`localStorage`) and not tamper-proof, by design. Two open tabs: the stale tab stops saving rather than merging.

## Interruption policy

See `docs/AGE_OF_WINGS.md` §3 (Rush reload loses the unbanked haul; Trials reload voids the attempt; Arena checkpoints stay banked; Hatchery results are saved before the reel).

## Where to start changing things

- New species: `src/content/species.ts` (+ mastery role in `content/mastery.ts`).
- New Trials course: add to `TRIALS` in `src/content/trials.ts`, then run `tests/trials.test.ts` and set thresholds from the printed table.
- Arena enemies/waves: `ENEMIES`, `spawnWaveEnemy`, `WAVE_TEXT` in `src/sim/arena.ts`; re-run `tests/arena.test.ts`.
- Economy/XP: `src/content/progression.ts`, `src/content/world.ts`; re-run all tests.
