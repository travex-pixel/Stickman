import type { GameEvent } from "../engine/events";
import type { AbilityId } from "../data/ids";
import type { SfxName } from "./synth";
import type { SfxCategory } from "./mix";

/** One sound to try to play. If the mix budget turns it down, `fallback` is tried instead. */
export interface Cue {
  name: SfxName;
  volume: number;
  rate: number;
  category: SfxCategory;
  /** Minimum ms between two plays of this voice (default 40). */
  minInterval?: number;
  /** A separate limiter key for the same sample. */
  voice?: string;
  fallback?: Cue;
}

/**
 * The seven strikes of Ascendant Fury as notes of D natural minor (semitones above the struck
 * D4 of `fury_strike`); the seventh is always `fury_final`, the low D. Consecutive casts take the
 * next figure, so a fight with the ultimate every few seconds hears a phrase, not one alarm.
 */
export const FURY_FIGURES: readonly (readonly number[])[] = [
  [0, 3, 5, 7, 8, 7],
  [-2, 0, 3, 5, 3, 7],
  [3, 5, 7, 10, 8, 5],
];

/** Semitones to a playback rate. */
export const semitoneRate = (st: number) => Math.pow(2, st / 12);

/** The warrior's whoosh for each swing of his combo: the third (the overhead) is lower and heavier. */
const SWINGS: readonly SfxName[] = ["swing_1", "swing_2", "swing_3"];
const SWING_VOLUME = [0.16, 0.16, 0.22];

/** The Apex rank-up stinger climbs D natural minor, one step per rank (semitones over D5). */
export const APEX_RANK_STEPS: readonly number[] = [0, 2, 3, 5, 7, 8, 10, 12, 14, 15];

/** Real seconds of rest after which the combo starts again from its first swing (as the renderer's). */
export const COMBO_RESET = 0.9;

const CAST_SFX: Partial<Record<AbilityId, SfxName>> = {
  arc_slash: "arc_slash",
  thunder_strike: "thunder",
  soul_burst: "soul_burst",
  void_nova: "void_nova",
  ascendant_fury: "ultimate",
  blade_tempest: "arc_slash",
  chain_hook: "command",
  blood_pact: "soul_burst",
};

export function castSfx(ability: AbilityId): SfxName {
  return CAST_SFX[ability] ?? "dodge";
}

/**
 * The fight's sound rules: what the simulation's events and the warrior's wind-ups sound like.
 * Pure (no audio), so the rules can be measured offline exactly as the game plays them.
 */
export class SoundCues {
  /** Combo swings thrown (the Fury's cuts excluded), as the renderer counts them. */
  swings = 0;
  private rest = 0;
  private figure = -1;

  constructor(private readonly rand: () => number = Math.random) {}

  /** Small rate variation around 1 (a few percent): the same sound, never a wandering pitch. */
  private jitter(pct: number): number {
    return 1 + (this.rand() * 2 - 1) * pct;
  }

  reset(): void {
    this.swings = 0;
    this.rest = 0;
    this.figure = -1;
  }

  /** Called once per frame with the warrior's state, so a rested combo starts over as the renderer's does. */
  observe(attacking: boolean, realDt: number): void {
    if (attacking) this.rest = 0;
    else if ((this.rest += realDt) > COMBO_RESET) this.swings = 0;
  }

  /** The whoosh as the warrior winds up. `variant` (0, 1, 2) is the swing the renderer shows, when known. */
  windup(variant?: number): Cue {
    const v = variant ?? this.swings % 3;
    return { name: SWINGS[v] as SfxName, category: "swing", volume: SWING_VOLUME[v] as number, rate: this.jitter(0.03), minInterval: 110, voice: "swing" };
  }

