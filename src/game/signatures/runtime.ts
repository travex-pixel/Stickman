import type { World } from "../engine/World";
import { ARENA, FURY_STRIKES } from "../engine/World";
import { ULTIMATE_ENERGY_COST } from "../data/abilities";
import type { Vec2 } from "../engine/math";
import type { Element } from "../data/ids";
import type { Combatant } from "../entities/types";
import { addStatus, hasStatus } from "../combat/statuses";
import { isHidden } from "../combat/targeting";
import {
  SIGNATURES,
  SIG_CINEMATIC_GAP,
  SIG_FURY_PATIENCE,
  SIG_GLOBAL_LOCKOUT,
  SIG_OPENING_SHARE,
  SHADOW_MARK,
  SOVEREIGN,
  SYNERGY_LOCKOUT,
  VOID_MARK,
  signatureRankMult,
  type EvolutionId,
  type SignatureBeat,
  type SignatureId,
  type SignatureLoadout,
  type SignatureLoadoutEntry,
  type SignatureStatus,
  type SynergyId,
} from "../data/signatures";
import { SKILL_IMPLS, type Plan } from "./skills/index";
import { guardUp } from "../bosses/sovereigns";
import { nearAllyRod } from "../summons/sovereignShadows";
import { chooseCast } from "./ai";

/**
 * The signature skills' part of a World: cooldowns, the casts in flight (each a timeline of beats
 * and blows in world seconds), the statuses they put on foes, the Legion's risen soldiers, the
 * Sovereign's aura and the combinations' lockouts. The World creates one only once a signature skill
 * is equipped; without it nothing here runs, draws or sends anything.
 *
 * Everything resolves in the simulation, at fixed steps, through `World.dealDamage` (tagged
 * `hit.sig`). The renderer reads the events (and, if it likes, `casts`) and never writes here.
 */

export function hasSignatures(l: SignatureLoadout | null | undefined): boolean {
  return !!l && (l.equipped.length > 0 || l.crown !== null);
}

interface Step {
  at: number;
  seq: number;
  fn: () => void;
}

/** A per-tick process of a cast (a pull, a pass); returns false when it is done. */
export type Proc = (dt: number) => boolean;

export interface Cast {
  id: number;
  sig: SignatureId;
  entry: SignatureLoadoutEntry;
  evo: EvolutionId | null;
  /** Mastery tier 2 or more: the chosen evolution's second step. */
  master: boolean;
  enhanced: boolean;
  /** World seconds since it began. */
  t: number;
  steps: Step[];
  procs: Proc[];
  seq: number;
  center: Vec2;
  radius: number;
  kills: number;
  /** Where its moving body is now (the Devourer's head), for a renderer that wants to follow it. */
  head: Vec2 | null;
  /** Kills the cast made while it ran, for skills that react to them (set by the skill). */
  onKill?: (target: Combatant) => void;
  /** Called once when it ends (normally or not). */
  onEnd?: (interrupted: boolean) => void;
  ended: boolean;
}

/** A soldier risen by Legion Awakening. */
interface Soldier {
  castId: number;
}

export class SignatureRuntime {
  readonly world: World;
  readonly casts: Cast[] = [];
  /** Seconds left on each skill's cooldown (raw seconds, as the abilities'). */
  private cooldowns = new Map<SignatureId, number>();
  /** World time each skill last came off cooldown (an exploiter's patience counts from it). */
  readyAt = new Map<SignatureId, number>();
  /** World time the Fury was last charged and waiting (-1 while it is not). */
  private furyChargedAt = -1;
  private nextCastId = 1;
  /** Raw seconds until any signature skill may begin. */
  lockout = 0;
  lastCinematicAt = -Infinity;
  private aiTimer = 0;
  private tracked = new Map<string, { target: Combatant; status: SignatureStatus }>();
  /** Foes being drawn into a singularity this moment (they do not act). */
  readonly pulled = new Set<number>();
  readonly soldiers = new Map<number, Soldier>();
  /** Where foes fell lately (Legion Awakening raises soldiers there). */
  readonly corpses: { pos: Vec2; at: number }[] = [];
  /** Void Collapse, Consumption: kills stored for the next collapse. */
  consumption = 0;
  /** Abyssal Devourer, Soul Feeder: kills charging the next bite. */
  feed = 0;
  /** Sovereign Awakening's aura: world time it ends (-1: none). */
  auraUntil = -1;
  /** The last singularity (Gravity Feast bends the dragon through it). */
  singularity: { pos: Vec2; at: number; radius: number; queen?: boolean } | null = null;
  private synergyAt = new Map<SynergyId, number>();
  private known: Set<SynergyId>;
  /** Time Fracture: foes held in a fracture, with the damage time is keeping for them. */
  readonly ledger = new Map<number, { castId: number; stored: number }>();
  /** Every skill seen in this world's loadout (a newly equipped one starts on its opening cooldown). */
  private seen = new Set<SignatureId>();
  /** Casts begun in this world, by skill (for measurements and tests). */
  readonly castCount = new Map<SignatureId, number>();

