"use client";

import { Button } from "@/components/ui/Button";
import { Row } from "@/components/ui/Row";
import { Sheet, SheetHeader } from "@/components/ui/Sheet";
import { SummonPortrait } from "@/components/ui/Portrait";
import { useController, useProfileRef } from "@/hooks/useGame";
import { ENEMIES } from "@/game/data/enemies";
import { bossForStage, isBossStage } from "@/game/data/regions";
import { huntableStages } from "@/game/data/modes";

/** Boss Hunt: every boss already beaten, as rows. */
export function HuntSheet({ open }: { open: boolean }) {
  const c = useController();
  const profile = useProfileRef();
  const stages = huntableStages(profile.progress.bestStage, isBossStage);
  const keys = profile.modes.keys.hunt;
  return (
    <Sheet open={open} onDismiss={() => c.closeModal()} testId="modal-hunt_pick" labelledBy="hunt-title">
      <div data-testid="hunt-pick">
        <div className="flex items-start justify-between gap-3">
          <SheetHeader id="hunt-title" title="Boss Hunt" subtitle="Half the stage reward, boss gear, a chance at a Rift Core and another chance to bind its shadow. Progress is never at stake." />
          <span className="t-num-m text-t1 shrink-0 pt-0.5">{keys} of 3 today</span>
        </div>
        <div className="-mx-5 mt-4 shadow-[inset_0_1px_0_var(--line)]">
          {stages.map((s) => {
            const id = bossForStage(s);
            return (
              <Row
                key={s}
                className="px-5"
                gutter={false}
                leading={
                  <span className="h-8 w-8 overflow-hidden rounded-full bg-bg-2">
                    <SummonPortrait defId={id} size={32} enemy round />
                  </span>
                }
                title={ENEMIES[id]?.name ?? "Boss"}
                detail={`Stage ${s}`}
                trailing={<span className="t-label text-threat">Hunt</span>}
                disabled={keys <= 0}
                onClick={() => c.startHunt(s)}
                data-testid={`hunt-${s}`}
              />
            );
          })}
        </div>
        <Button variant="plain" block className="mt-3" onClick={() => c.closeModal()} data-testid="hunt-close">
          Close
        </Button>
      </div>
    </Sheet>
  );
}
