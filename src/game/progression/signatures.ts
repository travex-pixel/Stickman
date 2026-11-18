import type { Profile } from "./profile";
import {
  DEVOURER,
  FRACTURE,
  JUDGEMENT,
  LEGION,
  MASTERY_NAME,
  PARADE,
  SIGNATURES,
  SIGNATURE_IDS,
  SIGNATURE_RANK_MAX,
  SIGNATURE_SLOTS,
  SHADOW_MARK,
  SOVEREIGN,
  STORM,
  SYNERGIES,
  VOID,
  VOID_MARK,
  emptySignatureState,
  noSignatures,
  signatureRankMult,
  type DiscoveryRule,
  type EvolutionId,
  type MasteryTier,
  type SignatureId,
  type SignatureLoadout,
  type SignatureRarity,
  type SignatureState,
  type SynergyId,
} from "../data/signatures";
import { ownedSpecies } from "../summons/extraction";

/**
 * Signature skills: discovery, slots, ranks, evolutions and mastery (the rules of the casts live in
 * `src/game/signatures/**` and `World`; the catalogue in `data/signatures.ts`).
 *
 * CONTRACT: the exported names and signatures below are what the menus and the controller code
 * against. Their bodies are the simulation's to complete and tune; they may not be renamed or
 * change shape without updating every caller.
 */

export function signatureState(p: Profile): SignatureState {
  return p.player.signatures ?? emptySignatureState();
}

/** The profile's own state, created if an old object lacks it (writes go here). */
function ownState(p: Profile): SignatureState {
  if (!p.player.signatures) p.player.signatures = emptySignatureState();
  return p.player.signatures;
}

/** Best stage over every climb (an ascension never hides a skill again). */
export function bestEverStage(p: Profile): number {
  return Math.max(p.progress.bestStage, p.ascension.bestEver);
}

export function isDiscovered(p: Profile, id: SignatureId): boolean {
  return signatureState(p).discovered.includes(id);
}

/** Whether the collection is shown at all (the Skills panel's signature view). */
export function signaturesVisible(p: Profile): boolean {
  return signatureState(p).discovered.length > 0 || bestEverStage(p) >= 15;
}

export interface DiscoveryProgress {
  /** The condition in words ("Defeat the stage-20 boss"), or the hint while hidden. */
  text: string;
  hidden: boolean;
  /** Progress toward it when it is countable. */
  have?: number;
  need?: number;
}

/** Where a rule stands for this save: how much of it is done, out of how much. */
function ruleProgress(p: Profile, rule: DiscoveryRule): { have: number; need: number } {
  const pr = signatureState(p).progress;
  switch (rule.kind) {
    case "boss":
      // The boss of stage S has fallen once the best stage passed it.
      return { have: Math.min(rule.stage, Math.max(0, bestEverStage(p) - 1)), need: rule.stage };
    case "chain":
      return { have: Math.min(rule.count, pr.bestChain), need: rule.count };
    case "elites":
      return { have: Math.min(rule.count, pr.elites), need: rule.count };
    case "fast_boss":
      return { have: pr.fastestBoss > 0 && pr.fastestBoss <= rule.seconds ? 1 : 0, need: 1 };
    case "shadows":
      return { have: Math.min(rule.count, ownedSpecies(p).length), need: rule.count };
    case "boss_kills":
      return { have: Math.min(rule.count, pr.bossKills[rule.defId] ?? 0), need: rule.count };
    case "sovereign": {
      const masters = SIGNATURE_IDS.filter((id) => id !== "sovereign_awakening" && isDiscovered(p, id) && signatureMastery(p, id).tier >= rule.tier).length;
      const bossDone = bestEverStage(p) > rule.stage ? 1 : 0;
      return { have: Math.min(rule.count, masters) + bossDone, need: rule.count + 1 };
    }
  }
}

function ruleText(rule: DiscoveryRule): string {
  switch (rule.kind) {
    case "boss":
      return `Defeat the stage-${rule.stage} boss`;
    case "chain":
      return `Reach a ${rule.count}-kill chain`;
    case "elites":
      return `Defeat ${rule.count} elites`;
    case "fast_boss":
      return `Win a boss fight in ${rule.seconds} seconds or less`;
    case "shadows":
      return `Swear ${rule.count} different shadows to your army`;
    case "boss_kills":
      return `Defeat the boss ${rule.count} times`;
    case "sovereign":
      return `Defeat the stage-${rule.stage} boss with ${rule.count} signature skills at ${MASTERY_NAME[rule.tier]}`;
  }
}

