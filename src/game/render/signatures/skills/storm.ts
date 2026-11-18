import type { Sprite } from "pixi.js";
import { easeInCubic, easeOutCubic } from "../../anim/ease";
import { softCircle } from "../../textures";
import { CRIMSON, GILT, GILT_HOT } from "../palette";
import { Stage, span01, type SigBeatEvent } from "../stage";
import { bladeEdgeTex, bladeTex } from "../textures";

/**
 * SHADOW STORM: blades of shadow gather and orbit the warrior, then launch one by one into the
 * thickest knot of foes.
 *
 *   gather   violet-ink blades with white edges cut themselves out of the air round him and orbit on
 *            a tilted ellipse at chest height, spinning up (the far ones behind him, the near ones in
 *            front); he keeps fighting (no cast lock).
 *   blade    one leaves the orbit and flies an arc to its foe, a trail behind it, and bites: a short
 *            violet cut with a white edge. Its Shadow Mark shows on the body.
 *   tempest  (Black Tempest) a ring of spinning blades runs outward over the ground, cutting as it
 *            passes.
 *
 * Thousand Blades: twice the blades, smaller, in two counter-turning rings, loosed in a rapid volley.
 * Hunter's Instinct: the blades hover with a crimson glint and fly a sharp seeking hook, finishing
 * with a stab from above. Master: every blade leaves a double trail; Grandmaster: gilt edges.
 */
interface Blade {
  body: Sprite | null;
  edge: Sprite | null;
  /** A violet light behind the blade, so ink reads against ink. */
  glow: Sprite | null;
  /** Orbit slot (angle offset) and ring. */
  slot: number;
  ring: number;
  state: 0 | 1 | 2;
  t: number;
  d: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  cx: number;
  cy: number;
  appear: number;
}

export class StormStage extends Stage {
  private readonly blades: Blade[] = [];
  private gatherT = -1;
  private gatherD = 0.8;
  private spin = 0;
  private ox = 0;
  private oy = 0;
  private scale = 1;
  private tempest = { x: 0, y: 0, r: 0, t: -1, d: 0.9 };
  private tempestBlades: Sprite[] = [];
  private launched = 0;
  private pwy = 75;

  constructor(...a: ConstructorParameters<typeof Stage>) {
    super(...a);
    this.tail = 0.4;
    this.scale = this.host.proj.fs(this.cast.origin.y) * (this.evo === "thousand_blades" ? 0.72 : 1);
  }

  onBeat(e: SigBeatEvent): void {
    switch (e.beat) {
      case "gather":
        this.gather(e.index > 1 ? e.index : this.evo === "thousand_blades" ? 12 : 6, e.duration || 0.8);
        break;
      case "blade":
        this.launch(e);
        break;
      case "tempest":
        this.startTempest(e);
        break;
      default:
        break;
    }
  }

  private gather(n: number, d: number): void {
    this.gatherT = 0;
    this.gatherD = Math.max(0.2, d);
    const count = Math.min(this.compact ? 6 : 16, n);
    for (let i = 0; i < count; i++) this.addBlade(i, count);
  }

  private addBlade(i: number, count: number): Blade {
    // In the figures layer: orbiting blades pass behind and in front of him.
    const fx = this.host.layers.figures;
    const body = this.sprite(fx, bladeTex(), false);
    const glow = this.sprite(fx, softCircle(), true);
    const edge = this.compact ? null : this.sprite(fx, bladeEdgeTex(), true);
    if (glow) glow.tint = this.gilded ? GILT : this.pal.glow;
    if (body) {
      body.tint = this.pal.deep;
      body.anchor.set(0.5);
    }
    if (edge) {
      edge.tint = this.gilded ? GILT_HOT : 0xffffff;
      edge.anchor.set(0.5);
    }
    const twoRings = this.evo === "thousand_blades" && !this.compact;
    const ring = twoRings ? i % 2 : 0;
    const per = twoRings ? Math.ceil(count / 2) : count;
    const b: Blade = { body, edge, glow, slot: ((twoRings ? Math.floor(i / 2) : i) / per) * Math.PI * 2 + ring * 0.3, ring, state: 0, t: 0, d: 0.16, ax: 0, ay: 0, bx: 0, by: 0, cx: 0, cy: 0, appear: i * 0.04 };
    this.blades.push(b);
    return b;
  }

