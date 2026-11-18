import type { Graphics } from "pixi.js";
import type { Vec2 } from "../../../engine/math";
import { curvePoint, devourerCurve } from "../../../signatures/geometry";
import { easeOutBack, easeOutCubic } from "../../anim/ease";
import { shard, softCircle } from "../../textures";
import { CRIMSON, GILT, GILT_HOT } from "../palette";
import { Stage, type SigBeatEvent, type SigHitEvent, type SigSynergyEvent } from "../stage";
import { smokeTex } from "../textures";
import { SerpentPath, type Dragon } from "./dragon";

/**
 * ABYSSAL DEVOURER: a portal tears at the field's edge and a serpent dragon of ink sweeps through.
 *
 *   portal       a vertical rift rips open where the dragon will enter the frame (ink inside, a jagged
 *                crimson-violet lip, turning streaks, sparks); the field dims; the camera leans in.
 *   pass         the dragon pours out of the rift and winds across the field. Its head follows the
 *                simulation's own curve (signatures/geometry.ts: from the edge, through the cast's
 *                centre, to the far edge, in the pass's time), so it is drawn where it bites; every
 *                segment of the body follows the head's path, with a serpentine wave in it and a
 *                ripple down it. The jaw opens as a foe comes near and snaps shut on each bite (crimson
 *                crescents, ink spray); smoke trails off its back; a second rift swallows it, tail last.
 *   feed         (Soul Feeder) a soul is torn from the fallen into the maw; the eyes and a light
 *                running down the spine burn brighter with each.
 *   second_pass  (Ancient Devourer, or a crowned cast) it climbs out of the frame, turns, and dives
 *                from above onto the strongest knot left; `impact` is its landing.
 *
 * World Eater is larger and sweeps the whole depth. Gravity Feast: its curve already bends through
 * the singularity; as the head crosses it the jaws snap three times in a violet-crimson whirl. Master
 * grows a full mane of fins; Grandmaster gilds horns, fins and whiskers; a crowned cast wears a crown.
 */
const FLIGHT = 64;
/** Samples of the simulation's curve. */
const SAMPLES = 90;

export class DevourerStage extends Stage {
  private dragon: Dragon | null = null;
  private readonly path = new SerpentPath();
  private readonly raw: number[] = [];
  /** Head arc distance; -1 before the pass. */
  private headS = -1;
  /** The pass: its time, length (world s), and the raw index where the sampled curve ends. */
  private passT = -1;
  private passD = 1.25;
  private passEnd = SAMPLES;
  private speed = 0;
  private time = 0;
  private size = 1;
  /** Visible window along the path (between the rifts). */
  private sMin = 0;
  private sMax = Infinity;
  private portalG: Graphics | null = null;
  private exitG: Graphics | null = null;
  private readonly rift = { x: 0, y: 0, k: 0, open: false, on: false };
  private readonly exit = { x: 0, y: 0, k: 0, open: false, on: false };
  private feeds = 0;
  private smokeT = 0;
  private biteT = 0;
  private pushId = 0;
  private readonly snaps: number[] = [];
  private readonly hero = { x: 0, y: 0, r: 0 };
  private readonly pt = { x: 0, y: 0 };
  private readonly cp = { x: 0, y: 0, a: 0 };

  constructor(...a: ConstructorParameters<typeof Stage>) {
    super(...a);
    this.cinematic = true;
    this.tail = 1.6;
    const fs = this.host.proj.fs(75);
    this.size = fs * (this.evo === "world_eater" ? 1.75 : 1.32) * (this.compact ? 0.8 : 1);
  }

  private flightY(wy: number): number {
    const pr = this.host.proj;
    return pr.sy(wy) - FLIGHT * pr.fs(Math.max(0, Math.min(150, wy)));
  }

