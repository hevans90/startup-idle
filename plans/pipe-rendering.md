# Pipe rendering overhaul

Status: **phase 1 done** (2026-11-01). The pipe network itself stays as `plans/pipes-overhaul.md` and `plans/pipes-and-slop.md` built it. This plan changes only how mains, fittings and ports are drawn.

The goal is for pipes to look as solid and readable as Factorio's. That means:
- round, lit metal tubes;
- real elbows, tees and crosses;
- flanges at the joints;
- a shadow on the ground;
- supports that look as if they hold the pipe up.

They should be drawn in this game's own art: the Kenney isometric city pack, with flat three-tone shading and light from the top left. No Factorio art or shapes are copied.

## 1. What is wrong today

`src/world/render/mains-layer.ts` draws each cell as its own `Graphics` in its band. A tube is three stacked strokes (SHADE, BODY, SHINE) with a soft shadow stroke under them. That gives five problems:

1. **It reads as a ribbon, not a tube.** A stroke has no cross-section. The shine sits in the same place whichever way the pipe runs, so a pipe running along `u` and one along `v` are lit the same. The Kenney light comes from the top left, so they should not be.
2. **Bends kink.** A bend is two strokes meeting at the cell's centre. Their joins and caps overlap, so the outline notches and the shine breaks. Tees and crosses are just strokes laid over each other.
3. **The details are too small to read.** At normal zoom, collars and bands (`ring()`) are 1–2 px. Glass sections every fourth tile look like a colour glitch, not like a window.
4. **Nothing sits on the ground.** The shadow is a blurred offset stroke, not a cast shadow. Saddles and posts are small `isoBox`es with no contact shading. Stilts over roads (`ROAD_LIFT`) are thin and hard to read.
5. **Night and colour sit apart from the city.** The pipe colours (BODY `0x8796a8`, and the AI violet) are flat, so they go purple-blue under the night multiply sheet. Kenney buildings have a lit face and a shaded face, and the pipes do not.

Cost is also a problem. Every cell's `Graphics` is tessellated again whenever it is redrawn. `quads.ts` explains why that went wrong for water.

## 2. The target look

Each item below is a requirement the work must meet.

- **A tube with a real cross-section.** The shading runs across the tube, worked out from a surface normal and the scene's light (top left, a little above).
  - That gives a lit flank, a narrow specular line, a darker underside and a thin dark outline matching Kenney's edge lines.
  - A pipe along `u` and one along `v` read differently, as the walls of a building do.
- **Elbows** are quarter-torus bends with a radius of about 0.35 of a cell, not corners.
- **Tees and crosses** are a straight run with a short stub that has a weld collar where it joins.
- **Flanged joints** at every cell boundary (on the LOD tier where there is room): a raised ring a little wider than the tube, with 4–6 bolt dots on its visible face. This rhythm is what makes Factorio pipes read as built rather than drawn.
- **End caps:** a domed cap, or a blind flange with bolts.
- **Supports:**
  - Ground runs sit in concrete saddles every cell, each with a contact shadow.
  - Stilts over roads become an H-frame (two legs and a crossbeam) with a cast shadow on the road.
  - Spans over dips get a leg down to the ground.
- **A cast shadow:** a hard-edged, low-alpha shape on the ground, offset down and to the right to match the shadows already baked into the Kenney buildings, with a tighter contact line under the saddles.
- **Fittings modelled in the same shading:**
  - the intake (a grated box);
  - the pump house (a small building with a lit roof, a door, and a pump wheel or motor);
  - the outlet (flange, valve wheel);
  - the drain, the outfall (a mouth that spills onto the river bank), and the ports on buildings (short nozzles with a flange).
- **Glass windows** stay, as one clear window per cell, every fourth cell:
  - a darker slot, with the water's flow moving across it;
  - the existing water dashes are drawn only through the window, not along the whole pipe.
- **The variants keep their own colour:**
  - water mains are a cool steel;
  - sewer mains are a brown cast iron (`SEWER_*`), a little wider, with fewer flanges;
  - AI lines are steel with violet bands;
  - bores keep `BORE_WIDE`.
