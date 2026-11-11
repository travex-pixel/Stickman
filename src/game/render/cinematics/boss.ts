import { Container, Graphics, Sprite } from "pixi.js";
import { Timeline } from "../anim/Timeline";
import { DEATH_KNEEL, Rig } from "../rigs/Rig";
import { enemySpec } from "../rigs/specs";
import { shard, softCircle } from "../textures";
import { easeInCubic, easeInOutSine, easeOutBack, easeOutCubic } from "../anim/ease";
import { lighten } from "../colors";
import type { Camera } from "../Camera";
import type { EmitOptions, ParticleSystem } from "../Particles";

/**
 * Boss sequences (blueprint section 7D), all render-side and inside the simulation's own timers.
 *
 *  Entrance (the sim's fixed 2.4s `boss_intro`): letterbox bars, the field dims, the camera pans
 *  and zooms onto the spawn point; at 0.3s the boss emerges by kind (a Warden rises from a
 *  widening fissure, the Drowned Warden surfaces through an expanding water ring, the Ember
 *  Herald descends in a column of embers, the Crownless King walks out of a gold horizon flare
 *  as two banners unfurl); an impact beat at 1.1s; release to fight framing by 2.4s.
 *
 *  Death: an inverted impact frame (the boss white on black), then the boss kneels, cracks of its
 *  glow spread over it and it breaks upward into shards; a slow full-width ring; motes drift.
 */

export type BossKind = "warden" | "drowned" | "herald" | "king";

export function bossKind(defId: string): BossKind {
  if (defId === "drowned_warden") return "drowned";
  if (defId === "ember_herald") return "herald";
  if (defId === "crownless_king") return "king";
  return "warden";
}

/** The entrance's beats (seconds from `boss_intro`). */
export const ENTRANCE = { length: 2.4, emerge: 0.3, impact: 1.1, release: 2.0, zoom: 1.3 } as const;
/** The death sequence: inverted frames, then 1.2s of kneel and break. */
export const DEATH = { inverted: 2 / 60, breakAt: 0.95, length: 2.6, zoom: 1.35 } as const;

export interface BossHost {
  readonly camera: Camera;
  readonly particles: ParticleSystem;
  /** Camera layer for the boss's own effects (base px). */
  readonly layer: Container;
  isReduced(): boolean;
  /** Global stop (seconds); the renderer skips it under reduced motion. */
  freeze(seconds: number): void;
  /** Letterbox bars: target height in px (0 retracts). */
  letterbox(px: number): void;
  /** Dim everything but the boss by `amount` (0..1). */
  dimOthers(amount: number): void;
  /** A full-width ring in the boss's colour. */
  ring(x: number, y: number, r0: number, r1: number, life: number, color: number, width: number): void;
  /** The view's drawn width (CSS px) and the base px per world unit. */
  viewWidth(): number;
  cue(name: "impact" | "shatter"): void;
}

/** The boss's drawn place and scale this frame (the renderer fills it in). */
export interface BossPlace {
  x: number;
  y: number;
  scale: number;
  facing: 1 | -1;
}

const DUST = 0x8a7a6a;

/**
 * The entrance. The renderer draws the boss's rig as usual and asks `present` to stage it while
 * the sequence runs (offset, mask, alpha, tint and the pose state to show).
 */
export class BossEntrance {
  readonly tl = new Timeline(ENTRANCE.length);
  readonly kind: BossKind;
  readonly bossId: number;
  private readonly host: BossHost;
  private readonly root = new Container();
  private readonly fx = new Graphics();
  private readonly mask = new Graphics();
  private readonly glow: number;
  private readonly flare = new Sprite(softCircle());
  private readonly emit: EmitOptions = { x: 0, y: 0, count: 1, texture: softCircle(), color: 0xffffff, speed: [0, 0], life: [0.4, 0.8], scale: [0.2, 0.4] };
  /** 0 before the emergence, 1 when the boss is fully present. */
  private emerge = 0;
  private open = 0;
  private bannerK = 0;
  private flareK = 0;
  private waterT = -1;
  private columnK = 0;
  private place: BossPlace = { x: 0, y: 0, scale: 1, facing: -1 };
  private placed = false;
  private masked: Rig | null = null;
  private rigTop = 100;
  private reducedT = -1;

