import { Container, Graphics, GraphicsContext, Sprite } from "pixi.js";
import { hardCircle, softCircle } from "../../textures";
import { finTex, scaleTex } from "../textures";

/**
 * The Abyssal Devourer's body: a serpent of ink scales that moves along a path, not a sprite that
 * slides. The head travels the path; every segment sits at a fixed arc distance behind it on the
 * SAME path, so the body slithers through the exact curve the head drew (follow-the-leader). The
 * path itself winds (a serpentine wave baked into it), and a small travelling ripple keeps the body
 * alive. The jaw opens as a foe comes near and snaps shut on it; the eyes burn crimson; smoke trails.
 *
 * Built once and reused (the director keeps at most two); nothing is drawn per frame but the
 * whiskers and the maw's light (a few lines). Coordinates are base px.
 */
export const MAX_PATH = 320;
const SEGMENTS_MAX = 30;

/** A polyline with cumulative arc lengths, sampled by distance. */
export class SerpentPath {
  readonly xs = new Float32Array(MAX_PATH);
  readonly ys = new Float32Array(MAX_PATH);
  readonly len = new Float32Array(MAX_PATH);
  n = 0;
  get total(): number {
    return this.n > 0 ? this.len[this.n - 1]! : 0;
  }

  clear(): void {
    this.n = 0;
  }

  push(x: number, y: number): void {
    if (this.n >= MAX_PATH) return;
    const i = this.n;
    this.xs[i] = x;
    this.ys[i] = y;
    this.len[i] = i === 0 ? 0 : this.len[i - 1]! + Math.hypot(x - this.xs[i - 1]!, y - this.ys[i - 1]!);
    this.n += 1;
  }

