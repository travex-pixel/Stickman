import { Container, type Graphics, type GraphicsContext } from "pixi.js";
import type { ActionState } from "../../entities/types";
import { darken, lighten } from "../colors";

/**
 * The Rift Sovereigns' regalia: what turns a procedural rig into the Mirror Knight, the Storm Titan
 * or the Void Queen. Every piece is a shared part (drawn once per kind, like the rig's own body) hung
 * on the rig's bones, so it moves with the pose and costs no geometry per frame. What lives (the
 * storm's lightning, a phase-two shard orbit) only toggles or turns parts already drawn.
 *
 *  - The Mirror Knight: a duelist in mirror plate. A helm with a mirror visor and a swept gilt crest,
 *    silver pauldrons, a mirror buckler on the guard arm. Phase two: gold light breaks through cracks
 *    in the visor and breastplate (the true knight's crack, which its images never carry), and the
 *    buckler's shards orbit it.
 *  - The Storm Titan: a hunched colossus with a thunderhead on its shoulders, lightning living in it,
 *    a crown of drowned coral and an anchor for a weapon. Phase two: the storm swells and burns white
 *    at the edges, arcs crawl on its arms.
 *  - The Void Queen: a floating sovereign under a gilt halo, a crown of tall ink spikes, a high collar
 *    and a train. Phase two: the halo turns to a black sun with a violet corona, the crown grows, the
 *    hem frays into tendrils.
 *
 * The army's shadow forms (finish "shadow") wear the same pieces in slate and gold with the
 * Sovereign's own colour as the accent, and a crown-light above the head.
 */
export type RegaliaKind = "mirror_knight" | "storm_titan" | "void_queen";

export interface RegaliaAnchors {
  part(draw: (c: GraphicsContext) => void): Graphics;
  u: number;
  headR: number;
  torsoW: number;
  torsoH: number;
  upperArm: number;
  lowerArm: number;
  root: Container;
  body: Container;
  hips: Container;
  torso: Container;
  head: Container;
  armL: { upper: Container; lower: Container };
  armR: { upper: Container; lower: Container };
  weapon: Container;
  /** The head's eyes: head pieces in front of the face go just under them. */
  eyes: Graphics;
  shadow: boolean;
  body0: number;
  accent: number;
  eye: number;
}

/** Containers the white impact copy skips (their parts move on their own). */
export const NO_WHITE = "nowhite";

/** A Sovereign's colours, as its regalia draws them (the boss, or its shadow in the army). */
export function regaliaColors(kind: RegaliaKind, shadow: boolean): { plate: number; trim: number; light: number; deep: number } {
  if (shadow) {
    const light = kind === "mirror_knight" ? 0xe8ecf6 : kind === "storm_titan" ? 0xbfdcff : 0xd8c4ff;
    return { plate: 0x6a7284, trim: 0xe9c97a, light, deep: 0x30343f };
  }
  switch (kind) {
    case "mirror_knight":
      return { plate: 0xb9c0cf, trim: 0xd9b968, light: 0xf4f6ff, deep: 0x5b6273 };
    case "storm_titan":
      return { plate: 0x22323f, trim: 0x6fa8ff, light: 0xe6f2ff, deep: 0x0c151c };
    default:
      return { plate: 0x2a1d3d, trim: 0xc9a24f, light: 0xf0e2ff, deep: 0x0a0710 };
  }
}

export class Regalia {
  private phase: 1 | 2 = 1;
  private readonly p2: Container[] = [];
  private readonly p1: Container[] = [];
  /** The storm's lightning (shown one at a time, briefly). */
  private readonly bolts: Graphics[] = [];
  private boltLeft = 0;
  private boltNext = 0.6;
  private boltIndex = 0;
  /** Arcs on the titan's arms (phase two). */
  private readonly arcs: Graphics[] = [];
  /** The knight's buckler shards (phase two), orbiting the body. */
  private readonly orbit = new Container();
  private readonly shards: Graphics[] = [];
  private cloud: Container | null = null;
  private cloudScale = 1;
  private crownLight: Graphics | null = null;
  private court: Container | null = null;
  private seedT = 0;

