# Services & landmarks overhaul

The town builds its own shops. Neighbourhoods form from the roads. Each employee kind has needs, and met needs make that kind work faster. Well-served streets grow beautiful. The 15 projects become 6 tiered landmarks.

## Today
- Three services (café, park, gym). The player buys them (SERVICE_PRICE) once the Town Hall unlocks all three together.
- Coverage is 8 road tiles; services only add mood, and mood drives house tiers t0→t1→t2→landmark.
- Looks are plain procedural boxes (structures/projects/looks.ts).
- 15 one-off projects, listed in a quest-log panel.

## Decisions (from the Q&A)
| Topic | Choice |
|---|---|
| How services appear | Fully organic. Never placed, never paid for, no upkeep, no player control. |
| Where they go | Small shops take ground floors of t1+ houses (residents stay); big ones take their own empty lots. |
| Neighbourhoods | Derived from roads. Each street (segment between junctions) carries its houses; connected housed streets form a neighbourhood, named after its main street. |
| Effects | Needs per kind. Tiers gate on them: t0 needs none, t1 needs 1, t2 needs 2, landmark needs all. Met needs also feed mood and that kind's work speed. |
| Downsides | Only closures: a shop closes when its demand falls away. No noise, no competition. |
| Unlocks | One by one, by each kind's population. Paced so they never spam. |
| Beautification | 3 levels per street, by the share of its homes with met needs. |
| Rendering | Much richer procedural shopfronts. |
| Names | Punny startup-town shop names. |
| Feedback | A map flourish when a shop opens: pop-in plus a floating label. No toasts. |
| AI | Leaves services alone; AI mode and the planner build only housing and roads. |
| Old saves | Existing cafés, parks and gyms become organic and may close. |
| Parks | Organic too: parks, plazas and pocket gardens on leftover plots in well-off neighbourhoods. |
| Town Hall | Removed. |
| Projects | 6 tiered landmarks, shown as visual cards with next-up first. |

## Catalogue & needs
| Kind | Need | Services (unlock order) |
|---|---|---|
| Interns | food | takeaway → bakery |
| Interns | nightlife | bar → night club → arcade |
| Vibe coders | coffee | café → kombucha bar |
| Vibe coders | scene | co-working → vape shop → cinema |
| 10x devs | health | pharmacy → doctor → dentist |
| 10x devs | fitness | gym → climbing wall |
| 10x devs | quiet | park (and plazas, gardens) |

- A need counts as met when any one of its services is unlocked and within reach of the house.
- Big lots: night club, cinema, gym, climbing wall, doctor, co-working. Everything else is a ground-floor shop.
- The extra rule "everyone needs a doctor at tier III+" is still open; it is in the open questions.

## 1. Neighbourhoods, needs, organic spawning (old looks)
**Done.** As built: `world/agents/needs.ts` (needs, services), `world/agents/town-services.ts` (neighbourhoods from `roads/streets.ts`, opening every 5 s per neighbourhood with a 60 s gap, closing after 3 min), `services.ts` coverage by need. Old saves need no version bump: shops are optional on read, an unfinished Town Hall site is dropped, a finished one stands as decor. AI mode's town model opens what the town would (`townOpens`), so its plans still settle tall. Opening is not seeded (`Math.random`); the shops themselves are saved.
- `world/town/streets.ts` splits the road graph into streets between junctions, gives each house its street, and groups connected housed streets into neighbourhoods. Names come from the existing road names.
- `world/town/needs.ts` gives each house its kind, its tier, which needs are met, and where its gate stops it.
- **Spawning:**
  - About every 10 s, each neighbourhood looks for the most-unmet unlocked need among its homes.
  - It opens one service of that need on the best site: a ground floor near the most unserved homes, or a free lot for a big shop.
  - At most one opening per neighbourhood per ~60 s.
  - The service is seeded, so a reload restores the same town.
- **Closing:** a service with fewer than N served homes for 3 min closes.
- **Removed:**
  - SERVICE_PRICE, the build-tool entries and the Town Hall.
  - The planner's "service" job.
  - Old saves migrate (the save version is bumped).
- **Tests:** streets and neighbourhoods on fixtures, the gates, spawn and close, determinism, and the migration.

