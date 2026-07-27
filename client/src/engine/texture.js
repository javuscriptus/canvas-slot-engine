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
//
// Весь модуль — плата за отсутствие мип-мап. На WebGL2 он не нужен вовсе.

/**
 * Две заготовки для промежуточных шагов уменьшения. Раньше комментарий
 * обещал переиспользование, а код создавал новый холст на каждом шаге:
 * пересборка двух десятков символов порождала под сотню холстов,
 * и сборщик мусора аккуратно возвращал этот долг посреди спина.
 */
const STEP = [
  { canvas: null, ctx: null, w: 0, h: 0 },
  { canvas: null, ctx: null, w: 0, h: 0 }
];

function step(index, w, h) {
  const slot = STEP[index];
  if (!slot.canvas) {
    slot.canvas = document.createElement("canvas");
    slot.ctx = slot.canvas.getContext("2d");
  }
  if (slot.w < w || slot.h < h) {
    slot.w = Math.max(slot.w, w);
    slot.h = Math.max(slot.h, h);
    slot.canvas.width = slot.w;
    slot.canvas.height = slot.h;
  }
  slot.ctx.setTransform(1, 0, 0, 1, 0, 0);
  slot.ctx.clearRect(0, 0, w, h);
  slot.ctx.imageSmoothingEnabled = true;
  slot.ctx.imageSmoothingQuality = "high";
  return slot;
}

/**
 * Ступенчатое уменьшение: каждый шаг — не более чем вдвое.
 *
 * Прямое сжатие 512 → 160 одним вызовом даёт алиасинг: браузер
 * усредняет слишком мало исходных пикселей. Половинными шагами
 * получается результат, близкий к честной мип-пирамиде.
 *
 * Промежуточные шаги идут в общие заготовки, наружу отдаётся отдельный
 * холст: результат кешируется надолго, а заготовки переживут только
 * до следующего вызова.
 */
export function downscale(image, sx, sy, sw, sh, dw, dh) {
  dw = Math.max(1, Math.round(dw));
  dh = Math.max(1, Math.round(dh));

  let curW = sw;
  let curH = sh;
  let src = image;
  let srcX = sx;
  let srcY = sy;
  let slotIndex = 0;

  while (curW > dw * 2 && curH > dh * 2) {
    const nextW = Math.max(dw, Math.round(curW / 2));
    const nextH = Math.max(dh, Math.round(curH / 2));

    const slot = step(slotIndex, nextW, nextH);
    slot.ctx.drawImage(src, srcX, srcY, curW, curH, 0, 0, nextW, nextH);

    src = slot.canvas;
    srcX = 0;
    srcY = 0;
    curW = nextW;
    curH = nextH;
    slotIndex = 1 - slotIndex;    // пинг-понг: нельзя читать и писать один холст
  }

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
 * Умеет ли браузер ctx.filter. Проверяется один раз: создание холста
 * ради проверки на каждый символ — заметная трата на старте.
 */
let filterSupport = null;
export function supportsFilter() {
  if (filterSupport === null) {
    const probe = document.createElement("canvas").getContext("2d");
    probe.filter = "blur(2px)";
    filterSupport = probe.filter === "blur(2px)";
  }
  return filterSupport;
}

/**
 * Заранее размытая копия кадра — смаз движущихся спрайтов.
 *
 * ctx.filter — самая дорогая операция Canvas2D, в кадре её быть не должно.
 * Радиус пропорционален размеру: на маленьком экране шесть пикселей
 * размыли бы картинку до неузнаваемости. Если фильтров нет, возвращается
 * исходник — растягивать его по ходу движения умеет тот, кто рисует.
 */
export function blur(frame, size, strength = 0.022) {
  if (!supportsFilter()) return frame;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  ctx.filter = `blur(${Math.max(2, size * strength).toFixed(1)}px)`;
  ctx.drawImage(frame.image, frame.x, frame.y, frame.w, frame.h, 0, 0, size, size);
  return { image: c, x: 0, y: 0, w: size, h: size, blurred: true };
}

/**
 * Кеш подготовленных текстур с ограничением по ПАМЯТИ.
 *
 * Считать записи бессмысленно: одна запись — это и марка 24×24, и фон
 * 2048×1152, между ними разница в четыре тысячи раз. Предел в сто шестьдесят
 * записей мог означать и три мегабайта, и триста; в бюджет 200 МБ на вкладку
 * второе не влезает. Поэтому вытеснение идёт по фактическому объёму
 * (ширина × высота × 4 байта), а самой давно не использованной записи
 * ищется Map, который хранит порядок вставки.
 */
export class TextureCache {
  constructor({ maxBytes = 48 * 1024 * 1024 } = {}) {
    this.map = new Map();
    this.maxBytes = maxBytes;
    this.bytes = 0;
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
    this.bytes += built.w * built.h * 4;
    this._evict();
    return built;
  }

  _evict() {
    while (this.bytes > this.maxBytes && this.map.size > 1) {
      const oldestKey = this.map.keys().next().value;
      const oldest = this.map.get(oldestKey);
      this.map.delete(oldestKey);
      this.bytes -= oldest.w * oldest.h * 4;
    }
  }

  clear() {
    this.map.clear();
    this.bytes = 0;
  }
}

TextureCache._id = 0;
