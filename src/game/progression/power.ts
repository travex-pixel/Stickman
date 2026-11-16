import type { EquipSlot, UpgradeableStat } from "../data/ids";
import { EQUIP_SLOTS } from "../data/ids";
import { SKILLS } from "../data/skills";
import { GEAR_SETS, setCounts, setOf } from "../data/gearSets";
import type { EquipmentItem, Profile } from "./profile";
import { POWER_SOURCES, type PowerSource, bagItems, bestStatBuy, combatPower, computePlayerStats, equippedItems, isStatUnlocked, statAtCeiling, statCap, statUpgradeCost } from "./stats";
import { canUnlockSkill } from "./skills";
import { canAttemptTrial, nextRankStep, rankLetter } from "./ranks";
import { TREE, aetherFor, canAscend, nextNodeCost, spendableAether } from "./ascension";

/** The number the Hero panel shows. */
export function powerOf(profile: Profile, without?: ReadonlySet<PowerSource>): number {
  return combatPower(computePlayerStats(profile, without));
}

export interface PowerRow {
  source: PowerSource;
  /** This source's part of Power: its removal cost, scaled with the others to add up (see below). */
  power: number;
  /** `power` as a share of total Power, 0 to 1. */
  share: number;
}

export interface PowerBreakdown {
  total: number;
  /** The warrior with every source taken away: level 1, no levels, no gear. */
  base: number;
  rows: PowerRow[];
}

/**
 * Where Power comes from. Each source is measured by taking it away and recomputing: what Power
 * would drop by. Sources multiply each other (a rank raises what stat levels give), so those drops
 * add up to more than the Power they explain; they are scaled down together, in proportion, so the
 * rows and the base add up to Power exactly. A row is never negative, and a source that gives
 * nothing has a row of 0.
 */
export function powerBreakdown(profile: Profile): PowerBreakdown {
  const total = powerOf(profile);
  const base = powerOf(profile, new Set(POWER_SOURCES));
  const drops = POWER_SOURCES.map((source) => ({ source, drop: Math.max(0, total - powerOf(profile, new Set([source]))) }));
  const sum = drops.reduce((a, d) => a + d.drop, 0);
  const scale = sum > 0 ? Math.max(0, total - base) / sum : 0;
  const rows = drops.map(({ source, drop }) => ({ source, power: drop * scale, share: total > 0 ? (drop * scale) / total : 0 }));
  return { total, base, rows };
}

/** Power if `item` were worn in its slot, in place of what is there now; minus Power now. */
export function equipGain(profile: Profile, item: EquipmentItem): number {
  if (profile.equipment.equipped[item.slot] === item.uid) return 0;
  return powerOf(withEquipped(profile, { [item.slot]: item.uid })) - powerOf(profile);
}

/** Power the worn item in `slot` gives over an empty slot (its stats, its set; the bag then lends from it). */
export function wornGain(profile: Profile, slot: EquipSlot): number {
  if (!profile.equipment.equipped[slot]) return 0;
  return powerOf(profile) - powerOf(withEquipped(profile, { [slot]: undefined }));
}

function withEquipped(profile: Profile, change: Partial<Record<EquipSlot, string | undefined>>): Profile {
  const equipped = { ...profile.equipment.equipped, ...change };
  for (const k of Object.keys(equipped) as EquipSlot[]) if (equipped[k] === undefined) delete equipped[k];
  return { ...profile, equipment: { ...profile.equipment, equipped } };
}

export interface EquipBestPlan {
  equipped: Partial<Record<EquipSlot, string>>;
  /** Power gained by the whole plan. */
  gain: number;
  changes: { slot: EquipSlot; from?: string; to: string }[];
  /** Slots left alone although a stronger item exists, to keep a special effect or a four-piece set. */
  kept: EquipSlot[];
}

/** True when taking the item in `slot` off would lose a special effect or a four-piece set effect. */
function carriesEffect(profile: Profile, slot: EquipSlot, candidate: EquipmentItem): boolean {
  const uid = profile.equipment.equipped[slot];
  const worn = uid ? profile.equipment.inventory.find((i) => i.uid === uid) : undefined;
  if (!worn) return false;
  if (worn.effect && worn.effect !== candidate.effect) return true;
  const set = setOf(worn.templateId);
  if (!set) return false;
  const n = setCounts(equippedItems(profile).map((i) => i.templateId)).get(set.id) ?? 0;
  return n >= 4 && n - 1 < 4 && setOf(candidate.templateId)?.id !== set.id;
}

/**
 * "Equip best": only swaps that raise Power, one slot at a time, best first, until none is left.
 * A worn item whose special effect (or four-piece set) would be lost stays on, and the plan says so.
 */
export function equipBestPlan(profile: Profile): EquipBestPlan {
  let cur: Profile = profile;
  let now = powerOf(cur);
  const start = now;
  const changes: EquipBestPlan["changes"] = [];
  const kept = new Set<EquipSlot>();
  for (let pass = 0; pass < EQUIP_SLOTS.length * 2; pass++) {
    let best: { slot: EquipSlot; item: EquipmentItem; power: number } | null = null;
    for (const slot of EQUIP_SLOTS) {
      for (const item of cur.equipment.inventory) {
        if (item.slot !== slot || cur.equipment.equipped[slot] === item.uid) continue;
        const power = powerOf(withEquipped(cur, { [slot]: item.uid }));
        if (power <= now + 0.5) continue;
        if (carriesEffect(cur, slot, item)) {
          kept.add(slot);
          continue;
        }
        if (!best || power > best.power) best = { slot, item, power };
      }
    }
    if (!best) break;
    const from = cur.equipment.equipped[best.slot];
    const prior = changes.findIndex((c) => c.slot === best!.slot);
    if (prior >= 0) changes.splice(prior, 1, { slot: best.slot, from: changes[prior]!.from, to: best.item.uid });
    else changes.push({ slot: best.slot, ...(from ? { from } : {}), to: best.item.uid });
    cur = withEquipped(cur, { [best.slot]: best.item.uid });
    now = best.power;
  }
  for (const c of changes) kept.delete(c.slot);
  return { equipped: { ...cur.equipment.equipped }, gain: now - start, changes, kept: [...kept] };
}

