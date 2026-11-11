import { BitmapText, Container } from "pixi.js";
import { easeOutBack, easeOutCubic } from "./anim/ease";

/** The static numeral cut (Instrument Sans, width 78, weight 700), shipped under public/fonts. */
export const NUMERAL_FAMILY = "Ascend Numerals";
const NUMERAL_URL = "/fonts/ascend-numerals.woff2";

export type NumberStyle = "normal" | "crit" | "taken" | "heal" | "label";

/** Screen sizes in px (before the camera's zoom, which the pool cancels out). */
const SIZE: Record<NumberStyle, number> = { normal: 30, crit: 44, taken: 26, heal: 26, label: 17 };
/** Glyphs are rasterised once at this size and scaled per style. */
const BASE = 44;
const LABEL_BASE = 24;

interface Num {
  holder: Container;
  text: BitmapText;
  label: BitmapText;
  suffix: BitmapText;
  life: number;
  total: number;
  vx: number;
  vy: number;
  active: boolean;
  size: number;
  style: NumberStyle;
  /** Unscaled width, measured once at spawn. */
  w: number;
}

let numeralFamily = "";

/**
 * Pooled floating numbers using BitmapText so updating text is cheap. Damage is set in the numeral
 * face; words (Perfect, Blocked, ability names) in the interface face. They live in the camera
 * layer, so they stick to the fight, but cancel the zoom to keep their designed screen size.
 */
export class DamageNumbers {
  readonly container = new Container();
  private pool: Num[] = [];
  private minX = -Infinity;
  private maxX = Infinity;
  private zoom = 1;

