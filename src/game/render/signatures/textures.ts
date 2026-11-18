import { Texture } from "pixi.js";

/**
 * Textures the signature skills draw with, made once on a canvas (white, tinted at use) and shared.
 * No external assets. `destroySigTextures` releases them when the renderer unmounts.
 */
const cache = new Map<string, Texture>();

function make(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): Texture {
  const hit = cache.get(key);
  if (hit && !hit.destroyed) return hit;
  if (typeof document === "undefined") return Texture.WHITE;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return Texture.WHITE;
  draw(ctx, w, h);
  const t = Texture.from(c);
  cache.set(key, t);
  return t;
}

/** A soft streak along x: rises from the tail, brightest near the head, soft across. */
export function streakTex(): Texture {
  return make("sig-streak", 64, 12, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const v = (y - (h - 1) / 2) / ((h - 1) / 2);
      const across = Math.exp(-v * v * 3.5);
      for (let x = 0; x < w; x++) {
        const u = x / (w - 1);
        const along = u < 0.8 ? Math.pow(u / 0.8, 1.6) : Math.pow((1 - u) / 0.2, 0.7);
        const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(255 * along * across);
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

/**
 * A shadow blade along x (hilt at 0, point at the right): a long leaf with a hard edge, so it reads
 * as a blade even small. Tinted ink for the body; the same shape added in white for the edge light.
 */
export function bladeTex(): Texture {
  return make("sig-blade", 64, 16, (ctx, w, h) => {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(2, h / 2);
    ctx.quadraticCurveTo(w * 0.35, 1, w * 0.7, h * 0.28);
    ctx.lineTo(w - 1, h / 2);
    ctx.lineTo(w * 0.7, h * 0.72);
    ctx.quadraticCurveTo(w * 0.35, h - 1, 2, h / 2);
    ctx.closePath();
    ctx.fill();
  });
}

/** The thin bright edge of a blade (white along its upper edge and point). */
export function bladeEdgeTex(): Texture {
  return make("sig-blade-edge", 64, 16, (ctx, w, h) => {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(6, h / 2);
    ctx.quadraticCurveTo(w * 0.35, 2.2, w * 0.7, h * 0.3);
    ctx.lineTo(w - 2, h / 2);
    ctx.stroke();
  });
}

/**
 * One scale of the dragon's body, seen from the side: a dark plate, lit along its top rim and
 * darker underneath, soft at the ends so the segments overlap into one body.
 */
export function scaleTex(): Texture {
  return make("sig-scale", 64, 48, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (x - w / 2) / (w / 2);
        const dy = (y - h / 2) / (h / 2);
        const r = Math.sqrt(dx * dx * 0.9 + dy * dy);
        const i = (y * w + x) * 4;
        if (r > 1) {
          img.data[i + 3] = 0;
          continue;
        }
        // Light from above: the top rim is brightest, the belly darkest.
        const rim = Math.max(0, Math.min(1, (r - 0.72) / 0.25)) * Math.max(0, -dy * 1.2 + 0.2);
        const body = 0.32 + 0.25 * (1 - r) - 0.2 * Math.max(0, dy);
        const v = Math.min(1, body + rim * 0.9);
        img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(255 * v);
        img.data[i + 3] = Math.round(255 * Math.min(1, (1 - r) * 6));
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

/** A sharp dorsal fin (point up), for the dragon's spine. */
export function finTex(): Texture {
  return make("sig-fin", 24, 32, (ctx, w, h) => {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(1, h - 1);
    ctx.quadraticCurveTo(w * 0.35, h * 0.5, w * 0.62, 1);
    ctx.quadraticCurveTo(w * 0.7, h * 0.55, w - 1, h - 1);
    ctx.closePath();
    ctx.fill();
  });
}

/** A ring with a soft glow either side of a bright line (radius 120 of 256). */
export function glowRingTex(): Texture {
  return make("sig-ring", 256, 256, (ctx, w) => {
    const c = w / 2;
    const img = ctx.createImageData(w, w);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.hypot(x - c + 0.5, y - c + 0.5);
        const off = Math.abs(d - 120);
        const a = Math.exp(-off * off / 6) + 0.35 * Math.exp(-off * off / 60);
        const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(255 * Math.min(1, a));
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

/** A broad soft band at radius 120 of 256 (the ink under a ring's light). */
export function bandRingTex(): Texture {
  return make("sig-band", 256, 256, (ctx, w) => {
    const c = w / 2;
    const img = ctx.createImageData(w, w);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.hypot(x - c + 0.5, y - c + 0.5);
        const off = Math.abs(d - 120);
        const a = Math.exp(-(off * off) / 40);
        const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(255 * Math.min(1, a));
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

/** A hole: opaque and flat in the middle, falling off at the edge (a black core, an ink pool). */
export function holeTex(): Texture {
  return make("sig-hole", 64, 64, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.62, "rgba(255,255,255,1)");
    g.addColorStop(0.8, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

/** A ragged puff of smoke (several overlapping soft blobs), for trails and dissolving bodies. */
export function smokeTex(): Texture {
  return make("sig-smoke", 64, 64, (ctx, w) => {
    const blobs: [number, number, number][] = [[0.5, 0.5, 0.42], [0.36, 0.42, 0.26], [0.64, 0.4, 0.24], [0.45, 0.66, 0.24], [0.62, 0.62, 0.22]];
    for (const [bx, by, br] of blobs) {
      const g = ctx.createRadialGradient(bx * w, by * w, 0, bx * w, by * w, br * w);
      g.addColorStop(0, "rgba(255,255,255,0.55)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, w);
    }
  });
}

/** A four-point star, sharp (impact glints, eyes). */
export function starTex(): Texture {
  return make("sig-star", 64, 64, (ctx, w) => {
    const c = w / 2;
    const img = ctx.createImageData(w, w);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const dx = Math.abs(x - c + 0.5) / c;
        const dy = Math.abs(y - c + 0.5) / c;
        const ray = Math.max(Math.exp(-dy * 40) * (1 - dx), Math.exp(-dx * 40) * (1 - dy));
        const core = Math.exp(-(dx * dx + dy * dy) * 30);
        const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(255 * Math.min(1, ray + core));
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

export function destroySigTextures(): void {
  for (const t of cache.values()) t.destroy(true);
  cache.clear();
}
