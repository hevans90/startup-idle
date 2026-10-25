/**
 * SOUND: every sound the game makes, made here in Web Audio — no files, so
 * nothing to license or load. Three buses under a master, each at its own
 * level: the game's effects, the interface's, and the town's ambience.
 *
 *  - EFFECTS (`sfx`): a click for a button, a thud for a building going up, a
 *    pop for a house growing, a coin for a port's fee, a crumble for a
 *    demolition; a soft rising chirp as the AI's transmission comes in, and a
 *    confirm tone for a decision made. The same one again within `REPEAT_MS`
 *    is dropped, so AI mode building a block is a patter and not a roar.
 *  - THE INTERFACE (`INTERFACE`, on its own bus): a click, a tick under the
 *    pointer (if asked for), a panel opening and closing, a purchase
 *    confirmed, a refusal, an alert, the AI's transmission and a decision —
 *    pitched up a little as the AI takes the console over. @see setConsoleMix
 *  - AMBIENCE (`ambience`): a low hum that swells with the town, birds by
 *    day, crickets by night.
 *
 * Browsers will not start audio before a gesture, so nothing is made until the
 * first pointer or key; and where there is no `AudioContext` at all (tests,
 * old browsers) every call is a no-op. Volume and mute are the player's, in
 * settings. @see SoundControls
 */
export type Sfx = "click" | "build" | "pop" | "coin" | "crumble" | "transmission" | "decision"
  | "tick" | "open" | "close" | "confirm" | "deny" | "alert";
/** The interface's sounds, on its own bus. */
export const INTERFACE: ReadonlySet<Sfx> = new Set(["click", "transmission", "decision", "tick", "open", "close", "confirm", "deny", "alert"]);

/** The same sound again within this long is dropped, ms. */
export const REPEAT_MS = 70;
/** How loud the ambience sits under the effects, at its fullest. */
const AMBIENT = 0.35;

type Bus = { ctx: AudioContext; master: GainNode; sfx: GainNode; ui: GainNode; amb: GainNode; ambLevel: GainNode; noise: AudioBuffer; hum: GainNode | null; birds: number; crickets: number };

let bus: Bus | null = null;
let level = { volume: 0.6, muted: false };
/** Each bus's share of the level, and whether the interface ticks. */
let mix = { effects: 1, interface: 0.5, ambience: 1, ticks: false };
/** How far the AI has taken the console over, 0–1: the interface's pitch rises with it. @see installTheme */
let consoleMix = 0;
const last: Partial<Record<Sfx, number>> = {};
let mood = { town: 0, night: 0 };
/** When the ambience was last told about the town; it fades out if that stops — the map hidden. */
let heardAt = 0;
const QUIET_AFTER_MS = 2000;

/** Whether this browser can play sound at all. */
export const canPlay = () => typeof AudioContext !== "undefined";

/** The level the player set: 0–1, and muted or not. */
export function setLevel(volume: number, muted: boolean) {
  level = { volume: Math.max(0, Math.min(1, volume)), muted };
  if (bus) bus.master.gain.setTargetAtTime(gainNow(), bus.ctx.currentTime, 0.05);
}
/** What the master gain is, for the level set. */
export const gainNow = () => (level.muted ? 0 : level.volume * level.volume);

/** Each bus's share of the level, and whether the interface ticks under the pointer. */
export function setMix(m: Partial<typeof mix>) {
  mix = { ...mix, ...m };
  if (!bus) return;
  const t = bus.ctx.currentTime;
  bus.sfx.gain.setTargetAtTime(mix.effects, t, 0.05);
  bus.ui.gain.setTargetAtTime(mix.interface, t, 0.05);
  bus.ambLevel.gain.setTargetAtTime(mix.ambience, t, 0.05);
}
export const mixNow = () => mix;
/** The takeover's mix, for the interface's pitch. */
export const setConsoleMix = (m: number) => { consoleMix = Math.max(0, Math.min(1, m)); };

