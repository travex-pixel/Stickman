import { Container, Mesh, MeshGeometry, Texture } from "pixi.js";

/** Samples kept per ribbon at most (the blade's last positions). */
const MAX_SAMPLES = 10;
/** Samples used at 1x and at 2x battle speed: a faster swing takes fewer frames, so keep more. */
const SAMPLES_1X = 7;
const SAMPLES_2X = 10;
/** Live ribbons at most; the warrior's always gets one. */
export const MAX_RIBBONS = 8;
/** A ribbon lingers this long after its swing ends (longer at 2x so it still reads). */
const LINGER_1X = 0.12;
const LINGER_2X = 0.17;
/** Catmull-Rom subdivisions per sample gap, so sparse samples still draw an arc. */
const SUB = 3;
/** Points along the smoothed strip at most. */
const POINTS = (MAX_SAMPLES - 1) * SUB + 1;

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
  linger: number;
  /** Additive ribbon and the dark under-stroke that keeps it legible on pale ground; one geometry. */
  mesh: Mesh;
  under: Mesh;
  geometry: MeshGeometry;
}

let ribbonTexture: Texture | null = null;

/**
 * Along the strip (u: tail 0 to blade 1) the alpha rises from nothing; across it (v: tip edge 0
 * to mid-blade 1) the outer edge is brightest, so the ribbon has a crisp leading edge and a soft
 * inner one.
 */
function texture(): Texture {
  if (ribbonTexture && !ribbonTexture.destroyed) return ribbonTexture;
  const w = 64;
  const h = 16;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return Texture.WHITE;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    const across = v < 0.12 ? 0.75 + 0.25 * (v / 0.12) : 1 - 0.7 * ((v - 0.12) / 0.88);
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      const along = Math.pow(u, 1.15);
      const i = (y * w + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * along * across);
    }
  }
  ctx.putImageData(img, 0, 0);
  ribbonTexture = Texture.from(c);
  return ribbonTexture;
}

/**
 * Weapon ribbons: a strip between the blade tip's track and a point 60% up the blade, tapering
 * to nothing at the tail. Each ribbon is a mesh whose vertex buffer is rewritten in place every
 * frame (no Graphics rebuild, no triangulation, no allocation): an additive strip in the weapon's
 * colour over a thin dark under-stroke that keeps it legible on pale ground.
 */
export class Trails {
  readonly graphics = new Container();
  private readonly pool: Ribbon[] = [];
  private samples = SAMPLES_1X;
  private linger = LINGER_1X;
  /** Under-stroke strength: stronger on pale ground (set from the backdrop's luminance). */
  private underAlpha = 0.3;
  // Scratch for the smoothed strip.
  private readonly sx = new Float32Array(POINTS);
  private readonly sy = new Float32Array(POINTS);
  private readonly mx = new Float32Array(POINTS);
  private readonly my = new Float32Array(POINTS);

  constructor() {
    const tex = texture();
    // Quads between consecutive points: tip_i, tip_i+1, mid_i+1, mid_i (vertex 2i is tip, 2i+1 mid).
    const indices = new Uint32Array((POINTS - 1) * 6);
    for (let i = 0; i < POINTS - 1; i++) {
      const a = i * 2;
      const o = i * 6;
      indices[o] = a;
      indices[o + 1] = a + 2;
      indices[o + 2] = a + 3;
      indices[o + 3] = a;
      indices[o + 4] = a + 3;
      indices[o + 5] = a + 1;
    }
    for (let i = 0; i < MAX_RIBBONS; i++) {
      const geometry = new MeshGeometry({ positions: new Float32Array(POINTS * 4), uvs: new Float32Array(POINTS * 4), indices: indices.slice() });
      const under = new Mesh({ geometry, texture: tex });
      under.tint = 0x0b0a09;
      under.visible = false;
      under.position.set(0.8, 1.6);
      const mesh = new Mesh({ geometry, texture: tex });
      mesh.blendMode = "add";
      mesh.visible = false;
      this.graphics.addChild(under, mesh);
      this.pool.push({ active: false, ownerId: -1, tip: new Float32Array(MAX_SAMPLES * 2), mid: new Float32Array(MAX_SAMPLES * 2), count: 0, head: 0, color: 0xffffff, alpha: 1, fade: -1, linger: LINGER_1X, mesh, under, geometry });
    }
  }

  get live(): number {
    let n = 0;
    for (const r of this.pool) if (r.active) n++;
    return n;
  }

  /** Battle speed: at 2x the ribbon keeps more samples and lingers longer. */
  setSpeed(speed: number): void {
    this.samples = speed > 1 ? SAMPLES_2X : SAMPLES_1X;
    this.linger = speed > 1 ? LINGER_2X : LINGER_1X;
  }

