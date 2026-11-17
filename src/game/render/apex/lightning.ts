import type { Graphics } from "pixi.js";

/**
 * Forked lightning from a fixed bank of shapes. Each shape is a jagged main channel from (0, 0) to
 * (1, 0) (made by midpoint displacement, so it zigzags at every scale like the real thing) with
 * two branches peeling off it, all in a frame where x runs along the strike and y across it. The
 * bank is built once from its own seeded generator (never the world's), so drawing a bolt is only
 * a transform of points already made: nothing is generated or allocated per frame.
 */
export interface BoltShape {
  /** Main channel: x, y pairs. */
  main: Float32Array;
  /** Branches: each starts on the main channel and has its own x, y pairs. */
  branches: Float32Array[];
}

export const SHAPE_COUNT = 16;
const MAIN_LEVELS = 4; // 2^4 + 1 = 17 points
const BRANCH_POINTS = 7;

/** Mulberry32: a tiny seeded generator, local to the shape bank. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Midpoint displacement between two points: `levels` halvings, the jag shrinking each time. */
function displace(r: () => number, x0: number, y0: number, x1: number, y1: number, levels: number, jag: number): Float32Array {
  let pts = [x0, y0, x1, y1];
  let amp = jag;
  for (let l = 0; l < levels; l++) {
    const next: number[] = [];
    for (let i = 0; i < pts.length - 2; i += 2) {
      const ax = pts[i]!, ay = pts[i + 1]!, bx = pts[i + 2]!, by = pts[i + 3]!;
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const off = (r() - 0.5) * 2 * amp * len;
      next.push(ax, ay, (ax + bx) / 2 - (dy / len) * off, (ay + by) / 2 + (dx / len) * off);
    }
    next.push(pts[pts.length - 2]!, pts[pts.length - 1]!);
    pts = next;
    amp *= 0.62;
  }
  return Float32Array.from(pts);
}

function buildBank(seed: number): BoltShape[] {
  const r = rng(seed);
  const bank: BoltShape[] = [];
  for (let s = 0; s < SHAPE_COUNT; s++) {
    const main = displace(r, 0, 0, 1, 0, MAIN_LEVELS, 0.32);
    const branches: Float32Array[] = [];
    const n = main.length / 2;
    for (let b = 0; b < 2; b++) {
      // A branch leaves from somewhere in the middle of the channel, angled off it, a third as long.
      const at = Math.floor(n * (0.28 + 0.4 * r()));
      const sx = main[at * 2]!;
      const sy = main[at * 2 + 1]!;
      const side = b === 0 ? 1 : -1;
      const ang = side * (0.35 + 0.45 * r());
      const len = 0.22 + 0.22 * r();
      const ex = sx + Math.cos(ang) * len;
      const ey = sy + Math.sin(ang) * len;
      const pts = displace(r, sx, sy, ex, ey, 3, 0.3);
      branches.push(pts.slice(0, BRANCH_POINTS * 2));
    }
    bank.push({ main, branches });
  }
  return bank;
}

export const BOLT_SHAPES: readonly BoltShape[] = buildBank(0x5a17c0de);

/**
 * Trace one polyline of a shape from A to B into `g` (no stroke yet). `spread` scales the
 * sideways jag (1 = as made; under 1 flattens it, as for a bolt crawling along the ground);
 * `mirror` flips it across the strike so one shape gives two looks. `upto` (0 to 1) draws only the
 * first part, for a bolt still racing in.
 */
export function tracePath(g: Graphics, pts: Float32Array, ax: number, ay: number, bx: number, by: number, spread: number, mirror: boolean, upto = 1): void {
  const dx = bx - ax;
  const dy = by - ay;
  const nx = -dy;
  const ny = dx;
  const k = mirror ? -spread : spread;
  const n = pts.length / 2;
  const last = Math.max(1, Math.min(n - 1, Math.ceil((n - 1) * upto)));
  g.moveTo(ax + dx * pts[0]! + nx * pts[1]! * k, ay + dy * pts[0]! + ny * pts[1]! * k);
  for (let i = 1; i <= last; i++) {
    const u = pts[i * 2]!;
    const v = pts[i * 2 + 1]! * k;
    g.lineTo(ax + dx * u + nx * v, ay + dy * u + ny * v);
  }
}

/** One live bolt (pooled). */
export interface Bolt {
  live: boolean;
  shape: number;
  /** The shape of the re-strike flicker (-1: none). */
  restrike: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  width: number;
  color: number;
  spread: number;
  mirror: boolean;
  branches: boolean;
  life: number;
  total: number;
  delay: number;
  /** Seconds the bolt takes to race from A to B. */
  race: number;
}

export const MAX_BOLTS = 24;

/**
 * Brightness of a bolt over its life (0 to 1): it races in, holds a beat, dims, strikes again
 * (when it has a re-strike) and dies away. Pure, so its flicker can be tested against the
 * photosensitivity rule: one dip and one re-strike, never a strobe.
 */
