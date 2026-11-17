import { describe, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { Sim } from "./econ.simlib";
import { World, FIXED_DT } from "@/game/engine/World";
import { buildLoadout } from "@/game/progression/loadout";
import type { Profile } from "@/game/progression/profile";
import { SKILLS } from "@/game/data/skills";
import { ABILITIES } from "@/game/data/abilities";
import { ABILITY_RANK_MAX } from "@/game/progression/abilityRanks";
import { autoPickPerks } from "@/game/progression/perks";
import { applyOfflineProgress } from "@/game/progression/offline";
import { computeModifiers, statAtCeiling } from "@/game/progression/stats";
import { simulateBossFight } from "@/game/progression/readiness";
import { APEX_MAX, APEX_SKILLS, type ApexRanks } from "@/game/data/apex";
import { Rng } from "@/game/engine/rng";
import type { UpgradeableStat } from "@/game/data/ids";

/**
 * Opt-in Apex instruments (APEX_SIM=climb|owner|forecast|auto). See DESIGN.md, "Apex", for what
 * each measured. All of them use the economy simulator's player (its spender buys Apex ranks once
 * open; ASCEND_APEX_BUY=0 keeps the points banked, for the arm without Apex).
 *
 *   APEX_SIM=climb SEEDS=101,102 MAXMIN=480 OUT=dir    the simulator's own player from a new save
 *   APEX_SIM=owner SEEDS=101,102 DAYS=5                an owner-like warrior: level 150, stage 49, 47 points
 *   APEX_SIM=forecast PROFILES=file.json FIGHTS=24     boss forecasts on saved profiles, with and without Apex
 *   APEX_SIM=auto PROFILES=file.json                   AUTO with every swing striking three times
 */
const mode = process.env.APEX_SIM ?? "";
const seeds = (process.env.SEEDS ?? "101").split(",").map(Number);
const FULL: ApexRanks = { double: 10, triple: 10, prism: 10, crown: 1 };

function sim(seed: number, maxMinutes: number, profile?: Profile): Sim {
  return new Sim({ seed, maxMinutes, bind: true, pushAfterCycles: 2, winsNeeded: 2, wallMinutes: Number(process.env.WALL ?? 1e9), trials: true, ascendAfterWaitMin: process.env.ASCEND_AFTER ? Number(process.env.ASCEND_AFTER) : undefined }, profile);
}

function completions(s: Sim): string {
  const at = (id: string, rank: number) => s.apexLog.find((x) => x.id === id && x.rank >= rank);
  const f = (x?: { min: number; level: number; stage: number }) => (x ? `${x.min.toFixed(0)}m (lv ${x.level}, st ${x.stage})` : "-");
  return APEX_SKILLS.map((id) => `${id} 1:${f(at(id, 1))} max:${f(at(id, APEX_MAX[id]))}`).join(" | ");
}

/** An owner-like warrior from the simulator's player at gate 48: level 150, stage 49, trees and Arts done, 47 points. */
export function ownerLike(p: Profile): Profile {
  const o: Profile = JSON.parse(JSON.stringify(p));
  o.player.level = 150;
  o.player.xp = 0;
  o.skills.unlocked = SKILLS.map((s) => s.id);
  o.player.skillPoints = 47;
  for (const id of Object.keys(ABILITIES) as (keyof typeof ABILITIES)[]) if (!ABILITIES[id].slot) o.player.abilityRanks[id] = ABILITY_RANK_MAX;
  const picks = Object.values(o.player.perks).reduce((a, b) => a + b, 0);
  o.player.pendingPerkChoices = Math.max(0, 149 - picks);
  autoPickPerks(o, new Rng(7));
  for (const stat of ["attackSpeed", "critChance"] as UpgradeableStat[]) for (let k = 0; k < 150 && !statAtCeiling(o, stat); k++) o.player.statLevels[stat] += 1;
  o.progress.bestStage = 49;
  o.progress.currentStage = 49;
  o.progress.bossGate = 0;
  o.player.autoCast = true;
  o.player.apex = { double: 0, triple: 0, prism: 0, crown: 0 };
  return o;
}

describe.skipIf(!mode)("Apex instruments", () => {
  it(mode || "none", () => {
    const out: string[] = [];
    if (mode === "climb") {
      const dump: unknown[] = [];
      for (const seed of seeds) {
        const s = sim(seed, Number(process.env.MAXMIN ?? 480));
        const tl: string[] = [];
        let next = 0;
        const orig = s.process.bind(s);
        s.process = (w) => {
          if (s.t >= next) {
            next += 1800;
            tl.push(`${(s.t / 60).toFixed(0)}m lv${s.p.player.level} best${s.p.progress.bestStage} pts${s.p.player.skillPoints} apex${JSON.stringify(s.p.player.apex)}`);
          }
          return orig(w);
        };
        s.run();
        out.push(`=== seed ${seed} end ${s.min.toFixed(0)}m lvl ${s.p.player.level} best ${s.p.progress.bestStage} bestEver ${s.p.ascension.bestEver} asc ${s.ascensions.length} pts ${s.p.player.skillPoints} apex ${JSON.stringify(s.p.player.apex)}`);
        out.push(`  ${completions(s)}`);
        out.push(`  gates: ${s.gates.filter((g) => g.gate >= 36).map((g) => `${g.gate}@${g.reachMin.toFixed(0)}${g.winMin !== null ? "w" + g.winMin.toFixed(0) : ""}`).join(" ")}`);
        out.push(`  ${tl.join("\n  ")}`);
        for (const g of s.gates) if (g.gate >= 36) dump.push({ seed, gate: g.gate, p: g.snapshotAtReach });
        dump.push({ seed, gate: 0, end: true, p: s.p });
      }
      if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(dump));
    } else if (mode === "owner") {
      const days = Number(process.env.DAYS ?? 5);
      const active = Number(process.env.ACTIVE ?? 240);
      const offline = Number(process.env.OFFLINE_H ?? 8) * 3600;
      for (const seed of seeds) {
        const base = sim(seed, 400);
        base.o.stopAfterGate = 48;
        base.run();
        const g48 = base.gates.find((g) => g.gate === 48);
        if (!g48) {
          out.push(`seed ${seed}: never reached gate 48`);
          continue;
        }
        const o = ownerLike(g48.snapshotAtReach);
        const s = sim(seed, 0, o);
        out.push(`=== seed ${seed}: owner-like from gate 48 (stats ${JSON.stringify(o.player.statLevels)}, aspd ceiling ${statAtCeiling(o, "attackSpeed")}, crit ceiling ${statAtCeiling(o, "critChance")})`);
        for (let d = 1; d <= days; d++) {
          const t0 = s.min;
          s.o.maxMinutes = t0 + active;
          s.run();
          const lvA = s.p.player.level;
          const sum = applyOfflineProgress(s.p, offline, seed * 1000 + d);
          if (sum) s.gainXp(Math.round(sum.xp * computeModifiers(s.p).xpMult));
          s.spend();
          out.push(`day ${d}: after play lv ${lvA}, after offline lv ${s.p.player.level} (+${sum?.xp ?? 0} xp offline at stage ${sum?.endStage}), best ${s.p.progress.bestStage}, pts banked ${s.p.player.skillPoints}, apex ${JSON.stringify(s.p.player.apex)}`);
        }
        // Times in the owner's days: each day is `active` game minutes (2x speed: half that in real time) then the offline credit.
        const when = (m: number) => `day ${Math.floor(m / active) + 1} +${((m % active) / 2).toFixed(0)} real min`;
        for (const id of APEX_SKILLS) {
          const first = s.apexLog.find((x) => x.id === id);
          const last = s.apexLog.find((x) => x.id === id && x.rank >= APEX_MAX[id]);
          out.push(`  ${id}: rank 1 ${first ? when(first.min) : "-"}, max ${last ? when(last.min) : "-"}`);
        }
        out.push(`  bought: ${s.apexLog.map((x) => `${x.id}${x.rank}@${(x.min / active + 1).toFixed(2)}`).join(" ")}`);
      }
    } else if (mode === "forecast") {
      const profiles = JSON.parse(readFileSync(process.env.PROFILES!, "utf8")) as { seed: number; gate: number; p: Profile }[];
      const fights = Number(process.env.FIGHTS ?? 24);
      const arms: Record<string, ApexRanks | null> = { none: null, noise: null, double: { double: 10, triple: 0, prism: 0, crown: 0 }, triple: { double: 10, triple: 10, prism: 0, crown: 0 }, prism: { double: 10, triple: 10, prism: 10, crown: 0 }, full: FULL };
      const only = (process.env.ARMS ?? Object.keys(arms).join(",")).split(",");
      const byGate = new Map<number, { seed: number; gate: number; p: Profile }[]>();
      for (const x of profiles) if (x.gate > 0) byGate.set(x.gate, [...(byGate.get(x.gate) ?? []), x]);
      const stages = (process.env.STAGES ?? "").split(",").filter(Boolean).map(Number);
      for (const [gate, list] of [...byGate.entries()].sort((a, b) => a[0] - b[0])) {
        for (const stage of stages.length ? stages.map((d) => gate + d) : [gate]) {
          const row: string[] = [];
          for (const arm of only) {
            let wins = 0;
            let n = 0;
            let left = 0;
            let secs = 0;
            for (const { p } of list) {
              const q: Profile = JSON.parse(JSON.stringify(p));
              q.player.apex = arms[arm] ? { ...arms[arm]! } : { double: 0, triple: 0, prism: 0, crown: 0 };
              for (let k = 0; k < fights; k++) {
                const r = simulateBossFight(q, stage, (arm === "noise" ? 90001 : 1) + k * 7919 + gate);
                n++;
                if (r.won) wins++;
                else left += r.bossHpLeft;
                secs += r.seconds;
              }
            }
            row.push(`${arm} ${((wins / n) * 100).toFixed(1)}% left ${(left / Math.max(1, n - wins)).toFixed(3)} ${(secs / n).toFixed(0)}s`);
          }
          out.push(`profiles at gate ${gate} (${list.length}), boss of stage ${stage}: ${row.join(" | ")}`);
        }
      }
    } else if (mode === "auto") {
      const profiles = JSON.parse(readFileSync(process.env.PROFILES!, "utf8")) as { seed: number; gate: number; p: Profile }[];
      const gates = (process.env.GATES ?? "48,51,54").split(",").map(Number);
      for (const arm of ["none", "full"]) {
        for (const kind of ["boss", "farm"] as const) {
          const acc = { secs: 0, furies: 0, gaps: [] as number[], energyPerSec: 0, basic: 0, echo: 0, prism: 0, bolt: 0, other: 0, heal: 0, maxHp: 0, chains: 0, swings: 0, procs: 0, deaths: 0, minHp: 1 };
          for (const x of profiles.filter((y) => gates.includes(y.gate))) {
            const q: Profile = JSON.parse(JSON.stringify(x.p));
            q.player.autoCast = true;
            q.player.apex = arm === "full" ? { ...FULL } : { double: 0, triple: 0, prism: 0, crown: 0 };
            const w = new World({ stage: kind === "boss" ? x.gate : x.gate - 1, loadout: buildLoadout(q), seed: x.seed * 31 + x.gate, mode: kind === "boss" ? "boss" : "campaign" });
            let t = 0;
            let lastFury = -1;
            let energy = 0;
            let prevE = 0;
            while (t < 120 && w.phase !== "victory" && w.phase !== "defeat") {
              w.update(FIXED_DT);
              t += FIXED_DT;
              const pid = w.player.id;
              if (w.energy > prevE) energy += w.energy - prevE;
              prevE = w.energy;
              acc.minHp = Math.min(acc.minHp, w.player.hp / w.player.stats.maxHp);
              for (const e of w.drainEvents()) {
                if (e.type === "cast" && e.ability === "ascendant_fury" && (e.strike ?? 1) <= 1) {
                  acc.furies++;
                  if (lastFury >= 0) acc.gaps.push(t - lastFury);
                  lastFury = t;
                } else if (e.type === "hit" && e.sourceId === pid) {
                  if (e.echo) acc.echo += e.amount;
                  else if (e.prismatic && e.element === "lightning" && !e.crit) acc.other += e.amount;
                  else if (e.prismatic) acc.prism += e.amount;
                  else if (e.element === "physical") acc.basic += e.amount;
                  else acc.other += e.amount;
                } else if (e.type === "storm_bolt") acc.bolt++;
                else if (e.type === "chain") acc.chains++;
                else if (e.type === "attack_swing" && e.id === pid && !e.cut) acc.swings++;
                else if (e.type === "heal" && e.targetId === pid) acc.heal += e.amount;
                else if (e.type === "player_defeated") acc.deaths++;
              }
              w.takeLoot();
            }
            acc.secs += t;
            acc.energyPerSec += energy;
            acc.maxHp += w.player.stats.maxHp * t;
          }
          const tot = acc.basic + acc.echo + acc.prism + acc.other;
          const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!.toFixed(2) : "-");
          out.push(`${arm} ${kind}: ${acc.secs.toFixed(0)}s, furies ${acc.furies} (median gap ${med(acc.gaps)}s), energy ${(acc.energyPerSec / acc.secs).toFixed(1)}/s, swings ${(acc.swings / acc.secs).toFixed(2)}/s, chains ${(acc.chains / acc.secs).toFixed(2)}/s, bolts ${(acc.bolt / acc.secs).toFixed(2)}/s, healed ${((acc.heal / acc.maxHp) * 100).toFixed(2)}% of max a s, lowest hp ${(acc.minHp * 100).toFixed(0)}%, deaths ${acc.deaths}; damage: plain-physical ${((acc.basic / tot) * 100).toFixed(0)}% echo ${((acc.echo / tot) * 100).toFixed(0)}% prismatic ${((acc.prism / tot) * 100).toFixed(0)}% other ${((acc.other / tot) * 100).toFixed(0)}%`);
        }
      }
    }
    console.log(out.join("\n"));
    if (process.env.LOG) writeFileSync(process.env.LOG, out.join("\n"));
  }, 36_000_000);
});
