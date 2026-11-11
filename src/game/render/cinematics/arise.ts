import { Container, Graphics, Sprite } from "pixi.js";
import { Timeline } from "../anim/Timeline";
import { Rig } from "../rigs/Rig";
import { summonSpec } from "../rigs/specs";
import { hardCircle, shard, softCircle } from "../textures";
import { easeInCubic, easeInOutSine, easeOutBack, easeOutCubic } from "../anim/ease";
import { RARITY_COLOR, lighten, mix } from "../colors";
import type { Camera } from "../Camera";
import type { EmitOptions, ParticleSystem } from "../Particles";

/**
 * BIND / ARISE: the shadow rises in the scene itself, staged by rarity in shape and staging, not
 * only colour (blueprint section 9).
 *
 *   quick      a duplicate (or Quick reveals): claim, then the oath on a figure already standing.
 *   common     0.9s  pool, rise 0.4s, eyes light, one ripple.
 *   rare       1.6s  wider pool, field dims, push-in, rise 0.6s between two seams of light,
 *                    a stop, eyes ignite, a ring, the seams close.
 *   epic       2.3s  the backdrop turns to night, ink runs to the pool from four sides, three
 *                    afterimages converge as it rises, violet lightning forks into it, trauma.
 *   legendary  3.6s  the field goes ink black with one gold horizon line, a gold oath-ring draws
 *                    itself clockwise, a slow rise in gold dust, the ring breaks outward as
 *                    shards, colour returns from the centre outward.
 *
 * The figure stands at 2.1x a normal figure in the upper part of the battlefield, so the
 * interface's sheet can sit below it. Everything is built on one Timeline that owns its display
 * objects; skipping jumps to the naming beat, and reduced motion lands there with a 200ms fade.
 */

import { REDUCED_FADE, REVEAL_LENGTH, SKIP_AFTER, selectReveal, type AriseCue, type RevealInput, type RevealStaging } from "./reveal";

export { REDUCED_FADE, REVEAL_LENGTH, SKIP_AFTER, selectReveal, type AriseCue, type RevealInput, type RevealStaging } from "./reveal";

/** The figure is drawn at this multiple of a normal figure. */
export const ARISE_SCALE = 2.1;

export interface AriseHost {
  readonly camera: Camera;
  readonly particles: ParticleSystem;
  /** Where the cinematic's display objects go (the camera layer, above the fight). */
  readonly layer: Container;
  /** Canvas size in CSS px. */
  viewSize(out: { w: number; h: number; inset: number }): void;
  /** Rig px per rig unit of a normal figure at mid depth (base px). */
  normalFigureScale(): number;
  /** The warrior's hand in base px (false when there is no warrior on the field). */
  warriorHand(out: { x: number; y: number }): boolean;
  /** Hold the warrior in the raised-hand claim pose (or release it). */
  claimPose(on: boolean): void;
  /** A global stop of `seconds` (the fight and effects hold; the camera keeps moving). */
  freeze(seconds: number): void;
  flash(color: number, alpha: number, duration: number): void;
  /** Wash the backdrop toward `color` by `amount` (0 restores it). */
  tintBackdrop(color: number, amount: number): void;
  cue(name: AriseCue, staging: RevealStaging, rarity: string): void;
  /** The sequence reached its naming beat. */
  named(): void;
}

export interface AriseOptions extends RevealInput {
  summonId: string;
  /** Where the essence was (world position already mapped to base px). */
  orbX: number;
  orbY: number;
  reduced: boolean;
}

const INK = 0x050407;
const GOLD = 0xe9c56f;
const SILHOUETTE = 0x0b0b12;
const NIGHT = 0x1b2440;
const VIOLET = 0xb595e6;

