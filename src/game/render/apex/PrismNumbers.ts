import { Container, Rectangle, Sprite, Texture } from "pixi.js";
import { easeOutCubic } from "../anim/ease";
import { mix } from "../colors";
import { numeralFont } from "../DamageNumbers";
import { softCircle } from "../textures";
import { spectrum } from "./spectrum";

/** Glyphs the prismatic figure can show (figures, their suffixes and the echo mark). */
const CHARS = "0123456789.KMBT×";
/** Atlas size of a glyph, and its dark edge (both in atlas px). */
const ATLAS = 64;
const EDGE = 5.5;
/** Screen size of the figure (a crit is 44px), and of its echo mark. */
export const PRISM_SIZE = 46;
const MARK_SCALE = 0.5;
const MAX_GLYPHS = 10;
const LIFE = 1.15;
const POP_FROM = 1.6;
const POP_TIME = 0.12;
/** Real seconds the figure stays white on arrival (the hit's own light), then the colour floods in. */
const WHITE_TIME = 0.045;

interface Glyph {
  tex: Texture;
  adv: number;
  w: number;
  h: number;
}

interface Fig {
  holder: Container;
  bloom: Sprite;
  glyphs: Sprite[];
  /** Glyph x centres (unscaled atlas px) and which are the mark. */
  xs: Float32Array;
  isMark: Uint8Array;
  n: number;
  width: number;
  active: boolean;
  gen: number;
  life: number;
  age: number;
  vx: number;
  vy: number;
  hue: number;
  bump: number;
}

/**
 * The prismatic damage figure: each glyph is its own sprite cut from an atlas drawn once at mount
 * (white fill shaded toward the foot, a dark edge all round), and each is tinted from the spectrum
 * by its place in the figure plus time, so the colour runs across the number and drifts while it
 * floats. Tinting a white glyph with a dark edge keeps the edge dark, so it reads on every ground.
 * Larger than a crit, it arrives white with a soft bloom of its own colour behind it, and a band of
 * light sweeps across it once.
 */
export class PrismNumbers {
  readonly container = new Container();
  private readonly glyphMap = new Map<string, Glyph>();
  private readonly pool: Fig[] = [];
  private zoom = 1;
  private minX = -Infinity;
  private maxX = Infinity;
  private atlas: Texture | null = null;
  reduced = false;

  constructor(size = 8) {
    this.buildAtlas();
    for (let i = 0; i < size; i++) {
      const holder = new Container();
      const bloom = new Sprite(softCircle());
      bloom.anchor.set(0.5);
      bloom.blendMode = "add";
      holder.addChild(bloom);
      const glyphs: Sprite[] = [];
      for (let k = 0; k < MAX_GLYPHS; k++) {
        const s = new Sprite(Texture.EMPTY);
        s.anchor.set(0.5);
        s.visible = false;
        holder.addChild(s);
        glyphs.push(s);
      }
      holder.visible = false;
      this.container.addChild(holder);
      this.pool.push({ holder, bloom, glyphs, xs: new Float32Array(MAX_GLYPHS), isMark: new Uint8Array(MAX_GLYPHS), n: 0, width: 0, active: false, gen: 0, life: 0, age: 0, vx: 0, vy: 0, hue: 0, bump: 0 });
    }
  }

