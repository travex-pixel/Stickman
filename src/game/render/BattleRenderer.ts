// CSP-safe Pixi: replaces the eval-generated shader and uniform code so the strict Content-Security-Policy holds.
import "pixi.js/unsafe-eval";
import { Application, Container, Graphics, Sprite } from "pixi.js";
import type { GameController } from "../GameController";
import type { World } from "../engine/World";
import { ARENA } from "../engine/World";
import type { GameEvent } from "../engine/events";
import type { PerfSamples } from "../engine/GameLoop";
import type { Combatant } from "../entities/types";
import { Rig, DEATH_LAUNCH } from "./rigs/Rig";
import { eliteSpec, enemySpec, playerSpec, speciesAccent, summonSpec } from "./rigs/specs";
import { strikeWindow, swingVariant } from "./rigs/pose";
import { ELITES } from "../data/elites";
import { ParticleSystem } from "./Particles";
import { DamageNumbers, fmtNum } from "./DamageNumbers";
import { Background } from "./Background";
import { destroyTextures, hardCircle, ring, shard, softCircle, spark, vignette } from "./textures";
import { regionForStage } from "../data/regions";
import { TWISTS, depthForStage, twistForDepth } from "../data/depths";
import { ABILITIES } from "../data/abilities";
import { RARITY_COLOR, lighten, mix } from "./colors";
import { clamp, lerp } from "../engine/math";
import { damp, easeOutCubic } from "./anim/ease";
import { summonDef } from "../data/summons";
import { Camera, type Box } from "./Camera";
import { ImpactDirector, elementColor, type ImpactHost, type ImpactState } from "./ImpactDirector";
import { Trails, type Ribbon } from "./Trail";

interface EntityView extends ImpactState {
  id: number;
  bar: Graphics;
  barKey?: string;
  lastHp: number;
  defId: string;
  kind: string;
  trail: Ribbon | null;
  landed: boolean;
  dustT: number;
  /** Local hit-stop: seconds left holding pose and drawn position, then a short ease back. */
  holdLeft: number;
  /** The hold began this frame: animate once more so the held pose is the contact, not the frame before it. */
  holdFresh: boolean;
  releaseLeft: number;
  heldX: number;
  heldY: number;
  /** Last drawn ground position (base px), where a hold freezes it. */
  drawX: number;
  drawY: number;
}

type FxKind = "slash" | "bolt" | "ring" | "beam" | "afterimage" | "star" | "crescent" | "disc" | "line";

/** One pooled transient effect; fields are reused across kinds. */
interface Fx {
  kind: FxKind;
  x: number;
  y: number;
  x2: number;
  y2: number;
  r0: number;
  r1: number;
  life: number;
  total: number;
  delay: number;
  color: number;
  width: number;
  sweep: number;
  facing: 1 | -1;
  squash: number;
  alpha: number;
  pts: Float32Array;
  npts: number;
  live: boolean;
}

interface TelegraphMark {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

const WORLD_W = ARENA.width;
const WORLD_D = ARENA.depth;
/** Figures are drawn larger than the simulation footprint so fighters dominate the frame. */
const FIGURE_SCALE = 1.62;
/** Chest height of a standard figure, in rig units (for effects on things without a view). */
const CHEST = 50;
const MAX_FX = 128;
/** Hostiles this close to the warrior (world units) are framed with it; the boss always is. */
const FRAME_RADIUS = 260;
const FRAME_PAD = 70;
/** The backdrop is painted this far past each canvas edge so shake never shows its border. */
const BLEED = 24;
/** A held body eases back to its live position over this long. */
const HOLD_RELEASE = 0.06;

/** The mapping the interface uses to place things over the battlefield. */
export interface BattleView {
  /** Legacy, best effort under the camera: screenX ~ offsetX + x * scale, screenY ~ offsetY + y * depthScale. */
  scale: number;
  offsetX: number;
  offsetY: number;
  depthScale: number;
  width: number;
  height: number;
  /** World point on the ground to canvas-local CSS pixels, through the camera. */
  project(worldX: number, worldY: number): { x: number; y: number };
  /** Viewport (client) coordinates to the world point on the ground under them. */
  unproject(clientX: number, clientY: number): { x: number; y: number };
}

/**
 * BattleRenderer: PixiJS presentation of the simulation. Reads world state each frame, reacts to
 * simulation events with effects, and never mutates the world.
 *
 * Layers: everything in the scene (backdrop, ground marks, fighters, effects, numbers, the summon
 * cinematic) sits in one camera layer laid out in base space (the arena across the canvas width
 * at zoom 1). The vignette, damage-taken pulse, letterbox, off-screen chevrons and flash stay in
 * screen space above it.
 */
export class BattleRenderer implements ImpactHost {
  private app: Application | null = null;
  private host: HTMLElement | null = null;
  private world: World | null = null;
  private root = new Container();
  private cameraLayer = new Container();
  private groundFx = new Graphics();
  private entityLayer = new Container();
  /** Gold corner ticks around the player's focus target. */
  private focusTicks = new Graphics();
  private fxGraphics = new Graphics();
  private trails = new Trails();
  private projectileLayer = new Container();
  private orbLayer = new Container();
  readonly particles = new ParticleSystem(420);
  private numbers!: DamageNumbers;
  private flashRect = new Graphics();
  private pulse = new Sprite();
  private letterbox = new Graphics();
  private letterboxH = 0;
  private chevrons = new Graphics();
  private cinematicLayer = new Container();
  private background: Background | null = null;
  views = new Map<number, EntityView>();
  private projectiles = new Map<number, Container>();
  private orbs = new Map<number, { c: Container; core: Sprite; ring: Sprite; t: number; isBoss: boolean }>();
  private fxPool: Fx[] = [];
  readonly camera = new Camera();
  private impact = new ImpactDirector(this);
  private flashAlpha = 0;
  private flashTime = 0;
  private flashTotal = 0.35;
  private pulseT = 1;
  private letterboxT = 0;
  private skyDarken = 0;
  private skyColor = 0xffffff;
  private skyTint = 0xffffff;
  private skyTintBg: Background | null = null;
  private width = 0;
  private height = 0;
  private groundTop = 0;
  private groundBottom = 0;
  reduced = false;
  private time = 0;
  /** Seconds of hit-stop still running: fighters and effects hold, the camera does not. */
  private stopLeft = 0;
  private furyCount = 0;
  private furyAt = -10;
  private resizeObs: ResizeObserver | null = null;
  private cinematic: { rig: Rig; x: number; y: number; t: number; first: boolean; overlay: Graphics; summonId: string; done: boolean; ending: boolean } | null = null;
  private playerPath: string = "none";
  private lowHpPulse = 0;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private focusId = -1;
  private focusT = 1;
  private lastTelegraphs: number[] = [];
  private nextTelegraphs: number[] = [];
  private readonly telegraphMarks = new Map<number, TelegraphMark>();
  private readonly box: Box = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  private readonly vis: Box = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  private readonly pt = { x: 0, y: 0 };
  private readonly pt2 = { x: 0, y: 0 };
  private readonly seen = new Set<number>();
  private readonly view: BattleView;

  constructor(private readonly controller: GameController) {
    this.view = {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      depthScale: 1,
      width: 0,
      height: 0,
      project: (worldX: number, worldY: number) => this.camera.project(this.sx(worldX), this.sy(worldY), { x: 0, y: 0 }),
      unproject: (clientX: number, clientY: number) => {
        const rect = this.app?.canvas.getBoundingClientRect();
        const b = this.camera.unproject(clientX - (rect?.left ?? 0), clientY - (rect?.top ?? 0), { x: 0, y: 0 });
        return { x: b.x / Math.max(1e-6, this.unit()), y: (b.y - this.groundTop) / Math.max(1e-6, this.depthUnit()) };
      },
    };
  }

  async mount(host: HTMLElement): Promise<void> {
    this.host = host;
    // Bitmap glyphs are rasterised on first use, so the numeral face must be ready first.
    await DamageNumbers.loadFont();
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
    this.numbers = new DamageNumbers(32);
    app.stage.addChild(this.root);
    this.root.addChild(this.cameraLayer);
    // A render group: moving the camera is one transform on the GPU side, not a re-walk of every
    // fighter's transform.
    this.cameraLayer.isRenderGroup = true;
    this.cameraLayer.addChild(this.groundFx, this.entityLayer, this.projectileLayer, this.orbLayer, this.trails.graphics, this.fxGraphics, this.particles.container, this.numbers.container, this.cinematicLayer);
    this.entityLayer.sortableChildren = true;
    this.entityLayer.addChild(this.focusTicks);
    this.focusTicks.zIndex = 9000;
    this.pulse.texture = vignette();
    this.pulse.tint = 0xcc3f4b;
    this.pulse.alpha = 0;
    this.root.addChild(this.pulse, this.letterbox, this.chevrons, this.flashRect);
    this.flashRect.blendMode = "add";
    this.resizeObs = new ResizeObserver(() => {
      // Repainting the watercolour layers is expensive; wait for the size to settle.
      if (this.resizeTimer) clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.layout(), 120);
    });
    this.resizeObs.observe(host);
    this.layout();
    this.controller.view = this.view;
  }

  unmount(): void {
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = null;
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    for (const v of this.views.values()) {
      v.rig.destroy();
      v.bar.destroy();
    }
    this.views.clear();
    if (this.cinematic) {
      this.cinematic.rig.destroy();
      this.cinematic.overlay.destroy();
    }
    this.cinematic = null;
    this.particles.destroy();
    this.trails.destroy();
    this.numbers?.destroy();
    this.background?.destroy();
    this.background = null;
    this.fxPool = [];
    this.telegraphMarks.clear();
    destroyTextures();
    if (this.app) {
      this.app.destroy(true, { children: true, texture: true });
      this.app = null;
    }
    this.host = null;
  }

