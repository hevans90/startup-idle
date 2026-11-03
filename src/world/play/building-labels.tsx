/**
 * World v2 — WHAT THE BUILDINGS ON THE COMPANY'S MAP SAY, and only when it is
 * worth saying. Three things over the canvas:
 *  - a BADGE, an icon and a few characters coloured by how things stand, on
 *    a building with a problem — or, in the Water and Mood views and with the
 *    Build tool, on those the view is about; @see badgeFor
 *  - a faint DOT on everything else close in, so the town is still seen;
 *  - the FULL LABEL of the building under the pointer: what it is and how it
 *    is doing, everything. @see infoFor
 *
 * HTML over the canvas rather than text in it: crisp at every zoom, styled
 * like the rest of the game, light and dark. Each sits at the top middle of
 * what its building DREW, so a tower's is over the tower, not over the
 * ground it stands on. @see drawnTop
 *
 * NEVER ONE OVER ANOTHER: where two badges would meet, the worse is kept and
 * counts the other, "+1". The pointer tells the rest. @see placeBadges
 *
 * THREE SPEEDS:
 *  - what they say, once a second, and whenever the view or the pointer's
 *    building changes;
 *  - where they go, then too, and whenever the camera settles somewhere new;
 *  - where they are, every frame, from points kept in the WORLD, so a pan
 *    moves them without measuring a building again.
 */
