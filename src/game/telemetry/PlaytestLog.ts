/**
 * Playtest log: what a real session on a real device looked like. Pure data, no DOM, no network.
 * `attachPlaytest` (PlaytestRecorder.ts) feeds it; the report is shown to the player, who chooses
 * whether to copy it and send it.
 */

/** What the recorder reads from the game once a second. */
export interface PlaytestSnapshot {
  kills: number;
  gold: number;
  level: number;
  stageCleared: number;
  bossGate: number;
  bossWins: number;
  bossLosses: number;
  upgrades: number;
  shadows: number;
  deployed: number;
  items: number;
  equipped: number;
  tutorialDone: boolean;
  /** Label of the tutorial step on screen, or null. */
  guide: string | null;
  /** Kind of the card on screen, or null. */
  card: string | null;
  panel: string;
  mode: string;
  dead: boolean;
}

export interface TapInfo {
  x: number;
  y: number;
  /** A stable name for what was hit (test id or tag), or "" for nothing. */
  target: string;
  /** The tap landed on a control (or the battlefield, where a tap focuses an enemy). */
  interactive: boolean;
}

/** Frame-time buckets in ms: at or under 17 (60 fps), 22, 34 (30 fps), 50, and slower. */
export const FRAME_BUCKETS = [17, 22, 34, 50] as const;
const RAGE_WINDOW_S = 0.7;
const RAGE_RADIUS = 36;
const RAGE_COUNT = 3;
const MAX_FRAME_SAMPLES = 20_000;

export interface PlaytestReport {
  v: 1;
  seconds: number;
  activeSeconds: number;
  device: Record<string, string | number>;
  frames: { count: number; p50: number; p95: number; p99: number; worst: number; buckets: number[]; over34ms: number; fpsByMinute: number[] };
  firsts: Record<string, number>;
  tutorial: { label: string; shown: number; waited: number | null }[];
  cards: { count: number; seconds: number; list: { kind: string; at: number; seconds: number }[] };
  deadAir: { seconds: number; from: number; to: number };
  taps: { total: number; dead: number; rage: number; firstTapAt: number | null; top: [string, number][]; deadSpots: { x: number; y: number }[] };
  panels: Record<string, number>;
  end: { level: number; stageCleared: number; shadows: number; upgrades: number; bossWins: number; bossLosses: number; tutorialDone: boolean };
  hidden: number;
  survey: Record<string, number | string>;
}

export class PlaytestLog {
  private t = 0;
  private active = 0;
  private frames: number[] = [];
  private buckets = new Array<number>(FRAME_BUCKETS.length + 1).fill(0);
  private worst = 0;
  private frameCount = 0;
  private minuteFrames: number[] = [];
  private minuteTime: number[] = [];
  private firsts: Record<string, number> = {};
  private steps: { label: string; shown: number; done: number | null }[] = [];
  private lastGuide: string | null = null;
  private cards: { kind: string; at: number; seconds: number }[] = [];
  private openCard: { kind: string; at: number } | null = null;
  private tapTotal = 0;
  private dead = 0;
  private rage = 0;
  private firstTapAt: number | null = null;
  private recent: { t: number; x: number; y: number }[] = [];
  private byTarget = new Map<string, number>();
  private deadSpots: { x: number; y: number }[] = [];
  private panels: Record<string, number> = {};
  private last: PlaytestSnapshot | null = null;
  private hidden = 0;
  device: Record<string, string | number> = {};
  survey: Record<string, number | string> = {};

  /** One rendered frame took `ms`. Frames over a second (a backgrounded tab) are not counted. */
  frame(ms: number): void {
    if (!(ms > 0) || ms > 1000) return;
    this.t += ms / 1000;
    this.active += ms / 1000;
    this.frameCount++;
    if (this.frames.length < MAX_FRAME_SAMPLES) this.frames.push(ms);
    else this.frames[this.frameCount % MAX_FRAME_SAMPLES] = ms;
    let b = FRAME_BUCKETS.findIndex((limit) => ms <= limit);
    if (b < 0) b = FRAME_BUCKETS.length;
    this.buckets[b] = (this.buckets[b] ?? 0) + 1;
    if (ms > this.worst) this.worst = ms;
    const minute = Math.floor(this.active / 60);
    this.minuteFrames[minute] = (this.minuteFrames[minute] ?? 0) + 1;
    this.minuteTime[minute] = (this.minuteTime[minute] ?? 0) + ms / 1000;
  }

  /** The page was hidden (the player left and came back). */
  wentHidden(): void {
    this.hidden++;
  }

  tap(info: TapInfo): void {
    this.tapTotal++;
    if (this.firstTapAt === null) this.firstTapAt = round(this.t);
    if (info.target) this.byTarget.set(info.target, (this.byTarget.get(info.target) ?? 0) + 1);
    if (!info.interactive) {
      this.dead++;
      if (this.deadSpots.length < 40) this.deadSpots.push({ x: Math.round(info.x), y: Math.round(info.y) });
    }
    this.recent = this.recent.filter((r) => this.t - r.t <= RAGE_WINDOW_S);
    this.recent.push({ t: this.t, x: info.x, y: info.y });
    const near = this.recent.filter((r) => Math.hypot(r.x - info.x, r.y - info.y) <= RAGE_RADIUS);
    // Rapid repeated taps on something that does nothing: the clearest sign of a broken promise.
    if (near.length >= RAGE_COUNT && !info.interactive) {
      this.rage++;
      this.recent = [];
    }
  }

  private mark(key: string): void {
    if (!(key in this.firsts)) this.firsts[key] = round(this.t);
  }