  constructor(host: BossHost, bossId: number, defId: string) {
    this.host = host;
    this.bossId = bossId;
    this.kind = bossKind(defId);
    const spec = enemySpec(defId);
    this.glow = spec.glow ?? spec.eye;
    const tl = this.tl;
    tl.own(this.root);
    this.flare.anchor.set(0.5);
    this.flare.blendMode = "add";
    this.flare.alpha = 0;
    this.flare.tint = 0xffd98a;
    this.root.addChild(this.mask, this.fx, this.flare);
    host.layer.addChild(this.root);
    tl.onDispose(() => {
      this.unmask();
      host.letterbox(0);
      host.dimOthers(0);
      host.camera.hold.weight = 0;
    });
    tl.disposeOnDone = true;
    this.build();
    if (host.isReduced()) {
      tl.skipTo(ENTRANCE.release);
      this.reducedT = 0;
    }
  }

  private build(): void {
    const tl = this.tl;
    const host = this.host;
    const cam = host.camera;
    tl.at(0, () => {
      if (!host.isReduced()) host.letterbox(22);
    });
    tl.tween(0, 0.4, easeOutCubic, (k) => host.dimOthers(0.3 * k));
    tl.tween(0, 0.6, easeInOutSine, (k) => {
      cam.hold.weight = k;
      cam.hold.zoom = ENTRANCE.zoom;
      cam.hold.lambda = 7;
    });
    // The emergence, by kind.
    const e0 = ENTRANCE.emerge;
    const e1 = ENTRANCE.impact;
    if (this.kind === "warden") {
      tl.tween(e0, e0 + 0.35, easeOutCubic, (k) => (this.open = k));
      tl.tween(e0 + 0.2, e1, easeOutCubic, (k) => (this.emerge = k));
    } else if (this.kind === "drowned") {
      tl.at(e0, () => (this.waterT = 0));
      tl.tween(e0 + 0.15, e1, easeOutBack, (k) => (this.emerge = Math.min(1, k)));
    } else if (this.kind === "herald") {
      tl.tween(e0 - 0.1, e0 + 0.3, easeOutCubic, (k) => (this.columnK = k));
      tl.tween(e0, e1, easeOutCubic, (k) => (this.emerge = k));
      tl.tween(e1, e1 + 0.5, null, (k) => (this.columnK = 1 - k));
    } else {
      tl.tween(e0 - 0.1, e0 + 0.35, easeOutCubic, (k) => (this.flareK = k));
      tl.tween(e0 + 0.1, e1, easeInOutSine, (k) => (this.emerge = k));
      tl.tween(e0 + 0.25, e1, easeOutBack, (k) => (this.bannerK = Math.min(1, k)));
      tl.tween(e1, e1 + 0.5, null, (k) => (this.flareK = 1 - k));
    }
    // Impact: trauma 0.5, an 80ms stop, a dust ring.
    tl.at(e1, () => {
      this.emerge = 1;
      if (tl.skipping) return;
      host.cue("impact");
      cam.shake(0.5);
      host.freeze(0.08);
      if (this.placed) {
        const p = this.place;
        host.ring(p.x, p.y, 10, 160 * p.scale, 0.55, DUST, 5);
        const o = this.emit;
        o.x = p.x;
        o.y = p.y;
        o.count = 22;
        o.texture = softCircle();
        o.color = DUST;
        o.speed = [60, 200];
        o.angle = [-Math.PI, 0];
        o.life = [0.4, 0.8];
        o.scale = [0.3, 0.7];
        o.endScale = 0.9;
        o.alpha = 0.55;
        o.gravity = 140;
        o.additive = false;
        o.spread = 40 * p.scale;
        host.particles.emit(o);
        o.spread = 0;
      }
    });
    tl.tween(e1, e1 + 0.3, null, (k) => (this.open = 1 - k));
    // Release: the bars retract, the field comes back, the camera returns to the fight.
    tl.at(ENTRANCE.release, () => host.letterbox(0));
    tl.tween(ENTRANCE.release, ENTRANCE.length, easeInOutSine, (k) => {
      host.dimOthers(0.3 * (1 - k));
      cam.hold.weight = 1 - k;
    });
  }

