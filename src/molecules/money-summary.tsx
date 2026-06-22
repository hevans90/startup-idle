import { ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { useGeneratorStore } from "../state/generators.store";
import { formatCurrency } from "../utils/money-utils";

const money = (n: number) => formatCurrency(n, { exponentBreakpoint: 1e9 });
const mult = (m: number) => `×${m.toFixed(2)}`;
const isActive = (m: number) => Math.abs(m - 1) > 1e-9;

/** One aligned label/value line. */
const Row = ({
  label,
  value,
  className,
  indent,
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
  indent?: boolean;
}) => (
  <div
    className={twMerge(
      "flex items-baseline justify-between gap-4",
      indent && "pl-3",
      className,
    )}
  >
    <span className="truncate">{label}</span>
    <span className="shrink-0 tabular-nums">{value}</span>
  </div>
);

/** Itemized breakdown of $/sec: total, each employee type's contribution and
 *  its multipliers, then the globals applied to everyone. Toolbar money popover. */
export const MoneySummary = () => {
  // Subscribe to a PRIMITIVE so the popover refreshes when earnings change, then
  // read the (fresh-object) breakdown imperatively — selecting the object
  // directly returns a new reference each render and trips React's
  // "getSnapshot should be cached" infinite loop.
  useGeneratorStore((s) => s.getMoneyPerSecond());
  const { total, globals, perGenerator } =
    useGeneratorStore.getState().getMoneyBreakdown();
  const activeGlobals = globals.filter((g) => isActive(g.mult));

  return (
    <div className="flex w-64 flex-col gap-2 text-xs">
      <Row
        label="Money"
        value={`${money(total)}/s`}
        className="text-sm font-bold"
      />

      {perGenerator.length === 0 && (
        <p className="opacity-60">No employees earning yet — hire someone.</p>
      )}

      {perGenerator.map((g) => {
        const factors = g.factors.filter((f) => isActive(f.mult));
        return (
          <div
            key={g.id}
            className="flex flex-col gap-0.5 border-t border-primary-400/40 pt-1.5 dark:border-primary-600/50"
          >
            <Row
              label={
                <span className="font-medium capitalize">
                  {g.name}{" "}
                  <span className="opacity-60">×{g.amount}</span>
                </span>
              }
              value={`${money(g.total)}/s`}
              className="font-medium"
            />
            <Row
              indent
              label="each"
              value={`${money(g.perUnit)}/s`}
              className="opacity-70"
            />
            {factors.map((f) => (
              <Row
                key={f.label}
                indent
                label={f.label}
                value={mult(f.mult)}
                className="opacity-70"
              />
            ))}
          </div>
        );
      })}

      {activeGlobals.length > 0 && (
        <div className="flex flex-col gap-0.5 border-t border-primary-400/40 pt-1.5 dark:border-primary-600/50">
          <p className="text-[10px] uppercase tracking-wide opacity-50">
            Applies to everyone
          </p>
          {activeGlobals.map((g) => (
            <Row
              key={g.label}
              indent
              label={g.label}
              value={mult(g.mult)}
              className="opacity-80"
            />
          ))}
        </div>
      )}
    </div>
  );
};
