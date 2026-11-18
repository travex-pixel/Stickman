import { Container, Graphics, GraphicsContext, type Sprite } from "pixi.js";
import type { Vec2 } from "../../../engine/math";
import { easeInCubic, easeOutBack, easeOutCubic } from "../../anim/ease";
import { shard, softCircle } from "../../textures";
import { GILT, GILT_DEEP, GILT_HOT } from "../palette";
import { Stage, span01, type SigBeatEvent, type SigSynergyEvent } from "../stage";
import { holeTex, smokeTex, starTex } from "../textures";

/**
 * KING'S JUDGEMENT: the field falls silent, a spectral gilt hand opens above the foes, a gold sigil
 * burns into the ground beneath them, and a meteor of ink veined with gold comes down.
 *
 *   hush      the backdrop sinks to ink and stays down; a little gold dust drifts.
 *   hand      a hand of gilt light and ink, high above the target, opens finger by finger.
 *   sigil     a gold sigil draws itself on the ground over the strike (it is the warning: gold, the
 *             army's colour, never the foes' crimson), turning, pulsing faster as the fall nears.
 *   meteor    the hand closes and points; a rock of ink with glowing gold fissures falls from above
 *             the frame, smoke and embers behind it, growing as it comes.
 *   impact    the biggest blow in the game: a white-gold star, the one flash, a stop, a single shake,
 *             three rings across the ground, rock and gold thrown up, a smoking crater; the sigil
 *             breaks into shards and the hand dissolves into gold dust.
 *   shockwave a wide ring rolls out.
 *
 * Fallen Star sends smaller meteors after it across the field. Absolute Judgement turns the hand to
 * point at the boss and crowns the sigil. World Breaker opens a wider sigil, cracks the ground in
 * gold, and rolls a second shockwave. Master adds an outer ring of runes; Grandmaster burns hotter.
 */
const CTX = new Map<string, GraphicsContext>();

function ctx(key: string, draw: (g: GraphicsContext) => void): GraphicsContext {
  const hit = CTX.get(key);
  if (hit && !hit.destroyed) return hit;
  const g = new GraphicsContext();
  draw(g);
  CTX.set(key, g);
  return g;
}

/** The meteor: a jagged ink rock with gold fissures (unit radius 20). */
function rockCtx(): GraphicsContext {
  return ctx("rock", (g) => {
    const pts: number[] = [];
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 20 * (0.78 + 0.22 * Math.abs(Math.sin(i * 2.7 + 0.4)));
      pts.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.poly(pts).fill(0x15121c);
    g.poly(pts).stroke({ width: 2, color: 0x2a2238, alpha: 1 });
    // Fissures of molten gold.
    g.moveTo(-12, -6).lineTo(-3, -2).lineTo(2, -9).lineTo(10, -4).moveTo(-3, -2).lineTo(-1, 8).lineTo(7, 12).moveTo(2, -9).lineTo(4, -16);
    g.stroke({ width: 2.4, color: GILT_DEEP, alpha: 0.9 });
    g.moveTo(-12, -6).lineTo(-3, -2).lineTo(2, -9).lineTo(10, -4).moveTo(-3, -2).lineTo(-1, 8).lineTo(7, 12).moveTo(2, -9).lineTo(4, -16);
    g.stroke({ width: 0.9, color: GILT_HOT, alpha: 1 });
  });
}

