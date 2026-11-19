import { Graphics, Sprite, type Container } from "pixi.js";
import { Piece, PiecePool, ShapeBank, q } from "./shapes";
import { arms, blackSun, chargeArc, chevrons, crack, crescent, dashes, diamond, disc, ellipseFill, ellipseLine, foam, glyphArc, glyphBolt, glyphRing, line, pane, paneGlint, paneLight, paneSheen, pip, rectFill, rod, rodArcs, sheet, sigil, tether, wave, wellRim } from "./marks";
import type { GameEvent } from "../../engine/events";
import type { Combatant } from "../../entities/types";
import type { MechanicStep, SovereignId, SovereignMechanic } from "../../data/sovereigns";
import { isSovereign } from "../../data/sovereigns";
import type { Vec2 } from "../../engine/math";
import type { Rig, RigSpec } from "../rigs/Rig";
import type { BodyMod, SigBody, SigHost } from "../signatures/host";
import type { SigKit } from "../signatures/kit";
import { shard, softCircle, spark } from "../textures";
import { easeInCubic, easeOutBack, easeOutCubic } from "../anim/ease";
import { lighten, mix } from "../colors";
import { isUltimate, sovLook, sovereignOf, ULTIMATE_NAME, type SovLook } from "./look";

/**
 * The Rift Sovereigns' mechanics on the field, staged from the simulation's `boss_mechanic` events
 * alone (a warning, the strike, its end), whether a Sovereign casts them at the warrior or its
 * shadow casts them for him. Visual only: it never touches the world.
 *
 * Readability rules (DESIGN.md, "How the Sovereigns look and sound"):
 *  - The threat is the simulation's own telegraph (crimson, true size). Every shape here is drawn
 *    under it, in the Sovereign's colour, and says what is coming and from where; none covers it.
 *  - A shadow's version is drawn in the army's slate and gold with the Sovereign's colour as the
 *    accent, and never in crimson: it is help, not a threat.
 *  - Full-screen light goes through the flash budget; a big strike may shake once, never steadily.
 *  - The quality tiers cut particles and secondary layers; reduced effects keeps every shape and
 *    drops the flashes, shakes, pushes and leaning bodies.
 *
 * Bodies the mechanics raise (the knight's images, the titan's rods, the queen's courtiers) are
 * dressed here: the renderer asks `dressDef` for the figure to draw them as, and rods are drawn as
 * rods (their rig hidden).
 */

type MechEvent = Extract<GameEvent, { type: "boss_mechanic" }>;

export interface SovLayers {
  /** Above the backdrop, under every ground mark (the eclipse's dark, the black sun). */
  readonly dark: Container;
  /** On the ground, under the telegraphs and the figures. */
  readonly ground: Container;
  /** Above the figures. */
  readonly fx: Container;
}

export interface SovHost {
  readonly sig: SigHost;
  kit(): SigKit;
  mod(id: number): BodyMod;
  entity(id: number): Combatant | undefined;
  readonly layers: SovLayers;
  furyOn(): boolean;
  /** The warrior's most recent ability (the art the knight echoes), or null. */
  lastArt(): string | null;
  /** Ask the signature focus to hold (0 lets go): figures fade and the army not in it dims. */
  focus(k: number, army: boolean, ids: readonly number[]): void;
  /** The backdrop sinks toward `color` by `level` (the eclipse); 0 restores it. */
  eclipse(level: number, color: number): void;
  playerSpec(): RigSpec;
  /** A word over the field (a shadow's ultimate named the first time). */
  label(text: string, x: number, y: number, color: number): void;
}

/** What a mechanic raised, as the renderer draws it. */
export type DressKind = "image" | "rod" | "courtier";

interface Dress {
  kind: DressKind;
  def: string;
  ally: boolean;
  sov: SovereignId;
}

interface Mech {
  key: string;
  id: number;
  sov: SovereignId;
  mech: SovereignMechanic;
  index: number;
  ally: boolean;
  look: SovLook;
  step: MechanicStep;
  /** World seconds since this step began, and the step's own length. */
  t: number;
  dur: number;
  warn: number;
  /** World seconds since the mechanic began. */
  age: number;
  /** The strike came (an end without one is a rod struck down, a guard broken early...). */
  struck: boolean;
  /** The end came before its time (a mirror shattered, a rod destroyed). */
  early: boolean;
  pos: Vec2;
  to: Vec2;
  radius: number;
  targets: number[];
  g: Graphics;
  gl: Graphics;
  f: Graphics;
  fl: Graphics;
  rig: Rig | null;
  seed: number;
  /** Real seconds since the last reflected flash (the guard), the last spark burst. */
  coolA: number;
  coolB: number;
  /** Seconds the outro runs after the end. */
  outro: number;
  /** A push-in this mechanic owns (released when it ends). */
  push: number;
  /** Bodies it raised (a rod, images, courtiers), apart from those it strikes or chains. */
  raised: number[];
  /** A later step's whole reach (a well's pull), apart from the shape's own radius. */
  reach: number;
  /** An end that came with its strike, held until the strike has played (`HOLD_STRIKE`). */
  endHeld: { pos: Vec2; countered: boolean } | null;
  /** The mirror lit by a flash it threw (dying away). */
  flash: number;
  /** The eclipse: her strike's mark is set (its second warning came; `to` is the mark). */
  marked: boolean;
  /** Its shapes, built once and moved (`shapes.ts`), by slot. */
  pieces: (Piece | undefined)[];
}

/** How long a strike plays before an end that came with it takes over (world seconds). */
const HOLD_STRIKE: Partial<Record<SovereignMechanic, number>> = { mirror_echo: 0.32, storm_rods: 0.35, storm_chain: 0.4, storm_tide: 0.6, void_eclipse: 0.35 };

/** Mechanics staged at once (more are dropped, oldest first). */
export const MAX_MECHS = 24;
/** Outros, world seconds. */
const OUTRO: Record<SovereignMechanic, number> = {
  mirror_guard: 0.45,
  mirror_echo: 0.4,
  mirror_split: 0.6,
  storm_rods: 0.6,
  storm_chain: 0.35,
  storm_tide: 1.1,
  void_well: 0.55,
  void_court: 0.5,
  void_eclipse: 0.9,
};
const ECLIPSE_INK = 0x07050c;
/** The eclipse's deepest dark (backdrop and the field's wash); reduced effects goes less deep, slower. */
export const ECLIPSE_MAX = 0.82;
const ECLIPSE_REDUCED = 0.6;

export class SovereignDirector {
  private readonly mechs: Mech[] = [];
  private readonly dressed = new Map<number, Dress>();
  /** My share of each body's drawn offset and alpha last frame (the signature stages own the rest). */
  private readonly myMods = new Map<number, { dx: number; dy: number; alpha: number; stretch: number }>();
  private readonly touched = new Set<number>();
  private readonly b: SigBody = { x: 0, y: 0, chestY: 0, height: 0, scale: 1, wx: 0, wy: 0, facing: 1, boss: false, ally: false, player: false, rig: null };
  private readonly b2: SigBody = { x: 0, y: 0, chestY: 0, height: 0, scale: 1, wx: 0, wy: 0, facing: 1, boss: false, ally: false, player: false, rig: null };
  private readonly pt = { x: 0, y: 0 };
  /** The eclipse's dark sheet and its black sun (shapes built once, moved and faded). */
  private readonly darkP = new Piece();
  private readonly sunP = new Piece();
  /** Shapes shared by every mechanic in the fight, and the pieces that show them. */
  private readonly bank = new ShapeBank();
  private readonly pool = new PiecePool();
  /** The frame being drawn (a piece not drawn in it is hidden). */
  private stamp = 0;
  /** My share of a body's modifiers, kept for reuse (nothing is made per frame). */
  private readonly modPool: { dx: number; dy: number; alpha: number; stretch: number }[] = [];
  /** The box `frameInto` widens. */
  private frameBox: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  /** The well whose pull bodies are leaning toward now, and its reach. */
  private leanM: Mech | null = null;
  private leanR = 0;
  private leanReach = 0;
  private dark = 0;
  private darkAlly = false;
  private now = 0;
  private shakeAt = -10;
  private readonly named = new Set<string>();
  private labelAt = -10;
  private labelStack = 0;
  /** Images already broken into glass (the strike that says so and the death may both come). */
  private readonly shattered = new Set<number>();
  private readonly focusIds: number[] = [];
  /** Diagnostics: mechanics staged, dropped, reflected flashes. */
  readonly counters = { mechs: 0, dropped: 0, reflects: 0, strikes: 0, together: 0 };

  constructor(private readonly host: SovHost) {
    host.layers.dark.addChild(this.darkP.g, this.sunP.g);
  }

  private get kit(): SigKit {
    return this.host.kit();
  }

  private get reduced(): boolean {
    return this.kit.profile.reduced;
  }

  // ------------------------------------------------------------------ the renderer asks

  /** The figure a raised body is drawn as (null: its own). */
  dressDef(id: number): string | null {
    return this.dressed.get(id)?.def ?? null;
  }

  dressKind(id: number): DressKind | null {
    return this.dressed.get(id)?.kind ?? null;
  }

  /** The eclipse's dark now (0 to 1). */
  get darkness(): number {
    return this.dark;
  }

  get live(): number {
    return this.mechs.length;
  }

  /** Diagnostics: shapes built for the fight, and pieces showing them. */
  get shapes(): { built: number; kept: number; pieces: number } {
    return { built: this.bank.built, kept: this.bank.size, pieces: this.pool.lent };
  }

  /** Any Sovereign staging on screen this frame. */
  get busy(): boolean {
    return this.mechs.length > 0 || this.dark > 0.01;
  }

  /**
   * Widen the camera's box (base px) to take in what a Sovereign's mechanic puts on the field away
   * from the fight: its charging rods, its well, its kneeling court. What is coming must be seen.
   */
  frameInto(box: { minX: number; minY: number; maxX: number; maxY: number }): void {
    const pr = this.host.sig.proj;
    this.frameBox = box;
    for (const m of this.mechs) {
      if (m.ally || m.step === "end") continue;
      if (m.mech === "storm_rods") this.take(pr.sx(m.pos.x), pr.sy(m.pos.y), 80 * pr.fs(m.pos.y));
      else if (m.mech === "void_well") {
        const r = m.radius * pr.unit();
        this.take(pr.sx(m.pos.x) - r, pr.sy(m.pos.y), 0);
        this.take(pr.sx(m.pos.x) + r, pr.sy(m.pos.y), 0);
      } else if (m.mech === "void_court" || m.mech === "mirror_split") {
        for (const id of m.raised) if (this.host.sig.body(id, this.b2)) this.take(this.b2.x, this.b2.y, this.b2.height);
      }
    }
    this.frameBox = null;
  }

