import type { Sprite } from "pixi.js";
import type { Vec2 } from "../../../engine/math";
import type { EvolutionId } from "../../../data/signatures";
import type { Rig, RigSpec } from "../../rigs/Rig";
import { easeOutCubic } from "../../anim/ease";
import { shard, softCircle } from "../../textures";
import { CRIMSON, GILT, GILT_HOT } from "../palette";
import { Stage, span01, type SigBeatEvent, type SigSynergyEvent } from "../stage";
import { bladeTex, smokeTex, starTex } from "../textures";

/**
 * DEATH PARADE: the warrior vanishes; clones of him step out beside his foes, each striking its own
 * way, then he returns for one sharp cut through all of them. A clone is his own figure (his blade,
 * his cape) in ink, darker than the slate army and cut out by a crimson rim and a crimson light behind
 * it, with gold eyes: it must never be taken for one of the army it fights beside.
 *
 *   vanish    he breaks into ink and slate motes, an ivory afterimage left where he stood; the field
 *             dims a touch; a crimson tick marks each foe he means to visit.
 *   clone     a clone blinks in beside its foe (a streak of afterimages from the last, speed lines)
 *             and strikes in its own style: a rising cut, an overhead, a dash straight through, a
 *             cross, a falling stab, a reversed cut. Crimson slash lines, a white-hot edge; the clone
 *             holds its follow-through and breaks into ink.
 *   execute   a foe cut below the line: a crimson-gold X and a vertical stroke from above.
 *   finisher  he reappears in a crouch, a glint runs along his blade, then one long crimson cut
 *             through every foe visited, a stop, the flash, speed lines across the field.
 *
 * Afterimage leaves a chain of copies behind every blink. Executioner gives the clones crimson eyes
 * and makes the execution a guillotine from above. Phantom King crowns the clones in gilt and their
 * cuts throw violet sparks (their strikes can start combinations). Hunter's Parade marks the hunted
 * with a crimson reticle and thickens their cuts; Blade Parade looses shadow blades from each strike.
 * Master adds a crimson ink trail to every blink; Grandmaster gilds the clones' light and eyes.
 */
interface Clone {
  rig: Rig;
  glow: Sprite | null;
  x: number;
  y: number;
  scale: number;
  facing: 1 | -1;
  t: number;
  style: number;
  depth: number;
  live: boolean;
}

interface Shot {
  s: Sprite | null;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  t: number;
  d: number;
  live: boolean;
}

const STRIKE = 0.18;
/** The clones' ink (darker than the army's slate) and their rim (a lit crimson that reads on ink). */
const CLONE_INK = 0x1b1820;
const CRIMSON_RIM = 0xe0574c;
/** The blink's afterimages: crimson-black, lighter toward the clone. */
const GHOST_NEAR = 0x7a2a2c;
const GHOST_FAR = 0x2a1418;
/** Speed lines: a warm pale, so the motion reads without the whiteness of a burst. */
const SPEED = 0xf0cdc4;
const HOLD = 0.2;
const FADE = 0.14;

/**
 * A clone: the warrior's own figure in ink, rimmed in crimson (the edge every limb and the head
 * carry), with gold eyes (Executioner: crimson): darker than the slate army, and cut apart from the
 * ink foes by the rim and the light behind it.
 */
function take(box: { minX: number; minY: number; maxX: number; maxY: number }, x: number, y: number, top: number): void {
  if (x < box.minX) box.minX = x;
  if (x > box.maxX) box.maxX = x;
  if (y > box.maxY) box.maxY = y;
  if (top < box.minY) box.minY = top;
}

export function cloneSpec(warrior: RigSpec, evo: EvolutionId | null, gilded: boolean): RigSpec {
  const eye = evo === "executioner" ? CRIMSON : gilded ? GILT_HOT : GILT;
  return { ...warrior, body: CLONE_INK, accent: CRIMSON_RIM, eye, glow: CRIMSON, finish: "shadow", rim: 2.2, crown: evo === "phantom_king" };
}

