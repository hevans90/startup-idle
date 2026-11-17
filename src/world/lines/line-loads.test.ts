import { describe, expect, test } from "bun:test";

import { createTown, stepTown } from "../agents/town";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx } from "../grid";
import { createNetwork } from "../roads/network";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { lineDone, newLine, stepLine } from "./jobs";
import { lineHead, lineLorriesOut, sendLineLoad, stepLineHaul } from "./line-loads";

/** A road along row 5 edge to edge, the Garage on its north side; a line ordered south of it. */
function yardAndLine(far = false) {
  const g = createGrid(40, 30);
  fillTerrain(g, 1);
  for (let x = 0; x < g.w; x++) g.paved[idx(g, x, 5)] = 1;
  commit(g, createHistory(), placeCommand(g, structureDef("garage")!, 2, 2)!);
  const y = far ? 24 : 8, j = newLine(1, "main", Array.from({ length: 10 }, (_, k) => ({ x: 20 + k, y })), null, 600, 0);
  g.lineJobs.push(j);
  return { g, j, net: createNetwork(g), town: createTown() };
}

describe("a line's pipe, by road", () => {
  test("a load is put on a lorry in the yard, driven to the road by the line and up its track, counted in there, and the lorry drives home", () => {
    const { g, j, net, town } = yardAndLine();
    const haul = { net, town };
    expect(lineHead(g, net, j)).toMatchObject({ x: 20, y: 5 });
    let sent = 0, back = false, yard = false, up = false;
    for (let t = 0; t < 400 && !lineDone(j); t += 1 / 30) {
      stepLineHaul(g, haul, 1 / 30);
      const out = lineLorriesOut(town, g).get(j.id) ?? 0;
      stepLine(j, 1 / 30, () => true, { out, send: () => { const ok = sendLineLoad(g, haul, j); if (ok) sent++; return ok; } });
      yard ||= !!j.yard?.length;
      up ||= !!j.drive?.length;
      back ||= town.movers.some((m) => m.job?.role === "haul-back");
      town.arrived.length = 0;
      stepTown(town, g, net, 0, 1 / 30);
    }
    // Loaded in the yard, driven up the job's track.
    expect(yard && up).toBe(true);
    // Every load by lorry, none on the clock; each lorry seen driving home.
    expect(sent).toBe(j.deliveries);
    expect(j.coming.length).toBe(0);
    expect(j.delivered).toBe(j.deliveries);
    expect(back).toBe(true);
    expect(lineDone(j)).toBe(true);
  });

  test("a line no road comes near is supplied on the clock, as it was", () => {
    const { g, j, net, town } = yardAndLine(true);
    expect(lineHead(g, net, j)).toBeNull();
    expect(sendLineLoad(g, { net, town }, j)).toBe(false);
    stepLine(j, 0.1, () => true, { out: 0, send: () => sendLineLoad(g, { net, town }, j) });
    expect(j.coming.length).toBe(1);
  });
});
