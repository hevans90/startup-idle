/**
 * THE WOODS THROUGH THE YEAR, on the continuous surface: every tree of a band one mesh, not a container and two
 * sprites apiece, so the shader can do what changes all the time and the CPU only what changes now and then.
 *
 * - **The year**: each tree knows the look it has and the next it turns to (`treeTurn`), and when; the shader
 *   dissolves one into the other over that time, clump by clump, and each tree has a lag of its own — a wood turns
 *   over weeks and not at once. A band is written again only when a tree in it finishes a turn.
 * - **The leaves' colour**: a ramp a kind through the year (`LEAF_YEAR`), read where the tree is in its year.
 * - **The wind**: the crown sways and the foot does not; a gust rolls across the map. Calm motion stills it.
 *
 * Painter's order is kept: a band's mesh in its band, its trees back to front. @see world/calendar, dev/bake-trees.ts
 */
import { Assets, Buffer, BufferImageSource, BufferUsage, Geometry, GlProgram, GpuProgram, Mesh, Shader, UniformGroup, type Texture, type TextureSource } from "pixi.js";

import { leafColour, treeTurn, type TreeState } from "../calendar";
import { idx, type Grid } from "../grid";
import { bandOf, HEIGHT_UNIT, HH, HW } from "../iso";
import type { TreeFrame, TreesSheet } from "../props/trees-format";
import { useCalendarStore } from "../../state/calendar.store";
import { useGlobalSettingsStore } from "../../state/global-settings.store";
import type { BandLayer } from "./bands";
import { drawnCorner, drawnHeight } from "./drawn";
import { canopyOf, forestTrees } from "./forest";
import { ageStep } from "../vegetation/step";
import { sickness } from "../vegetation/stress";
import { COVER } from "../vegetation/fields";

const BASE = "/isometric_assets/derived";
/** The kinds, a row of the leaves' ramp each. */
const KINDS = ["oak", "lime", "hornbeam", "cherry", "birch", "pine", "willow", "poplar", "apple", "shrub", "reeds", "stump", "flowers"] as const;
/** Columns of the ramp: the year in this many steps. */
const RAMP = 96;
/** Pages the shader reads. */
const PAGES = 4;

type Sheet = { sheet: TreesSheet; pages: TextureSource[]; ramp: BufferImageSource };
let loading: Promise<Sheet> | null = null;
let loaded: Sheet | null = null;
async function load(): Promise<Sheet> {
  const sheet: TreesSheet = await Assets.load({ src: `${BASE}/trees.json`, loadParser: "loadJson" });
  if (sheet.pages.length > PAGES) throw new Error(`trees: ${sheet.pages.length} pages, the shader reads ${PAGES}`);
  const pages: TextureSource[] = await Promise.all(sheet.pages.map(async (p) =>
    ((await Assets.load({ src: `${BASE}/${p.file}`, data: { autoGenerateMipmaps: true, scaleMode: "linear" } })) as Texture).source));
  const px = new Uint8Array(RAMP * KINDS.length * 4);
  KINDS.forEach((k, row) => {
    for (let i = 0; i < RAMP; i++) {
      const c = leafColour(k, i / RAMP), o = (row * RAMP + i) * 4;
      px[o] = c >> 16; px[o + 1] = (c >> 8) & 255; px[o + 2] = c & 255; px[o + 3] = 255;
    }
  });
  const ramp = new BufferImageSource({ resource: px, width: RAMP, height: KINDS.length, format: "rgba8unorm", scaleMode: "nearest" });
  return { sheet, pages, ramp };
}
const sheetNow = () => { if (!loading) loading = load().then((s) => (loaded = s)); return loaded; };

/**
 * A tree as the mesh keeps it: the forest's (@see forest.ts), stood where the ground is drawn; its lag in the year,
 * its tint and its sway; the band it stands in, and the band its shadow lies in. @see shadeBand
 */
type Tree = {
  kind: string; u: number; v: number; z: number; turn: number; size: number; lag: number; tint: [number, number, number]; phase: number;
  band: number; shade: number;
  /** How burnt, 0–1: a snag, drawn bare and blackened. @see vegetation/wildfire */
  char: number;
};

const hash = (x: number, y: number, k: number, salt: number) =>
  ((Math.imul(Math.imul(x, 0x2c1b3c6d) ^ Math.imul(y, 0x297a2d39) ^ Math.imul(k + 1, 0x9e3779b1) ^ salt, 0x85ebca6b) >>> 8) & 0xffff) / 0x10000;

/** Floats a vertex. */
const F = 40;