export class ParadeStage extends Stage {
  private readonly clones: Clone[] = [];
  private readonly shots: Shot[] = [];
  private readonly visited: number[] = [];
  private readonly marks = new Map<number, number>();
  private spec: RigSpec | null = null;
  private lastX = 0;
  private lastY = 0;
  private hidden = 0;
  private hideTarget = 0;
  private hunted: number[] = [];
  private finT = -1;
  private fin: Vec2 = { x: 0, y: 0 };
  private finTargets: number[] = [];
  private glint: Sprite | null = null;
  private tickG: ReturnType<Stage["graphics"]> | null = null;

  constructor(...a: ConstructorParameters<typeof Stage>) {
    super(...a);
    this.tail = 0.5;
    this.spec = cloneSpec(this.host.playerSpec(), this.evo, this.gilded);
  }

  /**
   * While he is gone the camera takes in every foe the clones will visit, and the clone striking
   * now: the round may run past the warrior's own framing, and a clone cutting off screen is lost.
   */
  override lead(out: { x: number; y: number }): boolean {
    if (this.hideTarget <= 0) return false;
    for (let i = this.clones.length - 1; i >= 0; i--) {
      const c = this.clones[i]!;
      if (!c.live) continue;
      out.x = c.x;
      out.y = c.y - 50 * c.scale;
      return true;
    }
    return false;
  }

  override frame(box: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
    if (this.hideTarget <= 0) return false;
    // The foes in the Parade's reach (the simulation picks each clone's foe as it goes).
    const ids = this.cast.targetIds;
    for (let i = 0; i < ids.length; i++) if (this.body(ids[i]!)) take(box, this.b.x, this.b.y, this.b.y - this.b.height);
    for (const c of this.clones) if (c.live) take(box, c.x, c.y, c.y - 100 * c.scale);
    return true;
  }

  onBeat(e: SigBeatEvent): void {
    switch (e.beat) {
      case "vanish":
        this.vanish(e);
        break;
      case "clone":
        this.clone(e);
        break;
      case "execute":
        this.execute(e.targetIds[0] ?? -1, e.from);
        break;
      case "finisher":
        this.finisher(e);
        break;
      case "blade": {
        // Blade Parade: shadow blades loosed from a clone's strike.
        const a = this.chestAt(e.from, this.p);
        const id = e.targetIds[0] ?? -1;
        const b = id >= 0 && this.body(id) ? { x: this.b.x, y: this.b.y - this.b.chestY } : this.chestAt(e.to, this.q);
        this.shoot(a.x, a.y - 10 * this.u, b.x, b.y);
        break;
      }
      default:
        break;
    }
  }

  override onSynergy(e: SigSynergyEvent): void {
    const pr = this.host.proj;
    if (e.synergy === "hunters_parade") {
      this.hunted = e.targetIds.slice();
      this.svc.label("Hunter's Parade", pr.sx(e.pos.x), pr.sy(e.pos.y) - 120 * this.u, 0xf0b8a8);
    } else if (e.synergy === "blade_parade") {
      const from = this.clones.length > 0 ? this.clones[this.clones.length - 1]! : null;
      const ax = from ? from.x : pr.sx(e.pos.x);
      const ay = from ? from.y - 50 * from.scale : pr.sy(e.pos.y) - 50 * this.u;
      for (const id of e.targetIds.slice(0, 2)) {
        if (!this.body(id)) continue;
        this.shoot(ax, ay, this.b.x, this.b.y - this.b.chestY);
      }
      if (!this.namedBlades) {
        this.namedBlades = true;
        this.svc.label("Blade Parade", ax, ay - 60 * this.u, 0xd8ccff);
      }
    }
  }

  private namedBlades = false;

