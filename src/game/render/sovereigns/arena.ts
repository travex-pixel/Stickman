import { Container, Sprite, Texture } from "pixi.js";
import type { SovereignArena } from "../../data/sovereigns";
import type { VisualQuality } from "../../data/signatures";
import { shard, softCircle } from "../textures";

/**
 * What moves in a Sovereign's arena, over its painted backdrop (Background.ts paints the rest once).
 * Every piece is a pooled sprite made when the arena is built; nothing is made per frame. Each
 * quality tier draws fewer, and reduced effects keeps them calm (no lightning, slower rain).
 *
 *  - mirror_hall: shards of glass light drifting and catching the light in the hall's air.
 *  - storm_sea: rain slanting through the field, a wet sheen sliding on the ground, and sheet
 *    lightning far off in the sky (only when the flash budget allows it: it is a large-area light).
 *  - void_throne: motes of void drawn slowly toward the hall's centre, the void there breathing, and
 *    the eyes of the kneeling court opening in the dark.
 *
 * The bodies' reflections on the mirror floor are the renderer's (they follow the fighters).
 */
interface Piece {
  s: Sprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  total: number;
  phase: number;
}

/** Pieces per arena at each tier (full, balanced, performance); reduced effects takes the lowest. */
export const ARENA_PIECES: Record<SovereignArena, Record<VisualQuality, number>> = {
  mirror_hall: { full: 12, balanced: 6, performance: 3 },
  storm_sea: { full: 36, balanced: 18, performance: 8 },
  void_throne: { full: 14, balanced: 7, performance: 3 },
};

export class ArenaLive {
  readonly back = new Container();
  private readonly pieces: Piece[] = [];
  private readonly glow = new Sprite(softCircle());
  private readonly sheen = new Sprite(softCircle());
  private readonly eyes: Sprite[] = [];
  private width = 0;
  private height = 0;
  private groundTop = 0;
  private quality: VisualQuality = "full";
  private reduced = false;
  private time = 0;
  private boltIn = 3;
  private bolt = -1;

  constructor(
    readonly arena: SovereignArena,
    private readonly flash: (alpha: number) => boolean,
  ) {
    const n = ARENA_PIECES[arena].full;
    for (let i = 0; i < n; i++) {
      const s = new Sprite(arena === "storm_sea" ? Texture.WHITE : arena === "mirror_hall" ? shard() : softCircle());
      s.anchor.set(0.5);
      s.blendMode = "add";
      s.visible = false;
      this.back.addChild(s);
      this.pieces.push({ s, x: 0, y: 0, vx: 0, vy: 0, life: 0, total: 1, phase: Math.random() * 6.28 });
    }
    this.glow.anchor.set(0.5);
    this.glow.blendMode = "add";
    this.glow.alpha = 0;
    this.sheen.anchor.set(0.5);
    this.sheen.blendMode = "add";
    this.sheen.alpha = 0;
    this.back.addChildAt(this.glow, 0);
    this.back.addChildAt(this.sheen, 0);
    if (arena === "storm_sea") this.glow.tint = 0xcfe6ff;
    if (arena === "void_throne") {
      this.glow.tint = 0x6a3fb0;
      this.sheen.tint = 0x2a1440;
      for (let i = 0; i < 8; i++) {
        const e = new Sprite(softCircle());
        e.anchor.set(0.5);
        e.blendMode = "add";
        e.tint = 0xd8c4ff;
        e.alpha = 0;
        this.eyes.push(e);
        this.back.addChild(e);
      }
    }
    if (arena === "mirror_hall") this.sheen.tint = 0xf4f6ff;
    if (arena === "storm_sea") this.sheen.tint = 0x9fd0e0;
  }

  setQuality(q: VisualQuality): void {
    this.quality = q;
  }

  setReduced(v: boolean): void {
    this.reduced = v;
  }

  /** Pieces drawn now. */
  get count(): number {
    return this.reduced ? Math.min(ARENA_PIECES[this.arena].performance, ARENA_PIECES[this.arena][this.quality]) : ARENA_PIECES[this.arena][this.quality];
  }

  layout(width: number, height: number, groundTop: number): void {
    this.width = width;
    this.height = height;
    this.groundTop = groundTop;
    const gh = height - groundTop;
    if (this.arena === "storm_sea") {
      this.glow.position.set(width * 0.3, groundTop * 0.35);
      this.glow.scale.set((width * 1.1) / 64, (groundTop * 0.7) / 64);
      this.sheen.position.set(width * 0.5, groundTop + gh * 0.35);
      this.sheen.scale.set((width * 0.5) / 64, (gh * 0.08) / 64);
    } else if (this.arena === "void_throne") {
      this.glow.position.set(width * 0.5, groundTop + gh * 0.4);
      this.glow.scale.set((width * 0.6) / 64, (gh * 0.3) / 64);
      this.sheen.position.set(width * 0.5, groundTop + gh * 0.4);
      this.sheen.scale.set((width * 0.4) / 64, (gh * 0.16) / 64);
      // The court's eyes sit on the kneeling figures painted beside the throne.
      for (let i = 0; i < this.eyes.length; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const x = width * 0.5 + side * width * (0.16 + (i >> 1) * 0.1) + 3;
        const e = this.eyes[i]!;
        e.position.set(x, groundTop - 26);
        e.scale.set(0.05, 0.03);
      }
    } else {
      this.sheen.position.set(width * 0.5, groundTop + gh * 0.25);
      this.sheen.scale.set((width * 0.18) / 64, (gh * 0.6) / 64);
    }
  }

