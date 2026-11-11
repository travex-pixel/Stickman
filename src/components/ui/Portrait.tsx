"use client";

import { useContext, useEffect } from "react";
import { SUMMONS } from "@/game/data/summons";
import { ENEMIES } from "@/game/data/enemies";
import { GameContext } from "@/hooks/useGame";
import { useStore, Store } from "@/lib/store";

const EMPTY = new Store<Record<string, string>>({});

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

type Role = "vanguard" | "reaper" | "ranger" | "arcanist" | "sovereign" | "sentinel" | "caller";

/**
 * The portrait shows the creature's real battlefield rig, rendered once by Pixi. Until that image
 * exists (or outside the game), a flat vector bust in the same palette stands in.
 * `round` crops it to a disc (army discs, roster); otherwise a square with a 14px-or-less radius.
 */
export function SummonPortrait({ defId, size = 56, enemy = false, round = false }: { defId: string; size?: number; enemy?: boolean; round?: boolean }) {
  const c = useContext(GameContext);
  const isEnemy = enemy || (!SUMMONS[defId] && !!ENEMIES[defId]);
  const key = `${isEnemy ? "enemy" : "summon"}:${defId}`;
  const url = useStore(c?.portraitStore ?? EMPTY, (m) => m[key]);
  useEffect(() => {
    c?.requestPortrait(defId, isEnemy ? "enemy" : "summon");
  }, [c, defId, isEnemy]);
  const radius = round ? "50%" : Math.min(14, size * 0.25);
  if (url) {
    return (
      <span className="relative inline-block shrink-0 overflow-hidden bg-bg-2" style={{ width: size, height: size, borderRadius: radius }} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" width={size} height={size} className="block w-full h-full" draggable={false} />
      </span>
    );
  }
  return <VectorPortrait defId={defId} size={size} enemy={enemy} radius={radius} />;
}

function VectorPortrait({ defId, size = 56, enemy = false, radius }: { defId: string; size?: number; enemy?: boolean; radius: number | string }) {
  const s = SUMMONS[defId];
  const e = ENEMIES[defId];
  const isEnemy = enemy || (!s && !!e);
  const role: Role = (s?.role as Role) ?? (e?.archetype === "brute" ? "vanguard" : e?.archetype === "ranger" ? "ranger" : e?.archetype === "arcanist" ? "arcanist" : e?.archetype === "shieldbearer" ? "sentinel" : e?.archetype === "summoner" ? "caller" : e?.archetype === "boss" ? "sovereign" : "reaper");
  const legendary = s?.rarity === "legendary";
  const fill = isEnemy ? "#2a2a30" : legendary ? "#4a4f5e" : "#50555f";
  const rim = isEnemy ? "#3a3a44" : "#8a8478";
  const eye = isEnemy ? hex(e?.palette.eye ?? 0xe8c98a) : legendary ? "#fff0c2" : "#f0d9a8";
  const glow = isEnemy ? hex(e?.palette.eye ?? 0xe8c98a) : "#e9c97a";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={{ borderRadius: radius, flexShrink: 0 }}>
      <rect width="64" height="64" fill="#1b1b1d" />
      {role === "vanguard" || role === "sovereign" ? (
        <g fill={fill}>
          <path d="M10 64 C12 44 20 36 32 36 C44 36 52 44 54 64 Z" />
          <circle cx="15" cy="40" r="7" />
          <circle cx="49" cy="40" r="7" />
          <circle cx="32" cy="24" r="11" />
          <path d="M23 18 L13 4 L27 15 Z M41 18 L51 4 L37 15 Z" />
        </g>
      ) : role === "sentinel" ? (
        <g fill={fill}>
          <path d="M14 64 C16 46 22 38 32 38 C42 38 48 46 50 64 Z" />
          <circle cx="32" cy="25" r="10" />
          <rect x="38" y="26" width="18" height="34" rx="3" fill={rim} />
          <rect x="45" y="30" width="3" height="26" fill={glow} opacity="0.5" />
        </g>
      ) : role === "caller" ? (
        <g fill={fill}>
          <path d="M6 64 Q32 48 58 64 L46 34 Q32 28 18 34 Z" />
          <path d="M31 4 L17 32 L45 32 Z" />
          <path d="M12 20 L12 58" stroke={rim} strokeWidth="2" />
          <circle cx="12" cy="18" r="4" fill={glow} opacity="0.9" />
        </g>
      ) : role === "ranger" ? (
        <g fill={fill}>
          <path d="M14 64 C16 46 22 38 32 38 C42 38 48 46 50 64 Z" />
          <path d="M32 8 L18 36 L46 36 Z" />
          <path d="M50 14 Q60 32 50 50" stroke={rim} strokeWidth="2.5" fill="none" />
        </g>
      ) : role === "arcanist" ? (
        <g fill={fill}>
          <path d="M8 64 Q32 50 56 64 L46 36 Q32 30 18 36 Z" />
          <path d="M30 6 L18 34 L44 34 Z" />
          <rect x="51" y="16" width="2" height="40" fill={rim} />
          <circle cx="52" cy="14" r="4" fill={glow} opacity="0.9" />
        </g>
      ) : (
        <g fill={fill}>
          <path d="M16 64 C18 46 24 38 32 38 C40 38 46 46 48 64 Z" />
          <circle cx="32" cy="25" r="10" />
          <path d="M24 21 L14 12 L28 18 Z" />
          <path d="M48 8 L52 46" stroke={isEnemy ? "#3a3a40" : "#b9ad92"} strokeWidth="2.5" strokeLinecap="round" />
          {defId === "gravewalker" && <path d="M16 10 L12 46" stroke="#b9ad92" strokeWidth="2.5" strokeLinecap="round" />}
        </g>
      )}
      {/* Eyes are the brightest marks on the portrait. */}
      <path d={role === "vanguard" || role === "sovereign" ? "M33 23 L41 24.5 L33 26 Z" : role === "ranger" || role === "arcanist" || role === "caller" ? "M32 27 L39 28.3 L32 29.6 Z" : "M33 24 L41 25.4 L33 26.8 Z"} fill={eye} />
    </svg>
  );
}
