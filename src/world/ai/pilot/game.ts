/**
 * World v2 — THE PILOT, DRIVING THE GAME: the one pilot a company has, stepped
 * by the scene's tick while AI mode is on, and read by the pilot bar. A drone
 * is flown to each thing it does that has a place, for the look of it: the
 * thing is done already. @see createPilot, PilotBar, plans/ai-mode-rebuild.md phase 6
 */
import type { Grid } from "../../grid";
import { DRONE_SPEED, MAX_DRONES, getAiRunner } from "../ai-runner";
import { allDesks, livePurse } from "./live";
import { usePilotView, type PilotView } from "../../../state/pilot-view.store";
import { useFounderStore } from "../../../state/founder.store";
import { useSessionStore } from "../../../state/session.store";
import { shownAs, type DeskId } from "./job";
import { LOOK_EVERY, createPilot, type Pilot } from "./pilot";

const pilot: Pilot = createPilot(allDesks());
let flown = 0;
let company: Grid | null = null;
let sincePublish = Infinity;

/** The pilot as the interface reads it: plain words and numbers. @see usePilotView */
export function viewOf(p: Pilot): PilotView {
  const st = p.status();
  return {
    kind: st.kind, says: st.says, job: st.job?.id ?? null, now: p.now(), pinned: p.pinned(),
    queue: p.queue().map(({ job, shown }) => ({
      id: job.id, desk: job.desk, says: job.says, why: job.why, at: job.at, puts: job.at ? job.puts : undefined,
      cost: job.cost, costs: job.costs ?? "money", state: shown.state, shown: shownAs(shown, job.costs),
    })),
    log: [...p.log()].reverse(),
  };
}

export const gamePilot = (): Pilot => pilot;

const DESKS: readonly DeskId[] = ["people", "town", "landmarks", "water", "harbour", "culture", "machine", "events"];

/** HOW THE PLAYER HAS STEERED IT, taken from the session as often as it looks. @see steerAi */
function steer() {
  const s = useSessionStore.getState(), off = s.aiDesksOff ?? [];
  pilot.setGoal(s.aiGoal === "landmark" ? "landmark" : "grow");
  for (const d of DESKS) if (pilot.desksOff().has(d) !== off.includes(d)) pilot.setDesk(d, !off.includes(d));
}

/** THE PLAYER'S HAND, from the interface; said back at once. @see PilotAct */
usePilotView.setState({
  act: (a) => {
    if ("cancel" in a) pilot.cancel(a.cancel);
    else if ("restore" in a) pilot.restore(a.restore);
    else if ("doNext" in a) pilot.doNext(a.doNext);
    else pilot.pause(a.pause);
    sincePublish = Infinity;
  },
});

/** Where its drones fly from: the company's own building. */
function droneHome(g: Grid): { x: number; y: number } | null {
  let home: { x: number; y: number } | null = null, rank = -1;
  for (const s of g.structures.values()) {
    const r = s.build ? -1 : ["garage", "hq", "boardroom", "ipo"].indexOf(s.def);
    if (r > rank) { rank = r; home = { x: s.x + s.w / 2, y: s.y + s.h / 2 }; }
  }
  return home;
}

/** A frame of AI mode. */
export function stepGamePilot(g: Grid, dt: number) {
  // Another map is another company: nothing remembered of the last.
  if (company !== g) { if (company) resetGamePilot(); company = g; }
  if (sincePublish + dt >= LOOK_EVERY) steer();
  const st = pilot.tick(dt, () => livePurse(useSessionStore.getState().aiReserve ?? 0), g.rev);
  // SAID TO THE INTERFACE, as often as it looks.
  sincePublish += dt;
  if (sincePublish >= LOOK_EVERY) { sincePublish = 0; usePilotView.getState().publish(viewOf(pilot)); }
  if (pilot.done() === flown) return;
  flown = pilot.done();
  const to = st.kind === "did" ? st.job?.at : undefined, from = droneHome(g), r = getAiRunner();
  // THE MODEL'S OWN flies one drone more. @see plans/ai-mode-rebuild.md open question 1
  const most = MAX_DRONES + (useFounderStore.getState().selectedFounderId === "model" ? 1 : 0);
  if (!to || !from || r.jobs.length >= most) return;
  r.jobs.push({ action: { kind: "deferred", at: to, why: "", run: () => true }, from, to, t: 0, fly: Math.hypot(to.x - from.x, to.y - from.y) / DRONE_SPEED });
}

/** A new company: a pilot with nothing remembered. */
export function resetGamePilot() {
  pilot.reset();
  flown = 0;
  company = null;
  sincePublish = Infinity;
  usePilotView.getState().clear();
}
