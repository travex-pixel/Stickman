"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { HoldConfirm } from "@/components/ui/HoldConfirm";
import { Sheet, SheetHeader } from "@/components/ui/Sheet";
import { Segment, Segmented } from "@/components/ui/Segmented";
import type { VisualQuality } from "@/game/data/signatures";
import { useController, useProfileRef } from "@/hooks/useGame";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import { CloseButton } from "./parts";

/** Settings: sound, how the game plays, a gift code, and the save. */
export function SettingsSheet({ open }: { open: boolean }) {
  const c = useController();
  const profile = useProfileRef();
  const [confirmReset, setConfirmReset] = useState(false);
  const s = profile.settings;
  return (
    <Sheet open={open} onDismiss={() => c.closeModal()} testId="modal-settings" labelledBy="settings-title">
      <div data-testid="settings">
        <div className="flex items-start justify-between gap-3">
          <SheetHeader id="settings-title" title="Settings" />
          <CloseButton onClick={() => c.closeModal()} testId="settings-close" label="Close settings" />
        </div>
        <div className="-mx-5 mt-2">
          <Slider label="Music" value={s.music} onChange={(v) => c.updateSettings({ music: v })} />
          <Slider label="Effects" value={s.sfx} onChange={(v) => c.updateSettings({ sfx: v })} />
          <Switch label="Advance automatically" detail="After a boss falls, move on to the next stage." value={s.autoAdvance} onChange={(v) => c.updateSettings({ autoAdvance: v })} />
          <Switch label="Short reveals" detail="Every BIND plays its short form. Your first bind always plays in full; tap to skip works either way." value={s.quickReveals} onChange={(v) => c.updateSettings({ quickReveals: v })} />
          <Switch label="Keep screen on" detail="The screen stays awake while the game is open." value={s.keepAwake} onChange={(v) => c.updateSettings({ keepAwake: v })} />
          <Switch label="Reduced effects" detail="Less motion, shake and flashing." value={s.reducedEffects} onChange={(v) => c.updateSettings({ reducedEffects: v })} />
          <Quality value={s.visualQuality ?? "full"} drawn={c.visualQualityDrawn()?.drawn ?? null} onChange={(q) => c.updateSettings({ visualQuality: q })} />
          <Switch label="Diagnostics" value={s.diagnostics} onChange={(v) => c.updateSettings({ diagnostics: v })} />
          {s.diagnostics && <DiagLine />}
        </div>
        <GiftCode />
        <div className="mt-5 flex flex-col">
          <Button variant="plain" className="justify-start px-0 !text-t1" onClick={() => c.replayTutorial()} data-testid="replay-tutorial">
            Replay guidance
          </Button>
          {!confirmReset ? (
            <Button variant="plain" className="justify-start px-0 !text-threat" onClick={() => setConfirmReset(true)} data-testid="reset-save">
              Reset save
            </Button>
          ) : (
            <div className="flex items-center gap-3">
              <Button variant="plain" className="shrink-0 px-0" onClick={() => setConfirmReset(false)}>
                Keep it
              </Button>
              <HoldConfirm variant="plain" className="flex-1 !text-threat bg-[var(--tint-crimson)]" ms={1200} onConfirm={() => void c.resetSave()} testId="reset-save-confirm" label="Hold to erase everything">
                Hold to erase everything
              </HoldConfirm>
            </div>
          )}
        </div>
        <p className="t-label text-t2 mt-3">
          Your progress is saved on this device. Runs {profile.progress.runs} · best stage {profile.progress.bestStage || "none yet"}
        </p>
      </div>
    </Sheet>
  );
}

function DiagLine() {
  const c = useController();
  const d = useStore(c.diagStore, (x) => x);
  return (
    <p className="t-label text-jade tnum px-5 py-2">
      {d.fps} fps · {d.frameMs} ms · {d.renderer} · particles {d.particles}
      {d.quality ? ` · quality ${d.quality}` : ""}
    </p>
  );
}