  private launch(e: { index: number; from?: { x: number; y: number }; to: { x: number; y: number }; targetIds: number[]; duration: number }): void {
    let b = this.blades.find((x) => x.state === 0);
    const relaunch = !b;
    if (!b) b = this.addBlade(this.blades.length, this.blades.length + 1);
    this.launched += 1;
    if (relaunch && e.from) {
      // A blade loosed again from where its last foe fell (Hunter's Instinct at Master).
      const a = this.chestAt(e.from, this.p);
      b.ax = a.x;
      b.ay = a.y;
    } else {
      this.orbitPos(b, this.p);
      b.ax = this.p.x;
      b.ay = this.p.y;
    }
    const id = e.targetIds[0] ?? -1;
    if (id >= 0 && this.body(id)) {
      b.bx = this.b.x + (Math.random() - 0.5) * 8 * this.u;
      b.by = this.b.y - this.b.chestY + (Math.random() - 0.5) * 10 * this.u;
    } else {
      const c = this.chestAt(e.to, this.q);
      b.bx = c.x;
      b.by = c.y;
    }
    // An arc: up and over, or (Hunter's Instinct) a hook that drops on the foe from above.
    const hunter = this.evo === "hunters_instinct";
    const mx = (b.ax + b.bx) / 2;
    const my = Math.min(b.ay, b.by) - (hunter ? 90 : 40 + (this.launched % 3) * 18) * this.u;
    b.cx = hunter ? b.bx - (b.bx - b.ax) * 0.1 : mx + (this.launched % 2 === 0 ? 1 : -1) * 20 * this.u;
    b.cy = my;
    b.state = 1;
    b.t = 0;
    b.d = Math.max(0.1, e.duration || 0.16);
    this.kit.streak(b.ax, b.ay, b.bx, b.by, 40 * this.u, 0.8, this.pal.glow, b.d * 1.2, { alpha: 0.6 });
  }

  private orbitPos(b: Blade, out: { x: number; y: number }): number {
    const r = (44 + b.ring * 16) * this.scale;
    const a = b.slot + this.spin * (b.ring === 1 ? -1 : 1);
    out.x = this.ox + Math.cos(a) * r;
    out.y = this.oy + Math.sin(a) * r * 0.32;
    return a;
  }

  private startTempest(e: SigBeatEvent): void {
    const pr = this.host.proj;
    this.tempest.x = pr.sx(e.from.x);
    this.tempest.y = pr.sy(e.from.y);
    this.tempest.r = (e.radius || 170) * pr.unit();
    this.tempest.t = 0;
    this.tempest.d = Math.max(0.3, e.duration || 0.9);
    const n = this.compact ? 6 : 12;
    for (let i = 0; i < n; i++) {
      const s = this.sprite(this.host.layers.fx, bladeTex(), false);
      if (s) {
        s.tint = this.pal.mid;
        this.tempestBlades.push(s);
      }
    }
    this.kit.ring(this.tempest.x, this.tempest.y, 10, this.tempest.r, this.tempest.d, this.pal.deep, this.pal.glow, 4, { squash: Math.min(0.6, Math.max(0.25, pr.dy() / pr.unit())) });
  }

