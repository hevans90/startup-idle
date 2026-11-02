/**
 * THE ARC'S WAY IN, outside the lazy chunk: the quest UI is fetched only when
 * there is something for it to show — a transmission, an objective, or (for
 * the dossier) an arc this generation. @see loadQuestUi
 */
import { lazy, Suspense } from "react";

import { book } from "../game/quests/books";
import { useGenerationStore } from "../state/generation.store";
import { useQuestStore } from "../state/quest.store";
import { loadQuestUi } from "./load";

const Layer = lazy(() => loadQuestUi().then((m) => ({ default: m.QuestLayer })));
const Markers = lazy(() => loadQuestUi().then((m) => ({ default: m.QuestMarkers })));
const DossierLazy = lazy(() => loadQuestUi().then((m) => ({ default: m.Dossier })));

/** In comms: the tracker and the transmission — each only if comms has room for it. @see CommsDock */
export function QuestArc({ tracker = true, offer = true }: { tracker?: boolean; offer?: boolean }) {
  const live = useQuestStore((s) => (offer && !!s.offer) || (tracker && !!s.objective));
  return live ? <Suspense fallback={null}><Layer tracker={tracker} offer={offer} /></Suspense> : null;
}

/** Over the map: the ring where an objective has a place. */
export function QuestArcMarkers() {
  const live = useQuestStore((s) => !!s.objective);
  return live ? <Suspense fallback={null}><Markers /></Suspense> : null;
}

/** In the AI tab: the dossier, while the generation's book has chapters. @see game/quests/books */
export function QuestDossier() {
  const written = useGenerationStore((s) => book(s.book).chapters.length > 0);
  return written ? <Suspense fallback={null}><DossierLazy /></Suspense> : null;
}
