import type { StatKey, UpgradeableStat, WeaponPath } from "../data/ids";
import type { CombatStats } from "../entities/types";
import type { EquipmentItem, Profile } from "./profile";
import { SKILLS } from "../data/skills";
import { PERKS } from "../data/perks";
import { codexBonus } from "../summons/extraction";
import { TECHNIQUE_OWNED_ATTACK } from "../data/abilities";
import type { GearEffectId } from "../data/gearEffects";
import { GEAR_SETS, setCounts } from "../data/gearSets";
import { ASCEND_MIN_STAGE, LIMIT_BREAK_MAX, LIMIT_BREAK_STEP, TREE_COMPOUND, aetherGoldMult, aetherPowerMult, nodeLevel } from "./ascension";

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
export const LIMIT_BREAK_MAX_LEVELS = LIMIT_BREAK_MAX;

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

/** The items in the bag: owned and not equipped. */
export function bagItems(profile: Profile): EquipmentItem[] {
  const on = new Set(Object.values(profile.equipment.equipped));
  return profile.equipment.inventory.filter((i) => !on.has(i.uid));
}

/**
 * Every item kept makes the warrior stronger: an item in the bag lends this share of its stat line
 * (main stat and substats, at its level; not its special effect, not its set). Strength folded
 * into an item by the forge (`kept`) lends the same share wherever the item is, worn or not, so
 * forging three into one never lowers what they lend.
 * Measured on the simulator's saved profiles (a full bag is 18 items): 3% adds 3 to 4% Power and
 * moves no boss forecast more than 9 points; 10% would add 9 to 13% Power but moves the gate-30
 * forecast by 34 points (see DESIGN.md, "Gear and the bag").
 */
export const BAG_LEND = Number(process.env.ASCEND_BAG_LEND ?? 0.03);

/** What the bag lends the warrior: flat stats, added where equipped gear's are. */
export function lentTotals(profile: Profile): Partial<Record<StatKey, number>> {
  const out: Partial<Record<StatKey, number>> = {};
  const add = (k: StatKey, v: number) => (out[k] = (out[k] ?? 0) + v * BAG_LEND);
  for (const item of bagItems(profile)) for (const [k, v] of Object.entries(itemStatTotals(item)) as [StatKey, number][]) add(k, v);
  for (const item of profile.equipment.inventory) for (const [k, v] of Object.entries(item.kept ?? {}) as [StatKey, number][]) add(k, v);
  return out;
}

