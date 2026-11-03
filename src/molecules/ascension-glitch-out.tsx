/**
 * THE GLITCH-OUT: the Ascension, as the screen goes. Over five seconds it
 * comes apart, harder each moment — torn in bands, split red from cyan,
 * shaken; its words corrupting a letter at a time; noise and scanlines over
 * it, blocks of colour punched through it inverted; ASCENDING across the
 * middle as the AI's log scrolls out under it — and then the tube dies, the
 * picture crushed to a line, a point, nothing. Then the company is gone.
 * Calm, none of it: the Ascension simply happens. @see NegotiationScreen
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import { sfx } from "../audio/sound";
import type { Kick } from "../ui/console";

/** Seconds it lasts, all told; when the log starts, the title shows, the shaking starts, and the tube dies. */
export const GLITCH_OUT_S = 5.2;
const LOG_AT = 1.4;
const TITLE_AT = 1.8;
const SHAKE_AT = 2.6;
const DIES_AT = 4.3;

/** What corrupted words are made of. */
const GLYPHS = "▓▒░█▌▐<>/\\|#%&@$01ｱｲｳｴｵｶｷｸｹｺ∆◊¤§";
/** The colours punched through it: its violet, and cyberpunk's cyan, magenta, acid. */
const BLOCKS = ["#a855f7", "#00f0ff", "#ff2bd6", "#f5ff3b", "#ffffff"];

