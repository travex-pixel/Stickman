import { Container, Graphics } from "pixi.js";
import type { ActionState } from "../../entities/types";
import { darken, lighten } from "../colors";
import { clamp, easeOutCubic, lerp } from "../../engine/math";

export type BodyStyle = "warrior" | "lean" | "bulky" | "robed" | "archer" | "warden" | "reaper";
export type WeaponType = "sword" | "greatsword" | "dagger" | "bow" | "staff" | "scythe" | "club" | "mace_shield" | "twin" | "tower" | "none";

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
  aura?: number;
  floating?: boolean;
  /** ivory = the hero, ink = enemies, shadow = the player's summoned army. */
  finish?: "ivory" | "ink" | "shadow";
}

interface Pose {
  torso: number;
  head: number;
  hips: { x: number; y: number };
  armL: [number, number];
  armR: [number, number];
  legL: [number, number];
  legR: [number, number];
  weapon: number;
  scaleY: number;
  lean: number;
}

const BASE: Pose = {
  torso: 0,
  head: 0,
  hips: { x: 0, y: 0 },
  armL: [0.35, 0.3],
  armR: [-0.3, 0.4],
  legL: [0.08, 0.05],
  legR: [-0.08, 0.05],
  weapon: 0.6,
  scaleY: 1,
  lean: 0,
};

/**
 * Procedural humanoid rig built from container "bones". Each body part is drawn once,
 * then animated purely with transforms, which keeps per-frame cost tiny.
 */
export class Rig {
  readonly root = new Container();
  private readonly body = new Container();
  private readonly hips = new Container();
  private readonly torso = new Container();
  private readonly head = new Container();
  private readonly eyes = new Graphics();
  private readonly armL = { upper: new Container(), lower: new Container() };
  private readonly armR = { upper: new Container(), lower: new Container() };
  private readonly legL = { upper: new Container(), lower: new Container() };
  private readonly legR = { upper: new Container(), lower: new Container() };
  private readonly weapon = new Container();
  private readonly weaponGlow = new Graphics();
  private readonly cape = new Graphics();
  private readonly aura = new Graphics();
  readonly shadow = new Graphics();
  private pose: Pose = { ...BASE, hips: { ...BASE.hips } };
  private readonly u: number;
  private deathT = 0;
  private spec: RigSpec;

  constructor(spec: RigSpec) {
    this.spec = spec;
    this.u = spec.height / 100;
    this.build();
  }

  get unit(): number {
    return this.u;
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

    // Ground shadow lives outside the body so it never rotates with it.
    this.shadow.ellipse(0, 0, (bulky ? 26 : 17) * u, (bulky ? 8 : 5.5) * u).fill({ color: 0x0a0806, alpha: 0.38 });

    // Shadow-army glow: a soft pool of light under summons, ring for evolved and legendary forms.
    if (finish === "shadow") {
      this.aura.ellipse(0, 0, 22 * u, 7 * u).fill({ color: s.glow ?? s.eye, alpha: 0.16 });
    }
    if (s.aura && s.aura > 0) {
      this.aura.ellipse(0, 0, s.aura * u * 1.1, s.aura * u * 0.36).stroke({ width: 1.6 * u, color: s.glow ?? s.accent, alpha: 0.5 });
    }
    if (finish === "shadow" || (s.aura && s.aura > 0)) this.root.addChild(this.aura);

    this.root.addChild(this.body);
    this.body.addChild(this.hips);

    const limb = (len: number, w: number, color: number, taper = 0.82) =>
      new Graphics()
        .poly([-w / 2, 0, w / 2, 0, (w / 2) * taper, len, (-w / 2) * taper, len])
        .fill(color)
        .circle(0, 0, w / 2)
        .fill(color)
        .circle(0, len, (w / 2) * taper)
        .fill(color);

    const leg = (side: { upper: Container; lower: Container }, x: number, color: number) => {
      side.upper.addChild(limb(upperLeg, limbW * 1.05, color));
      const low = limb(lowerLeg, limbW * 0.9, color, 0.9);
      // Foot: a small wedge pointing forward gives the stance weight.
      low.poly([-limbW * 0.4, lowerLeg - 1 * u, limbW * 1.3, lowerLeg + 0.5 * u, limbW * 1.1, lowerLeg + 2.6 * u, -limbW * 0.5, lowerLeg + 2.6 * u]).fill(color);
      side.lower.addChild(low);
      side.lower.y = upperLeg;
      side.upper.addChild(side.lower);
      side.upper.x = x;
      this.hips.addChild(side.upper);
    };
    leg(this.legL, -torsoW * 0.22, far);
    leg(this.legR, torsoW * 0.22, body);

    // Cape / scarf: the warrior's only colour accent besides the blade.
    if (s.cape) {
      const capeColor = finish === "ivory" ? s.accent : darken(s.accent, 0.55);
      this.cape.poly([-torsoW * 0.42, 0, torsoW * 0.3, 0, -torsoW * 0.2, torsoH * 1.45, -torsoW * 0.95, torsoH * 1.3]).fill({ color: capeColor, alpha: finish === "ivory" ? 0.95 : 0.85 });
      this.cape.y = -torsoH * 0.95;
    }

    this.hips.addChild(this.torso);
    const torsoG = new Graphics();
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
    if (s.cape) this.torso.addChild(this.cape);
    this.torso.addChild(torsoG);

    // Head
    this.head.y = -torsoH - headR * 0.75;
    const headG = new Graphics();
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
    this.head.addChild(headG);
    this.head.addChild(this.eyes);
    // Eyes: the brightest pixels on every figure. Enemies glare, summons glow, the hero is calm.
    const eyeY = s.hood ? headR * 0.15 : -headR * 0.05;
    if (finish === "ivory") {
      this.eyes.roundRect(headR * 0.15, eyeY - headR * 0.1, headR * 0.5, headR * 0.2, headR * 0.1).fill(darken(body, 0.75));
    } else {
      this.eyes.poly([headR * 0.05, eyeY - headR * 0.18, headR * 0.75, eyeY - headR * 0.02, headR * 0.1, eyeY + headR * 0.12]).fill(s.eye);
      this.eyes.circle(headR * 0.4, eyeY, headR * 0.65).fill({ color: s.eye, alpha: finish === "shadow" ? 0.28 : 0.16 });
    }
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


    this.applyPose(this.pose);
  }

