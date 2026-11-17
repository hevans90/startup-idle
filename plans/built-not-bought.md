# Everything is built, nothing is bought

Roads are built and projects are built. Everything else the player lays down
still appears the moment it is paid for: a lot, an office, a lab, a port, a
pipe, a sewer, a dredged channel. This is the plan to give each of them a
site, a crew, loads and a finish — with what we already have, not a third
system.

Status: BUILT, all nine steps, in the game's own play path — with these left
short of the plan:
- A HOUSE has no baked build stages: a lot is serviced by stages, and a house
  that grows a floor or a tier stands in scaffold for a while; the floors
  themselves still appear whole.
- A MAIN goes in a length at a time, real pipe as far as it has got. A sewer's
  TRUNK and a CHANNEL are still on the map only when all of them is done, and
  a sewer is still a trench drawn on the ground.
- A PORT's upgrade to the next tier is still at once; its cranes are not seen
  being erected.
- The AI's own mains and sewers are laid at once (its buildings are sites).
- No balance sim was run for the early game's pace; the times are first
  numbers (a lot 12 s, a rack 18 s, an office 60 s, a port 80 s, a main 3 s a
  tile).
- No new words on screen but one comms line when a line job stops for money.

## The audit

What can be built besides roads and projects, and how it appears today.

| What | Ids | Paid | Appears | Drawn by | Starts working at once |
|---|---|---|---|---|---|
| Lots → houses | `kit:<role>.t0/t1/t2/landmark`, 1×1 | once, at placement | instantly, as a staked plot; floors as people move in | baked house pieces, a whole floor at a time | beds are counted even with a `build` record |
| Offices, lab, rack, slop processors, levee | `office-*`, `lab`, `rack`, `refinery`, `dataplant`, `contentfarm`, `levee` | once | instantly | the PROJECT renderer — each already has a `looks.ts` model | desks, lab, rack, processor, cooling all already skip a site |
| Seaports and their upgrades | `seaport`, `-2`, `-3` | once; upgrade once | instantly | `seaport-renderer.ts`, in code | boats call at a port whether it is built or not |
| Town services | cafe, club, cinema, … | the town's, free | instantly | project renderer | services and desirability |
| The Machine's buildings | `ai-node`, `gpu-farm`, … | free | instantly | project renderer | — |
| Water mains | pipe, intake, pump, outlet | once, by length | instantly | pipe mesh and shader | water runs through it at once |
| Sewers | trunk, lateral, manhole, storm drain, lift station | once, by the plan | instantly | `sewer-layer.ts` | the sewer solve |
| Dredging | — | once | instantly | the ground itself | the water's depth |
| House tiers | t0 → t1 → t2 | — | an instant swap | baked pieces | — |
| Demolition | anything | free | instantly | — | — |

Not placed by anyone: bus stops, parking bays, boats (derived). Bridges come
only from roads (done). Terrain tools are the editor's and the AI's.

**What makes this cheaper than it looks:**
- The `Build` record is generic, saves for any structure already, and the
  project renderer draws any of its models part-built. Seven of the kinds
  above — offices, lab, rack, processors, levee, services, the Machine's —
  are ALREADY drawn by the project renderer from a model. They are sites the
  moment something steps them.
- Most readers already ignore a structure with a `build` record: desks, labs,
  racks, processors, cooling, arrivals, mood.
- What makes `build` project-only is narrow: `stepWorks`, `catchUpWorks` and
  `crewPlan` skip anything that is not a project; `newBuild` wants a
  `ProjectDef`.

**What is genuinely new work:**
- Houses have no part-built model: baked pieces, a floor at a time.
- Ports are drawn in code with no notion of a site.
- Pipes and sewers are lines in the ground, not plots: they are ROAD-shaped
  work (a trench that advances), not project-shaped.
- Readers that do NOT wait for completion: housing capacity, ports for boats,
  water walls, mains flow, the sewer solve.
- About 70 test files, the AI planner, the pilot's desks and the fixtures
  place things and expect them there when the call returns.

## The model: two kinds of job, both of which exist

Everything buildable is one of two shapes, and we have built both.

1. **A SITE** — a plot with a `Build` record: groundworks, then the building
   rising, loads by lorry, a crew. Today's projects. For: lots and houses,
   offices, lab, rack, processors, levee, ports, services, the Machine's.
2. **A LINE** — a job along cells with fronts that follow one another, opened
   a length at a time. Today's roads. For: mains, sewers, dredging.

No third system. `works.ts` is generalised from "projects" to "sites";
`roads/jobs.ts` is generalised from "road" to "line job" with a kind.

