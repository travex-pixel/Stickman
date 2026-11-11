import { damp, easeOutCubic, noise1, spring, type SpringState } from "./anim/ease";

/** Axis-aligned box in base (unzoomed canvas) pixels. */
export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Point {
  x: number;
  y: number;
}

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 1.32;
/** With reduced motion the camera holds one gentle zoom and only follows. */
export const ZOOM_REDUCED = 1.12;
const KICK_STIFFNESS = 240;
const KICK_DAMPING = 22;
const PUNCH_TIME = 0.26;

/**
 * The battle camera. Content is laid out in "base" space (the canvas at zoom 1, where the arena
 * spans the full width); the camera maps base space to the screen with a zoom about a followed
 * centre, plus kick (a spring-back offset), punch (a brief zoom pulse) and trauma shake.
 *
 *   screen = anchor + offset + R(rotation) * zoom * (base - centre)
 *
 * It never lets the view leave the painted area [0, w] x [0, h]; shake and kick may push past it
 * by at most `bleed`, which the backdrop paints beyond the canvas edges.
 */
export class Camera {
  width = 1;
  height = 1;
  insetBottom = 0;
  bleed = 24;
  reduced = false;

  /** Followed centre (base px) and zoom. */
  cx = 0;
  cy = 0;
  zoom = 1;
  private targetX = 0;
  private targetY = 0;
  private targetZoom = 1;
  private readonly kickX: SpringState = { x: 0, v: 0 };
  private readonly kickY: SpringState = { x: 0, v: 0 };
  private punchAmount = 0;
  private punchT = PUNCH_TIME;
  private trauma = 0;
  private time = 0;
  private settled = false;

  /** Output transform (apply to the camera layer): pivot = centre, position = anchor + offset. */
  readonly out = { x: 0, y: 0, pivotX: 0, pivotY: 0, scale: 1, rotation: 0 };

  setViewport(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    if (!this.settled) {
      this.cx = this.targetX = this.width / 2;
      this.cy = this.targetY = this.anchorY;
    }
    this.clampCentre();
    this.compose();
  }

  setInsets(bottom: number): void {
    this.insetBottom = Math.max(0, Math.min(this.height * 0.6, bottom));
  }

  get anchorX(): number {
    return this.width / 2;
  }

  /** Bottom insets lift the framing centre by half their height. */
  get anchorY(): number {
    return (this.height - this.insetBottom) / 2;
  }

  /** Effective zoom including the punch. */
  get scale(): number {
    return this.out.scale;
  }

  /**
   * Frame a box (base px), biased toward a focus point. Sets the follow target; `update` moves
   * toward it.
   */
  frame(box: Box, focusX: number, focusY: number): void {
    const bw = Math.max(1, box.maxX - box.minX);
    const bh = Math.max(1, box.maxY - box.minY);
    const usableH = Math.max(1, this.height - this.insetBottom);
    let z = Math.min(this.width / bw, usableH / bh);
    z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    if (this.reduced) z = ZOOM_REDUCED;
    this.targetZoom = z;
    const mx = (box.minX + box.maxX) / 2;
    const my = (box.minY + box.maxY) / 2;
    this.targetX = mx + (focusX - mx) * 0.2;
    this.targetY = my + (focusY - my) * 0.2;
  }

  /** Jump straight to the current target (new world, resize). */
  snap(): void {
    this.cx = this.targetX;
    this.cy = this.targetY;
    this.zoom = this.targetZoom;
    this.settled = true;
    this.clampCentre();
    this.compose();
  }

  /** A hit's impulse, in screen px along the hit direction; springs back. */
  kick(dx: number, dy: number): void {
    if (this.reduced) return;
    this.kickX.x += dx;
    this.kickY.x += dy;
  }

  /** Zoom pulse: x(1 + amount), returning over 260ms. */
  punch(amount: number): void {
    if (this.reduced) return;
    this.punchAmount = Math.max(this.punchAmount * (1 - easeOutCubic(Math.min(1, this.punchT / PUNCH_TIME))), amount);
    this.punchT = 0;
  }

  /** Adds trauma (0 to 1); shake grows with its square and decays at 1.6 per second. */
  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  get traumaLevel(): number {
    return this.trauma;
  }