  constructor(world: World) {
    this.world = world;
    this.known = new Set(world.loadout.signatures?.known ?? []);
    this.setLoadout();
  }

  get loadout(): SignatureLoadout {
    return this.world.loadout.signatures ?? { equipped: [], crown: null };
  }

  /** Equipped skills in slot order, the crown last (rebuilt only when the loadout changes). */
  private list: SignatureLoadoutEntry[] = [];
  entries(): readonly SignatureLoadoutEntry[] {
    return this.list;
  }

  entry(id: SignatureId): SignatureLoadoutEntry | null {
    return this.entries().find((e) => e.id === id) ?? null;
  }

  /** The loadout changed: a skill not seen before in this world starts on its opening cooldown. */
  setLoadout(): void {
    const l = this.loadout;
    this.list = l.crown ? [...l.equipped, l.crown] : [...l.equipped];
    for (const s of l.known ?? []) this.known.add(s);
    let i = 0;
    for (const e of this.entries()) {
      if (!this.seen.has(e.id)) {
        this.seen.add(e.id);
        this.cooldowns.set(e.id, SIGNATURES[e.id].cooldown * SIG_OPENING_SHARE + i * 1.5);
      }
      i++;
    }
  }

  cooldown(id: SignatureId): number {
    return this.cooldowns.get(id) ?? 0;
  }

  /** Take `seconds` off a skill's cooldown (Consumption's mastery). */
  reduceCooldown(id: SignatureId, seconds: number): void {
    const left = this.cooldowns.get(id) ?? 0;
    if (left > 0) this.cooldowns.set(id, Math.max(0, left - seconds));
  }

  dispose(): void {
    this.casts.length = 0;
    this.tracked.clear();
    this.pulled.clear();
    this.soldiers.clear();
    this.ledger.clear();
  }

  get auraActive(): boolean {
    return this.auraUntil >= 0 && this.world.time < this.auraUntil;
  }

  // -------------------------------------------------------------------------------------------
  // World hooks
  // -------------------------------------------------------------------------------------------

  /** Whether foe `e` is held out of action this tick (frozen, trapped, or being pulled). */
  holds(e: Combatant): boolean {
    if (e.faction !== "enemy") return false;
    return this.pulled.has(e.id) || hasStatus(e, "frozen") || hasStatus(e, "trapped");
  }

  isSoldier(e: Combatant): boolean {
    return this.soldiers.has(e.id);
  }

  /** The skill a hit from `sourceId` belongs to, if any: the one striking now, or a risen soldier's. */
  tagFor(sourceId: number): SignatureId | null {
    if (this.world.sigStrike) return this.world.sigStrike;
    return this.soldiers.has(sourceId) ? "legion_awakening" : null;
  }

  /** The skill a death belongs to: a soldier's own end, or the skill (or soldier) that killed it. */
  deathTag(target: Combatant, killerId: number): SignatureId | null {
    if (this.soldiers.has(target.id)) return "legion_awakening";
    if (target.faction !== "enemy") return null;
    return this.tagFor(killerId);
  }

