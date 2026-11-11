"use client";

import { useEffect, useState } from "react";
import { useUi } from "@/hooks/useGame";
import type { Modal } from "@/game/GameController";
import { AscendSheet } from "./AscendSheet";
import { BossDefeatSheet } from "./BossDefeatSheet";
import { BossReadySheet } from "./BossReadySheet";
import { BossVictoryMoment } from "./BossVictoryMoment";
import { HuntSheet } from "./HuntSheet";
import { JournalSheet } from "./JournalSheet";
import { ModeResultSheet } from "./ModeResultSheet";
import { ObjectivesSheet } from "./ObjectivesSheet";
import { OfflineSheet } from "./OfflineSheet";
import { PerkChoiceSheet } from "./PerkChoiceSheet";
import { RankUpMoment } from "./RankUpMoment";
import { SettingsSheet } from "./SettingsSheet";
import { SummonReveal } from "./SummonReveal";
import { TechniqueMoment } from "./TechniqueMoment";
import { TyrantSheet } from "./TyrantSheet";
import { WeaponPathSheet } from "./WeaponPathSheet";

/** Long enough for the slowest exit (a Moment's 320ms fade). */
const EXIT_MS = 360;

/**
 * Routes the controller's modal to its sheet or moment. A modal that goes away stays mounted,
 * closed, for its exit animation, so sheets slide out and moments fade instead of vanishing.
 */
export function ModalHost() {
  const modal = useUi((u) => u.modal);
  const [prev, setPrev] = useState<Modal | null>(modal);
  const [leaving, setLeaving] = useState<Modal | null>(null);
  if (modal !== prev) {
    if (prev && prev.kind !== modal?.kind) setLeaving(prev);
    setPrev(modal);
  }
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(null), EXIT_MS);
    return () => clearTimeout(t);
  }, [leaving]);
  // One keyed list, so a modal that closes keeps its instance (and plays its exit) as it leaves.
  const shown: [Modal, boolean][] = [];
  if (leaving && leaving.kind !== modal?.kind) shown.push([leaving, false]);
  if (modal) shown.push([modal, true]);
  return (
    <>
      {shown.map(([m, open]) => (
        <Route key={m.kind} modal={m} open={open} />
      ))}
    </>
  );
}

function Route({ modal, open }: { modal: Modal; open: boolean }) {
  switch (modal.kind) {
    case "boss_ready":
      return <BossReadySheet modal={modal} open={open} />;
    case "boss_victory":
      return <BossVictoryMoment modal={modal} open={open} />;
    case "boss_defeat":
      return <BossDefeatSheet modal={modal} open={open} />;
    case "summon_reveal":
      return <SummonReveal modal={modal} open={open} />;
    case "perk_choice":
      return <PerkChoiceSheet modal={modal} open={open} />;
    case "offline":
      return <OfflineSheet modal={modal} open={open} />;
    case "settings":
      return <SettingsSheet open={open} />;
    case "weapon_path":
      return <WeaponPathSheet open={open} />;
    case "journal":
      return <JournalSheet open={open} />;
    case "objectives":
      return <ObjectivesSheet open={open} />;
    case "ascend":
      return <AscendSheet open={open} />;
    case "tyrant":
      return <TyrantSheet open={open} />;
    case "hunt_pick":
      return <HuntSheet open={open} />;
    case "rank_up":
      return <RankUpMoment modal={modal} open={open} />;
    case "technique":
      return <TechniqueMoment modal={modal} open={open} />;
    case "mode_result":
      return <ModeResultSheet modal={modal} open={open} />;
    case "boss_intro":
      // The entrance is staged on the battlefield (banner and canvas); there is no sheet.
      return null;
    default: {
      const never: never = modal;
      return never;
    }
  }
}
