import { Container, Graphics, Sprite } from "pixi.js";
import { Timeline } from "../anim/Timeline";
import { DEATH_KNEEL, Rig } from "../rigs/Rig";
import { enemySpec } from "../rigs/specs";
import { shard, softCircle } from "../textures";
import { easeInCubic, easeInOutSine, easeOutBack, easeOutCubic } from "../anim/ease";
import { lighten } from "../colors";
import type { Camera } from "../Camera";
import type { EmitOptions, ParticleSystem } from "../Particles";

/**
 * Boss sequences (blueprint section 7D), all render-side and inside the simulation's own timers.
 *
 *  Entrance (the sim's fixed 2.4s `boss_intro`): letterbox bars, the field dims, the camera pans
 *  and zooms onto the spawn point; at 0.3s the boss emerges by kind (a Warden rises from a
 *  widening fissure, the Drowned Warden surfaces through an expanding water ring, the Ember
 *  Herald descends in a column of embers, the Crownless King walks out of a gold horizon flare
 *  as two banners unfurl); an impact beat at 1.1s; release to fight framing by 2.4s.
 *
 *  The Rift Sovereigns each enter their own way, in the same 2.4s and skippable with a tap:
 *   - the Mirror Knight steps out of a tall mirror that rises at its place, pale as a reflection
 *     until it is through, and the glass shatters behind it on the impact;
 *   - the Storm Titan is only a black shape in the dark, lit by three strikes of lightning, and
 *     straightens to its full height on the impact as the ground takes its weight;
 *   - the Void Queen floats out of a seam of the void that opens upright at her place, while two of
 *     her court bow either side; the seam closes on the impact.
 *
 *  Death: an inverted impact frame (the boss white on black), then the boss kneels, cracks of its
 *  glow spread over it and it breaks upward into shards; a slow full-width ring; motes drift. A
 *  Sovereign breaks its own way: the knight into mirror shards, the titan's storm discharging into
 *  the ground, the queen collapsing into a point of void that rings outward once.
 */

export type BossKind = "warden" | "drowned" | "herald" | "king" | "mirror" | "titan" | "queen";

export function bossKind(defId: string): BossKind {
  if (defId === "mirror_knight") return "mirror";
  if (defId === "storm_titan") return "titan";
  if (defId === "void_queen") return "queen";
  if (defId === "drowned_warden") return "drowned";
  if (defId === "ember_herald") return "herald";
  if (defId === "crownless_king") return "king";
  return "warden";
}

/** The entrance's beats (seconds from `boss_intro`). */
export const ENTRANCE = { length: 2.4, emerge: 0.3, impact: 1.1, release: 2.0, zoom: 1.3 } as const;
/** The death sequence: inverted frames, then 1.2s of kneel and break. */
export const DEATH = { inverted: 2 / 60, breakAt: 0.95, length: 2.6, zoom: 1.35 } as const;

/** Base px kept clear between a Sovereign's whole figure and the field's edge in its entrance and death. */
export const FIT_PAD = 10;
/** The share of the view's width and height a Sovereign's figure may fill in its entrance and death. */
const FIT_SHARE = 0.86;

/** A figure's box (rig units, feet at the origin). */
export interface FigureBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** How a Sovereign is staged for its entrance or its death (see `fitFigure`). */
export interface FigureFit {
  /** How far its figure is drawn from where it stands (base px; `dx` positive to the left, `dy` down). */
  dx: number;
  dy: number;
  /** The camera's framing of it: its centre (base px) and zoom. */
  x: number;
  y: number;
  zoom: number;
}

/**
 * Where a Sovereign is staged in its entrance or its death so its whole figure is seen. The camera
 * can show no more than the painted field (the canvas in base px), and a Sovereign rises by its edge:
 * the Storm Titan's storm alone is wider than the space behind it, and on a small phone taller than
 * the space above it. So the figure is drawn inside the field (and lower, when the view is short),
 * and framed whole: its centre, at a zoom no closer than `zoom` that keeps it in view.
 */
export function fitFigure(x: number, y: number, scale: number, box: FigureBox, viewW: number, viewH: number, zoom: number, out: FigureFit): void {
  const left = x + box.minX * scale;
  const right = x + box.maxX * scale;
  const top = y + box.minY * scale;
  const bottom = y + box.maxY * scale;
  let dx = 0;
  if (right > viewW - FIT_PAD) dx = right - (viewW - FIT_PAD);
  if (left - dx < FIT_PAD) dx = left - FIT_PAD;
  // Lower only as far as the view's foot allows (its head is what a short view cuts).
  let dy = 0;
  if (top < FIT_PAD) dy = Math.min(FIT_PAD - top, Math.max(0, viewH - FIT_PAD - bottom));
  const w = Math.max(1, (box.maxX - box.minX) * scale);
  const h = Math.max(1, (box.maxY - box.minY) * scale);
  out.dx = dx;
  out.dy = dy;
  out.x = (left + right) / 2 - dx;
  out.y = (top + bottom) / 2 + dy;
  out.zoom = Math.max(1, Math.min(zoom, (viewW * FIT_SHARE) / w, (viewH * FIT_SHARE) / h));
}

function isSovereignKind(kind: BossKind): boolean {
  return kind === "mirror" || kind === "titan" || kind === "queen";
}

