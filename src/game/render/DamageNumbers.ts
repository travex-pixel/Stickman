import { BitmapText, Container } from "pixi.js";
import { easeOutCubic } from "./anim/ease";

/** The static numeral cut (Instrument Sans, width 78, weight 700), shipped under public/fonts. */
export const NUMERAL_FAMILY = "Ascend Numerals";
const NUMERAL_URL = "/fonts/ascend-numerals.woff2";

/**
 * normal / crit / taken / heal: damage figures in the numeral face. word: a short call-out in the
 * numeral face ("Perfect", "BREAK ×3"). label: words in the interface face (ability names, Blocked).
 */
export type NumberStyle = "normal" | "crit" | "taken" | "heal" | "label" | "word";

/** Screen sizes in px (before the camera's zoom, which the pool cancels out). */
const SIZE: Record<NumberStyle, number> = { normal: 30, crit: 44, taken: 26, heal: 26, label: 17, word: 30 };
/** Glyphs are rasterised once at this size and scaled per style. */
const BASE = 44;
const LABEL_BASE = 24;
/** Every glyph the pool can show, rasterised at mount so no atlas work lands mid-fight. */
const NUMERAL_CHARS = "0123456789.,+-×xKMBTQ ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const LABEL_CHARS = NUMERAL_CHARS + "'’:!?()";
/** Pop on spawn: 1.25 to 1 over 80ms. */
const POP_FROM = 1.25;
const POP_TIME = 0.08;
/** The running total: serif numerals rasterised at this size, shown at TALLY_SIZE screen px. */
const TALLY_BASE = 56;
const TALLY_SIZE = 40;
const TALLY_CHARS = "0123456789.KMBT";
/** Seconds the closed total holds before it fades. */
const TALLY_HOLD = 0.9;
/** Numbers that land together within this long stack upward instead of overlapping. */
const STACK_WINDOW = 0.22;

interface Num {
  holder: Container;
  text: BitmapText;
  label: BitmapText;
  suffix: BitmapText;
  life: number;
  total: number;
  age: number;
  vx: number;
  vy: number;
  gravity: number;
  active: boolean;
  size: number;
  style: NumberStyle;
  /** Unscaled width and height, from the cached glyph advances. */
  w: number;
  h: number;
  /** Side it drifts toward (away from the attacker), and whether it must keep clear of the avoid box. */
  dir: number;
  avoid: boolean;
}

interface Recent {
  t: number;
  x: number;
  y: number;
  n: number;
}

let numeralFamily = "";

/**
 * Pooled floating numbers. Damage is set beside the target on the side away from the attacker:
 * it pops (1.25 to 1 in 80ms), then drifts up and out. Numbers that land together stack, and none
 * may sit over the warrior (the renderer hands in the warrior's box each frame). Words use the
 * numeral face for call-outs and the interface face for labels. They live in the camera layer, so
 * they stick to the fight, but cancel the zoom to keep their designed screen size.
 *
 * Widths come from glyph advances measured once at mount, so spawning never asks Pixi to lay out
 * text; the glyph atlases are filled at mount for the same reason.
 */
