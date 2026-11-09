import { it } from "vitest";
import { createDefaultProfile } from "@/game/progression/profile";
import { profileWithUpgrades, simulateRun } from "./balance.harness";
import { newInstanceId } from "@/game/summons/recruitment";

(process.env.BALANCE_PRINT ? it : it.skip)("prints balance table", () => {
  const rows: string[] = [];
  for (const seed of [1, 2, 3]) rows.push(`fresh passive s1 seed${seed}: ${JSON.stringify(simulateRun(createDefaultProfile(), 1, seed, 240, "passive"))}`);
  for (const seed of [1, 2, 3]) rows.push(`fresh active  s1 seed${seed}: ${JSON.stringify(simulateRun(createDefaultProfile(), 1, seed, 240, "active"))}`);
  for (const seed of [1, 2, 3]) rows.push(`fresh spender s1 seed${seed}: ${JSON.stringify(simulateRun(createDefaultProfile(), 1, seed, 300, "spender"))}`);
  const p1 = createDefaultProfile();
  p1.summons.collection.push({ instanceId: newInstanceId(), defId: "husk_blade", level: 1, xp: 0, bond: 1, shards: 0, deployed: true, recruitedAt: 0 });
  for (const seed of [1, 2, 3]) rows.push(`fresh spender+husk s1 seed${seed}: ${JSON.stringify(simulateRun(p1, 1, seed, 300, "spender"))}`);
  const p = profileWithUpgrades({ attack: 8, maxHp: 8, defense: 3 }, { level: 3 });
  p.summons.collection.push({ instanceId: newInstanceId(), defId: "ashborn_bulwark", level: 2, xp: 0, bond: 2, shards: 0, deployed: true, recruitedAt: 0 });
  p.summons.collection.push({ instanceId: newInstanceId(), defId: "husk_blade", level: 2, xp: 0, bond: 1, shards: 0, deployed: true, recruitedAt: 0 });
  for (const seed of [1, 2, 3]) rows.push(`upgraded+2sum s1 seed${seed}: ${JSON.stringify(simulateRun(p, 1, seed, 300, "active"))}`);
  for (const stage of [2, 3, 4]) rows.push(`upgraded+2sum s${stage}: ${JSON.stringify(simulateRun(p, stage, 7, 300, "active"))}`);
  const p2 = profileWithUpgrades({ attack: 20, maxHp: 18, defense: 8, attackSpeed: 4 }, { level: 7 });
  p2.summons.collection.push(...p.summons.collection.map((s) => ({ ...s, level: 6, bond: 5 })));
  for (const stage of [3, 5, 7, 9]) rows.push(`strong+2sum s${stage}: ${JSON.stringify(simulateRun(p2, stage, 9, 300, "active"))}`);
  console.log(rows.join("\n"));
});