  onBeat(e: SigBeatEvent): void {
    switch (e.beat) {
      case "portal":
        this.portal(e.from);
        break;
      case "pass":
        this.startPass(e);
        break;
      case "feed":
        this.feed(e.from);
        break;
      case "second_pass":
        this.secondPass(e);
        break;
      case "impact":
        this.landing(e.from, e.radius || 80);
        break;
      default:
        break;
    }
  }

  override onSynergy(e: SigSynergyEvent): void {
    if (e.synergy !== "gravity_feast") return;
    const pr = this.host.proj;
    const x = pr.sx(e.pos.x);
    const y = this.flightY(e.pos.y);
    this.svc.label("Gravity Feast", x, y - 70 * this.u, 0xe8c0ff);
    // The jaws snap three times in a whirl of violet and crimson at the singularity.
    this.snaps.push(0, 0.07, 0.14);
    this.kit.ring(x, y, 4, 70 * this.u, 0.45, this.pal.deep, 0xe8c0ff, 4, { ground: false, squash: 0.6 });
    this.kit.spiral(x, y, 50 * this.u, 12, softCircle(), CRIMSON, true, 0.45, 16);
    this.kit.spiral(x, y, 70 * this.u, 10, shard(), this.pal.ink, false, 0.5, 12);
    this.kit.punch(0.02);
  }

  override onHit(e: SigHitEvent): void {
    if (e.sig !== "abyssal_devourer" || this.biteT > 0) return;
    this.biteT = 0.07;
    const d = this.dragon;
    if (d && d.headPos.visible) {
      this.bite(d.mouth.x, d.mouth.y, e.targetId);
      d.jawOpen = 0;
    } else {
      const c = this.chestAt(e.pos, this.pt);
      this.bite(c.x, c.y, e.targetId);
    }
  }

  /** The rift where the dragon enters (moved to where its path comes into the frame at the pass). */
  private portal(from: Vec2): void {
    const pr = this.host.proj;
    const margin = 52 * this.u;
    this.rift.x = Math.min(pr.right() - margin, Math.max(pr.left() + margin, pr.sx(from.x)));
    this.rift.y = this.flightY(Math.max(20, Math.min(130, from.y)));
    this.rift.on = true;
    this.rift.open = true;
    this.rift.k = 0;
    if (!this.portalG) this.portalG = this.graphics(this.host.layers.fx);
    const k = this.kit;
    if (!this.compact) {
      this.host.darken(0x120e1c, 0.32);
      const c = this.ground(this.cast.center, this.p);
      this.pushId = k.pushIn((c.x + this.rift.x) / 2, c.y - 50 * this.u, 1.07, 0.35, 1.4, 0.6);
    }
    this.riftSparks(this.rift.x, this.rift.y);
  }

  private riftSparks(x: number, y: number): void {
    const o = this.kit.o(x, y, shard(), CRIMSON);
    o.speed[0] = 40;
    o.speed[1] = 160;
    o.life[0] = 0.3;
    o.life[1] = 0.6;
    o.scale[0] = 0.15;
    o.scale[1] = 0.35;
    o.alignToVelocity = true;
    o.spread = 30 * this.size;
    this.kit.emit(12);
  }

  private acquireDragon(): void {
    if (this.dragon) return;
    const pal = this.pal;
    this.dragon = this.svc.dragon({
      size: this.size,
      segments: this.compact ? 12 : this.profile.dragonSegments,
      deep: pal.deep,
      mid: pal.mid,
      rim: pal.glow,
      eye: CRIMSON,
      gilded: this.gilded,
      crowned: this.enhanced,
      mane: this.master && !this.compact,
    });
  }

