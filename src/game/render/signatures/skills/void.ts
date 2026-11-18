import { Container, Graphics, GraphicsContext, type Sprite } from "pixi.js";
import type { Vec2 } from "../../../engine/math";
import { easeInCubic, easeOutBack, easeOutCubic } from "../../anim/ease";
import { shard, softCircle } from "../../textures";
import { GILT, GILT_HOT } from "../palette";
import { Stage, span01, type SigBeatEvent, type SigSynergyEvent } from "../stage";
import { glowRingTex, holeTex, starTex } from "../textures";

/**
 * VOID COLLAPSE: a black singularity over the densest group.
 *
 *   form      a point of black tears open at chest height; a violet-ink lens spreads round it, a
 *             thin white-violet photon ring lights its edge, and an ink pool darkens the ground below.
 *   pull      the accretion rings spin up (ink bands with white-hot lines, the far half behind the
 *             core, the near half in front), gravitational rings contract across the ground, the
 *             light round it smears inward, debris spirals in, and the bodies caught lean and stretch
 *             toward it (space bending) while the simulation drags them in.
 *   implode   the core collapses to a point, a beat of nothing, then a white-violet star and the
 *             one flash; the bodies snap back.
 *   shockwave a circular ink-and-light wave runs out across the ground, kicking dust.
 *
 * Evolutions: Event Horizon locks a bright horizon ring on the ground and cages the trapped;
 * Supernova throws white embers that burst into eight-ray stars on nearby foes (Master: they chain
 * on); Consumption draws the fallen's souls into the core and carries them, orbiting, into the next
 * cast, which collapses larger. Master adds a counter-turning rune ring; Grandmaster gilds the light.
 */
export class VoidStage extends Stage {
  private center: Vec2 = { x: 0, y: 0 };
  private radius = 120;
  /** Base px: the singularity's place, and the ground under it. */
  private cx = 0;
  private cy = 0;
  private gx = 0;
  private gy = 0;
  private coreR = 12;
  private squash = 0.4;
  private box: Container | null = null;
  private back: Graphics | null = null;
  private front: Graphics | null = null;
  /**
   * The accretion rings, drawn once and only turned: each a tilted, squashed node holding a dashed
   * circle that spins in its plane (behind the core), and a still lip of light across the near side
   * (in front of it). No geometry is built per frame.
   */
  private readonly rings: { back: Container; dash: Graphics; front: Container; lip: Graphics }[] = [];
  private halo: Sprite | null = null;
  private core: Sprite | null = null;
  private rim: Sprite | null = null;
  private pool: Sprite | null = null;
  private rune: Graphics | null = null;
  private runeBox: Container | null = null;
  private horizonG: Graphics | null = null;
  /** 0 nothing, 1 forming, 2 pulling, 3 imploded, 4 fading. */
  private phase = 0;
  private phaseT = 0;
  /** Seconds since the singularity formed (its grow-in runs whether or not the pull came with it). */
  private formT = -1;
  private formD = 0.35;
  private pullD = 0.9;
  private spin = 0;
  private intensity = 0;
  private pulseT = 0;
  private debrisT = 0;
  private smearT = 0;
  private horizon = -1;
  private horizonD = 1;
  private readonly caught: number[] = [];
  /** Consumption: souls carried into this cast (orbiting) and souls fed during it. */
  private carried = 0;
  private fed = 0;
  private grow = 1;

  constructor(...a: ConstructorParameters<typeof Stage>) {
    super(...a);
    const e = this.cast;
    this.center = { x: e.center.x, y: e.center.y };
    this.radius = e.radius;
    if (this.evo === "consumption") {
      this.carried = this.svc.consumed;
      this.svc.consumed = 0;
    }
    this.grow = 1 + 0.1 * this.carried;
    this.place();
  }

  private place(): void {
    const pr = this.host.proj;
    const fs = pr.fs(this.center.y);
    this.gx = pr.sx(this.center.x);
    this.gy = pr.sy(this.center.y);
    this.cx = this.gx;
    // Above the heads of the group it gathers, so the bodies (and the hero among them) stay in view.
    this.cy = this.gy - 128 * fs;
    this.coreR = 19 * fs * this.grow;
    this.squash = Math.min(0.6, Math.max(0.25, pr.dy() / pr.unit()));
  }

