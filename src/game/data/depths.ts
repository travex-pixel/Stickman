/**
 * The Rift Depths. The campaign does not end at the Crown: from stage 31 the three regions come
 * round again, deeper in the Rift, every 30 stages. Each depth carries one twist that changes how
 * fights play (never a hidden number: it is named, shown, and visible on the battlefield), pays
 * better than the last, and paints the regions in its own light.
 */
export const DEPTH_START = 31;
export const DEPTH_SPAN = 30;

export type TwistId = "frenzy" | "bloodbound" | "volatile" | "swarm" | "elite_tide";

export interface TwistDef {
  id: TwistId;
  name: string;
  /** What changes, in one line the player reads before the fight. */
  blurb: string;
  /** How to play it. */
  counter: string;
  /** The depth's light: backdrops are washed toward it. */
  tint: number;
}

export const TWISTS: Record<TwistId, TwistDef> = {
  frenzy: { id: "frenzy", name: "Frenzied", blurb: "Foes move 15% and strike 20% faster.", counter: "Defence and a frontline pay off here.", tint: 0xff5a3c },
  bloodbound: { id: "bloodbound", name: "Bloodbound", blurb: "Foes heal for 15% of the damage they deal.", counter: "Burst them down: abilities and crits beat the healing.", tint: 0xc0284f },
  volatile: { id: "volatile", name: "Volatile", blurb: "Slain foes burst a moment later.", counter: "Step out of the ring; a dodge through it is Perfect.", tint: 0xff9a2a },
  swarm: { id: "swarm", name: "Swarming", blurb: "Half again as many foes, each a little frailer.", counter: "Area abilities and a wide army shine.", tint: 0x86d070 },
  elite_tide: { id: "elite_tide", name: "Elite Tide", blurb: "Elites come three times as often, from the first wave.", counter: "More elites, more shadows to BIND and more loot.", tint: 0xb070e0 },
};

export const TWIST_ORDER: TwistId[] = ["frenzy", "bloodbound", "volatile", "swarm", "elite_tide"];

/** Depth 1 is the first pass (stages 1 to 30); depth 2 begins at stage 31. */
export function depthForStage(stage: number): number {
  return stage < DEPTH_START ? 1 : 2 + Math.floor((stage - DEPTH_START) / DEPTH_SPAN);
}

/** Where a stage sits in the region cycle: 1 to 30. Depth 1 is the cycle itself. */
export function localStage(stage: number): number {
  return stage < DEPTH_START ? Math.max(1, stage) : ((stage - DEPTH_START) % DEPTH_SPAN) + 1;
}

export function depthStart(depth: number): number {
  return depth <= 1 ? 1 : DEPTH_START + (depth - 2) * DEPTH_SPAN;
}

export function twistForDepth(depth: number): TwistId | null {
  return depth <= 1 ? null : (TWIST_ORDER[(depth - 2) % TWIST_ORDER.length] as TwistId);
}

export function twistForStage(stage: number): TwistId | null {
  return twistForDepth(depthForStage(stage));
}

/** Each depth past the first pays 20% more gold and XP. */
export const DEPTH_REWARD_STEP = 0.2;
export function depthRewardMult(stage: number): number {
  return 1 + DEPTH_REWARD_STEP * (depthForStage(stage) - 1);
}

export function romanDepth(n: number): string {
  const r = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
  return r[n] ?? String(n);
}

/** "Depth II · Frenzied", or null on the first pass. */
export function depthLabel(stage: number): string | null {
  const d = depthForStage(stage);
  const t = twistForDepth(d);
  return t ? `Depth ${romanDepth(d)} · ${TWISTS[t].name}` : null;
}
