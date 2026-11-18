import type { Vec2 } from "../engine/math";

/**
 * Shared geometry of the signature skills' motion. The simulation decides where a blow lands with
 * these; the renderer may sample the same functions so a body is drawn where it strikes.
 */

/** A quadratic curve from `from` to `to` that passes through `via` at its middle (t = 0.5). */
export interface CurvePath {
  p0: Vec2;
  p1: Vec2;
  p2: Vec2;
}

export function curveThrough(from: Vec2, via: Vec2, to: Vec2): CurvePath {
  return { p0: { ...from }, p1: { x: 2 * via.x - (from.x + to.x) / 2, y: 2 * via.y - (from.y + to.y) / 2 }, p2: { ...to } };
}

/** The point at `t` (0 to 1) along a curve. */
export function curvePoint(c: CurvePath, t: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  const k = Math.max(0, Math.min(1, t));
  const a = (1 - k) * (1 - k);
  const b = 2 * (1 - k) * k;
  const d = k * k;
  out.x = a * c.p0.x + b * c.p1.x + d * c.p2.x;
  out.y = a * c.p0.y + b * c.p1.y + d * c.p2.y;
  return out;
}

/** The Abyssal Devourer's pass: the curve its head follows (the `pass` beat's from, via and to). */
export function devourerCurve(from: Vec2, via: Vec2, to: Vec2): CurvePath {
  return curveThrough(from, via, to);
}

/** Shadow Storm: where blade `i` of `n` orbits the warrior `phase` seconds into the gather. */
export function orbitPoint(center: Vec2, i: number, n: number, phase: number, radius = 34): Vec2 {
  const a = (i / Math.max(1, n)) * Math.PI * 2 + phase * 7;
  return { x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius * 0.45 - 18 };
}
