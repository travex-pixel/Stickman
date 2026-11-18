import type { GameEvent } from "../../engine/events";
import type { Vec2 } from "../../engine/math";
import { signatureDef, type EvolutionId, type MasteryTier, type SignatureBeat, type SignatureId, type SignatureStatus, type SynergyId } from "../../data/signatures";
import type { EntityKind } from "../../entities/types";

/**
 * The synthetic event driver: writes the `sig_*` events (and `hit.sig`) a signature cast would send,
 * in the order and at the world moments the contract (engine/events.ts) describes, for stand-in
 * figures or for the live fight's bodies. The renderer uses it for the preview sandbox (the same
 * director code on stand-ins) and for development before the simulation's events land. It deals
 * nothing and writes nothing to any world: it only produces events for the presentation.
 *
 * Timings follow the catalogue's numbers (`castTime`, `radius`) and the beats' meanings; where the
 * contract leaves a moment open (how long a pull lasts, when a clone lands), the values here are the
 * presentation's assumptions, and the director stages whatever moments actually arrive.
 */
export interface SigActor {
  id: number;
  pos: Vec2;
  kind?: EntityKind;
  /** Fraction of health left (0 to 1): Death Parade and Hunter's Instinct favour the weak. */
  hp?: number;
  marked?: boolean;
}

export interface ScriptInput {
  castId: number;
  sig: SignatureId;
  evo: EvolutionId | null;
  mastery: MasteryTier;
  rank?: number;
  caster: SigActor;
  foes: SigActor[];
  /** The army (Sovereign Awakening's kneel). */
  allies?: SigActor[];
  /** Where foes fell recently (Legion Awakening's soldiers rise there). */
  corpses?: Vec2[];
  /** Ids for summoned stand-ins (Legion soldiers), allocated by the caller. */
  nextId?: () => number;
  enhanced?: boolean;
  /** Combinations to stage in this cast (the preview shows them on request). */
  synergies?: SynergyId[];
  /** Damage per instance for the figures (synthetic; nothing is dealt). */
  power?: number;
  /** Include `hit` events (the preview leaves the figures out). */
  hits?: boolean;
}

export interface Timed {
  t: number;
  e: GameEvent;
}

/** A small deterministic hash in [0, 1): the same cast always looks the same. */
function rnd(seed: number, i: number): number {
  let x = (Math.floor(seed) * 374761393 + i * 668265263) | 0;
  x = (x ^ (x >>> 13)) * 1274126177;
  x = x ^ (x >>> 16);
  return (x >>> 0) / 4294967296;
}

const dist2 = (a: Vec2, b: Vec2) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** The densest point among foes: the foe with the most others within `r`, and their mean. */
export function densest(foes: SigActor[], r: number, fallback: Vec2): Vec2 {
  if (foes.length === 0) return { x: fallback.x + 120, y: fallback.y };
  let best = foes[0]!;
  let bestN = -1;
  for (const a of foes) {
    let n = 0;
    for (const b of foes) if (dist2(a.pos, b.pos) <= r * r) n++;
    if (n > bestN) {
      bestN = n;
      best = a;
    }
  }
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const b of foes) {
    if (dist2(best.pos, b.pos) <= r * r) {
      sx += b.pos.x;
      sy += b.pos.y;
      n++;
    }
  }
  return { x: sx / n, y: sy / n };
}

