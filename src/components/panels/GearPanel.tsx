"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { HoldButton } from "@/components/ui/HoldButton";
import { Button } from "@/components/ui/Button";
import { CurrencyGlyph } from "@/components/ui/Currency";
import { Segment, Segmented } from "@/components/ui/Segmented";
import { useController, useProfileRef, useUi } from "@/hooks/useGame";
import { replayClass, useShake } from "@/hooks/useShake";
import { useShortScreen } from "@/hooks/useShortScreen";
import { usePanelDetent, useRaisePanel } from "@/hooks/usePanelDetent";
import { EQUIP_SLOTS, RARITY_ORDER, type EquipSlot, type StatKey } from "@/game/data/ids";
import { EQUIPMENT_TEMPLATES, SLOT_LABEL, STAT_LABEL } from "@/game/data/equipment";
import { GEAR_EFFECTS } from "@/game/data/gearEffects";
import { GEAR_SETS, setCounts, setOf } from "@/game/data/gearSets";
import { EQUIPMENT_LEVEL_CAP, FUSE_COUNT, equipmentUpgradeCost, fusionSet, salvageValue } from "@/game/economy/loot";
import { ENEMIES } from "@/game/data/enemies";
import { bossForStage } from "@/game/data/regions";
import type { EquipmentItem, Profile } from "@/game/progression/profile";
import { BAG_LEND, bagItems, equippedItems, itemLend, itemStatTotals } from "@/game/progression/stats";
import { bagByGain, equipBestPlan, equipGain, powerBreakdown, powerOf, wornGain } from "@/game/progression/power";
import { fmt, fmtStat } from "@/lib/format";
import { cn } from "@/lib/cn";

const SLOT_ICON: Record<EquipSlot, IconName> = { weapon: "sword", helm: "helm", chest: "chest", gloves: "gloves", boots: "boots", relic: "relic" };
const RARITY_VAR: Record<string, string> = { common: "var(--color-common)", uncommon: "var(--color-uncommon)", rare: "var(--color-rare)", epic: "var(--color-epic)", legendary: "var(--color-legendary)" };
const RARITY_WORD: Record<string, string> = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary" };
const BAG_CAP = 24;
/** Which slots each template can drop for, in words: how an empty slot is filled. */
const SLOT_HINT: Record<EquipSlot, string> = { weapon: "Bosses and enemies drop blades", helm: "Enemies drop helms", chest: "Enemies drop chest armour", gloves: "Enemies drop gloves", boots: "Enemies drop boots", relic: "Relics drop from stage bosses" };

type View = "worn" | "bag";
/** The player's choice of view, kept for the session. */
let chosenView: View | null = null;

function templateName(item: EquipmentItem): string {
  return EQUIPMENT_TEMPLATES.find((t) => t.id === item.templateId)?.name ?? item.templateId;
}

function signed(v: number): string {
  return v >= 0 ? `+${fmt(v)}` : `−${fmt(-v)}`;
}

/** "60 Attack" and the rest of the line, in the game's stat formats. */
function statLine(item: EquipmentItem): { main: string; rest: string[] } {
  const t = itemStatTotals(item);
  const main = `${fmtStat(item.mainStat, t[item.mainStat] ?? 0)} ${STAT_LABEL[item.mainStat]}`;
  const rest = (Object.keys(t) as StatKey[]).filter((k) => k !== item.mainStat).map((k) => `${fmtStat(k, t[k] ?? 0)} ${STAT_LABEL[k]}`);
  return { main, rest };
}

/**
 * Gear: what is worn and what it gives, the bag and what it lends, and one action that wears the
 * strongest. Two views at the base height (Worn, Bag); a picked item opens its detail full width
 * and raises the panel, with the change it would make in Power.
 */
