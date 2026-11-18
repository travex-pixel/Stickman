import { Container, Graphics } from "pixi.js";
import type { GameEvent } from "../../engine/events";
import type { Vec2 } from "../../engine/math";
import { SIGNATURES, signatureDef, type EvolutionId, type MasteryTier, type SignatureId, type SynergyId, type VisualQuality } from "../../data/signatures";
import { Camera, type Box } from "../Camera";
import { ParticleSystem } from "../Particles";
import { DEATH_KNEEL, Rig, type RigSpec } from "../rigs/Rig";
import { enemySpec, summonSpec } from "../rigs/specs";
import { easeInOutSine, easeOutBack, easeOutCubic } from "../anim/ease";
import { mix } from "../colors";
import type { SigBody, SigHost, SigLayers, SigProjection } from "./host";
import { SignatureDirector } from "./SignatureDirector";
import { buildScript, SigDriver, type SigActor } from "./driver";
import { basePalette, GILT, GILT_HOT } from "./palette";

/**
 * The preview sandbox: the signature director's own code playing on stand-in figures, on the
 * battlefield canvas above the live fight (which is dimmed behind it). It deals nothing and writes
 * nothing to the world: the events come from the synthetic driver, the bodies are the sandbox's own
 * rigs. One preview at a time; asking again restarts it. The reveal moment (a skill found) plays
 * here too: the screen darkens, the skill's sigil forms, then its animation plays.
 *
 * Laid out like the battlefield: the same arena (640 by 150 world units) mapped across the canvas,
 * framed by a camera of its own (so a push-in or a shake in a preview moves only the preview).
 */
const ARENA_W = 640;
const ARENA_D = 150;
const CHEST = 50;
const FIGURE_SCALE = 1.62;

interface StandIn {
  id: number;
  wx: number;
  wy: number;
  rig: Rig;
  kind: "player" | "enemy" | "ally";
  facing: 1 | -1;
  /** Hit reaction: white flash and a flinch, decaying. */
  flash: number;
  flinch: number;
  /** Scripted motion (a pull toward a point, a blink): from, to, over [t0, t1] sandbox seconds. */
  move: { fx: number; fy: number; tx: number; ty: number; t0: number; t1: number } | null;
  /** Drawn place (base px). */
  x: number;
  y: number;
  /** A soldier waiting to rise (hidden), or rising (seconds since the rise; -1 standing). */
  hidden: boolean;
  emerge: number;
}

export interface PreviewOptions {
  mastery?: MasteryTier;
  /** A combination to show in the preview (its partner is staged with it where it needs one). */
  synergy?: SynergyId;
  enhanced?: boolean;
  /** Keep the preview up after the animation (the reveal holds it until closed). */
  hold?: boolean;
}

/** What the reveal tells the interface: when to show the name, when the details, and its length. */
export interface RevealTiming {
  /** Real seconds from the start to the name and rarity. */
  nameAt: number;
  /** When the description and the three evolution paths may show. */
  detailsAt: number;
  /** When the moment has played out (the sheet may offer Equip / Later from here; it can be earlier on skip). */
  length: number;
  /** The full rite (legendary, mythic) or the short one (rare, epic). */
  full: boolean;
}

export class Sandbox {
  readonly root = new Container();
  private readonly dim = new Graphics();
  private readonly stage = new Container();
  private readonly ground = new Container();
  private readonly figures = new Container();
  private readonly fx = new Container();
  private readonly sigilG = new Graphics();
  readonly particles = new ParticleSystem(300);
  readonly camera = new Camera();
  private readonly director: SignatureDirector;
  private readonly driver: SigDriver;
  private readonly actors: StandIn[] = [];
  private width = 360;
  private height = 640;
  private groundTop = 200;
  private groundBottom = 500;
  private time = 0;
  private stopLeft = 0;
  private dimK = 0;
  private dimTarget = 0;
  private closeAt = Infinity;
  private active = false;
  private reduced = false;
  /** The reveal: its skill, its clock, and when the animation starts. */
  private reveal: { id: SignatureId; t: number; timing: RevealTiming; animAt: number; started: boolean } | null = null;
  private readonly box: Box = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  private nextId = 1;
  private readonly heroSpec: () => RigSpec;

