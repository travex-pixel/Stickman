"use client";

import { Button } from "@/components/ui/Button";
import { Row } from "@/components/ui/Row";
import { Sheet } from "@/components/ui/Sheet";
import { useController, useProfileRef } from "@/hooks/useGame";
import { ENEMIES } from "@/game/data/enemies";
import { TWISTS } from "@/game/data/depths";
import { TYRANT_DAILY_TRIES, fmtBars, msUntilNextWeek, tierReward, tyrantForWeek, tyrantStage } from "@/game/progression/tyrant";
import { TierTrack } from "./ModeResultSheet";

/** The weekly Rift Tyrant: who it is, how it changes, what each tier pays, and the tries left. */
export function TyrantSheet({ open }: { open: boolean }) {
  const c = useController();
  const profile = useProfileRef();
  const now = new Date();
  const week = tyrantForWeek(now);
  const def = ENEMIES[week.bossId];
  const twist = TWISTS[week.twist];
  const stage = tyrantStage(profile);
  const same = profile.tyrant.week === week.week;
  const claimed = same ? profile.tyrant.claimed : 0;
  const best = same ? profile.tyrant.best : 0;
  const keys = profile.modes.keys.tyrant;
  const avail = c.modeAvailability("tyrant");
  const days = Math.max(1, Math.ceil(msUntilNextWeek(now) / 86_400_000));
  return (
    <Sheet open={open} onDismiss={() => c.closeModal()} testId="modal-tyrant" labelledBy="tyrant-title">
      <div data-testid="tyrant-sheet">
        <span className="t-eyebrow text-threat">
          Rift Tyrant · {days} day{days === 1 ? "" : "s"} left
        </span>
        <h2 id="tyrant-title" className="t-display text-t1 mt-1.5">
          {def?.name ?? "The Tyrant"}
        </h2>
        <p className="t-body text-t2 mt-2">One minute at stage {stage}, your deepest. It cannot fall: each time its bar breaks it rises again, harder-hitting. Each tier pays once a week.</p>
        <div className="-mx-5 mt-3">
          <Row className="px-5" gutter={false} title={twist.name} detail={<span className="whitespace-normal">{twist.blurb}</span>} />
        </div>
        <TierTrack
          claimed={claimed}
          testId="tyrant-tiers"
          caption={(i) => {
            if (i < claimed) return "Won";
            const r = tierReward(stage, i);
            return r.gear ? "Gear" : r.cores ? `${r.cores} core${r.cores > 1 ? "s" : ""}` : "Gold";
          }}
        />
        <p className="t-label text-t2 mt-4">
          Week best <span className="text-t1 tnum">{fmtBars(best)}</span> bars · all-time {fmtBars(profile.tyrant.allTimeBest)} · {keys} of {TYRANT_DAILY_TRIES} tries today
        </p>
        <div className="mt-5 flex items-center gap-3">
          <Button variant="plain" className="shrink-0 px-4" onClick={() => c.closeModal()} data-testid="tyrant-close">
            Close
          </Button>
          <Button variant="threat" className="flex-1" disabled={!avail.ok} onClick={() => c.startMode("tyrant")} data-testid="tyrant-fight">
            {avail.ok ? "Face the Tyrant" : avail.reason}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
