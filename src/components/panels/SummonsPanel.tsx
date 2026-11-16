"use client";

import { useEffect, useState } from "react";
import { HoldButton } from "@/components/ui/HoldButton";
import { Button } from "@/components/ui/Button";
import { Stat } from "@/components/ui/Stat";
import { CurrencyGlyph } from "@/components/ui/Currency";
import { SummonPortrait } from "@/components/ui/Portrait";
import { useController, useProfile, useProfileRef, useUi } from "@/hooks/useGame";
import { armySynergies, synergiesGained, synergyEffect } from "@/lib/synergy";
import { Icon } from "@/components/ui/Icon";
import { useShake } from "@/hooks/useShake";
import { useShortScreen } from "@/hooks/useShortScreen";
import { useCompactFit } from "@/hooks/useCompactFit";
import { collectibleSummons, ROLE_INFO, summonDef } from "@/game/data/summons";
import { codexBonus, codexMultiplier, ownedSpecies, speciesStars } from "@/game/summons/extraction";
import { fmtCodex } from "@/lib/codex";
import { usePanelDetent, useRaisePanel } from "@/hooks/usePanelDetent";
import { STAT_LABEL } from "@/game/data/equipment";
import { computeModifiers } from "@/game/progression/stats";
import { bondCost, BOND_CAP, canStarUp, checkEvolution, starCost, summonStats } from "@/game/summons/progression";
import { REFINE_SHARDS, spareShards } from "@/game/summons/progression";
import type { Profile } from "@/game/progression/profile";
import { armyStrength, bestLineup, currentLineup, swapOptions, type SwapOption } from "@/game/progression/army";
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
  const collection = profile.summons.collection;
  const slots = computeModifiers(profile).deploySlots;
  const deployedCount = collection.filter((s) => s.deployed).length;
  const selected = collection.find((s) => s.instanceId === selectedId) ?? collection[0] ?? null;
  // Compact on short screens, and wherever the full layout would push the actions off the panel
  // (measured: 360x740 did, though it is not "short").
  const [root, tight] = useCompactFit<HTMLDivElement>(`${selected?.instanceId}:${selected?.deployed}:${collection.length}`);
  const short = useShortScreen() || tight;

  useEffect(() => {
    if (!selectedId && collection[0]) c.selectSummon(collection[0].instanceId);
  }, [selectedId, collection, c]);

  if (collection.length === 0) return <EmptyArmy />;

  const owned = ownedSpecies(profile).filter((id) => !summonDef(id).hidden).length;
  const lineup = currentLineup(profile);
  const fieldedIds = new Set(lineup.map((x) => x.instanceId));
  const fielded = collection.filter((x) => fieldedIds.has(x.instanceId));
  const bench = collection.filter((x) => !fieldedIds.has(x.instanceId));
  return (
    <div ref={root} className={cn("flex flex-col h-full min-h-0 px-4", short ? "pt-2 pb-2" : "pt-3 pb-3")}>
      <ArmyHeader profile={profile} slots={slots} deployedCount={deployedCount} owned={owned} />
      <div className={cn("flex gap-3 overflow-x-auto no-scrollbar shrink-0 -mx-4 px-4", short ? "mt-1" : "mt-2")} style={{ touchAction: "pan-x" }} data-testid="army-roster">
        <RosterGroup label={`Fielded ${fielded.length}/${slots}`} testId="roster-fielded" short={short}>
          {fielded.map((s) => (
            <RosterDisc key={s.instanceId} s={s} selected={selected?.instanceId === s.instanceId} short={short} onSelect={() => c.selectSummon(s.instanceId)} />
          ))}
          {fielded.length === 0 && <span className="t-caption text-t3 self-center whitespace-nowrap">No one yet</span>}
        </RosterGroup>
        {bench.length > 0 && (
          <>
            <span className="w-px shrink-0 self-stretch bg-[var(--line-2)]" aria-hidden="true" />
            <RosterGroup label={`Bench ${bench.length}`} testId="roster-bench" short={short}>
              {bench.map((s) => (
                <RosterDisc key={s.instanceId} s={s} selected={selected?.instanceId === s.instanceId} short={short} onSelect={() => c.selectSummon(s.instanceId)} />
              ))}
            </RosterGroup>
          </>
        )}
      </div>
      {selected && <ShadowDetail key={selected.instanceId} inst={selected} slots={slots} deployedCount={deployedCount} short={short} />}
    </div>
  );
}