export class AriseCinematic {
  readonly tl: Timeline;
  readonly staging: RevealStaging;
  readonly root = new Container();
  private readonly stage = new Container();
  private readonly figure = new Container();
  private readonly back = new Container();
  private readonly dim = new Graphics();
  private readonly fx = new Graphics();
  private readonly ringG = new Graphics();
  private readonly mask = new Graphics();
  private readonly rig: Rig;
  private readonly ghosts: Rig[] = [];
  private readonly eyeGlow = new Sprite(softCircle());
  private readonly eyeCore = new Sprite(hardCircle());
  private readonly mote = new Sprite(softCircle());
  private readonly moteCore = new Sprite(hardCircle());
  private readonly poolG = new Graphics();
  private readonly poolGlow = new Sprite(softCircle());
  private ink: Graphics | null = null;
  private bolts: Graphics | null = null;
  private seams: Graphics | null = null;
  private readonly host: AriseHost;
  private readonly color: number;
  private readonly eyeColor: number;
  private readonly rarity: string;
  /** Screen px per stage unit is 1 at the start; base px per stage unit is 1 / z0. */
  private readonly z0: number;
  private readonly bx: number;
  private readonly by: number;
  private readonly vw: number;
  private readonly vh: number;
  /** Figure scale (stage px per rig unit), height and the pool radius, in stage px. */
  private k: number;
  private readonly figH: number;
  private readonly R: number;
  // Live state the timeline drives.
  private rise = 0;
  private silhouette = 1;
  private eyes = 0;
  private poolK = 0;
  private poolCollapse = 0;
  private hold = 0;
  private pose: "idle" | "victory" = "idle";
  private poseT = 0;
  private rippleT = -1;
  private ringT = -1;
  private oathRing = 0;
  private oathRingAlpha = 0;
  private reveal = -1;
  private horizon = 0;
  private horizonAlpha = 0;
  private inkRun = -1;
  private ghostK = -1;
  private dust = false;
  private moteK = 0;
  private moteDive = 0;
  private readonly hand = { x: 0, y: 0 };
  private readonly pt = { x: 0, y: 0 };
  private readonly emit: EmitOptions = { x: 0, y: 0, count: 1, texture: softCircle(), color: 0xffffff, speed: [0, 0], life: [0.5, 1], scale: [0.1, 0.2] };
  private ending = -1;
  private namedFired = false;
  private reducedT = -1;
  disposed = false;

