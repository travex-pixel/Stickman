import { Container, Graphics, Sprite, Texture } from "pixi.js";
import type { ActionState } from "../../entities/types";
import type { GameEvent } from "../../engine/events";
import type { ApexRanks, ApexSkillId } from "../../data/apex";
import type { WeaponPath } from "../../data/ids";
import type { Camera } from "../Camera";
import type { EmitOptions, ParticleSystem } from "../Particles";
import { fmtNum, type DamageNumbers, type NumberStyle } from "../DamageNumbers";
import type { Rig } from "../rigs/Rig";
import { mix } from "../colors";
import { damp, easeOutCubic } from "../anim/ease";
import { hardCircle, shard, softCircle, spark } from "../textures";
import { BoltPool } from "./lightning";
import { PrismNumbers } from "./PrismNumbers";
import { CROWN_LIGHT, SPECTRUM_DEEP, STORM_BLUE, STORM_VIOLET, spectrum, spectrumList } from "./spectrum";

export type ApexSkill = ApexSkillId;
export type { ApexRanks };

export const NO_APEX: Readonly<ApexRanks> = { double: 0, triple: 0, prism: 0, crown: 0 };

interface Point {
  x: number;
  y: number;
}

/** What the presentation reads off an Apex hit (the `hit` event's own fields). */
export type ApexHitFields = Pick<Extract<GameEvent, { type: "hit" }>, "echo" | "prismatic">;
/** An echo blow lands: from the warrior at `pos` to the target at `targetPos`. */
export type EchoStrikeEvent = Extract<GameEvent, { type: "echo_strike" }>;
/** Stormcrown's bolt: it struck `targetPos` first, then forked to each of `forks`. */
export type StormBoltEvent = Extract<GameEvent, { type: "storm_bolt" }>;

/** The warrior as the renderer last drew him. */
export interface ApexPlayerView {
  rig: Rig;
  drawX: number;
  drawY: number;
  /** Pixels per rig unit at his depth. */
  scale: number;
  zIndex: number;
  facing: 1 | -1;
  state: ActionState;
  swings: number;
  path: WeaponPath;
  seed: number;
  dead: boolean;
}

export interface ApexHost {
  readonly particles: ParticleSystem;
  readonly camera: Camera;
  numbers(): DamageNumbers;
  isReduced(): boolean;
  /** Base px per world unit across the arena. */
  unit(): number;
  /** Chest of a living entity in base px; false when it has gone. */
  chestOf(id: number, out: Point): boolean;
  /** The chest and the feet of a standard figure standing at a world point, in base px. */
  chestAt(x: number, y: number, out: Point): void;
  feetAt(x: number, y: number, out: Point): void;
  /** Drawn height (base px) of an entity, or of a standard figure at depth `y` when it has gone. */
  heightOf(id: number, y: number): number;
  /** The top of the visible frame (base px). */
  visibleTop(): number;
  player(): ApexPlayerView | null;
  /** A full-screen flash through the flash budget; false when refused. */
  flash(color: number, alpha: number, duration: number): boolean;
  /** Bodies within `radius` (base px) of a point catch the light for a moment. */
  rimLight(x: number, y: number, radius: number, level: number): void;
  /** A scorch mark on the ground. */
  scorch(x: number, y: number, r: number): void;
  ring(x: number, y: number, r0: number, r1: number, life: number, color: number, width: number, squash: number, delay?: number): void;
  star(x: number, y: number, size: number, color: number): void;
  /** Hold one body's drawn pose (a local hit-stop). */
  hold(id: number, seconds: number): void;
  /** The warrior's ribbon for this swing goes iridescent. */
  prismTrail(): void;
  /** The backdrop sinks toward a colour for a moment. */
  darken(color: number, amount: number): void;
  cue(kind: "rank" | "max", skill: ApexSkill, rank: number): void;
}

/** Real seconds within which an echo folds into its swing's figure. */
export const MERGE_WINDOW = 0.45;
const MAX_CUTS = 16;
const MAX_FRINGES = 6;
const GHOSTS = 3;
const GHOST_LIFE = 0.13;

interface Cut {
  live: boolean;
  x: number;
  y: number;
  r: number;
  a0: number;
  sweep: number;
  color: number;
  width: number;
  life: number;
  total: number;
}

interface Fringe {
  live: boolean;
  x: number;
  y: number;
  r: number;
  a0: number;
  a1: number;
  life: number;
  total: number;
}

/** A ghost blade: a streak where the next cut of his combo would fall, sweeping as it fades. */
interface Ghost {
  body: Sprite;
  core: Sprite;
  t: number;
  live: boolean;
  alpha: number;
  rot: number;
  sweep: number;
}

/** A swing's one figure: echoes add to it. */
interface FigureRecord {
  id: number;
  t: number;
  handle: number;
  prism: boolean;
  sum: number;
  count: number;
  crit: boolean;
  color: number;
  x: number;
  y: number;
}

/**
 * The presentation of the Apex skills: the echo blows (a ghost of the warrior in the next cut, a
 * storm-blue arc, a lightning cut for the third), prismatic hits (a spectral burst, a chromatic
 * ring, the slash split into colour fringes, an iridescent ribbon, a prismatic figure), the
 * Stormcrown bolt, the warrior's form as the ranks grow, and the rank-up moments. Everything is
 * pooled; the lightning comes from a bank of shapes made once. The renderer hosts it: it hands in
 * coordinates, the particle pool, the flash budget and the warrior's rig, and never lets it touch
 * the world.
 */
