/**
 * A FOUNDER on the founding screen, three ways: a tile in the roster (their
 * mark, their name, one fact — their exits, or what opens them); and, chosen,
 * their emblem turning at the centre with their name deciphering in under it,
 * and their profile beside — perks, the map's rule, what each exit adds. The
 * Model's tile, locked, will not hold still. @see FounderSelect
 */
import { useRef, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { IconLock } from "@tabler/icons-react";

import type { FounderDef } from "../game/founders.catalog";
import { FOCUS, Frame, Text, useGlitch } from "../ui/console";
import { TenXDevText } from "../utils/ten-x-utils";
import { RainbowText } from "../utils/vibe-utils";
import { FusedTraits } from "./fused-traits";

const SPLIT_RE = /(vibe coders?|10x devs?)/gi;

/** A perk, its vibe coders in rainbow and its 10x devs in theirs. */
function PerkText({ text }: { text: string }) {
  return (
    <>
      {text.split(SPLIT_RE).map((seg, i) => {
        if (/^vibe coders?$/i.test(seg)) return <RainbowText key={i} text={seg} inline />;
        if (/^10x devs?$/i.test(seg)) return <TenXDevText key={i} text={seg} />;
        return <span key={i}>{seg}</span>;
      })}
    </>
  );
}

const toneOf = (f: FounderDef) => (f.id === "model" ? "ai" : "console");

/** A kicker over a part of the profile. */
const Kicker = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={twMerge("font-display text-[10px] uppercase tracking-[0.25em] text-fg-faint", className)}>{children}</div>
);

