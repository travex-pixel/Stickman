import type { World } from "../engine/World";
import { ARENA } from "../engine/World";
import type { Combatant, SovereignBossState } from "../entities/types";
import type { MechanicStep, SovereignMechanic } from "../data/sovereigns";
import { clamp, dist, type Vec2 } from "../engine/math";
import { addStatus, hasStatus } from "../combat/statuses";
import { hold, startCharge, startSlam, startSweep, startSwing, startVolley } from "./hollowWarden";

/**
 * THE RIFT SOVEREIGNS (data/sovereigns.ts): the region-last gates from stage 61.
 *
 * Each fights with a Warden's frame (phase 2 at half health with its stagger, the basic patterns of
 * hollowWarden.ts) and three mechanics of its own. Every mechanic sends `boss_mechanic` events
 * (warn, strike, end); every part of one that hurts stands in the world as a hostile telegraph
 * first, so AUTO's dodge (`impendingThreat`) and the dash's `escapeFrom` see it. Each has an answer
 * that works by moving, dashing, targeting (the focus tap) or the army's command:
 *
 * The Mirror Knight: Mirror Guard (blows flash back; a manual dash through it shatters it),
 * Mirror Echo (the warrior's last art thrown back along a lane: leave the lane), and in phase 2
 * Mirror Split (two glass images that strike and shatter; only the true knight bleeds).
 *
 * The Storm Titan: Storm Rods (rods that charge and call lightning around them; struck down in
 * time they call nothing), Chain Storm (a bolt that lands on a marked spot and leaps between allies
 * standing close), and in phase 2 Storm Tide (a wave down a marked lane).
 *
 * The Void Queen: Void Well (at two-thirds and a third of her health: the field is drawn to a well
 * whose core hurts), Kneeling Court (courtiers that shield her while they live), and in phase 2
 * Eclipse (the field darkens; her strike falls on a marked spot).
 */

// ---------------------------------------------------------------------------------------------
// Numbers (tuned by measurement: see docs/DESIGN.md, "Rift Sovereigns")
// ---------------------------------------------------------------------------------------------

export const GUARD_WARN = 0.4;
export const GUARD_TIME = 1.8;
/** Share of damage the Knight takes while its mirror stands. */
export const GUARD_TAKEN = 0.25;
/** Share of a blow the mirror flashes back at whoever struck it... */
export const REFLECT_SHARE = 0.3;
/** ...never more than this share of the striker's own health per flash... */
export const REFLECT_CAP = 0.04;
/** ...and at most one flash per striker in this many seconds. */
export const REFLECT_GAP = 0.35;
/** Stagger when a dash shatters the mirror, and the Knight exposed after it: blows land harder. */
export const SHATTER_STAGGER = 1.2;
export const EXPOSED_TIME = 3;
export const EXPOSED_BONUS = 0.3;
/** A dash passing this close to the Knight (beyond its body) goes through the mirror. */
export const SHATTER_REACH = 34;

export const ECHO_WARN = 0.9;
/** Mirror Echo's power by the art it copies, and its lane's half width. */
export const ECHO_POWER: Readonly<Record<string, number>> = { arc_slash: 1.2, blade_tempest: 1.3, thunder_strike: 1.3, chain_hook: 1.1, void_nova: 1.5, soul_burst: 1.2, blood_pact: 1.1, ascendant_fury: 1.6 };
export const ECHO_HALF: Readonly<Record<string, number>> = { arc_slash: 34, blade_tempest: 38, thunder_strike: 26, chain_hook: 24, void_nova: 44, soul_burst: 40, blood_pact: 36, ascendant_fury: 44 };

export const SPLIT_WARN = 0.6;
export const IMAGE_LIFE = 8;
/** An image's health, as a share of the Knight's (a few blows shatter it). */
export const IMAGE_HP = 0.02;
export const IMAGE_ATTACK = 0.45;

export const ROD_CHARGE = 3.0;
export const ROD_RADIUS = 72;
export const ROD_POWER = 1.5;
/** A rod's health, as a share of the Titan's. */
export const ROD_HP = 0.025;
/** A rod that calls its lightning also storms the Titan up: a shield of this share of its health. */
export const ROD_SHIELD = 0.06;
export const ROD_SHIELD_TIME = 10;
/** The warrior's own AUTO goes for a rod or courtier only this close to him (a tap sends him to any). */
export const PART_REACH = 130;

export const CHAIN_WARN = 1.0;
/** The bolt lands on a marked spot of this radius, then leaps between allies this close. */
export const CHAIN_SPOT = 42;
export const CHAIN_RANGE = 90;
export const CHAIN_POWER = 1.3;
export const CHAIN_FALLOFF = 0.7;
export const CHAIN_LEAPS = 5;

export const TIDE_WARN = 1.2;
export const TIDE_HALF = 36;
export const TIDE_POWER = 1.4;

export const WELL_WARN = 0.8;
export const WELL_TIME = 3.0;
export const WELL_CORE = 52;
/** Pull toward the well (units a second): the warrior walks at 160, so he can walk out against it. */
export const WELL_PULL = 62;
export const WELL_POWER = 0.5;
export const WELL_THRESHOLDS = [0.66, 0.33] as const;

