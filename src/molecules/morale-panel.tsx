/**
 * MORALE, as the player reads it: each kind's one number, what it does, and
 * what it is made of — Home, Work, Leaders, Events, Founder — every part a
 * figure, Home a way to the map's Morale view. In full on the Innovation tab;
 * before the HQ, a strip on the Employees tab. @see game/morale-parts
 */
import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { MORALE_PARTS, moralePartsNow, moraleTarget, type MoralePart } from "../game/morale-parts";
import {
  dev10xSatisfactionExponentDelta,
  internSatisfactionIpsMultiplier,
  SATISFACTION_MAX,
  satisfactionRevenueMultiplier,
  vibeSlopMultiplier,
} from "../game/satisfaction";
import { useTicking } from "../hooks/use-ticking";
import { useGeneratorStore, type GeneratorId } from "../state/generators.store";
import { useInnovationStore } from "../state/innovation.store";
import { usePrestigeStore } from "../state/prestige.store";
import { useTeamLeadersEmployeesStore } from "../state/team-leaders.store";
import { useWorldStore } from "../state/world.store";
import { FOCUS, Panel } from "../ui/console";
import { ModifierTag } from "../ui/ModifierTag";
import { TenXDevText } from "../utils/ten-x-utils";
import { RainbowText } from "../utils/vibe-utils";

const KINDS: readonly GeneratorId[] = ["intern", "vibe_coder", "10x_dev"];

const PART_NAME: Record<MoralePart, string> = { home: "Home", work: "Work", leaders: "Leaders", events: "Events", founder: "Founder" };
const PART_HINT: Record<MoralePart, string> = {
  home: "Their houses' morale: commutes, services, crowding, the slop pit. Show it on the map",
  work: "The work policies they are run by",
  leaders: "Team leaders' skills and pairings",
  events: "Hackathons, floods and the AI's memos, felt for a day",
  founder: "Traits fused into the founder",
};

