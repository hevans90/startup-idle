/**
 * The water mains, solved on the device beside the water.
 *
 * The host's link-and-node solver (`world/pipes/hydraulics`), run here as ONE
 * pass a frame so that what a main draws and what the water has are decided
 * from the same numbers: an intake reads the depth the device holds NOW, not
 * a readback three frames old, and takes its water out of the very column it
 * read. @see plans/pipe-network.md §3
 *
 * ONE THREAD, and that is a choice. Every network on a map is a few hundred
 * links; the falls pass, dispatched over every edge of the map, was measured
 * at 0.019 ms a frame. A single invocation walking the links in order is the
 * host's algorithm line for line — no two threads to prove unable to collide,
 * no atomics, and nothing that can come out different because of the order
 * threads happened to run in. It would be the wrong shape for sixty thousand
 * columns and it is the right one for this.
 *
 * ITS OWN BUFFER, in a second bind group, rather than a field in the state
 * buffer. The eight-binding limit that put every array of the water in one
 * buffer does not bite here — this pass binds the water's four and one more —
 * and a field of its own would have meant another offset in a uniform block
 * that is full. The pass reads and writes the water through the shared
 * header's accessors like any other.
 *
 * WHAT THE HOST KEEPS. The tanks: the game reads them, so an outlet here is a
 * boundary with an allowance. The host GRANTS each outlet water up to what
 * its tank has room for; the device delivers no more than is granted, and
 * counts what it delivered — cumulatively, so a readback that is late or
 * skipped loses nothing. The host fills the tank by the difference since it
 * last looked. The steady flow the cards quote is the host's too.
 *
 * THE LAYOUT IS THE HOST'S TO PACK and this file's to read: a header, a block
 * the host rewrites every frame, a block only the device writes and the host
 * reads back, the network itself, and scratch. @see packPipes
 */
import { PIPE_STEP, PIPE_TALL, SLOT } from "../../world/pipes/hydraulics";
import {
  STATE_WGSL, beginPass, bindState, shaderModule, stateLayout, type GpuState,
} from "./state";

/** Words in the header: counts, the frame's steps and their length, and which upload this is. */
export const PIPE_HEADER = 16;
/** Header words. @see PIPE_HEADER */
export const H_NODES = 0, H_LINKS = 1, H_INTAKES = 2, H_OUTLETS = 3, H_STEPS = 4, H_DT = 5, H_GEN = 6;
/** Columns an intake may draw from: its own tile's and the four beside it. */
export const INTAKE_CANDIDATES = 5;
/** Words a node, a link, an intake and an outlet have in the network block. */
export const NODE_WORDS = 3, LINK_WORDS = 3, INTAKE_WORDS = 3 + INTAKE_CANDIDATES, OUTLET_WORDS = 4;
/** Words an outlet has in the frame block: whether it takes anything, and what it has been granted, whole and part. */
export const OUTLET_FRAME = 3;
/** The most words the buffer holds: about two thousand tiles of main. Past it, the host solves. */
export const PIPE_WORDS = 1 << 15;
/** How many frames' answers can be on their way back at once. */
const RING = 4;

/** Where each block of a network of this size starts, and how long the whole is. Shared by the packer and the shader. */
export function pipeOffsets(n: number, l: number, i: number, o: number) {
  const frame = PIPE_HEADER;
  const dyn = frame + i + OUTLET_FRAME * o;
  // The device's own: which upload it belongs to, then what each node holds, each link carries,
  // each outlet has delivered and each intake has drawn — those two whole and part.
  const held = dyn + 1, flow = held + n, delivered = flow + l, drawn = delivered + 2 * o;
  const net = drawn + 2 * i;
  const nodes = net, links = nodes + NODE_WORDS * n, intakes = links + LINK_WORDS * l, outlets = intakes + INTAKE_WORDS * i;
  const scratch = outlets + OUTLET_WORDS * o;
  return { frame, dyn, held, flow, delivered, drawn, nodes, links, intakes, outlets, scratch, dynWords: net - dyn, words: scratch + 3 * n + 3 * i + o };
}

