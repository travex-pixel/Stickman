import { Rng } from "./rng";
import { EventQueue, type GameEvent } from "./events";
import { clamp, dist, type Vec2 } from "./math";
import type { Combatant, EssenceOrb, GroundHazard, Projectile, Telegraph, Faction, ActionState } from "../entities/types";
import { createPlayer, createEnemy, createSummon, makeElite } from "../entities/factory";
import { ELITES, ELITE_IDS, ELITE_REWARD_MULT, eliteChance } from "../data/elites";
import type { EliteAffix, EquipSlot } from "../data/ids";
import { RARITY_ORDER } from "../data/ids";
import { BOSS_ATTEMPTS } from "../summons/extraction";
import { MODES, VAULT_GOLD_MULT, cryptWaves, endlessStage, endlessWave, riftWaves, vaultWaves, type ModeDef, type ModeId } from "../data/modes";
import type { PlayerLoadout, DeployedSummonLoadout } from "../progression/loadout";
import type { AbilityId, SummonCommand, Element } from "../data/ids";
import { ABILITIES, ABILITY_SLOTS, ULTIMATE_ENERGY_COST, ULTIMATE_ID } from "../data/abilities";
import { enemyDef } from "../data/enemies";
import { bossForStage, bossScale, regionForStage, stageScale, type WaveDef } from "../data/regions";
import { computeDamage } from "../combat/damage";
import { addStatus, hasStatus, speedMultiplier, statusValue, tickStatuses } from "../combat/statuses";
import { nearestHostile, hostilesWithin, factionWithin } from "../combat/targeting";
import { updateEnemyAi } from "../enemies/ai";
import { updateBossAi } from "../bosses/hollowWarden";
import { rankCooldownMult, rankPowerMult } from "../progression/abilityRanks";
import { updateSummonAi } from "../summons/ai";
import { castPlayerAbility, resolvePlayerAbility, playerDodge } from "../abilities/execute";
import { STORMBLADE_CHAIN_CHANCE, INFERNAL_BURN_FRACTION, VOIDFANG_EXECUTE_THRESHOLD } from "../progression/weaponPaths";
import { generateItem, rollRarity } from "../economy/loot";
import type { EquipmentItem } from "../progression/profile";

export const ARENA = { minX: 44, maxX: 596, minY: 8, maxY: 142, width: 640, depth: 150, homeX: 190, homeY: 78 } as const;
export const FIXED_DT = 1 / 60;
export const CHAIN_WINDOW = 2.4;

export type RunPhase = "intro" | "wave" | "between" | "boss_intro" | "boss" | "victory" | "defeat";

export interface WorldSnapshot {
  mode: ModeId;
  /** Seconds left in timed modes, otherwise null. */
  timeLeft: number | null;
  phase: RunPhase;
  /** Campaign farming loop (as opposed to a boss challenge or another mode). */
  farming: boolean;
  /** Farming cycles completed in this world. */
  cycle: number;
  /** The tapped focus target (-1 when none). */
  focusId: number;
  stage: number;
  wave: number;
  wavesTotal: number;
  time: number;
  player: { hp: number; maxHp: number; energy: number; x: number; y: number; alive: boolean; level: number };
  cooldowns: Record<AbilityId, number>;
  cooldownMax: Record<AbilityId, number>;
  dodgeCooldown: number;
  dodgeCooldownMax: number;
  enemiesAlive: number;
  boss: { hp: number; maxHp: number; phase: number; name: string } | null;
  orbs: { id: number; summonId: string; x: number; y: number; remaining: number; total: number; isBoss: boolean; elite: boolean; attempts: number }[];
  summons: { id: number; instanceId: string; defId: string; hp: number; maxHp: number; alive: boolean; abilityCooldown: number }[];
  command: SummonCommand;
  autoCast: boolean;
  kills: number;
  entities: number;
  projectiles: number;
  ultimateActive: boolean;
  timeScale: number;
  chain: number;
}

export interface WorldOptions {
  stage: number;
  loadout: PlayerLoadout;
  seed?: number;
  mode?: ModeId;
  /** Relic Crypt: the slot every elite drop belongs to. */
  cryptSlot?: EquipSlot;
}

interface WaveRunner {
  def: WaveDef;
  spawnQueue: { enemyId: string; at: number; elite?: EliteAffix; attackMult?: number; keeper?: boolean }[];
  elapsed: number;
}

interface LootDrop {
  item: EquipmentItem;
}

export class World {
  readonly rng: Rng;
  readonly events = new EventQueue();
  readonly entities = new Map<number, Combatant>();
  readonly projectiles: Projectile[] = [];
  readonly orbs: EssenceOrb[] = [];
  readonly telegraphs: Telegraph[] = [];
  readonly hazards: GroundHazard[] = [];
  /** The stage being fought. Campaign farming can move it in place (see queueStage). */
  stage: number;
  loadout: PlayerLoadout;
  /** Completed farming cycles (all ordinary encounters of a stage cleared) in this world. */
  cycles = 0;
  /** Set by the controller during a cycle break: the stage the next cycle farms. */
  private nextStage: number | null = null;
  time = 0;
  /** Set while a card covers the field: essence orbs wait instead of fading. */
  holdOrbs = false;
  /** The enemy the player tapped: the warrior and the army prefer it while it lives. */
  focusId = -1;
  /** Blood Pact: basic hits heal until this world time. */
  pactUntil = -1;
  timeScale = 1;
  phase: RunPhase = "intro";
  phaseTimer = 0.9;
  wave = 0;
  kills = 0;
  player: Combatant;
  energy = 0;
  cooldowns: Record<AbilityId, number>;
  dodgeCooldown = 0;
  ultimate: { active: boolean; timer: number; strikes: number; nextStrike: number } = { active: false, timer: 0, strikes: 0, nextStrike: 0 };
  pendingLoot: LootDrop[] = [];
  /** Game-mode reward multiplier on enemy gold (the Gold Vault sets this). */
  modeGoldMult = 1;
  private nextId = 1;
  private waveRunner: WaveRunner | null = null;
  private bossId = -1;
  private regionWaves: WaveDef[];
  private autoCastTimer = 0;
  private autoDodgeRolled = new Set<number>();
  private nextOrbExpiryWarned = new Set<number>();
  playerMoveLockTimer = 0;
  /** Set by the tutorial director while it teaches dodging. */
  tutorialSlow = false;
  private basicHits = 0;
  /** Kill chain: kills landed within CHAIN_WINDOW of each other. Feeds the HUD and energy. */
  chain = 0;
  private chainTimer = 0;
  private guaranteedEssenceGiven = false;

  readonly mode: ModeId;
  readonly modeDef: ModeDef;
  readonly cryptSlot: EquipSlot;
  /** Seconds spent fighting in this run (drives the Gold Vault timer). */
  modeTime = 0;

  constructor(opts: WorldOptions) {
    this.stage = Math.max(1, opts.stage);
    this.loadout = opts.loadout;
    this.mode = opts.mode ?? "campaign";
    this.modeDef = MODES[this.mode];
    this.rng = new Rng(opts.seed ?? (this.stage * 7919 + 17));
    this.cryptSlot = opts.cryptSlot ?? "weapon";
    this.regionWaves =
      this.mode === "vault" ? vaultWaves() : this.mode === "rift" ? riftWaves(this.stage) : this.mode === "crypt" ? cryptWaves(this.stage) : this.mode === "trial" ? regionForStage(this.stage).waves(this.stage).slice(0, 1) : regionForStage(this.stage).waves(this.stage);
    if (this.mode === "vault") this.modeGoldMult = VAULT_GOLD_MULT;
    this.cooldowns = { arc_slash: 0, thunder_strike: 0, shadow_dash: 0, soul_burst: 0, void_nova: 0, ascendant_fury: 0, blade_tempest: 0, chain_hook: 0, blood_pact: 0 };
    this.player = createPlayer(this.allocId(), opts.loadout, { x: ARENA.homeX, y: ARENA.homeY });
    this.entities.set(this.player.id, this.player);
    this.events.push({ type: "spawn", id: this.player.id, kind: "player", defId: "ascendant", pos: { ...this.player.pos } });
    for (const s of opts.loadout.summons) this.deploySummon(s, true);
  }

  allocId(): number {
    return this.nextId++;
  }

  dispose(): void {
    this.timers.length = 0;
    this.entities.clear();
    this.projectiles.length = 0;
    this.orbs.length = 0;
    this.hazards.length = 0;
    this.telegraphs.length = 0;
  }

  // ---------------------------------------------------------------------
  // Public controls
  // ---------------------------------------------------------------------

