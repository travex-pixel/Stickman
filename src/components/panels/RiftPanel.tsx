"use client";

import { Icon, type IconName } from "@/components/ui/Icon";
import { useController, useHud, useProfileRef } from "@/hooks/useGame";
import { regionForStage } from "@/game/data/regions";
import { TWISTS, depthLabel, twistForStage } from "@/game/data/depths";
import { ENEMIES } from "@/game/data/enemies";
import { TYRANT_TIERS, fmtBars, tyrantForWeek } from "@/game/progression/tyrant";
import { JOURNAL } from "@/game/data/lore";
import { MODES, cryptSlot, isKeyedMode, type ModeId } from "@/game/data/modes";
import { SLOT_LABEL } from "@/game/data/equipment";
import { nextRankStep, rankLetter } from "@/game/progression/ranks";
import { cn } from "@/lib/cn";
import { useShortScreen } from "@/hooks/useShortScreen";
import { claimableObjectives } from "@/game/progression/objectives";

const MODE_ICON: Record<Exclude<ModeId, "campaign">, IconName> = { boss: "skull", hunt: "skull", vault: "coin", rift: "summons", crypt: "relic", endless: "level", trial: "star", tyrant: "skull" };

/** The journey: where you are on the campaign, and the trials that sit beside it. */
export default function RiftPanel() {
  const c = useController();
  const profile = useProfileRef();
  const stage = useHud((s) => s?.stage ?? profile.progress.currentStage);
  const mode = useHud((s) => s?.mode ?? "campaign");
  const region = regionForStage(profile.progress.currentStage);
  const twist = twistForStage(profile.progress.currentStage);
  const maxStage = profile.progress.bestStage + 1;
  const first = Math.max(1, Math.min(maxStage, stage) - 2);
  const stages = Array.from({ length: 5 }, (_, i) => first + i).filter((s) => s <= maxStage);
  const short = useShortScreen();
  const claimable = claimableObjectives(profile);
  const step = nextRankStep(profile);
  const modes: Exclude<ModeId, "campaign" | "boss">[] = ["tyrant", "trial", "hunt", "vault", "rift", "crypt", "endless"];
  const week = tyrantForWeek(new Date());
  const weekBest = profile.tyrant.week === week.week ? profile.tyrant.best : 0;
  const weekTiers = profile.tyrant.week === week.week ? profile.tyrant.claimed : 0;
  const today = cryptSlot();
  return (
    <div className="flex flex-col h-full min-h-0 px-2 pt-1.5 pb-1.5 gap-1.5">
      <div className="flex items-center justify-between leading-tight px-0.5">
        <div className="min-w-0">
          <div className="font-display text-[14px] text-ivory truncate">{region.name}</div>
          {twist ? (
            <div className="text-[10px] truncate font-semibold" style={{ color: hex(TWISTS[twist].tint) }} data-testid="depth-chip" title={`${TWISTS[twist].blurb} ${TWISTS[twist].counter}`}>
              {depthLabel(profile.progress.currentStage)} · {TWISTS[twist].blurb}
            </div>
          ) : (
            <div className="text-[10px] text-mist italic truncate">{region.subtitle}</div>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          <button className="btn-ghost relative !py-0 h-8 !px-2.5 text-[11px] flex items-center gap-1" onClick={() => c.openObjectives()} data-testid="objectives-button" aria-label={`Objectives${claimable ? `, ${claimable} ready to claim` : ""}`}>
            <Icon name="check" size={12} /> Goals
            {claimable > 0 && <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-gold-2 text-ink text-[9px] font-extrabold leading-4 text-center">{claimable}</span>}
          </button>
          <button className="btn-ghost !py-0 h-8 !px-2.5 text-[11px] flex items-center gap-1" onClick={() => c.openJournal()} data-testid="journal-button">
            <Icon name="book" size={12} /> {profile.progress.journal.length}/{JOURNAL.length}
          </button>
        </div>
      </div>
      <div className="flex gap-1">
        {stages.map((s) => (
          <button
            key={s}
            className={cn("flex-1 card text-center", short ? "h-8 flex items-center justify-center gap-1" : "py-1", s === stage && mode === "campaign" && "card-active")}
            onClick={() => c.selectStage(s)}
            data-testid={`stage-${s}`}
            aria-label={`Stage ${s}`}
          >
            {!short && <div className="caps !text-[10px]">Stage</div>}
            <div className="font-display text-[15px] text-ivory leading-none">{s}</div>
            <div className="h-3 flex items-center justify-center">{s <= profile.progress.bestStage ? <Icon name="check" size={10} className="text-jade-2" /> : <span className="text-[10px] text-gold">new</span>}</div>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 grid-rows-4 gap-1 flex-1 min-h-0">
        {modes.map((m) => {
          const def = MODES[m];
          const avail = c.modeAvailability(m);
          const keys = isKeyedMode(m) ? profile.modes.keys[m] : null;
          const title = m === "trial" ? (step ? `Rank Trial ${rankLetter(step.to - 1)} → ${rankLetter(step.to)}` : "Rank S") : def.name;
          const sub = m === "tyrant" && avail.ok ? `${ENEMIES[week.bossId]?.name ?? "Tyrant"} · ${TWISTS[week.twist].name} · ${weekTiers}/${TYRANT_TIERS.length} tiers${weekBest > 0 ? ` · best ${fmtBars(weekBest)}` : ""}` : m === "hunt" && avail.ok ? "Rematch a fallen boss" : m === "trial" ? (step ? (avail.ok ? "Your breakthrough awaits." : avail.reason) : "Nothing above you.") : m === "endless" && profile.modes.endlessBest > 0 ? `Best: wave ${profile.modes.endlessBest}` : m === "crypt" && avail.ok ? `Today: ${SLOT_LABEL[today]} relics from every elite.` : avail.ok ? def.tagline : avail.reason;
          return (
            <button
              key={m}
              className={cn("card text-left px-2 py-1 flex flex-col justify-center gap-0.5 min-h-0 overflow-hidden", m === "tyrant" && "col-span-2", avail.ok ? (m === "trial" ? "card-active" : m === "tyrant" ? "border-crimson/50 bg-crimson/[0.06]" : "") : "card-locked opacity-75")}
              onClick={() => (m === "hunt" && avail.ok ? c.openHunts() : m === "tyrant" && avail.ok ? c.openTyrant() : c.startMode(m))}
              data-testid={`mode-${m}`}
              aria-label={`${title}${avail.ok ? "" : `, ${avail.reason}`}`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className={cn("flex items-center gap-1.5 min-w-0", avail.ok ? "text-gold-2" : "text-mist")}>
                  <Icon name={avail.ok ? MODE_ICON[m] : "lock"} size={14} />
                  <span className="font-display text-[13px] text-ivory truncate">{title}</span>
                </span>
                {keys !== null && avail.ok && <span className="text-[10px] font-bold text-parch shrink-0">{keys}/{def.dailyKeys ?? 3}</span>}
              </div>
              <div className="text-[10px] text-mist leading-snug truncate">{sub}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}
