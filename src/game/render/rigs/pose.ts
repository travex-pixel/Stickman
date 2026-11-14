import type { ActionState } from "../../entities/types";
import { easeInCubic, easeInOutSine, easeOutBack, easeOutCubic, span } from "../anim/ease";

/**
 * Target poses for the procedural rigs. A pose is a flat Float32Array of channels so the rig can
 * blend every channel with `damp` without allocating. Angles are radians, hips in rig units.
 *
 * Blade angle reference (body facing +x): the blade points along torso + armR0 + armR1 + weapon,
 * where 0 is straight up, pi/2 forward, pi straight down.
 */
export const Ch = {
  Torso: 0,
  Head: 1,
  HipsX: 2,
  HipsY: 3,
  ArmL0: 4,
  ArmL1: 5,
  ArmR0: 6,
  ArmR1: 7,
  LegL0: 8,
  LegL1: 9,
  LegR0: 10,
  LegR1: 11,
  Weapon: 12,
  ScaleY: 13,
  Lean: 14,
} as const;
export const CHANNELS = 15;
export type Pose = Float32Array;

export type BodyStyle = "warrior" | "lean" | "bulky" | "robed" | "archer" | "warden" | "reaper";
export type WeaponType = "sword" | "greatsword" | "dagger" | "bow" | "staff" | "scythe" | "club" | "mace_shield" | "twin" | "tower" | "banner" | "none";

/** A shadow's idle character, by army role ("" for everything else). */
export type IdleRole = "" | "vanguard" | "reaper" | "ranger" | "arcanist" | "sentinel" | "support" | "sovereign" | "caller";

/** How a rig fights in melee. `combo` cycles three swings; the others keep one signature move. */
export type MeleeKit = "combo" | "heavy" | "thrust" | "archer" | "robed";

export function meleeKit(style: BodyStyle, weapon: WeaponType): MeleeKit {
  if (style === "archer") return "archer";
  if (style === "robed") return "robed";
  if (weapon === "tower") return "thrust";
  if (style === "bulky" || style === "warden") return "heavy";
  return "combo";
}

/**
 * The swing a combo rig shows. The counter is incremented on each `attack_swing` event, which the
 * simulation emits as the wind-up ends: so a wind-up shows the next swing (counter % 3) and the
 * strike and recovery that follow it still show the swing that was just thrown.
 */
export function swingVariant(counter: number, state: ActionState): number {
  const n = state === "windup" ? counter : counter - 1;
  return ((n % 3) + 3) % 3;
}

/**
 * Damage lands on the first frame of `attack`, so the blade must already be at the target then.
 * The strike is the last part of the wind-up: 30% of it, but never slower than 140ms (long boss
 * wind-ups keep their anticipation and still strike fast) nor faster than 35ms.
 */
export function strikeWindow(windup: number): number {
  if (windup <= 0) return 0;
  return Math.min(windup, Math.max(0.035, Math.min(0.14, windup * 0.3)));
}

/**
 * Time the contact pose is held at the start of `attack` before the follow-through. The third
 * swing of a combo (variant 2, the overhead) holds half as long again: it is the heavy beat.
 */
export function contactHold(kit: MeleeKit, strike: number, variant = 0): number {
  if (kit === "heavy") return strike * 0.6;
  return variant === 2 ? Math.min(0.06, strike * 0.6) : Math.min(0.04, strike * 0.4);
}

/** The share of the anticipation in which the body reaches its coil; it holds there for the rest. */
export const ANTIC_REACH = 0.6;
/** While held, the coil keeps loading: this much further away from the contact pose by the strike. */
export const ANTIC_LOAD = 0.07;
/** The share of the recovery for which the follow-through is held before the body settles to guard. */
export const RECOVER_HOLD = 0.3;

// Keyframes: [torso, head, hipsX, hipsY, armL0, armL1, armR0, armR1, legL0, legL1, legR0, legR1, weapon, scaleY, lean]
type Key = readonly number[];
const k = (...v: number[]): Key => v;

