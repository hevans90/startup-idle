/**
 * Whether a quad of the water mesh draws anything at all.
 *
 * ONE RULE, TWO CALLERS, and that is the whole reason this is a file rather
 * than a few lines in the vertex shader. The shader has always had to ask —
 * a part that is not there collapses its corners onto a point — and now the
 * GATHERING PASS has to ask the same question a frame earlier, so that a band
 * can draw the quads that survive instead of all the quads that might. Two
 * copies of this would be two answers, and the disagreement would be water
 * that flickers where the two happen to differ.
 *
 * Written against the same small vocabulary `cornerRuleSource` needs and
 * nothing else — `inside`, `depthAt`, `groundAt`, `dryDepth`, `fallMin`, plus
 * `resolveSide` and `cornerOf` from the rule itself. That is what lets the
 * vertex shader answer it from its textures and a compute pass answer it from
 * the same textures without either knowing about the other.
 *
 * A FACE WITH NO HEIGHT IS NOT A FACE. `sidePart` never refuses to build one —
 * it hands back a quad whose two ends have collapsed to their own floor, which
 * makes no fragments and cost four vertex invocations anyway. That collapse is
 * what this tests for, and it is the test that matters: on a flooded map
 * almost every interior face is one.
 */
import type { Dialect } from "./corner-rule";

export function quadRuleSource(dialect: Dialect): string {
  const wgsl = dialect === "wgsl";
  const NUM = wgsl ? "let" : "float";
  const INT = wgsl ? "let" : "int";
  const BOOL = wgsl ? "let" : "bool";
  // A DECLARATION, not a type: WGSL infers and GLSL names. The rest of
  // these read as types in GLSL and as `let` in WGSL for the same reason.
  const V4 = wgsl ? "let" : "vec4";
  return `
${wgsl
    ? "fn forward(cx: i32, cy: i32, axis: i32, cpt: i32) -> bool {"
    : "bool forward(int cx, int cy, int axis, int cpt) {"}
  // Only on a tile's own far edge — an interior face never crosses a band
  // boundary — and only where the ground in front is BELOW this water, because
  // a tile in front that stands higher is genuinely in front and its terrain
  // covering the face is the band order doing its job.
  ${BOOL} onEdge = select(cy % cpt, cx % cpt, axis == 0) == cpt - 1;
  if (!onEdge) { return false; }
  ${INT} jx = cx + select(0, 1, axis == 0);
  ${INT} jy = cy + select(1, 0, axis == 0);
  if (!inside(jx, jy)) { return false; }
  return groundAt(jx, jy) < groundAt(cx, cy) + depthAt(cx, cy);
}

${wgsl
    ? "fn sideShows(cx: i32, cy: i32, axis: i32) -> bool {"
    : "bool sideShows(int cx, int cy, int axis) {"}
  // The same four numbers sidePart hangs the quad from. If both ends have
  // come down to their own floor the quad is a line and draws nothing.
  ${INT} jx = cx + select(0, 1, axis == 0);
  ${INT} jy = cy + select(1, 0, axis == 0);
  ${BOOL} rim = !inside(jx, jy);
  ${NUM} bed = groundAt(cx, cy);
  ${NUM} bedJ = select(groundAt(jx, jy), bed, rim);
  ${BOOL} wetJ = !rim && depthAt(jx, jy) > dryDepth();
  ${INT} vax = cx + select(0, 1, axis == 0);
  ${INT} vay = cy + select(1, 0, axis == 0);
  ${V4} s = resolveSide(bed, bedJ, wetJ, cornerOf(vax, vay), cornerOf(cx + 1, cy + 1));
  return s.x > s.z || s.y > s.w;
}

${wgsl
    ? "fn quadDraws(cx: i32, cy: i32, part: i32, cpt: i32, faces: bool) -> bool {"
    : "bool quadDraws(int cx, int cy, int part, int cpt, bool faces) {"}
  if (!inside(cx, cy)) { return false; }
  if (part == 0) { return depthAt(cx, cy) > dryDepth(); }
  if (!faces) { return false; }
  if (part <= 2) {
    // A SIDE OF THIS COLUMN, unless it is filed forward into the band in front.
    if (depthAt(cx, cy) <= dryDepth()) { return false; }
    ${INT} axis = part - 1;
    if (forward(cx, cy, axis, cpt)) { return false; }
    return sideShows(cx, cy, axis);
  }
  // The far-edge face of the column BEHIND this one, filed into this band.
  ${INT} axis2 = part - 3;
  ${INT} bx = cx - select(0, 1, axis2 == 0);
  ${INT} by = cy - select(1, 0, axis2 == 0);
  if (!inside(bx, by)) { return false; }
  if (depthAt(bx, by) <= dryDepth()) { return false; }
  if (!forward(bx, by, axis2, cpt)) { return false; }
  return sideShows(bx, by, axis2);
}
`;
}
