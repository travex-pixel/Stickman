import { Container, Graphics, GraphicsContext } from "pixi.js";
import type { GameEvent } from "../../engine/events";
import { signatureDef, SIGNATURES, type SignatureId, type SignatureStatus, type SynergyId, type VisualQuality } from "../../data/signatures";
import { fmtNum, type NumberStyle } from "../DamageNumbers";
import { blankMod, type BodyMod, type SigBody, type SigHost } from "./host";
import { SigKit } from "./kit";
import { CRIMSON, GILT, GILT_HOT, sigPalette } from "./palette";
import { FrameGovernor, fxProfile, type FxProfile } from "./quality";
import { Stage, type SigCastEvent, type StageServices } from "./stage";
import { Dragon, clearDragonCache, type DragonLook } from "./skills/dragon";
import { VoidStage } from "./skills/void";
import { DevourerStage } from "./skills/devourer";
import { ParadeStage } from "./skills/parade";
import { JudgementStage } from "./skills/judgement";
import { LegionStage } from "./skills/legion";
import { TimeStage } from "./skills/time";
import { StormStage } from "./skills/storm";
import { SovereignStage } from "./skills/sovereign";
import { SynergyStage } from "./skills/synergy";

type StageCtor = new (...a: ConstructorParameters<typeof Stage>) => Stage;

const STAGES: Record<SignatureId, StageCtor> = {
  void_collapse: VoidStage,
  abyssal_devourer: DevourerStage,
  death_parade: ParadeStage,
  kings_judgement: JudgementStage,
  legion_awakening: LegionStage,
  time_fracture: TimeStage,
  shadow_storm: StormStage,
  sovereign_awakening: SovereignStage,
};

/** Bodies wearing signature marks at once (more are not drawn). */
export const MAX_MARKED = 40;
/** Casts staged at once, at most, whatever the quality (past this a cast shows only its figures). */
export const HARD_STAGE_CAP = 10;
/** Real seconds within which a cast's repeated hits on one body fold into one figure. */
const FIGURE_MERGE = 0.5;

interface MarkRec {
  id: number;
  void: number;
  shadow: number;
  trapped: number;
  frozen: number;
  slowed: number;
  /** Graphics showing the marks (shared shapes), created on demand. */
  voidG: Graphics | null;
  shadowG: Graphics | null;
  cageG: Graphics | null;
  clockG: Graphics | null;
  glassG: Graphics | null;
  age: number;
}

interface FigureRec {
  castId: number;
  id: number;
  t: number;
  handle: number;
  sum: number;
  count: number;
}

const SHAPES = new Map<string, GraphicsContext>();

