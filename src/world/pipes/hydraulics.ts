/**
 * World v2 — WATER THROUGH THE MAINS, SOLVED AS FLOW: the host's reference
 * solver over the pipe graph. @see plans/pipe-network.md §2
 *
 * A NODE holds water and so a head; a LINK holds a discharge. Each step a
 * link's discharge is pushed by the head across it and held back by friction
 * that grows with its square, taken implicitly; a node's water follows from
 * what its links brought. Nothing leaves a node that it does not hold. A pipe
 * that is not yet full has a free surface; a full one stores what more comes
 * in a narrow SLOT above its crown, so its head climbs steeply and part-full
 * and under pressure are one piece of code.
 *
 * WHAT IT IS CALIBRATED TO. One intake, one run, one outlet carries what
 * `mainFlow` says at the run the old pipes were measured on: twenty tiles.
 * The head is lost in three places — coming in, along the run by its length,
 * going out — each as the square of the flow:
 *
 *     head = flow² × (ENDS + RUN × tiles) / bore²
 *
 * so a shared trunk's water is SHARED among its outlets, a dead-end stub
 * costs nothing, and a near outlet is fed faster than a far one: the three
 * things the one-formula-a-network model had wrong. At other lengths it
 * differs a little from `mainFlow`, whose loss went as the length squared:
 * the same at 20 tiles, about 7% more at 40. @see mains-shared.test
 *
 * A MAIN IS A PRESSURE PIPE, kept primed: the ground it crosses does not stop
 * it, as it never did. What drives it is the water's level at its intake
 * over the floor of the building it feeds.
 *
 * Pure: it is handed the water levels and told what each tank has room for,
 * and says what it took and gave. @see runMains, which runs it on the map
 */
import { MAIN_MAX, MAIN_REF_FLOW, MAIN_REF_HEAD, PUMP_MOST, pumpLift } from "../../game/mains";
import type { PipeGraph } from "./graph";

/** Head lost at a flow of one, bore one: at the two ends together, and a tile of run. Fitted to `mainFlow` at nought and at twenty tiles. */
const ONE = MAIN_REF_HEAD / (MAIN_REF_FLOW * MAIN_REF_FLOW);
export const RUN_LOSS = (ONE * (1.5 * 1.5 - 1)) / 20;
export const ENDS_LOSS = ONE;
/** Half steps a main's bore is tall, for how full it stands. */
export const PIPE_TALL = 1;
/** Water a tile of main holds, a bore, full. Sets how long a main takes to fill: twenty tiles in two or three seconds. */
export const PIPE_HOLDS = 0.15;
/** Water a node takes for each half step of head once it is full: the slot. Small, so pressure comes up in about a second. */
export const SLOT = 0.05;
/** How quickly a link's discharge answers the head across it, a second. */
const INERTIA = 2;
/** The solver's own step, seconds: the frame's is cut into these. */
export const PIPE_STEP = 1 / 120;

export type WaterModel = {
  /** The graph's nodes in this system, and each one's place here. */
  nodes: number[];
  /** Each node's cell on the map. */
  cells: number[];
  /** Water each node holds when its pipe is just full. */
  full: Float64Array;
  links: { a: number; b: number; loss: number; most: number; graph: number }[];
  /** Each intake: its node, its cell, whether it has a pump, and the bore it draws through. */
  intakes: { node: number; cell: number; pump: boolean; bore: number }[];
  /** Each outlet: its node, its cell, the loss going out, and the most it passes. */
  outlets: { node: number; cell: number; loss: number; most: number }[];
  /** Which intake a node is, −1 for none. */
  intakeAt: Int32Array;
};