  /** Damage multiplier for an ally's blow: Shadow Mark on the foe, the Sovereign's aura on a summon. */
  allyBonus(source: Combatant, target: Combatant): number {
    let m = 1;
    if (hasStatus(target, "shadow_mark")) m *= 1 + SHADOW_MARK.bonus;
    if (source.kind === "summon" && this.auraActive) m *= 1 + SOVEREIGN.summonBonus;
    return m;
  }

  /** Damage landed on a body: Time Fracture keeps a share of what an ally deals to a held foe. */
  onDamage(target: Combatant, amount: number, sourceId: number): void {
    if (this.ledger.size === 0 || this.world.sigStrike === "time_fracture") return;
    const l = this.ledger.get(target.id);
    if (!l) return;
    const src = this.world.entities.get(sourceId);
    if (!src || src.faction !== "ally") return;
    l.stored += amount * (this.fractureStore.get(l.castId) ?? 0);
  }
  /** Time Fracture's keep share for each fracture in flight. */
  readonly fractureStore = new Map<number, number>();

  /** A foe fell (`sig`: the skill that killed it, if one did). */
  onKill(target: Combatant, sig: SignatureId | null): void {
    this.corpses.push({ pos: { ...target.pos }, at: this.world.time });
    if (this.corpses.length > 16) this.corpses.shift();
    if (!sig) return;
    for (let i = this.casts.length - 1; i >= 0; i--) {
      const c = this.casts[i]!;
      if (c.sig !== sig) continue;
      c.kills += 1;
      c.onKill?.(target);
      break;
    }
  }

  /** The Ascendant Fury begins: crowned while the Sovereign reigns. Returns its strike count. */
  onUltimate(): number {
    if (!this.auraActive) return FURY_STRIKES;
    this.synergy("crowned_ultimate", 0, this.world.player.pos, this.world.enemies().map((e) => e.id));
    return SOVEREIGN.furyStrikes;
  }

  snapshot(): { id: SignatureId; cooldown: number; cooldownMax: number; casting: boolean }[] {
    return this.entries().map((e) => ({ id: e.id, cooldown: this.cooldown(e.id), cooldownMax: SIGNATURES[e.id].cooldown, casting: this.casts.some((c) => c.sig === e.id) }));
  }

  // -------------------------------------------------------------------------------------------
  // The step
  // -------------------------------------------------------------------------------------------

  update(dt: number, rawDt: number): void {
    const w = this.world;
    const aura = this.auraActive;
    for (const e of this.entries()) {
      const left = this.cooldowns.get(e.id) ?? 0;
      if (left <= 0) continue;
      const rate = aura && e.id !== "sovereign_awakening" ? 1 + SOVEREIGN.cooldownRate : 1;
      const next = Math.max(0, left - rawDt * rate);
      this.cooldowns.set(e.id, next);
      if (next <= 0) this.readyAt.set(e.id, w.time);
    }
    this.lockout = Math.max(0, this.lockout - rawDt);
    if (w.energy >= ULTIMATE_ENERGY_COST && !w.ultimate.active) {
      if (this.furyChargedAt < 0) this.furyChargedAt = w.time;
    } else this.furyChargedAt = -1;
    const over = w.phase === "victory" || w.phase === "defeat" || w.player.dead;
    for (let i = 0; i < this.casts.length; i++) {
      const c = this.casts[i]!;
      if (over) {
        this.end(c, true);
        continue;
      }
      c.t += dt;
      this.runCast(c, dt);
    }
    for (let i = this.casts.length - 1; i >= 0; i--) if (this.casts[i]!.steps.length === 0 && this.casts[i]!.procs.length === 0) this.casts.splice(i, 1);
    this.sweepStatuses();
    for (const [id] of this.soldiers) {
      const e = w.entities.get(id);
      if (!e || e.dead) this.soldiers.delete(id);
    }
    if (this.auraUntil >= 0 && w.time >= this.auraUntil) this.auraUntil = -1;
    if (over) return;
    this.aiTimer -= rawDt;
    if (this.aiTimer > 0 || this.lockout > 0) return;
    this.aiTimer = 0.1;
    if (!this.mayCast()) return;
    const pick = chooseCast(this);
    if (pick) this.start(pick.entry, pick.plan);
  }