  private vanish(e: SigBeatEvent): void {
    const k = this.kit;
    const pid = this.host.playerId();
    this.hideTarget = 1;
    if (this.body(pid)) {
      const b = this.b;
      this.lastX = b.x;
      this.lastY = b.y;
      // The ivory afterimage he leaves, already breaking up.
      k.afterimage("hero", this.host.playerSpec(), b.x, b.y, b.scale, b.facing, "dodge", 0, 0xd8d0c0, 0.65, 0.35);
      const o = k.o(b.x, b.y - b.chestY, smokeTex(), this.pal.ink);
      o.additive = false;
      o.alpha = 0.6;
      o.speed[0] = 20;
      o.speed[1] = 70;
      o.life[0] = 0.35;
      o.life[1] = 0.6;
      o.scale[0] = 0.3;
      o.scale[1] = 0.55;
      o.endScale = 0.9;
      o.spread = 20 * this.u;
      k.emit(8);
      const m = k.o(b.x, b.y - b.chestY, softCircle(), 0x8e97a8);
      m.speed[0] = 30;
      m.speed[1] = 110;
      m.life[0] = 0.3;
      m.life[1] = 0.55;
      m.scale[0] = 0.1;
      m.scale[1] = 0.2;
      k.emit(10);
    }
    if (!this.compact) this.host.darken(0x14131a, 0.28);
    // The focus from the vanish to the finisher: the army and the other figures step back while
    // only the clones move (the director caps how long it may hold).
    this.focusFor(2);
    // Crimson ticks on each foe he means to visit (anticipation).
    for (const id of e.targetIds) if (!this.marks.has(id)) this.marks.set(id, 0);
    if (!this.tickG) this.tickG = this.graphics(this.host.layers.fx);
  }

  private clone(e: SigBeatEvent): void {
    const k = this.kit;
    const pr = this.host.proj;
    const target = e.targetIds[0] ?? -1;
    // Where the clone stands: the beat's `from` (the simulation's), else beside its foe.
    const stand = Math.hypot(e.from.x - e.to.x, e.from.y - e.to.y) > 4 ? e.from : e.to;
    let tx = pr.sx(stand.x);
    let ty = pr.sy(stand.y);
    const fs = pr.fs(stand.y);
    let facing: 1 | -1 = 1;
    let chestX = tx;
    let chestY = ty - 50 * fs;
    if (target >= 0 && this.body(target)) {
      // Beside the foe, facing it.
      facing = this.b.x >= tx ? 1 : -1;
      chestX = this.b.x;
      chestY = this.b.y - this.b.chestY;
      if (Math.abs(this.b.x - tx) < 14 * this.u) tx = this.b.x - facing * 22 * this.u;
      ty = this.b.y;
      this.visited.push(target);
    }
    const style = (e.index - 1) % 6;
    // The blink: afterimages and speed lines from the last place to this one.
    const n = this.evo === "afterimage" ? this.profile.afterimages + 2 : this.profile.afterimages;
    const dx = tx - this.lastX;
    const dy = ty - this.lastY;
    if (!this.compact && this.spec) {
      for (let i = 1; i <= n; i++) {
        const f = i / (n + 1);
        k.afterimage("clone-ghost", this.spec, this.lastX + dx * f, this.lastY + dy * f, fs * 1.1, facing, "dodge", 0, i % 2 === 0 ? GHOST_NEAR : GHOST_FAR, 0.2 + 0.35 * f, 0.18 + 0.1 * f);
      }
    }
    k.speedLines(this.lastX, this.lastY - 45 * fs, tx, ty - 45 * fs, this.compact ? 2 : 3, 50 * fs, SPEED, 0.16);
    if (this.master && !this.compact) k.streak(this.lastX, this.lastY - 40 * fs, tx, ty - 40 * fs, Math.hypot(dx, dy) * 0.8, 2.2, CRIMSON, 0.3, { add: false, alpha: 0.7 });
    this.lastX = tx;
    this.lastY = ty;
    if (!this.spec) return;
    const rig = this.rig("clone", this.spec);
    if (!rig) return;
    // A crimson light behind each clone, a little larger than the figure: with the rim it cuts the
    // ink clone out of the slate army and the ink foes alike (Grandmaster: gilt).
    const glow = this.sprite(this.host.layers.figures, softCircle(), true);
    if (glow) glow.tint = this.gilded ? GILT : CRIMSON;
    const c: Clone = { rig, glow, x: tx, y: ty, scale: fs * 1.12, facing, t: 0, style, depth: e.to.y, live: true };
    // Style 2 dashes through: it starts on the near side and ends past the foe.
    if (style === 2) c.x = tx - facing * 10 * this.u;
    this.clones.push(c);
    this.pose(c);
    // The cut lands a beat into the strike (with the hit).
    const heavy = this.hunted.includes(target);
    this.slashFor(c, chestX, chestY, heavy);
    if (this.evo === "phantom_king") {
      const o = k.o(chestX, chestY, softCircle(), this.pal.glow === GILT ? 0xb59cf0 : this.pal.glow);
      o.speed[0] = 40;
      o.speed[1] = 140;
      o.life[0] = 0.2;
      o.life[1] = 0.4;
      o.scale[0] = 0.1;
      o.scale[1] = 0.22;
      k.emit(6);
    }
    if (target >= 0) this.host.hold(target, 0.04);
    k.punch(0.008);
  }