/** One system of water mains, made ready to solve. */
export function waterModel(graph: PipeGraph, system: number): WaterModel {
  const sys = graph.systems[system];
  const at = new Map<number, number>();
  sys.nodes.forEach((id, k) => at.set(id, k));
  const full = new Float64Array(sys.nodes.length);
  const links: WaterModel["links"] = [];
  for (const id of sys.links) {
    const l = graph.links[id];
    const a = at.get(l.a)!, b = at.get(l.b)!;
    links.push({ a, b, loss: (RUN_LOSS * l.length) / (l.bore * l.bore), most: Infinity, graph: id });
    // Half of each run's water stands at each of its ends.
    full[a] += (PIPE_HOLDS * l.length * l.bore) / 2;
    full[b] += (PIPE_HOLDS * l.length * l.bore) / 2;
  }
  for (let k = 0; k < full.length; k++) full[k] = Math.max(full[k], PIPE_HOLDS / 2);
  /** The widest bore that meets at a node: what its fitting is cut for. */
  const boreAt = (k: number) => Math.max(1, ...graph.nodes[sys.nodes[k]].links.map((l) => graph.links[l].bore));
  const intakes: WaterModel["intakes"] = [], outlets: WaterModel["outlets"] = [];
  const intakeAt = new Int32Array(sys.nodes.length).fill(-1);
  // THE ENDS' LOSS, half coming in and half going out — and the tile the run's
  // count leaves off, an end's own: a run of twenty tiles is nineteen steps.
  const end = (ENDS_LOSS + RUN_LOSS) / 2;
  sys.nodes.forEach((id, k) => {
    const node = graph.nodes[id], bore = boreAt(k);
    if (node.kind === "intake" || node.kind === "pump") {
      intakeAt[k] = intakes.length;
      intakes.push({ node: k, cell: node.cell, pump: node.kind === "pump", bore });
      // Coming in is lost on the way out of the intake, along whichever link takes it.
      for (const l of links) if (l.a === k || l.b === k) l.loss += end / (bore * bore);
    } else if (node.kind === "outlet") {
      outlets.push({ node: k, cell: node.cell, loss: end / (bore * bore), most: MAIN_MAX * bore });
    }
  });
  return { nodes: sys.nodes, cells: sys.nodes.map((id) => graph.nodes[id].cell), full, links, intakes, outlets, intakeAt };
}

/** What the solver is told of the world, a step: each intake's water level (null where dry) and whether its pump runs; each outlet's floor, and whether it takes anything. */
export type WaterEnv = {
  surface: (number | null)[];
  pumping: boolean[];
  sill: number[];
  open: boolean[];
};

/** The head an intake offers, and the most it lets through: a pump lifts, and moves only so much. */
const source = (m: WaterModel, env: WaterEnv, k: number) => {
  const s = env.surface[k];
  if (s === null) return null;
  const pumped = m.intakes[k].pump && env.pumping[k];
  return { head: s + (pumped ? pumpLift() : 0), most: pumped ? PUMP_MOST * m.intakes[k].bore : Infinity, pumped };
};

/** A flow through a loss, from the head across it. */
const through = (dh: number, loss: number) => (dh >= 0 ? Math.sqrt(dh / loss) : -Math.sqrt(-dh / loss));

export type Steady = {
  /** Each node's head; NaN where no water reaches. */
  head: Float64Array;
  /** Each link's flow, from `a` to `b`. */
  flow: Float64Array;
  /** What each outlet passes, and each intake draws, a second. */
  out: Float64Array;
  in: Float64Array;
  /** Whether each outlet's water comes by a pump's lift. */
  pumped: boolean[];
};

/**
 * THE STEADY FLOW: what the system carries once it has filled and settled,
 * with every open outlet taking all it is given. What the cards and previews
 * quote, and what a network starts at when a map is loaded. Each node's head
 * is found where what comes into it equals what leaves, round and round till
 * none moves.
 */
