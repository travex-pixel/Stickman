"use client";

import { useEffect, useRef } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { HoldButton } from "@/components/ui/HoldButton";
import { Button } from "@/components/ui/Button";
import { CurrencyGlyph } from "@/components/ui/Currency";
import { useController, useProfileRef, useUi } from "@/hooks/useGame";
import { replayClass, useShake } from "@/hooks/useShake";
import { useShortScreen } from "@/hooks/useShortScreen";
import { EQUIP_SLOTS, type EquipSlot } from "@/game/data/ids";
import { EQUIPMENT_TEMPLATES, SLOT_LABEL, STAT_LABEL } from "@/game/data/equipment";
import { GEAR_EFFECTS } from "@/game/data/gearEffects";
import { EQUIPMENT_LEVEL_CAP, FUSE_COUNT, equipmentUpgradeCost, fusionSet, itemScore, salvageValue } from "@/game/economy/loot";
import { RARITY_ORDER } from "@/game/data/ids";
import { setOf } from "@/game/data/gearSets";
import type { EquipmentItem } from "@/game/progression/profile";
import { itemStatTotals } from "@/game/progression/stats";
import { fmt, fmtStat } from "@/lib/format";
import { cn } from "@/lib/cn";

const SLOT_ICON: Record<EquipSlot, IconName> = { weapon: "sword", helm: "helm", chest: "chest", gloves: "gloves", boots: "boots", relic: "relic" };
const RARITY_VAR: Record<string, string> = { common: "var(--color-common)", uncommon: "var(--color-uncommon)", rare: "var(--color-rare)", epic: "var(--color-epic)", legendary: "var(--color-legendary)" };
const RARITY_WORD: Record<string, string> = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary" };
const BAG_CAP = 24;

/**
 * Left: the six equipped slots. Right: the bag, or the selected item's detail in its place.
 * The bag is the default view; tapping a square opens its detail, "Bag" returns to it.
 */
