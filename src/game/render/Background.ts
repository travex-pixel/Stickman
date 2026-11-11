import { Container, Graphics, Sprite, Texture } from "pixi.js";
import type { RegionDef } from "../data/regions";
import { softCircle } from "./textures";

/**
 * Painted battlefield.
 *
 * Each layer is painted once into an offscreen 2D canvas with watercolour techniques
 * (layered translucent washes, wobbly edges, pigment pooling, paper grain) and uploaded
 * as a single texture. Per frame we only move sprites: parallax drift, fog and dust.
 */

interface Scene {
  skyTop: string;
  skyMid: string;
  horizon: string;
  sun: string;
  far: string;
  mid: string;
  near: string;
  groundFar: string;
  groundNear: string;
  pigment: string[];
  crack: string;
  fog: number;
  mote: number;
  props: "ruins" | "drowned";
}

const SCENES: Record<string, Scene> = {
  ashen_verge: {
    skyTop: "#323b49",
    skyMid: "#6f7273",
    horizon: "#c6b796",
    sun: "rgba(236, 205, 150, 0.55)",
    far: "#8a867b",
    mid: "#5f5d58",
    near: "#3d3b38",
    groundFar: "#6d685d",
    groundNear: "#36332e",
    pigment: ["rgba(120, 96, 70, 0.10)", "rgba(70, 78, 84, 0.10)", "rgba(150, 130, 96, 0.08)", "rgba(40, 36, 32, 0.10)"],
    crack: "rgba(22, 20, 18, 0.5)",
    fog: 0xd9cdb2,
    mote: 0xf0d9a8,
    props: "ruins",
  },
  drowned_hollow: {
    skyTop: "#1f3036",
    skyMid: "#4f6f6b",
    horizon: "#a9c4b4",
    sun: "rgba(200, 236, 220, 0.45)",
    far: "#6f8f87",
    mid: "#4b6862",
    near: "#2d413f",
    groundFar: "#557069",
    groundNear: "#26363a",
    pigment: ["rgba(60, 110, 104, 0.12)", "rgba(30, 50, 56, 0.12)", "rgba(140, 180, 160, 0.08)", "rgba(20, 30, 34, 0.12)"],
    crack: "rgba(14, 24, 26, 0.5)",
    fog: 0xc9e2d6,
    mote: 0xbff0e0,
    props: "drowned",
  },
};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  return [c, ctx];
}

/** A wobbly closed shape painted three times with slight offsets: the soft "bleed" edge of watercolour. */
function wash(ctx: CanvasRenderingContext2D, pts: [number, number][], color: string, alpha: number, r: () => number, jitter: number): void {
  for (let pass = 0; pass < 3; pass++) {
    ctx.globalAlpha = alpha * (pass === 0 ? 0.7 : 0.25);
    ctx.fillStyle = color;
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const jx = x + (r() - 0.5) * jitter * (pass + 1);
      const jy = y + (r() - 0.5) * jitter * (pass + 1);
      if (i === 0) ctx.moveTo(jx, jy);
      else ctx.lineTo(jx, jy);
    });
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / Math.max(rx, ry));
  ctx.translate(-x, -y);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(rx, ry), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function grain(ctx: CanvasRenderingContext2D, w: number, h: number, r: () => number, density: number): void {
  const n = Math.floor(w * h * density);
  for (let i = 0; i < n; i++) {
    const light = r() < 0.5;
    ctx.fillStyle = light ? `rgba(255,248,230,${0.025 + r() * 0.04})` : `rgba(0,0,0,${0.03 + r() * 0.05})`;
    ctx.fillRect(r() * w, r() * h, 1 + r() * 1.2, 1 + r() * 1.2);
  }
}