  constructor(
    heroSpec: () => RigSpec,
    private readonly flash: (color: number, alpha: number, duration: number) => boolean,
    private readonly sound: (events: GameEvent[]) => void,
  ) {
    this.heroSpec = heroSpec;
    this.root.visible = false;
    this.figures.sortableChildren = true;
    this.root.addChild(this.dim, this.stage);
    this.stage.addChild(this.ground, this.figures, this.fx, this.particles.container, this.sigilG);
    this.camera.bleed = 0;
    const layers: SigLayers = { ground: this.ground, figures: this.figures, fx: this.fx };
    const proj: SigProjection = {
      sx: (x) => this.sx(x),
      sy: (y) => this.sy(y),
      fs: (y) => this.fs(y),
      unit: () => this.width / ARENA_W,
      dy: () => (this.groundBottom - this.groundTop) / ARENA_D,
      top: () => this.camera.out.pivotY - this.camera.out.y / this.camera.out.scale,
      left: () => this.camera.out.pivotX - this.camera.out.x / this.camera.out.scale,
      right: () => this.camera.out.pivotX + (this.width - this.camera.out.x) / this.camera.out.scale,
    };
    const host: SigHost = {
      particles: this.particles,
      camera: this.camera,
      layers,
      proj,
      isReduced: () => this.reduced,
      body: (id, out) => this.body(id, out),
      playerId: () => 1,
      playerSpec: () => this.heroSpec(),
      flash: (c, a, d) => this.flash(c, a, d),
      darken: (c, a) => {
        // The preview's own backdrop is the dim layer: deepen it a little.
        this.dimBoost = Math.max(this.dimBoost, a * 0.4);
        void c;
      },
      stop: (s) => {
        if (this.reduced) return 0;
        this.stopLeft = Math.min(0.12, this.stopLeft + s);
        return s;
      },
      hold: (id, s) => {
        const a = this.actors.find((x) => x.id === id);
        if (a) a.flinch = Math.max(a.flinch, s * 4);
      },
      numbers: () => null,
      each: (faction, fn) => {
        for (const a of this.actors) if ((faction === "enemy" ? a.kind === "enemy" : a.kind === "ally") && a.rig.root.visible) fn(a.id);
      },
    };
    this.director = new SignatureDirector(host, true);
    this.driver = new SigDriver((ev) => this.onEvents(ev));
  }

  private dimBoost = 0;

  get isActive(): boolean {
    return this.active;
  }

  setReduced(v: boolean): void {
    this.reduced = v;
    this.camera.reduced = v;
    this.director.setReduced(v);
    this.particles.countScale = v ? 0.4 : 1;
  }

  setQuality(q: VisualQuality): void {
    this.director.setQuality(q);
  }

  /** The canvas size and the band the interface covers at the bottom. */
  layout(w: number, h: number, insetBottom: number): void {
    this.width = w;
    this.height = h;
    const reserve = 70;
    this.groundTop = Math.max(h * 0.36, (h - reserve) * 0.46);
    this.groundBottom = h - reserve;
    this.camera.setViewport(w, h);
    this.camera.setInsets(insetBottom);
    this.dim.clear().rect(0, 0, w, h).fill(0x07060a);
  }

  private sx(x: number): number {
    return x * (this.width / ARENA_W);
  }

  private sy(y: number): number {
    return this.groundTop + (y / ARENA_D) * (this.groundBottom - this.groundTop);
  }

  private fs(y: number): number {
    return (0.8 + 0.32 * Math.min(1, Math.max(0, y / ARENA_D))) * (this.width / ARENA_W) * FIGURE_SCALE;
  }

  private body(id: number, out: SigBody): boolean {
    const a = this.actors.find((x) => x.id === id);
    if (!a || !a.rig.root.visible) return false;
    const s = this.fs(a.wy);
    out.x = a.x;
    out.y = a.y;
    out.chestY = CHEST * s;
    out.height = a.rig.top * s;
    out.scale = s;
    out.wx = a.wx;
    out.wy = a.wy;
    out.facing = a.facing;
    out.boss = false;
    out.ally = a.kind === "ally";
    out.player = a.kind === "player";
    out.rig = a.rig;
    return true;
  }

