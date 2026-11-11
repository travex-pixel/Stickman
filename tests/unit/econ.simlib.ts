/**
 * Review simulator: plays the NEW campaign flow headlessly (farming world in cycles, boss gates,
 * forecast-driven challenges), mirroring GameController's reward handling.
 */
import { World, FIXED_DT } from "@/game/engine/World";
import { buildLoadout } from "@/game/progression/loadout";
import { createDefaultProfile, type Profile } from "@/game/progression/profile";
import { applyXp } from "@/game/progression/xp";
import { claimQuest } from "@/game/progression/quests";
import { isStatUnlocked, statUpgradeCost, computeModifiers, computePlayerStats, combatPower } from "@/game/progression/stats";
import { upgradeStat } from "@/game/progression/upgrades";
import { resolveExtraction } from "@/game/summons/extraction";
import { claimEssence, setDeployed } from "@/game/summons/recruitment";
import { bondCost, summonPower, grantSummonXp, checkEvolution, evolveSummon, canStarUp, starUp } from "@/game/summons/progression";
import { canUnlockSkill, unlockSkill } from "@/game/progression/skills";
import { offerPerks, takePerk } from "@/game/progression/perks";
import { itemScore, salvageValue } from "@/game/economy/loot";
import { INVENTORY_CAP } from "@/game/data/equipment";
import { enemyDef } from "@/game/data/enemies";
import { summonDef } from "@/game/data/summons";
import { Rng } from "@/game/engine/rng";
import { canAttemptTrial, nextRankStep, promote } from "@/game/progression/ranks";
import { REPEAT_BOSS_CORE_CHANCE, shadowXpShare, skillPointsBetween } from "@/game/economy/rewards";
import { resolveBossDefeat, resolveBossVictory, resolveCycle, resolveFarmingDefeat, clampFarmStage } from "@/game/progression/campaign";
import { forecastBoss } from "@/game/progression/readiness";
import { learnTechniques } from "@/game/progression/techniques";
import { ascend, buyNode, canAscend, nextNodeCost, spendableAether, type TreeNodeId } from "@/game/progression/ascension";

const SKILL_ORDER = ["c1", "p1", "s1", "c2", "p2", "s2", "c3", "p3", "c4", "s3", "p4", "s4", "c5", "p5", "s5"];

export interface Counters {
  kills: number;
  elites: number;
  cycles: number;
  upgrades: number;
  binds: number;
  casts: number;
  gear: number;
  shadowUps: number;
  bossWins: number;
  goldEarned: number;
  goldSpentStats: number;
  essenceEarned: number;
  essenceSpent: number;
  coresEarned: number;
  coresSpent: number;
  falls: number;
  salvaged: number;
}

export interface GateRecord {
  gate: number;
  reachMin: number;
  readyMin: number | null;
  winMin: number | null;
  attempts: number;
  forecasts: string[];
  levelAtReach: number;
  cpAtReach: number;
  cycleSecAtGate: number;
  goldPerCycleAtGate: number;
  nextUpgradeCostAtReach: number;
  snapshotAtReach: Profile;
}

export interface SimOpts {
  seed: number;
  maxMinutes: number;
  /** Bind every essence orb (attentive) or never (pure idle). */
  bind: boolean;
  /** Cycles to hold at the fallback stage before pressing Push. */
  pushAfterCycles: number;
  /** Forecast wins needed before challenging. */
  winsNeeded: number;
  /** Stop when a gate takes longer than this many minutes. */
  wallMinutes: number;
  /** Stop after this gate is won. */
  stopAfterGate?: number;
  /** Ascend when stuck at a gate this many minutes (and ascension is open). */
  ascendAfterWaitMin?: number;
  /** Do rank trials when available. */
  trials: boolean;
  log?: boolean;
}