  private buildWeapon(limbW: number): void {
    const s = this.spec;
    const u = this.u;
    const g = new Graphics();
    const steel = s.finish === "ivory" ? 0xe7e2d6 : s.finish === "shadow" ? 0x5b5f86 : 0x3a3a40;
    const steelDark = s.finish === "ivory" ? 0x9a927f : 0x24242a;
    const accent = s.accent;
    switch (s.weapon) {
      case "sword":
        g.rect(-1.6 * u, -44 * u, 3.2 * u, 46 * u).fill(steel);
        g.rect(-0.6 * u, -42 * u, 1.2 * u, 40 * u).fill({ color: accent, alpha: 0.9 });
        g.poly([-1.6 * u, -44 * u, 1.6 * u, -44 * u, 0, -50 * u]).fill(steel);
        g.rect(-6 * u, 0, 12 * u, 2.2 * u).fill(darken(accent, 0.3));
        g.rect(-1.4 * u, 2 * u, 2.8 * u, 7 * u).fill(0x2a2d3a);
        this.weaponGlow.rect(-4 * u, -46 * u, 8 * u, 48 * u).fill({ color: accent, alpha: 0.35 });
        break;
      case "greatsword":
        g.rect(-3 * u, -62 * u, 6 * u, 64 * u).fill(steel);
        g.rect(-1 * u, -58 * u, 2 * u, 56 * u).fill({ color: accent, alpha: 0.9 });
        g.poly([-3 * u, -62 * u, 3 * u, -62 * u, 0, -70 * u]).fill(steel);
        g.rect(-10 * u, 0, 20 * u, 3 * u).fill(darken(accent, 0.3));
        g.rect(-2 * u, 3 * u, 4 * u, 12 * u).fill(0x2a2d3a);
        this.weaponGlow.rect(-6 * u, -66 * u, 12 * u, 68 * u).fill({ color: accent, alpha: 0.35 });
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
        this.weaponGlow.rect(-3 * u, -28 * u, 6 * u, 30 * u).fill({ color: accent, alpha: 0.4 });
        break;
      case "bow":
        g.moveTo(0, -34 * u).quadraticCurveTo(14 * u, 0, 0, 34 * u).stroke({ width: 2.6 * u, color: darken(accent, 0.4) });
        g.moveTo(0, -34 * u).lineTo(0, 34 * u).stroke({ width: 0.8 * u, color: 0xdde3f0, alpha: 0.8 });
        g.circle(0, 0, 2.5 * u).fill(accent);
        break;
      case "staff":
        g.rect(-1.6 * u, -56 * u, 3.2 * u, 68 * u).fill(0x3a2d2a);
        g.circle(0, -60 * u, 6 * u).fill({ color: accent, alpha: 0.95 });
        this.weaponGlow.circle(0, -60 * u, 12 * u).fill({ color: accent, alpha: 0.35 });
        break;
      case "scythe":
        g.rect(-1.5 * u, -62 * u, 3 * u, 72 * u).fill(0x2a2a33);
        g.moveTo(0, -62 * u).quadraticCurveTo(28 * u, -70 * u, 34 * u, -44 * u).quadraticCurveTo(22 * u, -58 * u, 0, -56 * u).fill(steel);
        g.moveTo(0, -62 * u).quadraticCurveTo(28 * u, -70 * u, 34 * u, -44 * u).stroke({ width: 1.2 * u, color: accent, alpha: 0.9 });
        this.weaponGlow.moveTo(0, -62 * u).quadraticCurveTo(28 * u, -70 * u, 34 * u, -44 * u).stroke({ width: 6 * u, color: accent, alpha: 0.3 });
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
        this.weaponGlow.roundRect(-6 * u, -36 * u, 19 * u, 48 * u, 4 * u).fill({ color: s.glow ?? s.eye, alpha: 0.25 });
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
        this.weaponGlow.circle(0, -46 * u, 14 * u).fill({ color: s.glow ?? accent, alpha: 0.3 });
        break;
      }
      default:
        break;
    }
    this.weaponGlow.alpha = 0;
    this.weaponGlow.blendMode = "add";
    this.weapon.addChild(this.weaponGlow);
    this.weapon.addChild(g);
    if (s.weapon === "mace_shield") {
      // Kite shield on the far forearm: a tall heater shape with a single raised boss.
      const sh = new Graphics();
      sh.poly([-11 * u, -2 * u, 11 * u, -2 * u, 12 * u, 14 * u, 0, 30 * u, -12 * u, 14 * u]).fill(lighten(s.body, 0.08));
      sh.poly([-8 * u, 1 * u, 8 * u, 1 * u, 9 * u, 13 * u, 0, 25 * u, -9 * u, 13 * u]).stroke({ width: 1.2 * u, color: s.glow ?? accent, alpha: 0.55 });
      sh.circle(0, 11 * u, 2.6 * u).fill({ color: s.eye, alpha: 0.85 });
      sh.y = 4 * u;
      this.armL.lower.addChild(sh);
    }
    void limbW;
  }

  private hitAmount = 0;

  /** Hits read as a sharp recoil: a squash, a lean back and a flash of the eyes. No overlays. */
  setHitFlash(amount: number): void {
    this.hitAmount = clamp(amount / 0.12, 0, 1);
  }

  setWeaponGlow(alpha: number): void {
    this.weaponGlow.alpha = clamp(alpha, 0, 1);
  }

  /** Compute and apply a pose for the given state/time. `facing` flips the whole body. */
  animate(state: ActionState, t: number, duration: number, seed: number, facing: 1 | -1, moving: boolean, speedFrac: number, deathT: number): void {
    const s = this.spec;
    const p = computePose(s.style, state, t, duration, seed, moving, speedFrac);
    this.pose = p;
    this.body.scale.x = facing;
    this.deathT = deathT;
    this.applyPose(p);
    if (s.floating) {
      this.body.y = -8 * this.u + Math.sin(t * 2 + seed * 6) * 3 * this.u;
    }
    if (this.spec.aura) {
      this.aura.rotation += 0.01;
      this.aura.alpha = 0.6 + Math.sin(t * 3) * 0.2;
    }
    const glow = state === "cast" ? 0.8 : state === "windup" ? 0.5 : state === "attack" ? 1 : 0;
    this.setWeaponGlow(lerp(this.weaponGlow.alpha, glow, 0.35));
    if (state === "dead") {
      const k = Math.min(1, deathT / 0.9);
      this.body.rotation = facing * -easeOutCubic(k) * 1.35;
      this.body.y = easeOutCubic(k) * 10 * this.u;
      this.root.alpha = 1 - Math.max(0, (deathT - 0.6) / 0.8);
      this.eyes.alpha = 1 - k;
      this.shadow.alpha = 1 - k;
    } else if (state === "emerge") {
      const k = clamp(t / Math.max(0.01, duration), 0, 1);
      this.body.rotation = 0;
      this.root.alpha = k;
      this.body.scale.y = 0.3 + 0.7 * easeOutCubic(k);
      this.eyes.alpha = k * k;
      this.shadow.alpha = k;
    } else {
      const h = this.hitAmount;
      this.body.rotation = facing * -0.12 * h;
      this.body.scale.y = p.scaleY * (1 - 0.08 * h);
      this.body.scale.x = facing * (1 + 0.06 * h);
      this.body.x = -facing * 3 * this.u * h;
      this.root.alpha = state === "dodge" ? 0.55 : 1;
      this.eyes.alpha = 1;
      this.eyes.scale.set(1 + 0.4 * h);
      this.shadow.alpha = 1;
    }
  }

  private applyPose(p: Pose): void {
    this.hips.x = p.hips.x * this.u;
    this.hips.y = p.hips.y * this.u;
    this.torso.rotation = p.torso + p.lean;
    this.head.rotation = p.head;
    this.armL.upper.rotation = p.armL[0];
    this.armL.lower.rotation = p.armL[1];
    this.armR.upper.rotation = p.armR[0];
    this.armR.lower.rotation = p.armR[1];
    this.legL.upper.rotation = p.legL[0];
    this.legL.lower.rotation = p.legL[1];
    this.legR.upper.rotation = p.legR[0];
    this.legR.lower.rotation = p.legR[1];
    this.weapon.rotation = p.weapon;
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.shadow.destroy();
  }
}

