// CSP-safe Pixi: replaces the eval-generated shader and uniform code so the strict Content-Security-Policy holds.
import "pixi.js/unsafe-eval";
import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";
import type { EmitOptions } from "./Particles";
import type { GameController } from "../GameController";
import type { World } from "../engine/World";
import { ARENA } from "../engine/World";
import type { GameEvent } from "../engine/events";
import type { PerfSamples } from "../engine/GameLoop";
import type { Combatant } from "../entities/types";
import { Rig, DEATH_LAUNCH, clearRigCache, rigCacheSize } from "./rigs/Rig";
import { eliteSpec, enemySpec, playerSpec, speciesAccent, summonSpec } from "./rigs/specs";
import { strikeWindow, swingVariant } from "./rigs/pose";
import { ELITES } from "../data/elites";
import { ParticleSystem } from "./Particles";
import { DamageNumbers, fmtNum } from "./DamageNumbers";
import { Background, backdropResolution } from "./Background";
import { destroyTextures, hardCircle, shard, softCircle, spark, vignette } from "./textures";
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
import { FlashState } from "./hitStop";
import { BossDeath, BossEntrance, PHASE, type BossHost } from "./cinematics/boss";
import { FuryGhosts } from "./FuryGhosts";
import { AriseCinematic, FailedBind, REDUCED_FADE, REVEAL_LENGTH, type AriseHost, type RevealStaging } from "./cinematics/arise";

interface EntityView extends ImpactState {
  id: number;
  bar: Graphics;
  barKey?: number;
  /** Tinted down by a boss entrance (restored when it ends). */
  dimmed?: boolean;
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

/** Named parts of a frame, timed under `?perf=1` (see scripts/perf.mjs). */
const SECTION_NAMES = ["background", "entities", "camera", "groundFx", "fx", "trails", "particles", "overlays"] as const;
/** True when the combatant carries a status of this kind (no closure, no allocation). */
function hasStatus(e: Combatant, kind: string): boolean {
  const s = e.statuses;
  for (let i = 0; i < s.length; i++) if (s[i]!.kind === kind) return true;
  return false;
}

/** A pooled ground decal: an ink splatter that soaks in and fades. */
interface Decal {
  sprite: Sprite;
  rx: number;
  ry: number;
  life: number;
  total: number;
  live: boolean;
}
const MAX_DECALS = 80;
const WAKE_ANGLE: [number, number] = [-Math.PI, 0];

const WORLD_W = ARENA.width;
const WORLD_D = ARENA.depth;
/** Figures are drawn larger than the simulation footprint so fighters dominate the frame. */
const FIGURE_SCALE = 1.62;
/** Chest height of a standard figure, in rig units (for effects on things without a view). */
const CHEST = 50;
const MAX_FX = 128;
/** Hostiles this close to the warrior (world units) are framed with it; the boss always is. */
const FRAME_RADIUS = 230;
const FRAME_PAD = 55;
/** The backdrop is painted this far past each canvas edge so shake never shows its border. */
const BLEED = 24;
/** A held body eases back to its live position over this long. */
const HOLD_RELEASE = 0.06;
/** Ascendant Fury: the arrival swing (real seconds), and how long each afterimage fades. */
const FURY_SWING = 0.16;
const FURY_GHOST_LIFE = 0.3;
const FURY_GOLD = 0xe9c97a;
const FURY_INK = 0x15141a;
/** How far the backdrop sinks toward FURY_DIM_COLOR during the flurry. */
const FURY_DIM = 0.45;
const FURY_DIM_COLOR = 0x23262c;
/** Camera follow speed (lambda) while the flurry's frame settles and holds. */
const FURY_SETTLE = 14;
/**
 * Where the flurry's running total sits, in canvas px: right of centre and high, the band the
 * interface leaves free between the army commands (left) and the army strip (right), below the
 * boss bar when there is one.
 */
const TALLY_SCREEN_X = 0.65;
const TALLY_SCREEN_Y = 84;

type FuryStepEvent = Extract<GameEvent, { type: "fury_step" }>;

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
  /** Ink splatters, as pooled sprites (no per-frame geometry). */
  private decalLayer = new Container();
  private readonly decalPool: Decal[] = [];
  private decalNext = 0;
  /** groundFx holds geometry from the last frame (cleared once when there is nothing to draw). */
  private groundDirty = false;
  private fxLive = 0;
  private fxDirty = false;
  private chevronsDrawn = false;
  private focusKey = -1;
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
  private orbs = new Map<number, { c: Container; core: Sprite; halo: Sprite; glint: Sprite; mote: Container; ring: Graphics; t: number; isBoss: boolean; color: number }>();
  /** Reused emit options for per-frame wakes and projectile trails (no allocation per frame). */
  private readonly trailEmit: EmitOptions = { x: 0, y: 0, count: 1, texture: Texture.EMPTY, color: 0xffffff, speed: [0, 0], life: [0, 0], scale: [0, 0], alpha: 1 };
  private readonly orbEmit: EmitOptions = { x: 0, y: 0, count: 1, texture: Texture.EMPTY, color: 0xffffff, speed: [6, 22], angle: [-Math.PI * 0.8, -Math.PI * 0.2], life: [0.6, 1.1], scale: [0.08, 0.2], alpha: 0.85 };
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
  /** Ascendant Fury: the arrival pose (seconds into it, combo swing) while the flurry runs. */
  private readonly fury = { on: false, t: 0, variant: 0, settled: false };
  private readonly furyGhosts = new FuryGhosts(this.entityLayer);
  /** The steady frame of the whole fight during the flurry (grows, never chases a blink). */
  private readonly furyBox: Box = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  private furyBoxSet = false;
  /** The current strike's lead while the flurry runs (-1 otherwise): only it shows a number. */
  private furyLead = -1;
  /** The lead's damage in the current event batch (the cut and the strike), shown as one number. */
  private furyLeadSum = 0;
  private furyLeadCrit = false;
  /** Backdrop dim during the flurry (0 to 1), eased in and out. */
  private furyDim = 0;
  /** The warrior's facing as last drawn (an afterimage keeps the stance he blinked out of). */
  private playerFacing: 1 | -1 = 1;
  private resizeObs: ResizeObserver | null = null;
  /** The BIND / ARISE sequence while it runs, and failed binds collapsing. */
  private arise: AriseCinematic | null = null;
  private readonly fails: FailedBind[] = [];
  /** A boss's entrance and deaths in progress; the field dim and the lasting phase tint. */
  private bossIntro: BossEntrance | null = null;
  private readonly bossDeaths: BossDeath[] = [];
  private dimOthers = 0;
  private bossTint = 0;
  private bossTintColor = 0xffffff;
  private letterboxTarget = 0;
  /** The warrior holds the raised-hand claim pose. */
  private claimHold = false;
  /** Real seconds of the current frame (the claim pose animates while the fight is paused). */
  private frameDt = 0;
  /** A cinematic's wash over the backdrop (night for an epic bind). */
  private cineTint = 0;
  private cineTintColor = 0xffffff;
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
  private readonly perf: PerfSamples | null = typeof window !== "undefined" ? ((window as unknown as { __ASCEND_PERF__?: PerfSamples }).__ASCEND_PERF__ ?? null) : null;
  private readonly secAcc = new Float64Array(SECTION_NAMES.length);
  private secT = 0;

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
    for (let i = 0; i < MAX_DECALS; i++) {
      const s = new Sprite(hardCircle());
      s.anchor.set(0.5);
      s.visible = false;
      this.decalLayer.addChild(s);
      this.decalPool.push({ sprite: s, rx: 0, ry: 0, life: 0, total: 1, live: false });
    }
    this.cameraLayer.addChild(this.decalLayer, this.groundFx, this.entityLayer, this.projectileLayer, this.orbLayer, this.trails.graphics, this.fxGraphics, this.particles.container, this.numbers.container, this.cinematicLayer);
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
    this.disposeArise();
    for (const f of this.fails) f.dispose();
    this.fails.length = 0;
    this.disposeBoss();
    this.endFury();
    this.particles.destroy();
    this.trails.destroy();
    this.numbers?.destroy();
    this.background?.destroy();
    this.background = null;
    this.fxPool = [];
    this.telegraphMarks.clear();
    destroyTextures();
    clearRigCache();
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
    for (const d of this.decalPool) {
      d.live = false;
      d.sprite.visible = false;
    }
    this.telegraphMarks.clear();
    this.lastTelegraphs.length = 0;
    this.impact.reset();
    this.stopLeft = 0;
    this.letterboxT = 0;
    this.skyDarken = 0;
    this.focusId = -1;
    this.disposeArise();
    for (const f of this.fails) f.dispose();
    this.fails.length = 0;
    this.disposeBoss();
    this.endFury();
    this.cineTint = 0;
    this.bossTint = 0;
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

