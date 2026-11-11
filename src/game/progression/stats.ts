import type { StatKey, UpgradeableStat, WeaponPath } from "../data/ids";
import type { CombatStats } from "../entities/types";
import type { EquipmentItem, Profile } from "./profile";
import { SKILLS } from "../data/skills";
import { PERKS } from "../data/perks";
import { codexBonus } from "../summons/extraction";
import { TECHNIQUE_OWNED_ATTACK } from "../data/abilities";
import type { GearEffectId } from "../data/gearEffects";
import { GEAR_SETS, setCounts } from "../data/gearSets";
import { LIMIT_BREAK_STEP, TREE_COMPOUND, aetherGoldMult, aetherPowerMult, nodeLevel } from "./ascension";

/** Each Ascendant rank multiplies core stats. Rank is earned in Rank Trials, not bought. */
export const RANK_STAT_STEP = 0.08;
export const RANK_LABELS = ["E", "D", "C", "B", "A", "S"] as const;

export const BASE_PLAYER_STATS: CombatStats = {
  maxHp: 170,
  attack: 15,
  attackSpeed: 1.05,
  critChance: 0.06,
  critDamage: 1.5,
  defense: 3,
  moveSpeed: 160,
  range: 56,
  hpRegen: 0,
};

/** Per-level flat gain from hold-to-upgrade stat levels. */
export const STAT_UPGRADE_STEP: Record<UpgradeableStat, number> = {
  attack: 2.2,
  maxHp: 14,
  attackSpeed: 0.015,
  critChance: 0.004,
  critDamage: 0.025,
  defense: 0.9,
};

/**
 * Milestones: every MILESTONE_EVERY levels of Attack or Health multiply that stat. A visible goal
 * in the short term and the compounding growth that keeps late stages reachable.
 */
export const MILESTONE_EVERY = 25;
export const MILESTONE_MULT = Number(process.env.ASCEND_MILESTONE ?? 1.5);
export function milestoneMult(level: number): number {
  return Math.pow(MILESTONE_MULT, Math.floor(level / MILESTONE_EVERY));
}

export const STAT_UPGRADE_CAP: Record<UpgradeableStat, number> = {
  attack: 400,
  maxHp: 400,
  attackSpeed: 120,
  critChance: 150,
  critDamage: 300,
  defense: 250,
};

/** Stats the Aether tree's Limit Break raises the cap of. */
export const LIMIT_BREAK_STATS: readonly UpgradeableStat[] = ["attack", "maxHp", "defense"];
export const LIMIT_BREAK_MAX_LEVELS = 10;

/** A stat's level cap for this warrior: the base cap, plus Limit Break for Attack, Health and Defence. */
export function statCap(profile: Profile, stat: UpgradeableStat): number {
  return STAT_UPGRADE_CAP[stat] + (LIMIT_BREAK_STATS.includes(stat) ? LIMIT_BREAK_STEP * nodeLevel(profile, "limit") : 0);
}

export interface StatUnlockRule {
  stat: UpgradeableStat;
  requires: UpgradeableStat;
  level: number;
}

/** Later stats open as earlier ones grow, so the first screen stays simple. */
export const STAT_UNLOCKS: StatUnlockRule[] = [
  { stat: "defense", requires: "maxHp", level: 5 },
  { stat: "attackSpeed", requires: "attack", level: 8 },
  { stat: "critChance", requires: "attackSpeed", level: 5 },
  { stat: "critDamage", requires: "critChance", level: 8 },
];

export function statUnlockRule(stat: UpgradeableStat): StatUnlockRule | undefined {
  return STAT_UNLOCKS.find((r) => r.stat === stat);
}

export function isStatUnlocked(profile: Profile, stat: UpgradeableStat): boolean {
  const rule = statUnlockRule(stat);
  if (!rule) return true;
  return profile.player.statLevels[rule.requires] >= rule.level;
}

export function statUpgradeCost(stat: UpgradeableStat, level: number): number {
  const base: Record<UpgradeableStat, number> = { attack: 10, maxHp: 8, attackSpeed: 24, critChance: 20, critDamage: 18, defense: 14 };
  return Math.round(base[stat] * Math.pow(1.085, level - 1) + (level - 1) * 1.5);
}

export interface PlayerModifiers {
  cooldownMult: number;
  dodgeCooldownMult: number;
  ultimateGainMult: number;
  chainTargetsBonus: number;
  summonDamageMult: number;
  summonDefenseMult: number;
  summonHpMult: number;
  lifeOnKill: number;
  goldFind: number;
  essenceChanceMult: number;
  /** Flat bonus to BIND success chance. */
  extractionBonus: number;
  summonXpMult: number;
  /** Warrior XP from every source. */
  xpMult: number;
  deploySlots: number;
  synergies: Set<"arc_pull" | "thunder_mark" | "nova_opening" | "soul_mend">;
  gearEffects: Set<GearEffectId>;
  weaponPathUnlocked: boolean;
}