const TAU = Math.PI * 2;

function computePose(style: BodyStyle, state: ActionState, t: number, duration: number, seed: number, moving: boolean, speedFrac: number): Pose {
  const p: Pose = { ...BASE, hips: { x: 0, y: 0 }, armL: [...BASE.armL], armR: [...BASE.armR], legL: [...BASE.legL], legR: [...BASE.legR] };
  const bulky = style === "bulky" || style === "warden";
  const reaper = style === "reaper";
  const breathe = Math.sin((t + seed * 10) * (bulky ? 1.6 : 2.4));
  const k = duration > 0 ? clamp(t / duration, 0, 1) : 1;
  const legSpeed = bulky ? 6 : reaper ? 13 : 10;

  switch (state) {
    case "idle":
    case "emerge": {
      p.torso = breathe * 0.025 + (reaper ? 0.22 : bulky ? 0.1 : 0);
      p.head = -breathe * 0.02 + (reaper ? 0.15 : 0);
      p.hips.y = breathe * 0.8;
      p.armL = [0.4 + breathe * 0.03, 0.35];
      p.armR = [-0.35 - breathe * 0.03, 0.5];
      p.weapon = style === "archer" ? 0.1 : style === "robed" ? -0.3 : 0.5;
      if (style === "archer") p.armR = [-0.9, 0.9];
      break;
    }
    case "move": {
      const w = (t + seed * 7) * legSpeed * (0.6 + speedFrac * 0.6);
      const sw = Math.sin(w);
      const amp = bulky ? 0.45 : 0.75;
      p.legL = [sw * amp, Math.max(0, -sw) * 0.9];
      p.legR = [-sw * amp, Math.max(0, sw) * 0.9];
      p.armL = [-sw * 0.6 + 0.2, 0.5];
      p.armR = [sw * 0.5 - 0.3, 0.55];
      p.hips.y = Math.abs(Math.cos(w)) * -2.2 * (bulky ? 1.6 : 1);
      p.torso = 0.12 + Math.abs(Math.cos(w)) * 0.03 + (reaper ? 0.25 : 0);
      p.head = -0.06;
      p.weapon = style === "archer" ? 0.1 : 0.6;
      if (style === "robed") {
        p.legL = [0.05, 0.05];
        p.legR = [-0.05, 0.05];
        p.hips.y = Math.sin(w * 0.4) * 2;
        p.torso = 0.08;
      }
      break;
    }
    case "windup": {
      const e = easeOutCubic(k);
      if (style === "archer") {
        // draw the bow
        p.armL = [-1.5, 0.1];
        p.armR = [-1.5 + e * 0.1, 1.6 * e + 0.2];
        p.torso = -0.05;
        p.weapon = 0.1;
        p.legL = [0.3, 0.1];
        p.legR = [-0.3, 0.1];
      } else if (style === "robed") {
        p.armR = [-2.2 * e, 0.3];
        p.armL = [-1.8 * e, 0.4];
        p.torso = -0.15 * e;
        p.weapon = -0.4;
        p.hips.y = -2 * e;
      } else {
        p.torso = -0.32 * e - (bulky ? 0.1 : 0);
        p.head = 0.25 * e;
        p.armR = [-2.4 * e - 0.3, 0.4];
        p.armL = [0.6 * e + 0.3, 0.5];
        p.weapon = -0.5 * e + 0.6;
        p.legL = [0.5 * e, 0.3 * e];
        p.legR = [-0.45 * e, 0.25 * e];
        p.hips.y = 2 * e;
        p.hips.x = -4 * e;
      }
      break;
    }
    case "attack": {
      const e = easeOutCubic(k);
      if (style === "archer") {
        p.armL = [-1.5, 0.1];
        p.armR = [-1.4, 0.3 + (1 - e) * 1.4];
        p.torso = 0.05;
        p.weapon = 0.1;
        p.legL = [0.3, 0.1];
        p.legR = [-0.3, 0.1];
      } else if (style === "robed") {
        p.armR = [-2.2 + e * 1.6, 0.2];
        p.armL = [-1.8 + e * 1.4, 0.3];
        p.torso = 0.2 * e;
        p.weapon = -0.4;
      } else {
        p.torso = -0.32 + e * 0.75;
        p.head = 0.25 - e * 0.35;
        p.armR = [-2.7 + e * 3.4, 0.2 + e * 0.1];
        p.armL = [0.9 - e * 1.1, 0.4];
        p.weapon = 0.1 + e * 0.8;
        p.legL = [0.5 - e * 0.1, 0.3];
        p.legR = [-0.45 - e * 0.25, 0.25];
        p.hips.y = 2 - e * 3;
        p.hips.x = -4 + e * 10;
      }
      break;
    }
    case "recover": {
      const e = easeOutCubic(k);
      p.torso = lerp(0.43, 0, e);
      p.head = lerp(-0.1, 0, e);
      p.armR = [lerp(0.7, -0.35, e), lerp(0.3, 0.5, e)];
      p.armL = [lerp(-0.2, 0.4, e), 0.4];
      p.weapon = lerp(0.9, 0.5, e);
      p.hips.y = lerp(-1, 0, e);
      p.hips.x = lerp(6, 0, e);
      p.legL = [lerp(0.4, 0.08, e), lerp(0.3, 0.05, e)];
      p.legR = [lerp(-0.7, -0.08, e), lerp(0.25, 0.05, e)];
      if (style === "archer") {
        p.armL = [lerp(-1.5, 0.4, e), 0.2];
        p.armR = [lerp(-1.4, -0.9, e), lerp(0.3, 0.9, e)];
        p.weapon = 0.1;
      }
      break;
    }
    case "cast": {
      const e = Math.sin(Math.min(1, k) * Math.PI);
      p.torso = -0.12 * e;
      p.head = -0.3 * e;
      p.armR = [-2.9 * e - 0.2, 0.2];
      p.armL = [2.6 * e + 0.3, 0.2];
      p.weapon = -0.7 * e + 0.5;
      p.hips.y = -3 * e;
      p.legL = [0.35, 0.2];
      p.legR = [-0.35, 0.2];
      break;
    }
    case "dodge": {
      p.torso = 0.55;
      p.head = -0.2;
      p.legL = [1.1, 0.2];
      p.legR = [-0.9, 1.1];
      p.armL = [-0.8, 0.3];
      p.armR = [0.9, 0.2];
      p.hips.y = 4;
      p.weapon = 0.3;
      break;
    }
    case "hit":
    case "stagger": {
      const e = Math.sin(Math.min(1, k) * Math.PI);
      p.torso = -0.35 * e;
      p.head = -0.4 * e;
      p.hips.x = -5 * e;
      p.hips.y = 2 * e;
      p.armL = [0.8 * e + 0.3, 0.3];
      p.armR = [-0.2 - 0.8 * e, 0.3];
      p.legL = [0.5 * e, 0.1];
      p.legR = [-0.3 * e, 0.3 * e];
      if (state === "stagger") {
        p.torso = -0.55 * e;
        p.hips.y = 6 * e;
      }
      break;
    }
    case "dead": {
      p.torso = 0.3;
      p.armL = [1.4, 0.5];
      p.armR = [-1.2, 0.6];
      p.legL = [0.4, 0.3];
      p.legR = [-0.3, 0.5];
      break;
    }
    default:
      break;
  }
  if (moving && state !== "move") {
    void TAU;
  }
  return p;
}
