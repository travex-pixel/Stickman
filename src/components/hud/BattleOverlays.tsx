"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/Button";
import { Meter } from "@/components/ui/Meter";
import { Segment, Segmented } from "@/components/ui/Segmented";
import { CurrencyGlyph, type CurrencyKind } from "@/components/ui/Currency";
import { SummonPortrait } from "@/components/ui/Portrait";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useController, useHud, useProfile, useProfileRef, useUi } from "@/hooks/useGame";
import { SUMMONS } from "@/game/data/summons";
import type { SummonRole } from "@/game/data/ids";
import type { WorldSnapshot } from "@/game/engine/World";
import { ENEMIES } from "@/game/data/enemies";
import { bossForStage, regionForStage } from "@/game/data/regions";
import { depthLabel } from "@/game/data/depths";
import { currentQuest, isQuestComplete, questProgress } from "@/game/progression/quests";
import { extractionChance } from "@/game/summons/extraction";
import { computeModifiers } from "@/game/progression/stats";
import { RARITY_ORDER, type PanelId, type SummonCommand } from "@/game/data/ids";
import type { QuestGoal } from "@/game/progression/quests";
import { cn } from "@/lib/cn";
import { fmt } from "@/lib/format";
import { isBattlefieldModal } from "@/components/sheets/kinds";
import { TIER_LABEL } from "@/game/progression/readiness";
import { useStore } from "@/lib/store";
import { useSheetRise } from "@/hooks/useSheetLift";
import { MODES } from "@/game/data/modes";

const EMPTY_ORBS: WorldSnapshot["orbs"] = [];
const EMPTY_SUMMONS: WorldSnapshot["summons"] = [];
const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/**
 * The battlefield overlays. The player watches a fight, not a dashboard: at rest there are at
 * most five groups (army command and status at the top, the quest line and the abilities at the
 * bottom), all borderless glass or plain text, so the painting stays the subject.
 */
export function BattleOverlays() {
  return (
    <>
      <TopCluster />
      <WaveBanner />
      <GateBanner />
      <ChainCounter />
      <BottomStack />
    </>
  );
}

// ---------------------------------------------------------------------------
// Top: the boss bar or the mode status, then army command and status, then the toast.
// ---------------------------------------------------------------------------

function TopCluster() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col gap-3 px-3 pt-3">
      <BossBar />
      <BossHint />
      <ModeHud />
      <ArmyRow />
      <Toasts />
    </div>
  );
}