/** A frame of a kind's look at a turn; a look it was not baked in, its leaves. */
function frameOf(S: TreesSheet, kind: string, state: TreeState, turn: number): TreeFrame | undefined {
  const k = S.looks[kind];
  return (k?.[state] ?? k?.full)?.[turn % S.turns];
}

/**
 * THE BAND A TREE'S SHADOW LIES IN: the part of a tree under its foot is its shadow on the ground in front, and the
 * ground of every later band draws over anything stood in an earlier one — so that part is drawn with the LAST band
 * it reaches, over all the ground it lies on (and, thin as it is, over a little of what stands in front). No more
 * than three on.
 */
function shadeBand(S: TreesSheet, kind: string, turn: number, size: number, u: number, v: number, band: number): number {
  let bot = 0, left = 0, right = 0;
  for (const look of Object.values(S.looks[kind] ?? {})) {
    const f = look[turn % S.turns];
    if (f) { bot = Math.max(bot, f[4] - f[6]); left = Math.max(left, f[5]); right = Math.max(right, f[3] - f[5]); }
  }
  // Texels to tiles: at scale 1 a texel is 1/res px, a tile's diamond HW px across and HH px down.
  const a = (bot * size) / S.res / HH;
  let last = band;
  for (const lx of [-left, right]) {
    const b = (lx * size) / S.res / HW;
    last = Math.max(last, Math.round(u + (a + b) / 2) + Math.round(v + (a - b) / 2));
  }
  return Math.min(band + 3, last);
}

/**
 * Write one band's part of its trees for the year `t` — their BODIES, top to foot, swaying; or the SHADOWS that
 * fall in it, foot down — and the year at which the first of them finishes its turn.
 */
function writePart(S: Sheet, trees: readonly Tree[], t: number, scale: number, shadows: boolean): { verts: Float32Array; idx: Uint32Array; next: number } {
  const rows = shadows ? 2 : 3;
  const verts = new Float32Array(trees.length * rows * 2 * F), ix = new Uint32Array(trees.length * (rows - 1) * 6);
  let next = Infinity, n = 0, m = 0;
  const gap = S.sheet.gap, res = S.sheet.res;
  for (const tr of trees) {
    const r = treeTurn(tr.kind, t, tr.lag);
    next = Math.min(next, r.t1);
    // (A snag is bare all year: an evergreen's, a broadleaf's bare crown.)
    // (A burnt evergreen has no bare look of its own: a tall narrow one's skeleton stands for it.)
    const bare = tr.char > 0 ? (S.sheet.looks[tr.kind]?.bare ? frameOf(S.sheet, tr.kind, "bare", tr.turn) : frameOf(S.sheet, "hornbeam", "bare", tr.turn)) : null;
    const A = bare ?? frameOf(S.sheet, tr.kind, r.from, tr.turn), B = bare ?? frameOf(S.sheet, tr.kind, r.to, tr.turn);
    // (And its look under snow, for whenever the weather brings it. @see world/weather)
    const C = bare ?? frameOf(S.sheet, tr.kind, "snow", tr.turn) ?? B;
    if (!A || !B || !C) continue;
    // Texels to world px; the foot on the screen.
    const k = (scale * tr.size) / res;
    const fx = (tr.u - tr.v) * HW * scale, fy = (tr.u + tr.v) * HH * scale - tr.z * HEIGHT_UNIT * scale;
    // The box, local px about the foot, both looks fit in.
    const x0 = Math.min(-A[5], -B[5], -C[5]) * k, x1 = Math.max(A[3] - A[5], B[3] - B[5], C[3] - C[5]) * k;
    const top = Math.min(-A[6], -B[6], -C[6]) * k, bot = Math.max(A[4] - A[6], B[4] - B[6], C[4] - C[6]) * k;
    const ys = shadows ? [0, Math.max(bot, 0.5)] : [top, top * 0.45, 0];
    // How far its crown sways, px: by how tall it is. (Its shadow lies still.)
    const amp = shadows ? 0 : -top * 0.022;
    const v0 = n;
    for (let row = 0; row < rows; row++) {
      const ly = ys[row], w = ly < 0 ? Math.pow(ly / top, 1.6) : 0;
      for (const lx of [x0, x1]) {
        const o = n * F;
        verts[o] = fx + lx; verts[o + 1] = fy + ly;
        verts[o + 2] = amp * w; verts[o + 3] = tr.phase; verts[o + 4] = lx / k; verts[o + 5] = ly / k;
        // Texels in each look's first layer.
        verts[o + 6] = A[1] + A[5] + lx / k; verts[o + 7] = A[2] + A[6] + ly / k;
        verts[o + 8] = B[1] + B[5] + lx / k; verts[o + 9] = B[2] + B[6] + ly / k;
        verts[o + 10] = A[1]; verts[o + 11] = A[2]; verts[o + 12] = A[1] + A[3]; verts[o + 13] = A[2] + A[4];
        verts[o + 14] = B[1]; verts[o + 15] = B[2]; verts[o + 16] = B[1] + B[3]; verts[o + 17] = B[2] + B[4];
        verts[o + 18] = A[0]; verts[o + 19] = B[0]; verts[o + 20] = A[3] + gap; verts[o + 21] = B[3] + gap;
        verts[o + 22] = r.t0; verts[o + 23] = r.t1; verts[o + 24] = KINDS.indexOf(tr.kind as (typeof KINDS)[number]); verts[o + 25] = tr.lag;
        verts[o + 26] = tr.tint[0]; verts[o + 27] = tr.tint[1]; verts[o + 28] = tr.tint[2];
        verts[o + 29] = C[1] + C[5] + lx / k; verts[o + 30] = C[2] + C[6] + ly / k;
        verts[o + 32] = C[1]; verts[o + 33] = C[2]; verts[o + 34] = C[1] + C[3]; verts[o + 35] = C[2] + C[4];
        verts[o + 36] = C[0]; verts[o + 37] = C[3] + gap; verts[o + 38] = tr.char;
        n++;
      }
    }
    for (let row = 0; row + 1 < rows; row++) {
      const a = v0 + row * 2;
      ix[m++] = a; ix[m++] = a + 1; ix[m++] = a + 3; ix[m++] = a; ix[m++] = a + 3; ix[m++] = a + 2;
    }
  }
  return { verts: n * F < verts.length ? verts.slice(0, n * F) : verts, idx: m < ix.length ? ix.slice(0, m) : ix, next };
}

