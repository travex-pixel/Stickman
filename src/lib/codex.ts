import { STAT_LABEL } from "@/game/data/equipment";
import type { SummonDef } from "@/game/data/summons";

/** A shadow's Codex bonus in words ("6% Attack"), scaled by its stars. */
export function fmtCodex(o: SummonDef["owned"], mult = 1): string {
  const pct = o.pct * mult * 100;
  return `${pct < 10 && pct % 1 !== 0 ? pct.toFixed(1) : Math.round(pct)}% ${STAT_LABEL[o.stat]}`;
}