/** The pass less its bindings: the solver itself, which a test runs as written. @see pipes.test-kit */
const PIPES_BODY = `
// NO BACKTICKS IN HERE — see the note at the top of the shared header.

const P_TALL = ${PIPE_TALL}.0;
const P_SLOT = ${SLOT};
const P_INERTIA = 2.0;
const P_WET = 0.5;
const P_BIG = 1.0e30;

fn pn() -> i32 { return i32(pipes[${H_NODES}]); }
fn pl() -> i32 { return i32(pipes[${H_LINKS}]); }
fn pin() -> i32 { return i32(pipes[${H_INTAKES}]); }
fn po() -> i32 { return i32(pipes[${H_OUTLETS}]); }

// THE BLOCKS, in the order the host packs them. @see pipeOffsets
fn pFrame() -> i32 { return ${PIPE_HEADER}; }
fn pDyn() -> i32 { return pFrame() + pin() + ${OUTLET_FRAME} * po(); }
fn pHeld() -> i32 { return pDyn() + 1; }
fn pFlow() -> i32 { return pHeld() + pn(); }
fn pDelivered() -> i32 { return pFlow() + pl(); }
fn pDrawn() -> i32 { return pDelivered() + 2 * po(); }
fn pNodes() -> i32 { return pDrawn() + 2 * pin(); }
fn pLinks() -> i32 { return pNodes() + ${NODE_WORDS} * pn(); }
fn pIntakes() -> i32 { return pLinks() + ${LINK_WORDS} * pl(); }
fn pOutlets() -> i32 { return pIntakes() + ${INTAKE_WORDS} * pin(); }
fn pHead() -> i32 { return pOutlets() + ${OUTLET_WORDS} * po(); }
fn pLeaving() -> i32 { return pHead() + pn(); }
fn pShare() -> i32 { return pLeaving() + pn(); }
fn pSrcHead() -> i32 { return pShare() + pn(); }
fn pSrcMost() -> i32 { return pSrcHead() + pin(); }
fn pSrcCol() -> i32 { return pSrcMost() + pin(); }
fn pWant() -> i32 { return pSrcCol() + pin(); }

/** Which intake a node is, or -1. */
fn pIntakeOf(node: i32) -> i32 { return i32(pipes[pNodes() + node * ${NODE_WORDS} + 2]); }
/** A node's head from what it holds: up its bore till full, then up the slot. */
fn pHeadOf(node: i32) -> f32 {
  let full = pipes[pNodes() + node * ${NODE_WORDS}];
  let base = pipes[pNodes() + node * ${NODE_WORDS} + 1];
  let held = pipes[pHeld() + node];
  if (held <= full) { return base + P_TALL * (held / full); }
  return base + P_TALL + (held - full) / P_SLOT;
}
/** Add to a count kept whole and part, so a long game's total stays exact in floats. */
fn pCount(at: i32, v: f32) {
  let part = pipes[at + 1] + v;
  let whole = floor(part);
  pipes[at] = pipes[at] + whole;
  pipes[at + 1] = part - whole;
}

@compute @workgroup_size(1)
fn main() {
  let steps = i32(pipes[${H_STEPS}]);
  let h = pipes[${H_DT}];
  if (steps <= 0 || h <= 0.0) { return; }
  let N = pn(); let L = pl(); let I = pin(); let O = po();
  // WHICH UPLOAD THIS ANSWERS, so the host can tell an answer to the network it has now from one to the last.
  pipes[pDyn()] = pipes[${H_GEN}];

  for (var step = 0; step < steps; step++) {
    // THE SOURCES: each intake's deepest water among the columns it may draw from, as it stands now.
    for (var t = 0; t < I; t++) {
      let at = pIntakes() + t * ${INTAKE_WORDS};
      var best = -1; var deep = 0.0;
      for (var c = 0; c < ${INTAKE_CANDIDATES}; c++) {
        let col = i32(pipes[at + 3 + c]);
        if (col < 0) { continue; }
        let d = depthAt(col);
        if (d >= P_WET && (best < 0 || d > deep)) { best = col; deep = d; }
      }
      let on = pipes[pFrame() + t] > 0.0;
      pipes[pSrcCol() + t] = f32(best);
      if (best >= 0) {
        // A pump lifts, and moves only so much; unpaid, it is an intake like any other.
        pipes[pSrcHead() + t] = groundAt(best) + depthAt(best) + select(0.0, pipes[at + 2], on);
        pipes[pSrcMost() + t] = select(P_BIG, pipes[at + 1], on);
      }
    }
    for (var i = 0; i < N; i++) {
      let t = pIntakeOf(i);
      if (t >= 0 && pipes[pSrcCol() + t] >= 0.0) { pipes[pHead() + i] = pipes[pSrcHead() + t]; }
      else { pipes[pHead() + i] = pHeadOf(i); }
      pipes[pLeaving() + i] = 0.0;
    }
    // THE LINKS: pushed by the head across, held back by the square of the flow.
    for (var k = 0; k < L; k++) {
      let at = pLinks() + k * ${LINK_WORDS};
      let a = i32(pipes[at]); let b = i32(pipes[at + 1]); let loss = pipes[at + 2];
      let was = pipes[pFlow() + k];
      var q = (was + h * P_INERTIA * (pipes[pHead() + a] - pipes[pHead() + b])) / (1.0 + h * P_INERTIA * loss * abs(was));
      // No more through an intake than it moves, and none back into one.
      let ta = pIntakeOf(a);
      if (ta >= 0) {
        if (pipes[pSrcCol() + ta] < 0.0 || q < 0.0) { q = 0.0; } else { q = min(q, pipes[pSrcMost() + ta]); }
      }
      let tb = pIntakeOf(b);
      if (tb >= 0) {
        if (pipes[pSrcCol() + tb] < 0.0 || q > 0.0) { q = 0.0; } else { q = max(q, -pipes[pSrcMost() + tb]); }
      }
      pipes[pFlow() + k] = q;
      if (q > 0.0) { pipes[pLeaving() + a] += q * h; } else { pipes[pLeaving() + b] += -q * h; }
    }
    // THE OUTLETS: what the head over the floor pushes out, if it has been granted any.
    for (var k = 0; k < O; k++) {
      let at = pOutlets() + k * ${OUTLET_WORDS};
      let node = i32(pipes[at]);
      let fr = pFrame() + I + k * ${OUTLET_FRAME};
      let room = (pipes[fr + 1] - pipes[pDelivered() + 2 * k]) + (pipes[fr + 2] - pipes[pDelivered() + 2 * k + 1]);
      let over = pipes[pHead() + node] - pipes[at + 1];
      var want = 0.0;
      if (pipes[fr] > 0.0 && room > 0.0 && over > 0.0) { want = min(pipes[at + 3], sqrt(over / pipes[at + 2])); }
      pipes[pWant() + k] = want;
      pipes[pLeaving() + node] += want * h;
    }
    // NOTHING LEAVES A NODE THAT IT DOES NOT HOLD: what would, cut back in proportion.
    for (var i = 0; i < N; i++) {
      let out = pipes[pLeaving() + i];
      let has = pipes[pHeld() + i];
      var part = 1.0;
      if (pIntakeOf(i) < 0 && out > has) { part = has / out; }
      pipes[pShare() + i] = part;
    }
    for (var k = 0; k < L; k++) {
      let at = pLinks() + k * ${LINK_WORDS};
      let q = pipes[pFlow() + k];
      let giver = select(i32(pipes[at + 1]), i32(pipes[at]), q > 0.0);
      let s = pipes[pShare() + giver];
      if (s < 1.0) { pipes[pFlow() + k] = q * s; }
    }
    // AN INTAKE gives what the water has: taken out of the column it was read from, its links cut back to that.
    for (var t = 0; t < I; t++) {
      let col = i32(pipes[pSrcCol() + t]);
      if (col < 0) { continue; }
      let node = i32(pipes[pIntakes() + t * ${INTAKE_WORDS}]);
      var draw = 0.0;
      for (var k = 0; k < L; k++) {
        let at = pLinks() + k * ${LINK_WORDS};
        if (i32(pipes[at]) == node) { draw += pipes[pFlow() + k]; }
        else if (i32(pipes[at + 1]) == node) { draw -= pipes[pFlow() + k]; }
      }
      if (draw <= 0.0) { continue; }
      let there = depthAt(col);
      let got = min(draw * h, there);
      if (got > 0.0) {
        let left = there - got;
        setDepth(col, left);
        if (left <= 0.0) { setMaterial(col, 0.0); }
        pCount(pDrawn() + 2 * t, got);
      }
      if (got < draw * h) {
        let part = got / (draw * h);
        for (var k = 0; k < L; k++) {
          let at = pLinks() + k * ${LINK_WORDS};
          if (i32(pipes[at]) == node || i32(pipes[at + 1]) == node) { pipes[pFlow() + k] *= part; }
        }
      }
    }
    for (var k = 0; k < L; k++) {
      let at = pLinks() + k * ${LINK_WORDS};
      let a = i32(pipes[at]); let b = i32(pipes[at + 1]);
      let v = pipes[pFlow() + k] * h;
      if (pIntakeOf(a) < 0) { pipes[pHeld() + a] -= v; }
      if (pIntakeOf(b) < 0) { pipes[pHeld() + b] += v; }
    }
    for (var k = 0; k < O; k++) {
      let at = pOutlets() + k * ${OUTLET_WORDS};
      let node = i32(pipes[at]);
      let fr = pFrame() + I + k * ${OUTLET_FRAME};
      let room = (pipes[fr + 1] - pipes[pDelivered() + 2 * k]) + (pipes[fr + 2] - pipes[pDelivered() + 2 * k + 1]);
      let went = min(min(pipes[pWant() + k] * h * pipes[pShare() + node], max(0.0, pipes[pHeld() + node])), max(0.0, room));
      if (went <= 0.0) { continue; }
      pipes[pHeld() + node] -= went;
      pCount(pDelivered() + 2 * k, went);
    }
    for (var i = 0; i < N; i++) { if (pipes[pHeld() + i] < 0.0) { pipes[pHeld() + i] = 0.0; } }
  }
  // ONE FRAME'S WORTH, once: the host says again when it wants another.
  pipes[${H_STEPS}] = 0.0;
}
`;

