"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/Button";
import { Moment, MomentItem } from "@/components/ui/Moment";
import { Row } from "@/components/ui/Row";
import { useController, useHud, useProfile, useProfileRef } from "@/hooks/useGame";
import { useReducedEffects } from "@/hooks/useReducedEffects";
import { extractionChance } from "@/game/summons/extraction";
import type { Modal } from "@/game/GameController";
import { ENEMIES } from "@/game/data/enemies";
import { computeModifiers } from "@/game/progression/stats";
import { LootRow, RewardTotal } from "./parts";

/**
 * Victory: the boss's fall in serif, the rewards counting up, the loot as rows, the boss's
 * essence as one row with its own BIND, then "Onward" with the auto-continue countdown drawn as
 * a thin line along the button's foot. "Onward" is always the one gold action (blind reviewers
 * found a gold BIND beside a grey Onward unclear). An unclaimed essence is still a decision: no
 * countdown runs while it waits, and the first tap on Onward warns that it will be left behind.
 */
export function BossVictoryMoment({ modal, open }: { modal: Extract<Modal, { kind: "boss_victory" }>; open: boolean }) {
  const c = useController();
  const profile = useProfileRef();
  const autoAdvance = useProfile((p) => p.settings.autoAdvance);
  const reduced = useReducedEffects();
  const orb = useHud((s) => (modal.orbId !== undefined ? (s?.orbs.find((o) => o.id === modal.orbId) ?? null) : null));
  const auto = open && autoAdvance && !orb;
  const total = 7 + Math.min(2, modal.items.length);
  const [left, setLeft] = useState(total);
  const [warned, setWarned] = useState(false);
  const onward = () => {
    if (orb && !warned) {
      setWarned(true);
      return;
    }
    c.continueAfterVictory();
  };
  useEffect(() => {
    if (!auto) return;
    if (left <= 0) {
      c.continueAfterVictory();
      return;
    }
    const t = setTimeout(() => setLeft((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [left, auto, c]);
  const boss = ENEMIES[modal.defId];
  // The very first oath always holds, so the row says so.
  const chance = orb ? (!profile.summons.firstSummonSeen ? 1 : extractionChance(profile, orb.summonId, { elite: orb.elite, bonus: computeModifiers(profile).extractionBonus })) : 0;
  return (
    <Moment open={open} testId="modal-boss_victory" label="Victory">
      <div className="w-full flex flex-col items-stretch text-left" data-testid="boss-victory">
        <MomentItem>
          <span className="t-eyebrow text-gold">{modal.hunt ? "Hunt complete" : "Victory"}</span>
        </MomentItem>
        <MomentItem>
          <h2 className="t-moment text-t1 mt-2">{boss?.name ?? "The Warden"} falls</h2>
        </MomentItem>
        <MomentItem>
          <p className="t-label text-t2 mt-2">{modal.hunt ? `Stage ${modal.stage} boss, felled again in ${modal.seconds}s` : `Stage ${modal.stage} cleared in ${modal.seconds}s`}</p>
        </MomentItem>
        <MomentItem className="mt-5 flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <RewardTotal kind="gold" value={modal.gold} delay={260} testId="victory-gold" onStart={() => c.rewardCue("tick")} />
          <RewardTotal kind="xp" value={modal.xp} delay={320} />
          {modal.cores > 0 && <RewardTotal kind="core" value={modal.cores} delay={380} />}
        </MomentItem>
        {(modal.items.length > 0 || orb || modal.unlocks.length > 0) && (
          <div className="mt-4 shadow-[inset_0_1px_0_var(--line)]">
            {modal.items.slice(0, 2).map((it, i) => (
              <LootRow key={it.uid} item={it} className={i >= 1 ? "short-hide" : undefined} />
            ))}
            {orb && (
              <MomentItem>
                <Row
                  gutter={false}
                  // The headline already names the boss; with it, the line truncated at every phone width.
                  title="Its essence lingers"
                  detail={`${orb.attempts > 1 ? `${orb.attempts} attempts` : "Last attempt"} · it will not fade`}
                  trailing={
                    <Button size="sm" variant="quiet" className="!text-gold" onClick={() => c.bindBossEssence(orb.id)} data-testid="victory-bind-button">
                      BIND {Math.round(chance * 100)}%
                    </Button>
                  }
                  data-testid="victory-bind"
                />
              </MomentItem>
            )}
            {modal.unlocks.length > 0 && (
              <MomentItem>
                <p className="t-label text-jade py-3" data-testid="victory-unlocks">
                  Opened: {modal.unlocks.join(" · ")}
                </p>
              </MomentItem>
            )}
          </div>
        )}
        <MomentItem className="mt-5">
          {orb && warned && (
            <p className="t-label text-threat mb-2" data-testid="victory-leave-warning">
              The essence stays here if you go. Tap again to leave it.
            </p>
          )}
          <Button variant="primary" block className="relative overflow-hidden" onClick={onward} data-testid="victory-continue">
            {modal.hunt ? "Back to farming" : `Onward to stage ${modal.nextStage}`}
            {auto && (
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-black/15" aria-hidden="true">
                <motion.span
                  className="absolute inset-0 origin-left bg-gold-ink/45"
                  initial={{ scaleX: 1 }}
                  animate={{ scaleX: 0 }}
                  transition={reduced ? { duration: 0 } : { duration: total, ease: "linear" }}
                />
              </span>
            )}
          </Button>
        </MomentItem>
        {auto && <span className="sr-only">Continuing in {left} seconds</span>}
      </div>
    </Moment>
  );
}
