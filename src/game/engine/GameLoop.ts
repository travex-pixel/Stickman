/**
 * Fixed-timestep loop with an accumulator. Simulation advances in constant steps so
 * combat is deterministic; rendering receives an interpolation alpha for smooth motion.
 */
export class GameLoop {
  private accumulator = 0;
  private last = 0;
  private running = false;
  private raf = 0;
  private frameTimes: number[] = [];
  fps = 0;
  frameMs = 0;
  /** Extra real-time freeze (impact frames). */
  private freeze = 0;
  /** `?perf=1`: per-frame JS cost of simulate and render, for scripts/perf.mjs. */
  private perf: PerfSamples | null = null;

  constructor(
    private readonly step: number,
    private readonly simulate: (dt: number) => void,
    private readonly render: (alpha: number, dtReal: number) => void,
    private readonly maxSteps = 5,
  ) {
    if (typeof window !== "undefined" && typeof location !== "undefined" && /[?&]perf=1\b/.test(location.search)) {
      this.perf = { sim: [], render: [], frame: [], draw: [], freeze: 0 };
      (window as unknown as { __ASCEND_PERF__?: PerfSamples }).__ASCEND_PERF__ = this.perf;
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  get isRunning(): boolean {
    return this.running;
  }

  addFreeze(seconds: number): void {
    this.freeze = Math.min(0.35, this.freeze + seconds);
  }

  /** Seconds of impact freeze still to run. */
  get freezeLeft(): number {
    return this.freeze;
  }

  /** Reset timing after the tab was hidden so we don't fast-forward a stale accumulator. */
  resync(): void {
    this.last = performance.now();
    this.accumulator = 0;
  }

  frame(now: number): void {
    let dtReal = (now - this.last) / 1000;
    this.last = now;
    if (dtReal > 0.25) dtReal = 0.25;
    this.frameMs = dtReal * 1000;
    this.frameTimes.push(dtReal);
    if (this.frameTimes.length > 30) this.frameTimes.shift();
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.fps = avg > 0 ? Math.round(1 / avg) : 0;

    const perf = this.perf;
    if (this.freeze > 0) {
      this.freeze -= dtReal;
      if (perf) {
        perf.freeze += dtReal;
        const r0 = performance.now();
        this.render(1, dtReal);
        perf.sim.push(0);
        perf.render.push(performance.now() - r0);
        perf.frame.push(dtReal * 1000);
      } else this.render(1, dtReal);
      return;
    }
    const s0 = perf ? performance.now() : 0;
    this.accumulator += dtReal;
    let steps = 0;
    while (this.accumulator >= this.step && steps < this.maxSteps) {
      this.simulate(this.step);
      this.accumulator -= this.step;
      steps += 1;
    }
    if (steps === this.maxSteps) this.accumulator = 0;
    if (perf) {
      const s1 = performance.now();
      this.render(this.accumulator / this.step, dtReal);
      perf.sim.push(s1 - s0);
      perf.render.push(performance.now() - s1);
      perf.frame.push(dtReal * 1000);
    } else this.render(this.accumulator / this.step, dtReal);
  }
}

/** Raw per-frame samples in milliseconds; the harness resets and reads them. */
export interface PerfSamples {
  sim: number[];
  render: number[];
  frame: number[];
  /** The part of `render` spent in Pixi's draw submission (pushed by the renderer). */
  draw: number[];
  /** Seconds spent in impact freeze since the last reset. */
  freeze: number;
}