export class Sim {
  p: Profile;
  rng: Rng;
  t = 0; // sim seconds
  world!: World;
  c: Counters = { kills: 0, elites: 0, cycles: 0, upgrades: 0, binds: 0, casts: 0, gear: 0, shadowUps: 0, bossWins: 0, goldEarned: 0, goldSpentStats: 0, essenceEarned: 0, essenceSpent: 0, coresEarned: 0, coresSpent: 0, falls: 0, salvaged: 0 };
  gates: GateRecord[] = [];
  lines: string[] = [];
  holdCycles = 0;
  spendTimer = 0;
  lastForecastSig = "";
  trialFailAt = -1e9;
  stageTime: Record<number, { sec: number; cycles: number; first?: number }> = {};
  cycleStart = 0;
  timeline: { min: number; stage: number; gold: number; c: Counters }[] = [];
  nextTl = 0;

  ascensions: { min: number; from: number; total: number }[] = [];
  constructor(public o: SimOpts, profile?: Profile) {
    this.p = profile ?? createDefaultProfile(0);
    this.p.player.autoCast = true;
    this.rng = new Rng(o.seed);
  }

  get min() {
    return this.t / 60;
  }

  log(s: string) {
    this.lines.push(`${this.min.toFixed(1).padStart(6)}m ${s}`);
  }

  gainXp(amount: number) {
    const p = this.p;
    const before = p.player.level;
    const r = applyXp(p.player.level, p.player.xp, amount);
    p.player.level = r.level;
    p.player.xp = r.xp;
    if (r.level > before) {
      p.player.skillPoints += skillPointsBetween(before, r.level);
      p.player.pendingPerkChoices += r.level - before;
      if (this.world && !this.world.player.dead) this.world.player.hp = Math.min(this.world.player.stats.maxHp, this.world.player.hp + this.world.player.stats.maxHp * 0.3);
    }
  }

  addGold(g: number) {
    this.p.player.gold += g;
    this.c.goldEarned += g;
  }

  addItem(item: Profile["equipment"]["inventory"][number]) {
    const p = this.p;
    if (p.equipment.inventory.length >= INVENTORY_CAP) {
      // salvage worst unequipped
      const eq = new Set(Object.values(p.equipment.equipped));
      const cands = p.equipment.inventory.filter((i) => !eq.has(i.uid)).sort((a, b) => itemScore(a) - itemScore(b));
      const worst = cands[0];
      if (worst && itemScore(worst) < itemScore(item)) {
        this.addGold(salvageValue(worst));
        p.equipment.inventory = p.equipment.inventory.filter((i) => i.uid !== worst.uid);
        this.c.salvaged++;
      } else {
        this.addGold(salvageValue(item));
        this.c.salvaged++;
        return;
      }
    }
    p.equipment.inventory.push(item);
    this.c.gear++;
  }

  /** Mirrors GameController.processEvents for the parts that matter to the economy. */
  process(world: World): { cleared: boolean; defeated: boolean; victory: boolean } {
    const p = this.p;
    let cleared = false;
    let defeated = false;
    let victory = false;
    for (const e of world.drainEvents()) {
      switch (e.type) {
        case "gold":
          this.addGold(e.amount);
          break;
        case "xp":
          this.gainXp(e.amount);
          break;
        case "cast":
          if (e.id === world.player.id) {
            this.c.casts++;
            p.progress.abilityCasts += 1;
          }
          break;
        case "elite_spawn":
          break;
        case "death":
          if (e.kind === "enemy" || e.kind === "boss") {
            this.c.kills++;
            if ((e as { elite?: boolean }).elite) this.c.elites++;
            p.progress.totalKills += 1;
            p.progress.killsByEnemy[e.defId] = (p.progress.killsByEnemy[e.defId] ?? 0) + 1;
            if (e.kind === "boss") {
              p.progress.bossKills += 1;
              if (world.stage <= p.progress.bestStage && this.rng.chance(REPEAT_BOSS_CORE_CHANCE)) {
                p.player.riftCores += 1;
                this.c.coresEarned++;
              }
            }
            const mult = computeModifiers(p).summonXpMult;
            for (const s of p.summons.collection) grantSummonXp(s, shadowXpShare(enemyDef(e.defId).xp, world.scaleStage, s.deployed, mult));
          }
          break;
        case "shard_gain": {
          const inst = p.summons.collection.find((x) => x.defId === e.summonId || summonDef(x.defId).evolvedFrom === e.summonId);
          if (inst) {
            inst.shards += e.amount;
            p.player.essence += 3 * e.amount;
            this.c.essenceEarned += 3 * e.amount;
          }
          break;
        }
        case "essence_available":
          if (this.o.bind) this.bind(world, e.orbId);
          break;
        case "encounters_cleared":
          cleared = true;
          break;
        case "player_defeated":
          defeated = true;
          break;
        case "stage_cleared":
          victory = true;
          break;
        default:
          break;
      }
    }
    for (const l of world.takeLoot()) this.addItem(l.item);
    learnTechniques(p);
    return { cleared, defeated, victory };
  }

