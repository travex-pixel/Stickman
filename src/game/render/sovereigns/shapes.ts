import { Graphics, GraphicsContext, type Container } from "pixi.js";

/**
 * Shapes for the Sovereigns' mechanics that are built once and then only moved, scaled, turned and
 * faded. Pixi tessellates a Graphics again every frame its geometry changes; a mechanic drawn from
 * scratch each frame paid that for every ring, curve and pane while it ran. Here geometry is built
 * only when what it depends on changes (a size, a colour, a body that moved a pixel); everything
 * that animates goes on the transform and the alpha.
 *
 *  - A shared shape (`ShapeBank`) is built once per distinct set of parameters and kept for the
 *    fight: the same well, sigil or pane is drawn from one context however many times it appears.
 *  - A piece's own shape (`Piece.own`) follows a body or a moving end: it is rebuilt only when its
 *    parameters (quantized by the caller) change.
 *
 * Draw functions take every input as an argument and capture nothing, so nothing is allocated per
 * frame.
 */
export type ShapeDraw = (c: GraphicsContext, a: number, b: number, c2: number, d: number, e: number, f: number, g: number) => void;

const EMPTY = new GraphicsContext();

/** Shared contexts by kind and parameters, built once each for the fight (cleared with it). */
export class ShapeBank {
  private readonly map = new Map<string, GraphicsContext>();
  /** Contexts built, for diagnostics and tests. */
  built = 0;

  get(kind: string, draw: ShapeDraw, a: number, b: number, c: number, d: number, e: number, f: number, g: number): GraphicsContext {
    const key = `${kind}|${a}|${b}|${c}|${d}|${e}|${f}|${g}`;
    let ctx = this.map.get(key);
    if (!ctx) {
      ctx = new GraphicsContext();
      draw(ctx, a, b, c, d, e, f, g);
      this.map.set(key, ctx);
      this.built += 1;
    }
    return ctx;
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    for (const c of this.map.values()) c.destroy();
    this.map.clear();
  }
}

/** One displayed shape of a staged mechanic. */
export class Piece {
  readonly g = new Graphics();
  private kind = "";
  private a = NaN;
  private b = NaN;
  private c = NaN;
  private d = NaN;
  private e = NaN;
  private f = NaN;
  private h = NaN;
  /** Its own context (for `own`), made on first use. */
  private mine: GraphicsContext | null = null;
  /** Times its geometry was built (own) or swapped (shared), for diagnostics and tests. */
  builds = 0;
  /** The frame it was last drawn in (its owner hides it when a frame passes it by). */
  stamp = -1;

  private same(kind: string, a: number, b: number, c: number, d: number, e: number, f: number, h: number): boolean {
    if (kind === this.kind && a === this.a && b === this.b && c === this.c && d === this.d && e === this.e && f === this.f && h === this.h) return true;
    this.kind = kind;
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
    this.h = h;
    return false;
  }

  /** Show the bank's shape for these parameters (built once per distinct set in the fight). */
  shared(bank: ShapeBank, kind: string, draw: ShapeDraw, a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, h = 0): this {
    if (!this.same(kind, a, b, c, d, e, f, h)) {
      this.g.context = bank.get(kind, draw, a, b, c, d, e, f, h);
      this.builds += 1;
    }
    this.g.visible = true;
    return this;
  }

  /** Show this piece's own shape, rebuilt only when its parameters change. */
  own(kind: string, draw: ShapeDraw, a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, h = 0): this {
    if (!this.same(kind, a, b, c, d, e, f, h) || this.g.context !== this.mine) {
      if (!this.mine) this.mine = new GraphicsContext();
      else this.mine.clear();
      draw(this.mine, a, b, c, d, e, f, h);
      if (this.g.context !== this.mine) this.g.context = this.mine;
      this.builds += 1;
    }
    this.g.visible = true;
    return this;
  }

  /** Place it (base px), its scale, turn and alpha. */
  at(x: number, y: number, sx = 1, sy = sx, rotation = 0, alpha = 1): this {
    const g = this.g;
    g.position.set(x, y);
    g.scale.set(sx, sy);
    g.rotation = rotation;
    g.alpha = alpha;
    return this;
  }

  hide(): void {
    this.g.visible = false;
  }

  /** Forget the shape it shows (back to the pool). */
  reset(): void {
    this.kind = "";
    this.a = this.b = this.c = this.d = this.e = this.f = this.h = NaN;
    this.g.context = EMPTY;
    this.g.visible = false;
  }

  destroy(): void {
    this.g.context = EMPTY;
    this.mine?.destroy();
    this.mine = null;
    this.g.destroy();
  }
}

/** Pieces lent to mechanics, kept for reuse (each on a layer, normal or added light). */
export class PiecePool {
  private readonly free: Piece[] = [];
  lent = 0;

  /** A piece on `layer`, at `index` among its children (on top when omitted). */
  take(layer: Container, add: boolean, index = -1): Piece {
    const p = this.free.pop() ?? new Piece();
    p.g.blendMode = add ? "add" : "normal";
    p.g.zIndex = 0;
    p.builds = 0;
    p.stamp = -1;
    p.at(0, 0);
    if (index >= 0 && index <= layer.children.length) layer.addChildAt(p.g, index);
    else layer.addChild(p.g);
    this.lent += 1;
    return p;
  }

  give(p: Piece): void {
    p.reset();
    p.g.removeFromParent();
    this.lent -= 1;
    if (this.free.length < 64) this.free.push(p);
    else p.destroy();
  }

  destroy(): void {
    for (const p of this.free) p.destroy();
    this.free.length = 0;
  }
}

/** Round to a step (geometry is rebuilt only when a quantized parameter moves). */
export function q(v: number, step = 0.5): number {
  return Math.round(v / step) * step;
}
