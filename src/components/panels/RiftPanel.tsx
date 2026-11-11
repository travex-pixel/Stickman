"use client";

import { useState } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Segment, Segmented } from "@/components/ui/Segmented";
import { useController, useHud, useProfileRef } from "@/hooks/useGame";
import { regionForStage } from "@/game/data/regions";
import { TWISTS, depthLabel, twistForStage } from "@/game/data/depths";
import { ENEMIES } from "@/game/data/enemies";
import { TYRANT_TIERS, fmtBars, tyrantForWeek } from "@/game/progression/tyrant";
import { JOURNAL } from "@/game/data/lore";
import { MODES, cryptSlot, isKeyedMode, type ModeId } from "@/game/data/modes";
import { SLOT_LABEL } from "@/game/data/equipment";
import { nextRankStep, rankLetter } from "@/game/progression/ranks";
import type { Profile } from "@/game/progression/profile";
import { cn } from "@/lib/cn";
import { useShortScreen } from "@/hooks/useShortScreen";
import { claimableObjectives } from "@/game/progression/objectives";
import { usePanelDetent } from "@/hooks/usePanelDetent";

const MODE_ICON: Record<Exclude<ModeId, "campaign">, IconName> = { boss: "skull", hunt: "skull", vault: "coin", rift: "summons", crypt: "relic", endless: "level", trial: "star", tyrant: "skull" };
type ListedMode = Exclude<ModeId, "campaign" | "boss">;
const MODES_ORDER: ListedMode[] = ["tyrant", "trial", "hunt", "vault", "rift", "crypt", "endless"];
const BOSS_MODES: ListedMode[] = ["tyrant", "trial", "hunt"];
const RUN_MODES: ListedMode[] = ["vault", "rift", "crypt", "endless"];
type ShortView = "stages" | "bosses" | "runs";

/**
 * The journey: where you are on the campaign, and the trials that sit beside it. On a tall phone
 * everything is on one page; a short phone pages it (stages, bosses, runs) so each target keeps
 * its size instead of everything shrinking together.
 */
