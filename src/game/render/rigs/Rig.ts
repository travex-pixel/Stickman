import { Container, Graphics, GraphicsContext } from "pixi.js";
import type { ActionState } from "../../entities/types";
import { darken, lighten } from "../colors";
import { clamp } from "../../engine/math";
import { damp, easeInCubic, easeOutCubic, rand2, span } from "../anim/ease";
import { CHANNELS, Ch, computePose, meleeKit, snapsOnEnter, stateLambda, strikeWindow, type BodyStyle, type IdleRole, type MeleeKit, type Pose, type PoseInput, type WeaponType } from "./pose";

export type { BodyStyle, WeaponType } from "./pose";

export interface RigSpec {
  style: BodyStyle;
  weapon: WeaponType;
  body: number;
  accent: number;
  eye: number;
  glow?: number;
  /** Overall height in world units at scale 1. */
  height: number;
  cape?: boolean;
  hood?: boolean;
  horns?: boolean;
  /** A gilded crown on the head (the Crownless King and its court). */
  crown?: boolean;
  aura?: number;
  floating?: boolean;
  /** ivory = the hero, ink = enemies, shadow = the player's summoned army. */
  finish?: "ivory" | "ink" | "shadow";
  /** The army's role idle. */
  idle?: IdleRole;
}

/** Blade length (rig units at scale 1) by weapon, for trails. */
const BLADE: Record<WeaponType, number> = { sword: 50, greatsword: 70, dagger: 25, twin: 31, scythe: 62, banner: 76, club: 62, mace_shield: 53, tower: 36, staff: 64, bow: 34, none: 18 };

/**
 * Drawn parts are shared by every rig of the same spec: the first rig of a kind draws its parts
 * into contexts kept here, later ones reuse them, so spawning a pack builds no geometry and the
 * GPU keeps one copy per kind. White impact copies are cached per part the same way.
 */
const PART_CACHE = new Map<string, GraphicsContext[]>();
const WHITE_CACHE = new WeakMap<GraphicsContext, GraphicsContext>();
const WHITE_LIST: GraphicsContext[] = [];

/** Release every shared part (the renderer calls this when it unmounts). */
export function clearRigCache(): void {
  for (const list of PART_CACHE.values()) for (const c of list) c.destroy();
  PART_CACHE.clear();
  for (const c of WHITE_LIST) c.destroy();
  WHITE_LIST.length = 0;
}

/** Shared part contexts currently cached, for diagnostics. */
export function rigCacheSize(): number {
  let n = WHITE_LIST.length;
  for (const list of PART_CACHE.values()) n += list.length;
  return n;
}

function whiteOf(ctx: GraphicsContext): GraphicsContext {
  let w = WHITE_CACHE.get(ctx);
  if (w) return w;
  w = ctx.clone();
  w.instructions = w.instructions.map((ins) => {
    const data = ins.data as unknown as { style?: { color: number; alpha: number } };
    if (!data.style) return ins;
    const alpha = data.style.alpha >= 0.5 ? 1 : data.style.alpha;
    return { ...ins, data: { ...ins.data, style: { ...data.style, color: 0xffffff, alpha } } } as typeof ins;
  });
  WHITE_CACHE.set(ctx, w);
  WHITE_LIST.push(w);
  return w;
}

/** Death presentation, chosen by the killing blow. */
export const DEATH_COLLAPSE = 0;
export const DEATH_LAUNCH = 1;
export const DEATH_DISSOLVE = 2;
/** The army's fall: the shadow sinks down into its pool (and re-forms from it on return). */
export const DEATH_SINK = 3;
/** A boss's kneel before it breaks (the death sequence drives the rest). */
export const DEATH_KNEEL = 4;

/**
 * Procedural humanoid rig built from container "bones". Each body part is drawn once, then
 * animated purely with transforms. Poses are targets: every channel is blended toward its target
 * with frame-rate independent damping, so state changes flow instead of popping. The origin is at
 * the feet, so the rig stands on its shadow and squash and sink read from the ground up.
 */
export class Rig {
  readonly root = new Container();
  private readonly body = new Container();
  private readonly hips = new Container();
  private readonly torso = new Container();
  private readonly head = new Container();
  private eyes!: Graphics;
  private readonly armL = { upper: new Container(), lower: new Container() };
  private readonly armR = { upper: new Container(), lower: new Container() };
  private readonly legL = { upper: new Container(), lower: new Container() };
  private readonly legR = { upper: new Container(), lower: new Container() };
  private readonly weapon = new Container();
  private weaponGlow!: Graphics;
  private cape!: Graphics;
  private aura!: Graphics;
  shadow!: Graphics;
  /** Shared part contexts for this spec, and the next one to hand out while building. */
  private parts: GraphicsContext[] = [];
  private partIndex = 0;
  private partsCached = false;
  private eyeY = 0;
  private headR = 0;
  private readonly target: Pose = new Float32Array(CHANNELS);
  private readonly current: Pose = new Float32Array(CHANNELS);
  private readonly input: PoseInput;
  private readonly kit: MeleeKit;
  private readonly flashParts: Graphics[] = [];
  private readonly flashOrig: Graphics[] = [];
  private readonly u: number;
  private spec: RigSpec;
  private fresh = true;
  private lastState: ActionState | null = null;
  private clock = 0;
  private capeAngle = 0;
  private blinkIn = 0;
  private blinkLeft = 0;
  private blinks = 0;
  private flashOn = false;
  private flashLevel = 1;
  private legLen = 0;
  private upperLeg = 0;
  private lowerLeg = 0;
  /** Lead-foot plant during the strike: the sole's ground point (parent space) and its weight. */
  private plantX = 0;
  private plantY = 0;
  private planted = false;
  private plantW = 0;
  private torsoH = 0;
  private armX = 0;
  private upperArm = 0;
  private lowerArm = 0;
  private bladeLen = 0;
  /** Height of the figure from the feet to the top of the head, in rig-local units. */
  top = 0;
  /** Horizontal drift of a launched body (rig-local units), so its shadow and pool follow it. */
  deathShiftX = 0;
  /** Ground shadow scale factor (the ink pool during a death). The renderer applies it. */
  poolScale = 1;
  private death = DEATH_COLLAPSE;
  private deathDir: 1 | -1 = 1;
  private deathDist = 50;
  private squash = 0;
  private lean = 0;
  private hitAmount = 0;
  private pushed: 1 | -1 | 0 = 0;
  private capeWhite: Graphics | null = null;