  setWorld(world: World): void {
    this.world = world;
    for (const v of this.views.values()) {
      v.rig.destroy();
      v.bar.destroy();
    }
    this.views.clear();
    for (const p of this.projectiles.values()) p.destroy({ children: true });
    this.projectiles.clear();
    for (const o of this.orbs.values()) o.c.destroy({ children: true });
    this.orbs.clear();
    for (const f of this.fxPool) f.live = false;
    this.particles.clear();
    this.trails.clear();
    this.decals.length = 0;
    this.telegraphMarks.clear();
    this.lastTelegraphs.length = 0;
    this.impact.reset();
    this.stopLeft = 0;
    this.letterboxT = 0;
    this.skyDarken = 0;
    this.focusId = -1;
    this.endCinematic();
    this.syncBackground();
    if (this.width > 0) {
      this.frameCamera(world, 1);
      this.camera.snap();
    }
  }

  /** Farming moved stages in place: repaint the backdrop only if the region or depth changed. */
  onStageChanged(): void {
    this.syncBackground();
  }

  private syncBackground(): void {
    const world = this.world;
    if (!world) return;
    const region = regionForStage(world.stage);
    const depth = depthForStage(world.stage);
    if (!this.background || this.background.regionId !== region.id || this.background.depth !== depth) {
      this.background?.destroy();
      const twist = twistForDepth(depth);
      this.background = new Background(region, depth, twist ? TWISTS[twist].tint : null);
      this.cameraLayer.addChildAt(this.background.container, 0);
      this.root.addChildAt(this.background.foreground, 1);
      this.layout();
    }
    this.background.setReduced(this.reduced);
  }

  setReducedEffects(v: boolean): void {
    this.reduced = v;
    this.particles.setCap(v ? 140 : 420);
    this.particles.countScale = v ? 0.4 : 1;
    this.camera.reduced = v;
    this.impact.setReduced(v);
    this.background?.setReduced(v);
  }

  /** The interface covers the bottom of the battlefield (a tall sheet): lift the framing above it. */
  setViewportInsets(insets: { bottom: number }): void {
    this.camera.setInsets(insets.bottom);
  }

  stats(): { particles: number; entities: number; renderer: string; trails: number } {
    const r = this.app?.renderer;
    const type = r ? (r.type === 1 ? "WebGL" : r.type === 2 ? "WebGPU" : "Canvas") : "none";
    return { particles: this.particles.count, entities: this.views.size, renderer: type, trails: this.trails.live };
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
    // The lower band carries the ability medallions; fighters stand on the ground above them.
    const reserve = 70;
    this.groundTop = Math.max(h * 0.36, (h - reserve) * 0.46);
    this.groundBottom = h - reserve;
    // Painted larger than the canvas so the zoomed camera stays sharp (capped for memory).
    const res = Math.min(2, window.devicePixelRatio || 1) * 1.3;
    this.background?.layout(w, h, this.groundTop, BLEED, res);
    this.flashRect.clear().rect(0, 0, w, h).fill(0xffffff);
    this.flashRect.alpha = 0;
    this.pulse.width = w;
    this.pulse.height = h;
    this.camera.bleed = BLEED;
    this.camera.setViewport(w, h);
    this.view.width = w;
    this.view.height = h;
    this.syncView();
  }

  /** Keep the legacy fields of the view in step with the camera (best effort; no rotation). */
  private syncView(): void {
    const o = this.camera.out;
    const v = this.view;
    v.scale = this.unit() * o.scale;
    v.offsetX = o.x - o.pivotX * o.scale;
    v.offsetY = o.y + (this.groundTop - o.pivotY) * o.scale;
    v.depthScale = this.depthUnit() * o.scale;
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

  /** Screen pixels per world unit along the depth axis. */
  private depthUnit(): number {
    return (this.groundBottom - this.groundTop) / WORLD_D;
  }

  private unit(): number {
    return this.width / WORLD_W;
  }

  /** Pixels per rig unit for a figure standing at depth y. */
  private figureScale(y: number): number {
    return this.depthScale(y) * this.unit() * FIGURE_SCALE;
  }

  // ImpactHost -----------------------------------------------------------

  speed(): number {
    const c = this.controller;
    return c.battleSpeedUnlocked && c.profile.settings.battleSpeed === 2 ? 2 : 1;
  }

  hold(id: number, seconds: number): void {
    const v = this.views.get(id);
    if (!v || seconds <= 0) return;
    if (v.holdLeft <= 0) {
      v.heldX = v.releaseLeft > 0 ? v.heldX : v.drawX;
      v.heldY = v.releaseLeft > 0 ? v.heldY : v.drawY;
      v.holdFresh = true;
    }
    v.holdLeft = Math.max(v.holdLeft, Math.min(0.2, v.holdLeft + seconds));
    v.releaseLeft = 0;
  }

  freeze(seconds: number): void {
    this.controller.hitStop(seconds);
    this.stopLeft = Math.min(0.35, this.stopLeft + seconds);
  }

  chest(e: Combatant, out: { x: number; y: number }): void {
    const v = this.views.get(e.id);
    const top = v ? v.rig.top : CHEST / 0.62;
    out.x = this.sx(e.pos.x) + (v ? v.slide * this.figureScale(e.pos.y) : 0);
    out.y = this.sy(e.pos.y) - top * 0.62 * this.figureScale(e.pos.y);
  }

  feet(e: Combatant, out: { x: number; y: number }): void {
    out.x = this.sx(e.pos.x);
    out.y = this.sy(e.pos.y);
  }

  scaleAt(e: Combatant): number {
    return this.figureScale(e.pos.y);
  }

  entity(id: number): Combatant | undefined {
    return this.world?.entities.get(id);
  }

  playerId(): number {
    return this.world?.player.id ?? -1;
  }

  starFlash(x: number, y: number, size: number, color: number): void {
    const f = this.addFx("star", x, y, 0.14, color);
    if (f) f.r1 = 34 * size * this.unit() * FIGURE_SCALE;
  }

  shockRing(x: number, y: number, r: number, color: number): void {
    this.ringFx(x, y, 6, r * this.unit() * FIGURE_SCALE * 0.6, 0.28, color, 1.5, 1);
  }

  crimsonPulse(): void {
    this.pulseT = 0;
  }

  // ---------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------

  render(alpha: number, dt: number, paused: boolean): void {
    const app = this.app;
    const world = this.world;
    if (!app || !world) return;
    this.time += dt;
    this.impact.now += dt;
    const frozen = this.stopLeft > 0;
    if (frozen) this.stopLeft -= dt;
    // In a hit-stop the fight holds still; the camera keeps moving so the blow lands.
    const fxDt = frozen ? 0 : dt;
    const entDt = paused || frozen ? 0 : dt;
    this.background?.update(paused ? dt * 0.3 : dt);
    this.syncEntities(world, alpha, entDt, fxDt, paused ? 0 : dt);
    if (!paused) this.frameCamera(world, alpha);
    this.camera.update(dt);
    const o = this.camera.out;
    this.cameraLayer.pivot.set(o.pivotX, o.pivotY);
    this.cameraLayer.position.set(o.x, o.y);
    this.cameraLayer.scale.set(o.scale);
    this.cameraLayer.rotation = o.rotation;
    this.syncView();
    this.camera.visible(this.vis);
    this.background?.setCamera((this.camera.cx - this.width / 2) / Math.max(1, this.width / 2));
    this.applySky(dt);
    this.drawFocus(world, alpha, dt);
    this.syncProjectiles(world, alpha);
    this.syncOrbs(world, dt);
    this.drawGroundFx(world, fxDt);
    this.updateFx(fxDt);
    this.trails.update(fxDt);
    this.particles.update(fxDt);
    this.numbers.setBounds(this.vis.minX, this.vis.maxX);
    this.numbers.setZoom(o.scale);
    this.numbers.update(dt);
    this.updateCinematic(dt);
    this.drawChevrons(world);
    // Screen-space overlays.
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      this.flashRect.alpha = Math.max(0, this.flashAlpha * (this.flashTime / this.flashTotal));
    } else this.flashRect.alpha = 0;
    const hpFrac = world.player.stats.maxHp > 0 ? world.player.hp / world.player.stats.maxHp : 1;
    this.lowHpPulse = hpFrac < 0.3 && !world.player.dead ? this.lowHpPulse + dt : 0;
    this.pulseT = Math.min(1, this.pulseT + dt / 0.2);
    const hurt = this.pulseT < 1 ? 0.55 * (1 - easeOutCubic(this.pulseT)) : 0;
    const low = this.lowHpPulse > 0 ? 0.16 + 0.1 * Math.sin(this.lowHpPulse * 4) : 0;
    this.pulse.alpha = Math.max(hurt, low);
    this.drawLetterbox(dt);
    const perf = (window as unknown as { __ASCEND_PERF__?: PerfSamples }).__ASCEND_PERF__;
    if (perf) {
      const t0 = performance.now();
      app.render();
      perf.draw.push(performance.now() - t0);
    } else app.render();
  }

  /**
   * Framing: the box around the warrior and every hostile within 260 world units (the boss
   * always), padded, biased toward the warrior. The camera follows it with damping.
   */
  private frameCamera(world: World, alpha: number): void {
    const p = world.player;
    const b = this.box;
    const u = this.unit();
    const px = lerp(p.prevPos.x, p.pos.x, alpha);
    const py = lerp(p.prevPos.y, p.pos.y, alpha);
    const pv = this.views.get(p.id);
    const top = (pv?.rig.top ?? 82) * this.figureScale(py);
    b.minX = b.maxX = this.sx(px);
    b.maxY = this.sy(py);
    b.minY = b.maxY - top;
    const r2 = FRAME_RADIUS * FRAME_RADIUS;
    for (const e of world.entities.values()) {
      if (e.faction !== "enemy" || e.dead) continue;
      const boss = e.kind === "boss";
      const dx = e.pos.x - p.pos.x;
      const dy = e.pos.y - p.pos.y;
      if (!boss && dx * dx + dy * dy > r2) continue;
      if (e.statuses.some((st) => st.kind === "submerged")) continue;
      const ex = this.sx(e.pos.x);
      const ey = this.sy(e.pos.y);
      const ev = this.views.get(e.id);
      const et = (ev?.rig.top ?? 82) * this.figureScale(e.pos.y);
      if (ex < b.minX) b.minX = ex;
      if (ex > b.maxX) b.maxX = ex;
      if (ey > b.maxY) b.maxY = ey;
      if (ey - et < b.minY) b.minY = ey - et;
    }
    const pad = FRAME_PAD * u;
    b.minX -= pad;
    b.maxX += pad;
    b.minY -= pad * 0.5;
    b.maxY += pad * 0.35;
    this.camera.frame(b, this.sx(px), this.sy(py) - top * 0.5);
  }