/** Three swings: 0 high to low forehand, 1 rising backhand, 2 overhead with a deeper step. */
const COMBO: readonly { antic: Key; contact: Key; follow: Key }[] = [
  {
    // Forehand: a downward diagonal cut. At contact the arm is already low and forward with the
    // wrist cocked, so the blade crosses the line of the arm (not a thrust along it), and it
    // follows through down past the hip.
    antic: k(-0.3, 0.2, -4.5, 1.5, 0.7, 0.5, -2.5, 0.35, 0.45, 0.3, -0.4, 0.25, 1.15, 1, -0.08),
    contact: k(0.35, -0.1, 6, 2.5, -0.3, 0.5, -1.0, 0.25, 0.6, 0.2, -0.7, 0.55, 2.15, 1, 0.06),
    follow: k(0.45, 0.05, 7, 3, -0.5, 0.4, -0.35, 0.3, 0.6, 0.2, -0.75, 0.6, 2.35, 1, 0.08),
  },
  {
    antic: k(0.3, 0.1, -3.5, 3, -0.4, 0.6, 0.55, 0.5, 0.5, 0.45, -0.35, 0.5, 2.35, 1, 0),
    contact: k(0.05, -0.1, 5, 1, 0.5, 0.4, -1.3, 0.1, 0.55, 0.2, -0.6, 0.45, 2.65, 1, 0.05),
    follow: k(-0.2, -0.2, 6, 0, 0.7, 0.5, -2.4, 0.15, 0.5, 0.2, -0.6, 0.4, 2.85, 1, 0.04),
  },
  {
    antic: k(-0.45, 0.25, -5.5, -1, -2.6, 0.4, -2.9, 0.25, 0.3, 0.2, -0.3, 0.2, 2.6, 1.03, -0.1),
    contact: k(0.55, 0.05, 9, 4, -0.9, 0.2, -1.0, 0.1, 0.8, 0.3, -0.95, 0.9, 2.7, 0.96, 0.1),
    follow: k(0.7, 0.1, 10, 5, -0.3, 0.3, -0.3, 0.2, 0.8, 0.3, -1.0, 0.95, 2.25, 0.96, 0.12),
  },
];

/** Brutes, wardens and vanguards: one heavy overhead, higher lift and a longer hold. */
const HEAVY = {
  antic: k(-0.5, 0.3, -5, -1.5, -2.4, 0.4, -2.8, 0.2, 0.25, 0.15, -0.25, 0.15, 2.7, 1.03, 0),
  contact: k(0.6, 0.1, 7, 5, -0.8, 0.2, -0.9, 0.1, 0.7, 0.4, -0.85, 0.9, 2.2, 0.95, 0),
  follow: k(0.72, 0.15, 8, 6, -0.4, 0.3, -0.45, 0.2, 0.7, 0.4, -0.9, 0.95, 2.3, 0.95, 0),
};

/** Shieldbearers and sentinels: a short shield thrust. */
const THRUST = {
  antic: k(-0.15, 0.05, -3, 1.5, 0.4, 0.5, 0.35, -1.6, 0.4, 0.25, -0.35, 0.25, 1.4, 1, 0),
  contact: k(0.2, -0.05, 5, 1.5, 0.4, 0.5, -1.45, -0.05, 0.45, 0.2, -0.5, 0.4, 1.3, 1, 0),
  follow: k(0.22, -0.05, 5.5, 1.5, 0.4, 0.5, -1.4, 0, 0.45, 0.2, -0.5, 0.4, 1.18, 1, 0),
};

function setKey(out: Pose, key: Key): void {
  for (let i = 0; i < CHANNELS; i++) out[i] = key[i]!;
}

function mixKey(out: Pose, a: Key, b: Key, t: number): void {
  for (let i = 0; i < CHANNELS; i++) out[i] = a[i]! + (b[i]! - a[i]!) * t;
}

