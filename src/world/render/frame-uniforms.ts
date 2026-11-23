/**
 * World v2 — A SHADER'S UNIFORMS SENT ONCE A RENDER, not once a draw.
 *
 * Pixi packs a uniform group and uploads its buffer again at every draw that uses it, unless the group is marked
 * static — and the ground, the trees and the roads' shade are a mesh a band, hundreds of draws of one shader over
 * the same numbers: a thousand packings and uploads a frame of what was sent already.
 *
 * A group given here is static, and is marked changed before every render — the window's, and each drawn into a
 * texture — so it is sent with the first draw of each and not again. Whoever writes its numbers between renders
 * need not say so.
 */
import type { UniformGroup } from "pixi.js";

type Ref = { deref(): UniformGroup | undefined };
// (Held weakly: a map's shaders go with the map. Named so, as the project's library of types has no WeakRef.)
const WeakRefOf = (globalThis as unknown as { WeakRef: new (g: UniformGroup) => Ref }).WeakRef;
const groups: Ref[] = [];

/** Have a group sent once a render. Returns it. */
export function oncePerRender<T extends UniformGroup>(group: T): T {
  (group as { isStatic: boolean }).isStatic = true;
  groups.push(new WeakRefOf(group));
  return group;
}

/** Mark every such group changed: called before each render. @see hookUniforms */
export function markUniforms(): void {
  let kept = 0;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i].deref();
    if (!g) continue;
    g.update();
    groups[kept++] = groups[i];
  }
  groups.length = kept;
}

type Host = { runners?: { prerender?: { add: (o: { prerender: () => void }) => void } }; __uniformsHooked?: boolean };

/** Have a renderer mark them before each of its renders; once a renderer. */
export function hookUniforms(renderer: unknown): void {
  const r = renderer as Host;
  if (r.__uniformsHooked || !r.runners?.prerender) return;
  r.__uniformsHooked = true;
  r.runners.prerender.add({ prerender: markUniforms });
}