export const COURT_WARN = 0.7;
/** A courtier's health, as a share of the Queen's. */
export const COURT_HP = 0.035;
/** Damage the Queen is spared per kneeling courtier, and the least she can take. */
export const COURT_DR = 0.25;
export const COURT_FLOOR = 0.4;

export const ECLIPSE_TIME = 2.5;
/** Her strike's mark shows for this long before it lands (inside the dark). */
export const ECLIPSE_MARK = 1.2;
export const ECLIPSE_RADIUS = 70;
export const ECLIPSE_POWER = 2.0;

const C_MIRROR = 0xd8dde8;
const C_STORM = 0x6fa8ff;
const C_VOID = 0x9a6fe0;

// ---------------------------------------------------------------------------------------------
// State and events
// ---------------------------------------------------------------------------------------------

export function newSovereignState(): SovereignBossState {
  return { lastUsed: {}, guardUntil: -1, exposedUntil: -1, guardReflects: 0, reflectAt: new Map(), images: [], rods: [], court: [], wells: 0, spot: null, spotR: 0, art: null, tele: new Map(), uses: 0, pending: [] };
}

function since(w: World, s: SovereignBossState, m: SovereignMechanic): number {
  const t = s.lastUsed[m];
  return t === undefined ? Infinity : w.time - t;
}

export function sendMechanic(
  w: World,
  src: Combatant,
  mech: SovereignMechanic,
  step: MechanicStep,
  o: { index?: number; pos?: Vec2; to?: Vec2; radius?: number; duration?: number; targets?: number[]; countered?: boolean } = {},
): void {
  const pos = o.pos ?? src.pos;
  const to = o.to ?? pos;
  w.events.push({ type: "boss_mechanic", id: src.id, defId: src.defId, mech, step, index: o.index ?? 0, pos: { x: pos.x, y: pos.y }, to: { x: to.x, y: to.y }, radius: o.radius ?? 0, duration: o.duration ?? 0, targetIds: o.targets ?? [], ...(o.countered ? { countered: true } : {}) });
}

function allies(w: World): Combatant[] {
  const out: Combatant[] = [];
  for (const e of w.entities.values()) if (!e.dead && e.faction === "ally") out.push(e);
  return out;
}

function inLane(e: Combatant, y: number, half: number, fromX: number, dir: 1 | -1): boolean {
  return (e.pos.x - fromX) * dir >= -e.radius && Math.abs(e.pos.y - y) < half;
}

function begin(w: World, b: Combatant, m: SovereignMechanic, timer: number): SovereignBossState {
  const bs = b.boss!;
  bs.pattern = m;
  bs.patternTimer = timer;
  bs.burstCount = 0;
  const s = bs.sov!;
  s.lastUsed[m] = w.time;
  s.uses += 1;
  return s;
}

function finish(w: World, b: Combatant, rest: number, recover = 0.5): void {
  const bs = b.boss!;
  bs.pattern = "idle";
  bs.patternTimer = rest;
  if (recover > 0) w.setState(b, "recover", recover);
}

// ---------------------------------------------------------------------------------------------
// Choosing
// ---------------------------------------------------------------------------------------------

/** A Sovereign's choice when its idle timer runs out (`roll` is the boss AI's draw for this choice). */
export function chooseSovereign(w: World, b: Combatant, target: Combatant, d: number, roll: number): void {
  const bs = b.boss!;
  const s = bs.sov!;
  const p2 = bs.phase === 2;
  const step = bs.patternStep;
  switch (b.defId) {
    case "mirror_knight":
      if (p2 && s.images.length === 0 && since(w, s, "mirror_split") > 14) return startSplit(w, b, target);
      if (step % 3 === 1 && since(w, s, "mirror_guard") > 8) return startGuard(w, b, target);
      if (step % 3 === 2 && w.lastArt && since(w, s, "mirror_echo") > 5) return startEcho(w, b, target, w.lastArt);
      if (d > 160 || roll < 0.25) return startCharge(w, b, target);
      return startSwing(w, b, target);
    case "storm_titan":
      if (s.rods.length === 0 && step % 3 === 1 && since(w, s, "storm_rods") > 9) return startRods(w, b, target);
      if (p2 && step % 3 === 0 && since(w, s, "storm_tide") > 6) return startTide(w, b, target);
      if (step % 3 === 2 && since(w, s, "storm_chain") > 5) return startChain(w, b);
      if (d < 150 && roll < 0.45) return startSlam(w, b);
      if (d > 200) return startCharge(w, b, target);
      return startSwing(w, b, target);
    default: {
      const frac = b.hp / b.stats.maxHp;
      const due = WELL_THRESHOLDS[s.wells];
      if (due !== undefined && frac <= due) return startWell(w, b);
      if (s.court.length === 0 && step % 4 === 1 && since(w, s, "void_court") > 12) return startCourt(w, b);
      if (p2 && step % 3 === 0 && since(w, s, "void_eclipse") > 8) return startEclipse(w, b, target);
      if (d < 150 && roll < 0.55) return startSweep(w, b, target);
      return startVolley(w, b, target);
    }
  }
}