  /** Each clone's cut, by its style (drawn a few frames into its strike). */
  private slashFor(c: Clone, x: number, y: number, heavy: boolean): void {
    const k = this.kit;
    const f = c.facing;
    const s = c.scale;
    const w = (heavy ? 5 : 3.8) * (this.compact ? 0.8 : 1);
    // A gilt-hot edge on the crimson, never a white one: the cuts read as the Parade's, not a burst.
    const light = GILT_HOT;
    const d = 0.05;
    const r = 38 * s;
    switch (c.style) {
      case 0: // rising cut
        k.cut(x - f * 6 * s, y + 6 * s, r, f === 1 ? 2.3 : 0.84, f * -1.9, CRIMSON, light, w, 0.34, { delay: d });
        break;
      case 1: // overhead
        k.slash(x - f * 4 * s, y - 34 * s, x + f * 8 * s, y + 28 * s, CRIMSON, light, w, 0.34, d);
        break;
      case 2: // dash straight through
        k.slash(x - f * 40 * s, y + 2 * s, x + f * 46 * s, y - 2 * s, CRIMSON, light, w * 0.9, 0.26, d);
        k.speedLines(x - f * 50 * s, y - 10 * s, x + f * 50 * s, y - 10 * s, 3, 30 * s, SPEED, 0.16);
        break;
      case 3: // cross
        k.slash(x - 22 * s, y - 24 * s, x + 22 * s, y + 22 * s, CRIMSON, light, w, 0.34, d);
        k.slash(x + 22 * s, y - 24 * s, x - 22 * s, y + 22 * s, CRIMSON, light, w, 0.34, d + 0.05);
        break;
      case 4: // falling stab
        k.slash(x + f * 4 * s, y - 52 * s, x, y + 12 * s, CRIMSON, light, w * 1.1, 0.34, d);
        k.ring(c.x, c.y, 4, 26 * s, 0.25, this.pal.ink, CRIMSON, 2, { delay: d });
        break;
      default: // reversed cut
        k.cut(x + f * 4 * s, y - 4 * s, r, f === 1 ? -0.7 : Math.PI + 0.7, f * 1.9, CRIMSON, light, w, 0.34, { delay: d });
        break;
    }
    const o = k.o(x, y, shard(), CRIMSON);
    o.speed[0] = 70;
    o.speed[1] = 200;
    o.angle[0] = f === 1 ? -0.7 : Math.PI - 0.7;
    o.angle[1] = f === 1 ? 0.7 : Math.PI + 0.7;
    o.life[0] = 0.18;
    o.life[1] = 0.35;
    o.scale[0] = 0.15;
    o.scale[1] = 0.32;
    o.alignToVelocity = true;
    k.emit(heavy ? 8 : 5);
  }

