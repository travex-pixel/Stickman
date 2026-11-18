"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/Button";
import { MomentGroup, MomentItem } from "@/components/ui/Moment";
import { useController, useProfileRef } from "@/hooks/useGame";
import { useReducedEffects } from "@/hooks/useReducedEffects";
import type { Modal } from "@/game/GameController";
import { SIGNATURES, type SignatureId } from "@/game/data/signatures";
import { equippedSignatures } from "@/game/progression/signatures";
import { SigGlyph, glyphPath, openSignatureCollection, rarityWord, sigColour } from "@/components/signatures/shared";
import { cn } from "@/lib/cn";

type RevealModal = Extract<Modal, { kind: "signature_reveal" }>;
const EASE_OUT = [0.16, 1, 0.3, 1] as const;
/** Taps in the first moments belong to whatever opened the reveal, not to a skip. */
const SKIP_GUARD_MS = 400;

/**
 * The beats of a reveal, in ms from its start. The rite (legendary, mythic): the field darkens,
 * the sigil draws itself, the name and rarity, then the scrim lifts off the upper field while the
 * skill plays there (the renderer's preview), then what it does and its three paths. The short
 * reveal (rare, epic) names it over the field while it plays. Either way the words and the two
 * actions are up within 5.6s, any tap skips to them, and nothing waits on the renderer.
 */
const RITE = { sigil: 250, name: 1250, watch: 2100, told: 5600 } as const;
const SHORT = { watch: 150, told: 1500 } as const;
/** Without a preview to watch, the rite does not hold the field open for nothing. */
const NO_PREVIEW_HOLD = 900;

type Phase = "dark" | "sigil" | "name" | "watch" | "told";

/**
 * The menus' half of a signature skill's discovery. The battlefield half (its animation, on
 * stand-in figures) is the renderer's preview, called through the controller's optional path.
 */
