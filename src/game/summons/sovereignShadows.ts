import type { World } from "../engine/World";
import { ARENA } from "../engine/World";
import type { Combatant } from "../entities/types";
import { clamp, dist, type Vec2 } from "../engine/math";
import { createSummon } from "../entities/factory";
import { factionWithin, isHidden } from "../combat/targeting";
import { isSovereign, type SovereignMechanic } from "../data/sovereigns";
import { ECHO_HALF, sendMechanic } from "../bosses/sovereigns";

/**
 * SOVEREIGN SHADOWS: a Rift Sovereign bound to the army wields its own mechanics against the
 * warrior's foes. Each has two actives on their own cooldowns, a passive, and a Sovereign ultimate
 * that fires with the warrior's Ascendant Fury (or, with AUTO off, on a long cooldown of its own).
 * They send the same `boss_mechanic` events as the bosses (with `id` the shadow's), so the renderer
 * stages them the same way, and the usual `summon_ability` event as every shadow does.
 *
 * The Mirror Knight: Mirror Guard (a mirror before the warrior: his wounds lighter, a share flashed
 * back), Mirror Echo (the warrior's last art, or a share of his last signature blow, thrown down a
 * lane of foes); passive Silvered Oath (a share of every blow on the warrior flashes back);
 * ultimate Mirror Split (two images of the Knight fight beside it).
 *
 * The Storm Titan: Storm Rods (rods planted among the foes call lightning on them; foes by a rod
 * count as marked for the signature skills), Chain Storm (a bolt leaping between foes standing
 * close); passive Thunderous (its blows crash on the foes around its target); ultimate Storm Tide
 * (a wave down the most crowded lane).
 *
 * The Void Queen: Void Well (foes drawn together, its core hurts them; a singularity for Gravity
 * Feast), Kneeling Court (shadow courtiers who rise and fight a while); passive Dark Majesty (foes
 * near her take more from the whole army); ultimate Eclipse (the field darkens and every foe is
 * struck from the dark).
 */

export const SHADOW_KIT = {
  mirror_knight: {
    /** `cap`: the most one flash can carry, in the Knight's own blows (so it scales with the shadow). */
    guard: { cooldown: 10, warn: 0.3, time: 3, taken: 0.6, reflect: 0.6, cap: 1.5 },
    echo: { cooldown: 6, warn: 0.45, power: 4.5, sigShare: 0.25 },
    passive: { reflect: 0.25, cap: 0.75 },
    ult: { images: 2, warn: 0.3, life: 6, share: 0.5 },
  },
  storm_titan: {
    rods: { cooldown: 11, n: 3, charge: 1.2, radius: 70, power: 2.0 },
    chain: { cooldown: 7, warn: 0.35, range: 110, leaps: 6, power: 2.0, falloff: 0.85 },
    passive: { radius: 70, share: 0.35 },
    ult: { warn: 0.6, half: 40, power: 3.0 },
  },
  void_queen: {
    well: { cooldown: 12, warn: 0.4, time: 2.5, reach: 150, pull: 90, core: 50, power: 0.6 },
    court: { cooldown: 15, n: 2, warn: 0.3, life: 7, share: 0.5 },
    passive: { radius: 150, bonus: 0.12 },
    ult: { warn: 1.5, power: 2.5 },
  },
} as const;

/** With AUTO off, a Sovereign's ultimate comes on this cooldown of its own. */
export const SHADOW_ULT_COOLDOWN = 40;
/** With the Fury, never more often than this: a warrior who casts it back to back gets no more. */
export const SHADOW_ULT_GAP = 15;

export type SovereignShadowId = keyof typeof SHADOW_KIT;

export function isSovereignShadow(defId: string): defId is SovereignShadowId {
  return isSovereign(defId);
}

/** Bodies a Sovereign shadow raised (images, courtiers): not shades, never kept. */
const COURTIER = "shadow_courtier";

function foes(w: World): Combatant[] {
  const out: Combatant[] = [];
  for (const e of w.entities.values()) {
    if (e.dead || e.faction !== "enemy" || isHidden(e)) continue;
    if (e.pos.x < ARENA.minX - 20 || e.pos.x > ARENA.maxX + 20) continue;
    out.push(e);
  }
  return out;
}

