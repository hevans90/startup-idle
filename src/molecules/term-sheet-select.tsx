/**
 * FOUNDING, THE LAST STEP: three investors' term sheets, one to sign. Each a
 * goal for the run and what meeting it adds to the sale. @see game/term-sheets
 */
import { twMerge } from "tailwind-merge";

import { termSheetsFor } from "../game/term-sheets";
import { Button } from "../ui/Button";

type Props = {
  /** The land's seed: the same land, the same three. */
  seed: number;
  onBack: () => void;
  onSign: (id: string) => void;
};

export function TermSheetSelect({ seed, onBack, onSign }: Props) {
  const sheets = termSheetsFor(seed);
  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-primary-100 px-6 py-8 text-primary-900 dark:bg-primary-900 dark:text-primary-50">
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-bold sm:text-4xl">Sign a term sheet</h1>
        <p className="mt-2 text-sm opacity-70">Meet its goal when you sell and the sale pays more Equity.</p>
      </div>
      <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-3 sm:grid-cols-3">
        {sheets.map((t) => (
          <button key={t.id} type="button" onClick={() => onSign(t.id)}
            className={twMerge(
              "flex cursor-pointer flex-col gap-2 border border-primary-300 bg-primary-50 p-4 text-left",
              "hover:border-emerald-600 hover:bg-primary-200 dark:border-primary-700 dark:bg-primary-800 dark:hover:border-emerald-400 dark:hover:bg-primary-700",
            )}>
            <span className="text-xs font-bold uppercase tracking-wide opacity-60">{t.investor}</span>
            <span className="text-base font-bold">{t.goal}</span>
            <span className="text-sm text-emerald-700 dark:text-emerald-400">+{Math.round(t.bonus * 100)}% Equity at the sale</span>
          </button>
        ))}
      </div>
      <div className="mx-auto mt-6 flex w-full max-w-4xl">
        <Button type="button" className="px-4 py-3" onClick={onBack}>← Back</Button>
      </div>
    </div>
  );
}