  bind(world: World, orbId: number) {
    const p = this.p;
    for (;;) {
      const peek = world.peekOrb(orbId);
      if (!peek) break;
      const first = !p.summons.firstSummonSeen;
      this.c.binds++;
      const essBefore = p.player.essence;
      const res = resolveExtraction(p, peek.summonId, first ? 0 : this.rng.next(), { elite: peek.elite, bonus: computeModifiers(p).extractionBonus });
      this.c.essenceEarned += p.player.essence - essBefore;
      if (res.success) {
        world.claimEssence(orbId);
        const eb = p.player.essence;
        const o = claimEssence(p, peek.summonId);
        this.c.essenceEarned += p.player.essence - eb;
        if (o.kind === "new") {
          if (first && o.instance) setDeployed(p, o.instance.instanceId, true, computeModifiers(p).deploySlots);
          p.summons.firstSummonSeen = true;
          this.log(`new shadow ${peek.summonId}`);
        }
        break;
      } else if (world.failExtraction(orbId) <= 0) break;
    }
  }

  /** Greedy spend: perks, skills, best gear, stars/evolve, deploy, bond, quests, cheapest stats. */
  spend(): boolean {
    const p = this.p;
    const sig0 = JSON.stringify([p.player.statLevels, p.player.perks, p.skills.unlocked, p.equipment.equipped, p.summons.collection.map((s) => [s.stars, s.bond, s.deployed, s.defId])]);
    while (p.player.pendingPerkChoices > 0) {
      const offers = offerPerks(p, this.rng);
      if (!offers.length) {
        p.player.pendingPerkChoices = 0;
        break;
      }
      takePerk(p, offers[0]!.id);
    }
    for (const id of SKILL_ORDER) if (canUnlockSkill(p, id).ok) unlockSkill(p, id);
    const best: Record<string, (typeof p.equipment.inventory)[number]> = {};
    for (const it of p.equipment.inventory) if (!best[it.slot] || itemScore(it) > itemScore(best[it.slot]!)) best[it.slot] = it;
    for (const [slot, it] of Object.entries(best)) (p.equipment.equipped as Record<string, string>)[slot] = it.uid;
    for (const s of p.summons.collection) {
      while (canStarUp(s, p.player.riftCores)) {
        const c = starUp(s);
        p.player.riftCores -= c;
        this.c.coresSpent += c;
        this.c.shadowUps++;
      }
      const ch = checkEvolution(s, p.player.riftCores);
      if (ch.possible) {
        const c = summonDef(s.defId).evolution!.requiredRiftCores;
        p.player.riftCores -= c;
        this.c.coresSpent += c;
        evolveSummon(s);
        p.progress.evolutions++;
        this.c.shadowUps++;
      }
    }
    const slots = computeModifiers(p).deploySlots;
    [...p.summons.collection].sort((a, b) => summonPower(b) - summonPower(a)).forEach((s, i) => (s.deployed = i < slots));
    let guard = 0;
    while (guard++ < 500) {
      const dep = p.summons.collection.filter((s) => s.deployed).sort((a, b) => a.bond - b.bond)[0];
      if (!dep || dep.bond >= 50 || p.player.essence < bondCost(dep.bond)) break;
      p.player.essence -= bondCost(dep.bond);
      this.c.essenceSpent += bondCost(dep.bond);
      dep.bond++;
      this.c.shadowUps++;
    }
    guard = 0;
    while (guard++ < 3000) {
      while (claimQuest(p)) {
        /* claim all */
      }
      const opts = (["attack", "maxHp", "defense", "attackSpeed", "critChance", "critDamage"] as const).filter((s) => isStatUnlocked(p, s));
      const s = opts.sort((a, b) => statUpgradeCost(a, p.player.statLevels[a]) - statUpgradeCost(b, p.player.statLevels[b]))[0]!;
      const r = upgradeStat(p, s);
      if (!r.ok) break;
      this.c.upgrades++;
      this.c.goldSpentStats += r.cost ?? 0;
    }
    const sig1 = JSON.stringify([p.player.statLevels, p.player.perks, p.skills.unlocked, p.equipment.equipped, p.summons.collection.map((s) => [s.stars, s.bond, s.deployed, s.defId])]);
    return sig0 !== sig1;
  }