## 2. Unlock ladder & per-kind effects
**Done.** As built: `world/agents/unlocks.ts` — `UNLOCK_AT` per service by its kind's headcount, a queue `UNLOCK_GAP` (90 s) apart, kept per map and saved (`WorldFile.services`); a map from before catches up at once. Locked services don't count for coverage, desirability or the café desk perk, and the town doesn't open them. Unmet needs (−6) only once one of the kind's needs is unlocked. `needsBonus`: +25% × share of the kind (by resident) with every need met, for money and innovation. On the map run: 1.8 → 72.5 min, mean 4.7 min apart (`simulation/services-pacing.test.ts`). No AI-mode run: the gap is held by the queue whoever hires.
- Each service unlocks at its kind's population. The thresholds come from a pacing sim: the town's normal growth gives about one new unlock every 4–6 minutes overall, never two within 90 s. A queue enforces that gap, so a sudden jump in hires still reveals them one at a time.
- **Work speed:** a kind works faster by the share of its homes with all needs met, up to +25% (NEEDS_SPEED).
- **Mood:** each met need adds to mood for its kind. The noServices penalty becomes "unmet need".
- **Sim:** `simulation/services-pacing.test.ts` checks the unlock times over a typical run and an AI-mode run.

## 3. Shopfront rendering
**Done.** As built: `render/shopfronts.ts` draws a shop's front (window, door, striped awning, lettered sign, neon or a cross, a pavement prop) on its house's face toward the street — the lit face where the street is behind — a Graphics a band among the movers, redrawn on map change; what moves (café/bakery/kombucha steam, arcade screen, club beams, cinema marquee) a Graphics each, redrawn at 12 Hz in visible bands only. Own looks for club, cinema, co-working, doctor and climbing wall (`looks.ts`). Signs glow in their colour at night (`lightsOf` "sign"). Names: `agents/shop-names.ts`, six a service, by building id; shown in the label. Opening: `Juice.opened` — a pop, a sparkle and the name floating up. Fixture `shops`.
- Each service gets a real look:
  - an awning or façade in its own colour and a sign with its name;
  - lit windows at night;
  - neon for the bar, club and arcade, a green cross for the pharmacy and doctor;
  - outdoor props;
  - small animations: club lights, café steam, the cinema marquee chasing.
- Ground-floor shops become a shopfront layer drawn on the house's bottom storey.
- Name pools per service, drawn by seed (for example "Byte Me Bakery", "The Merge Conflict", "Dr. Patch, GP").
- The map flourish on opening is a scale pop plus a floating name label.
- Keep render-group cost flat: no per-frame structural changes (memory render-group-rebuilds).

## 4. Street beautification
**Done.** As built: `agents/beauty.ts` — a street's homes by their door's street, its level by the share with every need of their kind met (`BEAUTY_AT`); +2/4/6 to mood ("a fine street") and to desirability by the best street at a house's doors. `render/street-props.ts` — a Graphics a band among the movers, rebuilt only when the levels or the map change; props by each kerb on a beat along the street, crossings at its ends, murals on every other shopless house of a level-3 street. Level-3 homes add to the town's pedestrians (`Town.strollers`).
- Each street's level rises with the share of its homes whose needs are met (33% / 66% / 90%):
  1. Street trees, planters and bins.
  2. Lamps (lit at night), benches and a paving upgrade (brick or crossings).
  3. Café tables, bunting, murals and more pedestrians.
- Each level adds desirability to the street's houses.
- Props go in a per-chunk prop layer, rebuilt only when a street's level changes.

## 5. Landmarks & projects UI
**Landmarks:**

| Landmark | Tiers |
|---|---|
| HQ | Garage → HQ → Boardroom → IPO Tower |
| Campus | Studio → Campus → Agency |
| Harbour | ports |
| Data Centre | + Refinery, Data Plant and Content Farm as wings |
| Conference Centre | — |
| Hackerspace | — |

- Each tier keeps its old effect and grant and upgrades the same building in place, with a taller, more distinctive look per tier.
- **UI:**
  - A strip of cards shows the 1–2 tiers buildable now big, each with a picture, a one-line effect and the cost.
  - The locked tiers sit behind them, dimmed, each with a single line on what unlocks it.
  - The panel goes; the quest log keeps quests only.
- **Migration:** built projects map to their landmark's tier.
- Quests, books, fixtures and the AI's Data Centre logic are re-pointed. Data Centre wings keep their ids so `racks`, `slop` and so on hold.

## Open questions
- Is a doctor needed by every kind at tier III+? I lean no; it is simpler.
- What are the exact work-speed caps per kind?
- Do landmark tiers cost the same as the projects they replace?
