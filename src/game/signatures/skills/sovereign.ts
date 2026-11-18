import { addStatus } from "../../combat/statuses";
import { SIGNATURES, SOVEREIGN } from "../../data/signatures";
import type { SkillImpl } from "./common";

/**
 * Sovereign Awakening (the crown; cinematic): the army kneels (`kneel`: the simulation holds the
 * fielded shadows SOVEREIGN.kneelFor seconds), a crown forms over the warrior (`crown`: he is held
 * and unharmed for the skill's cast time), and the aura holds (`aura`, SOVEREIGN.auraFor seconds;
 * Master: longer): the other signature skills' cooldowns run SOVEREIGN.cooldownRate faster, summons
 * strike SOVEREIGN.summonBonus harder, combinations' own effects are SOVEREIGN.synergyBonus
 * stronger, and an ultimate cast in it takes its crowned form (Crowned Ultimate: the Ascendant Fury
 * throws SOVEREIGN.furyStrikes strikes; King's Judgement falls wider with one more star; Abyssal
 * Devourer dives once more). `sovereign_end` when it fades. It needs another signature skill
 * equipped, and a boss or a crowd, to be worth it.
 */
export const sovereign: SkillImpl = {
  plan(rt) {
    if (rt.loadout.equipped.length === 0) return null;
    const foes = rt.foes();
    const boss = foes.some((f) => f.kind === "boss");
    if (!boss && foes.length < 4) return null;
    return { center: { ...rt.world.player.pos }, radius: SIGNATURES.sovereign_awakening.radius, targets: foes, boss, score: 20 };
  },
  begin(rt, c) {
    const w = rt.world;
    const def = SIGNATURES.sovereign_awakening;
    const aura = c.master ? SOVEREIGN.auraForMaster : SOVEREIGN.auraFor;
    const p = w.player;
    rt.at(c, 0, () => {
      const army = w.summonEntities().filter((s) => !s.summon?.temporary && s.state !== "emerge");
      for (const s of army) {
        w.stop(s);
        w.setState(s, "cast", SOVEREIGN.kneelFor);
      }
      rt.beat(c, "kneel", { from: p.pos, targets: army, duration: SOVEREIGN.kneelFor });
      addStatus(p, { kind: "invuln", remaining: def.castTime, value: 1, sourceId: p.id });
    });
    rt.at(c, 0.35, () => rt.beat(c, "crown", { from: p.pos, duration: def.castTime - 0.35 }));
    rt.at(c, def.castTime, () => {
      rt.auraUntil = w.time + aura;
      rt.beat(c, "aura", { from: p.pos, radius: 180, duration: aura });
    });
    rt.at(c, def.castTime + aura, () => rt.beat(c, "sovereign_end", { from: p.pos }));
    return { windup: def.castTime, length: def.castTime + aura };
  },
};