/** The sigil (unit radius 100): two circles, a six-pointed star, rune ticks; a crown at its heart. */
function sigilCtx(crowned: boolean, outer: boolean): GraphicsContext {
  return ctx(`sigil|${crowned}|${outer}`, (g) => {
    g.circle(0, 0, 100).stroke({ width: 3, color: GILT, alpha: 1 });
    g.circle(0, 0, 90).stroke({ width: 1.2, color: GILT, alpha: 0.8 });
    const tri = (rot: number) => {
      const p: number[] = [];
      for (let i = 0; i < 3; i++) {
        const a = rot + (i / 3) * Math.PI * 2;
        p.push(Math.cos(a) * 88, Math.sin(a) * 88);
      }
      g.poly(p).stroke({ width: 1.6, color: GILT, alpha: 0.9 });
    };
    tri(-Math.PI / 2);
    tri(Math.PI / 2);
    g.circle(0, 0, 44).stroke({ width: 1.6, color: GILT, alpha: 0.9 });
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const r0 = i % 3 === 0 ? 90 : 94;
      g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0).lineTo(Math.cos(a) * 99, Math.sin(a) * 99);
    }
    g.stroke({ width: 1.2, color: GILT_HOT, alpha: 0.9 });
    if (crowned) {
      g.poly([-22, 10, -22, -8, -11, 2, 0, -18, 11, 2, 22, -8, 22, 10]).stroke({ width: 2.2, color: GILT_HOT, alpha: 1 });
    } else g.circle(0, 0, 8).fill({ color: GILT_HOT, alpha: 0.9 });
    if (outer) {
      g.circle(0, 0, 126).stroke({ width: 1.4, color: GILT, alpha: 0.7 });
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        g.rect(Math.cos(a) * 113 - 3, Math.sin(a) * 113 - 3, 6, 6).stroke({ width: 1, color: GILT, alpha: 0.8 });
      }
    }
  });
}

/** One finger of the hand (unit: knuckle at 0, pointing +y). */
function fingerCtx(len: number): GraphicsContext {
  return ctx(`finger|${len}`, (g) => {
    g.roundRect(-3.2, 0, 6.4, len, 3.2).fill({ color: 0x1a1522, alpha: 0.75 });
    g.roundRect(-3.2, 0, 6.4, len, 3.2).stroke({ width: 1.2, color: GILT, alpha: 0.95 });
    g.moveTo(0, len * 0.45).lineTo(0, len * 0.5).stroke({ width: 1, color: GILT_HOT, alpha: 0.8 });
  });
}

function palmCtx(): GraphicsContext {
  return ctx("palm", (g) => {
    g.roundRect(-16, -18, 32, 26, 9).fill({ color: 0x1a1522, alpha: 0.75 });
    g.roundRect(-16, -18, 32, 26, 9).stroke({ width: 1.5, color: GILT, alpha: 0.95 });
    // The wrist and a cuff of light.
    g.rect(-10, -34, 20, 16).fill({ color: 0x1a1522, alpha: 0.6 });
    g.moveTo(-12, -20).lineTo(12, -20).stroke({ width: 2, color: GILT_HOT, alpha: 0.9 });
    g.moveTo(-10, -34).lineTo(-10, -20).moveTo(10, -34).lineTo(10, -20).stroke({ width: 1.2, color: GILT, alpha: 0.7 });
  });
}

export function clearJudgementCache(): void {
  for (const c of CTX.values()) c.destroy();
  CTX.clear();
}

export class JudgementStage extends Stage {
  override focus(out: { x: number; y: number; top: number }): boolean {
    // The hand opens 175 above the ground and reaches about 60 higher.
    return !this.ended && this.centreFocus(out, 235);
  }

  private gx = 0;
  private gy = 0;
  private r = 100;
  private squash = 0.4;
  private hushT = -1;
  private hand: Container | null = null;
  private readonly fingers: Graphics[] = [];
  private palm: Graphics | null = null;
  private handT = -1;
  private handX = 0;
  private handY = 0;
  private point = 0;
  private sigilBox: Container | null = null;
  private sigil: Graphics | null = null;
  private sigilT = -1;
  private sigilD = 1.2;
  private rock: Graphics | null = null;
  private rockGlow: Sprite | null = null;
  private meteor = { ax: 0, ay: 0, bx: 0, by: 0, t: -1, d: 0.6 };
  private impactT = -1;
  private star: Sprite | null = null;
  private crater: Sprite | null = null;
  private cracks: Graphics | null = null;
  private crackT = -1;
  private readonly stars: { ax: number; ay: number; bx: number; by: number; t: number; d: number; done: boolean }[] = [];
  private emberT = 0;

  constructor(...a: ConstructorParameters<typeof Stage>) {
    super(...a);
    this.cinematic = true;
    this.tail = 1.4;
    this.place(this.cast.center, this.cast.radius);
  }