  // ------------------------------------------------------------------ cast

  private clearActors(): void {
    for (const a of this.actors) a.rig.destroy();
    this.actors.length = 0;
  }

  private add(kind: StandIn["kind"], spec: RigSpec, wx: number, wy: number, facing: 1 | -1): StandIn {
    const rig = new Rig(spec);
    this.figures.addChild(rig.shadow, rig.root);
    const a: StandIn = { id: this.nextId++, wx, wy, rig, kind, facing, flash: 0, flinch: 0, move: null, x: this.sx(wx), y: this.sy(wy), hidden: false, emerge: -1 };
    this.actors.push(a);
    return a;
  }

  /** Stand-ins for a skill: the hero, a knot of ink foes (one wounded, one marked), the army for the crown. */
  private cast(id: SignatureId, evo: EvolutionId | null, o: PreviewOptions): number {
    this.clearActors();
    this.nextId = 1;
    const hero = this.add("player", this.heroSpec(), 180, 78, 1);
    const foeKinds = ["husk", "ashborn_brute", "husk", "veilshot", "husk", "ember_acolyte"];
    const spots: [number, number][] = [[372, 62], [418, 92], [446, 52], [470, 104], [398, 128], [500, 72]];
    const foes: StandIn[] = [];
    const n = id === "kings_judgement" || id === "void_collapse" ? 6 : 5;
    for (let i = 0; i < n; i++) foes.push(this.add("enemy", enemySpec(foeKinds[i]!), spots[i]![0], spots[i]![1], -1));
    const allies: StandIn[] = [];
    if (id === "sovereign_awakening") {
      const kinds = ["husk_blade", "bastion", "veilshot"];
      kinds.forEach((k, i) => allies.push(this.add("ally", summonSpec(k), 120 + i * 30, 40 + i * 40, 1)));
    }
    const actor = (a: StandIn, i: number): SigActor => ({ id: a.id, pos: { x: a.wx, y: a.wy }, kind: "enemy", hp: i === 1 ? 0.15 : i === 3 ? 0.3 : 0.9, marked: o.synergy === "hunters_parade" ? i % 2 === 0 : i === 0 });
    // Legion Awakening raises soldiers where foes fell: stand-ins wait hidden at those places.
    const corpses: Vec2[] = [{ x: 250, y: 50 }, { x: 236, y: 92 }, { x: 270, y: 120 }, { x: 214, y: 70 }, { x: 290, y: 84 }, { x: 228, y: 30 }, { x: 300, y: 40 }, { x: 260, y: 140 }];
    const soldiers: StandIn[] = [];
    const raising = id === "legion_awakening" || (id === "kings_judgement" && o.synergy === "legion_meteor");
    if (raising) {
      const count = evo === "endless_legion" ? 8 : evo === "veteran_souls" ? 3 : 5;
      for (let i = 0; i < count; i++) {
        const s = this.add("ally", summonSpec("shade"), corpses[i]!.x, corpses[i]!.y, 1);
        s.hidden = id === "legion_awakening";
        soldiers.push(s);
      }
    }
    const synergies: SynergyId[] = o.synergy ? [o.synergy] : [];
    const script = buildScript({
      castId: this.driver.newCastId(),
      sig: id,
      evo,
      mastery: o.mastery ?? 1,
      caster: { id: hero.id, pos: { x: hero.wx, y: hero.wy }, kind: "player" },
      foes: foes.map(actor),
      allies: (soldiers.length > 0 && id === "kings_judgement" ? soldiers : allies).map((a) => ({ id: a.id, pos: { x: a.wx, y: a.wy }, kind: "summon" as const })),
      soldiers: soldiers.map((a) => ({ id: a.id, pos: { x: a.wx, y: a.wy }, kind: "summon" as const })),
      enhanced: o.enhanced ?? false,
      synergies,
      hits: false,
    });
    // A partner cast the combination needs on the field first (the singularity for Gravity Feast).
    if (o.synergy === "gravity_feast" && id === "abyssal_devourer") {
      const pre = buildScript({ castId: this.driver.newCastId(), sig: "void_collapse", evo: null, mastery: 1, caster: { id: hero.id, pos: { x: hero.wx, y: hero.wy } }, foes: foes.map(actor), hits: false });
      this.driver.play(pre, 0);
      this.driver.play(script, 0.6);
    } else if (o.synergy === "frozen_singularity" && id === "time_fracture") this.driver.play(script, 0);
    else this.driver.play(script, 0);
    let len = 0;
    for (const s of script) len = Math.max(len, s.t);
    return len + (o.synergy === "gravity_feast" ? 0.6 : 0);
  }