  update(dt: number): void {
    if (this.width <= 0) return;
    this.time += dt;
    const n = this.count;
    for (let i = 0; i < this.pieces.length; i++) {
      const p = this.pieces[i]!;
      if (i >= n) {
        p.s.visible = false;
        p.life = 0;
        continue;
      }
      if (p.life <= 0) this.spawn(p, i);
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      this.place(p);
    }
    const t = this.time;
    if (this.arena === "storm_sea") {
      // A wet sheen sliding on the ground.
      this.sheen.alpha = this.reduced ? 0.06 : 0.1 + 0.05 * Math.sin(t * 0.7);
      this.sheen.x = this.width * (0.5 + 0.3 * Math.sin(t * 0.13));
      this.lightning(dt);
    } else if (this.arena === "void_throne") {
      // The void at the centre breathes; the court's eyes open and close in the dark.
      this.glow.alpha = 0.16 + 0.08 * Math.sin(t * 0.8);
      this.sheen.alpha = 0.35;
      // The court's eyes are a full-quality touch (a few more sprites for the batcher).
      const eyes = this.quality === "full" && !this.reduced;
      for (let i = 0; i < this.eyes.length; i++) {
        const k = Math.sin(t * 0.35 + i * 1.9);
        const e = this.eyes[i]!;
        e.visible = eyes && k > 0.6;
        e.alpha = k > 0.6 ? (k - 0.6) * 2 : 0;
      }
    } else {
      this.sheen.alpha = 0.05 + 0.03 * Math.sin(t * 0.5);
      this.sheen.x = this.width * (0.5 + 0.35 * Math.sin(t * 0.09));
    }
  }

  /** Sheet lightning far off: a double flicker in the sky, only when the flash budget grants it. */
  private lightning(dt: number): void {
    if (this.bolt >= 0) {
      this.bolt += dt;
      const k = this.bolt;
      this.glow.alpha = k < 0.08 ? 0.32 : k < 0.14 ? 0.08 : k < 0.24 ? 0.24 * (1 - (k - 0.14) / 0.1) : 0;
      if (k > 0.3) {
        this.bolt = -1;
        this.glow.alpha = 0;
      }
      return;
    }
    if (this.reduced) return;
    this.boltIn -= dt;
    if (this.boltIn > 0) return;
    this.boltIn = 4 + Math.random() * 5;
    if (!this.flash(0.12)) return;
    this.bolt = 0;
    this.glow.x = this.width * (0.15 + Math.random() * 0.7);
  }

  private spawn(p: Piece, i: number): void {
    const w = this.width;
    const gt = this.groundTop;
    const s = p.s;
    s.visible = true;
    if (this.arena === "storm_sea") {
      // Rain: thin streaks slanting down across the whole field.
      p.x = Math.random() * (w + 80) - 40;
      p.y = -20 - Math.random() * this.height * 0.6;
      const speed = this.reduced ? 380 : 620 + Math.random() * 180;
      p.vx = -speed * 0.22;
      p.vy = speed;
      p.total = p.life = (this.height + 40) / speed;
      s.tint = i % 3 === 0 ? 0xd8eef6 : 0x8fb5c4;
      s.scale.set(0.8, 9 + Math.random() * 8);
      s.rotation = Math.atan2(-p.vx, p.vy);
      s.alpha = 0.16 + Math.random() * 0.14;
    } else if (this.arena === "mirror_hall") {
      // Shards of glass light hanging in the air, drifting down slowly, catching the light.
      p.x = Math.random() * w;
      p.y = gt * (0.25 + Math.random() * 0.9);
      p.vx = (Math.random() - 0.5) * 6;
      p.vy = 3 + Math.random() * 5;
      p.total = p.life = 5 + Math.random() * 5;
      s.tint = i % 3 === 0 ? 0xe9c97a : 0xf4f6ff;
      s.scale.set(0.12 + Math.random() * 0.12);
    } else {
      // Motes of void rising and drawn toward the hall's centre.
      p.x = Math.random() * w;
      p.y = gt + Math.random() * (this.height - gt) * 0.6;
      p.vx = (w * 0.5 - p.x) * 0.04;
      p.vy = -(4 + Math.random() * 6);
      p.total = p.life = 5 + Math.random() * 4;
      s.tint = i % 4 === 0 ? 0xe9c97a : 0xb18cff;
      s.scale.set(0.05 + Math.random() * 0.05);
    }
  }

  private place(p: Piece): void {
    const s = p.s;
    s.position.set(p.x, p.y);
    const k = p.life / Math.max(0.01, p.total);
    if (this.arena === "mirror_hall") {
      // A glint: bright for a moment as it turns.
      const turn = Math.sin(this.time * 2.2 + p.phase);
      s.rotation = this.time * 0.6 + p.phase;
      s.alpha = Math.sin(k * Math.PI) * (0.18 + 0.5 * Math.max(0, turn) ** 4);
    } else if (this.arena === "void_throne") {
      s.alpha = Math.sin(k * Math.PI) * 0.5;
    }
  }

  destroy(): void {
    this.back.destroy({ children: true });
    this.pieces.length = 0;
    this.eyes.length = 0;
  }
}
