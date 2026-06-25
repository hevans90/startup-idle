import Decimal from "break_infinity.js";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { twMerge } from "tailwind-merge";
import { useGeneratorStore } from "../state/generators.store";
import { useInnovationStore } from "../state/innovation.store";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";
import { formatCurrency } from "../utils/money-utils";
import { VapeJuiceDisplay } from "./vape-juice-display";

// ─── layout constants ─────────────────────────────────────────────────────────

const TRACK_H = 400;
const TRACK_W = 160;
const HIT_ZONE_Y = 340;
const PPS = 220;
const GAME_SECS = 7;
const GAME_MS = GAME_SECS * 1000;

const BASE_W_PERFECT = 0.055;
const BASE_W_GOOD = 0.10;
const BASE_W_OK = 0.15;

// ─── combo ────────────────────────────────────────────────────────────────────

function getComboMultiplier(combo: number): number {
  if (combo >= 8) return 4;
  if (combo >= 5) return 3;
  if (combo >= 3) return 2;
  return 1;
}

function multColor(mult: number): string {
  if (mult >= 4) return "text-rose-400";
  if (mult >= 3) return "text-orange-400";
  if (mult >= 2) return "text-yellow-300";
  return "text-gray-500";
}

// ─── types ────────────────────────────────────────────────────────────────────

type NoteType = "tap" | "hold";
type Judgment = "perfect" | "good" | "ok" | "miss";
type FlashKind = Judgment | "break";

type Note = {
  id: number;
  type: NoteType;
  hitTime: number;
  duration: number;
};

type NoteState = Note & {
  judgment: Judgment | null;
  holdStartMs: number | null;
  holdEndMs: number | null;
};

type MinigameConfig = {
  tapWindowBonus: number;
  holdThreshold: number;
  forgiveness: number;
  perfectThreshold: number;
};

// ─── note generation ──────────────────────────────────────────────────────────

function generateNotes(): Note[] {
  const notes: Note[] = [];
  let t = 1.4;
  let id = 0;
  while (t < GAME_SECS - 0.5) {
    const isTap = Math.random() > 0.45;
    const duration = isTap ? 0 : 0.4 + Math.random() * 0.75;
    notes.push({ id: id++, type: isTap ? "tap" : "hold", hitTime: t, duration });
    t += (isTap ? 0 : duration) + 0.45 + Math.random() * 0.55;
  }
  return notes;
}

function computeMaxPoints(notes: Note[]): number {
  let max = 0;
  for (let i = 0; i < notes.length; i++) {
    max += 1.0 * getComboMultiplier(i);
  }
  return Math.max(1, max);
}

// ─── scoring ──────────────────────────────────────────────────────────────────

const NOTE_SCORE: Record<Judgment, number> = {
  perfect: 1.0,
  good: 0.75,
  ok: 0.5,
  miss: 0,
};

const FLASH_DISPLAY: Record<FlashKind, { text: string; className: string }> = {
  perfect: { text: "PERFECT", className: "text-yellow-300" },
  good:    { text: "GOOD",    className: "text-emerald-400" },
  ok:      { text: "OK",      className: "text-sky-400" },
  miss:    { text: "MISS",    className: "text-rose-500" },
  break:   { text: "BREAK",   className: "text-rose-600" },
};

function scoreToMultiplier(score: number, perfectThreshold: number): number {
  if (score >= perfectThreshold) return 3.5;
  if (score >= 0.78) return 2.0;
  if (score >= 0.58) return 1.2;
  if (score >= 0.35) return 0.6;
  return 0.2;
}

function scoreLabel(score: number, perfectThreshold: number): string {
  if (score >= perfectThreshold) return "🌟 Perfect cloud";
  if (score >= 0.78) return "💨 Good puff";
  if (score >= 0.58) return "😮‍💨 Not bad";
  if (score >= 0.35) return "😬 Rough hit";
  return "💀 Harsh";
}

