import type { GraphicsContext } from "pixi.js";

/**
 * The shapes the Sovereigns' mechanics are drawn from, each in its own local space (origin at the
 * point it is placed on), built once per size and colour and then only moved, scaled and faded
 * (`shapes.ts`). Every input is an argument; none captures anything.
 */

/** A filled ellipse. */
export function ellipseFill(c: GraphicsContext, rx: number, ry: number, color: number, alpha: number): void {
  c.ellipse(0, 0, Math.max(0.5, rx), Math.max(0.5, ry)).fill({ color, alpha });
}

/** An ellipse's rim. */
export function ellipseLine(c: GraphicsContext, rx: number, ry: number, width: number, color: number, alpha: number): void {
  c.ellipse(0, 0, Math.max(0.5, rx), Math.max(0.5, ry)).stroke({ width, color, alpha });
}

/** A filled circle. */
export function disc(c: GraphicsContext, r: number, color: number, alpha: number): void {
  c.circle(0, 0, Math.max(0.3, r)).fill({ color, alpha });
}

/** A straight line from the origin to (dx, dy). */
export function line(c: GraphicsContext, dx: number, dy: number, width: number, color: number, alpha: number): void {
  c.moveTo(0, 0).lineTo(dx, dy).stroke({ width, color, alpha });
}

// ---- the Mirror Knight

/** The guard's mirror at its full height `ph` (origin at its foot): an ink edge, the glass, the frame. */
export function pane(c: GraphicsContext, pw: number, ph: number, ink: number, glass: number, frame: number): void {
  c.roundRect(-pw / 2 - 2, -ph - 2, pw + 4, ph + 2, pw * 0.42).fill({ color: ink, alpha: 0.85 });
  c.roundRect(-pw / 2, -ph, pw, ph, pw * 0.4).fill({ color: glass, alpha: 0.24 });
  c.roundRect(-pw / 2, -ph, pw, ph, pw * 0.4).stroke({ width: 2.2, color: frame, alpha: 0.95 });
}

/** The glass lit by a blow flashed back (faded by its alpha). */
export function paneLight(c: GraphicsContext, pw: number, ph: number, color: number): void {
  // Over the glass's own 0.24 this adds about what a flash did when it was baked into the glass.
  c.roundRect(-pw / 2, -ph, pw, ph, pw * 0.4).fill({ color, alpha: 0.53 });
}

/** The echoed art's glyphs, gathering in the ghost's hand (origin at the ghost's feet). */
export function glyphBolt(c: GraphicsContext, ch: number, u: number, color: number): void {
  c.moveTo(0, -ch * 2.4).lineTo(-6 * u, -ch * 1.6).lineTo(4 * u, -ch * 1.2).lineTo(0, 0).stroke({ width: 1.5, color, alpha: 1 });
}

/** A ring glyph of radius `r` (origin at its centre). */
export function glyphRing(c: GraphicsContext, r: number, color: number): void {
  c.circle(0, 0, Math.max(0.5, r)).stroke({ width: 1.6, color, alpha: 1 });
}

/** A crescent glyph: the arc of a cut of radius `r` (origin at its centre). */
export function glyphArc(c: GraphicsContext, r: number, color: number): void {
  c.arc(0, 0, Math.max(0.5, r), -1.2, 1.2).stroke({ width: 2, color, alpha: 1 });
}

/** The pane's fixed glint (origin at its foot). */
export function paneGlint(c: GraphicsContext, pw: number, ph: number, color: number): void {
  c.moveTo(-pw * 0.28, -ph * 0.7).lineTo(-pw * 0.05, -ph * 0.88).stroke({ width: 1.4, color, alpha: 0.85 });
}

/** The sheen that sweeps the glass (origin where it crosses the pane's foot line). */
export function paneSheen(c: GraphicsContext, pw: number, ph: number, color: number): void {
  c.moveTo(-pw * 0.25, -ph * 0.08).lineTo(pw * 0.15, -ph * 0.92).stroke({ width: pw * 0.16, color, alpha: 0.35 });
}

/** The true knight's crack of gold light (origin at its chest, scale `s`). */
export function crack(c: GraphicsContext, s: number, color: number): void {
  c.moveTo(3 * s, -16 * s).lineTo(-2 * s, -6 * s).lineTo(4 * s, 2 * s).lineTo(-3 * s, 12 * s).stroke({ width: 2.4, color, alpha: 1 });
  c.moveTo(-2 * s, -6 * s).lineTo(-9 * s, -3 * s).stroke({ width: 1.6, color, alpha: 0.9 });
}

