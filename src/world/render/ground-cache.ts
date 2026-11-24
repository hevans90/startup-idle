/**
 * THE GROUND, COPIED WHILE THE VIEW IS STILL.
 *
 * The ground's shader is most of a frame's drawing — grass, the wood's floor,
 * heather, shade, a pixel at a time — and on a still view it works out the
 * same picture every frame. So once the view has held for a couple of frames
 * the ground is drawn once into a texture, and after that each band's mesh
 * reads its pixels back from it instead.
 *
 * THE MESHES STILL DRAW, band by band, in their places: a band's ground hides
 * the band behind's trees and is hidden by its own, and a flat layer under
 * everything would lose that. Only where the colour comes from changes.
 *
 * THE COPY IS MADE AS THE WINDOW IS DRAWN, sample by sample and averaged, so
 * a pixel two faces share side by side — a top and the wall under it — holds
 * what the two would have averaged to, and both can lay it.
 *
 * ITS FOURTH CHANNEL COUNTS the faces over each sample. Where one face lies
 * over another — a crest against the ground behind it — a band's trees may
 * stand between the two, and one colour for both would be wrong. So the copy
 * is read only where every sample of a pixel is under exactly one solid face,
 * and the rest is worked out as it always was. In the copy's own texture, by
 * a blend that lays the colour over and adds the count up ({@link COPY_BLEND}):
 * a texture of its own for the count was the window's size again, four
 * samples a pixel, and the ground drawn a second time for every copy.
 *
 * WHAT MAKES IT STALE is anything the ground draws from: the view, the
 * window, a texel, a uniform, a band's quads, which bands show and how
 * strongly. All of it is compared before every frame is drawn; one
 * difference and that frame is worked out in full.
 */
import {
  Container, GpuBlendModesToPixi, Matrix, Mesh, RenderTexture, RendererType, type BLEND_MODES, type Geometry, type Renderer, type Shader,
} from "pixi.js";
import { cacheUniforms, groundShader, type GroundMesh } from "./ground-mesh";

/** The least time between two copies made for the year's and the weather's small steps alone, ms. @see GroundMesh.drift */
const DRIFT_EVERY = 10000;
/** Frames a view must hold before it is copied: a pan's pause is not a stop. */
const STILL = 2;

