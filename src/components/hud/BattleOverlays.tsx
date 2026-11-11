"use client";

import { AnimatePresence, motion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { useController, useHud, useProfile, useProfileRef, useUi } from "@/hooks/useGame";
import { SUMMONS } from "@/game/data/summons";
import type { WorldSnapshot } from "@/game/engine/World";
import { ENEMIES } from "@/game/data/enemies";
import { bossForStage } from "@/game/data/regions";
import { currentQuest, isQuestComplete, questProgress } from "@/game/progression/quests";
import { extractionChance } from "@/game/summons/extraction";
import { computeModifiers } from "@/game/progression/stats";
import type { PanelId, SummonCommand } from "@/game/data/ids";
import type { QuestGoal } from "@/game/progression/quests";
import { cn } from "@/lib/cn";
import { fmt } from "@/lib/format";
import { SummonPortrait } from "@/components/ui/Portrait";
import { ModeResult } from "@/components/rewards/ModalHost";
import { BossDefeat, BossReady, BossVictory, TIER_TONE, isBattlefieldModal } from "@/components/rewards/BossCards";
import { TIER_LABEL } from "@/game/progression/readiness";
import { useStore } from "@/lib/store";
import { useEffect, useState } from "react";
import { MODES } from "@/game/data/modes";

const EMPTY_ORBS: WorldSnapshot["orbs"] = [];
const EMPTY_SUMMONS: WorldSnapshot["summons"] = [];

/** Boss health, wave banner, essence claim prompts, summon command bar, quest banner and toasts. */
export function BattleOverlays() {
  return (
    <>
      <RunOutcome />
      <ModeHud />
      <BossPlaque />
      <PushChip />
      <GateBanner />
      <ChainCounter />
      <PerkChip />
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
  if (!modal || !isBattlefieldModal(modal.kind)) return null;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-2 pb-3" data-testid={`modal-${modal.kind}`} role="dialog" aria-modal="false">
      <div className="absolute inset-0 bg-ink/60" />
      <AnimatePresence>
        {modal.kind === "mode_result" ? <ModeResult modal={modal} /> : modal.kind === "boss_ready" ? <BossReady modal={modal} /> : modal.kind === "boss_victory" ? <BossVictory modal={modal} /> : modal.kind === "boss_defeat" ? <BossDefeat modal={modal} /> : null}
      </AnimatePresence>
    </div>
  );
}

/** Outside the campaign: what mode this is, how it is going, and a way out. */
function ModeHud() {
  const c = useController();
  const mode = useHud((s) => s?.mode ?? "campaign");
  const timeLeft = useHud((s) => s?.timeLeft ?? null);
  const wave = useHud((s) => s?.wave ?? 0);
  const total = useHud((s) => s?.wavesTotal ?? 0);
  const hasBoss = useHud((s) => !!s?.boss);
  if (mode === "campaign") return null;
  if (mode === "boss") {
    // The boss bar already names the fight: only a quiet way out, clear of the army strip.
    return (
      <button className="absolute right-2 bottom-[84px] z-20 rounded-full border border-white/15 bg-ink/80 px-3 py-1.5 text-[11px] font-bold text-mist" onClick={() => c.returnToCampaign()} data-testid="mode-leave" aria-label="Retreat to farming; the boss keeps waiting">
        Retreat
      </button>
    );
  }
  const status = timeLeft !== null ? `${Math.floor(timeLeft / 60)}:${String(Math.ceil(timeLeft % 60) === 60 ? 0 : Math.ceil(timeLeft % 60)).padStart(2, "0")}` : mode === "endless" ? `Wave ${Math.max(1, wave)}` : total ? `Wave ${Math.max(1, wave)}/${total}` : "";
  return (
    <div className={cn("absolute left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 rounded-full bg-ink/80 border border-gold/40 pl-3 pr-1 py-0.5", hasBoss ? "top-10" : "top-1.5")} data-testid="mode-hud">
      <span className="font-display text-[11px] tracking-[0.14em] text-gold-2 whitespace-nowrap">{MODES[mode].name}</span>
      <span className={cn("text-[11px] font-extrabold tabular-nums", timeLeft !== null && timeLeft < 10 ? "text-crimson-2" : "text-ivory")}>{status}</span>
      <button className="text-[10px] font-bold text-mist px-2 py-1 rounded-full border border-white/10" onClick={() => c.returnToCampaign()} data-testid="mode-leave" aria-label="Leave this mode">
        Leave
      </button>
    </div>
  );
}

function PerkChip() {
  const c = useController();
  const pending = useProfile((p) => p.player.pendingPerkChoices);
  const modal = useUi((u) => u.modal);
  if (pending <= 0 || modal) return null;
  return (
    <motion.button
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="absolute left-2 bottom-[122px] z-20 flex items-center gap-1.5 rounded-full border border-gold/70 bg-[#231c0d]/95 pl-2.5 pr-3 py-1 shadow-[0_6px_16px_rgba(0,0,0,0.5)]"
      onClick={() => c.openPerkChoice()}
      data-testid="perk-chip"
      aria-label="Choose an ascension perk"
    >
      <motion.span animate={{ scale: [1, 1.25, 1] }} transition={{ duration: 1.2, repeat: Infinity }} className="text-gold-2">
        <Icon name="star" size={12} />
      </motion.span>
      <span className="font-display text-[12px] tracking-[0.08em] text-gold-2">
        <span className="hidden min-[400px]:inline">Choose a perk</span>
        <span className="min-[400px]:hidden">Perk</span>
        {pending > 1 ? ` ×${pending}` : ""}
      </span>
    </motion.button>
  );
}

/**
 * BOSS CHALLENGE. Appears once a boss gate is reached and stays while farming continues.
 * Pressing it opens the readiness sheet; the fight itself starts only from FIGHT there.
 */
function BossPlaque() {
  const c = useController();
  const gate = useProfile((p) => p.progress.bossGate);
  const farming = useHud((s) => s?.farming ?? false);
  const modal = useUi((u) => u.modal);
  const fc = useStore(c.forecastStore, (s) => s);
  if (!gate || !farming || (modal && isBattlefieldModal(modal.kind))) return null;
  const bossId = bossForStage(gate);
  const name = ENEMIES[bossId]?.name ?? "The Warden";
  const tier = fc?.stage === gate ? fc.forecast?.tier : undefined;
  return (
    <motion.button
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      className="boss-plaque absolute right-2 bottom-[122px] z-20 flex items-center gap-2 pl-1 pr-2 py-1 max-w-[56%]"
      onClick={() => c.openBossChallenge()}
      data-guide="boss-challenge"
      data-testid="boss-challenge"
      aria-label={`Boss challenge: ${name}, stage ${gate}${tier ? `, readiness ${TIER_LABEL[tier]}` : ""}`}
    >
      <span className="h-9 w-9 shrink-0 rounded-md overflow-hidden border border-crimson/50 bg-black/40">
        <SummonPortrait defId={bossId} size={36} enemy />
      </span>
      <span className="flex flex-col items-start min-w-0 leading-none">
        <span className="font-display text-[11px] tracking-[0.16em] text-crimson-2 whitespace-nowrap">BOSS CHALLENGE</span>
        <span className="text-[11px] font-semibold text-ivory truncate max-w-full mt-0.5">{name}</span>
        {tier && <span className={cn("mt-0.5 rounded px-1 text-[9px] font-bold border", TIER_TONE[tier])}>{TIER_LABEL[tier]}</span>}
      </span>
      <Icon name="chevron" size={12} className="text-crimson-2 shrink-0" />
    </motion.button>
  );
}

/** Farming is holding below the frontier (after a fall, or by choice): one tap pushes on. */
function PushChip() {
  const c = useController();
  const farming = useHud((s) => s?.farming ?? false);
  const stage = useHud((s) => s?.stage ?? 1);
  const autoPush = useProfile((p) => p.progress.autoPush);
  const frontier = useProfile((p) => p.progress.bestStage + 1);
  const modal = useUi((u) => u.modal);
  const alive = useHud((s) => s?.player.alive ?? true);
  const perks = useProfile((p) => p.player.pendingPerkChoices);
  // Hidden while the warrior is down: the fall beat decides where farming goes first.
  if (!farming || !alive || autoPush || stage >= frontier || (modal && isBattlefieldModal(modal.kind))) return null;
  return (
    <motion.button
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("absolute left-2 z-20 flex items-center gap-2 rounded-full border border-gold/60 bg-ink/85 pl-3 pr-1 py-0.5", perks > 0 ? "bottom-[160px]" : "bottom-[122px]")}
      onClick={() => c.pushStage()}
      data-testid="push-stage"
      aria-label={`Holding at stage ${stage}. Push to stage ${stage + 1}`}
    >
      <span className="text-[11px] text-parch whitespace-nowrap">Holding stage {stage}</span>
      <span className="flex items-center gap-1 rounded-full bg-gold/20 px-2 py-0.5 font-display text-[11px] text-gold-2">
        Push <Icon name="chevron" size={10} />
      </span>
    </motion.button>
  );
}

