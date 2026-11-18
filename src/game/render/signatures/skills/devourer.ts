import type { Graphics } from "pixi.js";
import type { Vec2 } from "../../../engine/math";
import { easeInCubic, easeOutBack, easeOutCubic } from "../../anim/ease";
import { shard, softCircle } from "../../textures";
import { CRIMSON, GILT, GILT_HOT } from "../palette";
import { Stage, span01, type SigBeatEvent, type SigSynergyEvent } from "../stage";
import { smokeTex } from "../textures";
import { SerpentPath, type Dragon } from "./dragon";

/**
 * ABYSSAL DEVOURER: a portal tears at the field's edge and a serpent dragon of ink sweeps through.
 *
 *   portal  a vertical rift rips open at the edge (ink inside, a jagged crimson-violet lip, sparks),
 *           the field dims a touch and the camera leans in.
 *   pass    the dragon pours out of the rift and winds across the field along a curve through the
 *           foes, its body following the head's exact path; the jaw opens as each foe nears and
 *           snaps shut on it (a crimson bite, ink spray); smoke trails from its back; a second rift
 *           opens ahead and swallows it, tail last.
 *   feed    (Soul Feeder) a soul is torn from the bitten foe into the maw; the eyes and a light
 *           running down the spine burn brighter with each.
 *   second_pass (Ancient Devourer) it does not leave: it turns up and away, then dives from above
 *           onto the group and climbs out of the frame.
 *
 * World Eater is larger and winds through the whole depth of the field. Gravity Feast bends the
 * path into the singularity, where it coils once and bites everything held there. Master grows a
 * full mane of fins; Grandmaster gilds horns, fins and whiskers; a crowned cast wears a gilt crown.
 */
const FLIGHT = 64;

export class DevourerStage extends Stage {
  private dragon: Dragon | null = null;
  private readonly path = new SerpentPath();
  private readonly ctrl: number[] = [];
  private headS = -1;
  private speed = 0;
  private time = 0;
  private size = 1;
  private portalG: Graphics | null = null;
  private exitG: Graphics | null = null;
  /** Rifts: where, how open (0..1), and whether they are opening or closing. */
  private readonly rift = { x: 0, y: 0, k: 0, open: false, on: false };
  private readonly exit = { x: 0, y: 0, k: 0, open: false, on: false };
  private readonly bites: { s: number; id: number; done: boolean }[] = [];
  private feeds = 0;
  private smokeT = 0;
  private pushId = 0;
  private dive = -1;
  private leaving = false;
  private feast: { x: number; y: number } | null = null;
  private readonly hero = { x: 0, y: 0, r: 0 };
  private readonly pt = { x: 0, y: 0 };

  constructor(...a: ConstructorParameters<typeof Stage>) {
    super(...a);
    this.cinematic = true;
    this.tail = 1.6;
    const fs = this.host.proj.fs(75);
    this.size = fs * (this.evo === "world_eater" ? 1.75 : 1.32) * (this.compact ? 0.8 : 1);
  }

  private flightY(wy: number): number {
    const pr = this.host.proj;
    return pr.sy(wy) - FLIGHT * pr.fs(wy);
  }

  onBeat(e: SigBeatEvent): void {
    switch (e.beat) {
      case "portal":
        this.openRift(e.from);
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
      case "depart":
        this.leaving = true;
        break;
      default:
        break;
    }
  }

  override onSynergy(e: SigSynergyEvent): void {
    if (e.synergy !== "gravity_feast") return;
    const pr = this.host.proj;
    this.feast = { x: pr.sx(e.pos.x), y: pr.sy(e.pos.y) - 78 * pr.fs(e.pos.y) };
    this.svc.label("Gravity Feast", this.feast.x, this.feast.y - 60 * this.u, 0xe8c0ff);
  }

