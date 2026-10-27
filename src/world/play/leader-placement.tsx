/**
 * World v2 — PLACING A LEADER: while one is being placed, the buildings where
 * their kind works light up and take the click; the next click on one puts
 * them there, a click on anything else says where to click. Esc lets go of
 * it. @see LeadersPanel, setPickable
 */
import { useEffect } from "react";

import { useTeamLeadersEmployeesStore } from "../../state/team-leaders.store";
import { useWorldStore } from "../../state/world.store";
import { WORKPLACES } from "../agents/commute";
import { structureAt } from "../grid";
import { KIND_PLURAL } from "../../molecules/leaders-panel";
import { setPickable } from "./opens";

export function LeaderPlacement() {
  const placing = useTeamLeadersEmployeesStore((s) => s.placing);
  useEffect(() => {
    if (!placing) return;
    const ok = (def: string, build: unknown) => !build && WORKPLACES[placing].includes(def);
    setPickable(ok);
    const stopLook = useWorldStore.subscribe((st, was) => {
      if (!st.lookedAt || st.lookedAt === was.lookedAt) return;
      const s = st.grid.structures.get(structureAt(st.grid, st.lookedAt.x, st.lookedAt.y));
      const t = useTeamLeadersEmployeesStore.getState(), l = t.employees.find((e) => e.role === placing);
      if (!l) { t.setPlacing(null); return; }
      if (!s || !ok(s.def, s.build)) {
        useWorldStore.setState({ notice: { text: `Pick a building where your ${KIND_PLURAL[placing]} work`, at: Date.now() } });
        return;
      }
      t.placeLeader(l.id, s.id);
    });
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") useTeamLeadersEmployeesStore.getState().setPlacing(null); };
    window.addEventListener("keydown", esc);
    return () => { setPickable(null); stopLook(); window.removeEventListener("keydown", esc); };
  }, [placing]);
  return null;
}
