/**
 * World v2 — THE SHADE ON THE ROADS.
 *
 * The ground works its shadow into its own colour, a pixel at a time, from the shade baked for the map (@see
 * ground-mesh bakeShade). A road is a painted tile laid over the ground, and so lay over the shadow too: a tower's
 * shadow crossed the grass and stopped at the kerb. Here each band's shaded road tiles are drawn once more, over
 * the roads and under what stands on them, as that same shade and nothing else — multiplied into what is there,
 * by the same tint at the same strength: the one shadow, across grass and road alike. @see light
 */
import { Buffer, BufferUsage, Geometry, GlProgram, GpuProgram, Mesh, Shader, UniformGroup } from "pixi.js";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import { VOID, idx, type Grid } from "../grid";
import { SHADOW_TINT_SRC } from "../light";
import type { BandLayer } from "./bands";
import { drawnCorner, withCorners } from "./drawn";
import { groundMode } from "./ground-mode";
import { SHADE_PER_TILE, type GroundMesh } from "./ground-mesh";

const S = SHADE_PER_TILE;

const WGSL = /* wgsl */ `
struct GlobalUniforms {
  uProjectionMatrix: mat3x3<f32>,
  uWorldTransformMatrix: mat3x3<f32>,
  uWorldColorAlpha: vec4<f32>,
  uResolution: vec2<f32>,
};
@group(0) @binding(0) var<uniform> globalUniforms : GlobalUniforms;
struct LocalUniforms {
  uTransformMatrix: mat3x3<f32>,
  uColor: vec4<f32>,
  uRound: f32,
};
@group(1) @binding(0) var<uniform> localUniforms : LocalUniforms;
struct RoadShade { uMap: vec4<f32> };
@group(2) @binding(0) var<uniform> roadShade : RoadShade;
@group(2) @binding(1) var uShade : texture_2d<f32>;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vGround: vec2<f32>,
  @location(1) vAlpha: f32,
};
@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>, @location(1) aGround: vec2<f32>) -> VSOutput {
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  var out: VSOutput;
  out.position = vec4<f32>((mvp * vec3<f32>(aPosition, 1.0)).xy, 0.0, 1.0);
  out.vGround = aGround;
  out.vAlpha = localUniforms.uColor.a * globalUniforms.uWorldColorAlpha.a;
  return out;
}
fn shadeAt(c: vec2<i32>, n: vec2<i32>) -> f32 { return textureLoad(uShade, clamp(c, vec2<i32>(0), n - vec2<i32>(1)), 0).r; }
@fragment
fn mainFragment(in: VSOutput) -> @location(0) vec4<f32> {
  // (The four answers round the point, blended: as the ground reads them. @see ground-mesh shadowAt)
  let n = vec2<i32>(i32(roadShade.uMap.x), i32(roadShade.uMap.y)) * ${S};
  let q = in.vGround * ${S}.0 - 0.5;
  let c = vec2<i32>(floor(q)); let f = q - floor(q);
  let s = mix(mix(shadeAt(c, n), shadeAt(c + vec2<i32>(1, 0), n), f.x), mix(shadeAt(c + vec2<i32>(0, 1), n), shadeAt(c + vec2<i32>(1, 1), n), f.x), f.y);
  return vec4<f32>(mix(vec3<f32>(1.0), vec3<f32>(${SHADOW_TINT_SRC}), s * roadShade.uMap.z * in.vAlpha), 1.0);
}
`;
const GLSL_VERTEX = /* glsl */ `#version 300 es
in vec2 aPosition;
in vec2 aGround;
out vec2 vGround;
out float vAlpha;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vGround = aGround;
  vAlpha = uColor.a * uWorldColorAlpha.a;
}
`;
const GLSL_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec2 vGround;
in float vAlpha;
out vec4 finalColor;
uniform vec4 uMap;
uniform sampler2D uShade;
float shadeAt(ivec2 c, ivec2 n) { return texelFetch(uShade, clamp(c, ivec2(0), n - ivec2(1)), 0).r; }
void main() {
  ivec2 n = ivec2(int(uMap.x), int(uMap.y)) * ${S};
  vec2 q = vGround * ${S}.0 - 0.5;
  ivec2 c = ivec2(floor(q)); vec2 f = q - floor(q);
  float s = mix(mix(shadeAt(c, n), shadeAt(c + ivec2(1, 0), n), f.x), mix(shadeAt(c + ivec2(0, 1), n), shadeAt(c + ivec2(1, 1), n), f.x), f.y);
  finalColor = vec4(mix(vec3(1.0), vec3(${SHADOW_TINT_SRC}), s * uMap.z * vAlpha), 1.0);
}
`;

let program: { gpu: GpuProgram; gl: GlProgram } | null = null;

export type RoadShade = {
  /** Go over the roads' shade if the roads, the ground under them or the shade itself has changed since the last call. */
  sync: (grid: Grid, scale: number) => void;
  destroy: () => void;
};

/** Whether any of a cell's shade, or of the quarter-tiles round it that are blended into its edges, is shadow. */
function shaded(gm: GroundMesh, x: number, y: number): boolean {
  const W = gm.w * S, H = gm.h * S;
  for (let j = Math.max(0, y * S - 1); j <= Math.min(H - 1, y * S + S); j++) for (let i = Math.max(0, x * S - 1); i <= Math.min(W - 1, x * S + S); i++) if (gm.shade[j * W + i]) return true;
  return false;
}

export function createRoadShade(bands: BandLayer, gm: GroundMesh): RoadShade {
  const uniforms = new UniformGroup({ uMap: { value: new Float32Array([gm.w, gm.h, 0.5, 0]), type: "vec4<f32>" } });
  program ??= {
    gpu: GpuProgram.from({
      vertex: { source: WGSL, entryPoint: "mainVertex" }, fragment: { source: WGSL, entryPoint: "mainFragment" }, name: "road-shade",
      layout: [{ globalUniforms: 0 }, { localUniforms: 0 }, { roadShade: 0, uShade: 1 }],
      gpuLayout: [
        [{ binding: 0, visibility: 3, buffer: { type: "uniform" } }],
        [{ binding: 0, visibility: 3, buffer: { type: "uniform" } }],
        [{ binding: 0, visibility: 2, buffer: { type: "uniform" } }, { binding: 1, visibility: 2, texture: { sampleType: "float", viewDimension: "2d", multisampled: false } }],
      ],
    }),
    gl: GlProgram.from({ vertex: GLSL_VERTEX, fragment: GLSL_FRAGMENT, name: "road-shade" }),
  };
  const shader = new Shader({ gpuProgram: program.gpu, glProgram: program.gl, resources: { roadShade: uniforms, uShade: gm.shadeSource } });
  const meshes = new Map<number, { mesh: Mesh<Geometry, Shader>; key: string }>();
  let seenRev = -1, seenShade = -1, seenOf: Grid | null = null;

  const drop = (b: number) => {
    const have = meshes.get(b);
    if (!have) return;
    have.mesh.parent?.removeChild(have.mesh);
    // (Its buffers a moment later: the frame that drew it may still be reading them. @see batches-keep-destroyed-sources)
    const geo = have.mesh.geometry; have.mesh.destroy(); setTimeout(() => geo.destroy(true), 500);
    meshes.delete(b);
  };

  return {
    sync(grid, scale) {
      if (seenOf === grid && seenRev === grid.rev && seenShade === gm.shadeRev) return;
      seenOf = grid; seenRev = grid.rev; seenShade = gm.shadeRev;
      (uniforms.uniforms.uMap as Float32Array)[2] = groundMode() === "smooth" ? 0.5 : 0.72;
      // Each band's shaded road tiles: a quad a tile, corner to corner at the heights the road is drawn through.
      const by = new Map<number, number[]>();
      withCorners(grid, 4, () => {
        for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) {
          if (grid.paved[idx(grid, x, y)] === VOID || !shaded(gm, x, y)) continue;
          let v = by.get(x + y);
          if (!v) by.set(x + y, (v = []));
          for (const [u, w] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
            const z = drawnCorner(grid, x, y, u, w), cx = x + u - 0.5, cy = y + w - 0.5;
            v.push((cx - cy) * HW * scale, ((cx + cy) * HH - z * HEIGHT_UNIT) * scale, x + u, y + w);
          }
        }
      });
      for (const b of [...meshes.keys()]) if (!by.has(b)) drop(b);
      for (const [b, v] of by) {
        const layer = bands.pavedOf[b];
        if (!layer) continue;
        const key = v.join(","), have = meshes.get(b);
        // (Over the band's roads, whichever were laid since: last in its tier.)
        if (have && have.key === key) { if (layer.children[layer.children.length - 1] !== have.mesh) layer.addChild(have.mesh); continue; }
        const verts = new Float32Array(v), quads = v.length / 16, ix = new Uint32Array(quads * 6);
        for (let q = 0; q < quads; q++) ix.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
        if (have) {
          have.mesh.geometry.attributes.aPosition.buffer.data = verts;
          have.mesh.geometry.indexBuffer.data = ix;
          have.key = key;
          if (layer.children[layer.children.length - 1] !== have.mesh) layer.addChild(have.mesh);
          continue;
        }
        const vb = new Buffer({ data: verts, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
        const ib = new Buffer({ data: ix, usage: BufferUsage.INDEX | BufferUsage.COPY_DST });
        const geometry = new Geometry({
          attributes: { aPosition: { buffer: vb, format: "float32x2", stride: 16, offset: 0 }, aGround: { buffer: vb, format: "float32x2", stride: 16, offset: 8 } },
          indexBuffer: ib,
        });
        const mesh = new Mesh<Geometry, Shader>({ geometry, shader });
        mesh.eventMode = "none";
        mesh.blendMode = "multiply";
        layer.addChild(mesh);
        meshes.set(b, { mesh, key });
      }
    },
    destroy() { for (const b of [...meshes.keys()]) drop(b); },
  };
}