- **Night:** a pipe is lit in the same way as buildings under the multiply sheet. Pipes give off no light of their own (that would be an extra). The colours are chosen so they stay steel-grey at night rather than going violet.
- **The Water overlay is unchanged.** Its state colours and tank rings are drawn over the new pipes as they are now.

## 3. The technique

I recommend option A. Option B is the fallback.

### A. A lit tube mesh per band (recommended)

- Build the pipe geometry on the CPU from the connection mask of each cell.
  - Straight pieces, elbows, tees, crosses, caps and flanges each come from a small parametric generator: a ring of N sides swept along a line or an arc.
  - In world space, each vertex holds its position, a normal and a material id.
- Project with the same iso projection as `P()`, and draw one `Mesh` per band with a small shader, after the `quads.ts` and `water-gpu.ts` pattern (`GlProgram` and `GpuProgram`, one interleaved buffer that is grown by doubling).
- The shader works out:
  - Lambert light from the scene's light direction;
  - a specular line (Blinn, tight, clamped so it stays flat-looking);
  - a darkened rim, standing in for the outline;
  - the material colour from a small palette uniform (water steel, sewer iron, AI violet band, concrete, pump paint);
  - optional quantising to three tones, so the pipes match Kenney's flat shading rather than looking like a 3D render. This is a uniform, so the look can be tuned in the browser.
- Depth inside a band: the tube is drawn in back-to-front cell order, the same order as the bands. Within a cell, the pieces are put in the buffer far side first. There is no depth buffer, so this matches how everything else on the map sorts.
- Cast shadows are a second, flat mesh in the same band. It is the tube's footprint pushed onto the ground plane (`levelAt` gives the height) and drawn before the tube.
- A cell is rebuilt only when its connections, height or variant change. That is when `drawCell` runs today. The band's buffer is patched in place.

Why A:
- It fixes the look at its root, because the shading comes from geometry rather than from stacked strokes.
- Bends and tees come out right by construction.
- Zoom is free, and there is no tessellation.
- The repo has already proved the pattern with water (`quads.ts`, `water-gpu.ts`), including on WebGPU.

Its risks:
- Sorting against things in the same band, such as cars on stilted roads and buildings beside a pipe. It must keep the order the band already uses.
- Pixi render-group rebuilds. Rebuilding the buffer must not change the band's structure. See the `render-group-rebuilds` and `pixi-gc-breaks-render-groups` memory notes.

### B. Baked sprite pieces (fallback)

Draw each piece once, offline or at startup, into an atlas:
- straights along `u` and along `v`;
- the four elbows, four tees, the cross and four caps;
- flanges, at each height step.

Each cell then becomes one or two sprites.

This is the cheapest to run and gives the most control over pixel art. It is how Factorio itself does it. But:
- the pieces have to be drawn per zoom tier, or they blur;
- slopes, stilts and spans multiply the number of pieces;
- per-cell tint for the overlay and the variants needs more work.

Use B only if A cannot meet the frame budget in §6.

## 4. Pieces and where they come from

| Mask | Piece | Notes |
|---|---|---|
| one side | straight plus end cap, or the fitting from `MAIN_END` | a fitting replaces the cap |
| two opposite | straight | flange at the far boundary |
| two adjacent | elbow (quarter torus) | short straight stubs out to the boundary |
| three | tee | weld collar at the stub |
| four | cross | two runs plus a collar |
| height step to a neighbour | sloped straight, or a riser with two elbows | from `levelAt`; the limbs still meet at mid-face height `zf` |
| over a road | the run on an H-frame | legs on the kerbs |
| a port on a building | a nozzle with a flange | replaces `drawPort` |

All of this lives in a new `src/world/render/pipe-mesh.ts`, which turns a cell and its mask into vertices. It can be tested with no GPU: count the vertices and normals, check the elbow's arc ends meet the straights, and check the order is far side first.

`mains-layer.ts` keeps the band bookkeeping, the overlay and the labels. It swaps `drawCell` for writing into that band's buffer.

## 5. Level of detail

Choose the tier from the viewport's scale, with a little hysteresis.

