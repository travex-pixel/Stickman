/**
 * The battle screen's one line of news. Everything the game wants to say over the fight goes
 * through here, so only one pill is ever on screen:
 *
 * - the same text again adds to a count ("x3") instead of showing again;
 * - an urgent line (2) shows at once and replaces whatever is up; ordinary news (1) waits its
 *   turn, and waits out a boss or mode fight altogether; chatter (0) shows only when the spot is
 *   free and nothing is waiting, and is otherwise dropped;
 * - while something else owns the spot (`blocked`: the Ascendant Fury's running total), news
 *   waits and chatter is dropped;
 * - a line lasts about two seconds, a little longer if it is long.
 *
 * Time is passed in, so the rules can be tested without a clock.
 */
export type PillPriority = 0 | 1 | 2;

export interface PillItem<Tone extends string = string> {
  text: string;
  tone: Tone;
  priority: PillPriority;
  /** How many times this line was raised while shown or waiting. */
  count: number;
}

export interface PillShown<Tone extends string = string> extends PillItem<Tone> {
  id: number;
  /** When it leaves (same clock as `now`). */
  until: number;
}

export interface PillContext {
  /** A boss, a Tyrant or a mode run is being fought: ordinary news waits for it to end. */
  fighting: boolean;
  /** Something else is drawn where the pill sits. */
  blocked: boolean;
}

export const PILL_LIFE_MS = 1800;
export const PILL_URGENT_LIFE_MS = 2200;
/** Lines longer than this (an explanation, not a headline) stay a little longer. */
export const PILL_LONG_CHARS = 48;
export const PILL_LONG_EXTRA_MS = 900;
/** Waiting lines kept; past this the oldest ordinary one is dropped. */
export const PILL_QUEUE_CAP = 4;
/** News that has waited this long is no longer news. */
export const PILL_STALE_MS = 45_000;

interface Waiting<Tone extends string> extends PillItem<Tone> {
  since: number;
}

export class EventPill<Tone extends string = string> {
  private shown: PillShown<Tone> | null = null;
  private readonly queue: Waiting<Tone>[] = [];
  private nextId = 0;

  get current(): PillShown<Tone> | null {
    return this.shown;
  }

  get waiting(): number {
    return this.queue.length;
  }

  private life(item: PillItem<Tone>): number {
    return (item.priority === 2 ? PILL_URGENT_LIFE_MS : PILL_LIFE_MS) + (item.text.length > PILL_LONG_CHARS ? PILL_LONG_EXTRA_MS : 0);
  }

  private show(item: PillItem<Tone>, now: number): void {
    this.shown = { text: item.text, tone: item.tone, priority: item.priority, count: item.count, id: ++this.nextId, until: now + this.life(item) };
  }

  private enqueue(item: PillItem<Tone>, now: number): void {
    const same = this.queue.find((q) => q.text === item.text);
    if (same) {
      same.count += item.count;
      return;
    }
    // Urgent lines go ahead of ordinary ones, each kind in the order it arrived.
    const w: Waiting<Tone> = { ...item, since: now };
    const firstLower = this.queue.findIndex((q) => q.priority < item.priority);
    if (firstLower >= 0) this.queue.splice(firstLower, 0, w);
    else this.queue.push(w);
    while (this.queue.length > PILL_QUEUE_CAP) {
      // Drop the oldest of the least important kind waiting.
      const low = Math.min(...this.queue.map((q) => q.priority));
      this.queue.splice(this.queue.findIndex((q) => q.priority === low), 1);
    }
  }

  /** Raise a line. Returns whether what is on screen changed. */
  push(text: string, tone: Tone, priority: PillPriority, now: number, ctx: PillContext): boolean {
    const cur = this.shown;
    if (cur && cur.text === text) {
      // The same line again: count it and let it stay its full time from now.
      this.shown = { ...cur, count: cur.count + 1, priority: priority > cur.priority ? priority : cur.priority, until: now + this.life(cur) };
      return true;
    }
    const item: PillItem<Tone> = { text, tone, priority, count: 1 };
    if (ctx.blocked) {
      if (priority > 0) this.enqueue(item, now);
      return false;
    }
    if (priority === 2) {
      // What it replaces goes back in line if it was news that had barely been seen.
      if (cur && cur.priority === 1 && cur.until - now > this.life(cur) / 2) this.enqueue(cur, now);
      this.show(item, now);
      return true;
    }
    if (priority === 0) {
      if (cur || this.queue.length > 0 || ctx.fighting) return false;
      this.show(item, now);
      return true;
    }
    if (ctx.fighting || (cur && cur.priority >= 1) || this.queue.length > 0) {
      this.enqueue(item, now);
      return false;
    }
    this.show(item, now);
    return true;
  }

  /** Once a frame: retire a line whose time is up and bring on the next. Returns whether the screen changed. */
  tick(now: number, ctx: PillContext): boolean {
    let changed = false;
    if (this.shown && now >= this.shown.until) {
      this.shown = null;
      changed = true;
    }
    if (this.shown || ctx.blocked || this.queue.length === 0) return changed;
    while (this.queue.length > 0 && now - this.queue[0]!.since > PILL_STALE_MS) this.queue.shift();
    const i = this.queue.findIndex((q) => q.priority === 2 || !ctx.fighting);
    if (i < 0) return changed;
    const [next] = this.queue.splice(i, 1);
    this.show(next!, now);
    return true;
  }

  /** Leaving a fight: what was waiting belonged to it. The line on screen finishes its time. */
  clear(): void {
    this.queue.length = 0;
  }
}
