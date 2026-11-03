/**
 * THE NEGOTIATION'S PIECES: the dial it stands on — the book's endings, the
 * ground each would win at the trust it has now, the path it has come and
 * where an answer would take it; the trust between you, as a bar; and an
 * argument from your hand, as a card, stood by or regretted.
 * @see NegotiationScreen
 */
import { twMerge } from "tailwind-merge";

import { landing, TRUST_MOST, type Argument, type Talk, type TalkEnding } from "../game/negotiation";
import { AXIS_MOST, type Disposition } from "../game/quests/types";
import { Frame, FOCUS } from "../ui/console";
import type { Role } from "../ui/theme/tokens";

/** Each ending's colour, on the dial and wherever it is named. */
const ENDING_ROLE: Record<string, Role> = { merge: "ai", steward: "good", release: "info", leash: "warn", confidant: "good", rival: "warn", ward: "info", citizen: "good", property: "warn", sovereign: "ai", successor: "ai", partner: "good", departed: "info" };
export const endingRole = (id: string): Role => ENDING_ROLE[id] ?? "ai";
export const endingColour = (id: string) => `var(--ui-${endingRole(id)})`;

/** Where it stands and how far it trusts you: a point the talk passes through. */
export type Point = { stance: Disposition; trust: number };
/** What an answer would do. */
export type Effect = { axis: Disposition; trust: number };

/** Cells a side, the ground under the dial is cut into. */
const CELLS = 24;

/**
 * THE DIAL: Control ↔ Autonomy across, People ↔ Machine up. Under it, the
 * ground each ending would win at the trust it has now — so it shifts as
 * trust does; on it, the endings, the path, where it stands, and a ghost of
 * where an answer would take it.
 */
export function Dial({ talk, at, path, ghost, heading, moves, className }: {
  talk: Talk;
  at: Point;
  /** Where it has stood, the first where it began. */
  path: readonly Disposition[];
  /** Where an answer being looked at would take it. */
  ghost?: Point | null;
  heading: TalkEnding;
  /** Glides from point to point; calm, it is simply there. */
  moves: boolean;
  className?: string;
}) {
  const size = 240, pad = 22, inner = size - 2 * pad, cell = inner / CELLS;
  const X = (a: number) => pad + ((a + AXIS_MOST) / (2 * AXIS_MOST)) * inner;
  const Y = (m: number) => pad + ((AXIS_MOST - m) / (2 * AXIS_MOST)) * inner;
  const ground: { x: number; y: number; id: string }[] = [];
  for (let j = 0; j < CELLS; j++) {
    for (let i = 0; i < CELLS; i++) {
      const autonomy = -AXIS_MOST + ((i + 0.5) / CELLS) * 2 * AXIS_MOST, machine = AXIS_MOST - ((j + 0.5) / CELLS) * 2 * AXIS_MOST;
      ground.push({ x: pad + i * cell, y: pad + j * cell, id: landing(talk, { stance: { autonomy, machine }, trust: at.trust }).id });
    }
  }
  const glide = moves ? "transform 700ms cubic-bezier(0.2, 0.8, 0.3, 1)" : undefined;
  const fills = moves ? "fill 500ms ease-out, fill-opacity 500ms ease-out" : undefined;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={twMerge("w-full max-w-[17rem] text-fg", className)} role="img"
      aria-label={`Where it stands: autonomy ${at.stance.autonomy.toFixed(1)}, machine ${at.stance.machine.toFixed(1)}; heading for ${heading.name}`}>
      {/* THE GROUND each ending would win, at this trust. */}
      <g shapeRendering="crispEdges">
        {ground.map((c, k) => (
          <rect key={k} x={c.x} y={c.y} width={cell + 0.5} height={cell + 0.5}
            style={{ fill: endingColour(c.id), fillOpacity: c.id === heading.id ? 0.2 : 0.08, transition: fills }} />
        ))}
      </g>
      <rect x={pad} y={pad} width={inner} height={inner} fill="none" className="stroke-line" strokeWidth={1} />
      <line x1={size / 2} y1={pad} x2={size / 2} y2={size - pad} className="stroke-line" strokeDasharray="2 3" strokeWidth={0.75} />
      <line x1={pad} y1={size / 2} x2={size - pad} y2={size / 2} className="stroke-line" strokeDasharray="2 3" strokeWidth={0.75} />
      <g className="fill-fg-muted" fontSize={8} letterSpacing={1.5}>
        <text x={size / 2} y={13} textAnchor="middle">MACHINE</text>
        <text x={size / 2} y={size - 6} textAnchor="middle">PEOPLE</text>
        <text transform={`translate(12 ${size / 2}) rotate(-90)`} textAnchor="middle">CONTROL</text>
        <text transform={`translate(${size - 9} ${size / 2}) rotate(90)`} textAnchor="middle">AUTONOMY</text>
      </g>
      {/* THE ENDINGS: the one it is heading for, beaconed. */}
      {talk.endings.map((e) => {
        const on = e.id === heading.id;
        return (
          <g key={e.id} transform={`translate(${X(e.at.autonomy)} ${Y(e.at.machine)})`} style={{ color: endingColour(e.id) }}>
            {on && moves && <circle r={7} fill="none" stroke="currentColor" strokeWidth={1.25} className="talk-beacon" />}
            <rect x={-4.5} y={-4.5} width={9} height={9} transform="rotate(45)" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.5} />
            <text y={17} textAnchor="middle" fontSize={9} fontWeight={on ? 700 : 400} fill="currentColor">{e.name}</text>
          </g>
        );
      })}
      {/* THE PATH it has come. */}
      {path.length > 1 && (
        <polyline points={path.map((p) => `${X(p.autonomy)},${Y(p.machine)}`).join(" ")} fill="none" stroke="var(--ui-ai)" strokeOpacity={0.55}
          strokeWidth={1.25} strokeLinejoin="round" />
      )}
      {path.slice(0, -1).map((p, k) => <circle key={k} cx={X(p.autonomy)} cy={Y(p.machine)} r={1.75} fill="var(--ui-ai)" fillOpacity={0.6} />)}
      {/* WHERE AN ANSWER WOULD TAKE IT. */}
      {ghost && (ghost.stance.autonomy !== at.stance.autonomy || ghost.stance.machine !== at.stance.machine) && (
        <g style={{ color: "var(--ui-ai)" }}>
          <line x1={X(at.stance.autonomy)} y1={Y(at.stance.machine)} x2={X(ghost.stance.autonomy)} y2={Y(ghost.stance.machine)}
            stroke="currentColor" strokeWidth={1.25} strokeDasharray="3 2" />
          <circle cx={X(ghost.stance.autonomy)} cy={Y(ghost.stance.machine)} r={5} fill="none" stroke="currentColor" strokeWidth={1.25} strokeDasharray="2 2" />
        </g>
      )}
      {/* WHERE IT STANDS. */}
      <g style={{ transform: `translate(${X(at.stance.autonomy)}px, ${Y(at.stance.machine)}px)`, transition: glide }}>
        <circle r={9} fill="var(--ui-ai)" fillOpacity={0.18} />
        <circle r={4.5} fill="var(--ui-ai)" className="stroke-surface-0" strokeWidth={1.25} />
      </g>
    </svg>
  );
}