/** A gilt diamond (the one to strike), `u` base px per unit. */
export function diamond(c: GraphicsContext, u: number, color: number): void {
  c.poly([0, -6 * u, 4 * u, 0, 0, 6 * u, -4 * u, 0]).fill({ color, alpha: 0.95 });
}

/** The art's crescent wave racing down the lane (origin at its front). */
export function crescent(c: GraphicsContext, dir: number, ch: number, r: number, width: number, color: number, alpha: number): void {
  c.moveTo(-dir * 4, -ch * 1.4).quadraticCurveTo(dir * r * 0.9, -ch * 0.6, -dir * 4, r * 0.2).stroke({ width, color, alpha });
}

/** Dashes along +x from `from` to `to` dashes of `n` across `len` (the lane the art will fly). */
export function dashes(c: GraphicsContext, len: number, n: number, from: number, to: number, width: number, color: number): void {
  for (let i = from; i < to; i++) {
    const a = (i / n) * len;
    const b = ((i + 0.45) / n) * len;
    c.moveTo(a, 0).lineTo(b, 0);
  }
  c.stroke({ width, color, alpha: 1 });
}

// ---- the Storm Titan

/** A rod's charge round its reach: the arc filled so far, `steps` of `of` (origin at its foot). */
export function chargeArc(c: GraphicsContext, rx: number, ry: number, steps: number, of: number, color: number): void {
  const a0 = -Math.PI / 2;
  const all = 28;
  const a1 = a0 + (Math.PI * 2 * steps) / of;
  for (let i = 0; i <= all; i++) {
    const a = a0 + ((a1 - a0) * i) / all;
    const x = Math.cos(a) * rx * 0.92;
    const y = Math.sin(a) * ry * 0.92;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.stroke({ width: 3, color, alpha: 0.85 });
}

/** The rod itself, `h` tall, toppled by `topple` (origin at its foot, scale `s`). */
export function rod(c: GraphicsContext, s: number, h: number, topple: number, ink: number, iron: number, band: number): void {
  const tipX = Math.sin(topple * 1.3) * h;
  const tipY = -Math.cos(topple * 1.3) * h;
  const w = 3.2 * s;
  c.moveTo(0, 0).lineTo(tipX, tipY).stroke({ width: w * 1.6, color: ink, alpha: 1 });
  c.moveTo(0, 0).lineTo(tipX, tipY).stroke({ width: w, color: iron, alpha: 1 });
  c.moveTo(-7 * s, 0).lineTo(7 * s, 0).stroke({ width: 2 * s, color: iron, alpha: 1 });
  const bandY = -h * 0.62;
  c.moveTo(-w * 0.9, bandY).lineTo(w * 0.9, bandY).stroke({ width: 1.6 * s, color: band, alpha: 1 });
}

/** Arcs crawling up a charging rod `h` tall (origin at its foot): `n` of them, placed by `seed`. */
export function rodArcs(c: GraphicsContext, h: number, s: number, seed: number, n: number, color: number): void {
  for (let i = 0; i < n; i++) {
    const t0 = frac(seed * 0.618 + i * 0.37);
    const yA = -h * t0 * 0.8;
    const yB = yA - h * 0.22;
    c.moveTo(0, yA).lineTo((frac(seed * 0.71 + i) - 0.5) * 12 * s, (yA + yB) / 2).lineTo(0, yB).stroke({ width: 1.2, color, alpha: 1 });
  }
}

/** A rod's health pip, `k` of it left (origin at the pip's centre top). */
export function pip(c: GraphicsContext, bw: number, k: number, color: number): void {
  c.rect(-bw / 2 - 1, -1, bw + 2, 4).fill({ color: 0x0a0a0c, alpha: 0.85 });
  c.rect(-bw / 2, 0, bw * k, 2).fill({ color, alpha: 1 });
}

/** The tide's flow marks: seven chevrons along +x across `len`, at `half` either side of the lane's middle. */
export function chevrons(c: GraphicsContext, len: number, half: number, dir: number, u: number, color: number): void {
  for (let i = 0; i < 7; i++) {
    const x = (len * i) / 7;
    const cy = i % 2 ? half * 0.35 : -half * 0.35;
    c.moveTo(x - dir * 10 * u, cy - half * 0.18).lineTo(x, cy).lineTo(x - dir * 10 * u, cy + half * 0.18);
  }
  c.stroke({ width: 1.6, color, alpha: 0.5 });
}

/** The tide's breaking wave, `H` high (origin at its front, on the lane's top edge). */
export function wave(c: GraphicsContext, H: number, W: number, half: number, dir: number, water: number, rim: number, body: number): void {
  const bot = half * 2;
  const back = -dir * W;
  // A long back sloping up to a crest that curls forward over its face.
  const pts = [back - dir * W * 0.6, bot, back - dir * W * 0.4, -H * 0.15, back, -H * 0.55, -dir * W * 0.35, -H * 0.95, -dir * W * 0.05, -H, dir * W * 0.22, -H * 0.86, dir * W * 0.12, -H * 0.66, -dir * W * 0.02, -H * 0.72, 0, -H * 0.4, dir * W * 0.04, bot];
  c.poly(pts).fill({ color: water, alpha: body });
  c.poly(pts).stroke({ width: 1.6, color: rim, alpha: 0.6 });
}

/** Foam on the wave's crest and running down its face (same space as `wave`). */
export function foam(c: GraphicsContext, H: number, W: number, half: number, dir: number, color: number): void {
  const bot = half * 2;
  const back = -dir * W;
  c.moveTo(back, -H * 0.55).quadraticCurveTo(-dir * W * 0.3, -H * 1.1, dir * W * 0.22, -H * 0.86).stroke({ width: 3.2, color, alpha: 0.9 });
  c.moveTo(dir * W * 0.12, -H * 0.66).lineTo(0, -H * 0.4).lineTo(dir * W * 0.03, bot).stroke({ width: 2, color, alpha: 0.55 });
}

/** A rect (origin at its top left). */
export function rectFill(c: GraphicsContext, w: number, h: number, color: number, alpha: number): void {
  c.rect(0, 0, Math.max(0.5, w), Math.max(0.5, h)).fill({ color, alpha });
}

// ---- the Void Queen

/** The eclipse's dark: one wide sheet over the whole painted field and beyond (base px). */
export function sheet(c: GraphicsContext, w: number, h: number, color: number): void {
  c.rect(-w * 1.5, -h * 1.5, w * 4, h * 4).fill({ color, alpha: 1 });
}

/** The black sun of radius `R` ringed in its corona (origin at its centre). */
export function blackSun(c: GraphicsContext, R: number, corona: number): void {
  c.circle(0, 0, R * 1.7).fill({ color: corona, alpha: 0.08 });
  c.circle(0, 0, R * 1.2).fill({ color: corona, alpha: 0.3 });
  c.circle(0, 0, R).fill({ color: 0x020104, alpha: 1 });
  c.circle(0, 0, R).stroke({ width: 1.4, color: corona, alpha: 0.9 });
}

/** The well's four arms of pull turned to `step` of `steps` per quarter turn (origin at its core). */
export function arms(c: GraphicsContext, rx: number, ry: number, reach: number, step: number, steps: number, color: number): void {
  const spin = (step / steps) * (Math.PI / 2);
  for (let arm = 0; arm < 4; arm++) {
    const a0 = spin + (arm / 4) * Math.PI * 2;
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const r = reach - (reach - 1) * t;
      const a = a0 + t * 2.2;
      const px = Math.cos(a) * rx * r;
      const py = Math.sin(a) * ry * r;
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.stroke({ width: 1.4, color, alpha: 0.3 });
  }
}

/** The well's core rim and its lit heart. */
export function wellRim(c: GraphicsContext, rx: number, ry: number, rim: number, heart: number): void {
  c.ellipse(0, 0, rx, ry).stroke({ width: 2.5, color: rim, alpha: 0.9 });
  c.ellipse(0, 0, rx * 0.35, ry * 0.35).fill({ color: heart, alpha: 0.25 });
}

/** The court's sigil, radius `r` (origin at its centre): two rims and a small crown. */
export function sigil(c: GraphicsContext, r: number, main: number, trim: number): void {
  c.ellipse(0, 0, r, r * 0.32).stroke({ width: 1.6, color: main, alpha: 0.8 });
  c.ellipse(0, 0, r * 0.7, r * 0.22).stroke({ width: 1, color: trim, alpha: 0.7 });
  c.moveTo(-r * 0.3, 0).lineTo(-r * 0.3, -r * 0.18).lineTo(-r * 0.12, -r * 0.08).lineTo(0, -r * 0.24).lineTo(r * 0.12, -r * 0.08).lineTo(r * 0.3, -r * 0.18).lineTo(r * 0.3, 0).stroke({ width: 1, color: trim, alpha: 0.85 });
}

/** A tether of void from (0, 0) to (qx, qy) bowed through (mx, my): its ink or its light. */
export function tether(c: GraphicsContext, mx: number, my: number, qx: number, qy: number, width: number, color: number): void {
  c.moveTo(0, 0).quadraticCurveTo(mx, my, qx, qy).stroke({ width, color, alpha: 1 });
}

function frac(v: number): number {
  return v - Math.floor(v);
}
