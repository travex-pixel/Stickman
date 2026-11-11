import { createDefaultProfile, PROFILE_VERSION, type Profile } from "@/game/progression/profile";
import { SUMMONS } from "@/game/data/summons";
import { EQUIP_SLOTS, type AbilityId } from "@/game/data/ids";
import { ABILITIES } from "@/game/data/abilities";
import { ABILITY_RANK_MAX } from "@/game/progression/abilityRanks";
import { EQUIPMENT_TEMPLATES } from "@/game/data/equipment";
import { SKILLS } from "@/game/data/skills";
import { GEAR_EFFECTS, type GearEffectId } from "@/game/data/gearEffects";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Validates and repairs a loaded profile. Unknown or corrupt fields fall back to defaults field by field,
 * so a single bad value never wipes the player's progress.
 */
export function sanitizeProfile(raw: unknown): { profile: Profile; repaired: boolean } {
  const def = createDefaultProfile();
  let repaired = false;
  if (!isObj(raw)) return { profile: def, repaired: true };
  const fix = <T>(v: unknown, guard: (x: unknown) => x is T, fallback: T): T => {
    if (guard(v)) return v;
    repaired = true;
    return fallback;
  };
  const num = (v: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) => Math.min(max, Math.max(min, Math.floor(fix(v, isNum, fallback))));
  const numF = (v: unknown, fallback: number, min = 0, max = 1) => Math.min(max, Math.max(min, fix(v, isNum, fallback)));

  const p = isObj(raw.player) ? raw.player : (repaired = true, {});
  const statLevels = isObj(p.statLevels) ? p.statLevels : {};
  const perks: Record<string, number> = {};
  if (isObj(p.perks)) for (const [k, v] of Object.entries(p.perks)) if (isNum(v) && v > 0) perks[k] = Math.floor(v);

  const eq = isObj(raw.equipment) ? raw.equipment : {};
  const inventory: Profile["equipment"]["inventory"] = [];
  if (Array.isArray(eq.inventory)) {
    for (const it of eq.inventory) {
      if (!isObj(it) || !isStr(it.uid) || !isStr(it.templateId) || !EQUIPMENT_TEMPLATES.some((t) => t.id === it.templateId)) {
        repaired = true;
        continue;
      }
      const template = EQUIPMENT_TEMPLATES.find((t) => t.id === it.templateId)!;
      inventory.push({
        uid: it.uid,
        templateId: it.templateId,
        slot: template.slot,
        rarity: (["common", "uncommon", "rare", "epic", "legendary"] as const).includes(it.rarity as never) ? (it.rarity as Profile["equipment"]["inventory"][number]["rarity"]) : "common",
        level: num(it.level, 1, 1, 30),
        mainStat: template.mainStat,
        mainValue: numF(it.mainValue, 1, 0, 1e6),
        ...(isStr(it.effect) && it.effect in GEAR_EFFECTS ? { effect: it.effect as GearEffectId } : {}),
        substats: Array.isArray(it.substats) ? it.substats.filter((s): s is { stat: Profile["equipment"]["inventory"][number]["mainStat"]; value: number } => isObj(s) && isStr(s.stat) && isNum(s.value)).slice(0, 3) : [],
      });
    }
  }
  const equipped: Profile["equipment"]["equipped"] = {};
  if (isObj(eq.equipped)) {
    for (const slot of EQUIP_SLOTS) {
      const uid = eq.equipped[slot];
      if (isStr(uid) && inventory.some((i) => i.uid === uid && i.slot === slot)) equipped[slot] = uid;
      else if (uid !== undefined) repaired = true;
    }
  }

  const sm = isObj(raw.summons) ? raw.summons : {};
  const collection: Profile["summons"]["collection"] = [];
  if (Array.isArray(sm.collection)) {
    for (const s of sm.collection) {
      if (!isObj(s) || !isStr(s.instanceId) || !isStr(s.defId) || !SUMMONS[s.defId]) {
        repaired = true;
        continue;
      }
      collection.push({
        instanceId: s.instanceId,
        defId: s.defId,
        level: num(s.level, 1, 1, 25),
        xp: num(s.xp, 0),
        bond: num(s.bond, 1, 1, 50),
        shards: num(s.shards, 0),
        stars: num(s.stars, 0, 0, 5),
        deployed: s.deployed === true,
        recruitedAt: num(s.recruitedAt, Date.now()),
      });
    }
  }
  const pr = isObj(raw.progress) ? raw.progress : {};
  const quest = isObj(pr.quest) ? pr.quest : {};
  const tut = isObj(raw.tutorial) ? raw.tutorial : {};
  const md = isObj(raw.modes) ? raw.modes : {};
  const mk = isObj(md.keys) ? md.keys : {};
  const st = isObj(raw.settings) ? raw.settings : {};
  const sk = isObj(raw.skills) ? raw.skills : {};
  const command = sm.command === "aggressive" || sm.command === "guard" || sm.command === "follow" ? sm.command : "follow";
  const weaponPath = p.weaponPath === "stormblade" || p.weaponPath === "infernal" || p.weaponPath === "voidfang" ? p.weaponPath : "none";

  const profile: Profile = {
    version: PROFILE_VERSION,
    createdAt: num(raw.createdAt, def.createdAt),
    lastActive: num(raw.lastActive, def.lastActive),
    player: {
      level: num(p.level, 1, 1, 60),
      xp: num(p.xp, 0),
      gold: num(p.gold, 0),
      essence: num(p.essence, 0),
      riftCores: num(p.riftCores, 0),
      skillPoints: num(p.skillPoints, 0),
      statLevels: {
        attack: num(statLevels.attack, 1, 1, 400),
        maxHp: num(statLevels.maxHp, 1, 1, 400),
        attackSpeed: num(statLevels.attackSpeed, 1, 1, 120),
        critChance: num(statLevels.critChance, 1, 1, 150),
        critDamage: num(statLevels.critDamage, 1, 1, 300),
        defense: num(statLevels.defense, 1, 1, 250),
      },
      weaponPath,
      perks,
      pendingPerkChoices: num(p.pendingPerkChoices, 0, 0, 10),
      autoCast: p.autoCast === true,
      rank: num(p.rank, 0, 0, 5),
      abilityRanks: sanitizeAbilityRanks(p.abilityRanks),
    },
    equipment: { equipped, inventory },
    skills: { unlocked: Array.isArray(sk.unlocked) ? sk.unlocked.filter((id): id is string => isStr(id) && SKILLS.some((n) => n.id === id)) : [] },
    summons: {
      collection,
      command,
      wardenSigils: num(sm.wardenSigils, 0, 0, 3),
      firstSummonSeen: sm.firstSummonSeen === true,
      totalClaimed: num(sm.totalClaimed, 0),
      pity: isObj(sm.pity) ? Object.fromEntries(Object.entries(sm.pity).filter(([k, v]) => SUMMONS[k] && isNum(v) && v >= 0).map(([k, v]) => [k, Math.min(20, Math.floor(v as number))])) : {},
      totalAttempts: num(sm.totalAttempts, 0),
    },
    progress: {
      currentStage: num(pr.currentStage, 1, 1, 9999),
      bestStage: num(pr.bestStage, 0, 0, 9999),
      totalKills: num(pr.totalKills, 0),
      bossKills: num(pr.bossKills, 0),
      runs: num(pr.runs, 0),
      journal: Array.isArray(pr.journal) ? pr.journal.filter(isStr) : ["j_rift"],
      achievements: Array.isArray(pr.achievements) ? pr.achievements.filter(isStr) : [],
      quest: { index: num(quest.index, 0, 0, 999), counter: num(quest.counter, 0), complete: quest.complete === true },
      killsByEnemy: isObj(pr.killsByEnemy) ? Object.fromEntries(Object.entries(pr.killsByEnemy).filter(([, v]) => isNum(v)) as [string, number][]) : {},
      abilityCasts: num(pr.abilityCasts, 0),
      evolutions: num(pr.evolutions, 0),
      redeemedCodes: Array.isArray(pr.redeemedCodes) ? pr.redeemedCodes.filter(isStr).slice(0, 500) : [],
    },
    modes: {
      keyDay: isStr(md.keyDay) ? md.keyDay : "",
      keys: { vault: num(mk.vault, 3, 0, 3), rift: num(mk.rift, 3, 0, 3) },
      endlessBest: num(md.endlessBest, 0),
      vaultBest: num(md.vaultBest, 0),
    },
    tutorial: { completed: Array.isArray(tut.completed) ? tut.completed.filter(isStr) : [], finished: tut.finished === true },
    settings: {
      music: numF(st.music, def.settings.music),
      sfx: numF(st.sfx, def.settings.sfx),
      reducedEffects: st.reducedEffects === true,
      diagnostics: st.diagnostics === true,
      battleSpeed: st.battleSpeed === 2 ? 2 : 1,
      autoAdvance: st.autoAdvance !== false,
    },
  };
  // Deployed summons cannot exceed what the save could legitimately hold.
  let deployed = 0;
  for (const s of profile.summons.collection) {
    if (s.deployed) {
      deployed += 1;
      if (deployed > 4) {
        s.deployed = false;
        repaired = true;
      }
    }
  }
  return { profile, repaired };
}

function sanitizeAbilityRanks(v: unknown): Partial<Record<AbilityId, number>> {
  const out: Partial<Record<AbilityId, number>> = {};
  if (!isObj(v)) return out;
  for (const id of Object.keys(ABILITIES) as AbilityId[]) {
    const r = v[id];
    if (typeof r === "number" && Number.isFinite(r) && r > 0) out[id] = Math.min(ABILITY_RANK_MAX, Math.floor(r));
  }
  return out;
}