  constructor(host: AriseHost, o: AriseOptions) {
    this.host = host;
    this.staging = selectReveal(o);
    this.rarity = o.rarity;
    this.color = RARITY_COLOR[o.rarity] ?? 0xe9c97a;
    const spec = summonSpec(o.summonId);
    this.eyeColor = lighten(spec.eye, 0.35);
    const tl = (this.tl = new Timeline(REVEAL_LENGTH[this.staging]));
    tl.own(this.root);

    // Stage: a ground point in the upper part of the battlefield, one stage unit = one screen px.
    const size = { w: 0, h: 0, inset: 0 };
    host.viewSize(size);
    this.vw = size.w;
    this.vh = size.h;
    const cam = host.camera;
    this.z0 = cam.scale;
    this.rig = new Rig(spec);
    this.k = ARISE_SCALE * host.normalFigureScale() * this.z0;
    const usable = Math.max(120, size.h - size.inset);
    const gy = Math.min(size.h * 0.62, usable * 0.86);
    // Big species (a Warden, the Herald) are held to 1.25x a standard figure at this scale, and
    // every figure keeps its head (and a raised weapon, hood or crown) on screen through the
    // push-in: room above the ground line divided by the push and a margin for what sticks out.
    const stdTop = 83;
    const push = this.staging === "rare" ? 1.25 : this.staging === "epic" ? 1.12 : this.staging === "legendary" ? 1.1 : 1;
    const maxH = Math.min(stdTop * this.k * 1.25, (gy - size.h * 0.06) / (push * 1.22));
    if (this.rig.top * this.k > maxH) this.k = maxH / this.rig.top;
    const figH = this.rig.top * this.k;
    this.figH = figH;
    // Centred, but stepped aside from the warrior so the claim and the figure do not overlap.
    let sxScreen = size.w / 2;
    if (host.warriorHand(this.hand)) {
      cam.project(this.hand.x, this.hand.y, this.pt);
      const off = this.pt.x - size.w / 2;
      const need = figH * 0.45;
      if (Math.abs(off) < need) sxScreen = size.w / 2 - Math.sign(off || 1) * (need - Math.abs(off)) * 0.8;
    }
    cam.unproject(sxScreen, gy, this.pt);
    this.bx = this.pt.x;
    this.by = this.pt.y;
    const figW = figH * 0.42;
    const wide = this.staging === "rare" ? 1.4 : this.staging === "epic" ? 1.5 : this.staging === "legendary" ? 1.55 : this.staging === "quick" ? 0.75 : 1;
    this.R = figW * 0.62 * wide;

    // The dim covers the whole view at any push or shake: drawn in base px around the visible box.
    const vis = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    cam.visible(vis);
    const vwB = vis.maxX - vis.minX;
    const vhB = vis.maxY - vis.minY;
    this.dim.rect(vis.minX - vwB, vis.minY - vhB, vwB * 3, vhB * 3).fill(0x020206);
    this.dim.alpha = 0;
    this.root.addChild(this.dim);
    if (this.staging === "legendary") {
      this.ink = new Graphics();
      this.ink.alpha = 0;
      this.drawInk(0);
      this.root.addChild(this.ink);
    }
    this.stage.position.set(this.bx, this.by);
    this.stage.scale.set(1 / this.z0);
    this.root.addChild(this.stage);

    // Pool, effects behind the figure, the figure (masked at ground level), effects in front.
    this.poolGlow.anchor.set(0.5);
    this.poolGlow.blendMode = "add";
    this.poolGlow.tint = this.color;
    this.poolGlow.alpha = 0;
    this.stage.addChild(this.poolGlow, this.poolG, this.back, this.ringG);
    this.mask.rect(-size.w * 2, -size.h * 3, size.w * 4, size.h * 3).fill(0xffffff);
    this.stage.addChild(this.mask);
    this.figure.mask = this.mask;
    this.stage.addChild(this.figure);
    if (this.staging === "epic") {
      for (let i = 0; i < 2; i++) {
        const g = new Rig(spec);
        g.root.tint = this.color;
        g.root.alpha = 0;
        g.root.scale.set(this.k);
        this.ghosts.push(g);
        this.figure.addChild(g.root);
      }
    }
    this.rig.root.scale.set(this.k);
    this.rig.root.tint = SILHOUETTE;
    this.figure.addChild(this.rig.root);
    for (const s of [this.eyeGlow, this.eyeCore, this.mote, this.moteCore]) {
      s.anchor.set(0.5);
      s.blendMode = "add";
      s.alpha = 0;
    }
    this.eyeGlow.tint = this.eyeColor;
    this.eyeCore.tint = 0xffffff;
    this.mote.tint = this.color;
    this.moteCore.tint = lighten(this.color, 0.6);
    this.stage.addChild(this.fx, this.eyeGlow, this.eyeCore);
    // The mote travels in base px (from the orb to the warrior's hand), so it sits outside the stage.
    this.root.addChild(this.mote, this.moteCore);
    this.mote.position.set(o.orbX, o.orbY);
    this.moteCore.position.set(o.orbX, o.orbY);
    host.layer.addChild(this.root);
    tl.onDispose(() => {
      for (const g of this.ghosts) g.destroy();
      this.rig.destroy();
      cam.cine.zoom = 1;
      cam.cine.tilt = 0;
      host.tintBackdrop(0, 0);
      host.claimPose(false);
    });

    this.build();
    if (o.reduced) {
      // Reduced motion: land on the final beat, faded in.
      this.root.alpha = 0;
      tl.skipTo("name");
      this.reducedT = 0;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // The sequence
  // ---------------------------------------------------------------------------------------------

  private build(): void {
    const tl = this.tl;
    const st = this.staging;
    const host = this.host;
    const cam = this.host.camera;
    const name = REVEAL_LENGTH[st];
    tl.label("name", name);

    // Beat 1, claim: a 40ms stop, the warrior raises a hand and the orb snaps to it.
    tl.at(0, () => {
      host.claimPose(true);
      if (st === "legendary") host.cue("duck", st, this.rarity);
      host.cue("claim", st, this.rarity);
      if (!tl.skipping) this.stop(0.04);
    });
    tl.tween(0, 0.1, easeOutCubic, (k) => (this.moteK = k));
    tl.tween(0, 0.08, null, (k) => {
      this.mote.alpha = k;
      this.moteCore.alpha = k;
    });

    if (st === "quick") {
      // Beat 4 only: the figure stands already, a silhouette; the oath lights it.
      tl.tween(0.1, 0.22, easeOutCubic, (k) => {
        this.moteDive = k;
        this.poolK = k;
        this.rise = 1;
        this.rig.root.alpha = k;
      });
      tl.tween(0.08, 0.2, null, (k) => this.fadeMote(1 - k));
      tl.at(0.25, () => {
        host.cue("oath", st, this.rarity);
        if (!tl.skipping) this.rippleT = 0;
      });
      tl.tween(0.25, 0.4, easeOutCubic, (k) => {
        this.eyes = k;
        this.silhouette = 1 - k;
      });
      tl.tween(0.25, 0.5, null, (k) => (this.dim.alpha = 0.3 * k));
      tl.at(name, () => this.fireNamed());
      return;
    }

    // Beat 2, draw. The mote dives from the hand into the pool as it spreads.
    const d0 = 0.1;
    const d1 = st === "common" ? 0.4 : st === "rare" ? 0.6 : st === "epic" ? 0.8 : 1.2;
    tl.at(d0, () => host.cue("drone", st, this.rarity));
    tl.tween(d0, d0 + 0.14, easeInCubic, (k) => (this.moteDive = k));
    tl.tween(d0 + 0.1, d0 + 0.18, null, (k) => this.fadeMote(1 - k));
    tl.tween(d0 + 0.08, d1, easeOutCubic, (k) => (this.poolK = k));
    const finalDim = st === "common" ? 0.32 : st === "rare" ? 0.5 : 0.5;
    if (st === "common") tl.tween(d0, d1, null, (k) => (this.dim.alpha = finalDim * k));
    if (st === "rare") {
      tl.tween(d0, d1, easeInOutSine, (k) => {
        this.dim.alpha = finalDim * k;
        this.push(1 + 0.25 * k);
      });
      this.seams = new Graphics();
      this.seams.blendMode = "add";
      this.back.addChild(this.seams);
    }
    if (st === "epic") {
      tl.tween(d0, d0 + 0.5, easeInOutSine, (k) => {
        host.tintBackdrop(NIGHT, 0.7 * k);
        this.dim.alpha = 0.3 * k;
        this.push(1 + 0.12 * k);
      });
      tl.tween(d0, d1, null, (k) => (this.inkRun = k));
      tl.at(d1 + 0.05, () => (this.inkRun = -1));
    }
    if (st === "legendary") {
      // The field goes to ink, a gold horizon line draws out from the centre, the oath-ring
      // draws itself clockwise around the pool.
      tl.tween(d0, d0 + 0.35, easeInCubic, (k) => {
        if (this.ink) this.ink.alpha = k;
      });
      tl.tween(0.2, 0.6, easeOutCubic, (k) => {
        this.horizon = k;
        this.horizonAlpha = 1;
      });
      tl.tween(0.3, d1, easeInOutSine, (k) => (this.oathRing = k));
      tl.tween(0.3, 0.45, null, (k) => (this.oathRingAlpha = k));
    }

    // Beat 3, rise: out of the pool, masked at ground level.
    const r0 = d1;
    const r1 = st === "common" ? 0.8 : st === "rare" ? 1.2 : st === "epic" ? 1.6 : 2.5;
    const riseEase = st === "legendary" ? easeInOutSine : easeOutCubic;
    tl.tween(r0, r1, riseEase, (k) => (this.rise = k));
    if (st === "rare") tl.tween(r0, r0 + 0.25, easeOutCubic, (k) => this.drawSeams(k, 1));
    if (st === "epic") tl.tween(r0, r1, easeInOutSine, (k) => (this.ghostK = k));
    if (st === "legendary") {
      tl.at(r0, () => (this.dust = true));
      tl.tween(r0, r1, easeInOutSine, (k) => (cam.cine.tilt = 12 * k));
      tl.tween(r0, r1, easeInOutSine, (k) => this.push(1 + 0.1 * k));
    }

    // Beat 4, oath.
    const oath = st === "epic" ? 1.75 : r1;
    tl.at(oath, () => {
      host.cue("oath", st, this.rarity);
      if (st === "legendary") {
        host.cue("pad", st, this.rarity);
        host.cue("vibrate", st, this.rarity);
      }
      this.dust = false;
      if (tl.skipping) return;
      if (st === "common") this.rippleT = 0;
      else if (st === "rare") {
        this.stop(0.08);
        this.ringT = 0;
      } else if (st === "epic") {
        this.stop(0.12);
        this.lightning();
        cam.shake(0.3);
        this.ringT = 0;
      } else {
        this.stop(0.2);
        this.breakRing();
        cam.shake(0.5);
        host.flash(GOLD, 0.07, 0.15);
        this.ringT = 0;
      }
    });
    const ignite = st === "common" ? 0.12 : 0.18;
    tl.tween(oath, oath + ignite, easeOutCubic, (k) => {
      this.eyes = k;
      this.silhouette = 1 - k;
    });
    if (st === "rare") tl.tween(oath, oath + 0.2, easeInCubic, (k) => this.drawSeams(1, 1 - k));
    if (st === "rare") tl.at(oath + 0.2, () => this.seams?.clear());
    if (st === "epic") {
      tl.tween(oath, oath + 0.4, null, (k) => {
        if (this.bolts) this.bolts.alpha = 1 - k;
      });
      tl.tween(oath, name, easeInOutSine, (k) => {
        host.tintBackdrop(NIGHT, 0.7 - 0.3 * k);
        this.dim.alpha = 0.3 + 0.15 * k;
      });
    }
    if (st === "legendary") {
      tl.at(oath, () => {
        this.pose = "victory";
        this.poseT = 0;
        this.oathRingAlpha = 0;
      });
      // Colour returns from the centre outward in 400ms; the field settles under a soft dim.
      tl.tween(oath, oath + 0.4, easeInCubic, (k) => (this.reveal = k));
      tl.tween(oath, oath + 0.4, null, (k) => {
        this.dim.alpha = 0.45 * k;
        this.horizonAlpha = 1 - k;
      });
      tl.at(oath + 0.41, () => {
        this.reveal = -1;
        if (this.ink) this.ink.visible = false;
      });
    }
    tl.at(name, () => this.fireNamed());
  }

  private fireNamed(): void {
    if (this.namedFired || this.reducedT >= 0) return;
    this.namedFired = true;
    this.host.named();
  }

  private stop(seconds: number): void {
    if (this.reducedT >= 0) return;
    this.hold = Math.max(this.hold, seconds);
    this.host.freeze(seconds);
  }

  private push(z: number): void {
    const c = this.host.camera.cine;
    c.zoom = z;
    // Push toward the figure's middle so it stays framed.
    c.fx = this.bx;
    c.fy = this.by - (this.figH * 0.5) / this.z0;
  }

  private fadeMote(a: number): void {
    this.mote.alpha = a;
    this.moteCore.alpha = a;
  }

  // ---------------------------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------------------------

  /** Tap: skip to the naming beat (only after SKIP_AFTER seconds). Returns true if it skipped. */
  skip(): boolean {
    if (this.tl.done || this.tl.t < SKIP_AFTER || this.ending >= 0) return false;
    this.tl.skipTo("name");
    return true;
  }

  /** The reveal was closed: fade out over 300ms, then dispose. */
  end(): void {
    if (this.ending < 0) this.ending = 0;
  }

  get done(): boolean {
    return this.disposed;
  }

  update(dt: number): void {
    if (this.disposed) return;
    const tl = this.tl;
    if (this.reducedT >= 0) {
      this.reducedT += dt;
      this.root.alpha = Math.min(1, this.reducedT / REDUCED_FADE);
      if (this.reducedT >= REDUCED_FADE && !this.namedFired) {
        this.namedFired = true;
        this.host.named();
      }
    }
    if (this.ending >= 0) {
      this.ending += dt;
      const k = Math.min(1, this.ending / 0.3);
      this.root.alpha = Math.min(this.root.alpha, 1 - k);
      const c = this.host.camera.cine;
      c.zoom = 1 + (c.zoom - 1) * (1 - k);
      c.tilt *= 1 - k;
      if (k >= 1) {
        this.dispose();
        return;
      }
    }
    if (this.hold > 0) this.hold -= dt;
    else tl.update(dt);
    if (this.disposed) return;
    this.animateFigure(dt);
    this.drawPool();
    this.drawFx(dt);
    this.drawRing();
    this.updateMote();
    if (this.reveal >= 0) this.drawInk(this.reveal);
  }

  private animateFigure(dt: number): void {
    const rig = this.rig;
    const rdt = this.hold > 0 ? 0 : dt;
    this.poseT += rdt;
    if (this.pose === "victory") rig.animate("victory", this.poseT, 0, 0.4, 1, false, 0, 0, rdt);
    else rig.animate("idle", 0, 0, 0.4, 1, false, 0, 0, rdt);
    // Risen from below the ground line (the mask hides what is still under it).
    const depth = (1 - this.rise) * this.figH * 1.35;
    rig.root.visible = this.rise > 0.001 || this.staging === "quick";
    rig.root.position.set(0, depth);
    rig.root.tint = mix(0xffffff, this.staging === "legendary" ? mix(SILHOUETTE, this.color, 0.5) : SILHOUETTE, this.silhouette);
    if (this.staging !== "quick") rig.root.alpha = 1;
    rig.setEyes(this.eyes);
    for (let i = 0; i < this.ghosts.length; i++) {
      const g = this.ghosts[i]!;
      g.animate("idle", 0, 0, 0.4 + i * 0.2, 1, false, 0, 0, rdt);
      const k = this.ghostK;
      if (k < 0) {
        g.root.alpha = 0;
        continue;
      }
      // Two afterimages converge into the one figure as it rises.
      const side = i === 0 ? -1 : 1;
      g.root.position.set(side * this.figH * 0.42 * (1 - k), depth + side * this.figH * 0.04 * (1 - k));
      g.root.alpha = 0.5 * Math.sin(Math.min(1, k * 1.15) * Math.PI) + (k < 0.2 ? 0.25 : 0);
      g.setEyes(0);
    }
    // Eye glow on the face.
    rig.eyePoint(this.pt);
    this.eyeGlow.position.set(this.pt.x, this.pt.y);
    this.eyeCore.position.set(this.pt.x, this.pt.y);
    const flare = this.eyes > 0 ? this.eyes * (1 + 0.6 * Math.max(0, 1 - this.eyes) + 0.08 * Math.sin(this.tl.t * 5)) : 0;
    this.eyeGlow.alpha = 0.75 * flare;
    this.eyeGlow.scale.set((this.figH / 1100) * (1 + 1.2 * (1 - Math.min(1, this.eyes))));
    this.eyeCore.alpha = flare;
    this.eyeCore.scale.set(this.figH / 2600);
    if (this.dust && rdt > 0 && Math.random() < 0.8) this.goldDust();
  }

  private drawPool(): void {
    const g = this.poolG;
    g.clear();
    const k = this.poolK * (1 - this.poolCollapse);
    if (k <= 0.001) {
      this.poolGlow.alpha = 0;
      return;
    }
    const rx = this.R * k;
    const ry = rx * 0.26;
    g.ellipse(0, 0, rx * 1.08, ry * 1.12).fill({ color: INK, alpha: 0.35 });
    g.ellipse(0, 0, rx, ry).fill({ color: INK, alpha: 0.94 });
    g.ellipse(0, 0, rx, ry).stroke({ width: 1.4, color: this.color, alpha: 0.55 * k });
    // A thin bright lip where the figure breaks the surface.
    if (this.rise > 0 && this.rise < 1) g.ellipse(0, 0, rx * 0.45, ry * 0.45).stroke({ width: 1.2, color: lighten(this.color, 0.4), alpha: 0.7 });
    this.poolGlow.alpha = 0.35 * k;
    this.poolGlow.scale.set((rx * 2.4) / 64, (ry * 3.2) / 64);
  }

  private drawFx(dt: number): void {
    const g = this.fx;
    g.clear();
    const R = this.R;
    const live = this.hold > 0 ? 0 : dt;
    if (this.rippleT >= 0) {
      this.rippleT += live;
      const k = Math.min(1, this.rippleT / 0.55);
      const r = R * (1 + 1.4 * easeOutCubic(k));
      g.ellipse(0, 0, r, r * 0.26).stroke({ width: 2 * (1 - k) + 0.5, color: lighten(this.color, 0.3), alpha: 1 - k });
      if (k >= 1) this.rippleT = -1;
    }
    if (this.ringT >= 0) {
      this.ringT += live;
      const k = Math.min(1, this.ringT / 0.6);
      const r = R * (1 + (this.staging === "legendary" ? 4 : 2.6) * easeOutCubic(k));
      const w = this.staging === "legendary" ? 5 : 3;
      g.ellipse(0, 0, r, r * 0.26).stroke({ width: w * (1 - k) + 0.5, color: this.staging === "epic" ? VIOLET : lighten(this.color, 0.4), alpha: (1 - k) * 0.95 });
      if (k >= 1) this.ringT = -1;
    }
    if (this.inkRun >= 0) this.drawInkRuns(g, this.inkRun);
    if (this.horizonAlpha > 0.01 && this.horizon > 0) {
      const half = this.vw * 0.75 * this.horizon;
      g.moveTo(-half, 0).lineTo(half, 0).stroke({ width: 7, color: GOLD, alpha: 0.18 * this.horizonAlpha });
      g.moveTo(-half, 0).lineTo(half, 0).stroke({ width: 1.4, color: lighten(GOLD, 0.3), alpha: 0.95 * this.horizonAlpha });
    }
  }

  /** Ink running along the ground into the pool from four directions. */
  private drawInkRuns(g: Graphics, k: number): void {
    const R = this.R;
    const ry = 0.26;
    // Sources at the edges of the ground plane: left, right, back and front.
    const src = INK_SOURCES;
    for (let i = 0; i < src.length; i++) {
      const s = src[i]!;
      const sx = s[0] * this.vw;
      const sy = s[1] * R;
      const kk = Math.min(1, Math.max(0, (k - i * 0.06) / 0.8));
      if (kk <= 0) continue;
      const e = easeInOutSine(kk);
      // The head runs from the source to the pool's rim.
      const ang = Math.atan2(-sy / ry, -sx);
      const ex = Math.cos(ang) * R * 0.9;
      const ey = Math.sin(ang) * R * 0.9 * ry;
      const hx = sx + (ex - sx) * e;
      const hy = sy + (ey - sy) * e;
      const tx = sx + (hx - sx) * Math.max(0, e - 0.55) * 1.6;
      const ty = sy + (hy - sy) * Math.max(0, e - 0.55) * 1.6;
      const dx = hx - tx;
      const dy = hy - ty;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const wHead = 9;
      const wTail = 3;
      g.poly([tx + nx * wTail, ty + ny * wTail * ry * 2, hx + nx * wHead, hy + ny * wHead * ry * 2, hx + dx / len * 4, hy + dy / len * 2, hx - nx * wHead, hy - ny * wHead * ry * 2, tx - nx * wTail, ty - ny * wTail * ry * 2]).fill({ color: INK, alpha: 0.9 * (1 - Math.max(0, kk - 0.9) * 10) });
    }
  }

  private drawSeams(open: number, keep: number): void {
    const g = this.seams;
    if (!g) return;
    g.clear();
    const h = this.figH * 1.55 * open;
    const w = 2.6 * keep;
    if (w <= 0.05) return;
    for (const side of [-1, 1]) {
      const x = side * this.figH * 0.36;
      g.rect(x - w * 3, -h, w * 6, h).fill({ color: this.color, alpha: 0.12 * keep });
      g.rect(x - w / 2, -h, w, h).fill({ color: lighten(this.color, 0.7), alpha: 0.9 * keep });
    }
  }

  /** Violet lightning forks along the ground into the figure (drawn once, then fades). */
  private lightning(): void {
    const g = (this.bolts = new Graphics());
    g.blendMode = "add";
    this.stage.addChildAt(g, this.stage.getChildIndex(this.figure));
    const R = this.R;
    const ends: [number, number][] = [
      [-this.vw * 0.55, R * 0.25],
      [this.vw * 0.55, -R * 0.1],
      [this.vw * 0.25, R * 0.9],
    ];
    for (const [sx, sy] of ends) {
      for (let pass = 0; pass < 2; pass++) {
        let x = sx;
        let y = sy;
        g.moveTo(x, y);
        const n = 9;
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const jx = (Math.random() - 0.5) * 18 * (1 - t);
          const jy = (Math.random() - 0.5) * 9 * (1 - t);
          x = sx + (0 - sx) * t + jx;
          y = sy + (-this.figH * 0.04 - sy) * t + jy;
          g.lineTo(x, y);
        }
        g.stroke(pass === 0 ? { width: 7, color: VIOLET, alpha: 0.35 } : { width: 1.8, color: lighten(VIOLET, 0.6), alpha: 1 });
      }
      // A short fork off the main bolt.
      const fx = sx * 0.55;
      const fy = sy * 0.55;
      g.moveTo(fx, fy).lineTo(fx + (Math.random() - 0.5) * 30, fy - 18 - Math.random() * 14).stroke({ width: 1.2, color: lighten(VIOLET, 0.5), alpha: 0.9 });
    }
    // Up the body: a strike into the figure itself.
    g.moveTo(0, -this.figH * 0.05).lineTo(-6, -this.figH * 0.4).lineTo(4, -this.figH * 0.62).lineTo(0, -this.figH * 0.9).stroke({ width: 2, color: 0xffffff, alpha: 0.85 });
    this.host.flash(VIOLET, 0.2, 0.2);
  }

  private drawRing(): void {
    const g = this.ringG;
    g.clear();
    if (this.oathRing <= 0 || this.oathRingAlpha <= 0.01) return;
    const rx = this.R * 1.32;
    const ry = rx * 0.27;
    const end = this.oathRing * Math.PI * 2;
    const a0 = -Math.PI / 2;
    const n = Math.max(2, Math.ceil(56 * this.oathRing));
    for (let pass = 0; pass < 2; pass++) {
      g.moveTo(Math.cos(a0) * rx, Math.sin(a0) * ry);
      for (let i = 1; i <= n; i++) {
        const a = a0 + (end * i) / n;
        g.lineTo(Math.cos(a) * rx, Math.sin(a) * ry);
      }
      g.stroke(pass === 0 ? { width: 6, color: GOLD, alpha: 0.16 * this.oathRingAlpha } : { width: 1.6, color: lighten(GOLD, 0.25), alpha: 0.95 * this.oathRingAlpha });
    }
    // Twelve oath marks appear as the ring passes them.
    for (let i = 0; i < 12; i++) {
      const a = a0 + (i / 12) * Math.PI * 2;
      if (a - a0 > end) break;
      const c = Math.cos(a);
      const s = Math.sin(a);
      g.moveTo(c * rx * 1.04, s * ry * 1.04).lineTo(c * rx * 1.14, s * ry * 1.14).stroke({ width: 1.3, color: GOLD, alpha: 0.85 * this.oathRingAlpha });
    }
    // The drawing head burns brighter.
    if (this.oathRing < 1) {
      const a = a0 + end;
      g.circle(Math.cos(a) * rx, Math.sin(a) * ry, 2.4).fill({ color: 0xfff6dc, alpha: this.oathRingAlpha });
    }
  }

  /** The ring flares and breaks outward as shards. */
  private breakRing(): void {
    const rx = this.R * 1.32;
    const ry = rx * 0.27;
    const o = this.emit;
    const inv = 1 / this.z0;
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      o.x = this.bx + Math.cos(a) * rx * inv;
      o.y = this.by + Math.sin(a) * ry * inv;
      o.count = 1;
      o.texture = shard();
      o.color = i % 3 === 0 ? 0xfff1c9 : GOLD;
      o.speed = [160 * inv, 320 * inv];
      o.angle = [a - 0.25, a + 0.25];
      o.life = [0.5, 0.9];
      o.scale = [0.3 * inv * 1.3, 0.6 * inv * 1.3];
      o.endScale = 0;
      o.alpha = 1;
      o.gravity = 120 * inv;
      o.drag = 0.9;
      o.spin = 10;
      o.additive = true;
      o.alignToVelocity = false;
      this.host.particles.emit(o);
    }
  }