/** The foe with the most others near it (a boss counts as three), and the middle of its knot. */
function densest(w: World, radius: number, list = foes(w)): { center: Vec2; lead: Combatant; members: Combatant[] } | null {
  let best: Combatant[] = [];
  let lead: Combatant | null = null;
  let score = -1;
  for (const a of list) {
    const members = list.filter((b) => dist(a.pos, b.pos) <= radius);
    const sc = members.reduce((n, b) => n + (b.kind === "boss" ? 3 : 1), 0);
    if (sc > score) {
      score = sc;
      best = members;
      lead = a;
    }
  }
  if (!lead) return null;
  const x = best.reduce((n, b) => n + b.pos.x, 0) / best.length;
  const y = best.reduce((n, b) => n + b.pos.y, 0) / best.length;
  return { center: { x: clamp(x, ARENA.minX, ARENA.maxX), y: clamp(y, ARENA.minY, ARENA.maxY) }, lead, members: best };
}

function mech(w: World, s: Combatant, m: SovereignMechanic, step: "warn" | "strike" | "end", o: Parameters<typeof sendMechanic>[4] = {}): void {
  sendMechanic(w, s, m, step, o);
}

function announce(w: World, s: Combatant, ability: string, pos: Vec2 = s.pos): void {
  w.events.push({ type: "summon_ability", id: s.id, defId: s.defId, ability, pos: { ...pos } });
}

function kit(s: Combatant) {
  const sum = s.summon!;
  if (!sum.sov) sum.sov = { cd1: 2.5, cd2: 4, ult: SHADOW_ULT_COOLDOWN * 0.5, guardUntil: -1, lastUlt: -Infinity };
  return sum.sov;
}

/**
 * The kit's clocks, every tick the shadow is on the field (summons/ai.ts calls it before anything
 * else): a shadow busy striking, casting or staggered still comes off cooldown.
 */
export function tickSovereignKit(s: Combatant, dt: number): void {
  const k = kit(s);
  k.cd1 = Math.max(0, k.cd1 - dt);
  k.cd2 = Math.max(0, k.cd2 - dt);
  k.ult = Math.max(0, k.ult - dt);
  s.summon!.abilityCooldown = Math.min(k.cd1, k.cd2);
}

/**
 * The Sovereign shadow's turn (summons/ai.ts calls it in place of the one-active `tryActive`).
 * Returns whether it acted (cast something) this tick.
 */
export function sovereignShadowTurn(w: World, s: Combatant, target: Combatant): boolean {
  const k = kit(s);
  const list = foes(w);
  if (list.length === 0) return false;
  // With AUTO off nothing casts the Fury for it: its ultimate keeps its own, long clock.
  if (!w.loadout.autoCast && k.ult <= 0 && (w.boss || list.length >= 3)) {
    k.ult = SHADOW_ULT_COOLDOWN;
    sovereignUltimate(w, s);
    return true;
  }
  switch (s.defId as SovereignShadowId) {
    case "mirror_knight": {
      const K = SHADOW_KIT.mirror_knight;
      const threatened = !!w.boss || factionWithin(w.player.pos, "enemy", w.entities.values(), 160).length > 0;
      if (k.cd1 <= 0 && threatened && !w.player.dead) {
        k.cd1 = K.guard.cooldown;
        mirrorGuard(w, s);
        return true;
      }
      if (k.cd2 <= 0) {
        k.cd2 = K.echo.cooldown;
        mirrorEcho(w, s, target);
        return true;
      }
      return false;
    }
    case "storm_titan": {
      const K = SHADOW_KIT.storm_titan;
      if (k.cd1 <= 0) {
        k.cd1 = K.rods.cooldown;
        stormRods(w, s, list);
        return true;
      }
      if (k.cd2 <= 0) {
        k.cd2 = K.chain.cooldown;
        stormChain(w, s, target, list);
        return true;
      }
      return false;
    }
    case "void_queen": {
      const K = SHADOW_KIT.void_queen;
      if (k.cd1 <= 0 && (list.length >= 2 || w.boss)) {
        k.cd1 = K.well.cooldown;
        voidWell(w, s, list);
        return true;
      }
      if (k.cd2 <= 0) {
        k.cd2 = K.court.cooldown;
        voidCourt(w, s);
        return true;
      }
      return false;
    }
    default:
      return false;
  }
}