  /**
   * Fill with a Catmull-Rom spline through `pts` (x, y pairs), sampled finely, with a serpentine
   * wave of `amp` px and wavelength `wave` px across it (tapered at both ends).
   */
  build(pts: number[], amp: number, wave: number, phase: number): void {
    this.clear();
    const m = pts.length / 2;
    if (m < 2) return;
    const raw: number[] = [];
    const per = Math.max(4, Math.floor((MAX_PATH - 4) / (m - 1)));
    for (let i = 0; i < m - 1; i++) {
      const i0 = Math.max(0, i - 1);
      const i3 = Math.min(m - 1, i + 2);
      const x0 = pts[i0 * 2]!, y0 = pts[i0 * 2 + 1]!;
      const x1 = pts[i * 2]!, y1 = pts[i * 2 + 1]!;
      const x2 = pts[(i + 1) * 2]!, y2 = pts[(i + 1) * 2 + 1]!;
      const x3 = pts[i3 * 2]!, y3 = pts[i3 * 2 + 1]!;
      for (let s = 0; s < per; s++) {
        const t = s / per;
        const t2 = t * t;
        const t3 = t2 * t;
        raw.push(0.5 * (2 * x1 + (-x0 + x2) * t + (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 + (-x0 + 3 * x1 - 3 * x2 + x3) * t3));
        raw.push(0.5 * (2 * y1 + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (-y0 + 3 * y1 - 3 * y2 + y3) * t3));
      }
    }
    raw.push(pts[(m - 1) * 2]!, pts[(m - 1) * 2 + 1]!);
    // Arc length of the spline, then the wave across it by distance.
    const k = raw.length / 2;
    const L = new Float32Array(k);
    for (let i = 1; i < k; i++) L[i] = L[i - 1]! + Math.hypot(raw[i * 2]! - raw[i * 2 - 2]!, raw[i * 2 + 1]! - raw[i * 2 - 1]!);
    const total = L[k - 1]! || 1;
    for (let i = 0; i < k; i++) {
      const a = i > 0 ? i - 1 : 0;
      const b = i < k - 1 ? i + 1 : k - 1;
      const tx = raw[b * 2]! - raw[a * 2]!;
      const ty = raw[b * 2 + 1]! - raw[a * 2 + 1]!;
      const tl = Math.hypot(tx, ty) || 1;
      const s = L[i]!;
      const taper = Math.min(1, s / 60, (total - s) / 60);
      const w = Math.sin((s / wave) * Math.PI * 2 + phase) * amp * Math.max(0, taper);
      this.push(raw[i * 2]! + (-ty / tl) * w, raw[i * 2 + 1]! + (tx / tl) * w);
    }
  }

  /**
   * Fill with points already dense (a curve sampled by the caller), adding the serpentine wave by
   * arc length, tapered in only at the start: appending more points later and building again leaves
   * the part already travelled exactly where it was.
   */
  buildRaw(raw: number[], amp: number, wave: number, phase: number): void {
    this.clear();
    const k = raw.length / 2;
    if (k < 2) return;
    let s = 0;
    for (let i = 0; i < k; i++) {
      if (i > 0) s += Math.hypot(raw[i * 2]! - raw[i * 2 - 2]!, raw[i * 2 + 1]! - raw[i * 2 - 1]!);
      const a = i > 0 ? i - 1 : 0;
      const b = i < k - 1 ? i + 1 : k - 1;
      const tx = raw[b * 2]! - raw[a * 2]!;
      const ty = raw[b * 2 + 1]! - raw[a * 2 + 1]!;
      const tl = Math.hypot(tx, ty) || 1;
      const w = Math.sin((s / wave) * Math.PI * 2 + phase) * amp * Math.min(1, s / 80);
      this.push(raw[i * 2]! + (-ty / tl) * w, raw[i * 2 + 1]! + (tx / tl) * w);
    }
  }

  /** Arc distance at raw point index `f` (fractional). */
  lengthAt(f: number): number {
    if (this.n === 0) return 0;
    const i = Math.max(0, Math.min(this.n - 1, Math.floor(f)));
    const j = Math.min(this.n - 1, i + 1);
    const k = Math.max(0, Math.min(1, f - i));
    return this.len[i]! + (this.len[j]! - this.len[i]!) * k;
  }

  /** Point and tangent angle at arc distance `s` (clamped). */
  at(s: number, out: { x: number; y: number; a: number }): void {
    const n = this.n;
    if (n === 0) {
      out.x = out.y = out.a = 0;
      return;
    }
    if (s <= 0 || n === 1) {
      out.x = this.xs[0]!;
      out.y = this.ys[0]!;
      out.a = n > 1 ? Math.atan2(this.ys[1]! - this.ys[0]!, this.xs[1]! - this.xs[0]!) : 0;
      return;
    }
    if (s >= this.total) {
      out.x = this.xs[n - 1]!;
      out.y = this.ys[n - 1]!;
      out.a = Math.atan2(this.ys[n - 1]! - this.ys[n - 2]!, this.xs[n - 1]! - this.xs[n - 2]!);
      return;
    }
    // Binary search for the span.
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.len[mid]! <= s) lo = mid;
      else hi = mid;
    }
    const d = this.len[hi]! - this.len[lo]! || 1;
    const t = (s - this.len[lo]!) / d;
    out.x = this.xs[lo]! + (this.xs[hi]! - this.xs[lo]!) * t;
    out.y = this.ys[lo]! + (this.ys[hi]! - this.ys[lo]!) * t;
    out.a = Math.atan2(this.ys[hi]! - this.ys[lo]!, this.xs[hi]! - this.xs[lo]!);
  }

  /** Arc distance of the path point nearest (x, y). */
  nearest(x: number, y: number): number {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < this.n; i += 2) {
      const d = (this.xs[i]! - x) ** 2 + (this.ys[i]! - y) ** 2;
      if (d < bd) {
        bd = d;
        best = this.len[i]!;
      }
    }
    return best;
  }
}

export interface DragonLook {
  /** Body size (px per unit at scale 1). */
  size: number;
  segments: number;
  deep: number;
  mid: number;
  rim: number;
  eye: number;
  gilded: boolean;
  crowned: boolean;
  /** Master: a mane of fins down the whole spine. */
  mane: boolean;
}

const HEAD_CTX = new Map<string, GraphicsContext>();

