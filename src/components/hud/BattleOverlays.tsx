"use client";

import { AnimatePresence, motion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { useController, useHud, useProfile, useUi } from "@/hooks/useGame";
import { SUMMONS } from "@/game/data/summons";
import type { WorldSnapshot } from "@/game/engine/World";
import { ENEMIES } from "@/game/data/enemies";
import { regionForStage } from "@/game/data/regions";
import { currentQuest, isQuestComplete, questProgress } from "@/game/progression/quests";
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
      <div className="absolute inset-0 bg-black/55" />
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
          <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-bone/90">
            <span className="font-display">{boss.name}</span>
            <span className="text-crimson font-bold">Phase {boss.phase}</span>
          </div>
          <div className="bar mt-1 h-2 border-crimson/40">
            <div style={{ width: `${(boss.hp / boss.maxHp) * 100}%`, background: boss.phase === 2 ? "linear-gradient(90deg,#7cf6ff,#3a8fff)" : "linear-gradient(90deg,#ff4d6d,#c2314a)" }} />
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
          <div className="px-4 py-1.5 rounded-full bg-black/55 border border-white/10 font-display text-[13px] tracking-[0.3em] text-bone text-glow-cyan">{label}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function EssencePrompts() {
  const c = useController();
  const orbs = useHud((s) => s?.orbs ?? EMPTY_ORBS);
  const view = c.view;
  return (
    <AnimatePresence>
      {orbs.map((o, i) => {
        const def = SUMMONS[o.summonId];
        const left = Math.min(view.width - 70, Math.max(70, o.x * view.scale));
        const top = Math.max(40, view.offsetY + o.y * view.depthScale - 78);
        const frac = o.remaining / o.total;
        return (
          <motion.button
            key={o.id}
            initial={{ opacity: 0, y: 10, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="absolute z-20 -translate-x-1/2 flex flex-col items-center gap-0.5"
            style={{ left, top }}
            onClick={() => c.claimEssence(o.id)}
            data-guide={i === 0 ? "claim-essence" : undefined}
            data-testid="claim-essence"
            aria-label={`Claim essence of ${def?.name ?? "creature"}`}
          >
            <span className={cn("px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide border shadow-lg", o.isBoss ? "bg-[#2b2210] border-gold/70 text-gold" : "bg-[#0c1a1a] border-soul/70 text-soul")} style={{ boxShadow: o.isBoss ? "0 0 16px rgba(255,194,77,0.45)" : "0 0 16px rgba(125,240,200,0.45)" }}>
              CLAIM
            </span>
            <span className="h-1 w-10 rounded-full bg-black/60 overflow-hidden">
              <span className="block h-full rounded-full" style={{ width: `${frac * 100}%`, background: o.isBoss ? "#ffc24d" : "#7df0c8" }} />
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
    <div className="absolute left-2 top-10 z-10 flex flex-col gap-1.5" data-testid="summon-strip">
      <div className="flex gap-1">
        {summons.map((s) => (
          <div key={s.id} className={cn("relative h-9 w-9 rounded-lg overflow-hidden border", s.alive ? "border-soul/50" : "border-crimson/50 opacity-60")} title={SUMMONS[s.defId]?.name}>
            <SummonPortrait defId={s.defId} size={36} />
            <span className="absolute left-0 right-0 bottom-0 h-1 bg-black/70">
              <span className="block h-full" style={{ width: `${(s.hp / s.maxHp) * 100}%`, background: "#7df0c8" }} />
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-1" role="group" aria-label="Summon commands">
        {COMMANDS.map((cmd) => (
          <button
            key={cmd.id}
            className={cn("flex items-center gap-0.5 rounded-md px-1 py-1 text-[9px] font-bold border", command === cmd.id ? "bg-cyan/20 border-cyan/70 text-cyan" : "bg-black/50 border-white/10 text-mist")}
            onClick={() => c.setCommand(cmd.id)}
            data-guide={`command-${cmd.id}`}
            data-testid={`command-${cmd.id}`}
            aria-pressed={command === cmd.id}
          >
            <Icon name={cmd.icon} size={11} />
            {cmd.label}
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
        className={cn("flex items-center gap-2 rounded-xl border px-2.5 py-1.5 shadow-lg", done ? "bg-[#1c1a0e] border-gold/70" : "bg-black/60 border-white/12")}
        onClick={() => done && c.claimQuest()}
        data-guide={done ? "quest-claim" : undefined}
        aria-label={done ? "Claim quest reward" : "Current objective"}
        style={done ? { boxShadow: "0 0 18px rgba(255,194,77,0.35)" } : undefined}
      >
        <div className="flex flex-col items-start leading-tight">
          <span className="text-[9px] uppercase tracking-[0.2em] text-mist">{done ? "Reward ready" : "Objective"}</span>
          <span className="text-[11px] font-semibold text-bone">
            {quest.text} <span className={done ? "text-gold" : "text-cyan"}>{prog.value}/{prog.target}</span>
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10px] font-bold">
          {reward.gold ? (
            <span className="flex items-center gap-0.5 text-gold">
              <Icon name="coin" size={11} />
              {fmt(reward.gold)}
            </span>
          ) : null}
          {reward.essence ? (
            <span className="flex items-center gap-0.5 text-soul">
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
        {done && <Icon name="chevron" size={14} className="text-gold" />}
      </button>
    </motion.div>
  );
}

function Toasts() {
  const toasts = useUi((u) => u.toasts);
  const tone: Record<string, string> = { info: "text-bone border-white/15", gold: "text-gold border-gold/40", essence: "text-soul border-soul/40", warn: "text-ember border-ember/40", level: "text-cyan border-cyan/40" };
  return (
    <div className="absolute left-2 bottom-2 z-20 flex flex-col items-start gap-1 pointer-events-none w-[52%]" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className={cn("px-2.5 py-1 rounded-lg bg-black/75 border text-[10px] font-semibold text-left leading-tight", tone[t.tone])}>
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