  /** Nothing begins during the Fury, an entrance, a cast of the warrior's own, or an empty field. */
  mayCast(): boolean {
    const w = this.world;
    if (w.ultimate.active || w.player.dead) return false;
    if (w.phase !== "wave" && w.phase !== "boss") return false;
    // A Mirror Knight's standing mirror would flash a skill's blows back: the skills wait it out.
    if (guardUp(w.boss)) return false;
    const s = w.player.state;
    if (s === "cast" || s === "dodge" || s === "hit" || s === "emerge") return false;
    return true;
  }

  ready(id: SignatureId): boolean {
    return this.cooldown(id) <= 0;
  }

  /**
   * Whether AUTO would cast a charged Fury now: on three foes or a boss, or, after SIG_FURY_PATIENCE
   * seconds charged, on any foe (World.autoCast asks this only with signature skills equipped).
   */
  furyDue(): boolean {
    const w = this.world;
    if (!w.loadout.autoCast || !w.loadout.ultimateUnlocked || w.energy < ULTIMATE_ENERGY_COST || w.ultimate.active) return false;
    const n = w.enemies().length;
    return n >= 3 || !!w.boss || (n >= 1 && this.furyPatient());
  }

  /**
   * The Fury has been charged (and not cast) at least SIG_FURY_PATIENCE seconds, with a skill in a
   * slot (the crown found but nothing equipped changes nothing).
   */
  furyPatient(): boolean {
    return this.loadout.equipped.length > 0 && this.furyChargedAt >= 0 && this.world.time - this.furyChargedAt >= SIG_FURY_PATIENCE;
  }

  /** Whether a skill has been ready at least `seconds` (patience: it then takes any live foe). */
  patient(id: SignatureId, seconds: number): boolean {
    return this.ready(id) && this.world.time - (this.readyAt.get(id) ?? 0) >= seconds;
  }

  /** Whether a cinematic may begin now (at most one every few seconds). */
  cinematicFree(): boolean {
    return this.world.time - this.lastCinematicAt >= SIG_CINEMATIC_GAP;
  }

  private runCast(c: Cast, dt: number): void {
    // Steps may add steps (a burst that leaps): keep taking whatever is due, in time then order.
    for (let guard = 0; guard < 256; guard++) {
      let idx = -1;
      for (let k = 0; k < c.steps.length; k++) {
        const s = c.steps[k]!;
        if (s.at > c.t + 1e-9) continue;
        if (idx < 0 || s.at < c.steps[idx]!.at || (s.at === c.steps[idx]!.at && s.seq < c.steps[idx]!.seq)) idx = k;
      }
      if (idx < 0) break;
      const [s] = c.steps.splice(idx, 1);
      s!.fn();
    }
    for (let k = 0; k < c.procs.length; k++) {
      if (!c.procs[k]!(dt)) {
        c.procs.splice(k, 1);
        k--;
      }
    }
    if (c.steps.length === 0 && c.procs.length === 0) this.end(c, false);
  }

  private end(c: Cast, interrupted: boolean): void {
    if (c.ended) return;
    c.ended = true;
    c.steps.length = 0;
    c.procs.length = 0;
    c.onEnd?.(interrupted);
    this.world.events.push({ type: "sig_end", castId: c.id, sig: c.sig, interrupted });
  }

  // -------------------------------------------------------------------------------------------
  // Casting
  // -------------------------------------------------------------------------------------------

