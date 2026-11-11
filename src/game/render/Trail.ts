import { Graphics } from "pixi.js";

/** Samples kept per ribbon (the blade's last positions). */
const SAMPLES = 7;
/** Live ribbons at most; the warrior's always gets one. */
export const MAX_RIBBONS = 8;
/** A ribbon lingers this long after its swing ends. */
const LINGER = 0.12;
/** Catmull-Rom subdivisions per sample gap, so sparse samples still draw an arc. */
const SUB = 3;

export interface Ribbon {
  active: boolean;
  ownerId: number;
  /** Ring buffers of tip and mid-blade positions (x, y pairs), oldest first after `head`. */
  tip: Float32Array;
  mid: Float32Array;
  count: number;
  head: number;
  color: number;
  alpha: number;
  /** Seconds left after release; < 0 while the swing is still live. */
  fade: number;
}

/**
 * Weapon ribbons: a quad strip between the blade tip's track and a point 60% up the blade,
 * tapering to nothing at the tail, drawn additive in the weapon's colour. Pooled; no allocation
 * per frame beyond Pixi's own geometry rebuild.
 */
export class Trails {
  readonly graphics = new Graphics();
  private readonly pool: Ribbon[] = [];
  private readonly quad = [0, 0, 0, 0, 0, 0, 0, 0];
  private readonly style = { color: 0xffffff, alpha: 1 };
  // Scratch for the smoothed strip.
  private readonly sx = new Float32Array((SAMPLES - 1) * SUB + 1);
  private readonly sy = new Float32Array((SAMPLES - 1) * SUB + 1);
  private readonly mx = new Float32Array((SAMPLES - 1) * SUB + 1);
  private readonly my = new Float32Array((SAMPLES - 1) * SUB + 1);

  constructor() {
    this.graphics.blendMode = "add";
    for (let i = 0; i < MAX_RIBBONS; i++) {
      this.pool.push({ active: false, ownerId: -1, tip: new Float32Array(SAMPLES * 2), mid: new Float32Array(SAMPLES * 2), count: 0, head: 0, color: 0xffffff, alpha: 1, fade: -1 });
    }
  }

  get live(): number {
    let n = 0;
    for (const r of this.pool) if (r.active) n++;
    return n;
  }

  /** A fresh ribbon, or null when all are in use (a priority request steals the oldest fading one). */
  acquire(ownerId: number, color: number, alpha: number, priority: boolean): Ribbon | null {
    let pick: Ribbon | null = null;
    for (const r of this.pool) {
      if (!r.active) {
        pick = r;
        break;
      }
    }
    if (!pick && priority) {
      for (const r of this.pool) {
        if (r.fade >= 0 && (!pick || r.fade < pick.fade)) pick = r;
      }
      if (!pick) for (const r of this.pool) if (r.ownerId !== ownerId) pick = r;
    }
    if (!pick) return null;
    pick.active = true;
    pick.ownerId = ownerId;
    pick.count = 0;
    pick.head = 0;
    pick.color = color;
    pick.alpha = alpha;
    pick.fade = -1;
    return pick;
  }

  sample(r: Ribbon, tipX: number, tipY: number, midX: number, midY: number): void {
    if (!r.active || r.fade >= 0) return;
    const i = r.head * 2;
    r.tip[i] = tipX;
    r.tip[i + 1] = tipY;
    r.mid[i] = midX;
    r.mid[i + 1] = midY;
    r.head = (r.head + 1) % SAMPLES;
    if (r.count < SAMPLES) r.count++;
  }

  /** The swing ended: the ribbon fades out over 120ms. */
  release(r: Ribbon): void {
    if (r.active && r.fade < 0) r.fade = LINGER;
  }

  clear(): void {
    for (const r of this.pool) r.active = false;
    this.graphics.clear();
  }

  update(dt: number): void {
    const g = this.graphics;
    g.clear();
    for (const r of this.pool) {
      if (!r.active) continue;
      if (r.fade >= 0) {
        r.fade -= dt;
        if (r.fade <= 0) {
          r.active = false;
          continue;
        }
      }
      if (r.count >= 2) this.draw(r);
    }
  }

  private at(buf: Float32Array, r: Ribbon, k: number, axis: number): number {
    // k-th oldest sample.
    const start = (r.head - r.count + SAMPLES) % SAMPLES;
    const idx = (start + Math.max(0, Math.min(r.count - 1, k))) % SAMPLES;
    return buf[idx * 2 + axis]!;
  }

  private draw(r: Ribbon): void {
    const n = r.count;
    let m = 0;
    for (let k = 0; k < n - 1; k++) {
      for (let s = 0; s < SUB; s++) {
        const t = s / SUB;
        this.sx[m] = cr(this.at(r.tip, r, k - 1, 0), this.at(r.tip, r, k, 0), this.at(r.tip, r, k + 1, 0), this.at(r.tip, r, k + 2, 0), t);
        this.sy[m] = cr(this.at(r.tip, r, k - 1, 1), this.at(r.tip, r, k, 1), this.at(r.tip, r, k + 1, 1), this.at(r.tip, r, k + 2, 1), t);
        this.mx[m] = cr(this.at(r.mid, r, k - 1, 0), this.at(r.mid, r, k, 0), this.at(r.mid, r, k + 1, 0), this.at(r.mid, r, k + 2, 0), t);
        this.my[m] = cr(this.at(r.mid, r, k - 1, 1), this.at(r.mid, r, k, 1), this.at(r.mid, r, k + 1, 1), this.at(r.mid, r, k + 2, 1), t);
        m++;
      }
    }
    this.sx[m] = this.at(r.tip, r, n - 1, 0);
    this.sy[m] = this.at(r.tip, r, n - 1, 1);
    this.mx[m] = this.at(r.mid, r, n - 1, 0);
    this.my[m] = this.at(r.mid, r, n - 1, 1);
    m++;
    const fade = r.fade >= 0 ? r.fade / LINGER : 1;
    const q = this.quad;
    const st = this.style;
    st.color = r.color;
    for (let i = 0; i < m - 1; i++) {
      // Width and alpha taper to nothing at the tail.
      const w0 = i / (m - 1);
      const w1 = (i + 1) / (m - 1);
      q[0] = this.sx[i]!;
      q[1] = this.sy[i]!;
      q[2] = this.sx[i + 1]!;
      q[3] = this.sy[i + 1]!;
      q[4] = this.sx[i + 1]! + (this.mx[i + 1]! - this.sx[i + 1]!) * w1;
      q[5] = this.sy[i + 1]! + (this.my[i + 1]! - this.sy[i + 1]!) * w1;
      q[6] = this.sx[i]! + (this.mx[i]! - this.sx[i]!) * w0;
      q[7] = this.sy[i]! + (this.my[i]! - this.sy[i]!) * w0;
      st.alpha = r.alpha * fade * (0.15 + 0.85 * w1);
      this.graphics.poly(q).fill(st);
    }
  }

  destroy(): void {
    this.graphics.destroy();
  }
}

function cr(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