  private take(x: number, y: number, top: number): void {
    const box = this.frameBox;
    if (!box) return;
    if (x < box.minX) box.minX = x;
    if (x > box.maxX) box.maxX = x;
    if (y > box.maxY) box.maxY = y;
    if (y - top < box.minY) box.minY = y - top;
  }

  /** A body it raised still stands (a courtier kneeling, an image fighting): it is not over. */
  private anyStanding(m: Mech): boolean {
    for (const id of m.raised) {
      const e = this.host.entity(id);
      if (e && !e.dead) return true;
    }
    return false;
  }

  /** Whether a body is part of a staged mechanic (the focus never dims it). */
  involves(id: number): boolean {
    for (const m of this.mechs) if (m.id === id || m.targets.includes(id)) return true;
    return false;
  }

  // ------------------------------------------------------------------ events

  handle(events: readonly GameEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case "boss_mechanic":
          this.onMechanic(e);
          break;
        case "death":
          this.onDeath(e.id, e.pos);
          break;
        default:
          break;
      }
    }
  }

  private onMechanic(e: MechEvent): void {
    const sov = isSovereign(e.defId) ? e.defId : sovereignOf(e.mech);
    const caster = this.host.entity(e.id);
    const ally = caster ? caster.faction === "ally" : false;
    // Repeated strikes inside one use: each blow the mirror flashes back, each image struck down.
    if (e.step === "strike" && e.index > 0 && (e.mech === "mirror_guard" || e.mech === "mirror_split")) {
      if (e.mech === "mirror_guard") this.reflect(e, ally);
      else this.imageShattered(e, sov, ally);
      return;
    }
    // The eclipse's second warning (index 1): her strike's mark is set. It belongs to the eclipse
    // already staged; `to` is where the strike will fall.
    if (e.mech === "void_eclipse" && e.step === "warn" && e.index > 0) {
      const m = this.mechs.find((x) => x.id === e.id && x.mech === "void_eclipse" && x.step === "warn");
      if (m) {
        m.to.x = e.to.x;
        m.to.y = e.to.y;
        m.marked = true;
      }
      return;
    }
    const key = `${e.id}|${e.mech}|${e.index}`;
    let m: Mech | null = this.mechs.find((x) => x.key === key) ?? null;
    if (e.step === "warn" || !m) {
      if (m) this.drop(m);
      m = this.create(key, e, sov, ally);
    }
    if (e.step === "end" && m.step === "strike" && m.t < (HOLD_STRIKE[m.mech] ?? 0)) {
      // An end in the same moment as its strike (an echo, a bolt, a wave): the strike plays out first.
      m.endHeld = { pos: { x: e.pos.x, y: e.pos.y }, countered: e.countered === true };
      return;
    }
    this.applyStep(m, e.step, e.pos, e.to, e.radius, e.duration, e.targetIds, e.countered === true);
  }

  private applyStep(m: Mech, step: MechanicStep, pos: Vec2, to: Vec2, radius: number, duration: number, targetIds: readonly number[], countered: boolean): void {
    if (step !== "end" || m.mech !== "storm_tide") {
      m.pos.x = pos.x;
      m.pos.y = pos.y;
    }
    if (step !== "end") {
      m.to.x = to.x;
      m.to.y = to.y;
    }
    // The warning's reach is the shape's (a core, a lane's half width, a rod's circle); a later
    // step's may be the pull's whole reach, kept apart.
    if (radius > 0) {
      if (step === "warn" || m.radius <= 0) m.radius = radius;
      else if (step === "strike") m.reach = radius;
    }
    if (targetIds.length > 0) {
      // Bodies it raised: the rod (named in its warning), the images and courtiers (in the strike).
      if (m.mech === "storm_rods" && step === "warn") m.raised = targetIds.slice();
      else if ((m.mech === "mirror_split" || m.mech === "void_court") && step === "strike") m.raised = targetIds.slice();
      else m.targets = targetIds.slice();
    }
    const prev = m.step;
    const prevT = m.t;
    const prevDur = m.dur;
    m.step = step;
    m.t = 0;
    m.dur = Math.max(0, duration);
    if (step === "warn") m.warn = Math.max(0.05, duration);
    if (step === "strike") {
      m.struck = true;
      this.counters.strikes += 1;
      this.onStrike(m);
    }
    if (step === "end") {
      // Answered (the simulation says so), or ended before its time: a warning that never struck,
      // a guard broken while it stood.
      m.early = countered || prev === "warn" || (prev === "strike" && prevDur > 0 && prevT + 0.12 < prevDur && m.mech === "mirror_guard");
      this.onEnd(m);
    }
    this.dressTargets(m);
  }

  /** A blow flashed back off the mirror: a line of light from the glass to whoever struck. */
  private reflect(e: MechEvent, ally: boolean): void {
    const m = this.mechs.find((x) => x.id === e.id && x.mech === "mirror_guard" && x.step !== "end");
    if (!m || m.coolA > 0) return;
    const src = e.targetIds[0];
    let sx: number;
    let sy: number;
    if (src !== undefined && this.host.sig.body(src, this.b2)) {
      sx = this.b2.x;
      sy = this.b2.y - this.b2.chestY;
    } else {
      sx = this.host.sig.proj.sx(e.to.x);
      sy = this.host.sig.proj.sy(e.to.y) - 50 * this.host.sig.proj.fs(e.to.y);
    }
    if (!this.paneAt(m, this.pt)) return;
    m.coolA = 0.1;
    m.flash = 1;
    this.counters.reflects += 1;
    const kit = this.kit;
    const u = this.host.sig.proj.unit();
    kit.slash(this.pt.x, this.pt.y - (this.paneH(m) ?? 40) * 0.55, sx, sy, m.look.ink, m.look.hot, 2.6, 0.24);
    kit.ring(sx, sy, 4, 26 * u, 0.25, -1, m.look.hot, 2, { ground: false, squash: 1 });
    const o = kit.o(sx, sy, spark(), m.look.hot);
    o.speed[0] = 60;
    o.speed[1] = 200;
    o.life[0] = 0.12;
    o.life[1] = 0.25;
    o.alignToVelocity = true;
    kit.emit(6);
    // The reflected flash: the pane lights always; the screen only through the budget, and only
    // when the flash comes at the warrior or his army (the knight's), never for his own shadow's.
    if (!ally) this.host.sig.flash(0xf4f6ff, 0.1, 0.12);
  }

  /** An image struck down: it breaks into glass where it stood. */
  private imageShattered(e: MechEvent, sov: SovereignId, ally: boolean): void {
    const pr = this.host.sig.proj;
    const look = sovLook(sov, ally);
    for (const id of e.targetIds) {
      if (this.shattered.has(id)) continue;
      this.shattered.add(id);
      this.glassBurst(pr.sx(e.pos.x), pr.sy(e.pos.y) - 50 * pr.fs(e.pos.y), look, 16);
    }
  }

  private create(key: string, e: MechEvent, sov: SovereignId, ally: boolean): Mech {
    if (this.mechs.length >= MAX_MECHS) {
      this.counters.dropped += 1;
      this.drop(this.mechs[0]!);
    }
    this.counters.mechs += 1;
    const kit = this.kit;
    const L = this.host.layers;
    const m: Mech = {
      key,
      id: e.id,
      sov,
      mech: e.mech,
      index: e.index,
      ally,
      look: sovLook(sov, ally),
      step: "warn",
      t: 0,
      dur: 0,
      warn: 0.5,
      age: 0,
      struck: false,
      early: false,
      pos: { x: e.pos.x, y: e.pos.y },
      to: { x: e.to.x, y: e.to.y },
      radius: e.radius,
      targets: e.targetIds.slice(),
      g: kit.graphics(L.ground),
      gl: kit.graphics(L.ground, true),
      f: kit.graphics(L.fx),
      fl: kit.graphics(L.fx, true),
      rig: null,
      seed: (e.id * 7919 + e.index * 104729 + Math.floor(this.now * 1000)) % 100000,
      coolA: 0,
      coolB: 0,
      outro: OUTRO[e.mech],
      push: 0,
      raised: [],
      reach: 0,
      endHeld: null,
      flash: 0,
      marked: false,
      pieces: [],
    };
    this.mechs.push(m);
    this.onWarn(m);
    return m;
  }

  private drop(m: Mech): void {
    const kit = this.kit;
    kit.freeGraphics(m.g);
    kit.freeGraphics(m.gl);
    kit.freeGraphics(m.f);
    kit.freeGraphics(m.fl);
    for (const p of m.pieces) if (p) this.pool.give(p);
    m.pieces.length = 0;
    if (m.rig) kit.freeRig(m.rig);
    m.rig = null;
    if (m.push) kit.releasePush(m.push);
    const i = this.mechs.indexOf(m);
    if (i >= 0) this.mechs.splice(i, 1);
    // What it raised stays dressed while it stands (an image outlives its split's end only to shatter).
    for (const id of m.raised) {
      const d = this.dressed.get(id);
      if (d && !this.host.entity(id)) this.dressed.delete(id);
    }
  }

  /** Bodies a mechanic raised are dressed as what they are. */
  private dressTargets(m: Mech): void {
    let kind: DressKind | null = null;
    let def = "";
    if (m.mech === "mirror_split") {
      kind = "image";
      def = "mirror_knight";
    } else if (m.mech === "storm_rods") {
      kind = "rod";
      def = "storm_rod";
    } else if (m.mech === "void_court") {
      kind = "courtier";
      def = "void_courtier";
    }
    if (!kind) return;
    for (const id of m.raised) {
      if (id < 0 || id === m.id || this.dressed.has(id)) continue;
      const ent = this.host.entity(id);
      if (ent && (ent.kind === "player" || ent.kind === "boss")) continue;
      this.dressed.set(id, { kind, def, ally: m.ally, sov: m.sov });
    }
  }

  // ------------------------------------------------------------------ beats

  private onWarn(m: Mech): void {
    const kit = this.kit;
    const pr = this.host.sig.proj;
    switch (m.mech) {
      case "mirror_echo": {
        // The ghost of the echoed art: the warrior's own figure, pale (or gold, the shadow's).
        const spec = this.host.playerSpec();
        const rig = kit.rig(m.ally ? "echo-ally" : "echo", spec, 0, 0);
        if (rig) {
          rig.root.tint = m.ally ? 0xf3dc9a : 0xdfe6f5;
          rig.root.zIndex = 0;
          m.rig = rig;
        }
        break;
      }
      case "storm_rods": {
        // The rod is planted by a bolt from the sky.
        const x = pr.sx(m.pos.x);
        const y = pr.sy(m.pos.y);
        this.skyBolt(m.seed, m.look, x, y, 0.16, 1.4);
        kit.ring(x, y, 4, 40 * pr.unit(), 0.35, m.look.ink, m.look.main, 2);
        break;
      }
      case "void_well": {
        const x = pr.sx(m.pos.x);
        const y = pr.sy(m.pos.y);
        kit.ring(x, y, m.radius * pr.unit() * 2.6, 6, 0.6, m.look.ink, m.look.main, 3, { inward: true });
        break;
      }
      case "void_eclipse":
        break;
      default:
        break;
    }
    if (m.ally && isUltimate(m.mech)) this.ultimateWarn(m);
  }

  private onStrike(m: Mech): void {
    const kit = this.kit;
    const pr = this.host.sig.proj;
    const u = pr.unit();
    switch (m.mech) {
      case "mirror_guard": {
        const p = this.paneAt(m, this.pt);
        if (p) kit.ring(this.pt.x, this.pt.y, 6, 36 * u, 0.4, m.look.ink, m.look.hot, 2);
        break;
      }
      case "mirror_echo": {
        const x0 = pr.sx(m.pos.x);
        const y0 = pr.sy(m.pos.y);
        const x1 = pr.sx(m.to.x);
        const y1 = pr.sy(m.to.y);
        const ch = 50 * pr.fs(m.pos.y);
        kit.speedLines(x0, y0 - ch, x1, y1 - ch, kit.reduced ? 2 : 5, 30 * u, m.look.hot, 0.3);
        this.echoArt(m, x0 + (x1 >= x0 ? 1 : -1) * 40 * u, y0, ch);
        break;
      }
      case "mirror_split": {
        if (this.host.sig.body(m.id, this.b)) {
          const b = this.b;
          kit.ring(b.x, b.y, 10, 120 * u, 0.6, m.look.ink, m.look.hot, 3);
          const o = kit.o(b.x, b.y - b.chestY, shard(), m.look.main);
          o.speed[0] = 120;
          o.speed[1] = 320;
          o.life[0] = 0.4;
          o.life[1] = 0.8;
          o.scale[0] = 0.3;
          o.scale[1] = 0.7;
          o.gravity = 260;
          o.spin = 8;
          o.additive = false;
          kit.emit(24);
        }
        for (const id of m.raised) {
          if (!this.host.sig.body(id, this.b2)) continue;
          kit.ring(this.b2.x, this.b2.y, 4, 46 * u, 0.4, m.look.ink, m.look.hot, 2);
        }
        if (!m.ally) this.shakeOnce(0.25);
        break;
      }
      case "storm_rods": {
        const x = pr.sx(m.pos.x);
        const y = pr.sy(m.pos.y);
        const top = 70 * pr.fs(m.pos.y);
        this.skyBolt(m.seed, m.look, x, y - top, 0.3, 3.2);
        const r = m.radius * u;
        const ry = m.radius * pr.dy();
        kit.ring(x, y, 8, r, 0.45, m.look.ink, m.look.hot, 4, { squash: ry / Math.max(1, r) });
        kit.ring(x, y, 4, r * 0.6, 0.3, -1, 0xffffff, 2, { squash: ry / Math.max(1, r) });
        const o = kit.o(x, y - top, spark(), m.look.hot);
        o.speed[0] = 120;
        o.speed[1] = 360;
        o.life[0] = 0.15;
        o.life[1] = 0.35;
        o.scale[0] = 0.3;
        o.scale[1] = 0.8;
        o.alignToVelocity = true;
        kit.emit(18);
        if (!m.ally) this.host.sig.flash(0xd8e8ff, 0.16, 0.18);
        this.shakeOnce(m.ally ? 0.12 : 0.28);
        kit.stop(0.05, "sov-rod", 0.4);
        break;
      }
      case "storm_chain":
        break;
      case "storm_tide": {
        const o = kit.o(pr.sx(m.pos.x), pr.sy(m.pos.y), softCircle(), m.ally ? 0xfff1c9 : 0xd8f4ff);
        o.speed[0] = 80;
        o.speed[1] = 260;
        o.angle[0] = -Math.PI * 0.85;
        o.angle[1] = -Math.PI * 0.15;
        o.gravity = 500;
        o.scale[0] = 0.2;
        o.scale[1] = 0.5;
        kit.emit(16);
        this.shakeOnce(m.ally ? 0.15 : 0.3);
        break;
      }
      case "void_well":
        break;
      case "void_court":
        for (const id of m.raised) {
          if (!this.host.sig.body(id, this.b2)) continue;
          kit.ring(this.b2.x, this.b2.y, 30 * u, 4, 0.45, m.look.ink, m.look.main, 2, { inward: true });
        }
        break;
      case "void_eclipse": {
        const sq = pr.dy() / u;
        if (m.ally || m.radius > 300) {
          // The shadow's eclipse: every foe it names is struck from the dark at once.
          let n = 0;
          for (const id of m.targets) {
            if (n >= 12 || !this.host.sig.body(id, this.b2)) continue;
            n += 1;
            const b = this.b2;
            kit.cut(b.x, b.y - b.chestY, b.height * 0.5, -2.2 + (n % 2) * 0.6, 1.8, m.look.ink, m.look.hot, 3, 0.3, { squash: 0.8, delay: n * 0.025 });
            kit.ring(b.x, b.y, 4, 34 * u, 0.4, m.look.ink, m.look.trim, 2, { squash: sq, delay: n * 0.025 });
          }
        } else {
          const x = pr.sx(m.to.x);
          const y = pr.sy(m.to.y);
          const r = Math.max(30, m.radius) * u;
          kit.ring(x, y, 6, r * 1.3, 0.5, m.look.ink, m.look.hot, 4, { squash: sq });
          kit.cut(x, y - 30 * pr.fs(m.to.y), r * 0.9, -2.4, 1.9, m.look.ink, m.look.hot, 4, 0.35, { squash: 0.7 });
        }
        this.host.sig.flash(m.ally ? 0xfff1c9 : 0xe8dcff, 0.22, 0.2);
        this.shakeOnce(0.3);
        kit.stop(0.06, "sov-eclipse", 0.5);
        break;
      }
    }
    if (m.ally && isUltimate(m.mech)) this.ultimateStrike();
  }

  private onEnd(m: Mech): void {
    const kit = this.kit;
    const pr = this.host.sig.proj;
    const u = pr.unit();
    switch (m.mech) {
      case "mirror_guard": {
        // Broken early (a dodge through it, a heavy art): the pane shatters. Else it sinks.
        if (m.early) {
          if (this.paneAt(m, this.pt)) this.glassBurst(this.pt.x, this.pt.y, m.look, 26);
        }
        break;
      }
      case "mirror_echo":
        if (m.rig && this.ghostAt(m, this.pt)) this.glassBurst(this.pt.x, this.pt.y, m.look, 10);
        break;
      case "mirror_split":
        // The images that still stand when it ends shatter (those struck down already did).
        for (const id of m.raised) {
          if (!this.host.sig.body(id, this.b2)) continue;
          this.glassBurst(this.b2.x, this.b2.y - this.b2.chestY, m.look, 12);
        }
        break;
      case "storm_rods":
        if (!m.struck) {
          m.early = true;
          // Struck down before it charged: it calls nothing; the charge spills out as sparks.
          const x = pr.sx(m.pos.x);
          const y = pr.sy(m.pos.y);
          kit.ring(x, y, m.radius * u, 6, 0.35, m.look.ink, 0xbfc6d0, 2, { inward: true, squash: pr.dy() / u });
          const o = kit.o(x, y - 40 * pr.fs(m.pos.y), spark(), 0xbfc6d0);
          o.speed[0] = 40;
          o.speed[1] = 140;
          o.gravity = 300;
          o.alignToVelocity = true;
          kit.emit(10);
        }
        break;
      case "void_well": {
        const x = pr.sx(m.pos.x);
        const y = pr.sy(m.pos.y);
        kit.ring(x, y, m.radius * u * 0.4, m.radius * u * 1.8, 0.5, m.look.ink, m.look.hot, 3, { squash: pr.dy() / u });
        break;
      }
      default:
        break;
    }
    if (m.push) {
      kit.releasePush(m.push);
      m.push = 0;
    }
  }

  private onDeath(id: number, pos: Vec2): void {
    const d = this.dressed.get(id);
    if (!d) return;
    const pr = this.host.sig.proj;
    const x = pr.sx(pos.x);
    const y = pr.sy(pos.y);
    const look = sovLook(d.sov, d.ally);
    if (d.kind === "image") {
      if (!this.shattered.has(id)) this.glassBurst(x, y - 50 * pr.fs(pos.y), look, 16);
      this.shattered.add(id);
    }
    else if (d.kind === "rod") {
      const o = this.kit.o(x, y - 50 * pr.fs(pos.y), shard(), 0x3a4048);
      o.speed[0] = 60;
      o.speed[1] = 180;
      o.gravity = 400;
      o.spin = 8;
      o.additive = false;
      this.kit.emit(10);
    } else {
      this.kit.ring(x, y, 4, 40 * pr.unit(), 0.4, look.ink, look.main, 2);
    }
    // It stays dressed while its body is drawn falling; it is forgotten once the body is gone.
  }

  /**
   * Phase two: the Sovereign changes form (its rig shows the second regalia; this is the moment).
   * The knight bursts into mirror shards round a gold crack, the titan calls the storm down on
   * itself, the queen's halo collapses into a black sun.
   */
  transform(id: number, sov: SovereignId): void {
    const sig = this.host.sig;
    if (!sig.body(id, this.b)) return;
    const b = this.b;
    const kit = this.kit;
    const u = sig.proj.unit();
    const L = sovLook(sov, false);
    const cx = b.x;
    const cy = b.y - b.chestY;
    if (sov === "mirror_knight") {
      this.glassBurst(cx, cy, L, 30);
      kit.ring(cx, cy, 6, 90 * u, 0.6, -1, L.trim, 3, { ground: false, squash: 1 });
    } else if (sov === "storm_titan") {
      this.skyBolt(id * 31, L, cx, b.y - b.height * 0.95, 0.35, 4);
      kit.ring(b.x, b.y, 10, 200 * u, 0.7, L.ink, L.hot, 5);
      const o = kit.o(cx, b.y - b.height, spark(), L.hot);
      o.speed[0] = 140;
      o.speed[1] = 380;
      o.alignToVelocity = true;
      kit.emit(26);
    } else {
      const hy = b.y - b.height * 0.92;
      kit.ring(cx, hy, 120 * u, 6, 0.6, L.ink, L.main, 4, { ground: false, squash: 1, inward: true });
      kit.ring(cx, hy, 6, 160 * u, 0.8, L.ink, L.hot, 3, { ground: false, squash: 1, delay: 0.5 });
      kit.spiral(cx, hy, 90 * u, 14, softCircle(), L.main, true, 0.6, 10);
    }
  }

  /** The essence a Sovereign leaves: the orb rises in its own mark (the army's gold round it). */
  essence(sov: SovereignId, pos: Vec2): void {
    const pr = this.host.sig.proj;
    const kit = this.kit;
    const u = pr.unit();
    const x = pr.sx(pos.x);
    const y = pr.sy(pos.y);
    const L = sovLook(sov, false);
    const cy = y - 40 * pr.fs(pos.y);
    kit.ring(x, cy, 4, 40 * u, 0.9, -1, sov === "void_queen" ? 0xb18cff : L.main, 3, { ground: false, squash: 1 });
    kit.ring(x, y, 6, 90 * u, 1.0, 0x3a404d, 0xfff1c9, 3);
    if (sov === "mirror_knight") this.glassBurst(x, cy, L, 10);
    else if (sov === "storm_titan") this.skyBolt(7, L, x, cy, 0.22, 1.6);
    else kit.spiral(x, cy, 50 * u, 10, softCircle(), L.main, true, 0.7, 9);
  }

  // ------------------------------------------------------------------ a shadow's ultimate

  private ultimateWarn(m: Mech): void {
    const pr = this.host.sig.proj;
    const name = ULTIMATE_NAME[m.mech];
    if (name && !this.named.has(name) && this.host.sig.body(m.id, this.b)) {
      this.named.add(name);
      // Ultimates fired in the same breath (they all answer the Fury) stack their names, never overlap.
      if (this.now - this.labelAt > 0.4) this.labelStack = 0;
      this.labelAt = this.now;
      const lift = this.labelStack * 26 * pr.unit();
      this.labelStack += 1;
      this.host.label(name, this.b.x, this.b.y - this.b.height - 30 * pr.unit() - lift, m.look.label);
    }
    const fx = pr.sx((m.pos.x + m.to.x) / 2);
    const fy = pr.sy((m.pos.y + m.to.y) / 2) - 40 * pr.unit();
    m.push = this.kit.pushIn(fx, fy, 1.08, 0.3, Math.max(0.2, m.warn), 0.45);
  }

  private ultimateStrike(): void {
    const kit = this.kit;
    this.host.sig.flash(0xfff1c9, 0.24, 0.22);
    kit.stop(0.07, "sov-ult", 1);
    // With the warrior's Ascendant Fury in the same breath, the two crown each other: a gold crown
    // of light on him, one flash (the Fury's own go through the same budget).
    if (this.host.furyOn() && this.host.sig.body(this.host.sig.playerId(), this.b)) {
      this.counters.together += 1;
      const u = this.host.sig.proj.unit();
      kit.ring(this.b.x, this.b.y, 10, 150 * u, 0.7, 0x3a404d, 0xfff1c9, 5);
      kit.ring(this.b.x, this.b.y - this.b.height - 6 * u, 4, 22 * u, 0.6, -1, 0xfff1c9, 3, { squash: 0.35 });
      if (!this.named.has("together")) {
        this.named.add("together");
        this.host.label("Sovereign's Fury", this.b.x, this.b.y - this.b.height - 40 * u, 0xfff1c9);
      }
    }
  }

  // ------------------------------------------------------------------ frame

  /** `dt` world seconds (zero in a stop), `real` real seconds. Call after the signature director. */
  update(dt: number, real: number): void {
    // A frame whose clock ran backwards (a stale animation frame after a reload or a hidden tab)
    // moves nothing: the dark must never deepen without an eclipse, nor past its own depth.
    dt = Math.max(0, dt);
    real = Math.max(0, real);
    this.now += real;
    this.stamp += 1;
    this.restoreMods();
    let dark = 0;
    let darkAlly = false;
    let focusK = 0;
    this.focusIds.length = 0;
    for (let i = this.mechs.length - 1; i >= 0; i--) {
      const m = this.mechs[i]!;
      m.t += dt;
      m.age += dt;
      m.coolA = Math.max(0, m.coolA - real);
      m.coolB = Math.max(0, m.coolB - real);
      m.flash = Math.max(0, m.flash - real * 5);
      if (m.endHeld && m.step === "strike" && m.t >= (HOLD_STRIKE[m.mech] ?? 0)) {
        const h = m.endHeld;
        m.endHeld = null;
        this.applyStep(m, "end", h.pos, h.pos, 0, 0, [], h.countered);
      }
      if (m.step === "end" && m.t >= m.outro) {
        this.drop(m);
        continue;
      }
      // A mechanic whose events stopped (a fight that ended mid-warning) lets go on its own.
      if (m.step !== "end" && m.t > Math.max(m.dur, m.warn) + 4 && !this.anyStanding(m)) {
        this.drop(m);
        continue;
      }
      this.draw(m, dt);
      if (m.mech === "void_eclipse") {
        const d = this.eclipseLevel(m);
        if (d > dark) {
          dark = d;
          darkAlly = m.ally;
        }
      }
      if (m.ally && isUltimate(m.mech) && m.step !== "end") {
        const k = m.step === "warn" ? Math.min(1, m.t / 0.25) : Math.max(0, 1 - m.t / 0.6);
        if (k > focusK) focusK = k;
        this.focusIds.push(m.id);
        for (const id of m.targets) this.focusIds.push(id);
      }
    }
    this.host.focus(focusK, true, this.focusIds);
    this.applyDark(dark, darkAlly, real);
    this.dressBodies();
  }

  // ------------------------------------------------------------------ drawing

  private draw(m: Mech, dt: number): void {
    // What is still drawn from scratch (a chain's crackle, the hunted ring) is cleared only when
    // there is something to clear: clearing an empty graphics still makes Pixi look at it again.
    clearIf(m.g);
    clearIf(m.gl);
    clearIf(m.f);
    clearIf(m.fl);
    switch (m.mech) {
      case "mirror_guard":
        this.drawGuard(m);
        break;
      case "mirror_echo":
        this.drawEcho(m);
        break;
      case "mirror_split":
        this.drawSplit(m);
        break;
      case "storm_rods":
        this.drawRod(m, dt);
        break;
      case "storm_chain":
        this.drawChain(m);
        break;
      case "storm_tide":
        this.drawTide(m, dt);
        break;
      case "void_well":
        this.drawWell(m, dt);
        break;
      case "void_court":
        this.drawCourt(m);
        break;
      case "void_eclipse":
        this.drawEclipse(m);
        break;
    }
    // A shape this frame did not draw is hidden (never cleared: it is shown again as it was).
    for (const p of m.pieces) if (p && p.stamp !== this.stamp && p.g.visible) p.hide();
  }

  /**
   * A mechanic's shape in slot `i`, made on first use: `where` 0 on the ground, 1 on the ground in
   * added light, 2 over the figures, 3 over the figures in added light (in that order of drawing).
   */
  private piece(m: Mech, i: number, where: 0 | 1 | 2 | 3): Piece {
    let p = m.pieces[i];
    if (!p) {
      const ground = where < 2;
      const layer = ground ? this.host.layers.ground : this.host.layers.fx;
      const ref = ground ? m.gl : m.fl;
      const at = layer.children.indexOf(ref);
      p = this.pool.take(layer, where === 1 || where === 3, at < 0 ? -1 : at + (where === 1 || where === 3 ? 1 : 0));
      m.pieces[i] = p;
    }
    p.stamp = this.stamp;
    return p;
  }

  /** How far through its life a mechanic is drawn (0 to 1 in, 1 standing, falling to 0 in its outro). */
  private presence(m: Mech, fadeIn: number): number {
    if (m.step === "warn") return Math.min(1, m.t / Math.max(0.01, Math.min(fadeIn, m.warn)));
    if (m.step === "strike") return 1;
    return Math.max(0, 1 - m.t / Math.max(0.01, m.outro));
  }

  // ---- the Mirror Knight

  /**
   * Where the mirror stands: in front of the body it guards (the knight, or for its shadow the
   * warrior), toward the threat. Writes the pane's foot in base px; false when the body is gone.
   */
  private paneAt(m: Mech, out: { x: number; y: number }): number | false {
    const guarded = m.ally ? (m.targets.length > 0 ? m.targets[0]! : this.host.sig.playerId()) : m.id;
    const b = this.b;
    if (!this.host.sig.body(guarded, b)) return false;
    // Toward the threat: where the knight's warning points, else the way the guarded body faces.
    const side = Math.abs(m.to.x - b.wx) > 1 ? (m.to.x >= b.wx ? 1 : -1) : b.facing;
    out.x = b.x + side * Math.max(16, b.height * 0.24);
    out.y = b.y + 2;
    return b.height;
  }

  /** The pane's height (base px), or null when its body is gone. */
  private paneH(m: Mech): number | null {
    const h = this.paneAt(m, this.pt2);
    return h === false ? null : h * 0.95;
  }

  private readonly pt2 = { x: 0, y: 0 };

  private drawGuard(m: Mech): void {
    const h = this.paneAt(m, this.pt);
    if (h === false) return;
    const L = m.look;
    const x = this.pt.x;
    const y = this.pt.y;
    // Rises out of the ground during the warning; stands; shatters or sinks at the end.
    let rise = m.step === "warn" ? easeOutBack(Math.min(1, m.t / Math.max(0.05, m.warn))) : 1;
    let alpha = 1;
    if (m.step === "end") {
      if (m.early) alpha = 0;
      else {
        rise = 1 - easeInCubic(Math.min(1, m.t / m.outro));
        alpha = 1 - Math.min(1, m.t / m.outro);
      }
    }
    if (alpha <= 0.01 || rise <= 0.01) return;
    // The pane is built at its full height once and risen by its scale.
    const ph = q(h * 0.95);
    const pw = q(h * 0.3);
    const sy = Math.min(1.05, rise);
    const bank = this.bank;
    // The frame: gilt, an ink edge so it reads on a pale floor; lit by each blow it throws back.
    this.piece(m, 0, 2).shared(bank, "pane", pane, pw, ph, L.ink, L.main, m.ally ? L.main : L.trim).at(x, y, 1, sy, 0, alpha);
    if (m.flash > 0.01) this.piece(m, 1, 2).shared(bank, "paneLight", paneLight, pw, ph, L.main).at(x, y, 1, sy, 0, m.flash * alpha);
    // The glass: a sheen that sweeps across it while it stands, and a fixed glint.
    const sweep = ((m.age * 0.9) % 1.6) / 1.6;
    this.piece(m, 2, 3).shared(bank, "paneSheen", paneSheen, pw, ph, L.hot).at(x - pw / 2 + pw * sweep, y, 1, sy, 0, alpha);
    this.piece(m, 3, 3).shared(bank, "paneGlint", paneGlint, pw, ph, L.hot).at(x, y, 1, sy, 0, alpha);
    // A ground line where it meets the floor (its reach along the ground).
    this.piece(m, 4, 1).shared(bank, "ellipseFill", ellipseFill, q(pw * 0.9), q(pw * 0.22), L.hot, 0.18).at(x, y, 1, 1, 0, alpha);
    if (m.step === "strike" && m.dur > 0) {
      // Its time running out: the gilt frame drains from the top.
      const left = Math.max(0, 1 - m.t / m.dur);
      if (left > 0.002) this.piece(m, 5, 2).shared(bank, "line", line, 0, -ph, 2, L.trim, 0.8).at(x - pw / 2 - 4, y, 1, left);
    }
  }

  private ghostAt(m: Mech, out: { x: number; y: number }): boolean {
    const pr = this.host.sig.proj;
    let k = 0;
    if (m.step === "strike") k = easeOutCubic(Math.min(1, m.t / 0.18));
    if (m.step === "end") k = 1;
    // A lunge into the lane, not along all of it (the art flies on alone).
    const len = Math.hypot(m.to.x - m.pos.x, m.to.y - m.pos.y) || 1;
    const lunge = Math.min(1, 50 / len) * k;
    const wx = m.pos.x + (m.to.x - m.pos.x) * lunge;
    const wy = m.pos.y + (m.to.y - m.pos.y) * lunge;
    out.x = pr.sx(wx);
    out.y = pr.sy(wy);
    return true;
  }

  private drawEcho(m: Mech): void {
    const pr = this.host.sig.proj;
    const L = m.look;
    const bank = this.bank;
    const x0 = pr.sx(m.pos.x);
    const y0 = pr.sy(m.pos.y);
    const x1 = pr.sx(m.to.x);
    const y1 = pr.sy(m.to.y);
    const k = this.presence(m, 0.3);
    // The line the art will fly: a pale dashed path under the telegraph, ticks marching along it
    // (the dashes are built once along the lane and slid; the last drops out at the lane's end).
    if (m.step === "warn") {
      const n = 10;
      const march = (m.age * 2.2) % 1;
      const len = Math.hypot(x1 - x0, y1 - y0);
      const rot = Math.atan2(y1 - y0, x1 - x0);
      const off = (march / n) * len;
      const ox = x0 + Math.cos(rot) * off;
      const oy = y0 + Math.sin(rot) * off;
      const ql = q(len, 1);
      this.piece(m, 0, 1).shared(bank, "dashes", dashes, ql, n, 0, n - 1, 2, L.hot).at(ox, oy, 1, 1, rot, 0.55 * k);
      if (march + 0.45 <= 1) this.piece(m, 1, 1).shared(bank, "dashes", dashes, ql, n, n - 1, n, 2, L.hot).at(ox, oy, 1, 1, rot, 0.55 * k);
      // The art gathering in the ghost's hand: its own glyph, pale, growing as the warning runs out.
      const ch = 50 * pr.fs(m.pos.y);
      const w = Math.min(1, m.t / m.warn);
      const dir = x1 >= x0 ? 1 : -1;
      this.artGlyph(m, x0 + dir * 26 * pr.unit(), y0, ch, w, L);
    } else if (m.step === "strike") {
      // The art flies down the lane: a pale crescent wave racing to its end.
      const k2 = Math.min(1, m.t / 0.3);
      const x = x0 + (x1 - x0) * easeOutCubic(k2);
      const y = y0 + (y1 - y0) * k2;
      const ch = q(50 * pr.fs(m.pos.y));
      const r = q(Math.max(14, m.radius) * pr.dy());
      const dir = x1 >= x0 ? 1 : -1;
      const a = 1 - k2 * 0.6;
      this.piece(m, 2, 2).shared(bank, "crescent", crescent, dir, ch, r, 7, L.ink, 0.6).at(x, y, 1, 1, 0, a);
      this.piece(m, 3, 3).shared(bank, "crescent", crescent, dir, ch, r, 2.6, L.hot, 1).at(x, y, 1, 1, 0, a);
      const len = Math.hypot(x - x0, y - y0);
      if (len > 0.5) this.piece(m, 4, 1).shared(bank, "line", line, 100, 0, q(r * 0.8), L.hot, 0.12).at(x0, y0, len / 100, 1, Math.atan2(y - y0, x - x0), a);
    }
    // The ghost: the warrior's figure, mirrored, casting toward him.
    const rig = m.rig;
    if (rig && this.ghostAt(m, this.pt)) {
      const facing: 1 | -1 = x1 >= x0 ? 1 : -1;
      const s = pr.fs(m.pos.y);
      const state = m.step === "warn" ? "cast" : "attack";
      rig.animate(state, m.step === "warn" ? m.t : Math.min(0.2, m.t), m.step === "warn" ? m.warn : 0.25, 0.3, facing, false, 0, 0, 1 / 60, 1);
      rig.root.position.set(this.pt.x, this.pt.y);
      rig.root.scale.set(s);
      rig.root.zIndex = 5000;
      rig.root.alpha = (m.step === "end" ? Math.max(0, 1 - m.t / 0.12) : 0.62) * (m.step === "warn" ? Math.min(1, m.t / 0.2) : 1);
      rig.setWhite(m.step === "warn" ? 0.35 + 0.2 * Math.sin(m.age * 14) : 0.5);
      // A cold rim under the ghost so it reads as a reflection, not a second warrior.
      this.piece(m, 5, 1).shared(bank, "ellipseLine", ellipseLine, q(18 * s), q(5 * s), 1.5, L.hot, 0.6).at(this.pt.x, this.pt.y, 1, 1, 0, rig.root.alpha);
    }
  }

  /** The echoed art's glyph at its landing point (pale for the knight's, gold for the shadow's). */
  private artGlyph(m: Mech, x: number, y: number, ch: number, w: number, L: SovLook): void {
    const art = this.host.lastArt();
    const u = this.host.sig.proj.unit();
    const a = 0.25 + 0.6 * w;
    // Grown in steps of a twentieth (built at its size: a stroke keeps its width as it grows).
    const qw = Math.round(w * 20) / 20;
    switch (art) {
      case "thunder_strike":
        this.piece(m, 6, 3).shared(this.bank, "glyphBolt", glyphBolt, q(ch), q(u, 0.01), L.hot).at(x, y, 1, 1, 0, a);
        break;
      case "void_nova":
      case "soul_burst":
        this.piece(m, 6, 3).own("glyphRing", glyphRing, (10 + 30 * qw) * u, L.hot).at(x, y - ch * 0.6, 1, 1, 0, a);
        break;
      default:
        // A crescent: the arc of a cut, opening toward him.
        this.piece(m, 6, 3).own("glyphArc", glyphArc, (18 + 20 * qw) * u, L.hot).at(x, y - ch * 0.6, 1, 1, 0, a);
        break;
    }
  }

  private echoArt(m: Mech, x: number, y: number, ch: number): void {
    const kit = this.kit;
    const L = m.look;
    const u = this.host.sig.proj.unit();
    const art = this.host.lastArt();
    if (art === "thunder_strike") this.skyBolt(m.seed, m.look, x, y, 0.22, 2.2);
    else if (art === "void_nova" || art === "soul_burst") kit.ring(x, y - ch * 0.5, 6, 70 * u, 0.4, L.ink, L.hot, 3, { ground: false, squash: 0.6 });
    else kit.cut(x, y - ch * 0.6, 44 * u, m.to.x >= m.pos.x ? -1.1 : Math.PI - 1.1, 2.2, L.ink, L.hot, 4, 0.3, { squash: 0.8 });
    kit.ring(x, y, 4, 50 * u, 0.35, L.ink, L.hot, 2);
  }

  private drawSplit(m: Mech): void {
    const L = m.look;
    const sig = this.host.sig;
    const u = sig.proj.unit();
    const bank = this.bank;
    const k = this.presence(m, 0.25);
    if (k <= 0) return;
    // The true knight: a crack of gold light down its breast that pulses (its images have none).
    if (!m.ally && sig.body(m.id, this.b)) {
      const b = this.b;
      const s = b.scale;
      const cx = b.x;
      const cy = b.y - b.chestY;
      const pulse = 0.75 + 0.25 * Math.sin(m.age * 7);
      const amp = m.step === "warn" ? Math.min(1, m.t / m.warn) : 1;
      if (amp > 0.01) this.piece(m, 0, 3).shared(bank, "disc", disc, 16, L.trim, 0.22).at(cx, cy, s * amp, s * amp, 0, k * pulse);
      this.piece(m, 1, 3).shared(bank, "crack", crack, q(s, 0.02), 0xfff1c9).at(cx, cy, 1, 1, 0, k * pulse);
      // A gilt diamond over its head: the one to strike.
      if (m.step !== "warn") this.piece(m, 2, 3).shared(bank, "diamond", diamond, q(u, 0.01), 0xfff1c9).at(cx, b.y - b.height - 14 * u, 1, 1, 0, k);
    }
    // The images: cold glass rims at their feet.
    let i = 3;
    for (const id of m.raised) {
      if (!sig.body(id, this.b2)) continue;
      const s = this.b2.scale;
      this.piece(m, i++, 1).shared(bank, "ellipseLine", ellipseLine, q(20 * s), q(6 * s), 1.4, L.hot, 0.6).at(this.b2.x, this.b2.y, 1, 1, 0, k);
    }
  }

  // ---- the Storm Titan

  private skyBolt(seed: number, look: SovLook, x: number, y: number, life: number, width: number): void {
    const top = this.host.sig.proj.top() - 20;
    // Two strokes along a jagged path (the kit draws straight cuts; the jag is several of them).
    const kit = this.kit;
    let px = x + (frac(seed * 0.37 + this.now) - 0.5) * 40;
    let py = top;
    const n = 6;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const nx = i === n ? x : x + (frac(seed * 0.13 + i * 0.71 + this.now * 3) - 0.5) * 46 * (1 - t);
      const ny = top + (y - top) * t;
      kit.slash(px, py, nx, ny, look.ink, look.hot, width, life, 0);
      px = nx;
      py = ny;
    }
  }

  private drawRod(m: Mech, dt: number): void {
    const pr = this.host.sig.proj;
    const L = m.look;
    const u = pr.unit();
    const bank = this.bank;
    const rodId = m.raised[0];
    // The rod stands where its body is (it may be shoved), else where it was planted.
    let x = pr.sx(m.pos.x);
    let y = pr.sy(m.pos.y);
    let s = pr.fs(m.pos.y);
    if (rodId !== undefined && this.host.sig.body(rodId, this.b2)) {
      x = this.b2.x;
      y = this.b2.y;
      s = this.b2.scale;
    }
    const grow = m.step === "warn" ? easeOutBack(Math.min(1, m.t / 0.18)) : 1;
    const charge = m.step === "warn" ? Math.min(1, m.t / m.warn) : 1;
    let alpha = 1;
    let topple = 0;
    if (m.step === "end") {
      alpha = 1 - Math.min(1, m.t / m.outro);
      if (m.early) topple = easeInCubic(Math.min(1, m.t / (m.outro * 0.8)));
    }
    if (alpha <= 0.01) return;
    const qs = q(s, 0.01);
    const h = q(70 * s * grow);
    const qt = q(topple, 0.01);
    const tipX = x + Math.sin(qt * 1.3) * h;
    const tipY = y - Math.cos(qt * 1.3) * h;
    // Its reach: the ground it will strike, filling as it charges (the telegraph is the threat).
    const rx = q(m.radius * u);
    const ry = q(m.radius * pr.dy());
    if (m.step === "warn") {
      this.piece(m, 0, 0).shared(bank, "ellipseFill", ellipseFill, rx, ry, L.main, 1).at(x, y, 1, 1, 0, 0.05 + 0.08 * charge);
      // The arc round it fills in seventy-two steps (each built once and kept for every rod).
      const steps = Math.round(charge * 72);
      if (steps > 0) this.piece(m, 1, 1).shared(bank, "chargeArc", chargeArc, rx, ry, steps, 72, L.main).at(x, y);
    } else if (m.step === "strike") {
      // Scorched ground where it struck.
      const k = Math.min(1, m.t / 0.4);
      this.piece(m, 2, 0).shared(bank, "ellipseFill", ellipseFill, q(rx * 0.7), q(ry * 0.7), 0x0a0c10, 1).at(x, y, 1, 1, 0, 0.35 * (1 - k * 0.5));
    }
    // The rod: dark iron, a lit tip, a gilt band (a shadow's is slate and gold).
    const iron = m.ally ? 0x5b6272 : 0x1f262e;
    this.piece(m, 3, 2).own("rod", rod, qs, h, qt, L.ink, iron, m.ally ? 0xe9c97a : L.trim).at(x, y, 1, 1, 0, alpha);
    const glow = m.step === "warn" ? 0.3 + 0.7 * charge * charge : m.step === "strike" ? Math.max(0, 1 - m.t / 0.5) : 0;
    const gr = ((4 + 8 * glow) * s) / 8;
    this.piece(m, 4, 3).shared(bank, "disc", disc, 8, L.main, 1).at(tipX, tipY, gr, gr, 0, (0.25 + 0.4 * glow) * alpha);
    this.piece(m, 5, 3).shared(bank, "disc", disc, q(2.6 * s, 0.1), L.hot, 1).at(tipX, tipY, 1, 1, 0, alpha);
    // Arcs crawling up it while it charges, faster and brighter toward the strike.
    if (m.step === "warn" && !this.reduced) {
      const n = 1 + Math.floor(charge * 3);
      const seed = Math.floor(m.age * 18);
      this.piece(m, 6, 3).own("rodArcs", rodArcs, h, qs, seed, n, L.hot).at(x, y, 1, 1, 0, 0.5 + 0.5 * charge);
      m.coolB -= dt;
      if (charge > 0.6 && m.coolB <= 0) {
        m.coolB = 0.12;
        const o = this.kit.o(tipX, tipY, spark(), L.hot);
        o.speed[0] = 30;
        o.speed[1] = 90;
        o.life[0] = 0.15;
        o.life[1] = 0.3;
        o.alignToVelocity = true;
        this.kit.emit(2);
      }
    }
    // Its charge and its health: a small pip over the tip (rods are struck down to stop them).
    if (rodId !== undefined && m.step === "warn") {
      const ent = this.host.entity(rodId);
      if (ent && !ent.dead && ent.stats.maxHp > 0) {
        const hpk = Math.max(0, ent.hp / ent.stats.maxHp);
        this.piece(m, 7, 2).own("pip", pip, q(22 * s), Math.round(hpk * 100) / 100, m.ally ? 0xe9c97a : 0xcc3f4b).at(x, tipY - 12 * s);
      }
    }
  }

  private drawChain(m: Mech): void {
    const sig = this.host.sig;
    const L = m.look;
    const k = this.presence(m, 0.2);
    if (k <= 0) return;
    // The path: from the caster (or where the bolt starts) through every chained body in order.
    const pts: number[] = [];
    if (m.step !== "warn" && m.pos.y < 0) {
      // The boss's bolt falls from the sky onto the marked spot, then leaps.
      pts.push(sig.proj.sx(m.to.x), sig.proj.top() - 10);
    } else if (sig.body(m.id, this.b)) pts.push(this.b.x, this.b.y - this.b.chestY * 1.3);
    else pts.push(sig.proj.sx(m.pos.x), sig.proj.sy(m.pos.y) - 60);
    for (const id of m.targets) {
      if (!sig.body(id, this.b2)) continue;
      pts.push(this.b2.x, this.b2.y - this.b2.chestY);
    }
    const links = pts.length / 2 - 1;
    if (links < 1) return;
    const seed = Math.floor(m.age * 16);
    if (m.step === "warn") {
      // The arcing chain that will run: thin, crackling, brightening as it nears.
      const w = Math.min(1, m.t / m.warn);
      for (let i = 0; i < links; i++) this.jag(m.fl, pts[i * 2]!, pts[i * 2 + 1]!, pts[i * 2 + 2]!, pts[i * 2 + 3]!, 5, 10, seed + i, 1 + w, L.main, (0.35 + 0.5 * w) * k);
      // Each chained body is ringed at its feet so the link reads on the ground too.
      for (let i = 0; i < m.targets.length; i++) {
        if (!sig.body(m.targets[i]!, this.b2)) continue;
        const s = this.b2.scale;
        m.gl.ellipse(this.b2.x, this.b2.y, 17 * s, 5 * s).stroke({ width: 1.6, color: L.main, alpha: (0.5 + 0.4 * w) * k });
        if (i > 0 && sig.body(m.targets[i - 1]!, this.b)) m.gl.moveTo(this.b.x, this.b.y).lineTo(this.b2.x, this.b2.y).stroke({ width: 1, color: L.main, alpha: 0.35 * k });
      }
      return;
    }
    // The strike: the bolt leaps link by link, each thinner than the last (its damage falls).
    const per = 0.07;
    for (let i = 0; i < links; i++) {
      const t = m.t - (m.step === "strike" ? i * per : -1);
      if (t < 0) continue;
      const a = m.step === "end" ? k : Math.max(0, 1 - t / 0.3);
      if (a <= 0) continue;
      const w = Math.max(1, 4 - i * 0.8);
      this.jag(m.f, pts[i * 2]!, pts[i * 2 + 1]!, pts[i * 2 + 2]!, pts[i * 2 + 3]!, 6, 14, seed + i * 3, w * 2.2, L.ink, 0.6 * a);
      this.jag(m.fl, pts[i * 2]!, pts[i * 2 + 1]!, pts[i * 2 + 2]!, pts[i * 2 + 3]!, 6, 14, seed + i * 3, w, L.hot, a);
      if (t < 0.03 && m.coolB <= 0) {
        const o = this.kit.o(pts[i * 2 + 2]!, pts[i * 2 + 3]!, spark(), L.hot);
        o.speed[0] = 60;
        o.speed[1] = 220;
        o.life[0] = 0.12;
        o.life[1] = 0.25;
        o.alignToVelocity = true;
        this.kit.emit(6);
      }
    }
  }

  /** A jagged line from a to b (deterministic for its seed: it flickers as the seed moves). */
  private jag(g: Graphics, ax: number, ay: number, bx: number, by: number, n: number, amp: number, seed: number, width: number, color: number, alpha: number): void {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    g.moveTo(ax, ay);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const off = (frac(seed * 0.618 + i * 0.414) - 0.5) * 2 * amp * Math.sin(t * Math.PI);
      g.lineTo(ax + dx * t + nx * off, ay + dy * t + ny * off);
    }
    g.lineTo(bx, by).stroke({ width, color, alpha, join: "round", cap: "round" });
  }

  private drawTide(m: Mech, dt: number): void {
    const pr = this.host.sig.proj;
    const L = m.look;
    const u = pr.unit();
    const bank = this.bank;
    const x0 = pr.sx(m.pos.x);
    const x1 = pr.sx(m.to.x);
    const yc = pr.sy((m.pos.y + m.to.y) / 2);
    const half = q(Math.max(10, m.radius) * pr.dy());
    const dir = x1 >= x0 ? 1 : -1;
    const water = m.ally ? 0x4a5466 : 0x1d4a55;
    const foamC = m.ally ? 0xfff1c9 : 0xd8f4ff;
    const k = this.presence(m, 0.3);
    if (k <= 0) return;
    const lo = Math.min(x0, x1);
    const span = q(Math.max(x0, x1) - lo);
    // The lane: dark water rising in it, flow lines marching the way the wave will go (built once
    // along the lane and slid by a seventh of it per beat).
    if (m.step === "warn" || m.step === "strike") {
      const w = m.step === "warn" ? Math.min(1, m.t / m.warn) : 1;
      this.piece(m, 0, 0).shared(bank, "rectFill", rectFill, span, half * 2, water, 1).at(lo, yc - half, 1, 1, 0, (0.1 + 0.14 * w) * k);
      const march = (m.age * 1.6) % 1;
      const len = q(x1 - x0);
      this.piece(m, 1, 1).shared(bank, "chevrons", chevrons, len, half, dir, q(u, 0.01), foamC).at(x0 + (len * march) / 7, yc, 1, 1, 0, k);
    } else {
      // Receding: a wet sheen along the lane.
      this.piece(m, 0, 0).shared(bank, "rectFill", rectFill, span, half * 2, water, 1).at(lo, yc - half, 1, 1, 0, 0.14 * k);
      this.piece(m, 2, 1).shared(bank, "rectFill", rectFill, span, q(half * 0.3), foamC, 1).at(lo, yc - half * 0.15, 1, 1, 0, 0.08 * k);
    }
    // The wall of water: rising at the lane's start in the warning, sweeping across in the strike.
    let front = x0;
    let rise = 0;
    if (m.step === "warn") rise = easeOutCubic(Math.min(1, m.t / m.warn)) * 0.7;
    else if (m.step === "strike") {
      const sweep = m.dur > 0 ? m.dur : 0.6;
      const t = Math.min(1, m.t / sweep);
      front = x0 + (x1 - x0) * easeOutCubic(t);
      rise = 1;
    } else {
      front = x1;
      rise = Math.max(0, 1 - m.t / (m.outro * 0.5));
    }
    if (rise <= 0.01) return;
    // A breaking wave, built at its height (in steps of a pixel and a half as it rises) and
    // carried across the lane by its position.
    const H = q(110 * pr.fs(m.pos.y) * rise, 1.5);
    const W = q(110 * u);
    const top = yc - half;
    // A shadow's wave runs through the army's own field: thinner, so the warrior shows through it.
    this.piece(m, 3, 2).own("wave", wave, H, W, half, dir, water, L.trim, m.ally ? 0.62 : 0.85).at(front, top, 1, 1, 0, k);
    // Foam on the crest and running down its face.
    this.piece(m, 4, 3).own("foam", foam, H, W, half, dir, foamC).at(front, top, 1, 1, 0, k);
    if (m.step === "strike" && dt > 0 && m.coolB <= 0) {
      m.coolB = 0.05;
      const o = this.kit.o(front, top - H * 0.8, softCircle(), foamC);
      o.speed[0] = 60;
      o.speed[1] = 200;
      o.angle[0] = dir === 1 ? -Math.PI * 0.5 : -Math.PI * 0.95;
      o.angle[1] = dir === 1 ? -Math.PI * 0.05 : -Math.PI * 0.5;
      o.gravity = 500;
      o.life[0] = 0.3;
      o.life[1] = 0.6;
      o.scale[0] = 0.15;
      o.scale[1] = 0.35;
      this.kit.emit(4);
    }
  }

  // ---- the Void Queen

  private drawWell(m: Mech, dt: number): void {
    const pr = this.host.sig.proj;
    const sig = this.host.sig;
    const L = m.look;
    const u = pr.unit();
    const bank = this.bank;
    const x = pr.sx(m.pos.x);
    const y = pr.sy(m.pos.y);
    const rx = q(m.radius * u);
    const ry = q(m.radius * pr.dy());
    const k = this.presence(m, 0.4);
    if (k <= 0) return;
    const open = m.step === "warn" ? easeOutCubic(Math.min(1, m.t / m.warn)) : 1;
    if (open <= 0.001) return;
    // The core that hurts: an ink disc with a violet rim (the telegraph's crimson rim sits over it).
    this.piece(m, 0, 0).shared(bank, "ellipseFill", ellipseFill, rx, ry, L.ink, 0.75).at(x, y, open, open, 0, k);
    this.piece(m, 1, 1).shared(bank, "wellRim", wellRim, rx, ry, L.main, L.hot).at(x, y, open, open, 0, k);
    // Spiral arms turning inward over the safe edge (the pull, which does not hurt), to about where
    // it reaches (the whole field for the queen's: drawn to a few cores out). The arms come back to
    // themselves every quarter turn: each of its 48 steps is built once and kept for the fight.
    const reach = Math.round(Math.min(2.4, Math.max(1.8, m.reach > 0 ? m.reach / Math.max(1, m.radius) : 2.2)) * 20) / 20;
    const spin = m.age * (m.step === "strike" ? 2.4 : 1.2);
    const steps = 48;
    const step = Math.floor((spin / (Math.PI / 2)) * steps) % steps;
    this.piece(m, 2, 1).shared(bank, "arms", arms, rx, ry, reach, step, steps, L.main).at(x, y, open, open, 0, k);
    this.piece(m, 3, 0).shared(bank, "ellipseLine", ellipseLine, q(rx * reach), q(ry * reach), 1, L.main, 0.18).at(x, y, open, open, 0, k);
    if (m.step !== "strike") return;
    // The pull: debris spirals in, the light smears toward the core, bodies lean.
    const kit = this.kit;
    m.coolB -= dt;
    if (m.coolB <= 0) {
      m.coolB = 0.35;
      kit.spiral(x, y - 4, rx * 2.2, 6, shard(), m.ally ? 0xd9cdb2 : 0x2a2433, false, 0.9, 7);
      if (kit.profile.secondary) kit.smear(x, y, rx * 2.4, ry / Math.max(1, rx), 6, L.main, 0.5);
    }
    if (this.reduced) return;
    this.leanM = m;
    this.leanR = m.reach > 0 ? m.reach : m.radius * reach * 1.15;
    this.leanReach = reach;
    if (m.ally) sig.each("enemy", this.lean);
    else {
      sig.each("ally", this.lean);
      this.lean(sig.playerId());
    }
    this.leanM = null;
  }

  /** A body in the current well's pull leans toward it (bound once: no closure per frame). */
  private readonly lean = (id: number): void => {
    const m = this.leanM;
    const sig = this.host.sig;
    if (!m || !sig.body(id, this.b2) || id === m.id) return;
    const dx = m.pos.x - this.b2.wx;
    const dy = m.pos.y - this.b2.wy;
    const d = Math.hypot(dx, dy);
    const R = this.leanR;
    if (d > R || d < 1) return;
    const f = (1 - d / R) * Math.min(1, m.t / 0.3);
    this.addMod(id, (dx / d) * 5 * this.b2.scale * f, 0, 1, 0.35 * f);
    this.host.mod(id).lean = dx >= 0 ? 1 : -1;
  };

  private drawCourt(m: Mech): void {
    const sig = this.host.sig;
    const L = m.look;
    const u = sig.proj.unit();
    const bank = this.bank;
    const k = this.presence(m, 0.3);
    if (k <= 0) return;
    const queen = sig.body(m.id, this.b);
    const qx = this.b.x;
    const qy = this.b.y - this.b.chestY;
    let live = 0;
    if (m.step === "warn") {
      // She calls: a sigil opens under her and rings go out to where they will kneel (the
      // simulation marks the spots on the ground).
      const w = Math.min(1, m.t / m.warn);
      if (queen) {
        const g = 0.6 + 0.4 * w;
        this.piece(m, 0, 1).shared(bank, "sigil", sigil, q(40 * this.b.scale), L.main, L.trim).at(this.b.x, this.b.y, g, g, 0, k);
        // The call going out, built at its size as it grows (a ring keeps its stroke).
        if (w < 0.999) this.piece(m, 1, 1).own("ellipseLine", ellipseLine, q(70 * u * w, 1.5), q(22 * u * w, 0.5), 1.4, L.main, 0.6).at(this.b.x, this.b.y, 1, 1, 0, (1 - w) * k);
      }
      return;
    }
    // The tethers: a chain of void from each courtier to her, beads running toward her. A tether
    // is rebuilt only when either end moves a pixel; the beads and sigils are only moved.
    let i = 7;
    for (const id of m.raised) {
      if (!sig.body(id, this.b2) || !queen) continue;
      const e = this.host.entity(id);
      if (!e || e.dead) continue;
      live += 1;
      const cx = this.b2.x;
      const cy = this.b2.y - this.b2.chestY;
      const mx = q((cx + qx) / 2 - cx, 1);
      const my = q(Math.max(cy, qy) + 18 * u - cy, 1);
      const ex = q(qx - cx, 1);
      const ey = q(qy - cy, 1);
      this.piece(m, i, 2).own("tether", tether, mx, my, ex, ey, 3.6, L.ink).at(cx, cy, 1, 1, 0, 0.7 * k);
      this.piece(m, i + 1, 3).own("tether", tether, mx, my, ex, ey, 1.4, L.main).at(cx, cy, 1, 1, 0, 0.95 * k);
      const br = q(2.4 * u, 0.1);
      const bead = m.ally ? 0xfff1c9 : L.trim;
      for (let j = 0; j < 3; j++) {
        const t = frac(m.age * 0.8 + j / 3);
        const bx = 2 * (1 - t) * t * mx + t * t * ex;
        const by = 2 * (1 - t) * t * my + t * t * ey;
        this.piece(m, i + 2 + j, 3).shared(bank, "disc", disc, br, bead, 1).at(cx + bx, cy + by, 1, 1, 0, k);
      }
      this.piece(m, i + 5, 1).shared(bank, "sigil", sigil, q(18 * this.b2.scale), L.main, L.trim).at(this.b2.x, this.b2.y, 1, 1, 0, 0.6 * k);
      i += 6;
    }
    // While any courtier lives, a ward shimmers on her: blows on her are softened.
    if (queen && live > 0) {
      const s = this.b.scale;
      const hh = this.b.height;
      const pulse = 0.7 + 0.3 * Math.sin(m.age * 5);
      const cy = this.b.y - hh * 0.5;
      this.piece(m, 0, 3).shared(bank, "ellipseLine", ellipseLine, q(hh * 0.32), q(hh * 0.55), 1.6, L.main, 0.55).at(this.b.x, cy, 1, 1, 0, k * pulse);
      const dr = q(1.6 * s, 0.1);
      for (let d = 0; d < 6; d++) {
        const a = m.age * 0.8 + (d / 6) * Math.PI * 2;
        this.piece(m, 1 + d, 3).shared(bank, "disc", disc, dr, L.hot, 0.8).at(this.b.x + Math.cos(a) * hh * 0.32, cy + Math.sin(a) * hh * 0.55, 1, 1, 0, k);
      }
    }
  }


  private eclipseLevel(m: Mech): number {
    const max = this.reduced ? ECLIPSE_REDUCED : ECLIPSE_MAX;
    if (m.step === "warn") return max * Math.min(1, m.t / Math.min(this.reduced ? 0.9 : 0.5, m.warn));
    if (m.step === "strike") return max;
    return max * Math.max(0, 1 - m.t / m.outro);
  }

  private drawEclipse(m: Mech): void {
    const pr = this.host.sig.proj;
    const L = m.look;
    const u = pr.unit();
    if (m.step !== "warn" || m.ally || m.radius > 300) return;
    // Whom she hunts in the dark: a bright ring under them, until her strike's mark is set on the
    // ground (its second warning; the simulation's telegraph, drawn bright over the dark).
    if (m.marked) return;
    const target = m.targets[0];
    if (target === undefined || !this.host.sig.body(target, this.b2)) return;
    const b = this.b2;
    const r = 26 * b.scale;
    const pulse = 0.7 + 0.3 * Math.sin(m.age * 9);
    m.gl.ellipse(b.x, b.y, r, r * 0.32).stroke({ width: 2, color: L.hot, alpha: 0.85 * pulse });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      m.gl.moveTo(b.x + Math.cos(a) * r * 1.15, b.y + Math.sin(a) * r * 0.37).lineTo(b.x + Math.cos(a) * r * 1.45, b.y + Math.sin(a) * r * 0.46);
    }
    m.gl.stroke({ width: 1.6, color: L.hot, alpha: 0.85 });
    void u;
  }

  /** The eclipse: the backdrop sinks, the field's wash deepens, the black sun hangs over it. */
  private applyDark(level: number, ally: boolean, real: number): void {
    const prev = this.dark;
    // Eased toward the wanted level so a new eclipse never snaps the light.
    const rate = this.reduced ? 2.5 : 6;
    this.dark = level > prev ? Math.min(level, prev + rate * real) : Math.max(level, prev - rate * 0.6 * real);
    if (this.dark < 0.004) this.dark = 0;
    this.darkAlly = ally;
    this.host.eclipse(this.dark, ECLIPSE_INK);
    if (this.dark <= 0) {
      if (this.darkP.g.visible) this.darkP.hide();
      if (this.sunP.g.visible) this.sunP.hide();
      return;
    }
    const pr = this.host.sig.proj;
    const l = pr.left();
    const r = pr.right();
    const t = pr.top();
    const w = r - l;
    // One sheet over the whole painted field and past it (the camera never leaves the field),
    // built once per canvas size.
    const cam = this.host.sig.camera;
    this.darkP.shared(this.bank, "sheet", sheet, q(cam.width, 8), q(cam.height, 8), ECLIPSE_INK).at(0, 0, 1, 1, 0, 0.5 * this.dark);
    // The black sun: an ink disc ringed in a corona, high over the field (built at one size and
    // scaled with the view).
    const R = w * 0.08;
    const cor = this.darkAlly ? 0xfff1c9 : 0xd8c4ff;
    this.sunP.shared(this.bank, "blackSun", blackSun, 40, cor).at((l + r) / 2 + w * 0.18, t + w * 0.16, R / 40, R / 40, 0, this.dark);
  }


  /** Bodies: the dark on the field, the images' glass, the rods hidden, the courtiers kneeling. */
  private dressBodies(): void {
    const sig = this.host.sig;
    const d = this.dark;
    if (d > 0) {
      // Foes in the dark sink with it; the warrior keeps a rim of light, his army a pale glow at its
      // back (always readable). A white copy of every soldier doubled what the army cost to draw
      // for as long as the dark lasted; one soft sprite each costs next to nothing.
      sig.each("enemy", this.sink);
      this.glows = 0;
      sig.each("ally", this.glow);
      this.lit(sig.playerId());
      // The Queen in her own eclipse withdraws into the dark.
      for (const m of this.mechs) if (m.mech === "void_eclipse" && !m.ally && m.step !== "end") this.addMod(m.id, 0, 0, 1 - 0.6 * d, 0);
    }
    for (let i = d > 0 ? this.glows : 0; i < this.glowPool.length; i++) {
      const g = this.glowPool[i]!;
      if (g.visible) g.visible = false;
    }
    for (const [id, dr] of this.dressed) {
      const e = this.host.entity(id);
      if (!e) {
        this.dressed.delete(id);
        this.shattered.delete(id);
        continue;
      }
      if (dr.kind === "rod") {
        // A rod is drawn as a rod (its figure never shows), standing or fallen.
        this.addMod(id, 0, 0, 0, 0);
        continue;
      }
      if (e.dead) continue;
      if (dr.kind === "image") {
        const md = this.host.mod(id);
        md.tint = dr.ally ? 0xf3dc9a : 0xdfe8ff;
        md.tintK = Math.max(md.tintK, 0.5);
        md.white = Math.max(md.white, 0.12 + 0.08 * Math.sin(this.now * 6 + id));
        this.addMod(id, 0, 0, 0.82, 0);
      } else if (dr.kind === "courtier") {
        if (e.state === "idle") this.host.mod(id).kneel = true;
      }
    }
  }

  /** A foe sinks into the eclipse's dark (bound once: no closure per frame). */
  private readonly sink = (id: number): void => {
    const md = this.host.mod(id);
    md.tint = mix(md.tintK > 0 ? md.tint : 0xffffff, 0x1a1226, 1);
    md.tintK = Math.max(md.tintK, 0.55 * this.dark);
  };

  /** The army's glows in the dark (kept for reuse), and how many show this frame. */
  private readonly glowPool: Sprite[] = [];
  private glows = 0;

  /** A soldier of the army keeps a pale glow at its back in the dark (bound once). */
  private readonly glow = (id: number): void => {
    if (!this.host.sig.body(id, this.b2)) return;
    let s = this.glowPool[this.glows];
    if (!s) {
      s = new Sprite(softCircle());
      s.anchor.set(0.5);
      s.blendMode = "add";
      s.tint = 0xe4ddf2;
      this.host.layers.ground.addChild(s);
      this.glowPool.push(s);
    }
    this.glows += 1;
    const b = this.b2;
    s.visible = true;
    s.position.set(b.x, b.y - b.height * 0.48);
    s.scale.set((b.height * 0.62) / 64, (b.height * 1.15) / 64);
    s.alpha = 0.34 * this.dark;
  };

  /** The warrior keeps a rim of light in it. */
  private readonly lit = (id: number): void => {
    const md = this.host.mod(id);
    md.white = Math.max(md.white, 0.14 * this.dark);
  };

  // ------------------------------------------------------------------ body modifiers

  /** Add my share of a body's offset, alpha and stretch (taken back next frame). */
  private addMod(id: number, dx: number, dy: number, alpha: number, stretch: number): void {
    const md = this.host.mod(id);
    let mine = this.myMods.get(id);
    if (!mine) {
      mine = this.modPool.pop() ?? { dx: 0, dy: 0, alpha: 1, stretch: 0 };
      mine.dx = 0;
      mine.dy = 0;
      mine.alpha = 1;
      mine.stretch = 0;
      this.myMods.set(id, mine);
    }
    md.dx += dx;
    md.dy += dy;
    md.stretch += stretch;
    md.alpha *= alpha;
    mine.dx += dx;
    mine.dy += dy;
    mine.stretch += stretch;
    mine.alpha *= alpha;
    this.touched.add(id);
  }

  private restoreMods(): void {
    for (const [id, mine] of this.myMods) {
      const md = this.host.mod(id);
      md.dx -= mine.dx;
      md.dy -= mine.dy;
      md.stretch -= mine.stretch;
      md.alpha = mine.alpha > 0.001 ? md.alpha / mine.alpha : 1;
      if (Math.abs(md.dx) < 1e-6) md.dx = 0;
      if (Math.abs(md.dy) < 1e-6) md.dy = 0;
      if (Math.abs(md.stretch) < 1e-6) {
        md.stretch = 0;
        md.lean = 0;
      }
      if (Math.abs(md.alpha - 1) < 1e-6) md.alpha = 1;
      this.modPool.push(mine);
    }
    this.myMods.clear();
    this.touched.clear();
  }

  private shakeOnce(amount: number): void {
    if (this.now - this.shakeAt < 0.45) return;
    this.shakeAt = this.now;
    this.kit.shake(amount);
  }

  private glassBurst(x: number, y: number, L: SovLook, n: number): void {
    const kit = this.kit;
    const o = kit.o(x, y, shard(), L.main);
    o.speed[0] = 80;
    o.speed[1] = 260;
    o.life[0] = 0.35;
    o.life[1] = 0.7;
    o.scale[0] = 0.25;
    o.scale[1] = 0.6;
    o.gravity = 380;
    o.spin = 10;
    o.additive = false;
    o.colors = [L.main, L.hot, L.trim];
    kit.emit(n);
    o.colors = undefined;
    kit.ring(x, y, 4, 30 * this.host.sig.proj.unit(), 0.3, -1, L.hot, 2, { ground: false, squash: 1 });
  }

  /** A new fight: everything is dropped. */
  reset(): void {
    for (const m of this.mechs.slice()) this.drop(m);
    this.mechs.length = 0;
    this.restoreMods();
    this.dressed.clear();
    this.shattered.clear();
    this.named.clear();
    this.dark = 0;
    this.darkP.reset();
    this.sunP.reset();
    // The shapes of the old fight go with it (a new arena, other sizes).
    this.bank.clear();
    this.host.eclipse(0, ECLIPSE_INK);
    this.host.focus(0, false, this.focusIds);
  }

  destroy(): void {
    this.reset();
    this.darkP.destroy();
    this.sunP.destroy();
    this.pool.destroy();
    for (const g of this.glowPool) g.destroy();
    this.glowPool.length = 0;
  }
}

function frac(v: number): number {
  return v - Math.floor(v);
}

function clearIf(g: Graphics): void {
  if (g.context.instructions.length > 0) g.clear();
}

void lighten;