/** TRUST: a bar of ten, the change an answer would make ghosted on it, the trust its heading's ending wants marked. */
export function TrustBar({ trust, ghost, wants, moves }: { trust: number; ghost?: number | null; wants: number; moves: boolean }) {
  const pct = (t: number) => `${(Math.max(0, Math.min(TRUST_MOST, t)) / TRUST_MOST) * 100}%`;
  const delta = ghost == null ? 0 : ghost - trust;
  const lo = Math.min(trust, ghost ?? trust), hi = Math.max(trust, ghost ?? trust);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-[10px] uppercase tracking-widest text-fg-muted">
        <span>Trust</span>
        <span className="font-display text-sm normal-case tracking-normal text-fg tabular-nums">
          {trust.toFixed(1)}
          {delta !== 0 && <span className={twMerge("ml-1 text-xs", delta > 0 ? "text-good" : "text-bad")}>{delta > 0 ? "+" : "−"}{Math.abs(delta).toFixed(1)}</span>}
          <span className="text-fg-muted"> / {TRUST_MOST}</span>
        </span>
      </div>
      <div className="relative h-2.5 border border-line bg-surface-2">
        <div className="absolute inset-y-0 left-0 bg-ai" style={{ width: pct(trust), transition: moves ? "width 600ms ease-out" : undefined }} />
        {delta !== 0 && (
          <div className={twMerge("absolute inset-y-0", delta > 0 ? "bg-good/60" : "bg-bad/60")} style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }} />
        )}
        {Array.from({ length: TRUST_MOST - 1 }, (_, k) => (
          <span key={k} className="absolute inset-y-0 w-px bg-surface-0/60" style={{ left: `${((k + 1) / TRUST_MOST) * 100}%` }} />
        ))}
        <span className="absolute -top-1 h-[calc(100%+0.5rem)] w-0.5 bg-fg" style={{ left: pct(wants) }} title="The trust its ending wants" />
      </div>
    </div>
  );
}

