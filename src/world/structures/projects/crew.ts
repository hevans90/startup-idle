/**
 * World v2 — where a site's crew are and what each is doing.
 *
 * The crew used to be stood at random spots across the footprint at ground
 * level, all hammering at nothing: inside the walls, behind the scaffold, in
 * the bricks. Now each has a JOB where the work is, by the stage it has got to:
 *
 *  - FIXERS on the top of the frame, along its front edges, at the floor
 *    being cast — or in the pit and on the plinth before there is a frame;
 *  - CLADDERS on the scaffold boards at the floor being clad, facing the wall;
 *  - CARRIERS walking the yard along the front with a load and back without;
 *  - a FOREMAN by the gate, watching the crane.
 *
 * Only places the camera can see, in front of everything the site has drawn,
 * because that is where they are drawn: in front of the whole site, in its
 * front band. @see project-renderer
 *
 * Pure, so a test can check nobody is put inside a wall.
 */
import { sortMasses, wholeFloors, type Building, type Footprint, type Mass } from "./model";
import type { Site } from "./schedule";

export type Role = "fixer" | "cladder" | "carrier" | "foreman";

export type Worker = {
  role: Role;
  /** Local: across the plot, into it, and half steps up. @see Pen */
  u: number; v: number; z: number;
  heading: number;
  /** Where in their swing or stride they are. */
  phase: number;
  /** At work in one place, hammering; or walking. */
  working: boolean;
  /** Carrying a load in front of them. */
  carrying: boolean;
};

/** No more drawn than this, however many are on the books: a site, not a crowd. */
export const MAX_DRAWN = 14;

/** Swings of a hammer a second. */
const SWINGS = 9;
/** A walker's pace, tiles a second, and strides a tile. */
const PACE = 0.32;
const STRIDES = 7;

/** Positions spread along a length, inset from its ends. */
function spread(a0: number, a1: number, n: number, k: number): number {
  return a0 + ((a1 - a0) * (k + 0.5)) / Math.max(1, n);
}

/** The mass going up: the one whose frame is highest without being finished. */
function active(b: Building, site: Site): Mass | null {
  const ms = sortMasses(b.masses).filter((m) => site.frame > m.z0 - 1e-6);
  const going = ms.filter((m) => wholeFloors(m, site.clad) < m.z1 - 1e-6);
  return going[going.length - 1] ?? ms[ms.length - 1] ?? null;
}

/**
 * THE CREW, `n` of them, `t` seconds into the day. Their jobs are dealt out
 * in a fixed order — a foreman, then fixers, cladders and carriers in turn —
 * so the same worker keeps the same job from one frame to the next.
 */
export function crewAt(b: Building, f: Footprint, site: Site, n: number, t: number, idle = false): Worker[] {
  const out = place(b, f, site, n, t);
  // STOOD ABOUT, waiting for the next load: where their work is, not at it.
  if (idle) {
    for (const w of out) {
      w.working = false;
      w.carrying = false;
      w.phase = 0;
      if (w.role === "carrier") { w.u = 0.3 + (w.u % 0.6); w.heading = Math.PI / 4; }
    }
  }
  return out;
}

function place(b: Building, f: Footprint, site: Site, n: number, t: number): Worker[] {
  const count = Math.min(MAX_DRAWN, Math.max(0, Math.floor(n)));
  if (count === 0) return [];
  const m = site.framing ? active(b, site) : null;
  const out: Worker[] = [];
  const cladding = m !== null && wholeFloors(m, site.clad) < m.z1 - 1e-6 && site.clad > m.z0 + 1e-6;
  const roles: Role[] = ["foreman"];
  const cycle: Role[] = cladding ? ["fixer", "cladder", "carrier", "fixer", "cladder"] : ["fixer", "carrier", "fixer"];
  for (let k = 1; k < count; k++) roles.push(cycle[(k - 1) % cycle.length]);
  const of = (r: Role) => roles.filter((x) => x === r).length;
  const index = (k: number) => roles.slice(0, k).filter((x) => x === roles[k]).length;

  for (let k = 0; k < count; k++) {
    const role = roles[k], i = index(k), total = of(role);
    const phase = t * SWINGS + k * 1.7;
    switch (role) {
      case "foreman": {
        // By the gate, looking up at the work.
        out.push({ role, u: f.w / 2 + 0.55, v: f.h - 0.22, z: 0, heading: -Math.PI * 0.75, phase: 0, working: false, carrying: false });
        break;
      }
      case "fixer": {
        if (!m) {
          // On the plinth or the pit floor, along the front.
          const z = site.plinth;
          out.push({
            role, u: spread(0.35, f.w - 0.35, total, i), v: f.h - b.plinth.inset - 0.3 - (i % 2) * 0.25, z,
            heading: -Math.PI / 2, phase, working: true, carrying: false,
          });
          break;
        }
        // On the slab the floor is being cast from, along the front edges:
        // the first half along the lit face, the rest down the other.
        // On the roof slab once the frame is topped out.
        const z = site.frame >= m.z1 - 1e-6 ? m.z1 : wholeFloors(m, site.frame);
        const half = Math.ceil(total / 2);
        if (i < half) {
          out.push({
            role, u: spread(m.u0 + 0.1, m.u1 - 0.1, half, i), v: m.v1 - 0.12, z,
            heading: Math.PI / 2, phase, working: true, carrying: false,
          });
        } else {
          out.push({
            role, u: m.u1 - 0.12, v: spread(m.v0 + 0.1, m.v1 - 0.25, total - half, i - half), z,
            heading: 0, phase, working: true, carrying: false,
          });
        }
        break;
      }
      case "cladder": {
        // On the boards at the floor being clad, facing the wall.
        const mm = m!;
        const z = wholeFloors(mm, site.clad);
        const face = i % 2;
        const along = Math.floor(i / 2), per = Math.ceil(total / 2);
        if (face === 0) {
          out.push({
            role, u: spread(mm.u0, mm.u1, per, along), v: mm.v1 + 0.09, z,
            heading: -Math.PI / 2, phase, working: true, carrying: false,
          });
        } else {
          out.push({
            role, u: mm.u1 + 0.09, v: spread(mm.v0, mm.v1, per, along), z,
            heading: Math.PI, phase, working: true, carrying: false,
          });
        }
        break;
      }
      case "carrier": {
        // Back and forth along the front of the plot, loaded one way.
        const a0 = 0.3, a1 = Math.max(a0 + 0.4, f.w - 0.35);
        const len = a1 - a0;
        const s = (t * PACE + i * 1.3) % (len * 2);
        const out1 = s < len;
        const u = out1 ? a0 + s : a1 - (s - len);
        const v = f.h - 0.16 - (i % 2) * 0.1;
        out.push({
          role, u, v, z: 0, heading: out1 ? 0 : Math.PI,
          phase: (t * PACE * STRIDES + i) * Math.PI, working: false, carrying: out1,
        });
        break;
      }
    }
  }
  return out;
}

/** Whether a point stands inside a mass as built so far: nobody should. */
export function insideBuilt(b: Building, site: Site, u: number, v: number, z: number): boolean {
  for (const m of b.masses) {
    const top = Math.min(m.z1, wholeFloors(m, site.clad));
    if (top <= m.z0) continue;
    if (u > m.u0 + 1e-6 && u < m.u1 - 1e-6 && v > m.v0 + 1e-6 && v < m.v1 - 1e-6 && z > m.z0 + 1e-6 && z < top - 1e-6) return true;
  }
  return false;
}