/** Push `out` further along the line from `to` back through `from`: the coil loading before a strike. */
function addLoad(out: Pose, from: Key, to: Key, amount: number): void {
  for (let i = 0; i < CHANNELS; i++) out[i] = out[i]! + (from[i]! - to[i]!) * amount;
}

/** Blend the current contents of `out` toward a key. */
function mixToward(out: Pose, b: Key, t: number): void {
  for (let i = 0; i < CHANNELS; i++) out[i] = out[i]! + (b[i]! - out[i]!) * t;
}

/**
 * Role idles for the army, layered over the guard so each shadow reads as a character: the vanguard
 * plants and rolls its shoulders, the reaper sways low, the ranger checks its string, the
 * arcanist's staff orbits, the sentinel sets its shield. Periodic gestures use a slow cycle with a
 * per-rig phase so a squad never moves in unison.
 */
function roleIdle(out: Pose, role: IdleRole, clock: number, seed: number): void {
  const t = clock + seed * 17;
  switch (role) {
    case "vanguard": {
      // Every ~4.5s: weight settles, the shoulders roll back and forward again.
      const k = gesture(t, 4.5, 1.1);
      out[Ch.Torso] = out[Ch.Torso]! - 0.12 * k;
      out[Ch.ArmL0] = out[Ch.ArmL0]! + 0.35 * k;
      out[Ch.ArmR0] = out[Ch.ArmR0]! - 0.3 * k;
      out[Ch.HipsY] = out[Ch.HipsY]! + 1.5 * k;
      out[Ch.LegL0] = out[Ch.LegL0]! + 0.12;
      out[Ch.LegR0] = out[Ch.LegR0]! - 0.12;
      return;
    }
    case "reaper": {
      // Low and never still: a slow sway at the hips with the blade held back.
      const sway = Math.sin(t * 1.9);
      out[Ch.HipsX] = out[Ch.HipsX]! + sway * 2.2;
      out[Ch.HipsY] = out[Ch.HipsY]! + 2.5;
      out[Ch.Torso] = out[Ch.Torso]! + 0.12 + sway * 0.05;
      out[Ch.LegL0] = out[Ch.LegL0]! + 0.25;
      out[Ch.LegL1] = out[Ch.LegL1]! + 0.3;
      out[Ch.LegR0] = out[Ch.LegR0]! - 0.25;
      out[Ch.LegR1] = out[Ch.LegR1]! + 0.3;
      out[Ch.Weapon] = out[Ch.Weapon]! + 0.5;
      return;
    }
    case "ranger": {
      // Every ~5s the drawing hand comes up to the string and plucks it.
      const k = gesture(t, 5, 0.9);
      out[Ch.ArmL0] = out[Ch.ArmL0]! - 1.1 * k;
      out[Ch.ArmL1] = out[Ch.ArmL1]! + 0.9 * k;
      out[Ch.Head] = out[Ch.Head]! + 0.18 * k;
      return;
    }
    case "arcanist":
    case "caller": {
      // The staff head traces a small circle.
      out[Ch.Weapon] = out[Ch.Weapon]! + Math.sin(t * 1.6) * 0.16;
      out[Ch.ArmR0] = out[Ch.ArmR0]! + Math.cos(t * 1.6) * 0.1;
      return;
    }
    case "sentinel": {
      // Every ~5.5s the shield lifts and is set down hard.
      const k = gesture(t, 5.5, 0.8);
      out[Ch.ArmR0] = out[Ch.ArmR0]! - 0.55 * k;
      out[Ch.ArmR1] = out[Ch.ArmR1]! - 0.3 * k;
      out[Ch.HipsY] = out[Ch.HipsY]! + 1.2 * k;
      return;
    }
    case "support":
      // The banner leans with the wind.
      out[Ch.Weapon] = out[Ch.Weapon]! - 0.25 + Math.sin(t * 0.9) * 0.08;
      return;
    case "sovereign":
      // Still and tall: the blade grounded, a slow breath.
      out[Ch.Weapon] = out[Ch.Weapon]! + 1.6;
      out[Ch.ArmR0] = out[Ch.ArmR0]! + 0.25;
      out[Ch.Torso] = out[Ch.Torso]! - 0.05;
      return;
    default:
      return;
  }
}