  private place(c: Vec2, r: number): void {
    const pr = this.host.proj;
    this.gx = pr.sx(c.x);
    this.gy = pr.sy(c.y);
    this.r = r * pr.unit() * (this.evo === "world_breaker" ? 1.0 : 1);
    this.squash = Math.min(0.6, Math.max(0.25, pr.dy() / pr.unit()));
  }

  onBeat(e: SigBeatEvent): void {
    switch (e.beat) {
      case "hush":
        this.hushT = 0;
        // The focus: the hush and the hand opening (anticipation), then the landing (impact).
        this.focusFor(0.45);
        break;
      case "hand":
        this.place(e.to, e.radius || this.cast.radius);
        if (!this.compact) this.openHand();
        break;
      case "sigil":
        this.place(e.to, e.radius || this.cast.radius);
        this.sigilD = Math.max(0.4, e.duration || 1.2);
        this.drawSigil();
        break;
      case "meteor":
        this.fall(e.from, e.to, e.duration || 0.6);
        break;
      case "impact":
        if (e.index > 0) this.echo(e.from, e.radius || this.cast.radius * 0.6);
        else {
          this.place(e.from, e.radius || this.cast.radius);
          this.impact();
          this.focusFor(0.4);
        }
        break;
      case "charge":
        // Legion Meteor: a risen soldier hurls itself into the fall, an ink comet with a gold head.
        this.comet(e.from, e.to);
        break;
      case "shockwave":
        this.kit.ring(this.gx, this.gy, this.r * 0.4, (e.radius || this.cast.radius * 1.8) * this.u, 0.7, this.pal.deep, GILT_HOT, 6, { squash: this.squash });
        break;
      case "second_shockwave":
        this.kit.ring(this.gx, this.gy, this.r * 0.5, (e.radius || this.cast.radius * 2.4) * this.u, 0.8, this.pal.deep, GILT, 7, { squash: this.squash });
        this.kit.ring(this.gx, this.gy, this.r * 0.3, (e.radius || this.cast.radius * 2.4) * this.u * 0.8, 0.7, -1, GILT_HOT, 3, { squash: this.squash, delay: 0.06 });
        this.kit.shake(0.18);
        this.crackT = 0;
        break;
      case "fallen_star":
        this.fallenStar(e.from, e.to);
        break;
      default:
        break;
    }
  }

  override onSynergy(e: SigSynergyEvent): void {
    void e;
  }

  private openHand(): void {
    const L = this.host.layers;
    const box = this.container(L.fx);
    this.hand = box;
    const s = this.host.proj.fs(this.cast.center.y) * (this.evo === "absolute_judgement" ? 1.5 : 1.25) * (this.gilded ? 1.08 : 1);
    box.scale.set(s);
    this.handX = this.inView(this.gx, 60 * s);
    this.handY = Math.max(this.host.proj.top() + 60 * s, this.gy - 175 * this.host.proj.fs(this.cast.center.y));
    box.position.set(this.handX, this.handY);
    const palm = new Graphics(palmCtx());
    box.addChild(palm);
    this.palm = palm;
    const lens = [22, 26, 28, 26, 19];
    const xs = [-13, -6.5, 0, 6.5, 14];
    for (let i = 0; i < 5; i++) {
      const f = new Graphics(fingerCtx(lens[i]!));
      f.position.set(xs[i]!, i === 4 ? -6 : 6);
      box.addChild(f);
      this.fingers.push(f);
    }
    // A light beneath the hand.
    const glow = this.sprite(box, softCircle(), true);
    if (glow) {
      glow.tint = GILT;
      glow.scale.set(1.2, 0.8);
      glow.position.set(0, 18);
      glow.alpha = 0.35;
    }
    this.handT = 0;
    box.alpha = 0;
  }

  private drawSigil(): void {
    const L = this.host.layers;
    if (!this.sigilBox) {
      this.sigilBox = this.container(L.ground);
      // Absolute Judgement and a crowned cast crown the sigil; so does Grandmaster's gilded form.
      this.sigil = new Graphics(sigilCtx(this.evo === "absolute_judgement" || this.enhanced || this.gilded, this.master && !this.compact));
      this.sigil.blendMode = "add";
      this.sigilBox.addChild(this.sigil);
    }
    this.sigilBox.position.set(this.gx, this.gy);
    this.sigilT = 0;
  }

