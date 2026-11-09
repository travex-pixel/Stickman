import type { SVGProps } from "react";

export type IconName =
  | "sword" | "heart" | "speed" | "crit" | "critdmg" | "shield" | "coin" | "essence" | "core" | "skull" | "menu" | "lock" | "check"
  | "hero" | "summons" | "gear" | "skills" | "rift" | "dodge" | "bolt" | "nova" | "soul" | "fury" | "arc" | "follow" | "aggressive" | "guard"
  | "star" | "book" | "chevron" | "close" | "auto" | "level" | "sparkle" | "helm" | "chest" | "gloves" | "boots" | "relic" | "move" | "regen" | "xp";

const PATHS: Record<IconName, string> = {
  sword: "M14.5 3.5 20.5 9.5 11 19l-2 2-3-3 2-2zM4 20l1.5-1.5M3 15l6 6",
  heart: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z",
  speed: "M13 2 4 14h7l-1 8 9-12h-7z",
  crit: "m12 2 2.6 6.2L21 9l-5 4.3L17.5 20 12 16.6 6.5 20 8 13.3 3 9l6.4-.8z",
  critdmg: "m12 2 1.8 5.5H20l-5 3.6 1.9 5.9L12 13.5 7.1 17l1.9-5.9-5-3.6h6.2zM4 21h16",
  shield: "M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z",
  coin: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v10m-3-7.5h4.5a2 2 0 1 1 0 4H9",
  essence: "M12 2c3 4 6 7.5 6 11a6 6 0 1 1-12 0c0-3.5 3-7 6-11zm0 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  core: "M12 2 20 8l-3 12H7L4 8zM4 8h16M12 2v18",
  skull: "M12 3a8 8 0 0 0-8 8c0 3 1.6 5 4 6v3h8v-3c2.4-1 4-3 4-6a8 8 0 0 0-8-8zM9 11.5h.01M15 11.5h.01M10 17v3m4-3v3",
  menu: "M4 7h16M4 12h16M4 17h16",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z",
  check: "m5 12 5 5L20 7",
  hero: "M12 2 5 6v6c0 5 3 9 7 10 4-1 7-5 7-10V6zM9 10h6M12 10v6",
  summons: "M12 3a5 5 0 0 1 5 5c0 2.4-1.7 4.4-4 4.9V15h3l2 6H6l2-6h3v-2.1A5 5 0 0 1 12 3z",
  gear: "M12 2 4 6v5c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V6zM8 10h8l-1 6H9z",
  skills: "M12 2v6m0 0-4 4m4-4 4 4M8 12v4m8-4v4m-8 0-3 4m3-4 3 4m2-4 3 4m-3-4-3 4",
  rift: "M12 2c-4 5-7 8-7 12a7 7 0 0 0 14 0c0-4-3-7-7-12zm0 6v12",
  dodge: "M5 12h10M11 7l5 5-5 5M19 5v14",
  bolt: "M13 2 3 14h8l-1 8 11-13h-8z",
  nova: "M12 2v4m0 12v4M2 12h4m12 0h4M5 5l3 3m8 8 3 3M19 5l-3 3M8 16l-3 3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  soul: "M12 3C8 8 6 11 6 14a6 6 0 0 0 12 0c0-3-2-6-6-11zm-2 12a2 2 0 0 0 4 0",
  fury: "M12 2 9 9H3l5 4-2 8 6-4 6 4-2-8 5-4h-6z",
  arc: "M3 17a9 9 0 0 1 18 0M7 17a5 5 0 0 1 10 0",
  follow: "M12 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM5 21a7 7 0 0 1 14 0M19 8l2 2-2 2",
  aggressive: "M4 20 20 4M14 4h6v6M4 14l6 6",
  guard: "M12 3 5 6v5c0 4.5 3 8.5 7 9.5 4-1 7-5 7-9.5V6zm0 4v10",
  star: "m12 2 3 6.5 7 .9-5 4.9 1.3 7L12 18l-6.3 3.3 1.3-7-5-4.9 7-.9z",
  book: "M4 4h9a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-4v14h4z",
  chevron: "m9 6 6 6-6 6",
  close: "M6 6l12 12M18 6 6 18",
  auto: "M12 3a9 9 0 1 0 9 9M21 3v6h-6M9 9l3-2v10",
  level: "M12 2 4 10h5v10h6V10h5z",
  sparkle: "M12 2v4m0 12v4M4 12h4m8 0h4m-9.5-4.5L12 12l1.5-4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9z",
  helm: "M5 12a7 7 0 0 1 14 0v6H5zM9 15h6",
  chest: "M7 4h10l3 4-3 1v11H7V9L4 8z",
  gloves: "M7 11V5a1.5 1.5 0 0 1 3 0v6m0-3V3a1.5 1.5 0 0 1 3 0v8m0-4V5a1.5 1.5 0 0 1 3 0v9a6 6 0 0 1-12 0v-3a1.5 1.5 0 0 1 3 0",
  boots: "M8 3h6v9l5 4v4H6v-7a4 4 0 0 1 2-3.5z",
  relic: "M12 2 6 8l6 14 6-14zM6 8h12",
  move: "M5 12h14M13 6l6 6-6 6",
  regen: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10zM12 8v6m-3-3h6",
  xp: "M12 2 15 9h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z",
};

export function Icon({ name, size = 18, className, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}
