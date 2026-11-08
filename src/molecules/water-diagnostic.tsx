import { IconChevronDown } from "@tabler/icons-react";
import { useEffect, useReducer, useState } from "react";
import { twMerge } from "tailwind-merge";

import { cpuWaterRead, waterSolverNow } from "../world/debug/gpu-water-stat";
import { adapterNameNow, deviceLost, heldGpu } from "../world/render/device";
import { rendererAsked } from "../world/render/use-gpu";
import { FOCUS } from "../ui/console";

/** The browser and its major version, from the user agent: what a lag report most needs. */
export function browserOf(ua: string): string {
  const m = ua.match(/Firefox\/(\d+)/) ?? ua.match(/Edg\/(\d+)/) ?? ua.match(/Chrome\/(\d+)/) ?? ua.match(/Version\/(\d+).*Safari/);
  if (!m) return "Unknown";
  const name = m[0].startsWith("Firefox") ? "Firefox" : m[0].startsWith("Edg") ? "Edge" : m[0].startsWith("Chrome") ? "Chrome" : "Safari";
  return `${name} ${m[1]}`;
}

/**
 * HOW THE WATER IS DRAWING, in the settings: on the GPU, or on the CPU and
 * why, which is the first thing to know when somebody says the map is slow.
 * Without WebGPU the water is solved in JavaScript and drawn with WebGL, and
 * is a good deal slower (2026-11-08: Firefox without WebGPU sat at 12 fps).
 * Click it for the rest. @see sayWaterSolver, CPU_SOLVE_MS
 */
export function WaterDiagnostic() {
  const [open, setOpen] = useState(false);
  // Read live while the settings are open: the solver is decided after the map
  // loads and can change under it (a lost device).
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const { solver, why } = waterSolverNow();
  const deciding = why === "not decided yet";
  const webgpu = rendererAsked() === "webgpu" && !!heldGpu() && deviceLost() === null;
  const budget = cpuWaterRead();
  const gpu = solver === "gpu";
  const status = deciding ? "No map yet" : gpu ? "GPU" : "CPU fallback";
  const rows: [string, string][] = deciding ? [] : [
    ["Solved on", gpu ? "GPU (WebGPU)" : "CPU"],
    ["Drawn with", webgpu ? "WebGPU" : "WebGL"],
    ...(!gpu && why ? [["Why", why] as [string, string]] : []),
    ...(!gpu && budget.perSub > 0
      ? [["Budget", `${budget.cap} substep${budget.cap === 1 ? "" : "s"} a frame, ${budget.perSub.toFixed(0)} ms each`] as [string, string]]
      : []),
    ...(webgpu && adapterNameNow() ? [["Adapter", adapterNameNow()!] as [string, string]] : []),
  ];
  rows.push(["Browser", browserOf(navigator.userAgent)]);

  return (
    <div className="flex flex-col">
      <div className="flex min-h-8 items-center justify-between gap-4 text-sm" title="How the map's water is solved and drawn">
        <span className="text-fg">Water</span>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={twMerge(
            "flex cursor-pointer items-center gap-1 px-1 font-mono text-xs hover:bg-surface-2",
            deciding ? "text-fg-muted" : gpu ? "text-good" : "text-warn",
            FOCUS,
          )}
        >
          {status}
          <IconChevronDown className={twMerge("h-3.5 w-3.5 transition-transform", open && "rotate-180")} stroke={1.6} />
        </button>
      </div>
      {open && (
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-l-2 border-line-quiet pl-2 text-xs select-text">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-fg-muted">{k}</dt>
              <dd className="break-words text-fg">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
