import { BitmapText, Container } from "pixi.js";
import { easeOutCubic } from "../engine/math";

interface Num {
  text: BitmapText;
  life: number;
  total: number;
  vx: number;
  vy: number;
  active: boolean;
  startScale: number;
}

/** Pooled floating numbers using BitmapText so updating text is cheap. */
export class DamageNumbers {
  readonly container = new Container();
  private pool: Num[] = [];

  constructor(size = 28) {
    const family = displayFamily();
    for (let i = 0; i < size; i++) {
      const text = new BitmapText({
        text: "0",
        style: { fontFamily: family, fontSize: 30, fill: 0xffffff, stroke: { color: 0x0b0a08, width: 5, join: "round" }, dropShadow: { color: 0x000000, alpha: 0.45, blur: 0, distance: 2, angle: Math.PI / 2 } },
      });
      text.anchor.set(0.5);
      text.visible = false;
      this.container.addChild(text);
      this.pool.push({ text, life: 0, total: 1, vx: 0, vy: 0, active: false, startScale: 1 });
    }
  }

  spawn(x: number, y: number, value: string, color: number, scale = 1, big = false): void {
    let slot = this.pool.find((n) => !n.active);
    if (!slot) {
      // Recycle the oldest.
      slot = this.pool.reduce((a, b) => (a.life < b.life ? a : b));
    }
    slot.text.text = value;
    slot.text.tint = color;
    slot.text.position.set(x + (Math.random() - 0.5) * 16, y);
    slot.text.alpha = 1;
    slot.total = big ? 1.1 : 0.8;
    slot.life = slot.total;
    slot.vx = (Math.random() - 0.5) * 50;
    slot.vy = big ? -130 : -95;
    slot.startScale = scale;
    slot.text.scale.set(scale * 1.5);
    slot.active = true;
    slot.text.visible = true;
  }

  /** Screen width, so numbers near an edge are nudged back on-screen. */
  viewWidth = 0;

  update(dt: number): void {
    for (const n of this.pool) {
      if (!n.active) continue;
      n.life -= dt;
      if (n.life <= 0) {
        n.active = false;
        n.text.visible = false;
        continue;
      }
      const k = 1 - n.life / n.total;
      n.vy += 220 * dt;
      n.text.x += n.vx * dt;
      n.text.y += n.vy * dt;
      const pop = k < 0.18 ? 1.5 - (k / 0.18) * 0.5 : 1;
      n.text.scale.set(n.startScale * pop);
      if (this.viewWidth > 0) {
        const half = n.text.width / 2 + 4;
        n.text.x = Math.min(this.viewWidth - half, Math.max(half, n.text.x));
      }
      n.text.alpha = k > 0.6 ? 1 - easeOutCubic((k - 0.6) / 0.4) : 1;
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.pool = [];
  }
}

/** The display serif loaded by next/font, resolved from the CSS variable so canvas text matches the UI. */
function displayFamily(): string {
  if (typeof document === "undefined") return "Georgia, serif";
  const v = getComputedStyle(document.documentElement).getPropertyValue("--font-marcellus").trim();
  return v ? `${v}, Georgia, serif` : "Georgia, serif";
}