  private startPass(e: SigBeatEvent): void {
    this.acquireDragon();
    const pr = this.host.proj;
    const curve = devourerCurve(e.from, this.cast.center, e.to);
    const raw = this.raw;
    raw.length = 0;
    // A lead-in behind the start (inside the portal), then the simulation's curve sampled evenly in
    // its time, then a run-out past the end (into the exit, or up and away for a turn).
    const p = this.pt;
    curvePoint(curve, 0, p);
    const x0 = pr.sx(p.x);
    const y0 = this.flightY(p.y);
    curvePoint(curve, 0.02, p);
    const dx = pr.sx(p.x) - x0;
    const dy = this.flightY(p.y) - y0;
    const dl = Math.hypot(dx, dy) || 1;
    for (let i = 6; i >= 1; i--) raw.push(x0 - (dx / dl) * i * 14 * this.size, y0 - (dy / dl) * i * 14 * this.size);
    const lead = raw.length / 2;
    for (let k = 0; k <= SAMPLES; k++) {
      curvePoint(curve, k / SAMPLES, p);
      raw.push(pr.sx(p.x), this.flightY(p.y));
    }
    this.passEnd = lead + SAMPLES;
    const ex = raw[raw.length - 2]!;
    const ey = raw[raw.length - 1]!;
    const tx = ex - raw[raw.length - 4]!;
    const ty = ey - raw[raw.length - 3]!;
    const tl = Math.hypot(tx, ty) || 1;
    const turn = this.evo === "ancient_devourer" || this.enhanced;
    if (turn) {
      // Up and out of the frame, curling back the way it came, for the dive.
      for (let i = 1; i <= 14; i++) {
        const a = (i / 14) * Math.PI * 0.9;
        raw.push(ex + (tx / tl) * Math.sin(a) * 90 * this.size, ey - (1 - Math.cos(a)) * 140 * this.size);
      }
    } else {
      for (let i = 1; i <= 30; i++) raw.push(ex + (tx / tl) * i * 14 * this.size, ey + (ty / tl) * i * 14 * this.size);
    }
    this.path.buildRaw(raw, (this.evo === "world_eater" ? 16 : 12) * this.size, 150 * this.size, this.castId * 0.7);
    // The rifts sit where the path enters and leaves the visible frame.
    const margin = 52 * this.u;
    const left = pr.left() + margin;
    const right = pr.right() - margin;
    let sIn = this.path.lengthAt(lead);
    let sOut = this.path.lengthAt(this.passEnd);
    for (let i = lead; i <= this.passEnd; i++) {
      const x = this.path.xs[i]!;
      if (x >= left && x <= right) {
        sIn = this.path.len[i]!;
        break;
      }
    }
    for (let i = this.passEnd; i >= lead; i--) {
      const x = this.path.xs[i]!;
      if (x >= left && x <= right) {
        sOut = this.path.len[i]!;
        break;
      }
    }
    this.path.at(sIn, this.cp);
    const moved = Math.hypot(this.rift.x - this.cp.x, this.rift.y - this.cp.y) > 4;
    this.rift.x = this.cp.x;
    this.rift.y = this.cp.y;
    this.rift.on = true;
    this.rift.open = true;
    if (moved) this.riftSparks(this.rift.x, this.rift.y);
    if (!this.portalG) this.portalG = this.graphics(this.host.layers.fx);
    this.sMin = sIn;
    if (!turn) {
      this.path.at(sOut, this.cp);
      this.exit.x = this.cp.x;
      this.exit.y = this.cp.y;
      this.sMax = sOut;
    } else this.sMax = Infinity;
    this.passT = 0;
    this.passD = Math.max(0.4, e.duration || 1.25);
    this.headS = this.path.lengthAt(lead);
    this.speed = (this.path.lengthAt(this.passEnd) - this.path.lengthAt(lead)) / this.passD;
  }