export class ApexDirector {
  /** Lightning and arcs above the fighters: a dark under-stroke, then additive light. */
  readonly fx = new Container();
  /** Arcs and fringes, redrawn while they live (the bolts keep their own geometry). */
  private readonly glow = new Graphics();
  /** The warrior's form: behind him (the aura at his feet) and over him (blade, arcs, halo). */
  readonly formFront = new Graphics();
  /**
   * The form's lasting shapes are drawn once and only moved, turned and faded each frame (no
   * geometry per frame): the halo and its tines, the aura at his feet, the blade's two lights.
   * Their colours drift by turning the ring, not by redrawing it.
   */
  private readonly halo = new Container();
  private readonly haloRing = new Graphics();
  private readonly tines = new Graphics();
  private readonly aura = new Container();
  private readonly auraRing = new Graphics();
  private readonly edge = new Sprite();
  private readonly stormLine = new Sprite();
  private formShown = false;
  readonly prism: PrismNumbers;
  private readonly bolts = new BoltPool();
  private readonly cuts: Cut[] = [];
  private readonly fringes: Fringe[] = [];
  private readonly ghosts: Ghost[] = [];
  private readonly recs: FigureRecord[] = [];
  private readonly lastMain = { x: 0, y: 0, t: -Infinity };
  /** One emit record whose ranges are written in place: nothing is allocated per blow. */
  private readonly emitO: EmitOptions & { speed: [number, number]; angle: [number, number]; life: [number, number]; scale: [number, number] } = { x: 0, y: 0, count: 1, texture: hardCircle(), color: 0xffffff, speed: [0, 0], angle: [0, 0], life: [0, 0], scale: [0, 0] };
  private readonly colors: number[] = [];
  private readonly p = { x: 0, y: 0 };
  private readonly q = { x: 0, y: 0 };
  private readonly r = { x: 0, y: 0 };
  private readonly s = { x: 0, y: 0 };
  /** Scratch for the form's crawling arcs: up to two, five points each. */
  private readonly arcPts = new Float32Array(20);
  private arcCount = 0;
  private arcLeft = 0;
  private arcNext = 0;
  private moteAcc = 0;
  /** How alive the form is: 0 at rest, 1 in a combo (eased). */
  private activity = 0;
  private sinceBlow = 9;
  /** A rank-up's swell on the form (1 just bought, easing to 0). */
  private boost = 0;
  private boostSkill: ApexSkill = "double";
  private time = 0;
  private now = 0;
  private fxDirty = false;
  private formDirty = false;
  ranks: ApexRanks = { ...NO_APEX };
  private lastRankUp = -Infinity;
  /** Echo blows folded into a figure already on screen (each one a figure not drawn). */
  merged = 0;

  constructor(
    private readonly host: ApexHost,
    private readonly entityLayer: Container,
  ) {
    this.prism = new PrismNumbers(8);
    this.fx.addChild(this.bolts.container, this.glow);
    entityLayer.addChild(this.formFront);
    this.buildForm();
    entityLayer.addChild(this.aura, this.stormLine, this.edge, this.halo, this.tines);
    for (let i = 0; i < MAX_CUTS; i++) this.cuts.push({ live: false, x: 0, y: 0, r: 0, a0: 0, sweep: 0, color: 0, width: 1, life: 0, total: 1 });
    for (let i = 0; i < MAX_FRINGES; i++) this.fringes.push({ live: false, x: 0, y: 0, r: 0, a0: 0, a1: 0, life: 0, total: 1 });
    for (let i = 0; i < 8; i++) this.recs.push({ id: -1, t: -Infinity, handle: -1, prism: false, sum: 0, count: 0, crit: false, color: 0, x: 0, y: 0 });
  }

