/**
 * Hit classes and their stops, in seconds. `local` holds only the two bodies involved (the
 * attacker's and the target's drawn pose and position; the simulation runs on); `global` freezes
 * the whole game loop and is reserved for blows that should stop the world. Light hits sit at
 * 2 frames, medium at 4 to 5, heavy at 6.
 */
export type HitClass = "normal" | "crit" | "heavy" | "kill" | "eliteKill" | "taken" | "takenHeavy" | "army" | "phase";
export const HITSTOP_TABLE: Record<HitClass, { local: number; global: number }> = {
  normal: { local: 0.033, global: 0 },
  crit: { local: 0.08, global: 0.033 },
  heavy: { local: 0.1, global: 0.05 },
  kill: { local: 0.033, global: 0 },
  eliteKill: { local: 0.033, global: 0.05 },
  taken: { local: 0.05, global: 0 },
  takenHeavy: { local: 0.1, global: 0.033 },
  army: { local: 0, global: 0 },
  phase: { local: 0, global: 0.06 },
};
/** At 2x battle speed local stops shorten to 60%. */
export const LOCAL_SPEED_SCALE = 0.6;
/** Reduced motion: local stops at most this long, and no global freeze. */
export const LOCAL_REDUCED_MAX = 0.033;

/**
 * The single hit-stop policy. Every impact the renderer handles goes through `resolve`. Global
 * freezes go through `request`, so a large pack or 2x speed cannot stutter the game: each kind has
 * a cooldown, and the total global freeze in any one second is capped at 12% (120ms). Local holds
 * never stop the world, so they are not capped. Authored freezes from the simulation (a boss
 * kill, a Tyrant break) are `note`d: they always play, but count toward the cap.
 */
export const HITSTOP_CAP_SHARE = 0.12;
export const HITSTOP_WINDOW = 1;

const LEDGER = 64;

export class HitStopPolicy {
  reduced = false;
  private readonly at = new Float64Array(LEDGER);
  private readonly amount = new Float64Array(LEDGER);
  private head = 0;
  private readonly lastByKey = new Map<string, number>();

  /** Out record for `resolve` (reused; read it before the next call). */
  readonly out = { local: 0, global: 0 };

  /**
   * The stops for a hit class at real time `now`: the local hold (not capped; scaled at 2x and
   * clamped under reduced motion) and the global freeze granted by `request` (cooldown by `key`,
   * capped at 12% of any second, none under reduced motion).
   */
  resolve(cls: HitClass, now: number, speed = 1, key = "", cooldown = 0): { local: number; global: number } {
    const row = HITSTOP_TABLE[cls];
    let local = row.local * (speed > 1 ? LOCAL_SPEED_SCALE : 1);
    if (this.reduced) local = Math.min(local, LOCAL_REDUCED_MAX);
    this.out.local = local;
    this.out.global = this.reduced || row.global <= 0 ? 0 : this.request(row.global, now, key || cls, cooldown);
    return this.out;
  }

  /** Global freeze already spent in the window ending at `now` (seconds). */
  spent(now: number): number {
    let sum = 0;
    for (let i = 0; i < LEDGER; i++) {
      const a = this.amount[i]!;
      if (a > 0 && now - this.at[i]! < HITSTOP_WINDOW) sum += a;
    }
    return sum;
  }

  /**
   * Ask for a stop of `seconds` at real time `now`. Returns the seconds granted (0 when refused):
   * a request inside its key's cooldown is refused, and a grant never takes the window over the cap.
   */
  request(seconds: number, now: number, key = "", cooldown = 0): number {
    if (seconds <= 0) return 0;
    if (key && cooldown > 0) {
      const last = this.lastByKey.get(key);
      if (last !== undefined && now - last < cooldown) return 0;
    }
    // Reduced motion: the world never freezes for a hit (local holds stay, capped short).
    if (this.reduced) return 0;
    let s = seconds;
    const room = HITSTOP_CAP_SHARE * HITSTOP_WINDOW - this.spent(now);
    s = Math.min(s, room);
    if (s < 0.008) return 0;
    if (key) this.lastByKey.set(key, now);
    this.record(s, now);
    return s;
  }

  /** An authored freeze that plays regardless; it still uses up the window. */
  note(seconds: number, now: number): void {
    if (seconds > 0) this.record(seconds, now);
  }

  reset(): void {
    this.amount.fill(0);
    this.lastByKey.clear();
  }

  private record(seconds: number, now: number): void {
    this.at[this.head] = now;
    this.amount[this.head] = seconds;
    this.head = (this.head + 1) % LEDGER;
  }
}