  /** Play a skill's animation on stand-ins. Restarts if one is running. */
  preview(id: SignatureId, evo: EvolutionId | null, o: PreviewOptions = {}): boolean {
    this.stopNow();
    this.active = true;
    this.root.visible = true;
    this.dimTarget = 0.66;
    const len = this.cast(id, evo, o);
    // The aura of Sovereign Awakening lasts ten seconds in a fight; the preview shows three.
    const shown = id === "sovereign_awakening" ? Math.min(len, 4.2) : len;
    this.closeAt = o.hold ? Infinity : this.time + shown + 0.9;
    this.camera.snap();
    return true;
  }

  /**
   * The reveal moment for a skill just found. Returns its timing for the interface's sheet. The
   * sandbox holds until `endReveal` (the sheet closed); a tap may skip ahead with `skipReveal`.
   */
  playReveal(id: SignatureId): RevealTiming {
    this.stopNow();
    const def = signatureDef(id);
    const full = def.rarity === "legendary" || def.rarity === "mythic";
    const timing: RevealTiming = full ? { nameAt: 0.9, detailsAt: 5.4, length: 6.4, full } : { nameAt: 0.5, detailsAt: 2.6, length: 3.0, full };
    if (this.reduced) {
      timing.nameAt = 0.2;
      timing.detailsAt = Math.min(timing.detailsAt, 1.2);
      timing.length = Math.min(timing.length, 1.4);
    }
    this.active = true;
    this.root.visible = true;
    this.dimTarget = full ? 0.86 : 0.74;
    this.reveal = { id, t: 0, timing, animAt: full ? 1.1 : 0.6, started: false };
    this.closeAt = Infinity;
    this.camera.snap();
    return timing;
  }

  /** Skip the reveal to its details (returns true once the name may show). */
  skipReveal(): boolean {
    const r = this.reveal;
    if (!r) return true;
    if (r.t < 0.3) return false;
    r.t = Math.max(r.t, r.timing.detailsAt);
    return true;
  }

  endReveal(): void {
    this.stop();
  }

  /** Close the preview (fades out). */
  stop(): void {
    if (!this.active) return;
    this.dimTarget = 0;
    this.closeAt = this.time;
  }

  private stopNow(): void {
    this.driver.clear();
    this.director.reset();
    this.particles.clear();
    this.clearActors();
    this.reveal = null;
    this.sigilG.clear();
    this.camera.cine.zoom = 1;
    this.stopLeft = 0;
  }

