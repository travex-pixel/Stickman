import type { Profile } from "./profile";

/**
 * Ascension: the long game. Once the climb slows, the warrior can ascend: the campaign, gold and
 * stat levels start over, and in exchange the Rift grants Aether, permanent power that compounds
 * every later climb. Everything collected stays: shadows, gear, techniques, skills, perks, ranks,
 * level, the Codex, objectives and the journal.
 *
 * Aether grows faster than the stage reached, so pushing deeper before ascending pays more, and
 * an ascension is always worth more than the last one at the same depth would have been.
 */
export const ASCEND_MIN_STAGE = 20;
/** Each point of Aether: +2% Attack and Health, +1% gold. */
export const AETHER_POWER = 0.02;
export const AETHER_GOLD = 0.01;

/**
 * Past stage 60 every stage deeper is worth 10% more Aether. Aether's power is linear and the
 * enemies' growth is exponential, so without this each ascension would reach a little less far
 * than the last and the climb would stall after a day or two. With it, a deeper push keeps paying
 * enough to move the frontier for weeks (checked with the economy simulator).
 */
export const AETHER_DEEP_STAGE = 60;
export const AETHER_DEEP_GROWTH = 1.1;

/** Aether an ascension from `bestStage` grants. */
export function aetherFor(bestStage: number): number {
  if (bestStage < ASCEND_MIN_STAGE) return 0;
  return Math.floor((Math.pow(bestStage - 15, 1.6) / 2) * Math.pow(AETHER_DEEP_GROWTH, Math.max(0, bestStage - AETHER_DEEP_STAGE)));
}

export function canAscend(p: Profile): boolean {
  return p.progress.bestStage >= ASCEND_MIN_STAGE;
}

export function aetherPowerMult(p: Profile): number {
  return 1 + AETHER_POWER * Math.max(0, p.ascension.aether);
}

export function aetherGoldMult(p: Profile): number {
  return 1 + AETHER_GOLD * Math.max(0, p.ascension.aether);
}

export interface AscendResult {
  gained: number;
  total: number;
  count: number;
  fromStage: number;
}

/** Performs an ascension. Returns null if it is not available. */
export function ascend(p: Profile): AscendResult | null {
  if (!canAscend(p)) return null;
  const fromStage = p.progress.bestStage;
  const gained = aetherFor(fromStage);
  const a = p.ascension;
  a.aether += gained;
  a.count += 1;
  a.bestEver = Math.max(a.bestEver, fromStage);
  // The climb starts over.
  p.progress.bestStage = 0;
  p.progress.currentStage = 1;
  p.progress.bossGate = 0;
  p.progress.autoPush = true;
  // Treasury keeps a share of the gold for the next climb.
  p.player.gold = Math.floor(p.player.gold * 0.1 * nodeLevel(p, "treasury"));
  for (const k of Object.keys(p.player.statLevels) as (keyof Profile["player"]["statLevels"])[]) p.player.statLevels[k] = 1;
  return { gained, total: a.aether, count: a.count, fromStage };
}

/**
 * The Ascension tree. Lifetime Aether keeps its flat bonus; Aether can also be spent here on
 * choices that shape every later climb. Spending never lowers the flat bonus.
 */
export type TreeNodeId = "might" | "vigor" | "fortune" | "insight" | "patience" | "oathbinder" | "command" | "treasury" | "limit";

export interface TreeNode {
  id: TreeNodeId;
  name: string;
  /** Effect per level, in words. */
  per: string;
  max: number;
  cost: (level: number) => number;
}

/**
 * Might, Vigor, Fortune and Insight compound and their costs grow 30% a level, so however much
 * Aether a deep climb brings home there is always a next level worth buying.
 */
export const TREE_COMPOUND = { might: 0.05, vigor: 0.05, fortune: 0.08, insight: 0.08 } as const;
export const LIMIT_BREAK_STEP = 40;

const growing = (base: number) => (l: number) => Math.ceil(base * Math.pow(1.3, l));
/** Levels of Might and Vigor (economy knob, tuned with the simulator). */
export const TREE_DEEP_MAX = Number(process.env.ASCEND_TREE_MAX ?? 100);
/** Levels of Limit Break (economy knob, tuned with the simulator). */
export const LIMIT_BREAK_MAX = Number(process.env.ASCEND_LIMIT_MAX ?? 25);

export const TREE: TreeNode[] = [
  { id: "might", name: "Might", per: "+5% Attack, compounding", max: TREE_DEEP_MAX, cost: growing(2) },
  { id: "vigor", name: "Vigor", per: "+5% Health, compounding", max: TREE_DEEP_MAX, cost: growing(2) },
  { id: "fortune", name: "Fortune", per: "+8% gold, compounding", max: 60, cost: growing(3) },
  { id: "insight", name: "Insight", per: "+8% XP, compounding", max: 60, cost: growing(3) },
  { id: "limit", name: "Limit Break", per: `+${LIMIT_BREAK_STEP} to the Attack, Health and Defence level caps`, max: LIMIT_BREAK_MAX, cost: (l) => 500 * Math.pow(4, l) },
  { id: "treasury", name: "Treasury", per: "Keep 10% of your gold when you ascend", max: 3, cost: (l) => 12 * (l + 1) },
  { id: "oathbinder", name: "Oathbinder", per: "+3% BIND chance", max: 5, cost: (l) => 8 * (l + 1) },
  { id: "patience", name: "Patience", per: "+1 hour of offline time", max: 4, cost: (l) => 15 * (l + 1) },
  { id: "command", name: "Command", per: "+1 shadow in your army", max: 1, cost: () => 60 },
];

export function nodeLevel(p: Profile, id: TreeNodeId): number {
  return Math.max(0, Math.floor(p.ascension.nodes[id] ?? 0));
}

export function spendableAether(p: Profile): number {
  return Math.max(0, p.ascension.aether - p.ascension.spent);
}

export function nodeDef(id: TreeNodeId): TreeNode {
  return TREE.find((n) => n.id === id) as TreeNode;
}

export function nextNodeCost(p: Profile, id: TreeNodeId): number | null {
  const def = nodeDef(id);
  const lvl = nodeLevel(p, id);
  return lvl >= def.max ? null : def.cost(lvl);
}

/** Spends Aether on a tree node. Returns false when maxed or unaffordable. */
export function buyNode(p: Profile, id: TreeNodeId): boolean {
  const cost = nextNodeCost(p, id);
  if (cost === null || spendableAether(p) < cost) return false;
  p.ascension.spent += cost;
  p.ascension.nodes[id] = nodeLevel(p, id) + 1;
  return true;
}

export function romanAscension(n: number): string {
  const r = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  return n <= 10 ? (r[n] ?? String(n)) : String(n);
}