export function steadyFlow(m: WaterModel, env: WaterEnv, from?: Steady): Steady {
  const n = m.nodes.length;
  const head = new Float64Array(n).fill(NaN), flow = new Float64Array(m.links.length);
  const out = new Float64Array(m.outlets.length), into = new Float64Array(m.intakes.length);
  const pumped = m.outlets.map(() => false);
  const src = m.intakes.map((_, k) => source(m, env, k));
  let top = -Infinity, low = Infinity;
  src.forEach((s) => { if (s) top = Math.max(top, s.head); });
  if (top === -Infinity) return { head, flow, out, in: into, pumped };
  m.outlets.forEach((_, k) => { if (env.open[k]) low = Math.min(low, env.sill[k]); });
  src.forEach((s) => { if (s) low = Math.min(low, s.head); });
  const linksOf: number[][] = Array.from({ length: n }, () => []);
  m.links.forEach((l, k) => { linksOf[l.a].push(k); linksOf[l.b].push(k); });
  const outletsOf: number[][] = Array.from({ length: n }, () => []);
  m.outlets.forEach((o, k) => outletsOf[o.node].push(k));
  // Begun from where it last settled, if told: the water moves little between two askings, and so do the heads.
  for (let i = 0; i < n; i++) {
    const k = m.intakeAt[i], was = from?.head[i];
    head[i] = k >= 0 && src[k] ? src[k]!.head : was !== undefined && !Number.isNaN(was) ? Math.min(top, Math.max(low, was)) : top;
  }

  /** A link's flow from `a` to `b` at the heads given: a pump's link no more than it moves, and none back into an intake. */
  const linkFlow = (k: number, ha: number, hb: number) => {
    const l = m.links[k];
    let q = through(ha - hb, l.loss);
    for (const [end, sign] of [[l.a, 1], [l.b, -1]] as const) {
      if (m.intakeAt[end] < 0) continue;
      const s = src[m.intakeAt[end]], leaving = q * sign;
      if (!s || leaving < 0) q = 0;                       // dry, or flowing back: shut
      else if (leaving > s.most) q = s.most * sign;
    }
    return q;
  };
  const outFlow = (k: number, h: number) => (env.open[k] && h > env.sill[k] ? Math.min(m.outlets[k].most, Math.sqrt((h - env.sill[k]) / m.outlets[k].loss)) : 0);
  /** What a node gains a second at head `h`, its neighbours where they are. */
  const gain = (i: number, h: number) => {
    let q = 0;
    for (const k of linksOf[i]) {
      const l = m.links[k];
      q += l.a === i ? -linkFlow(k, h, head[l.b]) : linkFlow(k, head[l.a], h);
    }
    for (const k of outletsOf[i]) q -= outFlow(k, h);
    return q;
  };
  // DEAD ENDS FIRST: a branch that neither draws nor delivers carries nothing
  // and stands at the head of where it leaves the run. Taken off, leaf by
  // leaf, before the rest is solved — left in, a flow of nearly nought moves
  // its head by next to nothing a round and the rounds never end.
  const idle = new Uint8Array(n), degree = linksOf.map((l) => l.length), parent = new Int32Array(n).fill(-1);
  const ends = (i: number) => (m.intakeAt[i] >= 0 && !!src[m.intakeAt[i]]) || outletsOf[i].some((k) => env.open[k] && env.sill[k] < top);
  const stack: number[] = [], pruned: number[] = [];
  for (let i = 0; i < n; i++) if (degree[i] <= 1 && !ends(i)) stack.push(i);
  while (stack.length) {
    const i = stack.pop()!;
    if (idle[i]) continue;
    idle[i] = 1;
    pruned.push(i);
    for (const k of linksOf[i]) {
      const j = m.links[k].a === i ? m.links[k].b : m.links[k].a;
      if (idle[j]) continue;
      parent[i] = j;
      if (--degree[j] <= 1 && !ends(j)) stack.push(j);
    }
  }
  const live = (k: number) => !idle[m.links[k].a] && !idle[m.links[k].b];
  for (let i = 0; i < n; i++) linksOf[i] = linksOf[i].filter(live);
  /** One round, node by node: each put where what comes into it equals what leaves, its neighbours where they are. How far the furthest moved. */
  const round = (): number => {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      if (idle[i] || (m.intakeAt[i] >= 0 && src[m.intakeAt[i]])) continue;
      // The gain falls as the head rises: halve between the lowest it could be and the highest.
      let lo = low, hi = top;
      for (let it = 0; it < 48; it++) {
        const mid = (lo + hi) / 2;
        if (gain(i, mid) > 0) lo = mid; else hi = mid;
      }
      const h = (lo + hi) / 2;
      moved = Math.max(moved, Math.abs(h - head[i]));
      head[i] = h;
    }
    return moved;
  };
  // NEWTON, on every head at once: what each node gains and how that changes
  // with each head, solved for the step that brings every gain to nought,
  // shortened where a full step would overshoot. A dozen rounds, where going
  // round node by node took thousands. The square root is rounded off at
  // nought so its slope there is steep, not endless.
  const EPS = 1e-10;
  const soft = (dh: number, loss: number) => dh / Math.sqrt(loss * (Math.abs(dh) + EPS));
  const slope = (dh: number, loss: number) => (Math.abs(dh) / 2 + EPS) / (Math.sqrt(loss) * Math.pow(Math.abs(dh) + EPS, 1.5));
  const at = new Int32Array(n).fill(-1);
  const free: number[] = [];
  for (let i = 0; i < n; i++) if (!idle[i] && !(m.intakeAt[i] >= 0 && src[m.intakeAt[i]])) { at[i] = free.length; free.push(i); }
  const u = free.length;
  let settled = u === 0;
  if (u > 0 && u <= 400) {
    const F = new Float64Array(u), J = new Float64Array(u * u), step = new Float64Array(u), trial = new Float64Array(n);
    /** Every free node's gain at the heads given, into `F`; and how each changes with each head, into `J`, if asked. The largest gain. */
    const gains = (h: Float64Array, slopes: boolean): number => {
      F.fill(0);
      if (slopes) J.fill(0);
      for (let k = 0; k < m.links.length; k++) {
        if (!live(k)) continue;
        const l = m.links[k];
        let q = soft(h[l.a] - h[l.b], l.loss), d = slopes ? slope(h[l.a] - h[l.b], l.loss) : 0;
        for (const [end, sign] of [[l.a, 1], [l.b, -1]] as const) {
          if (m.intakeAt[end] < 0) continue;
          const x = src[m.intakeAt[end]], leaving = q * sign;
          if (!x || leaving < 0) { q = 0; d = 0; } else if (leaving > x.most) { q = x.most * sign; d = 0; }
        }
        const a = at[l.a], b = at[l.b];
        if (a >= 0) F[a] -= q;
        if (b >= 0) F[b] += q;
        if (slopes) {
          if (a >= 0) { J[a * u + a] -= d; if (b >= 0) J[a * u + b] += d; }
          if (b >= 0) { J[b * u + b] -= d; if (a >= 0) J[b * u + a] += d; }
        }
      }
      for (let k = 0; k < m.outlets.length; k++) {
        const i = at[m.outlets[k].node], over = h[m.outlets[k].node] - env.sill[k];
        if (i < 0 || !env.open[k] || over <= 0) continue;
        const q = soft(over, m.outlets[k].loss);
        if (q >= m.outlets[k].most) F[i] -= m.outlets[k].most;
        else { F[i] -= q; if (slopes) J[i * u + i] -= slope(over, m.outlets[k].loss); }
      }
      let worst = 0;
      for (let i = 0; i < u; i++) worst = Math.max(worst, Math.abs(F[i]));
      return worst;
    };
    for (let turn = 0; turn < 80 && !settled; turn++) {
      const worst = gains(head, true);
      if (worst < 1e-11) { settled = true; break; }
      // J × step = −F, by elimination with the largest pivot.
      for (let i = 0; i < u; i++) { step[i] = -F[i]; J[i * u + i] -= 1e-12; }
      for (let c = 0; c < u; c++) {
        let p = c;
        for (let r = c + 1; r < u; r++) if (Math.abs(J[r * u + c]) > Math.abs(J[p * u + c])) p = r;
        if (p !== c) { for (let k = c; k < u; k++) { const t = J[c * u + k]; J[c * u + k] = J[p * u + k]; J[p * u + k] = t; } const t = step[c]; step[c] = step[p]; step[p] = t; }
        const pivot = J[c * u + c];
        if (pivot === 0) continue;
        for (let r = c + 1; r < u; r++) {
          const f = J[r * u + c] / pivot;
          if (f === 0) continue;
          for (let k = c; k < u; k++) J[r * u + k] -= f * J[c * u + k];
          step[r] -= f * step[c];
        }
      }
      for (let c = u - 1; c >= 0; c--) {
        let v = step[c];
        for (let k = c + 1; k < u; k++) v -= J[c * u + k] * step[k];
        step[c] = J[c * u + c] !== 0 ? v / J[c * u + c] : 0;
      }
      let took = false;
      for (let t = 1; t > 1e-6; t /= 2) {
        trial.set(head);
        for (let i = 0; i < u; i++) trial[free[i]] = Math.min(top, Math.max(low, head[free[i]] + t * step[i]));
        if (gains(trial, false) < worst) { head.set(trial); took = true; break; }
      }
      // Stalled, at a pump's limit or an outlet's: a round node by node moves it off, and Newton goes on.
      if (!took && round() < 1e-10) settled = true;
    }
    if (!settled) settled = gains(head, false) < 1e-7;
  }
  // Round and round, node by node, for whatever Newton did not settle.
  for (let k = 0; k < 2000 && !settled; k++) if (round() < 1e-10) break;
  // A dead end stands at the head of what it hangs off; one hanging off nothing has no water.
  for (let k = pruned.length - 1; k >= 0; k--) head[pruned[k]] = parent[pruned[k]] >= 0 ? head[parent[pruned[k]]] : NaN;
  m.links.forEach((l, k) => { flow[k] = live(k) ? linkFlow(k, head[l.a], head[l.b]) : 0; });
  m.outlets.forEach((o, k) => { out[k] = idle[o.node] ? 0 : outFlow(k, head[o.node]); });
  m.intakes.forEach((t, k) => {
    for (const j of linksOf[t.node]) into[k] += m.links[j].a === t.node ? flow[j] : -flow[j];
  });
  // PUMPED, where a pump's lift is the highest head on offer.
  let lifted = -Infinity, plain = -Infinity;
  for (const x of src) if (x) { if (x.pumped) lifted = Math.max(lifted, x.head); else plain = Math.max(plain, x.head); }
  m.outlets.forEach((_, k) => { pumped[k] = out[k] > 0 && lifted > plain; });
  return { head, flow, out, in: into, pumped };
}