export interface BossHost {
  readonly camera: Camera;
  readonly particles: ParticleSystem;
  /** Camera layer for the boss's own effects (base px). */
  readonly layer: Container;
  isReduced(): boolean;
  /** Global stop (seconds); the renderer skips it under reduced motion. */
  freeze(seconds: number): void;
  /** Letterbox bars: target height in px (0 retracts). */
  letterbox(px: number): void;
  /** Dim everything but the boss by `amount` (0..1). */
  dimOthers(amount: number): void;
  /** A full-width ring in the boss's colour. */
  ring(x: number, y: number, r0: number, r1: number, life: number, color: number, width: number): void;
  /** The view's drawn width (CSS px) and the base px per world unit. */
  viewWidth(): number;
  cue(name: "impact" | "shatter"): void;
  /** A screen flash through the flash budget (false when refused). */
  flash(color: number, alpha: number, duration: number): boolean;
}

/** The boss's drawn place and scale this frame (the renderer fills it in). */
export interface BossPlace {
  x: number;
  y: number;
  scale: number;
  facing: 1 | -1;
}

const DUST = 0x8a7a6a;

/**
 * The entrance. The renderer draws the boss's rig as usual and asks `present` to stage it while
 * the sequence runs (offset, mask, alpha, tint and the pose state to show).
 */
export class BossEntrance {
  readonly tl = new Timeline(ENTRANCE.length);
  readonly kind: BossKind;
  readonly bossId: number;
  private readonly host: BossHost;
  private readonly root = new Container();
  private readonly fx = new Graphics();
  private readonly mask = new Graphics();
  private readonly glow: number;
  private readonly flare = new Sprite(softCircle());
  private readonly emit: EmitOptions = { x: 0, y: 0, count: 1, texture: softCircle(), color: 0xffffff, speed: [0, 0], life: [0.4, 0.8], scale: [0.2, 0.4] };
  /** 0 before the emergence, 1 when the boss is fully present. */
  private emerge = 0;
  private open = 0;
  private bannerK = 0;
  private flareK = 0;
  private waterT = -1;
  private columnK = 0;
  /** The Sovereigns: the mirror (0 to 1 risen, then shattered), the lightning's light on the titan, the queen's seam. */
  private paneK = 0;
  private paneGone = false;
  private strikeT = -1;
  private litK = 0;
  private seamK = 0;
  private bowK = 0;
  private boltSeed = 0;
  private place: BossPlace = { x: 0, y: 0, scale: 1, facing: -1 };
  private placed = false;
  private masked: Rig | null = null;
  private rigTop = 100;
  private reducedT = -1;
  /**
   * A Sovereign's figure box (rig units, measured as it rises) and how far inside the field it is
   * drawn so all of it is seen (base px, eased back to its own place as the entrance lets go).
   */
  private box: FigureBox | null = null;
  private insetX = 0;
  private insetY = 0;
  private insetK = 1;
  private readonly fit: FigureFit = { dx: 0, dy: 0, x: 0, y: 0, zoom: 1 };

  constructor(host: BossHost, bossId: number, defId: string) {
    this.host = host;
    this.bossId = bossId;
    this.kind = bossKind(defId);
    const spec = enemySpec(defId);
    this.glow = spec.glow ?? spec.eye;
    const tl = this.tl;
    tl.own(this.root);
    this.flare.anchor.set(0.5);
    this.flare.blendMode = "add";
    this.flare.alpha = 0;
    this.flare.tint = 0xffd98a;
    this.root.addChild(this.mask, this.fx, this.flare);
    host.layer.addChild(this.root);
    tl.onDispose(() => {
      this.unmask();
      host.letterbox(0);
      host.dimOthers(0);
      host.camera.hold.weight = 0;
    });
    tl.disposeOnDone = true;
    this.build();
    if (host.isReduced()) {
      tl.skipTo(ENTRANCE.release);
      this.reducedT = 0;
    }
  }

