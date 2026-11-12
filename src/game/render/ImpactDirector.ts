import type { Texture } from "pixi.js";
import type { GameEvent } from "../engine/events";
import type { Combatant } from "../entities/types";
import type { Camera } from "./Camera";
import type { EmitOptions, ParticleSystem } from "./Particles";
import { FlashState, HitStopPolicy, type FlashSource, type FlashTarget, type HitClass } from "./hitStop";
import { hardCircle, softCircle, spark } from "./textures";
import { DEATH_COLLAPSE, DEATH_DISSOLVE, DEATH_LAUNCH, DEATH_SINK, type Rig } from "./rigs/Rig";
import { swingVariant } from "./rigs/pose";

type HitEvent = Extract<GameEvent, { type: "hit" }>;
type DeathEvent = Extract<GameEvent, { type: "death" }>;

/** Render-side state the director keeps on each entity view. */
export interface ImpactState {
  rig: Rig;
  /** Combo counter, incremented on `attack_swing`. */
  swings: number;
  /** An `attack_swing` from this entity arrived in the current event batch. */
  swungThisBatch: boolean;
  lastHitCrit: boolean;
  lastHitHeavy: boolean;
  lastHitAbility: boolean;
  lastHitElement: string;
  lastHitDir: 1 | -1;
  /** The impact flash (seconds of white or tint left; see FlashState). */
  flash: FlashState;
  /** Squash (0..1) and slide (rig units, signed) from the last impact; both decay. */
  squash: number;
  slide: number;
}

export interface ImpactHost {
  readonly camera: Camera;
  readonly particles: ParticleSystem;
  views: Map<number, ImpactState>;
  reduced: boolean;
  /** Battle speed (1 or 2): stops shorten at 2x. */
  speed(): number;
  /** Apply a granted global hit-stop (seconds) to the game loop and the renderer. */
  freeze(seconds: number): void;
  /** Local hit-stop: hold this entity's drawn pose and position for `seconds` (the sim runs on). */
  hold(id: number, seconds: number): void;
  /** Screen position of an entity's chest, in base px. */
  chest(e: Combatant, out: { x: number; y: number }): void;
  /** Screen position of an entity's feet, in base px. */
  feet(e: Combatant, out: { x: number; y: number }): void;
  /** Pixels per rig unit at this entity's depth (for slides). */
  scaleAt(e: Combatant): number;
  /** Visual effects the director asks for. */
  starFlash(x: number, y: number, size: number, color: number): void;
  shockRing(x: number, y: number, r: number, color: number): void;
  crimsonPulse(): void;
  entity(id: number): Combatant | undefined;
  playerId(): number;
}

const CONE = (70 * Math.PI) / 180;

/**
 * Turns `hit` and `death` events into the feel of a blow: hit-stop through the one policy, camera
 * kick, punch and trauma, directional sparks along the swing, and the target's reaction (squash,
 * slide and a white silhouette for a frame or two). Kept separate so the impact table in the
 * blueprint lives in one place.
 */
export class ImpactDirector {
  readonly policy = new HitStopPolicy();
  private readonly p = { x: 0, y: 0 };
  private readonly q = { x: 0, y: 0 };
  /** Real time (seconds), advanced by the renderer. */
  now = 0;
  /**
   * Scales the camera kick of the warrior's blows. The Ascendant Fury sets it to 0: its blinks
   * strike from alternating sides, and the camera holds the whole fight instead.
   */
  kickScale = 1;
  private readonly emitOpts: EmitOptions = { x: 0, y: 0, count: 0, texture: undefined as unknown as Texture, color: 0, speed: [0, 0], angle: [0, 0], life: [0, 0], scale: [0, 0], endScale: 0, alpha: 1, spin: 0, additive: true, gravity: 0, drag: 0.9 };

  constructor(private readonly host: ImpactHost) {}

  setReduced(v: boolean): void {
    this.policy.reduced = v;
  }

  /** An `attack_swing`: count the combo. */
  onSwing(id: number): void {
    const v = this.host.views.get(id);
    if (!v) return;
    v.swings += 1;
    v.swungThisBatch = true;
  }

  /** Authored freezes from the simulation always play but use up the window. */
  onAuthoredFreeze(seconds: number): void {
    this.policy.note(seconds, this.now);
  }

  /** A global stop through the policy (ability impacts authored by the renderer). */
  stop(seconds: number, key: string, cooldown: number): number {
    const granted = this.policy.request(seconds, this.now, key, cooldown);
    if (granted > 0) this.host.freeze(granted);
    return granted;
  }

  /**
   * Resolve a hit class: hold the bodies involved locally, and freeze the world when the class
   * calls for it (cooldown by key, capped).
   */
  private impact(cls: HitClass, a: number, b: number, key: string, cooldown: number): void {
    const r = this.policy.resolve(cls, this.now, this.host.speed(), key, cooldown);
    if (r.local > 0) {
      if (a >= 0) this.host.hold(a, r.local);
      if (b >= 0) this.host.hold(b, r.local);
    }
    if (r.global > 0) this.host.freeze(r.global);
  }

