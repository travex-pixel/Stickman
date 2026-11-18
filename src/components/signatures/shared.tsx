"use client";

import type { SVGProps } from "react";
import type { GameController } from "@/game/GameController";
import { RARITY_NAME, SIGNATURES, type SignatureId, type SignatureRarity } from "@/game/data/signatures";
import { Store, useStore } from "@/lib/store";

/**
 * Shared pieces of the signature skills' menus: each skill's glyph, its rarity colour, and the
 * way into the collection from anywhere (the reveal, the battlefield strip, the Power sheet).
 */

/** Rarity hues are rarity: the five the game already uses, and mythic for the crown alone. */
export const SIG_RARITY_VAR: Record<SignatureRarity, string> = {
  common: "var(--color-common)",
  rare: "var(--color-rare)",
  epic: "var(--color-epic)",
  legendary: "var(--color-legendary)",
  mythic: "var(--color-mythic)",
};

export function sigColour(id: SignatureId): string {
  return SIG_RARITY_VAR[SIGNATURES[id].rarity];
}

export function rarityWord(id: SignatureId): string {
  return RARITY_NAME[SIGNATURES[id].rarity];
}

/**
 * One stroke glyph per skill, drawn in the interface's own 24-unit stroke set so a skill reads at
 * 16px: the singularity's inward spiral, the orbiting blades, the parade's three cuts, the
 * cracked clock, the risen ranks, the serpent's coil, the falling star, the crown.
 */
const GLYPH: Record<SignatureId, string> = {
  void_collapse: "M12 10.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6zM12 6a6 6 0 1 1-6 6M12 3a9 9 0 0 1 9 9M3 12a9 9 0 0 1 4-7.5",
  shadow_storm: "M12 12m-1.6 0a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0M12 2.5l1.8 5.2L12 9l-1.8-1.3zM20.2 17.2l-5.4-1 .2-2.2 2.1-.4zM3.8 17.2l3.1-4.6 2.1.4.2 2.2z",
  death_parade: "M5 20 14 4M10 20l9-16M4 13h4M15 13h5",
  time_fracture: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2M16.5 4.8 14 9l2.6.8-1.4 3.4",
  legion_awakening: "M4 20v-4.5L6.5 13 9 15.5V20M15 20v-4.5l2.5-2.5 2.5 2.5V20M6.5 10.5a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2zM17.5 10.5a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2zM12 4v9M10 6l2-2 2 2",
  abyssal_devourer: "M3 18c2.5-5 5.5-5 7.5-1.5S16 20 18 14c1-3 0-6-3-7M15 7l4-2-1 4M17.2 9.6h.01",
  kings_judgement: "M19 3l-8 8M15 3l-5 5M12.5 13a4 4 0 1 1-1.2 7.8M4 21h16M8.5 17l-2-1",
  sovereign_awakening: "M4 18h16M5 18 3.5 8.5l5 3.5L12 5l3.5 7 5-3.5L19 18M12 14.5v.01",
};

export function SigGlyph({ id, size = 18, className, ...rest }: { id: SignatureId; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...rest}>
      <path d={GLYPH[id]} />
    </svg>
  );
}

export function glyphPath(id: SignatureId): string {
  return GLYPH[id];
}

/**
 * The skill to show when the collection next opens (a reveal's Equip with every slot full, a tap
 * on a slot in the battlefield strip). `swap`: open it ready to pick the slot it replaces.
 */
export const signatureFocus = new Store<{ id: SignatureId; swap: boolean } | null>(null);

export function useSignatureFocus() {
  return useStore(signatureFocus, (f) => f);
}

/** Opens the Skills panel on its signature view, optionally on one skill. */
export function openSignatureCollection(c: GameController, focus?: SignatureId, swap = false): void {
  signatureFocus.set(focus ? { id: focus, swap } : null);
  c.uiStore.update((u) => ({ ...u, skillsView: "signatures" }));
  c.setPanel("skills");
}

/** Seconds in plain words: "14 s", "1.5 s", "75 s". */
export function secs(s: number): string {
  return `${Number.isInteger(s) ? s : s.toFixed(s < 1 ? 2 : 1).replace(/0$/, "")} s`;
}

/** When and how a skill acts, in one plain line (its numbers from the catalogue). */
export function activationText(id: SignatureId): string {
  const d = SIGNATURES[id];
  if (id === "sovereign_awakening") return `Always on once found. Every ${secs(d.cooldown)} the warrior is crowned for a time: invulnerable for ${secs(d.castTime)}, then his other signature skills come faster.`;
  const hold = d.castTime > 0 ? `holds the warrior ${secs(d.castTime)}` : "never stops the warrior";
  return `Casts itself when ready, AUTO or not · every ${secs(d.cooldown)} · ${hold}${d.cinematic ? " · a cinematic" : ""}.`;
}
