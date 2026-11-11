"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/Button";
import { Moment, MomentGroup, MomentItem } from "@/components/ui/Moment";
import { Row } from "@/components/ui/Row";
import { useController } from "@/hooks/useGame";
import { useReducedEffects } from "@/hooks/useReducedEffects";
import type { Modal } from "@/game/GameController";
import { ROLE_INFO, summonDef } from "@/game/data/summons";
import { fmtCodex } from "@/lib/codex";
import { RARITY_VAR, RARITY_WORD } from "./parts";

type RevealModal = Extract<Modal, { kind: "summon_reveal" }>;
const EASE_OUT = [0.16, 1, 0.3, 1] as const;
/** Taps in the first moments of the rite belong to the BIND press, not to a skip. */
const SKIP_GUARD_MS = 400;

/**
 * The DOM half of BIND. The figure rises in the battlefield canvas; this Moment leaves the upper
 * screen clear and names it at the foot: rarity and role, the name, the epithet, then the trait
 * and the Codex, then one action. Until the rite is done only the skip affordance shows.
 * A duplicate is not a moment: it is one compact line that dismisses itself.
 */
export function SummonReveal({ modal, open }: { modal: RevealModal; open: boolean }) {
  if (modal.outcome.kind !== "new") return <DuplicateLine modal={modal} open={open} />;
  return <NewShadow modal={modal} open={open} />;
}

function NewShadow({ modal, open }: { modal: RevealModal; open: boolean }) {
  const c = useController();
  const def = summonDef(modal.summonId);
  const opened = useRef(0);
  useEffect(() => {
    opened.current = performance.now();
  }, []);
  // The first shadow ever bound is staged like a legendary, in its own colour.
  const grand = modal.first || def.rarity === "legendary";
  const colour = RARITY_VAR[def.rarity] ?? "var(--color-t1)";
  const done = modal.cinematicDone;
  return (
    <Moment
      open={open}
      scrim="reveal"
      testId="modal-summon_reveal"
      label={done ? `${def.name}, ${RARITY_WORD[def.rarity]} ${ROLE_INFO[def.role].label}` : "A shadow rises"}
      onTap={() => {
        if (!done && performance.now() - opened.current > SKIP_GUARD_MS) c.skipReveal();
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {!done ? (
          <motion.div key="skip" className="w-full flex justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.6, duration: 0.32 } }} exit={{ opacity: 0, transition: { duration: 0.12 } }} data-testid="summon-cinematic">
            <span className="t-label text-t2 h-11 flex items-center">Tap to skip</span>
          </motion.div>
        ) : (
          <MomentGroup key="named" className="w-full flex flex-col items-center" delay={0.04}>
            <MomentItem>
              <span className="t-eyebrow" style={{ color: colour }}>
                {RARITY_WORD[def.rarity]} · {ROLE_INFO[def.role].label}
              </span>
            </MomentItem>
            <MomentItem className="mt-2">
              <Name name={def.name} grand={grand} letters={!grand && def.rarity === "epic"} colour={colour} />
            </MomentItem>
            <MomentItem>
              <p className="t-flavour text-t2 mt-2">{def.title}</p>
            </MomentItem>
            <div className="w-full mt-5 text-left shadow-[inset_0_1px_0_var(--line)]">
              {/* On a short phone the trait waits for the Army panel: the figure keeps its ground. */}
              <MomentItem className="short-hide">
                <Row gutter={false} title={def.active.name} detail={<span className="whitespace-normal">{def.active.description}</span>} />
              </MomentItem>
              <MomentItem>
                <Row gutter={false} title="Codex" detail={<span className="whitespace-normal" data-testid="codex-gain">+{fmtCodex(def.owned)} for your warrior, permanently.</span>} />
              </MomentItem>
            </div>
            <MomentItem className="mt-5">
              <Button
                variant="primary"
                block
                onClick={(e) => {
                  e.stopPropagation();
                  c.finishSummonReveal();
                }}
                data-testid="summon-reveal-continue"
              >
                Add to army
              </Button>
            </MomentItem>
          </MomentGroup>
        )}
      </AnimatePresence>
    </Moment>
  );
}

/**
 * The name: t-moment. Epic: its letters fade in left to right over 300ms. Legendary (and the
 * first shadow): 48px, with a hairline that draws out from the centre beneath it.
 */
function Name({ name, grand, letters, colour }: { name: string; grand: boolean; letters: boolean; colour: string }) {
  const reduced = useReducedEffects();
  const step = name.length > 1 ? 0.3 / (name.length - 1) : 0;
  return (
    <div className="flex flex-col items-center">
      <h2 className={grand ? "font-serif text-[48px] leading-[48px] tracking-[-0.01em] text-t1 [@media(max-height:640px)]:text-[36px] [@media(max-height:640px)]:leading-[38px]" : "t-moment text-t1"} data-testid="summon-reveal-name" aria-label={name}>
        {letters && !reduced
          ? [...name].map((ch, i) => (
              <motion.span key={i} aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.12 + i * step, duration: 0.16 }}>
                {ch}
              </motion.span>
            ))
          : name}
      </h2>
      {grand && (
        <motion.span
          className="mt-3 h-px w-40 origin-center"
          style={{ background: colour }}
          initial={{ scaleX: reduced ? 1 : 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.2, duration: 0.48, ease: EASE_OUT }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/** A duplicate: "+1 shard · Husk Blade" as one line above the abilities, gone by itself. */
function DuplicateLine({ modal, open }: { modal: RevealModal; open: boolean }) {
  const c = useController();
  const def = summonDef(modal.summonId);
  const o = modal.outcome;
  useEffect(() => {
    if (!open) return;
    // The simulation waits while a reveal is open: give it back after a short beat.
    const t = setTimeout(() => c.finishSummonReveal(), 1600);
    return () => clearTimeout(t);
  }, [open, c]);
  const what = o.kind === "sigil" ? `+${o.sigils ?? 1} sigil${(o.sigils ?? 1) > 1 ? "s" : ""}` : `+${o.shardsGained} shard${o.shardsGained === 1 ? "" : "s"}`;
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="pointer-events-none fixed inset-x-0 top-[34%] z-50 flex justify-center px-4" data-testid="modal-summon_reveal">
          <motion.button
            type="button"
            className="pointer-events-auto glass flex h-11 max-w-full items-center gap-2 rounded-full px-4"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            onClick={() => c.finishSummonReveal()}
            data-testid="summon-reveal-continue"
            aria-label={`${what}, ${def.name}. Dismiss`}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: RARITY_VAR[def.rarity] }} aria-hidden="true" />
            <span className="t-num-m text-t1 whitespace-nowrap">{what}</span>
            <span className="t-label text-t2 truncate" data-testid="summon-reveal-name">
              · {def.name}
            </span>
            {o.essenceGained > 0 && <span className="t-num-m text-jade whitespace-nowrap">+{o.essenceGained}</span>}
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