  nextUpgradeCost(): number {
    const p = this.p;
    const opts = (["attack", "maxHp", "defense", "attackSpeed", "critChance", "critDamage"] as const).filter((s) => isStatUnlocked(p, s));
    return Math.min(...opts.map((s) => statUpgradeCost(s, p.player.statLevels[s])));
  }

  cp(): number {
    return combatPower(computePlayerStats(this.p));
  }

  startFarm(stage: number) {
    this.world = new World({ stage, loadout: buildLoadout(this.p), seed: (this.o.seed * 7919 + Math.floor(this.t)) >>> 0 });
    this.cycleStart = this.t;
  }

  /** Runs a boss/trial world to completion. Returns win. */
  fight(stage: number, mode: "boss" | "trial", seed: number): { win: boolean; sec: number } {
    const w = new World({ stage, loadout: buildLoadout(this.p), seed, mode });
    const prev = this.world;
    this.world = w;
    let sec = 0;
    let res = { win: false, sec: 0 };
    while (sec < 300) {
      w.update(FIXED_DT);
      sec += FIXED_DT;
      const r = this.process(w);
      if (r.victory || w.phase === "victory") {
        res = { win: true, sec };
        break;
      }
      if (r.defeated || w.phase === "defeat") {
        res = { win: false, sec };
        break;
      }
    }
    this.t += sec + 3; // intro/cards
    this.world = prev;
    return res;
  }

  forecastSig(): string {
    const p = this.p;
    return JSON.stringify([p.progress.bossGate, p.player.level, p.player.rank, p.player.statLevels, p.equipment.equipped, p.summons.collection.map((s) => [s.defId, s.level, s.stars, s.bond, s.deployed]), p.skills.unlocked, p.player.perks]);
  }