/** The copy's blend: the colour laid over what is there, the fourth channel added to it. @see ground-mesh.ts mainFragment */
const COPY_BLEND = "ground-copy";
(GpuBlendModesToPixi as Record<string, GPUBlendState>)[COPY_BLEND] = {
  color: { srcFactor: "one", dstFactor: "zero", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
};

let wanted = true;
/** Whether the ground may be copied at all; off, every frame is worked out. For measuring one against the other. */
export const setGroundCache = (on: boolean) => { wanted = on; };

type Copy = {
  gm: GroundMesh;
  colour: RenderTexture | null;
  /** The meshes again, over the same quads, drawing the copy. */
  fill: Container;
  fillOf: Mesh<Geometry, Shader>[];
  /** What the copy was made of, what the last frame was drawn from, and this frame's. @see signature */
  made: Float64Array; seen: Float64Array; now: Float64Array;
  valid: boolean;
  /** Frames the view has held. */
  still: number;
  /** Whether every band showing is at full strength: a faded ground is not solid. */
  solid: boolean;
  at: Matrix;
};

export type GroundCache = {
  /** Once a frame, before it is drawn: copy the ground if the view has held. */
  step: () => void;
  /** How many copies have been made, and whether the last frame read one. */
  says: () => { made: number; reading: boolean };
  destroy: () => void;
};

const same = (a: Float64Array, b: Float64Array) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/**
 * The still view's copy of `ground()`'s drawing, kept on `renderer`. Nothing
 * on a renderer that is not WebGPU: the copy is read by pixel position, and
 * the other shader has no such path.
 */
export function createGroundCache(renderer: Renderer, ground: () => GroundMesh | null): GroundCache {
  if (renderer.type !== RendererType.WEBGPU) {
    return { step: () => {}, says: () => ({ made: 0, reading: false }), destroy: () => {} };
  }
  let copy: Copy | null = null;
  let driftSeen = -1, driftAt = -1e9;
  let filling = false;
  let made = 0;
  let reading = false;

  const drop = () => {
    if (!copy) return;
    const c = copy;
    copy = null;
    setMode(c.gm, 0);
    // Out of the ground's shader before they go, if the ground is still there. @see sized
    if (c.gm.meshes.length && c.gm.shader.groups?.[2]?.resources) {
      c.gm.shader.resources.uCache = c.gm.blank;
    }
    // The quads are the ground's own: the meshes go, the geometry stays.
    for (const m of c.fillOf) { m.parent?.removeChild(m); m.destroy(); }
    c.fill.destroy();
    if (c.colour) { giveBack(c.colour); c.colour.destroy(true); }
  };

  const setMode = (gm: GroundMesh, mode: number) => {
    const u = gm.cacheU.uniforms.uCacheMode as Float32Array;
    if (u[0] === mode) return;
    u[0] = mode;
    gm.cacheU.update();
  };

  const adopt = (gm: GroundMesh): Copy => {
    const fillGroup = cacheUniforms();
    (fillGroup.uniforms.uCacheMode as Float32Array)[0] = 1;
    const fillShader = groundShader(gm, fillGroup);
    const fill = new Container();
    const fillOf: Mesh<Geometry, Shader>[] = [];
    for (const real of gm.meshes) {
      const a = new Mesh<Geometry, Shader>({ geometry: real.geometry, shader: fillShader });
      a.blendMode = COPY_BLEND as BLEND_MODES;
      fill.addChild(a);
      fillOf.push(a);
    }
    const n = 12 + gm.meshes.length;
    const c: Copy = {
      gm, colour: null, fill, fillOf,
      made: new Float64Array(n), seen: new Float64Array(n), now: new Float64Array(n),
      valid: false, still: 0, solid: false, at: new Matrix(),
    };
    gm.gone.push(() => { if (copy === c) drop(); });
    return c;
  };

  /** Everything the ground's picture depends on, into `c.now`. @see Copy.made */
  const signature = (c: Copy) => {
    const { gm, now } = c;
    let k = 12;
    let first: Mesh<Geometry, Shader> | null = null;
    let solid = true;
    for (const m of gm.meshes) {
      // Shown only if everything it hangs from is; and as strong as all of it together.
      let shown = m.visible, alpha = m.alpha;
      for (let p = m.parent; p && shown; p = p.parent) { shown = p.visible; alpha *= p.alpha; }
      now[k++] = shown ? alpha : -1;
      if (!shown) continue;
      if (alpha !== 1) solid = false;
      first ??= m;
    }
    c.solid = solid && first !== null;
    const t = first?.worldTransform;
    // THE GROUP'S OWN PLACE, which is what the window's drawing hands the shader, with each mesh's place in the
    // group beside it. The copy is drawn through the same two, not through their product: the sums come out a
    // last bit apart otherwise, and the ground's finest grain turns on a last bit.
    const group = first?.parentRenderGroup;
    if (group) c.at.copyFrom(group.worldTransform);
    now[0] = t?.a ?? 0; now[1] = t?.b ?? 0; now[2] = t?.c ?? 0; now[3] = t?.d ?? 0;
    now[4] = t?.tx ?? 0; now[5] = t?.ty ?? 0;
    now[6] = renderer.screen.width; now[7] = renderer.screen.height; now[8] = renderer.resolution;
    // (A uniform written is counted by the ground itself: not read off the group's own dirty mark, which is set
    // before every render now and cleared at the first draw — it changed with how many renders a frame had.)
    // THE YEAR'S AND THE WEATHER'S SMALL STEPS, taken up no oftener than every few seconds: each is too small to
    // see, they come every second or two, and a copy made again for each was the ground worked out in full for
    // three frames of every sixty.
    const clock = performance.now();
    if (gm.drift !== driftSeen && clock - driftAt >= DRIFT_EVERY) { driftSeen = gm.drift; driftAt = clock; }
    now[9] = gm.rev; now[10] = driftSeen;
    now[11] = 0;
  };

  const current = (): Copy | null => {
    const gm = ground();
    if (!gm || !gm.meshes.length) { drop(); return null; }
    if (copy && copy.gm !== gm) drop();
    copy ??= adopt(gm);
    return copy;
  };

  // BEFORE EVERY FRAME IS DRAWN, whoever draws it: the copy is read only by a frame of the very picture it was
  // made of, on the window itself. A view that moved, an edit, a frame drawn into some other texture — worked out.
  const guard = {
    prerender: (o: { target?: unknown }) => {
      if (filling) return;
      const c = wanted ? current() : (drop(), null);
      if (!c) { reading = false; return; }
      if (o.target !== renderer.view.renderTarget) { setMode(c.gm, 0); return; }
      signature(c);
      if (same(c.now, c.seen)) c.still++;
      else { c.still = 0; c.seen.set(c.now); }
      reading = c.valid && c.solid && same(c.now, c.made);
      setMode(c.gm, reading ? 2 : 0);
    },
  };
  renderer.runners.prerender.add(guard);

  // DRAWN THROUGH THE WINDOW'S OWN SAMPLES. A texture drawn sample by sample keeps a second one four times its
  // size to draw into, used only while it is drawn — and the window has one exactly like it, which holds nothing
  // between two frames (a frame clears it) and a copy is made between two frames. So the copy's is destroyed and
  // the window's stands in for it: the window's size, four samples a pixel, not held twice. Taken out again
  // before the copy is destroyed, or the window's would go with it. With no samples on the window (`?noaa`), or
  // a window of another size for a moment, the copy keeps its own.
  type Samples = { pixelWidth: number; pixelHeight: number; destroy: () => void };
  type Target = { msaaTextures: Samples[] };
  const targets = renderer.renderTarget as unknown as { getGpuRenderTarget: (t: unknown) => Target; getRenderTarget: (t: unknown) => unknown };
  const lent = new WeakSet<RenderTexture>();
  const borrow = (t: RenderTexture) => {
    if (lent.has(t)) return;
    const own = targets.getGpuRenderTarget(targets.getRenderTarget(t)), view = targets.getGpuRenderTarget(renderer.view.renderTarget);
    const mine = own.msaaTextures[0], theirs = view.msaaTextures[0];
    if (!mine || !theirs || own.msaaTextures.length !== 1 || mine === theirs) return;
    if (mine.pixelWidth !== theirs.pixelWidth || mine.pixelHeight !== theirs.pixelHeight) return;
    mine.destroy();
    own.msaaTextures[0] = theirs;
    lent.add(t);
  };
  const giveBack = (t: RenderTexture) => {
    if (!lent.delete(t)) return;
    targets.getGpuRenderTarget(targets.getRenderTarget(t)).msaaTextures.length = 0;
  };

  const sized = (c: Copy) => {
    const w = renderer.screen.width, h = renderer.screen.height, resolution = renderer.resolution;
    const fits = (t: RenderTexture | null) =>
      !!t && t.width === w && t.height === h && t.source.resolution === resolution;
    if (fits(c.colour)) return;
    const old = c.colour;
    // SAMPLE BY SAMPLE, as the window is drawn: an edge is then the part of a pixel it is, in the colour and in
    // the count.
    c.colour = RenderTexture.create({ width: w, height: h, resolution, antialias: true, scaleMode: "nearest" });
    c.gm.shader.resources.uCache = c.colour.source;
    // THE OLD ONE AFTER THE NEW IS IN: a texture destroyed while a shader still holds it takes the shader's
    // whole set of bindings with it.
    if (old) { giveBack(old); old.destroy(true); }
  };

  return {
    step: () => {
      const c = copy;
      if (!wanted || !c || filling) return;
      if (c.still < STILL || !c.solid) return;
      signature(c);
      // Held, and not the picture the copy is of.
      if (!same(c.now, c.seen) || (c.valid && same(c.now, c.made))) return;
      sized(c);
      // (Asked before every copy till it is had: the window's own are not its new size till it has drawn at it.)
      borrow(c.colour!);
      for (let b = 0; b < c.gm.meshes.length; b++) {
        const shown = c.now[12 + b] >= 0;
        const m = c.fillOf[b];
        if (m.visible !== shown) m.visible = shown;
        if (!shown) continue;
        const rel = c.gm.meshes[b].relativeGroupTransform;
        // A shift alone is set as one, so nothing is taken apart and put together again.
        if (rel.a === 1 && rel.b === 0 && rel.c === 0 && rel.d === 1) {
          if (m.position.x !== rel.tx || m.position.y !== rel.ty) m.position.set(rel.tx, rel.ty);
        } else m.setFromMatrix(rel);
      }
      filling = true;
      try {
        renderer.render({ container: c.fill, target: c.colour!, clear: true, clearColor: [0, 0, 0, 0], transform: c.at });
      } finally { filling = false; }
      c.made.set(c.now);
      c.valid = true;
      made++;
    },
    says: () => ({ made, reading }),
    destroy: () => { renderer.runners.prerender.remove(guard); drop(); },
  };
}
