import type { Profile } from "./profile";
import {
  MASTERY_NAME,
  SIGNATURES,
  SIGNATURE_IDS,
  SIGNATURE_RANK_MAX,
  SYNERGIES,
  emptySignatureState,
  noSignatures,
  type EvolutionId,
  type MasteryTier,
  type SignatureId,
  type SignatureLoadout,
  type SignatureState,
  type SynergyId,
} from "../data/signatures";

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

/** What stands before finding a skill. */
export function discoveryProgress(p: Profile, id: SignatureId): DiscoveryProgress {
  const def = SIGNATURES[id];
  return { text: def.hint, hidden: def.hidden && !isDiscovered(p, id) };
}

/** Skills found since the last check that the player has not yet seen revealed. */
export function pendingReveals(p: Profile): SignatureId[] {
  const s = signatureState(p);
  return s.discovered.filter((id) => !s.revealed.includes(id));
}

/** Signature slots open to this warrior (3, or 4 once earned). */
export function slotsOpen(p: Profile): number {
  void p;
  return 3;
}

/** What each open slot holds. */
export function equippedSignatures(p: Profile): (SignatureId | null)[] {
  return signatureState(p).slots.slice(0, slotsOpen(p));
}

export type EquipCheck = { ok: true } | { ok: false; reason: "unknown" | "slot" | "crown" };

export function canEquip(p: Profile, id: SignatureId, slot: number): EquipCheck {
  if (id === "sovereign_awakening") return { ok: false, reason: "crown" };
  if (!isDiscovered(p, id)) return { ok: false, reason: "unknown" };
  if (slot < 0 || slot >= slotsOpen(p)) return { ok: false, reason: "slot" };
  return { ok: true };
}

export function signatureRank(p: Profile, id: SignatureId): number {
  return isDiscovered(p, id) ? (signatureState(p).ranks[id] ?? 1) : 0;
}

/** Skill points for the next rank (null at the last rank). */
export function signatureRankCost(id: SignatureId, rank: number): number | null {
  void id;
  return rank >= SIGNATURE_RANK_MAX ? null : 4 + rank * 2;
}

export type RankCheck = { ok: true; cost: number } | { ok: false; reason: "unknown" | "max" | "points"; cost: number | null };

export function canBuySignatureRank(p: Profile, id: SignatureId): RankCheck {
  if (!isDiscovered(p, id)) return { ok: false, reason: "unknown", cost: null };
  const cost = signatureRankCost(id, signatureRank(p, id));
  if (cost === null) return { ok: false, reason: "max", cost: null };
  if (p.player.skillPoints < cost) return { ok: false, reason: "points", cost };
  return { ok: true, cost };
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
  return { tier: 0, name: MASTERY_NAME[0]!, casts: m.casts, kills: m.kills, next: { tier: 1, label: "casts", have: m.casts, need: 50 } };
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

/** What the skill does at this rank and evolution, in plain words (with its numbers). */
export function signatureEffectText(id: SignatureId, rank: number, evo: EvolutionId | null): string {
  void rank;
  const def = SIGNATURES[id];
  const e = evo ? def.evolutions.find((x) => x.id === evo) : undefined;
  return e ? `${def.description} ${e.name}: ${e.line}` : def.description;
}

/** The simulation's view of the warrior's signature skills (empty without any equipped). */
export function signatureLoadout(p: Profile): SignatureLoadout {
  const s = signatureState(p);
  const out = noSignatures();
  for (const id of equippedSignatures(p)) {
    if (!id) continue;
    out.equipped.push({ id, rank: signatureRank(p, id), evolution: chosenEvolution(p, id), mastery: signatureMastery(p, id).tier });
  }
  if (s.discovered.includes("sovereign_awakening")) out.crown = { id: "sovereign_awakening", rank: signatureRank(p, "sovereign_awakening"), evolution: null, mastery: signatureMastery(p, "sovereign_awakening").tier };
  return out;
}

/** Every skill in collection order (for the menus). */
export function signatureList(): readonly SignatureId[] {
  return SIGNATURE_IDS;
}