  private build(): void {
    const tl = this.tl;
    const host = this.host;
    const cam = host.camera;
    tl.at(0, () => {
      if (!host.isReduced()) host.letterbox(22);
    });
    tl.tween(0, 0.4, easeOutCubic, (k) => host.dimOthers(0.3 * k));
    tl.tween(0, 0.6, easeInOutSine, (k) => {
      cam.hold.weight = k;
      cam.hold.zoom = this.box ? this.fit.zoom : ENTRANCE.zoom;
      cam.hold.lambda = 7;
    });
    // The emergence, by kind.
    const e0 = ENTRANCE.emerge;
    const e1 = ENTRANCE.impact;
    if (this.kind === "warden") {
      tl.tween(e0, e0 + 0.35, easeOutCubic, (k) => (this.open = k));
      tl.tween(e0 + 0.2, e1, easeOutCubic, (k) => (this.emerge = k));
    } else if (this.kind === "drowned") {
      tl.at(e0, () => (this.waterT = 0));
      tl.tween(e0 + 0.15, e1, easeOutBack, (k) => (this.emerge = Math.min(1, k)));
    } else if (this.kind === "herald") {
      tl.tween(e0 - 0.1, e0 + 0.3, easeOutCubic, (k) => (this.columnK = k));
      tl.tween(e0, e1, easeOutCubic, (k) => (this.emerge = k));
      tl.tween(e1, e1 + 0.5, null, (k) => (this.columnK = 1 - k));
    } else if (this.kind === "mirror") {
      // The mirror rises; the knight walks out of the glass; the glass shatters on the impact.
      tl.tween(e0 - 0.15, e0 + 0.25, easeOutBack, (k) => (this.paneK = Math.min(1, k)));
      tl.tween(e0 + 0.2, e1, easeInOutSine, (k) => (this.emerge = k));
      tl.at(e1, () => {
        this.paneGone = true;
        if (!tl.skipping) this.shatterPane();
      });
    } else if (this.kind === "titan") {
      // Darkness, three strikes that show it, then it straightens on the impact.
      for (const at of [e0 + 0.05, e0 + 0.42, e1 - 0.12]) {
        tl.at(at, () => {
          this.strikeT = 0;
          this.boltSeed += 1;
          if (!tl.skipping) host.flash(0xd8e8ff, 0.14, 0.12);
        });
      }
      tl.tween(e0, e1, null, (k) => (this.emerge = k));
    } else if (this.kind === "queen") {
      // A seam of the void opens upright; she floats out of it; her court bows; it closes.
      tl.tween(e0 - 0.15, e0 + 0.3, easeOutCubic, (k) => (this.seamK = k));
      tl.tween(e0 + 0.15, e1, easeInOutSine, (k) => (this.emerge = k));
      tl.tween(e0 + 0.3, e1 + 0.2, easeOutCubic, (k) => (this.bowK = k));
      tl.tween(e1, e1 + 0.4, easeInCubic, (k) => (this.seamK = 1 - k));
    } else {
      tl.tween(e0 - 0.1, e0 + 0.35, easeOutCubic, (k) => (this.flareK = k));
      tl.tween(e0 + 0.1, e1, easeInOutSine, (k) => (this.emerge = k));
      tl.tween(e0 + 0.25, e1, easeOutBack, (k) => (this.bannerK = Math.min(1, k)));
      tl.tween(e1, e1 + 0.5, null, (k) => (this.flareK = 1 - k));
    }
    // Impact: trauma 0.5, an 80ms stop, a dust ring.
    tl.at(e1, () => {
      this.emerge = 1;
      if (tl.skipping) return;
      host.cue("impact");
      cam.shake(0.5);
      host.freeze(0.08);
      if (this.placed) {
        const p = this.place;
        host.ring(p.x, p.y, 10, 160 * p.scale, 0.55, DUST, 5);
        const o = this.emit;
        o.x = p.x;
        o.y = p.y;
        o.count = 22;
        o.texture = softCircle();
        o.color = DUST;
        o.speed = [60, 200];
        o.angle = [-Math.PI, 0];
        o.life = [0.4, 0.8];
        o.scale = [0.3, 0.7];
        o.endScale = 0.9;
        o.alpha = 0.55;
        o.gravity = 140;
        o.additive = false;
        o.spread = 40 * p.scale;
        host.particles.emit(o);
        o.spread = 0;
      }
    });
    tl.tween(e1, e1 + 0.3, null, (k) => (this.open = 1 - k));
    // Release: the bars retract, the field comes back, the camera returns to the fight (and a
    // Sovereign staged inside the field steps back to its own place).
    tl.at(ENTRANCE.release, () => host.letterbox(0));
    tl.tween(ENTRANCE.release, ENTRANCE.length, easeInOutSine, (k) => (this.insetK = 1 - k));
    tl.tween(ENTRANCE.release, ENTRANCE.length, easeInOutSine, (k) => {
      host.dimOthers(0.3 * (1 - k));
      cam.hold.weight = 1 - k;
    });
  }

  /** Whether it frames the boss's whole figure (a Sovereign's): the renderer measures it each frame. */
  get wantsBox(): boolean {
    return isSovereignKind(this.kind) && !this.tl.disposed;
  }

  /**
   * The boss's figure box this frame (rig units, feet at the origin). The entrance keeps the union of
   * every pose it has shown (a blow wound up, the storm straightening), so its framing only widens.
   */
  setBox(box: FigureBox): void {
    const b = this.box;
    if (!b) this.box = { minX: box.minX, maxX: box.maxX, minY: box.minY, maxY: box.maxY };
    else {
      b.minX = Math.min(b.minX, box.minX);
      b.maxX = Math.max(b.maxX, box.maxX);
      b.minY = Math.min(b.minY, box.minY);
      b.maxY = Math.max(b.maxY, box.maxY);
    }
  }

  /** Where the boss is drawn (base px, rig scale) this frame; called before `present`. */
  setPlace(x: number, y: number, scale: number, facing: 1 | -1, rigTop: number): void {
    const p = this.place;
    p.scale = scale;
    p.facing = facing;
    this.rigTop = rigTop;
    const cam = this.host.camera;
    if (this.box) {
      // A Sovereign is staged where all of it is seen, and framed whole (never pushed closer than
      // the entrance's own zoom).
      // Eased toward where it must stand (a wider pose seen later moves it in smoothly, never with a jump).
      const f = this.fit;
      fitFigure(x, y, scale, this.box, this.host.viewWidth(), cam.height - cam.insetBottom, ENTRANCE.zoom, f);
      this.insetX = this.placed ? this.insetX + (f.dx - this.insetX) * 0.25 : f.dx;
      this.insetY = this.placed ? this.insetY + (f.dy - this.insetY) * 0.25 : f.dy;
      f.x += f.dx - this.insetX;
      f.y += this.insetY - f.dy;
      p.x = x - this.insetX * this.insetK;
      p.y = y + this.insetY * this.insetK;
      if (!this.placed || this.insetK >= 1) {
        cam.hold.x = this.fit.x;
        cam.hold.y = this.fit.y;
        cam.hold.zoom = this.fit.zoom;
      }
    } else {
      p.x = x;
      p.y = y;
      if (!this.placed) {
        cam.hold.x = x;
        cam.hold.y = y - rigTop * scale * 0.5;
      }
    }
    this.placed = true;
  }