/**
 * Begins `m` now, whatever the Sovereign's own choice would be (tests and the debug preview). The
 * Sovereign must be the one whose mechanic it is.
 */
export function forceMechanic(w: World, b: Combatant, m: SovereignMechanic, target: Combatant = w.player): void {
  const starts: Record<SovereignMechanic, () => void> = {
    mirror_guard: () => startGuard(w, b, target),
    mirror_echo: () => startEcho(w, b, target, w.lastArt ?? "arc_slash"),
    mirror_split: () => startSplit(w, b, target),
    storm_rods: () => startRods(w, b, target),
    storm_chain: () => startChain(w, b),
    storm_tide: () => startTide(w, b, target),
    void_well: () => startWell(w, b),
    void_court: () => startCourt(w, b),
    void_eclipse: () => startEclipse(w, b, target),
  };
  starts[m]();
}

/** One tick of the mechanic in flight. */
export function updateSovereignPattern(w: World, b: Combatant, target: Combatant, dt: number): void {
  const bs = b.boss!;
  const s = bs.sov!;
  bs.patternTimer -= dt;
  w.stop(b);
  switch (bs.pattern) {
    case "mirror_guard":
      hold(b, "cast", bs.patternTimer);
      if (s.guardUntil < 0 && bs.patternTimer <= GUARD_TIME && bs.burstCount === 0) {
        bs.burstCount = 1;
        s.guardUntil = w.time + GUARD_TIME;
        s.guardReflects = 0;
        s.reflectAt.clear();
        sendMechanic(w, b, "mirror_guard", "strike", { to: { x: b.pos.x + b.facing * 40, y: b.pos.y }, radius: b.radius + 14, duration: GUARD_TIME });
      }
      if (bs.patternTimer <= 0) {
        if (s.guardUntil >= 0) {
          s.guardUntil = -1;
          sendMechanic(w, b, "mirror_guard", "end", { radius: b.radius + 14 });
        }
        finish(w, b, 0.6, 0);
      }
      return;
    case "mirror_echo":
      hold(b, "cast", bs.patternTimer);
      if (bs.patternTimer <= 0) strikeEcho(w, b);
      return;
    case "mirror_split":
      hold(b, "cast", bs.patternTimer);
      if (bs.patternTimer <= 0) strikeSplit(w, b);
      return;
    case "storm_rods":
      hold(b, "cast", bs.patternTimer);
      if (bs.patternTimer <= 0) finish(w, b, 0.9, 0.4);
      return;
    case "storm_chain":
      hold(b, "cast", bs.patternTimer);
      if (bs.patternTimer <= 0) strikeChain(w, b);
      return;
    case "storm_tide":
      hold(b, "windup", bs.patternTimer);
      if (bs.patternTimer <= 0) strikeTide(w, b);
      return;
    case "void_well":
      hold(b, "cast", bs.patternTimer);
      tickWell(w, b, dt);
      return;
    case "void_court":
      hold(b, "cast", bs.patternTimer);
      if (bs.patternTimer <= 0) strikeCourt(w, b);
      return;
    case "void_eclipse":
      hold(b, "cast", bs.patternTimer);
      tickEclipse(w, b, target);
      return;
    default:
      bs.pattern = "idle";
  }
}

// ---------------------------------------------------------------------------------------------
// The Mirror Knight
// ---------------------------------------------------------------------------------------------

function startGuard(w: World, b: Combatant, target: Combatant): void {
  b.facing = target.pos.x >= b.pos.x ? 1 : -1;
  begin(w, b, "mirror_guard", GUARD_WARN + GUARD_TIME);
  sendMechanic(w, b, "mirror_guard", "warn", { to: { x: b.pos.x + b.facing * 40, y: b.pos.y }, radius: b.radius + 14, duration: GUARD_WARN });
}

/** Whether the Knight's mirror stands. */
export function guardUp(b: Combatant | undefined): boolean {
  return !!b && !b.dead && (b.boss?.sov?.guardUntil ?? -1) >= 0;
}

/**
 * A manual dash (World.dodge) from `from` along the warrior's dash: if it passes through a standing
 * mirror, the mirror shatters and the Knight staggers.
 */
export function onManualDash(w: World, from: Vec2): void {
  const b = w.boss;
  if (!b || !guardUp(b)) return;
  const p = w.player;
  const to = { x: p.pos.x + p.vel.x * p.stateDuration, y: p.pos.y + p.vel.y * p.stateDuration };
  if (segmentDistance(b.pos, from, to) > b.radius + SHATTER_REACH) return;
  const bs = b.boss!;
  const s = bs.sov!;
  s.guardUntil = -1;
  s.exposedUntil = w.time + EXPOSED_TIME;
  sendMechanic(w, b, "mirror_guard", "end", { to: { ...from }, radius: b.radius + 14, duration: EXPOSED_TIME, targets: [p.id], countered: true });
  w.events.push({ type: "guard_break", id: b.id, pos: { ...b.pos } });
  w.events.push({ type: "shake", strength: 8 });
  bs.pattern = "idle";
  bs.patternTimer = SHATTER_STAGGER + 0.4;
  w.setState(b, "stagger", SHATTER_STAGGER);
}