/** The head, drawn once per look (facing +x, origin at the jaw hinge, unit size 1 = 1px at size 1). */
function headContext(look: DragonLook, part: "skull" | "jaw"): GraphicsContext {
  const key = `${part}|${look.deep}|${look.rim}|${look.gilded}|${look.crowned}`;
  const hit = HEAD_CTX.get(key);
  if (hit && !hit.destroyed) return hit;
  const g = new GraphicsContext();
  const ink = look.deep;
  const rim = look.gilded ? 0xe9c97a : look.rim;
  if (part === "skull") {
    // A long wedge of a skull: brow ridge, snout, swept horns.
    g.poly([-14, -6, -4, -13, 10, -12, 24, -9, 38, -6, 46, -3, 47, 1, 30, 1, 10, 2, -8, 3, -16, 0]).fill(ink);
    // Horns swept back off the brow.
    g.poly([-2, -12, -16, -24, -30, -27, -14, -18, -6, -11]).fill(look.gilded ? 0x8a6a2a : 0x2b2140);
    g.poly([6, -12, -2, -21, -12, -23, -2, -16]).fill(look.gilded ? 0x8a6a2a : 0x2b2140);
    // Rim light along the brow and snout.
    g.moveTo(-12, -7).lineTo(-3, -13).lineTo(10, -12).lineTo(24, -9).lineTo(38, -6).lineTo(46, -3).stroke({ width: 1.4, color: rim, alpha: 0.9 });
    g.moveTo(-14, -24).lineTo(-30, -27).stroke({ width: 1, color: rim, alpha: 0.6 });
    // Upper teeth.
    for (let i = 0; i < 6; i++) {
      const x = 14 + i * 5.2;
      g.poly([x, 1, x + 1.6, 5, x + 3.2, 1]).fill(0xf2ece2);
    }
    // Nostril and the eye socket (the eye itself is a sprite).
    g.circle(42, -3, 1).fill(0x000000);
    if (look.crowned) {
      // A gilt crown of three spines on the brow.
      g.poly([-6, -12, -4, -22, 0, -13, 3, -25, 6, -12, 9, -21, 11, -11]).fill(0xe9c97a);
      g.moveTo(-6, -12).lineTo(11, -11).stroke({ width: 1.2, color: 0xfff1c9, alpha: 1 });
    }
  } else {
    // The lower jaw, hinged at 0: a long blade with teeth.
    g.poly([-10, 0, 8, 1, 26, 2, 40, 1, 41, 4, 24, 8, 6, 8, -8, 5]).fill(ink);
    g.moveTo(-6, 6).lineTo(6, 8).lineTo(24, 8).lineTo(41, 4).stroke({ width: 1, color: rim, alpha: 0.6 });
    for (let i = 0; i < 5; i++) {
      const x = 15 + i * 5.2;
      g.poly([x, 2, x + 1.5, -2, x + 3, 2]).fill(0xf2ece2);
    }
  }
  HEAD_CTX.set(key, g);
  return g;
}

export function clearDragonCache(): void {
  for (const c of HEAD_CTX.values()) c.destroy();
  HEAD_CTX.clear();
}

/**
 * One dragon. `layout(headS)` places it with its head `headS` px along `path`; segments behind the
 * start of the path (still in the portal) or past its end (gone through the exit) are hidden.
 */
export class Dragon {
  readonly root = new Container();
  private readonly bodyBox = new Container();
  private readonly segs: Sprite[] = [];
  private readonly fins: Sprite[] = [];
  private readonly head = new Container();
  private readonly skull: Graphics;
  private readonly jaw: Graphics;
  private readonly maw = new Sprite(softCircle());
  private readonly eyeGlow = new Sprite(softCircle());
  private readonly eye = new Sprite(hardCircle());
  /** Whiskers and the spine's light, redrawn each frame (a few lines). */
  readonly lines = new Graphics();
  look: DragonLook;
  private segCount = 0;
  /** Jaw opening 0..1 (eased by the stage). */
  jawOpen = 0;
  /** The eyes' and maw's glow (fed souls brighten it). */
  burn = 1;
  /** Fades the whole body (the hero's veil, a compact form). */
  private readonly tmp = { x: 0, y: 0, a: 0 };
  /** Where the head is (base px) and which way it faces, after `layout`. */
  readonly headPos = { x: 0, y: 0, a: 0, visible: false };
  /** Mouth point (where bites land). */
  readonly mouth = { x: 0, y: 0 };
  inUse = false;

  constructor(look: DragonLook) {
    this.look = look;
    this.root.addChild(this.bodyBox, this.lines, this.head);
    for (let i = 0; i < SEGMENTS_MAX; i++) {
      const s = new Sprite(scaleTex());
      s.anchor.set(0.5);
      s.visible = false;
      this.segs.push(s);
      const f = new Sprite(finTex());
      f.anchor.set(0.5, 1);
      f.visible = false;
      this.fins.push(f);
    }
    // Tail first in the display list, so the head's end overlaps it.
    for (let i = SEGMENTS_MAX - 1; i >= 0; i--) this.bodyBox.addChild(this.fins[i]!, this.segs[i]!);
    this.skull = new Graphics(headContext(look, "skull"));
    this.jaw = new Graphics(headContext(look, "jaw"));
    this.maw.anchor.set(0.5);
    this.maw.blendMode = "add";
    this.eyeGlow.anchor.set(0.5);
    this.eyeGlow.blendMode = "add";
    this.eye.anchor.set(0.5);
    this.eye.blendMode = "add";
    this.head.addChild(this.maw, this.jaw, this.skull, this.eyeGlow, this.eye);
    this.restyle(look);
  }

