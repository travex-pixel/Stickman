"use client";

import { Button } from "@/components/ui/Button";
import { Meter } from "@/components/ui/Meter";
import { Sheet } from "@/components/ui/Sheet";
import { Stat } from "@/components/ui/Stat";
import { useController } from "@/hooks/useGame";
import type { Modal } from "@/game/GameController";
import { ENEMIES } from "@/game/data/enemies";
import { TipRows } from "./BossReadySheet";

/** A lost challenge: how close it was, three facts, the two best fixes. Farming has already resumed. */
export function BossDefeatSheet({ modal, open }: { modal: Extract<Modal, { kind: "boss_defeat" }>; open: boolean }) {
  const c = useController();
  const boss = ENEMIES[modal.defId];
  const left = Math.round(modal.bossHpLeft * 100);
  const name = boss?.name ?? "The Warden";
  return (
    <Sheet open={open} onDismiss={() => c.closeModal()} testId="modal-boss_defeat" labelledBy="boss-defeat-title">
      <div data-testid="boss-defeat">
        <span className="t-eyebrow text-crimson">Stage {modal.stage} · Not yet</span>
        <h2 id="boss-defeat-title" className="t-display text-t1 mt-1.5">
          {name} stands
        </h2>
        <div className="mt-5 flex items-baseline gap-2">
          <span className="t-num-serif-xl text-t1">{left}%</span>
          <span className="t-label text-t2">of its health left</span>
        </div>
        <Meter value={modal.bossHpLeft} color="var(--color-crimson)" className="mt-3" label="Boss health left" />
        <div className="mt-5 grid grid-cols-3 gap-3" data-testid="defeat-summary">
          <Stat label="Time" value={`${modal.seconds}s`} />
          <Stat label={modal.bossPhase > 1 ? "Phase reached" : "Abilities"} value={modal.bossPhase > 1 ? `${modal.bossPhase}` : `${modal.casts}`} />
          <Stat label="Dodges" value={`${modal.dodges}`} delta={modal.perfect ? `${modal.perfect} perfect` : undefined} />
        </div>
        <p className="t-label text-t2 mt-4">
          Back to farming stage {modal.farmStage}. Everything earned is kept{modal.summonsLost ? `; ${modal.summonsLost} shadow${modal.summonsLost > 1 ? "s" : ""} will rise again` : ""}. The boss waits until you choose to fight.
        </p>
        <TipRows tips={modal.tips} max={2} />
        <div className="mt-5 flex items-center gap-3">
          <Button variant="plain" className="shrink-0 px-4" onClick={() => c.closeModal()} data-testid="defeat-close">
            Keep farming
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            onClick={() => {
              c.closeModal();
              c.spendGoldNow();
            }}
            data-testid="defeat-upgrade"
          >
            Get stronger
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