  /**
   * Load the numeral face before any BitmapText is built (glyphs rasterise on first use). Falls
   * back to the interface family at weight 700 if the file cannot load.
   */
  static async loadFont(): Promise<void> {
    if (typeof document === "undefined") return;
    try {
      if (!numeralFamily && typeof FontFace !== "undefined") {
        const face = new FontFace(NUMERAL_FAMILY, `url(${NUMERAL_URL}) format("woff2")`, { weight: "700", style: "normal", display: "block" });
        const loaded = await Promise.race([face.load(), new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
        if (loaded) {
          document.fonts.add(loaded);
          numeralFamily = NUMERAL_FAMILY;
        }
      }
      await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1200))]);
    } catch {
      /* fonts API unavailable or the file failed: fall back below */
    }
  }

  constructor(size = 32) {
    const ui = uiFamily();
    const num = numeralFamily ? `"${numeralFamily}", ${ui}` : ui;
    const shadow = { color: 0x000000, alpha: 0.55, blur: 0, distance: 2, angle: Math.PI / 2 };
    for (let i = 0; i < size; i++) {
      const holder = new Container();
      const text = new BitmapText({ text: "0", style: { fontFamily: num, fontSize: BASE, fontWeight: "700", fill: 0xffffff, dropShadow: shadow } });
      text.anchor.set(0.5);
      const suffix = new BitmapText({ text: "CRIT", style: { fontFamily: num, fontSize: BASE, fontWeight: "700", fill: 0xffffff, dropShadow: shadow } });
      suffix.anchor.set(0, 0.5);
      suffix.visible = false;
      const label = new BitmapText({ text: "", style: { fontFamily: ui, fontSize: LABEL_BASE, fontWeight: "600", fill: 0xffffff, dropShadow: shadow } });
      label.anchor.set(0.5);
      label.visible = false;
      holder.addChild(text, suffix, label);
      holder.visible = false;
      this.container.addChild(holder);
      this.pool.push({ holder, text, label, suffix, life: 0, total: 1, vx: 0, vy: 0, active: false, size: 1, style: "normal", w: 0 });
    }
  }

  /** The visible horizontal span (base px): numbers near an edge are nudged back into view. */
  setBounds(minX: number, maxX: number): void {
    this.minX = minX;
    this.maxX = maxX;
  }

  /** The camera zoom, cancelled so numbers keep their screen size. */
  setZoom(z: number): void {
    this.zoom = z > 0 ? z : 1;
  }

  spawn(x: number, y: number, value: string, color: number, style: NumberStyle = "normal"): void {
    let slot: Num | null = null;
    for (const n of this.pool) {
      if (!n.active) {
        slot = n;
        break;
      }
    }
    if (!slot) {
      // Recycle the one nearest its end.
      for (const n of this.pool) if (!slot || n.life < slot.life) slot = n;
    }
    if (!slot) return;
    const isLabel = style === "label";
    slot.style = style;
    slot.text.visible = !isLabel;
    slot.label.visible = isLabel;
    slot.suffix.visible = style === "crit" && /^[0-9.,KMBTQaiSxpOcNoD]+$/.test(value);
    if (isLabel) {
      slot.label.text = value;
      slot.label.tint = color;
      slot.size = SIZE.label / LABEL_BASE;
    } else {
      slot.text.text = value;
      slot.text.tint = color;
      slot.size = SIZE[style] / BASE;
    }
    if (slot.suffix.visible) {
      // A small "CRIT" at half size after the number.
      slot.suffix.tint = color;
      slot.suffix.scale.set(0.5);
      slot.suffix.x = slot.text.width / 2 + 3;
      slot.suffix.y = 4;
      slot.text.x = -(slot.suffix.width + 3) / 2;
      slot.suffix.x += slot.text.x;
    } else slot.text.x = 0;
    slot.w = isLabel ? slot.label.width : slot.text.width + (slot.suffix.visible ? slot.suffix.width + 3 : 0);
    slot.holder.position.set(x + (Math.random() - 0.5) * 14, y);
    slot.holder.alpha = 1;
    slot.total = style === "crit" ? 0.95 : isLabel ? 1.0 : 0.72;
    slot.life = slot.total;
    slot.vx = (Math.random() - 0.5) * (style === "crit" ? 30 : 46);
    slot.vy = style === "crit" ? -120 : style === "taken" ? -70 : -90;
    slot.active = true;
    slot.holder.visible = true;
    this.applyScale(slot, 0);
  }

  private applyScale(n: Num, k: number): void {
    // Pop in: crits overshoot from 1.6, the rest settle from 1.25.
    let pop: number;
    if (n.style === "crit") pop = k < 0.22 ? 1.6 - 0.6 * easeOutBack(k / 0.22, 2.2) : 1;
    else pop = k < 0.16 ? 1.25 - 0.25 * easeOutCubic(k / 0.16) : 1;
    n.holder.scale.set((n.size * pop) / this.zoom);
  }

  update(dt: number): void {
    for (const n of this.pool) {
      if (!n.active) continue;
      n.life -= dt;
      if (n.life <= 0) {
        n.active = false;
        n.holder.visible = false;
        continue;
      }
      const k = 1 - n.life / n.total;
      n.vy += 220 * dt;
      n.holder.x += n.vx * dt;
      n.holder.y += n.vy * dt;
      this.applyScale(n, k);
      if (this.maxX > this.minX) {
        const half = (n.w * n.holder.scale.x) / 2 + 4;
        n.holder.x = Math.min(this.maxX - half, Math.max(this.minX + half, n.holder.x));
      }
      n.holder.alpha = k > 0.62 ? 1 - easeOutCubic((k - 0.62) / 0.38) : 1;
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.pool = [];
  }
}

/** The interface sans, resolved from the CSS variables next/font sets, with safe fallbacks. */
function uiFamily(): string {
  if (typeof document === "undefined") return "system-ui, sans-serif";
  const css = getComputedStyle(document.documentElement);
  const names = ["--font-instrument-sans", "--font-manrope", "--font-marcellus"];
  for (const n of names) {
    const v = css.getPropertyValue(n).trim();
    if (v) return `${v}, system-ui, sans-serif`;
  }
  return "system-ui, sans-serif";
}

export function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}
