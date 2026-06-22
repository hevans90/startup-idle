import Decimal from "break_infinity.js";
import type { OfflineSummary } from "../game/offline-progress";
import { type GeneratorId, GENERATOR_TYPES } from "../state/generators.store";
import { Button } from "../ui/Button";
import { formatCurrency } from "../utils/money-utils";

const fmtDuration = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(1, m)}m`;
};

const plain = (n: Decimal) => formatCurrency(n, { showDollarSign: false });

const Row = ({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) => (
  <div className="flex items-baseline justify-between gap-4">
    <span className="opacity-80">
      {icon} {label}
    </span>
    <span className="font-medium tabular-nums">{value}</span>
  </div>
);

/**
 * "While you were away" popup: what the company earned and auto-hired during the
 * absence. Gains are already credited; the button just dismisses.
 */
export const OfflineSummaryModal = ({
  summary,
  onClose,
}: {
  summary: OfflineSummary;
  onClose: () => void;
}) => {
  const genName = (id: GeneratorId) =>
    GENERATOR_TYPES.find((g) => g.id === id)?.name ?? id;
  const hires = (
    Object.entries(summary.hires) as [GeneratorId, number][]
  ).filter(([, n]) => n > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-80 max-w-full rounded-lg border border-primary-500 bg-primary-100 p-5 text-primary-900 shadow-xl dark:bg-primary-800 dark:text-primary-100"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold">Welcome back</h2>
        <p className="mt-0.5 text-xs opacity-60">
          Away {fmtDuration(summary.elapsedMs)}
          {summary.wasCapped ? " · credited the last 2 days" : ""}
        </p>

        <div className="mt-4 flex flex-col gap-1.5 text-sm">
          {summary.money.gt(0) && (
            <Row icon="💰" label="Money" value={formatCurrency(summary.money)} />
          )}
          {summary.innovation.gt(0) && (
            <Row
              icon="💡"
              label="Innovation"
              value={plain(summary.innovation)}
            />
          )}
          {summary.valuation.gt(0) && (
            <Row icon="📈" label="Valuation" value={plain(summary.valuation)} />
          )}
          {summary.aiSingularity > 0 && (
            <div className="flex items-baseline justify-between gap-4 text-rose-700 dark:text-rose-400">
              <span>🤖 AI singularity</span>
              <span className="font-medium tabular-nums">
                +{summary.aiSingularity.toFixed(1)}%
              </span>
            </div>
          )}

          {hires.length > 0 && (
            <div className="mt-2 border-t border-primary-400/40 pt-2 dark:border-primary-600/50">
              <p className="text-[10px] uppercase tracking-wide opacity-50">
                Auto-hired
              </p>
              {hires.map(([id, n]) => (
                <Row
                  key={id}
                  icon="🧑‍💻"
                  label={genName(id)}
                  value={`+${n}`}
                />
              ))}
            </div>
          )}
        </div>

        <Button className="mt-5 w-full" onClick={onClose}>
          Continue the grind
        </Button>
      </div>
    </div>
  );
};
