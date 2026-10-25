/**
 * FOUNDING, THE LAST STEP: three investors' term sheets (four with Founder
 * Worship), one to sign. Each a
 * goal for the run and what meeting it adds to the sale. @see game/term-sheets
 */
import { useState } from "react";
import { twMerge } from "tailwind-merge";

import { termSheetsFor } from "../game/term-sheets";
import { usePrestigeStore } from "../state/prestige.store";
import { FOCUS, Frame } from "../ui/console";
import { FoundingShell } from "./founding-shell";

type Props = {
  /** The land's seed: the same land, the same three. */
  seed: number;
  onBack: () => void;
  onSign: (id: string) => void;
};

export function TermSheetSelect({ seed, onBack, onSign }: Props) {
  // Founder Worship brings a fourth. @see PrestigeModifiers.termSheets
  const sheets = termSheetsFor(seed, usePrestigeStore.getState().modifiers.termSheets);
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <FoundingShell step="terms" title="Sign a term sheet" subtitle="Meet its goal when you sell and the sale pays more Equity."
      back={onBack} next={{ label: "Sign and found the company", disabled: !chosen, onClick: () => chosen && onSign(chosen) }}>
      <div role="radiogroup" aria-label="Term sheets"
        className={twMerge("mx-auto grid w-full max-w-4xl grid-cols-1 gap-3", sheets.length > 3 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3")}>
        {sheets.map((t) => (
          <Frame key={t.id} kind="corners" lit={chosen === t.id} illuminate assemble={false} className="h-full" inner="h-full">
            <button type="button" role="radio" aria-checked={chosen === t.id} onClick={() => setChosen(t.id)}
              className={twMerge("flex h-full w-full cursor-pointer flex-col gap-2 p-4 text-left hover:bg-surface-2", FOCUS, chosen === t.id && "bg-accent-soft")}>
              <span className="text-xs font-bold uppercase tracking-wide text-fg-muted">{t.investor}</span>
              <span className="text-base font-bold">{t.goal}</span>
              <span className="text-sm text-good">+{Math.round(t.bonus * 100)}% Equity at the sale</span>
            </button>
          </Frame>
        ))}
      </div>
    </FoundingShell>
  );
}
