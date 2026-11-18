import type { Container, Graphics, Sprite, Texture } from "pixi.js";
import type { GameEvent } from "../../engine/events";
import type { Vec2 } from "../../engine/math";
import type { EvolutionId, MasteryTier, SignatureId } from "../../data/signatures";
import type { Rig } from "../rigs/Rig";
import type { SigKit } from "./kit";
import type { SigBody, SigHost, BodyMod } from "./host";
import type { FxProfile } from "./quality";
import type { SigPalette } from "./palette";
import type { Dragon, DragonLook } from "./skills/dragon";

export type SigCastEvent = Extract<GameEvent, { type: "sig_cast" }>;
export type SigBeatEvent = Extract<GameEvent, { type: "sig_beat" }>;
export type SigSynergyEvent = Extract<GameEvent, { type: "sig_synergy" }>;
export type SigHitEvent = Extract<GameEvent, { type: "hit" }>;

/** What the director lends a stage besides the kit: body modifiers and shared memory. */
export interface StageServices {
  /** The modifier record of a body (created on demand; the director clears it when idle). */
  mod(id: number): BodyMod;
  /** Kills that fed Void Collapse's Consumption since its last cast (0 to 5). */
  consumed: number;
  /** A combination's name on the field (once per fight). */
  label(text: string, x: number, y: number, color: number): void;
  /** Whether a body carries another skill's mark (void, shadow, trapped, slowed). */
  hasMark(id: number): boolean;
  /** The dragon (at most two exist; reused), and its return. */
  dragon(look: DragonLook): Dragon | null;
  freeDragon(d: Dragon): void;
}

/** Chest of a standard figure, in rig units (as the renderer's). */
export const CHEST = 50;

/**
 * One signature cast on the field: it reacts to the cast's beats (sent at the world moments they
 * happen) and animates in between. Damage is never its business: it only stages what the events say.
 * Everything it takes from the kit's pools it returns in `dispose`.
 */
export abstract class Stage {
  readonly castId: number;
  readonly sig: SignatureId;
  readonly evo: EvolutionId | null;
  readonly mastery: MasteryTier;
  readonly enhanced: boolean;
  readonly cast: SigCastEvent;
  /** World seconds since the cast. */
  t = 0;
  ended = false;
  interrupted = false;
  /** Seconds since `sig_end` (the aftermath plays out). */
  sinceEnd = 0;
  /** Seconds the aftermath may run past `sig_end` before the stage is dropped. */
  tail = 0.8;
  /** Counted against the cinematic cap while true. */
  cinematic = false;
  private readonly sprites: Sprite[] = [];
  private readonly rigs: Rig[] = [];
  private readonly gfx: Graphics[] = [];
  private readonly boxes: Container[] = [];
  protected readonly b: SigBody = { x: 0, y: 0, chestY: 0, height: 0, scale: 1, wx: 0, wy: 0, facing: 1, boss: false, ally: false, player: false, rig: null };
  protected readonly p = { x: 0, y: 0 };
  protected readonly q = { x: 0, y: 0 };

  constructor(
    protected readonly kit: SigKit,
    protected readonly host: SigHost,
    protected readonly svc: StageServices,
    protected readonly pal: SigPalette,
    e: SigCastEvent,
    /** Past the caps: the compact form (key silhouette and impact only). */
    readonly compact: boolean,
  ) {
    this.castId = e.castId;
    this.sig = e.sig;
    this.evo = e.evo;
    this.mastery = e.mastery;
    this.enhanced = e.enhanced;
    this.cast = e;
  }

  get profile(): FxProfile {
    return this.kit.profile;
  }

  /** Master or above: the evolution's second layer. */
  get master(): boolean {
    return this.mastery >= 2;
  }

  /** Grandmaster: the gilded look. */
  get gilded(): boolean {
    return this.mastery >= 3;
  }

  /** Full staging: not compact, and the quality keeps secondary layers. */
  get rich(): boolean {
    return !this.compact && this.profile.secondary;
  }