/** What stands before finding a skill. */
export function discoveryProgress(p: Profile, id: SignatureId): DiscoveryProgress {
  const def = SIGNATURES[id];
  const hidden = def.hidden && !isDiscovered(p, id);
  if (hidden) return { text: def.hint, hidden: true };
  const { have, need } = ruleProgress(p, def.discovery);
  const countable = def.discovery.kind !== "fast_boss";
  return { text: ruleText(def.discovery), hidden: false, ...(countable ? { have, need } : {}) };
}

/** Whether the rule for `id` is met by this save now. */
export function discoveryMet(p: Profile, id: SignatureId): boolean {
  const { have, need } = ruleProgress(p, SIGNATURES[id].discovery);
  return have >= need;
}

/**
 * Finds every skill whose rule is now met: adds it (rank 1, free) in collection order. Returns the
 * newly found. Never reveals anything itself (the controller queues reveals one at a time).
 */
export function checkDiscoveries(p: Profile): SignatureId[] {
  const found: SignatureId[] = [];
  for (const id of SIGNATURE_IDS) {
    if (isDiscovered(p, id) || !discoveryMet(p, id)) continue;
    const s = ownState(p);
    s.discovered.push(id);
    s.ranks[id] = Math.max(1, s.ranks[id] ?? 1);
    if (!s.mastery[id]) s.mastery[id] = { casts: 0, kills: 0 };
    found.push(id);
  }
  // The capstone may follow from the others in the same pass.
  if (found.length > 0 && !isDiscovered(p, "sovereign_awakening") && discoveryMet(p, "sovereign_awakening")) {
    const s = ownState(p);
    s.discovered.push("sovereign_awakening");
    s.ranks.sovereign_awakening = 1;
    s.mastery.sovereign_awakening = s.mastery.sovereign_awakening ?? { casts: 0, kills: 0 };
    found.push("sovereign_awakening");
  }
  return found;
}

/** Skills found since the last check that the player has not yet seen revealed. */
export function pendingReveals(p: Profile): SignatureId[] {
  const s = signatureState(p);
  return s.discovered.filter((id) => !s.revealed.includes(id));
}

/** Marks a skill's reveal as seen. */
export function markRevealed(p: Profile, id: SignatureId): boolean {
  const s = ownState(p);
  if (!s.discovered.includes(id) || s.revealed.includes(id)) return false;
  s.revealed.push(id);
  return true;
}

/** The fourth slot opens once this many signature skills are found (or the best stage passes FOURTH_SLOT_STAGE). */
export const FOURTH_SLOT_FOUND = 5;
export const FOURTH_SLOT_STAGE = 100;

/** Signature slots open to this warrior (3, or 4 once earned). */
export function slotsOpen(p: Profile): number {
  const found = signatureState(p).discovered.filter((id) => id !== "sovereign_awakening").length;
  return found >= FOURTH_SLOT_FOUND || bestEverStage(p) >= FOURTH_SLOT_STAGE ? SIGNATURE_SLOTS : SIGNATURE_SLOTS - 1;
}

/** What each open slot holds. */
export function equippedSignatures(p: Profile): (SignatureId | null)[] {
  const slots = signatureState(p).slots;
  const out: (SignatureId | null)[] = [];
  for (let i = 0; i < slotsOpen(p); i++) out.push(slots[i] ?? null);
  return out;
}

export type EquipCheck = { ok: true } | { ok: false; reason: "unknown" | "slot" | "crown" };

export function canEquip(p: Profile, id: SignatureId, slot: number): EquipCheck {
  if (id === "sovereign_awakening") return { ok: false, reason: "crown" };
  if (!isDiscovered(p, id)) return { ok: false, reason: "unknown" };
  if (!Number.isInteger(slot) || slot < 0 || slot >= slotsOpen(p)) return { ok: false, reason: "slot" };
  return { ok: true };
}

/** Puts `id` in `slot` (moving it from another slot; what was there swaps into its old place, or leaves). */
export function equipSignature(p: Profile, id: SignatureId, slot: number): boolean {
  if (!canEquip(p, id, slot).ok) return false;
  const s = ownState(p);
  while (s.slots.length < SIGNATURE_SLOTS) s.slots.push(null);
  const from = s.slots.indexOf(id);
  if (from === slot) return true;
  const there = s.slots[slot] ?? null;
  s.slots[slot] = id;
  if (from >= 0) s.slots[from] = there;
  return true;
}