  private openRift(from: Vec2): void {
    const pr = this.host.proj;
    const margin = 26 * this.u;
    this.rift.x = Math.min(pr.right() - margin, Math.max(pr.left() + margin, pr.sx(from.x)));
    this.rift.y = this.flightY(from.y);
    this.rift.on = true;
    this.rift.open = true;
    this.rift.k = 0;
    if (!this.portalG) this.portalG = this.graphics(this.host.layers.fx);
    const k = this.kit;
    if (!this.compact) {
      this.host.darken(0x120e1c, 0.32);
      const center = this.ground(this.cast.center, this.p);
      this.pushId = k.pushIn((center.x + this.rift.x) / 2, center.y - 50 * this.u, 1.07, 0.35, 1.4, 0.6);
    }
    const o = k.o(this.rift.x, this.rift.y, shard(), CRIMSON);
    o.speed[0] = 40;
    o.speed[1] = 160;
    o.life[0] = 0.3;
    o.life[1] = 0.6;
    o.scale[0] = 0.15;
    o.scale[1] = 0.35;
    o.alignToVelocity = true;
    o.spread = 30 * this.size;
    k.emit(12);
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
    if (!this.rift.on) this.openRift(e.from);
    const ctrl = this.ctrl;
    ctrl.length = 0;
    const sx = this.rift.x;
    const sy = this.rift.y;
    const dir = pr.sx(e.to.x) >= sx ? 1 : -1;
    // Out of the rift: a short straight first, so the body pours out level.
    ctrl.push(sx - dir * 30 * this.size, sy, sx, sy, sx + dir * 40 * this.size, sy - 6 * this.size);
    // Through the foes it means to strike, in the order it meets them (close ones merged).
    const pts: { x: number; y: number; id: number }[] = [];
    for (const id of e.targetIds) {
      if (!this.body(id)) continue;
      pts.push({ x: this.b.x, y: this.b.y - this.b.chestY, id });
    }
    pts.sort((a, b) => (a.x - b.x) * dir);
    let lastX = sx + dir * 40 * this.size;
    const eater = this.evo === "world_eater";
    let zig = 0;
    for (const p of pts) {
      if ((p.x - lastX) * dir < 34 * this.size) continue;
      if (this.feast && (this.feast.x - lastX) * dir > 0 && (this.feast.x - p.x) * dir < 0) this.coil(ctrl, dir);
      // World Eater sweeps the whole depth: it alternates between the far and the near ground.
      const y = eater ? (zig++ % 2 === 0 ? this.flightY(25) : this.flightY(125)) : p.y;
      ctrl.push(p.x, y);
      lastX = p.x;
      if (ctrl.length > 22) break;
    }
    if (this.feast && (this.feast.x - lastX) * dir > 0) this.coil(ctrl, dir);
    // Out the far side: through an exit rift, or (Ancient Devourer) up and away for its turn.
    const margin = 26 * this.u;
    const ex = Math.min(pr.right() - margin, Math.max(pr.left() + margin, pr.sx(e.to.x)));
    const ey = this.flightY(e.to.y);
    if (this.evo === "ancient_devourer") {
      ctrl.push(ex - dir * 40 * this.size, ey - 20 * this.size, ex + dir * 10 * this.size, pr.top() + 40 * this.u, ex - dir * 60 * this.size, pr.top() - 120 * this.size);
    } else {
      this.exit.x = ex;
      this.exit.y = ey;
      ctrl.push(ex, ey, ex + dir * 60 * this.size, ey);
    }
    this.path.build(ctrl, (eater ? 16 : 11) * this.size, 150 * this.size, this.castId * 0.7);
    const travel = this.path.total;
    this.speed = travel / Math.max(0.6, e.duration || 1.5);
    this.headS = 0;
    this.bites.length = 0;
    for (const p of pts) this.bites.push({ s: this.path.nearest(p.x, p.y), id: p.id, done: false });
    if (this.feast) {
      const s = this.path.nearest(this.feast.x, this.feast.y);
      for (let i = 0; i < 3; i++) this.bites.push({ s: s + (i - 1) * 40 * this.size, id: -1, done: false });
    }
    this.bites.sort((a, b) => a.s - b.s);
  }

  /** Gravity Feast: a tight coil round the singularity, inserted into the path. */
  private coil(ctrl: number[], dir: number): void {
    const f = this.feast!;
    const r = 34 * this.size;
    for (let i = 0; i <= 6; i++) {
      const a = -Math.PI / 2 - dir * (i / 6) * Math.PI * 2;
      ctrl.push(f.x + Math.cos(a) * r * dir, f.y + Math.sin(a) * r * 0.8 - (i === 0 || i === 6 ? 0 : 0));
    }
  }

