import { Graphics, GraphicsContext, type Container, type Sprite } from "pixi.js";
import { easeOutBack, easeOutCubic } from "../../anim/ease";
import { softCircle } from "../../textures";
import { GILT, GILT_HOT } from "../palette";
import { Stage, span01, type SigBeatEvent } from "../stage";
import { holeTex, starTex } from "../textures";

/**
 * SOVEREIGN AWAKENING: the army kneels, a crown of shadow and gold forms over the warrior, and for a
 * time he is the Sovereign.
 *
 *   kneel          the field darkens; every shadow of his army drops to one knee.
 *   crown          a column of violet ink rises round him, gold light gathers above his head and the
 *                  crown draws itself, spike by spike; the camera leans in; it settles on his brow with
 *                  a ring and the one flash.
 *   aura           for the reign: a slow violet ring at his feet, a small gilt crown floating above
 *                  his head, his cape washed violet, motes of gold rising now and then. Light enough to
 *                  fight under for ten seconds (and drawn once, only moved).
 *   sovereign_end  the crown breaks into gold dust and the aura fades.
 *
 * It sits with the Apex form if he has one: the crown floats above the Stormcrown halo. Master adds a
 * second, counter-turning ring at his feet; Grandmaster gilds the column.
 */
const CTX = new Map<string, GraphicsContext>();

export function crownContext(): GraphicsContext {
  const hit = CTX.get("crown");
  if (hit && !hit.destroyed) return hit;
  const g = new GraphicsContext();
  // Unit: 40 wide, band at y 0..8, spikes up to -26.
  const pts = [-20, 8, -20, -6, -14, 2, -10, -22, -5, 0, 0, -28, 5, 0, 10, -22, 14, 2, 20, -6, 20, 8];
  g.poly(pts).fill({ color: 0x1a1426, alpha: 0.92 });
  g.poly(pts).stroke({ width: 2, color: GILT, alpha: 1, join: "miter" });
  g.moveTo(-20, 2).lineTo(20, 2).stroke({ width: 1.2, color: GILT_HOT, alpha: 0.9 });
  for (const [x, y] of [[-10, -22], [0, -28], [10, -22]] as const) g.circle(x, y, 2.2).fill({ color: GILT_HOT, alpha: 1 });
  g.circle(0, 5, 2.4).fill({ color: 0xb59cf0, alpha: 1 });
  CTX.set("crown", g);
  return g;
}

export function clearSovereignCache(): void {
  for (const c of CTX.values()) c.destroy();
  CTX.clear();
}

export class SovereignStage extends Stage {
  private kneelT = -1;
  private kneelD = 0.6;
  private crownT = -1;
  private crownD = 1;
  private auraT = -1;
  private auraD = 10;
  private endT = -1;
  private readonly army: number[] = [];
  private crown: Graphics | null = null;
  private crownGlow: Sprite | null = null;
  private column: Sprite | null = null;
  private feet: Container | null = null;
  private ring: Graphics | null = null;
  private ring2: Graphics | null = null;
  private pushId = 0;
  private moteT = 0;
  private settled = false;

  constructor(...a: ConstructorParameters<typeof Stage>) {
    super(...a);
    this.cinematic = true;
    this.tail = 0.7;
  }

  onBeat(e: SigBeatEvent): void {
    switch (e.beat) {
      case "kneel":
        this.kneelT = 0;
        this.kneelD = Math.max(0.3, e.duration || 0.6);
        this.army.length = 0;
        for (const id of e.targetIds) this.army.push(id);
        if (this.army.length === 0) this.host.each("ally", (id) => this.army.push(id));
        break;
      case "crown":
        this.startCrown(e.duration || 1);
        // The focus: the crown drawing itself (the army kneels as part of it, so it is not dimmed).
        this.focusArmy = false;
        this.focusFor(Math.min(0.6, e.duration || 1));
        break;
      case "aura":
        this.auraT = 0;
        this.auraD = Math.max(1, e.duration || 10);
        this.cinematic = false;
        if (!this.crown) {
          this.crown = new Graphics(crownContext());
          this.host.layers.fx.addChild(this.crown);
        }
        break;
      case "sovereign_end":
        this.endT = 0;
        break;
      default:
        break;
    }
  }