  onHit(e: HitEvent): void {
    const h = this.host;
    const target = h.entity(e.targetId);
    if (!target) return;
    const src = h.entity(e.sourceId);
    const tv = h.views.get(e.targetId);
    const sv = h.views.get(e.sourceId);
    const player = h.playerId();
    const dir: 1 | -1 = src ? (target.pos.x >= src.pos.x ? 1 : -1) : target.facing === 1 ? -1 : 1;
    const byWarrior = e.sourceId === player && e.faction === "enemy";
    const byArmy = src?.kind === "summon" && e.faction === "enemy";
    const onWarrior = e.targetKind === "player";
    // A warrior hit without a swing in this batch came from an ability.
    const ability = byWarrior && !(sv?.swungThisBatch ?? false);
    if (tv) {
      tv.lastHitCrit = e.crit;
      tv.lastHitHeavy = e.heavy;
      tv.lastHitAbility = ability || (e.element !== "physical" && !sv?.swungThisBatch);
      tv.lastHitElement = e.element;
      tv.lastHitDir = dir;
      // The flash is time-based and decided by one rule (FlashState): bosses and elites only go
      // fully white on a warrior crit, heavy or ability hit, the army never whitens anything.
      const tcls: FlashTarget = onWarrior ? "warrior" : target.kind === "boss" || !!target.enemy?.elite ? "boss" : target.faction === "ally" ? "ally" : "foe";
      const scls: FlashSource = byWarrior ? "warrior" : byArmy ? "army" : "other";
      tv.flash.hit(tcls, scls, e.crit, e.heavy || ability, this.now);
    }
    h.chest(target, this.p);
    const x = this.p.x;
    const y = this.p.y;
    // Spark direction follows the swing: down for a forehand or overhead, up for the backhand.
    let ang = dir === 1 ? 0 : Math.PI;
    if (sv && src && sv.rig.meleeKit === "combo") {
      const variant = swingVariant(sv.swings, "attack");
      const tilt = variant === 0 ? 0.35 : variant === 1 ? -0.4 : 0.65;
      ang += dir * tilt;
    } else if (sv && sv.rig.meleeKit === "heavy") ang += dir * 0.6;

    if (byWarrior) {
      if (ability || e.heavy) {
        // Ability impacts hold the targets, not the caster; a heavy basic holds both.
        this.impact("heavy", ability ? -1 : e.sourceId, e.targetId, "w-heavy", 0.1);
        if (this.cool("kick-heavy", 0.08)) {
          h.camera.kick(dir * 9 * this.kickScale, 2 * this.kickScale);
          h.camera.shake(0.25);
        }
        this.react(tv, target, dir, 0.08, 14, 2);
        this.dust(target);
        this.sparks(x, y, ang, e.crit ? 10 : 6, e.crit ? 0xe9c97a : elementColor(e.element), 1);
      } else if (e.crit) {
        this.impact("crit", e.sourceId, e.targetId, "w-crit", 0.09);
        h.camera.kick(dir * 7 * this.kickScale, 1.5 * this.kickScale);
        h.camera.punch(0.025);
        this.react(tv, target, dir, 0.1, 10, 2);
        this.sparks(x, y, ang, 12, 0xe9c97a, 1.25);
        h.starFlash(x, y, 1.0, 0xfff1c9);
        h.shockRing(x, y, 46, 0xe9c97a);
      } else {
        this.impact("normal", e.sourceId, e.targetId, "w-hit", 0);
        h.camera.kick(dir * 3 * this.kickScale, 0.8 * this.kickScale);
        this.react(tv, target, dir, 0.06, 4, 1);
        this.sparks(x, y, ang, 5, elementColor(e.element), 0.9);
        this.flashDisc(x, y, 0.9, elementColor(e.element));
      }
      return;
    }
    if (onWarrior) {
      const heavy = e.heavy;
      this.impact(heavy ? "takenHeavy" : "taken", e.targetId, e.sourceId, "taken", 0.25);
      h.camera.shake(heavy ? 0.45 : 0.2);
      h.crimsonPulse();

      this.sparks(x, y, ang, heavy ? 8 : 4, 0xd95a66, 0.8);
      return;
    }
    if (byArmy) {
      this.react(tv, target, dir, 0.04, 2, 1);
      this.sparks(x, y, ang, 3, e.crit ? 0xe9c97a : 0xbfe9d8, 0.7);
      return;
    }
    // Enemy hits on the army, burns, volatile bursts.
    this.react(tv, target, dir, 0.04, 2, e.faction === "ally" ? 1 : 0);
    if (!this.host.reduced) this.sparks(x, y, ang, 3, elementColor(e.element), 0.7);
  }