  /** The pose to animate the boss with while it emerges (the King and the knight walk out). */
  get poseState(): "idle" | "move" {
    return (this.kind === "king" || this.kind === "mirror") && this.emerge < 0.98 ? "move" : "idle";
  }

  /** A tap skips the entrance to its release (the boss stands, the camera returns). */
  skip(): boolean {
    if (this.tl.disposed || this.tl.t >= ENTRANCE.release) return false;
    this.tl.skipTo(ENTRANCE.release);
    this.emerge = 1;
    this.paneGone = true;
    this.seamK = 0;
    return true;
  }

  /** Stage the boss's rig for this frame (after it is posed and placed): offset, mask, alpha, tint. */
  present(rig: Rig): void {
    const p = this.place;
    const k = this.emerge;
    const h = this.rigTop * p.scale;
    rig.root.alpha = 1;
    rig.root.tint = 0xffffff;
    // A Sovereign is staged at its place inside the field (its shadow with it), steady: the army's
    // blows do not shove it about (and off the screen) while it rises.
    if (this.box) {
      rig.root.position.set(p.x, p.y);
      rig.shadow.position.set(p.x, p.y + 1);
    }
    switch (this.kind) {
      case "warden":
      case "drowned": {
        // Rises out of the ground (masked at the surface).
        this.useMask(rig);
        rig.root.y += (1 - k) * h * 1.15;
        if (this.kind === "drowned") rig.root.y += Math.sin(this.tl.t * 6) * 2 * (1 - k);
        rig.shadow.alpha = k;
        break;
      }
      case "herald": {
        // Descends in the column of embers.
        rig.root.y -= (1 - k) * h * 1.6;
        rig.root.alpha = Math.min(1, k * 2.5);
        rig.shadow.alpha = k;
        break;
      }
      case "mirror": {
        // Steps out of the glass: from inside the pane, pale as a reflection until it is through.
        rig.root.x += (1 - k) * 18 * p.scale * -p.facing;
        rig.root.alpha = k < 0.02 ? 0.25 : Math.min(1, 0.35 + k * 1.2);
        rig.root.tint = k < 1 ? lighten(0xc8d2e6, k) : 0xffffff;
        rig.shadow.alpha = k;
        break;
      }
      case "titan": {
        // A black shape in the dark, shown by the lightning; it straightens on the impact.
        const lit = this.litK;
        rig.root.tint = k >= 1 ? 0xffffff : lighten(0x05070a, Math.max(lit * 0.9, k >= 1 ? 1 : 0));
        rig.root.alpha = k >= 1 ? 1 : Math.max(0.55, lit);
        rig.root.scale.y *= 0.9 + 0.1 * (k >= 1 ? 1 : k * 0.6);
        rig.shadow.alpha = Math.max(0.3, k);
        break;
      }
      case "queen": {
        // Out of the seam: from narrow to whole, violet until she is through.
        rig.root.alpha = k < 0.03 ? 0 : Math.min(1, k * 1.6);
        rig.root.scale.x *= 0.35 + 0.65 * k;
        rig.root.tint = k < 1 ? lighten(0x7a4fc0, k) : 0xffffff;
        rig.shadow.alpha = k;
        break;
      }
      case "king": {
        // Walks out of the flare: from further back, white-gold as it leaves the light.
        rig.root.x += (1 - k) * 90 * p.scale * -p.facing;
        rig.root.alpha = k < 0.04 ? 0 : Math.min(1, (k - 0.04) * 5);
        rig.root.tint = k < 1 ? lighten(0xffe2a0, k) : 0xffffff;
        rig.shadow.alpha = k;
        break;
      }
    }
  }

  private useMask(rig: Rig): void {
    if (this.masked === rig) return;
    this.unmask();
    this.masked = rig;
    rig.root.mask = this.mask;
  }

  private unmask(): void {
    if (this.masked && !this.masked.root.destroyed) this.masked.root.mask = null;
    this.masked = null;
    this.mask.clear();
  }

  get done(): boolean {
    return this.tl.disposed;
  }

  update(dt: number): void {
    if (this.tl.disposed) return;
    if (this.reducedT >= 0) this.reducedT += dt;
    this.tl.update(dt);
    if (this.tl.disposed) return;
    if (this.emerge >= 1 && this.masked) this.unmask();
    this.draw(dt);
  }