export default function GearPanel() {
  const c = useController();
  const profile = useProfileRef();
  const selectedUid = useUi((u) => u.selectedItem);
  const short = useShortScreen();
  const inv = profile.equipment.inventory;
  const selected = inv.find((i) => i.uid === selectedUid) ?? null;
  useRaisePanel(selected !== null);
  const bag = bagByGain(profile);
  const upgrade = bag.some((b) => b.gain >= 1);
  const [view, setView] = useState<View>(() => chosenView ?? (upgrade || equippedItems(profile).length === 0 ? "bag" : "worn"));
  const choose = (v: View) => {
    chosenView = v;
    setView(v);
  };
  const plan = equipBestPlan(profile);
  return (
    <div className={cn("flex h-full min-h-0 flex-col px-4", short ? "pt-1.5 pb-1.5" : "pt-2.5 pb-2.5")}>
      {selected ? (
        <ItemDetail item={selected} profile={profile} short={short} onBack={() => c.selectItem(null)} />
      ) : (
        <>
          <div className="flex shrink-0 items-center justify-between gap-2">
            <Segmented<View> value={view} onChange={choose} label="Gear view" className="-ml-[3px]">
              <Segment id="worn" data-testid="gear-view-worn">
                Worn
              </Segment>
              <Segment id="bag" badge={upgrade && view !== "bag"} data-testid="gear-view-bag">
                <span className="tnum">
                  Bag <span className="text-t3">{bag.length}/{BAG_CAP}</span>
                </span>
              </Segment>
            </Segmented>
            <button
              className={cn("press flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 t-label", plan.gain >= 1 ? "bg-bg-3 text-gold shadow-[inset_0_0_0_1px_rgba(218,184,108,0.45)]" : "text-t3")}
              onClick={() => c.equipBest()}
              data-testid="equip-best"
              data-guide={upgrade ? "equip-item" : undefined}
              aria-label={plan.gain >= 1 ? `Equip best: +${fmt(plan.gain)} Power` : "Equip best: you already wear your strongest gear"}
            >
              {plan.gain >= 1 && <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />}
              <span className="whitespace-nowrap">Equip best</span>
              {plan.gain >= 1 && <span className="tnum hidden min-[360px]:inline">+{fmt(plan.gain)}</span>}
            </button>
          </div>
          {view === "worn" ? <WornView profile={profile} short={short} /> : <BagView profile={profile} bag={bag} short={short} />}
        </>
      )}
    </div>
  );
}

/** The six slots as cards: the item's name, its main stat, and its effect or set. */
function WornView({ profile, short }: { profile: Profile; short: boolean }) {
  const c = useController();
  const tall = usePanelDetent() === "tall";
  const counts = setCounts(equippedItems(profile).map((i) => i.templateId));
  const gearShare = powerBreakdown(profile).rows.filter((r) => r.source === "gear" || r.source === "sets").reduce((a, r) => a + r.share, 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!short && (
        <p className="t-caption text-t2 mt-0.5 shrink-0 truncate" data-testid="gear-worn-summary">
          Worn gear and its sets give <span className="text-t1 tnum">{Math.round(gearShare * 100)}%</span> of your Power.
        </p>
      )}
      <div className="no-scrollbar mt-1.5 grid min-h-0 flex-1 grid-cols-2 content-start gap-1.5 overflow-y-auto" data-scroll style={{ touchAction: "pan-y" }}>
        {EQUIP_SLOTS.map((slot) => {
          const uid = profile.equipment.equipped[slot];
          const item = uid ? profile.equipment.inventory.find((i) => i.uid === uid) : undefined;
          return <WornCard key={slot} slot={slot} item={item} profile={profile} counts={counts} detail={tall && !short} onSelect={() => item && c.selectItem(item.uid)} />;
        })}
      </div>
    </div>
  );
}