export type TreeMesh = {
  /** `snow`: how much lies, 0–1, from the weather. @see world/weather groundAt */
  sync: (g: Grid, palette: readonly (string | null)[], rev: number, scale: number, snow?: number) => void;
  destroy: () => void;
};

/** A part's key: a band's bodies `2b`, the shadows that fall in it `2b + 1`. */
const BODY = 0, SHADE = 1;

export function createTreeMesh(bands: BandLayer): TreeMesh {
  /** Each cell near a wood: its trees, and what they were stood up for. */
  const cells = new Map<number, { key: string; trees: Tree[] }>();
  /** Each part with trees: its mesh, and the year at which it must be written again. */
  const meshes = new Map<number, { mesh: Mesh<Geometry, Shader>; next: number }>();
  /** The trees of each part, back to front: made again when the map changes. */
  let parts = new Map<number, Tree[]>();
  const dirty = new Set<number>();
  const uniforms = new UniformGroup({
    // The year (as years since the calendar began); the wind's clock, s, and its strength; and the snow lying, 0–1.
    uYear: { value: new Float32Array([0, 0, 1, 0]), type: "vec4<f32>" },
    uPages: { value: new Float32Array([2048, 2048, 2048, 2048]), type: "vec4<f32>" },
    uPages2: { value: new Float32Array([2048, 2048, 2048, 2048]), type: "vec4<f32>" },
  });
  let shader: Shader | null = null;
  let key = "", lastT = NaN, scaleNow = 1;
  const t0 = performance.now();

  const drop = (p: number) => {
    const have = meshes.get(p);
    if (!have) return;
    have.mesh.parent?.removeChild(have.mesh);
    // (Its buffers a moment later: the frame that drew it may still be reading them. @see batches-keep-destroyed-sources)
    const geo = have.mesh.geometry; have.mesh.destroy(); setTimeout(() => geo.destroy(true), 500);
    meshes.delete(p);
  };
  const write = (S: Sheet, p: number, t: number) => {
    const trees = parts.get(p) ?? [], have = meshes.get(p);
    if (!trees.length) { drop(p); return; }
    const { verts, idx: ix, next } = writePart(S, trees, t, scaleNow, p % 2 === SHADE);
    if (have) {
      // (Assigning `data` resizes the buffer in place: the geometry, and so the render group's instructions, stay.)
      have.mesh.geometry.attributes.aPos.buffer.data = verts;
      have.mesh.geometry.indexBuffer.data = ix;
      have.next = next;
      return;
    }
    const b = p >> 1, layer = p % 2 === SHADE ? bands.pavedOf[b] : bands.structureOf[b];
    if (!layer) return;
    const vb = new Buffer({ data: verts, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    const ib = new Buffer({ data: ix, usage: BufferUsage.INDEX | BufferUsage.COPY_DST });
    const at = (o: number, format: "float32x2" | "float32x4") => ({ buffer: vb, format, stride: F * 4, offset: o * 4 });
    const geometry = new Geometry({
      attributes: {
        aPos: at(0, "float32x2"), aMove: at(2, "float32x4"), aUv: at(6, "float32x4"), aRectA: at(10, "float32x4"), aRectB: at(14, "float32x4"),
        aPage: at(18, "float32x4"), aTurn: at(22, "float32x4"), aTint: at(26, "float32x4"),
        aUvC: at(29, "float32x2"), aRectC: at(32, "float32x4"), aPageC: at(36, "float32x4"),
      },
      indexBuffer: ib,
    });
    shader ??= treeShader(S, uniforms);
    const mesh = new Mesh<Geometry, Shader>({ geometry, shader });
    mesh.eventMode = "none";
    layer.addChild(mesh);
    meshes.set(p, { mesh, next });
  };

  return {
    sync(g, palette, rev, scale, snow = 0) {
      const S = sheetNow();
      if (!S) return;
      const t = useCalendarStore.getState().now();
      // THE WIND AND THE YEAR, every frame: uniforms only.
      const u = uniforms.uniforms.uYear as Float32Array, pg = uniforms.uniforms.uPages as Float32Array;
      u[0] = t; u[1] = (performance.now() - t0) / 1000; u[2] = useGlobalSettingsStore.getState().motion === "calm" ? 0 : 1; u[3] = snow;
      const pg2 = uniforms.uniforms.uPages2 as Float32Array;
      S.sheet.pages.forEach((pp, k) => { const a = k < 2 ? pg : pg2, o = (k % 2) * 2; a[o] = pp.w; a[o + 1] = pp.h; });
      uniforms.update();

      // THE MAP: cells whose woods, height or ground changed — a cell's trees are by the canopy round it.
      const mk = `${rev}|${g.veg.rev}|${scale}|${palette.length}`;
      if (mk !== key) {
        key = mk;
        const W = g.w, can = new Float32Array(W * g.h);
        for (let y = 0; y < g.h; y++) for (let x = 0; x < W; x++) can[y * W + x] = canopyOf(g, palette, x, y);
        const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= g.h ? 0 : can[y * W + x]);
        const touch = (trees: readonly Tree[]) => { for (const tr of trees) { dirty.add(tr.band * 2 + BODY); dirty.add(tr.shade * 2 + SHADE); } };
        if (scale !== scaleNow) { scaleNow = scale; for (const c of cells.values()) touch(c.trees); cells.clear(); }
        const seen = new Set<number>();
        let changed = false;
        for (let y = 0; y < g.h; y++) for (let x = 0; x < W; x++) {
          let any = 0, ck = "";
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const c = at(x + dx, y + dy); any += c; ck += `${Math.round(c * 72)},`; }
          const i = idx(g, x, y), cv = g.veg.cover[i];
          // (Reeds, heath, snags where a wood burnt and what the player made stand where there is no canopy.)
          if (!any && cv !== COVER.reeds && cv !== COVER.meadow && cv !== COVER.burnt && cv < COVER.stumps) continue;
          // (A hedge joins those beside it.)
          if (cv === COVER.hedge) for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) ck += x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < g.h && g.veg.cover[idx(g, x + dx, y + dy)] === COVER.hedge ? "h" : "-";
          // (What is built on a cell takes what grew there: a building, a deck, a main.)
          ck += `${g.paved[i]}|${g.pool[i] > 0}|${g.structureAt[i] >= 0}|${g.deck[i]}|${g.main[i]}|${g.terrain[i]}|${g.veg.cover[i]},${g.veg.density[i]},${ageStep(g.veg.age[i])},${g.veg.health[i] >> 5}|${drawnCorner(g, x, y, 0, 0)},${drawnCorner(g, x, y, 1, 0)},${drawnCorner(g, x, y, 1, 1)},${drawnCorner(g, x, y, 0, 1)}`;
          seen.add(i);
          const was = cells.get(i);
          if (was?.key === ck) continue;
          changed = true;
          if (was) touch(was.trees);
          const b = bandOf(x, y);
          const sick = sickness(g.veg.health[i]);
          const trees = forestTrees(g, palette, x, y, at).map((w): Tree => {
            const h = (salt: number) => hash(Math.round(w.seed * 65536), salt, 0, 0x5eed);
            const greener = h(1) < 0.5, how = 0.25 * h(2);
            // (Sick: yellowing to brown, each tree a little its own. @see vegetation/stress)
            const ill = sick * (0.7 + 0.6 * h(5)), t0: [number, number, number] = greener ? [1 + how * 0.3, 1 + how * 0.15, 1 - how * 0.5] : [1 - how * 0.5, 1 - how * 0.35, 1 - how * 0.45];
            return {
              kind: w.kind, u: w.u, v: w.v, z: drawnHeight(g, w.u + 0.5, w.v + 0.5), turn: w.turn, size: w.size,
              // Up to a fortnight either way: no two trees of a wood turn together.
              lag: (h(3) - 0.5) * 0.05,
              tint: [t0[0] * (1 + 0.25 * ill), t0[1] * (1 - 0.22 * ill), t0[2] * (1 - 0.6 * ill)],
              char: w.char ?? 0,
              phase: h(4) * Math.PI * 2,
              band: b, shade: shadeBand(S.sheet, w.kind, w.turn, w.size, w.u, w.v, b),
            };
          });
          cells.set(i, { key: ck, trees });
          touch(trees);
        }
        for (const [i, c] of cells) if (!seen.has(i)) { changed = true; touch(c.trees); cells.delete(i); }
        if (changed) {
          const next = new Map<number, Tree[]>();
          for (const c of cells.values()) for (const tr of c.trees) {
            for (const p of [tr.band * 2 + BODY, tr.shade * 2 + SHADE]) { let l = next.get(p); if (!l) next.set(p, (l = [])); l.push(tr); }
          }
          for (const l of next.values()) l.sort((p, q) => p.u + p.v - (q.u + q.v));
          parts = next;
        }
      }

      // THE YEAR: every part whose first turn is done — all of them if the year went back.
      if (t < lastT - 1e-6) for (const p of meshes.keys()) dirty.add(p);
      lastT = t;
      for (const [p, m] of meshes) if (t >= m.next) dirty.add(p);
      for (const p of dirty) write(S, p, t);
      dirty.clear();
    },
    destroy() {
      for (const p of [...meshes.keys()]) drop(p);
      cells.clear(); parts.clear(); key = "";
    },
  };
}

