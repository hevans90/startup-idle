/**
 * THE DEVICE'S PIPE PASS, RUN AS WRITTEN — without a device. The shader's own
 * text, turned word for word into something the test runner can call: `fn`
 * for `function`, its casts and its maths for theirs, and nothing else. So
 * what a test here sees is what the pass does with the buffer the host packed
 * — the layout read at the shader's own offsets — not a second copy of the
 * solver that could agree with the host and differ from the device.
 * @see pipes.ts, world/water/mains-device.test
 */
import { PIPE_STEP } from "../../world/pipes/hydraulics";
import type { ColumnField } from "../columns";
import { H_DT, H_INTAKES, H_LINKS, H_NODES, H_OUTLETS, H_STEPS, PIPE_HEADER, PIPE_WORDS, pipeOffsets, pipesBody, type PipePort } from "./pipes";

type Run = (pipes: Float32Array, depthAt: (i: number) => number, groundAt: (i: number) => number, setDepth: (i: number, v: number) => void, setMaterial: (i: number, v: number) => void) => void;

function compile(): Run {
  const js = pipesBody()
    .replace(/@compute\s+@workgroup_size\(1\)/, "")
    .replace(/\bfn (\w+)\(([^)]*)\)\s*(?:->\s*\w+\s*)?\{/g, (_, name: string, args: string) =>
      `function ${name}(${args.split(",").map((a) => a.split(":")[0].trim()).filter(Boolean).join(", ")}) {`)
    .replace(/\blet\b/g, "const")
    .replace(/\bvar\b/g, "let")
    .replace(/\bi32\(/g, "Math.trunc(")
    .replace(/\bf32\(/g, "Number(")
    .replace(/(?<![.\w])(floor|min|max|sqrt|abs)\(/g, "Math.$1(");
  return new Function("pipes", "depthAt", "groundAt", "setDepth", "setMaterial",
    `"use strict"; const select = (f, t, c) => (c ? t : f);\n${js}\nmain();`) as Run;
}

export type Twin = {
  port: PipePort;
  /** The buffer as the device would hold it. */
  buffer: Float32Array;
  /** Where its blocks are, for the network loaded now. */
  offsets: () => ReturnType<typeof pipeOffsets>;
  /** Networks loaded so far. */
  loads: () => number;
};

/** A port onto the pass run on the host's own columns; its answers come back `late` frames after they were made. */
export function shaderTwin(columns: ColumnField, late = 0): Twin {
  const run = compile(), buffer = new Float32Array(PIPE_WORDS);
  let off = pipeOffsets(0, 0, 0, 0), loads = 0, back: Float32Array[] = [];
  const port: PipePort = {
    words: PIPE_WORDS,
    load: (all) => {
      buffer.fill(0);
      buffer.set(all);
      off = pipeOffsets(all[H_NODES], all[H_LINKS], all[H_INTAKES], all[H_OUTLETS]);
      back = [];
      loads++;
    },
    frame: (block, dt) => {
      if (!(dt > 0) || !buffer[H_NODES]) return;
      const steps = Math.max(1, Math.ceil(dt / PIPE_STEP));
      buffer.set(block, PIPE_HEADER);
      buffer[H_STEPS] = steps; buffer[H_DT] = dt / steps;
      run(buffer, (i) => columns.depth[i], (i) => columns.ground[i], (i, v) => { columns.depth[i] = v; }, () => {});
      back.push(buffer.slice(off.dyn, off.dyn + off.dynWords));
      if (back.length > late + 1) back.shift();
    },
    latest: () => (back.length > late ? back[0] : null),
  };
  return { port, buffer, offsets: () => off, loads: () => loads };
}
