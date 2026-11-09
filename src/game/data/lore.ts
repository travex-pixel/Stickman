export interface JournalEntry {
  id: string;
  title: string;
  body: string;
  /** Condition key used by the progression system to unlock this entry. */
  unlock: "start" | "first_kill" | "first_summon" | "first_boss" | "stage_3" | "stage_5" | "warden_recruited" | "evolution";
}

export const JOURNAL: JournalEntry[] = [
  {
    id: "j_rift",
    title: "The Rifts",
    body: "They appeared in the same hour across the world: hairline fractures in the air, bleeding cold light. Everyone who touched one changed. Most did not change for the better.",
    unlock: "start",
  },
  {
    id: "j_claim",
    title: "The Claim",
    body: "When the Husk fell, something lingered. Not a ghost. A shape. You reached for it the way you reach for a railing in the dark, and it came to your hand. No one else can do this. You do not yet know why.",
    unlock: "first_kill",
  },
  {
    id: "j_companion",
    title: "First Companion",
    body: "It stands when you stand. It fights when you fight. It has no name you can pronounce, so you give it one. The Rift, somewhere, takes notice.",
    unlock: "first_summon",
  },
  {
    id: "j_warden",
    title: "The Hollow Warden",
    body: "Before the fracture there was a keeper. Its oath was to hold the border between here and elsewhere. The Rift did not break the oath. It inverted it. Now the Warden keeps the Rift, and the Rift keeps the Warden.",
    unlock: "first_boss",
  },
  {
    id: "j_verge",
    title: "The Verge Remembers",
    body: "Ash falls here that never finishes falling. The brutes carry embers that never finish burning. Something in this place has forgotten how to end.",
    unlock: "stage_3",
  },
  {
    id: "j_ascend",
    title: "Ascend",
    body: "Each essence you take makes the next one easier to hold. You begin to understand: this ability is not a gift. It is a direction. Up, through the fractures, toward whatever opened them.",
    unlock: "stage_5",
  },
  {
    id: "j_oath",
    title: "Oath Reforged",
    body: "The Warden knelt. Not in defeat. In recognition. Whatever you are becoming, it has seen it before, on the far side of the Rift.",
    unlock: "warden_recruited",
  },
  {
    id: "j_evolve",
    title: "What Essence Remembers",
    body: "The quiet soldier opened its eyes and they were red. It remembered a name. It did not tell you. But it fights like something that has a reason to.",
    unlock: "evolution",
  },
];

export const ACHIEVEMENTS = [
  { id: "first_blood", name: "First Blood", description: "Defeat your first enemy.", reward: { gold: 50 } },
  { id: "first_claim", name: "The Claim", description: "Claim your first essence.", reward: { gold: 100 } },
  { id: "warden_fall", name: "Keeper Broken", description: "Defeat the Hollow Warden.", reward: { gold: 300 } },
  { id: "collector_3", name: "Three Oaths", description: "Collect three different summons.", reward: { essence: 40 } },
  { id: "level_10", name: "Ascendant", description: "Reach warrior level 10.", reward: { gold: 500 } },
  { id: "stage_5", name: "Deeper", description: "Clear stage 5.", reward: { riftCores: 1 } },
  { id: "evolved", name: "Remembered", description: "Evolve a summon.", reward: { gold: 800 } },
  { id: "warden_oath", name: "Oath Reforged", description: "Recruit the Hollow Warden.", reward: { essence: 200 } },
] as const;

export type AchievementId = (typeof ACHIEVEMENTS)[number]["id"];