  private execute(id: number, at: Vec2): void {
    const k = this.kit;
    let x: number;
    let y: number;
    if (id >= 0 && this.body(id)) {
      x = this.b.x;
      y = this.b.y - this.b.chestY;
    } else {
      const c = this.chestAt(at, this.q);
      x = c.x;
      y = c.y;
    }
    const s = this.host.proj.fs(at.y);
    const top = this.evo === "executioner" ? this.host.proj.top() + 10 : y - 70 * s;
    k.slash(x, top, x, y + 30 * s, CRIMSON, GILT_HOT, this.evo === "executioner" ? 4 : 3, 0.32);
    k.slash(x - 16 * s, y - 16 * s, x + 16 * s, y + 16 * s, CRIMSON, GILT, 2.4, 0.3, 0.04);
    k.slash(x + 16 * s, y - 16 * s, x - 16 * s, y + 16 * s, CRIMSON, GILT, 2.4, 0.3, 0.07);
    const o = k.o(x, y, softCircle(), GILT);
    o.speed[0] = 40;
    o.speed[1] = 140;
    o.life[0] = 0.3;
    o.life[1] = 0.5;
    o.scale[0] = 0.1;
    o.scale[1] = 0.22;
    k.emit(10);
    k.stop(0.04, "sig-exec", 0.3);
  }

  private finisher(e: SigBeatEvent): void {
    this.finT = 0;
    this.fin = { x: e.to.x, y: e.to.y };
    // One cut through every foe the clones visited and the one he returns to.
    this.finTargets = this.visited.slice();
    for (const id of e.targetIds) if (!this.finTargets.includes(id)) this.finTargets.push(id);
    this.hideTarget = 0;
    // The focus holds through the cut and a breath after it, then lets go.
    this.endFocus();
    this.focusFor(0.25);
    const pid = this.host.playerId();
    // He reappears: a puff of ink where he lands, a glint along his blade.
    if (this.body(pid)) {
      const b = this.b;
      const o = this.kit.o(b.x, b.y - b.chestY * 0.6, smokeTex(), this.pal.ink);
      o.additive = false;
      o.alpha = 0.55;
      o.speed[0] = 30;
      o.speed[1] = 90;
      o.life[0] = 0.25;
      o.life[1] = 0.45;
      o.scale[0] = 0.3;
      o.scale[1] = 0.5;
      this.kit.emit(6);
      this.glint = this.sprite(this.host.layers.fx, starTex(), true);
      if (this.glint && b.rig) {
        b.rig.weaponPoints(this.p, this.q);
        this.glint.position.set(this.p.x, this.p.y);
        this.glint.tint = this.gilded ? GILT_HOT : 0xffffff;
        this.glint.scale.set(0.01);
      }
    }
  }

