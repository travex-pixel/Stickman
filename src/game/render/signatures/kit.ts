import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import type { EmitOptions } from "../Particles";
import { Rig, type RigSpec } from "../rigs/Rig";
import { easeInCubic, easeOutCubic } from "../anim/ease";
import { softCircle } from "../textures";
import type { FxProfile } from "./quality";
import type { SigHost } from "./host";
import { streakTex } from "./textures";

/**
 * The signature skills' toolkit: pooled, capped primitives every skill composes its moments from.
 *
 *  - rings and shockwaves on the ground (an ink band under a white-hot line), and upright rings;
 *  - cuts (arcs) and slashes (lines), ink under light;
 *  - streaks: speed lines, the radial smear of bending space, blade trails;
 *  - sprites lent to a skill for its own shapes (cores, blades, eyes), returned when it ends;
 *  - afterimages and stand-in figures: rigs posed once and faded, pooled by kind;
 *  - particles through the shared pool, counts scaled by the quality profile;
 *  - debris spirals drawn inward (particles with a tangential start and an attractor);
 *  - camera push-ins (one owner at a time, always released), hit-stops and flashes through the
 *    renderer's single policies.
 *
 * Nothing here allocates per frame: records are reused, geometry is redrawn only while something
 * lives, and every pool has a hard cap (a request past it is simply not drawn).
 */
export const MAX_RINGS = 40;
export const MAX_CUTS = 32;
export const MAX_STREAKS = 120;
export const MAX_SPRITES = 220;
export const MAX_RIGS = 18;

interface RingRec {
  live: boolean;
  x: number;
  y: number;
  r0: number;
  r1: number;
  squash: number;
  life: number;
  total: number;
  delay: number;
  color: number;
  light: number;
  width: number;
  ground: boolean;
  /** Ease out (a shockwave) or in (a collapse). */
  inward: boolean;
}

interface CutRec {
  live: boolean;
  line: boolean;
  x: number;
  y: number;
  x2: number;
  y2: number;
  r: number;
  a0: number;
  sweep: number;
  squash: number;
  color: number;
  light: number;
  width: number;
  life: number;
  total: number;
  delay: number;
}

interface StreakRec {
  live: boolean;
  s: Sprite;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  len: number;
  width: number;
  life: number;
  total: number;
  delay: number;
  alpha: number;
}

interface RigRec {
  key: string;
  rig: Rig;
  live: boolean;
  /** Afterimage fade (seconds); 0 for a rig a skill drives itself. */
  life: number;
  total: number;
  alpha: number;
}

/** Where a camera push leans and how hard. */
interface Push {
  owner: number;
  t: number;
  tin: number;
  hold: number;
  tout: number;
  zoom: number;
  fx: number;
  fy: number;
}

export class SigKit {
  profile: FxProfile;
  /** Graphics redrawn while anything lives: ground ink and light, upright ink and light. */
  readonly groundInk = new Graphics();
  readonly groundLight = new Graphics();
  readonly fxInk = new Graphics();
  readonly fxLight = new Graphics();
  private readonly rings: RingRec[] = [];
  private readonly cuts: CutRec[] = [];
  private readonly streaks: StreakRec[] = [];
  private readonly streakLayer = new Container();
  private readonly pool: Sprite[] = [];
  private lent = 0;
  private readonly gpool: Graphics[] = [];
  private glent = 0;
  private readonly cpool: Container[] = [];
  private readonly rigs: RigRec[] = [];
  private dirty = false;
  private push: Push | null = null;
  private pushOwner = 0;
  /** Reused emit record: ranges written in place. */
  readonly emitO: EmitOptions & { speed: [number, number]; angle: [number, number]; life: [number, number]; scale: [number, number] } = { x: 0, y: 0, count: 1, texture: softCircle(), color: 0xffffff, speed: [0, 0], angle: [0, 0], life: [0, 0], scale: [0, 0] };
  private readonly target = { x: 0, y: 0, strength: 0 };
  /** Drawn this frame (for the renderer's diagnostics and the governor). */
  drawnRings = 0;

