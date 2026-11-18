"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { HoldButton } from "@/components/ui/HoldButton";
import { useController, useProfileRef } from "@/hooks/useGame";
import { useShake } from "@/hooks/useShake";
import { usePanelLower } from "@/hooks/usePanelDetent";
import { cn } from "@/lib/cn";
import { MASTERY_NAME, SIGNATURES, SIGNATURE_RANK_MAX, SIGNATURE_SLOTS, SYNERGIES, type EvolutionId, type SignatureId, type SynergyId } from "@/game/data/signatures";
import type { Profile } from "@/game/progression/profile";
import {
  canBuySignatureRank,
  canChooseEvolution,
  chosenEvolution,
  discoveryProgress,
  equippedSignatures,
  isDiscovered,
  signatureEffectText,
  signatureList,
  signatureMastery,
  signatureRank,
  signatureState,
  slotsOpen,
  synergyViews,
  type MasteryView,
} from "@/game/progression/signatures";
import { SigGlyph, activationText, rarityWord, sigColour, signatureFocus, useSignatureFocus } from "@/components/signatures/shared";

const CROWN: SignatureId = "sovereign_awakening";
/** How long the panel stays lowered while a preview plays above it. */
const PREVIEW_MS = { cinematic: 6000, plain: 4200 } as const;

/** An evolution waits to be chosen: the skill reached Adept with none picked. */
function evolutionWaits(p: Profile, id: SignatureId): boolean {
  return SIGNATURES[id].evolutions.length > 0 && chosenEvolution(p, id) === null && signatureMastery(p, id).tier >= 1;
}

/**
 * Something to do in the collection: an empty slot and a found skill to fill it, an evolution to
 * choose, or a rank to buy for a skill in use (a warrior with points banked would otherwise see
 * the dot forever, for skills he never equips).
 */
export function signatureNews(p: Profile): boolean {
  const s = signatureState(p);
  if (s.discovered.length === 0) return false;
  const slots = equippedSignatures(p);
  const unequipped = s.discovered.some((id) => id !== CROWN && !slots.includes(id));
  if (unequipped && slots.some((x) => x === null)) return true;
  for (const id of s.discovered) {
    if (evolutionWaits(p, id)) return true;
    if ((slots.includes(id) || id === CROWN) && canBuySignatureRank(p, id).ok) return true;
  }
  return false;
}

/** The slot a skill sits in, or -1. */
function slotOf(slots: (SignatureId | null)[], id: SignatureId): number {
  return slots.indexOf(id);
}

type Pick = { kind: "swap"; id: SignatureId } | { kind: "fill"; slot: number } | null;

/**
 * Signature skills: the slots they are equipped in (three, then four, and the crown apart), every
 * skill found or still to find, and one skill's detail: what it does now, when it acts, its rank,
 * its mastery, its three evolutions and its combinations, with a preview on the battlefield.
 * Equipping is one tap (Equip fills the first empty slot) or two (Swap in, then the slot it takes).
 */