  private goldDust(): void {
    const o = this.emit;
    const inv = 1 / this.z0;
    o.x = this.bx + (Math.random() - 0.5) * this.R * 1.6 * inv;
    o.y = this.by - Math.random() * 6 * inv;
    o.count = 1;
    o.texture = softCircle();
    o.color = Math.random() < 0.3 ? 0xfff1c9 : GOLD;
    o.speed = [20 * inv, 60 * inv];
    o.angle = [-Math.PI * 0.62, -Math.PI * 0.38];
    o.life = [0.8, 1.5];
    o.scale = [0.06, 0.16];
    o.endScale = 0;
    o.alpha = 0.95;
    o.gravity = -30 * inv;
    o.drag = 0.97;
    o.spin = 0;
    o.additive = true;
    this.host.particles.emit(o);
  }

  private updateMote(): void {
    if (this.mote.alpha <= 0.001) return;
    const host = this.host;
    const hasHand = host.warriorHand(this.hand);
    const ox = this.mote.x;
    const oy = this.mote.y;
    let x = ox;
    let y = oy;
    if (hasHand && this.moteDive <= 0) {
      // Snap toward the raised hand.
      x = ox + (this.hand.x - ox) * this.moteK;
      y = oy + (this.hand.y - 6 - oy) * this.moteK;
    } else {
      // Dive from the hand (or where it was) to the pool.
      const fromX = hasHand ? this.hand.x : ox;
      const fromY = hasHand ? this.hand.y - 6 : oy;
      const k = this.moteDive;
      x = fromX + (this.bx - fromX) * k;
      y = fromY + (this.by - fromY) * k - Math.sin(k * Math.PI) * 24 / this.z0;
    }
    this.mote.position.set(x, y);
    this.moteCore.position.set(x, y);
    const s = (this.figH / 900 / this.z0) * (this.staging === "legendary" ? 1.4 : 1);
    this.mote.scale.set(s * 3.2);
    this.moteCore.scale.set(s * 0.9);
  }

