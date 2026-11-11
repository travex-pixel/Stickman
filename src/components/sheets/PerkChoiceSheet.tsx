"use client";

import { Button } from "@/components/ui/Button";
import { MomentGroup, MomentItem } from "@/components/ui/Moment";
import { Sheet, SheetHeader } from "@/components/ui/Sheet";
import { useController, useProfileRef } from "@/hooks/useGame";
import type { Modal } from "@/game/GameController";
import { cn } from "@/lib/cn";

const TONE: Record<string, string> = { power: "bg-gold", soul: "bg-jade" };

/** Three large rows, each a full-width press target: the name, the effect, the stacks owned. */
export function PerkChoiceSheet({ modal, open }: { modal: Extract<Modal, { kind: "perk_choice" }>; open: boolean }) {
  const c = useController();
  const profile = useProfileRef();
  const pending = profile.player.pendingPerkChoices;
  return (
    <Sheet open={open} testId="modal-perk_choice" labelledBy="perk-title" dismissible={false}>
      <SheetHeader id="perk-title" eyebrow={`Level ${profile.player.level}`} tone="gold" title="Choose one" subtitle="Perks are permanent." serif />
      <MomentGroup className="-mx-5 mt-4 shadow-[inset_0_1px_0_var(--line)]">
        {modal.perks.map((p) => {
          const stacks = profile.player.perks[p.id] ?? 0;
          return (
            <MomentItem key={p.id}>
              <button className="press-fill flex w-full min-h-[76px] items-center gap-4 px-5 py-3 text-left shadow-[inset_0_-1px_0_var(--line)]" onClick={() => c.takePerk(p.id)} data-testid={`perk-${p.id}`}>
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE[p.tone] ?? "bg-t2")} aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="t-button text-t1">{p.name}</span>
                  <span className="t-body text-t2 mt-0.5">{p.description}</span>
                </span>
                <span className="t-label text-t2 tnum shrink-0">
                  {stacks}/{p.maxStacks}
                </span>
              </button>
            </MomentItem>
          );
        })}
      </MomentGroup>
      {pending > 2 && (
        <Button variant="plain" block className="mt-3" onClick={() => c.autoPickPerks()} data-testid="perk-auto">
          Choose all {pending} for me
        </Button>
      )}
    </Sheet>
  );
}
