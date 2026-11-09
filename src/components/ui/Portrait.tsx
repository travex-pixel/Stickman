import { SUMMONS } from "@/game/data/summons";
import { ENEMIES } from "@/game/data/enemies";

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, "0")}`;
}

/**
 * Original vector portraits: a bust silhouette per role with the creature's palette.
 * Deterministic, scalable, and consistent with the in-battle rigs.
 */
export function SummonPortrait({ defId, size = 56, enemy = false }: { defId: string; size?: number; enemy?: boolean }) {
  const s = SUMMONS[defId];
  const e = ENEMIES[defId];
  const pal = s?.palette ?? (e ? { ...e.palette, glow: e.palette.eye } : { body: 0x12141f, accent: 0x9fd9ff, eye: 0x4ee6ff, glow: 0x4ee6ff });
  const role = s?.role ?? (e?.archetype === "brute" ? "vanguard" : e?.archetype === "ranger" ? "ranger" : e?.archetype === "arcanist" ? "arcanist" : e?.archetype === "boss" ? "sovereign" : "reaper");
  const id = `pg-${defId}-${enemy ? "e" : "s"}`;
  const body = hex(pal.body);
  const accent = hex(pal.accent);
  const eye = hex(pal.eye);
  const glow = hex(pal.glow);
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id={id} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor={glow} stopOpacity="0.45" />
          <stop offset="100%" stopColor={glow} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="12" fill="#0a0c14" />
      <circle cx="32" cy="30" r="26" fill={`url(#${id})`} />
      {role === "vanguard" || role === "sovereign" ? (
        <>
          <path d="M14 58 L18 34 Q32 26 46 34 L50 58 Z" fill={body} />
          <path d="M14 36 L8 30 L18 32 Z M50 36 L56 30 L46 32 Z" fill={accent} opacity="0.9" />
          <rect x="22" y="14" width="20" height="20" rx="6" fill={body} />
          <path d="M22 20 L16 8 L26 14 Z M42 20 L48 8 L38 14 Z" fill={accent} />
          <rect x="20" y="24" width="24" height="3" fill={accent} opacity="0.6" />
          <rect x="30" y="38" width="4" height="14" rx="1" fill={accent} opacity="0.8" />
        </>
      ) : role === "ranger" ? (
        <>
          <path d="M18 58 L22 36 Q32 30 42 36 L46 58 Z" fill={body} />
          <path d="M32 10 L18 32 L46 32 Z" fill={body} />
          <path d="M32 10 L22 32 L42 32 Z" fill={accent} opacity="0.25" />
          <path d="M44 20 Q56 32 44 46" stroke={accent} strokeWidth="2.5" fill="none" />
          <line x1="44" y1="20" x2="44" y2="46" stroke="#dde3f0" strokeWidth="1" opacity="0.8" />
        </>
      ) : role === "arcanist" ? (
        <>
          <path d="M14 58 Q32 50 50 58 L44 34 Q32 28 20 34 Z" fill={body} />
          <path d="M32 8 L20 32 L44 32 Z" fill={body} />
          <circle cx="50" cy="18" r="5" fill={accent} />
          <circle cx="50" cy="18" r="8" fill={accent} opacity="0.3" />
          <rect x="49" y="22" width="2" height="30" fill="#3a2d2a" />
          <path d="M24 44 L32 36 L40 44" stroke={accent} strokeWidth="1.5" fill="none" opacity="0.6" />
        </>
      ) : (
        <>
          <path d="M18 58 L22 36 Q32 30 42 36 L46 58 Z" fill={body} />
          <circle cx="32" cy="24" r="10" fill={body} />
          <path d="M22 32 L42 32 L40 38 L24 38 Z" fill={accent} opacity="0.3" />
          <path d="M46 10 L50 44" stroke="#b9c2d6" strokeWidth="3" strokeLinecap="round" />
          <path d="M46 10 L50 44" stroke={accent} strokeWidth="1" strokeLinecap="round" />
          {defId === "gravewalker" && <path d="M18 10 L14 44" stroke="#b9c2d6" strokeWidth="3" strokeLinecap="round" />}
        </>
      )}
      {/* eyes */}
      <rect x="26" y={role === "vanguard" || role === "sovereign" ? 22 : role === "arcanist" || role === "ranger" ? 24 : 22} width="4" height="2.4" rx="1" fill={eye} />
      <rect x="34" y={role === "vanguard" || role === "sovereign" ? 22 : role === "arcanist" || role === "ranger" ? 24 : 22} width="4" height="2.4" rx="1" fill={eye} />
      <circle cx="28" cy="23" r="4" fill={eye} opacity="0.2" />
      <circle cx="36" cy="23" r="4" fill={eye} opacity="0.2" />
    </svg>
  );
}

export function WarriorPortrait({ size = 40, accent = "#4ee6ff" }: { size?: number; accent?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="12" fill="#0a0c14" />
      <path d="M16 58 L20 34 Q32 26 44 34 L48 58 Z" fill="#1a1f2e" />
      <path d="M12 58 L18 36 L22 58 Z" fill="#0d1a2a" />
      <rect x="22" y="12" width="20" height="22" rx="7" fill="#1a1f2e" />
      <path d="M30 12 L34 12 L33 4 L31 4 Z" fill="#3a4258" />
      <rect x="21" y="23" width="22" height="3" fill="#0b0e16" />
      <rect x="25" y="23.6" width="5" height="2" rx="1" fill={accent} />
      <rect x="34" y="23.6" width="5" height="2" rx="1" fill={accent} />
      <rect x="31" y="36" width="2.5" height="12" fill={accent} opacity="0.8" />
      <path d="M50 6 L53 46" stroke="#b9c2d6" strokeWidth="3" strokeLinecap="round" />
      <path d="M50 6 L53 46" stroke={accent} strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}
