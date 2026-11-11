"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { SummonPortrait } from "@/components/ui/Portrait";
import { useController, useHud, useProfileRef } from "@/hooks/useGame";
import { extractionChance } from "@/game/summons/extraction";
import { useStore } from "@/lib/store";
import type { Modal } from "@/game/GameController";
import { ENEMIES } from "@/game/data/enemies";
import { bossForStage, regionForStage } from "@/game/data/regions";
import { stageClearCores, stageClearGold } from "@/game/economy/rewards";
import { combatPower, computeModifiers, computePlayerStats } from "@/game/progression/stats";
import { TIER_LABEL, readinessTips, type ReadinessTier, type ReadinessTip } from "@/game/progression/readiness";
import { CountUp, LootCard } from "@/components/rewards/RewardFx";
import { cn } from "@/lib/cn";
import { fmt } from "@/lib/format";

/** Cards that sit over the battlefield so the panels below stay usable while they are open. */
export const BATTLEFIELD_MODALS = ["boss_ready", "boss_victory", "boss_defeat", "mode_result"] as const;
export function isBattlefieldModal(kind: string): boolean {
  return (BATTLEFIELD_MODALS as readonly string[]).includes(kind);
}

export const TIER_TONE: Record<ReadinessTier, string> = {
  ready: "text-jade-2 border-jade/60 bg-jade/10",
  even: "text-gold-2 border-gold/60 bg-gold/10",
  hard: "text-[#e9a46a] border-[#e9a46a]/60 bg-[#e9a46a]/10",
  deadly: "text-crimson-2 border-crimson/60 bg-crimson/10",
};

function Sheet({ children, testId, tone = "neutral" }: { children: React.ReactNode; testId: string; tone?: "neutral" | "crimson" | "gold" }) {
  return (
    <motion.div
      className={cn("modal-card relative w-full max-w-[360px] max-h-full overflow-hidden flex flex-col", tone === "crimson" && "!border-crimson/50", tone === "gold" && "!border-gold/60")}
      initial={{ scale: 0.92, y: 12, opacity: 0 }}
      animate={{ scale: 1, y: 0, opacity: 1 }}
      exit={{ scale: 0.96, opacity: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 26 }}
      data-testid={testId}
    >
      {children}
    </motion.div>
  );
}