/** The warrior's Fury began: every Sovereign shadow on the field casts its ultimate with it. */
export function onFury(w: World): void {
  for (const s of w.summonEntities()) {
    if (!isSovereignShadow(s.defId) || s.summon?.temporary || s.state === "emerge") continue;
    const k = kit(s);
    if (w.time - k.lastUlt < SHADOW_ULT_GAP) continue;
    sovereignUltimate(w, s);
  }
}

function sovereignUltimate(w: World, s: Combatant): void {
  if (s.dead) return;
  kit(s).lastUlt = w.time;
  switch (s.defId as SovereignShadowId) {
    case "mirror_knight":
      return mirrorSplit(w, s);
    case "storm_titan":
      return stormTide(w, s);
    case "void_queen":
      return eclipse(w, s);
  }
}

// ---------------------------------------------------------------------------------------------
// The Mirror Knight
// ---------------------------------------------------------------------------------------------

function mirrorGuard(w: World, s: Combatant): void {
  const K = SHADOW_KIT.mirror_knight.guard;
  const k = kit(s);
  const p = w.player;
  mech(w, s, "mirror_guard", "warn", { pos: p.pos, to: p.pos, radius: p.radius + 16, duration: K.warn, targets: [p.id] });
  announce(w, s, "Mirror Guard", p.pos);
  w.setState(s, "cast", 0.4);
  w.schedule(K.warn, () => {
    if (s.dead) return;
    k.guardUntil = w.time + K.time;
    mech(w, s, "mirror_guard", "strike", { pos: p.pos, to: p.pos, radius: p.radius + 16, duration: K.time, targets: [p.id] });
    w.schedule(K.time, () => {
      k.guardUntil = -1;
      mech(w, s, "mirror_guard", "end", { pos: p.pos, radius: p.radius + 16 });
    });
  });
}

/**
 * A blow reaching the warrior with a Mirror Knight shadow fielded: its guard (while up) lightens it
 * and flashes a share back; its passive flashes a share back always. Returns what lands.
 */
export function mirrorShadowIncoming(w: World, amount: number, sourceId: number): number {
  const src = w.entities.get(sourceId);
  if (!src || src.dead || src.faction !== "enemy") return amount;
  let landed = amount;
  for (const s of w.summonEntities()) {
    if (s.defId !== "mirror_knight" || s.summon?.temporary) continue;
    const k = kit(s);
    const guard = k.guardUntil >= 0 && w.time < k.guardUntil;
    const K = SHADOW_KIT.mirror_knight;
    const share = K.passive.reflect + (guard ? K.guard.reflect : 0);
    if (guard) landed *= K.guard.taken;
    // A flash carries a share of the blow, but never more than a few of the Knight's own.
    const r = Math.round(Math.min(amount * share, s.stats.attack * (guard ? K.guard.cap : K.passive.cap)));
    if (r >= 1) {
      if (guard) mech(w, s, "mirror_guard", "strike", { index: 1, pos: w.player.pos, to: src.pos, radius: w.player.radius + 16, targets: [src.id] });
      w.applyRawDamage(src, r, "void", s.id, false);
    }
    break;
  }
  return landed;
}

function mirrorEcho(w: World, s: Combatant, target: Combatant): void {
  const K = SHADOW_KIT.mirror_knight.echo;
  const art = w.lastArt ?? "arc_slash";
  const half = ECHO_HALF[art] ?? 34;
  const knot = densest(w, 80) ?? { center: target.pos, lead: target, members: [target] };
  const y = knot.center.y;
  const dir: 1 | -1 = knot.center.x >= s.pos.x ? 1 : -1;
  const fromX = clamp(s.pos.x - dir * 20, ARENA.minX, ARENA.maxX);
  const length = dir === 1 ? ARENA.maxX - fromX : fromX - ARENA.minX;
  const to = { x: fromX + dir * length, y };
  // The last signature blow of the warrior's, if lately: the echo carries a share of it too.
  const sig = w.lastSigHit && w.time - w.lastSigHit.at < 6 ? w.lastSigHit : null;
  w.addTelegraph({ x: fromX, y }, half, K.warn, "line", dir, length, 0xd8dde8, false);
  mech(w, s, "mirror_echo", "warn", { pos: { x: fromX, y }, to, radius: half, duration: K.warn });
  announce(w, s, "Mirror Echo");
  s.facing = dir;
  w.setState(s, "cast", K.warn + 0.15);
  w.schedule(K.warn, () => {
    if (s.dead) return;
    const hit = foes(w).filter((e) => (e.pos.x - fromX) * dir >= -e.radius && Math.abs(e.pos.y - y) < half + e.radius * 0.5);
    mech(w, s, "mirror_echo", "strike", { pos: { x: fromX, y }, to, radius: half, targets: hit.map((e) => e.id) });
    for (const e of hit) {
      w.dealDamage(s, e, K.power, "void", true);
      if (sig && !e.dead) w.applyRawDamage(e, Math.max(1, Math.round(sig.amount * K.sigShare)), "void", s.id, false);
    }
    mech(w, s, "mirror_echo", "end", { pos: to, radius: half });
  });
}