function segmentDistance(c: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? clamp(((c.x - a.x) * dx + (c.y - a.y) * dy) / len2, 0, 1) : 0;
  return Math.hypot(a.x + dx * t - c.x, a.y + dy * t - c.y);
}

function startEcho(w: World, b: Combatant, target: Combatant, art: string): void {
  b.facing = target.pos.x >= b.pos.x ? 1 : -1;
  const s = begin(w, b, "mirror_echo", ECHO_WARN);
  const half = ECHO_HALF[art] ?? 34;
  const y = clamp(target.pos.y, ARENA.minY, ARENA.maxY);
  s.spot = { x: b.pos.x, y };
  s.spotR = half;
  s.art = art;
  const length = b.facing === 1 ? ARENA.maxX - b.pos.x : b.pos.x - ARENA.minX;
  s.tele.set(-1, w.addTelegraph({ x: b.pos.x, y }, half, ECHO_WARN, "line", b.facing, length, C_MIRROR));
  sendMechanic(w, b, "mirror_echo", "warn", { pos: { x: b.pos.x, y }, to: { x: b.pos.x + b.facing * length, y }, radius: half, duration: ECHO_WARN, targets: [target.id] });
}

function strikeEcho(w: World, b: Combatant): void {
  const s = b.boss!.sov!;
  const spot = s.spot ?? b.pos;
  const half = s.spotR;
  const art = s.art ?? "arc_slash";
  const length = b.facing === 1 ? ARENA.maxX - spot.x : spot.x - ARENA.minX;
  const hit: number[] = [];
  for (const e of allies(w)) if (inLane(e, spot.y, half, spot.x, b.facing)) hit.push(e.id);
  w.events.push({ type: "attack_swing", id: b.id, kind: "boss", heavy: true, pos: { ...b.pos }, facing: b.facing });
  sendMechanic(w, b, "mirror_echo", "strike", { pos: spot, to: { x: spot.x + b.facing * length, y: spot.y }, radius: half, targets: hit });
  for (const id of hit) {
    const e = w.entities.get(id);
    if (e && !e.dead) w.dealDamage(b, e, ECHO_POWER[art] ?? 1.2, "void", true);
  }
  sendMechanic(w, b, "mirror_echo", "end", { pos: spot, radius: half });
  s.spot = null;
  finish(w, b, 0.8, 0.5);
}

function startSplit(w: World, b: Combatant, target: Combatant): void {
  const s = begin(w, b, "mirror_split", SPLIT_WARN);
  b.facing = target.pos.x >= b.pos.x ? 1 : -1;
  const spots = [-1, 1].map((k) => ({ x: clamp(b.pos.x - b.facing * 30, ARENA.minX + 20, ARENA.maxX - 20), y: clamp(b.pos.y + k * 46, ARENA.minY, ARENA.maxY) }));
  s.spot = { ...b.pos };
  for (const at of spots) w.addTelegraph(at, 26, SPLIT_WARN, "circle", 1, 0, C_MIRROR, false);
  s.pending = spots;
  sendMechanic(w, b, "mirror_split", "warn", { radius: 46, duration: SPLIT_WARN });
}

function strikeSplit(w: World, b: Combatant): void {
  const s = b.boss!.sov!;
  const spots = s.pending;
  s.pending = [];
  const ids: number[] = [];
  spots.forEach((at, i) => {
    const img = w.spawnEnemy("mirror_image", { pos: at, minion: true, ownerId: b.id });
    img.enemy!.sovPart = { kind: "image", fixture: false, index: i + 1, ownerId: b.id };
    img.stats.maxHp = Math.max(1, Math.round(b.stats.maxHp * IMAGE_HP));
    img.hp = img.stats.maxHp;
    img.stats.attack = Math.round(b.stats.attack * IMAGE_ATTACK * 10) / 10;
    img.stats.defense = 0;
    img.stats.moveSpeed = b.stats.moveSpeed;
    img.scale = b.scale;
    img.radius = b.radius - 4;
    ids.push(img.id);
  });
  // The true Knight trades places with one of its images (or keeps its own): read the crack.
  const swap = Math.floor(w.rng.next() * (ids.length + 1));
  const other = swap < ids.length ? w.entities.get(ids[swap]!) : undefined;
  if (other) {
    const a = { ...b.pos };
    b.pos = { ...other.pos };
    b.prevPos = { ...b.pos };
    other.pos = a;
    other.prevPos = { ...a };
  }
  s.images = ids;
  w.events.push({ type: "shake", strength: 6 });
  sendMechanic(w, b, "mirror_split", "strike", { pos: b.pos, radius: 46, duration: IMAGE_LIFE, targets: ids });
  w.schedule(IMAGE_LIFE, () => {
    for (const id of ids) {
      const e = w.entities.get(id);
      if (e && !e.dead) dismissPart(w, e);
    }
  });
  finish(w, b, 0.8, 0.4);
}

