import { Container, Graphics } from "pixi.js";
import type { SovereignId } from "../../data/sovereigns";
import type { EmitOptions, ParticleSystem } from "../Particles";
import { shard, softCircle, spark } from "../textures";
import { easeInCubic, easeOutBack, easeOutCubic } from "../anim/ease";

/**
 * A Sovereign's BIND: the full legendary rite (cinematics/arise.ts) with each Sovereign's own
 * staging laid over it, on the same beats (draw 0.1 to 1.2 s, rise to 2.5 s, the oath at 2.5 s, the
 * name at 3.6 s):
 *
 *  - the Mirror Knight: four tall mirrors rise in an arc behind the pool and catch the figure as it
 *    rises; at the oath they shatter outward in silver and gold;
 *  - the Storm Titan: a storm gathers over the pool and rains on it, lightning forks into the pool
 *    as it rises; at the oath a bolt strikes it and the storm settles on its back;
 *  - the Void Queen: the pool turns to a void well, a throne rises behind it, her court rises round
 *    it and kneels at the oath, as a black sun blooms behind her head.
 *
 * Drawn in the cinematic's stage space (screen px, origin at the pool). Reduced effects lands on the
 * final beat with the arise sequence (no bolts, no shards, the court already kneeling).
 */
export const RITE = { draw: 0.1, drawEnd: 1.2, rise: 2.5, oath: 2.5, name: 3.6 } as const;

export class SovereignRite {
  private readonly back = new Graphics();
  private readonly front = new Graphics();
  private oathT = -1;
  private boltT = -1;
  private boltSeed = 0;
  private lastT = 0;
  private readonly emit: EmitOptions = { x: 0, y: 0, count: 1, texture: softCircle(), color: 0xffffff, speed: [0, 0], life: [0.5, 1], scale: [0.1, 0.2] };

  constructor(
    readonly kind: SovereignId,
    backLayer: Container,
    frontLayer: Container,
    /** The figure's height and the pool's radius (stage px). */
    private readonly figH: number,
    private readonly R: number,
    /** Stage px to base px (the shared particle pool lives in base px). */
    private readonly toBase: (x: number, y: number, out: { x: number; y: number }) => void,
    private readonly particles: ParticleSystem,
    private readonly reduced: boolean,
  ) {
    this.front.blendMode = "add";
    backLayer.addChild(this.back);
    frontLayer.addChild(this.front);
  }

  /** The oath beat (not when skipping to it). */
  oath(): void {
    this.oathT = 0;
    if (this.reduced) return;
    if (this.kind === "mirror_knight") {
      for (let i = 0; i < 4; i++) this.burst(this.paneX(i), -this.figH * 0.55, shard(), [0xdfe6f5, 0xffffff, 0xe9c97a], 14, 340);
    } else if (this.kind === "storm_titan") {
      this.boltT = 0;
      this.boltSeed += 1;
      this.burst(0, -this.figH * 0.9, spark(), [0xeef6ff, 0x8fbfff, 0xfff1c9], 26, 420);
    } else {
      this.burst(0, -this.figH * 0.85, softCircle(), [0xb18cff, 0xfff1c9, 0x2a1440], 24, 260);
    }
  }

  private paneX(i: number): number {
    return (i - 1.5) * this.R * 0.95;
  }

  update(t: number, dt: number): void {
    const b = this.back;
    const f = this.front;
    b.clear();
    f.clear();
    if (this.oathT >= 0) this.oathT += dt;
    if (this.boltT >= 0) this.boltT += dt;
    const draw = easeOutCubic(clamp01((t - RITE.draw) / (RITE.drawEnd - RITE.draw)));
    const rise = clamp01((t - RITE.drawEnd) / (RITE.rise - RITE.drawEnd));
    if (this.kind === "mirror_knight") this.mirrors(b, f, t, draw, rise);
    else if (this.kind === "storm_titan") this.storm(b, f, t, draw, rise, dt);
    else this.court(b, f, t, draw, rise);
    this.lastT = t;
  }

