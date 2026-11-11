import type { Rng } from "../engine/rng";
import type { EquipSlot, Rarity, StatKey } from "../data/ids";
import { RARITY_ORDER } from "../data/ids";
import { EQUIPMENT_TEMPLATES, RARITY_MULT, RARITY_SUBSTATS, STAT_BASE } from "../data/equipment";
import type { EquipmentItem } from "../progression/profile";
import { GEAR_EFFECT_IDS } from "../data/gearEffects";

let itemCounter = 0;
export function newItemUid(now = Date.now()): string {
  itemCounter = (itemCounter + 1) % 100000;
  return `i_${now.toString(36)}_${itemCounter.toString(36)}`;
}

export function rollRarity(rng: Rng, stage: number, bossDrop: boolean): Rarity {
  const bonus = Math.min(0.25, stage * 0.015);
  const r = rng.next();
  if (bossDrop) {
    if (r < 0.06 + bonus) return "legendary";
    if (r < 0.35 + bonus) return "epic";
    return "rare";
  }
  if (r < 0.01 + bonus * 0.1) return "legendary";
  if (r < 0.05 + bonus * 0.4) return "epic";
  if (r < 0.2 + bonus) return "rare";
  if (r < 0.5 + bonus) return "uncommon";
  return "common";
}

const SUBSTAT_POOL: StatKey[] = ["maxHp", "attack", "attackSpeed", "critChance", "critDamage", "defense", "moveSpeed"];

export function generateItem(rng: Rng, stage: number, rarity: Rarity, slot?: EquipSlot, now = Date.now()): EquipmentItem {
  const rarityIdx = RARITY_ORDER.indexOf(rarity);
  let pool = EQUIPMENT_TEMPLATES.filter((t) => RARITY_ORDER.indexOf(t.minRarity) <= rarityIdx);
  if (slot) pool = pool.filter((t) => t.slot === slot);
  if (pool.length === 0) pool = EQUIPMENT_TEMPLATES.filter((t) => t.minRarity === "common");
  const template = rng.pick(pool);
  const stageMult = 1 + (stage - 1) * 0.18;
  const mainValue = round(STAT_BASE[template.mainStat] * RARITY_MULT[rarity] * stageMult * rng.range(0.9, 1.1), template.mainStat);
  const substats: { stat: StatKey; value: number }[] = [];
  const available = SUBSTAT_POOL.filter((s) => s !== template.mainStat);
  for (let i = 0; i < RARITY_SUBSTATS[rarity]; i++) {
    const stat = rng.pick(available.filter((s) => !substats.some((x) => x.stat === s)));
    substats.push({ stat, value: round(STAT_BASE[stat] * 0.45 * RARITY_MULT[rarity] * stageMult * rng.range(0.8, 1.2), stat) });
  }
  const effect = rarity === "legendary" || (rarity === "epic" && rng.chance(0.5)) ? rng.pick(GEAR_EFFECT_IDS) : undefined;
  return { uid: newItemUid(now), templateId: template.id, slot: template.slot, rarity, level: 1, mainStat: template.mainStat, mainValue, substats, ...(effect ? { effect } : {}) };
}

function round(v: number, stat: StatKey): number {
  if (stat === "critChance" || stat === "attackSpeed") return Math.round(v * 1000) / 1000;
  if (stat === "critDamage") return Math.round(v * 100) / 100;
  return Math.round(v * 10) / 10;
}

export function equipmentUpgradeCost(item: EquipmentItem): number {
  const rarityMult = RARITY_MULT[item.rarity];
  return Math.round(18 * rarityMult * Math.pow(1.22, item.level - 1));
}

export const EQUIPMENT_LEVEL_CAP = 30;

/** Dismantle value in gold. */
export function salvageValue(item: EquipmentItem): number {
  return Math.round(8 * RARITY_MULT[item.rarity] * (1 + (item.level - 1) * 0.3));
}

export function itemScore(item: EquipmentItem): number {
  const levelMult = 1 + (item.level - 1) * 0.1;
  const weight: Record<StatKey, number> = { attack: 10, maxHp: 1, attackSpeed: 400, critChance: 600, critDamage: 150, defense: 12, moveSpeed: 2 };
  let score = item.mainValue * weight[item.mainStat] + (item.effect ? 120 : 0);
  for (const s of item.substats) score += s.value * weight[s.stat];
  return Math.round(score * levelMult);
}