/** Start the bus, on the first gesture. Safe to call again. */
export function unlock(): void {
  if (bus || !canPlay()) { void bus?.ctx.resume(); return; }
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = gainNow();
  master.connect(ctx.destination);
  const sfx = ctx.createGain();
  sfx.gain.value = mix.effects;
  sfx.connect(master);
  const ui = ctx.createGain();
  ui.gain.value = mix.interface;
  ui.connect(master);
  // The ambience swells and fades by itself; its level sits after that.
  const ambLevel = ctx.createGain();
  ambLevel.gain.value = mix.ambience;
  ambLevel.connect(master);
  const amb = ctx.createGain();
  amb.gain.value = 0;
  amb.connect(ambLevel);
  // A second of white noise, for the thuds, crumbles and the hum.
  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  bus = { ctx, master, sfx, ui, amb, ambLevel, noise, hum: null, birds: 0, crickets: 0 };
  startHum(bus);
  // The map's ticker drives the ambience; with the map away, it goes quiet.
  setInterval(() => {
    if (bus && performance.now() - heardAt > QUIET_AFTER_MS) bus.amb.gain.setTargetAtTime(0, bus.ctx.currentTime, 0.5);
  }, 500);
}

/** What can be acted on: a click on it clicks, a pointer arriving on it ticks. */
const ACTABLE = "button:not(:disabled), [role=button], [role=tab], input[type=checkbox], select";
/** A tick at most this often, ms; never twice for the same thing. */
const TICK_MS = 60;

/** Listen for the first gesture, for clicks on buttons and, if asked for, for the pointer arriving on one. Returns how to stop. */
export function listen(): () => void {
  if (typeof window === "undefined") return () => {};
  const first = () => unlock();
  const click = (e: MouseEvent) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest?.(ACTABLE)) sfx("click");
  };
  let over: Element | null = null, tickedAt = 0;
  const hover = (e: PointerEvent) => {
    if (!mix.ticks || e.pointerType === "touch") return;
    const el = (e.target as HTMLElement | null)?.closest?.(ACTABLE) ?? null;
    if (el === over) return;
    over = el;
    const now = performance.now();
    if (el && now - tickedAt >= TICK_MS) { tickedAt = now; sfx("tick"); }
  };
  window.addEventListener("pointerdown", first, { capture: true });
  window.addEventListener("keydown", first, { capture: true });
  window.addEventListener("click", click, { capture: true });
  window.addEventListener("pointerover", hover, { capture: true, passive: true });
  return () => {
    window.removeEventListener("pointerdown", first, { capture: true });
    window.removeEventListener("keydown", first, { capture: true });
    window.removeEventListener("click", click, { capture: true });
    window.removeEventListener("pointerover", hover, { capture: true });
  };
}

/** Play an effect, if the bus has started and it is not a repeat. */
export function sfx(name: Sfx): void {
  if (!bus || level.muted || level.volume <= 0) return;
  const now = performance.now();
  if (now - (last[name] ?? -Infinity) < REPEAT_MS) return;
  last[name] = now;
  const { ctx } = bus, t = ctx.currentTime;
  // THE INTERFACE'S, on its bus, a little higher as the AI takes the console over.
  const ui = INTERFACE.has(name) ? bus.ui : bus.sfx, p = INTERFACE.has(name) ? 1 + 0.12 * consoleMix : 1;
  const note = (type: OscillatorType, f0: number, f1: number, at: number, dur: number, peak: number) => tone(bus!, type, f0 * p, f1 * p, at, dur, peak, ui);
  switch (name) {
    case "click": note("sine", 1400, 900, t, 0.035, 0.12); break;
    case "tick": note("sine", 2600, 2400, t, 0.012, 0.04); break;
    case "open": note("sine", 660, 990, t, 0.09, 0.07); note("sine", 1320, 1320, t + 0.05, 0.06, 0.04); break;
    case "close": note("sine", 990, 600, t, 0.08, 0.06); break;
    case "confirm": note("triangle", 880, 880, t, 0.06, 0.1); note("triangle", 1320, 1320, t + 0.06, 0.12, 0.09); break;
    case "deny": note("square", 220, 180, t, 0.07, 0.05); note("square", 180, 150, t + 0.08, 0.09, 0.05); break;
    case "alert": for (let k = 0; k < 2; k++) note("triangle", 1046, 1046, t + k * 0.16, 0.1, 0.1); break;
    case "pop": tone(bus, "sine", 420, 980, t, 0.09, 0.25); tone(bus, "triangle", 1960, 1960, t + 0.05, 0.08, 0.06); break;
    case "coin": tone(bus, "square", 988, 988, t, 0.07, 0.06); tone(bus, "square", 1319, 1319, t + 0.07, 0.16, 0.06); break;
    case "build": tone(bus, "sine", 120, 55, t, 0.22, 0.5); burst(bus, t, 0.12, 900, 0.25); break;
    case "crumble": burst(bus, t, 0.45, 600, 0.4); burst(bus, t + 0.08, 0.3, 1800, 0.15); break;
    // THE AI'S TRANSMISSION: three soft rising chirps, each a little higher. @see quest-ui
    case "transmission": for (let k = 0; k < 3; k++) note("sine", 520 * 1.26 ** k, 780 * 1.26 ** k, t + k * 0.09, 0.14, 0.09); break;
    // A DECISION: two notes up a fifth, the second held.
    case "decision": note("triangle", 660, 660, t, 0.08, 0.14); note("triangle", 990, 990, t + 0.08, 0.24, 0.12); break;
  }
}