export default function RiftPanel() {
  const short = useShortScreen();
  const [view, setView] = useState<ShortView>("stages");
  const tall = usePanelDetent() === "tall";
  if (short) {
    return (
      <div className="flex flex-col h-full min-h-0 px-4 pt-3 pb-2 gap-3">
        <div className="flex items-center justify-between gap-2 shrink-0">
          <Segmented<ShortView>
            value={view}
            onChange={setView}
            label="Rift"
          >
            <Segment id="stages">Stages</Segment>
            <Segment id="bosses">Bosses</Segment>
            <Segment id="runs">Runs</Segment>
          </Segmented>
          <HeaderLinks compact />
        </div>
        {view === "stages" ? (
          <>
            <RegionTitle short />
            <StageStrip short />
          </>
        ) : (
          <ModeGrid modes={view === "bosses" ? BOSS_MODES : RUN_MODES} cols={view === "bosses" ? 1 : 2} />
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col h-full min-h-0 px-4 pt-4 pb-2 gap-3">
      <div className="flex items-start justify-between gap-3 shrink-0">
        <RegionTitle />
        <HeaderLinks />
      </div>
      <StageStrip />
      {tall ? <ModeRows /> : <ModeGrid modes={MODES_ORDER} cols={2} sortAvailable />}
    </div>
  );
}

/** The region in serif; under it the depth when past the first regions, else its subtitle. */
function RegionTitle({ short = false }: { short?: boolean }) {
  const profile = useProfileRef();
  const region = regionForStage(profile.progress.currentStage);
  const twist = twistForStage(profile.progress.currentStage);
  return (
    <div className="min-w-0 shrink-0">
      <div className="t-name text-t1 truncate">{region.name}</div>
      {twist ? (
        <div className="t-label text-t2 truncate mt-0.5" data-testid="depth-chip" title={`${TWISTS[twist].blurb} ${TWISTS[twist].counter}`}>
          <span className="text-t1">{depthLabel(profile.progress.currentStage)}</span> · {TWISTS[twist].blurb}
        </div>
      ) : (
        <div className={cn("t-flavour text-t2 truncate", short && "text-[14px] leading-[18px]")}>{region.subtitle}</div>
      )}
    </div>
  );
}

/** Goals and Journal: plain icon buttons with their counters. */
function HeaderLinks({ compact = false }: { compact?: boolean }) {
  const c = useController();
  const profile = useProfileRef();
  const claimable = claimableObjectives(profile);
  return (
    <div className="flex shrink-0 -mr-2">
      <button className="press relative flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-[10px] px-2 t-label text-t2" onClick={() => c.openObjectives()} data-testid="objectives-button" aria-label={`Goals${claimable ? `, ${claimable} ready to claim` : ""}`}>
        <Icon name="check" size={18} />
        {claimable > 0 ? <span className="tnum text-gold">{claimable}</span> : !compact && <span className="hidden min-[360px]:inline">Goals</span>}
      </button>
      <button className="press flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-[10px] px-2 t-label text-t2" onClick={() => c.openJournal()} data-testid="journal-button" aria-label={`Journal, ${profile.progress.journal.length} of ${JOURNAL.length}`}>
        <Icon name="book" size={18} />
        {!compact && (
          <span className="tnum">
            {profile.progress.journal.length}/{JOURNAL.length}
          </span>
        )}
      </button>
    </div>
  );
}

/** Five stages around the current one: number, then a tick or "new". The current one is filled. */
function StageStrip({ short = false }: { short?: boolean }) {
  const c = useController();
  const profile = useProfileRef();
  const stage = useHud((s) => s?.stage ?? profile.progress.currentStage);
  const mode = useHud((s) => s?.mode ?? "campaign");
  const maxStage = profile.progress.bestStage + 1;
  const first = Math.max(1, Math.min(maxStage, stage) - 2);
  const stages = Array.from({ length: 5 }, (_, i) => first + i).filter((s) => s <= maxStage);
  return (
    <div className={cn("flex gap-2 shrink-0", short && "mt-auto")}>
      {stages.map((s) => {
        const current = s === stage && mode === "campaign";
        const cleared = s <= profile.progress.bestStage;
        return (
          <button key={s} className={cn("press flex h-12 flex-1 flex-col items-center justify-center rounded-[14px]", current ? "bg-bg-3" : "bg-bg-2")} onClick={() => c.selectStage(s)} data-testid={`stage-${s}`} aria-label={`Stage ${s}${cleared ? ", cleared" : ", new"}${current ? ", current" : ""}`} aria-current={current ? "true" : undefined}>
            <span className={cn("t-num-m text-[15px]", current ? "text-t1" : "text-t2")}>{s}</span>
            {cleared ? <Icon name="check" size={11} className="text-t3" /> : <span className="t-caption text-gold leading-[11px]">new</span>}
          </button>
        );
      })}
    </div>
  );
}

function modeCopy(m: ListedMode, avail: { ok: boolean; reason?: string }, profile: Profile): { title: string; sub: string } {
  const def = MODES[m];
  const step = nextRankStep(profile);
  const title = m === "trial" ? (step ? `Rank Trial ${rankLetter(step.to - 1)} to ${rankLetter(step.to)}` : "Rank S") : def.name;
  if (!avail.ok) return { title, sub: m === "trial" && !step ? "Nothing above you" : (avail.reason ?? "Locked") };
  if (m === "tyrant") {
    const week = tyrantForWeek(new Date());
    const thisWeek = profile.tyrant.week === week.week;
    const best = thisWeek ? profile.tyrant.best : 0;
    return { title, sub: `${ENEMIES[week.bossId]?.name ?? "Tyrant"} · ${thisWeek ? profile.tyrant.claimed : 0}/${TYRANT_TIERS.length}${best > 0 ? ` · ${fmtBars(best)}` : ""}` };
  }
  if (m === "hunt") return { title, sub: "Rematch a fallen boss" };
  if (m === "trial") return { title, sub: "Your breakthrough awaits" };
  if (m === "endless" && profile.modes.endlessBest > 0) return { title, sub: `Best: wave ${profile.modes.endlessBest}` };
  if (m === "crypt") return { title, sub: `Today: ${SLOT_LABEL[cryptSlot()]} relics` };
  return { title, sub: def.tagline };
}

/** Modes as rows (glyph, name, one quiet status line, keys at the right), in one or two columns. */
function ModeGrid({ modes, cols, sortAvailable = false }: { modes: ListedMode[]; cols: 1 | 2; sortAvailable?: boolean }) {
  const c = useController();
  const profile = useProfileRef();
  const listed = modes.map((m) => ({ m, avail: c.modeAvailability(m) }));
  // What can be played now comes first; locked modes follow with their unlock rule.
  if (sortAvailable) listed.sort((a, b) => Number(b.avail.ok) - Number(a.avail.ok));
  return (
    <div className={cn("grid flex-1 min-h-0 -mx-4 shadow-[inset_0_1px_0_var(--line)]", cols === 2 ? "grid-cols-2" : "grid-cols-1")} style={{ gridAutoRows: "minmax(0, 1fr)" }}>
      {listed.map(({ m, avail }, i) => {
        const keys = isKeyedMode(m) ? profile.modes.keys[m] : null;
        const { title, sub } = modeCopy(m, avail, profile);
        return (
          <button
            key={m}
            className={cn(
              "press-fill relative flex min-h-0 min-w-0 items-center gap-3 px-4 text-left shadow-[inset_0_-1px_0_var(--line)]",
              cols === 2 && i % 2 === 0 && "after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-[var(--line)] after:content-['']",
            )}
            onClick={() => (m === "hunt" && avail.ok ? c.openHunts() : m === "tyrant" && avail.ok ? c.openTyrant() : c.startMode(m))}
            data-testid={`mode-${m}`}
            aria-label={`${title}${avail.ok ? "" : `, ${avail.reason}`}`}
          >
            <Icon name={avail.ok ? MODE_ICON[m] : "lock"} size={18} className={cn("shrink-0", avail.ok ? (m === "tyrant" ? "text-threat" : m === "trial" ? "text-gold" : "text-t2") : "text-t3")} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={cn("t-label truncate", avail.ok ? "text-t1" : "text-t2")}>{title}</span>
              <span className="t-caption text-t3 truncate">{sub}</span>
            </span>
            {keys !== null && avail.ok && (
              <span className="t-caption tnum text-t2 shrink-0">
                {keys}/{MODES[m].dailyKeys ?? 3}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** With the panel tall: every mode as a proper 52px row in one column (playable ones first). */
function ModeRows() {
  const c = useController();
  const profile = useProfileRef();
  const listed = MODES_ORDER.map((m) => ({ m, avail: c.modeAvailability(m) })).sort((a, b) => Number(b.avail.ok) - Number(a.avail.ok));
  return (
    <div className="-mx-4 min-h-0 flex-1 overflow-y-auto overscroll-contain shadow-[inset_0_1px_0_var(--line)]" style={{ touchAction: "pan-y" }} data-scroll>
      {listed.map(({ m, avail }) => {
        const keys = isKeyedMode(m) ? profile.modes.keys[m] : null;
        const { title, sub } = modeCopy(m, avail, profile);
        // Ready: playable now with a try left (or a trial waiting).
        const ready = avail.ok && (keys === null ? m === "trial" : keys > 0);
        return (
          <button
            key={m}
            className="press-fill flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left shadow-[inset_0_-1px_0_var(--line)]"
            onClick={() => (m === "hunt" && avail.ok ? c.openHunts() : m === "tyrant" && avail.ok ? c.openTyrant() : c.startMode(m))}
            data-testid={`mode-${m}`}
            aria-label={`${title}${avail.ok ? "" : `, ${avail.reason}`}`}
          >
            <Icon name={avail.ok ? MODE_ICON[m] : "lock"} size={18} className={cn("shrink-0", avail.ok ? (m === "tyrant" ? "text-threat" : m === "trial" ? "text-gold" : "text-t2") : "text-t3")} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={cn("t-body flex items-center gap-2", avail.ok ? "text-t1" : "text-t2")}>
                {title}
                {ready && <span className="lozenge" aria-label="ready" />}
              </span>
              <span className="t-label text-t2">{sub}</span>
            </span>
            {keys !== null && avail.ok && (
              <span className={cn("t-num-m shrink-0", keys > 0 ? "text-gold" : "text-t2")}>
                {keys}/{MODES[m].dailyKeys ?? 3}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