export type NextStepKind = "perk" | "skill" | "gear" | "aether" | "trial" | "stat" | "boss" | "farm" | "ascend";

export interface NextStep {
  kind: NextStepKind;
  /** One line, plain words. */
  text: string;
  /** Power it adds, when it can be measured. */
  gain?: number;
  stat?: UpgradeableStat;
}

const LABEL: Record<UpgradeableStat, string> = { attack: "Attack", maxHp: "Health", defense: "Defence", attackSpeed: "Attack speed", critChance: "Crit rate", critDamage: "Crit damage" };

/** One more level of `stat`: Power it adds and its price. */
export function statStep(profile: Profile, stat: UpgradeableStat): { gain: number; cost: number } {
  const level = profile.player.statLevels[stat];
  const next: Profile = { ...profile, player: { ...profile.player, statLevels: { ...profile.player.statLevels, [stat]: level + 1 } } };
  return { gain: powerOf(next) - powerOf(profile), cost: statUpgradeCost(stat, level) };
}

/**
 * The best next step, in one line. Free steps first (a perk waiting, a skill point, stronger gear
 * in the bag, Aether to spend), then a Rank Trial, then the most Power per gold among the stat
 * levels you can afford; failing those, the boss that waits, the stat to save for, or Ascension.
 */
export function nextStep(profile: Profile, fmt: (n: number) => string = (n) => String(Math.round(n))): NextStep {
  const p = profile.player;
  if (p.pendingPerkChoices > 0) return { kind: "perk", text: p.pendingPerkChoices > 1 ? `Choose your perks: ${p.pendingPerkChoices} are waiting` : "Choose your perk: one is waiting" };
  const skill = SKILLS.filter((s) => canUnlockSkill(profile, s.id).ok).sort((a, b) => a.tier - b.tier)[0];
  if (skill) return { kind: "skill", text: `Spend a skill point: ${skill.name}, ${skill.description.replace(/\.$/, "")}` };
  const plan = equipBestPlan(profile);
  if (plan.gain >= 1) return { kind: "gear", text: `Equip your best gear: +${fmt(plan.gain)} Power`, gain: plan.gain };
  const node = TREE.find((n) => (n.id === "might" || n.id === "vigor") && (nextNodeCost(profile, n.id) ?? Infinity) <= spendableAether(profile));
  if (node) return { kind: "aether", text: `Spend Aether on ${node.name}: ${node.per}` };
  if (canAttemptTrial(profile)) {
    const step = nextRankStep(profile)!;
    return { kind: "trial", text: `Take the Rank Trial for Rank ${rankLetter(step.to)}: ${step.rewards[0]}` };
  }
  const buy = bestStatBuy(profile);
  if (buy) {
    const s = statStep(profile, buy);
    return { kind: "stat", stat: buy, gain: s.gain, text: `Raise ${LABEL[buy]} to Lv ${p.statLevels[buy] + 1}: +${fmt(s.gain)} Power for ${fmt(s.cost)} gold` };
  }
  if (profile.progress.bossGate) return { kind: "boss", text: "Challenge the boss that waits, or farm gold for more levels" };
  // Nothing affordable: the best Power per gold among all stat levels, to save for.
  let save: { stat: UpgradeableStat; rate: number; cost: number } | null = null;
  for (const stat of Object.keys(LABEL) as UpgradeableStat[]) {
    if (!isStatUnlocked(profile, stat) || p.statLevels[stat] >= statCap(profile, stat) || statAtCeiling(profile, stat)) continue;
    const s = statStep(profile, stat);
    if (s.gain > 0 && (!save || s.gain / s.cost > save.rate)) save = { stat, rate: s.gain / s.cost, cost: s.cost };
  }
  if (canAscend(profile) && aetherFor(profile.progress.bestStage) >= 5 && (!save || save.cost > p.gold * 20))
    return { kind: "ascend", text: `Ascend for ${fmt(aetherFor(profile.progress.bestStage))} Aether: +${Math.round(aetherFor(profile.progress.bestStage) * 2)}% Attack and Health for good` };
  if (save) return { kind: "farm", stat: save.stat, text: `Farm gold for ${LABEL[save.stat]}: the next level costs ${fmt(save.cost)}` };
  return { kind: "farm", text: "Keep fighting: gold, gear and levels come from every stage" };
}

/** The items in the bag, strongest first by what each would add if worn. */
export function bagByGain(profile: Profile): { item: EquipmentItem; gain: number }[] {
  return bagItems(profile)
    .map((item) => ({ item, gain: equipGain(profile, item) }))
    .sort((a, b) => b.gain - a.gain);
}

/** Two-piece set bonuses in force, for the Power sheet and the Gear panel. */
export function activeSets(profile: Profile): { name: string; worn: number; of: number; two: string; four: boolean }[] {
  const out: { name: string; worn: number; of: number; two: string; four: boolean }[] = [];
  for (const [id, n] of setCounts(equippedItems(profile).map((i) => i.templateId))) {
    const s = GEAR_SETS[id];
    out.push({ name: s.name, worn: n, of: s.pieces.length, two: `+${Math.round(s.two.pct * 100)}% ${LABEL[s.two.stat as UpgradeableStat] ?? s.two.stat}`, four: n >= 4 });
  }
  return out.sort((a, b) => b.worn - a.worn);
}