/** A one-shot gesture inside a repeating cycle: 0 most of the time, a smooth 0-1-0 hump `len` seconds long. */
export function gesture(t: number, period: number, len: number): number {
  const ph = ((t % period) + period) % period;
  if (ph > len) return 0;
  return Math.sin((ph / len) * Math.PI);
}

function setGuard(out: Pose, style: BodyStyle, clock: number, seed: number): void {
  const bulky = style === "bulky" || style === "warden";
  const reaper = style === "reaper";
  const breathe = Math.sin((clock + seed * 10) * (bulky ? 1.6 : 2.4));
  // Slow weight shift, out of phase with the breath (3.1s period).
  const shift = Math.sin((clock + seed * 13) * ((Math.PI * 2) / 3.1));
  out[Ch.Torso] = breathe * 0.025 + (reaper ? 0.22 : bulky ? 0.1 : 0) - shift * 0.02;
  out[Ch.Head] = -breathe * 0.02 + (reaper ? 0.15 : 0) + shift * 0.025;
  out[Ch.HipsX] = shift * 1.2;
  out[Ch.HipsY] = breathe * 0.8 + (reaper ? 1.5 : 0);
  out[Ch.ArmL0] = 0.4 + breathe * 0.03;
  out[Ch.ArmL1] = 0.35;
  out[Ch.ArmR0] = -0.35 - breathe * 0.03;
  out[Ch.ArmR1] = 0.5;
  out[Ch.LegL0] = 0.08 + shift * 0.05;
  out[Ch.LegL1] = 0.05;
  out[Ch.LegR0] = -0.08 + shift * 0.05;
  out[Ch.LegR1] = 0.05;
  out[Ch.Weapon] = style === "archer" ? 0.1 : style === "robed" ? -0.3 : 0.5;
  out[Ch.ScaleY] = 1;
  out[Ch.Lean] = 0;
  if (style === "archer") {
    out[Ch.ArmR0] = -0.9;
    out[Ch.ArmR1] = 0.9;
  }
}

export interface PoseInput {
  style: BodyStyle;
  kit: MeleeKit;
  state: ActionState;
  /** Seconds in the current simulation state. */
  t: number;
  duration: number;
  seed: number;
  /** Continuous rig clock (seconds) for breathing and weight shift, independent of state changes. */
  clock: number;
  speedFrac: number;
  variant: number;
  /** Death presentation: 0 collapse, 1 launch, 2 dissolve, 3 sink (the army's pool). */
  death: number;
  /** Role idle for the army ("" for none). */
  idle: IdleRole;
}