  /** A death: pick its presentation from the killing blow. Returns the variant chosen. */
  onDeath(e: DeathEvent): number {
    const h = this.host;
    const v = h.views.get(e.id);
    const target = h.entity(e.id);
    if (!v) return DEATH_COLLAPSE;
    let variant = DEATH_COLLAPSE;
    if (e.kind === "summon") variant = DEATH_SINK;
    else if (e.kind !== "boss") {
      if (v.lastHitAbility || v.lastHitElement === "fire") variant = DEATH_DISSOLVE;
      else if (v.lastHitCrit || v.lastHitHeavy) variant = DEATH_LAUNCH;
    }
    v.rig.setDeath(variant, v.lastHitDir, (target?.seed ?? 0.5) * 97 + e.id);
    if (e.killerId === h.playerId() && e.kind !== "summon") {
      // The victim holds a beat longer before its death plays; elites also stop the world.
      this.impact(e.elite ? "eliteKill" : "kill", -1, e.id, "kill", 0.06);
      if (this.cool("kick-kill", 0.06)) h.camera.kick(v.lastHitDir * 5 * this.kickScale, this.kickScale);
    }
    if (variant === DEATH_DISSOLVE && target) {
      h.chest(target, this.p);
      const o = this.emitOpts;
      o.x = this.p.x;
      o.y = this.p.y;
      o.count = this.host.reduced ? 6 : 14;
      o.texture = hardCircle();
      o.color = elementColor(v.lastHitElement === "physical" ? "soul" : v.lastHitElement);
      o.speed = [40, 110];
      o.angle = [-Math.PI * 0.85, -Math.PI * 0.15];
      o.life = [0.35, 0.6];
      o.scale = [0.12, 0.3];
      o.endScale = 0;
      o.alpha = 0.95;
      o.spin = 0;
      o.additive = true;
      o.gravity = -120;
      o.drag = 0.92;
      o.spread = 26 * h.scaleAt(target);
      h.particles.emit(o);
      o.spread = 0;
    }
    return variant;
  }

  /** A boss changes phase: the world stops briefly. */
  phase(): void {
    this.impact("phase", -1, -1, "phase", 1);
  }

  /** The landing beat of a launched body. */
  onLanded(e: Combatant): void {
    this.dust(e, true);
    this.host.camera.shake(0.15);
  }

  private readonly cooldowns = new Map<string, number>();

  private cool(key: string, seconds: number): boolean {
    const last = this.cooldowns.get(key);
    if (last !== undefined && this.now - last < seconds) return false;
    this.cooldowns.set(key, this.now);
    return true;
  }

  private react(v: ImpactState | undefined, target: Combatant, dir: 1 | -1, squash: number, slide: number, _white: number): void {
    void _white;
    if (!v || target.dead) return;
    v.squash = Math.max(v.squash, squash);
    v.slide = dir * Math.max(Math.abs(v.slide), slide);
  }

  private sparks(x: number, y: number, ang: number, count: number, color: number, size: number): void {
    const o = this.emitOpts;
    o.x = x;
    o.y = y;
    o.count = count;
    o.texture = spark();
    o.color = color;
    o.speed = [110 * size, 300 * size];
    o.angle = [ang - CONE / 2, ang + CONE / 2];
    o.life = [0.12, 0.3];
    o.scale = [0.45 * size, 1.0 * size];
    o.endScale = 0.1;
    o.alpha = 1;
    o.spin = 0;
    o.additive = true;
    o.gravity = 260;
    o.drag = 0.86;
    o.alignToVelocity = true;
    this.host.particles.emit(o);
    o.alignToVelocity = false;
  }

  private flashDisc(x: number, y: number, size: number, color: number): void {
    const o = this.emitOpts;
    o.x = x;
    o.y = y;
    o.count = 1;
    o.texture = softCircle();
    o.color = color;
    o.speed = [0, 0];
    o.angle = [0, 0];
    o.life = [0.08, 0.12];
    o.scale = [size, size * 1.2];
    o.endScale = 0.2;
    o.alpha = 0.85;
    o.spin = 0;
    o.gravity = 0;
    o.additive = true;
    this.host.particles.emit(o);
  }

  /** Dust kicked up at the feet: a slide or a landing. */
  dust(e: Combatant, big = false): void {
    const h = this.host;
    h.feet(e, this.q);
    const o = this.emitOpts;
    o.x = this.q.x;
    o.y = this.q.y;
    o.count = big ? 10 : 4;
    o.texture = softCircle();
    o.color = 0x9a8f80;
    o.speed = [20, big ? 110 : 70];
    o.angle = [-Math.PI, 0];
    o.life = [0.3, 0.6];
    o.scale = [0.2, big ? 0.55 : 0.4];
    o.endScale = 0.7;
    o.alpha = 0.45;
    o.spin = 0;
    o.gravity = 60;
    o.drag = 0.9;
    o.additive = false;
    h.particles.emit(o);
  }

  reset(): void {
    this.policy.reset();
    this.cooldowns.clear();
  }
}

export function elementColor(element: string, crit = false): number {
  if (crit) return 0xe9c97a;
  switch (element) {
    case "lightning":
      return 0xa8c4e6;
    case "fire":
      return 0xe0954f;
    case "void":
      return 0xc6a6e8;
    case "soul":
      return 0x8fe0c4;
    default:
      return 0xf0eadc;
  }
}

export { DEATH_LAUNCH, DEATH_DISSOLVE, DEATH_COLLAPSE };