function mirrorSplit(w: World, s: Combatant): void {
  const K = SHADOW_KIT.mirror_knight.ult;
  const spots = [-1, 1].map((d) => ({ x: clamp(s.pos.x + 26, ARENA.minX, ARENA.maxX), y: clamp(s.pos.y + d * 40, ARENA.minY, ARENA.maxY) }));
  mech(w, s, "mirror_split", "warn", { radius: 40, duration: K.warn });
  announce(w, s, "Mirror Split");
  w.schedule(K.warn, () => {
    if (s.dead) return;
    const ids = spots.map((at, i) => raise(w, s, s.defId, at, K.life, K.share, i + 1).id);
    mech(w, s, "mirror_split", "strike", { radius: 40, duration: K.life, targets: ids });
    w.schedule(K.life, () => mech(w, s, "mirror_split", "end", { radius: 40 }));
  });
}

/** A body a Sovereign shadow raises: a temporary summon at `share` of its strength. */
function raise(w: World, s: Combatant, defId: string, at: Vec2, life: number, share: number, index: number): Combatant {
  const stats = { ...s.stats, maxHp: Math.round(s.stats.maxHp * share), attack: Math.round(s.stats.attack * share * 10) / 10 };
  const ent = createSummon(w.allocId(), { instanceId: `sov_${s.id}_${w.time.toFixed(3)}_${index}`, defId, level: s.level, stats }, at, w.loadout.command);
  ent.summon!.temporary = true;
  ent.summon!.expiresAt = w.time + life;
  ent.summon!.sovOwnerId = s.id;
  ent.state = "emerge";
  ent.stateDuration = 0.35;
  w.entities.set(ent.id, ent);
  w.events.push({ type: "summon_deployed", id: ent.id, defId, pos: { ...at } });
  return ent;
}

// ---------------------------------------------------------------------------------------------
// The Storm Titan
// ---------------------------------------------------------------------------------------------

function stormRods(w: World, s: Combatant, list: Combatant[]): void {
  const K = SHADOW_KIT.storm_titan.rods;
  const spots: Vec2[] = [];
  const pool = [...list];
  for (let i = 0; i < K.n && pool.length > 0; i++) {
    const g = densest(w, K.radius, pool);
    if (!g) break;
    spots.push(g.center);
    for (const m of g.members) pool.splice(pool.indexOf(m), 1);
  }
  // Fewer knots than rods: the rest go beside the lead's target.
  while (spots.length < K.n && spots[0]) spots.push({ x: clamp(spots[0].x + (spots.length % 2 ? 60 : -60), ARENA.minX, ARENA.maxX), y: spots[0].y });
  announce(w, s, "Storm Rods", spots[0]);
  w.setState(s, "cast", 0.5);
  spots.forEach((at, i) => {
    w.allyRods.push({ pos: { ...at }, radius: K.radius, until: w.time + K.charge });
    w.addTelegraph(at, K.radius, K.charge, "circle", 1, 0, 0x6fa8ff, false);
    mech(w, s, "storm_rods", "warn", { index: i + 1, pos: at, radius: K.radius, duration: K.charge });
    w.schedule(K.charge, () => {
      if (s.dead) return;
      const hit = factionWithin(at, "enemy", w.entities.values(), K.radius);
      mech(w, s, "storm_rods", "strike", { index: i + 1, pos: at, to: { x: at.x, y: ARENA.minY - 120 }, radius: K.radius, targets: hit.map((e) => e.id) });
      for (const e of hit) w.dealDamage(s, e, K.power, "lightning", true);
      mech(w, s, "storm_rods", "end", { index: i + 1, pos: at, radius: K.radius });
    });
  });
}

