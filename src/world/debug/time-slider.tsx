/**
 * World v2 editor — THE YEAR AND THE HOUR, to look at: two sliders along the top of the map. Dragging one holds the
 * map at that day of the year or that time of day — the crops, the snow, the trees' leaves, the farms' drones, the
 * night — and the clock button lets it run again. Only looked at: nothing grows, is cut or is saved by it.
 * @see useCalendarStore.held, useCalendarStore.hour
 */
import { IconClock } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { useCalendarStore } from "../../state/calendar.store";
import { SEASONS, yearPart } from "../calendar";
import { dayPhase } from "../daylight";
import { SUN_HOME_ANGLE, SUN_HOME_HEIGHT, setSunAround } from "../light";

/** The months, from the first of spring. */
const MONTHS = ["Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb"];
/** Days to a month, as the slider tells them. */
const MONTH_DAYS = 30;

const dateOf = (y: number) => {
  const m = Math.min(11, Math.floor(y * 12));
  const d = Math.min(MONTH_DAYS, Math.floor((y * 12 - m) * MONTH_DAYS) + 1);
  return `${d} ${MONTHS[m]}`;
};
const seasonName = (y: number) => { const s = SEASONS[Math.min(3, Math.floor(y * 4))]; return s[0].toUpperCase() + s.slice(1); };
const clockOf = (p: number) => {
  const mins = Math.floor(p * 24 * 60) % (24 * 60);
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
};

export function TimeSlider() {
  const held = useCalendarStore((s) => s.held), hour = useCalendarStore((s) => s.hour), look = useCalendarStore((s) => s.look);
  // (The clock's, while nothing is held: read again each second.)
  const [now, setNow] = useState(() => ({ t: useCalendarStore.getState().real(), p: dayPhase(Date.now()) }));
  useEffect(() => {
    const id = setInterval(() => setNow({ t: useCalendarStore.getState().real(), p: dayPhase(Date.now()) }), 1000);
    return () => clearInterval(id);
  }, []);
  // THE SUN'S BEARING round the map, degrees; null where it always stands. @see setSunAround
  const [sun, setSun] = useState<{ bearing: number; height: number } | null>(null);
  const turnSun = (to: { bearing: number; height: number } | null) => { setSun(to); setSunAround(to && (to.bearing * Math.PI) / 180, to && to.height); };
  // (Leaving the editor: the clock's again, and the sun home.)
  useEffect(() => () => { useCalendarStore.getState().look(null, null); setSunAround(null); }, []);

  const year = yearPart(held ?? now.t), phase = hour ?? now.p, live = held === null && hour === null && sun === null;
  const bearing = sun?.bearing ?? Math.round(((SUN_HOME_ANGLE * 180) / Math.PI + 360) % 360), height = sun?.height ?? SUN_HOME_HEIGHT;
  const setYear = (y: number) => look(Math.floor(now.t) + y, hour);
  const setHour = (p: number) => look(held, p);

  return (
    <div className="absolute right-2 top-2 z-10 w-[24rem] max-w-[calc(100%-23rem)] rounded border border-line
      bg-surface-1/85 px-2.5 py-1.5 font-mono text-[11px] leading-tight text-fg shadow-sm">
      <div className="flex items-center gap-2">
        <span className="w-24 shrink-0 truncate" title={seasonName(year)}>{dateOf(year)} <span className="text-fg-muted">{seasonName(year)}</span></span>
        <input type="range" min={0} max={0.9999} step={1 / 360} value={year} aria-label="Day of the year"
          onChange={(e) => setYear(Number(e.target.value))}
          className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--ui-accent)]" />
        <button type="button" title="Run with the clock" aria-label="Run with the clock" aria-pressed={live} onClick={() => { look(null, null); turnSun(null); }}
          className={`shrink-0 rounded p-0.5 ${live ? "text-accent" : "text-fg-muted hover:text-fg"}`}>
          <IconClock size={14} />
        </button>
      </div>
      <div className="mt-0.5 flex pl-[6.5rem] pr-6 text-[9px] text-fg-muted">
        {MONTHS.map((m) => <span key={m} className="flex-1 text-center">{m[0]}</span>)}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="w-24 shrink-0">{clockOf(phase)}</span>
        <input type="range" min={0} max={0.9999} step={1 / 96} value={phase} aria-label="Time of day"
          onChange={(e) => setHour(Number(e.target.value))}
          className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--ui-accent)]" />
        <span className="w-[18px] shrink-0" />
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="w-24 shrink-0" title="Bearing, height">Sun {bearing}° <span className="text-fg-muted">{height}°</span></span>
        <input type="range" min={0} max={359} step={1} value={bearing} aria-label="Sun bearing"
          onChange={(e) => turnSun({ bearing: Number(e.target.value), height })}
          className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--ui-accent)]" />
        <input type="range" min={8} max={80} step={1} value={height} aria-label="Sun height"
          onChange={(e) => turnSun({ bearing, height: Number(e.target.value) })}
          className="h-1 w-16 shrink-0 cursor-pointer accent-[var(--ui-accent)]" />
      </div>
    </div>
  );
}