  private secondPass(e: SigBeatEvent): void {
    this.acquireDragon();
    const pr = this.host.proj;
    const target = this.chestAt(e.to, this.q);
    const tx = target.x;
    const ty = target.y;
    // Append the dive: from high above, down onto the group, and up out of the frame.
    const ctrl = this.ctrl;
    const fromX = pr.sx(e.from.x);
    ctrl.push(fromX, pr.top() - 60 * this.size, tx + 40 * this.size, ty - 120 * this.size, tx, ty, tx - 50 * this.size, ty - 30 * this.size, tx - 120 * this.size, pr.top() - 160 * this.size);
    const s0 = this.headS;
    this.path.build(ctrl, 10 * this.size, 150 * this.size, this.castId * 0.7);
    const sTarget = this.path.nearest(tx, ty);
    this.speed = Math.max(this.speed, (sTarget - s0) / Math.max(0.3, (e.duration || 0.85) * 0.85));
    for (const id of e.targetIds) {
      if (!this.body(id)) continue;
      this.bites.push({ s: this.path.nearest(this.b.x, this.b.y - this.b.chestY), id, done: false });
    }
    this.bites.push({ s: sTarget, id: -1, done: false });
    this.bites.sort((a, b) => a.s - b.s);
    this.dive = sTarget;
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
    k.cut(x, y, r, a - 2.2, 1.3, CRIMSON, light, 2.6, 0.2);
    k.cut(x, y, r, a + 2.2, -1.3, CRIMSON, light, 2.6, 0.2);
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
    const pr = this.host.proj;
    // Rifts open and close.
    const step = dt / 0.28;
    this.rift.k = this.rift.open ? Math.min(1, this.rift.k + step) : Math.max(0, this.rift.k - step);
    this.exit.k = this.exit.open ? Math.min(1, this.exit.k + step) : Math.max(0, this.exit.k - step);
    const d = this.dragon;
    if (!d || this.headS < 0) return;
    this.headS += this.speed * dt;
    const total = this.path.total;
    const len = d.length;
    // The entry rift closes once the tail is out; the exit opens as the head comes near.
    if (this.headS > len + 20) this.rift.open = false;
    if (this.exit.x !== 0 || this.exit.y !== 0) {
      if (this.headS > total - 160 * this.size) {
        this.exit.on = true;
        this.exit.open = this.headS < total + len;
        if (!this.exitG) this.exitG = this.graphics(this.host.layers.fx);
      }
    }
    // Jaw: opens as the next bite nears, snaps shut on it.
    let open = 0;
    for (const b of this.bites) {
      if (b.done) continue;
      const ahead = b.s - this.headS;
      if (ahead <= 0) {
        b.done = true;
        if (d.headPos.visible) this.bite(d.mouth.x, d.mouth.y, b.id);
        d.jawOpen = 0;
        continue;
      }
      const w = 70 * this.size;
      if (ahead < w) open = Math.max(open, 1 - ahead / w);
    }
    d.jawOpen = Math.max(open > 0 ? easeOutBack(open) * 0.95 : 0, d.jawOpen - real * 8);
    // The hero is never lost behind the body.
    if (this.body(this.host.playerId())) {
      this.hero.x = this.b.x;
      this.hero.y = this.b.y - this.b.chestY;
      this.hero.r = this.b.height * 0.6;
    } else this.hero.r = 0;
    const fade = this.interrupted ? 1 - span01(this.sinceEnd, 0, 0.4) : 1;
    d.layout(this.path, this.headS, this.time, fade, this.hero.x, this.hero.y, this.hero.r);
    d.drawLines(this.path, this.headS, this.time, this.enhanced ? GILT : CRIMSON, this.enhanced ? 0.8 : this.feeds > 0 ? Math.min(1, 0.4 + this.feeds * 0.25) : this.gilded ? 0.4 : 0);
    // Smoke off its back.
    if (!this.compact && dt > 0) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = this.profile.secondary ? 0.035 : 0.08;
        const i = 3 + Math.floor(Math.random() * Math.max(1, this.profile.dragonSegments - 5));
        if (d.segmentPoint(this.path, this.headS, i, this.pt)) {
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
    // The dive's arrival shakes the ground once.
    if (this.dive >= 0 && this.headS >= this.dive) {
      this.dive = -1;
      const g = this.ground(this.cast.center, this.p);
      this.kit.ring(g.x, g.y, 10, 120 * this.u, 0.5, this.pal.deep, 0xffe6df, 4, { squash: pr.dy() / pr.unit() });
      this.kit.shake(0.14);
      this.kit.flash(0xe8dcef, 0.18, 0.15);
    }
    if (this.headS > total + len + 10) {
      d.hide();
      this.headS = -1;
      if (this.pushId) this.kit.releasePush(this.pushId);
    }
    void this.leaving;
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
    // The void turning inside.
    for (let i = 0; i < 3; i++) {
      const a = time * (2 + i) + i * 2.1;
      g.ellipse(r.x, r.y, w * (0.3 + i * 0.2), h * (0.3 + i * 0.18)).stroke({ width: 1, color: this.pal.glow, alpha: 0.25 + 0.1 * Math.sin(a) });
    }
    void easeInCubic;
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