- **Far:** 6-sided tube, no flanges or bolts, saddles only every other cell, shadow kept.
- **Mid:** 10 sides, flanges, no bolts.
- **Near:** 14 sides, bolts, valve wheels, glass window frames.

When the tier changes, every pipe band is rebuilt once, in the same frame. A tier change never happens frame to frame.

## 6. Performance budget

- Measure on bigtown and on the singularity fixture with `__waterBench` (`sync=true`) and `__gpuTime().of.render`, read after 45 bench frames. Never use the HUD, and never measure in a hidden tab.
- Pipe render time must be no worse than today's `Graphics` path, and should be better. Record both numbers in this plan before and after.
- Allocation: none in a frame where no pipe changed.
- The render-group check: count `_buildInstructions` while panning and while the water flows. Flow animation must not add rebuilds. Flow becomes a time uniform plus a window mask in the shader, not a redrawn `Graphics`.
- Keep `renderer.gc` off.

## 7. Phases

Each phase ends with screenshots at fixed zooms (far, mid, near) on the singularity fixture and the projects fixture, by day and by night. All of them are taken on the isolated preview server.

1. **Mesh and shader for straights only.** Water steel, run alongside the old path behind a debug toggle (`window.__pipes = "mesh" | "old"`) so the two can be compared on the same frame. Settle the light, the tones and the outline here, with the user looking at the screenshots, before anything else is built.
2. **Elbows, tees, crosses, caps and flanges.** Includes the tests in `pipe-mesh.test.ts`.
3. **Cast shadows, saddles, H-frame stilts, span legs, and the height steps and slopes.**
4. **Fittings and ports:** intake, pump house, outlet, drain, outfall and nozzles.
5. **Variants:** sewer, AI and bore. Then glass windows with the flow drawn through them, and the dashes removed elsewhere.
6. **Level of detail tiers, the perf pass (§6), and the removal of the old `Graphics` path and the toggle.** README line updated.

### Phase 1, as built

- `render/pipe-mesh.ts` builds tubes and balls in the map's own metric space (a half step is `ZT` of a tile), writing only the faces the camera sees; `render/pipe-gpu.ts` lights them in three tones with a shine line and a darkened edge, in WGSL and GLSL.
- `mains-layer.ts` draws a band at a time: a Graphics for what lies under the tubes, one mesh for the tubes, a Graphics for what is on them. `__pipes = "old"` in the console brings back the strokes.
- Decided on the screenshots:
  - The tube is 0.18 of a tile across (`TUBE_R`), and lies higher (`LIFT` 0.8) to clear the ground.
  - The shine runs along the screen's "up", not toward the sun. A true glint lit only the tubes running one way.
  - The steel is a warm grey (`0xb9b7b1`), which the night's blue grade leaves grey, like the roofs.
  - The old flat collars are off on solid tubes, because on a round tube they read as stuck-on plates. Flanges come in phase 2.
- Not seen: the GLSL path in the game. With `?webgl`, the water shader fails to compile (`dryDepth`, `groundAt`) and stops the render, before any pipe draws. The pipe GLSL was compiled by hand in a WebGL2 context, and it compiles.

## 8. Verification

- Unit tests on `pipe-mesh.ts`: how many vertices each piece has, that pieces meet at their seams, and the draw order.
- Pairs of screenshots, before and after, at the same camera, for each phase. These are the evidence that it looks better, not a description.
- Night screenshots, to check the pipes stay steel and do not go purple.
- The Water overlay, labels and hover still line up on the new pipes.
- The full suite and `npx tsc -b`.

## 9. Open questions

1. **How flat or how 3D?** The shader can quantise to Kenney's three tones, or shade smoothly as Factorio does. I would start at three tones with a soft specular line, and decide on the phase 1 screenshots.
2. **How thick?** Today a tube is `WIDE = 0.11` of a cell. Factorio pipes are chunky, about a third of a tile. Thicker reads better but hides more road and grass. I would try 0.18 and tune it.
3. **Pipes under roads.** Should mains that cross a road go under it, as a short buried section with a manhole either side, instead of on stilts? That changes the look, not the rules, but it is a design choice.
4. **The AI line's look.** Should it be steel with violet bands, as proposed, or should the whole tube be violet as now?