export function unequipSignature(p: Profile, slot: number): boolean {
  const s = ownState(p);
  if (!Number.isInteger(slot) || slot < 0 || slot >= SIGNATURE_SLOTS || !s.slots[slot]) return false;
  s.slots[slot] = null;
  return true;
}

/** The first empty open slot, or -1. */
export function firstEmptySlot(p: Profile): number {
  return equippedSignatures(p).indexOf(null);
}

export function signatureRank(p: Profile, id: SignatureId): number {
  return isDiscovered(p, id) ? (signatureState(p).ranks[id] ?? 1) : 0;
}

/**
 * Skill points for each next rank (2 to 10), by rarity: each rank about twice the last. Rank 1 is
 * free on discovery and the first three are cheap (21 to 40 points), so a new skill grows at once;
 * all eight to rank 10 cost SIGNATURE_POINTS_ALL. Sized for the owner, whose levels past 150 pay a
 * point each: measured on the owner-like warrior (DESIGN.md, "Signature skills"), his points come
 * at about 2,700 the first day after his ascension, then 1,000 and falling to about 400 a day by
 * the seventh, so buying everything takes him about three weeks while a new player ranks slowly.
 */
export const RANK_COSTS: Readonly<Record<SignatureRarity, readonly number[]>> = {
  common: [3, 6, 12, 25, 50, 100, 200, 350, 550],
  rare: [3, 6, 12, 25, 50, 100, 200, 350, 550],
  epic: [4, 8, 15, 30, 60, 115, 225, 400, 640],
  legendary: [5, 10, 18, 35, 70, 135, 260, 460, 720],
  mythic: [6, 12, 22, 42, 85, 160, 300, 530, 850],
};

/** Skill points for the next rank (null at the last rank). */
export function signatureRankCost(id: SignatureId, rank: number): number | null {
  if (rank >= SIGNATURE_RANK_MAX) return null;
  return RANK_COSTS[SIGNATURES[id].rarity][Math.max(0, rank - 1)] ?? null;
}

/** Every rank of every skill, in skill points. */
export const SIGNATURE_POINTS_ALL = SIGNATURE_IDS.reduce((a, id) => a + RANK_COSTS[SIGNATURES[id].rarity].reduce((x, y) => x + y, 0), 0);

export type RankCheck = { ok: true; cost: number } | { ok: false; reason: "unknown" | "max" | "points"; cost: number | null };

export function canBuySignatureRank(p: Profile, id: SignatureId): RankCheck {
  if (!isDiscovered(p, id)) return { ok: false, reason: "unknown", cost: null };
  const cost = signatureRankCost(id, signatureRank(p, id));
  if (cost === null) return { ok: false, reason: "max", cost: null };
  if (p.player.skillPoints < cost) return { ok: false, reason: "points", cost };
  return { ok: true, cost };
}

/** Buys one rank. Returns the new rank, or null. */
export function buySignatureRank(p: Profile, id: SignatureId): number | null {
  const check = canBuySignatureRank(p, id);
  if (!check.ok) return null;
  p.player.skillPoints -= check.cost;
  const s = ownState(p);
  s.ranks[id] = signatureRank(p, id) + 1;
  return s.ranks[id]!;
}

/**
 * Mastery: one number per skill, its uses (casts plus the foes it killed), against three
 * thresholds. Sized by measurement for each skill's own pace (DESIGN.md): Adept within the first
 * evening with it equipped, Master in about two days, Grandmaster in about a week.
 */
export const MASTERY_USES: Readonly<Record<SignatureId, readonly [number, number, number]>> = {
  void_collapse: [160, 4700, 16000],
  shadow_storm: [80, 3700, 13000],
  death_parade: [130, 3400, 12000],
  time_fracture: [80, 1600, 5600],
  legion_awakening: [150, 3000, 10500],
  abyssal_devourer: [200, 4000, 14000],
  kings_judgement: [150, 1600, 5600],
  sovereign_awakening: [40, 340, 1200],
};

export function masteryUses(p: Profile, id: SignatureId): number {
  const m = signatureState(p).mastery[id];
  return m ? m.casts + m.kills : 0;
}

export function masteryTierFor(id: SignatureId, uses: number): MasteryTier {
  const need = MASTERY_USES[id];
  if (uses >= need[2]) return 3;
  if (uses >= need[1]) return 2;
  if (uses >= need[0]) return 1;
  return 0;
}