const ease = (a: number, b: number, t: number) => { const x = Math.max(0, Math.min(1, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export function GlitchOut({ screen, target, kick, lines, onDone }: {
  /** The whole screen: what the tube crushes as it dies. */
  screen: RefObject<HTMLElement | null>;
  /** What comes apart: shaken, split and corrupted. */
  target: RefObject<HTMLElement | null>;
  /** The screen's own tear, kicked harder and harder. */
  kick: Kick;
  /** The AI's log as it goes, a line at a time. */
  lines: readonly string[];
  onDone: () => void;
}) {
  const blocks = useRef<HTMLCanvasElement>(null);
  const noise = useRef<HTMLCanvasElement>(null);
  const [t, setT] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const el = target.current;
    // ITS WORDS, kept as they were, to corrupt from.
    const words: { node: Text; was: string }[] = [];
    if (el) {
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) if (n.nodeValue?.trim()) words.push({ node: n as Text, was: n.nodeValue });
    }
    const start = performance.now();
    let frame = 0, last = 0, nextKick = 0, raf = 0, ended = false;
    const cues = [{ at: 0, s: "alert" }, { at: 1.3, s: "deny" }, { at: SHAKE_AT, s: "crumble" }, { at: DIES_AT, s: "alert" }] as const;
    let cue = 0;
    const step = (now: number) => {
      const s = (now - start) / 1000;
      if (s >= GLITCH_OUT_S) { if (!ended) { ended = true; done.current(); } return; }
      raf = requestAnimationFrame(step);
      while (cue < cues.length && s >= cues[cue].at) sfx(cues[cue++].s);
      const i = ease(0, 3.6, s);
      // THE TEAR, kicked harder and more often.
      if (s >= nextKick && s < DIES_AT) { kick({ strength: 1 + 6 * i, burst: 0.25 + 0.4 * i }); nextKick = s + Math.max(0.12, 0.6 - 0.5 * i); }
      // At most every other frame for what is random: it should stutter, not smear.
      if (now - last < 45) return;
      last = now;
      frame++;
      setT(s);
      // SHAKEN, SPLIT, OVERDRIVEN.
      if (el) {
        const j = 2 + 22 * i + (s > SHAKE_AT ? 18 : 0);
        const split = 2 + 14 * i;
        el.style.transform = `translate(${rand(-j, j) * (Math.random() < 0.6 ? 0.25 : 1)}px, ${rand(-j, j) * 0.3}px) skewX(${rand(-4, 4) * i}deg)`;
        el.style.filter = `hue-rotate(${rand(-90, 90) * i}deg) saturate(${1 + 2.5 * i}) contrast(${1 + 0.8 * i}) `
          + `drop-shadow(${split}px 0 rgba(255,43,214,0.75)) drop-shadow(${-split}px 0 rgba(0,240,255,0.75))`;
        el.style.opacity = Math.random() < 0.06 * i ? "0.35" : "1";
      }
      // ITS WORDS CORRUPTING.
      const c = ease(1.0, 3.8, s);
      if (c > 0) {
        for (const w of words) {
          let out = "";
          for (let k = 0; k < w.was.length; k++) out += w.was[k] !== " " && Math.random() < c ? GLYPHS[(Math.random() * GLYPHS.length) | 0] : w.was[k];
          w.node.nodeValue = out;
        }
      }
      // BLOCKS punched through, and tears the screen's width.
      const b = blocks.current, ctx = b?.getContext("2d");
      if (b && ctx) {
        if (b.width !== innerWidth) { b.width = innerWidth; b.height = innerHeight; }
        ctx.clearRect(0, 0, b.width, b.height);
        const n = Math.floor(48 * i);
        for (let k = 0; k < n; k++) {
          ctx.globalAlpha = rand(0.35, 0.95);
          ctx.fillStyle = BLOCKS[(Math.random() * BLOCKS.length) | 0];
          if (Math.random() < 0.35) ctx.fillRect(0, rand(0, b.height), b.width, rand(1, 3 + 6 * i));
          else ctx.fillRect(rand(-40, b.width), rand(0, b.height), rand(8, 60 + 220 * i), rand(4, 10 + 50 * i));
        }
      }
      // NOISE, coarse, re-rolled.
      const nz = noise.current, nctx = nz?.getContext("2d");
      if (nz && nctx && frame % 2 === 0) {
        const img = nctx.createImageData(nz.width, nz.height);
        for (let p = 0; p < img.data.length; p += 4) { const v = Math.random() * 255; img.data[p] = img.data[p + 1] = img.data[p + 2] = v; img.data[p + 3] = 255; }
        nctx.putImageData(img, 0, 0);
      }
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      // Taken down before its end: its words back as they were.
      for (const w of words) w.node.nodeValue = w.was;
      if (el) { el.style.transform = ""; el.style.filter = ""; el.style.opacity = ""; }
    };
  }, [target, kick]);

  const i = ease(0, 3.6, t);
  const shown = lines.filter((_, k) => t >= LOG_AT + k * 0.38);
  const dying = t >= DIES_AT;
  // THE TUBE DIES: the whole screen crushed.
  useEffect(() => { if (dying) screen.current?.classList.add("talk-crt-off"); }, [dying, screen]);
  return (
    <>
    {/* BLACK BEHIND IT: torn sideways, it shows nothing of the game; crushed, nothing at all. */}
    {createPortal(<div aria-hidden className="fixed inset-0 z-[49] bg-black" />, document.body)}
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[70] overflow-hidden">
      <canvas ref={noise} width={160} height={100} className="absolute inset-0 h-full w-full mix-blend-overlay [image-rendering:pixelated]" style={{ opacity: 0.08 + 0.35 * i }} />
      <canvas ref={blocks} className="absolute inset-0 h-full w-full mix-blend-difference" />
      {/* SCANLINES, and a bright band rolling down through them. */}
      <div className="talk-scanlines absolute inset-0" style={{ opacity: 0.25 + 0.6 * i }} />
      <div className="talk-roll absolute inset-x-0 h-24" style={{ opacity: 0.15 + 0.4 * i }} />
      {/* THE FLOOD: violet in from the edges. */}
      <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at center, transparent ${60 - 45 * ease(2, 4.2, t)}%, color-mix(in oklab, var(--ui-ai) ${Math.round(85 * ease(1.5, 4.2, t))}%, black) 100%)` }} />
      {t >= TITLE_AT && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-4">
          <h2 data-text="ASCENDING" className="talk-glitch-title font-display text-4xl tracking-[0.15em] text-white sm:text-7xl sm:tracking-[0.3em]">ASCENDING</h2>
          <ol className="flex w-full max-w-md flex-col gap-0.5 font-mono text-[11px] text-[#00f0ff] sm:text-xs">
            {shown.map((l, k) => <li key={k} className="talk-line-in">{"> "}{l}{k === shown.length - 1 && <span className="animate-pulse">▌</span>}</li>)}
          </ol>
        </div>
      )}
      {dying && <div className="talk-crt-flash absolute inset-0" />}
    </div>
    </>
  );
}
