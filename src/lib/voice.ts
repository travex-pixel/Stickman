/**
 * The game's vocabulary: a bound enemy is a shadow, all of them are the Oathbound, the deployed
 * ones are the army, the act is BIND. A few lines of copy that arrive from the simulation side
 * (toasts, tutorial labels) still use older words; they are corrected here, at display time,
 * until they are fixed at their source.
 */
const REWRITES: [RegExp, string][] = [
  [/\bOpen your Summons\b/g, "Open your Army"],
  [/\bcompanions\b/g, "shadows"],
  [/\bcompanion\b/g, "shadow"],
  [/\bSummons\b/g, "Army"],
];

export function voice(text: string): string {
  let out = text;
  for (const [re, to] of REWRITES) out = out.replace(re, to);
  return out;
}