/** The marks' shapes, drawn once (unit size: about 10 px across). */
function shape(kind: "void" | "shadow" | "cage" | "clock" | "glass", gilded: boolean): GraphicsContext {
  const key = `${kind}|${gilded}`;
  const hit = SHAPES.get(key);
  if (hit && !hit.destroyed) return hit;
  const g = new GraphicsContext();
  const light = gilded ? GILT_HOT : 0xece4ff;
  switch (kind) {
    case "void":
      // A small singularity glyph: an ink disc ringed in violet with four ticks.
      g.circle(0, 0, 6).fill({ color: 0x07060b, alpha: 0.95 });
      g.circle(0, 0, 6).stroke({ width: 1.6, color: 0x8f6fd8, alpha: 1 });
      g.circle(0, 0, 2).fill({ color: light, alpha: 1 });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        g.moveTo(Math.cos(a) * 8, Math.sin(a) * 8).lineTo(Math.cos(a) * 11, Math.sin(a) * 11);
      }
      g.stroke({ width: 1.4, color: 0x8f6fd8, alpha: 0.9 });
      break;
    case "shadow":
      // Two crossed shadow blades with white edges.
      for (const s of [1, -1]) {
        g.poly([-9 * s, -9, -7 * s, -10, 9 * s, 8, 8 * s, 10]).fill({ color: 0x4a3a78, alpha: 1 });
        g.moveTo(-8 * s, -9.6).lineTo(9 * s, 8.4).stroke({ width: 0.9, color: light, alpha: 0.95 });
      }
      break;
    case "cage":
      // A ring held at the feet, with bars rising (squashed by the caller).
      g.circle(0, 0, 20).stroke({ width: 2.2, color: 0x5b3f8c, alpha: 0.9 });
      g.circle(0, 0, 20).stroke({ width: 0.8, color: light, alpha: 0.9 });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.circle(Math.cos(a) * 20, Math.sin(a) * 20, 1.6).fill({ color: light, alpha: 1 });
      }
      break;
    case "clock":
      // Tick marks of a slow clock under the feet.
      g.circle(0, 0, 20).stroke({ width: 1, color: 0x3f6fd8, alpha: 0.8 });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        g.moveTo(Math.cos(a) * 16, Math.sin(a) * 16).lineTo(Math.cos(a) * 20, Math.sin(a) * 20);
      }
      g.stroke({ width: 1.2, color: 0xd8dde8, alpha: 0.9 });
      g.moveTo(0, 0).lineTo(0, -14).stroke({ width: 1.4, color: 0xffffff, alpha: 0.9 });
      break;
    case "glass":
      // Facets of glass round a frozen body (a few pale shards and glints).
      g.poly([-14, -36, -10, -48, -6, -34]).fill({ color: 0xd8e6ff, alpha: 0.5 });
      g.poly([12, -20, 18, -30, 15, -16]).fill({ color: 0xd8e6ff, alpha: 0.45 });
      g.poly([-16, -10, -22, -18, -12, -14]).fill({ color: 0xd8e6ff, alpha: 0.4 });
      g.moveTo(-14, -36).lineTo(-10, -48).moveTo(12, -20).lineTo(18, -30).stroke({ width: 1, color: 0xffffff, alpha: 0.9 });
      break;
  }
  SHAPES.set(key, g);
  return g;
}

/**
 * The signature skills' presentation, driven by the simulation's `sig_*` events (and `hit.sig` for
 * the figures). Each cast becomes a Stage that stages the beats as they arrive; marks on bodies
 * follow `sig_status`; combinations get their moment from `sig_synergy`. The same director runs on
 * the live fight and on the preview's stand-ins (a different host). It never writes to a world.
 *
 * Caps: casts staged in full at once (by quality), cinematic casts at once (two, or one in
 * performance); past them a cast gets its compact form, and past HARD_STAGE_CAP only its figures.
 * Marked bodies, sprites, rigs, rings and streaks are pooled and capped in the kit.
 */
export class SignatureDirector {
  readonly kit: SigKit;
  readonly mods = new Map<number, BodyMod>();
  private readonly stages: Stage[] = [];
  private readonly byCast = new Map<number, Stage>();
  private readonly marks = new Map<number, MarkRec>();
  private readonly marksLayer = new Container();
  private readonly figures: FigureRec[] = [];
  private readonly dragons: Dragon[] = [];
  private readonly named = new Set<string>();
  private readonly svc: StageServices;
  private readonly tmp: SigBody = { x: 0, y: 0, chestY: 0, height: 0, scale: 1, wx: 0, wy: 0, facing: 1, boss: false, ally: false, player: false, rig: null };
  readonly governor = new FrameGovernor();
  private quality: VisualQuality = "full";
  private reduced = false;
  private now = 0;
  private painted = false;
  /** Counters for diagnostics and tests. */
  readonly counters = { casts: 0, compact: 0, dropped: 0, beats: 0, synergies: 0, stepDowns: 0 };

  constructor(
    readonly host: SigHost,
    /** The preview's director: no figures are merged with the live ones, no governor. */
    readonly preview = false,
  ) {
    this.kit = new SigKit(host, fxProfile("full", host.isReduced()));
    host.layers.fx.addChild(this.marksLayer);
    this.svc = {
      mod: (id) => this.mod(id),
      consumed: 0,
      label: (text, x, y, color) => this.label(text, x, y, color),
      hasMark: (id) => {
        const m = this.marks.get(id);
        return !!m && m.void + m.shadow + m.trapped + m.slowed > 0;
      },
      dragon: (look) => this.dragon(look),
      freeDragon: (d) => this.freeDragon(d),
    };
    this.governor.enabled = !preview;
  }

  get profile(): FxProfile {
    return this.kit.profile;
  }

  /** The player's choice (Settings). Resets the automatic step-down. */
  setQuality(q: VisualQuality): void {
    this.quality = q;
    this.governor.choose(q);
    this.applyProfile();
  }

