import type { Profile, ObjectiveState } from "./profile";
import { stageClearGold } from "../economy/rewards";

/**
 * Daily and weekly objectives. Optional by design: three small goals a day that ordinary
 * play (even passive farming) tends to complete, three larger ones a week. Nothing expires
 * into a penalty, nothing carries a streak, and missing a day costs nothing.
 */
export type ObjectiveCounter = "kills" | "elites" | "cycles" | "upgrades" | "binds" | "casts" | "gear" | "shadowUps" | "modeRuns" | "bossWins";

export interface ObjectiveDef {
  id: string;
  counter: ObjectiveCounter;
  text: string;
  target: number;
  scope: "daily" | "weekly";
  reward: { goldStages?: number; essence?: number; cores?: number };
  /** Only offered once the player can actually do it. */
  available?: (p: Profile) => boolean;
}

export const OBJECTIVES: ObjectiveDef[] = [
  { id: "d_kills", scope: "daily", counter: "kills", text: "Defeat 250 enemies", target: 250, reward: { goldStages: 3 } },
  { id: "d_cycles", scope: "daily", counter: "cycles", text: "Clear 8 farming cycles", target: 8, reward: { goldStages: 3 } },
  { id: "d_elites", scope: "daily", counter: "elites", text: "Defeat 4 elites", target: 4, reward: { essence: 60 } },
  { id: "d_upgrades", scope: "daily", counter: "upgrades", text: "Make 10 upgrades", target: 10, reward: { goldStages: 2 } },
  { id: "d_casts", scope: "daily", counter: "casts", text: "Cast 40 abilities", target: 40, reward: { essence: 40 } },
  { id: "d_binds", scope: "daily", counter: "binds", text: "Attempt 2 BINDs", target: 2, reward: { essence: 60 }, available: (p) => p.summons.firstSummonSeen },
  { id: "d_gear", scope: "daily", counter: "gear", text: "Find 3 pieces of gear", target: 3, reward: { goldStages: 2 } },
  { id: "d_mode", scope: "daily", counter: "modeRuns", text: "Run a Vault, Rift or Crypt", target: 1, reward: { essence: 80 }, available: (p) => p.progress.bestStage >= 2 },
  { id: "w_kills", scope: "weekly", counter: "kills", text: "Defeat 2,500 enemies", target: 2500, reward: { goldStages: 12, cores: 1 } },
  { id: "w_shadow", scope: "weekly", counter: "shadowUps", text: "Strengthen shadows 15 times", target: 15, reward: { essence: 300 }, available: (p) => p.summons.collection.length > 0 },
  { id: "w_boss", scope: "weekly", counter: "bossWins", text: "Beat 3 bosses, trials or Crypt Keepers", target: 3, reward: { cores: 2 } },
  { id: "w_cycles", scope: "weekly", counter: "cycles", text: "Clear 60 farming cycles", target: 60, reward: { goldStages: 10 } },
  { id: "w_modes", scope: "weekly", counter: "modeRuns", text: "Complete 6 mode runs", target: 6, reward: { essence: 250, cores: 1 }, available: (p) => p.progress.bestStage >= 2 },
];

export const DAILY_COUNT = 3;
export const WEEKLY_COUNT = 3;
/** Finishing all three dailies adds this. */
export const DAILY_BONUS = { cores: 1 };

export function objectiveDef(id: string): ObjectiveDef | undefined {
  return OBJECTIVES.find((o) => o.id === id);
}

export function dayKey(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Monday-based week key. */
export function weekKey(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return `W${dayKey(d)}`;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A deterministic pick of `n` objectives for a period, from those the player can do. */
function pick(p: Profile, scope: "daily" | "weekly", key: string, n: number): ObjectiveState[] {
  const pool = OBJECTIVES.filter((o) => o.scope === scope && (!o.available || o.available(p)));
  const scored = pool.map((o) => ({ o, h: hash(`${key}:${o.id}`) })).sort((a, b) => a.h - b.h);
  return scored.slice(0, n).map(({ o }) => ({ id: o.id, progress: 0, claimed: false }));
}

/** Rolls new objectives when the day or week turns. Returns true when anything changed. */
export function refreshObjectives(p: Profile, now = new Date()): boolean {
  const o = p.objectives;
  let changed = false;
  const d = dayKey(now);
  const w = weekKey(now);
  if (o.day !== d) {
    o.day = d;
    o.daily = pick(p, "daily", d, DAILY_COUNT);
    changed = true;
  }
  if (o.week !== w) {
    o.week = w;
    o.weekly = pick(p, "weekly", w, WEEKLY_COUNT);
    changed = true;
  }
  return changed;
}

/** Counts progress. Returns the objectives that just became complete. */
export function recordObjective(p: Profile, counter: ObjectiveCounter, amount: number): ObjectiveDef[] {
  const done: ObjectiveDef[] = [];
  if (amount <= 0) return done;
  for (const st of [...p.objectives.daily, ...p.objectives.weekly]) {
    const def = objectiveDef(st.id);
    if (!def || def.counter !== counter || st.claimed) continue;
    const before = st.progress;
    st.progress = Math.min(def.target, st.progress + amount);
    if (before < def.target && st.progress >= def.target) done.push(def);
  }
  return done;
}

export interface ObjectivePayout {
  gold: number;
  essence: number;
  cores: number;
}

export function objectivePayout(p: Profile, def: ObjectiveDef): ObjectivePayout {
  const stage = Math.max(1, p.progress.bestStage);
  return { gold: def.reward.goldStages ? Math.round(stageClearGold(stage) * def.reward.goldStages) : 0, essence: def.reward.essence ?? 0, cores: def.reward.cores ?? 0 };
}

/** Claims one completed objective. Pays exactly once. */
export function claimObjective(p: Profile, id: string): ObjectivePayout | null {
  const st = [...p.objectives.daily, ...p.objectives.weekly].find((s) => s.id === id);
  const def = objectiveDef(id);
  if (!st || !def || st.claimed || st.progress < def.target) return null;
  st.claimed = true;
  const pay = objectivePayout(p, def);
  p.player.gold += pay.gold;
  p.player.essence += pay.essence;
  p.player.riftCores += pay.cores;
  if (def.scope === "daily" && p.objectives.daily.length > 0 && p.objectives.daily.every((s) => s.claimed) && p.objectives.dailyBonusDay !== p.objectives.day) {
    p.objectives.dailyBonusDay = p.objectives.day;
    p.player.riftCores += DAILY_BONUS.cores;
    pay.cores += DAILY_BONUS.cores;
  }
  return pay;
}

export function claimableObjectives(p: Profile): number {
  return [...p.objectives.daily, ...p.objectives.weekly].filter((s) => {
    const def = objectiveDef(s.id);
    return def && !s.claimed && s.progress >= def.target;
  }).length;
}
