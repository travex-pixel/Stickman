import type { Sprite } from "pixi.js";
import type { Vec2 } from "../../../engine/math";
import type { Rig, RigSpec } from "../../rigs/Rig";
import { easeInCubic, easeOutCubic } from "../../anim/ease";
import { softCircle } from "../../textures";
import { SHADOW_BODY } from "../../rigs/specs";
import { GILT, GILT_HOT } from "../palette";
import { Stage, span01, type SigBeatEvent } from "../stage";
import { holeTex, smokeTex } from "../textures";

/**
 * LEGION AWAKENING: the field darkens; ink pools open where foes fell and slate soldiers with gold
 * eyes claw up out of them, form a rank, and charge.
 *
 *   darken  the backdrop sinks to night and holds there for the cast.
 *   rise    an ink pool opens on the ground (a gold spark ring at its lip), and a soldier rises out of
 *           it (the shadow army's own re-forming), its eyes lighting last.
 *   charge  a gold war-line flares under the rank; the soldiers run at the foes with speed lines and
 *           dust, strike, and sink back into ink.
 *
 * When the simulation raises real soldiers (temporary summons), the director dresses them (pools,
 * eye flare, speed lines) and lets the fight move them; it draws stand-ins only when it is given no
 * bodies (the preview, or a compact cast). Endless Legion raises more, quicker. Veteran Souls raises
 * a few big armoured veterans in greatswords who do not sink at the end. Legion Commander gives each
 * soldier the colours of a fielded role (vanguard, ranger, arcanist, blade). Master lights a gold
 * standard-line under the rank; Grandmaster gilds them.
 */
interface Soldier {
  id: number;
  rig: Rig | null;
  pool: Sprite | null;
  x: number;
  y: number;
  depth: number;
  scale: number;
  t: number;
  facing: 1 | -1;
  charge: { x: number; y: number } | null;
  chargeT: number;
  role: number;
}

const ROLE_ACCENT = [0xd9a35a, 0x8fe0c4, 0xb59cf0, 0x9fb4d0];

export class LegionStage extends Stage {
  private readonly soldiers: Soldier[] = [];
  private darkT = -1;
  /** The night holds for the darken beat's time (the soldiers fight on after it, in daylight). */
  private darkD = 1.3;
  private chargeT = -1;
  private lineT = -1;

  constructor(...a: ConstructorParameters<typeof Stage>) {
    super(...a);
    this.cinematic = true;
    this.tail = 0.9;
  }

  private spec(role: number): RigSpec {
    const eye = this.gilded ? GILT_HOT : 0xfff0c2;
    const body = this.gilded ? 0x5a5648 : SHADOW_BODY;
    if (this.evo === "veteran_souls") return { style: "warden", weapon: "greatsword", body, accent: GILT, eye, glow: GILT, height: 118, cape: true, finish: "shadow", horns: true };
    if (this.evo === "legion_commander") {
      const accent = ROLE_ACCENT[role % 4]!;
      if (role % 4 === 0) return { style: "bulky", weapon: "mace_shield", body, accent, eye, glow: GILT, height: 112, finish: "shadow", horns: true };
      if (role % 4 === 1) return { style: "archer", weapon: "bow", body, accent, eye, glow: GILT, height: 96, hood: true, finish: "shadow" };
      if (role % 4 === 2) return { style: "robed", weapon: "staff", body, accent, eye, glow: GILT, height: 100, hood: true, finish: "shadow" };
      return { style: "reaper", weapon: "twin", body, accent, eye, glow: GILT, height: 98, cape: true, finish: "shadow" };
    }
    return { style: "reaper", weapon: role % 2 === 0 ? "dagger" : "twin", body, accent: GILT, eye, glow: GILT, height: 94, hood: role % 3 === 0, finish: "shadow" };
  }

  onBeat(e: SigBeatEvent): void {
    switch (e.beat) {
      case "darken":
        this.darkT = 0;
        this.darkD = Math.max(0.5, e.duration || 1.3);
        break;
      case "rise": {
        // One beat names every soldier raised (real temporary summons where foes fell). Without any
        // (a development cast), stand-ins rise in a rank beside the warrior.
        if (e.targetIds.length > 0) e.targetIds.forEach((id, i) => this.rise(e.from, id, i + 1));
        else {
          const n = this.evo === "endless_legion" ? 8 : this.evo === "veteran_souls" ? 3 : 5;
          for (let i = 0; i < n; i++) this.rise({ x: e.from.x - 34 + (i % 3) * 24 - (i > 2 ? 12 : 0), y: Math.max(16, Math.min(134, e.from.y - 44 + i * 22)) }, -1, i + 1);
        }
        break;
      }
      case "charge":
        this.charge(e);
        break;
      default:
        break;
    }
  }

