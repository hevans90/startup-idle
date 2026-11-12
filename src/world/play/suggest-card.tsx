/**
 * World v2 — CONNECT IT FOR ME, as a card: a run just started at a thirsty
 * inlet or a free slop port, and the routes on offer from there — a line
 * each: what it is best at, what it brings, its price as the button that
 * lays it. Ignore them and the run goes on being drawn by hand.
 * @see pipes/suggest, plans/pipe-network.md §8
 */
import { Button } from "../../ui/console";
import { mainWet, useWorldStore } from "../../state/world.store";
import { formatCurrency } from "../../utils/money-utils";
import { suggestionsKept, type Suggestion, type SuggestionWhy } from "../pipes/suggest";

const CARD = "border border-line-quiet bg-surface-1/95 px-2.5 py-1.5 text-xs shadow-lg backdrop-blur-sm";
const WHY: Record<SuggestionWhy, string> = { cheapest: "Cheapest", most: "Carries most", "no-pump": "No pump", shortest: "Shortest", only: "Only way" };
const TIP: Record<SuggestionWhy, string> = {
  cheapest: "The least to lay", most: "The most a second", "no-pump": "Nothing to pay for running it", shortest: "The fewest tiles", only: "No other route from here",
};

/** What a suggestion brings, in a few words. */
function brings(s: Suggestion): string {
  if (s.kind === "connection") return s.pump ? "via a lift" : "";
  const pump = s.pump ? " · pump" : "";
  if (!s.need) return `${s.fresh} tiles${pump}`;
  return (s.need.agents > 0 ? `Cools ${s.need.cooled} of ${s.need.agents}` : `${Math.round(s.need.share * 100)}%`) + pump;
}

export function SuggestCard() {
  const stroke = useWorldStore((s) => s.stroke);
  const playing = useWorldStore((s) => s.playing);
  useWorldStore((s) => s.revision);
  // ONLY AT THE START of a run laid by clicks: once a corner is pinned, the player is drawing their own.
  if (!playing || !stroke || stroke.path || stroke.pins?.length !== 1 || (stroke.tool !== "pipe" && stroke.tool !== "sewer")) return null;
  const st = useWorldStore.getState(), g = st.grid;
  const list = suggestionsKept(g, st.getWaterField(), stroke.pins[0], mainWet(g));
  // A sewer's are offered to the Sewer tool, a main's to Pipe.
  const mine = list.filter((s) => (s.kind === "main") === (stroke.tool === "pipe" && !stroke.sewer));
  if (!mine.length) return null;
  return (
    <div className={`${CARD} flex min-w-56 flex-col gap-0.5`}>
      {mine.map((s) => (
        <p key={s.why} className="flex items-center justify-between gap-2 tabular-nums">
          <b title={TIP[s.why]}>{s.kind === "connection" && s.why === "no-pump" ? "No lift" : WHY[s.why]}</b>
          <span className="flex-1 text-fg-muted">{brings(s)}</span>
          <Button size="sm" onClick={() => st.laySuggestion(s.stroke)} title="Lay this route">{formatCurrency(s.price)}</Button>
        </p>
      ))}
    </div>
  );
}
