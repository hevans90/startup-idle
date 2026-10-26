/**
 * A FOUNDER'S DOSSIER, on the founding screen: who they are, their perks,
 * their rule on the map and what each exit adds. Unlined at rest, its corners
 * under the pointer; picked, its whole border draws itself on. Locked, it is
 * redacted and stamped with the clearance it needs — the Model's past all
 * reading, its name never holding still.
 * @see FounderSelect
 */
import { useEffect, useState, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import type { FounderDef } from "../game/founders.catalog";
import { FOCUS, Frame, Text } from "../ui/console";
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

/** A kicker over a part of the file. */
const Kicker = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={twMerge("font-display text-[10px] uppercase tracking-[0.2em] text-fg-faint", className)}>{children}</div>
);

/** What a redacted line looks like: a bar the width it would have been. */
const Bar = ({ w }: { w: string }) => <span aria-hidden className="block h-2.5 bg-fg-faint/60" style={{ width: w }} />;

export function FounderCard({ founder: f, index, exits, unlocked, selected, onSelect }: {
  founder: FounderDef;
  /** Its place in the roster, for the file number. */
  index: number;
  /** This founder's own exits. */
  exits: number;
  unlocked: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = f.icon;
  const perks = f.perks(exits);
  const file = `F-${String(index + 1).padStart(2, "0")}`;
  return (
    // Chosen, it is chosen: no pointer, no hover, no second press.
    <button type="button" aria-pressed={selected} disabled={!unlocked} onClick={selected ? undefined : onSelect}
      className={twMerge("h-full w-full text-left text-fg disabled:cursor-not-allowed", selected ? "cursor-default" : "cursor-pointer", FOCUS)}>
      <Frame kind={selected ? "octagon" : "corners"} tone={f.id === "model" ? "ai" : "console"} illuminate={unlocked && !selected} lit={selected}
        assemble={selected ? "always" : false} className="ui-dossier h-full" inner="flex h-full flex-col gap-3 p-4">
        <header className="flex items-start gap-3">
          <Icon size={28} stroke={1.5} className={twMerge("mt-0.5 shrink-0", unlocked ? "text-console" : "text-fg-faint", f.id === "model" && unlocked && "text-ai")} />
          <div className="min-w-0 flex-1">
            <Kicker>{file} · {selected ? "Selected" : unlocked ? "Available" : "Classified"}</Kicker>
            {unlocked || f.id !== "model"
              ? <div className={twMerge("font-display text-base uppercase leading-tight tracking-wide", !unlocked && "text-fg-muted")}>{f.name}</div>
              : <Scrambled lines={EXPUNGED} className="font-display text-base uppercase leading-tight tracking-wide text-ai" />}
          </div>
          {unlocked && exits > 0 && (
            <span title={`${exits} exit${exits === 1 ? "" : "s"} as ${f.name}`} className="shrink-0 border border-warn-line px-1.5 font-display text-[10px] tabular-nums text-warn">
              {exits}×
            </span>
          )}
        </header>
        {unlocked
          ? <Dossier founder={f} perks={perks} />
          : f.id === "model" ? <Expunged founder={f} /> : <Redacted founder={f} perks={perks.length} />}
      </Frame>
    </button>
  );
}

function Dossier({ founder: f, perks }: { founder: FounderDef; perks: string[] }) {
  return (
    <>
      <p className="text-xs italic text-fg-muted">{f.tagline}</p>
      <section>
        <Kicker>Perks</Kicker>
        <ul className="mt-1 flex flex-col gap-0.5 text-xs tabular-nums">
          {perks.map((p, i) => <li key={i} className="flex gap-1.5"><span aria-hidden className="text-console">▸</span><span><PerkText text={p} /></span></li>)}
        </ul>
      </section>
      {f.rule && (
        <section>
          <Kicker className="text-info">Map rule</Kicker>
          <p className="mt-1 text-xs text-info">{f.rule}</p>
        </section>
      )}
      <section>
        <Kicker className="text-ai">Per exit · {f.scalingModifier.label}</Kicker>
        <p className="mt-1 text-xs text-ai">{f.scalingModifier.perExitDescription}</p>
      </section>
      <FusedTraits founder={f.id} />
      <footer className="mt-auto flex items-center justify-between border-t border-line-quiet pt-2 font-display text-[11px] uppercase tracking-widest">
        <span className="text-fg-faint">Seed</span>
        <span className="tabular-nums text-money">${f.startingCash}</span>
      </footer>
    </>
  );
}

/** A locked founder's file: its shape, blacked out, and the clearance it needs. */
function Redacted({ founder: f, perks }: { founder: FounderDef; perks: number }) {
  return (
    <>
      <span className="sr-only">Locked: needs {f.unlockCondition?.label}</span>
      <Bar w="70%" />
      <section className="flex flex-col gap-1.5">
        <Kicker>Perks</Kicker>
        {Array.from({ length: perks }, (_, i) => <Bar key={i} w={["85%", "60%", "75%", "50%"][i % 4]} />)}
      </section>
      {f.rule && (
        <section className="flex flex-col gap-1.5">
          <Kicker>Map rule</Kicker>
          <Bar w="80%" />
        </section>
      )}
      <section className="flex flex-col gap-1.5">
        <Kicker>Per exit</Kicker>
        <Bar w="65%" />
      </section>
      <div className="mt-auto flex justify-center pt-2">
        <span className="rotate-[-4deg] border-2 border-warn px-2 py-1 text-center font-display uppercase text-warn">
          <span className="block text-[9px] tracking-[0.3em]">Clearance</span>
          <span className="block whitespace-nowrap text-[11px] tracking-wider">{f.unlockCondition?.label}</span>
        </span>
      </div>
    </>
  );
}

/** What the Model's name reads as, in turn, before it can be had. */
const EXPUNGED = ["The Model", "[Expunged]", "Th3 M0d3l", "██████████", "It reads you", "The Model?"];

/** Seconds each reading holds before the next deciphers in. */
const SCRAMBLE = 2.6;

/** TEXT THAT NEVER HOLDS STILL: one reading after another, each deciphered in; calm, the first. */
function Scrambled({ lines, className }: { lines: readonly string[]; className?: string }) {
  const [at, setAt] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setAt((n) => (n + 1) % lines.length), SCRAMBLE * 1000);
    return () => window.clearInterval(id);
  }, [lines]);
  return <Text mode="decipher" as="div" text={lines[at]} className={className} />;
}

/** THE MODEL, LOCKED: nothing of it legible, and more of it than there should be. */
function Expunged({ founder: f }: { founder: FounderDef }) {
  return (
    <>
      <span className="sr-only">Locked: needs {f.unlockCondition?.label}</span>
      {["90%", "75%", "95%", "60%", "85%", "70%"].map((w, i) => (
        <span key={i} aria-hidden className={twMerge("block h-2.5 bg-ai/50", i % 3 === 1 && "animate-pulse")} style={{ width: w }} />
      ))}
      <div className="mt-auto flex justify-center pt-2">
        <span className="rotate-[-4deg] border-2 border-ai px-2 py-1 text-center font-display uppercase text-ai">
          <span className="block text-[9px] tracking-[0.3em]">Clearance</span>
          <span className="block whitespace-nowrap text-[11px] tracking-wider">{f.unlockCondition?.label}</span>
        </span>
      </div>
    </>
  );
}