  private mirrors(b: Graphics, f: Graphics, t: number, draw: number, rise: number): void {
    const H = this.figH * 1.15;
    const W = this.R * 0.62;
    // Before the oath: four panes rising in an arc behind the pool, each with a pale sheen.
    if (this.oathT < 0) {
      for (let i = 0; i < 4; i++) {
        const k = easeOutBack(clamp01(draw * 1.4 - i * 0.12));
        if (k <= 0) continue;
        const x = this.paneX(i);
        const y = -this.R * 0.12 * (i === 0 || i === 3 ? 0.4 : 1);
        const h = H * Math.min(1, k) * (i === 0 || i === 3 ? 0.85 : 1);
        b.roundRect(x - W / 2 - 3, y - h - 3, W + 6, h + 3, W * 0.45).fill({ color: 0x0b0b12, alpha: 0.85 });
        b.roundRect(x - W / 2, y - h, W, h, W * 0.42).fill({ color: 0xcfd6e4, alpha: 0.32 });
        b.roundRect(x - W / 2, y - h, W, h, W * 0.42).stroke({ width: 2.4, color: 0xe9c97a, alpha: 0.95 });
        // The figure caught in the glass as it rises: a pale shape climbing each pane.
        if (rise > 0) b.roundRect(x - W * 0.18, y - h * 0.15 - h * 0.6 * rise, W * 0.36, h * 0.6 * rise, W * 0.18).fill({ color: 0xf4f6ff, alpha: 0.18 });
        const sweep = (t * 0.8 + i * 0.27) % 1;
        f.moveTo(x - W / 2 + W * sweep - W * 0.15, y - h * 0.1).lineTo(x - W / 2 + W * sweep + W * 0.1, y - h * 0.9).stroke({ width: W * 0.12, color: 0xffffff, alpha: 0.3 });
      }
      return;
    }
    // After: a silver ring going out where they stood, fading.
    const k = clamp01(this.oathT / 0.6);
    f.ellipse(0, 0, this.R * (1 + 2 * easeOutCubic(k)), this.R * 0.26 * (1 + 2 * easeOutCubic(k))).stroke({ width: 3 * (1 - k), color: 0xf4f6ff, alpha: 1 - k });
  }

  private storm(b: Graphics, f: Graphics, t: number, draw: number, rise: number, dt: number): void {
    const top = -this.figH * 1.35;
    // The storm gathers over the pool, then settles down onto the figure's back after the oath.
    const settle = this.oathT >= 0 ? easeInCubic(clamp01(this.oathT / 0.7)) : 0;
    const k = draw * (1 - settle * 0.6);
    if (k > 0.01) {
      const cy = top + settle * this.figH * 0.55;
      const sc = 0.4 + 0.6 * k;
      const puffs: [number, number, number][] = [[-0.9, 0.1, 0.5], [-0.3, -0.25, 0.7], [0.4, -0.2, 0.62], [0.95, 0.12, 0.48], [0.05, 0.25, 0.55]];
      for (const [px, py, pr] of puffs) b.circle(px * this.R * sc, cy + py * this.R * sc, pr * this.R * sc * 1.05).fill({ color: 0x8a93a3, alpha: 0.85 * k });
      for (const [px, py, pr] of puffs) b.circle(px * this.R * sc + 2, cy + py * this.R * sc + 3, pr * this.R * sc).fill({ color: 0x3a404d, alpha: 0.95 * k });
      // Rain falling from it onto the pool.
      if (settle < 0.5) {
        for (let i = 0; i < 12; i++) {
          const x = (i / 11 - 0.5) * this.R * 2 * sc;
          const ph = (t * 2.4 + i * 0.37) % 1;
          const y0 = cy + this.R * 0.3 + ph * (-cy - this.R * 0.3);
          b.moveTo(x, y0).lineTo(x - 3, y0 + 12).stroke({ width: 1, color: 0xbfdcff, alpha: 0.5 * k });
        }
      }
    }
    // Lightning forking into the pool as it rises, and the strike at the oath.
    const flick = rise > 0 && this.oathT < 0 && ((t > 1.4 && t < 1.48) || (t > 1.95 && t < 2.02));
    if (!this.reduced && (flick || (this.boltT >= 0 && this.boltT < 0.22))) {
      const seed = flick ? Math.floor(t * 10) : this.boltSeed * 13;
      let px = (frac(seed * 0.31) - 0.5) * this.R;
      let py = top;
      const ey = flick ? 0 : -this.figH * 0.7;
      for (let i = 1; i <= 6; i++) {
        const tt = i / 6;
        const nx = i === 6 ? 0 : (frac(seed * 0.71 + i * 0.37) - 0.5) * this.R * 0.9 * (1 - tt);
        const ny = top + (ey - top) * tt;
        f.moveTo(px, py).lineTo(nx, ny).stroke({ width: flick ? 2 : 4, color: 0xeef6ff, alpha: 1 });
        f.moveTo(px, py).lineTo(nx, ny).stroke({ width: flick ? 6 : 10, color: 0x8fbfff, alpha: 0.35 });
        px = nx;
        py = ny;
      }
    }
    void dt;
  }