class Writer {
  readonly out: Timed[] = [];
  constructor(readonly inp: ScriptInput) {}
  get castId(): number {
    return this.inp.castId;
  }
  beat(t: number, beat: SignatureBeat, o: { index?: number; from?: Vec2; to?: Vec2; targetIds?: number[]; radius?: number; duration?: number } = {}): void {
    const c = this.inp.caster.pos;
    this.out.push({ t, e: { type: "sig_beat", castId: this.castId, sig: this.inp.sig, beat, index: o.index ?? 1, from: o.from ?? { x: c.x, y: c.y }, to: o.to ?? o.from ?? { x: c.x, y: c.y }, targetIds: o.targetIds ?? [], radius: o.radius ?? 0, duration: o.duration ?? 0 } });
  }
  status(t: number, a: SigActor, status: SignatureStatus, on: boolean, duration: number): void {
    this.out.push({ t, e: { type: "sig_status", targetId: a.id, status, on, duration, pos: { x: a.pos.x, y: a.pos.y } } });
  }
  hit(t: number, a: SigActor, scale: number, heavy = false, crit = false): void {
    if (this.inp.hits === false) return;
    const amount = Math.round((this.inp.power ?? 1200) * scale * (0.9 + 0.2 * rnd(this.castId, a.id + this.out.length)));
    this.out.push({ t, e: { type: "hit", targetId: a.id, sourceId: this.inp.caster.id, amount, crit, pos: { x: a.pos.x, y: a.pos.y }, element: "void", faction: "enemy", targetKind: a.kind ?? "enemy", heavy, sig: this.inp.sig } });
  }
  synergy(t: number, synergy: SynergyId, pos: Vec2, targetIds: number[]): void {
    this.out.push({ t, e: { type: "sig_synergy", synergy, castId: this.castId, pos: { x: pos.x, y: pos.y }, targetIds, first: false } });
  }
  has(s: SynergyId): boolean {
    return this.inp.synergies?.includes(s) ?? false;
  }
}