/** A system's water as it stands: what each node holds, and each link's discharge. */
export type WaterState = {
  held: Float64Array;
  flow: Float64Array;
  /**
   * The level everything in it is measured up from, set when water first
   * moves in it and kept: moved with the lake a frame at a time, it shook
   * every node's pressure with every ripple at the intake. NaN till then.
   */
  floor: number;
};

export const emptyWater = (m: WaterModel): WaterState => ({ held: new Float64Array(m.nodes.length), flow: new Float64Array(m.links.length), floor: NaN });

/** The level everything in a system is measured up from: under its lowest floor and its lowest water, by a pipe and a little. */
function floorOf(env: WaterEnv): number {
  let low = Infinity;
  env.sill.forEach((s) => { if (Number.isFinite(s)) low = Math.min(low, s); });
  env.surface.forEach((s) => { if (s !== null) low = Math.min(low, s); });
  return (Number.isFinite(low) ? low : 0) - PIPE_TALL - 1;
}

/** A node's head from what it holds: up its bore till full, then up the slot. */
const headOf = (held: number, full: number, floor: number) =>
  held <= full ? floor + PIPE_TALL * (held / full) : floor + PIPE_TALL + (held - full) / SLOT;

/** A system full and settled: what it holds at its steady flow. For a map just loaded. */
export function settledWater(m: WaterModel, env: WaterEnv): WaterState {
  const st = emptyWater(m), s = steadyFlow(m, env), floor = floorOf(env);
  st.floor = floor;
  for (let i = 0; i < m.nodes.length; i++) {
    // An intake holds nothing of its own: it is the water it stands in.
    if (Number.isNaN(s.head[i]) || m.intakeAt[i] >= 0) continue;
    st.held[i] = m.full[i] + Math.max(0, s.head[i] - floor - PIPE_TALL) * SLOT;
  }
  st.flow.set(s.flow);
  return st;
}

