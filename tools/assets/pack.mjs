// Упаковка PNG в атлас. Полочный алгоритм (shelf): кадры сортируются
// по высоте и раскладываются рядами. Для набора однотипных спрайтов он
// даёт плотность не хуже MaxRects, а кода — в десять раз меньше.

import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";

const PADDING = 2; // защита от «протекания» соседних пикселей при билинейной фильтрации

// Canvas2D не требует степеней двойки для текстур, поэтому округляем
// лишь до кратности 4. Атлас символов при POT раздувался с 2048×1536
// до 2048×4096 — это 24 МБ лишней видеопамяти на ровном месте.
const align4 = (v) => Math.ceil(v / 4) * 4;

export async function packAtlas(frames, { outPng, outJson, maxWidth = 2048 }) {
  const sorted = [...frames].sort((a, b) => b.height - a.height || b.width - a.width);

  let x = PADDING;
  let y = PADDING;
  let shelfHeight = 0;
  let usedWidth = 0;
  const placed = [];

  for (const f of sorted) {
    if (x + f.width + PADDING > maxWidth) {
      x = PADDING;
      y += shelfHeight + PADDING;
      shelfHeight = 0;
    }
    placed.push({ ...f, x, y });
    x += f.width + PADDING;
    usedWidth = Math.max(usedWidth, x);
    shelfHeight = Math.max(shelfHeight, f.height);
  }

  const atlasW = align4(usedWidth + PADDING);
  const atlasH = align4(y + shelfHeight + PADDING);

  const composites = placed.map((f) => ({ input: f.buffer, left: f.x, top: f.y }));

  await sharp({
    create: {
      width: atlasW,
      height: atlasH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite(composites)
    .png({ compressionLevel: 9, effort: 10 })
    .toFile(outPng);

  const json = {
    image: path.basename(outPng),
    size: { w: atlasW, h: atlasH },
    frames: {}
  };
  for (const f of placed) {
    json.frames[f.name] = {
      x: f.x,
      y: f.y,
      w: f.width,
      h: f.height,
      ...(f.slice ? { slice: f.slice } : {})
    };
  }

  await fs.writeFile(outJson, JSON.stringify(json, null, 2));
  return { atlasW, atlasH, count: placed.length };
}