  constructor(
    readonly kind: RegaliaKind,
    private readonly a: RegaliaAnchors,
  ) {
    if (kind === "mirror_knight") this.knight();
    else if (kind === "storm_titan") this.titan();
    else this.queen();
    if (a.shadow) this.shadowCrown();
    this.applyPhase();
  }

  /** Phase two's transformation (a Sovereign's shadow is always in its first form). */
  setPhase(p: 1 | 2): void {
    if (p === this.phase) return;
    this.phase = p;
    this.applyPhase();
  }

  get currentPhase(): 1 | 2 {
    return this.phase;
  }

  private applyPhase(): void {
    for (const c of this.p2) c.visible = this.phase === 2;
    for (const c of this.p1) c.visible = this.phase === 1;
    this.orbit.visible = this.phase === 2 && this.shards.length > 0;
  }

  /** Lightning in the storm, orbiting shards, the court's breath. `dt` 0 holds everything. */
  update(dt: number, clock: number, state: ActionState): void {
    if (dt <= 0) return;
    this.seedT += dt;
    if (this.bolts.length > 0) {
      if (this.boltLeft > 0) {
        this.boltLeft -= dt;
        if (this.boltLeft <= 0) for (const b of this.bolts) b.visible = false;
      } else {
        this.boltNext -= dt * (this.phase === 2 ? 2.4 : 1) * (state === "windup" || state === "cast" ? 2 : 1);
        if (this.boltNext <= 0) {
          this.boltIndex = (this.boltIndex + 1 + Math.floor(frac(clock * 7.31) * (this.bolts.length - 1))) % this.bolts.length;
          this.bolts[this.boltIndex]!.visible = true;
          this.boltLeft = 0.07 + frac(clock * 3.7) * 0.06;
          this.boltNext = 0.5 + frac(clock * 1.93) * 1.4;
        }
      }
      if (this.cloud) {
        // The thunderhead roils: a slow breath of its scale.
        const k = (this.phase === 2 ? 1.22 : 1) * this.cloudScale;
        this.cloud.scale.set(k * (1 + Math.sin(clock * 1.3) * 0.03), k * (1 + Math.sin(clock * 1.7 + 1) * 0.04));
      }
    }
    if (this.arcs.length > 0 && this.phase === 2) {
      const on = Math.floor(clock * 9) % 3;
      for (let i = 0; i < this.arcs.length; i++) this.arcs[i]!.visible = i === on && frac(clock * 2.3 + i * 0.37) < 0.55;
    }
    if (this.orbit.visible) {
      for (let i = 0; i < this.shards.length; i++) {
        const s = this.shards[i]!;
        const ang = clock * 1.6 + (i / this.shards.length) * Math.PI * 2;
        const u = this.a.u;
        s.position.set(Math.cos(ang) * 26 * u, -48 * u + Math.sin(ang) * 9 * u);
        // Behind the body on the far half of the orbit.
        s.alpha = Math.sin(ang) > 0 ? 0.95 : 0.45;
        s.rotation = ang * 1.5;
      }
    }
    if (this.crownLight) this.crownLight.alpha = 0.55 + Math.sin(clock * 2.2) * 0.2;
    if (this.court) this.court.alpha = 0.42 + Math.sin(clock * 1.1) * 0.08;
  }

  // ------------------------------------------------------------------ the Mirror Knight