export class DamageNumbers {
  readonly container = new Container();
  private pool: Num[] = [];
  private minX = -Infinity;
  private maxX = Infinity;
  private zoom = 1;
  private now = 0;
  private readonly recent: Recent[] = [];
  private readonly numAdv = new Map<string, number>();
  private readonly labelAdv = new Map<string, number>();
  private numH = BASE;
  private labelH = LABEL_BASE;
  /** The warrior's box in base px; numbers are kept out of it. */
  private readonly avoidBox = { minX: 0, minY: 0, maxX: 0, maxY: 0, on: false };
  /**
   * One running total in the serif numeral face (the Ascendant Fury's damage): it counts up toward
   * its value, pops on each addition, pops large when closed, then fades.
   */
  private readonly tallyHolder = new Container();
  private tallyText!: BitmapText;
  private readonly tallyState = { on: false, value: 0, shown: -1, age: 1, closed: false, fade: 0, color: 0xe9c97a };

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
    const numStyle = { fontFamily: num, fontSize: BASE, fontWeight: "700" as const, fill: 0xffffff, dropShadow: shadow };
    const labelStyle = { fontFamily: ui, fontSize: LABEL_BASE, fontWeight: "600" as const, fill: 0xffffff, dropShadow: shadow };
    for (let i = 0; i < size; i++) {
      const holder = new Container();
      const text = new BitmapText({ text: "0", style: numStyle });
      text.anchor.set(0.5);
      const suffix = new BitmapText({ text: "CRIT", style: numStyle });
      suffix.anchor.set(0, 0.5);
      suffix.visible = false;
      const label = new BitmapText({ text: "", style: labelStyle });
      label.anchor.set(0.5);
      label.visible = false;
      holder.addChild(text, suffix, label);
      holder.visible = false;
      this.container.addChild(holder);
      this.pool.push({ holder, text, label, suffix, life: 0, total: 1, age: 0, vx: 0, vy: 0, gravity: 0, active: false, size: 1, style: "normal", w: 0, h: 0, dir: 1, avoid: false });
    }
    this.prewarm(numStyle, labelStyle);
    const serif = serifFamily();
    const tallyStyle = { fontFamily: serif, fontSize: TALLY_BASE, fontWeight: "400" as const, fill: 0xffffff, dropShadow: { ...shadow, alpha: 0.7, distance: 3 } };
    this.tallyText = new BitmapText({ text: TALLY_CHARS, style: tallyStyle });
    // Reading the size lays it out, which rasterises the glyphs now rather than mid-fight.
    void this.tallyText.width;
    this.tallyText.anchor.set(0.5);
    this.tallyText.text = "0";
    this.tallyHolder.addChild(this.tallyText);
    this.tallyHolder.visible = false;
    this.container.addChild(this.tallyHolder);
  }

  /** Add to the running total (opening it when closed), popping it. */
  tallyAdd(amount: number, color: number): void {
    const t = this.tallyState;
    if (!t.on || t.closed) {
      t.on = true;
      t.closed = false;
      t.value = 0;
      t.shown = 0;
      t.fade = 0;
    }
    t.value += amount;
    t.color = color;
    t.age = 0;
    this.tallyHolder.visible = true;
  }

  /** Close the total: it lands on its value with a large pop, holds, then fades. */
  tallyClose(): void {
    const t = this.tallyState;
    if (!t.on || t.closed) return;
    t.closed = true;
    t.shown = t.value;
    t.age = 0;
    t.fade = 0;
  }

  /** Base-px position of the total (the renderer keeps it at the top middle of the view). */
  placeTally(x: number, y: number): void {
    this.tallyHolder.position.set(x, y);
  }

  /** Drop the total at once (the flurry was cut short: a new world, a detach). */
  tallyReset(): void {
    this.tallyState.on = false;
    this.tallyState.closed = false;
    this.tallyHolder.visible = false;
  }

  get tallyOn(): boolean {
    return this.tallyState.on;
  }

  private updateTally(dt: number): void {
    const t = this.tallyState;
    if (!t.on) return;
    t.age += dt;
    // Count up toward the value rather than jump to it.
    if (t.shown < t.value) t.shown = Math.min(t.value, t.shown + Math.max(1, (t.value - t.shown) * Math.min(1, dt * 18)));
    const text = fmtNum(t.shown);
    if (this.tallyText.text !== text) this.tallyText.text = text;
    const popFrom = t.closed ? 1.6 : 1.18;
    const popTime = t.closed ? 0.22 : POP_TIME;
    const pop = t.age < popTime ? popFrom - (popFrom - 1) * easeOutCubic(t.age / popTime) : 1;
    const size = (t.closed ? TALLY_SIZE * 1.2 : TALLY_SIZE) / TALLY_BASE;
    this.tallyHolder.scale.set((size * pop) / this.zoom);
    this.tallyText.tint = t.closed && t.age < 0.06 ? 0xffffff : t.color;
    if (t.closed) {
      // Hold, then fade over 0.4s.
      if (t.age > TALLY_HOLD) t.fade = Math.min(1, (t.age - TALLY_HOLD) / 0.4);
      this.tallyHolder.alpha = 1 - easeOutCubic(t.fade);
      if (t.fade >= 1) {
        t.on = false;
        this.tallyHolder.visible = false;
      }
    } else this.tallyHolder.alpha = 1;
  }

  /** Fill both glyph atlases and measure every glyph once (mount time, never mid-fight). */
  private prewarm(numStyle: object, labelStyle: object): void {
    const probe = new BitmapText({ text: NUMERAL_CHARS, style: numStyle });
    const lprobe = new BitmapText({ text: LABEL_CHARS, style: labelStyle });
    try {
      // Reading the size lays the text out, which rasterises the glyphs into the atlas.
      void probe.width;
      void lprobe.width;
      for (const ch of NUMERAL_CHARS) {
        probe.text = ch;
        this.numAdv.set(ch, probe.width);
      }
      probe.text = "0";
      this.numH = probe.height || BASE;
      for (const ch of LABEL_CHARS) {
        lprobe.text = ch;
        this.labelAdv.set(ch, lprobe.width);
      }
      lprobe.text = "A";
      this.labelH = lprobe.height || LABEL_BASE;
    } finally {
      probe.destroy();
      lprobe.destroy();
    }
  }

  private measure(s: string, label: boolean): number {
    const adv = label ? this.labelAdv : this.numAdv;
    const fallback = label ? LABEL_BASE * 0.55 : BASE * 0.6;
    let w = 0;
    for (let i = 0; i < s.length; i++) w += adv.get(s[i]!) ?? fallback;
    return w;
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

  /** The warrior's drawn box (base px). Numbers never sit over it. */
  setAvoid(minX: number, minY: number, maxX: number, maxY: number): void {
    const a = this.avoidBox;
    a.minX = minX;
    a.minY = minY;
    a.maxX = maxX;
    a.maxY = maxY;
    a.on = maxX > minX;
  }

  /**
   * A damage figure beside a target. (x, y) is the target's chest, `halfW` half its drawn width,
   * `dir` the side away from the attacker (+1 right, -1 left). `avoid` keeps it off the warrior.
   * `life` (real seconds) shortens it, for a quick run of blows like the Ascendant Fury's.
   */
  hit(x: number, y: number, halfW: number, dir: number, value: string, color: number, style: NumberStyle, avoid = true, life?: number): void {
    const n = this.take();
    if (!n) return;
    this.fill(n, value, color, style);
    if (life !== undefined) {
      n.total = life;
      n.life = life;
    }
    const d = dir >= 0 ? 1 : -1;
    const scale = n.size / this.zoom;
    const half = (n.w * scale) / 2;
    const px = x + d * (halfW + half + 4 / this.zoom);
    let py = y - (n.h * scale) * 0.2;
    // Stack: a number landing beside another one just placed there sits a line above it.
    const line = n.h * scale * 0.82;
    let k = 0;
    for (const r of this.recent) {
      if (this.now - r.t > STACK_WINDOW) continue;
      if (Math.abs(r.x - px) < half * 2 + 6 && Math.abs(r.y - py) < line * (r.n + 1)) k = Math.max(k, r.n + 1);
    }
    py -= k * line;
    this.remember(px, py, k);
    n.dir = d;
    n.avoid = avoid;
    n.vx = d * (style === "crit" ? 34 : 26);
    n.vy = style === "crit" ? -58 : style === "taken" ? -40 : -50;
    n.gravity = 30;
    this.place(n, px, py);
  }

  /** A free-floating figure or word at (x, y), rising (heals, labels, call-outs). */
  spawn(x: number, y: number, value: string, color: number, style: NumberStyle = "normal"): void {
    const n = this.take();
    if (!n) return;
    this.fill(n, value, color, style);
    n.dir = 0;
    n.avoid = style !== "taken";
    n.vx = 0;
    n.vy = style === "word" ? -36 : style === "label" ? -40 : -60;
    n.gravity = style === "word" ? 0 : 40;
    this.place(n, x, y);
  }

  private take(): Num | null {
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
    return slot;
  }

  private fill(slot: Num, value: string, color: number, style: NumberStyle): void {
    const isLabel = style === "label";
    slot.style = style;
    slot.text.visible = !isLabel;
    slot.label.visible = isLabel;
    slot.suffix.visible = style === "crit" && isFigure(value);
    if (isLabel) {
      slot.label.text = value;
      slot.label.tint = color;
      slot.size = SIZE.label / LABEL_BASE;
      slot.w = this.measure(value, true);
      slot.h = this.labelH;
    } else {
      slot.text.text = value;
      slot.text.tint = color;
      slot.size = SIZE[style] / BASE;
      slot.w = this.measure(value, false);
      slot.h = this.numH;
    }
    if (slot.suffix.visible) {
      // A small "CRIT" at half size after the number.
      const sw = this.measure("CRIT", false) * 0.5;
      slot.suffix.tint = color;
      slot.suffix.scale.set(0.5);
      slot.text.x = -(sw + 3) / 2;
      slot.suffix.x = slot.text.x + slot.w / 2 + 3;
      slot.suffix.y = 4;
      slot.w += sw + 3;
    } else slot.text.x = 0;
    slot.total = style === "crit" ? 0.95 : style === "word" ? 1.0 : isLabel ? 1.0 : 0.72;
    slot.life = slot.total;
    slot.age = 0;
  }

  private place(n: Num, x: number, y: number): void {
    n.holder.position.set(x, y);
    n.holder.alpha = 1;
    n.active = true;
    n.holder.visible = true;
    this.applyScale(n);
    this.keepClear(n);
  }

  private remember(x: number, y: number, k: number): void {
    if (this.recent.length < 12) {
      this.recent.push({ t: this.now, x, y, n: k });
      return;
    }
    let oldest = this.recent[0]!;
    for (const r of this.recent) if (r.t < oldest.t) oldest = r;
    oldest.t = this.now;
    oldest.x = x;
    oldest.y = y;
    oldest.n = k;
  }

  private applyScale(n: Num): void {
    const pop = n.age < POP_TIME ? POP_FROM - (POP_FROM - 1) * easeOutCubic(n.age / POP_TIME) : 1;
    n.holder.scale.set((n.size * pop) / this.zoom);
  }

  /** Push a number out of the warrior's box along its drift side (or upward when it has none). */
  private keepClear(n: Num): void {
    const a = this.avoidBox;
    if (!n.avoid || !a.on) return;
    const s = n.holder.scale.x;
    const hw = (n.w * s) / 2 + 3;
    const hh = (n.h * s) / 2;
    const x = n.holder.x;
    const y = n.holder.y;
    if (x + hw < a.minX || x - hw > a.maxX || y + hh < a.minY || y - hh > a.maxY) return;
    if (n.dir > 0) n.holder.x = a.maxX + hw;
    else if (n.dir < 0) n.holder.x = a.minX - hw;
    else n.holder.y = a.minY - hh;
  }

  update(dt: number): void {
    this.now += dt;
    this.updateTally(dt);
    for (const n of this.pool) {
      if (!n.active) continue;
      n.life -= dt;
      n.age += dt;
      if (n.life <= 0) {
        n.active = false;
        n.holder.visible = false;
        continue;
      }
      const k = 1 - n.life / n.total;
      // The pop holds the number in place; then it drifts up and out.
      if (n.age > POP_TIME) {
        n.vy += n.gravity * dt;
        n.holder.x += (n.vx * dt) / this.zoom;
        n.holder.y += (n.vy * dt) / this.zoom;
      }
      this.applyScale(n);
      if (this.maxX > this.minX) {
        const half = (n.w * n.holder.scale.x) / 2 + 4;
        n.holder.x = Math.min(this.maxX - half, Math.max(this.minX + half, n.holder.x));
      }
      this.keepClear(n);
      n.holder.alpha = k > 0.6 ? 1 - easeOutCubic((k - 0.6) / 0.4) : 1;
    }
  }

  clear(): void {
    this.tallyState.on = false;
    this.tallyHolder.visible = false;
    for (const n of this.pool) {
      n.active = false;
      n.holder.visible = false;
    }
    this.recent.length = 0;
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.pool = [];
  }
}

function isFigure(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (!((c >= 48 && c <= 57) || c === 46 || c === 44 || c === 75 || c === 77 || c === 66)) return false;
  }
  return s.length > 0;
}

/** The display serif (the big numbers of the interface), resolved like the sans below. */
function serifFamily(): string {
  if (typeof document === "undefined") return "Georgia, serif";
  const v = getComputedStyle(document.documentElement).getPropertyValue("--font-instrument-serif").trim();
  return v ? `${v}, Georgia, serif` : "Georgia, serif";
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