  constructor(
    readonly host: SigHost,
    profile: FxProfile,
  ) {
    this.profile = profile;
    this.groundLight.blendMode = "add";
    this.fxLight.blendMode = "add";
    host.layers.ground.addChild(this.groundInk, this.groundLight);
    host.layers.fx.addChild(this.fxInk, this.streakLayer, this.fxLight);
    for (let i = 0; i < MAX_RINGS; i++) this.rings.push({ live: false, x: 0, y: 0, r0: 0, r1: 0, squash: 0.36, life: 0, total: 1, delay: 0, color: 0, light: 0xffffff, width: 2, ground: true, inward: false });
    for (let i = 0; i < MAX_CUTS; i++) this.cuts.push({ live: false, line: false, x: 0, y: 0, x2: 0, y2: 0, r: 0, a0: 0, sweep: 0, squash: 1, color: 0, light: 0xffffff, width: 2, life: 0, total: 1, delay: 0 });
    for (let i = 0; i < MAX_STREAKS; i++) {
      const s = new Sprite(streakTex());
      s.anchor.set(1, 0.5);
      s.visible = false;
      this.streakLayer.addChild(s);
      this.streaks.push({ live: false, s, x0: 0, y0: 0, x1: 0, y1: 0, len: 0, width: 1, life: 0, total: 1, delay: 0, alpha: 1 });
    }
  }

  get reduced(): boolean {
    return this.profile.reduced;
  }

  /** Particle count for a request at this quality (never below one when anything is asked). */
  n(count: number): number {
    return count <= 0 ? 0 : Math.max(1, Math.round(count * this.profile.particles));
  }

  // ------------------------------------------------------------------ rings and cuts

  /**
   * A ring: on the ground (squashed) or upright. `color` is the ink band (drawn normal), `light`
   * the line inside it (added); either may be -1 for none.
   */
  ring(x: number, y: number, r0: number, r1: number, life: number, color: number, light: number, width: number, o: { squash?: number; delay?: number; ground?: boolean; inward?: boolean } = {}): void {
    for (const r of this.rings) {
      if (r.live) continue;
      r.live = true;
      r.x = x;
      r.y = y;
      r.r0 = r0;
      r.r1 = r1;
      r.life = r.total = Math.max(0.01, life);
      r.color = color;
      r.light = light;
      r.width = width;
      r.squash = o.squash ?? 0.36;
      r.delay = o.delay ?? 0;
      r.ground = o.ground ?? true;
      r.inward = o.inward ?? false;
      this.dirty = true;
      return;
    }
  }

  /** An arc cut (a slash's crescent): ink under light, sweeping as it fades. */
  cut(x: number, y: number, r: number, a0: number, sweep: number, color: number, light: number, width: number, life: number, o: { squash?: number; delay?: number } = {}): void {
    const c = this.freeCut();
    if (!c) return;
    c.line = false;
    c.x = x;
    c.y = y;
    c.r = r;
    c.a0 = a0;
    c.sweep = sweep;
    c.squash = o.squash ?? 1;
    c.color = color;
    c.light = light;
    c.width = width;
    c.life = c.total = life;
    c.delay = o.delay ?? 0;
  }

  /** A straight slash from (x, y) to (x2, y2), drawn in fast and fading from its tail. */
  slash(x: number, y: number, x2: number, y2: number, color: number, light: number, width: number, life: number, delay = 0): void {
    const c = this.freeCut();
    if (!c) return;
    c.line = true;
    c.x = x;
    c.y = y;
    c.x2 = x2;
    c.y2 = y2;
    c.color = color;
    c.light = light;
    c.width = width;
    c.life = c.total = life;
    c.delay = delay;
  }