  /** The legendary ink field; with `reveal` >= 0 colour returns through a hole from the centre. */
  private drawInk(reveal: number): void {
    const g = this.ink;
    if (!g) return;
    const cam = this.host.camera;
    const vis = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    cam.visible(vis);
    const w = vis.maxX - vis.minX;
    const h = vis.maxY - vis.minY;
    g.clear();
    g.rect(vis.minX - w, vis.minY - h, w * 3, h * 3).fill(INK);
    if (reveal > 0) {
      const cx = this.bx;
      const cy = this.by - (this.figH * 0.5) / this.z0;
      const r = Math.hypot(w, h) * reveal;
      g.ellipse(cx, cy, r, r * 0.8).cut();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.tl.dispose();
  }
}

/** Where the four ink runs start: x as a fraction of the view width, y in pool radii (ground plane). */
const INK_SOURCES: readonly (readonly [number, number])[] = [
  [-0.62, 0.3],
  [0.62, -0.2],
  [-0.28, -1.6],
  [0.3, 2.2],
];

/**
 * A failed BIND: the pool opens under the essence and collapses inward with a dry crack (0.5s).
 * Owns its display objects; the renderer updates and disposes it.
 */
export class FailedBind {
  readonly tl = new Timeline(0.5);
  private readonly g = new Graphics();

