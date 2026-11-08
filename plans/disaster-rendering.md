# Disasters you can see: fire, heat and the rest

Status: **phases 1 and 2 done** (2026-11-08). Follows the events overhaul (`events-overhaul.md`, phases 1–5 done).

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
2. **Done: fire.** `events/defs/fire.ts`, `events/fire-spread.ts`, `damage.ts` (`fire` cause, `burn`, `FIRE_REPAIR_SECONDS`), `cooling.ts` (`onMains`, `hoseFor`). Questions 1 and 2 answered with the lean:
   - **It starts** as a heatwave's follow-up: ridden out with anything overheated, 20 s later the first building still overheated smokes, and 30 s after that it catches. The director never draws it otherwise (weight 0). The crew getting there first calls it off.
   - **Hose it from the hydrants**, only where the mains reach it: every tank emptied and none filled for the 2 minutes it takes. **The fire brigade**: 120 s of income, out in a minute. **Let it burn** (the default): 3 minutes, burnt out (a 480 s rebuild, not a 180 s repair), and halfway through it catches up to two buildings next to it left without water. No repairs while it burns.
   - Stakes: hydrants best for 63%, brigade 11%, burning 26%; median gap 5.9%; the default worst 37%. The model works out a fire's company from the company's own draws, so no other event's numbers moved.
   - Drawn: smoke while it smoulders; flames (a new procedural tongue), a dark smoke column, embers and a flickering glow once caught; the charred tint after. **Not done:** the scorch decal — under a standing building it would barely show; the charred tint carries the afterwards.
3. **Done: the planned disasters.** Each is an event in the events plan's form, with a def in `events/defs/`, choices, a built answer and a model entry. Stakes (best for · median gap · default worst):
   - **Burst main** (`burst-main.ts`): the middle joint of the longest main that feeds anything (`breakableCell`) bursts. `runMains` still draws what it would carry but pours it at the joint ("burst" on the main's card). Dig it up (every intern, 2 min), a contractor (90 s of income, 30 s) or let it pour (default, 6 min). Built answer: a second main. Drawn: a white-blue spray. 32/27/41 · 6.0% · 47%.
   - **Sewer backup** (`sewer-backup.ts`): the longest sewer that drains anything chokes. `stepSlop` empties its tanks up at the manhole, the street's slop ("backed-up"). Rod it out (half the vibe coders, 2 min), pump it (90 s of income, 20 s) or leave it (default, 5 min). Built answer: a second sewer. Drawn: brown bubbling. 40/26/35 · 6.3% · 45%.
   - **Blackout** (`blackout.ts`): buildings within 7 tiles of the busiest junction. Generators (100 s of income), shed the agents' load (the heatwave's throttle, only with a datacentre) or sit it out (default: each shut for 5 min, "No power"). Drawn: their lights flicker during the warning and go out when it strikes. 24/30/46 · 7.2% · 43%.
   - **Earthquake** (`earthquake.ts`): rare (weight 0.35, judged by the RARE bar), only with the HQ built. Tremors for 45 s, then 8 s of shaking; the 4 buildings nearest the HQ are damaged ("Quake damaged"; never the HQ itself). Brace (260 s of income: none), strap down the racks (every vibe coder, the AI's buildings spared) or carry on (default). Drawn: the camera shakes, unless motion is calm, and dust comes off what it damaged. 35/48/17 · 17.7% · 38%.
   - **Not done:** the crack decal, for the same reason as the scorch.
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
