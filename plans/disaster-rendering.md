# Disasters you can see: fire, heat and the rest

Status: **phase 1 done** (2026-11-08). Follows the events overhaul (`events-overhaul.md`, phases 1–5 done).

## Why

The playtest of the events (2026-11-08) found the map telling you less than the card does:

- **Overheated racks are only a badge.** The heatwave grades the map warm, but a rack that has overheated looks exactly like one that hasn't. "Overheated · 2 more" floats over a building that looks fine.
- **Every cause of damage looks the same.** Flooded, overheated and closed by the inspector all show one red badge on an unchanged building.
- **Road works are a ring.** The closed junction itself has nothing on it: no barrier, no cone, no lamp.
- **Fire is left out** of the disasters list "until there's art for it". Storms with wind and anything falling from the sky are left out too.

Everything below is built from **two new shared pieces** plus what already draws. No piece needs new building art.

## What draws now

| Piece | Where | Used for |
|---|---|---|
| Colour grade over the map | `HEAT_GRADE`, `NIGHT_GRADE`, `mixColour` (`daylight.ts`, `world-scene` ~3455) | night, heat, drought |
| Rain over the screen | `drawRain` | a flood |
| Building glows, over the night sheet | `render/lights.ts` (`glowTexture`, own layer, map transform) | windows, lamps, signs |
| Pooled motes: dust, sparkle, confetti | `render/juice.ts` (`dabTexture`, `MAX_MOTES` 240, in `bands.dynamicOf[band]`) | building, demolishing, Ship It |
| Ground spills | `events/sludge.ts` | slop |
| Real water | the solver, `events/flood.ts` | flood, drought |
| Damaged badge and line | `play/badges.ts`, `building-info.ts`, `damagedAs` | every cause |
| Damaged tint on the building's sprites | `DAMAGED_TINT` (`world-scene`), set once a second | was mud for every cause; now by cause (phase 1) |
| Moving the camera | `vp.animate` | following |

## The two new pieces

### 1. Emitters: continuous juice

`juice.ts` makes one-off bursts. An **emitter** is the same pooled mote, spawned continuously at a building or tile until it is stopped:

- `emit(at, recipe) → stop()`. The recipe gives:
  - texture: the existing dab or flake, plus two new procedural canvases, a flame tongue and a smoke puff;
  - spawn rate, life, rise, drift, spread;
  - a colour ramp over life, and an additive or normal blend.
- Motes live in `bands.dynamicOf[band]`, as juice's do, so a building in front still hides them. They never go in a static chunk. Showing, hiding or reparenting a sprite in one rebuilds its whole draw list (see *render group rebuilds*).
- **One shared budget** with juice. As built, emitters may hold at most `EMIT_MOTES` (160) of the 240, so the bursts always have the rest. Emitters slow their spawn rate when zoomed out (`zoomRate`, never under a quarter), and stop entirely when their band is off screen.
- The pure parts get unit tests, as `juice.test.ts` does: spawn counts per second, the colour ramp, and the budget.

### 2. A condition glow on the building

An **unlit glow sprite** in the lights layer, drawn day and night, pulsing, with its colour set by the damage cause. It's a sibling of the window glows: the lights layer is already above the night sheet and carries the map's transform.

- heat: a red-orange pulse;
- fire: a bright orange flicker;
- closed: a cold grey, no pulse;
- flood: none, because the water already shows it.

It is **set when damage starts and cleared when it's repaired**, never per frame on the building's own sprites.

Correction: the building's sprites were already tinted while damaged — `DAMAGED_TINT`, mud, for every cause. Phase 1 keys it by cause instead: mud for a flood, scorched warm for heat, grey for closed. It's the same once-a-second tint as before, so it adds no structural change.

## Each disaster, from the pieces

| Disaster | On the map |
|---|---|
| **Heatwave** (exists) | The warm grade, as now. A heat-haze emitter over what drinks (faint, wavy, rising, additive). Overheated buildings get the heat glow plus a steam emitter. |
| **Fire** (new event, see Questions) | A flame emitter on the roof cells (additive orange-to-yellow tongues). A smoke column above it: grey puffs rising and drifting, lit from below at night by the fire glow. Embers drift down. Afterwards, a charred tint until repaired and a scorch decal on its tiles that fades over minutes, drawn the way sludge is. |
| **Drought** (exists) | The warm grade, as now. A cracked-bed decal on river tiles the drought has drained. |
| **Road works** (exists) | A barrier and two cones on the closed tile, drawn as Graphics: a striped bar and two orange wedges, no art needed. An amber lamp blinking in the lights layer. |
| **Burst main** (planned) | The solver pours the water, as the plan already says. A white-blue spray emitter at the joint. |
| **Sewer backup** (planned) | Sludge, as the plan says. A brown bubbling emitter at the manhole. |
| **Blackout** (planned) | That district's buildings drop out of the lights layer, with a flicker before they go. |
| **Earthquake** (planned) | Camera shake on `vp`, dust puffs from `juice.puff`, and a crack decal. |
| **Closed by the inspector** (exists) | The closed glow. Tape is optional and later. |

## Phases

1. **Done.** `render/juice.ts` (emitters, `Recipe`), `render/lights.ts` (`conditionsOf`, its own root shown day and night), `render/disaster-fx.ts` (what each disaster shows, synced once a second), `DAMAGED_TINT` by cause. Steam and the glow sit at the building's roof as drawn (`RoofOf`). The flame texture waits for phase 2. Not yet measured as in phase 4.
   **The two pieces, shown on what exists.** Emitters, and the condition glow on any damaged building, keyed by cause. Then use them on the heatwave (haze, steam and glow on overheated buildings) and on road works (barrier, cones, lamp). This closes the playtest's three gaps.
2. **Fire.** Design the event first (see Questions). Then flames, smoke, embers, the charred tint, and scorch decals. "Damaged" gets a `fire` cause.
3. **The planned disasters**, cheapest first: burst main, sewer backup, blackout, earthquake. Each one is an event in the events plan's form: a def, choices and a built answer.
4. **Measured.** On `?fixture=bigtown`, with a fire, a heatwave and road works all running at once:
   - `__waterBench` with `sync=true` stays within 5% of a quiet town;
   - `_buildInstructions` doesn't rise per frame;
   - the mote budget is never exceeded.

## Questions

1. **What starts a fire, and what answers it?** Candidates:
   - a rack left overheated past its repair;
   - a café kitchen;
   - a blackout's surge.

   Answers could be a fire station whose reach covers the building (a new service), hydrants on the mains (water you already pipe), or letting it burn. My lean is overheated racks plus hydrants, because both tie fire to systems that already exist.
2. **Does fire spread** to neighbours? It's more dramatic, but needs a spread rule and a cap. My lean is one building, with spread only to buildings left without water.
3. **Procedural or drawn art?** I'd make flames, smoke, haze, cones and barriers procedurally, as `dabTexture` is made, and ask for drawn art only if they read badly.