/** A 52px row: label (and one line of why) at the left, a jade iOS-style switch at the right. */
function Switch({ label, detail, value, onChange }: { label: string; detail?: ReactNode; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className="press-fill flex w-full min-h-[52px] items-center gap-3 px-5 py-2 text-left shadow-[inset_0_-1px_0_var(--line)]" onClick={() => onChange(!value)} role="switch" aria-checked={value}>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="t-body text-t1">{label}</span>
        {detail && <span className="t-label text-t2">{detail}</span>}
      </span>
      <span className={cn("relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200", value ? "bg-jade" : "bg-bg-3")} aria-hidden="true">
        <span className="absolute left-[2px] top-[2px] h-[27px] w-[27px] rounded-full bg-t1 transition-transform duration-200 ease-[var(--ease)]" style={{ transform: `translateX(${value ? 20 : 0}px)` }} />
      </span>
    </button>
  );
}

const QUALITY: { id: VisualQuality; label: string; detail: string }[] = [
  { id: "full", label: "Full spectacle", detail: "Every layer of every signature skill." },
  { id: "balanced", label: "Balanced", detail: "Fewer particles and lighter layers; every skill still reads." },
  { id: "performance", label: "Performance", detail: "Each skill's shape and impact only, for older phones." },
];

/**
 * How much the battlefield draws for the signature skills. Visual only: the fight is the same at
 * every setting. Reduced effects (above) is separate and stricter.
 */
function Quality({ value, drawn, onChange }: { value: VisualQuality; drawn: VisualQuality | null; onChange: (q: VisualQuality) => void }) {
  const cur = QUALITY.find((q) => q.id === value) ?? QUALITY[0]!;
  // The renderer steps down on its own when frames stay slow: say so, or the choice would look ignored.
  const stepped = drawn && drawn !== value ? (QUALITY.find((q) => q.id === drawn) ?? null) : null;
  return (
    <div className="flex flex-col gap-1.5 px-5 py-2 shadow-[inset_0_-1px_0_var(--line)]" data-testid="visual-quality">
      <span className="flex min-w-0 flex-col">
        <span className="t-body text-t1">Visual quality</span>
        <span className="t-label text-t2" data-testid="visual-quality-detail">
          {cur.detail} The fight is the same at every setting.
        </span>
        {stepped && (
          <span className="t-label text-gold" data-testid="visual-quality-auto">
            Drawn at {stepped.label} for now: frames were slow on this phone. Choose a setting to try again.
          </span>
        )}
      </span>
      <Segmented value={value} onChange={onChange} label="Visual quality">
        {QUALITY.map((q) => (
          <Segment key={q.id} id={q.id} className="max-[359px]:px-2" data-testid={`quality-${q.id}`}>
            {q.label}
          </Segment>
        ))}
      </Segmented>
    </div>
  );
}

/** A 3px track with a 20px thumb; the value at the right. */
function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex min-h-[52px] items-center gap-4 px-5 shadow-[inset_0_-1px_0_var(--line)]">
      <span className="t-body text-t1 w-16 shrink-0">{label}</span>
      <input type="range" min={0} max={1} step={0.05} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} className="ui-range flex-1 min-w-0" style={{ ["--v" as string]: `${value * 100}%`, touchAction: "pan-x" }} aria-label={label} />
      <span className="t-num-m text-t2 w-8 text-right">{Math.round(value * 100)}</span>
    </label>
  );
}

function GiftCode() {
  const c = useController();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const submit = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    const r = await c.redeemCode(code);
    setBusy(false);
    setResult(r);
    if (r.ok) setCode("");
  };
  return (
    <form
      className="mt-5 flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      data-testid="gift-code"
    >
      <span className="t-label text-t2">Gift code</span>
      <div className="flex gap-2">
        <input
          className="field flex-1 min-w-0"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setResult(null);
          }}
          placeholder="A code from a friend"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={64}
          aria-label="Gift code"
          data-testid="gift-code-input"
        />
        <Button type="submit" size="sm" variant="quiet" className="shrink-0" disabled={!code.trim() || busy} loading={busy} data-testid="gift-code-redeem">
          Redeem
        </Button>
      </div>
      {result && (
        <span className={cn("t-label flex items-center gap-2 text-t1")} data-testid="gift-code-result" role="status">
          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", result.ok ? "bg-jade" : "bg-crimson")} aria-hidden="true" />
          {result.message}
        </span>
      )}
    </form>
  );
}