  update(dt: number): void {
    this.time += dt;
    this.settled = true;
    this.zoom = damp(this.zoom, this.targetZoom, 2.5, dt);
    this.cx = damp(this.cx, this.targetX, 4, dt);
    this.cy = damp(this.cy, this.targetY, 4, dt);
    this.clampCentre();
    spring(this.kickX, 0, KICK_STIFFNESS, KICK_DAMPING, dt);
    spring(this.kickY, 0, KICK_STIFFNESS, KICK_DAMPING, dt);
    if (this.punchT < PUNCH_TIME) this.punchT += dt;
    this.trauma = Math.max(0, this.trauma - 1.6 * dt);
    this.compose();
  }

  private clampCentre(): void {
    const z = this.zoom;
    const ax = this.anchorX;
    const ay = this.anchorY;
    // The visible base rect is [c - a / z, c + (size - a) / z]; keep it inside [0, size].
    const minX = ax / z;
    const maxX = this.width - (this.width - ax) / z;
    const minY = ay / z;
    const maxY = this.height - (this.height - ay) / z;
    this.cx = minX > maxX ? this.width / 2 : Math.min(maxX, Math.max(minX, this.cx));
    this.cy = minY > maxY ? ay : Math.min(maxY, Math.max(minY, this.cy));
  }

  private compose(): void {
    const punch = this.punchT < PUNCH_TIME ? this.punchAmount * (1 - easeOutCubic(this.punchT / PUNCH_TIME)) : 0;
    const scale = this.zoom * (1 + punch);
    const t2 = this.trauma * this.trauma * (this.reduced ? 0.25 : 1);
    let ox = this.kickX.x + t2 * 10 * noise1(this.time * 28);
    let oy = this.kickY.x + t2 * 10 * noise1(this.time * 28 + 57.3);
    const rot = ((t2 * 0.6 * Math.PI) / 180) * noise1(this.time * 28 + 113.7);
    // Keep the view inside the painted bleed: the backdrop extends `bleed` px past each edge.
    const b = this.bleed;
    const ax = this.anchorX;
    const ay = this.anchorY;
    const left = ax + ox - (this.cx - 0) * scale;
    const right = ax + ox + (this.width - this.cx) * scale;
    if (left > b) ox -= left - b;
    if (right < this.width - b) ox += this.width - b - right;
    const top = ay + oy - this.cy * scale;
    const bottom = ay + oy + (this.height - this.cy) * scale;
    if (top > b) oy -= top - b;
    if (bottom < this.height - b) oy += this.height - b - bottom;
    const o = this.out;
    o.pivotX = this.cx;
    o.pivotY = this.cy;
    o.x = ax + ox;
    o.y = ay + oy;
    o.scale = scale;
    o.rotation = rot;
  }

  /** Base px to screen px (canvas-local CSS pixels). */
  project(bx: number, by: number, out: Point): Point {
    const o = this.out;
    const dx = (bx - o.pivotX) * o.scale;
    const dy = (by - o.pivotY) * o.scale;
    const c = Math.cos(o.rotation);
    const s = Math.sin(o.rotation);
    out.x = o.x + dx * c - dy * s;
    out.y = o.y + dx * s + dy * c;
    return out;
  }

  /** Screen px (canvas-local) to base px. */
  unproject(sx: number, sy: number, out: Point): Point {
    const o = this.out;
    const dx = sx - o.x;
    const dy = sy - o.y;
    const c = Math.cos(-o.rotation);
    const s = Math.sin(-o.rotation);
    out.x = o.pivotX + (dx * c - dy * s) / o.scale;
    out.y = o.pivotY + (dx * s + dy * c) / o.scale;
    return out;
  }

  /** The base-space rect currently on screen (ignores the tiny shake rotation). */
  visible(out: Box): Box {
    const o = this.out;
    out.minX = o.pivotX - o.x / o.scale;
    out.maxX = o.pivotX + (this.width - o.x) / o.scale;
    out.minY = o.pivotY - o.y / o.scale;
    out.maxY = o.pivotY + (this.height - o.y) / o.scale;
    return out;
  }
}