  private draw(dt: number): void {
    const g = this.fx;
    g.clear();
    if (!this.placed) return;
    const p = this.place;
    const s = p.scale;
    const vw = this.host.viewWidth();
    // The mask: everything above the ground line at the boss's feet.
    // Only while it masks: an unused mask would draw as a white rectangle.
    this.mask.clear();
    if (this.masked) this.mask.rect(p.x - vw * 2, p.y - vw * 3, vw * 4, vw * 3).fill(0xffffff);
    if (this.kind === "warden" && this.open > 0) {
      // A jagged fissure along the ground, widening, with a hot seam.
      const len = 120 * s * this.open;
      const w = 9 * s * this.open;
      g.moveTo(p.x - len, p.y);
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        g.lineTo(p.x - len + 2 * len * t, p.y - w * 0.5 * Math.sin(t * Math.PI) - (i % 2 ? 2 : -1) * s);
      }
      for (let i = 10; i >= 0; i--) {
        const t = i / 10;
        g.lineTo(p.x - len + 2 * len * t, p.y + w * 0.5 * Math.sin(t * Math.PI) + (i % 3 ? 1.5 : -1) * s);
      }
      g.closePath().fill({ color: 0x060506, alpha: 0.95 });
      g.moveTo(p.x - len * 0.8, p.y).lineTo(p.x + len * 0.8, p.y).stroke({ width: 1.4, color: lighten(this.glow, 0.3), alpha: 0.8 * this.open });
      if (dt > 0 && this.emerge < 1 && !this.host.isReduced()) this.dust(p.x + (Math.random() - 0.5) * len * 2, p.y);
    }
    if (this.kind === "drowned" && this.waterT >= 0) {
      this.waterT += dt;
      // Three expanding water rings, and spray while it surfaces.
      for (let i = 0; i < 3; i++) {
        const t = this.waterT - i * 0.22;
        if (t < 0 || t > 1.4) continue;
        const k = t / 1.4;
        const r = (20 + 150 * easeOutCubic(k)) * s;
        g.ellipse(p.x, p.y, r, r * 0.28).stroke({ width: 3 * (1 - k) + 0.5, color: 0xbfe9e4, alpha: (1 - k) * 0.85 });
      }
      if (dt > 0 && this.emerge < 1 && this.emerge > 0.05 && !this.host.isReduced()) {
        const o = this.emit;
        o.x = p.x + (Math.random() - 0.5) * 50 * s;
        o.y = p.y;
        o.count = 2;
        o.texture = softCircle();
        o.color = 0xcfefea;
        o.speed = [120, 260];
        o.angle = [-Math.PI * 0.68, -Math.PI * 0.32];
        o.life = [0.4, 0.7];
        o.scale = [0.1, 0.25];
        o.endScale = 0;
        o.alpha = 0.85;
        o.gravity = 520;
        o.additive = true;
        this.host.particles.emit(o);
      }
    }
    if (this.kind === "herald" && this.columnK > 0.01) {
      // A falling column of embers onto the spawn point.
      const top = p.y - this.rigTop * s * 3;
      const w = 34 * s;
      g.rect(p.x - w, top, w * 2, p.y - top).fill({ color: this.glow, alpha: 0.1 * this.columnK });
      g.rect(p.x - w * 0.25, top, w * 0.5, p.y - top).fill({ color: lighten(this.glow, 0.5), alpha: 0.25 * this.columnK });
      if (dt > 0 && !this.host.isReduced()) {
        const o = this.emit;
        o.x = p.x + (Math.random() - 0.5) * w * 1.8;
        o.y = top + Math.random() * (p.y - top) * 0.6;
        o.count = 2;
        o.texture = softCircle();
        o.color = Math.random() < 0.4 ? 0xffd9a0 : this.glow;
        o.speed = [140, 260];
        o.angle = [Math.PI * 0.45, Math.PI * 0.55];
        o.life = [0.3, 0.6];
        o.scale = [0.08, 0.2];
        o.endScale = 0;
        o.alpha = 0.95;
        o.gravity = 200;
        o.additive = true;
        this.host.particles.emit(o);
      }
    }
    if (this.kind === "mirror") this.drawMirror(g, p.x, p.y, s);
    if (this.kind === "titan") this.drawTitan(g, p.x, p.y, s, dt);
    if (this.kind === "queen") this.drawQueen(g, p.x, p.y, s);
    if (this.kind === "king") {
      // A gold flare on the horizon behind the spawn point, and two banners unfurling.
      if (this.flareK > 0.01) {
        const hy = p.y - 6 * s;
        const half = vw * 0.8 * this.flareK;
        g.moveTo(p.x - half, hy).lineTo(p.x + half, hy).stroke({ width: 1.6, color: 0xfff1c9, alpha: 0.95 * this.flareK });
        this.flare.position.set(p.x - p.facing * 30 * s, hy - 30 * s);
        this.flare.scale.set((260 * s) / 64, (120 * s) / 64);
        this.flare.alpha = 0.8 * this.flareK;
      } else this.flare.alpha = 0;
      const b = this.bannerK;
      if (b > 0) {
        for (const side of [-1, 1]) {
          const bx = p.x + side * 78 * s;
          const pole = 120 * s * Math.min(1, b * 1.4);
          g.rect(bx - 1.5 * s, p.y - pole, 3 * s, pole).fill(0x2a201a);
          const cloth = 70 * s * b;
          const cw = 24 * s;
          g.poly([bx + 1.5 * s, p.y - pole + 4 * s, bx + 1.5 * s + cw, p.y - pole + 4 * s, bx + 1.5 * s + cw, p.y - pole + 4 * s + cloth, bx + 1.5 * s + cw * 0.5, p.y - pole + 4 * s + cloth * 0.82, bx + 1.5 * s, p.y - pole + 4 * s + cloth]).fill({ color: 0xb3473f, alpha: 0.95 });
          g.circle(bx, p.y - pole - 3 * s, 3 * s).fill(0xc9a24f);
        }
      }
      if (this.tl.t > ENTRANCE.release) g.alpha = 1 - (this.tl.t - ENTRANCE.release) / (ENTRANCE.length - ENTRANCE.release);
    }
  }

  /** The mirror the knight steps out of: a tall pane in a gilt frame, a sheen crossing it. */
  private drawMirror(g: Graphics, x: number, y: number, s: number): void {
    if (this.paneGone || this.paneK <= 0.01) return;
    const h = this.rigTop * s * 1.12 * this.paneK;
    const w = this.rigTop * s * 0.42;
    const cx = x - this.place.facing * 10 * s;
    g.roundRect(cx - w / 2 - 3, y - h - 3, w + 6, h + 3, w * 0.45).fill({ color: 0x14151a, alpha: 0.9 });
    g.roundRect(cx - w / 2, y - h, w, h, w * 0.42).fill({ color: 0xcfd6e4, alpha: 0.5 });
    g.roundRect(cx - w / 2, y - h, w, h, w * 0.42).stroke({ width: 2.4, color: 0xe2c27a, alpha: 1 });
    const sweep = (this.tl.t * 1.4) % 1;
    const sx = cx - w / 2 + w * sweep;
    g.moveTo(sx - w * 0.2, y - h * 0.1).lineTo(sx + w * 0.15, y - h * 0.9).stroke({ width: w * 0.14, color: 0xffffff, alpha: 0.35 });
  }

  private shatterPane(): void {
    if (!this.placed) return;
    const p = this.place;
    const s = p.scale;
    const cx = p.x - p.facing * 10 * s;
    const o = this.emit;
    o.x = cx;
    o.y = p.y - this.rigTop * s * 0.55;
    o.count = this.host.isReduced() ? 12 : 34;
    o.texture = shard();
    o.color = 0xdfe6f5;
    o.colors = [0xdfe6f5, 0xffffff, 0xe2c27a];
    o.speed = [120, 340];
    o.angle = [-Math.PI, 0];
    o.life = [0.5, 1.0];
    o.scale = [0.3, 0.8];
    o.endScale = 0;
    o.alpha = 1;
    o.gravity = 420;
    o.spin = 10;
    o.additive = false;
    o.spread = this.rigTop * s * 0.3;
    this.host.particles.emit(o);
    o.spread = 0;
    o.colors = undefined;
    o.spin = 0;
  }

  /** The titan in the dark: a jagged bolt for each strike, its light dying away. */
  private drawTitan(g: Graphics, x: number, y: number, s: number, dt: number): void {
    if (this.strikeT >= 0) {
      this.strikeT += dt;
      this.litK = Math.max(0, 1 - this.strikeT / 0.28);
      if (this.strikeT < 0.16) {
        const top = y - this.rigTop * s * 3;
        const n = 7;
        let px = x + 30 * s * (this.boltSeed % 2 ? 1 : -1);
        let py = top;
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const nx = i === n ? x + 10 * s : x + Math.sin(this.boltSeed * 7.1 + i * 2.3) * 26 * s * (1 - t);
          const ny = top + (y - this.rigTop * s * 0.8 - top) * t;
          g.moveTo(px, py).lineTo(nx, ny).stroke({ width: 5 * s, color: 0x6fa8ff, alpha: 0.4 });
          g.moveTo(px, py).lineTo(nx, ny).stroke({ width: 1.8 * s, color: 0xeef6ff, alpha: 1 });
          px = nx;
          py = ny;
        }
      }
    }
    if (this.emerge >= 1) this.litK = 0;
  }

  /** The seam of void the queen comes through, and two of her court bowing either side. */
  private drawQueen(g: Graphics, x: number, y: number, s: number): void {
    const k = this.seamK;
    if (k > 0.01) {
      const h = this.rigTop * s * 1.35;
      const w = this.rigTop * s * 0.34 * k;
      const top = y - h;
      g.moveTo(x, top).quadraticCurveTo(x + w, top + h * 0.5, x, y).quadraticCurveTo(x - w, top + h * 0.5, x, top).fill({ color: 0x07040c, alpha: 0.95 });
      g.moveTo(x, top).quadraticCurveTo(x + w, top + h * 0.5, x, y).quadraticCurveTo(x - w, top + h * 0.5, x, top).stroke({ width: 2, color: 0xb18cff, alpha: 0.95 });
      g.moveTo(x, top - 10 * s * k).lineTo(x, y + 4 * s).stroke({ width: 1, color: 0xf3e8ff, alpha: 0.8 * k });
    }
    const b = this.bowK;
    if (b > 0.01) {
      for (const side of [-1, 1]) {
        const cx = x + side * 70 * s;
        const bow = 0.4 + 0.6 * b;
        const hh = 34 * s * (1 - 0.25 * bow);
        g.poly([cx - 11 * s, y, cx - 8 * s, y - hh, cx + 8 * s, y - hh, cx + 12 * s, y]).fill({ color: 0x0d0912, alpha: 0.9 * b });
        g.circle(cx + side * -4 * s * bow, y - hh - 5 * s + 4 * s * bow, 6 * s).fill({ color: 0x0d0912, alpha: 0.9 * b });
        g.poly([cx - 11 * s, y, cx - 8 * s, y - hh, cx + 8 * s, y - hh, cx + 12 * s, y]).stroke({ width: 1, color: 0x9a6fe0, alpha: 0.7 * b });
      }
    }
  }

  private dust(x: number, y: number): void {
    const o = this.emit;
    o.x = x;
    o.y = y;
    o.count = 1;
    o.texture = softCircle();
    o.color = DUST;
    o.speed = [20, 80];
    o.angle = [-Math.PI * 0.8, -Math.PI * 0.2];
    o.life = [0.4, 0.8];
    o.scale = [0.25, 0.55];
    o.endScale = 0.9;
    o.alpha = 0.5;
    o.gravity = 40;
    o.additive = false;
    this.host.particles.emit(o);
  }

  dispose(): void {
    this.tl.dispose();
  }
}

