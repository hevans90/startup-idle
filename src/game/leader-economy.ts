/**
 * WHAT THE LEADERS ON THE PAYROLL DO NOW, each kind's: its leader's effects
 * at the team the map says they lead and the headcount there is. Read by the
 * economy's modifiers, the morale parts and the XP tick. @see game/leaders
 */
import { useTeamLeadersEmployeesStore } from "../state/team-leaders.store";
import type { GeneratorId } from "../state/generators.store";
import { leaderEffects, type Leader, type LeaderEffects } from "./leaders";
import { leaderTeam } from "./projects";

const KINDS: readonly GeneratorId[] = ["intern", "vibe_coder", "10x_dev"];

/**
 * Each kind's leader's effects, given each kind's headcount and what its
 * morale makes of its output; and `everyone`, what every leader adds to every
 * kind's morale. A kind with no leader is absent.
 */
export function leadersNow(
  owned: Partial<Record<GeneratorId, number>>,
  outputMult: (id: GeneratorId) => number = () => 1,
  leaders: readonly Leader[] = useTeamLeadersEmployeesStore.getState().employees,
): { of: Partial<Record<GeneratorId, LeaderEffects>>; everyone: number } {
  const of: Partial<Record<GeneratorId, LeaderEffects>> = {};
  let everyone = 0;
  for (const id of KINDS) {
    const l = leaders.find((x) => x.role === id);
    if (!l) continue;
    const e = leaderEffects(l, leaderTeam(id), owned[id] ?? 0, outputMult(id));
    of[id] = e;
    everyone += e.everyone;
  }
  return { of, everyone };
}