  start(entry: SignatureLoadoutEntry, plan: Plan, opts: { enhanced?: boolean; free?: boolean } = {}): Cast {
    const w = this.world;
    const def = SIGNATURES[entry.id];
    const c: Cast = {
      id: this.nextCastId++,
      sig: entry.id,
      entry,
      evo: entry.evolution,
      master: entry.mastery >= 2,
      enhanced: opts.enhanced ?? (this.auraActive && entry.id !== "sovereign_awakening"),
      t: 0,
      steps: [],
      procs: [],
      seq: 0,
      center: { ...plan.center },
      radius: plan.radius,
      kills: 0,
      head: null,
      ended: false,
    };
    if (!opts.free) {
      this.cooldowns.set(entry.id, def.cooldown);
      this.lockout = SIG_GLOBAL_LOCKOUT;
      if (def.cinematic) this.lastCinematicAt = w.time;
      this.castCount.set(entry.id, (this.castCount.get(entry.id) ?? 0) + 1);
    }
    const p = w.player;
    if (def.castTime > 0 && !opts.free) {
      // Held for the cast only (Death Parade's vanish and the Sovereign's crown hold him longer
      // through their own statuses, never past the cast).
      w.setState(p, "cast", def.castTime);
      p.pendingAbility = null;
      p.pendingHitLanded = true;
      p.vel.x = 0;
      p.vel.y = 0;
      if (plan.center.x !== p.pos.x) p.facing = plan.center.x >= p.pos.x ? 1 : -1;
    }
    const timing = SKILL_IMPLS[entry.id].begin(this, c, plan);
    w.events.push({
      type: "sig_cast",
      castId: c.id,
      sig: entry.id,
      evo: c.evo,
      mastery: entry.mastery,
      rank: entry.rank,
      casterId: p.id,
      origin: { ...p.pos },
      center: { ...c.center },
      radius: c.radius,
      targetIds: plan.targets.map((t) => t.id),
      windup: timing.windup,
      length: timing.length,
      boss: plan.boss,
      enhanced: c.enhanced,
    });
    // Crowned Ultimate: an ultimate cast in the Sovereign's aura takes its crowned form.
    if (c.enhanced && (entry.id === "kings_judgement" || entry.id === "abyssal_devourer")) this.synergy("crowned_ultimate", c.id, c.center, plan.targets.map((t) => t.id));
    this.casts.push(c);
    this.runCast(c, 0);
    return c;
  }

  /** Schedule `fn` at `at` world seconds into the cast. */
  at(c: Cast, at: number, fn: () => void): void {
    c.steps.push({ at, seq: c.seq++, fn });
  }

  beat(c: Cast, beat: SignatureBeat, o: { index?: number; from?: Vec2; to?: Vec2; targets?: (Combatant | number)[]; radius?: number; duration?: number } = {}): void {
    const from = o.from ?? c.center;
    this.world.events.push({
      type: "sig_beat",
      castId: c.id,
      sig: c.sig,
      beat,
      index: o.index ?? 0,
      from: { x: from.x, y: from.y },
      to: o.to ? { x: o.to.x, y: o.to.y } : { x: from.x, y: from.y },
      targetIds: (o.targets ?? []).map((t) => (typeof t === "number" ? t : t.id)),
      radius: o.radius ?? 0,
      duration: o.duration ?? 0,
    });
  }

  /**
   * A signature blow: the warrior's attack times `power`, the rank's multiplier, Void Mark's bonus,
   * through the full damage pipeline (crits, defence, guards, shields). Charges nothing.
   */
  strike(c: Cast | SignatureId, target: Combatant, power: number, o: { heavy?: boolean; element?: Element; bonus?: number; fromX?: number; rank?: number } = {}): { amount: number; crit: boolean } | null {
    const w = this.world;
    if (target.dead || target.faction !== "enemy") return null;
    const sig = typeof c === "string" ? c : c.sig;
    const rank = o.rank ?? (typeof c === "string" ? (this.entry(c)?.rank ?? 1) : c.entry.rank);
    let bonus = o.bonus ?? 1;
    if (hasStatus(target, "void_mark")) bonus *= 1 + VOID_MARK.bonus;
    const prev = w.sigStrike;
    w.sigStrike = sig;
    try {
      return w.dealDamage(w.player, target, power * signatureRankMult(rank), o.element ?? "void", o.heavy ?? false, bonus, undefined, o.fromX);
    } finally {
      w.sigStrike = prev;
    }
  }