/** Foes beside a planted Storm Titan rod count as marked for the signature skills' choices. */
export function nearAllyRod(w: World, e: Combatant): boolean {
  for (const r of w.allyRods) if (w.time < r.until && dist(r.pos, e.pos) <= r.radius) return true;
  return false;
}

function stormChain(w: World, s: Combatant, target: Combatant, list: Combatant[]): void {
  const K = SHADOW_KIT.storm_titan.chain;
  const path: Combatant[] = [target];
  for (let k = 0; k < K.leaps; k++) {
    const at = path[path.length - 1]!;
    let next: Combatant | null = null;
    for (const e of list) if (!path.includes(e) && dist(e.pos, at.pos) < K.range && (!next || dist(e.pos, at.pos) < dist(next.pos, at.pos))) next = e;
    if (!next) break;
    path.push(next);
  }
  mech(w, s, "storm_chain", "warn", { pos: s.pos, to: target.pos, radius: K.range, duration: K.warn, targets: path.map((e) => e.id) });
  announce(w, s, "Chain Storm", target.pos);
  w.setState(s, "cast", K.warn + 0.1);
  w.schedule(K.warn, () => {
    if (s.dead) return;
    const live = path.filter((e) => !e.dead);
    mech(w, s, "storm_chain", "strike", { pos: s.pos, to: target.pos, radius: K.range, targets: live.map((e) => e.id) });
    path.forEach((e, k) => {
      if (!e.dead) w.dealDamage(s, e, K.power * Math.pow(K.falloff, k), "lightning", k === 0);
    });
    mech(w, s, "storm_chain", "end", { pos: target.pos, radius: K.range });
  });
}

/** Thunderous: the Titan's blow crashes on the foes around its target too. */
export function titanBlow(w: World, s: Combatant, target: Combatant): void {
  const K = SHADOW_KIT.storm_titan.passive;
  for (const o of factionWithin(target.pos, "enemy", w.entities.values(), K.radius)) if (o.id !== target.id) w.dealDamage(s, o, K.share, "lightning", false);
}

function stormTide(w: World, s: Combatant): void {
  const K = SHADOW_KIT.storm_titan.ult;
  const list = foes(w);
  if (list.length === 0) return;
  // The most crowded lane (bosses count three).
  let y = list[0]!.pos.y;
  let best = -1;
  for (const a of list) {
    const n = list.filter((b) => Math.abs(b.pos.y - a.pos.y) < K.half).reduce((m, b) => m + (b.kind === "boss" ? 3 : 1), 0);
    if (n > best) {
      best = n;
      y = a.pos.y;
    }
  }
  const dir: 1 | -1 = s.pos.x <= (ARENA.minX + ARENA.maxX) / 2 ? 1 : -1;
  const from = { x: dir === 1 ? ARENA.minX : ARENA.maxX, y };
  const to = { x: dir === 1 ? ARENA.maxX : ARENA.minX, y };
  w.addTelegraph(from, K.half, K.warn, "line", dir, ARENA.maxX - ARENA.minX, 0x6fa8ff, false);
  mech(w, s, "storm_tide", "warn", { pos: from, to, radius: K.half, duration: K.warn });
  announce(w, s, "Storm Tide");
  w.schedule(K.warn, () => {
    if (s.dead) return;
    const hit = foes(w).filter((e) => Math.abs(e.pos.y - y) < K.half + e.radius * 0.5);
    mech(w, s, "storm_tide", "strike", { pos: from, to, radius: K.half, duration: 0.6, targets: hit.map((e) => e.id) });
    // It throws the foes it strikes, but never a boss: the warrior's blade must not chase it.
    for (const e of hit) if (w.dealDamage(s, e, K.power, "void", true) && e.kind !== "boss") w.applyKnockback(e, { x: e.pos.x - dir * 40, y: e.pos.y }, 300);
    mech(w, s, "storm_tide", "end", { pos: to, radius: K.half });
  });
}

// ---------------------------------------------------------------------------------------------
// The Void Queen
// ---------------------------------------------------------------------------------------------