/** A labelled run of discs. Compact: the label goes (the divider and order still tell them apart). */
function RosterGroup({ label, testId, short, children }: { label: string; testId: string; short: boolean; children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col" data-testid={testId} role="group" aria-label={label}>
      {!short && <span className="t-caption text-t2 tnum whitespace-nowrap">{label}</span>}
      <div className={cn("flex gap-3", !short && "mt-1")}>{children}</div>
    </div>
  );
}

/**
 * One plain line: how many are fielded, the army's strength, its synergies; a tap opens the detail
 * (each synergy, the Codex). Deploy best at the right, gold with its gain when it would help.
 */
function ArmyHeader({ profile, slots, deployedCount, owned }: { profile: Profile; slots: number; deployedCount: number; owned: number }) {
  const c = useController();
  const [open, setOpen] = useState(false);
  const best = bestLineup(profile);
  const gain = best.now > 0 ? best.strength / best.now - 1 : best.lineup.length > 0 ? 1 : 0;
  const better = best.bring.length > 0 && gain >= 0.005;
  const synergies = armySynergies(profile);
  return (
    <div className="relative z-10 shrink-0">
      <div className="flex items-center justify-between gap-2">
        <button className="press -ml-1 flex h-11 min-w-0 items-center gap-1 rounded-[10px] px-1 t-label text-t2" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="army-summary">
          <span className="truncate">
            Army{" "}
            <span className="text-t1 tnum" data-testid="deploy-count">
              {deployedCount} of {slots}
            </span>
            <span className="tnum">
              {" "}
              · <span className="hidden min-[360px]:inline">Strength </span>
              <span className="text-t1">{fmt(armyStrength(profile, currentLineup(profile)))}</span>
            </span>
            <span className="hidden min-[360px]:inline">
              {" "}
              · {synergies.length} {synergies.length === 1 ? "synergy" : "synergies"}
            </span>
          </span>
          <Icon name="chevron" size={14} className={cn("shrink-0 text-t3 transition-transform", open ? "-rotate-90" : "rotate-90")} />
        </button>
        <button
          className={cn("press flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 t-label", better ? "bg-bg-3 text-gold shadow-[inset_0_0_0_1px_rgba(218,184,108,0.45)]" : "text-t3")}
          onClick={() => c.deployBest()}
          data-testid="deploy-best"
          aria-label={better ? `Deploy best: army +${Math.round(gain * 100)}%` : "Deploy best: your army is already the strongest"}
        >
          {better && <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />}
          <span className="whitespace-nowrap">Deploy best</span>
          {better && <span className="tnum">+{Math.max(1, Math.round(gain * 100))}%</span>}
        </button>
      </div>
      {open && (
        // Over the roster, not pushing it: the actions below stay where they are at every size.
        <div className="absolute inset-x-[-16px] top-11 flex flex-col gap-0.5 bg-bg-1 px-4 pb-2 pt-1 shadow-[0_8px_16px_rgba(0,0,0,0.45),inset_0_-1px_0_var(--line)]" data-testid="army-detail">
          {synergies.length ? (
            synergies.map((x) => (
              <span key={x.id} className="t-label text-t1 flex items-center gap-2 truncate" data-testid="synergy-active">
                <span className="lozenge" aria-hidden="true" />
                <span className="truncate">
                  {x.name}
                  <span className="text-t2"> · {synergyEffect(x)}</span>
                </span>
              </span>
            ))
          ) : (
            <span className="t-label text-t3">No synergies: field roles that work together (Deploy best finds them).</span>
          )}
          <button className="press -mx-1 flex min-h-11 items-center rounded-[10px] px-1 text-left t-label text-t2" onClick={() => c.toast(codexExplain(profile), "info")} data-testid="codex-summary">
            <span className="truncate">
              {codexSummary(profile) || "Codex: none yet"}
              <span className="text-t3 tnum"> · {owned} of {collectibleSummons().length} kinds bound</span>
            </span>
          </button>
        </div>
      )}
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
      {!short && (
        <span className={cn("t-caption tnum mt-1 flex items-center gap-1", selected ? "text-t1" : "text-t2")}>
          {selected && <span className="lozenge" aria-hidden="true" />}
          Lv {s.level}
        </span>
      )}
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
  // Exactly one gold action: whatever is the real next step for this shadow.
  const next: "deploy" | "evolve" | "star" | "bond" | null = !inst.deployed && canDeploy ? "deploy" : evo.possible ? "evolve" : starReady ? "star" : canBond ? "bond" : null;
  const gold = "!bg-gold !text-gold-ink !shadow-none";
  // Into a free place: the synergies it would add. Into a full line-up: a swap, the cheapest first.
  const gains = useProfile((p) => {
    if (inst.deployed || !canDeploy) return "";
    const roles = currentLineup(p).map((x) => summonDef(x.defId).role);
    return synergiesGained(roles, def.role, null).map((x) => x.name).join(", ");
  });
  const swapping = !inst.deployed && !canDeploy;
  const options = swapping ? swapOptions(profile, inst) : [];
  const [outId, setOutId] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const swap = options.find((o) => o.out.instanceId === outId) ?? options[0];
  // A swap needs its line (whom it replaces, what changes) above the actions, and a short screen
  // needs the room for the actions at all: raise the panel for either.
  // (The screen's height, not the measured fit: raising on the fit would re-measure and flip back.)
  const shortScreen = useShortScreen();
  useRaisePanel(swapping || shortScreen);
  const nowStrength = swapping ? armyStrength(profile, currentLineup(profile)) : 0;
  const tall = usePanelDetent() === "tall" && !short;
  return (
    <div className={cn("flex flex-col flex-1 min-h-0", short ? "mt-2" : "mt-3")}>
      <div className="flex items-end justify-between gap-3 shrink-0">
        <div className="flex flex-col min-w-0">
          <span className={cn("t-eyebrow truncate", short && "hidden")} style={{ color: RARITY_VAR[def.rarity] }}>
            {RARITY_WORD[def.rarity]} · {ROLE_INFO[def.role].label}
            {(inst.stars ?? 0) > 0 && <span className="text-gold"> · {"★".repeat(inst.stars ?? 0)}</span>}
          </span>
          <span className={cn("t-name text-t1 truncate", !short && "mt-1")} style={short ? { color: RARITY_VAR[def.rarity] } : undefined}>
            {def.name}
          </span>
        </div>
        {!tall && (
          <div className="flex gap-4 shrink-0">
            <Stat label="Health" value={stats.maxHp} />
            <Stat label="Attack" value={stats.attack} className="hidden min-[360px]:flex" />
          </div>
        )}
      </div>
      {tall && (
        <>
          <p className="t-flavour text-t2 mt-2 shrink-0 line-clamp-2" title={def.active.description}>
            {def.active.name}: {def.active.description}
          </p>
          <div className="mt-4 grid grid-cols-3 gap-3 shrink-0">
            <Stat label="Health" value={stats.maxHp} />
            <Stat label="Attack" value={stats.attack} />
            <Stat label="Bond" value={`${inst.bond}`} />
          </div>
        </>
      )}
      {swapping && swap && (choosing ? <SwapChooser options={options} now={nowStrength} selected={swap.out.instanceId} onPick={(id) => (setOutId(id), setChoosing(false))} /> : <SwapLine swap={swap} now={nowStrength} onChange={() => setChoosing(true)} />)}
      {!short && !swapping && (
        <div className="t-label text-t2 truncate mt-1 shrink-0" title={def.active.description}>
          {!tall && (
            <>
              <span className="text-t1">{def.active.name}</span>
              <span className="text-t2"> · </span>
            </>
          )}
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
        ) : swapping && swap ? (
          <Button variant="primary" className={cn(h, "shrink-0 px-4 flex-col !gap-0")} onClick={() => c.swapSummon(inst.instanceId, swap.out.instanceId)} data-testid="swap-button" aria-label={`Swap in for ${summonDef(swap.out.defId).name}`}>
            Swap in
            <span className="t-caption max-w-[120px] truncate">for {summonDef(swap.out.defId).name}</span>
          </Button>
        ) : (
          <Button variant={next === "deploy" ? "primary" : "quiet"} className={cn(h, "shrink-0 px-5 flex-col !gap-0")} disabled={!canDeploy} onClick={() => c.deploySummon(inst.instanceId, true)} data-guide="deploy-summon" data-testid="deploy-button" aria-label={canDeploy ? `Deploy${gains ? `, gains ${gains}` : ""}` : `Deploy: all ${slots} places are taken`}>
            Deploy
            {gains && <span className="t-caption max-w-[120px] truncate">gains {gains}</span>}
          </Button>
        )}
        <HoldButton
          onRepeat={() => c.upgradeBond(inst.instanceId)}
          disabled={!canBond}
          onDenied={bondMax ? undefined : () => (shakeBond(), c.audio.play("error", { volume: 0.3, minInterval: 200 }))}
          feedback="scale"
          className={cn(h, "flex-1 min-w-0 rounded-[14px] btn-raised flex flex-col items-center justify-center", next === "bond" && gold, bondMax && "opacity-40")}
          testId="bond-upgrade"
          label={bondMax ? `Bond ${inst.bond}, at its cap` : `Strengthen bond for ${cost} essence`}
        >
          <span className={cn("t-label", next === "bond" ? "text-gold-ink" : "text-t1")}>Bond {inst.bond}</span>
          <span ref={bondPill} className={cn("flex items-center gap-1.5 t-caption tnum", next === "bond" ? "text-gold-ink" : canBond ? "text-jade" : "text-t2")}>
            {bondMax ? (
              "Max"
            ) : (
              <>
                <CurrencyGlyph kind="essence" size={6} className={next === "bond" ? "!bg-gold-ink" : canBond ? undefined : "!bg-t3"} />
                {fmt(cost)}
              </>
            )}
          </span>
        </HoldButton>
        <button
          className={cn("press flex flex-col items-center justify-center rounded-[14px] btn-raised px-3 shrink-0 min-w-11", h, next === "star" && gold, !star && "opacity-40")}
          onClick={() => c.starUp(inst.instanceId)}
          disabled={!star}
          data-testid="star-button"
          aria-label={star ? `Star up for ${star.shards} shards${star.cores ? ` and ${star.cores} Rift Cores` : ""}` : "Max stars"}
        >
          <span className={cn("t-label flex items-center gap-1.5", next === "star" ? "text-gold-ink" : "text-t1")}>
            {starReady && next !== "star" && <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />}
            Star
          </span>
          <span className={cn("t-caption tnum", next === "star" ? "text-gold-ink" : starReady ? "text-gold" : "text-t2")}>{!star ? "Max" : starReady ? "Ready" : `${Math.min(inst.shards, star.shards)}/${star.shards}`}</span>
        </button>
        {def.evolution && (
          <button className={cn("press flex flex-col items-center justify-center rounded-[14px] btn-raised px-3 shrink-0 min-w-11", h, next === "evolve" && gold)} onClick={() => c.evolve(inst.instanceId)} title={evo.reasons.join(", ")} data-testid="evolve-button" aria-label={evo.possible ? "Evolve, ready" : `Evolve: ${evo.reasons.join(", ")}`}>
            <span className={cn("t-label flex items-center gap-1.5", next === "evolve" ? "text-gold-ink" : "text-t1")}>
              {evo.possible && next !== "evolve" && <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />}
              Evolve
            </span>
            <span className={cn("t-caption tnum", next === "evolve" ? "text-gold-ink" : evo.possible ? "text-gold" : "text-t2")}>{evo.possible ? "Ready" : `Lv ${def.evolution.requiredLevel}`}</span>
          </button>
        )}
        {spareShards(inst) >= REFINE_SHARDS && (
          <button className="press flex flex-col items-center justify-center rounded-[14px] btn-raised px-3 shrink-0 min-w-11" style={{ height: short ? 44 : 52 }} onClick={() => c.refineShards(inst.instanceId)} data-testid="refine-shards" aria-label={`Refine ${REFINE_SHARDS} spare shards into a Rift Core`}>
            <span className="t-label text-t1">Refine</span>
            <span className="t-caption tnum text-t2 flex items-center gap-1">
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
  const c = useController();
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
      <Button size="sm" variant="quiet" onClick={() => c.setPanel("hero")} data-testid="army-empty-next">
        Back to the fight
      </Button>
    </div>
  );
}

/** Every Codex bonus, and where it comes from. */
function codexExplain(profile: Profile): string {
  const b = codexBonus(profile);
  const parts = (Object.entries(b) as [keyof typeof b, number][])
    .filter(([, v]) => v > 0)
    .sort((x, y) => y[1] - x[1])
    .map(([k, v]) => `+${Math.round(v * 100)}% ${STAT_LABEL[k].replace("Critical ", "Crit ")}`);
  return parts.length ? `Codex: ${parts.join(", ")}. Every kind of shadow you bind adds to it for good, and stars raise it.` : "Codex: every kind of shadow you bind adds to your stats for good.";
}

function codexSummary(profile: Profile): string {
  const b = codexBonus(profile);
  // The strongest bonus and a count of the rest: two bonuses and an ellipsis read as cut off.
  const parts = (Object.entries(b) as [keyof typeof b, number][])
    .filter(([, v]) => v > 0)
    .sort((x, y) => y[1] - x[1])
    .map(([k, v]) => `+${Math.round(v * 100)}% ${STAT_LABEL[k].replace("Critical ", "Crit ")}`);
  return parts.length ? `Codex ${parts[0]}${parts.length > 1 ? ` · ${parts.length - 1} more` : ""}` : "";
}

function pctChange(change: number, now: number): string {
  if (now <= 0) return "";
  const v = Math.round((change / now) * 100);
  return v === 0 ? "army ±0%" : `army ${v > 0 ? "+" : "−"}${Math.abs(v)}%`;
}

/** Whom the swap replaces, what it changes, and a way to pick someone else. */
function SwapLine({ swap, now, onChange }: { swap: SwapOption; now: number; onChange: () => void }) {
  const words = [...swap.gained.map((g) => `+${g.name}`), ...swap.lost.map((l) => `−${l.name}`)].join(", ");
  return (
    <div className="mt-1 flex shrink-0 items-center gap-2" data-testid="swap-line">
      <span className="t-label text-t2 min-w-0 flex-1 truncate">
        Replaces <span className="text-t1">{summonDef(swap.out.defId).name}</span>
        <span className={cn("tnum", swap.change >= 0 ? "text-jade" : "text-threat")}> · {pctChange(swap.change, now)}</span>
        {words && <span> · {words}</span>}
      </span>
      <button className="press -my-2 flex h-11 shrink-0 items-center rounded-[10px] px-2 t-label text-gold" onClick={onChange} data-testid="swap-change">
        Change
      </button>
    </div>
  );
}

/** The fielded shadows to choose from, each with what the swap would do to the army. */
function SwapChooser({ options, now, selected, onPick }: { options: SwapOption[]; now: number; selected: string; onPick: (id: string) => void }) {
  return (
    <div className="mt-1 flex shrink-0 gap-2 overflow-x-auto no-scrollbar -mx-4 px-4" style={{ touchAction: "pan-x" }} data-testid="swap-chooser">
      {options.map((o) => (
        <button key={o.out.instanceId} className={cn("press flex h-11 shrink-0 items-center gap-2 rounded-full pl-1 pr-3", o.out.instanceId === selected ? "bg-bg-3" : "bg-bg-2")} onClick={() => onPick(o.out.instanceId)} data-testid={`swap-out-${o.out.defId}`} aria-label={`Replace ${summonDef(o.out.defId).name}: ${pctChange(o.change, now)}`}>
          <SummonPortrait defId={o.out.defId} size={36} round />
          <span className={cn("t-caption tnum", o.change >= 0 ? "text-jade" : "text-threat")}>{pctChange(o.change, now).replace("army ", "")}</span>
        </button>
      ))}
    </div>
  );
}
