const SUFFIXES = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];

/** Compact numbers for a phone screen: 1234 -> 1.23K, 5390000 -> 5.39M. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs < 1000) return Math.round(n).toString();
  // Past the named suffixes, scientific notation keeps it short: 1.23e36.
  if (abs >= 1e36) return `${n < 0 ? "-" : ""}${abs.toExponential(2).replace("+", "")}`;
  let idx = 0;
  let v = abs;
  while (v >= 1000 && idx < SUFFIXES.length - 1) {
    v /= 1000;
    idx += 1;
  }
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${n < 0 ? "-" : ""}${v.toFixed(digits)}${SUFFIXES[idx]}`;
}

export function pct(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtStat(stat: string, v: number): string {
  switch (stat) {
    case "critChance":
      return pct(v, 1);
    case "critDamage":
      return `${Math.round(v * 100)}%`;
    case "attackSpeed":
      return v.toFixed(2);
    default:
      return fmt(Math.round(v * 10) / 10);
  }
}

export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