function WornCard({ slot, item, profile, counts, detail, onSelect }: { slot: EquipSlot; item: EquipmentItem | undefined; profile: Profile; counts: Map<string, number>; detail: boolean; onSelect: () => void }) {
  const box = useRef<HTMLButtonElement>(null);
  const lastUid = useRef(item?.uid);
  // Equip: the card settles from 0.9 while its rarity edge brightens.
  useEffect(() => {
    if (item && item.uid !== lastUid.current) replayClass(box.current, "equip-pop");
    lastUid.current = item?.uid;
  }, [item]);
  if (!item) {
    const better = bagItems(profile).some((i) => i.slot === slot);
    return (
      <div className="flex min-h-11 items-center gap-2 rounded-[12px] bg-bg-1 px-2 py-1.5 shadow-[inset_0_0_0_1px_var(--line)]" data-testid={`slot-${slot}`}>
        <Icon name={SLOT_ICON[slot]} size={18} className="shrink-0 text-t3" />
        <span className="flex min-w-0 flex-col">
          <span className="t-label text-t2 truncate">{SLOT_LABEL[slot]}: empty</span>
          <span className="t-caption text-t3 truncate">{better ? "One waits in your bag" : SLOT_HINT[slot]}</span>
        </span>
      </div>
    );
  }
  const line = statLine(item);
  const set = setOf(item.templateId);
  const worn = set ? (counts.get(set.id) ?? 0) : 0;
  return (
    <button ref={box} className="press relative flex min-h-11 min-w-0 items-center gap-2 overflow-hidden rounded-[12px] bg-bg-2 px-2 py-1.5 text-left" onClick={onSelect} data-testid={`slot-${slot}`} aria-label={`${SLOT_LABEL[slot]}: ${templateName(item)}, ${line.main}`}>
      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center">
        <Icon name={SLOT_ICON[slot]} size={18} className="text-t1" />
        <span className="absolute -bottom-0.5 -right-1 t-caption tnum text-t2">+{item.level}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="t-label text-t1 truncate">{templateName(item)}</span>
        <span className="t-caption tnum text-t2 truncate">
          {line.main}
          {line.rest.length > 0 && <span className="text-t3"> +{line.rest.length}</span>}
        </span>
        {detail && (item.effect || set) && (
          <span className="t-caption truncate">
            {item.effect ? <span className="text-gold">{GEAR_EFFECTS[item.effect].name}</span> : null}
            {item.effect && set ? <span className="text-t3"> · </span> : null}
            {set ? <span className={worn >= 2 ? "text-jade" : "text-t3"}>{set.name.split(" ")[0]} {worn}/{set.pieces.length}</span> : null}
          </span>
        )}
      </span>
      {!detail && item.effect && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />}
      <span className="absolute inset-x-0 bottom-0 h-[2px]" style={{ background: RARITY_VAR[item.rarity] }} aria-hidden="true" />
    </button>
  );
}

