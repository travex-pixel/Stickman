/**
 * The mix's density budget. Every sound belongs to a category; a category may start only so many
 * voices in a sliding window of real time, so a fight at 2x speed with an army thins out instead
 * of smearing into a wall. The warrior's own hits always win: the army's blows give way to them.
 */
export type SfxCategory = "swing" | "hit" | "crit" | "army" | "kill" | "ability" | "fury" | "event" | "ui" | "echo" | "prism" | "storm";

export interface Budget {
  /** Voices the category may start in any `windowMs` of real time. */
  max: number;
  windowMs: number;
}

/** Budgets per category (normal and reduced effects). Categories not listed are only rate-limited per voice. */
export const BUDGETS: Partial<Record<SfxCategory, Budget>> = {
  swing: { max: 3, windowMs: 600 },
  hit: { max: 4, windowMs: 400 },
  crit: { max: 2, windowMs: 700 },
  army: { max: 2, windowMs: 500 },
  kill: { max: 3, windowMs: 700 },
  // Apex: echo blows can come ten a second; two in any 450ms keep the rhythm and drop the rest.
  echo: { max: 2, windowMs: 450 },
  prism: { max: 2, windowMs: 900 },
  storm: { max: 1, windowMs: 700 },
};

export const REDUCED_BUDGETS: Partial<Record<SfxCategory, Budget>> = {
  swing: { max: 2, windowMs: 600 },
  hit: { max: 3, windowMs: 400 },
  crit: { max: 1, windowMs: 700 },
  army: { max: 1, windowMs: 700 },
  kill: { max: 2, windowMs: 700 },
  echo: { max: 1, windowMs: 600 },
  prism: { max: 1, windowMs: 1000 },
  storm: { max: 1, windowMs: 1000 },
};

/** The army is silent this long after one of the warrior's blows (ms), and counts against his impacts. */
export const ARMY_YIELD_MS = 90;
/** Impacts of every kind (the warrior's hits and crits and the army's) in one window. */
export const IMPACT_BUDGET: Budget = { max: 5, windowMs: 400 };

export interface GateRequest {
  /** Per-voice limiter key (the sound's name unless a separate voice is named). */
  key: string;
  category: SfxCategory;
  /** Minimum ms between two plays of this key. */
  minInterval: number;
}

export class MixGate {
  private lastByKey = new Map<string, number>();
  private starts = new Map<SfxCategory, number[]>();
  private reduced = false;

  setReduced(v: boolean): void {
    this.reduced = v;
  }

  /** Voices of `cat` started in the window ending at `now`. */
  count(cat: SfxCategory, now: number, windowMs: number): number {
    const list = this.starts.get(cat);
    if (!list) return 0;
    let n = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      if (now - (list[i] as number) >= windowMs) break;
      n++;
    }
    return n;
  }

  private lastOf(cat: SfxCategory): number {
    const list = this.starts.get(cat);
    return list && list.length ? (list[list.length - 1] as number) : -Infinity;
  }

  /** Whether a voice may start now; if so it is counted. `now` is in ms of real time. */
  admit(req: GateRequest, now: number): boolean {
    const last = this.lastByKey.get(req.key) ?? -Infinity;
    if (now - last < req.minInterval) return false;
    const budget = (this.reduced ? REDUCED_BUDGETS : BUDGETS)[req.category];
    if (budget && this.count(req.category, now, budget.windowMs) >= budget.max) return false;
    if (req.category === "army") {
      if (now - Math.max(this.lastOf("hit"), this.lastOf("crit"), this.lastOf("prism")) < ARMY_YIELD_MS) return false;
      const w = IMPACT_BUDGET.windowMs;
      const impacts = this.count("hit", now, w) + this.count("crit", now, w) + this.count("army", now, w) + this.count("echo", now, w) + this.count("prism", now, w);
      if (impacts >= IMPACT_BUDGET.max) return false;
    }
    this.lastByKey.set(req.key, now);
    const list = this.starts.get(req.category) ?? [];
    list.push(now);
    // Keep only what any window can still see.
    while (list.length > 16) list.shift();
    this.starts.set(req.category, list);
    return true;
  }

  reset(): void {
    this.lastByKey.clear();
    this.starts.clear();
  }
}