export interface MasteryView {
  tier: MasteryTier;
  name: string;
  casts: number;
  kills: number;
  /** The next tier's requirement and progress, or null at Grandmaster. */
  next: { tier: MasteryTier; label: string; have: number; need: number } | null;
}

export function signatureMastery(p: Profile, id: SignatureId): MasteryView {
  const m = signatureState(p).mastery[id] ?? { casts: 0, kills: 0 };
  const uses = m.casts + m.kills;
  const tier = masteryTierFor(id, uses);
  const next = tier >= 3 ? null : { tier: (tier + 1) as MasteryTier, label: "uses", have: uses, need: (MASTERY_USES[id] as readonly number[])[tier]! };
  return { tier, name: MASTERY_NAME[tier]!, casts: m.casts, kills: m.kills, next };
}

/** Counts uses (from the fight, or offline): returns the tier reached if it rose, else null. */
export function addMastery(p: Profile, id: SignatureId, casts: number, kills: number): MasteryTier | null {
  if (!isDiscovered(p, id) || (casts <= 0 && kills <= 0)) return null;
  const before = signatureMastery(p, id).tier;
  const s = ownState(p);
  const m = s.mastery[id] ?? { casts: 0, kills: 0 };
  m.casts += Math.max(0, Math.floor(casts));
  m.kills += Math.max(0, Math.floor(kills));
  s.mastery[id] = m;
  const after = signatureMastery(p, id).tier;
  return after > before ? after : null;
}

export function chosenEvolution(p: Profile, id: SignatureId): EvolutionId | null {
  return signatureState(p).evolutions[id] ?? null;
}

export type EvolutionCheck = { ok: true } | { ok: false; reason: "unknown" | "mastery" | "wrong_skill" };

/** Whether an evolution can be chosen now (Adept mastery opens the choice; it can be changed later). */
export function canChooseEvolution(p: Profile, id: SignatureId, evo: EvolutionId): EvolutionCheck {
  if (!isDiscovered(p, id)) return { ok: false, reason: "unknown" };
  if (!SIGNATURES[id].evolutions.some((e) => e.id === evo)) return { ok: false, reason: "wrong_skill" };
  if (signatureMastery(p, id).tier < 1) return { ok: false, reason: "mastery" };
  return { ok: true };
}

export function chooseEvolution(p: Profile, id: SignatureId, evo: EvolutionId): boolean {
  if (!canChooseEvolution(p, id, evo).ok) return false;
  ownState(p).evolutions[id] = evo;
  return true;
}

export interface SynergyView {
  id: SynergyId;
  discovered: boolean;
  /** Every skill it needs is equipped (or crowned) right now. */
  ready: boolean;
}

export function synergyViews(p: Profile): SynergyView[] {
  const s = signatureState(p);
  const on = new Set<SignatureId>(equippedSignatures(p).filter((x): x is SignatureId => x !== null));
  if (isDiscovered(p, "sovereign_awakening")) on.add("sovereign_awakening");
  return SYNERGIES.map((d) => ({ id: d.id, discovered: s.synergies.includes(d.id), ready: d.requires.every((r) => on.has(r)) }));
}