/** The bag: the strongest first; a jade arrow marks an item that would raise Power if worn. */
function BagView({ profile, bag, short }: { profile: Profile; bag: { item: EquipmentItem; gain: number }[]; short: boolean }) {
  const c = useController();
  // What the bag adds now: Power with it, less Power without it.
  const lend = powerOf(profile) - powerOf(profile, new Set(["bag"]));
  const sq = short ? 44 : 50;
  if (bag.length === 0) {
    return (
      <div className="flex flex-1 flex-col justify-center gap-1 pb-1">
        <span className="t-body text-t1">Your bag is empty.</span>
        <span className="t-label text-t2">Bosses drop a piece every win, and enemies drop the rest. Every item you keep lends {Math.round(BAG_LEND * 100)}% of its stats.</span>
        <Button size="sm" variant="quiet" className="mt-2 self-start" onClick={() => (profile.progress.bossGate ? c.openBossChallenge() : c.setPanel("rift"))} data-testid="gear-empty-next">
          {profile.progress.bossGate ? `Face ${ENEMIES[bossForStage(profile.progress.bossGate)]?.name ?? "the boss"}` : "Hunt a boss in the Rift"}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="t-caption text-t2 mt-0.5 shrink-0 truncate" data-testid="bag-lend">
        <span className="hidden min-[400px]:inline">Items in your bag lend {Math.round(BAG_LEND * 100)}% of their strength: </span>
        <span className="min-[400px]:hidden">Bag lends {Math.round(BAG_LEND * 100)}% of its stats: </span>
        <span className="text-jade tnum">+{fmt(lend)} Power</span>
      </p>
      <div className="no-scrollbar mt-1.5 grid min-h-0 grid-cols-5 min-[360px]:grid-cols-6 content-start overflow-y-auto -mx-1 px-1 pb-1" data-scroll style={{ gap: 6, gridAutoRows: sq, touchAction: "pan-y" }}>
        {bag.map(({ item, gain }, i) => (
          // The equip lesson points at the best piece first, then at Equip in its detail.
          <ItemSquare key={item.uid} item={item} up={gain >= 1} onSelect={() => c.selectItem(item.uid)} guide={i === 0 && gain < 1 ? "equip-item" : undefined} />
        ))}
      </div>
    </div>
  );
}

/** A square: bg-2, radius 12, rarity as a 2px bottom edge, the glyph, "+7", and an arrow when it is an upgrade. */
function ItemSquare({ item, up, onSelect, guide }: { item: EquipmentItem; up: boolean; onSelect: () => void; guide?: string }) {
  return (
    <button className="press relative flex h-full w-full items-center justify-center overflow-hidden rounded-[12px] bg-bg-2" onClick={onSelect} aria-label={`${templateName(item)}, ${item.rarity}, plus ${item.level}${up ? ", stronger than what you wear" : ""}`} data-testid="bag-item" data-guide={guide} data-up={up || undefined}>
      <Icon name={SLOT_ICON[item.slot]} size={18} className="text-t1" />
      <span className="absolute bottom-1 right-1.5 t-caption tnum text-t2">+{item.level}</span>
      {item.effect && <span className="absolute left-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />}
      {up && <Icon name="chevron" size={11} strokeWidth={2.6} className="absolute right-1 top-1 -rotate-90 text-jade" />}
      <span className="absolute inset-x-0 bottom-0 h-[2px]" style={{ background: RARITY_VAR[item.rarity] }} aria-hidden="true" />
    </button>
  );
}

/**
 * One item, full width: what it is, what it gives in Power (worn) or would change (from the bag),
 * its stats against what is worn, its effect in one sentence, its set and how far along it is.
 */
function ItemDetail({ item, profile, short, onBack }: { item: EquipmentItem; profile: Profile; short: boolean; onBack: () => void }) {
  const c = useController();
  const inv = profile.equipment.inventory;
  const equippedUid = profile.equipment.equipped[item.slot];
  const isEquipped = equippedUid === item.uid;
  const current = equippedUid && !isEquipped ? inv.find((i) => i.uid === equippedUid) : undefined;
  const totals = itemStatTotals(item);
  const currentTotals = current ? itemStatTotals(current) : {};
  const cost = equipmentUpgradeCost(item);
  const capped = item.level >= EQUIPMENT_LEVEL_CAP;
  const affordable = profile.player.gold >= cost;
  const set = setOf(item.templateId);
  const [pill, shake] = useShake<HTMLSpanElement>();
  const counts = setCounts(equippedItems(profile).map((i) => i.templateId));
  // Pieces of this set worn, counting this item as if it were worn in its slot.
  const setWorn = set ? (counts.get(set.id) ?? 0) + (isEquipped ? 0 : 1) - (current && setOf(current.templateId)?.id === set.id ? 1 : 0) : 0;
  const fuse = fusionSet(profile, item.uid);
  const nextRarity = RARITY_ORDER[Math.min(RARITY_ORDER.length - 1, RARITY_ORDER.indexOf(item.rarity) + 1)]!;
  const keys = Object.keys(totals) as StatKey[];
  const lost = current ? (Object.keys(currentTotals) as StatKey[]).filter((k) => !(k in totals)) : [];
  const gain = isEquipped ? wornGain(profile, item.slot) : equipGain(profile, item);
  const lent = itemLend(item, !isEquipped);
  const lendPower = Object.keys(lent).length ? powerOf(profile) - powerOf({ ...profile, equipment: { ...profile.equipment, inventory: inv.map((i) => (i.uid === item.uid ? { ...i, kept: undefined, ...(isEquipped ? {} : { mainValue: 0, substats: [] }) } : i)) } }) : 0;
  const upgradeGain = capped ? 0 : powerOf({ ...profile, equipment: { ...profile.equipment, inventory: inv.map((i) => (i.uid === item.uid ? { ...i, level: i.level + 1 } : i)) } }) - powerOf(profile);
  const h = short ? "h-11" : "h-[52px]";
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="item-detail">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <span className="t-eyebrow truncate" style={{ color: RARITY_VAR[item.rarity] }}>
          {RARITY_WORD[item.rarity]} · {SLOT_LABEL[item.slot]} · Lv {item.level}
          {isEquipped ? " · Worn" : ""}
        </span>
        <button className="press -my-2 -mr-2 flex h-11 items-center gap-1 rounded-[10px] px-2 t-label text-t2 shrink-0" onClick={onBack} aria-label="Back to your gear">
          <Icon name="close" size={14} />
          <span className="hidden min-[360px]:inline">Back</span>
        </button>
      </div>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto" data-scroll style={{ touchAction: "pan-y" }}>
        <div className="flex items-baseline justify-between gap-3">
          <span className="t-name text-t1 truncate">{templateName(item)}</span>
          <span className={cn("t-label font-semibold tnum shrink-0", isEquipped ? "text-t1" : gain >= 1 ? "text-jade" : gain <= -1 ? "text-threat" : "text-t2")} data-testid="item-power">
            {isEquipped ? `Gives ${fmt(gain)} Power` : Math.abs(gain) < 1 ? "Same Power if worn" : `${signed(gain)} Power if worn`}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 t-label text-t2">
          {keys.map((k) => (
            <span key={k} className="tnum whitespace-nowrap">
              <span className={k === item.mainStat ? "text-t1" : undefined}>{fmtStat(k, totals[k] ?? 0)}</span> {STAT_LABEL[k]}
              {current && Math.abs((totals[k] ?? 0) - (currentTotals[k] ?? 0)) > 1e-9 && <Delta v={(totals[k] ?? 0) - (currentTotals[k] ?? 0)} k={k} />}
            </span>
          ))}
          {lost.map((k) => (
            <span key={k} className="tnum whitespace-nowrap text-threat">
              {STAT_LABEL[k]} −{fmtStat(k, currentTotals[k] ?? 0)}
            </span>
          ))}
        </div>
        {current && <p className="t-caption text-t3 mt-0.5">Against your {templateName(current)}, worn now.</p>}
        {item.effect && (
          <p className="mt-1.5 t-label text-t2" data-testid="item-effect">
            <span className="text-gold">{GEAR_EFFECTS[item.effect].name}:</span> {GEAR_EFFECTS[item.effect].description}
          </p>
        )}
        {set && (
          <p className="mt-1.5 t-label text-t2" data-testid="item-set">
            <span className="text-t1">{set.name}</span> <span className="tnum">({isEquipped ? setWorn : `${setWorn} if worn`} of {set.pieces.length})</span>
            <span className={setWorn >= 2 ? "text-jade" : "text-t3"}>
              {" "}
              · 2 pieces: +{Math.round(set.two.pct * 100)}% {STAT_LABEL[set.two.stat]}
            </span>
            <span className={setWorn >= 4 ? "text-jade" : "text-t3"}> · 4 pieces: {GEAR_EFFECTS[GEAR_SETS[set.id].four].name}</span>
          </p>
        )}
        <p className="mt-1.5 t-caption text-t3" data-testid="item-lend">
          {isEquipped ? `In the bag it would lend ${Math.round(BAG_LEND * 100)}% of its stats instead.` : `In the bag it lends ${Math.round(BAG_LEND * 100)}% of its stats: +${fmt(lendPower)} Power.`}
          {item.kept ? " It also carries the strength of the items forged into it." : ""}
        </p>
        {fuse && (
          <button className="press mt-2 flex h-11 w-full items-center justify-between gap-2 rounded-[14px] bg-bg-2 px-3" onClick={() => c.fuseItem(item.uid)} aria-label={`Forge ${FUSE_COUNT} ${item.rarity} items into one ${nextRarity}`} data-testid="fuse-button">
            <span className="t-label text-t1 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />
              Forge {FUSE_COUNT} into one
            </span>
            <span className="t-label truncate">
              <span style={{ color: RARITY_VAR[item.rarity] }}>{RARITY_WORD[item.rarity]}</span>
              <span className="text-t3"> to </span>
              <span style={{ color: RARITY_VAR[nextRarity] }}>{RARITY_WORD[nextRarity]}</span>
            </span>
          </button>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-2">
        {!isEquipped ? (
          <Button variant="primary" className={cn(h, "flex-1 min-w-0 px-3")} onClick={() => c.equipItem(item.uid)} data-guide="equip-item" data-testid="equip-button">
            Equip
          </Button>
        ) : (
          <Button variant="quiet" className={cn(h, "flex-1 min-w-0 px-3")} onClick={() => c.unequipSlot(item.slot)} data-testid="unequip-button">
            Unequip
          </Button>
        )}
        <HoldButton
          onRepeat={() => c.upgradeItem(item.uid)}
          disabled={capped || !affordable}
          onDenied={capped ? undefined : () => (shake(), c.audio.play("error", { volume: 0.3, minInterval: 200 }))}
          feedback="scale"
          className={cn(h, "rounded-[14px] bg-bg-2 px-3 flex flex-col items-center justify-center shrink-0 min-w-11", capped && "opacity-40")}
          testId="item-upgrade"
          label={capped ? "Item at its cap" : `Upgrade item for ${cost} gold: +${fmt(upgradeGain)} Power`}
        >
          <span className="t-label text-t1">
            Upgrade{!capped && upgradeGain >= 1 && <span className="text-jade tnum hidden min-[360px]:inline"> +{fmt(upgradeGain)}</span>}
          </span>
          <span ref={pill} className={cn("flex items-center gap-1 t-caption tnum", affordable && !capped ? "text-gold" : "text-t3")}>
            {capped ? (
              "Max"
            ) : (
              <>
                <CurrencyGlyph kind="gold" size={6} className={affordable ? undefined : "!bg-t3"} />
                {fmt(cost)}
              </>
            )}
          </span>
        </HoldButton>
        {!isEquipped && (
          <button className={cn("press rounded-[14px] px-2 hidden min-[360px]:flex flex-col items-center justify-center shrink-0 min-w-11", h)} onClick={() => c.salvageItem(item.uid)} aria-label={`Salvage for ${salvageValue(item)} gold`} data-testid="salvage-button">
            <span className="t-label text-t2">Salvage</span>
            <span className="t-caption tnum text-t3 flex items-center gap-1">
              <CurrencyGlyph kind="gold" size={6} className="!bg-t3" />
              {fmt(salvageValue(item))}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

function Delta({ v, k }: { v: number; k: StatKey }) {
  return <span className={cn("t-label font-semibold tnum", v > 0 ? "text-jade" : "text-threat")}> {v > 0 ? `+${fmtStat(k, v)}` : `−${fmtStat(k, -v)}`}</span>;
}