  /** Where the boss is drawn (base px, rig scale) this frame; called before `present`. */
  setPlace(x: number, y: number, scale: number, facing: 1 | -1, rigTop: number): void {
    const p = this.place;
    p.x = x;
    p.y = y;
    p.scale = scale;
    p.facing = facing;
    this.rigTop = rigTop;
    if (!this.placed) {
      this.placed = true;
      const cam = this.host.camera;
      cam.hold.x = x;
      cam.hold.y = y - rigTop * scale * 0.5;
    }
  }

  /** The pose to animate the boss with while it emerges (the King walks out). */
  get poseState(): "idle" | "move" {
    return this.kind === "king" && this.emerge < 0.98 ? "move" : "idle";
  }

  /** Stage the boss's rig for this frame (after it is posed and placed): offset, mask, alpha, tint. */
  present(rig: Rig): void {
    const p = this.place;
    const k = this.emerge;
    const h = this.rigTop * p.scale;
    rig.root.alpha = 1;
    rig.root.tint = 0xffffff;
    switch (this.kind) {
      case "warden":
      case "drowned": {
        // Rises out of the ground (masked at the surface).
        this.useMask(rig);
        rig.root.y += (1 - k) * h * 1.15;
        if (this.kind === "drowned") rig.root.y += Math.sin(this.tl.t * 6) * 2 * (1 - k);
        rig.shadow.alpha = k;
        break;
      }
      case "herald": {
        // Descends in the column of embers.
        rig.root.y -= (1 - k) * h * 1.6;
        rig.root.alpha = Math.min(1, k * 2.5);
        rig.shadow.alpha = k;
        break;
      }
      case "king": {
        // Walks out of the flare: from further back, white-gold as it leaves the light.
        rig.root.x += (1 - k) * 90 * p.scale * -p.facing;
        rig.root.alpha = k < 0.04 ? 0 : Math.min(1, (k - 0.04) * 5);
        rig.root.tint = k < 1 ? lighten(0xffe2a0, k) : 0xffffff;
        rig.shadow.alpha = k;
        break;
      }
    }
  }

  private useMask(rig: Rig): void {
    if (this.masked === rig) return;
    this.unmask();
    this.masked = rig;
    rig.root.mask = this.mask;
  }

  private unmask(): void {
    if (this.masked && !this.masked.root.destroyed) this.masked.root.mask = null;
    this.masked = null;
    this.mask.clear();
  }

  get done(): boolean {
    return this.tl.disposed;
  }

  update(dt: number): void {
    if (this.tl.disposed) return;
    if (this.reducedT >= 0) this.reducedT += dt;
    this.tl.update(dt);
    if (this.tl.disposed) return;
    if (this.emerge >= 1 && this.masked) this.unmask();
    this.draw(dt);
  }