  /** The form's static shapes, at a unit size (radius 20); placed and scaled per frame. */
  private buildForm(): void {
    const R = 20;
    // Halo: a faint wide glow and sixteen arcs of the spectrum, in a container squashed to an ellipse.
    const glow = new Graphics();
    glow.circle(0, 0, R).stroke({ width: 3, color: 0xdcd2ff, alpha: 1 });
    glow.alpha = 0.18;
    const seg = 16;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      this.haloRing.arc(0, 0, R, a0, a0 + (Math.PI * 2) / seg + 0.01).stroke({ width: 1.1, color: spectrum(i / seg), alpha: 1 });
    }
    this.halo.addChild(glow, this.haloRing);
    // Five fine tines rising from the ring's back, the middle one tallest (at unit head size).
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * (1.12 + 0.19 * i);
      const px = Math.cos(a) * R;
      const py = Math.sin(a) * R * 0.3;
      const hgt = R * (i === 2 ? 0.58 : i === 1 || i === 3 ? 0.42 : 0.3);
      this.tines.moveTo(px - 0.9, py).lineTo(px, py - hgt).lineTo(px + 0.9, py).closePath().fill({ color: spectrum(0.1 + i * 0.2), alpha: 1 });
    }
    // Aura: a soft fill and twelve deep-coloured dashes, squashed onto the ground.
    const fill = new Graphics();
    fill.circle(0, 0, R * 1.08).fill({ color: 0x6d5bd0, alpha: 0.35 });
    const dashes = 12;
    for (let i = 0; i < dashes; i++) {
      const a0 = (i / dashes) * Math.PI * 2;
      this.auraRing.arc(0, 0, R, a0, a0 + (Math.PI * 2) / dashes - 0.14).stroke({ width: 1.4, color: spectrum(i / dashes, SPECTRUM_DEEP), alpha: 1 });
    }
    this.aura.addChild(fill, this.auraRing);
    // The blade's lights: an iridescent strip and a storm-blue glow line, stretched along it.
    this.edge.texture = prismStrip();
    this.edge.anchor.set(0, 0.5);
    this.stormLine.texture = spark();
    this.stormLine.anchor.set(0, 0.5);
    this.stormLine.tint = STORM_BLUE;
    for (const d of [this.halo, this.tines, this.aura, this.edge, this.stormLine]) d.visible = false;
    for (let i = 0; i < GHOSTS; i++) {
      const body = new Sprite(streak());
      const core = new Sprite(streak());
      body.anchor.set(0, 0.5);
      core.anchor.set(0, 0.5);
      core.tint = 0xffffff;
      body.visible = core.visible = false;
      this.entityLayer.addChild(body, core);
      this.ghosts.push({ body, core, t: 1, live: false, alpha: 0, rot: 0, sweep: 0 });
    }
  }

  setRanks(r: Readonly<ApexRanks> | undefined): void {
    const s = r ?? NO_APEX;
    this.ranks.double = s.double;
    this.ranks.triple = s.triple;
    this.ranks.prism = s.prism;
    this.ranks.crown = s.crown;
  }

  /** Any Apex rank owned (the form draws; otherwise the director only routes figures). */
  get owned(): boolean {
    const r = this.ranks;
    return r.double + r.triple + r.prism + r.crown > 0;
  }

  // -------------------------------------------------------------------------------------------
  // Figures: one per swing; its echoes fold in with a small "×2" / "×3"
  // -------------------------------------------------------------------------------------------

  /**
   * The warrior's blow on a foe, as a figure. A blow of a swing shows its figure; that swing's
   * echoes on the same body add to it (with a mark), a prismatic blow turns it prismatic, and an
   * echo that jumped to another body starts a figure there in the echo's colour.
   */
  figure(targetId: number, amount: number, crit: boolean, apex: ApexHitFields, x: number, y: number, halfW: number, dir: number, color: number, style: NumberStyle): void {
    const now = this.now;
    const echo = apex.echo ?? 0;
    const prismatic = apex.prismatic === true;
    if (echo > 0) {
      const rec = this.find(targetId, now);
      if (rec) {
        rec.sum += amount;
        rec.count = Math.min(9, rec.count + 1);
        rec.crit ||= crit;
        rec.t = now;
        const mark = `×${rec.count}`;
        const markColor = echo === 2 ? STORM_VIOLET : STORM_BLUE;
        if (prismatic && !rec.prism) {
          this.host.numbers().drop(rec.handle);
          rec.prism = true;
          rec.handle = this.prism.show(rec.x, rec.y, halfW, dir, fmtNum(rec.sum), mark, this.stacker);
          this.merged += 1;
          return;
        }
        const ok = rec.prism ? this.prism.amend(rec.handle, fmtNum(rec.sum), mark) : this.host.numbers().amend(rec.handle, fmtNum(rec.sum), mark, markColor);
        if (ok) {
          this.merged += 1;
          return;
        }
      }
    }
    // A new figure: the swing's own blow, or an echo that found a body of its own.
    const rec = this.slot(targetId, now);
    rec.sum = amount;
    rec.count = 1;
    rec.crit = crit;
    rec.prism = prismatic;
    rec.x = x;
    rec.y = y;
    const echoColor = echo === 2 ? 0xe8e0ff : echo === 1 ? 0xd6e6ff : color;
    rec.color = echoColor;
    rec.handle = prismatic ? this.prism.show(x, y, halfW, dir, fmtNum(amount), "", this.stacker) : this.host.numbers().hit(x, y, halfW, dir, fmtNum(amount), crit ? color : echoColor, style, true);
  }

  /** Prismatic figures stack with the ordinary ones. */
  private readonly stacker = (px: number, py: number, half: number, line: number): number => this.host.numbers().stack(px, py, half, line);

  private find(id: number, now: number): FigureRecord | null {
    for (const r of this.recs) if (r.id === id && now - r.t < MERGE_WINDOW) return r;
    return null;
  }

  private slot(id: number, now: number): FigureRecord {
    let pick = this.recs[0]!;
    for (const r of this.recs) {
      if (r.id === id) {
        pick = r;
        break;
      }
      if (r.t < pick.t) pick = r;
    }
    pick.id = id;
    pick.t = now;
    return pick;
  }

  // -------------------------------------------------------------------------------------------
  // The echo blows
  // -------------------------------------------------------------------------------------------

  /** The swing's own blow landed on this body (the point a jumping echo streaks from). */
  noteMainBlow(targetId: number): void {
    if (this.host.chestOf(targetId, this.p)) {
      this.lastMain.x = this.p.x;
      this.lastMain.y = this.p.y;
      this.lastMain.t = this.now;
    }
    this.sinceBlow = 0;
  }

  onEcho(e: EchoStrikeEvent): void {
    const h = this.host;
    const reduced = h.isReduced();
    const u = h.unit();
    const color = e.index === 2 ? STORM_VIOLET : STORM_BLUE;
    this.sinceBlow = 0;
    if (!h.chestOf(e.targetId, this.p)) h.chestAt(e.targetPos.x, e.targetPos.y, this.p);
    const cx = this.p.x;
    const cy = this.p.y;
    const height = h.heightOf(e.targetId, e.targetPos.y);
    const dir: 1 | -1 = e.targetPos.x >= e.pos.x ? 1 : -1;
    // The blade flickers to a new body: a jagged streak from the last one.
    if (e.jumped && this.now - this.lastMain.t < 0.6) {
      this.bolts.spawn(this.lastMain.x, this.lastMain.y, cx, cy, { width: 1.3 + 0.9 * u, color, life: 0.12, spread: 0.32, branches: false });
    }
    // The second blade: a streak where the next cut of his combo would fall.
    this.ghost(color, e.index);
    if (e.index === 1) {
      // Storm blue: a rising arc against the swing's falling one.
      this.cut(cx, cy, height * 0.42, dir === 1 ? 0.95 : Math.PI - 0.95, -1.9 * dir, color, 2.2 + 2 * u, 0.16);
    } else {
      // The third: a white-violet lightning cut across the body, forking where it bites.
      const half = height * 0.42;
      const ang = dir === 1 ? -0.55 : Math.PI + 0.55;
      const ax = cx - Math.cos(ang) * half;
      const ay = cy - Math.sin(ang) * half;
      const bx = cx + Math.cos(ang) * half;
      const by = cy + Math.sin(ang) * half;
      this.bolts.spawn(ax, ay, bx, by, { width: 1.5 + 1.1 * u, color, life: 0.15, spread: 0.55, branches: true });
      if (!reduced) {
        const fl = 16 * u;
        for (let i = 0; i < 2; i++) {
          const a = ang + (i === 0 ? 1.1 : -1.3) + (Math.random() - 0.5) * 0.4;
          this.bolts.spawn(cx, cy, cx + Math.cos(a) * fl, cy + Math.sin(a) * fl, { width: 0.9 + 0.5 * u, color, life: 0.09, spread: 0.6, branches: false, delay: 0.012 });
        }
      }
      // A hair of shudder on the struck body; nothing else stops.
      h.hold(e.targetId, 0.016);
    }
    const o = this.emitO;
    o.x = cx;
    o.y = cy;
    o.count = e.index === 2 ? 5 : 3;
    o.texture = spark();
    o.color = color;
    o.colors = undefined;
    set2(o.speed, 90, 240);
    if (dir === 1) set2(o.angle, -1.2, 0.6);
    else set2(o.angle, Math.PI - 0.6, Math.PI + 1.2);
    set2(o.life, 0.1, 0.22);
    set2(o.scale, 0.3, 0.7);
    o.endScale = 0.1;
    o.alpha = 1;
    o.gravity = 120;
    o.drag = 0.88;
    o.additive = true;
    o.alignToVelocity = true;
    o.spin = 0;
    o.spread = 0;
    h.particles.emit(o);
    o.alignToVelocity = false;
  }

  /**
   * The second blade: a coloured streak from his hand where the next cut of his combo would fall
   * (the blade's angle mirrored), sweeping on through it as it fades over 0.13s. Two sprites from a
   * pool of two, built at mount: an echo ten times a second costs no geometry.
   */
  private ghost(color: number, index: 1 | 2): void {
    const pv = this.host.player();
    if (!pv || pv.dead) return;
    let g: Ghost | undefined;
    for (const c of this.ghosts) {
      if (!c.live) {
        g = c;
        break;
      }
    }
    if (!g) {
      g = this.ghosts[0]!;
      for (const c of this.ghosts) if (c.t > g.t) g = c;
    }
    pv.rig.handPoint(this.r);
    pv.rig.weaponPoints(this.s, this.p);
    const bx = this.s.x - this.r.x;
    const by = this.s.y - this.r.y;
    const len = Math.hypot(bx, by) || 1;
    const ang = Math.atan2(by, bx);
    // Mirrored across the line he faces along: a falling cut answers a rising one.
    const face = pv.facing === 1 ? 0 : Math.PI;
    const rot = 2 * face - ang;
    g.live = true;
    g.t = 0;
    g.alpha = index === 2 ? 0.95 : 0.85;
    g.rot = rot;
    g.sweep = (ang - rot > 0 ? 1 : -1) * 0.7;
    for (const sp of [g.body, g.core]) {
      sp.visible = true;
      sp.position.set(this.r.x, this.r.y);
      sp.rotation = rot;
      sp.width = len * 1.25;
      sp.zIndex = pv.zIndex + 0.25;
    }
    g.body.height = 11 * pv.scale;
    g.core.height = 3.5 * pv.scale;
    g.body.tint = color;
    this.fadeGhost(g);
  }

  private fadeGhost(g: Ghost): void {
    const k = easeOutCubic(g.t);
    const rot = g.rot + g.sweep * k;
    g.body.rotation = rot;
    g.core.rotation = rot;
    g.body.alpha = g.alpha * (1 - k);
    g.core.alpha = g.alpha * (1 - k) * (1 - k);
  }

  private cut(x: number, y: number, r: number, a0: number, sweep: number, color: number, width: number, life: number): void {
    let c: Cut | undefined;
    for (const k of this.cuts) {
      if (!k.live) {
        c = k;
        break;
      }
    }
    if (!c) {
      c = this.cuts[0]!;
      for (const k of this.cuts) if (k.life < c.life) c = k;
    }
    c.live = true;
    c.x = x;
    c.y = y;
    c.r = r;
    c.a0 = a0;
    c.sweep = sweep;
    c.color = color;
    c.width = width;
    c.life = c.total = life;
  }

  // -------------------------------------------------------------------------------------------
  // Prismatic hits
  // -------------------------------------------------------------------------------------------

  /** A prismatic blow at (x, y) (base px), travelling along `dir`. `echo` blows get a smaller burst. */
  onPrism(x: number, y: number, dir: 1 | -1, height: number, echo: boolean): void {
    const h = this.host;
    const reduced = h.isReduced();
    const u = h.unit();
    const k = echo ? 0.6 : 1;
    this.sinceBlow = 0;
    h.prismTrail();
    // A fan of spectral shards along the blow, and a few long rays.
    const o = this.emitO;
    o.x = x;
    o.y = y;
    o.count = Math.round(16 * k);
    o.texture = shard();
    o.colors = spectrumList(6, Math.random(), this.colors);
    set2(o.speed, 180 * k + 60, 460 * k + 60);
    const base = dir === 1 ? 0 : Math.PI;
    set2(o.angle, base - 1.25, base + 1.25);
    set2(o.life, 0.28, 0.55);
    set2(o.scale, 0.3, 0.75);
    o.endScale = 0;
    o.alpha = 1;
    o.gravity = 140;
    o.drag = 0.88;
    o.additive = false;
    o.alignToVelocity = true;
    o.spin = 0;
    o.spread = 0;
    h.particles.emit(o);
    o.additive = true;
    o.count = Math.round(6 * k);
    o.texture = spark();
    set2(o.speed, 520, 760);
    set2(o.life, 0.1, 0.18);
    set2(o.scale, 1.4 * k, 2.4 * k);
    o.endScale = 0.4;
    o.gravity = 0;
    o.drag = 0.8;
    h.particles.emit(o);
    o.alignToVelocity = false;
    o.colors = undefined;
    // A soft bloom of white at the point of contact (local light, not a screen flash).
    o.count = 1;
    o.texture = softCircle();
    o.color = 0xffffff;
    set2(o.speed, 0, 0);
    set2(o.angle, 0, 0);
    set2(o.life, 0.1, 0.12);
    set2(o.scale, 1.2 * k, 1.4 * k);
    o.endScale = 0.5;
    o.alpha = 0.5;
    h.particles.emit(o);
    // A thin chromatic ring: three colours a hair apart (one white ring with reduced effects).
    const r1 = (echo ? 44 : 70) * u * 1.6;
    if (reduced) h.ring(x, y, 4, r1, 0.32, 0xffffff, 2, 1);
    else {
      h.ring(x, y, 4, r1, 0.34, 0x8ff0ff, 2, 1);
      h.ring(x, y, 4, r1 * 0.96, 0.34, 0xffe08f, 2, 1, 0.012);
      h.ring(x, y, 4, r1 * 0.92, 0.34, 0xff9bc8, 2, 1, 0.024);
    }
    h.star(x, y, echo ? 0.9 : 1.35, 0xffffff);
    // The slash split into colour fringes for a few frames.
    if (!reduced) this.fringe(x - dir * height * 0.18, y, height * 0.5, dir);
    if (!echo) h.camera.punch(0.03);
  }

  private fringe(x: number, y: number, r: number, dir: 1 | -1): void {
    let f: Fringe | undefined;
    for (const k of this.fringes) {
      if (!k.live) {
        f = k;
        break;
      }
    }
    if (!f) f = this.fringes[0]!;
    f.live = true;
    f.x = x;
    f.y = y;
    f.r = r;
    // A falling cut through the body along the blow.
    f.a0 = dir === 1 ? -1.15 : Math.PI + 1.15;
    f.a1 = dir === 1 ? 0.95 : Math.PI - 0.95;
    f.life = f.total = 0.1;
  }

  // -------------------------------------------------------------------------------------------
  // Stormcrown
  // -------------------------------------------------------------------------------------------

  onStorm(e: StormBoltEvent): void {
    const h = this.host;
    const reduced = h.isReduced();
    const u = h.unit();
    h.feetAt(e.targetPos.x, e.targetPos.y, this.p);
    const gx = this.p.x;
    const gy = this.p.y;
    h.chestAt(e.targetPos.x, e.targetPos.y, this.q);
    const top = h.visibleTop() - 30;
    // The main channel from above the frame to the ground at the target, with a re-strike.
    this.bolts.spawn(gx + (Math.random() - 0.5) * 70 * u, top, gx, gy, { width: 4 + 3 * u, color: 0xc4b2ff, life: 0.34, branches: true, restrike: !reduced });
    // A thinner second channel beside it, a beat late.
    this.bolts.spawn(gx + (Math.random() - 0.5) * 110 * u, top, gx + (Math.random() - 0.5) * 8 * u, this.q.y, { width: 1.4 + 0.8 * u, color: spectrum(Math.random()), life: 0.2, branches: true, delay: 0.03 });
    // It forks along the ground to each nearby foe, and climbs each one.
    for (let i = 0; i < e.forks.length; i++) {
      const f = e.forks[i]!;
      h.feetAt(f.x, f.y, this.r);
      h.chestAt(f.x, f.y, this.s);
      const d = 0.035 + i * 0.025;
      this.bolts.spawn(gx, gy, this.r.x, this.r.y, { width: 1.6 + 1.1 * u, color: spectrum(0.55 + i * 0.17), life: 0.22, spread: 0.45, branches: true, delay: d });
      this.bolts.spawn(this.r.x, this.r.y, this.s.x, this.s.y, { width: 1.2 + 0.8 * u, color: CROWN_LIGHT, life: 0.14, spread: 0.8, branches: false, delay: d + 0.05 });
      h.scorch(this.r.x, this.r.y, 16 * u);
      h.ring(this.r.x, this.r.y, 4, 46 * u, 0.4, spectrum(0.55 + i * 0.17), 2, 0.42, d + 0.05);
    }
    // The strike: a scorch, rings on the ground, a burst of light and spectral sparks.
    h.scorch(gx, gy, 30 * u);
    h.ring(gx, gy, 6, 120 * u, 0.55, CROWN_LIGHT, 4, 0.42);
    h.ring(gx, gy, 4, 80 * u, 0.42, spectrum(0.66), 2, 0.42, 0.03);
    h.ring(gx, gy, 10 * u, 28 * u, 1.0, 0x5d4a8a, 3, 0.42);
    h.star(this.q.x, this.q.y, 1.5, 0xffffff);
    const o = this.emitO;
    // A pool of light on the ground where it struck, fading with the bolt.
    o.x = gx;
    o.y = gy;
    o.count = 1;
    o.texture = softCircle();
    o.color = 0xb9a8ff;
    o.colors = undefined;
    set2(o.speed, 0, 0);
    set2(o.angle, 0, 0);
    set2(o.life, 0.35, 0.4);
    set2(o.scale, 3.2 * u * 1.6, 3.4 * u * 1.6);
    o.endScale = 1.2;
    o.alpha = 0.55;
    o.gravity = 0;
    o.additive = true;
    o.alignToVelocity = false;
    o.spread = 0;
    h.particles.emit(o);
    o.x = gx;
    o.y = gy - 6;
    o.count = 22;
    o.texture = spark();
    o.colors = spectrumList(6, Math.random(), this.colors);
    set2(o.speed, 220, 560);
    set2(o.angle, -Math.PI * 0.95, -Math.PI * 0.05);
    set2(o.life, 0.18, 0.4);
    set2(o.scale, 0.4, 1.0);
    o.endScale = 0.1;
    o.alpha = 1;
    o.gravity = 520;
    o.drag = 0.9;
    o.additive = true;
    o.alignToVelocity = true;
    o.spin = 0;
    o.spread = 0;
    h.particles.emit(o);
    o.alignToVelocity = false;
    o.colors = undefined;
    // Embers rising off the scorch.
    o.count = 10;
    o.texture = softCircle();
    o.color = 0xb9a8ff;
    set2(o.speed, 20, 70);
    set2(o.angle, -Math.PI * 0.8, -Math.PI * 0.2);
    set2(o.life, 0.6, 1.1);
    set2(o.scale, 0.1, 0.22);
    o.endScale = 0;
    o.gravity = -30;
    o.spread = 30 * u;
    h.particles.emit(o);
    o.spread = 0;
    // The scene is lit: the light lifts it and the backdrop sinks behind the bolt as it fades; bodies
    // nearby catch it. All of it is one flash of the budget's three a second: refused (or with
    // reduced effects) the bolt still reads by its shape, its scorch and its thunder.
    if (!reduced && h.flash(CROWN_LIGHT, 0.24, 0.2)) {
      h.darken(0x232338, 0.3);
      h.rimLight(gx, gy - 40 * u, 300 * u, 0.24);
    }
    h.camera.shake(0.32);
    h.camera.punch(0.035);
    this.sinceBlow = 0;
  }

  // -------------------------------------------------------------------------------------------
  // Rank-ups
  // -------------------------------------------------------------------------------------------

  /**
   * A rank bought from the menu: a short flourish on the warrior (under a second; the fight runs
   * on). A first rank or a maxed skill is the larger moment.
   */
  rankUp(skill: ApexSkill, rank: number, maxed: boolean): void {
    const h = this.host;
    const pv = h.player();
    if (!pv) return;
    const reduced = h.isReduced();
    const big = maxed || rank <= 1;
    // Held to keep buying, ranks can come several a second: the small moment plays at most every
    // quarter second (its stinger still climbs); a large one always plays.
    if (!big && this.now - this.lastRankUp < 0.25) {
      h.cue("rank", skill, rank);
      return;
    }
    this.lastRankUp = this.now;
    const color = skill === "double" ? STORM_BLUE : skill === "triple" ? STORM_VIOLET : skill === "prism" ? spectrum(Math.random()) : CROWN_LIGHT;
    const x = pv.drawX;
    const y = pv.drawY;
    const height = pv.rig.top * pv.scale;
    this.boost = big ? 1.4 : 1;
    this.boostSkill = skill;
    this.sinceBlow = 0;
    h.ring(x, y, 6, height * (big ? 1.2 : 0.8), big ? 0.7 : 0.5, color, big ? 4 : 3, 0.42);
    if (big) {
      h.ring(x, y, 6, height * 0.9, 0.6, skill === "crown" || skill === "prism" ? spectrum(0.15) : 0xffffff, 2, 0.42, 0.08);
      h.ring(x, y, 6, height * 0.65, 0.5, skill === "crown" || skill === "prism" ? spectrum(0.6) : color, 2, 0.42, 0.16);
    }
    // Motes climb his body: the skill's colour, the spectrum for the prismatic two.
    const o = this.emitO;
    o.x = x;
    o.y = y - height * 0.35;
    o.count = big ? 26 : 14;
    o.texture = softCircle();
    o.colors = skill === "prism" || skill === "crown" ? spectrumList(6, 0, this.colors) : undefined;
    o.color = color;
    set2(o.speed, 40, big ? 170 : 110);
    set2(o.angle, -Math.PI * 0.85, -Math.PI * 0.15);
    set2(o.life, 0.45, 0.9);
    set2(o.scale, 0.12, 0.3);
    o.endScale = 0;
    o.alpha = 0.95;
    o.gravity = -60;
    o.drag = 0.9;
    o.additive = true;
    o.spin = 0;
    o.spread = height * 0.4;
    h.particles.emit(o);
    o.spread = 0;
    o.colors = undefined;
    pv.rig.weaponPoints(this.p, this.q);
    h.star(this.p.x, this.p.y, big ? 1.2 : 0.8, 0xffffff);
    if (big && (skill === "triple" || skill === "crown")) {
      // The storm answers: a bolt from above onto his blade.
      this.bolts.spawn(this.p.x + (Math.random() - 0.5) * 40, h.visibleTop() - 30, this.p.x, this.p.y, { width: 2.4 + 1.4 * h.unit(), color: skill === "crown" ? CROWN_LIGHT : STORM_VIOLET, life: 0.26, branches: true, restrike: !reduced, delay: 0.05 });
    }
    if (big && (skill === "prism" || skill === "crown")) this.onPrismBurstAt(this.p.x, this.p.y);
    if (big && !reduced) h.flash(skill === "crown" ? CROWN_LIGHT : 0xf0eadc, 0.14, 0.25);
    h.cue(big ? "max" : "rank", skill, rank);
  }

  private onPrismBurstAt(x: number, y: number): void {
    const o = this.emitO;
    o.x = x;
    o.y = y;
    o.count = 18;
    o.texture = shard();
    o.colors = spectrumList(6, Math.random(), this.colors);
    set2(o.speed, 160, 360);
    set2(o.angle, -Math.PI, Math.PI);
    set2(o.life, 0.3, 0.6);
    set2(o.scale, 0.3, 0.7);
    o.endScale = 0;
    o.alpha = 1;
    o.gravity = 60;
    o.drag = 0.88;
    o.additive = true;
    o.alignToVelocity = true;
    this.host.particles.emit(o);
    o.alignToVelocity = false;
    o.colors = undefined;
  }

  // -------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------

  /** Advance the effects: `dt` stops in a hit-stop, `realDt` does not. */
  update(dt: number, realDt: number): void {
    this.now += realDt;
    this.time += realDt;
    this.sinceBlow += realDt;
    this.prism.update(realDt);
    // Ghosts fade in real time.
    for (const g of this.ghosts) {
      if (!g.live) continue;
      g.t = Math.min(1, g.t + realDt / GHOST_LIFE);
      this.fadeGhost(g);
      if (g.t >= 1) {
        g.live = false;
        g.body.visible = false;
        g.core.visible = false;
      }
    }
    if (this.bolts.live > 0) this.bolts.update(dt);
    // Arcs and fringes are redrawn only while one lives.
    if (!this.anyCut() && !this.anyFringe()) {
      if (this.fxDirty) {
        this.glow.clear();
        this.fxDirty = false;
      }
      return;
    }
    const glow = this.glow;
    glow.clear();
    this.fxDirty = true;
    for (const c of this.cuts) {
      if (!c.live) continue;
      c.life -= dt;
      if (c.life <= 0) {
        c.live = false;
        continue;
      }
      const k = 1 - c.life / c.total;
      const e = easeOutCubic(Math.min(1, k * 2.2));
      const a0 = c.a0 + c.sweep * Math.max(0, e - 0.45);
      const a1 = c.a0 + c.sweep * e;
      const lo = Math.min(a0, a1);
      const hi = Math.max(a0, a1);
      if (hi - lo < 0.01) continue;
      const alpha = 1 - k * k;
      glow.arc(c.x, c.y, c.r, lo, hi).stroke({ width: c.width * 2.6 * (1 - k * 0.5), color: c.color, alpha: alpha * 0.3, cap: "round" });
      glow.arc(c.x, c.y, c.r, lo, hi).stroke({ width: c.width * (1 - k * 0.5), color: c.color, alpha: alpha * 0.9, cap: "round" });
      glow.arc(c.x, c.y, c.r * 0.97, lo, hi).stroke({ width: c.width * 0.35, color: 0xffffff, alpha, cap: "round" });
    }
    for (const f of this.fringes) {
      if (!f.live) continue;
      f.life -= dt;
      if (f.life <= 0) {
        f.live = false;
        continue;
      }
      const k = 1 - f.life / f.total;
      const alpha = 1 - k;
      const off = 2.5 + 4 * k;
      const lo = Math.min(f.a0, f.a1);
      const hi = Math.max(f.a0, f.a1);
      // Cyan ahead, rose behind, white between: the cut seen through a prism.
      glow.arc(f.x - off, f.y - off * 0.4, f.r, lo, hi).stroke({ width: 3.2, color: 0x6fe8ff, alpha: alpha * 0.85, cap: "round" });
      glow.arc(f.x + off, f.y + off * 0.4, f.r, lo, hi).stroke({ width: 3.2, color: 0xff7fb8, alpha: alpha * 0.85, cap: "round" });
      glow.arc(f.x, f.y, f.r, lo, hi).stroke({ width: 2.2, color: 0xfff6d8, alpha, cap: "round" });
    }
  }

  private anyCut(): boolean {
    for (const c of this.cuts) if (c.live) return true;
    return false;
  }

  private anyFringe(): boolean {
    for (const f of this.fringes) if (f.live) return true;
    return false;
  }

  /**
   * The warrior's form, by the ranks he owns: storm motes on the blade (Double Strike), arcs
   * crawling over blade and arm in a combo (Triple Strike), an iridescent edge on the blade
   * (Prismatic Edge), and with Stormcrown a thin prismatic crown, a slow aura at his feet and a
   * cape that catches colour. Quiet at rest, alive in a fight.
   */
  updateForm(realDt: number): void {
    const pv = this.host.player();
    const r = this.ranks;
    const front = this.formFront;
    if (!pv || pv.dead || !this.owned) {
      if (this.formDirty) {
        front.clear();
        this.formDirty = false;
      }
      pv?.rig.setCapeTint(0xffffff);
      if (this.formShown) {
        for (const d of [this.halo, this.tines, this.aura, this.edge, this.stormLine]) d.visible = false;
        this.formShown = false;
      }
      return;
    }
    this.formShown = true;
    if (this.formDirty) {
      front.clear();
      this.formDirty = false;
    }
    const reduced = this.host.isReduced();
    const striking = pv.state === "windup" || pv.state === "attack" || pv.state === "recover";
    this.activity = damp(this.activity, striking || this.sinceBlow < 0.8 ? 1 : 0, striking ? 14 : 3, realDt);
    this.boost = Math.max(0, this.boost - realDt * 1.6);
    const act = Math.min(1.4, this.activity + this.boost);
    const t = this.time;
    const sc = pv.scale;
    front.zIndex = pv.zIndex + 0.3;
    this.halo.zIndex = this.tines.zIndex = this.edge.zIndex = this.stormLine.zIndex = pv.zIndex + 0.3;
    this.aura.zIndex = pv.zIndex - 0.5;
    const rig = pv.rig;
    const hand = this.p;
    const tip = this.q;
    rig.handPoint(hand);
    rig.weaponPoints(tip, this.r);
    const bx = tip.x - hand.x;
    const by = tip.y - hand.y;
    const blen = Math.hypot(bx, by) || 1;
    const nx = -by / blen;
    const ny = bx / blen;
    // Storm motes: a few at rest, more in a fight; prismatic once he wears the crown.
    if (r.double > 0 && realDt > 0) {
      this.moteAcc += realDt * (0.9 + 0.12 * r.double) * (1 + 2.2 * act) * (reduced ? 0.5 : 1);
      while (this.moteAcc >= 1) {
        this.moteAcc -= 1;
        const k = 0.15 + Math.random() * 0.85;
        const o = this.emitO;
        o.x = hand.x + bx * k + (Math.random() - 0.5) * 4;
        o.y = hand.y + by * k + (Math.random() - 0.5) * 4;
        o.count = 1;
        o.texture = softCircle();
        o.color = r.crown > 0 ? spectrum(t * 0.3 + Math.random()) : STORM_BLUE;
        o.colors = undefined;
        set2(o.speed, 6, 22);
        set2(o.angle, -Math.PI * 0.8, -Math.PI * 0.2);
        set2(o.life, 0.5, 0.95);
        set2(o.scale, 0.08 * sc * 2, 0.15 * sc * 2);
        o.endScale = 0;
        o.alpha = 0.85;
        o.gravity = -14;
        o.drag = 0.94;
        o.additive = true;
        o.spin = 0;
        o.spread = 0;
        this.host.particles.emit(o);
      }
    }
    const bladeAng = Math.atan2(by, bx);
    // Double Strike: a faint storm-blue light along the blade.
    const sl = this.stormLine;
    sl.visible = r.double > 0;
    if (sl.visible) {
      sl.position.set(hand.x + bx * 0.08, hand.y + by * 0.08);
      sl.rotation = bladeAng;
      sl.width = blen * 1.02;
      sl.height = 9 * sc;
      sl.alpha = 0.25 + 0.04 * Math.min(10, r.double) * (0.5 + 0.5 * Math.min(1, act));
    }
    // The aura at his feet (Stormcrown): a slow ring of colour, faint at rest.
    const au = this.aura;
    au.visible = r.crown > 0;
    if (au.visible) {
      const rx = 28 * sc;
      au.position.set(pv.drawX, pv.drawY + 1);
      au.scale.set(rx / 20, (rx * 0.3) / 20);
      this.auraRing.rotation = reduced ? 0 : t * 0.45;
      au.alpha = 0.4 + 0.35 * Math.min(1, act);
    }
    // The iridescent edge (Prismatic Edge): a thin strip of colour along the blade's edge.
    const ed = this.edge;
    ed.visible = r.prism > 0;
    if (ed.visible) {
      const off = 1.4 * sc;
      ed.position.set(hand.x + bx * 0.1 + nx * off, hand.y + by * 0.1 + ny * off);
      ed.rotation = bladeAng;
      ed.width = blen * 0.9;
      ed.height = 1.6 * sc + 0.5;
      ed.alpha = Math.min(0.95, (0.4 + 0.05 * r.prism) * (0.6 + 0.4 * Math.min(1, act)));
    }
    // Arcs crawling over blade and arm (Triple Strike), only in a fight.
    if (r.triple > 0) {
      this.arcLeft -= realDt;
      this.arcNext -= realDt;
      if (this.arcNext <= 0) {
        this.arcNext = 0.05 + Math.random() * 0.05;
        this.arcCount = 0;
        const chance = (0.3 + 0.05 * r.triple) * Math.min(1, act) * (reduced ? 0.5 : 1);
        if (Math.random() < chance) this.makeArcs(rig, hand, bx, by, nx, ny, sc);
      }
      if (this.arcLeft > 0) {
        this.formDirty = true;
        for (let a = 0; a < this.arcCount; a++) {
          const o = a * 10;
          for (let pass = 0; pass < 2; pass++) {
            front.moveTo(this.arcPts[o]!, this.arcPts[o + 1]!);
            for (let i = 1; i < 5; i++) front.lineTo(this.arcPts[o + i * 2]!, this.arcPts[o + i * 2 + 1]!);
            front.stroke(pass === 0 ? { width: 2.6, color: STORM_VIOLET, alpha: 0.35, cap: "round", join: "round" } : { width: 0.9, color: 0xffffff, alpha: 0.95, cap: "round", join: "round" });
          }
        }
      }
    }
    // The crown (Stormcrown): a thin prismatic halo with five fine tines, over his head.
    const crown = r.crown > 0;
    this.halo.visible = crown;
    this.tines.visible = crown;
    if (crown) {
      const head = rig.crownPoint(this.s);
      const cx = this.s.x;
      const cy = this.s.y - head * 0.15 + Math.sin(t * 1.6) * 0.6;
      const k = (head * 1.3) / 20;
      this.halo.position.set(cx, cy);
      this.halo.scale.set(k, k * 0.3);
      // The colours run round the ring (slower with reduced effects).
      this.haloRing.rotation = t * (reduced ? 0.2 : 0.9);
      this.halo.alpha = 0.85 + 0.15 * Math.min(1, act);
      this.tines.position.set(cx, cy);
      this.tines.scale.set(k);
      this.tines.alpha = 0.9;
      // The cape catches the colour, slowly.
      rig.setCapeTint(mix(0xffffff, spectrum(t * 0.08), 0.35));
    } else rig.setCapeTint(0xffffff);
  }

  /** Two arcs: one along the blade, one from the hand up the forearm. */
  private makeArcs(rig: Rig, hand: Point, bx: number, by: number, nx: number, ny: number, sc: number): void {
    const pts = this.arcPts;
    const jit = 2.6 * sc;
    const t0 = 0.12 + Math.random() * 0.45;
    const t1 = t0 + 0.25 + Math.random() * 0.3;
    for (let i = 0; i < 5; i++) {
      const k = t0 + ((t1 - t0) * i) / 4;
      const j = i === 0 || i === 4 ? 0 : (Math.random() - 0.5) * 2 * jit;
      pts[i * 2] = hand.x + bx * k + nx * j;
      pts[i * 2 + 1] = hand.y + by * k + ny * j;
    }
    this.arcCount = 1;
    if (Math.random() < 0.6) {
      rig.elbowPoint(this.r);
      const ex = this.r.x;
      const ey = this.r.y;
      const ax = ex - hand.x;
      const ay = ey - hand.y;
      const al = Math.hypot(ax, ay) || 1;
      const anx = -ay / al;
      const any = ax / al;
      const e = 0.4 + Math.random() * 0.5;
      for (let i = 0; i < 5; i++) {
        const k = (e * i) / 4;
        const j = i === 0 || i === 4 ? 0 : (Math.random() - 0.5) * 2 * jit;
        pts[10 + i * 2] = hand.x + ax * k + anx * j;
        pts[10 + i * 2 + 1] = hand.y + ay * k + any * j;
      }
      this.arcCount = 2;
    }
    this.arcLeft = 0.05;
  }

  /** Bolts drawn this frame (for the cost check). */
  get liveBolts(): number {
    return this.bolts.live;
  }

  /** A new world: everything in flight is dropped. */
  reset(): void {
    this.bolts.clear();
    for (const c of this.cuts) c.live = false;
    for (const f of this.fringes) f.live = false;
    for (const g of this.ghosts) {
      g.live = false;
      g.body.visible = false;
      g.core.visible = false;
    }
    for (const r of this.recs) {
      r.id = -1;
      r.t = -Infinity;
    }
    this.prism.clear();
    this.glow.clear();
    this.formFront.clear();
    this.fxDirty = false;
    this.formDirty = false;
    this.lastMain.t = -Infinity;
  }

  destroy(): void {
    for (const g of this.ghosts) {
      g.body.destroy();
      g.core.destroy();
    }
    this.ghosts.length = 0;
    streakTexture?.destroy(true);
    streakTexture = null;
    this.prism.destroy();
    this.fx.destroy({ children: true });
    this.formFront.destroy();
    for (const d of [this.halo, this.tines, this.aura, this.edge, this.stormLine]) d.destroy({ children: true });
    stripTexture?.destroy(true);
    stripTexture = null;
  }
}

