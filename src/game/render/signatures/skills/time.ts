import type { Container, Graphics, Sprite } from "pixi.js";
import { easeOutBack, easeOutCubic } from "../../anim/ease";
import { shard, softCircle } from "../../textures";
import { CRIMSON, ELECTRIC, GILT, GILT_HOT } from "../palette";
import { Stage, span01, type SigBeatEvent, type SigSynergyEvent } from "../stage";
import { glowRingTex, holeTex, starTex } from "../textures";

/**
 * TIME FRACTURE: a cracked clock-sigil turns over the field and time stops for the foes.
 *
 *   clock    a pale silver clock face stands over the field (roman ticks, two hands running
 *            backwards), electric-blue cracks spreading across it; its ring marks the ground.
 *   freeze   the hands stop dead; the world's colour drains (the backdrop goes to slate), the
 *            frozen are washed pale with a glassy rim and held mid-motion, motes hang in the air;
 *            the clock ticks once a half second and its cracks grow.
 *   resume   the clock shatters into glass; a ripple runs out over the ground and colour returns.
 *   delayed  every held blow lands at once: a blue-white star and a ring of cracks on each body.
 *
 * Stop the World stands a larger clock with a second ring and drains the field further. Fractured
 * Future echoes each release a beat later as a ghost of the clock's hand. Temporal Execution turns
 * the release on bodies under another skill's mark into a crimson-gold crack. Master adds a minute
 * ring turning the other way; Grandmaster gilds the hands.
 */
export class TimeStage extends Stage {
  override focus(out: { x: number; y: number; top: number }): boolean {
    if (this.ended) return false;
    out.x = this.cx;
    out.y = this.gy;
    out.top = Math.min(this.cy, this.gy - 120 * this.host.proj.fs(this.cast.center.y)) - this.R - 8;
    return true;
  }

  private gx = 0;
  private gy = 0;
  private cx = 0;
  private cy = 0;
  private R = 40;
  private r = 120;
  private squash = 0.4;
  private box: Container | null = null;
  private face: Graphics | null = null;
  private phase = 0;
  private phaseT = 0;
  private freezeD = 2;
  private hand = 0;
  private lastTick = 0;
  private crack = 0;
  private readonly targets: number[] = [];
  private delayedCount = 0;
  private minute: Graphics | null = null;
  private faceKey = -1;

  constructor(...a: ConstructorParameters<typeof Stage>) {
    super(...a);
    this.tail = 0.7;
    const pr = this.host.proj;
    const c = this.cast.center;
    this.gx = pr.sx(c.x);
    this.gy = pr.sy(c.y);
    const fs = pr.fs(c.y);
    this.R = 46 * fs * (this.evo === "stop_the_world" ? 1.3 : 1) * (this.compact ? 0.8 : 1);
    this.cx = this.gx;
    this.cy = Math.max(pr.top() + this.R + 16, this.gy - 120 * fs);
    this.r = this.cast.radius * pr.unit();
    this.squash = Math.min(0.6, Math.max(0.25, pr.dy() / pr.unit()));
  }

  onBeat(e: SigBeatEvent): void {
    switch (e.beat) {
      case "clock":
        this.build();
        this.phase = 1;
        this.phaseT = 0;
        this.kit.ring(this.gx, this.gy, this.r * 0.2, this.r, 0.4, this.pal.deep, this.pal.mid, 3, { squash: this.squash });
        break;
      case "freeze":
        if (!this.box) this.build();
        this.phase = 2;
        this.phaseT = 0;
        this.freezeD = Math.max(0.5, e.duration || 2);
        this.targets.length = 0;
        for (const id of e.targetIds) this.targets.push(id);
        this.kit.ring(this.gx, this.gy, 10, this.r * 1.1, 0.5, this.pal.deep, 0xffffff, 3, { squash: this.squash });
        this.kit.punch(0.02);
        // Motes that hang where they are (time stopped for them too).
        if (!this.compact) {
          const o = this.kit.o(this.gx, this.gy - 40 * this.u, softCircle(), 0xd8e6ff);
          o.speed[0] = 0;
          o.speed[1] = 4;
          o.life[0] = this.freezeD * 0.8;
          o.life[1] = this.freezeD;
          o.scale[0] = 0.06;
          o.scale[1] = 0.14;
          o.spread = this.r * 1.4;
          o.alpha = 0.8;
          this.kit.emit(16);
        }
        break;
      case "resume":
        this.shatter();
        break;
      case "delayed":
        this.delayed(e.targetIds[0] ?? -1, e.from, e.index);
        break;
      case "pull":
        // Frozen Singularity: the glass of every frozen body streams into a small singularity.
        this.singularity(e.from, e.targetIds);
        break;
      case "implode":
        this.collapse();
        break;
      default:
        break;
    }
  }

