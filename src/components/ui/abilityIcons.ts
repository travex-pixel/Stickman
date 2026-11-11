import type { AbilityId } from "@/game/data/ids";
import type { IconName } from "./Icon";

export const ABILITY_ICON: Record<AbilityId, IconName> = {
  arc_slash: "arc",
  thunder_strike: "bolt",
  shadow_dash: "dodge",
  soul_burst: "soul",
  void_nova: "nova",
  ascendant_fury: "fury",
  blade_tempest: "tempest",
  chain_hook: "hook",
  blood_pact: "pact",
};