  constructor(layer: Container, x: number, y: number, r: number, onCrack: () => void, particles: ParticleSystem, reduced: boolean) {
    const g = this.g;
    layer.addChild(g);
    this.tl.own(g);
    this.tl.disposeOnDone = true;
    const draw = (open: number, collapse: number, crack: number) => {
      g.clear();
      const rx = r * open * (1 - collapse);
      if (rx > 0.3) {
        g.ellipse(x, y, rx, rx * 0.28).fill({ color: INK, alpha: 0.9 });
        g.ellipse(x, y, rx, rx * 0.28).stroke({ width: 1.2, color: 0xd9cdb2, alpha: 0.4 * (1 - collapse) });
      }
      if (crack > 0 && crack < 1) {
        // Six dry cracks are drawn inward with the collapse.
        const len = r * 0.5 * (1 - crack);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + 0.3;
          const ox = Math.cos(a) * r * (1.05 - 0.6 * crack);
          const oy = Math.sin(a) * r * 0.28 * (1.05 - 0.6 * crack);
          g.moveTo(x + ox, y + oy).lineTo(x + ox - Math.cos(a) * len, y + oy - Math.sin(a) * len * 0.28).stroke({ width: 1.4, color: 0xe8e0cc, alpha: 0.85 * (1 - crack) });
        }
      }
    };
    let open = 0;
    let collapse = 0;
    let crack = 0;
    this.tl.tween(0, 0.14, easeOutBack, (k) => (open = k));
    this.tl.at(0.14, () => {
      onCrack();
      if (!reduced) particles.emit({ x, y: y - 2, count: 10, texture: shard(), color: 0x2a2840, speed: [20, 70], life: [0.2, 0.4], scale: [0.2, 0.4], endScale: 0, alpha: 0.9, additive: false, spread: r, target: { x, y, strength: 30 } });
    });
    this.tl.tween(0.14, 0.46, easeInCubic, (k) => {
      collapse = k;
      crack = k;
    });
    this.tl.tween(0, 0.5, null, () => draw(open, collapse, crack));
  }

  update(dt: number): void {
    this.tl.update(dt);
  }

  get done(): boolean {
    return this.tl.disposed;
  }

  dispose(): void {
    this.tl.dispose();
  }
}
