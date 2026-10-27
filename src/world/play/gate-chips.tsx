/**
 * World v2 — A PROJECT'S GATE, shown: the upgrade it waits on and the
 * headcounts a wonder needs, each as a chip with a popover saying what it is,
 * what it costs and how far off it is. @see game/projects Gate
 *
 * The link runs both ways: an upgrade on the Employees tab says which project
 * it opens, and the project here says which upgrade it waits on, with a button
 * to go and buy it. @see molecules/upgrades
 */
import { twMerge } from "tailwind-merge";

import { gateParts, type GatePart, type ProjectDef } from "../../game/projects";
import { useGeneratorStore, type GeneratorId } from "../../state/generators.store";
import type { Upgrade } from "../../state/upgrades.store";
import { useMoneyStore } from "../../state/money.store";
import { InfoPop } from "../../ui/InfoPop";
import { formatCurrency } from "../../utils/money-utils";
import { KIND_COLOUR } from "./building-info";
import { KIND, hex, kindName, showUpgrades, upgradeOf, useGateUnlocks } from "./gates";

/** "at 25 interns", from an upgrade's conditions, with how many there are now. */
function whenBuyable(u: Upgrade, owned: Partial<Record<GeneratorId, number>>): { text: string; met: boolean } {
  const parts = u.unlockConditions.map((c) => ({ c, have: owned[c.requiredId] ?? 0 }));
  const met = parts.every(({ c, have }) => have >= c.requiredAmount);
  const text = parts.map(({ c, have }) => `${kindName(c.requiredId, c.requiredAmount)} (you have ${have})`).join(", ");
  return { text, met };
}

const LOCK = "🔒", READY = "◆", DONE = "✓";

/** One part of a gate, as a chip with its popover. */
function GateChip({ part, project, owned }: { part: GatePart; project: ProjectDef; owned: Partial<Record<GeneratorId, number>> }) {
  const money = useMoneyStore((s) => s.money);
  if (part.kind === "upgrade") {
    const u = upgradeOf(part.id);
    if (!u) return null;
    const when = whenBuyable(u, owned);
    const afford = money.gte(u.cost);
    const mark = part.met ? DONE : when.met ? READY : LOCK;
    const tone = part.met
      ? "border-good text-good"
      : when.met
        ? "border-warn text-warn"
        : "border-line text-fg-muted";
    return (
      <InfoPop
        className={twMerge("border px-1 py-px text-[10px]", tone)}
        trigger={<><span aria-hidden>{mark}</span><span>{u.name}</span></>}
        title={part.met ? `${u.name}: bought` : `${project.name} needs ${u.name}`}>
        <p>{u.description}</p>
        <p className="tabular-nums">
          Costs <b className={afford || part.met ? undefined : "text-bad"}>{formatCurrency(u.cost)}</b>
          {!part.met && <> · buyable at {when.text}</>}
        </p>
        {!part.met && (
          <button type="button" onClick={showUpgrades}
            className="mt-1 cursor-pointer self-start border border-line-strong px-1.5 py-0.5 text-fg hover:bg-surface-2">
            Show on the Employees tab
          </button>
        )}
      </InfoPop>
    );
  }
  return <StaffCount part={part} />;
}

/**
 * A HEADCOUNT a wonder needs: a bar in the kind's colour, filled as far as
 * the company has got, and how many more in the popover.
 */
function StaffCount({ part }: { part: Extract<GatePart, { kind: "staff" }> }) {
  const share = Math.min(1, part.have / part.need);
  const short = Math.max(0, part.need - part.have);
  return (
    <InfoPop
      className="flex min-w-0 flex-1 flex-col items-stretch gap-0.5"
      trigger={
        <>
          <span className="flex justify-between gap-1 text-[10px] tabular-nums">
            <span className="truncate">{KIND[part.who][1]}</span>
            <span className={part.met ? "text-good" : undefined}>{Math.min(part.have, part.need)}/{part.need}</span>
          </span>
          <span className="block h-1.5 w-full bg-surface-2">
            <span className="block h-full" style={{ width: `${Math.round(share * 100)}%`, background: part.met ? undefined : hex(KIND_COLOUR[part.who]) }}>
              {part.met && <span className="block h-full bg-good" />}
            </span>
          </span>
        </>
      }
      title={part.met ? `${kindName(part.who, part.need)}: done` : `${kindName(part.who, part.need)} needed`}>
      <p className="tabular-nums">
        {part.met ? `You have ${part.have}.` : `You have ${part.have}: ${short} more to hire.`}
      </p>
    </InfoPop>
  );
}

/** A project's gate, every part of it: chips for upgrades, bars for headcounts. */
export function GateChips({ project, className }: { project: ProjectDef; className?: string }) {
  const generators = useGeneratorStore((s) => s.generators);
  const unlocked = useGateUnlocks();
  const owned: Partial<Record<GeneratorId, number>> = {};
  for (const g of generators) owned[g.id as GeneratorId] = g.amount;
  const parts = gateParts(project.gate, owned, unlocked);
  const chips = parts.filter((p) => p.kind !== "staff");
  const counts = parts.filter((p) => p.kind === "staff");
  return (
    <div className={twMerge("flex flex-col gap-1", className)}>
      {chips.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1">
          {chips.map((p, k) => <GateChip key={k} part={p} project={project} owned={owned} />)}
        </div>
      )}
      {counts.length > 0 && (
        <div className="flex gap-2">
          {counts.map((p, k) => <GateChip key={k} part={p} project={project} owned={owned} />)}
        </div>
      )}
    </div>
  );
}
