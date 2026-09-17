# Fluid simulation: an unbiased assessment

## Context

You asked for an honest analysis of the whole fluid system: solver, falls, drips, pipes, sources, rendering, integration, tests, docs. Everything below was read from source, and every bug claim was verified against the current working tree by hand, not just reported by a subagent. Nothing has been changed.

Scope of what was read: `src/fluid/*` (columns, falls, drips), `src/world/water/*` (field, pipes, pipe-flow, sources, materials), `src/world/render/{water,water-gpu,corner-rule,nappe,falls-render,overfall,foam,flow-wash,drips-gpu}.ts`, `world-scene.tsx`, `world.store.ts`, `io/serialize.ts`, all of their tests, README, docs/. Roughly 7,500 lines of sim plus 5,000 of render.

## Verdict in one paragraph

This is a real shallow-water engine, not a game-water fake, and the solver core is the strongest part: the right model, correct wet/dry handling, strict conservation including water in the air, timestep-independent terms, and behavioural tests that would catch regressions. The problems are almost all at the seams around it. There are several genuine bugs in how the editor and frame loop talk to the solver. The renderer has grown two implementations of nearly everything, with the shipping one barely tested. A structural mismatch, tile-resolution bed under column-resolution water, is the root of half the renderer's complexity, a 2x solver stability tax, and the fish-tank edge you just fixed. And the prose-to-code ratio of ~55% has crossed the line where the comments have started to lie about the code beneath them.

## What is good

- **Right model, correctly applied.** Virtual pipes with hydrostatic reconstruction (`columns.ts:1064-1112`). The sill test is the one decision that makes cliffs work and it is right. A waterfall genuinely is "a large head across one edge".
- **Positivity and conservation are structural, not patched.** One-pass outflow limiter with a correct sufficiency argument (`columns.ts:1146-1168`). `totalWater` counts depth + air + drips (`columns.ts:405-411`) and tests hold it to 1e-6 over thousands of frames.
- **Water in the air is real water.** Falls are a reservoir the mass passes through, not an animation. The single parabola `driftAt` is shared by solver landing, spray, and both renderers, with the unit conversions done correctly on each side.
- **Timestep independence is taken seriously.** `pow(drag, dt)`, `exp(-dt/τ)` decays, CFL-sized substeps from the deepest column, implicit bed drag and implicit breaking diffusion so neither can overshoot. Resolution independence is a tested property (`columns.test.ts:729-877`), and the `cell` parameter is real.
- **Layering is clean and acyclic.** `src/fluid` imports nothing from `src/world` or Pixi. Drips are coupled through callbacks. Render imports fluid one way only.
- **Shader single-source with skeleton tests** (`corner-rule.ts`, `drips-gpu.ts`) so WGSL and GLSL cannot drift. The WGSL `let`-immutability test is a genuinely good idea.
- **Tests are behavioural and guard their own vacuity.** Names are claims about the world. Several tests assert that the scene really contains the awkward case before asserting the property. Exact `toBe` where exactness is the claim.
- **Performance discipline in the hot loop.** Active box, no allocation in the substep, separable wind evaluation, wind read per run of columns, tint LUT.

## What is wrong

### A. Bugs (all verified in source)