  /** The sounds of one batch of simulation events. */
  events(events: GameEvent[], playerId: number | undefined): Cue[] {
    const out: Cue[] = [];
    let gold = false;
    // A Fury strike carries its own impact: the hits it lands in the same batch stay quiet.
    const furyBatch = events.some((e) => e.type === "cast" && e.id === playerId && e.ability === "ascendant_fury" && e.strike !== undefined);
    // The swing a basic hit belongs to: the third of the combo lands heavy.
    let swingOfBatch = -1;
    for (const e of events) {
      // Stormcrown's bolt: the crack and, a beat later, the thunder (one sample).
      if ((e as { type: string }).type === "storm_bolt") {
        out.push({ name: "storm_bolt", category: "storm", volume: 0.72, rate: this.jitter(0.015), minInterval: 300, voice: "storm" });
        continue;
      }
      switch (e.type) {
        case "attack_swing":
          if (e.kind === "player" && e.id === playerId) {
            if (e.cut) out.push({ name: "swing_2", category: "swing", volume: 0.1, rate: this.jitter(0.03), minInterval: 110, voice: "swing" });
            else {
              swingOfBatch = this.swings % 3;
              this.swings += 1;
            }
          }
          break;
        case "hit":
          if (e.faction === "enemy" && e.sourceId !== playerId) {
            out.push({ name: "army_hit", category: "army", volume: e.crit ? 0.2 : 0.15, rate: this.jitter(0.03), minInterval: 130 });
          } else if (e.faction === "enemy") {
            if (furyBatch) break;
            const apex = e as { echo?: 1 | 2; prismatic?: boolean };
            if (apex.echo) {
              // An echo blow ticks (the third crackles); over budget it is simply not heard.
              const tick: Cue = { name: apex.echo === 2 ? "echo_tick_3" : "echo_tick", category: "echo", volume: apex.echo === 2 ? 0.26 : 0.22, rate: this.jitter(0.02), minInterval: 70, voice: "echo" };
              out.push(apex.prismatic ? { name: "prism", category: "prism", volume: 0.5, rate: this.jitter(0.01), minInterval: 160, fallback: tick } : tick);
              break;
            }
            const heavy = e.heavy || swingOfBatch === 2;
            const hit: Cue = { name: heavy ? "hit_heavy" : "hit_light", category: "hit", volume: heavy ? 0.5 : 0.42, rate: this.jitter(0.03), minInterval: 55, voice: "hit" };
            // A crit is the hit with a ring on top; when the ring is over budget the hit still lands.
            const crit: Cue = e.crit ? { name: "crit", category: "crit", volume: 0.62, rate: this.jitter(0.02), minInterval: 220, fallback: hit } : hit;
            // A prismatic blow is the glass chord over the hit; over budget, the crit (then the hit).
            out.push(apex.prismatic ? { name: "prism", category: "prism", volume: 0.6, rate: this.jitter(0.01), minInterval: 160, fallback: crit } : crit);
          } else out.push({ name: "hit_heavy", category: "event", volume: 0.5, rate: 0.85, minInterval: 140, voice: "hurt" });
          break;
        case "death":
          if (e.kind === "boss") out.push({ name: "boss_death", category: "event", volume: 1, rate: 1 });
          else if (e.kind === "enemy") out.push({ name: "enemy_death", category: "kill", volume: 0.42, rate: this.jitter(0.03), minInterval: 110 });
          break;
        case "gold":
          gold = true;
          break;
        case "cast":
          if (e.id !== playerId) break;
          if (e.ability === "ascendant_fury" && e.strike !== undefined) out.push(this.furyStrike(e.strike));
          else out.push({ name: castSfx(e.ability), category: "ability", volume: e.ability === "ascendant_fury" ? 0.9 : 0.6, rate: 1, minInterval: 150 });
          break;
        case "fury_end":
          // Cut short (the field was cleared): the figure still comes home.
          if (e.id === playerId && e.early && e.strikes > 0 && e.strikes < 7) out.push(this.furyStrike(7));
          break;
        case "dodge":
          if (e.id === playerId) out.push({ name: "dodge", category: "event", volume: 0.5, rate: this.jitter(0.03) });
          break;
        case "essence_available":
          out.push({ name: "essence_appear", category: "event", volume: 0.8, rate: 1 });
          break;
        case "command":
          out.push({ name: "command", category: "event", volume: 0.6, rate: 1 });
          break;
        case "boss_intro":
          out.push({ name: "boss_intro", category: "event", volume: 1, rate: 1 });
          break;
        case "boss_phase":
          out.push({ name: "void_nova", category: "event", volume: 0.9, rate: 1 });
          break;
        case "tyrant_break":
          out.push({ name: "boss_intro", category: "event", volume: 0.8, rate: 1.3 + Math.min(0.5, e.count * 0.05) });
          break;
        case "player_defeated":
          out.push({ name: "boss_intro", category: "event", volume: 0.6, rate: 1.6 });
          break;
        case "loot":
          out.push({ name: "equip", category: "event", volume: 0.35, rate: 1, minInterval: 120 });
          break;
        case "elite_spawn":
          out.push({ name: "boss_intro", category: "event", volume: 0.35, rate: 1.8, minInterval: 800 });
          break;
        case "perfect_dodge":
          out.push({ name: "crit", category: "event", volume: 0.6, rate: 1, voice: "perfect" });
          break;
        case "kill_streak":
          // A streak steps up the scale (D minor, from A4 to D5 and above), never a slide.
          out.push({ name: "quest", category: "event", volume: 0.45, rate: semitoneRate([-7, -5, -4, -2, 0][Math.min(4, Math.floor(e.count / 5))] as number) });
          break;
        case "finisher":
          out.push(e.boss ? { name: "boss_death", category: "event", volume: 0.6, rate: 0.85 } : { name: "hit_heavy", category: "event", volume: 0.6, rate: 0.85, voice: "finisher" });
          break;
        case "guard_break":
          out.push({ name: "hit_heavy", category: "event", volume: 0.6, rate: 0.8, minInterval: 120, voice: "guard" });
          break;
        case "blocked":
          out.push({ name: "block", category: "event", volume: 0.3, rate: this.jitter(0.03), minInterval: 160 });
          break;
        case "ultimate_ready":
          out.push({ name: "quest", category: "event", volume: 0.45, rate: 0.8 });
          break;
        case "summon_ability":
          out.push({ name: "command", category: "event", volume: 0.3, rate: 0.6, minInterval: 300 });
          break;
        default:
          break;
      }
    }
    if (gold) out.push({ name: "gold", category: "event", volume: 0.3, minInterval: 120, rate: this.jitter(0.03) });
    return out;
  }

  /** The stinger for a bought Apex rank: a step up the scale per rank; a maxed skill or a first rank is the chord. */
  apexRank(big: boolean, rank: number): Cue {
    if (big) return { name: "apex_max", category: "event", volume: 0.75, rate: 1, minInterval: 200, voice: "apex" };
    const st = APEX_RANK_STEPS[Math.max(0, Math.min(APEX_RANK_STEPS.length - 1, rank - 1))]!;
    return { name: "apex_rank", category: "event", volume: 0.55, rate: semitoneRate(st), minInterval: 80, voice: "apex" };
  }

  /** Strike `n` (1 to 7) of the Fury: a note of this cast's figure, the seventh the heavy low D. */
  private furyStrike(n: number): Cue {
    if (n <= 1 || this.figure < 0) this.figure = (this.figure + 1) % FURY_FIGURES.length;
    if (n >= 7) return { name: "fury_final", category: "fury", volume: 0.9, rate: 1, minInterval: 60, voice: "fury_final" };
    const fig = FURY_FIGURES[this.figure] as readonly number[];
    return { name: "fury_strike", category: "fury", volume: 0.42 + 0.03 * n, rate: semitoneRate(fig[n - 1] ?? 0), minInterval: 60 };
  }
}