  update(dt: number, real: number): void {
    const pid = this.host.playerId();
    if (this.body(pid)) {
      this.ox = this.b.x;
      this.oy = this.b.y - this.b.chestY;
      this.pwy = this.b.wy;
    }
    if (this.gatherT >= 0) this.gatherT += dt;
    const spinUp = span01(this.gatherT, 0, this.gatherD);
    this.spin += dt * (2.5 + 7 * spinUp);
    const hunter = this.evo === "hunters_instinct";
    const light = this.gilded ? GILT_HOT : 0xffffff;
    for (const b of this.blades) {
      const body = b.body;
      if (b.state === 0) {
        // Orbiting: blades cut themselves out of the air one after another.
        const k = easeOutCubic(span01(this.gatherT, b.appear, b.appear + 0.18));
        const a = this.orbitPos(b, this.p);
        const front = Math.sin(a) > 0;
        const sc = this.scale * 1.0 * (0.4 + 0.6 * k) * (front ? 1 : 0.85);
        const rot = a + Math.PI / 2;
        for (const s of [b.glow, body, b.edge]) {
          if (!s) continue;
          s.position.set(this.p.x, this.p.y);
          s.rotation = rot;
          if (s === b.glow) s.scale.set(sc * 0.9, sc * 0.35);
          else s.scale.set(sc, sc * 1.25);
          s.alpha = k * (front ? 1 : 0.6) * (s === b.glow ? 0.55 : 1);
          s.zIndex = this.pwy + (front ? 0.3 : -0.3) + (s === b.edge ? 0.01 : s === b.glow ? -0.01 : 0);
        }
        if (hunter && body && Math.random() < 0.05 && dt > 0) this.kit.cut(this.p.x, this.p.y, 3 * this.u, 0, 6.2, -1, CRIMSON, 1.4, 0.12);
        continue;
      }
      if (b.state === 1) {
        b.t += dt;
        const k = Math.min(1, b.t / b.d);
        const e = hunter ? easeInCubic(k) : easeOutCubic(k);
        // Quadratic Bezier.
        const u = 1 - e;
        const x = u * u * b.ax + 2 * u * e * b.cx + e * e * b.bx;
        const y = u * u * b.ay + 2 * u * e * b.cy + e * e * b.by;
        const tx = 2 * u * (b.cx - b.ax) + 2 * e * (b.bx - b.cx);
        const ty = 2 * u * (b.cy - b.ay) + 2 * e * (b.by - b.cy);
        const rot = Math.atan2(ty, tx);
        const sc = this.scale * 1.15;
        for (const s of [b.glow, body, b.edge]) {
          if (!s) continue;
          s.position.set(x, y);
          s.rotation = rot;
          if (s === b.glow) s.scale.set(sc * 1.1, sc * 0.4);
          else s.scale.set(sc * 1.15, sc * 1.1);
          s.alpha = s === b.glow ? 0.6 : 1;
          s.zIndex = 8000 + (s === b.edge ? 1 : s === b.glow ? -1 : 0);
        }
        if (dt > 0) {
          // An ink wake behind it, and (full staging) a violet light along it.
          this.kit.streak(x - Math.cos(rot) * 26 * this.u, y - Math.sin(rot) * 26 * this.u, x, y, 34 * this.u, 2.2, this.pal.ink, 0.16, { alpha: 0.75, add: false });
          if (this.profile.secondary) this.kit.streak(x - Math.cos(rot) * 18 * this.u, y - Math.sin(rot) * 18 * this.u, x, y, 22 * this.u, 1, this.pal.glow, 0.12, { alpha: 0.7 });
          if (this.master) this.kit.streak(x - Math.cos(rot) * 18 * this.u, y - Math.sin(rot) * 18 * this.u + 3, x, y + 3, 18 * this.u, 0.6, light, 0.1, { alpha: 0.6 });
        }
        if (k >= 1) {
          b.state = 2;
          for (const s of [b.glow, body, b.edge]) if (s) s.visible = false;
          this.bite(b.bx, b.by, rot);
        }
      }
    }
    // The tempest ring.
    const tp = this.tempest;
    if (tp.t >= 0) {
      tp.t += dt;
      const k = span01(tp.t, 0, tp.d);
      const r = tp.r * easeOutCubic(k);
      const sq = Math.min(0.6, Math.max(0.25, this.host.proj.dy() / this.host.proj.unit()));
      const n = this.tempestBlades.length;
      for (let i = 0; i < n; i++) {
        const s = this.tempestBlades[i]!;
        const a = (i / n) * Math.PI * 2 + tp.t * 6;
        s.position.set(tp.x + Math.cos(a) * r, tp.y + Math.sin(a) * r * sq - 20 * this.u);
        s.rotation = a + Math.PI / 2 + tp.t * 10;
        s.scale.set(this.scale * 0.6);
        s.alpha = 1 - span01(k, 0.75, 1);
      }
      if (dt > 0 && k < 1 && Math.random() < 0.6) {
        const a = Math.random() * Math.PI * 2;
        this.kit.cut(tp.x + Math.cos(a) * r, tp.y + Math.sin(a) * r * sq - 20 * this.u, 14 * this.u, a, 1.4, this.pal.deep, light, 1.6, 0.16);
      }
    }
    void real;
  }

  private bite(x: number, y: number, rot: number): void {
    const k = this.kit;
    const light = this.gilded ? GILT_HOT : 0xffffff;
    if (this.evo === "hunters_instinct") k.slash(x, y - 26 * this.u, x, y + 12 * this.u, CRIMSON, light, 2.2, 0.2);
    else k.cut(x, y, 13 * this.u * this.scale, rot - 0.9, 1.8, this.pal.deep, light, 2 * (this.evo === "thousand_blades" ? 0.8 : 1), 0.2);
    const o = k.o(x, y, softCircle(), this.pal.glow);
    o.speed[0] = 40;
    o.speed[1] = 140;
    o.angle[0] = rot - 0.8;
    o.angle[1] = rot + 0.8;
    o.life[0] = 0.15;
    o.life[1] = 0.3;
    o.scale[0] = 0.08;
    o.scale[1] = 0.18;
    k.emit(4);
  }

  override dispose(): void {
    this.blades.length = 0;
    this.tempestBlades.length = 0;
    super.dispose();
  }
}

void GILT;