  onBeat(e: SigBeatEvent): void {
    switch (e.beat) {
      case "form":
        this.center = { x: e.to.x, y: e.to.y };
        if (e.radius > 0) this.radius = e.radius;
        this.formD = Math.min(0.35, Math.max(0.15, e.duration || 0.35));
        this.formT = 0;
        this.place();
        this.build();
        this.phase = 1;
        this.phaseT = 0;
        break;
      case "pull":
        if (!this.box) this.build();
        this.pullD = Math.max(0.3, e.duration || 0.9);
        this.phase = 2;
        this.phaseT = 0;
        this.caught.length = 0;
        for (const id of e.targetIds) this.caught.push(id);
        // The first contraction and the inward rush begin at once.
        this.kit.ring(this.gx, this.gy, this.radius * this.u * 1.5, this.coreR, 0.55, this.pal.deep, this.pal.glow, 3, { squash: this.squash, inward: true });
        break;
      case "horizon_trap":
        this.horizon = 0;
        this.horizonD = Math.max(0.4, e.duration || 1);
        this.kit.ring(this.gx, this.gy, this.coreR, e.radius * this.u, 0.25, this.pal.deep, 0xffffff, 4, { squash: this.squash });
        break;
      case "implode":
        this.implode();
        break;
      case "shockwave":
        this.shockwave(e.radius || this.radius * 2.2, e.duration || 0.55);
        break;
      case "supernova_burst":
        this.supernova(e.from, e.to, e.index, e.radius || 46);
        break;
      default:
        break;
    }
  }

  override onSynergy(e: SigSynergyEvent): void {
    void e;
  }

  override focus(out: { x: number; y: number; top: number }): boolean {
    if (this.phase === 0 || this.phase >= 4) return false;
    out.x = this.gx;
    out.y = this.gy;
    out.top = this.cy - this.coreR * 2.4;
    return true;
  }

  override onDeath(id: number, x: number, y: number): void {
    if (this.evo !== "consumption" || this.phase >= 4) return;
    if (!this.cast.targetIds.includes(id) && !this.caught.includes(id)) return;
    // A soul is drawn into the core: a pale wisp spiralling up into it.
    this.fed += 1;
    this.svc.consumed = Math.min(5, this.svc.consumed + 1);
    const pr = this.host.proj;
    const sx = pr.sx(x);
    const sy = pr.sy(y) - 40 * pr.fs(y);
    this.kit.streak(sx, sy, this.cx, this.cy, 40 * this.u, 1.6, this.gilded ? GILT_HOT : this.pal.core, 0.4);
    const o = this.kit.o(sx, sy, softCircle(), this.pal.glow);
    o.target = { x: this.cx, y: this.cy, strength: 14 };
    o.speed[0] = 30;
    o.speed[1] = 90;
    o.life[0] = 0.5;
    o.life[1] = 0.8;
    o.scale[0] = 0.15;
    o.scale[1] = 0.3;
    this.kit.emit(8);
    o.target = undefined;
  }

