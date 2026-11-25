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

/**
 * AND A SHADER'S OWN GROUPS LOOKED OVER ONCE A RENDER. Before each draw Pixi walks every resource of every bind
 * group of the shader to find the uniform groups in it and send what changed; for a shader given here that walk is
 * made at its first draw of a render, and its other draws go without. Only for a shader whose uniforms are written
 * between renders and never between two of its draws — ours; not Pixi's own, which it writes a mesh at a time.
 */
export function syncOnce<T extends object>(shader: T): T {
  (shader as { __syncOnce?: boolean }).__syncOnce = true;
  return shader;
}

type BindGroupLike = object;
type ShaderLike = { gpuProgram?: { autoAssignGlobalUniforms: boolean; autoAssignLocalUniforms: boolean }; groups: Record<number, BindGroupLike>; __syncOnce?: boolean; __synced?: number };
type MeshLike = { _shader?: ShaderLike | null; _geometry: { instanceCount?: number }; state: unknown };
type Matrix6 = { a: number; b: number; c: number; d: number; tx: number; ty: number };
type MeshPipeLike = { localUniforms: { uniforms: { uTransformMatrix: Matrix6; uColor: ArrayLike<number>; uRound: number } } };
type Host = {
  runners?: { prerender?: { add: (o: { prerender: () => void }) => void } }; __uniformsHooked?: boolean;
  tick: number;
  globalUniforms?: { bindGroup: BindGroupLike };
  encoder?: { _syncBindGroup?: (g: BindGroupLike) => void; draw: (o: object) => void };
  renderPipes?: { mesh?: { _adaptor?: { execute: (pipe: MeshPipeLike, mesh: MeshLike) => void } }; uniformBatch?: { getUniformBindGroup: (u: unknown, d: boolean) => BindGroupLike } };
};

/** Have a renderer mark them before each of its renders; once a renderer. */
export function hookUniforms(renderer: unknown): void {
  const r = renderer as Host;
  if (r.__uniformsHooked || !r.runners?.prerender) return;
  r.__uniformsHooked = true;
  r.runners.prerender.add({ prerender: markUniforms });
  // (WebGPU only, and only a Pixi whose insides are as they were: anything else is left to draw as it always did.)
  const adaptor = r.renderPipes?.mesh?._adaptor, enc = r.encoder, batch = r.renderPipes?.uniformBatch;
  if (!adaptor || !enc?._syncBindGroup || !batch || !r.globalUniforms) return;
  const execute = adaptor.execute.bind(adaptor);
  // A MESH'S OWN NUMBERS, MOST OFTEN THE LAST ONE'S: the bands stand where the map does, so one after another is
  // placed and tinted alike, and is given the group the last was — neither packed nor bound again. Within a render:
  // what a group points at is written over by the next.
  const last = new Float64Array(11);
  let lastTick = -1, lastGroup: BindGroupLike | null = null;
  r.runners.prerender.add({ prerender: () => { lastGroup = null; } });
  const own = (u: MeshPipeLike["localUniforms"]): BindGroupLike => {
    const { uTransformMatrix: m, uColor: c, uRound } = u.uniforms;
    if (lastGroup && lastTick === r.tick && last[0] === m.a && last[1] === m.b && last[2] === m.c && last[3] === m.d && last[4] === m.tx && last[5] === m.ty
      && last[6] === c[0] && last[7] === c[1] && last[8] === c[2] && last[9] === c[3] && last[10] === uRound) return lastGroup;
    last[0] = m.a; last[1] = m.b; last[2] = m.c; last[3] = m.d; last[4] = m.tx; last[5] = m.ty;
    last[6] = c[0]; last[7] = c[1]; last[8] = c[2]; last[9] = c[3]; last[10] = uRound;
    lastTick = r.tick;
    return (lastGroup = batch.getUniformBindGroup(u, true));
  };
  adaptor.execute = (pipe, mesh) => {
    // (Not one of it to draw: nothing is bound for it.)
    if (mesh._geometry?.instanceCount === 0) return;
    const shader = mesh._shader, program = shader?.gpuProgram;
    if (!shader || !program || !shader.__syncOnce || !program.autoAssignGlobalUniforms || !program.autoAssignLocalUniforms) { execute(pipe, mesh); return; }
    const groups = shader.groups;
    groups[0] = r.globalUniforms!.bindGroup;
    groups[1] = own(pipe.localUniforms);
    // (The view's own numbers, which Pixi writes as it goes: looked at every time. The mesh's are a buffer, not a group.)
    enc._syncBindGroup!(groups[0]);
    if (shader.__synced !== r.tick) {
      shader.__synced = r.tick;
      for (const i in groups) if (Number(i) > 1) enc._syncBindGroup!(groups[i]);
    }
    enc.draw({ geometry: mesh._geometry, shader, state: mesh.state, skipSync: true });
  };
}
