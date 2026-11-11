// CSP-safe Pixi: replaces the eval-generated shader and uniform code so the strict Content-Security-Policy holds.
import "pixi.js/unsafe-eval";
import { Application, Container, Graphics, Sprite } from "pixi.js";
import type { GameController } from "../GameController";
import type { World } from "../engine/World";
import { ARENA } from "../engine/World";
import type { GameEvent } from "../engine/events";
import type { Combatant } from "../entities/types";
import { Rig } from "./rigs/Rig";
import { eliteSpec, enemySpec, playerSpec, summonSpec } from "./rigs/specs";
import { ELITES } from "../data/elites";
import { ParticleSystem } from "./Particles";
import { DamageNumbers } from "./DamageNumbers";
import { Background } from "./Background";
import { destroyTextures, hardCircle, ring, shard, softCircle, spark } from "./textures";
import { regionForStage } from "../data/regions";
import { ABILITIES } from "../data/abilities";
import { RARITY_COLOR, lighten } from "./colors";
import { clamp, easeOutCubic, lerp } from "../engine/math";
import { summonDef } from "../data/summons";

interface EntityView {
  rig: Rig;
  bar: Graphics;
  barKey?: string;
  lastHp: number;
  defId: string;
  kind: string;
}

type Fx =
  | { kind: "slash"; x: number; y: number; facing: 1 | -1; radius: number; life: number; total: number; color: number; width: number; sweep: number }
  | { kind: "bolt"; points: { x: number; y: number }[]; life: number; total: number; color: number; width: number }
  | { kind: "ring"; x: number; y: number; r0: number; r1: number; life: number; total: number; color: number; width: number; squash: number }
  | { kind: "beam"; x: number; y: number; life: number; total: number; color: number; height: number }
  | { kind: "afterimage"; x: number; y: number; life: number; total: number; color: number; w: number; h: number };

const WORLD_W = ARENA.width;
const WORLD_D = ARENA.depth;
/** Figures are drawn larger than the simulation footprint so fighters dominate the frame, as in the genre's best. */
const FIGURE_SCALE = 1.62;

/**
 * BattleRenderer: PixiJS presentation of the simulation. Reads world state each frame,
 * reacts to simulation events with effects, and never mutates the world.
 */