/** The town's ambience: `town` 0–1 how big it is, `night` 0–1 how dark. Call a few times a second. */
export function ambience(town: number, night: number): void {
  mood = { town: Math.max(0, Math.min(1, town)), night: Math.max(0, Math.min(1, night)) };
  heardAt = performance.now();
  if (!bus) return;
  const t = bus.ctx.currentTime;
  bus.amb.gain.setTargetAtTime(AMBIENT * (0.25 + 0.75 * mood.town), t, 1);
  if (bus.hum) bus.hum.gain.setTargetAtTime(0.5 * mood.town * (1 - 0.5 * mood.night), t, 1);
  // Now and then a bird by day, a run of crickets by night; more of both in a bigger town.
  if (t > bus.birds && mood.night < 0.5 && Math.random() < 0.15 + 0.2 * mood.town) {
    chirp(bus, t);
    bus.birds = t + 1.5 + Math.random() * 4;
  }
  if (t > bus.crickets && mood.night >= 0.5) {
    crickets(bus, t);
    bus.crickets = t + 0.8 + Math.random() * 1.5;
  }
}

/** A tone swept from `f0` to `f1`, `dur` seconds, with a quick attack and a decay. */
function tone(b: Bus, type: OscillatorType, f0: number, f1: number, at: number, dur: number, peak: number, out: AudioNode = b.sfx) {
  const o = b.ctx.createOscillator(), g = b.ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.01, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + dur + 0.02);
}

/** A burst of noise through a low-pass at `cutoff`, `dur` seconds. */
function burst(b: Bus, at: number, dur: number, cutoff: number, peak: number) {
  const s = b.ctx.createBufferSource(), f = b.ctx.createBiquadFilter(), g = b.ctx.createGain();
  s.buffer = b.noise;
  f.type = "lowpass";
  f.frequency.value = cutoff;
  g.gain.setValueAtTime(peak, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  s.connect(f).connect(g).connect(b.sfx);
  s.start(at, Math.random() * 0.5);
  s.stop(at + dur + 0.02);
}

/** The town's hum: noise, looped, low-passed hard, under everything. */
function startHum(b: Bus) {
  const s = b.ctx.createBufferSource(), f = b.ctx.createBiquadFilter(), g = b.ctx.createGain();
  s.buffer = b.noise;
  s.loop = true;
  f.type = "lowpass";
  f.frequency.value = 220;
  g.gain.value = 0;
  s.connect(f).connect(g).connect(b.amb);
  s.start();
  b.hum = g;
}

/** A bird: two or three quick rising whistles. */
function chirp(b: Bus, at: number) {
  const base = 2400 + Math.random() * 1600;
  const n = 2 + Math.floor(Math.random() * 2);
  for (let k = 0; k < n; k++) tone(b, "sine", base, base * 1.35, at + k * 0.11, 0.07, 0.12, b.amb);
}

/** Crickets: a short train of high pulses. */
function crickets(b: Bus, at: number) {
  for (let k = 0; k < 6; k++) tone(b, "sine", 4600, 4500, at + k * 0.045, 0.025, 0.05, b.amb);
}