  setLoadout(loadout: PlayerLoadout): void {
    // Keep the warrior's health fraction so mid-run upgrades feel rewarding without a free heal.
    const frac = this.player.hp / this.player.stats.maxHp;
    // Swapping a slot's form mid-fight carries the slot's cooldown over: no free casts.
    for (const base of ABILITY_SLOTS) {
      const before = this.slot(base);
      const after = loadout.slots?.[base] ?? base;
      if (before !== after) this.cooldowns[after] = Math.max(this.cooldowns[after], this.cooldowns[before]);
    }
    this.loadout = loadout;
    this.player.stats = { ...loadout.stats };
    this.player.hp = Math.min(this.player.stats.maxHp, Math.max(1, Math.round(this.player.stats.maxHp * frac)));
    this.player.level = loadout.level;
    for (const s of loadout.summons) {
      const ent = this.summonEntity(s.instanceId);
      if (ent) {
        const f = ent.hp / ent.stats.maxHp;
        ent.stats = { ...s.stats };
        ent.hp = Math.round(ent.stats.maxHp * f);
        ent.level = s.level;
        if (ent.defId !== s.defId) {
          // Evolution mid-run: swap identity in place.
          ent.defId = s.defId;
          ent.name = s.defId;
          ent.hp = ent.stats.maxHp;
          this.events.push({ type: "summon_deployed", id: ent.id, defId: s.defId, pos: { ...ent.pos } });
        }
      } else {
        this.deploySummon(s, false);
      }
    }
    for (const ent of this.summonEntities()) {
      if (ent.summon?.temporary) continue;
      if (!loadout.summons.some((s) => s.instanceId === ent.summon?.instanceId)) this.recallSummon(ent.summon!.instanceId);
    }
    this.setCommand(loadout.command);
  }

  setCommand(cmd: SummonCommand): void {
    const changed = this.loadout.command !== cmd || this.summonEntities().some((s) => s.summon?.command !== cmd);
    this.loadout = { ...this.loadout, command: cmd };
    for (const s of this.summonEntities()) if (s.summon) s.summon.command = cmd;
    if (changed) this.events.push({ type: "command", command: cmd });
  }

  setAutoCast(on: boolean): void {
    this.loadout = { ...this.loadout, autoCast: on };
  }

  deploySummon(s: DeployedSummonLoadout, silent: boolean): Combatant | null {
    if (this.summonEntity(s.instanceId)) return null;
    const offset = this.summonEntities().length;
    const pos = { x: this.player.pos.x - 60 - offset * 30, y: clamp(this.player.pos.y + (offset % 2 === 0 ? 28 : -28), ARENA.minY, ARENA.maxY) };
    const ent = createSummon(this.allocId(), s, pos, this.loadout.command);
    ent.state = "emerge";
    ent.stateTime = 0;
    ent.stateDuration = silent ? 0.4 : 0.9;
    this.entities.set(ent.id, ent);
    this.events.push({ type: "summon_deployed", id: ent.id, defId: s.defId, pos: { ...pos } });
    return ent;
  }

  recallSummon(instanceId: string): void {
    const ent = this.summonEntity(instanceId);
    if (!ent) return;
    this.entities.delete(ent.id);
    this.events.push({ type: "summon_recalled", instanceId });
  }

  castAbility(id: AbilityId): boolean {
    if (this.phase === "victory" || this.phase === "defeat" || this.player.dead) return false;
    const def = ABILITIES[id];
    if (def.ultimate) {
      if (!this.loadout.ultimateUnlocked || this.energy < ULTIMATE_ENERGY_COST || this.ultimate.active) return false;
    } else {
      if (!this.loadout.abilities.includes(id)) return false;
      if (this.cooldowns[id] > 0) return false;
    }
    if (this.player.state === "cast" || this.player.state === "dodge" || this.player.state === "hit") return false;
    if (id === "shadow_dash") return this.dodge();
    const ok = castPlayerAbility(this, id);
    if (ok) {
      if (def.ultimate) this.energy = 0;
      else this.cooldowns[id] = this.abilityCooldown(id);
    }
    return ok;
  }

  /** Deferred simulation-time callbacks (e.g. an ember landing). Cleared with the World. */
  private timers: { at: number; fn: () => void }[] = [];

  schedule(delay: number, fn: () => void): void {
    this.timers.push({ at: this.time + delay, fn });
  }

  get pendingTimers(): number {
    return this.timers.length;
  }