// ---------------------------------------------------------------------------------------------
// The Storm Titan
// ---------------------------------------------------------------------------------------------

function startRods(w: World, b: Combatant, target: Combatant): void {
  const s = begin(w, b, "storm_rods", 0.8);
  const n = b.boss!.phase === 2 ? 3 : 2;
  const spots: Vec2[] = [];
  // One beside the warrior's target, the rest spread across the field away from it.
  spots.push({ x: clamp(target.pos.x + (target.pos.x < (ARENA.minX + ARENA.maxX) / 2 ? 70 : -70), ARENA.minX + 30, ARENA.maxX - 30), y: clamp(target.pos.y + (w.rng.next() - 0.5) * 50, ARENA.minY + 10, ARENA.maxY - 10) });
  for (let i = 1; i < n; i++) {
    const band = (ARENA.maxX - ARENA.minX - 80) / (n - 1);
    spots.push({ x: ARENA.minX + 40 + band * (i - 1) + w.rng.next() * band * 0.8, y: ARENA.minY + 14 + w.rng.next() * (ARENA.maxY - ARENA.minY - 28) });
  }
  s.rods = [];
  spots.forEach((at, i) => {
    const rod = w.spawnEnemy("storm_rod", { pos: at, minion: true, ownerId: b.id });
    rod.enemy!.sovPart = { kind: "rod", fixture: true, index: i + 1, ownerId: b.id };
    rod.stats.maxHp = Math.max(1, Math.round(b.stats.maxHp * ROD_HP));
    rod.hp = rod.stats.maxHp;
    rod.stats.attack = 0;
    rod.stats.defense = 0;
    s.rods.push(rod.id);
    const tele = w.addTelegraph(at, ROD_RADIUS, ROD_CHARGE, "circle", 1, 0, C_STORM);
    s.tele.set(rod.id, tele);
    sendMechanic(w, b, "storm_rods", "warn", { index: i + 1, pos: at, radius: ROD_RADIUS, duration: ROD_CHARGE, targets: [rod.id] });
    w.schedule(ROD_CHARGE, () => {
      if (rod.dead || b.dead || w.phase !== "boss") return;
      s.tele.delete(rod.id);
      const hit = allies(w).filter((e) => dist(e.pos, rod.pos) < ROD_RADIUS);
      sendMechanic(w, b, "storm_rods", "strike", { index: i + 1, pos: rod.pos, to: { x: rod.pos.x, y: ARENA.minY - 120 }, radius: ROD_RADIUS, targets: hit.map((e) => e.id) });
      w.events.push({ type: "shake", strength: 6 });
      for (const e of hit) w.dealDamage(b, e, ROD_POWER, "lightning", true);
      // The storm it called feeds the Titan.
      addStatus(b, { kind: "shield", remaining: ROD_SHIELD_TIME, value: Math.round(b.stats.maxHp * ROD_SHIELD), sourceId: b.id });
      w.events.push({ type: "shield", id: b.id, pos: { ...b.pos } });
      dismissPart(w, rod);
      sendMechanic(w, b, "storm_rods", "end", { index: i + 1, pos: rod.pos, radius: ROD_RADIUS });
    });
  });
}

function startChain(w: World, b: Combatant): void {
  const s = begin(w, b, "storm_chain", CHAIN_WARN);
  // The bolt seeks the tightest knot of allies (the warrior on a tie).
  const all = allies(w);
  let first = w.player.dead ? (all[0] ?? w.player) : w.player;
  let best = -1;
  for (const e of all) {
    const n = all.filter((o) => o !== e && dist(o.pos, e.pos) < CHAIN_RANGE).length;
    if (n > best || (n === best && e === w.player)) {
      best = n;
      first = e;
    }
  }
  s.spot = { ...first.pos };
  s.tele.set(-1, w.addTelegraph(s.spot, CHAIN_SPOT, CHAIN_WARN, "circle", 1, 0, C_STORM));
  const path = chainFrom(w, s.spot);
  sendMechanic(w, b, "storm_chain", "warn", { pos: b.pos, to: s.spot, radius: CHAIN_RANGE, duration: CHAIN_WARN, targets: path.map((e) => e.id) });
}

/** The bolt's path from where it lands: the ally on the spot, then each nearest ally within reach. */
export function chainFrom(w: World, spot: Vec2): Combatant[] {
  const all = allies(w);
  let lead: Combatant | null = null;
  for (const e of all) if (dist(e.pos, spot) < CHAIN_SPOT + e.radius * 0.5 && (!lead || dist(e.pos, spot) < dist(lead.pos, spot))) lead = e;
  if (!lead) return [];
  const path = [lead];
  for (let k = 0; k < CHAIN_LEAPS; k++) {
    const at = path[path.length - 1]!;
    let next: Combatant | null = null;
    for (const e of all) if (!path.includes(e) && dist(e.pos, at.pos) < CHAIN_RANGE && (!next || dist(e.pos, at.pos) < dist(next.pos, at.pos))) next = e;
    if (!next) break;
    path.push(next);
  }
  return path;
}