let stripTexture: Texture | null = null;
let streakTexture: Texture | null = null;

/** A blade's streak: rising from the hand, brightest two thirds along, gone at the tip; soft across. Made once. */
function streak(): Texture {
  if (streakTexture && !streakTexture.destroyed) return streakTexture;
  if (typeof document === "undefined") return Texture.WHITE;
  const w = 64;
  const h = 16;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return Texture.WHITE;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const v = (y - (h - 1) / 2) / ((h - 1) / 2);
    const across = Math.exp(-v * v * 3.2);
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      const along = u < 0.68 ? Math.pow(u / 0.68, 1.4) : Math.pow((1 - u) / 0.32, 0.8);
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * along * across);
    }
  }
  ctx.putImageData(img, 0, 0);
  streakTexture = Texture.from(c);
  return streakTexture;
}

/** A strip of the deep spectrum along its length, soft at both ends (the blade's iridescent edge). Made once. */
function prismStrip(): Texture {
  if (stripTexture && !stripTexture.destroyed) return stripTexture;
  if (typeof document === "undefined") return Texture.WHITE;
  const w = 64;
  const h = 4;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return Texture.WHITE;
  for (let x = 0; x < w; x++) {
    const u = x / (w - 1);
    const col = spectrum(u * 1.2, SPECTRUM_DEEP);
    const a = Math.min(1, u / 0.12, (1 - u) / 0.1);
    ctx.fillStyle = `rgba(${(col >> 16) & 255},${(col >> 8) & 255},${col & 255},${a.toFixed(3)})`;
    ctx.fillRect(x, 0, 1, h);
  }
  stripTexture = Texture.from(c);
  return stripTexture;
}

function set2(a: [number, number], x: number, y: number): void {
  a[0] = x;
  a[1] = y;
}