  private secondPass(e: SigBeatEvent): void {
    this.acquireDragon();
    const pr = this.host.proj;
    const aim = this.chestAt(e.to, this.q);
    const raw = this.raw;
    const fromX = pr.sx(e.from.x);
    const top = pr.top();
    // From high above, down onto the group, and up out of the frame again.
    const ax = raw.length > 1 ? raw[raw.length - 2]! : fromX;
    const ay = raw.length > 1 ? raw[raw.length - 1]! : top - 200;
    if (raw.length === 0) raw.push(ax, ay);
    const legs: [number, number][] = [
      [(ax + fromX) / 2, Math.min(ay, top - 150 * this.size)],
      [fromX, top - 90 * this.size],
      [(fromX + aim.x) / 2, (top + aim.y) / 2 - 30 * this.size],
      [aim.x, aim.y],
      [aim.x + (aim.x - fromX) * 0.6, aim.y - 30 * this.size],
      [aim.x + (aim.x - fromX) * 1.2, top - 160 * this.size],
    ];
    let px = ax;
    let py = ay;
    let aimIndex = 0;
    for (let l = 0; l < legs.length; l++) {
      const [lx, ly] = legs[l]!;
      const steps = 10;
      for (let i = 1; i <= steps; i++) raw.push(px + ((lx - px) * i) / steps, py + ((ly - py) * i) / steps);
      if (l === 3) aimIndex = raw.length / 2 - 1;
      px = lx;
      py = ly;
    }
    this.path.buildRaw(raw, 8 * this.size, 150 * this.size, this.castId * 0.7);
    this.sMax = Infinity;
    if (this.headS < 0) this.headS = 0;
    const sAim = this.path.lengthAt(aimIndex);
    this.passT = -1;
    this.speed = Math.max(this.speed, (sAim - this.headS) / Math.max(0.2, e.duration || 0.45));
  }

  private landing(at: Vec2, r: number): void {
    const g = this.ground(at, this.p);
    const pr = this.host.proj;
    const sq = Math.min(0.6, Math.max(0.25, pr.dy() / pr.unit()));
    this.kit.ring(g.x, g.y, 10, r * this.u * 1.3, 0.5, this.pal.deep, 0xffe6df, 5, { squash: sq });
    this.kit.ring(g.x, g.y, 6, r * this.u * 0.9, 0.4, -1, CRIMSON, 2.5, { squash: sq, delay: 0.05 });
    const o = this.kit.o(g.x, g.y, shard(), this.pal.ink);
    o.additive = false;
    o.speed[0] = 120;
    o.speed[1] = 300;
    o.angle[0] = -Math.PI * 0.95;
    o.angle[1] = -Math.PI * 0.05;
    o.life[0] = 0.4;
    o.life[1] = 0.7;
    o.scale[0] = 0.25;
    o.scale[1] = 0.5;
    o.gravity = 600;
    o.spin = 10;
    this.kit.emit(14);
    this.kit.shake(0.18);
    this.kit.flash(0xe8dcef, 0.2, 0.15);
    this.kit.stop(0.05, "sig-devourer-dive", 0.4);
  }

  private feed(from: Vec2): void {
    const d = this.dragon;
    this.feeds += 1;
    if (d) d.burn = Math.min(3, 1 + this.feeds * 0.5);
    const a = this.chestAt(from, this.q);
    const to = d && d.headPos.visible ? d.mouth : a;
    this.kit.streak(a.x, a.y, to.x, to.y, 40 * this.u, 1.5, this.gilded ? GILT_HOT : 0xf0d8ff, 0.3);
    const o = this.kit.o(a.x, a.y, softCircle(), 0xe6d2ff);
    o.target = { x: to.x, y: to.y, strength: 16 };
    o.speed[0] = 20;
    o.speed[1] = 70;
    o.life[0] = 0.35;
    o.life[1] = 0.6;
    o.scale[0] = 0.12;
    o.scale[1] = 0.26;
    this.kit.emit(10);
    o.target = undefined;
  }