  setReduced(v: boolean): void {
    this.reduced = v;
    this.applyProfile();
  }

  private applyProfile(): void {
    this.kit.profile = fxProfile(this.governor.current, this.reduced);
  }

  /** The tier actually drawn (after any automatic step-down). */
  get drawnQuality(): VisualQuality {
    return this.governor.current;
  }

  mod(id: number): BodyMod {
    let m = this.mods.get(id);
    if (!m) {
      m = blankMod();
      this.mods.set(id, m);
    }
    return m;
  }

  private label(text: string, x: number, y: number, color: number): void {
    if (this.named.has(text)) return;
    this.named.add(text);
    this.host.numbers()?.spawn(x, y, text, color, "word");
  }

  private dragon(look: DragonLook): Dragon | null {
    for (const d of this.dragons) {
      if (!d.inUse) {
        d.inUse = true;
        d.restyle(look);
        this.host.layers.fx.addChild(d.root);
        return d;
      }
    }
    if (this.dragons.length >= 2) return null;
    const d = new Dragon(look);
    d.inUse = true;
    this.dragons.push(d);
    this.host.layers.fx.addChild(d.root);
    return d;
  }

  private freeDragon(d: Dragon): void {
    d.inUse = false;
    d.hide();
    d.root.removeFromParent();
  }

  // ------------------------------------------------------------------ events