export function equippedItems(profile: Profile): EquipmentItem[] {
  const out: EquipmentItem[] = [];
  for (const uid of Object.values(profile.equipment.equipped)) {
    const item = profile.equipment.inventory.find((i) => i.uid === uid);
    if (item) out.push(item);
  }
  return out;
}

export function itemStatTotals(item: EquipmentItem): Partial<Record<StatKey, number>> {
  const totals: Partial<Record<StatKey, number>> = {};
  const levelMult = 1 + (item.level - 1) * 0.1;
  totals[item.mainStat] = (totals[item.mainStat] ?? 0) + item.mainValue * levelMult;
  for (const s of item.substats) totals[s.stat] = (totals[s.stat] ?? 0) + s.value * levelMult;
  return totals;
}

export function computeModifiers(profile: Profile): PlayerModifiers {
  const m: PlayerModifiers = {
    cooldownMult: 1,
    dodgeCooldownMult: 1,
    ultimateGainMult: 1,
    chainTargetsBonus: 0,
    summonDamageMult: 1,
    summonDefenseMult: 1,
    summonHpMult: 1,
    lifeOnKill: 0,
    goldFind: 1,
    essenceChanceMult: 1,
    extractionBonus: 0,
    summonXpMult: 1,
    xpMult: 1,
    deploySlots: 2,
    synergies: new Set(),
    gearEffects: new Set(),
    weaponPathUnlocked: false,
  };
  for (const id of profile.skills.unlocked) {
    const node = SKILLS.find((s) => s.id === id);
    if (!node) continue;
    const e = node.effect;
    switch (e.kind) {
      case "summonStat":
        if (e.stat === "attack") m.summonDamageMult += e.pct;
        if (e.stat === "defense") m.summonDefenseMult += e.pct;
        if (e.stat === "maxHp") m.summonHpMult += e.pct;
        break;
      case "deploySlot":
        m.deploySlots += e.amount;
        break;
      case "synergy":
        m.synergies.add(e.id);
        break;
      case "cooldown":
        m.cooldownMult *= 1 - e.pct;
        break;
      case "dodgeCooldown":
        m.dodgeCooldownMult *= 1 - e.pct;
        break;
      case "ultimateGain":
        m.ultimateGainMult += e.pct;
        break;
      case "essenceChance":
        m.essenceChanceMult += e.pct;
        m.extractionBonus += 0.08;
        break;
      case "summonXp":
        m.summonXpMult += e.pct;
        break;
      case "unlockWeaponPath":
        m.weaponPathUnlocked = true;
        break;
      default:
        break;
    }
  }
  for (const [id, stacks] of Object.entries(profile.player.perks)) {
    const perk = PERKS.find((p) => p.id === id);
    if (!perk || stacks <= 0) continue;
    const e = perk.effect;
    switch (e.kind) {
      case "chainTargets":
        m.chainTargetsBonus += e.amount * stacks;
        break;
      case "dodgeCooldown":
        m.dodgeCooldownMult *= Math.pow(1 - e.pct, stacks);
        break;
      case "summonDamage":
        m.summonDamageMult += e.pct * stacks;
        break;
      case "summonDefense":
        m.summonDefenseMult += e.pct * stacks;
        break;
      case "cooldown":
        m.cooldownMult *= Math.pow(1 - e.pct, stacks);
        break;
      case "goldFind":
        m.goldFind += e.pct * stacks;
        break;
      case "lifeOnKill":
        m.lifeOnKill += e.amount * stacks;
        break;
      case "ultimateGain":
        m.ultimateGainMult += e.pct * stacks;
        break;
      default:
        break;
    }
  }
  for (const item of equippedItems(profile)) if (item.effect) m.gearEffects.add(item.effect);
  for (const [id, n] of setCounts(equippedItems(profile).map((i) => i.templateId))) if (n >= 4) m.gearEffects.add(GEAR_SETS[id].four);
  if (m.gearEffects.has("shadowbound")) {
    m.summonDamageMult += 0.25;
    m.extractionBonus += 0.05;
  }
  if (m.gearEffects.has("tempest")) m.cooldownMult *= 0.85;
  m.goldFind *= aetherGoldMult(profile) * Math.pow(1 + TREE_COMPOUND.fortune, nodeLevel(profile, "fortune"));
  m.xpMult *= Math.pow(1 + TREE_COMPOUND.insight, nodeLevel(profile, "insight"));
  m.extractionBonus += 0.03 * nodeLevel(profile, "oathbinder");
  m.deploySlots += nodeLevel(profile, "command");
  if (profile.player.rank >= 2) m.deploySlots += 1;
  if (profile.player.rank >= 5) m.deploySlots += 1;
  return m;
}

