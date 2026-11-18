import type { Container } from "pixi.js";
import type { Camera } from "../Camera";
import type { DamageNumbers } from "../DamageNumbers";
import type { ParticleSystem } from "../Particles";
import type { Rig, RigSpec } from "../rigs/Rig";

/** A body as the signature presentation sees it (base px, as last drawn). */
export interface SigBody {
  /** Feet. */
  x: number;
  y: number;
  /** Chest height above the feet's y (base px), and drawn height. */
  chestY: number;
  height: number;
  /** Px per rig unit at its depth. */
  scale: number;
  /** World position. */
  wx: number;
  wy: number;
  facing: 1 | -1;
  boss: boolean;
  ally: boolean;
  player: boolean;
  rig: Rig | null;
}

/**
 * What the signature presentation may ask of the body it is drawn on (a world body, or a stand-in in
 * the preview): applied by the host each frame after the body's own pose. Visual only.
 */
export interface BodyMod {
  /** Wash toward `tint` by `tintK` (0 to 1). */
  tint: number;
  tintK: number;
  /** A white rim (glass, a crown's light): 0 to 1. */
  white: number;
  /** Hold the pose (time stopped). */
  frozen: boolean;
  /** Pose the army kneeling (Sovereign Awakening). */
  kneel: boolean;
  /** Drawn offset (base px) and a lean/stretch toward a point (space bending). */
  dx: number;
  dy: number;
  stretch: number;
  /** -1 or 1: which way the body leans. */
  lean: number;
  /** Multiplies the body's alpha (the warrior vanishing into Death Parade). */
  alpha: number;
}

export function blankMod(): BodyMod {
  return { tint: 0xffffff, tintK: 0, white: 0, frozen: false, kneel: false, dx: 0, dy: 0, stretch: 0, lean: 0, alpha: 1 };
}

export interface SigLayers {
  /** On the ground, under the figures (rune circles, pools, shockwaves). */
  readonly ground: Container;
  /** Sorted with the fighters by depth (clones, soldiers, afterimages). */
  readonly figures: Container;
  /** Above the figures (the singularity, the dragon, blades, light). */
  readonly fx: Container;
}

/** World to base px, and figure sizes, for the field the director draws on. */
export interface SigProjection {
  sx(x: number): number;
  sy(y: number): number;
  /** Px per rig unit of a figure standing at depth `y`. */
  fs(y: number): number;
  /** Base px per world unit across. */
  unit(): number;
  /** Base px per world unit of depth (ground ellipses are squashed by dy / unit). */
  dy(): number;
  /** The top of the visible frame (base px). */
  top(): number;
  /** The visible frame's left and right (base px). */
  left(): number;
  right(): number;
}

/**
 * The signature director's host (the battle renderer, or the preview sandbox). It hands in the
 * layers, particles, camera, flash budget and bodies; the director never touches the world.
 */
export interface SigHost {
  readonly particles: ParticleSystem;
  readonly camera: Camera;
  readonly layers: SigLayers;
  readonly proj: SigProjection;
  isReduced(): boolean;
  /** The body with this id as last drawn; false when it has gone. */
  body(id: number, out: SigBody): boolean;
  playerId(): number;
  /** The warrior's rig spec (afterimages and the returning cut wear it). */
  playerSpec(): RigSpec;
  /** A full-screen flash through the flash budget; false when refused. */
  flash(color: number, alpha: number, duration: number): boolean;
  /** The backdrop sinks toward `color` by `amount` (0 to 1) and settles back by itself. */
  darken(color: number, amount: number): void;
  /** A world stop (hit-stop) through the one policy; returns the seconds granted. */
  stop(seconds: number, key: string, cooldown: number): number;
  /** Hold one body's drawn pose for a moment (a local hit-stop). */
  hold(id: number, seconds: number): void;
  numbers(): DamageNumbers | null;
  /** Living bodies of a faction, for effects that touch every foe or the whole army (read-only). */
  each(faction: "enemy" | "ally", fn: (id: number) => void): void;
}
