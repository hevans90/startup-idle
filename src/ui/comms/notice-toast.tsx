/**
 * A REFUSAL, BY THE POINTER: comms' notices — why what you just tried did not
 * happen — shown beside where you tried it, for a moment, with the deny tone;
 * and the world's notices sent into comms. Mounted once, over everything.
 * @see comms.store "notice", WorldState.notice
 */
import { useEffect, useRef } from "react";

import { sfx } from "../../audio/sound";
import { useCommsStore } from "../../state/comms.store";

export function NoticeToast() {
  const notices = useCommsStore((s) => s.live).filter((e) => e.kind === "notice");
  const at = useRef({ x: 0, y: 0 });
  const heard = useRef(0);
  // Where the pointer last was: the notice goes beside it.
  useEffect(() => {
    const move = (e: PointerEvent) => { at.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", move, { passive: true });
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerdown", move); };
  }, []);
  const last = notices[notices.length - 1];
  useEffect(() => {
    if (!last || last.id === heard.current) return;
    heard.current = last.id;
    sfx("deny");
  }, [last]);
  if (!last) return null;
  const x = Math.min(at.current.x + 14, window.innerWidth - 300), y = Math.min(at.current.y + 18, window.innerHeight - 48);
  return (
    <p role="status" className="pointer-events-none fixed z-[70] max-w-[18rem] border border-bad-line bg-surface-3 px-2 py-1 text-xs text-bad shadow"
      style={{ left: Math.max(8, x), top: Math.max(8, y) }}>
      {last.text}
    </p>
  );
}
