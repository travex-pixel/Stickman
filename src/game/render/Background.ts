import { Container, Graphics, Sprite } from "pixi.js";
import type { RegionDef } from "../data/regions";
import { darken, lighten, mix } from "./colors";
import { softCircle } from "./textures";

/**
 * Layered battlefield: gradient sky, distant and near ruin silhouettes, drifting fog,
 * a perspective ground with cracks and rune-light, floating embers and a vignette.
 */
export class Background {
  readonly container = new Container();
  readonly foreground = new Container();
  private sky = new Graphics();
  private far = new Graphics();
  private mid = new Graphics();
  private ground = new Graphics();
  private fogLayers: Sprite[] = [];
  private embers: { s: Sprite; vx: number; vy: number; life: number; total: number }[] = [];
  private vignette = new Graphics();
  private width = 0;
  private height = 0;
  private groundTop = 0;
  private time = 0;
  private region: RegionDef;
  private reduced = false;

  constructor(region: RegionDef) {
    this.region = region;
    this.container.addChild(this.sky, this.far, this.mid, this.ground);
    for (let i = 0; i < 5; i++) {
      const s = new Sprite(softCircle());
      s.anchor.set(0.5);
      s.alpha = 0.16;
      this.fogLayers.push(s);
      this.container.addChild(s);
    }
    this.foreground.addChild(this.vignette);
  }

  setReduced(v: boolean): void {
    this.reduced = v;
  }

  layout(width: number, height: number, groundTop: number): void {
    this.width = width;
    this.height = height;
    this.groundTop = groundTop;
    const pal = this.region.palette;
    this.sky.clear();
    const strips = 18;
    for (let i = 0; i < strips; i++) {
      const t = i / (strips - 1);
      const c = mix(pal.sky, pal.horizon, Math.pow(t, 1.6));
      this.sky.rect(0, (groundTop * i) / strips, width, groundTop / strips + 1).fill(c);
    }
    // A pale fracture in the sky: the Rift itself.
    const rx = width * 0.68;
    this.sky.moveTo(rx, 0).lineTo(rx - width * 0.03, groundTop * 0.3).lineTo(rx + width * 0.02, groundTop * 0.55).stroke({ width: 2, color: 0x7cf6ff, alpha: 0.25 });
    this.sky.moveTo(rx, 0).lineTo(rx - width * 0.03, groundTop * 0.3).lineTo(rx + width * 0.02, groundTop * 0.55).stroke({ width: 8, color: 0x4ee6ff, alpha: 0.06 });

    // Far ruins
    this.far.clear();
    const farColor = mix(pal.horizon, 0x000000, 0.35);
    const towers = 9;
    for (let i = 0; i <= towers; i++) {
      const x = (width / towers) * i + Math.sin(i * 12.9) * 20;
      const h = groundTop * (0.25 + 0.35 * Math.abs(Math.sin(i * 3.7 + 1)));
      const w = 26 + 30 * Math.abs(Math.cos(i * 2.3));
      this.far.rect(x - w / 2, groundTop - h, w, h).fill({ color: farColor, alpha: 0.9 });
      if (i % 2 === 0) this.far.poly([x - w / 2, groundTop - h, x + w / 2, groundTop - h, x, groundTop - h - w * 0.5]).fill({ color: farColor, alpha: 0.9 });
      if (i % 3 === 1) this.far.rect(x - 3, groundTop - h * 0.6, 6, 9).fill({ color: pal.ember, alpha: 0.35 });
    }
    // Mid ruins: broken arches and pillars
    this.mid.clear();
    const midColor = mix(pal.ground, 0x000000, 0.2);
    for (let i = 0; i < 6; i++) {
      const x = width * (0.05 + i * 0.19) + Math.sin(i * 5.1) * 25;
      const h = groundTop * (0.18 + 0.22 * Math.abs(Math.sin(i * 1.9 + 2)));
      this.mid.rect(x, groundTop - h, 14, h).fill(midColor);
      if (i % 2 === 0) {
        this.mid.rect(x + 14, groundTop - h, 50, 10).fill(midColor);
        this.mid.rect(x + 50, groundTop - h * 0.7, 14, h * 0.7).fill(midColor);
      }
      this.mid.rect(x - 6, groundTop - 6, 26, 6).fill(midColor);
    }

    // Ground with perspective bands and cracks
    this.ground.clear();
    const bands = 10;
    for (let i = 0; i < bands; i++) {
      const t = i / bands;
      const y0 = groundTop + (height - groundTop) * t;
      const y1 = groundTop + (height - groundTop) * ((i + 1) / bands) + 1;
      this.ground.rect(0, y0, width, y1 - y0).fill(mix(darken(pal.ground, 0.3), lighten(pal.ground, 0.14), t));
    }
    // horizon glow line
    this.ground.rect(0, groundTop - 1, width, 2).fill({ color: lighten(pal.horizon, 0.3), alpha: 0.35 });
    // flagstones
    for (let r = 0; r < 6; r++) {
      const t = (r + 0.5) / 6;
      const y = groundTop + (height - groundTop) * t;
      this.ground.moveTo(0, y).lineTo(width, y).stroke({ width: 1, color: 0x000000, alpha: 0.28 });
      const cols = 5 + r;
      for (let c = 0; c <= cols; c++) {
        const x = (width / cols) * c + ((r % 2) * width) / cols / 2;
        this.ground.moveTo(x, y).lineTo(x + (x - width / 2) * 0.05, y + (height - groundTop) / 6).stroke({ width: 1, color: 0x000000, alpha: 0.12 });
      }
    }
    // cracks with rift light
    for (let i = 0; i < 4; i++) {
      const x = width * (0.12 + i * 0.24);
      const y = groundTop + (height - groundTop) * (0.3 + 0.5 * Math.abs(Math.sin(i * 7)));
      this.ground.moveTo(x, y).lineTo(x + 18, y + 9).lineTo(x + 10, y + 22).lineTo(x + 34, y + 30).stroke({ width: 2, color: pal.ember, alpha: 0.22 });
      this.ground.moveTo(x, y).lineTo(x + 18, y + 9).lineTo(x + 10, y + 22).lineTo(x + 34, y + 30).stroke({ width: 1, color: lighten(pal.ember, 0.4), alpha: 0.35 });
    }

    // Fog
    this.fogLayers.forEach((s, i) => {
      s.width = width * (0.7 + i * 0.12);
      s.height = (height - groundTop) * 0.55;
      s.tint = lighten(pal.fog, 0.1);
      s.y = groundTop + 10 + i * 6;
      s.x = (width / 5) * i;
    });

    // Vignette
    this.vignette.clear();
    const vSteps = 6;
    for (let i = 0; i < vSteps; i++) {
      const a = 0.05 + i * 0.05;
      const inset = i * 8;
      this.vignette.rect(0, 0, width, 14 + inset).fill({ color: 0x000000, alpha: a * 0.5 });
      this.vignette.rect(0, 0, 10 + inset, height).fill({ color: 0x000000, alpha: a * 0.6 });
      this.vignette.rect(width - 10 - inset, 0, 10 + inset, height).fill({ color: 0x000000, alpha: a * 0.6 });
    }
    this.vignette.rect(0, height - 26, width, 26).fill({ color: 0x000000, alpha: 0.35 });
  }