/** The cast's events in time order (seconds from the cast). Always opens with `sig_cast` and closes with `sig_end`. */
export function buildScript(inp: ScriptInput): Timed[] {
  const w = new Writer(inp);
  const def = signatureDef(inp.sig);
  const caster = inp.caster;
  const foes = inp.foes;
  const boss = foes.some((f) => f.kind === "boss");
  let center: Vec2 = densest(foes, def.radius * 0.8, caster.pos);
  let windup = def.castTime;
  let length = 2;
  let targets = foes;
  const body: (() => void)[] = [];
  const evo = inp.evo;
  const master = inp.mastery >= 2;
  switch (inp.sig) {
    case "void_collapse": {
      const r = def.radius;
      const horizon = evo === "event_horizon";
      const pull = horizon ? 1.05 : 0.9;
      const near = foes.filter((f) => dist2(f.pos, center) <= (r * 1.5) ** 2);
      targets = near.length > 0 ? near : foes.slice(0, 1);
      const tImp = def.castTime + pull;
      windup = tImp;
      length = tImp + (evo === "supernova" ? (master ? 1.5 : 1.15) : 0.95);
      body.push(() => {
        w.beat(0, "form", { from: caster.pos, to: center, radius: r, duration: def.castTime, targetIds: targets.map((f) => f.id) });
        w.beat(def.castTime, "pull", { to: center, radius: r * 1.5, duration: pull, targetIds: targets.map((f) => f.id) });
        if (horizon) {
          w.beat(def.castTime + 0.25, "horizon_trap", { to: center, radius: r, duration: 1, targetIds: targets.map((f) => f.id) });
          for (const f of targets) if (f.kind !== "boss") w.status(def.castTime + 0.25, f, "trapped", true, 1.2);
        }
        w.beat(tImp, "implode", { to: center, radius: r, targetIds: targets.map((f) => f.id) });
        for (const f of targets) {
          w.hit(tImp + 0.01, f, 1, true);
          w.status(tImp + 0.01, f, "void_mark", true, 6);
        }
        const outer = foes.filter((f) => !targets.includes(f));
        w.beat(tImp + 0.12, "shockwave", { to: center, radius: r * 2.2, duration: 0.55, targetIds: outer.map((f) => f.id) });
        for (const f of outer) w.hit(tImp + 0.12 + Math.sqrt(dist2(f.pos, center)) / (r * 2.2) * 0.4, f, 0.45);
        if (evo === "supernova") {
          const leaps = foes.slice().sort((a, b) => dist2(a.pos, center) - dist2(b.pos, center)).slice(0, 3);
          leaps.forEach((f, i) => {
            const t = tImp + 0.3 + i * 0.14;
            w.beat(t, "supernova_burst", { index: i + 1, from: center, to: f.pos, radius: 46, duration: 0.18, targetIds: [f.id] });
            w.hit(t + 0.18, f, 0.6);
            if (master) {
              const next = foes.find((g) => g !== f && !leaps.includes(g)) ?? foes[(i + 1) % foes.length];
              if (next) {
                w.beat(t + 0.32, "supernova_burst", { index: i + 4, from: f.pos, to: next.pos, radius: 38, duration: 0.16, targetIds: [next.id] });
                w.hit(t + 0.48, next, 0.4);
              }
            }
          });
        }
      });
      break;
    }
    case "abyssal_devourer": {
      const eater = evo === "world_eater";
      const fromLeft = center.x >= caster.pos.x ? true : false;
      const portal: Vec2 = { x: fromLeft ? 30 : 610, y: eater ? 75 : Math.max(20, Math.min(130, center.y - 10)) };
      const exit: Vec2 = { x: fromLeft ? 610 : 30, y: eater ? 75 : Math.max(20, Math.min(130, center.y + 10)) };
      const passT = def.castTime + 0.35;
      const passD = eater ? 1.7 : 1.45;
      windup = passT + 0.2;
      const ancient = evo === "ancient_devourer";
      length = passT + passD + (ancient ? 1.4 : 0.6);
      const feast = w.has("gravity_feast");
      body.push(() => {
        w.beat(0, "portal", { from: portal, to: center, radius: eater ? 44 : 34, duration: passT });
        if (feast) w.synergy(passT - 0.02, "gravity_feast", center, foes.filter((f) => f.marked).map((f) => f.id));
        w.beat(passT, "pass", { index: 1, from: portal, to: exit, radius: eater ? 75 : 36, duration: passD, targetIds: foes.map((f) => f.id) });
        const sorted = foes.slice().sort((a, b) => (fromLeft ? a.pos.x - b.pos.x : b.pos.x - a.pos.x));
        sorted.forEach((f) => {
          const k = Math.abs(f.pos.x - portal.x) / Math.abs(exit.x - portal.x);
          w.hit(passT + passD * Math.min(0.95, k * 0.9 + 0.04), f, 1, true);
        });
        if (evo === "soul_feeder") sorted.slice(0, 2).forEach((f, i) => w.beat(passT + 0.4 + i * 0.3, "feed", { index: i + 1, from: f.pos, to: f.pos, targetIds: [f.id] }));
        let end = passT + passD;
        if (ancient) {
          const dive: Vec2 = { x: center.x, y: center.y };
          w.beat(end + 0.25, "second_pass", { index: 2, from: { x: exit.x, y: -60 }, to: dive, radius: 60, duration: 0.85, targetIds: foes.map((f) => f.id) });
          for (const f of foes) if (dist2(f.pos, dive) < 90 * 90) w.hit(end + 1.0, f, 1.2, true);
          end += 1.15;
        }
        w.beat(end, "depart", { from: ancient ? center : exit, to: ancient ? { x: center.x, y: -80 } : exit, duration: 0.45 });
      });
      break;
    }
    case "death_parade": {
      const after = evo === "afterimage";
      const exec = evo === "executioner";
      const n = after ? 6 : 4;
      const step = after ? 0.13 : 0.2;
      const hunters = w.has("hunters_parade");
      const order = foes.slice().sort((a, b) => (hunters ? Number(!!b.marked) - Number(!!a.marked) : 0) || (exec ? (a.hp ?? 1) - (b.hp ?? 1) : 0) || dist2(a.pos, caster.pos) - dist2(b.pos, caster.pos));
      const picks: SigActor[] = [];
      for (let i = 0; i < n && order.length > 0; i++) picks.push(order[i % order.length]!);
      targets = picks;
      windup = 0.22;
      length = def.castTime + 0.55;
      body.push(() => {
        w.beat(0, "vanish", { from: caster.pos, duration: def.castTime, targetIds: picks.map((f) => f.id) });
        if (hunters) w.synergy(0.05, "hunters_parade", center, foes.filter((f) => f.marked).map((f) => f.id));
        picks.forEach((f, i) => {
          const t = 0.18 + i * step;
          const side = i % 2 === 0 ? -1 : 1;
          const stand: Vec2 = { x: f.pos.x + side * 26, y: f.pos.y };
          w.beat(t, "clone", { index: i + 1, from: caster.pos, to: stand, targetIds: [f.id], duration: step * 1.3 });
          w.hit(t + 0.06, f, exec && (f.hp ?? 1) < 0.34 ? 1.8 : 1, false, i === picks.length - 1);
          if (w.has("blade_parade")) w.synergy(t + 0.07, "blade_parade", f.pos, foes.filter((g) => g !== f).slice(0, 2).map((g) => g.id));
          if ((f.hp ?? 1) < 0.2) w.beat(t + 0.08, "execute", { index: i + 1, from: f.pos, to: f.pos, targetIds: [f.id] });
        });
        const fin = def.castTime - 0.12;
        const lead = picks[picks.length - 1] ?? foes[0];
        w.beat(fin, "finisher", { from: caster.pos, to: lead ? { x: lead.pos.x - 30, y: lead.pos.y } : caster.pos, targetIds: picks.map((f) => f.id), radius: 80, duration: 0.3 });
        for (const f of new Set(picks)) w.hit(fin + 0.05, f, 1.4, true, true);
      });
      break;
    }
    case "kings_judgement": {
      const absolute = evo === "absolute_judgement";
      const breaker = evo === "world_breaker";
      const bossFoe = foes.find((f) => f.kind === "boss");
      if (absolute && bossFoe) center = { x: bossFoe.pos.x, y: bossFoe.pos.y };
      const r = def.radius * (breaker ? 1.35 : 1);
      const near = foes.filter((f) => dist2(f.pos, center) <= r * r);
      targets = near;
      const tImp = 1.85;
      windup = tImp;
      length = tImp + (evo === "fallen_star" ? 1.35 : breaker ? 1.15 : 0.9);
      const legion = w.has("legion_meteor");
      body.push(() => {
        w.beat(0, "hush", { from: caster.pos, duration: def.castTime });
        w.beat(0.3, "hand", { from: { x: center.x, y: -40 }, to: center, radius: r, duration: 1.5, targetIds: near.map((f) => f.id) });
        w.beat(0.6, "sigil", { to: center, radius: r, duration: tImp - 0.6 });
        w.beat(1.25, "meteor", { from: { x: center.x + 140, y: -260 }, to: center, radius: r, duration: tImp - 1.25 });
        if (legion) w.synergy(1.5, "legion_meteor", center, []);
        w.beat(tImp, "impact", { to: center, radius: r, targetIds: near.map((f) => f.id) });
        for (const f of near) w.hit(tImp + 0.01, f, f.kind === "boss" ? (absolute ? 3 : 2) : 1.5, true, true);
        w.beat(tImp + 0.08, "shockwave", { to: center, radius: r * 1.8, duration: 0.6 });
        if (breaker) {
          w.beat(tImp + 0.45, "second_shockwave", { to: center, radius: r * 2.4, duration: 0.65 });
          for (const f of foes) w.hit(tImp + 0.6, f, 0.4);
        }
        if (evo === "fallen_star") {
          for (let i = 0; i < 3; i++) {
            const f = foes[(i + 1) % Math.max(1, foes.length)];
            const to = f ? f.pos : { x: center.x + (i - 1) * 90, y: center.y };
            w.beat(tImp + 0.3 + i * 0.25, "fallen_star", { index: i + 1, from: { x: to.x + 90, y: -200 }, to, radius: 50, duration: 0.35, targetIds: f ? [f.id] : [] });
            if (f) w.hit(tImp + 0.65 + i * 0.25, f, 0.7, true);
          }
        }
      });
      break;
    }
    case "legion_awakening": {
      const n = evo === "endless_legion" ? 8 : evo === "veteran_souls" ? 3 : 5;
      const spots: Vec2[] = [];
      const corpses = inp.corpses ?? [];
      for (let i = 0; i < n; i++) {
        const c = corpses[i];
        spots.push(c ? { x: c.x, y: c.y } : { x: caster.pos.x - 30 + (i % 3) * 22 - (i > 2 ? 12 : 0), y: Math.max(16, Math.min(134, caster.pos.y - 40 + i * 20)) });
      }
      const ids = spots.map(() => (inp.nextId ? inp.nextId() : -1));
      windup = 1.7;
      length = 3.4 + (evo === "veteran_souls" ? 0.6 : 0);
      body.push(() => {
        w.beat(0, "darken", { from: caster.pos, duration: length });
        spots.forEach((s, i) => w.beat(0.3 + i * (evo === "endless_legion" ? 0.08 : 0.13), "rise", { index: i + 1, from: s, to: s, targetIds: ids[i]! >= 0 ? [ids[i]!] : [], duration: 0.6 }));
        w.beat(1.45, "charge", { from: caster.pos, to: center, targetIds: foes.map((f) => f.id), radius: 80, duration: 0.8 });
        foes.forEach((f, i) => w.hit(1.75 + (i % 4) * 0.08, f, 0.8));
      });
      break;
    }
    case "time_fracture": {
      const r = def.radius;
      const freeze = evo === "stop_the_world" ? 2.8 : 2;
      const near = foes.filter((f) => dist2(f.pos, center) <= r * r);
      targets = near;
      const tRes = def.castTime + freeze;
      windup = tRes;
      length = tRes + (evo === "fractured_future" ? 1.0 : 0.7);
      body.push(() => {
        w.beat(0, "clock", { to: center, radius: r, duration: def.castTime });
        w.beat(def.castTime, "freeze", { to: center, radius: r, duration: freeze, targetIds: near.map((f) => f.id) });
        for (const f of near) w.status(def.castTime, f, f.kind === "boss" ? "slowed" : "frozen", true, freeze);
        w.beat(tRes, "resume", { to: center, radius: r, targetIds: near.map((f) => f.id) });
        for (const f of near) w.status(tRes, f, f.kind === "boss" ? "slowed" : "frozen", false, 0);
        if (w.has("frozen_singularity")) w.synergy(tRes + 0.02, "frozen_singularity", center, near.map((f) => f.id));
        near.forEach((f, i) => {
          w.beat(tRes + 0.05 + i * 0.07, "delayed", { index: i + 1, from: f.pos, to: f.pos, targetIds: [f.id] });
          w.hit(tRes + 0.06 + i * 0.07, f, evo === "temporal_execution" && f.marked ? 1.8 : 1, true);
          if (evo === "fractured_future") {
            w.beat(tRes + 0.35 + i * 0.07, "delayed", { index: near.length + i + 1, from: f.pos, to: f.pos, targetIds: [f.id] });
            w.hit(tRes + 0.36 + i * 0.07, f, 0.5);
          }
        });
      });
      break;
    }
    case "shadow_storm": {
      const thousand = evo === "thousand_blades";
      const n = thousand ? 12 : 6;
      const gather = 0.8;
      const step = thousand ? 0.045 : 0.075;
      const order = evo === "hunters_instinct" ? foes.slice().sort((a, b) => (a.hp ?? 1) - (b.hp ?? 1)) : foes.slice().sort((a, b) => dist2(a.pos, center) - dist2(b.pos, center));
      windup = gather + 0.15;
      length = gather + n * step + (evo === "black_tempest" ? 1.3 : 0.5);
      body.push(() => {
        // `index` on the gather beat carries the blade count (a presentation assumption; see the report).
        w.beat(0, "gather", { index: n, from: caster.pos, duration: gather, radius: 34 });
        for (let i = 0; i < n && order.length > 0; i++) {
          const f = order[i % Math.min(order.length, thousand ? 6 : 4)]!;
          const t = gather + i * step;
          w.beat(t, "blade", { index: i + 1, from: caster.pos, to: f.pos, targetIds: [f.id], duration: 0.16 });
          w.hit(t + 0.16, f, thousand ? 0.5 : 1);
          if (i < order.length) w.status(t + 0.16, f, "shadow_mark", true, 6);
        }
        if (evo === "black_tempest") {
          const t = gather + n * step + 0.1;
          w.beat(t, "tempest", { from: center, to: center, radius: 170, duration: 0.9, targetIds: foes.map((f) => f.id) });
          for (const f of foes) w.hit(t + Math.sqrt(dist2(f.pos, center)) / 170 * 0.9, f, 0.6);
        }
      });
      break;
    }
    case "sovereign_awakening": {
      const aura = 10;
      windup = def.castTime + 0.6;
      length = 0.6 + def.castTime + aura;
      body.push(() => {
        w.beat(0, "kneel", { from: caster.pos, duration: 0.6, targetIds: (inp.allies ?? []).map((a) => a.id) });
        w.beat(0.6, "crown", { from: caster.pos, to: caster.pos, duration: def.castTime });
        w.beat(0.6 + def.castTime, "aura", { from: caster.pos, radius: 120, duration: aura });
        w.beat(0.6 + def.castTime + aura, "sovereign_end", { from: caster.pos });
      });
      break;
    }
  }
  w.out.push({ t: 0, e: { type: "sig_cast", castId: inp.castId, sig: inp.sig, evo, mastery: inp.mastery, rank: inp.rank ?? 1, casterId: caster.id, origin: { x: caster.pos.x, y: caster.pos.y }, center, radius: def.radius, targetIds: targets.map((f) => f.id), windup, length, boss, enhanced: inp.enhanced ?? false } });
  for (const b of body) b();
  w.out.push({ t: length, e: { type: "sig_end", castId: inp.castId, sig: inp.sig, interrupted: false } });
  // Stable sort by time: the cast first, its end last, everything else in the order written.
  const order = new Map<Timed, number>();
  w.out.forEach((x, i) => order.set(x, i));
  w.out.sort((a, b) => a.t - b.t || rank(a.e) - rank(b.e) || order.get(a)! - order.get(b)!);
  return w.out;
}