  private court(b: Graphics, f: Graphics, t: number, draw: number, rise: number): void {
    const R = this.R;
    // The pool turns to a void well: arms turning in toward it.
    const spin = t * 1.6;
    for (let arm = 0; arm < 4; arm++) {
      const a0 = spin + (arm / 4) * Math.PI * 2;
      for (let i = 0; i <= 12; i++) {
        const tt = i / 12;
        const r = R * (1.7 - 0.9 * tt) * draw;
        const a = a0 + tt * 2;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r * 0.26;
        if (i === 0) b.moveTo(x, y);
        else b.lineTo(x, y);
      }
      b.stroke({ width: 1.4, color: 0xb18cff, alpha: 0.6 * draw });
    }
    // The throne rising behind the figure.
    const th = easeOutCubic(clamp01((t - 0.4) / 1.2));
    if (th > 0) {
      const H = this.figH * 1.25 * th;
      const W = R * 0.7;
      const y0 = -R * 0.3;
      b.poly([-W, y0, -W, y0 - H * 0.45, -W * 1.1, y0 - H, -W * 0.6, y0 - H * 0.82, -W * 0.3, y0 - H * 1.12, 0, y0 - H * 0.9, W * 0.3, y0 - H * 1.12, W * 0.6, y0 - H * 0.82, W * 1.1, y0 - H, W, y0 - H * 0.45, W, y0]).fill({ color: 0x0b0810, alpha: 0.9 });
      b.poly([-W, y0, -W, y0 - H * 0.45, -W * 1.1, y0 - H, -W * 0.6, y0 - H * 0.82, -W * 0.3, y0 - H * 1.12, 0, y0 - H * 0.9, W * 0.3, y0 - H * 1.12, W * 0.6, y0 - H * 0.82, W * 1.1, y0 - H, W, y0 - H * 0.45, W, y0]).stroke({ width: 1.6, color: 0xe9c97a, alpha: 0.85 * th });
    }
    // The court rises round the pool and kneels at the oath.
    const up = clamp01((t - 1.0) / 1.2);
    const kneel = this.oathT >= 0 ? easeOutCubic(clamp01(this.oathT / 0.35)) : this.reduced && t >= RITE.oath ? 1 : 0;
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * R * (1.25 + (i >> 1) * 0.55);
      const y = (i >> 1) * R * 0.12;
      const s = this.figH * 0.0075 * (1 - (i >> 1) * 0.12);
      const hgt = 38 * s * up * (1 - 0.32 * kneel);
      if (hgt <= 0.5) continue;
      b.poly([x - 11 * s, y, x - 8 * s, y - hgt, x + 8 * s, y - hgt, x + 12 * s, y]).fill({ color: 0x3a404d, alpha: 0.95 });
      b.poly([x - 11 * s, y, x - 8 * s, y - hgt, x + 8 * s, y - hgt, x + 12 * s, y]).stroke({ width: 1.2, color: 0xe9c97a, alpha: 0.7 });
      b.circle(x - side * 5 * s * kneel, y - hgt - 6 * s + 5 * s * kneel, 6.5 * s).fill({ color: 0x3a404d, alpha: 0.95 });
    }
    // At the oath, a black sun blooms behind her head.
    if (this.oathT >= 0 || (this.reduced && t >= RITE.oath)) {
      const k = this.reduced ? 1 : easeOutBack(clamp01(this.oathT / 0.4));
      const cy = -this.figH * 0.92;
      const r = this.figH * 0.13 * Math.min(1.1, k);
      b.circle(0, cy, r * 1.45).fill({ color: 0xb18cff, alpha: 0.25 });
      b.circle(0, cy, r * 1.15).fill({ color: 0xfff1c9, alpha: 0.5 });
      b.circle(0, cy, r).fill({ color: 0x050308, alpha: 1 });
      f.circle(0, cy, r).stroke({ width: 1.6, color: 0xfff1c9, alpha: 0.9 });
    }
    void rise;
  }

  private readonly pt = { x: 0, y: 0 };

  private burst(x: number, y: number, tex: EmitOptions["texture"], colors: number[], n: number, speed: number): void {
    this.toBase(x, y, this.pt);
    const o = this.emit;
    o.x = this.pt.x;
    o.y = this.pt.y;
    o.count = n;
    o.texture = tex;
    o.color = colors[0]!;
    o.colors = colors;
    o.speed = [speed * 0.35, speed];
    o.angle = [-Math.PI, 0];
    o.life = [0.5, 1.1];
    o.scale = [0.25, 0.7];
    o.endScale = 0;
    o.alpha = 1;
    o.gravity = 260;
    o.spin = 8;
    o.additive = true;
    this.particles.emit(o);
    o.colors = undefined;
  }

  get elapsed(): number {
    return this.lastT;
  }

  destroy(): void {
    if (!this.back.destroyed) this.back.destroy();
    if (!this.front.destroyed) this.front.destroy();
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function frac(v: number): number {
  return v - Math.floor(v);
}
