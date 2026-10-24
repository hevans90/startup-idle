/**
 * QUEST UI GALLERY, in development (`?questkit`): every piece of the kit, in
 * light and dark side by side, loaded through `loadQuestUi` as the game will
 * load it — to look at the frames, text and patterns without a quest.
 */
import { lazy, Suspense, useEffect, useState } from "react";

import { sfx, unlock } from "../audio/sound";
import { loadQuestUi } from "./load";

const Kit = lazy(() => loadQuestUi().then(({ QuestFrame, QuestText, QuestBackground }) => ({
  default: function Kit({ run }: { run: number }) {
    return (
      <div key={run} className="flex flex-col gap-4">
        <QuestFrame kind="octagon" className="w-96">
          <QuestBackground kind="dots" />
          <div className="relative flex flex-col gap-2 p-4 text-sm">
            <QuestText as="h3" mode="decipher" text="Chapter 3 · Thirst" className="text-xs font-bold uppercase tracking-widest text-violet-700 dark:text-violet-300" />
            <QuestText as="p" text="The reservoir is lower than it was. I have a proposal. You will not like all of it." />
            <div className="grid grid-cols-2 gap-2">
              {["Build the weir", "Ration the farms"].map((label) => (
                <button key={label} type="button" onClick={() => sfx("decision")} className="cursor-pointer text-left">
                  <QuestFrame kind="corners" illuminate className="p-2">
                    <b>{label}</b>
                    <p className="text-emerald-700 dark:text-emerald-400">+ cooling</p>
                    <p className="text-red-700 dark:text-red-400">− $40,000</p>
                  </QuestFrame>
                </button>
              ))}
            </div>
          </div>
        </QuestFrame>
        <QuestFrame kind="underline" className="w-64 px-2 py-1 text-xs">
          <p className="flex justify-between"><span>Cool the Data Centre</span><span className="tabular-nums">4:12</span></p>
        </QuestFrame>
        <QuestFrame kind="octagon" className="h-24 w-64">
          <QuestBackground kind="grid" />
        </QuestFrame>
      </div>
    );
  },
})));

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
      <div className="flex flex-wrap gap-6">
        <section className="bg-primary-100 p-4">
          <p className="mb-2 text-xs text-primary-600">Light</p>
          <Suspense fallback={null}><Kit run={run} /></Suspense>
        </section>
        <section className="dark">
          <div className="bg-primary-900 p-4">
            <p className="mb-2 text-xs text-primary-400">Dark</p>
            <Suspense fallback={null}><Kit run={run} /></Suspense>
          </div>
        </section>
      </div>
    </div>
  );
}