/** Within one moment: the cast opens, a beat comes before the statuses and hits it causes, the end closes. */
function rank(e: GameEvent): number {
  switch (e.type) {
    case "sig_cast":
      return 0;
    case "sig_synergy":
      return 1;
    case "sig_beat":
      return 2;
    case "sig_status":
      return 3;
    case "hit":
      return 4;
    case "sig_end":
      return 9;
    default:
      return 5;
  }
}

/**
 * Plays scripts against a clock (world seconds, or the sandbox's), handing each event to `sink`
 * when its moment comes. Several casts may run at once.
 */
export class SigDriver {
  private readonly queue: { at: number; e: GameEvent }[] = [];
  private time = 0;
  /** A cast id counter for synthetic casts (kept clear of the simulation's). */
  private nextCast = 900000;

  constructor(private readonly sink: (events: GameEvent[]) => void) {}

  newCastId(): number {
    return this.nextCast++;
  }

  play(script: Timed[], delay = 0): void {
    for (const s of script) this.queue.push({ at: this.time + delay + s.t, e: s.e });
    this.queue.sort((a, b) => a.at - b.at);
  }

  /** Advance; events now due are handed to the sink in one batch. */
  update(dt: number): void {
    this.time += Math.max(0, dt);
    if (this.queue.length === 0 || this.queue[0]!.at > this.time) return;
    const batch: GameEvent[] = [];
    while (this.queue.length > 0 && this.queue[0]!.at <= this.time) batch.push(this.queue.shift()!.e);
    this.sink(batch);
  }

  get pending(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue.length = 0;
  }
}
