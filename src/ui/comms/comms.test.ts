import { afterEach, describe, expect, test } from "bun:test";

import { LOG_MOST, NOTICE_MS, REPORT_MS, notice, report, useCommsStore } from "../../state/comms.store";
import { DOCK_MOST, dockItems } from "./comms-dock";

afterEach(() => useCommsStore.getState().reset());
const c = () => useCommsStore.getState();

describe("comms", () => {
  test("a report is up for a while and kept in the log; a notice is up for a moment and not logged", () => {
    c().push({ kind: "report", text: "The garage has opened." }, 1000);
    c().push({ kind: "notice", text: "Not enough money" }, 1000);
    expect(c().live.map((e) => e.kind)).toEqual(["report", "notice"]);
    expect(c().log.map((e) => e.kind)).toEqual(["report"]);
    c().expire(1000 + NOTICE_MS);
    expect(c().live.map((e) => e.kind)).toEqual(["report"]);
    c().expire(1000 + REPORT_MS);
    expect(c().live).toEqual([]);
    expect(c().log).toHaveLength(1);
  });

  test("a sticky report stays till dismissed; alerts and transmissions are logged, not put up", () => {
    const id = report("", { from: "ai", title: "While you were out, the AI", lines: ["I built a node."], sticky: true });
    c().expire(Date.now() + 10 * REPORT_MS);
    expect(c().live).toHaveLength(1);
    c().dismiss(id);
    expect(c().live).toHaveLength(0);
    c().note({ kind: "alert", title: "Flood", text: "The river is rising." });
    c().note({ kind: "transmission", from: "ai", title: "Chapter 1", text: "I noticed your payroll…" });
    expect(c().live).toHaveLength(0);
    expect(c().log.map((e) => e.kind)).toEqual(["report", "alert", "transmission"]);
    notice("Can't build here");
    expect(c().log).toHaveLength(3);
  });

  test("the log keeps the session's last few hundred", () => {
    for (let k = 0; k < LOG_MOST + 20; k++) c().note({ kind: "alert", text: `#${k}` });
    expect(c().log).toHaveLength(LOG_MOST);
    expect(c().log[0].text).toBe("#20");
  });

  test("the dock: what needs you most first, three at most, the rest counted", () => {
    expect(dockItems({ objective: true, offer: true, events: [7], reports: [1, 2] }))
      .toEqual({ shown: ["quest:tracker", "quest:offer", "event:7"], hidden: 2 });
    expect(dockItems({ objective: false, offer: false, events: [], reports: [3] })).toEqual({ shown: ["report:3"], hidden: 0 });
    expect(DOCK_MOST).toBe(3);
  });
});