  constructor(spec: RigSpec) {
    this.spec = spec;
    this.u = spec.height / 100;
    this.kit = meleeKit(spec.style, spec.weapon);
    this.input = { style: spec.style, kit: this.kit, state: "idle", t: 0, duration: 0, seed: 0, clock: 0, speedFrac: 0, variant: 0, death: 0, idle: spec.idle ?? "" };
    const key = JSON.stringify(spec);
    const cached = PART_CACHE.get(key);
    if (cached) {
      this.parts = cached;
      this.partsCached = true;
    } else PART_CACHE.set(key, this.parts);
    this.build();
  }

  /**
   * A body part: drawn by `draw` the first time this spec is built, reused afterwards. Parts must
   * be requested in the same order on every build of a spec (the build is deterministic).
   */
  private part(draw: (c: GraphicsContext) => void): Graphics {
    let ctx = this.partsCached ? this.parts[this.partIndex] : undefined;
    if (!ctx) {
      ctx = new GraphicsContext();
      draw(ctx);
      this.parts[this.partIndex] = ctx;
    }
    this.partIndex += 1;
    return new Graphics(ctx);
  }

  get unit(): number {
    return this.u;
  }

  get meleeKit(): MeleeKit {
    return this.kit;
  }

  private build(): void {
    const s = this.spec;
    const u = this.u;
    const style = s.style;
    const finish = s.finish ?? "ink";
    // Flat silhouettes read best at phone scale. The far-side limbs are a half-step off the body
    // colour so the figure keeps depth without outlines.
    const body = s.body;
    const far = finish === "ivory" ? darken(body, 0.22) : lighten(body, 0.12);
    const bulky = style === "bulky" || style === "warden";
    const lean = style === "lean" || style === "reaper";
    const torsoW = (bulky ? 28 : lean ? 14 : 17) * u;
    const torsoH = (bulky ? 34 : 29) * u;
    const limbW = (bulky ? 10 : lean ? 5.5 : 6.5) * u;
    const upperArm = (bulky ? 18 : 15) * u;
    const lowerArm = (bulky ? 17 : 15) * u;
    const upperLeg = (bulky ? 18 : 17) * u;
    const lowerLeg = (bulky ? 17 : 17) * u;
    const headR = (bulky ? 9 : 8.2) * u;
    this.legLen = upperLeg + lowerLeg + 2.6 * u;
    this.upperLeg = upperLeg;
    this.lowerLeg = lowerLeg + 2.6 * u;
    this.top = this.legLen + torsoH + headR * 1.8;
    this.torsoH = torsoH;
    this.armX = torsoW * 0.36;
    this.upperArm = upperArm;
    this.lowerArm = lowerArm;

    // Ground shadow lives outside the body so it never rotates with it.
    this.shadow = this.part((c) => c.ellipse(0, 0, (bulky ? 26 : 17) * u, (bulky ? 8 : 5.5) * u).fill({ color: 0x0a0806, alpha: 0.38 }));

    // Shadow-army glow: a soft pool of light under summons, ring for evolved and legendary forms.
    this.aura = this.part((c) => {
      if (finish === "shadow") c.ellipse(0, 0, 22 * u, 7 * u).fill({ color: s.glow ?? s.eye, alpha: 0.12 });
      if (s.aura && s.aura > 0) c.ellipse(0, 0, s.aura * u * 1.1, s.aura * u * 0.36).stroke({ width: 1.6 * u, color: s.glow ?? s.accent, alpha: 0.5 });
    });
    if (finish === "shadow" || (s.aura && s.aura > 0)) this.root.addChild(this.aura);

    this.root.addChild(this.body);
    this.body.addChild(this.hips);

    // The Oathbound carry a thin gold edge so they read against both the ink horde and the ground.
    const edge = finish === "shadow" ? { width: 1.1 * u, color: s.accent, alpha: 0.55 } : null;
    const limbShape = (g: GraphicsContext, len: number, w: number, color: number, taper: number) => {
      if (edge) {
        g.poly([-w / 2, 0, w / 2, 0, (w / 2) * taper, len, (-w / 2) * taper, len]).stroke(edge);
      }
      g.poly([-w / 2, 0, w / 2, 0, (w / 2) * taper, len, (-w / 2) * taper, len])
        .fill(color)
        .circle(0, 0, w / 2)
        .fill(color)
        .circle(0, len, (w / 2) * taper)
        .fill(color);
    };
    const limb = (len: number, w: number, color: number, taper = 0.82) => this.part((g) => limbShape(g, len, w, color, taper));

    const leg = (side: { upper: Container; lower: Container }, x: number, color: number) => {
      side.upper.addChild(limb(upperLeg, limbW * 1.05, color));
      const low = this.part((g) => {
        limbShape(g, lowerLeg, limbW * 0.9, color, 0.9);
        // Foot: a small wedge pointing forward gives the stance weight.
        g.poly([-limbW * 0.4, lowerLeg - 1 * u, limbW * 1.3, lowerLeg + 0.5 * u, limbW * 1.1, lowerLeg + 2.6 * u, -limbW * 0.5, lowerLeg + 2.6 * u]).fill(color);
      });
      side.lower.addChild(low);
      side.lower.y = upperLeg;
      side.upper.addChild(side.lower);
      side.upper.x = x;
      this.hips.addChild(side.upper);
    };
    leg(this.legL, -torsoW * 0.22, far);
    leg(this.legR, torsoW * 0.22, body);

    // Cape / scarf: the warrior's only colour accent besides the blade.
    const capeColor = finish === "ivory" ? s.accent : darken(s.accent, 0.55);
    this.cape = this.part((c) => {
      if (s.cape) c.poly([-torsoW * 0.42, 0, torsoW * 0.3, 0, -torsoW * 0.2, torsoH * 1.45, -torsoW * 0.95, torsoH * 1.3]).fill({ color: capeColor, alpha: finish === "ivory" ? 0.95 : 0.85 });
    });
    this.cape.y = -torsoH * 0.95;

    this.hips.addChild(this.torso);
    const torsoG = this.part((torsoG) => {
    if (style === "robed") {
      torsoG.poly([-torsoW * 0.5, -torsoH, torsoW * 0.5, -torsoH, torsoW * 1.05, torsoH * 0.95, -torsoW * 1.05, torsoH * 0.95]).fill(body);
      torsoG.poly([-torsoW * 0.08, -torsoH * 0.7, torsoW * 0.08, -torsoH * 0.7, torsoW * 0.16, torsoH * 0.9, -torsoW * 0.16, torsoH * 0.9]).fill({ color: s.accent, alpha: 0.55 });
    } else if (bulky) {
      torsoG.poly([-torsoW * 0.62, -torsoH, torsoW * 0.62, -torsoH, torsoW * 0.38, 0, -torsoW * 0.38, 0]).fill(body);
      torsoG.circle(-torsoW * 0.58, -torsoH * 0.9, torsoW * 0.26).fill(body);
      torsoG.circle(torsoW * 0.58, -torsoH * 0.9, torsoW * 0.26).fill(body);
      // A single ember core in the chest: the brute's one point of colour.
      torsoG.circle(0, -torsoH * 0.58, torsoW * 0.1).fill({ color: s.eye, alpha: 0.9 });
      torsoG.circle(0, -torsoH * 0.58, torsoW * 0.2).fill({ color: s.eye, alpha: 0.18 });
    } else {
      torsoG.poly([-torsoW * 0.5, -torsoH, torsoW * 0.5, -torsoH, torsoW * 0.32, 0, -torsoW * 0.32, 0]).fill(body);
      torsoG.circle(0, -torsoH, torsoW * 0.5).fill(body);
      if (finish === "ivory") {
        // Belt and sash: thin gold lines, nothing more.
        torsoG.rect(-torsoW * 0.36, -torsoH * 0.16, torsoW * 0.72, 2.2 * u).fill(s.accent);
        torsoG.poly([-torsoW * 0.46, -torsoH * 0.92, -torsoW * 0.32, -torsoH * 0.98, torsoW * 0.4, -torsoH * 0.2, torsoW * 0.26, -torsoH * 0.14]).fill({ color: s.accent, alpha: 0.85 });
      }
    }
    });
    if (edge) {
      // Trace the torso once more as an outline for the Oathbound's gilt edge.
      const outline = this.part((outline) => {
        if (style === "robed") outline.poly([-torsoW * 0.5, -torsoH, torsoW * 0.5, -torsoH, torsoW * 1.05, torsoH * 0.95, -torsoW * 1.05, torsoH * 0.95]).stroke(edge);
        else if (bulky) outline.poly([-torsoW * 0.62, -torsoH, torsoW * 0.62, -torsoH, torsoW * 0.38, 0, -torsoW * 0.38, 0]).stroke(edge);
        else outline.poly([-torsoW * 0.5, -torsoH, torsoW * 0.5, -torsoH, torsoW * 0.32, 0, -torsoW * 0.32, 0]).stroke(edge);
      });
      this.torso.addChild(outline);
    }
    if (s.cape) this.torso.addChild(this.cape);
    this.torso.addChild(torsoG);

    // Head
    this.head.y = -torsoH - headR * 0.75;
    const headG = this.part((headG) => {
    if (s.hood) {
      headG.poly([-headR * 1.15, headR * 1.0, -headR * 0.2, -headR * 1.6, headR * 1.15, headR * 1.0]).fill(body);
      headG.circle(headR * 0.1, headR * 0.15, headR * 0.72).fill(darken(body, 0.5));
    } else if (bulky) {
      headG.circle(0, 0, headR).fill(body);
      if (s.horns) {
        headG.poly([-headR * 0.7, -headR * 0.6, -headR * 1.9, -headR * 2.2, -headR * 0.15, -headR * 1.0]).fill(body);
        headG.poly([headR * 0.7, -headR * 0.6, headR * 1.9, -headR * 2.2, headR * 0.15, -headR * 1.0]).fill(body);
      }
    } else {
      headG.circle(0, 0, headR).fill(body);
      if (finish === "ivory") {
        // Swept hair: a single shape that gives the hero a recognisable profile.
        headG.poly([-headR * 1.0, -headR * 0.1, -headR * 0.6, -headR * 1.05, headR * 0.5, -headR * 1.1, headR * 1.05, -headR * 0.35, headR * 0.1, -headR * 0.55, -headR * 1.45, headR * 0.15]).fill(darken(body, 0.12));
      } else if (style === "reaper" || finish === "shadow") {
        headG.poly([-headR * 0.9, -headR * 0.4, -headR * 1.6, -headR * 1.2, -headR * 0.3, -headR * 0.9]).fill(body);
      }
    }
    if (s.crown) {
      // A tall broken crown: five gilt spikes, one snapped short.
      const gold = s.finish === "shadow" ? 0xd9b26a : 0xc9a24f;
      const cy = -headR * 0.85;
      headG
        .poly([
          -headR * 0.95, cy, -headR * 1.0, cy - headR * 1.1, -headR * 0.6, cy - headR * 0.55, -headR * 0.3, cy - headR * 1.35, 0, cy - headR * 0.6,
          headR * 0.3, cy - headR * 0.85, headR * 0.6, cy - headR * 0.5, headR * 1.0, cy - headR * 1.15, headR * 0.95, cy,
        ])
        .fill(gold);
      headG.rect(-headR * 0.95, cy - headR * 0.08, headR * 1.9, headR * 0.28).fill(darken(gold, 0.25));
    }
    });
    this.head.addChild(headG);
    // Eyes: the brightest pixels on every figure. Enemies glare, summons glow, the hero is calm.
    const eyeY = s.hood ? headR * 0.15 : -headR * 0.05;
    this.eyeY = eyeY;
    this.headR = headR;
    this.eyes = this.part((eyes) => {
      if (finish === "ivory") {
        eyes.roundRect(headR * 0.15, eyeY - headR * 0.1, headR * 0.5, headR * 0.2, headR * 0.1).fill(darken(body, 0.75));
      } else {
        eyes.poly([headR * 0.05, eyeY - headR * 0.18, headR * 0.75, eyeY - headR * 0.02, headR * 0.1, eyeY + headR * 0.12]).fill(s.eye);
        eyes.circle(headR * 0.4, eyeY, headR * 0.65).fill({ color: s.eye, alpha: finish === "shadow" ? 0.28 : 0.16 });
      }
    });
    this.head.addChild(this.eyes);
    this.torso.addChild(this.head);

    const arm = (side: { upper: Container; lower: Container }, x: number, color: number) => {
      side.upper.addChild(limb(upperArm, limbW, color));
      side.lower.addChild(limb(lowerArm, limbW * 0.88, color, 0.95));
      side.lower.y = upperArm;
      side.upper.addChild(side.lower);
      side.upper.x = x;
      side.upper.y = -torsoH * 0.92;
    };
    arm(this.armL, -torsoW * 0.36, far);
    arm(this.armR, torsoW * 0.36, body);
    this.torso.addChildAt(this.armL.upper, 0);
    this.torso.addChild(this.armR.upper);

    // Weapon in right hand (lower arm end)
    this.weapon.y = lowerArm;
    this.buildWeapon(limbW);
    this.armR.lower.addChild(this.weapon);


    this.applyPose();
  }