  private runTimers(): void {
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i]!;
      if (this.time >= t.at) {
        this.timers.splice(i, 1);
        t.fn();
      }
    }
  }

  /** Window before a telegraphed hit lands in which a manual dodge counts as perfect. */
  static readonly PERFECT_WINDOW = 0.35;
  /** Set by a perfect dodge: the warrior's next basic hit is a guaranteed critical. */
  private perfectCrit = false;

  dodge(manual = true): boolean {
    if (this.phase === "victory" || this.phase === "defeat" || this.player.dead) return false;
    if (this.dodgeCooldown > 0) return false;
    if (this.player.state === "dodge") return false;
    const p = this.player;
    const perfect = manual && this.impendingThreat(World.PERFECT_WINDOW) !== null;
    playerDodge(this);
    if (perfect) {
      this.perfectCrit = true;
      this.gainEnergy(15);
      this.timeScale = 0.3;
      this.finisher = { timer: 0.35 };
      this.events.push({ type: "perfect_dodge", pos: { ...p.pos } });
    }
    this.dodgeCooldown = this.abilityCooldown("shadow_dash");
    this.cooldowns.shadow_dash = this.dodgeCooldown;
    return true;
  }

  /** Whether `pos` is inside a telegraphed (not yet landed) enemy attack. */
  static insideTelegraph(t: Telegraph, pos: Vec2): boolean {
    const dx = pos.x - t.pos.x;
    const dy = pos.y - t.pos.y;
    if (t.shape === "circle") return dx * dx + dy * dy < t.radius * t.radius;
    if (t.shape === "line") return dx * t.dir >= 0 && dx * t.dir <= t.length && Math.abs(dy) < t.radius;
    return dx * t.dir >= 0 && dx * dx + dy * dy < t.length * t.length;
  }

  /**
   * A blow about to land on the warrior within `window` seconds: a melee wind-up aimed at them,
   * a boss charge bearing down, or a telegraphed zone they stand in.
   */
  impendingThreat(window: number): { id: number } | null {
    const p = this.player;
    for (const e of this.entities.values()) {
      if (e.dead || e.faction !== "enemy") continue;
      const left = e.stateDuration - e.stateTime;
      if (e.state === "windup" && left <= window && (e.pendingTargetId === p.id || e.kind === "boss") && dist(e.pos, p.pos) < e.stats.range + 120) return { id: e.id };
      if (e.kind === "boss" && e.state === "attack" && e.boss?.pattern === "charge") {
        const ahead = (p.pos.x - e.pos.x) * e.facing;
        if (ahead > 0 && ahead < 620 * window + e.radius + p.radius && Math.abs(p.pos.y - e.pos.y) < 46) return { id: e.id };
      }
    }
    for (const t of this.telegraphs) if (t.hostile && t.remaining <= window && World.insideTelegraph(t, p.pos)) return { id: t.id };
    // A bolt that will reach the warrior within the window.
    for (const pr of this.projectiles) {
      if (pr.faction !== "enemy" || pr.vel.x === 0) continue;
      const tx = (p.pos.x - pr.pos.x) / pr.vel.x;
      if (tx < 0 || tx > window) continue;
      if (Math.abs(pr.pos.y + pr.vel.y * tx - p.pos.y) < pr.radius + p.radius + 6) return { id: pr.id };
    }
    return null;
  }

  /** Where a dash should go to leave the danger the warrior is standing in, if any. */
  escapeFrom(pos: Vec2): Vec2 | null {
    let best: { t: number; to: Vec2 } | null = null;
    const consider = (urgency: number, to: Vec2) => {
      if (!best || urgency < best.t) best = { t: urgency, to };
    };
    for (const t of this.telegraphs) {
      if (!t.hostile || !World.insideTelegraph(t, pos)) continue;
      if (t.shape === "line") {
        const up = pos.y - t.pos.y;
        const side = up === 0 ? (pos.y > (ARENA.minY + ARENA.maxY) / 2 ? -1 : 1) : Math.sign(up);
        consider(t.remaining, { x: pos.x, y: t.pos.y + side * (t.radius + 22) });
      } else {
        const r = t.shape === "circle" ? t.radius : t.length;
        const dx = pos.x - t.pos.x;
        const dy = pos.y - t.pos.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = len < 1 ? 1 : dx / len;
        const uy = len < 1 ? 0 : dy / len;
        consider(t.remaining, { x: t.pos.x + ux * (r + 24), y: t.pos.y + uy * (r + 24) });
      }
    }
    for (const h of this.hazards) {
      if (h.faction !== "enemy" || dist(pos, h.pos) >= h.radius) continue;
      const dx = pos.x - h.pos.x;
      const dy = pos.y - h.pos.y;
      const len = Math.hypot(dx, dy) || 1;
      consider(99, { x: h.pos.x + (dx / len) * (h.radius + 20), y: h.pos.y + (dy / len) * (h.radius + 20) });
    }
    const out = best as { t: number; to: Vec2 } | null;
    if (!out) return null;
    return { x: clamp(out.to.x, ARENA.minX + 10, ARENA.maxX - 10), y: clamp(out.to.y, ARENA.minY, ARENA.maxY) };
  }

  claimEssence(orbId: number): EssenceOrb | null {
    const orb = this.orbs.find((o) => o.id === orbId && !o.claimed);
    if (!orb) return null;
    orb.claimed = true;
    return orb;
  }

  peekOrb(orbId: number): EssenceOrb | undefined {
    return this.orbs.find((o) => o.id === orbId && !o.claimed);
  }

  /** A failed BIND: the oath is refused. Bosses keep their remaining attempts. */
  failExtraction(orbId: number): number {
    const orb = this.peekOrb(orbId);
    if (!orb) return 0;
    orb.attempts -= 1;
    this.events.push({ type: "extract_fail", orbId, pos: { ...orb.pos }, attemptsLeft: Math.max(0, orb.attempts) });
    if (orb.attempts <= 0) orb.claimed = true;
    return Math.max(0, orb.attempts);
  }

  /** Temporary shades called by a Rift Caller: weaker copies that fight for a few seconds. */
  spawnShade(caller: Combatant, pos: Vec2, lifetime: number): Combatant {
    const level = caller.level;
    const stats = { ...caller.stats, maxHp: Math.round(caller.stats.maxHp * 0.55), attack: Math.round(caller.stats.attack * 0.6 * 10) / 10, attackSpeed: 1.2, range: 42, moveSpeed: 135, defense: 0 };
    const ent = createSummon(this.allocId(), { instanceId: `shade_${this.nextId}`, defId: "shade", level, stats }, pos, this.loadout.command);
    if (ent.summon) {
      ent.summon.temporary = true;
      ent.summon.expiresAt = this.time + lifetime;
    }
    ent.state = "emerge";
    ent.stateDuration = 0.4;
    this.entities.set(ent.id, ent);
    this.events.push({ type: "summon_deployed", id: ent.id, defId: "shade", pos: { ...pos } });
    return ent;
  }

  // ---------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------

  summonEntities(): Combatant[] {
    const out: Combatant[] = [];
    for (const e of this.entities.values()) if (e.kind === "summon" && !e.dead) out.push(e);
    return out;
  }

  summonEntity(instanceId: string): Combatant | undefined {
    for (const e of this.entities.values()) if (e.kind === "summon" && e.summon?.instanceId === instanceId) return e;
    return undefined;
  }

  enemies(): Combatant[] {
    const out: Combatant[] = [];
    for (const e of this.entities.values()) if (e.faction === "enemy" && !e.dead) out.push(e);
    return out;
  }

  /** Difficulty stage for spawns. Endless climbs as waves pass; everything else uses the run's stage. */
  get scaleStage(): number {
    return this.mode === "endless" ? endlessStage(this.stage, Math.max(1, this.wave)) : this.stage;
  }

  get wavesTotal(): number {
    return this.modeDef.waves;
  }

  /**
   * Whether this world fights a boss on its own. Campaign farming never does: bosses are only
   * fought in a "boss" world the player starts deliberately (or a Rank Trial).
   */
  get hasBoss(): boolean {
    return this.modeDef.boss;
  }

  /** True while this world is the endless campaign farming loop. */
  get farming(): boolean {
    return this.mode === "campaign";
  }

  /** Farming: the next cycle fights `stage` instead of repeating the current one. */
  queueStage(stage: number): void {
    if (!this.farming) return;
    this.nextStage = Math.max(1, Math.floor(stage));
  }

  /**
   * Farming: move to `stage` now. The current stage's remaining foes withdraw (no rewards),
   * and the new stage begins after a short beat. Used when the player pushes or retreats.
   */
  moveToStage(stage: number): void {
    if (!this.farming || this.player.dead) return;
    for (const e of this.enemies()) {
      e.dead = true;
      e.hp = 0;
      e.state = "dead";
      e.deathTime = 1;
    }
    if (this.waveRunner) this.waveRunner.spawnQueue.length = 0;
    this.nextStage = Math.max(1, Math.floor(stage));
    this.wave = this.wavesTotal;
    this.phase = "between";
    this.phaseTimer = 0.7;
  }

  private applyStage(stage: number): void {
    const from = this.stage;
    this.stage = stage;
    this.regionWaves = regionForStage(stage).waves(stage);
    this.events.push({ type: "stage_advanced", from, stage });
  }

  get boss(): Combatant | undefined {
    const b = this.entities.get(this.bossId);
    return b && !b.dead ? b : undefined;
  }

  /** The ability occupying a base slot in this run's loadout. */
  slot(base: AbilityId): AbilityId {
    return this.loadout.slots?.[base] ?? base;
  }

  /** Rank multiplier on an ability's damage. */
  abilityPower(id: AbilityId): number {
    return rankPowerMult(this.loadout.abilityRanks?.[id] ?? 0);
  }

  /** Full cooldown of an ability after gear, skills and rank. */
  abilityCooldown(id: AbilityId): number {
    const rank = rankCooldownMult(this.loadout.abilityRanks?.[id] ?? 0);
    if (id === "shadow_dash") return ABILITIES.shadow_dash.cooldown * this.loadout.mods.dodgeCooldownMult * rank;
    return ABILITIES[id].cooldown * this.loadout.mods.cooldownMult * rank;
  }

  snapshot(): WorldSnapshot {
    const boss = this.entities.get(this.bossId);
    const cdMax = {} as Record<AbilityId, number>;
    for (const id of Object.keys(ABILITIES) as AbilityId[]) {
      cdMax[id] = this.abilityCooldown(id);
    }
    return {
      mode: this.mode,
      timeLeft: this.modeDef.duration ? Math.max(0, this.modeDef.duration - this.modeTime) : null,
      phase: this.phase,
      farming: this.farming,
      cycle: this.cycles,
      focusId: this.focusId,
      stage: this.stage,
      wave: this.wave,
      wavesTotal: Number.isFinite(this.wavesTotal) ? this.wavesTotal : 0,
      time: this.time,
      player: { hp: this.player.hp, maxHp: this.player.stats.maxHp, energy: this.energy, x: this.player.pos.x, y: this.player.pos.y, alive: !this.player.dead, level: this.player.level },
      cooldowns: { ...this.cooldowns },
      cooldownMax: cdMax,
      dodgeCooldown: this.dodgeCooldown,
      dodgeCooldownMax: cdMax.shadow_dash,
      enemiesAlive: this.enemies().length,
      boss: boss && !boss.dead ? { hp: boss.hp, maxHp: boss.stats.maxHp, phase: boss.boss?.phase ?? 1, name: boss.name } : null,
      orbs: this.orbs.filter((o) => !o.claimed).map((o) => ({ id: o.id, summonId: o.summonId, x: o.pos.x, y: o.pos.y, remaining: o.remaining, total: o.total, isBoss: o.isBoss, elite: o.elite, attempts: o.attempts })),
      summons: Array.from(this.entities.values())
        .filter((e) => e.kind === "summon" && !e.summon?.temporary)
        .map((e) => ({ id: e.id, instanceId: e.summon?.instanceId ?? "", defId: e.defId, hp: e.hp, maxHp: e.stats.maxHp, alive: !e.dead, abilityCooldown: e.summon?.abilityCooldown ?? 0 })),
      command: this.loadout.command,
      autoCast: this.loadout.autoCast,
      kills: this.kills,
      entities: this.entities.size,
      projectiles: this.projectiles.length,
      ultimateActive: this.ultimate.active,
      chain: this.chain,
      timeScale: this.timeScale,
    };
  }

  drainEvents(): GameEvent[] {
    return this.events.drain();
  }

  takeLoot(): LootDrop[] {
    const out = this.pendingLoot;
    this.pendingLoot = [];
    return out;
  }

  // ---------------------------------------------------------------------
  // Simulation step
  // ---------------------------------------------------------------------

  update(rawDt: number): void {
    const dt = rawDt * (this.tutorialSlow ? Math.min(this.timeScale, 0.35) : this.timeScale);
    this.time += dt;
    this.updateRunState(rawDt);
    this.updateTimers(dt, rawDt);
    this.updateUltimate(rawDt);

    for (const e of this.entities.values()) {
      if (e.dead) continue;
      e.prevPos.x = e.pos.x;
      e.prevPos.y = e.pos.y;
      const burn = tickStatuses(e, dt);
      if (burn.burnDamage > 0) this.applyRawDamage(e, burn.burnDamage, "fire", -1, false);
      if (e.stats.hpRegen > 0 && e.hp < e.stats.maxHp && e.state !== "dead") e.hp = Math.min(e.stats.maxHp, e.hp + e.stats.hpRegen * dt);
      e.hitFlash = Math.max(0, e.hitFlash - dt);
      e.attackCooldown = Math.max(0, e.attackCooldown - dt * (1 + statusValue(e, "haste")));
      e.stateTime += dt;
    }

    for (const e of this.entities.values()) {
      if (e.dead) continue;
      if (e.state === "emerge") {
        if (e.stateTime >= e.stateDuration) this.setState(e, "idle");
        continue;
      }
      if (e.kind === "player") this.updatePlayer(dt);
      else if (e.kind === "summon") updateSummonAi(this, e, dt);
      else if (e.kind === "boss") updateBossAi(this, e, dt);
      else updateEnemyAi(this, e, dt);
    }

    this.runTimers();
    this.integrate(dt);
    this.updateProjectiles(dt);
    this.updateHazards(dt);
    this.updateOrbs(rawDt);
    this.updateTelegraphs(dt);
    this.cleanup(dt);
  }

  finisher: { timer: number } | null = null;

  private updateTimers(dt: number, rawDt: number): void {
    if (this.chainTimer > 0) {
      this.chainTimer -= dt;
      if (this.chainTimer <= 0) this.chain = 0;
    }
    if (this.finisher) {
      this.finisher.timer -= rawDt;
      if (this.finisher.timer <= 0) this.finisher = null;
    }
    for (const id of Object.keys(this.cooldowns) as AbilityId[]) this.cooldowns[id] = Math.max(0, this.cooldowns[id] - rawDt);
    this.dodgeCooldown = Math.max(0, this.dodgeCooldown - rawDt);
    this.cooldowns.shadow_dash = this.dodgeCooldown;
    this.playerMoveLockTimer = Math.max(0, this.playerMoveLockTimer - dt);
    if (this.timeScale < 1 && !this.ultimate.active && !this.finisher) this.timeScale = Math.min(1, this.timeScale + rawDt * 2.5);
  }

  private updateRunState(rawDt: number): void {
    switch (this.phase) {
      case "intro":
        this.phaseTimer -= rawDt;
        if (this.phaseTimer <= 0) {
          if (this.wavesTotal === 0 && this.hasBoss) this.startBossIntro();
          else this.startWave(1);
        }
        break;
      case "wave": {
        this.runWave(rawDt);
        this.modeTime += rawDt;
        if (this.mode === "vault" && this.modeTime >= (this.modeDef.duration ?? 45)) {
          this.endRun();
          break;
        }
        const done = this.waveRunner !== null && this.waveRunner.spawnQueue.length === 0 && this.enemies().length === 0;
        if (done) {
          this.events.push({ type: "wave_cleared", wave: this.wave });
          if (this.mode === "vault") {
            this.endRun();
            break;
          }
          this.phase = "between";
          this.phaseTimer = this.wave >= this.wavesTotal ? 1.6 : this.mode === "endless" ? 1.1 : 1.4;
          if (this.farming && this.wave >= this.wavesTotal) {
            // A cycle is complete: catch a breath, and let the controller decide where the next one is fought.
            this.cycles += 1;
            this.restoreAfterCycle();
            this.events.push({ type: "encounters_cleared", stage: this.stage, cycle: this.cycles });
          }
        }
        break;
      }
      case "between":
        this.phaseTimer -= rawDt;
        if (this.phaseTimer <= 0) {
          if (this.wave >= this.wavesTotal) {
            if (this.farming) {
              if (this.nextStage !== null && this.nextStage !== this.stage) this.applyStage(this.nextStage);
              this.nextStage = null;
              this.startWave(1);
            } else if (this.hasBoss) this.startBossIntro();
            else this.endRun();
          } else this.startWave(this.wave + 1);
        }
        break;
      case "boss_intro":
        this.phaseTimer -= rawDt;
        if (this.phaseTimer <= 0) {
          this.phase = "boss";
          const b = this.entities.get(this.bossId);
          if (b) this.setState(b, "idle");
        }
        break;
      case "boss": {
        const b = this.entities.get(this.bossId);
        if (b && b.dead && this.enemies().length === 0) this.endRun();
        break;
      }
      default:
        break;
    }
    if (this.player.dead && this.phase !== "defeat" && this.phase !== "victory") {
      this.phase = "defeat";
      this.events.push({ type: "player_defeated", stage: this.stage, wave: this.wave, mode: this.mode });
    }
  }

  /** The warrior (and army) raise their weapons: a cycle cleared, or a boss down. */
  private celebrate(duration: number): void {
    for (const e of this.entities.values()) {
      if (e.dead || (e.kind !== "player" && e.kind !== "summon") || e.summon?.temporary) continue;
      if (e.state !== "idle" && e.state !== "move" && e.state !== "recover" && duration < 10) continue;
      this.stop(e);
      this.setState(e, "victory", duration);
    }
  }

  /** Between farming cycles the warrior and army recover a quarter of what they lost. */
  private restoreAfterCycle(): void {
    this.celebrate(1.1);
    for (const e of this.entities.values()) {
      if (e.dead || (e.kind !== "player" && e.kind !== "summon")) continue;
      const heal = Math.round((e.stats.maxHp - e.hp) * 0.25);
      if (heal <= 0) continue;
      e.hp += heal;
      this.events.push({ type: "heal", targetId: e.id, amount: heal, pos: { ...e.pos } });
    }
  }

  /** Resolves the run as a success. Timed modes dismiss whatever is still on the field. */
  private endRun(): void {
    for (const e of this.enemies()) {
      e.dead = true;
      e.hp = 0;
      e.state = "dead";
      e.deathTime = 0;
    }
    this.phase = "victory";
    this.phaseTimer = 1.2;
    if (this.mode === "boss" || this.mode === "trial") this.celebrate(99);
    this.events.push({ type: "stage_cleared", stage: this.stage, mode: this.mode, wave: this.wave, time: this.modeTime });
  }

  private startWave(n: number): void {
    this.wave = n;
    const def = this.mode === "endless" ? endlessWave(n) : (this.regionWaves[n - 1] ?? this.regionWaves[this.regionWaves.length - 1]);
    if (!def) return;
    const queue: { enemyId: string; at: number; elite?: EliteAffix; attackMult?: number; keeper?: boolean }[] = [];
    for (const group of def.spawns) {
      for (let i = 0; i < group.count; i++) queue.push({ enemyId: group.enemyId, at: group.delay + i * group.interval, elite: i === 0 ? group.elite : undefined, attackMult: group.attackMult, keeper: i === 0 && group.keeper });
    }
    queue.sort((a, b) => a.at - b.at);
    this.waveRunner = { def, spawnQueue: queue, elapsed: 0 };
    this.phase = "wave";
    this.events.push({ type: "wave_start", wave: n, total: Number.isFinite(this.wavesTotal) ? this.wavesTotal : 0, stage: this.stage });
  }

  private runWave(rawDt: number): void {
    const r = this.waveRunner;
    if (!r) return;
    r.elapsed += rawDt;
    while (r.spawnQueue.length > 0 && (r.spawnQueue[0] as { at: number }).at <= r.elapsed) {
      const next = r.spawnQueue.shift() as { enemyId: string; at: number; elite?: EliteAffix; attackMult?: number; keeper?: boolean };
      const e = this.spawnEnemy(next.enemyId, { elite: next.elite });
      if (next.attackMult) e.stats.attack = Math.round(e.stats.attack * next.attackMult * 10) / 10;
      if (next.keeper && e.enemy) {
        e.enemy.keeper = true;
        e.name = "Crypt Keeper";
        e.stats.maxHp = Math.round(e.stats.maxHp * 2.2);
        e.hp = e.stats.maxHp;
        e.scale *= 1.15;
      }
    }
  }

  private startBossIntro(): void {
    const def = enemyDef(bossForStage(this.stage, this.mode));
    const base = stageScale(this.stage);
    const gate = bossScale(this.stage);
    const scale = { ...base, hp: base.hp * gate.hp, attack: base.attack * gate.attack };
    const boss = createEnemy(this.allocId(), def, { x: ARENA.maxX - 70, y: ARENA.homeY }, scale, this.stage, this.mode !== "trial");
    boss.kind = "boss";
    if (this.stage === 1 && this.mode !== "trial") {
      // The first Warden is a lesson, not a wall: always the same, shown honestly in its forecast.
      boss.stats.maxHp = Math.round(boss.stats.maxHp * 0.7);
      boss.hp = boss.stats.maxHp;
      boss.stats.attack = Math.round(boss.stats.attack * 0.8 * 10) / 10;
    }
    if (this.mode === "trial") {
      // The trial Warden is empowered: brutal, and it remembers its second phase sooner.
      makeElite(boss, "brutal");
      boss.stats.maxHp = Math.round(boss.stats.maxHp * 1.15);
      boss.hp = boss.stats.maxHp;
    }
    boss.boss = { phase: 1, patternTimer: 1.2, pattern: "idle", patternStep: 0, introTimer: 2.4, enraged: false };
    boss.state = "emerge";
    boss.stateDuration = 2.4;
    this.bossId = boss.id;
    this.entities.set(boss.id, boss);
    this.phase = "boss_intro";
    this.phaseTimer = 2.4;
    this.events.push({ type: "boss_intro", id: boss.id, defId: def.id });
    this.events.push({ type: "spawn", id: boss.id, kind: "boss", defId: def.id, pos: { ...boss.pos } });
  }

  spawnEnemy(enemyId: string, opts: { pos?: Vec2; elite?: EliteAffix | null; minion?: boolean; ownerId?: number } = {}): Combatant {
    const def = enemyDef(enemyId);
    const scale = stageScale(this.scaleStage);
    const fromLeft = this.stage >= 2 && this.rng.chance(0.25);
    const x = opts.pos?.x ?? (fromLeft ? ARENA.minX - 30 : ARENA.maxX + 30);
    const y = opts.pos?.y ?? this.rng.range(ARENA.minY + 10, ARENA.maxY - 10);
    const firstEver = def.essenceSummonId !== undefined && this.stage === 1 && this.wave === 1 && enemyId === "husk" && !this.guaranteedEssenceGiven && this.loadout.summons.length === 0 && !this.loadout.hasSummons;
    if (firstEver) this.guaranteedEssenceGiven = true;
    const elite = opts.minion ? null : (opts.elite ?? (this.rng.chance(eliteChance(this.stage, this.wave)) ? this.rng.pick(ELITE_IDS) : null));
    const ownedAlready = def.essenceSummonId !== undefined && this.loadout.owned.includes(def.essenceSummonId);
    const eligibleChance = def.essenceChance * this.loadout.mods.essenceChanceMult * (ownedAlready ? 0.5 : 1);
    // Elites always leave a shadow behind: they are the encounters worth hoping for.
    // The Gold Vault is about gold; shadows belong to the campaign and the Essence Rift.
    const eligible = this.mode !== "vault" && !opts.minion && def.essenceSummonId !== undefined && (firstEver || elite !== null || this.mode === "rift" || this.rng.chance(eligibleChance));
    const e = createEnemy(this.allocId(), def, { x, y }, scale, this.scaleStage, eligible);
    if (opts.minion && e.enemy) {
      e.enemy.minion = true;
      e.enemy.ownerId = opts.ownerId ?? -1;
      e.stats.maxHp = Math.round(e.stats.maxHp * 0.6);
      e.hp = e.stats.maxHp;
    }
    if (elite) makeElite(e, elite);
    e.facing = opts.pos ? (this.player.pos.x >= x ? 1 : -1) : fromLeft ? 1 : -1;
    this.entities.set(e.id, e);
    this.events.push({ type: "spawn", id: e.id, kind: "enemy", defId: def.id, pos: { ...e.pos } });
    if (elite) this.events.push({ type: "elite_spawn", id: e.id, affix: elite, defId: def.id, pos: { ...e.pos } });
    return e;
  }

  // ---------------------------------------------------------------------
  // Player
  // ---------------------------------------------------------------------

  private updatePlayer(dt: number): void {
    const p = this.player;
    if (p.state === "victory") {
      // A short flourish after a cleared cycle; held for good after a won boss fight.
      this.stop(p);
      if (p.stateTime >= p.stateDuration && this.phase !== "victory") this.setState(p, "idle");
      return;
    }
    if (p.state === "cast") {
      resolvePlayerAbility(this);
      if (p.stateTime >= p.stateDuration) this.setState(p, "idle");
      return;
    }
    if (p.state === "dodge") {
      if (p.stateTime >= p.stateDuration) this.setState(p, "idle");
      return;
    }
    if (p.state === "hit" || p.state === "stagger") {
      if (p.stateTime >= p.stateDuration) this.setState(p, "idle");
      return;
    }
    if (this.loadout.autoCast) this.autoCast(dt);

    const target = this.acquireTarget(p);
    p.targetId = target ? target.id : -1;
    if (!target) {
      // Drift back toward the home position when nothing threatens.
      const home = { x: ARENA.homeX, y: ARENA.homeY };
      if (dist(p.pos, home) > 12) this.moveToward(p, home, dt, 0.6);
      else this.setState(p, "idle");
      return;
    }
    const d = dist(p.pos, target.pos);
    p.facing = target.pos.x >= p.pos.x ? 1 : -1;
    if (p.state === "windup" || p.state === "attack" || p.state === "recover") {
      this.progressAttack(p);
      return;
    }
    if (d > p.stats.range + target.radius * 0.5) {
      if (this.playerMoveLockTimer <= 0) this.moveToward(p, target.pos, dt, 1);
      return;
    }
    p.vel.x = 0;
    p.vel.y = 0;
    if (p.attackCooldown <= 0) this.beginAttack(p, target, 0.13, 0.12, 0.12);
    else if (p.state !== "idle") this.setState(p, "idle");
  }

  private autoCast(dt: number): void {
    this.autoCastTimer -= dt;
    if (this.autoCastTimer > 0) return;
    this.autoCastTimer = 0.25;
    const enemies = this.enemies();
    if (enemies.length === 0) return;
    const near = hostilesWithin(this.player, enemies, 170).length;
    const p = this.player;
    // AUTO dodges at the last moment, and only about half the time: reading the fight is the player's edge.
    const threat = this.dodgeCooldown <= 0 ? this.impendingThreat(0.3) : null;
    if (threat && !this.autoDodgeRolled.has(threat.id)) {
      this.autoDodgeRolled.add(threat.id);
      if (this.autoDodgeRolled.size > 64) this.autoDodgeRolled.clear();
      if (p.hp / p.stats.maxHp < 0.95 && this.rng.chance(0.5)) {
        this.dodge(false);
        return;
      }
    }
    if (this.loadout.ultimateUnlocked && this.energy >= ULTIMATE_ENERGY_COST && (enemies.length >= 3 || this.boss)) {
      if (this.castAbility(ULTIMATE_ID)) return;
    }
    const soul = this.slot("soul_burst");
    const arc = this.slot("arc_slash");
    const bolt = this.slot("thunder_strike");
    const ready = (id: AbilityId) => this.cooldowns[id] <= 0;
    if (soul === "soul_burst" && p.hp / p.stats.maxHp < 0.55 && ready(soul) && near > 0 && this.castAbility(soul)) return;
    if (soul === "blood_pact" && near >= 1 && ready(soul) && (p.hp / p.stats.maxHp < 0.7 || near >= 3) && this.castAbility(soul)) return;
    if (near >= 3 && ready("void_nova") && this.castAbility("void_nova")) return;
    if (near >= 2 && ready(arc) && this.castAbility(arc)) return;
    if (bolt === "chain_hook" && ready(bolt) && enemies.some((e) => e.enemy && (e.enemy.archetype === "ranger" || e.enemy.archetype === "arcanist" || e.enemy.archetype === "summoner")) && this.castAbility(bolt)) return;
    if (near >= 1 && ready(bolt) && this.castAbility(bolt)) return;
    if (near >= 1 && ready(arc) && enemies.length >= 1 && this.castAbility(arc)) return;
  }

  // ---------------------------------------------------------------------
  // Shared combat helpers (used by AI modules)
  // ---------------------------------------------------------------------

  /** Marks an enemy as the focus target (or clears focus with -1). Returns whether it took. */
  setFocus(id: number): boolean {
    if (id < 0) {
      this.focusId = -1;
      return true;
    }
    const e = this.entities.get(id);
    if (!e || e.dead || e.faction !== "enemy") return false;
    this.focusId = id;
    return true;
  }

  /** The living, reachable focus target, if any. */
  focusTarget(): Combatant | null {
    if (this.focusId < 0) return null;
    const e = this.entities.get(this.focusId);
    if (!e || e.dead) {
      this.focusId = -1;
      return null;
    }
    return hasStatus(e, "submerged") ? null : e;
  }

  acquireTarget(self: Combatant): Combatant | null {
    if (self.faction === "ally") {
      const f = this.focusTarget();
      if (f) return f;
    }
    const current = self.targetId >= 0 ? this.entities.get(self.targetId) : undefined;
    if (current && !current.dead && current.faction !== self.faction && !hasStatus(current, "submerged")) {
      const n = nearestHostile(self, this.entities.values());
      if (n && n.id !== current.id && dist(self.pos, n.pos) < dist(self.pos, current.pos) * 0.6) return n;
      return current;
    }
    return nearestHostile(self, this.entities.values());
  }

  setState(e: Combatant, state: ActionState, duration = 0): void {
    e.state = state;
    e.stateTime = 0;
    e.stateDuration = duration;
  }

  moveToward(e: Combatant, target: Vec2, dt: number, speedMult = 1): void {
    const dx = target.x - e.pos.x;
    const dy = target.y - e.pos.y;
    const len = Math.hypot(dx, dy) || 1;
    const sp = e.stats.moveSpeed * speedMult * speedMultiplier(e);
    e.vel.x = (dx / len) * sp;
    e.vel.y = (dy / len) * sp;
    if (Math.abs(dx) > 2) e.facing = dx > 0 ? 1 : -1;
    if (e.state === "idle") this.setState(e, "move");
    else if (e.state !== "move") e.state = "move";
  }

  moveAway(e: Combatant, from: Vec2, dt: number, speedMult = 1): void {
    const dx = e.pos.x - from.x;
    const dy = e.pos.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const sp = e.stats.moveSpeed * speedMult * speedMultiplier(e);
    e.vel.x = (dx / len) * sp;
    e.vel.y = (dy / len) * sp * 0.6;
    e.facing = from.x >= e.pos.x ? 1 : -1;
    if (e.state !== "move") this.setState(e, "move");
  }

  stop(e: Combatant): void {
    e.vel.x = 0;
    e.vel.y = 0;
    if (e.state === "move") this.setState(e, "idle");
  }

  /** Begins a basic attack: windup -> hit -> recover. */
  beginAttack(e: Combatant, target: Combatant, windup: number, strike: number, recover: number, onHit?: () => void): void {
    e.vel.x = 0;
    e.vel.y = 0;
    e.pendingTargetId = target.id;
    e.pendingHitLanded = false;
    e.facing = target.pos.x >= e.pos.x ? 1 : -1;
    // Fast Hands (Husk Blade): +20% attack speed after a second on the same target.
    const fastHands = e.defId === "husk_blade" && e.kind === "summon" && (e.summon?.sameTargetTime ?? 0) > 1 ? 1.2 : 1;
    e.attackCooldown = 1 / Math.max(0.1, e.stats.attackSpeed * fastHands * (1 + statusValue(e, "haste")));
    this.setState(e, "windup", windup);
    // A fresh record: a payload from an interrupted attack can never fire on a later one.
    e.attack = { strike, recover, onHit };
  }

  /** Attach the strike payload to the attack that was just begun. */
  setAttackHit(e: Combatant, fn: () => void): void {
    if (e.attack) e.attack.onHit = fn;
  }

  progressAttack(e: Combatant): void {
    if (e.state === "windup" && e.stateTime >= e.stateDuration) {
      this.setState(e, "attack", e.attack?.strike ?? 0.12);
      this.events.push({ type: "attack_swing", id: e.id, kind: e.kind, heavy: e.enemy?.archetype === "brute" || e.kind === "boss", pos: { ...e.pos }, facing: e.facing });
      this.landBasicHit(e);
    } else if (e.state === "attack" && e.stateTime >= e.stateDuration) {
      this.setState(e, "recover", e.attack?.recover ?? 0.1);
    } else if (e.state === "recover" && e.stateTime >= e.stateDuration) {
      this.setState(e, "idle");
    }
  }

  private landBasicHit(e: Combatant): void {
    if (e.pendingHitLanded) return;
    e.pendingHitLanded = true;
    const target = this.entities.get(e.pendingTargetId);
    const ranged = isRangedAttacker(e);
    const fn = e.attack?.onHit;
    if (fn) {
      e.attack!.onHit = undefined;
      fn();
      if (ranged) return;
    }
    if (!target || target.dead) return;
    const reach = e.stats.range + target.radius + 26;
    if (dist(e.pos, target.pos) > reach) return;
    if (e.kind === "player") this.playerBasicHit(target);
    else if (e.kind === "summon") this.summonBasicHit(e, target);
    else this.dealDamage(e, target, 1, "physical", e.enemy?.archetype === "brute" || e.kind === "boss");
  }

  private playerBasicHit(target: Combatant): void {
    const p = this.player;
    const fx = this.loadout.mods.gearEffects;
    const forceCrit = this.perfectCrit;
    this.perfectCrit = false;
    const res = this.dealDamage(p, target, forceCrit ? 1.5 : 1, "physical", forceCrit, 1, forceCrit);
    if (!res) return;
    this.gainEnergy(6);
    this.basicHits += 1;
    if (this.time < this.pactUntil && !p.dead) {
      const heal = Math.round(res.amount * 0.25);
      if (heal > 0) {
        p.hp = Math.min(p.stats.maxHp, p.hp + heal);
        this.events.push({ type: "heal", targetId: p.id, amount: heal, pos: { ...p.pos } });
      }
    }
    if (fx.has("bloodthirst") && !p.dead) {
      const heal = res.amount * 0.06;
      p.hp = Math.min(p.stats.maxHp, p.hp + heal);
    }
    if (fx.has("huntmark") && res.crit && !target.dead) addStatus(target, { kind: "mark", remaining: 3, value: 0.2, sourceId: p.id });
    if (fx.has("thunderclap") && this.basicHits % 5 === 0) {
      let current = target;
      const struck = new Set<number>();
      for (let i = 0; i < 3 && current; i++) {
        struck.add(current.id);
        this.events.push({ type: "chain", from: i === 0 ? { x: current.pos.x, y: current.pos.y - 140 } : { ...current.pos }, to: { ...current.pos }, color: 0xa8c4e6 });
        if (!current.dead) this.dealDamage(p, current, 1.2, "lightning", false);
        current = factionWithin(current.pos, "enemy", this.entities.values(), 140).find((o) => !struck.has(o.id)) as Combatant;
      }
    }
    const path = this.loadout.weaponPath;
    if (path === "stormblade" && this.rng.chance(STORMBLADE_CHAIN_CHANCE)) {
      const others = hostilesWithin(p, this.entities.values(), 160).filter((o) => o.id !== target.id && !o.dead);
      if (others.length > 0) {
        const o = others[0] as Combatant;
        this.events.push({ type: "chain", from: { ...target.pos }, to: { ...o.pos }, color: 0x4ee6ff });
        this.dealDamage(p, o, 0.6, "lightning", false);
      }
    } else if (path === "infernal") {
      addStatus(target, { kind: "burn", remaining: 3, value: p.stats.attack * INFERNAL_BURN_FRACTION, sourceId: p.id });
      for (const o of factionWithin(target.pos, target.faction, this.entities.values(), 55)) {
        if (o.id !== target.id && o.faction === "enemy") this.dealDamage(p, o, 0.35, "fire", false);
      }
    } else if (path === "voidfang" && !target.dead && target.kind !== "boss" && target.hp / target.stats.maxHp < VOIDFANG_EXECUTE_THRESHOLD) {
      this.events.push({ type: "hit", targetId: target.id, sourceId: p.id, amount: Math.round(target.hp), crit: true, pos: { ...target.pos }, element: "void", faction: "enemy", targetKind: target.kind, heavy: true });
      target.hp = 0;
      this.kill(target, p.id);
    }
  }

  private summonBasicHit(s: Combatant, target: Combatant): void {
    const sum = s.summon;
    if (!sum) return;
    let power = 1;
    if (sum.lastTargetId === target.id) sum.sameTargetTime += 0.5;
    else {
      sum.lastTargetId = target.id;
      sum.sameTargetTime = 0;
    }
    sum.hitCounter += 1;
    if (s.defId === "gravewalker" && sum.hitCounter % 3 === 0) {
      this.dealDamage(s, target, 1, "physical", false);
    }
    if (hasStatus(target, "opening") && sum.role === "reaper") power *= 1.5;
    if (s.defId === "ember_acolyte") {
      for (const o of factionWithin(target.pos, target.faction, this.entities.values(), 60)) if (o.id !== target.id) this.dealDamage(s, o, 0.4, "fire", false);
    }
    this.dealDamage(s, target, power, s.defId === "ember_acolyte" ? "fire" : "physical", false);
    if (s.defId === "tidestalker" && !target.dead) addStatus(target, { kind: "slow", remaining: 1.5, value: 0.2, sourceId: s.id });
  }

  gainEnergy(amount: number): void {
    if (!this.loadout.ultimateUnlocked) return;
    const before = this.energy;
    this.energy = clamp(this.energy + amount * this.loadout.mods.ultimateGainMult, 0, ULTIMATE_ENERGY_COST);
    if (before < ULTIMATE_ENERGY_COST && this.energy >= ULTIMATE_ENERGY_COST) this.events.push({ type: "ultimate_ready" });
  }

  /** Full damage pipeline with crits, marks, shields, invulnerability and death. Returns null if no damage was dealt. */
  dealDamage(source: Combatant, target: Combatant, power: number, element: Element, heavy: boolean, bonusMult = 1, forceCrit?: boolean): { amount: number; crit: boolean } | null {
    if (target.dead || source.dead) return null;
    // Invariant: nothing ever damages its own side.
    if (source.faction === target.faction) return null;
    if (hasStatus(target, "invuln") || hasStatus(target, "submerged")) return null;
    let bonus = bonusMult;
    if (hasStatus(target, "mark") && source.faction === "ally") bonus *= 1 + statusValue(target, "mark");
    if (source.faction === "ally") bonus *= 1 + 0.04 * this.shadeCount();
    const block = this.blockFactor(target, source.pos.x, heavy);
    bonus *= block;
    const fx = this.loadout.mods.gearEffects;
    if (source.kind === "player" && fx.has("executioner") && target.hp / target.stats.maxHp < 0.3) bonus *= 1.4;
    // Warden's Presence: a bound Warden on the field shields every ally (warrior included) by 15%.
    if (target.faction === "ally" && source.faction === "enemy" && this.summonEntities().some((s) => s.defId === "hollow_warden" && !s.dead)) bonus *= 0.85;
    if (target.kind === "player" && fx.has("bulwark")) {
      bonus *= 0.85;
      if (heavy && this.rng.chance(0.35)) addStatus(target, { kind: "shield", remaining: 4, value: Math.round(target.stats.maxHp * 0.08), sourceId: target.id });
    }
    const res = computeDamage(
      { attack: source.stats.attack, power, critChance: source.stats.critChance, critDamage: source.stats.critDamage, targetDefense: target.stats.defense, bonusMultiplier: bonus, forceCrit: forceCrit || undefined },
      this.rng,
    );
    this.applyRawDamage(target, res.amount, element, source.id, res.crit, heavy);
    if (source.kind === "player" && res.crit) this.gainEnergy(3);
    // The Bastion's Bulwark: whoever strikes it is slowed.
    if (target.defId === "bastion" && target.kind === "summon" && source.faction === "enemy" && !source.dead) addStatus(source, { kind: "slow", remaining: 2, value: 0.25, sourceId: target.id });
    const affix = source.enemy?.elite;
    if (affix && ELITES[affix].lifesteal > 0 && !source.dead) {
      const heal = res.amount * ELITES[affix].lifesteal;
      source.hp = Math.min(source.stats.maxHp, source.hp + heal);
      this.events.push({ type: "heal", targetId: source.id, amount: Math.round(heal), pos: { ...source.pos } });
    }
    return res;
  }

  /**
   * Shieldbearers (and the player's Bastion) block most damage from the front.
   * Heavy blows break the guard and leave it open for a few seconds.
   */
  blockFactor(target: Combatant, fromX: number, heavy: boolean): number {
    const shielded = target.enemy?.archetype === "shieldbearer" || target.summon?.role === "sentinel";
    if (!shielded || target.dead || hasStatus(target, "opening") || target.state === "stagger") return 1;
    const fromFront = (fromX - target.pos.x) * target.facing > -4;
    if (!fromFront) return 1;
    if (heavy && target.faction === "enemy") {
      addStatus(target, { kind: "opening", remaining: 3.5, value: 0.25, sourceId: -1 });
      this.setState(target, "stagger", 0.6);
      this.events.push({ type: "guard_break", id: target.id, pos: { ...target.pos } });
      return 1.25;
    }
    this.events.push({ type: "blocked", id: target.id, pos: { ...target.pos } });
    return target.faction === "enemy" ? 0.2 : 0.4;
  }

  shadeCount(): number {
    let n = 0;
    for (const e of this.entities.values()) if (e.summon?.temporary && !e.dead) n++;
    return n;
  }

  applyRawDamage(target: Combatant, amount: number, element: Element, sourceId: number, crit: boolean, heavy = false): void {
    if (target.dead || hasStatus(target, "submerged")) return;
    let remaining = amount;
    if (target.shield > 0) {
      const absorbed = Math.min(target.shield, remaining);
      target.shield -= absorbed;
      remaining -= absorbed;
      const s = target.statuses.find((x) => x.kind === "shield");
      if (s) s.value = target.shield;
      if (target.shield <= 0) target.statuses = target.statuses.filter((x) => x.kind !== "shield");
    }
    target.hp -= remaining;
    target.hitFlash = 0.12;
    if (amount >= 1 && sourceId !== -1) {
      this.events.push({ type: "hit", targetId: target.id, sourceId, amount: Math.round(amount), crit, pos: { x: target.pos.x, y: target.pos.y }, element, faction: target.faction, targetKind: target.kind, heavy });
    }
    if (target.kind === "player" && heavy && remaining > 0 && target.state !== "dodge" && target.state !== "cast") {
      this.setState(target, "hit", 0.22);
    }
    if (target.faction === "enemy" && heavy && target.kind !== "boss" && target.state !== "dead") {
      this.setState(target, "stagger", 0.35);
    }
    if (target.hp <= 0) this.kill(target, sourceId);
  }

  kill(target: Combatant, killerId: number): void {
    if (target.dead) return;
    target.dead = true;
    target.hp = 0;
    target.deathTime = 0;
    target.state = "dead";
    target.vel.x = 0;
    target.vel.y = 0;
    this.events.push({ type: "death", id: target.id, kind: target.kind, defId: target.defId, pos: { ...target.pos }, killerId, elite: !!target.enemy?.elite || undefined });
    if (target.faction === "enemy") {
      this.kills += 1;
      this.onEnemyKilled(target, killerId);
    }
  }

  private onEnemyKilled(e: Combatant, killerId: number): void {
    const def = enemyDef(e.defId);
    const scale = stageScale(this.scaleStage);
    const eliteMult = e.enemy?.elite ? ELITE_REWARD_MULT : 1;
    const minionMult = e.enemy?.minion ? 0.25 : 1;
    const gold = Math.round(def.gold * scale.reward * this.loadout.mods.goldFind * this.rng.range(0.85, 1.15) * eliteMult * minionMult * this.modeGoldMult);
    const xp = Math.round(def.xp * scale.reward * eliteMult * minionMult);
    this.events.push({ type: "gold", amount: gold, pos: { ...e.pos } });
    this.events.push({ type: "xp", amount: xp, pos: { ...e.pos } });
    this.gainEnergy(killerId === this.player.id ? 10 : 4);
    if (!e.enemy?.minion || this.chain > 0) {
      this.chain += 1;
      this.chainTimer = CHAIN_WINDOW;
      if (this.chain >= 5) this.gainEnergy(2);
      if (this.chain === 5 || this.chain === 10 || this.chain === 20 || (this.chain > 20 && this.chain % 10 === 0)) this.events.push({ type: "kill_streak", count: this.chain });
    }
    // Finishing blow: the last enemy of a wave (or the boss) falls in slow motion.
    const queueEmpty = !this.waveRunner || this.waveRunner.spawnQueue.length === 0;
    if (e.kind === "boss" || (queueEmpty && this.enemies().length === 0 && this.phase === "wave")) {
      this.timeScale = e.kind === "boss" ? 0.22 : 0.4;
      this.finisher = { timer: e.kind === "boss" ? 0.9 : 0.45 };
      this.events.push({ type: "finisher", pos: { ...e.pos }, boss: e.kind === "boss" });
    }
    if (this.loadout.mods.lifeOnKill > 0 && !this.player.dead) {
      const heal = this.player.stats.maxHp * this.loadout.mods.lifeOnKill;
      this.player.hp = Math.min(this.player.stats.maxHp, this.player.hp + heal);
      this.events.push({ type: "heal", targetId: this.player.id, amount: Math.round(heal), pos: { ...this.player.pos } });
    }
    const isBoss = e.kind === "boss";
    if (isBoss) {
      this.events.push({ type: "shake", strength: 18 });
      this.events.push({ type: "freeze", duration: 0.35 });
      const item = generateItem(this.rng, this.stage, rollRarity(this.rng, this.stage, true));
      this.pendingLoot.push({ item });
      this.events.push({ type: "loot", pos: { ...e.pos } });
    } else if (this.mode === "crypt") {
      // The Crypt is about targeted gear: only elites drop, always for today's slot, a tier up.
      if (e.enemy?.elite) {
        const base = e.enemy.keeper ? rollRarity(this.rng, this.stage, true) : rollRarity(this.rng, this.stage, false);
        const rarity = e.enemy.keeper ? base : RARITY_ORDER[Math.min(RARITY_ORDER.length - 1, RARITY_ORDER.indexOf(base) + 1)]!;
        this.pendingLoot.push({ item: generateItem(this.rng, this.stage, rarity, this.cryptSlot) });
        this.events.push({ type: "loot", pos: { ...e.pos } });
      }
    } else if (this.rng.chance(e.enemy?.elite ? 0.45 : e.enemy?.minion ? 0.02 : 0.09)) {
      const item = generateItem(this.rng, this.stage, rollRarity(this.rng, this.stage, false));
      this.pendingLoot.push({ item });
      this.events.push({ type: "loot", pos: { ...e.pos } });
    }
    if (e.enemy?.eligible && def.essenceSummonId) {
      // A species already sworn does not need the ceremony again: ordinary kills become shards.
      if (!isBoss && !e.enemy.elite && this.loadout.owned.includes(def.essenceSummonId)) {
        this.events.push({ type: "shard_gain", summonId: def.essenceSummonId, amount: this.mode === "rift" ? 2 : 1, pos: { ...e.pos } });
        return;
      }
      const orb: EssenceOrb = { id: this.allocId(), summonId: def.essenceSummonId, enemyDefId: def.id, pos: { ...e.pos }, remaining: isBoss ? 30 : 14, total: isBoss ? 30 : 14, claimed: false, isBoss, elite: !!e.enemy?.elite, attempts: isBoss ? BOSS_ATTEMPTS : 1 };
      this.orbs.push(orb);
      this.events.push({ type: "essence_available", orbId: orb.id, summonId: orb.summonId, pos: { ...orb.pos }, isBoss });
    }
  }

  spawnProjectile(owner: Combatant, target: Vec2, speed: number, kind: Projectile["kind"], power: number, arc = 0): Projectile {
    const dx = target.x - owner.pos.x;
    const dy = target.y - owner.pos.y;
    const len = Math.hypot(dx, dy) || 1;
    const res = computeDamage(
      { attack: owner.stats.attack, power, critChance: owner.stats.critChance, critDamage: owner.stats.critDamage, targetDefense: 0 },
      this.rng,
    );
    const start = { x: owner.pos.x + owner.facing * 14, y: owner.pos.y - 2 };
    const proj: Projectile = {
      id: this.allocId(),
      ownerId: owner.id,
      faction: owner.faction,
      pos: start,
      prevPos: { ...start },
      vel: { x: (dx / len) * speed, y: (dy / len) * speed },
      damage: res.amount,
      radius: 10,
      life: Math.min(3, len / speed + 0.3),
      kind,
      pierce: 0,
      hitIds: [],
      crit: res.crit,
      arc,
    };
    this.projectiles.push(proj);
    this.events.push({ type: "projectile_spawn", id: proj.id, kind, pos: { ...start } });
    return proj;
  }

  addTelegraph(pos: Vec2, radius: number, duration: number, shape: Telegraph["shape"] = "circle", dir: 1 | -1 = 1, length = 0, color = 0xff4d6d, hostile = true): void {
    this.telegraphs.push({ id: this.allocId(), pos: { ...pos }, radius, remaining: duration, total: duration, shape, dir, length, color, hostile });
    this.events.push({ type: "telegraph", pos: { ...pos }, radius, duration });
  }

  addHazard(pos: Vec2, radius: number, duration: number, dps: number, faction: Faction, sourceId: number, kind: GroundHazard["kind"]): void {
    this.hazards.push({ id: this.allocId(), pos: { ...pos }, radius, remaining: duration, dps, faction, sourceId, kind, tick: 0 });
    this.events.push({ type: "hazard", pos: { ...pos }, radius, kind, duration });
  }

  applyKnockback(target: Combatant, from: Vec2, strength: number): void {
    if (target.kind === "boss") strength *= 0.25;
    if (target.enemy?.elite && ELITES[target.enemy.elite].knockbackImmune) return;
    if (target.enemy?.archetype === "shieldbearer" && !hasStatus(target, "opening")) strength *= 0.3;
    const dx = target.pos.x - from.x;
    const dy = target.pos.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    target.knockback.x += (dx / len) * strength;
    target.knockback.y += (dy / len) * strength * 0.5;
  }

  // ---------------------------------------------------------------------
  // Integration & world objects
  // ---------------------------------------------------------------------

  private integrate(dt: number): void {
    const list = Array.from(this.entities.values()).filter((e) => !e.dead);
    for (const e of list) {
      const moving = e.state === "move" || e.state === "dodge";
      if (moving) {
        e.pos.x += e.vel.x * dt;
        e.pos.y += e.vel.y * dt;
      }
      e.pos.x += e.knockback.x * dt;
      e.pos.y += e.knockback.y * dt;
      e.knockback.x *= Math.pow(0.0005, dt);
      e.knockback.y *= Math.pow(0.0005, dt);
      if (Math.abs(e.knockback.x) < 1) e.knockback.x = 0;
      if (Math.abs(e.knockback.y) < 1) e.knockback.y = 0;
      const marginX = e.faction === "enemy" && e.stateTime < 1.5 && e.state === "move" ? 60 : 0;
      e.pos.x = clamp(e.pos.x, ARENA.minX - marginX, ARENA.maxX + marginX);
      e.pos.y = clamp(e.pos.y, ARENA.minY, ARENA.maxY);
    }
    // Soft separation so bodies don't stack.
    for (let i = 0; i < list.length; i++) {
      const a = list[i] as Combatant;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j] as Combatant;
        const minD = (a.radius + b.radius) * 0.9;
        const dx = b.pos.x - a.pos.x;
        const dy = (b.pos.y - a.pos.y) * 1.6;
        const d = Math.hypot(dx, dy);
        if (d < minD && d > 0.001) {
          const push = ((minD - d) / d) * 0.5;
          const wa = b.kind === "boss" ? 1 : a.kind === "boss" ? 0 : 0.5;
          a.pos.x -= dx * push * wa;
          a.pos.y -= (dy / 1.6) * push * wa;
          b.pos.x += dx * push * (1 - wa);
          b.pos.y += (dy / 1.6) * push * (1 - wa);
        }
      }
    }
    // Separation can nudge bodies past the edge; the arena bounds always win.
    for (const e of list) e.pos.y = clamp(e.pos.y, ARENA.minY, ARENA.maxY);
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i] as Projectile;
      p.prevPos.x = p.pos.x;
      p.prevPos.y = p.pos.y;
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      p.life -= dt;
      let consumed = false;
      for (const e of this.entities.values()) {
        if (e.dead || e.faction === p.faction || p.hitIds.includes(e.id)) continue;
        if (Math.abs(e.pos.x - p.pos.x) < e.radius + p.radius && Math.abs(e.pos.y - p.pos.y) < e.radius * 0.8 + p.radius) {
          p.hitIds.push(e.id);
          const owner = this.entities.get(p.ownerId);
          if (hasStatus(e, "invuln") || hasStatus(e, "submerged")) continue;
          const fromX = p.pos.x - Math.sign(p.vel.x || 1) * 30;
          const dmg = Math.max(1, Math.round(p.damage * Math.max(0.15, 30 / (30 + e.stats.defense)) * this.blockFactor(e, fromX, false)));
          this.applyRawDamage(e, dmg, p.kind === "ember" ? "fire" : p.kind === "warden_bolt" ? "void" : "physical", owner?.id ?? -1, p.crit, p.kind === "warden_bolt");
          if (p.kind === "ember") addStatus(e, { kind: "burn", remaining: 2.5, value: p.damage * 0.25, sourceId: p.ownerId });
          // Herald's Heat: the bound Herald's embers scorch whoever stands beside the target.
          if (owner?.defId === "ember_herald" && owner.kind === "summon") {
            for (const o of factionWithin(e.pos, e.faction, this.entities.values(), 56)) if (o.id !== e.id) this.applyRawDamage(o, Math.max(1, Math.round(dmg * 0.4)), "fire", owner.id, false);
          }
          this.events.push({ type: "projectile_hit", id: p.id, pos: { ...p.pos }, kind: p.kind });
          if (p.pierce <= 0) {
            consumed = true;
            break;
          }
          p.pierce -= 1;
        }
      }
      if (consumed || p.life <= 0 || p.pos.x < -60 || p.pos.x > ARENA.width + 60) this.projectiles.splice(i, 1);
    }
  }

  private updateHazards(dt: number): void {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i] as GroundHazard;
      h.remaining -= dt;
      h.tick -= dt;
      if (h.tick <= 0) {
        h.tick = 0.5;
        for (const e of this.entities.values()) {
          if (e.dead || e.faction === h.faction) continue;
          if (Math.abs(e.pos.x - h.pos.x) < h.radius && Math.abs(e.pos.y - h.pos.y) < h.radius * 0.6) {
            this.applyRawDamage(e, Math.max(1, Math.round(h.dps * 0.5)), h.kind === "fire" ? "fire" : "void", h.sourceId, false);
            if (h.kind === "fire") addStatus(e, { kind: "burn", remaining: 2, value: h.dps * 0.3, sourceId: h.sourceId });
            if (h.kind === "tide") addStatus(e, { kind: "slow", remaining: 0.8, value: 0.4, sourceId: h.sourceId });
          }
        }
      }
      if (h.remaining <= 0) this.hazards.splice(i, 1);
    }
  }

  private updateOrbs(rawDt: number): void {
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i] as EssenceOrb;
      if (o.claimed) {
        this.orbs.splice(i, 1);
        continue;
      }
      // Essence waits while the player reads the moment; it fades only during normal fighting.
      // Before the first oath is sworn, nothing fades: the first one must never be missed.
      if (this.phase !== "victory" && this.loadout.hasSummons && !this.holdOrbs) o.remaining -= rawDt;
      if (o.remaining <= 0) {
        this.events.push({ type: "essence_expired", orbId: o.id });
        this.orbs.splice(i, 1);
      }
    }
  }

  private updateTelegraphs(dt: number): void {
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const t = this.telegraphs[i] as Telegraph;
      t.remaining -= dt;
      if (t.remaining <= 0) this.telegraphs.splice(i, 1);
    }
  }

  private cleanup(dt: number): void {
    for (const e of this.entities.values()) {
      if (e.summon?.temporary && !e.dead && this.time >= e.summon.expiresAt) this.kill(e, -1);
    }
    for (const [id, e] of this.entities) {
      if (!e.dead) continue;
      e.deathTime += dt;
      if (e.kind === "player") continue;
      if (e.kind === "summon") {
        if (e.summon?.temporary) {
          if (e.deathTime > 0.8) this.entities.delete(id);
          continue;
        }
        // Summons return after a short while, weakened but present. Companions are permanent.
        if (e.deathTime > 9) {
          e.dead = false;
          e.hp = Math.round(e.stats.maxHp * 0.5);
          e.pos = { x: this.player.pos.x - 50, y: this.player.pos.y };
          e.prevPos = { ...e.pos };
          this.setState(e, "emerge", 0.7);
          e.statuses = [];
          this.events.push({ type: "summon_deployed", id: e.id, defId: e.defId, pos: { ...e.pos } });
        }
        continue;
      }
      if (e.deathTime > 1.4) this.entities.delete(id);
    }
  }

  // ---------------------------------------------------------------------
  // Ultimate: time dilation and seven blades
  // ---------------------------------------------------------------------

  beginUltimate(): void {
    this.ultimate = { active: true, timer: 1.6, strikes: 0, nextStrike: 0.25 };
    this.timeScale = 0.3;
    this.events.push({ type: "shake", strength: 6 });
  }

  private updateUltimate(rawDt: number): void {
    const u = this.ultimate;
    if (!u.active) return;
    u.timer -= rawDt;
    u.nextStrike -= rawDt;
    if (u.nextStrike <= 0 && u.strikes < 7) {
      u.strikes += 1;
      u.nextStrike = 0.16;
      const enemies = this.enemies();
      for (const e of enemies) {
        this.dealDamage(this.player, e, ABILITIES.ascendant_fury.power * this.abilityPower("ascendant_fury"), "soul", u.strikes === 7);
        if (u.strikes === 7) this.applyKnockback(e, this.player.pos, 260);
      }
      this.events.push({ type: "cast", id: this.player.id, ability: "ascendant_fury", pos: { ...this.player.pos }, facing: this.player.facing, targetPos: enemies[0] ? { ...enemies[0].pos } : null });
      this.events.push({ type: "shake", strength: u.strikes === 7 ? 14 : 4 });
    }
    if (u.timer <= 0) {
      u.active = false;
      addStatus(this.player, { kind: "invuln", remaining: 0.3, value: 1, sourceId: this.player.id });
    }
  }
}

function isRangedAttacker(e: Combatant): boolean {
  if (e.enemy) return e.enemy.archetype === "ranger" || e.enemy.archetype === "arcanist";
  if (e.summon) return e.summon.role === "ranger" || e.summon.role === "arcanist";
  return false;
}
