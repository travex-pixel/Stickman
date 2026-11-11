import { SUMMONS } from "@/game/data/summons";
import { ENEMIES } from "@/game/data/enemies";

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

type Role = "vanguard" | "reaper" | "ranger" | "arcanist" | "sovereign" | "sentinel";

/**
 * Portrait busts in the same language as the battlefield:
 * summons are indigo shadows with a violet glow, enemies are ink with their archetype eye colour.
 */
export function SummonPortrait({ defId, size = 56, enemy = false }: { defId: string; size?: number; enemy?: boolean }) {
  const s = SUMMONS[defId];
  const e = ENEMIES[defId];
  const isEnemy = enemy || (!s && !!e);
  const role: Role = (s?.role as Role) ?? (e?.archetype === "brute" ? "vanguard" : e?.archetype === "ranger" ? "ranger" : e?.archetype === "arcanist" ? "arcanist" : e?.archetype === "boss" ? "sovereign" : "reaper");
  const legendary = s?.rarity === "legendary";
  const body = isEnemy ? "#17171d" : "#262650";
  const rim = isEnemy ? "#3a3a44" : "#4a4790";
  const eye = isEnemy ? hex(e?.palette.eye ?? 0xe8c98a) : legendary ? "#f0d48a" : "#c2b6ff";
  const glow = isEnemy ? hex(e?.palette.eye ?? 0xe8c98a) : "#8f7cff";
  const bg = isEnemy ? "#1d1b1a" : "#141530";
  const id = `pg-${defId}-${isEnemy ? "e" : "s"}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id={id} cx="50%" cy="38%" r="65%">
          <stop offset="0%" stopColor={glow} stopOpacity={isEnemy ? 0.18 : 0.32} />
          <stop offset="100%" stopColor={glow} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={rim} />
          <stop offset="55%" stopColor={body} />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="10" fill={bg} />
      <rect width="64" height="64" rx="10" fill={`url(#${id})`} />
      {role === "vanguard" || role === "sovereign" ? (
        <g fill={`url(#${id}-b)`}>
          <path d="M10 64 C12 44 20 36 32 36 C44 36 52 44 54 64 Z" />
          <circle cx="15" cy="40" r="7" />
          <circle cx="49" cy="40" r="7" />
          <circle cx="32" cy="24" r="11" />
          <path d="M23 18 L13 4 L27 15 Z M41 18 L51 4 L37 15 Z" />
        </g>
      ) : role === "ranger" ? (
        <g fill={`url(#${id}-b)`}>
          <path d="M14 64 C16 46 22 38 32 38 C42 38 48 46 50 64 Z" />
          <path d="M32 8 L18 36 L46 36 Z" />
          <path d="M50 14 Q60 32 50 50" stroke={rim} strokeWidth="2.5" fill="none" />
        </g>
      ) : role === "arcanist" ? (
        <g fill={`url(#${id}-b)`}>
          <path d="M8 64 Q32 50 56 64 L46 36 Q32 30 18 36 Z" />
          <path d="M30 6 L18 34 L44 34 Z" />
          <rect x="51" y="16" width="2" height="40" fill={rim} />
          <circle cx="52" cy="14" r="4" fill={glow} opacity="0.9" />
        </g>
      ) : (
        <g fill={`url(#${id}-b)`}>
          <path d="M16 64 C18 46 24 38 32 38 C40 38 46 46 48 64 Z" />
          <circle cx="32" cy="25" r="10" />
          <path d="M24 21 L14 12 L28 18 Z" />
          <path d="M48 8 L52 46" stroke={isEnemy ? "#3a3a40" : "#5b5f86"} strokeWidth="2.5" strokeLinecap="round" />
          {defId === "gravewalker" && <path d="M16 10 L12 46" stroke="#5b5f86" strokeWidth="2.5" strokeLinecap="round" />}
        </g>
      )}
      {/* Eyes are the brightest marks on the card. */}
      <path d={role === "vanguard" || role === "sovereign" ? "M33 23 L41 24.5 L33 26 Z" : role === "ranger" || role === "arcanist" ? "M32 27 L39 28.3 L32 29.6 Z" : "M33 24 L41 25.4 L33 26.8 Z"} fill={eye} />
      <circle cx={role === "ranger" || role === "arcanist" ? 35 : 37} cy={role === "ranger" || role === "arcanist" ? 28 : 25} r="6" fill={eye} opacity="0.18" />
      {legendary && <rect x="1" y="1" width="62" height="62" rx="9.5" fill="none" stroke="#cfa95e" strokeOpacity="0.6" />}
    </svg>
  );
}

export function WarriorPortrait({ size = 40, accent = "#cfa95e" }: { size?: number; accent?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id="wp-bg" cx="50%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#3a3426" />
          <stop offset="100%" stopColor="#141820" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="10" fill="url(#wp-bg)" />
      <path d="M14 64 C16 46 22 38 32 38 C42 38 48 46 50 64 Z" fill="#ebe5d8" />
      <path d="M20 42 L44 62 L40 64 L16 46 Z" fill={accent} opacity="0.9" />
      <circle cx="32" cy="25" r="11" fill="#ebe5d8" />
      <path d="M21 25 C21 14 30 11 37 13 C43 15 45 19 44 22 C38 18 30 19 22 31 Z" fill="#d6cfbf" />
      <rect x="34" y="24" width="6" height="2" rx="1" fill="#2b2822" />
      <path d="M52 6 L54 42" stroke="#e7e2d6" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