  run(): void {
    const o = this.o;
    const p = this.p;
    this.startFarm(clampFarmStage(p, p.progress.currentStage));
    let gateRec: GateRecord | null = null;
    if (p.progress.bossGate) {
      gateRec = { gate: p.progress.bossGate, reachMin: this.min, readyMin: null, winMin: null, attempts: 0, forecasts: [], levelAtReach: p.player.level, cpAtReach: this.cp(), cycleSecAtGate: 0, goldPerCycleAtGate: 0, nextUpgradeCostAtReach: this.nextUpgradeCost(), snapshotAtReach: JSON.parse(JSON.stringify(p)) };
      this.gates.push(gateRec);
    }
    while (this.min < o.maxMinutes) {
      // rank trials
      if (o.trials && canAttemptTrial(p) && this.t - this.trialFailAt > 300 && !p.progress.bossGate) {
        const step = nextRankStep(p)!;
        const r = this.fight(step.trialStage, "trial", (o.seed * 31 + Math.floor(this.t)) >>> 0);
        if (r.win) {
          promote(p);
          this.c.bossWins++;
          this.log(`rank trial won -> rank ${p.player.rank} (lvl ${p.player.level})`);
        } else this.trialFailAt = this.t;
        this.spend();
        this.startFarm(clampFarmStage(p, p.progress.currentStage));
      }
      if (this.t >= this.nextTl) {
        this.timeline.push({ min: this.min, stage: this.world.stage, gold: this.p.player.gold, c: { ...this.c } });
        this.nextTl += 300;
      }
      const w = this.world;
      w.update(FIXED_DT);
      this.t += FIXED_DT;
      const r = this.process(w);
      this.spendTimer += FIXED_DT;
      if (this.spendTimer >= 1.5) {
        this.spendTimer = 0;
        if (this.spend()) w.setLoadout(buildLoadout(p));
      }
      if (r.defeated) {
        const stage = w.stage;
        this.c.falls++;
        const fb = resolveFarmingDefeat(p, stage);
        this.log(`FELL farming stage ${stage} (lvl ${p.player.level}, CP ${this.cp()}) -> hold at ${fb}`);
        this.t += 2.2;
        this.holdCycles = 0;
        this.spend();
        this.startFarm(fb);
        continue;
      }
      if (r.cleared) {
        const stage = w.stage;
        const cyc = this.t - this.cycleStart;
        this.cycleStart = this.t;
        const st = (this.stageTime[stage] ??= { sec: 0, cycles: 0 });
        st.sec += cyc;
        st.cycles++;
        const res = resolveCycle(p, stage, computeModifiers(p).goldFind);
        this.addGold(res.gold);
        this.gainXp(res.xp);
        this.c.cycles++;
        if (res.stageCleared) this.log(`cleared stage ${stage} (cycle ${cyc.toFixed(0)}s, lvl ${p.player.level}, CP ${this.cp()}, gold ${p.player.gold})`);
        if (res.next !== stage) w.queueStage(res.next);
        if (!p.progress.autoPush) {
          this.holdCycles++;
          if (this.holdCycles >= o.pushAfterCycles) {
            // press Push
            p.progress.autoPush = true;
            const next = clampFarmStage(p, w.stage + 1);
            if (next !== w.stage) {
              p.progress.currentStage = next;
              w.queueStage(next);
            }
            this.holdCycles = 0;
          }
        }
        if (res.gateReached) {
          this.spend();
          gateRec = {
            gate: stage,
            reachMin: this.min,
            readyMin: null,
            winMin: null,
            attempts: 0,
            forecasts: [],
            levelAtReach: p.player.level,
            cpAtReach: this.cp(),
            cycleSecAtGate: 0,
            goldPerCycleAtGate: 0,
            nextUpgradeCostAtReach: this.nextUpgradeCost(),
            snapshotAtReach: JSON.parse(JSON.stringify(p)),
          };
          this.gates.push(gateRec);
          this.log(`GATE ${stage} reached (lvl ${p.player.level}, CP ${this.cp()})`);
          this.lastForecastSig = "";
        }
        // At a gate: forecast after each cycle if something changed.
        if (p.progress.bossGate && w.stage === p.progress.bossGate && gateRec && gateRec.gate === p.progress.bossGate) {
          if (!res.gateReached) {
            gateRec.cycleSecAtGate = cyc;
            gateRec.goldPerCycleAtGate = res.gold;
          }
          this.spend();
          w.setLoadout(buildLoadout(p));
          const sig = this.forecastSig();
          if (sig !== this.lastForecastSig) {
            this.lastForecastSig = sig;
            const f = forecastBoss(p, gateRec.gate);
            gateRec.forecasts.push(`${(this.min - gateRec.reachMin).toFixed(1)}m:${f.wins}/4(${f.avgBossHpLeft.toFixed(2)})`);
            if (f.wins >= o.winsNeeded) {
              if (gateRec.readyMin === null) gateRec.readyMin = this.min;
              gateRec.attempts++;
              const fr = this.fight(gateRec.gate, "boss", (o.seed * 101 + gateRec.attempts * 17 + gateRec.gate) >>> 0);
              if (fr.win) {
                const v = resolveBossVictory(p, gateRec.gate, computeModifiers(p).goldFind);
                this.addGold(v.gold);
                this.gainXp(v.xp);
                p.player.riftCores += v.cores;
                this.c.coresEarned += v.cores;
                this.c.bossWins++;
                gateRec.winMin = this.min;
                this.log(`BOSS ${gateRec.gate} WON in ${fr.sec.toFixed(0)}s (attempt ${gateRec.attempts}, forecast ${f.wins}/4) +${v.gold}g +${v.xp}xp`);
                this.spend();
                this.startFarm(v.next);
                if (o.stopAfterGate && gateRec.gate >= o.stopAfterGate) return;
                gateRec = null;
                continue;
              } else {
                const fs = resolveBossDefeat(p, gateRec.gate);
                this.log(`boss ${gateRec.gate} lost (attempt ${gateRec.attempts}, forecast ${f.wins}/4)`);
                this.spend();
                this.startFarm(fs);
                this.lastForecastSig = "";
                continue;
              }
            }
          }
          if (o.ascendAfterWaitMin !== undefined && this.min - gateRec.reachMin > o.ascendAfterWaitMin && canAscend(p)) {
            const r = ascend(p);
            if (r) {
              this.log(`ASCENSION ${r.count} from stage ${r.fromStage}: +${r.gained} aether (total ${r.total})`);
              this.ascensions.push({ min: this.min, from: r.fromStage, total: r.total });
              this.spendAether();
              gateRec = null;
              this.startFarm(1);
              continue;
            }
          }
          if (this.min - gateRec.reachMin > o.wallMinutes) {
            this.log(`WALL at gate ${gateRec.gate}: ${(this.min - gateRec.reachMin).toFixed(0)} min without a 2/4 forecast`);
            return;
          }
        }
      }
    }
  }