  private onEvents(ev: GameEvent[]): void {
    this.director.handle(ev);
    this.sound(ev);
    for (const e of ev) {
      // Scripted motion of the stand-ins (the simulation's moves, played back for the preview).
      if (e.type === "sig_beat") {
        if (e.beat === "pull" || e.beat === "horizon_trap") {
          for (const id of e.targetIds) {
            const a = this.actors.find((x) => x.id === id);
            if (!a) continue;
            const k = e.beat === "pull" ? 0.45 : 0.6;
            a.move = { fx: a.wx, fy: a.wy, tx: a.wx + (e.to.x - a.wx) * k, ty: a.wy + (e.to.y - a.wy) * k, t0: this.time, t1: this.time + Math.max(0.3, e.duration) };
          }
        }
        if (e.beat === "rise") {
          for (const id of e.targetIds) {
            const a = this.actors.find((x) => x.id === id);
            if (a) {
              a.hidden = false;
              a.emerge = 0;
              a.rig.snap();
            }
          }
        }
        if (e.beat === "charge") {
          let i = 0;
          for (const id of e.targetIds) {
            const a = this.actors.find((x) => x.id === id);
            if (!a) continue;
            const side = a.wx <= e.to.x ? -1 : 1;
            a.move = { fx: a.wx, fy: a.wy, tx: e.to.x + side * (20 + (i % 3) * 10), ty: e.to.y + ((i % 3) - 1) * 14, t0: this.time, t1: this.time + Math.max(0.2, e.duration || 0.3) + 0.2 };
            i++;
          }
        }
        if (e.beat === "finisher") {
          const hero = this.actors.find((x) => x.kind === "player");
          if (hero) {
            hero.wx = e.to.x;
            hero.wy = e.to.y;
            hero.move = null;
            hero.rig.snap();
          }
        }
        if (e.beat === "clone" || e.beat === "delayed" || e.beat === "implode" || e.beat === "impact" || e.beat === "blade" || e.beat === "supernova_burst") {
          // The struck flinch (the preview shows no figures).
          for (const id of e.targetIds) {
            const a = this.actors.find((x) => x.id === id);
            if (a) {
              a.flash = 0.08;
              a.flinch = 0.25;
            }
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ frame

  update(real: number): void {
    this.time += real;
    if (!this.active) return;
    // A stop holds the preview's fight; the camera keeps moving.
    let dt = real;
    if (this.stopLeft > 0) {
      this.stopLeft -= real;
      dt = 0;
    }
    if (this.reveal) this.updateReveal(real);
    this.driver.update(dt);
    this.dimBoost = Math.max(0, this.dimBoost - real * 0.6);
    this.dimK += (this.dimTarget + this.dimBoost * (this.dimTarget > 0 ? 1 : 0) - this.dimK) * Math.min(1, real * 9);
    this.dim.alpha = Math.min(0.92, this.dimK);
    this.stage.alpha = this.dimTarget > 0 ? 1 : Math.min(1, this.dimK / 0.5);
    this.director.update(dt, real);
    this.particles.update(dt);
    this.updateActors(dt, real);
    // Frame the stand-ins.
    const b = this.box;
    b.minX = Infinity;
    b.minY = Infinity;
    b.maxX = -Infinity;
    b.maxY = -Infinity;
    for (const a of this.actors) {
      const top = a.y - a.rig.top * this.fs(a.wy);
      b.minX = Math.min(b.minX, a.x - 30);
      b.maxX = Math.max(b.maxX, a.x + 30);
      b.minY = Math.min(b.minY, top - 60);
      b.maxY = Math.max(b.maxY, a.y + 20);
    }
    if (this.actors.length > 0) this.camera.frame(b, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
    this.camera.update(real);
    const o = this.camera.out;
    this.stage.pivot.set(o.pivotX, o.pivotY);
    this.stage.position.set(o.x, o.y);
    this.stage.scale.set(o.scale);
    this.stage.rotation = o.rotation;
    if (this.time >= this.closeAt) {
      this.dimTarget = 0;
      if (this.dimK < 0.02) {
        this.stopNow();
        this.active = false;
        this.root.visible = false;
        this.closeAt = Infinity;
      }
    }
  }

  private updateActors(dt: number, real: number): void {
    const mods = this.director.mods;
    for (const a of this.actors) {
      if (a.move) {
        const k = easeInOutSine(Math.min(1, Math.max(0, (this.time - a.move.t0) / Math.max(0.01, a.move.t1 - a.move.t0))));
        a.wx = a.move.fx + (a.move.tx - a.move.fx) * k;
        a.wy = a.move.fy + (a.move.ty - a.move.fy) * k;
        if (k >= 1) a.move = null;
      }
      const s = this.fs(a.wy);
      const m = mods.get(a.id);
      a.x = this.sx(a.wx);
      a.y = this.sy(a.wy);
      const rig = a.rig;
      a.flash = Math.max(0, a.flash - real);
      a.flinch = Math.max(0, a.flinch - real * 2);
      rig.root.visible = !a.hidden;
      rig.shadow.visible = !a.hidden;
      if (a.hidden) continue;
      if (a.emerge >= 0) a.emerge += real;
      if (a.emerge >= 0 && a.emerge < 0.6) {
        rig.animate("emerge", a.emerge, 0.6, 0.3 + a.id * 0.13, a.facing, false, 0, 0, real, 0);
      } else if (a.move && a.kind === "ally") {
        rig.animate("move", this.time, 0.5, 0.3 + a.id * 0.13, a.wx <= a.move.tx ? 1 : -1, true, 1, 0, real, 0);
      } else if (m?.kneel) {
        rig.setDeath(DEATH_KNEEL, 1, 0.5);
        rig.animate("dead", 0.4, 0, 0.5, a.facing, false, 0, 0.4, real, 0);
      } else if (!m?.frozen) rig.animate(a.flinch > 0.1 ? "hit" : "idle", a.flinch > 0.1 ? 0.25 - a.flinch : this.time, a.flinch > 0.1 ? 0.25 : 0, 0.3 + a.id * 0.13, a.facing, false, 0, 0, dt > 0 ? real : 0, 0);
      rig.setWhite(Math.max(a.flash > 0 ? 1 : 0, m ? m.white : 0));
      rig.root.position.set(a.x + (m ? m.dx : 0), a.y + (m ? m.dy : 0));
      rig.root.scale.set(s * (m ? 1 + m.stretch * 0.25 : 1), s * (m ? 1 - m.stretch * 0.08 : 1));
      rig.root.skew.set(m ? -m.lean * m.stretch * 0.5 : 0, 0);
      rig.root.zIndex = a.wy;
      rig.root.alpha = m ? m.alpha : 1;
      rig.root.tint = m && m.tintK > 0 ? mix(0xffffff, m.tint, m.tintK) : 0xffffff;
      rig.shadow.position.set(a.x, a.y + 1);
      rig.shadow.scale.set(s, s * 0.9);
      rig.shadow.zIndex = -1000 + a.wy;
      rig.shadow.alpha = m ? m.alpha : 1;
    }
  }

  /** The reveal's own beats: the sigil forms, then the animation plays under it. */
  private updateReveal(real: number): void {
    const r = this.reveal!;
    r.t += real;
    const g = this.sigilG;
    g.clear();
    const def = SIGNATURES[r.id];
    const pal = basePalette(r.id);
    const cx = this.camera.out.pivotX;
    const top = this.camera.out.pivotY - this.camera.out.y / this.camera.out.scale;
    const R = Math.min(this.width * 0.2, 80);
    const cy = top + R + 40;
    const form = this.reduced ? 1 : easeOutBack(Math.min(1, r.t / (r.timing.full ? 0.8 : 0.45)));
    const fade = r.started ? Math.max(0.25, 1 - (r.t - r.animAt) * 0.8) : 1;
    if (!r.started && r.t >= r.animAt) {
      r.started = true;
      const evo = def.evolutions[0]?.id ?? null;
      this.cast(r.id, evo, { mastery: 1 });
      if (r.timing.full) this.flash(def.rarity === "mythic" ? GILT_HOT : 0xe6dcff, 0.22, 0.3);
    }
    // The sigil: an outer gilt ring that draws itself, the rarity's ticks, the skill's emblem.
    const draw = this.reduced ? 1 : Math.min(1, r.t / (r.timing.full ? 0.7 : 0.4));
    g.circle(cx, cy, R * form).fill({ color: pal.ink, alpha: 0.6 * fade });
    g.arc(cx, cy, R * form, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * draw).stroke({ width: 3, color: GILT, alpha: fade });
    g.circle(cx, cy, R * 0.86 * form).stroke({ width: 1.2, color: pal.glow, alpha: 0.8 * fade });
    const ticks = def.rarity === "mythic" ? 24 : def.rarity === "legendary" ? 16 : def.rarity === "epic" ? 12 : 8;
    for (let i = 0; i < ticks; i++) {
      const a = (i / ticks) * Math.PI * 2 + r.t * 0.3;
      g.moveTo(cx + Math.cos(a) * R * 0.9 * form, cy + Math.sin(a) * R * 0.9 * form).lineTo(cx + Math.cos(a) * R * 1.0 * form, cy + Math.sin(a) * R * 1.0 * form);
    }
    g.stroke({ width: 1.4, color: GILT_HOT, alpha: 0.9 * fade });
    emblem(g, r.id, cx, cy, R * 0.6 * form, pal.mid, pal.accent, fade, r.t);
    void easeOutCubic;
  }

  destroy(): void {
    this.stopNow();
    this.director.destroy();
    this.particles.destroy();
    this.root.destroy({ children: true });
  }
}

/** Each skill's emblem inside its sigil (radius r). */
function emblem(g: Graphics, id: SignatureId, x: number, y: number, r: number, mid: number, accent: number, alpha: number, t: number): void {
  switch (id) {
    case "void_collapse":
      g.ellipse(x, y, r, r * 0.3).stroke({ width: 2, color: mid, alpha });
      g.circle(x, y, r * 0.38).fill({ color: 0x000000, alpha });
      g.circle(x, y, r * 0.4).stroke({ width: 1.4, color: 0xf3eeff, alpha });
      break;
    case "abyssal_devourer":
      g.moveTo(x - r, y + r * 0.2);
      for (let i = 0; i <= 16; i++) {
        const k = i / 16;
        g.lineTo(x - r + 2 * r * k, y + Math.sin(k * Math.PI * 2 + t * 2) * r * 0.35);
      }
      g.stroke({ width: 4, color: mid, alpha });
      g.circle(x + r, y + Math.sin(Math.PI * 2 + t * 2) * r * 0.35, 3).fill({ color: accent, alpha });
      break;
    case "death_parade":
      g.moveTo(x - r * 0.7, y - r * 0.7).lineTo(x + r * 0.7, y + r * 0.7).moveTo(x + r * 0.7, y - r * 0.7).lineTo(x - r * 0.7, y + r * 0.7).stroke({ width: 3, color: accent, alpha });
      g.circle(x, y, r * 0.25).fill({ color: 0x3d4552, alpha });
      break;
    case "kings_judgement":
      g.poly([x - r * 0.6, y + r * 0.3, x - r * 0.6, y - r * 0.2, x - r * 0.3, y + r * 0.05, x, y - r * 0.55, x + r * 0.3, y + r * 0.05, x + r * 0.6, y - r * 0.2, x + r * 0.6, y + r * 0.3]).stroke({ width: 2.4, color: GILT, alpha });
      break;
    case "legion_awakening":
      for (let i = -1; i <= 1; i++) g.moveTo(x + i * r * 0.4, y + r * 0.6).lineTo(x + i * r * 0.4, y - r * 0.6).stroke({ width: 2.4, color: 0x8e97a8, alpha });
      for (let i = -1; i <= 1; i++) g.circle(x + i * r * 0.4, y - r * 0.2, 2.2).fill({ color: GILT, alpha });
      break;
    case "time_fracture":
      g.circle(x, y, r * 0.8).stroke({ width: 2, color: 0xd8dde8, alpha });
      g.moveTo(x, y).lineTo(x, y - r * 0.6).moveTo(x, y).lineTo(x + r * 0.4, y).stroke({ width: 2, color: 0xffffff, alpha });
      g.moveTo(x - r * 0.3, y - r * 0.5).lineTo(x - r * 0.1, y - r * 0.1).lineTo(x - r * 0.4, y + r * 0.3).stroke({ width: 1.4, color: accent, alpha });
      break;
    case "shadow_storm":
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + t;
        g.moveTo(x + Math.cos(a) * r * 0.25, y + Math.sin(a) * r * 0.25).lineTo(x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85);
      }
      g.stroke({ width: 2.4, color: mid, alpha });
      break;
    case "sovereign_awakening":
      g.poly([x - r * 0.6, y + r * 0.35, x - r * 0.6, y - r * 0.1, x - r * 0.35, y + r * 0.1, x - r * 0.2, y - r * 0.5, x, y + r * 0.05, x + r * 0.2, y - r * 0.5, x + r * 0.35, y + r * 0.1, x + r * 0.6, y - r * 0.1, x + r * 0.6, y + r * 0.35]).fill({ color: 0x1a1426, alpha }).stroke({ width: 2, color: GILT, alpha });
      break;
  }
}