/** An item's own lend when it sits in the bag, plus what the forge folded into it. */
export function itemLend(item: EquipmentItem, inBag: boolean): Partial<Record<StatKey, number>> {
  const out: Partial<Record<StatKey, number>> = {};
  const add = (k: StatKey, v: number) => (out[k] = (out[k] ?? 0) + v * BAG_LEND);
  if (inBag) for (const [k, v] of Object.entries(itemStatTotals(item)) as [StatKey, number][]) add(k, v);
  for (const [k, v] of Object.entries(item.kept ?? {}) as [StatKey, number][]) add(k, v);
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

/**
 * Where the warrior's strength comes from: each one can be left out of `computePlayerStats`, which
 * is how the Power sheet measures what each gives (see `powerBreakdown`).
 */
export const POWER_SOURCES = ["statLevels", "level", "gear", "bag", "sets", "skills", "perks", "weaponPath", "codex", "techniques", "rank", "aether", "tree"] as const;
export type PowerSource = (typeof POWER_SOURCES)[number];
const NONE: ReadonlySet<PowerSource> = new Set();

export function computePlayerStats(profile: Profile, without: ReadonlySet<PowerSource> = NONE): CombatStats {
  const s: CombatStats = { ...BASE_PLAYER_STATS };
  const on = (src: PowerSource) => !without.has(src);
  const lv = profile.player.statLevels;
  if (on("statLevels")) {
    s.attack += STAT_UPGRADE_STEP.attack * (lv.attack - 1);
    s.maxHp += STAT_UPGRADE_STEP.maxHp * (lv.maxHp - 1);
    s.attackSpeed += STAT_UPGRADE_STEP.attackSpeed * (lv.attackSpeed - 1);
    s.critChance += STAT_UPGRADE_STEP.critChance * (lv.critChance - 1);
    s.critDamage += STAT_UPGRADE_STEP.critDamage * (lv.critDamage - 1);
    s.defense += STAT_UPGRADE_STEP.defense * (lv.defense - 1);
    s.attack *= milestoneMult(lv.attack);
    s.maxHp *= milestoneMult(lv.maxHp);
  }
  // Aether from past ascensions: permanent, compounding with everything else.
  const aether = on("aether") ? aetherPowerMult(profile) : 1;
  s.attack *= aether * (on("tree") ? Math.pow(1 + TREE_COMPOUND.might, nodeLevel(profile, "might")) : 1);
  s.maxHp *= aether * (on("tree") ? Math.pow(1 + TREE_COMPOUND.vigor, nodeLevel(profile, "vigor")) : 1);

  // Warrior level: steady compounding power.
  const levelMult = on("level") ? 1 + (profile.player.level - 1) * 0.045 : 1;
  s.attack *= levelMult;
  s.maxHp *= levelMult;

  if (on("gear"))
    for (const item of equippedItems(profile)) {
      const totals = itemStatTotals(item);
      for (const [k, v] of Object.entries(totals) as [StatKey, number][]) s[k] += v;
    }
  if (on("bag")) for (const [k, v] of Object.entries(lentTotals(profile)) as [StatKey, number][]) s[k] += v;

  const pct: Partial<Record<StatKey, number>> = {};
  const addPct = (k: StatKey, v: number) => (pct[k] = (pct[k] ?? 0) + v);
  if (on("skills"))
    for (const id of profile.skills.unlocked) {
      const node = SKILLS.find((x) => x.id === id);
      if (node?.effect.kind === "stat") addPct(node.effect.stat, node.effect.pct);
      if (node?.id === "s5") addPct("defense", 0.15);
    }
  if (on("perks"))
    for (const [id, stacks] of Object.entries(profile.player.perks)) {
      const perk = PERKS.find((p) => p.id === id);
      if (perk?.effect.kind === "stat") addPct(perk.effect.stat, perk.effect.pct * stacks);
    }
  if (on("weaponPath")) for (const [k, v] of Object.entries(weaponPathBonuses(profile.player.weaponPath)) as [StatKey, number][]) addPct(k, v);
  if (on("codex")) {
    const codex = codexBonus(profile);
    for (const [k, v] of Object.entries(codex) as [StatKey, number][]) if (v) addPct(k, v);
  }
  if (on("sets")) for (const [id, n] of setCounts(equippedItems(profile).map((i) => i.templateId))) if (n >= 2) addPct(GEAR_SETS[id].two.stat, GEAR_SETS[id].two.pct);
  // Techniques are owned power: every one learned adds attack, equipped or not.
  if (on("techniques") && profile.player.techniques.length) addPct("attack", profile.player.techniques.length * TECHNIQUE_OWNED_ATTACK);
  if (on("rank")) {
    const rankMult = 1 + profile.player.rank * RANK_STAT_STEP;
    addPct("attack", rankMult - 1);
    addPct("maxHp", rankMult - 1);
  }

  for (const [k, v] of Object.entries(pct) as [StatKey, number][]) {
    if (k === "critChance") s.critChance += v;
    else s[k] *= 1 + v;
  }

  s.hpRegen = s.maxHp * 0.006 + (on("statLevels") ? lv.maxHp : 1) * 0.06;
  s.attackSpeed = Math.min(STAT_CEILING.attackSpeed, s.attackSpeed);
  s.critChance = Math.min(STAT_CEILING.critChance, s.critChance);
  s.moveSpeed = Math.min(260, s.moveSpeed);
  return s;
}

/** A single number players can compare at a glance. */
export function combatPower(stats: CombatStats): number {
  const dps = stats.attack * stats.attackSpeed * (1 + stats.critChance * (stats.critDamage - 1));
  const ehp = stats.maxHp / Math.max(0.15, 30 / (30 + stats.defense));
  return Math.round(dps * 4 + ehp * 0.6);
}

const UPGRADEABLE: readonly UpgradeableStat[] = ["attack", "maxHp", "defense", "attackSpeed", "critChance", "critDamage"];

/**
 * Two stats have a ceiling on their value, whatever their level: 3.2 attacks a second (a swing
 * takes time to throw) and an 85% chance to crit. Gear, perks and ranks all count toward it.
 */
export const STAT_CEILING = { attackSpeed: 3.2, critChance: 0.85 } as const;

/**
 * The stat's value is already at its ceiling, so another level would add nothing. Such a level
 * is not for sale: it used to be, at full price, for "+0.00".
 */
export function statAtCeiling(profile: Profile, stat: UpgradeableStat): boolean {
  if (stat !== "attackSpeed" && stat !== "critChance") return false;
  return computePlayerStats(profile)[stat] >= STAT_CEILING[stat] - 1e-9;
}

/** How close a stat is to the end of its levels, and what lies past it, for the Hero panel. */
export type StatRoad =
  | { kind: "open" }
  /** Within NEAR_CAP levels of the cap: "Lv 118 of 120". */
  | { kind: "near"; level: number; cap: number }
  /** At the value ceiling (3.2 attacks a second, 85% crit): levels would add nothing. */
  | { kind: "ceiling" }
  /** At the level cap; Limit Break (Ascension's tree) raises it: `ready` once Ascension is open. */
  | { kind: "limit"; cap: number; ready: boolean }
  /** At the last level there is. */
  | { kind: "top"; cap: number };

export const NEAR_CAP = 10;

export function statRoad(profile: Profile, stat: UpgradeableStat): StatRoad {
  const level = profile.player.statLevels[stat];
  const cap = statCap(profile, stat);
  if (statAtCeiling(profile, stat)) return { kind: "ceiling" };
  if (level >= cap) {
    if (LIMIT_BREAK_STATS.includes(stat) && nodeLevel(profile, "limit") < LIMIT_BREAK_MAX) return { kind: "limit", cap, ready: profile.ascension.count > 0 || profile.progress.bestStage >= ASCEND_MIN_STAGE };
    return { kind: "top", cap };
  }
  if (cap - level <= NEAR_CAP) return { kind: "near", level, cap };
  return { kind: "open" };
}

/** The road in words: what the cell says under the price, and the longer line a tap explains. */
export function statRoadText(road: StatRoad, label: string): { caption: string; explain: string } | null {
  switch (road.kind) {
    case "open":
      return null;
    case "near":
      return { caption: `Lv ${road.level} of ${road.cap}`, explain: `${label} stops at level ${road.cap}.` };
    case "ceiling":
      return { caption: "At its ceiling", explain: `${label} is as high as it goes: put gold into Attack, Health or Defence.` };
    case "limit":
      return road.ready
        ? { caption: "Limit Break ›", explain: `${label} is at level ${road.cap}. Limit Break, in Ascension's Aether tree, raises the cap by ${LIMIT_BREAK_STEP}.` }
        : { caption: `Cap ${road.cap}`, explain: `${label} is at level ${road.cap}. Ascension opens at stage ${ASCEND_MIN_STAGE}; its Limit Break raises the cap.` };
    case "top":
      return { caption: "Top level", explain: `${label} is at its last level, ${road.cap}.` };
  }
}

/**
 * The best buy among the stat upgrades the warrior can afford now: the most Power (the number the
 * Hero panel shows) for each piece of gold. Undefined when nothing is affordable or nothing adds
 * Power (a stat at its own ceiling, such as crit chance at 85%).
 */
export function bestStatBuy(profile: Profile): UpgradeableStat | undefined {
  const now = combatPower(computePlayerStats(profile));
  let best: UpgradeableStat | undefined;
  let bestRate = 0;
  for (const s of UPGRADEABLE) {
    const level = profile.player.statLevels[s];
    if (!isStatUnlocked(profile, s) || level >= statCap(profile, s) || statAtCeiling(profile, s)) continue;
    const cost = statUpgradeCost(s, level);
    if (cost > profile.player.gold) continue;
    const next: Profile = { ...profile, player: { ...profile.player, statLevels: { ...profile.player.statLevels, [s]: level + 1 } } };
    const rate = (combatPower(computePlayerStats(next)) - now) / cost;
    if (rate > bestRate) {
      bestRate = rate;
      best = s;
    }
  }
  return best;
}
