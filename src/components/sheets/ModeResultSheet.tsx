"use client";

import { motion } from "motion/react";
import { Button } from "@/components/ui/Button";
import { MomentGroup, MomentItem } from "@/components/ui/Moment";
import { Sheet } from "@/components/ui/Sheet";
import { useController } from "@/hooks/useGame";
import { useReducedEffects } from "@/hooks/useReducedEffects";
import type { Modal } from "@/game/GameController";
import { MODES, isKeyedMode } from "@/game/data/modes";
import { TYRANT_TIERS } from "@/game/progression/tyrant";
import { cn } from "@/lib/cn";
import { LootRow } from "./parts";

const LINE_TONE = { gold: "text-gold", jade: "text-jade", violet: "text-epic" } as const;
const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** A mode's result: the outcome, the Tyrant tier track when there is one, the facts, the loot. */
export function ModeResultSheet({ modal, open }: { modal: Extract<Modal, { kind: "mode_result" }>; open: boolean }) {
  const c = useController();
  const again = c.modeAvailability(modal.mode);
  return (
    <Sheet open={open} testId="modal-mode_result" labelledBy="mode-result-title" dismissible={false}>
      <MomentGroup className="flex flex-col">
        <div data-testid="mode-result">
          <MomentItem>
            <span className={cn("t-eyebrow", modal.success ? "text-gold" : "text-threat")}>{modal.subtitle}</span>
            <h2 id="mode-result-title" className="t-display text-t1 mt-1.5">
              {modal.title}
            </h2>
            <p className="t-label text-t2 mt-1">
              {modal.subtitle !== MODES[modal.mode].name && MODES[modal.mode].name}
              {modal.record && <span className="text-gold">{modal.subtitle !== MODES[modal.mode].name ? " · " : ""}New best</span>}
            </p>
          </MomentItem>
          {modal.tyrant && (
            <MomentItem>
              <TierTrack claimed={modal.tyrant.claimed} fresh={modal.tyrant.newTiers} />
            </MomentItem>
          )}
          <MomentItem className="mt-5 grid grid-cols-3 gap-3">
            {modal.lines.map((l) => (
              <div key={l.label} className="flex flex-col min-w-0">
                <span className="t-label text-t2 truncate">{l.label}</span>
                <span className={cn("t-num-l truncate", l.tone ? LINE_TONE[l.tone] : "text-t1")}>{l.value}</span>
              </div>
            ))}
          </MomentItem>
          {modal.items && modal.items.length > 0 && (
            <div className="mt-4 shadow-[inset_0_1px_0_var(--line)]">
              {modal.items.slice(0, 3).map((it, k) => (
                <LootRow key={it.uid} item={it} className={k >= 2 ? "short-hide" : undefined} />
              ))}
            </div>
          )}
        </div>
      </MomentGroup>
      <div className="mt-5 flex items-center gap-3">
        <Button variant="plain" className="shrink-0 px-4" onClick={() => c.returnToCampaign()} data-testid="mode-return">
          Campaign
        </Button>
        <Button variant="primary" className="flex-1" disabled={!again.ok} onClick={() => c.startMode(modal.mode)} data-testid="mode-again">
          {again.ok ? `Again${isKeyedMode(modal.mode) ? ` · ${c.profile.modes.keys[modal.mode]} left` : ""}` : again.reason}
        </Button>
      </div>
    </Sheet>
  );
}

/** The seven Tyrant tiers as a track: won tiers in gold; tiers won this fight fill in, in turn. */
export function TierTrack({ claimed, fresh = [], testId = "tyrant-track", caption }: { claimed: number; fresh?: number[]; testId?: string; caption?: (i: number) => string }) {
  const reduced = useReducedEffects();
  return (
    <div className="mt-5 grid grid-cols-7 gap-1" data-testid={testId}>
      {TYRANT_TIERS.map((t, i) => {
        const done = i < claimed;
        const order = fresh.indexOf(i);
        return (
          <div key={t} className="flex flex-col items-center gap-1.5 min-w-0">
            <span className="relative h-[3px] w-full overflow-hidden rounded-full bg-bg-3">
              {done && (
                <motion.span
                  className="absolute inset-0 origin-left bg-gold"
                  initial={order >= 0 && !reduced ? { scaleX: 0 } : false}
                  animate={{ scaleX: 1 }}
                  transition={{ delay: 0.3 + 0.12 * Math.max(0, order), duration: 0.32, ease: EASE_OUT }}
                />
              )}
            </span>
            <span className={cn("t-num-m", done ? "text-gold" : "text-t2")}>{t < 1 ? `${t * 100}%` : t}</span>
            {caption && <span className="t-caption text-t2 truncate max-w-full">{caption(i)}</span>}
          </div>
        );
      })}
    </div>
  );
}
