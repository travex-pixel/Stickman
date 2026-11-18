import { Graphics } from "pixi.js";
import { easeOutBack } from "../../anim/ease";
import { softCircle } from "../../textures";
import { GILT, GILT_HOT } from "../palette";
import { Stage, span01, type SigBeatEvent, type SigSynergyEvent, type SigCastEvent, type StageServices } from "../stage";
import type { SigHost } from "../host";
import type { SigKit } from "../kit";
import type { SigPalette } from "../palette";
import { crownContext } from "./sovereign";

/**
 * Crowned Ultimate's own moment: a gilt crown flares over the warrior as the ultimate goes off, a gold
 * ring round him (the Ascendant Fury has no stage of its own; a crowned Devourer or Judgement also
 * wears its crowned form in its own stage). The other combinations live in their owners' stages:
 * Gravity Feast in the dragon's, Hunter's and Blade Parade in Death Parade's, Legion Meteor's charges
 * in King's Judgement's, Frozen Singularity's pull and implosion in Time Fracture's.
 */
export class SynergyStage extends Stage {
  private readonly syn: SigSynergyEvent;
  private crown: Graphics | null = null;

  constructor(kit: SigKit, host: SigHost, svc: StageServices, pal: SigPalette, cast: SigCastEvent, compact: boolean, syn: SigSynergyEvent) {
    super(kit, host, svc, pal, cast, compact);
    this.syn = syn;
    this.tail = 0.1;
    if (syn.synergy === "crowned_ultimate" && this.body(host.playerId())) {
      this.crown = new Graphics(crownContext());
      host.layers.fx.addChild(this.crown);
      kit.ring(this.b.x, this.b.y, 6, 70 * this.u, 0.6, pal.deep, GILT_HOT, 3, { squash: 0.35 });
      kit.flash(0xf3e6c4, 0.2, 0.2);
    }
  }

  onBeat(e: SigBeatEvent): void {
    void e;
  }

  update(dt: number, real: number): void {
    void real;
    const t = this.t;
    if (this.crown && this.body(this.host.playerId())) {
      const b = this.b;
      const form = easeOutBack(span01(t, 0, 0.3));
      const fade = 1 - span01(t, 0.8, 1.2);
      this.crown.position.set(b.x, b.y - b.height - 16 * b.scale);
      this.crown.scale.set(b.scale * 0.9 * form);
      this.crown.alpha = fade;
      if (dt > 0 && Math.random() < 0.5) {
        const o = this.kit.o(b.x + (Math.random() - 0.5) * 30 * b.scale, b.y - b.height * 0.5, softCircle(), GILT);
        o.speed[0] = 20;
        o.speed[1] = 60;
        o.angle[0] = -Math.PI * 0.7;
        o.angle[1] = -Math.PI * 0.3;
        o.life[0] = 0.4;
        o.life[1] = 0.7;
        o.scale[0] = 0.06;
        o.scale[1] = 0.14;
        this.kit.emit(1);
      }
    }
    if (t > 1.25 && !this.ended) this.onEnd(false);
  }

  override dispose(): void {
    if (this.crown) {
      this.crown.destroy();
      this.crown = null;
    }
    super.dispose();
  }
}