export function SignaturesView({ short }: { short: boolean }) {
  const c = useController();
  const profile = useProfileRef();
  const [selected, setSelected] = useState<SignatureId | null>(null);
  const [pick, setPick] = useState<Pick>(null);
  const focus = useSignatureFocus();
  // A request from elsewhere (a reveal's Equip, the battlefield strip): show that skill, and when
  // every slot is full, start the swap so the next tap is the slot it takes.
  useEffect(() => {
    if (!focus) return;
    setSelected(focus.id);
    setPick(focus.swap && isDiscovered(profile, focus.id) && focus.id !== CROWN ? { kind: "swap", id: focus.id } : null);
    signatureFocus.set(null);
  }, [focus, profile]);
  const open = slotsOpen(profile);
  const slots = equippedSignatures(profile);
  const found = signatureState(profile).discovered;

  const equip = (id: SignatureId, slot: number) => {
    setPick(null);
    if (!c.equipSignature(id, slot)) c.audio.play("error", { volume: 0.3, minInterval: 200 });
  };
  const tapSlot = (i: number) => {
    const holder = slots[i] ?? null;
    if (pick?.kind === "swap") return equip(pick.id, i);
    // From a found skill's detail, an empty slot takes it at once.
    if (!holder && selected && selected !== CROWN && isDiscovered(profile, selected) && slotOf(slots, selected) < 0) return equip(selected, i);
    if (!holder) {
      setSelected(null);
      setPick(pick?.kind === "fill" && pick.slot === i ? null : { kind: "fill", slot: i });
      return;
    }
    setPick(null);
    setSelected(holder);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0" data-testid="signatures-view">
      {/* On a short phone a skill's detail takes the slots' room; they come back for a swap. */}
      {!(short && selected && !pick) && (
        <>
          <SlotStrip profile={profile} open={open} slots={slots} selected={selected} pick={pick} onSlot={tapSlot} onCrown={() => (setPick(null), setSelected(CROWN))} short={short} />
          <PromptLine profile={profile} pick={pick} found={found.length} onCancel={() => setPick(null)} />
        </>
      )}
      {selected ? (
        <Detail key={selected} id={selected} slots={slots} pick={pick} onBack={() => (setSelected(null), setPick(null))} onPick={setPick} onEquip={equip} short={short} />
      ) : (
        <Collection profile={profile} slots={slots} pick={pick} onOpen={(id) => (setPick(null), setSelected(id))} onFill={equip} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The slots: the crown apart, then three (or four) signature slots.
// ---------------------------------------------------------------------------

function SlotStrip({ profile, open, slots, selected, pick, onSlot, onCrown, short }: { profile: Profile; open: number; slots: (SignatureId | null)[]; selected: SignatureId | null; pick: Pick; onSlot: (i: number) => void; onCrown: () => void; short: boolean }) {
  const c = useController();
  const crown = isDiscovered(profile, CROWN);
  return (
    <div className={cn("flex items-center shrink-0 gap-1.5", short ? "mt-1" : "mt-2")} data-testid="signature-slots">
      <button
        className="press relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
        onClick={onCrown}
        data-testid="signature-crown"
        data-on={crown || undefined}
        aria-pressed={selected === CROWN}
        aria-label={crown ? "Crown: Sovereign Awakening, always on" : "Crown slot: not yet found"}
      >
        <span className={cn("absolute inset-[2px] rounded-full", crown ? "bg-bg-2" : "bg-bg-1 shadow-[inset_0_0_0_1px_var(--line-2)]")} />
        {crown && <span className="absolute inset-[2px] rounded-full" style={{ boxShadow: `inset 0 0 0 1.5px ${sigColour(CROWN)}` }} aria-hidden="true" />}
        {/* Not found: the crown's own glyph, dim, so it never reads as the locked fourth slot. */}
        <SigGlyph id={CROWN} size={crown ? 19 : 16} className={cn("relative", !crown && "text-t3 opacity-60")} style={crown ? { color: sigColour(CROWN) } : undefined} />
        {selected === CROWN && <SelRing />}
      </button>
      <span className="mx-1 h-6 w-px shrink-0 bg-[var(--line-2)]" aria-hidden="true" />
      {Array.from({ length: SIGNATURE_SLOTS }, (_, i) => {
        const id = i < open ? (slots[i] ?? null) : null;
        const locked = i >= open;
        const target = !locked && (pick?.kind === "swap" || (pick?.kind === "fill" && pick.slot === i));
        return (
          <button
            key={i}
            className={cn("press relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full", locked && "opacity-70")}
            onClick={() => (locked ? c.toast("The fourth signature slot is not open yet", "info") : onSlot(i))}
            data-testid={`signature-slot-${i}`}
            data-skill={id ?? undefined}
            data-target={target || undefined}
            aria-disabled={locked || undefined}
            aria-pressed={!!id && selected === id}
            aria-label={locked ? `Slot ${i + 1}: locked` : id ? `Slot ${i + 1}: ${SIGNATURES[id].name}${pick?.kind === "swap" ? `. Replace with ${SIGNATURES[pick.id].name}` : ""}` : `Slot ${i + 1}: empty`}
          >
            <span className={cn("absolute inset-[2px] rounded-full", id ? "bg-bg-2" : "bg-bg-1")} />
            {id ? (
              <>
                <span className="absolute inset-[2px] rounded-full opacity-80" style={{ boxShadow: `inset 0 0 0 1.5px ${sigColour(id)}` }} aria-hidden="true" />
                <SigGlyph id={id} size={19} className="relative text-t1" />
              </>
            ) : locked ? (
              <>
                <span className="absolute inset-[2px] rounded-full shadow-[inset_0_0_0_1px_var(--line)]" aria-hidden="true" />
                <Icon name="lock" size={13} className="relative text-t3" />
              </>
            ) : (
              <>
                <span className="absolute inset-[2px] rounded-full border border-dashed border-[var(--line-2)]" aria-hidden="true" />
                <span className="relative t-label text-t3" aria-hidden="true">
                  {i + 1}
                </span>
              </>
            )}
            {target && <span className="breathe pointer-events-none absolute -inset-[2px] rounded-full shadow-[inset_0_0_0_1.5px_var(--color-gold)]" aria-hidden="true" />}
            {!!id && selected === id && !target && <SelRing />}
          </button>
        );
      })}
    </div>
  );
}

function SelRing() {
  return <span className="absolute -inset-[3px] rounded-full shadow-[inset_0_0_0_1.5px_var(--color-t2)]" aria-hidden="true" />;
}

/** One line under the slots: what the slots hold, or what the next tap does. */
function PromptLine({ profile, pick, found, onCancel }: { profile: Profile; pick: Pick; found: number; onCancel: () => void }) {
  const ready = synergyViews(profile).filter((s) => s.ready);
  const text =
    pick?.kind === "swap"
      ? `Tap the slot ${SIGNATURES[pick.id].name} takes`
      : pick?.kind === "fill"
        ? `Slot ${pick.slot + 1}: pick a skill to equip`
        : found === 0
          ? "None found yet. Each is found by a deed in battle."
          : `${found} of ${signatureList().length} found${ready.length === 1 ? ` · ${SYNERGIES.find((d) => d.id === ready[0]!.id)!.name} ready` : ready.length > 1 ? ` · ${ready.length} combinations ready` : ""}`;
  return (
    <div className="flex items-center gap-2 shrink-0 min-w-0 h-6" data-testid="signature-prompt">
      {pick && <span className="lozenge" aria-hidden="true" />}
      <p className={cn("t-caption truncate flex-1 min-w-0", pick ? "text-gold" : "text-t2")}>{text}</p>
      {pick && (
        <button className="press -my-2.5 flex h-11 shrink-0 items-center px-2 t-label text-t2" onClick={onCancel} data-testid="signature-pick-cancel">
          Cancel
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The collection: every skill, found or not, then the combinations.
// ---------------------------------------------------------------------------

function Collection({ profile, slots, pick, onOpen, onFill }: { profile: Profile; slots: (SignatureId | null)[]; pick: Pick; onOpen: (id: SignatureId) => void; onFill: (id: SignatureId, slot: number) => void }) {
  const views = synergyViews(profile);
  const foundSyn = views.filter((v) => v.discovered).length;
  return (
    <div className="-mx-4 mt-1 flex-1 min-h-0 overflow-y-auto overscroll-contain shadow-[inset_0_1px_0_var(--line)]" data-scroll style={{ touchAction: "pan-y" }} data-testid="signature-list">
      {signatureList().map((id) => (
        <SkillRow key={id} id={id} profile={profile} slot={slotOf(slots, id)} fillSlot={pick?.kind === "fill" ? pick.slot : null} onOpen={() => onOpen(id)} onFill={(slot) => onFill(id, slot)} />
      ))}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="t-label text-t2">Combinations</span>
        <span className="t-caption tnum text-t3">
          {foundSyn} of {views.length} found
        </span>
      </div>
      {views.map((v) => (
        <SynergyLine key={v.id} id={v.id} discovered={v.discovered} ready={v.ready} />
      ))}
      <div className="h-3" aria-hidden="true" />
    </div>
  );
}

/** A skill's mark: its glyph on a disc, inside a ring that fills toward the next mastery tier. */
function MasteryMark({ id, mastery, found, size = 36, hidden }: { id: SignatureId; mastery: MasteryView; found: boolean; size?: number; hidden?: boolean }) {
  const r = size / 2 - 1.5;
  const len = 2 * Math.PI * r;
  const frac = mastery.next ? Math.min(1, mastery.next.have / Math.max(1, mastery.next.need)) : 1;
  const grand = mastery.tier >= 3;
  return (
    <span className="relative flex shrink-0 items-center justify-center rounded-full bg-bg-2" style={{ width: size, height: size }} aria-hidden="true">
      {found ? <SigGlyph id={id} size={Math.round(size * 0.5)} style={{ color: sigColour(id) }} /> : hidden ? <span className="font-serif text-[15px] leading-none text-t3">?</span> : <Icon name="lock" size={Math.round(size * 0.36)} className="text-t3" />}
      {found && (
        <svg className="absolute inset-0 -rotate-90" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-2)" strokeWidth="1.5" />
          {frac > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-gold)" strokeWidth="1.5" strokeDasharray={len} strokeDashoffset={len * (1 - frac)} strokeLinecap="round" opacity={mastery.tier >= 1 ? 1 : 0.6} />}
          {grand && <circle cx={size / 2} cy={size / 2} r={r - 3} fill="none" stroke="var(--color-gold)" strokeWidth="1" opacity="0.5" />}
        </svg>
      )}
    </span>
  );
}

function SkillRow({ id, profile, slot, fillSlot, onOpen, onFill }: { id: SignatureId; profile: Profile; slot: number; fillSlot: number | null; onOpen: () => void; onFill: (slot: number) => void }) {
  const def = SIGNATURES[id];
  const found = isDiscovered(profile, id);
  const disc = discoveryProgress(profile, id);
  const mastery = signatureMastery(profile, id);
  const rank = signatureRank(profile, id);
  const canFill = fillSlot !== null && found && id !== CROWN && slot < 0;
  const dim = fillSlot !== null && !canFill;
  // The row's dot is for a choice waiting (its evolution), not for points to spend: those show on its Rank button.
  const news = found && evolutionWaits(profile, id);
  const name = disc.hidden ? "???" : def.name;
  return (
    <button
      className={cn("press-fill relative flex min-h-[52px] w-full items-center gap-3 px-4 py-1.5 text-left shadow-[inset_0_-1px_0_var(--line)] transition-opacity duration-200", dim && "opacity-40")}
      onClick={() => (canFill ? onFill(fillSlot!) : onOpen())}
      data-testid={`signature-row-${id}`}
      data-found={found || undefined}
      data-rank={rank}
      aria-label={found ? `${def.name}, ${rarityWord(id)}, rank ${rank} of ${SIGNATURE_RANK_MAX}, ${mastery.name}${slot >= 0 ? `, equipped in slot ${slot + 1}` : id === CROWN ? ", the crown" : ""}${canFill ? `. Equip in slot ${fillSlot! + 1}` : ""}` : `${name}, not found. ${disc.text}`}
    >
      <MasteryMark id={id} mastery={mastery} found={found} hidden={disc.hidden} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("t-body truncate", found ? "text-t1" : "text-t2")}>{name}</span>
        {found ? (
          <span className="t-caption truncate">
            <span style={{ color: sigColour(id) }}>{rarityWord(id)}</span>
            <span className="text-t2"> · {mastery.name}</span>
          </span>
        ) : (
          <span className="t-caption text-t3 truncate" data-testid={`signature-condition-${id}`}>
            {disc.text}
            {disc.need !== undefined && <span className="tnum"> · {Math.min(disc.have ?? 0, disc.need)}/{disc.need}</span>}
          </span>
        )}
      </span>
      {news && !canFill && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden="true" />}
      {canFill ? (
        <span className="t-label text-gold shrink-0">Equip</span>
      ) : found ? (
        <span className="flex flex-col items-end shrink-0">
          <span className="t-label tnum text-t1">
            {rank}
            <span className="text-t3">/{SIGNATURE_RANK_MAX}</span>
          </span>
          <span className="t-caption text-t3">{id === CROWN ? "Crown" : slot >= 0 ? `Slot ${slot + 1}` : " "}</span>
        </span>
      ) : null}
    </button>
  );
}

function SynergyLine({ id, discovered, ready, compact }: { id: SynergyId; discovered: boolean; ready: boolean; compact?: boolean }) {
  const def = SYNERGIES.find((s) => s.id === id)!;
  return (
    <div className={cn("flex items-start gap-3 px-4", compact ? "py-1.5" : "py-2")} data-testid={`synergy-${id}`} data-found={discovered || undefined}>
      <span className={cn("mt-[5px] shrink-0", discovered ? "lozenge" : "h-1 w-1 rotate-45 bg-bg-3")} aria-hidden="true" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("t-label", discovered ? "text-t1" : "text-t3")}>
          {discovered ? def.name : "???"}
          {discovered && ready && <span className="text-jade"> · ready</span>}
        </span>
        <span className={cn("t-caption", discovered ? "text-t2" : "text-t3")}>{discovered ? def.line : def.hint}</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One skill: what it does now, when it acts, rank, mastery, evolutions, combinations.
// ---------------------------------------------------------------------------

function Detail({ id, slots, pick, onBack, onPick, onEquip, short }: { id: SignatureId; slots: (SignatureId | null)[]; pick: Pick; onBack: () => void; onPick: (p: Pick) => void; onEquip: (id: SignatureId, slot: number) => void; short: boolean }) {
  const c = useController();
  const profile = useProfileRef();
  const def = SIGNATURES[id];
  const found = isDiscovered(profile, id);
  const disc = discoveryProgress(profile, id);
  const rank = signatureRank(profile, id);
  const evo = chosenEvolution(profile, id);
  const mastery = signatureMastery(profile, id);
  const check = canBuySignatureRank(profile, id);
  const slot = slotOf(slots, id);
  const firstEmpty = slots.findIndex((s) => s === null);
  const crown = id === CROWN;
  const [pill, shake] = useShake<HTMLSpanElement>();
  const [equipRef, shakeEquip] = useShake<HTMLSpanElement>();
  const lower = usePanelLower();
  const [playing, setPlaying] = useState(false);
  const playTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (playTimer.current && clearTimeout(playTimer.current)), []);
  // Each preview lowers the panel for its length, so the battlefield above can be watched; leaving
  // the detail lets the panel rise again.
  useEffect(() => () => lower(0), [lower]);
  const canPreview = found || !disc.hidden;
  const preview = () => {
    if (!c.previewSignature(id, evo)) {
      c.toast(`${def.name}: its preview cannot play here yet`, "info");
      return;
    }
    const ms = def.cinematic ? PREVIEW_MS.cinematic : PREVIEW_MS.plain;
    lower(ms);
    setPlaying(true);
    if (playTimer.current) clearTimeout(playTimer.current);
    playTimer.current = setTimeout(() => setPlaying(false), ms);
  };
  const swapping = pick?.kind === "swap" && pick.id === id;
  const name = disc.hidden ? "???" : def.name;
  const buyLabel = !found ? "Not found" : check.ok ? `Rank ${rank + 1} · ${check.cost} pts` : check.reason === "max" ? "Rank 10" : check.reason === "points" ? `Needs ${check.cost} · ${profile.player.skillPoints}` : "Locked";
  return (
    <div className="flex flex-col flex-1 min-h-0" data-testid="signature-detail" data-skill={id}>
      <div className="flex items-center gap-2 shrink-0 -ml-3 h-11">
        <button className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-t2" onClick={onBack} aria-label="Back to every signature skill" data-testid="signature-back">
          <Icon name="chevron" size={18} className="rotate-180" />
        </button>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("truncate", short ? "t-title" : "t-name", found ? "text-t1" : "text-t2")} data-testid="signature-name">
            {name}
          </span>
          {!disc.hidden && (
            <span className="t-caption truncate">
              <span style={{ color: sigColour(id) }}>{rarityWord(id)}</span>
              <span className="text-t2"> · {def.role}</span>
            </span>
          )}
        </span>
        {canPreview && (
          <Button variant="quiet" size="sm" className="shrink-0 !px-3 max-[359px]:!px-0 max-[359px]:w-11" onClick={preview} data-testid="signature-preview" data-playing={playing || undefined} aria-label={`Preview ${def.name} on the battlefield`} leading={<Icon name="play" size={14} className={playing ? "text-gold" : "text-t1"} />}>
            <span className="max-[359px]:hidden">{playing ? "Playing" : "Preview"}</span>
          </Button>
        )}
      </div>
      <div className="-mx-4 mt-1 flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-2 shadow-[inset_0_1px_0_var(--line)]" data-scroll style={{ touchAction: "pan-y" }}>
        {found ? (
          <p className="t-label text-t1 pt-2" data-testid="signature-effect">
            {signatureEffectText(id, rank, evo)}
          </p>
        ) : (
          <>
            {!disc.hidden && <p className="t-label text-t2 pt-2">{def.description}</p>}
            <p className="t-label text-gold pt-2" data-testid="signature-condition">
              {disc.hidden ? "Hidden. " : "To find it: "}
              {disc.text}
              {disc.need !== undefined && (
                <span className="tnum text-t1">
                  {" "}
                  ({Math.min(disc.have ?? 0, disc.need)} of {disc.need})
                </span>
              )}
            </p>
          </>
        )}
        {!disc.hidden && (
          <p className="t-caption text-t2 mt-1.5" data-testid="signature-activation">
            {activationText(id)}
          </p>
        )}
        {found && (
          <>
            <Section title="Rank" right={<RankPips rank={rank} />}>
              <p className="t-caption text-t2">Each rank strikes harder. Bought with skill points.</p>
            </Section>
            <MasterySection mastery={mastery} />
          </>
        )}
        {def.evolutions.length > 0 && !disc.hidden && <Evolutions id={id} found={found} chosen={evo} mastery={mastery} />}
        {crown && found && (
          <Section title="Evolution">
            <p className="t-caption text-t2">The crown has no paths: it grows with mastery, and crowns whatever ultimate is cast while it reigns.</p>
          </Section>
        )}
        {!disc.hidden && <Combinations id={id} />}
      </div>
      {found && (
        <div className={cn("flex items-center gap-2 shrink-0", short ? "pt-1.5" : "pt-2")}>
          {crown ? (
            <span className="t-label text-t2 flex-1 min-w-0 truncate">Always on: the crown slot</span>
          ) : slot >= 0 ? (
            <Button variant="quiet" size={short ? "sm" : "md"} className="flex-1 min-w-0" onClick={() => (c.unequipSignature(slot) ? onPick(null) : (shakeEquip(), c.audio.play("error", { volume: 0.3 })))} data-testid="signature-unequip">
              <span ref={equipRef}>Unequip</span>
            </Button>
          ) : swapping ? (
            <Button variant="quiet" size={short ? "sm" : "md"} className="flex-1 min-w-0" onClick={() => onPick(null)} data-testid="signature-swap-cancel">
              Cancel swap
            </Button>
          ) : (
            <Button
              variant="quiet"
              size={short ? "sm" : "md"}
              className="flex-1 min-w-0"
              onClick={() => (firstEmpty >= 0 ? onEquip(id, firstEmpty) : onPick({ kind: "swap", id }))}
              data-testid="signature-equip"
              aria-label={firstEmpty >= 0 ? `Equip ${def.name} in slot ${firstEmpty + 1}` : `Swap ${def.name} in: then tap the slot it takes`}
            >
              <span ref={equipRef}>{firstEmpty >= 0 ? "Equip" : "Swap in"}</span>
            </Button>
          )}
          <HoldButton
            onRepeat={() => c.buySignatureRank(id)}
            disabled={!check.ok}
            onDenied={!check.ok && check.reason === "points" ? () => (shake(), c.audio.play("error", { volume: 0.3, minInterval: 200 })) : undefined}
            feedback="scale"
            className={cn("ui-btn shrink-0", short ? "h-11 px-4 text-[14px] leading-[18px] font-semibold rounded-[14px]" : "h-[52px] px-5 t-button rounded-[14px]")}
            variant="primary"
            testId="signature-rank-up"
            label={check.ok ? `Buy ${def.name} rank ${rank + 1} for ${check.cost} skill points` : buyLabel}
          >
            <span ref={pill} className="flex items-center gap-1.5 tnum">
              {buyLabel}
            </span>
          </HoldButton>
        </div>
      )}
    </div>
  );
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-3 h-5">
        <span className="t-label text-t2">{title}</span>
        {right}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function RankPips({ rank }: { rank: number }) {
  return (
    <span className="flex items-center gap-2" data-testid="signature-rank" data-rank={rank} aria-label={`Rank ${rank} of ${SIGNATURE_RANK_MAX}`}>
      <span className="flex gap-[3px]" aria-hidden="true">
        {Array.from({ length: SIGNATURE_RANK_MAX }, (_, i) => (
          <span key={i} className={cn("h-[3px] w-[7px] rounded-full", i < rank ? "bg-gold" : "bg-bg-3")} />
        ))}
      </span>
      <span className="t-label tnum text-t1">
        {rank}
        <span className="text-t3">/{SIGNATURE_RANK_MAX}</span>
      </span>
    </span>
  );
}

const TIER_LINE = ["Adept opens the choice of evolution.", "Master awakens the chosen evolution.", "Grandmaster gilds the skill's form.", "Its form is gilded: the last tier."];

function MasterySection({ mastery }: { mastery: MasteryView }) {
  const next = mastery.next;
  const frac = next ? Math.min(1, next.have / Math.max(1, next.need)) : 1;
  return (
    <Section
      title="Mastery"
      right={
        <span className="t-label text-gold" data-testid="signature-mastery" data-tier={mastery.tier}>
          {mastery.name}
        </span>
      }
    >
      <div className="flex items-center gap-3">
        <span className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-bg-3" aria-hidden="true">
          <span className="absolute inset-0 origin-left rounded-full bg-gold" style={{ transform: `scaleX(${frac})` }} />
        </span>
        <span className="t-caption tnum text-t2 shrink-0">{next ? `${Math.min(next.have, next.need)}/${next.need} ${next.label} to ${MASTERY_NAME[next.tier]}` : `${mastery.casts} casts · ${mastery.kills} kills`}</span>
      </div>
      <p className="t-caption text-t3 mt-1">{TIER_LINE[mastery.tier]}</p>
    </Section>
  );
}

function Evolutions({ id, found, chosen, mastery }: { id: SignatureId; found: boolean; chosen: EvolutionId | null; mastery: MasteryView }) {
  const c = useController();
  const profile = useProfileRef();
  const def = SIGNATURES[id];
  const open = found && mastery.tier >= 1;
  const status = !found ? "Three paths, opened by mastery." : !open ? `Opens at Adept${mastery.next ? `: ${Math.min(mastery.next.have, mastery.next.need)} of ${mastery.next.need} ${mastery.next.label}` : ""}.` : chosen ? "One at a time; change it any time outside a boss fight." : "Choose one. You can change it later.";
  return (
    <Section title="Evolution" right={!open ? <Icon name="lock" size={12} className="text-t3" /> : undefined}>
      <p className={cn("t-caption", open && !chosen ? "text-gold" : "text-t3")} data-testid="signature-evolution-status">
        {status}
      </p>
      <div className="-mx-4 mt-1">
        {def.evolutions.map((e) => {
          const on = chosen === e.id;
          const can = canChooseEvolution(profile, id, e.id).ok;
          return (
            <button
              key={e.id}
              className={cn("press-fill relative flex min-h-11 w-full items-start gap-3 px-4 py-2 text-left", on && "bg-bg-2")}
              onClick={() => (on ? undefined : can ? (c.chooseEvolution(id, e.id) || c.audio.play("error", { volume: 0.3 })) : c.toast(`${e.name} opens at Adept mastery`, "info"))}
              aria-pressed={on}
              aria-disabled={!can && !on ? true : undefined}
              data-testid={`evolution-${e.id}`}
              data-chosen={on || undefined}
            >
              {on && <span className="absolute left-0 inset-y-2 w-[2px] rounded-full bg-gold" aria-hidden="true" />}
              <span className={cn("mt-[6px] shrink-0", on ? "lozenge" : "h-1 w-1 rotate-45 bg-bg-3")} aria-hidden="true" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn("t-label", on ? "text-gold" : open ? "text-t1" : "text-t2")}>
                  {e.name}
                  {on && <span className="text-t2"> · {mastery.tier >= 2 ? "awakened" : "chosen"}</span>}
                </span>
                <span className={cn("t-caption", open ? "text-t2" : "text-t3")}>{e.line}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

function Combinations({ id }: { id: SignatureId }) {
  const profile = useProfileRef();
  const mine = synergyViews(profile).filter((v) => SYNERGIES.find((s) => s.id === v.id)!.requires.includes(id));
  if (mine.length === 0) return null;
  return (
    <Section title="Combinations">
      <div className="-mx-4">
        {mine.map((v) => (
          <SynergyLine key={v.id} id={v.id} discovered={v.discovered} ready={v.ready} compact />
        ))}
      </div>
    </Section>
  );
}
