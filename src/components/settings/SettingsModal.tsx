"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { useController, useProfileRef } from "@/hooks/useGame";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";

export function SettingsModal() {
  const c = useController();
  const profile = useProfileRef();
  const stats = useStore(c.diagStore, (x) => x);
  const [confirmReset, setConfirmReset] = useState(false);
  const s = profile.settings;
  return (
    <motion.div className="modal-card relative w-full max-w-[340px] flex flex-col" initial={{ scale: 0.94, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }} data-testid="settings">
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <div className="font-display text-[16px] tracking-[0.2em] text-ivory">ASCEND</div>
        <button className="h-8 w-8 flex items-center justify-center rounded-lg border border-white/10" onClick={() => c.closeModal()} aria-label="Close settings" data-testid="settings-close">
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="px-4 pb-4 flex flex-col gap-3">
        <GiftCode />
        <div className="h-px bg-white/8" />
        <Slider label="Music" value={s.music} onChange={(v) => c.updateSettings({ music: v })} />
        <Slider label="Effects" value={s.sfx} onChange={(v) => c.updateSettings({ sfx: v })} />
        <Toggle label="Advance to the next stage automatically" value={s.autoAdvance} onChange={(v) => c.updateSettings({ autoAdvance: v })} />
        <Toggle label="Reduced visual effects" value={s.reducedEffects} onChange={(v) => c.updateSettings({ reducedEffects: v })} />
        <Toggle label="Diagnostics overlay" value={s.diagnostics} onChange={(v) => c.updateSettings({ diagnostics: v })} />
        {s.diagnostics && (
          <div className="text-[10px] font-mono text-jade-2">
            {stats.fps} fps · {stats.frameMs} ms · {stats.renderer} · particles {stats.particles}
          </div>
        )}
        <div className="flex gap-2">
          <button className="btn-ghost flex-1 text-[11px]" onClick={() => c.replayTutorial()} data-testid="replay-tutorial">Replay guidance</button>
          {!confirmReset ? (
            <button className="btn-ghost flex-1 text-[11px] text-crimson-2" onClick={() => setConfirmReset(true)} data-testid="reset-save">Reset save</button>
          ) : (
            <button className={cn("btn-ghost flex-1 text-[11px] bg-crimson/20 border-crimson/60 text-ivory")} onClick={() => void c.resetSave()} data-testid="reset-save-confirm">Erase everything?</button>
          )}
        </div>
        <div className="text-[9px] text-mist text-center leading-snug">
          Your progress is saved on this device. Runs: {profile.progress.runs} · Best stage: {profile.progress.bestStage}
        </div>
      </div>
    </motion.div>
  );
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-3 text-[11px] text-ivory">
      <span className="w-14">{label}</span>
      <input type="range" min={0} max={1} step={0.05} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} className="flex-1 accent-gold" style={{ touchAction: "pan-x" }} />
      <span className="w-8 text-right text-mist tabular-nums">{Math.round(value * 100)}</span>
    </label>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className="flex items-center justify-between text-[11px] text-ivory" onClick={() => onChange(!value)} role="switch" aria-checked={value}>
      <span>{label}</span>
      <span className={cn("h-5 w-9 rounded-full border relative transition-colors", value ? "bg-gold/25 border-gold" : "bg-black/40 border-white/15")}>
        <span className={cn("absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all", value ? "left-[18px] bg-gold" : "left-0.5 bg-mist")} />
      </span>
    </button>
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
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      data-testid="gift-code"
    >
      <span className="caps">Gift code</span>
      <div className="flex gap-1.5">
        <input
          className="field flex-1 min-w-0"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setResult(null);
          }}
          placeholder="Enter a code from a friend"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={64}
          aria-label="Gift code"
          data-testid="gift-code-input"
        />
        <button type="submit" className="btn-primary !px-3 !py-2 !text-[13px] shrink-0" disabled={!code.trim() || busy} data-testid="gift-code-redeem">
          Redeem
        </button>
      </div>
      {result && (
        <span className={cn("text-[11px] font-semibold", result.ok ? "text-jade-2" : "text-crimson-2")} data-testid="gift-code-result" role="status">
          {result.message}
        </span>
      )}
    </form>
  );
}