1. **Placing or demolishing a building never syncs the solver's ground.** `commitStructure` (`world.store.ts:596-612`) writes height and `structureAt` patches but never calls `syncGround`. Only `commitStroke` and `doUndo` do. Water flows straight through a freshly placed building until an unrelated terrain edit or a reload. `SOLID_LIFT` is dead on the placement path. `doRedo` (`:631-643`) has the same omission.
2. **The substep guard silently discards simulated time.** `stepFlow` (`columns.ts:812-820`) exits after 12 substeps with `left` unintegrated. The comment at `:803-809` says `hMax` "catches what is left"; it does not, the time is dropped. `runSources` and `runPipes` receive the full frame `dt` regardless (`world-scene.tsx:583-584`), so on any frame that trips the guard, springs inject water for time the solver never advanced. Pixi's 100ms frame cap makes this reachable on ordinary hitches. No test names `MAX_SUBSTEPS`; the one long-frame test (`columns.test.ts:67-74`) sits inside the truncation regime and passes because mass is still conserved.
3. **A fall's tidy-up landing bypasses `addWater`.** `land()` (`falls.ts:387`) does `f.depth[to] += amount` directly, so `f.deepest` is not raised and the next substep can be sized too long. Conservation is fine; the stability invariant is not. It also lands the tail cold at the cliff base with no `landsAt` offset, unlike the main path.
4. **Drop shape oscillator can go NaN.** `wobbleOf` (`drips.ts:291`) gives ω ∝ 1/√V with a 1e-6 volume floor; symplectic Euler (`drips.ts:374-375`) is only stable for ω·dt < 2. Plunge flecks are `amount × 0.05 / 5`, arbitrarily small, so ω·dt at 60Hz can be in the tens. The GPU clamp `Math.max(-0.6, Math.min(1.2, NaN))` passes NaN through into the site texture.
5. **`spillOrphaned` hardcodes the column stride** (`pipe-flow.ts:371`, `x * 4`) in a codebase whose `field.ts:33-37` says resolution is "PURELY a detail setting". It also dumps a whole tile's pipe volume onto one column.
6. **Foam paints a fall's landing in the wrong place.** `landingAt` (`foam.ts:85-98`) whitens the column immediately across the edge; the solver lands the water `driftAt` away, ~7 columns on the test scene. The real landing is whitened separately via `splash`, so there are two birth mechanisms and one points at bare rock.
7. **Persistence and undo desync from the water.** Undoing a drain restores the `fluid` layer but not the water (`world.store.ts:517-530`). `pool` is quantised to `Uint8` on save: ±0.5 half-step per tile and a silent cap at 255. `serializeWorld` without the live field writes the stale `pool` (`serialize.ts:161`; the store test does exactly this). `resize` and `applyFixture` discard live water with no warning. Momentum, pipe contents, and in-flight water are never saved.
8. **Ground edits under water teleport it.** `syncGround` writes `ground` only, so raising a tile lifts the column intact (energy from nothing, then an avalanche); building on a wet tile perches its water 64 half-steps up.

### B. Physics and design limits

- **Virtual pipes has no momentum advection.** There is no u·∇u term, so a jet does not carry across still water and there is no true hydraulic jump. Comments occasionally claim more than the model can deliver (`columns.ts:557-560`). The plunge and crater are direct flux injections, explicitly labelled as exaggerated. Fine for a game; be honest about it in the prose.
- **`minSlope` is a hard dead-band switch, per edge** (`columns.ts:1114`). It is the stated reason a puddle has an edge, and it is also the reason the shallow fringe exists that the renderer then fights with `SHOW_DEPTH`, `shownDepth`, `atBrink`, `DRAWDOWN`, and the whole rim machinery. A discontinuous gate at a front is also a flicker source. A continuous friction law (Manning or Chézy with a proper wet threshold) gives an edge without a switch.
- **Tile-resolution bed under column-resolution water.** This is the structural fault line. It halves your stable Courant number (0.4 vs ~0.7, your own measurement at `columns.ts:767-782`, a 2x cost on every substep). It is the reason corners carry two heights (`vs`/`vsLow`), the reason lips need special seam handling, and the reason the water ended in a vertical cut. Interpolating the bed to column resolution, keeping steps sharp only above a cliff threshold, would pay back in both places.
- **Breaking model oversold.** The Kennedy et al. eddy viscosity is a Boussinesq wave-breaking closure transplanted into a non-dispersive scheme, with thresholds divided by a fudge factor of 8 (`VERTICAL`). The diffusion writes back only on breaking cells, so it is not momentum-conserving. It works as a tunable dissipation; the citation implies more rigour than is there.
- **Two caps that can never bind or never vary.** `FALL_THROW = 3` equals `MAX_FLOW_SPEED = 3` (`falls.ts:98`, `columns.ts:1297`), so the throw cap is inert. `frontSpeed` freezes once a fall reaches the floor (`falls.ts:322`), so a steady waterfall sheds spray from one deterministic thread per edge, contradicting the comment at `falls.ts:428`.
- **Global `deepest` sizes the substep for the whole map.** One deep pit anywhere makes every puddle step finer.

### C. Engineering hygiene

