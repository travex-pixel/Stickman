import type { Container } from "pixi.js";
import type { ActionState } from "../entities/types";
import type { WeaponPath } from "../data/ids";
import { Rig } from "./rigs/Rig";
import { playerSpec } from "./rigs/specs";
import { easeOutCubic } from "./anim/ease";

/** Ink body and gold rim of an Ascendant Fury afterimage. */
const INK = 0x15141a;
const GOLD = 0xe9c56f;
/** The rim figure is drawn this much larger behind the ink one, so a gold edge shows around it. */
const RIM_SCALE = 1.07;

interface Ghost {
  ink: Rig;
  rim: Rig;
  t: number;
  life: number;
  live: boolean;
  rimOn: boolean;
}

/**
 * The warrior's afterimages for the Ascendant Fury flurry: an ink silhouette with a gold rim left
 * where he stood before each blink, fading over about 0.3s. A small pool is built on the first
 * blink of a flurry (rig parts are shared per kind, so this builds no geometry) and released when
 * the flurry is over and the last one has faded, so the display tree returns to its baseline.
 */
export class FuryGhosts {
  private readonly pool: Ghost[] = [];
  private path: WeaponPath | null = null;

  constructor(
    private readonly layer: Container,
    private readonly size = 3,
  ) {}

  get count(): number {
    return this.pool.length;
  }

  get anyLive(): boolean {
    for (const g of this.pool) if (g.live) return true;
    return false;
  }

  /**
   * Leave an afterimage at (x, y) (base px, feet), at figure scale `scale`, holding the pose of
   * `state` at `t` of `duration`. `rim` draws the gold edge (off with reduced effects).
   */
  spawn(path: WeaponPath, x: number, y: number, scale: number, zIndex: number, facing: 1 | -1, seed: number, state: ActionState, t: number, duration: number, variant: number, life: number, rim: boolean): void {
    if (path !== this.path) {
      this.release();
      this.path = path;
    }
    let g: Ghost | undefined;
    for (const c of this.pool) {
      if (!c.live) {
        g = c;
        break;
      }
    }
    if (!g && this.pool.length < this.size) {
      const ink = new Rig(playerSpec(path));
      const rim = new Rig(playerSpec(path));
      ink.root.tint = INK;
      rim.root.tint = GOLD;
      rim.root.blendMode = "add";
      this.layer.addChild(rim.root, ink.root);
      g = { ink, rim, t: 0, life, live: false, rimOn: true };
      this.pool.push(g);
    }
    if (!g) {
      // Every afterimage is still fading: reuse the oldest.
      g = this.pool[0]!;
      for (const c of this.pool) if (c.t > g.t) g = c;
    }
    g.t = 0;
    g.life = life;
    g.live = true;
    g.rimOn = rim;
    g.ink.root.scale.set(scale);
    g.rim.root.scale.set(scale * RIM_SCALE);
    for (const rig of [g.ink, g.rim]) {
      rig.root.position.set(x, y);
      rig.snap();
      rig.animate(state, t, duration, seed, facing, false, 0, 0, 0, variant);
      rig.root.visible = true;
    }
    g.ink.root.zIndex = zIndex - 0.5;
    g.rim.root.zIndex = zIndex - 0.6;
    g.rim.root.visible = rim;
    this.fade(g);
  }

  update(dt: number): void {
    for (const g of this.pool) {
      if (!g.live) continue;
      g.t = Math.min(1, g.t + dt / g.life);
      this.fade(g);
      if (g.t >= 1) {
        g.live = false;
        g.ink.root.visible = false;
        g.rim.root.visible = false;
      }
    }
  }

  private fade(g: Ghost): void {
    const k = easeOutCubic(g.t);
    g.ink.root.alpha = 0.82 * (1 - k);
    g.rim.root.alpha = g.rimOn ? 0.9 * (1 - k) * (1 - k * 0.5) : 0;
  }

  /** Destroy the pool (the flurry is over, or the world was reset). */
  release(): void {
    for (const g of this.pool) {
      g.ink.destroy();
      g.rim.destroy();
    }
    this.pool.length = 0;
  }
}