  private buildWeapon(limbW: number): void {
    const s = this.spec;
    const u = this.u;
    // The blade and its glow are two shared parts; `draw` fills whichever one is being built.
    const steel = s.finish === "ivory" ? 0xe7e2d6 : s.finish === "shadow" ? 0x5b5f86 : 0x3a3a40;
    const steelDark = s.finish === "ivory" ? 0x9a927f : 0x24242a;
    const accent = s.accent;
    this.bladeLen = BLADE[s.weapon] * u;
    const draw = (g: GraphicsContext, glow: GraphicsContext): void => {
    switch (s.weapon) {
      case "sword":
        g.rect(-1.6 * u, -44 * u, 3.2 * u, 46 * u).fill(steel);
        g.rect(-0.6 * u, -42 * u, 1.2 * u, 40 * u).fill({ color: accent, alpha: 0.9 });
        g.poly([-1.6 * u, -44 * u, 1.6 * u, -44 * u, 0, -50 * u]).fill(steel);
        g.rect(-6 * u, 0, 12 * u, 2.2 * u).fill(darken(accent, 0.3));
        g.rect(-1.4 * u, 2 * u, 2.8 * u, 7 * u).fill(0x2a2d3a);
        glow.rect(-4 * u, -46 * u, 8 * u, 48 * u).fill({ color: accent, alpha: 0.35 });
        break;
      case "greatsword":
        g.rect(-3 * u, -62 * u, 6 * u, 64 * u).fill(steel);
        g.rect(-1 * u, -58 * u, 2 * u, 56 * u).fill({ color: accent, alpha: 0.9 });
        g.poly([-3 * u, -62 * u, 3 * u, -62 * u, 0, -70 * u]).fill(steel);
        g.rect(-10 * u, 0, 20 * u, 3 * u).fill(darken(accent, 0.3));
        g.rect(-2 * u, 3 * u, 4 * u, 12 * u).fill(0x2a2d3a);
        glow.rect(-6 * u, -66 * u, 12 * u, 68 * u).fill({ color: accent, alpha: 0.35 });
        break;
      case "dagger":
        g.rect(-1.2 * u, -20 * u, 2.4 * u, 22 * u).fill(steel);
        g.poly([-1.2 * u, -20 * u, 1.2 * u, -20 * u, 0, -25 * u]).fill(steel);
        g.rect(-3 * u, 0, 6 * u, 1.6 * u).fill(steelDark);
        break;
      case "twin":
        g.rect(-1.2 * u, -26 * u, 2.4 * u, 28 * u).fill(steel);
        g.poly([-1.2 * u, -26 * u, 1.2 * u, -26 * u, 0, -31 * u]).fill(steel);
        g.rect(-0.5 * u, -24 * u, 1 * u, 22 * u).fill({ color: accent, alpha: 0.9 });
        g.rect(-3.5 * u, 0, 7 * u, 1.8 * u).fill(darken(accent, 0.3));
        glow.rect(-3 * u, -28 * u, 6 * u, 30 * u).fill({ color: accent, alpha: 0.4 });
        break;
      case "bow":
        g.moveTo(0, -34 * u).quadraticCurveTo(14 * u, 0, 0, 34 * u).stroke({ width: 2.6 * u, color: darken(accent, 0.4) });
        g.moveTo(0, -34 * u).lineTo(0, 34 * u).stroke({ width: 0.8 * u, color: 0xdde3f0, alpha: 0.8 });
        g.circle(0, 0, 2.5 * u).fill(accent);
        break;
      case "staff":
        g.rect(-1.6 * u, -56 * u, 3.2 * u, 68 * u).fill(0x3a2d2a);
        g.circle(0, -60 * u, 6 * u).fill({ color: accent, alpha: 0.95 });
        glow.circle(0, -60 * u, 12 * u).fill({ color: accent, alpha: 0.35 });
        break;
      case "banner": {
        // A war banner: a tall pole and a swallow-tailed cloth in the bearer's colour.
        g.rect(-1.5 * u, -74 * u, 3 * u, 86 * u).fill(0x3a2d2a);
        g.poly([1.5 * u, -72 * u, 26 * u, -70 * u, 20 * u, -58 * u, 27 * u, -46 * u, 1.5 * u, -48 * u]).fill({ color: accent, alpha: 0.95 });
        g.poly([1.5 * u, -72 * u, 26 * u, -70 * u, 20 * u, -58 * u, 27 * u, -46 * u, 1.5 * u, -48 * u]).stroke({ width: 1 * u, color: darken(accent, 0.4), alpha: 0.9 });
        g.circle(0, -76 * u, 3 * u).fill(0xc9a24f);
        glow.circle(14 * u, -60 * u, 16 * u).fill({ color: accent, alpha: 0.18 });
        break;
      }
      case "scythe":
        g.rect(-1.5 * u, -62 * u, 3 * u, 72 * u).fill(0x2a2a33);
        g.moveTo(0, -62 * u).quadraticCurveTo(28 * u, -70 * u, 34 * u, -44 * u).quadraticCurveTo(22 * u, -58 * u, 0, -56 * u).fill(steel);
        g.moveTo(0, -62 * u).quadraticCurveTo(28 * u, -70 * u, 34 * u, -44 * u).stroke({ width: 1.2 * u, color: accent, alpha: 0.9 });
        glow.moveTo(0, -62 * u).quadraticCurveTo(28 * u, -70 * u, 34 * u, -44 * u).stroke({ width: 6 * u, color: accent, alpha: 0.3 });
        break;
      case "club": {
        // A bone-and-stone maul, in the same ink as its bearer, studded with embers.
        const wood = lighten(s.body, 0.08);
        g.rect(-2.5 * u, -40 * u, 5 * u, 44 * u).fill(wood);
        g.poly([-9 * u, -36 * u, -7 * u, -60 * u, 7 * u, -62 * u, 10 * u, -38 * u]).fill(lighten(s.body, 0.14));
        for (const [x, y] of [[-5, -54], [4, -47], [0, -41], [6, -57]] as const) g.circle(x * u, y * u, 1.5 * u).fill({ color: s.eye, alpha: 0.9 });
        break;
      }
      case "tower": {
        // A door-sized shield carried on the front arm: the silhouette says "hit me from behind".
        const sh = lighten(s.body, s.finish === "ink" ? 0.1 : 0.08);
        g.roundRect(-4 * u, -34 * u, 15 * u, 44 * u, 3 * u).fill(sh);
        g.rect(1 * u, -30 * u, 2 * u, 36 * u).fill({ color: s.eye, alpha: 0.35 });
        g.circle(4 * u, -12 * u, 2.6 * u).fill({ color: s.eye, alpha: 0.8 });
        glow.roundRect(-6 * u, -36 * u, 19 * u, 48 * u, 4 * u).fill({ color: s.glow ?? s.eye, alpha: 0.25 });
        break;
      }
      case "mace_shield": {
        // Flanged mace: a haft and a ring of blades, readable as a silhouette.
        g.rect(-2 * u, -40 * u, 4 * u, 44 * u).fill(steelDark);
        g.circle(0, -46 * u, 7 * u).fill(steel);
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          g.poly([Math.cos(a) * 5 * u, -46 * u + Math.sin(a) * 5 * u, Math.cos(a + 0.25) * 11 * u, -46 * u + Math.sin(a + 0.25) * 11 * u, Math.cos(a + 0.5) * 5 * u, -46 * u + Math.sin(a + 0.5) * 5 * u]).fill(steel);
        }
        g.circle(0, -46 * u, 2.4 * u).fill({ color: s.eye, alpha: 0.9 });
        glow.circle(0, -46 * u, 14 * u).fill({ color: s.glow ?? accent, alpha: 0.3 });
        break;
      }
      default:
        break;
    }
    };
    const scratch = (fn: (c: GraphicsContext) => void) => {
      const c = new GraphicsContext();
      fn(c);
      c.destroy();
    };
    this.weaponGlow = this.part((c) => scratch((g) => draw(g, c)));
    this.weaponGlow.alpha = 0;
    this.weaponGlow.blendMode = "add";
    this.weapon.addChild(this.weaponGlow);
    this.weapon.addChild(this.part((c) => scratch((glow) => draw(c, glow))));
    if (s.weapon === "mace_shield") {
      // Kite shield on the far forearm: a tall heater shape with a single raised boss.
      const sh = this.part((sh) => {
      sh.poly([-11 * u, -2 * u, 11 * u, -2 * u, 12 * u, 14 * u, 0, 30 * u, -12 * u, 14 * u]).fill(lighten(s.body, 0.08));
      sh.poly([-8 * u, 1 * u, 8 * u, 1 * u, 9 * u, 13 * u, 0, 25 * u, -9 * u, 13 * u]).stroke({ width: 1.2 * u, color: s.glow ?? accent, alpha: 0.55 });
      sh.circle(0, 11 * u, 2.6 * u).fill({ color: s.eye, alpha: 0.85 });
      });
      sh.y = 4 * u;
      this.armL.lower.addChild(sh);
    }
    void limbW;
  }

  /**
   * White copies of every body part, hidden until a hit: the 1 to 2 frame impact silhouette.
   * Each copy is the part's own drawing with every colour replaced by white, so no filter is needed.
   */
  private buildFlash(node: Container): void {
    const kids = node.children.slice();
    for (const child of kids) {
      if (child === this.weaponGlow || child === this.aura || child === this.eyes) continue;
      if (child instanceof Graphics) {
        const white = new Graphics(whiteOf(child.context));
        white.position.copyFrom(child.position);
        white.rotation = child.rotation;
        white.scale.copyFrom(child.scale);
        if (child === this.cape) this.capeWhite = white;
        this.flashParts.push(white);
        this.flashOrig.push(child);
      } else this.buildFlash(child);
    }
  }

  /** Hits read as a sharp recoil: a squash, a lean back and a flash of the eyes. */
  setHitFlash(amount: number): void {
    this.hitAmount = clamp(amount / 0.12, 0, 1);
  }

  /**
   * Extra reaction from the impact director: squash (0..1), a lean away from the blow (radians),
   * and which way the last blow pushed on screen (1 right, -1 left; 0 if never struck), so the
   * flinch goes away from the attacker and not simply backwards.
   */
  setReaction(squash: number, lean: number, pushed: 1 | -1 | 0 = 0): void {
    this.squash = squash;
    this.lean = lean;
    this.pushed = pushed;
  }

  /**
   * The white impact silhouette, on for a frame or two. The copies are built on the first hit and
   * are only in the display tree while showing, so they cost nothing between hits.
   */
  setWhite(level: number | boolean): void {
    const a = level === true ? 1 : level === false ? 0 : level;
    const on = a > 0;
    if (on && a !== this.flashLevel) {
      this.flashLevel = a;
      if (this.flashParts.length === 0) this.buildFlash(this.body);
      for (const w of this.flashParts) w.alpha = a;
    }
    if (on === this.flashOn) return;
    this.flashOn = on;
    if (on && this.flashParts.length === 0) this.buildFlash(this.body);
    for (let i = 0; i < this.flashParts.length; i++) {
      const w = this.flashParts[i]!;
      const o = this.flashOrig[i]!;
      if (on) {
        const parent = o.parent;
        if (parent) parent.addChildAt(w, parent.getChildIndex(o) + 1);
      } else w.removeFromParent();
    }
  }

  /** How this body dies: by collapse, launched along `dir`, or dissolving. */
  setDeath(variant: number, dir: 1 | -1, seed: number): void {
    this.death = variant;
    this.deathDir = dir;
    this.deathDist = 40 + rand2(seed, 3) * 30;
  }

  get deathVariant(): number {
    return this.death;
  }

  setWeaponGlow(alpha: number): void {
    this.weaponGlow.alpha = clamp(alpha, 0, 1);
  }

  /**
   * Blend toward the pose for this state and time, then apply it. `dt` is real seconds since the
   * last frame (0 holds the pose, as during a hit-stop). `variant` picks the combo swing.
   */
  animate(state: ActionState, t: number, duration: number, seed: number, facing: 1 | -1, moving: boolean, speedFrac: number, deathT: number, dt = 0, variant = 0): void {
    const s = this.spec;
    const inp = this.input;
    this.clock += dt;
    inp.state = state;
    inp.t = t;
    inp.duration = duration;
    inp.seed = seed;
    inp.clock = this.clock;
    inp.speedFrac = moving ? speedFrac : 0;
    inp.variant = variant;
    inp.death = this.death;
    computePose(this.target, inp);
    const entering = state !== this.lastState;
    if (state === "emerge" && entering) this.resetDeath();
    if (this.fresh || (entering && snapsOnEnter(state))) {
      this.current.set(this.target);
      this.capeAngle = this.target[Ch.Torso]!;
      this.fresh = false;
    } else if (dt > 0) {
      const lam = stateLambda(state, t, duration);
      const striking = lam >= 60;
      // Secondary motion: the head and the weapon follow the body a beat late, except in the
      // strike itself, where the blade must arrive with the body.
      const headLam = striking ? lam : Math.min(lam, 12);
      const weaponLam = striking ? lam : state === "recover" ? 6 : Math.min(lam, 20);
      const cur = this.current;
      const tgt = this.target;
      for (let i = 0; i < CHANNELS; i++) {
        const l = i === Ch.Head ? headLam : i === Ch.Weapon ? weaponLam : lam;
        cur[i] = damp(cur[i]!, tgt[i]!, l, dt);
      }
    }
    this.lastState = state;
    this.plantLeadFoot(state, t, duration, dt);
    this.applyPose();
    this.secondary(dt, state, speedFrac, moving);

    const body = this.body;
    if (s.aura) {
      // The aura is a ground ellipse: it breathes, it does not spin (a spun ellipse tilts off the ground).
      this.aura.alpha = 0.6 + Math.sin(this.clock * 3) * 0.2;
    }
    const glow = state === "cast" ? 0.8 : state === "windup" ? 0.5 : state === "attack" ? 1 : 0;
    this.setWeaponGlow(dt > 0 ? damp(this.weaponGlow.alpha, glow, 20, dt) : this.weaponGlow.alpha);
    body.alpha = 1;
    if (state === "dead") {
      this.applyDeath(deathT, facing);
      return;
    }
    this.deathShiftX = 0;
    this.poolScale = 1;
    if (state === "emerge") {
      const k = clamp(t / Math.max(0.01, duration), 0, 1);
      body.rotation = 0;
      body.x = 0;
      body.y = s.floating ? -8 * this.u : 0;
      if (s.finish === "shadow") {
        // A shadow re-forms from its pool: the pool opens first, then the figure rises out of it.
        const pool = easeOutCubic(span(k, 0, 0.35));
        const rise = easeOutCubic(span(k, 0.25, 1));
        this.poolScale = 0.2 + 1.3 * pool - 0.5 * rise;
        this.root.alpha = rise > 0 ? 1 : 0;
        body.alpha = Math.min(1, rise * 1.6);
        body.scale.set(facing * (1 - 0.25 * (1 - rise)), Math.max(0.02, rise));
        this.eyes.alpha = rise * rise;
        this.shadow.alpha = 1;
        return;
      }
      this.root.alpha = k;
      body.scale.set(facing, 0.3 + 0.7 * easeOutCubic(k));
      this.eyes.alpha = k * k;
      this.shadow.alpha = k;
      return;
    }
    const h = this.hitAmount;
    const sq = 0.08 * h + this.squash;
    // The flinch rocks away from whoever struck (behind him, he pitches forward).
    const away = this.pushed !== 0 ? this.pushed : -facing;
    // A dash stretches the figure along its path and pitches it forward: speed read from one frame.
    const dash = state === "dodge" ? 1 : 0;
    body.rotation = away * 0.12 * h - facing * this.lean + facing * 0.16 * dash;
    body.scale.set(facing * (1 + sq * 0.7) * (1 + 0.14 * dash), this.current[Ch.ScaleY]! * (1 - sq) * (1 - 0.1 * dash));
    body.x = away * 3 * this.u * h;
    body.y = s.floating ? -8 * this.u + Math.sin(this.clock * 2 + seed * 6) * 3 * this.u : 0;
    this.root.alpha = state === "dodge" ? 0.55 : 1;
    this.eyes.alpha = 1;
    this.shadow.alpha = 1;
  }

  /** Cape drag and blinking. */
  private secondary(dt: number, state: ActionState, speedFrac: number, moving: boolean): void {
    if (this.spec.cape) {
      // The cape trails the torso's swing (lambda 5) and streams back when running.
      const torsoAngle = this.current[Ch.Torso]! + this.current[Ch.Lean]!;
      if (dt > 0) this.capeAngle = damp(this.capeAngle, torsoAngle, 5, dt);
      const drag = clamp(this.capeAngle - torsoAngle, -0.9, 0.9);
      const run = moving && state === "move" ? speedFrac * 0.35 + Math.sin(this.clock * 9) * 0.05 * speedFrac : 0;
      this.cape.rotation = drag + run + Math.sin(this.clock * 1.7) * 0.02;
      if (this.capeWhite) this.capeWhite.rotation = this.cape.rotation;
    }
    // Blink: eyes to 10% height for 90ms every 3 to 6 seconds.
    if (dt > 0) {
      if (this.blinkLeft > 0) {
        this.blinkLeft -= dt;
      } else {
        if (this.blinkIn === 0) this.blinkIn = 1 + 3 * rand2(this.spec.height + this.u, 1);
        this.blinkIn -= dt;
        if (this.blinkIn <= 0) {
          this.blinks += 1;
          this.blinkIn = 3 + 3 * rand2(this.spec.height + this.blinks, this.blinks * 3 + 1);
          this.blinkLeft = 0.09;
        }
      }
    }
    const eyeScale = 1 + 0.4 * this.hitAmount;
    this.eyes.scale.set(eyeScale, this.blinkLeft > 0 ? 0.1 : eyeScale);
  }

  private applyDeath(deathT: number, facing: 1 | -1): void {
    const body = this.body;
    const u = this.u;
    this.eyes.alpha = 1 - clamp(deathT / 0.3, 0, 1);
    this.shadow.alpha = 1;
    if (this.death === DEATH_LAUNCH) {
      // Thrown 40 to 70u along the blow on an arc with spin; lands, lies a beat, then sinks.
      const fly = span(deathT, 0, 0.45);
      const dist = this.deathDist * easeOutCubic(fly);
      const lift = Math.sin(fly * Math.PI) * 24 * u;
      this.deathShiftX = this.deathDir * dist * u;
      body.x = this.deathShiftX;
      body.y = -lift;
      // The body turns over in the air and lands on its back, head away from the blow.
      body.rotation = this.deathDir * Math.PI * 0.5 * easeOutCubic(fly);
      const sink = easeInCubic(span(deathT, 0.7, 1.2));
      body.scale.set(facing, 1 - sink);
      this.poolScale = sink > 0 ? 1.8 * (1 - sink) + 0.15 : 1 + fly * 0.5;
      this.root.alpha = sink >= 1 ? 0 : 1;
      return;
    }
    if (this.death === DEATH_KNEEL) {
      body.x = 0;
      body.y = 0;
      body.rotation = 0;
      body.scale.set(facing, 1);
      this.deathShiftX = 0;
      this.poolScale = 1;
      this.eyes.alpha = 1;
      this.root.alpha = 1;
      return;
    }
    if (this.death === DEATH_SINK) {
      // The shadow sinks straight down into its pool, which widens as it takes the body and then
      // lingers faintly until the shadow returns.
      const k = easeInCubic(span(deathT, 0, 0.6));
      body.x = 0;
      body.y = 0;
      body.rotation = 0;
      body.scale.set(facing * (1 + 0.15 * k), Math.max(0.01, 1 - k));
      body.alpha = 1 - 0.4 * k;
      this.deathShiftX = 0;
      const fade = span(deathT, 1.2, 2.2);
      this.poolScale = (1 + 0.7 * easeOutCubic(span(deathT, 0, 0.5))) * (1 - 0.6 * fade);
      this.shadow.alpha = 1 - 0.5 * fade;
      this.root.alpha = k >= 1 ? 0 : 1;
      return;
    }
    if (this.death === DEATH_DISSOLVE) {
      // The silhouette breaks upward into shards (the renderer emits them); the body thins away.
      const k = span(deathT, 0, 0.45);
      body.x = 0;
      body.y = -k * 10 * u;
      body.rotation = 0;
      body.scale.set(facing * (1 - k * 0.3), 1 + k * 0.25);
      body.alpha = 1 - easeOutCubic(k);
      this.deathShiftX = 0;
      this.poolScale = 1 - k;
      this.root.alpha = k >= 1 ? 0 : 1;
      return;
    }
    // Collapse: the pose folds fast (0.28s) while the ink pool spreads from the moment of the
    // blow, then the body sinks into it and the pool shrinks away. The folded lump never sits.
    const fold = easeOutCubic(span(deathT, 0, 0.28));
    const sink = easeInCubic(span(deathT, 0.24, 0.75));
    const spread = easeOutCubic(span(deathT, 0, 0.35));
    body.x = 0;
    body.y = 0;
    body.rotation = facing * fold * 0.2;
    body.scale.set(facing, Math.max(0.01, 1 - sink));
    this.deathShiftX = 0;
    this.poolScale = (1 + 1.0 * spread) * (1 - 0.9 * easeInCubic(span(deathT, 0.6, 1.0)));
    this.root.alpha = sink >= 1 ? 0 : 1;
  }

  /**
   * The lead foot holds its ground point from the strike through the contact hold while the hips
   * travel (two-bone IK on the near leg), and lets go over 80ms in the follow-through. Melee
   * combo and heavy kits only.
   */
  private plantLeadFoot(state: ActionState, t: number, duration: number, dt: number): void {
    if (this.kit !== "combo" && this.kit !== "heavy") return;
    const striking = (state === "windup" && t >= duration - strikeWindow(duration)) || (state === "attack" && t < duration * 0.6);
    if (striking && !this.planted) {
      this.planted = true;
      this.footPoint(this.pt);
      this.plantX = this.pt.x;
      this.plantY = this.pt.y;
    } else if (!striking) this.planted = false;
    this.plantW = this.planted ? 1 : dt > 0 ? damp(this.plantW, 0, 30, dt) : this.plantW;
    if (this.plantW < 0.01 || !this.root.scale.x) return;
    // The planted point in body space.
    const b = this.body;
    const rs = this.root.scale.x;
    let lx = (this.plantX - this.root.x) / rs - b.x;
    let ly = (this.plantY - this.root.y) / rs - b.y;
    const c = Math.cos(-b.rotation);
    const s = Math.sin(-b.rotation);
    const rx = lx * c - ly * s;
    const ry = lx * s + ly * c;
    lx = rx / (b.scale.x || 1);
    ly = ry / (b.scale.y || 1);
    const cur = this.current;
    const hipX = cur[Ch.HipsX]! * this.u + this.legR.upper.x;
    const hipY = cur[Ch.HipsY]! * this.u - this.legLen;
    const dx = lx - hipX;
    const dy = ly - hipY;
    const L1 = this.upperLeg;
    const L2 = this.lowerLeg;
    const D = clamp(Math.hypot(dx, dy), Math.abs(L1 - L2) + 0.01, L1 + L2 - 0.01);
    const theta = Math.atan2(-dx, dy);
    const alpha = Math.acos(clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1));
    // Knee forward: the thigh turns toward +x (a smaller angle).
    const a0 = theta - alpha;
    const kx = -Math.sin(a0) * L1;
    const ky = Math.cos(a0) * L1;
    const fx = (dx / (Math.hypot(dx, dy) || 1)) * D;
    const fy = (dy / (Math.hypot(dx, dy) || 1)) * D;
    const a1 = Math.atan2(-(fx - kx), fy - ky) - a0;
    const w = this.plantW;
    cur[Ch.LegR0] = cur[Ch.LegR0]! + (a0 - cur[Ch.LegR0]!) * w;
    cur[Ch.LegR1] = cur[Ch.LegR1]! + (a1 - cur[Ch.LegR1]!) * w;
  }

  /** The near (lead) foot's sole in the rig's parent space, from the current pose. */
  private footPoint(out: { x: number; y: number }): void {
    const p = this.current;
    let x = p[Ch.HipsX]! * this.u + this.legR.upper.x;
    let y = p[Ch.HipsY]! * this.u - this.legLen;
    const a0 = p[Ch.LegR0]!;
    x += -Math.sin(a0) * this.upperLeg;
    y += Math.cos(a0) * this.upperLeg;
    const a1 = a0 + p[Ch.LegR1]!;
    x += -Math.sin(a1) * this.lowerLeg;
    y += Math.cos(a1) * this.lowerLeg;
    this.toParent(x, y, out);
  }

  private readonly pt = { x: 0, y: 0 };

  private resetDeath(): void {
    this.deathShiftX = 0;
    this.poolScale = 1;
    this.body.alpha = 1;
    this.root.alpha = 1;
    this.death = DEATH_COLLAPSE;
  }

  private applyPose(): void {
    const p = this.current;
    const u = this.u;
    this.hips.x = p[Ch.HipsX]! * u;
    this.hips.y = p[Ch.HipsY]! * u - this.legLen;
    this.torso.rotation = p[Ch.Torso]! + p[Ch.Lean]!;
    this.head.rotation = p[Ch.Head]!;
    this.armL.upper.rotation = p[Ch.ArmL0]!;
    this.armL.lower.rotation = p[Ch.ArmL1]!;
    this.armR.upper.rotation = p[Ch.ArmR0]!;
    this.armR.lower.rotation = p[Ch.ArmR1]!;
    this.legL.upper.rotation = p[Ch.LegL0]!;
    this.legL.lower.rotation = p[Ch.LegL1]!;
    this.legR.upper.rotation = p[Ch.LegR0]!;
    this.legR.lower.rotation = p[Ch.LegR1]!;
    this.weapon.rotation = p[Ch.Weapon]!;
  }

  /**
   * Weapon tip and the point 60% up the blade, in the rig's parent space (where root sits), from
   * the current pose by forward kinematics. Writes into `tip` and `mid`; no allocation.
   */
  weaponPoints(tip: { x: number; y: number }, mid: { x: number; y: number }): void {
    const p = this.current;
    const b = this.body;
    const ta = p[Ch.Torso]! + p[Ch.Lean]!;
    const hx = p[Ch.HipsX]! * this.u;
    const hy = p[Ch.HipsY]! * this.u - this.legLen;
    // Shoulder: a child of the torso at (armX, -0.92 torsoH).
    const shX = this.armX;
    const shY = -this.torsoH * 0.92;
    const ct = Math.cos(ta);
    const st = Math.sin(ta);
    let x = hx + shX * ct - shY * st;
    let y = hy + shX * st + shY * ct;
    // Bones hang along +y; a rotation of a turns (0, len) into (-sin a, cos a) * len.
    let a = ta + p[Ch.ArmR0]!;
    x += -Math.sin(a) * this.upperArm;
    y += Math.cos(a) * this.upperArm;
    a += p[Ch.ArmR1]!;
    x += -Math.sin(a) * this.lowerArm;
    y += Math.cos(a) * this.lowerArm;
    a += p[Ch.Weapon]!;
    // The blade is drawn along -y from the hand.
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const L = this.bladeLen;
    const r = b.rotation;
    const c = Math.cos(r);
    const s = Math.sin(r);
    const sx = b.scale.x;
    const sy = b.scale.y;
    const rs = this.root.scale.x;
    let px = (x + dx * L) * sx;
    let py = (y + dy * L) * sy;
    tip.x = this.root.x + (b.x + px * c - py * s) * rs;
    tip.y = this.root.y + (b.y + px * s + py * c) * rs;
    px = (x + dx * L * 0.6) * sx;
    py = (y + dy * L * 0.6) * sy;
    mid.x = this.root.x + (b.x + px * c - py * s) * rs;
    mid.y = this.root.y + (b.y + px * s + py * c) * rs;
  }

  /** Body-local point to the rig's parent space (through body and root transforms). */
  private toParent(x: number, y: number, out: { x: number; y: number }): void {
    const b = this.body;
    const r = b.rotation;
    const c = Math.cos(r);
    const s = Math.sin(r);
    const px = x * b.scale.x;
    const py = y * b.scale.y;
    const rs = this.root.scale.x;
    out.x = this.root.x + (b.x + px * c - py * s) * rs;
    out.y = this.root.y + (b.y + px * s + py * c) * rs;
  }

  /** The point between the eyes, in the rig's parent space (for glows that sit on the face). */
  eyePoint(out: { x: number; y: number }): void {
    const p = this.current;
    const ta = p[Ch.Torso]! + p[Ch.Lean]!;
    const hx = p[Ch.HipsX]! * this.u;
    const hy = p[Ch.HipsY]! * this.u - this.legLen;
    const nx = 0;
    const ny = -this.torsoH - this.headR * 0.75;
    const ct = Math.cos(ta);
    const st = Math.sin(ta);
    let x = hx + nx * ct - ny * st;
    let y = hy + nx * st + ny * ct;
    const ha = ta + p[Ch.Head]!;
    const ex = this.headR * 0.4;
    const ey = this.eyeY;
    x += ex * Math.cos(ha) - ey * Math.sin(ha);
    y += ex * Math.sin(ha) + ey * Math.cos(ha);
    this.toParent(x, y, out);
  }

  /** The weapon hand (end of the right forearm), in the rig's parent space. */
  handPoint(out: { x: number; y: number }): void {
    const p = this.current;
    const ta = p[Ch.Torso]! + p[Ch.Lean]!;
    const hx = p[Ch.HipsX]! * this.u;
    const hy = p[Ch.HipsY]! * this.u - this.legLen;
    const shX = this.armX;
    const shY = -this.torsoH * 0.92;
    const ct = Math.cos(ta);
    const st = Math.sin(ta);
    let x = hx + shX * ct - shY * st;
    let y = hy + shX * st + shY * ct;
    let a = ta + p[Ch.ArmR0]!;
    x += -Math.sin(a) * this.upperArm;
    y += Math.cos(a) * this.upperArm;
    a += p[Ch.ArmR1]!;
    x += -Math.sin(a) * this.lowerArm;
    y += Math.cos(a) * this.lowerArm;
    this.toParent(x, y, out);
  }

  /**
   * The next `animate` jumps straight to its pose instead of blending, and lets go of a planted
   * foot: for a body that was just teleported (a blink of the Ascendant Fury).
   */
  snap(): void {
    this.fresh = true;
    this.planted = false;
    this.plantW = 0;
  }

  /** Prepare the white impact copies of this kind's parts (cached per kind; cheap after the first). */
  prewarmWhite(): void {
    for (const c of this.parts) whiteOf(c);
  }

  /** Eye alpha, applied after `animate` (a silhouette rising from its pool keeps them dark). */
  setEyes(alpha: number): void {
    this.eyes.alpha = alpha;
  }

  destroy(): void {
    if (!this.root.destroyed) this.root.destroy({ children: true });
    if (!this.shadow.destroyed) this.shadow.destroy();
    for (const g of this.flashParts) if (!g.destroyed) g.destroy();
    this.flashParts.length = 0;
  }
}