  private freeCut(): CutRec | null {
    for (const c of this.cuts) {
      if (!c.live) {
        c.live = true;
        this.dirty = true;
        return c;
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ streaks

  /** A streak travelling from (x0, y0) to (x1, y1) over `life`, `len` px long. */
  streak(x0: number, y0: number, x1: number, y1: number, len: number, width: number, color: number, life: number, o: { delay?: number; add?: boolean; alpha?: number } = {}): void {
    for (const r of this.streaks) {
      if (r.live) continue;
      r.live = true;
      r.x0 = x0;
      r.y0 = y0;
      r.x1 = x1;
      r.y1 = y1;
      r.len = len;
      r.width = width;
      r.life = r.total = Math.max(0.01, life);
      r.delay = o.delay ?? 0;
      r.alpha = o.alpha ?? 1;
      r.s.tint = color;
      r.s.blendMode = o.add === false ? "normal" : "add";
      r.s.visible = false;
      return;
    }
  }

  /** Speed lines along a path: `n` parallel streaks through the band around the line from a to b. */
  speedLines(x0: number, y0: number, x1: number, y1: number, n: number, band: number, color: number, life: number): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let i = 0; i < n; i++) {
      const off = (i / Math.max(1, n - 1) - 0.5) * band + (Math.random() - 0.5) * band * 0.3;
      const k0 = Math.random() * 0.3;
      this.streak(x0 + dx * k0 + nx * off, y0 + dy * k0 + ny * off, x1 + nx * off, y1 + ny * off, len * (0.35 + Math.random() * 0.3), 0.6 + Math.random() * 0.6, color, life * (0.7 + Math.random() * 0.3), { delay: i * 0.012 });
    }
  }

  /**
   * The radial smear of bending space: streaks that start out on a ring and rush in to the core,
   * as if the light around the singularity were being pulled through it.
   */
  smear(cx: number, cy: number, r: number, squash: number, n: number, color: number, life: number): void {
    const count = Math.min(n, this.profile.smear);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = r * (0.75 + Math.random() * 0.45);
      const x0 = cx + Math.cos(a) * rr;
      const y0 = cy + Math.sin(a) * rr * squash;
      const x1 = cx + Math.cos(a + 0.5) * r * 0.12;
      const y1 = cy + Math.sin(a + 0.5) * r * 0.12 * squash;
      this.streak(x0, y0, x1, y1, r * 0.45, 0.8 + Math.random() * 0.6, color, life * (0.7 + Math.random() * 0.5), { delay: Math.random() * life * 0.4, alpha: 0.75 });
    }
  }

  // ------------------------------------------------------------------ sprites and rigs

  /** Lend a sprite (anchored at its centre) on a layer; null past the cap. Return it with `free`. */
  sprite(layer: Container, tex: Texture, add: boolean): Sprite | null {
    let s = this.pool.pop();
    if (!s) {
      if (this.lent >= MAX_SPRITES) return null;
      s = new Sprite();
    }
    this.lent += 1;
    s.texture = tex;
    s.anchor.set(0.5);
    s.blendMode = add ? "add" : "normal";
    s.tint = 0xffffff;
    s.alpha = 1;
    s.rotation = 0;
    s.scale.set(1);
    s.skew.set(0, 0);
    s.position.set(0, 0);
    s.zIndex = 0;
    s.visible = true;
    layer.addChild(s);
    return s;
  }

  free(s: Sprite | null): void {
    if (!s || s.destroyed) return;
    s.removeFromParent();
    s.visible = false;
    this.lent -= 1;
    this.pool.push(s);
  }

  get spritesLent(): number {
    return this.lent;
  }

  /** Lend an empty Graphics on a layer (a skill's own shapes); return it with `freeGraphics`. */
  graphics(layer: Container, add = false): Graphics {
    const g = this.gpool.pop() ?? new Graphics();
    g.clear();
    g.blendMode = add ? "add" : "normal";
    g.alpha = 1;
    g.visible = true;
    g.position.set(0, 0);
    g.scale.set(1);
    g.rotation = 0;
    g.zIndex = 0;
    layer.addChild(g);
    this.glent += 1;
    return g;
  }