export function weaponPathBonuses(path: WeaponPath): Partial<Record<StatKey, number>> {
  switch (path) {
    case "stormblade":
      return { attackSpeed: 0.15 };
    case "infernal":
      return { attack: 0.1 };
    case "voidfang":
      return { critDamage: 0.3 };
    default:
      return {};
  }
}

export function computePlayerStats(profile: Profile): CombatStats {
  const s: CombatStats = { ...BASE_PLAYER_STATS };
  const lv = profile.player.statLevels;
  s.attack += STAT_UPGRADE_STEP.attack * (lv.attack - 1);
  s.maxHp += STAT_UPGRADE_STEP.maxHp * (lv.maxHp - 1);
  s.attackSpeed += STAT_UPGRADE_STEP.attackSpeed * (lv.attackSpeed - 1);
  s.critChance += STAT_UPGRADE_STEP.critChance * (lv.critChance - 1);
  s.critDamage += STAT_UPGRADE_STEP.critDamage * (lv.critDamage - 1);
  s.defense += STAT_UPGRADE_STEP.defense * (lv.defense - 1);
  s.attack *= milestoneMult(lv.attack);
  s.maxHp *= milestoneMult(lv.maxHp);
  // Aether from past ascensions: permanent, compounding with everything else.
  const aether = aetherPowerMult(profile);
  s.attack *= aether * Math.pow(1 + TREE_COMPOUND.might, nodeLevel(profile, "might"));
  s.maxHp *= aether * Math.pow(1 + TREE_COMPOUND.vigor, nodeLevel(profile, "vigor"));

  // Warrior level: steady compounding power.
  const levelMult = 1 + (profile.player.level - 1) * 0.045;
  s.attack *= levelMult;
  s.maxHp *= levelMult;

  for (const item of equippedItems(profile)) {
    const totals = itemStatTotals(item);
    for (const [k, v] of Object.entries(totals) as [StatKey, number][]) s[k] += v;
  }

  const pct: Partial<Record<StatKey, number>> = {};
  const addPct = (k: StatKey, v: number) => (pct[k] = (pct[k] ?? 0) + v);
  for (const id of profile.skills.unlocked) {
    const node = SKILLS.find((x) => x.id === id);
    if (node?.effect.kind === "stat") addPct(node.effect.stat, node.effect.pct);
    if (node?.id === "s5") addPct("defense", 0.15);
  }
  for (const [id, stacks] of Object.entries(profile.player.perks)) {
    const perk = PERKS.find((p) => p.id === id);
    if (perk?.effect.kind === "stat") addPct(perk.effect.stat, perk.effect.pct * stacks);
  }
  for (const [k, v] of Object.entries(weaponPathBonuses(profile.player.weaponPath)) as [StatKey, number][]) addPct(k, v);
  const codex = codexBonus(profile);
  for (const [k, v] of Object.entries(codex) as [StatKey, number][]) if (v) addPct(k, v);
  for (const [id, n] of setCounts(equippedItems(profile).map((i) => i.templateId))) if (n >= 2) addPct(GEAR_SETS[id].two.stat, GEAR_SETS[id].two.pct);
  // Techniques are owned power: every one learned adds attack, equipped or not.
  if (profile.player.techniques.length) addPct("attack", profile.player.techniques.length * TECHNIQUE_OWNED_ATTACK);
  const rankMult = 1 + profile.player.rank * RANK_STAT_STEP;
  addPct("attack", rankMult - 1);
  addPct("maxHp", rankMult - 1);

  for (const [k, v] of Object.entries(pct) as [StatKey, number][]) {
    if (k === "critChance") s.critChance += v;
    else s[k] *= 1 + v;
  }

  s.hpRegen = s.maxHp * 0.006 + lv.maxHp * 0.06;
  s.attackSpeed = Math.min(3.2, s.attackSpeed);
  s.critChance = Math.min(0.85, s.critChance);
  s.moveSpeed = Math.min(260, s.moveSpeed);
  return s;
}

/** A single number players can compare at a glance. */
export function combatPower(stats: CombatStats): number {
  const dps = stats.attack * stats.attackSpeed * (1 + stats.critChance * (stats.critDamage - 1));
  const ehp = stats.maxHp / Math.max(0.15, 30 / (30 + stats.defense));
  return Math.round(dps * 4 + ehp * 0.6);
}
