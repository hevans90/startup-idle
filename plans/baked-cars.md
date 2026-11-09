# Cars baked from models: a town's worth of variety

Status: **phases 1–3 built** (2026-11-09): eleven car models plus roof variants, picked by weight; work vehicles (pickup, vans, flatbed, box lorry, tipper, the Machine's lorry) and liveries (taxi, police, ambulance, postal van, fire engine) — 34 looks in 2½ pages, each layer cropped tight; a weighted real-world paint palette. Choice by place (vans by works, SUVs in rich districts) is deferred. Decided: colour by tint, a base sheet plus close pages, new kinds later, headlights left for later.

## Why

Next to the painted roads and shaded ground, the traffic is the plainest thing on screen:

- **Every car is the same car.** A box with a glass box on top (`agents/town-render.ts`, `CAR_L` 0.38 by `CAR_W` 0.2), in one of 7 colours. There are no wheels, lights, bumpers, mirrors or roof lines.
- **Five vehicles in all:** car, lorry, the interns' bus, the limo and the Machine's lorry. Vans are lorries in white.
- **Baked at runtime, at 3 texels a unit.** Each new look is drawn as Pixi Graphics into a RenderTexture the first time it's seen, so a new colour or heading costs a draw mid-frame. At zoom 8 a car is magnified 2.7× and soft.
- **Occlusion by drawing order.** The lorry draws its cab or its load first depending on which way it faces. Any vehicle more complex than two boxes would need more of these special cases.

## The idea: low-poly models, rendered offline

**Each vehicle is a small 3D model in code, rendered offline into a sprite sheet. At runtime a car is a sprite picked from it, with no drawing at all.**

- **Models are data** (`agents/cars/models.ts`, pure). A model is a list of parts:
  - bevelled boxes for the body, bonnet, boot and roof;
  - glass as faces of the cabin;
  - wheels as short cylinders, with arches cut by darkening;
  - small parts: lights, bumpers, mirrors, grille, plates, roof bars, a light bar.

  Each part has a material: `paint`, `paint2` (a two-tone roof or stripe), `glass`, `tyre`, `trim` (black plastic), `chrome`, `lamp`, `livery`.
- **The baker** (`dev/bake-cars.ts`, `bun run bake:cars`) is a small software rasteriser, like the other bakes: no browser, no renderer.
  - Triangles are drawn with a z-buffer, so nothing depends on draw order and the lorry's special case goes away.
  - The light comes from the screen's left, as on the ground's walls. Each face gets a flat light, plus a soft ambient-occlusion darkening under the body.
  - A soft contact shadow is drawn on the road under each car.
  - Edges are antialiased by drawing at 4× and averaging down.
  - Output is PNG pages in `public/isometric_assets/derived/cars_*.png`, plus `cars.json`: each frame's rectangle, the anchor at the car's foot, and the base points the band choice reads (`front`, as now).
- **Paint by tint, so colours are free.** Each frame is baked as two layers:
  - **paint:** the painted panels in white with their shading;
  - **trim:** everything else in its own colours.

  At runtime the paint sprite is tinted, which is how people are drawn now. Any colour is just a tint, so colour variety costs no frames.
- **Headings:** 32, as now.
- **Slopes:** a car on a ramp is the level frame with a skew along its heading (`sprite.skew`), not a baked frame for each pitch. Ramps are at most a full step a tile, and at that angle a skew is indistinguishable from a re-render.

## The variety

| Kind | Models | Notes |
|---|---|---|
| **Small** | city car, 3-door hatch, 5-door hatch | short (0.32–0.35 long) |
| **Family** | saloon, estate, MPV, small SUV, large SUV | the bulk of traffic |
| **Sporty** | coupé, convertible (roof down: seats and a windscreen frame), hot hatch with a spoiler | rare |
| **Work** | pickup (open bed with clutter), small van, panel van (high roof), Luton van (box over the cab), flatbed lorry, box lorry, tipper, tanker, refuse lorry | replace today's `truck`; the culture's vans pick from these |
| **Service** | taxi (a black cab with a roof sign), police car (Battenburg livery and light bar), ambulance (Battenburg, high box), postal van (red), fire engine | livery is a material, not paint, so it's never tinted |
| **People movers** | the interns' minibus, single-decker bus, double-decker bus, coach | the shuttle chooses by culture level |
| **Special** | limousine, the Machine's lorry (white, no glass, violet light bar), an ice-cream van | the existing specials, remodelled |

About 30 models. On top of the model, each mover gets:
- **Paint:** a weighted palette of real-world car colours: mostly greys, silvers, whites, blacks and dark blues, with the odd red, green, yellow or orange. A share of family cars get a two-tone roof.
- **Variant bits:** roof bars or a roof box, black or chrome trim, tinted rear glass. These are baked as variants of a model where they change its outline, which is at most 2 or 3 per model.
- **Dirt:** a darker tint on the trim layer for some work vehicles.

So about 30 models and 60 variants. With any paint colour, no two streets look alike.

**How each mover gets its model:** a hash of the mover's id, weighted by kind and place. More vans near works sites, more SUVs and coupés in rich districts (`beauty`), taxis near shops. These weights live in `agents/cars/fleet.ts` and are tested.

## Size and resolution

Estimated from today's dimensions, to be measured in phase 1: a car's sprite is about 34×30 world px at scale 1, and a double-decker about 3× that.

- **Base sheet at 2 texels a world px:** about 60 variants × 32 headings × 2 layers ≈ 3,800 frames, around 30 MB on the GPU and around 5 MB of PNG. It's sharp up to zoom 2 and loaded at start.
- **Close sheet at 6 texels a world px, a page per model,** loaded when you zoom in past 2 (`lodFor`'s hysteresis, as the roads do). Only the models on screen are loaded, typically a handful. They're dropped when you zoom out, with the deferred destroy the roads needed (see the batch crash notes).
- Sampling is linear with mipmaps on the base sheet, so far-off cars don't shimmer.

## What changes at runtime

- **`town-render.ts` vehicles:**
  - the sprite pair comes from the sheet, keyed by model, variant and heading;
  - the paint sprite is tinted and the trim isn't;
  - skew comes from `pitch`;
  - `front` comes from the JSON.

  Band choice, `crosses` and the movers' own render group are unchanged. The runtime atlas and `drawMoverFront` stay for people only.
- **Spacing:** each model has a length, and the follow distance (`town.ts`, the `half` lengths) reads it instead of a constant per kind. Buses and lorries keep their lane rules.
- **`?cars=boxes`** draws today's boxes, as `?roads=sprite` and `?ground=sprite` do.
- **`?fixture=cars`:** every model parked in rows, one heading per column, on a road. The baker's own test page.

## Phases

Each phase is a commit on main, with a check in the fixture on the isolated server, and README lines updated.

1. **Baker and three models.**
   - `models.ts` with a hatchback, a saloon and a panel van.
   - The rasteriser, sheet and JSON.
   - `town-render` draws them behind the flag.
   - **Tests:** the rasteriser draws a known box to known pixels; a model's sprite is deterministic; its anchor puts the wheels on the road at all 32 headings; paint and trim never cover the same pixel.
2. **The fleet:** all the car models, the paint palette, variants, and choice by place. Tests on the weights.
3. **Work and service vehicles:** lorries, vans and service liveries. The culture's vans and the works lorries move onto them, and the Machine's lorry is remodelled.
4. **Buses, coach and limo**, and spacing by model length. Re-run the traffic and town tests.
5. **The close sheet:** pages per model by zoom, freed safely.
6. **Retire the boxes:** delete the vehicle half of `drawMoverFront` once `?cars=boxes` is no longer needed.

## Risks and checks

- **Texture memory:** measure the base sheet on the GPU, and close pages with a busy street at zoom 8. Budget: base under 40 MB, close under 30 MB.
- **Load time:** the base sheet's PNGs decode at start. Measure first frame on bigtown before and after.
- **Draw calls:** cars become 2 sprites from at most 2–3 sheet pages, instead of 1 sprite from runtime pages. Movers batch in their own render group, so check `__townPerf` on bigtown.
- **Lighting match:** the models' light has to match the ground walls and the buildings, with the lit side down-left and the shade down-right. Compare in the streets fixture.
- **Skew on ramps:** check the ramp fan with cars driving both ways, both rises.
- **No real brands:** generic shapes and liveries, with no badges or marques.

## To decide

1. **Colour by tint** (recommended: any colour for free) or a baked palette (richer paint, such as metallic flake or reflections, at about 10× the frames).
2. **Resolution:** base at 2× plus close pages at 6× (recommended), or one sheet at 3× (simpler, soft past zoom 3).
3. **New kinds** that need simulation changes, such as motorbikes, cyclists and parked cars on kerbs: in this plan or a later one. Recommended: later. This plan only changes how existing movers look.
4. **Night:** headlights and tail lights as a baked third layer, shown at night and when braking. In this plan as phase 7, or left out.