function Kind({ id }: { id: GeneratorId }) {
  if (id === "vibe_coder") return <RainbowText text="Vibe coders" inline />;
  if (id === "10x_dev") return <TenXDevText text="10x devs" />;
  return <>Interns</>;
}

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(Math.round(n))}`;
const mult = (n: number) => `×${n.toFixed(2)}`;

/** A bar from −40 to +40, filled from the middle. */
function MoraleBar({ score }: { score: number }) {
  const half = (Math.min(SATISFACTION_MAX, Math.abs(score)) / SATISFACTION_MAX) * 50;
  return (
    <div aria-hidden className="relative h-1.5 w-full bg-surface-3">
      <div className="absolute inset-y-0 left-1/2 z-[1] w-px bg-line-strong" />
      {score !== 0 && (
        <div className={twMerge("absolute inset-y-0", score > 0 ? "bg-good" : "bg-bad")}
          style={score > 0 ? { left: "50%", width: `${half}%` } : { left: `${50 - half}%`, width: `${half}%` }} />
      )}
    </div>
  );
}

/** Each kind's morale, its effective score, and its parts, now. */
function useMorale() {
  useTicking(1000);
  const scores = useGeneratorStore((s) => s.satisfactionScores);
  const policies = useGeneratorStore((s) => s.employeeManagement.policies);
  const generators = useGeneratorStore((s) => s.generators);
  const effective = useGeneratorStore((s) => s.getEffectiveSatisfaction);
  const emOpen = useInnovationStore((s) => s.unlocks.employeeManagement?.unlocked ?? false);
  const leaders = useTeamLeadersEmployeesStore((s) => s.employees);
  const amounts = Object.fromEntries(generators.map((g) => [g.id, g.amount])) as Record<GeneratorId, number>;
  const parts = moralePartsNow(policies, emOpen ? leaders : []);
  const hired = (id: GeneratorId) => (amounts[id] ?? 0) > 0;
  return { scores, parts, effective, hired };
}

/** What a kind's morale does now, besides their output. */
function sideEffect(id: GeneratorId, score: number): ReactNode {
  if (id === "intern") return <ModifierTag modKey="internIpsMult">innovation {mult(internSatisfactionIpsMultiplier(score))}</ModifierTag>;
  if (id === "vibe_coder") return <>slop pit fill {mult(vibeSlopMultiplier(score))}</>;
  const d = dev10xSatisfactionExponentDelta(score);
  return <>cost curve {d === 0 ? "unchanged" : `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(3)}`}</>;
}

/** The keystones that change what morale does. */
function KeystoneNote() {
  const neutralized = usePrestigeStore((s) => s.modifiers.satisfactionNeutralized);
  const positive = usePrestigeStore((s) => s.modifiers.satisfactionPositiveMult);
  if (neutralized) return <p className="text-[11px] text-bad">Crunch Mode: morale has no effect.</p>;
  if (positive !== 1) return <p className="text-[11px] text-bad">Enshittify: good morale counts for {Math.round(positive * 100)}%.</p>;
  return null;
}

/** THE FULL PANEL, on the Innovation tab: a row a kind, its parts underneath. */
export function MoralePanel({ className }: { className?: string }) {
  const { scores, parts, effective, hired } = useMorale();
  const setOverlay = useWorldStore((s) => s.setMoodOverlay);
  return (
    <Panel title="Morale" className={className}
      help={`Each kind's morale runs ${-SATISFACTION_MAX} to +${SATISFACTION_MAX} and drifts toward the sum of its parts. Output is ×0.5 at the bottom, ×1 at 0, ×2 at the top.`}>
      <KeystoneNote />
      <div className="flex flex-col divide-y divide-line-quiet">
        {KINDS.filter(hired).map((id) => {
          const score = scores[id], eff = effective(id), p = parts[id], target = moraleTarget(p);
          return (
            <section key={id} aria-label={`${id} morale`} className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-display text-sm uppercase tracking-wider"><Kind id={id} /></span>
                <span className="font-display text-base tabular-nums">{signed(score)}</span>
              </div>
              <MoraleBar score={score} />
              <p className="flex flex-wrap justify-between gap-x-3 text-[11px] text-fg-muted">
                <span>
                  <ModifierTag modKey={`satisfactionRevenue.${id}`}>output {mult(satisfactionRevenueMultiplier(eff))}</ModifierTag>
                  {" · "}{sideEffect(id, eff)}
                </span>
                {Math.round(target) !== Math.round(score) && <span className="tabular-nums">heading for {signed(target)}</span>}
              </p>
              <ul className="flex flex-wrap gap-1 text-[11px]">
                {MORALE_PARTS.filter((k) => k === "home" || Math.round(p[k]) !== 0).map((k) => {
                  const body = <><span className="text-fg-muted">{PART_NAME[k]}</span> <b className={twMerge("tabular-nums", p[k] > 0.5 ? "text-good" : p[k] < -0.5 ? "text-bad" : "text-fg")}>{signed(p[k])}</b></>;
                  return (
                    <li key={k}>
                      {k === "home"
                        ? <button type="button" title={PART_HINT[k]} onClick={() => setOverlay(true)}
                            className={twMerge("cursor-pointer border border-line px-1.5 py-0.5 hover:border-line-strong hover:bg-surface-2", FOCUS)}>{body}</button>
                        : <span title={PART_HINT[k]} className="inline-block border border-line-quiet px-1.5 py-0.5">{body}</span>}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {!KINDS.some(hired) && <p className="text-xs text-fg-muted">No one to be happy or unhappy yet.</p>}
      </div>
    </Panel>
  );
}

/** THE STRIP, on the Employees tab before the HQ: a bar a kind and what it does to their output. */
export function MoraleStrip({ className }: { className?: string }) {
  const { scores, effective, hired } = useMorale();
  const setOverlay = useWorldStore((s) => s.setMoodOverlay);
  const kinds = KINDS.filter(hired);
  if (!kinds.length) return null;
  return (
    <section aria-label="Morale" className={twMerge("flex flex-col gap-2 border border-line-quiet bg-surface-1 px-3 py-2", className)}>
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-xs uppercase tracking-widest">
          <span aria-hidden className="h-3 w-0.5 bg-console" />Morale
        </h3>
        <button type="button" onClick={() => setOverlay(true)} className={twMerge("cursor-pointer text-[10px] uppercase tracking-widest text-fg-muted hover:text-fg", FOCUS)}>
          Show homes on the map
        </button>
      </header>
      <KeystoneNote />
      {kinds.map((id) => (
        <div key={id} className="grid grid-cols-[6rem_1fr_auto] items-center gap-2 text-[11px]">
          <span className="truncate"><Kind id={id} /></span>
          <MoraleBar score={scores[id]} />
          <span className="tabular-nums text-fg-muted">
            <b className="text-fg">{signed(scores[id])}</b> · <ModifierTag modKey={`satisfactionRevenue.${id}`}>{mult(satisfactionRevenueMultiplier(effective(id)))}</ModifierTag>
          </span>
        </div>
      ))}
    </section>
  );
}