  freeGraphics(g: Graphics | null): void {
    if (!g || g.destroyed) return;
    g.clear();
    g.removeFromParent();
    this.glent -= 1;
    if (this.gpool.length < 48) this.gpool.push(g);
    else g.destroy();
  }

  /** Lend a container (a skill's assembly of sprites); return it with `freeContainer`. */
  container(layer: Container): Container {
    const c = this.cpool.pop() ?? new Container();
    c.alpha = 1;
    c.visible = true;
    c.position.set(0, 0);
    c.scale.set(1);
    c.rotation = 0;
    c.zIndex = 0;
    layer.addChild(c);
    return c;
  }

  freeContainer(c: Container | null): void {
    if (!c || c.destroyed) return;
    c.removeFromParent();
    // Children are lent sprites/graphics returned by their owners first.
    c.removeChildren();
    if (this.cpool.length < 32) this.cpool.push(c);
    else c.destroy();
  }

  /**
   * Lend a rig of a kind (a clone, a soldier, a stand-in), added to the figures layer. `fade` > 0
   * makes it an afterimage that fades and returns itself; 0 leaves it to the caller (`freeRig`).
   */
  rig(key: string, spec: RigSpec, fade = 0, alpha = 1): Rig | null {
    let rec: RigRec | undefined;
    for (const r of this.rigs) {
      if (!r.live && r.key === key) {
        rec = r;
        break;
      }
    }
    if (!rec) {
      if (this.rigs.length >= MAX_RIGS) {
        // Reuse the oldest idle rig of another kind.
        const idle = this.rigs.findIndex((r) => !r.live);
        if (idle < 0) return null;
        const old = this.rigs[idle]!;
        old.rig.destroy();
        this.rigs.splice(idle, 1);
      }
      const rig = new Rig(spec);
      rec = { key, rig, live: false, life: 0, total: 0, alpha: 1 };
      this.rigs.push(rec);
    }
    rec.live = true;
    rec.life = rec.total = fade;
    rec.alpha = alpha;
    const rig = rec.rig;
    rig.snap();
    rig.root.alpha = alpha;
    rig.root.tint = 0xffffff;
    rig.root.visible = true;
    rig.root.skew.set(0, 0);
    rig.root.rotation = 0;
    rig.shadow.visible = false;
    rig.setWhite(0);
    this.host.layers.figures.addChild(rig.root);
    return rig;
  }

  freeRig(rig: Rig | null): void {
    if (!rig) return;
    for (const r of this.rigs) {
      if (r.rig === rig) {
        r.live = false;
        rig.root.removeFromParent();
        rig.shadow.removeFromParent();
        rig.root.visible = false;
        return;
      }
    }
  }

  get rigsLive(): number {
    let n = 0;
    for (const r of this.rigs) if (r.live) n++;
    return n;
  }

  /**
   * An afterimage of a figure: a rig of `spec` posed once in `state` at (x, y), tinted and fading
   * over `life` (real seconds).
   */
  afterimage(key: string, spec: RigSpec, x: number, y: number, scale: number, facing: 1 | -1, state: "attack" | "dodge" | "windup" | "cast" | "idle", variant: number, tint: number, alpha: number, life: number): void {
    const rig = this.rig(key, spec, life, alpha);
    if (!rig) return;
    rig.animate(state, state === "attack" ? 0.05 : 0.2, 0.25, 0.3, facing, false, 0, 0, 0, variant);
    rig.root.position.set(x, y);
    rig.root.scale.set(scale);
    rig.root.zIndex = 8000;
    rig.root.tint = tint;
  }

  // ------------------------------------------------------------------ particles

  /** Emit through the shared pool at this quality's count. Fill `emitO` first. */
  emit(count: number): void {
    const o = this.emitO;
    o.count = this.n(count);
    if (o.count > 0) this.host.particles.emit(o);
  }