  private fall(from: Vec2, to: Vec2, d: number): void {
    const pr = this.host.proj;
    this.meteor.ax = pr.sx(from.x);
    this.meteor.ay = Math.min(pr.top() - 40, from.y < 0 ? pr.top() - 60 : pr.sy(from.y));
    this.meteor.bx = pr.sx(to.x);
    this.meteor.by = pr.sy(to.y) - 10 * this.u;
    this.meteor.t = 0;
    this.meteor.d = Math.max(0.25, d);
    this.point = 0.001;
    const L = this.host.layers;
    this.rockGlow = this.sprite(L.fx, softCircle(), true);
    if (this.rockGlow) this.rockGlow.tint = GILT_DEEP;
    this.rock = new Graphics(rockCtx());
    L.fx.addChild(this.rock);
    this.kit.speedLines(this.meteor.ax, this.meteor.ay, this.meteor.bx, this.meteor.by, this.compact ? 2 : 5, 70 * this.u, GILT, this.meteor.d);
  }

  private impact(): void {
    const k = this.kit;
    this.impactT = 0;
    this.meteor.t = -1;
    if (this.rock) this.rock.visible = false;
    if (this.rockGlow) this.rockGlow.visible = false;
    const x = this.gx;
    const y = this.gy;
    const big = this.evo === "absolute_judgement" ? 1.25 : this.evo === "world_breaker" ? 1.15 : 1;
    // A white-gold star, rings across the ground, an upright ring.
    this.star = this.sprite(this.host.layers.fx, starTex(), true);
    if (this.star) {
      this.star.position.set(x, y - 20 * this.u);
      this.star.tint = GILT_HOT;
    }
    k.ring(x, y, 10, this.r * 1.2 * big, 0.45, this.pal.deep, GILT_HOT, 8, { squash: this.squash });
    // The wide shockwave rolling out after it.
    k.ring(x, y, this.r * 0.4, this.r * 1.9 * big, 0.75, this.pal.deep, GILT, 5, { squash: this.squash, delay: 0.08 });
    if (!this.compact) {
      k.ring(x, y, 6, this.r * 0.85 * big, 0.38, -1, 0xffffff, 4, { squash: this.squash, delay: 0.04 });
      k.ring(x, y - 30 * this.u, 8, this.r * 0.7 * big, 0.35, -1, GILT, 3, { ground: false, squash: 0.9 });
    }
    // Rock and gold thrown up, a dust cloud.
    const o = k.o(x, y - 10 * this.u, shard(), this.pal.ink);
    o.additive = false;
    o.speed[0] = 160;
    o.speed[1] = 420;
    o.angle[0] = -Math.PI * 0.95;
    o.angle[1] = -Math.PI * 0.05;
    o.life[0] = 0.5;
    o.life[1] = 0.9;
    o.scale[0] = 0.3;
    o.scale[1] = 0.7;
    o.gravity = 700;
    o.spin = 10;
    k.emit(this.compact ? 8 : 22);
    const s = k.o(x, y - 10 * this.u, softCircle(), GILT);
    s.speed[0] = 140;
    s.speed[1] = 380;
    s.angle[0] = -Math.PI;
    s.angle[1] = 0;
    s.life[0] = 0.3;
    s.life[1] = 0.6;
    s.scale[0] = 0.1;
    s.scale[1] = 0.25;
    s.gravity = 300;
    k.emit(this.compact ? 10 : 28);
    if (!this.compact) {
      const d = k.o(x, y, smokeTex(), 0x2a2430);
      d.additive = false;
      d.alpha = 0.6;
      d.speed[0] = 40;
      d.speed[1] = 140;
      d.angle[0] = -Math.PI;
      d.angle[1] = 0;
      d.life[0] = 0.7;
      d.life[1] = 1.2;
      d.scale[0] = 0.5;
      d.scale[1] = 0.9;
      d.endScale = 1.6;
      d.drag = 0.88;
      k.emit(10);
    }
    // The crater: an ink scar that smokes and fades.
    this.crater = this.sprite(this.host.layers.ground, holeTex(), false);
    if (this.crater) {
      this.crater.tint = 0x0a0810;
      this.crater.position.set(x, y);
    }
    if (this.gilded && !this.compact) {
      // Grandmaster: a rain of gilt sparks falls back over the crater.
      const g = k.o(x, y - 120 * this.u, softCircle(), GILT_HOT);
      g.speed[0] = 20;
      g.speed[1] = 90;
      g.angle[0] = -Math.PI;
      g.angle[1] = 0;
      g.life[0] = 0.8;
      g.life[1] = 1.3;
      g.scale[0] = 0.08;
      g.scale[1] = 0.16;
      g.gravity = 160;
      g.spread = this.r * 1.4;
      k.emit(24);
    }
    k.flash(0xfff4dc, 0.42, 0.3);
    this.host.darken(0x1a1408, 0.4);
    k.stop(0.1, "sig-judgement", 0.6);
    k.shake(0.42);
    k.punch(0.06);
  }