  /**
   * Diagnostics for leak checks and the perf report: display objects in the stage tree, the
   * backdrop's texture bytes and paint resolution, shared rig parts, and whether a cinematic runs.
   */
  debugCounts(): { displayObjects: number; backdropBytes: number; backdropRes: number; rigParts: number; cinematic: boolean } {
    let n = 0;
    const walk = (c: Container): void => {
      n += 1;
      for (const ch of c.children) walk(ch);
    };
    if (this.app) walk(this.app.stage);
    return { displayObjects: n, backdropBytes: this.background?.textureBytes ?? 0, backdropRes: this.background?.resolution ?? 0, rigParts: rigCacheSize(), cinematic: this.cinematicActive };
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
    // Painted larger than the canvas so the zoomed camera stays sharp, under a texture cap.
    const res = backdropResolution(w, h, this.groundTop, BLEED, Math.min(2, window.devicePixelRatio || 1));
    this.background?.layout(w, h, this.groundTop, BLEED, res);
    if (this.background) this.trails.setGroundLuminance(this.background.groundLuminance);
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
    const perf = this.perf;
    if (perf) this.secT = performance.now();
    this.time += dt;
    this.frameDt = dt;
    this.impact.now += dt;
    const frozen = this.stopLeft > 0;
    if (frozen) this.stopLeft -= dt;
    // In a hit-stop the fight holds still; the camera keeps moving so the blow lands.
    const fxDt = frozen ? 0 : dt;
    const entDt = paused || frozen ? 0 : dt;
    this.background?.update(paused ? dt * 0.3 : dt);
    this.updateFury(world, entDt, dt);
    if (perf) this.sec(0);
    this.syncEntities(world, alpha, entDt, fxDt, paused ? 0 : dt);
    if (perf) this.sec(1);
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
    if (perf) this.sec(2);
    this.drawGroundFx(world, fxDt);
    if (perf) this.sec(3);
    this.updateFx(fxDt);
    if (perf) this.sec(4);
    this.trails.setSpeed(this.speed());
    this.trails.update(fxDt);
    if (perf) this.sec(5);
    this.particles.update(fxDt);
    this.numbers.setBounds(this.vis.minX, this.vis.maxX);
    this.numbers.setZoom(o.scale);
    if (this.numbers.tallyOn) {
      this.camera.unproject(this.width * TALLY_SCREEN_X, TALLY_SCREEN_Y, this.pt);
      this.numbers.placeTally(this.pt.x, this.pt.y);
    }
    this.numbers.update(dt);
    if (perf) this.sec(6);
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
    if (perf) this.sec(7);
    if (perf) {
      const t0 = performance.now();
      app.render();
      const d = performance.now() - t0;
      perf.draw.push(d);
      const s = perf.sections;
      if (s) {
        for (let i = 0; i < SECTION_NAMES.length; i++) {
          const name = SECTION_NAMES[i]!;
          (s[name] ??= []).push(this.secAcc[i]!);
          this.secAcc[i] = 0;
        }
      }
    } else app.render();
  }

  /** Perf only: charge the time since the last mark to section `i`. */
  private sec(i: number): void {
    const now = performance.now();
    this.secAcc[i] = this.secAcc[i]! + now - this.secT;
    this.secT = now;
  }