  private draw(dt: number): void {
    const g = this.fx;
    g.clear();
    if (!this.placed) return;
    const p = this.place;
    const s = p.scale;
    const vw = this.host.viewWidth();
    // The mask: everything above the ground line at the boss's feet.
    // Only while it masks: an unused mask would draw as a white rectangle.
    this.mask.clear();
    if (this.masked) this.mask.rect(p.x - vw * 2, p.y - vw * 3, vw * 4, vw * 3).fill(0xffffff);
    if (this.kind === "warden" && this.open > 0) {
      // A jagged fissure along the ground, widening, with a hot seam.
      const len = 120 * s * this.open;
      const w = 9 * s * this.open;
      g.moveTo(p.x - len, p.y);
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        g.lineTo(p.x - len + 2 * len * t, p.y - w * 0.5 * Math.sin(t * Math.PI) - (i % 2 ? 2 : -1) * s);
      }
      for (let i = 10; i >= 0; i--) {
        const t = i / 10;
        g.lineTo(p.x - len + 2 * len * t, p.y + w * 0.5 * Math.sin(t * Math.PI) + (i % 3 ? 1.5 : -1) * s);
      }
      g.closePath().fill({ color: 0x060506, alpha: 0.95 });
      g.moveTo(p.x - len * 0.8, p.y).lineTo(p.x + len * 0.8, p.y).stroke({ width: 1.4, color: lighten(this.glow, 0.3), alpha: 0.8 * this.open });
      if (dt > 0 && this.emerge < 1 && !this.host.isReduced()) this.dust(p.x + (Math.random() - 0.5) * len * 2, p.y);
    }
    if (this.kind === "drowned" && this.waterT >= 0) {
      this.waterT += dt;
      // Three expanding water rings, and spray while it surfaces.
      for (let i = 0; i < 3; i++) {
        const t = this.waterT - i * 0.22;
        if (t < 0 || t > 1.4) continue;
        const k = t / 1.4;
        const r = (20 + 150 * easeOutCubic(k)) * s;
        g.ellipse(p.x, p.y, r, r * 0.28).stroke({ width: 3 * (1 - k) + 0.5, color: 0xbfe9e4, alpha: (1 - k) * 0.85 });
      }
      if (dt > 0 && this.emerge < 1 && this.emerge > 0.05 && !this.host.isReduced()) {
        const o = this.emit;
        o.x = p.x + (Math.random() - 0.5) * 50 * s;
        o.y = p.y;
        o.count = 2;
        o.texture = softCircle();
        o.color = 0xcfefea;
        o.speed = [120, 260];
        o.angle = [-Math.PI * 0.68, -Math.PI * 0.32];
        o.life = [0.4, 0.7];
        o.scale = [0.1, 0.25];
        o.endScale = 0;
        o.alpha = 0.85;
        o.gravity = 520;
        o.additive = true;
        this.host.particles.emit(o);
      }
    }
    if (this.kind === "herald" && this.columnK > 0.01) {
      // A falling column of embers onto the spawn point.
      const top = p.y - this.rigTop * s * 3;
      const w = 34 * s;
      g.rect(p.x - w, top, w * 2, p.y - top).fill({ color: this.glow, alpha: 0.1 * this.columnK });
      g.rect(p.x - w * 0.25, top, w * 0.5, p.y - top).fill({ color: lighten(this.glow, 0.5), alpha: 0.25 * this.columnK });
      if (dt > 0 && !this.host.isReduced()) {
        const o = this.emit;
        o.x = p.x + (Math.random() - 0.5) * w * 1.8;
        o.y = top + Math.random() * (p.y - top) * 0.6;
        o.count = 2;
        o.texture = softCircle();
        o.color = Math.random() < 0.4 ? 0xffd9a0 : this.glow;
        o.speed = [140, 260];
        o.angle = [Math.PI * 0.45, Math.PI * 0.55];
        o.life = [0.3, 0.6];
        o.scale = [0.08, 0.2];
        o.endScale = 0;
        o.alpha = 0.95;
        o.gravity = 200;
        o.additive = true;
        this.host.particles.emit(o);
      }
    }
    if (this.kind === "king") {
      // A gold flare on the horizon behind the spawn point, and two banners unfurling.
      if (this.flareK > 0.01) {
        const hy = p.y - 6 * s;
        const half = vw * 0.8 * this.flareK;
        g.moveTo(p.x - half, hy).lineTo(p.x + half, hy).stroke({ width: 1.6, color: 0xfff1c9, alpha: 0.95 * this.flareK });
        this.flare.position.set(p.x - p.facing * 30 * s, hy - 30 * s);
        this.flare.scale.set((260 * s) / 64, (120 * s) / 64);
        this.flare.alpha = 0.8 * this.flareK;
      } else this.flare.alpha = 0;
      const b = this.bannerK;
      if (b > 0) {
        for (const side of [-1, 1]) {
          const bx = p.x + side * 78 * s;
          const pole = 120 * s * Math.min(1, b * 1.4);
          g.rect(bx - 1.5 * s, p.y - pole, 3 * s, pole).fill(0x2a201a);
          const cloth = 70 * s * b;
          const cw = 24 * s;
          g.poly([bx + 1.5 * s, p.y - pole + 4 * s, bx + 1.5 * s + cw, p.y - pole + 4 * s, bx + 1.5 * s + cw, p.y - pole + 4 * s + cloth, bx + 1.5 * s + cw * 0.5, p.y - pole + 4 * s + cloth * 0.82, bx + 1.5 * s, p.y - pole + 4 * s + cloth]).fill({ color: 0xb3473f, alpha: 0.95 });
          g.circle(bx, p.y - pole - 3 * s, 3 * s).fill(0xc9a24f);
        }
      }
      if (this.tl.t > ENTRANCE.release) g.alpha = 1 - (this.tl.t - ENTRANCE.release) / (ENTRANCE.length - ENTRANCE.release);
    }
  }

  private dust(x: number, y: number): void {
    const o = this.emit;
    o.x = x;
    o.y = y;
    o.count = 1;
    o.texture = softCircle();
    o.color = DUST;
    o.speed = [20, 80];
    o.angle = [-Math.PI * 0.8, -Math.PI * 0.2];
    o.life = [0.4, 0.8];
    o.scale = [0.25, 0.55];
    o.endScale = 0.9;
    o.alpha = 0.5;
    o.gravity = 40;
    o.additive = false;
    this.host.particles.emit(o);
  }

  dispose(): void {
    this.tl.dispose();
  }
}

