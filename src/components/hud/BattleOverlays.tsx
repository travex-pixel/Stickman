"use client";

import { AnimatePresence, motion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { useController, useHud, useProfile, useUi } from "@/hooks/useGame";
import { SUMMONS } from "@/game/data/summons";
import type { WorldSnapshot } from "@/game/engine/World";
import { ENEMIES } from "@/game/data/enemies";
import { regionForStage } from "@/game/data/regions";
import { currentQuest, isQuestComplete, questProgress } from "@/game/progression/quests";
import { extractionChance } from "@/game/summons/extraction";
import { computeModifiers } from "@/game/progression/stats";
import type { SummonCommand } from "@/game/data/ids";
import { cn } from "@/lib/cn";
import { fmt } from "@/lib/format";
import { SummonPortrait } from "@/components/ui/Portrait";
import { Defeat, StageClear } from "@/components/rewards/ModalHost";

const EMPTY_ORBS: WorldSnapshot["orbs"] = [];
const EMPTY_SUMMONS: WorldSnapshot["summons"] = [];

/** Boss health, wave banner, essence claim prompts, summon command bar, quest banner and toasts. */
export function BattleOverlays() {
  return (
    <>
      <RunOutcome />
      <BossBar />
      <WaveBanner />
      <EssencePrompts />
      <SummonStrip />
      <QuestBanner />
      <Toasts />
    </>
  );
}

/** Defeat and victory live over the battlefield so the panels below stay usable for upgrading. */
function RunOutcome() {
  const modal = useUi((u) => u.modal);
  if (!modal || (modal.kind !== "defeat" && modal.kind !== "stage_clear")) return null;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-3" data-testid={`modal-${modal.kind}`} role="dialog" aria-modal="false">
      <div className="absolute inset-0 bg-ink/60" />
      <AnimatePresence>{modal.kind === "defeat" ? <Defeat modal={modal} /> : <StageClear modal={modal} />}</AnimatePresence>
    </div>
  );
}