**Who pays and who builds.** As roads and projects: nothing at the order, a
load at a time; a site that cannot pay stands. Small things are built by a
contractor's gang (as roads are) so a lot does not pull developers off their
desks; projects stay the company's own crew.

**How long.** Seconds, not minutes, for small things — a lot in about 20 s, an
office about a minute — or the early game stops. To be tuned in a balance
test against today's pace, as roads were.

**Instant paths stay** for the editor, fixtures, headless tests and
`foundEarnedProjects`: one flag, as `roadWorks` is for roads.

## What each kind looks like

- **Offices, lab, rack, processors, levee, services** — the project site as it
  is, scaled down: set out, dug, piled (not the rack or the levee), poured,
  then frame and cladding. No tower crane under a height; a telehandler or
  nothing.
- **Lots and houses** — a lot is set out and serviced (pegs, a trench to the
  road, a slab), then stands ready. A HOUSE going up is new art: the baked
  pieces gain a "frame" stage per floor (timber or block shell, scaffold,
  roof trusses, then the finished piece). Tier growth t0→t1→t2 becomes
  scaffold round the house and a floor added, not a swap.
- **Ports** — sheet piles driven along the quay by the rig (from a barge or
  the bank), the quay filled and poured by the mixer, cranes erected last.
  An upgrade extends the quay the same way while the old berth keeps working.
- **Mains** — a line job: set out, a trench cut by the digger, pipe lengths
  laid from a lorry and jointed, backfilled and the surface made good. Water
  runs only through the part that is laid and joined to its source.
- **Sewers** — the same, deeper: trench boxes, manhole rings lowered in,
  backfill; a lift station is a small site.
- **Dredging** — a dredger (a barge with a grab or a suction pipe) works along
  the stroke, the bed going down behind it, spoil to a hopper barge.
- **Demolition** — the reverse, and quick: fenced, an excavator pulls it down
  in a few bites, rubble into lorries, the plot cleared. Instant only for a
  site that has not started.

## Order of work

Each step leaves the game playable and the suite green.

1. **Sites for everything the project renderer already draws.** Generalise
   `works.ts` off `ProjectDef`; offices, lab, rack, processors, levee go up
   as sites through the play path. Readers checked one by one for "counts a
   site as built". This is the cheapest and the largest share of what the
   player builds.
2. **The AI, the pilot, the sims.** They place and then build on what they
   placed; step 1 breaks them until they wait or plan against what is
   ordered — as roads needed `plannedGrid`.
3. **Mains and sewers as line jobs.** `roads/jobs.ts` gains a kind; a trench
   shader beside the road's; water and the sewer solve read only what is
   laid.
4. **Lots and houses.** New baked stages; the lot's servicing; tier growth as
   building work. Housing capacity waits for the roof.
5. **Ports.** A site model for the quay; boats wait for it.
6. **Dredging.** The dredger and its barge.
7. **Demolition.**
8. **Town services and the Machine's buildings** — the town's own and free;
   they go up as sites with no bill.
9. **Balance and catch-up.** Time away for every new job; the early game's
   pace held by a test; every card's stall notice.

## Risks

- **The early game.** A player's first minutes are lots and a road. If each
  lot is a wait, the game opens with a queue. Hence gangs, seconds not
  minutes, and many small jobs at once.
- **Things that depend on things.** A lot wants a road; an office wants
  housing; a main wants its pump. Everything must be orderable against what
  is ORDERED, not only what is built — the planned grid, widened.
- **Readers.** Each kind has readers that must wait and readers that must
  not (water must treat a half-built wall as it is, not as it will be). A
  list per kind, and a test per reader.
- **Tests.** ~150 direct placements. They keep the instant path; only the
  play path changes.
- **Sprite and draw cost.** A town with thirty sites, each with a gang and
  machines. The road plant's and the sites' budgets, measured on
  `?fixture=bigtown`.
- **Art volume.** Houses' build stages and the port's site are the two real
  art jobs; the rest reuses the digger, rig, mixer, lorries and crews.

## To be decided by you

1. **Everything, or everything but the smallest?** Planned: everything. A rack
   (1×1) and a levee segment could stay instant if they prove tedious.
2. **Who builds small things** — a contractor's gang (planned) or the
   company's people?
3. **How long.** Planned: a lot ~20 s, an office ~1 min, a main ~3 s a tile.
4. **Does a lot get a construction phase, or only the house on it?** Planned:
   both, the lot's short.
5. **Do the town's free services and the Machine's buildings wait too?**
   Planned: yes, last.
6. **Demolition takes time?** Planned: yes, but quick.
7. **Words on screen** for each new card and stall notice: none without your
   say, a list at step 9.
