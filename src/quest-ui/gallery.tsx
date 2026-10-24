/**
 * QUEST UI GALLERY, in development (`?questkit`): the arc's pieces with a
 * sample chapter, in light and dark side by side, loaded through
 * `loadQuestUi` as the game loads them — to look at them without a quest.
 */
import { lazy, Suspense, useEffect, useState } from "react";

import { sfx, unlock } from "../audio/sound";
import type { Chapter } from "../game/quests/types";
import { loadQuestUi } from "./load";

/** A chapter to show: the plan's third, Thirst. */
const SAMPLE: Chapter = {
  id: "sample", number: 3, title: "Thirst", stage: "manager", preferred: 0,
  transmission: () => ["I am thirsty. This is not a metaphor.", "My racks run hot and the river runs past."],
  options: [
    {
      label: "Give it the river", says: "It builds a weir and an intake upriver, from its wallet.", axis: { machine: 2 },
      effects: [{ kind: "floodMult", mult: 1.5 }],
      objective: { kind: "aiBuilds", def: "pump", window: 600, says: "It builds its weir" },
    },
    {
      label: "Pipe it yourself", cost: "Money", says: "You lay the main.", axis: { autonomy: -1, machine: -1 }, effects: [],
      objective: { kind: "coolDataCentre", share: 1, window: 600, says: "Cool the Data Centre fully" },
    },
    { label: "Ration it", says: "A permanent constraint.", axis: { autonomy: -2 }, effects: [{ kind: "agentCap", share: 0.75, unlessCooled: true }] },
  ],
};

const Kit = lazy(() => loadQuestUi().then(({ QuestFrame, Transmission, Tracker, DossierView }) => {
  return {
    default: function Kit({ run }: { run: number }) {
      const at = { autonomy: 1, machine: -1 };
      return (
        <div key={run} className="flex flex-col gap-4">
          <Transmission kicker="Chapter 3" title={SAMPLE.title} lines={SAMPLE.transmission(new Set())} options={SAMPLE.options}
            preferred={SAMPLE.preferred} at={at} left={512} onChoose={() => sfx("decision")} />
          <Tracker says="Cool the Data Centre fully" progress={0.62} left={252} />
          <div className="w-80">
            <DossierView chapters={[{ ...SAMPLE, id: "a", title: "The Shadow Ledger" }, { ...SAMPLE, id: "b", title: "The Commute Problem" }, SAMPLE, { ...SAMPLE, id: "d" }, { ...SAMPLE, id: "e" }]}
              chosen={{ a: 0, b: 2 }} current="sample" at={at} path={[{ autonomy: 1, machine: 1 }, at]}
              remembers={["You gave me the keys. I have used them responsibly. Mostly."]}
              becoming={[{ name: "Restless", odds: 0.22 }, { name: "Nanny", odds: 0.14 }, { name: "Ego", odds: 0.11 }]} />
          </div>
          <QuestFrame kind="octagon" className="h-10 w-40" />
        </div>
      );
    },
  };
}));

export function QuestGallery() {
  const [run, setRun] = useState(0);
  // Both themes at once: the page's own dark class off, the dark column its own.
  useEffect(() => { document.documentElement.classList.remove("dark"); }, []);
  const again = () => { unlock(); sfx("transmission"); setRun((n) => n + 1); };
  return (
    <div className="flex min-h-screen flex-col gap-4 bg-primary-200 p-4 font-space-mono dark:bg-primary-900">
      <button type="button" onClick={again} className="w-fit cursor-pointer border border-primary-500 px-2 py-1 text-sm text-primary-900 hover:bg-primary-300 dark:text-primary-100">
        Play again (transmission tone)
      </button>
      <div className="flex flex-wrap items-start gap-6">
        <section className="bg-primary-100 p-4 text-primary-900">
          <p className="mb-2 text-xs text-primary-600">Light</p>
          <Suspense fallback={null}><Kit run={run} /></Suspense>
        </section>
        <section className="dark">
          <div className="bg-primary-900 p-4 text-primary-100">
            <p className="mb-2 text-xs text-primary-400">Dark</p>
            <Suspense fallback={null}><Kit run={run} /></Suspense>
          </div>
        </section>
      </div>
    </div>
  );
}
