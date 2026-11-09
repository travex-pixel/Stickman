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

  constructor(
    private readonly step: number,
    private readonly simulate: (dt: number) => void,
    private readonly render: (alpha: number, dtReal: number) => void,
    private readonly maxSteps = 5,
  ) {}

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

    if (this.freeze > 0) {
      this.freeze -= dtReal;
      this.render(1, dtReal);
      return;
    }
    this.accumulator += dtReal;
    let steps = 0;
    while (this.accumulator >= this.step && steps < this.maxSteps) {
      this.simulate(this.step);
      this.accumulator -= this.step;
      steps += 1;
    }
    if (steps === this.maxSteps) this.accumulator = 0;
    this.render(this.accumulator / this.step, dtReal);
  }
}