  restyle(look: DragonLook): void {
    this.look = look;
    this.segCount = Math.min(SEGMENTS_MAX, look.segments);
    this.skull.context = headContext(look, "skull");
    this.jaw.context = headContext(look, "jaw");
    for (let i = 0; i < SEGMENTS_MAX; i++) {
      const s = this.segs[i]!;
      // The back is the deep ink, the neck a touch of the signature violet.
      s.tint = i < 4 ? look.mid : look.deep;
      const f = this.fins[i]!;
      f.tint = look.gilded ? 0xb8913f : look.mid;
    }
    this.eye.tint = look.crowned ? 0xfff1c9 : 0xffe0d8;
    this.eyeGlow.tint = look.crowned ? 0xe9c97a : look.eye;
    this.maw.tint = look.eye;
  }

  /** Segment radius (px) by index from the head: a thick neck, tapering to a whip of a tail. */
  private radius(i: number): number {
    const n = this.segCount;
    const k = i / Math.max(1, n - 1);
    const neck = i < 3 ? 0.78 + i * 0.08 : 1;
    return this.look.size * (13.5 * (1 - k * 0.82) * neck);
  }

  /** Spacing between segments along the path (px). */
  get spacing(): number {
    return this.look.size * 8.4;
  }

  get length(): number {
    return this.spacing * this.segCount;
  }

  /**
   * Place the body: head at `headS` along `path`, `time` for the ripple, `alpha` overall. A segment
   * near the hero's chest (`veilX`, `veilY`) thins so he is never lost behind it.
   */
  layout(path: SerpentPath, headS: number, time: number, alpha: number, veilX: number, veilY: number, veilR: number, sMin = 0, sMax = Infinity): void {
    const sp = this.spacing;
    const total = path.total;
    const tmp = this.tmp;
    const size = this.look.size;
    this.root.alpha = alpha;
    let first = -1;
    for (let i = 0; i < SEGMENTS_MAX; i++) {
      const seg = this.segs[i]!;
      const fin = this.fins[i]!;
      if (i >= this.segCount) {
        seg.visible = false;
        fin.visible = false;
        continue;
      }
      const s = headS - (i + 0.6) * sp;
      if (s < sMin || s > Math.min(total, sMax)) {
        seg.visible = false;
        fin.visible = false;
        continue;
      }
      if (first < 0) first = i;
      path.at(s, tmp);
      // A small ripple travelling down the body, across the path.
      const rip = Math.sin(time * 9 - i * 0.55) * size * 1.6 * Math.min(1, i / 4);
      const x = tmp.x - Math.sin(tmp.a) * rip;
      const y = tmp.y + Math.cos(tmp.a) * rip;
      const r = this.radius(i);
      seg.visible = true;
      seg.position.set(x, y);
      seg.rotation = tmp.a;
      seg.scale.set((sp * 1.9) / 64, ((Math.cos(tmp.a) < 0 ? -r : r) * 2) / 48);
      const veil = veilR > 0 ? Math.min(1, Math.hypot(x - veilX, y - veilY) / veilR) : 1;
      seg.alpha = 0.45 + 0.55 * veil;
      // Fins on every other segment (Master: every one), standing off the back.
      const finOn = (this.look.mane || i % 2 === 0) && i > 1 && i < this.segCount - 3;
      fin.visible = finOn;
      if (finOn) {
        const up = Math.cos(tmp.a) >= 0 ? -1 : 1;
        fin.position.set(x + Math.sin(tmp.a) * r * 0.75 * -up, y - Math.cos(tmp.a) * r * 0.75 * -up);
        fin.rotation = tmp.a + (up < 0 ? 0 : Math.PI) + Math.sin(time * 7 - i * 0.6) * 0.15;
        const fh = r * (this.look.mane ? 1.25 : 1.05);
        fin.scale.set((r * 0.9) / 24, fh / 32);
        fin.alpha = 0.95 * (0.45 + 0.55 * veil);
      }
    }
    // The head: at the path's front, pointing along it.
    if (headS < sMin || headS - sp * 0.2 > Math.min(total, sMax)) {
      this.head.visible = false;
      this.headPos.visible = false;
    } else {
      path.at(Math.min(total, headS), tmp);
      const hs = size * 1.05;
      this.head.visible = true;
      this.head.position.set(tmp.x, tmp.y);
      const flip = Math.cos(tmp.a) < 0;
      this.head.rotation = tmp.a;
      this.head.scale.set(hs, flip ? -hs : hs);
      this.jaw.rotation = 0.62 * this.jawOpen;
      this.headPos.x = tmp.x;
      this.headPos.y = tmp.y;
      this.headPos.a = tmp.a;
      this.headPos.visible = true;
      // Mouth: 30 units out along the snout.
      const c = Math.cos(tmp.a);
      const s = Math.sin(tmp.a);
      this.mouth.x = tmp.x + c * 30 * hs;
      this.mouth.y = tmp.y + s * 30 * hs;
      // Eye sits up on the brow: (-4, -8) in head space.
      this.eye.position.set(-3, -8);
      this.eye.scale.set(0.13 + 0.03 * this.burn);
      this.eyeGlow.position.set(-3, -8);
      this.eyeGlow.scale.set(0.32 + 0.12 * this.burn);
      this.eyeGlow.alpha = Math.min(1, 0.7 + 0.15 * this.burn);
      this.maw.position.set(18, 3);
      this.maw.scale.set(0.5 + 0.2 * this.burn, 0.25 + 0.3 * this.jawOpen);
      this.maw.alpha = 0.25 + 0.75 * this.jawOpen;
    }
  }