  /**
   * Framing: the box around the warrior and every hostile within 260 world units (the boss
   * always), padded, biased toward the warrior. The camera follows it with damping.
   */
  private frameCamera(world: World, alpha: number): void {
    if (world.ultimate.active || this.fury.on) {
      this.frameFury(world);
      return;
    }
    this.furyBoxSet = false;
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
      if (hasStatus(e, "submerged")) continue;
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
      const intro = this.bossIntro && this.bossIntro.bossId === e.id ? this.bossIntro : null;
      if (intro) {
        // The boss's entrance stages its rig (rise, descent, walk-out) over the normal pose.
        rig.animate(intro.poseState, this.time, 0, e.seed, e.facing, intro.poseState === "move", 0.6, 0, this.frameDt, 0);
      } else if (this.claimHold && e.id === player.id && !e.dead) {
        // BIND: the warrior raises a hand to take the essence (the fight itself is paused).
        rig.animate("cast", 0.5, 1, e.seed, e.facing, false, 0, 0, this.frameDt, 0);
      } else if (this.fury.on && e.id === player.id && !e.dead) {
        // Ascendant Fury: the committed cut he arrived with, held through its follow-through.
        // After the return blink he stands settled in guard until the cast lets him go.
        if (this.fury.settled) rig.animate("idle", 0, 0, e.seed, e.facing, false, 0, 0, dt, 0);
        else rig.animate("attack", this.fury.t, FURY_SWING, e.seed, e.facing, false, 0, 0, dt, this.fury.variant);
      } else if (!held) rig.animate(e.state, e.stateTime, e.stateDuration, e.seed, e.facing, moving, speedFrac, e.deathTime, dt, variant);
      if (e.id === player.id) this.playerFacing = e.facing;
      rig.setHitFlash(e.hitFlash);
      // Time-based impact flash: full white, a light tint, or nothing (FlashState decides).
      rig.setWhite(v.flash.step(realDt > 0 ? realDt : this.frameDt));
      if (e.summon?.temporary) rig.root.alpha = Math.min(rig.root.alpha, 0.72);
      const submerged = hasStatus(e, "submerged");
      if (submerged) {
        // Sunk: only a dark wake and a pale ripple show where it glides.
        rig.root.alpha = 0.12;
        if (!this.reduced && fxDt > 0 && Math.random() < 0.3) {
          const w = this.trailEmit;
          w.x = sx + (Math.random() - 0.5) * 30;
          w.y = sy;
          w.texture = softCircle();
          w.color = 0x8fc9c4;
          w.speed[0] = 5;
          w.speed[1] = 20;
          w.life[0] = 0.3;
          w.life[1] = 0.6;
          w.scale[0] = 0.2;
          w.scale[1] = 0.4;
          w.alpha = 0.6;
          w.angle = WAKE_ANGLE;
          this.particles.emit(w);
        }
      }
      rig.shadow.position.set(sx + (v.slide + rig.deathShiftX) * ds, sy + 1);
      rig.shadow.scale.set(ds * rig.poolScale, ds * 0.9 * rig.poolScale);
      rig.shadow.zIndex = -1000 + y;
      if (intro) {
        intro.setPlace(sx, sy, ds, e.facing, rig.top);
        intro.present(rig);
      } else if (this.dimOthers > 0.005) rig.root.tint = mix(0xffffff, 0x000000, this.dimOthers);
      else if (this.bossIntro === null && v.dimmed) rig.root.tint = 0xffffff;
      v.dimmed = this.dimOthers > 0.005 && !intro;
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
      if (e.id === player.id) {
        // The warrior's box: damage numbers keep out of it.
        const hw = v.rig.top * 0.2 * ds;
        const bx = sx + v.slide * ds;
        this.numbers.setAvoid(bx - hw, sy - v.rig.top * ds, bx + hw, sy);
      }
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
    // The white impact copies of this kind are prepared now, not on the first blow.
    rig.prewarmWhite();
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
      flash: new FlashState(),
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
    if (!f || f.dead || hasStatus(f, "submerged")) {
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
    g.position.set(cx, cy);
    // Redraw only when the box or the fade changes (the ticks just follow the target otherwise).
    const key = Math.round(hw * 2) * 1e6 + Math.round(hh * 2) * 1e2 + Math.round(k * 20);
    if (key === this.focusKey) return;
    this.focusKey = key;
    g.clear();
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
      if (e.dead || e.faction !== "enemy" || hasStatus(e, "submerged")) continue;
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
    if (e.dead || e.kind === "boss" || (!hurt && !flagged) || hasStatus(e, "submerged")) {
      bar.visible = false;
      return;
    }
    bar.visible = true;
    const top = sy - (v.rig.top + 12) * ds;
    bar.position.set(sx + v.slide * ds, top);
    const w = Math.round((e.kind === "player" ? 40 : e.kind === "summon" ? 30 : 28) * this.unit() * 1.6);
    const frac = clamp(e.hp / e.stats.maxHp, 0, 1);
    const sf = e.shield > 0 ? clamp(e.shield / e.stats.maxHp, 0, 1) : 0;
    const marked = hasStatus(e, "mark");
    // A numeric key (no string per entity per frame): redraw only when what the bar shows changes.
    const key = w * 1e7 + Math.round(frac * 60) * 1e5 + Math.round(sf * 30) * 1e3 + (e.enemy?.elite ? 100 : 0) + (e.enemy?.eligible ? 10 : 0) + (marked ? 4 : 0) + (hurt ? 1 : 0);
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
        const w = this.trailEmit;
        w.x = c.x;
        w.y = c.y;
        w.texture = softCircle();
        w.color = p.kind === "ember" ? 0xd9823f : 0xa9d0e6;
        w.speed[0] = 2;
        w.speed[1] = 10;
        w.life[0] = 0.2;
        w.life[1] = 0.4;
        w.scale[0] = 0.15;
        w.scale[1] = 0.3;
        w.alpha = 0.7;
        w.angle = undefined;
        this.particles.emit(w);
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
        // A hovering mote in the shadow's rarity colour, a glint on the ground under it, and for
        // a boss's essence a larger mote inside a tilted ring that turns.
        const color = RARITY_COLOR[summonDef(o.summonId).rarity] ?? 0xf0e6d0;
        const c = new Container();
        const glint = new Sprite(softCircle());
        glint.anchor.set(0.5);
        glint.tint = color;
        glint.blendMode = "add";
        const mote = new Container();
        const halo = new Sprite(softCircle());
        halo.anchor.set(0.5);
        halo.tint = color;
        halo.blendMode = "add";
        const core = new Sprite(hardCircle());
        core.anchor.set(0.5);
        core.tint = lighten(color, 0.75);
        core.blendMode = "add";
        const tilt = new Container();
        tilt.scale.set(1, 0.32);
        const ringG = new Graphics();
        if (o.isBoss) {
          const r = 30;
          ringG.circle(0, 0, r).stroke({ width: 2, color: 0xe9c56f, alpha: 0.9 });
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            ringG.moveTo(Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86).lineTo(Math.cos(a) * r * 1.16, Math.sin(a) * r * 1.16).stroke({ width: 2, color: 0xfff1c9, alpha: 0.9 });
          }
        }
        tilt.addChild(ringG);
        tilt.visible = o.isBoss;
        mote.addChild(halo, tilt, core);
        c.addChild(glint, mote);
        this.orbLayer.addChild(c);
        v = { c, core, halo, glint, mote, ring: ringG, t: Math.random() * 6, isBoss: o.isBoss, color };
        this.orbs.set(o.id, v);
      }
      v.t += dt;
      const u = this.unit();
      const ds = this.depthScale(o.pos.y);
      const sx = this.sx(o.pos.x);
      const ground = this.sy(o.pos.y);
      // A slow vertical bob above its ground glint.
      const bob = Math.sin(v.t * 1.7) * 4 * u * ds;
      const lift = 30 * u * FIGURE_SCALE * ds;
      v.c.position.set(sx, ground);
      v.mote.position.set(0, -lift + bob);
      const frac = o.remaining / o.total;
      const big = v.isBoss ? 1.5 : 1;
      const pulse = 1 + Math.sin(v.t * 3.4) * 0.07;
      v.halo.scale.set(0.62 * big * pulse * (0.65 + frac * 0.35) * ds);
      v.halo.alpha = 0.75;
      v.core.scale.set(0.2 * big * ds);
      v.glint.scale.set(0.9 * big * ds * (1 - bob / (40 * u)), 0.22 * big * ds);
      v.glint.alpha = 0.32 + 0.12 * Math.sin(v.t * 1.7 + 1.2);
      if (v.isBoss) {
        v.ring.rotation += dt * 0.9;
        v.ring.scale.set(ds * u * 1.6);
        v.ring.alpha = 0.5 + frac * 0.5;
      }
      if (!this.reduced && Math.random() < dt * (v.isBoss ? 14 : 8)) {
        const e = this.orbEmit;
        e.x = sx;
        e.y = ground - lift + bob;
        e.color = v.color;
        e.texture = softCircle();
        this.particles.emit(e);
      }
    }
    for (const [id, v] of this.orbs) {
      if (!seen.has(id)) {
        v.c.destroy({ children: true });
        this.orbs.delete(id);
      }
    }
  }

  /** Ink splatters left by the fallen. They soak into the ground and fade. Pooled and capped. */
  private splatter(x: number, y: number, big: boolean, color = 0x14110d): void {
    const u = this.unit();
    const n = big ? 16 : this.reduced ? 4 : 8;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const dist = Math.random() * (big ? 70 : 26) * u;
      const r = (2 + Math.random() * (big ? 12 : 7)) * u;
      // The ring of decals is reused oldest-first.
      const d = this.decalPool[this.decalNext]!;
      this.decalNext = (this.decalNext + 1) % MAX_DECALS;
      d.live = true;
      d.rx = r;
      d.ry = r * 0.45;
      d.life = d.total = 2.4;
      d.sprite.tint = color;
      d.sprite.position.set(x + Math.cos(a) * dist, y + Math.sin(a) * dist * 0.4);
      d.sprite.visible = true;
    }
  }

  private updateDecals(dt: number): void {
    // hardCircle is 32px across with a 1px margin: radius 15.
    const inv = 1 / 15;
    for (const d of this.decalPool) {
      if (!d.live) continue;
      d.life -= dt;
      if (d.life <= 0) {
        d.live = false;
        d.sprite.visible = false;
        continue;
      }
      const k = d.life / d.total;
      const grow = 1 + (1 - k) * 0.3;
      d.sprite.scale.set(d.rx * grow * inv, d.ry * grow * inv);
      d.sprite.alpha = 0.55 * Math.min(1, k * 1.6);
    }
  }

  private drawGroundFx(world: World, dt: number): void {
    this.updateDecals(dt);
    const g = this.groundFx;
    // Geometry is rebuilt only while there is something to draw; an empty frame clears it once.
    if (!this.groundNeeded(world)) {
      if (this.groundDirty) {
        g.clear();
        this.groundDirty = false;
      }
      return;
    }
    g.clear();
    this.groundDirty = true;
    const u = this.unit();
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

  /** Whether any telegraph, threat rim, banner aura, hazard or resolving flash needs drawing. */
  private groundNeeded(world: World): boolean {
    if (world.telegraphs.length > 0 || world.hazards.length > 0 || this.lastTelegraphs.length > 0) return true;
    const pid = world.player.id;
    for (const e of world.entities.values()) {
      if (e.dead) continue;
      if (e.faction === "enemy" && e.state === "windup" && e.pendingTargetId === pid) return true;
      if (e.enemy?.archetype === "bannerman" || (e.kind === "summon" && e.summon?.role === "support")) return true;
    }
    return false;
  }

  /** Off-screen hostiles: a small chevron at the edge, crimson when it is winding up at the warrior. */
  private drawChevrons(world: World): void {
    const g = this.chevrons;
    if (this.chevronsDrawn) g.clear();
    this.chevronsDrawn = false;
    const w = this.width;
    const h = this.height - this.camera.insetBottom;
    const player = world.player;
    for (const e of world.entities.values()) {
      if (e.dead || e.faction !== "enemy") continue;
      if (hasStatus(e, "submerged")) continue;
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
      this.chevronsDrawn = true;
    }
  }

  private drawLetterbox(dt: number): void {
    const g = this.letterbox;
    const on = this.letterboxT > 0;
    if (on) this.letterboxT -= dt;
    const target = this.reduced ? 0 : Math.max(on ? 20 : 0, this.letterboxTarget);
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
    let tint = this.skyDarken > 0.01 ? mix(0xffffff, this.skyColor, this.skyDarken) : 0xffffff;
    if (this.bossTint > 0) tint = mix(tint, this.bossTintColor, this.bossTint);
    if (this.cineTint > 0.005) tint = mix(tint, this.cineTintColor, this.cineTint);
    if (this.furyDim > 0) tint = mix(tint, FURY_DIM_COLOR, this.furyDim);
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
    this.fxLive += 1;
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
    if (this.fxLive <= 0) {
      if (this.fxDirty) {
        g.clear();
        this.fxDirty = false;
      }
      return;
    }
    g.clear();
    this.fxDirty = true;
    let live = 0;
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
      live += 1;
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
          // Soft tapered layers (wide and faint, then the body, then a bright core along the
          // leading edge) and two fading echoes behind it along its path: a blade of air, not a
          // flat disc.
          const alpha = 1 - k * k;
          const a0 = f.facing === 1 ? -Math.PI * 0.42 : Math.PI * 0.58;
          const a1 = a0 + Math.PI * 0.84;
          for (let echo = 2; echo >= 0; echo--) {
            const ee = easeOutCubic(Math.max(0, k - echo * 0.09));
            const cx = lerp(f.x, f.x2, ee);
            const r = f.r1 * (0.6 + 0.6 * ee);
            const ea = alpha * (echo === 0 ? 1 : echo === 1 ? 0.35 : 0.15);
            const col = age < 0.035 && echo === 0 ? 0xffffff : f.color;
            this.crescent(g, cx, f.y, r * 1.04, a0, a1, 0.3, col, ea * 0.18);
            this.crescent(g, cx, f.y, r, a0 + 0.05, a1 - 0.05, 0.16, col, ea * 0.6);
            if (echo === 0) this.crescent(g, cx, f.y, r * 0.995, a0 + 0.14, a1 - 0.14, 0.05, 0xffffff, ea * 0.95);
          }
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
    // Delayed effects still waiting count as live too.
    for (const f of this.fxPool) if (f.live && f.delay > 0) live += 1;
    this.fxLive = live;
  }

  /** A crescent tapered to points at both tips: thickness `th` (fraction of r) at its middle. */
  private crescent(g: Graphics, cx: number, cy: number, r: number, a0: number, a1: number, th: number, color: number, alpha: number): void {
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    for (let i = n - 1; i >= 1; i--) {
      const t = i / n;
      const a = a0 + (a1 - a0) * t;
      const rr = r * (1 - th * Math.sin(t * Math.PI));
      g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.closePath().fill({ color, alpha });
  }

  handleEvents(events: GameEvent[]): void {
    const world = this.world;
    if (!world) return;
    const u = this.unit();
    for (const e of events) {
      switch (e.type) {
        case "attack_swing": {
          this.impact.onSwing(e.id, e.cut === true);
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
          if (this.furyLead >= 0 && e.sourceId === world.player.id && e.faction === "enemy") {
            // The flurry folds its damage into one running total; only the lead shows its own.
            this.numbers.tallyAdd(e.amount, FURY_GOLD);
            // The lead takes the sword cut and the strike in the same moment: one number, their sum.
            if (e.targetId === this.furyLead && e.amount > 0) {
              this.furyLeadSum += e.amount;
              this.furyLeadCrit ||= e.crit;
            }
            break;
          }
          if (e.amount > 0 && target) {
            this.chest(target, this.pt);
            const taken = e.targetKind === "player";
            const col = taken ? 0xcc3f4b : e.crit ? 0xdab86c : e.element === "physical" ? 0xf3f0e9 : lighten(elementColor(e.element), 0.45);
            // Beside the target, on the side away from the attacker, never over the warrior.
            const src = world.entities.get(e.sourceId);
            const dir = src ? (target.pos.x >= src.pos.x ? 1 : -1) : target.facing === 1 ? -1 : 1;
            const tv = this.views.get(target.id);
            const halfW = (tv ? tv.rig.top * 0.2 : 16) * this.figureScale(target.pos.y);
            this.numbers.hit(this.pt.x, this.pt.y - 6, halfW, dir, fmtNum(e.amount), col, taken ? "taken" : e.crit ? "crit" : "normal", !taken);
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
            // The death sequence takes over the body: it owns a copy of the rig from here on.
            const v = this.views.get(e.id);
            if (v) {
              this.bossDeaths.push(new BossDeath(this.bossHost, e.defId, v.drawX + v.slide * this.figureScale(e.pos.y), v.drawY, this.figureScale(e.pos.y), world.entities.get(e.id)?.facing ?? -1));
              v.rig.root.visible = false;
              v.rig.shadow.visible = false;
              if (v.trail) this.trails.release(v.trail);
            }
            if (this.bossIntro?.bossId === e.id) {
              this.bossIntro.dispose();
              this.bossIntro = null;
            }
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
        case "fury_step":
          this.furyStep(e);
          break;
        case "fury_end":
          this.furyEnd(e);
          break;
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
          this.bossIntro?.dispose();
          this.bossIntro = new BossEntrance(this.bossHost, e.id, e.defId);
          break;
        }
        case "tyrant_break": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y);
          this.numbers.spawn(sx, sy - 160 * u, `BREAK ×${e.count}`, 0xdab86c, "word");
          this.ringFx(sx, sy - 40 * u, 20 * u, 150 * u, 0.55, 0xe9c97a, 5, 0.55);
          this.ringFx(sx, sy - 40 * u, 10 * u, 95 * u, 0.4, 0xfff1c9, 3, 0.55);
          this.camera.punch(0.045);
          break;
        }
        case "perfect_dodge": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y);
          this.numbers.spawn(sx, sy - 130 * u, "Perfect", 0xdab86c, "word");
          this.ringFx(sx, sy, 90 * u, 8, 0.4, 0xe9c97a, 3, 0.42);
          this.camera.punch(0.045);
          this.goldAfterimage();
          this.flash(0xf0eadc, 0.12);
          break;
        }
        case "finisher": {
          const sx = this.sx(e.pos.x);
          const sy = this.sy(e.pos.y);
          this.ringFx(sx, sy, 10, (e.boss ? 260 : 120) * u, e.boss ? 1.1 : 0.6, 0xe9c97a, e.boss ? 6 : 3, 0.42);
          // A boss's finisher leaves the light to its death sequence (the inverted frame).
          if (!e.boss) this.flash(0xf0eadc, 0.16);
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
          // A 350ms stop, one white frame, a shock ring to full width, and the backdrop shifts 20%
          // toward the boss's glow for the rest of the fight.
          const b = world.entities.get(e.id);
          const spec = b ? enemySpec(b.defId) : null;
          const glow = spec ? (spec.glow ?? spec.eye) : 0xa9d0e6;
          if (!this.reduced) {
            this.impact.onAuthoredFreeze(PHASE.stop);
            this.freeze(PHASE.stop);
          }
          this.flashRect.tint = 0xffffff;
          this.flashAlpha = this.reduced ? 0.25 : 0.95;
          this.flashTime = this.flashTotal = 1 / 60;
          this.camera.punch(0.03);
          this.bossTint = PHASE.tint;
          this.bossTintColor = glow;
          if (b) {
            const sx = this.sx(b.pos.x);
            const sy = this.sy(b.pos.y);
            this.ringFx(sx, sy, 20, this.width * 1.1, 0.75, lighten(glow, 0.3), 6, 0.42);
            this.particles.emit({ x: sx, y: sy - 60 * u, count: 40, texture: shard(), color: glow, speed: [100, 400], life: [0.5, 1.2], scale: [0.3, 0.9], endScale: 0, gravity: 200, spin: 10 });
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
    if (this.furyLeadSum > 0) {
      const lead = world.entities.get(this.furyLead);
      if (lead) {
        this.chest(lead, this.pt);
        const lv = this.views.get(lead.id);
        const halfW = (lv ? lv.rig.top * 0.2 : 16) * this.figureScale(lead.pos.y);
        const dir = lead.pos.x >= world.player.pos.x ? 1 : -1;
        this.numbers.hit(this.pt.x, this.pt.y - 6, halfW, dir, fmtNum(this.furyLeadSum), this.furyLeadCrit ? 0xdab86c : 0xf3f0e9, this.furyLeadCrit ? "crit" : "normal", true);
      }
      this.furyLeadSum = 0;
      this.furyLeadCrit = false;
    }
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
      case "ascendant_fury":
        // The flurry's look is driven by its fury_step events (see furyStep); each strike keeps
        // the bars in.
        this.letterboxT = 1.9;
        break;
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

  /** A failed BIND: the pool opens under the essence and collapses inward with a dry crack (0.5s). */
  playExtractionFail(pos: { x: number; y: number }): void {
    const u = this.unit();
    const sx = this.sx(pos.x);
    const sy = this.sy(pos.y);
    const r = 34 * u * FIGURE_SCALE * this.depthScale(pos.y);
    this.fails.push(new FailedBind(this.cinematicLayer, sx, sy, r, () => this.controller.ariseCue("fail", "common", "common"), this.particles, this.reduced));
    this.numbers.spawn(sx, sy - 70 * u, "Refused", 0xd9cdb2, "label");
    this.camera.shake(0.12);
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
  // BIND / ARISE (cinematics/arise.ts). The sequence lives in the camera layer above the fight;
  // the renderer only hosts it: it hands over the camera, the particles, the warrior's hand and
  // the backdrop tint, and passes cues and the naming beat to the controller.
  // ---------------------------------------------------------------------

  /** Legacy entry point: a new shadow, staged by its rarity. */
  playSummonCinematic(summonId: string, pos: { x: number; y: number }, first: boolean): void {
    this.playArise({ summonId, pos, first, duplicate: false });
  }

  /**
   * Start a reveal. Returns the staging chosen and its length to the naming beat (seconds), or
   * null when there is no scene to stage it in.
   */
  playArise(o: { summonId: string; pos: { x: number; y: number }; first: boolean; duplicate: boolean; owned?: boolean; quickReveals?: boolean; boss?: boolean }): { staging: RevealStaging; length: number } | null {
    this.disposeArise();
    if (!this.app || !this.world || this.width <= 0) return null;
    const def = summonDef(o.summonId);
    const rarity = def.rarity;
    const boss = o.boss ?? def.role === "sovereign";
    const orbY = this.sy(o.pos.y) - 28 * this.unit() * FIGURE_SCALE * this.depthScale(o.pos.y);
    this.arise = new AriseCinematic(this.ariseHost, {
      summonId: o.summonId,
      rarity,
      first: o.first,
      duplicate: o.duplicate,
      owned: o.owned,
      quickReveals: o.quickReveals,
      boss,
      orbX: this.sx(o.pos.x),
      orbY,
      reduced: this.reduced,
    });
    return { staging: this.arise.staging, length: this.reduced ? REDUCED_FADE : REVEAL_LENGTH[this.arise.staging] };
  }

  /**
   * A tap on the reveal: skip to the naming beat (refused in the first 0.4s). Returns true when
   * the reveal is now at or past its naming beat (or there is none), so the name may show.
   */
  skipCinematic(): boolean {
    const a = this.arise;
    if (!a || a.done) return true;
    a.skip();
    return a.tl.t >= REVEAL_LENGTH[a.staging] || this.reduced;
  }

  get cinematicActive(): boolean {
    return this.arise !== null;
  }

  /** The reveal was closed: the figure fades out and the sequence disposes itself. */
  endCinematic(): void {
    this.arise?.end();
  }

  private disposeArise(): void {
    this.arise?.dispose();
    this.arise = null;
    this.claimHold = false;
  }

  private updateCinematic(dt: number): void {
    this.updateBoss(dt);
    this.updateGhost(dt);
    this.furyGhosts.update(dt);
    const a = this.arise;
    if (a) {
      a.update(dt);
      if (a.done) this.arise = null;
    }
    for (let i = this.fails.length - 1; i >= 0; i--) {
      const f = this.fails[i]!;
      f.update(dt);
      if (f.done) this.fails.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------------
  // Ascendant Fury: the blink-strike flurry
  // ---------------------------------------------------------------------

  /**
   * One blink of the flurry. The warrior is already at `to` in the simulation (moved before the
   * frame's positions were recorded, so he is never drawn in between): his view snaps there, an
   * ink afterimage with a gold rim stays at `from`, a thin streak joins the two, and a crossing cut
   * runs through the lead target along his travel, alternating its angle. Everyone else struck by
   * the same blow gets a lighter gold cut. The seventh is the heavy beat.
   */
  private furyStep(e: FuryStepEvent): void {
    const world = this.world;
    if (!world) return;
    const u = this.unit();
    const reduced = this.reduced;
    const first = !this.fury.on;
    const travel: 1 | -1 = e.to.x > e.from.x + 0.5 ? 1 : e.to.x < e.from.x - 0.5 ? -1 : e.facing;

    this.furyTravel(e.from, e.to, first ? "first" : "strike", !reduced || e.index % 2 === 1);
    this.fury.on = true;
    this.fury.t = 0;
    this.fury.settled = false;
    this.furyLead = e.targetId;
    this.impact.whiteOnly = e.targetId;
    // Forehand and rising backhand alternate; the seventh is the overhead.
    this.fury.variant = e.final ? 2 : (e.index - 1) % 2;
    this.impact.kickScale = 0;
    this.letterboxT = 1.9;

    // The cut through the lead target, along the travel, its angle alternating.
    const target = world.entities.get(e.targetId);
    const tv = target ? this.views.get(target.id) : undefined;
    if (target) this.chest(target, this.pt);
    else {
      this.pt.x = this.sx(e.targetPos.x);
      this.pt.y = this.sy(e.targetPos.y) - CHEST * this.figureScale(e.targetPos.y);
    }
    const cx = this.pt.x;
    const cy = this.pt.y;
    const height = (tv ? tv.rig.top : CHEST / 0.62) * this.figureScale(e.targetPos.y);
    const half = height * (e.final ? 0.85 : 0.62);
    const tilt = (e.index % 2 === 1 ? 0.62 : -0.5) * (e.final ? 1.15 : 1);
    const dx = Math.cos(tilt) * travel;
    const dy = Math.sin(tilt);
    const w = e.final ? 9 : 5;
    this.lineFx(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half, e.final ? 0.34 : 0.22, FURY_GOLD, w * u + 1.5);
    this.lineFx(cx - dx * half * 0.9, cy - dy * half * 0.9, cx + dx * half * 0.9, cy + dy * half * 0.9, e.final ? 0.2 : 0.12, 0xffffff, (w * 0.35) * u + 0.8);
    this.slashFx(cx, cy, travel, half * 0.78, e.final ? 0.3 : 0.2, FURY_GOLD, (e.final ? 6 : 3.5) * u + 1, Math.PI * (e.final ? 1.1 : 0.75));
    const sparkAng = Math.atan2(dy, dx);
    this.particles.emit({ x: cx, y: cy, count: reduced ? 4 : e.final ? 22 : 10, texture: spark(), color: FURY_GOLD, speed: [120, e.final ? 420 : 300], angle: [sparkAng - 0.5, sparkAng + 0.5], life: [0.15, 0.35], scale: [0.4, 1.0], endScale: 0.1, alignToVelocity: true });

    // Everyone else the blow found: a lighter gold cut so their damage still reads.
    for (const o of world.entities.values()) {
      if (o.faction !== "enemy" || o.dead || o.id === e.targetId || hasStatus(o, "submerged")) continue;
      this.chest(o, this.pt);
      const ov = this.views.get(o.id);
      const oh = (ov ? ov.rig.top : CHEST / 0.62) * this.figureScale(o.pos.y) * 0.38;
      const a = (Math.random() - 0.5) * 1.6;
      const ax = Math.cos(a) * oh;
      const ay = Math.sin(a) * oh;
      this.lineFx(this.pt.x - ax, this.pt.y - ay, this.pt.x + ax, this.pt.y + ay, 0.18, FURY_GOLD, 2 * u + 1);
      if (!reduced) this.particles.emit({ x: this.pt.x, y: this.pt.y, count: 3, texture: spark(), color: FURY_GOLD, speed: [80, 200], life: [0.12, 0.25], scale: [0.3, 0.7], endScale: 0.1, alignToVelocity: true });
    }

    if (e.final) {
      // The heavy beat: a wider cut, a ring from the lead's feet, trauma and a longer stop.
      const gx = this.sx(e.targetPos.x);
      const gy = this.sy(e.targetPos.y);
      this.ringFx(gx, gy, 10, 220 * u, 0.7, FURY_GOLD, 5, 0.42);
      this.ringFx(gx, gy, 6, 120 * u, 0.45, 0xfff1c9, 3, 0.42, 0.04);
      this.starFlash(cx, cy, 1.3, 0xfff1c9);
      this.camera.punch(0.06);
      this.camera.shake(0.6);
      this.impact.stop(0.07, "fury-final", 0);
      if (!reduced) this.flash(0xffd36b, 0.3, 0.3);
    } else {
      this.camera.punch(first ? 0.05 : 0.02);
      this.impact.stop(0.033, "fury", 0.1);
    }
  }

  /**
   * One blink's travel: the afterimage he left (`ghost`; posed as he stood before the first blink,
   * else in the follow-through of his last cut), the ink-and-gold streak from there to where he
   * is now, and his view snapped to the new place so no hold, slide or ribbon draws him between.
   */
  private furyTravel(from: { x: number; y: number }, to: { x: number; y: number }, pose: "first" | "strike", ghost: boolean): void {
    const world = this.world;
    if (!world) return;
    const p = world.player;
    const v = this.views.get(p.id);
    const u = this.unit();
    const reduced = this.reduced;
    const fromFs = this.figureScale(from.y);
    const toFs = this.figureScale(to.y);
    const fx = this.sx(from.x);
    const fy = this.sy(from.y);
    const tx = this.sx(to.x);
    const ty = this.sy(to.y);
    if (ghost) {
      const first = pose === "first";
      this.furyGhosts.spawn(world.loadout.weaponPath, fx, fy, fromFs, from.y, this.playerFacing, p.seed, first ? p.state : "attack", first ? p.stateTime : FURY_SWING, first ? p.stateDuration : FURY_SWING, this.fury.variant, FURY_GHOST_LIFE, !reduced);
    }
    const fc = fy - CHEST * fromFs;
    const tc = ty - CHEST * toFs;
    this.lineFx(fx, fc, tx, tc, 0.16, FURY_INK, 5 * u + 2);
    this.lineFx(fx, fc, tx, tc, 0.13, FURY_GOLD, 1.2 * u + 0.8);
    if (!reduced) {
      for (let i = 0; i < 2; i++) {
        const k = i === 0 ? 0.55 : 1.45;
        this.lineFx(fx, fy - CHEST * fromFs * k, tx, ty - CHEST * toFs * k, 0.12, 0xf0eadc, 1, 0.012 * (i + 1));
      }
    }
    if (v) {
      v.holdLeft = 0;
      v.holdFresh = false;
      v.releaseLeft = 0;
      v.slide = 0;
      v.squash = 0;
      v.drawX = tx;
      v.drawY = ty;
      if (v.trail) {
        this.trails.release(v.trail);
        v.trail = null;
      }
      v.rig.snap();
    }
  }

  /** Advance the arrival pose; the flurry's presentation ends with the warrior's cast. */
  private updateFury(world: World, dt: number, realDt: number): void {
    const p = world.player;
    const running = world.ultimate.active || (p.state === "cast" && p.pendingAbility === "ascendant_fury" && !p.dead);
    if (this.fury.on) {
      if (running) this.fury.t += dt;
      else {
        this.fury.on = false;
        this.impact.kickScale = 1;
      }
    }
    if (!world.ultimate.active && this.furyLead >= 0) {
      this.furyLead = -1;
      this.impact.whiteOnly = -1;
    }
    // The backdrop sinks a little while the flurry runs, so ink and gold read against it.
    this.furyDim = damp(this.furyDim, world.ultimate.active ? (this.reduced ? FURY_DIM * 0.5 : FURY_DIM) : 0, 10, realDt);
    if (this.furyDim < 0.004) this.furyDim = 0;
    if (!this.fury.on && !world.ultimate.active && this.furyGhosts.count > 0 && !this.furyGhosts.anyLive) this.furyGhosts.release();
  }

  /**
   * The ultimate ended. Early (the field was cleared before the seventh cut): a short closing
   * beat where he stands, the bars release and the total closes. After the seventh, its own beat
   * already played.
   */
  private furyEnd(e: Extract<GameEvent, { type: "fury_end" }>): void {
    const world = this.world;
    this.furyLead = -1;
    this.impact.whiteOnly = -1;
    this.impact.kickScale = 1;
    this.camera.boost = 0;
    this.letterboxT = 0;
    if (!world) return;
    // The return blink: from his last cut back to where he began, arriving settled.
    const moved = Math.abs(e.to.x - e.from.x) + Math.abs(e.to.y - e.from.y) > 1;
    if (moved) this.furyTravel(e.from, e.to, this.fury.on ? "strike" : "first", true);
    else this.views.get(world.player.id)?.rig.snap();
    this.fury.on = true;
    this.fury.settled = true;
    this.fury.t = 0;
    // The closing beat plays around him where he stands now: a ring, a glint, the total's pop.
    this.numbers.tallyClose();
    const u = this.unit();
    const sx = this.sx(e.to.x);
    const sy = this.sy(e.to.y);
    this.ringFx(sx, sy, 8, 120 * u, 0.5, FURY_GOLD, 3, 0.42);
    this.starFlash(sx, sy - CHEST * this.figureScale(e.to.y), 0.8, 0xfff1c9);
    this.camera.punch(0.03);
  }

  /** The flurry is cut short (new world, unmount): drop its pose, afterimages and total. */
  private endFury(): void {
    this.fury.on = false;
    this.fury.t = 0;
    this.furyBoxSet = false;
    this.furyLead = -1;
    this.fury.settled = false;
    this.furyDim = 0;
    this.impact.kickScale = 1;
    this.impact.whiteOnly = -1;
    this.camera.boost = 0;
    this.furyGhosts.release();
  }

  /**
   * During the flurry the camera holds the whole fight: the frame is set once, at the cast, around
   * the warrior and every foe on the field, and reached quickly (the 0.25s before the first blink),
   * centred rather than leaning toward the warrior. It then holds; it only widens if a blink would
   * take him out of it.
   */
  private frameFury(world: World): void {
    const p = world.player;
    const b = this.box;
    const f = this.furyBox;
    const pv = this.views.get(p.id);
    const px = this.sx(p.pos.x);
    const py = this.sy(p.pos.y);
    const ptop = py - (pv?.rig.top ?? 82) * this.figureScale(p.pos.y);
    if (!this.furyBoxSet) {
      f.minX = f.maxX = px;
      f.maxY = py;
      f.minY = ptop;
      for (const e of world.entities.values()) {
        if (e.faction !== "enemy" || e.dead || hasStatus(e, "submerged")) continue;
        // Foes still walking in from beyond the edge stay out of the frame.
        if (e.pos.x < ARENA.minX || e.pos.x > ARENA.maxX) continue;
        const ex = this.sx(e.pos.x);
        const ey = this.sy(e.pos.y);
        const et = (this.views.get(e.id)?.rig.top ?? 82) * this.figureScale(e.pos.y);
        if (ex < f.minX) f.minX = ex;
        if (ex > f.maxX) f.maxX = ex;
        if (ey > f.maxY) f.maxY = ey;
        if (ey - et < f.minY) f.minY = ey - et;
      }
      this.furyBoxSet = true;
    } else {
      f.minX = Math.min(f.minX, px);
      f.maxX = Math.max(f.maxX, px);
      f.minY = Math.min(f.minY, ptop);
      f.maxY = Math.max(f.maxY, py);
    }
    const pad = FRAME_PAD * this.unit();
    b.minX = f.minX - pad;
    b.maxX = f.maxX + pad;
    b.minY = f.minY - pad * 0.5;
    b.maxY = f.maxY + pad * 0.35;
    this.camera.boost = world.ultimate.active ? FURY_SETTLE : 0;
    this.camera.frame(b, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
  }

  /** Perfect dodge: a gold afterimage of the warrior where the blow would have landed. */
  private ghost: { rig: Rig; path: string; t: number } | null = null;

  private goldAfterimage(): void {
    const world = this.world;
    if (!world || this.reduced) return;
    const p = world.player;
    const v = this.views.get(p.id);
    if (!v) return;
    const path = world.loadout.weaponPath;
    if (!this.ghost || this.ghost.path !== path) {
      this.ghost?.rig.destroy();
      const rig = new Rig(playerSpec(path));
      rig.root.tint = 0xe9c56f;
      rig.root.blendMode = "add";
      this.entityLayer.addChild(rig.root);
      this.ghost = { rig, path, t: 1 };
    }
    const g = this.ghost;
    g.t = 0;
    g.rig.root.visible = true;
    g.rig.root.position.set(v.drawX, v.drawY);
    g.rig.root.scale.set(v.rig.root.scale.x);
    g.rig.root.zIndex = v.rig.root.zIndex - 0.5;
    g.rig.animate("dodge", 0, 0.3, p.seed, p.facing, false, 0, 0, 0);
  }

  private updateGhost(dt: number): void {
    const g = this.ghost;
    if (!g || g.t >= 1) return;
    g.t = Math.min(1, g.t + dt / 0.4);
    g.rig.root.alpha = 0.7 * (1 - easeOutCubic(g.t));
    g.rig.root.y -= dt * 12;
    if (g.t >= 1) g.rig.root.visible = false;
  }

  private disposeBoss(): void {
    this.ghost?.rig.destroy();
    this.ghost = null;
    this.bossIntro?.dispose();
    this.bossIntro = null;
    for (const d of this.bossDeaths) d.dispose();
    this.bossDeaths.length = 0;
    this.dimOthers = 0;
    this.letterboxTarget = 0;
    this.camera.hold.weight = 0;
  }

  private updateBoss(dt: number): void {
    const b = this.bossIntro;
    if (b) {
      b.update(dt);
      if (b.done) {
        this.bossIntro = null;
        this.dimOthers = 0;
      }
    }
    for (let i = this.bossDeaths.length - 1; i >= 0; i--) {
      const d = this.bossDeaths[i]!;
      d.update(dt);
      if (d.done) this.bossDeaths.splice(i, 1);
    }
  }

  private readonly bossHost: BossHost = {
    camera: this.camera,
    particles: this.particles,
    layer: this.cinematicLayer,
    isReduced: () => this.reduced,
    freeze: (seconds) => {
      if (this.reduced) return;
      this.impact.onAuthoredFreeze(seconds);
      this.freeze(seconds);
    },
    letterbox: (px) => {
      this.letterboxTarget = px;
    },
    dimOthers: (amount) => {
      this.dimOthers = amount;
    },
    ring: (x, y, r0, r1, life, color, width) => this.ringFx(x, y, r0, r1, life, color, width, 0.42),
    viewWidth: () => this.width,
    cue: (name) => this.controller.bossCue(name),
  };

  private readonly ariseHost: AriseHost = {
    camera: this.camera,
    particles: this.particles,
    layer: this.cinematicLayer,
    viewSize: (out) => {
      out.w = this.width;
      out.h = this.height;
      out.inset = this.camera.insetBottom;
    },
    normalFigureScale: () => this.figureScale(WORLD_D * 0.5),
    warriorHand: (out) => {
      const p = this.world?.player;
      const v = p ? this.views.get(p.id) : undefined;
      if (!p || !v || p.dead) return false;
      v.rig.handPoint(out);
      return true;
    },
    claimPose: (on) => {
      this.claimHold = on;
    },
    freeze: (seconds) => {
      if (this.reduced) return;
      this.impact.onAuthoredFreeze(seconds);
      this.freeze(seconds);
    },
    flash: (color, alpha, duration) => this.flash(color, alpha, duration),
    tintBackdrop: (color, amount) => {
      this.cineTintColor = color;
      this.cineTint = amount;
    },
    cue: (name, staging, rarity) => this.controller.ariseCue(name, staging, rarity),
    named: () => this.controller.revealNamed(),
  };
}

function pathColor(path: string): number {
  return path === "stormblade" ? 0xa8c4e6 : path === "infernal" ? 0xe0954f : path === "voidfang" ? 0xd95a66 : 0xf0eadc;
}
