/**
 * The one gate every full-screen or large-area flash passes through (the screen flash, the
 * Stormcrown bolt's lift of the scene, a rank-up's glow), so photosensitive players are safe at any
 * game speed and any rank:
 *
 *  - at most FLASH_MAX_PER_SECOND flashes start in any one second of real time (a sliding window,
 *    so no second anywhere holds more, however the requests bunch up);
 *  - alpha is capped at FLASH_ALPHA_MAX;
 *  - a saturated red is never flashed: it is pulled toward a warm grey first;
 *  - with reduced effects (the setting or the device's reduced-motion preference) nothing flashes.
 *
 * Pure (no Pixi), so the rules are unit-tested; the renderer keeps one and asks it for every flash.
 * Times are real seconds (the renderer's clock), never the simulation's.
 */
export const FLASH_MAX_PER_SECOND = 3;
export const FLASH_WINDOW = 1;
export const FLASH_ALPHA_MAX = 0.45;
/** Flashes fainter than this are not worth a slot (and are refused). */
export const FLASH_ALPHA_MIN = 0.03;
/** The grey a saturated red is pulled toward, and how far. */
const RED_SAFE = 0xd8cfc4;
const RED_PULL = 0.9;

const LEDGER = 16;

export interface FlashGrant {
  alpha: number;
  color: number;
}

export class FlashBudget {
  reduced = false;
  private readonly at = new Float64Array(LEDGER).fill(-Infinity);
  private head = 0;
  /** Flashes granted and refused since the last reset, and the most that started in any one window. */
  granted = 0;
  refused = 0;
  worstPerWindow = 0;
  /** Reused out record (read it before the next request). */
  private readonly out: FlashGrant = { alpha: 0, color: 0xffffff };

  /** Flashes started in the window ending at `now`. */
  countAt(now: number): number {
    let n = 0;
    for (let i = 0; i < LEDGER; i++) if (now - this.at[i]! < FLASH_WINDOW && now >= this.at[i]!) n++;
    return n;
  }

  /**
   * Ask for a flash of `alpha` in `color` at real time `now`. Returns the grant (its alpha capped
   * and its colour made safe), or null when refused: reduced effects, too faint, or the window is
   * full. A refused flash is simply not shown; the effect still reads through shape and sound.
   */
  request(now: number, alpha: number, color: number): FlashGrant | null {
    if (this.reduced || alpha < FLASH_ALPHA_MIN || this.countAt(now) >= FLASH_MAX_PER_SECOND) {
      this.refused += 1;
      return null;
    }
    this.at[this.head] = now;
    this.head = (this.head + 1) % LEDGER;
    this.granted += 1;
    this.worstPerWindow = Math.max(this.worstPerWindow, this.countAt(now));
    this.out.alpha = Math.min(FLASH_ALPHA_MAX, alpha);
    this.out.color = safeFlashColor(color);
    return this.out;
  }

  /** Whether a flash would be granted now (without taking a slot). */
  wouldGrant(now: number): boolean {
    return !this.reduced && this.countAt(now) < FLASH_MAX_PER_SECOND;
  }

  reset(): void {
    this.at.fill(-Infinity);
    this.head = 0;
  }

  resetStats(): void {
    this.granted = 0;
    this.refused = 0;
    this.worstPerWindow = 0;
  }
}

/** Hue (0 to 360) and saturation (0 to 1, HSL) of a 0xRRGGBB colour. */
export function hueSat(c: number): { hue: number; sat: number; light: number } {
  const r = ((c >> 16) & 255) / 255;
  const g = ((c >> 8) & 255) / 255;
  const b = (c & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  const d = max - min;
  if (d < 1e-6) return { hue: 0, sat: 0, light };
  const sat = d / (1 - Math.abs(2 * light - 1));
  let hue: number;
  if (max === r) hue = 60 * (((g - b) / d) % 6);
  else if (max === g) hue = 60 * ((b - r) / d + 2);
  else hue = 60 * ((r - g) / d + 4);
  if (hue < 0) hue += 360;
  return { hue, sat, light };
}

/** A saturated red (hue within 25 degrees of red, saturation over 0.4) becomes a warm grey; anything else is kept. */
export function safeFlashColor(c: number): number {
  const { hue, sat } = hueSat(c);
  const reddish = hue <= 25 || hue >= 335;
  if (!reddish || sat <= 0.4) return c;
  const ar = (c >> 16) & 255, ag = (c >> 8) & 255, ab = c & 255;
  const br = (RED_SAFE >> 16) & 255, bg = (RED_SAFE >> 8) & 255, bb = RED_SAFE & 255;
  return (Math.round(ar + (br - ar) * RED_PULL) << 16) | (Math.round(ag + (bg - ag) * RED_PULL) << 8) | Math.round(ab + (bb - ab) * RED_PULL);
}
