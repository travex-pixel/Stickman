"use client";

import { useEffect } from "react";
import { HoldButton } from "@/components/ui/HoldButton";
import { Button } from "@/components/ui/Button";
import { Stat } from "@/components/ui/Stat";
import { CurrencyGlyph } from "@/components/ui/Currency";
import { SummonPortrait } from "@/components/ui/Portrait";
import { useController, useProfileRef, useUi } from "@/hooks/useGame";
import { useShake } from "@/hooks/useShake";
import { useShortScreen } from "@/hooks/useShortScreen";
import { collectibleSummons, ROLE_INFO, summonDef } from "@/game/data/summons";
import { codexBonus, codexMultiplier, ownedSpecies, speciesStars } from "@/game/summons/extraction";
import { fmtCodex } from "@/components/rewards/ModalHost";
import { STAT_LABEL } from "@/game/data/equipment";
import { computeModifiers } from "@/game/progression/stats";
import { bondCost, BOND_CAP, canStarUp, checkEvolution, starCost, summonStats } from "@/game/summons/progression";
import { REFINE_SHARDS, spareShards } from "@/game/summons/progression";
import type { Profile } from "@/game/progression/profile";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/cn";

type Instance = Profile["summons"]["collection"][number];

const RARITY_VAR: Record<string, string> = { common: "var(--color-common)", uncommon: "var(--color-uncommon)", rare: "var(--color-rare)", epic: "var(--color-epic)", legendary: "var(--color-legendary)" };
const RARITY_WORD: Record<string, string> = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary" };

/** Objective: field the best army and grow it. Primary action: Deploy. */
export default function SummonsPanel() {
  const c = useController();
  const profile = useProfileRef();
  const selectedId = useUi((u) => u.selectedSummon);
  const short = useShortScreen();
  const collection = profile.summons.collection;
  const slots = computeModifiers(profile).deploySlots;
  const deployedCount = collection.filter((s) => s.deployed).length;
  const selected = collection.find((s) => s.instanceId === selectedId) ?? collection[0] ?? null;

  useEffect(() => {
    if (!selectedId && collection[0]) c.selectSummon(collection[0].instanceId);
  }, [selectedId, collection, c]);

  if (collection.length === 0) return <EmptyArmy />;

  const owned = ownedSpecies(profile).filter((id) => !summonDef(id).hidden).length;
  return (
    <div className={cn("flex flex-col h-full min-h-0 px-4", short ? "pt-3 pb-2" : "pt-4 pb-3")}>
      <div className="flex items-baseline justify-between gap-3 shrink-0 t-label">
        <span className="text-t2 whitespace-nowrap">
          Deployed{" "}
          <span className="text-t1 tnum" data-testid="deploy-count">
            {deployedCount} of {slots}
          </span>
        </span>
        <span className="text-t2 truncate min-w-0" title="Oath Codex: permanent bonuses from every shadow you have bound">
          {codexSummary(profile)}
        </span>
        <span className="text-t3 tnum whitespace-nowrap hidden min-[380px]:inline">
          {owned} of {collectibleSummons().length}
        </span>
      </div>
      <div className={cn("flex gap-3 overflow-x-auto no-scrollbar shrink-0 -mx-4 px-4", short ? "mt-2" : "mt-3")} style={{ touchAction: "pan-x" }}>
        {collection.map((s) => (
          <RosterDisc key={s.instanceId} s={s} selected={selected?.instanceId === s.instanceId} short={short} onSelect={() => c.selectSummon(s.instanceId)} />
        ))}
      </div>
      {selected && <ShadowDetail inst={selected} slots={slots} deployedCount={deployedCount} short={short} />}
    </div>
  );
}

