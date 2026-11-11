export type SkillBranch = "power" | "soul" | "command";

export type SkillEffect =
  | { kind: "stat"; stat: "attack" | "maxHp" | "attackSpeed" | "critChance" | "critDamage" | "defense"; pct: number }
  | { kind: "summonStat"; stat: "attack" | "maxHp" | "defense"; pct: number }
  | { kind: "deploySlot"; amount: number }
  | { kind: "synergy"; id: "arc_pull" | "thunder_mark" | "nova_opening" | "soul_mend" }
  | { kind: "cooldown"; pct: number }
  | { kind: "dodgeCooldown"; pct: number }
  | { kind: "ultimateGain"; pct: number }
  | { kind: "essenceChance"; pct: number }
  | { kind: "summonXp"; pct: number }
  | { kind: "unlockWeaponPath" };

export interface SkillNode {
  id: string;
  branch: SkillBranch;
  tier: number;
  name: string;
  description: string;
  cost: number;
  requires?: string;
  effect: SkillEffect;
}

export const SKILL_BRANCH_INFO: Record<SkillBranch, { label: string; blurb: string; color: string }> = {
  power: { label: "Power", blurb: "Your blade, your fury.", color: "#ffd36b" },
  soul: { label: "Soul", blurb: "The essence you take.", color: "#7df0c8" },
  command: { label: "Command", blurb: "The army you build.", color: "#4ee6ff" },
};

export const SKILLS: SkillNode[] = [
  // POWER
  { id: "p1", branch: "power", tier: 1, name: "Honed Edge", description: "+8% attack.", cost: 1, effect: { kind: "stat", stat: "attack", pct: 0.08 } },
  { id: "p2", branch: "power", tier: 2, name: "Quickened", description: "+10% attack speed.", cost: 1, requires: "p1", effect: { kind: "stat", stat: "attackSpeed", pct: 0.1 } },
  { id: "p3", branch: "power", tier: 3, name: "Weapon Awakening", description: "Unlocks weapon paths: Stormblade, Infernal or Voidfang.", cost: 2, requires: "p2", effect: { kind: "unlockWeaponPath" } },
  { id: "p4", branch: "power", tier: 4, name: "Killing Intent", description: "+25% critical damage.", cost: 2, requires: "p3", effect: { kind: "stat", stat: "critDamage", pct: 0.25 } },
  { id: "p5", branch: "power", tier: 5, name: "Relentless", description: "Ability cooldowns reduced by 12%.", cost: 3, requires: "p4", effect: { kind: "cooldown", pct: 0.12 } },
  // SOUL
  { id: "s1", branch: "soul", tier: 1, name: "Veil Step", description: "Dodge cooldown reduced by 20%.", cost: 1, effect: { kind: "dodgeCooldown", pct: 0.2 } },
  { id: "s2", branch: "soul", tier: 2, name: "Hungering Rift", description: "Oaths linger 35% more often and BIND succeeds 8% more.", cost: 1, requires: "s1", effect: { kind: "essenceChance", pct: 0.35 } },
  { id: "s3", branch: "soul", tier: 3, name: "Shared Mending", description: "Soul Burst also heals your army for 25% of its health.", cost: 2, requires: "s2", effect: { kind: "synergy", id: "soul_mend" } },
  { id: "s4", branch: "soul", tier: 4, name: "Ascendant Flow", description: "Ultimate energy gains +40%.", cost: 2, requires: "s3", effect: { kind: "ultimateGain", pct: 0.4 } },
  { id: "s5", branch: "soul", tier: 5, name: "Iron Soul", description: "+20% max health and +15% defence.", cost: 3, requires: "s4", effect: { kind: "stat", stat: "maxHp", pct: 0.2 } },
  // COMMAND
  { id: "c1", branch: "command", tier: 1, name: "Bound Blades", description: "Your army deals +15% damage.", cost: 1, effect: { kind: "summonStat", stat: "attack", pct: 0.15 } },
  { id: "c2", branch: "command", tier: 2, name: "Gravity of Steel", description: "Arc Slash drags enemies toward your Vanguard.", cost: 1, requires: "c1", effect: { kind: "synergy", id: "arc_pull" } },
  { id: "c3", branch: "command", tier: 3, name: "Third Oath", description: "Deploy one additional summon.", cost: 3, requires: "c2", effect: { kind: "deploySlot", amount: 1 } },
  { id: "c4", branch: "command", tier: 4, name: "Hunter's Chain", description: "Thunder Strike chains to every enemy marked by a Ranger.", cost: 2, requires: "c3", effect: { kind: "synergy", id: "thunder_mark" } },
  { id: "c5", branch: "command", tier: 5, name: "Opening", description: "Enemies hit by Void Nova take 50% more damage from Reapers for 4 seconds.", cost: 3, requires: "c4", effect: { kind: "synergy", id: "nova_opening" } },
];

export function skillNode(id: string): SkillNode {
  const n = SKILLS.find((s) => s.id === id);
  if (!n) throw new Error(`Unknown skill ${id}`);
  return n;
}
