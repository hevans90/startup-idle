/**
 * INTO COMMS, from where things already happen: the world's refusals become
 * notices; each event, as it begins, an alert in the log (and its tone); each
 * thing the AI asks, a transmission in the log. Started with the map, stopped
 * with it. @see comms.store
 */
import { sfx } from "../../audio/sound";
import { CHAPTERS, REQUESTS } from "../../game/quests/chapters";
import { useCommsStore } from "../../state/comms.store";
import { useQuestStore } from "../../state/quest.store";
import { useWorldStore } from "../../state/world.store";

export function startCommsBridge(): () => void {
  const c = useCommsStore.getState;
  const seenEvents = new Set(useWorldStore.getState().events.map((e) => e.id));
  const stopWorld = useWorldStore.subscribe((st, was) => {
    // A REFUSAL: a notice, by the pointer. @see NoticeToast
    if (st.notice && st.notice !== was.notice) c().push({ kind: "notice", text: st.notice.text });
    // AN EVENT BEGUN: logged, and heard.
    if (st.events !== was.events) {
      for (const e of st.events) {
        if (seenEvents.has(e.id) || e.kind === "slop-overflow") continue;
        seenEvents.add(e.id);
        c().note({ kind: "alert", title: e.title, text: e.text });
        sfx("alert");
      }
    }
  });
  const stopQuest = useQuestStore.subscribe((q, was) => {
    if (!q.offer || q.offer.id === was.offer?.id) return;
    const chapter = q.offer.kind === "chapter" ? CHAPTERS.find((x) => x.id === q.offer!.id) : null;
    const request = q.offer.kind === "request" ? REQUESTS.find((x) => x.id === q.offer!.id) : null;
    c().note({ kind: "transmission", from: "ai", title: chapter ? `Chapter ${chapter.number} · ${chapter.title}` : "A request", text: chapter ? chapter.transmission(new Set(q.flags)).join(" ") : request?.text ?? "" });
  });
  return () => { stopWorld(); stopQuest(); };
}