import { useEffect, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";
import {
  IconAlertTriangle, IconBarrierBlock, IconBed, IconBoltOff, IconBuildingFactory2, IconDesk, IconDroplet,
  IconHomeExclamation, IconMoodSad, IconMoodSmile, IconPlayerPause, IconRecycle, IconRoadOff, IconZzz,
} from "@tabler/icons-react";

import { attendance } from "../../game/projects";
import { useGeneratorStore, type GeneratorId } from "../../state/generators.store";
import { getArrivals, getExports, getFleet, getNetwork, getTraffic, getWorks, useWorldStore } from "../../state/world.store";
import { formatCurrency } from "../../utils/money-utils";
import { perMinute } from "../boats/exports";
import { liveSeating } from "../agents/commute";
import { liveCoverage } from "../agents/services";
import { useSessionStore } from "../../state/session.store";
import { ROUTE_BONUS } from "../events/events";
import { repairedIn } from "../events/flood";
import { liveLeadership } from "../agents/leaders";
import { deskPerks } from "../agents/desk-perks";
import { conferenceNear } from "../events/convoy";
import { structureDef } from "../structures/def";
import { workplaceKind } from "../agents/commute";
import { useTeamLeadersEmployeesStore } from "../../state/team-leaders.store";
import { liveMoods } from "../agents/mood";
import { nearHub } from "../projects/labs";
import { powered as rackPowered } from "../projects/racks";
import { housedBy, residentsIn } from "../../game/housing";
import { drawnTop, shownStructures, type StructureLayer } from "../structures/layer";
import type { Structure } from "../grid";
import type { Viewport } from "pixi-viewport";
import { infoFor, type BuildingInfo } from "./building-info";
import { Glitch, Text } from "../../ui/console";
import { liveTownProblems } from "./town-problems";
import { badgeFor, placeBadges, type Badge, type BadgeContext, type BadgeIcon, type BadgeView } from "./badges";

/** Below this zoom, no dots: a town seen whole is its buildings. */
export const DOTS_FROM = 0.45;
/** With the Build tool, badges on buildings this many tiles from the pointer. */
const BUILD_REACH = 12;
/**
 * How often what the badges say, and where they go, is worked out again, ms.
 * A pan or zoom places them again at once (`frame`), so this is only for what
 * they say — tanks, moods — which a second keeps up with; on a big town a read
 * is a dozen milliseconds, and two and a half a second was a hitch each.
 */
const READ_EVERY = 1000;
/** How long the camera holds still before the badges are placed again for where it went, ms. */
const SETTLE_MS = 120;
/** A change of zoom by more than this share places them again. */
const REZOOM = 0.04;
/** And a pan by more than this many screen pixels. */
const REPAN = 160;
/** How far off the screen, px, a building's badge is still placed. */
const OFF = 300;

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

/** What the live game says, gathered once for every badge and the label. */
function gather(): BadgeContext {
  const gens = useGeneratorStore.getState();
  const perHead: BadgeContext["perHead"] = {};
  for (const g of gens.generators) {
    const id = g.id as GeneratorId;
    if (g.amount <= 0) continue;
    // What the whole kind makes, over the ones at their desks.
    const at = attendance(id, g.amount);
    const all = gens.getGeneratorMoneyPerSecond(id, g.amount);
    perHead[id] = at > 0 ? all / (g.amount * at) : all / g.amount;
  }
  const arriving = new Map<number, number>();
  for (const r of getArrivals().rides.values()) {
    for (const d of r.drops) arriving.set(d.structure, (arriving.get(d.structure) ?? 0) + d.n);
  }
  // Alongside is at a berth and tied up; a boat held off the port waiting
  // for one is moored too, but it is waiting.
  const alongside = new Map<number, number>();
  for (const b of getFleet().boats) {
    const port = b.route?.[0];
    if (port !== undefined && b.berth !== undefined && (b.dockLeft ?? 0) > 0) alongside.set(port, (alongside.get(port) ?? 0) + 1);
  }
  const queued = new Map<number, number>();
  for (const [id, q] of getTraffic().queues) {
    const waiting = q.length - (alongside.get(id) ?? 0);
    if (waiting > 0) queued.set(id, waiting);
  }
  const stalled = new Set<number>();
  for (const [id, t] of getWorks().stalled) if (t > 0) stalled.add(id);
  const now = performance.now(), ex = getExports();
  const earning = new Map<number, number>();
  for (const id of ex.recent.keys()) earning.set(id, perMinute(ex, id, now));
  const st = useWorldStore.getState(), net = getNetwork();
  const residents = new Map<number, number>();
  for (const s of st.grid.structures.values()) if (housedBy(s.def)) residents.set(s.id, residentsIn(s));
  const seating = net ? liveSeating(st.grid, net) : null;
  const commutes = seating?.commutes ?? new Map();
  const desks = seating?.desks;
  // WHO HAS NO DESK, by kind: a full workplace is only a problem then. @see problemOf
  const deskless: Partial<Record<GeneratorId, number>> = {};
  for (const [id, c] of commutes) {
    const h = housedBy(st.grid.structures.get(id)?.def ?? "");
    if (h && c.deskless > 0) deskless[h.id] = (deskless[h.id] ?? 0) + c.deskless;
  }
  const coverage = net ? liveCoverage(st.grid, net) : new Map();
  const moods = net ? liveMoods(st.grid, net) : new Map();
  const labsNear = new Set([...st.grid.structures.values()].filter((s) => s.def === "lab" && nearHub(st.grid, s)).map((s) => s.id));
  const racksPowered = new Set([...st.grid.structures.values()].filter((s) => s.def === "rack" && rackPowered(st.grid, s)).map((s) => s.id));
  // WHAT EACH WORKPLACE'S DESKS GET: a leader, a café next door. @see deskPerks
  const lead = net ? liveLeadership(st.grid, net, useTeamLeadersEmployeesStore.getState().employees, moods) : null;
  const perks = new Map<number, string[]>();
  if (lead) {
    for (const s of st.grid.structures.values()) {
      if (s.build || !workplaceKind(s.def)) continue;
      const { why } = deskPerks(st.grid, lead, s);
      if (why.length) perks.set(s.id, why);
    }
  }
  const nearConference = new Set([...st.grid.structures.values()].filter((s) => structureDef(s.def)?.port && conferenceNear(st.grid, s)).map((s) => s.id));
  return { quiet: liveTownProblems().quiet, deskless, perks, nearConference, perHead, arriving, alongside, queued, stalled, earning, residents, commutes, coverage, moods, labsNear, racksPowered, desks, repairedIn, routeBonus: ROUTE_BONUS * (useSessionStore.getState().routes ?? 0), money: (n) => formatCurrency(n) };
}

/**
 * WHERE A BUILDING'S LABEL GOES, on the screen: the top of what is drawn of
 * it. Measured once in the world and kept, keyed on what changes the drawing
 * — and only projected after that. Measuring is a `getBounds` on every
 * sprite of the building, and on a big town doing it for every one at every
 * look held the page for half a second. @see drawnTop
 */
const tops = new WeakMap<object, { key: string; x: number; y: number }>();
function topOf(sl: StructureLayer, s: Structure, vp: Viewport): { x: number; y: number } | null {
  const handle = sl.mounted.get(s.id)?.handle;
  if (!handle) return null;
  const key = `${s.def}:${s.residents ?? "-"}:${s.build ? Math.floor((s.build.done / s.build.need) * 20) : "done"}`;
  let at = tops.get(handle);
  if (!at || at.key !== key) {
    const screen = drawnTop(sl, s.id);
    if (!screen) return null;
    const w = vp.toWorld(screen.x, screen.y);
    at = { key, x: w.x, y: w.y };
    tops.set(handle, at);
  }
  return vp.toScreen(at.x, at.y);
}

/** Each badge's look: its icon, and its colours by tone. */
const ICON: Record<BadgeIcon, typeof IconDroplet> = {
  spill: IconAlertTriangle, slop: IconRecycle, mood: IconMoodSad, stalled: IconBarrierBlock, paused: IconPlayerPause,
  damage: IconHomeExclamation, cool: IconDroplet, power: IconBoltOff, desk: IconDesk, idle: IconZzz, road: IconRoadOff,
  busy: IconBuildingFactory2, bed: IconBed,
};
const TONE_CLASS: Record<Badge["tone"], string> = {
  bad: "border-bad-line bg-bad-soft text-bad",
  warn: "border-warn-line bg-warn-soft text-warn",
  ok: "border-good-line bg-good-soft text-good",
  info: "border-info-line bg-info-soft text-info",
};

/** One thing over the map: a badge or a dot. */
type Mark =
  | { key: string; kind: "badge"; badge: Badge; more: number }
  | { key: string; kind: "dot" };

/** The pointer's building's full label: what it says, and its point in the world. */
type Label = { id: number; info: BuildingInfo; x: number; y: number };

/** Seconds each redacted reading holds before the next deciphers in. */
const LEAK_EVERY = 2.2;
/** THE AI'S OWN, REDACTED: one reading after another, each deciphered in. @see BuildingInfo.leaks */
function Leaks({ leaks }: { leaks: readonly string[] }) {
  const [at, setAt] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setAt((n) => (n + 1) % leaks.length), LEAK_EVERY * 1000);
    return () => window.clearInterval(id);
  }, [leaks]);
  return <Text as="p" mode="decipher" text={leaks[at]} className="text-ai/70 italic" />;
}