  /** One batch of events (the simulation's, or the synthetic driver's). */
  handle(events: readonly GameEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case "sig_cast":
          this.onCast(e);
          break;
        case "sig_beat": {
          this.counters.beats += 1;
          const s = this.byCast.get(e.castId);
          if (s && !s.ended) s.onBeat(e);
          break;
        }
        case "sig_end": {
          const s = this.byCast.get(e.castId);
          if (s) s.onEnd(e.interrupted);
          break;
        }
        case "sig_status":
          this.onStatus(e.targetId, e.status, e.on, e.duration);
          break;
        case "sig_synergy": {
          this.counters.synergies += 1;
          const s = this.byCast.get(e.castId);
          if (s) s.onSynergy(e);
          this.synergyMoment(e, s);
          break;
        }
        case "hit":
          if (e.sig) {
            const s = this.byCast.size > 0 ? this.stageFor(e.sig) : undefined;
            s?.onHit(e);
          }
          break;
        case "death":
          for (const s of this.stages) s.onDeath(e.id, e.pos.x, e.pos.y);
          this.dropMarks(e.id);
          break;
        default:
          break;
      }
    }
  }

  private stageFor(sig: SignatureId): Stage | undefined {
    for (let i = this.stages.length - 1; i >= 0; i--) if (this.stages[i]!.sig === sig) return this.stages[i];
    return undefined;
  }

  private onCast(e: SigCastEvent): void {
    this.counters.casts += 1;
    const prev = this.byCast.get(e.castId);
    if (prev) this.drop(prev);
    if (this.stages.length >= HARD_STAGE_CAP) {
      this.counters.dropped += 1;
      return;
    }
    const p = this.profile;
    const cinematic = signatureDef(e.sig).cinematic;
    let live = 0;
    let cin = 0;
    for (const s of this.stages) {
      if (s.ended) continue;
      live += 1;
      if (s.cinematic) cin += 1;
    }
    const compact = live >= p.maxLive || (cinematic && cin >= p.maxCinematic);
    if (compact) this.counters.compact += 1;
    const Ctor = STAGES[e.sig];
    const stage = new Ctor(this.kit, this.host, this.svc, sigPalette(e.sig, e.mastery), e, compact);
    this.stages.push(stage);
    this.byCast.set(e.castId, stage);
  }

  /** A combination's own moment (on top of what its cast's stage does with it). */
  private synergyMoment(e: Extract<GameEvent, { type: "sig_synergy" }>, owner: Stage | undefined): void {
    // Combinations without a stage of their own on the field get one (the frozen singularity fires a
    // collapse even when Void Collapse is cooling down; a crowned ultimate may crown the Fury).
    // Frozen Singularity and Legion Meteor arrive as beats of their owner's cast (Time Fracture's
    // pull and implode, King's Judgement's charges); the crowned ultimate may crown the Fury, which
    // has no stage of its own.
    if (e.synergy === "crowned_ultimate") {
      if (this.stages.length >= HARD_STAGE_CAP) return;
      const fake: SigCastEvent = { type: "sig_cast", castId: -1 - this.counters.synergies, sig: synergyOwner(e.synergy), evo: null, mastery: owner?.mastery ?? 1, rank: 1, casterId: this.host.playerId(), origin: e.pos, center: e.pos, radius: 60, targetIds: e.targetIds, windup: 0, length: 1.2, boss: false, enhanced: e.synergy === "crowned_ultimate" };
      const st = new SynergyStage(this.kit, this.host, this.svc, sigPalette(fake.sig, fake.mastery), fake, this.liveCount() >= this.profile.maxLive, e);
      this.stages.push(st);
    }
    const name = SYNERGY_NAME[e.synergy];
    if (name && e.synergy === "crowned_ultimate") {
      const pr = this.host.proj;
      this.label(name, pr.sx(e.pos.x), pr.sy(e.pos.y) - 130 * pr.unit(), SYNERGY_COLOR[e.synergy]);
    }
  }

  private liveCount(): number {
    let n = 0;
    for (const s of this.stages) if (!s.ended) n++;
    return n;
  }

  private onStatus(id: number, status: SignatureStatus, on: boolean, duration: number): void {
    let m = this.marks.get(id);
    if (!m) {
      if (!on || this.marks.size >= MAX_MARKED) return;
      m = { id, void: 0, shadow: 0, trapped: 0, frozen: 0, slowed: 0, voidG: null, shadowG: null, cageG: null, clockG: null, glassG: null, age: 0 };
      this.marks.set(id, m);
    }
    // A status without a duration lasts until it is taken off (an hour stands for "until off").
    const left = on ? (duration > 0 ? duration : 3600) : 0;
    switch (status) {
      case "void_mark":
        m.void = left;
        break;
      case "shadow_mark":
        m.shadow = left;
        break;
      case "trapped":
        m.trapped = left;
        break;
      case "frozen":
        m.frozen = left;
        break;
      case "slowed":
        m.slowed = left;
        break;
    }
  }

  private dropMarks(id: number): void {
    const m = this.marks.get(id);
    if (!m) return;
    for (const g of [m.voidG, m.shadowG, m.cageG, m.clockG, m.glassG]) g?.destroy();
    this.marks.delete(id);
  }

  // ------------------------------------------------------------------ figures

  /**
   * A signature hit's figure in the skill's colour. A cast's repeated hits on one body (a dragon's
   * pass, a storm of blades) fold into one figure with a small "×n". Returns false when there is no
   * numbers pool.
   */
  figure(e: Extract<GameEvent, { type: "hit" }>, x: number, y: number, halfW: number, dir: number): boolean {
    const nums = this.host.numbers();
    if (!nums || !e.sig) return false;
    const stage = this.stageFor(e.sig);
    const pal = sigPalette(e.sig, stage?.mastery ?? 1);
    const castId = stage?.castId ?? -1;
    const now = this.now;
    for (const f of this.figures) {
      if (f.castId === castId && f.id === e.targetId && now - f.t < FIGURE_MERGE) {
        f.sum += e.amount;
        f.count += 1;
        f.t = now;
        if (nums.amend(f.handle, fmtNum(f.sum), `×${f.count}`, pal.glow === GILT ? GILT : 0xe8e2f2)) return true;
        break;
      }
    }
    const style: NumberStyle = e.crit || e.heavy ? "crit" : "normal";
    const handle = nums.hit(x, y, halfW, dir, fmtNum(e.amount), pal.number, style, true);
    let slot = this.figures[0];
    for (const f of this.figures) if (!slot || f.t < slot.t) slot = f;
    if (this.figures.length < 12) {
      this.figures.push({ castId, id: e.targetId, t: now, handle, sum: e.amount, count: 1 });
    } else if (slot) {
      slot.castId = castId;
      slot.id = e.targetId;
      slot.t = now;
      slot.handle = handle;
      slot.sum = e.amount;
      slot.count = 1;
    }
    return true;
  }

  // ------------------------------------------------------------------ frame

  /**
   * Advance: `dt` world seconds for the casts (scaled with the fight's own time, zero in a stop),
   * `real` real seconds for fades.
   */
  update(dt: number, real: number): void {
    this.now += real;
    // Transient body modifiers are recomputed every frame; offsets and alpha belong to their stage.
    for (const m of this.mods.values()) {
      m.tint = 0xffffff;
      m.tintK = 0;
      m.white = 0;
      m.frozen = false;
      m.kneel = false;
    }
    this.kit.update(dt, real);
    for (let i = this.stages.length - 1; i >= 0; i--) {
      const s = this.stages[i]!;
      s.tick(dt, real);
      if (s.finished) this.drop(s);
    }
    this.updateMarks(dt, real);
    // Geometry: redrawn only while something lives; an idle frame clears it once.
    const any = this.stages.length > 0 || this.kit.beginPaint();
    if (any) {
      this.kit.clearPaint();
      this.kit.paint(dt);
      for (const s of this.stages) s.paint();
      this.painted = true;
    } else if (this.painted) {
      this.kit.clearPaint();
      this.painted = false;
    }
    // Drop neutral modifiers (after the host has applied their neutral values once).
    for (const [id, m] of this.mods) {
      if (m.dx === 0 && m.dy === 0 && m.stretch === 0 && m.alpha === 1 && m.tintK === 0 && m.white === 0 && !m.frozen && !m.kneel) {
        if (m.lean === 0) this.mods.delete(id);
        else m.lean = 0;
      }
    }
    if (!this.preview && this.governor.frame(real, this.busy)) {
      this.counters.stepDowns += 1;
      this.applyProfile();
    }
  }

  private drop(s: Stage): void {
    s.dispose();
    const i = this.stages.indexOf(s);
    if (i >= 0) this.stages.splice(i, 1);
    if (this.byCast.get(s.castId) === s) this.byCast.delete(s.castId);
  }

  private updateMarks(dt: number, real: number): void {
    const b = this.tmp;
    for (const [id, m] of this.marks) {
      m.void = Math.max(0, m.void - dt);
      m.shadow = Math.max(0, m.shadow - dt);
      m.trapped = Math.max(0, m.trapped - dt);
      m.frozen = Math.max(0, m.frozen - dt);
      m.slowed = Math.max(0, m.slowed - dt);
      m.age += real;
      const alive = this.host.body(id, b);
      if (!alive || m.void + m.shadow + m.trapped + m.frozen + m.slowed <= 0) {
        this.dropMarks(id);
        continue;
      }
      const u = this.host.proj.unit();
      const s = Math.max(0.8, b.scale) * 0.9;
      const headY = b.y - b.height - 8 * u;
      const both = m.void > 0 && m.shadow > 0;
      m.voidG = this.markG(m.voidG, m.void > 0, "void");
      if (m.voidG) {
        m.voidG.position.set(b.x - (both ? 9 * s : 0), headY);
        m.voidG.scale.set(s);
        m.voidG.rotation = m.age * 1.2;
        m.voidG.alpha = Math.min(1, m.void * 2) * (0.85 + 0.15 * Math.sin(m.age * 5));
      }
      m.shadowG = this.markG(m.shadowG, m.shadow > 0, "shadow");
      if (m.shadowG) {
        m.shadowG.position.set(b.x + (both ? 9 * s : 0), headY);
        m.shadowG.scale.set(s * 0.8);
        m.shadowG.alpha = Math.min(1, m.shadow * 2);
      }
      const squash = Math.min(0.6, Math.max(0.25, this.host.proj.dy() / u));
      m.cageG = this.markG(m.cageG, m.trapped > 0, "cage");
      if (m.cageG) {
        m.cageG.position.set(b.x, b.y);
        m.cageG.scale.set(s * 1.1, s * 1.1 * squash);
        m.cageG.alpha = Math.min(1, m.trapped * 3);
        const md = this.mod(id);
        md.tint = 0x8f6fd8;
        md.tintK = Math.max(md.tintK, 0.25);
      }
      m.clockG = this.markG(m.clockG, m.slowed > 0, "clock");
      if (m.clockG) {
        m.clockG.position.set(b.x, b.y);
        m.clockG.scale.set(s * 1.5, s * 1.5 * squash);
        m.clockG.alpha = Math.min(1, m.slowed * 3) * 0.9;
        const md = this.mod(id);
        md.tint = 0x9fb2d8;
        md.tintK = Math.max(md.tintK, 0.3);
      }
      m.glassG = this.markG(m.glassG, m.frozen > 0, "glass");
      if (m.glassG) {
        m.glassG.position.set(b.x, b.y);
        m.glassG.scale.set(s);
        m.glassG.alpha = Math.min(1, m.frozen * 4);
        const md = this.mod(id);
        // Glass: the body goes pale (its white copy at half strength) and cold, held mid-motion.
        md.tint = 0xb8c8e4;
        md.tintK = Math.max(md.tintK, 0.75);
        md.white = Math.max(md.white, 0.5);
        md.frozen = true;
      }
    }
  }

  private markG(g: Graphics | null, on: boolean, kind: "void" | "shadow" | "cage" | "clock" | "glass"): Graphics | null {
    if (!on) {
      if (g) g.destroy();
      return null;
    }
    if (g) return g;
    const n = new Graphics(shape(kind, false));
    if (kind === "cage" || kind === "clock") this.host.layers.ground.addChild(n);
    else this.marksLayer.addChild(n);
    return n;
  }

  /** Signature effects on screen this frame (casts, marks, the kit's own). */
  get busy(): boolean {
    return this.stages.length > 0 || this.marks.size > 0 || this.kit.busy;
  }

  get liveStages(): number {
    return this.stages.length;
  }

  get markedBodies(): number {
    return this.marks.size;
  }

  /** Diagnostics. */
  stats(): { stages: number; cinematic: number; marked: number; sprites: number; rigs: number; dragons: number; quality: VisualQuality; chosen: VisualQuality; stepDowns: number; reason: string } {
    let cin = 0;
    for (const s of this.stages) if (s.cinematic && !s.ended) cin++;
    return { stages: this.stages.length, cinematic: cin, marked: this.marks.size, sprites: this.kit.spritesLent, rigs: this.kit.rigsLive, dragons: this.dragons.filter((d) => d.inUse).length, quality: this.governor.current, chosen: this.quality, stepDowns: this.governor.steps, reason: this.governor.reason };
  }

  /** A new world (or the preview closing): every cast, mark and modifier is dropped. */
  reset(): void {
    for (const s of this.stages.slice()) this.drop(s);
    this.stages.length = 0;
    this.byCast.clear();
    for (const id of [...this.marks.keys()]) this.dropMarks(id);
    this.mods.clear();
    this.figures.length = 0;
    this.named.clear();
    this.svc.consumed = 0;
    this.kit.reset();
    this.painted = false;
  }

  destroy(): void {
    this.reset();
    for (const d of this.dragons) d.destroy();
    this.dragons.length = 0;
    this.kit.destroy();
    this.marksLayer.destroy({ children: true });
  }
}