  private buildAtlas(): void {
    if (typeof document === "undefined") return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const font = `700 ${ATLAS}px ${numeralFont()}`;
    ctx.font = font;
    const pad = EDGE + 3;
    const cellH = Math.ceil(ATLAS * 1.25 + pad * 2);
    const advs: number[] = [];
    let total = 0;
    for (const ch of CHARS) {
      const a = Math.ceil(ctx.measureText(ch).width);
      advs.push(a);
      total += a + pad * 2 + 2;
    }
    canvas.width = Math.min(2048, total);
    canvas.height = cellH;
    ctx.font = font;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    const grad = ctx.createLinearGradient(0, cellH * 0.2, 0, cellH * 0.8);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.55, "#f4f4f4");
    grad.addColorStop(1, "#c9c9c9");
    let x = 0;
    const cells: [string, number, number][] = [];
    let i = 0;
    for (const ch of CHARS) {
      const w = advs[i++]! + pad * 2;
      const cx = x + w / 2;
      ctx.lineWidth = EDGE * 2;
      ctx.strokeStyle = "rgba(12,10,18,0.92)";
      ctx.strokeText(ch, cx, cellH / 2);
      ctx.fillStyle = grad;
      ctx.fillText(ch, cx, cellH / 2);
      cells.push([ch, x, w]);
      x += w + 2;
    }
    const base = Texture.from(canvas);
    this.atlas = base;
    i = 0;
    for (const [ch, cx, w] of cells) {
      const tex = new Texture({ source: base.source, frame: new Rectangle(cx, 0, w, cellH) });
      this.glyphMap.set(ch, { tex, adv: advs[i++]!, w, h: cellH });
    }
  }

  setZoom(z: number): void {
    this.zoom = z > 0 ? z : 1;
  }

  setBounds(minX: number, maxX: number): void {
    this.minX = minX;
    this.maxX = maxX;
  }

  get liveCount(): number {
    let n = 0;
    for (const f of this.pool) if (f.active) n++;
    return n;
  }

  /**
   * A prismatic figure beside a target: (x, y) its chest, `halfW` half its drawn width, `dir` the
   * side away from the attacker. `mark` ("×2", "×3" or "") rides after the number. Returns a handle
   * for `amend` (the swing's echoes add to it).
   */
  show(x: number, y: number, halfW: number, dir: number, value: string, mark: string, stack?: (px: number, py: number, half: number, line: number) => number): number {
    let f: Fig | null = null;
    let idx = 0;
    for (let i = 0; i < this.pool.length; i++) {
      if (!this.pool[i]!.active) {
        f = this.pool[i]!;
        idx = i;
        break;
      }
    }
    if (!f) {
      for (let i = 0; i < this.pool.length; i++) if (!f || this.pool[i]!.life < f.life) {
        f = this.pool[i]!;
        idx = i;
      }
    }
    if (!f) return -1;
    f.gen = (f.gen + 1) & 0xffff;
    f.active = true;
    f.life = LIFE;
    f.age = 0;
    f.bump = 0;
    f.hue = Math.random();
    this.layout(f, value, mark);
    const d = dir >= 0 ? 1 : -1;
    const s = (PRISM_SIZE / ATLAS) / this.zoom;
    const half = (f.width * s) / 2;
    const px = x + d * (halfW + half + 6 / this.zoom);
    const py = y - 14 / this.zoom;
    f.holder.position.set(px, stack ? stack(px, py, half, ATLAS * s * 0.8) : py);
    f.vx = d * 22;
    f.vy = -40;
    f.holder.visible = true;
    this.apply(f);
    return f.gen * 64 + idx;
  }

  /** Add to a figure still on screen; false when it has gone (the caller shows a new one). */
  amend(handle: number, value: string, mark: string): boolean {
    if (handle < 0) return false;
    const f = this.pool[handle % 64];
    if (!f || !f.active || f.gen !== Math.floor(handle / 64)) return false;
    this.layout(f, value, mark);
    f.life = Math.max(f.life, LIFE * 0.8);
    f.bump = 0.09;
    return true;
  }

  private layout(f: Fig, value: string, mark: string): void {
    let n = 0;
    let x = 0;
    const put = (ch: string, isMark: boolean): void => {
      const g = this.glyphMap.get(ch);
      if (!g || n >= MAX_GLYPHS) return;
      const sc = isMark ? MARK_SCALE : 1;
      const s = f.glyphs[n]!;
      s.texture = g.tex;
      s.visible = true;
      s.scale.set(sc);
      f.xs[n] = x + (g.adv * sc) / 2;
      f.isMark[n] = isMark ? 1 : 0;
      x += g.adv * sc * 0.96;
      n++;
    };
    for (const ch of value) put(ch, false);
    if (mark) {
      x += ATLAS * 0.12;
      for (const ch of mark) put(ch, true);
    }
    for (let i = n; i < MAX_GLYPHS; i++) f.glyphs[i]!.visible = false;
    f.n = n;
    f.width = x;
    for (let i = 0; i < n; i++) {
      const s = f.glyphs[i]!;
      s.x = f.xs[i]! - x / 2;
      // The mark sits on the figure's baseline, lower than its centre.
      s.y = f.isMark[i] ? ATLAS * 0.2 : 0;
    }
    f.bloom.scale.set((x / 64) * 1.5, (ATLAS / 64) * 1.6);
  }

  update(dt: number): void {
    for (const f of this.pool) {
      if (!f.active) continue;
      f.life -= dt;
      f.age += dt;
      f.bump = Math.max(0, f.bump - dt);
      if (f.life <= 0) {
        f.active = false;
        f.holder.visible = false;
        continue;
      }
      if (f.age > POP_TIME) {
        f.vy += 26 * dt;
        f.holder.x += (f.vx * dt) / this.zoom;
        f.holder.y += (f.vy * dt) / this.zoom;
      }
      this.apply(f);
    }
  }

  private apply(f: Fig): void {
    const pop = f.age < POP_TIME ? POP_FROM - (POP_FROM - 1) * easeOutCubic(f.age / POP_TIME) : 1;
    const bump = f.bump > 0 ? 1 + 0.12 * (f.bump / 0.09) : 1;
    const s = ((PRISM_SIZE / ATLAS) * pop * bump) / this.zoom;
    f.holder.scale.set(s);
    if (this.maxX > this.minX) {
      const half = (f.width * s) / 2 + 10 / this.zoom;
      f.holder.x = Math.min(this.maxX - half, Math.max(this.minX + half, f.holder.x));
    }
    const k = 1 - f.life / LIFE;
    f.holder.alpha = k > 0.65 ? 1 - easeOutCubic((k - 0.65) / 0.35) : 1;
    // The colour runs across the glyphs and drifts with time; a band of light sweeps across once.
    const drift = this.reduced ? 0.12 : 0.55;
    const sweep = this.reduced ? -9 : (f.age - 0.06) / 0.35;
    const white = f.age < WHITE_TIME;
    for (let i = 0; i < f.n; i++) {
      const g = f.glyphs[i]!;
      if (white) {
        g.tint = 0xffffff;
        continue;
      }
      const u = f.width > 0 ? f.xs[i]! / f.width : 0;
      const c = spectrum(f.hue + f.age * drift + u * 0.75);
      const shine = Math.max(0, 1 - Math.abs(u - sweep) * 4);
      g.tint = shine > 0 ? mix(c, 0xffffff, shine * 0.8) : c;
    }
    f.bloom.tint = spectrum(f.hue + f.age * drift + 0.35);
    f.bloom.alpha = 0.22 * Math.max(0, 1 - f.age / 0.3);
  }

  clear(): void {
    for (const f of this.pool) {
      f.active = false;
      f.holder.visible = false;
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.atlas?.destroy(true);
    this.atlas = null;
    this.glyphMap.clear();
    this.pool.length = 0;
  }
}