/**
 * The boss's death. It owns a copy of the boss's rig (the simulation removes the entity on its
 * own schedule), stages an inverted impact frame, the kneel, the cracks and the shattering.
 */
export class BossDeath {
  readonly tl = new Timeline(DEATH.length);
  private readonly host: BossHost;
  private readonly root = new Container();
  private readonly black = new Graphics();
  private readonly cracks = new Graphics();
  private readonly rig: Rig;
  private readonly glow: number;
  private readonly x: number;
  private readonly y: number;
  private readonly s: number;
  private readonly facing: 1 | -1;
  private readonly seed: number;
  private t = 0;
  private crackK = 0;
  private fade = 1;
  private moteUntil = 0;
  private readonly emit: EmitOptions = { x: 0, y: 0, count: 1, texture: softCircle(), color: 0xffffff, speed: [0, 0], life: [0.4, 0.8], scale: [0.2, 0.4] };
  private readonly crackSeed: number[] = [];
  private readonly kind: BossKind;
  /** The queen's collapse into a point (0 to 1). */
  private collapse = 0;
  private readonly bolts = new Graphics();

  constructor(host: BossHost, defId: string, x: number, y: number, scale: number, facing: 1 | -1) {
    this.host = host;
    this.kind = bossKind(defId);
    const spec = enemySpec(defId);
    this.glow = spec.glow ?? spec.eye;
    this.rig = new Rig(spec);
    // A Sovereign dies in its second form.
    this.rig.setPhase(2);
    this.rig.setDeath(DEATH_KNEEL, facing, 1);
    // A Sovereign dies where all of it is seen (its inverted frame hides the step inside), framed
    // whole, never closer than the death's own zoom. Its box is measured in its first pose, the
    // stagger, in its second form (its storm swollen), as it faces.
    const fit: FigureFit = { dx: 0, dy: 0, x, y: y - this.rig.top * scale * 0.5, zoom: DEATH.zoom };
    if (isSovereignKind(this.kind)) {
      this.rig.animate("stagger", 0.1, 0.2, 0, facing, false, 0, 0, 1 / 60);
      const box: FigureBox = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
      this.rig.figureBox(box);
      fitFigure(x, y, scale, box, host.viewWidth(), host.camera.height - host.camera.insetBottom, DEATH.zoom, fit);
      x -= fit.dx;
      y += fit.dy;
    }
    this.x = x;
    this.y = y;
    this.s = scale;
    this.facing = facing;
    this.seed = Math.random();
    this.rig.root.position.set(x, y);
    this.rig.root.scale.set(scale);
    this.rig.shadow.position.set(x, y + 1);
    this.rig.shadow.scale.set(scale, scale * 0.9);
    const vw = host.viewWidth();
    this.black.rect(x - vw * 3, y - vw * 3, vw * 6, vw * 6).fill(0x000000);
    this.black.visible = false;
    this.cracks.blendMode = "add";
    this.rig.root.addChild(this.cracks);
    this.bolts.blendMode = "add";
    this.root.addChild(this.black, this.rig.shadow, this.rig.root, this.bolts);
    host.layer.addChild(this.root);
    for (let i = 0; i < 7; i++) this.crackSeed.push(Math.random(), Math.random(), Math.random());
    const tl = this.tl;
    tl.own(this.root);
    tl.onDispose(() => {
      this.rig.destroy();
      host.camera.hold.weight = 0;
    });
    tl.disposeOnDone = true;
    const cam = host.camera;
    cam.hold.x = fit.x;
    cam.hold.y = fit.y;
    cam.hold.zoom = fit.zoom;
    // A Sovereign's framing is reached under its inverted frame (a cut), then held.
    cam.hold.lambda = isSovereignKind(this.kind) ? 24 : 8;
    if (isSovereignKind(this.kind)) tl.at(0.2, () => (cam.hold.lambda = 8));
    cam.hold.weight = 1;
    // The inverted impact frame: two frames, boss white on black.
    if (!host.isReduced()) {
      tl.at(0, () => {
        this.black.visible = true;
        this.rig.setWhite(1);
      });
      tl.at(DEATH.inverted, () => {
        this.black.visible = false;
        this.rig.setWhite(0);
      });
    }
    tl.tween(0.15, DEATH.breakAt, easeInCubic, (k) => (this.crackK = k));
    tl.at(DEATH.breakAt, () => {
      host.cue("shatter");
      if (tl.skipping) return;
      this.shatter();
      host.ring(x, y, 20, vw * 1.4, 1.4, this.glow, 6);
      cam.shake(0.35);
      this.moteUntil = DEATH.breakAt + 2;
    });
    if (this.kind === "queen") {
      // The queen folds into a point of void before it rings out.
      tl.tween(DEATH.breakAt - 0.35, DEATH.breakAt, easeInCubic, (k) => (this.collapse = k));
      tl.at(DEATH.breakAt, () => {
        if (!tl.skipping) host.ring(x, y - this.rig.top * scale * 0.5, 4, vw * 0.9, 0.9, 0xb18cff, 4);
      });
    }
    if (this.kind === "titan") {
      tl.at(DEATH.breakAt, () => {
        if (!tl.skipping) host.flash(0xd8e8ff, 0.18, 0.2);
      });
    }
    tl.tween(DEATH.breakAt, DEATH.breakAt + 0.18, null, (k) => (this.fade = 1 - k));
    tl.tween(DEATH.length - 0.6, DEATH.length, easeInOutSine, (k) => (cam.hold.weight = 1 - k));
  }

