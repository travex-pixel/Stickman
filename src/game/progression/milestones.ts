import { MODES, type ModeId } from "../data/modes";
import { REGIONS } from "../data/regions";
import { TWISTS, depthForStage, localStage, romanDepth, twistForDepth } from "../data/depths";
import { ENEMIES } from "../data/enemies";
import { bossForStage } from "../data/regions";
import { ABILITIES, TECHNIQUES } from "../data/abilities";
import type { Profile } from "./profile";
import { nextRankStep, rankLetter } from "./ranks";
import { frontierStage } from "./campaign";

/**
 * The single most meaningful next goal, in plain words, for the return card and the journey
 * panel. Ordered by how soon it changes the game: a waiting boss, then what the next stages
 * open, then a rank breakthrough, then the next technique.
 */
export function nextMilestone(p: Profile): string {
  const gate = p.progress.bossGate;
  if (gate) return `Defeat ${ENEMIES[bossForStage(gate)]?.name ?? "the boss"} at stage ${gate}`;
  const best = p.progress.bestStage;
  const modes = (Object.keys(MODES) as ModeId[])
    .filter((m) => m !== "campaign" && m !== "boss" && m !== "trial" && MODES[m].unlockAfterStage > best)
    .sort((a, b) => MODES[a].unlockAfterStage - MODES[b].unlockAfterStage);
  const firstMode = modes[0];
  const next = nextRegionStart(frontierStage(p));
  const regionStart = next.stage;
  if (firstMode && MODES[firstMode].unlockAfterStage < regionStart) return `Clear stage ${MODES[firstMode].unlockAfterStage} to open ${MODES[firstMode].name}`;
  if (regionStart - best <= 6) return `Reach stage ${regionStart}: ${next.name}`;
  const step = nextRankStep(p);
  if (step) return p.player.level >= step.level ? `Take the Rank Trial to reach rank ${rankLetter(step.to)}` : `Reach level ${step.level} for the rank ${rankLetter(step.to)} trial`;
  const tech = TECHNIQUES.find((t) => !p.player.techniques.includes(t));
  if (tech) return `Learn ${ABILITIES[tech].name}: ${ABILITIES[tech].learn ?? ""}`.trim();
  return `Push past stage ${best}`;
}

/** The next stage after `stage` where a region (or a new Rift Depth) begins, and its name. */
export function nextRegionStart(stage: number): { stage: number; name: string } {
  for (let s = stage + 1; s < stage + 40; s++) {
    const local = localStage(s);
    const depth = depthForStage(s);
    const twist = twistForDepth(depth);
    if (twist && local === 1) return { stage: s, name: `Rift Depth ${romanDepth(depth)} (${TWISTS[twist].name})` };
    const region = REGIONS.find((r) => r.firstStage === local && local > 1);
    if (region) return { stage: s, name: depth > 1 ? `${region.name}, Depth ${romanDepth(depth)}` : region.name };
  }
  return { stage: Infinity, name: "" };
}