/** A 2px rarity ring around the portrait, a jade dot when deployed, the level underneath. */
function RosterDisc({ s, selected, short, onSelect }: { s: Instance; selected: boolean; short: boolean; onSelect: () => void }) {
  const def = summonDef(s.defId);
  const size = short ? 44 : 48;
  return (
    <button className="press relative flex shrink-0 flex-col items-center rounded-full" onClick={onSelect} data-testid={`summon-card-${s.defId}`} aria-label={`${def.name}, level ${s.level}${s.deployed ? ", deployed" : ""}`} aria-pressed={selected}>
      <span className="relative rounded-full" style={{ width: size, height: size, boxShadow: selected ? `0 0 0 2px var(--color-bg-1), 0 0 0 3.5px var(--color-t1)` : undefined }}>
        <SummonPortrait defId={s.defId} size={size} round />
        <span className="pointer-events-none absolute inset-0 rounded-full" style={{ boxShadow: `inset 0 0 0 2px ${RARITY_VAR[def.rarity]}` }} aria-hidden="true" />
        {s.deployed && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg-1 bg-jade" aria-hidden="true" />}
      </span>
      {!short && <span className={cn("t-caption tnum mt-1", selected ? "text-t1" : "text-t3")}>Lv {s.level}</span>}
    </button>
  );
}

function ShadowDetail({ inst, slots, deployedCount, short }: { inst: Instance; slots: number; deployedCount: number; short: boolean }) {
  const c = useController();
  const profile = useProfileRef();
  const def = summonDef(inst.defId);
  const mods = computeModifiers(profile);
  const stats = summonStats(inst, { damageMult: mods.summonDamageMult, defenseMult: mods.summonDefenseMult, hpMult: mods.summonHpMult });
  const evo = checkEvolution(inst, profile.player.riftCores);
  const star = starCost(inst);
  const starReady = canStarUp(inst, profile.player.riftCores);
  const cost = bondCost(inst.bond);
  const bondMax = inst.bond >= BOND_CAP;
  const canBond = !bondMax && profile.player.essence >= cost;
  const canDeploy = inst.deployed || deployedCount < slots;
  const starsNow = speciesStars(profile).get(inst.defId) ?? 0;
  const [bondPill, shakeBond] = useShake<HTMLSpanElement>();
  const h = short ? "h-11" : "h-[52px]";
  return (
    <div className={cn("flex flex-col flex-1 min-h-0", short ? "mt-2" : "mt-3")}>
      <div className="flex items-end justify-between gap-3 shrink-0">
        <div className="flex flex-col min-w-0">
          <span className="t-eyebrow truncate" style={{ color: RARITY_VAR[def.rarity] }}>
            {RARITY_WORD[def.rarity]} · {ROLE_INFO[def.role].label}
            {(inst.stars ?? 0) > 0 && <span className="text-gold"> · {"★".repeat(inst.stars ?? 0)}</span>}
          </span>
          <span className="t-name text-t1 truncate mt-1">{def.name}</span>
        </div>
        <div className="flex gap-4 shrink-0">
          <Stat label="Health" value={stats.maxHp} />
          <Stat label="Attack" value={stats.attack} className="hidden min-[360px]:flex" />
        </div>
      </div>
      {!short && (
        <div className="t-label text-t2 truncate mt-1 shrink-0" title={def.active.description}>
          <span className="text-t1">{def.active.name}</span>
          <span className="text-t3"> · </span>
          <span data-testid="codex-line">
            Codex +{fmtCodex(def.owned, codexMultiplier(starsNow))}
            {(inst.stars ?? 0) < 5 && <span className="text-t3"> · next star +{fmtCodex(def.owned, codexMultiplier(starsNow + 1))}</span>}
          </span>
        </div>
      )}
      <div className="mt-auto flex items-center gap-2 pt-3 shrink-0">
        {inst.deployed ? (
          <Button variant="quiet" className={cn(h, "shrink-0 px-4")} onClick={() => c.deploySummon(inst.instanceId, false)} data-testid="deploy-button">
            Recall
          </Button>
        ) : (
          <Button variant="primary" className={cn(h, "shrink-0 px-5")} disabled={!canDeploy} onClick={() => c.deploySummon(inst.instanceId, true)} data-guide="deploy-summon" data-testid="deploy-button" aria-label={canDeploy ? "Deploy" : `Deploy: all ${slots} places are taken`}>
            Deploy
          </Button>
        )}
        <HoldButton
          onRepeat={() => c.upgradeBond(inst.instanceId)}
          disabled={!canBond}
          onDenied={bondMax ? undefined : () => (shakeBond(), c.audio.play("error", { volume: 0.3, minInterval: 200 }))}
          feedback="scale"
          className={cn(h, "flex-1 min-w-0 rounded-[14px] bg-bg-2 flex flex-col items-center justify-center", bondMax && "opacity-40")}
          testId="bond-upgrade"
          label={bondMax ? `Bond ${inst.bond}, at its cap` : `Strengthen bond for ${cost} essence`}
        >
          <span className="t-label text-t1">Bond {inst.bond}</span>
          <span ref={bondPill} className={cn("flex items-center gap-1.5 t-caption tnum", canBond ? "text-jade" : "text-t3")}>
            {bondMax ? (
              "Max"
            ) : (
              <>
                <CurrencyGlyph kind="essence" size={6} className={canBond ? undefined : "!bg-t3"} />
                {fmt(cost)}
              </>
            )}
          </span>
        </HoldButton>
        <button
          className={cn("press flex flex-col items-center justify-center rounded-[14px] bg-bg-2 px-3 shrink-0 min-w-11", h, !star && "opacity-40")}
          onClick={() => c.starUp(inst.instanceId)}
          disabled={!star}
          data-testid="star-button"
          aria-label={star ? `Star up for ${star.shards} shards${star.cores ? ` and ${star.cores} Rift Cores` : ""}` : "Max stars"}
        >
          <span className="t-label text-t1 flex items-center gap-1.5">
            {starReady && <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />}
            Star
          </span>
          <span className={cn("t-caption tnum", starReady ? "text-gold" : "text-t3")}>{!star ? "Max" : starReady ? "Ready" : `${Math.min(inst.shards, star.shards)}/${star.shards}`}</span>
        </button>
        {def.evolution && (
          <button className={cn("press flex flex-col items-center justify-center rounded-[14px] bg-bg-2 px-3 shrink-0 min-w-11", h)} onClick={() => c.evolve(inst.instanceId)} title={evo.reasons.join(", ")} data-testid="evolve-button" aria-label={evo.possible ? "Evolve, ready" : `Evolve: ${evo.reasons.join(", ")}`}>
            <span className="t-label text-t1 flex items-center gap-1.5">
              {evo.possible && <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />}
              Evolve
            </span>
            <span className={cn("t-caption tnum", evo.possible ? "text-gold" : "text-t3")}>{evo.possible ? "Ready" : `Lv ${def.evolution.requiredLevel}`}</span>
          </button>
        )}
        {spareShards(inst) >= REFINE_SHARDS && (
          <button className="press flex flex-col items-center justify-center rounded-[14px] bg-bg-2 px-3 shrink-0 min-w-11" style={{ height: short ? 44 : 52 }} onClick={() => c.refineShards(inst.instanceId)} data-testid="refine-shards" aria-label={`Refine ${REFINE_SHARDS} spare shards into a Rift Core`}>
            <span className="t-label text-t1">Refine</span>
            <span className="t-caption tnum text-t3 flex items-center gap-1">
              <CurrencyGlyph kind="core" size={6} />
              {REFINE_SHARDS}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

/** Before the first BIND: say what the Oathbound are and how to get one. */
function EmptyArmy() {
  return (
    <div className="flex flex-col h-full items-center justify-center gap-4 px-8 text-center">
      <div className="flex gap-3" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-12 w-12 rounded-full bg-bg-2" style={{ opacity: 1 - i * 0.3 }} />
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <span className="t-title text-t1">No shadows yet</span>
        <span className="t-body text-t2">Marked enemies leave an essence when they fall. Tap BIND before it fades.</span>
      </div>
    </div>
  );
}

function codexSummary(profile: Profile): string {
  const b = codexBonus(profile);
  const parts = (Object.entries(b) as [keyof typeof b, number][]).filter(([, v]) => v > 0).map(([k, v]) => `+${Math.round(v * 100)}% ${STAT_LABEL[k].replace("Critical ", "Crit ")}`);
  return parts.length ? `Codex ${parts.slice(0, 2).join(", ")}${parts.length > 2 ? " …" : ""}` : "";
}