  /** The cut itself, a beat after he reappears. */
  private cutThrough(): void {
    const k = this.kit;
    const pts: { x: number; y: number }[] = [];
    for (const id of this.finTargets) if (this.body(id)) pts.push({ x: this.b.x, y: this.b.y - this.b.chestY });
    if (pts.length === 0 && this.body(this.host.playerId())) pts.push({ x: this.b.x + this.b.facing * 60 * this.u, y: this.b.y - this.b.chestY });
    if (pts.length === 0) return;
    pts.sort((a, b) => a.x - b.x);
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    const pad = 46 * this.u;
    const y0 = first.y + 6 * this.u;
    const y1 = last.y - 6 * this.u;
    // One long cut through every foe he visited: an ink wake under a crimson blade-line, white-hot.
    k.slash(first.x - pad * 0.8, y0 + 5, last.x + pad * 0.8, y1 + 5, this.pal.ink, -1, 5, 0.5, 0.0);
    k.slash(first.x - pad, y0, last.x + pad, y1, CRIMSON, this.gilded ? GILT_HOT : 0xffffff, 8.5, 0.55);
    k.slash(first.x - pad * 0.5, y0 - 7, last.x + pad * 0.5, y1 - 7, -1, 0xf2e8e2, 1.6, 0.35, 0.04);
    for (const p of pts) {
      const o = k.o(p.x, p.y, shard(), CRIMSON);
      o.speed[0] = 90;
      o.speed[1] = 260;
      o.angle[0] = -0.5;
      o.angle[1] = 0.5;
      o.life[0] = 0.2;
      o.life[1] = 0.45;
      o.scale[0] = 0.18;
      o.scale[1] = 0.38;
      o.alignToVelocity = true;
      k.emit(7);
    }
    if (!this.compact) {
      const top = this.host.proj.top();
      k.speedLines(first.x - pad * 2, (y0 + top) / 2 + 40 * this.u, last.x + pad * 2, (y1 + top) / 2 + 40 * this.u, 6, 160 * this.u, SPEED, 0.26);
    }
    // The clones still standing shatter into ink with the cut.
    for (const c of this.clones) if (c.live) c.t = Math.max(c.t, STRIKE + HOLD);
    k.stop(0.08, "sig-parade", 0.5);
    k.flash(0xf2e8e2, 0.28, 0.2);
    k.punch(0.035);
    k.shake(0.1);
  }

  private shoot(ax: number, ay: number, bx: number, by: number): void {
    const s = this.sprite(this.host.layers.fx, bladeTex(), false);
    if (s) {
      s.tint = this.pal.deep === 0x3d4552 ? 0x4a3a78 : this.pal.deep;
      s.scale.set(0.5 * this.u, 0.55 * this.u);
    }
    this.shots.push({ s, ax, ay, bx, by, t: 0, d: 0.16, live: true });
    this.kit.streak(ax, ay, bx, by, 30 * this.u, 1, 0xb59cf0, 0.18);
  }

  private pose(c: Clone): void {
    const r = c.rig;
    const t = c.t;
    const variant = c.style === 1 || c.style === 4 ? 2 : c.style === 0 ? 1 : 0;
    if (t < 0.05) r.animate("windup", t + 0.08, 0.13, 0.4, c.facing, false, 0, 0, 1 / 60, variant);
    else if (t < STRIKE) r.animate("attack", t - 0.05, 0.12, 0.4, c.facing, false, 0, 0, 1 / 60, variant);
    else r.animate("recover", Math.min(0.03, t - STRIKE), 0.12, 0.4, c.facing, false, 0, 0, 0, variant);
    let x = c.x;
    if (c.style === 2) x = c.x + c.facing * 30 * this.u * easeOutCubic(span01(t, 0.03, STRIKE));
    if (c.style === 4) r.root.y = c.y - 24 * c.scale * (1 - easeOutCubic(span01(t, 0, STRIKE)));
    else r.root.y = c.y;
    r.root.x = x;
    r.root.scale.set(c.scale);
    r.root.zIndex = c.depth + 0.5;
    const fade = span01(t, STRIKE + HOLD, STRIKE + HOLD + FADE);
    r.root.alpha = (t < 0.04 ? t / 0.04 : 1) * (1 - fade);
    r.root.tint = 0xffffff;
    if (c.glow) {
      c.glow.position.set(x, r.root.y - 46 * c.scale);
      c.glow.scale.set(c.scale * 1.35, c.scale * 2.1);
      c.glow.alpha = (this.compact ? 0.35 : 0.5) * r.root.alpha;
      c.glow.zIndex = c.depth + 0.4;
    }
  }

