import { describe, expect, jest, test } from "bun:test";
import { allocationFor, runBalanceSim } from "./balance-sim";

const advance = jest.advanceTimersByTime.bind(jest);

/** Long comparison runs are opt-in: `BENCH=1 bun test src/simulation/balance-sim.test.ts` */
const heavyTest = process.env.BENCH === "1" ? test : test.skip;

describe("balance-sim", () => {
  test("allocationFor reaches its targets and pads to the requested size", () => {
    const ids = allocationFor(["crunch_keystone"], 40);
    expect(ids.length).toBe(40);
    expect(ids).toContain("core");
    expect(ids).toContain("crunch_keystone");
    // Padding must not smuggle in other keystones — a build's structural
    // reshapes should be exactly the ones asked for.
    expect(ids).not.toContain("lean_keystone");
    expect(ids).not.toContain("enshit_keystone");
  });

  test("a short run produces a coherent economy", () => {
    const r = runBalanceSim(advance, { seconds: 300 });

    expect(r.employees.intern).toBeGreaterThan(0);
    expect(r.moneyPerSecond).toBeGreaterThan(0);
    expect(r.accruedValuation).toBeGreaterThan(0);
    expect(r.upgradesPurchased).toBeGreaterThan(0);
    expect(Number.isFinite(r.moneyPerSecond)).toBe(true);

    const shareSum =
      r.moneyShare.intern + r.moneyShare.vibe_coder + r.moneyShare["10x_dev"];
    expect(shareSum).toBeCloseTo(1, 2);
  }, 30000);

  test("an allocated tree outperforms a bare one at identical settings", () => {
    const bare = runBalanceSim(advance, { seconds: 600, allocated: ["core"] });
    const crunch = runBalanceSim(advance, {
      seconds: 600,
      allocated: allocationFor(["crunch_keystone"], 60),
    });
    expect(crunch.accruedValuation).toBeGreaterThan(bare.accruedValuation);
  }, 60000);

  // ── Worked examples ─────────────────────────────────────────────────────────
  // Not assertions — these are how you'd actually use the harness to answer a
  // balance question. Run with BENCH=1 and read the table.

  heavyTest("example: which keystones are worth taking?", () => {
    const builds: { name: string; targets: string[] }[] = [
      { name: "no keystone", targets: [] },
      { name: "crunch", targets: ["crunch_keystone"] },
      { name: "enshittify", targets: ["enshit_keystone"] },
      { name: "enshit+crunch", targets: ["enshit_keystone", "crunch_keystone"] },
      { name: "down round", targets: ["vc_keystone"] },
    ];
    console.log("\nbuild             accrued      $/sec        share I/V/10x");
    for (const b of builds) {
      const r = runBalanceSim(advance, {
        seconds: 7200,
        allocated: allocationFor(b.targets, 130),
      });
      const share = (["intern", "vibe_coder", "10x_dev"] as const)
        .map((k) => (r.moneyShare[k] * 100).toFixed(0))
        .join("/");
      console.log(
        `${b.name.padEnd(16)} ${r.accruedValuation.toExponential(2).padStart(10)}  ` +
          `${r.moneyPerSecond.toExponential(2).padStart(10)}  ${share}`,
      );
    }
  }, 600000);

  heavyTest("example: how does a founder scale with its exit count?", () => {
    const allocated = allocationFor(["enshit_keystone", "crunch_keystone"], 130);
    console.log("\nfounder exits   accrued");
    for (const founderExits of [0, 5, 10]) {
      const r = runBalanceSim(advance, {
        seconds: 7200,
        allocated,
        founderId: "neet",
        founderExits,
      });
      console.log(
        `NEET@${String(founderExits).padEnd(9)} ${r.accruedValuation.toExponential(2)}`,
      );
    }
  }, 600000);
});
