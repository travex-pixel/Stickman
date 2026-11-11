import { MODES, type ModeId } from "../data/modes";
import { REGIONS } from "../data/regions";
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
  const nextRegion = REGIONS.find((r) => r.firstStage > frontierStage(p));
  const regionStart = nextRegion ? nextRegion.firstStage : 0;
  if (firstMode && (!regionStart || MODES[firstMode].unlockAfterStage < regionStart)) return `Clear stage ${MODES[firstMode].unlockAfterStage} to open ${MODES[firstMode].name}`;
  if (nextRegion && regionStart - best <= 6) return `Reach stage ${regionStart}: ${nextRegion.name}`;
  const step = nextRankStep(p);
  if (step) return p.player.level >= step.level ? `Take the Rank Trial to reach rank ${rankLetter(step.to)}` : `Reach level ${step.level} for the rank ${rankLetter(step.to)} trial`;
  const tech = TECHNIQUES.find((t) => !p.player.techniques.includes(t));
  if (tech) return `Learn ${ABILITIES[tech].name}: ${ABILITIES[tech].learn ?? ""}`.trim();
  return `Push past stage ${best}`;
}