/** How full each node's pipe stands, nought to one. For the tubes to draw. */
export const fillOf = (m: WaterModel, st: WaterState, i: number) => Math.min(1, st.held[i] / m.full[i]);
/** All the water in a system's pipes. */
export const waterHeld = (st: WaterState) => st.held.reduce((n, v) => n + v, 0);

/**
 * ONE FRAME OF A SYSTEM: `dt` seconds, in the solver's own steps. `take`
 * draws water at an intake and says how much there was; `give` offers water
 * at an outlet and says how much went in. Returns what each outlet was given
 * and each intake gave up, over the frame.
 */
export function stepWater(
  m: WaterModel, st: WaterState, env: WaterEnv, dt: number,
  take: (intake: number, amount: number) => number,
  give: (outlet: number, amount: number) => number,
): { out: Float64Array; in: Float64Array } {
  const n = m.nodes.length;
  const out = new Float64Array(m.outlets.length), into = new Float64Array(m.intakes.length);
  if (dt <= 0) return { out, in: into };
  if (Number.isNaN(st.floor)) st.floor = floorOf(env);
  const floor = st.floor;
  const src = m.intakes.map((_, k) => source(m, env, k));
  const head = new Float64Array(n), leaving = new Float64Array(n), share = new Float64Array(n);
  const steps = Math.max(1, Math.ceil(dt / PIPE_STEP)), h = dt / steps;
  const want = new Float64Array(m.outlets.length);
  for (let step = 0; step < steps; step++) {
    for (let i = 0; i < n; i++) {
      const k = m.intakeAt[i];
      head[i] = k >= 0 && src[k] ? src[k]!.head : headOf(st.held[i], m.full[i], floor);
    }
    // THE LINKS: pushed by the head across, held back by the square of the flow.
    for (let k = 0; k < m.links.length; k++) {
      const l = m.links[k];
      let q = (st.flow[k] + h * INERTIA * (head[l.a] - head[l.b])) / (1 + h * INERTIA * l.loss * Math.abs(st.flow[k]));
      for (const [end, sign] of [[l.a, 1], [l.b, -1]] as const) {
        const t = m.intakeAt[end];
        if (t < 0) continue;
        const s = src[t], go = q * sign;
        if (!s || go < 0) q = 0;
        else if (go > s.most) q = s.most * sign;
      }
      st.flow[k] = q;
    }
    // THE OUTLETS: what the head over the floor pushes out, if anything takes it.
    for (let k = 0; k < m.outlets.length; k++) {
      const o = m.outlets[k], over = head[o.node] - env.sill[k];
      want[k] = env.open[k] && over > 0 ? Math.min(o.most, Math.sqrt(over / o.loss)) : 0;
    }
    // NOTHING LEAVES A NODE THAT IT DOES NOT HOLD: what would, cut back in proportion.
    leaving.fill(0);
    for (let k = 0; k < m.links.length; k++) { const l = m.links[k], q = st.flow[k]; leaving[q > 0 ? l.a : l.b] += Math.abs(q) * h; }
    for (let k = 0; k < m.outlets.length; k++) leaving[m.outlets[k].node] += want[k] * h;
    for (let i = 0; i < n; i++) share[i] = m.intakeAt[i] >= 0 ? 1 : leaving[i] > st.held[i] ? st.held[i] / leaving[i] : 1;
    for (let k = 0; k < m.links.length; k++) {
      const l = m.links[k], from = st.flow[k] > 0 ? l.a : l.b;
      if (share[from] < 1) st.flow[k] *= share[from];
    }
    // AN INTAKE gives what the water has: its links cut back to that.
    for (let t = 0; t < m.intakes.length; t++) {
      if (!src[t]) continue;
      const node = m.intakes[t].node;
      let draw = 0;
      for (let k = 0; k < m.links.length; k++) { const l = m.links[k]; if (l.a === node) draw += st.flow[k]; else if (l.b === node) draw -= st.flow[k]; }
      if (draw <= 0) continue;
      const got = take(t, draw * h);
      into[t] += got;
      if (got < draw * h) {
        const part = got / (draw * h);
        for (let k = 0; k < m.links.length; k++) { const l = m.links[k]; if (l.a === node || l.b === node) st.flow[k] *= part; }
      }
    }
    for (let k = 0; k < m.links.length; k++) {
      const l = m.links[k], v = st.flow[k] * h;
      if (m.intakeAt[l.a] < 0) st.held[l.a] -= v;
      if (m.intakeAt[l.b] < 0) st.held[l.b] += v;
    }
    for (let k = 0; k < m.outlets.length; k++) {
      const node = m.outlets[k].node;
      const offer = Math.min(want[k] * h * share[node], Math.max(0, st.held[node]));
      if (offer <= 0) continue;
      const went = give(k, offer);
      st.held[node] -= went;
      out[k] += went;
    }
    for (let i = 0; i < n; i++) if (st.held[i] < 0) st.held[i] = 0;
  }
  return { out, in: into };
}