  private rise(at: Vec2, id: number, index: number): void {
    const pr = this.host.proj;
    const real = id >= 0 && this.body(id) && this.b.ally;
    const x = real ? this.b.x : pr.sx(at.x);
    const y = real ? this.b.y : pr.sy(at.y);
    const scale = pr.fs(real ? this.b.wy : at.y) * (this.evo === "veteran_souls" ? 1.05 : 1);
    const pool = this.sprite(this.host.layers.ground, holeTex(), false);
    if (pool) {
      pool.tint = this.pal.ink;
      pool.position.set(x, y);
      pool.scale.set(0.01);
    }
    let rig: Rig | null = null;
    if (!real) {
      rig = this.rig(`legion-${this.evo ?? "base"}-${this.evo === "legion_commander" ? index % 4 : index % 2}-${this.gilded}`, this.spec(index));
      if (rig) {
        rig.root.position.set(x, y);
        rig.root.scale.set(scale);
        rig.root.zIndex = at.y;
      }
    }
    this.soldiers.push({ id: real ? id : -1, rig, pool, x, y, depth: real ? this.b.wy : at.y, scale, t: 0, facing: 1, charge: null, chargeT: 0, role: index });
    // A gold spark ring at the pool's lip.
    const sq = Math.min(0.6, Math.max(0.25, pr.dy() / pr.unit()));
    this.kit.ring(x, y, 4, 26 * scale, 0.45, this.pal.ink, this.compact ? -1 : GILT, 2, { squash: sq });
    const o = this.kit.o(x, y, softCircle(), GILT);
    o.speed[0] = 20;
    o.speed[1] = 70;
    o.angle[0] = -Math.PI * 0.85;
    o.angle[1] = -Math.PI * 0.15;
    o.life[0] = 0.4;
    o.life[1] = 0.7;
    o.scale[0] = 0.08;
    o.scale[1] = 0.16;
    o.gravity = -20;
    o.spread = 18 * scale;
    this.kit.emit(5);
  }

  private charge(e: SigBeatEvent): void {
    // After the charge the soldiers are only fighters: the cast stops counting as a cinematic.
    this.cinematic = false;
    this.chargeT = 0;
    this.lineT = 0;
    // The charge runs at the group (`to`); stand-ins spread round it, real soldiers are the fight's.
    const foes: { x: number; y: number }[] = [];
    this.host.each("enemy", (id) => {
      if (foes.length < 8 && this.body(id)) foes.push({ x: this.b.x, y: this.b.y });
    });
    if (foes.length === 0) {
      const c = this.ground(e.to, this.q);
      foes.push({ x: c.x, y: c.y });
    }
    this.soldiers.forEach((s, i) => {
      const f = foes[i % foes.length]!;
      const side = s.x <= f.x ? -1 : 1;
      s.charge = { x: f.x + side * 22 * this.u, y: f.y + ((i % 3) - 1) * 4 * this.u };
      s.facing = side === -1 ? 1 : -1;
      s.chargeT = 0;
    });
    // A war-cry ring of gold round the rank.
    if (this.soldiers.length > 0 && !this.compact) {
      let cx = 0;
      let cy = 0;
      for (const s of this.soldiers) {
        cx += s.x;
        cy += s.y;
      }
      cx /= this.soldiers.length;
      cy /= this.soldiers.length;
      const pr = this.host.proj;
      this.kit.ring(cx, cy, 10, 90 * this.u, 0.45, this.pal.ink, GILT, 3, { squash: Math.min(0.6, Math.max(0.25, pr.dy() / pr.unit())) });
      this.kit.punch(0.02);
    }
  }

