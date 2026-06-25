import { useEffect, useRef, useState } from "react";

// Cipher character pool — mirrors Arwes' animateTextDecipher source exactly.
const CIPHER_CHARS =
  "    ----____abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function shuffleIndexes(n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function randCipher(): string {
  return CIPHER_CHARS[Math.floor(Math.random() * CIPHER_CHARS.length)];
}

const ENTER_MS = 900;
const HOLD_MS = 2600;
const EXIT_MS = 450;
const CYCLE_MS = ENTER_MS + HOLD_MS + EXIT_MS;

export const TENX_GLOW_STYLE: React.CSSProperties = {
  fontFamily: "'Share Tech Mono', 'Space Mono', monospace",
  color: "rgb(74 222 128)",
  textShadow: "0 0 8px rgba(74,222,128,0.55), 0 0 2px rgba(74,222,128,0.9)",
  letterSpacing: "0.02em",
};

/** Animated decipher loop — characters scramble in/out on repeat. */
function TenXDevTextAnimated({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const [displayed, setDisplayed] = useState(() =>
    text
      .split("")
      .map((ch) => (ch === " " ? " " : randCipher()))
      .join(""),
  );

  const rafRef = useRef<number>(0);
  const startRef = useRef(0);
  const enterIdxRef = useRef<number[]>([]);
  const exitIdxRef = useRef<number[]>([]);

  useEffect(() => {
    enterIdxRef.current = shuffleIndexes(text.length);
    exitIdxRef.current = shuffleIndexes(text.length);
    startRef.current = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startRef.current;
      const phase = elapsed % CYCLE_MS;

      if (phase < ENTER_MS) {
        const progress = phase / ENTER_MS;
        const revealed = Math.round(text.length * progress);
        const deciphered = new Set(enterIdxRef.current.slice(0, revealed));
        setDisplayed(
          text
            .split("")
            .map((ch, i) => (ch === " " ? " " : deciphered.has(i) ? ch : randCipher()))
            .join(""),
        );
        if (elapsed > CYCLE_MS && phase < 16) {
          exitIdxRef.current = shuffleIndexes(text.length);
          enterIdxRef.current = shuffleIndexes(text.length);
        }
      } else if (phase < ENTER_MS + HOLD_MS) {
        setDisplayed(text);
      } else {
        const progress = (phase - ENTER_MS - HOLD_MS) / EXIT_MS;
        const scrambledCount = Math.round(text.length * progress);
        const cipheredSet = new Set(exitIdxRef.current.slice(0, scrambledCount));
        setDisplayed(
          text
            .split("")
            .map((ch, i) => (ch === " " ? " " : cipheredSet.has(i) ? randCipher() : ch))
            .join(""),
        );
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [text]);

  return (
    <span className={className} style={TENX_GLOW_STYLE}>
      {displayed}
    </span>
  );
}

/**
 * Renders text with the Arwes decipher animation by default.
 * Pass `static` to suppress the animation and show plain glowing text —
 * useful where the label must always be readable (e.g. earned upgrade chips).
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
  if (isStatic) {
    return (
      <span className={className} style={TENX_GLOW_STYLE}>
        {text}
      </span>
    );
  }
  return <TenXDevTextAnimated text={text} className={className} />;
}