  /** The game's state, sampled about once a second; `dt` is the time since the last sample. */
  poll(s: PlaytestSnapshot, dt: number): void {
    if (s.kills > 0) this.mark("first kill");
    if (s.upgrades > 0) this.mark("first upgrade");
    if (s.shadows > 0) this.mark("first shadow bound");
    if (s.deployed > 0) this.mark("first shadow deployed");
    if (s.items > 0) this.mark("first gear drop");
    if (s.equipped > 0) this.mark("first gear equipped");
    if (s.level >= 2) this.mark("level 2");
    if (s.level >= 5) this.mark("level 5");
    if (s.level >= 10) this.mark("level 10");
    if (s.bossGate > 0) this.mark("first boss gate");
    if (s.bossWins > 0) this.mark("first boss win");
    if (s.bossLosses > 0) this.mark("first boss loss");
    if (s.stageCleared >= 3) this.mark("stage 3 cleared");
    if (s.stageCleared >= 6) this.mark("stage 6 cleared");
    if (s.tutorialDone) this.mark("tutorial finished");
    if (s.dead) this.mark("first fall");
    if (s.mode !== "campaign" && s.mode !== "boss") this.mark(`first ${s.mode} run`);

    if (s.guide !== this.lastGuide) {
      const open = this.steps[this.steps.length - 1];
      if (open && open.done === null) open.done = round(this.t);
      if (s.guide) this.steps.push({ label: s.guide, shown: round(this.t), done: null });
      this.lastGuide = s.guide;
    }
    if (s.card !== (this.openCard?.kind ?? null)) {
      if (this.openCard) this.cards.push({ kind: this.openCard.kind, at: this.openCard.at, seconds: round(this.t - this.openCard.at) });
      this.openCard = s.card ? { kind: s.card, at: round(this.t) } : null;
    }
    this.panels[s.panel] = round((this.panels[s.panel] ?? 0) + dt);
    this.last = s;
  }

  report(): PlaytestReport {
    const sorted = [...this.frames].sort((a, b) => a - b);
    const q = (p: number) => (sorted.length ? round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] as number) : 0);
    const events = [...Object.values(this.firsts), ...this.steps.filter((x) => x.done !== null).map((x) => x.done as number)].sort((a, b) => a - b);
    let deadAir = { seconds: 0, from: 0, to: 0 };
    let prev = 0;
    for (const t of [...events, round(this.t)]) {
      if (t - prev > deadAir.seconds) deadAir = { seconds: round(t - prev), from: prev, to: t };
      prev = t;
    }
    const cards = [...this.cards, ...(this.openCard ? [{ kind: this.openCard.kind, at: this.openCard.at, seconds: round(this.t - this.openCard.at) }] : [])];
    const l = this.last;
    return {
      v: 1,
      seconds: round(this.t),
      activeSeconds: round(this.active),
      device: this.device,
      frames: {
        count: this.frameCount,
        p50: q(0.5),
        p95: q(0.95),
        p99: q(0.99),
        worst: round(this.worst),
        buckets: [...this.buckets],
        over34ms: this.frameCount ? round(((this.buckets[3] ?? 0) + (this.buckets[4] ?? 0)) / this.frameCount, 4) : 0,
        fpsByMinute: this.minuteFrames.map((n, i) => Math.round(n / Math.max(0.001, this.minuteTime[i] ?? 1))),
      },
      firsts: { ...this.firsts },
      tutorial: this.steps.map((x) => ({ label: x.label, shown: x.shown, waited: x.done === null ? null : round(x.done - x.shown) })),
      cards: { count: cards.length, seconds: round(cards.reduce((a, c) => a + c.seconds, 0)), list: cards.slice(0, 60) },
      deadAir,
      taps: {
        total: this.tapTotal,
        dead: this.dead,
        rage: this.rage,
        firstTapAt: this.firstTapAt,
        top: [...this.byTarget.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
        deadSpots: this.deadSpots,
      },
      panels: { ...this.panels },
      end: l
        ? { level: l.level, stageCleared: l.stageCleared, shadows: l.shadows, upgrades: l.upgrades, bossWins: l.bossWins, bossLosses: l.bossLosses, tutorialDone: l.tutorialDone }
        : { level: 0, stageCleared: 0, shadows: 0, upgrades: 0, bossWins: 0, bossLosses: 0, tutorialDone: false },
      hidden: this.hidden,
      survey: { ...this.survey },
    };
  }
}

function round(n: number, digits = 1): number {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

/** A few lines a person can read at a glance; the full report is the JSON. */
export function summarize(r: PlaytestReport): string[] {
  const f = r.frames;
  const smooth = f.count ? Math.round((100 * (f.buckets[0] ?? 0)) / f.count) : 0;
  const first = (k: string) => (k in r.firsts ? `${r.firsts[k]}s` : "not reached");
  return [
    `Session ${Math.round(r.seconds / 60)} min · level ${r.end.level} · stage ${r.end.stageCleared} cleared`,
    `Frames: ${smooth}% at 60 fps · median ${f.p50} ms · 95th ${f.p95} ms · worst ${f.worst} ms`,
    `First kill ${first("first kill")} · first upgrade ${first("first upgrade")} · first shadow ${first("first shadow bound")} · first boss win ${first("first boss win")}`,
    `Cards on screen ${r.cards.seconds}s over ${r.cards.count} · longest quiet stretch ${r.deadAir.seconds}s`,
    `Taps ${r.taps.total} · on nothing ${r.taps.dead} · frustrated bursts ${r.taps.rage}`,
  ];
}