  override onSynergy(e: SigSynergyEvent): void {
    void e;
  }

  private build(): void {
    if (this.box) return;
    this.box = this.container(this.host.layers.fx);
    this.box.position.set(this.cx, this.cy);
    this.face = this.graphics(this.box);
  }

  private shatter(): void {
    const k = this.kit;
    this.phase = 3;
    this.phaseT = 0;
    // Glass flies from the face.
    const o = k.o(this.cx, this.cy, shard(), 0xdfe8ff);
    o.speed[0] = 120;
    o.speed[1] = 380;
    o.life[0] = 0.4;
    o.life[1] = 0.8;
    o.scale[0] = 0.2;
    o.scale[1] = 0.5;
    o.gravity = 500;
    o.spin = 12;
    o.spread = this.R;
    k.emit(this.compact ? 10 : 30);
    const b = k.o(this.cx, this.cy, softCircle(), ELECTRIC);
    b.speed[0] = 60;
    b.speed[1] = 200;
    b.life[0] = 0.2;
    b.life[1] = 0.4;
    b.scale[0] = 0.12;
    b.scale[1] = 0.25;
    k.emit(12);
    // The ripple: in, then out, over the ground.
    k.ring(this.gx, this.gy, this.r * 1.1, 6, 0.18, this.pal.deep, 0xffffff, 3, { squash: this.squash, inward: true });
    k.ring(this.gx, this.gy, 6, this.r * 1.6, 0.6, this.pal.deep, 0xdfe8ff, 4, { squash: this.squash, delay: 0.16 });
    k.flash(0xdfe8ff, 0.24, 0.18);
    k.stop(0.05, "sig-time", 0.4);
    k.punch(0.03);
  }

