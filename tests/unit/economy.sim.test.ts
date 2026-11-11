import { describe, it } from "vitest";
import { Sim, fmtGate } from "./econ.simlib";

/**
 * Opt-in economy simulator: an engaged player on AUTO who spends greedily, binds shadows, takes
 * rank trials and challenges each boss gate once the forecast wins 2 of 4. Prints how long each
 * gate takes. Run: ECON_SIM=1 SEEDS=11,22 STOPGATE=45 MAXMIN=300 npx vitest run tests/unit/economy.sim.test.ts
 */
const run = process.env.ECON_SIM === "1";
describe.skipIf(!run)("economy simulator", () => {
  it("gates", () => {
    const seeds = (process.env.SEEDS ?? "11").split(",").map(Number);
    const out: string[] = [];
    for (const seed of seeds) {
      const t0 = Date.now();
      const sim = new Sim({ seed, maxMinutes: Number(process.env.MAXMIN ?? 300), bind: process.env.BIND !== "0", pushAfterCycles: 2, winsNeeded: 2, wallMinutes: Number(process.env.WALL ?? 60), stopAfterGate: Number(process.env.STOPGATE ?? 45), trials: true });
      sim.run();
      out.push(`=== seed ${seed} (${((Date.now() - t0) / 1000).toFixed(0)}s wall) end ${sim.min.toFixed(1)}m lvl ${sim.p.player.level} best ${sim.p.progress.bestStage} cores ${sim.p.player.riftCores} stats ${JSON.stringify(sim.p.player.statLevels)}`);
      for (const g of sim.gates) out.push(fmtGate(g).replace(/forecasts.*/, ""));
    }
    console.log(out.join("\n"));
  }, 3_600_000);
});
