/** FX palette. Mirrors the CSS tokens in globals.css so canvas and UI feel like one piece. */
export const PALETTE = {
  ink: 0x0d1016,
  ivory: 0xf0eadc,
  gold: 0xe9c97a,
  goldDeep: 0xcfa95e,
  jade: 0x8fe0c4,
  steel: 0xa8c4e6,
  crimson: 0xd95a66,
  ember: 0xd9823f,
} as const;

export const RARITY_COLOR: Record<string, number> = {
  common: 0xa8a295,
  uncommon: 0x6cc49a,
  rare: 0x7aa6e0,
  epic: 0xb595e6,
  legendary: 0xe9c56f,
};

export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t), g = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

export function darken(c: number, amount: number): number {
  return mix(c, 0x000000, amount);
}

export function lighten(c: number, amount: number): number {
  return mix(c, 0xffffff, amount);
}