function strikeChain(w: World, b: Combatant): void {
  const s = b.boss!.sov!;
  const spot = s.spot ?? b.pos;
  const path = chainFrom(w, spot).filter((e) => !hasStatus(e, "invuln"));
  sendMechanic(w, b, "storm_chain", "strike", { pos: { x: spot.x, y: ARENA.minY - 120 }, to: spot, radius: CHAIN_RANGE, targets: path.map((e) => e.id) });
  if (path.length > 0) w.events.push({ type: "shake", strength: 5 });
  path.forEach((e, k) => w.dealDamage(b, e, CHAIN_POWER * Math.pow(CHAIN_FALLOFF, k), "lightning", k === 0));
  sendMechanic(w, b, "storm_chain", "end", { pos: spot, radius: CHAIN_RANGE, countered: path.length <= 1 });
  s.spot = null;
  finish(w, b, 0.8, 0.5);
}

function startTide(w: World, b: Combatant, target: Combatant): void {
  const s = begin(w, b, "storm_tide", TIDE_WARN);
  b.facing = target.pos.x >= b.pos.x ? 1 : -1;
  const y = clamp(target.pos.y, ARENA.minY, ARENA.maxY);
  const fromX = b.facing === 1 ? ARENA.minX : ARENA.maxX;
  s.spot = { x: fromX, y };
  s.tele.set(-1, w.addTelegraph({ x: fromX, y }, TIDE_HALF, TIDE_WARN, "line", b.facing, ARENA.maxX - ARENA.minX, C_STORM));
  sendMechanic(w, b, "storm_tide", "warn", { pos: s.spot, to: { x: b.facing === 1 ? ARENA.maxX : ARENA.minX, y }, radius: TIDE_HALF, duration: TIDE_WARN });
}

function strikeTide(w: World, b: Combatant): void {
  const s = b.boss!.sov!;
  const spot = s.spot ?? b.pos;
  const end = { x: b.facing === 1 ? ARENA.maxX : ARENA.minX, y: spot.y };
  const hit = allies(w).filter((e) => Math.abs(e.pos.y - spot.y) < TIDE_HALF);
  w.events.push({ type: "attack_swing", id: b.id, kind: "boss", heavy: true, pos: { ...b.pos }, facing: b.facing });
  w.events.push({ type: "shake", strength: 10 });
  sendMechanic(w, b, "storm_tide", "strike", { pos: spot, to: end, radius: TIDE_HALF, duration: 0.6, targets: hit.map((e) => e.id) });
  for (const e of hit) {
    if (w.dealDamage(b, e, TIDE_POWER, "void", true)) w.applyKnockback(e, { x: e.pos.x - b.facing * 40, y: e.pos.y }, 320);
  }
  sendMechanic(w, b, "storm_tide", "end", { pos: end, radius: TIDE_HALF });
  s.spot = null;
  finish(w, b, 0.9, 0.6);
}

// ---------------------------------------------------------------------------------------------
// The Void Queen
// ---------------------------------------------------------------------------------------------

/** The well opens at the middle of the field. */
export function wellCenter(): Vec2 {
  return { x: (ARENA.minX + ARENA.maxX) / 2, y: (ARENA.minY + ARENA.maxY) / 2 };
}

function startWell(w: World, b: Combatant): void {
  const s = begin(w, b, "void_well", WELL_WARN + WELL_TIME);
  s.wells += 1;
  const center = wellCenter();
  s.spot = center;
  // The core is marked for the whole well: a zone the warrior's own feet leave.
  s.tele.set(-1, w.addTelegraph(center, WELL_CORE, WELL_WARN + WELL_TIME, "circle", 1, 0, C_VOID));
  w.sovZones.push({ pos: { ...center }, radius: WELL_CORE, until: w.time + WELL_WARN + WELL_TIME });
  sendMechanic(w, b, "void_well", "warn", { index: s.wells, pos: center, to: center, radius: WELL_CORE, duration: WELL_WARN });
}

function tickWell(w: World, b: Combatant, dt: number): void {
  const bs = b.boss!;
  const s = bs.sov!;
  const center = s.spot ?? wellCenter();
  const open = bs.patternTimer <= WELL_TIME;
  if (open && bs.burstCount === 0) {
    bs.burstCount = 1;
    bs.burstNext = 0;
    sendMechanic(w, b, "void_well", "strike", { index: s.wells, pos: center, to: center, radius: ARENA.maxX - ARENA.minX, duration: WELL_TIME, targets: allies(w).map((e) => e.id) });
  }
  if (open && bs.patternTimer > 0) {
    for (const e of allies(w)) {
      if (e === w.player && w.ultimate.active) continue;
      if (hasStatus(e, "invuln") && e.state === "dodge") continue;
      const dx = center.x - e.pos.x;
      const dy = center.y - e.pos.y;
      const len = Math.hypot(dx, dy);
      if (len < 3) continue;
      const pull = Math.min(len, WELL_PULL * dt);
      e.pos.x += (dx / len) * pull;
      e.pos.y += (dy / len) * pull;
    }
    bs.burstNext = (bs.burstNext ?? 0) - dt;
    if (bs.burstNext <= 0) {
      bs.burstNext = 0.5;
      for (const e of allies(w)) if (dist(e.pos, center) < WELL_CORE) w.dealDamage(b, e, WELL_POWER, "void", false);
    }
  }
  if (bs.patternTimer <= 0) {
    sendMechanic(w, b, "void_well", "end", { index: s.wells, pos: center, radius: WELL_CORE });
    s.spot = null;
    finish(w, b, 0.7, 0.4);
  }
}