  /** Aether policy: Command first, then whichever of Might, Vigor, Fortune, Insight is cheapest. */
  private spendAether(): void {
    const p = this.p;
    const order: TreeNodeId[] = ["command", "might", "vigor", "fortune", "insight", "patience"];
    for (let guard = 0; guard < 500; guard++) {
      if (nextNodeCost(p, "command") !== null && spendableAether(p) >= 60 && buyNode(p, "command")) continue;
      let best: TreeNodeId | null = null;
      let cost = Infinity;
      for (const id of order) {
        const c = nextNodeCost(p, id);
        if (c !== null && c < cost) {
          cost = c;
          best = id;
        }
      }
      if (!best || cost > spendableAether(p) || !buyNode(p, best)) break;
    }
    this.log(`aether tree: ${JSON.stringify(p.ascension.nodes)} (spare ${spendableAether(p)})`);
  }
}

export function fmtGate(g: GateRecord): string {
  const wait = g.readyMin !== null ? (g.readyMin - g.reachMin).toFixed(1) : "never";
  return `gate ${String(g.gate).padStart(2)}: reach ${g.reachMin.toFixed(1)}m  wait-to-2/4 ${wait}m  won ${g.winMin !== null ? g.winMin.toFixed(1) + "m" : "-"} attempts ${g.attempts}  lvl@reach ${g.levelAtReach} CP ${g.cpAtReach}  gate cycle ${g.cycleSecAtGate.toFixed(0)}s ${g.goldPerCycleAtGate}g  nextUp ${g.nextUpgradeCostAtReach}g  forecasts ${g.forecasts.slice(0, 12).join(" ")}${g.forecasts.length > 12 ? " ..." + g.forecasts.slice(-3).join(" ") : ""}`;
}