export class BattleRenderer {
  private app: Application | null = null;
  private host: HTMLElement | null = null;
  private world: World | null = null;
  private root = new Container();
  private shakeLayer = new Container();
  private groundFx = new Graphics();
  private entityLayer = new Container();
  private fxGraphics = new Graphics();
  private projectileLayer = new Container();
  private orbLayer = new Container();
  private particles = new ParticleSystem(420);
  private numbers!: DamageNumbers;
  private flashRect = new Graphics();
  private cinematicLayer = new Container();
  private background: Background | null = null;
  private views = new Map<number, EntityView>();
  private projectiles = new Map<number, Container>();
  private orbs = new Map<number, { c: Container; core: Sprite; ring: Sprite; t: number; isBoss: boolean }>();
  private fx: Fx[] = [];
  private shakeStrength = 0;
  private flashAlpha = 0;
  private flashTime = 0;
  private width = 0;
  private height = 0;
  private groundTop = 0;
  private groundBottom = 0;
  private reduced = false;
  private time = 0;
  private resizeObs: ResizeObserver | null = null;
  private cinematic: { rig: Rig; x: number; y: number; t: number; first: boolean; overlay: Graphics; summonId: string; done: boolean; ending: boolean } | null = null;
  private playerPath: string = "none";
  private lowHpPulse = 0;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly controller: GameController) {}

  async mount(host: HTMLElement): Promise<void> {
    this.host = host;
    // Bitmap glyphs are rasterised on first use, so the display font must be ready first.
    try {
      await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
    } catch {
      /* fonts API unavailable: fall back to the serif stack */
    }
    const app = new Application();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    await app.init({
      resizeTo: host,
      backgroundAlpha: 0,
      antialias: true,
      resolution: dpr,
      autoDensity: true,
      preference: "webgl",
      powerPreference: "high-performance",
    });
    this.app = app;
    app.canvas.style.display = "block";
    app.canvas.style.width = "100%";
    app.canvas.style.height = "100%";
    app.canvas.setAttribute("data-testid", "battlefield-canvas");
    host.appendChild(app.canvas);
    app.ticker.stop(); // the GameLoop drives rendering
    this.numbers = new DamageNumbers(30);
    app.stage.addChild(this.root);
    this.root.addChild(this.shakeLayer);
    this.shakeLayer.addChild(this.groundFx, this.entityLayer, this.projectileLayer, this.orbLayer, this.fxGraphics, this.particles.container);
    this.entityLayer.sortableChildren = true;
    this.root.addChild(this.numbers.container, this.cinematicLayer, this.flashRect);
    this.flashRect.blendMode = "add";
    this.resizeObs = new ResizeObserver(() => {
      // Repainting the watercolour layers is expensive; wait for the size to settle.
      if (this.resizeTimer) clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.layout(), 120);
    });
    this.resizeObs.observe(host);
    this.layout();
  }

  unmount(): void {
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    for (const v of this.views.values()) v.rig.destroy();
    this.views.clear();
    this.cinematic?.rig.destroy();
    this.cinematic = null;
    this.particles.destroy();
    this.numbers?.destroy();
    this.background?.destroy();
    destroyTextures();
    if (this.app) {
      this.app.destroy(true, { children: true, texture: true });
      this.app = null;
    }
    this.host = null;
  }

  setWorld(world: World): void {
    this.world = world;
    for (const v of this.views.values()) v.rig.destroy();
    this.views.clear();
    for (const p of this.projectiles.values()) p.destroy({ children: true });
    this.projectiles.clear();
    for (const o of this.orbs.values()) o.c.destroy({ children: true });
    this.orbs.clear();
    this.fx = [];
    this.particles.clear();
    this.endCinematic();
    const region = regionForStage(world.stage);
    if (!this.background || this.background.regionId !== region.id) {
      this.background?.destroy();
      this.background = new Background(region);
      this.root.addChildAt(this.background.container, 0);
      this.root.addChild(this.background.foreground);
      this.root.setChildIndex(this.numbers.container, this.root.children.length - 1);
      this.root.setChildIndex(this.cinematicLayer, this.root.children.length - 1);
      this.root.setChildIndex(this.flashRect, this.root.children.length - 1);
      this.layout();
    }
    this.background.setReduced(this.reduced);
  }

  setReducedEffects(v: boolean): void {
    this.reduced = v;
    this.particles.setCap(v ? 140 : 420);
    this.background?.setReduced(v);
  }

  stats(): { particles: number; entities: number; renderer: string } {
    const r = this.app?.renderer;
    const type = r ? (r.type === 1 ? "WebGL" : r.type === 2 ? "WebGPU" : "Canvas") : "none";
    return { particles: this.particles.count, entities: this.views.size, renderer: type };
  }

  // ---------------------------------------------------------------------
  // Layout & mapping
  // ---------------------------------------------------------------------

  private layout(): void {
    if (!this.app || !this.host) return;
    const w = this.host.clientWidth || 360;
    const h = this.host.clientHeight || 300;
    this.width = w;
    this.height = h;
    // The lower 78px carry the ability medallions; fighters stand on the ground above them.
    const reserve = 70;
    this.groundTop = Math.max(h * 0.36, (h - reserve) * 0.46);
    this.groundBottom = h - reserve;
    this.background?.layout(w, h, this.groundTop);
    this.flashRect.clear().rect(0, 0, w, h).fill(0xffffff);
    this.flashRect.alpha = 0;
    this.controller.view = {
      scale: w / WORLD_W,
      offsetX: 0,
      offsetY: this.groundTop,
      depthScale: (this.groundBottom - this.groundTop) / WORLD_D,
      width: w,
      height: h,
    };
  }

  private sx(x: number): number {
    return x * (this.width / WORLD_W);
  }

  private sy(y: number): number {
    return this.groundTop + (y / WORLD_D) * (this.groundBottom - this.groundTop);
  }

  private depthScale(y: number): number {
    return 0.8 + 0.32 * clamp(y / WORLD_D, 0, 1);
  }

  private unit(): number {
    return this.width / WORLD_W;
  }

  // ---------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------

  render(alpha: number, dt: number, paused: boolean): void {
    const app = this.app;
    const world = this.world;
    if (!app || !world) return;
    this.time += dt;
    this.background?.update(paused ? dt * 0.3 : dt);
    this.background?.setCamera((world.player.pos.x - ARENA.width / 2) / (ARENA.width / 2));
    this.syncEntities(world, alpha, paused ? 0 : dt);
    this.syncProjectiles(world, alpha);
    this.syncOrbs(world, dt);
    this.drawGroundFx(world);
    this.updateFx(dt);
    this.particles.update(dt);
    this.numbers.update(dt);
    this.updateCinematic(dt);
    // Camera shake
    if (this.shakeStrength > 0.2) {
      const s = this.shakeStrength * (this.reduced ? 0.4 : 1);
      this.shakeLayer.position.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s * 0.6);
      this.shakeStrength *= Math.pow(0.02, dt);
    } else {
      this.shakeLayer.position.set(0, 0);
      this.shakeStrength = 0;
    }
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      this.flashRect.alpha = Math.max(0, this.flashAlpha * (this.flashTime / 0.35));
    } else this.flashRect.alpha = 0;
    // Low-health vignette pulse
    const hpFrac = world.player.stats.maxHp > 0 ? world.player.hp / world.player.stats.maxHp : 1;
    this.lowHpPulse = hpFrac < 0.3 ? this.lowHpPulse + dt : 0;
    app.render();
  }

  private syncEntities(world: World, alpha: number, dt: number): void {
    const seen = new Set<number>();
    for (const e of world.entities.values()) {
      seen.add(e.id);
      let v = this.views.get(e.id);
      if (!v || v.defId !== e.defId) {
        if (v) {
          v.rig.destroy();
          v.bar.destroy();
        }
        v = this.createView(e);
        this.views.set(e.id, v);
      }
      const x = lerp(e.prevPos.x, e.pos.x, alpha);
      const y = lerp(e.prevPos.y, e.pos.y, alpha);
      const sx = this.sx(x);
      const sy = this.sy(y);
      const ds = this.depthScale(y) * this.unit() * FIGURE_SCALE;
      v.rig.root.position.set(sx, sy);
      v.rig.root.scale.set(ds);
      v.rig.root.zIndex = y;
      if (e.summon?.temporary) v.rig.root.alpha = Math.min(v.rig.root.alpha, 0.72);
      v.rig.shadow.position.set(sx, sy + 1);
      v.rig.shadow.scale.set(ds, ds * 0.9);
      v.rig.shadow.zIndex = -1000 + y;
      const moving = e.state === "move";
      const speedFrac = Math.min(1, Math.hypot(e.vel.x, e.vel.y) / 160);
      v.rig.animate(e.state, e.stateTime, e.stateDuration, e.seed, e.facing, moving, speedFrac, e.deathTime);
      v.rig.setHitFlash(e.hitFlash);
      if (e.kind === "player" && this.playerPath !== world.loadout.weaponPath) {
        this.playerPath = world.loadout.weaponPath;
        v.rig.destroy();
        v.bar.destroy();
        v = this.createView(e);
        this.views.set(e.id, v);
        continue;
      }
      this.drawBar(v, e, sx, sy, ds);
      void dt;
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) {
        v.rig.destroy();
        v.bar.destroy();
        this.views.delete(id);
      }
    }
  }

  private createView(e: Combatant): EntityView {
    let spec = e.kind === "player" ? playerSpec(this.world?.loadout.weaponPath ?? "none") : e.kind === "summon" ? summonSpec(e.defId) : enemySpec(e.defId);
    const affix = e.enemy?.elite;
    if (affix) spec = eliteSpec(spec, ELITES[affix].color);
    const rig = new Rig(spec);
    this.entityLayer.addChild(rig.shadow);
    this.entityLayer.addChild(rig.root);
    const bar = new Graphics();
    this.entityLayer.addChild(bar);
    bar.zIndex = 5000;
    return { rig, bar, lastHp: -1, defId: e.defId, kind: e.kind };
  }

  /**
   * Health bars sit just above the head, appear only once a unit is hurt (or shielded, elite or
   * markable), and are re-tessellated only when what they show changes. Movement is a position update.
   */
  private drawBar(v: EntityView, e: Combatant, sx: number, sy: number, ds: number): void {
    const bar = v.bar;
    const hurt = e.hp < e.stats.maxHp - 0.5 || e.shield > 0;
    const flagged = !!e.enemy?.elite || !!e.enemy?.eligible;
    if (e.dead || e.kind === "boss" || (!hurt && !flagged)) {
      bar.visible = false;
      return;
    }
    bar.visible = true;
    const top = sy - (v.rig.unit * 100 + 10) * ds;
    bar.position.set(sx, top);
    const w = Math.round((e.kind === "player" ? 40 : e.kind === "summon" ? 30 : 28) * this.unit() * 1.6);
    const frac = clamp(e.hp / e.stats.maxHp, 0, 1);
    const sf = e.shield > 0 ? clamp(e.shield / e.stats.maxHp, 0, 1) : 0;
    const marked = e.statuses.some((st) => st.kind === "mark");
    const key = `${w}|${Math.round(frac * 60)}|${Math.round(sf * 30)}|${e.enemy?.elite ?? ""}|${e.enemy?.eligible ? 1 : 0}|${marked ? 1 : 0}|${hurt ? 1 : 0}`;
    if (v.barKey === key) return;
    v.barKey = key;
    const h = 3;
    bar.clear();
    if (hurt) {
      bar.roundRect(-w / 2 - 1, -1, w + 2, h + 2, 2).fill({ color: 0x0b0a08, alpha: 0.7 });
      const color = e.faction === "enemy" ? 0xd95a66 : e.kind === "summon" ? 0xe9c97a : 0x8fe0c4;
      bar.roundRect(-w / 2, 0, Math.max(1, w * frac), h, 1.5).fill(color);
      if (sf > 0) bar.roundRect(-w / 2, -3, w * sf, 2, 1).fill(0xf0eadc);
    }
    if (e.enemy?.elite) {
      const c = ELITES[e.enemy.elite].color;
      bar.poly([-w / 2 - 9, h / 2, -w / 2 - 5, -2, -w / 2 - 1, h / 2, -w / 2 - 5, h + 2]).fill(c);
    }
    if (e.enemy?.eligible && e.faction === "enemy") {
      // A small pale mark: this one will leave its oath behind.
      bar.circle(w / 2 + 6, h / 2, 2.6).fill({ color: 0xf0d9a8, alpha: 0.95 });
      bar.circle(w / 2 + 6, h / 2, 5).fill({ color: 0xf0d9a8, alpha: 0.2 });
    }
    if (marked) bar.poly([0, -12, -5, -5, 5, -5]).fill({ color: 0xe9c97a, alpha: 0.9 });
  }


  private syncProjectiles(world: World, alpha: number): void {
    const seen = new Set<number>();
    for (const p of world.projectiles) {
      seen.add(p.id);
      let c = this.projectiles.get(p.id);
      if (!c) {
        c = new Container();
        const u = this.unit();
        if (p.kind === "arrow") {
          const g = new Graphics();
          g.rect(-14 * u, -1 * u, 28 * u, 2 * u).fill(0xe8e2d4);
          g.poly([14 * u, -3 * u, 20 * u, 0, 14 * u, 3 * u]).fill(0xd9cdb2);
          c.addChild(g);
        } else {
          const s = new Sprite(softCircle());
          s.anchor.set(0.5);
          s.tint = p.kind === "ember" ? 0xe0954f : p.kind === "warden_bolt" ? 0xa9d0e6 : p.kind === "shard" ? 0xe7d3a6 : 0xffffff;
          s.blendMode = "add";
          s.scale.set(p.kind === "warden_bolt" ? 0.55 : 0.4);
          c.addChild(s);
          const core = new Sprite(hardCircle());
          core.anchor.set(0.5);
          core.tint = 0xffffff;
          core.scale.set(0.18);
          c.addChild(core);
        }
        this.projectileLayer.addChild(c);
        this.projectiles.set(p.id, c);
      }
      const x = lerp(p.prevPos.x, p.pos.x, alpha);
      const y = lerp(p.prevPos.y, p.pos.y, alpha);
      const arcLift = p.arc > 0 ? Math.sin(clamp(1 - p.life / 1.2, 0, 1) * Math.PI) * 40 : 0;
      c.position.set(this.sx(x), this.sy(y) - 30 * this.unit() * this.depthScale(y) - arcLift);
      c.rotation = Math.atan2(p.vel.y * 0.6, p.vel.x);
      if (p.kind !== "arrow" && !this.reduced && Math.random() < 0.5) {
        this.particles.emit({ x: c.x, y: c.y, count: 1, texture: softCircle(), color: p.kind === "ember" ? 0xd9823f : 0xa9d0e6, speed: [2, 10], life: [0.2, 0.4], scale: [0.15, 0.3], alpha: 0.7 });
      }
    }
    for (const [id, c] of this.projectiles) {
      if (!seen.has(id)) {
        c.destroy({ children: true });
        this.projectiles.delete(id);
      }
    }
  }

  private syncOrbs(world: World, dt: number): void {
    const seen = new Set<number>();
    for (const o of world.orbs) {
      if (o.claimed) continue;
      seen.add(o.id);
      let v = this.orbs.get(o.id);
      if (!v) {
        const c = new Container();
        const ringS = new Sprite(ring());
        ringS.anchor.set(0.5);
        ringS.tint = o.isBoss || o.elite ? 0xe9c56f : 0xf0e6d0;
        ringS.blendMode = "add";
        const core = new Sprite(softCircle());
        core.anchor.set(0.5);
        core.tint = o.isBoss || o.elite ? 0xe9c97a : 0xfff6e2;
        core.blendMode = "add";
        c.addChild(ringS, core);
        this.orbLayer.addChild(c);
        v = { c, core, ring: ringS, t: 0, isBoss: o.isBoss };
        this.orbs.set(o.id, v);
      }
      v.t += dt;
      const u = this.unit();
      const sx = this.sx(o.pos.x);
      const sy = this.sy(o.pos.y) - 28 * u * FIGURE_SCALE * this.depthScale(o.pos.y) - Math.sin(v.t * 2.2) * 5;
      v.c.position.set(sx, sy);
      const pulse = 0.5 + Math.sin(v.t * 4) * 0.08;
      const frac = o.remaining / o.total;
      v.core.scale.set((o.isBoss ? 0.9 : 0.6) * pulse * (0.6 + frac * 0.4));
      v.ring.scale.set((o.isBoss ? 0.7 : 0.45) * (0.9 + Math.sin(v.t * 3) * 0.1));
      v.ring.rotation += dt;
      v.ring.alpha = 0.5 + frac * 0.5;
      if (!this.reduced && Math.random() < dt * 10) {
        this.particles.emit({ x: sx, y: sy, count: 1, texture: softCircle(), color: o.isBoss || o.elite ? 0xe9c97a : 0xf0e6d0, speed: [6, 22], angle: [-Math.PI * 0.8, -Math.PI * 0.2], life: [0.6, 1.1], scale: [0.1, 0.25], alpha: 0.8 });
      }
    }
    for (const [id, v] of this.orbs) {
      if (!seen.has(id)) {
        v.c.destroy({ children: true });
        this.orbs.delete(id);
      }
    }
  }

  /** Ink splatters left by the fallen. They soak into the ground and fade. Capped. */
  private decals: { x: number; y: number; rx: number; ry: number; life: number; total: number; color: number }[] = [];

  private splatter(x: number, y: number, big: boolean, color = 0x14110d): void {
    const u = this.unit();
    const n = big ? 16 : this.reduced ? 4 : 8;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * (big ? 70 : 26) * u;
      const r = (2 + Math.random() * (big ? 12 : 7)) * u;
      this.decals.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.4, rx: r, ry: r * 0.45, life: 2.4, total: 2.4, color });
    }
    if (this.decals.length > 80) this.decals.splice(0, this.decals.length - 80);
  }

  private drawGroundFx(world: World): void {
    const g = this.groundFx;
    g.clear();
    const u = this.unit();
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i]!;
      d.life -= 1 / 60;
      if (d.life <= 0) {
        this.decals.splice(i, 1);
        continue;
      }
      const k = d.life / d.total;
      g.ellipse(d.x, d.y, d.rx * (1 + (1 - k) * 0.3), d.ry * (1 + (1 - k) * 0.3)).fill({ color: d.color, alpha: 0.55 * Math.min(1, k * 1.6) });
    }
    for (const t of world.telegraphs) {
      const k = 1 - t.remaining / t.total;
      const sx = this.sx(t.pos.x);
      const sy = this.sy(t.pos.y);
      const r = t.radius * u;
      if (t.shape === "circle") {
        g.ellipse(sx, sy, r, r * 0.42).fill({ color: t.color, alpha: 0.1 + k * 0.1 });
        g.ellipse(sx, sy, r, r * 0.42).stroke({ width: 2, color: t.color, alpha: 0.7 });
        g.ellipse(sx, sy, r * k, r * 0.42 * k).fill({ color: t.color, alpha: 0.22 });
      } else if (t.shape === "line") {
        const len = t.length * u;
        const x0 = sx;
        const x1 = sx + t.dir * len;
        g.rect(Math.min(x0, x1), sy - r * 0.42, Math.abs(x1 - x0), r * 0.84).fill({ color: t.color, alpha: 0.12 + k * 0.12 });
        g.rect(Math.min(x0, x1), sy - r * 0.42, Math.abs(x1 - x0) * k, r * 0.84).fill({ color: t.color, alpha: 0.2 });
        g.rect(Math.min(x0, x1), sy - r * 0.42, Math.abs(x1 - x0), r * 0.84).stroke({ width: 2, color: t.color, alpha: 0.7 });
      } else {
        const len = t.length * u;
        g.moveTo(sx, sy).arc(sx, sy, len, t.dir === 1 ? -Math.PI * 0.45 : Math.PI * 0.55, t.dir === 1 ? Math.PI * 0.45 : Math.PI * 1.45).lineTo(sx, sy).fill({ color: t.color, alpha: 0.12 + k * 0.15 });
        g.moveTo(sx, sy).arc(sx, sy, len, t.dir === 1 ? -Math.PI * 0.45 : Math.PI * 0.55, t.dir === 1 ? Math.PI * 0.45 : Math.PI * 1.45).lineTo(sx, sy).stroke({ width: 2, color: t.color, alpha: 0.7 });
      }
    }
    for (const h of world.hazards) {
      const sx = this.sx(h.pos.x);
      const sy = this.sy(h.pos.y);
      const r = h.radius * u;
      const color = h.kind === "fire" ? (h.faction === "ally" ? 0xe0954f : 0xc9643a) : 0x1d1a16;
      const flicker = 0.75 + Math.sin(this.time * 14 + h.id) * 0.15;
      g.ellipse(sx, sy, r, r * 0.42).fill({ color, alpha: 0.18 * flicker * Math.min(1, h.remaining) });
      g.ellipse(sx, sy, r * 0.6, r * 0.25).fill({ color: lighten(color, 0.4), alpha: 0.2 * flicker * Math.min(1, h.remaining) });
      if (!this.reduced && Math.random() < 0.35) {
        this.particles.emit({ x: sx + (Math.random() - 0.5) * r * 1.6, y: sy + (Math.random() - 0.5) * r * 0.6, count: 1, texture: softCircle(), color, speed: [10, 40], angle: [-Math.PI * 0.7, -Math.PI * 0.3], life: [0.3, 0.7], scale: [0.15, 0.35], alpha: 0.8 });
      }
    }
  }

  // ---------------------------------------------------------------------
  // Transient effects
  // ---------------------------------------------------------------------

  private updateFx(dt: number): void {
    const g = this.fxGraphics;
    g.clear();
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]!;
      f.life -= dt;
      if (f.life <= 0) {
        this.fx.splice(i, 1);
        continue;
      }
      const k = 1 - f.life / f.total;
      switch (f.kind) {
        case "slash": {
          const e = easeOutCubic(k);
          const start = f.facing === 1 ? -Math.PI * 0.75 : Math.PI * 0.25;
          const sweep = f.sweep * f.facing;
          const a0 = start + sweep * Math.max(0, e - 0.35);
          const a1 = start + sweep * e;
          const alpha = (1 - k) * 0.95;
          g.arc(f.x, f.y, f.radius, Math.min(a0, a1), Math.max(a0, a1)).stroke({ width: f.width * (1 - k * 0.5), color: f.color, alpha, cap: "round" });
          g.arc(f.x, f.y, f.radius * 0.92, Math.min(a0, a1), Math.max(a0, a1)).stroke({ width: f.width * 0.4, color: 0xffffff, alpha: alpha * 0.8, cap: "round" });
          g.arc(f.x, f.y, f.radius * 1.08, Math.min(a0, a1), Math.max(a0, a1)).stroke({ width: f.width * 1.8, color: f.color, alpha: alpha * 0.25, cap: "round" });
          break;
        }
        case "bolt": {
          const alpha = (1 - k) * 1;
          const pts = f.points;
          const jitter = 6 * (1 - k);
          if (pts.length > 1) {
            g.moveTo(pts[0]!.x, pts[0]!.y);
            for (let j = 1; j < pts.length; j++) g.lineTo(pts[j]!.x + (Math.random() - 0.5) * jitter, pts[j]!.y + (Math.random() - 0.5) * jitter);
            g.stroke({ width: f.width * 2.6, color: f.color, alpha: alpha * 0.3, cap: "round", join: "round" });
            g.moveTo(pts[0]!.x, pts[0]!.y);
            for (let j = 1; j < pts.length; j++) g.lineTo(pts[j]!.x, pts[j]!.y);
            g.stroke({ width: f.width, color: 0xffffff, alpha, cap: "round", join: "round" });
          }
          break;
        }
        case "ring": {
          const e = easeOutCubic(k);
          const r = lerp(f.r0, f.r1, e);
          g.ellipse(f.x, f.y, r, r * f.squash).stroke({ width: f.width * (1 - k), color: f.color, alpha: (1 - k) * 0.9 });
          g.ellipse(f.x, f.y, r * 0.85, r * f.squash * 0.85).stroke({ width: f.width * 0.5 * (1 - k), color: 0xffffff, alpha: (1 - k) * 0.5 });
          break;
        }
        case "beam": {
          const alpha = Math.sin(k * Math.PI);
          g.rect(f.x - 6, f.y - f.height, 12, f.height).fill({ color: f.color, alpha: alpha * 0.5 });
          g.rect(f.x - 2, f.y - f.height, 4, f.height).fill({ color: 0xffffff, alpha: alpha * 0.9 });
          break;
        }
        case "afterimage": {
          g.ellipse(f.x, f.y, f.w, f.h).fill({ color: f.color, alpha: (1 - k) * 0.35 });
          break;
        }
      }
    }
  }

  handleEvents(events: GameEvent[]): void {
    const world = this.world;
    if (!world) return;
    const u = this.unit();
    for (const e of events) {
      switch (e.type) {
        case "attack_swing": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y) - 34 * u * FIGURE_SCALE * this.depthScale(e.pos.y);
          if (e.kind === "player") {
            const color = world.loadout.weaponPath === "stormblade" ? 0xa8c4e6 : world.loadout.weaponPath === "infernal" ? 0xe0954f : world.loadout.weaponPath === "voidfang" ? 0xd95a66 : 0xf0eadc;
            this.fx.push({ kind: "slash", x: sx + e.facing * 14 * u, y: sy, facing: e.facing, radius: 58 * u, life: 0.26, total: 0.26, color, width: 8 * u, sweep: Math.PI * 1.1 });
          } else if (e.kind === "summon") {
            this.fx.push({ kind: "slash", x: sx + e.facing * 10 * u, y: sy, facing: e.facing, radius: 36 * u, life: 0.18, total: 0.18, color: 0x8fe0c4, width: 3 * u, sweep: Math.PI * 0.9 });
          } else if (e.heavy) {
            this.fx.push({ kind: "ring", x: sx + e.facing * 40 * u, y: this.sy(e.pos.y), r0: 10 * u, r1: 70 * u, life: 0.35, total: 0.35, color: 0xd9823f, width: 4, squash: 0.42 });
            this.particles.emit({ x: sx + e.facing * 40 * u, y: this.sy(e.pos.y), count: this.reduced ? 6 : 14, texture: softCircle(), color: 0x8a7a6a, speed: [30, 120], angle: [-Math.PI, 0], life: [0.3, 0.6], scale: [0.2, 0.5], gravity: 300, additive: false, alpha: 0.6 });
          } else {
            this.fx.push({ kind: "slash", x: sx + e.facing * 8 * u, y: sy, facing: e.facing, radius: 28 * u, life: 0.16, total: 0.16, color: 0xd95a66, width: 2.5 * u, sweep: Math.PI * 0.8 });
          }
          break;
        }
        case "hit": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y) - 40 * u * FIGURE_SCALE * this.depthScale(e.pos.y);
          const color = elementColor(e.element, e.crit);
          const isPlayer = e.targetKind === "player";
          if (!this.reduced || e.crit) {
            this.particles.emit({ x: sx, y: sy, count: e.crit ? 14 : e.heavy ? 10 : 5, texture: spark(), color, speed: [80, e.crit ? 320 : 200], life: [0.15, 0.35], scale: [0.4, e.crit ? 1.1 : 0.7], endScale: 0.1, alpha: 1, spin: 4 });
            this.particles.emit({ x: sx, y: sy, count: 1, texture: softCircle(), color, speed: [0, 0], life: [0.12, 0.18], scale: [e.crit ? 1.8 : 0.9, e.crit ? 2.2 : 1.2], endScale: 0.2, alpha: 0.9 });
          }
          if (e.amount > 0) {
            const label = e.crit ? `${fmtNum(e.amount)}!` : fmtNum(e.amount);
            const col = isPlayer ? 0xd95a66 : e.crit ? 0xe9c97a : e.element === "lightning" ? 0xc4d8ee : e.element === "fire" ? 0xe6a65a : e.element === "void" ? 0xe7d3a6 : e.element === "soul" ? 0xb6ecd8 : 0xf3ede0;
            this.numbers.spawn(sx, sy - 10, label, col, e.crit ? 1.25 : isPlayer ? 0.9 : 0.95, e.crit);
          }
          if (e.crit) this.shake(3);
          if (isPlayer && e.heavy) this.shake(6);
          break;
        }
        case "heal": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y) - 50 * u;
          this.numbers.spawn(sx, sy, `+${fmtNum(e.amount)}`, 0x8fe0c4, 0.95);
          this.particles.emit({ x: sx, y: sy + 20, count: this.reduced ? 6 : 14, texture: softCircle(), color: 0x8fe0c4, speed: [20, 60], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.5, 0.9], scale: [0.2, 0.45], alpha: 0.9 });
          break;
        }
        case "death": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y) - 30 * u;
          const isBoss = e.kind === "boss";
          const color = e.kind === "summon" ? 0xe9c97a : isBoss ? 0xa9d0e6 : 0x2c2b2a;
          if (e.kind !== "summon") this.splatter(sx, this.sy(e.pos.y), isBoss);
          this.particles.emit({ x: sx, y: sy, count: isBoss ? 70 : this.reduced ? 10 : 22, texture: shard(), color, speed: [40, isBoss ? 420 : 220], life: [0.4, isBoss ? 1.6 : 0.9], scale: [0.25, isBoss ? 1.0 : 0.6], endScale: 0, gravity: 260, additive: false, alpha: 0.95, spin: 8 });
          this.particles.emit({ x: sx, y: sy, count: isBoss ? 40 : 8, texture: softCircle(), color: isBoss ? 0xa9d0e6 : 0x2a2a30, speed: [10, isBoss ? 160 : 60], life: [0.5, isBoss ? 1.8 : 1.0], scale: [0.4, isBoss ? 1.6 : 0.8], endScale: 1.6, alpha: 0.5 });
          if (isBoss) this.fx.push({ kind: "ring", x: sx, y: this.sy(e.pos.y), r0: 20, r1: this.width, life: 0.9, total: 0.9, color: 0xa9d0e6, width: 6, squash: 0.42 });
          break;
        }
        case "cast": {
          this.castFx(e.ability, e.pos, e.facing, e.targetPos);
          break;
        }
        case "chain": {
          const a = { x: this.sx(e.from.x), y: this.sy(e.from.y) - 40 * u };
          const b = { x: this.sx(e.to.x), y: this.sy(e.to.y) - 40 * u };
          this.fx.push({ kind: "bolt", points: boltPoints(a, b, 6), life: 0.22, total: 0.22, color: e.color, width: 2.5 });
          this.particles.emit({ x: b.x, y: b.y, count: this.reduced ? 4 : 8, texture: spark(), color: e.color, speed: [60, 200], life: [0.15, 0.3], scale: [0.3, 0.8], endScale: 0.1 });
          break;
        }
        case "dodge": {
          const steps = 4;
          for (let i = 0; i < steps; i++) {
            const t = i / steps;
            const x = lerp(e.from.x, e.to.x, t);
            this.fx.push({ kind: "afterimage", x: this.sx(x), y: this.sy(e.from.y) - 42 * u, life: 0.25 + t * 0.1, total: 0.35, color: 0x2a2620, w: 12 * u, h: 40 * u });
          }
          this.particles.emit({ x: this.sx(e.from.x), y: this.sy(e.from.y) - 30 * u, count: this.reduced ? 5 : 12, texture: softCircle(), color: 0xd9cdb2, speed: [20, 90], life: [0.3, 0.6], scale: [0.3, 0.6], endScale: 0, alpha: 0.6 });
          break;
        }
        case "essence_available": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y) - 28 * u;
          this.fx.push({ kind: "ring", x: sx, y: this.sy(e.pos.y), r0: 4, r1: 60 * u, life: 0.8, total: 0.8, color: e.isBoss ? 0xe9c56f : 0xf0e6d0, width: 3, squash: 0.42 });
          this.particles.emit({ x: sx, y: sy, count: 18, texture: softCircle(), color: e.isBoss ? 0xe9c97a : 0xf0e6d0, speed: [20, 80], life: [0.6, 1.2], scale: [0.2, 0.5], endScale: 0, alpha: 0.9 });
          break;
        }
        case "projectile_hit": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y) - 30 * u;
          const color = e.kind === "ember" ? 0xe0954f : e.kind === "warden_bolt" ? 0xa9d0e6 : 0xe8e2d4;
          this.particles.emit({ x: sx, y: sy, count: this.reduced ? 3 : 7, texture: spark(), color, speed: [50, 160], life: [0.15, 0.3], scale: [0.3, 0.6], endScale: 0.1 });
          break;
        }
        case "gold": {
          if (this.reduced) break;
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y) - 20 * u;
          this.particles.emit({ x: sx, y: sy, count: Math.min(6, 2 + Math.floor(e.amount / 8)), texture: hardCircle(), color: 0xe9c97a, speed: [40, 140], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.5, 0.8], scale: [0.18, 0.28], endScale: 0.1, gravity: 420, additive: false, target: { x: 40, y: -10, strength: 14 } });
          break;
        }
        case "xp": {
          if (this.reduced) break;
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y) - 20 * u;
          this.particles.emit({ x: sx, y: sy, count: 3, texture: softCircle(), color: 0xa8c4e6, speed: [20, 80], life: [0.5, 0.8], scale: [0.2, 0.35], endScale: 0.05, target: { x: this.width / 2, y: -10, strength: 12 } });
          break;
        }
        case "summon_deployed": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y);
          const glow = summonDef(e.defId).palette.glow;
          this.fx.push({ kind: "ring", x: sx, y: sy, r0: 6, r1: 50 * u, life: 0.6, total: 0.6, color: glow, width: 3, squash: 0.42 });
          this.particles.emit({ x: sx, y: sy - 30 * u, count: this.reduced ? 8 : 24, texture: softCircle(), color: glow, speed: [20, 90], angle: [-Math.PI, 0], life: [0.5, 1.0], scale: [0.2, 0.5], endScale: 0, alpha: 0.9 });
          break;
        }
        case "summon_ability": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y);
          const glow = summonDef(e.defId).palette.glow;
          this.fx.push({ kind: "ring", x: sx, y: sy, r0: 10, r1: 80 * u, life: 0.5, total: 0.5, color: glow, width: 3, squash: 0.42 });
          const src = world.entities.get(e.id);
          const label = src ? { x: this.sx(src.pos.x), y: this.sy(src.pos.y) - 70 * u } : { x: sx, y: sy - 60 * u };
          this.numbers.spawn(label.x, label.y, e.ability, 0xf0d9a8, 0.5, false);
          break;
        }
        case "shield": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y) - 40 * u;
          this.fx.push({ kind: "ring", x: sx, y: sy, r0: 10, r1: 46 * u, life: 0.5, total: 0.5, color: 0xe9c97a, width: 3, squash: 1 });
          break;
        }
        case "hazard": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y);
          this.fx.push({ kind: "ring", x: sx, y: sy, r0: 4, r1: e.radius * u, life: 0.4, total: 0.4, color: e.kind === "fire" ? 0xe0954f : 0x2a2620, width: 3, squash: 0.42 });
          break;
        }
        case "boss_intro": {
          this.flash(0x7f9fd0, 0.35);
          break;
        }
        case "perfect_dodge": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y);
          this.numbers.spawn(sx, sy - 130 * u, "Perfect", 0xe9c97a, 0.9, true);
          this.fx.push({ kind: "ring", x: sx, y: sy, r0: 90 * u, r1: 8, life: 0.4, total: 0.4, color: 0xe9c97a, width: 3, squash: 0.42 });
          this.flash(0xf0eadc, 0.12);
          break;
        }
        case "finisher": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y);
          this.fx.push({ kind: "ring", x: sx, y: sy, r0: 10, r1: (e.boss ? 260 : 120) * u, life: e.boss ? 1.1 : 0.6, total: e.boss ? 1.1 : 0.6, color: 0xe9c97a, width: e.boss ? 6 : 3, squash: 0.42 });
          this.flash(0xf0eadc, e.boss ? 0.45 : 0.16);
          this.shake(e.boss ? 14 : 5);
          break;
        }
        case "kill_streak": {
          const p = world.player;
          this.numbers.spawn(this.sx(p.pos.x), this.sy(p.pos.y) - 120 * u, `${e.count} Chain`, 0xe9c97a, 0.8, true);
          break;
        }
        case "blocked": {
          const t = world.entities.get(e.id);
          if (!t) break;
          const sx = this.sx(t.pos.x) + t.facing * 14 * u;
          const sy = this.sy(t.pos.y) - 46 * u * FIGURE_SCALE;
          if (Math.random() < 0.5) this.numbers.spawn(sx, sy, "Blocked", 0xb8b2a4, 0.5, false);
          this.particles.emit({ x: sx, y: sy + 10, count: 4, texture: spark(), color: 0xe8e2d4, speed: [60, 140], angle: t.facing === 1 ? [-0.6, 0.6] : [Math.PI - 0.6, Math.PI + 0.6], life: [0.1, 0.22], scale: [0.3, 0.6], endScale: 0.1 });
          break;
        }
        case "guard_break": {
          const t = world.entities.get(e.id);
          if (!t) break;
          const sx = this.sx(t.pos.x);
          const sy = this.sy(t.pos.y) - 50 * u * FIGURE_SCALE;
          this.numbers.spawn(sx, sy - 10, "Guard broken", 0xe9c97a, 0.72, true);
          this.particles.emit({ x: sx, y: sy + 10, count: 18, texture: shard(), color: 0xd8d0bc, speed: [80, 260], life: [0.3, 0.7], scale: [0.3, 0.7], endScale: 0, gravity: 300, additive: false, spin: 10 });
          this.shake(6);
          break;
        }
        case "elite_spawn": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y);
          const c = ELITES[e.affix as keyof typeof ELITES]?.color ?? 0xe9c97a;
          this.fx.push({ kind: "ring", x: sx, y: sy, r0: 8, r1: 70 * u, life: 0.7, total: 0.7, color: c, width: 3, squash: 0.42 });
          break;
        }
        case "minion_called": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y) - 60 * u;
          this.particles.emit({ x: sx, y: sy, count: 16, texture: softCircle(), color: 0xb59cf0, speed: [30, 120], life: [0.4, 0.8], scale: [0.2, 0.5], endScale: 0 });
          break;
        }
        case "boss_phase": {
          this.flash(0xa9d0e6, 0.5);
          const b = world.entities.get(e.id);
          if (b) {
            const sx = this.sx(b.pos.x);
            const sy = this.sy(b.pos.y);
            this.fx.push({ kind: "ring", x: sx, y: sy, r0: 20, r1: 220 * u, life: 0.8, total: 0.8, color: 0xa9d0e6, width: 6, squash: 0.42 });
            this.particles.emit({ x: sx, y: sy - 60 * u, count: 50, texture: shard(), color: 0xa9d0e6, speed: [100, 400], life: [0.5, 1.2], scale: [0.3, 0.9], endScale: 0, gravity: 200, spin: 10 });
          }
          break;
        }
        default:
          break;
      }
    }
  }

  private castFx(ability: string, pos: { x: number; y: number }, facing: 1 | -1, target: { x: number; y: number } | null): void {
    const u = this.unit();
    const sx = this.sx(pos.x);
    const sy = this.sy(pos.y);
    const bodyY = sy - 40 * u * FIGURE_SCALE * this.depthScale(pos.y);
    const def = ABILITIES[ability as keyof typeof ABILITIES];
    const color = def?.color ?? 0xffffff;
    switch (ability) {
      case "arc_slash":
        this.fx.push({ kind: "slash", x: sx + facing * 20 * u, y: bodyY, facing, radius: 124 * u, life: 0.46, total: 0.46, color: 0xf0eadc, width: 15 * u, sweep: Math.PI * 1.25 });
        this.fx.push({ kind: "slash", x: sx + facing * 20 * u, y: bodyY + 6 * u, facing, radius: 95 * u, life: 0.36, total: 0.36, color: 0xe9c97a, width: 5 * u, sweep: Math.PI * 1.1 });
        this.particles.emit({ x: sx + facing * 70 * u, y: bodyY, count: this.reduced ? 8 : 22, texture: spark(), color: 0xffffff, speed: [80, 300], angle: facing === 1 ? [-Math.PI * 0.6, Math.PI * 0.6] : [Math.PI * 0.4, Math.PI * 1.6], life: [0.2, 0.45], scale: [0.4, 1.0], endScale: 0.1, spin: 6 });
        break;
      case "thunder_strike": {
        const t = target ?? pos;
        const tx = this.sx(t.x);
        const ty = this.sy(t.y) - 40 * u;
        this.fx.push({ kind: "bolt", points: boltPoints({ x: tx + (Math.random() - 0.5) * 60, y: -20 }, { x: tx, y: ty }, 9), life: 0.3, total: 0.3, color, width: 4 });
        this.fx.push({ kind: "beam", x: tx, y: ty + 40 * u, life: 0.28, total: 0.28, color, height: this.height });
        this.flash(color, 0.14);
        break;
      }
      case "soul_burst":
        this.fx.push({ kind: "ring", x: sx, y: sy, r0: 10, r1: 120 * u, life: 0.55, total: 0.55, color, width: 6, squash: 0.42 });
        this.fx.push({ kind: "ring", x: sx, y: bodyY, r0: 10, r1: 80 * u, life: 0.45, total: 0.45, color: 0xffffff, width: 3, squash: 1 });
        this.particles.emit({ x: sx, y: bodyY, count: this.reduced ? 12 : 34, texture: softCircle(), color, speed: [40, 220], life: [0.4, 0.9], scale: [0.3, 0.7], endScale: 0, alpha: 0.9 });
        break;
      case "void_nova":
        this.fx.push({ kind: "ring", x: sx, y: sy, r0: 4, r1: 170 * u, life: 0.5, total: 0.5, color, width: 10, squash: 0.42 });
        this.fx.push({ kind: "ring", x: sx, y: sy, r0: 4, r1: 120 * u, life: 0.6, total: 0.6, color: 0xe9c97a, width: 3, squash: 0.42 });
        this.particles.emit({ x: sx, y: bodyY, count: this.reduced ? 15 : 48, texture: shard(), color, speed: [120, 420], life: [0.3, 0.8], scale: [0.3, 0.9], endScale: 0, spin: 10, additive: false });
        this.particles.emit({ x: sx, y: bodyY, count: 1, texture: softCircle(), color: 0x000000, speed: [0, 0], life: [0.35, 0.35], scale: [3, 3], endScale: 0.2, alpha: 0.9, additive: false });
        this.flash(0xf0eadc, 0.1);
        break;
      case "ascendant_fury": {
        const enemies = this.world?.enemies() ?? [];
        for (const en of enemies) {
          const ex = this.sx(en.pos.x);
          const ey = this.sy(en.pos.y) - 40 * u;
          const ang = Math.random() * Math.PI;
          const len = 90 * u;
          this.fx.push({ kind: "bolt", points: [{ x: ex - Math.cos(ang) * len, y: ey - Math.sin(ang) * len }, { x: ex + Math.cos(ang) * len, y: ey + Math.sin(ang) * len }], life: 0.25, total: 0.25, color: 0xe9c97a, width: 5 });
          this.particles.emit({ x: ex, y: ey, count: 10, texture: spark(), color: 0xe9c97a, speed: [100, 300], life: [0.2, 0.4], scale: [0.4, 1.0], endScale: 0.1 });
        }
        this.fx.push({ kind: "ring", x: sx, y: sy, r0: 10, r1: 100 * u, life: 0.5, total: 0.5, color: 0xe9c97a, width: 4, squash: 0.42 });
        break;
      }
      case "shadow_dash":
        break;
      default:
        break;
    }
  }

  shake(strength: number): void {
    this.shakeStrength = Math.min(24, Math.max(this.shakeStrength, strength));
  }

  flash(color: number, alpha: number): void {
    this.flashRect.tint = color;
    this.flashAlpha = Math.min(0.6, alpha);
    this.flashTime = 0.35;
  }

  levelUpBurst(): void {
    const w = this.world;
    if (!w) return;
    const u = this.unit();
    const sx = this.sx(w.player.pos.x);
    const sy = this.sy(w.player.pos.y);
    this.fx.push({ kind: "ring", x: sx, y: sy, r0: 6, r1: 90 * u, life: 0.8, total: 0.8, color: 0xe9c97a, width: 4, squash: 0.42 });
    this.fx.push({ kind: "beam", x: sx, y: sy, life: 0.7, total: 0.7, color: 0xe9c97a, height: this.height });
    this.particles.emit({ x: sx, y: sy - 40 * u, count: this.reduced ? 15 : 40, texture: softCircle(), color: 0xe9c97a, speed: [30, 160], angle: [-Math.PI, 0], life: [0.6, 1.3], scale: [0.25, 0.6], endScale: 0, alpha: 0.95 });
    this.flash(0xe9c97a, 0.18);
  }

  /** The shadow tries to rise, flickers, and tears apart. */
  playExtractionFail(pos: { x: number; y: number }): void {
    const u = this.unit();
    const sx = this.sx(pos.x);
    const sy = this.sy(pos.y);
    this.particles.emit({ x: sx, y: sy - 10 * u, count: 26, texture: softCircle(), color: 0xf0e6d0, speed: [10, 50], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.4, 0.8], scale: [0.25, 0.55], endScale: 0, alpha: 0.7 });
    this.particles.emit({ x: sx, y: sy - 40 * u, count: 22, texture: shard(), color: 0x2a2840, speed: [60, 200], life: [0.4, 0.9], scale: [0.25, 0.6], endScale: 0, gravity: 260, additive: false, spin: 8, alpha: 0.95 });
    this.fx.push({ kind: "ring", x: sx, y: sy, r0: 70 * u, r1: 6, life: 0.45, total: 0.45, color: 0x2a2620, width: 4, squash: 0.42 });
    this.numbers.spawn(sx, sy - 70 * u, "Refused", 0xd9cdb2, 0.75, true);
    this.shake(4);
  }

  // ---------------------------------------------------------------------
  // Portraits: the real rigs, rendered once into images for the UI
  // ---------------------------------------------------------------------

  /** Renders a three-quarter bust of a summon or enemy rig into a PNG data URL. */
  async portrait(defId: string, kind: "summon" | "enemy"): Promise<string | null> {
    const app = this.app;
    if (!app) return null;
    const spec = kind === "summon" ? summonSpec(defId) : enemySpec(defId);
    const rig = new Rig(spec);
    const box = 128;
    const holder = new Container();
    rig.animate("idle", 0.6, 0, 0.2, 1, false, 0, 0);
    // A bust framed from the rig's measured bounds: the top of the head sits near the top edge
    // and the figure is drawn 1.45x the frame height, so head, shoulders and weapon fill it.
    const b = rig.root.getLocalBounds();
    const scale = (box * 1.45) / Math.max(1, b.height);
    rig.root.scale.set(scale);
    rig.root.position.set(box * 0.5 - (b.x + b.width / 2) * scale, box * 0.07 - b.y * scale);
    // A transparent frame plus a mask pin the extracted bounds to exactly the portrait box.
    const frame = new Graphics().rect(0, 0, box, box).fill({ color: 0x000000, alpha: 0.001 });
    const mask = new Graphics().rect(0, 0, box, box).fill(0xffffff);
    holder.addChild(frame, rig.root, mask);
    rig.root.mask = mask;
    try {
      return await app.renderer.extract.base64({ target: holder, resolution: 2 });
    } catch {
      return null;
    } finally {
      holder.destroy({ children: true });
    }
  }

  // ---------------------------------------------------------------------
  // Summon cinematic
  // ---------------------------------------------------------------------

  playSummonCinematic(summonId: string, pos: { x: number; y: number }, first: boolean): void {
    this.endCinematic();
    const overlay = new Graphics();
    overlay.rect(0, 0, this.width, this.height).fill({ color: 0x03040a, alpha: 1 });
    overlay.alpha = 0;
    const rig = new Rig(summonSpec(summonId));
    rig.root.alpha = 0;
    const sx = clamp(this.sx(pos.x), this.width * 0.25, this.width * 0.75);
    const sy = clamp(this.sy(pos.y), this.groundTop + 30, this.groundBottom);
    rig.root.position.set(sx, sy);
    rig.shadow.position.set(sx, sy + 1);
    const ds = this.unit() * FIGURE_SCALE * 1.25 * (first ? 1.12 : 1);
    rig.root.scale.set(ds);
    rig.shadow.scale.set(ds, ds * 0.9);
    rig.shadow.alpha = 0;
    this.cinematicLayer.addChild(overlay, rig.shadow, rig.root);
    this.cinematic = { rig, x: sx, y: sy, t: 0, first, overlay, summonId, done: false, ending: false };
  }

  endCinematic(): void {
    if (!this.cinematic) return;
    this.cinematic.ending = true;
  }

  private updateCinematic(dt: number): void {
    const c = this.cinematic;
    if (!c) return;
    c.t += dt;
    const u = this.unit();
    const def = summonDef(c.summonId);
    const glow = def.palette.glow;
    const rarityColor = RARITY_COLOR[def.rarity] ?? 0xffffff;
    if (c.ending) {
      c.overlay.alpha = Math.max(0, c.overlay.alpha - dt * 2.5);
      c.rig.root.alpha = Math.max(0, c.rig.root.alpha - dt * 3);
      c.rig.shadow.alpha = c.rig.root.alpha;
      if (c.overlay.alpha <= 0) {
        c.rig.destroy();
        c.overlay.destroy();
        this.cinematic = null;
      }
      return;
    }
    // Timeline (first: 4.6s, else 1.5s): gather -> form -> eyes -> reveal
    const gather = c.first ? 1.6 : 0.5;
    const form = c.first ? 1.4 : 0.5;
    const eyes = c.first ? 0.6 : 0.2;
    const t = c.t;
    c.overlay.alpha = Math.min(0.72, t * 1.5);
    if (t < gather) {
      if (!this.reduced || Math.random() < 0.3) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 90 + Math.random() * 180;
        this.particles.emit({ x: c.x + Math.cos(ang) * dist, y: c.y - 40 * u + Math.sin(ang) * dist * 0.6, count: 2, texture: softCircle(), color: glow, speed: [0, 10], life: [0.7, 1.2], scale: [0.2, 0.5], endScale: 0.05, alpha: 0.9, target: { x: c.x, y: c.y - 46 * u * 1.3, strength: 9 } });
      }
      c.rig.root.alpha = 0;
    } else if (t < gather + form) {
      const k = (t - gather) / form;
      c.rig.root.alpha = Math.min(1, k * 1.2);
      c.rig.shadow.alpha = k;
      c.rig.animate("emerge", k * form, form, 0.3, 1, false, 0, 0);
      c.rig.root.alpha = k; // silhouette
      c.rig.root.tint = 0x000000;
      if (Math.random() < 0.6) this.particles.emit({ x: c.x + (Math.random() - 0.5) * 50 * u, y: c.y - Math.random() * 110 * u, count: 1, texture: softCircle(), color: glow, speed: [5, 30], angle: [-Math.PI * 0.8, -Math.PI * 0.2], life: [0.4, 0.9], scale: [0.15, 0.4], endScale: 0, alpha: 0.8 });
    } else if (t < gather + form + eyes) {
      const k = (t - gather - form) / eyes;
      c.rig.root.tint = lerpColor(0x000000, 0xffffff, easeOutCubic(k));
      c.rig.animate("idle", t, 0, 0.3, 1, false, 0, 0);
      if (!c.done && k > 0.3) {
        c.done = true;
        this.fx.push({ kind: "ring", x: c.x, y: c.y, r0: 10, r1: 160 * u, life: 0.9, total: 0.9, color: rarityColor, width: 6, squash: 0.42 });
        this.fx.push({ kind: "beam", x: c.x, y: c.y, life: 0.9, total: 0.9, color: glow, height: this.height });
        this.particles.emit({ x: c.x, y: c.y - 46 * u * 1.3, count: c.first ? 70 : 30, texture: shard(), color: rarityColor, speed: [80, 320], life: [0.5, 1.4], scale: [0.3, 0.9], endScale: 0, gravity: 180, spin: 8 });
        this.flash(glow, c.first ? 0.5 : 0.3);
        this.shake(c.first ? 10 : 5);
      }
    } else {
      c.rig.root.tint = 0xffffff;
      c.rig.animate("idle", t, 0, 0.3, 1, false, 0, 0);
      if (!this.reduced && Math.random() < 0.2) this.particles.emit({ x: c.x + (Math.random() - 0.5) * 60 * u, y: c.y, count: 1, texture: softCircle(), color: glow, speed: [10, 30], angle: [-Math.PI * 0.8, -Math.PI * 0.2], life: [0.8, 1.4], scale: [0.15, 0.35], endScale: 0, alpha: 0.7 });
    }
  }
}

function boltPoints(a: { x: number; y: number }, b: { x: number; y: number }, segments: number): { x: number; y: number }[] {
  const pts = [{ x: a.x, y: a.y }];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const off = (Math.random() - 0.5) * len * 0.18;
    pts.push({ x: a.x + dx * t + nx * off, y: a.y + dy * t + ny * off });
  }
  pts.push({ x: b.x, y: b.y });
  return pts;
}

function elementColor(element: string, crit: boolean): number {
  if (crit) return 0xe9c97a;
  switch (element) {
    case "lightning":
      return 0xa8c4e6;
    case "fire":
      return 0xe0954f;
    case "void":
      return 0xe7d3a6;
    case "soul":
      return 0x8fe0c4;
    default:
      return 0xf0eadc;
  }
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}