/** Release shapes shared by every director (the renderer calls it when it unmounts). */
export function clearSignatureShapes(): void {
  for (const c of SHAPES.values()) c.destroy();
  SHAPES.clear();
  clearDragonCache();
}

function synergyOwner(s: SynergyId): SignatureId {
  switch (s) {
    case "frozen_singularity":
      return "void_collapse";
    case "legion_meteor":
      return "legion_awakening";
    case "crowned_ultimate":
      return "sovereign_awakening";
    case "gravity_feast":
      return "abyssal_devourer";
    case "hunters_parade":
      return "death_parade";
    case "blade_parade":
      return "shadow_storm";
  }
}

const SYNERGY_NAME: Record<SynergyId, string> = {
  gravity_feast: "Gravity Feast",
  hunters_parade: "Hunter's Parade",
  legion_meteor: "Legion Meteor",
  frozen_singularity: "Frozen Singularity",
  blade_parade: "Blade Parade",
  crowned_ultimate: "Crowned",
};

const SYNERGY_COLOR: Record<SynergyId, number> = {
  gravity_feast: 0xe8c0ff,
  hunters_parade: 0xf0b8a8,
  legion_meteor: 0xeedba0,
  frozen_singularity: 0xd4e4ff,
  blade_parade: 0xd8ccff,
  crowned_ultimate: GILT,
};

void CRIMSON;
void SIGNATURES;
