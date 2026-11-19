import type { GameEvent } from "../engine/events";
import type { AbilityId } from "../data/ids";
import type { SignatureBeat, SynergyId } from "../data/signatures";
import type { SfxName } from "./synth";
import type { SfxCategory } from "./mix";
import type { MechanicStep, SovereignMechanic } from "../data/sovereigns";

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
    this.guarding.clear();
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

  /** Sovereigns whose mirror stands (a blow on them rings off it), and whether a dodge broke it. */
  private readonly guarding = new Map<number, { guarded: number; broken: boolean }>();

  /**
   * The sounds of one batch of simulation events. `isAlly` tells a Sovereign's shadow from the
   * Sovereign (its mechanics sound the same, softer).
   */
  events(events: GameEvent[], playerId: number | undefined, isAlly?: (id: number) => boolean): Cue[] {
    const out: Cue[] = [];
    let gold = false;
    // A Fury strike carries its own impact: the hits it lands in the same batch stay quiet.
    const furyBatch = events.some((e) => e.type === "cast" && e.id === playerId && e.ability === "ascendant_fury" && e.strike !== undefined);
    // The swing a basic hit belongs to: the third of the combo lands heavy.
    let swingOfBatch = -1;
    // Stormcrown's bolt carries its own crack: the hits it lands after it in the batch stay quiet.
    let afterBolt = false;
    for (const e of events) {
      switch (e.type) {
        case "sig_beat": {
          const c = sigBeatCue(e.beat);
          if (c) out.push(c);
          break;
        }
        case "sig_synergy":
          out.push(sigSynergyCue(e.synergy));
          break;
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
          // A blow on a body behind a standing mirror rings off the glass (under the hit itself).
          if (e.amount > 0 && this.guarding.size > 0) {
            for (const g of this.guarding.values()) {
              if (g.guarded === e.targetId && e.sourceId !== e.targetId) {
                out.push({ name: "sov_reflect", category: "sov", volume: 0.38, rate: 1, minInterval: 150, voice: "sov_reflect" });
                break;
              }
            }
          }
          if (e.sig && e.faction === "enemy") {
            // A signature skill's blows sit under its moments: a quiet tick, budgeted, never the
            // warrior's hit on top (a dragon's pass would otherwise be a wall of impacts).
            out.push({ name: "sig_hit", category: "sig_hit", volume: e.heavy ? 0.32 : 0.24, rate: this.jitter(0.02), minInterval: 60, voice: "sig_hit" });
            break;
          }
          if (e.faction === "enemy" && e.sourceId !== playerId) {
            out.push({ name: "army_hit", category: "army", volume: e.crit ? 0.2 : 0.15, rate: this.jitter(0.03), minInterval: 130 });
          } else if (e.faction === "enemy") {
            if (furyBatch || afterBolt) break;
            const apex = e;
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
            out.push(apex.prismatic ? { name: "prism", category: "prism", volume: 0.55, rate: this.jitter(0.01), minInterval: 160, fallback: crit } : crit);
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
        case "boss_intro": {
          const enter = SOV_ENTER[e.defId];
          out.push(enter ? { name: enter, category: "event", volume: 0.95, rate: 1 } : { name: "boss_intro", category: "event", volume: 1, rate: 1 });
          break;
        }
        case "boss_mechanic": {
          const ally = isAlly?.(e.id) ?? false;
          if (e.mech === "mirror_guard") {
            // The knight guards itself; its shadow guards the warrior (or whom the guard names).
            if (e.step === "strike") this.guarding.set(e.id, { guarded: ally ? (e.targetIds[0] ?? playerId ?? -1) : e.id, broken: false });
            else if (e.step === "end") {
              if (this.guarding.get(e.id)?.broken) out.push({ name: "sov_shatter", category: "sov", volume: 0.7, rate: 1, minInterval: 150 });
              this.guarding.delete(e.id);
            }
          }
          const c = sovereignCue(e.mech, e.step, ally);
          if (c) out.push(c);
          break;
        }
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
          // A dodge through a standing mirror breaks it.
          for (const g of this.guarding.values()) g.broken = true;
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
        case "storm_bolt":
          // Stormcrown's bolt: the crack and, a beat later, the thunder (one sample).
          if (e.id === playerId) afterBolt = true;
          if (e.id === playerId) out.push({ name: "storm_bolt", category: "storm", volume: 0.6, rate: this.jitter(0.015), minInterval: 300, voice: "storm" });
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

/** A signature beat's sound (null: the moment rides on another's). */
const SIG_BEAT: Partial<Record<SignatureBeat, Cue>> = {
  form: { name: "sig_void_form", category: "sig", volume: 0.6, rate: 1, minInterval: 300 },
  implode: { name: "sig_void_implode", category: "sig", volume: 0.85, rate: 1, minInterval: 200 },
  horizon_trap: { name: "sig_freeze", category: "sig", volume: 0.35, rate: 0.75, minInterval: 400, voice: "horizon" },
  supernova_burst: { name: "sig_hit", category: "sig_hit", volume: 0.45, rate: 1.25, minInterval: 60, voice: "nova" },
  portal: { name: "sig_portal", category: "sig", volume: 0.7, rate: 1, minInterval: 300 },
  pass: { name: "sig_roar", category: "sig", volume: 0.8, rate: 1, minInterval: 400 },
  second_pass: { name: "sig_roar", category: "sig", volume: 0.8, rate: 0.88, minInterval: 400 },
  feed: { name: "sig_bite", category: "sig_hit", volume: 0.4, rate: 0.85, minInterval: 80, voice: "feed" },
  vanish: { name: "sig_vanish", category: "sig", volume: 0.6, rate: 1, minInterval: 200 },
  clone: { name: "sig_clone", category: "sig_hit", volume: 0.42, rate: 1, minInterval: 60, voice: "clone" },
  execute: { name: "sig_finisher", category: "sig", volume: 0.45, rate: 1.3, minInterval: 150, voice: "execute" },
  finisher: { name: "sig_finisher", category: "sig", volume: 0.9, rate: 1, minInterval: 200 },
  hush: { name: "sig_hush", category: "sig", volume: 0.7, rate: 1, minInterval: 400 },
  meteor: { name: "sig_meteor", category: "sig", volume: 0.7, rate: 1, minInterval: 300 },
  impact: { name: "sig_judgement", category: "sig", volume: 1, rate: 1, minInterval: 300 },
  fallen_star: { name: "sig_void_implode", category: "sig", volume: 0.4, rate: 1.5, minInterval: 120, voice: "star" },
  second_shockwave: { name: "boss_impact", category: "sig", volume: 0.7, rate: 0.85, minInterval: 300 },
  darken: { name: "sig_legion", category: "sig", volume: 0.75, rate: 1, minInterval: 400 },
  charge: { name: "sig_charge", category: "sig", volume: 0.8, rate: 1, minInterval: 300 },
  clock: { name: "sig_clock", category: "sig", volume: 0.6, rate: 1, minInterval: 300 },
  freeze: { name: "sig_freeze", category: "sig", volume: 0.65, rate: 1, minInterval: 300 },
  resume: { name: "sig_shatter", category: "sig", volume: 0.85, rate: 1, minInterval: 300 },
  delayed: { name: "sig_hit", category: "sig_hit", volume: 0.42, rate: 1.12, minInterval: 50, voice: "delayed" },
  gather: { name: "sig_blades", category: "sig", volume: 0.55, rate: 1, minInterval: 300 },
  blade: { name: "sig_blade", category: "sig_hit", volume: 0.36, rate: 1, minInterval: 45, voice: "blade" },
  tempest: { name: "sig_blades", category: "sig", volume: 0.6, rate: 0.8, minInterval: 300, voice: "tempest" },
  crown: { name: "sig_crown", category: "sig", volume: 0.85, rate: 1, minInterval: 400 },
  sovereign_end: { name: "apex_rank", category: "sig", volume: 0.35, rate: semitoneRate(-5), minInterval: 400, voice: "sov_end" },
};

/** Each Sovereign's entrance. */
const SOV_ENTER: Partial<Record<string, SfxName>> = { mirror_knight: "sov_knight_enter", storm_titan: "sov_titan_enter", void_queen: "sov_queen_enter" };

/** A Sovereign mechanic's moment: its sound (null: the moment rides on another's). */
const SOV_CUES: Partial<Record<`${SovereignMechanic}:${MechanicStep}`, Cue>> = {
  "mirror_guard:warn": { name: "sov_mirror_rise", category: "sov", volume: 0.65, rate: 1, minInterval: 300 },
  "mirror_echo:warn": { name: "sov_echo", category: "sov", volume: 0.6, rate: 1, minInterval: 300 },
  "mirror_echo:strike": { name: "arc_slash", category: "sov", volume: 0.5, rate: 1.25, minInterval: 200, voice: "sov_echo_strike" },
  "mirror_split:warn": { name: "sov_split", category: "sov", volume: 0.75, rate: 1, minInterval: 400 },
  "mirror_split:end": { name: "sov_shatter", category: "sov", volume: 0.55, rate: 1, minInterval: 150 },
  "storm_rods:warn": { name: "sov_rod_plant", category: "sov", volume: 0.55, rate: 1, minInterval: 160 },
  "storm_rods:strike": { name: "sov_rod_strike", category: "sov", volume: 0.7, rate: 1, minInterval: 120 },
  "storm_chain:warn": { name: "sov_chain", category: "sov", volume: 0.55, rate: 1, minInterval: 300 },
  "storm_chain:strike": { name: "storm_bolt", category: "sov", volume: 0.6, rate: 0.85, minInterval: 200, voice: "sov_chain_strike" },
  "storm_tide:warn": { name: "sov_tide", category: "sov", volume: 0.8, rate: 1, minInterval: 400 },
  "void_well:warn": { name: "sov_well", category: "sov", volume: 0.75, rate: 1, minInterval: 400 },
  "void_court:warn": { name: "sov_court", category: "sov", volume: 0.7, rate: 1, minInterval: 400 },
  "void_eclipse:warn": { name: "sov_eclipse", category: "sov", volume: 0.75, rate: 1, minInterval: 400 },
  "void_eclipse:strike": { name: "sov_eclipse_strike", category: "sov", volume: 0.85, rate: 1, minInterval: 300 },
};

/** A Sovereign mechanic's sound; a shadow's own is the same voice, softer. */
export function sovereignCue(mech: SovereignMechanic, step: MechanicStep, ally = false): Cue | null {
  const c = SOV_CUES[`${mech}:${step}`];
  if (!c) return null;
  return ally ? { ...c, volume: c.volume * 0.7, voice: `${c.voice ?? c.name}_ally` } : c;
}

export function sigBeatCue(beat: SignatureBeat): Cue | null {
  return SIG_BEAT[beat] ?? null;
}

/** A combination: its stinger, a step of D minor apart per combination so each has its own colour. */
const SYNERGY_STEP: Record<SynergyId, number> = { gravity_feast: 0, hunters_parade: 3, legion_meteor: -2, frozen_singularity: 5, blade_parade: 2, crowned_ultimate: 7 };

export function sigSynergyCue(s: SynergyId): Cue {
  return { name: "sig_synergy", category: "event", volume: 0.6, rate: semitoneRate(SYNERGY_STEP[s]), minInterval: 200, voice: "synergy" };
}