/** Boss name in serif at the left, phase ticks at the right, a 4px crimson meter with a damage ghost. */
function BossBar() {
  const name = useHud((s) => s?.boss?.name ?? null);
  const phase = useHud((s) => s?.boss?.phase ?? 1);
  // Quantised to 0.1%: the meter moves smoothly without a render per frame.
  const frac = useHud((s) => (s?.boss ? Math.round((s.boss.hp / s.boss.maxHp) * 1000) / 1000 : 0));
  return (
    <AnimatePresence>
      {name && (
        <motion.div className="px-1" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.32, ease: EASE_OUT }} data-testid="boss-bar">
          <div className="flex items-end justify-between gap-3 mb-2">
            <span className="font-serif text-[20px] leading-[22px] text-t1 truncate legible">{name}</span>
            <span className="flex items-center gap-1.5 shrink-0 pb-1 t-caption text-t1 legible" aria-label={`Phase ${phase}`}>
              Phase {phase}
              {Array.from({ length: Math.max(2, phase) }, (_, i) => (
                <span key={i} className={cn("lozenge", i < phase ? "!bg-crimson" : "!bg-white/30")} />
              ))}
            </span>
          </div>
          <div className="rounded-full bg-black/50 p-px">
            <Meter value={frac} height={6} color="var(--color-crimson)" ghost label="Boss health" />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Under the boss bar: Retreat at the left (far from the ultimate), and the counter hint on a
 * scrimmed band that never sits over the fight, fading after four seconds.
 */
function BossHint() {
  const defId = useHud((s) => s?.boss?.defId ?? null);
  const counter = defId ? ENEMIES[defId]?.counter : undefined;
  const [shownFor, setShownFor] = useState<string | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);
  if (defId !== lastId) {
    setLastId(defId);
    setShownFor(defId);
  }
  useEffect(() => {
    if (!shownFor) return;
    const t = setTimeout(() => setShownFor(null), 4000);
    return () => clearTimeout(t);
  }, [shownFor]);
  if (!defId) return null;
  return (
    <div className="flex flex-col items-start gap-2 min-w-0">
      <Retreat />
      <AnimatePresence>
        {shownFor && counter && (
          <motion.p key={shownFor} className="glass max-w-full rounded-[14px] px-3 py-2 t-flavour text-t1" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.32, ease: EASE_OUT }} data-testid="boss-counter">
            {counter}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Outside the campaign and boss fights: which mode this is, how it is going, and a way out. */
function ModeHud() {
  const c = useController();
  const mode = useHud((s) => s?.mode ?? "campaign");
  const timeLeft = useHud((s) => (s?.timeLeft === null || s?.timeLeft === undefined ? null : Math.ceil(s.timeLeft)));
  const wave = useHud((s) => s?.wave ?? 0);
  const total = useHud((s) => s?.wavesTotal ?? 0);
  const tyrantScore = useHud((s) => (s?.tyrantScore === null || s?.tyrantScore === undefined ? null : Math.round(s.tyrantScore * 100) / 100));
  if (mode === "campaign" || mode === "boss" || mode === "hunt") return null;
  const status = timeLeft !== null ? `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, "0")}` : mode === "endless" ? `Wave ${Math.max(1, wave)}` : total ? `Wave ${Math.max(1, wave)} of ${total}` : "";
  return (
    <div className="pointer-events-auto self-center flex items-center gap-3 rounded-full glass h-11 pl-4 pr-1 max-w-full" data-testid="mode-hud">
      <span className="t-label text-t1 whitespace-nowrap truncate">{MODES[mode].name}</span>
      {status && <span className={cn("t-num-m whitespace-nowrap", timeLeft !== null && timeLeft < 10 ? "text-crimson" : "text-t2")}>{status}</span>}
      {tyrantScore !== null && (
        <span className="t-num-m text-gold whitespace-nowrap" data-testid="tyrant-score">
          {tyrantScore.toFixed(2)} bars
        </span>
      )}
      <button className="press h-11 px-3 rounded-full t-label text-t2" onClick={() => c.returnToCampaign()} data-testid="mode-leave" aria-label="Leave this mode">
        Leave
      </button>
    </div>
  );
}

const COMMANDS: { id: SummonCommand; label: string }[] = [
  { id: "follow", label: "Follow" },
  { id: "aggressive", label: "Attack" },
  { id: "guard", label: "Guard" },
];

/** Top-left: the army command. Top-right: the army itself, as discs with a jade health ring. */
function ArmyRow() {
  const c = useController();
  // A string key, health in 2% steps: the row re-renders when something visible changes, not every frame.
  const key = useHud((s) => (s?.summons ?? EMPTY_SUMMONS).map((x) => `${x.id}:${x.defId}:${x.alive ? Math.round((x.hp / x.maxHp) * 50) : -1}`).join(","));
  const command = useProfile((p) => p.summons.command);
  if (!key) return null;
  const summons = key.split(",").map((part) => {
    const [id, defId, hp] = part.split(":");
    return { id: id!, defId: defId!, hp: Number(hp) };
  });
  return (
    <div className="flex items-start justify-between gap-2 min-w-0">
      <div className="pointer-events-auto min-w-0">
        <Segmented
          tone="glass"
          label="Army command"
          value={command}
          onChange={(id) => c.setCommand(id)}
        >
          {COMMANDS.map((cmd) => (
            <Segment key={cmd.id} id={cmd.id} aria-label={cmd.label} data-guide={`command-${cmd.id}`} data-testid={`command-${cmd.id}`}>
              {cmd.label}
            </Segment>
          ))}
        </Segmented>
      </div>
      <div className="flex gap-2 shrink-0 pt-[3px]" data-testid="summon-strip">
        {summons.map((s) => (
          <ArmyDisc key={s.id} defId={s.defId} hp={Math.max(0, s.hp) / 50} alive={s.hp >= 0} />
        ))}
      </div>
    </div>
  );
}

/** A plain disc: the shadow's role as a glyph inside a jade health ring (grey and 50% when down). */
function ArmyDisc({ defId, hp, alive }: { defId: string; hp: number; alive: boolean }) {
  const r = 14.25;
  const len = 2 * Math.PI * r;
  const def = SUMMONS[defId];
  const glyph = def ? ROLE_GLYPH[def.role] : undefined;
  return (
    <span className={cn("relative flex h-[30px] w-[30px] items-center justify-center rounded-full glass-flat transition-opacity duration-200", !alive && "opacity-50")} title={def?.name} aria-label={`${def?.name ?? "Shadow"}${alive ? `, ${Math.round(hp * 100)}% health` : ", down"}`}>
      {glyph ? <Icon name={glyph} size={14} className={alive ? "text-t1" : "text-t2"} /> : <span className="t-caption text-t1">{(def?.name ?? "?").charAt(0)}</span>}
      <svg className="absolute inset-0 -rotate-90" width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
        <circle cx="15" cy="15" r={r} fill="none" stroke="rgba(255,255,255,0.13)" strokeWidth="1.5" />
        {alive && <circle cx="15" cy="15" r={r} fill="none" stroke="var(--color-jade)" strokeWidth="1.5" strokeDasharray={len} strokeDashoffset={len * (1 - Math.max(0, Math.min(1, hp)))} strokeLinecap="round" />}
      </svg>
    </span>
  );
}

/** One glyph per role, from the interface's own stroke set. */
const ROLE_GLYPH: Partial<Record<SummonRole, IconName>> = { vanguard: "shield", reaper: "sword", ranger: "arc", arcanist: "nova", sentinel: "guard", caller: "summons", support: "regen", sovereign: "star" };

const TOAST_DOT: Record<string, string> = { info: "bg-t2", gold: "bg-gold", essence: "bg-jade", warn: "bg-crimson", level: "bg-gold" };

/** One line of glass under the top controls; the tone is a 6px dot, not a coloured box. */
function Toasts() {
  const toasts = useUi((u) => u.toasts);
  return (
    <div className="flex flex-col items-center gap-2 min-w-0" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className="glass flex max-w-full items-center gap-2 rounded-full px-4 py-2"
          >
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TOAST_DOT[t.tone] ?? "bg-t2")} aria-hidden="true" />
            <span className="t-label text-t1 truncate">{t.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Banners: a stage, a region, a boss name. Serif, centred in the top third, brief.
// ---------------------------------------------------------------------------

function WaveBanner() {
  const phase = useHud((s) => s?.phase ?? "intro");
  const wave = useHud((s) => s?.wave ?? 0);
  const stage = useHud((s) => s?.stage ?? 1);
  const mode = useHud((s) => s?.mode ?? "campaign");
  const liveBoss = useHud((s) => s?.boss?.defId ?? null);
  const farming = useHud((s) => s?.farming ?? false);
  const total = useHud((s) => s?.wavesTotal ?? 3);
  const bossDef = ENEMIES[liveBoss ?? bossForStage(stage, mode)];
  // Farming moves stages in place: announce the new stage, and the region when it changes.
  const [flash, setFlash] = useState<{ stage: number; region: string | null } | null>(null);
  const [lastStage, setLastStage] = useState(stage);
  if (stage !== lastStage) {
    const before = regionForStage(lastStage).name;
    const now = regionForStage(stage).name;
    const depth = depthLabel(stage);
    setLastStage(stage);
    setFlash({ stage, region: now !== before ? now : depth && depth !== depthLabel(lastStage) ? `${now} · ${depth}` : null });
  }
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1200);
    return () => clearTimeout(t);
  }, [flash]);

  let title: string | null = null;
  let sub: string | null = null;
  let quiet: string | null = null;
  if (phase === "boss_intro") {
    title = bossDef?.name ?? "The Warden";
  } else if (phase === "intro") {
    title = mode === "boss" ? "The challenge" : `Stage ${stage}`;
    if (mode === "campaign") sub = regionForStage(stage).name;
  } else if (flash && farming) {
    title = `Stage ${flash.stage}`;
    sub = flash.region;
  } else if (phase === "between" && !(farming && wave >= total)) {
    quiet = "Wave cleared";
  }
  const key = title ?? quiet;
  return (
    <AnimatePresence>
      {key && (
        <motion.div key={key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.32, ease: EASE_OUT }} className="pointer-events-none absolute inset-x-0 top-[24%] z-10 flex flex-col items-center px-6 text-center">
          {title ? <span className="t-display text-t1 legible">{title}</span> : <span className="t-eyebrow text-t2 legible">{quiet}</span>}
          {sub && <span className="t-flavour text-t2 mt-1 legible">{sub}</span>}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The milestone moment when a boss gate opens. Brief, then the gate button carries it. */
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
        <motion.div key={shown} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.48, ease: EASE_OUT }} className="pointer-events-none absolute inset-x-0 top-[22%] z-20 flex flex-col items-center px-6 text-center" data-testid="gate-banner">
          <span className="t-eyebrow text-crimson legible">Boss · Stage {shown}</span>
          <span className="t-display text-t1 mt-2 legible">{name} awaits</span>
          <span className="t-label text-t2 mt-2 legible">Keep farming. Fight when you choose.</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The kill chain: a quiet number that turns gold once it is worth protecting. */
function ChainCounter() {
  const chain = useHud((s) => s?.chain ?? 0);
  if (chain < 3) return null;
  const hot = chain >= 10;
  return (
    <div className="pointer-events-none absolute left-4 top-[44%] z-10 flex flex-col items-start" data-testid="chain">
      <motion.span key={chain} initial={{ opacity: 0.6, y: -3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className={cn("t-num-xl legible", hot ? "text-gold" : "text-t1")}>
        {chain}
      </motion.span>
      <span className="t-caption text-t2 legible">Chain</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bottom-left, above the abilities: BIND, chips, then the boss gate or the quest.
// ---------------------------------------------------------------------------

function BottomStack() {
  const gate = useProfile((p) => p.progress.bossGate);
  const questDone = useProfile((p) => {
    const q = currentQuest(p);
    return !!q && isQuestComplete(p, q);
  });
  const farming = useHud((s) => s?.farming ?? false);
  const mode = useHud((s) => s?.mode ?? "campaign");
  const modal = useUi((u) => u.modal);
  const gateUp = !!gate && farming && !(modal && isBattlefieldModal(modal.kind));
  // In a boss fight the quest would sit where the boss stands: it waits until the fight is over.
  const fighting = mode === "boss" || mode === "hunt";
  const rise = useSheetRise();
  return (
    <motion.div className="pointer-events-none absolute inset-x-0 bottom-[calc(var(--panel-overlap)+80px)] z-20 flex flex-col items-start gap-2 px-4" style={{ y: rise }}>
      <BindPill />
      <div className="flex flex-wrap items-center gap-2 empty:hidden">
        <PerkChip />
        <PushChip />
      </div>
      {/* The boss gate is the anchor. A finished quest becomes one gold pill on its row, and wraps
          above it (never over it) when the row is too narrow. */}
      {gateUp ? (
        <div className="flex max-w-full flex-wrap-reverse items-center gap-2">
          <AnimatePresence initial={false}>
            <BossGate key={gate} gate={gate} compact={questDone} />
          </AnimatePresence>
          {questDone && <QuestLine />}
        </div>
      ) : (
        !fighting && <QuestLine />
      )}
    </motion.div>
  );
}

const RARITY_RANK = Object.fromEntries(RARITY_ORDER.map((r, i) => [r, i])) as Record<string, number>;

/**
 * BIND: a centred glass pill, fixed in place above the abilities. It no longer follows the orb
 * (the camera moves now; the orb is marked in the scene). Several orbs: it addresses the rarest.
 */
function BindPill() {
  const orbs = useHud((s) => s?.orbs ?? EMPTY_ORBS);
  if (orbs.length === 0) return null;
  let best = orbs[0]!;
  const score = (o: WorldSnapshot["orbs"][number]) => (o.isBoss ? 100 : 0) + (o.elite ? 50 : 0) + (RARITY_RANK[SUMMONS[o.summonId]?.rarity ?? "common"] ?? 0);
  for (const o of orbs) if (score(o) > score(best)) best = o;
  return <BindPillBody orb={best} extra={orbs.length - 1} />;
}

function BindPillBody({ orb, extra }: { orb: WorldSnapshot["orbs"][number]; extra: number }) {
  const c = useController();
  const profile = useProfileRef();
  const def = SUMMONS[orb.summonId];
  const bonus = computeModifiers(profile).extractionBonus;
  const chance = !profile.summons.firstSummonSeen ? 1 : extractionChance(profile, orb.summonId, { elite: orb.elite, bonus });
  const pct = Math.round(chance * 100);
  const frac = Math.max(0, Math.min(1, orb.remaining / orb.total));
  const special = orb.isBoss || orb.elite;
  const r = 7;
  const len = 2 * Math.PI * r;
  return (
    <motion.button
      key={orb.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE_OUT }}
      className="press pointer-events-auto self-center glass flex h-11 items-center gap-2 rounded-full pl-3 pr-4"
      onClick={() => c.claimEssence(orb.id)}
      data-guide="claim-essence"
      data-testid="claim-essence"
      aria-label={`Bind ${def?.name ?? "foe"}, ${pct} percent`}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" className="-rotate-90 shrink-0" aria-hidden="true">
        <circle cx="9" cy="9" r={r} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="1.5" />
        <circle cx="9" cy="9" r={r} fill="none" stroke={special ? "var(--color-gold)" : "var(--color-t1)"} strokeWidth="1.5" strokeDasharray={len} strokeDashoffset={len * (1 - frac)} strokeLinecap="round" />
      </svg>
      <span className={cn("text-[14px] leading-[18px] font-semibold tracking-[0.09em]", special ? "text-gold" : "text-t1")}>BIND</span>
      <span className="t-num-m text-t2">· {pct}%</span>
      {orb.isBoss && (
        <span className="flex gap-1" aria-label={`${orb.attempts} attempts left`}>
          {Array.from({ length: 3 }, (_, k) => (
            <span key={k} className={cn("h-1.5 w-1.5 rotate-45 rounded-[1px]", k < orb.attempts ? "bg-gold" : "bg-white/20")} />
          ))}
        </span>
      )}
      {extra > 0 && <span className="t-num-m text-t3">+{extra}</span>}
    </motion.button>
  );
}

function PerkChip() {
  const c = useController();
  const pending = useProfile((p) => p.player.pendingPerkChoices);
  const modal = useUi((u) => u.modal);
  if (pending <= 0 || modal) return null;
  return (
    <Button size="sm" variant="quiet" className="pointer-events-auto rounded-full !bg-[var(--glass)] backdrop-blur-[14px] text-t1" onClick={() => c.openPerkChoice()} data-testid="perk-chip" aria-label="Choose a perk" leading={<span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />}>
      Choose a perk{pending > 1 ? ` ×${pending}` : ""}
    </Button>
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
  // Hidden while the warrior is down: the fall beat decides where farming goes first.
  if (!farming || !alive || autoPush || stage >= frontier || (modal && isBattlefieldModal(modal.kind))) return null;
  return (
    <Button size="sm" variant="quiet" className="pointer-events-auto rounded-full !bg-[var(--glass)] backdrop-blur-[14px]" onClick={() => c.pushStage()} data-testid="push-stage" aria-label={`Holding at stage ${stage}. Push to stage ${stage + 1}`}>
      Push to stage {stage + 1}
    </Button>
  );
}

/** In a boss fight or a hunt, the only way out is a quiet one. The boss keeps waiting. */
function Retreat() {
  const c = useController();
  const mode = useHud((s) => s?.mode ?? "campaign");
  if (mode !== "boss" && mode !== "hunt") return null;
  return (
    <button className="press pointer-events-auto flex h-11 items-center rounded-full glass-flat px-4 t-label text-t2" onClick={() => c.returnToCampaign()} data-testid="mode-leave" aria-label="Retreat to farming; the boss keeps waiting">
      Retreat
    </button>
  );
}

/**
 * BOSS. Appears once a boss gate is reached and stays while farming continues.
 * Pressing it opens the readiness sheet; the fight itself starts only from FIGHT there.
 */
function BossGate({ gate, compact = false }: { gate: number; compact?: boolean }) {
  const c = useController();
  const fc = useStore(c.forecastStore, (s) => s);
  const bossId = bossForStage(gate);
  const name = ENEMIES[bossId]?.name ?? "The Warden";
  const tier = fc?.stage === gate ? fc.forecast?.tier : undefined;
  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.32, ease: EASE_OUT }}
      className="press pointer-events-auto relative flex h-[52px] max-w-full items-center gap-3 rounded-[14px] bg-[#2a1013] pl-2 pr-4 text-t1"
      onClick={() => c.openBossChallenge()}
      data-guide="boss-challenge"
      data-testid="boss-challenge"
      aria-label={`Boss challenge: ${name}, stage ${gate}${tier ? `, readiness ${TIER_LABEL[tier]}` : ""}`}
    >
      {/* A crimson rim on a dark crimson-black surface, breathing slowly: a threat, not an alert. */}
      <span className="breathe pointer-events-none absolute inset-0 rounded-[14px] shadow-[inset_0_0_0_1.5px_var(--color-crimson)]" aria-hidden="true" />
      <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-bg-2">
        <SummonPortrait defId={bossId} size={36} enemy round />
      </span>
      <span className="flex min-w-0 flex-col items-start text-left">
        <span className="t-caption text-[#e58a92]">Challenge · stage {gate}</span>
        <span className="truncate font-serif text-[18px] leading-[20px] text-t1">{name}</span>
      </span>
      {tier && !compact && <span className="ml-1 shrink-0 t-label text-t2">{TIER_LABEL[tier]}</span>}
    </motion.button>
  );
}

/** Where an unfinished objective is worked on: tapping the line takes you there. */
const QUEST_PANEL: Partial<Record<QuestGoal["kind"], PanelId>> = { statLevel: "hero", playerLevel: "hero", skills: "skills", deployed: "summons", collection: "summons", evolutions: "summons", equipped: "gear", stage: "rift" };

/** The quest as one line of text with a 44px progress tick; complete, it becomes "Claim 40". */
function QuestLine() {
  const c = useController();
  const profile = useProfileRef();
  const guide = useUi((u) => u.guide);
  const quest = currentQuest(profile);
  if (!quest) return null;
  const prog = questProgress(profile, quest);
  const done = isQuestComplete(profile, quest);
  const reward = quest.reward;
  const panel = QUEST_PANEL[quest.goal.kind];
  const kind: CurrencyKind = reward.gold ? "gold" : reward.essence ? "essence" : "core";
  const amount = reward.gold ?? reward.essence ?? reward.riftCores ?? 0;
  // A guide label may share this corner: step aside while it teaches, unless it points at us.
  const hidden = !!guide && guide.target !== "quest-claim";
  const frac = Math.min(1, prog.target > 0 ? prog.value / prog.target : 0);
  return (
    <div className={cn("transition-opacity duration-200", hidden ? "opacity-0 [&_*]:!pointer-events-none" : "opacity-100")} data-testid="quest-banner">
      {done ? (
        <Button size="sm" variant="primary" className="pointer-events-auto px-3" onClick={() => c.claimQuest()} data-guide="quest-claim" aria-label={`Claim quest reward: ${fmt(amount)}`} leading={<CurrencyGlyph kind={kind} className={kind === "gold" ? "!bg-gold-ink" : undefined} />}>
          Claim {fmt(amount)}
        </Button>
      ) : (
        <button className="pointer-events-auto flex h-11 max-w-full items-center gap-2 legible" onClick={() => panel && c.setPanel(panel)} aria-label={panel ? `Current objective: ${quest.text}. Open ${panel === "summons" ? "army" : panel}` : `Current objective: ${quest.text}`}>
          <span className="t-label text-t1 truncate">{quest.text}</span>
          <span className="t-label text-t2 tnum shrink-0">
            {fmt(prog.value)} of {fmt(prog.target)}
          </span>
          <span className="relative h-[2px] w-11 shrink-0 overflow-hidden rounded-full bg-white/20" aria-hidden="true">
            <span className="absolute inset-0 origin-left rounded-full bg-t1" style={{ transform: `scaleX(${frac})`, transition: "transform 200ms var(--ease)" }} />
          </span>
        </button>
      )}
    </div>
  );
}
