import type { EliteAffix } from "./ids";

export interface EliteDef {
  id: EliteAffix;
  name: string;
  /** Eye and ring colour on the battlefield. */
  color: number;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  /** Fraction of damage dealt returned as healing. */
  lifesteal: number;
  knockbackImmune: boolean;
  blurb: string;
}

export const ELITES: Record<EliteAffix, EliteDef> = {
  brutal: { id: "brutal", name: "Brutal", color: 0xd95a66, hp: 1.4, attack: 1.7, defense: 1, speed: 1, lifesteal: 0, knockbackImmune: false, blurb: "Hits much harder. Dodge its swings." },
  armored: { id: "armored", name: "Armored", color: 0xa8c4e6, hp: 1.6, attack: 1.1, defense: 3, speed: 0.9, lifesteal: 0, knockbackImmune: true, blurb: "Shrugs off light hits and knockback. Crits and abilities cut through." },
  hasted: { id: "hasted", name: "Hasted", color: 0xe9c97a, hp: 1.3, attack: 1.1, defense: 1, speed: 1.6, lifesteal: 0, knockbackImmune: false, blurb: "Fast and relentless. Let your Vanguard catch it." },
  vampiric: { id: "vampiric", name: "Vampiric", color: 0xc06ad0, hp: 1.5, attack: 1.2, defense: 1, speed: 1, lifesteal: 0.4, knockbackImmune: false, blurb: "Heals from every hit. Burst it down." },
};

export const ELITE_IDS = Object.keys(ELITES) as EliteAffix[];

/** Elites appear from stage 2 in waves 2 and 3, a little more often as stages climb. */
export function eliteChance(stage: number, wave: number): number {
  if (stage < 2 || wave < 2) return 0;
  return Math.min(0.2, 0.05 + stage * 0.01);
}

export const ELITE_REWARD_MULT = 3;
