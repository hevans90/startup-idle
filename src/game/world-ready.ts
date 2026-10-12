/**
 * WHETHER THE MAP IS UP: its readers registered — beds, projects, mood, the
 * town's worth — so the economy is playing by the town's rules. Time away is
 * credited only then, or it is played as if there were no town at all: no
 * wonders, no labs, nobody away, and hires past the beds. @see computeOfflineProgress
 */
let ready = false;
const waiting = new Set<() => void>();

/** The map's readers are in. @see useFoundWorld */
export function markWorldReady(): void {
  ready = true;
  for (const f of [...waiting]) f();
  waiting.clear();
}

/** The map has gone. */
export function markWorldGone(): void { ready = false; }

/**
 * Run `cb` once the map is up — at once if it is — or after `timeoutMs`
 * regardless, so a map that never comes still lets the game start. Returns a
 * function that cancels it.
 */
export function whenWorldReady(cb: () => void, timeoutMs: number): () => void {
  let done = false;
  const once = () => { if (done) return; done = true; clearTimeout(timer); waiting.delete(once); cb(); };
  const timer = setTimeout(once, timeoutMs);
  if (ready) once();
  else waiting.add(once);
  return () => { done = true; clearTimeout(timer); waiting.delete(once); };
}