  update(dt: number, real: number): void {
    const k = this.kit;
    if (this.darkT >= 0) this.darkT += dt;
    if (this.darkT >= 0 && this.darkT < this.darkD && !this.ended) this.host.darken(0x0b0a12, this.compact ? 0.3 : 0.5);
    if (this.chargeT >= 0) this.chargeT += dt;
    if (this.lineT >= 0) this.lineT += dt;
    const sinking = this.ended && this.evo !== "veteran_souls";
    for (const s of this.soldiers) {
      s.t += dt;
      const poolK = s.t < 0.35 ? easeOutCubic(s.t / 0.35) : sinking ? 1 - span01(this.sinceEnd, 0.2, 0.7) : 1 - 0.4 * span01(s.t, 0.5, 1.4);
      if (s.pool) {
        const r = 26 * s.scale * poolK;
        const sq = 0.4;
        s.pool.scale.set(r / 32, (r * sq) / 32);
        s.pool.alpha = 0.85;
      }
      if (s.id >= 0) {
        // A real soldier: the fight moves it; speed lines while it runs.
        if (this.body(s.id)) {
          s.x = this.b.x;
          s.y = this.b.y;
          const m = this.svc.mod(s.id);
          m.white = Math.max(m.white, s.t < 0.6 ? 0.25 * (1 - s.t / 0.6) : 0);
          // Legion Commander: each soldier carries a fielded role's colour.
          if (this.evo === "legion_commander" && !this.ended) {
            m.tint = ROLE_ACCENT[s.role % 4]!;
            m.tintK = Math.max(m.tintK, 0.35);
          }
          if (s.charge && s.chargeT < 0.6 && dt > 0 && Math.random() < 0.3) k.speedLines(s.x - s.facing * 40 * this.u, s.y - 40 * s.scale, s.x, s.y - 40 * s.scale, 1, 30 * s.scale, 0xe8e2d8, 0.15);
        }
        continue;
      }
      const rig = s.rig;
      if (!rig) continue;
      if (s.charge && this.chargeT >= 0) {
        s.chargeT += dt;
        const run = span01(s.chargeT, 0, 0.5);
        const e = easeInCubic(run) * 0.4 + run * 0.6;
        const x = s.x + (s.charge.x - s.x) * e;
        const y = s.y + (s.charge.y - s.y) * e;
        rig.root.position.set(x, y);
        if (run < 1) {
          rig.animate("move", s.chargeT, 0.5, 0.3 + s.role * 0.1, s.facing, true, 1, 0, real, 0);
          if (dt > 0 && Math.random() < (this.profile.secondary ? 0.5 : 0.2)) k.speedLines(x - s.facing * 50 * this.u, y - 40 * s.scale, x, y - 40 * s.scale, 1, 30 * s.scale, 0xe8e2d8, 0.16);
          if (dt > 0 && !this.compact && Math.random() < 0.3) {
            const o = k.o(x, y, softCircle(), 0x5a5048);
            o.additive = false;
            o.alpha = 0.5;
            o.speed[0] = 10;
            o.speed[1] = 40;
            o.angle[0] = -Math.PI;
            o.angle[1] = 0;
            o.life[0] = 0.3;
            o.life[1] = 0.5;
            o.scale[0] = 0.2;
            o.scale[1] = 0.35;
            k.emit(1);
          }
        } else {
          const at = s.chargeT - 0.5;
          if (at < 0.13) rig.animate("windup", at, 0.13, 0.3, s.facing, false, 0, 0, real, s.role % 3);
          else rig.animate("attack", at - 0.13, 0.12, 0.3, s.facing, false, 0, 0, real, s.role % 3);
          if (at >= 0.13 && at - dt < 0.13 && dt > 0) k.cut(s.charge.x + s.facing * 18 * this.u, s.charge.y - 45 * s.scale, 24 * s.scale, s.facing === 1 ? -2.2 : -0.9, s.facing * 1.6, this.pal.ink, GILT_HOT, 2.2, 0.2);
        }
      } else {
        rig.root.position.set(s.x, s.y);
        if (s.t < 0.6) rig.animate("emerge", s.t, 0.6, 0.3 + s.role * 0.1, s.facing, false, 0, 0, real, 0);
        else rig.animate("idle", s.t, 0, 0.3 + s.role * 0.1, s.facing, false, 0, 0, real, 0);
      }
      // Sinking back into ink at the end.
      const sink = sinking ? span01(this.sinceEnd, 0, 0.5) : 0;
      rig.root.alpha = 1 - sink;
      if (sink > 0 && sink < 1 && dt > 0 && Math.random() < 0.4) {
        const o = k.o(rig.root.x, rig.root.y - 30 * s.scale, smokeTex(), this.pal.ink);
        o.additive = false;
        o.alpha = 0.5;
        o.speed[0] = 5;
        o.speed[1] = 25;
        o.angle[0] = -Math.PI * 0.8;
        o.angle[1] = -Math.PI * 0.2;
        o.life[0] = 0.3;
        o.life[1] = 0.6;
        o.scale[0] = 0.25;
        o.scale[1] = 0.4;
        k.emit(1);
      }
    }
  }

  override paint(): void {
    // Master: the gold standard-line under the rank as it charges.
    if (!this.master || this.lineT < 0 || this.compact || this.soldiers.length < 2) return;
    const g = this.kit.groundLight;
    const fade = 1 - span01(this.lineT, 0.2, 0.9);
    if (fade <= 0) return;
    // Through the rank from the far end to the near (the soldiers are kept in rising order of depth).
    let first = true;
    for (const s of this.soldiers) {
      const x = s.rig ? s.rig.root.x : s.x;
      const y = s.rig ? s.rig.root.y : s.y;
      if (first) g.moveTo(x, y);
      else g.lineTo(x, y);
      first = false;
    }
    g.stroke({ width: 3, color: GILT, alpha: 0.7 * fade });
  }

  override dispose(): void {
    this.soldiers.length = 0;
    super.dispose();
  }
}