  private build(): void {
    if (this.box) return;
    const L = this.host.layers;
    const box = this.container(L.fx);
    this.box = box;
    box.position.set(this.cx, this.cy);
    // The pool of shadow on the ground under it (ground layer).
    this.pool = this.sprite(L.ground, holeTex(), false);
    if (this.pool) {
      this.pool.tint = this.pal.ink;
      this.pool.position.set(this.gx, this.gy);
      this.pool.alpha = 0;
    }
    if (this.rich && this.master) {
      this.runeBox = this.container(L.ground);
      this.runeBox.position.set(this.gx, this.gy);
      this.rune = this.graphics(this.runeBox, true);
      drawRune(this.rune, this.gilded ? GILT : this.pal.glow, 1);
      this.rune.alpha = 0;
    }
    this.back = this.graphics(box);
    const n = this.compact ? 1 : this.rich ? 3 : 2;
    const light = this.gilded ? GILT_HOT : this.pal.core;
    for (let i = 0; i < n; i++) {
      const back = new Container();
      const dash = new Graphics(dashContext(i, i === 0 ? this.pal.mid : this.pal.deep, i === 0 ? light : this.pal.glow));
      back.addChild(dash);
      box.addChild(back);
      this.rings.push({ back, dash, front: new Container(), lip: new Graphics(lipContext(i === 0 ? light : this.pal.glow)) });
    }
    this.halo = this.sprite(box, holeTex(), false);
    this.core = this.sprite(box, holeTex(), false);
    this.rim = this.sprite(box, glowRingTex(), true);
    for (const r of this.rings) {
      r.front.addChild(r.lip);
      box.addChild(r.front);
    }
    this.front = this.graphics(box);
    if (this.halo) this.halo.tint = this.pal.deep;
    if (this.core) this.core.tint = 0x000000;
    if (this.rim) this.rim.tint = this.gilded ? GILT_HOT : this.pal.core;
    if (this.evo === "event_horizon") {
      this.horizonG = this.graphics(L.ground, true);
      this.horizonG.position.set(this.gx, this.gy);
    }
    this.layout(0);
  }

  private implode(): void {
    if (!this.box) this.build();
    this.phase = 3;
    this.phaseT = 0;
    const k = this.kit;
    const pal = this.pal;
    const light = this.gilded ? GILT_HOT : pal.core;
    // The collapse: a hard star, a lens of light, the flash.
    const star = this.sprite(this.host.layers.fx, starTex(), true);
    if (star) {
      star.position.set(this.cx, this.cy);
      star.tint = light;
      star.scale.set(0.2);
      this.starS = star;
    }
    const bloom = this.sprite(this.host.layers.fx, softCircle(), true);
    if (bloom) {
      bloom.position.set(this.cx, this.cy);
      bloom.tint = pal.glow;
      bloom.scale.set(0.5);
      this.bloomS = bloom;
    }
    k.ring(this.cx, this.cy, this.coreR * 0.5, this.coreR * 5.5 * this.grow, 0.3, pal.deep, light, 3.5, { ground: false, squash: 1 });
    if (!this.compact) k.ring(this.cx, this.cy, this.coreR, this.coreR * 3.5 * this.grow, 0.42, -1, pal.glow, 2, { ground: false, squash: 0.85, delay: 0.05 });
    // Light thrown out from the point, and ink debris after it.
    const o = k.o(this.cx, this.cy, softCircle(), light);
    o.speed[0] = 120;
    o.speed[1] = 380;
    o.life[0] = 0.2;
    o.life[1] = 0.45;
    o.scale[0] = 0.12;
    o.scale[1] = 0.3;
    o.drag = 0.86;
    k.emit(this.compact ? 8 : 22);
    const d = k.o(this.cx, this.cy, shard(), pal.ink);
    d.additive = false;
    d.speed[0] = 140;
    d.speed[1] = 320;
    d.life[0] = 0.35;
    d.life[1] = 0.7;
    d.scale[0] = 0.25;
    d.scale[1] = 0.5;
    d.gravity = 300;
    d.spin = 10;
    k.emit(this.compact ? 4 : 14);
    if (k.flash(this.gilded ? 0xf3e6c4 : 0xe6dcff, 0.3, 0.22)) this.host.darken(0x15102a, 0.35);
    k.stop(0.06, "sig-void", 0.4);
    k.punch(0.04);
    // The bodies caught snap back from the bend.
    for (const id of this.caught) {
      const m = this.svc.mod(id);
      m.stretch = 0;
      m.dx *= -0.3;
      m.dy *= -0.3;
    }
  }

  private starS: Sprite | null = null;
  private bloomS: Sprite | null = null;

