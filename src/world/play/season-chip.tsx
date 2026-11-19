import { IconLeaf, IconPlant, IconSnowflake, IconSun } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { useCalendarStore } from "../../state/calendar.store";
import { dayOf, seasonOf, yearOf, type Season } from "../calendar";
import { groundMode } from "../render/ground-mode";

const ICON: Record<Season, typeof IconSun> = { spring: IconPlant, summer: IconSun, autumn: IconLeaf, winter: IconSnowflake };
const NAME: Record<Season, string> = { spring: "Spring", summer: "Summer", autumn: "Autumn", winter: "Winter" };

/**
 * THE SEASON AND THE DAY, top right of the map: the year's on the continuous surface, where it shows; the year
 * itself in its tooltip. Read once a second. @see world/calendar
 */
export function SeasonChip({ className = "" }: { className?: string }) {
  const at = useCalendarStore((s) => s.at);
  const [t, setT] = useState(() => useCalendarStore.getState().now());
  useEffect(() => {
    setT(useCalendarStore.getState().now());
    if (at === null) return;
    const id = setInterval(() => setT(useCalendarStore.getState().now()), 1000);
    return () => clearInterval(id);
  }, [at]);
  if (groundMode() !== "smooth") return null;
  const s = seasonOf(t), Icon = ICON[s];
  return (
    <div title={`Year ${yearOf(t)}`} aria-label="Season"
      className={`pointer-events-auto flex items-center gap-1 border border-line-quiet bg-surface-3/80 px-1.5 py-0.5 font-mono text-xs tabular-nums text-fg ${className}`}>
      <Icon className="h-3.5 w-3.5" stroke={1.6} />
      {NAME[s]} {dayOf(t)}
    </div>
  );
}