  private startCrown(d: number): void {
    this.crownT = 0;
    this.crownD = Math.max(0.4, d);
    const L = this.host.layers;
    this.column = this.sprite(L.fx, holeTex(), false);
    if (this.column) this.column.tint = this.gilded ? 0x3a2c18 : this.pal.mid;
    this.crownGlow = this.sprite(L.fx, softCircle(), true);
    if (this.crownGlow) this.crownGlow.tint = GILT;
    this.crown = new Graphics(crownContext());
    L.fx.addChild(this.crown);
    if (this.body(this.host.playerId()) && !this.compact) this.pushId = this.kit.pushIn(this.b.x, this.b.y - this.b.height * 0.6, 1.14, 0.4, this.crownD * 0.6, 0.6);
  }

  private settle(x: number, y: number): void {
    this.settled = true;
    const k = this.kit;
    k.ring(x, y, 4, 80 * this.u, 0.5, this.pal.deep, GILT_HOT, 4, { ground: false, squash: 0.35 });
    const st = this.sprite(this.host.layers.fx, starTex(), true);
    if (st) {
      st.position.set(x, y);
      st.tint = GILT_HOT;
      this.star = st;
    }
    k.flash(0xf3e6c4, 0.3, 0.25);
    k.punch(0.03);
    const o = k.o(x, y, softCircle(), GILT);
    o.speed[0] = 60;
    o.speed[1] = 200;
    o.life[0] = 0.4;
    o.life[1] = 0.7;
    o.scale[0] = 0.1;
    o.scale[1] = 0.2;
    k.emit(16);
  }

  private star: Sprite | null = null;
  private starT = 0;

