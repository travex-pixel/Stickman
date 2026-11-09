import { Container, Graphics } from "pixi.js";
import type { ActionState } from "../../entities/types";
import { darken, lighten } from "../colors";
import { clamp, easeOutCubic, lerp } from "../../engine/math";

export type BodyStyle = "warrior" | "lean" | "bulky" | "robed" | "archer" | "warden" | "reaper";
export type WeaponType = "sword" | "greatsword" | "dagger" | "bow" | "staff" | "scythe" | "club" | "mace_shield" | "twin" | "none";

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
  private readonly hitTint = new Graphics();
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
    const dark = darken(s.body, 0.35);
    const light = lighten(s.body, 0.18);
    const rim = { width: 1.1 * u, color: lighten(s.accent, 0.1), alpha: 0.75, join: "round" as const };
    const rimSoft = { width: 1 * u, color: lighten(s.body, 0.55), alpha: 0.6, join: "round" as const };
    const style = s.style;
    const bulky = style === "bulky" || style === "warden";
    const torsoW = (bulky ? 30 : style === "lean" || style === "reaper" ? 16 : 20) * u;
    const torsoH = (bulky ? 36 : 30) * u;
    const limbW = (bulky ? 9 : style === "lean" || style === "reaper" ? 4.5 : 6) * u;
    const upperArm = (bulky ? 18 : 15) * u;
    const lowerArm = (bulky ? 17 : 14) * u;
    const upperLeg = (bulky ? 18 : 17) * u;
    const lowerLeg = (bulky ? 17 : 16) * u;
    const headR = (bulky ? 8.5 : 7.5) * u;

    // Shadow lives outside the body so it never rotates with it.
    this.shadow.ellipse(0, 0, (bulky ? 26 : 18) * u, (bulky ? 9 : 6) * u).fill({ color: 0x000000, alpha: 0.42 });

    // Aura ring (evolved / legendary)
    if (s.aura && s.aura > 0) {
      this.aura.ellipse(0, 0, s.aura * u * 1.1, s.aura * u * 0.4).stroke({ width: 2 * u, color: s.glow ?? s.accent, alpha: 0.55 });
      this.aura.ellipse(0, 0, s.aura * u * 0.8, s.aura * u * 0.28).stroke({ width: 1 * u, color: s.glow ?? s.accent, alpha: 0.35 });
      this.root.addChild(this.aura);
    }

    this.root.addChild(this.body);
    this.body.addChild(this.hips);

    // Legs
    const leg = (side: { upper: Container; lower: Container }, x: number) => {
      const up = new Graphics().roundRect(-limbW / 2, 0, limbW, upperLeg, limbW / 2).fill(dark).stroke(rimSoft);
      const low = new Graphics().roundRect(-limbW / 2, 0, limbW, lowerLeg, limbW / 2).fill(s.body).stroke(rimSoft);
      const boot = new Graphics().roundRect(-limbW * 0.7, lowerLeg - 4 * u, limbW * 1.4, 5 * u, 2 * u).fill(darken(s.accent, 0.5));
      side.upper.addChild(up);
      side.lower.addChild(low, boot);
      side.lower.y = upperLeg;
      side.upper.addChild(side.lower);
      side.upper.x = x;
      this.hips.addChild(side.upper);
    };
    leg(this.legL, -torsoW * 0.28);
    leg(this.legR, torsoW * 0.28);

    // Cape behind torso
    if (s.cape) {
      this.cape.poly([-torsoW * 0.45, 0, torsoW * 0.45, 0, torsoW * 0.7, torsoH * 1.7, -torsoW * 0.3, torsoH * 1.75]).fill({ color: darken(s.accent, 0.72), alpha: 0.95 });
      this.cape.y = -torsoH * 0.95;
    }

    // Torso
    this.hips.addChild(this.torso);
    const torsoG = new Graphics();
    if (style === "robed") {
      torsoG.poly([-torsoW * 0.55, -torsoH, torsoW * 0.55, -torsoH, torsoW * 1.0, torsoH * 0.9, -torsoW * 1.0, torsoH * 0.9]).fill(s.body).stroke(rimSoft);
      torsoG.poly([-torsoW * 0.2, -torsoH * 0.6, torsoW * 0.2, -torsoH * 0.6, torsoW * 0.35, torsoH * 0.8, -torsoW * 0.35, torsoH * 0.8]).fill({ color: s.accent, alpha: 0.5 });
    } else if (bulky) {
      torsoG.poly([-torsoW * 0.6, -torsoH, torsoW * 0.6, -torsoH, torsoW * 0.42, 0, -torsoW * 0.42, 0]).fill(s.body).stroke(rimSoft);
      // shoulder plates
      torsoG.roundRect(-torsoW * 0.78, -torsoH * 1.08, torsoW * 0.42, torsoH * 0.32, 4 * u).fill(light).stroke(rim);
      torsoG.roundRect(torsoW * 0.36, -torsoH * 1.08, torsoW * 0.42, torsoH * 0.32, 4 * u).fill(light).stroke(rim);
      torsoG.roundRect(-torsoW * 0.18, -torsoH * 0.72, torsoW * 0.36, torsoH * 0.4, 3 * u).fill({ color: s.accent, alpha: 0.9 });
    } else {
      torsoG.poly([-torsoW * 0.5, -torsoH, torsoW * 0.5, -torsoH, torsoW * 0.36, 0, -torsoW * 0.36, 0]).fill(s.body).stroke(rimSoft);
      if (style === "warrior") {
        torsoG.poly([-torsoW * 0.5, -torsoH, torsoW * 0.5, -torsoH, torsoW * 0.44, -torsoH * 0.55, -torsoW * 0.44, -torsoH * 0.55]).fill(light).stroke(rim);
        torsoG.roundRect(-torsoW * 0.1, -torsoH * 0.85, torsoW * 0.2, torsoH * 0.55, 2 * u).fill({ color: s.accent, alpha: 0.85 });
        torsoG.roundRect(-torsoW * 0.62, -torsoH * 1.05, torsoW * 0.3, torsoH * 0.22, 3 * u).fill(light).stroke(rim);
        torsoG.roundRect(torsoW * 0.32, -torsoH * 1.05, torsoW * 0.3, torsoH * 0.22, 3 * u).fill(light).stroke(rim);
        torsoG.rect(-torsoW * 0.4, -torsoH * 0.12, torsoW * 0.8, 3 * u).fill(darken(s.accent, 0.4));
      } else if (style === "archer") {
        torsoG.poly([-torsoW * 0.5, -torsoH, torsoW * 0.1, -torsoH * 0.2, -torsoW * 0.36, 0]).fill({ color: s.accent, alpha: 0.35 });
        torsoG.rect(-torsoW * 0.4, -torsoH * 0.2, torsoW * 0.8, 2.5 * u).fill(darken(s.accent, 0.3));
      } else if (style === "reaper") {
        torsoG.poly([-torsoW * 0.5, -torsoH, torsoW * 0.5, -torsoH, torsoW * 0.5, -torsoH * 0.2, -torsoW * 0.5, -torsoH * 0.2]).fill({ color: s.accent, alpha: 0.25 });
      } else {
        torsoG.rect(-torsoW * 0.4, -torsoH * 0.3, torsoW * 0.8, 2 * u).fill({ color: s.accent, alpha: 0.5 });
      }
    }
    if (s.cape) this.torso.addChild(this.cape);
    this.torso.addChild(torsoG);

    // Head
    this.head.y = -torsoH - headR * 0.3;
    const headG = new Graphics();
    if (s.hood) {
      headG.poly([-headR * 1.2, headR * 0.9, 0, -headR * 1.5, headR * 1.2, headR * 0.9]).fill(darken(s.body, 0.15)).stroke(rimSoft);
      headG.circle(0, 0, headR * 0.8).fill(darken(s.body, 0.6));
    } else if (bulky) {
      headG.roundRect(-headR, -headR * 1.1, headR * 2, headR * 2.1, headR * 0.5).fill(s.body).stroke(rimSoft);
      headG.rect(-headR * 1.05, -headR * 0.2, headR * 2.1, headR * 0.35).fill(light).stroke(rim);
      if (s.horns) {
        headG.poly([-headR * 0.9, -headR * 0.9, -headR * 2.1, -headR * 2.4, -headR * 0.4, -headR * 1.1]).fill(light).stroke(rim);
        headG.poly([headR * 0.9, -headR * 0.9, headR * 2.1, -headR * 2.4, headR * 0.4, -headR * 1.1]).fill(light).stroke(rim);
      }
    } else if (style === "warrior") {
      headG.roundRect(-headR, -headR * 1.15, headR * 2, headR * 2.2, headR * 0.7).fill(s.body).stroke(rimSoft);
      headG.poly([-headR * 0.4, -headR * 1.15, headR * 0.4, -headR * 1.15, headR * 0.15, -headR * 2.3, -headR * 0.15, -headR * 2.3]).fill(light).stroke(rim);
      headG.rect(-headR * 0.95, -headR * 0.15, headR * 1.9, headR * 0.3).fill(darken(s.body, 0.6));
    } else {
      headG.circle(0, 0, headR).fill(s.body).stroke(rimSoft);
    }
    this.head.addChild(headG);
    this.head.addChild(this.eyes);
    const eyeY = s.hood ? headR * 0.1 : bulky ? 0 : -headR * 0.05;
    const eyeDx = headR * 0.42;
    this.eyes.roundRect(-eyeDx - headR * 0.22, eyeY - headR * 0.12, headR * 0.44, headR * 0.24, headR * 0.1).fill(s.eye);
    this.eyes.roundRect(eyeDx - headR * 0.22, eyeY - headR * 0.12, headR * 0.44, headR * 0.24, headR * 0.1).fill(s.eye);
    this.eyes.circle(-eyeDx, eyeY, headR * 0.5).fill({ color: s.eye, alpha: 0.18 });
    this.eyes.circle(eyeDx, eyeY, headR * 0.5).fill({ color: s.eye, alpha: 0.18 });
    this.torso.addChild(this.head);

    // Arms
    const arm = (side: { upper: Container; lower: Container }, x: number, front: boolean) => {
      const up = new Graphics().roundRect(-limbW / 2, 0, limbW, upperArm, limbW / 2).fill(front ? s.body : dark).stroke(rimSoft);
      const low = new Graphics().roundRect(-limbW / 2, 0, limbW, lowerArm, limbW / 2).fill(front ? light : s.body).stroke(rimSoft);
      const glove = new Graphics().roundRect(-limbW * 0.7, lowerArm - 4 * u, limbW * 1.4, 5 * u, 2 * u).fill(darken(s.accent, 0.45));
      side.upper.addChild(up);
      side.lower.addChild(low, glove);
      side.lower.y = upperArm;
      side.upper.addChild(side.lower);
      side.upper.x = x;
      side.upper.y = -torsoH * 0.92;
    };
    arm(this.armL, -torsoW * 0.5, false);
    arm(this.armR, torsoW * 0.5, true);
    this.torso.addChildAt(this.armL.upper, 0);
    this.torso.addChild(this.armR.upper);

    // Weapon in right hand (lower arm end)
    this.weapon.y = lowerArm;
    this.buildWeapon(limbW);
    this.armR.lower.addChild(this.weapon);

    // Hit tint overlay (drawn as additive white silhouette, toggled by alpha)
    this.hitTint.roundRect(-torsoW, -torsoH - headR * 2.6, torsoW * 2, torsoH + headR * 2.6 + upperLeg + lowerLeg, 6 * u).fill({ color: 0xffffff, alpha: 1 });
    this.hitTint.blendMode = "add";
    this.hitTint.alpha = 0;
    this.hips.addChild(this.hitTint);

    this.applyPose(this.pose);
  }

  private buildWeapon(limbW: number): void {
    const s = this.spec;
    const u = this.u;
    const g = new Graphics();
    const steel = 0xb9c2d6;
    const steelDark = 0x6f7a92;
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
      case "club":
        g.rect(-2.5 * u, -40 * u, 5 * u, 44 * u).fill(0x3a2a22);
        g.roundRect(-8 * u, -56 * u, 16 * u, 22 * u, 4 * u).fill(0x4a332a);
        g.circle(-5 * u, -50 * u, 1.6 * u).fill(accent);
        g.circle(4 * u, -42 * u, 1.6 * u).fill(accent);
        g.circle(1 * u, -37 * u, 1.4 * u).fill(accent);
        break;
      case "mace_shield":
        g.rect(-2.5 * u, -46 * u, 5 * u, 50 * u).fill(0x2f3340);
        g.roundRect(-9 * u, -64 * u, 18 * u, 22 * u, 5 * u).fill(steelDark);
        g.roundRect(-5 * u, -60 * u, 10 * u, 14 * u, 3 * u).fill({ color: accent, alpha: 0.9 });
        this.weaponGlow.roundRect(-12 * u, -66 * u, 24 * u, 26 * u, 6 * u).fill({ color: accent, alpha: 0.3 });
        break;
      default:
        break;
    }
    this.weaponGlow.alpha = 0;
    this.weaponGlow.blendMode = "add";
    this.weapon.addChild(this.weaponGlow);
    this.weapon.addChild(g);
    if (s.weapon === "mace_shield") {
      // Shield on left forearm
      const sh = new Graphics();
      sh.roundRect(-10 * u, -2 * u, 20 * u, 30 * u, 6 * u).fill(darken(s.body, 0.1)).stroke({ width: 1.1 * u, color: lighten(accent, 0.1), alpha: 0.75 });
      sh.roundRect(-7 * u, 2 * u, 14 * u, 22 * u, 4 * u).stroke({ width: 1.5 * u, color: accent, alpha: 0.9 });
      sh.circle(0, 13 * u, 3 * u).fill(accent);
      sh.y = 4 * u;
      this.armL.lower.addChild(sh);
    }
    void limbW;
  }

  setHitFlash(amount: number): void {
    this.hitTint.alpha = clamp(amount * 5, 0, 0.75);
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
      this.body.rotation = 0;
      this.body.scale.y = p.scaleY;
      this.root.alpha = state === "dodge" ? 0.55 : 1;
      this.eyes.alpha = 1;
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
