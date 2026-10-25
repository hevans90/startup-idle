import type { ResourceBreakdown } from "../state/generators.store";
import { PopCard, PopGroup, PopRow, type Tone } from "../ui/console";
import { ModifierTag } from "../ui/ModifierTag";

const mult = (m: number) => `×${m.toFixed(2)}`;
const isActive = (m: number) => Math.abs(m - 1) > 1e-9;

/**
 * Itemized breakdown of a per-second resource, as a popover card: its total in
 * the header, each employee type's share and what multiplies it, then the
 * globals applied to everyone. Shared by the money and innovation HUD popovers.
 */
export const ResourceBreakdownView = ({
  header,
  breakdown,
  format,
  tone = "console",
}: {
  header: string;
  breakdown: ResourceBreakdown;
  /** Render a per-second value (e.g. money → "$1.2k/s", innovation rate). */
  format: (n: number) => string;
  tone?: Tone;
}) => {
  const { total, globals, perGenerator } = breakdown;
  const activeGlobals = globals.filter((g) => isActive(g.mult));

  return (
    <PopCard title={header} value={format(total)} tone={tone} className="w-72"
      foot={perGenerator.length === 0 ? "No employees yet: hire someone." : undefined}>
      {perGenerator.map((g) => {
        const factors = g.factors.filter((f) => isActive(f.mult));
        return (
          <PopGroup key={g.id}>
            <PopRow strong label={<span className="capitalize">{g.name} <span className="font-normal text-fg-muted">×{g.amount}</span></span>} value={format(g.total)} />
            <PopRow indent label="each" value={format(g.perUnit)} />
            {factors.map((f) => (
              <PopRow key={f.label} indent
                label={f.modKey ? <ModifierTag modKey={f.modKey}>{f.label}</ModifierTag> : f.label}
                value={mult(f.mult)} />
            ))}
          </PopGroup>
        );
      })}
      {activeGlobals.length > 0 && (
        <PopGroup label="Multipliers">
          {activeGlobals.map((g) => (
            <PopRow key={g.label}
              label={g.modKey ? <ModifierTag modKey={g.modKey}>{g.label}</ModifierTag> : g.label}
              value={mult(g.mult)} />
          ))}
        </PopGroup>
      )}
    </PopCard>
  );
};
