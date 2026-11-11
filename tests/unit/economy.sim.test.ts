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
    const reach: Record<number, number[]> = {};
    const bests: number[] = [];
    for (const seed of seeds) {
      const t0 = Date.now();
      const sim = new Sim({ seed, maxMinutes: Number(process.env.MAXMIN ?? 300), bind: process.env.BIND !== "0", pushAfterCycles: 2, winsNeeded: 2, wallMinutes: Number(process.env.WALL ?? 60), stopAfterGate: Number(process.env.STOPGATE ?? 45), trials: true, ascendAfterWaitMin: process.env.ASCEND_AFTER ? Number(process.env.ASCEND_AFTER) : undefined });
      sim.run();
      out.push(`=== seed ${seed} (${((Date.now() - t0) / 1000).toFixed(0)}s wall) end ${sim.min.toFixed(1)}m lvl ${sim.p.player.level} best ${sim.p.progress.bestStage} cores ${sim.p.player.riftCores} stats ${JSON.stringify(sim.p.player.statLevels)}`);
      for (const a of sim.ascensions) out.push(`ascension at ${a.min.toFixed(1)}m from stage ${a.from}: aether ${a.total}`);
      for (const g of sim.gates) out.push(fmtGate(g).replace(/forecasts.*/, ""));
      // The first climb only (before any ascension): when each gate was first reached.
      const firstClimb = sim.ascensions.length ? sim.gates.filter((g) => g.reachMin < (sim.ascensions[0]?.min ?? Infinity)) : sim.gates;
      for (const g of firstClimb) (reach[g.gate] ??= []).push(g.reachMin);
      bests.push(Math.max(sim.p.progress.bestStage, sim.p.ascension.bestEver));
    }
    if (seeds.length > 1) {
      const med = (xs: number[]) => {
        const v = [...xs].sort((a, b) => a - b);
        return v.length % 2 ? (v[(v.length - 1) / 2] as number) : ((v[v.length / 2 - 1] as number) + (v[v.length / 2] as number)) / 2;
      };
      out.push(`SUMMARY over ${seeds.length} seeds: deepest stage median ${med(bests)} (min ${Math.min(...bests)}, max ${Math.max(...bests)})`);
      for (const g of Object.keys(reach).map(Number).sort((a, b) => a - b)) {
        const xs = reach[g] as number[];
        if (g % 6 === 0 || g >= 36) out.push(`  gate ${String(g).padStart(2)} first reached: median ${med(xs).toFixed(1)}m over ${xs.length}/${seeds.length} seeds`);
      }
    }
    console.log(out.join("\n"));
  }, 3_600_000);
});