  update(dt: number, real: number): void {
    // The warrior's vanishing and return.
    this.hidden += (this.hideTarget - this.hidden) * Math.min(1, real * (this.hideTarget > this.hidden ? 18 : 22));
    const pid = this.host.playerId();
    if (this.hidden > 0.005 || this.hideTarget > 0) this.svc.mod(pid).alpha = 1 - this.hidden;
    for (const c of this.clones) {
      if (!c.live) continue;
      const before = c.t;
      c.t += dt;
      if (before < STRIKE + HOLD && c.t >= STRIKE + HOLD && !this.compact) {
        // Breaking into ink.
        const o = this.kit.o(c.x, c.y - 45 * c.scale, smokeTex(), this.pal.ink);
        o.additive = false;
        o.alpha = 0.5;
        o.speed[0] = 10;
        o.speed[1] = 40;
        o.angle[0] = -Math.PI * 0.8;
        o.angle[1] = -Math.PI * 0.2;
        o.life[0] = 0.3;
        o.life[1] = 0.5;
        o.scale[0] = 0.2;
        o.scale[1] = 0.4;
        o.spread = 14 * c.scale;
        this.kit.emit(4);
      }
      if (c.t >= STRIKE + HOLD + FADE) {
        c.live = false;
        this.releaseRig(c.rig);
        if (c.glow) c.glow.visible = false;
        continue;
      }
      this.pose(c);
    }
    for (const s of this.shots) {
      if (!s.live) continue;
      s.t += dt;
      const k = Math.min(1, s.t / s.d);
      const e = easeOutCubic(k);
      if (s.s) {
        const lift = Math.sin(k * Math.PI) * 18 * this.u;
        s.s.position.set(s.ax + (s.bx - s.ax) * e, s.ay + (s.by - s.ay) * e - lift);
        s.s.rotation = Math.atan2(s.by - s.ay, s.bx - s.ax);
      }
      if (k >= 1) {
        s.live = false;
        if (s.s) s.s.visible = false;
        this.kit.cut(s.bx, s.by, 14 * this.u, -0.6, 1.3, 0x4a3a78, 0xeee8fa, 1.8, 0.18);
      }
    }
    if (this.finT >= 0) {
      const before = this.finT;
      this.finT += dt;
      if (this.glint) {
        const k = span01(this.finT, 0, 0.12);
        this.glint.scale.set((0.1 + 0.9 * Math.sin(k * Math.PI)) * this.u * 1.2);
        this.glint.alpha = 1 - span01(this.finT, 0.1, 0.16);
        this.glint.rotation = k * 0.8;
      }
      if (before < 0.09 && this.finT >= 0.09) this.cutThrough();
    }
    if (this.ended && this.hideTarget > 0) this.hideTarget = 0;
  }

  override paint(): void {
    const g = this.tickG;
    if (!g) return;
    g.clear();
    if (this.finT >= 0.1 || this.ended) return;
    // Crimson ticks over each foe still to be visited; a reticle on the hunted.
    for (const [id] of this.marks) {
      if (this.visited.includes(id) || !this.body(id)) continue;
      const x = this.b.x;
      const y = this.b.y - this.b.height - 10 * this.u;
      const pulse = 0.6 + 0.4 * Math.sin(this.t * 18 + id);
      g.poly([x, y + 6, x - 5, y - 2, x + 5, y - 2]).fill({ color: CRIMSON, alpha: 0.9 * pulse });
      if (this.hunted.includes(id) || (this.evo === "executioner" && this.t < 0.6)) {
        const cy = this.b.y - this.b.chestY;
        const r = 16 * this.u;
        g.circle(x, cy, r).stroke({ width: 1.4, color: CRIMSON, alpha: 0.8 * pulse });
        g.moveTo(x - r * 1.4, cy).lineTo(x - r * 0.6, cy).moveTo(x + r * 0.6, cy).lineTo(x + r * 1.4, cy).moveTo(x, cy - r * 1.4).lineTo(x, cy - r * 0.6).moveTo(x, cy + r * 0.6).lineTo(x, cy + r * 1.4);
        g.stroke({ width: 1.2, color: CRIMSON, alpha: 0.8 * pulse });
      }
    }
  }

  override dispose(): void {
    this.svc.mod(this.host.playerId()).alpha = 1;
    for (const c of this.clones) if (c.live) this.releaseRig(c.rig);
    this.clones.length = 0;
    super.dispose();
  }
}