// ─── THE SHADER ──────────────────────────────────────────────────────────────

let program: { gpu: GpuProgram; gl: GlProgram } | null = null;
function treeShader(S: Sheet, uniforms: UniformGroup): Shader {
  program ??= {
    gpu: GpuProgram.from({
      vertex: { source: WGSL, entryPoint: "mainVertex" }, fragment: { source: WGSL, entryPoint: "mainFragment" }, name: "trees",
      // Written out, not left to Pixi, which would show textures to the fragment stage only: the leaves' ramp is
      // read a vertex at a time. @see ground-mesh.ts groundShader
      layout: [{ globalUniforms: 0 }, { localUniforms: 0 }, { trees: 0, uPage0: 1, uPage1: 2, uSampler: 3, uRamp: 4, uPage2: 5, uPage3: 6 }],
      gpuLayout: [
        [{ binding: 0, visibility: 3, buffer: { type: "uniform" } }],
        [{ binding: 0, visibility: 3, buffer: { type: "uniform" } }],
        [
          { binding: 0, visibility: 3, buffer: { type: "uniform" } },
          { binding: 1, visibility: 2, texture: { sampleType: "float", viewDimension: "2d", multisampled: false } },
          { binding: 2, visibility: 2, texture: { sampleType: "float", viewDimension: "2d", multisampled: false } },
          { binding: 3, visibility: 2, sampler: { type: "filtering" } },
          { binding: 4, visibility: 3, texture: { sampleType: "float", viewDimension: "2d", multisampled: false } },
          { binding: 5, visibility: 2, texture: { sampleType: "float", viewDimension: "2d", multisampled: false } },
          { binding: 6, visibility: 2, texture: { sampleType: "float", viewDimension: "2d", multisampled: false } },
        ],
      ],
    }),
    gl: GlProgram.from({ vertex: GLSL_VERTEX, fragment: GLSL_FRAGMENT, name: "trees" }),
  };
  // (A page the sheet has not: the first again, never read.)
  const p = (k: number) => S.pages[k] ?? S.pages[0];
  return new Shader({ gpuProgram: program.gpu, glProgram: program.gl, resources: { trees: uniforms, uPage0: p(0), uPage1: p(1), uSampler: p(0).style, uRamp: S.ramp, uPage2: p(2), uPage3: p(3) } });
}