export function boltLevel(age: number, total: number, restrike: boolean): number {
  if (age < 0 || age >= total) return 0;
  const k = age / total;
  if (!restrike) return k < 0.3 ? 1 : 1 - (k - 0.3) / 0.7;
  // Strike, a dip to a third, the re-strike, then the fade.
  if (k < 0.25) return 1;
  if (k < 0.38) return 0.35;
  if (k < 0.55) return 0.95;
  return 0.95 * (1 - (k - 0.55) / 0.45);
}

export class BoltPool {
  readonly bolts: Bolt[] = [];
  live = 0;

  constructor() {
    for (let i = 0; i < MAX_BOLTS; i++) this.bolts.push({ live: false, shape: 0, restrike: -1, ax: 0, ay: 0, bx: 0, by: 0, width: 1, color: 0xffffff, spread: 1, mirror: false, branches: true, life: 0, total: 1, delay: 0, race: 0 });
  }

  /** A bolt from A to B; the oldest is reused when the pool is full. Shape picks use render-side randomness only. */
  spawn(ax: number, ay: number, bx: number, by: number, o: { width: number; color: number; life: number; delay?: number; spread?: number; branches?: boolean; restrike?: boolean; race?: number }): Bolt {
    let b: Bolt | null = null;
    for (const c of this.bolts) {
      if (!c.live) {
        b = c;
        break;
      }
    }
    if (!b) {
      b = this.bolts[0]!;
      for (const c of this.bolts) if (c.life < b.life) b = c;
    }
    b.live = true;
    b.shape = Math.floor(Math.random() * SHAPE_COUNT);
    b.restrike = o.restrike ? (b.shape + 1 + Math.floor(Math.random() * (SHAPE_COUNT - 1))) % SHAPE_COUNT : -1;
    b.ax = ax;
    b.ay = ay;
    b.bx = bx;
    b.by = by;
    b.width = o.width;
    b.color = o.color;
    b.spread = o.spread ?? 1;
    b.mirror = Math.random() < 0.5;
    b.branches = o.branches ?? true;
    b.life = b.total = o.life;
    b.delay = o.delay ?? 0;
    b.race = o.race ?? 0.03;
    return b;
  }

  clear(): void {
    for (const b of this.bolts) b.live = false;
    this.live = 0;
  }

  /**
   * Advance and draw every live bolt: a dark under-stroke into `under` (keeps it legible on pale
   * ground), then glow, body and white core into `glow` (additive). Returns how many are live.
   */
  draw(under: Graphics, glow: Graphics, dt: number): number {
    let live = 0;
    for (const b of this.bolts) {
      if (!b.live) continue;
      if (b.delay > 0) {
        b.delay -= dt;
        live++;
        continue;
      }
      b.life -= dt;
      if (b.life <= 0) {
        b.live = false;
        continue;
      }
      live++;
      const age = b.total - b.life;
      const level = boltLevel(age, b.total, b.restrike >= 0);
      if (level <= 0.01) continue;
      const upto = b.race > 0 ? Math.min(1, age / b.race) : 1;
      // The re-strike lights a different channel to the same point: the bolt seems to jump.
      const second = b.restrike >= 0 && age / b.total >= 0.38;
      const shape = BOLT_SHAPES[second ? b.restrike : b.shape]!;
      const passes = b.branches ? 1 + shape.branches.length : 1;
      for (let p = 0; p < passes; p++) {
        // Branches show once the main channel has reached its mark.
        if (p > 0 && upto < 1) break;
        const pts = p === 0 ? shape.main : shape.branches[p - 1]!;
        const w = p === 0 ? b.width : b.width * 0.55;
        const a = p === 0 ? level : level * 0.75;
        const u = p === 0 ? upto : 1;
        tracePath(under, pts, b.ax, b.ay, b.bx, b.by, b.spread, b.mirror, u);
        under.stroke({ width: w * 2.4, color: 0x0b0a12, alpha: 0.32 * a, cap: "round", join: "round" });
        tracePath(glow, pts, b.ax, b.ay, b.bx, b.by, b.spread, b.mirror, u);
        glow.stroke({ width: w * 4.2, color: b.color, alpha: 0.22 * a, cap: "round", join: "round" });
        tracePath(glow, pts, b.ax, b.ay, b.bx, b.by, b.spread, b.mirror, u);
        glow.stroke({ width: w * 1.7, color: b.color, alpha: 0.75 * a, cap: "round", join: "round" });
        tracePath(glow, pts, b.ax, b.ay, b.bx, b.by, b.spread, b.mirror, u);
        glow.stroke({ width: Math.max(0.8, w * 0.55), color: 0xffffff, alpha: a, cap: "round", join: "round" });
      }
    }
    this.live = live;
    return live;
  }
}