/** Records a combination seen in a fight. Returns whether it was new to this save. */
export function recordSynergy(p: Profile, id: SynergyId): boolean {
  const s = ownState(p);
  if (s.synergies.includes(id)) return false;
  s.synergies.push(id);
  return true;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const x = (v: number) => `×${(Math.round(v * 100) / 100).toString()}`;

/** What the skill does at this rank and evolution, in plain words (with its numbers). */
export function signatureEffectText(id: SignatureId, rank: number, evo: EvolutionId | null): string {
  const def = SIGNATURES[id];
  const r = Math.max(1, rank);
  const pw = (v: number) => `${pct(v * signatureRankMult(r))} of attack`;
  const cd = `every ${def.cooldown} s`;
  let base: string;
  switch (id) {
    case "void_collapse":
      base = `${cd}: draws foes in for ${VOID.pullFor} s, implodes for ${pw(def.power)} within ${def.radius}, its ring ${pw(def.power * VOID.shockwavePower)} further out; Void Mark: +${pct(VOID_MARK.bonus)} from signature skills`;
      break;
    case "abyssal_devourer":
      base = `${cd}: a pass across the field, ${pw(def.power)} a bite, up to ${DEVOURER.bitesPerFoe} bites a foe, +${pct(DEVOURER.markedBonus)} on marked or trapped foes`;
      break;
    case "death_parade":
      base = `${cd}: ${PARADE.clones} clone strikes of ${pw(def.power)}, the wounded first, then a ${pw(PARADE.finisherPower)} finisher; executes foes under ${pct(PARADE.executeBelow)}`;
      break;
    case "kings_judgement":
      base = `${cd}: a meteor of ${pw(def.power)} within ${def.radius}, ${x(1 + JUDGEMENT.bossBonus)} on a boss`;
      break;
    case "legion_awakening":
      base = `${cd}: ${LEGION.soldiers} soldiers rise for ${LEGION.lifetime} s with ${pct(LEGION.armyShare * signatureRankMult(r))} of your army's average strength and charge`;
      break;
    case "time_fracture":
      base = `${cd}: foes within ${def.radius} stop for ${FRACTURE.freezeFor} s (bosses slow), ${pct(FRACTURE.store)} of the damage they take is released again with a ${pw(def.power)} impact`;
      break;
    case "shadow_storm":
      base = `${cd}: ${STORM.blades} blades of ${pw(def.power)}, each leaving a Shadow Mark (+${pct(SHADOW_MARK.bonus)} from all your blows)`;
      break;
    case "sovereign_awakening":
      base = `${cd}: for ${SOVEREIGN.auraFor} s your other signature skills recover ${pct(SOVEREIGN.cooldownRate)} faster, your shadows strike ${pct(SOVEREIGN.summonBonus)} harder, and an ultimate is crowned`;
      break;
  }
  const e = evo ? def.evolutions.find((v) => v.id === evo) : undefined;
  return e ? `${base}. ${e.name}: ${e.line}` : `${base}.`;
}

/** The simulation's view of the warrior's signature skills (empty without any equipped). */
export function signatureLoadout(p: Profile): SignatureLoadout {
  const s = signatureState(p);
  const out = noSignatures();
  for (const id of equippedSignatures(p)) {
    if (!id || !s.discovered.includes(id)) continue;
    out.equipped.push({ id, rank: signatureRank(p, id), evolution: chosenEvolution(p, id), mastery: signatureMastery(p, id).tier });
  }
  if (s.discovered.includes("sovereign_awakening")) out.crown = { id: "sovereign_awakening", rank: signatureRank(p, "sovereign_awakening"), evolution: null, mastery: signatureMastery(p, "sovereign_awakening").tier };
  if (out.equipped.length > 0 || out.crown) out.known = [...s.synergies];
  return out;
}

/**
 * What each equipped skill adds to a late warrior's boss damage at rank 1, unevolved, as measured
 * (DESIGN.md, "Signature skills": boss fights on AUTO, the stage-60 and the level-561 warriors).
 */
export const SIG_BOSS_SHARE: Readonly<Record<SignatureId, number>> = {
  void_collapse: 0.08,
  shadow_storm: 0.13,
  death_parade: 0.05,
  time_fracture: 0.13,
  legion_awakening: 0.05,
  abyssal_devourer: 0.07,
  kings_judgement: 0.08,
  sovereign_awakening: 0,
};
/** An evolution chosen (and awakened at Master) adds this much to a skill's share. */
export const SIG_EVOLVED_FACTOR = 1.1;
export const SIG_MASTER_FACTOR = 1.12;
/**
 * The crown: what the Sovereign adds to boss damage at rank 1 with three or more skills equipped.
 * Measured on full late loadouts (rank 10, evolved, Master) it adds 0 to 9% (about 4%), not the
 * 31% a share of 0.15 claimed; Power had overstated those loadouts by a fifth to a third.
 */
export const SIG_CROWN_SHARE = 0.02;

/**
 * Signature skills in Power: what the equipped ones add to boss damage, by their measured shares,
 * ranks, evolutions and mastery; the crown on top. 1 with none equipped.
 */
export function signatureDamageMult(p: Profile): number {
  const l = signatureLoadout(p);
  if (l.equipped.length === 0) return 1;
  let add = 0;
  for (const e of l.equipped) add += SIG_BOSS_SHARE[e.id] * signatureRankMult(e.rank) * (e.evolution ? SIG_EVOLVED_FACTOR : 1) * (e.evolution && e.mastery >= 2 ? SIG_MASTER_FACTOR : 1);
  const crown = l.crown ? 1 + SIG_CROWN_SHARE * signatureRankMult(l.crown.rank) * Math.min(1, l.equipped.length / 3) : 1;
  return (1 + add) * crown;
}

/** Every skill in collection order (for the menus). */
export function signatureList(): readonly SignatureId[] {
  return SIGNATURE_IDS;
}