function TipList({ tips, max }: { tips: ReadinessTip[]; max: number }) {
  const c = useController();
  if (tips.length === 0) return null;
  return (
    <ul className="w-full flex flex-col gap-1" data-testid="boss-tips">
      {tips.slice(0, max).map((t, i) => (
        <li key={t.text} className={cn(i >= 1 && "short-hide")}>
          <button className="w-full flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-left text-[11px] leading-snug text-parch" onClick={() => c.setPanel(t.panel)}>
            <Icon name="chevron" size={10} className="text-gold shrink-0" />
            <span className="flex-1 min-w-0">{t.text}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The readiness sheet: who waits, how a fight would likely go, and what would help. */
export function BossReady({ modal }: { modal: Extract<Modal, { kind: "boss_ready" }> }) {
  const c = useController();
  // useProfileRef re-renders on every commit, so tips and numbers follow upgrades made below.
  const profile = useProfileRef();
  const fc = useStore(c.forecastStore, (s) => s);
  const alive = useHud((s) => s?.player.alive ?? true);
  const bossId = bossForStage(modal.stage);
  const boss = ENEMIES[bossId];
  const stats = computePlayerStats(profile);
  const power = combatPower(stats);
  const deployed = profile.summons.collection.filter((s) => s.deployed).length;
  const slots = computeModifiers(profile).deploySlots;
  const gearCount = Object.keys(profile.equipment.equipped).length;
  const tips = readinessTips(profile, modal.stage);
  const forecast = fc?.stage === modal.stage ? fc.forecast : null;
  const running = !!fc?.running;
  const gold = stageClearGold(modal.stage, computeModifiers(profile).goldFind);
  const cores = stageClearCores(modal.stage, true, true);
  return (
    <Sheet testId="boss-ready" tone="crimson">
      <div className="px-3 pt-2.5 pb-2.5 flex flex-col gap-1.5 items-stretch">
        <div className="flex items-center gap-2.5">
          <div className="h-11 w-11 shrink-0 rounded-lg overflow-hidden border border-crimson/50 bg-black/30">
            <SummonPortrait defId={bossId} size={44} enemy />
          </div>
          <div className="min-w-0 flex-1">
            <div className="caps !text-crimson-2">Boss · Stage {modal.stage}</div>
            <div className={cn("font-display text-ivory leading-tight truncate", (boss?.name.length ?? 0) > 16 ? "text-[15px]" : "text-[17px]")}>{boss?.name ?? "The Warden"}</div>
            <div className="text-[10px] text-mist truncate">{regionForStage(modal.stage).name}</div>
          </div>
          <div className={cn("shrink-0 rounded-md border px-2 py-1 text-center leading-none", forecast ? TIER_TONE[forecast.tier] : "border-white/10 text-mist")} data-testid="boss-readiness">
            <div className="text-[9px] tracking-[0.12em] uppercase opacity-80">Readiness</div>
            <div className="font-display text-[13px] mt-0.5">{forecast ? TIER_LABEL[forecast.tier] : running ? "…" : "–"}</div>
          </div>
        </div>
        <div className="text-[11px] text-parch leading-snug" data-testid="boss-forecast">
          {forecast ? (
            <>
              Auto-battle forecast: won <b className="text-ivory">{forecast.wins}</b> of {forecast.fights}
              {forecast.wins < forecast.fights && forecast.avgBossHpLeft > 0 && (
                <>
                  {" "}· losses left it at <b className="text-ivory">{Math.round(forecast.avgBossHpLeft * 100)}%</b>
                </>
              )}
              {running && <span className="text-mist"> · updating…</span>}
            </>
          ) : (
            <span className="text-mist">Simulating the fight with your current build…</span>
          )}
        </div>
        <div className="grid grid-cols-4 gap-1 text-center">
          {[
            ["Level", `${profile.player.level}`],
            ["Power", fmt(power)],
            ["Army", `${deployed}/${slots}`],
            ["Gear", `${gearCount}/6`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-md bg-white/[0.04] border border-white/8 py-1 leading-none">
              <div className="text-[9px] uppercase tracking-[0.1em] text-mist">{k}</div>
              <div className="text-[13px] font-bold text-ivory mt-0.5 tabular-nums">{v}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-center gap-3 text-[11px] text-mist short-hide">
          <span>Victory:</span>
          <span className="flex items-center gap-1 text-gold-2 font-bold"><Icon name="coin" size={11} />{fmt(gold)}</span>
          {cores > 0 && <span className="flex items-center gap-1 text-gold-2 font-bold"><Icon name="core" size={11} />{cores}</span>}
          <span className="text-parch">Stage {modal.stage + 1}</span>
        </div>
        <TipList tips={tips} max={3} />
        {boss?.counter && <p className="text-[10px] italic text-parch/90 leading-snug">{boss.counter}</p>}
        <div className="flex gap-2 mt-0.5">
          <button className="btn-ghost flex-1 !py-2" onClick={() => c.closeModal()} data-testid="boss-later">
            Keep farming
          </button>
          <button className="btn-boss flex-[1.3] !py-2" onClick={() => c.challengeBoss()} disabled={!alive} data-guide="boss-fight" data-testid="boss-fight">
            {alive ? "FIGHT" : "Regrouping…"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

export function BossVictory({ modal }: { modal: Extract<Modal, { kind: "boss_victory" }> }) {
  const c = useController();
  const profile = useProfileRef();
  const orb = useHud((s) => (modal.orbId !== undefined ? (s?.orbs.find((o) => o.id === modal.orbId) ?? null) : null));
  // An unclaimed boss essence is a decision: no countdown runs while it waits.
  const auto = profile.settings.autoAdvance && !orb;
  const [left, setLeft] = useState(auto ? 7 + Math.min(2, modal.items.length) : -1);
  useEffect(() => {
    if (!auto || left < 0) return;
    if (left === 0) {
      c.continueAfterVictory();
      return;
    }
    const t = setTimeout(() => setLeft((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [left, auto, c]);
  const boss = ENEMIES[modal.defId];
  // The very first oath always holds, so the card says so.
  const chance = orb ? (!profile.summons.firstSummonSeen ? 1 : extractionChance(profile, orb.summonId, { elite: orb.elite, bonus: computeModifiers(profile).extractionBonus })) : 0;
  return (
    <Sheet testId="boss-victory" tone="gold">
      <div className="px-4 pt-3 pb-3 text-center flex flex-col gap-1.5 items-center short-tight">
        <motion.div initial={{ letterSpacing: "0.6em", opacity: 0 }} animate={{ letterSpacing: "0.32em", opacity: 1 }} transition={{ duration: 0.6 }} className="caps !text-[11px] text-gold-2">
          Victory
        </motion.div>
        <div className="font-display text-[20px] text-ivory text-glow-gold leading-none">{boss?.name ?? "The Warden"} falls</div>
        <div className="text-[11px] text-mist">Stage {modal.stage} cleared in {modal.seconds}s</div>
        <div className="flex gap-3 mt-0.5 text-[13px] font-bold">
          <span className="flex items-center gap-1 text-gold" data-testid="victory-gold">
            <Icon name="coin" size={14} />
            <CountUp prefix="+" value={modal.gold} delay={150} onTick={() => c.rewardCue("tick")} />
          </span>
          <span className="flex items-center gap-1 text-gold-2">
            <Icon name="xp" size={14} />
            <CountUp prefix="+" value={modal.xp} delay={260} /> XP
          </span>
          {modal.cores > 0 && (
            <motion.span initial={{ opacity: 0, scale: 1.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.45, type: "spring", stiffness: 300, damping: 14 }} className="flex items-center gap-1 text-parch">
              <Icon name="core" size={14} className="text-gold-2" />+{modal.cores}
            </motion.span>
          )}
        </div>
        {modal.items.length > 0 && (
          <div className="w-full flex flex-col gap-1" style={{ perspective: 600 }}>
            {modal.items.slice(0, 2).map((it, i) => (
              <LootCard key={it.uid} item={it} index={i} className={i >= 1 ? "short-hide" : undefined} onReveal={(rare) => c.rewardCue(rare ? "rare" : "card")} />
            ))}
          </div>
        )}
        {modal.unlocks.length > 0 && (
          <div className="w-full flex flex-wrap justify-center gap-1" data-testid="victory-unlocks">
            {modal.unlocks.map((u) => (
              <motion.span key={u} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }} className="rounded-full border border-jade/50 bg-jade/10 px-2 py-0.5 text-[10px] font-bold text-jade-2">
                {u}
              </motion.span>
            ))}
          </div>
        )}
        {orb && (
          <div className="w-full flex items-center gap-2 rounded-lg border border-gold/50 bg-gold/10 px-2 py-1.5" data-testid="victory-bind">
            <div className="flex-1 min-w-0 text-left leading-tight">
              <div className="text-[11px] font-semibold text-ivory truncate">{boss?.name ?? "The boss"}&apos;s essence lingers</div>
              <div className="text-[10px] text-mist">{orb.attempts > 1 ? `${orb.attempts} attempts` : "Last attempt"} · it will not fade</div>
            </div>
            <button className="btn-primary !py-1.5 !px-3 !text-[13px] shrink-0" onClick={() => c.bindBossEssence(orb.id)} data-testid="victory-bind-button">
              BIND {Math.round(chance * 100)}%
            </button>
          </div>
        )}
        <button className="btn-primary w-full mt-1" onClick={() => c.continueAfterVictory()} data-testid="victory-continue">
          Onward to stage {modal.nextStage}
          {auto && left > 0 && <span className="ml-1.5 inline-block rounded-full bg-black/25 px-1.5 text-[11px] font-sans font-bold tabular-nums align-middle">{left}s</span>}
        </button>
      </div>
    </Sheet>
  );
}

export function BossDefeat({ modal }: { modal: Extract<Modal, { kind: "boss_defeat" }> }) {
  const c = useController();
  const boss = ENEMIES[modal.defId];
  const dealt = Math.round((1 - modal.bossHpLeft) * 100);
  return (
    <Sheet testId="boss-defeat" tone="crimson">
      <div className="px-3 pt-2.5 pb-2.5 flex flex-col gap-1.5 items-stretch">
        <div className="text-center">
          <div className="caps !text-crimson-2">Defeated</div>
          <div className="font-display text-[18px] text-ivory leading-tight">{boss?.name ?? "The Warden"} holds</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="bar bar-crimson flex-1 !h-2">
            <div style={{ width: `${modal.bossHpLeft * 100}%` }} />
          </div>
          <span className="text-[11px] font-bold text-crimson-2 tabular-nums shrink-0">{Math.round(modal.bossHpLeft * 100)}% left</span>
        </div>
        <div className="text-[11px] text-parch leading-snug text-center" data-testid="defeat-summary">
          You dealt <b className="text-ivory">{dealt}%</b> in {modal.seconds}s{modal.bossPhase > 1 ? `, reaching phase ${modal.bossPhase}` : ""}. {modal.casts} abilities, {modal.dodges} dodges{modal.perfect ? ` (${modal.perfect} perfect)` : ""}
          {modal.summonsLost ? `, ${modal.summonsLost} shadow${modal.summonsLost > 1 ? "s" : ""} fell` : ""}.
        </div>
        <div className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-mist text-center short-hide">
          Back to farming stage {modal.farmStage}. Everything you earned is kept, and the boss waits until <i>you</i> choose to fight again.
        </div>
        <div className="text-[10px] text-mist text-center short-only">Farming stage {modal.farmStage}. The boss waits for you.</div>
        <TipList tips={modal.tips} max={3} />
        <div className="flex gap-2 mt-0.5">
          <button className="btn-ghost flex-1 !py-2" onClick={() => c.closeModal()} data-testid="defeat-close">
            Keep farming
          </button>
          <button
            className="btn-primary flex-1 !py-2"
            onClick={() => {
              c.closeModal();
              c.spendGoldNow();
            }}
            data-testid="defeat-upgrade"
          >
            Get stronger
          </button>
        </div>
      </div>
    </Sheet>
  );
}