function paintSky(sc: Scene, w: number, h: number, groundTop: number, seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(w, h);
  const r = rng(seed);
  const g = ctx.createLinearGradient(0, 0, 0, groundTop);
  g.addColorStop(0, sc.skyTop);
  g.addColorStop(0.55, sc.skyMid);
  g.addColorStop(1, sc.horizon);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, groundTop + 2);
  // Low sun bleeding through haze.
  blob(ctx, w * 0.7, groundTop * 0.62, w * 0.42, groundTop * 0.5, sc.sun);
  // Broad horizontal washes: cloud banks painted wet-in-wet.
  for (let i = 0; i < 7; i++) {
    const y = groundTop * (0.1 + r() * 0.65);
    blob(ctx, r() * w, y, w * (0.3 + r() * 0.4), groundTop * (0.05 + r() * 0.08), i % 2 ? "rgba(255,245,225,0.10)" : "rgba(20,24,32,0.10)");
  }
  grain(ctx, w, groundTop, r, 0.05);
  return c;
}

function skyline(sc: Scene, w: number, h: number, baseY: number, color: string, scale: number, seed: number, alpha: number, kind: "far" | "mid"): HTMLCanvasElement {
  const [c, ctx] = canvas(w, h);
  const r = rng(seed);
  const jitter = 2.2;
  let x = -20;
  while (x < w + 20) {
    const bw = (18 + r() * 34) * scale;
    const bh = (kind === "far" ? 0.28 + r() * 0.45 : 0.18 + r() * 0.35) * baseY;
    const top = baseY - bh;
    if (sc.props === "ruins") {
      if (r() < 0.35) {
        // spire
        wash(ctx, [[x, baseY], [x, top + bw * 0.4], [x + bw / 2, top - bw * 0.6], [x + bw, top + bw * 0.4], [x + bw, baseY]], color, alpha, r, jitter);
      } else if (r() < 0.5 && kind === "mid") {
        // broken arch
        wash(ctx, [[x, baseY], [x, top], [x + bw * 0.25, top], [x + bw * 0.25, top + bh * 0.35], [x + bw * 1.6, top + bh * 0.35], [x + bw * 1.6, top + bh * 0.1], [x + bw * 1.85, top + bh * 0.1], [x + bw * 1.85, baseY]], color, alpha, r, jitter);
        x += bw;
      } else {
        // broken tower with a jagged top
        wash(ctx, [[x, baseY], [x, top + 6], [x + bw * 0.3, top], [x + bw * 0.45, top + 10 * scale], [x + bw * 0.7, top + 3], [x + bw, top + 14 * scale], [x + bw, baseY]], color, alpha, r, jitter);
      }
    } else {
      if (r() < 0.45) {
        // drowned pillar leaning out of the water
        const lean = (r() - 0.5) * 14;
        wash(ctx, [[x, baseY], [x + lean, top], [x + bw * 0.6 + lean, top + 4], [x + bw * 0.6, baseY]], color, alpha, r, jitter);
      } else {
        // reed clumps / mangrove roots
        for (let k = 0; k < 4; k++) {
          const sx = x + r() * bw;
          wash(ctx, [[sx, baseY], [sx + (r() - 0.5) * 10, top + r() * bh * 0.5], [sx + 3, baseY]], color, alpha * 0.9, r, 1.5);
        }
      }
    }
    x += bw + (kind === "far" ? r() * 10 : 14 + r() * 30) * scale;
  }
  if (kind === "far") landmark(ctx, sc, w, baseY, scale, r);
  if (kind === "mid" && sc.props === "ruins") {
    for (let i = 0; i < 3; i++) deadTree(ctx, w * (0.12 + i * 0.36 + r() * 0.08), baseY, (30 + r() * 26) * scale, color, r);
  }
  // Atmospheric fade into the haze at the base of the layer.
  const fade = ctx.createLinearGradient(0, baseY * 0.55, 0, baseY + 2);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(1, sc.horizon + (kind === "far" ? "cc" : "88"));
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, baseY + 2);
  return c;
}