/**
 * The boss's death. It owns a copy of the boss's rig (the simulation removes the entity on its
 * own schedule), stages an inverted impact frame, the kneel, the cracks and the shattering.
 */
export class BossDeath {
  readonly tl = new Timeline(DEATH.length);
  private readonly host: BossHost;
  private readonly root = new Container();
  private readonly black = new Graphics();
  private readonly cracks = new Graphics();
  private readonly rig: Rig;
  private readonly glow: number;
  private readonly x: number;
  private readonly y: number;
  private readonly s: number;
  private readonly facing: 1 | -1;
  private readonly seed: number;
  private t = 0;
  private crackK = 0;
  private fade = 1;
  private moteUntil = 0;
  private readonly emit: EmitOptions = { x: 0, y: 0, count: 1, texture: softCircle(), color: 0xffffff, speed: [0, 0], life: [0.4, 0.8], scale: [0.2, 0.4] };
  private readonly crackSeed: number[] = [];

  constructor(host: BossHost, defId: string, x: number, y: number, scale: number, facing: 1 | -1) {
    this.host = host;
    const spec = enemySpec(defId);
    this.glow = spec.glow ?? spec.eye;
    this.x = x;
    this.y = y;
    this.s = scale;
    this.facing = facing;
    this.seed = Math.random();
    this.rig = new Rig(spec);
    this.rig.setDeath(DEATH_KNEEL, facing, 1);
    this.rig.root.position.set(x, y);
    this.rig.root.scale.set(scale);
    this.rig.shadow.position.set(x, y + 1);
    this.rig.shadow.scale.set(scale, scale * 0.9);
    const vw = host.viewWidth();
    this.black.rect(x - vw * 3, y - vw * 3, vw * 6, vw * 6).fill(0x000000);
    this.black.visible = false;
    this.cracks.blendMode = "add";
    this.rig.root.addChild(this.cracks);
    this.root.addChild(this.black, this.rig.shadow, this.rig.root);
    host.layer.addChild(this.root);
    for (let i = 0; i < 7; i++) this.crackSeed.push(Math.random(), Math.random(), Math.random());
    const tl = this.tl;
    tl.own(this.root);
    tl.onDispose(() => {
      this.rig.destroy();
      host.camera.hold.weight = 0;
    });
    tl.disposeOnDone = true;
    const cam = host.camera;
    cam.hold.x = x;
    cam.hold.y = y - this.rig.top * scale * 0.5;
    cam.hold.zoom = DEATH.zoom;
    cam.hold.lambda = 8;
    cam.hold.weight = 1;
    // The inverted impact frame: two frames, boss white on black.
    if (!host.isReduced()) {
      tl.at(0, () => {
        this.black.visible = true;
        this.rig.setWhite(1);
      });
      tl.at(DEATH.inverted, () => {
        this.black.visible = false;
        this.rig.setWhite(0);
      });
    }
    tl.tween(0.15, DEATH.breakAt, easeInCubic, (k) => (this.crackK = k));
    tl.at(DEATH.breakAt, () => {
      host.cue("shatter");
      if (tl.skipping) return;
      this.shatter();
      host.ring(x, y, 20, vw * 1.4, 1.4, this.glow, 6);
      cam.shake(0.35);
      this.moteUntil = DEATH.breakAt + 2;
    });
    tl.tween(DEATH.breakAt, DEATH.breakAt + 0.18, null, (k) => (this.fade = 1 - k));
    tl.tween(DEATH.length - 0.6, DEATH.length, easeInOutSine, (k) => (cam.hold.weight = 1 - k));
  }