  private bite(x: number, y: number, id: number): void {
    const k = this.kit;
    const light = this.gilded ? GILT_HOT : 0xffe6df;
    const a = this.dragon ? this.dragon.headPos.a : 0;
    // The jaws close: two crimson crescents meeting, white-hot at the teeth.
    const r = 16 * this.size;
    k.cut(x, y, r, a - 2.2, 1.3, CRIMSON, light, 2.8, 0.22);
    k.cut(x, y, r, a + 2.2, -1.3, CRIMSON, light, 2.8, 0.22);
    const o = k.o(x, y, shard(), this.pal.ink);
    o.additive = false;
    o.speed[0] = 80;
    o.speed[1] = 220;
    o.angle[0] = a - 0.9;
    o.angle[1] = a + 0.9;
    o.life[0] = 0.25;
    o.life[1] = 0.5;
    o.scale[0] = 0.18;
    o.scale[1] = 0.4;
    o.gravity = 260;
    o.spin = 9;
    k.emit(this.compact ? 3 : 8);
    const s = k.o(x, y, softCircle(), CRIMSON);
    s.speed[0] = 40;
    s.speed[1] = 140;
    s.life[0] = 0.15;
    s.life[1] = 0.3;
    s.scale[0] = 0.15;
    s.scale[1] = 0.3;
    k.emit(5);
    if (id >= 0) this.host.hold(id, 0.05);
    k.punch(0.01);
  }