/** The place's signature silhouette, sitting under the Rift crack so the eye has somewhere to rest. */
function landmark(ctx: CanvasRenderingContext2D, sc: Scene, w: number, baseY: number, scale: number, r: () => number): void {
  const cx = w * 0.62;
  const color = sc.far;
  if (sc.props === "ruins") {
    // The Gate of the First Rift: two great pillars and a broken lintel.
    const pw = 16 * scale;
    const ph = baseY * 0.78;
    const gap = 58 * scale;
    wash(ctx, [[cx - gap - pw, baseY], [cx - gap - pw, baseY - ph], [cx - gap - pw * 1.3, baseY - ph - 6 * scale], [cx - gap + pw * 0.3, baseY - ph - 6 * scale], [cx - gap, baseY - ph], [cx - gap, baseY]], color, 0.9, r, 2);
    wash(ctx, [[cx + gap, baseY], [cx + gap, baseY - ph * 0.86], [cx + gap - pw * 0.3, baseY - ph * 0.86 - 6 * scale], [cx + gap + pw * 1.3, baseY - ph * 0.86 - 6 * scale], [cx + gap + pw, baseY - ph * 0.86], [cx + gap + pw, baseY]], color, 0.9, r, 2);
    wash(ctx, [[cx - gap - pw * 1.4, baseY - ph - 6 * scale], [cx - gap - pw * 1.4, baseY - ph - 16 * scale], [cx + 6 * scale, baseY - ph - 14 * scale], [cx + 18 * scale, baseY - ph - 4 * scale], [cx - 4 * scale, baseY - ph - 6 * scale]], color, 0.9, r, 2);
    // Pale light leaking through the gate.
    blob(ctx, cx, baseY - ph * 0.45, gap * 0.9, ph * 0.5, "rgba(235, 225, 200, 0.16)");
  } else {
    // A drowned colossus: a cowled head and a raised hand breaking the waterline.
    const hr = 34 * scale;
    wash(ctx, [[cx - hr, baseY], [cx - hr * 0.9, baseY - hr * 1.3], [cx - hr * 0.2, baseY - hr * 2.0], [cx + hr * 0.6, baseY - hr * 1.6], [cx + hr, baseY - hr * 0.6], [cx + hr * 1.1, baseY]], color, 0.88, r, 2);
    wash(ctx, [[cx + hr * 2.1, baseY], [cx + hr * 2.0, baseY - hr * 1.6], [cx + hr * 2.2, baseY - hr * 2.4], [cx + hr * 2.5, baseY - hr * 2.3], [cx + hr * 2.6, baseY - hr * 1.5], [cx + hr * 2.5, baseY]], color, 0.85, r, 2);
    blob(ctx, cx + hr * 0.1, baseY - hr * 1.1, hr * 1.4, hr * 0.8, "rgba(200, 236, 224, 0.14)");
  }
}

function deadTree(ctx: CanvasRenderingContext2D, x: number, baseY: number, h: number, color: string, r: () => number): void {
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  const branch = (bx: number, by: number, len: number, ang: number, width: number, depth: number) => {
    const ex = bx + Math.cos(ang) * len;
    const ey = by + Math.sin(ang) * len;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo((bx + ex) / 2 + (r() - 0.5) * len * 0.3, (by + ey) / 2, ex, ey);
    ctx.stroke();
    if (depth > 0) {
      branch(ex, ey, len * 0.62, ang - 0.5 - r() * 0.3, width * 0.6, depth - 1);
      branch(ex, ey, len * 0.55, ang + 0.4 + r() * 0.3, width * 0.6, depth - 1);
    }
  };
  branch(x, baseY, h * 0.55, -Math.PI / 2 + (r() - 0.5) * 0.2, Math.max(2, h * 0.08), 3);
  ctx.globalAlpha = 1;
}