  private shatter(): void {
    const o = this.emit;
    const s = this.s;
    const top = this.rig.top * s;
    // A Sovereign's shards are its own: mirror glass and gilt, storm-blue iron, violet ink and gold.
    const cols = this.kind === "mirror" ? [0xdfe6f5, 0xffffff, 0xe2c27a] : this.kind === "titan" ? [0x10202a, 0x6fa8ff, 0xeef6ff] : this.kind === "queen" ? [0x07040c, 0x9a6fe0, 0xc9a24f] : [0x15141a, this.glow, lighten(this.glow, 0.5)];
    for (let i = 0; i < 60; i++) {
      o.x = this.x + (Math.random() - 0.5) * top * 0.4;
      o.y = this.y - Math.random() * top * 0.7;
      o.count = 1;
      o.texture = shard();
      o.color = cols[i % 3]!;
      o.speed = [60, 220];
      o.angle = [-Math.PI * 0.85, -Math.PI * 0.15];
      o.life = [0.8, 1.6];
      o.scale = [0.25, 0.75];
      o.endScale = 0;
      o.alpha = 1;
      o.gravity = -40;
      o.drag = 0.94;
      o.spin = 6;
      o.additive = this.kind === "mirror" ? i % 3 === 1 : i % 3 !== 0;
      this.host.particles.emit(o);
    }
  }

