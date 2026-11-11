/**
 * A small sequencer for cinematics. Cues fire once when the playhead crosses their time; tweens
 * run an eased 0..1 progress into a callback between two times (and are always handed their
 * final value once, even when a long frame or a skip jumps past them). Labels name times so a
 * sequence can be skipped to a beat.
 *
 * A timeline owns what it is given with `own`: on `dispose` (or when it finishes, if
 * `disposeOnDone` is set) every owned object is destroyed and every `onDispose` hook runs. Nothing
 * here allocates per frame: cues and tweens are registered when the sequence is built.
 */
export type Ease = (t: number) => number;

interface Cue {
  t: number;
  fn: () => void;
  fired: boolean;
}

interface Tween {
  t0: number;
  t1: number;
  ease: Ease | null;
  fn: (k: number) => void;
  /** 0 not started, 1 running, 2 finished (final value delivered). */
  phase: 0 | 1 | 2;
}

export interface Destroyable {
  destroy(options?: unknown): void;
  readonly destroyed?: boolean;
}

const linear: Ease = (t) => t;

export class Timeline {
  /** Playhead, seconds. */
  t = 0;
  /** The playhead reached `length`. */
  done = false;
  /** Disposed: owned objects are gone, and `update` does nothing. */
  disposed = false;
  /** True while `skipTo` fast-forwards: cues can use it to skip bursts that only make sense live. */
  skipping = false;
  /** Total length; the timeline is done once the playhead passes it. */
  length = 0;
  /** Destroy owned objects as soon as the timeline is done. */
  disposeOnDone = false;
  private readonly cues: Cue[] = [];
  private readonly tweens: Tween[] = [];
  private readonly labels = new Map<string, number>();
  private readonly owned: Destroyable[] = [];
  private readonly hooks: (() => void)[] = [];
  private sorted = true;

  constructor(length = 0) {
    this.length = length;
  }

  /** Run `fn` once when the playhead reaches `t`. Cues at the same time run in the order added. */
  at(t: number, fn: () => void): this {
    const last = this.cues[this.cues.length - 1];
    if (last && last.t > t) this.sorted = false;
    this.cues.push({ t, fn, fired: false });
    if (t > this.length) this.length = t;
    return this;
  }

  /** Call `fn(ease(k))` every frame while the playhead is in [t0, t1], and once with 1 after. */
  tween(t0: number, t1: number, ease: Ease | null, fn: (k: number) => void): this {
    this.tweens.push({ t0, t1: Math.max(t0, t1), ease, fn, phase: 0 });
    if (t1 > this.length) this.length = t1;
    return this;
  }

  /** Name a time. */
  label(name: string, t: number): this {
    this.labels.set(name, t);
    return this;
  }

  labelTime(name: string): number | undefined {
    return this.labels.get(name);
  }

  /** The timeline destroys `obj` when it is disposed. Returns it for chaining. */
  own<T extends Destroyable>(obj: T): T {
    this.owned.push(obj);
    return obj;
  }

  /** Run `fn` when the timeline is disposed (restore a tint, release a camera override). */
  onDispose(fn: () => void): this {
    this.hooks.push(fn);
    return this;
  }

  /** Advance by `dt` seconds. */
  update(dt: number): void {
    if (this.disposed || this.done) return;
    this.advanceTo(this.t + Math.max(0, dt));
  }

  /**
   * Jump to a label (or a time): every cue before it fires (with `skipping` set) and every tween
   * before it is handed its final value, in time order, so the scene lands in the state the
   * sequence would have built.
   */
  skipTo(target: string | number): void {
    if (this.disposed) return;
    const t = typeof target === "number" ? target : this.labels.get(target);
    if (t === undefined || t <= this.t) return;
    this.skipping = true;
    try {
      this.advanceTo(t);
    } finally {
      this.skipping = false;
    }
  }

  private advanceTo(t: number): void {
    if (!this.sorted) {
      this.cues.sort((a, b) => a.t - b.t);
      this.sorted = true;
    }
    const from = this.t;
    this.t = t;
    // Tweens that finished before this step's cues are settled first, then cues in order, then
    // the running tweens: a cue at 1.0 sees every tween that ended by 1.0 at its final value.
    for (const c of this.cues) {
      if (c.fired) continue;
      if (c.t > t) break;
      this.settleTweensBefore(c.t);
      c.fired = true;
      c.fn();
      if (this.disposed) return;
    }
    for (const tw of this.tweens) {
      if (tw.phase === 2) continue;
      if (t < tw.t0) continue;
      if (t >= tw.t1) {
        tw.phase = 2;
        tw.fn((tw.ease ?? linear)(1));
      } else {
        tw.phase = 1;
        const k = (t - tw.t0) / (tw.t1 - tw.t0);
        tw.fn((tw.ease ?? linear)(k));
      }
      if (this.disposed) return;
    }
    void from;
    if (t >= this.length) {
      this.done = true;
      if (this.disposeOnDone) this.dispose();
    }
  }

  private settleTweensBefore(t: number): void {
    for (const tw of this.tweens) {
      if (tw.phase === 2 || tw.t1 > t) continue;
      tw.phase = 2;
      tw.fn((tw.ease ?? linear)(1));
    }
  }

  /** Destroy everything the timeline owns. Safe to call more than once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.done = true;
    for (const fn of this.hooks) fn();
    this.hooks.length = 0;
    for (const o of this.owned) if (!o.destroyed) o.destroy({ children: true });
    this.owned.length = 0;
  }
}