function BossBar() {
  const boss = useHud((s) => s?.boss ?? null);
  return (
    <AnimatePresence>
      {boss && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute left-3 right-3 top-1.5 z-10" data-testid="boss-bar">
          <div className="flex items-center justify-between">
            <span className="font-display text-[11px] tracking-[0.18em] text-ivory">{boss.name.toUpperCase()}</span>
            <span className="caps text-crimson-2">Phase {boss.phase}</span>
          </div>
          <div className={cn("bar mt-1 h-2", boss.phase === 2 ? "bar-steel" : "bar-crimson")}>
            <div style={{ width: `${(boss.hp / boss.maxHp) * 100}%` }} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function WaveBanner() {
  const phase = useHud((s) => s?.phase ?? "intro");
  const wave = useHud((s) => s?.wave ?? 0);
  const stage = useHud((s) => s?.stage ?? 1);
  const bossName = ENEMIES[regionForStage(stage).bossId]?.name.toUpperCase() ?? "THE WARDEN";
  const label = phase === "boss_intro" ? bossName : phase === "between" ? (wave >= 3 ? "THE WARDEN STIRS" : "WAVE CLEARED") : phase === "intro" ? `STAGE ${stage}` : null;
  return (
    <AnimatePresence>
      {label && (
        <motion.div key={label} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.05 }} transition={{ duration: 0.35 }} className="absolute inset-x-0 top-[26%] z-10 flex justify-center pointer-events-none">
          <div className="relative px-5 py-1.5 font-display text-[13px] tracking-[0.3em] text-ivory text-glow-gold">
            <span className="absolute inset-x-0 -top-px h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(233,211,154,0.6), transparent)" }} />
            {label}
            <span className="absolute inset-x-0 -bottom-px h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(233,211,154,0.6), transparent)" }} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function EssencePrompts() {
  const c = useController();
  const orbs = useHud((s) => s?.orbs ?? EMPTY_ORBS);
  const profile = useProfile((p) => p);
  const bonus = computeModifiers(profile).extractionBonus;
  const firstEver = !profile.summons.firstSummonSeen;
  const view = c.view;
  return (
    <AnimatePresence>
      {orbs.map((o, i) => {
        const def = SUMMONS[o.summonId];
        const left = Math.min(view.width - 60, Math.max(60, o.x * view.scale));
        const top = Math.max(40, view.offsetY + o.y * view.depthScale - 84);
        const frac = o.remaining / o.total;
        const chance = firstEver ? 1 : extractionChance(profile, o.summonId, { elite: o.elite, bonus });
        const tone = o.isBoss ? "gold" : o.elite ? "gold" : "violet";
        return (
          <motion.button
            key={o.id}
            initial={{ opacity: 0, y: 10, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="absolute z-20 -translate-x-1/2 flex flex-col items-center gap-1"
            style={{ left, top }}
            onClick={() => c.claimEssence(o.id)}
            data-guide={i === 0 ? "claim-essence" : undefined}
            data-testid="claim-essence"
            aria-label={`Arise ${def?.name ?? "shadow"}, ${Math.round(chance * 100)} percent`}
          >
            <span
              className={cn(
                "flex items-baseline gap-1.5 px-3 py-1 rounded-full border shadow-[0_6px_16px_rgba(0,0,0,0.5)]",
                tone === "gold" ? "bg-[#231c0d] border-gold/70 text-gold-2" : "bg-[#17142c] border-[#8f7cff]/70 text-[#d4caff]",
              )}
            >
              <span className="font-display text-[12px] tracking-[0.24em]">ARISE</span>
              <span className="text-[10px] font-extrabold tabular-nums opacity-90">{Math.round(chance * 100)}%</span>
            </span>
            <span className="flex items-center gap-1">
              {o.isBoss && Array.from({ length: 3 }, (_, k) => <span key={k} className="h-1.5 w-1.5 rotate-45" style={{ background: k < o.attempts ? "#e9c97a" : "rgba(235,228,211,0.18)" }} />)}
              <span className="h-[3px] w-9 rounded-full bg-black/60 overflow-hidden">
                <span className="block h-full rounded-full" style={{ width: `${frac * 100}%`, background: tone === "gold" ? "#e9d39a" : "#a99cff" }} />
              </span>
            </span>
          </motion.button>
        );
      })}
    </AnimatePresence>
  );
}

const COMMANDS: { id: SummonCommand; label: string; icon: "follow" | "aggressive" | "guard" }[] = [
  { id: "follow", label: "Follow", icon: "follow" },
  { id: "aggressive", label: "Attack", icon: "aggressive" },
  { id: "guard", label: "Guard", icon: "guard" },
];

function SummonStrip() {
  const c = useController();
  const summons = useHud((s) => s?.summons ?? EMPTY_SUMMONS);
  const command = useProfile((p) => p.summons.command);
  if (summons.length === 0) return null;
  return (
    <div className="absolute left-2 top-9 z-10 flex flex-col gap-1" data-testid="summon-strip">
      <div className="flex gap-1">
        {summons.map((s) => (
          <div key={s.id} className={cn("relative h-8 w-8 rounded-md overflow-hidden border", s.alive ? "border-gold/40" : "border-crimson/50 opacity-60")} title={SUMMONS[s.defId]?.name}>
            <SummonPortrait defId={s.defId} size={32} />
            <span className="absolute left-0 right-0 bottom-0 h-[3px] bg-black/70">
              <span className="block h-full" style={{ width: `${(s.hp / s.maxHp) * 100}%`, background: "#9ee3c9" }} />
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-0.5 rounded-lg bg-ink/75 border border-white/8 p-0.5 self-start" role="group" aria-label="Summon commands">
        {COMMANDS.map((cmd) => (
          <button
            key={cmd.id}
            className={cn("flex items-center gap-1 rounded-md h-6 text-[9px] font-bold transition-all", command === cmd.id ? "bg-gold/20 text-gold-2 px-1.5" : "text-mist w-6 justify-center")}
            onClick={() => c.setCommand(cmd.id)}
            data-guide={`command-${cmd.id}`}
            data-testid={`command-${cmd.id}`}
            aria-pressed={command === cmd.id}
            aria-label={cmd.label}
          >
            <Icon name={cmd.icon} size={12} />
            {command === cmd.id && <span>{cmd.label}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function QuestBanner() {
  const c = useController();
  const profile = useProfile((p) => p);
  const quest = currentQuest(profile);
  if (!quest) return null;
  const prog = questProgress(profile, quest);
  const done = isQuestComplete(profile, quest);
  const reward = quest.reward;
  return (
    <motion.div layout className="absolute right-2 bottom-2 z-10" data-testid="quest-banner">
      <button
        className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-1.5 shadow-[0_6px_16px_rgba(0,0,0,0.45)]", done ? "bg-[#201a0c] border-gold/70" : "bg-ink/80 border-white/10")}
        onClick={() => done && c.claimQuest()}
        data-guide={done ? "quest-claim" : undefined}
        aria-label={done ? "Claim quest reward" : "Current objective"}
      >
        <div className="flex flex-col items-start leading-tight">
          <span className={cn("caps", done ? "text-gold-2" : "")}>{done ? "Reward ready" : "Objective"}</span>
          <span className="text-[11px] font-semibold text-ivory">
            {quest.text} <span className={done ? "text-gold-2" : "text-parch"}>{prog.value}/{prog.target}</span>
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10px] font-bold">
          {reward.gold ? (
            <span className="flex items-center gap-0.5 text-gold-2">
              <Icon name="coin" size={11} />
              {fmt(reward.gold)}
            </span>
          ) : null}
          {reward.essence ? (
            <span className="flex items-center gap-0.5 text-jade-2">
              <Icon name="essence" size={11} />
              {fmt(reward.essence)}
            </span>
          ) : null}
          {reward.riftCores ? (
            <span className="flex items-center gap-0.5 text-violet">
              <Icon name="core" size={11} />
              {reward.riftCores}
            </span>
          ) : null}
        </div>
        {done && <Icon name="chevron" size={14} className="text-gold-2" />}
      </button>
    </motion.div>
  );
}

function Toasts() {
  const toasts = useUi((u) => u.toasts);
  const tone: Record<string, string> = { info: "text-parch border-white/12", gold: "text-gold-2 border-gold/40", essence: "text-jade-2 border-jade/40", warn: "text-crimson-2 border-crimson/40", level: "text-gold-2 border-gold/40" };
  return (
    <div className="absolute right-2 top-2 z-20 flex flex-col items-end gap-1 pointer-events-none max-w-[62%]" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className={cn("px-2.5 py-1 rounded-md bg-ink/85 border text-[10px] font-semibold text-right leading-tight", tone[t.tone])}>
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
