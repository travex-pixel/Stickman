import { Container, Sprite, type Texture } from "pixi.js";

interface Particle {
  sprite: Sprite;
  vx: number;
  vy: number;
  life: number;
  total: number;
  drag: number;
  gravity: number;
  startScale: number;
  endScale: number;
  startAlpha: number;
  endAlpha: number;
  spin: number;
  align: boolean;
  active: boolean;
  /** Optional attractor (used by the summon cinematic) */
  target?: { x: number; y: number; strength: number };
}

export interface EmitOptions {
  x: number;
  y: number;
  count: number;
  texture: Texture;
  color: number;
  speed: [number, number];
  angle?: [number, number];
  life: [number, number];
  scale: [number, number];
  endScale?: number;
  alpha?: number;
  gravity?: number;
  drag?: number;
  additive?: boolean;
  spin?: number;
  spread?: number;
  target?: { x: number; y: number; strength: number };
  /** Rotate each particle to its velocity (streaks, sparks). */
  alignToVelocity?: boolean;
}

/** Pooled sprite particles with a hard cap; cheap and never unbounded. */
export class ParticleSystem {
  readonly container = new Container();
  private pool: Particle[] = [];
  private activeCount = 0;
  private cap: number;
  /** Multiplies every emit count (reduced motion: 0.4). */
  countScale = 1;

  constructor(cap = 420) {
    this.cap = cap;
    for (let i = 0; i < cap; i++) {
      const sprite = new Sprite();
      sprite.anchor.set(0.5);
      sprite.visible = false;
      this.container.addChild(sprite);
      this.pool.push({ sprite, vx: 0, vy: 0, life: 0, total: 1, drag: 0, gravity: 0, startScale: 1, endScale: 0, startAlpha: 1, endAlpha: 0, spin: 0, align: false, active: false });
    }
  }

  setCap(cap: number): void {
    this.cap = Math.min(cap, this.pool.length);
  }

  get count(): number {
    return this.activeCount;
  }

  emit(o: EmitOptions): void {
    let emitted = 0;
    const count = this.countScale < 1 ? Math.max(1, Math.round(o.count * this.countScale)) : o.count;
    for (const p of this.pool) {
      if (emitted >= count) break;
      if (p.active) continue;
      if (this.activeCount >= this.cap) break;
      const ang = o.angle ? o.angle[0] + Math.random() * (o.angle[1] - o.angle[0]) : Math.random() * Math.PI * 2;
      const sp = o.speed[0] + Math.random() * (o.speed[1] - o.speed[0]);
      const spread = o.spread ?? 0;
      p.sprite.texture = o.texture;
      p.sprite.tint = o.color;
      p.sprite.position.set(o.x + (Math.random() - 0.5) * spread, o.y + (Math.random() - 0.5) * spread);
      p.sprite.blendMode = o.additive === false ? "normal" : "add";
      p.sprite.rotation = Math.random() * Math.PI * 2;
      p.vx = Math.cos(ang) * sp;
      p.vy = Math.sin(ang) * sp;
      p.total = o.life[0] + Math.random() * (o.life[1] - o.life[0]);
      p.life = p.total;
      p.drag = o.drag ?? 0.9;
      p.gravity = o.gravity ?? 0;
      p.startScale = o.scale[0] + Math.random() * (o.scale[1] - o.scale[0]);
      p.endScale = o.endScale ?? 0;
      p.startAlpha = o.alpha ?? 1;
      p.endAlpha = 0;
      p.spin = (o.spin ?? 0) * (Math.random() - 0.5) * 2;
      p.target = o.target;
      p.align = o.alignToVelocity ?? false;
      if (p.align) p.sprite.rotation = ang;
      p.active = true;
      p.sprite.visible = true;
      p.sprite.scale.set(p.startScale);
      p.sprite.alpha = p.startAlpha;
      this.activeCount += 1;
      emitted += 1;
    }
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.sprite.visible = false;
        this.activeCount -= 1;
        continue;
      }
      const k = 1 - p.life / p.total;
      if (p.target) {
        const dx = p.target.x - p.sprite.x;
        const dy = p.target.y - p.sprite.y;
        p.vx += dx * p.target.strength * dt;
        p.vy += dy * p.target.strength * dt;
      }
      p.vy += p.gravity * dt;
      const drag = Math.pow(p.drag, dt * 60);
      p.vx *= drag;
      p.vy *= drag;
      p.sprite.x += p.vx * dt;
      p.sprite.y += p.vy * dt;
      if (p.align) p.sprite.rotation = Math.atan2(p.vy, p.vx);
      else p.sprite.rotation += p.spin * dt;
      const sc = p.startScale + (p.endScale - p.startScale) * k;
      p.sprite.scale.set(Math.max(0.001, sc));
      p.sprite.alpha = p.startAlpha + (p.endAlpha - p.startAlpha) * (k * k);
    }
  }

  clear(): void {
    for (const p of this.pool) {
      p.active = false;
      p.sprite.visible = false;
    }
    this.activeCount = 0;
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.pool = [];
  }
}
