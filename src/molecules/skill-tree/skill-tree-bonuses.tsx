import {
  aggregateGrants,
  type EffectRow,
  nodeById,
  nodeEffectRows,
  type SkillNode,
  SKILL_TREE,
  STAT_META,
  type StatTotal,
} from "../../game/skill-tree";
import { usePrestigeStore } from "../../state/prestige.store";
import { useSkillTreeUiStore } from "../../state/skill-tree-ui.store";

const NODES = nodeById(SKILL_TREE);
const toneClass = (tone: "good" | "bad") =>
  tone === "good"
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-rose-600 dark:text-rose-400";

const spotlight = (ids: string[]) =>
  useSkillTreeUiStore.getState().setHighlightIds(ids);
const clearSpotlight = () => useSkillTreeUiStore.getState().setHighlightIds([]);

const trim = (n: number) => Number(n.toFixed(2)).toString();
const fmtPct = (v: number) => `${v > 0 ? "+" : ""}${Number(v.toFixed(1))}%`;
const goodClass = "text-emerald-600 dark:text-emerald-400";
const badClass = "text-rose-600 dark:text-rose-400";

/**
 * Right-hand panel summarising what your allocated passives do. The headline is
 * the **computed totals** — every grant folded into one net figure per stat —
 * followed by the individual keystones and notables (their reshape twists are
 * worth reading). The totals are the real modifiers applied to the economy.
 */
export const SkillTreeBonuses = () => {
  const allocated = usePrestigeStore((s) => s.allocated);

  const nodes = allocated
    .map((id) => NODES.get(id))
    .filter((n): n is SkillNode => !!n);

  const totals = aggregateGrants(nodes.flatMap((n) => n.grants ?? []));
  const keystones = nodes.filter((n) => n.kind === "keystone");
  const notables = nodes.filter((n) => n.kind === "notable");

  // Minors grouped per cluster, with ids so a hover can spotlight them all.
  // (All minors in a cluster share the same per-node effect rows.)
  const minorGroups = new Map<
    string,
    { name: string; count: number; ids: string[]; rows: EffectRow[] }
  >();
  for (const m of nodes) {
    if (m.kind !== "minor") continue;
    const g =
      minorGroups.get(m.cluster) ??
      { name: m.title, count: 0, ids: [], rows: nodeEffectRows(m) };
    g.count += 1;
    g.ids.push(m.id);
    minorGroups.set(m.cluster, g);
  }

  return (
    <div className="pointer-events-auto absolute inset-y-0 right-0 w-72 overflow-y-auto border-l border-primary-300 bg-primary-50/85 p-3 text-primary-900 backdrop-blur-sm dark:border-primary-700 dark:bg-primary-900/85 dark:text-primary-100">
      <h3 className="text-sm font-bold">Allocated bonuses</h3>
      <p className="mb-3 text-[11px] opacity-50">
        {nodes.length} {nodes.length === 1 ? "node" : "nodes"} · {totals.length}{" "}
        {totals.length === 1 ? "stat" : "stats"} affected
      </p>

      {nodes.length === 0 && (
        <p className="text-xs opacity-60">
          Allocate passives to see their combined bonuses here.
        </p>
      )}

      {totals.length > 0 && (
        <Section label="Totals" color="text-cyan-600 dark:text-cyan-400">
          {totals.map((t) => (
            <TotalRow key={t.stat} total={t} />
          ))}
        </Section>
      )}

      {keystones.length > 0 && (
        <Section label="Keystones" color="text-rose-500 dark:text-rose-400">
          {keystones.map((k) => (
            <Row key={k.id} title={k.title} rows={nodeEffectRows(k)} ids={[k.id]} />
          ))}
        </Section>
      )}

      {notables.length > 0 && (
        <Section label="Notables" color="text-amber-600 dark:text-amber-400">
          {notables.map((n) => (
            <Row key={n.id} title={n.title} rows={nodeEffectRows(n)} ids={[n.id]} />
          ))}
        </Section>
      )}

      {minorGroups.size > 0 && (
        <Section label="Minor passives" color="text-emerald-600 dark:text-emerald-400">
          {[...minorGroups.entries()].map(([cluster, g]) => (
            <Row key={cluster} title={`${g.name} ×${g.count}`} rows={g.rows} ids={g.ids} />
          ))}
        </Section>
      )}
    </div>
  );
};

/** One aggregated stat line: label + net % and/or × multiplier, coloured by
 * whether each part helps (green) or hurts (rose) given the stat's direction. */
const TotalRow = ({ total }: { total: StatTotal }) => {
  const meta = STAT_META[total.stat];
  const pctGood = meta.good === "up" ? total.pct >= 0 : total.pct <= 0;
  const multGood = meta.good === "up" ? total.mult >= 1 : total.mult <= 1;
  return (
    <div className="flex items-baseline justify-between gap-2 bg-primary-200/70 px-2 py-1 dark:bg-primary-800/60">
      <span className="text-xs">{meta.label}</span>
      <span className="flex items-baseline gap-1.5 text-xs font-semibold tabular-nums">
        {total.pct !== 0 && (
          <span className={pctGood ? goodClass : badClass}>{fmtPct(total.pct)}</span>
        )}
        {total.mult !== 1 && (
          <span className={multGood ? goodClass : badClass}>×{trim(total.mult)}</span>
        )}
      </span>
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
    <p className={`mb-1 text-[10px] font-semibold uppercase tracking-wide ${color}`}>
      {label}
    </p>
    <div className="flex flex-col gap-1.5">{children}</div>
  </div>
);

const Row = ({
  title,
  rows,
  ids,
}: {
  title: string;
  rows: EffectRow[];
  ids: string[];
}) => (
  <div
    onMouseEnter={() => spotlight(ids)}
    onMouseLeave={clearSpotlight}
    className="cursor-default bg-primary-200/70 px-2 py-1 transition-colors hover:bg-cyan-500/20 dark:bg-primary-800/60 dark:hover:bg-cyan-400/20"
  >
    <div className="text-xs font-medium">{title}</div>
    {rows.map((row, i) => (
      <div key={i} className={`text-[11px] ${toneClass(row.tone)}`}>
        {row.label}
      </div>
    ))}
  </div>
);