  private shockwave(r: number, life: number): void {
    const k = this.kit;
    const pal = this.pal;
    const R = r * this.u;
    k.ring(this.gx, this.gy, this.coreR, R, life * 1.1, pal.deep, this.gilded ? GILT_HOT : 0xf2ecff, 5, { squash: this.squash });
    if (!this.compact) k.ring(this.gx, this.gy, this.coreR, R * 0.78, life, -1, pal.glow, 2.5, { squash: this.squash, delay: 0.06 });
    // Dust kicked outward along the ground.
    if (!this.compact) {
      for (let i = 0; i < 2; i++) {
        const o = k.o(this.gx, this.gy, softCircle(), 0x3a3448);
        o.additive = false;
        o.alpha = 0.55;
        o.speed[0] = R * 0.9;
        o.speed[1] = R * 1.4;
        o.angle[0] = i === 0 ? -0.25 : Math.PI - 0.25;
        o.angle[1] = i === 0 ? 0.25 : Math.PI + 0.25;
        o.life[0] = 0.3;
        o.life[1] = 0.55;
        o.scale[0] = 0.3;
        o.scale[1] = 0.6;
        o.drag = 0.85;
        k.emit(8);
      }
    }
    k.shake(0.12);
  }

  private supernova(from: Vec2, to: Vec2, index: number, radius: number): void {
    const k = this.kit;
    const pr = this.host.proj;
    const a = index <= 3 ? { x: this.cx, y: this.cy } : this.chestAt(from, { x: 0, y: 0 });
    const b = this.chestAt(to, { x: 0, y: 0 });
    const light = this.gilded ? GILT_HOT : this.pal.core;
    // An ember arcs across (a bright head with a violet tail), then bursts into an eight-ray star.
    this.embers.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, t: 0, d: 0.18, done: false, r: radius * pr.unit(), chain: index > 3 });
    k.streak(a.x, a.y, b.x, b.y, 50 * this.u, 1.8, this.pal.glow, 0.2);
    k.streak(a.x, a.y, b.x, b.y, 30 * this.u, 0.9, light, 0.18);
  }

  private readonly embers: { ax: number; ay: number; bx: number; by: number; t: number; d: number; done: boolean; r: number; chain: boolean }[] = [];

  private burst(x: number, y: number, r: number, chain: boolean): void {
    const k = this.kit;
    const light = this.gilded ? GILT_HOT : this.pal.core;
    const rays = chain ? 6 : 8;
    const len = r * (chain ? 0.8 : 1.1);
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2 + 0.2;
      k.slash(x + Math.cos(a) * len * 0.15, y + Math.sin(a) * len * 0.15, x + Math.cos(a) * len, y + Math.sin(a) * len * 0.8, this.pal.deep, light, 2.2, 0.22);
    }
    k.ring(x, y, 4, len * 1.1, 0.3, this.pal.deep, light, 2.5, { ground: false, squash: 0.8 });
    const o = k.o(x, y, softCircle(), this.pal.glow);
    o.speed[0] = 60;
    o.speed[1] = 200;
    o.life[0] = 0.2;
    o.life[1] = 0.4;
    o.scale[0] = 0.12;
    o.scale[1] = 0.26;
    k.emit(10);
    k.punch(0.012);
  }

  update(dt: number, real: number): void {
    this.phaseT += dt;
    if (this.formT >= 0) this.formT += dt;
    this.spin += dt * (this.phase === 2 ? 5 + 6 * this.intensity : 2.5);
    const k = this.kit;
    const pal = this.pal;
    if (this.phase === 1) this.intensity = easeOutCubic(span01(this.phaseT, 0, this.formD)) * 0.5;
    else if (this.phase === 2) this.intensity = 0.5 + 0.5 * span01(this.phaseT, 0, this.pullD);
    // The pull: contractions, the smear, debris, and the bend.
    if (this.phase === 2 && dt > 0) {
      this.pulseT -= dt;
      if (this.pulseT <= 0) {
        this.pulseT = this.compact ? 0.4 : 0.22;
        k.ring(this.gx, this.gy, this.radius * this.u * (1.2 + 0.3 * this.intensity), this.coreR * 1.5, 0.5, pal.deep, this.compact ? -1 : pal.glow, 2.5, { squash: this.squash, inward: true });
      }
      if (!this.compact && this.profile.distortion) {
        this.smearT -= dt;
        if (this.smearT <= 0) {
          this.smearT = 0.12;
          k.smear(this.cx, this.cy, this.coreR * 6, 0.75, 4, this.gilded ? GILT : pal.glow, 0.35);
        }
      }
      if (!this.compact) {
        this.debrisT -= dt;
        if (this.debrisT <= 0) {
          this.debrisT = 0.16;
          k.spiral(this.cx, this.cy + 20 * this.u, this.radius * this.u * 0.9, 5, shard(), pal.ink, false, 0.6, 10);
          k.spiral(this.cx, this.cy, this.coreR * 5, 3, softCircle(), this.gilded ? GILT : pal.glow, true, 0.45, 14);
        }
      }
      // Space bending: the caught lean and stretch toward the core (visual only; the pull is the sim's).
      if (this.profile.distortion || this.compact === false) {
        const bend = this.profile.distortion ? 1 : 0.4;
        for (const id of this.caught) {
          if (!this.body(id)) continue;
          const m = this.svc.mod(id);
          const dx = this.gx - this.b.x;
          const dy = this.gy - this.b.y;
          const d = Math.hypot(dx, dy) || 1;
          const pull = Math.min(1, 60 / Math.max(20, d)) * this.intensity * bend;
          m.dx = (dx / d) * 9 * this.u * pull;
          m.dy = (dy / d) * 3 * this.u * pull;
          m.stretch = 0.35 * pull;
          m.lean = dx >= 0 ? 1 : -1;
        }
      }
    }
    if (this.horizon >= 0) this.horizon += dt;
    if (this.phase === 3) {
      // The bend releases with a small overshoot.
      for (const id of this.caught) {
        const m = this.svc.mod(id);
        m.dx *= 0.82;
        m.dy *= 0.82;
      }
      if (this.phaseT > 0.5) this.phase = 4;
    }
    if (this.ended && this.phase < 3) this.phase = 4;
    // Embers in flight.
    for (const em of this.embers) {
      if (em.done) continue;
      em.t += dt;
      if (em.t >= em.d) {
        em.done = true;
        this.burst(em.bx, em.by, em.r, em.chain);
      }
    }
    this.layout(real);
  }

  private layout(real: number): void {
    void real;
    const box = this.box;
    if (!box) return;
    let coreK: number;
    let alpha = 1;
    if (this.phase <= 1) coreK = easeOutBack(span01(this.phaseT, 0, this.formD));
    else if (this.phase === 2) coreK = (1 + 0.35 * this.intensity + 0.06 * Math.sin(this.t * 22)) * (this.formT >= 0 ? easeOutBack(span01(this.formT, 0, 0.3)) : 1);
    else if (this.phase === 3) {
      // Collapse to a point in 70ms, then gone.
      coreK = this.phaseT < 0.07 ? 1.35 * (1 - easeInCubic(this.phaseT / 0.07)) + 0.05 : 0;
      alpha = this.phaseT < 0.07 ? 1 : 0;
    } else {
      coreK = 0;
      alpha = 0;
    }
    const R = this.coreR;
    const texR = 32;
    if (this.core) this.core.scale.set((R * coreK) / texR * 1.18);
    if (this.halo) {
      this.halo.scale.set((R * 2.7 * Math.max(coreK, this.phase === 3 ? 1 - span01(this.phaseT, 0, 0.25) : 0)) / texR, (R * 2.4 * coreK) / texR);
      this.halo.alpha = 0.78 * (this.phase >= 3 ? 1 - span01(this.phaseT, 0, 0.25) : 1);
    }
    if (this.rim) {
      this.rim.scale.set((R * 1.12 * coreK) / 120);
      this.rim.alpha = alpha * (0.85 + 0.15 * Math.sin(this.t * 31));
    }
    box.alpha = this.phase === 4 ? Math.max(0, box.alpha - 0.1) : 1;
    if (this.pool) {
      const pk = this.phase <= 2 ? Math.max(coreK, 0) : 1 - span01(this.phaseT, 0, 0.4);
      this.pool.scale.set((R * 3.2 * pk) / texR, (R * 3.2 * pk * this.squash) / texR);
      this.pool.alpha = 0.5 * Math.min(1, pk);
      if (this.phase === 4) this.pool.alpha = 0;
    }
    if (this.rune) {
      const rk = this.phase === 1 ? span01(this.phaseT, 0, this.formD) : this.phase === 2 ? 1 : this.phase === 3 ? 1 - span01(this.phaseT, 0.05, 0.4) : 0;
      this.rune.alpha = 0.75 * rk;
      const rs = (this.radius * this.u * 0.85 * (this.phase === 3 ? 1 + 0.4 * span01(this.phaseT, 0, 0.3) : 1)) / 100;
      this.runeBox!.scale.set(rs, rs * this.squash);
      this.rune.rotation = -this.spin * 0.25;
    }
    if (this.horizonG) {
      const g = this.horizonG;
      g.clear();
      if (this.horizon >= 0 && this.horizon < this.horizonD + 0.3) {
        const fade = this.horizon > this.horizonD ? 1 - (this.horizon - this.horizonD) / 0.3 : 1;
        const rr = this.radius * this.u * 0.9;
        const flick = 0.85 + 0.15 * Math.sin(this.t * 40);
        g.ellipse(0, 0, rr, rr * this.squash).stroke({ width: 5, color: this.pal.accent, alpha: 0.45 * fade });
        g.ellipse(0, 0, rr, rr * this.squash).stroke({ width: 1.6, color: 0xffffff, alpha: 0.95 * fade * flick });
        // Tick marks pinning the horizon, turning slowly.
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2 + this.horizon * 0.8;
          const x0 = Math.cos(a) * rr;
          const y0 = Math.sin(a) * rr * this.squash;
          g.moveTo(x0 * 0.92, y0 * 0.92).lineTo(x0 * 1.06, y0 * 1.06);
        }
        g.stroke({ width: 1.4, color: this.gilded ? GILT : 0xd8ccff, alpha: 0.8 * fade });
      }
    }
    if (this.starS) {
      const s = this.starS;
      const k = span01(this.phaseT, 0.06, 0.4);
      const grow = this.phaseT < 0.06 ? 0 : easeOutCubic(span01(this.phaseT, 0.06, 0.16));
      s.visible = this.phase >= 3 && this.phaseT >= 0.06;
      s.scale.set((0.3 + 3.6 * grow * this.grow) * this.u * (1 - k * 0.5));
      s.alpha = 1 - k;
      s.rotation = 0.2 * k;
    }
    if (this.bloomS) {
      const s = this.bloomS;
      const k = span01(this.phaseT, 0.06, 0.45);
      s.visible = this.phase >= 3 && this.phaseT >= 0.06;
      s.scale.set((1 + 4 * easeOutCubic(k)) * this.u * this.grow);
      s.alpha = 0.6 * (1 - k);
    }
  }

  override paint(): void {
    const back = this.back;
    const front = this.front;
    if (!back || !front) return;
    back.clear();
    front.clear();
    const show = this.phase !== 0 && this.phase < 3;
    for (const r of this.rings) {
      r.back.visible = show;
      r.front.visible = show;
    }
    if (!show) return;
    {
      const Rr = this.coreR * (this.phase === 1 ? easeOutCubic(span01(this.phaseT, 0, this.formD)) : 1 + 0.35 * this.intensity);
      for (let i = 0; i < this.rings.length; i++) {
        const r = this.rings[i]!;
        const rx = Rr * (1.9 + i * 0.75);
        const ry = rx * (0.24 + i * 0.05);
        const tilt = -0.28 + i * 0.12;
        r.back.rotation = r.front.rotation = tilt;
        r.back.scale.set(rx / 100, ry / 100);
        r.front.scale.set(rx / 100, ry / 100);
        r.dash.rotation = this.spin * (1 - i * 0.22) * (i % 2 === 0 ? 1 : -0.8);
        r.lip.alpha = 0.6 + 0.4 * this.intensity;
      }
    }
    const pal = this.pal;
    const R = this.coreR * (this.phase === 1 ? easeOutCubic(span01(this.phaseT, 0, this.formD)) : 1 + 0.35 * this.intensity);
    // The photon ring's electric hint at the edge of the horizon (Event Horizon burns it brighter).
    const hz = this.evo === "event_horizon" ? 1 : 0.45;
    back.circle(0, 0, R * 1.4).stroke({ width: 1.2, color: pal.accent, alpha: 0.5 * hz * this.intensity });
    // Consumption: the souls it carries orbit the core, close in, bright.
    const souls = this.carried + this.fed;
    for (let i = 0; i < souls; i++) {
      const a = this.spin * 1.4 + (i / Math.max(1, souls)) * Math.PI * 2;
      const x = Math.cos(a) * R * 2.3;
      const y = Math.sin(a) * R * 0.7;
      const g = Math.sin(a) < 0 ? back : front;
      g.circle(x, y, 2.6).fill({ color: this.gilded ? GILT_HOT : 0xece4ff, alpha: 0.95 });
      g.circle(x, y, 5).fill({ color: pal.glow, alpha: 0.3 });
    }
  }

  override dispose(): void {
    for (const r of this.rings) {
      r.back.destroy({ children: true });
      r.front.destroy({ children: true });
    }
    this.rings.length = 0;
    for (const id of this.caught) {
      const m = this.svc.mod(id);
      m.dx = 0;
      m.dy = 0;
      m.stretch = 0;
    }
    super.dispose();
  }
}

