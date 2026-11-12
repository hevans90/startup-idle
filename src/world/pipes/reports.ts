/**
 * World v2 — EVERY PIPE NETWORK'S REPORT, from the last frame, in one list:
 * the water mains, the sewer connections above ground and the trunks under
 * it, each with the layer it is on and a tile of it to point at. The mains'
 * and connections' are kept by `runMains`, the trunks' by `stepSewers`; this
 * is the one place that reads both. @see PipeReport, stepPipes
 */
import type { Grid } from "../grid";
import { sewerReportsFor } from "../sewers/flow";
import { solveSewers } from "../sewers/solve";
import { findMains, mainReportsFor } from "../water/mains";
import type { PipeLayer } from "./graph";
import type { PipeReport } from "./report";

export type PipeReportRow = {
  /** What it is: a water main, a sewer connection, or a trunk. */
  kind: "main" | "connection" | "trunk";
  layer: PipeLayer;
  /** A tile of it: its first. */
  cell: number;
  report: PipeReport;
};

export function pipeReports(g: Grid): PipeReportRow[] {
  const out: PipeReportRow[] = [];
  const mains = mainReportsFor(g);
  for (const net of findMains(g).list) {
    const report = mains.get(net.cells[0]);
    if (report) out.push({ kind: net.sewer ? "connection" : "main", layer: "main", cell: net.cells[0], report });
  }
  const trunks = sewerReportsFor(g);
  if (trunks.size) for (const net of solveSewers(g).nets) {
    const report = trunks.get(net.id);
    if (report) out.push({ kind: "trunk", layer: "trunk", cell: net.cells[0], report });
  }
  return out;
}