  private shatter(): void {
    const o = this.emit;
    const s = this.s;
    const top = this.rig.top * s;
    for (let i = 0; i < 60; i++) {
      o.x = this.x + (Math.random() - 0.5) * top * 0.4;
      o.y = this.y - Math.random() * top * 0.7;
      o.count = 1;
      o.texture = shard();
      o.color = i % 3 === 0 ? 0x15141a : i % 3 === 1 ? this.glow : lighten(this.glow, 0.5);
      o.speed = [60, 220];
      o.angle = [-Math.PI * 0.85, -Math.PI * 0.15];
      o.life = [0.8, 1.6];
      o.scale = [0.25, 0.75];
      o.endScale = 0;
      o.alpha = 1;
      o.gravity = -40;
      o.drag = 0.94;
      o.spin = 6;
      o.additive = i % 3 !== 0;
      this.host.particles.emit(o);
    }
  }

  get done(): boolean {
    return this.tl.disposed;
  }

  update(dt: number): void {
    if (this.tl.disposed) return;
    this.t += dt;
    this.tl.update(dt);
    if (this.tl.disposed) return;
    // The kneel: the collapse pose folded part way, held.
    // The kneel: the pose blends in over the first half second, then holds until it breaks.
    this.rig.animate(this.t < DEATH.inverted ? "stagger" : "dead", 0.1, 0.2, this.seed, this.facing, false, 0, 0, dt);
    this.rig.root.alpha = this.fade;
    this.rig.shadow.alpha = this.fade;
    this.drawCracks();
    if (this.t < this.moteUntil && dt > 0 && Math.random() < 0.5 && !this.host.isReduced()) {
      const o = this.emit;
      o.x = this.x + (Math.random() - 0.5) * 200 * this.s;
      o.y = this.y - Math.random() * 60 * this.s;
      o.count = 1;
      o.texture = softCircle();
      o.color = this.glow;
      o.speed = [8, 26];
      o.angle = [-Math.PI * 0.75, -Math.PI * 0.25];
      o.life = [1.0, 1.8];
      o.scale = [0.08, 0.2];
      o.endScale = 0;
      o.alpha = 0.8;
      o.gravity = -10;
      o.drag = 0.98;
      o.spin = 0;
      o.additive = true;
      this.host.particles.emit(o);
    }
  }

  /** Cracks of the boss's glow spreading from the chest over the silhouette (rig-local units). */
  private drawCracks(): void {
    const g = this.cracks;
    g.clear();
    const k = this.crackK;
    if (k <= 0 || this.fade <= 0) return;
    const top = this.rig.top;
    const cx = 0;
    const cy = -top * 0.55;
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (this.crackSeed[i * 3]! - 0.5) * Math.PI * 1.8 + (i % 2 ? Math.PI : 0);
      const len = top * (0.18 + 0.3 * this.crackSeed[i * 3 + 1]!) * k;
      let x = cx;
      let y = cy;
      g.moveTo(x, y);
      for (let j = 1; j <= 4; j++) {
        const jj = j / 4;
        x = cx + Math.cos(a) * len * jj + (this.crackSeed[i * 3 + 2]! - 0.5) * 6 * (j % 2 ? 1 : -1);
        y = cy + Math.sin(a) * len * jj;
        g.lineTo(x, y);
      }
      g.stroke({ width: 1.6, color: lighten(this.glow, 0.35), alpha: 0.95 * this.fade });
    }
    g.circle(cx, cy, 4 + 6 * k).fill({ color: this.glow, alpha: 0.5 * k * this.fade });
  }

  dispose(): void {
    this.tl.dispose();
  }
}

/** Phase change parameters (blueprint 7D): the stop, the backdrop's lasting shift toward the glow. */
export const PHASE = { stop: 0.35, tint: 0.2 } as const;