function paintGround(sc: Scene, w: number, h: number, groundTop: number, seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(w, h);
  const r = rng(seed);
  const g = ctx.createLinearGradient(0, groundTop, 0, h);
  g.addColorStop(0, sc.groundFar);
  g.addColorStop(1, sc.groundNear);
  ctx.fillStyle = g;
  ctx.fillRect(0, groundTop, w, h - groundTop);
  // Soft horizon haze line where ground meets sky.
  // A feathered haze where ground meets sky, rather than a hard band.
  const haze = ctx.createLinearGradient(0, groundTop - 30, 0, groundTop + 60);
  haze.addColorStop(0, sc.horizon + "00");
  haze.addColorStop(0.35, sc.horizon + "88");
  haze.addColorStop(0.55, sc.horizon + "55");
  haze.addColorStop(1, sc.horizon + "00");
  ctx.fillStyle = haze;
  ctx.fillRect(0, groundTop - 30, w, 90);
  // Pigment pooling: the uneven blooms of a wet wash drying.
  for (let i = 0; i < 26; i++) {
    const y = groundTop + r() * (h - groundTop);
    const depth = (y - groundTop) / (h - groundTop);
    blob(ctx, r() * w, y, (40 + r() * 120) * (0.6 + depth), (8 + r() * 18) * (0.6 + depth), sc.pigment[i % sc.pigment.length] as string);
  }
  // Long dry-brush strokes following the perspective.
  for (let i = 0; i < 40; i++) {
    const y = groundTop + Math.pow(r(), 0.8) * (h - groundTop);
    const depth = (y - groundTop) / (h - groundTop);
    ctx.strokeStyle = r() < 0.5 ? "rgba(255,245,225,0.05)" : "rgba(0,0,0,0.08)";
    ctx.lineWidth = 1 + depth * 2.5;
    const x0 = r() * w;
    const len = (30 + r() * 120) * (0.5 + depth);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.quadraticCurveTo(x0 + len / 2, y + (r() - 0.5) * 3, x0 + len, y + (r() - 0.5) * 2);
    ctx.stroke();
  }
  // Ink cracks: few, deliberate.
  for (let i = 0; i < 5; i++) {
    let x = w * (0.08 + i * 0.2 + r() * 0.08);
    let y = groundTop + (h - groundTop) * (0.35 + r() * 0.5);
    ctx.strokeStyle = sc.crack;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      x += 8 + r() * 18;
      y += (r() - 0.4) * 8;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Scattered stones with a light top edge.
  for (let i = 0; i < 14; i++) {
    const y = groundTop + 10 + r() * (h - groundTop - 10);
    const depth = (y - groundTop) / (h - groundTop);
    const x = r() * w;
    const s = (2 + r() * 4) * (0.6 + depth);
    ctx.fillStyle = "rgba(20,18,16,0.35)";
    ctx.beginPath();
    ctx.ellipse(x, y, s * 1.4, s * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,245,225,0.08)";
    ctx.beginPath();
    ctx.ellipse(x - s * 0.2, y - s * 0.3, s * 0.9, s * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (sc.props === "drowned") {
    // Standing water: pale reflective strips.
    for (let i = 0; i < 9; i++) {
      const y = groundTop + 14 + r() * (h - groundTop - 20);
      const depth = (y - groundTop) / (h - groundTop);
      blob(ctx, r() * w, y, (50 + r() * 90) * (0.6 + depth), 3 + depth * 4, "rgba(200,236,224,0.14)");
    }
  }
  grain(ctx, w, h, r, 0.06);
  return c;
}

function paintVignette(sc: Scene, w: number, h: number, groundTop: number): HTMLCanvasElement {
  const [c, ctx] = canvas(w, h);
  const g = ctx.createRadialGradient(w / 2, h * 0.55, Math.min(w, h) * 0.35, w / 2, h * 0.55, Math.max(w, h) * 0.8);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(8,8,10,0.55)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Foreground ink: grass tufts and rubble silhouettes framing the bottom edge.
  const r = rng(91);
  ctx.fillStyle = sc.props === "drowned" ? "rgba(12,22,24,0.85)" : "rgba(16,14,12,0.85)";
  for (let i = 0; i < 18; i++) {
    const x = r() * w;
    const base = h + 2;
    const tall = 8 + r() * 18;
    ctx.beginPath();
    ctx.moveTo(x - 6, base);
    for (let k = 0; k < 4; k++) {
      const bx = x - 6 + k * 4;
      ctx.lineTo(bx + 1, base - tall * (0.5 + r() * 0.5));
      ctx.lineTo(bx + 3, base);
    }
    ctx.closePath();
    ctx.fill();
  }
  void groundTop;
  return c;
}

export class Background {
  readonly container = new Container();
  readonly foreground = new Container();
  private sky = new Sprite();
  private far = new Sprite();
  private mid = new Sprite();
  private ground = new Sprite();
  private vignette = new Sprite();
  /** The Rift: the game's signature mark, a gold fissure in the sky that breathes slowly. */
  private fissure = new Graphics();
  private fissureGlow = new Graphics();
  private fogLayers: Sprite[] = [];
  private motes: { s: Sprite; vx: number; vy: number; life: number; total: number }[] = [];
  private textures: Texture[] = [];
  private width = 0;
  private height = 0;
  private groundTop = 0;
  private time = 0;
  private region: RegionDef;
  private scene: Scene;
  private reduced = false;
  private cam = 0;

  constructor(region: RegionDef) {
    this.region = region;
    this.scene = SCENES[region.id] ?? (SCENES.ashen_verge as Scene);
    this.container.addChild(this.sky, this.fissureGlow, this.fissure, this.far, this.mid);
    this.fissureGlow.blendMode = "add";
    for (let i = 0; i < 3; i++) {
      const s = new Sprite(softCircle());
      s.anchor.set(0.5);
      s.tint = this.scene.fog;
      s.alpha = 0.12;
      this.fogLayers.push(s);
      this.container.addChild(s);
    }
    this.container.addChild(this.ground);
    this.foreground.addChild(this.vignette);
  }

  get regionId(): string {
    return this.region.id;
  }

  setReduced(v: boolean): void {
    this.reduced = v;
  }

  /** Parallax: x in [-1, 1], where the action is centred. Layers drift a few pixels, never enough to distract. */
  setCamera(x: number): void {
    this.cam += (x - this.cam) * 0.04;
    const w = this.width;
    this.far.x = -w * 0.03 - this.cam * w * 0.012;
    this.mid.x = -w * 0.03 - this.cam * w * 0.028;
  }

  layout(width: number, height: number, groundTop: number): void {
    // Ignore sub-8px jitter (mobile URL bars, dvh rounding); repaint only on a real size change.
    if (Math.abs(width - this.width) < 1 && Math.abs(height - this.height) < 8 && this.textures.length > 0) return;
    this.width = width;
    this.height = height;
    this.groundTop = groundTop;
    for (const t of this.textures) t.destroy(true);
    this.textures = [];
    const res = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    const W = width * res;
    const H = height * res;
    const GT = groundTop * res;
    const make = (c: HTMLCanvasElement, sprite: Sprite, dispW = width, dispH = height) => {
      const t = Texture.from(c);
      this.textures.push(t);
      sprite.texture = t;
      sprite.width = dispW;
      sprite.height = dispH;
    };
    const sc = this.scene;
    make(paintSky(sc, W, H, GT, 11), this.sky);
    // Parallax layers are painted slightly wider than the screen so they can drift.
    make(skyline(sc, W * 1.06, H, GT * 0.98, sc.far, res, 23, 0.85, "far"), this.far, width * 1.06, height);
    make(skyline(sc, W * 1.06, H, GT + 2 * res, sc.mid, res, 37, 0.95, "mid"), this.mid, width * 1.06, height);
    make(paintGround(sc, W, H, GT, 53), this.ground);
    make(paintVignette(sc, W, H, GT), this.vignette);
    this.far.x = -width * 0.03;
    this.mid.x = -width * 0.03;
    this.paintFissure(width, groundTop);
    this.fogLayers.forEach((s, i) => {
      s.width = width * (0.9 + i * 0.25);
      s.height = (height - groundTop) * 0.5;
      s.y = groundTop - 4 + i * 10;
      s.x = (width / 3) * i + width * 0.2;
    });
  }

  private paintFissure(width: number, groundTop: number): void {
    const r = rng(7);
    const x0 = width * 0.63;
    const pts: [number, number][] = [[x0, -4]];
    let x = x0;
    let y = -4;
    while (y < groundTop * 0.55) {
      y += groundTop * (0.05 + r() * 0.06);
      x += (r() - 0.55) * width * 0.04;
      pts.push([x, y]);
    }
    const path = (g: Graphics) => {
      g.moveTo(pts[0]![0], pts[0]![1]);
      for (const [px, py] of pts.slice(1)) g.lineTo(px, py);
    };
    this.fissure.clear();
    path(this.fissure);
    this.fissure.stroke({ width: 1.6, color: 0xfff1cc, alpha: 0.9, cap: "round", join: "round" });
    // Two short branches.
    const b = pts[2] ?? pts[1]!;
    this.fissure.moveTo(b[0], b[1]).lineTo(b[0] + width * 0.03, b[1] + groundTop * 0.06).stroke({ width: 1, color: 0xfff1cc, alpha: 0.7 });
    const c = pts[4] ?? pts[pts.length - 1]!;
    this.fissure.moveTo(c[0], c[1]).lineTo(c[0] - width * 0.025, c[1] + groundTop * 0.05).stroke({ width: 1, color: 0xfff1cc, alpha: 0.6 });
    this.fissureGlow.clear();
    path(this.fissureGlow);
    this.fissureGlow.stroke({ width: 9, color: 0xe9c97a, alpha: 0.18, cap: "round", join: "round" });
    path(this.fissureGlow);
    this.fissureGlow.stroke({ width: 22, color: 0xe9c97a, alpha: 0.06, cap: "round", join: "round" });
  }

  update(dt: number): void {
    this.time += dt;
    const breath = 0.5 + 0.5 * Math.sin(this.time * 0.9);
    this.fissureGlow.alpha = 0.55 + breath * 0.45;
    this.fissure.alpha = 0.75 + breath * 0.25;
    this.fogLayers.forEach((s, i) => {
      s.x += (5 + i * 3) * dt * (i % 2 === 0 ? 1 : -1);
      if (s.x > this.width + s.width / 2) s.x = -s.width / 2;
      if (s.x < -s.width / 2) s.x = this.width + s.width / 2;
      s.alpha = 0.1 + Math.sin(this.time * 0.25 + i * 1.7) * 0.035;
    });
    if (this.reduced) return;
    // Dust motes drifting in the light: few, slow, soft.
    if (this.motes.length < 14 && Math.random() < dt * 4) {
      const s = new Sprite(softCircle());
      s.anchor.set(0.5);
      s.tint = this.scene.mote;
      s.blendMode = "add";
      s.x = Math.random() * this.width;
      s.y = this.groundTop * (0.5 + Math.random() * 0.9);
      s.scale.set(0.03 + Math.random() * 0.05);
      this.container.addChild(s);
      this.motes.push({ s, vx: 4 + Math.random() * 8, vy: -(2 + Math.random() * 6), life: 0, total: 5 + Math.random() * 4 });
    }
    for (let i = this.motes.length - 1; i >= 0; i--) {
      const m = this.motes[i]!;
      m.life += dt;
      m.s.x += (m.vx + Math.sin(this.time + i) * 3) * dt;
      m.s.y += m.vy * dt;
      m.s.alpha = Math.sin((m.life / m.total) * Math.PI) * 0.55;
      if (m.life >= m.total) {
        m.s.destroy();
        this.motes.splice(i, 1);
      }
    }
  }

  destroy(): void {
    for (const t of this.textures) t.destroy(true);
    this.textures = [];
    this.container.destroy({ children: true });
    this.foreground.destroy({ children: true });
  }
}