/** A FOUNDER IN THE ROSTER: lit when chosen, its corners under the pointer; locked, dimmed, with what opens them. */
export function FounderTile({ founder: f, index, exits, unlocked, selected, onSelect }: {
  founder: FounderDef;
  /** Its place in the roster. */
  index: number;
  /** This founder's own exits. */
  exits: number;
  unlocked: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = f.icon;
  const ai = f.id === "model";
  const tile = useRef<HTMLButtonElement>(null);
  // THE MODEL, LOCKED, torn now and then. @see useGlitch
  useGlitch(tile, { active: ai && !unlocked, strength: 0.6, every: 3 });
  return (
    <li className="ui-fade-in" style={{ animationDelay: `${index * 40}ms`, animationFillMode: "backwards" }}>
      <button ref={tile} type="button" role="option" aria-selected={selected} disabled={!unlocked} onClick={onSelect}
        className={twMerge("group block w-full text-left disabled:cursor-not-allowed", unlocked && "cursor-pointer", FOCUS)}>
        <Frame kind="corners" tone={toneOf(f)} lit={selected} illuminate={unlocked && !selected} assemble={selected ? "always" : false}
          inner="flex items-center gap-3 px-3 py-2.5">
          <span className={twMerge("flex size-9 shrink-0 items-center justify-center border",
            selected ? (ai ? "border-ai bg-ai-soft text-ai" : "border-console bg-console-soft text-console") : "border-line-quiet text-fg-muted",
            !unlocked && "text-fg-faint")}>
            {unlocked ? <Icon size={18} stroke={1.5} aria-hidden /> : <IconLock size={16} stroke={1.5} aria-hidden />}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={twMerge("truncate font-display text-sm uppercase tracking-wider",
              !unlocked ? "text-fg-faint" : selected ? (ai ? "text-ai" : "text-console") : "text-fg")}>{f.name}</span>
            {(!unlocked || exits > 0) && (
              <span className="truncate text-[11px] tabular-nums text-fg-faint">
                {unlocked ? `${exits} exit${exits === 1 ? "" : "s"}` : f.unlockCondition?.label}
              </span>
            )}
          </span>
        </Frame>
      </button>
    </li>
  );
}

/** Ticks round the emblem's rim, every 15°. */
const TICKS = Array.from({ length: 24 }, (_, k) => (k * Math.PI * 2) / 24);

/** THE EMBLEM: their mark in rings that turn, in their colour. */
function Emblem({ founder: f }: { founder: FounderDef }) {
  const Icon = f.icon;
  return (
    <div className={twMerge("relative size-40 shrink-0 sm:size-56", f.id === "model" ? "text-ai" : "text-console")}>
      <svg aria-hidden viewBox="-100 -100 200 200" className="absolute inset-0 h-full w-full overflow-visible">
        <g className="ui-spin" style={{ animationDuration: "60s" }}>
          {TICKS.map((a, k) => (
            <line key={k} x1={Math.cos(a) * 92} y1={Math.sin(a) * 92} x2={Math.cos(a) * (k % 6 ? 96 : 100)} y2={Math.sin(a) * (k % 6 ? 96 : 100)}
              stroke="currentColor" strokeOpacity={k % 6 ? 0.35 : 0.9} strokeWidth={k % 6 ? 1 : 2} />
          ))}
        </g>
        <circle r="84" fill="none" stroke="currentColor" strokeOpacity="0.9" strokeWidth="1.5" strokeDasharray="90 18 6 18" className="ui-spin ui-spin-back" style={{ animationDuration: "24s" }} />
        <circle r="72" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeDasharray="2 5" className="ui-spin" style={{ animationDuration: "40s" }} />
        <circle r="58" fill="currentColor" fillOpacity="0.08" stroke="currentColor" strokeOpacity="0.6" />
        <circle r="58" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="20 344" className="ui-spin" style={{ animationDuration: "6s" }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <Icon stroke={1.25} aria-hidden className="size-12 sm:size-16" />
      </div>
    </div>
  );
}

/** THE FOUNDER CHOSEN, at the centre: the emblem, the name deciphering in, who they are, and their seed. */
export function FounderHero({ founder: f, exits }: { founder: FounderDef; exits: number }) {
  return (
    <section className="flex flex-col items-center gap-5 text-center">
      <Emblem founder={f} />
      <div className="flex flex-col items-center gap-1.5">
        <Text as="h2" mode="decipher" text={f.name} className={twMerge("block font-display text-3xl uppercase tracking-[0.15em] sm:text-4xl", f.id === "model" ? "text-ai" : "text-fg")} />
        <Text mode="sequence" text={f.tagline} className="text-sm text-fg-muted" />
      </div>
      <div className="flex items-stretch gap-3">
        <Frame kind="octagon" tone="money" assemble="always" inner="flex flex-col items-center px-6 py-2">
          <Kicker>Seed</Kicker>
          <span className="font-display text-xl tabular-nums text-money">${f.startingCash}</span>
        </Frame>
        {exits > 0 && (
          <Frame kind="octagon" tone="warn" assemble="always" inner="flex flex-col items-center px-6 py-2">
            <Kicker>Exits</Kicker>
            <span className="font-display text-xl tabular-nums text-warn">{exits}</span>
          </Frame>
        )}
      </div>
    </section>
  );
}

/** THE PROFILE, beside: what they bring, the map's rule for them, and what each exit adds. */
export function FounderProfile({ founder: f, exits }: { founder: FounderDef; exits: number }) {
  const perks = f.perks(exits).filter((p) => p !== "No perks");
  return (
    <Frame kind="kranox" tone={toneOf(f)} assemble="always" className="w-full" inner="flex flex-col gap-5 p-5">
      <section>
        <Kicker>Perks</Kicker>
        {perks.length
          ? <ul className="mt-2 flex flex-col gap-1.5 text-sm tabular-nums">
              {perks.map((p, i) => (
                <li key={i} className="ui-fade-in flex gap-2" style={{ animationDelay: `${150 + i * 80}ms`, animationFillMode: "backwards" }}>
                  <span aria-hidden className={f.id === "model" ? "text-ai" : "text-console"}>›</span><span><PerkText text={p} /></span>
                </li>
              ))}
            </ul>
          : <p className="mt-2 text-sm text-fg-faint">None</p>}
      </section>
      {f.rule && (
        <section>
          <Kicker className="text-info">Map rule</Kicker>
          <p className="mt-1 text-sm text-info">{f.rule}</p>
        </section>
      )}
      <section>
        <Kicker className="text-ai">Per exit · {f.scalingModifier.label}</Kicker>
        <p className="mt-1 text-sm text-ai">{f.scalingModifier.perExitDescription}</p>
      </section>
      <FusedTraits founder={f.id} />
    </Frame>
  );
}