  update(dt: number, real: number): void {
    const pid = this.host.playerId();
    const has = this.body(pid);
    const b = this.b;
    // The army kneels from the kneel through the crown.
    if (this.kneelT >= 0) {
      this.kneelT += dt;
      const holding = this.kneelT < this.kneelD + (this.crownT >= 0 ? this.crownD : 0.4);
      if (holding) for (const id of this.army) this.svc.mod(id).kneel = true;
      if (!this.ended && this.auraT < 0) this.host.darken(0x0c0a14, this.compact ? 0.3 : 0.55);
    }
    if (this.crownT >= 0 && has) {
      this.crownT += dt;
      const k = span01(this.crownT, 0, this.crownD);
      const top = b.y - b.height;
      const s = b.scale;
      // The column of ink rising round him.
      if (this.column) {
        const rise = easeOutCubic(span01(k, 0, 0.5));
        const fade = this.auraT >= 0 ? 1 - span01(this.auraT, 0, 0.5) : 1;
        this.column.position.set(b.x, b.y - b.height * 0.5 * rise);
        this.column.scale.set((30 * s) / 32, (b.height * 0.6 * rise + 10) / 32);
        this.column.alpha = 0.55 * fade;
      }
      // The crown draws itself above him, then settles onto his head.
      const form = easeOutBack(span01(k, 0.15, 0.7));
      const drop = easeOutCubic(span01(k, 0.75, 1));
      const cy = top - (46 - 30 * drop) * s;
      if (this.crown && this.auraT < 0) {
        this.crown.position.set(b.x, cy);
        this.crown.scale.set(s * (1.4 - 0.5 * drop) * form);
        this.crown.alpha = Math.min(1, form * 1.4);
      }
      if (this.crownGlow && this.auraT < 0) {
        this.crownGlow.position.set(b.x, cy - 8 * s);
        this.crownGlow.scale.set(s * (0.9 + 0.6 * form));
        this.crownGlow.alpha = 0.5 * form;
      }
      if (dt > 0 && k < 0.8 && Math.random() < 0.7) {
        const o = this.kit.o(b.x + (Math.random() - 0.5) * 40 * s, b.y, softCircle(), Math.random() < 0.5 ? GILT : this.pal.accent);
        o.speed[0] = 40;
        o.speed[1] = 120;
        o.angle[0] = -Math.PI * 0.6;
        o.angle[1] = -Math.PI * 0.4;
        o.life[0] = 0.4;
        o.life[1] = 0.7;
        o.scale[0] = 0.08;
        o.scale[1] = 0.18;
        o.target = { x: b.x, y: cy, strength: 6 };
        this.kit.emit(2);
        o.target = undefined;
      }
      if (!this.settled && k >= 1) this.settle(b.x, cy);
    }
    if (this.star) {
      this.starT += dt;
      const k = span01(this.starT, 0, 0.4);
      this.star.scale.set((0.3 + 2.4 * easeOutCubic(Math.min(1, k * 3))) * this.u * (1 - k * 0.5));
      this.star.alpha = 1 - k;
    }
    // The reign: a ring at his feet, a small crown above him, a violet cape.
    if (this.auraT >= 0 && has) {
      this.auraT += dt;
      const fadeOut = this.endT >= 0 ? 1 - span01(this.endT, 0, 0.5) : 1;
      const fadeIn = span01(this.auraT, 0, 0.4);
      const a = fadeIn * fadeOut;
      if (!this.feet) {
        this.feet = this.container(this.host.layers.ground);
        this.ring = this.graphics(this.feet, true);
        this.ring.circle(0, 0, 30).stroke({ width: 2.4, color: this.pal.accent, alpha: 0.85 });
        for (let i = 0; i < 12; i++) {
          const an = (i / 12) * Math.PI * 2;
          this.ring.moveTo(Math.cos(an) * 26, Math.sin(an) * 26).lineTo(Math.cos(an) * 34, Math.sin(an) * 34);
        }
        this.ring.stroke({ width: 1.4, color: GILT, alpha: 0.9 });
        if (this.master && !this.compact) {
          this.ring2 = this.graphics(this.feet, true);
          this.ring2.circle(0, 0, 40).stroke({ width: 1, color: GILT, alpha: 0.7 });
          for (let i = 0; i < 6; i++) {
            const an = (i / 6) * Math.PI * 2;
            this.ring2.circle(Math.cos(an) * 40, Math.sin(an) * 40, 2).fill({ color: GILT_HOT, alpha: 0.9 });
          }
        }
      }
      const sq = Math.min(0.6, Math.max(0.25, this.host.proj.dy() / this.host.proj.unit()));
      this.feet.position.set(b.x, b.y);
      this.feet.scale.set(b.scale * 1.1, b.scale * 1.1 * sq);
      this.feet.alpha = a;
      if (this.ring) this.ring.rotation = this.auraT * 0.6;
      if (this.ring2) this.ring2.rotation = -this.auraT * 0.4;
      if (this.crown) {
        const bob = Math.sin(this.auraT * 2.4) * 2 * b.scale;
        this.crown.position.set(b.x, b.y - b.height - 14 * b.scale + bob);
        this.crown.scale.set(b.scale * 0.72);
        this.crown.alpha = a;
      }
      if (this.crownGlow) {
        this.crownGlow.position.set(b.x, b.y - b.height - 18 * b.scale);
        this.crownGlow.scale.set(b.scale * 0.6);
        this.crownGlow.alpha = 0.3 * a;
      }
      if (b.rig) b.rig.setCapeTint(a > 0.05 ? 0xb8a2e8 : 0xffffff);
      if (dt > 0 && this.profile.secondary) {
        this.moteT -= dt;
        if (this.moteT <= 0) {
          this.moteT = 0.25;
          const o = this.kit.o(b.x + (Math.random() - 0.5) * 30 * b.scale, b.y - 4, softCircle(), GILT);
          o.speed[0] = 10;
          o.speed[1] = 30;
          o.angle[0] = -Math.PI * 0.6;
          o.angle[1] = -Math.PI * 0.4;
          o.life[0] = 0.8;
          o.life[1] = 1.2;
          o.scale[0] = 0.06;
          o.scale[1] = 0.12;
          o.alpha = 0.8 * a;
          this.kit.emit(1);
        }
      }
    }
    if (this.endT >= 0) {
      const before = this.endT;
      this.endT += dt;
      if (before === 0 && this.crown && has) {
        const o = this.kit.o(this.crown.x, this.crown.y, softCircle(), GILT);
        o.speed[0] = 30;
        o.speed[1] = 90;
        o.life[0] = 0.4;
        o.life[1] = 0.8;
        o.scale[0] = 0.08;
        o.scale[1] = 0.16;
        o.gravity = -20;
        this.kit.emit(14);
      }
    }
    void real;
  }

  override dispose(): void {
    if (this.body(this.host.playerId()) && this.b.rig) this.b.rig.setCapeTint(0xffffff);
    if (this.crown) {
      this.crown.destroy();
      this.crown = null;
    }
    if (this.pushId) this.kit.releasePush(this.pushId);
    super.dispose();
  }
}