const RING_CTX = new Map<string, GraphicsContext>();

/** Accretion ring `i` (unit radius 100): turning dashes, an ink band under a white-hot line. */
function dashContext(i: number, ink: number, light: number): GraphicsContext {
  const key = `dash|${i}|${ink}|${light}`;
  const hit = RING_CTX.get(key);
  if (hit && !hit.destroyed) return hit;
  const g = new GraphicsContext();
  const dash = 7 + i * 2;
  for (let d = 0; d < dash; d++) {
    const a0 = (d / dash) * Math.PI * 2;
    const a1 = a0 + ((Math.PI * 2) / dash) * 0.62;
    g.arc(0, 0, 100, a0, a1).stroke({ width: 9 - i * 1.5, color: ink, alpha: 0.85 });
    g.arc(0, 0, 100, a0 + 0.05, a1 - 0.05).stroke({ width: 3, color: light, alpha: 0.8 });
  }
  RING_CTX.set(key, g);
  return g;
}

/** The near half of a ring (unit radius 100), a thin line of light passing in front of the core. */
function lipContext(light: number): GraphicsContext {
  const key = `lip|${light}`;
  const hit = RING_CTX.get(key);
  if (hit && !hit.destroyed) return hit;
  const g = new GraphicsContext();
  g.arc(0, 0, 100, 0.25, Math.PI - 0.25).stroke({ width: 3.5, color: light, alpha: 0.7 });
  RING_CTX.set(key, g);
  return g;
}

export function clearVoidCache(): void {
  for (const c of RING_CTX.values()) c.destroy();
  RING_CTX.clear();
}

/** The Master's rune ring (unit radius 100, squashed by the caller): glyph ticks between two circles. */
function drawRune(g: Graphics, color: number, alpha: number): void {
  g.circle(0, 0, 100).stroke({ width: 2, color, alpha: 0.8 * alpha });
  g.circle(0, 0, 86).stroke({ width: 1, color, alpha: 0.6 * alpha });
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const kind = i % 3;
    if (kind === 0) g.moveTo(c * 88, s * 88).lineTo(c * 98, s * 98);
    else if (kind === 1) {
      g.moveTo(c * 89, s * 89).lineTo(c * 93 - s * 4, s * 93 + c * 4).lineTo(c * 97, s * 97);
    } else g.circle(c * 93, s * 93, 1.6);
  }
  g.stroke({ width: 1.6, color, alpha });
}
