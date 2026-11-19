import { describe, expect, test } from "bun:test";

import { applyFixture } from "../debug/fixtures";
import { createGrid, VOID } from "../grid";
import { bandOf } from "../iso";
import { looksOf } from "../roads/looks";
import { createBandLayer } from "./bands";
import { createRoadSnow, destroyRoadSnow, syncRoadSnow } from "./road-snow";

describe("snow on the roads", () => {
  const g = createGrid(48, 48, 1);
  applyFixture(g, "streets", 1);
  const bl = createBandLayer(g.w, g.h), looks = looksOf(g);
  const roadBands = new Set<number>();
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.paved[y * g.w + x] !== VOID && looks[y * g.w + x]) roadBands.add(bandOf(x, y));

  test("over each band's roads, last in it; drawn again only when the roads change; gone with the snow", () => {
    const rs = createRoadSnow();
    syncRoadSnow(rs, bl, g, looks, true, 1, 0);
    const drawn = rs.bands.flatMap((s, b) => (s?.context.instructions.length ? [b] : []));
    expect(new Set(drawn)).toEqual(roadBands);
    for (const b of roadBands) {
      const kids = bl.pavedOf[b].children;
      expect(kids[kids.length - 1]).toBe(rs.bands[b]!);
    }
    // The same roads a moment later: nothing drawn again.
    const first = rs.bands[[...roadBands][0]]!, n = first.context.instructions.length;
    const was = first.context.instructions;
    syncRoadSnow(rs, bl, g, looks, true, 1, 100);
    expect(first.context.instructions).toBe(was);
    expect(first.context.instructions.length).toBe(n);
    syncRoadSnow(rs, bl, g, looks, false, 1, 200);
    expect(rs.on).toBe(false);
    for (const b of roadBands) expect(rs.bands[b]!.context.instructions.length).toBe(0);
    destroyRoadSnow(rs);
  });
});
