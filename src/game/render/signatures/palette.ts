import type { MasteryTier, SignatureId } from "../../data/signatures";

/**
 * The signature skills' colours. Ink and Gilt: violet and electric blue are used as INK (deep,
 * saturated washes drawn over the scene with a normal blend), the light is white-hot cores and
 * gilt accents (added). No neon gradients, and never the Apex spectrum.
 *
 *  - ink    the darkest wash (cores, pools, smoke): drawn normal-blended.
 *  - deep   a dark, saturated body colour (rings, scales, blades).
 *  - mid    the skill's signature hue at full ink strength.
 *  - glow   the rim light around the signature hue (added, kept low).
 *  - core   the white-hot centre (added).
 *  - accent the second colour that tells the skill apart (crimson eyes, electric cracks, gilt).
 *  - number the colour of its damage figures (light enough to read on every ground).
 */
export interface SigPalette {
  ink: number;
  deep: number;
  mid: number;
  glow: number;
  core: number;
  accent: number;
  number: number;
}

export const GILT = 0xe9c97a;
export const GILT_HOT = 0xfff1c9;
export const GILT_DEEP = 0xcfa95e;
export const CRIMSON = 0xc4453f;
export const ELECTRIC = 0x3f6fd8;
export const VIOLET_INK = 0x5b3f8c;

const BASE: Record<SignatureId, SigPalette> = {
  // A black core in violet-ink rings; white-violet light; a hint of electric blue at the horizon.
  void_collapse: { ink: 0x07060b, deep: 0x1d1430, mid: VIOLET_INK, glow: 0x8f6fd8, core: 0xf3eeff, accent: ELECTRIC, number: 0xd2c4ff },
  // A body of ink scales with a violet rim; crimson eyes and maw.
  abyssal_devourer: { ink: 0x0a0910, deep: 0x1c1830, mid: 0x3a2c5c, glow: 0x6b4fb0, core: 0xffe6df, accent: CRIMSON, number: 0xf2b8b0 },
  // The army's slate and gold, cut with crimson.
  death_parade: { ink: 0x15141a, deep: 0x3d4552, mid: 0x5a6272, glow: GILT, core: 0xffffff, accent: CRIMSON, number: 0xf0c6b8 },
  // Gold hand and sigil over an ink meteor with gold fissures.
  kings_judgement: { ink: 0x100d16, deep: 0x2a2238, mid: 0x6d5a3a, glow: GILT, core: GILT_HOT, accent: GILT_DEEP, number: 0xf3d892 },
  // Ink pools, slate soldiers, gold eyes.
  legion_awakening: { ink: 0x0b0a0f, deep: 0x3d4552, mid: 0x4a5160, glow: GILT, core: GILT_HOT, accent: VIOLET_INK, number: 0xeedba0 },
  // Pale silver clock, electric-blue cracks, glass.
  time_fracture: { ink: 0x10131c, deep: 0x27324a, mid: 0xd8dde8, glow: ELECTRIC, core: 0xffffff, accent: 0x7fb0ff, number: 0xd4e4ff },
  // Violet-ink blades with white edges.
  shadow_storm: { ink: 0x0c0a14, deep: 0x2a2140, mid: 0x4a3a78, glow: 0x7a62c8, core: 0xeee8fa, accent: ELECTRIC, number: 0xdcd2f8 },
  // A deep violet aura under a gold crown.
  sovereign_awakening: { ink: 0x0b0912, deep: 0x2a1d44, mid: 0x4b3478, glow: GILT, core: GILT_HOT, accent: 0x8f6fd8, number: 0xf3d892 },
};

/** Grandmaster: the white-hot light turns to gilt and the rims catch gold. */
export function sigPalette(id: SignatureId, mastery: MasteryTier): SigPalette {
  const p = BASE[id];
  if (mastery < 3) return p;
  return GILDED[id];
}

const GILDED: Record<SignatureId, SigPalette> = (() => {
  const out = {} as Record<SignatureId, SigPalette>;
  for (const id of Object.keys(BASE) as SignatureId[]) {
    const p = BASE[id];
    out[id] = { ...p, core: GILT_HOT, glow: id === "time_fracture" || id === "shadow_storm" || id === "void_collapse" ? p.glow : GILT, number: 0xf3d892 };
  }
  return out;
})();

/** The base palette (the menus' two colours live in the catalogue; this is the renderer's fuller set). */
export function basePalette(id: SignatureId): SigPalette {
  return BASE[id];
}