  /** Put a signature status on a foe (and say so). */
  applyStatus(target: Combatant, status: SignatureStatus, duration: number, value = 1): void {
    if (target.dead) return;
    addStatus(target, { kind: status, remaining: duration, value, sourceId: this.world.player.id });
    const key = `${target.id}:${status}`;
    this.tracked.set(key, { target, status });
    this.world.events.push({ type: "sig_status", targetId: target.id, status, on: true, duration, pos: { ...target.pos } });
  }

  /** Statuses that ran out (or whose bearer fell) are announced off. */
  private sweepStatuses(): void {
    for (const [key, t] of this.tracked) {
      if (!t.target.dead && hasStatus(t.target, t.status)) continue;
      this.tracked.delete(key);
      this.world.events.push({ type: "sig_status", targetId: t.target.id, status: t.status, on: false, duration: 0, pos: { ...t.target.pos } });
    }
  }

  /**
   * A combination fires if its lockout allows: sends `sig_synergy` (before its hits) and returns
   * whether it fired. `first` the first time this save has seen it.
   */
  synergy(id: SynergyId, castId: number, pos: Vec2, targetIds: number[]): boolean {
    const w = this.world;
    const last = this.synergyAt.get(id);
    if (last !== undefined && w.time - last < SYNERGY_LOCKOUT[id]) return false;
    this.synergyAt.set(id, w.time);
    const first = !this.known.has(id);
    this.known.add(id);
    w.events.push({ type: "sig_synergy", synergy: id, castId, pos: { ...pos }, targetIds, first });
    return true;
  }

  /** How much stronger a combination's own effect is now (the Sovereign's aura). */
  get synergyMult(): number {
    return this.auraActive ? 1 + SOVEREIGN.synergyBonus : 1;
  }

  // -------------------------------------------------------------------------------------------
  // Targeting helpers
  // -------------------------------------------------------------------------------------------

  /** Living foes that can be struck: visible, on (or at the edge of) the field. */
  foes(): Combatant[] {
    const out: Combatant[] = [];
    for (const e of this.world.entities.values()) {
      if (e.dead || e.faction !== "enemy" || isHidden(e)) continue;
      if (e.pos.x < ARENA.minX - 20 || e.pos.x > ARENA.maxX + 20) continue;
      out.push(e);
    }
    return out;
  }

  /** The densest group: the foe with most others within `radius`, and the middle of that group. */
  densest(radius: number, foes = this.foes()): { center: Vec2; members: Combatant[] } | null {
    if (foes.length === 0) return null;
    let best: Combatant[] = [];
    let bestScore = -1;
    const r2 = radius * radius;
    for (const a of foes) {
      const members: Combatant[] = [];
      let score = 0;
      for (const b of foes) {
        const dx = a.pos.x - b.pos.x;
        const dy = a.pos.y - b.pos.y;
        if (dx * dx + dy * dy <= r2) {
          members.push(b);
          score += b.kind === "boss" ? 3 : 1;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = members;
      }
    }
    let x = 0;
    let y = 0;
    for (const m of best) {
      x += m.pos.x;
      y += m.pos.y;
    }
    return { center: clampToField({ x: x / best.length, y: y / best.length }), members: best };
  }

  within(center: Vec2, radius: number, foes = this.foes()): Combatant[] {
    const r2 = radius * radius;
    return foes.filter((e) => {
      const dx = e.pos.x - center.x;
      const dy = e.pos.y - center.y;
      return dx * dx + dy * dy <= r2;
    });
  }

  marked(e: Combatant): boolean {
    if (hasStatus(e, "void_mark") || hasStatus(e, "shadow_mark") || hasStatus(e, "mark")) return true;
    // A Storm Titan shadow's rod: the foes beside it count as marked.
    return this.world.allyRods.length > 0 && nearAllyRod(this.world, e);
  }

  // -------------------------------------------------------------------------------------------
  // Legion soldiers
  // -------------------------------------------------------------------------------------------

  addSoldier(e: Combatant, castId: number): void {
    this.soldiers.set(e.id, { castId });
  }
}

export function clampToField(p: Vec2): Vec2 {
  return { x: Math.max(ARENA.minX, Math.min(ARENA.maxX, p.x)), y: Math.max(ARENA.minY, Math.min(ARENA.maxY, p.y)) };
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