  private syncEntities(world: World, alpha: number, dt: number, fxDt: number, realDt: number): void {
    const seen = this.seen;
    seen.clear();
    const player = world.player;
    for (const e of world.entities.values()) {
      seen.add(e.id);
      let v = this.views.get(e.id);
      if (!v || v.defId !== e.defId || (e.kind === "player" && this.playerPath !== world.loadout.weaponPath)) {
        if (e.kind === "player") this.playerPath = world.loadout.weaponPath;
        if (v) this.dropView(v);
        v = this.createView(e);
        this.views.set(e.id, v);
      }
      const x = lerp(e.prevPos.x, e.pos.x, alpha);
      const y = lerp(e.prevPos.y, e.pos.y, alpha);
      let sx = this.sx(x);
      let sy = this.sy(y);
      const ds = this.figureScale(y);
      // Local hit-stop: the two bodies in a blow hold their pose and drawn place while the
      // simulation runs on, then ease back to it over 60ms.
      const fresh = v.holdFresh;
      v.holdFresh = false;
      const held = v.holdLeft > 0 && !fresh;
      if (v.holdLeft > 0) {
        if (!fresh) v.holdLeft -= realDt;
        if (v.holdLeft <= 0) v.releaseLeft = HOLD_RELEASE;
        sx = v.heldX;
        sy = v.heldY;
      } else if (v.releaseLeft > 0) {
        v.releaseLeft = Math.max(0, v.releaseLeft - realDt);
        const k = easeOutCubic(1 - v.releaseLeft / HOLD_RELEASE);
        sx = lerp(v.heldX, sx, k);
        sy = lerp(v.heldY, sy, k);
      }
      v.drawX = sx;
      v.drawY = sy;
      const reactDt = held ? 0 : fxDt;
      // Impact reaction: squash and a slide away from the blow that settle back.
      v.squash = damp(v.squash, 0, 16, reactDt);
      v.slide = damp(v.slide, 0, 9, reactDt);
      const rig = v.rig;
      rig.setReaction(v.squash, v.slide * 0.02 * -e.facing);
      rig.root.position.set(sx + v.slide * ds, sy);
      rig.root.scale.set(ds);
      rig.root.zIndex = y;
      const moving = e.state === "move";
      const speedFrac = Math.min(1, Math.hypot(e.vel.x, e.vel.y) / 160);
      const variant = swingVariant(v.swings, e.state);
      if (!held) rig.animate(e.state, e.stateTime, e.stateDuration, e.seed, e.facing, moving, speedFrac, e.deathTime, dt, variant);
      rig.setHitFlash(e.hitFlash);
      if (v.white > 0) {
        rig.setWhite(true);
        v.white -= 1;
      } else rig.setWhite(false);
      if (e.summon?.temporary) rig.root.alpha = Math.min(rig.root.alpha, 0.72);
      const submerged = e.statuses.some((st) => st.kind === "submerged");
      if (submerged) {
        // Sunk: only a dark wake and a pale ripple show where it glides.
        rig.root.alpha = 0.12;
        if (!this.reduced && fxDt > 0 && Math.random() < 0.3) {
          this.particles.emit({ x: sx + (Math.random() - 0.5) * 30, y: sy, count: 1, texture: softCircle(), color: 0x8fc9c4, speed: [5, 20], angle: [-Math.PI, 0], life: [0.3, 0.6], scale: [0.2, 0.4], alpha: 0.6 });
        }
      }
      rig.shadow.position.set(sx + (v.slide + rig.deathShiftX) * ds, sy + 1);
      rig.shadow.scale.set(ds * rig.poolScale, ds * 0.9 * rig.poolScale);
      rig.shadow.zIndex = -1000 + y;
      if (e.dead) {
        if (rig.deathVariant === DEATH_LAUNCH && !v.landed && e.deathTime >= 0.45) {
          v.landed = true;
          this.impact.onLanded(e);
        }
      } else {
        v.landed = false;
        // A long slide kicks up dust at the feet.
        if (fxDt > 0 && Math.abs(e.knockback.x) + Math.abs(e.knockback.y) > 110) {
          v.dustT -= fxDt;
          if (v.dustT <= 0) {
            v.dustT = 0.07;
            this.impact.dust(e);
          }
        }
      }
      if (!held) this.syncTrail(v, e, e.id === player.id);
      this.drawBar(v, e, sx, sy, ds);
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) {
        this.dropView(v);
        this.views.delete(id);
      }
    }
  }

  private dropView(v: EntityView): void {
    if (v.trail) this.trails.release(v.trail);
    v.trail = null;
    v.rig.destroy();
    v.bar.destroy();
  }

  /** Weapon ribbons: sample the blade from the strike through the follow-through. */
  private syncTrail(v: EntityView, e: Combatant, isPlayer: boolean): void {
    const kit = v.rig.meleeKit;
    const melee = kit === "combo" || kit === "heavy" || kit === "thrust";
    const live = melee && !e.dead && ((e.state === "windup" && e.stateTime >= e.stateDuration - strikeWindow(e.stateDuration)) || e.state === "attack");
    if (live) {
      if (!v.trail) {
        const color = isPlayer ? pathColor(this.world?.loadout.weaponPath ?? "none") : e.kind === "summon" ? speciesAccent(e.defId) : e.kind === "boss" ? 0xa9d0e6 : 0xd95a66;
        v.trail = this.trails.acquire(e.id, color, isPlayer ? 0.95 : e.kind === "summon" ? 0.55 : 0.4, isPlayer);
      }
      if (v.trail) {
        v.rig.weaponPoints(this.pt, this.pt2);
        this.trails.sample(v.trail, this.pt.x, this.pt.y, this.pt2.x, this.pt2.y);
      }
    } else if (v.trail) {
      this.trails.release(v.trail);
      v.trail = null;
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
    return {
      id: e.id,
      rig,
      bar,
      lastHp: -1,
      defId: e.defId,
      kind: e.kind,
      swings: 0,
      swungThisBatch: false,
      lastHitCrit: false,
      lastHitHeavy: false,
      lastHitAbility: false,
      lastHitElement: "physical",
      lastHitDir: 1,
      white: 0,
      squash: 0,
      slide: 0,
      trail: null,
      landed: false,
      dustT: 0,
      holdLeft: 0,
      holdFresh: false,
      releaseLeft: 0,
      heldX: 0,
      heldY: 0,
      drawX: this.sx(e.pos.x),
      drawY: this.sy(e.pos.y),
    };
  }

  /** Four gold corner ticks around the focus target; they contract onto it when it is acquired. */
  private drawFocus(world: World, alpha: number, dt: number): void {
    const g = this.focusTicks;
    const f = world.focusId >= 0 ? world.entities.get(world.focusId) : undefined;
    if (!f || f.dead || f.statuses.some((st) => st.kind === "submerged")) {
      g.visible = false;
      this.focusId = -1;
      return;
    }
    if (f.id !== this.focusId) {
      this.focusId = f.id;
      this.focusT = 0;
    }
    this.focusT += dt;
    const x = lerp(f.prevPos.x, f.pos.x, alpha);
    const y = lerp(f.prevPos.y, f.pos.y, alpha);
    const ds = this.figureScale(y);
    const v = this.views.get(f.id);
    const h = (v?.rig.top ?? 82) * ds;
    const w = Math.max(h * 0.42, f.radius * 1.6 * ds);
    const k = this.reduced ? 1 : easeOutCubic(clamp(this.focusT / 0.2, 0, 1));
    const grow = 1 + 0.5 * (1 - k);
    const cx = this.sx(x) + (v ? v.slide * ds : 0);
    const cy = this.sy(y) - h * 0.5;
    const hw = (w / 2 + 6) * grow;
    const hh = (h / 2 + 8) * grow;
    const t = 8;
    g.visible = true;
    g.clear();
    g.position.set(cx, cy);
    for (let i = 0; i < 4; i++) {
      const sxn = i & 1 ? 1 : -1;
      const syn = i & 2 ? 1 : -1;
      const ex = sxn * hw;
      const ey = syn * hh;
      g.moveTo(ex - sxn * t, ey).lineTo(ex, ey).lineTo(ex, ey - syn * t);
    }
    g.stroke({ width: 2, color: 0xe9c97a, alpha: 0.95 * (0.4 + 0.6 * k), cap: "square" });
  }

  /** The living enemy drawn nearest a screen point (client coordinates), or null. */
  pickEnemy(clientX: number, clientY: number): number | null {
    const world = this.world;
    const canvas = this.app?.canvas as HTMLCanvasElement | undefined;
    if (!world || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const b = this.camera.unproject(clientX - rect.left, clientY - rect.top, this.pt);
    const px = b.x;
    const py = b.y;
    // Touch slop in base px: a finger is the same size on screen whatever the zoom.
    const zoom = this.camera.scale;
    const slop = 10 / zoom;
    let best: number | null = null;
    let bestD = Infinity;
    for (const e of world.entities.values()) {
      if (e.dead || e.faction !== "enemy" || e.statuses.some((st) => st.kind === "submerged")) continue;
      const ds = this.figureScale(e.pos.y);
      const v = this.views.get(e.id);
      const sx = this.sx(e.pos.x);
      const feet = this.sy(e.pos.y);
      const top = feet - (v?.rig.top ?? 82) * ds;
      const halfW = Math.max(26 / zoom, e.radius * 2 * ds);
      if (px < sx - halfW || px > sx + halfW || py < top - slop || py > feet + slop + 6) continue;
      const d = Math.abs(px - sx) + Math.abs(py - (feet + top) / 2) * 0.5;
      if (d < bestD) {
        bestD = d;
        best = e.id;
      }
    }
    return best;
  }

  private drawBar(v: EntityView, e: Combatant, sx: number, sy: number, ds: number): void {
    const bar = v.bar;
    const hurt = e.hp < e.stats.maxHp - 0.5 || e.shield > 0;
    const flagged = !!e.enemy?.elite || !!e.enemy?.eligible;
    if (e.dead || e.kind === "boss" || (!hurt && !flagged) || e.statuses.some((st) => st.kind === "submerged")) {
      bar.visible = false;
      return;
    }
    bar.visible = true;
    const top = sy - (v.rig.top + 12) * ds;
    bar.position.set(sx + v.slide * ds, top);
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
    const seen = this.seen;
    seen.clear();
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
      c.position.set(this.sx(x), this.sy(y) - CHEST * this.figureScale(y) - arcLift);
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
    const seen = this.seen;
    seen.clear();
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

  private drawGroundFx(world: World, dt: number): void {
    const g = this.groundFx;
    g.clear();
    const u = this.unit();
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i]!;
      d.life -= dt;
      if (d.life <= 0) {
        this.decals.splice(i, 1);
        continue;
      }
      const k = d.life / d.total;
      g.ellipse(d.x, d.y, d.rx * (1 + (1 - k) * 0.3), d.ry * (1 + (1 - k) * 0.3)).fill({ color: d.color, alpha: 0.55 * Math.min(1, k * 1.6) });
    }
    // Telegraphs keep their true size (the geometry the simulation tests): a thin rim that fills
    // inward as the time runs out, crimson when hostile, and a white flash on the frame it lands.
    const vy = this.depthUnit();
    const next = this.nextTelegraphs;
    next.length = 0;
    for (const t of world.telegraphs) {
      next.push(t.id);
      const k = clamp(1 - t.remaining / t.total, 0, 1);
      const color = t.hostile ? 0xcc3f4b : t.color;
      const sx = this.sx(t.pos.x);
      const sy = this.sy(t.pos.y);
      const rx = t.radius * u;
      const ry = t.radius * vy;
      let mark = this.telegraphMarks.get(t.id);
      if (!mark) {
        mark = { x: 0, y: 0, rx: 0, ry: 0 };
        this.telegraphMarks.set(t.id, mark);
      }
      if (t.shape === "circle") {
        mark.x = sx;
        mark.y = sy;
        mark.rx = rx;
        mark.ry = ry;
        g.ellipse(sx, sy, rx, ry).fill({ color, alpha: 0.07 });
        // The fill is an annulus growing inward from the rim.
        const bw = Math.max(0.5, rx * k);
        g.ellipse(sx, sy, Math.max(0.5, rx - bw / 2), Math.max(0.5, ry - (bw / 2) * (ry / rx))).stroke({ width: bw, color, alpha: 0.2 + 0.1 * k });
        g.ellipse(sx, sy, rx, ry).stroke({ width: 1.5, color, alpha: 0.85 });
      } else if (t.shape === "line") {
        const len = t.length * u;
        const x0 = Math.min(sx, sx + t.dir * len);
        const w = Math.abs(len);
        mark.x = x0 + w / 2;
        mark.y = sy;
        mark.rx = w / 2;
        mark.ry = ry;
        g.rect(x0, sy - ry, w, ry * 2).fill({ color, alpha: 0.07 });
        const fh = ry * k;
        g.rect(x0, sy - ry, w, fh).fill({ color, alpha: 0.22 });
        g.rect(x0, sy + ry - fh, w, fh).fill({ color, alpha: 0.22 });
        g.rect(x0, sy - ry, w, ry * 2).stroke({ width: 1.5, color, alpha: 0.85 });
      } else {
        // Cone: traced in world space so its spread matches the hit test on every screen.
        mark.x = sx + (t.dir * t.length * u) / 2;
        mark.y = sy;
        mark.rx = (t.length * u) / 2;
        mark.ry = t.length * vy * 0.7;
        const a0 = t.dir === 1 ? -Math.PI * 0.45 : Math.PI * 0.55;
        const a1 = t.dir === 1 ? Math.PI * 0.45 : Math.PI * 1.45;
        for (let pass = 0; pass < 2; pass++) {
          g.moveTo(sx, sy);
          for (let i = 0; i <= 16; i++) {
            const a = a0 + ((a1 - a0) * i) / 16;
            g.lineTo(sx + Math.cos(a) * t.length * u, sy + Math.sin(a) * t.length * vy);
          }
          g.closePath();
          if (pass === 0) g.fill({ color, alpha: 0.07 + 0.18 * k });
          else g.stroke({ width: 1.5, color, alpha: 0.85 });
        }
      }
    }
    // Telegraphs that resolved since last frame flash white once.
    for (const id of this.lastTelegraphs) {
      if (next.includes(id)) continue;
      const m = this.telegraphMarks.get(id);
      if (m) {
        g.ellipse(m.x, m.y, Math.max(1, m.rx), Math.max(1, m.ry)).fill({ color: 0xffffff, alpha: 0.25 }).stroke({ width: 3, color: 0xffffff, alpha: 0.95 });
        this.telegraphMarks.delete(id);
      }
    }
    const swap = this.lastTelegraphs;
    this.lastTelegraphs = next;
    this.nextTelegraphs = swap;
    const player = world.player;
    for (const e of world.entities.values()) {
      if (e.dead) continue;
      // A hostile winding up at the warrior: a thin crimson rim under its feet for the wind-up.
      if (e.faction === "enemy" && e.state === "windup" && e.pendingTargetId === player.id) {
        const k = clamp(e.stateTime / Math.max(0.01, e.stateDuration), 0, 1);
        const r = Math.max(16, e.radius * 1.3) * this.figureScale(e.pos.y);
        g.ellipse(this.sx(e.pos.x), this.sy(e.pos.y), r, r * 0.34).stroke({ width: 1.5, color: 0xcc3f4b, alpha: 0.35 + 0.55 * k });
      }
      // Banner auras: the ground a banner covers, crimson for the enemy's, gold for the army's.
      const enemyBanner = e.enemy?.archetype === "bannerman";
      const allyBanner = e.kind === "summon" && e.summon?.role === "support";
      if (!enemyBanner && !allyBanner) continue;
      const radius = enemyBanner ? 150 : 160;
      const color = enemyBanner ? 0xb3473f : 0xe9c97a;
      const pulse = 0.75 + Math.sin(this.time * 3 + e.id) * 0.25;
      g.ellipse(this.sx(e.pos.x), this.sy(e.pos.y), radius * u, radius * vy).fill({ color, alpha: 0.05 * pulse });
      g.ellipse(this.sx(e.pos.x), this.sy(e.pos.y), radius * u, radius * vy).stroke({ width: 1.5, color, alpha: 0.35 * pulse });
    }
    for (const h of world.hazards) {
      const sx = this.sx(h.pos.x);
      const sy = this.sy(h.pos.y);
      const r = h.radius * u;
      const rv = h.radius * vy;
      const color = h.kind === "fire" ? (h.faction === "ally" ? 0xe0954f : 0xc9643a) : h.kind === "tide" ? 0x3f7d80 : 0x1d1a16;
      const flicker = 0.75 + Math.sin(this.time * 14 + h.id) * 0.15;
      g.ellipse(sx, sy, r, rv).fill({ color, alpha: 0.18 * flicker * Math.min(1, h.remaining) });
      g.ellipse(sx, sy, r * 0.6, rv * 0.6).fill({ color: lighten(color, 0.4), alpha: 0.2 * flicker * Math.min(1, h.remaining) });
      // A hostile hazard gets a clear rim: it is the area that hurts.
      if (h.faction === "enemy") g.ellipse(sx, sy, r, rv).stroke({ width: 1.5, color: lighten(color, 0.3), alpha: 0.55 * Math.min(1, h.remaining) });
      if (!this.reduced && dt > 0 && Math.random() < 0.35) {
        this.particles.emit({ x: sx + (Math.random() - 0.5) * r * 1.6, y: sy + (Math.random() - 0.5) * rv * 1.4, count: 1, texture: softCircle(), color, speed: [10, 40], angle: [-Math.PI * 0.7, -Math.PI * 0.3], life: [0.3, 0.7], scale: [0.15, 0.35], alpha: 0.8 });
      }
    }
  }

  /** Off-screen hostiles: a small chevron at the edge, crimson when it is winding up at the warrior. */
  private drawChevrons(world: World): void {
    const g = this.chevrons;
    g.clear();
    const w = this.width;
    const h = this.height - this.camera.insetBottom;
    const player = world.player;
    for (const e of world.entities.values()) {
      if (e.dead || e.faction !== "enemy") continue;
      if (e.statuses.some((st) => st.kind === "submerged")) continue;
      const by = this.sy(e.pos.y) - CHEST * this.figureScale(e.pos.y);
      const p = this.camera.project(this.sx(e.pos.x), by, this.pt);
      const m = 4;
      if (p.x >= -m && p.x <= w + m && p.y >= -m && p.y <= h + m) continue;
      const threat = e.state === "windup" && e.pendingTargetId === player.id;
      const color = threat ? 0xcc3f4b : 0x74716b;
      const cx = clamp(p.x, 10, w - 10);
      const cy = clamp(p.y, 54, Math.max(60, h - 90));
      const ang = Math.atan2(p.y - cy, p.x - cx);
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      // A 10px chevron pointing out of the frame.
      const tipX = cx + c * 4;
      const tipY = cy + s * 4;
      g.moveTo(tipX - c * 6 - s * 5, tipY - s * 6 + c * 5)
        .lineTo(tipX, tipY)
        .lineTo(tipX - c * 6 + s * 5, tipY - s * 6 - c * 5)
        .stroke({ width: 2, color, alpha: threat ? 1 : 0.85, cap: "round", join: "round" });
    }
  }

  private drawLetterbox(dt: number): void {
    const g = this.letterbox;
    const on = this.letterboxT > 0;
    if (on) this.letterboxT -= dt;
    const target = on && !this.reduced ? 20 : 0;
    const prev = this.letterboxH;
    this.letterboxH = damp(this.letterboxH, target, 14, dt);
    if (this.letterboxH < 0.5) {
      if (prev >= 0.5) g.clear();
      return;
    }
    g.clear();
    g.rect(0, 0, this.width, this.letterboxH).fill(0x050506);
    g.rect(0, this.height - this.letterboxH, this.width, this.letterboxH).fill(0x050506);
  }

  /** Backdrop tint for sky-darkening and void desaturation; settles back by itself. */
  private applySky(dt: number): void {
    const bg = this.background;
    if (!bg) return;
    this.skyDarken = damp(this.skyDarken, 0, 5, dt);
    const tint = this.skyDarken > 0.01 ? mix(0xffffff, this.skyColor, this.skyDarken) : 0xffffff;
    // Setting a tint dirties the whole backdrop subtree, so only when it changes.
    if (tint !== this.skyTint || bg !== this.skyTintBg) {
      bg.container.tint = tint;
      this.skyTint = tint;
      this.skyTintBg = bg;
    }
  }

  private darkenSky(color: number, amount: number): void {
    this.skyColor = color;
    this.skyDarken = Math.max(this.skyDarken, this.reduced ? amount * 0.5 : amount);
  }

  // ---------------------------------------------------------------------
  // Transient effects (pooled)
  // ---------------------------------------------------------------------

  private addFx(kind: FxKind, x: number, y: number, life: number, color: number): Fx | null {
    let f: Fx | undefined;
    for (const r of this.fxPool) {
      if (!r.live) {
        f = r;
        break;
      }
    }
    if (!f) {
      if (this.fxPool.length >= MAX_FX) return null;
      f = { kind, x: 0, y: 0, x2: 0, y2: 0, r0: 0, r1: 0, life: 0, total: 0, delay: 0, color: 0, width: 1, sweep: 0, facing: 1, squash: 0.42, alpha: 1, pts: new Float32Array(24), npts: 0, live: false };
      this.fxPool.push(f);
    }
    f.kind = kind;
    f.x = x;
    f.y = y;
    f.x2 = x;
    f.y2 = y;
    f.r0 = 0;
    f.r1 = 0;
    f.life = life;
    f.total = life;
    f.delay = 0;
    f.color = color;
    f.width = 1;
    f.sweep = 0;
    f.facing = 1;
    f.squash = 0.42;
    f.alpha = 1;
    f.npts = 0;
    f.live = true;
    return f;
  }

  private ringFx(x: number, y: number, r0: number, r1: number, life: number, color: number, width: number, squash: number, delay = 0): void {
    const f = this.addFx("ring", x, y, life, color);
    if (!f) return;
    f.r0 = r0;
    f.r1 = r1;
    f.width = width;
    f.squash = squash;
    f.delay = delay;
  }

  private slashFx(x: number, y: number, facing: 1 | -1, radius: number, life: number, color: number, width: number, sweep: number): void {
    const f = this.addFx("slash", x, y, life, color);
    if (!f) return;
    f.facing = facing;
    f.r1 = radius;
    f.width = width;
    f.sweep = sweep;
  }

  private beamFx(x: number, y: number, life: number, color: number, height: number): void {
    const f = this.addFx("beam", x, y, life, color);
    if (f) f.r1 = height;
  }

  private boltFx(ax: number, ay: number, bx: number, by: number, segments: number, life: number, color: number, width: number, jag = 0.18): void {
    const f = this.addFx("bolt", ax, ay, life, color);
    if (!f) return;
    f.width = width;
    const n = Math.min(11, Math.max(1, segments));
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    f.pts[0] = ax;
    f.pts[1] = ay;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const off = (Math.random() - 0.5) * len * jag;
      f.pts[i * 2] = ax + dx * t + nx * off;
      f.pts[i * 2 + 1] = ay + dy * t + ny * off;
    }
    f.pts[n * 2] = bx;
    f.pts[n * 2 + 1] = by;
    f.npts = n + 1;
  }

  private afterimageFx(x: number, y: number, life: number, total: number, color: number, w: number, h: number, alpha: number): void {
    const f = this.addFx("afterimage", x, y, life, color);
    if (!f) return;
    f.total = total;
    f.r0 = w;
    f.r1 = h;
    f.alpha = alpha;
  }

  private lineFx(x: number, y: number, x2: number, y2: number, life: number, color: number, width: number, delay = 0): void {
    const f = this.addFx("line", x, y, life, color);
    if (!f) return;
    f.x2 = x2;
    f.y2 = y2;
    f.width = width;
    f.delay = delay;
  }

  private updateFx(dt: number): void {
    const g = this.fxGraphics;
    g.clear();
    for (const f of this.fxPool) {
      if (!f.live) continue;
      if (f.delay > 0) {
        f.delay -= dt;
        continue;
      }
      f.life -= dt;
      if (f.life <= 0) {
        f.live = false;
        continue;
      }
      const k = 1 - f.life / f.total;
      const age = f.total - f.life;
      switch (f.kind) {
        case "slash": {
          const e = easeOutCubic(k);
          const start = f.facing === 1 ? -Math.PI * 0.75 : Math.PI * 0.25;
          const sweep = f.sweep * f.facing;
          const a0 = start + sweep * Math.max(0, e - 0.35);
          const a1 = start + sweep * e;
          const alpha = (1 - k) * 0.95;
          g.arc(f.x, f.y, f.r1, Math.min(a0, a1), Math.max(a0, a1)).stroke({ width: f.width * (1 - k * 0.5), color: f.color, alpha, cap: "round" });
          g.arc(f.x, f.y, f.r1 * 0.92, Math.min(a0, a1), Math.max(a0, a1)).stroke({ width: f.width * 0.4, color: 0xffffff, alpha: alpha * 0.8, cap: "round" });
          break;
        }
        case "crescent": {
          // A crescent that travels along the facing, growing 0.6 to 1.2; white for its first frames.
          const e = easeOutCubic(k);
          const cx = lerp(f.x, f.x2, e);
          const r = f.r1 * (0.6 + 0.6 * e);
          const color = age < 0.035 ? 0xffffff : f.color;
          const alpha = 1 - k * k;
          const a0 = f.facing === 1 ? -Math.PI * 0.42 : Math.PI * 0.58;
          const a1 = a0 + Math.PI * 0.84;
          g.arc(cx, f.y, r, a0, a1).arc(cx - f.facing * r * 0.28, f.y, r * 0.86, a1, a0, true).closePath().fill({ color, alpha: alpha * 0.9 });
          g.arc(cx, f.y, r * 1.03, a0 + 0.1, a1 - 0.1).stroke({ width: 2, color: 0xffffff, alpha: alpha * 0.8 });
          break;
        }
        case "bolt": {
          // Drawn in over two frames, then holds and fades.
          const alpha = 1 - k;
          const reveal = Math.min(f.npts, 1 + Math.ceil((f.npts - 1) * Math.min(1, age / 0.033)));
          if (reveal > 1) {
            for (let pass = 0; pass < 2; pass++) {
              g.moveTo(f.pts[0]!, f.pts[1]!);
              for (let j = 1; j < reveal; j++) g.lineTo(f.pts[j * 2]!, f.pts[j * 2 + 1]!);
              if (pass === 0) g.stroke({ width: f.width * 2.6, color: f.color, alpha: alpha * 0.35, cap: "round", join: "round" });
              else g.stroke({ width: f.width, color: 0xffffff, alpha, cap: "round", join: "round" });
            }
          }
          break;
        }
        case "ring": {
          const e = easeOutCubic(k);
          const r = lerp(f.r0, f.r1, e);
          g.ellipse(f.x, f.y, Math.max(0.5, r), Math.max(0.5, r * f.squash)).stroke({ width: Math.max(0.1, f.width * (1 - k)), color: f.color, alpha: (1 - k) * 0.9 });
          break;
        }
        case "beam": {
          const alpha = Math.sin(k * Math.PI);
          g.rect(f.x - 6, f.y - f.r1, 12, f.r1).fill({ color: f.color, alpha: alpha * 0.5 });
          g.rect(f.x - 2, f.y - f.r1, 4, f.r1).fill({ color: 0xffffff, alpha: alpha * 0.9 });
          break;
        }
        case "afterimage": {
          g.ellipse(f.x, f.y, f.r0, f.r1).fill({ color: f.color, alpha: (1 - k) * f.alpha });
          break;
        }
        case "star": {
          // A four-point star flash.
          const s = f.r1 * (0.6 + 0.6 * easeOutCubic(Math.min(1, k * 3))) * (1 - k * 0.4);
          const t = s * 0.16;
          const p = f.pts;
          p[0] = f.x;
          p[1] = f.y - s;
          p[2] = f.x + t;
          p[3] = f.y - t;
          p[4] = f.x + s;
          p[5] = f.y;
          p[6] = f.x + t;
          p[7] = f.y + t;
          p[8] = f.x;
          p[9] = f.y + s;
          p[10] = f.x - t;
          p[11] = f.y + t;
          p[12] = f.x - s;
          p[13] = f.y;
          p[14] = f.x - t;
          p[15] = f.y - t;
          g.moveTo(p[0], p[1]);
          for (let j = 1; j < 8; j++) g.lineTo(p[j * 2]!, p[j * 2 + 1]!);
          g.closePath().fill({ color: f.color, alpha: 1 - k });
          break;
        }
        case "disc": {
          // A dark disc that expands with a bright rim.
          const e = easeOutCubic(k);
          const r = lerp(f.r0, f.r1, e);
          const alpha = 1 - k * k;
          g.ellipse(f.x, f.y, r, r * f.squash).fill({ color: 0x08070c, alpha: alpha * 0.55 });
          g.ellipse(f.x, f.y, r, r * f.squash).stroke({ width: 3 * (1 - k) + 1, color: f.color, alpha });
          break;
        }
        case "line": {
          const alpha = 1 - k;
          g.moveTo(f.x, f.y).lineTo(f.x2, f.y2).stroke({ width: f.width * (1 - k * 0.5), color: f.color, alpha, cap: "round" });
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
          this.impact.onSwing(e.id);
          if (e.heavy && e.kind !== "player") {
            // A brute or boss blow lands: a dust ring where it struck.
            const sx = this.sx(e.pos.x) + e.facing * 40 * u;
            const ground = this.sy(e.pos.y);
            this.ringFx(sx, ground, 10 * u, 70 * u, 0.35, 0xd9823f, 4, 0.42);
            this.particles.emit({ x: sx, y: ground, count: this.reduced ? 6 : 14, texture: softCircle(), color: 0x8a7a6a, speed: [30, 120], angle: [-Math.PI, 0], life: [0.3, 0.6], scale: [0.2, 0.5], gravity: 300, additive: false, alpha: 0.6 });
            if (e.kind === "boss") this.camera.shake(0.3);
          }
          break;
        }
        case "hit": {
          this.impact.onHit(e);
          const target = world.entities.get(e.targetId);
          if (e.amount > 0 && target) {
            this.chest(target, this.pt);
            const taken = e.targetKind === "player";
            const col = taken ? 0xcc3f4b : e.crit ? 0xdab86c : e.element === "physical" ? 0xf3f0e9 : lighten(elementColor(e.element), 0.45);
            this.numbers.spawn(this.pt.x, this.pt.y - 12, fmtNum(e.amount), col, taken ? "taken" : e.crit ? "crit" : "normal");
          }
          break;
        }
        case "heal": {
          const t = world.entities.get(e.targetId);
          if (t) this.chest(t, this.pt);
          else {
            this.pt.x = this.sx(e.pos.x);
            this.pt.y = this.sy(e.pos.y) - 50 * u;
          }
          this.numbers.spawn(this.pt.x, this.pt.y - 6, `+${fmtNum(e.amount)}`, 0x5ecaa8, "heal");
          this.particles.emit({ x: this.pt.x, y: this.pt.y + 20, count: this.reduced ? 6 : 14, texture: softCircle(), color: 0x8fe0c4, speed: [20, 60], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.5, 0.9], scale: [0.2, 0.45], alpha: 0.9 });
          break;
        }
        case "death": {
          this.impact.onDeath(e);
          const sx = this.sx(e.pos.x);
          const ground = this.sy(e.pos.y);
          const isBoss = e.kind === "boss";
          if (e.kind !== "summon") this.splatter(sx, ground, isBoss);
          if (isBoss) {
            const cy = ground - 60 * this.figureScale(e.pos.y);
            this.particles.emit({ x: sx, y: cy, count: 70, texture: shard(), color: 0xa9d0e6, speed: [40, 420], life: [0.4, 1.6], scale: [0.25, 1.0], endScale: 0, gravity: 260, additive: false, alpha: 0.95, spin: 8 });
            this.particles.emit({ x: sx, y: cy, count: 40, texture: softCircle(), color: 0xa9d0e6, speed: [10, 160], life: [0.5, 1.8], scale: [0.4, 1.6], endScale: 1.6, alpha: 0.5 });
            this.ringFx(sx, ground, 20, this.width, 0.9, 0xa9d0e6, 6, 0.42);
          } else {
            // A few flecks of ink; the body itself does the dying.
            this.particles.emit({ x: sx, y: ground - 30 * this.figureScale(e.pos.y), count: this.reduced ? 4 : 8, texture: shard(), color: e.kind === "summon" ? 0xe9c97a : 0x2c2b2a, speed: [40, 160], life: [0.3, 0.7], scale: [0.2, 0.45], endScale: 0, gravity: 300, additive: false, alpha: 0.9, spin: 8 });
          }
          break;
        }
        case "cast": {
          this.castFx(e.ability, e.id, e.pos, e.facing, e.targetPos);
          break;
        }
        case "chain": {
          const ay = this.sy(e.from.y) - CHEST * this.figureScale(e.from.y);
          const bx = this.sx(e.to.x);
          const by = this.sy(e.to.y) - CHEST * this.figureScale(e.to.y);
          this.boltFx(this.sx(e.from.x), ay, bx, by, 6, 0.22, e.color, 2.5);
          this.particles.emit({ x: bx, y: by, count: this.reduced ? 4 : 8, texture: spark(), color: e.color, speed: [60, 200], life: [0.15, 0.3], scale: [0.3, 0.8], endScale: 0.1, alignToVelocity: true });
          break;
        }
        case "dodge": {
          // Shadow Dash: ink afterimages with falling alpha, speed lines along the path, a cut on arrival.
          const ds = this.figureScale(e.from.y);
          const h = 34 * ds;
          for (let i = 0; i < 4; i++) {
            const t = i / 4;
            const x = lerp(e.from.x, e.to.x, t);
            this.afterimageFx(this.sx(x), this.sy(e.from.y) - h, 0.22 + t * 0.1, 0.32, 0x15141a, 9 * ds, h, 0.55 - t * 0.1);
          }
          const y0 = this.sy(e.from.y);
          for (let i = 0; i < 4; i++) {
            const yy = y0 - (12 + i * 14) * ds;
            this.lineFx(this.sx(e.from.x), yy, this.sx(e.to.x), yy + (Math.random() - 0.5) * 4, 0.18, 0xf0eadc, 1.5, i * 0.015);
          }
          this.starFlash(this.sx(e.to.x), this.sy(e.to.y) - CHEST * ds, 0.6, 0xffffff);
          this.particles.emit({ x: this.sx(e.from.x), y: y0 - 10 * ds, count: this.reduced ? 5 : 12, texture: softCircle(), color: 0xd9cdb2, speed: [20, 90], life: [0.3, 0.6], scale: [0.3, 0.6], endScale: 0, alpha: 0.6 });
          break;
        }
        case "essence_available": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y) - 28 * u;
          this.ringFx(sx, this.sy(e.pos.y), 4, 60 * u, 0.8, e.isBoss ? 0xe9c56f : 0xf0e6d0, 3, 0.42);
          this.particles.emit({ x: sx, y: sy, count: 18, texture: softCircle(), color: e.isBoss ? 0xe9c97a : 0xf0e6d0, speed: [20, 80], life: [0.6, 1.2], scale: [0.2, 0.5], endScale: 0, alpha: 0.9 });
          break;
        }
        case "projectile_hit": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y) - CHEST * this.figureScale(e.pos.y);
          const color = e.kind === "ember" ? 0xe0954f : e.kind === "warden_bolt" ? 0xa9d0e6 : 0xe8e2d4;
          this.particles.emit({ x: sx, y: sy, count: this.reduced ? 3 : 7, texture: spark(), color, speed: [50, 160], life: [0.15, 0.3], scale: [0.3, 0.6], endScale: 0.1, alignToVelocity: true });
          break;
        }
        case "gold": {
          if (this.reduced) break;
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y) - 20 * u;
          this.particles.emit({ x: sx, y: sy, count: Math.min(6, 2 + Math.floor(e.amount / 8)), texture: hardCircle(), color: 0xe9c97a, speed: [40, 140], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.5, 0.8], scale: [0.18, 0.28], endScale: 0.1, gravity: 420, additive: false });
          break;
        }
        case "xp": {
          if (this.reduced) break;
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y) - 20 * u;
          this.particles.emit({ x: sx, y: sy, count: 3, texture: softCircle(), color: 0xa8c4e6, speed: [20, 80], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.5, 0.8], scale: [0.2, 0.35], endScale: 0.05 });
          break;
        }
        case "summon_deployed": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y);
          const glow = summonDef(e.defId).palette.glow;
          this.ringFx(sx, sy, 6, 50 * u, 0.6, glow, 3, 0.42);
          this.particles.emit({ x: sx, y: sy - 30 * u, count: this.reduced ? 8 : 24, texture: softCircle(), color: glow, speed: [20, 90], angle: [-Math.PI, 0], life: [0.5, 1.0], scale: [0.2, 0.5], endScale: 0, alpha: 0.9 });
          break;
        }
        case "summon_ability": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y);
          // Each species' ability flashes in its own sigil colour.
          const glow = speciesAccent(e.defId);
          this.ringFx(sx, sy, 10, 80 * u, 0.5, glow, 3, 0.42);
          this.particles.emit({ x: sx, y: sy - 30 * u, count: this.reduced ? 5 : 14, texture: spark(), color: glow, speed: [60, 200], life: [0.25, 0.5], scale: [0.3, 0.7], endScale: 0.1, alignToVelocity: true });
          const src = world.entities.get(e.id);
          const lx = src ? this.sx(src.pos.x) : sx;
          const ly = src ? this.sy(src.pos.y) - 105 * this.figureScale(src.pos.y) : sy - 60 * u;
          this.numbers.spawn(lx, ly, e.ability, 0xf0d9a8, "label");
          break;
        }
        case "shield": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y) - CHEST * this.figureScale(e.pos.y);
          this.ringFx(sx, sy, 10, 46 * u, 0.5, 0xe9c97a, 3, 1);
          break;
        }
        case "hazard": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y);
          this.ringFx(sx, sy, 4, e.radius * u, 0.4, e.kind === "fire" ? 0xe0954f : e.kind === "tide" ? 0x8fc9c4 : 0x2a2620, 3, 0.42);
          break;
        }
        case "boss_intro": {
          this.flash(0x7f9fd0, 0.35);
          break;
        }
        case "tyrant_break": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y);
          this.numbers.spawn(sx, sy - 160 * u, `BREAK ×${e.count}`, 0xdab86c, "crit");
          this.ringFx(sx, sy - 40 * u, 20 * u, 150 * u, 0.55, 0xe9c97a, 5, 0.55);
          this.ringFx(sx, sy - 40 * u, 10 * u, 95 * u, 0.4, 0xfff1c9, 3, 0.55);
          this.camera.punch(0.03);
          break;
        }
        case "perfect_dodge": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y);
          this.numbers.spawn(sx, sy - 130 * u, "Perfect", 0xdab86c, "label");
          this.ringFx(sx, sy, 90 * u, 8, 0.4, 0xe9c97a, 3, 0.42);
          this.camera.punch(0.03);
          this.flash(0xf0eadc, 0.12);
          break;
        }
        case "finisher": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y);
          this.ringFx(sx, sy, 10, (e.boss ? 260 : 120) * u, e.boss ? 1.1 : 0.6, 0xe9c97a, e.boss ? 6 : 3, 0.42);
          this.flash(0xf0eadc, e.boss ? 0.45 : 0.16);
          this.camera.punch(e.boss ? 0.05 : 0.02);
          break;
        }
        case "kill_streak": {
          const p = world.player;
          this.numbers.spawn(this.sx(p.pos.x), this.sy(p.pos.y) - 120 * u, `${e.count} Chain`, 0xdab86c, "label");
          break;
        }
        case "blocked": {
          const t = world.entities.get(e.id);
          if (!t) break;
          const sx = this.sx(t.pos.x) + t.facing * 14 * u;
          const sy = this.sy(t.pos.y) - CHEST * this.figureScale(t.pos.y);
          if (Math.random() < 0.5) this.numbers.spawn(sx, sy, "Blocked", 0xb8b2a4, "label");
          this.particles.emit({ x: sx, y: sy + 10, count: 4, texture: spark(), color: 0xe8e2d4, speed: [60, 140], angle: t.facing === 1 ? [-0.6, 0.6] : [Math.PI - 0.6, Math.PI + 0.6], life: [0.1, 0.22], scale: [0.3, 0.6], endScale: 0.1, alignToVelocity: true });
          break;
        }
        case "guard_break": {
          const t = world.entities.get(e.id);
          if (!t) break;
          const sx = this.sx(t.pos.x);
          const sy = this.sy(t.pos.y) - 60 * this.figureScale(t.pos.y);
          this.numbers.spawn(sx, sy - 10, "Guard broken", 0xdab86c, "label");
          this.particles.emit({ x: sx, y: sy + 10, count: 18, texture: shard(), color: 0xd8d0bc, speed: [80, 260], life: [0.3, 0.7], scale: [0.3, 0.7], endScale: 0, gravity: 300, additive: false, spin: 10 });
          this.camera.shake(0.2);
          break;
        }
        case "elite_spawn": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y);
          const c = ELITES[e.affix as keyof typeof ELITES]?.color ?? 0xe9c97a;
          this.ringFx(sx, sy, 8, 70 * u, 0.7, c, 3, 0.42);
          break;
        }
        case "minion_called": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y) - 60 * u;
          this.particles.emit({ x: sx, y: sy, count: 16, texture: softCircle(), color: 0xb59cf0, speed: [30, 120], life: [0.4, 0.8], scale: [0.2, 0.5], endScale: 0 });
          break;
        }
        case "boss_phase": {
          this.impact.phase();
          this.flash(0xa9d0e6, 0.5);
          this.camera.punch(0.03);
          const b = world.entities.get(e.id);
          if (b) {
            const sx = this.sx(b.pos.x);
            const sy = this.sy(b.pos.y);
            this.ringFx(sx, sy, 20, 220 * u, 0.8, 0xa9d0e6, 6, 0.42);
            this.particles.emit({ x: sx, y: sy - 60 * u, count: 50, texture: shard(), color: 0xa9d0e6, speed: [100, 400], life: [0.5, 1.2], scale: [0.3, 0.9], endScale: 0, gravity: 200, spin: 10 });
          }
          break;
        }
        case "freeze":
          // Authored by the simulation (boss kill, Tyrant break): it plays, and uses up the window.
          this.impact.onAuthoredFreeze(e.duration);
          this.stopLeft = Math.min(0.35, this.stopLeft + e.duration);
          break;
        default:
          break;
      }
    }
    for (const v of this.views.values()) v.swungThisBatch = false;
  }

  private castFx(ability: string, id: number, pos: { x: number; y: number }, facing: 1 | -1, target: { x: number; y: number } | null): void {
    const u = this.unit();
    const sx = this.sx(pos.x);
    const sy = this.sy(pos.y);
    const fs = this.figureScale(pos.y);
    const bodyY = sy - CHEST * fs;
    const def = ABILITIES[ability as keyof typeof ABILITIES];
    const color = def?.color ?? 0xffffff;
    const isPlayer = id === this.world?.player.id;
    switch (ability) {
      case "arc_slash": {
        // A crescent that travels 140u and grows, white for two frames; the cut lingers on the ground.
        const f = this.addFx("crescent", sx + facing * 18 * u, bodyY, 0.34, pathColor(this.world?.loadout.weaponPath ?? "none"));
        if (f) {
          f.x2 = sx + facing * 158 * u;
          f.facing = facing;
          f.r1 = 46 * fs;
        }
        this.lineFx(sx + facing * 30 * u, sy + 2, sx + facing * 170 * u, sy + 2, 0.26, 0xf0eadc, 2, 0.06);
        this.particles.emit({ x: sx + facing * 70 * u, y: bodyY, count: this.reduced ? 8 : 18, texture: spark(), color: 0xffffff, speed: [80, 300], angle: facing === 1 ? [-Math.PI * 0.3, Math.PI * 0.3] : [Math.PI * 0.7, Math.PI * 1.3], life: [0.2, 0.45], scale: [0.4, 1.0], endScale: 0.1, alignToVelocity: true });
        if (isPlayer) {
          this.camera.punch(0.025);
          this.camera.shake(0.15);
        }
        break;
      }
      case "thunder_strike": {
        const t = target ?? pos;
        const tx = this.sx(t.x);
        const tg = this.sy(t.y);
        const ty = tg - CHEST * this.figureScale(t.y);
        this.darkenSky(0x3a3f55, 0.25);
        this.boltFx(tx + (Math.random() - 0.5) * 60, this.vis.minY - 20, tx, ty, 3, 0.3, color, 4, 0.3);
        this.boltFx(tx + (Math.random() - 0.5) * 40, this.vis.minY - 20, tx, ty, 6, 0.22, color, 2, 0.18);
        this.beamFx(tx, tg, 0.2, color, this.height);
        // Scorch: a dark ring on the ground with a hot rim.
        this.ringFx(tx, tg, 8 * u, 46 * u, 0.6, 0x1d1a16, 6, 0.42);
        this.ringFx(tx, tg, 4 * u, 60 * u, 0.35, lighten(color, 0.3), 2, 0.42);
        this.flash(0xffffff, 0.4, 0.06);
        if (isPlayer) {
          this.impact.stop(0.06, "thunder", 0.2);
          this.camera.shake(0.4);
          this.camera.punch(0.025);
        }
        break;
      }
      case "soul_burst": {
        // Motes are drawn in for 150ms, then a ring expands to 180u; allies inside pulse jade.
        if (!this.reduced) {
          this.particles.emit({ x: sx, y: bodyY, count: 16, texture: softCircle(), color, speed: [0, 10], life: [0.15, 0.2], scale: [0.2, 0.35], endScale: 0.05, alpha: 0.9, spread: 150 * u, target: { x: sx, y: bodyY, strength: 60 } });
        }
        this.ringFx(sx, sy, 10, 180 * u, 0.55, color, 6, 0.42, 0.15);
        this.ringFx(sx, bodyY, 10, 70 * u, 0.4, 0xffffff, 3, 1, 0.15);
        this.particles.emit({ x: sx, y: bodyY, count: this.reduced ? 12 : 26, texture: softCircle(), color, speed: [40, 220], life: [0.4, 0.9], scale: [0.3, 0.7], endScale: 0, alpha: 0.9 });
        const world = this.world;
        if (world) {
          for (const e of world.entities.values()) {
            if (e.faction !== "ally" || e.dead) continue;
            if (Math.hypot(e.pos.x - pos.x, e.pos.y - pos.y) > 180) continue;
            this.ringFx(this.sx(e.pos.x), this.sy(e.pos.y), 6, 30 * u, 0.4, color, 2, 0.42, 0.18);
          }
        }
        if (isPlayer) this.camera.punch(0.02);
        break;
      }
      case "void_nova": {
        // The field drains of colour; a dark disc spreads with a bright rim; debris in, then out.
        this.darkenSky(0x8a8a92, 0.6);
        const f = this.addFx("disc", sx, sy, 0.5, color);
        if (f) {
          f.r0 = 6;
          f.r1 = 170 * u;
        }
        this.ringFx(sx, sy, 4, 120 * u, 0.6, 0xe9c97a, 3, 0.42);
        if (!this.reduced) this.particles.emit({ x: sx, y: bodyY, count: 14, texture: shard(), color, speed: [0, 10], life: [0.15, 0.2], scale: [0.2, 0.4], endScale: 0.1, spread: 220 * u, target: { x: sx, y: bodyY, strength: 50 }, additive: false });
        this.particles.emit({ x: sx, y: bodyY, count: this.reduced ? 15 : 40, texture: shard(), color, speed: [120, 420], life: [0.3, 0.8], scale: [0.3, 0.9], endScale: 0, spin: 10, additive: false });
        this.flash(0xf0eadc, 0.1);
        if (isPlayer) {
          this.camera.punch(0.03);
          this.camera.shake(0.3);
        }
        break;
      }
      case "ascendant_fury": {
        // Seven strikes 0.16s apart: letterbox, a punch on the first, gold blades that each stop
        // briefly, and a final ring with heavy trauma.
        if (this.time - this.furyAt > 1.2) this.furyCount = 0;
        this.furyAt = this.time;
        this.furyCount += 1;
        this.letterboxT = 1.9;
        if (this.furyCount === 1) this.camera.punch(0.05);
        const enemies = this.world?.enemies() ?? [];
        for (const en of enemies) {
          const ex = this.sx(en.pos.x);
          const ey = this.sy(en.pos.y) - CHEST * this.figureScale(en.pos.y);
          const ang = Math.random() * Math.PI;
          const len = 90 * u;
          this.lineFx(ex - Math.cos(ang) * len, ey - Math.sin(ang) * len, ex + Math.cos(ang) * len, ey + Math.sin(ang) * len, 0.25, 0xe9c97a, 5);
          this.particles.emit({ x: ex, y: ey, count: 8, texture: spark(), color: 0xe9c97a, speed: [100, 300], life: [0.2, 0.4], scale: [0.4, 1.0], endScale: 0.1, alignToVelocity: true });
        }
        this.impact.stop(0.033, "fury", 0.1);
        if (this.furyCount >= 7) {
          this.ringFx(sx, sy, 10, 220 * u, 0.7, 0xe9c97a, 5, 0.42);
          this.camera.shake(0.6);
        } else this.ringFx(sx, sy, 10, 100 * u, 0.5, 0xe9c97a, 3, 0.42);
        break;
      }
      case "blade_tempest":
        // A whirlwind: full-circle slashes that linger for the four pulses.
        this.slashFx(sx, bodyY, 1, 118 * u, 1.0, 0xf0eadc, 10 * u, Math.PI * 2);
        this.slashFx(sx, bodyY + 8 * u, -1, 88 * u, 0.8, 0xe9c97a, 4 * u, Math.PI * 2);
        this.ringFx(sx, sy, 20, 130 * u, 0.9, 0xd9cdb2, 3, 0.42);
        this.particles.emit({ x: sx, y: bodyY, count: this.reduced ? 10 : 24, texture: spark(), color: 0xffffff, speed: [120, 320], life: [0.2, 0.5], scale: [0.3, 0.8], endScale: 0.1, alignToVelocity: true });
        if (isPlayer) this.camera.punch(0.02);
        break;
      case "chain_hook": {
        const t = target ?? pos;
        this.particles.emit({ x: this.sx(t.x), y: this.sy(t.y) - CHEST * this.figureScale(t.y), count: this.reduced ? 5 : 12, texture: spark(), color, speed: [60, 200], life: [0.15, 0.35], scale: [0.3, 0.8], endScale: 0.1, alignToVelocity: true });
        break;
      }
      case "blood_pact":
        this.ringFx(sx, sy, 60 * u, 8, 0.5, color, 5, 0.42);
        this.particles.emit({ x: sx, y: bodyY, count: this.reduced ? 8 : 24, texture: softCircle(), color, speed: [30, 110], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.5, 1.0], scale: [0.25, 0.55], endScale: 0, alpha: 0.85 });
        this.flash(color, 0.12);
        break;
      default:
        break;
    }
  }

  /** Legacy shake strengths (2 to 18) become camera trauma. */
  shake(strength: number): void {
    this.camera.shake(Math.min(0.7, strength / 30));
  }

  flash(color: number, alpha: number, duration = 0.35): void {
    this.flashRect.tint = color;
    this.flashAlpha = Math.min(0.6, alpha) * (this.reduced ? 0.5 : 1);
    this.flashTime = duration;
    this.flashTotal = duration;
  }

  levelUpBurst(): void {
    const w = this.world;
    if (!w) return;
    const u = this.unit();
    const sx = this.sx(w.player.pos.x);
    const sy = this.sy(w.player.pos.y);
    // One ring and twenty motes.
    this.ringFx(sx, sy, 6, 90 * u, 0.8, 0xe9c97a, 4, 0.42);
    this.particles.emit({ x: sx, y: sy - 40 * u, count: 20, texture: softCircle(), color: 0xe9c97a, speed: [30, 160], angle: [-Math.PI, 0], life: [0.6, 1.3], scale: [0.25, 0.6], endScale: 0, alpha: 0.95 });
    this.flash(0xe9c97a, 0.12);
  }

  /** The shadow tries to rise, flickers, and tears apart. */
  playExtractionFail(pos: { x: number; y: number }): void {
    const u = this.unit();
    const sx = this.sx(pos.x);
    const sy = this.sy(pos.y);
    this.particles.emit({ x: sx, y: sy - 10 * u, count: 26, texture: softCircle(), color: 0xf0e6d0, speed: [10, 50], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.4, 0.8], scale: [0.25, 0.55], endScale: 0, alpha: 0.7 });
    this.particles.emit({ x: sx, y: sy - 40 * u, count: 22, texture: shard(), color: 0x2a2840, speed: [60, 200], life: [0.4, 0.9], scale: [0.25, 0.6], endScale: 0, gravity: 260, additive: false, spin: 8, alpha: 0.95 });
    this.ringFx(sx, sy, 70 * u, 6, 0.45, 0x2a2620, 4, 0.42);
    this.numbers.spawn(sx, sy - 70 * u, "Refused", 0xd9cdb2, "label");
    this.camera.shake(0.15);
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
      rig.destroy();
    }
  }

  // ---------------------------------------------------------------------
  // Summon cinematic. It lives inside the camera layer, above the fight, so its rings and motes
  // share the fighters' space; its overlay is oversized so it covers the screen at any zoom.
  // ---------------------------------------------------------------------

  playSummonCinematic(summonId: string, pos: { x: number; y: number }, first: boolean): void {
    if (this.cinematic) {
      this.cinematic.rig.destroy();
      this.cinematic.overlay.destroy();
      this.cinematic = null;
    }
    const overlay = new Graphics();
    overlay.rect(-this.width, -this.height, this.width * 3, this.height * 3).fill({ color: 0x03040a, alpha: 1 });
    overlay.alpha = 0;
    const rig = new Rig(summonSpec(summonId));
    rig.root.alpha = 0;
    // Stage the figure where the camera is looking, so it is centred whatever the zoom.
    this.camera.visible(this.vis);
    const midX = (this.vis.minX + this.vis.maxX) / 2;
    const span = this.vis.maxX - this.vis.minX;
    const sx = clamp(this.sx(pos.x), midX - span * 0.25, midX + span * 0.25);
    const sy = clamp(this.sy(pos.y), this.groundTop + 30, Math.max(this.groundTop + 30, Math.min(this.groundBottom, this.vis.maxY - 40)));
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
    const top = c.rig.top * c.rig.root.scale.y;
    c.overlay.alpha = Math.min(0.72, t * 1.5);
    if (t < gather) {
      if (!this.reduced || Math.random() < 0.3) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 90 + Math.random() * 180;
        this.particles.emit({ x: c.x + Math.cos(ang) * dist, y: c.y - top * 0.5 + Math.sin(ang) * dist * 0.6, count: 2, texture: softCircle(), color: glow, speed: [0, 10], life: [0.7, 1.2], scale: [0.2, 0.5], endScale: 0.05, alpha: 0.9, target: { x: c.x, y: c.y - top * 0.55, strength: 9 } });
      }
      c.rig.root.alpha = 0;
    } else if (t < gather + form) {
      const k = (t - gather) / form;
      c.rig.shadow.alpha = k;
      c.rig.animate("emerge", k * form, form, 0.3, 1, false, 0, 0, dt);
      c.rig.root.alpha = k; // silhouette
      c.rig.root.tint = 0x000000;
      if (Math.random() < 0.6) this.particles.emit({ x: c.x + (Math.random() - 0.5) * 50 * u, y: c.y - Math.random() * top, count: 1, texture: softCircle(), color: glow, speed: [5, 30], angle: [-Math.PI * 0.8, -Math.PI * 0.2], life: [0.4, 0.9], scale: [0.15, 0.4], endScale: 0, alpha: 0.8 });
    } else if (t < gather + form + eyes) {
      const k = (t - gather - form) / eyes;
      c.rig.root.tint = mix(0x000000, 0xffffff, easeOutCubic(k));
      c.rig.animate("idle", t, 0, 0.3, 1, false, 0, 0, dt);
      if (!c.done && k > 0.3) {
        c.done = true;
        this.ringFx(c.x, c.y, 10, 160 * u, 0.9, rarityColor, 6, 0.42);
        this.beamFx(c.x, c.y, 0.9, glow, this.height * 1.5);
        this.particles.emit({ x: c.x, y: c.y - top * 0.55, count: c.first ? 70 : 30, texture: shard(), color: rarityColor, speed: [80, 320], life: [0.5, 1.4], scale: [0.3, 0.9], endScale: 0, gravity: 180, spin: 8 });
        this.flash(glow, c.first ? 0.5 : 0.3);
        this.camera.shake(c.first ? 0.35 : 0.2);
      }
    } else {
      c.rig.root.tint = 0xffffff;
      c.rig.animate("idle", t, 0, 0.3, 1, false, 0, 0, dt);
      if (!this.reduced && Math.random() < 0.2) this.particles.emit({ x: c.x + (Math.random() - 0.5) * 60 * u, y: c.y, count: 1, texture: softCircle(), color: glow, speed: [10, 30], angle: [-Math.PI * 0.8, -Math.PI * 0.2], life: [0.8, 1.4], scale: [0.15, 0.35], endScale: 0, alpha: 0.7 });
    }
  }
}

function pathColor(path: string): number {
  return path === "stormblade" ? 0xa8c4e6 : path === "infernal" ? 0xe0954f : path === "voidfang" ? 0xd95a66 : 0xf0eadc;
}