  /** Reset the emit record to plain defaults (callers then set what they need). */
  o(x: number, y: number, tex: Texture, color: number): EmitOptions & { speed: [number, number]; angle: [number, number]; life: [number, number]; scale: [number, number] } {
    const o = this.emitO;
    o.x = x;
    o.y = y;
    o.texture = tex;
    o.color = color;
    o.colors = undefined;
    o.speed[0] = 20;
    o.speed[1] = 80;
    o.angle[0] = -Math.PI;
    o.angle[1] = Math.PI;
    o.life[0] = 0.3;
    o.life[1] = 0.6;
    o.scale[0] = 0.2;
    o.scale[1] = 0.4;
    o.endScale = 0;
    o.alpha = 1;
    o.gravity = 0;
    o.drag = 0.9;
    o.additive = true;
    o.spin = 0;
    o.spread = 0;
    o.target = undefined;
    o.alignToVelocity = false;
    return o;
  }

  /**
   * Debris drawn inward in a spiral: pieces start on a ring moving round it (tangential speed) and
   * an attractor at the centre pulls them in, so each traces a spiral.
   */
  spiral(cx: number, cy: number, r: number, count: number, tex: Texture, color: number, additive: boolean, life: number, strength = 9): void {
    const n = Math.min(this.n(count), this.profile.debris);
    const o = this.o(cx, cy, tex, color);
    this.target.x = cx;
    this.target.y = cy;
    this.target.strength = strength;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = r * (0.7 + Math.random() * 0.5);
      o.x = cx + Math.cos(a) * rr;
      o.y = cy + Math.sin(a) * rr * 0.55;
      // Tangential: perpendicular to the radius, all turning the same way.
      const t = a + Math.PI / 2;
      o.angle[0] = t - 0.15;
      o.angle[1] = t + 0.15;
      o.speed[0] = r * 1.2;
      o.speed[1] = r * 1.8;
      o.life[0] = life * 0.8;
      o.life[1] = life;
      o.scale[0] = 0.18;
      o.scale[1] = 0.42;
      o.endScale = 0.05;
      o.drag = 0.96;
      o.additive = additive;
      o.spin = 6;
      o.target = this.target;
      o.alpha = additive ? 0.9 : 1;
      o.count = 1;
      this.host.particles.emit(o);
    }
    o.target = undefined;
  }

  // ------------------------------------------------------------------ camera, stops, flashes

  /**
   * A camera push-in toward (fx, fy) in base px: in, hold, out (real seconds). One owner at a time;
   * none when the profile has no camera moves, or when another sequence holds the camera.
   */
  pushIn(fx: number, fy: number, zoom: number, tin: number, hold: number, tout: number): number {
    if (this.profile.camera <= 0) return 0;
    const cam = this.host.camera;
    if (!this.push && cam.cine.zoom !== 1) return 0;
    const z = 1 + (zoom - 1) * this.profile.camera;
    this.pushOwner += 1;
    this.push = { owner: this.pushOwner, t: 0, tin, hold, tout, zoom: z, fx, fy };
    return this.pushOwner;
  }

  /** Let go of a push early (its owner ended). */
  releasePush(owner: number): void {
    const p = this.push;
    if (!p || p.owner !== owner) return;
    if (p.t < p.tin + p.hold) p.t = p.tin + p.hold;
  }

  private updatePush(dt: number): void {
    const p = this.push;
    if (!p) return;
    p.t += dt;
    const cam = this.host.camera;
    let k: number;
    if (p.t < p.tin) k = easeOutCubic(p.t / p.tin);
    else if (p.t < p.tin + p.hold) k = 1;
    else k = 1 - easeInCubic(Math.min(1, (p.t - p.tin - p.hold) / Math.max(0.01, p.tout)));
    cam.cine.fx = p.fx;
    cam.cine.fy = p.fy;
    cam.cine.zoom = 1 + (p.zoom - 1) * k;
    if (p.t >= p.tin + p.hold + p.tout) {
      cam.cine.zoom = 1;
      this.push = null;
    }
  }

  /** A one-off shake at a big moment (never constant): none with reduced effects. */
  shake(amount: number): void {
    if (!this.profile.shake || this.reduced) return;
    this.host.camera.shake(amount);
  }

  punch(amount: number): void {
    if (this.profile.camera <= 0) return;
    this.host.camera.punch(amount * this.profile.camera);
  }

  /** A world stop through the hit-stop policy (none with reduced effects). */
  stop(seconds: number, key: string, cooldown = 0.5): void {
    if (this.reduced) return;
    this.host.stop(seconds, key, cooldown);
  }

  flash(color: number, alpha: number, duration: number): boolean {
    if (this.reduced) return false;
    return this.host.flash(color, alpha, duration);
  }

  // ------------------------------------------------------------------ frame

  /** Advance the primitives. `dt` is effect time (it stops in a hit-stop), `realDt` real time. */
  update(dt: number, realDt: number): void {
    this.updatePush(realDt);
    for (const r of this.rigs) {
      if (!r.live || r.total <= 0) continue;
      r.life -= realDt;
      if (r.life <= 0) {
        r.live = false;
        r.rig.root.removeFromParent();
        r.rig.root.visible = false;
        continue;
      }
      const k = r.life / r.total;
      r.rig.root.alpha = r.alpha * k * k;
    }
    for (const r of this.streaks) {
      if (!r.live) continue;
      if (r.delay > 0) {
        r.delay -= dt;
        continue;
      }
      r.life -= dt;
      if (r.life <= 0) {
        r.live = false;
        r.s.visible = false;
        continue;
      }
      const k = 1 - r.life / r.total;
      const e = easeOutCubic(k);
      const hx = r.x0 + (r.x1 - r.x0) * e;
      const hy = r.y0 + (r.y1 - r.y0) * e;
      const ang = Math.atan2(r.y1 - r.y0, r.x1 - r.x0);
      const s = r.s;
      s.visible = true;
      s.position.set(hx, hy);
      s.rotation = ang;
      s.scale.set(Math.max(0.05, (r.len * (1 - k * 0.5)) / 64), r.width);
      s.alpha = r.alpha * Math.min(1, (1 - k) * 2.2);
    }
  }

  /** Redraw the shared geometry; skills draw their own into the same graphics in `paint`. */
  beginPaint(): boolean {
    let any = false;
    for (const r of this.rings) if (r.live) any = true;
    if (!any) for (const c of this.cuts) if (c.live) any = true;
    return any;
  }

  clearPaint(): void {
    this.groundInk.clear();
    this.groundLight.clear();
    this.fxInk.clear();
    this.fxLight.clear();
  }

  /** Draw rings and cuts for this frame (call after `clearPaint`). */
  paint(dt: number): void {
    let n = 0;
    for (const r of this.rings) {
      if (!r.live) continue;
      if (r.delay > 0) {
        r.delay -= dt;
        continue;
      }
      r.life -= dt;
      if (r.life <= 0) {
        r.live = false;
        continue;
      }
      n++;
      const k = 1 - r.life / r.total;
      const e = r.inward ? easeInCubic(k) : easeOutCubic(k);
      const rad = Math.max(0.5, r.r0 + (r.r1 - r.r0) * e);
      const fade = r.inward ? Math.min(1, k * 3) * (1 - k * 0.3) : 1 - k * k;
      const w = Math.max(0.3, r.width * (r.inward ? 0.6 + 0.4 * k : 1 - k * 0.55));
      const ink = r.ground ? this.groundInk : this.fxInk;
      const light = r.ground ? this.groundLight : this.fxLight;
      const ry = Math.max(0.5, rad * r.squash);
      if (r.color >= 0) ink.ellipse(r.x, r.y, rad, ry).stroke({ width: w * 2.6, color: r.color, alpha: 0.75 * fade });
      if (r.light >= 0) light.ellipse(r.x, r.y, rad, ry).stroke({ width: w * 0.7, color: r.light, alpha: 0.95 * fade });
    }
    this.drawnRings = n;
    for (const c of this.cuts) {
      if (!c.live) continue;
      if (c.delay > 0) {
        c.delay -= dt;
        continue;
      }
      c.life -= dt;
      if (c.life <= 0) {
        c.live = false;
        continue;
      }
      const k = 1 - c.life / c.total;
      const e = easeOutCubic(Math.min(1, k * 2.4));
      const tail = Math.max(0, e - 0.4) / 0.6;
      const alpha = 1 - k * k;
      const w = c.width * (1 - k * 0.5);
      if (c.line) {
        const hx = c.x + (c.x2 - c.x) * e;
        const hy = c.y + (c.y2 - c.y) * e;
        const tx = c.x + (c.x2 - c.x) * tail;
        const ty = c.y + (c.y2 - c.y) * tail;
        if (c.color >= 0) this.fxInk.moveTo(tx, ty).lineTo(hx, hy).stroke({ width: w * 2.4, color: c.color, alpha: alpha * 0.85, cap: "round" });
        if (c.light >= 0) this.fxLight.moveTo(tx, ty).lineTo(hx, hy).stroke({ width: w * 0.55, color: c.light, alpha, cap: "round" });
        continue;
      }
      const a1 = c.a0 + c.sweep * e;
      const a0 = c.a0 + c.sweep * tail;
      const lo = Math.min(a0, a1);
      const hi = Math.max(a0, a1);
      if (hi - lo < 0.01) continue;
      // An arc, squashed: drawn as a polyline so it can lie on the ground or stand upright.
      for (let pass = 0; pass < 2; pass++) {
        const g = pass === 0 ? this.fxInk : this.fxLight;
        const col = pass === 0 ? c.color : c.light;
        if (col < 0) continue;
        const steps = 12;
        for (let i = 0; i <= steps; i++) {
          const a = lo + ((hi - lo) * i) / steps;
          const px = c.x + Math.cos(a) * c.r;
          const py = c.y + Math.sin(a) * c.r * c.squash;
          if (i === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.stroke({ width: pass === 0 ? w * 2.4 : w * 0.55, color: col, alpha: pass === 0 ? alpha * 0.85 : alpha, cap: "round", join: "round" });
      }
    }
  }

  /** Anything of the kit's own still running (rings, cuts, streaks, afterimages, a push). */
  get busy(): boolean {
    if (this.push) return true;
    for (const r of this.rings) if (r.live) return true;
    for (const c of this.cuts) if (c.live) return true;
    for (const s of this.streaks) if (s.live) return true;
    for (const r of this.rigs) if (r.live && r.total > 0) return true;
    return false;
  }

  markDirty(): void {
    this.dirty = true;
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  set isDirty(v: boolean) {
    this.dirty = v;
  }

  /** Drop everything in flight (a new world); lent sprites stay with their owners until freed. */
  reset(): void {
    for (const r of this.rings) r.live = false;
    for (const c of this.cuts) c.live = false;
    for (const s of this.streaks) {
      s.live = false;
      s.s.visible = false;
    }
    for (const r of this.rigs) {
      if (r.total > 0) {
        r.live = false;
        r.rig.root.removeFromParent();
      }
    }
    if (this.push) {
      this.host.camera.cine.zoom = 1;
      this.push = null;
    }
    this.clearPaint();
  }

  destroy(): void {
    this.reset();
    for (const r of this.rigs) r.rig.destroy();
    this.rigs.length = 0;
    for (const s of this.pool) s.destroy();
    this.pool.length = 0;
    for (const g of this.gpool) g.destroy();
    this.gpool.length = 0;
    for (const c of this.cpool) c.destroy();
    this.cpool.length = 0;
    for (const s of this.streaks) s.s.destroy();
    this.streaks.length = 0;
    this.streakLayer.destroy();
    this.groundInk.destroy();
    this.groundLight.destroy();
    this.fxInk.destroy();
    this.fxLight.destroy();
  }
}