/** The milestone moment when a boss gate opens. Brief, then the plaque carries it. */
function GateBanner() {
  const flash = useUi((u) => u.gateFlash);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!flash) return;
    setShown(flash);
    const t = setTimeout(() => setShown(0), 3400);
    return () => clearTimeout(t);
  }, [flash]);
  const name = shown ? (ENEMIES[bossForStage(shown)]?.name ?? "The Warden") : "";
  return (
    <AnimatePresence>
      {shown > 0 && (
        <motion.div key={shown} initial={{ opacity: 0, scale: 1.1 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.45 }} className="absolute inset-x-0 top-[22%] z-20 flex flex-col items-center pointer-events-none text-center" data-testid="gate-banner">
          <span className="caps !text-crimson-2">Milestone · Stage {shown}</span>
          <span className="font-display text-[19px] tracking-[0.12em] text-ivory" style={{ textShadow: "0 0 18px rgba(228,108,120,0.55), 0 2px 0 rgba(0,0,0,0.6)" }}>
            {name.toUpperCase()} AWAITS
          </span>
          <span className="text-[11px] text-parch mt-0.5">Keep farming and grow stronger. Fight when you choose.</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The kill chain: a quiet number that grows louder the longer you keep it alive. */
function ChainCounter() {
  const chain = useHud((s) => s?.chain ?? 0);
  if (chain < 3) return null;
  const hot = chain >= 10;
  return (
    <div className="absolute left-2 top-[46%] z-10 pointer-events-none flex flex-col items-start leading-none" data-testid="chain">
      <motion.span
        key={chain}
        initial={{ scale: 1.35, opacity: 0.6 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.18 }}
        className={cn("font-display tabular-nums", hot ? "text-gold-2 text-[30px]" : "text-ivory text-[24px]")}
        style={{ textShadow: hot ? "0 0 18px rgba(233,201,122,0.55), 0 2px 0 rgba(0,0,0,0.6)" : "0 2px 0 rgba(0,0,0,0.6)" }}
      >
        {chain}
      </motion.span>
      <span className={cn("caps !text-[10px]", hot ? "!text-gold" : "")}>Chain</span>
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
  const mode = useHud((s) => s?.mode ?? "campaign");
  const bossDef = ENEMIES[bossForStage(stage, mode)];
  const bossName = bossDef?.name.toUpperCase() ?? "THE WARDEN";
  const farming = useHud((s) => s?.farming ?? false);
  const total = useHud((s) => s?.wavesTotal ?? 3);
  // Farming moves stages in place: announce the new stage briefly when it changes.
  const [stageFlash, setStageFlash] = useState<number | null>(null);
  const [lastStage, setLastStage] = useState(stage);
  if (stage !== lastStage) {
    setLastStage(stage);
    setStageFlash(stage);
  }
  useEffect(() => {
    if (stageFlash === null) return;
    const t = setTimeout(() => setStageFlash(null), 1700);
    return () => clearTimeout(t);
  }, [stageFlash]);
  const counter = phase === "boss_intro" ? bossDef?.counter : undefined;
  const label =
    phase === "boss_intro"
      ? bossName
      : phase === "intro"
        ? mode === "boss"
          ? "BOSS CHALLENGE"
          : `STAGE ${stage}`
        : stageFlash !== null && farming
          ? `STAGE ${stageFlash}`
          : phase === "between" && !(farming && wave >= total)
            ? "WAVE CLEARED"
            : null;
  return (
    <AnimatePresence>
      {label && (
        <motion.div key={label} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.05 }} transition={{ duration: 0.35 }} className="absolute inset-x-0 top-[26%] z-10 flex justify-center pointer-events-none">
          <div className="relative px-5 py-1.5 font-display text-[13px] tracking-[0.3em] text-ivory text-glow-gold">
            <span className="absolute inset-x-0 -top-px h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(233,211,154,0.6), transparent)" }} />
            {label}
            <span className="absolute inset-x-0 -bottom-px h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(233,211,154,0.6), transparent)" }} />
            {counter && (
              <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="absolute left-1/2 top-full mt-2 w-[min(86vw,320px)] -translate-x-1/2 text-center font-sans text-[11px] tracking-normal text-parch/90 leading-snug" data-testid="boss-counter">
                {counter}
              </motion.span>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function EssencePrompts() {
  const c = useController();
  const orbs = useHud((s) => s?.orbs ?? EMPTY_ORBS);
  const profile = useProfileRef();
  const bonus = computeModifiers(profile).extractionBonus;
  const firstEver = !profile.summons.firstSummonSeen;
  const hasArmy = useHud((s) => (s?.summons.length ?? 0) > 0);
  const view = c.view;
  // Stack pills that would overlap so each one is its own clear target.
  const placed: { left: number; top: number }[] = [];
  const positions = orbs.map((o) => {
    const left = Math.min(view.width - 60, Math.max(60, o.x * view.scale));
    let top = Math.max(40, view.offsetY + o.y * view.depthScale - 84);
    // Never cover the army's command strip in the top-left corner.
    if (hasArmy && top < 118 && left - 56 < 200) top = 118;
    // Nor the bottom HUD band (boss plaque, perk chip, quest pill, abilities): a pill there
    // would sit on those controls and steal their taps.
    top = Math.min(top, view.height - 236);
    for (let guard = 0; guard < 6 && placed.some((q) => Math.abs(q.left - left) < 104 && Math.abs(q.top - top) < 46); guard++) top -= 48;
    const pos = { left, top: Math.max(30, top) };
    placed.push(pos);
    return pos;
  });
  return (
    <AnimatePresence>
      {orbs.map((o, i) => {
        const def = SUMMONS[o.summonId];
        const { left, top } = positions[i]!;
        const frac = o.remaining / o.total;
        const chance = firstEver ? 1 : extractionChance(profile, o.summonId, { elite: o.elite, bonus });
        const tone = o.isBoss || o.elite ? "gold" : "ivory";
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
            aria-label={`Bind ${def?.name ?? "foe"}, ${Math.round(chance * 100)} percent`}
          >
            <span
              className={cn(
                "flex items-baseline gap-1.5 px-3.5 py-2 rounded-full border shadow-[0_6px_16px_rgba(0,0,0,0.5)]",
                tone === "gold" ? "bg-[#231c0d] border-gold/70 text-gold-2" : "bg-[#1d1a14] border-parch/60 text-ivory",
              )}
            >
              <span className="font-display text-[14px] tracking-[0.22em]">BIND</span>
              <span className="text-[11px] font-extrabold tabular-nums opacity-90">{Math.round(chance * 100)}%</span>
            </span>
            <span className="flex items-center gap-1">
              {o.isBoss && Array.from({ length: 3 }, (_, k) => <span key={k} className="h-1.5 w-1.5 rotate-45" style={{ background: k < o.attempts ? "#e9c97a" : "rgba(235,228,211,0.18)" }} />)}
              <span className="h-[3px] w-9 rounded-full bg-black/60 overflow-hidden">
                <span className="block h-full rounded-full" style={{ width: `${frac * 100}%`, background: tone === "gold" ? "#e9d39a" : "#ebe4d3" }} />
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
            className={cn("flex items-center gap-1 rounded-md h-8 px-2 text-[11px] font-bold", command === cmd.id ? "bg-gold/20 text-gold-2" : "text-parch")}
            onClick={() => c.setCommand(cmd.id)}
            data-guide={`command-${cmd.id}`}
            data-testid={`command-${cmd.id}`}
            aria-pressed={command === cmd.id}
            aria-label={cmd.label}
          >
            <Icon name={cmd.icon} size={13} />
            <span>{cmd.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Where an unfinished objective is worked on: tapping the pill takes you there. */
const QUEST_PANEL: Partial<Record<QuestGoal["kind"], PanelId>> = { statLevel: "hero", playerLevel: "hero", skills: "skills", deployed: "summons", collection: "summons", evolutions: "summons", equipped: "gear", stage: "rift" };

function QuestBanner() {
  const c = useController();
  const profile = useProfileRef();
  const guide = useUi((u) => u.guide);
  const mode = useHud((s) => s?.mode ?? "campaign");
  const quest = currentQuest(profile);
  if (!quest) return null;
  const prog = questProgress(profile, quest);
  const done = isQuestComplete(profile, quest);
  const reward = quest.reward;
  const panel = QUEST_PANEL[quest.goal.kind];
  // A guide label shares this corner: step aside while it teaches, unless it is pointing at us.
  // In a boss fight the pill would sit where the boss stands: it waits until the fight is over.
  const hidden = (!!guide && guide.target !== "quest-claim") || mode === "boss";
  return (
    <motion.div layout className={cn("absolute right-2 bottom-[84px] z-10 max-w-[64%] transition-opacity", hidden && "opacity-0 pointer-events-none")} data-testid="quest-banner">
      <button
        className={cn("flex items-center gap-2 rounded-full border pl-3 pr-2 h-8 shadow-[0_4px_12px_rgba(0,0,0,0.4)] max-w-full", done ? "bg-[#231c0d] border-gold/70" : "bg-ink/80 border-white/10")}
        onClick={() => (done ? c.claimQuest() : panel && c.setPanel(panel))}
        data-guide={done ? "quest-claim" : undefined}
        aria-label={done ? "Claim quest reward" : panel ? `Current objective: ${quest.text}. Open ${panel}` : `Current objective: ${quest.text}`}
      >
        <span className="text-[11px] font-semibold text-ivory truncate min-w-0">{quest.text}</span>
        <span className={cn("text-[11px] font-semibold shrink-0 tabular-nums -ml-1", done ? "text-gold-2" : "text-parch")}>
          {prog.value}/{prog.target}
        </span>
        <span className={cn("flex items-center gap-0.5 text-[11px] font-bold shrink-0", reward.gold ? "text-gold-2" : reward.essence ? "text-jade-2" : "text-violet")}>
          <Icon name={reward.gold ? "coin" : reward.essence ? "essence" : "core"} size={11} />
          {fmt(reward.gold ?? reward.essence ?? reward.riftCores ?? 0)}
        </span>
        {done && <span className="text-[10px] font-extrabold tracking-[0.12em] text-ink bg-gold-2 rounded-full px-2 py-0.5 shrink-0">CLAIM</span>}
      </button>
    </motion.div>
  );
}

function Toasts() {
  const toasts = useUi((u) => u.toasts);
  // Below the boss bar during a fight, so the boss name stays readable.
  const bossUp = useHud((s) => !!s?.boss);
  const tone: Record<string, string> = { info: "text-parch border-white/12", gold: "text-gold-2 border-gold/40", essence: "text-jade-2 border-jade/40", warn: "text-crimson-2 border-crimson/40", level: "text-gold-2 border-gold/40" };
  return (
    <div className={cn("absolute right-2 z-20 flex flex-col items-end gap-1 pointer-events-none max-w-[62%]", bossUp ? "top-[52px]" : "top-2")} aria-live="polite">
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