  /** The titan's storm discharging into the ground as it breaks: bolts from above it, outward. */
  private drawBolts(): void {
    const g = this.bolts;
    g.clear();
    if (this.kind !== "titan" || this.t < 0.2 || this.t > DEATH.breakAt + 0.35) return;
    const s = this.s;
    const top = this.rig.top * s;
    const n = this.t < DEATH.breakAt ? 1 : 4;
    const seed = Math.floor(this.t * 14);
    for (let b = 0; b < n; b++) {
      const dir = b % 2 === 0 ? 1 : -1;
      let px = this.x - dir * top * 0.15;
      let py = this.y - top * 1.05;
      const ex = this.x + dir * top * (0.3 + 0.25 * b);
      const ey = this.y;
      for (let i = 1; i <= 6; i++) {
        const t = i / 6;
        const nx = i === 6 ? ex : px + (ex - px) / (7 - i) + Math.sin(seed * 3.1 + b * 1.7 + i * 2.2) * 10 * s;
        const ny = i === 6 ? ey : py + (ey - py) / (7 - i);
        g.moveTo(px, py).lineTo(nx, ny).stroke({ width: 1.8 * s, color: 0xeef6ff, alpha: 0.95 * (1 - t * 0.3) });
        px = nx;
        py = ny;
      }
    }
  }

  get done(): boolean {
    return this.tl.disposed;
  }

  update(dt: number): void {
    if (this.tl.disposed) return;
    this.t += dt;
    this.tl.update(dt);
    if (this.tl.disposed) return;
    // The kneel: the collapse pose folded part way, held.
    // The kneel: the pose blends in over the first half second, then holds until it breaks.
    this.rig.animate(this.t < DEATH.inverted ? "stagger" : "dead", 0.1, 0.2, this.seed, this.facing, false, 0, 0, dt);
    this.rig.root.alpha = this.fade;
    this.rig.shadow.alpha = this.fade;
    if (this.collapse > 0) {
      // Folding into a point at the chest.
      const c = 1 - this.collapse * 0.92;
      this.rig.root.scale.set(this.s * c, this.s * c);
      this.rig.root.y = this.y - this.rig.top * this.s * 0.5 * this.collapse;
      this.rig.root.tint = lighten(0x4a2a80, 1 - this.collapse);
    }
    this.drawCracks();
    this.drawBolts();
    if (this.t < this.moteUntil && dt > 0 && Math.random() < 0.5 && !this.host.isReduced()) {
      const o = this.emit;
      o.x = this.x + (Math.random() - 0.5) * 200 * this.s;
      o.y = this.y - Math.random() * 60 * this.s;
      o.count = 1;
      o.texture = softCircle();
      o.color = this.glow;
      o.speed = [8, 26];
      o.angle = [-Math.PI * 0.75, -Math.PI * 0.25];
      o.life = [1.0, 1.8];
      o.scale = [0.08, 0.2];
      o.endScale = 0;
      o.alpha = 0.8;
      o.gravity = -10;
      o.drag = 0.98;
      o.spin = 0;
      o.additive = true;
      this.host.particles.emit(o);
    }
  }

  /** Cracks of the boss's glow spreading from the chest over the silhouette (rig-local units). */
  private drawCracks(): void {
    const g = this.cracks;
    g.clear();
    const k = this.crackK;
    if (k <= 0 || this.fade <= 0) return;
    const top = this.rig.top;
    const cx = 0;
    const cy = -top * 0.55;
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (this.crackSeed[i * 3]! - 0.5) * Math.PI * 1.8 + (i % 2 ? Math.PI : 0);
      const len = top * (0.18 + 0.3 * this.crackSeed[i * 3 + 1]!) * k;
      let x = cx;
      let y = cy;
      g.moveTo(x, y);
      for (let j = 1; j <= 4; j++) {
        const jj = j / 4;
        x = cx + Math.cos(a) * len * jj + (this.crackSeed[i * 3 + 2]! - 0.5) * 6 * (j % 2 ? 1 : -1);
        y = cy + Math.sin(a) * len * jj;
        g.lineTo(x, y);
      }
      g.stroke({ width: 1.6, color: lighten(this.glow, 0.35), alpha: 0.95 * this.fade });
    }
    g.circle(cx, cy, 4 + 6 * k).fill({ color: this.glow, alpha: 0.5 * k * this.fade });
  }

  dispose(): void {
    this.tl.dispose();
  }
}

/** Phase change parameters (blueprint 7D): the stop, the backdrop's lasting shift toward the glow. */
export const PHASE = { stop: 0.1, tint: 0.2 } as const;