  abstract onBeat(e: SigBeatEvent): void;
  onSynergy(e: SigSynergyEvent): void {
    void e;
  }
  onHit(e: SigHitEvent): void {
    void e;
  }
  onDeath(id: number, x: number, y: number): void {
    void id;
    void x;
    void y;
  }

  onEnd(interrupted: boolean): void {
    this.ended = true;
    this.interrupted = interrupted;
  }

  /** Advance: `dt` world seconds (zero in a hit-stop), `real` real seconds. */
  abstract update(dt: number, real: number): void;

  /** Draw this frame's geometry into the kit's graphics (called after `update`). */
  paint(): void {}

  /**
   * Where the camera must look while this cast plays (base px: its ground point and the top of what
   * it draws above it), or false when the warrior's own framing already holds it. Area skills aimed
   * at a knot of foes far from the warrior (a singularity, a clock, a judgement, a volley) would
   * otherwise play at, or past, the edge of a portrait screen.
   */
  focus(out: { x: number; y: number; top: number }): boolean {
    void out;
    return false;
  }

  /** The default focus: the cast's centre on the ground and `lift` world-scaled px above it. */
  protected centreFocus(out: { x: number; y: number; top: number }, lift: number): boolean {
    const pr = this.host.proj;
    const c = this.cast.center;
    out.x = pr.sx(c.x);
    out.y = pr.sy(c.y);
    out.top = out.y - lift * pr.fs(c.y);
    return true;
  }

  get finished(): boolean {
    return this.ended && this.sinceEnd >= this.tail;
  }

  /** Called once per frame by the director before `update`. */
  tick(dt: number, real: number): void {
    this.t += dt;
    if (this.ended) this.sinceEnd += real;
    this.update(dt, real);
  }

  // ---------------------------------------------------------------- helpers

  /** Feet of a world point, in base px (into `out`). */
  ground(w: Vec2, out: { x: number; y: number }): { x: number; y: number } {
    const pr = this.host.proj;
    out.x = pr.sx(w.x);
    out.y = pr.sy(w.y);
    return out;
  }

  /** Chest of a standard figure at a world point (base px). */
  chestAt(w: Vec2, out: { x: number; y: number }): { x: number; y: number } {
    const pr = this.host.proj;
    out.x = pr.sx(w.x);
    out.y = pr.sy(w.y) - CHEST * pr.fs(w.y);
    return out;
  }

  /** Px per world unit across, times the figure scale at mid depth (a size unit for effects). */
  get u(): number {
    return this.host.proj.unit();
  }

  /** A body as drawn, or false when gone (then `b` keeps whatever it held). */
  body(id: number): boolean {
    return this.host.body(id, this.b);
  }

  sprite(layer: Container, tex: Texture, add: boolean): Sprite | null {
    const s = this.kit.sprite(layer, tex, add);
    if (s) this.sprites.push(s);
    return s;
  }

  graphics(layer: Container, add = false): Graphics {
    const g = this.kit.graphics(layer, add);
    this.gfx.push(g);
    return g;
  }

  container(layer: Container): Container {
    const c = this.kit.container(layer);
    this.boxes.push(c);
    return c;
  }

  rig(key: string, spec: Parameters<SigKit["rig"]>[1]): Rig | null {
    const r = this.kit.rig(key, spec, 0, 1);
    if (r) this.rigs.push(r);
    return r;
  }

  releaseRig(r: Rig | null): void {
    if (!r) return;
    const i = this.rigs.indexOf(r);
    if (i >= 0) this.rigs.splice(i, 1);
    this.kit.freeRig(r);
  }

  /** Return every lent sprite and rig. Subclasses that own more call super. */
  dispose(): void {
    for (const s of this.sprites) this.kit.free(s);
    this.sprites.length = 0;
    for (const r of this.rigs) this.kit.freeRig(r);
    this.rigs.length = 0;
    for (const g of this.gfx) this.kit.freeGraphics(g);
    this.gfx.length = 0;
    for (const c of this.boxes) this.kit.freeContainer(c);
    this.boxes.length = 0;
  }
}

/** Ease helpers kept local to the stages. */
export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
export const span01 = (t: number, a: number, b: number): number => (b <= a ? (t >= b ? 1 : 0) : clamp01((t - a) / (b - a)));