const PIPES_WGSL = `
${STATE_WGSL}

@group(1) @binding(0) var<storage, read_write> pipes : array<f32>;
${PIPES_BODY}`;

/** What the host is handed to run its mains on the device. @see ColumnField.pipes */
export type PipePort = {
  /** The most words a network may pack to. */
  words: number;
  /** A network, whole: header, frame, the device's block as it should start, and the network. Replaces what was there. */
  load: (all: Float32Array) => void;
  /** This frame: the block the host rewrites, and how long the frame is. The pass runs once for it. */
  frame: (block: Float32Array, dt: number) => void;
  /** The device's block as last read back — upload number first — or null before the first answer. Not to be kept. */
  latest: () => Float32Array | null;
};

export type PipesPass = {
  port: PipePort;
  /** Run the pass, if the host has asked for a frame since the last. */
  encode: (enc: GPUCommandEncoder, s: GpuState) => void;
  /** Ask for the device's block back, and take whatever has arrived. Once a frame, after the frame is submitted. */
  readback: () => void;
  destroy: () => void;
};

export function createPipes(device: GPUDevice): PipesPass {
  const layout = stateLayout(device);
  const own = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }],
  });
  const pipeline = device.createComputePipeline({
    label: "pipes",
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout, own] }),
    compute: { module: shaderModule(device, PIPES_WGSL, "pipes"), entryPoint: "main" },
  });
  const buffer = device.createBuffer({
    label: "pipes", size: PIPE_WORDS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const group = device.createBindGroup({ layout: own, entries: [{ binding: 0, resource: { buffer } }] });
  // THE ANSWERS, a ring of them: a readback takes a frame or three to come back and nothing waits on it.
  const ring = Array.from({ length: RING }, (_, k) => ({
    buffer: device.createBuffer({ label: `pipes back ${k}`, size: PIPE_WORDS * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
    busy: false,
  }));
  let dynAt = 0, dynWords = 0, loaded = false, pending = false, dead = false;
  let answer: Float32Array | null = null;
  const port: PipePort = {
    words: PIPE_WORDS,
    load: (all) => {
      const o = pipeOffsets(all[H_NODES], all[H_LINKS], all[H_INTAKES], all[H_OUTLETS]);
      dynAt = o.dyn; dynWords = o.dynWords;
      // The scratch after it needs no upload: the pass writes all of it before it reads any.
      device.queue.writeBuffer(buffer, 0, all.buffer, all.byteOffset, Math.min(all.length, PIPE_WORDS) * 4);
      loaded = all[H_NODES] > 0;
      pending = false;
      answer = null;
    },
    frame: (block, dt) => {
      if (!loaded || !(dt > 0)) return;
      const steps = Math.max(1, Math.ceil(dt / PIPE_STEP));
      device.queue.writeBuffer(buffer, PIPE_HEADER * 4, block.buffer, block.byteOffset, block.length * 4);
      device.queue.writeBuffer(buffer, H_STEPS * 4, new Float32Array([steps, dt / steps]));
      pending = true;
    },
    latest: () => answer,
  };
  return {
    port,
    encode: (enc, s) => {
      if (!loaded || !pending || dead) return;
      pending = false;
      const pass = beginPass(enc, s, "pipes");
      pass.setPipeline(pipeline);
      bindState(pass, s, layout);
      pass.setBindGroup(1, group);
      pass.dispatchWorkgroups(1);
      pass.end();
    },
    readback: () => {
      if (!loaded || dead || dynWords <= 0) return;
      const slot = ring.find((r) => !r.busy);
      if (!slot) return;
      slot.busy = true;
      const at = dynAt, words = dynWords;
      const enc = device.createCommandEncoder({ label: "pipes readback" });
      enc.copyBufferToBuffer(buffer, at * 4, slot.buffer, 0, words * 4);
      device.queue.submit([enc.finish()]);
      slot.buffer.mapAsync(GPUMapMode.READ, 0, words * 4).then(() => {
        // Only an answer to the network that is loaded now: one in the air when it changed is dropped.
        if (!dead && at === dynAt && words === dynWords) answer = new Float32Array(slot.buffer.getMappedRange(0, words * 4).slice(0));
        slot.buffer.unmap();
        slot.busy = false;
      }).catch(() => { slot.busy = false; });
    },
    destroy: () => {
      dead = true;
      buffer.destroy();
      for (const r of ring) r.buffer.destroy();
    },
  };
}

export const pipesSource = () => PIPES_WGSL;
export const pipesBody = () => PIPES_BODY;