  private knight(): void {
    const a = this.a;
    const { u, headR: r, torsoW: w, torsoH: h } = a;
    const c = regaliaColors("mirror_knight", a.shadow);
    // A swept crest behind the helm (behind the head: first in the head container).
    const crest = a.part((g) => {
      g.poly([-r * 0.2, -r * 0.9, -r * 0.7, -r * 2.0, -r * 2.6, -r * 1.7, -r * 3.1, -r * 0.6, -r * 1.6, -r * 0.9, -r * 0.9, -r * 0.4]).fill({ color: c.trim, alpha: 0.95 });
      g.poly([-r * 0.5, -r * 1.3, -r * 2.4, -r * 1.55, -r * 2.8, -r * 0.8]).stroke({ width: 0.8 * u, color: lighten(c.trim, 0.4), alpha: 0.8 });
    });
    a.head.addChildAt(crest, 0);
    // The helm and its mirror visor (under the eyes, so the glare shows through the slit).
    const helm = a.part((g) => {
      g.circle(0, -r * 0.05, r * 1.08).fill(c.plate);
      g.poly([-r * 1.05, r * 0.1, r * 1.1, r * 0.1, r * 0.85, r * 1.05, -r * 0.6, r * 1.05]).fill(darken(c.plate, 0.18));
      // Visor: a mirror pane across the face, a pale sheen and a dark slit.
      g.roundRect(-r * 0.1, -r * 0.42, r * 1.12, r * 0.86, r * 0.3).fill(c.light);
      g.poly([r * 0.05, -r * 0.38, r * 0.35, -r * 0.38, r * 0.05, r * 0.3]).fill({ color: 0xffffff, alpha: 0.9 });
      g.rect(r * 0.12, -r * 0.08, r * 0.98, r * 0.16).fill({ color: c.deep, alpha: 0.95 });
      g.circle(0, -r * 0.05, r * 1.08).stroke({ width: 0.9 * u, color: c.trim, alpha: 0.85 });
    });
    a.head.addChildAt(helm, a.head.getChildIndex(a.eyes));
    // Phase two: the visor cracks and gold light breaks through.
    const visorCrack = a.part((g) => {
      g.moveTo(r * 0.9, -r * 0.4).lineTo(r * 0.55, -r * 0.05).lineTo(r * 0.75, r * 0.2).lineTo(r * 0.4, r * 0.5).stroke({ width: 1.1 * u, color: 0xfff1c9, alpha: 1 });
      g.circle(r * 0.6, 0, r * 0.75).fill({ color: 0xe9c97a, alpha: 0.22 });
    });
    this.phase2(a.head, visorCrack);
    // Breastplate: a mirror cuirass with a gilt edge and a sheen.
    const plate = a.part((g) => {
      g.poly([-w * 0.52, -h * 0.98, w * 0.56, -h * 0.98, w * 0.4, -h * 0.3, 0, -h * 0.12, -w * 0.38, -h * 0.3]).fill(c.plate);
      g.poly([w * 0.05, -h * 0.9, w * 0.3, -h * 0.9, w * 0.08, -h * 0.35]).fill({ color: c.light, alpha: 0.7 });
      g.poly([-w * 0.52, -h * 0.98, w * 0.56, -h * 0.98, w * 0.4, -h * 0.3, 0, -h * 0.12, -w * 0.38, -h * 0.3]).stroke({ width: 0.9 * u, color: c.trim, alpha: 0.9 });
      g.rect(-w * 0.36, -h * 0.16, w * 0.72, 2 * u).fill(c.trim);
    });
    a.torso.addChild(plate);
    const plateCrack = a.part((g) => {
      g.moveTo(w * 0.1, -h * 0.95).lineTo(-w * 0.05, -h * 0.7).lineTo(w * 0.15, -h * 0.55).lineTo(-w * 0.1, -h * 0.32).stroke({ width: 1.3 * u, color: 0xfff1c9, alpha: 1 });
      g.moveTo(-w * 0.05, -h * 0.7).lineTo(-w * 0.32, -h * 0.62).stroke({ width: 0.9 * u, color: 0xfff1c9, alpha: 0.9 });
      g.circle(0, -h * 0.62, w * 0.45).fill({ color: 0xe9c97a, alpha: 0.18 });
    });
    this.phase2(a.torso, plateCrack);
    // Pauldrons on both shoulders (they move with the arms).
    for (const side of [a.armL, a.armR]) {
      const pd = a.part((g) => {
        g.ellipse(0, 1 * u, 7.2 * u, 6 * u).fill(c.plate);
        g.ellipse(0, 1 * u, 7.2 * u, 6 * u).stroke({ width: 0.9 * u, color: c.trim, alpha: 0.9 });
        g.ellipse(-1.5 * u, -1 * u, 3 * u, 1.6 * u).fill({ color: c.light, alpha: 0.6 });
      });
      side.upper.addChild(pd);
    }
    // The mirror buckler on the guard forearm.
    const buckler = a.part((g) => {
      g.circle(0, 0, 11 * u).fill(c.plate);
      g.circle(0, 0, 9 * u).fill(c.light);
      g.poly([-6 * u, -6 * u, -2 * u, -8.5 * u, 5 * u, 6 * u, 1 * u, 8 * u]).fill({ color: 0xffffff, alpha: 0.55 });
      g.circle(0, 0, 11 * u).stroke({ width: 1.4 * u, color: c.trim, alpha: 1 });
    });
    buckler.position.set(0, a.lowerArm * 0.55);
    a.armL.lower.addChild(buckler);
    const bucklerCrack = a.part((g) => {
      g.moveTo(-8 * u, -4 * u).lineTo(-1 * u, 0).lineTo(-4 * u, 7 * u).moveTo(-1 * u, 0).lineTo(7 * u, -3 * u).stroke({ width: 1 * u, color: 0xfff1c9, alpha: 1 });
    });
    bucklerCrack.position.copyFrom(buckler.position);
    this.phase2(a.armL.lower, bucklerCrack);
    // Phase two: shards of mirror orbit the knight (outside the body: they do not flip with it).
    this.orbit.label = NO_WHITE;
    for (let i = 0; i < 4; i++) {
      const s = a.part((g) => {
        g.poly([0, -4 * u, 2.4 * u, 1 * u, -0.6 * u, 4 * u, -2.6 * u, 0]).fill({ color: c.light, alpha: 0.95 });
        g.poly([0, -4 * u, 2.4 * u, 1 * u, -0.6 * u, 4 * u, -2.6 * u, 0]).stroke({ width: 0.6 * u, color: c.trim, alpha: 0.9 });
      });
      this.shards.push(s);
      this.orbit.addChild(s);
    }
    a.root.addChild(this.orbit);
  }