/** Writes the target pose for this frame into `out`. Never allocates. */
export function computePose(out: Pose, p: PoseInput): void {
  const { style, kit, state, t, duration, seed } = p;
  const bulky = style === "bulky" || style === "warden";
  const reaper = style === "reaper";
  const kk = duration > 0 ? Math.min(1, Math.max(0, t / duration)) : 1;
  setGuard(out, style, p.clock, seed);

  switch (state) {
    case "idle":
      if (p.idle) roleIdle(out, p.idle, p.clock, seed);
      return;
    case "emerge":
      return;
    case "move": {
      const legSpeed = bulky ? 6 : reaper ? 13 : 10;
      const w = (p.clock + seed * 7) * legSpeed * (0.6 + p.speedFrac * 0.6);
      const sw = Math.sin(w);
      const amp = bulky ? 0.45 : 0.75;
      out[Ch.LegL0] = sw * amp;
      out[Ch.LegL1] = Math.max(0, -sw) * 0.9;
      out[Ch.LegR0] = -sw * amp;
      out[Ch.LegR1] = Math.max(0, sw) * 0.9;
      out[Ch.ArmL0] = -sw * 0.6 + 0.2;
      out[Ch.ArmL1] = 0.5;
      out[Ch.ArmR0] = sw * 0.5 - 0.3;
      out[Ch.ArmR1] = 0.55;
      out[Ch.HipsX] = 0;
      out[Ch.HipsY] = Math.abs(Math.cos(w)) * -2.2 * (bulky ? 1.6 : 1);
      out[Ch.Torso] = 0.12 + Math.abs(Math.cos(w)) * 0.03 + (reaper ? 0.25 : 0);
      out[Ch.Head] = -0.06;
      out[Ch.Weapon] = style === "archer" ? 0.1 : 0.6;
      if (style === "robed") {
        out[Ch.LegL0] = 0.05;
        out[Ch.LegR0] = -0.05;
        out[Ch.LegL1] = 0.05;
        out[Ch.LegR1] = 0.05;
        out[Ch.HipsY] = Math.sin(w * 0.4) * 2;
        out[Ch.Torso] = 0.08;
      }
      return;
    }
    case "windup": {
      if (kit === "archer") {
        const e = easeOutCubic(kk);
        out[Ch.ArmL0] = -1.5;
        out[Ch.ArmL1] = 0.1;
        out[Ch.ArmR0] = -1.5 + e * 0.1;
        out[Ch.ArmR1] = 1.6 * e + 0.2;
        out[Ch.Torso] = -0.05 - 0.06 * e;
        out[Ch.Weapon] = 0.1;
        out[Ch.LegL0] = 0.3;
        out[Ch.LegL1] = 0.1;
        out[Ch.LegR0] = -0.3;
        out[Ch.LegR1] = 0.1;
        return;
      }
      if (kit === "robed") {
        const e = easeOutCubic(kk);
        out[Ch.ArmR0] = -2.2 * e;
        out[Ch.ArmR1] = 0.3;
        out[Ch.ArmL0] = -1.8 * e;
        out[Ch.ArmL1] = 0.4;
        out[Ch.Torso] = -0.15 * e;
        out[Ch.Weapon] = -0.4;
        out[Ch.HipsY] = -2 * e;
        return;
      }
      const set = kit === "heavy" ? HEAVY : kit === "thrust" ? THRUST : COMBO[p.variant % 3]!;
      const strike = strikeWindow(duration);
      const s0 = duration - strike;
      if (t < s0) {
        // Anticipation: weight back, arm up, torso coils away from the target. The coil is
        // reached early and then held, still loading, so the wind-up is read before the strike
        // (eased over the whole window it was barely two thirds formed when the blade left).
        const reach = s0 * ANTIC_REACH;
        mixToward(out, set.antic, easeOutCubic(span(t, 0, reach)));
        if (t > reach) {
          const c = span(t, reach, s0);
          addLoad(out, set.antic, set.contact, ANTIC_LOAD * c);
          // A long wind-up (a brute, a boss) trembles with the effort instead of sitting still.
          if (s0 > 0.3) {
            out[Ch.Weapon] = out[Ch.Weapon]! + Math.sin(t * 70) * 0.022 * c;
            out[Ch.ArmR0] = out[Ch.ArmR0]! + Math.sin(t * 70 + 1.3) * 0.014 * c;
          }
        }
      } else {
        // The strike: accelerate from the loaded coil into contact.
        const e = easeInCubic(span(t, s0, duration));
        mixKey(out, set.antic, set.contact, e);
        addLoad(out, set.antic, set.contact, ANTIC_LOAD * (1 - e));
      }
      return;
    }
    case "attack": {
      if (kit === "archer") {
        const e = easeOutCubic(kk);
        out[Ch.ArmL0] = -1.5;
        out[Ch.ArmL1] = 0.1;
        out[Ch.ArmR0] = -1.4;
        out[Ch.ArmR1] = 0.3 + (1 - e) * 1.4;
        out[Ch.Torso] = 0.05;
        out[Ch.Weapon] = 0.1;
        out[Ch.LegL0] = 0.3;
        out[Ch.LegL1] = 0.1;
        out[Ch.LegR0] = -0.3;
        out[Ch.LegR1] = 0.1;
        return;
      }
      if (kit === "robed") {
        const e = easeOutCubic(kk);
        out[Ch.ArmR0] = -2.2 + e * 1.6;
        out[Ch.ArmR1] = 0.2;
        out[Ch.ArmL0] = -1.8 + e * 1.4;
        out[Ch.ArmL1] = 0.3;
        out[Ch.Torso] = 0.2 * e;
        out[Ch.Weapon] = -0.4;
        return;
      }
      const set = kit === "heavy" ? HEAVY : kit === "thrust" ? THRUST : COMBO[p.variant % 3]!;
      const hold = contactHold(kit, duration, kit === "combo" ? p.variant % 3 : 0);
      if (t < hold) setKey(out, set.contact);
      else mixKey(out, set.contact, set.follow, easeOutBack(span(t, hold, duration), 1.4));
      return;
    }
    case "recover": {
      // The follow-through is held for a beat, then the body eases back to guard, the weapon
      // arriving last (the rig's own lag): the blow has weight because it takes time to leave.
      if (kit === "archer" || kit === "robed") return;
      const set = kit === "heavy" ? HEAVY : kit === "thrust" ? THRUST : COMBO[p.variant % 3]!;
      mixToward(out, set.follow, 1 - easeInOutSine(span(t, duration * RECOVER_HOLD, duration)));
      return;
    }
    case "cast": {
      const e = Math.sin(kk * Math.PI);
      out[Ch.Torso] = -0.12 * e;
      out[Ch.Head] = -0.3 * e;
      out[Ch.ArmR0] = -2.9 * e - 0.2;
      out[Ch.ArmR1] = 0.2;
      out[Ch.ArmL0] = 2.6 * e + 0.3;
      out[Ch.ArmL1] = 0.2;
      out[Ch.Weapon] = -0.7 * e + 0.5;
      out[Ch.HipsY] = -3 * e;
      out[Ch.LegL0] = 0.35;
      out[Ch.LegL1] = 0.2;
      out[Ch.LegR0] = -0.35;
      out[Ch.LegR1] = 0.2;
      return;
    }
    case "dodge":
      out[Ch.Torso] = 0.55;
      out[Ch.Head] = -0.2;
      out[Ch.LegL0] = 1.1;
      out[Ch.LegL1] = 0.2;
      out[Ch.LegR0] = -0.9;
      out[Ch.LegR1] = 1.1;
      out[Ch.ArmL0] = -0.8;
      out[Ch.ArmL1] = 0.3;
      out[Ch.ArmR0] = 0.9;
      out[Ch.ArmR1] = 0.2;
      out[Ch.HipsY] = 4;
      out[Ch.HipsX] = 0;
      out[Ch.Weapon] = 0.3;
      return;
    case "hit":
    case "stagger": {
      const e = Math.sin(kk * Math.PI);
      const big = state === "stagger";
      out[Ch.Torso] = (big ? -0.55 : -0.35) * e;
      out[Ch.Head] = -0.4 * e;
      out[Ch.HipsX] = -5 * e;
      out[Ch.HipsY] = (big ? 6 : 2) * e;
      out[Ch.ArmL0] = 0.8 * e + 0.3;
      out[Ch.ArmL1] = 0.3;
      out[Ch.ArmR0] = -0.2 - 0.8 * e;
      out[Ch.ArmR1] = 0.3;
      out[Ch.LegL0] = 0.5 * e;
      out[Ch.LegL1] = 0.1;
      out[Ch.LegR0] = -0.3 * e;
      out[Ch.LegR1] = 0.3 * e;
      return;
    }
    case "victory": {
      const e = easeOutCubic(span(t, 0, 0.35));
      const breathe = Math.sin((p.clock + seed * 10) * 2.4);
      const hop = t < 0.7 ? Math.sin((t / 0.7) * Math.PI) * -4 : breathe * 0.6;
      out[Ch.Torso] = -0.1 * e;
      out[Ch.Head] = -0.28 * e;
      out[Ch.ArmR0] = -2.9 * e - 0.1;
      out[Ch.ArmR1] = 0.12;
      out[Ch.ArmL0] = 0.55 + 0.25 * e;
      out[Ch.ArmL1] = 0.55;
      out[Ch.Weapon] = 0.5 - 0.5 * e;
      out[Ch.HipsX] = 0;
      out[Ch.HipsY] = hop;
      out[Ch.LegL0] = 0.22;
      out[Ch.LegL1] = 0.08;
      out[Ch.LegR0] = -0.22;
      out[Ch.LegR1] = 0.08;
      if (style === "archer") out[Ch.ArmL0] = -2.6 * e;
      return;
    }
    case "dead": {
      // The army's sink keeps its guard: the shadow goes down into its pool standing.
      if (p.death === 3) return;
      if (p.death === 4) {
        // A boss's last kneel: the near knee down, the blade planted, the head bowed.
        out[Ch.Torso] = 0.38;
        out[Ch.Head] = 0.35;
        out[Ch.HipsX] = 1;
        out[Ch.HipsY] = 11;
        out[Ch.ArmL0] = 0.35;
        out[Ch.ArmL1] = 0.4;
        out[Ch.ArmR0] = -0.55;
        out[Ch.ArmR1] = 0.35;
        out[Ch.LegL0] = 0.55;
        out[Ch.LegL1] = 1.75;
        out[Ch.LegR0] = -1.1;
        out[Ch.LegR1] = 1.45;
        out[Ch.Weapon] = 2.75;
        return;
      }
      if (p.death === 1) {
        // Thrown: limp, limbs trailing the flight.
        out[Ch.Torso] = -0.35;
        out[Ch.Head] = -0.4;
        out[Ch.HipsX] = 0;
        out[Ch.HipsY] = 0;
        out[Ch.ArmL0] = -2.0;
        out[Ch.ArmL1] = 0.4;
        out[Ch.ArmR0] = 1.7;
        out[Ch.ArmR1] = 0.5;
        out[Ch.LegL0] = 0.7;
        out[Ch.LegL1] = 0.6;
        out[Ch.LegR0] = -0.5;
        out[Ch.LegR1] = 0.4;
        out[Ch.Weapon] = 1.2;
        return;
      }
      // Collapse: the knees fold, the hips drop and the torso pitches forward.
      out[Ch.Torso] = 1.15;
      out[Ch.Head] = 0.45;
      out[Ch.HipsX] = 4;
      out[Ch.HipsY] = 17;
      out[Ch.ArmL0] = -0.2;
      out[Ch.ArmL1] = 0.3;
      out[Ch.ArmR0] = -0.7;
      out[Ch.ArmR1] = 0.6;
      out[Ch.LegL0] = -0.9;
      out[Ch.LegL1] = 2.1;
      out[Ch.LegR0] = -1.2;
      out[Ch.LegR1] = 2.3;
      out[Ch.Weapon] = 1.6;
      return;
    }
    default:
      return;
  }
}

/** Blend speed (lambda for `damp`) for a state; the strike part of a wind-up is near-instant. */
export function stateLambda(state: ActionState, t: number, duration: number): number {
  switch (state) {
    case "idle":
      return 9;
    case "move":
      return 14;
    case "windup":
      // Fast enough that the coil is actually reached inside a 90ms anticipation.
      return t >= duration - strikeWindow(duration) ? 60 : 34;
    case "attack":
      return 60;
    case "recover":
      // The curve is authored (hold, then settle), so the rig follows it closely.
      return 20;
    case "hit":
    case "stagger":
      return 45;
    case "cast":
      return 14;
    case "dodge":
      return 40;
    case "victory":
      return 8;
    case "dead":
      return 14;
    default:
      return 12;
  }
}

/** States that snap to their first pose rather than blend into it. */
export function snapsOnEnter(state: ActionState): boolean {
  return state === "attack" || state === "hit" || state === "stagger" || state === "dodge" || state === "emerge";
}