export default function GearPanel() {
  const c = useController();
  const profile = useProfileRef();
  const selectedUid = useUi((u) => u.selectedItem);
  const short = useShortScreen();
  const inv = profile.equipment.inventory;
  const equipped = profile.equipment.equipped;
  const equippedUids = new Set(Object.values(equipped));
  const bag = inv.filter((i) => !equippedUids.has(i.uid)).sort((a, b) => itemScore(b) - itemScore(a));
  const selected = inv.find((i) => i.uid === selectedUid) ?? null;
  const sq = short ? 46 : 52;
  const gap = short ? 6 : 8;
  return (
    <div className={cn("flex h-full min-h-0 px-4", short ? "pt-3 pb-2 gap-3" : "pt-4 pb-3 gap-4")} style={{ ["--sq" as string]: `${sq}px`, ["--gap" as string]: `${gap}px` }}>
      <div className="flex flex-col shrink-0">
        <span className="t-label text-t2 mb-2">Equipped</span>
        <div className="grid grid-cols-2" style={{ gap }}>
          {EQUIP_SLOTS.map((slot) => {
            const uid = equipped[slot];
            const item = uid ? inv.find((i) => i.uid === uid) : undefined;
            return <EquippedSlot key={slot} slot={slot} item={item} selected={!!uid && selectedUid === uid} onSelect={() => item && c.selectItem(item.uid)} />;
          })}
        </div>
      </div>
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {selected ? (
          <ItemDetail item={selected} equippedUid={equipped[selected.slot]} inv={inv} gold={profile.player.gold} short={short} onBack={() => c.selectItem(null)} />
        ) : (
          <>
            <span className="t-label text-t2 mb-2 tnum">
              Bag <span className="text-t3">{bag.length} of {BAG_CAP}</span>
            </span>
            {bag.length === 0 ? (
              <div className="flex-1 flex flex-col justify-center gap-1 pb-2">
                <span className="t-body text-t1">Bosses drop gear.</span>
                <span className="t-label text-t2">Every boss leaves a piece; enemies drop the rest. Equip it here.</span>
                {/* A next step, not a dead end: the waiting boss, or the Rift to hunt one. */}
                <Button size="sm" variant="quiet" className="mt-3 self-start" onClick={() => (profile.progress.bossGate ? c.openBossChallenge() : c.setPanel("rift"))} data-testid="gear-empty-next">
                  {profile.progress.bossGate ? "Face the boss" : "Find a boss"}
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-3 min-[360px]:grid-cols-4 content-start overflow-y-auto no-scrollbar min-h-0 -mx-1 px-1 pb-1" style={{ gap, gridAutoRows: sq, touchAction: "pan-y" }}>
                {bag.map((item, i) => (
                  // The equip lesson points at the best piece first, then at Equip in its detail.
                  <ItemSquare key={item.uid} item={item} onSelect={() => c.selectItem(item.uid)} guide={i === 0 ? "equip-item" : undefined} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function templateName(item: EquipmentItem): string {
  return EQUIPMENT_TEMPLATES.find((t) => t.id === item.templateId)?.name ?? item.templateId;
}

/** A square: bg-2, radius 14, rarity as a 2px bottom edge, the glyph and "+7". */
function ItemSquare({ item, onSelect, selected, guide }: { item: EquipmentItem; onSelect: () => void; selected?: boolean; guide?: string }) {
  return (
    <button className={cn("press relative flex items-center justify-center overflow-hidden rounded-[14px]", selected ? "bg-bg-3" : "bg-bg-2")} style={{ width: "100%", maxWidth: "var(--sq)", height: "var(--sq)" }} onClick={onSelect} aria-label={`${templateName(item)}, ${item.rarity}, plus ${item.level}`} data-testid="bag-item" data-guide={guide}>
      <Icon name={SLOT_ICON[item.slot]} size={20} className="text-t1" />
      <span className="absolute bottom-1 right-1.5 t-caption tnum text-t2">+{item.level}</span>
      {item.effect && <span className="absolute left-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />}
      <span className="absolute inset-x-0 bottom-0 h-[2px]" style={{ background: RARITY_VAR[item.rarity] }} aria-hidden="true" />
    </button>
  );
}

function EquippedSlot({ slot, item, selected, onSelect }: { slot: EquipSlot; item: EquipmentItem | undefined; selected: boolean; onSelect: () => void }) {
  const box = useRef<HTMLSpanElement>(null);
  const ring = useRef<HTMLSpanElement>(null);
  const lastUid = useRef(item?.uid);
  // Equip: the square settles from 0.9 while a rarity ring fades out over 320ms.
  useEffect(() => {
    if (item && item.uid !== lastUid.current) {
      replayClass(box.current, "equip-pop");
      replayClass(ring.current, "equip-ring");
    }
    lastUid.current = item?.uid;
  }, [item]);
  return (
    <span ref={box} className="relative block" style={{ width: "var(--sq)", height: "var(--sq)" }}>
      <button
        className={cn("press relative flex h-full w-full items-center justify-center overflow-hidden rounded-[14px]", selected ? "bg-bg-3" : "bg-bg-2")}
        onClick={onSelect}
        aria-label={`${SLOT_LABEL[slot]}${item ? `: ${templateName(item)}` : ", empty"}`}
        data-testid={`slot-${slot}`}
      >
        <Icon name={SLOT_ICON[slot]} size={20} className={item ? "text-t1" : "text-t3"} />
        {item && <span className="absolute bottom-1 right-1.5 t-caption tnum text-t2">+{item.level}</span>}
        {item && <span className="absolute inset-x-0 bottom-0 h-[2px]" style={{ background: RARITY_VAR[item.rarity] }} aria-hidden="true" />}
      </button>
      <span ref={ring} className="pointer-events-none absolute -inset-[3px] rounded-[16px] opacity-0" style={{ boxShadow: `inset 0 0 0 2px ${item ? RARITY_VAR[item.rarity] : "transparent"}` }} aria-hidden="true" />
    </span>
  );
}

function ItemDetail({ item, equippedUid, inv, gold, short, onBack }: { item: EquipmentItem; equippedUid: string | undefined; inv: EquipmentItem[]; gold: number; short: boolean; onBack: () => void }) {
  const c = useController();
  const profile = useProfileRef();
  const isEquipped = equippedUid === item.uid;
  const current = equippedUid && !isEquipped ? inv.find((i) => i.uid === equippedUid) : undefined;
  const totals = itemStatTotals(item);
  const currentTotals = current ? itemStatTotals(current) : {};
  const cost = equipmentUpgradeCost(item);
  const capped = item.level >= EQUIPMENT_LEVEL_CAP;
  const affordable = gold >= cost;
  const template = EQUIPMENT_TEMPLATES.find((t) => t.id === item.templateId);
  const set = setOf(item.templateId);
  const [pill, shake] = useShake<HTMLSpanElement>();
  // Pieces of this set worn, counting this item as if it were equipped in its slot.
  const setWorn = set
    ? Object.entries(profile.equipment.equipped).filter(([slot, uid]) => {
        if (slot === item.slot) return false;
        const it = inv.find((x) => x.uid === uid);
        return it ? set.pieces.includes(it.templateId) : false;
      }).length + 1
    : 0;
  const fuse = fusionSet(profile, item.uid);
  const nextRarity = RARITY_ORDER[Math.min(RARITY_ORDER.length - 1, RARITY_ORDER.indexOf(item.rarity) + 1)]!;
  type K = keyof typeof STAT_LABEL;
  const main = item.mainStat as K;
  const diffOf = (k: K) => (totals[k] ?? 0) - (currentTotals[k] ?? 0);
  const lost = current ? (Object.keys(currentTotals) as K[]).filter((k) => !(k in totals)) : [];
  const h = short ? "h-11" : "h-[52px]";
  return (
    <div className="flex flex-col flex-1 min-h-0" data-testid="item-detail">
      <div className="flex items-center justify-between gap-2 shrink-0">
        <span className="t-eyebrow truncate" style={{ color: RARITY_VAR[item.rarity] }}>
          {RARITY_WORD[item.rarity]} · {SLOT_LABEL[item.slot]} +{item.level}
        </span>
        <button className="press -my-3 -mr-2 flex h-11 items-center gap-1 rounded-[10px] px-2 t-label text-t2 shrink-0" onClick={onBack} aria-label="Back to the bag">
          <Icon name="close" size={14} />
          <span className="hidden min-[360px]:inline">Bag</span>
        </button>
      </div>
      <span className="t-name text-t1 truncate mt-1 shrink-0">{templateName(item)}</span>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 shrink-0">
        <span className="flex items-baseline gap-1.5">
          <span className="t-num-l text-t1">{fmtStat(main, totals[main] ?? 0)}</span>
          <span className="t-label text-t2">{STAT_LABEL[main]}</span>
          {current && diffOf(main) !== 0 && <Delta v={diffOf(main)} k={main} />}
        </span>
      </div>
      {!short && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 t-label text-t2 shrink-0">
          {(Object.keys(totals) as K[])
            .filter((k) => k !== main)
            .map((k) => (
              <span key={k} className="tnum whitespace-nowrap">
                {STAT_LABEL[k]} <span className="text-t1">{fmtStat(k, totals[k] ?? 0)}</span>
                {current && diffOf(k) !== 0 && <Delta v={diffOf(k)} k={k} />}
              </span>
            ))}
          {lost.map((k) => (
            <span key={k} className="tnum whitespace-nowrap text-threat">
              {STAT_LABEL[k]} −{fmtStat(k, currentTotals[k] ?? 0)}
            </span>
          ))}
        </div>
      )}
      {fuse ? (
        <button className="press mt-2 flex h-11 w-full items-center justify-between gap-2 rounded-[14px] bg-bg-2 px-3 shrink-0" onClick={() => c.fuseItem(item.uid)} aria-label={`Forge ${FUSE_COUNT} ${item.rarity} items into one ${nextRarity}`} data-testid="fuse-button">
          <span className="t-label text-t1 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />
            Forge {FUSE_COUNT}
          </span>
          <span className="t-label truncate">
            <span style={{ color: RARITY_VAR[item.rarity] }}>{RARITY_WORD[item.rarity]}</span>
            <span className="text-t3"> to </span>
            <span style={{ color: RARITY_VAR[nextRarity] }}>{RARITY_WORD[nextRarity]}</span>
          </span>
        </button>
      ) : item.effect ? (
        <div className="mt-1 t-label text-t2 line-clamp-2 shrink-0" data-testid="item-effect" title={GEAR_EFFECTS[item.effect].description}>
          <span className="text-gold">{GEAR_EFFECTS[item.effect].name}.</span> {GEAR_EFFECTS[item.effect].description}
        </div>
      ) : set ? (
        <div className="mt-1 t-label text-t2 truncate shrink-0" data-testid="item-set" title={template?.flavour}>
          <span className="text-t1">{set.name}</span> <span className="tnum">{setWorn} of {set.pieces.length}</span>
          <span className={setWorn >= 2 ? "text-jade" : "text-t3"}> · 2: +{Math.round(set.two.pct * 100)}% {STAT_LABEL[set.two.stat]}</span>
        </div>
      ) : (
        template && !short && <div className="mt-1 font-serif italic text-[14px] leading-[18px] text-t2 truncate shrink-0">{template.flavour}</div>
      )}
      <div className="mt-auto flex items-center gap-2 pt-2 shrink-0">
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
          label={capped ? "Item at its cap" : `Upgrade item for ${cost} gold`}
        >
          <span className="t-label text-t1">Upgrade</span>
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

function Delta({ v, k }: { v: number; k: keyof typeof STAT_LABEL }) {
  return <span className={cn("t-label font-semibold tnum", v > 0 ? "text-jade" : "text-threat")}>{v > 0 ? `+${fmtStat(k, v)}` : `−${fmtStat(k, -v)}`}</span>;
}