  private delayed(id: number, at: { x: number; y: number }, index: number): void {
    const k = this.kit;
    let x: number;
    let y: number;
    if (id >= 0 && this.body(id)) {
      x = this.b.x;
      y = this.b.y - this.b.chestY;
    } else {
      const c = this.chestAt(at, this.q);
      x = c.x;
      y = c.y;
    }
    this.delayedCount += 1;
    const echo = this.evo === "fractured_future" && index > this.targets.length && this.targets.length > 0;
    const exec = this.evo === "temporal_execution" && id >= 0 && this.svc.hasMark(id);
    const col = exec ? CRIMSON : echo ? this.pal.accent : ELECTRIC;
    const light = exec ? GILT_HOT : 0xffffff;
    const s = this.u * (echo ? 0.7 : 1);
    // Cracks radiating from the body, a star, a small ring.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + index * 0.7;
      const len = (18 + (i % 2) * 10) * s * 1.4;
      k.slash(x + Math.cos(a) * 4 * s, y + Math.sin(a) * 4 * s, x + Math.cos(a) * len, y + Math.sin(a) * len, col, light, 1.6, 0.26);
    }
    const st = this.sprite(this.host.layers.fx, starTex(), true);
    if (st) {
      st.position.set(x, y);
      st.tint = light;
      this.stars.push({ s: st, t: 0, size: echo ? 1 : 1.5 });
    }
    k.ring(x, y, 4, 30 * s, 0.25, this.pal.deep, light, 2, { ground: false, squash: 0.9 });
    if (echo) k.cut(x, y, 20 * s, -Math.PI / 2, Math.PI * 1.6, this.pal.deep, this.pal.accent, 1.5, 0.3);
    k.punch(0.008);
  }

  private readonly stars: { s: Sprite; t: number; size: number }[] = [];
  private sing: { x: number; y: number; t: number; core: Sprite | null; rim: Sprite | null; gone: boolean } | null = null;

  private singularity(at: { x: number; y: number }, ids: number[]): void {
    const pr = this.host.proj;
    const x = pr.sx(at.x);
    const y = pr.sy(at.y) - 110 * pr.fs(at.y);
    const core = this.sprite(this.host.layers.fx, holeTex(), false);
    if (core) core.tint = 0x000000;
    const rim = this.sprite(this.host.layers.fx, glowRingTex(), true);
    if (rim) rim.tint = 0xdfe8ff;
    this.sing = { x, y, t: 0, core, rim, gone: false };
    for (const id of ids) {
      if (!this.body(id)) continue;
      const bx = this.b.x;
      const by = this.b.y - this.b.chestY;
      this.kit.streak(bx, by, x, y, 50 * this.u, 1.4, 0xdfe8ff, 0.3);
      const o = this.kit.o(bx, by, shard(), 0xdfe8ff);
      o.target = { x, y, strength: 18 };
      o.speed[0] = 20;
      o.speed[1] = 80;
      o.life[0] = 0.3;
      o.life[1] = 0.45;
      o.scale[0] = 0.15;
      o.scale[1] = 0.3;
      o.spin = 8;
      this.kit.emit(6);
      o.target = undefined;
    }
    this.svc.label("Frozen Singularity", x, y - 50 * this.u, 0xd4e4ff);
  }

  private collapse(): void {
    const s = this.sing;
    if (!s) return;
    s.gone = true;
    const k = this.kit;
    const st = this.sprite(this.host.layers.fx, starTex(), true);
    if (st) {
      st.position.set(s.x, s.y);
      st.tint = 0xe6f0ff;
      this.stars.push({ s: st, t: 0, size: 2.4 });
    }
    k.ring(s.x, s.y, 4, 70 * this.u, 0.32, this.pal.deep, 0xffffff, 3, { ground: false, squash: 1 });
    k.ring(this.gx, this.gy, 8, 150 * this.u, 0.5, this.pal.deep, 0xdfe8ff, 4, { squash: this.squash, delay: 0.04 });
    k.stop(0.05, "sig-syn", 0.4);
  }

  update(dt: number, real: number): void {
    this.phaseT += dt;
    // The world drains while time is stopped.
    if (this.phase === 2) this.host.darken(0x5a606c, this.evo === "stop_the_world" ? 0.55 : 0.42);
    if (this.phase === 1) this.hand -= dt * 14;
    if (this.phase === 2) {
      // A tick each half second; the cracks grow.
      const tick = Math.floor(this.phaseT / 0.5);
      if (tick > this.lastTick) {
        this.lastTick = tick;
        this.hand += Math.PI / 30;
        this.kit.ring(this.cx, this.cy, this.R * 1.02, this.R * 1.25, 0.3, -1, 0xdfe8ff, 1.5, { ground: false, squash: 1 });
      }
      this.crack = Math.min(1, 0.35 + this.phaseT / this.freezeD);
    }
    if (this.sing && !this.sing.gone) {
      const s = this.sing;
      s.t += dt;
      const R = 16 * this.u * easeOutBack(span01(s.t, 0, 0.12));
      if (s.core) {
        s.core.position.set(s.x, s.y);
        s.core.scale.set((R * 1.2) / 32);
      }
      if (s.rim) {
        s.rim.position.set(s.x, s.y);
        s.rim.scale.set((R * 1.15) / 120);
      }
    } else if (this.sing) {
      if (this.sing.core) this.sing.core.visible = false;
      if (this.sing.rim) this.sing.rim.visible = false;
    }
    for (const st of this.stars) {
      st.t += dt;
      const k = span01(st.t, 0, 0.3);
      st.s.scale.set((0.2 + st.size * easeOutCubic(Math.min(1, k * 3))) * this.u * (1 - k * 0.5));
      st.s.alpha = 1 - k;
    }
    void real;
  }

  override paint(): void {
    const g = this.face;
    const box = this.box;
    if (!g || !box) return;
    if (this.phase === 0 || (this.phase === 3 && this.phaseT > 0.05)) {
      box.visible = this.phase !== 3;
      return;
    }
    box.visible = true;
    const R = this.R;
    const grow = this.phase === 1 ? easeOutBack(span01(this.phaseT, 0, 0.3)) : 1;
    box.scale.set(grow);
    box.alpha = this.phase === 1 ? Math.min(1, this.phaseT * 5) : 1;
    const silver = this.pal.mid;
    const ink = this.pal.deep;
    // The minute ring is drawn once and turned; the face only when its hands or cracks change
    // (a tick each half second): no geometry most frames.
    if ((this.master || this.evo === "stop_the_world") && !this.minute) {
      const m = this.graphics(box);
      const rr = R * 1.18;
      m.circle(0, 0, rr).stroke({ width: 1, color: silver, alpha: 0.5 });
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        m.moveTo(Math.cos(a) * rr * 0.96, Math.sin(a) * rr * 0.96).lineTo(Math.cos(a) * rr * 1.04, Math.sin(a) * rr * 1.04);
      }
      m.stroke({ width: 1, color: silver, alpha: 0.7 });
      this.minute = m;
    }
    if (this.minute) this.minute.rotation = -this.t * 0.6;
    const cNow = this.phase === 1 ? 0.35 * span01(this.phaseT, 0.1, 0.3) : this.crack;
    const key = Math.max(0, Math.round(4 * cNow)) * 1e6 + Math.round(this.hand * 500) + this.phase * 1e8;
    if (key === this.faceKey) return;
    this.faceKey = key;
    g.clear();
    // The face: a translucent ink disc, a silver rim, roman ticks.
    g.circle(0, 0, R).fill({ color: ink, alpha: 0.55 });
    g.circle(0, 0, R).stroke({ width: 3.2, color: silver, alpha: 0.95 });
    g.circle(0, 0, R * 0.86).stroke({ width: 1, color: silver, alpha: 0.6 });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const long = i % 3 === 0;
      g.moveTo(Math.cos(a) * R * (long ? 0.7 : 0.76), Math.sin(a) * R * (long ? 0.7 : 0.76)).lineTo(Math.cos(a) * R * 0.84, Math.sin(a) * R * 0.84);
    }
    g.stroke({ width: 1.8, color: silver, alpha: 0.95 });
    // Hands: running backwards while it forms, stopped dead while time is.
    const handCol = this.gilded ? GILT : 0xffffff;
    const ha = this.hand - Math.PI / 2;
    const ma = this.hand * 12 - Math.PI / 2;
    g.moveTo(0, 0).lineTo(Math.cos(ha) * R * 0.48, Math.sin(ha) * R * 0.48).stroke({ width: 2.6, color: handCol, alpha: 1, cap: "round" });
    g.moveTo(0, 0).lineTo(Math.cos(ma) * R * 0.72, Math.sin(ma) * R * 0.72).stroke({ width: 1.5, color: handCol, alpha: 1, cap: "round" });
    g.circle(0, 0, 2.6).fill({ color: this.gilded ? GILT_HOT : 0xffffff });
    // Electric cracks across the face (seeded: the same cracks every frame, growing).
    const c = this.phase === 1 ? 0.35 * span01(this.phaseT, 0.1, 0.3) : this.crack;
    if (c > 0) {
      for (let i = 0; i < 6; i++) {
        let a = i * 1.05 + 0.4;
        let x = Math.cos(a) * R * 0.1;
        let y = Math.sin(a) * R * 0.1;
        g.moveTo(x, y);
        const steps = Math.max(1, Math.round(4 * c));
        for (let j = 1; j <= steps; j++) {
          a += Math.sin(i * 3.7 + j * 2.3) * 0.5;
          const rr = (R * j) / 4;
          x = Math.cos(a) * rr;
          y = Math.sin(a) * rr;
          g.lineTo(x, y);
        }
      }
      g.stroke({ width: 2.4, color: ELECTRIC, alpha: 0.55 });
      for (let i = 0; i < 6; i++) {
        let a = i * 1.05 + 0.4;
        g.moveTo(Math.cos(a) * R * 0.1, Math.sin(a) * R * 0.1);
        const steps = Math.max(1, Math.round(4 * c));
        for (let j = 1; j <= steps; j++) {
          a += Math.sin(i * 3.7 + j * 2.3) * 0.5;
          g.lineTo((Math.cos(a) * R * j) / 4, (Math.sin(a) * R * j) / 4);
        }
      }
      g.stroke({ width: 0.8, color: 0xe6f0ff, alpha: 0.95 });
    }
  }

  override dispose(): void {
    super.dispose();
  }
}

void GILT_HOT;
