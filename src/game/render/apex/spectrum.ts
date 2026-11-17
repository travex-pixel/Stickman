/**
 * The prismatic palette: six jewel tones, light enough to read on ink and dark enough (with the
 * dark edge every prismatic shape carries) to read on the pale sand regions. No pure primaries,
 * no neon: a refracted gilt, not a disco.
 */
export const SPECTRUM: readonly number[] = [0xff9bb4, 0xffcf7e, 0xd6f29a, 0x8ff0dc, 0x8fc4ff, 0xd3a4ff];

/** Storm blue (Double Strike) and white violet (Triple Strike): the echoes' two colours. */
export const STORM_BLUE = 0x8fc0ff;
export const STORM_VIOLET = 0xd8ccff;
/** The Stormcrown bolt's light: a white with violet in it. */
export const CROWN_LIGHT = 0xeee8ff;

/** The colour `h` of the way round the spectrum (wraps; any real number). */
export function spectrum(h: number): number {
  const n = SPECTRUM.length;
  let f = (h - Math.floor(h)) * n;
  const i = Math.floor(f);
  f -= i;
  const a = SPECTRUM[i % n]!;
  const b = SPECTRUM[(i + 1) % n]!;
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * f) << 16) | (Math.round(ag + (bg - ag) * f) << 8) | Math.round(ab + (bb - ab) * f);
}

/** The spectrum as a list of `n` evenly spaced colours (for one emit's shards), filled into `out`. */
export function spectrumList(n: number, offset: number, out: number[]): number[] {
  out.length = n;
  for (let i = 0; i < n; i++) out[i] = spectrum(offset + i / n);
  return out;
}