  /** Absolute Judgement's echo on the boss: a second, smaller blow where it stands. */
  private echo(at: Vec2, r: number): void {
    const g = this.ground(at, this.q);
    const k = this.kit;
    k.ring(g.x, g.y, 6, r * this.u * 1.3, 0.4, this.pal.deep, GILT_HOT, 5, { squash: this.squash });
    k.slash(g.x, this.host.proj.top(), g.x, g.y - 20 * this.u, GILT_DEEP, GILT_HOT, 3.5, 0.3);
    const st = this.sprite(this.host.layers.fx, starTex(), true);
    if (st) {
      st.position.set(g.x, g.y - 40 * this.u);
      st.tint = GILT_HOT;
      st.scale.set(2 * this.u);
      this.echoStar = st;
      this.echoT = 0;
    }
    k.punch(0.03);
    k.flash(0xfff0d0, 0.2, 0.15);
  }

  private echoStar: Sprite | null = null;
  private echoT = -1;
  private readonly comets: { ax: number; ay: number; bx: number; by: number; t: number; d: number; done: boolean }[] = [];

  private comet(from: Vec2, to: Vec2): void {
    const a = this.chestAt(from, this.p);
    const b = this.ground(to, this.q);
    this.comets.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, t: 0, d: 0.28, done: false });
    this.svc.label("Legion Meteor", b.x, b.y - 150 * this.u, 0xeedba0);
  }

  private fallenStar(from: Vec2, to: Vec2): void {
    const pr = this.host.proj;
    const bx = pr.sx(to.x);
    const by = pr.sy(to.y);
    const ax = pr.sx(from.x);
    const ay = from.y < 0 ? pr.top() - 30 : pr.sy(from.y);
    this.stars.push({ ax, ay, bx, by, t: 0, d: 0.32, done: false });
    this.kit.streak(ax, ay, bx, by, 80 * this.u, 2.4, GILT, 0.32);
    this.kit.streak(ax, ay, bx, by, 50 * this.u, 1, GILT_HOT, 0.3);
  }

  update(dt: number, real: number): void {
    const k = this.kit;
    // The hush holds the field down until the impact has passed.
    if (this.hushT >= 0) {
      this.hushT += dt;
      if (this.impactT < 0 || this.impactT < 0.3) this.host.darken(0x0d0b12, this.compact ? 0.25 : 0.45);
    }
    if (this.hand) {
      this.handT += dt;
      const open = easeOutBack(span01(this.handT, 0.05, 0.6));
      const box = this.hand;
      const leave = this.impactT >= 0 ? span01(this.impactT, 0, 0.5) : 0;
      box.alpha = Math.min(1, this.handT / 0.25) * (1 - leave);
      box.position.set(this.handX, this.handY + Math.sin(this.handT * 2.2) * 3 - 30 * (1 - easeOutCubic(span01(this.handT, 0, 0.5))));
      // Fingers: curled (short, angled in) to open (straight down, spread); when the meteor comes
      // the hand closes but the index points.
      const close = this.point > 0 ? easeOutCubic(span01(this.meteor.t >= 0 ? this.meteor.t : 1, 0, 0.2)) : 0;
      for (let i = 0; i < this.fingers.length; i++) {
        const f = this.fingers[i]!;
        const spread = (i - 2) * 0.16;
        const curl = 1 - open;
        const pointing = i === 1;
        const c = pointing ? 0 : close;
        f.rotation = spread * open + (i === 4 ? -0.5 : 0) * curl;
        f.scale.set(1, Math.max(0.25, 1 - 0.75 * Math.max(curl, c)));
      }
      if (leave > 0 && leave < 1 && dt > 0 && Math.random() < 0.6) {
        const o = k.o(box.x + (Math.random() - 0.5) * 40 * box.scale.x, box.y, softCircle(), GILT);
        o.speed[0] = 10;
        o.speed[1] = 40;
        o.life[0] = 0.4;
        o.life[1] = 0.8;
        o.scale[0] = 0.08;
        o.scale[1] = 0.16;
        o.gravity = -30;
        k.emit(2);
      }
    }
    if (this.sigilBox && this.sigil) {
      this.sigilT += dt;
      const draw = easeOutCubic(span01(this.sigilT, 0, 0.45));
      const urgency = span01(this.sigilT, 0, this.sigilD);
      const flare = this.impactT >= 0 ? span01(this.impactT, 0, 0.5) : 0;
      const sc = (this.r / 100) * (0.6 + 0.4 * draw) * (1 + 0.25 * flare);
      this.sigilBox.scale.set(sc, sc * this.squash);
      this.sigil.rotation = this.sigilT * (0.4 + urgency * 1.2);
      const pulse = 0.75 + 0.25 * Math.sin(this.sigilT * (6 + urgency * 18));
      this.sigil.alpha = draw * pulse * (1 - flare);
      if (flare >= 1) this.sigilBox.visible = false;
    }
    // The meteor's fall.
    const m = this.meteor;
    if (m.t >= 0 && this.rock) {
      m.t += dt;
      const kf = Math.min(1, m.t / m.d);
      const e = easeInCubic(kf) * 0.65 + kf * 0.35;
      const x = m.ax + (m.bx - m.ax) * e;
      const y = m.ay + (m.by - m.ay) * e;
      const fs = this.host.proj.fs(this.cast.center.y);
      const big = this.evo === "absolute_judgement" ? 1.35 : 1;
      const size = fs * big * (1.1 + 0.9 * e);
      this.rock.position.set(x, y);
      this.rock.scale.set(size);
      this.rock.rotation += dt * 3;
      if (this.rockGlow) {
        this.rockGlow.position.set(x, y);
        this.rockGlow.scale.set(size * 1.2);
        this.rockGlow.alpha = 0.55;
      }
      if (dt > 0) {
        this.emberT -= dt;
        if (this.emberT <= 0) {
          this.emberT = 0.03;
          const o = k.o(x, y, smokeTex(), 0x1e1826);
          o.additive = false;
          o.alpha = 0.55;
          o.speed[0] = 5;
          o.speed[1] = 25;
          o.life[0] = 0.4;
          o.life[1] = 0.7;
          o.scale[0] = 0.4 * size;
          o.scale[1] = 0.6 * size;
          o.endScale = 1.1 * size;
          k.emit(1);
          const s = k.o(x, y, softCircle(), GILT);
          s.speed[0] = 20;
          s.speed[1] = 80;
          s.life[0] = 0.2;
          s.life[1] = 0.4;
          s.scale[0] = 0.08;
          s.scale[1] = 0.16;
          k.emit(2);
        }
      }
    }
    if (this.impactT >= 0) {
      this.impactT += dt;
      if (this.star) {
        const kk = span01(this.impactT, 0, 0.45);
        this.star.scale.set((0.5 + 3.8 * easeOutCubic(Math.min(1, kk * 3))) * this.u * (1 - kk * 0.4));
        this.star.alpha = 1 - kk;
      }
      if (this.crater) {
        const kk = span01(this.impactT, 0, 2.2);
        const rr = this.r * 0.55 * (0.7 + 0.3 * easeOutCubic(Math.min(1, this.impactT * 5)));
        this.crater.scale.set(rr / 32, (rr * this.squash) / 32);
        this.crater.alpha = 0.65 * (1 - kk * kk);
      }
    }
    for (const s of this.stars) {
      if (s.done) continue;
      s.t += dt;
      if (s.t >= s.d) {
        s.done = true;
        k.ring(s.bx, s.by, 4, 46 * this.u, 0.35, this.pal.deep, GILT_HOT, 4, { squash: this.squash });
        const o = k.o(s.bx, s.by - 6, softCircle(), GILT);
        o.speed[0] = 60;
        o.speed[1] = 200;
        o.angle[0] = -Math.PI;
        o.angle[1] = 0;
        o.life[0] = 0.2;
        o.life[1] = 0.4;
        o.scale[0] = 0.1;
        o.scale[1] = 0.2;
        k.emit(8);
        k.punch(0.012);
      }
    }
    if (this.crackT >= 0) this.crackT += dt;
    if (this.echoStar && this.echoT >= 0) {
      this.echoT += dt;
      const kk = span01(this.echoT, 0, 0.35);
      this.echoStar.scale.set((0.4 + 2.2 * easeOutCubic(Math.min(1, kk * 3))) * this.u * (1 - kk * 0.4));
      this.echoStar.alpha = 1 - kk;
    }
    for (const c of this.comets) {
      if (c.done) continue;
      c.t += dt;
      const kk = Math.min(1, c.t / c.d);
      const e = kk * kk;
      const x = c.ax + (c.bx - c.ax) * e;
      const y = c.ay + (c.by - c.ay) * e - Math.sin(kk * Math.PI) * 60 * this.u;
      if (dt > 0) {
        const o = k.o(x, y, smokeTex(), this.pal.ink);
        o.additive = false;
        o.alpha = 0.6;
        o.speed[0] = 0;
        o.speed[1] = 10;
        o.life[0] = 0.2;
        o.life[1] = 0.35;
        o.scale[0] = 0.3;
        o.scale[1] = 0.45;
        k.emit(1);
        const g = k.o(x, y, softCircle(), GILT);
        g.speed[0] = 0;
        g.speed[1] = 20;
        g.life[0] = 0.12;
        g.life[1] = 0.22;
        g.scale[0] = 0.1;
        g.scale[1] = 0.16;
        k.emit(1);
      }
      if (kk >= 1) {
        c.done = true;
        k.ring(c.bx, c.by, 6, 70 * this.u, 0.4, this.pal.ink, GILT, 3, { squash: this.squash });
        k.punch(0.012);
      }
    }
    void real;
  }

  override paint(): void {
    if (this.crackT < 0) return;
    if (!this.cracks) this.cracks = this.graphics(this.host.layers.ground, true);
    const g = this.cracks;
    g.clear();
    const k = span01(this.crackT, 0, 0.25);
    const fade = 1 - span01(this.crackT, 0.6, 1.6);
    if (fade <= 0) return;
    // Gold cracks running out across the ground (World Breaker), the same each frame (seeded).
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      let x = this.gx;
      let y = this.gy;
      g.moveTo(x, y);
      const len = this.r * (1.1 + 0.5 * Math.abs(Math.sin(i * 3.1))) * k;
      for (let j = 1; j <= 4; j++) {
        const jag = Math.sin(i * 7.3 + j * 2.1) * 0.35;
        x = this.gx + Math.cos(a + jag) * (len * j) / 4;
        y = this.gy + Math.sin(a + jag) * (len * j) / 4 * this.squash;
        g.lineTo(x, y);
      }
    }
    g.stroke({ width: 2, color: GILT_DEEP, alpha: 0.8 * fade });
  }

  override dispose(): void {
    for (const f of this.fingers) f.destroy();
    this.fingers.length = 0;
    this.palm?.destroy();
    this.palm = null;
    if (this.sigil) {
      this.sigil.destroy();
      this.sigil = null;
    }
    if (this.rock) {
      this.rock.destroy();
      this.rock = null;
    }
    super.dispose();
  }
}
