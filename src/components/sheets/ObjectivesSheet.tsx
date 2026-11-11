"use client";

import { Button } from "@/components/ui/Button";
import { CurrencyGlyph } from "@/components/ui/Currency";
import { Meter } from "@/components/ui/Meter";
import { Sheet, SheetHeader } from "@/components/ui/Sheet";
import { useController, useProfileRef } from "@/hooks/useGame";
import type { Profile } from "@/game/progression/profile";
import { DAILY_BONUS, objectiveDef, objectivePayout } from "@/game/progression/objectives";
import { cn } from "@/lib/cn";
import { fmt } from "@/lib/format";

type Slot = Profile["objectives"]["daily"][number];

/** Daily and weekly objectives as rows: the task, its progress line, the payout, Claim when done. */
export function ObjectivesSheet({ open }: { open: boolean }) {
  const c = useController();
  const profile = useProfileRef();
  const o = profile.objectives;
  const allDaily = o.daily.length > 0 && o.daily.every((s) => s.claimed);
  return (
    <Sheet open={open} onDismiss={() => c.closeModal()} testId="modal-objectives" labelledBy="objectives-title">
      <div data-testid="objectives">
        <SheetHeader id="objectives-title" title="Objectives" subtitle="Optional. Missing a day costs nothing." />
        <div className="t-eyebrow text-t2 mt-5">Today</div>
        <div className="-mx-5 mt-1">{o.daily.map((st) => <ObjectiveRow key={st.id} st={st} profile={profile} />)}</div>
        <p className={cn("t-label mt-3", allDaily ? "text-jade" : "text-t2")}>{allDaily ? `All three done: +${DAILY_BONUS.cores} Rift Core received` : `Finish all three today for +${DAILY_BONUS.cores} Rift Core`}</p>
        <div className="t-label text-t2 mt-5">This week</div>
        <div className="-mx-5 mt-1">{o.weekly.map((st) => <ObjectiveRow key={st.id} st={st} profile={profile} />)}</div>
        <Button variant="plain" block className="mt-3" onClick={() => c.closeModal()} data-testid="objectives-close">
          Close
        </Button>
      </div>
    </Sheet>
  );
}

function ObjectiveRow({ st, profile }: { st: Slot; profile: Profile }) {
  const c = useController();
  const def = objectiveDef(st.id);
  if (!def) return null;
  const pay = objectivePayout(profile, def);
  const done = st.progress >= def.target;
  const ready = done && !st.claimed;
  return (
    <div className={cn("flex min-h-[64px] items-center gap-3 px-5 py-2 shadow-[inset_0_-1px_0_var(--line)]", st.claimed && "opacity-60")} data-testid={`objective-${st.id}`}>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="t-body text-t1 truncate">{def.text}</span>
        <span className="flex items-center gap-3">
          <Meter value={st.progress / def.target} color={done ? "var(--color-gold)" : undefined} className="flex-1" />
          <span className="t-label text-t2 tnum shrink-0">
            {fmt(Math.min(st.progress, def.target))} of {fmt(def.target)}
          </span>
        </span>
      </div>
      <button className="press -my-1 flex h-11 shrink-0 items-center rounded-full disabled:opacity-100" disabled={!ready} onClick={() => c.claimObjective(st.id)} data-testid={`claim-${st.id}`} aria-label={st.claimed ? "Claimed" : ready ? "Claim" : "Not finished yet"}>
        <span className={cn("inline-flex h-8 items-center gap-2 rounded-full px-3 t-num-m", ready ? "bg-[var(--tint-gold)] text-gold" : "text-t2")}>
          {st.claimed ? (
            "Done"
          ) : (
            <>
              {pay.gold > 0 && (
                <span className="flex items-center gap-1.5">
                  <CurrencyGlyph kind="gold" size={6} />
                  {fmt(pay.gold)}
                </span>
              )}
              {pay.essence > 0 && (
                <span className="flex items-center gap-1.5">
                  <CurrencyGlyph kind="essence" size={6} />
                  {pay.essence}
                </span>
              )}
              {pay.cores > 0 && (
                <span className="flex items-center gap-1.5">
                  <CurrencyGlyph kind="core" size={6} />
                  {pay.cores}
                </span>
              )}
            </>
          )}
        </span>
      </button>
    </div>
  );
}