/** Where a mark goes on the screen, as a transform, from its point in the world. */
const placed = (vp: Viewport, w: { x: number; y: number }, dot: boolean) => {
  const p = vp.toScreen(w.x, w.y);
  return `translate(${Math.round(p.x)}px, ${Math.round(p.y - (dot ? 0 : 4))}px) translate(-50%, ${dot ? "-50%" : "-100%"})`;
};

export function BuildingLabels({ className }: { className?: string }) {
  const on = useWorldStore((s) => s.labels);
  const grid = useWorldStore((s) => s.grid);
  // WHAT THE PLAYER IS LOOKING AT, and so what the badges are about. @see badgeFor
  const view = useWorldStore((s): BadgeView =>
    !s.playing ? "rest" : s.waterOverlay || s.tool === "pipe" ? "water" : s.moodOverlay ? "mood" : s.tool === "placeStructure" ? "build" : "rest");
  const hovered = useWorldStore((s) => s.hoverBuilding);
  const [marks, setMarks] = useState<Mark[]>([]);
  const els = useRef(new Map<string, HTMLDivElement>());
  /** Each mark's point in the world, and the zoom they were placed at. */
  const anchors = useRef(new Map<string, { x: number; y: number }>());
  const placedAt = useRef(0);
  /** What the last look gathered: the pointer's label is made from it at once, not from a look of its own. */
  const ctxRef = useRef<BadgeContext | null>(null);
  const [label, setLabel] = useState<Label | null>(null);
  const labelRef = useRef<Label | null>(null);
  labelRef.current = label;
  const labelEl = useRef<HTMLDivElement | null>(null);
  const placedCentre = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!on) return;
    /** WHAT THEY SAY, AND WHERE THEY GO, from where each building stands now. */
    const read = () => {
      const st = useWorldStore.getState();
      const vp = st.viewport, sl = shownStructures();
      if (!vp || !sl) return;
      const ctx = gather();
      ctxRef.current = ctx;
      const scale = vp.scale.x;
      const dots = scale >= DOTS_FROM;
      const near = view === "build" ? st.hover : null;
      const items: { id: number; x: number; y: number; band: number; badge: Badge }[] = [];
      const next = new Map<string, { x: number; y: number }>();
      const list: Mark[] = [];
      // Kept in the world, so a pan needs only to project it.
      const keep = (key: string, at: { x: number; y: number }) => { const w = vp.toWorld(at.x, at.y); next.set(key, { x: w.x, y: w.y }); };
      for (const s of st.grid.structures.values()) {
        const top = topOf(sl, s, vp);
        if (!top) continue;
        // ON THE SCREEN, or near it: a mark nobody can see is not worth a node
        // in the page. A pan places them again. @see frame
        if (top.x < -OFF || top.y < -OFF || top.x > vp.screenWidth + OFF || top.y > vp.screenHeight + OFF) continue;
        const far = view === "build" && (!near || Math.abs(s.x - near.x) > BUILD_REACH || Math.abs(s.y - near.y) > BUILD_REACH);
        // THE WATER VIEW zoomed out: its rings and numbers say it, and badges would sit on them.
        const badge = far || (view === "water" && !dots) ? null : badgeFor(s, ctx, view);
        if (badge) items.push({ id: s.id, x: top.x, y: top.y, band: s.x + s.w + s.y + s.h, badge });
        else if (dots && infoFor(s, ctx)) { keep(`d${s.id}`, top); list.push({ key: `d${s.id}`, kind: "dot" }); }
      }
      for (const b of placeBadges(items)) {
        keep(`b${b.id}`, b);
        list.push({ key: `b${b.id}`, kind: "badge", badge: b.badge, more: b.more });
      }
      anchors.current = next;
      // And the pointer's label, said again from what was just gathered.
      setLabel(labelFor(useWorldStore.getState().hoverBuilding));
      placedAt.current = scale;
      placedCentre.current = { x: vp.center.x, y: vp.center.y };
      setMarks(list);
    };
    read();
    const id = setInterval(read, READ_EVERY);

    /**
     * WHERE THEY ARE, every frame; and placed again at once on a zoom. Only
     * WRITTEN when they move: a still camera and the same marks is no work at
     * all, and a mark whose place rounds to the same pixel is not touched —
     * each write to a style is the browser's to lay out again.
     */
    let raf = 0;
    let seen = "", seenAnchors: unknown = null;
    let lastView = { x: NaN, y: NaN, s: NaN }, stillSince = 0;
    const wrote = new WeakMap<HTMLElement, string>();
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const vp = useWorldStore.getState().viewport;
      if (!vp) return;
      // A ZOOM, or a pan far enough to bring others on: placed again once the
      // camera SETTLES — not mid-move, where a read a frame was a third of a
      // frame's budget on a big town. Kept in the world, they follow the
      // camera meanwhile. @see SETTLE_MS
      const c = placedCentre.current;
      const panned = c ? Math.hypot(vp.center.x - c.x, vp.center.y - c.y) * vp.scale.x > REPAN : false;
      const moving = vp.x !== lastView.x || vp.y !== lastView.y || vp.scale.x !== lastView.s;
      if (moving) { lastView = { x: vp.x, y: vp.y, s: vp.scale.x }; stillSince = performance.now(); }
      if ((Math.abs(vp.scale.x / (placedAt.current || 1) - 1) > REZOOM || panned) && performance.now() - stillSince >= SETTLE_MS) read();
      const where = `${vp.x},${vp.y},${vp.scale.x},${els.current.size}`;
      // The pointer's label follows the camera too.
      const l = labelRef.current, le = labelEl.current;
      if (l && le) {
        const t = placed(vp, l, false);
        if (wrote.get(le) !== t) { wrote.set(le, t); le.style.transform = t; }
      }
      if (where === seen && anchors.current === seenAnchors) return;
      seen = where; seenAnchors = anchors.current;
      for (const [key, el] of els.current) {
        const w = anchors.current.get(key);
        const next = w ? placed(vp, w, key[0] === "d") : "hidden";
        if (wrote.get(el) === next) continue;
        wrote.set(el, next);
        if (next === "hidden") { el.style.visibility = "hidden"; continue; }
        el.style.visibility = "visible";
        el.style.transform = next;
      }
    };
    frame();
    return () => { clearInterval(id); cancelAnimationFrame(raf); };
  }, [on, grid, view]);

  /**
   * THE POINTER'S BUILDING, everything about it, the moment the pointer is on
   * it: made from what the last look gathered, one building's worth, and drawn
   * in place on its first paint — not waiting on a look at the whole town.
   */
  function labelFor(id: number | null): Label | null {
    const st = useWorldStore.getState(), vp = st.viewport, sl = shownStructures(), ctx = ctxRef.current;
    const s = id === null ? undefined : st.grid.structures.get(id);
    if (!s || !vp || !sl || !ctx) return null;
    const info = infoFor(s, ctx), top = topOf(sl, s, vp);
    if (!info || !top) return null;
    const w = vp.toWorld(top.x, top.y);
    return { id: s.id, info, x: w.x, y: w.y };
  }
  useEffect(() => { if (on) setLabel(labelFor(hovered)); }, [on, hovered]);

  if (!on) return null;
  const ref = (key: string) => (el: HTMLDivElement | null) => { if (el) els.current.set(key, el); else els.current.delete(key); };
  return (
    <>
    <div className={twMerge("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      {marks.map((m) => {
        // The pointer's building wears its full label instead.
        if (hovered !== null && m.key.slice(1) === String(hovered)) return null;
        if (m.kind === "dot") {
          return <div key={m.key} ref={ref(m.key)} className="invisible absolute left-0 top-0 size-1.5 rounded-full bg-fg-muted/50" />;
        }
        if (m.kind === "badge") {
          const Icon = m.badge.icon === "mood" && m.badge.tone === "ok" ? IconMoodSmile : ICON[m.badge.icon];
          return (
            <div key={m.key} ref={ref(m.key)}
              className={twMerge("invisible absolute left-0 top-0 flex items-center gap-1 whitespace-nowrap rounded-sm border px-1 py-0.5 text-[10px] leading-[12px] tabular-nums shadow-sm", TONE_CLASS[m.badge.tone])}>
              <Icon size={12} stroke={2} aria-hidden />
              <span>{m.badge.text}</span>
              {m.more > 0 && <span className="border-l border-current/30 pl-1 opacity-70">{m.more} more</span>}
            </div>
          );
        }
        return null;
      })}
    </div>
    {/* THE POINTER'S LABEL, a layer of its own over the map's docks and panels: nothing covers what is being looked at. */}
    <div className={twMerge("pointer-events-none absolute inset-0 z-30 overflow-hidden", className)}>
      {label && (() => {
        const { info } = label;
        const vp = useWorldStore.getState().viewport;
        return (
          <div ref={labelEl}
            className="absolute left-0 top-0 whitespace-nowrap border border-l-2 border-line-quiet bg-surface-2/95 px-1.5 py-0.5 text-[10px] leading-[13px] text-fg shadow-md backdrop-blur-sm"
            style={{ borderLeftColor: hex(info.accent), transform: vp ? placed(vp, label, false) : undefined }}>
            {info.leaks
              ? <Glitch key={label.id} arrive every={2.5} strength={0.8}>
                  <Text as="p" mode="decipher" text={info.title} className="font-display uppercase tracking-wider text-ai" />
                  <Leaks key={label.id} leaks={info.leaks} />
                </Glitch>
              : <p className="font-display uppercase tracking-wider">{info.title}</p>}
            {info.lines.map((l, k) => (
              <p key={k} className={twMerge(
                "whitespace-pre tabular-nums",
                l.tone === "good" && "text-good",
                l.tone === "warn" && "text-warn",
                l.tone === "dim" && "text-fg-muted",
              )}>{l.text}</p>
            ))}
          </div>
        );
      })()}
    </div>
    </>
  );
}
