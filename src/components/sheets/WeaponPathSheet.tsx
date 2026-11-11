"use client";

import { Button } from "@/components/ui/Button";
import { Sheet, SheetHeader } from "@/components/ui/Sheet";
import { useController } from "@/hooks/useGame";
import { WEAPON_PATHS } from "@/game/progression/weaponPaths";

/** Weapon awakening: three large rows, one choice for good. */
export function WeaponPathSheet({ open }: { open: boolean }) {
  const c = useController();
  return (
    <Sheet open={open} onDismiss={() => c.closeModal()} testId="modal-weapon_path" labelledBy="path-title">
      <SheetHeader id="path-title" eyebrow="Weapon awakening" tone="gold" title="Choose your path" subtitle="It changes how your blade fights, and cannot be undone." serif />
      <div className="-mx-5 mt-4 shadow-[inset_0_1px_0_var(--line)]">
        {WEAPON_PATHS.map((w) => (
          <button key={w.id} className="press-fill flex w-full min-h-[76px] items-center gap-4 px-5 py-3 text-left shadow-[inset_0_-1px_0_var(--line)]" onClick={() => c.chooseWeaponPath(w.id)} data-testid={`path-${w.id}`}>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: w.color }} aria-hidden="true" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="t-button text-t1">
                {w.name} <span className="t-label text-t2">· {w.tagline}</span>
              </span>
              <span className="t-body text-t2 mt-0.5">{w.description}</span>
            </span>
          </button>
        ))}
      </div>
      <Button variant="plain" block className="mt-3" onClick={() => c.closeModal()}>
        Not yet
      </Button>
    </Sheet>
  );
}
