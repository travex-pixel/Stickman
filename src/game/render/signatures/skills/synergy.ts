import { Graphics, type Sprite } from "pixi.js";
import { easeInCubic, easeOutBack, easeOutCubic } from "../../anim/ease";
import { shard, softCircle } from "../../textures";
import { GILT, GILT_HOT } from "../palette";
import { Stage, span01, type SigBeatEvent, type SigSynergyEvent, type SigCastEvent, type StageServices } from "../stage";
import type { SigHost } from "../host";
import type { SigKit } from "../kit";
import type { SigPalette } from "../palette";
import { glowRingTex, holeTex, starTex } from "../textures";
import { crownContext } from "./sovereign";

/**
 * The combinations that need a moment of their own on the field (the others reshape their skill's
 * own staging: Gravity Feast bends the dragon's path, Hunter's Parade and Blade Parade live in Death
 * Parade's stage):
 *
 *  - Frozen Singularity: when time resumes, a small singularity opens where the frozen stood; the
 *    glass of every frozen body streams into it and it implodes (even with Void Collapse cooling).
 *  - Legion Meteor: the risen soldiers hurl themselves into the meteor's fall as ink comets, each
 *    adding a ring of its own to the impact.
 *  - Crowned Ultimate: a gilt crown flares over the warrior as the ultimate goes off, a gold ring
 *    round him (the crowned form of the skill itself is drawn by its own stage).
 */
export class SynergyStage extends Stage {
  private readonly syn: SigSynergyEvent;
  private cx = 0;
  private cy = 0;
  private gx = 0;
  private gy = 0;
  private core: Sprite | null = null;
  private rim: Sprite | null = null;
  private star: Sprite | null = null;
  private crown: Graphics | null = null;
  private readonly comets: { ax: number; ay: number; t: number; d: number; done: boolean }[] = [];
  private imploded = false;

  constructor(kit: SigKit, host: SigHost, svc: StageServices, pal: SigPalette, cast: SigCastEvent, compact: boolean, syn: SigSynergyEvent, owner: Stage | null) {
    super(kit, host, svc, pal, cast, compact);
    void owner;
    this.syn = syn;
    this.tail = 0.1;
    const pr = host.proj;
    this.gx = pr.sx(syn.pos.x);
    this.gy = pr.sy(syn.pos.y);
    this.cx = this.gx;
    this.cy = this.gy - 70 * pr.fs(syn.pos.y);
    this.begin();
  }

  onBeat(e: SigBeatEvent): void {
    void e;
  }

  private begin(): void {
    const L = this.host.layers;
    const k = this.kit;
    switch (this.syn.synergy) {
      case "frozen_singularity": {
        this.core = this.sprite(L.fx, holeTex(), false);
        if (this.core) this.core.tint = 0x000000;
        this.rim = this.sprite(L.fx, glowRingTex(), true);
        if (this.rim) this.rim.tint = 0xdfe8ff;
        for (const id of this.syn.targetIds) {
          if (!this.body(id)) continue;
          const x = this.b.x;
          const y = this.b.y - this.b.chestY;
          k.streak(x, y, this.cx, this.cy, 50 * this.u, 1.4, 0xdfe8ff, 0.4);
          const o = k.o(x, y, shard(), 0xdfe8ff);
          o.target = { x: this.cx, y: this.cy, strength: 18 };
          o.speed[0] = 20;
          o.speed[1] = 80;
          o.life[0] = 0.35;
          o.life[1] = 0.5;
          o.scale[0] = 0.15;
          o.scale[1] = 0.3;
          o.spin = 8;
          k.emit(6);
          o.target = undefined;
        }
        break;
      }
      case "legion_meteor": {
        const allies: { x: number; y: number }[] = [];
        for (const id of this.syn.targetIds) if (this.body(id) && this.b.ally) allies.push({ x: this.b.x, y: this.b.y - this.b.chestY });
        if (allies.length === 0) for (let i = 0; i < 3; i++) allies.push({ x: this.gx - (80 + i * 40) * this.u, y: this.gy - 40 * this.u });
        allies.slice(0, 8).forEach((a, i) => {
          this.comets.push({ ax: a.x, ay: a.y, t: -i * 0.06, d: 0.32, done: false });
        });
        for (const id of this.syn.targetIds) if (this.body(id) && this.b.ally) this.svc.mod(id).alpha = 0.2;
        break;
      }
      case "crowned_ultimate": {
        if (this.body(this.host.playerId())) {
          this.crown = new Graphics(crownContext());
          L.fx.addChild(this.crown);
          k.ring(this.b.x, this.b.y, 6, 70 * this.u, 0.6, this.pal.deep, GILT_HOT, 3, { squash: 0.35 });
          k.flash(0xf3e6c4, 0.2, 0.2);
        }
        break;
      }
      default:
        break;
    }
  }