/*
 * The same in both languages. A vertex carries: its place (aPos); its sway, px at rest, the tree's phase, and where
 * it is on the tree in texels about its foot (aMove); each look's texel (aUv: A then B); each look's box (aRectA,
 * aRectB); each look's page and the step from its leaves to the rest (aPage); the turn's start and end, the kind's
 * row in the ramp and the tree's lag (aTurn); and the tree's own tint (aTint).
 */
const WGSL = /* wgsl */ `
struct GlobalUniforms { uProjectionMatrix: mat3x3<f32>, uWorldTransformMatrix: mat3x3<f32>, uWorldColorAlpha: vec4<f32>, uResolution: vec2<f32> };
@group(0) @binding(0) var<uniform> globalUniforms : GlobalUniforms;
struct LocalUniforms { uTransformMatrix: mat3x3<f32>, uColor: vec4<f32>, uRound: f32 };
@group(1) @binding(0) var<uniform> localUniforms : LocalUniforms;
struct Trees { uYear: vec4<f32>, uPages: vec4<f32>, uPages2: vec4<f32> };
@group(2) @binding(0) var<uniform> trees : Trees;
@group(2) @binding(1) var uPage0 : texture_2d<f32>;
@group(2) @binding(2) var uPage1 : texture_2d<f32>;
@group(2) @binding(5) var uPage2 : texture_2d<f32>;
@group(2) @binding(6) var uPage3 : texture_2d<f32>;
@group(2) @binding(3) var uSampler : sampler;
@group(2) @binding(4) var uRamp : texture_2d<f32>;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vUv: vec4<f32>,
  @location(1) vRectA: vec4<f32>,
  @location(2) vRectB: vec4<f32>,
  @location(3) vPage: vec4<f32>,
  @location(4) vLocal: vec2<f32>,
  @location(5) vBlend: f32,
  @location(6) vLeaf: vec3<f32>,
  @location(7) vTint: vec4<f32>,
  @location(8) vUvC: vec2<f32>,
  @location(9) vRectC: vec4<f32>,
  @location(10) vPageC: vec2<f32>,
};

fn hash(p: vec2<i32>) -> f32 {
  var h = bitcast<u32>(p.x) * 1664525u + bitcast<u32>(p.y) * 1013904223u;
  h = h ^ (h >> 16u); h = h * 0x7feb352du; h = h ^ (h >> 15u); h = h * 0x846ca68bu; h = h ^ (h >> 16u);
  return f32(h) / 4294967295.0;
}
fn vnoise(p: vec2<f32>) -> f32 {
  let i = vec2<i32>(floor(p)); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2<i32>(1, 0)), u.x), mix(hash(i + vec2<i32>(0, 1)), hash(i + vec2<i32>(1, 1)), u.x), u.y);
}
fn rampAt(row: i32, y: f32) -> vec3<f32> {
  let q = fract(y) * ${RAMP}.0; let i = i32(floor(q)) % ${RAMP}; let j = (i + 1) % ${RAMP};
  return mix(textureLoad(uRamp, vec2<i32>(i, row), 0).rgb, textureLoad(uRamp, vec2<i32>(j, row), 0).rgb, fract(q));
}

@vertex
fn mainVertex(@location(0) aPos: vec2<f32>, @location(1) aMove: vec4<f32>, @location(2) aUv: vec4<f32>, @location(3) aRectA: vec4<f32>,
  @location(4) aRectB: vec4<f32>, @location(5) aPage: vec4<f32>, @location(6) aTurn: vec4<f32>, @location(7) aTint: vec4<f32>,
  @location(8) aUvC: vec2<f32>, @location(9) aRectC: vec4<f32>, @location(10) aPageC: vec4<f32>) -> VSOutput {
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  // THE WIND: a slow swing of its own, and a gust that rolls across the map.
  let tw = trees.uYear.y;
  let gust = 0.5 + 0.5 * sin(tw * 0.35 - aPos.x * 0.0025 - aPos.y * 0.0012);
  let sway = (sin(tw * 1.3 + aMove.y) * 0.55 + sin(tw * 2.9 + aMove.y * 1.7) * 0.2) * (0.35 + 0.65 * gust * gust) + gust * 0.5;
  let p = aPos + vec2<f32>(aMove.x * sway * trees.uYear.z, 0.0);
  var out: VSOutput;
  out.position = vec4<f32>((mvp * vec3<f32>(p, 1.0)).xy, 0.0, 1.0);
  out.vUv = aUv; out.vRectA = aRectA; out.vRectB = aRectB; out.vPage = aPage; out.vLocal = aMove.zw;
  out.vBlend = clamp((trees.uYear.x - aTurn.x) / max(aTurn.y - aTurn.x, 1e-5), 0.0, 1.0);
  out.vLeaf = rampAt(i32(aTurn.z + 0.5), trees.uYear.x + aTurn.w) * aTint.rgb;
  out.vTint = localUniforms.uColor * globalUniforms.uWorldColorAlpha;
  out.vUvC = aUvC; out.vRectC = aRectC; out.vPageC = aPageC.xy;
  // (Burnt: blackened. @see vegetation/wildfire)
  out.vTint = vec4<f32>(out.vTint.rgb * (1.0 - 0.78 * aPageC.z), out.vTint.a);
  return out;
}

fn pageAt(page: f32, uv: vec2<f32>, dx: vec2<f32>, dy: vec2<f32>) -> vec4<f32> {
  if (page > 2.5) { return textureSampleGrad(uPage3, uSampler, uv / trees.uPages2.zw, dx / trees.uPages2.zw, dy / trees.uPages2.zw); }
  if (page > 1.5) { return textureSampleGrad(uPage2, uSampler, uv / trees.uPages2.xy, dx / trees.uPages2.xy, dy / trees.uPages2.xy); }
  if (page > 0.5) { return textureSampleGrad(uPage1, uSampler, uv / trees.uPages.zw, dx / trees.uPages.zw, dy / trees.uPages.zw); }
  return textureSampleGrad(uPage0, uSampler, uv / trees.uPages.xy, dx / trees.uPages.xy, dy / trees.uPages.xy);
}
fn inside(uv: vec2<f32>, r: vec4<f32>) -> bool { return uv.x >= r.x && uv.y >= r.y && uv.x <= r.z && uv.y <= r.w; }

@fragment
fn mainFragment(@location(0) vUv: vec4<f32>, @location(1) vRectA: vec4<f32>, @location(2) vRectB: vec4<f32>, @location(3) vPage: vec4<f32>,
  @location(4) vLocal: vec2<f32>, @location(5) vBlend: f32, @location(6) vLeaf: vec3<f32>, @location(7) vTint: vec4<f32>,
  @location(8) vUvC: vec2<f32>, @location(9) vRectC: vec4<f32>, @location(10) vPageC: vec2<f32>) -> @location(0) vec4<f32> {
  let dx = dpdx(vUv.xy); let dy = dpdy(vUv.xy);
  // THE TURN, clump by clump: a broad noise and a little of a fine one, each point of the tree its own moment in it.
  let n = vnoise(vLocal / 7.0) * 0.82 + hash(vec2<i32>(floor(vLocal / 4.0))) * 0.18;
  let b = n < vBlend * 1.02 - 0.01;
  // SNOW as the weather lays it, clump by clump, the other way through the same noise. @see world/weather
  let snowy = (1.0 - n) < trees.uYear.w * 1.02 - 0.01;
  let uv = select(select(vUv.xy, vUv.zw, b), vUvC, snowy);
  let rect = select(select(vRectA, vRectB, b), vRectC, snowy);
  if (!inside(uv, rect)) { discard; }
  let page = select(select(vPage.x, vPage.y, b), vPageC.x, snowy); let off = select(select(vPage.z, vPage.w, b), vPageC.y, snowy);
  let leaf = pageAt(page, uv, dx, dy);
  let rest = pageAt(page, uv + vec2<f32>(off, 0.0), dx, dy);
  let col = rest + vec4<f32>(leaf.rgb * vLeaf, leaf.a) * (1.0 - rest.a);
  if (col.a < 0.004) { discard; }
  return col * vTint;
}
`;

