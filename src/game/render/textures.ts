import { Texture } from "pixi.js";

const cache = new Map<string, Texture>();

function canvasTexture(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): Texture {
  const existing = cache.get(key);
  if (existing) return existing;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Texture.WHITE;
  draw(ctx, size);
  const tex = Texture.from(canvas);
  cache.set(key, tex);
  return tex;
}

export function softCircle(): Texture {
  return canvasTexture("soft", 64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.7)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

export function hardCircle(): Texture {
  return canvasTexture("hard", 32, (ctx, s) => {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2 - 1, 0, Math.PI * 2);
    ctx.fill();
  });
}

export function spark(): Texture {
  return canvasTexture("spark", 32, (ctx, s) => {
    const g = ctx.createLinearGradient(0, s / 2, s, s / 2);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, s / 2 - 2, s, 4);
  });
}

export function ring(): Texture {
  return canvasTexture("ring", 128, (ctx, s) => {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2 - 6, 0, Math.PI * 2);
    ctx.stroke();
  });
}

export function shard(): Texture {
  return canvasTexture("shard", 32, (ctx, s) => {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(s / 2, 0);
    ctx.lineTo(s * 0.75, s / 2);
    ctx.lineTo(s / 2, s);
    ctx.lineTo(s * 0.25, s / 2);
    ctx.closePath();
    ctx.fill();
  });
}

export function destroyTextures(): void {
  for (const t of cache.values()) t.destroy(true);
  cache.clear();
}