  update(dt: number, real: number): void {
    const k = this.kit;
    const t = this.t;
    switch (this.syn.synergy) {
      case "frozen_singularity": {
        const grow = easeOutBack(span01(t, 0, 0.2));
        const gone = this.imploded ? 1 : 0;
        const R = 12 * this.u * 1.4 * grow * (t > 0.4 ? 1 - easeInCubic(span01(t, 0.4, 0.46)) : 1);
        if (this.core) {
          this.core.position.set(this.cx, this.cy);
          this.core.scale.set((R * 1.2) / 32);
          this.core.visible = !gone;
        }
        if (this.rim) {
          this.rim.position.set(this.cx, this.cy);
          this.rim.scale.set((R * 1.15) / 120);
          this.rim.visible = !gone;
        }
        if (!this.imploded && t >= 0.46) {
          this.imploded = true;
          this.star = this.sprite(this.host.layers.fx, starTex(), true);
          if (this.star) {
            this.star.position.set(this.cx, this.cy);
            this.star.tint = 0xe6f0ff;
          }
          k.ring(this.gx, this.gy, 8, 140 * this.u, 0.5, this.pal.deep, 0xdfe8ff, 4, { squash: 0.36 });
          k.ring(this.cx, this.cy, 4, 60 * this.u, 0.3, -1, 0xffffff, 2.5, { ground: false, squash: 1 });
          k.flash(0xe0e8ff, 0.24, 0.18);
          k.stop(0.05, "sig-syn", 0.4);
        }
        if (this.star) {
          const kk = span01(t, 0.46, 0.8);
          this.star.scale.set((0.3 + 2 * easeOutCubic(Math.min(1, kk * 3))) * this.u * (1 - kk * 0.4));
          this.star.alpha = 1 - kk;
        }
        if (t > 0.95 && !this.ended) this.onEnd(false);
        break;
      }
      case "legion_meteor": {
        for (const c of this.comets) {
          if (c.done) continue;
          c.t += dt;
          if (c.t < 0) continue;
          const kk = Math.min(1, c.t / c.d);
          if (dt > 0) {
            // Up and over into the fall point.
            const e = easeInCubic(kk);
            const lift = Math.sin(kk * Math.PI) * 70 * this.u;
            const x = c.ax + (this.gx - c.ax) * e;
            const y = c.ay + (this.gy - c.ay) * e - lift;
            const o = k.o(x, y, softCircle(), this.pal.ink);
            o.additive = false;
            o.speed[0] = 0;
            o.speed[1] = 10;
            o.life[0] = 0.2;
            o.life[1] = 0.35;
            o.scale[0] = 0.35;
            o.scale[1] = 0.5;
            k.emit(1);
            const g = k.o(x, y, softCircle(), GILT);
            g.speed[0] = 0;
            g.speed[1] = 20;
            g.life[0] = 0.15;
            g.life[1] = 0.25;
            g.scale[0] = 0.08;
            g.scale[1] = 0.14;
            k.emit(1);
          }
          if (kk >= 1) {
            c.done = true;
            k.ring(this.gx, this.gy, 6, 70 * this.u, 0.4, this.pal.ink, GILT, 3, { squash: 0.36 });
            k.punch(0.01);
          }
        }
        if (this.comets.every((c) => c.done) && !this.ended) this.onEnd(false);
        break;
      }
      case "crowned_ultimate": {
        if (this.crown && this.body(this.host.playerId())) {
          const b = this.b;
          const form = easeOutBack(span01(t, 0, 0.3));
          const fade = 1 - span01(t, 0.8, 1.2);
          this.crown.position.set(b.x, b.y - b.height - 16 * b.scale);
          this.crown.scale.set(b.scale * 0.9 * form);
          this.crown.alpha = fade;
          if (dt > 0 && Math.random() < 0.5) {
            const o = k.o(b.x + (Math.random() - 0.5) * 30 * b.scale, b.y - b.height * 0.5, softCircle(), GILT);
            o.speed[0] = 20;
            o.speed[1] = 60;
            o.angle[0] = -Math.PI * 0.7;
            o.angle[1] = -Math.PI * 0.3;
            o.life[0] = 0.4;
            o.life[1] = 0.7;
            o.scale[0] = 0.06;
            o.scale[1] = 0.14;
            k.emit(1);
          }
        }
        if (t > 1.25 && !this.ended) this.onEnd(false);
        break;
      }
      default:
        if (!this.ended) this.onEnd(false);
        break;
    }
    void real;
    void GILT_HOT;
  }

  override dispose(): void {
    if (this.crown) {
      this.crown.destroy();
      this.crown = null;
    }
    if (this.syn.synergy === "legion_meteor") for (const id of this.syn.targetIds) this.svc.mod(id).alpha = 1;
    super.dispose();
  }
}