  update(dt: number): void {
    this.time += dt;
    this.fogLayers.forEach((s, i) => {
      s.x += (8 + i * 4) * dt * (i % 2 === 0 ? 1 : -1);
      if (s.x > this.width + s.width / 2) s.x = -s.width / 2;
      if (s.x < -s.width / 2) s.x = this.width + s.width / 2;
      s.alpha = 0.12 + Math.sin(this.time * 0.3 + i) * 0.04;
    });
    if (this.reduced) return;
    // Embers drifting upward
    if (this.embers.length < 26 && Math.random() < dt * 8) {
      const s = new Sprite(softCircle());
      s.anchor.set(0.5);
      s.tint = Math.random() < 0.7 ? this.region.palette.ember : 0x7cf6ff;
      s.blendMode = "add";
      s.x = Math.random() * this.width;
      s.y = this.groundTop + Math.random() * (this.height - this.groundTop);
      const sc = 0.04 + Math.random() * 0.08;
      s.scale.set(sc);
      this.container.addChild(s);
      this.embers.push({ s, vx: (Math.random() - 0.5) * 12, vy: -(10 + Math.random() * 22), life: 0, total: 3 + Math.random() * 3 });
    }
    for (let i = this.embers.length - 1; i >= 0; i--) {
      const e = this.embers[i]!;
      e.life += dt;
      e.s.x += (e.vx + Math.sin(this.time * 2 + i) * 6) * dt;
      e.s.y += e.vy * dt;
      const k = e.life / e.total;
      e.s.alpha = Math.sin(k * Math.PI) * 0.8;
      if (e.life >= e.total) {
        e.s.destroy();
        this.embers.splice(i, 1);
      }
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.foreground.destroy({ children: true });
  }
}