export function SignatureReveal({ modal, open }: { modal: RevealModal; open: boolean }) {
  const c = useController();
  const profile = useProfileRef();
  const reduced = useReducedEffects();
  const id = modal.id;
  const def = SIGNATURES[id];
  const grand = def.rarity === "legendary" || def.rarity === "mythic";
  const crown = id === "sovereign_awakening";
  const colour = sigColour(id);
  const [phase, setPhase] = useState<Phase>(grand ? "dark" : "name");
  const opened = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const finished = useRef(false);

  const clear = () => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  };
  const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
  const play = useCallback(() => c.previewSignature(id, null), [c, id]);

  useEffect(() => {
    opened.current = performance.now();
    if (grand) {
      at(RITE.sigil, () => setPhase("sigil"));
      at(RITE.name, () => setPhase("name"));
      at(RITE.watch, () => {
        setPhase("watch");
        // No renderer preview (an older renderer, or none at all): go on to the words.
        if (!play()) {
          clear();
          at(NO_PREVIEW_HOLD, () => setPhase("told"));
        }
      });
      at(RITE.told, () => setPhase("told"));
    } else {
      at(SHORT.watch, () => void play());
      at(SHORT.told, () => setPhase("told"));
    }
    return clear;
    // One run per reveal (the component is keyed by the skill).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = (equip: boolean) => {
    if (finished.current) return;
    finished.current = true;
    clear();
    if (equip && !crown) {
      const empty = equippedSignatures(profile).findIndex((s) => s === null);
      if (empty >= 0) {
        if (!c.equipSignature(id, empty)) openSignatureCollection(c, id);
      } else openSignatureCollection(c, id, true);
    }
    c.signatureRevealed(id);
    // The controller may already have moved on to the next reveal: close only this one.
    const m = c.uiStore.get().modal;
    if (m?.kind === "signature_reveal" && m.id === id) c.closeModal();
  };

  const skip = () => {
    if (phase === "told" || performance.now() - opened.current < SKIP_GUARD_MS) return;
    clear();
    setPhase("told");
  };

  const dark = phase === "dark" || phase === "sigil" || phase === "name";
  const empty = equippedSignatures(profile).some((s) => s === null);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex flex-col"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.32, ease: EASE_OUT }}
          role="dialog"
          aria-modal="true"
          aria-label={`Signature skill found: ${def.name}, ${rarityWord(id)}`}
          data-testid="modal-signature_reveal"
          data-phase={phase}
          data-rite={grand || undefined}
          onClick={skip}
        >
          {/* Two scrims: the dark of the rite over everything, then one that leaves the upper
              field clear while the skill plays there and is solid behind the words. */}
          <motion.span className="absolute inset-0 bg-[rgba(8,7,10,0.94)]" initial={false} animate={{ opacity: dark ? 1 : 0 }} transition={{ duration: reduced ? 0 : 0.5, ease: EASE_OUT }} aria-hidden="true" />
          <motion.span
            className="absolute inset-0"
            style={{ backgroundImage: "linear-gradient(180deg, rgba(12,11,9,0) 0%, rgba(12,11,9,0) 30%, rgba(12,11,9,0.86) 46%, rgba(12,11,9,1) 56%, rgba(12,11,9,1) 100%)" }}
            initial={false}
            animate={{ opacity: dark ? 0 : 1 }}
            transition={{ duration: reduced ? 0 : 0.5, ease: EASE_OUT }}
            aria-hidden="true"
          />
          <div className={cn("relative mx-auto flex w-full max-w-[440px] flex-1 flex-col items-center px-6 text-center pb-[calc(24px+var(--sab))]", dark ? "justify-center" : "justify-end")}>
            <motion.div layout={!reduced} transition={{ duration: 0.5, ease: EASE_OUT }} className="flex w-full flex-col items-center">
              <Sigil id={id} colour={colour} draw={grand && phase !== "dark"} big={dark} reduced={reduced} shown={!grand || phase !== "dark"} />
              <AnimatePresence initial={false}>
                {(phase === "name" || phase === "watch" || phase === "told" || !grand) && (
                  <motion.div key="name" className="flex w-full flex-col items-center" initial={{ opacity: 0, y: reduced ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE_OUT }}>
                    <span className="t-eyebrow mt-4" style={{ color: colour }} data-testid="signature-reveal-rarity">
                      {rarityWord(id)} · Signature skill
                    </span>
                    <h2 className={cn("mt-2 text-t1", grand ? "font-serif text-[44px] leading-[46px] tracking-[-0.01em] [@media(max-height:640px)]:text-[34px] [@media(max-height:640px)]:leading-[36px]" : "t-moment")} data-testid="signature-reveal-name">
                      {def.name}
                    </h2>
                    {grand && <motion.span className="mt-3 h-px w-40 origin-center" style={{ background: colour }} initial={{ scaleX: reduced ? 1 : 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.15, duration: 0.48, ease: EASE_OUT }} aria-hidden="true" />}
                    <p className="t-flavour text-t2 mt-2">{def.role}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
            <AnimatePresence mode="wait" initial={false}>
              {phase === "told" ? (
                <MomentGroup key="told" className="w-full flex flex-col items-center" delay={0.04}>
                  <MomentItem>
                    <p className="t-body text-t2 mt-3 text-left" data-testid="signature-reveal-description">
                      {def.description}
                    </p>
                  </MomentItem>
                  {def.evolutions.length > 0 && (
                    <MomentItem className="short-only">
                      <p className="t-label text-t2 mt-2" data-testid="signature-reveal-paths-short">
                        Paths at Adept: <span className="text-t1">{def.evolutions.map((e) => e.name).join(" · ")}</span>
                      </p>
                    </MomentItem>
                  )}
                  {def.evolutions.length > 0 && (
                    <div className="w-full mt-3 text-left shadow-[inset_0_1px_0_var(--line)] short-hide" data-testid="signature-reveal-paths">
                      <MomentItem>
                        <p className="t-label text-t2 pt-2">Three paths open once it is mastered to Adept</p>
                      </MomentItem>
                      {def.evolutions.map((e) => (
                        <MomentItem key={e.id}>
                          <p className="t-label text-t1 mt-1.5 flex gap-2">
                            <span className="lozenge mt-[6px]" aria-hidden="true" />
                            <span>
                              {e.name}
                              <span className="text-t2"> · {e.line}</span>
                            </span>
                          </p>
                        </MomentItem>
                      ))}
                    </div>
                  )}
                  <MomentItem className="mt-5 flex items-center gap-3">
                    {crown ? (
                      <Button
                        variant="primary"
                        block
                        onClick={(e) => {
                          e.stopPropagation();
                          finish(false);
                        }}
                        data-testid="signature-reveal-equip"
                      >
                        Take the crown
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="plain"
                          className="shrink-0 px-4"
                          onClick={(e) => {
                            e.stopPropagation();
                            finish(false);
                          }}
                          data-testid="signature-reveal-later"
                        >
                          Later
                        </Button>
                        <Button
                          variant="primary"
                          className="flex-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            finish(true);
                          }}
                          data-testid="signature-reveal-equip"
                          aria-label={empty ? `Equip ${def.name}` : `Equip ${def.name}: choose the slot it takes`}
                        >
                          {empty ? "Equip" : "Equip…"}
                        </Button>
                      </>
                    )}
                  </MomentItem>
                </MomentGroup>
              ) : (
                <motion.div key="skip" className="w-full flex justify-center mt-4" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.6, duration: 0.32 } }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
                  <span className="t-label text-t2 h-11 flex items-center" data-testid="signature-reveal-skip">
                    Tap to skip
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * The skill's sigil: its glyph inside a gilt ring. In the rite it draws itself, stroke by stroke,
 * large in the dark, then settles to the size of a seal above the name.
 */
function Sigil({ id, colour, draw, big, reduced, shown }: { id: SignatureId; colour: string; draw: boolean; big: boolean; reduced: boolean; shown: boolean }) {
  const size = big ? 112 : 56;
  if (!shown) return <span className="block" style={{ height: size }} aria-hidden="true" />;
  return (
    <motion.span className="relative flex items-center justify-center" initial={false} animate={{ width: size, height: size }} transition={{ duration: reduced ? 0 : 0.5, ease: EASE_OUT }} data-testid="signature-reveal-sigil" aria-hidden="true">
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 56 56" fill="none">
        <motion.circle cx="28" cy="28" r="26.5" stroke="var(--color-gold)" strokeWidth="1" initial={{ pathLength: draw && !reduced ? 0 : 1, opacity: 0.7 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: EASE_OUT }} />
        <circle cx="28" cy="28" r="23" stroke={colour} strokeWidth="0.75" opacity="0.45" />
      </svg>
      {draw && !reduced ? (
        <svg className="relative" width="58%" height="58%" viewBox="0 0 24 24" fill="none" stroke="var(--color-t1)" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
          <motion.path d={glyphPath(id)} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.15, duration: 0.85, ease: "easeInOut" }} />
        </svg>
      ) : (
        <SigGlyph id={id} className="relative h-[58%] w-[58%] text-t1" strokeWidth={1.4} />
      )}
    </motion.span>
  );
}
