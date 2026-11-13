/** A toast as the controller raises it. */
export interface HeldToast {
  text: string;
  tone: string;
  low: boolean;
}

/**
 * Toasts held back while something else owns their spot (the Ascendant Fury's running total):
 * a short queue, important ones before routine ones, the same text once, at most `cap` kept (the
 * newest routine one is the first dropped). The controller shows them one at a time once the spot
 * is free, and clears them when the fight they belong to is left.
 */
export class ToastHold<T extends HeldToast = HeldToast> {
  private readonly queue: T[] = [];

  constructor(private readonly cap = 3) {}

  get size(): number {
    return this.queue.length;
  }

  add(t: T): void {
    if (this.queue.some((q) => q.text === t.text)) return;
    const firstLow = this.queue.findIndex((q) => q.low);
    if (!t.low && firstLow >= 0) this.queue.splice(firstLow, 0, t);
    else this.queue.push(t);
    while (this.queue.length > this.cap) this.queue.pop();
  }

  /** The next toast to show, removed from the queue. */
  next(): T | null {
    return this.queue.shift() ?? null;
  }

  clear(): void {
    this.queue.length = 0;
  }
}