  // ------------------------------------------------------------------ the Storm Titan

  private titan(): void {
    const a = this.a;
    const { u, headR: r, torsoW: w, torsoH: h } = a;
    const c = regaliaColors("storm_titan", a.shadow);
    // The thunderhead on its back, behind everything on the torso.
    const cloud = new Container();
    cloud.label = NO_WHITE;
    cloud.position.set(-w * 0.25, -h * 1.05);
    // In the army the storm is carried, not worn as a wall: smaller and thinner, never hiding the warrior.
    this.cloudScale = a.shadow ? 0.68 : 1;
    if (a.shadow) cloud.alpha = 0.8;
    const cloudBody = a.shadow ? 0x555d6c : 0x1a2733;
    const cloudRim = a.shadow ? 0x8a93a3 : 0x3b5266;
    const mass = a.part((g) => {
      const puffs: [number, number, number][] = [
        [-w * 0.9, h * 0.1, w * 0.55],
        [-w * 0.35, -h * 0.35, w * 0.7],
        [w * 0.35, -h * 0.5, w * 0.62],
        [w * 0.95, -h * 0.15, w * 0.48],
        [-w * 1.25, -h * 0.3, w * 0.4],
        [w * 0.05, -h * 0.95, w * 0.5],
        [-w * 0.7, -h * 0.85, w * 0.42],
      ];
      for (const [x, y, rr] of puffs) g.circle(x, y, rr * 1.06).fill({ color: cloudRim, alpha: 0.9 });
      for (const [x, y, rr] of puffs) g.circle(x + rr * 0.06, y + rr * 0.08, rr).fill(cloudBody);
      // Rain hanging from its belly.
      for (let i = 0; i < 9; i++) {
        const x = -w * 1.3 + (i / 8) * w * 2.4;
        g.moveTo(x, h * 0.25).lineTo(x - 2 * u, h * (0.55 + (i % 3) * 0.12)).stroke({ width: 0.7 * u, color: c.trim, alpha: 0.35 });
      }
    });
    cloud.addChild(mass);
    // Lightning living in it: three bolts, shown one at a time.
    const boltPaths: [number, number][][] = [
      [[-w * 0.6, -h * 0.6], [-w * 0.4, -h * 0.3], [-w * 0.7, -h * 0.05], [-w * 0.45, h * 0.2]],
      [[w * 0.3, -h * 0.9], [w * 0.55, -h * 0.55], [w * 0.25, -h * 0.4], [w * 0.5, -h * 0.05]],
      [[-w * 1.1, -h * 0.4], [-w * 0.85, -h * 0.55], [-w * 0.2, -h * 0.65], [w * 0.2, -h * 0.25], [w * 0.75, -h * 0.35]],
    ];
    for (const path of boltPaths) {
      const b = a.part((g) => {
        g.moveTo(path[0]![0], path[0]![1]);
        for (const [x, y] of path.slice(1)) g.lineTo(x, y);
        g.stroke({ width: 3.6 * u, color: c.trim, alpha: 0.45 });
        g.moveTo(path[0]![0], path[0]![1]);
        for (const [x, y] of path.slice(1)) g.lineTo(x, y);
        g.stroke({ width: 1.3 * u, color: c.light, alpha: 1 });
        g.circle(path[1]![0], path[1]![1], w * 0.35).fill({ color: c.trim, alpha: 0.18 });
      });
      b.visible = false;
      this.bolts.push(b);
      cloud.addChild(b);
    }
    // Phase two: the storm burns white at its edges.
    const burn = a.part((g) => {
      g.circle(-w * 0.35, -h * 0.35, w * 1.25).stroke({ width: 1.6 * u, color: c.light, alpha: 0.35 });
      g.circle(w * 0.35, -h * 0.5, w * 0.8).stroke({ width: 1.2 * u, color: c.trim, alpha: 0.5 });
    });
    this.phase2(cloud, burn);
    a.torso.addChildAt(cloud, 0);
    this.cloud = cloud;
    // A hunched yoke of drowned stone over the shoulders, a chain across the chest.
    const yoke = a.part((g) => {
      g.poly([-w * 0.75, -h * 0.85, -w * 0.4, -h * 1.12, w * 0.45, -h * 1.12, w * 0.8, -h * 0.85, w * 0.5, -h * 0.72, -w * 0.5, -h * 0.72]).fill(c.plate);
      for (let i = 0; i < 6; i++) g.circle(-w * 0.45 + i * w * 0.18, -h * (0.62 - 0.07 * Math.sin((i / 5) * Math.PI)), 1.7 * u).stroke({ width: 1 * u, color: lighten(c.plate, 0.35), alpha: 0.9 });
      g.circle(0, -h * 0.58, w * 0.13).fill({ color: c.light, alpha: 0.95 });
      g.circle(0, -h * 0.58, w * 0.26).fill({ color: c.trim, alpha: 0.25 });
    });
    a.torso.addChild(yoke);
    // A crown of drowned coral.
    const coral = a.part((g) => {
      const base = -r * 0.7;
      g.poly([-r * 1.0, base, -r * 1.25, base - r * 1.1, -r * 0.7, base - r * 0.45, -r * 0.45, base - r * 1.5, -r * 0.1, base - r * 0.5, r * 0.3, base - r * 1.25, r * 0.6, base - r * 0.4, r * 1.15, base - r * 0.95, r * 1.0, base]).fill(c.plate);
      for (const [x, y] of [[-r * 1.25, base - r * 1.1], [-r * 0.45, base - r * 1.5], [r * 0.3, base - r * 1.25], [r * 1.15, base - r * 0.95]] as const) g.circle(x, y, 1.4 * u).fill({ color: c.trim, alpha: 0.95 });
    });
    a.head.addChildAt(coral, 0);
    // Phase two: arcs crawl up both arms.
    for (const side of [a.armL, a.armR]) {
      for (let k = 0; k < 2; k++) {
        const arc = a.part((g) => {
          const L = a.upperArm;
          g.moveTo(-2 * u, 0).lineTo(3 * u, L * 0.3).lineTo(-3 * u, L * 0.55).lineTo(2.5 * u, L * 0.85).stroke({ width: 1.2 * u, color: c.light, alpha: 1 });
          g.moveTo(-2 * u, 0).lineTo(3 * u, L * 0.3).lineTo(-3 * u, L * 0.55).lineTo(2.5 * u, L * 0.85).stroke({ width: 3.4 * u, color: c.trim, alpha: 0.35 });
        });
        arc.scale.x = k === 0 ? 1 : -1;
        arc.visible = false;
        this.arcs.push(arc);
        const holder = new Container();
        holder.label = NO_WHITE;
        holder.addChild(arc);
        side.upper.addChild(holder);
      }
    }
  }