  update(dt: number, real: number): void {
    this.time += real;
    this.biteT = Math.max(0, this.biteT - real);
    const step = dt / 0.28;
    this.rift.k = this.rift.open ? Math.min(1, this.rift.k + step) : Math.max(0, this.rift.k - step);
    this.exit.k = this.exit.open ? Math.min(1, this.exit.k + step) : Math.max(0, this.exit.k - step);
    const d = this.dragon;
    if (!d || this.headS < 0) return;
    // The head: on the simulation's curve by its time while the pass runs, then on at its speed.
    if (this.passT >= 0) {
      this.passT += dt;
      const t = Math.min(1, this.passT / this.passD);
      const lead = this.passEnd - SAMPLES;
      const s = this.path.lengthAt(lead + t * SAMPLES);
      this.headS = t < 1 ? s : Math.max(this.headS + this.speed * dt, s);
    } else this.headS += this.speed * dt;
    const len = d.length;
    // The entry rift closes once the tail is through it; the exit opens as the head nears it.
    if (this.headS - len > this.sMin + 20) this.rift.open = false;
    if (this.sMax !== Infinity && this.headS > this.sMax - 160 * this.size) {
      this.exit.on = true;
      this.exit.open = this.headS - len < this.sMax;
      if (!this.exitG) this.exitG = this.graphics(this.host.layers.fx);
    }
    // Snaps scheduled by a combination.
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      this.snaps[i] = this.snaps[i]! - real;
      if (this.snaps[i]! <= 0) {
        this.snaps.splice(i, 1);
        if (d.headPos.visible) this.bite(d.mouth.x, d.mouth.y, -1);
        d.jawOpen = 0;
      }
    }
    // Jaw: opens as the nearest foe ahead comes within reach.
    let open = 0;
    if (d.headPos.visible) {
      const hx = d.mouth.x;
      const hy = d.mouth.y;
      const ca = Math.cos(d.headPos.a);
      const sa = Math.sin(d.headPos.a);
      const reach = 90 * this.size;
      this.host.each("enemy", (id) => {
        if (!this.body(id)) return;
        const fx = this.b.x - hx;
        const fy = this.b.y - this.b.chestY - hy;
        if (fx * ca + fy * sa < -10) return;
        const dd = Math.hypot(fx, fy);
        if (dd < reach) open = Math.max(open, 1 - dd / reach);
      });
    }
    d.jawOpen = Math.max(open > 0 ? Math.min(1, easeOutBack(open) * 0.95) : 0, d.jawOpen - real * 8);
    // The hero is never lost behind the body.
    if (this.body(this.host.playerId())) {
      this.hero.x = this.b.x;
      this.hero.y = this.b.y - this.b.chestY;
      this.hero.r = this.b.height * 0.6;
    } else this.hero.r = 0;
    const fade = this.interrupted ? 1 - Math.min(1, this.sinceEnd / 0.4) : 1;
    d.layout(this.path, this.headS, this.time, fade, this.hero.x, this.hero.y, this.hero.r, this.sMin, this.sMax);
    d.drawLines(this.path, this.headS, this.time, this.enhanced ? GILT : CRIMSON, this.enhanced ? 0.8 : this.feeds > 0 ? Math.min(1, 0.4 + this.feeds * 0.25) : this.gilded ? 0.4 : 0);
    // Smoke off its back (and, Master, violet motes off the mane).
    if (!this.compact && dt > 0) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = this.profile.secondary ? 0.035 : 0.08;
        const i = 3 + Math.floor(Math.random() * Math.max(1, this.profile.dragonSegments - 5));
        if (d.segmentPoint(this.path, this.headS, i, this.pt) && this.pt.y > this.host.proj.top() - 20) {
          const o = this.kit.o(this.pt.x, this.pt.y, smokeTex(), this.pal.ink);
          o.additive = false;
          o.alpha = 0.45;
          o.speed[0] = 4;
          o.speed[1] = 18;
          o.angle[0] = -Math.PI * 0.8;
          o.angle[1] = -Math.PI * 0.2;
          o.life[0] = 0.5;
          o.life[1] = 0.9;
          o.scale[0] = 0.25 * this.size;
          o.scale[1] = 0.45 * this.size;
          o.endScale = 0.7 * this.size;
          o.gravity = -12;
          this.kit.emit(1);
          if (this.master) {
            const m = this.kit.o(this.pt.x, this.pt.y - 8 * this.size, softCircle(), this.gilded ? GILT : this.pal.glow);
            m.speed[0] = 10;
            m.speed[1] = 30;
            m.angle[0] = -Math.PI * 0.7;
            m.angle[1] = -Math.PI * 0.3;
            m.life[0] = 0.3;
            m.life[1] = 0.5;
            m.scale[0] = 0.1;
            m.scale[1] = 0.18;
            this.kit.emit(1);
          }
        }
      }
    }
    if (this.headS - len > Math.min(this.path.total, this.sMax) + 10) {
      d.hide();
      this.headS = -1;
      if (this.pushId) this.kit.releasePush(this.pushId);
    }
  }

  override paint(): void {
    this.drawRift(this.portalG, this.rift, this.time);
    this.drawRift(this.exitG, this.exit, this.time + 1.3);
  }

  /** A rift: a tall jagged tear, ink inside, a crimson-violet lip, turning streaks within. */
  private drawRift(g: Graphics | null, r: { x: number; y: number; k: number; on: boolean }, time: number): void {
    if (!g) return;
    g.clear();
    if (!r.on || r.k <= 0.01) return;
    const S = this.size;
    const h = 52 * S * easeOutCubic(r.k);
    const w = 15 * S * (0.6 + 0.4 * r.k);
    const n = 14;
    const pts: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const jag = 1 + (i % 2 === 0 ? 0.22 : -0.12) * Math.sin(time * 6 + i);
      pts.push(r.x + Math.cos(a) * w * jag, r.y + Math.sin(a) * h * (i % 2 === 0 ? 1 : 0.94));
    }
    g.poly(pts).fill({ color: this.pal.ink, alpha: 0.95 });
    g.poly(pts).stroke({ width: 4 * S, color: this.pal.mid, alpha: 0.75 });
    g.poly(pts).stroke({ width: 1.6 * S, color: this.gilded ? GILT : CRIMSON, alpha: 0.95 });
    for (let i = 0; i < 3; i++) {
      const a = time * (2 + i) + i * 2.1;
      g.ellipse(r.x, r.y, w * (0.3 + i * 0.2), h * (0.3 + i * 0.18)).stroke({ width: 1, color: this.pal.glow, alpha: 0.25 + 0.1 * Math.sin(a) });
    }
  }

  override dispose(): void {
    if (this.dragon) {
      this.dragon.hide();
      this.svc.freeDragon(this.dragon);
      this.dragon = null;
    }
    if (this.pushId) this.kit.releasePush(this.pushId);
    super.dispose();
  }
}