function voidWell(w: World, s: Combatant, list: Combatant[]): void {
  const K = SHADOW_KIT.void_queen.well;
  const g = densest(w, K.reach * 0.6, list);
  if (!g) return;
  const at = g.center;
  w.addTelegraph(at, K.core, K.warn + K.time, "circle", 1, 0, 0x9a6fe0, false);
  mech(w, s, "void_well", "warn", { pos: at, to: at, radius: K.core, duration: K.warn });
  announce(w, s, "Void Well", at);
  w.setState(s, "cast", 0.5);
  w.schedule(K.warn, () => {
    if (s.dead) return;
    // A singularity for the signature skills' Gravity Feast.
    if (w.sig) w.sig.singularity = { pos: { ...at }, at: w.time, radius: K.reach, queen: true };
    mech(w, s, "void_well", "strike", { pos: at, to: at, radius: K.reach, duration: K.time, targets: factionWithin(at, "enemy", w.entities.values(), K.reach).map((e) => e.id) });
    w.allyWells.push({ pos: { ...at }, until: w.time + K.time, next: 0, ownerId: s.id });
  });
}

/** A Void Queen shadow's well, one tick: foes drawn in (never a boss or a fixed part), its core hurts. */
export function tickAllyWells(w: World, dt: number): void {
  const K = SHADOW_KIT.void_queen.well;
  for (let i = w.allyWells.length - 1; i >= 0; i--) {
    const well = w.allyWells[i]!;
    const owner = w.entities.get(well.ownerId);
    if (w.time >= well.until || !owner || owner.dead) {
      w.allyWells.splice(i, 1);
      if (owner) mech(w, owner, "void_well", "end", { pos: well.pos, radius: K.core });
      continue;
    }
    for (const e of factionWithin(well.pos, "enemy", w.entities.values(), K.reach)) {
      if (e.kind === "boss" || e.enemy?.sovPart?.fixture) continue;
      const dx = well.pos.x - e.pos.x;
      const dy = well.pos.y - e.pos.y;
      const len = Math.hypot(dx, dy);
      if (len < 4) continue;
      const step = Math.min(len, K.pull * dt);
      e.pos.x += (dx / len) * step;
      e.pos.y += (dy / len) * step;
    }
    well.next -= dt;
    if (well.next <= 0) {
      well.next = 0.5;
      for (const e of factionWithin(well.pos, "enemy", w.entities.values(), K.core)) w.dealDamage(owner, e, K.power, "void", false);
    }
  }
}

function voidCourt(w: World, s: Combatant): void {
  const K = SHADOW_KIT.void_queen.court;
  const spots = Array.from({ length: K.n }, (_, i) => ({ x: clamp(s.pos.x + 20, ARENA.minX, ARENA.maxX), y: clamp(s.pos.y + (i % 2 === 0 ? -34 : 34), ARENA.minY, ARENA.maxY) }));
  mech(w, s, "void_court", "warn", { radius: 50, duration: K.warn });
  announce(w, s, "Kneeling Court");
  w.setState(s, "cast", 0.4);
  w.schedule(K.warn, () => {
    if (s.dead) return;
    const ids = spots.map((at, i) => raise(w, s, COURTIER, at, K.life, K.share, i + 1).id);
    mech(w, s, "void_court", "strike", { radius: 50, duration: K.life, targets: ids });
    w.schedule(K.life, () => mech(w, s, "void_court", "end", { radius: 50 }));
  });
}

/** Dark Majesty: a blow from the army on a foe near a fielded Void Queen shadow lands harder. */
export function majesty(w: World, target: Combatant): number {
  const K = SHADOW_KIT.void_queen.passive;
  for (const s of w.summonEntities()) if (s.defId === "void_queen" && !s.summon?.temporary && dist(s.pos, target.pos) <= K.radius) return 1 + K.bonus;
  return 1;
}

function eclipse(w: World, s: Combatant): void {
  const K = SHADOW_KIT.void_queen.ult;
  mech(w, s, "void_eclipse", "warn", { pos: s.pos, radius: ARENA.maxX - ARENA.minX, duration: K.warn });
  announce(w, s, "Eclipse");
  w.schedule(K.warn, () => {
    if (s.dead) return;
    const hit = foes(w);
    mech(w, s, "void_eclipse", "strike", { pos: s.pos, radius: ARENA.maxX - ARENA.minX, targets: hit.map((e) => e.id) });
    for (const e of hit) w.dealDamage(s, e, K.power, "void", true);
    mech(w, s, "void_eclipse", "end", { pos: s.pos, radius: 0 });
  });
}