const GLSL_VERTEX = /* glsl */ `#version 300 es
precision highp float;
in vec2 aPos; in vec4 aMove; in vec4 aUv; in vec4 aRectA; in vec4 aRectB; in vec4 aPage; in vec4 aTurn; in vec4 aTint;
in vec2 aUvC; in vec4 aRectC; in vec4 aPageC;
out vec4 vUv; out vec4 vRectA; out vec4 vRectB; out vec4 vPage; out vec2 vLocal; out float vBlend; out vec3 vLeaf; out vec4 vTint;
out vec2 vUvC; out vec4 vRectC; out vec2 vPageC;
uniform mat3 uProjectionMatrix; uniform mat3 uWorldTransformMatrix; uniform vec4 uWorldColorAlpha; uniform vec2 uResolution;
uniform mat3 uTransformMatrix; uniform vec4 uColor;
uniform vec4 uYear; uniform vec4 uPages; uniform vec4 uPages2;
uniform sampler2D uRamp;
vec3 rampAt(int row, float y) {
  float q = fract(y) * ${RAMP}.0; int i = int(floor(q)) % ${RAMP}; int j = (i + 1) % ${RAMP};
  return mix(texelFetch(uRamp, ivec2(i, row), 0).rgb, texelFetch(uRamp, ivec2(j, row), 0).rgb, fract(q));
}
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  float tw = uYear.y;
  float gust = 0.5 + 0.5 * sin(tw * 0.35 - aPos.x * 0.0025 - aPos.y * 0.0012);
  float sway = (sin(tw * 1.3 + aMove.y) * 0.55 + sin(tw * 2.9 + aMove.y * 1.7) * 0.2) * (0.35 + 0.65 * gust * gust) + gust * 0.5;
  vec2 p = aPos + vec2(aMove.x * sway * uYear.z, 0.0);
  gl_Position = vec4((mvp * vec3(p, 1.0)).xy, 0.0, 1.0);
  vUv = aUv; vRectA = aRectA; vRectB = aRectB; vPage = aPage; vLocal = aMove.zw;
  vBlend = clamp((uYear.x - aTurn.x) / max(aTurn.y - aTurn.x, 1e-5), 0.0, 1.0);
  vLeaf = rampAt(int(aTurn.z + 0.5), uYear.x + aTurn.w) * aTint.rgb;
  vTint = uColor * uWorldColorAlpha;
  vUvC = aUvC; vRectC = aRectC; vPageC = aPageC.xy;
  vTint = vec4(vTint.rgb * (1.0 - 0.78 * aPageC.z), vTint.a);
}
`;

