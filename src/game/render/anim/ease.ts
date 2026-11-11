/**
 * Animation primitives shared by the renderer. Everything here is pure and allocation-free so it
 * can run per channel, per entity, per frame.
 */

/**
 * Frame-rate independent exponential smoothing: moves `current` toward `target` so that the
 * remaining distance shrinks by e^(-lambda * dt). Two steps of dt equal one step of 2 dt exactly.
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  if (dt <= 0) return current;
  return target + (current - target) * Math.exp(-lambda * dt);
}

/** `damp` for angles: takes the short way round. */
export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  let d = target - current;
  d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return damp(current, current + d, lambda, dt);
}

/** State for `spring`: position and velocity. */
export interface SpringState {
  x: number;
  v: number;
}

/** Critical damping for a given stiffness (no overshoot). */
export const criticalDamping = (stiffness: number): number => 2 * Math.sqrt(stiffness);

/**
 * Damped spring toward `target`. `damping` defaults to critical. Integrated with semi-implicit
 * Euler in fixed substeps of at most 1/240 s, so the result does not depend on the frame rate.
 */
export function spring(s: SpringState, target: number, stiffness: number, damping = criticalDamping(stiffness), dt: number): void {
  if (dt <= 0) return;
  const steps = Math.max(1, Math.ceil(dt * 240));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const a = -stiffness * (s.x - target) - damping * s.v;
    s.v += a * h;
    s.x += s.v * h;
  }
}

export const easeOutCubic = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);
export const easeInCubic = (t: number): number => t * t * t;
export const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2;
/** Overshoots past 1 and settles back; `overshoot` 1.70158 gives the classic 10%. */
export const easeOutBack = (t: number, overshoot = 1.70158): number => {
  const u = t - 1;
  return 1 + (overshoot + 1) * u * u * u + overshoot * u * u;
};

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Position of `t` within [a, b] as 0..1. */
export const span = (t: number, a: number, b: number): number => (b <= a ? (t >= b ? 1 : 0) : clamp01((t - a) / (b - a)));

function hash(n: number): number {
  // Integer hash to [-1, 1]; deterministic and cheap.
  let x = (n | 0) * 374761393;
  x = (x ^ (x >>> 13)) * 1274126177;
  x = x ^ (x >>> 16);
  return ((x >>> 0) / 4294967295) * 2 - 1;
}

/** Smooth 1D value noise in [-1, 1]: continuous, so shake built from it does not flicker. */
export function noise1(t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  const a = hash(i);
  const b = hash(i + 1);
  return a + (b - a) * u;
}

/** A stable pseudo-random in [0, 1) from two numbers (seeded blink timing and the like). */
export function rand2(a: number, b: number): number {
  return (hash(Math.floor(a * 9973) + Math.floor(b) * 7919) + 1) / 2;
}
