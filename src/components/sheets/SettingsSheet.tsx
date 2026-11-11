"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { HoldConfirm } from "@/components/ui/HoldConfirm";
import { Sheet, SheetHeader } from "@/components/ui/Sheet";
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
          <Switch label="Reduced effects" detail="Less motion, shake and flashing." value={s.reducedEffects} onChange={(v) => c.updateSettings({ reducedEffects: v })} />
          <Switch label="Diagnostics" value={s.diagnostics} onChange={(v) => c.updateSettings({ diagnostics: v })} />
          {s.diagnostics && <DiagLine />}
        </div>
        <GiftCode />
        <div className="mt-5 flex flex-col">
          <Button variant="plain" className="justify-start px-0 !text-t1" onClick={() => c.replayTutorial()} data-testid="replay-tutorial">
            Replay guidance
          </Button>
          {!confirmReset ? (
            <Button variant="plain" className="justify-start px-0 !text-crimson" onClick={() => setConfirmReset(true)} data-testid="reset-save">
              Reset save
            </Button>
          ) : (
            <div className="flex items-center gap-3">
              <Button variant="plain" className="shrink-0 px-0" onClick={() => setConfirmReset(false)}>
                Keep it
              </Button>
              <HoldConfirm variant="plain" className="flex-1 !text-crimson bg-[var(--tint-crimson)]" ms={1200} onConfirm={() => void c.resetSave()} testId="reset-save-confirm" label="Hold to erase everything">
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