const GLSL_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec4 vUv; in vec4 vRectA; in vec4 vRectB; in vec4 vPage; in vec2 vLocal; in float vBlend; in vec3 vLeaf; in vec4 vTint;
in vec2 vUvC; in vec4 vRectC; in vec2 vPageC;
out vec4 finalColor;
uniform vec4 uYear; uniform vec4 uPages; uniform vec4 uPages2;
uniform sampler2D uPage0; uniform sampler2D uPage1; uniform sampler2D uPage2; uniform sampler2D uPage3;
float hash(ivec2 p) {
  uint h = uint(p.x) * 1664525u + uint(p.y) * 1013904223u;
  h = h ^ (h >> 16u); h = h * 0x7feb352du; h = h ^ (h >> 15u); h = h * 0x846ca68bu; h = h ^ (h >> 16u);
  return float(h) / 4294967295.0;
}
float vnoise(vec2 p) {
  ivec2 i = ivec2(floor(p)); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + ivec2(1, 0)), u.x), mix(hash(i + ivec2(0, 1)), hash(i + ivec2(1, 1)), u.x), u.y);
}
vec4 pageAt(float page, vec2 uv, vec2 dx, vec2 dy) {
  if (page > 2.5) return textureGrad(uPage3, uv / uPages2.zw, dx / uPages2.zw, dy / uPages2.zw);
  if (page > 1.5) return textureGrad(uPage2, uv / uPages2.xy, dx / uPages2.xy, dy / uPages2.xy);
  if (page > 0.5) return textureGrad(uPage1, uv / uPages.zw, dx / uPages.zw, dy / uPages.zw);
  return textureGrad(uPage0, uv / uPages.xy, dx / uPages.xy, dy / uPages.xy);
}
bool inside(vec2 uv, vec4 r) { return uv.x >= r.x && uv.y >= r.y && uv.x <= r.z && uv.y <= r.w; }
void main() {
  vec2 dx = dFdx(vUv.xy), dy = dFdy(vUv.xy);
  float n = vnoise(vLocal / 7.0) * 0.82 + hash(ivec2(floor(vLocal / 4.0))) * 0.18;
  bool b = n < vBlend * 1.02 - 0.01;
  bool snowy = (1.0 - n) < uYear.w * 1.02 - 0.01;
  vec2 uv = snowy ? vUvC : b ? vUv.zw : vUv.xy;
  vec4 rect = snowy ? vRectC : b ? vRectB : vRectA;
  if (!inside(uv, rect)) discard;
  float page = snowy ? vPageC.x : b ? vPage.y : vPage.x; float off = snowy ? vPageC.y : b ? vPage.w : vPage.z;
  vec4 leaf = pageAt(page, uv, dx, dy);
  vec4 rest = pageAt(page, uv + vec2(off, 0.0), dx, dy);
  vec4 col = rest + vec4(leaf.rgb * vLeaf, leaf.a) * (1.0 - rest.a);
  if (col.a < 0.004) discard;
  finalColor = col * vTint;
}
`;
