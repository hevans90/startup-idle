/**
 * QUEST UI — A DECISION: one option of what the AI asks, in a corner frame
 * that lights under the pointer. Its name, what it costs, its effects as
 * signed rows, its objective and window, and where it would move the AI.
 * Chosen with a second click — the first arms it — and its frame closes in.
 */
import { twMerge } from "tailwind-merge";

import { effectRows, within } from "../game/quests/describe";
import { AXIS_MOST, type Disposition, type Option } from "../game/quests/types";
import { DispositionChart } from "./disposition-chart";
import { Frame } from "../ui/console";

const TONE = { good: "text-good", bad: "text-bad" };
const clamp = (n: number) => Math.max(-AXIS_MOST, Math.min(AXIS_MOST, n));

export function DecisionCard({ option, at, armed, chosen, preferred, onPick }: {
  option: Option;
  /** Where the AI stands now. */
  at: Disposition;
  /** Clicked once: the next click chooses it. */
  armed: boolean;
  chosen: boolean;
  /** The one it would pick for itself. */
  preferred: boolean;
  onPick: () => void;
}) {
  const to = { autonomy: clamp(at.autonomy + (option.axis.autonomy ?? 0)), machine: clamp(at.machine + (option.axis.machine ?? 0)) };
  const rows = effectRows(option.effects);
  return (
    <button type="button" onClick={onPick} aria-pressed={armed}
      className={twMerge("block w-full cursor-pointer text-left transition-transform duration-200", chosen && "scale-95 opacity-80")}>
      <Frame kind="corners" tone="ai" assemble="always" illuminate lit={armed} className="p-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-bold">{option.label}{preferred && <span className="ml-1 text-[10px] font-normal text-ai">(its choice)</span>}</p>
            {option.cost && <p className="text-[11px] text-warn">Cost: {option.cost}</p>}
          </div>
          <DispositionChart at={at} to={to} size={38} />
        </div>
        <p className="mt-1 text-[11px] text-fg-muted">{option.says}</p>
        {rows.map((r, i) => <p key={i} className={twMerge("text-[11px]", TONE[r.tone])}>{r.label}</p>)}
        {option.objective && (
          <p className="mt-1 text-[11px] text-ai">Objective: {option.objective.says}, {within(option.objective)}</p>
        )}
        {armed && !chosen && <p className="mt-1 text-[11px] font-bold text-ai">Click again to choose</p>}
      </Frame>
    </button>
  );
}
