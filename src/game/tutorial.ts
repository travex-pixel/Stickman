import type { Profile } from "./progression/profile";
import type { WorldSnapshot } from "./engine/World";
import { statUpgradeCost } from "./progression/stats";

export type TutorialStepId = "watch" | "ability" | "dodge" | "upgrade" | "gear" | "summon" | "deploy" | "command";

export type GuideGesture = "point" | "tap" | "hold";

export interface TutorialStep {
  id: TutorialStepId;
  /** Ordered list of (target, label, gesture). The director advances sub-steps as the player navigates. */
  targets: { target: string; label: string; gesture: GuideGesture; panel?: "hero" | "summons" | "gear" | "skills" | "rift" }[];
  /** Precondition to begin this step. */
  ready: (ctx: TutorialContext) => boolean;
  /** Optional auto-complete condition (steps without an explicit action). */
  autoComplete?: (ctx: TutorialContext) => boolean;
}

export interface TutorialContext {
  profile: Profile;
  snapshot: WorldSnapshot | null;
  elapsed: number;
  panel: string;
  enemyWindupNearPlayer: boolean;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "watch",
    targets: [{ target: "battlefield-player", label: "Your warrior fights on their own.", gesture: "point" }],
    ready: (c) => (c.snapshot?.enemiesAlive ?? 0) > 0,
    autoComplete: (c) => c.elapsed > 3.2,
  },
  {
    id: "ability",
    targets: [{ target: "ability-arc_slash", label: "Tap Arc Slash", gesture: "tap" }],
    ready: (c) => (c.snapshot?.enemiesAlive ?? 0) > 0 && (c.snapshot?.cooldowns.arc_slash ?? 1) <= 0,
  },
  {
    id: "dodge",
    targets: [{ target: "ability-dodge", label: "Dodge the attack", gesture: "tap" }],
    ready: (c) => c.enemyWindupNearPlayer && (c.snapshot?.dodgeCooldown ?? 1) <= 0,
  },
  {
    id: "upgrade",
    targets: [
      { target: "tab-hero", label: "Open your Hero", gesture: "tap", panel: "hero" },
      { target: "upgrade-attack", label: "Hold to upgrade Attack", gesture: "hold", panel: "hero" },
    ],
    ready: (c) => c.profile.player.gold >= statUpgradeCost("attack", c.profile.player.statLevels.attack),
  },
  {
    id: "summon",
    targets: [{ target: "claim-essence", label: "Tap BIND to swear it to your army", gesture: "tap" }],
    ready: (c) => (c.snapshot?.orbs.length ?? 0) > 0,
  },
  {
    id: "deploy",
    targets: [
      { target: "tab-summons", label: "Open your Summons", gesture: "tap", panel: "summons" },
      { target: "deploy-summon", label: "Deploy your companion", gesture: "tap", panel: "summons" },
    ],
    ready: (c) => c.profile.summons.collection.length > 0 && !c.profile.summons.collection.some((s) => s.deployed),
  },
  {
    id: "command",
    targets: [{ target: "command-aggressive", label: "Order them to attack", gesture: "tap" }],
    ready: (c) => c.profile.summons.collection.some((s) => s.deployed) && (c.snapshot?.enemiesAlive ?? 0) > 0,
  },
  {
    id: "gear",
    targets: [
      { target: "tab-gear", label: "Open your Gear", gesture: "tap", panel: "gear" },
      { target: "equip-item", label: "Equip it", gesture: "tap", panel: "gear" },
    ],
    ready: (c) => c.profile.equipment.inventory.length > 0 && Object.keys(c.profile.equipment.equipped).length === 0,
  },
];

export function nextTutorialStep(profile: Profile): TutorialStep | null {
  if (profile.tutorial.finished) return null;
  for (const s of TUTORIAL_STEPS) if (!profile.tutorial.completed.includes(s.id)) return s;
  return null;
}