  /** Backdrop luminance (0 dark to 1 pale): the under-stroke deepens on pale ground. */
  setGroundLuminance(l: number): void {
    this.underAlpha = 0.18 + 0.4 * Math.max(0, Math.min(1, (l - 0.2) / 0.4));
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
    pick.linger = this.linger;
    pick.mesh.tint = color;
    return pick;
  }

  sample(r: Ribbon, tipX: number, tipY: number, midX: number, midY: number): void {
    if (!r.active || r.fade >= 0) return;
    const i = r.head * 2;
    r.tip[i] = tipX;
    r.tip[i + 1] = tipY;
    r.mid[i] = midX;
    r.mid[i + 1] = midY;
    r.head = (r.head + 1) % MAX_SAMPLES;
    if (r.count < MAX_SAMPLES) r.count++;
  }

  /** The swing ended: the ribbon fades out. */
  release(r: Ribbon): void {
    if (r.active && r.fade < 0) r.fade = r.linger;
  }

  clear(): void {
    for (const r of this.pool) this.hide(r);
  }

  private hide(r: Ribbon): void {
    r.active = false;
    r.mesh.visible = false;
    r.under.visible = false;
  }

  update(dt: number): void {
    for (const r of this.pool) {
      if (!r.active) continue;
      if (r.fade >= 0) {
        r.fade -= dt;
        if (r.fade <= 0) {
          this.hide(r);
          continue;
        }
      }
      const n = Math.min(r.count, this.samples);
      if (n >= 2) this.draw(r, n);
      else {
        r.mesh.visible = false;
        r.under.visible = false;
      }
    }
  }

  /** k-th oldest of the newest `n` samples. */
  private at(buf: Float32Array, r: Ribbon, n: number, k: number, axis: number): number {
    const start = (r.head - n + MAX_SAMPLES * 2) % MAX_SAMPLES;
    const idx = (start + Math.max(0, Math.min(n - 1, k))) % MAX_SAMPLES;
    return buf[idx * 2 + axis]!;
  }

  private draw(r: Ribbon, n: number): void {
    let m = 0;
    for (let k = 0; k < n - 1; k++) {
      for (let s = 0; s < SUB; s++) {
        const t = s / SUB;
        this.sx[m] = cr(this.at(r.tip, r, n, k - 1, 0), this.at(r.tip, r, n, k, 0), this.at(r.tip, r, n, k + 1, 0), this.at(r.tip, r, n, k + 2, 0), t);
        this.sy[m] = cr(this.at(r.tip, r, n, k - 1, 1), this.at(r.tip, r, n, k, 1), this.at(r.tip, r, n, k + 1, 1), this.at(r.tip, r, n, k + 2, 1), t);
        this.mx[m] = cr(this.at(r.mid, r, n, k - 1, 0), this.at(r.mid, r, n, k, 0), this.at(r.mid, r, n, k + 1, 0), this.at(r.mid, r, n, k + 2, 0), t);
        this.my[m] = cr(this.at(r.mid, r, n, k - 1, 1), this.at(r.mid, r, n, k, 1), this.at(r.mid, r, n, k + 1, 1), this.at(r.mid, r, n, k + 2, 1), t);
        m++;
      }
    }
    this.sx[m] = this.at(r.tip, r, n, n - 1, 0);
    this.sy[m] = this.at(r.tip, r, n, n - 1, 1);
    this.mx[m] = this.at(r.mid, r, n, n - 1, 0);
    this.my[m] = this.at(r.mid, r, n, n - 1, 1);
    m++;
    const pos = r.geometry.positions;
    const uvs = r.geometry.uvs;
    for (let i = 0; i < POINTS; i++) {
      // Unused points collapse onto the newest one (degenerate quads draw nothing).
      const j = i < m ? i : m - 1;
      // The strip narrows toward the tail: the inner edge closes onto the tip track.
      const w = j / (m - 1);
      const tx = this.sx[j]!;
      const ty = this.sy[j]!;
      const o = i * 4;
      pos[o] = tx;
      pos[o + 1] = ty;
      pos[o + 2] = tx + (this.mx[j]! - tx) * w;
      pos[o + 3] = ty + (this.my[j]! - ty) * w;
      uvs[o] = w;
      uvs[o + 1] = 0;
      uvs[o + 2] = w;
      uvs[o + 3] = 1;
    }
    r.geometry.getBuffer("aPosition").update();
    r.geometry.getBuffer("aUV").update();
    const fade = r.fade >= 0 ? r.fade / r.linger : 1;
    r.mesh.alpha = r.alpha * fade;
    r.under.alpha = Math.min(1, r.alpha * 1.1) * this.underAlpha * fade;
    r.mesh.visible = true;
    r.under.visible = this.underAlpha > 0.01;
  }

  destroy(): void {
    for (const r of this.pool) r.geometry.destroy();
    this.graphics.destroy({ children: true });
    this.pool.length = 0;
    ribbonTexture?.destroy(true);
    ribbonTexture = null;
  }
}

function cr(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
