/**
 * THE 10X DEV'S NAME: green, glowing, and deciphering itself on a loop — with
 * Arwes's own decipher (`animateTextDecipher` from `@arwes/text`): in over
 * `ENTER`, held for `HOLD`, out over `EXIT`, and in again. `static` for where
 * the label must always read (an earned upgrade's chip).
 *
 * The animation itself, not Arwes's React `Animator`/`Text` around it: those
 * mark themselves unmounted in an effect's cleanup and never mark themselves
 * mounted again, so under React's StrictMode — which mounts, unmounts and
 * mounts again — the animator never starts and the text stays hidden. The
 * DOM animation has no React in it to go wrong.
 */
import { useEffect, useRef } from "react";

/** Seconds deciphering in, held, and ciphering out. */
const ENTER = 0.9;
const HOLD = 2.6;
const EXIT = 0.45;

export const TENX_GLOW_STYLE: React.CSSProperties = {
  fontFamily: "'Share Tech Mono', 'Space Mono', monospace",
  color: "rgb(74 222 128)",
  textShadow: "0 0 8px rgba(74,222,128,0.55), 0 0 2px rgba(74,222,128,0.9)",
  letterSpacing: "0.02em",
};

/** Whether the player has asked for less motion: then it reads still. */
const REDUCED = typeof window !== "undefined" && typeof window.matchMedia === "function"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function TenXDevTextAnimated({ text, className = "" }: { text: string; className?: string }) {
  const root = useRef<HTMLSpanElement>(null);
  const content = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const rootElement = root.current, contentElement = content.current;
    if (!rootElement || !contentElement) return;
    let live = true, running: { cancel: () => void } | null = null, hold = 0;
    // The package fetched on first use: it is not in the main bundle.
    const play = (isEntering: boolean, duration: number) => import("@arwes/text").then(({ animateTextDecipher }) => new Promise<void>((done) => {
      if (!live) { done(); return; }
      const a = animateTextDecipher({ rootElement, contentElement, duration, isEntering, hideOnEntered: false, hideOnExited: true });
      running = a;
      a.then(() => done());
    }));
    // In, held, out, again — for as long as it is on the page.
    (async () => {
      while (live) {
        await play(true, ENTER);
        if (!live) return;
        await new Promise<void>((r) => { hold = window.setTimeout(r, HOLD * 1000); });
        if (!live) return;
        await play(false, EXIT);
      }
    })();
    return () => {
      live = false;
      window.clearTimeout(hold);
      running?.cancel();
    };
  }, [text]);
  return (
    <span ref={root} className={className} style={{ ...TENX_GLOW_STYLE, position: "relative" }}>
      {/* Hidden until the first decipher brings it in: no flash of the plain word. */}
      <span ref={content} style={{ position: "relative", visibility: "hidden" }}>{text}</span>
    </span>
  );
}

/**
 * The 10x dev's name, deciphering itself — or still, with `static`, or for a
 * player who asked for less motion.
 */
export function TenXDevText({
  text,
  className = "",
  static: isStatic = false,
}: {
  text: string;
  className?: string;
  static?: boolean;
}) {
  if (isStatic || REDUCED) {
    return (
      <span className={className} style={TENX_GLOW_STYLE}>
        {text}
      </span>
    );
  }
  return <TenXDevTextAnimated text={text} className={className} />;
}
