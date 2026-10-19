/**
 * SOUND: every sound the game makes, made here in Web Audio — no files, so
 * nothing to license or load. Three gains under a master: the effects, and
 * the town's ambience under it.
 *
 *  - EFFECTS (`sfx`): a click for a button, a thud for a building going up, a
 *    pop for a house growing, a coin for a port's fee, a crumble for a
 *    demolition. The same one again within `REPEAT_MS` is dropped, so AI mode
 *    building a block is a patter and not a roar.
 *  - AMBIENCE (`ambience`): a low hum that swells with the town, birds by
 *    day, crickets by night.
 *
 * Browsers will not start audio before a gesture, so nothing is made until the
 * first pointer or key; and where there is no `AudioContext` at all (tests,
 * old browsers) every call is a no-op. Volume and mute are the player's, in
 * settings. @see SoundControls
 */
export type Sfx = "click" | "build" | "pop" | "coin" | "crumble";

/** The same sound again within this long is dropped, ms. */
export const REPEAT_MS = 70;
/** How loud the ambience sits under the effects, at its fullest. */
const AMBIENT = 0.35;

type Bus = { ctx: AudioContext; master: GainNode; sfx: GainNode; amb: GainNode; noise: AudioBuffer; hum: GainNode | null; birds: number; crickets: number };

let bus: Bus | null = null;
let level = { volume: 0.6, muted: false };
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

/** Start the bus, on the first gesture. Safe to call again. */
export function unlock(): void {
  if (bus || !canPlay()) { void bus?.ctx.resume(); return; }
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = gainNow();
  master.connect(ctx.destination);
  const sfx = ctx.createGain();
  sfx.connect(master);
  const amb = ctx.createGain();
  amb.gain.value = 0;
  amb.connect(master);
  // A second of white noise, for the thuds, crumbles and the hum.
  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  bus = { ctx, master, sfx, amb, noise, hum: null, birds: 0, crickets: 0 };
  startHum(bus);
  // The map's ticker drives the ambience; with the map away, it goes quiet.
  setInterval(() => {
    if (bus && performance.now() - heardAt > QUIET_AFTER_MS) bus.amb.gain.setTargetAtTime(0, bus.ctx.currentTime, 0.5);
  }, 500);
}

/** Listen for the first gesture, and for clicks on buttons. Returns how to stop. */
export function listen(): () => void {
  if (typeof window === "undefined") return () => {};
  const first = () => unlock();
  const click = (e: MouseEvent) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest?.("button, [role=button], input[type=checkbox], select")) sfx("click");
  };
  window.addEventListener("pointerdown", first, { capture: true });
  window.addEventListener("keydown", first, { capture: true });
  window.addEventListener("click", click, { capture: true });
  return () => {
    window.removeEventListener("pointerdown", first, { capture: true });
    window.removeEventListener("keydown", first, { capture: true });
    window.removeEventListener("click", click, { capture: true });
  };
}

/** Play an effect, if the bus has started and it is not a repeat. */
export function sfx(name: Sfx): void {
  if (!bus || level.muted || level.volume <= 0) return;
  const now = performance.now();
  if (now - (last[name] ?? -Infinity) < REPEAT_MS) return;
  last[name] = now;
  const { ctx } = bus, t = ctx.currentTime;
  switch (name) {
    case "click": tone(bus, "sine", 1400, 900, t, 0.035, 0.12); break;
    case "pop": tone(bus, "sine", 420, 980, t, 0.09, 0.25); tone(bus, "triangle", 1960, 1960, t + 0.05, 0.08, 0.06); break;
    case "coin": tone(bus, "square", 988, 988, t, 0.07, 0.06); tone(bus, "square", 1319, 1319, t + 0.07, 0.16, 0.06); break;
    case "build": tone(bus, "sine", 120, 55, t, 0.22, 0.5); burst(bus, t, 0.12, 900, 0.25); break;
    case "crumble": burst(bus, t, 0.45, 600, 0.4); burst(bus, t + 0.08, 0.3, 1800, 0.15); break;
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
