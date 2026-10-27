/**
 * WORK POLICIES, as the player sets them: for each kind on the payroll, the
 * policies it can be run by, a tile each with its trade written on it, as many
 * on as the managers' tiers give slots. A press turns one on or off; morale
 * drifts to suit. @see game/policies
 */
import { policiesFor, SLOT_TIERS } from "../../game/policies";
import { getManagementTierTotal, useInnovationStore } from "../../state/innovation.store";
import { useGeneratorStore, type GeneratorId } from "../../state/generators.store";
import { Panel, Tile } from "../../ui/console";
import { TenXDevText } from "../../utils/ten-x-utils";
import { RainbowText } from "../../utils/vibe-utils";

function Kind({ id }: { id: GeneratorId }) {
  if (id === "vibe_coder") return <RainbowText text="Vibe coders" inline />;
  if (id === "10x_dev") return <TenXDevText text="10x devs" />;
  return <>Interns</>;
}

export function PoliciesPanel() {
  // The managers' tiers give the slots: re-read as they climb.
  useInnovationStore((s) => s.managers);
  const generators = useGeneratorStore((s) => s.generators);
  const policies = useGeneratorStore((s) => s.employeeManagement.policies);
  const slots = useGeneratorStore((s) => s.getPolicySlots)();
  const toggle = useGeneratorStore((s) => s.togglePolicy);
  const tiers = getManagementTierTotal();
  const next = SLOT_TIERS.find((t) => t > tiers);
  const kinds = generators.filter((g) => g.amount > 0).map((g) => g.id as GeneratorId);

  return (
    <Panel title="Work policies"
      help="How each kind is run: each policy a trade, its effects on it. Manager tiers give the slots, the same for every kind. Switching is free; morale drifts to its new level."
      controls={<span className="text-[10px] uppercase tracking-widest text-fg-muted">
        {slots} {slots === 1 ? "slot" : "slots"}{next !== undefined && ` · next at ${next} tiers`}
      </span>}>
      {slots === 0 && <p className="mb-2 text-xs text-fg-muted">Raise a manager to tier 1 for the first slot.</p>}
      <div className="flex flex-col gap-3">
        {kinds.map((kind) => {
          const on = policies[kind] ?? [];
          return (
            <section key={kind} aria-label={`${kind} policies`} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-display uppercase tracking-wider"><Kind id={kind} /></span>
                <span className="tabular-nums text-fg-muted">{on.length}/{slots}</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {policiesFor(kind).map((p) => {
                  const active = on.includes(p.id);
                  const full = !active && on.length >= slots;
                  return (
                    <Tile key={p.id} selected={active} aria-pressed={active} disabled={full}
                      title={full ? "Every slot is taken: turn one off first" : undefined}
                      onClick={() => toggle(kind, p.id)} className="flex flex-col items-start gap-0.5 px-2 py-1.5">
                      <span className="text-xs font-bold">{p.name}</span>
                      <span className="text-[10px] leading-snug text-fg-muted">{p.says}</span>
                    </Tile>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </Panel>
  );
}