// ─── VapeMinigame ─────────────────────────────────────────────────────────────

function VapeMinigame({
  config,
  onComplete,
}: {
  config: MinigameConfig;
  onComplete: (score: number) => void;
}) {
  const [started, setStarted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [judgeFlash, setJudgeFlash] = useState<{
    text: string;
    className: string;
    key: number;
  } | null>(null);
  const [done, setDone] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  // State-driven so the strikebar actually reacts on press/release
  const [isHeld, setIsHeld] = useState(false);
  // "hit" = green burst, "miss" = red flash
  const [strikeFlash, setStrikeFlash] = useState<"hit" | "miss" | null>(null);
  // Increments each hit to key the burst ring and remount it
  const [burstKey, setBurstKey] = useState(-1);
  const [liveScore, setLiveScore] = useState(0);

  const startMsRef = useRef<number | null>(null);
  const isHeldRef = useRef(false);
  const notesRef = useRef<NoteState[]>(
    generateNotes().map((n) => ({
      ...n,
      judgment: null,
      holdStartMs: null,
      holdEndMs: null,
    })),
  );
  const maxPossibleRef = useRef(computeMaxPoints(notesRef.current));
  const totalPointsRef = useRef(0);
  const comboRef = useRef(0);
  const maxComboRef = useRef(0);
  const completedRef = useRef(false);
  const judgeKeyRef = useRef(0);
  const mountTimeRef = useRef(Date.now());
  const judgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const strikeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fireStrike = useCallback((kind: "hit" | "miss") => {
    setStrikeFlash(kind);
    if (kind === "hit") setBurstKey((k) => k + 1);
    if (strikeTimerRef.current) clearTimeout(strikeTimerRef.current);
    strikeTimerRef.current = setTimeout(
      () => setStrikeFlash(null),
      kind === "hit" ? 130 : 300,
    );
  }, []);

  const flash = useCallback((kind: FlashKind) => {
    setJudgeFlash({ ...FLASH_DISPLAY[kind], key: judgeKeyRef.current++ });
    if (judgeTimerRef.current) clearTimeout(judgeTimerRef.current);
    judgeTimerRef.current = setTimeout(() => setJudgeFlash(null), 650);
  }, []);

  const breakCombo = useCallback(() => {
    comboRef.current = 0;
    setCombo(0);
    fireStrike("miss");
  }, [fireStrike]);

  const hitNote = useCallback(
    (idx: number, j: Judgment) => {
      const mult = getComboMultiplier(comboRef.current);
      totalPointsRef.current += NOTE_SCORE[j] * mult;
      setLiveScore(totalPointsRef.current / maxPossibleRef.current);
      if (j !== "miss") {
        comboRef.current++;
        if (comboRef.current > maxComboRef.current) {
          maxComboRef.current = comboRef.current;
          setMaxCombo(comboRef.current);
        }
        setCombo(comboRef.current);
        fireStrike("hit");
      } else {
        comboRef.current = 0;
        setCombo(0);
        fireStrike("miss");
      }
      notesRef.current[idx] = { ...notesRef.current[idx], judgment: j };
      flash(j);
    },
    [flash, fireStrike],
  );

  const handlePress = useCallback(
    (nowMs: number) => {
      const wOk = BASE_W_OK * (1 + config.tapWindowBonus);
      const wGood = BASE_W_GOOD * (1 + config.tapWindowBonus);
      const wPerfect = BASE_W_PERFECT * (1 + config.tapWindowBonus);
      const nowSec = nowMs / 1000;

      let bestIdx = -1;
      let bestDt = Infinity;
      for (let i = 0; i < notesRef.current.length; i++) {
        const n = notesRef.current[i];
        if (n.judgment !== null) continue;
        if (n.type === "hold" && n.holdStartMs !== null) continue;
        const dt = Math.abs(nowSec - n.hitTime);
        if (dt <= wOk && dt < bestDt) {
          bestDt = dt;
          bestIdx = i;
        }
      }

      if (bestIdx < 0) {
        breakCombo();
        flash("break");
        return;
      }

      const note = notesRef.current[bestIdx];
      if (note.type === "tap") {
        const j: Judgment =
          bestDt <= wPerfect ? "perfect" : bestDt <= wGood ? "good" : "ok";
        hitNote(bestIdx, j);
      } else {
        notesRef.current[bestIdx] = { ...note, holdStartMs: nowMs };
        comboRef.current++;
        if (comboRef.current > maxComboRef.current) {
          maxComboRef.current = comboRef.current;
          setMaxCombo(comboRef.current);
        }
        setCombo(comboRef.current);
        fireStrike("hit");
      }
    },
    [config.tapWindowBonus, breakCombo, flash, hitNote, fireStrike],
  );

  const handleRelease = useCallback((nowMs: number) => {
    for (let i = 0; i < notesRef.current.length; i++) {
      const n = notesRef.current[i];
      if (
        n.type === "hold" &&
        n.holdStartMs !== null &&
        n.holdEndMs === null &&
        n.judgment === null
      ) {
        notesRef.current[i] = { ...n, holdEndMs: nowMs };
        break;
      }
    }
  }, []);

  // RAF loop
  useEffect(() => {
    if (!started) return;
    let raf: number;

    const judgeHold = (i: number, nowMs: number) => {
      const n = notesRef.current[i];
      const startSec = n.holdStartMs != null ? n.holdStartMs / 1000 : null;
      const endSec = (n.holdEndMs ?? nowMs) / 1000;
      let fraction = 0;
      if (startSec !== null) {
        const clampedStart = Math.max(startSec, n.hitTime);
        const clampedEnd = Math.min(endSec, n.hitTime + n.duration);
        fraction = Math.max(0, clampedEnd - clampedStart) / Math.max(0.01, n.duration);
      }
      const j: Judgment =
        fraction >= 0.88 ? "perfect"
        : fraction >= 0.65 ? "good"
        : fraction >= config.holdThreshold ? "ok"
        : "miss";

      const mult = getComboMultiplier(comboRef.current - 1);
      totalPointsRef.current += NOTE_SCORE[j] * mult;
      setLiveScore(totalPointsRef.current / maxPossibleRef.current);

      if (j === "miss") {
        comboRef.current = 0;
        setCombo(0);
        fireStrike("miss");
      } else {
        fireStrike("hit");
      }
      notesRef.current[i] = { ...n, judgment: j };
      flash(j);
    };

    const tick = () => {
      const nowMs = Date.now() - startMsRef.current!;
      setElapsed(Math.min(nowMs, GAME_MS));
      const nowSec = nowMs / 1000;
      const wOk = BASE_W_OK * (1 + config.tapWindowBonus);

      for (let i = 0; i < notesRef.current.length; i++) {
        const n = notesRef.current[i];
        if (n.judgment !== null) continue;

        if (n.type === "tap") {
          if (nowSec > n.hitTime + wOk) {
            comboRef.current = 0;
            setCombo(0);
            notesRef.current[i] = { ...n, judgment: "miss" };
            flash("miss");
            fireStrike("miss");
          }
        } else {
          if (n.holdStartMs === null && nowSec > n.hitTime + wOk) {
            comboRef.current = 0;
            setCombo(0);
            notesRef.current[i] = { ...n, judgment: "miss" };
            flash("miss");
            fireStrike("miss");
          } else if (n.holdStartMs !== null && nowSec > n.hitTime + n.duration + 0.15) {
            judgeHold(i, nowMs);
          }
        }
      }

      if (nowMs >= GAME_MS) {
        if (!completedRef.current) {
          completedRef.current = true;
          for (let i = 0; i < notesRef.current.length; i++) {
            const n = notesRef.current[i];
            if (n.judgment !== null) continue;
            if (n.type === "hold" && n.holdStartMs !== null) {
              judgeHold(i, nowMs);
            } else {
              notesRef.current[i] = { ...n, judgment: "miss" };
            }
          }
          const missCount = notesRef.current.filter((n) => n.judgment === "miss").length;
          totalPointsRef.current +=
            Math.min(config.forgiveness, missCount) * NOTE_SCORE["ok"];
          const raw = totalPointsRef.current / maxPossibleRef.current;
          setFinalScore(Math.min(1, Math.max(0, raw)));
          setDone(true);
        }
        return;
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, flash, fireStrike, config.holdThreshold, config.forgiveness, config.tapWindowBonus]);

  // Input
  useEffect(() => {
    const onDown = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.key !== " ") return;
        if (e.repeat) return;
        e.preventDefault();
      }
      if (Date.now() - mountTimeRef.current < 150) return;
      isHeldRef.current = true;
      setIsHeld(true);
      if (!startMsRef.current) {
        startMsRef.current = Date.now();
        setStarted(true);
        return;
      }
      handlePress(Date.now() - startMsRef.current);
    };
    const onUp = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== " ") return;
      isHeldRef.current = false;
      setIsHeld(false);
      if (startMsRef.current != null)
        handleRelease(Date.now() - startMsRef.current);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [handlePress, handleRelease]);

  const currentSec = elapsed / 1000;
  const notes = notesRef.current;
  const currentMult = getComboMultiplier(combo);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center select-none">
      {/* CSS animations for judge text float and hit burst */}
      <style>{`
        @keyframes judgeFloat {
          0%   { opacity: 1; transform: translateY(0px) scale(1.05); }
          20%  { opacity: 1; transform: translateY(-6px) scale(1); }
          100% { opacity: 0; transform: translateY(-26px) scale(0.9); }
        }
        @keyframes burstRing {
          0%   { opacity: 0.85; transform: translate(-50%, -50%) scale(0.3); }
          100% { opacity: 0;    transform: translate(-50%, -50%) scale(2.4); }
        }
        @keyframes burstInner {
          0%   { opacity: 0.6; transform: translate(-50%, -50%) scale(0.2); }
          60%  { opacity: 0.4; transform: translate(-50%, -50%) scale(1.1); }
          100% { opacity: 0;   transform: translate(-50%, -50%) scale(1.6); }
        }
      `}</style>

      <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" />

      <div className="relative z-10 flex flex-col overflow-hidden rounded-2xl border border-violet-500/30 bg-gray-950 shadow-2xl shadow-violet-900/50"
        style={{ width: TRACK_W + 48 }}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-base">💨</span>
            <span className="text-xs font-bold uppercase tracking-widest text-violet-400">
              Take a puff
            </span>
          </div>
          {started && !done && (
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold tabular-nums text-violet-300/70">
                {(Math.min(1, liveScore) * 100).toFixed(0)}%
              </span>
              <span className="tabular-nums text-[10px] text-gray-600">
                {Math.max(0, GAME_SECS - currentSec).toFixed(1)}s
              </span>
            </div>
          )}
        </div>

        {/* Track */}
        {!done && (
          <div className="flex justify-center pt-3 pb-0">
            <div className="relative" style={{ width: TRACK_W, height: TRACK_H }}>

              {/* Pre-game badge — sibling of track so it isn't clipped */}
              {!started && (
                <div
                  className="pointer-events-none absolute left-0 right-0 z-10 flex justify-center animate-bounce"
                  style={{ top: HIT_ZONE_Y - 48 }}
                >
                  <div className="flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-gray-950/95 px-3 py-1 text-[10px] font-medium text-violet-300 whitespace-nowrap shadow-lg">
                    Space or click to begin 💨
                  </div>
                </div>
              )}

              {/* Inner track */}
              <div className="absolute inset-0 overflow-hidden border-x border-white/[0.05]"
                style={{ background: 'linear-gradient(to bottom, #0a0a12 0%, #0f0a1a 40%, #0d0814 100%)' }}>

                {/* Subtle lane depth lines */}
                <div className="absolute top-0 bottom-0 left-1/4 w-px bg-white/[0.03] pointer-events-none" />
                <div className="absolute top-0 bottom-0 left-3/4 w-px bg-white/[0.03] pointer-events-none" />

                {/* Horizon glow — faint violet at the bottom near hit zone */}
                <div className="absolute left-0 right-0 pointer-events-none"
                  style={{
                    top: HIT_ZONE_Y - 60,
                    height: 100,
                    background: 'radial-gradient(ellipse 80% 40% at 50% 60%, rgba(109,40,217,0.12) 0%, transparent 70%)',
                  }}
                />

                {/* Progress indicator (right edge) */}
                <div
                  className="absolute right-0 top-0 w-0.5 bg-violet-600/20"
                  style={{ height: `${(elapsed / GAME_MS) * 100}%` }}
                />

                {/* Combo display */}
                {started && !done && combo > 0 && (
                  <div className="absolute top-3 left-0 right-0 flex flex-col items-center pointer-events-none gap-0.5">
                    <span className="text-2xl font-black tabular-nums text-white leading-none"
                      style={{ textShadow: '0 0 12px rgba(167,139,250,0.7)' }}>
                      {combo}
                    </span>
                    <span className={twMerge("text-[9px] font-bold uppercase tracking-widest leading-none", multColor(currentMult))}>
                      ×{currentMult}
                    </span>
                  </div>
                )}

                {/* Notes */}
                {notes.map((n) => {
                  const headY = HIT_ZONE_Y - (n.hitTime - currentSec) * PPS;

                  if (n.type === "tap") {
                    // Ghost: missed tap slides through and fades
                    if (n.judgment === "miss") {
                      if (headY > TRACK_H + 20 || headY < -20) return null;
                      return (
                        <div
                          key={n.id}
                          className="absolute left-3 right-3 h-6 rounded-full border-2 bg-gray-700/25 border-gray-600/15"
                          style={{ top: Math.round(headY - 12) }}
                        />
                      );
                    }
                    if (n.judgment !== null) return null;
                    if (headY < -20 || headY > TRACK_H + 20) return null;
                    return (
                      <div
                        key={n.id}
                        className="absolute left-3 right-3 h-6 rounded-full bg-cyan-400 border-2 border-white/70 shadow-[0_0_14px_5px_rgba(34,211,238,0.55)]"
                        style={{ top: Math.round(headY - 12) }}
                      />
                    );
                  }

                  // Hold note
                  const isActive = n.holdStartMs !== null && n.judgment === null;
                  const isDone = n.judgment !== null;
                  // While actively holding, pin head to hit zone so the consumed portion disappears
                  const clampedHeadY = isActive && headY > HIT_ZONE_Y ? HIT_ZONE_Y : headY;
                  const tailY = HIT_ZONE_Y - (n.hitTime + n.duration - currentSec) * PPS;
                  const barH = Math.max(0, clampedHeadY - tailY);

                  // Ghost: missed hold note continues falling
                  if (isDone && n.judgment === "miss") {
                    const gHeadY = HIT_ZONE_Y - (n.hitTime - currentSec) * PPS;
                    const gTailY = HIT_ZONE_Y - (n.hitTime + n.duration - currentSec) * PPS;
                    if (gHeadY < -20 || gTailY > TRACK_H + 20) return null;
                    const gH = Math.max(0, gHeadY - gTailY);
                    return (
                      <div key={n.id} className="absolute left-3 right-3"
                        style={{ top: Math.round(gTailY), height: Math.round(gH) }}>
                        <div className="absolute inset-x-2 top-0 bottom-3 rounded-t-md bg-gray-700/20" />
                        <div className="absolute left-0 right-0 bottom-0 h-6 rounded-full border-2 bg-gray-600/20 border-gray-500/15" />
                      </div>
                    );
                  }

                  if (clampedHeadY < -20 || tailY > TRACK_H + 20) return null;

                  return (
                    <div key={n.id} className="absolute left-3 right-3"
                      style={{ top: Math.round(tailY), height: Math.round(barH) }}>
                      {/* Sustain body */}
                      <div className={twMerge(
                        "absolute inset-x-2 top-0 bottom-3 rounded-t-md",
                        isDone
                          ? "bg-violet-500/15"
                          : isActive
                            ? "bg-violet-400/80"
                            : "bg-violet-600/50",
                      )} />
                      {/* Head */}
                      <div className={twMerge(
                        "absolute left-0 right-0 bottom-0 h-6 rounded-full border-2",
                        isDone
                          ? "bg-gray-600/20 border-gray-500/15"
                          : isActive
                            ? "bg-violet-200 border-white shadow-[0_0_22px_10px_rgba(167,139,250,0.8)]"
                            : "bg-violet-400 border-violet-200/80 shadow-[0_0_12px_4px_rgba(139,92,246,0.5)]",
                      )} />
                    </div>
                  );
                })}

                {/* Judgment text — floats upward */}
                {judgeFlash && (
                  <div
                    key={judgeFlash.key}
                    className={twMerge(
                      "absolute left-0 right-0 text-center text-[11px] font-black tracking-widest uppercase pointer-events-none",
                      judgeFlash.className,
                    )}
                    style={{ top: HIT_ZONE_Y - 46, animation: 'judgeFloat 0.65s ease-out forwards' }}
                  >
                    {judgeFlash.text}
                  </div>
                )}

                {/* Strikebar — the fret button */}
                <div
                  className={twMerge(
                    "absolute left-2 right-2 rounded-full pointer-events-none transition-colors duration-75",
                    strikeFlash === "hit"
                      ? "bg-yellow-300 shadow-[0_0_24px_10px_rgba(253,224,71,0.75)]"
                      : strikeFlash === "miss"
                        ? "bg-rose-500 shadow-[0_0_20px_8px_rgba(239,68,68,0.65)]"
                        : isHeld
                          ? "bg-violet-200 shadow-[0_0_18px_7px_rgba(196,181,253,0.6)]"
                          : "bg-violet-700/80 shadow-[0_0_8px_3px_rgba(109,40,217,0.35)]",
                  )}
                  style={{ top: HIT_ZONE_Y - 6, height: 12 }}
                />

                {/* Hit burst rings */}
                {burstKey >= 0 && (
                  <>
                    <div key={`outer-${burstKey}`}
                      className="absolute w-20 h-20 rounded-full border-2 border-yellow-300/60 pointer-events-none"
                      style={{ top: HIT_ZONE_Y, left: '50%', animation: 'burstRing 0.3s ease-out forwards' }}
                    />
                    <div key={`inner-${burstKey}`}
                      className="absolute w-10 h-10 rounded-full bg-yellow-200/30 pointer-events-none"
                      style={{ top: HIT_ZONE_Y, left: '50%', animation: 'burstInner 0.25s ease-out forwards' }}
                    />
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Legend */}
        {!done && (
          <div className="flex items-center justify-center gap-4 px-4 py-2 text-[9px] uppercase tracking-widest text-gray-700">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-2.5 rounded-full bg-cyan-400/50" />
              tap
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-md bg-violet-500/50" />
              hold
            </span>
            <span className="text-gray-700/50">×{getComboMultiplier(3)} → ×{getComboMultiplier(8)}</span>
          </div>
        )}

        {/* Result */}
        {done && (
          <div className="flex flex-col items-center gap-2 px-4 py-6">
            <div className="text-3xl font-black tabular-nums text-violet-200">
              {(finalScore * 100).toFixed(0)}%
            </div>
            <div className="text-sm text-gray-300">
              {scoreLabel(finalScore, config.perfectThreshold)}
            </div>
            <div className="flex items-center gap-3 text-[10px] text-gray-600">
              <span>×{scoreToMultiplier(finalScore, config.perfectThreshold).toFixed(1)} boost</span>
              <span>·</span>
              <span>best combo {maxCombo}</span>
            </div>
            <button
              onClick={() => onComplete(finalScore)}
              className="mt-1 rounded-lg bg-violet-600 px-6 py-1.5 text-xs font-bold uppercase tracking-widest text-white hover:bg-violet-500 active:bg-violet-700"
            >
              Claim
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── VapeMapWrapper ───────────────────────────────────────────────────────────

// How long (seconds) the vape takes to fully charge after a puff
const CHARGE_SECS = 45;

export function VapeMapWrapper() {
  // Start at 1 so the vape is ready immediately on first load
  const [charge, setCharge] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [gameConfig, setGameConfig] = useState<MinigameConfig | null>(null);

  const ready = charge >= 1 && !playing;

  // Charge up when not playing and not yet full
  useEffect(() => {
    if (playing || charge >= 1) return;
    const startMs = Date.now();
    const startCharge = charge;
    const id = setInterval(() => {
      const elapsed = (Date.now() - startMs) / 1000;
      const next = Math.min(1, startCharge + elapsed / CHARGE_SECS);
      setCharge(next);
      if (next >= 1) clearInterval(id);
    }, 100);
    return () => clearInterval(id);
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps

  const buildConfig = useCallback((): MinigameConfig => {
    const s = useVapeAchievementsStore.getState();
    return {
      tapWindowBonus: s.minigameTapWindowBonus,
      holdThreshold: Math.max(0.3, 0.6 - s.minigameHoldThresholdReduction),
      forgiveness: s.minigameForgiveness,
      perfectThreshold: Math.max(0.75, 0.92 - s.minigamePerfectThresholdReduction),
    };
  }, []);

  const handleMouseDown = useCallback(() => {
    if (!ready) return;
    setCharge(0);
    setGameConfig(buildConfig());
    setPlaying(true);
  }, [ready, buildConfig]);

  const handleComplete = useCallback((score: number) => {
    setPlaying(false);
    setGameConfig(null);

    const s = useVapeAchievementsStore.getState();
    const perfectThreshold = Math.max(0.75, 0.92 - s.minigamePerfectThresholdReduction);
    const mult = scoreToMultiplier(score, perfectThreshold);
    const ips = useGeneratorStore.getState().getInnovationPerSecond();
    const boost = ips * 26 * mult * (1 + s.minigameRewardBonus);

    useInnovationStore.getState().increaseInnovation(boost);

    const boostStr = formatCurrency(new Decimal(boost), {
      showDollarSign: false,
      exponentBreakpoint: 1e6,
    });
    toast.success(
      `${scoreLabel(score, perfectThreshold)} — +${boostStr} innovation (${(score * 100).toFixed(0)}%)`,
      { duration: 5000, icon: "💨" },
    );
  }, []);

  return (
    <>
      <div
        className={twMerge("relative", ready && "cursor-pointer")}
        style={{ pointerEvents: ready ? "auto" : "none" }}
        onMouseDown={handleMouseDown}
      >
        {ready && (
          <div className="pointer-events-none absolute inset-0 z-10 animate-pulse" aria-hidden>
            <div className="absolute inset-[-12px] rounded-full bg-violet-400/20 blur-xl" />
            <div className="absolute inset-[-4px] rounded-full bg-violet-500/15 blur-md" />
          </div>
        )}
        {ready && (
          <div className="pointer-events-none absolute -top-8 left-1/2 z-10 -translate-x-1/2 animate-bounce whitespace-nowrap rounded-full border border-violet-500/40 bg-gray-950/90 px-2.5 py-0.5 text-[10px] font-medium text-violet-300">
            take a puff 💨
          </div>
        )}
        <VapeJuiceDisplay className="w-40" chargeFill={charge} />
      </div>

      {playing && gameConfig && (
        <VapeMinigame config={gameConfig} onComplete={handleComplete} />
      )}
    </>
  );
}
