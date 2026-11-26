/**
 * THE STILL: the vape shop. A flask of juice, and a tree of vessels under it, one an upgrade: hold a valve and juice
 * runs down into its vessel; full, its bonus is on. A vessel's juice may be drained back.
 *
 * The store's whole juice is what there is; the liquid only follows it. @see still-gpu, plans/vape-juice.md
 */
import { IconArrowBackUp, IconDropletFilled, IconLock } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";

import { JUICE_BRANCHES, JUICE_TREE, drainBlock, isFull, juicePlace, pourBlock, type JuiceFills, type JuiceShopUpgradeDef } from "../../game/achievements.juice-shop";
import { STATS, change } from "../../game/wording";
import { report } from "../../state/comms.store";
import { useThemeStore } from "../../state/theme.store";
import { useVapeAchievementsStore } from "../../state/vape-achievements.store";
import { FOCUS, Num, Panel } from "../../ui/console";
import { openDevice } from "../../world/render/device";
import { FLASK, H, VESSELS, W } from "./glassware";
import { createStill, type Amounts, type Still } from "./still-gpu";

const at = (x: number, y: number) => ({ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` });
const n0 = (v: number) => Math.floor(v).toLocaleString("en-US");

/** An upgrade's bonus on its own, "+8%". */
const bonus = (u: JuiceShopUpgradeDef) => (u.hireCostReduction ? change("hires", 1 - u.hireCostReduction) : change("money", 1 + (u.mpsBonus ?? u.innovationBonus ?? u.valuationBonus ?? u.equityBonus ?? 0)));
/** What a branch's full vessels come to. */
function total(fills: JuiceFills, branch: (typeof JUICE_BRANCHES)[number]): string {
  const of = JUICE_TREE[branch].filter((u) => isFull(fills, u)).reduce((s, u) => s + (u.mpsBonus ?? u.innovationBonus ?? u.valuationBonus ?? u.equityBonus ?? u.hireCostReduction ?? 0), 0);
  if (of === 0) return "—";
  return branch === "hires" ? `−${Math.round(of * 100)}%` : `+${Math.round(of * 100)}%`;
}

/** A vessel fills in this long, its valve held, seconds; and at least so much a second. */
const FILLS_IN = 6, SLOWEST = 20, TICK = 100;
const rateFor = (cost: number) => Math.max(SLOWEST, Math.round(cost / FILLS_IN));

type Flow = { id: string; way: "pour" | "drain" };

/** Juice on the move while a valve is held: so much each tick, until it is full, empty or shut off. */
function useFlow() {
  const [flow, setFlow] = useState<Flow | null>(null);
  useEffect(() => {
    if (!flow) return;
    const u = juicePlace(flow.id)!.def;
    let owed = 0, last = performance.now();
    const go = () => {
      const t = performance.now();
      owed += rateFor(u.cost) * Math.min(0.5, (t - last) / 1000); last = t;
      const whole = Math.floor(owed), store = useVapeAchievementsStore.getState();
      if (whole < 1) return;
      owed -= whole;
      const moved = flow.way === "pour" ? store.pourJuice(u.id, whole) : store.drainJuice(u.id, whole);
      const full = flow.way === "pour" && isFull(useVapeAchievementsStore.getState().juiceFills, u);
      if (full) report(`${u.name} full`);
      if (full || moved < whole) setFlow(null);
    };
    const timer = setInterval(go, TICK);
    return () => clearInterval(timer);
  }, [flow]);
  return [flow, setFlow] as const;
}

/** A control held down to run. */
function Hold({ label, on, disabled, className, style, children, set }: { label: string; on: boolean; disabled?: boolean; className?: string; style?: React.CSSProperties; children: React.ReactNode; set: (on: boolean) => void }) {
  return (
    <button type="button" aria-label={label} aria-pressed={on} disabled={disabled} style={style}
      onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); set(true); }}
      onPointerUp={() => set(false)} onPointerCancel={() => set(false)} onLostPointerCapture={() => set(false)} onBlur={() => set(false)} onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); set(true); } }}
      onKeyUp={() => set(false)}
      className={twMerge("cursor-pointer touch-none select-none disabled:cursor-not-allowed", FOCUS, className)}>
      {children}
    </button>
  );
}

export function StillPanel() {
  const canvas = useRef<HTMLCanvasElement>(null), still = useRef<Still | null>(null), last = useRef<{ x: number; y: number; t: number } | null>(null);
  const theme = useThemeStore((s) => s.theme);
  const juice = useVapeAchievementsStore((s) => s.vapeJuice).toNumber();
  const fills = useVapeAchievementsStore((s) => s.juiceFills);
  const [flow, setFlow] = useFlow();
  const [picked, setPicked] = useState<string | null>(null);

  const amounts = useMemo((): Amounts => ({
    flask: juice,
    shares: VESSELS.map((v) => Math.min(1, (fills[v.id] ?? 0) / v.cost)),
    locked: VESSELS.map((v) => pourBlock(fills, v.id) === "above" && !fills[v.id]),
  }), [juice, fills]);
  const latest = useRef(amounts);
  useEffect(() => { latest.current = amounts; still.current?.set(amounts); }, [amounts]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let gone = false, seen: ResizeObserver | null = null;
    void openDevice().then((gpu) => {
      if (gone || !gpu) return;
      const s = createStill(gpu.device, el, latest.current);
      if (!s) return;
      still.current = s;
      s.theme(document.documentElement.classList.contains("dark"));
      seen = new ResizeObserver(() => { const k = Math.min(1.5, window.devicePixelRatio); s.size(Math.max(1, Math.round(el.clientWidth * k)), Math.max(1, Math.round(el.clientHeight * k))); });
      seen.observe(el);
      if (import.meta.env.DEV) (window as unknown as { __still?: Still }).__still = s;
    });
    return () => { gone = true; seen?.disconnect(); still.current?.destroy(); still.current = null; };
  }, []);
  useEffect(() => { still.current?.theme(document.documentElement.classList.contains("dark")); }, [theme]);

  const rate = flow ? rateFor(juicePlace(flow.id)!.def.cost) : 0;
  const hold = (id: string, way: Flow["way"]) => (on: boolean) => setFlow((was) => (on ? { id, way } : was?.id === id && was.way === way ? null : was));
  const canPour = (id: string) => juice >= 1 && pourBlock(fills, id) === null;

  const place = picked ? juicePlace(picked) : null;

  return (
    <Panel title="Vape shop" tone="juice" controls={<Num role="juice" className="font-display text-sm">{n0(juice)} <span className="text-[10px] text-fg-muted">juice</span></Num>}>
      <div className="relative mx-auto w-full max-w-[36rem]" style={{ aspectRatio: `${W} / ${H}` }}>
        <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
        {/* THE FLASK: what there is, and how fast it goes. Stirred by the pointer. */}
        <div style={{ ...at(FLASK.at[0], FLASK.at[1]), width: `${(FLASK.r * 2 * 100) / W}%` }} className="absolute grid aspect-square -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full"
          onPointerMove={(e) => {
            const r = canvas.current!.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H, was = last.current;
            const t = performance.now();
            if (was && t > was.t && t - was.t < 200) { const k = 5 / (t - was.t), lim = (v: number) => Math.max(-2, Math.min(2, v)); still.current?.stir(x, y, lim((x - was.x) * k), lim((y - was.y) * k)); }
            last.current = { x, y, t };
          }}>
          <div className="pointer-events-none flex flex-col items-center">
            <span className="font-display text-2xl tabular-nums text-fg dark:text-white">{n0(juice)}</span>
            <span className={twMerge("text-xs tabular-nums text-fg dark:text-white", !flow && "invisible")}>{flow?.way === "drain" ? "+" : "−"}{n0(rate)}/s</span>
          </div>
        </div>
        {/* THE BRANCHES: what each comes to. */}
        {JUICE_BRANCHES.map((b, col) => (
          <div key={b} style={{ ...at(16 + col * 32, 101.5), width: "19%" }} className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center border border-line-quiet bg-surface-2 py-0.5 text-[10px] leading-tight dark:bg-surface-2">
            <span className="text-fg-muted">{STATS[b].name}</span>
            <span className="tabular-nums text-fg">{total(fills, b)}</span>
          </div>
        ))}
        {VESSELS.map((v) => {
          const u = juicePlace(v.id)!.def, has = fills[v.id] ?? 0, full = has >= v.cost, locked = pourBlock(fills, v.id) === "above" && !has;
          const on = flow?.id === v.id, wet = has / v.cost > 0.45;
          return (
            <div key={v.id}>
              <button type="button" aria-label={`${u.name}, ${u.description}, ${has} of ${v.cost} juice`} aria-pressed={picked === v.id} onClick={() => setPicked(picked === v.id ? null : v.id)}
                style={{ ...at(v.at[0], v.at[1]), width: `${(28 / W) * 100}%`, height: `${(25 / H) * 100}%` }}
                className={twMerge("absolute flex -translate-x-1/2 -translate-y-1/2 cursor-pointer flex-col items-center justify-center rounded-lg border border-transparent leading-tight hover:border-juice-line", FOCUS, picked === v.id && "border-juice-line",
                  wet ? "text-white dark:text-white" : "text-fg dark:text-fg", locked && "opacity-60")}>
                <span className="text-[13px] font-bold tabular-nums">{bonus(u)}</span>
                <span className="text-[10px] tabular-nums">{full ? n0(v.cost) : has > 0 ? `${n0(has)}/${n0(v.cost)}` : n0(v.cost)}</span>
              </button>
              {!full && (
                <Hold label={`Pour into ${u.name}`} on={on && flow.way === "pour"} disabled={!canPour(v.id)} set={hold(v.id, "pour")}
                  style={at(v.at[0], v.row === 0 ? 113 : Math.max(v.gate[1] + 3.5, v.at[1] - v.r - 5))}
                  className={twMerge("absolute grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-juice-line bg-surface-2 text-juice transition-transform disabled:size-5 disabled:border-line-quiet disabled:text-fg-faint disabled:shadow-none dark:bg-surface-1", on && flow.way === "pour" && "scale-110 bg-juice-soft dark:bg-juice-soft")}>
                  {locked ? <IconLock size={11} /> : <IconDropletFilled size={14} />}
                </Hold>
              )}
              {on && (
                <span style={at(v.at[0] + (v.col === 4 ? -6.5 : 6.5), v.row === 0 ? 113 : Math.max(v.gate[1] + 3.5, v.at[1] - v.r - 5))} className={twMerge("pointer-events-none absolute z-10 -translate-y-1/2 border border-juice-line bg-surface-2 px-1 text-[10px] tabular-nums text-juice dark:bg-surface-2", v.col === 4 && "-translate-x-full")}>{flow.way === "drain" ? "−" : "+"}{n0(rate)}/s</span>
              )}
            </div>
          );
        })}
      </div>
      {/* THE ONE PICKED: what it does, what it holds, and its two valves. */}
      {place && (
        <div className="sticky bottom-0 z-10 mt-2 flex flex-col gap-2 border border-juice-line bg-surface-3 p-2.5 text-xs dark:bg-surface-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-display uppercase tracking-widest">{place.def.name}</span>
            <span className="tabular-nums text-juice">{n0(fills[place.def.id] ?? 0)} / {n0(place.def.cost)}</span>
          </div>
<div className="h-1 bg-surface-1 dark:bg-surface-1"><div className="h-full bg-juice dark:bg-juice" style={{ width: `${((fills[place.def.id] ?? 0) / place.def.cost) * 100}%` }} /></div>
          <div className="flex items-center justify-between gap-3">
            <span className={isFull(fills, place.def) ? "text-good" : "text-fg-muted"}>{place.def.description}</span>
            <span className="flex gap-1.5">
              <Hold label={`Drain ${place.def.name}`} on={flow?.id === place.def.id && flow.way === "drain"} disabled={drainBlock(fills, place.def.id) !== null} set={hold(place.def.id, "drain")}
                className="flex items-center gap-1 border border-line px-2 py-1 disabled:opacity-40"><IconArrowBackUp size={13} />Hold to drain</Hold>
              <Hold label={`Pour into ${place.def.name} (valve)`} on={flow?.id === place.def.id && flow.way === "pour"} disabled={!canPour(place.def.id)} set={hold(place.def.id, "pour")}
                className="flex items-center gap-1 border border-juice-line bg-juice-soft px-2 py-1 text-juice disabled:opacity-40 dark:bg-juice-soft"><IconDropletFilled size={13} />Hold to pour</Hold>
            </span>
          </div>
          {pourBlock(fills, place.def.id) === "above" && <span className="text-fg-muted">Fill {place.above!.name} first</span>}
          {drainBlock(fills, place.def.id) === "below" && <span className="text-fg-muted">Drain {[...place.below].reverse().find((u) => fills[u.id] > 0)!.name} first to drain this</span>}
        </div>
      )}
    </Panel>
  );
}
