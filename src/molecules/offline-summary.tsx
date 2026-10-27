import Decimal from "break_infinity.js";
import type { OfflineSummary } from "../game/offline-progress";
import { type GeneratorId, GENERATOR_TYPES } from "../state/generators.store";
import { Button, CountUp, Dialog, Section } from "../ui/console";
import type { Role } from "../ui/theme/tokens";
import { formatCurrency } from "../utils/money-utils";
import { formatDuration as fmtDuration } from "../utils/time-utils";

const plain = (n: Decimal) => formatCurrency(n, { showDollarSign: false });

function Row<T extends number | Decimal>({ label, to, format, role }: { label: string; to: T; format: (v: T) => string; role?: Role }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-fg-muted">{label}</span>
      <CountUp to={to} format={format} role={role} className="font-display text-base" />
    </div>
  );
}

/**
 * "While you were away": what the company earned and auto-hired during the
 * absence, counting up, and the chapter the AI is waiting at. Gains are
 * already credited; the button just dismisses.
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
    <Dialog title="Welcome back" onClose={onClose}
      kicker={`Away ${fmtDuration(summary.elapsedMs)}${summary.wasCapped ? " · the last 2 days credited" : ""}`}
      actions={<Button variant="primary" onClick={onClose}>Continue the grind</Button>}>
      <div className="flex flex-col gap-1.5">
        {summary.money.gt(0) && <Row label="Money" to={summary.money} format={(v) => formatCurrency(v)} role="money" />}
        {summary.innovation.gt(0) && <Row label="Innovation" to={summary.innovation} format={plain} role="innovation" />}
        {summary.valuation.gt(0) && <Row label="Valuation" to={summary.valuation} format={plain} role="valuation" />}
        {summary.aiSingularity > 0 && <Row label="AI singularity" to={summary.aiSingularity} format={(v) => `+${v.toFixed(1)}%`} role="ai" />}
        {/* WHERE THE AI STOPPED: a chapter it would not go past without you. @see holdWhileAway */}
        {summary.chapter && (
          <p className="mt-1 border-l-2 border-ai pl-2 text-xs text-ai">
            The AI is waiting for you at <b>Chapter {summary.chapter.number} · {summary.chapter.title}</b>.
          </p>
        )}
        {hires.length > 0 && (
          <Section label="Auto-hired">
            {hires.map(([id, n]) => <Row key={id} label={genName(id)} to={n} format={(v) => `+${Math.round(v)}`} />)}
          </Section>
        )}
      </div>
    </Dialog>
  );
};
