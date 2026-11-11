"use client";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Moment, MomentItem } from "@/components/ui/Moment";
import { useController } from "@/hooks/useGame";
import type { Modal } from "@/game/GameController";
import { ABILITIES, TECHNIQUE_OWNED_ATTACK } from "@/game/data/abilities";
import { ABILITY_ICON } from "@/components/ui/abilityIcons";

/** A short moment: the glyph, the name in serif, one line, then Equip or keep the current form. */
export function TechniqueMoment({ modal, open }: { modal: Extract<Modal, { kind: "technique" }>; open: boolean }) {
  const c = useController();
  const def = ABILITIES[modal.id];
  const base = def.slot ? ABILITIES[def.slot] : null;
  return (
    <Moment open={open} testId="modal-technique" label={`Technique learned: ${def.name}`}>
      <div className="w-full flex flex-col items-center" data-testid="technique-learned">
        <MomentItem className="flex justify-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-bg-2 text-gold">
            <Icon name={ABILITY_ICON[modal.id]} size={26} />
          </span>
        </MomentItem>
        <MomentItem>
          <span className="t-eyebrow text-gold mt-4 block">Technique learned</span>
        </MomentItem>
        <MomentItem>
          <h2 className="t-display text-t1 mt-1.5">{def.name}</h2>
        </MomentItem>
        <MomentItem>
          <p className="t-body text-t2 mt-2">{def.description}</p>
          <p className="t-label text-t2 mt-2">
            Owned forever: +{Math.round(TECHNIQUE_OWNED_ATTACK * 100)}% attack, equipped or not.{base ? ` It takes the place of ${base.name}; switch any time in Skills, Arts.` : ""}
          </p>
        </MomentItem>
        <MomentItem className="mt-5 flex items-center gap-3">
          <Button variant="plain" className="shrink-0 px-4" onClick={() => c.closeModal()} data-testid="technique-later">
            Keep {base?.name ?? "current"}
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            onClick={() => {
              if (def.slot) c.setArtForm(def.slot, modal.id);
              c.closeModal();
            }}
            data-testid="technique-equip"
          >
            Equip
          </Button>
        </MomentItem>
      </div>
    </Moment>
  );
}
