import { nodeById, type SkillNode, SKILL_TREE } from "../../game/skill-tree";
import { usePrestigeStore } from "../../state/prestige.store";

const NODES = nodeById(SKILL_TREE);

/**
 * Right-hand panel listing the bonuses from every allocated passive: keystones
 * and notables individually, minors aggregated by cluster. (Effects are
 * descriptive until wired to the economy — this will show computed totals then.)
 */
export const SkillTreeBonuses = () => {
  const allocated = usePrestigeStore((s) => s.allocated);

  const nodes = allocated
    .map((id) => NODES.get(id))
    .filter((n): n is SkillNode => !!n);

  const keystones = nodes.filter((n) => n.kind === "keystone");
  const notables = nodes.filter((n) => n.kind === "notable");

  // Aggregate minors by cluster (they share one effect line).
  const minorGroups = new Map<
    string,
    { name: string; effect: string; count: number }
  >();
  for (const m of nodes) {
    if (m.kind !== "minor") continue;
    const g = minorGroups.get(m.cluster) ?? {
      name: m.title,
      effect: m.effect ?? "",
      count: 0,
    };
    g.count += 1;
    minorGroups.set(m.cluster, g);
  }

  const bonusCount = keystones.length + notables.length + minorGroups.size;

  return (
    <div className="pointer-events-auto absolute inset-y-0 right-0 w-72 overflow-y-auto border-l border-primary-300 bg-primary-50/85 p-3 text-primary-900 backdrop-blur-sm dark:border-primary-700 dark:bg-primary-900/85 dark:text-primary-100">
      <h3 className="text-sm font-bold">Allocated bonuses</h3>
      <p className="mb-3 text-[11px] opacity-50">
        {nodes.length} nodes · {bonusCount} bonuses
      </p>

      {bonusCount === 0 && (
        <p className="text-xs opacity-60">
          Allocate passives to see their bonuses here.
        </p>
      )}

      {keystones.length > 0 && (
        <Section label="Keystones" color="text-rose-400">
          {keystones.map((k) => (
            <Row key={k.id} title={k.title} effect={k.effect} />
          ))}
        </Section>
      )}

      {notables.length > 0 && (
        <Section label="Notables" color="text-amber-400">
          {notables.map((n) => (
            <Row key={n.id} title={n.title} effect={n.effect} />
          ))}
        </Section>
      )}

      {minorGroups.size > 0 && (
        <Section label="Minor passives" color="text-emerald-400">
          {[...minorGroups.entries()].map(([cluster, g]) => (
            <Row
              key={cluster}
              title={`${g.name} ×${g.count}`}
              effect={g.effect}
            />
          ))}
        </Section>
      )}
    </div>
  );
};

const Section = ({
  label,
  color,
  children,
}: {
  label: string;
  color: string;
  children: React.ReactNode;
}) => (
  <div className="mb-3">
    <p
      className={`mb-1 text-[10px] font-bold uppercase tracking-wide ${color}`}
    >
      {label}
    </p>
    <div className="flex flex-col gap-1.5">{children}</div>
  </div>
);

const Row = ({ title, effect }: { title: string; effect?: string }) => (
  <div className="rounded bg-primary-200/70 px-2 py-1 dark:bg-primary-800/60">
    <div className="text-xs font-medium">{title}</div>
    {effect && <div className="text-[11px] opacity-60">{effect}</div>}
  </div>
);