function startCourt(w: World, b: Combatant): void {
  const s = begin(w, b, "void_court", COURT_WARN);
  const n = b.boss!.phase === 2 ? 3 : 2;
  // They kneel behind her, away from the warrior: the far ones are a tap's (or Aggressive's) work.
  const back = b.pos.x >= w.player.pos.x ? 1 : -1;
  const spots: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const k = n === 2 ? (i === 0 ? -1 : 1) : i - 1;
    spots.push({ x: clamp(b.pos.x + back * (70 + (k === 0 ? 40 : 0)), ARENA.minX + 20, ARENA.maxX - 20), y: clamp(b.pos.y + k * 50, ARENA.minY + 6, ARENA.maxY - 6) });
  }
  s.pending = spots;
  for (const at of spots) w.addTelegraph(at, 22, COURT_WARN, "circle", 1, 0, C_VOID, false);
  sendMechanic(w, b, "void_court", "warn", { radius: 60, duration: COURT_WARN });
  w.events.push({ type: "minion_called", id: b.id, pos: { ...b.pos } });
}

function strikeCourt(w: World, b: Combatant): void {
  const s = b.boss!.sov!;
  const spots = s.pending;
  s.pending = [];
  s.court = [];
  spots.forEach((at, i) => {
    const c = w.spawnEnemy("void_courtier", { pos: at, minion: true, ownerId: b.id });
    c.enemy!.sovPart = { kind: "courtier", fixture: true, index: i + 1, ownerId: b.id };
    c.stats.maxHp = Math.max(1, Math.round(b.stats.maxHp * COURT_HP));
    c.hp = c.stats.maxHp;
    c.stats.attack = 0;
    c.stats.defense = 0;
    c.facing = b.pos.x >= at.x ? 1 : -1;
    s.court.push(c.id);
  });
  sendMechanic(w, b, "void_court", "strike", { radius: 60, targets: [...s.court] });
  finish(w, b, 0.6, 0.3);
}

/** How much of a blow the Queen takes with her court kneeling. */
export function courtShield(living: number): number {
  return Math.max(COURT_FLOOR, 1 - COURT_DR * living);
}

function startEclipse(w: World, b: Combatant, target: Combatant): void {
  const s = begin(w, b, "void_eclipse", ECLIPSE_TIME);
  s.spot = null;
  sendMechanic(w, b, "void_eclipse", "warn", { pos: b.pos, to: target.pos, radius: ECLIPSE_RADIUS, duration: ECLIPSE_TIME, targets: [target.id] });
}

function tickEclipse(w: World, b: Combatant, target: Combatant): void {
  const bs = b.boss!;
  const s = bs.sov!;
  if (!s.spot && bs.patternTimer <= ECLIPSE_MARK) {
    // In the dark, her strike's mark still shows on the ground.
    s.spot = { x: clamp(target.pos.x, ARENA.minX, ARENA.maxX), y: clamp(target.pos.y, ARENA.minY, ARENA.maxY) };
    s.tele.set(-1, w.addTelegraph(s.spot, ECLIPSE_RADIUS, bs.patternTimer, "circle", 1, 0, C_VOID));
  }
  if (bs.patternTimer > 0) return;
  const spot = s.spot ?? { ...target.pos };
  const hit = allies(w).filter((e) => dist(e.pos, spot) < ECLIPSE_RADIUS);
  w.events.push({ type: "shake", strength: 12 });
  sendMechanic(w, b, "void_eclipse", "strike", { pos: b.pos, to: spot, radius: ECLIPSE_RADIUS, targets: hit.map((e) => e.id) });
  for (const e of hit) if (w.dealDamage(b, e, ECLIPSE_POWER, "void", true)) w.applyKnockback(e, spot, 240);
  sendMechanic(w, b, "void_eclipse", "end", { pos: spot, radius: ECLIPSE_RADIUS });
  s.spot = null;
  finish(w, b, 0.8, 0.6);
}

// ---------------------------------------------------------------------------------------------
// World hooks
// ---------------------------------------------------------------------------------------------

/**
 * A blow reaching a Sovereign (World.applyRawDamage): the mirror spares the Knight most of it and
 * flashes a share back at the striker; a kneeling court spares the Queen. Returns what lands.
 */
export function sovereignIncoming(w: World, b: Combatant, amount: number, sourceId: number): number {
  const s = b.boss?.sov;
  if (!s) return amount;
  let m = 1;
  if (s.guardUntil >= 0) {
    m *= GUARD_TAKEN;
    reflect(w, b, s, amount, sourceId);
  } else if (w.time < s.exposedUntil) m *= 1 + EXPOSED_BONUS;
  if (s.court.length > 0) m *= courtShield(s.court.length);
  return amount * m;
}

