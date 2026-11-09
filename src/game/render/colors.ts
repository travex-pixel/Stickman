export const PALETTE = {
  obsidian: 0x07080f,
  charcoal: 0x14161f,
  midnight: 0x0f1630,
  cyan: 0x4ee6ff,
  violet: 0x7b4dff,
  gold: 0xd4b06a,
  crimson: 0xc2314a,
  bone: 0xe8ecf4,
  ember: 0xff7a3d,
  soul: 0x7df0c8,
} as const;

export const RARITY_COLOR: Record<string, number> = {
  common: 0x9aa3b5,
  uncommon: 0x5fd38a,
  rare: 0x4ea8ff,
  epic: 0xb46bff,
  legendary: 0xffc24d,
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