  /** The whiskers trailing from the snout, and the light running down the spine (redrawn). */
  drawLines(path: SerpentPath, headS: number, time: number, light: number, pulse: number, bands = 1): void {
    const g = this.lines;
    g.clear();
    if (!this.headPos.visible) return;
    const tmp = this.tmp;
    const size = this.look.size;
    // Two barbels: start at the snout, trail back along the path, waving.
    for (let w = 0; w < 2; w++) {
      const side = w === 0 ? 1 : -1;
      for (let j = 0; j <= 6; j++) {
        const s = headS + 22 * size - j * 7 * size;
        path.at(Math.max(0, s), tmp);
        const wave = Math.sin(time * 10 + j * 0.9 + w) * (1.5 + j * 1.3) * size;
        const off = side * (4 + j * 0.8) * size + wave;
        const x = tmp.x - Math.sin(tmp.a) * off;
        const y = tmp.y + Math.cos(tmp.a) * off;
        if (j === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke({ width: 1.1 * size, color: this.look.gilded ? 0xe9c97a : this.look.rim, alpha: 0.7 });
    }
    // The spine's light: a pulse of the rim colour running from head to tail (fed souls, crowned).
    if (pulse > 0) {
      const sp = this.spacing;
      const at = (time * 3) % 1;
      for (let i = 1; i < this.segCount; i++) {
        const s = headS - (i + 0.6) * sp;
        if (s < 0 || s > path.total) continue;
        const k = i / this.segCount;
        let near = Math.abs(k - at);
        // More than one band: the pulses are spaced evenly down the body.
        for (let b = 1; b < bands; b++) near = Math.min(near, Math.abs(k - ((at + b / bands) % 1)));
        const glow = Math.max(0, 1 - near * (bands > 1 ? 4 : 6)) * pulse;
        if (glow < 0.05) continue;
        path.at(s, tmp);
        g.circle(tmp.x, tmp.y - this.radius(i) * 0.3, this.radius(i) * 0.45).fill({ color: light, alpha: glow * (bands > 1 ? 0.7 : 0.5) });
      }
    }
  }

  /** A point on the body (`i` segments behind the head) for smoke and sparks. */
  segmentPoint(path: SerpentPath, headS: number, i: number, out: { x: number; y: number }): boolean {
    const s = headS - (i + 0.6) * this.spacing;
    if (s < 0 || s > path.total) return false;
    path.at(s, this.tmp);
    out.x = this.tmp.x;
    out.y = this.tmp.y;
    return true;
  }

  hide(): void {
    for (const s of this.segs) s.visible = false;
    for (const f of this.fins) f.visible = false;
    this.head.visible = false;
    this.headPos.visible = false;
    this.lines.clear();
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