  // ------------------------------------------------------------------ the Void Queen

  private queen(): void {
    const a = this.a;
    const { u, headR: r, torsoW: w, torsoH: h } = a;
    const c = regaliaColors("void_queen", a.shadow);
    const violet = a.shadow ? a.accent : 0x7a4fc0;
    // The halo behind the head (phase one) and the black sun (phase two).
    const halo = a.part((g) => {
      g.circle(-r * 0.2, -r * 0.6, r * 2.3).stroke({ width: 1.2 * u, color: c.trim, alpha: 0.95 });
      g.circle(-r * 0.2, -r * 0.6, r * 2.05).stroke({ width: 0.6 * u, color: c.trim, alpha: 0.55 });
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2;
        g.moveTo(-r * 0.2 + Math.cos(ang) * r * 2.3, -r * 0.6 + Math.sin(ang) * r * 2.3).lineTo(-r * 0.2 + Math.cos(ang) * r * 2.75, -r * 0.6 + Math.sin(ang) * r * 2.75);
      }
      g.stroke({ width: 0.8 * u, color: c.trim, alpha: 0.8 });
    });
    const sun = a.part((g) => {
      g.circle(-r * 0.2, -r * 0.6, r * 2.9).fill({ color: violet, alpha: 0.22 });
      g.circle(-r * 0.2, -r * 0.6, r * 2.45).fill({ color: lighten(violet, 0.35), alpha: 0.55 });
      g.circle(-r * 0.2, -r * 0.6, r * 2.2).fill(0x050308);
      g.circle(-r * 0.2, -r * 0.6, r * 2.2).stroke({ width: 1 * u, color: c.light, alpha: 0.95 });
    });
    this.phase1(a.head, halo, 0);
    this.phase2(a.head, sun, 0);
    // A veil falling behind the head.
    const veil = a.part((g) => {
      g.poly([-r * 0.9, -r * 0.6, r * 0.4, -r * 0.9, -r * 0.3, r * 2.6, -r * 2.2, r * 3.4]).fill({ color: lighten(c.plate, 0.12), alpha: 0.7 });
    });
    a.head.addChildAt(veil, 1);
    // The crown: tall ink spikes with violet gems (taller in phase two).
    const spikes = (tall: number) =>
      a.part((g) => {
        const base = -r * 0.75;
        const pts: number[] = [-r * 0.95, base];
        const n = 5;
        for (let i = 0; i < n; i++) {
          const x0 = -r * 0.95 + ((i + 0.5) / n) * r * 1.9;
          const hgt = r * (i === 2 ? 2.2 : i === 1 || i === 3 ? 1.6 : 1.1) * tall;
          pts.push(x0 - r * 0.16, base - r * 0.15, x0, base - hgt, x0 + r * 0.16, base - r * 0.15);
        }
        pts.push(r * 0.95, base);
        g.poly(pts).fill(a.shadow ? 0x3a3f4c : 0x0d0a14);
        g.poly(pts).stroke({ width: 0.8 * u, color: c.trim, alpha: 0.9 });
        g.rect(-r * 0.95, base - r * 0.1, r * 1.9, r * 0.28).fill(c.trim);
        g.circle(0, base - r * 0.55, r * 0.2).fill({ color: lighten(violet, 0.3), alpha: 1 });
      });
    this.phase1(a.head, spikes(1));
    this.phase2(a.head, spikes(1.45));
    // A high collar flaring behind the head, and a sash.
    const collar = a.part((g) => {
      g.poly([-w * 0.55, -h * 0.95, -w * 0.95, -h * 1.55, -w * 0.25, -h * 1.05, w * 0.25, -h * 1.05, w * 0.7, -h * 1.45, w * 0.5, -h * 0.95]).fill(c.plate);
      g.poly([-w * 0.55, -h * 0.95, -w * 0.95, -h * 1.55, -w * 0.25, -h * 1.05, w * 0.25, -h * 1.05, w * 0.7, -h * 1.45, w * 0.5, -h * 0.95]).stroke({ width: 0.8 * u, color: c.trim, alpha: 0.85 });
      g.poly([-w * 0.12, -h * 0.9, w * 0.12, -h * 0.9, w * 0.32, h * 0.9, -w * 0.32, h * 0.9]).fill({ color: violet, alpha: 0.7 });
    });
    a.torso.addChildAt(collar, 0);
    // A long train sweeping behind (hung from the hips, under the robe).
    const train = a.part((g) => {
      g.poly([-w * 0.6, -h * 0.1, -w * 0.2, -h * 0.05, -w * 1.6, h * 1.25, -w * 3.4, h * 1.55, -w * 2.6, h * 1.05]).fill(a.shadow ? lighten(a.body0, 0.06) : 0x120c1b);
      g.moveTo(-w * 1.6, h * 1.25).lineTo(-w * 3.4, h * 1.55).stroke({ width: 1 * u, color: c.trim, alpha: 0.8 });
    });
    a.hips.addChildAt(train, 0);
    // Phase two: the hem frays into tendrils of void.
    const tendrils = a.part((g) => {
      for (let i = 0; i < 6; i++) {
        const x = -w * 1.0 + (i / 5) * w * 2.0;
        g.poly([x - 2.5 * u, h * 0.9, x + 2.5 * u, h * 0.9, x + (i % 2 ? 4 : -4) * u, h * (1.5 + (i % 3) * 0.2)]).fill({ color: 0x050308, alpha: 0.95 });
        g.moveTo(x, h * 0.95).lineTo(x + (i % 2 ? 4 : -4) * u, h * (1.5 + (i % 3) * 0.2)).stroke({ width: 0.7 * u, color: lighten(violet, 0.3), alpha: 0.8 });
      }
    });
    this.phase2(a.torso, tendrils);
  }

  // ------------------------------------------------------------------ the army's shadow forms

  /** A crown of light over the shadow (its sovereign presence), and the Queen's court behind her. */
  private shadowCrown(): void {
    const a = this.a;
    const u = a.u;
    const holder = new Container();
    holder.label = NO_WHITE;
    const glow = a.part((g) => {
      g.ellipse(0, 0, 9 * u, 3.2 * u).stroke({ width: 1.4 * u, color: 0xfff1c9, alpha: 0.95 });
      g.ellipse(0, 0, 12 * u, 4.6 * u).fill({ color: a.accent, alpha: 0.16 });
      for (let i = 0; i < 5; i++) g.circle(-8 * u + i * 4 * u, -2.5 * u - (i === 2 ? 2 : 0) * u, 0.9 * u).fill({ color: 0xfff1c9, alpha: 1 });
    });
    holder.addChild(glow);
    holder.position.set(0, -a.headR * 2.4);
    a.head.addChild(holder);
    this.crownLight = glow;
    if (this.kind === "void_queen") {
      // Two kneeling court shadows at her back, faint: her court follows her into the army.
      const court = new Container();
      court.label = NO_WHITE;
      const kneel = (x: number) =>
        a.part((g) => {
          g.circle(x, -26 * u, 5 * u).fill(lighten(a.body0, 0.05));
          g.poly([x - 6 * u, -21 * u, x + 6 * u, -21 * u, x + 9 * u, -2 * u, x - 9 * u, -2 * u]).fill(lighten(a.body0, 0.05));
          g.poly([x - 6 * u, -21 * u, x + 6 * u, -21 * u, x + 9 * u, -2 * u, x - 9 * u, -2 * u]).stroke({ width: 0.8 * u, color: a.accent, alpha: 0.7 });
          g.circle(x + 2 * u, -26 * u, 1.2 * u).fill({ color: 0xfff1c9, alpha: 0.9 });
        });
      court.addChild(kneel(-30 * u), kneel(30 * u));
      a.root.addChildAt(court, 0);
      this.court = court;
    }
  }

  private phase2(parent: Container, g: Graphics, index = -1): void {
    const holder = new Container();
    holder.addChild(g);
    if (index >= 0) parent.addChildAt(holder, index);
    else parent.addChild(holder);
    this.p2.push(holder);
  }

  private phase1(parent: Container, g: Graphics, index = -1): void {
    const holder = new Container();
    holder.addChild(g);
    if (index >= 0) parent.addChildAt(holder, index);
    else parent.addChild(holder);
    this.p1.push(holder);
  }
}

function frac(v: number): number {
  return v - Math.floor(v);
}