function reflect(w: World, b: Combatant, s: SovereignBossState, amount: number, sourceId: number): void {
  const src = w.entities.get(sourceId);
  if (!src || src.dead || src.faction !== "ally" || hasStatus(src, "invuln") || hasStatus(src, "vanished")) return;
  const last = s.reflectAt.get(src.id);
  if (last !== undefined && w.time - last < REFLECT_GAP) return;
  s.reflectAt.set(src.id, w.time);
  let r = Math.min(amount * REFLECT_SHARE, src.stats.maxHp * REFLECT_CAP);
  // Never the killing flash from above 30%, and never a shadow at full health in one.
  if (src.hp > src.stats.maxHp * 0.3 || src.hp >= src.stats.maxHp) r = Math.min(r, src.hp - 1);
  r = Math.round(r);
  if (r < 1) return;
  s.guardReflects += 1;
  sendMechanic(w, b, "mirror_guard", "strike", { index: s.guardReflects, pos: b.pos, to: src.pos, radius: b.radius + 14, targets: [src.id] });
  w.applyRawDamage(src, r, "void", b.id, false);
}

/** A Sovereign's part fell (struck down, or dismissed). */
export function onPartFell(w: World, e: Combatant): void {
  const part = e.enemy?.sovPart;
  if (!part) return;
  const owner = w.entities.get(part.ownerId);
  const s = owner?.boss?.sov;
  if (!owner || !s) return;
  const struck = !part.dismissed;
  if (part.kind === "rod") {
    const at = s.rods.indexOf(e.id);
    if (at < 0) return;
    s.rods.splice(at, 1);
    const tele = s.tele.get(e.id);
    if (tele) {
      // A rod struck down before it charged calls nothing: its circle goes with it.
      tele.remaining = 0;
      s.tele.delete(e.id);
      sendMechanic(w, owner, "storm_rods", "end", { index: part.index, pos: e.pos, radius: ROD_RADIUS, countered: struck });
    }
  } else if (part.kind === "courtier") {
    const at = s.court.indexOf(e.id);
    if (at < 0) return;
    s.court.splice(at, 1);
    if (s.court.length === 0) sendMechanic(w, owner, "void_court", "end", { pos: owner.pos, radius: 60, countered: struck });
  } else {
    const at = s.images.indexOf(e.id);
    if (at < 0) return;
    s.images.splice(at, 1);
    if (struck) sendMechanic(w, owner, "mirror_split", "strike", { index: part.index, pos: e.pos, radius: e.radius, targets: [e.id] });
    if (s.images.length === 0) sendMechanic(w, owner, "mirror_split", "end", { pos: owner.pos, radius: 46, countered: struck });
  }
}

/** Withdraws a part without it being struck down (no reward is ever paid for a part). */
export function dismissPart(w: World, e: Combatant): void {
  if (e.dead) return;
  if (e.enemy?.sovPart) e.enemy.sovPart.dismissed = true;
  w.kill(e, -1);
}

const MECHANICS: ReadonlySet<string> = new Set(["mirror_guard", "mirror_echo", "mirror_split", "storm_rods", "storm_chain", "storm_tide", "void_well", "void_court", "void_eclipse"]);

/**
 * The mechanic in flight is cut short (phase 2's stagger, or the Sovereign's fall): it ends where it
 * stands, nothing more of it lands, and its mirror or well goes with it. Rods and courtiers already
 * raised stay (they are bodies on the field) until they fall or the Sovereign does.
 */
export function interruptMechanic(w: World, b: Combatant): void {
  const bs = b.boss;
  const s = bs?.sov;
  if (!bs || !s || !MECHANICS.has(bs.pattern)) return;
  const m = bs.pattern as SovereignMechanic;
  const raised = m === "storm_rods" || (m === "void_court" && s.pending.length === 0) || (m === "mirror_guard" && bs.burstCount === 1 && s.guardUntil < 0);
  if (!raised) sendMechanic(w, b, m, "end", { pos: s.spot ?? b.pos, radius: s.spotR });
  if (m === "void_well") for (const z of w.sovZones) z.until = Math.min(z.until, w.time);
  const tele = s.tele.get(-1);
  if (tele) tele.remaining = 0;
  s.tele.delete(-1);
  s.guardUntil = -1;
  s.spot = null;
  s.pending = [];
  bs.pattern = "idle";
}

/** The Sovereign fell: whatever it raised goes with it. */
export function dismissAllParts(w: World, b: Combatant): void {
  interruptMechanic(w, b);
  for (const e of w.entities.values()) if (!e.dead && e.enemy?.sovPart?.ownerId === b.id) dismissPart(w, e);
}

/**
 * Parts the warrior and the army go for first (a rod charging, a courtier kneeling), the nearest
 * within `reach` of `from`.
 */
export function priorityPart(w: World, from: Vec2, reach = Infinity): Combatant | null {
  let best: Combatant | null = null;
  let bd = reach;
  for (const e of w.entities.values()) {
    const k = e.enemy?.sovPart?.kind;
    if (e.dead || (k !== "rod" && k !== "courtier")) continue;
    const d = dist(from, e.pos);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}
