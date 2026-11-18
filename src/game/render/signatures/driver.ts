import type { GameEvent } from "../../engine/events";
import type { Vec2 } from "../../engine/math";
import { DEVOURER, FRACTURE, JUDGEMENT, LEGION, PARADE, SIGNATURES, SOVEREIGN, STORM, VOID, signatureDef, type EvolutionId, type MasteryTier, type SignatureBeat, type SignatureId, type SignatureStatus, type SynergyId } from "../../data/signatures";
import { curvePoint, devourerCurve, orbitPoint } from "../../signatures/geometry";
import type { EntityKind } from "../../entities/types";

/**
 * The synthetic event driver: writes the `sig_*` events (and `hit.sig`) a signature cast would send,
 * in the order and at the world moments the contract (engine/events.ts) describes, for stand-in
 * figures or for the live fight's bodies. The renderer uses it for the preview sandbox (the same
 * director code on stand-ins) and for development before the simulation's events land. It deals
 * nothing and writes nothing to any world: it only produces events for the presentation.
 *
 * Timings and shapes follow the simulation's own layout (src/game/signatures/skills/*: the same
 * constants and the shared geometry), so a preview plays the moments a real cast sends, in the same
 * order; the director stages whatever moments actually arrive either way.
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
  /** Legion Awakening's soldiers (the caller raises them where foes fell; the preview's stand-ins). */
  soldiers?: SigActor[];
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
    this.out.push({ t, e: { type: "sig_beat", castId: this.castId, sig: this.inp.sig, beat, index: o.index ?? 0, from: o.from ?? { x: c.x, y: c.y }, to: o.to ?? o.from ?? { x: c.x, y: c.y }, targetIds: o.targetIds ?? [], radius: o.radius ?? 0, duration: o.duration ?? 0 } });
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
  const ARENA_MIN_X = 44;
  const ARENA_MAX_X = 596;
  const ARENA_MIN_Y = 8;
  const ARENA_MAX_Y = 142;
  switch (inp.sig) {
    case "void_collapse": {
      // As the simulation lays it out (signatures/skills/voidCollapse.ts): form and pull together
      // just after the cast, the implosion when the pull is done, the ring a beat later.
      const R = def.radius;
      const horizon = evo === "event_horizon";
      const tPull = VOID.formAt;
      const pullFor = VOID.pullFor;
      const tImp = tPull + pullFor + (horizon ? VOID.horizon.implodeDelay : 0);
      const tRing = tImp + VOID.shockwaveDelay;
      const near = foes.filter((f) => dist2(f.pos, center) <= R * R);
      targets = near.length > 0 ? near : foes.slice(0, 1);
      windup = tImp;
      length = tRing + 0.35 + (evo === "supernova" ? VOID.supernova.bursts * VOID.supernova.gap + (master ? 0.5 : 0.2) : 0);
      body.push(() => {
        w.beat(tPull, "form", { from: center, radius: R, duration: tImp - tPull });
        w.beat(tPull, "pull", { from: center, radius: R, duration: pullFor, targetIds: targets.map((f) => f.id) });
        if (horizon) {
          w.beat(tPull + pullFor, "horizon_trap", { from: center, radius: R, duration: VOID.horizon.trap, targetIds: targets.filter((f) => f.kind !== "boss").map((f) => f.id) });
          for (const f of targets) if (f.kind !== "boss") w.status(tPull + pullFor, f, "trapped", true, VOID.horizon.trap);
        }
        w.beat(tImp, "implode", { from: center, radius: R, targetIds: targets.map((f) => f.id) });
        for (const f of targets) {
          w.hit(tImp, f, 1, true);
          w.status(tImp, f, "void_mark", true, 6);
        }
        const reach = R * VOID.shockwaveReach;
        const outer = foes.filter((f) => !targets.includes(f) && dist2(f.pos, center) <= reach * reach);
        w.beat(tRing, "shockwave", { from: center, radius: reach, duration: 0.35, targetIds: outer.map((f) => f.id) });
        for (const f of outer) w.hit(tRing, f, 0.45);
        if (evo === "supernova") {
          const leaps = foes.slice().sort((a, b) => dist2(b.pos, center) - dist2(a.pos, center)).slice(0, VOID.supernova.bursts);
          leaps.forEach((f, i) => {
            const t = tRing + 0.05 + i * VOID.supernova.gap;
            w.beat(t, "supernova_burst", { index: i + 1, from: center, to: f.pos, radius: VOID.supernova.radius, duration: 0.25, targetIds: [f.id] });
            w.hit(t, f, 0.55);
            if (master) {
              const next = foes.find((g) => !leaps.includes(g)) ?? foes[(i + 1) % foes.length];
              if (next) {
                w.beat(t + VOID.supernova.gap, "supernova_burst", { index: i + 1 + VOID.supernova.bursts, from: f.pos, to: next.pos, radius: VOID.supernova.radius, duration: 0.25, targetIds: [next.id] });
                w.hit(t + VOID.supernova.gap, next, 0.4);
              }
            }
          });
        }
      });
      break;
    }
    case "abyssal_devourer": {
      // The simulation's pass (signatures/skills/devourer.ts): a portal at the warrior's edge, the
      // head sweeping a quadratic curve through the cast's centre to the far edge, bites as it passes.
      const eater = evo === "world_eater";
      const ancient = evo === "ancient_devourer";
      const fromLeft = caster.pos.x <= (ARENA_MIN_X + ARENA_MAX_X) / 2;
      const highFirst = center.y >= (ARENA_MIN_Y + ARENA_MAX_Y) / 2;
      const from: Vec2 = { x: fromLeft ? ARENA_MIN_X - 6 : ARENA_MAX_X + 6, y: highFirst ? ARENA_MIN_Y + 14 : ARENA_MAX_Y - 14 };
      const to: Vec2 = { x: fromLeft ? ARENA_MAX_X + 6 : ARENA_MIN_X - 6, y: highFirst ? ARENA_MAX_Y - 14 : ARENA_MIN_Y + 14 };
      const tPass = DEVOURER.portalFor;
      const D = DEVOURER.passFor;
      const bite = eater ? DEVOURER.worldEater.bite : DEVOURER.bite;
      const curve = devourerCurve(from, center, to);
      const dives = ancient ? (master ? 2 : 1) : inp.enhanced ? 1 : 0;
      windup = tPass;
      length = tPass + D + dives * (DEVOURER.ancient.turn + DEVOURER.ancient.diveFor) + 0.05 + DEVOURER.departFor;
      const feast = w.has("gravity_feast");
      body.push(() => {
        w.beat(0, "portal", { from, to: from, radius: 40, duration: tPass });
        w.beat(tPass, "pass", { from, to, radius: bite, duration: D });
        // Bites: when the head passes each foe (sampled as the simulation does).
        const p = { x: 0, y: 0 };
        let fed = 0;
        for (const f of foes) {
          for (let k = 0; k <= 60; k++) {
            curvePoint(curve, k / 60, p);
            if (Math.hypot(p.x - f.pos.x, p.y - f.pos.y) <= bite + 10) {
              w.hit(tPass + (D * k) / 60, f, 1, true);
              if (evo === "soul_feeder" && (f.hp ?? 1) < 0.35 && fed < 3) w.beat(tPass + (D * k) / 60 + 0.02, "feed", { index: ++fed, from: f.pos, to: p, targetIds: [f.id] });
              break;
            }
          }
        }
        if (feast) w.synergy(tPass + D * 0.5, "gravity_feast", center, foes.filter((f) => f.marked).map((f) => f.id));
        let t = tPass + D;
        for (let k = 0; k < dives; k++) {
          t += DEVOURER.ancient.turn;
          const aim = densest(foes, DEVOURER.ancient.radius, center);
          const sky = { x: aim.x - (fromLeft ? -60 : 60), y: ARENA_MIN_Y - 90 };
          w.beat(t, "second_pass", { index: k + 1, from: sky, to: aim, radius: DEVOURER.ancient.radius, duration: DEVOURER.ancient.diveFor });
          const hit = foes.filter((f) => dist2(f.pos, aim) <= DEVOURER.ancient.radius ** 2);
          w.beat(t + DEVOURER.ancient.diveFor, "impact", { index: k + 1, from: aim, radius: DEVOURER.ancient.radius, targetIds: hit.map((f) => f.id) });
          for (const f of hit) w.hit(t + DEVOURER.ancient.diveFor, f, 2, true);
          t += DEVOURER.ancient.diveFor;
        }
        w.beat(t + 0.05, "depart", { from: dives > 0 ? center : to, to, duration: DEVOURER.departFor });
      });
      break;
    }
    case "death_parade": {
      // signatures/skills/parade.ts: vanish, the clones one after another (each from where it stands
      // to its foe), the finisher as he reappears beside the last.
      const after = evo === "afterimage";
      const exec = evo === "executioner";
      const n = after ? PARADE.afterimage.clones + (master ? 2 : 0) : PARADE.clones;
      const gap = after ? PARADE.afterimage.gap : PARADE.cloneGap;
      const tFinish = Math.min(def.castTime - 0.05, PARADE.vanishFor + n * gap + 0.08);
      const hunters = w.has("hunters_parade");
      const blades = w.has("blade_parade");
      const used = new Map<number, number>();
      const order = () => foes.slice().sort((a, b) => (used.get(a.id) ?? 0) - (used.get(b.id) ?? 0) || (hunters ? Number(!!b.marked) - Number(!!a.marked) : 0) || (a.hp ?? 1) - (b.hp ?? 1) || a.id - b.id);
      windup = PARADE.vanishFor;
      length = tFinish + 0.25;
      body.push(() => {
        w.beat(0, "vanish", { from: caster.pos, duration: tFinish });
        if (hunters) w.synergy(0, "hunters_parade", caster.pos, foes.filter((f) => f.marked).map((f) => f.id));
        if (blades) w.synergy(0, "blade_parade", caster.pos, []);
        const picks: SigActor[] = [];
        for (let i = 1; i <= n && foes.length > 0; i++) {
          const f = order()[0]!;
          used.set(f.id, (used.get(f.id) ?? 0) + 1);
          picks.push(f);
          const t = PARADE.vanishFor + (i - 1) * gap;
          const side = i % 2 === 0 ? 1 : -1;
          const stand: Vec2 = { x: f.pos.x + side * 26, y: f.pos.y };
          w.beat(t, "clone", { index: i, from: stand, to: f.pos, targetIds: [f.id], duration: gap });
          if ((f.hp ?? 1) < PARADE.executeBelow) w.beat(t, "execute", { index: i, from: f.pos, targetIds: [f.id] });
          else w.hit(t, f, exec && (f.hp ?? 1) < PARADE.executioner.below ? 1.8 : 1);
          if (blades) {
            const near = foes.filter((g) => g !== f).slice(0, inp.enhanced ? 2 : 1);
            near.forEach((g, k) => {
              w.beat(t, "blade", { index: k + 1, from: f.pos, to: g.pos, targetIds: [g.id], duration: STORM.flight });
              w.hit(t + STORM.flight, g, 0.3);
            });
          }
        }
        targets = picks;
        const lead = foes.slice().sort((a, b) => (a.hp ?? 1) - (b.hp ?? 1))[0];
        const stand = lead ? { x: lead.pos.x + (caster.pos.x <= lead.pos.x ? -24 : 24), y: lead.pos.y } : caster.pos;
        w.beat(tFinish, "finisher", { index: n + 1, from: caster.pos, to: stand, targetIds: lead ? [lead.id] : [], duration: 0.2 });
        if (lead) w.hit(tFinish, lead, PARADE.finisherPower, true, true);
      });
      break;
    }
    case "kings_judgement": {
      // signatures/skills/judgement.ts: hush, hand, sigil, meteor, impact; then the evolutions' extras.
      const absolute = evo === "absolute_judgement";
      const breaker = evo === "world_breaker";
      const bossFoe = foes.find((f) => f.kind === "boss");
      if (absolute && bossFoe) center = { x: bossFoe.pos.x, y: bossFoe.pos.y };
      const R = def.radius * (absolute ? JUDGEMENT.absolute.radius : 1) * (breaker ? JUDGEMENT.worldBreaker.radius : 1) * (inp.enhanced ? 1.25 : 1);
      const tImpact = JUDGEMENT.meteorAt + JUDGEMENT.fallFor;
      const near = foes.filter((f) => dist2(f.pos, center) <= R * R);
      targets = near;
      windup = tImpact;
      const stars = evo === "fallen_star" ? (master ? JUDGEMENT.fallenStar.starsMaster : JUDGEMENT.fallenStar.stars) + (inp.enhanced ? 1 : 0) : inp.enhanced ? 1 : 0;
      length = tImpact + 0.4 + stars * JUDGEMENT.fallenStar.gap + (breaker ? JUDGEMENT.worldBreaker.delay + 0.45 : 0) + (absolute ? JUDGEMENT.absolute.echoDelay : 0);
      const legion = w.has("legion_meteor");
      body.push(() => {
        w.beat(0, "hush", { from: center, duration: tImpact });
        w.beat(JUDGEMENT.handAt, "hand", { from: { x: center.x, y: ARENA_MIN_Y - 70 }, to: center, radius: R, duration: JUDGEMENT.sigilAt - JUDGEMENT.handAt, targetIds: near.map((f) => f.id) });
        w.beat(JUDGEMENT.sigilAt, "sigil", { from: center, radius: R, duration: tImpact - JUDGEMENT.sigilAt });
        w.beat(JUDGEMENT.meteorAt, "meteor", { from: { x: center.x + 90, y: ARENA_MIN_Y - 160 }, to: center, radius: R, duration: JUDGEMENT.fallFor });
        w.beat(tImpact, "impact", { from: center, radius: R, targetIds: near.map((f) => f.id), duration: 0.4 });
        for (const f of near) w.hit(tImpact, f, f.kind === "boss" ? 2 : 1.5, true, true);
        if (legion) {
          const soldiers = inp.allies ?? [];
          w.synergy(tImpact, "legion_meteor", center, soldiers.map((s) => s.id));
          soldiers.forEach((s, k) => w.beat(tImpact + 0.04 + k * 0.06, "charge", { index: k + 1, from: s.pos, to: center, targetIds: [s.id], radius: JUDGEMENT.legion.radius, duration: 0.08 }));
        }
        for (let i = 1; i <= stars; i++) {
          const f = foes[i % Math.max(1, foes.length)];
          const at = f ? f.pos : { x: center.x + (i - 2) * 80, y: center.y };
          const t = tImpact + JUDGEMENT.fallenStar.gap * i;
          w.beat(t, "fallen_star", { index: i, from: { x: at.x + 60, y: ARENA_MIN_Y - 120 }, to: at, radius: JUDGEMENT.fallenStar.radius, targetIds: f ? [f.id] : [], duration: 0.18 });
          if (f) w.hit(t + 0.18, f, 0.7, true);
        }
        if (absolute && bossFoe) w.beat(tImpact + JUDGEMENT.absolute.echoDelay, "impact", { index: 1, from: bossFoe.pos, radius: R * 0.6, targetIds: [bossFoe.id], duration: 0.3 });
        if (breaker) {
          const reach = R * JUDGEMENT.worldBreaker.reach;
          w.beat(tImpact + JUDGEMENT.worldBreaker.delay, "second_shockwave", { from: center, radius: reach, duration: 0.45, targetIds: foes.map((f) => f.id) });
          for (const f of foes) w.hit(tImpact + JUDGEMENT.worldBreaker.delay + 0.1, f, 0.4);
        }
      });
      break;
    }
    case "legion_awakening": {
      // signatures/skills/legion.ts: darken; at riseAt one `rise` naming every soldier raised (real
      // temporary summons; here, stand-ins the caller placed), then the charge to the group.
      const soldiers = inp.soldiers ?? [];
      windup = LEGION.chargeAt;
      length = LEGION.chargeAt + 0.3 + (evo === "veteran_souls" ? 1 : 0.6);
      body.push(() => {
        w.beat(0, "darken", { from: caster.pos, duration: LEGION.chargeAt + 0.3 });
        w.beat(LEGION.riseAt, "rise", { from: caster.pos, targetIds: soldiers.map((s) => s.id), duration: LEGION.chargeAt - LEGION.riseAt });
        let ax = 0;
        let ay = 0;
        for (const s of soldiers) {
          ax += s.pos.x;
          ay += s.pos.y;
        }
        const avg = soldiers.length > 0 ? { x: ax / soldiers.length, y: ay / soldiers.length } : caster.pos;
        w.beat(LEGION.chargeAt, "charge", { from: avg, to: center, targetIds: soldiers.map((s) => s.id), duration: 0.3 });
        foes.forEach((f, i) => w.hit(LEGION.chargeAt + 0.3 + (i % 4) * 0.08, f, 0.8));
      });
      break;
    }
    case "time_fracture": {
      // signatures/skills/fracture.ts: the clock, the freeze, the resume, the held blows released.
      const r = def.radius;
      const freeze = evo === "stop_the_world" ? (master ? FRACTURE.stopTheWorld.freezeForMaster : FRACTURE.stopTheWorld.freezeFor) : FRACTURE.freezeFor;
      const near = foes.filter((f) => dist2(f.pos, center) <= r * r);
      targets = near;
      const tRes = FRACTURE.freezeAt + freeze;
      windup = tRes;
      const echoes = evo === "fractured_future" ? (master ? FRACTURE.fracturedFuture.echoesMaster : FRACTURE.fracturedFuture.echoes) : 0;
      length = tRes + near.length * FRACTURE.delayedGap + echoes * FRACTURE.fracturedFuture.delay + 0.3;
      body.push(() => {
        w.beat(0, "clock", { from: center, radius: r, duration: tRes });
        w.beat(FRACTURE.freezeAt, "freeze", { from: center, radius: r, duration: freeze, targetIds: near.map((f) => f.id) });
        for (const f of near) w.status(FRACTURE.freezeAt, f, f.kind === "boss" ? "slowed" : "frozen", true, freeze);
        w.beat(tRes, "resume", { from: center, radius: r, targetIds: near.map((f) => f.id) });
        for (const f of near) w.status(tRes, f, f.kind === "boss" ? "slowed" : "frozen", false, 0);
        const frozen = near.filter((f) => f.kind !== "boss");
        if (w.has("frozen_singularity") && frozen.length >= 2) {
          let x = 0;
          let y = 0;
          for (const f of frozen) {
            x += f.pos.x;
            y += f.pos.y;
          }
          const at = { x: x / frozen.length, y: y / frozen.length };
          const rr = SIGNATURES.void_collapse.radius * FRACTURE.singularity.radius;
          w.synergy(tRes, "frozen_singularity", at, frozen.map((f) => f.id));
          w.beat(tRes, "pull", { from: at, radius: rr, targetIds: frozen.map((f) => f.id), duration: 0 });
          w.beat(tRes, "implode", { from: at, radius: rr, targetIds: frozen.map((f) => f.id) });
        }
        near.forEach((f, k) => {
          const t = tRes + FRACTURE.delayedGap * k;
          w.beat(t, "delayed", { index: 1, from: f.pos, targetIds: [f.id] });
          w.hit(t, f, evo === "temporal_execution" && f.marked ? 1.8 : 1, true);
          for (let j = 1; j <= echoes; j++) {
            w.beat(t + FRACTURE.fracturedFuture.delay * j, "delayed", { index: 1 + j, from: f.pos, targetIds: [f.id] });
            w.hit(t + FRACTURE.fracturedFuture.delay * j, f, FRACTURE.fracturedFuture.share);
          }
        });
      });
      break;
    }
    case "shadow_storm": {
      // signatures/skills/storm.ts: the gather names the blade count; blades leave the orbit one by one.
      const thousand = evo === "thousand_blades";
      const n = thousand ? STORM.thousand.blades : STORM.blades;
      const gap = thousand ? STORM.thousand.gap : STORM.gap;
      const order = evo === "hunters_instinct" ? foes.slice().sort((a, b) => (a.hp ?? 1) - (b.hp ?? 1)) : foes.slice().sort((a, b) => dist2(a.pos, center) - dist2(b.pos, center));
      const volleyEnd = STORM.gatherFor + (n - 1) * gap + STORM.flight;
      const pulses = evo === "black_tempest" ? (master ? STORM.tempest.pulsesMaster : 1) : 0;
      windup = STORM.gatherFor + STORM.flight;
      length = volleyEnd + pulses * STORM.tempest.growFor + 0.2;
      body.push(() => {
        w.beat(0, "gather", { index: n, from: caster.pos, duration: STORM.gatherFor });
        for (let i = 1; i <= n && order.length > 0; i++) {
          const f = order[(i - 1) % Math.min(order.length, thousand ? 6 : 4)]!;
          const t = STORM.gatherFor + (i - 1) * gap;
          w.beat(t, "blade", { index: i, from: orbitPoint(caster.pos, i - 1, n, t), to: f.pos, targetIds: [f.id], duration: STORM.flight });
          w.hit(t + STORM.flight, f, thousand ? STORM.thousand.power : 1);
          w.status(t + STORM.flight, f, "shadow_mark", true, 6);
        }
        for (let k = 0; k < pulses; k++) {
          const t0 = volleyEnd + 0.1 + k * STORM.tempest.growFor;
          w.beat(t0, "tempest", { index: k + 1, from: caster.pos, radius: def.radius, duration: STORM.tempest.growFor });
          for (const f of foes) w.hit(t0 + Math.min(1, Math.sqrt(dist2(f.pos, caster.pos)) / def.radius) * STORM.tempest.growFor, f, STORM.tempest.power);
        }
      });
      break;
    }
    case "sovereign_awakening": {
      const aura = master ? SOVEREIGN.auraForMaster : SOVEREIGN.auraFor;
      windup = def.castTime;
      length = def.castTime + aura;
      body.push(() => {
        w.beat(0, "kneel", { from: caster.pos, duration: SOVEREIGN.kneelFor, targetIds: (inp.allies ?? []).map((a) => a.id) });
        w.beat(0.35, "crown", { from: caster.pos, duration: def.castTime - 0.35 });
        w.beat(def.castTime, "aura", { from: caster.pos, radius: 180, duration: aura });
        w.beat(def.castTime + aura, "sovereign_end", { from: caster.pos });
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