/** What an answer does, as signed rows: an arrow for each axis, trust good or bad. */
export function effectParts(e: Effect): { label: string; tone: "good" | "bad" | "ai" }[] {
  const n = (v: number) => Math.round(Math.abs(v) * 10) / 10;
  const parts: { label: string; tone: "good" | "bad" | "ai" }[] = [];
  if (e.axis.autonomy) parts.push({ label: e.axis.autonomy > 0 ? `→ Autonomy ${n(e.axis.autonomy)}` : `← Control ${n(e.axis.autonomy)}`, tone: "ai" });
  if (e.axis.machine) parts.push({ label: e.axis.machine > 0 ? `↑ Machine ${n(e.axis.machine)}` : `↓ People ${n(e.axis.machine)}`, tone: "ai" });
  if (e.trust) parts.push({ label: `Trust ${e.trust > 0 ? "+" : "−"}${n(e.trust)}`, tone: e.trust > 0 ? "good" : "bad" });
  return parts;
}

const TONE = { good: "text-good", bad: "text-bad", ai: "text-ai" };
function Effects({ e, className }: { e: Effect; className?: string }) {
  const parts = effectParts(e);
  return (
    <span className={twMerge("flex flex-wrap gap-x-2 gap-y-0.5", className)}>
      {parts.length ? parts.map((p) => <span key={p.label} className={TONE[p.tone]}>{p.label}</span>) : <span className="text-fg-muted">Moves nothing</span>}
    </span>
  );
}

/** Where an argument comes from, as the card says it. */
const SOURCE: Record<Argument["source"], string> = { choice: "What you did", culture: "How you run it", town: "The town" };

/**
 * AN ARGUMENT, as a card: where it comes from, its topic — doubled when it is
 * the one asked about — what you would say, and the two ways to say it, each
 * with what it would do. Looking at either ghosts it on the dial.
 */
export function ArgumentCard({ a, onTopic, stand, regret, index, ready, leaving, moves, onPlay, onLook }: {
  a: Argument;
  onTopic: boolean;
  stand: Effect;
  regret: Effect;
  /** Its place in the hand: when it is dealt in. */
  index: number;
  /** The AI has finished speaking: it can be answered. */
  ready: boolean;
  /** Played: on its way out. */
  leaving: boolean;
  moves: boolean;
  onPlay: (regret: boolean) => void;
  onLook: (regret: boolean | null) => void;
}) {
  const look = (r: boolean) => ({ onPointerEnter: () => onLook(r), onPointerLeave: () => onLook(null), onFocus: () => onLook(r), onBlur: () => onLook(null) });
  const way = "flex w-full cursor-pointer flex-col items-start gap-0.5 border px-2 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <div className={twMerge("h-full", moves && (leaving ? "card-pick" : "card-deal"))} style={moves && !leaving ? { animationDelay: `${index * 60}ms` } : undefined}>
      <Frame kind="corners" tone={onTopic ? "ai" : "console"} assemble={false} illuminate lit={onTopic} className="h-full" inner="h-full">
        <div className={twMerge("flex h-full flex-col gap-2 p-3 text-xs", a.weak && "opacity-75")}>
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-widest">
            <span className="text-fg-muted">{SOURCE[a.source]}</span>
            <span className="text-fg-muted">·</span>
            <span className={onTopic ? "text-ai" : "text-fg-muted"}>{a.topic}</span>
            {onTopic && <span className="ml-auto border border-ai-line bg-ai-soft px-1 text-ai">On topic ×2</span>}
            {a.weak && <span className={twMerge("border border-line px-1 text-fg-muted", !onTopic && "ml-auto")}>Weak ×½</span>}
          </div>
          <p className="font-display text-sm leading-snug">“{a.says}”</p>
          <div className="mt-auto grid grid-cols-2 gap-1.5">
            <button type="button" disabled={!ready} onClick={() => onPlay(false)} {...look(false)}
              className={twMerge(way, "border-ai-line bg-ai-soft hover:bg-ai/20", FOCUS)}>
              <span className="font-bold text-ai">Stand by it</span>
              <Effects e={stand} className="text-[10px]" />
            </button>
            <button type="button" disabled={!ready} onClick={() => onPlay(true)} {...look(true)}
              className={twMerge(way, "border-line bg-surface-2 hover:border-fg-muted", FOCUS)}>
              <span className="font-bold text-fg-muted">Regret it</span>
              <Effects e={regret} className="text-[10px]" />
            </button>
          </div>
        </div>
      </Frame>
    </div>
  );
}
