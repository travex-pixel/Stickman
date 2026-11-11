"use client";

import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { HoldButton } from "@/components/ui/HoldButton";
import { useController, useProfileRef, useUi } from "@/hooks/useGame";
import { EQUIP_SLOTS, type EquipSlot } from "@/game/data/ids";
import { EQUIPMENT_TEMPLATES, SLOT_LABEL, STAT_LABEL } from "@/game/data/equipment";
import { GEAR_EFFECTS } from "@/game/data/gearEffects";
import { EQUIPMENT_LEVEL_CAP, equipmentUpgradeCost, itemScore, salvageValue } from "@/game/economy/loot";
import type { EquipmentItem } from "@/game/progression/profile";
import { itemStatTotals } from "@/game/progression/stats";
import { fmt, fmtStat } from "@/lib/format";
import { cn } from "@/lib/cn";

const SLOT_ICON: Record<EquipSlot, IconName> = { weapon: "sword", helm: "helm", chest: "chest", gloves: "gloves", boots: "boots", relic: "relic" };
const PAGE = 8;

export default function GearPanel() {
  const c = useController();
  const profile = useProfileRef();
  const selectedUid = useUi((u) => u.selectedItem);
  const [page, setPage] = useState(0);
  const inv = profile.equipment.inventory;
  const equipped = profile.equipment.equipped;
  const equippedUids = new Set(Object.values(equipped));
  const bag = inv.filter((i) => !equippedUids.has(i.uid)).sort((a, b) => itemScore(b) - itemScore(a));
  const pages = Math.max(1, Math.ceil(bag.length / PAGE));
  const selected = inv.find((i) => i.uid === selectedUid) ?? null;

  useEffect(() => {
    if (page >= pages) setPage(pages - 1);
  }, [page, pages]);
  useEffect(() => {
    if (!selectedUid && bag[0]) c.selectItem(bag[0].uid);
  }, [selectedUid, bag, c]);

  return (
    <div className="flex h-full min-h-0 gap-2 px-2 pt-1.5 pb-1.5">
      <div className="flex flex-col gap-1.5 shrink-0">
        <span className="caps px-0.5">EQUIPPED</span>
        <div className="grid grid-cols-2 gap-1">
          {EQUIP_SLOTS.map((slot) => {
            const uid = equipped[slot];
            const item = uid ? inv.find((i) => i.uid === uid) : undefined;
            return (
              <button key={slot} className={cn("card h-[38px] w-[44px] flex items-center justify-center", item && `border-rarity-${item.rarity}`, selectedUid === uid && uid && "card-active")} onClick={() => item && c.selectItem(item.uid)} aria-label={`${SLOT_LABEL[slot]}${item ? `: ${templateName(item)}` : ", empty"}`} data-testid={`slot-${slot}`}>
                <Icon name={SLOT_ICON[slot]} size={16} className={item ? `rarity-${item.rarity}` : "text-mist/40"} />
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="caps">BAG {bag.length}/24</span>
          {pages > 1 && (
            <div className="flex items-center gap-1 text-[10px] text-mist">
              <button className="px-1.5 py-0.5 rounded border border-white/10" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} aria-label="Previous page">‹</button>
              <span>{page + 1}/{pages}</span>
              <button className="px-1.5 py-0.5 rounded border border-white/10" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} aria-label="Next page">›</button>
            </div>
          )}
        </div>
        {bag.length === 0 && !selected ? (
          <div className="flex-1 flex items-center justify-center text-center text-[10px] text-mist px-2 leading-snug">Equipment falls from enemies and always from the Warden. Equip it here.</div>
        ) : (
          <div className="grid grid-cols-4 gap-1 shrink-0">
            {bag.slice(page * PAGE, page * PAGE + PAGE).map((item) => (
              <button key={item.uid} className={cn("card h-[34px] flex items-center justify-center relative", `border-rarity-${item.rarity}`, selectedUid === item.uid && "card-active")} onClick={() => c.selectItem(item.uid)} aria-label={templateName(item)} data-testid="bag-item">
                <Icon name={SLOT_ICON[item.slot]} size={15} className={`rarity-${item.rarity}`} />
                <span className="absolute bottom-0 right-1 text-[10px] text-mist">+{item.level}</span>
                {item.effect && <span className="absolute top-0.5 left-1 text-[10px] text-gold-2">✦</span>}
              </button>
            ))}
          </div>
        )}
        {selected && <ItemDetail item={selected} equippedUid={equipped[selected.slot]} inv={inv} gold={profile.player.gold} />}
      </div>
    </div>
  );
}

function templateName(item: EquipmentItem): string {
  return EQUIPMENT_TEMPLATES.find((t) => t.id === item.templateId)?.name ?? item.templateId;
}

function ItemDetail({ item, equippedUid, inv, gold }: { item: EquipmentItem; equippedUid: string | undefined; inv: EquipmentItem[]; gold: number }) {
  const c = useController();
  const isEquipped = equippedUid === item.uid;
  const current = equippedUid && !isEquipped ? inv.find((i) => i.uid === equippedUid) : undefined;
  const totals = itemStatTotals(item);
  const currentTotals = current ? itemStatTotals(current) : {};
  const cost = equipmentUpgradeCost(item);
  const capped = item.level >= EQUIPMENT_LEVEL_CAP;
  const template = EQUIPMENT_TEMPLATES.find((t) => t.id === item.templateId);
  return (
    <div className={cn("card flex-1 min-h-0 p-1.5 flex flex-col gap-1", `border-rarity-${item.rarity}`)} data-testid="item-detail">
      <div className="flex items-baseline justify-between gap-1 leading-tight">
        <span className={cn("text-[11px] font-bold truncate", `rarity-${item.rarity}`)}>{templateName(item)}</span>
        <span className="text-[10px] text-mist shrink-0">{SLOT_LABEL[item.slot]} +{item.level}</span>
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px]">
        {(Object.entries(totals) as [keyof typeof STAT_LABEL, number][]).map(([k, v]) => {
          const diff = v - (currentTotals[k] ?? 0);
          return (
            <span key={k} className="text-ivory">
              {STAT_LABEL[k]} <b>{fmtStat(k, v)}</b>
              {current && diff !== 0 && <span className={diff > 0 ? "text-jade-2" : "text-crimson-2"}> ({diff > 0 ? "+" : ""}{fmtStat(k, diff)})</span>}
            </span>
          );
        })}
        {current &&
          (Object.keys(currentTotals) as (keyof typeof STAT_LABEL)[])
            .filter((k) => !(k in totals))
            .map((k) => (
              <span key={k} className="text-crimson-2">
                {STAT_LABEL[k]} -{fmtStat(k, currentTotals[k] ?? 0)}
              </span>
            ))}
      </div>
      {item.effect && (
        <div className="text-[10px] leading-snug" data-testid="item-effect">
          <span className="font-display text-[12px] text-gold-2">{GEAR_EFFECTS[item.effect].name}.</span> <span className="text-ivory/85">{GEAR_EFFECTS[item.effect].description}</span>
        </div>
      )}
      {template && <div className="text-[10px] italic text-mist truncate">{template.flavour}</div>}
      <div className="mt-auto flex items-center gap-1">
        {!isEquipped ? (
          <button className="btn-primary flex-1 !py-1.5 text-[11px]" onClick={() => c.equipItem(item.uid)} data-guide="equip-item" data-testid="equip-button">
            EQUIP
          </button>
        ) : (
          <button className="btn-ghost flex-1 !py-1.5 text-[11px]" onClick={() => c.unequipSlot(item.slot)} data-testid="unequip-button">
            UNEQUIP
          </button>
        )}
        <HoldButton onRepeat={() => c.upgradeItem(item.uid)} disabled={capped || gold < cost} className="h-[32px] px-2" testId="item-upgrade" label={`Upgrade item for ${cost} gold`}>
          <span className="flex flex-col items-center leading-none">
            <span className="caps text-gold-2 !text-[10px]">Hold</span>
            <span className={cn("flex items-center gap-0.5 text-[10px] font-bold", gold >= cost ? "text-gold" : "text-crimson-2")}>
              <Icon name="coin" size={10} />
              {capped ? "MAX" : fmt(cost)}
            </span>
          </span>
        </HoldButton>
        <button className="btn-ghost !px-2 !py-1.5 text-[10px] text-mist" onClick={() => c.salvageItem(item.uid)} aria-label={`Salvage for ${salvageValue(item)} gold`} data-testid="salvage-button">
          <Icon name="coin" size={12} className="text-gold inline" /> {salvageValue(item)}
        </button>
      </div>
    </div>
  );
}