- **Two of everything in the renderer.** CPU `water.ts` (951 lines, 48 tests, does not ship) vs GPU `water-gpu.ts` (1006 lines, 3 tests, ships). `falls-render.ts` vs `overfall.ts` (395 lines, 60ms vs 5.4ms, header still says "nothing is drawn from it yet" while `world-scene.tsx:602` draws it). `shallow-water.ts` (v1) in the same directory as the solver that replaced it. `water-compare.ts` cannot run under `bun test`, so no CI check touches the shipping renderer's pixels.
- **`?rim` is a large, carefully argued, disabled feature** with no doc entry. Now that you have extended the mesh over the edge, it and its ~60 lines of rationale are either superseded or in conflict. Either way it needs a decision.
- **Comment density is ~55% (nappe.ts 77%, 60 lines of code under 250 of prose).** Much of it is changelog: what the code used to do and what was measured before the fix. That is exactly what makes stale sentences expensive, because a reader cannot tell "current" from "three commits ago". Verified stale: the `MAX_SUBSTEPS` doc; "allocates nothing" at `falls-render.ts:66` and `overfall.ts:39` (`nappeSteps` allocates 24 objects per edge per frame); the `overfall.ts` header; "a fortieth of a drop" (`falls.ts:186`, actual ~1/12); `columns.test.ts:19-24` "two columns to the tile" (game runs four); `drips-gpu.ts:697` vs the whole-grid walk 100 lines below it; `@see CARRIED` pointing at an unused constant.
- **Per-frame waste that contradicts the stated philosophy.** `refreshWaterMeta` walks the whole map every frame in production (`world.store.ts:394-398`). Pipe flood fill and `spillOrphaned` scan the full grid every frame with zero pipes. `stepFalls` recomputes `flowX`/`flowY` per column per substep. `atBrink` is probed ~144 times per lip edge per frame. `flow-wash` has no dry-column early-out. The perf HUD measures none of sources, pipes, or meta.
- **Duplication.** `fx`/`fy` loop bodies copy-pasted twice in `substep`. Gravity 2.25 as two literals in two modules with a comment saying they must match. `aerate` duplicated into `drips-gpu.ts`. Dead: `CARRIED`, `pourOf`/`sharedPour`, `stepsFor` (unused by the shipping path), `getWater`, unreachable branch at `falls.ts:295`.
- **`world-scene.tsx` at 674 lines owns the tick contract** (sources → pipes → flow → draw) as three adjacent lines, alongside perf, benches, culling, and a monkey-patched `renderer.render`. The sim is gated on a render layer existing.

### D. Tests

Good overall, and better than most. Gaps that matter: nothing for `syncGround` under standing water or `SOLID_LIFT`; nothing for either substep cap; `drawOverfall` and `drawGpuDrips` untested; sub-drop flecks untested; the shipping water renderer has 3 tests. Some tests pin constants rather than behaviour (`NAPPE_STEPS` count, `FRAY < 1`, `wobbleOf` ratio). `fixtures.test.ts` costs 25s for smoke coverage.

### E. Process

120 commits on this subsystem in five days. The quality of individual decisions is high; the stale prose, the parallel implementations, and the integration gaps are the predictable cost of that pace with no consolidation pass.

## If you act on this: priority order

1. **Integration bugs first** (small, high value): `syncGround` in `commitStructure` and `doRedo`; make `stepFlow` return the time it integrated and scale sources and pipes by it; route `land()` through `addWater`; clamp ω·dt or floor fleck volume in the oscillator; `COLUMNS_PER_TILE` in `spillOrphaned`.
2. **One implementation per job.** Decide CPU vs GPU water and move the 48 tests onto shared logic the shipping path uses. Finish or delete `overfall`. Delete or default `?rim` now the mesh extension exists.
3. **Bed at column resolution.** The one structural change that simplifies both solver and renderer and buys back the Courant margin. Large; do it as its own piece of work with the resolution tests as the guard.
4. **Replace the `minSlope` switch with a continuous law**, then remove the renderer heuristics it made necessary.
5. **Comment policy.** Keep the why and the units. Move measurements and "it used to be" into commit messages. Fix the verified stale sentences now.
6. **Perf hygiene.** Gate `refreshWaterMeta` behind the HUD, early-out the pipe scans, measure sources and pipes.

## Verification

- `bun test src/fluid src/world/water src/world/render` (currently 416 pass, ~57s).
- For item 1: a test that places a structure over a pool and asserts the solver's `ground` moved; a test that `stepFlow(f, 0.5)` advances `f.t` by 0.5 or reports what it did.
- For item 2: `window.__waterCompare` on the lake, brink, and plunge fixtures before and after.
