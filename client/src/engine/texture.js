// Предварительное масштабирование текстур.
//
// Зачем это нужно. Canvas2D не умеет мип-мапы: каждый drawImage со сжатием
// пересэмплирует исходник заново, каждый кадр. Символ 512×512, ужимаемый
// в ячейку 320×320, стоит дорого и при этом выглядит мылко — фильтр
// браузера берёт слишком мало отсчётов при сильном уменьшении.
//
// Решение: один раз при загрузке (и при смене размера окна) готовим копии
// ровно того размера, каким они окажутся на экране. Дальше drawImage идёт
// один к одному — это и быстрее, и заметно резче.

/**
 * Ступенчатое уменьшение: каждый шаг — не более чем вдвое.
 *
 * Прямое сжатие 512 → 160 одним вызовом даёт алиасинг: браузер
 * усредняет слишком мало исходных пикселей. Половинными шагами
 * получается результат, близкий к честной мип-пирамиде.
 */
export function downscale(image, sx, sy, sw, sh, dw, dh) {
  dw = Math.max(1, Math.round(dw));
  dh = Math.max(1, Math.round(dh));

  let curW = sw;
  let curH = sh;
  let src = image;
  let srcX = sx;
  let srcY = sy;

  // Промежуточный холст переиспользуется между шагами.
  let canvas = null;
  let ctx = null;

  while (curW > dw * 2 && curH > dh * 2) {
    const nextW = Math.max(dw, Math.round(curW / 2));
    const nextH = Math.max(dh, Math.round(curH / 2));

    const step = document.createElement("canvas");
    step.width = nextW;
    step.height = nextH;
    const sctx = step.getContext("2d");
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(src, srcX, srcY, curW, curH, 0, 0, nextW, nextH);

    src = step;
    srcX = 0;
    srcY = 0;
    curW = nextW;
    curH = nextH;
    canvas = step;
    ctx = sctx;
  }

  if (curW === dw && curH === dh && canvas) return canvas;

  const out = document.createElement("canvas");
  out.width = dw;
  out.height = dh;
  const octx = out.getContext("2d");
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(src, srcX, srcY, curW, curH, 0, 0, dw, dh);
  return out;
}

/**
 * Готовит кадр нужного размера. Если уменьшение незначительное
 * или требуется увеличение — возвращает исходник: пересобирать
 * ради нескольких процентов смысла нет.
 */
export function prescale(frame, dw, dh, { threshold = 0.9 } = {}) {
  if (dw >= frame.w * threshold || dh >= frame.h * threshold) return frame;
  const canvas = downscale(frame.image, frame.x, frame.y, frame.w, frame.h, dw, dh);
  return { image: canvas, x: 0, y: 0, w: canvas.width, h: canvas.height, prescaled: true };
}

/**
 * Кеш подготовленных текстур с ограничением по числу записей.
 *
 * Ключ включает размер, поэтому при смене окна кеш естественным образом
 * наполняется заново; старые записи вытесняются, чтобы память не росла
 * бесконечно при перетаскивании границы окна.
 */
export class TextureCache {
  constructor(limit = 120) {
    this.map = new Map();
    this.limit = limit;
  }

  key(frame, dw, dh) {
    if (!frame.image.__texId) frame.image.__texId = ++TextureCache._id;
    return `${frame.image.__texId}:${frame.x},${frame.y},${frame.w},${frame.h}:${dw}x${dh}`;
  }

  get(frame, dw, dh) {
    const w = Math.round(dw);
    const h = Math.round(dh);
    if (w <= 0 || h <= 0) return frame;
    if (w >= frame.w * 0.9 || h >= frame.h * 0.9) return frame;

    const k = this.key(frame, w, h);
    const hit = this.map.get(k);
    if (hit) {
      // Перекладываем в конец: Map хранит порядок вставки,
      // значит первый ключ — самый давно не используемый.
      this.map.delete(k);
      this.map.set(k, hit);
      return hit;
    }

    const built = prescale(frame, w, h);
    this.map.set(k, built);
    if (this.map.size > this.limit) {
      this.map.delete(this.map.keys().next().value);
    }
    return built;
  }

  clear() {
    this.map.clear();
  }
}

TextureCache._id = 0;
